import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Flame,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  deleteAdminSlotWatch,
  fetchAdminSlotEvents,
  fetchAdminSlotWatches,
  updateAdminSlotWatch,
} from "./adminCelebCenterService";

const WATCH_REFRESH_MS = 10_000;
const EVENT_REFRESH_MS = 30_000;

const EVENT_META = {
  SLOT_OPEN: { label: "Mở slot", icon: Flame, className: "text-error" },
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

function normalized(value) {
  return String(value || "").trim().toUpperCase();
}

function isFriendWatch(watch) {
  return (
    normalized(watch?.lastAutoRequestStatus) === "FRIENDS" ||
    normalized(watch?.status) === "FRIENDS"
  );
}

function isPendingWatch(watch) {
  return ["SENT", "OUTGOING-REQUEST", "OUTGOING-FOLLOW-REQUEST"].includes(
    normalized(watch?.lastAutoRequestStatus),
  );
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function userLabel(user, uid) {
  return user?.displayName || user?.username || user?.email || `UID ${uid}`;
}

function stateMeta(watch) {
  if (isFriendWatch(watch)) {
    return {
      label: "BẠN BÈ",
      badgeClass: "badge-success",
      text: "✓ Đã kết bạn trên Locket — đã dừng canh",
      textClass: "text-success",
    };
  }

  if (isPendingWatch(watch)) {
    return {
      label: "CHỜ CHẤP NHẬN",
      badgeClass: "badge-info",
      text: "✓ Request đã gửi thật — đang chờ chấp nhận",
      textClass: "text-info",
    };
  }

  const available = Math.max(
    0,
    Number(watch?.maxFriends || 0) - Number(watch?.friendCount || 0),
  );
  const open = Boolean(watch?.enabled) && available > 0;

  return {
    label: open
      ? `CÒN ${available} SLOT`
      : watch?.enabled
        ? "FULL"
        : "PAUSED",
    badgeClass: open ? "badge-error" : watch?.enabled ? "badge-ghost" : "badge-warning",
    text: "",
    textClass: "",
  };
}

export default function AdminCelebCenterLive() {
  const [watches, setWatches] = useState([]);
  const [users, setUsers] = useState({});
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const watchLoadInFlight = useRef(false);
  const eventLoadInFlight = useRef(false);

  const loadWatches = useCallback(async ({ quiet = false } = {}) => {
    if (watchLoadInFlight.current) return;
    watchLoadInFlight.current = true;
    if (!quiet) setLoading(true);
    try {
      const watchData = await fetchAdminSlotWatches();
      setWatches(Array.isArray(watchData?.watches) ? watchData.watches : []);
      setUsers(
        watchData?.users && typeof watchData.users === "object"
          ? watchData.users
          : {},
      );
      setLastSyncedAt(Date.now());
      setError("");
    } catch (loadError) {
      setError(
        loadError?.message || "Không tải được trạng thái Canh Slot mới nhất.",
      );
    } finally {
      watchLoadInFlight.current = false;
      if (!quiet) setLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async () => {
    if (eventLoadInFlight.current) return;
    eventLoadInFlight.current = true;
    try {
      const data = await fetchAdminSlotEvents({ limit: 300 });
      setEvents(Array.isArray(data) ? data : []);
    } catch {
      // Lịch sử phụ không được làm hỏng trạng thái watch chính.
    } finally {
      eventLoadInFlight.current = false;
    }
  }, []);

  const refreshAll = useCallback(
    async ({ quiet = false } = {}) => {
      await Promise.all([loadWatches({ quiet }), loadEvents()]);
    },
    [loadEvents, loadWatches],
  );

  useEffect(() => {
    refreshAll();

    const watchTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadWatches({ quiet: true });
    }, WATCH_REFRESH_MS);
    const eventTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadEvents();
    }, EVENT_REFRESH_MS);

    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") refreshAll({ quiet: true });
    };
    const refreshOnFocus = () => refreshAll({ quiet: true });

    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(watchTimer);
      window.clearInterval(eventTimer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadEvents, loadWatches, refreshAll]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return watches;
    return watches.filter((watch) => {
      const user = users?.[watch.userUid] || {};
      return [
        watch.username,
        watch.displayName,
        watch.uid,
        watch.userUid,
        user.displayName,
        user.email,
        user.username,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text));
    });
  }, [query, users, watches]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const watch of filtered) {
      const key = String(watch.userUid || "unknown");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(watch);
    }
    return [...map.entries()];
  }, [filtered]);

  const stats = useMemo(() => {
    const activeWatches = watches.filter((item) => !isFriendWatch(item));
    const userCount = new Set(watches.map((item) => item.userUid)).size;
    const uniqueCelebs = new Set(watches.map((item) => item.uid)).size;
    const open = activeWatches.filter(
      (item) =>
        item.enabled &&
        Number(item.maxFriends || 0) > 0 &&
        Number(item.friendCount || 0) < Number(item.maxFriends || 0),
    ).length;
    const auto = activeWatches.filter(
      (item) => item.enabled && item.autoRequestEnabled,
    ).length;
    const friends = watches.filter(isFriendWatch).length;
    const sessionErrors = new Set(
      watches
        .filter((item) => item.sessionLastError || !item.sessionEnabled)
        .map((item) => item.userUid),
    ).size;
    return { userCount, uniqueCelebs, open, auto, friends, sessionErrors };
  }, [watches]);

  const mutate = async (watch, patch) => {
    if (isFriendWatch(watch)) {
      toast.info("Tài khoản này đã là bạn bè nên Canh Slot đã hoàn tất.");
      return;
    }
    const key = `${watch.userUid}:${watch.uid}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await updateAdminSlotWatch(watch.userUid, watch.uid, patch);
      await refreshAll({ quiet: true });
      toast.success("Đã cập nhật Canh Slot trên server");
    } catch (mutationError) {
      toast.error(
        mutationError?.message || "Không cập nhật được Canh Slot trên server.",
      );
    } finally {
      setBusyKey("");
    }
  };

  const remove = async (watch) => {
    const label = `@${watch.username} của ${userLabel(users?.[watch.userUid], watch.userUid)}`;
    if (!window.confirm(`Xóa ${label} khỏi Canh Slot server?`)) return;
    const key = `${watch.userUid}:${watch.uid}`;
    setBusyKey(key);
    try {
      await deleteAdminSlotWatch(watch.userUid, watch.uid);
      await refreshAll({ quiet: true });
      toast.success("Đã xóa Celeb khỏi server");
    } catch (deleteError) {
      toast.error(deleteError?.message || "Không xóa được Celeb khỏi server.");
    } finally {
      setBusyKey("");
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pt-6 text-base-content md:px-8">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/90 shadow-xl">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-6 w-6" />
                <h2 className="text-xl font-bold sm:text-2xl">Celeb Center toàn server</h2>
              </div>
              <p className="mt-1 text-sm text-base-content/60">
                Trạng thái lấy trực tiếp từ server Canh Slot. FRIENDS là đã kết bạn thật và không còn được tính là watch đang chạy.
              </p>
              <p className="mt-1 text-xs text-base-content/45">
                Tự đồng bộ mỗi 10 giây{lastSyncedAt ? ` • cập nhật ${formatTime(lastSyncedAt)}` : ""}.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm self-start"
              disabled={loading}
              onClick={() => refreshAll()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Làm mới server
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Users size={13} /> Người dùng</div>
              <div className="mt-1 text-2xl font-bold">{stats.userCount}</div>
            </div>
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-3">
              <div className="text-xs text-base-content/55">Celeb duy nhất</div>
              <div className="mt-1 text-2xl font-bold">{stats.uniqueCelebs}</div>
            </div>
            <div className="rounded-2xl border border-success/25 bg-success/5 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><CheckCircle2 size={13} /> Đã là bạn bè</div>
              <div className="mt-1 text-2xl font-bold text-success">{stats.friends}</div>
            </div>
            <div className="rounded-2xl border border-error/25 bg-error/5 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Flame size={13} /> Đang có slot</div>
              <div className="mt-1 text-2xl font-bold text-error">{stats.open}</div>
            </div>
            <div className="rounded-2xl border border-warning/25 bg-warning/5 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Zap size={13} /> Auto đang chạy</div>
              <div className="mt-1 text-2xl font-bold">{stats.auto}</div>
            </div>
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><AlertTriangle size={13} /> Phiên lỗi</div>
              <div className="mt-1 text-2xl font-bold">{stats.sessionErrors}</div>
            </div>
          </div>

          <label className="input input-bordered mt-4 flex w-full items-center gap-2">
            <Search className="h-4 w-4 text-base-content/45" />
            <input
              className="grow"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm Celeb, username, UID, tên hoặc email người dùng..."
            />
          </label>
        </header>

        {error && (
          <div className="m-4 rounded-2xl border border-error/30 bg-error/5 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-[1.45fr_0.75fr]">
          <div className="space-y-4">
            {loading ? (
              <div className="flex justify-center py-12"><span className="loading loading-spinner loading-md" /></div>
            ) : grouped.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-base-300 p-8 text-center text-sm text-base-content/50">
                Không có Celeb phù hợp.
              </div>
            ) : (
              grouped.map(([userUid, rows]) => {
                const user = users?.[userUid] || {};
                const sessionError = rows.find((item) => item.sessionLastError)?.sessionLastError || "";
                const sessionEnabled = rows.some((item) => item.sessionEnabled);
                return (
                  <article key={userUid} className="overflow-hidden rounded-2xl border border-base-300 bg-base-200/30">
                    <div className="flex flex-col gap-2 border-b border-base-300 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="font-bold">{userLabel(user, userUid)}</h3>
                        <p className="text-[11px] text-base-content/50">
                          {user.email ? `${user.email} • ` : ""}UID: {userUid} • {rows.length} Celeb
                        </p>
                      </div>
                      <div className={`badge badge-sm ${sessionEnabled && !sessionError ? "badge-success" : "badge-warning"}`}>
                        {sessionEnabled && !sessionError ? "Phiên Render ổn" : "Cần kiểm tra phiên"}
                      </div>
                    </div>
                    {sessionError && (
                      <div className="border-b border-warning/20 bg-warning/5 px-4 py-2 text-[11px] text-warning">
                        {sessionError}
                      </div>
                    )}

                    <div className="divide-y divide-base-300">
                      {rows.map((watch) => {
                        const key = `${watch.userUid}:${watch.uid}`;
                        const busy = busyKey === key;
                        const friend = isFriendWatch(watch);
                        const pending = isPendingWatch(watch);
                        const meta = stateMeta(watch);
                        return (
                          <div key={key} className={`p-3 sm:p-4 ${friend ? "bg-success/5" : ""}`}>
                            <div className="flex items-start gap-3">
                              <img
                                src={watch.avatar || "/images/default_profile.png"}
                                alt={watch.displayName || watch.username}
                                className="h-10 w-10 rounded-full object-cover"
                                onError={(event) => { event.currentTarget.src = "/images/default_profile.png"; }}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-semibold">@{watch.username}</span>
                                  <span className={`badge badge-sm ${meta.badgeClass}`}>{meta.label}</span>
                                  {!friend && !pending && watch.autoRequestEnabled && (
                                    <span className="badge badge-sm badge-info">AUTO</span>
                                  )}
                                </div>
                                <p className="mt-1 text-[11px] text-base-content/50">
                                  {Number(watch.friendCount || 0).toLocaleString("vi-VN")} / {Number(watch.maxFriends || 0).toLocaleString("vi-VN")} • kiểm tra {formatTime(watch.lastCheckedAt)}
                                </p>

                                {meta.text ? (
                                  <p className={`mt-1 text-[11px] font-semibold ${meta.textClass}`}>
                                    {meta.text}{watch.lastAutoRequestAt ? ` • ${formatTime(watch.lastAutoRequestAt)}` : ""}
                                  </p>
                                ) : watch.lastAutoRequestStatus ? (
                                  <p className={`mt-1 text-[11px] ${normalized(watch.lastAutoRequestStatus) === "FAILED" ? "text-warning" : "text-success"}`}>
                                    Request gần nhất: {watch.lastAutoRequestStatus}{watch.lastAutoRequestAt ? ` • ${formatTime(watch.lastAutoRequestAt)}` : ""}
                                  </p>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {friend ? (
                                <span className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-success/30 bg-success/10 px-2.5 text-xs font-bold text-success">
                                  <CheckCircle2 size={13} /> Hoàn tất — không canh nữa
                                </span>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-xs btn-outline"
                                    disabled={busy}
                                    onClick={() => mutate(watch, { enabled: !watch.enabled })}
                                  >
                                    {watch.enabled ? <Pause size={12} /> : <Play size={12} />}
                                    {watch.enabled ? "Tạm dừng" : "Tiếp tục"}
                                  </button>
                                  {!pending && (
                                    <button
                                      type="button"
                                      className={`btn btn-xs ${watch.autoRequestEnabled ? "btn-warning" : "btn-outline"}`}
                                      disabled={busy}
                                      onClick={() => mutate(watch, { autoRequestEnabled: !watch.autoRequestEnabled })}
                                    >
                                      <Zap size={12} /> Auto {watch.autoRequestEnabled ? "ON" : "OFF"}
                                    </button>
                                  )}
                                </>
                              )}
                              <button
                                type="button"
                                className="btn btn-xs btn-ghost text-error"
                                disabled={busy}
                                onClick={() => remove(watch)}
                              >
                                <Trash2 size={12} /> Xóa khỏi server
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <aside className="rounded-2xl border border-base-300 bg-base-200/30 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="font-bold">Lịch sử toàn server</h3>
                <p className="text-[11px] text-base-content/50">Mở slot và kết quả auto request gần nhất.</p>
              </div>
              <Clock3 size={17} />
            </div>
            <div className="mt-3 max-h-[720px] space-y-2 overflow-y-auto pr-1">
              {events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-base-300 p-6 text-center text-xs text-base-content/50">Chưa có sự kiện.</div>
              ) : (
                events.map((event) => {
                  const meta = EVENT_META[event.type] || EVENT_META.SLOT_OPEN;
                  const Icon = meta.icon;
                  const user = users?.[event.userUid] || {};
                  return (
                    <div key={event.id} className="rounded-xl border border-base-300 bg-base-100/70 p-3">
                      <div className="flex items-center gap-2 text-xs">
                        <Icon className={`h-4 w-4 ${meta.className}`} />
                        <span className="font-semibold">{meta.label}</span>
                        <span className="ml-auto text-[10px] text-base-content/45">{formatTime(event.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm font-semibold">@{event.username}</p>
                      <p className="mt-1 text-[11px] text-base-content/50">
                        {userLabel(user, event.userUid)}
                        {event.availableSlots > 0 ? ` • ${event.availableSlots} slot` : ""}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
