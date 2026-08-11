import { useEffect, useMemo, useState } from "react";
import {
  AtSign,
  BadgeCheck,
  Cake,
  Contact,
  Eye,
  Flame,
  KeyRound,
  Mail,
  Phone,
  Save,
  ShieldCheck,
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
      "Phần hồ sơ mới đã hiển thị dữ liệu thật. Web hiện chưa có API Locket an toàn để ghi mục này lên tài khoản.",
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
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Hồ sơ</h1>
            <p className="mt-1 text-sm text-base-content/55">
              Quản lý thông tin tài khoản và cách hồ sơ hiển thị trên Huy Locket.
            </p>
          </div>

          {streak !== null && streak !== undefined && streak !== "" && (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-sm font-semibold text-warning">
              <Flame size={15} fill="currentColor" /> Chuỗi của bạn: {streak}d
            </div>
          )}
        </div>

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
              <AccountLine label="UID" value={user?.uid} mono />
              <AccountLine label="Username" value={user?.username ? `@${user.username}` : null} />
              <AccountLine label="Ngày tạo" value={formatDateOnly(user?.createdAt)} />
              <div className="flex flex-wrap gap-2 pt-1">
                {isGold && <MiniBadge>Locket Gold</MiniBadge>}
                <MiniBadge>{planName}</MiniBadge>
                {user?.emailVerified === true && <MiniBadge>Đã xác thực email</MiniBadge>}
              </div>
            </div>
          </div>

          <p className="mt-4 border-t border-base-300 pt-3 text-xs leading-relaxed text-base-content/45">
            Nếu thông tin tài khoản hiển thị khác ứng dụng Locket, hãy tải lại phiên đăng nhập để web lấy dữ liệu mới nhất.
          </p>
        </ProfileCard>

        <ProfileCard icon={Eye} title="Cài đặt hiển thị / Riêng tư">
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
            description="Mặc định tắt; cài đặt này chỉ áp dụng cho các tính năng do Huy Locket quản lý"
            checked={prefs.shareThirdParty}
            onChange={() => updatePref("shareThirdParty")}
          />
        </ProfileCard>

        <ProfileCard icon={UserRoundCog} title="Thay đổi tên hiển thị">
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
              Hệ thống gửi liên kết đặt lại mật khẩu đến email gắn với tài khoản; web không yêu cầu nhập mật khẩu hiện tại tại đây.
            </p>
          </div>
        </ProfileCard>

        <ProfileCard icon={BadgeCheck} title="Thông tin gói trên web">
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

function InfoTile({ label, value }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-300/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/40">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold">
        {value || "Không có dữ liệu"}
      </p>
    </div>
  );
}
