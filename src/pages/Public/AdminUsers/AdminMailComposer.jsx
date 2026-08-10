export default function AdminMailComposer({
  open,
  email,
  template,
  sending,
  onTemplateChange,
  onClose,
  onSend,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10000] bg-slate-950/45 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-[2rem] bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-indigo-50">
          <div className="text-xs font-black uppercase tracking-[0.16em] text-violet-600">✉️ Gửi thư</div>
          <div className="text-xl font-black text-slate-900 mt-1">Chọn mẫu thư cần gửi</div>
          <div className="text-sm text-slate-500 mt-1 break-all">
            Người nhận: <strong className="text-slate-800">{email}</strong>
          </div>
        </div>

        <div className="p-6 space-y-3">
          <button
            type="button"
            onClick={() => onTemplateChange("apology")}
            className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${template === "apology" ? "border-violet-500 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:border-violet-200"}`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">🙏</div>
              <div className="min-w-0">
                <div className="font-black text-slate-900">Xin lỗi khóa nhầm</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Dùng khi Admin lỡ khóa nhầm tài khoản. Thư xác nhận đã kiểm tra, mở khóa và xin lỗi người dùng.
                </div>
              </div>
              <div className={`ml-auto mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${template === "apology" ? "border-violet-600" : "border-slate-300"}`}>
                {template === "apology" && <div className="w-2.5 h-2.5 bg-violet-600 rounded-full" />}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onTemplateChange("restored")}
            className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${template === "restored" ? "border-emerald-500 bg-emerald-50 shadow-sm" : "border-slate-200 bg-white hover:border-emerald-200"}`}
          >
            <div className="flex items-start gap-3">
              <div className="text-2xl">✅</div>
              <div className="min-w-0">
                <div className="font-black text-slate-900">Xác nhận đã mở khóa</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Thông báo tài khoản đã được khôi phục và có thể sử dụng Duchi Locket bình thường.
                </div>
              </div>
              <div className={`ml-auto mt-1 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${template === "restored" ? "border-emerald-600" : "border-slate-300"}`}>
                {template === "restored" && <div className="w-2.5 h-2.5 bg-emerald-600 rounded-full" />}
              </div>
            </div>
          </button>

          <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3 text-xs text-slate-500 leading-relaxed">
            Email vẫn dùng giao diện HTML Duchi Locket như thông báo Canh Slot. Hệ thống chỉ cho gửi thư khôi phục khi tài khoản đã được mở khóa.
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2">
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
            className="btn h-10 px-5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white border-0 font-black min-w-[130px]"
          >
            {sending ? <span className="loading loading-spinner loading-xs" /> : <span>✉️ Gửi thư này</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
