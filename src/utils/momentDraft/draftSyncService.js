/**
 * Account draft sync — IndexedDB offline queue → Railway API.
 * Sequential uploads; never auto-posts moments.
 * Implements Single-Flight, Exponential Backoff, Token Refresh, Fast Pull.
 */
import { instanceMain } from "@/libs";
import momentDraftDB from "@/cache/momentDraftDB";
import {
  SYNC_STATUS,
  listDraftsMeta,
  getDraftFull,
  resolveDraftUid,
  getDeviceId,
  updateDraftMeta,
} from "./draftLibrary";
import { getDraftMediaRequests } from "./draftMediaUrl";

const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

// Single-flight states
let pullInFlight = null;
let pushInFlight = null;
let fullSyncInFlight = null;
let syncRequestedAgain = false;

function authOk() {
  return Boolean(resolveDraftUid());
}

/**
 * Draft-specific API wrapper with Token Refresh & Exponential Backoff
 */
async function apiDraftCall(config, attempts = 0) {
  try {
    const res = await instanceMain(config);
    return res;
  } catch (error) {
    const status = error?.response?.status;
    const isNetworkError = !error.response;
    
    // Rate limits, server errors or network drops
    const retryableStatus = [408, 425, 429, 500, 502, 503, 504].includes(status) || isNetworkError;
    
    if (retryableStatus && attempts < MAX_RETRIES) {
      let delayMs = BASE_BACKOFF_MS * Math.pow(2, attempts); // 1.5, 3, 6, 12s
      
      if (status === 429) {
        const retryAfter = error?.response?.headers?.["retry-after"];
        if (retryAfter) {
          delayMs = parseInt(retryAfter, 10) * 1000 || delayMs;
        }
      }
      
      // Add jitter up to 10%
      delayMs = delayMs + (Math.random() * 0.1 * delayMs);
      
      await new Promise(r => setTimeout(r, delayMs));
      return await apiDraftCall(config, attempts + 1);
    }
    
    throw error;
  }
}

async function listPendingLocal(ownerUid) {
  // Read raw IDB (listDraftsMeta ẩn pending_delete — vẫn cần push xóa cloud)
  let all = [];
  try {
    all = await momentDraftDB.drafts
      .where("ownerUid")
      .equals(String(ownerUid))
      .toArray();
  } catch {
    all = await listDraftsMeta(ownerUid);
  }
  return all.filter(
    (d) =>
      d.syncStatus === SYNC_STATUS.PENDING_SYNC ||
      d.syncStatus === SYNC_STATUS.SYNC_FAILED ||
      d.syncStatus === SYNC_STATUS.PENDING_DELETE ||
      !d.syncStatus,
  );
}

async function putMeta(draft) {
  const body = {
    id: draft.id,
    baseRevision: draft.cloudRevision ?? draft.baseRevision ?? null,
    mediaType: draft.mediaType,
    caption: draft.caption,
    captionStyle: draft.captionStyle,
    music: draft.music,
    overlays: draft.overlays,
    audience: draft.audience,
    selectedFriendIds: draft.selectedFriendIds,
    optionsData: draft.optionsData,
    status: draft.status,
    mimeType: draft.mimeType,
    fileName: draft.fileName,
    width: draft.width,
    height: draft.height,
    duration: draft.duration,
    createdAt: draft.createdAt,
    sourceDeviceId: draft.sourceDeviceId || getDeviceId(),
  };
  const res = await apiDraftCall({
    method: "put",
    url: `/api/drafts/${encodeURIComponent(draft.id)}`,
    data: body,
    timeout: 60000,
  });
  return res?.data;
}

