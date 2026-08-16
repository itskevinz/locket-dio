export const SLOT_STATUS = Object.freeze({
  WATCHING: "WATCHING",
  CHECKING: "CHECKING",
  SLOT_OPEN: "SLOT_OPEN",
  FRIENDS: "FRIENDS",
  PAUSED: "PAUSED",
  ERROR: "ERROR",
});

export const SLOT_WATCH_LIMIT = 20;
export const SLOT_POLL_INTERVAL_MS = 3 * 60 * 1000;
export const SLOT_POLL_JITTER_MS = 15 * 1000;
export const SLOT_VISIBILITY_COOLDOWN_MS = 60 * 1000;
export const SLOT_LEADER_TIMEOUT_MS = 22 * 1000;

const asCount = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const normalizeRelationship = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/^friend$/, "friends");

export function extractCelebritySnapshot(result) {
  const data = result?.data ?? result?.result?.data ?? result?.result ?? result;
  const celebrityData = data?.celebrity_data;
  if (!data || !celebrityData) return null;

  const friendCount = asCount(celebrityData.friend_count);
  const maxFriends = asCount(celebrityData.max_friends);
  const hasCapacityInfo = maxFriends > 0;
  const isOpen = hasCapacityInfo && friendCount < maxFriends;
  const relationship = normalizeRelationship(data?.friendship_status);

  return {
    friendCount,
    maxFriends,
    hasCapacityInfo,
    isOpen,
    isFull: hasCapacityInfo && friendCount >= maxFriends,
    availableSlots: isOpen ? Math.max(0, maxFriends - friendCount) : 0,
    relationship,
    isFriend: relationship === "friends",
    requestPending: ["outgoing-request", "outgoing-follow-request"].includes(
      relationship,
    ),
  };
}

export function computeSlotTransition(previous, snapshot, now = Date.now()) {
  // Không xóa watch khi đã kết bạn. Giữ record ở trạng thái FRIENDS để UI
  // vẫn hiện tài khoản là "Bạn bè", đồng thời provider sẽ không poll nó nữa.
  if (snapshot?.isFriend) {
    return {
      shouldNotify: false,
      updates: {
        status: SLOT_STATUS.FRIENDS,
        friendCount: snapshot?.friendCount ?? previous?.friendCount ?? 0,
        maxFriends: snapshot?.maxFriends ?? previous?.maxFriends ?? 0,
        lastCheckedAt: now,
        lastWasFull: snapshot?.isFull ?? previous?.lastWasFull ?? false,
        notifiedAt: null,
        errorCount: 0,
      },
    };
  }

  if (!snapshot?.hasCapacityInfo) {
    return {
      shouldNotify: false,
      updates: {
        status:
          previous?.status === SLOT_STATUS.PAUSED
            ? SLOT_STATUS.PAUSED
            : SLOT_STATUS.WATCHING,
        friendCount: snapshot?.friendCount ?? previous?.friendCount ?? 0,
        maxFriends: snapshot?.maxFriends ?? previous?.maxFriends ?? 0,
        lastCheckedAt: now,
        errorCount: 0,
      },
    };
  }

  if (snapshot.isOpen) {
    const alreadyOpen =
      previous?.status === SLOT_STATUS.SLOT_OPEN || previous?.lastWasFull === false;
    const shouldNotify = !alreadyOpen;

    return {
      shouldNotify,
      updates: {
        status: SLOT_STATUS.SLOT_OPEN,
        friendCount: snapshot.friendCount,
        maxFriends: snapshot.maxFriends,
        lastCheckedAt: now,
        lastWasFull: false,
        notifiedAt: shouldNotify ? now : previous?.notifiedAt ?? null,
        errorCount: 0,
      },
    };
  }

  return {
    shouldNotify: false,
    updates: {
      status: SLOT_STATUS.WATCHING,
      friendCount: snapshot.friendCount,
      maxFriends: snapshot.maxFriends,
      lastCheckedAt: now,
      lastWasFull: true,
      notifiedAt: null,
      errorCount: 0,
    },
  };
}

export function isLeaderLockStale(lock, now = Date.now(), timeout = SLOT_LEADER_TIMEOUT_MS) {
  if (!lock?.id || !Number.isFinite(Number(lock?.ts))) return true;
  return now - Number(lock.ts) > timeout;
}

export function canClaimLeader(lock, tabId, now = Date.now()) {
  return !lock || lock.id === tabId || isLeaderLockStale(lock, now);
}

export function canSendBrowserNotification(permission, supported = true) {
  return Boolean(supported && permission === "granted");
}
