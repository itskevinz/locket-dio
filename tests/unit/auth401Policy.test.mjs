import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAuth401Action,
  decideRefreshErrorAction,
  getAuthErrorCode,
  isTerminalRefreshError,
  isTerminalRefreshErrorCode,
  isUpstreamAuthFailure,
  shouldBypassSessionRefresh,
  TERMINAL_REFRESH_CODES,
  UPSTREAM_AUTH_FAILURE_CODE,
} from "../../src/libs/auth401Policy.js";

test("recognizes Locket upstream auth failures", () => {
  assert.equal(
    getAuthErrorCode({ code: "UPSTREAM_AUTH_FAILED" }),
    "UPSTREAM_AUTH_FAILED",
  );
  assert.equal(isUpstreamAuthFailure({ code: "UPSTREAM_AUTH_FAILED" }), true);
  assert.equal(
    isUpstreamAuthFailure({ error: { code: "upstream_auth_failed" } }),
    true,
  );
  assert.equal(
    isUpstreamAuthFailure({ error: "UPSTREAM_AUTH_FAILED" }),
    true,
  );
});

test("shouldBypassSessionRefresh bypasses on upstream 401 and 403 only", () => {
  // Upstream 401 bypasses
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { code: UPSTREAM_AUTH_FAILURE_CODE },
    }),
    true,
  );

  // Upstream 403 bypasses
  assert.equal(
    shouldBypassSessionRefresh({
      status: 403,
      responseData: { code: UPSTREAM_AUTH_FAILURE_CODE },
    }),
    true,
  );

  // Upstream failure on other status codes (e.g. 500, 400) does NOT bypass
  assert.equal(
    shouldBypassSessionRefresh({
      status: 500,
      responseData: { code: UPSTREAM_AUTH_FAILURE_CODE },
    }),
    false,
  );
  assert.equal(
    shouldBypassSessionRefresh({
      status: 400,
      responseData: { code: UPSTREAM_AUTH_FAILURE_CODE },
    }),
    false,
  );
});

test("ordinary backend 401 does not bypass session refresh", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { code: "INVALID_TOKEN" },
    }),
    false,
  );
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { message: "Unauthorized" },
    }),
    false,
  );
});

test("skipAuthRefresh explicitly bypasses session refresh on any status", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: {},
      skipAuthRefresh: true,
    }),
    true,
  );
  assert.equal(
    shouldBypassSessionRefresh({
      status: 200,
      responseData: {},
      skipAuthRefresh: true,
    }),
    true,
  );
});

test("isTerminalRefreshErrorCode identifies all explicit terminal codes", () => {
  for (const code of TERMINAL_REFRESH_CODES) {
    assert.equal(isTerminalRefreshErrorCode(code), true);
    assert.equal(isTerminalRefreshErrorCode(code.toLowerCase()), true);
  }

  // Non-terminal protocol / config / transient codes
  assert.equal(isTerminalRefreshErrorCode("INVALID_GRANT_TYPE"), false);
  assert.equal(isTerminalRefreshErrorCode("MISSING_REFRESH_TOKEN"), false);
  assert.equal(isTerminalRefreshErrorCode("REFRESH_TOKEN_REQUIRED"), false);
  assert.equal(isTerminalRefreshErrorCode("PROJECT_NUMBER_MISMATCH"), false);
  assert.equal(isTerminalRefreshErrorCode("AUTH_CONFIG_ERROR"), false);
  assert.equal(isTerminalRefreshErrorCode("UPSTREAM_AUTH_FAILED"), false);
  assert.equal(isTerminalRefreshErrorCode("TOO_MANY_ATTEMPTS_TRY_LATER"), false);
  assert.equal(isTerminalRefreshErrorCode("UPSTREAM_UNAVAILABLE"), false);
  assert.equal(isTerminalRefreshErrorCode("AUTH_REFRESH_FAILED"), false);
  assert.equal(isTerminalRefreshErrorCode(""), false);
  assert.equal(isTerminalRefreshErrorCode(null), false);
});

