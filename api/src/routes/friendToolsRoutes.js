const express = require("express");
const QRCode = require("qrcode");
const { verifyIdToken } = require("../middlewares/Auth");
const { getUserInfoV2 } = require("../services/AuthSecurity/GetInfoUser");
const {
  blockUser,
  unblockUser,
  getBlockedUsers,
} = require("../services/LocketFriend/BlockServices");

const router = express.Router();

function safeTargetUid(req) {
  return String(req.body?.uid || req.body?.userUid || "").trim().slice(0, 160);
}

function sendActionError(res, error, fallbackCode, fallbackMessage) {
  const status = Number(error?.status || error?.response?.status || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    code: error?.code || fallbackCode,
    message:
      error?.response?.data?.message ||
      error?.message ||
      fallbackMessage,
  });
}

router.post("/blockFriendV2", verifyIdToken, async (req, res) => {
  const uid = safeTargetUid(req);
  if (!uid) {
    return res.status(400).json({
      success: false,
      code: "INVALID_BLOCK_TARGET",
      message: "Thiếu UID tài khoản cần block.",
    });
  }

  try {
    const result = await blockUser(req.user.idToken, req.user.uid, uid);
    return res.json({
      success: true,
      message: "Locket đã xác nhận block tài khoản.",
      data: result,
    });
  } catch (error) {
    console.warn("[friends] block failed", {
      userUid: req.user.uid,
      targetUid: uid,
      code: error?.code || null,
      status: error?.status || error?.response?.status || null,
    });
    return sendActionError(
      res,
      error,
      "BLOCK_FAILED",
      "Không block được tài khoản này trên Locket.",
    );
  }
});

router.post("/unblockFriendV2", verifyIdToken, async (req, res) => {
  const uid = safeTargetUid(req);
  if (!uid) {
    return res.status(400).json({
      success: false,
      code: "INVALID_UNBLOCK_TARGET",
      message: "Thiếu UID tài khoản cần unblock.",
    });
  }

  try {
    const result = await unblockUser(req.user.idToken, req.user.uid, uid);
    return res.json({
      success: true,
      message: "Locket đã xác nhận unblock tài khoản.",
      data: result,
    });
  } catch (error) {
    console.warn("[friends] unblock failed", {
      userUid: req.user.uid,
      targetUid: uid,
      code: error?.code || null,
      status: error?.status || error?.response?.status || null,
    });
    return sendActionError(
      res,
      error,
      "UNBLOCK_FAILED",
      "Không unblock được tài khoản này trên Locket.",
    );
  }
});

router.get("/getBlockedUsersV2", verifyIdToken, async (req, res) => {
  try {
    const result = await getBlockedUsers(req.user.idToken, req.user.uid);
    return res.json({
      success: true,
      data: result.users,
      meta: {
        count: result.users.length,
        source: result.source,
        authoritative: result.authoritative,
      },
    });
  } catch (error) {
    console.warn("[friends] blocked list failed", {
      userUid: req.user.uid,
      code: error?.code || null,
      status: error?.status || error?.response?.status || null,
    });
    return sendActionError(
      res,
      error,
      "BLOCKED_LIST_FAILED",
      "Không lấy được danh sách tài khoản đã block từ Locket.",
    );
  }
});

router.get("/getLocketQrV2", verifyIdToken, async (req, res) => {
  try {
    const user = await getUserInfoV2(req.user.idToken, req.user.uid);
    const inviteToken = String(user?.inviteToken || "").trim();
    if (!user || !inviteToken) {
      return res.status(404).json({
        success: false,
        code: "LOCKET_INVITE_TOKEN_MISSING",
        message: "Tài khoản Locket hiện chưa có invite token để tạo QR.",
      });
    }

    const inviteUrl = `https://locket.camera/invites/${encodeURIComponent(
      inviteToken,
    )}?type=UsernameLink`;
    const qrDataUrl = await QRCode.toDataURL(inviteUrl, {
      width: 720,
      margin: 2,
      errorCorrectionLevel: "M",
    });

    return res.json({
      success: true,
      data: {
        inviteUrl,
        qrDataUrl,
        username: user.username || "",
        displayName:
          `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
          user.displayName ||
          user.username ||
          "Locket",
        profilePicture: user.profilePicture || "",
      },
    });
  } catch (error) {
    console.warn("[friends] Locket QR failed", {
      userUid: req.user.uid,
      code: error?.code || null,
    });
    return sendActionError(
      res,
      error,
      "LOCKET_QR_FAILED",
      "Không tạo được Locket QR lúc này.",
    );
  }
});

module.exports = router;
