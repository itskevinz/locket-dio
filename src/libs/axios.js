import { clearLocalData, getToken, removeToken, removeUser } from "../utils";
import { CONFIG } from "@/config";
import { parseJwt } from "@/utils/auth";
import { SonnerInfo } from "@/components/uikit/SonnerToast";
import { instanceAuth } from "./instanceAuth";
import { createUploadClient } from "./createBase";
import { shouldBypassSessionRefresh } from "./auth401Policy";

const AUTH_REFRESH_TEMPORARY = "AUTH_REFRESH_TEMPORARY";
const AUTH_REFRESH_TERMINAL = "AUTH_REFRESH_TERMINAL";
const TOKEN_REFRESH_SKEW_SECONDS = 5 * 60;

let cachedToken = null;
let cachedExp = null;

function tokenExpiresSoon(token) {
  if (!token) return true;

  if (cachedToken !== token) {
    cachedToken = token;
    const payload = parseJwt(token);
    cachedExp = Number(payload?.exp || 0) || null;
  }

  if (!cachedExp) return true;
  const now = Math.floor(Date.now() / 1000);
  return cachedExp - now < TOKEN_REFRESH_SKEW_SECONDS;
}

function resetTokenCache() {
  cachedToken = null;
  cachedExp = null;
}

function announceTokenRefresh() {
  if (typeof window === "undefined") return;
  try {
    // Do not place the token itself in the event payload. SocketContext reads
    // the newest value from localStorage and updates Socket.IO auth in place.
    window.dispatchEvent(new Event("huy-locket-token-refreshed"));
  } catch {
    /* optional cross-module signal */
  }
}

let refreshPromise = null;

function makeRefreshError(cause, terminal = false) {
  const error = new Error(
    terminal
      ? "Phiên đăng nhập không còn hợp lệ"
      : "Tạm thời chưa thể làm mới phiên đăng nhập",
  );
  error.code = terminal ? AUTH_REFRESH_TERMINAL : AUTH_REFRESH_TEMPORARY;
  error.authRefreshTerminal = terminal;
  error.cause = cause;
  if (cause?.response) error.response = cause.response;
  if (cause?.status) error.status = cause.status;
  return error;
}

function isTerminalRefreshFailure(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  // Missing/invalid refresh token is terminal. Network, 429 and 5xx are not.
  return status === 400 || status === 401 || status === 403;
}

async function performTokenRefresh() {
  const { refreshToken } = getToken() || {};
  if (!refreshToken) {
    throw makeRefreshError(new Error("Missing refresh token"), true);
  }

  try {
    const res = await instanceAuth.post(
      "locket/refresh-token",
      { refreshToken },
      {
        // Refresh-token exchange is safe to retry on a temporary gateway error.
        safeToRetry: true,
        _gatewayRetryMax: 2,
        skipErrorToast: true,
      },
    );
    const newToken = res?.data?.data?.id_token;
    const newLocalId = res?.data?.data?.user_id;

    if (!newToken) {
      throw makeRefreshError(new Error("Refresh response missing id_token"), true);
    }

    localStorage.setItem("idToken", newToken);
    if (newLocalId) localStorage.setItem("localId", newLocalId);
    resetTokenCache();
    announceTokenRefresh();
    return newToken;
  } catch (error) {
    if (error?.code === AUTH_REFRESH_TERMINAL) throw error;
    throw makeRefreshError(error, isTerminalRefreshFailure(error));
  }
}

async function getFreshToken({ force = false } = {}) {
  const current = localStorage.getItem("idToken");
  if (!force && current && !tokenExpiresSoon(current)) return current;

  if (!refreshPromise) {
    refreshPromise = performTokenRefresh().finally(() => {
      refreshPromise = null;
    });
  }

  return refreshPromise;
}

