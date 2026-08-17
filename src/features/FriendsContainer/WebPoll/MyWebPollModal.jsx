import React, { useCallback, useEffect, useState } from "react";
import ReactDOM from "react-dom";
import { RefreshCw, Save, ThumbsDown, ThumbsUp, Users, X } from "lucide-react";
import { toast } from "sonner";
import {
  getMyWebPoll,
  saveMyWebPoll,
  setMyWebPollActive,
} from "@/services";

const EXAMPLES = [
  "Ngầu không ạ 🤘",
  "Hôm nay tui ổn không? 😎",
  "Ảnh đại diện này được không? 📸",
];

export default function MyWebPollModal({ open, onClose, onUseCaption }) {
  const [poll, setPoll] = useState(null);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState("");
  const [showVoters, setShowVoters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getMyWebPoll();
      setPoll(result);
      setQuestion(result?.question || "");
    } catch (err) {
      setError(
        err?.response?.data?.message || err?.message || "Không tải được bình chọn.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setShowVoters(false);
      load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const save = async () => {
    const normalized = question.trim();
    if (!normalized) {
      toast.warning("Nhập câu hỏi trước đã");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const changedQuestion = poll && poll.question !== normalized;
      const result = await saveMyWebPoll({ question: normalized, active: true });
      setPoll(result);
      setQuestion(result?.question || normalized);
      toast.success(poll ? "Đã cập nhật bình chọn" : "Đã tạo bình chọn", {
        description: changedQuestion
          ? "Câu hỏi mới bắt đầu lượt bình chọn mới."
          : "Bạn bè trên Huy Locket Web có thể bình chọn ngay.",
      });
    } catch (err) {
      toast.error("Không lưu được bình chọn", {
        description:
          err?.response?.data?.message || err?.message || "Thử lại sau.",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async () => {
    if (!poll || toggling) return;
    setToggling(true);
    try {
      const result = await setMyWebPollActive(!poll.active);
      setPoll(result);
      toast.success(result?.active ? "Đã bật bình chọn" : "Đã tạm ẩn bình chọn");
    } catch (err) {
      toast.error("Không đổi được trạng thái", {
        description:
          err?.response?.data?.message || err?.message || "Thử lại sau.",
      });
    } finally {
      setToggling(false);
    }
  };

  const useAsCaption = () => {
    if (!poll?.question || typeof onUseCaption !== "function") return;
    onUseCaption(poll);
  };

  if (!open || typeof document === "undefined") return null;

  const totalVotes = Number(poll?.totalVotes || 0);

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 backdrop-blur-[3px] sm:items-center sm:p-4"
      onClick={onClose}
    >
      <section
        className="w-full max-w-lg overflow-hidden rounded-t-[32px] border border-white/10 bg-base-100 shadow-2xl sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="relative bg-gradient-to-br from-[#6555ff] to-[#8b5cf6] px-5 pb-5 pt-4 text-white">
          <button
            type="button"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
            onClick={onClose}
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
            Caption Bình chọn
          </p>
          <h2 className="mt-1 text-2xl font-black">Bình chọn của bạn</h2>
          <p className="mt-1 max-w-sm text-xs text-white/75">
            Tạo câu hỏi, dùng làm Caption và xem chính xác ai đã chọn 👍 hoặc 👎.
          </p>
        </header>

        <div className="max-h-[72vh] overflow-y-auto p-5">
          {loading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-base-content/55">
              <span className="loading loading-spinner loading-md" /> Đang tải...
            </div>
          ) : error ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <p className="text-sm text-warning">{error}</p>
              <button type="button" className="btn btn-sm mt-4" onClick={load}>
                <RefreshCw size={15} /> Thử lại
              </button>
            </div>
          ) : (
            <>
              <label className="text-sm font-bold">Câu hỏi</label>
              <textarea
                className="textarea textarea-bordered mt-2 min-h-24 w-full resize-none rounded-2xl text-base font-semibold"
                maxLength={140}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="Ví dụ: Ngầu không ạ 🤘"
              />
              <div className="mt-1 flex justify-between text-[10px] text-base-content/40">
                <span>Đổi câu hỏi sẽ bắt đầu lượt bình chọn mới.</span>
                <span>{question.length}/140</span>
              </div>

              {!question && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="rounded-full border border-[#6956ff]/25 bg-[#6956ff]/10 px-3 py-1.5 text-xs font-semibold text-[#6956ff]"
                      onClick={() => setQuestion(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                className="btn mt-4 w-full border-0 bg-[#6956ff] text-white hover:bg-[#5745ee]"
                disabled={saving || !question.trim()}
                onClick={save}
              >
                {saving ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <Save size={17} />
                )}
                {poll ? "Lưu & bật bình chọn" : "Tạo bình chọn"}
              </button>

              {poll && (
                <>
                  <div className="mt-4 rounded-3xl border border-base-300 bg-base-200/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-base-content/45">
                          Caption hiện tại
                        </p>
                        <p className="mt-1 text-lg font-extrabold">{poll.question}</p>
                      </div>
                      <span
                        className={`badge font-bold ${poll.active ? "badge-success" : "badge-ghost"}`}
                      >
                        {poll.active ? "ĐANG BẬT" : "ĐANG ẨN"}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-2xl bg-base-100 p-3">
                        <ThumbsUp size={18} className="mx-auto text-[#6956ff]" />
                        <p className="mt-1 text-xl font-black">{poll.upCount || 0}</p>
                      </div>
                      <div className="rounded-2xl bg-base-100 p-3">
                        <ThumbsDown size={18} className="mx-auto text-[#6956ff]" />
                        <p className="mt-1 text-xl font-black">{poll.downCount || 0}</p>
                      </div>
                      <div className="rounded-2xl bg-base-100 p-3">
                        <Users size={18} className="mx-auto text-[#6956ff]" />
                        <p className="mt-1 text-xl font-black">{totalVotes}</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="mt-3 flex w-full items-center justify-between rounded-2xl bg-[#6956ff]/10 px-4 py-3 text-left text-[#6956ff] transition hover:bg-[#6956ff]/15"
                      onClick={() => setShowVoters((value) => !value)}
                    >
                      <span className="flex items-center gap-2 text-sm font-extrabold">
                        <Users size={17} />
                        {totalVotes > 0
                          ? `${totalVotes} bạn đã bình chọn`
                          : "Chưa có ai bình chọn"}
                      </span>
                      <span className="text-xs font-bold">
                        {showVoters ? "Ẩn" : "Xem danh sách"}
                      </span>
                    </button>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        disabled={toggling}
                        onClick={toggleActive}
                      >
                        {toggling && <span className="loading loading-spinner loading-xs" />}
                        {poll.active ? "Tạm ẩn" : "Bật lại"}
                      </button>
                      {typeof onUseCaption === "function" ? (
                        <button
                          type="button"
                          className="btn btn-sm border-0 bg-[#6956ff] text-white hover:bg-[#5745ee]"
                          disabled={!poll.active}
                          onClick={useAsCaption}
                        >
                          Dùng làm Caption
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={load}
                        >
                          <RefreshCw size={14} /> Làm mới
                        </button>
                      )}
                    </div>
                  </div>

                  {showVoters && (
                    <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border border-base-300 p-2">
                      {(poll.voters || []).length === 0 ? (
                        <p className="py-6 text-center text-xs text-base-content/45">
                          Chưa có ai bình chọn.
                        </p>
                      ) : (
                        poll.voters.map((voter) => (
                          <div
                            key={voter.uid}
                            className="flex items-center gap-2 rounded-xl bg-base-200/40 px-3 py-2"
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#6956ff]/12 text-sm font-black text-[#6956ff]">
                              {(voter.displayName || voter.username || "?")
                                .trim()
                                .charAt(0)
                                .toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">{voter.displayName}</p>
                              {voter.username && (
                                <p className="truncate text-[10px] text-base-content/45">
                                  @{voter.username}
                                </p>
                              )}
                            </div>
                            <span className="rounded-full bg-base-100 px-3 py-1 text-2xl shadow-sm">
                              {voter.choice === "up" ? "👍" : "👎"}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}

              <p className="mt-4 text-center text-[10px] font-medium text-base-content/40">
                Danh sách này là bình chọn trên Huy Locket Web • chưa đồng bộ sang app Locket chính hãng
              </p>
            </>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}
