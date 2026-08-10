const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");

const {
  CircuitBreaker,
  attachAxiosResilience,
  isSafeReadRequest,
  isTransientUpstreamError,
} = require("../src/services/upstreamResilience");

test("safe read policy never classifies write mutations as retryable", () => {
  assert.equal(isSafeReadRequest({ method: "get", url: "/anything" }), true);
  assert.equal(
    isSafeReadRequest({ method: "post", url: "/locket/getMomentV2" }),
    true,
  );
  assert.equal(
    isSafeReadRequest({ method: "post", url: "/locket/getAllFriendsV2" }),
    true,
  );
  assert.equal(
    isSafeReadRequest({ method: "post", url: "/locket/sendMessageV2" }),
    false,
  );
  assert.equal(
    isSafeReadRequest({ method: "post", url: "/locket/deleteFriendV2" }),
    false,
  );
  assert.equal(
    isSafeReadRequest({ method: "post", url: "/locket/acceptFriendRequestV2" }),
    false,
  );
});

test("only network and gateway failures are treated as transient", () => {
  assert.equal(isTransientUpstreamError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientUpstreamError({ response: { status: 503 } }), true);
  assert.equal(isTransientUpstreamError({ response: { status: 504 } }), true);
  assert.equal(isTransientUpstreamError({ response: { status: 401 } }), false);
  assert.equal(isTransientUpstreamError({ response: { status: 429 } }), false);
  assert.equal(isTransientUpstreamError({ response: { status: 500 } }), false);
});

test("circuit opens after threshold, then allows one half-open probe", () => {
  let now = 1_000;
  const breaker = new CircuitBreaker({
    name: "test",
    failureThreshold: 2,
    openMs: 5_000,
    now: () => now,
  });

  assert.equal(breaker.canRequest().allowed, true);
  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, "closed");

  breaker.recordFailure();
  assert.equal(breaker.snapshot().state, "open");
  assert.equal(breaker.canRequest().allowed, false);

  now += 5_001;
  assert.equal(breaker.canRequest().allowed, true);
  assert.equal(breaker.snapshot().state, "half_open");
  assert.equal(breaker.canRequest().allowed, false);

  breaker.recordSuccess();
  assert.equal(breaker.snapshot().state, "closed");
  assert.equal(breaker.snapshot().consecutive_failures, 0);
});

test("axios resilience retries safe reads but never retries mutations", async () => {
  let safeCalls = 0;
  const safeClient = axios.create({
    adapter: async (config) => {
      safeCalls += 1;
      const error = new Error("socket reset");
      error.code = "ECONNRESET";
      error.config = config;
      throw error;
    },
  });
  attachAxiosResilience(safeClient, {
    name: "safe-test",
    failureThreshold: 99,
    maxRetries: 2,
    retryDelaysMs: [0, 0],
  });

  await assert.rejects(
    safeClient.post("/getMomentV2", {}),
    /socket reset/,
  );
  assert.equal(safeCalls, 3);

  let mutationCalls = 0;
  const mutationClient = axios.create({
    adapter: async (config) => {
      mutationCalls += 1;
      const error = new Error("socket reset");
      error.code = "ECONNRESET";
      error.config = config;
      throw error;
    },
  });
  attachAxiosResilience(mutationClient, {
    name: "mutation-test",
    failureThreshold: 99,
    maxRetries: 2,
    retryDelaysMs: [0, 0],
  });

  await assert.rejects(
    mutationClient.post("/sendMessageV2", {}),
    /socket reset/,
  );
  assert.equal(mutationCalls, 1);
});
