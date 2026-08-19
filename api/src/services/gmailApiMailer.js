const crypto = require("node:crypto");
const { neon } = require("@neondatabase/serverless");

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_EMAIL_SCOPES = `openid email ${GMAIL_SEND_SCOPE}`;
const DEFAULT_SAFE_DAILY_LIMIT = 450;
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

let schemaPromise = null;
let tokenCache = { token: "", exp: 0 };

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function databaseUrl() {
  return [process.env.DATABASE_URL, process.env.NEON_DATABASE_URL]
    .find((value) => typeof value === "string" && value.trim())
    ?.trim() || "";
}

function getSql() {
  const url = databaseUrl();
  return url ? neon(url) : null;
}

async function ensureSchema() {
  const sql = getSql();
  if (!sql) {
    const error = new Error("Database Gmail chưa được cấu hình.");
    error.code = "DATABASE_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS gmail_oauth_config (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        account_email TEXT,
        refresh_token_enc TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS gmail_send_events (
        id BIGSERIAL PRIMARY KEY,
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recipient TEXT NOT NULL,
        recipient_count INT NOT NULL DEFAULT 1,
        subject TEXT,
        message_id TEXT,
        thread_id TEXT,
        idempotency_key TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'sent',
        error_code TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS gmail_send_events_sent_at_idx ON gmail_send_events(sent_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS gmail_send_events_status_idx ON gmail_send_events(status, sent_at DESC)`;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

function cryptoSecret() {
  const value = clean(
    process.env.GMAIL_TOKEN_ENCRYPTION_KEY
      || process.env.JWT_SECRET
      || process.env.OAUTH_STATE_SECRET
      || process.env.COOKIE_SECRET
      || process.env.LOCKETDIO_SIGNATURE_SECRET,
    4096,
  );
  if (value.length < 32) {
    const error = new Error("Thiếu khóa mã hóa an toàn để lưu Gmail OAuth token.");
    error.code = "GMAIL_TOKEN_ENCRYPTION_KEY_MISSING";
    error.status = 500;
    throw error;
  }
  return crypto.createHash("sha256").update(value).digest();
}

function encryptToken(value) {
  const token = clean(value, 10000);
  if (!token) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", cryptoSecret(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptToken(value) {
  const raw = clean(value, 20000);
  if (!raw) return "";
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    const error = new Error("Gmail OAuth token có định dạng không hợp lệ.");
    error.code = "GMAIL_TOKEN_INVALID";
    throw error;
  }
  const [, ivRaw, tagRaw, dataRaw] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", cryptoSecret(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
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

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createOAuthState(payload = {}) {
  const body = b64url(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 }));
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

async function getGoogleOAuthClient() {
  const envClientId = clean(process.env.GOOGLE_GMAIL_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID, 1000);
  const envClientSecret = clean(process.env.GOOGLE_GMAIL_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET, 1000);
  if (envClientId && envClientSecret) {
    return { clientId: envClientId, clientSecret: envClientSecret, source: "env" };
  }

  const sql = getSql();
  if (!sql) return { clientId: envClientId, clientSecret: envClientSecret, source: "none" };
  try {
    const rows = await sql`
      SELECT oauth_client_id, oauth_client_secret
      FROM gdrive_config
      WHERE id = 1
      LIMIT 1
    `;
    const row = rows?.[0] || {};
    return {
      clientId: envClientId || clean(row.oauth_client_id, 1000),
      clientSecret: envClientSecret || clean(row.oauth_client_secret, 1000),
      source: row.oauth_client_id ? "gdrive_config" : "none",
    };
  } catch {
    return { clientId: envClientId, clientSecret: envClientSecret, source: "none" };
  }
}

async function readOAuthConfig() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT account_email, refresh_token_enc, updated_at, updated_by
    FROM gmail_oauth_config
    WHERE id = 1
    LIMIT 1
  `;
  const row = rows?.[0] || null;
  if (!row) return null;
  return {
    accountEmail: clean(row.account_email, 320).toLowerCase(),
    refreshToken: row.refresh_token_enc ? decryptToken(row.refresh_token_enc) : "",
    updatedAt: row.updated_at || null,
    updatedBy: clean(row.updated_by, 320),
  };
}

async function saveGmailOAuth({ refreshToken, accountEmail, updatedBy = "oauth" } = {}) {
  const token = clean(refreshToken, 10000);
  const email = clean(accountEmail, 320).toLowerCase();
  if (!token) {
    const error = new Error("Google không trả refresh token Gmail.");
    error.code = "GMAIL_REFRESH_TOKEN_MISSING";
    error.status = 400;
    throw error;
  }
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO gmail_oauth_config (id, account_email, refresh_token_enc, updated_at, updated_by)
    VALUES (1, ${email}, ${encryptToken(token)}, NOW(), ${clean(updatedBy, 320)})
    ON CONFLICT (id) DO UPDATE SET
      account_email = EXCLUDED.account_email,
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      updated_at = NOW(),
      updated_by = EXCLUDED.updated_by
  `;
  tokenCache = { token: "", exp: 0 };
  return { accountEmail: email };
}

async function disconnectGmailOAuth() {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM gmail_oauth_config WHERE id = 1`;
  tokenCache = { token: "", exp: 0 };
}

async function exchangeOAuthCode({ code, redirectUri, clientId, clientSecret }) {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: clean(code, 5000),
      client_id: clean(clientId, 1000),
      client_secret: clean(clientSecret, 1000),
      redirect_uri: clean(redirectUri, 1000),
      grant_type: "authorization_code",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || "Không đổi được Google OAuth code.");
    error.code = "GMAIL_OAUTH_EXCHANGE_FAILED";
    error.status = 502;
    throw error;
  }
  return data;
}

async function getGoogleAccountEmail(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${clean(accessToken, 10000)}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return "";
  return clean(data.email, 320).toLowerCase();
}

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.exp - 60_000) return tokenCache.token;
  const [oauth, client] = await Promise.all([readOAuthConfig(), getGoogleOAuthClient()]);
  if (!oauth?.refreshToken) {
    const error = new Error("Gmail API chưa được kết nối OAuth.");
    error.code = "GMAIL_OAUTH_NOT_CONNECTED";
    error.status = 503;
    throw error;
  }
  if (!client.clientId || !client.clientSecret) {
    const error = new Error("Thiếu Google OAuth Client ID / Secret.");
    error.code = "GOOGLE_OAUTH_CLIENT_MISSING";
    error.status = 503;
    throw error;
  }

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: oauth.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || "Không làm mới được Gmail access token.");
    error.code = data.error === "invalid_grant" ? "GMAIL_OAUTH_REAUTH_REQUIRED" : "GMAIL_OAUTH_REFRESH_FAILED";
    error.status = 503;
    throw error;
  }
  tokenCache = {
    token: data.access_token,
    exp: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000,
  };
  return tokenCache.token;
}

