const store = require("./store");

let installed = false;
let cleanupPromise = null;

function normalizedStatus(value) {
  return String(value || "").trim().toUpperCase();
}

function isCompletedFriendWatch(watch) {
  return (
    normalizedStatus(watch?.last_auto_request_status) === "FRIENDS" ||
    normalizedStatus(watch?.status) === "FRIENDS"
  );
}

function installCompletedWatchGuard() {
  if (installed) return;
  installed = true;

  const originalUpsertWatch = store.upsertWatch.bind(store);
  const originalListActiveUsers = store.listActiveUsers.bind(store);
  const originalListActiveWatchesForUser = store.listActiveWatchesForUser.bind(store);
  const originalSetWatchEnabled = store.setWatchEnabled.bind(store);
  const originalSetWatchAutoRequestEnabled = store.setWatchAutoRequestEnabled.bind(store);

  async function forceCompletedState(userUid, celebUid) {
    await originalSetWatchAutoRequestEnabled(userUid, celebUid, false);
    await originalSetWatchEnabled(userUid, celebUid, false);
  }

  // Never hand completed friendships back to the slot worker, even if an old
  // browser build or a sync request accidentally flips enabled=TRUE again.
  store.listActiveWatchesForUser = async (userUid) => {
    const rows = await originalListActiveWatchesForUser(userUid);
    return rows.filter((watch) => !isCompletedFriendWatch(watch));
  };

  // The normal watch upsert historically re-enabled an existing row. Preserve
  // completed FRIENDS records instead of letting a later client sync resurrect
  // polling/auto-request work for them.
  store.upsertWatch = async (userUid, watch) => {
    await originalUpsertWatch(userUid, watch);
    const rows = await store.listUserWatches(userUid);
    const saved = rows.find(
      (item) => String(item?.celeb_uid || "") === String(watch?.uid || ""),
    );
    if (isCompletedFriendWatch(saved)) {
      await forceCompletedState(userUid, saved.celeb_uid);
    }
  };

  // Admin/user controls must not revive a completed friendship accidentally.
  store.setWatchEnabled = async (userUid, celebUid, enabled) => {
    if (enabled) {
      const rows = await store.listUserWatches(userUid);
      const saved = rows.find(
        (item) => String(item?.celeb_uid || "") === String(celebUid || ""),
      );
      if (isCompletedFriendWatch(saved)) {
        await forceCompletedState(userUid, celebUid);
        return;
      }
    }
    return originalSetWatchEnabled(userUid, celebUid, enabled);
  };

  store.setWatchAutoRequestEnabled = async (userUid, celebUid, enabled) => {
    if (enabled) {
      const rows = await store.listUserWatches(userUid);
      const saved = rows.find(
        (item) => String(item?.celeb_uid || "") === String(celebUid || ""),
      );
      if (isCompletedFriendWatch(saved)) {
        await forceCompletedState(userUid, celebUid);
        return;
      }
    }
    return originalSetWatchAutoRequestEnabled(userUid, celebUid, enabled);
  };

  // Repair legacy rows once on process startup. This fixes rows that already
  // have last_auto_request_status=FRIENDS but were left enabled by an older sync.
  cleanupPromise = (async () => {
    await store.ensureSchema();
    const users = await originalListActiveUsers();
    let repaired = 0;

    for (const row of users) {
      const userUid = String(row?.user_uid || "");
      if (!userUid) continue;
      const watches = await originalListActiveWatchesForUser(userUid);
      for (const watch of watches) {
        if (!isCompletedFriendWatch(watch)) continue;
        await forceCompletedState(userUid, watch.celeb_uid);
        repaired += 1;
      }
    }

    if (repaired > 0) {
      console.log("[slot-monitor] repaired completed friendship watches", {
        repaired,
      });
    }
  })().catch((error) => {
    console.warn("[slot-monitor] completed friendship cleanup failed", {
      code: error?.code || null,
      message: error?.message || "unknown",
    });
  });
}

function waitForCompletedWatchCleanup() {
  return cleanupPromise || Promise.resolve();
}

module.exports = {
  installCompletedWatchGuard,
  isCompletedFriendWatch,
  waitForCompletedWatchCleanup,
};
