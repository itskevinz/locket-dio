const webPush = require("web-push");
const authServices = require("../../services/AuthSecurity/AuthServices");
const friendServices = require("../../services/LocketFriend/FriendsServices");
const requestServices = require("../../services/LocketFriend/RequestServices");
const { appCheckServices } = require("../appcheck/services");
const store = require("./store");
const notificationHistoryStore = require("./notificationHistoryStore");
const { encryptSecret, decryptSecret, getEncryptionKey } = require("./crypto");
const { sendConfiguredNotifications } = require("./notificationService");
const {
  computeTransition,
  decodeFirebaseUid,
  extractCelebritySnapshot,
} = require("./core");
const {
  MAX_AUTO_REQUEST_ATTEMPTS,
  getAutoRequestRetryDelayMs,
  hasEnabledAutoRequest,
  normalizeAutoRequestFailure,
  shouldAttemptAutoRequest,
} = require("./autoRequestPolicy");
const {
  DEFAULT_NORMAL_INTERVAL_MS,
  FAST_INTERVAL_MS,
  AUTO_REQUEST_INTERVAL_MS,
  FAST_WINDOW_MS,
  MIN_WORKER_DELAY_MS,
  clampNormalIntervalMs,
  hasSnapshotChanged,
  pollIntervalForState,
  rateLimitBackoffMs,
  jitteredIntervalMs,
} = require("./pollingPolicy");

const POLL_INTERVAL_MS = clampNormalIntervalMs(
  process.env.SLOT_POLL_INTERVAL_MS,
  DEFAULT_NORMAL_INTERVAL_MS,
);
const CELEB_BATCH_SIZE = 4;
const USER_ACTION_BATCH_SIZE = 4;
const BATCH_DELAY_MS = 50;
const ID_TOKEN_CACHE_MS = 45 * 60 * 1000;
const VAPID_CONFIG_KEY = "slot_monitor_vapid_v1";
let vapidPromise = null;
let workerTimer = null;
let workerRunning = false;
const userSessionCache = new Map();
const celebPollingState = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function errorStatus(error) {
  const value = Number(error?.status || error?.response?.status || 0);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function cacheUserIdToken(userUid, idToken) {
  if (!userUid || !idToken) return;
  userSessionCache.set(String(userUid), {
    idToken,
    expiresAt: Date.now() + ID_TOKEN_CACHE_MS,
  });
}

function getCachedUserIdToken(userUid) {
  const key = String(userUid || "");
  const cached = userSessionCache.get(key);
  if (!cached) return null;
  if (Date.now() >= Number(cached.expiresAt || 0)) {
    userSessionCache.delete(key);
    return null;
  }
  return cached.idToken || null;
}

async function getVapidKeys() {
  if (vapidPromise) return vapidPromise;

  vapidPromise = (async () => {
    const envPublic = String(process.env.VAPID_PUBLIC_KEY || "").trim();
    const envPrivate = String(process.env.VAPID_PRIVATE_KEY || "").trim();
    let keys = null;

    if (envPublic && envPrivate) {
      keys = { publicKey: envPublic, privateKey: envPrivate };
    } else {
      const stored = await store.getConfigValue(VAPID_CONFIG_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (parsed?.publicKey && parsed?.privateKey) keys = parsed;
        } catch {
          /* regenerate below */
        }
      }

      if (!keys) {
        keys = webPush.generateVAPIDKeys();
        await store.setConfigValue(VAPID_CONFIG_KEY, JSON.stringify(keys));
        console.log("[slot-monitor] generated persistent VAPID key pair in database");
      }
    }

    webPush.setVapidDetails(
      String(process.env.VAPID_SUBJECT || "mailto:buiduchuy2010qn@gmail.com"),
      keys.publicKey,
      keys.privateKey,
    );
    return keys;
  })().catch((error) => {
    vapidPromise = null;
    throw error;
  });

  return vapidPromise;
}

