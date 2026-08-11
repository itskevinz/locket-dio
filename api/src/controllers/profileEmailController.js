const { authServices } = require("../services");
const { instanceLocketV2 } = require("../libs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const getFirebaseErrorCode = (error) => {
  const message =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message ||
    "";
  return String(message).split(" : ")[0].trim();
};

const friendlyPasswordError = (error) => {
  const code = getFirebaseErrorCode(error);
  if (
    code.includes("INVALID_PASSWORD") ||
    code.includes("INVALID_LOGIN_CREDENTIALS") ||
    code.includes("EMAIL_NOT_FOUND")
  ) {
    return "Mật khẩu hiện tại không đúng.";
  }
  if (code.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
    return "Bạn thử sai quá nhiều lần. Vui lòng chờ một lúc rồi thử lại.";
  }
  return "Không thể xác minh mật khẩu hiện tại.";
};

const getLocketFailure = (payload) => {
  const result = payload?.result;
  if (result?.success === false) {
    return result?.message || "Locket từ chối cập nhật email.";
  }
  if (typeof result?.status === "number" && result.status >= 400) {
    return result?.message || `Locket từ chối cập nhật email (status ${result.status}).`;
  }
  if (payload?.error) {
    return payload.error?.message || payload.error || "Locket từ chối cập nhật email.";
  }
  return null;
};

const updateEmailWithPassword = async (req, res, next) => {
  const currentEmail = normalizeEmail(req.user?.email);
  const currentUid = req.user?.uid;
  const nextEmail = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!currentEmail || !currentUid) {
    return res.status(401).json({
      success: false,
      message: "Phiên đăng nhập không có đủ thông tin để đổi email.",
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
    return res.status(400).json({ success: false, message: "Email mới không hợp lệ." });
  }

  if (!password) {
    return res.status(400).json({
      success: false,
      message: "Nhập mật khẩu hiện tại để xác nhận đổi email.",
    });
  }

  if (nextEmail === currentEmail) {
    return res.status(400).json({ success: false, message: "Email mới trùng email hiện tại." });
  }

  let reauth;
  try {
    // Xác minh đúng mật khẩu của chính tài khoản đang đăng nhập.
    reauth = await authServices.handleLogin(currentEmail, password);
  } catch (error) {
    return res.status(401).json({ success: false, message: friendlyPasswordError(error) });
  }

  if (!reauth?.idToken || reauth?.localId !== currentUid) {
    return res.status(401).json({
      success: false,
      message: "Mật khẩu không xác minh được đúng tài khoản hiện tại.",
    });
  }

  try {
    const response = await instanceLocketV2.post(
      "updateEmailAddress",
      { data: { email: nextEmail } },
      { meta: { idToken: reauth.idToken } },
    );

    const failure = getLocketFailure(response?.data);
    if (failure) {
      return res.status(400).json({ success: false, message: failure });
    }

    // Không báo thành công chỉ dựa vào HTTP 200. Đăng nhập lại bằng email mới
    // và cùng mật khẩu để xác nhận Firebase/Locket đã đổi thật.
    let verified = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await sleep(450);
      try {
        const candidate = await authServices.handleLogin(nextEmail, password);
        if (candidate?.localId === currentUid && candidate?.idToken) {
          verified = candidate;
          break;
        }
      } catch {
        // Có thể Locket/Firebase cần vài trăm ms để đồng bộ email mới.
      }
    }

    if (!verified) {
      return res.status(409).json({
        success: false,
        message:
          "Locket đã nhận yêu cầu nhưng chưa xác nhận được email mới. Email hiện tại chưa được coi là đã đổi.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã đổi email Locket và xác minh lại bằng mật khẩu hiện tại.",
      data: {
        email: normalizeEmail(verified.email || nextEmail),
        uid: verified.localId,
        idToken: verified.idToken,
        refreshToken: verified.refreshToken,
        expiresIn: verified.expiresIn,
      },
    });
  } catch (error) {
    const upstream = error?.response?.data;
    const message =
      upstream?.result?.message ||
      upstream?.error?.message ||
      (typeof upstream?.error === "string" ? upstream.error : null) ||
      error?.message ||
      "Locket từ chối cập nhật email.";

    return res.status(error?.response?.status || 400).json({
      success: false,
      message,
    });
  }
};

module.exports = {
  updateEmailWithPassword,
};
