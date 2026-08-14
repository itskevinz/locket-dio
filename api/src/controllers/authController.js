const {
  logInfo,
  logError,
  logSuccess,
  logGroup,
  logLoading,
} = require("../utils/logEventUtils");
const verifyCaptcha = require("../utils/verifyCaptcha");
const { createHttpError } = require("../utils/http-error");
const { authServices, phoneServices } = require("../services");
const { getUserInfoV2 } = require("../services/AuthSecurity/GetInfoUser");
const { cookieUtils, tokenUltils } = require("../utils");
const { recordServerUserActivity } = require("../services/userActivityStore");

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim(); // Lấy IP đầu tiên nếu có nhiều
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
};

const loginV3 = async (req, res, next) => {
  const { email, password } = req.body;

  logGroup(`🔐 Login Attempt - ${email}`, async () => {
    logInfo("LoginControllerV2", "📩 Yêu cầu đăng nhập");

    try {
      logLoading("LoginControllerV2", "🔑 Xử lý đăng nhập...");

      // Gọi service để đăng nhập
      const loginResponse = await authServices.handleLogin(email, password);
      // Trích xuất dữ liệu
      const { idToken, refreshToken } = loginResponse;
      // 1. Lưu refreshToken vào cookie (bảo mật)
      res.cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
        path: "/",
      });
      // Gọi service để lấy thông tin user
      const response = await getUserInfoV2(loginResponse);

      logSuccess("LoginControllerV2", "✅ Đăng nhập thành công!");

      res.status(200).json({
        success: true,
        message: "Đăng nhập thành công!",
        data: response, // Chứa thông tin user và token
      });
    } catch (error) {
      // logError("LoginControllerV2", "❌ Đăng nhập thất bại", {
      //   message: error.message,
      //   stack: error.stack,
      // });
      logError("LoginControllerV2", "❌ Đăng nhập thất bại");
      next(error); // Gửi lỗi qua middleware xử lý
    }
  });
};

const loginV2 = async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: "Thiếu email hoặc mật khẩu",
      code: "MISSING_CREDENTIALS",
    });
  }

  // FIREBASE_API_KEY must be set via env (Railway / .env) — never hardcode in source
  const { firebase } = require("../config/app.config");
  if (!firebase?.apiKey && !process.env.FIREBASE_API_KEY) {
    return res.status(503).json({
      success: false,
      message:
        "API chưa cấu hình FIREBASE_API_KEY — login Locket chưa bật. Health/weather vẫn dùng được.",
      code: "FIREBASE_NOT_CONFIGURED",
    });
  }

  logGroup(`🔐 Login Attempt - ${email}`, async () => {
    logInfo("LoginControllerV2", "📩 Yêu cầu đăng nhập");

    try {
      logLoading("LoginControllerV2", "🔑 Xử lý đăng nhập...");

      // Gọi service để đăng nhập
      const loginResponse = await authServices.handleLogin(email, password);
      // Trích xuất dữ liệu
      const { idToken, refreshToken } = loginResponse;

      // 1. Lưu refreshToken vào cookie (bảo mật)
      cookieUtils.setCookie({
        res,
        name: "refreshToken",
        value: refreshToken,
        time: "7d",
      });
      cookieUtils.setCookie({
        res,
        name: "accessToken",
        value: idToken,
        time: "1h",
      });
      logSuccess("LoginControllerV2", "✅ Đăng nhập thành công!");
      recordServerUserActivity({
        user: { uid: loginResponse?.localId || loginResponse?.uid || email, email },
        req,
        eventType: "login",
        loginMethod: "email",
      }).catch(() => {});

      res.status(200).json({
        success: true,
        message: "ok!",
        data: loginResponse, // Chứa thông tin user và token
      });
    } catch (error) {
      logError("LoginControllerV2", "❌ Đăng nhập thất bại");
      next(error); // Gửi lỗi qua middleware xử lý
    }
  });
};

