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
    .replace(/\"/g, "&quot;")
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

function buildAdminApologyEmail({
  email,
  displayName,
  uid,
  template = "apology",
  customMessage = "",
}) {
  const targetEmail = clean(email, 320).toLowerCase();
  const name = clean(displayName, 120) || "bạn";
  const safeUid = clean(uid, 180);
  const note = clean(customMessage, 2500);
  const appUrl = publicAppUrl();
  const logoUrl = `${appUrl}/android-chrome-192x192.png`;
  const selectedTemplate = normalizeTemplate(template);
  const config = MAIL_TEMPLATES[selectedTemplate];

  const subject = `${EMAIL_BRAND} | ${config.subject}`;
  const introText = config.intro({ email: targetEmail, name });
  const text = [
    EMAIL_BRAND,
    "Thông báo chính thức từ hệ thống",
    "",
    `Chào ${name},`,
    "",
    introText,
    config.followup,
    note ? "" : null,
    note ? `Lời nhắn từ quản trị viên: ${note}` : null,
    "",
    `Trạng thái: ${config.statusLabel}`,
    safeUid ? `UID: ${safeUid}` : "",
    "",
    `Mở Duchi Locket: ${appUrl}`,
    "",
    config.closing,
    "",
    "Email tự động từ Duchi Locket. Bạn không cần phản hồi email này.",
  ]
    .filter(Boolean)
    .join("\n");

  const noteHtml = note
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:22px;background:#f8f7ff;border:1px solid #e8e3ff;border-radius:18px;">
        <tr>
          <td style="padding:18px 19px;">
            <div style="font-size:10px;font-weight:900;letter-spacing:1px;color:#6d28d9;text-transform:uppercase;">Lời nhắn từ quản trị viên</div>
            <div style="margin-top:9px;color:#334155;font-size:14px;line-height:1.75;white-space:pre-wrap;">${escapeHtml(note)}</div>
          </td>
        </tr>
      </table>`
    : "";

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
      .email-shell { padding:10px 5px !important; }
      .email-card { border-radius:22px !important; }
      .brand-row { padding:17px 19px !important; }
      .hero { padding:28px 20px 27px !important; }
      .hero-title { font-size:27px !important; line-height:1.18 !important; }
      .email-body { padding:24px 20px 22px !important; }
      .email-copy { font-size:15px !important; line-height:1.72 !important; }
      .status-cell { padding:17px 17px !important; }
      .cta-table { width:100% !important; }
      .cta-cell { width:100% !important; text-align:center !important; }
      .cta-link { display:block !important; padding:15px 18px !important; }
      .email-footer { padding:17px 20px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f3f2f8;font-family:Arial,Helvetica,sans-serif;color:#111827;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(config.title)} · ${escapeHtml(config.statusLabel)} · Duchi Locket</div>

  <table class="email-shell" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f2f8;padding:30px 12px;">
    <tr>
      <td align="center">
        <table class="email-card" role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border:1px solid #e7e5ef;border-radius:28px;overflow:hidden;box-shadow:0 18px 50px rgba(49,46,129,.10);">
          <tr>
            <td class="brand-row" style="padding:19px 28px;background:#ffffff;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td width="58" valign="middle" style="width:58px;">
                    <img src="${escapeHtml(logoUrl)}" width="50" height="50" alt="Duchi Locket" style="display:block;width:50px;height:50px;border:0;border-radius:15px;box-shadow:0 7px 18px rgba(124,58,237,.16);object-fit:cover;">
                  </td>
                  <td valign="middle" style="padding-left:13px;">
                    <div style="font-size:18px;font-weight:900;letter-spacing:.15px;color:#111827;">DUCHI LOCKET</div>
                    <div style="margin-top:3px;font-size:11px;color:#8b93a5;">Thông báo chính thức từ hệ thống</div>
                  </td>
                  <td align="right" valign="middle" style="padding-left:8px;">
                    <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#22c55e;font-size:0;line-height:0;">&nbsp;</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="hero" style="padding:34px 30px 32px;background:#5b21b6;background-image:linear-gradient(135deg,#7c3aed 0%,#4f46e5 54%,#172554 100%);">
              <span style="display:inline-block;padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.20);color:#ffffff;font-size:10px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">${escapeHtml(config.badge)}</span>
              <h1 class="hero-title" style="margin:17px 0 10px;font-size:31px;line-height:1.18;letter-spacing:-.7px;color:#ffffff;font-weight:900;">${escapeHtml(config.title)}</h1>
              <div style="max-width:480px;color:#ddd6fe;font-size:13px;line-height:1.65;">Thông báo dành riêng cho tài khoản Duchi Locket của bạn.</div>
            </td>
          </tr>

          <tr>
            <td class="email-body" style="padding:30px 30px 27px;background:#ffffff;">
              <p class="email-copy" style="margin:0;color:#4b5563;font-size:15px;line-height:1.78;">
                Chào <strong style="color:#111827;">${escapeHtml(name)}</strong>, ${escapeHtml(introText)} ${escapeHtml(config.followup)}
              </p>

              ${noteHtml}

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:18px;">
                <tr>
                  <td class="status-cell" style="padding:18px 19px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="38" valign="top" style="width:38px;">
                          <div style="width:30px;height:30px;line-height:30px;text-align:center;border-radius:10px;background:${escapeHtml(config.statusColor)}1a;color:${escapeHtml(config.statusColor)};font-size:16px;font-weight:900;">✓</div>
                        </td>
                        <td valign="top" style="padding-left:10px;">
                          <div style="font-size:10px;font-weight:900;color:#8b93a5;text-transform:uppercase;letter-spacing:.9px;">Trạng thái tài khoản</div>
                          <div style="margin-top:6px;color:${escapeHtml(config.statusColor)};font-size:16px;line-height:1.35;font-weight:900;">${escapeHtml(config.statusLabel)}</div>
                          ${safeUid ? `<div style="margin-top:8px;color:#a0a7b5;font-size:10px;line-height:1.5;font-family:Consolas,Monaco,monospace;word-break:break-all;">UID · ${escapeHtml(safeUid)}</div>` : ""}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table class="cta-table" role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:25px;">
                <tr>
                  <td class="cta-cell" style="border-radius:14px;background:#111827;background-image:linear-gradient(90deg,#111827 0%,#312e81 100%);box-shadow:0 9px 22px rgba(49,46,129,.18);">
                    <a class="cta-link" href="${escapeHtml(appUrl)}" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;line-height:1.2;font-weight:900;border-radius:14px;">Mở Duchi Locket&nbsp;&nbsp;→</a>
                  </td>
                </tr>
              </table>

              <p style="margin:27px 0 0;color:#4b5563;font-size:14px;line-height:1.72;">${escapeHtml(config.closing)}</p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:21px;background:#fafafa;border-radius:14px;">
                <tr>
                  <td style="padding:14px 15px;color:#8b93a5;font-size:11px;line-height:1.65;">${escapeHtml(config.detail)}</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="email-footer" style="padding:19px 28px;background:#f8f8fb;border-top:1px solid #eeedf3;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td valign="top" style="color:#9299a8;font-size:10px;line-height:1.7;">
                    <strong style="color:#6b7280;">Duchi Locket Security</strong><br>
                    Email tự động, bạn không cần phản hồi. Duchi Locket không bao giờ yêu cầu mật khẩu, mã OTP hoặc thông tin đăng nhập qua email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <div style="max-width:620px;margin:13px auto 0;text-align:center;color:#a6acb8;font-size:10px;line-height:1.5;">© Duchi Locket · Thông báo hệ thống</div>
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