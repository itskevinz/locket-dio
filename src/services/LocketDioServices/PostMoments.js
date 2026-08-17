import api from "@/libs/axios";
import { reconcilePostedMedia } from "@/utils/upload/reconcilePostedMedia";
import { addNotification } from "@/services/NotificationCenterService";

function resolveClientUploadId(payload) {
  const explicit = String(payload?.clientUploadId || "").trim();
  if (explicit) return explicit;

  // Old IndexedDB queue entries created before clientUploadId existed still have
  // a stable Dexie id (or draft id). Reuse it so retries after this upgrade are
  // also protected from duplicate posts.
  if (payload?.id !== undefined && payload?.id !== null) {
    return `legacy-${payload.id}`;
  }
  if (payload?.draftId) return `draft-${payload.draftId}`;
  return "";
}

function notificationUploadKey(payload) {
  return (
    resolveClientUploadId(payload) ||
    String(payload?.draftId || payload?.id || "") ||
    "current"
  );
}

function postTypeLabel(payload) {
  return payload?.mediaInfo?.type === "video" ? "video" : "ảnh";
}

function postErrorMessage(error) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.error?.message ||
    error?.message ||
    "Không thể đăng bài lên Locket."
  );
}

function recordPostSuccess(payload) {
  addNotification({
    type: "post",
    title: "Đăng bài thành công",
    message: `${postTypeLabel(payload)} đã được gửi lên Locket.`,
    level: "success",
    actionUrl: "/",
    dedupeKey: `post:${notificationUploadKey(payload)}:success`,
    dedupeWindowMs: 24 * 60 * 60 * 1000,
  });
}

function recordPostFailure(payload, error) {
  addNotification({
    type: "post",
    title: "Đăng bài thất bại",
    message: postErrorMessage(error),
    level: "error",
    actionUrl: "/",
    dedupeKey: `post:${notificationUploadKey(payload)}:failed`,
    dedupeWindowMs: 5 * 60 * 1000,
    meta: {
      status: error?.response?.status || null,
      code: error?.response?.data?.code || error?.code || null,
    },
  });
}

function emitUploadProgress(payload, progressEvent, phase = "uploading") {
  if (typeof window === "undefined") return;
  const loaded = Number(progressEvent?.loaded || 0);
  const total = Number(progressEvent?.total || 0);
  const progress = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const rate = Number(progressEvent?.rate || 0);
  const estimated = Number(progressEvent?.estimated || 0);
  window.dispatchEvent(
    new CustomEvent("huy-locket-upload-progress", {
      detail: {
        id:
          payload?.id ||
          resolveClientUploadId(payload) ||
          payload?.draftId ||
          "",
        draftId: payload?.draftId || "",
        loaded,
        total,
        progress,
        speedBps: rate > 0 ? rate : null,
        estimatedSeconds: estimated > 0 ? estimated : null,
        phase,
        at: Date.now(),
      },
    }),
  );
}

function requestTimeout(payload) {
  const type = payload?.mediaInfo?.type || payload?.contentType;
  // Video processing includes transcode + thumbnail on the API, so a normal
  // 45s request timeout can abort a post that actually succeeds upstream.
  return type === "video" ? 180000 : 90000;
}

function uploadConfig(payload) {
  const clientUploadId = resolveClientUploadId(payload);
  return {
    timeout: requestTimeout(payload),
    // Gateway retries are only safe when the backend can deduplicate this key.
    safeToRetry: Boolean(clientUploadId),
    _gatewayRetryMax: clientUploadId ? 2 : 0,
    skipErrorToast: true,
    headers: clientUploadId
      ? { "Idempotency-Key": clientUploadId }
      : undefined,
    onUploadProgress: (event) => emitUploadProgress(payload, event, "uploading"),
  };
}

function emitServerProcessing(payload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("huy-locket-upload-progress", {
      detail: {
        id:
          payload?.id ||
          resolveClientUploadId(payload) ||
          payload?.draftId ||
          "",
        draftId: payload?.draftId || "",
        progress: 100,
        phase: "processing",
        at: Date.now(),
      },
    }),
  );
}

export const uploadMediaV2 = async (payload) => {
  const { mediaInfo } = payload;
  const fileType = mediaInfo.type;
  const timeoutDuration =
    fileType === "image" ? 5000 : fileType === "video" ? 10000 : 5000;

  const timeoutId = setTimeout(() => {
    console.log("⏳ Uploading is taking longer than expected...");
  }, timeoutDuration);

  try {
    const response = await api.post(
      "/locket/postMomentV2",
      payload,
      uploadConfig(payload),
    );
    emitServerProcessing(payload);
    reconcilePostedMedia(payload, response.data);
    recordPostSuccess(payload);
    console.log("✅ Upload thành công:", response.data);
    return response.data;
  } catch (error) {
    recordPostFailure(payload, error);
    console.error("❌ Lỗi khi upload:", error.response?.data || error.message);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const PostMoments = async (payload) => {
  try {
    const response = await api.post(
      "/locket/postMomentV2",
      payload,
      uploadConfig(payload),
    );
    emitServerProcessing(payload);

    // The queue examines payload.mediaInfo again after this promise resolves.
    // Preserve the permanent API URLs before it builds the optimistic moment.
    reconcilePostedMedia(payload, response.data);
    recordPostSuccess(payload);

    console.log("✅ Upload thành công:", response.data);
    return response.data;
  } catch (error) {
    recordPostFailure(payload, error);
    console.error("❌ Lỗi khi upload:", error.response?.data || error.message);
    throw error;
  }
};