const loginPhoneController = async (req, res, next) => {
  const { phone, password } = req.body;

  logGroup(`🔐 Login Attempt - ${phone}`, async () => {
    logInfo("loginPhoneController", "📩 Yêu cầu đăng nhập");

    try {
      // 1️⃣ Normalize phone
      const phoneNormalized = phoneServices.normalizePhone(phone);

      // 2️⃣ Gửi verification code trước
      const verifyStatus = await phoneServices.sendVerifiCode(phoneNormalized);
      // ❌ Chưa đăng ký
      if (verifyStatus === 601) {
        logInfo("loginPhoneController", "❌ Số điện thoại chưa đăng ký");
        return res.status(400).json({
          success: false,
          message: "Số điện thoại chưa đăng ký",
        });
      }
      logInfo("loginPhoneController", `Verify status: ${verifyStatus}`);
      if (![400, 602].includes(verifyStatus)) {
        logError(
          "loginPhoneController",
          `❌ Verify status không hợp lệ: ${verifyStatus}`
        );
        return res.status(400).json({
          success: false,
          message: "Không thể xác minh số điện thoại",
        });
      }

      // 3️⃣ Đã đăng ký → Login
      const loginResponse = await phoneServices.loginWithPhoneService(
        phoneNormalized,
        password
      );

      const { idToken, refreshToken } = loginResponse;

      const decodeData = tokenUltils.decodeLocketJWT(idToken);
      const localId = decodeData.user_id;

      // 4️⃣ Lưu refreshToken vào cookie
      cookieUtils.setCookie({
        res,
        name: "accessToken",
        value: idToken,
        time: "1h",
      });
      cookieUtils.setCookie({
        res,
        name: "refreshToken",
        value: refreshToken,
        time: "7d",
      });

      logSuccess("loginPhoneController", "✅ Đăng nhập thành công!");
      recordServerUserActivity({
        user: { uid: localId, phone: phoneNormalized },
        req,
        eventType: "login",
        loginMethod: "phone",
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        message: "Đăng nhập thành công",
        data: {
          ...loginResponse,
          localId,
        },
      });
    } catch (error) {
      logError("loginPhoneController", "❌ Đăng nhập thất bại");
      next(error);
    }
  });
};

const getInfoByToken = async (req, res, next) => {
  const { idToken, localId } = req.user;
  try {
    logInfo("getInfoByToken", "Start get Info", localId);
    if (!idToken) {
      throw new Error("ID Token không hợp lệ");
    }
    const response = await getUserInfoV2(idToken, localId);

    logSuccess("getInfoByToken", "✅ Get Info thành công!");
    res.status(200).json({
      success: true,
      message: "ok",
      data: response, // Chứa thông tin user
    });
  } catch (error) {
    next(error);
  }
};
const loginAndCaptchaV2 = async (req, res, next) => {
  const { email, password, captchaToken } = req.body;
  const ip = getClientIp(req);

  logInfo("authController", `📩 Yêu cầu đăng nhập từ IP: ${ip}`, {
    email,
    origin: req.headers.origin,
    referer: req.headers.referer,
  });

  try {
    // ⚠️ Kiểm tra captcha ngay từ đầu
    if (!captchaToken) {
      logError("authController", "❌ Thiếu mã CAPTCHA", { email, ip });
      return res.status(400).json({
        success: false,
        message: "Vui lòng xác minh CAPTCHA trước khi đăng nhập",
        error: "CAPTCHA_REQUIRED",
      });
    }
    // ✅ Gọi verifyCaptcha mới (trả về object thay vì throw)
    const captchaResult = await verifyCaptcha(captchaToken, ip);
    if (!captchaResult.success) {
      logError("authController", "❌ CAPTCHA không hợp lệ", {
        email,
        ip,
        reason: captchaResult.message,
      });
      return res.status(400).json({
        success: false,
        message: captchaResult.message,
        error: "INVALID_CAPTCHA",
      });
    }

    logInfo("authController", "🔑 CAPTCHA hợp lệ, tiến hành đăng nhập...", {
      email,
    });

    const loginResponse = await handleLogin(email, password);
    const { idToken, localId, refreshToken } = loginResponse;

    const response = await getUserInfo(loginResponse);

    logInfo("authController-V3", "✅ Đăng nhập thành công!", { email });

    res.status(200).json({
      success: true,
      message: "Đăng nhập thành công!",
      data: response,
    });
  } catch (error) {
    logError("authController", "❌ Đăng nhập thất bại", error.message);
    res.status(403).json({
      success: false,
      message: error.message || "Lỗi không xác định",
    });
    next(error); // Chuyển lỗi đến middleware xử lý lỗi
  }
};

