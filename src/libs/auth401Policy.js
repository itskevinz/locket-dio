export const UPSTREAM_AUTH_FAILURE_CODE = "UPSTREAM_AUTH_FAILED";

export function getAuthErrorCode(responseData) {
  const rawCode =
    responseData?.code ??
    responseData?.error?.code ??
    (typeof responseData?.error === "string" ? responseData.error : "");

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
  if (Number(status) !== 401) return false;
  return Boolean(skipAuthRefresh) || isUpstreamAuthFailure(responseData);
}
