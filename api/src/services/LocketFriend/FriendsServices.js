const { instanceLocketV2 } = require("../../libs");
const { createAnalytics } = require("../LocketAnalytics");

const axios = require("axios");
const constants = require("../../utils/constants");

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

function incompleteCelebritySnapshotError() {
  const error = new Error("Celebrity slot data unavailable for this session");
  // Slot worker treats 401/403 as account-specific and immediately tries another
  // saved background session. This avoids one partial Locket response blocking the
  // whole celebrity group.
  error.status = 403;
  error.code = "CELEB_SNAPSHOT_UNAVAILABLE";
  return error;
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
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await instanceLocketV2.post("getUserByUsername", body, {
        meta: { idToken },
      });
      const result = response.data?.result;

      if (hasValidCelebrityCapacity(result)) return result;

      lastError = incompleteCelebritySnapshotError();
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }
      throw lastError;
    } catch (error) {
      lastError = error;
      if (
        error?.code === "CELEB_SNAPSHOT_UNAVAILABLE" &&
        attempt < 2
      ) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        continue;
      }

      console.error("[friends] upstream user lookup failed", {
        status: error?.response?.status || error?.status || null,
        code: error?.code || null,
      });
      throw error;
    }
  }

  throw lastError || incompleteCelebritySnapshotError();
};

module.exports = {
  getAllFriends,
  removeFriend,
  AcceptToFriend,
  FindFriendByUserName,
};