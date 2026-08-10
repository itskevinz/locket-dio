const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function file(rel) {
  return path.join(root, rel);
}

function read(rel) {
  return fs.readFileSync(file(rel), "utf8");
}

function write(rel, content) {
  fs.mkdirSync(path.dirname(file(rel)), { recursive: true });
  fs.writeFileSync(file(rel), content, "utf8");
}

function replaceOnce(content, needle, replacement, label) {
  const first = content.indexOf(needle);
  if (first < 0) throw new Error(`Không tìm thấy anchor: ${label}`);
  if (content.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`Anchor xuất hiện nhiều hơn một lần: ${label}`);
  }
  return content.slice(0, first) + replacement + content.slice(first + needle.length);
}

const mailerSource = `const EMAIL_BRAND = "Duchi Locket";

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

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
  ).replace(/\\/+$/, "");
}

async function parseResponse(response) {
  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw || null;
  }
  return { data, raw };
}

function buildAdminApologyEmail({ email, displayName, uid }) {
  const targetEmail = clean(email, 320).toLowerCase();
  const name = clean(displayName, 120) || "bạn";
  const safeUid = clean(uid, 180);
  const appUrl = publicAppUrl();
  const subject = \`${'${EMAIL_BRAND}'} | Xin lỗi về việc tài khoản bị khóa nhầm\`;
  const text = [
    EMAIL_BRAND,
    "Thông báo từ hệ thống",
    "",
    \`Chào ${'${name}'},\`,
    "",
    \`Chúng tôi thành thật xin lỗi vì tài khoản ${'${targetEmail}'} đã bị khóa nhầm trong quá trình quản trị.\`,
    "Sau khi kiểm tra, quyền truy cập của tài khoản đã được khôi phục và bạn có thể tiếp tục sử dụng Duchi Locket bình thường.",
    "",
    "Trạng thái tài khoản: Đã mở khóa - Hoạt động bình thường",
    safeUid ? \`UID: ${'${safeUid}'}\` : "",
    "",
    \`Mở Duchi Locket: ${'${appUrl}'}\`,
    "",
    "Rất xin lỗi vì sự bất tiện này và cảm ơn bạn đã thông cảm.",
    "",
    "Email tự động từ Duchi Locket. Bạn không cần phản hồi email này.",
  ].filter(Boolean).join("\\n");

  const html = \`<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${'${escapeHtml(subject)}'}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Tài khoản của bạn đã được khôi phục. Duchi Locket thành thật xin lỗi vì sự bất tiện.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08);">
          <tr>
            <td style="padding:22px 28px;background:#ffffff;border-bottom:1px solid #eef2f7;">
              <div style="font-size:20px;font-weight:800;letter-spacing:.2px;color:#7c3aed;">DUCHI LOCKET</div>
              <div style="margin-top:4px;font-size:12px;color:#64748b;">Thông báo từ hệ thống</div>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 24px;">
              <div style="font-size:13px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.7px;">XIN LỖI</div>
              <h1 style="margin:8px 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">Tài khoản của bạn đã bị khóa nhầm</h1>
              <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">Chào <strong style="color:#0f172a;">${'${escapeHtml(name)}'}</strong>, chúng tôi thành thật xin lỗi vì tài khoản <strong style="color:#0f172a;">${'${escapeHtml(targetEmail)}'}</strong> đã bị khóa nhầm trong quá trình quản trị. Sau khi kiểm tra, quyền truy cập của bạn đã được khôi phục.</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="color:#475569;font-size:14px;">Trạng thái tài khoản</div>
                    <div style="margin-top:5px;color:#0f172a;font-size:16px;font-weight:800;">Đã mở khóa • Hoạt động bình thường</div>
                    ${'${safeUid ? `<div style="margin-top:7px;color:#94a3b8;font-size:12px;font-family:monospace;">UID: ${escapeHtml(safeUid)}</div>` : ""}'}
                  </td>
                </tr>
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
                <tr>
                  <td style="border-radius:10px;background:#111827;">
                    <a href="${'${escapeHtml(appUrl)}'}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Mở Duchi Locket</a>
                  </td>
                </tr>
              </table>

              <p style="margin:24px 0 0;color:#475569;font-size:14px;line-height:1.7;">Rất xin lỗi vì sự bất tiện này và cảm ơn bạn đã thông cảm.</p>
              <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6;">Đây là email được gửi trực tiếp từ bộ phận quản trị Duchi Locket sau khi tài khoản được kiểm tra và khôi phục.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #eef2f7;color:#94a3b8;font-size:11px;line-height:1.6;">
              Email tự động từ Duchi Locket. Bạn không cần phản hồi email này. Vui lòng không gửi mật khẩu, mã OTP hoặc thông tin đăng nhập qua email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>\`.trim();

  return { subject, text, html, appUrl };
}

async function sendAdminApologyEmail({ email, displayName = "", uid = "", idempotencyKey = "" } = {}) {
  const endpoint = clean(process.env.GMAIL_APPS_SCRIPT_URL, 1000);
  const secret = clean(process.env.GMAIL_APPS_SCRIPT_SECRET, 500);
  const fromName = clean(process.env.GMAIL_FROM_NAME, 120) || EMAIL_BRAND;
  const target = clean(email, 320).toLowerCase();

  if (!endpoint || !secret) {
    const error = new Error("Gmail chưa được cấu hình trên Railway.");
    error.code = "EMAIL_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!/^https:\\/\\//i.test(endpoint)) {
    const error = new Error("URL Google Apps Script không hợp lệ.");
    error.code = "EMAIL_RELAY_URL_INVALID";
    error.status = 500;
    throw error;
  }
  if (!target || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(target)) {
    const error = new Error("Tài khoản không có địa chỉ email hợp lệ để gửi lời xin lỗi.");
    error.code = "EMAIL_ADDRESS_INVALID";
    error.status = 400;
    throw error;
  }

  const message = buildAdminApologyEmail({ email: target, displayName, uid });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        "User-Agent": "Duchi-Locket-Admin-Mail/1.0",
      },
      body: JSON.stringify({
        secret,
        to: target,
        subject: message.subject,
        text: message.text,
        html: message.html,
        fromName,
        idempotencyKey: clean(idempotencyKey, 240),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const { data } = await parseResponse(response);
    if (!response.ok || data?.ok !== true) {
      const error = new Error(data?.message || "Gmail relay từ chối gửi email xin lỗi.");
      error.code = data?.code || "EMAIL_RELAY_REJECTED";
      error.status = response.status || 502;
      throw error;
    }
    return {
      ok: true,
      provider: "gmail-apps-script",
      messageId: data?.messageId || null,
      deduped: Boolean(data?.deduped),
    };
  } catch (cause) {
    if (String(cause?.code || "").startsWith("EMAIL_")) throw cause;
    const error = new Error("Gmail gửi email xin lỗi thất bại.");
    error.code = "EMAIL_SEND_FAILED";
    error.status = 502;
    error.cause = cause;
    throw error;
  }
}

module.exports = {
  buildAdminApologyEmail,
  sendAdminApologyEmail,
};
`;

