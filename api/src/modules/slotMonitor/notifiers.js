const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_ZALO_MESSAGE_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const EMAIL_BRAND = "Duchi Locket";

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

function getProviderConfig() {
  return {
    telegram: {
      configured: Boolean(clean(process.env.TELEGRAM_BOT_TOKEN)),
      botUsername: clean(process.env.TELEGRAM_BOT_USERNAME, 64).replace(/^@+/, ""),
    },
    email: {
      configured: Boolean(
        clean(process.env.GMAIL_APPS_SCRIPT_URL, 1000) &&
          clean(process.env.GMAIL_APPS_SCRIPT_SECRET, 500),
      ),
    },
    zalo: {
      configured: Boolean(clean(process.env.ZALO_OA_ACCESS_TOKEN)),
    },
  };
}

function appUrl(relativeUrl = "/friends?slot=1") {
  const base = clean(
    process.env.PUBLIC_WEB_URL || process.env.APP_PUBLIC_URL || "https://duchi.vercel.app",
    500,
  ).replace(/\/+$/, "");
  const path = String(relativeUrl || "/friends?slot=1");
  if (/^https?:\/\//i.test(path)) return path;
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatNumber(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("vi-VN");
}

function buildSlotMessage(payload = {}) {
  const celeb = payload.celeb || {};
  const username = clean(celeb.username || payload.username, 64).replace(/^@+/, "");
  const availableSlots = Math.max(0, Number(celeb.availableSlots) || 0);
  const friendCount = Math.max(0, Number(celeb.friendCount) || 0);
  const maxFriends = Math.max(0, Number(celeb.maxFriends) || 0);
  const title = clean(payload.title, 140) || "🔥 Slot vừa mở!";
  const detailedBody = clean(payload.body, 1000);
  // Giữ nguyên nội dung kết quả request thật từ worker. Trước đây khi có username,
  // formatter ghi đè body khiến Telegram/Gmail chỉ còn câu "còn X slot".
  const body = detailedBody || (username
    ? `@${username} hiện còn ${formatNumber(availableSlots)} slot trống.`
    : "Canh Slot vừa phát hiện slot trống.");
  const countLine = maxFriends > 0
    ? `👥 ${formatNumber(friendCount)} / ${formatNumber(maxFriends)} bạn`
    : "";
  const url = appUrl(payload.url || "/friends?slot=1");
  return {
    title,
    body,
    url,
    text: [title, body, countLine, `Mở Huy Locket: ${url}`].filter(Boolean).join("\n"),
    username,
    availableSlots,
    friendCount,
    maxFriends,
  };
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

async function sendTelegram(chatId, payload) {
  const token = clean(process.env.TELEGRAM_BOT_TOKEN, 500);
  const target = clean(chatId, 120);
  if (!token) {
    const error = new Error("Telegram Bot chưa được cấu hình trên Railway.");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }
  if (!target) {
    const error = new Error("Chưa có Telegram Chat ID.");
    error.code = "TELEGRAM_CHAT_REQUIRED";
    throw error;
  }

  const message = buildSlotMessage(payload);
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: target,
      text: message.text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "Mở Huy Locket", url: message.url }]],
      },
    }),
  });
  const { data } = await parseResponse(response);
  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.description || "Telegram gửi thông báo thất bại.");
    error.code = "TELEGRAM_SEND_FAILED";
    error.status = response.status;
    throw error;
  }
  return { ok: true, provider: "telegram", messageId: data?.result?.message_id || null };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripEmailSymbols(value) {
  return clean(value, 240)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[\uFFFD�]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEmailSubject(payload, message) {
  if (payload?.type === "slot-test") {
    return `${EMAIL_BRAND} | Xác nhận kết nối Canh Slot`;
  }
  if (payload?.type === "slot-open" && message.username) {
    if (payload?.autoRequest?.enabled && payload?.autoRequest?.success === true) {
      return `${EMAIL_BRAND} | @${message.username} request Celeb thành công`.slice(0, 200);
    }
    if (payload?.autoRequest?.enabled && payload?.autoRequest?.success === false) {
      return `${EMAIL_BRAND} | @${message.username} request Celeb chưa thành công`.slice(0, 200);
    }
    return `${EMAIL_BRAND} | @${message.username} vừa mở slot`.slice(0, 200);
  }
  const cleanTitle = stripEmailSymbols(message.title)
    .replace(/^Huy Locket\s*/i, "")
    .replace(/^Duchi Locket\s*[|:-]?\s*/i, "");
  return `${EMAIL_BRAND} | ${cleanTitle || "Thông báo Canh Slot"}`.slice(0, 200);
}

function buildEmailText(payload, message) {
  const lines = [
    EMAIL_BRAND,
    "Canh Slot",
    "",
    stripEmailSymbols(message.body),
  ];

  if (message.maxFriends > 0) {
    lines.push(`Trạng thái bạn bè: ${formatNumber(message.friendCount)} / ${formatNumber(message.maxFriends)}`);
  }

  lines.push("", `Mở Duchi Locket: ${message.url}`);

  if (payload?.type === "slot-test") {
    lines.push("", "Đây là email kiểm tra để xác nhận kênh Gmail đã được kết nối thành công.");
  } else {
    lines.push("", "Bạn nhận email này vì đã bật thông báo Gmail trong tính năng Canh Slot.");
  }

  lines.push("Nếu không muốn nhận email, hãy tắt Gmail trong phần Kênh báo khi Celeb mở slot.");
  return lines.filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

function buildEmailHtml(payload, message) {
  const isTest = payload?.type === "slot-test";
  const autoEnabled = Boolean(payload?.autoRequest?.enabled);
  const heading = isTest
    ? "Kết nối Gmail thành công"
    : autoEnabled
      ? stripEmailSymbols(message.title) || "Kết quả tự gửi request Celeb"
      : message.username
        ? `@${message.username} vừa mở slot`
        : "Thông báo Canh Slot";
  const description = isTest
    ? "Kênh Gmail của bạn đã được kết nối với Duchi Locket và sẵn sàng nhận thông báo Canh Slot."
    : stripEmailSymbols(message.body);
  const friendStatus = message.maxFriends > 0
    ? `<tr><td style="padding:12px 0 0;color:#475569;font-size:14px;">Trạng thái bạn bè</td></tr>
       <tr><td style="padding:3px 0 0;color:#0f172a;font-size:15px;font-weight:700;">${escapeHtml(formatNumber(message.friendCount))} / ${escapeHtml(formatNumber(message.maxFriends))}</td></tr>`
    : "";

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(buildEmailSubject(payload, message))}</title>
</head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(description)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f7fb;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;box-shadow:0 8px 28px rgba(15,23,42,.08);">
          <tr>
            <td style="padding:22px 28px;background:#ffffff;border-bottom:1px solid #eef2f7;">
              <div style="font-size:20px;font-weight:800;letter-spacing:.2px;color:#7c3aed;">DUCHI LOCKET</div>
              <div style="margin-top:4px;font-size:12px;color:#64748b;">Thông báo hệ thống Canh Slot</div>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 28px 24px;">
              <div style="font-size:13px;font-weight:700;color:#7c3aed;text-transform:uppercase;letter-spacing:.7px;">Canh Slot</div>
              <h1 style="margin:8px 0 12px;font-size:24px;line-height:1.3;color:#0f172a;">${escapeHtml(heading)}</h1>
              <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">${escapeHtml(description)}</p>
              ${friendStatus ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                      ${friendStatus}
                    </table>
                  </td>
                </tr>
              </table>` : ""}
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:24px;">
                <tr>
                  <td style="border-radius:10px;background:#111827;">
                    <a href="${escapeHtml(message.url)}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Mở Duchi Locket</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
                ${isTest
                  ? "Đây là email kiểm tra để xác nhận kênh Gmail đã được kết nối thành công."
                  : "Bạn nhận email này vì đã bật thông báo Gmail trong tính năng Canh Slot."}
                Nếu không muốn nhận email, hãy tắt Gmail trong phần Kênh báo khi Celeb mở slot.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #eef2f7;color:#94a3b8;font-size:11px;line-height:1.6;">
              Email tự động từ Duchi Locket. Vui lòng không gửi mật khẩu, mã OTP hoặc thông tin đăng nhập qua email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function sendEmail(email, payload, { idempotencyKey = "" } = {}) {
  const endpoint = clean(process.env.GMAIL_APPS_SCRIPT_URL, 1000);
  const secret = clean(process.env.GMAIL_APPS_SCRIPT_SECRET, 500);
  const fromName = clean(process.env.GMAIL_FROM_NAME, 120) || EMAIL_BRAND;
  const target = clean(email, 320).toLowerCase();
  if (!endpoint || !secret) {
    const error = new Error("Gmail chưa được cấu hình trên Railway.");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }
  if (!/^https:\/\//i.test(endpoint)) {
    const error = new Error("URL Google Apps Script không hợp lệ.");
    error.code = "EMAIL_RELAY_URL_INVALID";
    throw error;
  }
  if (!target) {
    const error = new Error("Chưa có địa chỉ Gmail/Email.");
    error.code = "EMAIL_ADDRESS_REQUIRED";
    throw error;
  }

  const message = buildSlotMessage(payload);
  const subject = buildEmailSubject(payload, message);
  const text = buildEmailText(payload, message);
  const html = buildEmailHtml(payload, message);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        "User-Agent": "Duchi-Locket-Mail/1.0",
      },
      body: JSON.stringify({
        secret,
        to: target,
        subject,
        text,
        html,
        fromName,
        idempotencyKey: clean(idempotencyKey, 240),
      }),
      signal: AbortSignal.timeout(15000),
    });
    const { data } = await parseResponse(response);
    if (!response.ok || data?.ok !== true) {
      const error = new Error(data?.message || "Gmail relay từ chối gửi thông báo.");
      error.code = data?.code || "EMAIL_RELAY_REJECTED";
      error.status = response.status;
      throw error;
    }
    return {
      ok: true,
      provider: "gmail-apps-script",
      messageId: data?.messageId || null,
      deduped: Boolean(data?.deduped),
    };
  } catch (cause) {
    if (cause?.code === "EMAIL_RELAY_REJECTED" || String(cause?.code || "").startsWith("EMAIL_")) {
      cause.code = "EMAIL_SEND_FAILED";
      cause.status = Number(cause.status) || 502;
      throw cause;
    }
    const error = new Error("Gmail gửi thông báo thất bại.");
    error.code = "EMAIL_SEND_FAILED";
    error.status = 502;
    error.cause = cause;
    throw error;
  }
}

async function sendZalo(userId, payload) {
  const accessToken = clean(process.env.ZALO_OA_ACCESS_TOKEN, 2000);
  const target = clean(userId, 160);
  const endpoint = clean(process.env.ZALO_OA_MESSAGE_URL, 1000) || DEFAULT_ZALO_MESSAGE_URL;
  if (!accessToken) {
    const error = new Error("Zalo OA chưa được cấu hình trên Railway.");
    error.code = "ZALO_NOT_CONFIGURED";
    throw error;
  }
  if (!target) {
    const error = new Error("Chưa có Zalo User ID.");
    error.code = "ZALO_USER_REQUIRED";
    throw error;
  }

  const message = buildSlotMessage(payload);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      access_token: accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recipient: { user_id: target },
      message: { text: message.text.slice(0, 2000) },
    }),
  });
  const { data } = await parseResponse(response);
  const zaloError = Number(data?.error || 0);
  if (!response.ok || zaloError !== 0) {
    const error = new Error(data?.message || "Zalo gửi thông báo thất bại.");
    error.code = "ZALO_SEND_FAILED";
    error.status = response.status;
    throw error;
  }
  return {
    ok: true,
    provider: "zalo",
    messageId: data?.data?.message_id || data?.data?.messageId || null,
  };
}

module.exports = {
  getProviderConfig,
  buildSlotMessage,
  buildEmailSubject,
  buildEmailText,
  buildEmailHtml,
  sendTelegram,
  sendEmail,
  sendZalo,
};
