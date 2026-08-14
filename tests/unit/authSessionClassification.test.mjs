import test from "node:test";
import assert from "node:assert/strict";

import {
  getToken,
  saveToken,
  removeToken,
  clearAuthStorage,
} from "../../src/utils/storage/storage.js";

import {
  decideAuth401Action,
  decideRefreshErrorAction,
  shouldBypassSessionRefresh,
  isTerminalRefreshError,
  isTerminalRefreshErrorCode,
} from "../../src/libs/auth401Policy.js";

import {
  classifyFriendRequestError,
} from "../../src/features/FriendsContainer/FindFriend/friendSearchUtils.js";

function setupMockStorage() {
  const localMap = new Map();
  const sessionMap = new Map();

  const createStorageMock = (map) => ({
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  });

  globalThis.localStorage = createStorageMock(localMap);
  globalThis.sessionStorage = createStorageMock(sessionMap);

  return { localMap, sessionMap };
}

test("sessionStorage idToken works and getToken reads from sessionStorage", () => {
  const { localMap, sessionMap } = setupMockStorage();

  // Save in session mode
  saveToken(
    { idToken: "session-id-123", localId: "user-1", refreshToken: "refresh-1" },
    false,
  );

  assert.equal(sessionMap.get("idToken"), "session-id-123");
  assert.equal(sessionMap.get("refreshToken"), "refresh-1");
  assert.equal(sessionMap.get("localId"), "user-1");
  assert.equal(localMap.get("idToken"), undefined);

  const tokens = getToken();
  assert.equal(tokens.idToken, "session-id-123");
  assert.equal(tokens.refreshToken, "refresh-1");
  assert.equal(tokens.localId, "user-1");
});

test("missing idToken with present refreshToken can be retrieved by getToken", () => {
  const { sessionMap } = setupMockStorage();

  // Token expired: idToken is removed/missing, but refreshToken remains
  saveToken(
    { idToken: "old-id", localId: "user-1", refreshToken: "refresh-token-valid" },
    false,
  );
  sessionMap.delete("idToken");

  const tokens = getToken();
  assert.equal(tokens.idToken, null);
  assert.equal(tokens.refreshToken, "refresh-token-valid");
  assert.equal(tokens.localId, "user-1");
});

test("rotated token preserves storage mode (session vs local) and does not migrate to local", () => {
  const { localMap, sessionMap } = setupMockStorage();

  // User logs in with rememberMe = false
  saveToken(
    { idToken: "initial-id", localId: "user-1", refreshToken: "initial-refresh" },
    false,
  );

  assert.equal(sessionMap.get("idToken"), "initial-id");
  assert.equal(localMap.get("idToken"), undefined);

  // Rotation happens without explicitly passing rememberMe argument
  saveToken({
    idToken: "rotated-id-token",
    localId: "user-1",
    refreshToken: "rotated-refresh-token",
  });

  // Must still be in sessionStorage, NOT migrated to localStorage
  assert.equal(sessionMap.get("idToken"), "rotated-id-token");
  assert.equal(sessionMap.get("refreshToken"), "rotated-refresh-token");
  assert.equal(localMap.get("idToken"), undefined);
  assert.equal(localMap.get("refreshToken"), undefined);
});

test("rotated token preserves localStorage when rememberMe was true", () => {
  const { localMap, sessionMap } = setupMockStorage();

  // User logs in with rememberMe = true
  saveToken(
    { idToken: "local-id-1", localId: "user-2", refreshToken: "local-ref-1" },
    true,
  );

  assert.equal(localMap.get("idToken"), "local-id-1");
  assert.equal(sessionMap.get("idToken"), undefined);

  // Rotation happens without rememberMe argument
  saveToken({
    idToken: "rotated-local-id",
    localId: "user-2",
    refreshToken: "rotated-local-ref",
  });

  assert.equal(localMap.get("idToken"), "rotated-local-id");
  assert.equal(localMap.get("refreshToken"), "rotated-local-ref");
  assert.equal(sessionMap.get("idToken"), undefined);
});

test("partial payload callers preserve existing fields in storage", () => {
  const { sessionMap } = setupMockStorage();

  // Initial full save
  saveToken(
    { idToken: "initial-id", localId: "user-abc", refreshToken: "initial-refresh" },
    false,
  );

  // Partial save: only idToken updated
  saveToken({ idToken: "new-id-only" });

  assert.equal(sessionMap.get("idToken"), "new-id-only");
  assert.equal(sessionMap.get("localId"), "user-abc");
  assert.equal(sessionMap.get("refreshToken"), "initial-refresh");

  // Partial save: only refreshToken updated
  saveToken({ refreshToken: "new-refresh-only" });

  assert.equal(sessionMap.get("idToken"), "new-id-only");
  assert.equal(sessionMap.get("localId"), "user-abc");
  assert.equal(sessionMap.get("refreshToken"), "new-refresh-only");
});

