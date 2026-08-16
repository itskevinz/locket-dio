const axios = require("axios");
const { getDioPublicApiKey } = require("../config/dioPublicApi");
const {
  isConfirmedRelationship,
  normalizeRelationshipValue,
} = require("../services/LocketFriend/relationshipPolicy");

const DEFAULT_DIO_API_URL = "https://api.locket-dio.com";
const DEFAULT_DIO_BETA_URL = "https://api-beta.locket-dio.com";

const DIO_TIMEOUT_MS = 12000;
const FIRESTORE_USERS_BASE =
  "https://firestore.googleapis.com/v1/projects/locket-4252a/databases/(default)/documents/users";
const LOCKET_API_BASE = "https://api.locketcamera.com";
const VERIFY_DELAYS_MS = [250, 700, 1400, 2200];
const CELEB_VERIFY_DELAYS_MS = [0, 150, 350, 700];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    "x-api-key": getDioPublicApiKey(),
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

function decodeFirebaseUid(idToken) {
  try {
    const payload = String(idToken || "").split(".")[1];
    if (!payload) return "";
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return String(parsed.user_id || parsed.uid || parsed.sub || "").trim();
  } catch {
    return "";
  }
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
  if (!data || typeof data !== "object" || data.success === false) return null;

  const nestedResult = data?.data?.result;
  if (nestedResult) {
    return nestedResult.data !== null && nestedResult.data !== undefined
      ? { result: nestedResult }
      : null;
  }

  const directResult = data?.result;
  if (directResult) {
    return directResult.data !== null && directResult.data !== undefined
      ? { result: directResult }
      : null;
  }

  if (data.success !== true) return null;
  if (!Object.prototype.hasOwnProperty.call(data, "data")) return null;
  if (data.data === null || data.data === undefined) return null;

  return {
    result: {
      data: data.data,
    },
  };
}

function fieldString(document, field) {
  return String(document?.fields?.[field]?.stringValue || "").trim();
}

async function collectionContainsTarget({
  idToken,
  localId,
  collection,
  targetUid,
  fields,
}) {
  let pageToken = null;
  let page = 0;
  const url = `${FIRESTORE_USERS_BASE}/${encodeURIComponent(localId)}/${collection}`;

  do {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: "application/json",
      },
      params: {
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      },
      timeout: 8000,
    });

    const documents = Array.isArray(response.data?.documents)
      ? response.data.documents
      : [];
    if (
      documents.some((document) =>
        fields.some((field) => fieldString(document, field) === String(targetUid)),
      )
    ) {
      return true;
    }

    pageToken = String(response.data?.nextPageToken || "").trim() || null;
    page += 1;
  } while (pageToken && page < 20);

  return false;
}

async function lookupPersistedRelationship(idToken, targetUid) {
  const localId = decodeFirebaseUid(idToken);
  if (!localId || !targetUid) return "";

  const [isFriend, hasOutgoing] = await Promise.all([
    collectionContainsTarget({
      idToken,
      localId,
      collection: "friends",
      targetUid,
      fields: ["user", "user_uid"],
    }),
    collectionContainsTarget({
      idToken,
      localId,
      collection: "outgoing_friend_requests",
      targetUid,
      fields: ["requested_user", "user", "user_uid"],
    }),
  ]);

  if (isFriend) return "FRIEND";
  if (hasOutgoing) return "OUTGOING_REQUEST";
  return "";
}

async function safeLookupPersistedRelationship(idToken, targetUid) {
  try {
    return await lookupPersistedRelationship(idToken, targetUid);
  } catch (error) {
    console.warn("[friends] request verification read failed", {
      status: error?.response?.status || error?.status || null,
      code: error?.code || null,
    });
    return "";
  }
}

async function waitForPersistedRelationship(idToken, targetUid) {
  for (const delayMs of VERIFY_DELAYS_MS) {
    await sleep(delayMs);
    const state = await safeLookupPersistedRelationship(idToken, targetUid);
    if (state) return state;
  }
  return "";
}

function normalizeCelebrityRelationship(user) {
  const status = normalizeRelationshipValue(user?.friendship_status);
  return isConfirmedRelationship(status, { celebrity: true }) ? status : "";
}

function unwrapUser(data) {
  return (
    data?.data?.result?.data ||
    data?.result?.data ||
    data?.data ||
    data ||
    null
  );
}

function dioSessionHeaders(idToken, session) {
  const headers = {
    ...commonHeaders(idToken),
    [session.memberHeader]: session.memberToken,
  };
  if (session.cookieHeader) headers.Cookie = session.cookieHeader;
  return headers;
}

