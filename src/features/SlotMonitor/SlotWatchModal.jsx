import React, { useEffect, useState } from "react";
import {
  Bell,
  BellRing,
  Pause,
  Play,
  RefreshCw,
  Send,
  Trash2,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSlotMonitor } from "./useSlotMonitor";
import { SLOT_STATUS } from "./slotMonitorCore";
import {
  fetchServerSlotWatches,
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
} from "./slotMonitorStorage";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";

const isCompletedFriendWatch = (item) =>
  item?.status === SLOT_STATUS.FRIENDS ||
  String(item?.lastAutoRequestStatus || item?.last_auto_request_status || "")
    .trim()
    .toUpperCase() === "FRIENDS";

const statusLabel = (status) => {
  switch (status) {
    case SLOT_STATUS.SLOT_OPEN:
      return "🔥 Đã mở slot";
    case SLOT_STATUS.FRIENDS:
      return "✓ Đã kết bạn";
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

const serverWatchToLocal = (item) => {
  const completedFriend = isCompletedFriendWatch(item);
  return {
    uid: item?.uid,
    username: item?.username,
    displayName: item?.displayName || item?.username,
    avatar: item?.avatar || "",
    friendCount: Number(item?.friendCount) || 0,
    maxFriends: Number(item?.maxFriends) || 0,
    status: completedFriend
      ? SLOT_STATUS.FRIENDS
      : item?.enabled === false
        ? SLOT_STATUS.PAUSED
        : item?.status,
    createdAt: Date.now(),
    lastCheckedAt: item?.lastCheckedAt || null,
    notifiedAt: item?.notifiedAt || null,
    errorCount: 0,
    lastWasFull:
      typeof item?.lastWasFull === "boolean"
        ? item.lastWasFull
        : Number(item?.maxFriends || 0) > 0 &&
          Number(item?.friendCount || 0) >= Number(item?.maxFriends || 0),
    autoRequestEnabled: completedFriend ? false : Boolean(item?.autoRequestEnabled),
    lastAutoRequestAt: item?.lastAutoRequestAt || null,
    lastAutoRequestStatus: item?.lastAutoRequestStatus || "",
    lastAutoRequestError: item?.lastAutoRequestError || "",
  };
};

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

export default function SlotWatchModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [syncingAccount, setSyncingAccount] = useState(false);
  const [syncError, setSyncError] = useState("");
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
    if (!isOpen) return undefined;
    const onKey = (event) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;

    const syncAccountWatches = async ({ silent = false } = {}) => {
      const ownerUid = getMyLocalId();
      if (!ownerUid) return;

      if (!silent) setSyncingAccount(true);
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

        // Migration V1: nếu server chưa có dữ liệu nhưng máy này đã có danh sách local,
        // upload một lần. Sau đó server trở thành nguồn chuẩn để nhiều thiết bị đồng bộ.
        if (!alreadyHydrated && server.length === 0 && local.length > 0) {
          await syncExistingWatches(local);
          next = local;
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
        if (!cancelled && !silent) setSyncingAccount(false);
      }
    };

    syncAccountWatches();
    const syncTimer = window.setInterval(
      () => syncAccountWatches({ silent: true }),
      12_000,
    );
    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const pushEnabled = slotPushState?.enabled;
  const backgroundEnabled = slotPushState?.backgroundEnabled;
  const pushUnsupported = [
    "NOTIFICATION_UNSUPPORTED",
    "PUSH_UNSUPPORTED",
    "SERVICE_WORKER_UNAVAILABLE",
  ].includes(slotPushState?.reason);
  const activeWatchCount = watchedCelebs.filter(
    (item) => !isCompletedFriendWatch(item),
  ).length;
  const completedFriendCount = watchedCelebs.length - activeWatchCount;

  const subtitle = pushEnabled
    ? "Canh 24/7 đang bật — có slot sẽ báo ra điện thoại/màn hình khóa."
    : backgroundEnabled
      ? "Hệ thống đang canh 24/7. Thiết bị này chưa bật được thông báo hệ thống."
      : "Bật Canh Slot 24/7 để hệ thống vẫn theo dõi khi bạn đóng Huy Locket.";

  return (
    <div
      className="interaction-modal-backdrop fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 p-3"
      onClick={onClose}
      role="presentation"
    >
      <section
        className="interaction-modal-card w-full max-w-lg max-h-[86vh] overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Danh sách canh slot"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-base-300 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><Bell size={18} /> Canh Slot</h2>
              <p className="text-xs text-base-content/60">{subtitle}</p>
              <p className="mt-1 text-[11px] text-base-content/45">
                {activeWatchCount}/20 đang canh
                {completedFriendCount > 0
                  ? ` • ${completedFriendCount} đã kết bạn`
                  : ""}
              </p>
            </div>
            <button className="btn btn-ghost btn-circle btn-sm" onClick={onClose} aria-label="Đóng">
              <X size={18} />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={`btn btn-sm ${pushEnabled ? "btn-success" : "btn-primary"}`}
              disabled={slotPushState?.checking}
              onClick={() => enableBackgroundPush({ requestPermission: true, showFeedback: true })}
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
              <Send size={14} /> Gửi thử
            </button>
          </div>

          {syncingAccount && (
            <p className="mt-2 text-xs text-info">⟳ Đang đồng bộ Canh Slot của tài khoản này...</p>
          )}
          {syncError && (
            <p className="mt-2 text-xs text-warning">{syncError}</p>
          )}
          {slotPushState?.permission === "denied" && (
            <p className="mt-2 text-xs text-warning">
              Trình duyệt đang chặn thông báo. Hãy bật quyền thông báo cho Huy Locket trong cài đặt trình duyệt/điện thoại.
            </p>
          )}
          {backgroundEnabled && pushUnsupported && (
            <p className="mt-2 text-xs text-info">
              Hệ thống vẫn canh slot 24/7 và đồng bộ tài khoản. Muốn nhận ngoài màn hình khóa, hãy bật Web Push trên điện thoại/trình duyệt có hỗ trợ.
            </p>
          )}
        </header>

        <div className="max-h-[58vh] overflow-y-auto p-3 space-y-2">
          {watchedCelebs.length === 0 ? (
            <div className="py-10 text-center text-base-content/55">
              <Bell className="mx-auto mb-2 opacity-30" />
              {syncingAccount
                ? "Đang lấy danh sách Canh Slot từ tài khoản..."
                : "Chưa có Celeb nào đang được canh."}
            </div>
          ) : watchedCelebs.map((celeb) => {
            const completedFriend = isCompletedFriendWatch(celeb);
            const checking =
              !completedFriend && checkingUids.includes(celeb.uid);
            const slotOpen =
              !completedFriend && celeb.status === SLOT_STATUS.SLOT_OPEN;
            return (
              <article
                key={celeb.uid}
                className={`rounded-xl border p-3 ${
                  completedFriend
                    ? "border-success/35 bg-success/10"
                    : "border-transparent bg-base-200/60"
                }`}
              >
                <div className="flex items-center gap-3">
                  <img
                    src={celeb.avatar || "/images/default_profile.png"}
                    alt={celeb.displayName}
                    className={`h-11 w-11 rounded-full object-cover ring-2 ${
                      completedFriend ? "ring-success/50" : "ring-transparent"
                    }`}
                    onError={(event) => { event.currentTarget.src = "/images/default_profile.png"; }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">{celeb.displayName}</p>
                      {completedFriend && (
                        <span className="badge badge-success badge-xs">BẠN BÈ</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-base-content/60">@{celeb.username}</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-base-content/60">
                      <span>
                        {checking
                          ? "⏳ Đang kiểm tra..."
                          : statusLabel(
                              completedFriend
                                ? SLOT_STATUS.FRIENDS
                                : celeb.status,
                            )}
                      </span>
                      <span>{celeb.friendCount.toLocaleString()} / {celeb.maxFriends.toLocaleString()}</span>
                      <span>{timeAgo(celeb.lastCheckedAt)}</span>
                    </div>
                    {completedFriend ? (
                      <p className="mt-1 text-[11px] font-medium text-success">
                        ✓ Canh Slot đã tự dừng — không còn dùng worker
                      </p>
                    ) : celeb.autoRequestEnabled ? (
                      <p className="mt-1 text-[11px] font-medium text-warning">
                        ⚡ Tự gửi request Celeb thật đang bật
                      </p>
                    ) : null}
                  </div>
                </div>

                {completedFriend ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-success btn-sm"
                      onClick={() => {
                        onClose();
                        navigate(`/friends?username=${encodeURIComponent(celeb.username)}`);
                      }}
                    >
                      <UserRoundCheck size={14} /> Bạn bè
                    </button>
                    <button
                      className="btn btn-ghost btn-sm ml-auto text-base-content/55"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Xóa @${celeb.username} khỏi danh sách Canh Slot đã hoàn tất?`,
                          )
                        ) {
                          unwatchCeleb(celeb.uid);
                        }
                      }}
                    >
                      <Trash2 size={14} /> Xóa khỏi danh sách
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {slotOpen && (
                      <button
                        className="btn btn-error btn-sm"
                        onClick={() => {
                          onClose();
                          navigate(`/friends?slot=1&username=${encodeURIComponent(celeb.username)}`);
                        }}
                      >
                        Kết bạn ngay
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm"
                      disabled={checking}
                      onClick={() => checkNow(celeb.uid)}
                    >
                      <RefreshCw size={14} className={checking ? "animate-spin" : ""} /> Kiểm tra
                    </button>
                    {celeb.status === SLOT_STATUS.PAUSED ? (
                      <button className="btn btn-ghost btn-sm" onClick={() => resumeWatch(celeb.uid)}>
                        <Play size={14} /> Tiếp tục
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => pauseWatch(celeb.uid)}>
                        <Pause size={14} /> Tạm dừng
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-sm ml-auto text-error"
                      onClick={() => {
                        if (window.confirm(`Hủy canh @${celeb.username}?`)) unwatchCeleb(celeb.uid);
                      }}
                    >
                      <Trash2 size={14} /> Hủy
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>

        {watchedCelebs.length > 0 && (
          <footer className="flex items-center justify-between border-t border-base-300 p-3 text-xs">
            <span className="text-base-content/60">
              {activeWatchCount}/20 đang canh
              {completedFriendCount > 0
                ? ` • ${completedFriendCount} đã kết bạn`
                : ""}
            </span>
            <button
              className="btn btn-ghost btn-xs text-error"
              onClick={() => {
                if (window.confirm("Hủy/xóa tất cả mục trong danh sách?")) clearAll();
              }}
            >
              Xóa tất cả
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
