const { neon } = require("@neondatabase/serverless");

const databaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const sql = databaseUrl ? neon(databaseUrl) : null;
let schemaPromise = null;

function isConfigured() {
  return Boolean(sql);
}

async function ensureSchema() {
  if (!sql) {
    const error = new Error("DATABASE_URL is required for 24/7 Slot Monitor");
    error.code = "SLOT_DATABASE_UNAVAILABLE";
    throw error;
  }
  if (schemaPromise) return schemaPromise;

  schemaPromise = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS slot_monitor_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS slot_monitor_sessions (
        user_uid TEXT PRIMARY KEY,
        refresh_token_enc TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        last_refresh_at TIMESTAMPTZ,
        last_error TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS slot_monitor_watches (
        user_uid TEXT NOT NULL,
        celeb_uid TEXT NOT NULL,
        username TEXT NOT NULL,
        display_name TEXT,
        avatar_url TEXT,
        friend_count BIGINT NOT NULL DEFAULT 0,
        max_friends BIGINT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'WATCHING',
        last_was_full BOOLEAN NOT NULL DEFAULT TRUE,
        last_checked_at TIMESTAMPTZ,
        notified_at TIMESTAMPTZ,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        auto_request_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        last_auto_request_at TIMESTAMPTZ,
        last_auto_request_status TEXT,
        last_auto_request_error TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_uid, celeb_uid)
      )
    `;
    // Bảng cũ đã tồn tại trước tính năng auto-request nên cần migration idempotent.
    await sql`
      ALTER TABLE slot_monitor_watches
      ADD COLUMN IF NOT EXISTS auto_request_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `;
    await sql`
      ALTER TABLE slot_monitor_watches
      ADD COLUMN IF NOT EXISTS last_auto_request_at TIMESTAMPTZ
    `;
    await sql`
      ALTER TABLE slot_monitor_watches
      ADD COLUMN IF NOT EXISTS last_auto_request_status TEXT
    `;
    await sql`
      ALTER TABLE slot_monitor_watches
      ADD COLUMN IF NOT EXISTS last_auto_request_error TEXT
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_slot_monitor_watches_user_enabled
      ON slot_monitor_watches (user_uid, enabled)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS slot_push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        user_uid TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        user_agent TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_slot_push_subscriptions_user_active
      ON slot_push_subscriptions (user_uid, active)
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS slot_notification_channels (
        user_uid TEXT PRIMARY KEY,
        telegram_chat_id TEXT,
        telegram_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        email_address TEXT,
        email_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        zalo_user_id TEXT,
        zalo_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `;
  })().catch((error) => {
    schemaPromise = null;
    throw error;
  });

  return schemaPromise;
}

async function getConfigValue(key) {
  await ensureSchema();
  const rows = await sql`
    SELECT value FROM slot_monitor_config WHERE key = ${String(key)} LIMIT 1
  `;
  return rows[0]?.value || null;
}

async function setConfigValue(key, value) {
  await ensureSchema();
  await sql`
    INSERT INTO slot_monitor_config (key, value, updated_at)
    VALUES (${String(key)}, ${String(value)}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

async function saveSession(userUid, refreshTokenEnc) {
  await ensureSchema();
  await sql`
    INSERT INTO slot_monitor_sessions
      (user_uid, refresh_token_enc, enabled, last_error, updated_at)
    VALUES (${String(userUid)}, ${String(refreshTokenEnc)}, TRUE, NULL, NOW())
    ON CONFLICT (user_uid) DO UPDATE SET
      refresh_token_enc = EXCLUDED.refresh_token_enc,
      enabled = TRUE,
      last_error = NULL,
      updated_at = NOW()
  `;
}

async function getSession(userUid) {
  await ensureSchema();
  const rows = await sql`
    SELECT user_uid, refresh_token_enc, enabled, last_refresh_at, last_error
    FROM slot_monitor_sessions
    WHERE user_uid = ${String(userUid)}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function markSessionRefreshed(userUid, refreshTokenEnc = null) {
  await ensureSchema();
  if (refreshTokenEnc) {
    await sql`
      UPDATE slot_monitor_sessions
      SET refresh_token_enc = ${String(refreshTokenEnc)}, last_refresh_at = NOW(),
          last_error = NULL, enabled = TRUE, updated_at = NOW()
      WHERE user_uid = ${String(userUid)}
    `;
  } else {
    await sql`
      UPDATE slot_monitor_sessions
      SET last_refresh_at = NOW(), last_error = NULL, enabled = TRUE, updated_at = NOW()
      WHERE user_uid = ${String(userUid)}
    `;
  }
}

async function markSessionError(userUid, message) {
  await ensureSchema();
  await sql`
    UPDATE slot_monitor_sessions
    SET last_error = ${String(message || "Session refresh failed").slice(0, 400)}, updated_at = NOW()
    WHERE user_uid = ${String(userUid)}
  `;
}

async function upsertWatch(userUid, watch) {
  await ensureSchema();
  await sql`
    INSERT INTO slot_monitor_watches (
      user_uid, celeb_uid, username, display_name, avatar_url,
      friend_count, max_friends, status, last_was_full, enabled, updated_at
    ) VALUES (
      ${String(userUid)}, ${String(watch.uid)}, ${String(watch.username)},
      ${String(watch.displayName || watch.username)}, ${String(watch.avatar || "")},
      ${Number(watch.friendCount) || 0}, ${Number(watch.maxFriends) || 0},
      ${String(watch.status || "WATCHING")},
      ${Boolean((Number(watch.maxFriends) || 0) > 0 && (Number(watch.friendCount) || 0) >= (Number(watch.maxFriends) || 0))},
      TRUE, NOW()
    )
    ON CONFLICT (user_uid, celeb_uid) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      friend_count = EXCLUDED.friend_count,
      max_friends = EXCLUDED.max_friends,
      enabled = TRUE,
      updated_at = NOW()
  `;
}

async function removeWatch(userUid, celebUid) {
  await ensureSchema();
  await sql`
    DELETE FROM slot_monitor_watches
    WHERE user_uid = ${String(userUid)} AND celeb_uid = ${String(celebUid)}
  `;
}

async function setWatchEnabled(userUid, celebUid, enabled) {
  await ensureSchema();
  await sql`
    UPDATE slot_monitor_watches
    SET enabled = ${Boolean(enabled)},
        status = ${enabled ? "WATCHING" : "PAUSED"},
        updated_at = NOW()
    WHERE user_uid = ${String(userUid)} AND celeb_uid = ${String(celebUid)}
  `;
}

async function setWatchAutoRequestEnabled(userUid, celebUid, enabled) {
  await ensureSchema();
  await sql`
    UPDATE slot_monitor_watches
    SET auto_request_enabled = ${Boolean(enabled)},
        last_auto_request_error = CASE WHEN ${Boolean(enabled)} THEN NULL ELSE last_auto_request_error END,
        updated_at = NOW()
    WHERE user_uid = ${String(userUid)} AND celeb_uid = ${String(celebUid)}
  `;
}

async function markAutoRequestResult(userUid, celebUid, result = {}) {
  await ensureSchema();
  const requestedStatus = String(result.status || "FAILED").slice(0, 40).toUpperCase();
  // FAILED trong Auto Celeb không phải trạng thái kết thúc: worker phải đọc lại
  // snapshot ở vòng Turbo kế tiếp. RETRYING tránh cooldown FAILED cũ, nên nếu
  // vẫn còn slot thì gửi tiếp; nếu full thì không gửi cho tới khi slot mở lại.
  const status = requestedStatus === "FAILED" ? "RETRYING" : requestedStatus;
  const errorText = result.error
    ? String(result.error).slice(0, 500)
    : null;
  await sql`
    UPDATE slot_monitor_watches
    SET last_auto_request_at = NOW(),
        last_auto_request_status = ${status},
        last_auto_request_error = ${errorText},
        updated_at = NOW()
    WHERE user_uid = ${String(userUid)} AND celeb_uid = ${String(celebUid)}
  `;
}

async function listUserWatches(userUid) {
  await ensureSchema();
  return sql`
    SELECT user_uid, celeb_uid, username, display_name, avatar_url,
           friend_count, max_friends, status, last_was_full,
           last_checked_at, notified_at, enabled,
           auto_request_enabled, last_auto_request_at,
           last_auto_request_status, last_auto_request_error
    FROM slot_monitor_watches
    WHERE user_uid = ${String(userUid)}
    ORDER BY created_at ASC
  `;
}

async function listActiveUsers() {
  await ensureSchema();
  return sql`
    SELECT DISTINCT w.user_uid
    FROM slot_monitor_watches w
    INNER JOIN slot_monitor_sessions s ON s.user_uid = w.user_uid
    WHERE w.enabled = TRUE AND s.enabled = TRUE
    ORDER BY w.user_uid ASC
  `;
}

async function listActiveWatchesForUser(userUid) {
  await ensureSchema();
  return sql`
    SELECT user_uid, celeb_uid, username, display_name, avatar_url,
           friend_count, max_friends, status, last_was_full,
           last_checked_at, notified_at, enabled,
           auto_request_enabled, last_auto_request_at,
           last_auto_request_status, last_auto_request_error
    FROM slot_monitor_watches
    WHERE user_uid = ${String(userUid)} AND enabled = TRUE
    ORDER BY created_at ASC
    LIMIT 20
  `;
}

async function updateWatchSnapshot(userUid, celebUid, snapshot) {
  await ensureSchema();
  await sql`
    UPDATE slot_monitor_watches
    SET friend_count = ${Number(snapshot.friendCount) || 0},
        max_friends = ${Number(snapshot.maxFriends) || 0},
        status = ${String(snapshot.status || "WATCHING")},
        last_was_full = ${Boolean(snapshot.lastWasFull)},
        last_checked_at = NOW(),
        notified_at = CASE WHEN ${Boolean(snapshot.shouldNotify)} THEN NOW() ELSE notified_at END,
        updated_at = NOW()
    WHERE user_uid = ${String(userUid)} AND celeb_uid = ${String(celebUid)}
  `;
}

async function upsertSubscription(userUid, subscription, userAgent = "") {
  await ensureSchema();
  const endpoint = String(subscription?.endpoint || "");
  const p256dh = String(subscription?.keys?.p256dh || "");
  const auth = String(subscription?.keys?.auth || "");
  if (!endpoint || !p256dh || !auth) {
    const error = new Error("Invalid push subscription");
    error.code = "INVALID_PUSH_SUBSCRIPTION";
    throw error;
  }

  await sql`
    INSERT INTO slot_push_subscriptions
      (endpoint, user_uid, p256dh, auth, active, user_agent, updated_at)
    VALUES (
      ${endpoint}, ${String(userUid)}, ${p256dh}, ${auth}, TRUE,
      ${String(userAgent || "").slice(0, 500)}, NOW()
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      user_uid = EXCLUDED.user_uid,
      p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth,
      active = TRUE,
      user_agent = EXCLUDED.user_agent,
      updated_at = NOW()
  `;
}

async function listSubscriptionsForUser(userUid) {
  await ensureSchema();
  return sql`
    SELECT endpoint, p256dh, auth
    FROM slot_push_subscriptions
    WHERE user_uid = ${String(userUid)} AND active = TRUE
  `;
}

async function deactivateSubscription(endpoint) {
  await ensureSchema();
  await sql`
    UPDATE slot_push_subscriptions
    SET active = FALSE, updated_at = NOW()
    WHERE endpoint = ${String(endpoint)}
  `;
}

async function getNotificationSettings(userUid) {
  await ensureSchema();
  const rows = await sql`
    SELECT telegram_chat_id, telegram_enabled,
           email_address, email_enabled,
           zalo_user_id, zalo_enabled
    FROM slot_notification_channels
    WHERE user_uid = ${String(userUid)}
    LIMIT 1
  `;
  const row = rows[0] || {};
  return {
    telegramChatId: row.telegram_chat_id || "",
    telegramEnabled: Boolean(row.telegram_enabled),
    emailAddress: row.email_address || "",
    emailEnabled: Boolean(row.email_enabled),
    zaloUserId: row.zalo_user_id || "",
    zaloEnabled: Boolean(row.zalo_enabled),
  };
}

async function saveNotificationSettings(userUid, settings = {}) {
  await ensureSchema();
  const telegramChatId = String(settings.telegramChatId || "").trim().slice(0, 120);
  const emailAddress = String(settings.emailAddress || "").trim().slice(0, 320);
  const zaloUserId = String(settings.zaloUserId || "").trim().slice(0, 160);
  const telegramEnabled = Boolean(settings.telegramEnabled && telegramChatId);
  const emailEnabled = Boolean(settings.emailEnabled && emailAddress);
  const zaloEnabled = Boolean(settings.zaloEnabled && zaloUserId);

  await sql`
    INSERT INTO slot_notification_channels (
      user_uid, telegram_chat_id, telegram_enabled,
      email_address, email_enabled,
      zalo_user_id, zalo_enabled, updated_at
    ) VALUES (
      ${String(userUid)}, ${telegramChatId || null}, ${telegramEnabled},
      ${emailAddress || null}, ${emailEnabled},
      ${zaloUserId || null}, ${zaloEnabled}, NOW()
    )
    ON CONFLICT (user_uid) DO UPDATE SET
      telegram_chat_id = EXCLUDED.telegram_chat_id,
      telegram_enabled = EXCLUDED.telegram_enabled,
      email_address = EXCLUDED.email_address,
      email_enabled = EXCLUDED.email_enabled,
      zalo_user_id = EXCLUDED.zalo_user_id,
      zalo_enabled = EXCLUDED.zalo_enabled,
      updated_at = NOW()
  `;

  return getNotificationSettings(userUid);
}

module.exports = {
  isConfigured,
  ensureSchema,
  getConfigValue,
  setConfigValue,
  saveSession,
  getSession,
  markSessionRefreshed,
  markSessionError,
  upsertWatch,
  removeWatch,
  setWatchEnabled,
  setWatchAutoRequestEnabled,
  markAutoRequestResult,
  listUserWatches,
  listActiveUsers,
  listActiveWatchesForUser,
  updateWatchSnapshot,
  upsertSubscription,
  listSubscriptionsForUser,
  deactivateSubscription,
  getNotificationSettings,
  saveNotificationSettings,
};
