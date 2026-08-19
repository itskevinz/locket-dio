import { instanceMain } from "@/libs";
import { getToken } from "@/utils/storage/storage";
import {
  SYNC_STATUS,
  getDeviceId,
  getDraftFull,
  updateDraftMeta,
} from "./draftLibrary";

const DRAFT_STORAGE_EDGE_URL =
  "https://bekueuthzafjncmqpnve.supabase.co/functions/v1/draft-storage";

function requestSignal(timeoutMs) {
  try {
    return typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error, fallback = "Đồng bộ media thất bại") {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.code ||
    error?.message ||
    fallback
  );
}

function metaBody(meta, extra = {}) {
  return {
    id: meta.id,
    mediaType: meta.mediaType,
    caption: meta.caption || "",
    captionStyle: meta.captionStyle || null,
    music: meta.music || null,
    overlays: meta.overlays || null,
    audience: meta.audience || "all",
    selectedFriendIds: Array.isArray(meta.selectedFriendIds)
      ? meta.selectedFriendIds
      : [],
    optionsData: meta.optionsData || {},
    status: meta.status || "ready",
    mimeType: meta.mimeType || "",
    fileName: meta.fileName || "",
    width: meta.width ?? null,
    height: meta.height ?? null,
    duration: meta.duration ?? null,
    createdAt: meta.createdAt || Date.now(),
    sourceDeviceId: meta.sourceDeviceId || getDeviceId(),
    ...extra,
  };
}

async function getRemoteDraft(draftId) {
  try {
    const res = await instanceMain.get(
      `/api/drafts/${encodeURIComponent(draftId)}`,
      { timeout: 60_000 },
    );
    return res?.data?.draft || null;
  } catch (error) {
    if (error?.response?.status === 404) return null;
    throw error;
  }
}

async function ensureRemoteShell(meta) {
  const existing = await getRemoteDraft(meta.id);
  if (existing) return existing;

  const res = await instanceMain.put(
    `/api/drafts/${encodeURIComponent(meta.id)}`,
    metaBody(meta, { baseRevision: null }),
    { timeout: 60_000 },
  );
  const created = res?.data?.draft;
  if (!created?.id) throw new Error("Không tạo được bản nháp trên máy chủ");
  return created;
}