async function getPublicConfig() {
  if (!store.isConfigured() || !getEncryptionKey()) {
    return {
      enabled: false,
      reason: !store.isConfigured()
        ? "DATABASE_UNAVAILABLE"
        : "ENCRYPTION_KEY_UNAVAILABLE",
      vapidPublicKey: null,
      pollIntervalMs: POLL_INTERVAL_MS,
      fastPollIntervalMs: FAST_INTERVAL_MS,
      autoRequestPollIntervalMs: AUTO_REQUEST_INTERVAL_MS,
      adaptivePolling: true,
    };
  }

  const keys = await getVapidKeys();
  return {
    enabled: true,
    vapidPublicKey: keys.publicKey,
    pollIntervalMs: POLL_INTERVAL_MS,
    fastPollIntervalMs: FAST_INTERVAL_MS,
    autoRequestPollIntervalMs: AUTO_REQUEST_INTERVAL_MS,
    adaptivePolling: true,
  };
}

async function validateAndSaveSession(userUid, refreshToken) {
  if (!refreshToken) {
    const error = new Error("Thiếu refresh token để bật Canh Slot 24/7.");
    error.code = "REFRESH_TOKEN_REQUIRED";
    error.status = 400;
    throw error;
  }

  const refreshed = await authServices.refreshIdToken(String(refreshToken));
  const idToken = refreshed?.id_token || refreshed?.access_token;
  const refreshedUid = decodeFirebaseUid(idToken);
  if (!idToken || !refreshedUid || String(refreshedUid) !== String(userUid)) {
    const error = new Error("Phiên đăng nhập không khớp tài khoản hiện tại.");
    error.code = "SLOT_SESSION_MISMATCH";
    error.status = 403;
    throw error;
  }

  const nextRefreshToken = refreshed?.refresh_token || refreshToken;
  await store.saveSession(userUid, encryptSecret(nextRefreshToken));
  cacheUserIdToken(userUid, idToken);
  return idToken;
}

async function enableBackgroundPush({ userUid, refreshToken, subscription, userAgent }) {
  await store.ensureSchema();
  await getVapidKeys();
  await validateAndSaveSession(userUid, refreshToken);
  if (subscription) {
    await store.upsertSubscription(userUid, subscription, userAgent);
  }
  return getPublicConfig();
}

async function refreshUserSession(userUid) {
  const cachedIdToken = getCachedUserIdToken(userUid);
  if (cachedIdToken) return cachedIdToken;

  const session = await store.getSession(userUid);
  if (!session?.enabled || !session?.refresh_token_enc) {
    const error = new Error("Không có phiên nền cho Canh Slot.");
    error.code = "SLOT_SESSION_MISSING";
    throw error;
  }

  const refreshToken = decryptSecret(session.refresh_token_enc);
  try {
    const refreshed = await authServices.refreshIdToken(refreshToken);
    const idToken = refreshed?.id_token || refreshed?.access_token;
    const uid = decodeFirebaseUid(idToken);
    if (!idToken || !uid || String(uid) !== String(userUid)) {
      throw new Error("Background session user mismatch");
    }
    const nextRefresh = refreshed?.refresh_token || refreshToken;
    await store.markSessionRefreshed(userUid, encryptSecret(nextRefresh));
    cacheUserIdToken(userUid, idToken);
    return idToken;
  } catch (error) {
    userSessionCache.delete(String(userUid));
    await store.markSessionError(userUid, error?.message || "Session refresh failed");
    throw error;
  }
}

async function recordWebPushDelivery(userUid, payload, eventId, status, error = null) {
  try {
    await notificationHistoryStore.recordDelivery({
      userUid,
      eventId,
      channel: "web-push",
      status,
      payload,
      errorCode: error?.code || "",
      errorMessage: error?.message || "",
    });
  } catch (historyError) {
    console.warn("[slot-monitor] web push history write failed", {
      userUid,
      code: historyError?.code || null,
    });
  }
}

