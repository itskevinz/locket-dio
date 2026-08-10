const { neon } = require("@neondatabase/serverless");
const store = require("./store");
const notificationHistoryStore = require("./notificationHistoryStore");
const {
  claimNotification,
  releaseNotificationClaim,
} = require("./notificationClaimStore");
const {
  getProviderConfig,
  sendTelegram,
  sendEmail,
  sendZalo,
} = require("./notifiers");

const CHANNELS = new Set(["telegram", "email", "zalo"]);
const DEFAULT_WEB_ORIGIN = "https://duchi.vercel.app";
const BUILTIN_WEB_ORIGINS = new Set([
  DEFAULT_WEB_ORIGIN,
  "https://huy-locket-production.up.railway.app",
]);

notificationHistoryStore.ensureSchema().catch((error) => {
  console.warn("[slot-monitor] notification history bootstrap failed", {
    code: error?.code || null,
  });
});

function normalizeOrigin(raw) {
  const value = String(raw || "").trim().slice(0, 500);
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function allowedWebOrigins() {
  const origins = new Set(BUILTIN_WEB_ORIGINS);
  for (const value of [process.env.PUBLIC_WEB_URL, process.env.APP_PUBLIC_URL]) {
    const normalized = normalizeOrigin(value);
    if (normalized) origins.add(normalized);
  }
  return origins;
}

function sanitizeWebOrigin(raw) {
  const normalized = normalizeOrigin(raw);
  return normalized && allowedWebOrigins().has(normalized) ? normalized : "";
}

function webOriginConfigKey(userUid) {
  return `slot-notification-web-origin:${String(userUid || "").slice(0, 200)}`;
}

function telegramUserConfigKey(chatId) {
  return `slot-telegram-user:${String(chatId || "").trim().slice(0, 120)}`;
}

async function rememberNotificationWebOrigin(userUid, rawOrigin) {
  const origin = sanitizeWebOrigin(rawOrigin);
  if (!origin) return "";
  await store.setConfigValue(webOriginConfigKey(userUid), origin);
  return origin;
}

async function rememberTelegramUser(userUid, rawChatId) {
  const chatId = String(rawChatId || "").trim().slice(0, 120);
  if (!userUid || !/^-?\d{4,24}$/.test(chatId)) return "";
  await store.setConfigValue(telegramUserConfigKey(chatId), String(userUid));
  return String(userUid);
}

async function findLegacyTelegramUser(chatId) {
  const databaseUrl = String(
    process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
  ).trim();
  if (!databaseUrl) return "";

  try {
    const sql = neon(databaseUrl);
    const rows = await sql`
      SELECT user_uid
      FROM slot_notification_channels
      WHERE telegram_chat_id = ${chatId}
        AND telegram_enabled = TRUE
      ORDER BY updated_at DESC
      LIMIT 2
    `;
    const unique = [...new Set(rows.map((row) => String(row?.user_uid || "").trim()).filter(Boolean))];
    return unique.length === 1 ? unique[0] : "";
  } catch (error) {
    console.warn("[slot-monitor] telegram legacy link lookup failed", {
      code: error?.code || null,
    });
    return "";
  }
}

async function getUserUidByTelegramChatId(rawChatId) {
  const chatId = String(rawChatId || "").trim().slice(0, 120);
  if (!/^-?\d{4,24}$/.test(chatId)) return "";

  const mapped = String(
    await store.getConfigValue(telegramUserConfigKey(chatId)) || "",
  ).trim();
  if (mapped) return mapped;

  // Tương thích tài khoản đã liên kết Telegram trước khi bot /slots được thêm.
  // Nếu tìm thấy đúng 1 tài khoản đang bật Telegram với Chat ID này thì tự tạo mapping.
  const legacyUserUid = await findLegacyTelegramUser(chatId);
  if (legacyUserUid) {
    await rememberTelegramUser(legacyUserUid, chatId).catch(() => {});
    return legacyUserUid;
  }

  return "";
}

async function getNotificationWebOrigin(userUid) {
  const stored = sanitizeWebOrigin(
    await store.getConfigValue(webOriginConfigKey(userUid)),
  );
  return stored || DEFAULT_WEB_ORIGIN;
}

function resolveNotificationUrl(webOrigin, rawUrl = "/friends?slot=1") {
  const origin = sanitizeWebOrigin(webOrigin) || DEFAULT_WEB_ORIGIN;
  const value = String(rawUrl || "/friends?slot=1").trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return `${origin}/friends?slot=1`;
    }
  }
  return `${origin}${value.startsWith("/") ? "" : "/"}${value}`;
}