write("api/src/services/adminApologyMailer.js", mailerSource);

let adminRoutes = read("api/src/routes/adminRoutes.js");
if (!adminRoutes.includes('require("../services/adminApologyMailer")')) {
  const importAnchor = 'const { getRequestContext, lookupPublicIpLocation } = require("../services/userActivityContext");\n';
  adminRoutes = replaceOnce(
    adminRoutes,
    importAnchor,
    importAnchor + 'const { sendAdminApologyEmail } = require("../services/adminApologyMailer");\n',
    "admin apology mailer import",
  );
}

if (!adminRoutes.includes('router.post("/users/:uid/apology-email"')) {
  const routeAnchor = 'router.delete("/users/:uid/auth", requireActiveAdminSession, async (req, res) => {';
  const apologyRoute = `router.post("/users/:uid/apology-email", requireActivityDatabase, requireActiveAdminSession, async (req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.adminRole !== "super_admin" && req.adminRole !== "admin") {
    return res.status(403).json({
      success: false,
      code: "ADMIN_PERMISSION_REQUIRED",
      error: "Chỉ Admin hoặc Super Admin mới được gửi email xin lỗi cho người dùng",
    });
  }

  const targetUid = String(req.params.uid || "").trim();
  if (!targetUid) {
    return res.status(400).json({ success: false, code: "USER_UID_REQUIRED", error: "Thiếu UID người dùng" });
  }

  try {
    const user = await getWebUser(targetUid);
    if (!user) {
      return res.status(404).json({ success: false, code: "USER_NOT_FOUND", error: "Không tìm thấy người dùng trong hệ thống Huy Locket" });
    }

    const targetEmail = String(user.email || "").trim().toLowerCase();
    const targetRole = String(user.role || "user").trim().toLowerCase();
    if (targetRole !== "user" || isAdminIdentity(user.uid, targetEmail)) {
      return res.status(403).json({ success: false, code: "PROTECTED_ADMIN", error: "Không gửi email xin lỗi khóa nhầm cho tài khoản quản trị" });
    }
    if (!targetEmail) {
      return res.status(400).json({ success: false, code: "EMAIL_ADDRESS_REQUIRED", error: "Tài khoản này chưa có email để gửi lời xin lỗi" });
    }

    const accountStatus = String(user.account_status || user.accountStatus || "active").trim().toLowerCase();
    if (accountStatus === "locked" || user.disabled === true) {
      return res.status(409).json({
        success: false,
        code: "ACCOUNT_STILL_LOCKED",
        error: "Hãy mở khóa tài khoản trước, sau đó bấm Gửi xin lỗi để email không thông báo sai trạng thái.",
      });
    }

    const requestId = String(req.body?.requestId || crypto.randomUUID()).trim().slice(0, 120);
    const result = await sendAdminApologyEmail({
      email: targetEmail,
      displayName: user.display_name || user.displayName || user.username || "",
      uid: user.uid || targetUid,
      idempotencyKey: \`admin-apology:${'${targetUid}'}:${'${requestId}'}\`,
    });

    await audit(req, "SEND_ACCOUNT_APOLOGY_EMAIL", targetUid, \`Sent account lock apology email to ${'${targetEmail}'}\`);
    return res.status(200).json({
      success: true,
      message: "Đã gửi email xin lỗi tới người dùng.",
      provider: result.provider,
      messageId: result.messageId || null,
      deduped: Boolean(result.deduped),
    });
  } catch (error) {
    console.error("Failed to send admin apology email:", error?.code || error?.message || "unknown");
    await audit(
      req,
      "SEND_ACCOUNT_APOLOGY_EMAIL",
      targetUid,
      \`Failed to send account apology email: ${'${error?.code || error?.message || "unknown"}'}\`,
      "failure",
    );
    const status = Number(error?.status) || 502;
    return res.status(status >= 400 && status < 600 ? status : 502).json({
      success: false,
      code: error?.code || "EMAIL_SEND_FAILED",
      error: error?.message || "Không thể gửi email xin lỗi tới người dùng",
    });
  }
});

`;
  adminRoutes = replaceOnce(adminRoutes, routeAnchor, apologyRoute + routeAnchor, "admin apology route");
}
write("api/src/routes/adminRoutes.js", adminRoutes);

