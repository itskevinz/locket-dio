const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SendToFriendRequestDirect,
  getDirectRelationshipStatus,
  normalizeRelationshipValue,
} = require("../src/modules/directFriend/services/directFriendService");
const {
  instanceLocketDirect,
  createDirectClient,
  getDirectHeaders,
} = require("../src/libs/instanceLocketDirect");
const {
  sendDirectFriendRequestController,
} = require("../src/modules/directFriend/controllers/directFriendController");

test("normalizeRelationshipValue handles all friendship status variants", () => {
  assert.equal(normalizeRelationshipValue("friends"), "FRIENDS");
  assert.equal(normalizeRelationshipValue("friend"), "FRIENDS");
  assert.equal(normalizeRelationshipValue("outgoing-request"), "OUTGOING");
  assert.equal(normalizeRelationshipValue("outgoing_request"), "OUTGOING");
  assert.equal(normalizeRelationshipValue("outgoing-follow-request"), "OUTGOING");
  assert.equal(normalizeRelationshipValue("follower-waitlist"), "OUTGOING");
  assert.equal(normalizeRelationshipValue("incoming-request"), "INCOMING");
  assert.equal(normalizeRelationshipValue("none"), "NONE");
  assert.equal(normalizeRelationshipValue(null), "NONE");
  assert.equal(normalizeRelationshipValue(undefined), "NONE");
});

test("instanceLocketDirect: headers build from options.meta and meta is stripped from axios options", async () => {
  const capturedOptions = [];

  // Create custom client using axios instance spy
  const mockAxios = {
    post: async (endpoint, body, options) => {
      capturedOptions.push({ endpoint, body, options });
      return { status: 200, data: {} };
    },
    get: async (endpoint, options) => {
      capturedOptions.push({ endpoint, options });
      return { status: 200, data: {} };
    },
  };

  const client = {
    async post(endpoint, body, options = {}) {
      const idToken = options?.meta?.idToken;
      const appCheckToken = options?.meta?.appCheckToken;
      const headers = {
        ...getDirectHeaders({ idToken, appCheckToken }),
        ...(options?.headers || {}),
      };
      const {
        meta: _meta,
        idToken: _id,
        appCheckToken: _app,
        ...restOptions
      } = options || {};
      return mockAxios.post(endpoint, body, { ...restOptions, headers });
    },
  };

  // Call 1 with idToken + appCheckToken in meta
  await client.post("testEndpoint1", { a: 1 }, {
    meta: {
      idToken: "token-user-1",
      appCheckToken: "appcheck-1",
    },
    timeout: 5000,
  });

  assert.equal(capturedOptions.length, 1);
  assert.equal(capturedOptions[0].options.meta, undefined, "meta must be stripped from axios config");
  assert.equal(capturedOptions[0].options.idToken, undefined, "idToken must be stripped from axios config");
  assert.equal(capturedOptions[0].options.appCheckToken, undefined, "appCheckToken must be stripped from axios config");
  assert.equal(capturedOptions[0].options.timeout, 5000);
  assert.equal(capturedOptions[0].options.headers.Authorization, "Bearer token-user-1");
  assert.equal(capturedOptions[0].options.headers["X-Firebase-AppCheck"], "appcheck-1");

  // Call 2 with only idToken - appCheckToken must NOT bleed or exist
  await client.post("testEndpoint2", { b: 2 }, {
    meta: {
      idToken: "token-user-2",
    },
  });

  assert.equal(capturedOptions.length, 2);
  assert.equal(capturedOptions[1].options.meta, undefined);
  assert.equal(capturedOptions[1].options.headers.Authorization, "Bearer token-user-2");
  assert.equal(capturedOptions[1].options.headers["X-Firebase-AppCheck"], undefined, "AppCheck must not bleed");
});

test("preflight network error => UPSTREAM_ERROR and mutation is NOT called", async () => {
  let mutationCalled = false;

  const mockClient = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        const netErr = new Error("Network timeout connecting to Locket");
        netErr.status = 504;
        throw netErr;
      }
      if (endpoint === "sendFriendRequest") {
        mutationCalled = true;
        return { status: 200, data: {} };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const res = await SendToFriendRequestDirect({
    idToken: "token-preflight-fail",
    friendUid: "user-target-1",
    client: mockClient,
    delays: [0],
  });

  assert.equal(mutationCalled, false, "Mutation must NOT be called when preflight read fails");
  assert.equal(res.success, false);
  assert.equal(res.status, 504);
  assert.equal(res.code, "UPSTREAM_ERROR");
});

