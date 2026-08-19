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
const USER_UPDATE_TIMEOUT_MS = 5200;
const RELOAD_WATCHDOG_MS = 4200;
const CACHE_CLEAR_TIMEOUT_MS = 1800;

function settleWithin(promise, timeoutMs, fallback) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = window.setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) window.clearTimeout(timer);
  });
}

function makeManualRefreshUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set("_manual_update", String(Date.now()));
  return url.toString();
}

/**
 * Last-resort refresh path for Android/PWA.
 *
 * Some Android Chrome/PWA sessions can leave navigator.locks, SW update(), or
 * controllerchange pending even though the user explicitly pressed Update.
 * A manual press must never stay stuck forever: clear the old Workbox caches,
 * wake/skip a waiting worker when possible, then navigate to a cache-busted URL.
 */
async function forceFreshNavigation() {
  try {
    if ("caches" in window) {
      await settleWithin(
        caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))),
        CACHE_CLEAR_TIMEOUT_MS,
        null,
      );
    }
  } catch (error) {
    console.warn("[AppUpdateButton] cache clear skipped", error);
  }

  try {
    const registration = await settleWithin(
      navigator.serviceWorker?.getRegistration?.("/"),
      1200,
      null,
    );

    if (registration?.waiting) {
      try {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      } catch {
        /* best effort */
      }
    }

    if (registration?.update) {
      void settleWithin(registration.update(), 1600, false).catch(() => {});
    }
  } catch {
    /* navigation below remains the source of truth */
  }

  const freshUrl = makeManualRefreshUrl();
  window.location.replace(freshUrl);

  // Extremely defensive Android fallback. Normally replace() unloads this
  // document immediately; if a WebView/PWA shell swallows that navigation,
  // assigning href on the next tick forces a second navigation attempt.
  window.setTimeout(() => {
    try {
      window.location.href = freshUrl;
    } catch {
      try {
        window.location.reload();
      } catch {
        /* ignore */
      }
    }
  }, 700);
}

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
  const reloadWatchdogRef = useRef(null);

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
      if (reloadWatchdogRef.current) {
        window.clearTimeout(reloadWatchdogRef.current);
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

  const armReloadWatchdog = () => {
    if (reloadWatchdogRef.current) {
      window.clearTimeout(reloadWatchdogRef.current);
    }
    reloadWatchdogRef.current = window.setTimeout(() => {
      reloadWatchdogRef.current = null;
      void forceFreshNavigation();
    }, RELOAD_WATCHDOG_MS);
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
      // Do not let an Android navigator.locks/SW promise hold this button in a
      // permanent spinner. If the normal updater does not settle, the manual
      // path below performs one fresh navigation itself.
      const status = await settleWithin(
        userForceUpdate(),
        USER_UPDATE_TIMEOUT_MS,
        "timeout",
      );

      if (status === "offline") {
        showFeedback("offline");
        SonnerError("Đang ngoại tuyến", "Vui lòng kiểm tra kết nối mạng.");
      } else if (status === "error") {
        showFeedback("error");
        SonnerError("Kiểm tra thất bại", "Không thể kiểm tra cập nhật.");
      } else if (status === "latest") {
        // Không refresh khi đã ở bản mới nhất. Refresh vô ích có thể làm mất
        // File/blob đang giữ trong RAM trước khi media kịp được lưu bền vững.
        showFeedback("latest");
        SonnerInfo("Đã là bản mới nhất", "Không cần tải lại trang.");
      } else if (status === "busy") {
        // updateWatcher trả về busy khi đang có draft/upload/media cần bảo toàn.
        // Tuyệt đối không ép reload trong trạng thái này vì File/blob URL chỉ
        // tồn tại trong phiên hiện tại và sẽ mất ngay khi document bị tải lại.
        showFeedback("busy");
        SonnerInfo(
          "Chưa thể cập nhật",
          "Đang có ảnh/video hoặc bài đăng chưa hoàn tất. Đăng hoặc lưu xong rồi cập nhật.",
        );
      } else if (status === "timeout") {
        showFeedback("busy");
        SonnerInfo("Đang làm mới ứng dụng", "Trình cập nhật phản hồi chậm, đang tải lại trực tiếp.");
        await forceFreshNavigation();
      } else if (status === "updated" || status === "applying") {
        // updateWatcher normally reloads through controllerchange. If Android
        // never emits it or a navigation is swallowed, this watchdog guarantees
        // the page still refreshes once.
        armReloadWatchdog();
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
  else if (feedback === "busy") statusText = "Đang giữ media — chưa cập nhật";
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
