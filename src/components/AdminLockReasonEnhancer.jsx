import { useEffect, useState } from "react";
import { adminRequest } from "@/services/AdminAuthService";
import { SonnerSuccess, SonnerWarning } from "@/components/uikit/SonnerToast";

const COMMON_LOCK_REASONS = [
  "Vi phạm điều khoản / quy định sử dụng Huy Locket",
  "Hoạt động bất thường, nghi ngờ bot hoặc tool tự động",
  "Spam hoặc lạm dụng tính năng",
  "Gian lận, giả mạo hoặc lạm dụng tài khoản",
  "Rủi ro bảo mật / nghi ngờ truy cập trái phép",
  "Tạm khóa để kiểm tra và xác minh tài khoản",
];

const DANGEROUS_ACTIONS = new Set(["lock", "revoke", "role", "nuke"]);

function setReactTextareaValue(textarea, value) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(textarea, value);
  else textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new Event("change", { bubbles: true }));
}

function detectActionType(modal) {
  return [...modal.querySelectorAll("strong")]
    .map((node) => String(node.textContent || "").trim().toLowerCase())
    .find((text) => ["lock", "unlock", "revoke", "role", "nuke"].includes(text));
}

function enhanceLockReasons(modal, actionType) {
  if (actionType !== "lock" || modal.dataset.lockReasonEnhanced === "1") return;
  const textarea = modal.querySelector("textarea");
  if (!textarea) return;
  const field = textarea.closest(".form-control") || textarea.parentElement;
  if (!field) return;

  modal.dataset.lockReasonEnhanced = "1";
  textarea.placeholder = "Chọn một lý do phổ biến phía trên hoặc tự nhập lý do khóa tại đây...";

  const label = field.querySelector("label span");
  if (label) label.textContent = "LÝ DO KHÓA — SẼ THÔNG BÁO CHO NGƯỜI DÙNG:";

  const wrapper = document.createElement("div");
  wrapper.className = "admin-lock-reason-enhancer mb-3 space-y-2";

  const hint = document.createElement("div");
  hint.className = "text-xs font-semibold text-base-content/70";
  hint.textContent = "Chọn lý do phổ biến hoặc chọn “Khác” để tự nhập. Nội dung cuối cùng trong ô lý do sẽ được hiển thị trực tiếp cho tài khoản bị khóa.";

  const select = document.createElement("select");
  select.className = "select select-bordered w-full rounded-2xl h-12 text-sm font-bold border-error/30 focus:border-error bg-base-100";
  select.setAttribute("aria-label", "Chọn lý do khóa tài khoản");

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Chọn lý do khóa phổ biến —";
  select.appendChild(placeholder);

  COMMON_LOCK_REASONS.forEach((reason) => {
    const option = document.createElement("option");
    option.value = reason;
    option.textContent = reason;
    select.appendChild(option);
  });

  const other = document.createElement("option");
  other.value = "__other__";
  other.textContent = "Khác — Tôi sẽ tự nhập lý do";
  select.appendChild(other);

  select.addEventListener("change", () => {
    if (select.value === "__other__") {
      setReactTextareaValue(textarea, "");
      textarea.focus();
      return;
    }
    if (select.value) {
      setReactTextareaValue(textarea, select.value);
      textarea.focus();
    }
  });

  wrapper.appendChild(hint);
  wrapper.appendChild(select);
  field.insertBefore(wrapper, textarea);
}

