const axios = require("axios");
const crypto = require("crypto");
const constants = require("../../utils/constants");
const { instanceLocketV2 } = require("../../libs");
const { createAnalytics } = require("../LocketAnalytics");

const normalizeUpstreamFailure = (error, fallbackMessage) => {
  const status = Number(error?.response?.status) || 502;
  let code = "UPSTREAM_ERROR";

  if (status === 401 || status === 403) code = "UPSTREAM_AUTH_FAILED";
  if (status === 404) code = "USER_NOT_FOUND";
  if (status === 409) code = "REQUEST_CONFLICT";
  if (status === 429) code = "RATE_LIMITED";

  return {
    success: false,
    status,
    code,
    message: fallbackMessage,
  };
};

const getAllFriendRequests = async (
  idToken,
  localId,
  pageToken = null,
  limit = 10,
) => {
  const baseUrl = `${constants.GET_ACCOUNT_INFO_URL_V2}${localId}/incoming_friend_requests`;
  const headers = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };

  try {
    const url = pageToken
      ? `${baseUrl}?pageSize=${limit}&pageToken=${pageToken}`
      : `${baseUrl}?pageSize=${limit}`;

    const response = await axios.get(url, { headers });
    const documents = response.data.documents || [];
    const nextPageToken = response.data.nextPageToken || null;

    const parsedRequests = documents.map((doc) => ({
      uid: doc.fields?.requesting_user?.stringValue || null,
      to: doc.fields?.requested_user?.stringValue || null,
      date: doc.fields?.created_at?.timestampValue || doc.createTime,
      shareEligible: doc.fields?.share_history_eligible?.booleanValue ?? false,
      docId: doc.name.split("/").pop(),
    }));

    return {
      data: parsedRequests,
      nextPageToken,
    };
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy danh sách lời mời kết bạn:",
      error.response?.data || error.message,
    );
    return {
      data: [],
      nextPageToken: null,
    };
  }
};

const getAllFriendRequestsV2 = async (
  idToken,
  localId,
  // pageToken = null,
  limit = 10,
) => {
  const baseUrl = `${constants.GET_ACCOUNT_INFO_URL_V2}${localId}/incoming_friend_requests`;
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
        uid: doc.fields?.requesting_user?.stringValue,
        date: doc.createTime,
      }));

      allFriends.push(...parsedFriends);
      pageToken = response.data.nextPageToken || null;
    } while (pageToken);

    return { data: allFriends };
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy danh sách lời mời kết bạn:",
      error.response?.data || error.message,
    );
    return {
      data: [],
      nextPageToken: null,
    };
  }
};

const getOutgoingFriendRequests = async (
  idToken,
  localId,
  pageToken = null,
  limit = 10,
) => {
  const baseUrl = `${constants.GET_ACCOUNT_INFO_URL_V2}${localId}/outgoing_friend_requests`;
  const headers = {
    Authorization: `Bearer ${idToken}`,
    Accept: "application/json",
  };

  try {
    const url = pageToken
      ? `${baseUrl}?pageSize=${limit}&pageToken=${pageToken}`
      : `${baseUrl}?pageSize=${limit}`;

    const response = await axios.get(url, { headers });
    const documents = response.data.documents || [];
    const nextPageToken = response.data.nextPageToken || null;

    const parsedRequests = documents.map((doc) => ({
      uid: doc.fields?.requesting_user?.stringValue || null,
      to: doc.fields?.requested_user?.stringValue || null,
      date: doc.fields?.created_at?.timestampValue || doc.createTime,
      shareEligible: doc.fields?.share_history_eligible?.booleanValue ?? false,
      docId: doc.name.split("/").pop(),
    }));

    return {
      data: parsedRequests,
      nextPageToken,
    };
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy danh sách lời mời kết bạn:",
      error.response?.data || error.message,
    );
    return {
      data: [],
      nextPageToken: null,
    };
  }
};