test("sessionStorage storage mode and hydration resolves valid auth state", () => {
  setupMockStorage();

  // Simulated hydrate function matching AuthStore logic
  const hydrateFromStorage = () => {
    const { idToken, refreshToken } = getToken() || {};
    const token = idToken || refreshToken;
    if (!token) return { isAuth: false, loading: false };
    return { isAuth: true, loading: false };
  };

  // 1. Initially empty
  clearAuthStorage();
  assert.deepEqual(hydrateFromStorage(), { isAuth: false, loading: false });

  // 2. SessionStorage saved with rememberMe = false
  saveToken(
    { idToken: "session-jwt-token", localId: "user-123", refreshToken: "refresh-xyz" },
    false,
  );
  assert.deepEqual(hydrateFromStorage(), { isAuth: true, loading: false });

  // 3. Token expired (idToken missing) but refreshToken present in sessionStorage
  globalThis.sessionStorage.removeItem("idToken");
  assert.deepEqual(hydrateFromStorage(), { isAuth: true, loading: false });

  // 4. Logout / clear
  clearAuthStorage();
  assert.deepEqual(hydrateFromStorage(), { isAuth: false, loading: false });
});

test("clearAuthStorage removes tokens from both localStorage and sessionStorage", () => {
  const { localMap, sessionMap } = setupMockStorage();

  saveToken({ idToken: "id-1", localId: "u1", refreshToken: "ref-1" }, true);
  sessionMap.set("idToken", "ghost-session-id");
  sessionMap.set("refreshToken", "ghost-session-ref");

  clearAuthStorage();

  assert.equal(localMap.get("idToken"), undefined);
  assert.equal(localMap.get("refreshToken"), undefined);
  assert.equal(sessionMap.get("idToken"), undefined);
  assert.equal(sessionMap.get("refreshToken"), undefined);
});

