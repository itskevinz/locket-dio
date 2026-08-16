const axios = require("axios");
const constants = require("../../utils/constants");
const { instanceLocketV2 } = require("../../libs");

const BLOCK_ENDPOINTS = ["blockUser", "blockFriend", "blockAccount"];
const UNBLOCK_ENDPOINTS = ["unblockUser", "unblockFriend", "unblockAccount"];
const LIST_ENDPOINTS = ["getBlockedUsers", "getBlockedAccounts", "getBlockedUsersV2"];
const FIRESTORE_COLLECTIONS = ["blocked", "blocked_users", "blockedUsers", "blocks"];

function cleanUid(value) {
  return String(value || "").trim();
}

function errorStatus(error) {
  const value = Number(error?.response?.status || error?.status || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function unwrapCallableData(body) {
  return body?.result?.data ?? body?.data ?? body?.result ?? body ?? null;
}

function collectUids(value, output = new Set(), depth = 0) {
  if (depth > 5 || value == null) return output;

  if (typeof value === "string") {
    const uid = cleanUid(value);
    if (uid && uid.length >= 8) output.add(uid);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectUids(item, output, depth + 1));
    return output;
  }

  if (typeof value !== "object") return output;

  const direct = cleanUid(
    value.uid || value.user_uid || value.userUid || value.user_id || value.id,
  );
  if (direct) output.add(direct);

  [
    "blocked_users",
    "blockedUsers",
    "blocked_accounts",
    "blockedAccounts",
    "users",
    "accounts",
    "items",
    "data",
    "profiles",
  ].forEach((key) => {
    if (value[key] != null) collectUids(value[key], output, depth + 1);
  });

  return output;
}

function callableLooksSuccessful(body, targetUid = "") {
  const result = body?.result ?? body;
  const status = Number(result?.status ?? body?.status ?? 200);
  const errors = result?.errors ?? body?.errors;
  if (Number.isFinite(status) && status >= 400) return false;
  if (Array.isArray(errors) && errors.length > 0) return false;

  if (!targetUid) return true;
  const data = unwrapCallableData(body);
  const returnedUid = cleanUid(
    data?.uid || data?.user_uid || data?.userUid || data?.user_id || data?.id,
  );
  return !returnedUid || returnedUid === cleanUid(targetUid);
}

async function callFirstAvailable(idToken, endpoints, data = {}) {
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await instanceLocketV2.post(
        endpoint,
        { data },
        { meta: { idToken }, timeout: 15000 },
      );
      return { endpoint, response };
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      // Endpoint names changed between Locket builds. Only 404/405 means the
      // candidate itself is unavailable; auth/rate-limit/upstream errors should
      // be surfaced instead of silently trying mutations against many routes.
      if (status === 404 || status === 405) continue;
      throw error;
    }
  }

  const error = new Error("Locket block API is unavailable on this app version.");
  error.code = "LOCKET_BLOCK_ENDPOINT_UNAVAILABLE";
  error.status = errorStatus(lastError) || 501;
  error.cause = lastError || null;
  throw error;
}

function firestoreUidFromDocument(doc) {
  const fields = doc?.fields || {};
  return cleanUid(
    fields.user?.stringValue ||
      fields.uid?.stringValue ||
      fields.user_uid?.stringValue ||
      fields.blocked_user?.stringValue ||
      String(doc?.name || "").split("/").pop(),
  );
}

async function readBlockedFirestore(idToken, userUid) {
  const headers = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };

  let sawReadableCollection = false;
  let lastError = null;

  for (const collection of FIRESTORE_COLLECTIONS) {
    const url = `${constants.GET_ACCOUNT_INFO_URL_V2}${encodeURIComponent(
      userUid,
    )}/${collection}?pageSize=100`;
    try {
      const response = await axios.get(url, { headers, timeout: 12000 });
      sawReadableCollection = true;
      const documents = Array.isArray(response?.data?.documents)
        ? response.data.documents
        : [];
      const uids = documents.map(firestoreUidFromDocument).filter(Boolean);
      if (uids.length > 0) {
        return {
          uids: [...new Set(uids)],
          source: `firestore:${collection}`,
          authoritative: true,
        };
      }
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      if (status === 404 || status === 403) continue;
    }
  }

  return {
    uids: [],
    source: sawReadableCollection ? "firestore:empty" : "firestore:unavailable",
    authoritative: false,
    error: lastError || null,
  };
}

async function getBlockedUserIds(idToken, userUid) {
  let callableError = null;

  for (const endpoint of LIST_ENDPOINTS) {
    try {
      const response = await instanceLocketV2.post(
        endpoint,
        { data: {} },
        { meta: { idToken }, timeout: 15000 },
      );
      const body = response?.data;
      if (!callableLooksSuccessful(body)) continue;
      const value = unwrapCallableData(body);
      const uids = [...collectUids(value)];
      return {
        uids,
        source: `callable:${endpoint}`,
        authoritative: true,
      };
    } catch (error) {
      callableError = error;
      const status = errorStatus(error);
      if (status === 404 || status === 405) continue;
      // Keep a Firestore read fallback for deployments where the callable is
      // temporarily unavailable but the user's own relationship collection is readable.
      break;
    }
  }

  const firestore = await readBlockedFirestore(idToken, userUid);
  if (firestore.authoritative || firestore.uids.length > 0) return firestore;

  if (callableError && ![404, 405].includes(errorStatus(callableError))) {
    callableError.code = callableError.code || "LOCKET_BLOCK_LIST_FAILED";
  }
  return firestore;
}

