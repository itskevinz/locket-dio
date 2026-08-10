import { CONFIG } from "@/config";
import currentBuild from "@/config/buildMeta.json";
import { getToken } from "@/utils";
import { toast } from "sonner";
import { saveAccountLockNotice } from "@/utils/accountLockNotice";

let isRevoking = false;
async function handleAuthRevocation(code, details = {}) {
  if (isRevoking) return;
  isRevoking = true;
  stopUserActivityLifecycle();

  const lockNotice = code === "ACCOUNT_LOCKED"
    ? saveAccountLockNotice({
        reason: details.reason,
        lockedAt: details.lockedAt,
      })
    : null;

  try {
    const { useAuthStore } = await import("@/stores/AuthStore");
    await useAuthStore.getState().clearAndlogout();
  } catch (err) {
    console.warn("Failed forced logout on revocation:", err);
  } finally {
    if (code === "ACCOUNT_LOCKED") {
      toast.error("⛔ Tài khoản đã bị Khóa", {
        description: `Lý do: ${lockNotice?.reason || "Không có lý do chi tiết từ Quản Trị Viên."}`,
        duration: 12000,
      });
    } else if (code === "SESSION_REVOKED") {
      toast.error("⛔ Phiên làm việc đã chấm dứt", {
        description: "Phiên làm việc hiện tại của bạn đã bị thu hồi bởi Quản Trị Viên hoặc đăng nhập lại trên thiết bị khác.",
        duration: 10000,
      });
    }
    setTimeout(() => {
      if (typeof window !== "undefined" && window.location.pathname !== "/login" && window.location.pathname !== "/") {
        window.location.href = "/login";
      }
      isRevoking = false;
    }, 1500);
  }
}

const SESSION_KEY = "huy_user_activity_session_v1";
const HEARTBEAT_INTERVAL_MS = 60_000;
const MIN_HEARTBEAT_GAP_MS = 30_000;
const GPS_REFRESH_INTERVAL_MS = 5 * 60_000; // Cập nhật GPS mỗi 5 phút
const RAILWAY_ACTIVITY_API = import.meta.env.VITE_ACTIVITY_API_URL
  || "https://huy-locket-api-production.up.railway.app";

let heartbeatTimer = null;
let visibilityHandler = null;
let lastHeartbeatAt = 0;
let lastGpsRefreshAt = 0;

function activityBaseUrl() {
  if (typeof window !== "undefined") {
    if (window.location.hostname === "duchi.vercel.app") return "/api/activity";
    if (window.location.hostname === "huy-locket-production.up.railway.app") {
      return `${String(RAILWAY_ACTIVITY_API).replace(/\/$/, "")}/api/activity`;
    }
  }
  const configured = String(CONFIG.api.baseUrl || "/dio-api")
    .replace(/\/$/, "");
  return `${configured}/api/activity`;
}

function createSessionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getSessionId({ renew = false } = {}) {
  if (renew) sessionStorage.removeItem(SESSION_KEY);
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = createSessionId();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}

async function activityRequest(path, body, { keepalive = false } = {}) {
  const { idToken } = getToken();
  if (!idToken) return null;
  const response = await fetch(`${activityBaseUrl()}${path}`, {
    method: "POST",
    keepalive,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Activity request failed");
    error.status = response.status;
    error.code = data.code || "ACTIVITY_REQUEST_FAILED";
    error.reason = data.reason || null;
    error.lockedAt = data.lockedAt || null;
    if (error.code === "ACCOUNT_LOCKED" || error.code === "SESSION_REVOKED") {
      handleAuthRevocation(error.code, {
        reason: error.reason,
        lockedAt: error.lockedAt,
      });
    }
    throw error;
  }
  return data;
}

function buildInfo() {
  return {
    version: currentBuild?.version || CONFIG.app.clientVersion || "unknown",
    buildId: currentBuild?.buildId || "unknown",
    commitHash: currentBuild?.commitHash || "unknown",
  };
}

let cachedGps = null;
let gpsPermissionAsked = false;

async function requestUserGpsLocation(force = false) {
  if (typeof window === "undefined" || !navigator.geolocation) return null;
  
  if (!force) {
    let permGranted = false;
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: "geolocation" });
        if (p.state === "granted") permGranted = true;
      }
    } catch (e) {
      /* ignore */
    }
    const consent = localStorage.getItem("HUY_LOCKET_GPS_CONSENT");
    if (consent !== "granted" && !permGranted) return null;
  } else {
    try {
      localStorage.setItem("HUY_LOCKET_GPS_CONSENT", "granted");
    } catch (e) {}
  }

  if (!force && cachedGps) return cachedGps;
  if (!force && gpsPermissionAsked) return null;
  gpsPermissionAsked = true;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        cachedGps = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        resolve(cachedGps);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
      { maximumAge: 60000, timeout: 8000, enableHighAccuracy: true }
    );
  });
}