test("explicit terminal refresh errors are classified as terminal", () => {
  assert.equal(isTerminalRefreshErrorCode("REFRESH_TOKEN_INVALID"), true);
  assert.equal(isTerminalRefreshErrorCode("TOKEN_EXPIRED"), true);
  assert.equal(isTerminalRefreshErrorCode("USER_DISABLED"), true);
  assert.equal(isTerminalRefreshErrorCode("USER_NOT_FOUND"), true);
  assert.equal(isTerminalRefreshErrorCode("REFRESH_TOKEN_MISSING"), true);
  assert.equal(isTerminalRefreshErrorCode("AUTH_REFRESH_TERMINAL"), true);

  // Upstream protocol / config errors are NOT terminal
  assert.equal(isTerminalRefreshErrorCode("INVALID_GRANT_TYPE"), false);
  assert.equal(isTerminalRefreshErrorCode("MISSING_REFRESH_TOKEN"), false);
  assert.equal(isTerminalRefreshErrorCode("REFRESH_TOKEN_REQUIRED"), false);
  assert.equal(isTerminalRefreshErrorCode("PROJECT_NUMBER_MISMATCH"), false);
  assert.equal(isTerminalRefreshErrorCode("AUTH_CONFIG_ERROR"), false);

  assert.equal(
    isTerminalRefreshError({
      status: 401,
      response: { status: 401, data: { code: "REFRESH_TOKEN_INVALID" } },
    }),
    true,
  );

  assert.equal(
    isTerminalRefreshError({
      status: 401,
      response: { status: 401, data: { code: "REFRESH_TOKEN_MISSING" } },
    }),
    true,
  );

  assert.equal(
    isTerminalRefreshError({
      status: 401,
      response: { status: 401, data: { code: "TOKEN_EXPIRED" } },
    }),
    true,
  );

  assert.equal(
    isTerminalRefreshError({
      status: 400,
      response: { status: 400, data: { error: { message: "INVALID_REFRESH_TOKEN" } } },
    }),
    true,
  );

  // Upstream protocol/config error responses -> NON-TERMINAL
  assert.equal(
    isTerminalRefreshError({
      status: 400,
      response: { status: 400, data: { error: { message: "INVALID_GRANT_TYPE" } } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      status: 400,
      response: { status: 400, data: { error: { message: "MISSING_REFRESH_TOKEN" } } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      status: 400,
      response: { status: 400, data: { error: { message: "PROJECT_NUMBER_MISMATCH" } } },
    }),
    false,
  );
});

test("unknown refresh 400 and 401 without explicit code are non-terminal", () => {
  // Unknown 401
  assert.equal(
    isTerminalRefreshError({
      status: 401,
      response: { status: 401, data: { message: "Unknown unauthorized" } },
    }),
    false,
  );

  // Unknown 400
  assert.equal(
    isTerminalRefreshError({
      status: 400,
      response: { status: 400, data: { error: "bad_request" } },
    }),
    false,
  );

  // Unknown 403
  assert.equal(
    isTerminalRefreshError({
      status: 403,
      response: { status: 403, data: { message: "Forbidden" } },
    }),
    false,
  );
});

test("Firebase 429/5xx/network errors are non-terminal and do not trigger session wipe", () => {
  // 429 rate limit
  assert.equal(
    isTerminalRefreshError({
      status: 429,
      response: { status: 429, data: { code: "TOO_MANY_ATTEMPTS_TRY_LATER" } },
    }),
    false,
  );

  // 502 / 503 gateway / upstream unavailable
  assert.equal(
    isTerminalRefreshError({
      status: 502,
      response: { status: 502, data: { code: "UPSTREAM_UNAVAILABLE" } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      status: 503,
      response: { status: 503, data: { code: "UPSTREAM_UNAVAILABLE" } },
    }),
    false,
  );

  // Network offline / timeout
  assert.equal(isTerminalRefreshError(new Error("Network Error")), false);
  assert.equal(isTerminalRefreshError({ code: "ECONNABORTED" }), false);
});

test("missing id_token in refresh response produces non-terminal decision", () => {
  const missingIdTokenErr = new Error("Refresh response missing id_token");
  missingIdTokenErr.authRefreshTerminal = false;
  missingIdTokenErr.code = "AUTH_REFRESH_TEMPORARY";

  const decision = decideRefreshErrorAction(missingIdTokenErr);
  assert.equal(decision.isTerminal, false);
  assert.equal(decision.action, "reject-only");
});

test("UPSTREAM_AUTH_FAILED on 401/403 bypasses session refresh and does not logout", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    true,
  );

  assert.equal(
    shouldBypassSessionRefresh({
      status: 403,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    true,
  );

  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { error: { code: "UPSTREAM_AUTH_FAILED" } },
    }),
    true,
  );

  // 500 does NOT bypass
  assert.equal(
    shouldBypassSessionRefresh({
      status: 500,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    false,
  );
});

test("friendSearchUtils classifies UPSTREAM_AUTH_FAILED separately from session-expired", () => {
  const upstreamError401 = {
    response: {
      status: 401,
      data: { code: "UPSTREAM_AUTH_FAILED" },
    },
  };
  assert.equal(classifyFriendRequestError(upstreamError401), "upstream-auth-failed");

  const upstreamError403 = {
    response: {
      status: 403,
      data: { code: "UPSTREAM_AUTH_FAILED" },
    },
  };
  assert.equal(classifyFriendRequestError(upstreamError403), "upstream-auth-failed");

  const regularAuth401 = {
    response: {
      status: 401,
      data: { code: "UNAUTHORIZED" },
    },
  };
  assert.equal(classifyFriendRequestError(regularAuth401), "session-expired");
});

test("production decision helper: 401 retry failure rejects without logging out", () => {
  // Production helper decideAuth401Action called with isRetry = true
  const decision = decideAuth401Action({
    status: 401,
    responseData: { message: "Permission Denied" },
    isRetry: true,
  });

  assert.equal(decision.action, "reject-no-logout");
  assert.equal(decision.reason, "retry-failed");
});

test("production decision helper: terminal refresh failure leads to logout decision", () => {
  const terminalErr = {
    authRefreshTerminal: true,
    code: "AUTH_REFRESH_TERMINAL",
    response: { status: 401, data: { code: "REFRESH_TOKEN_INVALID" } },
  };

  const decision = decideRefreshErrorAction(terminalErr);
  assert.equal(decision.isTerminal, true);
  assert.equal(decision.action, "logout-and-reject");
});

test("production decision helper: transient refresh failure leads to reject-only decision", () => {
  const transientErr = {
    authRefreshTerminal: false,
    code: "AUTH_REFRESH_TEMPORARY",
    response: { status: 502, data: { code: "UPSTREAM_UNAVAILABLE" } },
  };

  const decision = decideRefreshErrorAction(transientErr);
  assert.equal(decision.isTerminal, false);
  assert.equal(decision.action, "reject-only");
});