//
const rejectFriendRequest = async (idToken, uids) => {
  const url = "https://api.locketcamera.com/deleteFriendRequest";
  const results = [];

  const batchSize = 50;
  const total = uids.length;

  for (let i = 0; i < total; i += batchSize) {
    const batch = uids.slice(i, i + batchSize);

    console.log(
      `🚀 Đang xử lý batch ${i / batchSize + 1} (${i + 1} → ${
        i + batch.length
      })`,
    );

    const batchResults = await Promise.allSettled(
      batch.map(async (uid, index) => {
        const body = {
          data: {
            user_uid: uid,
            direction: "incoming",
          },
        };

        try {
          const response = await axios.post(url, body, {
            headers: {
              Authorization: `Bearer ${idToken}`,
              ...constants.AUTH_HEADER,
            },
          });

          if (response.data?.result?.data === null) {
            console.log(
              `✅ [${i + index + 1}/${total}] Xoá thành công: ${uid}`,
            );
            return { success: true, uid };
          } else {
            console.error(
              `❌ [${i + index + 1}/${total}] Xoá thất bại: ${uid} -`,
              response.data?.result?.message,
            );
            return {
              success: false,
              uid,
              message: response.data?.result?.message || "Unknown error",
            };
          }
        } catch (error) {
          console.error(
            `❌ [${i + index + 1}/${total}] Lỗi API: ${uid} -`,
            error?.response?.data || error.message,
          );
          return {
            success: false,
            uid,
            message: error?.response?.data || error.message,
          };
        }
      }),
    );

    results.push(
      ...batchResults.map(
        (r) =>
          r.value || { success: false, uid: null, message: "Unknown error" },
      ),
    );
  }

  return results;
};

const rejectOutgoingFriendRequest = async (idToken, uid) => {
  const url = "https://api.locketcamera.com/deleteFriendRequest";

  const body = {
    data: {
      user_uid: uid,
      direction: "outgoing",
    },
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...constants.AUTH_HEADER,
      },
    });

    if (response.data?.result?.data === null) {
      console.log(`✅ Xoá thành công: ${uid}`);
      return { success: true, uid };
    } else {
      console.error(
        `❌ Xoá thất bại: ${uid} -`,
        response.data?.result?.message,
      );
      return {
        success: false,
        uid,
        message: response.data?.result?.message || "Unknown error",
      };
    }
  } catch (error) {
    console.error(
      `❌ Lỗi API khi xoá: ${uid} -`,
      error?.response?.data || error.message,
    );
    return {
      success: false,
      uid,
      message: error?.response?.data || error.message,
    };
  }
};

/**
 * Gửi lời mời kết bạn đến người dùng có UID là `friend_uid`
 * @param {string} idToken - Firebase ID token để xác thực
 * @param {string} friend_uid - UID của người muốn gửi lời mời kết bạn
 * @returns {object} Kết quả thành công hoặc lỗi
 */
const SendToFriendRequest = async ({ idToken, friendUid, appcheckToken }) => {
  const body = {
    data: {
      user_uid: friendUid,
      source: "signUp",
      platform: "iOS",
      messenger: "Messages",
      invite_variant: {
        value: "1002",
        "@type": "type.googleapis.com/google.protobuf.Int64Value",
      },
      share_history_eligible: true,
      rollcall: false,
      prompted_reengagement: false,
      create_ofr_for_temp_users: false,
      get_reengagement_status: false,
    },
  };

  try {
    const response = await instanceLocketV2.post("sendFriendRequest", body, {
      meta: { idToken: idToken, appCheckToken: appcheckToken },
    });

    const result = response.data?.result;
    if (result?.data === null || result?.data === undefined) {
      return {
        success: false,
        status: 400,
        code: "UPSTREAM_REJECTED",
        message: "Locket không chấp nhận lời mời kết bạn.",
      };
    }

    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    console.error("[friends] upstream sendFriendRequest failed", {
      status: error?.response?.status || null,
    });
    return normalizeUpstreamFailure(
      error,
      "Không thể gửi lời mời kết bạn qua Locket.",
    );
  }
};

/**
 * Chấp nhận lời mời kết bạn từ người có UID là `friend_uid`
 * @param {string} idToken - Firebase ID token để xác thực
 * @param {string} friend_uid - UID của người đã gửi lời mời kết bạn
 * @returns {object} Kết quả thành công hoặc lỗi
 */
const AcceptToFriendRequest = async (idToken, friend_uid) => {
  const url = "https://api.locketcamera.com/acceptFriendRequest";
  const body = {
    data: {
      user_uid: friend_uid,
    },
  };

  try {
    const response = await axios.post(url, body, {
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...constants.AUTH_HEADER,
      },
    });

    if (response.data?.result?.data !== null) {
      console.log(`✅ Đã chấp nhận lời mời kết bạn từ: ${friend_uid}`);
      return { success: true, uid: friend_uid };
    } else {
      console.error(
        `❌ Không thể chấp nhận lời mời kết bạn từ ${friend_uid}:`,
        response.data?.result?.message,
      );
      return {
        success: false,
        uid: friend_uid,
        message: response.data?.result?.message || "Không rõ lỗi",
      };
    }
  } catch (error) {
    console.error(
      `❌ Lỗi khi gọi API chấp nhận lời mời kết bạn từ ${friend_uid}:`,
      error?.response?.data || error.message,
    );
    return {
      success: false,
      uid: friend_uid,
      message: error?.response?.data || error.message,
    };
  }
};

