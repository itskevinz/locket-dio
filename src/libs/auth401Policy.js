export const UPSTREAM_AUTH_FAILURE_CODE = "UPSTREAM_AUTH_FAILED";

export const TERMINAL_REFRESH_CODES = Object.freeze([
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_EXPIRED",
  "REFRESH_TOKEN_MISSING",
  "INVALID_REFRESH_TOKEN",
  "TOKEN_EXPIRED",
  "USER_DISABLED",
  "USER_NOT_FOUND",
  "AUTH_REFRESH_TERMINAL",
]);

export function getAuthErrorCode(responseData) {
  const rawCode =
    responseData?.code ??
    responseData?.error?.code ??
    (typeof responseData?.error === "string" ? responseData.error : "") ??
    responseData?.error?.message ??
    responseData?.message;

  return String(rawCode || "").trim().toUpperCase();
}

export function isUpstreamAuthFailure(responseData) {
  return getAuthErrorCode(responseData) === UPSTREAM_AUTH_FAILURE_CODE;
}

export function shouldBypassSessionRefresh({
  status,
  responseData,
  skipAuthRefresh = false,
} = {}) {
  const isUpstream = isUpstreamAuthFailure(responseData);
  const numStatus = Number(status || 0);

  if (isUpstream && numStatus !== 401 && numStatus !== 403) {
    return false;
  }

  return Boolean(skipAuthRefresh) || isUpstreamAuthFailure(responseData);
}

export function isTerminalRefreshErrorCode(code) {
  const normalized = String(code || "").trim().toUpperCase();
  return TERMINAL_REFRESH_CODES.includes(normalized);
}

export function isTerminalRefreshError(error) {
  if (error?.authRefreshTerminal !== undefined) {
    return Boolean(error.authRefreshTerminal);
  }
  if (error?.code === "AUTH_REFRESH_TERMINAL") return true;
  if (error?.code === "AUTH_REFRESH_TEMPORARY") return false;

  const responseData = error?.response?.data;
  const rawCode =
    responseData?.code ||
    responseData?.error?.code ||
    (typeof responseData?.error === "string" ? responseData.error : "") ||
    error?.code;

  if (isTerminalRefreshErrorCode(rawCode)) return true;

  const rawMsg =
    responseData?.error?.message ||
    responseData?.message ||
    error?.message ||
    "";
  if (isTerminalRefreshErrorCode(rawMsg)) return true;

  // Raw status 400/401/403/429/500 without explicit terminal code -> NON-TERMINAL
  return false;
}

export function decideAuth401Action({
  status,
  responseData,
  skipAuthRefresh = false,
  isRetry = false,
} = {}) {
  const numStatus = Number(status || 0);

  if (Boolean(skipAuthRefresh)) {
    return { action: "bypass", reason: "skip-auth-refresh" };
  }

  if (isUpstreamAuthFailure(responseData)) {
    if (numStatus === 401 || numStatus === 403) {
      return { action: "bypass", reason: "upstream-auth-failed" };
    }
  }

  if (numStatus !== 401) {
    return { action: "pass-through" };
  }

  if (isRetry) {
    return { action: "reject-no-logout", reason: "retry-failed" };
  }

  return { action: "refresh-and-retry" };
}

export function decideRefreshErrorAction(refreshError) {
  const isTerminal = isTerminalRefreshError(refreshError);
  return {
    isTerminal,
    action: isTerminal ? "logout-and-reject" : "reject-only",
  };
}