async function sendPushToUser(userUid, payload, { eventId = "" } = {}) {
  await getVapidKeys();
  const subscriptions = await store.listSubscriptionsForUser(userUid);
  if (!subscriptions.length) {
    await recordWebPushDelivery(userUid, payload, eventId, "SKIPPED", {
      code: "NO_ACTIVE_SUBSCRIPTION",
      message: "Không có thiết bị Web Push đang hoạt động.",
    });
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (row) => {
      const subscription = {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      };
      try {
        await webPush.sendNotification(subscription, body, { TTL: 120 });
        sent += 1;
      } catch (error) {
        failed += 1;
        const statusCode = Number(error?.statusCode || error?.status);
        if (statusCode === 404 || statusCode === 410) {
          await store.deactivateSubscription(row.endpoint).catch(() => {});
        }
        console.warn("[slot-monitor] push failed", {
          userUid,
          statusCode: statusCode || null,
        });
      }
    }),
  );

  const deliveryStatus = sent > 0
    ? (failed > 0 ? "PARTIAL" : "SUCCESS")
    : "FAILED";
  await recordWebPushDelivery(
    userUid,
    payload,
    eventId,
    deliveryStatus,
    failed > 0
      ? {
          code: "WEB_PUSH_PARTIAL_FAILURE",
          message: `${failed} thiết bị Web Push gửi thất bại; ${sent} thiết bị thành công.`,
        }
      : null,
  );

  return { sent, failed };
}

async function sendRealCelebrityRequest(userUid, idToken, watch) {
  if (!watch?.auto_request_enabled) {
    return {
      enabled: false,
      attempted: false,
      success: null,
      code: null,
      message: null,
    };
  }

  let lastFailure = null;

  for (let attempt = 1; attempt <= MAX_AUTO_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      // Dùng chính App Check + API sendFollowRequest của Locket giống nút kết bạn Celeb thật.
      // Chỉ retry lỗi tạm thời; lỗi auth/logic không được spam upstream.
      const appCheckToken = await appCheckServices.getOrCreateAppCheckToken();
      const result = await requestServices.SendAddCelebrity(
        idToken,
        watch.celeb_uid,
        appCheckToken,
        { skipPreflight: true },
      );

      if (result?.success) {
        const sentNow = Boolean(result?.data?.sentNow ?? result?.sentNow);
        const alreadyPersisted = Boolean(
          result?.data?.alreadyPersisted ?? result?.alreadyPersisted,
        );
        const relationship = String(
          result?.data?.relationship || result?.relationship || "",
        );
        await store.markAutoRequestResult(userUid, watch.celeb_uid, {
          status: "SENT",
        });
        console.log(
          sentNow
            ? "[slot-monitor] real celebrity request sent and verified"
            : "[slot-monitor] celebrity relationship already verified",
          {
            userUid,
            username: watch.username,
            attempt,
            relationship: relationship || null,
          },
        );
        return {
          enabled: true,
          attempted: true,
          success: true,
          sentNow,
          alreadyPersisted,
          relationship: relationship || null,
          code: null,
          message: sentNow
            ? "Locket đã ghi nhận request Celeb vừa gửi."
            : "Locket xác nhận request/quan hệ Celeb đã tồn tại nên Railway không gửi lặp.",
          attempts: attempt,
        };
      }

      lastFailure = normalizeAutoRequestFailure(result, {
        defaultCode: "UPSTREAM_REJECTED",
        defaultMessage: "Locket không chấp nhận yêu cầu Celeb.",
      });
    } catch (error) {
      lastFailure = normalizeAutoRequestFailure(error);
    }

    console.warn("[slot-monitor] real celebrity request attempt failed", {
      userUid,
      username: watch?.username,
      attempt,
      maxAttempts: MAX_AUTO_REQUEST_ATTEMPTS,
      source: lastFailure.source,
      status: lastFailure.status,
      code: lastFailure.code,
      message: lastFailure.message,
      retryable: lastFailure.retryable,
    });

    if (!lastFailure.retryable || attempt >= MAX_AUTO_REQUEST_ATTEMPTS) {
      break;
    }

    const retryDelayMs = getAutoRequestRetryDelayMs(attempt, lastFailure.status);
    console.log("[slot-monitor] retrying real celebrity request", {
      userUid,
      username: watch?.username,
      nextAttempt: attempt + 1,
      retryDelayMs,
    });
    await sleep(retryDelayMs);
  }

  const finalFailure = lastFailure || normalizeAutoRequestFailure(null);
  const statusSuffix = finalFailure.status ? ` [HTTP ${finalFailure.status}]` : "";
  await store.markAutoRequestResult(userUid, watch.celeb_uid, {
    status: "FAILED",
    error: `${finalFailure.code}${statusSuffix}: ${finalFailure.message}`,
  }).catch(() => {});

  console.warn("[slot-monitor] real celebrity request failed", {
    userUid,
    username: watch?.username,
    source: finalFailure.source,
    status: finalFailure.status,
    code: finalFailure.code,
    message: finalFailure.message,
    retryable: finalFailure.retryable,
    attempts: MAX_AUTO_REQUEST_ATTEMPTS,
  });

  return {
    enabled: true,
    attempted: true,
    success: false,
    code: finalFailure.code,
    message: finalFailure.message,
    status: finalFailure.status,
    retryable: finalFailure.retryable,
    attempts: MAX_AUTO_REQUEST_ATTEMPTS,
  };
}

