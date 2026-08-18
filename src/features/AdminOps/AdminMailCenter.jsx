import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Mail,
  Monitor,
  RefreshCw,
  Send,
  Smartphone,
  Sparkles,
  UserRound,
} from "lucide-react";
import { adminRequest } from "@/services/AdminAuthService";
import {
  SonnerSuccess,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";

const DEFAULT_TEMPLATE = "welcome";

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function makeRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `mail-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function AdminMailCenter({ history = [], onSent }) {
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [uid, setUid] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewMode, setPreviewMode] = useState("mobile");
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [activePane, setActivePane] = useState("compose");

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === template) || null,
    [template, templates],
  );

  const loadTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const result = await adminRequest("/mail-templates");
      const rows = Array.isArray(result?.templates) ? result.templates : [];
      setTemplates(rows);
      if (rows.length && !rows.some((item) => item.id === template)) {
        setTemplate(rows[0].id);
      }
    } catch (error) {
      SonnerWarning(
        "Không tải được mẫu thư",
        error?.message || "Hãy thử lại sau.",
      );
    } finally {
      setLoadingTemplates(false);
    }
  }, [template]);

  const loadPreview = useCallback(async () => {
    setLoadingPreview(true);
    try {
      const result = await adminRequest("/mail-preview", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim() || "preview@example.com",
          displayName: displayName.trim() || "Người dùng",
          uid: uid.trim(),
          template,
          customMessage: customMessage.trim(),
        }),
      });
      setPreview(result?.preview || null);
    } catch (error) {
      setPreview(null);
      SonnerWarning(
        "Không tạo được bản xem trước",
        error?.message || "Hãy thử lại sau.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }, [customMessage, displayName, email, template, uid]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadPreview();
    }, 320);
    return () => window.clearTimeout(timer);
  }, [loadPreview]);

  const sendMail = async () => {
    const target = email.trim().toLowerCase();
    if (!target) {
      SonnerWarning("Chưa có người nhận", "Nhập email tài khoản cần gửi thư.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      SonnerWarning("Email chưa hợp lệ", "Kiểm tra lại địa chỉ người nhận.");
      return;
    }

    setSending(true);
    try {
      const result = await adminRequest("/apology-email", {
        method: "POST",
        body: JSON.stringify({
          email: target,
          template,
          customMessage: customMessage.trim(),
          requestId: makeRequestId(),
        }),
      });
      SonnerSuccess(
        result?.deduped ? "Thư đã được xử lý trước đó" : "Đã gửi thư",
        `${selectedTemplate?.label || "Email"} → ${target}`,
      );
      onSent?.();
      setActivePane("history");
    } catch (error) {
      SonnerWarning(
        "Gửi thư thất bại",
        error?.message || "Gmail chưa xử lý được yêu cầu.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-3 sm:p-5 lg:p-6">
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-base-100 to-secondary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-primary p-3 text-primary-content shadow-sm">
            <Mail size={22} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black">Mail Center</h3>
              <span className="badge badge-primary badge-sm">Gmail</span>
            </div>
            <p className="mt-1 text-sm text-base-content/60">
              Soạn thư, xem đúng giao diện email trước khi gửi và kiểm tra lịch sử trong cùng một nơi.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm self-start"
          onClick={() => {
            loadTemplates();
            loadPreview();
          }}
          disabled={loadingTemplates || loadingPreview}
        >
          <RefreshCw
            size={14}
            className={loadingTemplates || loadingPreview ? "animate-spin" : ""}
          />
          Làm mới
        </button>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 rounded-2xl bg-base-200/55 p-1.5">
        {[
          ["compose", "Soạn thư", FileText],
          ["preview", "Xem trước", Eye],
          ["history", "Lịch sử", Clock3],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            className={`btn btn-sm min-h-10 rounded-xl border-0 ${
              activePane === id ? "btn-primary shadow-sm" : "btn-ghost"
            }`}
            onClick={() => setActivePane(id)}
          >
            <Icon size={15} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {activePane === "compose" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4 rounded-3xl border border-base-300 bg-base-100 p-4 sm:p-5">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                <Sparkles size={16} className="text-primary" /> Chọn mẫu thư
              </div>
              {loadingTemplates && templates.length === 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {[0, 1, 2, 3, 4, 5].map((item) => (
                    <div key={item} className="skeleton h-20 rounded-2xl" />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {templates.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTemplate(item.id)}
                      className={`min-h-20 rounded-2xl border p-3 text-left transition ${
                        template === item.id
                          ? "border-primary bg-primary/10 ring-1 ring-primary/25"
                          : "border-base-300 bg-base-200/25 hover:bg-base-200/60"
                      }`}
                    >
                      <div className="text-[10px] font-black uppercase tracking-wide text-primary">
                        {item.badge}
                      </div>
                      <div className="mt-1 text-xs font-bold leading-snug sm:text-sm">
                        {item.label}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="form-control sm:col-span-2">
                <span className="label-text mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                  <Mail size={13} /> Email người nhận
                </span>
                <input
                  type="email"
                  className="input input-bordered w-full rounded-2xl"
                  placeholder="nguoidung@gmail.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="off"
                />
                <span className="mt-1.5 text-[11px] text-base-content/45">
                  Chỉ gửi được tới tài khoản đã có trong Duchi Locket.
                </span>
              </label>

              <label className="form-control">
                <span className="label-text mb-1.5 flex items-center gap-1.5 text-xs font-bold">
                  <UserRound size={13} /> Tên hiển thị khi preview
                </span>
                <input
                  className="input input-bordered w-full rounded-2xl"
                  placeholder="Người dùng"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>

              <label className="form-control">
                <span className="label-text mb-1.5 text-xs font-bold">UID khi preview</span>
                <input
                  className="input input-bordered w-full rounded-2xl font-mono text-xs"
                  placeholder="Tùy chọn"
                  value={uid}
                  onChange={(event) => setUid(event.target.value)}
                />
              </label>
            </div>

            <label className="form-control">
              <span className="label-text mb-1.5 text-xs font-bold">Tiêu đề</span>
              <div className="rounded-2xl border border-base-300 bg-base-200/35 px-4 py-3 text-sm font-semibold">
                {selectedTemplate?.subject || preview?.subject || "Đang tải mẫu thư..."}
              </div>
            </label>

            <label className="form-control">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="label-text text-xs font-bold">Nội dung bổ sung từ Admin</span>
                <span className="text-[10px] text-base-content/40">
                  {customMessage.length}/2500
                </span>
              </div>
              <textarea
                className="textarea textarea-bordered min-h-32 w-full resize-y rounded-2xl leading-relaxed"
                maxLength={2500}
                placeholder="Có thể để trống. Nội dung này sẽ xuất hiện trong một khung riêng trong email."
                value={customMessage}
                onChange={(event) => setCustomMessage(event.target.value)}
              />
            </label>

            <div className="flex flex-col-reverse gap-2 border-t border-base-300 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="btn btn-ghost rounded-2xl"
                onClick={() => setActivePane("preview")}
              >
                <Eye size={16} /> Xem email trước
              </button>
              <button
                type="button"
                className="btn btn-primary rounded-2xl px-6"
                onClick={sendMail}
                disabled={sending}
              >
                {sending ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <Send size={17} />
                )}
                {sending ? "Đang gửi..." : "Gửi thư"}
              </button>
            </div>
          </div>

          <aside className="h-fit rounded-3xl border border-base-300 bg-base-200/25 p-4">
            <div className="flex items-center gap-2 text-sm font-black">
              <CheckCircle2 size={16} className="text-success" /> Kiểm tra trước khi gửi
            </div>
            <div className="mt-3 space-y-2 text-xs text-base-content/65">
              <div className="rounded-xl bg-base-100 p-3">
                <b>Mẫu:</b> {selectedTemplate?.label || "—"}
              </div>
              <div className="rounded-xl bg-base-100 p-3 break-all">
                <b>Người nhận:</b> {email.trim() || "Chưa nhập"}
              </div>
              <div className="rounded-xl bg-base-100 p-3">
                <b>Nội dung Admin:</b> {customMessage.trim() ? "Có" : "Không"}
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-base-content/45">
              Backend sẽ kiểm tra lại tài khoản, quyền Admin và trạng thái tài khoản trước khi Gmail gửi thật.
            </p>
          </aside>
        </div>
      )}

      {activePane === "preview" && (
        <div className="rounded-3xl border border-base-300 bg-base-200/35 p-3 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div>
              <div className="text-sm font-black">Bản xem trước Gmail</div>
              <div className="mt-0.5 max-w-xl truncate text-xs text-base-content/50">
                {preview?.subject || selectedTemplate?.subject || "Đang tạo preview..."}
              </div>
            </div>
            <div className="ml-auto flex rounded-xl bg-base-100 p-1">
              <button
                type="button"
                className={`btn btn-xs rounded-lg ${previewMode === "mobile" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPreviewMode("mobile")}
              >
                <Smartphone size={13} /> Mobile
              </button>
              <button
                type="button"
                className={`btn btn-xs rounded-lg ${previewMode === "desktop" ? "btn-primary" : "btn-ghost"}`}
                onClick={() => setPreviewMode("desktop")}
              >
                <Monitor size={13} /> Desktop
              </button>
            </div>
          </div>

          <div className="flex min-h-[620px] justify-center overflow-auto rounded-2xl bg-[#eef2f7] p-2 sm:p-4">
            {loadingPreview && !preview?.html ? (
              <div className="flex min-h-96 items-center justify-center text-sm text-slate-500">
                <span className="loading loading-spinner loading-sm mr-2" /> Đang dựng email...
              </div>
            ) : preview?.html ? (
              <div
                className={`overflow-hidden rounded-2xl bg-white shadow-xl transition-all ${
                  previewMode === "mobile" ? "w-[390px] max-w-full" : "w-[720px] max-w-full"
                }`}
              >
                <iframe
                  title="Email preview"
                  srcDoc={preview.html}
                  sandbox=""
                  className="h-[720px] w-full border-0 bg-white"
                />
              </div>
            ) : (
              <div className="flex min-h-96 items-center justify-center text-sm text-slate-500">
                Chưa có bản xem trước.
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            <button type="button" className="btn btn-ghost" onClick={() => setActivePane("compose")}>
              Quay lại soạn
            </button>
            <button type="button" className="btn btn-primary" onClick={sendMail} disabled={sending}>
              {sending ? <span className="loading loading-spinner loading-sm" /> : <Send size={16} />}
              {sending ? "Đang gửi..." : "Gửi email này"}
            </button>
          </div>
        </div>
      )}

      {activePane === "history" && (
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm text-base-content/60">
            <Clock3 size={15} /> Lịch sử lấy từ Audit Log; không lưu mật khẩu, OTP hay token Gmail.
          </div>
          <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {history.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-base-300 p-10 text-center text-sm text-base-content/50">
                Chưa có thư quản trị nào trong lịch sử gần đây.
              </div>
            ) : (
              history.map((item) => (
                <article
                  key={item.id || `${item.created_at}-${item.target_uid}`}
                  className="rounded-2xl border border-base-300 bg-base-100 p-3.5 sm:p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span
                      className={`badge badge-sm ${
                        item.status === "failure" ? "badge-error" : "badge-success"
                      }`}
                    >
                      {item.status === "failure" ? "FAILED" : "SENT"}
                    </span>
                    <span className="font-mono text-[11px]">
                      {item.target_uid || item.targetUid || "—"}
                    </span>
                    <span className="ml-auto text-base-content/45">
                      {formatTime(item.created_at || item.createdAt)}
                    </span>
                  </div>
                  <div className="mt-2 text-sm font-semibold">
                    {item.details || "Admin mail"}
                  </div>
                  <div className="mt-1 text-[11px] text-base-content/45">
                    Admin: {item.admin_uid || item.adminUid || "—"}
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
