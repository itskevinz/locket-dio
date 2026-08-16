const NORMAL_CONFIRMED_RELATIONSHIPS = new Set([
  "friends",
  "outgoing-request",
]);

const CELEBRITY_CONFIRMED_RELATIONSHIPS = new Set([
  ...NORMAL_CONFIRMED_RELATIONSHIPS,
  "outgoing-follow-request",
  "follower-waitlist",
]);

function normalizeRelationshipValue(value) {
  const status = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return status === "friend" ? "friends" : status;
}

function isConfirmedRelationship(value, { celebrity = false } = {}) {
  const status = normalizeRelationshipValue(value);
  const confirmed = celebrity
    ? CELEBRITY_CONFIRMED_RELATIONSHIPS
    : NORMAL_CONFIRMED_RELATIONSHIPS;
  return confirmed.has(status);
}

module.exports = {
  isConfirmedRelationship,
  normalizeRelationshipValue,
};
