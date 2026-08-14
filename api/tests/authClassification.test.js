const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const {
  classifyFirebaseRefreshError,
  refreshIdToken,
} = require("../src/services/AuthSecurity/AuthServices");
const { firebase } = require("../src/config/app.config");

test("classifyFirebaseRefreshError maps rate limits to 429 non-terminal", () => {
  const err429 = { response: { status: 429, data: { error: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } } } };
  const classified = classifyFirebaseRefreshError(err429);
  assert.equal(classified.status, 429);
  assert.equal(classified.code, "TOO_MANY_ATTEMPTS_TRY_LATER");
  assert.equal(classified.terminal, false);
});

test("classifyFirebaseRefreshError maps config errors including PROJECT_NUMBER_MISMATCH to 503 non-terminal", () => {
  const errConfig = { response: { status: 400, data: { error: { message: "API_KEY_INVALID" } } } };
  const classified = classifyFirebaseRefreshError(errConfig);
  assert.equal(classified.status, 503);
  assert.equal(classified.code, "AUTH_CONFIG_ERROR");
  assert.equal(classified.terminal, false);

  const errMismatch = { response: { status: 400, data: { error: { message: "PROJECT_NUMBER_MISMATCH" } } } };
  const classifiedMismatch = classifyFirebaseRefreshError(errMismatch);
  assert.equal(classifiedMismatch.status, 503);
  assert.equal(classifiedMismatch.code, "AUTH_CONFIG_ERROR");
  assert.equal(classifiedMismatch.terminal, false);
});

test("classifyFirebaseRefreshError maps terminal expired/invalid tokens to 401 terminal", () => {
  const errExpired = { response: { status: 400, data: { error: { message: "TOKEN_EXPIRED" } } } };
  const classifiedExpired = classifyFirebaseRefreshError(errExpired);
  assert.equal(classifiedExpired.status, 401);
  assert.equal(classifiedExpired.code, "TOKEN_EXPIRED");
  assert.equal(classifiedExpired.terminal, true);

  const errInvalid = { response: { status: 400, data: { error: { message: "INVALID_REFRESH_TOKEN" } } } };
  const classifiedInvalid = classifyFirebaseRefreshError(errInvalid);
  assert.equal(classifiedInvalid.status, 401);
  assert.equal(classifiedInvalid.code, "REFRESH_TOKEN_INVALID");
  assert.equal(classifiedInvalid.terminal, true);

  const errDisabled = { response: { status: 400, data: { error: { message: "USER_DISABLED" } } } };
  const classifiedDisabled = classifyFirebaseRefreshError(errDisabled);
  assert.equal(classifiedDisabled.status, 401);
  assert.equal(classifiedDisabled.code, "USER_DISABLED");
  assert.equal(classifiedDisabled.terminal, true);

  const errNotFound = { response: { status: 400, data: { error: { message: "USER_NOT_FOUND" } } } };
  const classifiedNotFound = classifyFirebaseRefreshError(errNotFound);
  assert.equal(classifiedNotFound.status, 401);
  assert.equal(classifiedNotFound.code, "USER_NOT_FOUND");
  assert.equal(classifiedNotFound.terminal, true);
});

test("classifyFirebaseRefreshError maps upstream INVALID_GRANT_TYPE and MISSING_REFRESH_TOKEN to 502 non-terminal", () => {
  const errGrant = { response: { status: 400, data: { error: { message: "INVALID_GRANT_TYPE" } } } };
  const classifiedGrant = classifyFirebaseRefreshError(errGrant);
  assert.equal(classifiedGrant.status, 502);
  assert.equal(classifiedGrant.code, "AUTH_REFRESH_FAILED");
  assert.equal(classifiedGrant.terminal, false);

  const errMissing = { response: { status: 400, data: { error: { message: "MISSING_REFRESH_TOKEN" } } } };
  const classifiedMissing = classifyFirebaseRefreshError(errMissing);
  assert.equal(classifiedMissing.status, 502);
  assert.equal(classifiedMissing.code, "AUTH_REFRESH_FAILED");
  assert.equal(classifiedMissing.terminal, false);
});

