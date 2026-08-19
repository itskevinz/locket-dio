import React, { useState } from "react";
import { useMomentDraftStore, usePostStore } from "@/stores";
import { useConnectivityStore } from "@/stores/useConnectivityStore";
import { useAppCamera } from "@/context/AppContext";
import { syncDraftMediaDirect } from "@/utils/momentDraft/directDraftStorageSync";

/**
 * Compact actions after capture — does not move camera chrome.
 * Đăng ngay | Lưu bản nháp | Lưu và chụp tiếp
 */
export default function SaveDraftActions() {
  const selectedFile = usePostStore((s) => s.selectedFile);
  const preview = usePostStore((s) => s.preview);
  const hasMedia = !!(selectedFile || preview?.data);
  const isOffline = useConnectivityStore((s) => s.isOffline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const saveCurrentAsDraft = useMomentDraftStore((s) => s.saveCurrentAsDraft);
  const openLibrary = useMomentDraftStore((s) => s.openLibrary);
  const camera = useAppCamera();
  const setCameraActive = camera?.setCameraActive;
  const [busy, setBusy] = useState(false);

  if (!hasMedia) return null;

  const canPost = !isOffline && serverReachable;

  /**
   * After IndexedDB save + clear preview: re-enable live camera.
   * MediaPreview parks stream during preview (no track.stop) then reattaches.
   */
  const resumeLiveCamera = () => {
    if (import.meta.env?.DEV) {
      const stream = camera?.streamRef?.current;
      const tr = stream?.getVideoTracks?.()?.[0];
      console.info("[cam] SaveDraftActions resumeLiveCamera", {
        streamId: stream?.id,
        active: stream?.active,
        trackReadyState: tr?.readyState,
        trackEnabled: tr?.enabled,
        hasSrcObject: Boolean(camera?.videoRef?.current?.srcObject),
        cameraMode: camera?.cameraMode,
        selectedDeviceId: camera?.deviceId,
      });
    }
    setCameraActive?.(true);
  };

  const ensureCloudMedia = async (result) => {
    if (
      result?.error ||
      !result?.id ||
      isOffline ||
      serverReachable === false
    ) {
      return result;
    }

    const cloudResult = await syncDraftMediaDirect(result.id);
    if (!cloudResult?.ok) {
      console.warn(
        "[draft-storage] media remains queued for retry:",
        cloudResult?.error || "unknown",
      );
    }
    return result;
  };

  const onSave = async (clearAfter) => {
    if (busy) return;
    setBusy(true);
    try {
      if (import.meta.env?.DEV) {
        console.info("[cam] SaveDraft before draft save", { clearAfter });
      }
      const result = await saveCurrentAsDraft({ clearAfter });
      await ensureCloudMedia(result);
      if (import.meta.env?.DEV) {
        console.info("[cam] SaveDraft after IDB", {
          clearAfter,
          ok: !result?.error,
          error: result?.error || null,
        });
      }
      if (clearAfter && !result?.error) {
        // clearStudioAfterSave already ran inside saveCurrentAsDraft
        resumeLiveCamera();
      }
    } finally {
      setBusy(false);
    }
  };

  const onSaveOpenLibrary = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await saveCurrentAsDraft({ clearAfter: true });
      await ensureCloudMedia(result);
      if (!result?.error) {
        // Leaving studio for library — full camera stop handled by page/nav
        setCameraActive?.(false);
        openLibrary();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="w-full flex justify-center px-3 mb-1"
      data-save-draft-actions="true"
    >
      <div className="flex flex-wrap items-center justify-center gap-1.5 max-w-md">
        <button
          type="button"
          disabled={!canPost || busy}
          className="btn btn-xs btn-primary rounded-full disabled:opacity-40"
          title={
            canPost
              ? "Dùng nút đăng ở giữa để đăng ngay"
              : "Đang ngoại tuyến — không thể đăng ngay"
          }
          onClick={() => {
            // Focus existing send button — keep one post path
            const btn = document.querySelector('[data-send-button="true"]');
            if (btn && !btn.disabled) btn.click();
          }}
        >
          Đăng ngay
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn btn-xs btn-ghost bg-base-200 rounded-full"
          onClick={onSaveOpenLibrary}
        >
          Lưu bản nháp
        </button>
        <button
          type="button"
          disabled={busy}
          className="btn btn-xs btn-ghost bg-base-200 rounded-full"
          onClick={() => onSave(true)}
        >
          Lưu và chụp tiếp
        </button>
      </div>
    </div>
  );
}