async function markAutoRequestSessionFailure(userUid, watch, error) {
  const failure = normalizeAutoRequestFailure(error, {
    defaultCode: "SLOT_SESSION_ERROR",
    defaultMessage: "Không thể làm mới phiên đăng nhập nền.",
  });
  const statusSuffix = failure.status ? ` [HTTP ${failure.status}]` : "";
  await store.markAutoRequestResult(userUid, watch.celeb_uid, {
    status: "FAILED",
    error: `${failure.code}${statusSuffix}: ${failure.message}`,
  }).catch(() => {});
  return {
    enabled: true,
    attempted: false,
    success: false,
    code: failure.code,
    message: failure.message,
    status: failure.status,
    retryable: failure.retryable,
    attempts: 0,
  };
}

async function processWatchSnapshot(
  userUid,
  watch,
  snapshot,
  { notify = true, idToken = null } = {},
) {
  try {
    const transition = computeTransition(watch, snapshot);
    // Start the snapshot write without blocking the short-lived slot mutation.
    // Convert rejection to a value immediately so it cannot become unhandled
    // while the request is being verified against Locket.
    const snapshotUpdatePromise = store
      .updateWatchSnapshot(userUid, watch.celeb_uid, transition)
      .then(() => null, (error) => error);

    let autoRequest = {
      enabled: Boolean(watch?.auto_request_enabled),
      attempted: false,
      success: null,
      code: null,
      message: null,
    };

    // Auto-request chạy độc lập với notification transition: chỉ cần còn >= 1 slot,
    // auto được bật và request chưa từng SENT thì Railway gửi request Celeb thật.
    // Nếu lỗi tạm thời, DB đánh dấu FAILED và worker sẽ thử lại sau cooldown ngắn.
    if (
      shouldAttemptAutoRequest(watch, transition.availableSlots, {
        isNewSlotEvent: transition.shouldNotify,
      })
    ) {
      let requestIdToken = idToken;
      if (!requestIdToken) {
        try {
          requestIdToken = await refreshUserSession(userUid);
        } catch (error) {
          autoRequest = await markAutoRequestSessionFailure(userUid, watch, error);
        }
      }
      if (requestIdToken) {
        autoRequest = await sendRealCelebrityRequest(userUid, requestIdToken, watch);
      }
    }

    const snapshotUpdateError = await snapshotUpdatePromise;
    if (snapshotUpdateError) throw snapshotUpdateError;

    const shouldNotifyNow = Boolean(
      notify && (transition.shouldNotify || autoRequest.success === true),
    );

    if (shouldNotifyNow) {
      const count = transition.availableSlots;
      let body = `@${watch.username} hiện còn ${count.toLocaleString("vi-VN")} slot trống. Nhấn để kết bạn ngay!`;
      let title = "🔥 Slot vừa mở!";

      if (autoRequest.success === true) {
        if (autoRequest.sentNow === true) {
          title = "⚡ Có slot — đã gửi và xác nhận request Celeb!";
          body = `@${watch.username} còn ${count.toLocaleString("vi-VN")} slot. Railway vừa gửi request Celeb và đã kiểm tra thấy trạng thái được lưu trên Locket.`;
        } else {
          title = "✓ Có slot — request Celeb đã tồn tại";
          body = `@${watch.username} còn ${count.toLocaleString("vi-VN")} slot. Locket đã có request/quan hệ với tài khoản này từ trước nên Railway không gửi lặp.`;
        }
      } else if (autoRequest.enabled && autoRequest.success === false) {
        const reason = String(autoRequest.message || "Locket không xác nhận request")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 180);
        title = "❌ Có slot — gửi request Celeb thất bại";
        body = `@${watch.username} còn ${count.toLocaleString("vi-VN")} slot. Gửi request Celeb thất bại: ${reason}. Hệ thống sẽ thử lại ở lượt canh kế tiếp nếu slot vẫn còn.`;
      }

      const payload = {
        type: "slot-open",
        title,
        body,
        icon: watch.avatar_url || "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        tag: `slot-${watch.celeb_uid}`,
        url: `/friends?slot=1&username=${encodeURIComponent(watch.username)}`,
        celeb: {
          uid: watch.celeb_uid,
          username: watch.username,
          displayName: watch.display_name || watch.username,
          availableSlots: count,
          friendCount: transition.friendCount,
          maxFriends: transition.maxFriends,
        },
        autoRequest,
      };
      const eventId = [
        watch.celeb_uid,
        transition.friendCount,
        transition.maxFriends,
        autoRequest.success === true
          ? autoRequest.sentNow === true
            ? "auto-sent-verified"
            : "auto-already-verified"
          : "slot-open",
      ].join("-");

      await Promise.allSettled([
        sendPushToUser(userUid, payload, { eventId }),
        sendConfiguredNotifications(userUid, payload, { eventId }),
      ]);
    }

    return { ok: true, transition, autoRequest };
  } catch (error) {
    console.warn("[slot-monitor] watch snapshot processing failed", {
      userUid,
      username: watch.username,
      status: errorStatus(error),
      code: error?.code || null,
    });
    return { ok: false, error };
  }
}

