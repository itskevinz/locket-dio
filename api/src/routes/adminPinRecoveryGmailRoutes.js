const express = require("express");
const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");
const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  getUserRole,
  hasActivityDatabase,
  writeAudit,
} = require("../services/userActivityStore");
const { getRequestContext } = require("../services/userActivityContext");
const { getGmailStatus, sendGmailMessage } = require("../services/gmailApiMailer");

const router = express.Router();
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
let schemaPromise = null;

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function getSql() {
  const databaseUrl = [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim();
  return databaseUrl ? neon(databaseUrl) : null;
}

async function ensureSchema() {
  const sql = getSql();
  if (!sql) {
    const error = new Error("Database quản trị chưa được cấu hình.");
    error.code = "DATABASE_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (schemaPromise) return schemaPromise;
  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS admin_pin_recovery (
        uid TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        resend_after TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        verified_token_hash TEXT,
        verified_expires_at TIMESTAMPTZ,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });
  return schemaPromise;
}

function hashOtp(uid, otp) {
  if (JWT_SECRET.length < 32) {
    const error = new Error("JWT_SECRET chưa được cấu hình an toàn.");
    error.code = "JWT_SECRET_INVALID";
    error.status = 500;
    throw error;
  }
  return crypto.createHmac("sha256", JWT_SECRET).update(`otp:${uid}:${otp}`).digest("hex");
}

function maskEmail(email) {
  const value = clean(email, 320).toLowerCase();
  const [local, domain] = value.split("@");
  if (!local || !domain) return value;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function publicAppUrl() {
  return clean(
    process.env.PUBLIC_WEB_URL || process.env.APP_PUBLIC_URL || "https://duchi.vercel.app",
    500,
  ).replace(/\/+$/, "");
}

async function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
  try {
    const decodedToken = await getLocketAuthVerifier().verifyIdToken(authorization.slice(7), false);
    const uid = clean(decodedToken.uid, 160);
    const email = clean(decodedToken.email, 320).toLowerCase();
    const allowedUids = getAdminLocketUids();
    const allowedEmails = getAdminLocketEmails();
    let role = "user";
    if (hasActivityDatabase()) role = await getUserRole(uid, email);
    else if (allowedUids.has(uid) || allowedEmails.has(email)) role = "super_admin";

    if (role === "user" && !allowedUids.has(uid) && !allowedEmails.has(email)) {
      return res.status(403).json({ success: false, code: "ADMIN_PERMISSION_REQUIRED", error: "Admin permission required" });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, code: "ADMIN_EMAIL_REQUIRED", error: "Tài khoản quản trị chưa có email hợp lệ để khôi phục PIN." });
    }
    req.adminUid = uid;
    req.adminEmail = email;
    req.adminRole = role === "user" ? "super_admin" : role;
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

async function audit(req, action, details, status = "success") {
  if (!hasActivityDatabase()) return;
  try {
    const ctx = getRequestContext(req);
    await writeAudit({
      adminUid: req.adminUid,
      role: req.adminRole || "unknown",
      action,
      targetUid: req.adminUid,
      details,
      ipAddress: ctx.ipAddress,
      webSource: ctx.webSource,
      status,
    });
  } catch {}
}

function buildOtpMessage(email, otp) {
  const appUrl = publicAppUrl();
  const subject = "Duchi Locket | Mã OTP khôi phục PIN quản trị";
  const text = [
    "Duchi Locket Security",
    "Thông báo chính thức từ hệ thống",
    "",
    `Có yêu cầu đặt lại mã PIN quản trị cho ${email}.`,
    `Mã OTP của bạn là: ${otp}`,
    `Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.`,
    "",
    "Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email.",
    "Không chia sẻ mã OTP này với bất kỳ ai.",
    "",
    `Mở Duchi Locket: ${appUrl}`,
  ].join("\n");
  const html = `<!doctype html><html lang="vi"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f3f2f8;font-family:Arial,sans-serif;color:#111827"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:22px 10px;background:#f3f2f8"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e7e5ef;border-radius:24px;overflow:hidden"><tr><td style="padding:18px 26px;font-weight:900">DUCHI LOCKET</td></tr><tr><td style="padding:24px 26px;background:#5b2cc6;color:#fff"><div style="font-size:11px;font-weight:900;letter-spacing:1px">BẢO MẬT</div><h1 style="margin:10px 0 6px;font-size:27px">Khôi phục PIN quản trị</h1><div style="color:#e9ddff;font-size:13px">Mã xác minh chỉ dùng cho yêu cầu đặt lại PIN của bạn.</div></td></tr><tr><td style="padding:26px"><p style="margin:0;color:#4b5563;line-height:1.7">Có yêu cầu đặt lại PIN cho <strong>${escapeHtml(email)}</strong>.</p><div style="margin-top:20px;padding:20px;text-align:center;background:#faf8ff;border:1px solid #e8e3ff;border-radius:16px"><div style="font-size:10px;font-weight:900;color:#7c3aed;letter-spacing:1px">MÃ OTP</div><div style="margin-top:8px;font-family:Consolas,monospace;font-size:34px;font-weight:900;letter-spacing:8px">${escapeHtml(otp)}</div><div style="margin-top:10px;color:#8b93a5;font-size:11px">Hết hạn sau ${OTP_TTL_MINUTES} phút</div></div><p style="margin:20px 0 0;color:#6b7280;font-size:13px;line-height:1.65">Không chia sẻ OTP với bất kỳ ai. Nếu bạn không yêu cầu đặt lại PIN, hãy bỏ qua email này.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

router.use(requireAdmin);

router.post("/pin/recovery/request", async (req, res, next) => {
  // Until the one-time Gmail OAuth connection is complete, pass through to
  // the existing Apps Script route so PIN recovery keeps working during rollout.
  const gmail = await getGmailStatus().catch(() => null);
  if (!gmail?.connected) return next();

  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    await ensureSchema();
    const sql = getSql();
    const existing = await sql`SELECT resend_after FROM admin_pin_recovery WHERE uid = ${req.adminUid} LIMIT 1`;
    const resendAfter = existing[0]?.resend_after ? new Date(existing[0].resend_after).getTime() : 0;
    const waitMs = resendAfter - Date.now();
    if (waitMs > 0) {
      return res.status(429).json({
        success: false,
        code: "OTP_RESEND_COOLDOWN",
        retryAfterSeconds: Math.ceil(waitMs / 1000),
        error: `Vui lòng chờ ${Math.ceil(waitMs / 1000)} giây trước khi gửi lại OTP.`,
      });
    }

    const otp = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
    const otpHash = hashOtp(req.adminUid, otp);
    await sql`
      INSERT INTO admin_pin_recovery (
        uid, email, otp_hash, expires_at, resend_after, attempts,
        verified_token_hash, verified_expires_at, verified_at, created_at, updated_at
      ) VALUES (
        ${req.adminUid}, ${req.adminEmail}, ${otpHash},
        NOW() + INTERVAL '10 minutes', NOW() + INTERVAL '60 seconds', 0,
        NULL, NULL, NULL, NOW(), NOW()
      )
      ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email,
        otp_hash = EXCLUDED.otp_hash,
        expires_at = EXCLUDED.expires_at,
        resend_after = EXCLUDED.resend_after,
        attempts = 0,
        verified_token_hash = NULL,
        verified_expires_at = NULL,
        verified_at = NULL,
        updated_at = NOW()
    `;

    const message = buildOtpMessage(req.adminEmail, otp);
    try {
      await sendGmailMessage({
        to: req.adminEmail,
        subject: message.subject,
        text: message.text,
        html: message.html,
        fromName: clean(process.env.GMAIL_FROM_NAME, 120) || "Duchi Locket",
        idempotencyKey: `admin-pin-recovery:${req.adminUid}:${Date.now()}`,
      });
    } catch (error) {
      await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`.catch(() => {});
      throw error;
    }

    await audit(req, "ADMIN_PIN_RECOVERY_OTP_SENT", "Recovery OTP sent through Gmail API");
    return res.status(200).json({
      success: true,
      maskedEmail: maskEmail(req.adminEmail),
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      provider: "gmail-api",
      message: "Đã gửi OTP khôi phục PIN đến email quản trị.",
    });
  } catch (error) {
    console.error("Admin PIN Gmail OTP request failed:", error?.code || error?.message || "unknown");
    await audit(req, "ADMIN_PIN_RECOVERY_OTP_FAILED", error?.code || error?.message || "unknown", "failure");
    return res.status(Number(error?.status) || 500).json({
      success: false,
      code: error?.code || "PIN_RECOVERY_REQUEST_FAILED",
      error: error?.message || "Không thể gửi OTP khôi phục PIN.",
    });
  }
});

module.exports = router;
