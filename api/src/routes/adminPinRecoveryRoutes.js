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
  setAdminPin,
  writeAudit,
} = require("../services/userActivityStore");
const { getRequestContext } = require("../services/userActivityContext");

const router = express.Router();
const OTP_TTL_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
let schemaPromise = null;

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function getDatabaseUrl() {
  return [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim() || null;
}

function getSql() {
  const databaseUrl = getDatabaseUrl();
  return databaseUrl ? neon(databaseUrl) : null;
}

async function ensureRecoverySchema() {
  const sql = getSql();
  if (!sql) {
    const error = new Error("Database quản trị chưa được cấu hình.");
    error.code = "DATABASE_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (schemaPromise) return schemaPromise;
  schemaPromise = sql`
    CREATE TABLE IF NOT EXISTS admin_pin_recovery (
      uid TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      resend_after TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `.catch((error) => {
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
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${uid}:${otp}`)
    .digest("hex");
}

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left || ""), "hex");
    const b = Buffer.from(String(right || ""), "hex");
    return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
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

async function requireAdminIdentity(req, res, next) {
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
    if (hasActivityDatabase()) {
      role = await getUserRole(uid, email);
    } else if (allowedUids.has(uid) || allowedEmails.has(email)) {
      role = "super_admin";
    }

    if (role === "user" && !allowedUids.has(uid) && !allowedEmails.has(email)) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Admin permission required",
      });
    }
    if (role === "user") role = "super_admin";

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        code: "ADMIN_EMAIL_REQUIRED",
        error: "Tài khoản quản trị chưa có email hợp lệ để khôi phục PIN.",
      });
    }

    req.adminUid = uid;
    req.adminEmail = email;
    req.adminRole = role;
    return next();
  } catch (error) {
    console.warn("Admin PIN recovery auth failed:", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

async function audit(req, action, details, status = "success") {
  try {
    const context = getRequestContext(req);
    await writeAudit({
      adminUid: req.adminUid,
      role: req.adminRole || "unknown",
      action,
      targetUid: req.adminUid,
      details,
      ipAddress: context.ipAddress,
      webSource: context.webSource,
      status,
    });
  } catch (error) {
    console.warn("Admin PIN recovery audit failed:", error?.message || "unknown");
  }
}

async function sendRecoveryEmail({ email, otp, idempotencyKey }) {
  const endpoint = clean(process.env.GMAIL_APPS_SCRIPT_URL, 1000);
  const secret = clean(process.env.GMAIL_APPS_SCRIPT_SECRET, 500);
  const fromName = clean(process.env.GMAIL_FROM_NAME, 120) || "Huy Locket";

  if (!endpoint || !secret) {
    const error = new Error("Gmail chưa được cấu hình trên hệ thống.");
    error.code = "EMAIL_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!/^https:\/\//i.test(endpoint)) {
    const error = new Error("URL Google Apps Script không hợp lệ.");
    error.code = "EMAIL_RELAY_URL_INVALID";
    error.status = 500;
    throw error;
  }

  const subject = "Huy Locket | Mã OTP khôi phục PIN quản trị";
  const text = [
    "Huy Locket Security",
    "",
    `Mã OTP khôi phục PIN quản trị của bạn là: ${otp}`,
    `Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút.`,
    "",
    "Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email và kiểm tra lại phiên đăng nhập quản trị.",
    "Không chia sẻ mã OTP này với bất kỳ ai.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="vi">
<body style="margin:0;padding:0;background:#f4f4f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="padding:24px 10px;background:#f4f4f8;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e7eb;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.08);">
        <tr><td style="padding:24px 26px;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#ffffff;">
          <div style="font-size:11px;font-weight:900;letter-spacing:1.2px;">HUY LOCKET · SECURITY</div>
          <h1 style="margin:10px 0 0;font-size:25px;line-height:1.25;">Khôi phục PIN quản trị</h1>
        </td></tr>
        <tr><td style="padding:26px;">
          <p style="margin:0;color:#4b5563;font-size:15px;line-height:1.7;">Có yêu cầu đặt lại mã PIN quản trị cho <strong style="color:#111827;">${escapeHtml(email)}</strong>.</p>
          <div style="margin:24px 0;padding:20px;text-align:center;border:1px solid #ddd6fe;background:#faf7ff;border-radius:18px;">
            <div style="font-size:11px;font-weight:900;color:#7c3aed;letter-spacing:1px;">MÃ OTP</div>
            <div style="margin-top:8px;font-family:Consolas,Monaco,monospace;font-size:34px;letter-spacing:8px;font-weight:900;color:#111827;">${escapeHtml(otp)}</div>
            <div style="margin-top:9px;color:#6b7280;font-size:12px;">Hết hạn sau ${OTP_TTL_MINUTES} phút · Tối đa ${MAX_VERIFY_ATTEMPTS} lần nhập sai</div>
          </div>
          <p style="margin:0;color:#6b7280;font-size:13px;line-height:1.65;">Không chia sẻ OTP. Nếu bạn không yêu cầu đặt lại PIN, hãy bỏ qua email này.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "User-Agent": "Huy-Locket-Admin-Pin-Recovery/1.0",
    },
    body: JSON.stringify({
      secret,
      to: email,
      subject,
      text,
      html,
      fromName,
      idempotencyKey: clean(idempotencyKey, 240),
    }),
    signal: AbortSignal.timeout(15000),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.message || "Gmail relay từ chối gửi OTP.");
    error.code = data?.code || "EMAIL_RELAY_REJECTED";
    error.status = response.status || 502;
    throw error;
  }
  return data;
}

router.use(requireAdminIdentity);

router.post("/pin/recovery/request", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    await ensureRecoverySchema();
    const sql = getSql();
    const existing = await sql`
      SELECT resend_after
      FROM admin_pin_recovery
      WHERE uid = ${req.adminUid}
      LIMIT 1
    `;
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
        uid, email, otp_hash, expires_at, resend_after, attempts, created_at, updated_at
      ) VALUES (
        ${req.adminUid}, ${req.adminEmail}, ${otpHash},
        NOW() + INTERVAL '10 minutes', NOW() + INTERVAL '60 seconds', 0, NOW(), NOW()
      )
      ON CONFLICT (uid) DO UPDATE SET
        email = EXCLUDED.email,
        otp_hash = EXCLUDED.otp_hash,
        expires_at = EXCLUDED.expires_at,
        resend_after = EXCLUDED.resend_after,
        attempts = 0,
        updated_at = NOW()
    `;

    try {
      await sendRecoveryEmail({
        email: req.adminEmail,
        otp,
        idempotencyKey: `admin-pin-recovery:${req.adminUid}:${Date.now()}`,
      });
    } catch (error) {
      await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`.catch(() => {});
      throw error;
    }

    await audit(req, "ADMIN_PIN_RECOVERY_OTP_SENT", "Recovery OTP sent to authenticated admin email");
    return res.status(200).json({
      success: true,
      maskedEmail: maskEmail(req.adminEmail),
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      message: "Đã gửi OTP khôi phục PIN đến email quản trị.",
    });
  } catch (error) {
    console.error("Admin PIN recovery OTP request failed:", error?.message || "unknown");
    await audit(req, "ADMIN_PIN_RECOVERY_OTP_FAILED", error?.code || error?.message || "unknown", "failure");
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "PIN_RECOVERY_REQUEST_FAILED",
      error: error?.message || "Không thể gửi OTP khôi phục PIN.",
    });
  }
});

router.post("/pin/recovery/verify", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    await ensureRecoverySchema();
    const sql = getSql();
    const otp = clean(req.body?.otp, 12);
    const newPin = clean(req.body?.newPin, 12);

    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, code: "INVALID_OTP_FORMAT", error: "OTP phải gồm đúng 6 chữ số." });
    }
    if (!/^\d{4,8}$/.test(newPin)) {
      return res.status(400).json({ success: false, code: "INVALID_PIN_FORMAT", error: "PIN mới phải gồm từ 4 đến 8 chữ số." });
    }

    const rows = await sql`
      SELECT otp_hash, expires_at, attempts
      FROM admin_pin_recovery
      WHERE uid = ${req.adminUid}
      LIMIT 1
    `;
    const recovery = rows[0];
    if (!recovery) {
      return res.status(404).json({ success: false, code: "RECOVERY_NOT_FOUND", error: "Chưa có yêu cầu khôi phục PIN. Hãy gửi OTP trước." });
    }

    if (new Date(recovery.expires_at).getTime() <= Date.now()) {
      await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`;
      return res.status(401).json({ success: false, code: "OTP_EXPIRED", error: "OTP đã hết hạn. Hãy yêu cầu mã mới." });
    }

    const attempts = Number(recovery.attempts || 0);
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`;
      return res.status(429).json({ success: false, code: "OTP_ATTEMPTS_EXCEEDED", error: "Đã nhập sai OTP quá nhiều lần. Hãy yêu cầu mã mới." });
    }

    const candidateHash = hashOtp(req.adminUid, otp);
    if (!safeEqualHex(candidateHash, recovery.otp_hash)) {
      const nextAttempts = attempts + 1;
      if (nextAttempts >= MAX_VERIFY_ATTEMPTS) {
        await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`;
      } else {
        await sql`
          UPDATE admin_pin_recovery
          SET attempts = ${nextAttempts}, updated_at = NOW()
          WHERE uid = ${req.adminUid}
        `;
      }
      await audit(req, "ADMIN_PIN_RECOVERY_OTP_INVALID", `Invalid recovery OTP attempt ${nextAttempts}/${MAX_VERIFY_ATTEMPTS}`, "failure");
      return res.status(401).json({
        success: false,
        code: "INVALID_RECOVERY_OTP",
        remainingAttempts: Math.max(0, MAX_VERIFY_ATTEMPTS - nextAttempts),
        error: nextAttempts >= MAX_VERIFY_ATTEMPTS
          ? "OTP không đúng và đã hết số lần thử. Hãy yêu cầu mã mới."
          : `OTP không chính xác. Còn ${MAX_VERIFY_ATTEMPTS - nextAttempts} lần thử.`,
      });
    }

    await setAdminPin(req.adminUid, newPin, req.adminRole);
    await sql`DELETE FROM admin_pin_recovery WHERE uid = ${req.adminUid}`;
    await sql`DELETE FROM admin_sessions WHERE uid = ${req.adminUid}`;
    await audit(req, "ADMIN_PIN_RECOVERY_SUCCESS", "Admin PIN reset through verified email OTP");

    return res.status(200).json({
      success: true,
      message: "Đã đặt PIN quản trị mới. Hãy dùng PIN mới để mở khóa trung tâm quản trị.",
    });
  } catch (error) {
    console.error("Admin PIN recovery verify failed:", error?.message || "unknown");
    await audit(req, "ADMIN_PIN_RECOVERY_FAILED", error?.code || error?.message || "unknown", "failure");
    return res.status(error?.status || 500).json({
      success: false,
      code: error?.code || "PIN_RECOVERY_VERIFY_FAILED",
      error: error?.message || "Không thể đặt lại PIN quản trị.",
    });
  }
});

module.exports = router;
