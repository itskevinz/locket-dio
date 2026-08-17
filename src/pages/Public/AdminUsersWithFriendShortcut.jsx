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
        className="fixed right-3 sm:right-6 bottom-4 sm:bottom-6 z-[85] w-[calc(100vw-1.5rem)] sm:w-[330px] text-left rounded-2xl border border-indigo-300 bg-white/95 backdrop-blur-xl shadow-2xl hover:-translate-y-0.5 hover:border-indigo-500 transition-all p-3.5 group"
        title="Xem danh sách bạn bè Locket của user"
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md shrink-0">
            <Users size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-indigo-600">
              <ShieldCheck size={12} /> Admin / Super Admin
            </div>
            <div className="font-black text-slate-900 text-sm mt-0.5">
              Bạn bè Locket của user
            </div>
            <div className="text-[11px] text-slate-500 font-semibold mt-0.5 truncate">
              Chọn user → xem danh sách bạn bè thật
            </div>
          </div>
          <ChevronRight
            size={19}
            className="text-indigo-500 group-hover:translate-x-0.5 transition-transform shrink-0"
          />
        </div>
      </button>
    </>
  );
}