export async function updateAndSyncGpsLocation(force = true) {
  if (typeof window === "undefined" || !navigator.geolocation) return null;
  cachedGps = null;
  gpsPermissionAsked = false;
  const gps = await requestUserGpsLocation(force);
  if (gps) {
    try {
      await activityRequest("/heartbeat", { sessionId: getSessionId(), gps });
    } catch (e) {
      console.warn("Failed syncing GPS location to heartbeat:", e);
    }
  }
  return gps;
}


export async function recordSuccessfulLogin({ loginMethod } = {}) {
  const sessionId = getSessionId({ renew: true });
  const gps = await requestUserGpsLocation();
  return activityRequest("/session", {
    sessionId,
    eventType: "login",
    loginMethod: loginMethod || "unknown",
    build: buildInfo(),
    gps,
  }, { keepalive: true });
}

async function registerResumedSession() {
  const gps = await requestUserGpsLocation();
  return activityRequest("/session", {
    sessionId: getSessionId(),
    eventType: "resume",
    build: buildInfo(),
    gps,
  });
}

async function sendHeartbeat({ force = false } = {}) {
  if (typeof document !== "undefined" && document.hidden) return;
  const now = Date.now();
  if (!force && now - lastHeartbeatAt < MIN_HEARTBEAT_GAP_MS) return;
  lastHeartbeatAt = now;

  // Định kỳ cập nhật lại GPS (mỗi 5 phút) thay vì dùng cache cũ mãi
  if (!cachedGps || now - lastGpsRefreshAt > GPS_REFRESH_INTERVAL_MS) {
    lastGpsRefreshAt = now;
    gpsPermissionAsked = false; // Reset để cho phép thử lại
    try {
      await requestUserGpsLocation();
    } catch { /* ignore */ }
  }

  return activityRequest("/heartbeat", { sessionId: getSessionId(), gps: cachedGps });
}

export function startUserActivityLifecycle() {
  stopUserActivityLifecycle();
  registerResumedSession()
    .then(() => sendHeartbeat({ force: true }))
    .catch((error) => console.warn("[activity] session registration skipped:", error.code || error.message));

  heartbeatTimer = window.setInterval(() => {
    sendHeartbeat().catch((error) => {
      console.warn("[activity] heartbeat skipped:", error.code || error.message);
    });
  }, HEARTBEAT_INTERVAL_MS);

  visibilityHandler = () => {
    if (!document.hidden) {
      sendHeartbeat().catch((error) => {
        console.warn("[activity] visible heartbeat skipped:", error.code || error.message);
      });
    }
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  return stopUserActivityLifecycle;
}

export function stopUserActivityLifecycle() {
  if (heartbeatTimer) window.clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (visibilityHandler) document.removeEventListener("visibilitychange", visibilityHandler);
  visibilityHandler = null;
}

export async function endUserActivitySession() {
  stopUserActivityLifecycle();
  const sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) return null;
  try {
    return await activityRequest("/logout", { sessionId }, { keepalive: true });
  } finally {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function fetchGlobalBroadcast() {
  try {
    const res = await fetch(`${activityBaseUrl()}/broadcast`);
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || null;
  } catch (err) {
    return null;
  }
}

export async function logWebUserAction({ actionType, actionTitle, details = null }) {
  const { idToken } = getToken();
  if (!idToken || !actionType || !actionTitle) return null;
  try {
    return await activityRequest("/action", {
      sessionId: getSessionId(),
      actionType,
      actionTitle,
      details,
    });
  } catch (err) {
    return null;
  }
}