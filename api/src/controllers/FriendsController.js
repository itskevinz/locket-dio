const { friendservices, requestservices } = require("../services");
const { logUserAction } = require("../services/DioServices/DioSecurity");
const { logInfo, logError, logSuccess } = require("../utils/logEventUtils");

// Controller xử lý lấy danh sách bạn bè
const getFriendsController = async (req, res, next) => {
  const { idToken, localId } = req.user;

  logInfo("getFriendController", `📩 Nhận yêu cầu lấy ds bạn bè - ${localId}`);

  try {
    // Gọi hàm xử lý profile
    const responseData = await friendservices.getAllFriends(idToken, localId);

    logSuccess("getFriendController", "✅ Lấy ds bạn bè thành công!");

    res.status(200).json({
      success: true,
      message: "Lấy ds bạn bè thành công!",
      data: responseData,
    });
  } catch (error) {
    logError("getFriendController", "❌ Lỗi khi get ds bạn bè", error.message);
    next(error);
  }
};

const getFriendsRequestController = async (req, res, next) => {
  const { idToken, localId } = req.user;
  const { nextPageToken, limit } = req.body;

  const finalLimit = typeof limit === "number" && limit > 0 ? limit : 10;

  logInfo(
    "getFriendsRequestController",
    "📩 Nhận yêu cầu lấy danh sách lời mời kết bạn",
  );

  try {
    // Gọi service để lấy danh sách lời mời
    const responseData = await requestservices.getAllFriendRequests(
      idToken,
      localId,
      nextPageToken,
      finalLimit,
    );

    logInfo(
      "getFriendsRequestController",
      "✅ Lấy danh sách lời mời thành công",
    );

    res.status(200).json({
      success: true,
      message: "ok",
      data: responseData?.data,
      nextPageToken: responseData?.nextPageToken,
    });
  } catch (error) {
    logError(
      "getFriendsRequestController",
      "❌ Lỗi khi lấy danh sách lời mời kết bạn",
      error?.message || error,
    );
    next(error);
  }
};

const getFriendsRequestControllerV2 = async (req, res, next) => {
  const { idToken, localId } = req.user;
  const { nextPageToken, limit } = req.body;

  const finalLimit = typeof limit === "number" && limit > 0 ? limit : 10;

  logInfo(
    "getFriendsRequestController",
    "📩 Nhận yêu cầu lấy danh sách lời mời kết bạn",
  );

  try {
    // Gọi service để lấy danh sách lời mời
    const responseData = await requestservices.getAllFriendRequestsV2(
      idToken,
      localId,
      nextPageToken,
      finalLimit,
    );

    logInfo(
      "getFriendsRequestController",
      "✅ Lấy danh sách lời mời thành công",
    );

    res.status(200).json({
      success: true,
      message: "ok",
      data: responseData?.data,
      nextPageToken: responseData?.nextPageToken,
    });
  } catch (error) {
    logError(
      "getFriendsRequestController",
      "❌ Lỗi khi lấy danh sách lời mời kết bạn",
      error?.message || error,
    );
    next(error);
  }
};

const getOutgoingRequestsController = async (req, res, next) => {
  const { idToken, localId } = req.user;
  const { nextPageToken, limit } = req.body;

  const finalLimit = typeof limit === "number" && limit > 0 ? limit : 10;

  logInfo(
    "getOutgoingRequestsController",
    "📤 Nhận yêu cầu lấy danh sách lời mời kết bạn đã gửi",
  );

  try {
    // Gọi service để lấy danh sách lời mời đã gửi (outgoing)
    const responseData = await requestservices.getOutgoingFriendRequests(
      idToken,
      localId,
      nextPageToken,
      finalLimit,
    );

    logInfo(
      "getOutgoingRequestsController",
      "✅ Lấy danh sách lời mời đã gửi thành công",
    );

    res.status(200).json({
      success: true,
      message: "ok",
      data: responseData?.data,
      nextPageToken: responseData?.nextPageToken,
    });
  } catch (error) {
    logError(
      "getOutgoingRequestsController",
      "❌ Lỗi khi lấy danh sách lời mời đã gửi",
      error?.message || error,
    );
    next(error);
  }
};

// Controller xử lý xoá lời mời kết bạn với uid nhận được
const deleteFriendsRequestController = async (req, res, next) => {
  logInfo(
    "deleteFriendsRequestController",
    "📩 Nhận yêu cầu xoá danh sách lời mời",
  );
  const { uids } = req.body;
  const { idToken } = req.user;

  try {
    // Gọi hàm xử lý logic xóa
    const responseData = await requestservices.rejectFriendRequest(
      idToken,
      uids,
    );

    logSuccess(
      "deleteFriendsRequestController",
      "✅ Xoá danh sách lời mời thành công!",
    );
    res.status(200).json({
      success: true,
      message: "Đã xoá danh sách lời mời thành công!",
      data: responseData,
    });
  } catch (error) {
    logError(
      "deleteFriendsRequestController",
      "❌ Lỗi khi xoá danh sách lời mời",
      error.message,
    );
    next(error);
  }
};

