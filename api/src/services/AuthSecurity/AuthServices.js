const axios = require("axios");
const constants = require("../../utils/constants");
const { instanceFirebaseV2 } = require("../../libs/instanceFirebase");
const { createGoogleInstance, instanceLocketV2 } = require("../../libs");
const { firebase } = require("../../config/app.config");
const {
  persistLocketBackgroundSession,
} = require("../locketBackgroundSession");

// Hàm xử lý đăng nhập
const handleLogin = async (email, password) => {
  const loginPayload = {
    email,
    password,
    returnSecureToken: true,
    iosBundleId: constants.IOS_BUNDLE_ID,
  };
  const response = await instanceFirebaseV2.post(
    "verifyPassword",
    loginPayload,
  );
  const data = response.data;
  await persistLocketBackgroundSession(data, { source: "email-login" });
  return data;
};

// Hàm xử lý đăng nhập
const verifyCustomeToken = async (token) => {
  const verifyPayload = {
    token,
    returnSecureToken: true,
  };
  const response = await instanceFirebaseV2.post(
    "verifyCustomToken",
    verifyPayload,
  );

  const data = response.data;
  await persistLocketBackgroundSession(data, { source: "custom-token-login" });
  return data;
};

// Hàm xử lý đăng nhập
const CheckEmail = async (email) => {
  const apiKey = firebase.apiKey || process.env.FIREBASE_API_KEY || "";
  if (!apiKey) {
    const err = new Error(
      "FIREBASE_API_KEY chưa cấu hình. Thêm vào .env / Railway Variables.",
    );
    err.status = 503;
    err.code = "FIREBASE_NOT_CONFIGURED";
    throw err;
  }

  const loginPayload = {
    identifier: email,
    continueUri: "http://localhost",
    iosBundleId: constants.IOS_BUNDLE_ID,
  };

  const headers = {
    "Content-Type": "application/json",
    "User-Agent": constants.USER_AGENT,
    "X-Ios-Bundle-Identifier": constants.IOS_BUNDLE_ID,
  };

  const response = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`,
    loginPayload,
    {
      headers,
    },
  );

  return response.data;
};

const classifyFirebaseRefreshError = (err) => {
  const status = Number(err?.response?.status || err?.status || 0);
  const rawMsg =
    err?.response?.data?.error?.message ||
    err?.response?.data?.message ||
    err?.message ||
    "";
  const upperMsg = String(rawMsg).toUpperCase();

  // 1. Upstream rate limit (429)
  if (
    status === 429 ||
    upperMsg.includes("TOO_MANY_ATTEMPTS") ||
    upperMsg.includes("RESOURCE_EXHAUSTED") ||
    upperMsg.includes("RATE_LIMIT")
  ) {
    const error = new Error("Quá nhiều yêu cầu làm mới phiên. Vui lòng thử lại sau.");
    error.status = 429;
    error.code = "TOO_MANY_ATTEMPTS_TRY_LATER";
    error.terminal = false;
    return error;
  }

  // 2. Auth Configuration error (503)
  if (
    upperMsg.includes("API_KEY_INVALID") ||
    upperMsg.includes("API_KEY_EXPIRED") ||
    upperMsg.includes("PROJECT_NOT_FOUND") ||
    upperMsg.includes("PROJECT_NUMBER_MISMATCH") ||
    upperMsg.includes("CONFIGURATION_NOT_FOUND") ||
    upperMsg.includes("FIREBASE_NOT_CONFIGURED")
  ) {
    const error = new Error("Cấu hình Firebase Auth chưa hợp lệ hoặc thiếu API key.");
    error.status = 503;
    error.code = "AUTH_CONFIG_ERROR";
    error.terminal = false;
    return error;
  }

  // 3. Explicit terminal errors from Firebase Auth (401)
  if (
    upperMsg.includes("TOKEN_EXPIRED") ||
    upperMsg.includes("REFRESH_TOKEN_EXPIRED")
  ) {
    const error = new Error("Refresh token đã hết hạn.");
    error.status = 401;
    error.code = "TOKEN_EXPIRED";
    error.terminal = true;
    return error;
  }

  if (upperMsg.includes("USER_DISABLED")) {
    const error = new Error("Tài khoản người dùng đã bị vô hiệu hóa.");
    error.status = 401;
    error.code = "USER_DISABLED";
    error.terminal = true;
    return error;
  }

  if (upperMsg.includes("USER_NOT_FOUND")) {
    const error = new Error("Không tìm thấy tài khoản người dùng.");
    error.status = 401;
    error.code = "USER_NOT_FOUND";
    error.terminal = true;
    return error;
  }

  if (
    upperMsg.includes("INVALID_REFRESH_TOKEN") ||
    upperMsg.includes("REFRESH_TOKEN_INVALID")
  ) {
    const error = new Error("Refresh token không hợp lệ.");
    error.status = 401;
    error.code = "REFRESH_TOKEN_INVALID";
    error.terminal = true;
    return error;
  }

  // 4. Protocol / Payload errors from Firebase upstream (non-terminal 502)
  if (
    upperMsg.includes("INVALID_GRANT_TYPE") ||
    upperMsg.includes("MISSING_REFRESH_TOKEN")
  ) {
    const error = new Error("Lỗi giao thức yêu cầu làm mới phiên.");
    error.status = 502;
    error.code = "AUTH_REFRESH_FAILED";
    error.terminal = false;
    return error;
  }

  // 5. Upstream 5xx (502)
  if (status >= 500) {
    const error = new Error("Máy chủ xác thực tạm thời không phản hồi.");
    error.status = 502;
    error.code = "UPSTREAM_UNAVAILABLE";
    error.terminal = false;
    return error;
  }

  // 6. Network / Timeout / Connection error (503)
  if (
    !err?.response ||
    err.code === "ECONNABORTED" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNREFUSED" ||
    err.code === "ENOTFOUND" ||
    /timeout|network|socket|econn/i.test(err.message || "")
  ) {
    const error = new Error("Không thể kết nối tới máy chủ xác thực.");
    error.status = 503;
    error.code = "UPSTREAM_UNAVAILABLE";
    error.terminal = false;
    return error;
  }

  // 7. Generic / Unknown fallback (including unknown 400, 401, 403) -> NON-TERMINAL
  const error = new Error("Tạm thời chưa thể làm mới phiên đăng nhập.");
  error.status = 502;
  error.code = "AUTH_REFRESH_FAILED";
  error.terminal = false;
  return error;
};

const refreshIdToken = async (refreshToken) => {
  if (!refreshToken) {
    const err = new Error("Thiếu refresh token.");
    err.status = 401;
    err.code = "REFRESH_TOKEN_MISSING";
    err.terminal = true;
    throw err;
  }

  const apiKey = firebase.apiKey || process.env.FIREBASE_API_KEY || "";
  if (!apiKey) {
    const err = new Error(
      "FIREBASE_API_KEY chưa cấu hình. Thêm vào .env / Railway Variables.",
    );
    err.status = 503;
    err.code = "FIREBASE_NOT_CONFIGURED";
    err.terminal = false;
    throw err;
  }

  const payload = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  try {
    const firebaseAuthApi = createGoogleInstance("secureToken");

    const res = await firebaseAuthApi.post("v1/token", payload.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    // Firebase trả về object gồm: id_token, refresh_token, expires_in, user_id,...
    const data = res.data;
    await persistLocketBackgroundSession(data, { source: "token-refresh" });
    return data;
  } catch (err) {
    console.error("Refresh token failed:", {
      status: err.response?.status,
      code: err.response?.data?.error?.message || err.code || err.message,
    });
    throw classifyFirebaseRefreshError(err);
  }
};

// Hàm xử lý thay đổi thông tin profile
const handleChangeProfileInfo = async (
  idToken,
  badge,
  celebrity,
  additionalData = {},
) => {
  // Payload cho API
  const profilePayload = {
    data: {
      badge,
      celebrity,
      ...additionalData,
    },
  };

  // Gửi yêu cầu tới Locket API
  const response = await instanceLocketV2.post(
    "/changeProfileInfo",
    profilePayload,
    {
      meta: {
        idToken: idToken,
      },
    },
  );

  // Trả về dữ liệu từ response
  return response.data;
};

const ResetPassword = async (email) => {
  const body = {
    data: {
      email: email,
    },
  };

  try {
    const response = await instanceLocketV2.post(
      "/sendPasswordResetEmail",
      body,
    );
    console.log(response.data);

    const statusCode = response.data?.result?.status || 500;
    const message = response.data?.result?.message || "Unknown error";

    return {
      success: statusCode === 200,
      statusCode,
      message,
      raw: response.data,
    };
  } catch (error) {
    const errMsg =
      error.response?.data?.result?.message ||
      error.message ||
      "Request failed";

    console.error("❌ Lỗi khi gửi yêu cầu Reset Password:", errMsg);

    return {
      success: false,
      statusCode: error.response?.status || 500,
      message: errMsg,
      raw: error.response?.data || null,
    };
  }
};

module.exports = {
  handleLogin,
  verifyCustomeToken,
  refreshIdToken,
  classifyFirebaseRefreshError,
  handleChangeProfileInfo,
  ResetPassword,
  CheckEmail,
};