test("isTerminalRefreshError distinguishes explicit terminal from unknown/transient errors", () => {
  // Explicit terminal codes -> terminal (true)
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { code: "REFRESH_TOKEN_INVALID" } },
    }),
    true,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { code: "REFRESH_TOKEN_MISSING" } },
    }),
    true,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { code: "TOKEN_EXPIRED" } },
    }),
    true,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { code: "USER_DISABLED" } },
    }),
    true,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { code: "USER_NOT_FOUND" } },
    }),
    true,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 400, data: { error: { message: "INVALID_REFRESH_TOKEN" } } },
    }),
    true,
  );

  // Protocol / Config failures from upstream -> NON-TERMINAL (false)
  assert.equal(
    isTerminalRefreshError({
      response: { status: 400, data: { error: { message: "INVALID_GRANT_TYPE" } } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 400, data: { error: { message: "MISSING_REFRESH_TOKEN" } } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 400, data: { error: { message: "PROJECT_NUMBER_MISMATCH" } } },
    }),
    false,
  );

  // Unknown refresh 401/400 without explicit terminal code -> NON-TERMINAL (false)
  assert.equal(
    isTerminalRefreshError({
      response: { status: 401, data: { message: "Unauthorized" } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 400, data: { error: "bad_request" } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 403, data: { message: "Forbidden" } },
    }),
    false,
  );

  // Rate limit 429 -> non-terminal
  assert.equal(
    isTerminalRefreshError({
      response: { status: 429, data: { code: "TOO_MANY_ATTEMPTS_TRY_LATER" } },
    }),
    false,
  );

  // 5xx -> non-terminal
  assert.equal(
    isTerminalRefreshError({
      response: { status: 502, data: { code: "UPSTREAM_UNAVAILABLE" } },
    }),
    false,
  );
  assert.equal(
    isTerminalRefreshError({
      response: { status: 503, data: { code: "AUTH_REFRESH_FAILED" } },
    }),
    false,
  );

  // Network / timeout / missing response -> non-terminal
  assert.equal(isTerminalRefreshError(new Error("Network Error")), false);
  assert.equal(isTerminalRefreshError({ code: "ECONNABORTED" }), false);
});

test("decideAuth401Action implements production response 401 policy", () => {
  // Explicit skip
  assert.deepEqual(
    decideAuth401Action({ status: 401, skipAuthRefresh: true }),
    { action: "bypass", reason: "skip-auth-refresh" },
  );

  // Upstream failure on 401 / 403
  assert.deepEqual(
    decideAuth401Action({
      status: 401,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    { action: "bypass", reason: "upstream-auth-failed" },
  );
  assert.deepEqual(
    decideAuth401Action({
      status: 403,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    { action: "bypass", reason: "upstream-auth-failed" },
  );

  // Upstream failure on 500 is pass-through, not bypassed
  assert.deepEqual(
    decideAuth401Action({
      status: 500,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    { action: "pass-through" },
  );

  // Ordinary backend 401 (first attempt) -> refresh and retry
  assert.deepEqual(
    decideAuth401Action({
      status: 401,
      responseData: { code: "TOKEN_EXPIRED" },
      isRetry: false,
    }),
    { action: "refresh-and-retry" },
  );

  // Retry 401 (second attempt after refresh already retried) -> reject WITHOUT logging out
  assert.deepEqual(
    decideAuth401Action({
      status: 401,
      responseData: { message: "Permission Denied" },
      isRetry: true,
    }),
    { action: "reject-no-logout", reason: "retry-failed" },
  );

  // Non-401 status -> pass-through
  assert.deepEqual(
    decideAuth401Action({ status: 404 }),
    { action: "pass-through" },
  );
});

test("decideRefreshErrorAction determines whether to logout or reject only", () => {
  // Explicit terminal error -> logout-and-reject
  assert.deepEqual(
    decideRefreshErrorAction({
      authRefreshTerminal: true,
      response: { status: 401, data: { code: "REFRESH_TOKEN_INVALID" } },
    }),
    { isTerminal: true, action: "logout-and-reject" },
  );

  // Unknown 401/400 without explicit terminal code -> reject-only
  assert.deepEqual(
    decideRefreshErrorAction({
      response: { status: 401, data: { message: "Unknown 401" } },
    }),
    { isTerminal: false, action: "reject-only" },
  );

  // Missing id_token response error -> reject-only (non-terminal)
  const missingIdTokenErr = new Error("Refresh response missing id_token");
  missingIdTokenErr.authRefreshTerminal = false;
  missingIdTokenErr.code = "AUTH_REFRESH_TEMPORARY";
  assert.deepEqual(
    decideRefreshErrorAction(missingIdTokenErr),
    { isTerminal: false, action: "reject-only" },
  );

  // Transient rate limit or 5xx -> reject-only
  assert.deepEqual(
    decideRefreshErrorAction({
      response: { status: 429, data: { code: "TOO_MANY_ATTEMPTS_TRY_LATER" } },
    }),
    { isTerminal: false, action: "reject-only" },
  );
  assert.deepEqual(
    decideRefreshErrorAction({
      response: { status: 502, data: { code: "UPSTREAM_UNAVAILABLE" } },
    }),
    { isTerminal: false, action: "reject-only" },
  );
});
