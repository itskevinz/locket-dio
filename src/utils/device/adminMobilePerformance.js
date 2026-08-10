const ADMIN_MIN_INTERVAL_MS = 15_000;
const INSTALL_FLAG = "__huyAdminMobilePerfInstalled";

function isAdminPath() {
  try {
    return /^\/admin(?:\/|$)/i.test(window.location.pathname || "");
  } catch {
    return false;
  }
}

/**
 * Admin pages poll multiple realtime endpoints (3s/5s/10s). On Android phones
 * that can repeatedly rebuild large admin tables while the user is scrolling.
 * Clamp only short setInterval loops created while an /admin route is active.
 * Other app routes and longer background timers keep their original cadence.
 */
export function initAdminMobilePerformance() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (window[INSTALL_FLAG]) return;

  const root = document.documentElement;
  const mobile = root.classList.contains("perf-mobile");
  const lite = root.classList.contains("perf-lite");
  if (!mobile && !lite) return;

  const nativeSetInterval = window.setInterval.bind(window);

  window.setInterval = (handler, timeout = 0, ...args) => {
    const requested = Number(timeout) || 0;
    const delay =
      isAdminPath() && requested > 0 && requested < ADMIN_MIN_INTERVAL_MS
        ? ADMIN_MIN_INTERVAL_MS
        : requested;
    return nativeSetInterval(handler, delay, ...args);
  };

  window[INSTALL_FLAG] = true;
}
