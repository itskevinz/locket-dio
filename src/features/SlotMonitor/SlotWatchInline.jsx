import React, { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Zap,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSlotMonitor } from "./useSlotMonitor";
import { SLOT_STATUS } from "./slotMonitorCore";
import {
  fetchServerSlotWatches,
  setServerSlotAutoRequestEnabled,
  syncExistingWatches,
} from "./slotPushService";
import {
  getSlotMonitorOwner,
  getWatchedCelebs,
  hasServerSyncForOwner,
  markServerSyncForOwner,
  saveWatchedCelebs,
  setSlotMonitorOwner,
  SLOT_MONITOR_STORAGE_KEY,
  updateWatch,
} from "./slotMonitorStorage";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";
import NormalFriendRequestTest from "./NormalFriendRequestTest";

const statusLabel = (status) => {
  switch (status) {
    case SLOT_STATUS.SLOT_OPEN:
      return "🔥 Đã mở slot";
    case SLOT_STATUS.PAUSED:
      return "⏸ Tạm dừng";
    case SLOT_STATUS.ERROR:
      return "⚠️ Đang thử lại";
    default:
      return "🔔 Đang canh";
  }
};

const timeAgo = (value) => {
  if (!value) return "Chưa kiểm tra";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds} giây trước`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  return `${Math.floor(minutes / 60)} giờ trước`;
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

export default function SlotWatchInline() {
  const navigate = useNavigate();
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [autoRequestSavingUids, setAutoRequestSavingUids] = useState([]);
  const {
    watchedCelebs,
    checkingUids,
    slotPushState,
    unwatchCeleb,
    pauseWatch,
    resumeWatch,
    checkNow,
    clearAll,
    enableBackgroundPush,
    testBackgroundPush,
  } = useSlotMonitor();

  useEffect(() => {
    let cancelled = false;

    const syncAccountWatches = async () => {
      const ownerUid = getMyLocalId();
      if (!ownerUid) return;

      setSyncingAccount(true);
      setSyncError("");
      try {
        let local = getWatchedCelebs();
        const storedOwner = getSlotMonitorOwner();

        if (storedOwner && storedOwner !== ownerUid) {
          local = saveWatchedCelebs([]);
        }

        const serverRaw = await fetchServerSlotWatches();
        const server = serverRaw
          .map(serverWatchToLocal)
          .filter((item) => item.uid && item.username)
          .slice(0, 20);

        const alreadyHydrated = hasServerSyncForOwner(ownerUid);
        let next = server;

        if (!alreadyHydrated && server.length === 0 && local.length > 0) {
          await syncExistingWatches(local);
          const hydratedRaw = await fetchServerSlotWatches();
          next = hydratedRaw
            .map(serverWatchToLocal)
            .filter((item) => item.uid && item.username)
            .slice(0, 20);
        }

        if (cancelled) return;
        const saved = saveWatchedCelebs(next);
        setSlotMonitorOwner(ownerUid);
        markServerSyncForOwner(ownerUid);
        notifySameTabStorageRefresh(saved);
      } catch (error) {
        if (!cancelled) {
          setSyncError(
            error?.response?.data?.message ||
              "Chưa đồng bộ được danh sách từ tài khoản. Danh sách trên máy vẫn được giữ.",
          );
        }
      } finally {
        if (!cancelled) setSyncingAccount(false);
      }
    };

    syncAccountWatches();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushEnabled = slotPushState?.enabled;
  const backgroundEnabled = slotPushState?.backgroundEnabled;
  const pushUnsupported = [
    "NOTIFICATION_UNSUPPORTED",
    "PUSH_UNSUPPORTED",
    "SERVICE_WORKER_UNAVAILABLE",
  ].includes(slotPushState?.reason);

  const subtitle = pushEnabled
    ? "Canh 24/7 đang bật — có slot sẽ báo ra điện thoại/màn hình khóa."
    : backgroundEnabled
      ? "Railway đang canh 24/7. Thiết bị này chưa bật được thông báo hệ thống."
      : "Bật Canh Slot 24/7 để Railway vẫn theo dõi khi bạn đóng Huy Locket.";

  const openFriendsFromSlot = (path = "/friends") => {
    navigate(path, { state: { fromSlotPage: true } });
  };

  const toggleAutoRequest = async (celeb, enabled) => {
    if (!celeb?.uid || autoRequestSavingUids.includes(celeb.uid)) return;
    setAutoRequestSavingUids((current) => [...current, celeb.uid]);
    setSyncError("");
    try {
      const serverWatch = await setServerSlotAutoRequestEnabled(celeb.uid, enabled);
      const saved = updateWatch(celeb.uid, {
        autoRequestEnabled: Boolean(
          serverWatch?.autoRequestEnabled ?? enabled,
        ),
        lastAutoRequestAt:
          serverWatch?.lastAutoRequestAt ?? celeb.lastAutoRequestAt ?? null,
        lastAutoRequestStatus:
          serverWatch?.lastAutoRequestStatus ?? celeb.lastAutoRequestStatus ?? "",
        lastAutoRequestError:
          serverWatch?.lastAutoRequestError ?? celeb.lastAutoRequestError ?? "",
      });
      notifySameTabStorageRefresh(saved);
    } catch (error) {
      setSyncError(
        error?.response?.data?.message ||
          "Không thể cập nhật tự gửi request Celeb lúc này.",
      );
    } finally {
      setAutoRequestSavingUids((current) =>
        current.filter((uid) => uid !== celeb.uid),
      );
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-8 text-base-content">
      <section className="rounded-3xl border border-base-300 bg-base-100/90 shadow-xl overflow-hidden">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
                <BellRing size={24} /> Canh Slot 24/7
              </h1>
              <p className="mt-1 text-sm text-base-content/60">{subtitle}</p>
              <p className="mt-1 text-xs text-base-content/45">
                {watchedCelebs.length}/20 tài khoản đang được đồng bộ theo tài khoản Huy Locket.
              </p>
            </div>

            <button
              type="button"
              className="btn btn-outline btn-sm self-start"
              onClick={() => openFriendsFromSlot()}
            >
              <Search size={15} /> Tìm thêm Celeb
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={`btn btn-sm ${pushEnabled ? "btn-success" : "btn-primary"}`}
              disabled={slotPushState?.checking}
              onClick={() =>
                enableBackgroundPush({ requestPermission: true, showFeedback: true })
              }
            >
              {slotPushState?.checking ? (
                <span className="loading loading-spinner loading-xs" />
              ) : pushEnabled ? (
                <BellRing size={15} />
              ) : (
                <Bell size={15} />
              )}
              {pushEnabled
                ? "Đã bật 24/7"
                : backgroundEnabled
                  ? "Bật thông báo thiết bị"
                  : "Bật Canh 24/7"}
            </button>

            <button
              className="btn btn-ghost btn-sm"
              disabled={!pushEnabled || slotPushState?.checking}
              onClick={testBackgroundPush}
            >
              <Send size={14} /> Gửi thử thông báo
            </button>
          </div>

          <p className="mt-3 text-xs text-base-content/55">
            <Zap size={13} className="inline -mt-0.5 mr-1" />
            Railway chỉ báo “vừa gửi” khi đọc lại thấy request trên Locket. Nếu
            request/quan hệ đã có từ trước, hệ thống sẽ nói rõ và không gửi lặp.
          </p>

          {syncingAccount && (
            <p className="mt-3 text-xs text-info">
              ⟳ Đang đồng bộ danh sách Canh Slot của tài khoản này...
            </p>
          )}
          {syncError && <p className="mt-3 text-xs text-warning">{syncError}</p>}
          {slotPushState?.permission === "denied" && (
            <p className="mt-3 text-xs text-warning">
              Trình duyệt đang chặn thông báo. Hãy bật quyền thông báo cho Huy Locket trong cài đặt trình duyệt/điện thoại.
            </p>
          )}
          {backgroundEnabled && pushUnsupported && (
            <p className="mt-3 text-xs text-info">
              Railway vẫn canh slot 24/7 và đồng bộ tài khoản. Muốn nhận ngoài màn hình khóa, hãy bật Web Push trên thiết bị có hỗ trợ.
            </p>
          )}
        </header>

        <NormalFriendRequestTest />

        <div className="p-3 sm:p-5">
          {watchedCelebs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-base-300 py-14 px-4 text-center text-base-content/55">
              <Bell className="mx-auto mb-3 opacity-30" size={34} />
              <p className="font-semibold text-base-content/75">
                {syncingAccount
                  ? "Đang lấy danh sách Canh Slot..."
                  : "Chưa có Celeb nào đang được canh."}
              </p>
              {!syncingAccount && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-4"
                  onClick={() => openFriendsFromSlot()}
                >
                  <Search size={15} /> Tìm Celeb để Canh Slot
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {watchedCelebs.map((celeb) => {
                const checking = checkingUids.includes(celeb.uid);
                const autoSaving = autoRequestSavingUids.includes(celeb.uid);
                const slotOpen = celeb.status === SLOT_STATUS.SLOT_OPEN;
                const availableSlots = Math.max(
                  0,
                  Number(celeb.maxFriends || 0) - Number(celeb.friendCount || 0),
                );

                return (
                  <article
                    key={celeb.uid}
                    className={`rounded-2xl border p-4 transition-colors ${
                      slotOpen
                        ? "border-error/40 bg-error/10"
                        : "border-base-300 bg-base-200/45"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={celeb.avatar || "/images/default_profile.png"}
                        alt={celeb.displayName}
                        className="h-14 w-14 rounded-full object-cover ring-2 ring-base-300"
                        onError={(event) => {
                          event.currentTarget.src = "/images/default_profile.png";
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-bold">{celeb.displayName}</p>
                          {slotOpen && (
                            <span className="badge badge-error badge-sm">MỞ SLOT</span>
                          )}
                        </div>
                        <p className="truncate text-sm text-base-content/60">
                          @{celeb.username}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-base-content/60">
                          <span>{checking ? "⏳ Đang kiểm tra..." : statusLabel(celeb.status)}</span>
                          <span>
                            {celeb.friendCount.toLocaleString()} / {celeb.maxFriends.toLocaleString()}
                          </span>
                          <span>{timeAgo(celeb.lastCheckedAt)}</span>
                        </div>
                        {slotOpen && availableSlots > 0 && (
                          <p className="mt-1 text-xs font-semibold text-error">
                            Còn {availableSlots.toLocaleString()} slot trống
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-warning/25 bg-warning/5 p-3">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          className="toggle toggle-warning toggle-sm"
                          checked={Boolean(celeb.autoRequestEnabled)}
                          disabled={autoSaving}
                          onChange={(event) =>
                            toggleAutoRequest(celeb, event.target.checked)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-semibold">
                            <Zap size={14} /> Tự gửi request Celeb khi có slot
                          </span>
                          <span className="block text-[11px] text-base-content/55">
                            Gửi thật qua Locket ngay khi Railway phát hiện full → có slot.
                          </span>
                        </span>
                        {autoSaving && (
                          <span className="loading loading-spinner loading-xs" />
                        )}
                      </label>

                      {celeb.lastAutoRequestStatus === "SENT" && (
                        <p className="mt-2 text-[11px] text-success">
                          ✓ Lần gần nhất Locket đã xác nhận trạng thái request/quan hệ • {timeAgo(celeb.lastAutoRequestAt)}
                        </p>
                      )}
                      {celeb.lastAutoRequestStatus === "FAILED" && (
                        <p className="mt-2 text-[11px] text-warning" title={celeb.lastAutoRequestError || ""}>
                          ⚠ Lần gần nhất request chưa thành công • {timeAgo(celeb.lastAutoRequestAt)}
                        </p>
                      )}
                      {celeb.autoRequestEnabled && !backgroundEnabled && (
                        <p className="mt-2 text-[11px] text-warning">
                          Hãy bật Canh 24/7 để Railway có phiên đăng nhập nền và tự gửi khi bạn đóng web.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {slotOpen && (
                        <button
                          className="btn btn-error btn-sm"
                          onClick={() =>
                            openFriendsFromSlot(
                              `/friends?username=${encodeURIComponent(celeb.username)}`,
                            )
                          }
                        >
                          Kết bạn ngay
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={checking}
                        onClick={() => checkNow(celeb.uid)}
                      >
                        <RefreshCw
                          size={14}
                          className={checking ? "animate-spin" : ""}
                        />
                        Kiểm tra
                      </button>
                      {celeb.status === SLOT_STATUS.PAUSED ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => resumeWatch(celeb.uid)}
                        >
                          <Play size={14} /> Tiếp tục
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => pauseWatch(celeb.uid)}
                        >
                          <Pause size={14} /> Tạm dừng
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm ml-auto text-error"
                        onClick={() => {
                          if (window.confirm(`Hủy canh @${celeb.username}?`)) {
                            unwatchCeleb(celeb.uid);
                          }
                        }}
                      >
                        <Trash2 size={14} /> Hủy
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {watchedCelebs.length > 0 && (
          <footer className="flex items-center justify-between gap-3 border-t border-base-300 p-4 text-xs">
            <span className="text-base-content/60">
              {watchedCelebs.length}/20 tài khoản • Railway canh theo trạng thái đã đồng bộ
            </span>
            <button
              className="btn btn-ghost btn-xs text-error"
              onClick={() => {
                if (window.confirm("Hủy canh tất cả tài khoản?")) clearAll();
              }}
            >
              Hủy tất cả
            </button>
          </footer>
        )}
      </section>
    </main>
  );
}