test("401/403: upstream authentication errors return proper error without mutation", async () => {
  const mockClient401 = {
    post: async (endpoint) => {
      const err = new Error("Unauthorized");
      err.response = { status: 401, data: { message: "Invalid token" } };
      throw err;
    },
  };

  const res401 = await SendToFriendRequestDirect({
    idToken: "token-401",
    friendUid: "target-user-1",
    client: mockClient401,
  });

  assert.equal(res401.success, false);
  assert.equal(res401.status, 401);
  assert.equal(res401.code, "UPSTREAM_AUTH_FAILED");

  const mockClient403 = {
    post: async (endpoint) => {
      const err = new Error("Forbidden");
      err.response = { status: 403, data: { message: "Forbidden" } };
      throw err;
    },
  };

  const res403 = await SendToFriendRequestDirect({
    idToken: "token-403",
    friendUid: "target-user-2",
    client: mockClient403,
  });

  assert.equal(res403.success, false);
  assert.equal(res403.status, 403);
  assert.equal(res403.code, "UPSTREAM_AUTH_FAILED");
});

test("FRIEND/OUTGOING: existing relation returns success without calling mutation", async () => {
  let mutationCalled = false;

  const mockClientFriends = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        return {
          data: {
            result: {
              data: {
                user_uid: "friend-1",
                friendship_status: "friends",
              },
            },
          },
        };
      }
      if (endpoint === "sendFriendRequest") {
        mutationCalled = true;
        return { data: { result: { data: null } } };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const resFriends = await SendToFriendRequestDirect({
    idToken: "token-user-a",
    friendUid: "friend-1",
    client: mockClientFriends,
  });

  assert.equal(mutationCalled, false, "Mutation should not be called when already friends");
  assert.equal(resFriends.success, true);
  assert.equal(resFriends.relationship, "FRIENDS");
  assert.equal(resFriends.sentNow, false);
  assert.equal(resFriends.alreadyPersisted, true);
  assert.equal(resFriends.data?.verified, true);

  let mutationCalledOutgoing = false;
  const mockClientOutgoing = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        return {
          data: {
            result: {
              data: {
                user_uid: "friend-2",
                friendship_status: "outgoing-request",
              },
            },
          },
        };
      }
      if (endpoint === "sendFriendRequest") {
        mutationCalledOutgoing = true;
        return { data: { result: { data: null } } };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const resOutgoing = await SendToFriendRequestDirect({
    idToken: "token-user-a",
    friendUid: "friend-2",
    client: mockClientOutgoing,
  });

  assert.equal(mutationCalledOutgoing, false, "Mutation should not be called when already outgoing");
  assert.equal(resOutgoing.success, true);
  assert.equal(resOutgoing.relationship, "OUTGOING");
  assert.equal(resOutgoing.sentNow, false);
  assert.equal(resOutgoing.alreadyPersisted, true);
});

test("HTTP 200 nhưng không có quan hệ: reports failure (REQUEST_NOT_CONFIRMED)", async () => {
  let mutationCalled = false;

  const mockClientUnconfirmed = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        return {
          data: {
            result: {
              data: {
                user_uid: "unconfirmed-user",
                friendship_status: "none",
              },
            },
          },
        };
      }
      if (endpoint === "sendFriendRequest") {
        mutationCalled = true;
        return {
          status: 200,
          data: {
            result: {
              data: { verified: true },
            },
          },
        };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const res = await SendToFriendRequestDirect({
    idToken: "token-unconfirmed",
    friendUid: "unconfirmed-user",
    client: mockClientUnconfirmed,
    delays: [0],
  });

  assert.equal(mutationCalled, true, "Mutation was sent");
  assert.equal(res.success, false, "Must not report success when relationship is not confirmed");
  assert.equal(res.status, 502);
  assert.equal(res.code, "REQUEST_NOT_CONFIRMED");
});

