const express = require("express");
const crypto = require("node:crypto");
const {
  exchangeOAuthCode,
  getGoogleOAuthClient,
  getGoogleAccountEmail,
  saveGmailOAuth,
} = require("../services/gmailApiMailer");

const router = express.Router();
const PUBLIC_URL = String(
  process.env.PUBLIC_URL
    || process.env.PUBLIC_WEB_URL
    || process.env.APP_PUBLIC_URL
    || "https://duchi.vercel.app",
).replace(/\/$/, "");

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function stateSecret() {
  return clean(
    process.env.OAUTH_STATE_SECRET
      || process.env.JWT_SECRET
      || process.env.COOKIE_SECRET
      || process.env.LOCKETDIO_SIGNATURE_SECRET,
    4096,
  ) || crypto.createHash("sha256").update("huy-locket-vercel-drive").digest("hex");
}

function verifyState(state) {
  try {
    const [body, sig] = String(state || "").split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
    const left = Buffer.from(sig);
    const right = Buffer.from(expected);
    if (!left.length || left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data?.exp || Number(data.exp) < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function renderResult(res, { ok, title, message }) {
  const safeTitle = String(title || "Gmail OAuth").replace(/[<>]/g, "");
  const safeMessage = String(message || "").replace(/[<>]/g, "");
  const target = `${PUBLIC_URL}/admin/mail${ok ? "?gmail=connected" : "?gmail=error"}`;
  return res.status(ok ? 200 : 400).send(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<body style="margin:0;background:#f5f3ff;font-family:Arial,sans-serif;color:#111827;display:grid;min-height:100vh;place-items:center;padding:20px;box-sizing:border-box">
  <main style="max-width:560px;width:100%;background:#fff;border:1px solid #ddd6fe;border-radius:24px;padding:28px;box-sizing:border-box;box-shadow:0 18px 55px rgba(76,29,149,.14)">
    <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#7c3aed;text-transform:uppercase">Duchi Locket · Gmail API</div>
    <h1 style="font-size:26px;margin:10px 0 8px">${safeTitle}</h1>
    <p style="color:#64748b;line-height:1.65;margin:0 0 20px">${safeMessage}</p>
    <a href="${target}" style="display:inline-block;background:#6d28d9;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:14px">Về Trung tâm Email</a>
  </main>
  <script>setTimeout(()=>location.href=${JSON.stringify(target)},1400)</script>
</body>`);
}

// Reuse the already-authorized Google Drive callback URI so the user does not
// need to add another redirect URI in Google Cloud. Only Gmail-purpose states
// are consumed here; all Drive OAuth callbacks continue to the existing router.
router.get("/drive-oauth-callback", async (req, res, next) => {
  const ctx = verifyState(req.query.state);
  if (!ctx || ctx.purpose !== "gmail") return next();

  try {
    if (req.query.error) {
      return renderResult(res, {
        ok: false,
        title: "Kết nối Gmail thất bại",
        message: clean(req.query.error_description || req.query.error, 500),
      });
    }
    if (!req.query.code) {
      return renderResult(res, {
        ok: false,
        title: "Thiếu mã xác thực Google",
        message: "Google không trả authorization code. Hãy thử kết nối lại.",
      });
    }

    const client = await getGoogleOAuthClient();
    if (!client.clientId || !client.clientSecret || client.clientId !== ctx.clientId) {
      return renderResult(res, {
        ok: false,
        title: "Cấu hình OAuth đã thay đổi",
        message: "Google OAuth Client hiện tại không khớp với phiên kết nối. Hãy mở Trung tâm Email và kết nối lại.",
      });
    }

    const redirectUri = `${PUBLIC_URL}/api/drive-oauth-callback`;
    const token = await exchangeOAuthCode({
      code: req.query.code,
      redirectUri,
      clientId: client.clientId,
      clientSecret: client.clientSecret,
    });
    if (!token.refresh_token) {
      return renderResult(res, {
        ok: false,
        title: "Google chưa cấp refresh token",
        message: "Hãy thử kết nối lại và cho phép Duchi Locket gửi email bằng Gmail.",
      });
    }

    const accountEmail = await getGoogleAccountEmail(token.access_token);
    await saveGmailOAuth({
      refreshToken: token.refresh_token,
      accountEmail,
      updatedBy: ctx.adminEmail || ctx.adminUid || "admin-oauth",
    });

    return renderResult(res, {
      ok: true,
      title: "Đã kết nối Gmail API",
      message: accountEmail
        ? `Tài khoản ${accountEmail} đã sẵn sàng gửi email từ Duchi Locket.`
        : "Gmail đã được ủy quyền và sẵn sàng gửi email từ Duchi Locket.",
    });
  } catch (error) {
    console.error("Gmail OAuth callback failed:", error?.code || error?.message || "unknown");
    return renderResult(res, {
      ok: false,
      title: "Kết nối Gmail thất bại",
      message: error?.message || "Không lưu được Gmail OAuth.",
    });
  }
});

module.exports = router;
