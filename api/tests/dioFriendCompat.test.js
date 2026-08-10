const test = require("node:test");
const assert = require("node:assert/strict");

const MODULE_PATH = require.resolve("../src/libs/dioFriendCompat");

function loadWithEnv(value) {
  if (value === undefined) delete process.env.DIO_FRIEND_FALLBACK_ENABLED;
  else process.env.DIO_FRIEND_FALLBACK_ENABLED = value;
  delete require.cache[MODULE_PATH];
  return require(MODULE_PATH);
}

test("Dio friend fallback is opt-in", () => {
  assert.equal(loadWithEnv(undefined).isEnabled(), false);
  assert.equal(loadWithEnv("false").isEnabled(), false);
  assert.equal(loadWithEnv("true").isEnabled(), true);
  assert.equal(loadWithEnv("1").isEnabled(), true);
});

test("only friend/follow 401 or 403 errors are fallback candidates", () => {
  const { isFriendFallbackCandidate } = loadWithEnv("true");
  const base = {
    config: {
      meta: { idToken: "token" },
    },
  };

  assert.equal(
    isFriendFallbackCandidate({
      ...base,
      response: { status: 401 },
      config: { ...base.config, url: "sendFriendRequest" },
    }),
    true,
  );
  assert.equal(
    isFriendFallbackCandidate({
      ...base,
      response: { status: 403 },
      config: { ...base.config, url: "/sendFollowRequest" },
    }),
    true,
  );
  assert.equal(
    isFriendFallbackCandidate({
      ...base,
      response: { status: 429 },
      config: { ...base.config, url: "sendFriendRequest" },
    }),
    false,
  );
  assert.equal(
    isFriendFallbackCandidate({
      ...base,
      response: { status: 401 },
      config: { ...base.config, url: "fetchUserV2" },
    }),
    false,
  );
  assert.equal(
    isFriendFallbackCandidate({
      response: { status: 401 },
      config: { url: "sendFriendRequest", meta: {} },
    }),
    false,
  );
});

test("Dio success payloads require explicit non-null mutation data", () => {
  const { normalizeDioSuccess } = loadWithEnv("true");

  assert.deepEqual(
    normalizeDioSuccess({ success: true, data: { result: { data: { ok: 1 } } } }),
    { result: { data: { ok: 1 } } },
  );
  assert.deepEqual(normalizeDioSuccess({ success: true, data: { ok: 1 } }), {
    result: { data: { ok: 1 } },
  });
  assert.deepEqual(normalizeDioSuccess({ result: { data: { ok: 1 } } }), {
    result: { data: { ok: 1 } },
  });

  assert.equal(normalizeDioSuccess({ success: false }), null);
  assert.equal(normalizeDioSuccess({ success: true, data: null }), null);
  assert.equal(normalizeDioSuccess({ success: true }), null);
  assert.equal(normalizeDioSuccess({ message: "ok" }), null);
  assert.equal(normalizeDioSuccess({ result: { data: null } }), null);
  assert.equal(
    normalizeDioSuccess({ success: true, data: { result: { data: null } } }),
    null,
  );
});
