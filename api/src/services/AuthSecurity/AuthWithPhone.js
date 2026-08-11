const { instanceLocketV2 } = require("../../libs");
const constants = require("../../utils/constants");
const { verifyCustomeToken } = require("./AuthServices");

const normalizePhone = (phone) => {
  let value = String(phone || "")
    .trim()
    .replace(/[\s().-]/g, "");

  if (value.startsWith("0")) value = `+84${value.slice(1)}`;
  else if (value.startsWith("84")) value = `+${value}`;

  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    const error = new Error("Số điện thoại không hợp lệ");
    error.status = 400;
    throw error;
  }

  return value;
};

const getClientToken = () =>
  process.env.LOCKET_CLIENT_TOKEN || process.env.LOCKET_PHONE_CLIENT_TOKEN || "";

const sendVerifiCode = async (phone) => {
  try {
    const body = {
      data: {
        phone,
        operation: "sign_in",
        platform: "ios",
        is_retry: false,
        use_password_if_available: true,
        client_token: getClientToken(),
        analytics: constants.locketAnalytics,
      },
    };

    const res = await instanceLocketV2.post("sendVerificationCode", body);

    const status = res?.data?.result?.status;

    return status;
  } catch (error) {
    if (error.response?.status) {
      return error.response.status;
    }

    throw error;
  }
};

// Gửi OTP đổi số điện thoại cho tài khoản đang đăng nhập.
// Khác luồng sign_in ở trên: request này bắt buộc đi kèm idToken hiện tại
// và operation=change_number để Locket thực sự gửi SMS cho việc đổi số.
const requestPhoneChangeCode = async (idToken, phone, { isRetry = false } = {}) => {
  const normalizedPhone = normalizePhone(phone);
  if (!idToken) {
    const error = new Error("Phiên đăng nhập không hợp lệ");
    error.status = 401;
    throw error;
  }

  const body = {
    data: {
      phone: normalizedPhone,
      operation: "change_number",
      platform: "ios",
      is_retry: Boolean(isRetry),
      use_password_if_available: false,
      client_token: getClientToken(),
      analytics: constants.locketAnalytics,
    },
  };

  const res = await instanceLocketV2.post("sendVerificationCode", body, {
    meta: { idToken },
  });

  return {
    phone: normalizedPhone,
    result: res?.data?.result || null,
    raw: res?.data || null,
  };
};

// Xác minh OTP đổi số. Chỉ coi là thành công khi Locket không trả lỗi/status lỗi.
const confirmPhoneChangeCode = async (idToken, phone, verificationCode) => {
  const normalizedPhone = normalizePhone(phone);
  const code = String(verificationCode || "").trim();
  if (!/^\d{4,8}$/.test(code)) {
    const error = new Error("Mã xác minh không hợp lệ");
    error.status = 400;
    throw error;
  }
  if (!idToken) {
    const error = new Error("Phiên đăng nhập không hợp lệ");
    error.status = 401;
    throw error;
  }

  const body = {
    data: {
      phone: normalizedPhone,
      verification_code: code,
      operation: "change_number",
      analytics: constants.locketAnalytics,
    },
  };

  const res = await instanceLocketV2.post("checkVerificationCode", body, {
    meta: { idToken },
  });

  return {
    phone: normalizedPhone,
    result: res?.data?.result || null,
    raw: res?.data || null,
  };
};

const loginWithPhoneService = async (phone, password) => {
  try {
    const body = {
      data: {
        phone: phone,
        password: password,
        analytics: constants.locketAnalytics,
      },
    };
    const res = await instanceLocketV2.post("signInWithPhonePassword", body);
    const customToken = res.data.result.token || null;

    const result = await verifyCustomeToken(customToken);

    return result;
  } catch (error) {
    console.error("❌ Network Error:", error.message);
    if (!error.status) {
      error.status = 500;
      error.message = "Lỗi khi đăng nhập bằng số điện thoại";
    }
    throw error;
  }
};

module.exports = {
  sendVerifiCode,
  loginWithPhoneService,
  normalizePhone,
  requestPhoneChangeCode,
  confirmPhoneChangeCode,
};
