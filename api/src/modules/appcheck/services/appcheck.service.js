const appCheckConfig = require("../config");
const { instanceAppcheck } = require("../../../libs");
const { logInfo, logError } = require("../../../utils/logEventUtils");
const { redisStore } = require("../redis");

const { deviceId } = appCheckConfig.deviceToken;

function normalizeDeviceCheckToken(value) {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Railway env may contain either the raw base64 DeviceCheck token or the
    // JSON shape previously accepted by /registerDeviceToken.
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return normalizeDeviceCheckToken(JSON.parse(trimmed));
      } catch {
        // If it only happens to begin with "{", treat it as the raw token.
      }
    }

    return {
      deviceToken: trimmed,
      limitedUse: false,
    };
  }

  if (typeof value === "object") {
    const rawToken = String(
      value.deviceToken || value.device_token || value.token || "",
    ).trim();
    if (!rawToken) return null;

    return {
      deviceToken: rawToken,
      limitedUse: Boolean(value.limitedUse ?? value.limited_use ?? false),
    };
  }

  return null;
}

function getConfiguredDeviceCheckToken() {
  return normalizeDeviceCheckToken(process.env.LOCKET_APP_CHECK_DEVICE_TOKEN);
}

// ======================
// REGISTER DEVICE TOKEN
// ======================

const registerDeviceToken = async (deviceToken) => {
  const normalized = normalizeDeviceCheckToken(deviceToken);
  if (!normalized) {
    const error = new Error("Invalid DeviceCheck token");
    error.code = "INVALID_DEVICE_CHECK_TOKEN";
    error.status = 400;
    throw error;
  }

  // Keep the historical storage shape for compatibility with existing data.
  await redisStore.saveDeviceToken({
    device_token: normalized.deviceToken,
    limited_use: normalized.limitedUse,
  });
};

function createAppCheckError(error) {
  const apiError = error?.response?.data?.error;
  const statusValue = Number(error?.response?.status);
  const status = Number.isFinite(statusValue) && statusValue > 0 ? statusValue : null;
  const message = apiError?.message || error?.message || "Generate AppCheck token failed";
  const wrapped = new Error(message);

  if (status === 429) wrapped.code = "APPCHECK_RATE_LIMITED";
  else if (status && status >= 500) wrapped.code = "APPCHECK_UPSTREAM_ERROR";
  else if (status === 401 || status === 403) wrapped.code = "APPCHECK_AUTH_FAILED";
  else wrapped.code = error?.code || "APPCHECK_GENERATION_FAILED";

  if (status) wrapped.status = status;
  return wrapped;
}

// ======================
// GENERATE TOKEN
// ======================

const generateAppCheckToken = async (deviceToken) => {
  try {
    const normalized = normalizeDeviceCheckToken(deviceToken);
    if (!normalized) {
      const error = new Error("DeviceCheck token unavailable");
      error.code = "DEVICE_CHECK_TOKEN_UNAVAILABLE";
      throw error;
    }

    const url = `v1/projects/locket-4252a/apps/${deviceId}:exchangeDeviceCheckToken`;

    // Firebase App Check REST uses camelCase fields. The previous snake_case
    // payload was silently incompatible with the documented REST contract.
    const body = {
      deviceToken: normalized.deviceToken,
      limitedUse: normalized.limitedUse,
    };
    const result = await instanceAppcheck.post(url, body);

    const { token, ttl } = result.data || {};
    if (!token) {
      const error = new Error("Firebase App Check returned no token");
      error.code = "APPCHECK_EMPTY_RESPONSE";
      throw error;
    }

    return {
      token,
      ttl,
    };
  } catch (error) {
    const apiError = error?.response?.data?.error;
    const wrapped = createAppCheckError(error);

    logError(
      "appCheckService",
      "❌ Generate AppCheck token failed",
      apiError || wrapped.message,
    );

    throw wrapped;
  }
};

// ======================
// GET OR CREATE TOKEN
// ======================

const getOrCreateAppCheckToken = async () => {
  // 1. A directly supplied App Check token is the highest-priority emergency
  // compatibility path. It is already an App Check token, so no exchange.
  const configuredToken = String(process.env.LOCKET_APP_CHECK_TOKEN || "").trim();
  if (configuredToken) {
    logInfo("appCheckService", "⚡ Using configured AppCheck token");
    return configuredToken;
  }

  // 2. Reuse a still-valid generated token even if the source DeviceCheck token
  // is temporarily unavailable. Previously this cache was checked too late.
  const cachedToken = await redisStore.getAppCheckToken();
  if (cachedToken) {
    logInfo("appCheckService", "⚡ Using cached AppCheck token");
    return cachedToken;
  }

  // 3. Prefer a token registered by a trusted iOS DeviceCheck source, with an
  // env-provided DeviceCheck token as a deployment-safe fallback.
  const storedDeviceToken = await redisStore.getDeviceToken();
  const deviceToken =
    normalizeDeviceCheckToken(storedDeviceToken) || getConfiguredDeviceCheckToken();

  if (!deviceToken) {
    logInfo(
      "appCheckService",
      "ℹ️ DeviceCheck source unavailable; continuing without AppCheck token",
    );
    return null;
  }

  // 4. Exchange DeviceCheck -> Firebase App Check and cache the short-lived
  // App Check token. Never send a raw DeviceCheck token to Locket as a header.
  const generated = await generateAppCheckToken(deviceToken);
  await redisStore.saveAppCheckToken(generated.token, generated.ttl);

  return generated.token;
};

module.exports = {
  normalizeDeviceCheckToken,
  registerDeviceToken,
  generateAppCheckToken,
  getOrCreateAppCheckToken,
};
