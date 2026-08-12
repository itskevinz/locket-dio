export const UPLOAD_QUEUE_ERROR = Object.freeze({
  OFFLINE: "OFFLINE",
  NETWORK: "NETWORK_ERROR",
  AUTH_TEMPORARY: "AUTH_REFRESH_TEMPORARY",
  IN_PROGRESS: "UPLOAD_IN_PROGRESS",
  RATE_LIMITED: "RATE_LIMITED",
  SERVER: "SERVER_ERROR",
  STORAGE_REJECTED: "STORAGE_REJECTED",
  MEDIA_EXPIRED: "MEDIA_EXPIRED",
  INVALID_RESPONSE: "INVALID_UPLOAD_RESPONSE",
  FAILED: "UPLOAD_FAILED",
});

export const MAX_UPLOAD_AUTO_RETRY = 3;
export const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;

const NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ERR_NETWORK",
  "ETIMEDOUT",
]);

const RETRY_BASE_MS = [2500, 5000, 10000, 18000];

function retryAfterFromError(error) {
  const seconds = Number(error?.retryAfterSeconds);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;

  const raw = error?.response?.headers?.["retry-after"];
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : null;
}

export function classifyUploadFailure(error, { online = true } = {}) {
  const status = Number(error?.response?.status || error?.status || 0);
  const code = String(error?.code || "").toUpperCase();
  const responseCode = String(
    error?.response?.data?.code || error?.response?.data?.error || "",
  ).toUpperCase();
  const responseMessage = String(
    error?.response?.data?.message || error?.message || "",
  ).toUpperCase();

  if (error?.message === "INVALID_UPLOAD_RESPONSE") {
    return {
      code: UPLOAD_QUEUE_ERROR.INVALID_RESPONSE,
      autoRetry: false,
      resumeOnReconnect: false,
    };
  }

  // The API currently wraps Firebase Storage permission failures as HTTP 500.
  // Retrying the same rejected write only makes the camera spin for ~15s and
  // cannot recover without a change in authorization/storage policy.
  if (
    responseMessage.includes("FIREBASE STORAGE") &&
    (responseMessage.includes("FAILED TO UPLOAD") || status >= 400)
  ) {
    return {
      code: UPLOAD_QUEUE_ERROR.STORAGE_REJECTED,
      autoRetry: false,
      resumeOnReconnect: false,
    };
  }

  if (status === 404) {
    return {
      code: UPLOAD_QUEUE_ERROR.MEDIA_EXPIRED,
      autoRetry: false,
      resumeOnReconnect: false,
    };
  }

  if (status === 429) {
    return {
      code: UPLOAD_QUEUE_ERROR.RATE_LIMITED,
      autoRetry: false,
      resumeOnReconnect: false,
      retryAfterMs: retryAfterFromError(error) || RATE_LIMIT_COOLDOWN_MS,
    };
  }

  if (!online) {
    return {
      code: UPLOAD_QUEUE_ERROR.OFFLINE,
      autoRetry: false,
      resumeOnReconnect: true,
    };
  }

  if (code === "AUTH_REFRESH_TEMPORARY") {
    return {
      code: UPLOAD_QUEUE_ERROR.AUTH_TEMPORARY,
      autoRetry: true,
      resumeOnReconnect: true,
    };
  }

  if (
    status === 425 ||
    code === "UPLOAD_IN_PROGRESS" ||
    responseCode === "UPLOAD_IN_PROGRESS"
  ) {
    return {
      code: UPLOAD_QUEUE_ERROR.IN_PROGRESS,
      autoRetry: true,
      resumeOnReconnect: false,
      retryAfterMs: 2500,
    };
  }

  if (!status && (NETWORK_ERROR_CODES.has(code) || !error?.response)) {
    return {
      code: UPLOAD_QUEUE_ERROR.NETWORK,
      autoRetry: true,
      resumeOnReconnect: true,
    };
  }

  if (status === 408 || status >= 500) {
    return {
      code: UPLOAD_QUEUE_ERROR.SERVER,
      autoRetry: true,
      resumeOnReconnect: false,
      retryAfterMs: retryAfterFromError(error),
    };
  }

  return {
    code: UPLOAD_QUEUE_ERROR.FAILED,
    autoRetry: false,
    resumeOnReconnect: false,
  };
}

export function uploadRetryDelayMs(retryCount = 0, policy = {}) {
  if (Number.isFinite(policy?.retryAfterMs) && policy.retryAfterMs > 0) {
    return Math.min(policy.retryAfterMs, 5 * 60 * 1000);
  }

  const index = Math.min(
    Math.max(0, Number(retryCount) || 0),
    RETRY_BASE_MS.length - 1,
  );
  const base = RETRY_BASE_MS[index];
  // Small jitter prevents several queued uploads from retrying simultaneously.
  return base + Math.floor(Math.random() * Math.max(250, base * 0.2));
}

export function shouldResumeAfterReconnect(item, queueSessionId) {
  return Boolean(
    item?.queueSessionId &&
      item.queueSessionId === queueSessionId &&
      (item.errorCode === UPLOAD_QUEUE_ERROR.OFFLINE ||
        item.errorCode === UPLOAD_QUEUE_ERROR.NETWORK ||
        item.errorCode === UPLOAD_QUEUE_ERROR.AUTH_TEMPORARY),
  );
}

export function rateLimitCooldownRemaining(item, now = Date.now()) {
  if (item?.errorCode !== UPLOAD_QUEUE_ERROR.RATE_LIMITED) return 0;
  const lastAttempt = Date.parse(item?.lastTried || item?.createdAt || "");
  const cooldown = Number(item?.retryAfterMs) || RATE_LIMIT_COOLDOWN_MS;
  if (!Number.isFinite(lastAttempt)) return cooldown;
  return Math.max(0, cooldown - (now - lastAttempt));
}
