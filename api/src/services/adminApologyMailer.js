const EMAIL_BRAND = "Duchi Locket";

const MAIL_TEMPLATES = {
  apology: {
    label: "Xin lỗi khóa nhầm",
    subject: "Xin lỗi về việc tài khoản bị khóa nhầm",
    badge: "XIN LỖI",
    title: "Tài khoản của bạn đã bị khóa nhầm",
    intro: ({ email }) => `Chúng tôi thành thật xin lỗi vì tài khoản ${email} đã bị khóa nhầm trong quá trình quản trị.`,
    followup: "Sau khi kiểm tra, quyền truy cập của tài khoản đã được khôi phục và bạn có thể tiếp tục sử dụng Duchi Locket bình thường.",
    closing: "Rất xin lỗi vì sự bất tiện này và cảm ơn bạn đã thông cảm.",
    detail: "Đây là email được gửi trực tiếp từ bộ phận quản trị Duchi Locket sau khi tài khoản được kiểm tra và khôi phục.",
    statusLabel: "Đã mở khóa • Hoạt động bình thường",
    statusColor: "#059669",
  },
  restored: {
    label: "Xác nhận đã mở khóa",
    subject: "Tài khoản của bạn đã được mở khóa",
    badge: "KHÔI PHỤC TÀI KHOẢN",
    title: "Tài khoản của bạn đã được mở khóa",
    intro: ({ email }) => `Tài khoản ${email} đã được bộ phận quản trị kiểm tra và khôi phục quyền truy cập.`,
    followup: "Bạn có thể đăng nhập và tiếp tục sử dụng Duchi Locket bình thường.",
    closing: "Cảm ơn bạn đã sử dụng Duchi Locket.",
    detail: "Đây là email xác nhận từ bộ phận quản trị Duchi Locket sau khi quyền truy cập tài khoản được khôi phục.",
    statusLabel: "Đã mở khóa • Hoạt động bình thường",
    statusColor: "#059669",
  },
  warning: {
    label: "Cảnh báo tài khoản",
    subject: "Thông báo quan trọng về tài khoản của bạn",
    badge: "CẢNH BÁO TÀI KHOẢN",
    title: "Tài khoản của bạn cần được chú ý",
    intro: ({ email }) => `Bộ phận quản trị gửi thông báo quan trọng liên quan đến tài khoản ${email}.`,
    followup: "Vui lòng đọc kỹ nội dung bên dưới và điều chỉnh hoạt động tài khoản nếu cần để tránh bị hạn chế quyền truy cập.",
    closing: "Nếu bạn cho rằng thông báo này chưa chính xác, vui lòng liên hệ bộ phận hỗ trợ Duchi Locket.",
    detail: "Thông báo này không yêu cầu bạn cung cấp mật khẩu, mã OTP hoặc thông tin đăng nhập.",
    statusLabel: "Cần chú ý • Tài khoản vẫn được theo dõi",
    statusColor: "#d97706",
  },
  maintenance: {
    label: "Thông báo bảo trì",
    subject: "Thông báo bảo trì hệ thống",
    badge: "BẢO TRÌ HỆ THỐNG",
    title: "Duchi Locket sắp thực hiện bảo trì",
    intro: () => "Hệ thống Duchi Locket có kế hoạch bảo trì để cải thiện độ ổn định và hiệu suất.",
    followup: "Trong thời gian bảo trì, một số tính năng có thể tạm thời chậm hoặc không khả dụng trong thời gian ngắn.",
    closing: "Cảm ơn bạn đã kiên nhẫn trong thời gian hệ thống được nâng cấp.",
    detail: "Bạn không cần thực hiện thao tác nào trừ khi nội dung quản trị bên dưới có hướng dẫn bổ sung.",
    statusLabel: "Hệ thống • Bảo trì có kế hoạch",
    statusColor: "#7c3aed",
  },
  incident: {
    label: "Thông báo sự cố",
    subject: "Cập nhật về sự cố hệ thống",
    badge: "CẬP NHẬT SỰ CỐ",
    title: "Chúng tôi đang xử lý một sự cố hệ thống",
    intro: () => "Duchi Locket đã ghi nhận một sự cố có thể ảnh hưởng đến một số chức năng của web.",
    followup: "Đội ngũ quản trị đang xử lý và ưu tiên khôi phục hoạt động ổn định trong thời gian sớm nhất.",
    closing: "Cảm ơn bạn đã thông cảm nếu trải nghiệm bị gián đoạn.",
    detail: "Bạn có thể thử lại sau; không cần đăng xuất hoặc xóa dữ liệu ứng dụng trừ khi có hướng dẫn riêng.",
    statusLabel: "Sự cố • Đang được xử lý",
    statusColor: "#dc2626",
  },
  welcome: {
    label: "Chào mừng người dùng",
    subject: "Chào mừng bạn đến với Duchi Locket",
    badge: "CHÀO MỪNG",
    title: "Chào mừng bạn đến với Duchi Locket",
    intro: ({ email }) => `Tài khoản ${email} đã sẵn sàng sử dụng các tính năng của Duchi Locket.`,
    followup: "Bạn có thể mở web, đăng nhập và bắt đầu sử dụng các tính năng camera, bài đăng, bạn bè và thông báo.",
    closing: "Chúc bạn có trải nghiệm tốt với Duchi Locket.",
    detail: "Nếu gặp lỗi đăng nhập hoặc đồng bộ, bạn có thể liên hệ bộ phận hỗ trợ.",
    statusLabel: "Tài khoản • Sẵn sàng sử dụng",
    statusColor: "#2563eb",
  },
  feature: {
    label: "Thông báo tính năng mới",
    subject: "Duchi Locket vừa có cập nhật mới",
    badge: "TÍNH NĂNG MỚI",
    title: "Duchi Locket vừa được nâng cấp",
    intro: () => "Một bản cập nhật mới của Duchi Locket đã được phát hành với các cải tiến về tính năng và độ ổn định.",
    followup: "Bạn có thể mở web để sử dụng phiên bản mới nhất. Nếu đang mở web từ trước, hãy tải lại khi được hệ thống nhắc cập nhật.",
    closing: "Cảm ơn bạn đã đồng hành cùng Duchi Locket.",
    detail: "Nội dung quản trị bên dưới có thể mô tả chi tiết những thay đổi đáng chú ý trong bản cập nhật này.",
    statusLabel: "Cập nhật • Phiên bản mới khả dụng",
    statusColor: "#7c3aed",
  },
};

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

