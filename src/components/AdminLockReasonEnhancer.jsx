import { useEffect } from "react";

const COMMON_LOCK_REASONS = [
  "Vi phạm điều khoản / quy định sử dụng Huy Locket",
  "Hoạt động bất thường, nghi ngờ bot hoặc tool tự động",
  "Spam hoặc lạm dụng tính năng",
  "Gian lận, giả mạo hoặc lạm dụng tài khoản",
  "Rủi ro bảo mật / nghi ngờ truy cập trái phép",
  "Tạm khóa để kiểm tra và xác minh tài khoản",
];

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

function enhanceLockModal(modal) {
  if (!modal || modal.dataset.lockReasonEnhanced === "1") return;
  const actionType = [...modal.querySelectorAll("strong")]
    .map((node) => String(node.textContent || "").trim().toLowerCase())
    .find((text) => text === "lock" || text === "unlock" || text === "revoke" || text === "role" || text === "nuke");
  if (actionType !== "lock") return;

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

export default function AdminLockReasonEnhancer() {
  useEffect(() => {
    let scheduled = false;
    const scan = () => {
      scheduled = false;
      document.querySelectorAll(".modal.modal-open").forEach(enhanceLockModal);
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

  return null;
}
