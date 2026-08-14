const express = require("express");
const router = express.Router();

const { messageControll, friendcontroll, momentcontroll } = require("../controllers");
const { logRequestInfo } = require("../middlewares/logRequestInfo");
const { verifyIdToken, verifyplanAuth, verifyDioToken, onlyMemberCheck } = require("../middlewares/Auth");
const { checkAppMeta } = require("../middlewares/checkMeta");
const { initializeAppCheck } = require("../modules/appcheck");
const { validateOverlayType } = require("../middlewares/validateOverlayType");
const { instanceLocketV2 } = require("../libs/instanceLocket");
const { sniffRollcallMediaType } = require("../utils/rollcallMediaType");
const {
  friendRequestLimiter,
  friendSearchLimiter,
} = require("../middlewares/rateLimit");

function isAllowedRollcallMediaUrl(urlValue) {
  try {
    const url = new URL(String(urlValue || ""));
    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();
    return (
      host === "firebasestorage.googleapis.com" ||
      host === "storage.googleapis.com" ||
      host.endsWith(".googleapis.com") ||
      host.endsWith(".googleusercontent.com") ||
      host === "cdn.locketcamera.com" ||
      host.endsWith(".locketcamera.com")
    );
  } catch {
    return false;
  }
}

async function fetchRollcallMediaWithRedirects(mediaUrl, idToken) {
  let currentUrl = mediaUrl;

  for (let hop = 0; hop <= 3; hop += 1) {
    if (!isAllowedRollcallMediaUrl(currentUrl)) {
      const error = new Error("Blocked Rollcall media host");
      error.statusCode = 400;
      throw error;
    }

    const upstream = await instanceLocketV2.get(currentUrl, {
      meta: { idToken },
      responseType: "arraybuffer",
      timeout: 30000,
      maxRedirects: 0,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,video/mp4,video/webm,video/*,*/*;q=0.8",
      },
    });

    if (
      upstream.status >= 300 &&
      upstream.status < 400 &&
      upstream.headers?.location
    ) {
      currentUrl = new URL(upstream.headers.location, currentUrl).toString();
      continue;
    }

    return upstream;
  }

  const error = new Error("Too many Rollcall media redirects");
  error.statusCode = 502;
  throw error;
}

//Moment V2
// router.post("/getMomentV2", verifyIdToken, momentcontroll.GetMomentsControll);

router.post("/getInfoMomentV2", checkAppMeta, verifyIdToken, verifyDioToken, momentcontroll.GetInfoMomentsControll);
router.get("/getLatestMomentV2", verifyIdToken, momentcontroll.GetLastestMomentsControll);
router.post("/reactMomentV2", verifyIdToken, momentcontroll.ReactMomentsControll);

// Rollcalls — gọi server-to-server để tránh CORS / chặn request trên Android.
// Giữ nguyên response chính thức để frontend không phải đổi cấu trúc dữ liệu.
router.post("/getRollcallPostsV2", verifyIdToken, async (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const idToken = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!idToken) {
    return res.status(401).json({
      success: false,
      message: "Missing Firebase ID token",
    });
  }

  try {
    const upstream = await instanceLocketV2.post(
      "getRollcallPosts",
      req.body,
      {
        meta: { idToken },
        timeout: 30000,
      },
    );

    return res.status(upstream.status || 200).json(upstream.data);
  } catch (error) {
    const status = error?.response?.status || 502;
    const upstreamData = error?.response?.data;

    console.warn("[rollcall-proxy] getRollcallPosts failed", {
      status,
      code: error?.code || null,
      message: error?.message || "Unknown upstream error",
    });

    return res.status(status).json(
      upstreamData && typeof upstreamData === "object"
        ? upstreamData
        : {
            success: false,
            message:
              status === 504
                ? "Rollcalls upstream timeout"
                : "Rollcalls upstream unavailable",
          },
    );
  }
});

// Media Rollcalls đôi khi không cho tải trực tiếp từ WebView/Chrome Android.
// Route này dùng token hiện tại + bộ header Locket ở server rồi trả blob về frontend.
router.get("/getRollcallMediaV2", verifyIdToken, async (req, res) => {
  const mediaUrl = String(req.query.url || "").trim();
  if (!isAllowedRollcallMediaUrl(mediaUrl)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Rollcall media URL",
    });
  }

  try {
    const upstream = await fetchRollcallMediaWithRedirects(
      mediaUrl,
      req.user.idToken,
    );

    const buffer = Buffer.from(upstream.data);
    if (!buffer.length) {
      return res.status(502).json({
        success: false,
        message: "Empty Rollcall media response",
      });
    }

    const declaredType = upstream.headers?.["content-type"];
    const contentType = sniffRollcallMediaType(buffer, declaredType);
    if (!contentType) {
      return res.status(415).json({
        success: false,
        message: "Rollcall response is not supported media",
        contentType: String(declaredType || "application/octet-stream")
          .split(";", 1)[0],
      });
    }

    res.set({
      "Content-Type": contentType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    });
    return res.status(200).send(buffer);
  } catch (error) {
    const status =
      error?.statusCode || error?.response?.status ||
      (error?.code === "ECONNABORTED" ? 504 : 502);

    console.warn("[rollcall-media-proxy] failed", {
      status,
      code: error?.code || null,
      message: error?.message || "Unknown upstream error",
    });

    return res.status(status).json({
      success: false,
      message:
        status === 401
          ? "Rollcall media session expired"
          : status === 403
            ? "Rollcall media access denied"
            : "Rollcall media unavailable",
    });
  }
});

//Message V2
// router.post("/getAllMessageV2", verifyIdToken, messageControll.GetAllMessagesControll);
router.post("/sendMessageV2", verifyIdToken, momentcontroll.SendMessageControll);

//Friend V2
router.post("/deleteFriendV2", verifyIdToken, friendcontroll.deleteFriendsController);

// ==================== Friend Requests V2 ====================
router.post("/sendFriendRequestV2", friendRequestLimiter, checkAppMeta, verifyIdToken, verifyDioToken, initializeAppCheck, friendcontroll.SendRequestToFriendsController);
router.post("/sendCelebrityRequestV2", friendRequestLimiter, checkAppMeta, verifyIdToken, verifyDioToken, initializeAppCheck, friendcontroll.SendRequestToCelebrityController);

router.post("/getIncomingFriendRequestsV2", verifyIdToken, friendcontroll.getFriendsRequestController);

router.post("/getAllRequestsV2", verifyIdToken, friendcontroll.getFriendsRequestControllerV2);

router.post("/getOutgoingFriendRequestsV2", verifyIdToken, friendcontroll.getOutgoingRequestsController);
// Xoá lời mời kết bạn
router.post("/deleteIncomingRequestV2", verifyIdToken, friendcontroll.deleteFriendsRequestController);
router.post("/deleteOutgoingRequestV2", verifyIdToken, friendcontroll.deleteOutgingRequestController);

router.post("/acceptFriendRequestV2", verifyIdToken, friendcontroll.AcceptFriendsController);

// Get Friend
router.post("/getUserByData", friendSearchLimiter, verifyIdToken, friendcontroll.getUserController);

// ==================== Direct Beta Friend Requests ====================
const { directFriendRoutes } = require("../modules/directFriend");
router.use(directFriendRoutes);

module.exports = router;