function sanitizeSettings(raw = {}) {
  const telegramChatId = String(raw.telegramChatId || "").trim().slice(0, 120);
  const emailAddress = String(raw.emailAddress || "").trim().toLowerCase().slice(0, 320);
  const zaloUserId = String(raw.zaloUserId || "").trim().slice(0, 160);

  if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
    const error = new Error("Địa chỉ Gmail/Email không hợp lệ.");
    error.code = "INVALID_EMAIL_ADDRESS";
    error.status = 400;
    throw error;
  }
  if (telegramChatId && !/^-?\d{4,24}$/.test(telegramChatId)) {
    const error = new Error("Telegram Chat ID không hợp lệ.");
    error.code = "INVALID_TELEGRAM_CHAT_ID";
    error.status = 400;
    throw error;
  }
  if (zaloUserId && !/^\d{4,40}$/.test(zaloUserId)) {
    const error = new Error("Zalo User ID không hợp lệ.");
    error.code = "INVALID_ZALO_USER_ID";
    error.status = 400;
    throw error;
  }

  return {
    telegramChatId,
    telegramEnabled: Boolean(raw.telegramEnabled && telegramChatId),
    emailAddress,
    emailEnabled: Boolean(raw.emailEnabled && emailAddress),
    zaloUserId,
    zaloEnabled: Boolean(raw.zaloEnabled && zaloUserId),
  };
}

async function getNotificationSettings(userUid) {
  const [settings, webOrigin] = await Promise.all([
    store.getNotificationSettings(userUid),
    getNotificationWebOrigin(userUid),
  ]);
  if (settings.telegramChatId) {
    await rememberTelegramUser(userUid, settings.telegramChatId);
  }
  return {
    ...settings,
    webOrigin,
    providers: getProviderConfig(),
  };
}

async function saveNotificationSettings(userUid, raw) {
  const settings = sanitizeSettings(raw);
  const saved = await store.saveNotificationSettings(userUid, settings);
  if (saved.telegramChatId) {
    await rememberTelegramUser(userUid, saved.telegramChatId);
  }
  return {
    ...saved,
    webOrigin: await getNotificationWebOrigin(userUid),
    providers: getProviderConfig(),
  };
}

function publicError(error) {
  return {
    ok: false,
    code: error?.code || "NOTIFICATION_SEND_FAILED",
    message: error?.message || "Gửi thông báo thất bại.",
  };
}

async function recordDeliverySafe({
  userUid,
  eventId,
  channel,
  status,
  payload,
  error = null,
}) {
  try {
    await notificationHistoryStore.recordDelivery({
      userUid,
      eventId,
      channel,
      status,
      payload,
      errorCode: error?.code || "",
      errorMessage: error?.message || "",
    });
  } catch (historyError) {
    console.warn("[slot-monitor] notification history write failed", {
      userUid,
      channel,
      code: historyError?.code || null,
    });
  }
}

async function sendTrackedNotification({
  userUid,
  eventId,
  channel,
  payload,
  send,
}) {
  try {
    const result = await send();
    await recordDeliverySafe({
      userUid,
      eventId,
      channel,
      status: "SUCCESS",
      payload,
    });
    return result;
  } catch (error) {
    await recordDeliverySafe({
      userUid,
      eventId,
      channel,
      status: "FAILED",
      payload,
      error,
    });
    throw error;
  }
}

