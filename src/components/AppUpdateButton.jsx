import React, { useEffect, useRef, useState } from "react";
import {
  APP_UPDATE_PHASE,
  subscribeAppUpdate,
  userForceUpdate,
  checkForAppUpdate,
} from "@/utils/pwaUtils/updateWatcher";
import { AlertTriangle, Check, Download, RefreshCw } from "lucide-react";
import { SonnerInfo, SonnerError } from "@/components/uikit/SonnerToast";
import "./AppUpdateButton.css";

const FEEDBACK_MS = 1400;

/**
 * Nút tròn cập nhật — luôn hiện cạnh avatar hồ sơ.
 * Dùng chung updateWatcher để việc check/apply/reload chỉ có một nguồn sự thật.
 */
export default function AppUpdateButton({ className = "" }) {
  const [updateState, setUpdateState] = useState({
    phase: APP_UPDATE_PHASE.IDLE,
    available: false,
  });
  const [clicking, setClicking] = useState(false);
  const [feedback, setFeedback] = useState("");
  const feedbackTimerRef = useRef(null);

  useEffect(() => {
    checkForAppUpdate().catch(() => {});
    return subscribeAppUpdate((state) => {
      setUpdateState((current) => ({ ...current, ...state }));
      if (
        state?.phase === APP_UPDATE_PHASE.APPLYING ||
        state?.phase === APP_UPDATE_PHASE.RELOADING
      ) {
        setFeedback("");
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (feedbackTimerRef.current) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    },
    [],
  );

  const showFeedback = (value) => {
    if (feedbackTimerRef.current) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    setFeedback(value);
    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedback("");
      feedbackTimerRef.current = null;
    }, FEEDBACK_MS);
  };

  const phase = updateState.phase || APP_UPDATE_PHASE.IDLE;
  const hasUpdate = Boolean(updateState.available);
  const busyPhase =
    phase === APP_UPDATE_PHASE.CHECKING ||
    phase === APP_UPDATE_PHASE.APPLYING ||
    phase === APP_UPDATE_PHASE.RELOADING;
  const loading = clicking || busyPhase;

  const onClick = async (e) => {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    if (loading) return;

    setFeedback("");
    setClicking(true);
    try {
      const status = await userForceUpdate();

      if (status === "latest") {
        showFeedback("latest");
        SonnerInfo("Đang dùng bản mới nhất", "Chưa có phiên bản mới hơn trên máy chủ.");
      } else if (status === "offline") {
        showFeedback("offline");
        SonnerError("Đang ngoại tuyến", "Vui lòng kiểm tra kết nối mạng.");
      } else if (status === "error") {
        showFeedback("error");
        SonnerError("Kiểm tra thất bại", "Không thể kiểm tra cập nhật.");
      } else if (status === "busy") {
        showFeedback("busy");
      } else if (status === "updated" || status === "applying") {
        // updateWatcher owns the applying/reloading state and the one guarded reload.
      }
    } catch (err) {
      console.error("[AppUpdateButton]", err);
      showFeedback("error");
      SonnerError("Kiểm tra thất bại", "Vui lòng thử lại sau.");
    } finally {
      setClicking(false);
    }
  };

  let statusText = "";
  if (feedback === "latest") statusText = "Đã là bản mới nhất";
  else if (feedback === "offline") statusText = "Mất kết nối mạng";
  else if (feedback === "error") statusText = "Kiểm tra cập nhật lỗi";
  else if (feedback === "busy") statusText = "Đang bận — sẽ cập nhật sau";
  else if (phase === APP_UPDATE_PHASE.CHECKING || clicking)
    statusText = "Đang kiểm tra…";
  else if (phase === APP_UPDATE_PHASE.UPDATE_READY) statusText = "Có bản mới";
  else if (phase === APP_UPDATE_PHASE.APPLYING) statusText = "Đang cập nhật…";
  else if (phase === APP_UPDATE_PHASE.RELOADING) statusText = "Đang tải bản mới…";

  const Icon =
    feedback === "latest"
      ? Check
      : feedback === "error" || feedback === "offline"
        ? AlertTriangle
        : phase === APP_UPDATE_PHASE.UPDATE_READY && !clicking
          ? Download
          : RefreshCw;

  const title = hasUpdate
    ? "Có bản mới — bấm để cập nhật"
    : loading
      ? "Đang kiểm tra cập nhật"
      : "Kiểm tra / cập nhật Huy Locket";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-label="Cập nhật ứng dụng"
      aria-busy={loading}
      title={title}
      data-update-button="true"
      data-update-phase={phase}
      data-feedback={feedback || undefined}
      className={`app-update-button flex items-center justify-center w-11 h-11
        rounded-full bg-base-300/70 text-base-content backdrop-blur-[4px]
        hover:bg-base-300 active:scale-95
        disabled:cursor-wait shrink-0 ${className}`}
    >
      {hasUpdate && !loading && !feedback ? (
        <span className="app-update-button__dot" aria-hidden />
      ) : null}

      <Icon
        size={22}
        strokeWidth={feedback === "latest" ? 2.8 : 2.2}
        className="app-update-button__icon"
        aria-hidden
      />

      {statusText ? (
        <span className="app-update-button__status" role="status" aria-live="polite">
          {statusText}
        </span>
      ) : null}
    </button>
  );
}
