import { instanceLocketV2 } from "@/libs";

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
        username_discoverability_disable: !allowSearch,
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

/**
 * Đổi tên thật trên tài khoản Locket.
 * changeProfileInfo của Locket dùng đúng hai field first_name / last_name.
 */
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
    const apiMessage =
      error?.response?.data?.result?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.error;

    if (apiMessage) {
      throw new Error(
        typeof apiMessage === "string"
          ? apiMessage
          : "Locket từ chối cập nhật tên.",
      );
    }

    if (error instanceof Error) throw error;

    throw new Error("Không thể cập nhật tên lúc này.");
  }
};
