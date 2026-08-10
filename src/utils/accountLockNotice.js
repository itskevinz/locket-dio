export const ACCOUNT_LOCK_NOTICE_KEY = "huy_account_lock_notice_v1";
export const ACCOUNT_LOCK_NOTICE_EVENT = "huy-account-lock-notice";

export function normalizeAccountLockNotice(input = {}) {
  return {
    reason: String(input?.reason || "Không có lý do chi tiết từ Quản Trị Viên.").trim(),
    lockedAt: input?.lockedAt || null,
  };
}

export function readAccountLockNotice() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_LOCK_NOTICE_KEY);
    if (!raw) return null;
    return normalizeAccountLockNotice(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveAccountLockNotice(input = {}) {
  if (typeof window === "undefined") return null;
  const notice = normalizeAccountLockNotice(input);
  try {
    window.sessionStorage.setItem(ACCOUNT_LOCK_NOTICE_KEY, JSON.stringify(notice));
  } catch {
    /* sessionStorage may be unavailable in privacy mode */
  }
  try {
    window.dispatchEvent(new CustomEvent(ACCOUNT_LOCK_NOTICE_EVENT, { detail: notice }));
  } catch {
    /* optional same-tab event */
  }
  return notice;
}

export function clearAccountLockNotice() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ACCOUNT_LOCK_NOTICE_KEY);
  } catch {
    /* ignore */
  }
}
