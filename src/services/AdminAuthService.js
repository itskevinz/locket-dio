import { CONFIG } from "@/config";

// Older builds briefly exposed a trusted-device token to JavaScript.
// Remove any legacy copy and keep the 30-day token cookie-only.
try {
  localStorage.removeItem("huy_locket_trust_device");
} catch {
  /* storage may be unavailable */
}

function endpoint(path) {
  const baseUrl = String(CONFIG.api.baseUrl || "").replace(/\/$/, "");

  // On Vercel, admin API traffic must go through the existing same-origin
  // /api/admin rewrite. This makes the HttpOnly trusted-device cookie
  // first-party, so mobile browsers can reliably keep it for 30 days.
  if (typeof window !== "undefined") {
    const hostname = String(window.location.hostname || "").toLowerCase();
    if (hostname.endsWith(".vercel.app")) {
      return `/api/admin${path}`;
    }
  }

  return `${baseUrl}/api/admin${path}`;
}

function getLocketToken() {
  return localStorage.getItem("idToken") || sessionStorage.getItem("idToken") || "";
}

export function getShortAdminSessionToken() {
  try {
    return sessionStorage.getItem("admin_short_session") || "";
  } catch {
    return "";
  }
}

export function setShortAdminSessionToken(token) {
  try {
    if (token) sessionStorage.setItem("admin_short_session", token);
    else sessionStorage.removeItem("admin_short_session");
  } catch {
    /* ignore */
  }
}

export function clearShortAdminSessionToken() {
  try {
    sessionStorage.removeItem("admin_short_session");
  } catch {
    /* ignore */
  }
}

export function hasShortAdminSession() {
  return Boolean(getShortAdminSessionToken());
}

// Compatibility for existing Admin page imports. Trusted-device JWT stays
// inside the HttpOnly cookie and is never readable by frontend JavaScript.
export function setTrustedDeviceToken() {
  try {
    localStorage.removeItem("huy_locket_trust_device");
  } catch {
    /* storage may be unavailable */
  }
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Admin request failed");
    error.status = response.status;
    error.code = data.code || "ADMIN_REQUEST_FAILED";
    throw error;
  }
  return data;
}

export async function adminRequest(path, options = {}) {
  const token = getLocketToken();
  if (!token) {
    const error = new Error("Bạn cần đăng nhập Huy Locket");
    error.status = 401;
    throw error;
  }

  const adminSessionToken = getShortAdminSessionToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
  };
  if (adminSessionToken) {
    headers["X-Admin-Session"] = adminSessionToken;
  }

  const response = await fetch(endpoint(path), {
    ...options,
    credentials: "include",
    cache: options.cache || "no-store",
    headers,
  });
  return parseResponse(response);
}

export async function verifyAdminSession() {
  const result = await adminRequest("/verify");
  return result.isAdmin === true && result.role !== "user";
}

export async function getAdminRoleInfo() {
  const result = await adminRequest("/verify");
  return {
    isAdmin: result.isAdmin === true && result.role !== "user",
    role: result.role || "user",
    uid: result.uid,
    email: result.email,
    hasPin: result.hasPin || false,
    is2FAEnabled: result.is2FAEnabled || false,
  };
}

export async function startShortAdminSession(pin) {
  const result = await adminRequest("/session/create", {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  if (result.adminSessionToken) {
    setShortAdminSessionToken(result.adminSessionToken);
  }
  return result;
}

export async function verifyAdmin2FAOTP(tempToken, otpCode, rememberDevice = true) {
  const result = await adminRequest("/session/verify-2fa", {
    method: "POST",
    body: JSON.stringify({ tempToken, otpCode, rememberDevice }),
  });
  if (result.adminSessionToken) {
    setShortAdminSessionToken(result.adminSessionToken);
  }
  return result;
}

export async function changeAdminPin(oldPin, newPin) {
  return adminRequest("/pin/change", {
    method: "POST",
    body: JSON.stringify({ oldPin, newPin }),
  });
}

export function hasAdminSession() {
  return Boolean(getLocketToken());
}
