const {
  SendToFriendRequestDirect,
} = require("../services/directFriendService");

const sendDirectFriendRequestController = async (req, res, next) => {
  const idToken = req.user?.idToken;
  const localId = req.user?.localId || req.user?.uid;
  const friendUid = req.body?.friendUid || req.body?.data?.friendUid;
  const appcheckToken = req.appcheck?.token || null;

  try {
    if (!idToken || !friendUid) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REQUEST",
        message: "Thiếu người dùng cần kết bạn.",
        data: null,
      });
    }

    if (String(localId) === String(friendUid)) {
      return res.status(400).json({
        success: false,
        code: "SELF_REQUEST",
        message: "Bạn không thể tự kết bạn với mình.",
        data: null,
      });
    }

    const responseData = await SendToFriendRequestDirect({
      idToken,
      friendUid,
      appcheckToken,
    });

    if (responseData?.success) {
      return res.status(200).json({
        success: true,
        message: "ok",
        data: responseData.data,
        relationship: responseData.relationship,
        sentNow: responseData.sentNow,
        alreadyPersisted: responseData.alreadyPersisted,
      });
    }

    const status = [400, 401, 403, 404, 409, 429].includes(
      responseData?.status,
    )
      ? responseData.status
      : 502;

    return res.status(status).json({
      success: false,
      code: responseData?.code || "UPSTREAM_ERROR",
      message:
        responseData?.message ||
        "Không thể gửi lời mời kết bạn qua kênh Direct.",
      data: null,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendDirectFriendRequestController,
};
