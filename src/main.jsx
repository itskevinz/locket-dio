import { createRoot } from "react-dom/client";
import "./i18n";
import "../tailwind.css";
import "./index.css";
import "./styles/animation.css";
import "./styles/interaction-motion.css";
import "./styles/performance-lite.css";
import "./styles/essential-motion.css";
import "./styles/motion-policy.css";
import "./styles/admin-gate.css";
import "./styles/admin-gate-motion.css";
import "./styles/admin-security-live-motion.css";
import "./styles/admin-security-page-transitions.css";
import "./styles/admin-login-color-v2.css";
import "./styles/admin-login-rgb-v3.css";
import "./styles/admin-auth-result-v4.css";
import "./styles/admin-login-compact-rgb-v5.css";
import "./styles/admin-login-theme-rgb-border-v6.css";
import "./styles/admin-verify-input-border-v7.css";
import "./styles/admin-auth-visible-v8.css";
import "./styles/admin-success-page-transition-v9.css";
import "./styles/admin-success-page-transition-v10.css";
import "./styles/admin-security-mobile-v11.css";
import "./styles/admin-mobile-performance-v12.css";
import App from "./App.jsx";

import ErrorBoundary from "./components/pages/ErrorBoundary";
import {
  initPWA,
  initPWAInstallPrompt,
  initReloadState,
  startUpdateWatcher,
} from "./utils";
import { applyPerfClasses } from "./utils/device/perfProfile";
import { initAdminMobilePerformance } from "./utils/device/adminMobilePerformance";
import { bootThemeEarly } from "./utils/theme/themeUtils";

bootThemeEarly();
applyPerfClasses();
initAdminMobilePerformance();
initReloadState();

try {
  initPWAInstallPrompt();
} catch {
  /* ignore */
}

const rootEl = document.getElementById("root");
if (rootEl) {
  try {
    rootEl.setAttribute("translate", "no");
  } catch {
    /* ignore */
  }

  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

try {
  initPWA();
} catch {
  /* ignore */
}
const defer = (fn) => {
  if (typeof window !== "undefined" && window.requestIdleCallback) {
    window.requestIdleCallback(fn, { timeout: 3000 });
  } else {
    setTimeout(fn, 500);
  }
};
defer(() => {
  try {
    startUpdateWatcher();
  } catch {
    /* ignore */
  }
});