/**
 * Draft metadata store — file-backed JSON per owner (always works).
 * Optional Supabase table when configured (best-effort dual-write).
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { supabase, isSupabaseConfigured } = require("../../config/supabase");
const draftDatabase = require("./draftDatabase");

if (
  process.env.NODE_ENV === "production" &&
  !process.env.VERCEL &&
  !process.env.DRAFT_MEDIA_DIR
) {
  throw new Error("DRAFT_MEDIA_DIR is required in production for drafts to persist.");
}

const META_ROOT = path.join(
  process.env.DRAFT_MEDIA_DIR || path.join(os.tmpdir(), "huy-locket-drafts"),
  "meta",
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeUid(uid) {
  return String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

function userFile(ownerUid) {
  return path.join(META_ROOT, `${safeUid(ownerUid)}.json`);
}

function readAll(ownerUid) {
  const f = userFile(ownerUid);
  if (!fs.existsSync(f)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(f, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeAll(ownerUid, rows) {
  ensureDir(META_ROOT);
  fs.writeFileSync(userFile(ownerUid), JSON.stringify(rows, null, 0));
}

function publicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    ownerUid: row.ownerUid,
    schemaVersion: row.schemaVersion || 4,
    revision: row.revision || 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mediaType: row.mediaType,
    caption: row.caption || "",
    captionStyle: row.captionStyle || null,
    music: row.music || null,
    overlays: row.overlays || null,
    audience: row.audience || "all",
    selectedFriendIds: row.selectedFriendIds || [],
    optionsData: row.optionsData || {},
    status: row.status || "ready",
    originalObjectKey: row.originalObjectKey || null,
    activeObjectKey: row.activeObjectKey || null,
    thumbnailObjectKey: row.thumbnailObjectKey || null,
    mimeType: row.mimeType || "",
    fileName: row.fileName || "",
    width: row.width || null,
    height: row.height || null,
    duration: row.duration || null,
    deletedAt: row.deletedAt || null,
  };
}

async function listDrafts(ownerUid) {
  const rows = (draftDatabase.isAvailable()
    ? await draftDatabase.listDrafts(ownerUid)
    : readAll(ownerUid))
    .filter((row) => row && !row.deletedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return rows.map(publicView);
}

async function getDraft(ownerUid, draftId) {
  const row = draftDatabase.isAvailable()
    ? await draftDatabase.getDraft(ownerUid, draftId)
    : readAll(ownerUid).find((r) => r.id === draftId);
  if (row?.deletedAt) return null;
  return publicView(row);
}

async function getDraftRaw(ownerUid, draftId) {
  if (draftDatabase.isAvailable()) {
    return draftDatabase.getDraft(ownerUid, draftId);
  }
  return readAll(ownerUid).find((r) => r.id === draftId) || null;
}

async function upsertDraft(ownerUid, draft) {
  const uid = String(ownerUid);
  const rows = draftDatabase.isAvailable()
    ? [await draftDatabase.getDraft(uid, draft.id)].filter(Boolean)
    : readAll(uid);
  const idx = rows.findIndex((r) => r.id === draft.id);
  const now = Date.now();
  if (idx >= 0) {
    const prev = rows[idx];
    const next = {
      ...prev,
      ...draft,
      ownerUid: uid,
      id: draft.id,
      revision: (prev.revision || 1) + 1,
      updatedAt: now,
      createdAt: prev.createdAt || draft.createdAt || now,
      deletedAt: null,
    };
    rows[idx] = next;
    if (draftDatabase.isAvailable()) await draftDatabase.upsertDraft(next);
    else writeAll(uid, rows);
    await supabaseUpsert(next);
    return publicView(next);
  }
  const created = {
    schemaVersion: 4,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    status: "ready",
    ...draft,
    ownerUid: uid,
    id: draft.id,
    deletedAt: null,
  };
  rows.push(created);
  if (draftDatabase.isAvailable()) await draftDatabase.upsertDraft(created);
  else writeAll(uid, rows);
  await supabaseUpsert(created);
  return publicView(created);
}

/**
 * Patch with optimistic concurrency.
 * @returns {{ ok:true, draft } | { ok:false, code, serverDraft? }}
 */
async function patchDraft(ownerUid, draftId, patch, baseRevision) {
  const uid = String(ownerUid);
  const rows = draftDatabase.isAvailable()
    ? [await draftDatabase.getDraft(uid, draftId)].filter(Boolean)
    : readAll(uid);
  const idx = rows.findIndex((r) => r.id === draftId);
  if (idx < 0 || rows[idx].deletedAt) {
    return { ok: false, code: "NOT_FOUND" };
  }
  const prev = rows[idx];
  if (
    baseRevision != null &&
    Number(baseRevision) !== Number(prev.revision || 1)
  ) {
    return {
      ok: false,
      code: "CONFLICT",
      serverDraft: publicView(prev),
    };
  }
  const next = {
    ...prev,
    ...patch,
    id: draftId,
    ownerUid: uid,
    revision: (prev.revision || 1) + 1,
    updatedAt: Date.now(),
    createdAt: prev.createdAt,
    deletedAt: null,
  };
  rows[idx] = next;
  if (draftDatabase.isAvailable()) await draftDatabase.upsertDraft(next);
  else writeAll(uid, rows);
  await supabaseUpsert(next);
  return { ok: true, draft: publicView(next) };
}

async function softDelete(ownerUid, draftId) {
  const uid = String(ownerUid);
  const rows = draftDatabase.isAvailable()
    ? [await draftDatabase.getDraft(uid, draftId)].filter(Boolean)
    : readAll(uid);
  const idx = rows.findIndex((r) => r.id === draftId);
  if (idx < 0) return { ok: false, code: "NOT_FOUND" };
  rows[idx] = {
    ...rows[idx],
    deletedAt: Date.now(),
    updatedAt: Date.now(),
    revision: (rows[idx].revision || 1) + 1,
  };
  if (draftDatabase.isAvailable()) await draftDatabase.upsertDraft(rows[idx]);
  else writeAll(uid, rows);
  await supabaseUpsert(rows[idx]);
  return { ok: true };
}

async function supabaseUpsert(row) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from("moment_drafts").upsert(
      {
        id: row.id,
        owner_uid: row.ownerUid,
        schema_version: row.schemaVersion || 4,
        revision: row.revision || 1,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
        deleted_at: row.deletedAt || null,
        media_type: row.mediaType,
        caption: row.caption || "",
        caption_style: row.captionStyle || null,
        music: row.music || null,
        overlays: row.overlays || null,
        audience: row.audience || "all",
        selected_friend_ids: row.selectedFriendIds || [],
        options_data: row.optionsData || {},
        status: row.status || "ready",
        original_object_key: row.originalObjectKey || null,
        active_object_key: row.activeObjectKey || null,
        thumbnail_object_key: row.thumbnailObjectKey || null,
        mime_type: row.mimeType || "",
        file_name: row.fileName || "",
        width: row.width,
        height: row.height,
        duration: row.duration,
        payload: row,
      },
      { onConflict: "id" },
    );
  } catch {
    /* file store is source of truth */
  }
}

module.exports = {
  listDrafts,
  getDraft,
  getDraftRaw,
  upsertDraft,
  patchDraft,
  softDelete,
  publicView,
  META_ROOT,
};
