import React, { useCallback, useState } from "react";
import {
  Ban,
  Copy,
  QrCode,
  RefreshCw,
  Share2,
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
      // Locket không tự kết bạn lại sau unblock; refresh chỉ để trạng thái web
      // đồng bộ nếu upstream đã thay đổi quan hệ.
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
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-base-300 bg-base-200/35 p-2">
        <button
          type="button"
          className="btn btn-ghost justify-start gap-2"
          onClick={openBlocked}
        >
          <Ban className="h-5 w-5 text-error" />
          <span className="min-w-0 text-left">
            <span className="block text-sm font-semibold">Đã block</span>
            <span className="block truncate text-[11px] font-normal opacity-55">
              Xem và unblock
            </span>
          </span>
        </button>

        <button
          type="button"
          className="btn btn-ghost justify-start gap-2"
          onClick={openQr}
        >
          <QrCode className="h-5 w-5 text-warning" />
          <span className="min-w-0 text-left">
            <span className="block text-sm font-semibold">Locket QR</span>
            <span className="block truncate text-[11px] font-normal opacity-55">
              QR thêm bạn chính chủ
            </span>
          </span>
        </button>
      </div>

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
