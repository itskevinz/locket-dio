const MAX_AUTO_REQUEST_ATTEMPTS = 1;

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);
const RETRYABLE_ERROR_CODES = new Set([
  "UPSTREAM_ERROR",
  "RATE_LIMITED",
  "APPCHECK_RATE_LIMITED",
  "APPCHECK_UPSTREAM_ERROR",
  "NETWORK_ERROR",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

function toStatus(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function pickMessage(input, fallbackMessage) {
  const candidates = [
    input?.message,
    input?.response?.data?.error?.message,
    input?.response?.data?.message,
    input?.response?.data?.result?.message,
  ];
  const message = candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find(Boolean);
  return message || fallbackMessage;
}

function isRetryableAutoRequestFailure({ status, code }) {
  if (status === 401 || status === 403 || status === 404 || status === 409) {
    return false;
  }
  if (status && status >= 400 && status < 500 && !RETRYABLE_STATUS_CODES.has(status)) {
    return false;
  }
  if (RETRYABLE_STATUS_CODES.has(status)) return true;
  if (status && status >= 500) return true;
  return RETRYABLE_ERROR_CODES.has(String(code || "").toUpperCase());
}

function normalizeAutoRequestFailure(
  input,
  {
    defaultCode = "AUTO_CELEB_REQUEST_FAILED",
    defaultMessage = "Không thể gửi yêu cầu Celeb thật.",
  } = {},
) {
  const status = toStatus(input?.status || input?.response?.status);
  const code = String(input?.code || input?.response?.data?.error?.status || defaultCode);
  const message = pickMessage(input, defaultMessage);
  const upperCode = code.toUpperCase();
  const source = upperCode.startsWith("APPCHECK_")
    ? "appcheck"
    : input?.success === false
      ? "locket"
      : "runtime";
  const retryable = isRetryableAutoRequestFailure({ status, code: upperCode });

  return {
    status,
    code: upperCode,
    message,
    source,
    retryable,
  };
}

function getAutoRequestRetryDelayMs(attempt, status = null) {
  const attemptNumber = Math.max(1, Number(attempt) || 1);
  if (Number(status) === 429) {
    return attemptNumber <= 1 ? 1500 : 3000;
  }
  const base = attemptNumber <= 1 ? 300 : 900;
  return base + Math.floor(Math.random() * 151);
}

module.exports = {
  MAX_AUTO_REQUEST_ATTEMPTS,
  getAutoRequestRetryDelayMs,
  isRetryableAutoRequestFailure,
  normalizeAutoRequestFailure,
};
