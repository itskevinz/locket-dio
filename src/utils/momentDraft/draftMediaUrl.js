const API_PROXY_PREFIX = "/dio-api";

function isAbsoluteHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * mediaUrls.proxyUrl is returned as /dio-api/api/..., while instanceMain
 * already has /dio-api as its baseURL. Strip exactly one proxy prefix so Axios
 * never requests /dio-api/dio-api/... . Absolute signed URLs bypass baseURL.
 */
export function toDraftMediaRequest(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  const raw = value.trim();
  if (isAbsoluteHttpUrl(raw)) {
    return {
      url: raw,
      baseURL: "",
      skipAuthRefresh: true,
    };
  }

  if (raw === API_PROXY_PREFIX) {
    return {
      url: "/",
      skipAuthRefresh: true,
    };
  }

  if (raw.startsWith(`${API_PROXY_PREFIX}/`)) {
    return {
      url: raw.slice(API_PROXY_PREFIX.length),
      skipAuthRefresh: true,
    };
  }

  return {
    url: raw.startsWith("/") ? raw : `/${raw}`,
    skipAuthRefresh: true,
  };
}

export function getDraftMediaRequests(entry) {
  const seen = new Set();
  const requests = [];

  for (const value of [entry?.proxyUrl, entry?.url]) {
    const request = toDraftMediaRequest(value);
    if (!request) continue;
    const key = `${request.baseURL ?? "default"}:${request.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requests.push(request);
  }

  return requests;
}
