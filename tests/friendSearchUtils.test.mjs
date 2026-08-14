import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFriendRequestError,
  FRIENDSHIP_STATUS,
  friendshipStatusFromUser,
  normalizeFriendUsername,
} from "../src/features/FriendsContainer/FindFriend/friendSearchUtils.js";

test("normalizeFriendUsername trims and removes one leading @", () => {
  assert.equal(normalizeFriendUsername("  hang_bingboong  "), "hang_bingboong");
  assert.equal(normalizeFriendUsername("  @hang_bingboong  "), "hang_bingboong");
  assert.equal(normalizeFriendUsername("   "), "");
});

test("friendshipStatusFromUser maps server relationship states", () => {
  assert.equal(
    friendshipStatusFromUser({ friendship_status: "friends" }),
    FRIENDSHIP_STATUS.FRIENDS,
  );
  assert.equal(
    friendshipStatusFromUser({ friendship_status: "outgoing-follow-request" }),
    FRIENDSHIP_STATUS.OUTGOING,
  );
  assert.equal(friendshipStatusFromUser({}), FRIENDSHIP_STATUS.NONE);
});

test("classifyFriendRequestError separates auth, rate, timeout and network", () => {
  assert.equal(classifyFriendRequestError({ code: "AUTH_REQUIRED" }), "auth-required");
  assert.equal(
    classifyFriendRequestError({
      response: { status: 401, data: { code: "UPSTREAM_AUTH_FAILED" } },
    }),
    "upstream-auth-failed",
  );
  assert.equal(
    classifyFriendRequestError({
      response: { status: 401, data: { error: { code: "UPSTREAM_AUTH_FAILED" } } },
    }),
    "upstream-auth-failed",
  );
  assert.equal(
    classifyFriendRequestError({
      response: { status: 403, data: { code: "UPSTREAM_AUTH_FAILED" } },
    }),
    "upstream-auth-failed",
  );
  assert.equal(classifyFriendRequestError({ response: { status: 401 } }), "session-expired");
  assert.equal(classifyFriendRequestError({ response: { status: 429 } }), "rate-limit");
  assert.equal(classifyFriendRequestError({ code: "ECONNABORTED" }), "timeout");
  assert.equal(classifyFriendRequestError(new Error("offline")), "network");
});
