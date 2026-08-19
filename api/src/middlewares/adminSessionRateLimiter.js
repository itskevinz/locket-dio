const crypto = require("node:crypto");
const rateLimit = require("express-rate-limit");
const { extractBestPublicIp } = require("../services/userActivityContext");

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 32);
}

function adminSessionKey(req) {
  const shortSession = String(req.headers?.["x-admin-session"] || "").trim();
  if (shortSession) return `admin-session:${fingerprint(shortSession)}`;

  const authorization = String(req.headers?.authorization || "").trim();
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const bearer = String(match?.[1] || "").trim();
  if (bearer) return `admin-bearer:${fingerprint(bearer)}`;

  const ip = extractBestPublicIp(req) || req.ip || "unknown";
  return `admin-ip:${ip}`;
}

// Admin UI performs status, templates, history and debounced preview requests.
// Keep flood protection but isolate each authenticated admin session instead of
// sharing one IP bucket behind Vercel's proxy layer.
const adminSessionLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminSessionKey,
  handler: (_req, res) => {
    res.set("Retry-After", "60");
    res.status(429).json({
      success: false,
      code: "RATE_LIMITED",
      error: "Quá nhiều yêu cầu quản trị. Vui lòng thử lại sau.",
    });
  },
});

module.exports = { adminSessionLimit, adminSessionKey };