async function lookupCelebrityRelationship({ idToken, targetUid, session }) {
  let username = "";

  // fetchUserV2 is a read endpoint and remains usable without App Check. It can
  // provide both the relationship directly and the username needed by Dio's
  // getUserByData endpoint.
  try {
    const response = await axios.post(
      `${LOCKET_API_BASE}/fetchUserV2`,
      { data: { user_uid: targetUid } },
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 8000,
      },
    );
    const user = unwrapUser(response.data);
    const relationship = normalizeCelebrityRelationship(user);
    if (relationship) return relationship;
    username = String(user?.username || "").trim();
  } catch (error) {
    console.warn("[friends] celebrity relationship fetchUserV2 verify failed", {
      status: error?.response?.status || error?.status || null,
      code: error?.code || null,
    });
  }

  if (!username) return "";

  // Dio's current client resolves Celeb friendship_status through this endpoint.
  try {
    const response = await axios.post(
      `${dioBaseUrl()}/locket/getUserByData`,
      { username },
      {
        headers: dioSessionHeaders(idToken, session),
        timeout: 8000,
        validateStatus: () => true,
      },
    );
    if (response.status < 200 || response.status >= 300) return "";
    return normalizeCelebrityRelationship(unwrapUser(response.data));
  } catch (error) {
    console.warn("[friends] celebrity relationship Dio verify failed", {
      status: error?.response?.status || error?.status || null,
      code: error?.code || null,
    });
    return "";
  }
}

async function waitForCelebrityRelationship({ idToken, targetUid, session }) {
  for (const delayMs of CELEB_VERIFY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    const state = await lookupCelebrityRelationship({
      idToken,
      targetUid,
      session,
    });
    if (state) return state;
  }
  return "";
}

function verifiedResult(state, extra = {}) {
  return {
    result: {
      data: {
        verified: true,
        relationship: state,
        ...extra,
      },
    },
  };
}

async function sendViaDio({ kind, idToken, friendUid, skipPreflight = false }) {
  if (!isEnabled()) return null;
  if (!idToken || !friendUid) return null;

  // Auto Celeb cần tranh slot theo thời gian thực: mutation phải được bắn trước.
  // Friend thường vẫn giữ preflight để chống gửi trùng. Sau mutation, tất cả đường
  // đều phải verify dữ liệu Locket thật trước khi được phép báo SENT.
  if (!skipPreflight) {
    const existingState = await safeLookupPersistedRelationship(idToken, friendUid);
    if (existingState) {
      console.log("[friends] Dio request already persisted", {
        kind,
        relationship: existingState,
      });
      return verifiedResult(existingState, { alreadyPersisted: true });
    }
  }

  const session = await createDioMemberSession(idToken);
  const isCelebrity = kind === "celebrity";
  const path = isCelebrity
    ? "/locket/sendCelebrityRequestV2"
    : "/locket/sendFriendRequestV2";
  const body = isCelebrity
    ? { friendUid }
    : { data: { friendUid } };

  const headers = dioSessionHeaders(idToken, session);

  const baseUrl = dioBaseUrl();

  const response = await axios.post(`${baseUrl}${path}`, body, {
    headers,
    timeout: DIO_TIMEOUT_MS,
    validateStatus: () => true,
  });

  const normalized = normalizeDioSuccess(response.data);
  if (response.status < 200 || response.status >= 300 || !normalized) {
    const error = new Error("Dio compatibility friend request failed");
    error.status = response.status || 502;
    error.code = "DIO_FRIEND_FALLBACK_FAILED";
    throw error;
  }

  const persistedState = isCelebrity
    ? await waitForCelebrityRelationship({
        idToken,
        targetUid: friendUid,
        session,
      })
    : await waitForPersistedRelationship(idToken, friendUid);

  if (!persistedState) {
    const error = new Error(
      "Dio returned success but Locket did not persist the friend request",
    );
    error.status = 502;
    error.code = "DIO_REQUEST_NOT_CONFIRMED";
    throw error;
  }

  return verifiedResult(persistedState, {
    upstreamData: normalized?.result?.data || null,
  });
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
      skipPreflight: isCelebrity,
    });

    if (!data) return null;

    console.log("[friends] Dio compatibility fallback verified", {
      kind: isCelebrity ? "celebrity" : "friend",
      relationship: data?.result?.data?.relationship || null,
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
  decodeFirebaseUid,
  lookupPersistedRelationship,
  isFriendFallbackCandidate,
  tryDioFriendFallback,
};
