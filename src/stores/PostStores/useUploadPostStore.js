import { create } from "zustand";
import {
  SonnerError,
  SonnerSuccess,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";
import { PostMoments } from "@/services";
import { normalizeMoment } from "@/utils";
import { overlayFromOptionsData } from "@/utils/standardize/normalizeMoments";
import { useStreakStore } from "@/stores/StreakStores";
import { useMomentsStoreV2 } from "@/stores/MomentStores";
import { logWebUserAction } from "@/services/UserActivityService";
import {
  classifyUploadFailure,
  rateLimitCooldownRemaining,
  shouldAutoRetryUpload,
  shouldResumeAfterReconnect,
  UPLOAD_DONE_DISPLAY_MS,
  UPLOAD_QUEUE_ERROR,
} from "./uploadQueuePolicy";

import {
  saveUploadItemToDB,
  updateUploadItemInDB,
  deleteUploadItemFromDB,
  getUploadItemFromDB,
  loadUploadItemsByStatus,
  loadAllUploadItems,
  getPostedMoments,
  savePostedMomentToDB,
} from "../../cache/uploadMomentDB";

export const STATUS_UPLOAD_MOMENT = {
  QUEUED: "queued",
  UPLOADING: "uploading",
  DONE: "done",
  FAILED: "failed",
};

const QUEUE_SESSION_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `queue-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const isOnline = () =>
  typeof navigator === "undefined" || navigator.onLine !== false;

const formatCooldown = (milliseconds) => {
  const seconds = Math.max(1, Math.ceil(milliseconds / 1000));
  return seconds < 60
    ? `${seconds} giây`
    : `${Math.ceil(seconds / 60)} phút`;
};

const isUsableMediaUrl = (value) =>
  typeof value === "string" &&
  /^(https?:|blob:|data:)/i.test(value) &&
  !/^inline:\/\//i.test(value);

const firstUsableMediaUrl = (...values) =>
  values.find(isUsableMediaUrl) || null;

export const useUploadQueueStore = create((set, get) => ({
  uploadItems: [],
  postedMoments: [],
  isQueueRunning: false,

  /* ================= INIT / LOAD ================= */

  hydrateUploadQueue: async () => {
    const items = await loadAllUploadItems();

    const safeItems = [];
    for (const stored of items) {
      if (!stored?.id) continue;

      if (stored.status === STATUS_UPLOAD_MOMENT.DONE) {
        await deleteUploadItemFromDB(stored.id);
        continue;
      }

      const isInterruptedPreviousSession =
        stored.queueSessionId !== QUEUE_SESSION_ID &&
        (stored.status === STATUS_UPLOAD_MOMENT.QUEUED ||
          stored.status === STATUS_UPLOAD_MOMENT.UPLOADING);

      if (isInterruptedPreviousSession) {
        const patch = {
          status: STATUS_UPLOAD_MOMENT.FAILED,
          errorCode: "PAUSED_AFTER_RELOAD",
          errorMessage:
            "Bài đăng đã được tạm dừng sau khi tải lại trang. Bấm Thử lại khi bạn sẵn sàng.",
        };
        await updateUploadItemInDB(stored.id, patch);
        safeItems.push({ ...stored, ...patch });
        continue;
      }

      safeItems.push(stored);
    }

    // sort mới → cũ cho UI
    safeItems.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    set({ uploadItems: safeItems });

    const posted = await getPostedMoments();
    set({ postedMoments: posted });

    // Chỉ tiếp tục item thuộc phiên hiện tại; item từ phiên trước chờ người dùng xác nhận.
    await get().resumeQueue();
  },

  /**
   * Tiếp tục hàng đợi của phiên hiện tại. Chỉ lỗi mạng cùng phiên mới được
   * tự đưa lại vào queue; các lỗi khác luôn chờ người dùng bấm Thử lại.
   */
  resumeQueue: async () => {
    if (!isOnline()) return false;

    for (const item of [...get().uploadItems]) {
      if (
        item.status === STATUS_UPLOAD_MOMENT.FAILED &&
        shouldResumeAfterReconnect(item, QUEUE_SESSION_ID)
      ) {
        await get().updateUploadItem(item.id, {
          status: STATUS_UPLOAD_MOMENT.QUEUED,
          retryCount: Number(item.retryCount || 0) + 1,
          lastTried: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
        });
      }
    }

    const hasQueued = get().uploadItems.some(
      (item) =>
        item.status === STATUS_UPLOAD_MOMENT.QUEUED &&
        item.queueSessionId === QUEUE_SESSION_ID,
    );
    if (hasQueued) {
      await get().runQueue();
    }
    return hasQueued;
  },

  enqueueUploadItem: async (data) => {
    const item = {
      ...data,
      status: STATUS_UPLOAD_MOMENT.QUEUED,
      createdAt: new Date().toISOString(),
      retryCount: 0,
      queueSessionId: QUEUE_SESSION_ID,
    };

    set((s) => ({ uploadItems: [item, ...s.uploadItems] }));
    await saveUploadItemToDB(item);
    get().runQueue();
  },

  retryUploadItem: async (itemId) => {
    if (!isOnline()) {
      SonnerWarning(
        "Chưa có kết nối mạng",
        "Bài đăng vẫn được giữ lại. Hãy thử lại khi có mạng.",
      );
      return false;
    }

    const current = get().uploadItems.find((i) => i.id === itemId);
    const cooldown = rateLimitCooldownRemaining(current);
    if (cooldown > 0) {
      SonnerWarning(
        "Đang tạm dừng đăng bài",
        `Máy chủ đang giới hạn yêu cầu. Thử lại sau ${formatCooldown(cooldown)}.`,
      );
      return false;
    }

    await get().updateUploadItem(itemId, {
      status: STATUS_UPLOAD_MOMENT.QUEUED,
      lastTried: new Date().toISOString(),
      retryCount: 0,
      queueSessionId: QUEUE_SESSION_ID,
      errorCode: null,
      errorMessage: null,
    });
    await get().runQueue();
    return true;
  },

  /* ================= WORKER ================= */

  runQueue: async () => {
    if (get().isQueueRunning || !isOnline()) return false;
    set({ isQueueRunning: true });

    try {
      let item;
      while (
        (item = (await loadUploadItemsByStatus(STATUS_UPLOAD_MOMENT.QUEUED))[0])
      ) {
        if (!isOnline()) break;
        if (item.queueSessionId !== QUEUE_SESSION_ID) {
          await get().updateUploadItem(item.id, {
            status: STATUS_UPLOAD_MOMENT.FAILED,
            errorCode: "PAUSED_AFTER_RELOAD",
            errorMessage:
              "Bài đăng đã được tạm dừng sau khi tải lại trang. Bấm Thử lại khi bạn sẵn sàng.",
          });
          continue;
        }
        await get().uploadSingleItem(item);
      }
    } finally {
      set({ isQueueRunning: false });
    }
    return true;
  },

  uploadSingleItem: async (item) => {
    await get().updateUploadItem(item.id, {
      status: STATUS_UPLOAD_MOMENT.UPLOADING,
      lastTried: new Date().toISOString(),
    });

    try {
      const res = await PostMoments(item);
      // API body: { success, data: locketMoment } — hỗ trợ cả hai lớp
      const raw =
        res?.data?.data && typeof res.data.data === "object"
          ? res.data.data
          : res?.data;
      let normalized = normalizeMoment(raw) || normalizeMoment(res?.data);

      const od = item?.optionsData || {};
      const media = item?.mediaInfo || {};
      // API URL thật phải được ưu tiên; tuyệt đối không dùng inline://local để render.
      const mediaUrl = firstUsableMediaUrl(
        media.type === "video" ? normalized?.video_url : null,
        normalized?.image_url,
        normalized?.thumbnail_url,
        normalized?.video_url,
        normalized?.imageUrl,
        normalized?.thumbnailUrl,
        normalized?.videoUrl,
        media.publicUrl,
        media.publicURL,
        media.downloadURL,
        media.url,
      );

      // ── Music/poll/review: LUÔN lấy overlay từ lúc đăng (Locket hay cắt response)
      const ov = overlayFromOptionsData(od);
      if (ov && (od.type === "music" || od.type === "poll" || od.type === "review" || od.type === "color_palette")) {
        const musicPayload = {
          ...(ov.payload || {}),
          ...(od.payload || {}),
          ...(od.music || {}),
        };
        const cover =
          ov.icon?.data ||
          od.icon?.data ||
          musicPayload.image_url ||
          musicPayload.image ||
          "";
        const text =
          ov.text ||
          od.text ||
          od.caption ||
          [musicPayload.song_title || musicPayload.song_name, musicPayload.artist]
            .filter(Boolean)
            .join(" · ") ||
          "";
        const musicOverlay = {
          overlay_id:
            od.type === "music" ? "caption:music" : ov.overlay_id || od.overlay_id,
          overlay_type: "caption",
          type: od.type === "music" ? "music" : ov.type || od.type,
          text,
          caption: text,
          text_color: od.text_color || "#FFFFFFE6",
          payload: musicPayload,
          icon: cover
            ? { type: "image", data: cover, source: "url" }
            : ov.icon || od.icon || {},
          platform:
            od.platform ||
            (musicPayload.apple_music_url && !musicPayload.spotify_url
              ? "apple"
              : "spotify"),
          background: ov.background || {
            material_blur: "ultra_thin",
            colors: [],
          },
        };
        normalized = {
          ...(normalized || {}),
          overlays: musicOverlay,
          captions: [
            {
              text,
              text_color: "#FFFFFFE6",
              icon: musicOverlay.icon,
              type: musicOverlay.type,
              payload: musicPayload,
            },
          ],
        };
      } else if (normalized && ov && !normalized.overlays) {
        normalized = { ...normalized, overlays: ov };
      }

      // Ảnh / video URL cho feed web
      if (normalized && mediaUrl) {
        if (media.type !== "video") {
          normalized.image_url = mediaUrl;
          normalized.thumbnail_url = mediaUrl;
        } else {
          normalized.video_url = mediaUrl;
          if (media.thumbnailUrl || media.thumbnail_url) {
             normalized.thumbnail_url = media.thumbnailUrl || media.thumbnail_url;
          }
        }
      }

      // Nếu API không trả id, vẫn thử gắn id tạm để hiện feed + overlay
      if (normalized && !normalized.id) {
        const src = raw || res?.data || {};
        normalized.id =
          src.id ||
          src.canonical_uid ||
          src.momentId ||
          src.uid ||
          `local_${Date.now()}`;
      }
      // createTime để sort feed — tránh NaN đẩy bài mất
      if (normalized && !normalized.createTime) {
        normalized.createTime = Date.now();
      }

      // ❗ Validate response
      if (!normalized || !normalized.id) {
        throw new Error("INVALID_UPLOAD_RESPONSE");
      }
      await get().savePostedMoment(item, normalized);

      // Persist MomentMusic metadata when musicTrackId present
      try {
        const mp = item?.optionsData?.payload;
        if (mp?.musicTrackId && normalized?.id) {
          const { attachMomentMusic } = await import(
            "@/services/ExtensionsServices/MusicLibraryServices"
          );
          await attachMomentMusic(normalized.id, {
            musicTrackId: mp.musicTrackId,
            startTime: mp.startTime ?? 0,
            endTime: mp.endTime ?? mp.duration ?? 0,
            volume: mp.volume ?? 1,
            originalVideoVolume: mp.originalVideoVolume ?? 1,
          });
        }
      } catch (e) {
        console.warn("attachMomentMusic:", e?.message || e);
      }

      // Đẩy bài vừa đăng vào feed lịch sử ngay (không chờ socket / F5)
      try {
        await useMomentsStoreV2.getState().addNewMoment(normalized);
      } catch (e) {
        console.warn("addNewMoment after upload failed:", e);
      }

      await get().updateUploadItem(item.id, {
        status: STATUS_UPLOAD_MOMENT.DONE,
        completedAt: new Date().toISOString(),
      });

      // Draft only cleared after confirmed API success (by draftId if multi-draft)
      try {
        const { useMomentDraftStore } = await import(
          "@/stores/PostStores/useMomentDraftStore"
        );
        await useMomentDraftStore
          .getState()
          .clearAfterSuccessfulPost(item?.draftId || null);
      } catch {
        /* draft optional */
      }

      SonnerSuccess(
        "Đăng tải thành công!",
        `${
          item.contentType === "video" ? "Video" : "Hình ảnh"
        } đã được tải lên!`,
      );
      try {
        logWebUserAction({
          actionType: "MOMENT_POST",
          actionTitle: `Đăng ${item.contentType === "video" ? "Video" : "Hình ảnh"} mới lên Locket`,
          details: `Đã đăng thành công khoảnh khắc từ trình duyệt Web`,
        });
      } catch {
        /* telemetry is optional */
      }
      useStreakStore.getState().fetchStreakIfNeeded();

      get().autoCleanupItem(item.id);
    } catch (err) {
      const retries = Number(item.retryCount) || 0;

      const markDraftEditing = async () => {
        try {
          const { useMomentDraftStore } = await import(
            "@/stores/PostStores/useMomentDraftStore"
          );
          await useMomentDraftStore
            .getState()
            .markEditing(item?.draftId || null);
        } catch {
          /* draft optional */
        }
      };

      // ⚠️ Bài đăng đã tồn tại → coi như xong, xóa draft
      if (err?.response?.status === 409) {
        await get().updateUploadItem(item.id, {
          status: STATUS_UPLOAD_MOMENT.DONE,
        });

        await deleteUploadItemFromDB(item.id);
        get().removeUploadItemById(item.id);
        try {
          const { useMomentDraftStore } = await import(
            "@/stores/PostStores/useMomentDraftStore"
          );
          await useMomentDraftStore
            .getState()
            .clearAfterSuccessfulPost(item?.draftId || null);
        } catch {
          /* ignore */
        }
        SonnerWarning("Bài đăng đã tồn tại!");
        return;
      }

      const msg =
        err?.response?.data?.message || "Đăng tải thất bại, vui lòng thử lại";
      const policy = classifyUploadFailure(err, { online: isOnline() });

      await markDraftEditing();

      await get().updateUploadItem(item.id, {
        status: STATUS_UPLOAD_MOMENT.FAILED,
        errorCode: policy.code,
        errorMessage: msg,
      });

      if (shouldAutoRetryUpload(item, policy, retries)) {
        // Chỉ retry lỗi mạng/server tạm thời trong đúng phiên hiện tại.
        setTimeout(() => {
          const still = get().uploadItems.find((i) => i.id === item.id);
          if (
            still?.status === STATUS_UPLOAD_MOMENT.FAILED &&
            still?.queueSessionId === QUEUE_SESSION_ID &&
            isOnline()
          ) {
            get()
              .updateUploadItem(item.id, {
                status: STATUS_UPLOAD_MOMENT.QUEUED,
                retryCount: retries + 1,
                lastTried: new Date().toISOString(),
                errorCode: null,
                errorMessage: null,
              })
              .then(() => get().runQueue());
          }
        }, 4000);
      } else {
        const fallback =
          policy.code === UPLOAD_QUEUE_ERROR.MEDIA_EXPIRED ||
          policy.code === UPLOAD_QUEUE_ERROR.INVALID_RESPONSE
            ? "Media không còn — mở Bản nháp để chọn lại file rồi đăng."
            : `${msg} — bài vẫn được giữ trong hàng đợi để bạn thử lại.`;
        SonnerError(
          "Đăng tải thất bại!",
          fallback,
        );
      }
    }
  },

  removeUploadItemById: async (id) => {
    if (!id) return;

    // xoá DB trước
    await deleteUploadItemFromDB(id);

    // xoá store
    set((state) => ({
      uploadItems: state.uploadItems.filter((item) => item.id !== id),
    }));
  },
  /* ================= CLEANUP ================= */

  autoCleanupItem: (itemId, delay = UPLOAD_DONE_DISPLAY_MS) => {
    setTimeout(async () => {
      if (!itemId) return;
      const item = await getUploadItemFromDB(itemId);
      if (item?.status === STATUS_UPLOAD_MOMENT.DONE) {
        get().removeUploadItemById(itemId);
      }
    }, delay);
  },

  updateUploadItemInState: (id, patch) => {
    if (!id) return;

    set((state) => ({
      uploadItems: state.uploadItems.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    }));
  },

  updateUploadItem: async (id, patch) => {
    await updateUploadItemInDB(id, patch);
    get().updateUploadItemInState(id, patch);
  },

  savePostedMoment: async (payload, posted) => {
    try {
      await savePostedMomentToDB(payload, posted);

      set((state) => ({
        postedMoments: [
          {
            postId: posted.id,
            createdAt: new Date().toISOString(),
            contentType: payload.contentType,
            ...posted,
          },
          ...state.postedMoments,
        ],
      }));
    } catch (err) {
      console.error("❌ Failed to save posted moment:", err);
    }
  },
}));
