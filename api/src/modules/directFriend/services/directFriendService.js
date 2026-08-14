const { instanceLocketDirect } = require("../../../libs/instanceLocketDirect");

const RELATIONSHIP_VERIFY_DELAYS_MS = [0, 250, 700, 1400];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeRelationshipValue(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "friends":
    case "friend":
      return "FRIENDS";
    case "outgoing-request":
    case "outgoing_request":
    case "outgoing":
    case "outgoing-follow-request":
    case "follower-waitlist":
      return "OUTGOING";
    case "incoming-request":
    case "incoming_request":
    case "incoming":
      return "INCOMING";
    case "none":
    case "":
      return "NONE";
    default:
      return "NONE";
  }
}

function mapReadError(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  const err = new Error(error?.message || "Read relationship failed");
  if (status === 401 || status === 403) {
    err.status = status;
    err.code = "UPSTREAM_AUTH_FAILED";
    err.message = "Phiên đăng nhập không hợp lệ hoặc đã hết hạn.";
  } else if (status === 404) {
    err.status = 404;
    err.code = "USER_NOT_FOUND";
    err.message = "Người dùng không tồn tại.";
  } else if (status === 429) {
    err.status = 429;
    err.code = "RATE_LIMITED";
    err.message = "Quá nhiều yêu cầu. Vui lòng thử lại sau.";
  } else {
    err.status = status || 502;
    err.code = "UPSTREAM_ERROR";
    err.message = "Không thể kết nối đến máy chủ Locket.";
  }
  return err;
}

async function getDirectRelationshipStatus({
  idToken,
  friendUid,
  client = instanceLocketDirect,
}) {
  if (!idToken || !friendUid) return "NONE";

  let username = "";
  try {
    const fetched = await client.post(
      "fetchUserV2",
      { data: { user_uid: friendUid } },
      { meta: { idToken } },
    );
    const user = fetched?.data?.result?.data || null;
    const directStatus = normalizeRelationshipValue(user?.friendship_status);
    if (directStatus !== "NONE") return directStatus;
    username = String(user?.username || "").trim();
  } catch (error) {
    throw mapReadError(error);
  }

  if (username) {
    try {
      const found = await client.post(
        "getUserByUsername",
        { data: { username } },
        { meta: { idToken } },
      );
      const user = found?.data?.result?.data;
      const status = normalizeRelationshipValue(user?.friendship_status);
      if (status !== "NONE") return status;
    } catch (error) {
      throw mapReadError(error);
    }
  }

  return "NONE";
}

async function waitForVerifiedDirectRelationship({
  idToken,
  friendUid,
  client = instanceLocketDirect,
  delays = RELATIONSHIP_VERIFY_DELAYS_MS,
}) {
  let lastError = null;
  for (const delayMs of delays) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const status = await getDirectRelationshipStatus({
        idToken,
        friendUid,
        client,
      });
      lastError = null;
      if (status === "FRIENDS" || status === "OUTGOING") {
        return { status, error: null };
      }
    } catch (error) {
      lastError = error;
    }
  }
  return { status: "NONE", error: lastError };
}

