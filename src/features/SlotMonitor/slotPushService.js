import { instanceMain } from "@/libs/instanceMain";
import { getToken, urlBase64ToUint8Array } from "@/utils";

function toBase64Url(buffer) {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function getSlotPushConfig() {
  const response = await instanceMain.get("api/slot-monitor/config");
  return response?.data?.data || null;
}

export async function fetchServerSlotWatches() {
  const response = await instanceMain.get("api/slot-monitor/watches");
  const watches = response?.data?.data;
  return Array.isArray(watches) ? watches : [];
}

async function getRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

async function ensureMatchingSubscription(registration, vapidPublicKey) {
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const currentKey = toBase64Url(subscription.options?.applicationServerKey);
    if (currentKey && currentKey !== vapidPublicKey) {
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    });
  }
  return subscription;
}

export async function enableSlotPush({ requestPermission = true } = {}) {
  if (typeof window === "undefined") {
    return { enabled: false, backgroundEnabled: false, reason: "WINDOW_UNAVAILABLE" };
  }

  const notificationSupported = "Notification" in window;
  const serviceWorkerSupported =
    typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const pushManagerSupported = "PushManager" in window;
  const pushSupported =
    notificationSupported && serviceWorkerSupported && pushManagerSupported;

  const config = await getSlotPushConfig();
  if (!config?.enabled || !config?.vapidPublicKey) {
    return {
      enabled: false,
      backgroundEnabled: false,
      permission: notificationSupported ? window.Notification.permission : "unsupported",
      reason: config?.reason || "SERVER_UNAVAILABLE",
    };
  }

  let permission = notificationSupported
    ? window.Notification.permission
    : "unsupported";

  if (
    pushSupported &&
    permission === "default" &&
    requestPermission
  ) {
    permission = await window.Notification.requestPermission();
  }

  const { refreshToken } = getToken();
  if (!refreshToken) {
    return {
      enabled: false,
      backgroundEnabled: false,
      reason: "REFRESH_TOKEN_REQUIRED",
      permission,
    };
  }

  let subscription = null;
  let pushReason = null;

  if (pushSupported && permission === "granted") {
    const registration = await getRegistration();
    if (registration) {
      try {
        subscription = await ensureMatchingSubscription(
          registration,
          config.vapidPublicKey,
        );
      } catch (error) {
        pushReason = error?.name || "PUSH_SUBSCRIBE_FAILED";
      }
    } else {
      pushReason = "SERVICE_WORKER_UNAVAILABLE";
    }
  } else if (!notificationSupported) {
    pushReason = "NOTIFICATION_UNSUPPORTED";
  } else if (!serviceWorkerSupported || !pushManagerSupported) {
    pushReason = "PUSH_UNSUPPORTED";
  } else if (permission === "denied") {
    pushReason = "PERMISSION_DENIED";
  }

  // Quan trọng: kể cả thiết bị hiện tại không hỗ trợ Web Push, vẫn lưu phiên nền
  // để Railway canh 24/7 và đồng bộ danh sách cho các thiết bị khác cùng tài khoản.
  await instanceMain.post("api/slot-monitor/enable", {
    refreshToken,
    subscription: subscription?.toJSON?.() || subscription || null,
  });

  return {
    enabled: permission === "granted" && Boolean(subscription),
    backgroundEnabled: true,
    permission,
    reason: pushReason,
  };
}

export async function syncSlotWatch(watch) {
  return instanceMain.post("api/slot-monitor/watch", { watch });
}

export async function removeSlotWatch(uid) {
  return instanceMain.delete(`api/slot-monitor/watch/${encodeURIComponent(uid)}`);
}

export async function setServerSlotWatchEnabled(uid, enabled) {
  return instanceMain.patch(`api/slot-monitor/watch/${encodeURIComponent(uid)}`, {
    enabled,
  });
}

export async function setServerSlotAutoRequestEnabled(uid, autoRequestEnabled) {
  const response = await instanceMain.patch(
    `api/slot-monitor/watch/${encodeURIComponent(uid)}`,
    { autoRequestEnabled: Boolean(autoRequestEnabled) },
  );
  return response?.data?.data || null;
}

export async function checkServerSlotWatchNow(uid) {
  return instanceMain.post(`api/slot-monitor/check/${encodeURIComponent(uid)}`);
}

export async function testSlotPush() {
  return instanceMain.post("api/slot-monitor/test-push");
}

export async function syncExistingWatches(watches = []) {
  const safe = Array.isArray(watches) ? watches.slice(0, 20) : [];
  for (const watch of safe) {
    await syncSlotWatch(watch);
  }
  return safe.length;
}
