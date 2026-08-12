/**
 * Multi-draft offline library — IndexedDB only (no base64 / localStorage media).
 */

import momentDraftDB from "@/cache/momentDraftDB";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";
import {
  MAX_DRAFT_IMAGE_MB,
  MAX_DRAFT_VIDEO_MB,
  sanitizeOverlayForDraft,
  serializeMusicFromOverlay,
} from "./serialize";

export const DRAFT_SCHEMA_VERSION = 4;

/** UI / store statuses */
export const DRAFT_STATUS = {
  PENDING: "pending", // Chưa đăng
  READY: "ready", // Sẵn sàng đăng
  POSTING: "posting", // Đang đăng
  FAILED: "failed", // Đăng thất bại
};

/** Cloud sync status (IndexedDB queue) */
export const SYNC_STATUS = {
  LOCAL_ONLY: "local_only",
  PENDING_SYNC: "pending_sync",
  SYNCING: "syncing",
  SYNCED: "synced",
  SYNC_FAILED: "sync_failed",
  CONFLICT: "conflict",
  PENDING_DELETE: "pending_delete",
  UPLOADING_POST: "uploading_post",
};

export function syncStatusLabel(syncStatus) {
  switch (syncStatus) {
    case SYNC_STATUS.SYNCED:
      return "Đã lưu vào tài khoản";
    case SYNC_STATUS.SYNCING:
      return "Đang đồng bộ…";
    case SYNC_STATUS.SYNC_FAILED:
      return "Đồng bộ thất bại · Thử lại";
    case SYNC_STATUS.CONFLICT:
      return "Xung đột phiên bản";
    case SYNC_STATUS.PENDING_DELETE:
      return "Chờ xóa trên tài khoản";
    case SYNC_STATUS.UPLOADING_POST:
      return "Đang đăng…";
    case SYNC_STATUS.PENDING_SYNC:
    case SYNC_STATUS.LOCAL_ONLY:
    default:
      return "Chưa đồng bộ";
  }
}

export function resolveDraftUid(user = null) {
  const id = getMyLocalId(user);
  return id ? String(id) : "";
}

