const notifiers = require("../modules/slotMonitor/notifiers");
const { getGmailStatus, sendGmailMessage } = require("./gmailApiMailer");

const originalSendEmail = notifiers.sendEmail;
const originalGetProviderConfig = notifiers.getProviderConfig;

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

if (!notifiers.__gmailApiPatched) {
  notifiers.__gmailApiPatched = true;

  notifiers.getProviderConfig = function getProviderConfigWithGmailApi() {
    const base = originalGetProviderConfig();
    return {
      ...base,
      email: {
        configured: Boolean(
          clean(process.env.DATABASE_URL || process.env.NEON_DATABASE_URL, 2000),
        ),
        provider: "gmail-api",
        requiresOauth: true,
      },
    };
  };

  notifiers.sendEmail = async function sendSlotEmailViaGmailApi(
    email,
    payload,
    { idempotencyKey = "" } = {},
  ) {
    const status = await getGmailStatus().catch(() => null);

    // Transitional safety: before the one-time OAuth connection is completed,
    // preserve the previous Apps Script sender so existing Canh Slot alerts do
    // not suddenly stop. As soon as Gmail OAuth is connected this branch is no
    // longer used and all sends go through Gmail API.
    if (!status?.connected) {
      return originalSendEmail(email, payload, { idempotencyKey });
    }

    const target = clean(email, 320).toLowerCase();
    if (!target || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      const error = new Error("Địa chỉ Gmail/Email không hợp lệ.");
      error.code = "EMAIL_ADDRESS_INVALID";
      error.status = 400;
      throw error;
    }

    const message = notifiers.buildSlotMessage(payload);
    const subject = notifiers.buildEmailSubject(payload, message);
    const text = notifiers.buildEmailText(payload, message);
    const html = notifiers.buildEmailHtml(payload, message);

    return sendGmailMessage({
      to: target,
      subject,
      text,
      html,
      fromName: clean(process.env.GMAIL_FROM_NAME, 120) || "Duchi Locket",
      idempotencyKey: clean(idempotencyKey, 240),
    });
  };
}

module.exports = notifiers;
