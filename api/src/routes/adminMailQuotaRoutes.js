const express = require("express");
const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  getUserRole,
  hasActivityDatabase,
} = require("../services/userActivityStore");
const {
  GMAIL_SEND_SCOPE,
  createOAuthState,
  getGoogleOAuthClient,
  getGmailStatus,
  disconnectGmailOAuth,
} = require("../services/gmailApiMailer");

const router = express.Router();
const PUBLIC_URL = String(
  process.env.PUBLIC_URL
    || process.env.PUBLIC_WEB_URL
    || process.env.APP_PUBLIC_URL
    || "https://duchi.vercel.app",
).replace(/\/$/, "");
const GOOGLE_USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
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

    req.adminUid = uid;
    req.adminEmail = email;
    req.adminRole = role === "user" ? "super_admin" : role;
    return next();
  } catch (error) {
    console.warn("Admin Gmail auth failed:", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

router.use(requireAdminIdentity);

router.get("/mail-quota", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const data = await getGmailStatus();
    return res.status(200).json({ success: true, ...data });
  } catch (error) {
    console.error("Failed to read Gmail API status:", error?.code || error?.message || "unknown");
    return res.status(Number(error?.status) || 503).json({
      success: false,
      code: error?.code || "GMAIL_STATUS_FAILED",
      error: error?.message || "Không đọc được trạng thái Gmail API.",
    });
  }
});

router.get("/gmail-oauth-start", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const client = await getGoogleOAuthClient();
    if (!client.clientId || !client.clientSecret) {
      return res.status(503).json({
        success: false,
        code: "GOOGLE_OAUTH_CLIENT_MISSING",
        error: "Chưa có Google OAuth Client ID / Secret. Hệ thống có thể dùng lại cấu hình Google Drive hiện có.",
      });
    }

    const redirectUri = `${PUBLIC_URL}/api/drive-oauth-callback`;
    const state = createOAuthState({
      purpose: "gmail",
      clientId: client.clientId,
      adminUid: req.adminUid,
      adminEmail: req.adminEmail,
    });

    // Request the Gmail permission as a fresh grant instead of incrementally
    // inheriting an older Google Drive-only grant. This avoids storing a refresh
    // token that can authenticate Google but cannot call users.messages.send.
    const requestedScopes = `${GMAIL_SEND_SCOPE} ${GOOGLE_USERINFO_EMAIL_SCOPE}`;
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: requestedScopes,
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "false",
      state,
    });

    return res.status(200).json({
      success: true,
      url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      redirectUri,
      provider: "gmail-api",
      requestedScopes: [GMAIL_SEND_SCOPE, GOOGLE_USERINFO_EMAIL_SCOPE],
    });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      success: false,
      code: error?.code || "GMAIL_OAUTH_START_FAILED",
      error: error?.message || "Không bắt đầu được Gmail OAuth.",
    });
  }
});

router.post("/gmail-disconnect", async (_req, res) => {
  try {
    await disconnectGmailOAuth();
    return res.status(200).json({ success: true, connected: false });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      success: false,
      code: error?.code || "GMAIL_DISCONNECT_FAILED",
      error: error?.message || "Không ngắt được Gmail.",
    });
  }
});

module.exports = router;
