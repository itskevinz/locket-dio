const { planServices } = require("../services");
const {
  logInfo,
  logError,
  logSuccess,
} = require("../../../utils/logEventUtils");
const { tokenUltils } = require("../../../utils");
const { responseSuccess } = require("../../../helpers/http");

const planControllerV2 = async (req, res, next) => {
  const { uid, email, phone, name, picture } = req.user;
  const domain =
    req.headers["x-forwarded-host"] || req.headers.host || req.hostname;

  try {
    // Huy Locket free-for-all: always grant full Premium (no paywall)
    let userPlan = await planServices.getLocalFreePlan(
      uid,
      email,
      phone,
      name,
      picture,
    );
    logSuccess(
      "planController",
      "✅ Free-for-all Premium cho mọi user",
    );

    const { user, plan, subscription } = userPlan;

    //Tài khoản bị xóa hoặc bị cấm khỏi hệ thống Locket Dio
    if (user.deleted_at) {
      return res.status(403).json({
        success: false,
        data: null,
        message: "This account has been deleted.",
      });
    }

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        data: null,
        message: "Tài khoản đã bị cấm khỏi hệ thống Locket Dio.",
      });
    }

    const token = tokenUltils.signToken(
      {
        uid,
        email,
        name,
        customer_code: user.customer_code,
        plan_id: plan.id,
        is_active: subscription.is_active,
        expire_at: subscription.expires_at,
        domain,
        type: "session",
      },
      "7d",
    );

    return res.status(200).json({
      success: true,
      message: "ok",
      data: {
        session: {
          member_token: token,
          token_type: "Member",
          header: "X-LocketDio-Member",
          expires_in: 60 * 60 * 24 * 7,
          issued_at: Math.floor(Date.now() / 1000),
        },
        ...userPlan,
      },
    });
  } catch (error) {
    logError("planController", "❌ Lấy gói thất bại", error.message);
    next(error);
  }
};

const UpdateplanController = async (req, res, next) => {
  const { uid, email, phone, name, picture } = req.user;
  const { username } = req.body;
  try {
    await planServices.updateInfoUserPlan({
      uid: uid,
      email: email,
      name: name,
      picture: picture,
      username: username,
      phone: phone,
    });

    res.status(200).json({
      success: true,
      message: "ok",
    });
  } catch (error) {
    logError("planController", "❌ Lấy gói thất bại", error.message);
    next(error);
  }
};

const validateCouponServer = async (req, res, next) => {
  try {
    const { code, planId, subtotal } = req.body;
    const uid = req.user?.uid || null;

    const data = await planServices.ValidateCoupon({
      code,
      planId,
      user_id: uid,
      subtotal: subtotal || null,
    });
    return res.status(200).json(data);
  } catch (error) {
    console.error("❌ Lỗi validate coupon:", error);
    return res.status(500).json({
      valid: false,
      reason: "SERVER_ERROR",
      message: error.message,
    });
  }
};

const getMemberFamily = async (req, res, next) => {
  try {
    const uid = req.user?.uid || null;

    const result = await planServices.getMemberFamily(uid);

    responseSuccess(res, result);
  } catch (error) {
    console.error("❌ Lỗin get:", error);
    next(error);
  }
};

/**
 * Client syncs upload stats computed from published Locket moments.
 * Body: { image_uploaded, video_uploaded, total_storage_used_mb, error_count? }
 */
const syncUploadStatsController = async (req, res, next) => {
  try {
    const uid = req.user?.uid || req.user?.localId;
    if (!uid) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    const body = req.body || {};
    const {
      setUserStats,
      getUserStats,
    } = require("../../../utils/cache/localUploadStats");

    const images = Math.max(
      0,
      Number(body.image_uploaded ?? body.image_uploads ?? 0) || 0,
    );
    const videos = Math.max(
      0,
      Number(body.video_uploaded ?? body.video_uploads ?? 0) || 0,
    );
    const mb = Math.max(
      0,
      Number(body.total_storage_used_mb ?? body.storage_used_mb ?? 0) || 0,
    );
    const errors = Math.max(0, Number(body.error_count ?? 0) || 0);

    const saved = await setUserStats(uid, {
      image_uploaded: images,
      video_uploaded: videos,
      image_uploads: images,
      video_uploads: videos,
      total_uploads: images + videos,
      total_storage_used_mb: mb,
      total_storage_used_bytes: Math.round(mb * 1024 * 1024),
      error_count: errors,
    });

    logSuccess("syncUploadStats", `✅ Synced stats for ${uid}`);
    return res.status(200).json({
      success: true,
      message: "ok",
      data: saved || (await getUserStats(uid)),
    });
  } catch (error) {
    logError("syncUploadStats", error.message);
    next(error);
  }
};

module.exports = {
  planControllerV2,
  UpdateplanController,
  validateCouponServer,
  getMemberFamily,
  syncUploadStatsController,
};
