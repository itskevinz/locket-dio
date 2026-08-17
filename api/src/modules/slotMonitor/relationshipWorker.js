const axios = require("axios");
const constants = require("../../utils/constants");
const friendServices = require("../../services/LocketFriend/FriendsServices");
const store = require("./store");
const { decryptSecret } = require("./crypto");
const { validateAndSaveSession } = require("./service");
const {
  normalizeRelationshipValue,
  isFriendRelationship,
  isPendingRelationship,
} = require("../../services/LocketFriend/relationshipPolicy");

const DEFAULT_RELATIONSHIP_POLL_MS = 10_000;
const MIN_RELATIONSHIP_POLL_MS = 5_000;
const MAX_RELATIONSHIP_POLL_MS = 60_000;
const TOKEN_CACHE_MS = 40 * 60 * 1000;

const RELATIONSHIP_POLL_MS = Math.max(
  MIN_RELATIONSHIP_POLL_MS,
  Math.min(
    MAX_RELATIONSHIP_POLL_MS,
    Number(process.env.SLOT_RELATIONSHIP_POLL_MS) || DEFAULT_RELATIONSHIP_POLL_MS,
  ),
);

let relationshipTimer = null;
let relationshipRunning = false;
const tokenCache = new Map();

function cachedToken(userUid) {
  const key = String(userUid || "");
  const cached = tokenCache.get(key);
  if (!cached) return null;
  if (Date.now() >= Number(cached.expiresAt || 0)) {
    tokenCache.delete(key);
    return null;
  }
  return cached.idToken || null;
}

async function getUserIdToken(userUid) {
  const cached = cachedToken(userUid);
  if (cached) return cached;

  const session = await store.getSession(userUid);
  if (!session?.enabled || !session?.refresh_token_enc) {
    return null;
  }

  const refreshToken = decryptSecret(session.refresh_token_enc);
  if (!refreshToken) return null;

  const idToken = await validateAndSaveSession(userUid, refreshToken);
  if (idToken) {
    tokenCache.set(String(userUid), {
      idToken,
      expiresAt: Date.now() + TOKEN_CACHE_MS,
    });
  }
  return idToken || null;
}

function relationshipFromLookup(result) {
  return normalizeRelationshipValue(
    result?.data?.friendship_status ||
      result?.result?.data?.friendship_status ||
      result?.friendship_status ||
      "",
  );
}

async function probeRelationship(idToken, watch) {
  try {
    const result = await friendServices.FindFriendByUserName(
      idToken,
      watch.username,
    );
    if (!result || result?.success === false) {
      return { definitive: false, relationship: "" };
    }

    return {
      definitive: true,
      relationship: relationshipFromLookup(result),
    };
  } catch (error) {
    console.warn("[slot-relationship] lookup failed", {
      userUid: watch.user_uid,
      username: watch.username,
      status: error?.response?.status || error?.status || null,
      code: error?.code || null,
    });
    return { definitive: false, relationship: "", error };
  }
}