async function sendConfiguredNotifications(userUid, payload, { eventId = "" } = {}) {
  const [settings, webOrigin] = await Promise.all([
    store.getNotificationSettings(userUid),
    getNotificationWebOrigin(userUid),
  ]);
  if (settings.telegramChatId) {
    await rememberTelegramUser(userUid, settings.telegramChatId).catch(() => {});
  }
  const deliveryPayload = {
    ...payload,
    url: resolveNotificationUrl(webOrigin, payload?.url || "/friends?slot=1"),
  };
  const tasks = [];

  if (settings.telegramEnabled && settings.telegramChatId) {
    tasks.push([
      "telegram",
      async () => {
        const claimed = await claimNotification(
          "telegram",
          settings.telegramChatId,
          eventId,
        );
        if (!claimed) {
          console.log("[slot-monitor] telegram duplicate suppressed", {
            eventId,
          });
          return { ok: true, provider: "telegram", deduped: true };
        }

        try {
          return await sendTelegram(settings.telegramChatId, deliveryPayload);
        } catch (error) {
          await releaseNotificationClaim(
            "telegram",
            settings.telegramChatId,
            eventId,
          );
          throw error;
        }
      },
    ]);
  }
  if (settings.emailEnabled && settings.emailAddress) {
    tasks.push([
      "email",
      () => sendEmail(settings.emailAddress, deliveryPayload, {
        idempotencyKey: eventId ? `slot-${eventId}-email` : "",
      }),
    ]);
  }
  if (settings.zaloEnabled && settings.zaloUserId) {
    tasks.push(["zalo", () => sendZalo(settings.zaloUserId, deliveryPayload)]);
  }

  const results = {};
  await Promise.all(
    tasks.map(async ([channel, send]) => {
      try {
        results[channel] = await sendTrackedNotification({
          userUid,
          eventId,
          channel,
          payload: deliveryPayload,
          send,
        });
      } catch (error) {
        results[channel] = publicError(error);
        console.warn("[slot-monitor] external notification failed", {
          userUid,
          channel,
          code: error?.code || null,
          status: error?.status || null,
        });
      }
    }),
  );
  return results;
}

async function testNotificationChannel(userUid, channel, { webOrigin = "" } = {}) {
  const normalized = String(channel || "").trim().toLowerCase();
  if (!CHANNELS.has(normalized)) {
    const error = new Error("Kênh thông báo không hợp lệ.");
    error.code = "INVALID_NOTIFICATION_CHANNEL";
    error.status = 400;
    throw error;
  }

  if (webOrigin) await rememberNotificationWebOrigin(userUid, webOrigin);
  const [settings, selectedWebOrigin] = await Promise.all([
    store.getNotificationSettings(userUid),
    getNotificationWebOrigin(userUid),
  ]);
  if (settings.telegramChatId) {
    await rememberTelegramUser(userUid, settings.telegramChatId);
  }
  const payload = {
    type: "slot-test",
    title: "Duchi Locket | Xác nhận kết nối Canh Slot",
    body: "Kênh thông báo đã kết nối thành công.",
    url: resolveNotificationUrl(selectedWebOrigin, "/friends?slot=1"),
  };
  const eventId = `test-${normalized}-${Date.now()}`;

  if (normalized === "telegram") {
    return sendTrackedNotification({
      userUid,
      eventId,
      channel: normalized,
      payload,
      send: () => sendTelegram(settings.telegramChatId, payload),
    });
  }
  if (normalized === "email") {
    return sendTrackedNotification({
      userUid,
      eventId,
      channel: normalized,
      payload,
      send: () => sendEmail(settings.emailAddress, payload, {
        idempotencyKey: `slot-test-${userUid}-${Date.now()}`,
      }),
    });
  }
  return sendTrackedNotification({
    userUid,
    eventId,
    channel: normalized,
    payload,
    send: () => sendZalo(settings.zaloUserId, payload),
  });
}

module.exports = {
  sanitizeSettings,
  sanitizeWebOrigin,
  rememberNotificationWebOrigin,
  rememberTelegramUser,
  getUserUidByTelegramChatId,
  getNotificationSettings,
  saveNotificationSettings,
  sendConfiguredNotifications,
  testNotificationChannel,
};
