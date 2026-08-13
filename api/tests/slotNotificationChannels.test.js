const test = require("node:test");
const assert = require("node:assert/strict");

const { sanitizeSettings } = require("../src/modules/slotMonitor/notificationService");
const {
  buildSlotMessage,
  buildEmailSubject,
  buildEmailText,
  buildEmailHtml,
  getProviderConfig,
} = require("../src/modules/slotMonitor/notifiers");

test("notification settings keep only valid destinations and enabled channels", () => {
  const settings = sanitizeSettings({
    telegramChatId: "123456789",
    telegramEnabled: true,
    emailAddress: "User@Gmail.com",
    emailEnabled: true,
    zaloUserId: "186729651760683225",
    zaloEnabled: true,
  });

  assert.deepEqual(settings, {
    telegramChatId: "123456789",
    telegramEnabled: true,
    emailAddress: "user@gmail.com",
    emailEnabled: true,
    zaloUserId: "186729651760683225",
    zaloEnabled: true,
  });
});

test("disabled destination cannot become enabled without an address/id", () => {
  const settings = sanitizeSettings({
    telegramEnabled: true,
    emailEnabled: true,
    zaloEnabled: true,
  });
  assert.equal(settings.telegramEnabled, false);
  assert.equal(settings.emailEnabled, false);
  assert.equal(settings.zaloEnabled, false);
});

test("invalid email is rejected", () => {
  assert.throws(
    () => sanitizeSettings({ emailAddress: "not-an-email", emailEnabled: true }),
    (error) => error?.code === "INVALID_EMAIL_ADDRESS",
  );
});

test("Gmail provider is configured only with Apps Script URL and secret", () => {
  const previousUrl = process.env.GMAIL_APPS_SCRIPT_URL;
  const previousSecret = process.env.GMAIL_APPS_SCRIPT_SECRET;
  try {
    delete process.env.GMAIL_APPS_SCRIPT_URL;
    delete process.env.GMAIL_APPS_SCRIPT_SECRET;
    assert.equal(getProviderConfig().email.configured, false);

    process.env.GMAIL_APPS_SCRIPT_URL = "https://script.google.com/macros/s/test/exec";
    assert.equal(getProviderConfig().email.configured, false);

    process.env.GMAIL_APPS_SCRIPT_SECRET = "test-secret";
    assert.equal(getProviderConfig().email.configured, true);
  } finally {
    if (previousUrl === undefined) delete process.env.GMAIL_APPS_SCRIPT_URL;
    else process.env.GMAIL_APPS_SCRIPT_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.GMAIL_APPS_SCRIPT_SECRET;
    else process.env.GMAIL_APPS_SCRIPT_SECRET = previousSecret;
  }
});

test("slot message shows available slots and new capacity", () => {
  const previousWeb = process.env.PUBLIC_WEB_URL;
  process.env.PUBLIC_WEB_URL = "https://duchi.vercel.app";
  try {
    const message = buildSlotMessage({
      title: "🔥 Slot vừa mở!",
      url: "/friends?slot=1&username=celeb",
      celeb: {
        username: "celeb",
        availableSlots: 10000,
        friendCount: 20000,
        maxFriends: 30000,
      },
    });

    assert.match(message.text, /10[.\s]?000 slot trống/);
    assert.match(message.text, /20[.\s]?000 \/ 30[.\s]?000/);
    assert.match(message.url, /duchi\.vercel\.app/);
  } finally {
    if (previousWeb === undefined) delete process.env.PUBLIC_WEB_URL;
    else process.env.PUBLIC_WEB_URL = previousWeb;
  }
});

test("Gmail subject and template are clean and branded", () => {
  const previousWeb = process.env.PUBLIC_WEB_URL;
  process.env.PUBLIC_WEB_URL = "https://duchi.vercel.app";
  try {
    const payload = {
      type: "slot-open",
      title: "🔥 Slot vừa mở!",
      url: "/friends?slot=1&username=celeb",
      celeb: {
        username: "celeb",
        availableSlots: 10000,
        friendCount: 20000,
        maxFriends: 30000,
      },
    };
    const message = buildSlotMessage(payload);
    const subject = buildEmailSubject(payload, message);
    const text = buildEmailText(payload, message);
    const html = buildEmailHtml(payload, message);

    assert.equal(subject, "Duchi Locket | @celeb vừa mở slot");
    assert.doesNotMatch(subject, /🔥|�/u);
    assert.match(text, /Bạn nhận email này vì đã bật thông báo Gmail/);
    assert.match(html, /DUCHI LOCKET/);
    assert.match(html, /<meta charset="UTF-8">/);
    assert.doesNotMatch(html, /🔥|👥|�/u);
  } finally {
    if (previousWeb === undefined) delete process.env.PUBLIC_WEB_URL;
    else process.env.PUBLIC_WEB_URL = previousWeb;
  }
});

test("Gmail test mail has official confirmation subject", () => {
  const payload = {
    type: "slot-test",
    title: "🔔 Huy Locket Canh Slot",
    body: "Kênh thông báo đã kết nối thành công.",
    url: "/friends?slot=1",
  };
  const message = buildSlotMessage(payload);
  assert.equal(
    buildEmailSubject(payload, message),
    "Duchi Locket | Xác nhận kết nối Canh Slot",
  );
});

test("Gmail reports Auto failure even when the saved session failed before sending", () => {
  const payload = {
    type: "slot-open",
    title: "⚠️ Có slot nhưng tự kết bạn chưa thành công",
    body: "@celeb còn 1 slot. Phiên nền chưa sẵn sàng.",
    url: "/friends?slot=1&username=celeb",
    celeb: {
      username: "celeb",
      availableSlots: 1,
      friendCount: 999,
      maxFriends: 1000,
    },
    autoRequest: {
      enabled: true,
      attempted: false,
      success: false,
      code: "SLOT_SESSION_ERROR",
    },
  };
  const message = buildSlotMessage(payload);

  assert.equal(
    buildEmailSubject(payload, message),
    "Duchi Locket | @celeb request Celeb chưa thành công",
  );
  assert.match(buildEmailHtml(payload, message), /tự kết bạn chưa thành công/i);
});

test("Gmail distinguishes a newly verified request from an existing relationship", () => {
  const basePayload = {
    type: "slot-open",
    title: "Có slot",
    body: "Kết quả xác minh Locket.",
    url: "/friends?slot=1&username=celeb",
    celeb: {
      username: "celeb",
      availableSlots: 1,
      friendCount: 999,
      maxFriends: 1000,
    },
  };

  const sentPayload = {
    ...basePayload,
    autoRequest: { enabled: true, success: true, sentNow: true },
  };
  const existingPayload = {
    ...basePayload,
    autoRequest: {
      enabled: true,
      success: true,
      sentNow: false,
      alreadyPersisted: true,
    },
  };

  assert.equal(
    buildEmailSubject(sentPayload, buildSlotMessage(sentPayload)),
    "Duchi Locket | @celeb đã gửi và xác nhận request Celeb",
  );
  assert.equal(
    buildEmailSubject(existingPayload, buildSlotMessage(existingPayload)),
    "Duchi Locket | @celeb request Celeb đã tồn tại",
  );
});
