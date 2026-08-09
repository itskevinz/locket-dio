const axios = require("axios");

const DEFAULT_DIO_API_URL = "https://api.locket-dio.com";
const DEFAULT_DIO_BETA_URL = "https://api-beta.locket-dio.com";
const DEFAULT_DIO_PUBLIC_API_KEY =
  "LKD-LOCKETDIO-AB02F55KYM55DD02MM03YY25-LKD";

const DIO_TIMEOUT_MS = 12000;

function isEnabled() {
  const value = String(process.env.DIO_FRIEND_FALLBACK_ENABLED || "")
    .trim()
    .toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function dioBaseUrl() {
  return String(process.env.DIO_COMPAT_API_URL || DEFAULT_DIO_API_URL).replace(
    /\/$/,
    "",
  );
}

function dioBetaUrl() {
  return String(process.env.DIO_COMPAT_BETA_URL || DEFAULT_DIO_BETA_URL).replace(
    /\/$/,
    "",
  );
}

function commonHeaders(idToken) {
  return {
    Authorization: `Bearer ${idToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "x-api-key":
      process.env.DIO_PUBLIC_API_KEY || DEFAULT_DIO_PUBLIC_API_KEY,
    "x-app-author": "dio",
    "x-app-name": "locketdio",
    "x-app-client": "Beta1.3.6",
    "x-app-api": "v2.2.1",
    "x-app-env": "production",
  };
}

function cookieHeaderFromResponse(headers) {
  const values = headers?.["set-cookie"];
  if (!Array.isArray(values) || values.length === 0) return "";
  return values
    .map((value) => String(value || "").split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function createDioMemberSession(idToken) {
  const response = await axios.get(`${dioBaseUrl()}/api/cn`, {
    headers: commonHeaders(idToken),
    timeout: DIO_TIMEOUT_MS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const error = new Error("Dio compatibility session unavailable");
    error.status = response.status;
    error.code = "DIO_SESSION_UNAVAILABLE";
    throw error;
  }

  const session = response.data?.data?.session || {};
  const memberToken = String(session.member_token || "").trim();
  const memberHeader = String(session.header || "X-LocketDio-Member").trim();

  if (!memberToken || !memberHeader) {
    const error = new Error("Dio compatibility session missing member token");
    error.status = 502;
    error.code = "DIO_MEMBER_TOKEN_MISSING";
    throw error;
  }

  return {
    memberToken,
    memberHeader,
    cookieHeader: cookieHeaderFromResponse(response.headers),
  };
}

function normalizeDioSuccess(data) {
  if (!data || data.success === false) return null;

  // Dio's current client expects the beta endpoint to return the original
  // Locket result nested under data. Preserve that shape for RequestServices.
  if (data?.data?.result) return data.data;
  if (data?.result) return data;

  const value = data?.data ?? data;
  return {
    result: {
      data: value ?? {},
    },
  };
}

async function sendViaDio({ kind, idToken, friendUid }) {
  if (!isEnabled()) return null;
  if (!idToken || !friendUid) return null;

  const session = await createDioMemberSession(idToken);
  const isCelebrity = kind === "celebrity";
  const path = isCelebrity
    ? "/locket/sendCelebrityRequestV2"
    : "/locket/sendFriendRequestV2";
  const body = isCelebrity
    ? { friendUid }
    : { data: { friendUid } };

  const headers = {
    ...commonHeaders(idToken),
    [session.memberHeader]: session.memberToken,
  };
  if (session.cookieHeader) headers.Cookie = session.cookieHeader;

  const response = await axios.post(`${dioBetaUrl()}${path}`, body, {
    headers,
    timeout: DIO_TIMEOUT_MS,
    validateStatus: () => true,
  });

  const normalized = normalizeDioSuccess(response.data);
  if (response.status >= 200 && response.status < 300 && normalized) {
    return normalized;
  }

  const error = new Error("Dio compatibility friend request failed");
  error.status = response.status || 502;
  error.code = "DIO_FRIEND_FALLBACK_FAILED";
  throw error;
}

function isFriendFallbackCandidate(error) {
  if (!isEnabled()) return false;

  const status = Number(error?.response?.status || error?.status || 0);
  if (status !== 401 && status !== 403) return false;

  const config = error?.config || {};
  const url = String(config.url || "").replace(/^\/+/, "");
  if (url !== "sendFriendRequest" && url !== "sendFollowRequest") return false;

  return Boolean(config?.meta?.idToken);
}

async function tryDioFriendFallback(error) {
  if (!isFriendFallbackCandidate(error)) return null;

  const config = error.config;
  let body = config.data;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }

  const isCelebrity = String(config.url || "").replace(/^\/+/, "") === "sendFollowRequest";
  const friendUid = isCelebrity
    ? body?.data?.celebrity_uid
    : body?.data?.user_uid;

  if (!friendUid) return null;

  try {
    const data = await sendViaDio({
      kind: isCelebrity ? "celebrity" : "friend",
      idToken: config.meta.idToken,
      friendUid,
    });

    if (!data) return null;

    console.log("[friends] Dio compatibility fallback succeeded", {
      kind: isCelebrity ? "celebrity" : "friend",
    });

    return {
      data,
      status: 200,
      statusText: "OK",
      headers: {},
      config,
      request: null,
    };
  } catch (fallbackError) {
    console.warn("[friends] Dio compatibility fallback failed", {
      kind: isCelebrity ? "celebrity" : "friend",
      status: fallbackError?.status || fallbackError?.response?.status || null,
      code: fallbackError?.code || null,
    });
    return null;
  }
}

module.exports = {
  isEnabled,
  normalizeDioSuccess,
  isFriendFallbackCandidate,
  tryDioFriendFallback,
};
