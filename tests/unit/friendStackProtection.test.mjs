import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

/**
 * CRITICAL REGRESSION GUARD
 *
 * The friend-request stack was verified in production on 2026-08-09.
 * These tests intentionally protect the working architecture without changing
 * any production source code. If one of these assertions fails, do not update
 * the test just to make CI green: first re-verify manual friend requests and
 * Celeb auto-request end-to-end.
 */

test("manual friend requests stay on the Huy Locket backend", async () => {
  const source = await read("src/services/LocketDioServices/RequestServices.js");

  assert.match(source, /api\.post\(["']locket\/sendFriendRequestV2["']/);
  assert.match(source, /api\.post\(["']locket\/sendCelebrityRequestV2["']/);
  assert.doesNotMatch(source, /api\.post\(["']https:\/\/api-beta\.locket-dio\.com\/locket\/sendFriendRequestV2/);
  assert.doesNotMatch(source, /api\.post\(["']https:\/\/api-beta\.locket-dio\.com\/locket\/sendCelebrityRequestV2/);
});

test("upstream Locket auth failures never log the user out", async () => {
  const policy = await read("src/libs/auth401Policy.js");

  assert.match(policy, /UPSTREAM_AUTH_FAILED/);
  assert.match(policy, /isUpstreamAuthFailure/);
  assert.match(policy, /Boolean\(skipAuthRefresh\) \|\| isUpstreamAuthFailure\(responseData\)/);
});

test("Dio compatibility fallback remains limited to friend and Celeb 401\/403", async () => {
  const compat = await read("api/src/libs/dioFriendCompat.js");

  assert.match(compat, /DIO_FRIEND_FALLBACK_ENABLED/);
  assert.match(compat, /status !== 401 && status !== 403/);
  assert.match(compat, /sendFriendRequest/);
  assert.match(compat, /sendFollowRequest/);
  assert.match(compat, /\/locket\/sendFriendRequestV2/);
  assert.match(compat, /\/locket\/sendCelebrityRequestV2/);
  assert.match(compat, /createDioMemberSession/);
});

test("manual and Celeb requests continue through the shared Locket client", async () => {
  const requests = await read("api/src/services/LocketFriend/RequestServices.js");
  const relationshipPolicy = await read(
    "api/src/services/LocketFriend/relationshipPolicy.js",
  );

  assert.match(requests, /instanceLocketV2\.post\(["']sendFriendRequest["']/);
  assert.match(requests, /instanceLocketV2\.post\(["']sendFollowRequest["']/);
  assert.match(requests, /UPSTREAM_AUTH_FAILED/);
  assert.match(requests, /waitForVerifiedRelationship/);
  assert.match(requests, /REQUEST_NOT_CONFIRMED/);
  assert.match(requests, /verified:\s*true/);
  assert.match(requests, /sentNow/);
  assert.match(requests, /skipPreflight/);
  assert.doesNotMatch(relationshipPolicy, /["']follower-waitlist["']/);
});

test("slot monitor keeps using the same Celeb request service as manual requests", async () => {
  const slot = await read("api/src/modules/slotMonitor/service.js");

  assert.match(slot, /requestServices\.SendAddCelebrity\(/);
  assert.match(slot, /skipPreflight:\s*true/);
  assert.match(slot, /real celebrity request sent/);
  assert.match(slot, /celebrity relationship already verified/);
  assert.match(slot, /autoRequest\.sentNow/);
});

test("Canh Slot exposes a one-shot normal friend verification test", async () => {
  const page = await read("src/features/SlotMonitor/SlotWatchInline.jsx");
  const testTool = await read(
    "src/features/SlotMonitor/NormalFriendRequestTest.jsx",
  );

  assert.match(page, /<NormalFriendRequestTest\s*\/>/);
  assert.match(testTool, /SendRequestToFriend\(user\.uid\)/);
  assert.match(testTool, /verification\?\.verified !== true/);
  assert.match(testTool, /verification\.sentNow === true/);
  assert.match(testTool, /chỉ gửi đúng 1 lần/);
});
