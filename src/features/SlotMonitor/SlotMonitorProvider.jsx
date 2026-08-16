import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { FindFriendByUserName } from "@/services/LocketDioServices/FriendsServices";
import {
  canClaimLeader,
  canSendBrowserNotification,
  computeSlotTransition,
  extractCelebritySnapshot,
  SLOT_LEADER_TIMEOUT_MS,
  SLOT_POLL_INTERVAL_MS,
  SLOT_POLL_JITTER_MS,
  SLOT_STATUS,
  SLOT_VISIBILITY_COOLDOWN_MS,
} from "./slotMonitorCore";
import {
  addWatch,
  clearAllWatch,
  getWatchedCelebs,
  readLeaderLock,
  releaseLeaderLock,
  removeWatch,
  sendLeaderCommand,
  SLOT_MONITOR_COMMAND_KEY,
  SLOT_MONITOR_STORAGE_KEY,
  updateWatch,
  writeLeaderLock,
} from "./slotMonitorStorage";
import {
  enableSlotPush,
  removeSlotWatch,
  setServerSlotWatchEnabled,
  syncExistingWatches,
  syncSlotWatch,
  testSlotPush,
} from "./slotPushService";

export const SlotMonitorContext = createContext(null);

const CHANNEL_NAME = "huy-locket-slot-monitor";
const HEARTBEAT_MS = 10 * 1000;
const LEADER_CHECK_MS = 5 * 1000;
const BATCH_DELAY_MS = 500;
const AUTH_BACKOFF_MS = 5 * 60 * 1000;

const makeTabId = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

const isAuthError = (error) =>
  error?.code === "AUTH_REQUIRED" || error?.status === 401 || error?.response?.status === 401;

