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

function publicAppUrl() {
  return clean(
    process.env.PUBLIC_WEB_URL || process.env.APP_PUBLIC_URL || "https://duchi.vercel.app",
    500,
  ).replace(/\/+$/, "");
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
  const fromName = clean(process.env.GMAIL_FROM_NAME, 120) || "Duchi Locket";

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

  const appUrl = publicAppUrl();
  const logoUrl = `${appUrl}/android-chrome-192x192.png`;
  let appHost = appUrl;
  try {
    appHost = new URL(appUrl).hostname;
  } catch {
    appHost = appUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  }

  const subject = "Duchi Locket | Mã OTP khôi phục PIN quản trị";
  const text = [
    "Duchi Locket Security",
    "Thông báo chính thức từ hệ thống",
    "",
    `Có yêu cầu đặt lại mã PIN quản trị cho ${email}.`,
    `Mã OTP của bạn là: ${otp}`,
    `Mã có hiệu lực trong ${OTP_TTL_MINUTES} phút và tối đa ${MAX_VERIFY_ATTEMPTS} lần nhập sai.`,
    "",
    "Nếu bạn không yêu cầu thao tác này, hãy bỏ qua email và kiểm tra lại phiên đăng nhập quản trị.",
    "Không chia sẻ mã OTP này với bất kỳ ai.",
    "",
    `Mở Duchi Locket: ${appUrl}`,
  ].join("\n");

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(subject)}</title>
  <style>
    @media only screen and (max-width:620px) {
      .email-shell { padding:8px 4px 6px !important; }
      .email-card { border-radius:21px !important; }
      .brand-row { padding:15px 18px !important; }
      .hero { padding:21px 20px 20px !important; }
      .hero-title { font-size:24px !important; line-height:1.2 !important; margin:12px 0 7px !important; }
      .email-body { padding:21px 20px 17px !important; }
      .email-copy { font-size:15px !important; line-height:1.7 !important; }
      .otp-code { font-size:31px !important; letter-spacing:7px !important; }
      .cta-table { width:100% !important; }
      .cta-cell { width:100% !important; text-align:center !important; }
      .cta-link { display:block !important; padding:15px 18px !important; }
      .domain-label { text-align:center !important; font-size:11px !important; }
      .email-footer { padding:15px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f2f8;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Mã OTP khôi phục PIN quản trị · Duchi Locket</div>

  <table class="email-shell" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f2f8;padding:22px 10px 16px;">
    <tr>
      <td align="center">
        <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e7e5ef;border-radius:26px;overflow:hidden;box-shadow:0 16px 44px rgba(49,46,129,.10);">
          <tr>
            <td class="brand-row" style="padding:17px 26px;background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="46" valign="middle" style="width:46px;">
                    <img src="${escapeHtml(logoUrl)}" width="38" height="38" alt="Duchi Locket" style="display:block;width:38px;height:38px;border-radius:12px;border:1px solid #eeeaf8;object-fit:cover;">
                  </td>
                  <td valign="middle" style="padding-left:9px;">
                    <div style="color:#111827;font-size:15px;line-height:1.15;font-weight:900;letter-spacing:.2px;">DUCHI LOCKET</div>
                    <div style="margin-top:4px;color:#9aa1ad;font-size:10px;line-height:1.3;">Thông báo chính thức từ hệ thống</div>
                  </td>
                  <td width="18" align="right" valign="middle"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;"></span></td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="hero" style="padding:23px 26px 22px;background:#5b2cc6;background-image:linear-gradient(110deg,#6d28d9 0%,#4f2fb8 100%);">
              <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.20);color:#ffffff;font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">BẢO MẬT</span>
              <h1 class="hero-title" style="margin:13px 0 7px;font-size:27px;line-height:1.2;letter-spacing:-.55px;color:#ffffff;font-weight:900;">Khôi phục PIN quản trị</h1>
              <div style="max-width:470px;color:#e9ddff;font-size:12px;line-height:1.55;">Mã xác minh dành riêng cho yêu cầu đặt lại PIN quản trị của bạn.</div>
            </td>
          </tr>

          <tr>
            <td class="email-body" style="padding:25px 28px 19px;background:#ffffff;">
              <p class="email-copy" style="margin:0;color:#4b5563;font-size:15px;line-height:1.74;">
                Có yêu cầu đặt lại mã PIN quản trị cho <strong style="color:#111827;">${escapeHtml(email)}</strong>. Nhập mã bên dưới vào trang Duchi Locket để tiếp tục.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:21px;background:#faf8ff;border:1px solid #e8e3ff;border-radius:16px;">
                <tr>
                  <td align="center" style="padding:20px 16px 18px;">
                    <div style="font-size:10px;font-weight:900;color:#7c3aed;text-transform:uppercase;letter-spacing:1px;">MÃ OTP</div>
                    <div class="otp-code" style="margin-top:9px;color:#111827;font-family:Consolas,Monaco,monospace;font-size:35px;line-height:1.2;font-weight:900;letter-spacing:9px;">${escapeHtml(otp)}</div>
                    <div style="margin-top:11px;color:#8b93a5;font-size:11px;line-height:1.5;">Hết hạn sau ${OTP_TTL_MINUTES} phút&nbsp;&nbsp;·&nbsp;&nbsp;Tối đa ${MAX_VERIFY_ATTEMPTS} lần nhập sai</div>
                  </td>
                </tr>
              </table>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:16px;background:#fafafa;border:1px solid #ececf1;border-radius:16px;">
                <tr>
                  <td style="padding:15px 17px;">
                    <div style="font-size:10px;font-weight:900;color:#8b93a5;text-transform:uppercase;letter-spacing:.85px;">TRẠNG THÁI BẢO MẬT</div>
                    <div style="margin-top:5px;color:#6d28d9;font-size:14px;line-height:1.4;font-weight:900;">OTP đang hoạt động · Chỉ dùng một lần</div>
                  </td>
                </tr>
              </table>

              <table class="cta-table" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:21px;">
                <tr>
                  <td class="cta-cell" style="border-radius:14px;background:#6d28d9;background-image:linear-gradient(90deg,#7c3aed 0%,#4f46e5 100%);box-shadow:0 9px 22px rgba(79,70,229,.22);">
                    <a class="cta-link" href="${escapeHtml(appUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:900;border-radius:14px;">Mở Duchi Locket&nbsp;&nbsp;→</a>
                  </td>
                </tr>
              </table>
              <div class="domain-label" style="margin-top:9px;color:#8b93a5;font-size:11px;line-height:1.4;font-weight:700;letter-spacing:.1px;">${escapeHtml(appHost)}</div>

              <p style="margin:18px 0 0;color:#6b7280;font-size:13px;line-height:1.68;">Không chia sẻ OTP với bất kỳ ai. Nếu bạn không yêu cầu đặt lại PIN, hãy bỏ qua email này và kiểm tra lại phiên đăng nhập quản trị.</p>
            </td>
          </tr>

          <tr>
            <td class="email-footer" style="padding:15px 26px;background:#f8f8fb;border-top:1px solid #eeedf3;">
              <div style="color:#7f8796;font-size:11px;line-height:1.6;">
                <strong style="color:#5f6673;">Duchi Locket Security</strong><br>
                Email tự động, bạn không cần phản hồi. OTP chỉ được gửi khi bạn chủ động yêu cầu khôi phục PIN; Duchi Locket không bao giờ yêu cầu bạn gửi lại OTP qua email.
              </div>
            </td>
          </tr>
        </table>

        <div style="max-width:600px;margin:8px auto 0;text-align:center;color:#9ca3af;font-size:10px;line-height:1.4;">© Duchi Locket · Thông báo hệ thống</div>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();

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
