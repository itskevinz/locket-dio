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

    const findAdminNavRow = () => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const usersTab = buttons.find((button) =>
        String(button.textContent || "").includes("Người dùng & Phân quyền"),
      );

      if (!cancelled && usersTab?.parentElement) {
        setAdminNavRow(usersTab.parentElement);
        return true;
      }
      return false;
    };

    if (findAdminNavRow()) return undefined;

    const observer = new MutationObserver(() => {
      if (findAdminNavRow()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const timer = window.setTimeout(() => observer.disconnect(), 10000);
    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <>
      <AdminUsers />

      {adminNavRow &&
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
