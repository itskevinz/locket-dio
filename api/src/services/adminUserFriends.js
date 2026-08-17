const axios = require("axios");
const constants = require("../utils/constants");
const authServices = require("./AuthSecurity/AuthServices");
const { instanceLocketV2 } = require("../libs/instanceLocket");
const slotStore = require("../modules/slotMonitor/store");
const { decryptSecret, encryptSecret } = require("../modules/slotMonitor/crypto");
const { decodeFirebaseUid } = require("../modules/slotMonitor/core");

const MAX_PAGE_SIZE = 50;
const PROFILE_BATCH_SIZE = 8;

function makeError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function getTargetIdToken(userUid) {
  const uid = String(userUid || "").trim();
  if (!uid) {
    throw makeError("Thiếu UID người dùng.", "INVALID_USER_UID", 400);
  }

  const session = await slotStore.getSession(uid);
  if (!session?.enabled || !session?.refresh_token_enc) {
    throw makeError(
      "User chưa có phiên nền Canh Slot 24/7 hợp lệ.",
      "USER_BACKGROUND_SESSION_UNAVAILABLE",
      409,
    );
  }

  let refreshToken;
  try {
    refreshToken = decryptSecret(session.refresh_token_enc);
  } catch (error) {
    await slotStore
      .markSessionError(uid, "Encrypted background session could not be opened")
      .catch(() => {});
    throw makeError(
      "Không thể mở phiên nền đã mã hóa của user.",
      "USER_BACKGROUND_SESSION_INVALID",
      409,
    );
  }

  try {
    const refreshed = await authServices.refreshIdToken(refreshToken);
    const idToken = refreshed?.id_token || refreshed?.access_token;
    const refreshedUid = decodeFirebaseUid(idToken);

    if (!idToken || !refreshedUid || String(refreshedUid) !== uid) {
      throw makeError(
        "Phiên nền không khớp UID người dùng.",
        "USER_BACKGROUND_SESSION_MISMATCH",
        409,
      );
    }

    const nextRefreshToken = refreshed?.refresh_token || refreshToken;
    await slotStore.markSessionRefreshed(uid, encryptSecret(nextRefreshToken));
    return idToken;
  } catch (error) {
    await slotStore
      .markSessionError(uid, error?.message || "Background session refresh failed")
      .catch(() => {});

    if (error?.code?.startsWith?.("USER_BACKGROUND_SESSION_")) throw error;
    throw makeError(
      "Phiên nền của user đã hết hạn hoặc Locket từ chối làm mới.",
      "USER_BACKGROUND_SESSION_INVALID",
      409,
    );
  }
}

function friendUidFromDocument(doc) {
  const fields = doc?.fields || {};
  const direct =
    fields.user?.stringValue ||
    fields.uid?.stringValue ||
    fields.user_uid?.stringValue ||
    fields.userUid?.stringValue;
  if (direct) return String(direct).trim();

  const name = String(doc?.name || "");
  const lastPart = name.split("/").filter(Boolean).pop();
  return lastPart ? String(lastPart).trim() : "";
}

async function readFriendPage(idToken, userUid, { limit, pageToken }) {
  const pageSize = Math.min(
    Math.max(Number.parseInt(limit, 10) || 30, 1),
    MAX_PAGE_SIZE,
  );

  const baseUrl = `${constants.GET_ACCOUNT_INFO_URL_V2}${encodeURIComponent(userUid)}/friends`;
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.set("pageToken", String(pageToken));

  try {
    const response = await axios.get(`${baseUrl}?${params.toString()}`, {
      timeout: 15_000,
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: "application/json",
      },
    });

    const documents = Array.isArray(response?.data?.documents)
      ? response.data.documents
      : [];

    return {
      rows: documents
        .map((doc) => ({
          uid: friendUidFromDocument(doc),
          addedAt: doc?.createTime || null,
          updatedAt: doc?.updateTime || null,
        }))
        .filter((row) => row.uid),
      nextPageToken: response?.data?.nextPageToken || null,
    };
  } catch (error) {
    const status = Number(error?.response?.status || 0);
    const mapped = makeError(
      status === 401 || status === 403
        ? "Locket từ chối quyền đọc danh sách bạn bè của phiên user."
        : "Không thể đọc danh sách bạn bè từ Locket.",
      status === 401 || status === 403
        ? "USER_BACKGROUND_SESSION_INVALID"
        : "LOCKET_FRIENDS_QUERY_FAILED",
      status === 401 || status === 403 ? 409 : 502,
    );
    mapped.cause = error;
    throw mapped;
  }
}

function normalizeProfile(uid, raw = null) {
  const user = raw && typeof raw === "object" ? raw : {};
  const firstLast = [user.first_name, user.last_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return {
    uid: String(user.uid || user.user_uid || uid || "").trim(),
    username: String(user.username || "").trim() || null,
    displayName:
      String(user.display_name || user.displayName || firstLast || user.username || "").trim() ||
      null,
    avatar:
      String(
        user.profile_picture ||
          user.profile_picture_url ||
          user.avatar_url ||
          user.avatar ||
          "",
      ).trim() || null,
    celebrity: Boolean(
      user.celebrity === true ||
        user.celebrity === 1 ||
        user.celebrity === "1" ||
        String(user.celebrity || "").toLowerCase() === "true" ||
        user.celebrity_data,
    ),
    friendshipStatus: String(user.friendship_status || "friends"),
  };
}

async function fetchProfile(idToken, uid) {
  try {
    const response = await instanceLocketV2.post(
      "fetchUserV2",
      { data: { user_uid: uid } },
      { meta: { idToken }, timeout: 10_000 },
    );
    return normalizeProfile(uid, response?.data?.result?.data || null);
  } catch (error) {
    console.warn("[admin-user-friends] profile lookup failed", {
      uid,
      status: error?.response?.status || null,
      code: error?.code || null,
    });
    return normalizeProfile(uid, null);
  }
}

async function enrichProfiles(idToken, rows) {
  const output = [];
  for (let index = 0; index < rows.length; index += PROFILE_BATCH_SIZE) {
    const batch = rows.slice(index, index + PROFILE_BATCH_SIZE);
    const profiles = await Promise.all(
      batch.map((row) => fetchProfile(idToken, row.uid)),
    );
    for (let offset = 0; offset < batch.length; offset += 1) {
      output.push({ ...profiles[offset], ...batch[offset] });
    }
  }
  return output;
}

async function listUserFriendsForAdmin(userUid, options = {}) {
  const uid = String(userUid || "").trim();
  const idToken = await getTargetIdToken(uid);
  const page = await readFriendPage(idToken, uid, options);
  const friends = await enrichProfiles(idToken, page.rows);

  return {
    userUid: uid,
    friends,
    count: friends.length,
    nextPageToken: page.nextPageToken,
  };
}

module.exports = {
  listUserFriendsForAdmin,
};