function normalizeTemplate(template) {
  const value = clean(template, 40).toLowerCase();
  return Object.prototype.hasOwnProperty.call(MAIL_TEMPLATES, value) ? value : "apology";
}

function getMailTemplates() {
  return Object.entries(MAIL_TEMPLATES).map(([id, item]) => ({
    id,
    label: item.label,
    subject: `${EMAIL_BRAND} | ${item.subject}`,
    badge: item.badge,
    title: item.title,
    statusLabel: item.statusLabel,
  }));
}

function buildAdminApologyEmail({ email, displayName, uid, template = "apology", customMessage = "" }) {
  const targetEmail = clean(email, 320).toLowerCase();
  const name = clean(displayName, 120) || "bạn";
  const safeUid = clean(uid, 180);
  const note = clean(customMessage, 2500);
  const appUrl = publicAppUrl();
  const selectedTemplate = normalizeTemplate(template);
  const config = MAIL_TEMPLATES[selectedTemplate];

  const subject = `${EMAIL_BRAND} | ${config.subject}`;
  const introText = config.intro({ email: targetEmail, name });
  const text = [
    EMAIL_BRAND,
    "Thông báo từ hệ thống",
    "",
    `Chào ${name},`,
    "",
    introText,
    config.followup,
    note ? "" : null,
    note ? `Nội dung từ quản trị viên: ${note}` : null,
    "",
    `Trạng thái: ${config.statusLabel}`,
    safeUid ? `UID: ${safeUid}` : "",
    "",
    `Mở Duchi Locket: ${appUrl}`,
    "",
    config.closing,
    "",
    "Email tự động từ Duchi Locket. Bạn không cần phản hồi email này.",
  ].filter(Boolean).join("\n");

  const noteHtml = note
    ? `<div style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;">
        <div style="font-size:12px;font-weight:800;letter-spacing:.4px;color:#64748b;text-transform:uppercase;">Nội dung từ quản trị viên</div>
        <div style="margin-top:7px;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(note)}</div>
      </div>`
    : "";

  const html = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(config.title)} — Duchi Locket.</div>
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
              <div style="font-size:13px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.7px;">${escapeHtml(config.badge)}</div>
              <h1 style="margin:8px 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">${escapeHtml(config.title)}</h1>
              <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">Chào <strong style="color:#0f172a;">${escapeHtml(name)}</strong>, ${escapeHtml(introText)} ${escapeHtml(config.followup)}</p>

              ${noteHtml}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <div style="color:#475569;font-size:14px;">Trạng thái</div>
                    <div style="margin-top:5px;color:${escapeHtml(config.statusColor)};font-size:16px;font-weight:800;">${escapeHtml(config.statusLabel)}</div>
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

              <p style="margin:24px 0 0;color:#475569;font-size:14px;line-height:1.7;">${escapeHtml(config.closing)}</p>
              <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6;">${escapeHtml(config.detail)}</p>
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

  return {
    subject,
    text,
    html,
    appUrl,
    template: selectedTemplate,
    label: config.label,
    title: config.title,
    badge: config.badge,
    statusLabel: config.statusLabel,
  };
}

async function sendAdminApologyEmail({
  email,
  displayName = "",
  uid = "",
  idempotencyKey = "",
  template = "apology",
  customMessage = "",
} = {}) {
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
    const error = new Error("Tài khoản không có địa chỉ email hợp lệ để gửi thư.");
    error.code = "EMAIL_ADDRESS_INVALID";
    error.status = 400;
    throw error;
  }

  const message = buildAdminApologyEmail({
    email: target,
    displayName,
    uid,
    template,
    customMessage,
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        "User-Agent": "Duchi-Locket-Admin-Mail/2.0",
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
      const error = new Error(data?.message || "Gmail relay từ chối gửi thư.");
      error.code = data?.code || "EMAIL_RELAY_REJECTED";
      error.status = response.status || 502;
      throw error;
    }
    return {
      ok: true,
      provider: "gmail-apps-script",
      messageId: data?.messageId || null,
      deduped: Boolean(data?.deduped),
      template: message.template,
      label: message.label,
    };
  } catch (cause) {
    if (String(cause?.code || "").startsWith("EMAIL_")) throw cause;
    const error = new Error("Gmail gửi thư thất bại.");
    error.code = "EMAIL_SEND_FAILED";
    error.status = 502;
    error.cause = cause;
    throw error;
  }
}

module.exports = {
  MAIL_TEMPLATES,
  getMailTemplates,
  normalizeTemplate,
  buildAdminApologyEmail,
  buildAdminEmail: buildAdminApologyEmail,
  sendAdminApologyEmail,
  sendAdminEmail: sendAdminApologyEmail,
};