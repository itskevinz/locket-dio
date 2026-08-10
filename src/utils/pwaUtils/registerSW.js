import {
  handleServiceWorkerUpdate,
  setServiceWorkerCheck,
} from "./updateWatcher";

const SW_URL = "/sw.js";
const SW_SCOPE = "/";
const UPDATE_CHECK_MS = 10 * 60 * 1000;
const UPDATE_REQUEST_TIMEOUT_MS = 3500;

let initialized = false;
let initPromise = null;
let registration = null;
let registrationUpdatePromise = null;
let updateTimer = null;
let notifiedWaitingWorker = null;
let visibilityHandler = null;
let updateFoundHandler = null;
const workerStateHandlers = new Map();

function settleWithin(promise, timeoutMs, fallback = false) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function removeWorkerStateHandler(worker) {
  const handler = workerStateHandlers.get(worker);
  if (!handler) return;
  worker.removeEventListener("statechange", handler);
  workerStateHandlers.delete(worker);
}

function notifyWaitingWorker() {
  const waitingWorker = registration?.waiting;
  if (!waitingWorker) return false;
  if (waitingWorker === notifiedWaitingWorker) return true;

  notifiedWaitingWorker = waitingWorker;
  handleServiceWorkerUpdate(async () => {
    const worker = registration?.waiting || waitingWorker;
    if (!worker || worker.state === "redundant") return false;
    worker.postMessage({ type: "SKIP_WAITING" });
    return true;
  });
  return true;
}

function watchInstallingWorker(worker) {
  if (!worker || workerStateHandlers.has(worker)) return;

  const onStateChange = () => {
    if (worker.state === "installed") {
      removeWorkerStateHandler(worker);
      if (navigator.serviceWorker.controller) {
        notifyWaitingWorker();
      } else {
        console.log("[PWA] offline ready — shell cached");
      }
    } else if (worker.state === "redundant") {
      removeWorkerStateHandler(worker);
    }
  };

  workerStateHandlers.set(worker, onStateChange);
  worker.addEventListener("statechange", onStateChange);
  onStateChange();
}

function requestRegistrationUpdate() {
  if (registrationUpdatePromise) return registrationUpdatePromise;

  registrationUpdatePromise = (async () => {
    let currentRegistration = registration;

    // navigator.serviceWorker.register()/update() can occasionally stay pending
    // for a long time on Android when Chrome/PWA networking is waking up. A
    // manual update button must never wait forever for that best-effort check;
    // version.json remains the source of truth in updateWatcher.
    if (!currentRegistration && initPromise) {
      currentRegistration = await settleWithin(
        initPromise,
        UPDATE_REQUEST_TIMEOUT_MS,
        null,
      );
    }

    if (!currentRegistration) {
      try {
        currentRegistration = await settleWithin(
          navigator.serviceWorker?.getRegistration?.(SW_SCOPE),
          UPDATE_REQUEST_TIMEOUT_MS,
          null,
        );
        if (currentRegistration) registration = currentRegistration;
      } catch {
        currentRegistration = null;
      }
    }

    if (!currentRegistration) return false;

    try {
      await settleWithin(
        currentRegistration.update(),
        UPDATE_REQUEST_TIMEOUT_MS,
        false,
      );
    } catch {
      // Do not block the version.json check if SW update() fails.
    }

    watchInstallingWorker(currentRegistration.installing);
    return notifyWaitingWorker();
  })().finally(() => {
    registrationUpdatePromise = null;
  });

  return registrationUpdatePromise;
}

/**
 * Register and observe the PWA service worker.
 * Applying a waiting worker and reloading are owned only by updateWatcher.
 */
export function initPWA() {
  if (initPromise) return initPromise;
  if (
    initialized ||
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator)
  ) {
    return Promise.resolve(registration);
  }

  initialized = true;
  initPromise = navigator.serviceWorker
    .register(SW_URL, { scope: SW_SCOPE })
    .then((registered) => {
      registration = registered;
      console.log("[PWA] registered", SW_URL, "scope", registered.scope);

      updateFoundHandler = () => {
        watchInstallingWorker(registration?.installing);
      };
      registration.addEventListener("updatefound", updateFoundHandler);

      watchInstallingWorker(registration.installing);
      notifyWaitingWorker();

      visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        void requestRegistrationUpdate().catch(() => {});
      };
      document.addEventListener("visibilitychange", visibilityHandler);

      updateTimer = setInterval(() => {
        if (document.hidden) return;
        void requestRegistrationUpdate().catch(() => {});
      }, UPDATE_CHECK_MS);

      return registration;
    })
    .catch((error) => {
      console.warn("[PWA] registration failed", error);
      initialized = false;
      initPromise = null;
      return null;
    });

  setServiceWorkerCheck(requestRegistrationUpdate);
  return initPromise;
}

export function disposePWA() {
  if (updateTimer) {
    clearInterval(updateTimer);
    updateTimer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (registration && updateFoundHandler) {
    registration.removeEventListener("updatefound", updateFoundHandler);
    updateFoundHandler = null;
  }
  for (const worker of workerStateHandlers.keys()) {
    removeWorkerStateHandler(worker);
  }

  setServiceWorkerCheck(null);
  notifiedWaitingWorker = null;
  registrationUpdatePromise = null;
  registration = null;
  initPromise = null;
  initialized = false;
}
