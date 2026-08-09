import { AnimatePresence, motion as Motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  Delete,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import "./admin-security-gate.css";

const easeOut = [0.22, 1, 0.36, 1];
const keypad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "backspace", "0", "clear"];

function SecurityMark({ compact = false }) {
  return (
    <div className={`admin-vault-mark${compact ? " admin-vault-mark--compact" : ""}`} aria-hidden="true">
      <span className="admin-vault-mark__ring" />
      <ShieldCheck />
    </div>
  );
}

function VerificationButton({ loading, verified, disabled, children }) {
  return (
    <Motion.button
      type="submit"
      className={`admin-vault-submit${loading ? " is-loading" : ""}${verified ? " is-verified" : ""}`}
      disabled={disabled || verified}
      whileTap={disabled || verified ? undefined : { scale: 0.985 }}
      transition={{ duration: 0.12 }}
    >
      <span className="admin-vault-submit__content">
        {verified ? <Check aria-hidden="true" /> : loading ? <ShieldCheck aria-hidden="true" /> : <LockKeyhole aria-hidden="true" />}
        <span>{verified ? "Đã xác minh" : loading ? "Đang xác minh..." : children}</span>
      </span>
      {loading && <span className="admin-vault-submit__progress" aria-hidden="true" />}
      {loading && <span className="admin-vault-submit__shimmer" aria-hidden="true" />}
    </Motion.button>
  );
}

function PinKeypad({ value, onChange, disabled, reduceMotion }) {
  const press = (key) => {
    if (disabled) return;
    if (key === "backspace") return onChange(value.slice(0, -1));
    if (key === "clear") return onChange("");
    if (value.length < 8) onChange(`${value}${key}`);
  };

  return (
    <Motion.div
      className="admin-vault-keypad"
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.025, delayChildren: reduceMotion ? 0 : 0.06 } },
      }}
      aria-label="Bàn phím nhập mã PIN"
    >
      {keypad.map((key) => {
        const isBackspace = key === "backspace";
        const isClear = key === "clear";
        const label = isBackspace ? "Xóa số cuối" : isClear ? "Xóa toàn bộ" : `Số ${key}`;
        return (
          <Motion.button
            key={key}
            type="button"
            className={`admin-vault-key${isBackspace || isClear ? " admin-vault-key--utility" : ""}`}
            onClick={() => press(key)}
            disabled={disabled || (!isBackspace && !isClear && value.length >= 8)}
            aria-label={label}
            variants={{
              hidden: { opacity: 0, y: reduceMotion ? 0 : 7 },
              visible: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0 : 0.22, ease: easeOut } },
            }}
            whileTap={disabled ? undefined : { scale: 0.97 }}
          >
            {isBackspace ? <Delete size={19} /> : isClear ? <span className="admin-vault-key__clear">C</span> : key}
          </Motion.button>
        );
      })}
    </Motion.div>
  );
}

export function AdminRouteLoading() {
  const reduceMotion = useReducedMotion();
  return (
    <Motion.main
      className="admin-vault admin-vault--loading"
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2 }}
    >
      <div className="admin-vault-loading" role="status" aria-live="polite">
        <SecurityMark compact />
        <div>
          <span className="admin-vault-eyebrow">ENCRYPTED SESSION</span>
          <p>Đang kiểm tra quyền truy cập</p>
        </div>
        <span className="admin-vault-loading__line" aria-hidden="true" />
      </div>
    </Motion.main>
  );
}

