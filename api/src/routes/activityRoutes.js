const express = require("express");
const rateLimit = require("express-rate-limit");
const { neon } = require("@neondatabase/serverless");
const { getLocketAuthVerifier } = require("../services/locketAdminVerifier");
const { getUserInfoV2 } = require("../services/AuthSecurity/GetInfoUser");
const {
  getLoginRequestContext,
  getRequestContext,
  extractBestPublicIp,
} = require("../services/userActivityContext");
const {
  endSession,
  hasActivityDatabase,
  heartbeatSession,
  normalizeIdentity,
  upsertSession,
} = require("../services/userActivityStore");
const { getAccountLock } = require("../services/accountLockStore");

const router = express.Router();
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const broadcastDatabaseUrl = String(
  process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "",
).trim();
const broadcastSql = broadcastDatabaseUrl ? neon(broadcastDatabaseUrl) : null;

async function readGlobalBroadcastWithoutSchemaInit() {
  if (!broadcastSql) {
    return { active: false, message: "", targetUser: "ALL", list: [] };
  }

  try {
    const rows = await broadcastSql`
      SELECT id, message, level, active, target_user, updated_at
      FROM global_broadcasts
      WHERE active = TRUE
      ORDER BY updated_at DESC
      LIMIT 20
    `;
    const list = rows.map((row) => ({
      id: row.id,
      active: row.active,
      message: row.message,
      level: row.level,
      targetUser: row.target_user || "ALL",
      updatedAt: row.updated_at,
    }));
    return list[0]
      ? { ...list[0], list }
      : { active: false, message: "", targetUser: "ALL", list: [] };
  } catch (error) {
    console.warn("[activity] broadcast read skipped:", error?.code || error?.message || "unknown");
    return { active: false, message: "", targetUser: "ALL", list: [] };
  }
}

const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // Increased slightly to accommodate dashboard auto-refresh
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, code: "RATE_LIMITED", error: "Too many activity requests" },
  keyGenerator: (req) => extractBestPublicIp(req) || req.ip,
});

async function requireVerifiedLocketUser(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
  try {
    req.verifiedLocketUser = await getLocketAuthVerifier().verifyIdToken(
      authorization.slice(7),
      false,
    );
    return next();
  } catch (error) {
    console.warn("User activity token verification failed:", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

function requireDatabase(_req, res, next) {
  if (!hasActivityDatabase()) {
    return res.status(503).json({
      success: false,
      code: "DATABASE_NOT_CONFIGURED",
      error: "User activity database is not configured",
    });
  }
  return next();
}

function getSessionId(req, res) {
  const sessionId = String(req.body?.sessionId || "").trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    res.status(400).json({ success: false, code: "INVALID_SESSION_ID", error: "Invalid session identifier" });
    return null;
  }
  return sessionId;
}

async function accessDeniedPayload(req, error) {
  const payload = {
    success: false,
    code: error.code,
    error: error.code === "ACCOUNT_LOCKED"
      ? "Tài khoản Locket Web của bạn đã bị khóa bởi Quản Trị Viên."
      : error.message,
  };
  if (error.code !== "ACCOUNT_LOCKED") return payload;

  const uid = req.verifiedLocketUser?.uid || req.verifiedLocketUser?.user_id;
  if (!uid) return payload;
  try {
    const lock = await getAccountLock(uid);
    if (lock) {
      payload.reason = lock.reason || null;
      payload.lockedAt = lock.locked_at || null;
    }
  } catch (lockError) {
    console.warn("[activity] unable to read account lock reason:", lockError?.message || lockError);
  }
  return payload;
}

router.get("/broadcast", activityLimiter, async (req, res) => {
  try {
    const data = await readGlobalBroadcastWithoutSchemaInit();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(200).json({ success: true, data: { active: false, message: "", targetUser: "ALL", list: [] } });
  }
});

router.use(activityLimiter, requireVerifiedLocketUser, requireDatabase);

router.post("/session", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) return;
  const eventType = req.body?.eventType === "login" ? "login" : "resume";
  try {
    const idToken = req.headers.authorization.slice(7);
    let verifiedProfile = null;
    try {
      verifiedProfile = await getUserInfoV2(
        idToken,
        req.verifiedLocketUser.uid || req.verifiedLocketUser.user_id,
      );
    } catch (profileErr) {
      console.warn("[activity] profile fetch fallback:", profileErr.message || profileErr);
    }
    const identity = normalizeIdentity(req.verifiedLocketUser, verifiedProfile);
    const context = await getLoginRequestContext(req);
    const result = await upsertSession({
      identity,
      sessionId,
      eventType,
      loginMethod: req.body?.loginMethod,
      context,
      build: req.body?.build,
      gps: req.body?.gps,
    });
    return res.status(200).json({ success: true, accountStatus: result.accountStatus });
  } catch (error) {
    if (error.code === "ACCOUNT_LOCKED" || error.code === "SESSION_REVOKED") {
      return res.status(403).json(await accessDeniedPayload(req, error));
    }
    console.error("User activity session write failed:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "ACTIVITY_WRITE_FAILED", error: "Unable to record user activity" });
  }
});

router.post("/heartbeat", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) return;
  try {
    const identity = normalizeIdentity(req.verifiedLocketUser);
    await heartbeatSession({
      uid: identity.uid,
      sessionId,
      webSource: getRequestContext(req).webSource,
      gps: req.body?.gps,
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    if (error.code === "ACCOUNT_LOCKED" || error.code === "SESSION_REVOKED") {
      return res.status(403).json(await accessDeniedPayload(req, error));
    }
    console.error("User activity heartbeat failed:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "HEARTBEAT_FAILED", error: "Unable to update activity" });
  }
});

router.post("/logout", async (req, res) => {
  const sessionId = getSessionId(req, res);
  if (!sessionId) return;
  try {
    const identity = normalizeIdentity(req.verifiedLocketUser);
    await endSession({ uid: identity.uid, sessionId });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("User activity logout failed:", error?.code || error?.name || "unknown");
    return res.status(500).json({ success: false, code: "LOGOUT_WRITE_FAILED", error: "Unable to close activity session" });
  }
});

router.post("/action", async (req, res) => {
  try {
    const { actionType, actionTitle, details } = req.body || {};
    if (!actionType || !actionTitle) {
      return res.status(400).json({ success: false, error: "Missing actionType or actionTitle" });
    }
    const identity = normalizeIdentity(req.verifiedLocketUser);
    await require("../services/userActivityStore").recordWebUserAction({
      user: { ...identity, uid: identity.uid },
      req,
      actionType,
      actionTitle,
      details: typeof details === "object" && details ? JSON.stringify(details) : String(details || "")
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.warn("User action tracking failed:", err?.message || err);
    return res.status(200).json({ success: false });
  }
});

module.exports = router;