let adminUi = read("src/pages/Public/AdminUsers/index.jsx");
if (!adminUi.includes("const handleSendApologyEmail = async (user) =>")) {
  const handlerAnchor = '  const executeModalAction = async () => {';
  const handler = `  const handleSendApologyEmail = async (user) => {
    const targetEmail = String(user?.email || "").trim();
    if (!targetEmail) {
      SonnerWarning("Không thể gửi email", "Tài khoản này chưa có địa chỉ email.");
      return;
    }
    if (user?.disabled || String(user?.accountStatus || "").toLowerCase() === "locked") {
      SonnerWarning("Hãy mở khóa tài khoản trước", "Sau khi mở khóa, bấm Gửi xin lỗi để hệ thống gửi email khôi phục đúng trạng thái.");
      return;
    }

    const loadingKey = \`apology-${'${user.uid}'}\`;
    setActionLoading(loadingKey);
    const fn = async () => {
      const requestId = globalThis.crypto?.randomUUID?.()
        || \`${'${Date.now()}'}-${'${Math.random().toString(36).slice(2, 10)}'}\`;
      await adminRequest(\`/users/${'${encodeURIComponent(user.uid)}'}/apology-email\`, {
        method: "POST",
        body: JSON.stringify({ requestId }),
      });
      SonnerSuccess(
        "✉️ Đã gửi email xin lỗi",
        \`Email giao diện Duchi Locket đã được gửi tới ${'${targetEmail}'}.\`,
      );
    };

    try {
      await handleActionWithSessionCheck(fn);
    } finally {
      setActionLoading(null);
    }
  };

`;
  adminUi = replaceOnce(adminUi, handlerAnchor, handler + handlerAnchor, "admin apology UI handler");
}

if (!adminUi.includes('title={user.disabled ? "Mở khóa tài khoản trước khi gửi email xin lỗi"')) {
  const revokeButton = `                                      <button
                                        type="button"
                                        className="btn btn-xs bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 rounded-xl font-extrabold h-8 px-3 transition-all"
                                        onClick={() => setActionModal({ type: "revoke", user, reason: "" })}
                                        title="Thu hồi toàn bộ phiên làm việc web"
                                      >
                                        Thu hồi
                                      </button>`;
  const apologyButton = `                                      <button
                                        type="button"
                                        disabled={actionLoading === \`apology-${'${user.uid}'}\` || user.disabled || !user.email}
                                        className={\`btn btn-xs rounded-xl font-extrabold h-8 px-3 transition-all ${'${user.disabled || !user.email ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed" : "bg-violet-50 hover:bg-violet-600 text-violet-700 hover:text-white border border-violet-200"}'}\`}
                                        onClick={() => handleSendApologyEmail(user)}
                                        title={user.disabled ? "Mở khóa tài khoản trước khi gửi email xin lỗi" : user.email ? \`Gửi email xin lỗi tới ${'${user.email}'}\` : "Tài khoản chưa có email"}
                                      >
                                        {actionLoading === \`apology-${'${user.uid}'}\` ? (
                                          <span className="loading loading-spinner loading-xs" />
                                        ) : (
                                          <span>✉️ Gửi xin lỗi</span>
                                        )}
                                      </button>
`;
  adminUi = replaceOnce(adminUi, revokeButton, apologyButton + revokeButton, "admin apology button");
}
write("src/pages/Public/AdminUsers/index.jsx", adminUi);

console.log("Admin apology email patch applied successfully.");
