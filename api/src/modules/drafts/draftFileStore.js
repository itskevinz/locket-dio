/**
 * Durable private draft media.
 *
 * New Vercel uploads prefer private Supabase Storage. Existing Neon Base64
 * objects remain readable, so rollout is backward compatible and old drafts
 * are not migrated/deleted until the new path is proven stable.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const draftDatabase = require("./draftDatabase");
const supabaseDraftStorage = require("./supabaseDraftStorage");

if (
  process.env.NODE_ENV === "production" &&
  !process.env.VERCEL &&
  !process.env.DRAFT_MEDIA_DIR
) {
  throw new Error("DRAFT_MEDIA_DIR is required in production for draft files to persist.");
}

const ROOT = path.join(
  process.env.DRAFT_MEDIA_DIR || path.join(os.tmpdir(), "huy-locket-drafts"),
  "drafts",
);

const MAX_BYTES = Number(process.env.DRAFT_MAX_BYTES || 95 * 1024 * 1024);
const SIGN_TTL_MS = Number(process.env.DRAFT_SIGN_TTL_MS || 15 * 60 * 1000);

const ALLOWED_ROLES = new Set(["original", "active", "thumbnail"]);
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function safeUid(uid) {
  return String(uid || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 128);
}

function safeId(id) {
  return String(id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
}

function objectDir(ownerUid, draftId) {
  return path.join(ROOT, safeUid(ownerUid), safeId(draftId));
}

function objectPath(ownerUid, draftId, role) {
  if (!ALLOWED_ROLES.has(role)) throw new Error("invalid_role");
  return path.join(objectDir(ownerUid, draftId), role);
}

function metaSidecar(ownerUid, draftId, role) {
  return `${objectPath(ownerUid, draftId, role)}.json`;
}

async function writeObject(ownerUid, draftId, role, buffer, contentType, options = {}) {
  if (!ALLOWED_ROLES.has(role)) throw new Error("invalid_role");
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { ok: false, error: "empty" };
  }
  if (buffer.length > MAX_BYTES) return { ok: false, error: "too_large" };
  const mime = String(contentType || "application/octet-stream").toLowerCase();
  if (
    !ALLOWED_MIME.has(mime) &&
    !mime.startsWith("image/") &&
    !mime.startsWith("video/")
  ) {
    return { ok: false, error: "bad_mime" };
  }

  // Phase 1 migration: prefer Supabase for new media, but never make draft
  // syncing depend on it. If the Storage/Edge bridge is temporarily down we
  // fall back to the existing Neon path and keep the user's draft safe.
  if (process.env.VERCEL && options.idToken) {
    try {
      return await supabaseDraftStorage.upload({
        ownerUid: safeUid(ownerUid),
        draftId: safeId(draftId),
        role,
        buffer,
        contentType: mime,
        idToken: options.idToken,
      });
    } catch (error) {
      console.warn(
        "[draft-storage] Supabase upload unavailable; using Neon fallback:",
        error?.code || error?.message || "unknown",
      );
    }
  }

  if (draftDatabase.isAvailable()) {
    await draftDatabase.putMedia({
      ownerUid: safeUid(ownerUid),
      draftId: safeId(draftId),
      role,
      contentType: mime,
      buffer,
    });
    return {
      ok: true,
      key: `drafts/${safeUid(ownerUid)}/${safeId(draftId)}/${role}`,
      size: buffer.length,
      contentType: mime,
      provider: "neon",
    };
  }

  const dir = objectDir(ownerUid, draftId);
  ensureDir(dir);
  const file = objectPath(ownerUid, draftId, role);
  fs.writeFileSync(file, buffer);
  fs.writeFileSync(
    metaSidecar(ownerUid, draftId, role),
    JSON.stringify({
      contentType: mime,
      size: buffer.length,
      updatedAt: Date.now(),
    }),
  );
  return {
    ok: true,
    key: `drafts/${safeUid(ownerUid)}/${safeId(draftId)}/${role}`,
    size: buffer.length,
    contentType: mime,
    provider: "filesystem",
  };
}

async function readObject(ownerUid, draftId, role, options = {}) {
  if (supabaseDraftStorage.isSupabaseKey(options.objectKey)) {
    try {
      const redirectUrl = await supabaseDraftStorage.createDownloadUrl({
        ownerUid: safeUid(ownerUid),
        draftId: safeId(draftId),
        role,
        idToken: options.idToken,
        signedProof: options.signedProof,
      });
      return redirectUrl
        ? { redirectUrl, provider: "supabase" }
        : null;
    } catch (error) {
      console.warn(
        "[draft-storage] Supabase download ticket failed:",
        error?.code || error?.message || "unknown",
      );
      return null;
    }
  }

  // Legacy drafts continue reading their Base64 media from Neon unchanged.
  if (draftDatabase.isAvailable()) {
    return draftDatabase.getMedia(safeUid(ownerUid), safeId(draftId), role);
  }

  const file = objectPath(ownerUid, draftId, role);
  if (!fs.existsSync(file)) return null;
  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(metaSidecar(ownerUid, draftId, role), "utf8"));
  } catch {
    /* ignore */
  }
  const buffer = fs.readFileSync(file);
  return {
    buffer,
    contentType: meta.contentType || "application/octet-stream",
    size: buffer.length,
  };
}

async function deleteDraftFiles(ownerUid, draftId, options = {}) {
  const objectKeys = Array.isArray(options.objectKeys) ? options.objectKeys : [];
  const hasSupabaseMedia = objectKeys.some((key) => supabaseDraftStorage.isSupabaseKey(key));

  if (hasSupabaseMedia && options.idToken) {
    try {
      await supabaseDraftStorage.deleteDraft({
        ownerUid: safeUid(ownerUid),
        draftId: safeId(draftId),
        idToken: options.idToken,
      });
    } catch (error) {
      // Metadata is soft-deleted first. A failed object cleanup can be retried
      // later and must not restore or corrupt the draft.
      console.warn(
        "[draft-storage] Supabase delete deferred:",
        error?.code || error?.message || "unknown",
      );
    }
  }

  // Also clear any legacy/fallback Neon rows for this draft. This is safe for
  // Supabase-native drafts and cleans up partial fallback uploads if they exist.
  if (draftDatabase.isAvailable()) {
    await draftDatabase.deleteMedia(safeUid(ownerUid), safeId(draftId));
    return;
  }

  const dir = objectDir(ownerUid, draftId);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    /* ignore */
  }
}

function signAccess({ ownerUid, draftId, role, exp }) {
  const secret =
    process.env.LOCKETDIO_SIGNATURE_SECRET ||
    process.env.COOKIE_SECRET ||
    "huy-locket-draft-dev";
  const payload = `${safeUid(ownerUid)}.${safeId(draftId)}.${role}.${exp}`;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function verifyAccess({ ownerUid, draftId, role, exp, sig }) {
  if (!sig || !exp) return false;
  if (Number(exp) < Date.now()) return false;
  const expect = signAccess({
    ownerUid,
    draftId,
    role,
    exp: Number(exp),
  });
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(sig)),
      Buffer.from(expect),
    );
  } catch {
    return false;
  }
}

function makeSignedQuery(ownerUid, draftId, role) {
  const exp = Date.now() + SIGN_TTL_MS;
  const sig = signAccess({ ownerUid, draftId, role, exp });
  return { exp, sig, expiresIn: Math.floor(SIGN_TTL_MS / 1000) };
}

module.exports = {
  writeObject,
  readObject,
  deleteDraftFiles,
  makeSignedQuery,
  verifyAccess,
  MAX_BYTES,
  ALLOWED_ROLES,
  ROOT,
};