// The user-specific /friends document is the authoritative source for an
// accepted friendship. Username/profile relationship lookups can temporarily
// return stale/empty data, so always reconcile SENT/FAILED watches against the
// exact friend document before deciding that a request still needs work.
async function probeFriendDocument(idToken, userUid, watch) {
  const uid = String(userUid || "").trim();
  const celebUid = String(watch?.celeb_uid || "").trim();
  if (!uid || !celebUid) {
    return { definitive: false, isFriend: false };
  }

  const url = `${constants.GET_ACCOUNT_INFO_URL_V2}${encodeURIComponent(uid)}/friends/${encodeURIComponent(celebUid)}`;
  try {
    await axios.get(url, {
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${idToken}`,
        Accept: "application/json",
      },
    });
    return { definitive: true, isFriend: true };
  } catch (error) {
    const status = Number(error?.response?.status || error?.status || 0);
    if (status === 404) {
      return { definitive: true, isFriend: false };
    }

    console.warn("[slot-relationship] friend document lookup failed", {
      userUid: uid,
      celebUid,
      username: watch?.username,
      status: status || null,
      code: error?.code || null,
    });
    return { definitive: false, isFriend: false, error };
  }
}

async function completeFriendWatch(userUid, watch, source, relationship = "friends") {
  await store.markAutoRequestResult(userUid, watch.celeb_uid, {
    status: "FRIENDS",
    error: null,
  });
  await store.setWatchAutoRequestEnabled(userUid, watch.celeb_uid, false);
  await store.setWatchEnabled(userUid, watch.celeb_uid, false);
  console.log("[slot-relationship] friendship confirmed; watch completed", {
    userUid,
    celebUid: watch.celeb_uid,
    username: watch.username,
    source,
  });
  return { state: "FRIENDS", relationship };
}

async function processSentWatch(userUid, idToken, watch, options = {}) {
  if (!options.skipFriendDocument) {
    const friendDocument = await probeFriendDocument(idToken, userUid, watch);
    if (friendDocument.definitive && friendDocument.isFriend) {
      return completeFriendWatch(userUid, watch, "friends-document");
    }
  }

  const probe = await probeRelationship(idToken, watch);
  if (!probe.definitive) return { state: "UNKNOWN" };

  const relationship = probe.relationship;
  if (isFriendRelationship(relationship)) {
    // SENT chỉ có nghĩa là request đã tồn tại. Chỉ FRIENDS mới là hoàn tất.
    // Giữ record trong DB để UI vẫn hiển thị tài khoản với trạng thái Bạn bè,
    // nhưng tắt worker slot để không poll/gửi lại nữa.
    return completeFriendWatch(userUid, watch, "relationship", relationship);
  }

  if (isPendingRelationship(relationship, { celebrity: true })) {
    // Request thật vẫn đang chờ Celeb chấp nhận. Không gửi lặp và không xóa watch.
    return { state: "PENDING", relationship };
  }

  // follower-waitlist/none/empty không phải là một outgoing request thật.
  // Các bản cũ từng ghi nhầm SENT ở trạng thái này; sửa lại FAILED để worker
  // tiếp tục canh slot và chỉ báo thành công khi lần sau đọc thấy outgoing request.
  await store.markAutoRequestResult(userUid, watch.celeb_uid, {
    status: "FAILED",
    error: `REQUEST_NOT_PENDING: relationship=${relationship || "none"}`,
  });
  console.warn("[slot-relationship] stale/false SENT reset to retry", {
    userUid,
    celebUid: watch.celeb_uid,
    username: watch.username,
    relationship: relationship || "none",
  });
  return { state: "RETRY", relationship };
}

async function reconcileWatch(userUid, idToken, watch) {
  const status = String(watch?.last_auto_request_status || "")
    .trim()
    .toUpperCase();

  // A FAILED row may still represent a request that actually got accepted
  // after the mutation response/relationship probe failed. Check the user's
  // real friend document so such rows self-heal instead of polling forever.
  if (status === "SENT" || status === "FAILED") {
    const friendDocument = await probeFriendDocument(idToken, userUid, watch);
    if (friendDocument.definitive && friendDocument.isFriend) {
      return completeFriendWatch(userUid, watch, "friends-document");
    }

    if (status === "SENT") {
      return processSentWatch(userUid, idToken, watch, {
        skipFriendDocument: true,
      });
    }
  }

  return { state: "NO_CHANGE" };
}

async function runRelationshipCycle() {
  if (relationshipRunning || !store.isConfigured()) return;
  relationshipRunning = true;

  try {
    await store.ensureSchema();
    const users = await store.listActiveUsers();

    for (const row of users) {
      const userUid = String(row.user_uid || "");
      if (!userUid) continue;

      let watches;
      try {
        watches = await store.listActiveWatchesForUser(userUid);
      } catch (error) {
        console.warn("[slot-relationship] failed to load watches", {
          userUid,
          code: error?.code || null,
        });
        continue;
      }

      const relationshipWatches = watches.filter((watch) => {
        const status = String(watch?.last_auto_request_status || "")
          .trim()
          .toUpperCase();
        return status === "SENT" || status === "FAILED";
      });
      if (!relationshipWatches.length) continue;

      let idToken;
      try {
        idToken = await getUserIdToken(userUid);
      } catch (error) {
        tokenCache.delete(userUid);
        console.warn("[slot-relationship] session refresh failed", {
          userUid,
          code: error?.code || null,
          message: error?.message || "Session refresh failed",
        });
        continue;
      }
      if (!idToken) continue;

      for (const watch of relationshipWatches) {
        await reconcileWatch(userUid, idToken, watch);
      }
    }
  } catch (error) {
    console.error(
      "[slot-relationship] cycle failed",
      error?.message || error,
    );
  } finally {
    relationshipRunning = false;
  }
}

function scheduleRelationshipWorker(delayMs = RELATIONSHIP_POLL_MS) {
  if (relationshipTimer) return;
  relationshipTimer = setTimeout(async () => {
    relationshipTimer = null;
    await runRelationshipCycle();
    scheduleRelationshipWorker(RELATIONSHIP_POLL_MS);
  }, Math.max(MIN_RELATIONSHIP_POLL_MS, Number(delayMs) || RELATIONSHIP_POLL_MS));
  relationshipTimer.unref?.();
}

function startRelationshipWorker() {
  if (relationshipTimer || !store.isConfigured()) return false;
  scheduleRelationshipWorker(2_500);
  console.log("[slot-relationship] pending-request watcher started", {
    intervalSeconds: RELATIONSHIP_POLL_MS / 1000,
  });
  return true;
}

module.exports = {
  RELATIONSHIP_POLL_MS,
  relationshipFromLookup,
  probeRelationship,
  probeFriendDocument,
  processSentWatch,
  reconcileWatch,
  runRelationshipCycle,
  startRelationshipWorker,
};