async function checkOneWatch(userUid, idToken, watch, { notify = true } = {}) {
  try {
    const result = await friendServices.FindFriendByUserName(idToken, watch.username);
    const snapshot = extractCelebritySnapshot(result);
    if (!snapshot) throw new Error("Celebrity slot data unavailable");
    return processWatchSnapshot(userUid, watch, snapshot, { notify, idToken });
  } catch (error) {
    console.warn("[slot-monitor] celeb check failed", {
      userUid,
      username: watch.username,
      status: errorStatus(error),
      code: error?.code || null,
    });
    return { ok: false, error };
  }
}

async function collectActiveWatchGroups() {
  const groups = new Map();
  const users = await store.listActiveUsers();

  for (const row of users) {
    try {
      const watches = await store.listActiveWatchesForUser(row.user_uid);
      for (const watch of watches) {
        const key = String(watch.celeb_uid || "").trim();
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(watch);
      }
    } catch (error) {
      console.warn("[slot-monitor] failed to load user watches", {
        userUid: row.user_uid,
        code: error?.code || null,
      });
    }
  }

  return groups;
}

async function fetchSharedCelebritySnapshot(watches) {
  let lastError = null;
  const attemptedUsers = new Set();

  for (const watch of watches) {
    const userUid = String(watch.user_uid || "");
    if (!userUid || attemptedUsers.has(userUid)) continue;
    attemptedUsers.add(userUid);

    let idToken;
    try {
      idToken = await refreshUserSession(userUid);
    } catch (error) {
      lastError = error;
      console.warn("[slot-monitor] shared celeb lookup skipped invalid session", {
        userUid,
        username: watch.username,
        code: error?.code || null,
      });
      continue;
    }

    try {
      const result = await friendServices.FindFriendByUserName(idToken, watch.username);
      const snapshot = extractCelebritySnapshot(result);
      if (!snapshot) {
        const error = new Error("Celebrity slot data unavailable");
        error.code = "CELEB_SNAPSHOT_UNAVAILABLE";
        throw error;
      }
      return { ok: true, snapshot, userUid, idToken };
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      console.warn("[slot-monitor] shared celeb lookup failed", {
        userUid,
        username: watch.username,
        status,
        code: error?.code || null,
      });

      // 401/403 may be account-specific, so another user's valid session can
      // still serve as the shared read. Other failures are likely upstream-wide.
      if (status !== 401 && status !== 403) break;
    }
  }

  return { ok: false, error: lastError || new Error("No valid session for celeb lookup") };
}

