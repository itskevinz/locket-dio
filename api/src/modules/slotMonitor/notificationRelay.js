const crypto = require("crypto");
const { getEncryptionKey } = require("./crypto");

const DEFAULT_RELAY_URL =
  "https://huy-locket-api.vercel.app/slot-notification-relay";
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function getRelayUrl() {
  return clean(process.env.SLOT_NOTIFICATION_RELAY_URL, 1000) || DEFAULT_RELAY_URL;
}

function getRelayKey() {
  const key = getEncryptionKey();
  if (!key) {
    const error = new Error("Slot notification relay encryption key unavailable");
    error.code = "SLOT_RELAY_KEY_UNAVAILABLE";
    throw error;
  }
  return key;
}

function normalizeEnvelope(raw = {}) {
  return {
    operation: raw.operation === "status" ? "status" : "send",
    timestamp: Number(raw.timestamp) || 0,
    userUid: clean(raw.userUid, 220),
    eventId: clean(raw.eventId, 300),
    payload:
      raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
        ? raw.payload
        : {},
  };
}

function canonicalEnvelope(raw) {
  return JSON.stringify(normalizeEnvelope(raw));
}

function signEnvelope(raw) {
  return crypto
    .createHmac("sha256", getRelayKey())
    .update(canonicalEnvelope(raw))
    .digest("hex");
}

function safeEqualHex(left, right) {
  const a = Buffer.from(clean(left, 128), "utf8");
  const b = Buffer.from(clean(right, 128), "utf8");
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyRelayEnvelope(raw, signature, now = Date.now()) {
  const envelope = normalizeEnvelope(raw);
  if (!envelope.timestamp || Math.abs(now - envelope.timestamp) > MAX_CLOCK_SKEW_MS) {
    const error = new Error("Slot notification relay request expired");
    error.code = "SLOT_RELAY_EXPIRED";
    error.status = 401;
    throw error;
  }

  const expected = signEnvelope(envelope);
  if (!safeEqualHex(signature, expected)) {
    const error = new Error("Slot notification relay signature invalid");
    error.code = "SLOT_RELAY_UNAUTHORIZED";
    error.status = 401;
    throw error;
  }

  if (envelope.operation === "send" && !envelope.userUid) {
    const error = new Error("Slot notification relay user missing");
    error.code = "SLOT_RELAY_USER_REQUIRED";
    error.status = 400;
    throw error;
  }

  return envelope;
}

async function postRelay(envelope) {
  const normalized = normalizeEnvelope(envelope);
  const response = await fetch(getRelayUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Huy-Locket-Slot-Worker/1.0",
      "X-Slot-Relay-Signature": signEnvelope(normalized),
    },
    body: JSON.stringify(normalized),
    signal: AbortSignal.timeout(15000),
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok || data?.success !== true) {
    const error = new Error(
      data?.message || `Slot notification relay failed with HTTP ${response.status}`,
    );
    error.code = data?.code || "SLOT_NOTIFICATION_RELAY_FAILED";
    error.status = response.status;
    throw error;
  }

  return data.data || {};
}

async function relayConfiguredNotifications(userUid, payload, { eventId = "" } = {}) {
  return postRelay({
    operation: "send",
    timestamp: Date.now(),
    userUid,
    eventId,
    payload,
  });
}

async function checkNotificationRelay() {
  return postRelay({
    operation: "status",
    timestamp: Date.now(),
  });
}

function isRenderRuntime() {
  return Boolean(
    process.env.RENDER ||
      process.env.RENDER_SERVICE_ID ||
      process.env.RENDER_SERVICE_NAME,
  );
}

module.exports = {
  getRelayUrl,
  isRenderRuntime,
  relayConfiguredNotifications,
  checkNotificationRelay,
  verifyRelayEnvelope,
};
