import api from "@/libs/axios";

const NORMAL_CONFIRMED_RELATIONSHIPS = new Set([
  "friends",
  "outgoing-request",
]);

const CELEBRITY_CONFIRMED_RELATIONSHIPS = new Set([
  ...NORMAL_CONFIRMED_RELATIONSHIPS,
  "outgoing-follow-request",
]);

const normalizeRelationship = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/^friend$/, "friends");

const requireVerifiedSendResponse = (payload, { celebrity = false } = {}) => {
  if (!payload?.success) return payload;

  const data = payload?.data;
  const relationship = normalizeRelationship(data?.relationship);
  const confirmedRelationships = celebrity
    ? CELEBRITY_CONFIRMED_RELATIONSHIPS
    : NORMAL_CONFIRMED_RELATIONSHIPS;

  if (data?.verified === true && confirmedRelationships.has(relationship)) {
    return {
      ...payload,
      data: {
        ...data,
        relationship,
      },
    };
  }

  console.warn("[friends] backend returned an unverified success response", {
    celebrity,
    relationship: relationship || null,
    verified: data?.verified === true,
  });

  return {
    success: false,
    status: 502,
    code: "REQUEST_NOT_CONFIRMED",
    message: celebrity
      ? "Locket chưa xác nhận request Celeb. Web không tính trạng thái chờ/xếp hàng là gửi thành công."
      : "Locket chưa xác nhận lời mời kết bạn. Web không báo thành công khi trạng thái chưa được ghi nhận.",
    data: {
      ...(data && typeof data === "object" ? data : {}),
      verified: false,
      relationship: relationship || null,
    },
  };
};

export const getAllRequestFriend = async (pageToken = null, limit = 100) => {
  try {
    const res = await api.post("/locket/getAllRequestsV2", {
      pageToken,
      limit,
    });

    const { success, message, data, nextPageToken } = res.data;

    if (!success) {
      return {
        friends: [],
        nextPageToken: null,
        errorMessage: message || "Lỗi khi lấy danh sách lời mời",
      };
    }

    const cleanedFriends = (data || []).map((friend) => ({
      uid: friend.uid,
      createdAt: friend.date,
    }));

    return {
      friends: cleanedFriends,
      nextPageToken: nextPageToken || null,
      errorMessage: null,
    };
  } catch (err) {
    console.error("❌ Lỗi khi gọi API getListRequestFriend:", err);

    const errorMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err.message ||
      "Lỗi không xác định";

    return {
      friends: [],
      nextPageToken: null,
      errorMessage,
    };
  }
};

export const getListRequestFriendV2 = async (pageToken = null, limit = 10) => {
  try {
    const res = await api.post("/locket/getIncomingFriendRequestsV2", {
      pageToken,
      limit,
    });

    const { success, message, data, nextPageToken } = res.data;

    if (!success) {
      return {
        friends: [],
        nextPageToken: null,
        errorMessage: message || "Lỗi khi lấy danh sách lời mời",
      };
    }

    const cleanedFriends = (data || []).map((friend) => ({
      uid: friend.uid,
      createdAt: friend.date,
    }));

    return {
      friends: cleanedFriends,
      nextPageToken: nextPageToken || null,
      errorMessage: null,
    };
  } catch (err) {
    console.error("❌ Lỗi khi gọi API getListRequestFriend:", err);

    const errorMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err.message ||
      "Lỗi không xác định";

    return {
      friends: [],
      nextPageToken: null,
      errorMessage,
    };
  }
};

export const getOutgoingRequestFriend = async (
  pageToken = null,
  limit = 100,
) => {
  try {
    const res = await api.post("/locket/getOutgoingFriendRequestsV2", {
      pageToken,
      limit,
    });

    const { success, message, data, nextPageToken } = res.data;

    if (!success) {
      return {
        friends: [],
        nextPageToken: null,
        errorMessage: message || "Lỗi khi lấy danh sách lời mời",
      };
    }

    const cleanedFriends = (data || []).map((friend) => ({
      uid: friend.to,
      createdAt: friend.date,
    }));

    return {
      friends: cleanedFriends,
      nextPageToken: nextPageToken || null,
      errorMessage: null,
    };
  } catch (err) {
    console.error("❌ Lỗi khi gọi API getListRequestFriend:", err);

    const errorMessage =
      err?.response?.data?.message ||
      err?.response?.data?.error ||
      err.message ||
      "Lỗi không xác định";

    return {
      friends: [],
      nextPageToken: null,
      errorMessage,
    };
  }
};

export const SendRequestToFriend = async (uid) => {
  try {
    const response = await api.post("locket/sendFriendRequestV2", {
      data: { friendUid: uid },
    });

    return requireVerifiedSendResponse(response.data, { celebrity: false });
  } catch (error) {
    console.error("[friends] send request failed", {
      status: error?.response?.status || null,
      code: error?.response?.data?.code || error?.code || null,
    });
    throw error;
  }
};

export const SendRequestToCelebrity = async (uid) => {
  try {
    const response = await api.post("locket/sendCelebrityRequestV2", {
      friendUid: uid,
    });
    return requireVerifiedSendResponse(response.data, { celebrity: true });
  } catch (error) {
    console.error("[friends] send celebrity request failed", {
      status: error?.response?.status || null,
      code: error?.response?.data?.code || error?.code || null,
    });
    throw error;
  }
};