async function SendToFriendRequestDirect({
  idToken,
  friendUid,
  appcheckToken = null,
  appCheckToken = null,
  client = instanceLocketDirect,
  delays = RELATIONSHIP_VERIFY_DELAYS_MS,
}) {
  const effectiveAppCheck = appcheckToken || appCheckToken || null;

  if (!idToken || !friendUid) {
    return {
      success: false,
      status: 400,
      code: "INVALID_REQUEST",
      message: "Thiếu thông tin người dùng hoặc idToken.",
      data: null,
    };
  }

  // 1. Preflight check: If read fails, return error and DO NOT run mutation.
  let preflightStatus = "NONE";
  try {
    preflightStatus = await getDirectRelationshipStatus({
      idToken,
      friendUid,
      client,
    });
  } catch (err) {
    return {
      success: false,
      status: err?.status || 502,
      code: err?.code || "UPSTREAM_ERROR",
      message: err?.message || "Không thể kiểm tra quan hệ bạn bè.",
      data: null,
    };
  }

  if (preflightStatus === "FRIENDS" || preflightStatus === "OUTGOING") {
    return {
      success: true,
      uid: friendUid,
      relationship: preflightStatus,
      sentNow: false,
      alreadyPersisted: true,
      data: {
        verified: true,
        relationship: preflightStatus,
        sentNow: false,
        alreadyPersisted: true,
      },
    };
  }

  // 2. Perform Mutation with standard Locket payload
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
    await client.post("sendFriendRequest", body, {
      meta: {
        idToken,
        appCheckToken: effectiveAppCheck,
      },
    });
  } catch (error) {
    const errorStatus = Number(error?.response?.status || error?.status || 502);

    if (errorStatus === 401 || errorStatus === 403) {
      return {
        success: false,
        status: errorStatus,
        code: "UPSTREAM_AUTH_FAILED",
        message: "Không thể xác thực với Locket khi gửi lời mời kết bạn.",
        data: null,
      };
    }
    if (errorStatus === 404) {
      return {
        success: false,
        status: 404,
        code: "USER_NOT_FOUND",
        message: "Người dùng không tồn tại.",
        data: null,
      };
    }
    if (errorStatus === 409) {
      return {
        success: false,
        status: 409,
        code: "REQUEST_CONFLICT",
        message: "Yêu cầu kết bạn bị xung đột.",
        data: null,
      };
    }
    if (errorStatus === 429) {
      return {
        success: false,
        status: 429,
        code: "RATE_LIMITED",
        message: "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
        data: null,
      };
    }

    // On other errors (e.g. gateway/timeout), best-effort check if relationship formed anyway
    try {
      const verifyResult = await waitForVerifiedDirectRelationship({
        idToken,
        friendUid,
        client,
        delays,
      });
      if (
        verifyResult?.status === "FRIENDS" ||
        verifyResult?.status === "OUTGOING"
      ) {
        return {
          success: true,
          uid: friendUid,
          relationship: verifyResult.status,
          sentNow: true,
          alreadyPersisted: false,
          data: {
            verified: true,
            relationship: verifyResult.status,
            sentNow: true,
            alreadyPersisted: false,
          },
        };
      }
    } catch {
      // Best-effort check failed
    }

    return {
      success: false,
      status: errorStatus,
      code: "UPSTREAM_ERROR",
      message: "Không thể gửi lời mời kết bạn qua Locket Direct.",
      data: null,
    };
  }

  // 3. Post-mutation relationship verification (when mutation returned 200)
  const verifyResult = await waitForVerifiedDirectRelationship({
    idToken,
    friendUid,
    client,
    delays,
  });

  if (verifyResult?.error) {
    return {
      success: false,
      status: verifyResult.error.status || 502,
      code: verifyResult.error.code || "UPSTREAM_ERROR",
      message:
        verifyResult.error.message ||
        "Không thể xác minh trạng thái lời mời từ Locket.",
      data: null,
    };
  }

  if (
    verifyResult?.status === "FRIENDS" ||
    verifyResult?.status === "OUTGOING"
  ) {
    return {
      success: true,
      uid: friendUid,
      relationship: verifyResult.status,
      sentNow: true,
      alreadyPersisted: false,
      data: {
        verified: true,
        relationship: verifyResult.status,
        sentNow: true,
        alreadyPersisted: false,
      },
    };
  }

  // If HTTP 200 from mutation but verify read succeeded and found NONE -> REQUEST_NOT_CONFIRMED!
  return {
    success: false,
    status: 502,
    code: "REQUEST_NOT_CONFIRMED",
    message:
      "Locket đã phản hồi nhưng chưa ghi nhận lời mời. Hệ thống không báo thành công để tránh sai trạng thái.",
    data: null,
  };
}

module.exports = {
  normalizeRelationshipValue,
  getDirectRelationshipStatus,
  waitForVerifiedDirectRelationship,
  SendToFriendRequestDirect,
  sendDirectFriendRequest: SendToFriendRequestDirect,
};
