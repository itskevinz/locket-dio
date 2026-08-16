const { instanceLocketV2 } = require("../../libs");
const { createAnalytics } = require("../LocketAnalytics");

const axios = require("axios");
const constants = require("../../utils/constants");
const { getDioPublicApiKey } = require("../../config/dioPublicApi");

const DIO_MAIN_URL = "https://api.locket-dio.com";
const DIO_BETA_URL = "https://api-beta.locket-dio.com";
const LOOKUP_RETRY_DELAYS_MS = [0, 180, 550];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getAllFriends = async (idToken, localId) => {
  //    GET_ACCOUNT_INFO_URL_V2: `https://firestore.googleapis.com/v1/projects/locket-4252a/databases/(default)/documents/users/`,
  const baseUrl = `${constants.GET_ACCOUNT_INFO_URL_V2}${localId}/friends`;
  const headers = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };

  let pageToken = null;
  const allFriends = [];

  try {
    do {
      const url = pageToken
        ? `${baseUrl}?pageSize=100&pageToken=${pageToken}`
        : `${baseUrl}?pageSize=100`;

      const response = await axios.get(url, { headers });
      const documents = response.data.documents || [];

      const parsedFriends = documents.map((doc) => ({
        uid: doc.fields?.user?.stringValue,
        date: doc.createTime,
      }));

      allFriends.push(...parsedFriends);
      pageToken = response.data.nextPageToken || null;
    } while (pageToken);

    return allFriends;
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy danh sách bạn bè:",
      error.response?.data || error.message,
    );
    return []; // Trả về mảng rỗng nếu lỗi
  }
};

const removeFriend = async (idToken, uid) => {
  const url = "https://api.locketcamera.com/removeFriend";

  try {
    const response = await axios.post(
      url,
      {
        data: { user_uid: uid },
      },
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...constants.AUTH_HEADER,
        },
      },
    );

    const result = response.data?.result;
    console.log(result);
    // ✅ Trường hợp xoá thành công
    if (result?.data?.user_uid === uid) {
      console.log(`✅ Xoá bạn bè thành công: ${uid}`);
      return {
        success: true,
        uid: result?.data.user_uid,
        message: "Xoá bạn bè thành công",
      };
    }
    return result?.data;
  } catch (error) {
    // ❌ Lỗi thực sự từ mạng / server
    const errorMsg = error?.response?.data || error.message;
    console.error(`❌ Lỗi API khi xoá bạn: ${uid} -`, errorMsg);
    return {
      success: false,
      uid,
      message: errorMsg,
    };
  }
};

const AcceptToFriend = async (idToken, uid) => {
  const url = "https://api.locketcamera.com/acceptFriendRequest";

  try {
    const response = await axios.post(
      url,
      {
        data: { user_uid: uid },
      },
      {
        headers: {
          Authorization: `Bearer ${idToken}`,
          ...constants.AUTH_HEADER,
        },
      },
    );

    const result = response.data?.result;

    // ✅ Kiểm tra kết quả trả về
    if (result?.data?.user_uid === uid) {
      console.log(`✅ Chấp nhận lời mời kết bạn thành công: ${uid}`);
      return {
        success: true,
        uid,
        message: "Chấp nhận lời mời kết bạn thành công",
      };
    }
    return result?.data;
  } catch (error) {
    const errorMsg = error?.response?.data || error.message;
    console.error(`❌ Lỗi API khi chấp nhận lời mời từ ${uid}:`, errorMsg);
    return {
      success: false,
      uid,
      message: errorMsg,
    };
  }
};

function unwrapUserResult(result) {
  return result?.data || result?.result?.data || result || null;
}

function userUidFromResult(result) {
  const user = unwrapUserResult(result);
  return String(
    user?.uid || user?.user_uid || user?.userUid || user?.id || "",
  ).trim();
}

function looksLikeCelebrity(user) {
  if (!user) return false;
  const marker = user.celebrity;
  const friendshipStatus = String(user.friendship_status || "").toLowerCase();
  return Boolean(
    marker === true ||
    marker === 1 ||
    marker === "1" ||
    String(marker || "").toLowerCase() === "true" ||
    user.celebrity_data ||
    friendshipStatus.includes("follow")
  );
}

