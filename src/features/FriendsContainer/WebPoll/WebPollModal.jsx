import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom";
import { RefreshCw, ThumbsDown, ThumbsUp, Users, X } from "lucide-react";
import { toast } from "sonner";
import { FallbackAvatar } from "@/components/common";
import { getUserWebPoll, voteUserWebPoll } from "@/services";

const PURPLE = "#6956ff";

function friendName(friend) {
  return (
    `${friend?.firstName || ""} ${friend?.lastName || ""}`.trim() ||
    friend?.displayName ||
    friend?.username ||
    "Bạn bè"
  );
}

function avatarOf(friend) {
  return friend?.profilePic || friend?.profilePicture || friend?.avatar || "";
}

export default function WebPollModal({ open, onClose, friend }) {
  const [poll, setPoll] = useState(null);
  const [loading, setLoading] = useState(false);
  const [voting, setVoting] = useState("");
  const [error, setError] = useState("");
  const [showVoters, setShowVoters] = useState(false);
  const [bursts, setBursts] = useState([]);

  const load = useCallback(async () => {
    if (!friend?.uid) return;
    setLoading(true);
    setError("");
    try {
      const result = await getUserWebPoll(friend.uid);
      setPoll(result);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "Không tải được bình chọn lúc này.",
      );
    } finally {
      setLoading(false);
    }
  }, [friend?.uid]);

  useEffect(() => {
    if (!open) return;
    setShowVoters(false);
    setBursts([]);
    load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const total = Number(poll?.totalVotes || 0);
  const upPercent = total ? Math.round((Number(poll?.upCount || 0) / total) * 100) : 0;
  const downPercent = total ? 100 - upPercent : 0;

  const sortedVoters = useMemo(() => poll?.voters || [], [poll?.voters]);

  const createBurst = (choice) => {
    const emoji = choice === "up" ? "👍" : "👎";
    const now = Date.now();
    const next = Array.from({ length: 12 }, (_, index) => ({
      id: `${now}-${index}`,
      emoji,
      left: 12 + Math.random() * 76,
      top: 15 + Math.random() * 65,
      rotate: -22 + Math.random() * 44,
      delay: Math.random() * 0.24,
    }));
    setBursts(next);
    window.setTimeout(() => setBursts([]), 1250);
  };

  const vote = async (choice) => {
    if (!friend?.uid || voting) return;
    setVoting(choice);
    try {
      const updated = await voteUserWebPoll(friend.uid, choice);
      setPoll(updated);
      createBurst(choice);
      toast.success(choice === "up" ? "Đã bình chọn 👍" : "Đã bình chọn 👎", {
        description: "Đã lưu trên Huy Locket Web.",
      });
    } catch (err) {
      toast.error("Chưa gửi được bình chọn", {
        description:
          err?.response?.data?.message || err?.message || "Thử lại sau.",
      });
    } finally {
      setVoting("");
    }
  };

  if (!open || typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-[3px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        className="relative w-full max-w-md overflow-hidden rounded-t-[32px] border border-white/15 bg-base-100 shadow-2xl sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="relative px-5 pb-5 pt-4 text-white"
          style={{ background: `linear-gradient(145deg, ${PURPLE}, #8b5cf6)` }}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 transition hover:bg-white/25"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>

          <div className="flex items-center gap-3 pr-10">
            <FallbackAvatar
              src={avatarOf(friend) || null}
              name={friendName(friend)}
              alt={friendName(friend)}
              className="h-12 w-12 rounded-full border-2 border-white/70 object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold">{friendName(friend)}</p>
              <p className="truncate text-xs text-white/75">
                {friend?.username ? `@${friend.username}` : "Huy Locket"}
              </p>
            </div>
          </div>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-extrabold text-[#5c4cf2] shadow-lg">
            <span className="text-lg">〽</span> Bình chọn
          </div>
        </div>

        <div className="relative min-h-[330px] p-5">
          {bursts.map((burst) => (
            <span
              key={burst.id}
              className="pointer-events-none absolute z-20 text-4xl animate-bounce drop-shadow-lg"
              style={{
                left: `${burst.left}%`,
                top: `${burst.top}%`,
                transform: `translate(-50%, -50%) rotate(${burst.rotate}deg)`,
                animationDelay: `${burst.delay}s`,
              }}
            >
              {burst.emoji}
            </span>
          ))}

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-base-content/55">
              <span className="loading loading-spinner loading-md" /> Đang tải bình chọn...
            </div>
          ) : error ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <p className="max-w-xs text-sm text-warning">{error}</p>
              <button type="button" className="btn btn-sm mt-4" onClick={load}>
                <RefreshCw size={15} /> Thử lại
              </button>
            </div>
          ) : !poll ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center text-center">
              <div className="text-5xl">🗳️</div>
              <p className="mt-3 font-bold">Chưa có bình chọn</p>
              <p className="mt-1 max-w-xs text-xs text-base-content/50">
                Người này chưa tạo câu hỏi bình chọn trên Huy Locket Web.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-3xl border border-base-300 bg-base-200/45 p-4 text-center shadow-sm">
                <p className="text-xl font-extrabold leading-snug">{poll.question}</p>
                <p className="mt-1 text-[11px] text-base-content/45">
                  Chọn một phản ứng • có thể đổi lựa chọn
                </p>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={Boolean(voting)}
                    onClick={() => vote("up")}
                    className={`relative overflow-hidden rounded-3xl border-2 p-4 transition active:scale-95 ${
                      poll.viewerChoice === "up"
                        ? "border-[#6956ff] bg-[#6956ff]/15 shadow-lg"
                        : "border-base-300 bg-base-100 hover:border-[#6956ff]/55"
                    }`}
                  >
                    <div className="text-5xl">👍</div>
                    <div className="mt-2 text-xl font-black">{poll.upCount || 0}</div>
                    <div className="text-[11px] font-semibold text-base-content/50">
                      {upPercent}%
                    </div>
                    {voting === "up" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-base-100/75">
                        <span className="loading loading-spinner loading-sm" />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={Boolean(voting)}
                    onClick={() => vote("down")}
                    className={`relative overflow-hidden rounded-3xl border-2 p-4 transition active:scale-95 ${
                      poll.viewerChoice === "down"
                        ? "border-[#6956ff] bg-[#6956ff]/15 shadow-lg"
                        : "border-base-300 bg-base-100 hover:border-[#6956ff]/55"
                    }`}
                  >
                    <div className="text-5xl">👎</div>
                    <div className="mt-2 text-xl font-black">{poll.downCount || 0}</div>
                    <div className="text-[11px] font-semibold text-base-content/50">
                      {downPercent}%
                    </div>
                    {voting === "down" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-base-100/75">
                        <span className="loading loading-spinner loading-sm" />
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-base-300 bg-base-200/40 px-4 py-3 text-left transition hover:bg-base-200"
                onClick={() => setShowVoters((value) => !value)}
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#6956ff]/15 text-[#6956ff]">
                  <Users size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">
                    {total.toLocaleString("vi-VN")} bạn đã bình chọn
                  </span>
                  <span className="block text-[11px] text-base-content/45">
                    {showVoters ? "Ẩn danh sách" : "Xem ai đã chọn gì"}
                  </span>
                </span>
                <span className="text-xl">{showVoters ? "⌃" : "⌄"}</span>
              </button>

              {showVoters && (
                <div className="mt-2 max-h-52 space-y-1.5 overflow-y-auto rounded-2xl border border-base-300 p-2">
                  {sortedVoters.length === 0 ? (
                    <p className="py-5 text-center text-xs text-base-content/45">
                      Chưa có ai bình chọn.
                    </p>
                  ) : (
                    sortedVoters.map((voter) => (
                      <div
                        key={voter.uid}
                        className="flex items-center gap-2 rounded-xl bg-base-200/35 px-2.5 py-2"
                      >
                        <FallbackAvatar
                          src={voter.avatar || null}
                          name={voter.displayName || voter.username}
                          alt={voter.displayName || voter.username}
                          className="h-8 w-8 rounded-full object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{voter.displayName}</p>
                          {voter.username && (
                            <p className="truncate text-[10px] text-base-content/45">
                              @{voter.username}
                            </p>
                          )}
                        </div>
                        <span className="text-2xl">{voter.choice === "up" ? "👍" : "👎"}</span>
                      </div>
                    ))
                  )}
                </div>
              )}

              <p className="mt-3 text-center text-[10px] font-medium text-base-content/40">
                Bình chọn trên Huy Locket Web • chưa đồng bộ sang app Locket
              </p>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
