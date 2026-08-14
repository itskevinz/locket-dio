import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Flame,
  History,
  RefreshCw,
  RotateCcw,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useSlotMonitor } from "./useSlotMonitor";
import { SLOT_STATUS } from "./slotMonitorCore";
import { fetchServerSlotWatches } from "./slotPushService";
import {
  saveWatchedCelebs,
  SLOT_MONITOR_STORAGE_KEY,
} from "./slotMonitorStorage";
import {
  checkCelebCenterNow,
  fetchCelebCenterHistory,
  retryCelebRequest,
} from "./celebCenterService";

const EVENT_META = {
  SLOT_OPEN: {
    label: "Mở slot",
    icon: Flame,
    className: "text-error",
  },
  AUTO_REQUEST_SENT: {
    label: "Request thành công",
    icon: CheckCircle2,
    className: "text-success",
  },
  AUTO_REQUEST_FAILED: {
    label: "Request thất bại",
    icon: XCircle,
    className: "text-warning",
  },
};

const serverWatchToLocal = (item) => ({
  uid: item?.uid,
  username: item?.username,
  displayName: item?.displayName || item?.username,
  avatar: item?.avatar || "",
  friendCount: Number(item?.friendCount) || 0,
  maxFriends: Number(item?.maxFriends) || 0,
  status: item?.enabled === false ? SLOT_STATUS.PAUSED : item?.status,
  createdAt: Date.now(),
  lastCheckedAt: item?.lastCheckedAt || null,
  notifiedAt: item?.notifiedAt || null,
  errorCount: 0,
  lastWasFull:
    typeof item?.lastWasFull === "boolean"
      ? item.lastWasFull
      : Number(item?.maxFriends || 0) > 0 &&
        Number(item?.friendCount || 0) >= Number(item?.maxFriends || 0),
  autoRequestEnabled: Boolean(item?.autoRequestEnabled),
  lastAutoRequestAt: item?.lastAutoRequestAt || null,
  lastAutoRequestStatus: item?.lastAutoRequestStatus || "",
  lastAutoRequestError: item?.lastAutoRequestError || "",
});

function notifySameTabStorageRefresh(items) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SLOT_MONITOR_STORAGE_KEY,
        newValue: JSON.stringify(items),
        storageArea: window.localStorage,
      }),
    );
  } catch {
    window.dispatchEvent(new Event("storage"));
  }
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function bestOpeningHour(events, uid) {
  const counts = new Map();
  events
    .filter((event) => event.type === "SLOT_OPEN" && (!uid || event.uid === uid))
    .forEach((event) => {
      if (!event.createdAt) return;
      const hour = new Date(event.createdAt).getHours();
      counts.set(hour, (counts.get(hour) || 0) + 1);
    });

  let best = null;
  for (const [hour, count] of counts.entries()) {
    if (!best || count > best.count) best = { hour, count };
  }
  return best;
}

