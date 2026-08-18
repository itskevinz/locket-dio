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

const compactGateCss = `
.admin-vault.admin-vault--security-gate {
  min-height: 100svh;
  overflow-x: hidden;
  overflow-y: auto;
  padding-top: clamp(4.65rem, 8vh, 5.5rem);
  padding-bottom: 1rem;
}
@media (min-width:760px) {
  .admin-vault--security-gate .admin-vault-card { width:min(100%,49rem); }
}
@media (min-width:760px) and (max-height:980px) {
  .admin-vault.admin-vault--security-gate {
    place-items: start center;
    padding-top: 4.7rem;
    padding-bottom: .7rem;
  }
  .admin-vault--security-gate .admin-vault-card {
    grid-template-columns:minmax(15.5rem,.86fr) minmax(21rem,1.14fr);
    border-radius:1.65rem;
  }
  .admin-vault--security-gate .admin-vault-header { padding:1.15rem 1.45rem .85rem; }
  .admin-vault--security-gate .admin-vault-badges { top:.9rem; left:1.15rem; right:1.15rem; margin-bottom:.55rem; }
  .admin-vault--security-gate .admin-vault-mark { width:3.4rem; height:3.4rem; margin-bottom:.58rem; border-radius:1rem; }
  .admin-vault--security-gate .admin-vault-mark svg { width:1.55rem; height:1.55rem; }
  .admin-vault--security-gate .admin-vault-header h1 { margin:.2rem 0 .28rem; font-size:1.58rem; }
  .admin-vault--security-gate .admin-vault-header > p { font-size:.68rem; line-height:1.4; }
  .admin-vault--security-gate .admin-vault-identity { margin-top:.62rem; padding:.5rem .62rem; }
  .admin-vault--security-gate .admin-vault-identity > span { width:1.7rem; height:1.7rem; }
  .admin-vault--security-gate .admin-vault-panel { padding:.72rem 1.4rem .65rem; }
  .admin-vault--security-gate .admin-vault-section-label { margin-bottom:.48rem; }
  .admin-vault--security-gate .admin-vault-label { margin-bottom:.3rem; }
  .admin-vault--security-gate .admin-vault-input { height:2.9rem; border-radius:.82rem; font-size:1rem; }
  .admin-vault--security-gate .admin-vault-keypad { gap:.36rem; margin:.48rem 0 .55rem; }
  .admin-vault--security-gate .admin-vault-key { min-height:2.12rem; border-radius:.7rem; font-size:.86rem; }
  .admin-vault--security-gate .admin-vault-submit { height:2.78rem; border-radius:.82rem; }
  .admin-vault--security-gate .admin-vault-back { margin-top:.38rem; font-size:.62rem; }
  .admin-vault--security-gate .admin-vault-footer { padding:.58rem 1.4rem .7rem; }
  .admin-vault--security-gate .admin-vault-success { min-height:17rem; }
}
@media (max-width:520px) {
  .admin-vault.admin-vault--security-gate { padding-top:4.7rem; padding-bottom:4.5rem; }
  .admin-vault--security-gate .admin-vault-keypad { gap:.42rem; margin:.52rem 0 .62rem; }
  .admin-vault--security-gate .admin-vault-key { min-height:2.45rem; }
  .admin-vault--security-gate .admin-vault-back { margin-top:.5rem; }
}
`;

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
        {verified ? <Check /> : loading ? <ShieldCheck /> : <LockKeyhole />}
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
        visible: { transition: { staggerChildren: reduceMotion ? 0 : 0.02 } },
      }}
      aria-label="Bàn phím nhập mã PIN"
    >
      {keypad.map((key) => {
        const isBackspace = key === "backspace";
        const isClear = key === "clear";
        return (
          <Motion.button
            key={key}
            type="button"
            className={`admin-vault-key${isBackspace || isClear ? " admin-vault-key--utility" : ""}`}
            onClick={() => press(key)}
            disabled={disabled || (!isBackspace && !isClear && value.length >= 8)}
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
            whileTap={disabled ? undefined : { scale: 0.97 }}
          >
            {isBackspace ? <Delete size={18} /> : isClear ? <span className="admin-vault-key__clear">C</span> : key}
          </Motion.button>
        );
      })}
    </Motion.div>
  );
}

