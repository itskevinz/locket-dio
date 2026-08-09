const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const middlewarePath = path.join(
  apiRoot,
  "src/modules/appcheck/middlewares/appcheck.middleware.js",
);
const servicesIndexPath = path.join(apiRoot, "src/modules/appcheck/services/index.js");
const redisIndexPath = path.join(apiRoot, "src/modules/appcheck/redis/index.js");
const configPath = path.join(apiRoot, "src/modules/appcheck/config/index.js");
const webhookPath = path.join(apiRoot, "src/modules/appcheck/webhook/index.js");
const logPath = path.join(apiRoot, "src/utils/logEventUtils.js");

function mockModule(modulePath, exports) {
  require.cache[require.resolve(modulePath)] = {
    id: require.resolve(modulePath),
    filename: require.resolve(modulePath),
    loaded: true,
    exports,
  };
}

function loadMiddleware(getOrCreateAppCheckToken) {
  delete require.cache[require.resolve(middlewarePath)];

  mockModule(servicesIndexPath, {
    appCheckServices: { getOrCreateAppCheckToken },
  });
  mockModule(redisIndexPath, {
    redisStore: { markWebhookSent: async () => null },
  });
  mockModule(configPath, { collabKey: "test" });
  mockModule(webhookPath, { sendAppCheckFailedWebhook: async () => {} });
  mockModule(logPath, {
    logError: () => {},
    logInfo: () => {},
    logTable: () => {},
    logSuccess: () => {},
  });

  return require(middlewarePath);
}

function fakeResponse() {
  return {
    statusCalled: false,
    status() {
      this.statusCalled = true;
      return this;
    },
    json() {
      return this;
    },
  };
}

test("legacy initializeAppCheck lets friend request continue without a token", async () => {
  const middleware = loadMiddleware(async () => null);
  const req = {};
  const res = fakeResponse();
  let nextCalls = 0;

  await middleware.initializeAppCheck(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(res.statusCalled, false);
  assert.deepEqual(req.appcheck, {
    token: null,
    available: false,
  });
});

test("legacy initializeAppCheck also falls through when token generation errors", async () => {
  const error = new Error("DeviceCheck unavailable");
  error.code = "APPCHECK_GENERATION_FAILED";
  const middleware = loadMiddleware(async () => {
    throw error;
  });
  const req = {};
  const res = fakeResponse();
  let nextCalls = 0;

  await middleware.initializeAppCheck(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(res.statusCalled, false);
  assert.equal(req.appcheck.token, null);
  assert.equal(req.appcheck.available, false);
  assert.equal(req.appcheck.errorCode, "APPCHECK_GENERATION_FAILED");
});

test("raw DeviceCheck env token is never forwarded as X-Firebase-AppCheck", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/libs/instanceLocket.js"),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /appCheckToken\s*=([\s\S]{0,240})LOCKET_APP_CHECK_DEVICE_TOKEN/,
  );
  assert.match(source, /process\.env\.LOCKET_APP_CHECK_TOKEN/);
});
