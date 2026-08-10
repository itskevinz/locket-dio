import * as services from "@/services";
import { useAppNavigation, useAppCamera, useAppLoading } from "@/context/AppContext";
import { useCallback, useRef, useState } from "react";
import UploadStatusIcon from "./UploadStatusIcon";
import { getMaxUploads } from "@/hooks/useFeature";
import {
  SonnerError,
  SonnerInfo,
  SonnerSuccess,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";
import {
  useAuthStore,
  useMomentDraftStore,
  usePostStore,
  useUploadQueueStore,
  useConnectivityStore,
} from "@/stores";
import { useNavigate } from "react-router-dom";
import { resetAllPostData } from "@/utils";
import { useTranslation } from "react-i18next";

const SendButton = () => {
  const { t } = useTranslation("main");
  const navigate = useNavigate();
  const navigation = useAppNavigation();
  const useloading = useAppLoading();
  const camera = useAppCamera();
  const { setIsFilterOpen } = navigation;
  const { sendLoading, uploadLoading, setUploadLoading } = useloading;

  const selectedFile = usePostStore((s) => s.selectedFile);
  const isSizeMedia = usePostStore((s) => s.isSizeMedia);
  const preview = usePostStore((s) => s.preview);
  const resetMedia = usePostStore((s) => s.resetMedia);

  const isOffline = useConnectivityStore((s) => s.isOffline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const checkConnectivity = useConnectivityStore((s) => s.checkConnectivity);

  const { setCameraActive } = camera;

  //Nhap hooks
  const { maxImageSizeMB, maxVideoSizeMB, storage_limit_mb } = getMaxUploads();
  const enqueueUploadItem = useUploadQueueStore((s) => s.enqueueUploadItem);
  const reloadUser = useAuthStore((s) => s.initAuth);

  const isImage = preview?.type === "image";
  const isVideo = preview?.type === "video";
  // A provisional shutter frame is intentionally low-cost UI only. Never let
  // it become the uploaded file while ImageCapture is still producing the
  // native-quality still.
  const capturePending = Boolean(preview?.capturePending && !selectedFile);

  const isTooBig = isImage
    ? isSizeMedia > maxImageSizeMB
    : isVideo
      ? isSizeMedia > maxVideoSizeMB
      : false;
  // Limits always have free defaults now — never block send on "no plan data"
  const hasNoData = false;

  // State để quản lý hiệu ứng loading và success
  const [isSuccess, setIsSuccess] = useState(false);
  // React state updates are asynchronous; this ref closes the tiny window where
  // a fast double-tap could start two payload/upload operations before rerender.
  const submitLockRef = useRef(false);

  const sendDisabled =
    capturePending || uploadLoading || isSuccess || isOffline || !serverReachable;

  const handleDelete = useCallback(() => {
    // Dừng stream cũ nếu có
    if (camera.streamRef.current) {
      camera.streamRef.current.getTracks().forEach((track) => track.stop());
      camera.streamRef.current = null;
    }
    resetMedia();

    //Call Utils để reset toàn bộ data liên quan
    resetAllPostData();

    setCameraActive(true); // Giữ dòng này để trigger useEffect
    setIsSuccess(false); // Reset success state
  }, []);

  // Hàm submit được cải tiến
  const handleSubmit = async () => {
    // Chặn double-tap / double-enqueue ngay trong cùng event loop.
    if (submitLockRef.current || uploadLoading || isSuccess || capturePending) return;
    submitLockRef.current = true;

    try {
      // Re-check server before post (no Background Sync auto-post)
      try {
        const conn = await checkConnectivity({ force: true });
        if (!conn?.browserOnline || !conn?.serverReachable) {
          SonnerWarning(
            !conn?.browserOnline ? "Mất mạng" : "Máy chủ đang bảo trì",
            "Bản nháp vẫn được lưu. Hãy đăng sau.",
          );
          return;
        }
      } catch {
        SonnerWarning(
          "Không kết nối được máy chủ",
          "Bản nháp vẫn được lưu. Thử lại khi có mạng.",
        );
        return;
      }

      // Chờ blob encode xong nếu vừa chụp (preview dataURL trước, file sau)
      let file = selectedFile || usePostStore.getState().selectedFile;
      if (!file && preview?.data?.startsWith("data:")) {
        try {
          const res = await fetch(preview.data);
          const blob = await res.blob();
          file = new File([blob], "locket_dio.jpg", {
            type: blob.type || "image/jpeg",
          });
          usePostStore.getState().setMediaFromFile(file);
        } catch {
          /* fall through */
        }
      }
      if (!file) {
        SonnerWarning(t("home.no_data_to_upload"));
        return;
      }

      const { type: previewType } = preview || {};
      const isImage = previewType === "image";
      const isVideo = previewType === "video";
      const maxFileSize = isImage ? maxImageSizeMB : maxVideoSizeMB;

      if (isVideo && isSizeMedia < 0.2) {
        SonnerWarning(t("home.video_invalid_error"));
        return;
      }
      if (hasNoData) {
        SonnerInfo(t("home.user_data_not_found"), t("home.click_to_refresh"), {
          action: {
            label: t("home.refresh"),
            onClick: () => {
              reloadUser();
            },
          },
        );
        return;
      }
      if (isSizeMedia > maxFileSize) {
        const typeStr = isImage
          ? t("left.image_loading").toLowerCase().includes("tải")
            ? "Ảnh"
            : "Image"
          : "Video";
        SonnerWarning(
          t("home.upgrade_limit_notice"),
          t("home.size_exceeded_error", { type: typeStr, limit: maxFileSize }),
          {
            action: {
              label: t("home.upgrade"),
              onClick: () => {
                navigate("/pricing");
              },
            },
          },
        );
        return;
      }

      try {
        // Bắt đầu loading
        setUploadLoading(true);
        setIsSuccess(false);

        // Flush draft meta + mark posting (do NOT delete draft yet)
        const draftId = useMomentDraftStore.getState().activeDraftId;
        try {
          await useMomentDraftStore.getState().flushMetaSave();
          await useMomentDraftStore.getState().markPosting(draftId);
        } catch {
          /* draft optional */
        }

        // Tạo payload
        const payload = await services.createRequestPayloadV6();

        if (!payload) {
          throw new Error(t("home.payload_failed_error"));
        }

        // Tag multi-draft id so success only removes this draft
        if (draftId) payload.draftId = draftId;

        // Persist payload before telling the user it is queued. This keeps a
        // recoverable copy even if the tab closes immediately after tapping send.
        await enqueueUploadItem(payload);

        // Kết thúc loading và hiển thị success
        setUploadLoading(false);
        setIsSuccess(true);
        // Hiển thị thông báo thành công
        SonnerSuccess(
          t("home.added_to_queue"), // Title
          t("home.processing_post"), // Body
        );
        // Reset studio UI — draft stays until API post succeeds
        setTimeout(() => {
          setIsSuccess(false);
          handleDelete();
        }, 1000);
      } catch (error) {
        setUploadLoading(false);
        setIsSuccess(false);
        try {
          await useMomentDraftStore
            .getState()
            .markEditing(useMomentDraftStore.getState().activeDraftId);
        } catch {
          /* ignore */
        }

        const errorMessage =
          error?.response?.data?.message ||
          error.message ||
          t("home.unknown_error");
        SonnerError(t("home.payload_creation_failed"), `${errorMessage}`);

        console.error("❌ Tạo payload thất bại:", error);
      }
    } finally {
      submitLockRef.current = false;
    }
  };

  const toneClass = hasNoData
    ? "sendButton--warn"
    : isTooBig
      ? "sendButton--overLimit"
      : isSuccess
        ? "sendButton--success"
        : uploadLoading || capturePending
          ? "sendButton--loading"
          : isOffline || !serverReachable
            ? "sendButton--warn"
            : "";

  return (
    <button
      type="button"
      onClick={handleSubmit}
      disabled={sendDisabled}
      aria-label={
        capturePending
          ? "Đang hoàn tất ảnh chất lượng cao"
          : isOffline
            ? "Mất mạng — không thể đăng"
            : !serverReachable
              ? "Máy chủ đang bảo trì — không thể đăng"
              : "Đăng bài"
      }
      aria-busy={uploadLoading || capturePending || undefined}
      title={
        capturePending
          ? "Đang hoàn tất ảnh chất lượng cao"
          : isOffline
            ? "Mất mạng · Bản nháp vẫn được lưu"
            : !serverReachable
              ? "Máy chủ đang bảo trì · Bản nháp vẫn được lưu"
              : undefined
      }
      className={`sendButton ${toneClass}`.trim()}
      data-send-button="true"
      data-capture-pending={capturePending ? "true" : undefined}
      data-offline={isOffline || !serverReachable ? "true" : undefined}
    >
      <UploadStatusIcon
        loading={uploadLoading || capturePending}
        success={isSuccess}
        overLimit={isTooBig}
      />
    </button>
  );
};

export default SendButton;
