import { instanceAuth, instanceLocketV2 } from "@/libs";

function getLocketResultError(data, fallback) {
  const result = data?.result;
  if (result?.success === false) {
    return result?.message || fallback;
  }
  if (typeof result?.status === "number" && result.status >= 400) {
    return result?.message || fallback;
  }
  return null;
}

function getApiErrorMessage(error, fallback) {
  return (
    error?.response?.data?.message ||
    error?.response?.data?.result?.message ||
    error?.response?.data?.error?.message ||
    (typeof error?.response?.data?.error === "string"
      ? error.response.data.error
      : null) ||
    error?.message ||
    fallback
  );
}

export function normalizeLocketPhone(phone) {
  let value = String(phone ?? "")
    .trim()
    .replace(/[\s().-]/g, "");

  if (!value) throw new Error("Số điện thoại không được để trống.");
  if (value.startsWith("0")) value = `+84${value.slice(1)}`;
  else if (value.startsWith("84")) value = `+${value}`;

  if (!/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error("Số điện thoại phải đúng định dạng quốc tế, ví dụ +84912345678.");
  }

  return value;
}

export const ValidateEmailAddress = async (email) => {
  try {
    const body = {
      data: {
        email: email,
        operation: "sign_in",
        platform: "ios",
      },
    };
    const res = await instanceLocketV2.post("validateEmailAddress", body);
    return res.data;
  } catch (error) {
    console.log(error);

    if (error.response && error.response.data?.error) {
      throw error.response.data.error;
    }
    console.error("❌ Network Error:", error.message);
    throw new Error(
      "Có sự cố khi kết nối đến hệ thống, vui lòng thử lại sau ít phút.",
    );
  }
};

export const updateAllowSearch = async (allowSearch) => {
  try {
    const body = {
      data: {
        username_discoverability_disabled: !allowSearch,
      },
    };

    const res = await instanceLocketV2.post("changeProfileInfo", body);
    const errorMessage = getLocketResultError(
      res.data,
      "Không thể cập nhật quyền tìm kiếm.",
    );
    if (errorMessage) throw new Error(errorMessage);

    return res.data?.result?.success !== false;
  } catch (error) {
    if (error.response && error.response.data?.error) {
      throw error.response.data.error;
    }

    if (error instanceof Error) throw error;

    throw new Error(
      "Có sự cố khi kết nối đến hệ thống, vui lòng thử lại sau ít phút.",
    );
  }
};

export const updateProfileName = async ({ firstName, lastName }) => {
  const first = String(firstName ?? "").trim();
  const last = String(lastName ?? "").trim();

  if (!first && !last) {
    throw new Error("Tên không được để trống.");
  }

  try {
    const res = await instanceLocketV2.post("changeProfileInfo", {
      data: {
        first_name: first,
        last_name: last,
      },
    });

    const errorMessage = getLocketResultError(
      res.data,
      "Locket từ chối cập nhật tên.",
    );
    if (errorMessage) throw new Error(errorMessage);

    return res.data;
  } catch (error) {
    const apiMessage = getApiErrorMessage(error, "Không thể cập nhật tên lúc này.");
    throw new Error(apiMessage);
  }
};

export const updateProfileBirthday = async ({ day, month }) => {
  const d = Number(day);
  const m = Number(month);

  if (!Number.isInteger(d) || !Number.isInteger(m) || d < 1 || d > 31 || m < 1 || m > 12) {
    throw new Error("Ngày sinh không hợp lệ.");
  }

  const probe = new Date(2024, m - 1, d);
  if (probe.getMonth() !== m - 1 || probe.getDate() !== d) {
    throw new Error("Ngày sinh không hợp lệ.");
  }

  const encodedMdd = m * 100 + d;

  try {
    const res = await instanceLocketV2.post("changeProfileInfo", {
      data: {
        birthday: {
          encoded_mdd: encodedMdd,
        },
      },
    });

    const errorMessage = getLocketResultError(
      res.data,
      "Locket từ chối cập nhật ngày sinh.",
    );
    if (errorMessage) throw new Error(errorMessage);

    return res.data;
  } catch (error) {
    const apiMessage = getApiErrorMessage(
      error,
      "Không thể cập nhật ngày sinh lúc này.",
    );
    throw new Error(apiMessage);
  }
};

export const updateProfileEmail = async (email) => {
  const normalized = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Email không hợp lệ.");
  }

  try {
    const res = await instanceLocketV2.post("updateEmailAddress", {
      data: { email: normalized },
    });

    const errorMessage = getLocketResultError(
      res.data,
      "Locket từ chối cập nhật email.",
    );
    if (errorMessage) throw new Error(errorMessage);

    return { email: normalized, data: res.data };
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, "Không thể cập nhật email lúc này."),
    );
  }
};

// Gửi OTP qua backend đang giữ phiên Locket + cấu hình client_token/analytics.
// Không gọi trực tiếp sendVerificationCode từ browser nữa vì Locket có thể trả
// response nhưng không thực sự gửi SMS nếu thiếu metadata của app.
export const requestProfilePhoneChange = async (phone, { isRetry = false } = {}) => {
  const normalized = normalizeLocketPhone(phone);

  try {
    const res = await instanceAuth.post("locket/profile/phone/request-otp", {
      phone: normalized,
      isRetry: Boolean(isRetry),
    });

    if (res.data?.success === false) {
      throw new Error(res.data?.message || "Locket không thể gửi mã xác minh.");
    }

    return { phone: normalized, data: res.data?.data || null };
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, "Không thể gửi mã xác minh số điện thoại."),
    );
  }
};

export const confirmProfilePhoneChange = async ({ phone, code }) => {
  const normalized = normalizeLocketPhone(phone);
  const verificationCode = String(code ?? "").trim();

  if (!/^\d{4,8}$/.test(verificationCode)) {
    throw new Error("Mã xác minh không hợp lệ.");
  }

  try {
    const res = await instanceAuth.post("locket/profile/phone/confirm-otp", {
      phone: normalized,
      code: verificationCode,
    });

    if (res.data?.success === false) {
      throw new Error(res.data?.message || "Mã xác minh không đúng hoặc đã hết hạn.");
    }

    return { phone: normalized, data: res.data?.data || null };
  } catch (error) {
    throw new Error(
      getApiErrorMessage(error, "Không thể xác minh số điện thoại."),
    );
  }
};