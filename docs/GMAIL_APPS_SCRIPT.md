# Gmail thật cho Huy Locket qua Google Apps Script

Railway Trial/Free/Hobby chặn outbound SMTP, vì vậy Huy Locket gửi Gmail qua HTTPS đến một Google Apps Script Web App chạy bằng tài khoản Gmail của Duchi Locket.

## Apps Script

Tạo project tại Google Apps Script bằng đúng tài khoản Gmail sẽ dùng để gửi mail, rồi dán mã sau vào `Code.gs`:

```javascript
function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function hashKey(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, "").slice(0, 100);
}

function getSenderEmail() {
  return String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
}

function getConfiguredDailyLimit() {
  const properties = PropertiesService.getScriptProperties();
  const configured = Number(properties.getProperty("HUY_LOCKET_MAIL_DAILY_LIMIT"));
  if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);

  // Gmail cá nhân thường dùng quota 100 người nhận/ngày.
  // Google Workspace thường cao hơn. Có thể đặt Script Property phía trên để ghi đè.
  const sender = getSenderEmail();
  return sender.endsWith("@gmail.com") ? 100 : 1500;
}

function getQuotaPayload() {
  return {
    ok: true,
    action: "quota",
    senderEmail: getSenderEmail(),
    remaining: MailApp.getRemainingDailyQuota(),
    dailyLimit: getConfiguredDailyLimit(),
    checkedAt: new Date().toISOString(),
  };
}

function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const expectedSecret = PropertiesService
      .getScriptProperties()
      .getProperty("HUY_LOCKET_MAIL_SECRET");

    if (!expectedSecret || String(data.secret || "") !== expectedSecret) {
      return jsonResponse({ ok: false, code: "UNAUTHORIZED", message: "Unauthorized" });
    }

    if (String(data.action || "").toLowerCase() === "quota") {
      return jsonResponse(getQuotaPayload());
    }

    const to = String(data.to || "").trim().toLowerCase();
    const subject = String(data.subject || "Huy Locket").slice(0, 200);
    const text = String(data.text || "").slice(0, 20000);
    const html = String(data.html || "").slice(0, 50000);
    const fromName = String(data.fromName || "Duchi Locket").slice(0, 120);
    const idempotencyKey = String(data.idempotencyKey || "").slice(0, 240);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return jsonResponse({ ok: false, code: "INVALID_EMAIL", message: "Invalid email" });
    }

    const cache = CacheService.getScriptCache();
    const cacheKey = idempotencyKey ? `mail:${hashKey(idempotencyKey)}` : "";
    if (cacheKey && cache.get(cacheKey)) {
      const quota = getQuotaPayload();
      return jsonResponse({ ...quota, action: "send", deduped: true });
    }

    GmailApp.sendEmail(to, subject, text || "Huy Locket notification", {
      htmlBody: html || undefined,
      name: fromName,
    });

    if (cacheKey) cache.put(cacheKey, "1", 21600);
    const quota = getQuotaPayload();
    return jsonResponse({ ...quota, action: "send", deduped: false });
  } catch (error) {
    return jsonResponse({
      ok: false,
      code: "SEND_FAILED",
      message: String(error && error.message ? error.message : error).slice(0, 500),
    });
  }
}
```

## Cấu hình secret

Trong Apps Script mở **Project Settings > Script Properties** và thêm:

- Property: `HUY_LOCKET_MAIL_SECRET`
- Value: một chuỗi ngẫu nhiên dài, chỉ dùng cho Huy Locket.

Tùy chọn, có thể thêm:

- Property: `HUY_LOCKET_MAIL_DAILY_LIMIT`
- Value: `100` cho Gmail cá nhân hoặc giới hạn thực tế của tài khoản nếu khác.

Nếu không đặt `HUY_LOCKET_MAIL_DAILY_LIMIT`, script tự dùng `100` cho địa chỉ `@gmail.com` và `1500` cho tài khoản domain khác. Số **còn lại** vẫn lấy trực tiếp từ `MailApp.getRemainingDailyQuota()` của chính tài khoản đang chạy Web App, tức tài khoản Gmail dùng để gửi thư.

## Deploy Web App

Chọn **Deploy > Manage deployments > Edit** và tạo **New version** sau mỗi lần sửa Code.gs, sau đó giữ cấu hình:

- Execute as: **Me**
- Who has access: **Anyone**

Copy URL kết thúc bằng `/exec`.

## Railway / Vercel Variables

Đặt trên service `huy-locket-api`:

```env
GMAIL_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
GMAIL_APPS_SCRIPT_SECRET=...
GMAIL_FROM_NAME=Duchi Locket
```

Không đưa secret vào frontend, Vercel source bundle hoặc GitHub.

## Quota trong Admin

Frontend gọi `GET /api/admin/mail-quota`. Backend giữ secret ở server và hỏi Apps Script bằng `action: "quota"`. Apps Script trả về:

- `senderEmail`: chính Gmail đang thực sự gửi thư từ Apps Script.
- `remaining`: số người nhận còn lại trong quota hiện tại từ `MailApp.getRemainingDailyQuota()` của Gmail gửi thư.
- `dailyLimit`: giới hạn dùng để hiển thị dạng `còn lại / tổng`.
- `checkedAt`: thời điểm kiểm tra.

Route backend cache kết quả khoảng 30 giây để tránh gọi Apps Script liên tục khi mở/đóng Mail Center.
