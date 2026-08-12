import React, { useEffect, useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import LoadingOverlay from "@/components/uikit/Loading/LineSpinner";
import { useSelectedStore, useUploadQueueStore } from "@/stores";
import ConfirmDeleteModal from "@/components/uikit/ConfirmDeleteModal";

const isRenderableUrl = (url) =>
  typeof url === "string" &&
  (url.startsWith("https://") ||
    url.startsWith("http://") ||
    url.startsWith("blob:") ||
    url.startsWith("data:"));

/**
 * Trả preview dùng được ngay cho hàng đợi.
 * Ảnh inline có URL `inline://local`, nên phải dựng data URL từ mediaBase64
 * thay vì chờ server xử lý xong mới có URL Firebase.
 */
const getQueuePreviewUrl = (item) => {
  const media = item?.mediaInfo || {};

  const directUrl = [
    item?.clientPreviewUrl,
    media.previewUrl,
    media.publicUrl,
    media.publicURL,
    media.downloadURL,
    media.url,
  ].find(isRenderableUrl);

  if (directUrl) return directUrl;

  if (media.type !== "video" && typeof media.mediaBase64 === "string") {
    const mime = media.contentType || "image/jpeg";
    return `data:${mime};base64,${media.mediaBase64}`;
  }

  return null;
};

/**
 * Hàng đợi đăng — gọn, không chữ dài.
 * Tự retry + dọn item kẹt khi mount.
 * Xóa luôn qua ConfirmDeleteModal (chống bấm nhầm).
 */
const UploadingQueue = () => {
  const [brokenIds, setBrokenIds] = useState(() => new Set());
  const [confirmId, setConfirmId] = useState(null);
  const [confirmPreview, setConfirmPreview] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const setSelectedQueue = useSelectedStore((s) => s.setSelectedQueue);
  const setSelectedQueueId = useSelectedStore((s) => s.setSelectedQueueId);

  const uploadItems = useUploadQueueStore((s) => s.uploadItems);
  const removeUploadItemById = useUploadQueueStore((s) => s.removeUploadItemById);
  const resumeQueue = useUploadQueueStore((s) => s.resumeQueue);

  useEffect(() => {
    resumeQueue?.();
  }, [resumeQueue]);

  // Keep a completed item briefly so the green check confirms that the post
  // reached Locket. The queue store removes it after the success display delay.
  const visible = uploadItems;

  const openConfirm = (e, item) => {
    e.stopPropagation();
    setConfirmPreview({
      url: getQueuePreviewUrl(item),
      mediaType: item?.mediaInfo?.type === "video" ? "video" : "image",
    });
    setConfirmId(item.id);
  };

  const handleConfirmDelete = async () => {
    if (!confirmId || deleting) return;
    setDeleting(true);
    try {
      await removeUploadItemById(confirmId);
      setConfirmId(null);
      setConfirmPreview(null);
    } finally {
      setDeleting(false);
    }
  };

  if (visible.length === 0 && !confirmId) return null;

  return (
    <>
      {visible.length > 0 ? (
        <>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-2">
            {visible.map((item) => {
              const media = item.mediaInfo;
              const status = item.status || "uploading";
              const isVideo = media?.type === "video";
              const url = getQueuePreviewUrl(item);
              const previewBroken = brokenIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className="relative aspect-square overflow-hidden rounded-xl bg-base-300 shadow group cursor-pointer"
                  onClick={() => {
                    setSelectedQueue(item.id);
                    setSelectedQueueId(item.id);
                  }}
                >
                  {url && !previewBroken ? (
                    isVideo ? (
                      <video
                        src={url}
                        className="object-cover w-full h-full"
                        muted
                        playsInline
                        preload="metadata"
                        onError={() =>
                          setBrokenIds((prev) => new Set(prev).add(item.id))
                        }
                      />
                    ) : (
                      <img
                        src={url}
                        alt=""
                        className="object-cover w-full h-full"
                        decoding="async"
                        onError={() =>
                          setBrokenIds((prev) => new Set(prev).add(item.id))
                        }
                      />
                    )
                  ) : (
                    <div className="w-full h-full bg-base-300 skeleton" />
                  )}

                  {/* Xóa — không xóa ngay, mở confirm */}
                  <button
                    type="button"
                    className="absolute top-1 right-1 z-30 p-1.5 rounded-full bg-black/50 text-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    onClick={(e) => openConfirm(e, item)}
                    aria-label="Xóa"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>

                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-10 pointer-events-none">
                    {(status === "uploading" || status === "queued") && (
                      <LoadingOverlay color="white" />
                    )}
                    {status === "done" && (
                      <Check className="text-green-400 w-6 h-6" />
                    )}
                    {status === "failed" && (
                      <RotateCcw
                        strokeWidth={1.5}
                        className="w-10 h-10 text-error"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <hr className="my-2 border-base-300" />
        </>
      ) : null}

      <ConfirmDeleteModal
        open={confirmId != null}
        onClose={() => {
          if (!deleting) {
            setConfirmId(null);
            setConfirmPreview(null);
          }
        }}
        onConfirm={handleConfirmDelete}
        loading={deleting}
        title="Bạn chắc chắn muốn xóa bài này?"
        description="Hành động này có thể không hoàn tác được."
        keepLabel="Giữ lại"
        deleteLabel="Xóa bài"
        loadingLabel="Đang xóa…"
        previewUrl={confirmPreview?.url || null}
        mediaType={confirmPreview?.mediaType || "image"}
      />
    </>
  );
};

export default UploadingQueue;
