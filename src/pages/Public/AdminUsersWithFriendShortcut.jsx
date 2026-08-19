// Restored pre-mobile admin layout.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Mail, UsersRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AdminUsers from "./AdminUsers";

export default function AdminUsersWithFriendShortcut() {
  const navigate = useNavigate();
  const [adminNavRow, setAdminNavRow] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;

    const syncAdminNavRow = () => {
      if (cancelled) return;

      const buttons = Array.from(document.querySelectorAll("button"));
      const usersTab = buttons.find((button) =>
        String(button.textContent || "").includes("Người dùng & Phân quyền"),
      );
      const nextRow = usersTab?.parentElement || null;

      setAdminNavRow((current) => {
        if (current === nextRow) return current;
        return nextRow;
      });
    };

    // AdminUsers có thể render lại cả hàng tab khi dữ liệu/role thay đổi.
    // Luôn theo dõi DOM thay vì dừng observer sau lần tìm đầu tiên; nếu node cũ
    // bị React thay thế thì portal sẽ tự gắn sang hàng tab mới ngay lập tức.
    const scheduleSync = () => {
      if (cancelled || rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        syncAdminNavRow();
      });
    };

    syncAdminNavRow();

    const observer = new MutationObserver(scheduleSync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <>
      <AdminUsers />

      {adminNavRow?.isConnected &&
        createPortal(
          <>
            <button
              type="button"
              onClick={() => navigate("/admin/mail")}
              className="flex items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50/90 px-5 py-3 font-black text-violet-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-100 hover:shadow-md active:scale-[0.98]"
              title="Quản lý Gmail gửi thư, quota, mẫu thư và lịch sử gửi"
            >
              <Mail size={18} className="text-violet-600" />
              <span>Quản lý Email</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/admin/user-friends")}
              className="flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50/90 px-5 py-3 font-black text-indigo-900 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-100 hover:shadow-md active:scale-[0.98]"
              title="Chọn user và xem danh sách bạn bè Locket"
            >
              <UsersRound size={18} className="text-indigo-600" />
              <span>Bạn bè Locket của user</span>
            </button>
          </>,
          adminNavRow,
        )}
    </>
  );
}