export function AdminRouteLoading() {
  return (
    <main className="admin-vault admin-vault--loading">
      <div className="admin-vault-loading" role="status" aria-live="polite">
        <SecurityMark compact />
        <div>
          <span className="admin-vault-eyebrow">ENCRYPTED SESSION</span>
          <p>Đang kiểm tra quyền truy cập</p>
        </div>
        <span className="admin-vault-loading__line" aria-hidden="true" />
      </div>
    </main>
  );
}

export function AdminSecurityHandoff({ active }) {
  return (
    <AnimatePresence>
      {active && (
        <Motion.div
          className="admin-vault-handoff"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="admin-vault-handoff__grid" aria-hidden="true" />
          <div className="admin-vault-handoff__mark">
            <div className="admin-vault-handoff__seal"><span><Check /></span></div>
            <strong>ACCESS GRANTED</strong>
            <small>Đang giải mã trung tâm quản trị</small>
            <div className="admin-vault-handoff__status"><i /><span>ENCRYPTED SESSION READY</span></div>
          </div>
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
  const [recoveryResetToken, setRecoveryResetToken] = useState("");
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

  const clearRecovery = () => {
    setRecoveryStep("idle");
    setRecoveryOtp("");
    setRecoveryResetToken("");
    setRecoveryNewPin("");
    setRecoveryConfirmPin("");
    setRecoveryError("");
    setRecoveryMessage("");
    setRecoveryEmail("");
  };

  const requestRecoveryOtp = async () => {
    if (recoveryLoading) return;
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await adminRequest("/pin/recovery/request", { method: "POST", body: JSON.stringify({}) });
      setRecoveryEmail(result.maskedEmail || currentEmail || "email quản trị");
      setRecoveryOtp("");
      setRecoveryResetToken("");
      setRecoveryNewPin("");
      setRecoveryConfirmPin("");
      setRecoveryMessage(result.message || "Đã gửi OTP khôi phục PIN đến email quản trị.");
      setRecoveryStep("verify");
    } catch (requestError) {
      setRecoveryError(requestError?.message || "Không thể gửi OTP khôi phục PIN.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const verifyRecoveryOtp = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(recoveryOtp)) {
      setRecoveryError("OTP phải gồm đúng 6 chữ số.");
      return;
    }
    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await adminRequest("/pin/recovery/verify", {
        method: "POST",
        body: JSON.stringify({ otp: recoveryOtp }),
      });
      if (!result.resetToken) throw new Error("Không nhận được phiên đổi PIN sau khi xác minh OTP.");
      setRecoveryResetToken(result.resetToken);
      setRecoveryMessage(result.message || "OTP chính xác. Bây giờ bạn có thể tạo PIN mới.");
      setRecoveryStep("reset");
    } catch (verifyError) {
      setRecoveryError(verifyError?.message || "Không thể xác minh OTP.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const completeRecovery = async (event) => {
    event.preventDefault();
    if (!/^\d{4,8}$/.test(recoveryNewPin)) {
      setRecoveryError("PIN mới phải gồm từ 4 đến 8 chữ số.");
      return;
    }
    if (recoveryNewPin !== recoveryConfirmPin) {
      setRecoveryError("PIN xác nhận không trùng với PIN mới.");
      return;
    }
    if (!recoveryResetToken) {
      setRecoveryError("Bạn phải xác minh OTP trước khi đổi PIN.");
      setRecoveryStep("verify");
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError("");
    try {
      const result = await adminRequest("/pin/recovery/complete", {
        method: "POST",
        body: JSON.stringify({ resetToken: recoveryResetToken, newPin: recoveryNewPin }),
      });
      onPinChange(recoveryNewPin);
      setRecoveryMessage(result.message || "Đã đặt PIN quản trị mới.");
      setRecoveryStep("done");
    } catch (completeError) {
      setRecoveryError(completeError?.message || "Không thể đặt lại PIN quản trị.");
    } finally {
      setRecoveryLoading(false);
    }
  };

  const recoveryDescription = recoveryStep === "verify"
    ? "Nhập OTP từ email trước. Chỉ khi OTP đúng mới mở bước tạo PIN mới."
    : recoveryStep === "reset"
      ? "OTP đã xác minh. Hãy tạo PIN quản trị mới."
      : "Khôi phục PIN bằng OTP gửi trực tiếp đến email quản trị đang đăng nhập.";

  return (
    <Motion.main
      className="admin-vault admin-vault--security-gate"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: easeOut }}
    >
      <style>{compactGateCss}</style>
      <div className="admin-vault-grid" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--one" aria-hidden="true" />
      <div className="admin-vault-glow admin-vault-glow--two" aria-hidden="true" />

      <section className="admin-vault-card" aria-labelledby="admin-vault-title">
        <div className="admin-vault-card__edge" aria-hidden="true" />
        <header className="admin-vault-header">
          <div className="admin-vault-badges"><span><i /> SECURE ACCESS</span></div>
          <SecurityMark />
          <span className="admin-vault-eyebrow">HUY LOCKET · SECURITY CONSOLE</span>
          <h1 id="admin-vault-title">Xác minh quản trị</h1>
          <p>{isRecovery ? recoveryDescription : isOtp ? "Hoàn tất lớp xác thực thứ hai để mở khóa trung tâm quản trị." : hasPin ? "Nhập mã PIN bảo mật để khởi tạo phiên quản trị riêng tư." : "Tạo mã PIN quản trị gồm 4–8 chữ số để bảo vệ khu vực nhạy cảm."}</p>
          <div className="admin-vault-identity">
            <span>{(currentEmail || "HL").slice(0, 2).toUpperCase()}</span>
            <div><strong>{currentEmail || "Huy Locket"}</strong><small>{String(currentRole || "admin").replaceAll("_", " ")}</small></div>
            <ShieldCheck />
          </div>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          <Motion.div
            key={panelKey}
            className="admin-vault-panel"
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.18 }}
          >
            {verified ? (
              <div className="admin-vault-success" role="status">
                <div><Check /></div><h2>Đã xác minh</h2><p>Đang mở trung tâm quản trị…</p><span />
              </div>
            ) : isRecovery ? (
              recoveryStep === "done" ? (
                <div className="admin-vault-success" role="status">
                  <div><Check /></div><h2>Đã đổi PIN</h2><p>{recoveryMessage}</p>
                  <button type="button" className="admin-vault-back" onClick={clearRecovery}><ChevronLeft /> Dùng PIN mới để mở khóa</button><span />
                </div>
              ) : recoveryStep === "reset" ? (
                <form onSubmit={completeRecovery} className="admin-vault-form">
                  <div className="admin-vault-section-label"><KeyRound /><span>Tạo PIN quản trị mới</span><i>STEP 02</i></div>
                  <p className="admin-vault-label">{recoveryMessage}</p>
                  <label className="admin-vault-label" htmlFor="recovery-new-pin">PIN mới 4–8 chữ số</label>
                  <div className="admin-vault-input-wrap"><input id="recovery-new-pin" className="admin-vault-input admin-vault-input--pin" type="password" inputMode="numeric" maxLength={8} value={recoveryNewPin} onChange={(e) => setRecoveryNewPin(e.target.value.replace(/\D/g, ""))} disabled={busy} autoFocus required /><KeyRound /></div>
                  <label className="admin-vault-label" htmlFor="recovery-confirm-pin">Nhập lại PIN mới</label>
                  <div className="admin-vault-input-wrap"><input id="recovery-confirm-pin" className="admin-vault-input admin-vault-input--pin" type="password" inputMode="numeric" maxLength={8} value={recoveryConfirmPin} onChange={(e) => setRecoveryConfirmPin(e.target.value.replace(/\D/g, ""))} disabled={busy} required /><KeyRound /></div>
                  <VerificationButton loading={recoveryLoading} disabled={busy || recoveryNewPin.length < 4 || recoveryNewPin !== recoveryConfirmPin}>Lưu PIN quản trị mới</VerificationButton>
                  <button type="button" className="admin-vault-back" onClick={requestRecoveryOtp} disabled={busy}><ShieldCheck /> Gửi OTP mới</button>
                  <button type="button" className="admin-vault-back" onClick={clearRecovery} disabled={busy}><ChevronLeft /> Hủy khôi phục</button>
                </form>
              ) : (
                <form onSubmit={verifyRecoveryOtp} className="admin-vault-form">
                  <div className="admin-vault-section-label"><ShieldCheck /><span>Xác minh OTP qua email</span><i>STEP 01</i></div>
                  <p className="admin-vault-label">{recoveryMessage || "Nhập OTP từ email để xác minh danh tính."}{recoveryEmail ? ` Email nhận mã: ${recoveryEmail}` : ""}</p>
                  <label className="admin-vault-label" htmlFor="recovery-otp">OTP 6 chữ số</label>
                  <div className="admin-vault-input-wrap"><input id="recovery-otp" className="admin-vault-input admin-vault-input--otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={recoveryOtp} onChange={(e) => setRecoveryOtp(e.target.value.replace(/\D/g, ""))} disabled={busy} autoFocus required /><ShieldCheck /></div>
                  <VerificationButton loading={recoveryLoading} disabled={busy || recoveryOtp.length !== 6}>Xác minh OTP</VerificationButton>
                  <button type="button" className="admin-vault-back" onClick={requestRecoveryOtp} disabled={busy}><ShieldCheck /> Gửi lại OTP</button>
                  <button type="button" className="admin-vault-back" onClick={clearRecovery} disabled={busy}><ChevronLeft /> Quay lại nhập PIN</button>
                </form>
              )
            ) : isOtp ? (
              <form onSubmit={onOtpSubmit} className="admin-vault-form">
                <div className="admin-vault-section-label"><ShieldCheck /><span>Xác thực hai lớp</span><i>STEP 02</i></div>
                <label className="admin-vault-label" htmlFor="admin-vault-otp">Mã OTP 6 chữ số</label>
                <div className="admin-vault-input-wrap"><input id="admin-vault-otp" className="admin-vault-input admin-vault-input--otp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, ""))} disabled={loading} autoFocus required /><ShieldCheck /></div>
                <label className="admin-vault-trust"><input type="checkbox" checked={rememberDevice} onChange={(e) => onRememberDeviceChange(e.target.checked)} disabled={loading} /><span className="admin-vault-trust__box"><Check /></span><span><strong>Tin cậy thiết bị này trong 30 ngày</strong><small>Không yêu cầu OTP ở lần đăng nhập tiếp theo.</small></span></label>
                <VerificationButton loading={loading} verified={verified} disabled={loading || otp.length !== 6}>Xác minh & mở khóa</VerificationButton>
                <button type="button" className="admin-vault-back" onClick={onOtpBack} disabled={loading}><ChevronLeft /> Quay lại nhập PIN</button>
              </form>
            ) : (
              <form onSubmit={onPinSubmit} className="admin-vault-form">
                <div className="admin-vault-section-label"><KeyRound /><span>{hasPin ? "Mã PIN quản trị" : "Thiết lập mã PIN"}</span><i>STEP 01</i></div>
                <label className="admin-vault-label" htmlFor="admin-vault-pin">{hasPin ? "Nhập mã PIN bảo mật" : "Tạo mã PIN gồm 4–8 chữ số"}</label>
                <div className="admin-vault-input-wrap"><input id="admin-vault-pin" className="admin-vault-input admin-vault-input--pin" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => onPinChange(e.target.value.replace(/\D/g, ""))} disabled={busy} autoFocus required /><KeyRound /></div>
                <PinKeypad value={pin} onChange={onPinChange} disabled={busy} reduceMotion={reduceMotion} />
                <VerificationButton loading={loading} verified={verified} disabled={busy || !pin.trim()}>{hasPin ? "Mở khóa trung tâm quản trị" : "Tạo PIN & tiếp tục"}</VerificationButton>
                {hasPin && <button type="button" className="admin-vault-back" onClick={requestRecoveryOtp} disabled={busy}><KeyRound /> Quên mã PIN? Nhận OTP qua email</button>}
              </form>
            )}
          </Motion.div>
        </AnimatePresence>

        <AnimatePresence initial={false}>
          {visibleError && !verified && (
            <Motion.div className="admin-vault-error" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <TriangleAlert /><span>{visibleError}</span>
            </Motion.div>
          )}
        </AnimatePresence>

        <footer className="admin-vault-footer">
          <div><Sparkles /><span>TLS 1.3</span><i /><span>ENCRYPTED SESSION</span><i /><span>SESSION 30 MIN</span></div>
          <button type="button" onClick={onLeave} disabled={busy || verified}><ArrowLeft /> Quay lại Huy Locket</button>
        </footer>
      </section>
    </Motion.main>
  );
}
