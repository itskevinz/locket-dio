const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isConfirmedRelationship,
  normalizeRelationshipValue,
} = require("../src/services/LocketFriend/relationshipPolicy");

test("relationship values are normalized before verification", () => {
  assert.equal(normalizeRelationshipValue(" FRIEND "), "friends");
  assert.equal(
    normalizeRelationshipValue("OUTGOING_FOLLOW_REQUEST"),
    "outgoing-follow-request",
  );
});

test("Celeb success requires a persisted friend or outgoing request", () => {
  assert.equal(isConfirmedRelationship("friends", { celebrity: true }), true);
  assert.equal(
    isConfirmedRelationship("outgoing-request", { celebrity: true }),
    true,
  );
  assert.equal(
    isConfirmedRelationship("outgoing-follow-request", { celebrity: true }),
    true,
  );
});

test("Celeb waitlist is never reported as a successful friend request", () => {
  assert.equal(
    isConfirmedRelationship("follower-waitlist", { celebrity: true }),
    false,
  );
  assert.equal(
    isConfirmedRelationship("outgoing-follow-request", { celebrity: false }),
    false,
  );
});