async function checkCelebrityGroup(celebUid, watches) {
  // Auto watches stay on the fast poll even after a previous successful send.
  // Otherwise SENT would slow future full -> open episodes back to 30 seconds.
  const turboPolling = hasEnabledAutoRequest(watches);
  const lookup = await fetchSharedCelebritySnapshot(watches);
  if (!lookup.ok) {
    return {
      ok: false,
      celebUid,
      error: lookup.error,
      status: errorStatus(lookup.error),
      rateLimited: errorStatus(lookup.error) === 429,
      turboPolling,
    };
  }

  const changed = hasSnapshotChanged(watches, lookup.snapshot);
  let rateLimited = false;

  for (let i = 0; i < watches.length; i += USER_ACTION_BATCH_SIZE) {
    const batch = watches.slice(i, i + USER_ACTION_BATCH_SIZE);
    const results = await Promise.all(
      batch.map((watch) => {
        const sharedToken = String(watch.user_uid) === String(lookup.userUid)
          ? lookup.idToken
          : null;
        return processWatchSnapshot(watch.user_uid, watch, lookup.snapshot, {
          notify: true,
          idToken: sharedToken,
        });
      }),
    );

    if (results.some((result) => Number(result?.autoRequest?.status) === 429)) {
      rateLimited = true;
    }
    if (i + USER_ACTION_BATCH_SIZE < watches.length) await sleep(BATCH_DELAY_MS);
  }

  return {
    ok: true,
    celebUid,
    snapshot: lookup.snapshot,
    changed,
    rateLimited,
    turboPolling,
  };
}

function getCelebPollingState(celebUid) {
  const key = String(celebUid);
  let state = celebPollingState.get(key);
  if (!state) {
    state = {
      nextCheckAt: 0,
      fastUntil: 0,
      rateLimitLevel: 0,
      backoffUntil: 0,
    };
    celebPollingState.set(key, state);
  }
  return state;
}

function scheduleStateAfterResult(state, result, now = Date.now()) {
  if (result?.rateLimited) {
    state.rateLimitLevel = Math.min(2, Number(state.rateLimitLevel || 0) + 1);
    const backoffMs = rateLimitBackoffMs(state.rateLimitLevel);
    state.backoffUntil = now + backoffMs;
    state.fastUntil = 0;
    state.nextCheckAt = state.backoffUntil;
    return;
  }

  if (!result?.ok) {
    state.rateLimitLevel = 0;
    state.backoffUntil = 0;
    state.fastUntil = 0;
    const retryIntervalMs = result?.turboPolling
      ? Math.max(5_000, AUTO_REQUEST_INTERVAL_MS)
      : POLL_INTERVAL_MS;
    state.nextCheckAt = now + jitteredIntervalMs(retryIntervalMs);
    return;
  }

  state.rateLimitLevel = 0;
  state.backoffUntil = 0;
  if (result.changed) {
    state.fastUntil = Math.max(Number(state.fastUntil || 0), now + FAST_WINDOW_MS);
  }

  const intervalMs = result.turboPolling
    ? AUTO_REQUEST_INTERVAL_MS
    : pollIntervalForState({
        fastUntil: state.fastUntil,
        now,
        normalIntervalMs: POLL_INTERVAL_MS,
      });
  state.nextCheckAt = now + jitteredIntervalMs(intervalMs);
}

function nextWorkerDelayMs(activeCelebUids, now = Date.now()) {
  if (!activeCelebUids.size) return POLL_INTERVAL_MS;
  let nextDelay = POLL_INTERVAL_MS;

  for (const celebUid of activeCelebUids) {
    const state = getCelebPollingState(celebUid);
    if (!state.nextCheckAt) return MIN_WORKER_DELAY_MS;
    nextDelay = Math.min(nextDelay, Math.max(0, state.nextCheckAt - now));
  }

  return Math.max(MIN_WORKER_DELAY_MS, Math.round(nextDelay));
}

