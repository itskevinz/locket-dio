const EMAIL_BRAND = "Duchi Locket";

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
  ).replace(/\/+$/, "");
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
  const subject = `${EMAIL_BRAND} | Xin lỗi về việc tài khoản bị khóa nhầm`;
  const text = [
    EMAIL_BRAND,
    "Thông báo từ hệ thống",
    "",
    `Chào ${name},`,
    "",
    `Chúng tôi thành thật xin lỗi vì tài khoản ${targetEmail} đã bị khóa nhầm trong quá trình quản trị.`,
    "Sau khi kiểm tra, quyền truy cập của tài khoản đã được khôi phục và bạn có thể tiếp tục sử dụng Duchi Locket bình thường.",
    "",
    "Trạng thái tài khoản: Đã mở khóa - Hoạt động bình thường",
    safeUid ? `UID: ${safeUid}` : "",
    "",
    `Mở Duchi Locket: ${appUrl}`,
    "",
    "Rất xin lỗi vì sự bất tiện này và cảm ơn bạn đã thông cảm.",
    "",
    "Email tự động từ Duchi Locket. Bạn không cần phản hồi email này.",
  ].filter(Boolean).join("\n");

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
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
              <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">Chào <strong style="color:#0f172a;">${escapeHtml(name)}</strong>, chúng tôi thành thật xin lỗi vì tài khoản <strong style="color:#0f172a;">${escapeHtml(targetEmail)}</strong> đã bị khóa nhầm trong quá trình quản trị. Sau khi kiểm tra, quyền truy cập của bạn đã được khôi phục.</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="color:#475569;font-size:14px;">Trạng thái tài khoản</div>
                    <div style="margin-top:5px;color:#0f172a;font-size:16px;font-weight:800;">Đã mở khóa • Hoạt động bình thường</div>
                    ${safeUid ? `<div style="margin-top:7px;color:#94a3b8;font-size:12px;font-family:monospace;">UID: ${escapeHtml(safeUid)}</div>` : ""}
                  </td>
                </tr>
              </table>

              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
                <tr>
                  <td style="border-radius:10px;background:#111827;">
                    <a href="${escapeHtml(appUrl)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Mở Duchi Locket</a>
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
</html>`.trim();

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
  if (!/^https:\/\//i.test(endpoint)) {
    const error = new Error("URL Google Apps Script không hợp lệ.");
    error.code = "EMAIL_RELAY_URL_INVALID";
    error.status = 500;
    throw error;
  }
  if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
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