function extractTarget(modal) {
  const text = String(modal.textContent || "");
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  if (email) return email;
  const uid = text.match(/(?:UID\s*:?\s*)#?([A-Za-z0-9_-]{6,})/i)?.[1];
  return uid || "XAC NHAN";
}

function enhanceSafetyConfirmation(modal, actionType) {
  if (!DANGEROUS_ACTIONS.has(actionType) || modal.dataset.adminSafetyEnhanced === "1") return;
  modal.dataset.adminSafetyEnhanced = "1";

  const target = extractTarget(modal);
  window.__adminSafetyConfirmation = { actionType, target, value: "" };

  const textarea = modal.querySelector("textarea");
  const anchor = textarea?.closest(".form-control") || textarea?.parentElement || modal.querySelector(".modal-action") || modal.lastElementChild;
  if (!anchor?.parentElement) return;

  const box = document.createElement("div");
  box.className = "admin-safety-confirmation mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-slate-800";

  const title = document.createElement("div");
  title.className = "text-xs font-black uppercase tracking-wider text-amber-800";
  title.textContent = "🛡️ Admin Safety Mode — xác nhận chống bấm nhầm";

  const detail = document.createElement("div");
  detail.className = "mt-1 text-xs leading-relaxed text-slate-600";
  detail.innerHTML = `Kiểm tra lại đúng người dùng rồi nhập chính xác <strong class="text-slate-900 break-all"></strong> để tiếp tục. Các thao tác khóa/đổi quyền có thể hoàn tác trong khoảng 30 giây.`;
  detail.querySelector("strong").textContent = target;

  const input = document.createElement("input");
  input.type = "text";
  input.autocomplete = "off";
  input.className = "input input-bordered w-full mt-3 rounded-xl h-11 bg-white font-mono text-sm";
  input.placeholder = target;
  input.setAttribute("aria-label", "Xác nhận người dùng mục tiêu");
  input.addEventListener("input", () => {
    window.__adminSafetyConfirmation = { actionType, target, value: input.value.trim() };
  });

  box.appendChild(title);
  box.appendChild(detail);
  box.appendChild(input);
  anchor.parentElement.insertBefore(box, anchor.nextSibling);
}

function enhanceModal(modal) {
  if (!modal) return;
  const actionType = detectActionType(modal);
  if (!actionType) return;
  enhanceLockReasons(modal, actionType);
  enhanceSafetyConfirmation(modal, actionType);
}

export default function AdminLockReasonEnhancer() {
  const [undo, setUndo] = useState(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    const onUndoAvailable = (event) => {
      const detail = event?.detail || null;
      if (!detail?.undoToken || !detail?.undoUntil) return;
      setUndo({ ...detail, receivedAt: Date.now() });
    };
    window.addEventListener("admin_action_undo_available", onUndoAvailable);
    return () => window.removeEventListener("admin_action_undo_available", onUndoAvailable);
  }, []);

  useEffect(() => {
    if (!undo?.undoUntil) return undefined;
    const delay = Math.max(0, Number(undo.undoUntil) - Date.now());
    const timer = window.setTimeout(() => setUndo(null), delay + 200);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    let scheduled = false;
    const scan = () => {
      scheduled = false;
      const modals = document.querySelectorAll(".modal.modal-open");
      modals.forEach(enhanceModal);
      if (modals.length === 0) window.__adminSafetyConfirmation = null;
    };
    const scheduleScan = () => {
      if (scheduled) return;
      scheduled = true;
      window.requestAnimationFrame(scan);
    };

    scheduleScan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const handleUndo = async () => {
    if (!undo?.undoToken || undoing) return;
    setUndoing(true);
    try {
      const result = await adminRequest(`/undo/${encodeURIComponent(undo.undoToken)}`, { method: "POST" });
      SonnerSuccess("Đã hoàn tác thao tác quản trị", result?.message || "Trạng thái trước đó đã được khôi phục.");
      setUndo(null);
      window.dispatchEvent(new Event("admin_action_undone"));
      window.dispatchEvent(new Event("locket_admin_users_refresh"));
    } catch (error) {
      SonnerWarning("Không thể hoàn tác", error?.message || "Thời gian hoàn tác có thể đã hết.");
    } finally {
      setUndoing(false);
    }
  };

  return undo ? (
    <div className="fixed bottom-5 left-1/2 z-[12000] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 rounded-2xl border border-amber-300 bg-white p-4 shadow-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-wider text-amber-700">🛡️ Safety Mode · Có thể hoàn tác</div>
          <div className="mt-1 text-sm font-bold text-slate-900">{undo.message || "Thao tác quản trị vừa được thực hiện."}</div>
          <div className="mt-1 text-[11px] text-slate-500">Hết hạn: {new Date(Number(undo.undoUntil)).toLocaleTimeString("vi-VN")}</div>
        </div>
        <button type="button" className="btn btn-warning btn-sm shrink-0 font-black" onClick={handleUndo} disabled={undoing}>
          {undoing ? <span className="loading loading-spinner loading-xs" /> : "↩ Hoàn tác"}
        </button>
      </div>
    </div>
  ) : null;
}