const refreshIdTokenControll = async (req, res, next) => {
  logInfo("authController", "📩 Nhận yêu cầu refreshIdToken");
  // ✅ Lấy refreshToken từ cookie hoặc body
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

  try {
    if (!refreshToken) {
      logInfo("authController", "Refresh Token không tồn tại.");
      return next(
        createHttpError(401, "REFRESH_TOKEN_MISSING", "Refresh token is required!")
      );
    }
    const refreshResponse = await authServices.refreshIdToken(refreshToken);
    const { access_token, refresh_token, id_token } = refreshResponse;

    if (refresh_token) {
      cookieUtils.setCookie({
        res,
        name: "refreshToken",
        value: refresh_token,
        time: "7d",
      });
    }
    cookieUtils.setCookie({
      res,
      name: "accessToken",
      value: access_token || id_token,
      time: "1h",
    });

    logSuccess("authController", "✅ RefreshToken thành công!");
    res.status(200).json({
      success: true,
      message: "Refresh-token thành công!",
      data: refreshResponse, // Chứa thông tin user và token
    });
  } catch (err) {
    const status = Number(err.status || 502);
    const code = err.code || "AUTH_REFRESH_FAILED";
    const message = err.message || "Lỗi làm mới phiên đăng nhập";
    logError("authController", `❌ Refresh token thất bại [${status} ${code}]`);
    return next(createHttpError(status, code, message));
  }
};

const resetPasswordControll = async (req, res, next) => {
  logInfo("resetPasswordControll", "📩 Nhận yêu cầu resetPasswordControll");

  const { email } = req.body;

  try {
    if (!email) {
      logInfo("resetPasswordControll", "Không có email.");
      return next(createHttpError(400, "EMAIL_MISSING", "Email là bắt buộc!"));
    }

    const resetResult = await authServices.ResetPassword(email);
    logInfo("resetPasswordControll", email);

    if (!resetResult.success) {
      logError(
        "resetPasswordControll",
        `❌ Reset password thất bại: ${resetResult.message}`
      );

      return next(
        createHttpError(
          resetResult.statusCode || 500,
          "RESET_PASSWORD_FAILED",
          resetResult.message
        )
      );
    }

    logSuccess("resetPasswordControll", "✅ Reset password thành công!");
    res.status(200).json({
      success: true,
      message: "Đã gửi email reset password thành công!",
      data: resetResult.raw, // dữ liệu API trả về
    });
  } catch (err) {
    logError("resetPasswordControll", "❌ Lỗi không xác định", err.message);
    return next(
      createHttpError(500, "INTERNAL_SERVER_ERROR", "Có lỗi xảy ra!")
    );
  }
};

const changeProfileInfo = async (req, res, next) => {
  logInfo("profileController", "📩 Nhận yêu cầu thay đổi thông tin profile...");
  const { badge, celebrity, additionalData, idToken } = req.body;

  try {
    logInfo("profileController", "🔄 Đang gửi yêu cầu tới Locket API...", {
      badge,
      celebrity,
      additionalData,
    });

    // Gọi hàm xử lý profile
    const responseData = await authServices.handleChangeProfileInfo(
      idToken,
      badge,
      celebrity,
      additionalData
    );

    logInfo(
      "profileController",
      "✅ Thay đổi thông tin thành công!",
      responseData
    );

    res.status(200).json({
      success: true,
      message: "Thay đổi thông tin profile thành công!",
      data: responseData,
    });
  } catch (error) {
    logError(
      "profileController",
      "❌ Lỗi khi thay đổi thông tin profile",
      error.message
    );
    next(error);
  }
};
// Controller xử lý đăng xuất
const logout = async (req, res, next) => {
  try {
    cookieUtils.clearCookie(res, "refreshToken");
    cookieUtils.clearCookie(res, "dioSession");

    logSuccess("authController", "👋 Đăng xuất thành công");
    res.status(200).json({
      success: true,
      message: "Đã đăng xuất khỏi hệ thống!",
    });
  } catch (error) {
    logError("authController", "❌ Lỗi khi đăng xuất", error.message);
    next(error);
  }
};

module.exports = {
  logout,
  loginV2,
  loginV3,
  getInfoByToken,
  loginPhoneController,
  refreshIdTokenControll,
  changeProfileInfo,
  loginAndCaptchaV2,
  resetPasswordControll,
};
