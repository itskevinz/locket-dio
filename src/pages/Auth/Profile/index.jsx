import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  BadgeCheck,
  Cake,
  Contact,
  Eye,
  Flame,
  KeyRound,
  LayoutDashboard,
  Mail,
  Phone,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
} from "lucide-react";
import { SonnerInfo, SonnerWarning } from "@/components/uikit/SonnerToast";
import { forgotPassword } from "@/services";
import { useAuthStore } from "@/stores";

const PROFILE_PREFS_KEY = "huy-locket-profile-preferences-v1";

const DEFAULT_PROFILE_PREFS = {
  showGoldBadge: true,
  showCountdown: true,
  shareThirdParty: false,
  splitDisplayName: true,
};

const PROFILE_SECTIONS = [
  {
    id: "overview",
    label: "Tổng quan",
    shortLabel: "Tổng quan",
    description: "Tài khoản và gói",
    icon: LayoutDashboard,
  },
  {
    id: "profile",
    label: "Hồ sơ",
    shortLabel: "Hồ sơ",
    description: "Tên, liên hệ, ngày sinh",
    icon: UserRoundCog,
  },
  {
    id: "privacy",
    label: "Riêng tư & hiển thị",
    shortLabel: "Riêng tư",
    description: "Cách hồ sơ xuất hiện",
    icon: Eye,
  },
  {
    id: "security",
    label: "Bảo mật",
    shortLabel: "Bảo mật",
    description: "Mật khẩu và đăng nhập",
    icon: ShieldCheck,
  },
];

