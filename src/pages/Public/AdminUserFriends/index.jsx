import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundSearch,
  Users,
} from "lucide-react";
import {
  adminRequest,
  getAdminRoleInfo,
  hasAdminSession,
  hasShortAdminSession,
} from "@/services/AdminAuthService";

const ALLOWED_ROLES = new Set(["super_admin", "admin"]);

function userLabel(user) {
  return (
    user?.displayName ||
    user?.display_name ||
    user?.username ||
    user?.email ||
    user?.uid ||
    "Người dùng"
  );
}

function initialFor(user) {
  return String(userLabel(user)).trim().charAt(0).toUpperCase() || "?";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("vi-VN");
}

function friendLoadError(error) {
  if (
    error?.code === "USER_BACKGROUND_SESSION_UNAVAILABLE" ||
    error?.code === "USER_BACKGROUND_SESSION_INVALID" ||
    error?.code === "USER_BACKGROUND_SESSION_MISMATCH"
  ) {
    return {
      title: "Chưa có phiên Locket nền để đọc",
      message:
        "User này chưa có phiên Locket nền hợp lệ hoặc phiên đã hết hạn. Hãy để user đăng nhập lại Locket để hệ thống tạo hoặc cập nhật phiên nền.",
    };
  }
  if (error?.code === "ADMIN_SESSION_EXPIRED" || error?.status === 401) {
    return {
      title: "Phiên Admin đã khóa",
      message:
        "Hãy quay lại Trạm Quản trị và xác minh PIN/2FA rồi mở lại mục này.",
    };
  }
  if (error?.status === 403) {
    return {
      title: "Không đủ quyền",
      message: "Chỉ Admin hoặc Super Admin mới được xem danh sách bạn bè Locket của user.",
    };
  }
  return {
    title: "Không thể tải danh sách bạn bè",
    message: error?.message || "Locket hoặc API đang tạm thời không phản hồi.",
  };
}

