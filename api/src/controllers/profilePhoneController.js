const { phoneServices } = require("../services");

const getResultError = (payload, fallback) => {
  const result = payload?.result;
  if (!result) return null;
  if (result.success === false) return result.message || fallback;
  if (typeof result.status === "number" && result.status >= 400) {
    return result.message || `${fallback} (status ${result.status})`;
  }
  return null;
};

const requestPhoneChangeOtp = async (req, res, next) => {
  try {
    const idToken = req.user?.idToken;
    const { phone, isRetry = false } = req.body || {};
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Thiếu số điện thoại mới.",
      });
    }

    const response = await phoneServices.requestPhoneChangeCode(idToken, phone, {
      isRetry,
    });
    const errorMessage = getResultError(
      response,
      "Locket không thể gửi mã xác minh.",
    );
    if (errorMessage) {
      return res.status(400).json({ success: false, message: errorMessage, data: response.result });
    }

    return res.status(200).json({
      success: true,
      message: "Locket đã nhận yêu cầu gửi OTP.",
      data: {
        phone: response.phone,
        method: response.result?.method || null,
        provider: response.result?.provider || null,
        status: response.result?.status ?? null,
      },
    });
  } catch (error) {
    if (error?.response?.data) {
      const upstream = error.response.data;
      return res.status(error.response.status || 400).json({
        success: false,
        message:
          upstream?.result?.message ||
          upstream?.error?.message ||
          upstream?.error ||
          "Locket từ chối gửi OTP.",
        data: upstream?.result || null,
      });
    }
    next(error);
  }
};

const confirmPhoneChangeOtp = async (req, res, next) => {
  try {
    const idToken = req.user?.idToken;
    const { phone, code } = req.body || {};
    if (!phone || !code) {
      return res.status(400).json({
        success: false,
        message: "Thiếu số điện thoại hoặc mã OTP.",
      });
    }

    const response = await phoneServices.confirmPhoneChangeCode(idToken, phone, code);
    const errorMessage = getResultError(
      response,
      "Mã OTP không đúng hoặc đã hết hạn.",
    );
    if (errorMessage) {
      return res.status(400).json({ success: false, message: errorMessage, data: response.result });
    }

    return res.status(200).json({
      success: true,
      message: "Locket đã xử lý mã xác minh.",
      data: {
        phone: response.phone,
        status: response.result?.status ?? null,
      },
    });
  } catch (error) {
    if (error?.response?.data) {
      const upstream = error.response.data;
      return res.status(error.response.status || 400).json({
        success: false,
        message:
          upstream?.result?.message ||
          upstream?.error?.message ||
          upstream?.error ||
          "Locket từ chối mã OTP.",
        data: upstream?.result || null,
      });
    }
    next(error);
  }
};

module.exports = {
  requestPhoneChangeOtp,
  confirmPhoneChangeOtp,
};
