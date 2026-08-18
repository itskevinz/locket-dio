import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CheckCircle2,
  Flame,
  RefreshCw,
  Trash2,
  UploadCloud,
  UserPlus,
  X,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  addNotification,
  clearNotifications,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeNotifications,
} from "@/services/NotificationCenterService";
import { fetchSlotNotificationHistory } from "@/features/SlotMonitor/slotNotificationService";
import { useSlotMonitor } from "@/features/SlotMonitor/useSlotMonitor";
import { SLOT_STATUS } from "@/features/SlotMonitor/slotMonitorCore";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";

const REMOTE_SEEN_PREFIX = "huy-locket-notification-remote-seen:v1";

const TYPE_META = {
  friend_request: { icon: UserPlus, label: "Kết bạn" },
  celeb_request: { icon: UserPlus, label: "Celebrity" },
  celeb_slot: { icon: Flame, label: "Canh Slot" },
  post: { icon: UploadCloud, label: "Đăng bài" },
  sync: { icon: RefreshCw, label: "Đồng bộ" },
  slot_delivery: { icon: Bell, label: "Thông báo nền" },
  system: { icon: Bell, label: "Hệ thống" },
};

const LEVEL_META = {
  success: { icon: CheckCircle2, className: "text-success", label: "Thành công" },
  error: { icon: XCircle, className: "text-error", label: "Thất bại" },
  warning: { icon: AlertTriangle, className: "text-warning", label: "Cảnh báo" },
  info: { icon: Bell, className: "text-info", label: "Thông tin" },
};

function remoteSeenKey() {
  return `${REMOTE_SEEN_PREFIX}:${String(getMyLocalId() || "anonymous")}`;
}

function readRemoteSeenAt() {
  try {
    return Number(localStorage.getItem(remoteSeenKey()) || 0) || 0;
  } catch {
    return 0;
  }
}

function saveRemoteSeenAt(value) {
  const next = Math.max(0, Number(value) || 0);
  try {
    localStorage.setItem(remoteSeenKey(), String(next));
  } catch {
    /* optional read marker */
  }
  return next;
}

function formatTime(value) {
  const date = new Date(Number(value) || value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function mapRemoteRows(rows, seenAt) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const createdAt = Number(row?.createdAt || 0) || Date.now();
    return {
      id: `remote:${row?.id || `${createdAt}:${index}`}`,
      source: "remote",
      type: "slot_delivery",
      title: row?.title || "Thông báo Canh Slot",
      message: row?.body || row?.errorMessage || "",
      level:
        row?.status === "SUCCESS"
          ? "success"
          : row?.status === "FAILED"
            ? "error"
            : row?.status === "PARTIAL"
              ? "warning"
              : "info",
      createdAt,
      read: createdAt <= seenAt,
      username: row?.username || "",
      actionUrl: row?.url || "",
      channel: row?.channel || "",
    };
  });
}