function hasValidCelebrityCapacity(result) {
  const user = unwrapUserResult(result);
  if (!looksLikeCelebrity(user)) return true;

  const celebrity = user?.celebrity_data;
  if (!celebrity) return false;

  const friendCount = Number(celebrity.friend_count);
  const maxFriends = Number(celebrity.max_friends);
  return (
    Number.isFinite(friendCount) &&
    friendCount >= 0 &&
    Number.isFinite(maxFriends) &&
    maxFriends > 0
  );
}

function hasCelebrityCapacity(result) {
  const user = unwrapUserResult(result);
  const celebrity = user?.celebrity_data;
  if (!celebrity) return false;
  const friendCount = Number(celebrity.friend_count);
  const maxFriends = Number(celebrity.max_friends);
  return (
    Number.isFinite(friendCount) &&
    friendCount >= 0 &&
    Number.isFinite(maxFriends) &&
    maxFriends > 0
  );
}

function incompleteCelebritySnapshotError() {
  const error = new Error("Celebrity slot data unavailable for this session");
  // This is incomplete upstream data, not an HTTP auth rejection. Leaving the
  // status unset prevents the shared worker from rotating every saved session.
  error.code = "CELEB_SNAPSHOT_UNAVAILABLE";
  return error;
}

function isRetryableLookupError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (error?.code === "CELEB_SNAPSHOT_UNAVAILABLE") return true;
  if (error?.code === "EMPTY_USER_LOOKUP") return true;
  if (!status) return true;
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

function dioBaseUrl() {
  return String(process.env.DIO_COMPAT_API_URL || DIO_MAIN_URL).replace(/\/$/, "");
}

function dioBetaUrl() {
  return String(process.env.DIO_COMPAT_BETA_URL || DIO_BETA_URL).replace(/\/$/, "");
}