export default function AdminUserFriends() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [role, setRole] = useState("user");
  const [permissionError, setPermissionError] = useState("");

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");

  const [selectedUser, setSelectedUser] = useState(null);
  const [friends, setFriends] = useState([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState(null);
  const [nextPageToken, setNextPageToken] = useState(null);

  const canView = ALLOWED_ROLES.has(role) && hasShortAdminSession();

  const loadUsers = useCallback(async (search = "") => {
    setUsersLoading(true);
    setUsersError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      const normalized = String(search || "").trim();
      if (normalized) params.set("search", normalized);
      const data = await adminRequest(`/users?${params.toString()}`);
      setUsers(data?.users || []);
    } catch (error) {
      setUsers([]);
      setUsersError(error?.message || "Không thể tải danh sách user.");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!hasAdminSession()) {
      navigate("/login", { replace: true });
      return;
    }

    let active = true;
    getAdminRoleInfo()
      .then((info) => {
        if (!active) return;
        const nextRole = String(info?.role || "user");
        setRole(nextRole);
        if (!info?.isAdmin || !ALLOWED_ROLES.has(nextRole)) {
          setPermissionError("Chỉ Admin hoặc Super Admin mới được dùng công cụ này.");
          return;
        }
        if (!hasShortAdminSession()) {
          setPermissionError(
            "Cần mở khóa Trạm Quản trị bằng PIN/2FA trước khi xem bạn bè của user.",
          );
          return;
        }
        loadUsers();
      })
      .catch((error) => {
        if (!active) return;
        setPermissionError(error?.message || "Không thể xác minh quyền Admin.");
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, [loadUsers, navigate]);

  const loadFriendPage = useCallback(
    async (user, pageToken = null, append = false) => {
      if (!user?.uid || friendsLoading) return;
      setSelectedUser(user);
      setFriendsLoading(true);
      setFriendsError(null);
      if (!append) {
        setFriends([]);
        setNextPageToken(null);
      }

      try {
        const params = new URLSearchParams({ limit: "30" });
        if (pageToken) params.set("pageToken", pageToken);
        const data = await adminRequest(
          `/users/${encodeURIComponent(user.uid)}/friends?${params.toString()}`,
        );
        const incoming = Array.isArray(data?.friends) ? data.friends : [];
        setFriends((current) => (append ? [...current, ...incoming] : incoming));
        setNextPageToken(data?.nextPageToken || null);
        if (data?.user) {
          setSelectedUser((current) => ({ ...current, ...data.user }));
        }
      } catch (error) {
        setFriendsError(friendLoadError(error));
        if (error?.code === "ADMIN_SESSION_EXPIRED") {
          setPermissionError(
            "Phiên Admin đã hết hạn. Hãy quay lại Trạm Quản trị để xác minh PIN/2FA.",
          );
        }
      } finally {
        setFriendsLoading(false);
      }
    },
    [friendsLoading],
  );

  const filteredUsers = useMemo(() => users, [users]);

  if (checking) {
    return (
      <div className="min-h-screen pt-28 flex items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600 font-bold">
          <span className="loading loading-spinner loading-md text-indigo-600" />
          Đang xác minh quyền Admin...
        </div>
      </div>
    );
  }

  if (!canView || permissionError) {
    return (
      <div className="min-h-screen bg-slate-50 pt-28 px-4">
        <div className="max-w-xl mx-auto bg-white border border-amber-200 rounded-3xl p-7 shadow-lg">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
            <ShieldCheck size={28} />
          </div>
          <h1 className="text-xl font-black text-slate-900">Công cụ Admin đang được khóa</h1>
          <p className="mt-2 text-sm text-slate-600 font-medium leading-relaxed">
            {permissionError || "Cần phiên Admin đặc quyền đang hoạt động."}
          </p>
          <button
            type="button"
            onClick={() => navigate("/admin/users")}
            className="btn mt-5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white border-0 font-black px-5"
          >
            <ArrowLeft size={16} /> Mở Trạm Quản trị
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/40 to-blue-50 pt-24 pb-16 px-3 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="bg-white/95 border border-indigo-200 rounded-[2rem] p-5 sm:p-7 shadow-lg">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div>
              <button
                type="button"
                onClick={() => navigate("/admin/users")}
                className="inline-flex items-center gap-1.5 text-xs font-black text-indigo-600 hover:text-indigo-800 mb-3"
              >
                <ArrowLeft size={15} /> Trạm Quản trị
              </button>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-blue-600 text-white flex items-center justify-center shadow-md">
                  <Users size={24} />
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-widest font-black text-indigo-600">
                    Admin · Locket Friend Inspector
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
                    Danh sách bạn bè của user
                  </h1>
                </div>
              </div>
              <p className="text-sm text-slate-600 font-medium mt-3 max-w-3xl">
                Đọc danh sách bạn bè Locket thật bằng phiên Locket nền được lưu an toàn khi user đăng nhập. Mỗi lần xem được ghi vào Audit Log.
              </p>
            </div>

            <form
              className="flex gap-2 w-full lg:w-auto lg:min-w-[430px]"
              onSubmit={(event) => {
                event.preventDefault();
                loadUsers(query);
              }}
            >
              <div className="relative flex-1">
                <Search
                  size={17}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Tên, email, username hoặc UID..."
                  className="input input-bordered w-full h-12 pl-10 rounded-2xl bg-slate-50 border-slate-200 focus:border-indigo-500 text-sm font-semibold"
                />
              </div>
              <button
                type="submit"
                disabled={usersLoading}
                className="btn h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white border-0 px-5 font-black"
              >
                {usersLoading ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <UserRoundSearch size={18} />
                )}
                Tìm user
              </button>
            </form>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)] gap-6 items-start">
          <section className="bg-white border border-slate-200 rounded-[2rem] shadow-md overflow-hidden lg:sticky lg:top-24">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-black text-slate-900">Chọn user</h2>
                <p className="text-xs text-slate-500 font-semibold mt-0.5">
                  {filteredUsers.length} kết quả
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadUsers(query)}
                disabled={usersLoading}
                className="btn btn-sm btn-ghost rounded-xl text-indigo-600"
                title="Làm mới danh sách user"
              >
                <RefreshCw size={17} className={usersLoading ? "animate-spin" : ""} />
              </button>
            </div>

            <div className="max-h-[68vh] overflow-y-auto p-3 space-y-2">
              {usersError ? (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold">
                  {usersError}
                </div>
              ) : usersLoading && users.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-bold text-sm">
                  <span className="loading loading-spinner loading-md text-indigo-600 block mx-auto mb-3" />
                  Đang tải user...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-bold text-sm">
                  Không tìm thấy user phù hợp.
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const active = selectedUser?.uid === user.uid;
                  return (
                    <button
                      type="button"
                      key={user.uid}
                      onClick={() => loadFriendPage(user)}
                      className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center gap-3 ${
                        active
                          ? "bg-indigo-50 border-indigo-400 shadow-sm"
                          : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                      }`}
                    >
                      {user.photoURL ? (
                        <img
                          src={user.photoURL}
                          alt=""
                          className="w-11 h-11 rounded-full object-cover border border-slate-200 shrink-0"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-black shrink-0">
                          {initialFor(user)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-black text-sm text-slate-900 truncate">
                          {userLabel(user)}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                          {user.email || user.username || user.uid}
                        </div>
                      </div>
                      <ChevronRight size={17} className="text-slate-400 shrink-0" />
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-[2rem] shadow-md min-h-[520px] overflow-hidden">
            {!selectedUser ? (
              <div className="min-h-[520px] flex flex-col items-center justify-center text-center px-6">
                <div className="w-20 h-20 rounded-[1.8rem] bg-indigo-50 border border-indigo-200 text-indigo-500 flex items-center justify-center mb-4">
                  <Users size={36} />
                </div>
                <h2 className="text-xl font-black text-slate-900">Chọn một user để xem bạn bè</h2>
                <p className="text-sm text-slate-500 font-medium mt-2 max-w-md">
                  Chỉ dữ liệu Locket thật được trả về. Không có phiên nền hợp lệ thì hệ thống sẽ không giả lập kết quả.
                </p>
              </div>
            ) : (
              <>
                <div className="p-5 sm:p-6 border-b border-slate-200 bg-gradient-to-r from-indigo-50/80 to-blue-50/60">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      {selectedUser.photoURL ? (
                        <img
                          src={selectedUser.photoURL}
                          alt=""
                          className="w-14 h-14 rounded-full object-cover border-2 border-white shadow-sm shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xl font-black shrink-0">
                          {initialFor(selectedUser)}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-lg font-black text-slate-900 truncate">
                          {userLabel(selectedUser)}
                        </div>
                        <div className="text-xs text-slate-500 font-mono truncate">
                          {selectedUser.email || selectedUser.username || selectedUser.uid}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate mt-1">
                          UID: {selectedUser.uid}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="badge h-8 px-3 rounded-xl bg-indigo-100 text-indigo-700 border-indigo-200 font-black">
                        Đã tải {friends.length} bạn
                      </span>
                      <button
                        type="button"
                        onClick={() => loadFriendPage(selectedUser)}
                        disabled={friendsLoading}
                        className="btn btn-sm rounded-xl bg-white hover:bg-indigo-50 border-slate-200 text-indigo-700 font-black"
                      >
                        <RefreshCw size={15} className={friendsLoading ? "animate-spin" : ""} />
                        Làm mới
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-4 sm:p-6">
                  {friendsError ? (
                    <div className="rounded-3xl p-6 bg-amber-50 border border-amber-200 text-amber-950">
                      <div className="flex items-start gap-3">
                        <ShieldCheck size={24} className="text-amber-600 shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-black text-base">{friendsError.title}</h3>
                          <p className="text-sm font-medium text-amber-900/80 mt-1 leading-relaxed">
                            {friendsError.message}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : friendsLoading && friends.length === 0 ? (
                    <div className="py-20 text-center text-slate-500 font-bold">
                      <span className="loading loading-spinner loading-lg text-indigo-600 block mx-auto mb-4" />
                      Đang đọc danh sách bạn bè trực tiếp từ Locket...
                    </div>
                  ) : friends.length === 0 ? (
                    <div className="py-20 text-center text-slate-400 font-bold">
                      User này hiện không có bạn bè trong dữ liệu Locket trả về.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {friends.map((friend, index) => (
                        <article
                          key={`${friend.uid}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-indigo-50/50 hover:border-indigo-300 p-3.5 transition-all"
                        >
                          <div className="flex items-center gap-3">
                            {friend.avatar ? (
                              <img
                                src={friend.avatar}
                                alt=""
                                className="w-12 h-12 rounded-full object-cover bg-white border border-slate-200 shrink-0"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded-full bg-white border border-slate-200 text-indigo-600 flex items-center justify-center font-black shrink-0">
                                {initialFor(friend)}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="font-black text-sm text-slate-900 truncate flex items-center gap-1.5">
                                <span className="truncate">{userLabel(friend)}</span>
                                {friend.celebrity && (
                                  <span className="badge badge-xs bg-amber-50 text-amber-700 border-amber-200 font-black shrink-0">
                                    CELEB
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-indigo-600 font-semibold truncate mt-0.5">
                                {friend.username ? `@${friend.username}` : "Chưa có username"}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 pt-2.5 border-t border-slate-200 space-y-1 text-[10px] text-slate-500 font-mono">
                            <div className="truncate" title={friend.uid}>UID: {friend.uid}</div>
                            <div>Thêm bạn: {formatDate(friend.addedAt)}</div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  {nextPageToken && !friendsError && (
                    <div className="mt-6 flex justify-center">
                      <button
                        type="button"
                        onClick={() =>
                          loadFriendPage(selectedUser, nextPageToken, true)
                        }
                        disabled={friendsLoading}
                        className="btn rounded-2xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200 font-black px-7"
                      >
                        {friendsLoading ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <Users size={17} />
                        )}
                        Tải thêm bạn bè
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