async function requestUploadTicket({ ownerUid, draftId, role, idToken }) {
  const response = await fetch(DRAFT_STORAGE_EDGE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      action: "upload-ticket",
      ownerUid,
      draftId,
      role,
    }),
    signal: requestSignal(30_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success || !data?.signedUrl || !data?.key) {
    const error = new Error(data?.code || `storage_ticket_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function uploadSignedBlob(ticket, blob) {
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", blob);

  const response = await fetch(ticket.signedUrl, {
    method: "PUT",
    headers: { "x-upsert": "true" },
    body: form,
    signal: requestSignal(180_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      detail
        ? `Supabase upload ${response.status}: ${detail.slice(0, 160)}`
        : `Supabase upload ${response.status}`,
    );
  }

  return {
    success: true,
    key: ticket.key,
    provider: "supabase-direct",
  };
}

async function uploadViaBackend(draftId, role, blob, mime) {
  // Send the Blob itself. Converting an IndexedDB Blob with arrayBuffer() first
  // can fail/hang on some mobile browser sessions before any HTTP request is made.
  const res = await instanceMain({
    method: "put",
    url: `/api/drafts/${encodeURIComponent(draftId)}/media/${role}`,
    data: blob,
    headers: {
      "Content-Type": mime || blob.type || "application/octet-stream",
    },
    timeout: 180_000,
    transformRequest: [(data) => data],
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  const data = res?.data || {};
  if (!data?.success || !data?.key) {
    throw new Error(`Upload ${role} qua API thất bại`);
  }
  return data;
}

async function uploadRoleSmart({
  ownerUid,
  draftId,
  role,
  blob,
  mime,
  idToken,
}) {
  if (!(blob instanceof Blob) || blob.size <= 0) {
    throw new Error(`Media ${role} không hợp lệ`);
  }

  // Preferred path: browser -> private Supabase Storage using a short-lived
  // signed ticket. If that path is unavailable, keep the existing authenticated
  // Vercel API route as a safety fallback so drafts are never lost.
  if (idToken) {
    try {
      const ticket = await requestUploadTicket({
        ownerUid,
        draftId,
        role,
        idToken,
      });
      return await uploadSignedBlob(ticket, blob);
    } catch (error) {
      console.warn(
        `[draft-storage] direct ${role} upload unavailable; using API fallback:`,
        errorMessage(error, "unknown"),
      );
    }
  }

  return uploadViaBackend(draftId, role, blob, mime);
}

/**
 * Force one locally-saved draft's media to cloud storage.
 * This is deliberately additive to the existing sync engine: metadata/revision
 * semantics stay unchanged, while a failed legacy media upload gets a reliable
 * direct Supabase path and an API fallback.
 */
export async function syncDraftMediaDirect(draftId) {
  if (!draftId) return { ok: false, error: "missing_id" };

  const full = await getDraftFull(draftId);
  if (!full?.meta || !full?.media?.blob) {
    return { ok: false, error: "missing_local_media" };
  }

  const meta = full.meta;
  const media = full.media;
  const ownerUid = String(meta.ownerUid || "");
  if (!ownerUid) return { ok: false, error: "missing_owner" };

  await updateDraftMeta(draftId, {
    syncStatus: SYNC_STATUS.SYNCING,
    lastSyncError: null,
  });

  try {
    let remote = await ensureRemoteShell(meta);

    // Skip only when local content has no revision newer than the confirmed
    // cloud revision. A locally edited draft must re-upload even if the remote
    // object keys from the previous revision are still present.
    const sameCloudRevision =
      meta.cloudRevision != null &&
      Number(meta.cloudRevision) === Number(remote?.revision);
    const localContentAlreadyConfirmed =
      sameCloudRevision &&
      Number(meta.revision || 1) <= Number(meta.cloudRevision || 0);
    if (
      localContentAlreadyConfirmed &&
      remote?.activeObjectKey &&
      remote?.originalObjectKey &&
      remote?.thumbnailObjectKey
    ) {
      await updateDraftMeta(draftId, {
        syncStatus: SYNC_STATUS.SYNCED,
        lastSyncError: null,
        cloudRevision: remote.revision,
        baseRevision: remote.revision,
        mediaUrls: remote.mediaUrls || meta.mediaUrls || null,
      });
      return { ok: true, skipped: true, provider: "already-synced" };
    }

    const { idToken } = getToken();
    const mime =
      media.mimeType ||
      meta.mimeType ||
      media.blob.type ||
      "application/octet-stream";

    const active = await uploadRoleSmart({
      ownerUid,
      draftId,
      role: "active",
      blob: media.blob,
      mime,
      idToken,
    });

    const originalBlob = media.originalMediaBlob || media.blob;
    const original = await uploadRoleSmart({
      ownerUid,
      draftId,
      role: "original",
      blob: originalBlob,
      mime: originalBlob.type || mime,
      idToken,
    });

    const thumbnailBlob =
      media.thumbnailBlob || (meta.mediaType !== "video" ? media.blob : null);
    if (!thumbnailBlob) {
      throw new Error("Thiếu thumbnail local");
    }
    const thumbnail = await uploadRoleSmart({
      ownerUid,
      draftId,
      role: "thumbnail",
      blob: thumbnailBlob,
      mime: thumbnailBlob.type || "image/jpeg",
      idToken,
    });

    // API fallback uploads can bump the remote revision per role, so read the
    // latest revision before the final metadata write to avoid false conflicts.
    remote = (await getRemoteDraft(draftId)) || remote;
    const baseRevision = remote?.revision ?? null;

    const finalize = await instanceMain.put(
      `/api/drafts/${encodeURIComponent(draftId)}`,
      metaBody(meta, {
        baseRevision,
        activeObjectKey: active.key,
        originalObjectKey: original.key,
        thumbnailObjectKey: thumbnail.key,
      }),
      { timeout: 60_000 },
    );

    const cloud = finalize?.data?.draft || (await getRemoteDraft(draftId));
    if (
      !cloud?.id ||
      !cloud.activeObjectKey ||
      !cloud.originalObjectKey ||
      !cloud.thumbnailObjectKey ||
      cloud.revision == null
    ) {
      throw new Error("Máy chủ chưa xác nhận đủ media bản nháp");
    }

    await updateDraftMeta(draftId, {
      syncStatus: SYNC_STATUS.SYNCED,
      lastSyncError: null,
      cloudRevision: cloud.revision,
      baseRevision: cloud.revision,
      mediaUrls: cloud.mediaUrls || meta.mediaUrls || null,
    });

    return {
      ok: true,
      provider: [active.provider, original.provider, thumbnail.provider]
        .filter(Boolean)
        .join(","),
      revision: cloud.revision,
    };
  } catch (error) {
    const message = errorMessage(error);
    await updateDraftMeta(draftId, {
      syncStatus: SYNC_STATUS.SYNC_FAILED,
      lastSyncError: message,
    });
    console.warn("[draft-storage] forced media sync failed:", message);
    return { ok: false, error: message };
  }
}
