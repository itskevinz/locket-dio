import test from "node:test";
import assert from "node:assert/strict";

import {
  getAuthErrorCode,
  isUpstreamAuthFailure,
  shouldBypassSessionRefresh,
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
});

test("does not refresh or logout Huy session for upstream 401", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { code: "UPSTREAM_AUTH_FAILED" },
    }),
    true,
  );
});

test("normal Huy auth 401 can still refresh the session", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: { code: "INVALID_TOKEN" },
    }),
    false,
  );
});

test("skipAuthRefresh means bypass refresh, not logout", () => {
  assert.equal(
    shouldBypassSessionRefresh({
      status: 401,
      responseData: {},
      skipAuthRefresh: true,
    }),
    true,
  );
});
