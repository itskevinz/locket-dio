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

async function processSentWatch(userUid, idToken, watch) {
  const probe = await probeRelationship(idToken, watch);
  if (!probe.definitive) return { state: "UNKNOWN" };

  const relationship = probe.relationship;
  if (isFriendRelationship(relationship)) {
    // SENT chỉ có nghĩa là request đã tồn tại. Chỉ FRIENDS mới là hoàn tất.
    // Giữ record trong DB để UI vẫn hiển thị tài khoản với trạng thái Bạn bè,
    // nhưng tắt worker slot để không poll/gửi lại nữa.
    await store.markAutoRequestResult(userUid, watch.celeb_uid, {
      status: "FRIENDS",
      error: null,
    });
    await store.setWatchEnabled(userUid, watch.celeb_uid, false);
    console.log("[slot-relationship] friendship confirmed; watch completed", {
      userUid,
      celebUid: watch.celeb_uid,
      username: watch.username,
    });
    return { state: "FRIENDS", relationship };
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

      const sentWatches = watches.filter(
        (watch) =>
          String(watch?.last_auto_request_status || "")
            .trim()
            .toUpperCase() === "SENT",
      );
      if (!sentWatches.length) continue;

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

      for (const watch of sentWatches) {
        await processSentWatch(userUid, idToken, watch);
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
  processSentWatch,
  runRelationshipCycle,
  startRelationshipWorker,
};