test("mutation 200 rồi verify network error => UPSTREAM_ERROR (not REQUEST_NOT_CONFIRMED)", async () => {
  let callCount = 0;

  const mockClient = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        callCount++;
        if (callCount === 1) {
          // Preflight succeeds and reports none
          return {
            data: {
              result: {
                data: {
                  user_uid: "user-net-fail",
                  friendship_status: "none",
                },
              },
            },
          };
        }
        // Post-mutation verify fails with network error
        const netErr = new Error("Upstream connection dropped");
        netErr.status = 503;
        throw netErr;
      }
      if (endpoint === "sendFriendRequest") {
        return { status: 200, data: {} };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const res = await SendToFriendRequestDirect({
    idToken: "token-verify-net-fail",
    friendUid: "user-net-fail",
    client: mockClient,
    delays: [0],
  });

  assert.equal(res.success, false);
  assert.equal(res.status, 503);
  assert.equal(res.code, "UPSTREAM_ERROR", "Must return UPSTREAM_ERROR, not REQUEST_NOT_CONFIRMED when verify network fails");
});

test("mutation rồi OUTGOING: mutation executes and real OUTGOING relationship is verified", async () => {
  let callCount = 0;
  let mutationCalled = false;

  const mockClientSuccess = {
    post: async (endpoint) => {
      if (endpoint === "fetchUserV2") {
        callCount++;
        return {
          data: {
            result: {
              data: {
                user_uid: "new-friend",
                friendship_status: callCount === 1 ? "none" : "outgoing-request",
              },
            },
          },
        };
      }
      if (endpoint === "sendFriendRequest") {
        mutationCalled = true;
        return {
          status: 200,
          data: { result: { data: null } },
        };
      }
      throw new Error("Unexpected endpoint: " + endpoint);
    },
  };

  const res = await SendToFriendRequestDirect({
    idToken: "token-success",
    friendUid: "new-friend",
    client: mockClientSuccess,
    delays: [0],
  });

  assert.equal(mutationCalled, true);
  assert.equal(res.success, true);
  assert.equal(res.relationship, "OUTGOING");
  assert.equal(res.sentNow, true);
  assert.equal(res.alreadyPersisted, false);
  assert.equal(res.data?.verified, true);
});

test("controller handles self-request and invalid-request properly", async () => {
  let statusResult = null;
  let jsonResult = null;

  const mockRes = {
    status: (s) => {
      statusResult = s;
      return {
        json: (j) => {
          jsonResult = j;
        },
      };
    },
  };

  // Self request test
  await sendDirectFriendRequestController(
    {
      user: { idToken: "token-self", localId: "user-123" },
      body: { friendUid: "user-123" },
    },
    mockRes,
    () => {},
  );

  assert.equal(statusResult, 400);
  assert.equal(jsonResult.code, "SELF_REQUEST");

  // Missing friendUid test
  await sendDirectFriendRequestController(
    {
      user: { idToken: "token-self", localId: "user-123" },
      body: {},
    },
    mockRes,
    () => {},
  );

  assert.equal(statusResult, 400);
  assert.equal(jsonResult.code, "INVALID_REQUEST");
});

test("static isolation: directFriend module and instanceLocketDirect have zero Dio dependencies", () => {
  const directFiles = [
    path.resolve(__dirname, "../src/libs/instanceLocketDirect.js"),
    path.resolve(__dirname, "../src/modules/directFriend/services/directFriendService.js"),
    path.resolve(__dirname, "../src/modules/directFriend/controllers/directFriendController.js"),
    path.resolve(__dirname, "../src/modules/directFriend/routes/directFriendRoutes.js"),
    path.resolve(__dirname, "../src/modules/directFriend/index.js"),
  ];

  for (const filePath of directFiles) {
    assert.equal(fs.existsSync(filePath), true, `${filePath} must exist`);
    const content = fs.readFileSync(filePath, "utf-8");

    assert.doesNotMatch(content, /tryDioFriendFallback/, `${filePath} must not contain tryDioFriendFallback`);
    assert.doesNotMatch(content, /sendViaDio/, `${filePath} must not contain sendViaDio`);
    assert.doesNotMatch(content, /dioFriendCompat/, `${filePath} must not import dioFriendCompat`);
    assert.doesNotMatch(content, /instanceLocketV2/, `${filePath} must not import instanceLocketV2`);
    assert.doesNotMatch(content, /verifyDioToken/, `${filePath} must not import or use verifyDioToken`);
    assert.doesNotMatch(content, /api\.locket-dio\.com/, `${filePath} must not contain dio domains`);
    assert.doesNotMatch(content, /api-beta\.locket-dio\.com/, `${filePath} must not contain dio beta domains`);
    assert.doesNotMatch(content, /FriendsController/, `${filePath} must not import legacy FriendsController`);
    assert.doesNotMatch(content, /RequestServices/, `${filePath} must not import legacy RequestServices`);
  }
});