test("classifyFirebaseRefreshError maps unknown 400 and unknown 401 to non-terminal", () => {
  // Unknown 400 without explicit Firebase terminal error message
  const unknown400 = { response: { status: 400, data: { error: { message: "UNKNOWN_BAD_REQUEST" } } } };
  const classified400 = classifyFirebaseRefreshError(unknown400);
  assert.equal(classified400.status, 502);
  assert.equal(classified400.code, "AUTH_REFRESH_FAILED");
  assert.equal(classified400.terminal, false);

  // Unknown 401 without explicit Firebase terminal code
  const unknown401 = { response: { status: 401, data: { message: "Unauthorized proxy response" } } };
  const classified401 = classifyFirebaseRefreshError(unknown401);
  assert.equal(classified401.status, 502);
  assert.equal(classified401.code, "AUTH_REFRESH_FAILED");
  assert.equal(classified401.terminal, false);

  // Unknown 403
  const unknown403 = { response: { status: 403, data: { message: "Forbidden by proxy" } } };
  const classified403 = classifyFirebaseRefreshError(unknown403);
  assert.equal(classified403.status, 502);
  assert.equal(classified403.code, "AUTH_REFRESH_FAILED");
  assert.equal(classified403.terminal, false);
});

test("classifyFirebaseRefreshError maps upstream 5xx to 502 non-terminal", () => {
  const err500 = { response: { status: 500, data: "Internal Error" } };
  const classified500 = classifyFirebaseRefreshError(err500);
  assert.equal(classified500.status, 502);
  assert.equal(classified500.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(classified500.terminal, false);

  const err503 = { response: { status: 503, data: "Service Unavailable" } };
  const classified503 = classifyFirebaseRefreshError(err503);
  assert.equal(classified503.status, 502);
  assert.equal(classified503.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(classified503.terminal, false);
});

test("classifyFirebaseRefreshError maps network / timeout to 503 non-terminal", () => {
  const netErr = new Error("getaddrinfo ENOTFOUND securetoken.googleapis.com");
  netErr.code = "ENOTFOUND";
  const classifiedNet = classifyFirebaseRefreshError(netErr);
  assert.equal(classifiedNet.status, 503);
  assert.equal(classifiedNet.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(classifiedNet.terminal, false);

  const timeoutErr = new Error("timeout of 30000ms exceeded");
  timeoutErr.code = "ECONNABORTED";
  const classifiedTimeout = classifyFirebaseRefreshError(timeoutErr);
  assert.equal(classifiedTimeout.status, 503);
  assert.equal(classifiedTimeout.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(classifiedTimeout.terminal, false);
});

test("refreshIdToken local missing token throws 401 terminal REFRESH_TOKEN_MISSING", async () => {
  await assert.rejects(
    async () => {
      await refreshIdToken("");
    },
    (err) => {
      assert.equal(err.status, 401);
      assert.equal(err.code, "REFRESH_TOKEN_MISSING");
      assert.equal(err.terminal, true);
      return true;
    },
  );
});

test("contract: refreshIdToken sends application/x-www-form-urlencoded with grant_type and refresh_token", async (t) => {
  const prevApiKey = firebase.apiKey;
  const prevEnvKey = process.env.FIREBASE_API_KEY;
  firebase.apiKey = "mock-firebase-api-key";
  process.env.FIREBASE_API_KEY = "mock-firebase-api-key";

  let capturedUrl = null;
  let capturedData = null;
  let capturedConfig = null;

  const originalCreate = axios.create;
  axios.create = function (config) {
    const instance = originalCreate.call(this, config);
    instance.post = async function (url, data, postConfig) {
      capturedUrl = url;
      capturedData = data;
      capturedConfig = postConfig;
      return {
        data: {
          id_token: "mock-id-token",
          refresh_token: "mock-refresh-token",
          expires_in: "3600",
          user_id: "mock-user-id",
        },
      };
    };
    return instance;
  };

  t.after(() => {
    axios.create = originalCreate;
    firebase.apiKey = prevApiKey;
    process.env.FIREBASE_API_KEY = prevEnvKey;
  });

  const dummyToken = "dummy-test-refresh-token-wire-format-abc123xyz";
  const result = await refreshIdToken(dummyToken);

  assert.equal(result.id_token, "mock-id-token");
  assert.equal(capturedUrl, "v1/token");
  assert.equal(
    capturedConfig?.headers?.["Content-Type"],
    "application/x-www-form-urlencoded",
  );

  // Wire format payload verification
  assert.equal(typeof capturedData, "string");
  const params = new URLSearchParams(capturedData);
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), dummyToken);

  // Ensure NO camelCase fields exist
  assert.equal(params.get("grantType"), null);
  assert.equal(params.get("refreshToken"), null);
  assert.equal(capturedData.includes("grantType"), false);
  assert.equal(capturedData.includes("refreshToken="), false);
});
