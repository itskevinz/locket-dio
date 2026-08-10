const SLOT_STATUS = Object.freeze({
  WATCHING: "WATCHING",
  SLOT_OPEN: "SLOT_OPEN",
  PAUSED: "PAUSED",
  ERROR: "ERROR",
});

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .trim()
    .slice(0, 64);
}

function sanitizeWatchInput(raw = {}) {
  const uid = String(raw.uid || "").trim().slice(0, 160);
  const username = normalizeUsername(raw.username);
  if (!uid || !username) return null;

  const friendCount = Math.max(0, Number(raw.friendCount) || 0);
  const maxFriends = Math.max(0, Number(raw.maxFriends) || 0);

  return {
    uid,
    username,
    displayName: String(raw.displayName || username).trim().slice(0, 120),
    avatar: String(raw.avatar || "").trim().slice(0, 1000),
    friendCount,
    maxFriends,
    status: SLOT_STATUS.WATCHING,
  };
}

function celebritySnapshotUnavailable() {
  const error = new Error("Celebrity slot data unavailable");
  // A partial getUserByUsername response can be session-specific. Mark it as
  // account-specific so the shared slot worker immediately tries another saved
  // background session instead of abandoning this celebrity for the whole cycle.
  error.status = 403;
  error.code = "CELEB_SNAPSHOT_UNAVAILABLE";
  return error;
}

function extractCelebritySnapshot(result) {
  const user = result?.data || result?.result?.data || result;
  const celebrity = user?.celebrity_data;
  if (!celebrity) throw celebritySnapshotUnavailable();

  const rawFriendCount = Number(celebrity.friend_count);
  const rawMaxFriends = Number(celebrity.max_friends);
  if (
    !Number.isFinite(rawFriendCount) ||
    rawFriendCount < 0 ||
    !Number.isFinite(rawMaxFriends) ||
    rawMaxFriends <= 0
  ) {
    throw celebritySnapshotUnavailable();
  }

  const friendCount = Math.max(0, rawFriendCount);
  const maxFriends = Math.max(0, rawMaxFriends);

  return {
    friendCount,
    maxFriends,
    availableSlots: Math.max(0, maxFriends - friendCount),
    isFull: friendCount >= maxFriends,
  };
}

function computeTransition(previous, snapshot) {
  const previousFriendCount = Number(previous?.friend_count ?? previous?.friendCount ?? 0) || 0;
  const previousMaxFriends = Number(previous?.max_friends ?? previous?.maxFriends ?? 0) || 0;
  const previousAvailableSlots = Math.max(0, previousMaxFriends - previousFriendCount);
  const wasFull =
    typeof previous?.last_was_full === "boolean"
      ? previous.last_was_full
      : typeof previous?.lastWasFull === "boolean"
        ? previous.lastWasFull
        : previousMaxFriends > 0 && previousFriendCount >= previousMaxFriends;

  const capacityIncreased =
    snapshot.maxFriends > previousMaxFriends &&
    snapshot.availableSlots > previousAvailableSlots;
  const shouldNotify = !snapshot.isFull && (wasFull || capacityIncreased);

  return {
    friendCount: snapshot.friendCount,
    maxFriends: snapshot.maxFriends,
    availableSlots: snapshot.availableSlots,
    lastWasFull: snapshot.isFull,
    status: snapshot.isFull ? SLOT_STATUS.WATCHING : SLOT_STATUS.SLOT_OPEN,
    shouldNotify,
    capacityIncreased,
  };
}

function decodeFirebaseUid(idToken) {
  try {
    const payload = String(idToken || "").split(".")[1];
    if (!payload) return "";
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return String(json.user_id || json.uid || json.sub || "");
  } catch {
    return "";
  }
}

module.exports = {
  SLOT_STATUS,
  normalizeUsername,
  sanitizeWatchInput,
  extractCelebritySnapshot,
  computeTransition,
  decodeFirebaseUid,
};