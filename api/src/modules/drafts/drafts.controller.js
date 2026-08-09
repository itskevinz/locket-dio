const rateLimit = require("express-rate-limit");
const metaStore = require("./draftMetaStore");
const fileStore = require("./draftFileStore");

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.DRAFT_UPLOAD_RATE_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    String(req.user?.uid || req.user?.localId || req.ip || "anon"),
  message: {
    success: false,
    code: "RATE_LIMIT",
    message: "Quá nhiều upload bản nháp — thử lại sau.",
  },
});

function uidOf(req) {
  return String(req.user?.uid || req.user?.localId || "");
}

function baseUrl(req) {
  const envBase = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || "")
    .toString()
    .replace(/\/$/, "");
  if (envBase) return envBase;
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "https")
    .toString()
    .split(",")[0]
    .trim();
  const host = (
    req.headers["x-forwarded-host"] ||
    req.headers.host ||
    "localhost"
  )
    .toString()
    .split(",")[0]
    .trim();
  return `${proto}://${host}`;
}

function withDownloadUrls(req, draft) {
  if (!draft) return null;
  const uid = draft.ownerUid;
  const id = draft.id;
  const roles = ["thumbnail", "active", "original"];
  const urls = {};
  for (const role of roles) {
    const key =
      role === "thumbnail"
        ? draft.thumbnailObjectKey
        : role === "active"
          ? draft.activeObjectKey
          : draft.originalObjectKey;
    if (!key) continue;
    const { exp, sig, expiresIn } = fileStore.makeSignedQuery(uid, id, role);
    const q = `exp=${exp}&sig=${sig}&ownerUid=${encodeURIComponent(uid)}`;
    const path = `/api/drafts/${encodeURIComponent(id)}/media/${role}?${q}`;
    urls[role] = {
      url: `${baseUrl(req)}${path}`,
      proxyUrl: `/dio-api${path}`,
      expiresIn,
    };
  }
  return { ...draft, mediaUrls: urls };
}

async function listDrafts(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
  const rows = await metaStore.listDrafts(uid);
  return res.json({
    success: true,
    drafts: rows.map((d) => withDownloadUrls(req, d)),
  });
}

async function getDraft(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
  const draft = await metaStore.getDraft(uid, req.params.id);
  if (!draft) {
    return res.status(404).json({ success: false, code: "NOT_FOUND", message: "Không tìm thấy bản nháp." });
  }
  return res.json({ success: true, draft: withDownloadUrls(req, draft) });
}

/**
 * Idempotent upsert by client draft id.
 * Body: metadata only (no base64 media).
 */
async function upsertDraft(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
  const body = req.body || {};
  const id = String(body.id || "").trim();
  if (!id || id.length > 80) {
    return res.status(400).json({ success: false, message: "Thiếu draft id." });
  }

  const existing = await metaStore.getDraftRaw(uid, id);
  if (existing && !existing.deletedAt) {
    // Idempotent update path with optional baseRevision
    if (
      body.baseRevision != null &&
      Number(body.baseRevision) !== Number(existing.revision || 1)
    ) {
      return res.status(409).json({
        success: false,
        code: "CONFLICT",
        message: "Bản nháp đã được sửa trên thiết bị khác.",
        serverDraft: metaStore.publicView(existing),
      });
    }
  }

  const draft = await metaStore.upsertDraft(uid, {
    id,
    mediaType: body.mediaType === "video" ? "video" : "image",
    caption: body.caption || "",
    captionStyle: body.captionStyle || null,
    music: body.music || null,
    overlays: body.overlays || null,
    audience: body.audience || "all",
    selectedFriendIds: Array.isArray(body.selectedFriendIds)
      ? body.selectedFriendIds
      : [],
    optionsData: body.optionsData || {},
    status: body.status || "ready",
    originalObjectKey: body.originalObjectKey || existing?.originalObjectKey || null,
    activeObjectKey: body.activeObjectKey || existing?.activeObjectKey || null,
    thumbnailObjectKey:
      body.thumbnailObjectKey || existing?.thumbnailObjectKey || null,
    mimeType: body.mimeType || existing?.mimeType || "",
    fileName: body.fileName || existing?.fileName || "",
    width: body.width ?? existing?.width ?? null,
    height: body.height ?? existing?.height ?? null,
    duration: body.duration ?? existing?.duration ?? null,
    createdAt: existing?.createdAt || body.createdAt || Date.now(),
  });

  return res.status(existing ? 200 : 201).json({
    success: true,
    draft: withDownloadUrls(req, draft),
  });
}

