import { useEffect, useState } from "react";
import {
  ACCOUNT_LOCK_NOTICE_EVENT,
  clearAccountLockNotice,
  readAccountLockNotice,
} from "@/utils/accountLockNotice";

function formatLockedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("vi-VN");
}

export default function AccountLockNotice() {
  const [notice, setNotice] = useState(() => readAccountLockNotice());

  useEffect(() => {
    const onNotice = (event) => {
      setNotice(event?.detail || readAccountLockNotice());
    };
    window.addEventListener(ACCOUNT_LOCK_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(ACCOUNT_LOCK_NOTICE_EVENT, onNotice);
  }, []);

  if (!notice) return null;
  const lockedAt = formatLockedAt(notice.lockedAt);

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="account-lock-notice-title"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-[2rem] border border-rose-300/70 bg-base-100 text-base-content shadow-2xl">
        <div className="bg-gradient-to-r from-rose-600 via-red-600 to-orange-500 px-6 py-5 text-white">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-3xl shadow-inner">
              🔒
            </div>
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-100">Huy Locket Security</div>
              <h2 id="account-lock-notice-title" className="mt-1 text-2xl font-black">Tài khoản đã bị khóa</h2>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <p className="text-sm font-semibold leading-relaxed text-base-content/80">
            Tài khoản Huy Locket của bạn đã bị Quản Trị Viên khóa quyền truy cập. Bạn sẽ không thể tiếp tục sử dụng các tính năng của web cho đến khi tài khoản được mở khóa.
          </p>

          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-950 shadow-inner">
            <div className="mb-1 text-[11px] font-black uppercase tracking-wider text-rose-600">Lý do khóa tài khoản</div>
            <p className="break-words text-sm font-extrabold leading-relaxed">{notice.reason}</p>
          </div>

          {lockedAt && (
            <div className="text-xs font-semibold text-base-content/60">
              Thời gian khóa: <strong className="text-base-content/80">{lockedAt}</strong>
            </div>
          )}

          <p className="rounded-2xl border border-base-300 bg-base-200/60 p-3 text-xs font-medium leading-relaxed text-base-content/70">
            Nếu bạn cho rằng tài khoản bị khóa nhầm, hãy liên hệ Quản Trị Viên Huy Locket để được kiểm tra và xem xét mở khóa.
          </p>

          <button
            type="button"
            className="btn h-12 w-full rounded-2xl border-0 bg-gradient-to-r from-rose-600 to-red-600 font-black text-white shadow-md hover:from-rose-500 hover:to-red-500"
            onClick={() => {
              clearAccountLockNotice();
              setNotice(null);
            }}
          >
            Đã hiểu
          </button>
        </div>
      </div>
    </div>
  );
}