function safeDailyLimit() {
  const configured = Number(process.env.GMAIL_SAFE_DAILY_LIMIT);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.min(5000, Math.floor(configured)));
  }
  return DEFAULT_SAFE_DAILY_LIMIT;
}

async function sentTodayCount() {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COALESCE(SUM(recipient_count), 0)::int AS sent_today
    FROM gmail_send_events
    WHERE status = 'sent'
      AND sent_at >= (
        date_trunc('day', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')
        AT TIME ZONE 'Asia/Ho_Chi_Minh'
      )
  `;
  return Math.max(0, Number(rows?.[0]?.sent_today) || 0);
}

async function getGmailStatus() {
  let oauth = null;
  try {
    oauth = await readOAuthConfig();
  } catch (error) {
    return {
      connected: false,
      senderEmail: null,
      sentToday: 0,
      dailyLimit: safeDailyLimit(),
      remaining: 0,
      provider: "gmail-api",
      quotaScope: "app-safe-counter",
      checkedAt: new Date().toISOString(),
      error: error?.message || "Không đọc được Gmail OAuth.",
    };
  }
  const sentToday = await sentTodayCount();
  const limit = safeDailyLimit();
  const connected = Boolean(oauth?.refreshToken);
  return {
    connected,
    senderEmail: oauth?.accountEmail || null,
    sentToday,
    dailyLimit: limit,
    remaining: connected ? Math.max(0, limit - sentToday) : 0,
    provider: "gmail-api",
    quotaScope: "app-safe-counter",
    checkedAt: new Date().toISOString(),
  };
}

function encodeHeader(value) {
  const text = clean(value, 500);
  return `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function foldBase64(value) {
  return Buffer.from(String(value || ""), "utf8")
    .toString("base64")
    .match(/.{1,76}/g)
    ?.join("\r\n") || "";
}

function buildMimeMessage({ fromEmail, fromName, to, subject, text, html }) {
  const boundary = `huy_locket_${crypto.randomBytes(12).toString("hex")}`;
  const parts = [
    `From: ${encodeHeader(fromName || "Duchi Locket")} <${fromEmail}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject || "Duchi Locket")}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldBase64(text || "Duchi Locket notification"),
  ];
  if (html) {
    parts.push(
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(html),
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
}

async function findIdempotency(key) {
  const idempotencyKey = clean(key, 240);
  if (!idempotencyKey) return null;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, status, message_id, thread_id, sent_at
    FROM gmail_send_events
    WHERE idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows?.[0] || null;
}

async function reserveSend({ to, subject, idempotencyKey }) {
  const key = clean(idempotencyKey, 240);
  if (!key) return { id: null, existing: null };
  await ensureSchema();
  const sql = getSql();
  const inserted = await sql`
    INSERT INTO gmail_send_events (recipient, recipient_count, subject, idempotency_key, status)
    VALUES (${to}, 1, ${clean(subject, 500)}, ${key}, 'pending')
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  `;
  if (inserted?.[0]?.id) return { id: inserted[0].id, existing: null };
  const existing = await findIdempotency(key);
  return { id: null, existing };
}

async function markSend(id, { status, messageId = null, threadId = null, errorCode = null } = {}) {
  if (!id) return;
  const sql = getSql();
  await sql`
    UPDATE gmail_send_events
    SET status = ${clean(status, 32)},
        message_id = ${clean(messageId, 300) || null},
        thread_id = ${clean(threadId, 300) || null},
        error_code = ${clean(errorCode, 120) || null},
        sent_at = NOW()
    WHERE id = ${id}
  `;
}

async function recordNonIdempotentSend({ to, subject, messageId, threadId }) {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO gmail_send_events (
      recipient, recipient_count, subject, message_id, thread_id, status
    ) VALUES (
      ${to}, 1, ${clean(subject, 500)}, ${clean(messageId, 300) || null},
      ${clean(threadId, 300) || null}, 'sent'
    )
  `;
}

async function sendGmailMessage({
  to,
  subject,
  text = "",
  html = "",
  fromName = "Duchi Locket",
  idempotencyKey = "",
} = {}) {
  const target = clean(to, 320).toLowerCase();
  if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
    const error = new Error("Địa chỉ email người nhận không hợp lệ.");
    error.code = "EMAIL_ADDRESS_INVALID";
    error.status = 400;
    throw error;
  }

  const status = await getGmailStatus();
  if (!status.connected || !status.senderEmail) {
    const error = new Error("Gmail API chưa được kết nối. Hãy kết nối Gmail trong Trung tâm Quản lý Email.");
    error.code = "GMAIL_OAUTH_NOT_CONNECTED";
    error.status = 503;
    throw error;
  }
  if (status.sentToday >= status.dailyLimit) {
    const error = new Error(`Đã đạt ngưỡng gửi an toàn ${status.dailyLimit} email hôm nay.`);
    error.code = "GMAIL_SAFE_LIMIT_REACHED";
    error.status = 429;
    throw error;
  }

  const reservation = await reserveSend({ to: target, subject, idempotencyKey });
  if (reservation.existing?.status === "sent") {
    return {
      ok: true,
      provider: "gmail-api",
      messageId: reservation.existing.message_id || null,
      threadId: reservation.existing.thread_id || null,
      deduped: true,
      senderEmail: status.senderEmail,
    };
  }
  if (reservation.existing?.status === "pending") {
    const error = new Error("Email này đang được gửi ở một request khác.");
    error.code = "EMAIL_SEND_IN_PROGRESS";
    error.status = 409;
    throw error;
  }
  if (reservation.existing?.status === "failed") {
    const sql = getSql();
    await sql`
      UPDATE gmail_send_events
      SET status = 'pending', error_code = NULL, sent_at = NOW()
      WHERE id = ${reservation.existing.id}
    `;
    reservation.id = reservation.existing.id;
  }

  try {
    const accessToken = await getAccessToken();
    const raw = buildMimeMessage({
      fromEmail: status.senderEmail,
      fromName: clean(fromName, 120) || "Duchi Locket",
      to: target,
      subject: clean(subject, 500) || "Duchi Locket",
      text,
      html,
    });
    const response = await fetch(GMAIL_SEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.id) {
      const message = data?.error?.message || `Gmail API HTTP ${response.status}`;
      const error = new Error(message);
      error.code = response.status === 401 ? "GMAIL_OAUTH_REAUTH_REQUIRED" : "GMAIL_API_SEND_FAILED";
      error.status = response.status >= 400 ? response.status : 502;
      throw error;
    }

    if (reservation.id) {
      await markSend(reservation.id, {
        status: "sent",
        messageId: data.id,
        threadId: data.threadId || null,
      });
    } else {
      await recordNonIdempotentSend({
        to: target,
        subject,
        messageId: data.id,
        threadId: data.threadId || null,
      });
    }

    return {
      ok: true,
      provider: "gmail-api",
      messageId: data.id,
      threadId: data.threadId || null,
      deduped: false,
      senderEmail: status.senderEmail,
    };
  } catch (error) {
    if (reservation.id) {
      await markSend(reservation.id, {
        status: "failed",
        errorCode: error?.code || "GMAIL_API_SEND_FAILED",
      }).catch(() => {});
    }
    throw error;
  }
}

module.exports = {
  GMAIL_SEND_SCOPE,
  GOOGLE_EMAIL_SCOPES,
  createOAuthState,
  getGoogleOAuthClient,
  exchangeOAuthCode,
  getGoogleAccountEmail,
  saveGmailOAuth,
  disconnectGmailOAuth,
  getGmailStatus,
  sendGmailMessage,
};