function normalizeProfile(uid, body) {
  const user = unwrapCallableData(body) || {};
  return {
    uid,
    username: String(user.username || "").trim(),
    firstName: String(user.first_name || user.firstName || "").trim(),
    lastName: String(user.last_name || user.lastName || "").trim(),
    displayName: String(
      user.display_name ||
        user.displayName ||
        `${user.first_name || user.firstName || ""} ${user.last_name || user.lastName || ""}`.trim() ||
        user.username ||
        uid,
    ).trim(),
    profilePicture: String(
      user.profile_picture_url || user.profilePicture || user.avatar || "",
    ).trim(),
  };
}

async function fetchBlockedProfile(idToken, uid) {
  try {
    const response = await instanceLocketV2.post(
      "fetchUserV2",
      { data: { user_uid: uid } },
      { meta: { idToken }, timeout: 12000 },
    );
    return normalizeProfile(uid, response?.data);
  } catch {
    return normalizeProfile(uid, null);
  }
}

async function getBlockedUsers(idToken, userUid) {
  const state = await getBlockedUserIds(idToken, userUid);
  const safeUids = state.uids.slice(0, 100);
  const users = [];

  for (let i = 0; i < safeUids.length; i += 8) {
    const batch = safeUids.slice(i, i + 8);
    const profiles = await Promise.all(batch.map((uid) => fetchBlockedProfile(idToken, uid)));
    users.push(...profiles);
  }

  return {
    users,
    source: state.source,
    authoritative: state.authoritative,
  };
}

async function relationshipLooksBlocked(idToken, uid) {
  try {
    const response = await instanceLocketV2.post(
      "fetchUserV2",
      { data: { user_uid: uid } },
      { meta: { idToken }, timeout: 12000 },
    );
    const user = unwrapCallableData(response?.data) || {};
    const status = String(
      user.friendship_status || user.relationship_status || user.relationship || "",
    )
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    return status.includes("block");
  } catch {
    return false;
  }
}

async function blockUser(idToken, userUid, targetUid) {
  const uid = cleanUid(targetUid);
  if (!uid || uid === cleanUid(userUid)) {
    const error = new Error("Tài khoản block không hợp lệ.");
    error.code = "INVALID_BLOCK_TARGET";
    error.status = 400;
    throw error;
  }

  const mutation = await callFirstAvailable(idToken, BLOCK_ENDPOINTS, {
    user_uid: uid,
  });
  if (!callableLooksSuccessful(mutation.response?.data, uid)) {
    const error = new Error("Locket từ chối yêu cầu block.");
    error.code = "LOCKET_BLOCK_REJECTED";
    error.status = 409;
    throw error;
  }

  const after = await getBlockedUserIds(idToken, userUid);
  const confirmed = after.uids.includes(uid) || (await relationshipLooksBlocked(idToken, uid));
  if (!confirmed) {
    const error = new Error(
      "Locket đã nhận thao tác nhưng chưa xác nhận tài khoản xuất hiện trong danh sách block.",
    );
    error.code = "LOCKET_BLOCK_NOT_CONFIRMED";
    error.status = 502;
    throw error;
  }

  return {
    uid,
    confirmed: true,
    endpoint: mutation.endpoint,
    listSource: after.source,
  };
}

async function unblockUser(idToken, userUid, targetUid) {
  const uid = cleanUid(targetUid);
  if (!uid) {
    const error = new Error("Tài khoản unblock không hợp lệ.");
    error.code = "INVALID_UNBLOCK_TARGET";
    error.status = 400;
    throw error;
  }

  const mutation = await callFirstAvailable(idToken, UNBLOCK_ENDPOINTS, {
    user_uid: uid,
  });
  if (!callableLooksSuccessful(mutation.response?.data, uid)) {
    const error = new Error("Locket từ chối yêu cầu unblock.");
    error.code = "LOCKET_UNBLOCK_REJECTED";
    error.status = 409;
    throw error;
  }

  const after = await getBlockedUserIds(idToken, userUid);
  const stillBlocked = after.uids.includes(uid) || (await relationshipLooksBlocked(idToken, uid));
  if (stillBlocked) {
    const error = new Error("Locket chưa xác nhận unblock tài khoản này.");
    error.code = "LOCKET_UNBLOCK_NOT_CONFIRMED";
    error.status = 502;
    throw error;
  }

  // If the callable itself succeeded and the account no longer looks blocked,
  // accept the mutation. The user may need to send a new friend request later.
  return {
    uid,
    confirmed: true,
    endpoint: mutation.endpoint,
    listSource: after.source,
  };
}

module.exports = {
  blockUser,
  unblockUser,
  getBlockedUsers,
  getBlockedUserIds,
};
