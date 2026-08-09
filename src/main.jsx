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
import App from "./App.jsx";

import ErrorBoundary from "./components/pages/ErrorBoundary";
import {
  initPWA,
  initPWAInstallPrompt,
  initReloadState,
  startUpdateWatcher,
} from "./utils";
import { applyPerfClasses } from "./utils/device/perfProfile";
import { bootThemeEarly } from "./utils/theme/themeUtils";

// Theme + snow intensity before first paint (localStorage)
bootThemeEarly();

// Android / mobile: class perf-lite để giảm blur + effect
applyPerfClasses();

// init chunk recovery flags
initReloadState();

// Capture Chromium's install event as early as possible so Settings can show an Install button later.
try {
  initPWAInstallPrompt();
} catch {
  /* ignore */
}

const rootEl = document.getElementById("root");
if (rootEl) {
  // Chống Google Translate / extension bọc text → removeChild
  try {
    rootEl.setAttribute("translate", "no");
  } catch {
    /* ignore */
  }

  // KHÔNG StrictMode production — double-mount + DOM manual (cam/snow) hay gây removeChild
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

// PWA: register SW ASAP so offline shell is ready after first visit.
// Keep this entrypoint touched by production deploys so Vercel and Railway
// receive the same frontend revision after motion fixes.
// Deploy sync marker: 2026-08-10 colorful Admin login v2 production publish.
// Update watcher can wait — not needed for offline control.
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