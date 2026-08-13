const MAX_AUTO_REQUEST_ATTEMPTS = 3;
const DEFAULT_RETRY_COOLDOWN_MS = 5_000;

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
const UNSAFE_TO_RETRY_CODES = new Set([
  "REQUEST_NOT_CONFIRMED",
  "DIO_REQUEST_NOT_CONFIRMED",
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
  if (UNSAFE_TO_RETRY_CODES.has(String(code || "").toUpperCase())) {
    // Upstream may have accepted the mutation and only the verification read
    // lagged. Retrying could create duplicate requests, so leave it for a later
    // explicit/background state check instead of immediately sending again.
    return false;
  }
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

function autoRequestAlreadySent(watch) {
  return String(
    watch?.last_auto_request_status || watch?.lastAutoRequestStatus || "",
  ).toUpperCase() === "SENT";
}

function autoRequestLastAttemptMs(watch) {
  const value = watch?.last_auto_request_at || watch?.lastAutoRequestAt;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasEnabledAutoRequest(watches = []) {
  return watches.some((watch) =>
    Boolean(watch?.auto_request_enabled ?? watch?.autoRequestEnabled),
  );
}

function shouldAttemptAutoRequest(
  watch,
  availableSlots,
  {
    isNewSlotEvent = false,
    now = Date.now(),
    retryCooldownMs = DEFAULT_RETRY_COOLDOWN_MS,
  } = {},
) {
  const enabled = Boolean(
    watch?.auto_request_enabled ?? watch?.autoRequestEnabled,
  );
  if (!enabled || Number(availableSlots) <= 0) return false;

  // SENT only protects one open-slot episode. A later full -> open transition
  // or a capacity increase is a new opportunity and must send again.
  if (isNewSlotEvent) return true;
  if (autoRequestAlreadySent(watch)) return false;

  const lastStatus = String(
    watch?.last_auto_request_status || watch?.lastAutoRequestStatus || "",
  ).toUpperCase();
  const lastAttemptAt = autoRequestLastAttemptMs(watch);
  if (
    lastStatus === "FAILED" &&
    lastAttemptAt > 0 &&
    Number(now) - lastAttemptAt < retryCooldownMs
  ) {
    return false;
  }

  return true;
}

module.exports = {
  DEFAULT_RETRY_COOLDOWN_MS,
  MAX_AUTO_REQUEST_ATTEMPTS,
  autoRequestAlreadySent,
  getAutoRequestRetryDelayMs,
  hasEnabledAutoRequest,
  isRetryableAutoRequestFailure,
  normalizeAutoRequestFailure,
  shouldAttemptAutoRequest,
};
