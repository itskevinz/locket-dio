import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  GitCommitHorizontal,
  HeartPulse,
  ImageOff,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { adminRequest } from "@/services/AdminAuthService";
import { SonnerSuccess, SonnerWarning } from "@/components/uikit/SonnerToast";
import AdminMailCenter from "./AdminMailCenter";

const TABS = [
  ["deploy", "Deploy & Rollback", GitCommitHorizontal],
  ["media", "Media Health", ImageOff],
  ["mail", "Mail Center", Mail],
  ["audit", "Audit Timeline", Activity],
];

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function short(value) {
  return String(value || "").slice(0, 8) || "—";
}

function getDetail(item) {
  if (!item) return "";
  if (typeof item.details === "string") return item.details;
  if (item.details && typeof item.details === "object") {
    try {
      return JSON.stringify(item.details);
    } catch {
      return String(item.details);
    }
  }
  return item.action_title || item.actionTitle || "";
}

export default function AdminOpsSuite() {
  const [active, setActive] = useState("deploy");
  const [loading, setLoading] = useState(false);
  const [deployments, setDeployments] = useState(null);
  const [mailHistory, setMailHistory] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [mediaErrors, setMediaErrors] = useState([]);
  const [search, setSearch] = useState("");
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [rollbackConfirm, setRollbackConfirm] = useState("");
  const [rollingBack, setRollingBack] = useState(false);
  const [testingEmail, setTestingEmail] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const [deployRes, mailRes, auditRes, mediaRes] = await Promise.allSettled([
        adminRequest("/deployments"),
        adminRequest("/mail-history?limit=100"),
        adminRequest("/audit-logs?limit=200"),
        adminRequest("/user-actions?actionType=MEDIA_ERROR&limit=200"),
      ]);
      if (deployRes.status === "fulfilled") setDeployments(deployRes.value);
      if (mailRes.status === "fulfilled") setMailHistory(mailRes.value?.items || []);
      if (auditRes.status === "fulfilled") setAuditLogs(auditRes.value?.logs || []);
      if (mediaRes.status === "fulfilled") setMediaErrors(mediaRes.value?.actions || []);
    } catch (error) {
      SonnerWarning("Không tải đủ dữ liệu vận hành", error?.message || "Hãy thử lại sau.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load({ quiet: true }), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const filteredAudit = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return auditLogs;
    return auditLogs.filter((item) =>
      [item.action, item.admin_uid, item.adminUid, item.target_uid, item.targetUid, item.details]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [auditLogs, search]);

  const filteredMedia = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return mediaErrors;
    return mediaErrors.filter((item) =>
      [item.user_uid, item.uid, item.user_email, item.action_title, getDetail(item)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q)),
    );
  }, [mediaErrors, search]);

  const failedMediaUsers = useMemo(() => {
    const set = new Set();
    mediaErrors.forEach((item) => set.add(item.user_uid || item.uid || item.user_email || "unknown"));
    return set.size;
  }, [mediaErrors]);

  const handleRollback = async () => {
    if (!rollbackTarget?.sha || rollingBack) return;
    if (rollbackConfirm.trim().toUpperCase() !== "ROLLBACK") {
      SonnerWarning("Chưa xác nhận rollback", "Nhập đúng ROLLBACK để tránh bấm nhầm.");
      return;
    }
    setRollingBack(true);
    try {
      const result = await adminRequest("/deployments/rollback", {
        method: "POST",
        body: JSON.stringify({ sha: rollbackTarget.sha, confirmation: "ROLLBACK" }),
      });
      SonnerSuccess(
        "Đã phát lệnh rollback",
        result?.backupBranch
          ? `Đã tạo nhánh dự phòng ${result.backupBranch}. Vercel và Railway sẽ tự deploy commit ${short(rollbackTarget.sha)}.`
          : `Main đã ở commit ${short(rollbackTarget.sha)}.`,
      );
      setRollbackTarget(null);
      setRollbackConfirm("");
      setTimeout(() => load(), 1500);
    } catch (error) {
      SonnerWarning("Rollback chưa thực hiện được", error?.message || "Không thể rollback.");
    } finally {
      setRollingBack(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    try {
      const result = await adminRequest("/system/test-email", { method: "POST" });
      SonnerSuccess("Gmail hoạt động", `Email kiểm tra đã gửi tới ${result?.email || "Admin"}.`);
      load({ quiet: true });
    } catch (error) {
      SonnerWarning("Test Gmail thất bại", error?.message || "Kiểm tra cấu hình Gmail trên Railway.");
    } finally {
      setTestingEmail(false);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-4 pb-8 text-base-content">
      <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100/95 shadow-xl">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <HeartPulse size={23} className="text-primary" />
                <h2 className="text-xl font-black">Admin Operations Suite</h2>
                <span className="badge badge-success badge-sm">6 nâng cấp</span>
              </div>
              <p className="mt-1 max-w-3xl text-sm text-base-content/60">
                Mail Center, Safety/Undo, System Health, rollback, Media Health và Audit Timeline trong một khu vực quản trị.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => load()} disabled={loading}>
                <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Làm mới
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={handleTestEmail} disabled={testingEmail}>
                {testingEmail ? <span className="loading loading-spinner loading-xs" /> : <Send size={14} />}
                Test Gmail
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                className={`btn btn-sm rounded-xl ${active === id ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setActive(id)}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </header>

        {active === "deploy" && (
          <div className="p-4 sm:p-6">
            <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
                <div className="text-xs text-base-content/50">Commit backend hiện tại</div>
                <div className="mt-1 font-mono text-lg font-black">{short(deployments?.currentSha)}</div>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
                <div className="text-xs text-base-content/50">Repository</div>
                <div className="mt-1 truncate font-semibold">{deployments?.repo || "—"}</div>
              </div>
              <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
                <div className="text-xs text-base-content/50">Rollback 1 nút</div>
                <div className={`mt-1 flex items-center gap-2 font-semibold ${deployments?.rollbackConfigured ? "text-success" : "text-warning"}`}>
                  {deployments?.rollbackConfigured ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
                  {deployments?.rollbackConfigured ? "Đã cấu hình" : "Cần GITHUB_ADMIN_TOKEN"}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-base-300">
              <table className="table table-sm">
                <thead><tr><th>Commit</th><th>Nội dung</th><th>Tác giả</th><th>Thời gian</th><th /></tr></thead>
                <tbody>
                  {(deployments?.commits || []).map((item) => (
                    <tr key={item.sha} className={item.isCurrent ? "bg-success/5" : ""}>
                      <td className="font-mono font-bold">{item.shortSha}{item.isCurrent && <span className="badge badge-success badge-xs ml-2">CURRENT</span>}</td>
                      <td className="max-w-md truncate" title={item.message}>{item.message}</td>
                      <td>{item.author}</td>
                      <td className="whitespace-nowrap text-xs">{formatTime(item.date)}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="btn btn-xs btn-outline"
                          disabled={item.isCurrent || !deployments?.rollbackConfigured}
                          onClick={() => { setRollbackTarget(item); setRollbackConfirm(""); }}
                        >
                          <RotateCcw size={12} /> Khôi phục
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!deployments?.rollbackConfigured && (
              <div className="mt-3 rounded-2xl border border-warning/25 bg-warning/5 p-3 text-xs text-warning">
                Danh sách commit vẫn xem được. Để nút rollback hoạt động, thêm biến bí mật <b>GITHUB_ADMIN_TOKEN</b> trên Railway API với quyền Contents: Read & Write. Token không bao giờ được trả về trình duyệt.
              </div>
            )}
          </div>
        )}

        {active === "media" && (
          <div className="p-4 sm:p-6">
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-error/20 bg-error/5 p-4"><div className="text-xs text-base-content/50">Lỗi media gần đây</div><div className="mt-1 text-2xl font-black text-error">{mediaErrors.length}</div></div>
              <div className="rounded-2xl border border-warning/20 bg-warning/5 p-4"><div className="text-xs text-base-content/50">User bị ảnh hưởng</div><div className="mt-1 text-2xl font-black text-warning">{failedMediaUsers}</div></div>
              <div className="rounded-2xl border border-success/20 bg-success/5 p-4"><div className="text-xs text-base-content/50">Self-heal phía client</div><div className="mt-1 flex items-center gap-2 font-bold text-success"><ShieldCheck size={17} /> Alternate host + refetch</div></div>
            </div>
            <div className="relative mb-3 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input className="input input-bordered input-sm w-full pl-9" placeholder="Tìm UID, email, moment..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="max-h-[520px] space-y-2 overflow-y-auto">
              {filteredMedia.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-base-300 p-10 text-center text-sm text-base-content/50">Chưa ghi nhận lỗi media sau bản nâng cấp.</div>
              ) : filteredMedia.map((item) => (
                <article key={item.id || `${item.created_at}-${item.user_uid}`} className="rounded-2xl border border-base-300 bg-base-200/30 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge badge-error badge-xs">MEDIA_ERROR</span><span className="font-semibold">{item.user_email || item.user_uid || "Không rõ user"}</span><span className="ml-auto text-base-content/45">{formatTime(item.created_at || item.createdAt)}</span></div>
                  <div className="mt-1 text-sm font-semibold">{item.action_title || item.actionTitle || "Media không tải được"}</div>
                  <div className="mt-1 break-all text-xs text-base-content/60">{getDetail(item)}</div>
                </article>
              ))}
            </div>
          </div>
        )}

        {active === "mail" && (
          <AdminMailCenter history={mailHistory} onSent={() => load({ quiet: true })} />
        )}

        {active === "audit" && (
          <div className="p-4 sm:p-6">
            <div className="relative mb-3 max-w-md">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40" />
              <input className="input input-bordered input-sm w-full pl-9" placeholder="Tìm UID, Admin, hành động..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="relative ml-2 max-h-[620px] overflow-y-auto border-l-2 border-base-300 pl-5">
              {filteredAudit.map((item) => (
                <article key={item.id || `${item.created_at}-${item.action}`} className="relative mb-4 rounded-2xl border border-base-300 bg-base-200/25 p-3">
                  <span className={`absolute -left-[29px] top-4 h-3 w-3 rounded-full ring-4 ring-base-100 ${item.status === "failure" ? "bg-error" : "bg-primary"}`} />
                  <div className="flex flex-wrap items-center gap-2"><span className="badge badge-primary badge-sm font-mono">{item.action || "ACTION"}</span><span className="text-xs text-base-content/50"><Clock3 size={12} className="inline mr-1" />{formatTime(item.created_at || item.createdAt)}</span></div>
                  <div className="mt-2 text-sm font-semibold">{item.details || "Không có mô tả"}</div>
                  <div className="mt-1 text-[11px] text-base-content/50">Admin: {item.admin_uid || item.adminUid || "—"} • Target: {item.target_uid || item.targetUid || "—"} • IP: {item.ip_address || item.ipAddress || "—"}</div>
                </article>
              ))}
            </div>
          </div>
        )}
      </div>

      {rollbackTarget && (
        <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl bg-base-100 p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-error"><TriangleAlert size={22} /><h3 className="text-lg font-black">Rollback production</h3></div>
            <p className="mt-2 text-sm text-base-content/65">Main sẽ được đưa về commit <b className="font-mono">{rollbackTarget.shortSha}</b>. Hệ thống tự tạo một nhánh backup của HEAD hiện tại trước khi đổi main.</p>
            <div className="mt-3 rounded-xl bg-base-200/60 p-3 text-sm font-semibold">{rollbackTarget.message}</div>
            <label className="form-control mt-4"><span className="label-text mb-1 text-xs font-bold">Nhập ROLLBACK để xác nhận</span><input className="input input-bordered" value={rollbackConfirm} onChange={(e) => setRollbackConfirm(e.target.value)} autoFocus /></label>
            <div className="mt-5 flex justify-end gap-2"><button className="btn btn-ghost" onClick={() => setRollbackTarget(null)} disabled={rollingBack}>Hủy</button><button className="btn btn-error" onClick={handleRollback} disabled={rollingBack || rollbackConfirm.trim().toUpperCase() !== "ROLLBACK"}>{rollingBack ? <span className="loading loading-spinner loading-xs" /> : <RotateCcw size={15} />} Rollback</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