export function SlotMonitorProvider({ children }) {
  const navigate = useNavigate();
  const tabIdRef = useRef(makeTabId());
  const leaderRef = useRef(false);
  const channelRef = useRef(null);
  const pollTimerRef = useRef(null);
  const lastPollAtRef = useRef(0);
  const authBlockedUntilRef = useRef(0);
  const eventIdsRef = useRef(new Set());
  const backgroundHydratedRef = useRef(false);
  const pushEnabledRef = useRef(false);

  const [watchedCelebs, setWatchedCelebs] = useState(() => getWatchedCelebs());
  const [isLeader, setIsLeader] = useState(false);
  const [checkingUids, setCheckingUids] = useState([]);
  const [slotPushState, setSlotPushState] = useState({
    checking: false,
    enabled: false,
    backgroundEnabled: false,
    permission:
      typeof window !== "undefined" && "Notification" in window
        ? window.Notification.permission
        : "unsupported",
    reason: null,
  });

  const syncFromStorage = useCallback(() => {
    setWatchedCelebs(getWatchedCelebs());
  }, []);

  const broadcast = useCallback((message) => {
    try {
      channelRef.current?.postMessage(message);
    } catch {
      /* optional cross-tab channel */
    }
  }, []);

  const setLeader = useCallback((value) => {
    leaderRef.current = value;
    setIsLeader(value);
  }, []);

  const tryClaimLeader = useCallback(() => {
    const tabId = tabIdRef.current;
    const now = Date.now();
    const current = readLeaderLock();
    if (!canClaimLeader(current, tabId, now)) {
      setLeader(false);
      return false;
    }
    writeLeaderLock({ id: tabId, ts: now });
    const verified = readLeaderLock();
    const won = verified?.id === tabId;
    setLeader(won);
    if (won) broadcast({ type: "LEADER_HEARTBEAT", id: tabId, ts: now });
    return won;
  }, [broadcast, setLeader]);

  const goToCeleb = useCallback(
    (username) => navigate(`/friends?slot=1&username=${encodeURIComponent(username || "")}`),
    [navigate],
  );

  const enableBackgroundPush = useCallback(
    async ({ requestPermission = true, showFeedback = true } = {}) => {
      setSlotPushState((current) => ({ ...current, checking: true }));
      try {
        const result = await enableSlotPush({ requestPermission });
        pushEnabledRef.current = Boolean(result?.enabled);
        setSlotPushState({
          checking: false,
          enabled: Boolean(result?.enabled),
          backgroundEnabled: Boolean(result?.backgroundEnabled),
          permission: result?.permission || window.Notification?.permission || "unsupported",
          reason: result?.reason || null,
        });

        if (result?.backgroundEnabled) {
          await syncExistingWatches(getWatchedCelebs()).catch(() => {});
        }

        if (showFeedback) {
          if (result?.enabled) {
            toast.success("🔔 Canh Slot 24/7 đã bật", {
              description: "Có slot sẽ báo ra thông báo điện thoại/màn hình khóa.",
            });
          } else if (result?.backgroundEnabled && result?.permission === "denied") {
            toast.warning("Canh nền đã bật nhưng thông báo đang bị chặn", {
              description: "Hãy cho phép thông báo của Huy Locket để nhận ngoài màn hình khóa.",
            });
          } else {
            toast.warning("Chưa bật được thông báo Canh Slot 24/7", {
              description: "Canh Slot trong web vẫn hoạt động bình thường.",
            });
          }
        }
        return result;
      } catch (error) {
        pushEnabledRef.current = false;
        setSlotPushState((current) => ({
          ...current,
          checking: false,
          enabled: false,
          reason: error?.response?.data?.code || error?.code || "ENABLE_FAILED",
        }));
        if (showFeedback) {
          toast.error("Không thể bật Canh Slot 24/7", {
            description:
              error?.response?.data?.message || error?.message || "Canh Slot trong web vẫn hoạt động.",
          });
        }
        return { enabled: false, backgroundEnabled: false };
      }
    },
    [],
  );

  const showSlotAlert = useCallback(
    (celeb, availableSlots, { browser = false, eventId } = {}) => {
      const dedupeId = eventId || `${celeb.uid}:${celeb.notifiedAt || Date.now()}`;
      if (eventIdsRef.current.has(dedupeId)) return;
      eventIdsRef.current.add(dedupeId);

      const countText = `${availableSlots} slot`;
      toast.success(`🔥 @${celeb.username} vừa mở ${countText}!`, {
        description: "Bấm để mở hồ sơ và kết bạn ngay.",
        duration: 10000,
        action: {
          label: "Kết bạn ngay",
          onClick: () => goToCeleb(celeb.username),
        },
      });

      // Khi Web Push 24/7 đã bật, Service Worker phụ trách notification hệ thống.
      // Notification() chỉ là fallback để không tạo thông báo trùng.
      const supported = typeof window !== "undefined" && "Notification" in window;
      if (
        browser &&
        !pushEnabledRef.current &&
        supported &&
        canSendBrowserNotification(window.Notification.permission, supported)
      ) {
        try {
          const notification = new window.Notification("🔥 Slot vừa mở!", {
            body: `@${celeb.username} vừa mở ${countText}. Vào kết bạn ngay!`,
            icon: celeb.avatar || "/images/default_profile.png",
            tag: `slot-${celeb.uid}`,
          });
          notification.onclick = () => {
            window.focus();
            goToCeleb(celeb.username);
            notification.close();
          };
        } catch {
          /* toast vẫn hoạt động */
        }
      }
    },
    [goToCeleb],
  );

  const runOneCheck = useCallback(
    async (inputCeleb, { allowNotify = true } = {}) => {
      const latest = getWatchedCelebs().find((item) => item.uid === inputCeleb.uid);
      if (!latest || latest.status === SLOT_STATUS.PAUSED) return { ok: true, skipped: true };

      setCheckingUids((current) =>
        current.includes(latest.uid) ? current : [...current, latest.uid],
      );

      try {
        const result = await FindFriendByUserName(latest.username);
        if (result?.success === false) throw new Error("Slot lookup rejected");
        const snapshot = extractCelebritySnapshot(result);
        if (!snapshot) throw new Error("Celebrity slot data unavailable");

        const transition = computeSlotTransition(latest, snapshot, Date.now());
        const saved = updateWatch(latest.uid, transition.updates);
        const updated = saved.find((item) => item.uid === latest.uid) || {
          ...latest,
          ...transition.updates,
        };

        syncFromStorage();
        broadcast({ type: "SYNC_STATE" });

        if (allowNotify && transition.shouldNotify) {
          const eventId = `${updated.uid}:${updated.notifiedAt}`;
          showSlotAlert(updated, snapshot.availableSlots, {
            browser: leaderRef.current,
            eventId,
          });
          broadcast({
            type: "SLOT_OPENED",
            celeb: updated,
            availableSlots: snapshot.availableSlots,
            eventId,
          });
        }
        return { ok: true, snapshot, updated };
      } catch (error) {
        const current = getWatchedCelebs().find((item) => item.uid === latest.uid) || latest;
        const errorCount = (current.errorCount || 0) + 1;
        updateWatch(latest.uid, {
          errorCount,
          lastCheckedAt: Date.now(),
          status: errorCount >= 3 ? SLOT_STATUS.ERROR : current.status,
        });
        syncFromStorage();
        broadcast({ type: "SYNC_STATE" });
        if (isAuthError(error)) authBlockedUntilRef.current = Date.now() + AUTH_BACKOFF_MS;
        return { ok: false, authError: isAuthError(error) };
      } finally {
        setCheckingUids((current) => current.filter((uid) => uid !== latest.uid));
      }
    },
    [broadcast, showSlotAlert, syncFromStorage],
  );

  const pollCelebs = useCallback(async () => {
    if (!leaderRef.current) return;
    if (Date.now() < authBlockedUntilRef.current) return;

    const candidates = getWatchedCelebs().filter((item) =>
      [SLOT_STATUS.WATCHING, SLOT_STATUS.SLOT_OPEN, SLOT_STATUS.ERROR].includes(item.status),
    );
    lastPollAtRef.current = Date.now();

    for (let i = 0; i < candidates.length; i += 2) {
      const batch = candidates.slice(i, i + 2);
      const results = await Promise.all(batch.map((celeb) => runOneCheck(celeb)));
      if (results.some((result) => result?.authError)) break;
      if (i + 2 < candidates.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }
  }, [runOneCheck]);

  const requestCheckNow = useCallback(
    async (uid) => {
      if (leaderRef.current) {
        const celeb = getWatchedCelebs().find((item) => item.uid === uid);
        if (celeb) await runOneCheck(celeb);
        return;
      }
      setCheckingUids((current) => (current.includes(uid) ? current : [...current, uid]));
      const message = { type: "CHECK_NOW", uid };
      if (channelRef.current) broadcast(message);
      else sendLeaderCommand(message);
      setTimeout(
        () => setCheckingUids((current) => current.filter((item) => item !== uid)),
        12000,
      );
    },
    [broadcast, runOneCheck],
  );

  useEffect(() => {
    let channel = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = channel;
    }

    const handleMessage = (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "LEADER_HEARTBEAT" && message.id !== tabIdRef.current) {
        const lock = readLeaderLock();
        if (lock?.id === message.id) setLeader(false);
      }
      if (message.type === "SYNC_STATE") syncFromStorage();
      if (message.type === "SLOT_OPENED") {
        syncFromStorage();
        showSlotAlert(message.celeb, message.availableSlots, {
          browser: false,
          eventId: message.eventId,
        });
      }
      if (message.type === "CHECK_NOW" && leaderRef.current) {
        const celeb = getWatchedCelebs().find((item) => item.uid === message.uid);
        if (celeb) runOneCheck(celeb);
      }
    };

    if (channel) channel.onmessage = (event) => handleMessage(event.data);

    const onStorage = (event) => {
      if (event.key === SLOT_MONITOR_STORAGE_KEY) syncFromStorage();
      if (event.key === SLOT_MONITOR_COMMAND_KEY && leaderRef.current && event.newValue) {
        try {
          handleMessage(JSON.parse(event.newValue));
        } catch {
          /* ignore malformed cross-tab command */
        }
      }
    };
    window.addEventListener("storage", onStorage);

    const leaderTick = () => {
      const tabId = tabIdRef.current;
      const now = Date.now();
      if (leaderRef.current) {
        const current = readLeaderLock();
        if (current?.id && current.id !== tabId && !canClaimLeader(current, tabId, now)) {
          setLeader(false);
          return;
        }
        writeLeaderLock({ id: tabId, ts: now });
        broadcast({ type: "LEADER_HEARTBEAT", id: tabId, ts: now });
        return;
      }
      const current = readLeaderLock();
      if (!current || now - Number(current.ts || 0) > SLOT_LEADER_TIMEOUT_MS) tryClaimLeader();
    };

    const startupTimer = setTimeout(tryClaimLeader, 60 + Math.floor(Math.random() * 240));
    const leaderTimer = setInterval(leaderTick, LEADER_CHECK_MS);
    const heartbeatTimer = setInterval(() => {
      if (!leaderRef.current) return;
      const now = Date.now();
      writeLeaderLock({ id: tabIdRef.current, ts: now });
      broadcast({ type: "LEADER_HEARTBEAT", id: tabIdRef.current, ts: now });
    }, HEARTBEAT_MS);

    const release = () => releaseLeaderLock(tabIdRef.current);
    window.addEventListener("beforeunload", release);

    return () => {
      clearTimeout(startupTimer);
      clearInterval(leaderTimer);
      clearInterval(heartbeatTimer);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", release);
      release();
      channel?.close();
      channelRef.current = null;
    };
  }, [broadcast, runOneCheck, setLeader, showSlotAlert, syncFromStorage, tryClaimLeader]);

  useEffect(() => {
    if (!isLeader) return undefined;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const jitter = Math.floor((Math.random() * 2 - 1) * SLOT_POLL_JITTER_MS);
      pollTimerRef.current = setTimeout(async () => {
        await pollCelebs();
        schedule();
      }, Math.max(30000, SLOT_POLL_INTERVAL_MS + jitter));
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(pollTimerRef.current);
    };
  }, [isLeader, pollCelebs]);

  useEffect(() => {
    const onVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        leaderRef.current &&
        Date.now() - lastPollAtRef.current > SLOT_VISIBILITY_COOLDOWN_MS
      ) {
        pollCelebs();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [pollCelebs]);

  // Nếu user đã cấp quyền từ trước, tự nối lại Web Push khi mở Huy Locket.
  useEffect(() => {
    if (backgroundHydratedRef.current || watchedCelebs.length === 0) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (window.Notification.permission !== "granted") return;

    backgroundHydratedRef.current = true;
    const timer = setTimeout(() => {
      enableBackgroundPush({ requestPermission: false, showFeedback: false });
    }, 1200);
    return () => clearTimeout(timer);
  }, [watchedCelebs.length, enableBackgroundPush]);

  const watchCeleb = useCallback(
    async (celeb) => {
      try {
        addWatch(celeb);
        syncFromStorage();
        broadcast({ type: "SYNC_STATE" });

        // User click là user gesture hợp lệ để xin quyền notification.
        const background = await enableBackgroundPush({
          requestPermission: true,
          showFeedback: false,
        });
        if (background?.backgroundEnabled) {
          await syncSlotWatch(celeb).catch(() => {});
        }

        if (background?.enabled) {
          toast.success("🔔 Đang canh cả khi đóng Huy Locket", {
            description: "Có slot sẽ báo về thông báo điện thoại/màn hình khóa.",
          });
        } else if (background?.permission === "denied") {
          toast.warning("Đã canh nhưng điện thoại đang chặn thông báo", {
            description: "Bật quyền thông báo cho Huy Locket để nhận ngoài màn hình khóa.",
          });
        } else {
          toast.success("Đã bật Canh Slot", {
            description: "Canh trong web đang chạy; có thể bật thông báo 24/7 trong danh sách Canh Slot.",
          });
        }
      } catch (error) {
        toast.error(error?.message || "Không thể bật Canh Slot.");
      }
    },
    [broadcast, enableBackgroundPush, syncFromStorage],
  );

  const unwatchCeleb = useCallback(
    (uid) => {
      removeWatch(uid);
      removeSlotWatch(uid).catch(() => {});
      syncFromStorage();
      broadcast({ type: "SYNC_STATE" });
    },
    [broadcast, syncFromStorage],
  );

  const pauseWatch = useCallback(
    (uid) => {
      updateWatch(uid, { status: SLOT_STATUS.PAUSED });
      setServerSlotWatchEnabled(uid, false).catch(() => {});
      syncFromStorage();
      broadcast({ type: "SYNC_STATE" });
    },
    [broadcast, syncFromStorage],
  );

  const resumeWatch = useCallback(
    (uid) => {
      const item = getWatchedCelebs().find((entry) => entry.uid === uid);
      updateWatch(uid, {
        status: item?.lastWasFull === false ? SLOT_STATUS.SLOT_OPEN : SLOT_STATUS.WATCHING,
        errorCount: 0,
      });
      setServerSlotWatchEnabled(uid, true).catch(() => {});
      syncFromStorage();
      broadcast({ type: "SYNC_STATE" });
    },
    [broadcast, syncFromStorage],
  );

  const clearAll = useCallback(async () => {
    const current = getWatchedCelebs();
    clearAllWatch();
    syncFromStorage();
    broadcast({ type: "SYNC_STATE" });
    await Promise.allSettled(current.map((item) => removeSlotWatch(item.uid)));
  }, [broadcast, syncFromStorage]);

  const testBackgroundPush = useCallback(async () => {
    const state = await enableBackgroundPush({ requestPermission: true, showFeedback: false });
    if (!state?.enabled) {
      toast.error("Chưa thể gửi thông báo test", {
        description: "Hãy cho phép thông báo của Huy Locket trước.",
      });
      return false;
    }
    await testSlotPush();
    toast.success("Đã gửi thông báo test", {
      description: "Kiểm tra thanh thông báo hoặc màn hình khóa điện thoại.",
    });
    return true;
  }, [enableBackgroundPush]);

  const value = useMemo(
    () => ({
      watchedCelebs,
      isLeader,
      checkingUids,
      slotPushState,
      watchCeleb,
      unwatchCeleb,
      pauseWatch,
      resumeWatch,
      checkNow: requestCheckNow,
      clearAll,
      enableBackgroundPush,
      testBackgroundPush,
      isWatching: (uid) => watchedCelebs.some((item) => item.uid === uid),
      getWatch: (uid) => watchedCelebs.find((item) => item.uid === uid) || null,
    }),
    [
      watchedCelebs,
      isLeader,
      checkingUids,
      slotPushState,
      watchCeleb,
      unwatchCeleb,
      pauseWatch,
      resumeWatch,
      requestCheckNow,
      clearAll,
      enableBackgroundPush,
      testBackgroundPush,
    ],
  );

  return <SlotMonitorContext.Provider value={value}>{children}</SlotMonitorContext.Provider>;
}
