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

test("fallback urls use Dio main as current primary for friend and celebrity", async (t) => {
  const axios = require("axios");

  t.mock.method(axios, "get", async (url) => {
    if (url.includes("/api/cn")) {
      return { status: 200, data: { data: { session: { member_token: "mt", header: "mh" } } }, headers: {} };
    }
    return { status: 200, data: { documents: [{ fields: { user_uid: { stringValue: "target" } } }] } };
  });

  const postUrls = [];
  t.mock.method(axios, "post", async (url) => {
    postUrls.push(url);
    if (url.includes("fetchUserV2")) {
      return { status: 200, data: { data: { result: { data: { friendship_status: "outgoing-follow-request" } } } } };
    }
    if (url.includes("sendCelebrityRequestV2")) {
      return { status: 200, data: { success: true, data: { result: { data: { relationship: "outgoing-follow-request" } } } } };
    }
    return { status: 200, data: { success: true, data: { result: { data: { ok: 1, relationship: "FRIEND" } } } } };
  });

  const { tryDioFriendFallback } = loadWithEnv("true");

  await tryDioFriendFallback({
    response: { status: 401 },
    config: {
      url: "sendFriendRequest",
      meta: { idToken: "token" },
      data: { data: { user_uid: "target" } }
    }
  });

  await tryDioFriendFallback({
    response: { status: 401 },
    config: {
      url: "sendFollowRequest",
      meta: { idToken: "token" },
      data: { data: { celebrity_uid: "target" } }
    }
  });

  const friendUrl = postUrls.find(u => u.includes("/locket/sendFriendRequestV2"));
  const celebUrl = postUrls.find(u => u.includes("/locket/sendCelebrityRequestV2"));

  assert.ok(friendUrl, "friendUrl should be called");
  assert.ok(celebUrl, "celebUrl should be called");
  assert.match(friendUrl, /api\.locket-dio\.com/);
  assert.doesNotMatch(friendUrl, /api-beta\.locket-dio\.com/);
  assert.match(celebUrl, /api\.locket-dio\.com/);
  assert.doesNotMatch(celebUrl, /api-beta\.locket-dio\.com/);
});

test("celebrity mutation tries beta only when the main route is missing", async (t) => {
  const axios = require("axios");

  t.mock.method(axios, "get", async (url) => {
    if (url.includes("/api/cn")) {
      return { status: 200, data: { data: { session: { member_token: "mt", header: "mh" } } }, headers: {} };
    }
    return { status: 200, data: { documents: [] } };
  });

  const postUrls = [];
  t.mock.method(axios, "post", async (url) => {
    postUrls.push(url);
    if (url.includes("api.locket-dio.com/locket/sendCelebrityRequestV2")) {
      return { status: 404, data: { success: false } };
    }
    if (url.includes("api-beta.locket-dio.com/locket/sendCelebrityRequestV2")) {
      return { status: 200, data: { success: true, data: { result: { data: { relationship: "follower-waitlist" } } } } };
    }
    return { status: 200, data: { data: { result: { data: {} } } } };
  });

  const { tryDioFriendFallback } = loadWithEnv("true");
  const response = await tryDioFriendFallback({
    response: { status: 401 },
    config: {
      url: "sendFollowRequest",
      meta: { idToken: "token" },
      data: { data: { celebrity_uid: "target" } }
    }
  });

  assert.ok(response, "fallback response should be verified");
  assert.equal(response.data.result.data.relationship, "follower-waitlist");
  assert.equal(
    postUrls.filter(u => u.includes("/locket/sendCelebrityRequestV2")).length,
    2,
  );
});