function handleLogout() {
  refreshPromise = null;
  resetTokenCache();

  clearLocalData();
  removeUser();
  removeToken();
  localStorage.removeItem("idToken");
  localStorage.removeItem("localId");

  if (window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
}

function logoutForExpiredSession() {
  handleLogout();
  SonnerInfo("Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.");
}

const api = createUploadClient(CONFIG.api.baseUrl);

api.interceptors.request.use(async (config) => {
  let token = localStorage.getItem("idToken");

  if (!token) {
    const error = new Error("Not authenticated");
    error.status = 401;
    error.code = AUTH_REFRESH_TERMINAL;
    return Promise.reject(error);
  }

  if (tokenExpiresSoon(token)) {
    try {
      token = await getFreshToken();
    } catch (error) {
      // A temporary refresh outage must not erase a valid local session/draft.
      if (error?.authRefreshTerminal) {
        logoutForExpiredSession();
      }
      return Promise.reject(error);
    }
  }

  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status || error.status;
    const responseData = error.response?.data;
    const stringError =
      typeof responseData?.error === "string" ? responseData.error : null;
    const message =
      responseData?.message ||
      responseData?.error?.message ||
      stringError ||
      error.message ||
      "Có lỗi xảy ra";

    // Downstream upload queue reads response.data.message. Normalize APIs that
    // return { error: "..." } so they do not fall back to Axios' English text.
    if (
      responseData &&
      typeof responseData === "object" &&
      !Array.isArray(responseData) &&
      !responseData.message &&
      stringError
    ) {
      responseData.message = stringError;
    }

    const originalRequest = error.config;

    // A 401 from Locket itself (for example sendFriendRequest without a usable
    // App Check credential) is NOT proof that the user's Huy Locket session
    // expired. The API marks that condition as UPSTREAM_AUTH_FAILED. Never
    // refresh or log the user out for that upstream failure.
    if (
      originalRequest &&
      shouldBypassSessionRefresh({
        status,
        responseData,
        skipAuthRefresh: originalRequest.skipAuthRefresh,
      })
    ) {
      return Promise.reject(error);
    }

    if (status === 401 && originalRequest) {
      if (originalRequest._retry) {
        logoutForExpiredSession();
        return Promise.reject(error);
      }

      originalRequest._retry = true;
      try {
        // Always join the same in-flight refresh. This avoids one 401 request
        // logging the user out while another request is already refreshing.
        const newToken = await getFreshToken({ force: true });
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        if (refreshError?.authRefreshTerminal) {
          logoutForExpiredSession();
        }
        return Promise.reject(refreshError);
      }
    }

    if (!originalRequest) {
      return Promise.reject(error);
    }

    if (status === 403) {
      const errorCode = responseData?.error || responseData?.code;
      if (
        errorCode === "ACCOUNT_LOCKED" ||
        errorCode === "SESSION_REVOKED" ||
        String(message).toLowerCase().includes("locked")
      ) {
        SonnerInfo(
          "⛔ Tài khoản của bạn đã bị Quản Trị Viên khóa và cấm truy cập!",
        );
        handleLogout();
        return Promise.reject(error);
      }
      if (!originalRequest?.skipErrorToast) {
        SonnerInfo(message || "Bạn không có quyền truy cập!");
      }
    }

    if (status === 404 && !originalRequest?.skipErrorToast) {
      SonnerInfo(message || "Không tìm thấy nội dung yêu cầu.");
    }

    if (status === 429) {
      const retryAfterRaw = error.response?.headers?.["retry-after"];
      const retryAfterSeconds = Number.parseInt(retryAfterRaw, 10);
      error.noAutoRetry = true;
      error.retryAfterSeconds = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds
        : 15 * 60;

      if (!originalRequest?.skipErrorToast) {
        const waitText =
          error.retryAfterSeconds >= 60
            ? `${Math.ceil(error.retryAfterSeconds / 60)} phút`
            : `${error.retryAfterSeconds} giây`;

        SonnerInfo(
          message && !/^request failed with status code/i.test(message)
            ? `${message} Thử lại sau ${waitText}.`
            : `Bạn đã gửi quá nhiều yêu cầu. Thử lại sau ${waitText}.`,
        );
      }
    }

    const isOptionalConfigMsg =
      typeof message === "string" &&
      (/supabase/i.test(message) ||
        /SUPABASE_/i.test(message) ||
        /chưa cấu hình/i.test(message));

    if (
      status === 500 &&
      !isOptionalConfigMsg &&
      !originalRequest?.skipErrorToast
    ) {
      SonnerInfo(message || "Lỗi máy chủ. Vui lòng thử lại sau.");
    }

    if (
      (status === 502 || status === 503) &&
      !originalRequest?.skipErrorToast
    ) {
      SonnerInfo(
        "API đang khởi động. Đang thử lại — chờ thêm một chút.",
      );
    }

    if (status === 504 && !originalRequest?.skipErrorToast) {
      SonnerInfo(
        message || "Hết thời gian phản hồi từ máy chủ. Vui lòng thử lại sau.",
      );
    }

    if (
      !error.response &&
      originalRequest?._gatewayRetry >= 6 &&
      !originalRequest?.skipErrorToast
    ) {
      SonnerInfo(
        "Không kết nối được API. Thử lại sau một chút.",
      );
    }

    return Promise.reject(error);
  },
);

export default api;