export function newDraftId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId() {
  try {
    const k = "hl_draft_device_id";
    let id = localStorage.getItem(k);
    if (!id) {
      id = newDraftId();
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

export async function requestDraftPersist() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* best effort */
  }
}

export async function estimateStorage() {
  try {
    if (!navigator.storage?.estimate) {
      return { usage: 0, quota: 0, remaining: Infinity };
    }
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return {
      usage,
      quota,
      remaining: Math.max(0, quota - usage),
    };
  } catch {
    return { usage: 0, quota: 0, remaining: Infinity };
  }
}

export function checkDraftMediaSize(file) {
  if (!file) return { ok: false, reason: "missing" };
  const mb = (file.size || 0) / (1024 * 1024);
  const isVideo =
    (file.type && String(file.type).startsWith("video/")) ||
    /\.(mp4|webm|mov|m4v|3gp)$/i.test(file.name || "");
  const max = isVideo ? MAX_DRAFT_VIDEO_MB : MAX_DRAFT_IMAGE_MB;
  if (mb > max) {
    return {
      ok: false,
      reason: "too-large",
      message: `File quá lớn để lưu bản nháp (tối đa ~${max}MB).`,
      mb,
      max,
      isVideo,
    };
  }
  return { ok: true, mb, max, isVideo };
}

export async function ensureStorageForFile(file) {
  const sizeCheck = checkDraftMediaSize(file);
  if (!sizeCheck.ok) return sizeCheck;

  const { remaining, quota } = await estimateStorage();
  // Need file size + ~2MB headroom; if quota unknown skip check
  if (quota > 0 && remaining < (file.size || 0) + 2 * 1024 * 1024) {
    return {
      ok: false,
      reason: "quota",
      message: "Thiết bị không đủ dung lượng để lưu bản nháp này",
    };
  }
  return sizeCheck;
}

async function readMediaDimensions(file, isVideo) {
  try {
    if (isVideo) {
      const url = URL.createObjectURL(file);
      try {
        return await new Promise((resolve) => {
          const v = document.createElement("video");
          v.preload = "metadata";
          v.onloadedmetadata = () =>
            resolve({
              width: v.videoWidth || null,
              height: v.videoHeight || null,
              duration: Number.isFinite(v.duration) ? v.duration : null,
            });
          v.onerror = () =>
            resolve({ width: null, height: null, duration: null });
          v.src = url;
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () =>
          resolve({
            width: img.naturalWidth || null,
            height: img.naturalHeight || null,
            duration: null,
          });
        img.onerror = () =>
          resolve({ width: null, height: null, duration: null });
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return { width: null, height: null, duration: null };
  }
}

/** Small JPEG thumb for list — does not alter original mediaBlob */
export async function makeThumbnailBlob(file, isVideo) {
  try {
    if (isVideo) {
      const url = URL.createObjectURL(file);
      try {
        const blob = await new Promise((resolve) => {
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.preload = "metadata";
          const done = (b) => resolve(b);
          v.onloadeddata = () => {
            try {
              v.currentTime = Math.min(0.2, (v.duration || 1) * 0.05);
            } catch {
              /* ignore */
            }
          };
          v.onseeked = () => {
            try {
              const w = 240;
              const h = Math.max(
                1,
                Math.round((v.videoHeight / (v.videoWidth || 1)) * w),
              );
              const c = document.createElement("canvas");
              c.width = w;
              c.height = h || w;
              c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
              c.toBlob((b) => done(b), "image/jpeg", 0.72);
            } catch {
              done(null);
            }
          };
          v.onerror = () => done(null);
          v.src = url;
        });
        return blob;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            const max = 240;
            const scale = Math.min(1, max / Math.max(img.naturalWidth, 1));
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.naturalWidth * scale));
            c.height = Math.max(1, Math.round(img.naturalHeight * scale));
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            c.toBlob((b) => resolve(b), "image/jpeg", 0.72);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

export function collectMetaFromStores({
  overlayData,
  audience,
  selectedRecipients,
  selectedGroupId,
  videoCropData,
  restoreStreakData,
  enhancement = null,
  originalMediaBlob = null,
} = {}) {
  const sanitized = sanitizeOverlayForDraft(overlayData || {});
  const music =
    sanitized.type === "music"
      ? serializeMusicFromOverlay(sanitized.payload)
      : null;
  return {
    caption: sanitized.caption || sanitized.text || "",
    captionStyle: {
      overlay_id: sanitized.overlay_id || "standard",
      text_color: sanitized.text_color || "#FFFFFF",
      background: sanitized.background || {},
      color_top: sanitized.color_top || "",
      color_bottom: sanitized.color_bottom || "",
      type: sanitized.type || "default",
      icon: sanitized.icon || {},
    },
    music,
    overlays: sanitized,
    audience: audience || "all",
    selectedFriendIds: Array.isArray(selectedRecipients)
      ? selectedRecipients.slice()
      : [],
    optionsData: {
      caption: sanitized.caption || sanitized.text || "",
      text: sanitized.text || sanitized.caption || "",
      type: sanitized.type || "default",
      payload: sanitized.payload || {},
      icon: sanitized.icon || {},
      background: sanitized.background || {},
      text_color: sanitized.text_color || "#FFFFFF",
      overlay_id: sanitized.overlay_id || "standard",
      selectedGroupId: selectedGroupId || null,
      restoreStreakData: restoreStreakData || null,
      videoCropData: videoCropData || null,
    },
    // Optional AI enhance (ignored by older clients)
    enhancement: enhancement || null,
    originalMediaBlob:
      originalMediaBlob instanceof Blob ? originalMediaBlob : null,
  };
}

/**
 * Create a brand-new draft (new UUID). Never overwrites another draft.
 */
export async function createDraft({ ownerUid, file, meta = {} } = {}) {
  if (!ownerUid || !file) return { error: "missing" };

  const space = await ensureStorageForFile(file);
  if (!space.ok) {
    return {
      error: space.reason,
      message:
        space.message ||
        "Thiết bị không đủ dung lượng để lưu bản nháp này",
    };
  }

  await requestDraftPersist();
  const isVideo = Boolean(space.isVideo);
  const dims = await readMediaDimensions(file, isVideo);
  const thumb = await makeThumbnailBlob(file, isVideo);
  const id = newDraftId();
  const now = Date.now();
  const mediaBlob =
    file instanceof Blob ? file : new Blob([file], { type: file.type });

  const row = {
    id,
    ownerUid: String(ownerUid),
    schemaVersion: DRAFT_SCHEMA_VERSION,
    revision: 1,
    baseRevision: 0,
    createdAt: now,
    updatedAt: now,
    mediaType: isVideo ? "video" : "image",
    caption: meta.caption || "",
    captionStyle: meta.captionStyle || null,
    music: meta.music || null,
    overlays: meta.overlays || null,
    audience: meta.audience || "all",
    selectedFriendIds: meta.selectedFriendIds || [],
    optionsData: meta.optionsData || {},
    status: meta.status || DRAFT_STATUS.READY,
    lastError: null,
    uploadAttempts: 0,
    mimeType: file.type || (isVideo ? "video/mp4" : "image/jpeg"),
    fileName: file.name || (isVideo ? "draft.mp4" : "draft.jpg"),
    width: dims.width,
    height: dims.height,
    duration: dims.duration,
    enhancement: meta.enhancement || null,
    syncStatus: SYNC_STATUS.PENDING_SYNC,
    lastSyncError: null,
    sourceDeviceId: getDeviceId(),
    cloudRevision: null,
  };

  const originalBlob =
    meta.originalMediaBlob instanceof Blob ? meta.originalMediaBlob : null;

  try {
    await momentDraftDB.transaction(
      "rw",
      momentDraftDB.drafts,
      momentDraftDB.draftBlobs,
      async () => {
        await momentDraftDB.drafts.put(row);
        await momentDraftDB.draftBlobs.put({
          id,
          mediaBlob,
          thumbnailBlob: thumb || null,
          originalMediaBlob: originalBlob,
          mimeType: row.mimeType,
          fileName: row.fileName,
        });
      },
    );
    return { id, draft: row };
  } catch (err) {
    if (err?.name === "QuotaExceededError" || err?.code === 22) {
      return {
        error: "quota",
        message: "Thiết bị không đủ dung lượng để lưu bản nháp này",
      };
    }
    console.error("[draft-lib] create failed", err);
    return { error: "save-failed", message: err?.message };
  }
}

/** Update media blob for an existing draft (same id). */
export async function updateDraftMedia(draftId, file, metaPatch = {}) {
  if (!draftId || !file) return { error: "missing" };
  const space = await ensureStorageForFile(file);
  if (!space.ok) {
    return {
      error: space.reason,
      message:
        space.message ||
        "Thiết bị không đủ dung lượng để lưu bản nháp này",
    };
  }
  const prev = await momentDraftDB.drafts.get(draftId);
  if (!prev) return { error: "not-found" };

  const isVideo = Boolean(space.isVideo);
  const dims = await readMediaDimensions(file, isVideo);
  const thumb = await makeThumbnailBlob(file, isVideo);
  const mediaBlob =
    file instanceof Blob ? file : new Blob([file], { type: file.type });
  const now = Date.now();

  try {
    await momentDraftDB.transaction(
      "rw",
      momentDraftDB.drafts,
      momentDraftDB.draftBlobs,
      async () => {
        await momentDraftDB.drafts.put({
          ...prev,
          ...metaPatch,
          id: draftId,
          mediaType: isVideo ? "video" : "image",
          mimeType: file.type || prev.mimeType,
          fileName: file.name || prev.fileName,
          width: dims.width,
          height: dims.height,
          duration: dims.duration,
          updatedAt: now,
          status: metaPatch.status || DRAFT_STATUS.READY,
          lastError: null,
          enhancement:
            metaPatch.enhancement !== undefined
              ? metaPatch.enhancement
              : prev.enhancement || null,
          syncStatus:
            metaPatch.syncStatus ||
            (prev.syncStatus === SYNC_STATUS.PENDING_DELETE
              ? SYNC_STATUS.PENDING_DELETE
              : SYNC_STATUS.PENDING_SYNC),
          lastSyncError: null,
          revision: (prev.revision || 1) + 1,
        });
        const prevBlobs = await momentDraftDB.draftBlobs.get(draftId);
        const keepOriginal =
          metaPatch.originalMediaBlob instanceof Blob
            ? metaPatch.originalMediaBlob
            : prevBlobs?.originalMediaBlob || null;
        await momentDraftDB.draftBlobs.put({
          id: draftId,
          mediaBlob,
          thumbnailBlob: thumb || null,
          originalMediaBlob: keepOriginal,
          mimeType: file.type || prev.mimeType,
          fileName: file.name || prev.fileName,
        });
      },
    );
    return { id: draftId, ok: true };
  } catch (err) {
    if (err?.name === "QuotaExceededError") {
      return {
        error: "quota",
        message: "Thiết bị không đủ dung lượng để lưu bản nháp này",
      };
    }
    return { error: "save-failed", message: err?.message };
  }
}

/** Fields that only track cloud queue — do not bump content revision. */
const SYNC_CONTROL_KEYS = new Set([
  "syncStatus",
  "lastSyncError",
  "cloudRevision",
  "baseRevision",
  "mediaUrls",
  "sourceDeviceId",
]);

export async function updateDraftMeta(draftId, partial = {}) {
  if (!draftId) return { error: "missing" };
  try {
    const prev = await momentDraftDB.drafts.get(draftId);
    if (!prev) return { error: "not-found" };
    const keys = Object.keys(partial || {});
    const contentChanged = keys.some((k) => !SYNC_CONTROL_KEYS.has(k));
    const next = {
      ...prev,
      ...partial,
      id: draftId,
      ownerUid: prev.ownerUid,
      updatedAt: Date.now(),
      // Content edits bump revision; pure sync-status writes do not (avoids false conflicts).
      revision: contentChanged
        ? (prev.revision || 1) + 1
        : prev.revision || 1,
      syncStatus:
        partial.syncStatus !== undefined && partial.syncStatus !== null
          ? partial.syncStatus
          : prev.syncStatus === SYNC_STATUS.PENDING_DELETE
            ? SYNC_STATUS.PENDING_DELETE
            : contentChanged
              ? SYNC_STATUS.PENDING_SYNC
              : prev.syncStatus || SYNC_STATUS.PENDING_SYNC,
      lastSyncError:
        partial.lastSyncError !== undefined
          ? partial.lastSyncError
          : contentChanged
            ? null
            : prev.lastSyncError ?? null,
    };
    if (partial.overlays) {
      next.overlays = sanitizeOverlayForDraft(partial.overlays);
    }
    if (partial.optionsData) {
      next.optionsData = {
        ...(prev.optionsData || {}),
        ...partial.optionsData,
      };
    }
    await momentDraftDB.drafts.put(next);
    return { ok: true, draft: next };
  } catch (err) {
    if (err?.name === "QuotaExceededError") {
      return {
        error: "quota",
        message: "Thiết bị không đủ dung lượng để lưu bản nháp này",
      };
    }
    return { error: "update-failed", message: err?.message };
  }
}

/** List metadata only (no mediaBlob). Newest by createdAt first. */
export async function listDraftsMeta(ownerUid) {
  if (!ownerUid) return [];
  try {
    const rows = await momentDraftDB.drafts
      .where("ownerUid")
      .equals(String(ownerUid))
      .toArray();
    // Ẩn bản đang chờ xóa cloud (tránh “mất” / ghost trên thiết bị khác)
    const visible = rows.filter(
      (r) => r && r.syncStatus !== SYNC_STATUS.PENDING_DELETE,
    );
    visible.sort(
      (a, b) =>
        (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0),
    );
    return visible;
  } catch (e) {
    console.error("[draft-lib] list failed", e);
    return [];
  }
}

export async function getDraftMeta(draftId) {
  if (!draftId) return null;
  try {
    return (await momentDraftDB.drafts.get(draftId)) || null;
  } catch {
    return null;
  }
}

/** Full draft + media for edit/post */
export async function getDraftFull(draftId) {
  if (!draftId) return null;
  try {
    const meta = await momentDraftDB.drafts.get(draftId);
    if (!meta) return null;
    const blobs = await momentDraftDB.draftBlobs.get(draftId);
    if (!blobs?.mediaBlob || !(blobs.mediaBlob instanceof Blob)) {
      return { meta, media: null, corrupt: true };
    }
    return {
      meta,
      media: {
        blob: blobs.mediaBlob,
        thumbnailBlob: blobs.thumbnailBlob || null,
        originalMediaBlob: blobs.originalMediaBlob || null,
        mimeType: blobs.mimeType || meta.mimeType,
        fileName: blobs.fileName || meta.fileName,
      },
      corrupt: false,
    };
  } catch (e) {
    console.error("[draft-lib] get full failed", e);
    return null;
  }
}

/** Thumbnail only for list row */
export async function getDraftThumbnailBlob(draftId) {
  if (!draftId) return null;
  try {
    const blobs = await momentDraftDB.draftBlobs.get(draftId);
    return blobs?.thumbnailBlob || null;
  } catch {
    return null;
  }
}

/** Full media blob only (lazy near-viewport / edit) — never base64 */
export async function getDraftMediaBlob(draftId) {
  if (!draftId) return null;
  try {
    const blobs = await momentDraftDB.draftBlobs.get(draftId);
    if (blobs?.mediaBlob instanceof Blob) return blobs.mediaBlob;
    return null;
  } catch {
    return null;
  }
}

export async function deleteDraft(draftId) {
  if (!draftId) return false;
  try {
    await momentDraftDB.transaction(
      "rw",
      momentDraftDB.drafts,
      momentDraftDB.draftBlobs,
      async () => {
        await momentDraftDB.drafts.delete(draftId);
        await momentDraftDB.draftBlobs.delete(draftId);
      },
    );
    return true;
  } catch (e) {
    console.error("[draft-lib] delete failed", e);
    return false;
  }
}

/** Stuck "posting" after crash → failed (keep media, no auto-post) */
export async function resetStuckPostingDrafts(ownerUid) {
  if (!ownerUid) return 0;
  const rows = await listDraftsMeta(ownerUid);
  let n = 0;
  for (const d of rows) {
    if (d.status === DRAFT_STATUS.POSTING) {
      await updateDraftMeta(d.id, {
        status: DRAFT_STATUS.FAILED,
        lastError: "Upload bị gián đoạn — thử lại khi có mạng.",
      });
      n += 1;
    }
  }
  return n;
}

export function draftMediaToFile(media, meta = {}) {
  if (!media?.blob || media.blob.size === 0) return null;
  const type =
    media.mimeType || media.blob.type || "application/octet-stream";
  const name =
    media.fileName ||
    meta.fileName ||
    (String(type).startsWith("video/") ? "draft.mp4" : "draft.jpg");
  try {
    return new File([media.blob], name, {
      type,
      lastModified: meta.createdAt || Date.now(),
    });
  } catch {
    const blob = media.blob.slice(0, media.blob.size, type);
    blob.name = name;
    return blob;
  }
}

/** Absolute clock for older drafts (legacy helper). */
export function formatDraftSavedAt(ts) {
  try {
    const d = new Date(ts || Date.now());
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  } catch {
    return "";
  }
}

/**
 * Relative time from createdAt (not last edit).
 * <1m Vừa xong · <60m x phút · <24h x giờ · else day + time
 */
export function formatDraftCreatedAt(ts) {
  try {
    const created = Number(ts);
    if (!Number.isFinite(created) || created <= 0) return "";
    const now = Date.now();
    const diff = Math.max(0, now - created);
    const min = Math.floor(diff / 60000);
    const hour = Math.floor(diff / 3600000);

    if (min < 1) return "Vừa xong";
    if (min < 60) return `${min} phút trước`;
    if (hour < 24) return `${hour} giờ trước`;

    const d = new Date(created);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    const pad = (n) => String(n).padStart(2, "0");
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const sameDay = (a, b) =>
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();

    if (sameDay(d, yesterday)) return `Hôm qua, ${time}`;
    if (sameDay(d, today)) return time;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}, ${time}`;
  } catch {
    return "";
  }
}

/** Status line under draft preview cards */
export function formatDraftStatusLine(draft) {
  if (!draft) return "Chưa đăng";
  if (draft.status === DRAFT_STATUS.FAILED) {
    return "Đăng thất bại · Nhấn để thử lại";
  }
  if (draft.status === DRAFT_STATUS.POSTING) {
    return "Đang đăng…";
  }
  const sync = syncStatusLabel(draft.syncStatus);
  const when = formatDraftCreatedAt(draft.createdAt || draft.updatedAt);
  return when ? `${sync} · ${when}` : sync;
}

export function statusLabel(status) {
  switch (status) {
    case DRAFT_STATUS.POSTING:
      return "Đang đăng";
    case DRAFT_STATUS.FAILED:
      return "Đăng thất bại";
    case DRAFT_STATUS.READY:
      return "Sẵn sàng đăng";
    case DRAFT_STATUS.PENDING:
    default:
      return "Chưa đăng";
  }
}