export default function GlobalNotificationCenter() {
  const navigate = useNavigate();
  const { watchedCelebs = [] } = useSlotMonitor();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [localRows, setLocalRows] = useState(() => getNotifications());
  const [remoteRows, setRemoteRows] = useState([]);
  const [remoteSeenAt, setRemoteSeenAt] = useState(() => readRemoteSeenAt());
  const [loading, setLoading] = useState(false);

  const loadRemote = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setRemoteRows(await fetchSlotNotificationHistory({ limit: 100 }));
    } catch {
      // Lịch sử web vẫn hoạt động nếu API thông báo nền tạm lỗi.
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => subscribeNotifications(setLocalRows), []);

  useEffect(() => {
    loadRemote(true);
    const timer = window.setInterval(() => loadRemote(true), 60_000);
    return () => window.clearInterval(timer);
  }, [loadRemote]);

  useEffect(() => {
    const now = Date.now();
    watchedCelebs.forEach((celeb) => {
      const notifiedAt = Number(celeb?.notifiedAt || 0);
      const recent = notifiedAt > 0 && now - notifiedAt <= 15 * 60 * 1000;

      if (celeb?.status === SLOT_STATUS.SLOT_OPEN && recent) {
        const friendCount = Number(celeb?.friendCount || 0);
        const maxFriends = Number(celeb?.maxFriends || 0);
        const availableSlots = Math.max(0, maxFriends - friendCount);
        addNotification({
          type: "celeb_slot",
          title: `@${celeb.username || "Celebrity"} vừa mở slot`,
          message:
            availableSlots > 0
              ? `Đang có ${availableSlots.toLocaleString("vi-VN")} slot trống. Bấm để mở hồ sơ.`
              : "Canh Slot vừa ghi nhận trạng thái có chỗ trống.",
          level: "success",
          username: celeb?.username || "",
          actionUrl: `/friends?slot=1&username=${encodeURIComponent(celeb?.username || "")}`,
          dedupeKey: `slot-open:${celeb?.uid || celeb?.username}:${notifiedAt}`,
          dedupeWindowMs: 24 * 60 * 60 * 1000,
          meta: { uid: celeb?.uid || "", availableSlots },
        });
      }

      if (
        celeb?.status === SLOT_STATUS.ERROR &&
        Number(celeb?.errorCount || 0) >= 3 &&
        Number(celeb?.lastCheckedAt || 0) > now - 15 * 60 * 1000
      ) {
        addNotification({
          type: "sync",
          title: "Canh Slot đang gặp lỗi đồng bộ",
          message: `Chưa cập nhật được @${celeb?.username || "Celebrity"} sau nhiều lần kiểm tra.`,
          level: "warning",
          username: celeb?.username || "",
          actionUrl: "/friends?slot=1",
          dedupeKey: `slot-sync-error:${celeb?.uid || celeb?.username}`,
          dedupeWindowMs: 30 * 60 * 1000,
          meta: { uid: celeb?.uid || "", errorCount: Number(celeb?.errorCount || 0) },
        });
      }
    });
  }, [watchedCelebs]);

  useEffect(() => {
    if (!open) return undefined;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    loadRemote();
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, [loadRemote, open]);

  const remoteItems = useMemo(
    () => mapRemoteRows(remoteRows, remoteSeenAt),
    [remoteRows, remoteSeenAt],
  );
  const items = useMemo(
    () =>
      [...localRows.map((item) => ({ ...item, source: "local" })), ...remoteItems].sort(
        (a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0),
      ),
    [localRows, remoteItems],
  );
  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items]);
  const shown = useMemo(
    () => (filter === "unread" ? items.filter((item) => !item.read) : items),
    [filter, items],
  );

  const markRemoteThrough = useCallback((createdAt) => {
    const next = saveRemoteSeenAt(Math.max(readRemoteSeenAt(), Number(createdAt) || 0));
    setRemoteSeenAt(next);
  }, []);

  const markRead = useCallback(
    (item) => {
      if (item.source === "remote") markRemoteThrough(item.createdAt);
      else markNotificationRead(item.id);
    },
    [markRemoteThrough],
  );

  const markAll = useCallback(() => {
    markAllNotificationsRead();
    const newest = remoteRows.reduce(
      (max, row) => Math.max(max, Number(row?.createdAt || 0)),
      0,
    );
    if (newest) markRemoteThrough(newest);
  }, [markRemoteThrough, remoteRows]);

  const openItem = useCallback(
    (item) => {
      markRead(item);
      if (!item.actionUrl || !item.actionUrl.startsWith("/")) return;
      setOpen(false);
      navigate(item.actionUrl);
    },
    [markRead, navigate],
  );

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-circle relative"
        aria-label={`Thông báo${unreadCount ? `, ${unreadCount} chưa đọc` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold text-error-content ring-2 ring-base-100">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
          onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
        >
          <section className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-base-300 bg-base-100 shadow-2xl sm:max-h-[82vh] sm:rounded-3xl">
            <header className="border-b border-base-300 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Bell size={21} />
                    <h2 className="text-lg font-bold">Thông báo</h2>
                    {unreadCount > 0 && (
                      <span className="badge badge-error badge-sm">{unreadCount > 99 ? "99+" : unreadCount} mới</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-base-content/55">
                    Kết bạn, Celebrity, Canh Slot, đăng bài và lỗi đồng bộ ở một nơi.
                  </p>
                </div>
                <button type="button" className="btn btn-circle btn-ghost btn-sm" onClick={() => setOpen(false)}>
                  <X size={18} />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className={`btn btn-xs ${filter === "all" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("all")}>
                  Tất cả
                </button>
                <button type="button" className={`btn btn-xs ${filter === "unread" ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter("unread")}>
                  Chưa đọc
                </button>
                <button type="button" className="btn btn-ghost btn-xs ml-auto" disabled={!unreadCount} onClick={markAll}>
                  <CheckCheck size={14} /> Đọc tất cả
                </button>
                <button type="button" className="btn btn-ghost btn-xs text-error" disabled={!localRows.length} onClick={clearNotifications} title="Chỉ xóa lịch sử lưu trên trình duyệt">
                  <Trash2 size={13} /> Xóa web
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
              {loading && items.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center text-sm text-base-content/50">
                  <span className="loading loading-spinner loading-sm mr-2" /> Đang tải thông báo...
                </div>
              ) : shown.length === 0 ? (
                <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-base-300 px-4 text-center text-sm text-base-content/50">
                  {filter === "unread" ? "Không còn thông báo chưa đọc." : "Chưa có thông báo nào."}
                </div>
              ) : (
                <div className="space-y-2">
                  {shown.map((item) => {
                    const typeMeta = TYPE_META[item.type] || TYPE_META.system;
                    const levelMeta = LEVEL_META[item.level] || LEVEL_META.info;
                    const TypeIcon = typeMeta.icon;
                    const LevelIcon = levelMeta.icon;
                    return (
                      <article
                        key={item.id}
                        className={`cursor-pointer rounded-2xl border p-3 transition-colors ${item.read ? "border-base-300 bg-base-200/30" : "border-primary/35 bg-primary/5"}`}
                        onClick={() => (item.actionUrl ? openItem(item) : markRead(item))}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`mt-0.5 rounded-xl bg-base-100 p-2 ring-1 ring-base-300 ${levelMeta.className}`}>
                            <TypeIcon size={17} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-semibold text-base-content/55">{typeMeta.label}</span>
                              <span className={`inline-flex items-center gap-1 text-[10px] ${levelMeta.className}`}>
                                <LevelIcon size={10} /> {levelMeta.label}
                              </span>
                              {item.channel && <span className="badge badge-ghost badge-xs">{item.channel}</span>}
                              {!item.read && <span className="h-2 w-2 rounded-full bg-primary" />}
                              <time className="ml-auto text-[10px] text-base-content/40">{formatTime(item.createdAt)}</time>
                            </div>
                            <p className="mt-1 break-words text-sm font-semibold">{item.title}</p>
                            {item.message && <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-base-content/60">{item.message}</p>}
                            {item.username && <p className="mt-1 text-[11px] text-base-content/45">@{item.username}</p>}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
