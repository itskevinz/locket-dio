import { useState } from "react";
import { AnimatePresence, motion as Motion } from "framer-motion";
import { useAnimation } from "@/context/AnimationContext";
import { adminRequest } from "@/services/AdminAuthService";
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

function useAdminReducedMotion() {
  const { isAnimationEnabled } = useAnimation();
  return !isAnimationEnabled;
}

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
  const reduceMotion = useAdminReducedMotion();
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

export function AdminSecurityHandoff({ active }) {
  const reduceMotion = useAdminReducedMotion();

  return (
    <AnimatePresence>
      {active && (
        <Motion.div
          key="admin-security-handoff"
          className="admin-vault-handoff"
          role="status"
          aria-live="polite"
          initial={reduceMotion ? { opacity: 1 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, filter: "blur(4px)" }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          <div className="admin-vault-handoff__grid" aria-hidden="true" />
          <Motion.div
            className="admin-vault-handoff__door admin-vault-handoff__door--left"
            aria-hidden="true"
            initial={reduceMotion ? false : { x: "0%" }}
            animate={reduceMotion ? undefined : { x: ["0%", "0%", "-104%"] }}
            transition={{ duration: 1.04, times: [0, 0.58, 1], ease: easeOut }}
          />
          <Motion.div
            className="admin-vault-handoff__door admin-vault-handoff__door--right"
            aria-hidden="true"
            initial={reduceMotion ? false : { x: "0%" }}
            animate={reduceMotion ? undefined : { x: ["0%", "0%", "104%"] }}
            transition={{ duration: 1.04, times: [0, 0.58, 1], ease: easeOut }}
          />
          <Motion.div
            className="admin-vault-handoff__sweep"
            aria-hidden="true"
            initial={reduceMotion ? false : { x: "-150%", opacity: 0 }}
            animate={reduceMotion ? undefined : { x: ["-150%", "10%", "150%"], opacity: [0, 1, 0] }}
            transition={{ duration: 0.68, times: [0, 0.46, 1], ease: easeOut }}
          />
          <Motion.div
            className="admin-vault-handoff__mark"
            initial={reduceMotion ? false : { scale: 0.72, opacity: 0, y: 12 }}
            animate={reduceMotion
              ? { scale: 1, opacity: 1, y: 0 }
              : { scale: [0.72, 1.04, 1, 0.96], opacity: [0, 1, 1, 0], y: [12, 0, 0, -4] }}
            transition={{ duration: reduceMotion ? 0 : 0.92, times: [0, 0.24, 0.68, 1], ease: easeOut }}
          >
            <div className="admin-vault-handoff__seal">
              <i className="admin-vault-handoff__orbit admin-vault-handoff__orbit--one" aria-hidden="true" />
              <i className="admin-vault-handoff__orbit admin-vault-handoff__orbit--two" aria-hidden="true" />
              <span><Check /></span>
            </div>
            <strong>ACCESS GRANTED</strong>
            <small>Đang giải mã trung tâm quản trị</small>
            <div className="admin-vault-handoff__status"><i /><span>ENCRYPTED SESSION READY</span></div>
          </Motion.div>
        </Motion.div>
      )}
    </AnimatePresence>
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
  const reduceMotion = useAdminReducedMotion();
  const [recoveryStep, setRecoveryStep] = useState("idle");
  const [recoveryOtp, setRecoveryOtp] = useState("");
  const [recoveryNewPin, setRecoveryNewPin] = useState("");
  const [recoveryConfirmPin, setRecoveryConfirmPin] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");

  const isOtp = Boolean(otpToken);
  const isRecovery = recoveryStep !== "idle";
  const busy = loading || recoveryLoading;
  const visibleError = recoveryError || error;
  const panelKey = verified ? "success" : isRecovery ? `recovery-${recoveryStep}` : isOtp ? "otp" : "pin";

  const requestRecoveryOtp = async () => {
    if (recoveryLoading) return;
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await adminRequest("/pin/recovery/request", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setRecoveryEmail(result.maskedEmail || currentEmail || "email quản trị");
      setRecoveryOtp("");
      setRecoveryMessage(result.message || "Đã gửi OTP khôi phục PIN đến email quản trị.");
      setRecoveryStep("verify");
    } catch (requestError) {
      setRecoveryError(requestError?.message || "Không thể gửi OTP khôi phục PIN.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const submitRecovery = async (event) => {
    event.preventDefault();
    if (recoveryLoading) return;
    if (recoveryNewPin !== recoveryConfirmPin) {
      setRecoveryError("PIN xác nhận không trùng với PIN mới.");
      return;
    }
    if (!/^\d{4,8}$/.test(recoveryNewPin)) {
      setRecoveryError("PIN mới phải gồm từ 4 đến 8 chữ số.");
      return;
    }
    if (!/^\d{6}$/.test(recoveryOtp)) {
      setRecoveryError("OTP phải gồm đúng 6 chữ số.");
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await adminRequest("/pin/recovery/verify", {
        method: "POST",
        body: JSON.stringify({ otp: recoveryOtp, newPin: recoveryNewPin }),
      });
      onPinChange(recoveryNewPin);
      setRecoveryMessage(result.message || "Đã đặt PIN quản trị mới.");
      setRecoveryStep("done");
    } catch (verifyError) {
      setRecoveryError(verifyError?.message || "Không thể đặt lại PIN quản trị.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const closeRecovery = () => {
    setRecoveryStep("idle");
    setRecoveryOtp("");
    setRecoveryNewPin("");
    setRecoveryConfirmPin("");
    setRecoveryError("");
    setRecoveryMessage("");
    setRecoveryEmail("");
  };

  return (
    <Motion.main
      className="admin-vault"
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.3, ease: easeOut }}
    >
      <div className="admin-vault-grid" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--one" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--two" aria-hidden="true" />

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
              key={isRecovery ? "recovery-description" : isOtp ? "otp-description" : "pin-description"}
              initial={reduceMotion ? false : { opacity: 0, y: 4, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -3, filter: "blur(2px)" }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: easeOut }}
            >
              {isRecovery
                ? "Khôi phục PIN bằng OTP được gửi trực tiếp đến email của tài khoản quản trị đang đăng nhập."
                : isOtp
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
            ) : isRecovery ? (
              recoveryStep === "done" ? (
                <div className="admin-vault-success" role="status" aria-live="polite">
                  <div><Check /></div>
                  <h2>Đã đổi PIN</h2>
                  <p>{recoveryMessage || "PIN quản trị mới đã được lưu an toàn."}</p>
                  <button type="button" className="admin-vault-back" onClick={closeRecovery} disabled={busy}>
                    <ChevronLeft /> Dùng PIN mới để mở khóa
                  </button>
                  <span aria-hidden="true" />
                </div>
              ) : (
                <form onSubmit={submitRecovery} className="admin-vault-form">
                  <div className="admin-vault-section-label"><ShieldCheck /> <span>Khôi phục PIN qua email</span><i>RESET</i></div>
                  <p className="admin-vault-label">
                    {recoveryMessage || "Nhập OTP từ email và tạo PIN quản trị mới."}
                    {recoveryEmail ? ` Email nhận mã: ${recoveryEmail}` : ""}
                  </p>

                  <label className="admin-vault-label" htmlFor="admin-vault-recovery-otp">OTP 6 chữ số</label>
                  <div className="admin-vault-input-wrap">
                    <input
                      id="admin-vault-recovery-otp"
                      className="admin-vault-input admin-vault-input--otp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={recoveryOtp}
                      onChange={(event) => setRecoveryOtp(event.target.value.replace(/[^0-9]/g, ""))}
                      disabled={busy}
                      autoFocus
                      required
                    />
                    <ShieldCheck aria-hidden="true" />
                  </div>

                  <label className="admin-vault-label" htmlFor="admin-vault-recovery-pin">PIN mới 4–8 chữ số</label>
                  <div className="admin-vault-input-wrap">
                    <input
                      id="admin-vault-recovery-pin"
                      className="admin-vault-input admin-vault-input--pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      pattern="[0-9]*"
                      maxLength={8}
                      placeholder="••••••••"
                      value={recoveryNewPin}
                      onChange={(event) => setRecoveryNewPin(event.target.value.replace(/[^0-9]/g, ""))}
                      disabled={busy}
                      required
                    />
                    <KeyRound aria-hidden="true" />
                  </div>

                  <label className="admin-vault-label" htmlFor="admin-vault-recovery-confirm">Nhập lại PIN mới</label>
                  <div className="admin-vault-input-wrap">
                    <input
                      id="admin-vault-recovery-confirm"
                      className="admin-vault-input admin-vault-input--pin"
                      type="password"
                      inputMode="numeric"
                      autoComplete="new-password"
                      pattern="[0-9]*"
                      maxLength={8}
                      placeholder="••••••••"
                      value={recoveryConfirmPin}
                      onChange={(event) => setRecoveryConfirmPin(event.target.value.replace(/[^0-9]/g, ""))}
                      disabled={busy}
                      required
                    />
                    <KeyRound aria-hidden="true" />
                  </div>

                  <VerificationButton
                    loading={recoveryLoading}
                    verified={false}
                    disabled={busy || recoveryOtp.length !== 6 || recoveryNewPin.length < 4 || recoveryNewPin !== recoveryConfirmPin}
                  >
                    Xác minh OTP & đặt PIN mới
                  </VerificationButton>
                  <button type="button" className="admin-vault-back" onClick={requestRecoveryOtp} disabled={busy}>
                    <ShieldCheck /> Gửi lại OTP
                  </button>
                  <button type="button" className="admin-vault-back" onClick={closeRecovery} disabled={busy}>
                    <ChevronLeft /> Quay lại nhập PIN
                  </button>
                </form>
              )
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
                    disabled={busy}
                    autoFocus
                    required
                  />
                  <KeyRound aria-hidden="true" />
                </div>
                <PinKeypad value={pin} onChange={onPinChange} disabled={busy} reduceMotion={reduceMotion} />
                <VerificationButton loading={loading} verified={verified} disabled={busy || !pin.trim()}>
                  {hasPin ? "Mở khóa trung tâm quản trị" : "Tạo PIN & tiếp tục"}
                </VerificationButton>
                {hasPin && (
                  <button type="button" className="admin-vault-back" onClick={requestRecoveryOtp} disabled={busy}>
                    <KeyRound /> Quên mã PIN? Nhận OTP qua email
                  </button>
                )}
              </form>
            )}
          </Motion.div>
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {visibleError && !verified && (
            <Motion.div
              className="admin-vault-error"
              role="alert"
              initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
            >
              <TriangleAlert /> <span>{visibleError}</span>
            </Motion.div>
          )}
        </AnimatePresence>

        <footer className="admin-vault-footer">
          <div><Sparkles /><span>TLS 1.3</span><i /><span>ENCRYPTED SESSION</span><i /> <span>SESSION 30 MIN</span></div>
          <button type="button" onClick={onLeave} disabled={busy || verified}><ArrowLeft /> Quay lại Huy Locket</button>
        </footer>
      </section>
    </Motion.main>
  );
}