function dioCommonHeaders(idToken) {
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

function dioCookieHeader(headers) {
  const values = headers?.["set-cookie"];
  if (!Array.isArray(values) || values.length === 0) return "";
  return values
    .map((value) => String(value || "").split(";", 1)[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function fetchUserByUsernameViaDio(idToken, username) {
  const sessionResponse = await axios.get(`${dioBaseUrl()}/api/cn`, {
    headers: dioCommonHeaders(idToken),
    timeout: 8000,
    validateStatus: () => true,
  });

  if (sessionResponse.status < 200 || sessionResponse.status >= 300) {
    const error = new Error("Dio search session unavailable");
    error.status = sessionResponse.status;
    error.code = "DIO_SEARCH_SESSION_UNAVAILABLE";
    throw error;
  }

  const session = sessionResponse.data?.data?.session || {};
  const memberToken = String(session.member_token || "").trim();
  const memberHeader = String(session.header || "X-LocketDio-Member").trim();
  if (!memberToken || !memberHeader) {
    const error = new Error("Dio search session missing member token");
    error.status = 502;
    error.code = "DIO_SEARCH_MEMBER_TOKEN_MISSING";
    throw error;
  }

  const headers = {
    ...dioCommonHeaders(idToken),
    [memberHeader]: memberToken,
  };
  const cookie = dioCookieHeader(sessionResponse.headers);
  if (cookie) headers.Cookie = cookie;

  const response = await axios.post(
    `${dioBetaUrl()}/locket/getUserByData`,
    { username },
    {
      headers,
      timeout: 8000,
      validateStatus: () => true,
    },
  );

  if (response.status < 200 || response.status >= 300) {
    const error = new Error("Dio username lookup failed");
    error.status = response.status;
    error.code = response.status === 404 ? "DIO_USER_NOT_FOUND" : "DIO_SEARCH_FAILED";
    throw error;
  }

  const result =
    response.data?.data?.result ||
    response.data?.result ||
    response.data?.data ||
    null;
  const user = unwrapUserResult(result);
  if (!user || typeof user !== "object" || Object.keys(user).length === 0) {
    const error = new Error("Dio username lookup returned empty data");
    error.code = "EMPTY_USER_LOOKUP";
    throw error;
  }
  return result;
}

async function fetchUserByUidForCapacity(idToken, uid) {
  if (!idToken || !uid) return null;
  try {
    const response = await instanceLocketV2.post(
      "fetchUserV2",
      { data: { user_uid: uid } },
      { meta: { idToken } },
    );
    return response.data?.result || null;
  } catch (error) {
    console.warn("[friends] fetchUserV2 capacity fallback failed", {
      status: error?.response?.status || error?.status || null,
      code: error?.code || null,
    });
    return null;
  }
}

async function recoverCelebrityCapacity(idToken, result) {
  if (hasCelebrityCapacity(result)) return result;
  const uid = userUidFromResult(result);
  if (!uid) return result;

  const fetched = await fetchUserByUidForCapacity(idToken, uid);
  if (hasCelebrityCapacity(fetched)) {
    console.log("[friends] celebrity snapshot recovered via fetchUserV2", { uid });
    return fetched;
  }
  return result;
}

// Hàm tìm bạn qua username
const FindFriendByUserName = async (idToken, username) => {
  const body = {
    data: {
      username: username,
      analytics: {
        ios_version: "2.8.0.1",
        experiments: {
          flag_4: {
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
            value: "43",
          },
          flag_9: {
            value: "11",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_22: {
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
            value: "1203",
          },
          flag_7: {
            value: "802",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_10: {
            value: "505",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_3: {
            value: "600",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_18: {
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
            value: "1203",
          },
          flag_6: {
            value: "2000",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_15: {
            value: "501",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
          flag_14: {
            value: "502",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
        },
        amplitude: {
          device_id: "562882AF-2F2D-47B0-8B64-B96E491F085B",
          session_id: {
            value: "1769358896753",
            "@type": "type.googleapis.com/google.protobuf.Int64Value",
          },
        },
        google_analytics: {
          app_instance_id: "69C274F34E7145C7B8D73236ECFB4E28",
        },
        platform: "ios",
      },
    },
  };

  let lastError = null;
  let bestResult = null;

  for (let attempt = 0; attempt < LOOKUP_RETRY_DELAYS_MS.length; attempt += 1) {
    const delayMs = LOOKUP_RETRY_DELAYS_MS[attempt];
    if (delayMs > 0) await sleep(delayMs);

    try {
      const response = await instanceLocketV2.post("getUserByUsername", body, {
        meta: { idToken },
      });
      const rawResult = response.data?.result;
      const rawUser = unwrapUserResult(rawResult);
      if (!rawUser || typeof rawUser !== "object" || Object.keys(rawUser).length === 0) {
        const error = new Error("Username lookup returned empty data");
        error.code = "EMPTY_USER_LOOKUP";
        throw error;
      }

      const result = await recoverCelebrityCapacity(idToken, rawResult);
      bestResult = result || rawResult;

      // Người dùng thường có thể trả ngay. Với Celeb, thử thêm vài lần để lấy
      // friend_count/max_friends phục vụ Canh Slot, nhưng không được biến việc
      // thiếu snapshot slot thành "người dùng không tồn tại" ở ô tìm kiếm.
      if (hasValidCelebrityCapacity(bestResult)) return bestResult;
      lastError = incompleteCelebritySnapshotError();
    } catch (error) {
      lastError = error;
      console.warn("[friends] upstream username lookup attempt failed", {
        attempt: attempt + 1,
        status: error?.response?.status || error?.status || null,
        code: error?.code || null,
      });
      if (!isRetryableLookupError(error)) break;
    }
  }

  // Locket thỉnh thoảng trả 404 giả cho một username tồn tại. Dio beta dùng
  // đường đọc khác nên được dùng làm fallback trước khi kết luận USER_NOT_FOUND.
  try {
    const dioResult = await fetchUserByUsernameViaDio(idToken, username);
    const recovered = await recoverCelebrityCapacity(idToken, dioResult);
    console.log("[friends] username lookup recovered via Dio beta", {
      username,
      hasCelebrityCapacity: hasCelebrityCapacity(recovered),
    });
    return recovered || dioResult;
  } catch (dioError) {
    console.warn("[friends] Dio beta username fallback failed", {
      username,
      status: dioError?.response?.status || dioError?.status || null,
      code: dioError?.code || null,
    });
  }

  // Nếu đã từng đọc được hồ sơ nhưng riêng dữ liệu slot bị thiếu, vẫn trả hồ sơ
  // cho chức năng tìm kiếm. Slot Monitor tự kiểm tra celebrity_data riêng.
  if (bestResult) return bestResult;

  console.error("[friends] upstream user lookup failed", {
    status: lastError?.response?.status || lastError?.status || null,
    code: lastError?.code || null,
  });
  throw lastError || incompleteCelebritySnapshotError();
};

module.exports = {
  getAllFriends,
  removeFriend,
  AcceptToFriend,
  FindFriendByUserName,
};
