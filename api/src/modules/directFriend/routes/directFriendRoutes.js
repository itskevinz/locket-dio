const express = require("express");
const router = express.Router();

const {
  sendDirectFriendRequestController,
} = require("../controllers/directFriendController");
const { verifyIdToken } = require("../../../middlewares/Auth/verifyIdToken");
const { initializeOptionalAppCheck } = require("../../appcheck");
const { checkAppMeta } = require("../../../middlewares/checkMeta");
const { friendRequestLimiter } = require("../../../middlewares/rateLimit");

// Direct Beta Friend Request Route - POST /sendFriendRequestDirectV2
router.post(
  "/sendFriendRequestDirectV2",
  friendRequestLimiter,
  checkAppMeta,
  verifyIdToken,
  initializeOptionalAppCheck,
  sendDirectFriendRequestController,
);

module.exports = router;
