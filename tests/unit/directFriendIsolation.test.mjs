import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Direct Beta backend chain is completely isolated from Dio", async () => {
  const directRoute = await read("api/src/modules/directFriend/routes/directFriendRoutes.js");
  const directController = await read("api/src/modules/directFriend/controllers/directFriendController.js");
  const directService = await read("api/src/modules/directFriend/services/directFriendService.js");
  const directClient = await read("api/src/libs/instanceLocketDirect.js");

  const files = [
    { name: "directFriendRoutes.js", content: directRoute },
    { name: "directFriendController.js", content: directController },
    { name: "directFriendService.js", content: directService },
    { name: "instanceLocketDirect.js", content: directClient },
  ];

  for (const { name, content } of files) {
    assert.doesNotMatch(content, /tryDioFriendFallback/, `${name} must not contain tryDioFriendFallback`);
    assert.doesNotMatch(content, /sendViaDio/, `${name} must not contain sendViaDio`);
    assert.doesNotMatch(content, /dioFriendCompat/, `${name} must not contain dioFriendCompat`);
    assert.doesNotMatch(content, /verifyDioToken/, `${name} must not contain verifyDioToken`);
    assert.doesNotMatch(content, /instanceLocketV2/, `${name} must not contain instanceLocketV2`);
    assert.doesNotMatch(content, /api\.locket-dio\.com/, `${name} must not contain dio domains`);
    assert.doesNotMatch(content, /api-beta\.locket-dio\.com/, `${name} must not contain dio beta domains`);
    assert.doesNotMatch(content, /FriendsController/, `${name} must not contain FriendsController`);
    assert.doesNotMatch(content, /RequestServices/, `${name} must not contain RequestServices`);
  }

  // Check specific route protections
  assert.match(directRoute, /\/sendFriendRequestDirectV2/);
  assert.match(directRoute, /verifyIdToken/);
  assert.match(directRoute, /initializeOptionalAppCheck/);

  // Check service logic
  assert.match(directService, /SendToFriendRequestDirect/);
  assert.match(directService, /getDirectRelationshipStatus/);
  assert.match(directService, /waitForVerifiedDirectRelationship/);
  assert.match(directService, /REQUEST_NOT_CONFIRMED/);
  assert.match(directService, /UPSTREAM_AUTH_FAILED/);
});

test("Frontend RequestServices exports SendRequestToFriendDirect calling locket/sendFriendRequestDirectV2", async () => {
  const source = await read("src/services/LocketDioServices/RequestServices.js");
  assert.match(source, /api\.post\(["']locket\/sendFriendRequestDirectV2["']/);
  assert.match(source, /export const SendRequestToFriendDirect/);
});

test("Old friend stack and Dio compatibility remain 100% intact (regression guard)", async () => {
  const routes = await read("api/src/routes/locketRoutes.js");
  const reqServices = await read("src/services/LocketDioServices/RequestServices.js");
  const backendReqServices = await read("api/src/services/LocketFriend/RequestServices.js");
  const dioCompat = await read("api/src/libs/dioFriendCompat.js");
  const findFriend = await read("src/features/FriendsContainer/FindFriend/index.jsx");
  const normalItem = await read("src/features/FriendsContainer/FindFriend/NormalItemFriend.jsx");

  // Old route still has verifyDioToken and old controller
  assert.match(routes, /router\.post\(["']\/sendFriendRequestV2["'],\s*friendRequestLimiter,\s*checkAppMeta,\s*verifyIdToken,\s*verifyDioToken,\s*initializeAppCheck,\s*friendcontroll\.SendRequestToFriendsController\)/);
  assert.match(routes, /router\.post\(["']\/sendCelebrityRequestV2["'],\s*friendRequestLimiter,\s*checkAppMeta,\s*verifyIdToken,\s*verifyDioToken,\s*initializeAppCheck,\s*friendcontroll\.SendRequestToCelebrityController\)/);

  // Old frontend request services still target sendFriendRequestV2
  assert.match(reqServices, /api\.post\(["']locket\/sendFriendRequestV2["']/);

  // Old backend request services still use instanceLocketV2 and Dio fallback
  assert.match(backendReqServices, /instanceLocketV2\.post\(["']sendFriendRequest["']/);

  // Dio friend fallback remains present
  assert.match(dioCompat, /DIO_FRIEND_FALLBACK_ENABLED/);
  assert.match(dioCompat, /tryDioFriendFallback/);

  // FindFriend preserves all original search and deep link markers
  assert.match(findFriend, /FindFriendByUserName/);
  assert.match(findFriend, /getFriendshipStatus/);
  assert.match(findFriend, /SendRequestToFriend\(/);
  assert.match(findFriend, /SendRequestToCelebrity\(/);
  assert.match(findFriend, /useSlotMonitor/);
  assert.match(findFriend, /slotJumpHandledRef/);
  assert.match(findFriend, /syncAfterConfirmedRequest/);
  assert.match(findFriend, /handleDirectAddFriend/);

  // NormalItemFriend preserves badge enrich and action button
  assert.match(normalItem, /FriendActionButton/);
  assert.match(normalItem, /formatFriendSince/);
  assert.match(normalItem, /fetchUserById/);
  assert.match(normalItem, /handleDirectAddFriend/);
});
