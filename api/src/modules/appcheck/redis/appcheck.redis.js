const { redisAppCheck } = require("./redis.clients");
const slotStore = require("../../slotMonitor/store");
const {
  encryptSecret,
  decryptSecret,
  getEncryptionKey,
} = require("../../slotMonitor/crypto");

const DEVICE_KEY = "appcheck:device";
const TOKEN_KEY = "appcheck:token";
const PERSISTED_DEVICE_KEY = "appcheck_device_token_v1";
const PERSISTED_TOKEN_KEY = "appcheck_token_v1";

const ERROR_LOCK_KEY = "appcheck:error:webhook";

const appCheckConfig = require("../config");

const { deviceTokenTTL, appCheckTokenTTL } = appCheckConfig.redisCache;

function canUsePersistentFallback() {
  return slotStore.isConfigured() && Boolean(getEncryptionKey());
}

async function persistDeviceToken(serializedToken) {
  if (!canUsePersistentFallback()) return;

  const payload = JSON.stringify({
    token: serializedToken,
    expiresAt: Date.now() + deviceTokenTTL * 1000,
  });
  await slotStore.setConfigValue(PERSISTED_DEVICE_KEY, encryptSecret(payload));
}

async function readPersistedDeviceToken() {
  if (!canUsePersistentFallback()) return null;

  const encrypted = await slotStore.getConfigValue(PERSISTED_DEVICE_KEY);
  if (!encrypted) return null;

  try {
    const parsed = JSON.parse(decryptSecret(encrypted));
    if (!parsed?.token || Date.now() >= Number(parsed.expiresAt || 0)) {
      await slotStore.setConfigValue(PERSISTED_DEVICE_KEY, "").catch(() => {});
      return null;
    }
    return String(parsed.token);
  } catch (error) {
    console.warn("[Redis AppCheck] persisted device token unreadable", {
      code: error?.code || null,
    });
    return null;
  }
}

function resolveAppCheckTokenTTL(ttl) {
  const parsed = typeof ttl === "string"
    ? Number.parseFloat(ttl.replace(/s$/i, ""))
    : Number(ttl);
  const safeParsed = Number.isFinite(parsed) && parsed > 60
    ? Math.floor(parsed - 60)
    : appCheckTokenTTL;

  return Math.max(1, Math.min(appCheckTokenTTL, safeParsed));
}

async function persistAppCheckToken(token, ttlSeconds) {
  if (!canUsePersistentFallback()) return;

  const payload = JSON.stringify({
    token: String(token),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  await slotStore.setConfigValue(PERSISTED_TOKEN_KEY, encryptSecret(payload));
}

async function readPersistedAppCheckToken() {
  if (!canUsePersistentFallback()) return null;

  const encrypted = await slotStore.getConfigValue(PERSISTED_TOKEN_KEY);
  if (!encrypted) return null;

  try {
    const parsed = JSON.parse(decryptSecret(encrypted));
    const remainingSeconds = Math.floor(
      (Number(parsed?.expiresAt || 0) - Date.now()) / 1000,
    );
    if (!parsed?.token || remainingSeconds <= 0) {
      await slotStore.setConfigValue(PERSISTED_TOKEN_KEY, "").catch(() => {});
      return null;
    }

    return {
      token: String(parsed.token),
      ttlSeconds: Math.min(appCheckTokenTTL, remainingSeconds),
    };
  } catch (error) {
    console.warn("[Redis AppCheck] persisted App Check token unreadable", {
      code: error?.code || null,
    });
    return null;
  }
}

// ======================
// DEVICE TOKEN
// ======================

exports.saveDeviceToken = async (deviceToken) => {
  const serializedToken = JSON.stringify(deviceToken);

  await redisAppCheck.set(DEVICE_KEY, serializedToken, {
    EX: deviceTokenTTL,
  });

  await persistDeviceToken(serializedToken).catch((error) => {
    console.warn("[Redis AppCheck] persistent device token save failed", {
      code: error?.code || null,
    });
  });

  // ✅ reset error lock khi device token mới đăng ký
  await redisAppCheck.del(ERROR_LOCK_KEY);
};

exports.getDeviceToken = async () => {
  let serializedToken = await redisAppCheck.get(DEVICE_KEY);

  if (!serializedToken) {
    serializedToken = await readPersistedDeviceToken();
    if (serializedToken) {
      await redisAppCheck.set(DEVICE_KEY, serializedToken, {
        EX: deviceTokenTTL,
      }).catch(() => {});
    }
  }

  if (!serializedToken) return null;

  try {
    return JSON.parse(serializedToken);
  } catch {
    return null;
  }
};

exports.deleteDeviceToken = async () => {
  await redisAppCheck.del(DEVICE_KEY);
  if (slotStore.isConfigured()) {
    await slotStore.setConfigValue(PERSISTED_DEVICE_KEY, "").catch(() => {});
  }
};

// ======================
// APP CHECK TOKEN
// ======================

exports.saveAppCheckToken = async (token, ttl) => {
  const ttlSeconds = resolveAppCheckTokenTTL(ttl);
  await redisAppCheck.set(TOKEN_KEY, token, {
    EX: ttlSeconds,
  });

  await persistAppCheckToken(token, ttlSeconds).catch((error) => {
    console.warn("[Redis AppCheck] persistent App Check token save failed", {
      code: error?.code || null,
    });
  });
};

exports.getAppCheckToken = async () => {
  const token = await redisAppCheck.get(TOKEN_KEY);
  if (token) return token;

  const persisted = await readPersistedAppCheckToken().catch((error) => {
    console.warn("[Redis AppCheck] persistent App Check token read failed", {
      code: error?.code || null,
    });
    return null;
  });
  if (!persisted) return null;

  await redisAppCheck.set(TOKEN_KEY, persisted.token, {
    EX: persisted.ttlSeconds,
  }).catch(() => {});
  return persisted.token;
};

// ======================
// ERROR WEBHOOK LOCK
// ======================

exports.markWebhookSent = async () => {
  const result = await redisAppCheck.set(ERROR_LOCK_KEY, "sent", {
    NX: true,
  });

  return result === "OK";
};
