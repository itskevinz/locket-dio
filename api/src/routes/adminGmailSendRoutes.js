const express = require("express");
const crypto = require("node:crypto");
const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  getUserRole,
  hasActivityDatabase,
  verifyAdminSessionToken,
  writeAudit,
} = require("../services/userActivityStore");
const { getRequestContext } = require("../services/userActivityContext");
const {
  buildAdminEmail,
  getMailTemplates,
  normalizeTemplate,
} = require("../services/adminApologyMailer");
const { sendGmailMessage } = require("../services/gmailApiMailer");

const router = express.Router();

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

async function requireAdmin(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }

  try {
    const decodedToken = await getLocketAuthVerifier().verifyIdToken(authorization.slice(7), false);
    const email = clean(decodedToken.email, 320).toLowerCase();
    const allowedUids = getAdminLocketUids();
    const allowedEmails = getAdminLocketEmails();

    let role = "user";
    if (hasActivityDatabase()) {
      role = await getUserRole(decodedToken.uid, email);
    } else if (allowedUids.has(decodedToken.uid) || allowedEmails.has(email)) {
      role = "super_admin";
    }

    if (role === "user" && !allowedUids.has(decodedToken.uid) && !allowedEmails.has(email)) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Admin permission required",
      });
    }

    req.adminUid = decodedToken.uid;
    req.adminEmail = email || null;
    req.adminRole = role === "user" ? "super_admin" : role;
    req.authTime = decodedToken.auth_time || Math.floor(Date.now() / 1000);
    return next();
  } catch (error) {
    console.warn("[admin-gmail] auth failed", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

async function requireActiveAdminSession(req, res, next) {
  const sessionToken = req.headers["x-admin-session"];
  if (sessionToken && typeof sessionToken === "string" && hasActivityDatabase()) {
    const hash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    if (await verifyAdminSessionToken(req.adminUid, hash, 30)) return next();
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - (req.authTime || 0) < 1800) return next();
  return res.status(401).json({
    success: false,
    code: "ADMIN_SESSION_EXPIRED",
    error: "Phiên quản trị nhạy cảm đã hết hạn. Vui lòng xác minh lại mã PIN.",
  });
}

async function audit(req, action, targetUid, details, status = "success") {
  if (!hasActivityDatabase()) return;
  try {
    const ctx = getRequestContext(req);
    await writeAudit({
      adminUid: req.adminUid,
      role: req.adminRole || "unknown",
      action,
      targetUid: targetUid || null,
      details,
      ipAddress: ctx.ipAddress,
      webSource: ctx.webSource,
      status,
    });
  } catch (error) {
    console.warn("[admin-gmail] audit failed", error?.code || error?.message || "unknown");
  }
}

router.use(requireAdmin);

router.get("/mail-templates", (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(200).json({ success: true, templates: getMailTemplates() });
});

router.post("/mail-preview", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const email = clean(req.body?.email || req.adminEmail || "preview@example.com", 320).toLowerCase();
  const template = normalizeTemplate(req.body?.template);
  const customMessage = clean(req.body?.customMessage, 2500);
  const preview = buildAdminEmail({
    email,
    displayName: clean(req.body?.displayName, 120) || "Người dùng",
    uid: clean(req.body?.uid, 180),
    template,
    customMessage,
  });
  return res.status(200).json({
    success: true,
    preview: {
      template: preview.template,
      label: preview.label,
      subject: preview.subject,
      title: preview.title,
      badge: preview.badge,
      statusLabel: preview.statusLabel,
      html: preview.html,
    },
  });
});

router.post("/apology-email", requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({ success: false, code: "ADMIN_PERMISSION_REQUIRED", error: "Không có quyền gửi email quản trị." });
  }

  const email = clean(req.body?.email, 320).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, code: "EMAIL_ADDRESS_INVALID", error: "Email người nhận không hợp lệ." });
  }
  const template = normalizeTemplate(req.body?.template);
  const customMessage = clean(req.body?.customMessage, 2500);
  const requestId = clean(req.body?.requestId, 240) || crypto.randomUUID();
  const message = buildAdminEmail({
    email,
    displayName: clean(req.body?.displayName, 120) || "bạn",
    uid: clean(req.body?.uid, 180),
    template,
    customMessage,
  });

  try {
    const result = await sendGmailMessage({
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      fromName: clean(process.env.GMAIL_FROM_NAME, 120) || "Duchi Locket",
      idempotencyKey: `admin-mail:${req.adminUid}:${requestId}`,
    });
    await audit(req, "SEND_ADMIN_MAIL", null, `Gmail API sent ${template} email to ${email}`);
    return res.status(200).json({
      success: true,
      email,
      provider: result.provider,
      messageId: result.messageId || null,
      deduped: Boolean(result.deduped),
      template,
    });
  } catch (error) {
    await audit(req, "SEND_ADMIN_MAIL", null, `Gmail API send failed to ${email}: ${error?.code || "unknown"}`, "failure");
    return res.status(Number(error?.status) || 502).json({
      success: false,
      code: error?.code || "EMAIL_SEND_FAILED",
      error: error?.message || "Gmail API gửi thư thất bại.",
    });
  }
});

router.post("/system/test-email", requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const email = clean(req.adminEmail, 320).toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, code: "ADMIN_EMAIL_REQUIRED", error: "Tài khoản Admin chưa có email để test Gmail." });
  }

  const message = buildAdminEmail({
    email,
    displayName: "Admin",
    uid: req.adminUid,
    template: "feature",
    customMessage: `Đây là email kiểm tra Gmail API từ Admin Email Center lúc ${new Date().toISOString()}.`,
  });
  try {
    const result = await sendGmailMessage({
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      fromName: clean(process.env.GMAIL_FROM_NAME, 120) || "Duchi Locket",
      idempotencyKey: `admin-gmail-self-test:${req.adminUid}:${Date.now()}`,
    });
    await audit(req, "TEST_ADMIN_EMAIL", req.adminUid, `Gmail API self-test to ${email}`);
    return res.status(200).json({
      success: true,
      email,
      provider: result.provider,
      messageId: result.messageId || null,
    });
  } catch (error) {
    await audit(req, "TEST_ADMIN_EMAIL", req.adminUid, `Gmail API self-test failed: ${error?.code || "unknown"}`, "failure");
    return res.status(Number(error?.status) || 502).json({
      success: false,
      code: error?.code || "EMAIL_SEND_FAILED",
      error: error?.message || "Gmail API test thất bại.",
    });
  }
});

module.exports = router;
