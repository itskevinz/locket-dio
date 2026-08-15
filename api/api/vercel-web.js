const { vercelHandler } = require("../app.js");
const { ensureTelegramWebhook } = require("../src/modules/slotMonitor/telegramWebhook");

let telegramWebhookBootstrapped = false;

function bootstrapTelegramWebhook() {
  if (telegramWebhookBootstrapped) return;
  telegramWebhookBootstrapped = true;
  ensureTelegramWebhook()
    .then((info) => {
      console.log("[telegram-webhook] ready", {
        url: info?.url || null,
        pendingUpdateCount: info?.pendingUpdateCount ?? null,
        lastErrorMessage: info?.lastErrorMessage || null,
      });
    })
    .catch((error) => {
      telegramWebhookBootstrapped = false;
      console.warn("[telegram-webhook] bootstrap failed", {
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || "unknown",
      });
    });
}

module.exports = function vercelWeb(req, res) {
  bootstrapTelegramWebhook();
  return vercelHandler(req, res);
};
