import { ChevronRight, ShieldCheck, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AdminUsers from "./AdminUsers";

export default function AdminUsersWithFriendShortcut() {
  const navigate = useNavigate();

  return (
    <>
      <AdminUsers />

      <button
        type="button"
        onClick={() => navigate("/admin/user-friends")}
        className="fixed right-3 sm:right-6 top-[76px] sm:top-[92px] z-[95] max-w-[calc(100vw-1.5rem)] sm:w-[320px] text-left rounded-2xl border-2 border-indigo-400 bg-white/95 backdrop-blur-xl shadow-2xl shadow-indigo-500/20 hover:-translate-y-0.5 hover:border-indigo-600 hover:shadow-indigo-500/30 active:scale-[0.98] transition-all p-3 group"
        title="Xem danh sách bạn bè Locket của user"
      >
        <div className="flex items-center gap-3">
          <div className="relative w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 via-violet-600 to-blue-500 text-white flex items-center justify-center shadow-lg shrink-0">
            <Users size={21} />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-indigo-600">
              <ShieldCheck size={12} /> Công cụ Admin
            </div>
            <div className="font-black text-slate-900 text-sm sm:text-[15px] mt-0.5">
              Bạn bè Locket của user
            </div>
            <div className="text-[10px] sm:text-[11px] text-slate-500 font-semibold mt-0.5 truncate">
              Chọn user → xem danh sách bạn bè thật
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-indigo-50 text-indigo-700 px-2 py-1.5 font-black text-[10px] shrink-0 group-hover:bg-indigo-100">
            MỞ
            <ChevronRight
              size={15}
              className="group-hover:translate-x-0.5 transition-transform"
            />
          </div>
        </div>
      </button>
    </>
  );
}
