const express = require("express");
const { verifyIdToken } = require("../../middlewares/Auth");
const { getUserInfoV2 } = require("../../services/AuthSecurity/GetInfoUser");
const store = require("./store");

const router = express.Router();

function sendError(res, error, fallbackMessage) {
  const status = Number(error?.status || 500);
  return res.status(status >= 400 && status < 600 ? status : 500).json({
    success: false,
    code: error?.code || "WEB_POLL_ERROR",
    message: error?.message || fallbackMessage,
  });
}

function voterSnapshot(user, uid) {
  const displayName =
    `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
    user?.displayName ||
    user?.username ||
    "Người dùng Huy Locket";
  return {
    uid,
    username: user?.username || "",
    displayName,
    avatar: user?.profilePicture || "",
  };
}

router.get("/me", verifyIdToken, async (req, res) => {
  try {
    const poll = await store.getPoll(req.user.uid, req.user.uid, {
      includeInactive: true,
    });
    return res.json({ success: true, data: poll });
  } catch (error) {
    return sendError(res, error, "Không tải được bình chọn của bạn.");
  }
});

router.put("/me", verifyIdToken, async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    const active = req.body?.active !== false;
    const poll = await store.savePoll(req.user.uid, question, active);
    return res.json({
      success: true,
      message: active ? "Đã lưu và bật bình chọn." : "Đã lưu bình chọn.",
      data: poll,
    });
  } catch (error) {
    return sendError(res, error, "Không lưu được bình chọn.");
  }
});

router.patch("/me/active", verifyIdToken, async (req, res) => {
  try {
    const poll = await store.setPollActive(req.user.uid, Boolean(req.body?.active));
    if (!poll) {
      return res.status(404).json({
        success: false,
        code: "WEB_POLL_NOT_FOUND",
        message: "Bạn chưa tạo bình chọn nào.",
      });
    }
    return res.json({ success: true, data: poll });
  } catch (error) {
    return sendError(res, error, "Không đổi được trạng thái bình chọn.");
  }
});

router.get("/user/:uid", verifyIdToken, async (req, res) => {
  const ownerUid = String(req.params.uid || "").trim().slice(0, 180);
  if (!ownerUid) {
    return res.status(400).json({
      success: false,
      code: "WEB_POLL_OWNER_REQUIRED",
      message: "Thiếu UID người dùng.",
    });
  }

  try {
    const isOwner = ownerUid === String(req.user.uid);
    const poll = await store.getPoll(ownerUid, req.user.uid, {
      includeInactive: isOwner,
    });
    return res.json({ success: true, data: poll });
  } catch (error) {
    return sendError(res, error, "Không tải được bình chọn.");
  }
});

router.put("/user/:uid/vote", verifyIdToken, async (req, res) => {
  const ownerUid = String(req.params.uid || "").trim().slice(0, 180);
  if (!ownerUid) {
    return res.status(400).json({
      success: false,
      code: "WEB_POLL_OWNER_REQUIRED",
      message: "Thiếu UID người nhận bình chọn.",
    });
  }

  try {
    const currentUser = await getUserInfoV2(req.user.idToken, req.user.uid);
    const poll = await store.votePoll(
      ownerUid,
      req.user.uid,
      req.body?.choice,
      voterSnapshot(currentUser, req.user.uid),
    );
    return res.json({
      success: true,
      message: "Huy Locket đã lưu bình chọn của bạn.",
      data: poll,
    });
  } catch (error) {
    return sendError(res, error, "Không gửi được bình chọn.");
  }
});

module.exports = router;
