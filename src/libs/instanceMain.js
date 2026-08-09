// Chủ yếu dùng cho các yêu cầu API chính của Huy Locket
import { CONFIG } from "@/config";
import { getToken, saveToken } from "@/utils";
import axios from "axios";
import { instanceAuth } from "./instanceAuth";

const BASE_URL = CONFIG.api.baseUrl;

// meta tĩnh của app
const APP_META = {
  "x-app-author": CONFIG.app.author,
  "x-app-name": CONFIG.app.shortname,
  "x-app-client": CONFIG.app.clientVersion,
  "x-app-api": CONFIG.app.apiVersion,
  "x-app-env": CONFIG.app.env,
};

// Chỉ cho phép một lần refresh token chạy tại một thời điểm trong cùng tab.
// Bên dưới còn có Web Locks + BroadcastChannel để phối hợp giữa nhiều tab.
let refreshPromise = null;
const AUTH_REFRESH_LOCK_NAME = "huy-locket-main-auth-refresh-v1";
const AUTH_REFRESH_CHANNEL_NAME = "huy-locket-main-auth-v1";
const SHARED_TOKEN_MAX_AGE_MS = 30_000;
const tabId =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let lastSharedToken = null;

// Conflict copies use a local id such as <draftId>__cloud_<revision>. The API
// only owns the canonical draft id. GET requests are safe to canonicalize and
// doing it here also fixes every old fallback path without touching edit/delete.
const CLOUD_FORK_SUFFIX_RE = /(__cloud_\d+)(?=\/|$)/i;
const missingDraftThumbnailReads = new Set();
const MAX_MISSING_THUMB_CACHE = 300;

function normalizeDraftReadUrl(rawUrl, method = "get") {
  if (String(method || "get").toLowerCase() !== "get") return rawUrl;
  if (typeof rawUrl !== "string" || !rawUrl.includes("/api/drafts/")) return rawUrl;
  return rawUrl.replace(CLOUD_FORK_SUFFIX_RE, "");
}

