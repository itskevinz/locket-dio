import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { adminRequest } from "@/services/AdminAuthService";

const TEMPLATES = [
  {
    id: "apology",
    icon: "🙏",
    title: "Xin lỗi khóa nhầm",
    description: "Dùng khi Admin lỡ khóa nhầm tài khoản. Xác nhận đã kiểm tra, mở khóa và xin lỗi người dùng.",
    badge: "XIN LỖI",
    previewTitle: "Tài khoản của bạn đã bị khóa nhầm",
    status: "Đã mở khóa • Hoạt động bình thường",
    activeClass: "border-violet-500 bg-violet-50",
  },
  {
    id: "restored",
    icon: "✅",
    title: "Xác nhận đã mở khóa",
    description: "Thông báo tài khoản đã được khôi phục và có thể sử dụng Duchi Locket bình thường.",
    badge: "KHÔI PHỤC TÀI KHOẢN",
    previewTitle: "Tài khoản của bạn đã được mở khóa",
    status: "Đã mở khóa • Hoạt động bình thường",
    activeClass: "border-emerald-500 bg-emerald-50",
  },
  {
    id: "warning",
    icon: "⚠️",
    title: "Cảnh báo tài khoản",
    description: "Nhắc người dùng về hoạt động bất thường, vi phạm hoặc vấn đề cần chú ý trước khi áp dụng hạn chế.",
    badge: "CẢNH BÁO TÀI KHOẢN",
    previewTitle: "Tài khoản của bạn cần được chú ý",
    status: "Cần chú ý • Tài khoản vẫn được theo dõi",
    activeClass: "border-amber-500 bg-amber-50",
  },
  {
    id: "maintenance",
    icon: "🛠️",
    title: "Thông báo bảo trì",
    description: "Gửi thông tin bảo trì hoặc nâng cấp hệ thống tới một người dùng cụ thể.",
    badge: "BẢO TRÌ HỆ THỐNG",
    previewTitle: "Duchi Locket sắp thực hiện bảo trì",
    status: "Hệ thống • Bảo trì có kế hoạch",
    activeClass: "border-sky-500 bg-sky-50",
  },
  {
    id: "incident",
    icon: "🚨",
    title: "Thông báo sự cố",
    description: "Thông báo khi hệ thống đang gặp lỗi và đội ngũ quản trị đang xử lý.",
    badge: "CẬP NHẬT SỰ CỐ",
    previewTitle: "Chúng tôi đang xử lý một sự cố hệ thống",
    status: "Sự cố • Đang được xử lý",
    activeClass: "border-rose-500 bg-rose-50",
  },
  {
    id: "welcome",
    icon: "👋",
    title: "Chào mừng người dùng",
    description: "Thư chào mừng tài khoản mới hoặc người dùng vừa được hỗ trợ đăng nhập thành công.",
    badge: "CHÀO MỪNG",
    previewTitle: "Chào mừng bạn đến với Duchi Locket",
    status: "Tài khoản • Sẵn sàng sử dụng",
    activeClass: "border-blue-500 bg-blue-50",
  },
  {
    id: "feature",
    icon: "✨",
    title: "Thông báo tính năng mới",
    description: "Giới thiệu bản cập nhật hoặc tính năng mới vừa được phát hành trên Duchi Locket.",
    badge: "TÍNH NĂNG MỚI",
    previewTitle: "Duchi Locket vừa được nâng cấp",
    status: "Cập nhật • Phiên bản mới khả dụng",
    activeClass: "border-fuchsia-500 bg-fuchsia-50",
  },
];

