const express = require("express");
const {
  getAdminLocketEmails,
  getAdminLocketUids,
  getLocketAuthVerifier,
} = require("../services/locketAdminVerifier");
const {
  getUserRole,
  hasActivityDatabase,
} = require("../services/userActivityStore");

const router = express.Router();
const CACHE_TTL_MS = 30_000;
const STALE_CACHE_TTL_MS = 15 * 60_000;
const RELAY_TIMEOUT_MS = 25_000;
const RELAY_RETRY_TIMEOUT_MS = 15_000;
let quotaCache = null;

function clean(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function isTimeoutError(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  return name.includes("timeout")
    || name.includes("abort")
    || message.includes("timeout")
    || message.includes("aborted");
}

async function requireAdminIdentity(req, res, next) {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }

  try {
    const decodedToken = await getLocketAuthVerifier().verifyIdToken(authorization.slice(7), false);
    const uid = clean(decodedToken.uid, 160);
    const email = clean(decodedToken.email, 320).toLowerCase();
    const allowedUids = getAdminLocketUids();
    const allowedEmails = getAdminLocketEmails();

    let role = "user";
    if (hasActivityDatabase()) {
      role = await getUserRole(uid, email);
    } else if (allowedUids.has(uid) || allowedEmails.has(email)) {
      role = "super_admin";
    }

    if (role === "user" && !allowedUids.has(uid) && !allowedEmails.has(email)) {
      return res.status(403).json({
        success: false,
        code: "ADMIN_PERMISSION_REQUIRED",
        error: "Admin permission required",
      });
    }

    req.adminUid = uid;
    req.adminEmail = email;
    req.adminRole = role === "user" ? "super_admin" : role;
    return next();
  } catch (error) {
    console.warn("Admin mail quota auth failed:", error?.code || error?.name || "unknown");
    return res.status(401).json({ success: false, code: "UNAUTHORIZED", error: "Unauthorized" });
  }
}

async function postQuotaRequest(endpoint, secret, timeoutMs) {
  return fetch(endpoint, {
    method: "POST",
    redirect: "follow",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
      "User-Agent": "Duchi-Locket-Mail-Quota/1.1",
    },
    body: JSON.stringify({ secret, action: "quota" }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function fetchQuotaResponse(endpoint, secret) {
  try {
    return await postQuotaRequest(endpoint, secret, RELAY_TIMEOUT_MS);
  } catch (error) {
    if (!isTimeoutError(error)) throw error;
    console.warn("Gmail quota relay timed out once; retrying with a fresh request.");
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      return await postQuotaRequest(endpoint, secret, RELAY_RETRY_TIMEOUT_MS);
    } catch (retryError) {
      if (!isTimeoutError(retryError)) throw retryError;
      const timeoutError = new Error("Google Apps Script phản hồi quá chậm. Hệ thống đã thử lại nhưng vẫn hết thời gian chờ.");
      timeoutError.code = "MAIL_QUOTA_RELAY_TIMEOUT";
      timeoutError.status = 504;
      throw timeoutError;
    }
  }
}

async function fetchMailQuota() {
  const endpoint = clean(process.env.GMAIL_APPS_SCRIPT_URL, 1000);
  const secret = clean(process.env.GMAIL_APPS_SCRIPT_SECRET, 500);

  if (!endpoint || !secret) {
    const error = new Error("Gmail chưa được cấu hình trên hệ thống.");
    error.code = "EMAIL_NOT_CONFIGURED";
    error.status = 503;
    throw error;
  }
  if (!/^https:\/\//i.test(endpoint)) {
    const error = new Error("URL Google Apps Script không hợp lệ.");
    error.code = "EMAIL_RELAY_URL_INVALID";
    error.status = 500;
    throw error;
  }

  const response = await fetchQuotaResponse(endpoint, secret);

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!response.ok || data?.ok !== true) {
    const message = clean(data?.message, 500);
    const isOldRelay = data?.code === "INVALID_EMAIL"
      || (data?.code === "SEND_FAILED" && /invalid email|recipient|to\b/i.test(message));
    const error = new Error(
      isOldRelay
        ? "Google Apps Script gửi mail chưa hỗ trợ đọc quota. Cần cập nhật Code.gs lên bản mới."
        : (message || "Không đọc được quota Gmail từ Google Apps Script."),
    );
    error.code = isOldRelay ? "MAIL_QUOTA_RELAY_UPDATE_REQUIRED" : (data?.code || "MAIL_QUOTA_FAILED");
    error.status = response.status >= 400 ? response.status : 502;
    throw error;
  }

  const remaining = Number(data.remaining);
  const dailyLimit = Number(data.dailyLimit);
  if (!Number.isFinite(remaining) || remaining < 0) {
    const error = new Error("Google Apps Script không trả về quota hợp lệ.");
    error.code = "MAIL_QUOTA_INVALID_RESPONSE";
    error.status = 502;
    throw error;
  }

  return {
    remaining: Math.floor(remaining),
    dailyLimit: Number.isFinite(dailyLimit) && dailyLimit > 0 ? Math.floor(dailyLimit) : null,
    senderEmail: clean(data.senderEmail, 320).toLowerCase() || null,
    checkedAt: data.checkedAt || new Date().toISOString(),
    provider: "gmail-apps-script",
    quotaScope: "sender-account",
  };
}

router.use(requireAdminIdentity);

router.get("/mail-quota", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  try {
    const now = Date.now();
    if (quotaCache && now - quotaCache.cachedAt < CACHE_TTL_MS) {
      return res.status(200).json({ success: true, ...quotaCache.data, cached: true });
    }

    const data = await fetchMailQuota();
    quotaCache = { cachedAt: now, data };
    return res.status(200).json({ success: true, ...data, cached: false });
  } catch (error) {
    console.error("Failed to read Gmail quota:", error?.code || error?.message || "unknown");
    const now = Date.now();
    if (quotaCache && now - quotaCache.cachedAt < STALE_CACHE_TTL_MS) {
      return res.status(200).json({
        success: true,
        ...quotaCache.data,
        cached: true,
        stale: true,
        warning: error?.message || "Không thể cập nhật quota mới nhất.",
      });
    }
    return res.status(Number(error?.status) || 502).json({
      success: false,
      code: error?.code || "MAIL_QUOTA_FAILED",
      error: error?.message || "Không đọc được quota Gmail.",
    });
  }
});

module.exports = router;
