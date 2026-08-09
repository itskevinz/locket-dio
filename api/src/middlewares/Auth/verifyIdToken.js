const {
  logInfo,
  logSuccess,
  logError,
  logTable,
} = require("../../utils/logEventUtils");
const { getPlanFromCookie } = require("../../utils/tokenUtils/setPlanToken");
const { tokenUltils } = require("../../utils");
const { recordServerUserActivity, getAccountStatus } = require("../../services/userActivityStore");

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
        logError("verifyIdToken", `⛔ Account is locked: ${req.user.uid}`);
        return res.status(403).json({ success: false, code: "ACCOUNT_LOCKED", error: "Tài khoản Locket Web của bạn đã bị Khóa bởi Quản Trị Viên." });
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
  logInfo(
    "verifyplanAuth",
    `✅ Plan cookie xác thực thành công (${planData.plan_id})`,
  );

  // 🧾 Log toàn bộ thông tin planData dưới dạng bảng
  logTable("verifyplanAuth", planData, "PLAN COOKIE DATA");
  next();
};

const verifyPlanAuthOrGuest = async (req, res, next) => {
  const user = await verifyIdTokenAsync(req);
  if (user) {
    req.user = user;
    req.isGuest = false;
    console.log(`✅ User xác thực thành công: ${user.uid}`);
    recordServerUserActivity({ user, req, eventType: "touch" }).catch(() => {});
  } else {
    req.user = null;
    req.isGuest = true;
    console.log("⚠️ Guest (chưa login) gọi API");
  }
  next();
};

const verifyIdTokenAsync = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const idToken = authHeader.split(" ")[1];
  const { valid } = tokenUltils.checkTokenValid(idToken);
  if (!valid) return null;

  const payloadBase64 = idToken.split(".")[1];
  const decodedPayload = JSON.parse(
    Buffer.from(payloadBase64, "base64").toString("utf-8"),
  );
  return {
    uid: decodedPayload.user_id || decodedPayload.uid,
    localId: decodedPayload.user_id || decodedPayload.uid,
    idToken,
    email: decodedPayload.email,
    name: decodedPayload.name,
  };
};

/**
 * Parse a bearer token when present, but keep signed-public routes usable when
 * the token is missing or stale. The route handler must still validate its own
 * short-lived signature before returning private data.
 */
const verifyIdTokenOptional = async (req, _res, next) => {
  try {
    const user = await verifyIdTokenAsync(req);
    if (user) req.user = user;
  } catch {
    req.user = null;
  }
  next();
};

module.exports = {
  verifyIdToken,
  verifyIdTokenOptional,
  verifyplanAuth,
  verifyPlanAuthOrGuest,
};
