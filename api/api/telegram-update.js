const { handleTelegramWebhook } = require("../src/modules/slotMonitor/telegramWebhook");

module.exports = async function telegramUpdate(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, code: "METHOD_NOT_ALLOWED" });
  }

  return handleTelegramWebhook(req, res);
};
