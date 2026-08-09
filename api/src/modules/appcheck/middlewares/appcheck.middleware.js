const {
  logError,
  logInfo,
  logTable,
  logSuccess,
} = require("../../../utils/logEventUtils");
const { sendAppCheckFailedWebhook } = require("../webhook");
const { redisStore } = require("../redis");
const { appCheckServices } = require("../services");

const appCheckConfig = require("../config");

const COLLAB_KEY = appCheckConfig.collabKey;

// ======================
// VERIFY COLLAB TOKEN
// ======================

const verifyCollabToken = (req, res, next) => {
  try {
    const key = req.get("x-collab-key");

    if (!key) {
      return res.status(403).json({
        success: false,
        message: "Malformed request",
      });
    }

    if (key !== COLLAB_KEY) {
      logError("verifyCollabToken", "❌ Collab key không hợp lệ");

      return res.status(403).json({
        success: false,
        message: "Invalid collab key",
      });
    }

    req.collabKey = key;

    logInfo("verifyCollabToken", `✅ Collab key OK (${key})`);
    logTable("verifyCollabToken", { collabKey: key }, "COLLAB TOKEN DATA");
    next();
  } catch (err) {
    logError("verifyCollabToken", err.message);
    return res.status(403).json({
      success: false,
      message: "Malformed token",
    });
  }
};

async function reportAppCheckFailure(error) {
  try {
    const acquired = await redisStore.markWebhookSent();
    if (acquired) {
      await sendAppCheckFailedWebhook({
        message: error?.message || "App Check unavailable",
      });
    }
  } catch {
    // Diagnostics must never turn an App Check outage into a request outage.
  }
}

// Strict mode is kept for future routes that truly cannot operate without an
// App Check token.
const initializeRequiredAppCheck = async (req, res, next) => {
  try {
    logInfo("initializeRequiredAppCheck", "📩 Initializing required AppCheck");
    const token = await appCheckServices.getOrCreateAppCheckToken();

    if (!token) {
      return res.status(503).json({
        success: false,
        code: "APPCHECK_UNAVAILABLE",
        message: "App Check tạm thời chưa sẵn sàng.",
      });
    }

    logSuccess("initializeRequiredAppCheck", "✅ AppCheck initialized");
    req.appcheck = { token, available: true };
    next();
  } catch (error) {
    logError("initializeRequiredAppCheck", "❌ AppCheck error", error.message);
    await reportAppCheckFailure(error);
    return res.status(503).json({
      success: false,
      code: error?.code || "APPCHECK_UNAVAILABLE",
      message: "App Check tạm thời chưa sẵn sàng.",
    });
  }
};

// Friend/follow endpoints have historically changed whether App Check is
// enforced by Locket. Resolve a token when possible, but never fail locally
// before the real upstream request is attempted. This also keeps Celeb auto-
// request and the manual "Kết bạn" button on the exact same App Check policy.
const initializeOptionalAppCheck = async (req, _res, next) => {
  try {
    const token = await appCheckServices.getOrCreateAppCheckToken();
    req.appcheck = {
      token: token || null,
      available: Boolean(token),
    };

    if (token) {
      logInfo("initializeOptionalAppCheck", "✅ AppCheck token attached");
    } else {
      logInfo(
        "initializeOptionalAppCheck",
        "ℹ️ AppCheck unavailable; attempting Locket request without header",
      );
    }
  } catch (error) {
    req.appcheck = {
      token: null,
      available: false,
      errorCode: error?.code || "APPCHECK_UNAVAILABLE",
    };
    logError(
      "initializeOptionalAppCheck",
      "⚠️ AppCheck generation failed; falling back to upstream",
      error?.message || "unknown",
    );
    await reportAppCheckFailure(error);
  }

  next();
};

// Backward-compatible export used by locketRoutes.js. It is intentionally
// best-effort so missing DeviceCheck data can no longer produce the local 400
// seen on sendFriendRequestV2 before Locket was contacted.
const initializeAppCheck = initializeOptionalAppCheck;

module.exports = {
  verifyCollabToken,
  initializeAppCheck,
  initializeOptionalAppCheck,
  initializeRequiredAppCheck,
};
