const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const apiRoot = path.resolve(__dirname, "..");
const servicePath = path.join(
  apiRoot,
  "src/modules/appcheck/services/appcheck.service.js",
);
const configPath = path.join(apiRoot, "src/modules/appcheck/config/index.js");
const redisIndexPath = path.join(apiRoot, "src/modules/appcheck/redis/index.js");
const libsPath = path.join(apiRoot, "src/libs/index.js");
const logPath = path.join(apiRoot, "src/utils/logEventUtils.js");

function mockModule(modulePath, exports) {
  require.cache[require.resolve(modulePath)] = {
    id: require.resolve(modulePath),
    filename: require.resolve(modulePath),
    loaded: true,
    exports,
  };
}

function loadService({
  deviceToken = null,
  cachedToken = null,
  onPost = null,
} = {}) {
  delete require.cache[require.resolve(servicePath)];

  mockModule(configPath, {
    deviceToken: { deviceId: "test-app-id" },
  });
  mockModule(redisIndexPath, {
    redisStore: {
      getDeviceToken: async () => deviceToken,
      getAppCheckToken: async () => cachedToken,
      saveAppCheckToken: async () => {},
      saveDeviceToken: async () => {},
    },
  });
  mockModule(libsPath, {
    instanceAppcheck: {
      post: async (url, body) => {
        if (onPost) onPost(url, body);
        return { data: { token: "generated", ttl: "3600s" } };
      },
    },
  });
  mockModule(logPath, {
    logInfo: () => {},
    logError: () => {},
  });

  return require(servicePath);
}

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;

  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
}

test("prefers configured legacy App Check token", async () => {
  await withEnv("LOCKET_APP_CHECK_TOKEN", "configured-app-check", async () => {
    const service = loadService();
    assert.equal(
      await service.getOrCreateAppCheckToken(),
      "configured-app-check",
    );
  });
});

test("reuses cached App Check token even when DeviceCheck source is unavailable", async () => {
  await withEnv("LOCKET_APP_CHECK_TOKEN", undefined, async () => {
    await withEnv("LOCKET_APP_CHECK_DEVICE_TOKEN", undefined, async () => {
      const service = loadService({ cachedToken: "cached-app-check" });
      assert.equal(await service.getOrCreateAppCheckToken(), "cached-app-check");
    });
  });
});

test("returns null when no App Check or DeviceCheck source exists", async () => {
  await withEnv("LOCKET_APP_CHECK_TOKEN", undefined, async () => {
    await withEnv("LOCKET_APP_CHECK_DEVICE_TOKEN", undefined, async () => {
      const service = loadService({ deviceToken: null });
      assert.equal(await service.getOrCreateAppCheckToken(), null);
    });
  });
});

test("exchanges stored DeviceCheck token using Firebase REST camelCase fields", async () => {
  await withEnv("LOCKET_APP_CHECK_TOKEN", undefined, async () => {
    await withEnv("LOCKET_APP_CHECK_DEVICE_TOKEN", undefined, async () => {
      let request = null;
      const service = loadService({
        deviceToken: { device_token: "device-check", limited_use: true },
        onPost: (url, body) => {
          request = { url, body };
        },
      });

      assert.equal(await service.getOrCreateAppCheckToken(), "generated");
      assert.match(request.url, /exchangeDeviceCheckToken$/);
      assert.deepEqual(request.body, {
        deviceToken: "device-check",
        limitedUse: true,
      });
      assert.equal("device_token" in request.body, false);
    });
  });
});

test("uses LOCKET_APP_CHECK_DEVICE_TOKEN as an exchange source, not an App Check token", async () => {
  await withEnv("LOCKET_APP_CHECK_TOKEN", undefined, async () => {
    await withEnv("LOCKET_APP_CHECK_DEVICE_TOKEN", "env-device-check", async () => {
      let requestBody = null;
      const service = loadService({
        deviceToken: null,
        onPost: (_url, body) => {
          requestBody = body;
        },
      });

      assert.equal(await service.getOrCreateAppCheckToken(), "generated");
      assert.deepEqual(requestBody, {
        deviceToken: "env-device-check",
        limitedUse: false,
      });
    });
  });
});

test("normalizes legacy and Firebase DeviceCheck token shapes", () => {
  const service = loadService();

  assert.deepEqual(service.normalizeDeviceCheckToken({
    device_token: "legacy",
    limited_use: true,
  }), {
    deviceToken: "legacy",
    limitedUse: true,
  });

  assert.deepEqual(service.normalizeDeviceCheckToken(JSON.stringify({
    deviceToken: "modern",
    limitedUse: false,
  })), {
    deviceToken: "modern",
    limitedUse: false,
  });
});