async function uploadRole(draftId, role, blob, mime) {
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  const res = await apiDraftCall({
    method: "put",
    url: `/api/drafts/${encodeURIComponent(draftId)}/media/${role}`,
    data: buf,
    headers: {
      "Content-Type": mime || blob.type || "application/octet-stream",
    },
    timeout: 180000,
    transformRequest: [(d) => d],
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  return res?.data;
}

function ownerUidHash(uid) {
  const s = String(uid || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `u${h.toString(16).slice(0, 8)}`;
}

async function syncOneDraft(draft) {
  const id = draft.id;
  const ownerUid = draft.ownerUid;
  await updateDraftMeta(id, {
    syncStatus: SYNC_STATUS.SYNCING,
    lastSyncError: null,
  });

  if (draft.syncStatus === SYNC_STATUS.PENDING_DELETE) {
    try {
      await apiDraftCall({
        method: "delete",
        url: `/api/drafts/${encodeURIComponent(id)}`,
        timeout: 30000,
      });
    } catch (e) {
      if (e?.response?.status !== 404) {
        throw e;
      }
    }
    // Chỉ xóa tombstone local khi đã xóa thành công trên cloud hoặc cloud trả 404
    await momentDraftDB.drafts.delete(id);
    await momentDraftDB.draftBlobs.delete(id);
    return { ok: true, deleted: true };
  }

  const full = await getDraftFull(id);
  if (!full?.meta) throw new Error("missing local draft");

  let metaRes;
  try {
    metaRes = await putMeta(full.meta);
  } catch (e) {
    if (e?.response?.status === 409) {
      await updateDraftMeta(id, {
        syncStatus: SYNC_STATUS.CONFLICT,
        lastSyncError: "Xung đột phiên bản trên thiết bị khác",
        cloudRevision: e.response.data?.serverDraft?.revision,
      });
      return { ok: false, conflict: true, serverDraft: e.response.data?.serverDraft };
    }
    throw e;
  }

  const media = full.media;
  if (!media?.blob) {
    throw new Error("Thiếu media local — không đánh dấu đã đồng bộ");
  }
  const mime = media?.mimeType || full.meta.mimeType || "application/octet-stream";

  const activeUp = await uploadRole(id, "active", media.blob, mime);
  if (!activeUp?.success && !activeUp?.key) {
    throw new Error("Upload active media thất bại");
  }

  const originalBlob = media.originalMediaBlob || media.blob;
  const originalUp = await uploadRole(
    id,
    "original",
    originalBlob,
    media.originalMediaBlob?.type || mime,
  );
  if (!originalUp?.success && !originalUp?.key) {
    throw new Error("Upload original media thất bại");
  }

  if (media.thumbnailBlob) {
    const thumbUp = await uploadRole(
      id,
      "thumbnail",
      media.thumbnailBlob,
      media.thumbnailBlob.type || "image/jpeg",
    );
    if (!thumbUp?.success && !thumbUp?.key) {
      throw new Error("Upload thumbnail thất bại");
    }
  } else {
    throw new Error("Thiếu thumbnail — không đánh dấu đã đồng bộ");
  }

  const verify = await apiDraftCall({
    method: "get",
    url: `/api/drafts/${encodeURIComponent(id)}`,
    timeout: 60000,
  });
  const cloud = verify?.data?.draft || metaRes?.draft || {};
  if (!cloud?.id) throw new Error("Server không trả draft sau upload");
  if (!cloud.activeObjectKey && !cloud.originalObjectKey) throw new Error("Server chưa có file media");
  if (!cloud.thumbnailObjectKey) throw new Error("Server chưa có thumbnail");
  if (cloud.revision == null) throw new Error("Server không trả revision hợp lệ");

  await updateDraftMeta(id, {
    syncStatus: SYNC_STATUS.SYNCED,
    lastSyncError: null,
    cloudRevision: cloud.revision,
    baseRevision: cloud.revision,
    mediaUrls: cloud.mediaUrls || full.meta.mediaUrls || null,
  });
  const safeLog = {
    draftId: id,
    ownerUidHash: ownerUidHash(ownerUid),
    revision: cloud.revision,
    syncStatus: SYNC_STATUS.SYNCED,
    metadataUploaded: true,
    originalUploaded: true,
    thumbnailUploaded: true,
    serverStatus: "ok",
  };
  console.info("[draft-sync]", safeLog);
  return { ok: true, ownerUid, ...safeLog };
}

async function internalPushPendingDrafts({ onProgress } = {}) {
  const ownerUid = resolveDraftUid();
  const results = [];
  const pending = await listPendingLocal(ownerUid);
  let allOk = true;
  
  for (const d of pending) {
    try {
      onProgress?.({ phase: "push", draftId: d.id, attempts: 1 });
      const r = await syncOneDraft(d);
      results.push({ id: d.id, ...r });
      if (!r.ok) allOk = false;
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || "sync failed";
      await updateDraftMeta(d.id, {
        syncStatus: SYNC_STATUS.SYNC_FAILED,
        lastSyncError: msg,
      });
      results.push({ id: d.id, ok: false, error: msg });
      allOk = false;
    }
  }
  return { ok: allOk, results, count: pending.length };
}

export function pushPendingDrafts({ onProgress } = {}) {
  if (!authOk()) return Promise.resolve({ ok: false, error: "Lỗi xác thực", reason: "auth" });
  if (pushInFlight) return pushInFlight;
  
  pushInFlight = internalPushPendingDrafts({ onProgress })
    .finally(() => { pushInFlight = null; });
    
  return pushInFlight;
}

function isUsableMediaBlob(blob) {
  return (
    blob instanceof Blob &&
    blob.size > 0 &&
    !(blob.type && String(blob.type).includes("application/json"))
  );
}

async function downloadDraftRoleBlob(draftId, role, mediaUrls) {
  const path = `/api/drafts/${encodeURIComponent(draftId)}/media/${encodeURIComponent(role)}`;
  // Prefer short-lived signed URLs. They do not need a bearer token, so an old
  // login token cannot trigger one refresh request per thumbnail.
  const entry = mediaUrls?.[role];
  for (const request of getDraftMediaRequests(entry)) {
    try {
      const res = await instanceMain.get(request.url, {
        responseType: "blob",
        timeout: 180000,
        ...(request.baseURL !== undefined
          ? { baseURL: request.baseURL }
          : {}),
        skipAuthRefresh: request.skipAuthRefresh,
      });
      if (isUsableMediaBlob(res?.data)) return res.data;
    } catch {
      /* try next */
    }
  }

  // Last fallback: authenticated owner access. instanceMain already performs a
  // coordinated single refresh, so apiDraftCall must not run another refresh.
  try {
    const res = await apiDraftCall({
      method: "get",
      url: path,
      responseType: "blob",
      timeout: 180000,
    });
    if (isUsableMediaBlob(res?.data)) return res.data;
  } catch {
    /* caller may refresh signed URLs and retry */
  }

  return null;
}

async function refreshDraftMediaUrls(draftId) {
  try {
    const res = await apiDraftCall({
      method: "get",
      url: `/api/drafts/${encodeURIComponent(draftId)}`,
      timeout: 60000,
    });
    const cloud = res?.data?.draft;
    if (cloud?.mediaUrls) {
      await updateDraftMeta(draftId, { mediaUrls: cloud.mediaUrls });
      return cloud.mediaUrls;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Background Thumbnail Downloader
const backgroundThumbnailsQueue = [];
const queuedBackgroundThumbnailIds = new Set();
let isBackgroundThumbProcessing = false;

function queueBackgroundThumbnail(cloud) {
  if (!cloud?.id || queuedBackgroundThumbnailIds.has(cloud.id)) return;
  queuedBackgroundThumbnailIds.add(cloud.id);
  backgroundThumbnailsQueue.push(cloud);
}

async function processThumbnailsBackground() {
  if (isBackgroundThumbProcessing) return;
  isBackgroundThumbProcessing = true;
  
  while (backgroundThumbnailsQueue.length > 0) {
    const cloud = backgroundThumbnailsQueue.shift();
    try {
      const thumbBlob = await downloadDraftRoleBlob(
        cloud.id,
        "thumbnail",
        cloud.mediaUrls,
      );
      if (thumbBlob) {
        const localBlobs = await momentDraftDB.draftBlobs.get(cloud.id);
        await momentDraftDB.draftBlobs.put({
          id: cloud.id,
          mediaBlob: localBlobs?.mediaBlob || null,
          thumbnailBlob: thumbBlob,
          originalMediaBlob: localBlobs?.originalMediaBlob || null,
          mimeType: localBlobs?.mimeType || cloud.mimeType || "",
          fileName: localBlobs?.fileName || cloud.fileName || "",
        });
      }
    } catch {
      // Ignore background thumb errors
    } finally {
      if (cloud?.id) queuedBackgroundThumbnailIds.delete(cloud.id);
    }
  }
  isBackgroundThumbProcessing = false;
}

async function internalPullCloudDrafts({ onProgress } = {}) {
  const ownerUid = resolveDraftUid();
  try {
    onProgress?.({ phase: "pull" });
    const res = await apiDraftCall({ method: "get", url: "/api/drafts", timeout: 60000 });
    const remote = res?.data?.drafts || [];
    
    for (const cloud of remote) {
      if (!cloud?.id) continue;
      const local = await momentDraftDB.drafts.get(cloud.id);
      
      if (cloud.deletedAt) {
        if (local) {
          await momentDraftDB.drafts.delete(local.id);
          await momentDraftDB.draftBlobs.delete(local.id);
        }
        continue;
      }

      if (!local) {
        await momentDraftDB.drafts.put({
          id: cloud.id,
          ownerUid,
          schemaVersion: cloud.schemaVersion || 4,
          revision: cloud.revision || 1,
          cloudRevision: cloud.revision || 1,
          baseRevision: cloud.revision || 1,
          createdAt: cloud.createdAt || Date.now(),
          updatedAt: cloud.updatedAt || Date.now(),
          mediaType: cloud.mediaType || "image",
          caption: cloud.caption || "",
          captionStyle: cloud.captionStyle || null,
          music: cloud.music || null,
          overlays: cloud.overlays || null,
          audience: cloud.audience || "all",
          selectedFriendIds: cloud.selectedFriendIds || [],
          optionsData: cloud.optionsData || {},
          status: cloud.status || "ready",
          mimeType: cloud.mimeType || "",
          fileName: cloud.fileName || "",
          width: cloud.width,
          height: cloud.height,
          duration: cloud.duration,
          syncStatus: SYNC_STATUS.SYNCED,
          lastSyncError: null,
          mediaUrls: cloud.mediaUrls || null,
          sourceDeviceId: cloud.sourceDeviceId || null,
        });
        
        // Queue thumbnail background fetch instead of blocking
        queueBackgroundThumbnail(cloud);
        continue;
      }

      if (String(local.ownerUid) !== String(ownerUid)) continue;

      const localPending =
        local.syncStatus === SYNC_STATUS.PENDING_SYNC ||
        local.syncStatus === SYNC_STATUS.SYNC_FAILED ||
        local.syncStatus === SYNC_STATUS.SYNCING;

      if (local.syncStatus === SYNC_STATUS.PENDING_DELETE) continue;

      if (localPending && (local.revision || 1) > (cloud.revision || 1)) continue;

      if (
        localPending &&
        (cloud.revision || 1) > (local.cloudRevision || local.baseRevision || 0) &&
        (local.revision || 1) > (local.cloudRevision || 0)
      ) {
        await updateDraftMeta(local.id, {
          syncStatus: SYNC_STATUS.CONFLICT,
          lastSyncError: "Đã sửa trên nhiều thiết bị",
          cloudRevision: cloud.revision,
        });
        const forkId = `${cloud.id}__cloud_${cloud.revision}`;
        if (!(await momentDraftDB.drafts.get(forkId))) {
          await momentDraftDB.drafts.put({
            ...local,
            id: forkId,
            caption: cloud.caption,
            captionStyle: cloud.captionStyle,
            music: cloud.music,
            overlays: cloud.overlays,
            audience: cloud.audience,
            selectedFriendIds: cloud.selectedFriendIds,
            optionsData: cloud.optionsData,
            revision: cloud.revision,
            cloudRevision: cloud.revision,
            syncStatus: SYNC_STATUS.SYNCED,
            updatedAt: cloud.updatedAt,
            mediaUrls: cloud.mediaUrls,
            lastSyncError: "Bản từ thiết bị khác (xung đột)",
          });
        }
        continue;
      }

      if (!localPending || (cloud.revision || 0) >= (local.revision || 0)) {
        await momentDraftDB.drafts.put({
          ...local,
          caption: cloud.caption ?? local.caption,
          captionStyle: cloud.captionStyle ?? local.captionStyle,
          music: cloud.music ?? local.music,
          overlays: cloud.overlays ?? local.overlays,
          audience: cloud.audience ?? local.audience,
          selectedFriendIds: cloud.selectedFriendIds ?? local.selectedFriendIds,
          optionsData: cloud.optionsData ?? local.optionsData,
          status: cloud.status || local.status,
          revision: Math.max(local.revision || 1, cloud.revision || 1),
          cloudRevision: cloud.revision,
          baseRevision: cloud.revision,
          updatedAt: Math.max(local.updatedAt || 0, cloud.updatedAt || 0),
          syncStatus: localPending ? local.syncStatus : SYNC_STATUS.SYNCED,
          mediaUrls: cloud.mediaUrls || local.mediaUrls,
          mimeType: cloud.mimeType || local.mimeType,
          fileName: cloud.fileName || local.fileName,
          width: cloud.width ?? local.width,
          height: cloud.height ?? local.height,
          duration: cloud.duration ?? local.duration,
          mediaType: cloud.mediaType || local.mediaType,
        });
        
        // Ensure thumbnail async
        const blobs = await momentDraftDB.draftBlobs.get(local.id);
        if (!(blobs?.thumbnailBlob instanceof Blob) || !blobs.thumbnailBlob.size) {
          queueBackgroundThumbnail(cloud);
        }
      }
    }

    const remoteIds = new Set(remote.map((d) => d?.id).filter(Boolean));
    let locals = [];
    try {
      locals = await momentDraftDB.drafts
        .where("ownerUid")
        .equals(String(ownerUid))
        .toArray();
    } catch {
      locals = await listDraftsMeta(ownerUid);
    }
    
    for (const row of locals) {
      if (remoteIds.has(row.id)) continue;
      const st = row.syncStatus;
      const keepLocal =
        st === SYNC_STATUS.PENDING_SYNC ||
        st === SYNC_STATUS.SYNC_FAILED ||
        st === SYNC_STATUS.SYNCING ||
        st === SYNC_STATUS.CONFLICT ||
        st === SYNC_STATUS.LOCAL_ONLY ||
        st === SYNC_STATUS.PENDING_DELETE ||
        !st;
      if (keepLocal) continue;
      
      if (st === SYNC_STATUS.SYNCED || st === SYNC_STATUS.UPLOADING_POST) {
        await updateDraftMeta(row.id, {
          syncStatus: SYNC_STATUS.PENDING_SYNC,
          lastSyncError: "Khôi phục do mất dữ liệu trên máy chủ",
        });
      }
    }

    // Start background processing
    void processThumbnailsBackground();

    return { ok: true, count: remote.length };
  } catch (e) {
    const msg = e?.response?.data?.message || e?.message || "Lỗi kéo bản nháp";
    return { ok: false, error: msg, reason: "network" };
  }
}

export function pullCloudDrafts({ onProgress } = {}) {
  if (!authOk()) return Promise.resolve({ ok: false, error: "Lỗi xác thực", reason: "auth" });
  if (pullInFlight) return pullInFlight;
  
  pullInFlight = internalPullCloudDrafts({ onProgress })
    .finally(() => { pullInFlight = null; });
    
  return pullInFlight;
}

export async function ensureLocalThumbnail(draftId) {
  if (!draftId) return { ok: false, error: "missing_id" };
  const existing = await momentDraftDB.draftBlobs.get(draftId);
  if (existing?.thumbnailBlob instanceof Blob && existing.thumbnailBlob.size > 0) {
    return { ok: true, blob: existing.thumbnailBlob, blobs: existing };
  }
  const meta = await momentDraftDB.drafts.get(draftId);
  if (!meta) return { ok: false, error: "not_found" };

  let mediaUrls = meta.mediaUrls || null;
  let thumb = (await downloadDraftRoleBlob(draftId, "thumbnail", mediaUrls).catch(() => null)) || null;

  if (!thumb) {
    mediaUrls = (await refreshDraftMediaUrls(draftId)) || mediaUrls;
    thumb = await downloadDraftRoleBlob(draftId, "thumbnail", mediaUrls).catch(() => null);
  }
  if (!thumb && meta.mediaType !== "video") {
    thumb = await downloadDraftRoleBlob(draftId, "active", mediaUrls).catch(() => null);
  }
  if (!thumb) return { ok: false, error: "no_remote_thumb" };

  await momentDraftDB.draftBlobs.put({
    id: draftId,
    mediaBlob: existing?.mediaBlob || null,
    thumbnailBlob: thumb,
    originalMediaBlob: existing?.originalMediaBlob || null,
    mimeType: existing?.mimeType || meta.mimeType || thumb.type || "",
    fileName: existing?.fileName || meta.fileName || "",
  });
  return {
    ok: true,
    blob: thumb,
    blobs: await momentDraftDB.draftBlobs.get(draftId),
  };
}

export async function ensureLocalMedia(draftId) {
  const blobs = await momentDraftDB.draftBlobs.get(draftId);
  if (blobs?.mediaBlob instanceof Blob && blobs.mediaBlob.size > 0) {
    return { ok: true, blobs };
  }
  const meta = await momentDraftDB.drafts.get(draftId);
  if (!meta) return { ok: false, error: "not_found" };

  let mediaUrls = meta.mediaUrls || null;
  let mediaBlob =
    (await downloadDraftRoleBlob(draftId, "active", mediaUrls).catch(() => null)) ||
    (await downloadDraftRoleBlob(draftId, "original", mediaUrls).catch(() => null));

  if (!mediaBlob) {
    mediaUrls = (await refreshDraftMediaUrls(draftId)) || mediaUrls;
    mediaBlob =
      (await downloadDraftRoleBlob(draftId, "active", mediaUrls).catch(() => null)) ||
      (await downloadDraftRoleBlob(draftId, "original", mediaUrls).catch(() => null));
  }
  if (!mediaBlob) return { ok: false, error: "no_remote_media" };

  let thumbnailBlob = blobs?.thumbnailBlob || null;
  if (!(thumbnailBlob instanceof Blob) || !thumbnailBlob.size) {
    thumbnailBlob =
      (await downloadDraftRoleBlob(draftId, "thumbnail", mediaUrls).catch(() => null)) ||
      (meta.mediaType !== "video" ? mediaBlob : null);
  }

  await momentDraftDB.draftBlobs.put({
    id: draftId,
    mediaBlob,
    thumbnailBlob: thumbnailBlob || null,
    originalMediaBlob: blobs?.originalMediaBlob || null,
    mimeType: mediaBlob.type || meta.mimeType || "",
    fileName: meta.fileName || "",
  });
  return {
    ok: true,
    blobs: await momentDraftDB.draftBlobs.get(draftId),
  };
}

async function internalSyncAll({ onProgress }) {
  if (!authOk()) return { ok: false, reason: "auth", error: "Lỗi xác thực" };
  
  const pullBefore = await pullCloudDrafts({ onProgress });
  if (!pullBefore.ok) {
    // Không push local nếu pull đầu tiên lỗi để tránh push lại draft đã bị xóa
    return { 
      ok: false, 
      pull: pullBefore, 
      pullBefore,
      error: pullBefore.error,
      partial: true
    };
  }

  const push = await pushPendingDrafts({ onProgress });
  const pullAfter = await pullCloudDrafts({ onProgress });
  
  // Trả về định dạng tương thích với UI
  return { 
    ok: push.ok && pullAfter.ok, 
    pull: pullAfter, 
    pullBefore,
    pullAfter, 
    push,
    error: push.ok ? pullAfter.error : push.error
  };
}

export function syncAll({ onProgress } = {}) {
  if (!authOk()) return Promise.resolve({ ok: false, error: "Lỗi xác thực", reason: "auth" });
  
  if (fullSyncInFlight) {
    // Nếu đang sync, đánh dấu cần chạy thêm 1 vòng
    syncRequestedAgain = true;
    return fullSyncInFlight;
  }
  
  const executeSync = async () => {
    let result = await internalSyncAll({ onProgress });
    while (syncRequestedAgain) {
      syncRequestedAgain = false;
      result = await internalSyncAll({ onProgress });
    }
    return result;
  };
  
  fullSyncInFlight = executeSync().finally(() => {
    fullSyncInFlight = null;
    syncRequestedAgain = false; // Reset in case
  });
  
  return fullSyncInFlight;
}

export function isDraftSyncRunning() {
  return Boolean(fullSyncInFlight || pullInFlight || pushInFlight);
}
