const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createMemoryRedisFallback } = require("../src/modules/appcheck/redis/memoryRedisFallback");

test("App Check memory fallback actually stores values and honors NX", async () => {
  const client = createMemoryRedisFallback();

  assert.equal(await client.set("device", { device_token: "abc" }), "OK");
  assert.equal(await client.get("device"), JSON.stringify({ device_token: "abc" }));
  assert.equal(await client.set("device", "other", { NX: true }), null);
  assert.equal(await client.exists("device"), 1);
  assert.equal(await client.del("device"), 1);
  assert.equal(await client.get("device"), null);
});

test("App Check memory fallback expires cached values", async () => {
  const client = createMemoryRedisFallback();
  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;

  try {
    await client.set("token", "cached", { EX: 2 });
    assert.equal(await client.get("token"), "cached");
    now = 3001;
    assert.equal(await client.get("token"), null);
  } finally {
    Date.now = originalNow;
  }
});

test("App Check device token is serialized and persisted encrypted for redeploy recovery", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/modules/appcheck/redis/appcheck.redis.js"),
    "utf8",
  );

  assert.match(source, /JSON\.stringify\(deviceToken\)/);
  assert.match(source, /encryptSecret\(payload\)/);
  assert.match(source, /slotStore\.setConfigValue\(PERSISTED_DEVICE_KEY/);
  assert.match(source, /readPersistedDeviceToken/);
  assert.match(source, /redisAppCheck\.set\(DEVICE_KEY, serializedToken/);
});

test("App Check access token is persisted encrypted for redeploy recovery", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../src/modules/appcheck/redis/appcheck.redis.js"),
    "utf8",
  );

  assert.match(source, /PERSISTED_TOKEN_KEY\s*=\s*"appcheck_token_v1"/);
  assert.match(source, /persistAppCheckToken\(token, ttlSeconds\)/);
  assert.match(source, /slotStore\.setConfigValue\(PERSISTED_TOKEN_KEY, encryptSecret\(payload\)\)/);
  assert.match(source, /readPersistedAppCheckToken/);
  assert.match(source, /redisAppCheck\.set\(TOKEN_KEY, persisted\.token/);
});