function draftThumbnailReadKey(rawUrl) {
  if (typeof rawUrl !== "string") return "";
  const normalized = normalizeDraftReadUrl(rawUrl, "get");
  if (!/\/api\/drafts\/[^/?]+\/media\/thumbnail(?:[/?#]|$)/i.test(normalized)) {
    return "";
  }
  try {
    const parsed = new URL(normalized, "https://huy-locket.local");
    return parsed.pathname;
  } catch {
    return normalized.split(/[?#]/, 1)[0];
  }
}

function rememberMissingDraftThumbnail(url) {
  const key = draftThumbnailReadKey(url);
  if (!key) return;
  if (missingDraftThumbnailReads.size >= MAX_MISSING_THUMB_CACHE) {
    const first = missingDraftThumbnailReads.values().next().value;
    if (first) missingDraftThumbnailReads.delete(first);
  }
  missingDraftThumbnailReads.add(key);
}

function makeCachedThumbnail404(config) {
  const error = new Error("DRAFT_THUMBNAIL_NOT_FOUND_CACHED");
  error.code = "DRAFT_THUMBNAIL_NOT_FOUND_CACHED";
  error.config = config;
  // Give retry wrappers a real 404 status so they do not treat this local skip
  // as a network failure and start exponential retries.
  error.response = { status: 404, data: null, config };
  return error;
}

const authRefreshChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(AUTH_REFRESH_CHANNEL_NAME)
    : null;

function canUseSharedToken(payload, current = getToken()) {
  if (!payload?.idToken || !current.refreshToken) return false;
  if (payload.source === tabId) return false;
  if (Date.now() - Number(payload.at || 0) > SHARED_TOKEN_MAX_AGE_MS) return false;
  if (payload.localId && current.localId && payload.localId !== current.localId) {
    return false;
  }
  return true;
}

if (authRefreshChannel) {
  authRefreshChannel.onmessage = (event) => {
    const payload = event?.data;
    const current = getToken();
    if (payload?.type !== "token-refreshed" || !canUseSharedToken(payload, current)) {
      return;
    }

    lastSharedToken = payload;
    // Cập nhật storage của chính tab này. Quan trọng khi rememberMe=false vì
    // sessionStorage không tự đồng bộ giữa các tab.
    saveToken({
      idToken: payload.idToken,
      localId: payload.localId || current.localId,
      refreshToken: payload.refreshToken || current.refreshToken,
    });
  };
}

function publishRefreshedToken({ idToken, localId, refreshToken }) {
  if (!authRefreshChannel) return;
  authRefreshChannel.postMessage({
    type: "token-refreshed",
    source: tabId,
    at: Date.now(),
    idToken,
    localId,
    refreshToken,
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function performMainIdTokenRefresh(staleIdToken = "") {
  // Sau khi chờ tab khác nhả Web Lock, cho BroadcastChannel một nhịp ngắn
  // để cập nhật sessionStorage trước khi quyết định có cần gọi refresh API nữa không.
  await sleep(60);

  let current = getToken();

  // Một request/tab khác vừa refresh xong: tái sử dụng token mới, không gọi API nữa.
  if (staleIdToken && current.idToken && current.idToken !== staleIdToken) {
    return current.idToken;
  }

  if (canUseSharedToken(lastSharedToken, current)) {
    saveToken({
      idToken: lastSharedToken.idToken,
      localId: lastSharedToken.localId || current.localId,
      refreshToken: lastSharedToken.refreshToken || current.refreshToken,
    });
    return lastSharedToken.idToken;
  }

  current = getToken();
  if (!current.refreshToken) {
    const error = new Error("REFRESH_TOKEN_REQUIRED");
    error.code = "REFRESH_TOKEN_REQUIRED";
    throw error;
  }

  const response = await instanceAuth.post("locket/refresh-token", {
    refreshToken: current.refreshToken,
  });
  const data = response?.data?.data || {};
  const idToken = data.id_token || data.idToken;
  const localId = data.user_id || data.localId || current.localId;
  const refreshToken =
    data.refresh_token || data.refreshToken || current.refreshToken;

  if (!idToken) {
    const error = new Error("TOKEN_REFRESH_FAILED");
    error.code = "TOKEN_REFRESH_FAILED";
    throw error;
  }

  // saveToken tự giữ đúng localStorage/sessionStorage theo rememberMe hiện tại.
  saveToken({ idToken, localId, refreshToken });
  publishRefreshedToken({ idToken, localId, refreshToken });
  return idToken;
}

async function refreshMainIdToken(staleIdToken = "") {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    // Web Locks là lock theo cùng origin nên ngăn nhiều tab cùng refresh một lúc.
    // Chrome/Edge/Android hiện đại hỗ trợ; browser cũ fallback về single-flight trong tab.
    if (
      typeof navigator !== "undefined" &&
      navigator.locks &&
      typeof navigator.locks.request === "function"
    ) {
      return navigator.locks.request(AUTH_REFRESH_LOCK_NAME, () =>
        performMainIdTokenRefresh(staleIdToken),
      );
    }

    return performMainIdTokenRefresh(staleIdToken);
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

// Tạo axios instance
export const instanceMain = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
    "x-api-key": CONFIG.keys.apiKey,
    ...APP_META,
  },
});

// Luôn lấy token mới nhất trước mỗi request.
instanceMain.interceptors.request.use(
  (config) => {
    config.url = normalizeDraftReadUrl(config.url, config.method);

    const thumbKey = draftThumbnailReadKey(config.url);
    if (thumbKey && missingDraftThumbnailReads.has(thumbKey)) {
      return Promise.reject(makeCachedThumbnail404(config));
    }

    const { idToken } = getToken();
    if (idToken) {
      config.headers["Authorization"] = `Bearer ${idToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Các API dùng instanceMain (đặc biệt Canh Slot 24/7) trước đây chỉ gắn
// idToken cũ nên sau khi token Firebase hết hạn sẽ nhận 401 cho tới khi reload/login.
// Khi gặp 401: phối hợp tất cả tab, refresh tối đa một lần rồi retry request đúng 1 lần.
instanceMain.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error?.config;
    const status = error?.response?.status;

    // A missing legacy thumbnail is expected data absence, not a transient
    // network error. Cache it for this tab so repeated renders do not hammer
    // Railway with the same 404; the draft layer can immediately try active media.
    if (status === 404 && originalRequest) {
      rememberMissingDraftThumbnail(originalRequest.url);
    }

    // Signed media URLs authenticate with their short-lived query signature.
    // A 401 there is not proof that the user's Firebase session expired, so it
    // must not start a refresh-token storm.
    if (
      status !== 401 ||
      !originalRequest ||
      originalRequest.skipAuthRefresh ||
      originalRequest._mainAuthRetry
    ) {
      return Promise.reject(error);
    }

    originalRequest._mainAuthRetry = true;

    try {
      const authHeader = String(
        originalRequest.headers?.Authorization ||
          originalRequest.headers?.authorization ||
          "",
      );
      const staleIdToken = authHeader.replace(/^Bearer\s+/i, "").trim();
      const newToken = await refreshMainIdToken(staleIdToken);
      originalRequest.headers = originalRequest.headers || {};
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return instanceMain(originalRequest);
    } catch (refreshError) {
      // Không xóa phiên ở đây: interceptor auth chung của app vẫn chịu trách nhiệm
      // đăng xuất nếu refresh token thực sự bị thu hồi/hết hiệu lực.
      refreshError.originalError = error;
      return Promise.reject(refreshError);
    }
  },
);
