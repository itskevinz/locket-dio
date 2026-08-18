const slotStore = require("../modules/slotMonitor/store");
const {
  encryptSecret,
  getEncryptionKey,
} = require("../modules/slotMonitor/crypto");
const { decodeFirebaseUid } = require("../modules/slotMonitor/core");

function firstValue(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function normalizeAuthPayload(payload = {}) {
  const idToken = firstValue(
    payload.idToken,
    payload.id_token,
    payload.accessToken,
    payload.access_token,
  );
  const refreshToken = firstValue(payload.refreshToken, payload.refresh_token);
  const tokenUid = idToken ? firstValue(decodeFirebaseUid(idToken)) : "";
  const userUid = firstValue(
    payload.localId,
    payload.local_id,
    payload.user_id,
    payload.userId,
    payload.uid,
    tokenUid,
  );

  return {
    idToken,
    refreshToken,
    userUid,
    tokenUid,
  };
}

async function persistLocketBackgroundSession(payload = {}, { source = "auth" } = {}) {
  const { refreshToken, userUid, tokenUid } = normalizeAuthPayload(payload);

  if (!refreshToken || !userUid) {
    return {
      saved: false,
      reason: !refreshToken ? "REFRESH_TOKEN_MISSING" : "USER_UID_MISSING",
    };
  }

  if (tokenUid && tokenUid !== userUid) {
    console.warn("[locket-session] refused mismatched auth session", {
      source,
      userUid,
      tokenUid,
    });
    return { saved: false, reason: "USER_UID_MISMATCH" };
  }

  if (!slotStore.isConfigured()) {
    console.warn("[locket-session] persistence unavailable: database missing", {
      source,
      userUid,
    });
    return { saved: false, reason: "DATABASE_UNAVAILABLE" };
  }

  if (!getEncryptionKey()) {
    console.warn("[locket-session] persistence unavailable: encryption key missing", {
      source,
      userUid,
    });
    return { saved: false, reason: "ENCRYPTION_KEY_UNAVAILABLE" };
  }

  try {
    await slotStore.saveSession(userUid, encryptSecret(refreshToken));
    console.log("[locket-session] encrypted background session saved", {
      source,
      userUid,
    });
    return { saved: true, userUid };
  } catch (error) {
    console.warn("[locket-session] failed to persist background session", {
      source,
      userUid,
      code: error?.code || null,
      message: error?.message || "unknown",
    });
    return {
      saved: false,
      reason: error?.code || "SESSION_PERSIST_FAILED",
    };
  }
}

module.exports = {
  normalizeAuthPayload,
  persistLocketBackgroundSession,
};
