import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BellOff,
  CheckCircle2,
  Flame,
  History,
  Plus,
  RefreshCw,
  UserRoundCheck,
  X,
  XCircle,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { fetchUserById, getListIdFriends } from "@/services";
import { FallbackAvatar } from "@/components/common";
import { useSlotMonitor } from "../../SlotMonitor/useSlotMonitor";
import { SLOT_STATUS } from "../../SlotMonitor/slotMonitorCore";
import {
  checkCelebCenterNow,
  fetchCelebCenterHistory,
} from "../../SlotMonitor/celebCenterService";

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

function formatFriendSince(value) {
  if (!value) return "";

  const numericValue = Number(value);
  const normalizedValue = Number.isFinite(numericValue)
    ? numericValue < 1e12
      ? numericValue * 1000
      : numericValue
    : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )} ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

const getBadge = (user) =>
  user?.badge ??
  user?._badge ??
  user?.profile?.badge ??
  user?.profile?._badge ??
  null;

function SearchAccountLabel({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
      {children}
    </span>
  );
}

export default function CelebItemFriend({
  friend,
  handleAddFriend,
  loading = false,
  disabled = false,
}) {
  const { t } = useTranslation("features");
  const navigate = useNavigate();
  const { getWatch, watchCeleb, unwatchCeleb } = useSlotMonitor();
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyEvents, setHistoryEvents] = useState([]);
  const [checkingNow, setCheckingNow] = useState(false);
  const [resolvedBadge, setResolvedBadge] = useState(() => getBadge(friend));
  const [friendSince, setFriendSince] = useState("");

  const friendCount = Number(friend?.celebrity_data?.friend_count) || 0;
  const maxFriends = Number(friend?.celebrity_data?.max_friends) || 0;
  const availableSlots = Math.max(0, maxFriends - friendCount);
  const isSlotFull = maxFriends > 0 && availableSlots <= 0;
  const watch = getWatch(friend.uid);
  const isAlreadyFriend = friend?.friendship_status === "friends";
  const isCompletedWatch =
    isAlreadyFriend ||
    watch?.status === SLOT_STATUS.FRIENDS ||
    String(watch?.lastAutoRequestStatus || "").trim().toUpperCase() ===
      "FRIENDS";
  const canShowWatch = !isCompletedWatch;
  const isGold = resolvedBadge === "locket_gold";

  useEffect(() => {
    let active = true;
    const badgeFromSearch = getBadge(friend);
    setResolvedBadge(badgeFromSearch);
    setFriendSince("");

    if (friend?.uid && !badgeFromSearch) {
      fetchUserById(friend.uid)
        .then((profile) => {
          if (active) setResolvedBadge(getBadge(profile));
        })
        .catch(() => {
          // Badge chỉ là dữ liệu bổ sung; không làm hỏng kết quả Celeb nếu fetch lỗi.
        });
    }

    if (friend?.uid) {
      // Relation getAllFriendsV2 là nguồn đúng cho thời điểm kết bạn.
      getListIdFriends()
        .then((relations) => {
          if (!active || !Array.isArray(relations)) return;
          const relation = relations.find(
            (item) => String(item?.uid || "") === String(friend.uid),
          );
          const createdAt =
            relation?.createdAt ??
            relation?.created_at ??
            relation?.friendship_created_at ??
            null;
          setFriendSince(formatFriendSince(createdAt));
        })
        .catch(() => {
          // Không có relation thì ẩn ngày kết bạn, các tính năng Celeb vẫn hoạt động.
        });
    }

    return () => {
      active = false;
    };
  }, [friend]);

  const progressPercent =
    maxFriends > 0 ? Math.min((friendCount / maxFriends) * 100, 100) : 0;

  const openingCount = useMemo(
    () => historyEvents.filter((item) => item.type === "SLOT_OPEN").length,
    [historyEvents],
  );

  const handleWatchToggle = async (event) => {
    event.stopPropagation();
    if (isCompletedWatch) return;
    if (watch) {
      unwatchCeleb(friend.uid);
      return;
    }
    await watchCeleb({
      uid: friend.uid,
      username: friend.username,
      displayName:
        `${friend.first_name || ""} ${friend.last_name || ""}`.trim() ||
        friend.username,
      avatar: friend.profile_picture_url,
      friendCount,
      maxFriends,
    });
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const rows = await fetchCelebCenterHistory({ uid: friend.uid, limit: 80 });
      setHistoryEvents(rows);
    } catch (error) {
      setHistoryError(
        error?.response?.data?.message || "Chưa tải được lịch sử Celeb này.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const openHistory = async (event) => {
    event.stopPropagation();
    setShowHistory(true);
    await loadHistory();
  };

  const checkNow = async (event) => {
    event.stopPropagation();
    if (!watch || isCompletedWatch || checkingNow) return;
    setCheckingNow(true);
    try {
      const result = await checkCelebCenterNow(friend.uid);
      const slots = Math.max(0, Number(result?.availableSlots) || 0);
      toast.success(
        slots > 0
          ? `@${friend.username} hiện còn ${slots.toLocaleString("vi-VN")} slot`
          : `@${friend.username} hiện đang full`,
      );
      if (showHistory) await loadHistory();
    } catch (error) {
      toast.error(
        error?.response?.data?.message || "Không kiểm tra được slot lúc này.",
      );
    } finally {
      setCheckingNow(false);
    }
  };

  const openCelebCenter = (event) => {
    event.stopPropagation();
    navigate(
      `/friends?slot=1&username=${encodeURIComponent(friend.username || "")}`,
      { state: { fromSlotPage: true } },
    );
  };

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-16 h-16 flex-shrink-0">
            <FallbackAvatar
              src={friend.profile_picture_url && friend.profile_picture_url !== "/images/default_profile.png" ? friend.profile_picture_url : null}
              name={friend.first_name || friend.last_name || friend.displayName || friend.username}
              alt={`${friend?.first_name} ${friend?.last_name}`}
              className="w-16 h-16 rounded-full border-[3.5px] p-0.5 border-amber-400 object-cover"
            />
            <img
              src="https://cdn.locket-dio.com/v1/caption/caption-icon/celebrity_badge.png"
              alt="Celebrity"
              className="absolute bottom-0 right-0 w-6 h-6 p-0.5 bg-base-100 rounded-full"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold truncate">
                {friend?.first_name} {friend?.last_name}
              </h2>
              {maxFriends > 0 && (
                <span
                  className={`badge badge-sm ${
                    isSlotFull ? "badge-neutral" : "badge-error"
                  }`}
                >
                  {isSlotFull
                    ? "FULL"
                    : `CÒN ${availableSlots.toLocaleString("vi-VN")} SLOT`}
                </span>
              )}
            </div>
            <p className="text-sm text-base-content/60 truncate">
              @{friend.username || t("friends.no_username")}
              {friendSince ? ` • Ngày kết bạn: ${friendSince}` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <SearchAccountLabel>Celebrity</SearchAccountLabel>
              {isGold && <SearchAccountLabel>Locket Gold</SearchAccountLabel>}
            </div>
            {watch && (
              <p
                className={`mt-1 text-[11px] ${
                  isCompletedWatch ? "text-success" : "text-base-content/55"
                }`}
              >
                {isCompletedWatch
                  ? "✓ Đã kết bạn • Canh Slot đã tự dừng"
                  : `Hệ thống đang canh • kiểm tra gần nhất ${formatDateTime(
                      watch.lastCheckedAt,
                    )}`}
              </p>
            )}
          </div>
        </div>

        <FriendActionButton
          friend={friend}
          isFullSlot={isSlotFull}
          onAdd={handleAddFriend}
          loading={loading}
          disabled={disabled}
        />
      </div>

      {maxFriends > 0 && (
        <div
          className={`rounded-2xl border p-3 ${
            isCompletedWatch
              ? "border-success/35 bg-success/10"
              : "border-base-300 bg-base-200/35"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-base-content/45">
                {isCompletedWatch
                  ? "Trạng thái quan hệ"
                  : "Trạng thái Celeb hiện tại"}
              </p>
              <p
                className={`mt-1 text-sm font-bold ${
                  isCompletedWatch
                    ? "text-success"
                    : isSlotFull
                      ? ""
                      : "text-error"
                }`}
              >
                {isCompletedWatch
                  ? "✓ Đã là bạn bè trên Locket"
                  : isSlotFull
                    ? "Đang full slot"
                    : `Đang có ${availableSlots.toLocaleString("vi-VN")} slot trống`}
              </p>
            </div>
            <div className="text-right text-xs text-base-content/60">
              <p>
                {friendCount.toLocaleString("vi-VN")} / {maxFriends.toLocaleString("vi-VN")}
              </p>
              <p>{Math.round(progressPercent)}%</p>
            </div>
          </div>

          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-base-300">
            <div
              className={`h-full transition-all duration-500 ${
                isCompletedWatch ? "bg-success" : "bg-yellow-400"
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {isCompletedWatch ? (
            <p className="mt-2 text-xs text-success">
              ✓ Canh Slot và Auto Request đã dừng. Không còn theo dõi người này bằng worker.
            </p>
          ) : watch?.lastAutoRequestStatus ? (
            <p
              className={`mt-2 text-xs ${
                watch.lastAutoRequestStatus === "SENT"
                  ? "text-success"
                  : "text-warning"
              }`}
            >
              {watch.lastAutoRequestStatus === "SENT"
                ? "✓ Request đã được Locket xác nhận • đang chờ chấp nhận"
                : "⚠ Auto request gần nhất chưa thành công"}
              {watch.lastAutoRequestAt
                ? ` • ${formatDateTime(watch.lastAutoRequestAt)}`
                : ""}
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canShowWatch && (
          <button
            type="button"
            onClick={handleWatchToggle}
            className={`btn btn-sm ${
              watch?.status === SLOT_STATUS.SLOT_OPEN
                ? "btn-error"
                : watch
                  ? "btn-outline"
                  : "btn-primary"
            }`}
            aria-pressed={Boolean(watch)}
          >
            {watch?.status === SLOT_STATUS.SLOT_OPEN ? (
              <Flame className="w-4 h-4" />
            ) : watch ? (
              <BellOff className="w-4 h-4" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
            {watch?.status === SLOT_STATUS.SLOT_OPEN
              ? "Slot đang mở"
              : watch
                ? "Hủy Canh"
                : "Canh Slot"}
          </button>
        )}

        {isCompletedWatch && (
          <div className="btn btn-sm btn-success pointer-events-none">
            <UserRoundCheck className="w-4 h-4" /> Bạn bè
          </div>
        )}

        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={openHistory}
        >
          <History className="w-4 h-4" /> Lịch sử slot
        </button>

        {watch && !isCompletedWatch && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={checkingNow}
            onClick={checkNow}
          >
            <RefreshCw className={`w-4 h-4 ${checkingNow ? "animate-spin" : ""}`} />
            Kiểm tra thật
          </button>
        )}

        <button
          type="button"
          className="btn btn-sm btn-ghost ml-auto"
          onClick={openCelebCenter}
        >
          <Activity className="w-4 h-4" /> Celeb Center
        </button>
      </div>

      {showHistory && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-4"
          onClick={() => setShowHistory(false)}
        >
          <section
            className="w-full max-w-lg rounded-t-3xl border border-base-300 bg-base-100 p-4 shadow-2xl sm:rounded-3xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <History size={20} /> Lịch sử @{friend.username}
                </h3>
                <p className="mt-1 text-xs text-base-content/55">
                  {openingCount > 0
                    ? `Đã ghi nhận ${openingCount} lần mở slot.`
                    : "Dữ liệu được ghi bởi hệ thống Canh Slot, không tạo lịch sử giả."}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setShowHistory(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {historyLoading ? (
                <div className="flex min-h-32 items-center justify-center">
                  <span className="loading loading-spinner loading-md" />
                </div>
              ) : historyError ? (
                <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  {historyError}
                </div>
              ) : historyEvents.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-base-300 p-5 text-center text-sm text-base-content/55">
                  Chưa có sự kiện lịch sử cho Celeb này. Bật Canh Slot để hệ thống ghi nhận các lần full → có slot và kết quả auto request.
                </div>
              ) : (
                historyEvents.map((event) => {
                  const meta = EVENT_META[event.type] || {
                    label: event.type || "Sự kiện",
                    icon: Activity,
                    className: "text-base-content",
                  };
                  const Icon = meta.icon;
                  return (
                    <article
                      key={event.id}
                      className="rounded-2xl border border-base-300 bg-base-200/35 p-3"
                    >
                      <div className="flex items-start gap-3">
                        <Icon size={17} className={`mt-0.5 ${meta.className}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className={`text-sm font-semibold ${meta.className}`}>
                              {meta.label}
                            </p>
                            <time className="text-[11px] text-base-content/45">
                              {formatDateTime(event.createdAt)}
                            </time>
                          </div>
                          {event.type === "SLOT_OPEN" && (
                            <p className="mt-1 text-xs text-base-content/65">
                              Còn {Number(event.availableSlots || 0).toLocaleString("vi-VN")} slot • {Number(event.friendCount || 0).toLocaleString("vi-VN")} / {Number(event.maxFriends || 0).toLocaleString("vi-VN")} bạn
                            </p>
                          )}
                          {event.detail && (
                            <p className="mt-1 break-words text-xs text-base-content/55">
                              {event.detail}
                            </p>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={historyLoading}
                onClick={loadHistory}
              >
                <RefreshCw size={14} className={historyLoading ? "animate-spin" : ""} />
                Làm mới lịch sử
              </button>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={openCelebCenter}
              >
                Mở Celeb Center
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function FriendActionButton({
  friend,
  isFullSlot = false,
  onAdd,
  loading = false,
  disabled = false,
}) {
  const { t } = useTranslation("features");
  const status = friend?.friendship_status;

  const baseClass =
    "flex items-center gap-1 px-4 py-2 rounded-full font-semibold transition-all";

  if (status === "friends") {
    return (
      <div className={`${baseClass} bg-primary text-primary-content`}>
        <UserRoundCheck className="w-5 h-5" />
        {t("friends.action.friends")}
      </div>
    );
  }

  if (status === "follower-waitlist") {
    return (
      <button
        disabled={isFullSlot || disabled || loading}
        onClick={(e) => {
          e.stopPropagation();
          if (isFullSlot || disabled || loading) return;
          onAdd?.(friend.uid);
        }}
        className={`${baseClass} ${
          isFullSlot
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : "bg-yellow-500 text-black hover:bg-yellow-400"
        }`}
      >
        {isFullSlot
          ? t("friends.celeb.in_queue")
          : t("friends.celeb.resend_request")}
      </button>
    );
  }

  if (status === "outgoing-follow-request") {
    return (
      <div className={`${baseClass} bg-base-200 text-base-content`}>
        {t("friends.celeb.waiting_accept")}
      </div>
    );
  }

  return (
    <button
      disabled={isFullSlot || disabled || loading}
      onClick={(e) => {
        e.stopPropagation();
        if (isFullSlot || disabled || loading) return;
        onAdd?.(friend.uid);
      }}
      className={`${baseClass} ${
        isFullSlot || disabled || loading
          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
          : "bg-yellow-500 text-black hover:bg-yellow-400"
      }`}
    >
      {loading ? (
        <span className="loading loading-spinner loading-xs" />
      ) : (
        <Plus className="w-5 h-5" />
      )}
      {loading
        ? t("friends.find.sending_request", "Đang gửi...")
        : t("friends.celeb.follow")}
    </button>
  );
}
