import React, { useCallback, useState } from "react";
import {
  Ban,
  ChevronRight,
  Copy,
  QrCode,
  RefreshCw,
  Share2,
  ThumbsUp,
  UserRoundCheck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FallbackAvatar } from "@/components/common";
import {
  getBlockedFriends,
  getLocketQr,
  unblockFriend,
} from "@/services";
import MyWebPollModal from "./WebPoll/MyWebPollModal";

function displayName(user) {
  return (
    user?.displayName ||
    `${user?.firstName || ""} ${user?.lastName || ""}`.trim() ||
    user?.username ||
    user?.uid ||
    "Tài khoản Locket"
  );
}

export default function FriendsTools({ refreshFriendsData }) {
  const [blockedOpen, setBlockedOpen] = useState(false);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState([]);
  const [blockedMeta, setBlockedMeta] = useState({});
  const [blockedError, setBlockedError] = useState("");
  const [unblockingUid, setUnblockingUid] = useState("");

  const [qrOpen, setQrOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [qrError, setQrError] = useState("");
  const [pollOpen, setPollOpen] = useState(false);

  const loadBlocked = useCallback(async () => {
    setBlockedLoading(true);
    setBlockedError("");
    try {
      const result = await getBlockedFriends();
      setBlockedUsers(result.users);
      setBlockedMeta(result.meta || {});
    } catch (error) {
      setBlockedError(
        error?.response?.data?.message ||
          error?.message ||
          "Không lấy được danh sách đã block.",
      );
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  const openBlocked = async () => {
    setBlockedOpen(true);
    await loadBlocked();
  };

  const handleUnblock = async (user) => {
    if (!user?.uid || unblockingUid) return;
    if (!window.confirm(`Unblock @${user.username || user.uid}?`)) return;

    setUnblockingUid(user.uid);
    try {
      await unblockFriend(user.uid);
      setBlockedUsers((current) =>
        current.filter((item) => String(item.uid) !== String(user.uid)),
      );
      toast.success("Đã unblock trên Locket", {
        description: `@${user.username || user.uid} đã được gỡ khỏi danh sách block.`,
      });
      refreshFriendsData?.().catch(() => {});
    } catch (error) {
      toast.error("Unblock chưa thành công", {
        description:
          error?.response?.data?.message ||
          error?.message ||
          "Locket chưa xác nhận thao tác.",
      });
    } finally {
      setUnblockingUid("");
    }
  };

  const loadQr = useCallback(async () => {
    setQrLoading(true);
    setQrError("");
    try {
      const data = await getLocketQr();
      setQrData(data);
    } catch (error) {
      setQrError(
        error?.response?.data?.message ||
          error?.message ||
          "Không tạo được Locket QR.",
      );
    } finally {
      setQrLoading(false);
    }
  }, []);

  const openQr = async () => {
    setQrOpen(true);
    if (!qrData) await loadQr();
  };

  const copyInvite = async () => {
    if (!qrData?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(qrData.inviteUrl);
      toast.success("Đã sao chép link Locket");
    } catch {
      toast.error("Không sao chép được link");
    }
  };

  const shareInvite = async () => {
    if (!qrData?.inviteUrl) return;
    if (!navigator.share) {
      await copyInvite();
      return;
    }
    try {
      await navigator.share({
        title: `Locket @${qrData.username || ""}`.trim(),
        text: "Thêm mình trên Locket",
        url: qrData.inviteUrl,
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        toast.error("Không chia sẻ được Locket QR");
      }
    }
  };

  return (
    <>
      <section className="rounded-3xl border border-base-300 bg-base-100/70 p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-base-content/45">
              Công cụ Locket
            </p>
            <p className="mt-0.5 text-sm font-semibold text-base-content/80">
              Quản lý riêng tư, chia sẻ và tương tác
            </p>
          </div>
          <span className="badge badge-primary badge-sm font-semibold">MỚI</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="group relative overflow-hidden rounded-2xl border-2 border-error/45 bg-gradient-to-br from-error/20 via-error/10 to-base-100 p-4 text-left shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-error/70 hover:shadow-lg active:translate-y-0 active:scale-[0.99]"
            onClick={openBlocked}
          >
            <span className="pointer-events-none absolute -right-5 -top-7 h-24 w-24 rounded-full bg-error/10 transition-transform duration-300 group-hover:scale-125" />
            <div className="relative flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-error/25 bg-error/15 text-error shadow-sm">
                <Ban className="h-6 w-6" strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="block text-base font-extrabold">Đã block</span>
                  <span className="badge badge-error badge-xs">RIÊNG TƯ</span>
                </span>
                <span className="mt-1 block text-xs font-medium text-base-content/60">
                  Xem danh sách và unblock tài khoản
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-error transition-transform group-hover:translate-x-1" />
            </div>
          </button>

          <button
            type="button"
            className="group relative overflow-hidden rounded-2xl border-2 border-warning/55 bg-gradient-to-br from-warning/25 via-warning/10 to-base-100 p-4 text-left shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-warning/80 hover:shadow-lg active:translate-y-0 active:scale-[0.99]"
            onClick={openQr}
          >
            <span className="pointer-events-none absolute -right-5 -top-7 h-24 w-24 rounded-full bg-warning/15 transition-transform duration-300 group-hover:scale-125" />
            <div className="relative flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-warning/35 bg-warning/20 text-warning shadow-sm">
                <QrCode className="h-6 w-6" strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="block text-base font-extrabold">Locket QR</span>
                  <span className="badge badge-warning badge-xs">CHIA SẺ</span>
                </span>
                <span className="mt-1 block text-xs font-medium text-base-content/60">
                  Mở QR thêm bạn chính chủ của bạn
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-warning transition-transform group-hover:translate-x-1" />
            </div>
          </button>

          <button
            type="button"
            className="group relative overflow-hidden rounded-2xl border-2 border-[#6956ff]/55 bg-gradient-to-br from-[#6956ff]/25 via-[#8b5cf6]/10 to-base-100 p-4 text-left shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:border-[#6956ff]/80 hover:shadow-lg active:translate-y-0 active:scale-[0.99] sm:col-span-2"
            onClick={() => setPollOpen(true)}
          >
            <span className="pointer-events-none absolute -right-7 -top-10 h-32 w-32 rounded-full bg-[#6956ff]/12 transition-transform duration-300 group-hover:scale-125" />
            <div className="relative flex items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#6956ff]/30 bg-[#6956ff]/15 text-[#6956ff] shadow-sm">
                <ThumbsUp className="h-6 w-6" strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="block text-base font-extrabold">Bình chọn</span>
                  <span className="rounded-full bg-[#6956ff] px-2 py-0.5 text-[10px] font-extrabold text-white">
                    THỬ NGAY
                  </span>
                </span>
                <span className="mt-1 block text-xs font-medium text-base-content/60">
                  Tạo câu hỏi 👍 / 👎 để bạn bè trên Huy Locket bình chọn
                </span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-[#6956ff] transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        </div>
      </section>

      <MyWebPollModal open={pollOpen} onClose={() => setPollOpen(false)} />

      {blockedOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
          onClick={() => setBlockedOpen(false)}
        >
          <section
            className="w-full max-w-lg rounded-t-3xl bg-base-100 p-4 shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <Ban size={20} /> Tài khoản đã block
                </h3>
                <p className="mt-1 text-xs text-base-content/55">
                  Danh sách lấy từ trạng thái Locket của tài khoản hiện tại.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setBlockedOpen(false)}
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {blockedLoading ? (
                <div className="flex min-h-36 items-center justify-center gap-2 text-sm opacity-60">
                  <span className="loading loading-spinner loading-sm" />
                  Đang lấy danh sách thật...
                </div>
              ) : blockedError ? (
                <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                  {blockedError}
                </div>
              ) : blockedUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-base-300 p-6 text-center text-sm text-base-content/55">
                  {blockedMeta?.authoritative === false
                    ? "Phiên Locket này chưa trả được danh sách block để xác nhận."
                    : "Chưa block tài khoản nào."}
                </div>
              ) : (
                blockedUsers.map((user) => (
                  <div
                    key={user.uid}
                    className="flex items-center gap-3 rounded-2xl border border-base-300 bg-base-200/35 p-3"
                  >
                    <FallbackAvatar
                      src={user.profilePicture || null}
                      name={displayName(user)}
                      alt={displayName(user)}
                      className="h-11 w-11 rounded-full object-cover"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {displayName(user)}
                      </p>
                      <p className="truncate text-xs text-base-content/55">
                        {user.username ? `@${user.username}` : user.uid}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      disabled={Boolean(unblockingUid)}
                      onClick={() => handleUnblock(user)}
                    >
                      {unblockingUid === user.uid ? (
                        <span className="loading loading-spinner loading-xs" />
                      ) : (
                        <UserRoundCheck size={15} />
                      )}
                      Unblock
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={blockedLoading}
                onClick={loadBlocked}
              >
                <RefreshCw
                  size={15}
                  className={blockedLoading ? "animate-spin" : ""}
                />
                Làm mới
              </button>
            </div>
          </section>
        </div>
      )}

      {qrOpen && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
          onClick={() => setQrOpen(false)}
        >
          <section
            className="w-full max-w-md rounded-t-3xl bg-base-100 p-5 shadow-2xl sm:rounded-3xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold">
                  <QrCode size={21} /> Locket QR
                </h3>
                <p className="mt-1 text-xs text-base-content/55">
                  Quét QR để mở link thêm bạn Locket của tài khoản này.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-circle btn-ghost btn-sm"
                onClick={() => setQrOpen(false)}
                aria-label="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            {qrLoading ? (
              <div className="flex min-h-72 items-center justify-center gap-2 text-sm opacity-60">
                <span className="loading loading-spinner loading-md" />
                Đang tạo QR...
              </div>
            ) : qrError ? (
              <div className="mt-5 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
                {qrError}
                <button
                  type="button"
                  className="btn btn-warning btn-sm mt-3 w-full"
                  onClick={loadQr}
                >
                  Thử lại
                </button>
              </div>
            ) : qrData ? (
              <div className="mt-5 flex flex-col items-center">
                <FallbackAvatar
                  src={qrData.profilePicture || null}
                  name={qrData.displayName || qrData.username}
                  alt={qrData.displayName || qrData.username}
                  className="h-14 w-14 rounded-full object-cover"
                />
                <p className="mt-2 font-bold">{qrData.displayName}</p>
                {qrData.username && (
                  <p className="text-sm text-base-content/55">@{qrData.username}</p>
                )}

                <div className="mt-4 rounded-3xl bg-white p-4 shadow-inner">
                  <img
                    src={qrData.qrDataUrl}
                    alt={`Locket QR @${qrData.username || ""}`}
                    className="h-60 w-60 max-w-full object-contain"
                  />
                </div>

                <p className="mt-3 max-w-full break-all text-center text-[11px] text-base-content/45">
                  {qrData.inviteUrl}
                </p>

                <div className="mt-4 grid w-full grid-cols-2 gap-2">
                  <button type="button" className="btn btn-outline" onClick={copyInvite}>
                    <Copy size={16} /> Sao chép link
                  </button>
                  <button type="button" className="btn btn-primary" onClick={shareInvite}>
                    <Share2 size={16} /> Chia sẻ
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      )}
    </>
  );
}
