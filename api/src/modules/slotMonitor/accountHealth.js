const store = require("./store");
const { getEncryptionKey } = require("./crypto");
const { getPublicConfig } = require("./service");
const { getNotificationSettings } = require("./notificationService");
const { pollingIntervalsFromConfig } = require("./pollingPolicy");

function toMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function makeCheck({ id, label, ok, warning = false, detail = "", meta = {} }) {
  return {
    id,
    label,
    status: ok ? "OK" : warning ? "WARNING" : "ERROR",
    detail,
    ...meta,
  };
}

async function getAccountHealth(userUid) {
  const [session, watches, subscriptions, notificationSettings, publicConfig] =
    await Promise.all([
      store.getSession(userUid),
      store.listUserWatches(userUid),
      store.listSubscriptionsForUser(userUid),
      getNotificationSettings(userUid),
      getPublicConfig(),
    ]);

  const enabledWatches = watches.filter((item) => item.enabled).length;
  const sessionReady = Boolean(
    session?.enabled && session?.refresh_token_enc && !session?.last_error,
  );
  const sessionExists = Boolean(session?.enabled && session?.refresh_token_enc);
  const providerConfig = notificationSettings?.providers || {};
  const polling = pollingIntervalsFromConfig(publicConfig || {});

  const checks = [
    makeCheck({
      id: "auth",
      label: "Phiên đăng nhập Locket/Firebase",
      ok: true,
      detail: "ID token hiện tại đã được backend xác thực.",
    }),
    makeCheck({
      id: "background-session",
      label: "Phiên Canh Slot nền",
      ok: sessionReady,
      warning: sessionExists,
      detail: sessionReady
        ? "Render worker có phiên nền để canh slot khi đóng web."
        : sessionExists
          ? `Phiên nền còn lưu nhưng lần gần nhất có lỗi: ${String(session?.last_error || "không rõ").slice(0, 220)}`
          : "Chưa có phiên nền. Hãy bật Canh Slot 24/7.",
      meta: {
        enabled: Boolean(session?.enabled),
        lastRefreshAt: toMs(session?.last_refresh_at),
        hasStoredRefreshToken: Boolean(session?.refresh_token_enc),
      },
    }),
    makeCheck({
      id: "slot-monitor",
      label: "Canh Slot",
      ok: Boolean(publicConfig?.enabled && store.isConfigured() && getEncryptionKey()),
      detail: publicConfig?.enabled
        ? `${enabledWatches}/${watches.length} Celeb đang hoạt động • nền ${polling.normalSeconds} giây • nhanh ${polling.fastSeconds} giây • tự động ${polling.autoRequestSeconds} giây.`
        : "Canh Slot backend chưa sẵn sàng.",
      meta: {
        watchCount: watches.length,
        activeWatchCount: enabledWatches,
        pollIntervalMs: Number(publicConfig?.pollIntervalMs) || 0,
        fastPollIntervalMs: Number(publicConfig?.fastPollIntervalMs) || 0,
        autoRequestPollIntervalMs: Number(publicConfig?.autoRequestPollIntervalMs) || 0,
        fastWindowMs: Number(publicConfig?.fastWindowMs) || 0,
      },
    }),
    makeCheck({
      id: "web-push",
      label: "Web Push",
      ok: subscriptions.length > 0,
      warning: true,
      detail: subscriptions.length > 0
        ? `${subscriptions.length} thiết bị đang đăng ký nhận push.`
        : "Chưa có thiết bị Web Push hoạt động; Render vẫn có thể canh nền nếu phiên nền đã bật.",
      meta: { deviceCount: subscriptions.length },
    }),
    makeCheck({
      id: "telegram",
      label: "Telegram",
      ok: Boolean(
        providerConfig?.telegram?.configured &&
          notificationSettings?.telegramEnabled &&
          notificationSettings?.telegramChatId,
      ),
      warning: true,
      detail: !providerConfig?.telegram?.configured
        ? "Bot Telegram chưa được cấu hình trên server."
        : notificationSettings?.telegramEnabled && notificationSettings?.telegramChatId
          ? "Telegram đã liên kết và đang bật."
          : "Telegram chưa bật cho tài khoản này.",
      meta: {
        configured: Boolean(providerConfig?.telegram?.configured),
        enabled: Boolean(notificationSettings?.telegramEnabled),
        linked: Boolean(notificationSettings?.telegramChatId),
      },
    }),
    makeCheck({
      id: "email",
      label: "Gmail",
      ok: Boolean(
        providerConfig?.email?.configured &&
          notificationSettings?.emailEnabled &&
          notificationSettings?.emailAddress,
      ),
      warning: true,
      detail: !providerConfig?.email?.configured
        ? "Gmail relay chưa được cấu hình trên server."
        : notificationSettings?.emailEnabled && notificationSettings?.emailAddress
          ? "Gmail đã liên kết và đang bật."
          : "Gmail chưa bật cho tài khoản này.",
      meta: {
        configured: Boolean(providerConfig?.email?.configured),
        enabled: Boolean(notificationSettings?.emailEnabled),
        linked: Boolean(notificationSettings?.emailAddress),
      },
    }),
  ];

  const errorCount = checks.filter((item) => item.status === "ERROR").length;
  const warningCount = checks.filter((item) => item.status === "WARNING").length;

  return {
    overall: errorCount > 0 ? "ERROR" : warningCount > 0 ? "WARNING" : "OK",
    errorCount,
    warningCount,
    checkedAt: Date.now(),
    checks,
  };
}

module.exports = {
  getAccountHealth,
};
