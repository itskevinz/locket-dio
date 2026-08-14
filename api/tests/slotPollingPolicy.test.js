const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_NORMAL_INTERVAL_MS,
  FAST_INTERVAL_MS,
  AUTO_REQUEST_INTERVAL_MS,
  FAST_WINDOW_MS,
  MIN_WORKER_DELAY_MS,
  clampNormalIntervalMs,
  hasSnapshotChanged,
  pollIntervalForState,
  rateLimitBackoffMs,
  jitteredIntervalMs,
  pollingIntervalsFromConfig,
} = require("../src/modules/slotMonitor/pollingPolicy");

test("normal polling defaults to 30 seconds and stays within safe bounds", () => {
  assert.equal(DEFAULT_NORMAL_INTERVAL_MS, 30_000);
  assert.equal(clampNormalIntervalMs(undefined), 30_000);
  assert.equal(clampNormalIntervalMs(1_000), 2_000);
  assert.equal(clampNormalIntervalMs(999_999), 180_000);
});

test("enabled Celeb auto-request watches poll every second", () => {
  assert.equal(AUTO_REQUEST_INTERVAL_MS, 1_000);
  assert.equal(MIN_WORKER_DELAY_MS, 1_000);
});

test("snapshot movement enables the 10-second fast window", () => {
  const watches = [{ friend_count: 999, max_friends: 1000 }];
  assert.equal(
    hasSnapshotChanged(watches, { friendCount: 998, maxFriends: 1000 }),
    true,
  );
  assert.equal(
    hasSnapshotChanged(watches, { friendCount: 999, maxFriends: 1000 }),
    false,
  );

  const now = 1_000_000;
  assert.equal(
    pollIntervalForState({ fastUntil: now + FAST_WINDOW_MS, now }),
    FAST_INTERVAL_MS,
  );
  assert.equal(
    pollIntervalForState({ fastUntil: now - 1, now }),
    DEFAULT_NORMAL_INTERVAL_MS,
  );
});

test("rate limits back off to 60 seconds then 120 seconds", () => {
  assert.equal(rateLimitBackoffMs(1), 60_000);
  assert.equal(rateLimitBackoffMs(2), 120_000);
  assert.equal(rateLimitBackoffMs(5), 120_000);
});

test("poll jitter is bounded and never creates a sub-1-second worker delay", () => {
  const low = jitteredIntervalMs(10_000, () => 0);
  const high = jitteredIntervalMs(10_000, () => 1);
  assert.ok(low >= 1_000 && low < 10_000);
  assert.ok(high > 10_000 && high <= 11_500);

  assert.equal(jitteredIntervalMs(AUTO_REQUEST_INTERVAL_MS, () => 0), 1_000);
  assert.ok(jitteredIntervalMs(AUTO_REQUEST_INTERVAL_MS, () => 1) <= 1_150);
});

test("public polling data reports every adaptive interval", () => {
  assert.deepEqual(pollingIntervalsFromConfig({}), {
    normalSeconds: 30,
    fastSeconds: 10,
    autoRequestSeconds: 1,
    fastWindowMinutes: 3,
  });

  assert.deepEqual(
    pollingIntervalsFromConfig({
      pollIntervalMs: 45_000,
      fastPollIntervalMs: 8_000,
      autoRequestPollIntervalMs: 2_000,
      fastWindowMs: 120_000,
    }),
    {
      normalSeconds: 45,
      fastSeconds: 8,
      autoRequestSeconds: 2,
      fastWindowMinutes: 2,
    },
  );
});