export default function CelebCenterOverview() {
  const { watchedCelebs } = useSlotMonitor();
  const [historyEvents, setHistoryEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedUid, setSelectedUid] = useState("");
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [retryingUids, setRetryingUids] = useState([]);
  const [historyError, setHistoryError] = useState("");

  const syncServerWatches = useCallback(async () => {
    const serverRaw = await fetchServerSlotWatches();
    const mapped = serverRaw
      .map(serverWatchToLocal)
      .filter((item) => item.uid && item.username)
      .slice(0, 20);
    const saved = saveWatchedCelebs(mapped);
    notifySameTabStorageRefresh(saved);
    return saved;
  }, []);

  const loadHistory = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setHistoryLoading(true);
    setHistoryError("");
    try {
      const rows = await fetchCelebCenterHistory({ limit: 200 });
      setHistoryEvents(rows);
      return rows;
    } catch (error) {
      setHistoryError(
        error?.response?.data?.message ||
          "Chưa tải được lịch sử Celeb Center.",
      );
      return [];
    } finally {
      if (!quiet) setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    const timer = window.setInterval(() => {
      loadHistory({ quiet: true });
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [loadHistory]);

  const openNowCount = useMemo(
    () =>
      watchedCelebs.filter(
        (item) =>
          Number(item.maxFriends || 0) > 0 &&
          Number(item.friendCount || 0) < Number(item.maxFriends || 0) &&
          item.status !== SLOT_STATUS.PAUSED,
      ).length,
    [watchedCelebs],
  );

  const autoEnabledCount = useMemo(
    () => watchedCelebs.filter((item) => item.autoRequestEnabled).length,
    [watchedCelebs],
  );

  const failedCount = useMemo(
    () =>
      watchedCelebs.filter((item) => item.lastAutoRequestStatus === "FAILED")
        .length,
    [watchedCelebs],
  );

  const filteredEvents = useMemo(
    () =>
      selectedUid
        ? historyEvents.filter((event) => event.uid === selectedUid)
        : historyEvents,
    [historyEvents, selectedUid],
  );

  const overallBestHour = useMemo(
    () => bestOpeningHour(historyEvents, ""),
    [historyEvents],
  );

  const refreshAllReal = async () => {
    if (refreshingAll || watchedCelebs.length === 0) return;
    setRefreshingAll(true);
    let success = 0;
    let failed = 0;
    try {
      for (const celeb of watchedCelebs) {
        if (celeb.status === SLOT_STATUS.PAUSED) continue;
        try {
          await checkCelebCenterNow(celeb.uid);
          success += 1;
        } catch {
          failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      await Promise.allSettled([syncServerWatches(), loadHistory({ quiet: true })]);
      if (failed === 0) {
        toast.success(`Đã kiểm tra thật ${success} Celeb`);
      } else {
        toast.warning(`Đã kiểm tra ${success} Celeb, ${failed} Celeb lỗi tạm thời`);
      }
    } finally {
      setRefreshingAll(false);
    }
  };

  const retryRequest = async (celeb) => {
    if (!celeb?.uid || retryingUids.includes(celeb.uid)) return;
    const availableSlots = Math.max(
      0,
      Number(celeb.maxFriends || 0) - Number(celeb.friendCount || 0),
    );
    if (availableSlots <= 0) {
      toast.warning("Celeb hiện không còn slot trống");
      return;
    }
    if (!window.confirm(`Gửi lại lời mời kết bạn thật tới @${celeb.username}?`)) return;

    setRetryingUids((current) => [...current, celeb.uid]);
    try {
      const result = await retryCelebRequest(celeb.uid);
      if (result?.autoRequest?.success) {
        toast.success(`Đã gửi request thật tới @${celeb.username}`);
      } else {
        toast.warning(`Request tới @${celeb.username} chưa thành công`, {
          description:
            result?.autoRequest?.message || "Locket chưa xác nhận request.",
        });
      }
      await Promise.allSettled([syncServerWatches(), loadHistory({ quiet: true })]);
    } catch (error) {
      toast.error("Không thể gửi lại request Celeb", {
        description:
          error?.response?.data?.message || error?.message || "Thử lại sau.",
      });
      await loadHistory({ quiet: true });
    } finally {
      setRetryingUids((current) =>
        current.filter((uid) => uid !== celeb.uid),
      );
    }
  };

  return (
    <section className="mx-auto w-full max-w-5xl px-4 pt-6 sm:pt-8 text-base-content">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/90 shadow-xl">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity size={24} />
                <h1 className="text-xl font-bold sm:text-2xl">Celeb Center</h1>
              </div>
              <p className="mt-1 text-sm text-base-content/60">
                Trạng thái slot thật, lịch sử mở slot và kết quả auto request trên cùng một màn hình.
              </p>
              <p className="mt-1 text-xs text-base-content/45">
                Worker: nền 30 giây • nhanh 10 giây • tự động 1 giây; trang làm mới mỗi 45 giây.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-primary btn-sm self-start"
              disabled={refreshingAll || watchedCelebs.length === 0}
              onClick={refreshAllReal}
            >
              <RefreshCw
                size={15}
                className={refreshingAll ? "animate-spin" : ""}
              />
              Kiểm tra thật ngay
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-base-300 bg-base-200/45 p-3">
              <div className="flex items-center gap-1.5 text-xs text-base-content/55">
                <Users size={13} /> Đang canh
              </div>
              <div className="mt-1 text-2xl font-bold">{watchedCelebs.length}</div>
            </div>
            <div className="rounded-2xl border border-error/25 bg-error/5 p-3">
              <div className="flex items-center gap-1.5 text-xs text-base-content/55">
                <Flame size={13} /> Đang có slot
              </div>
              <div className="mt-1 text-2xl font-bold text-error">{openNowCount}</div>
            </div>
            <div className="rounded-2xl border border-warning/25 bg-warning/5 p-3">
              <div className="flex items-center gap-1.5 text-xs text-base-content/55">
                <Zap size={13} /> Auto request
              </div>
              <div className="mt-1 text-2xl font-bold">{autoEnabledCount}</div>
            </div>
            <div className="rounded-2xl border border-base-300 bg-base-200/45 p-3">
              <div className="flex items-center gap-1.5 text-xs text-base-content/55">
                <Clock3 size={13} /> Giờ hay mở
              </div>
              <div className="mt-1 text-lg font-bold">
                {overallBestHour
                  ? `${String(overallBestHour.hour).padStart(2, "0")}:00`
                  : "Chưa đủ dữ liệu"}
              </div>
              {overallBestHour && (
                <div className="text-[11px] text-base-content/45">
                  {overallBestHour.count} lần ghi nhận
                </div>
              )}
            </div>
          </div>

          {failedCount > 0 && (
            <div className="mt-4 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              Có {failedCount} Celeb có lần auto request gần nhất chưa thành công. Nếu slot vẫn còn, có thể gửi lại thủ công bên dưới.
            </div>
          )}
        </header>

        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[0.9fr_1.4fr]">
          <div className="rounded-2xl border border-base-300 bg-base-200/35 p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <h2 className="font-bold">Phân tích từng Celeb</h2>
                <p className="text-[11px] text-base-content/50">
                  Thống kê dựa trên các lần mở slot đã ghi từ khi Celeb Center hoạt động.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {watchedCelebs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-base-300 p-5 text-center text-sm text-base-content/50">
                  Chưa có Celeb đang canh.
                </p>
              ) : (
                watchedCelebs.map((celeb) => {
                  const best = bestOpeningHour(historyEvents, celeb.uid);
                  const availableSlots = Math.max(
                    0,
                    Number(celeb.maxFriends || 0) - Number(celeb.friendCount || 0),
                  );
                  const open = availableSlots > 0 && celeb.status !== SLOT_STATUS.PAUSED;
                  const retrying = retryingUids.includes(celeb.uid);
                  return (
                    <div
                      key={celeb.uid}
                      className="rounded-xl border border-base-300 bg-base-100/70 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <img
                          src={celeb.avatar || "/images/default_profile.png"}
                          alt={celeb.displayName || celeb.username}
                          className="h-9 w-9 rounded-full object-cover"
                          onError={(event) => {
                            event.currentTarget.src = "/images/default_profile.png";
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">
                            @{celeb.username}
                          </p>
                          <p className="text-[11px] text-base-content/50">
                            {open
                              ? `Còn ${availableSlots.toLocaleString("vi-VN")} slot`
                              : celeb.status === SLOT_STATUS.PAUSED
                                ? "Đang tạm dừng"
                                : "Đang full"}
                          </p>
                        </div>
                        <span
                          className={`badge badge-sm ${
                            open ? "badge-error" : "badge-ghost"
                          }`}
                        >
                          {open ? "OPEN" : "FULL"}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-base-content/55">
                        <span>
                          Giờ hay mở: {best ? `${String(best.hour).padStart(2, "0")}:00 (${best.count})` : "—"}
                        </span>
                        <span>
                          Request gần nhất: {celeb.lastAutoRequestStatus || "—"}
                        </span>
                      </div>

                      {celeb.lastAutoRequestStatus === "FAILED" && open && (
                        <button
                          type="button"
                          className="btn btn-warning btn-xs mt-2"
                          disabled={retrying}
                          onClick={() => retryRequest(celeb)}
                        >
                          {retrying ? (
                            <span className="loading loading-spinner loading-xs" />
                          ) : (
                            <RotateCcw size={12} />
                          )}
                          Gửi lại request thật
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-base-300 bg-base-200/35 p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-1.5 font-bold">
                  <History size={16} /> Lịch sử Celeb
                </h2>
                <p className="text-[11px] text-base-content/50">
                  Mở slot, request thành công và request thất bại đều được lưu từ Render worker.
                </p>
              </div>
              <select
                className="select select-bordered select-sm w-full sm:w-44"
                value={selectedUid}
                onChange={(event) => setSelectedUid(event.target.value)}
              >
                <option value="">Tất cả Celeb</option>
                {watchedCelebs.map((celeb) => (
                  <option key={celeb.uid} value={celeb.uid}>
                    @{celeb.username}
                  </option>
                ))}
              </select>
            </div>

            {historyError && (
              <p className="mt-3 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                {historyError}
              </p>
            )}

            <div className="mt-3 max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {historyLoading ? (
                <div className="flex items-center justify-center py-12 text-sm text-base-content/50">
                  <span className="loading loading-spinner loading-sm mr-2" /> Đang tải lịch sử...
                </div>
              ) : filteredEvents.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300 px-4 py-10 text-center text-sm text-base-content/50">
                  Chưa có sự kiện. Hệ thống sẽ bắt đầu tích lũy khi Celeb mở slot hoặc auto request chạy.
                </div>
              ) : (
                filteredEvents.slice(0, 80).map((event) => {
                  const meta = EVENT_META[event.type] || EVENT_META.SLOT_OPEN;
                  const Icon = meta.icon;
                  return (
                    <div
                      key={event.id}
                      className="rounded-xl border border-base-300 bg-base-100/75 p-3"
                    >
                      <div className="flex items-start gap-2">
                        <Icon size={15} className={`mt-0.5 shrink-0 ${meta.className}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={`text-sm font-semibold ${meta.className}`}>
                              {meta.label}
                            </span>
                            <span className="text-xs font-medium">
                              @{event.username}
                            </span>
                            <span className="ml-auto text-[10px] text-base-content/45">
                              {formatDateTime(event.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-base-content/60">
                            Còn {Number(event.availableSlots || 0).toLocaleString("vi-VN")} slot • {Number(event.friendCount || 0).toLocaleString("vi-VN")} / {Number(event.maxFriends || 0).toLocaleString("vi-VN")} bạn
                          </p>
                          {event.detail && (
                            <p
                              className="mt-1 break-words text-[11px] text-warning"
                              title={event.detail}
                            >
                              {event.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