const deleteOutgingRequestController = async (req, res, next) => {
  logInfo(
    "deleteFriendsRequestController",
    "📩 Nhận yêu cầu xoá danh sách lời mời",
  );
  const { uid } = req.body;
  const { idToken } = req.user;

  try {
    // Gọi hàm xử lý logic xóa
    const responseData = await requestservices.rejectOutgoingFriendRequest(
      idToken,
      uid,
    );

    logSuccess(
      "deleteFriendsRequestController",
      "✅ Xoá danh sách lời mời thành công!",
    );
    res.status(200).json({
      success: true,
      message: "Đã xoá danh sách lời mời thành công!",
      data: responseData,
    });
  } catch (error) {
    logError(
      "deleteFriendsRequestController",
      "❌ Lỗi khi xoá danh sách lời mời",
      error.message,
    );
    next(error);
  }
};

//Controller xử lý xoá bạn bè với uid nhân được
const deleteFriendsController = async (req, res, next) => {
  logInfo("deleteFriendsController", "📩 Nhận yêu cầu xoá bạn bè");
  const { idToken } = req.user;
  const { uid } = req.body;
  console.log(req.body);

  try {
    if (!idToken || !uid) {
      throw new Error("Thiếu idToken hoặc uid");
    }

    const responseData = await friendservices.removeFriend(idToken, uid);
    // logInfo(responseData)
    if (responseData.success) {
      logInfo("deleteFriendsController", `✅ Đã xoá bạn: ${uid}`);
      res.status(200).json({
        success: true,
        message: responseData.message || "✅ Xoá bạn thành công",
        data: responseData.uid,
      });
    } else {
      logInfo("deleteFriendsController", `❌ Không xoá được bạn: ${uid}`);
      res.status(400).json({
        success: false,
        message: responseData.message || "❌ Xoá bạn thất bại",
        data: null,
      });
    }
  } catch (error) {
    logError("deleteFriendsController", "❌ Lỗi khi xoá bạn", error.message);
    next(error);
  }
};

const SendRequestToFriendsController = async (req, res, next) => {
  logInfo("SendRequestToFriends", "📩 Nhận yêu cầu gửi lời mời bạn bè");
  const { idToken } = req.user;
  const token = req.appcheck?.token;

  try {
    const friendUid = req.body?.data?.friendUid;
    if (!idToken || !friendUid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REQUEST",
        message: "Thiếu người dùng cần kết bạn.",
      });
    }

    if (String(req.user.localId) === String(friendUid)) {
      return res.status(400).json({
        success: false,
        code: "SELF_REQUEST",
        message: "Bạn không thể tự kết bạn với mình.",
      });
    }

    const responseData = await requestservices.SendToFriendRequest({
      idToken,
      friendUid,
      appcheckToken: token,
    });
    if (responseData?.success) {
      logInfo(
        "SendRequestToFriends",
        responseData?.data?.sentNow
          ? `✅ Đã gửi và xác nhận kết bạn tới: ${friendUid}`
          : `✅ Quan hệ kết bạn đã tồn tại với: ${friendUid}`,
      );
      return res.status(200).json({
        success: true,
        message: "ok",
        data: responseData.data,
      });
    }

    const status = [400, 401, 403, 404, 409, 429].includes(responseData?.status)
      ? responseData.status
      : 502;
    return res.status(status).json({
      success: false,
      code: responseData?.code || "UPSTREAM_ERROR",
      message: responseData?.message || "Không thể gửi lời mời kết bạn.",
      data: null,
    });
  } catch (error) {
    logError("SendRequestToFriends", "❌ Lỗi khi gửi kết bạn", error.message);
    next(error);
  }
};

const SendRequestToCelebrityController = async (req, res, next) => {
  logInfo(
    "SendRequestToCelebrityController",
    "📩 Nhận yêu cầu gửi lời mời bạn bè",
  );
  const { idToken } = req.user;
  const friendUid = req.body?.friendUid;
  const token = req.appcheck?.token;

  try {
    if (!idToken || !friendUid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REQUEST",
        message: "Thiếu người dùng cần theo dõi.",
      });
    }

    if (String(req.user.localId) === String(friendUid)) {
      return res.status(400).json({
        success: false,
        code: "SELF_REQUEST",
        message: "Bạn không thể tự kết bạn với mình.",
      });
    }

    const responseData = await requestservices.SendAddCelebrity(
      idToken,
      friendUid,
      token,
    );
    if (responseData?.success) {
      logInfo(
        "SendRequestToCelebrityController",
        responseData?.data?.sentNow
          ? `✅ Đã gửi và xác nhận request Celeb tới: ${friendUid}`
          : `✅ Quan hệ/request Celeb đã tồn tại với: ${friendUid}`,
      );
      return res.status(200).json({
        success: true,
        message: "ok",
        data: responseData.data,
      });
    }

    const status = [400, 401, 403, 404, 409, 429].includes(responseData?.status)
      ? responseData.status
      : 502;
    return res.status(status).json({
      success: false,
      code: responseData?.code || "UPSTREAM_ERROR",
      message: responseData?.message || "Không thể gửi yêu cầu theo dõi.",
      data: null,
    });
  } catch (error) {
    logError(
      "SendRequestToCelebrityController",
      "❌ Lỗi khi gửi kết bạn",
      error.message,
    );
    next(error);
  }
};

