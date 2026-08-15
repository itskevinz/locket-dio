const crypto = require("crypto");
const { handleUpdate } = require("./telegramBot");

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_WEBHOOK_BASE = "https://huy-locket-api-huy-locket.vercel.app";
const WEBHOOK_PATH = "/api/telegram/webhook";
const ENSURE_TTL_MS = 10 * 60 * 1000;

let lastEnsureAt = 0;
let ensurePromise = null;

const clean = (value, max = 1000) => String(value || "").trim().slice(0, max);

function getBotToken() {
  return clean(process.env.TELEGRAM_BOT_TOKEN, 500);
}

function normalizeHttpsUrl(value) {
  const raw = clean(value, 1000).replace(/\/+$/, "");
  if (!raw) return "";
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^http:\/\//i.test(raw)) return raw.replace(/^http:\/\//i, "https://");
  return `https://${raw}`;
}

function getWebhookUrl() {
  const explicit = normalizeHttpsUrl(process.env.TELEGRAM_WEBHOOK_URL);
  if (explicit) return explicit;

  const base = normalizeHttpsUrl(
    process.env.TELEGRAM_WEBHOOK_BASE_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      DEFAULT_WEBHOOK_BASE,
  );

  return `${base || DEFAULT_WEBHOOK_BASE}${WEBHOOK_PATH}`;
}

function getWebhookSecret() {
  const explicit = clean(process.env.TELEGRAM_WEBHOOK_SECRET, 256);
  if (explicit && /^[A-Za-z0-9_-]{1,256}$/.test(explicit)) return explicit;

  const token = getBotToken();
  if (!token) return "";
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function telegramApi(method, body = {}, { timeoutMs = 15000 } = {}) {
  const token = getBotToken();
  if (!token) {
    const error = new Error("TELEGRAM_BOT_TOKEN missing");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok === false) {
    const error = new Error(data?.description || `Telegram ${method} failed`);
    error.code = "TELEGRAM_API_FAILED";
    error.status = response.status;
    throw error;
  }

  return data?.result;
}

async function configureWebhookNow() {
  const webhookUrl = getWebhookUrl();
  const secretToken = getWebhookSecret();
  if (!secretToken) {
    const error = new Error("Telegram webhook secret unavailable");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }

  await telegramApi("setMyCommands", {
    commands: [
      { command: "start", description: "Bắt đầu và lấy Chat ID" },
      { command: "id", description: "Hiện Telegram Chat ID của bạn" },
      { command: "slots", description: "Xem slot của tất cả Celeb đang canh" },
      { command: "slot", description: "Xem một Celeb: /slot @username" },
      { command: "help", description: "Hướng dẫn liên kết Duchi Locket" },
    ],
  });

  await telegramApi("setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
    max_connections: 20,
  });

  const info = await telegramApi("getWebhookInfo");
  lastEnsureAt = Date.now();

  return {
    url: clean(info?.url, 1000) || webhookUrl,
    pendingUpdateCount: Math.max(0, Number(info?.pending_update_count) || 0),
    lastErrorDate: Number(info?.last_error_date) || null,
    lastErrorMessage: clean(info?.last_error_message, 500) || null,
  };
}

async function ensureTelegramWebhook({ force = false } = {}) {
  if (!getBotToken()) {
    const error = new Error("TELEGRAM_BOT_TOKEN missing");
    error.code = "TELEGRAM_NOT_CONFIGURED";
    throw error;
  }

  if (!force && lastEnsureAt && Date.now() - lastEnsureAt < ENSURE_TTL_MS) {
    return {
      url: getWebhookUrl(),
      pendingUpdateCount: null,
      lastErrorDate: null,
      lastErrorMessage: null,
      cached: true,
    };
  }

  if (ensurePromise) return ensurePromise;
  ensurePromise = configureWebhookNow().finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

function safeSecretMatches(actual, expected) {
  const left = Buffer.from(clean(actual, 256));
  const right = Buffer.from(clean(expected, 256));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function handleTelegramWebhook(req, res) {
  const expectedSecret = getWebhookSecret();
  if (!expectedSecret) {
    return res.status(503).json({ success: false, code: "TELEGRAM_NOT_CONFIGURED" });
  }

  const actualSecret = req.get("x-telegram-bot-api-secret-token") || "";
  if (!safeSecretMatches(actualSecret, expectedSecret)) {
    return res.status(401).json({ success: false, code: "TELEGRAM_WEBHOOK_UNAUTHORIZED" });
  }

  const update = req.body;
  if (!update || !Number.isFinite(Number(update.update_id))) {
    return res.status(400).json({ success: false, code: "INVALID_TELEGRAM_UPDATE" });
  }

  try {
    await handleUpdate(update);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.warn("[telegram-webhook] update handling failed", {
      updateId: Number(update.update_id),
      code: error?.code || null,
      status: error?.status || null,
    });
    return res.status(500).json({
      success: false,
      code: error?.code || "TELEGRAM_UPDATE_FAILED",
    });
  }
}

module.exports = {
  ensureTelegramWebhook,
  handleTelegramWebhook,
  getWebhookUrl,
};