async function patchDraft(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
  const body = req.body || {};
  const result = await metaStore.patchDraft(
    uid,
    req.params.id,
    {
      caption: body.caption,
      captionStyle: body.captionStyle,
      music: body.music,
      overlays: body.overlays,
      audience: body.audience,
      selectedFriendIds: body.selectedFriendIds,
      optionsData: body.optionsData,
      status: body.status,
      mimeType: body.mimeType,
      fileName: body.fileName,
      width: body.width,
      height: body.height,
      duration: body.duration,
      mediaType: body.mediaType,
      originalObjectKey: body.originalObjectKey,
      activeObjectKey: body.activeObjectKey,
      thumbnailObjectKey: body.thumbnailObjectKey,
    },
    body.baseRevision,
  );
  if (!result.ok && result.code === "NOT_FOUND") {
    return res.status(404).json({ success: false, code: "NOT_FOUND" });
  }
  if (!result.ok && result.code === "CONFLICT") {
    return res.status(409).json({
      success: false,
      code: "CONFLICT",
      message: "Xung đột phiên bản — chọn giữ bản nào.",
      serverDraft: withDownloadUrls(req, result.serverDraft),
    });
  }
  return res.json({
    success: true,
    draft: withDownloadUrls(req, result.draft),
  });
}

async function deleteDraft(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).json({ success: false, message: "Unauthorized" });
  const id = req.params.id;
  const result = await metaStore.softDelete(uid, id);
  if (!result.ok) {
    return res.status(404).json({ success: false, code: "NOT_FOUND" });
  }
  try {
    fileStore.deleteDraftFiles(uid, id);
  } catch {
    /* meta already soft-deleted */
  }
  return res.json({ success: true });
}

/**
 * PUT binary: /api/drafts/:id/media/:role
 * Auth via Bearer (mounted with raw body + verifyIdToken).
 */
async function uploadMedia(req, res) {
  const uid = uidOf(req);
  if (!uid) return res.status(401).send("Unauthorized");
  const draftId = req.params.id;
  const role = req.params.role;
  if (!fileStore.ALLOWED_ROLES.has(role)) {
    return res.status(400).send("invalid role");
  }
  // Ensure draft meta exists (idempotent shell)
  let draft = await metaStore.getDraft(uid, draftId);
  if (!draft) {
    draft = await metaStore.upsertDraft(uid, {
      id: draftId,
      mediaType: role === "thumbnail" ? "image" : "image",
      status: "ready",
    });
  }

  let buffer = null;
  if (Buffer.isBuffer(req.body) && req.body.length) buffer = req.body;
  else if (req.body?.type === "Buffer" && Array.isArray(req.body.data)) {
    buffer = Buffer.from(req.body.data);
  }
  if (!buffer?.length) return res.status(400).send("empty body");

  const contentType =
    req.headers["content-type"] || "application/octet-stream";
  const written = fileStore.writeObject(uid, draftId, role, buffer, contentType);
  if (!written.ok) {
    return res.status(400).json({ success: false, code: written.error });
  }

  const keyField =
    role === "thumbnail"
      ? "thumbnailObjectKey"
      : role === "original"
        ? "originalObjectKey"
        : "activeObjectKey";

  const patched = await metaStore.patchDraft(
    uid,
    draftId,
    {
      [keyField]: written.key,
      mimeType:
        role === "active" || role === "original"
          ? contentType
          : draft.mimeType,
    },
    null,
  );

  return res.json({
    success: true,
    key: written.key,
    size: written.size,
    contentType: written.contentType,
    draft: patched.ok ? withDownloadUrls(req, patched.draft) : draft,
  });
}

/**
 * GET signed media — short TTL query sig.
 * Auth optional if valid sig; still enforces owner path via draft lookup.
 */
async function downloadMedia(req, res) {
  const draftId = req.params.id;
  const role = req.params.role;
  const { exp, sig } = req.query;
  const authUid = uidOf(req);
  const signedOwnerUid = String(req.query.ownerUid || "");
  const hasValidSignature = Boolean(
    signedOwnerUid &&
      fileStore.verifyAccess({
        ownerUid: signedOwnerUid,
        draftId,
        role,
        exp: Number(exp),
        sig: String(sig || ""),
      }),
  );

  if (!authUid && !signedOwnerUid) {
    return res.status(401).send("Unauthorized");
  }

  // A valid signed URL remains usable even if the browser happens to attach a
  // stale Authorization header. Otherwise, a valid bearer grants owner access
  // without requiring a signature.
  const ownerUid = hasValidSignature ? signedOwnerUid : authUid;
  if (!ownerUid) {
    return res.status(403).send("Invalid or expired signature");
  }

  // Ownership: draft must belong to ownerUid
  const draft = await metaStore.getDraft(ownerUid, draftId);
  if (!draft) return res.status(404).send("not found");

  const obj = fileStore.readObject(ownerUid, draftId, role);
  if (!obj) return res.status(404).send("media missing");

  res.setHeader("Content-Type", obj.contentType);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(200).send(obj.buffer);
}

module.exports = {
  listDrafts,
  getDraft,
  upsertDraft,
  patchDraft,
  deleteDraft,
  uploadMedia,
  downloadMedia,
  uploadLimiter,
};