const AcceptFriendsController = async (req, res, next) => {
  logInfo(
    "acceptFriendController",
    "📩 Nhận yêu cầu chấp nhận lời mời kết bạn",
  );

  const { idToken } = req.user;
  const { uid } = req.body;

  try {
    if (!idToken || !uid) {
      throw new Error("Thiếu idToken hoặc uid");
    }

    const responseData = await friendservices.AcceptToFriend(idToken, uid);

    if (responseData.success) {
      logInfo("acceptFriendController", `✅ Đã chấp nhận lời mời từ: ${uid}`);
      res.status(200).json({
        success: true,
        message:
          responseData.message || "✅ Chấp nhận lời mời kết bạn thành công",
        data: responseData.uid,
      });
    } else {
      logInfo(
        "acceptFriendController",
        `❌ Không thể chấp nhận lời mời từ: ${uid}`,
      );
      res.status(400).json({
        success: false,
        message:
          responseData.message || "❌ Chấp nhận lời mời kết bạn thất bại",
        data: null,
      });
    }
  } catch (error) {
    logError(
      "acceptFriendController",
      "❌ Lỗi khi chấp nhận lời mời",
      error.message,
    );
    next(error);
  }
};

const getUserController = async (req, res, next) => {
  logInfo("getUserController", "📩 Nhận yêu cầu tìm người dùng");

  try {
    const { idToken } = req.user;
    const rawUsername = req.body?.username;
    const link = req.body?.link;
    const username =
      typeof rawUsername === "string"
        ? rawUsername.trim().replace(/^@/, "").trim()
        : "";

    if (!idToken) {
      return res.status(401).json({
        success: false,
        message: "Thiếu idToken",
        data: null,
      });
    }

    if (!username && !link) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REQUEST",
        message: "Cần cung cấp username hoặc link",
        data: null,
      });
    }

    if (username.length > 64) {
      return res.status(400).json({
        success: false,
        code: "INVALID_USERNAME",
        message: "Username không hợp lệ.",
        data: null,
      });
    }

    let result;

    if (username) {
      result = await friendservices.FindFriendByUserName(idToken, username);
    } else if (link) {
      // result = await friendservices.resolveLink(
      //   idToken,
      //   link
      // );
    }

    if (result?.status === 404 || !result || !result?.data || Object.keys(result?.data || {}).length === 0) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Người dùng không tồn tại hoặc không tìm thấy.",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      message: "ok",
      data: result?.data,
    });
  } catch (error) {
    logError("getUserController", "❌ Lỗi khi tìm người dùng", error.message);
    const upstreamStatus = Number(error?.response?.status);
    const upstreamData = error?.response?.data;
    const errMsg = String(
      upstreamData?.message || upstreamData?.error?.message || upstreamData?.error || error.message || ""
    ).toLowerCase();

    if (
      upstreamStatus === 404 ||
      upstreamStatus === 400 ||
      errMsg.includes("not found") ||
      errMsg.includes("exist") ||
      errMsg.includes("no user") ||
      errMsg.includes("không tồn tại")
    ) {
      return res.status(404).json({
        success: false,
        code: "USER_NOT_FOUND",
        message: "Người dùng không tồn tại hoặc không tìm thấy.",
        data: null,
      });
    }

    if (upstreamStatus === 429) {
      return res.status(429).json({
        success: false,
        code: "RATE_LIMITED",
        message: "Bạn tìm kiếm quá nhanh. Vui lòng thử lại sau.",
        data: null,
      });
    }
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      return res.status(401).json({
        success: false,
        code: "UPSTREAM_AUTH_FAILED",
        message: "Không thể xác thực với máy chủ. Vui lòng thử lại.",
        data: null,
      });
    }

    return res.status(502).json({
      success: false,
      code: "UPSTREAM_ERROR",
      message: "Lỗi kết nối máy chủ hoặc dịch vụ đang bận. Vui lòng thử lại sau.",
      data: null,
    });
  }
};

module.exports = {
  getFriendsController,
  getFriendsRequestController,
  getFriendsRequestControllerV2,
  getOutgoingRequestsController,
  deleteFriendsRequestController,
  deleteOutgingRequestController,
  deleteFriendsController,
  SendRequestToFriendsController,
  AcceptFriendsController,
  SendRequestToCelebrityController,
  getUserController,
};