async function runWorkerCycle() {
  if (workerRunning || !store.isConfigured() || !getEncryptionKey()) {
    return POLL_INTERVAL_MS;
  }

  workerRunning = true;
  try {
    await store.ensureSchema();
    const groups = await collectActiveWatchGroups();
    const activeCelebUids = new Set(groups.keys());

    for (const celebUid of celebPollingState.keys()) {
      if (!activeCelebUids.has(celebUid)) celebPollingState.delete(celebUid);
    }

    const now = Date.now();
    const dueGroups = [];
    for (const [celebUid, watches] of groups.entries()) {
      const state = getCelebPollingState(celebUid);
      if (!state.nextCheckAt || now >= state.nextCheckAt) {
        dueGroups.push([celebUid, watches]);
      }
    }

    for (let i = 0; i < dueGroups.length; i += CELEB_BATCH_SIZE) {
      const batch = dueGroups.slice(i, i + CELEB_BATCH_SIZE);
      const results = await Promise.all(
        batch.map(([celebUid, watches]) => checkCelebrityGroup(celebUid, watches)),
      );

      const completedAt = Date.now();
      for (const result of results) {
        const state = getCelebPollingState(result.celebUid);
        scheduleStateAfterResult(state, result, completedAt);

        if (result.turboPolling && !result.rateLimited) {
          console.log("[slot-monitor] auto-request turbo polling active", {
            celebUid: result.celebUid,
            intervalSeconds: AUTO_REQUEST_INTERVAL_MS / 1000,
          });
        } else if (result.changed) {
          console.log("[slot-monitor] celeb activity detected; fast polling enabled", {
            celebUid: result.celebUid,
            intervalSeconds: FAST_INTERVAL_MS / 1000,
            fastWindowSeconds: FAST_WINDOW_MS / 1000,
          });
        }
        if (result.rateLimited) {
          console.warn("[slot-monitor] rate limited; backing off celeb polling", {
            celebUid: result.celebUid,
            backoffSeconds: Math.round((state.backoffUntil - completedAt) / 1000),
          });
        }
      }

      if (i + CELEB_BATCH_SIZE < dueGroups.length) await sleep(BATCH_DELAY_MS);
    }

    return nextWorkerDelayMs(activeCelebUids, Date.now());
  } catch (error) {
    console.error("[slot-monitor] worker cycle failed", error?.message || error);
    return POLL_INTERVAL_MS;
  } finally {
    workerRunning = false;
  }
}

function scheduleWorker(delayMs = POLL_INTERVAL_MS) {
  const delay = Math.max(
    MIN_WORKER_DELAY_MS,
    Math.min(POLL_INTERVAL_MS, Math.round(Number(delayMs) || POLL_INTERVAL_MS)),
  );

  workerTimer = setTimeout(async () => {
    workerTimer = null;
    const nextDelay = await runWorkerCycle();
    scheduleWorker(nextDelay);
  }, delay);
  workerTimer.unref?.();
}

function startSlotMonitorWorker() {
  if (workerTimer || !store.isConfigured() || !getEncryptionKey()) {
    if (!store.isConfigured()) {
      console.warn("[slot-monitor] 24/7 worker disabled: DATABASE_URL missing");
    } else if (!getEncryptionKey()) {
      console.warn("[slot-monitor] 24/7 worker disabled: encryption secret missing");
    }
    return false;
  }

  console.log(
    `[slot-monitor] adaptive 24/7 worker enabled (normal ${(POLL_INTERVAL_MS / 1000).toFixed(0)}s, fast ${(FAST_INTERVAL_MS / 1000).toFixed(0)}s, auto-request ${(AUTO_REQUEST_INTERVAL_MS / 1000).toFixed(0)}s, shared celeb checks)`,
  );

  workerTimer = setTimeout(async () => {
    workerTimer = null;
    const nextDelay = await runWorkerCycle();
    scheduleWorker(nextDelay);
  }, 1_000);
  workerTimer.unref?.();
  return true;
}

async function checkNowForUser(userUid, celebUid, idToken) {
  const watches = await store.listUserWatches(userUid);
  const watch = watches.find((item) => String(item.celeb_uid) === String(celebUid));
  if (!watch) {
    const error = new Error("Không tìm thấy Celeb đang canh.");
    error.status = 404;
    error.code = "SLOT_WATCH_NOT_FOUND";
    throw error;
  }
  return checkOneWatch(userUid, idToken, watch, { notify: true });
}

module.exports = {
  POLL_INTERVAL_MS,
  getPublicConfig,
  enableBackgroundPush,
  validateAndSaveSession,
  sendPushToUser,
  sendRealCelebrityRequest,
  checkNowForUser,
  runWorkerCycle,
  startSlotMonitorWorker,
};
