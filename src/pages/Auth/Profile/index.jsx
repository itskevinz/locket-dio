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
import {
  confirmProfilePhoneChange,
  forgotPassword,
  GetUserLocket,
  normalizeLocketPhone,
  requestProfilePhoneChange,
  updateAllowSearch,
  updateProfileBirthday,
  updateProfileEmail,
  updateProfileName,
} from "@/services";
import { useAuthStore, useUserSetting } from "@/stores";

const PROFILE_PREFS_KEY = "huy-locket-profile-preferences-v2";

const DEFAULT_PROFILE_PREFS = {
  showGoldBadge: true,
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
    description: "Cài đặt Locket thật",
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

function decodeBirthday(user) {
  const birthday = user?.birthday || user?.birthdate || user?.dateOfBirth;

  if (birthday && typeof birthday === "object") {
    const encoded =
      birthday?.encoded_mdd ?? birthday?.encodedMdd ?? birthday?.value ?? null;
    if (encoded !== null && encoded !== undefined) {
      const number = Number(encoded);
      if (Number.isFinite(number)) {
        return {
          day: String(number % 100).padStart(2, "0"),
          month: String(Math.floor(number / 100)).padStart(2, "0"),
        };
      }
    }

    return {
      day: String(birthday.day ?? birthday.date ?? ""),
      month: String(birthday.month ?? ""),
    };
  }

  const numeric = Number(birthday);
  if (
    birthday !== null &&
    birthday !== undefined &&
    Number.isFinite(numeric) &&
    numeric > 0
  ) {
    return {
      day: String(numeric % 100).padStart(2, "0"),
      month: String(Math.floor(numeric / 100)).padStart(2, "0"),
    };
  }

  return {
    day: String(user?.birthDay ?? user?.birthdayDay ?? user?.dayOfBirth ?? ""),
    month: String(user?.birthMonth ?? user?.birthdayMonth ?? user?.monthOfBirth ?? ""),
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAuthUser(retries = 0) {
  let refreshed = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    refreshed = await GetUserLocket();
    if (refreshed) useAuthStore.setState({ user: refreshed });
    if (attempt < retries) await sleep(450);
  }
  return refreshed;
}

function samePhone(a, b) {
  try {
    return normalizeLocketPhone(a) === normalizeLocketPhone(b);
  } catch {
    return String(a || "") === String(b || "");
  }
}

export default function Profile() {
  const user = useAuthStore((s) => s.user);
  const userPlan = useAuthStore((s) => s.userPlan);
  const allowSearch = useUserSetting((s) => s.allowSearch);

  const [activeSection, setActiveSection] = useState("overview");
  const [prefs, setPrefs] = useState(readProfilePrefs);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthdayDay, setBirthdayDay] = useState("");
  const [birthdayMonth, setBirthdayMonth] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneTarget, setPhoneTarget] = useState("");
  const [phoneOtpSent, setPhoneOtpSent] = useState(false);

  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [verifyingPhone, setVerifyingPhone] = useState(false);
  const [savingBirthday, setSavingBirthday] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  const isRealGold = String(user?.badge || "").toLowerCase() === "locket_gold";

  useEffect(() => {
    const birthday = decodeBirthday(user);
    setFirstName(user?.firstName ?? "");
    setLastName(user?.lastName ?? "");
    setEmail(user?.email ?? "");
    if (!phoneOtpSent) setPhone(user?.phoneNumber ?? "");
    setBirthdayDay(birthday.day || "");
    setBirthdayMonth(birthday.month || "");

    if (typeof user?.usernameDiscoverabilityDisabled === "boolean") {
      useUserSetting.setState({
        allowSearch: !user.usernameDiscoverabilityDisabled,
      });
    }
  }, [user, phoneOtpSent]);

  useEffect(() => {
    if (!isRealGold && prefs.showGoldBadge) {
      setPrefs((current) => ({ ...current, showGoldBadge: false }));
    }
  }, [isRealGold, prefs.showGoldBadge]);

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

  const updatePref = (key) => {
    setPrefs((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleGoldVisibilityChange = () => {
    if (!isRealGold) {
      SonnerWarning(
        "Không thể bật",
        "Tài khoản Locket hiện không có Gold nên web không thể hiển thị huy hiệu Gold.",
      );
      return;
    }
    updatePref("showGoldBadge");
  };

  const handleSaveName = async () => {
    if (savingName) return;
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first && !last) {
      SonnerWarning("Tên không được để trống.");
      return;
    }

    setSavingName(true);
    try {
      await updateProfileName({ firstName: first, lastName: last });
      const fresh = await refreshAuthUser(2);
      const verified =
        String(fresh?.firstName || "").trim() === first &&
        String(fresh?.lastName || "").trim() === last;

      if (!verified) {
        throw new Error(
          "Locket đã nhận yêu cầu nhưng dữ liệu đọc lại chưa khớp. Web không đánh dấu thành công giả.",
        );
      }
      SonnerInfo("Đã cập nhật tên", "Tên mới đã được lưu thật trên tài khoản Locket.");
    } catch (error) {
      SonnerWarning("Chưa đổi được tên", error?.message || "Locket từ chối yêu cầu.");
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveEmail = async () => {
    if (savingEmail) return;
    const nextEmail = email.trim().toLowerCase();
    if (nextEmail === String(user?.email || "").trim().toLowerCase()) {
      SonnerInfo("Email không thay đổi");
      return;
    }

    setSavingEmail(true);
    try {
      await updateProfileEmail(nextEmail);
      const fresh = await refreshAuthUser(3);
      const actualEmail = String(fresh?.email || "").trim().toLowerCase();

      if (actualEmail !== nextEmail) {
        setEmail(fresh?.email || nextEmail);
        throw new Error(
          "Locket đã nhận yêu cầu nhưng email tài khoản chưa đổi khi kiểm tra lại. Có thể Locket yêu cầu xác minh email trước khi áp dụng.",
        );
      }

      SonnerInfo("Đã đổi email", "Email đăng nhập đã được cập nhật thật trên Locket.");
    } catch (error) {
      SonnerWarning("Chưa đổi được email", error?.message || "Vui lòng thử lại sau.");
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSendPhoneCode = async (isRetry = false) => {
    if (sendingPhoneCode) return;
    setSendingPhoneCode(true);
    try {
      const result = await requestProfilePhoneChange(phone, { isRetry });
      setPhone(result.phone);
      setPhoneTarget(result.phone);
      setPhoneOtpSent(true);
      if (!isRetry) setPhoneCode("");
      SonnerInfo(
        isRetry ? "Đã yêu cầu gửi lại mã" : "Đã gửi yêu cầu OTP",
        `Locket đã nhận yêu cầu xác minh số ${result.phone}.`,
      );
    } catch (error) {
      SonnerWarning("Không gửi được mã", error?.message || "Vui lòng thử lại sau.");
    } finally {
      setSendingPhoneCode(false);
    }
  };

  const handleVerifyPhone = async () => {
    if (verifyingPhone || !phoneOtpSent) return;
    setVerifyingPhone(true);
    try {
      await confirmProfilePhoneChange({ phone: phoneTarget || phone, code: phoneCode });
      const fresh = await refreshAuthUser(4);
      const changed = fresh?.phoneNumber && samePhone(fresh.phoneNumber, phoneTarget || phone);

      if (!changed) {
        throw new Error(
          "Mã đã được Locket xử lý nhưng số điện thoại đọc lại từ tài khoản chưa đổi. Web không báo thành công nếu dữ liệu thật chưa thay đổi.",
        );
      }

      setPhoneOtpSent(false);
      setPhoneCode("");
      setPhoneTarget("");
      SonnerInfo(
        "Đã đổi số điện thoại",
        `Số ${fresh.phoneNumber} đã được lưu thật vào tài khoản Locket.`,
      );
    } catch (error) {
      SonnerWarning("Chưa đổi được số điện thoại", error?.message || "Mã không hợp lệ.");
    } finally {
      setVerifyingPhone(false);
    }
  };

  const handleSaveBirthday = async () => {
    if (savingBirthday) return;
    setSavingBirthday(true);
    try {
      await updateProfileBirthday({ day: birthdayDay, month: birthdayMonth });
      const fresh = await refreshAuthUser(2);
      const actual = decodeBirthday(fresh);
      const wantedDay = String(Number(birthdayDay)).padStart(2, "0");
      const wantedMonth = String(Number(birthdayMonth)).padStart(2, "0");

      if (actual.day !== wantedDay || actual.month !== wantedMonth) {
        throw new Error(
          "Locket đã nhận yêu cầu nhưng ngày sinh đọc lại chưa khớp. Web không báo lưu thành công giả.",
        );
      }

      SonnerInfo("Đã cập nhật ngày sinh", "Ngày sinh đã được lưu thật vào hồ sơ Locket.");
    } catch (error) {
      SonnerWarning("Chưa đổi được ngày sinh", error?.message || "Locket từ chối yêu cầu.");
    } finally {
      setSavingBirthday(false);
    }
  };

  const handleAllowSearchChange = async () => {
    if (savingSearch) return;
    const previous = allowSearch;
    const next = !previous;
    setSavingSearch(true);

    try {
      await updateAllowSearch(next);
      const fresh = await refreshAuthUser(2);
      const actual =
        typeof fresh?.usernameDiscoverabilityDisabled === "boolean"
          ? !fresh.usernameDiscoverabilityDisabled
          : next;

      if (actual !== next) {
        useUserSetting.setState({ allowSearch: previous });
        throw new Error("Locket không giữ trạng thái tìm kiếm vừa chọn.");
      }

      useUserSetting.setState({ allowSearch: actual });
      SonnerInfo(
        actual ? "Đã bật tìm kiếm công khai" : "Đã tắt tìm kiếm công khai",
        "Trạng thái đã được kiểm tra lại từ hồ sơ Locket.",
      );
    } catch (error) {
      useUserSetting.setState({ allowSearch: previous });
      SonnerWarning("Chưa cập nhật được quyền tìm kiếm", error?.message || "Vui lòng thử lại.");
    } finally {
      setSavingSearch(false);
    }
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
      SonnerWarning("Chưa gửi được email đổi mật khẩu", error?.message || "Vui lòng thử lại.");
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
              Chỉ báo thành công khi dữ liệu đọc lại từ tài khoản Locket đã thay đổi.
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
                      active ? "bg-warning text-warning-content shadow-sm" : "hover:bg-base-300/60"
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
                  description="Thông tin đang đọc từ tài khoản Locket và gói web."
                />

                <ProfileCard icon={Contact} title="Thông tin tài khoản">
                  <div className="flex items-start gap-4">
                    <div className="relative shrink-0">
                      {user?.profilePicture ? (
                        <img
                          src={user.profilePicture}
                          alt={fullName}
                          className="h-20 w-20 rounded-full border-[3px] border-warning object-cover p-0.5"
                        />
                      ) : (
                        <div className="flex h-20 w-20 items-center justify-center rounded-full border-[3px] border-warning bg-base-300 text-xl font-bold">
                          {initials}
                        </div>
                      )}
                      {isRealGold && prefs.showGoldBadge && (
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
                      <AccountLine label="Username" value={user?.username ? `@${user.username}` : null} />
                      <AccountLine label="Ngày tạo" value={formatDateOnly(user?.createdAt)} />
                      <div className="flex flex-wrap gap-2 pt-1">
                        {isRealGold && <MiniBadge>Locket Gold</MiniBadge>}
                        <MiniBadge>{planName}</MiniBadge>
                        {user?.emailVerified === true && <MiniBadge>Đã xác thực email</MiniBadge>}
                      </div>
                    </div>
                  </div>
                </ProfileCard>

                <ProfileCard icon={BadgeCheck} title="Gói trên web">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile label="Mã người dùng" value={userPlan?.user?.customer_code} />
                    <InfoTile label="Gói hiện tại" value={planName} />
                    <InfoTile label="Ngày bắt đầu" value={formatDateTime(userPlan?.subscription?.start_at)} />
                    <InfoTile label="Ngày hết hạn" value={formatDateTime(userPlan?.subscription?.expires_at)} />
                  </div>
                </ProfileCard>

                <details className="group rounded-2xl border border-base-300 bg-base-200/35 shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 sm:px-5">
                    <div className="flex items-center gap-2">
                      <SlidersHorizontal size={17} className="text-warning" />
                      <div>
                        <p className="text-sm font-bold">Thông tin nâng cao</p>
                        <p className="mt-0.5 text-xs text-base-content/45">UID và trạng thái xác thực thật.</p>
                      </div>
                    </div>
                    <span className="text-lg text-base-content/40 transition-transform group-open:rotate-45">+</span>
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
                    <InfoTile label="Gold thật" value={isRealGold ? "Có" : "Không"} />
                    <InfoTile label="Cập nhật gần nhất" value={formatDateTime(user?.lastRefreshAt)} />
                  </div>
                </details>
              </div>
            )}

            {activeSection === "profile" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={UserRoundCog}
                  title="Hồ sơ"
                  description="Các nút Lưu bên dưới gọi API Locket thật và kiểm tra lại kết quả."
                />

                <ProfileCard icon={UserRoundCog} title="Tên hiển thị">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Tên" value={firstName} onChange={setFirstName} />
                    <Field label="Họ" value={lastName} onChange={setLastName} />
                  </div>

                  <SettingToggle
                    compact
                    title="Thêm dấu cách khi xem trước trên web"
                    description="Chỉ là cách hiển thị xem trước, không thay dữ liệu Locket."
                    checked={prefs.splitDisplayName}
                    onChange={() => updatePref("splitDisplayName")}
                  />

                  <div className="rounded-xl border border-base-300 bg-base-300/35 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/45">Xem trước</p>
                    <p className="mt-1 font-semibold">
                      {prefs.splitDisplayName
                        ? [firstName, lastName].filter(Boolean).join(" ") || "Tên hiển thị"
                        : `${firstName}${lastName}` || "Tên hiển thị"}
                    </p>
                  </div>

                  <ActionButton onClick={handleSaveName} loading={savingName}>
                    <Save size={15} /> {savingName ? "Đang lưu..." : "Lưu tên lên Locket"}
                  </ActionButton>
                </ProfileCard>

                <ProfileCard icon={AtSign} title="Thông tin liên hệ">
                  <div className="space-y-4">
                    <div>
                      <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
                        <Field
                          label="Email đăng nhập"
                          value={email}
                          onChange={setEmail}
                          icon={Mail}
                          type="email"
                        />
                        <ActionButton compact onClick={handleSaveEmail} loading={savingEmail}>
                          {savingEmail ? "Đang lưu" : "Lưu email"}
                        </ActionButton>
                      </div>
                      <p className="mt-2 text-xs text-base-content/45">
                        Dùng endpoint updateEmailAddress của Locket và chỉ báo thành công sau khi đọc lại đúng email mới.
                      </p>
                    </div>

                    <div className="border-t border-base-300 pt-4">
                      <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
                        <Field
                          label="Số điện thoại"
                          value={phone}
                          onChange={(value) => {
                            setPhone(value);
                            if (phoneOtpSent && value !== phoneTarget) {
                              setPhoneOtpSent(false);
                              setPhoneCode("");
                              setPhoneTarget("");
                            }
                          }}
                          icon={Phone}
                          placeholder="+84912345678"
                        />
                        <ActionButton
                          compact
                          onClick={() => handleSendPhoneCode(false)}
                          loading={sendingPhoneCode}
                        >
                          {sendingPhoneCode ? "Đang gửi" : phoneOtpSent ? "Gửi lại mã" : "Gửi mã"}
                        </ActionButton>
                      </div>

                      {phoneOtpSent && (
                        <div className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3">
                          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_auto]">
                            <Field
                              label={`Mã OTP gửi tới ${phoneTarget}`}
                              value={phoneCode}
                              onChange={setPhoneCode}
                              inputMode="numeric"
                              placeholder="Nhập mã xác minh"
                              maxLength={8}
                            />
                            <ActionButton compact onClick={handleVerifyPhone} loading={verifyingPhone}>
                              {verifyingPhone ? "Đang xác minh" : "Xác nhận"}
                            </ActionButton>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm h-12 rounded-xl"
                              disabled={sendingPhoneCode}
                              onClick={() => handleSendPhoneCode(true)}
                            >
                              Gửi lại
                            </button>
                          </div>
                        </div>
                      )}

                      <p className="mt-2 text-xs text-base-content/45">
                        Đổi số dùng sendVerificationCode với operation=change_number rồi xác minh bằng checkVerificationCode như luồng Locket.
                      </p>
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
                      maxLength={2}
                    />
                    <Field
                      label="Tháng"
                      value={birthdayMonth}
                      onChange={setBirthdayMonth}
                      inputMode="numeric"
                      placeholder="--"
                      maxLength={2}
                    />
                    <ActionButton compact onClick={handleSaveBirthday} loading={savingBirthday}>
                      {savingBirthday ? "Đang lưu" : "Lưu"}
                    </ActionButton>
                  </div>
                  <p className="text-xs text-base-content/45">
                    Ngày sinh được ghi vào birthday.encoded_mdd của hồ sơ Locket và được đọc lại để xác nhận.
                  </p>
                </ProfileCard>
              </div>
            )}

            {activeSection === "privacy" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={Eye}
                  title="Riêng tư & hiển thị"
                  description="Không giả lập trạng thái tài khoản."
                />

                <ProfileCard icon={Eye} title="Cài đặt hiển thị">
                  <SettingToggle
                    title="Hiển thị huy hiệu Locket Gold"
                    description={
                      isRealGold
                        ? "Tài khoản có Gold thật; tùy chọn này chỉ ẩn/hiện huy hiệu trên giao diện web."
                        : "Tài khoản Locket hiện không có Gold nên không thể bật."
                    }
                    checked={isRealGold && prefs.showGoldBadge}
                    onChange={handleGoldVisibilityChange}
                    disabled={!isRealGold}
                  />
                  <SettingToggle
                    title="Hiển thị công khai tìm kiếm"
                    description="Cập nhật username_discoverability_disabled thật trên Locket."
                    checked={allowSearch}
                    onChange={handleAllowSearchChange}
                    disabled={savingSearch}
                    loading={savingSearch}
                  />
                </ProfileCard>
              </div>
            )}

            {activeSection === "security" && (
              <div className="space-y-4">
                <SectionHeader
                  icon={ShieldCheck}
                  title="Bảo mật"
                  description="Mật khẩu và trạng thái đăng nhập thật của tài khoản."
                />

                <ProfileCard icon={KeyRound} title="Đổi mật khẩu">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold">
                      Lần cuối đổi mật khẩu: {formatDateTime(user?.passwordUpdatedAt)}
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
                      Locket gửi liên kết đặt lại mật khẩu đến email đang gắn với tài khoản.
                    </p>
                  </div>
                </ProfileCard>

                <ProfileCard icon={ShieldCheck} title="Trạng thái tài khoản">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoTile label="Email" value={user?.email} />
                    <InfoTile label="Số điện thoại" value={user?.phoneNumber} />
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
                    <InfoTile label="Đăng nhập lần cuối" value={formatDateTime(user?.lastLoginAt)} />
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

function SettingToggle({
  title,
  description,
  checked,
  onChange,
  compact = false,
  disabled = false,
  loading = false,
}) {
  return (
    <label
      className={`flex items-center justify-between gap-4 border-base-300 ${
        compact ? "rounded-xl bg-base-300/25 px-3 py-2.5" : "border-b py-3 last:border-b-0"
      } ${disabled ? "cursor-not-allowed opacity-65" : "cursor-pointer"}`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-base-content/45">{description}</span>
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          className="toggle toggle-warning"
          checked={checked}
          onChange={onChange}
          disabled={disabled}
        />
        {loading && (
          <span className="loading loading-spinner loading-xs absolute -left-5 top-1/2 -translate-y-1/2" />
        )}
      </span>
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
  disabled = false,
  ...props
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs font-semibold text-base-content/55">{label}</span>
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
          disabled={disabled}
          className={`input input-bordered w-full rounded-xl bg-base-300/35 ${Icon ? "pl-9" : ""} ${
            disabled ? "cursor-not-allowed opacity-65" : ""
          }`}
          {...props}
        />
      </div>
    </label>
  );
}

function ActionButton({ children, onClick, compact = false, loading = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`btn btn-warning rounded-xl ${compact ? "btn-sm h-12" : "w-full"}`}
    >
      {loading && <span className="loading loading-spinner loading-xs" />}
      {children}
    </button>
  );
}

function InfoTile({ label, value, mono = false }) {
  return (
    <div className="rounded-xl border border-base-300 bg-base-300/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-base-content/40">{label}</p>
      <p className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>
        {value || "Không có dữ liệu"}
      </p>
    </div>
  );
}