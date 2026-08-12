import React, { useCallback } from "react";
import { useAppCamera } from "@/context/AppContext";
import { ImageUp } from "lucide-react";
import { SonnerInfo } from "@/components/uikit/SonnerToast";
import { useMomentDraftStore, usePostStore } from "@/stores";
import { useTranslation } from "react-i18next";
import { classifyPhoneMedia } from "@/utils/imageUtils";

const UploadFile = () => {
  const { t } = useTranslation("main");
  const camera = useAppCamera();

  const resetMedia = usePostStore((s) => s.resetMedia);
  const setImageToCrop = usePostStore((s) => s.setImageToCrop);
  const setVideoToCrop = usePostStore((s) => s.setVideoToCrop);

  const { setCameraActive } = camera;

  //Handle tải file
  const handleFileChange = useCallback(async (event) => {
    setCameraActive(false);

    const rawFile = event.target.files[0];
    if (!rawFile) return;
    const fileType = classifyPhoneMedia(rawFile);

    if (!fileType) {
      SonnerInfo(t("home.only_media_supported_short"));
      return;
    }

    // Gate replace-draft before wiping studio
    const proceed = await useMomentDraftStore
      .getState()
      .requestReplaceOrContinue(rawFile);
    if (!proceed) {
      // Prompt open — do not reset yet
      event.target.value = "";
      return;
    }

    resetMedia();

    if (fileType === "image") {
      setImageToCrop(rawFile);
      event.target.value = "";
      // Crop flow will setMediaFromFile later → autosave via store subscribe
      return;
    }
    if (fileType === "video") {
      setVideoToCrop(rawFile);
      event.target.value = "";
      return;
    }
  }, [resetMedia, setCameraActive, setImageToCrop, setVideoToCrop, t]);

  return (
    <>
      <input
        type="file"
        accept="image/*,video/*"
        onChange={handleFileChange}
        className="hidden"
        id="file-upload"
      />
      <label
        htmlFor="file-upload"
        className="pillSideBtn"
        aria-label={t("home.upload_library", { defaultValue: "Thư viện" })}
        title={t("home.upload_library", { defaultValue: "Thư viện" })}
      >
        <ImageUp size={24} strokeWidth={2} />
      </label>
    </>
  );
};
export default UploadFile;