const CELEB_GOAL_STATES = new Set([
  "friends",
  "outgoing-request",
  "outgoing-follow-request",
  "follower-waitlist",
]);

function normalizeRelationshipStatus(user) {
  const status = String(user?.friendship_status || "").trim().toLowerCase();
  return CELEB_GOAL_STATES.has(status) ? status : "";
}

async function getCelebrityRelationshipStatus(idToken, friendUid) {
  if (!idToken || !friendUid) return "";

  let username = "";
  try {
    const fetched = await instanceLocketV2.post(
      "fetchUserV2",
      { data: { user_uid: friendUid } },
      { meta: { idToken } },
    );
    const user = fetched?.data?.result?.data || null;
    const directStatus = normalizeRelationshipStatus(user);
    if (directStatus) return directStatus;
    username = String(user?.username || "").trim();
  } catch (error) {
    console.warn("[friends] celeb relationship fetchUserV2 check failed", {
      status: error?.response?.status || null,
      code: error?.code || null,
    });
  }

  if (!username) return "";

  try {
    const found = await instanceLocketV2.post(
      "getUserByUsername",
      {
        data: {
          username,
          analytics: createAnalytics(),
        },
      },
      { meta: { idToken } },
    );
    return normalizeRelationshipStatus(found?.data?.result?.data);
  } catch (error) {
    console.warn("[friends] celeb relationship username check failed", {
      status: error?.response?.status || null,
      code: error?.code || null,
    });
    return "";
  }
}

async function verifiedCelebrityRelationship(idToken, friendUid) {
  const relationship = await getCelebrityRelationshipStatus(idToken, friendUid);
  if (!relationship) return null;
  return {
    success: true,
    data: {
      verified: true,
      relationship,
    },
    uid: friendUid,
    relationship,
  };
}

const SendAddCelebrity = async (idToken, friend_uid, token) => {
  // Celeb follow uses a different relationship model from normal friend requests.
  // If a request is already pending/friends, do not spam another mutation just
  // because the slot monitor DB has not yet recorded SENT.
  const existing = await verifiedCelebrityRelationship(idToken, friend_uid);
  if (existing) {
    console.log("[friends] celebrity relationship already persisted", {
      uid: friend_uid,
      relationship: existing.relationship,
    });
    return {
      ...existing,
      alreadyPersisted: true,
    };
  }

  const body = {
    data: {
      celebrity_uid: friend_uid,
      intent: "add-friend",
      analytics: createAnalytics(),
    },
  };

  try {
    const response = await instanceLocketV2.post("sendFollowRequest", body, {
      meta: { idToken, appCheckToken: token },
    });
    const result = response.data?.result;
    if (result?.data === null || result?.data === undefined) {
      const persisted = await verifiedCelebrityRelationship(idToken, friend_uid);
      if (persisted) return persisted;
      return {
        success: false,
        status: 400,
        code: "UPSTREAM_REJECTED",
        message: "Locket không chấp nhận yêu cầu theo dõi.",
      };
    }

    return {
      success: true,
      data: result.data,
      uid: friend_uid,
    };
  } catch (error) {
    console.error("[friends] upstream sendFollowRequest failed", {
      status: error?.response?.status || null,
    });

    // The Axios interceptor may have already sent the mutation through Dio after
    // Locket rejected the direct call for missing App Check. Celeb follows are
    // represented by friendship_status, not necessarily by the normal
    // outgoing_friend_requests collection, so verify the real Locket relationship
    // before reporting a false failure.
    const persisted = await verifiedCelebrityRelationship(idToken, friend_uid);
    if (persisted) {
      console.log("[friends] celebrity request verified after upstream auth fallback", {
        uid: friend_uid,
        relationship: persisted.relationship,
      });
      return persisted;
    }

    return normalizeUpstreamFailure(
      error,
      "Không thể gửi yêu cầu theo dõi qua Locket.",
    );
  }
};

module.exports = {
  getAllFriendRequests,
  getAllFriendRequestsV2,
  getOutgoingFriendRequests,
  rejectOutgoingFriendRequest,
  rejectFriendRequest,
  SendToFriendRequest,
  AcceptToFriendRequest,
  SendAddCelebrity,
};
