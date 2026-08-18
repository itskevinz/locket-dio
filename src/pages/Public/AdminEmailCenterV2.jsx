import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Link2,
  LockKeyhole,
  Mail,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  TestTube2,
  Unplug,
} from "lucide-react";
import { SonnerSuccess, SonnerWarning } from "@/components/uikit/SonnerToast";
import {
  adminRequest,
  getAdminRoleInfo,
  hasAdminSession,
  hasShortAdminSession,
} from "@/services/AdminAuthService";

const FALLBACK_TEMPLATES = [
  { id: "apology", label: "Xin lỗi khóa nhầm", badge: "XIN LỖI", title: "Tài khoản của bạn đã bị khóa nhầm" },
  { id: "restored", label: "Xác nhận đã mở khóa", badge: "KHÔI PHỤC", title: "Tài khoản của bạn đã được mở khóa" },
  { id: "warning", label: "Cảnh báo tài khoản", badge: "CẢNH BÁO", title: "Tài khoản của bạn cần được chú ý" },
  { id: "maintenance", label: "Thông báo bảo trì", badge: "BẢO TRÌ", title: "Duchi Locket sắp thực hiện bảo trì" },
  { id: "incident", label: "Thông báo sự cố", badge: "SỰ CỐ", title: "Chúng tôi đang xử lý một sự cố hệ thống" },
  { id: "welcome", label: "Chào mừng người dùng", badge: "CHÀO MỪNG", title: "Chào mừng bạn đến với Duchi Locket" },
  { id: "feature", label: "Thông báo tính năng mới", badge: "TÍNH NĂNG MỚI", title: "Duchi Locket vừa được nâng cấp" },
];

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function extractEmail(value) {
  const match = String(value || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0] || "—";
}

function historyActionLabel(action) {
  const labels = {
    SEND_ADMIN_MAIL: "Gửi thư quản trị",
    SEND_ACCOUNT_APOLOGY_EMAIL: "Gửi thư người dùng",
    TEST_ADMIN_EMAIL: "Gửi mail kiểm tra",
  };
  return labels[action] || action || "Email hệ thống";
}

