const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT_BASE =
  process.env.DRAFT_MEDIA_DIR ||
  process.env.RAILWAY_VOLUME_MOUNT_PATH ||
  path.join(os.tmpdir(), "huy-locket-media");
const ROOT = path.join(ROOT_BASE, "published-media");
const MAX_BYTES = Number(process.env.PUBLISHED_MEDIA_MAX_BYTES || 25 * 1024 * 1024);

const MIME_EXT = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
};

function ensureRoot() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function normalizeMime(contentType) {
  const mime = String(contentType || "image/webp").toLowerCase().split(";")[0].trim();
  return MIME_EXT[mime] ? mime : "image/webp";
}

function publishBuffer(buffer, contentType = "image/webp") {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Published media buffer is empty");
  }
  if (buffer.length > MAX_BYTES) {
    const err = new Error("Published media is too large");
    err.status = 413;
    throw err;
  }

  ensureRoot();
  const mime = normalizeMime(contentType);
  const ext = MIME_EXT[mime];
  const id = crypto.randomBytes(24).toString("hex");
  const filename = `${id}.${ext}`;
  const filePath = path.join(ROOT, filename);
  const metaPath = `${filePath}.json`;

  fs.writeFileSync(filePath, buffer);
  fs.writeFileSync(
    metaPath,
    JSON.stringify({
      contentType: mime,
      size: buffer.length,
      createdAt: Date.now(),
    }),
  );

  return { id, filename, contentType: mime, size: buffer.length };
}

function readPublished(filename) {
  const safeName = String(filename || "").toLowerCase();
  if (!/^[a-f0-9]{48}\.(webp|jpg|jpeg|png)$/.test(safeName)) return null;

  const filePath = path.join(ROOT, safeName);
  if (!fs.existsSync(filePath)) return null;

  let meta = {};
  try {
    meta = JSON.parse(fs.readFileSync(`${filePath}.json`, "utf8"));
  } catch {
    // Keep serving the file even if the sidecar was lost.
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    contentType: meta.contentType || "application/octet-stream",
    size: buffer.length,
  };
}

function getPublicBaseUrl() {
  const explicit = String(process.env.PUBLIC_API_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const serviceUrl = String(process.env.RAILWAY_SERVICE_HUY_LOCKET_API_URL || "").trim();
  if (serviceUrl) {
    const normalized = /^https?:\/\//i.test(serviceUrl) ? serviceUrl : `https://${serviceUrl}`;
    return normalized.replace(/\/$/, "");
  }

  const staticUrl = String(process.env.RAILWAY_STATIC_URL || "").trim();
  if (staticUrl) {
    const normalized = /^https?:\/\//i.test(staticUrl) ? staticUrl : `https://${staticUrl}`;
    return normalized.replace(/\/$/, "");
  }

  const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || "").trim();
  if (domain) return `https://${domain.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;

  throw new Error("No public API URL is available for published media fallback");
}

function buildPublicUrl(filename) {
  return `${getPublicBaseUrl()}/api/published-media/${encodeURIComponent(filename)}`;
}

module.exports = {
  publishBuffer,
  readPublished,
  buildPublicUrl,
  ROOT,
};
