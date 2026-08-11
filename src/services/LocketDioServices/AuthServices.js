import { BETA_SERVER_HOST } from "@/config/apiConfig";
import api from "@/libs/axios";
import { instanceAuth } from "@/libs";
import { instanceMain } from "@/libs/instanceMain";
import { ValidateEmailAddress } from "../LocketServices";
//Login
export const loginWithEmail = async ({ email, password, captchaToken }) => {
  try {
    const data = await ValidateEmailAddress(email);

    if (data?.result?.status === 601) {
      const err = new Error("Tài khoản với email này không tồn tại!");
      err.status = 404;
      throw err;
    }

    const res = await instanceAuth.post("locket/loginV2", {
      email,
      password,
      captchaToken,
    });

    if (res.data?.success === false) {
      const err = new Error(res.data.message || "Đăng nhập thất bại");
      err.status = res.data.status || 400;
      throw err;
    }

    return res.data;
  } catch (error) {
    // Axios error
    if (error.response) {
      const err = new Error(
        error.response.data?.message || "Đăng nhập thất bại, vui lòng thử lại",
      );
      err.status = error.response.status;
      throw err;
    }

    // Error đã được throw ở trên
    if (error instanceof Error) {
      throw error;
    }

    // Fallback
    throw new Error("Có sự cố khi kết nối đến hệ thống");
  }
};

export const loginWithPhone = async ({ phone, password, captchaToken }) => {
  try {
    const body = {
      phone,
      password,
      captchaToken,
    };
    const res = await instanceAuth.post("locket/loginWithPhoneV2", body);
    // Kiểm tra nếu API trả về lỗi nhưng vẫn có status 200
    if (res.data?.success === false) {
      console.error("Login failed:", res.data.message);
      return null;
    }

    return res.data; // Trả về dữ liệu từ server
  } catch (error) {
    if (error.response && error.response.data?.error) {
      throw error.response.data.error; // ⬅️ Ném lỗi từ `error.response.data.error`
    }
    console.error("❌ Network Error:", error.message);
    throw new Error(
      "Có sự cố khi kết nối đến hệ thống, vui lòng thử lại sau ít phút.",
    );
  }
};

export const refreshIdTokenV2 = async () => {
  try {
    const res = await instanceAuth.post("locket/refresh-token");
    // Kiểm tra nếu API trả về lỗi nhưng vẫn có status 200
    if (res.data?.success === false) {
      console.error("Login failed:", res.data.message);
      return null;
    }

    return res.data.idToken; // Trả về dữ liệu từ API
  } catch (error) {
    if (error.response && error.response.data?.error) {
      throw error.response.data.error; // ⬅️ Ném lỗi từ `error.response.data.error`
    }
    console.error("❌ Network Error:", error.message);
    throw new Error(
      "Có sự cố khi kết nối đến hệ thống, vui lòng thử lại sau ít phút.",
    );
  }
};

export const refreshIdToken = async (refreshToken) => {
  try {
    const res = await instanceAuth.post(
      "locket/refresh-token",
      { refreshToken },
      { withCredentials: true }, // Nhận cookie từ server
    );
    // Kiểm tra nếu API trả về lỗi nhưng vẫn có status 200
    // if (res.data?.success === false) {
    //   console.error("Login failed:", res.data.message);
    //   return null;
    // }

    return res.data.idToken; // Trả về dữ liệu từ API
  } catch (error) {
    if (error.response && error.response.data?.error) {
      throw error.response.data.error; // ⬅️ Ném lỗi từ `error.response.data.error`
    }
    console.error("❌ Network Error:", error.message);
    throw new Error(
      "Có sự cố khi kết nối đến hệ thống, vui lòng thử lại sau ít phút.",
    );
  }
};

export const forgotPassword = async (email) => {
  try {
    const normalizedEmail = String(email || "").trim();
    if (!normalizedEmail) {
      throw new Error("Tài khoản chưa có email để đặt lại mật khẩu.");
    }

    // Dùng cùng auth client với login/refresh để luôn đi qua API hiện tại
    // (/dio-api hoặc VITE_AUTH_API_URL). BETA_SERVER_HOST có thể không được
    // cấu hình ở production nên đường dẫn cũ có thể thành undefined/locket/...
    const res = await instanceAuth.post("locket/resetPassword", {
      email: normalizedEmail,
    });

    if (res.data?.success === false) {
      throw new Error(res.data?.message || "Không gửi được email đổi mật khẩu.");
    }

    return res.data;
  } catch (error) {
    const message =
      error?.response?.data?.message ||
      error?.response?.data?.error?.message ||
      error?.response?.data?.error ||
      error?.message ||
      "Có sự cố khi gửi email đổi mật khẩu, vui lòng thử lại sau.";

    const err = new Error(
      typeof message === "string" ? message : "Không gửi được email đổi mật khẩu.",
    );
    err.status = error?.response?.status || error?.status;
    throw err;
  }
};

//Logout
export const logout = async () => {
  try {
    const response = await instanceAuth.get("locket/logout", {});
    return response.data; // ✅ Trả về dữ liệu từ API (ví dụ: { message: "Đã đăng xuất!" })
  } catch (error) {
    console.error(
      "❌ Lỗi khi đăng xuất:",
      error.response?.data || error.message,
    );
    throw error.response?.data || error.message; // ✅ Trả về lỗi nếu có
  }
};

export const GetUserLocket = async () => {
  try {
    const res = await instanceAuth.get("/locket/getInfoUser");
    return res.data?.data;
  } catch (error) {
    console.error(
      "❌ Lỗi khi lấy thông tin người dùng:",
      error.response?.data || error.message,
    );
    throw error.response?.data || error.message;
  }
};