export default function AdminEmailCenterV2() {
  const navigate = useNavigate();
  const [authorized, setAuthorized] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [role, setRole] = useState("user");

  const [status, setStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [templates, setTemplates] = useState(FALLBACK_TEMPLATES);
  const [template, setTemplate] = useState("apology");
  const [targetEmail, setTargetEmail] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  const handleAuthFailure = useCallback((error) => {
    if (error?.status === 401 || error?.code === "ADMIN_SESSION_EXPIRED" || error?.code === "FRESH_AUTH_REQUIRED") {
      SonnerWarning("Cần xác minh lại Admin", "Phiên quản trị đã hết hạn. Hãy nhập lại mã PIN.");
      navigate("/admin/users", { replace: true });
      return true;
    }
    return false;
  }, [navigate]);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError("");
    try {
      const result = await adminRequest("/mail-quota");
      setStatus(result);
    } catch (error) {
      if (!handleAuthFailure(error)) {
        setStatus(null);
        setStatusError(error?.message || "Không đọc được trạng thái Gmail API.");
      }
    } finally {
      setStatusLoading(false);
    }
  }, [handleAuthFailure]);

  const loadTemplates = useCallback(async () => {
    try {
      const result = await adminRequest("/mail-templates");
      if (Array.isArray(result?.templates) && result.templates.length) setTemplates(result.templates);
    } catch (error) {
      if (!handleAuthFailure(error)) setTemplates(FALLBACK_TEMPLATES);
    }
  }, [handleAuthFailure]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const result = await adminRequest("/mail-history?limit=100");
      setHistory(Array.isArray(result?.items) ? result.items : []);
    } catch (error) {
      if (!handleAuthFailure(error)) setHistoryError(error?.message || "Không tải được lịch sử gửi thư.");
    } finally {
      setHistoryLoading(false);
    }
  }, [handleAuthFailure]);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([loadStatus(), loadTemplates(), loadHistory()]);
  }, [loadHistory, loadStatus, loadTemplates]);

  useEffect(() => {
    let active = true;
    const verify = async () => {
      if (!hasAdminSession()) {
        navigate("/login", { replace: true });
        return;
      }
      try {
        const info = await getAdminRoleInfo();
        if (!active) return;
        if (!info?.isAdmin) {
          navigate("/locket", { replace: true });
          return;
        }
        if (!hasShortAdminSession()) {
          SonnerWarning("Trang Email cần phiên Admin", "Hãy mở khóa trạm Admin trước khi quản lý email.");
          navigate("/admin/users", { replace: true });
          return;
        }
        setAdminEmail(info.email || "");
        setRole(info.role || "admin");
        setAuthorized(true);
      } catch {
        if (active) navigate("/admin/users", { replace: true });
      }
    };
    verify();
    return () => { active = false; };
  }, [navigate]);

  useEffect(() => {
    if (!authorized) return;
    refreshAll();
  }, [authorized, refreshAll]);

  useEffect(() => {
    if (!authorized || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (!gmail) return;
    if (gmail === "connected") {
      SonnerSuccess("Gmail API đã kết nối", "OAuth đã được lưu an toàn trên server. Hệ thống sẵn sàng gửi thư.");
      refreshAll();
    } else if (gmail === "error") {
      SonnerWarning("Kết nối Gmail thất bại", "Hãy thử kết nối lại tài khoản Gmail gửi thư.");
    }
    params.delete("gmail");
    const query = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }, [authorized, refreshAll]);

  useEffect(() => {
    if (!authorized) return undefined;
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await adminRequest("/mail-preview", {
          method: "POST",
          body: JSON.stringify({
            email: targetEmail.trim() || "preview@example.com",
            template,
            customMessage: customMessage.trim(),
          }),
        });
        setPreview(result?.preview || null);
      } catch (error) {
        if (!handleAuthFailure(error)) setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 220);
    return () => window.clearTimeout(timer);
  }, [authorized, customMessage, handleAuthFailure, targetEmail, template]);

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === template) || FALLBACK_TEMPLATES[0],
    [template, templates],
  );

  const usagePercent = useMemo(() => {
    const sent = Number(status?.sentToday);
    const limit = Number(status?.dailyLimit);
    if (!Number.isFinite(sent) || !Number.isFinite(limit) || limit <= 0) return 0;
    return Math.max(0, Math.min(100, (sent / limit) * 100));
  }, [status]);

  const filteredHistory = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    if (!query) return history;
    return history.filter((item) => [item.action, item.details, item.status, item.admin_uid, item.target_uid]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query));
  }, [history, historySearch]);

  const connectGmail = async () => {
    setConnecting(true);
    try {
      const result = await adminRequest("/gmail-oauth-start");
      if (!result?.url) throw new Error("Google OAuth không trả URL kết nối.");
      window.location.assign(result.url);
    } catch (error) {
      setConnecting(false);
      if (!handleAuthFailure(error)) SonnerWarning("Không mở được Google", error?.message || "Không bắt đầu được Gmail OAuth.");
    }
  };

  const disconnectGmail = async () => {
    if (!window.confirm("Ngắt Gmail khỏi Duchi Locket? Hệ thống sẽ không gửi được email cho tới khi kết nối lại.")) return;
    setDisconnecting(true);
    try {
      await adminRequest("/gmail-disconnect", { method: "POST", body: JSON.stringify({}) });
      SonnerSuccess("Đã ngắt Gmail", "Refresh token Gmail đã được xóa khỏi server.");
      await loadStatus();
    } catch (error) {
      if (!handleAuthFailure(error)) SonnerWarning("Không ngắt được Gmail", error?.message || "Thử lại sau.");
    } finally {
      setDisconnecting(false);
    }
  };

  const sendMail = async () => {
    const email = targetEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      SonnerWarning("Email không hợp lệ", "Nhập đúng email người dùng cần gửi thư.");
      return;
    }
    if (!status?.connected) {
      SonnerWarning("Chưa kết nối Gmail", "Kết nối Gmail API trước khi gửi thư.");
      return;
    }
    setSending(true);
    try {
      const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await adminRequest("/apology-email", {
        method: "POST",
        body: JSON.stringify({
          email,
          template,
          customMessage: customMessage.trim(),
          requestId,
        }),
      });
      SonnerSuccess("Đã gửi thư", `${selectedTemplate?.label || "Email"} đã được gửi tới ${result?.email || email} qua Gmail API.`);
      await Promise.allSettled([loadStatus(), loadHistory()]);
    } catch (error) {
      if (!handleAuthFailure(error)) SonnerWarning("Không gửi được thư", error?.message || "Gmail API từ chối gửi thư.");
    } finally {
      setSending(false);
    }
  };

  const sendTestMail = async () => {
    if (!status?.connected) {
      SonnerWarning("Chưa kết nối Gmail", "Kết nối Gmail API trước khi gửi mail test.");
      return;
    }
    setTesting(true);
    try {
      const result = await adminRequest("/system/test-email", { method: "POST", body: JSON.stringify({}) });
      SonnerSuccess("Mail test đã gửi", `Đã gửi qua ${result?.provider || "Gmail API"} tới ${result?.email || adminEmail}.`);
      await Promise.allSettled([loadStatus(), loadHistory()]);
    } catch (error) {
      if (!handleAuthFailure(error)) SonnerWarning("Mail test thất bại", error?.message || "Không thể gửi email kiểm tra.");
    } finally {
      setTesting(false);
    }
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-slate-50 pt-28 flex items-start justify-center px-4">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-5 shadow-sm text-sm font-bold text-slate-600">Đang kiểm tra quyền quản trị…</div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50/40 to-blue-50/70 text-slate-800 pt-24 pb-20 px-3 sm:px-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[2rem] border border-violet-200/70 bg-white/95 p-5 sm:p-7 shadow-[0_18px_55px_-20px_rgba(76,29,149,.2)] backdrop-blur-xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-violet-500/20 shrink-0"><Mail size={24} /></div>
              <div>
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-600">Duchi Locket · Gmail API</div>
                <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-slate-950">Trung tâm Quản lý Email</h1>
                <p className="mt-1 text-sm text-slate-500">OAuth 2.0, gửi thư trực tiếp qua Gmail API, ngưỡng an toàn và lịch sử trong một nơi.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!status?.connected && (
                <button type="button" onClick={connectGmail} disabled={connecting} className="btn h-11 rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 font-black px-4">
                  <Link2 size={16} /> {connecting ? "Đang mở Google…" : "Kết nối Gmail"}
                </button>
              )}
              <button type="button" onClick={refreshAll} disabled={statusLoading || historyLoading} className="btn h-11 rounded-2xl border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 font-black px-4">
                <RefreshCw size={16} className={(statusLoading || historyLoading) ? "animate-spin" : ""} /> Làm mới
              </button>
              <button type="button" onClick={() => navigate("/admin/users")} className="btn h-11 rounded-2xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-black px-4">
                <ArrowLeft size={16} /> Quay lại Admin
              </button>
            </div>
          </div>
        </section>

        {!statusLoading && status && !status.connected && (
          <section className="rounded-3xl border border-violet-200 bg-violet-50 p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="font-black text-violet-950">Cần kết nối Gmail một lần</div>
              <p className="mt-1 text-sm leading-relaxed text-violet-800">Duchi Locket sẽ xin đúng quyền gửi thư Gmail. Refresh token được mã hóa ở backend; frontend không nhận token.</p>
            </div>
            <button type="button" onClick={connectGmail} disabled={connecting} className="btn rounded-2xl border-0 bg-violet-600 text-white hover:bg-violet-700 font-black shrink-0">
              <ShieldCheck size={17} /> {connecting ? "Đang chuyển tới Google…" : "Kết nối Gmail API"}
            </button>
          </section>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-3xl border border-violet-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-wider text-violet-700">Email đang gửi</div><Mail size={18} className="text-violet-600" /></div>
            <div className="mt-3 text-base font-black text-slate-900 break-all">{status?.senderEmail || (status?.connected ? "Đã kết nối" : "Chưa kết nối")}</div>
            <div className="mt-1 text-xs text-slate-500">Tài khoản Gmail được ủy quyền OAuth 2.0</div>
          </div>

          <div className="rounded-3xl border border-blue-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-wider text-blue-700">Ngưỡng gửi an toàn</div><Server size={18} className="text-blue-600" /></div>
            <div className="mt-3 text-2xl font-black text-slate-900">{statusLoading ? "…" : Number.isFinite(Number(status?.sentToday)) ? Number(status.sentToday) : "—"}<span className="text-sm text-slate-400"> / {Number.isFinite(Number(status?.dailyLimit)) ? status.dailyLimit : "—"}</span></div>
            <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all" style={{ width: `${usagePercent}%` }} /></div>
            <div className="mt-2 text-xs text-slate-500">Đã gửi hôm nay • còn {Number.isFinite(Number(status?.remaining)) ? status.remaining : "—"} theo ngưỡng nội bộ.</div>
          </div>

          <div className="rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-wider text-emerald-700">Kết nối</div><ShieldCheck size={18} className="text-emerald-600" /></div>
            <div className="mt-3 flex items-center gap-2 text-base font-black text-slate-900">{status?.connected ? <CheckCircle2 size={18} className="text-emerald-600" /> : <AlertTriangle size={18} className="text-amber-500" />}{status?.connected ? "Gmail API hoạt động" : "Chưa kết nối Gmail"}</div>
            <div className="mt-1 text-xs text-slate-500">Provider: {status?.provider || "gmail-api"}</div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3"><div className="text-xs font-black uppercase tracking-wider text-slate-600">Bảo mật</div><LockKeyhole size={18} className="text-slate-500" /></div>
            <div className="mt-3 text-sm font-black text-slate-900">{formatDateTime(status?.checkedAt)}</div>
            <div className="mt-1 text-xs text-slate-500">Scope: gmail.send • token mã hóa server-side</div>
          </div>
        </section>

        {statusError && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><strong>Không đọc được Gmail API:</strong> {statusError}</div></div>
        )}

        <section className="grid grid-cols-1 xl:grid-cols-[1.02fr_.98fr] gap-5">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div><div className="text-xs font-black uppercase tracking-wider text-violet-700">Soạn thư</div><h2 className="mt-1 text-xl font-black text-slate-950">Gửi email tới người dùng</h2></div>
              <button type="button" onClick={sendTestMail} disabled={testing || !status?.connected} className="btn btn-sm rounded-xl border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 font-bold"><TestTube2 size={15} /> {testing ? "Đang test…" : "Gửi mail test"}</button>
            </div>

            <label className="text-xs font-black uppercase tracking-wide text-slate-600">Email người nhận</label>
            <input type="email" value={targetEmail} onChange={(event) => setTargetEmail(event.target.value)} placeholder="Nhập email người dùng Huy Locket..." className="input input-bordered mt-2 w-full h-12 rounded-2xl bg-slate-50 border-slate-200 focus:border-violet-500" />

            <div className="mt-5 text-xs font-black uppercase tracking-wide text-slate-600">Mẫu thư</div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {templates.map((item) => {
                const active = item.id === template;
                return (
                  <button key={item.id} type="button" onClick={() => setTemplate(item.id)} className={`rounded-2xl border-2 p-3 text-left transition-all ${active ? "border-violet-500 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:border-violet-200"}`}>
                    <div className="flex items-center justify-between gap-2"><strong className="text-sm text-slate-900">{item.label}</strong><span className={`w-3 h-3 rounded-full ${active ? "bg-violet-600" : "bg-slate-200"}`} /></div>
                    <div className="mt-1 text-[11px] text-slate-500 line-clamp-2">{item.title || item.subject || item.badge}</div>
                  </button>
                );
              })}
            </div>

            <label className="mt-5 block text-xs font-black uppercase tracking-wide text-slate-600">Lời nhắn thêm (không bắt buộc)</label>
            <textarea value={customMessage} onChange={(event) => setCustomMessage(event.target.value.slice(0, 2500))} rows={4} placeholder="Nội dung bổ sung từ quản trị viên..." className="textarea textarea-bordered mt-2 w-full rounded-2xl bg-slate-50 border-slate-200 focus:border-violet-500 text-sm" />
            <div className="mt-1 text-right text-[11px] text-slate-400">{customMessage.length}/2500</div>

            <button type="button" onClick={sendMail} disabled={sending || !targetEmail.trim() || !status?.connected} className="btn mt-4 w-full h-12 rounded-2xl border-0 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-black shadow-lg shadow-violet-500/20 disabled:bg-slate-200 disabled:text-slate-400"><Send size={17} /> {sending ? "Đang gửi…" : `Gửi qua Gmail API: ${selectedTemplate?.label || "Email"}`}</button>
            {!status?.connected && <p className="mt-3 text-xs text-amber-700">Cần kết nối Gmail API trước khi gửi thư.</p>}
          </div>

          <div className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6 shadow-sm min-h-[580px] flex flex-col">
            <div className="flex items-center justify-between gap-3 mb-4"><div><div className="text-xs font-black uppercase tracking-wider text-slate-500">Xem trước</div><h2 className="mt-1 text-xl font-black text-slate-950">Email thực tế</h2></div>{previewLoading && <span className="loading loading-spinner loading-sm text-violet-600" />}</div>
            {preview?.html ? <iframe title="Xem trước email Duchi Locket" sandbox="" srcDoc={preview.html} className="w-full flex-1 min-h-[500px] rounded-2xl border border-slate-200 bg-slate-50" /> : <div className="flex-1 min-h-[500px] rounded-2xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center p-6 text-center text-sm text-slate-500">Chọn mẫu thư để tải bản xem trước từ hệ thống.</div>}
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div><div className="text-xs font-black uppercase tracking-wider text-slate-500">Lịch sử</div><h2 className="mt-1 text-xl font-black text-slate-950">Hoạt động gửi email</h2></div>
            <div className="relative w-full sm:w-80"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Tìm email, action, trạng thái..." className="input input-bordered w-full h-10 rounded-xl pl-9 bg-slate-50 border-slate-200 text-sm" /></div>
          </div>
          {historyError && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{historyError}</div>}
          <div className="mt-4 overflow-x-auto">
            <table className="table table-sm min-w-[760px]">
              <thead><tr className="text-xs uppercase text-slate-500"><th>Thời gian</th><th>Hoạt động</th><th>Email</th><th>Trạng thái</th><th>Admin</th></tr></thead>
              <tbody>
                {historyLoading ? <tr><td colSpan={5} className="py-8 text-center text-slate-400">Đang tải lịch sử…</td></tr> : filteredHistory.length ? filteredHistory.map((item, index) => (
                  <tr key={item.id || `${item.created_at}-${index}`}><td className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(item.created_at || item.createdAt || item.timestamp)}</td><td className="font-bold text-slate-800">{historyActionLabel(item.action)}</td><td className="text-xs">{extractEmail(item.details)}</td><td><span className={`badge badge-sm ${String(item.status).toLowerCase() === "failure" ? "badge-error" : "badge-success"}`}>{item.status || "success"}</span></td><td className="text-xs text-slate-500">{item.admin_uid || item.adminUid || role}</td></tr>
                )) : <tr><td colSpan={5} className="py-8 text-center text-slate-400">Chưa có hoạt động gửi thư phù hợp.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>

        {status?.connected && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-xs text-slate-500"><strong className="text-slate-700">Gmail OAuth:</strong> refresh token chỉ được lưu dạng mã hóa trong database; frontend không nhận token hay client secret.</div>
            <button type="button" onClick={disconnectGmail} disabled={disconnecting} className="btn btn-sm rounded-xl border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 font-bold shrink-0"><Unplug size={14} /> {disconnecting ? "Đang ngắt…" : "Ngắt Gmail"}</button>
          </section>
        )}
      </div>
    </main>
  );
}
