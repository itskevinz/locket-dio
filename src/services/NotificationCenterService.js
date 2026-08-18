import { getMyLocalId } from "@/utils/auth/getMyLocalId";

const STORAGE_PREFIX = "huy-locket-notifications:v1";
const CHANGE_EVENT = "huy-locket:notifications-changed";
const MAX_ITEMS = 120;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;

function currentUserKey() {
  return String(getMyLocalId() || "anonymous").trim() || "anonymous";
}

function storageKey() {
  return `${STORAGE_PREFIX}:${currentUserKey()}`;
}

function makeId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function safeParse(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLevel(level) {
  return ["success", "error", "warning", "info"].includes(level)
    ? level
    : "info";
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  return {
    id: String(item.id || makeId()),
    type: String(item.type || "system"),
    title: String(item.title || "Thông báo"),
    message: String(item.message || ""),
    level: normalizeLevel(item.level),
    createdAt: Number(item.createdAt || Date.now()),
    read: Boolean(item.read),
    username: item.username ? String(item.username) : "",
    actionUrl: item.actionUrl ? String(item.actionUrl) : "",
    dedupeKey: item.dedupeKey ? String(item.dedupeKey) : "",
    meta: item.meta && typeof item.meta === "object" ? item.meta : {},
  };
}

function readRaw() {
  if (typeof window === "undefined") return [];
  try {
    return safeParse(window.localStorage.getItem(storageKey()))
      .map(normalizeItem)
      .filter(Boolean)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function emitChanged(items) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(CHANGE_EVENT, {
      detail: { items, userKey: currentUserKey() },
    }),
  );
}

function writeRaw(items) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeItem)
    .filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ITEMS);

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(storageKey(), JSON.stringify(normalized));
    } catch {
      // Lịch sử là tiện ích bổ sung; quota/storage lỗi không được làm hỏng thao tác chính.
    }
  }
  emitChanged(normalized);
  return normalized;
}

export function getNotifications() {
  return readRaw();
}

export function getUnreadNotificationCount() {
  return readRaw().filter((item) => !item.read).length;
}

export function addNotification({
  type = "system",
  title = "Thông báo",
  message = "",
  level = "info",
  username = "",
  actionUrl = "",
  dedupeKey = "",
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  meta = {},
} = {}) {
  const now = Date.now();
  const items = readRaw();
  const normalizedDedupeKey = String(dedupeKey || "").trim();

  if (normalizedDedupeKey) {
    const duplicate = items.find(
      (item) =>
        item.dedupeKey === normalizedDedupeKey &&
        now - Number(item.createdAt || 0) <= Math.max(0, Number(dedupeWindowMs) || 0),
    );
    if (duplicate) return duplicate;
  }

  const next = normalizeItem({
    id: makeId(),
    type,
    title,
    message,
    level,
    username,
    actionUrl,
    dedupeKey: normalizedDedupeKey,
    meta,
    createdAt: now,
    read: false,
  });
  writeRaw([next, ...items]);
  return next;
}

export function markNotificationRead(id) {
  const targetId = String(id || "");
  return writeRaw(
    readRaw().map((item) =>
      item.id === targetId ? { ...item, read: true } : item,
    ),
  );
}

export function markAllNotificationsRead() {
  return writeRaw(readRaw().map((item) => ({ ...item, read: true })));
}

export function clearNotifications() {
  return writeRaw([]);
}

export function subscribeNotifications(callback) {
  if (typeof window === "undefined" || typeof callback !== "function") {
    return () => {};
  }

  const onChanged = (event) => {
    if (event?.detail?.userKey && event.detail.userKey !== currentUserKey()) return;
    callback(getNotifications());
  };
  const onStorage = (event) => {
    if (event.key === storageKey()) callback(getNotifications());
  };

  window.addEventListener(CHANGE_EVENT, onChanged);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChanged);
    window.removeEventListener("storage", onStorage);
  };
}

if (typeof window !== "undefined" && !window.__HUY_NOTIFICATION_RECOVERY_BOUND__) {
  window.__HUY_NOTIFICATION_RECOVERY_BOUND__ = true;
  window.addEventListener("huy-locket-realtime-recovered", (event) => {
    const detail = event?.detail || {};
    const failed = Math.max(0, Number(detail.failed || 0));
    if (failed <= 0) return;

    addNotification({
      type: "sync",
      title: "Đồng bộ sau khi kết nối lại chưa hoàn tất",
      message: `${failed} tác vụ đồng bộ chưa thành công. Web sẽ tiếp tục dùng dữ liệu hiện có và đồng bộ lại ở lần kết nối tiếp theo.`,
      level: "warning",
      dedupeKey: `recovery-sync:${detail.recoveryEpoch || detail.at || Date.now()}`,
      dedupeWindowMs: 10 * 60 * 1000,
      meta: {
        failed,
        completed: Number(detail.completed || 0),
        reason: detail.reason || "socket-reconnect",
      },
    });
  });
}
