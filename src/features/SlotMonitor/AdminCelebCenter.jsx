import React, { useCallback, useEffect, useMemo, useState } from "react";
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

function formatTime(value) {
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

function userLabel(user, uid) {
  return user?.displayName || user?.username || user?.email || `UID ${uid}`;
}

export default function AdminCelebCenter() {
  const [watches, setWatches] = useState([]);
  const [users, setUsers] = useState({});
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [watchData, eventData] = await Promise.all([
        fetchAdminSlotWatches(),
        fetchAdminSlotEvents({ limit: 300 }),
      ]);
      setWatches(Array.isArray(watchData?.watches) ? watchData.watches : []);
      setUsers(watchData?.users && typeof watchData.users === "object" ? watchData.users : {});
      setEvents(Array.isArray(eventData) ? eventData : []);
    } catch (loadError) {
      setError(
        loadError?.message || "Không tải được dữ liệu Canh Slot toàn server.",
      );
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

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
    const userCount = new Set(watches.map((item) => item.userUid)).size;
    const uniqueCelebs = new Set(watches.map((item) => item.uid)).size;
    const open = watches.filter(
      (item) =>
        item.enabled &&
        Number(item.maxFriends || 0) > 0 &&
        Number(item.friendCount || 0) < Number(item.maxFriends || 0),
    ).length;
    const auto = watches.filter((item) => item.autoRequestEnabled).length;
    const sessionErrors = new Set(
      watches
        .filter((item) => item.sessionLastError || !item.sessionEnabled)
        .map((item) => item.userUid),
    ).size;
    return { userCount, uniqueCelebs, open, auto, sessionErrors };
  }, [watches]);

  const mutate = async (watch, patch) => {
    const key = `${watch.userUid}:${watch.uid}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      await updateAdminSlotWatch(watch.userUid, watch.uid, patch);
      await load({ quiet: true });
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
      await load({ quiet: true });
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
                Admin thấy toàn bộ Celeb mà mọi người dùng đã thêm vào hệ thống. Người dùng thường chỉ thấy danh sách của chính họ.
              </p>
              <p className="mt-1 text-xs text-base-content/45">
                Worker chạy thích ứng: nền 30 giây • nhanh 10 giây • tự động kết bạn 1 giây.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm self-start"
              disabled={loading}
              onClick={() => load()}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Làm mới server
            </button>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Users size={13} /> Người dùng</div>
              <div className="mt-1 text-2xl font-bold">{stats.userCount}</div>
            </div>
            <div className="rounded-2xl border border-base-300 bg-base-200/40 p-3">
              <div className="text-xs text-base-content/55">Celeb duy nhất</div>
              <div className="mt-1 text-2xl font-bold">{stats.uniqueCelebs}</div>
            </div>
            <div className="rounded-2xl border border-error/25 bg-error/5 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Flame size={13} /> Đang có slot</div>
              <div className="mt-1 text-2xl font-bold text-error">{stats.open}</div>
            </div>
            <div className="rounded-2xl border border-warning/25 bg-warning/5 p-3">
              <div className="flex items-center gap-1 text-xs text-base-content/55"><Zap size={13} /> Auto request</div>
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
                        const available = Math.max(0, Number(watch.maxFriends || 0) - Number(watch.friendCount || 0));
                        const open = watch.enabled && available > 0;
                        const key = `${watch.userUid}:${watch.uid}`;
                        const busy = busyKey === key;
                        return (
                          <div key={key} className="p-3 sm:p-4">
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
                                  <span className={`badge badge-sm ${open ? "badge-error" : watch.enabled ? "badge-ghost" : "badge-warning"}`}>
                                    {open ? `CÒN ${available} SLOT` : watch.enabled ? "FULL" : "PAUSED"}
                                  </span>
                                  {watch.autoRequestEnabled && <span className="badge badge-sm badge-info">AUTO</span>}
                                </div>
                                <p className="mt-1 text-[11px] text-base-content/50">
                                  {Number(watch.friendCount || 0).toLocaleString("vi-VN")} / {Number(watch.maxFriends || 0).toLocaleString("vi-VN")} • kiểm tra {formatTime(watch.lastCheckedAt)}
                                </p>
                                {watch.lastAutoRequestStatus && (
                                  <p className={`mt-1 text-[11px] ${watch.lastAutoRequestStatus === "SENT" ? "text-success" : "text-warning"}`}>
                                    Request gần nhất: {watch.lastAutoRequestStatus}{watch.lastAutoRequestAt ? ` • ${formatTime(watch.lastAutoRequestAt)}` : ""}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="btn btn-xs btn-outline"
                                disabled={busy}
                                onClick={() => mutate(watch, { enabled: !watch.enabled })}
                              >
                                {watch.enabled ? <Pause size={12} /> : <Play size={12} />}
                                {watch.enabled ? "Tạm dừng" : "Tiếp tục"}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-xs ${watch.autoRequestEnabled ? "btn-warning" : "btn-outline"}`}
                                disabled={busy}
                                onClick={() => mutate(watch, { autoRequestEnabled: !watch.autoRequestEnabled })}
                              >
                                <Zap size={12} />
                                Auto {watch.autoRequestEnabled ? "ON" : "OFF"}
                              </button>
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
