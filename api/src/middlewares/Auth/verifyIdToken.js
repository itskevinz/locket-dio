const {
  logInfo,
  logSuccess,
  logError,
  logTable,
} = require("../../utils/logEventUtils");
const { getPlanFromCookie } = require("../../utils/tokenUtils/setPlanToken");
const { tokenUltils } = require("../../utils");
const { recordServerUserActivity, getAccountStatus } = require("../../services/userActivityStore");
const { getAccountLock } = require("../../services/accountLockStore");

const verifyIdToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const idToken = authHeader.split(" ")[1];

  try {
    // Bước 1: kiểm tra token hợp lệ (nếu có hàm checkTokenValid riêng)
    const { valid, message } = tokenUltils.checkTokenValid(idToken);
    if (!valid) {
      logInfo("verifyIdToken", `❌ Token validation failed: ${message}`);
      return res.status(401).json({ message });
    }

    // Bước 2: decode idToken để lấy thông tin người dùng
    const payloadBase64 = idToken.split(".")[1];
    const decodedPayload = JSON.parse(
      Buffer.from(payloadBase64, "base64").toString("utf-8"),
    );

    // Bước 3: Ghi log và gán vào req.user
    logSuccess(
      "verifyIdToken",
      `✅ Authenticated: ${decodedPayload?.email} ${decodedPayload?.phone_number} (${decodedPayload.user_id})`,
    );

    req.user = {
      idToken, // token gốc
      localId: decodedPayload.user_id || decodedPayload.uid,
      uid: decodedPayload.user_id || decodedPayload.uid,
      email: decodedPayload?.email,
      phone: decodedPayload?.phone_number,
      name: decodedPayload.name,
      picture: decodedPayload.picture,
      exp: decodedPayload.exp,
      iat: decodedPayload.iat,
    };

    if (req.user.uid) {
      const status = await getAccountStatus(req.user.uid).catch(() => "active");
      if (status === "locked") {
        let lock = null;
        try {
          lock = await getAccountLock(req.user.uid);
        } catch (lockError) {
          console.warn("Unable to load account lock reason:", lockError?.message || lockError);
        }
        logError("verifyIdToken", `⛔ Account is locked: ${req.user.uid}`);
        return res.status(403).json({
          success: false,
          code: "ACCOUNT_LOCKED",
          error: "Tài khoản Locket Web của bạn đã bị khóa bởi Quản Trị Viên.",
          reason: lock?.reason || null,
          lockedAt: lock?.locked_at || null,
        });
      }
    }

    recordServerUserActivity({ user: req.user, req, eventType: "touch" }).catch(() => {});
    next();
  } catch (error) {
    console.error("❌ Token không hợp lệ:", error.message);
    return res
      .status(401)
      .json({ success: false, message: "Token không hợp lệ hoặc đã hết hạn" });
  }
};

const verifyplanAuth = (req, res, next) => {
  const planData = getPlanFromCookie(req);

  if (!planData) {
    logError(
      "verifyplanAuth",
      "❌ Không tìm thấy hoặc cookie plan không hợp lệ",
    );
    return res.status(401).json({
      success: false,
      message: "Malformed request",
    });
  }

  req.plan = planData;
  logSuccess("verifyplanAuth", "✅ Plan token verified");
  logTable(planData);
  next();
};

const verifyIdTokenAsync = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.split(" ")[1];
  const { valid } = tokenUltils.checkTokenValid(idToken);
  if (!valid) return null;
  const payloadBase64 = idToken.split(".")[1];
  const decodedPayload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf-8"));
  return {
    idToken,
    localId: decodedPayload.user_id || decodedPayload.uid,
    uid: decodedPayload.user_id || decodedPayload.uid,
    email: decodedPayload?.email,
    phone: decodedPayload?.phone_number,
    name: decodedPayload.name,
    picture: decodedPayload.picture,
    exp: decodedPayload.exp,
    iat: decodedPayload.iat,
  };
};

const verifyPlanAuthOrGuest = async (req, res, next) => {
  try {
    const user = await verifyIdTokenAsync(req);
    if (user) {
      req.user = user;
      req.isGuest = false;
    } else {
      req.user = null;
      req.isGuest = true;
    }
    next();
  } catch (error) {
    req.user = null;
    req.isGuest = true;
    next();
  }
};

const verifyIdTokenOptional = async (req, res, next) => {
  try {
    req.user = await verifyIdTokenAsync(req);
  } catch {
    req.user = null;
  }
  next();
};

module.exports = {
  verifyIdToken,
  verifyplanAuth,
  verifyPlanAuthOrGuest,
  verifyIdTokenAsync,
  verifyIdTokenOptional,
};