function readProfilePrefs() {
  if (typeof window === "undefined") return DEFAULT_PROFILE_PREFS;
  try {
    return {
      ...DEFAULT_PROFILE_PREFS,
      ...JSON.parse(window.localStorage.getItem(PROFILE_PREFS_KEY) || "{}"),
    };
  } catch {
    return DEFAULT_PROFILE_PREFS;
  }
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 1e12 ? numeric * 1000 : numeric;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function formatDateOnly(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "Không có dữ liệu";
  return new Date(timestamp).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function formatDateTime(value) {
  const timestamp = normalizeTimestamp(value);
  if (!timestamp) return "Không có dữ liệu";
  return new Date(timestamp).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function getBirthdayPart(user, type) {
  const birthday = user?.birthday || user?.birthdate || user?.dateOfBirth;
  if (birthday && typeof birthday === "object") {
    return birthday[type] ?? birthday[type === "day" ? "date" : type] ?? "";
  }
  if (type === "day") {
    return user?.birthDay ?? user?.birthdayDay ?? user?.dayOfBirth ?? "";
  }
  return user?.birthMonth ?? user?.birthdayMonth ?? user?.monthOfBirth ?? "";
}

function getStreak(user) {
  return (
    user?.streakCount ??
    user?.streak_count ??
    user?.streak?.count ??
    user?.streak?.days ??
    null
  );
}

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const userPlan = useAuthStore((s) => s.userPlan);

  const [activeSection, setActiveSection] = useState("overview");
  const [prefs, setPrefs] = useState(readProfilePrefs);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEmail(user?.email ?? "");
    setPhone(user?.phoneNumber ?? "");
    setBirthdayDay(String(getBirthdayPart(user, "day") || ""));
    setBirthdayMonth(String(getBirthdayPart(user, "month") || ""));
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROFILE_PREFS_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const fullName = useMemo(
    () => [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Người dùng",
    [user?.firstName, user?.lastName],
  );

  const initials = useMemo(() => {
    const source = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "HL";
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
  }, [user?.firstName, user?.lastName]);

  const streak = getStreak(user);
  const planName = userPlan?.plan?.name || "Free";
  const isGold =
    String(user?.badge || "").toLowerCase() === "locket_gold" ||
    String(planName).toLowerCase().includes("gold");

  const updatePref = (key) => {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  };

  const showLocketWriteUnavailable = (label) => {
    SonnerInfo(
      `${label} chưa được thay đổi`,
      "Web hiện chưa có API Locket an toàn để ghi mục này lên tài khoản.",
    );
  };

  const handlePasswordReset = async () => {
    if (!user?.email || resettingPassword) {
      if (!user?.email) SonnerWarning("Tài khoản chưa có email để đặt lại mật khẩu.");
      return;
    }

    setResettingPassword(true);
    try {
      await forgotPassword(user.email);
      SonnerInfo(
        "Đã gửi yêu cầu đổi mật khẩu",
        `Kiểm tra hộp thư ${user.email} để tiếp tục.`,
      );
    } catch (error) {
      SonnerWarning(
        "Chưa gửi được email đổi mật khẩu",
        error?.message || "Vui lòng thử lại sau.",
      );
    } finally {
      setResettingPassword(false);
    }
  };

  return (
    <div className="min-h-screen w-full px-3 py-5 text-base-content sm:px-5 lg:px-7">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Hồ sơ</h1>
            <p className="mt-1 text-sm text-base-content/55">
              Mọi cài đặt đã được chia nhóm để dễ tìm hơn.
            </p>
          </div>

          {streak !== null && streak !== undefined && streak !== "" && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning">
              <Flame size={15} fill="currentColor" /> Chuỗi của bạn: {streak}d
            </div>
          )}
        </div>

        <div className="sticky top-[57px] z-20 -mx-3 mb-4 border-y border-base-300 bg-base-100/95 px-3 py-2 backdrop-blur-xl lg:hidden">
          <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {PROFILE_SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`btn btn-sm shrink-0 rounded-full ${
                    active ? "btn-warning" : "btn-ghost bg-base-200/70"
                  }`}
                >
                  <Icon size={15} />
                  {section.shortLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="sticky top-[68px] hidden rounded-2xl border border-base-300 bg-base-200/45 p-2 shadow-sm lg:block">
            <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/40">
              Cài đặt hồ sơ
            </p>
            <div className="space-y-1">
              {PROFILE_SECTIONS.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                      active
                        ? "bg-warning text-warning-content shadow-sm"
                        : "hover:bg-base-300/60"
                    }`}
                  >
                    <Icon size={18} className="shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{section.label}</span>
                      <span
                        className={`mt-0.5 block truncate text-[11px] ${
                          active ? "text-warning-content/70" : "text-base-content/45"
                        }`}
                      >
                        {section.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0">
            {activeSection === "overview" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={LayoutDashboard}
                  title="Tổng quan"
                  description="Thông tin quan trọng nhất của tài khoản và gói đang dùng."
                />

                <ProfileCard icon={Contact} title="Thông tin tài khoản">
                  <div className="flex items-start gap-4">
                    <div className="relative shrink-0">
                      {user?.profilePicture ? (
                        <img
                          src={user.profilePicture}
                          alt={fullName}
                          className="h-20 w-20 rounded-full border-[3px] border-warning object-cover p-0.5"
                          onError={(event) => {
                            event.currentTarget.style.display = "none";
                          }}
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-warning bg-base-300 text-xl font-bold">
                          {initials}
                        </div>
                      )}
                      {isGold && prefs.showGoldBadge && (
                        <span
                          className="absolute -bottom-0.5 -right-0.5 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-base-100 bg-warning px-1 text-warning-content shadow"
                          title="Locket Gold"
                        >
                          <BadgeCheck size={15} fill="currentColor" />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h2 className="truncate text-xl font-bold">{fullName}</h2>
                      <AccountLine
                        label="Username"
                        value={user?.username ? `@${user.username}` : null}
                      />
                      <AccountLine label="Ngày tạo" value={formatDateOnly(user?.createdAt)} />
                      <div className="flex flex-wrap gap-2 pt-1">
                        {isGold && <MiniBadge>Locket Gold</MiniBadge>}
                        <MiniBadge>{planName}</MiniBadge>
                        {user?.emailVerified === true && (
                          <MiniBadge>Đã xác thực email</MiniBadge>
                        )}
                      </div>
                    </div>
                  </div>
                </ProfileCard>

                <ProfileCard icon={BadgeCheck} title="Gói trên web">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile label="Mã người dùng" value={userPlan?.user?.customer_code} />
                    <InfoTile label="Gói hiện tại" value={planName} />
                    <InfoTile
                      label="Ngày bắt đầu"
                      value={formatDateTime(userPlan?.subscription?.start_at)}
                    />
                    <InfoTile
                      label="Ngày hết hạn"
                      value={formatDateTime(userPlan?.subscription?.expires_at)}
                    />
                  </div>
                </ProfileCard>

                <details className="group rounded-2xl border border-base-300 bg-base-200/35 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal size={17} className="text-warning" />
                      <div>
                        <p className="text-sm font-bold">Thông tin nâng cao</p>
                        <p className="mt-0.5 text-xs text-base-content/45">
                          UID, trạng thái xác thực và mốc đồng bộ kỹ thuật.
                        </p>
                      </div>
                    </div>
                    <span className="text-lg text-base-content/40 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-base-300 px-4 py-4 sm:grid-cols-2 sm:px-5">
                    <InfoTile label="UID" value={user?.uid} mono />
                    <InfoTile
                      label="Email xác thực"
                      value={
                        user?.emailVerified === true
                          ? "Đã xác thực"
                          : user?.emailVerified === false
                            ? "Chưa xác thực"
                            : "Không xác định"
                      }
                    />
                    <InfoTile
                      label="Custom Auth"
                      value={user?.customAuth ? "Có" : "Không"}
                    />
                    <InfoTile
                      label="Cập nhật gần nhất"
                      value={formatDateTime(user?.lastRefreshAt)}
                    />
                  </div>
                </details>
              </div>
            )}

            {activeSection === "profile" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={UserRoundCog}
                  title="Hồ sơ"
                  description="Tên hiển thị, thông tin liên hệ và ngày sinh nằm cùng một chỗ."
                />

                <ProfileCard icon={UserRoundCog} title="Tên hiển thị">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tên" value={firstName} onChange={setFirstName} />
                    <Field label="Họ" value={lastName} onChange={setLastName} />
                  </div>

                  <SettingToggle
                    compact
                    title="Thêm dấu cách giữa họ và tên khi hiển thị"
                    description="Chỉ thay đổi cách xem trước tên trên trang hồ sơ của web"
                    checked={prefs.splitDisplayName}
                    onChange={() => updatePref("splitDisplayName")}
                  />

                  <div className="rounded-xl border border-base-300 bg-base-300/35 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/45">
                      Xem trước
                    </p>
                    <p className="mt-1 font-semibold">
                      {prefs.splitDisplayName
                        ? [firstName, lastName].filter(Boolean).join(" ") || "Tên hiển thị"
                        : `${firstName}${lastName}` || "Tên hiển thị"}
                    </p>
                  </div>

                  <ActionButton onClick={() => showLocketWriteUnavailable("Tên hiển thị")}>
                    <Save size={15} /> Lưu tên
                  </ActionButton>
                </ProfileCard>

                <ProfileCard icon={AtSign} title="Thông tin liên hệ">
                  <div className="space-y-3">
                    <div className="flex items-end gap-2">
                      <Field
                        className="flex-1"
                        label="Email"
                        value={email}
                        onChange={setEmail}
                        icon={Mail}
                        type="email"
                      />
                      <ActionButton
                        compact
                        onClick={() => showLocketWriteUnavailable("Email")}
                      >
                        Lưu
                      </ActionButton>
                    </div>

                    <div className="flex items-end gap-2">
                      <Field
                        className="flex-1"
                        label="Số điện thoại"
                        value={phone}
                        onChange={setPhone}
                        icon={Phone}
                        placeholder="Chưa liên kết số điện thoại"
                      />
                      <ActionButton
                        compact
                        onClick={() => showLocketWriteUnavailable("Số điện thoại")}
                      >
                        Lưu
                      </ActionButton>
                    </div>
                  </div>
                </ProfileCard>

                <ProfileCard icon={Cake} title="Ngày sinh">
                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                    <Field
                      label="Ngày"
                      value={birthdayDay}
                      onChange={setBirthdayDay}
                      inputMode="numeric"
                      placeholder="--"
                    />
                    <Field
                      label="Tháng"
                      value={birthdayMonth}
                      onChange={setBirthdayMonth}
                      inputMode="numeric"
                      placeholder="--"
                    />
                    <ActionButton
                      compact
                      onClick={() => showLocketWriteUnavailable("Ngày sinh")}
                    >
                      Lưu
                    </ActionButton>
                  </div>
                </ProfileCard>
              </div>
            )}

            {activeSection === "privacy" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={Eye}
                  title="Riêng tư & hiển thị"
                  description="Chỉ các tùy chọn liên quan đến việc hồ sơ xuất hiện như thế nào."
                />

                <ProfileCard icon={Eye} title="Cài đặt hiển thị">
                  <SettingToggle
                    title="Hiển thị huy hiệu Locket Gold"
                    description="Hiện huy hiệu Gold cạnh ảnh đại diện trên giao diện hồ sơ của web"
                    checked={prefs.showGoldBadge}
                    onChange={() => updatePref("showGoldBadge")}
                  />
                  <SettingToggle
                    title="Hiển thị công khai tìm kiếm"
                    description="Cho phép thông tin hồ sơ cơ bản xuất hiện rõ trong giao diện tìm kiếm của web"
                    checked={prefs.showCountdown}
                    onChange={() => updatePref("showCountdown")}
                  />
                  <SettingToggle
                    title="Chia sẻ thông tin cho bên thứ ba"
                    description="Mặc định tắt; chỉ áp dụng cho các tính năng do Huy Locket quản lý"
                    checked={prefs.shareThirdParty}
                    onChange={() => updatePref("shareThirdParty")}
                  />
                </ProfileCard>
              </div>
            )}

            {activeSection === "security" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={ShieldCheck}
                  title="Bảo mật"
                  description="Mật khẩu, trạng thái đăng nhập và thông tin xác thực."
                />

                <ProfileCard icon={KeyRound} title="Đổi mật khẩu">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold">
                      Đăng nhập lần cuối: {formatDateTime(user?.lastLoginAt)}
                    </p>
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      disabled={resettingPassword || !user?.email}
                      className="btn btn-error w-full rounded-xl text-white"
                    >
                      {resettingPassword ? (
                        <span className="loading loading-spinner loading-sm" />
                      ) : (
                        <ShieldCheck size={17} />
                      )}
                      {resettingPassword ? "Đang gửi..." : "Gửi email đổi mật khẩu"}
                    </button>
                    <p className="text-xs text-base-content/45">
                      Hệ thống gửi liên kết đặt lại mật khẩu đến email gắn với tài khoản.
                    </p>
                  </div>
                </ProfileCard>

                <ProfileCard icon={ShieldCheck} title="Trạng thái tài khoản">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile label="Email" value={user?.email} />
                    <InfoTile
                      label="Xác thực email"
                      value={
                        user?.emailVerified === true
                          ? "Đã xác thực"
                          : user?.emailVerified === false
                            ? "Chưa xác thực"
                            : "Không xác định"
                      }
                    />
                    <InfoTile
                      label="Đăng nhập lần cuối"
                      value={formatDateTime(user?.lastLoginAt)}
                    />
                    <InfoTile
                      label="Tài khoản hoạt động"
                      value={userPlan?.user?.is_active ? "Có" : "Không xác định"}
                    />
                  </div>
                </ProfileCard>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, description }) {
  return (
    <div className="rounded-2xl border border-base-300 bg-base-100/65 px-4 py-4 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          <p className="mt-0.5 text-sm text-base-content/50">{description}</p>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ icon: Icon, title, children }) {
  return (
    <section className="rounded-2xl border border-base-300 bg-base-200/45 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
        <Icon size={17} className="text-warning" />
        <h2>{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function AccountLine({ label, value, mono = false }) {
  return (
    <p className="truncate text-xs text-base-content/55">
      <span className="font-semibold">{label}:</span>{" "}
      <span className={mono ? "font-mono" : ""}>{value || "Không có dữ liệu"}</span>
    </p>
  );
}

function MiniBadge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning">
      {children}
    </span>
  );
}

function SettingToggle({ title, description, checked, onChange, compact = false }) {
  return (
    <label
      className={`flex cursor-pointer items-center justify-between gap-4 border-base-300 ${
        compact ? "rounded-xl bg-base-300/25 px-3 py-2.5" : "border-b py-3 last:border-b-0"
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-base-content/45">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        className="toggle toggle-warning shrink-0"
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  className = "",
  icon: Icon,
  type = "text",
  ...props
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold text-base-content/55">
        {label}
      </span>
      <div className="relative">
        {Icon && (
          <Icon
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base-content/40"
          />
        )}
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={`input input-bordered w-full rounded-xl bg-base-300/35 ${Icon ? "pl-9" : ""}`}
          {...props}
        />
      </div>
    </label>
  );
}

function ActionButton({ children, onClick, compact = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`btn btn-warning rounded-xl ${compact ? "btn-sm h-12" : "w-full"}`}
    >
      {children}
    </button>
  );
}

function InfoTile({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-300/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/40">
        {label}
      </p>
      <p className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>
        {value || "Không có dữ liệu"}
      </p>
    </div>
  );
}