export default function AdminMailComposer({
  open,
  email,
  template,
  sending,
  onTemplateChange,
  onClose,
  onSend,
}) {
  const contentScrollRef = useRef(null);
  const quotaRequestRef = useRef(false);
  const [mailQuota, setMailQuota] = useState(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaError, setQuotaError] = useState("");

  const loadMailQuota = async () => {
    if (quotaRequestRef.current) return;
    quotaRequestRef.current = true;
    setQuotaLoading(true);
    setQuotaError("");
    try {
      const result = await adminRequest("/mail-quota");
      setMailQuota({
        remaining: Number(result?.remaining),
        dailyLimit: Number(result?.dailyLimit) || null,
        checkedAt: result?.checkedAt || null,
        senderEmail: String(result?.senderEmail || "").trim().toLowerCase(),
      });
    } catch (error) {
      setMailQuota(null);
      setQuotaError(error?.code === "MAIL_QUOTA_RELAY_UPDATE_REQUIRED"
        ? "Cần cập nhật Apps Script"
        : "Không đọc được quota");
    } finally {
      quotaRequestRef.current = false;
      setQuotaLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    loadMailQuota();
    // Chỉ kiểm tra một lần mỗi lần mở Mail Center; nút quota cho phép refresh thủ công.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyLeft = document.body.style.left;
    const previousBodyRight = document.body.style.right;
    const previousBodyWidth = document.body.style.width;

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.right = "0";
    document.body.style.width = "100%";

    const frame = window.requestAnimationFrame(() => {
      contentScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.left = previousBodyLeft;
      document.body.style.right = previousBodyRight;
      document.body.style.width = previousBodyWidth;
      window.scrollTo({ top: scrollY, left: scrollX, behavior: "auto" });
    };
  }, [open, email]);

  if (!open || typeof document === "undefined") return null;

  const selected = TEMPLATES.find((item) => item.id === template) || TEMPLATES[0];
  const quotaText = quotaLoading
    ? "Đang kiểm tra quota…"
    : mailQuota && Number.isFinite(mailQuota.remaining)
      ? mailQuota.dailyLimit
        ? `${mailQuota.remaining} / ${mailQuota.dailyLimit} còn lại`
        : `${mailQuota.remaining} lượt còn lại`
      : quotaError || "Quota chưa có dữ liệu";

  return createPortal(
    <div className="fixed inset-0 z-[100000] bg-slate-950/45 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-4 overscroll-contain">
      <div className="w-full max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[92dvh] rounded-none sm:rounded-[2rem] bg-white border-0 sm:border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">✉️ Mail Center</div>
              <div className="text-lg sm:text-xl font-black text-slate-900 mt-1 leading-tight">Chọn mẫu thư và xem trước trước khi gửi</div>
              <div className="text-xs sm:text-sm text-slate-500 mt-1 break-all">
                Người nhận: <strong className="text-slate-800">{email}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={loadMailQuota}
              disabled={quotaLoading}
              title={mailQuota?.checkedAt ? `Kiểm tra lúc ${new Date(mailQuota.checkedAt).toLocaleString("vi-VN")}` : quotaError || "Kiểm tra quota Gmail gửi thư"}
              className={`shrink-0 self-start rounded-2xl border px-3.5 py-2.5 text-left transition-all ${quotaError ? "border-amber-200 bg-amber-50 text-amber-800" : "border-violet-200 bg-white/85 text-violet-700 hover:border-violet-300"}`}
            >
              <div className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">Gmail gửi thư · quota</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs sm:text-sm font-black whitespace-nowrap">
                <span>{quotaLoading ? "⏳" : quotaError ? "⚠️" : "✉️"}</span>
                <span>{quotaText}</span>
                {!quotaLoading && <span className="text-[11px] opacity-60">↻</span>}
              </div>
              {mailQuota?.senderEmail && (
                <div className="mt-1 max-w-[220px] truncate text-[10px] font-bold opacity-65">{mailQuota.senderEmail}</div>
              )}
            </button>
          </div>
        </div>

        <div
          ref={contentScrollRef}
          className="grid grid-cols-1 lg:grid-cols-[1.05fr_.95fr] min-h-0 flex-1 overflow-y-auto lg:overflow-hidden overscroll-contain"
        >
          <div className="p-4 sm:p-5 overflow-visible lg:overflow-y-auto border-b lg:border-b-0 lg:border-r border-slate-100">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {TEMPLATES.map((item) => {
                const active = item.id === template;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onTemplateChange(item.id)}
                    className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all ${active ? `${item.activeClass} shadow-sm` : "border-slate-200 bg-white hover:border-violet-200"}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="text-xl">{item.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-black text-sm text-slate-900">{item.title}</div>
                        <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">{item.description}</div>
                      </div>
                      <div className={`mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${active ? "border-violet-600" : "border-slate-300"}`}>
                        {active && <div className="w-2.5 h-2.5 bg-violet-600 rounded-full" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 sm:p-5 overflow-visible lg:overflow-y-auto bg-slate-50/70">
            <div className="text-[11px] font-black tracking-wider uppercase text-slate-500 mb-2">Bản xem trước email</div>
            <div className="rounded-[1.6rem] overflow-hidden border border-slate-200 bg-white shadow-lg">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="text-lg font-black tracking-wide text-violet-600">DUCHI LOCKET</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Thông báo từ hệ thống</div>
              </div>
              <div className="p-5">
                <div className="text-[11px] font-black tracking-wider text-violet-600">{selected.badge}</div>
                <div className="text-xl font-black text-slate-900 mt-2 leading-tight">{selected.previewTitle}</div>
                <p className="text-xs text-slate-600 leading-relaxed mt-3">
                  Chào người dùng, đây là nội dung mẫu được gửi tự động từ bộ phận quản trị Duchi Locket tới <strong className="text-slate-900">{email}</strong>.
                </p>
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-500">Trạng thái</div>
                  <div className="mt-1 text-sm font-black text-slate-900">{selected.status}</div>
                </div>
                <button type="button" tabIndex={-1} className="mt-4 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white pointer-events-none">Mở Duchi Locket</button>
                <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">Email tự động từ Duchi Locket. Không yêu cầu mật khẩu, mã OTP hoặc thông tin đăng nhập.</div>
              </div>
            </div>

            <div className="rounded-2xl bg-white border border-slate-200 p-3 mt-3 text-xs text-slate-500 leading-relaxed">
              Mẫu <strong className="text-slate-700">Xin lỗi khóa nhầm</strong> và <strong className="text-slate-700">Xác nhận đã mở khóa</strong> chỉ nên gửi sau khi tài khoản đã được mở khóa. Các mẫu cảnh báo/bảo trì/sự cố/chào mừng/tính năng mới có thể gửi độc lập.
            </div>
          </div>
        </div>

        <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-slate-100 bg-white flex items-center justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="btn h-10 px-4 rounded-xl bg-white text-slate-700 border border-slate-200 font-bold"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            className="btn h-10 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white border-0 font-black min-w-[150px]"
          >
            {sending ? <span className="loading loading-spinner loading-xs" /> : <span>✉️ Gửi thư này</span>}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