export default function AdminSecurityGate({
  currentEmail,
  currentRole,
  hasPin,
  error,
  loading,
  verified,
  pin,
  onPinChange,
  onPinSubmit,
  otpToken,
  otp,
  onOtpChange,
  rememberDevice,
  onRememberDeviceChange,
  onOtpSubmit,
  onOtpBack,
  onLeave,
}) {
  const reduceMotion = useReducedMotion();
  const isOtp = Boolean(otpToken);
  const panelKey = verified ? "success" : isOtp ? "otp" : "pin";
  const rootAnimation = verified && !reduceMotion
    ? { opacity: [1, 1, 0], y: [0, 0, -8] }
    : { opacity: 1, y: 0 };

  return (
    <Motion.main
      className="admin-vault"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={rootAnimation}
      transition={verified && !reduceMotion
        ? { duration: 0.64, times: [0, 0.64, 1], ease: easeOut }
        : { duration: reduceMotion ? 0 : 0.3, ease: easeOut }}
    >
      <div className="admin-vault-grid" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--one" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--two" aria-hidden="true" />

      <AnimatePresence>
        {verified && (
          <Motion.div
            className="admin-vault-handoff"
            aria-live="polite"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 0] }}
            transition={reduceMotion
              ? { duration: 0 }
              : { duration: 0.82, times: [0, 0.18, 0.72, 1], ease: easeOut }}
          >
            <Motion.div
              className="admin-vault-handoff__sweep"
              aria-hidden="true"
              initial={reduceMotion ? false : { x: "-130%" }}
              animate={reduceMotion ? undefined : { x: "130%" }}
              transition={{ duration: 0.72, ease: easeOut }}
            />
            <Motion.div
              className="admin-vault-handoff__mark"
              initial={reduceMotion ? false : { scale: 0.82, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.28, ease: easeOut }}
            >
              <span><Check /></span>
              <strong>ACCESS GRANTED</strong>
              <small>Đang mở trung tâm quản trị</small>
            </Motion.div>
          </Motion.div>
        )}
      </AnimatePresence>

      <section className="admin-vault-card" aria-labelledby="admin-vault-title">
        <div className="admin-vault-card__edge" aria-hidden="true" />
        <header className="admin-vault-header">
          <div className="admin-vault-badges" aria-label="Trạng thái bảo mật">
            <span><i /> SECURE ACCESS</span>
          </div>
          <SecurityMark />
          <span className="admin-vault-eyebrow">HUY LOCKET · SECURITY CONSOLE</span>
          <h1 id="admin-vault-title">Xác minh quản trị</h1>
          <AnimatePresence mode="wait" initial={false}>
            <Motion.p
              key={isOtp ? "otp-description" : "pin-description"}
              initial={reduceMotion ? false : { opacity: 0, y: 4, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -3, filter: "blur(2px)" }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: easeOut }}
            >
              {isOtp
                ? "Hoàn tất lớp xác thực thứ hai để mở khóa trung tâm quản trị."
                : hasPin
                  ? "Nhập mã PIN bảo mật để khởi tạo phiên quản trị riêng tư."
                  : "Tạo mã PIN quản trị gồm 4–8 chữ số để bảo vệ khu vực nhạy cảm."}
            </Motion.p>
          </AnimatePresence>
          <div className="admin-vault-identity">
            <span>{(currentEmail || "HL").slice(0, 2).toUpperCase()}</span>
            <div><strong>{currentEmail || "Huy Locket"}</strong><small>{String(currentRole || "admin").replaceAll("_", " ")}</small></div>
            <ShieldCheck aria-hidden="true" />
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <Motion.div
            key={panelKey}
            className="admin-vault-panel"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: isOtp ? 14 : -12, scale: 0.992, filter: "blur(3px)" }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: isOtp ? -10 : 10, scale: 0.995, filter: "blur(2px)" }}
            transition={{ duration: reduceMotion ? 0 : 0.26, ease: easeOut }}
          >
            {verified ? (
              <div className="admin-vault-success" role="status" aria-live="polite">
                <div><Check /></div>
                <h2>Đã xác minh</h2>
                <p>Phiên mã hóa đã sẵn sàng. Đang mở trung tâm quản trị…</p>
                <span aria-hidden="true" />
              </div>
            ) : isOtp ? (
              <form onSubmit={onOtpSubmit} className="admin-vault-form">
                <div className="admin-vault-section-label"><ShieldCheck /> <span>Xác thực hai lớp</span><i>STEP 02</i></div>
                <label className="admin-vault-label" htmlFor="admin-vault-otp">Mã OTP 6 chữ số</label>
                <div className="admin-vault-input-wrap">
                  <input
                    id="admin-vault-otp"
                    className="admin-vault-input admin-vault-input--otp"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="000000"
                    value={otp}
                    onChange={(event) => onOtpChange(event.target.value.replace(/[^0-9]/g, ""))}
                    disabled={loading}
                    autoFocus
                    required
                  />
                  <ShieldCheck aria-hidden="true" />
                </div>
                <label className="admin-vault-trust">
                  <input
                    type="checkbox"
                    checked={rememberDevice}
                    onChange={(event) => onRememberDeviceChange(event.target.checked)}
                    disabled={loading}
                  />
                  <span className="admin-vault-trust__box"><Check /></span>
                  <span><strong>Tin cậy thiết bị này trong 30 ngày</strong><small>Không yêu cầu OTP ở lần đăng nhập tiếp theo.</small></span>
                </label>
                <VerificationButton loading={loading} verified={verified} disabled={loading || otp.length !== 6}>
                  Xác minh & mở khóa
                </VerificationButton>
                <button type="button" className="admin-vault-back" onClick={onOtpBack} disabled={loading}>
                  <ChevronLeft /> Quay lại nhập PIN
                </button>
              </form>
            ) : (
              <form onSubmit={onPinSubmit} className="admin-vault-form">
                <div className="admin-vault-section-label"><KeyRound /> <span>{hasPin ? "Mã PIN quản trị" : "Thiết lập mã PIN"}</span><i>STEP 01</i></div>
                <label className="admin-vault-label" htmlFor="admin-vault-pin">{hasPin ? "Nhập mã PIN bảo mật" : "Tạo mã PIN gồm 4–8 chữ số"}</label>
                <div className="admin-vault-input-wrap">
                  <input
                    id="admin-vault-pin"
                    className="admin-vault-input admin-vault-input--pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    pattern="[0-9]*"
                    maxLength={8}
                    placeholder="••••••••"
                    value={pin}
                    onChange={(event) => onPinChange(event.target.value.replace(/[^0-9]/g, ""))}
                    disabled={loading}
                    autoFocus
                    required
                  />
                  <KeyRound aria-hidden="true" />
                </div>
                <PinKeypad value={pin} onChange={onPinChange} disabled={loading} reduceMotion={reduceMotion} />
                <VerificationButton loading={loading} verified={verified} disabled={loading || !pin.trim()}>
                  {hasPin ? "Mở khóa trung tâm quản trị" : "Tạo PIN & tiếp tục"}
                </VerificationButton>
              </form>
            )}
          </Motion.div>
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {error && !verified && (
            <Motion.div
              className="admin-vault-error"
              role="alert"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            >
              <TriangleAlert /> <span>{error}</span>
            </Motion.div>
          )}
        </AnimatePresence>

        <footer className="admin-vault-footer">
          <div><Sparkles /><span>TLS 1.3</span><i /><span>ENCRYPTED SESSION</span><i /> <span>SESSION 30 MIN</span></div>
          <button type="button" onClick={onLeave} disabled={loading || verified}><ArrowLeft /> Quay lại Huy Locket</button>
        </footer>
      </section>
    </Motion.main>
  );
}
