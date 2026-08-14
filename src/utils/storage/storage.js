// Lưu vào storage với thời gian hết hạn
export const setAuthStorage = (idToken, localId, type = "local", expiresAt) => {
  const storage = type === "local" ? localStorage : sessionStorage;
  storage.setItem("idToken", idToken);
  storage.setItem("localId", localId);
  if (expiresAt !== undefined && expiresAt !== null) {
    storage.setItem("expiresAt", expiresAt.toString());
  }
};

// Lấy thông tin token
export const getAuthStorage = () => {
  const isLocal =
    localStorage.getItem("idToken") !== null ||
    localStorage.getItem("refreshToken") !== null;
  const storage = isLocal ? localStorage : sessionStorage;
  const rawExpiresAt = storage.getItem("expiresAt");
  return {
    idToken: storage.getItem("idToken"),
    localId: storage.getItem("localId"),
    refreshToken: storage.getItem("refreshToken"),
    expiresAt: rawExpiresAt ? parseInt(rawExpiresAt, 10) : null,
  };
};

// Xoá token khỏi cả localStorage và sessionStorage
export const clearAuthStorage = () => {
  localStorage.removeItem("idToken");
  localStorage.removeItem("localId");
  localStorage.removeItem("refreshToken");
  localStorage.removeItem("expiresAt");
  localStorage.removeItem("rememberMe");

  sessionStorage.removeItem("idToken");
  sessionStorage.removeItem("localId");
  sessionStorage.removeItem("refreshToken");
  sessionStorage.removeItem("expiresAt");
  sessionStorage.removeItem("rememberMe");
};

const storage = {
  set(key, value, rememberMe) {
    const target = rememberMe ? localStorage : sessionStorage;
    const other = rememberMe ? sessionStorage : localStorage;
    if (value !== undefined && value !== null) {
      target.setItem(key, String(value));
    } else {
      target.removeItem(key);
    }
    other.removeItem(key);
  },

  get(key) {
    const rememberMe =
      localStorage.getItem("rememberMe") ?? sessionStorage.getItem("rememberMe");
    if (rememberMe === "false") {
      return sessionStorage.getItem(key) || localStorage.getItem(key);
    }
    return localStorage.getItem(key) || sessionStorage.getItem(key);
  },

  remove(key) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

// Lưu token và giữ đúng storage mode (localStorage vs sessionStorage)
export function saveToken(tokens = {}, rememberMe) {
  const safeTokens = tokens || {};
  let finalRememberMe;
  if (rememberMe !== undefined) {
    finalRememberMe = Boolean(rememberMe);
    localStorage.setItem("rememberMe", String(finalRememberMe));
  } else {
    const saved =
      localStorage.getItem("rememberMe") ?? sessionStorage.getItem("rememberMe");
    if (saved !== null) {
      finalRememberMe = saved === "true";
    } else if (
      sessionStorage.getItem("refreshToken") !== null ||
      sessionStorage.getItem("idToken") !== null
    ) {
      finalRememberMe = false;
    } else if (
      localStorage.getItem("refreshToken") !== null ||
      localStorage.getItem("idToken") !== null
    ) {
      finalRememberMe = true;
    } else {
      finalRememberMe = true;
    }
  }

  const existingTokens = getToken();
  const nextIdToken =
    safeTokens.idToken !== undefined ? safeTokens.idToken : existingTokens.idToken;
  const nextRefreshToken =
    safeTokens.refreshToken !== undefined
      ? safeTokens.refreshToken
      : existingTokens.refreshToken;
  const nextLocalId =
    safeTokens.localId !== undefined ? safeTokens.localId : existingTokens.localId;

  storage.set("idToken", nextIdToken, finalRememberMe);
  storage.set("refreshToken", nextRefreshToken, finalRememberMe);
  storage.set("localId", nextLocalId, finalRememberMe);
}

export function getToken() {
  const idToken = storage.get("idToken"); // có thể null nếu hết hạn
  const refreshToken = storage.get("refreshToken");
  const localId = storage.get("localId");
  return { idToken, localId, refreshToken }; // ⚠️ idToken có thể null (hợp lệ)
}

export function removeToken() {
  storage.remove("idToken");
  storage.remove("refreshToken");
  storage.remove("localId");
  storage.remove("expiresAt");
  localStorage.removeItem("rememberMe");
  sessionStorage.removeItem("rememberMe");
}