import React, { Suspense, useEffect, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import PageTransition from "./components/Effects/PageTransition";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useLocation,
  Navigate,
  useNavigate,
} from "react-router-dom";

import { publicRoutes, authRoutes, locketRoutes } from "./routes";
import { ThemeProvider } from "./context/ThemeContext";
import { AppProvider } from "./context/AppContext";
import { AnimationProvider } from "./context/AnimationContext";
import getLayout from "./layouts";
import NotFoundPage from "./components/pages/NotFoundPage";
import { Toaster } from "sonner";
import { SocketProvider, useSocket } from "./context/SocketContext";
import {
  useAuthStore,
  useStreakStore,
  useUploadQueueStore,
  useFriendStoreV3,
  useConversationsStore,
  useGroupChatStore,
  useMomentsStoreV2,
  useUserMessagesStore,
  useGroupMessagesStore,
} from "./stores";
import { showDevWarning } from "./utils/logging/devConsole";
import LoadingPageMain from "./components/pages/LoadPageMain";
import LayoutWithSidebar from "./layouts/baseLayout";
import { useOverlayDataStore } from "./stores/OverlayStores";
import GlobalThemeEffects from "./components/Effects/GlobalThemeEffects";
import OfflineBanner from "./components/OfflineBanner";
import { useMomentDraftLifecycle } from "./hooks/useMomentDraftLifecycle";
import RestoreDraftModal, {
  ReplaceDraftPrompt,
} from "./components/MomentDraft/RestoreDraftModal";
import DraftLibrary from "./components/MomentDraft/DraftLibrary";
import { useConnectivityStore } from "./stores/useConnectivityStore";
import { useUserActivityLifecycle } from "./hooks/useUserActivityLifecycle";
import GlobalBroadcastBanner from "./components/GlobalBroadcastBanner";
import AccountLockNotice from "./components/AccountLockNotice";
import AdminLockReasonEnhancer from "./components/AdminLockReasonEnhancer";
import { SlotMonitorProvider } from "./features/SlotMonitor/SlotMonitorProvider";
import {
  MAX_RECOVERY_GROUP_THREADS,
  MAX_RECOVERY_USER_THREADS,
  pickRecentLoadedThreadIds,
  shouldRunRecoverySync,
} from "./socket/realtimeRecoveryPolicy";

function App() {
  return (
    <AnimationProvider>
      <ThemeProvider>
        <SocketProvider>
          <AppProvider>
            <Router>
              <SlotMonitorProvider>
                <GlobalThemeEffects />
                <OfflineBanner />
                <GlobalBroadcastBanner />
                <AccountLockNotice />
                <AdminLockReasonEnhancer />
                <AppContent />
                {/* RestoreDraftModal disabled — library only via draft badge */}
                <RestoreDraftModal />
                <ReplaceDraftPrompt />
                <DraftLibrary />
                <Toaster />
              </SlotMonitorProvider>
            </Router>
          </AppProvider>
        </SocketProvider>
      </ThemeProvider>
    </AnimationProvider>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const { loading, isAuth, user, hydrateAuth, initAuth } = useAuthStore();
  const { isConnected, recoveryEpoch, lastRecoveryReason } = useSocket() || {};
  const recoverySyncAtRef = useRef(0);
  const syncStreak = useStreakStore((s) => s.syncStreak);
  const fetchCaptionOverlays = useOverlayDataStore((s) => s.fetchCaptionOverlays);
  const startRealtimeRefresh = useOverlayDataStore(
    (s) => s.startRealtimeRefresh,
  );
  const stopRealtimeRefresh = useOverlayDataStore(
    (s) => s.stopRealtimeRefresh,
  );
  const hydrateUploadQueue = useUploadQueueStore((s) => s.hydrateUploadQueue);
  const fetchAndSyncFriends = useFriendStoreV3((s) => s.fetchAndSyncFriends);

  const fetchConversations = useConversationsStore((s) => s.fetchConversations);
  const fetchAndSyncGroups = useGroupChatStore((s) => s.fetchAndSyncGroups);
  const location = useLocation();

  // Unpublished moment draft: autosave + restore modal (IndexedDB)
  useMomentDraftLifecycle();
  useUserActivityLifecycle(isAuth);

  // Online/offline + health (no aggressive ping — store throttles)
  useEffect(() => {
    return useConnectivityStore.getState().startConnectivityWatch();
  }, []);

  // Socket reconnects can miss moments/messages/group updates while the browser
  // is offline, the server restarts, or a mobile tab is suspended. Once the
  // socket is healthy again, catch up from HTTP without reloading the page.
  useEffect(() => {
    if (!user?.uid) return undefined;

    const now = Date.now();
    const online =
      typeof navigator === "undefined" || navigator.onLine !== false;
    const visibilityState =
      typeof document === "undefined" ? "visible" : document.visibilityState;

    if (
      !shouldRunRecoverySync({
        recoveryEpoch,
        isConnected,
        online,
        visibilityState,
        lastSyncAt: recoverySyncAtRef.current,
        now,
      })
    ) {
      return undefined;
    }

    recoverySyncAtRef.current = now;
    let cancelled = false;

    const runRecoverySync = async () => {
      const userMessageState = useUserMessagesStore.getState().messages;
      const groupMessageState = useGroupMessagesStore.getState().messages;
      const userThreadIds = pickRecentLoadedThreadIds(
        userMessageState,
        MAX_RECOVERY_USER_THREADS,
      );
      const groupThreadIds = pickRecentLoadedThreadIds(
        groupMessageState,
        MAX_RECOVERY_GROUP_THREADS,
      );

      const tasks = [
        useMomentsStoreV2.getState().pullLatestMoments(),
        useConversationsStore.getState().fetchConversations(),
        useGroupChatStore.getState().syncGroupsDelta(),
        // Silent but forced: friend adds/removals can also happen while the tab
        // is asleep and should not require a manual refresh.
        useFriendStoreV3.getState().fetchAndSyncFriends(true, true),
        // If connectivity returned during an upload, resume only items allowed
        // by the existing upload recovery policy.
        useUploadQueueStore.getState().resumeQueue(),
        ...userThreadIds.map((conversationId) =>
          useUserMessagesStore.getState().getMessagesByUser(conversationId),
        ),
        ...groupThreadIds.map((groupId) =>
          useGroupMessagesStore.getState().fetchGroupMessages(groupId),
        ),
      ];

      const results = await Promise.allSettled(tasks);
      if (cancelled) return;

      const failed = results.filter((result) => result.status === "rejected").length;
      try {
        window.dispatchEvent(
          new CustomEvent("huy-locket-realtime-recovered", {
            detail: {
              recoveryEpoch,
              reason: lastRecoveryReason || "socket-reconnect",
              failed,
              completed: results.length - failed,
              at: Date.now(),
            },
          }),
        );
      } catch {
        /* optional recovery signal */
      }
    };

    void runRecoverySync();
    return () => {
      cancelled = true;
    };
  }, [isConnected, recoveryEpoch, lastRecoveryReason, user?.uid]);

  const allRoutes = [...publicRoutes, ...authRoutes, ...locketRoutes];
  const privateRoutes = [...authRoutes, ...locketRoutes];

  function setMeta(selector, content) {
    let el = document.querySelector(selector);
    if (el) el.setAttribute("content", content);
  }
  useEffect(() => {
    import("./styles/animation.css");
    // Đánh thức API (cold start) — limited retries, not a battery drain loop
    let cancelled = false;
    const wakeApi = async () => {
      const delays = [0, 2000, 5000, 10000];
      for (let i = 0; i < delays.length && !cancelled; i++) {
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        try {
          const r = await fetch("/dio-api/health", {
            method: "GET",
            credentials: "include",
            cache: "no-store",
          });
          if (r.ok) {
            useConnectivityStore.getState()._applyResult(true, true);
            return;
          }
        } catch {
          /* cold start — thử tiếp */
        }
      }
    };
    wakeApi();
    // Giữ API ấm khi tab còn mở (10 phút — không ping liên tục)
    const keepAlive = setInterval(() => {
      if (document.hidden) return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      fetch("/dio-api/health", {
        method: "GET",
        credentials: "include",
        cache: "no-store",
      })
        .then((r) => {
          useConnectivityStore
            .getState()
            ._applyResult(true, Boolean(r?.ok));
        })
        .catch(() => {
          useConnectivityStore.getState()._applyResult(
            navigator.onLine !== false,
            false,
          );
        });
    }, 10 * 60 * 1000);
    // Token local → coi như đã login ngay (không chờ API)
    hydrateAuth();
    initAuth();
    showDevWarning();
    // Caption Season / overlays: load + realtime refilter (start_at / daily hours)
    fetchCaptionOverlays().finally(() => {
      try {
        startRealtimeRefresh();
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
      clearInterval(keepAlive);
      try {
        stopRealtimeRefresh();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Đã đăng nhập → luôn vào camera (không kẹt trang chủ / login)
  useEffect(() => {
    if (loading) return;
    if (!isAuth) return;

    const entryPaths = new Set(["/", "/login", "/home"]);
    if (entryPaths.has(location.pathname)) {
      navigate("/locket", { replace: true });
    }
  }, [isAuth, loading, location.pathname, navigate]);

  useEffect(() => {
    if (!user) return;
    // Defer secondary data so camera first paint isn't blocked
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      // Force sync lần đầu sau login (tránh list rỗng do cache)
      fetchAndSyncFriends(false, true);
      syncStreak();
      hydrateUploadQueue();
      fetchConversations();
      fetchAndSyncGroups();
    };
    let cancelIdle = () => {};
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(run, { timeout: 1800 });
      cancelIdle = () => cancelIdleCallback(id);
    } else {
      const t = setTimeout(run, 200);
      cancelIdle = () => clearTimeout(t);
    }
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [user]);

  useEffect(() => {
    const r = allRoutes.find((route) => route.path === location.pathname);
    document.title = r?.title || "Huy Locket - Đăng ảnh & Video lên Locket";

    const url = window.location.origin + location.pathname;
    (
      document.querySelector("link[rel='canonical']") ||
      document.head.appendChild(
        Object.assign(document.createElement("link"), { rel: "canonical" }),
      )
    ).href = url;

    setMeta("meta[property='og:title']", document.title);
    setMeta("meta[property='og:url']", url);
    setMeta("meta[name='twitter:title']", document.title);
  }, [location.pathname]);

  // if (loading) return <LoadingPageMain isLoading={true} />;

  // OAuth callback luôn mount (kể cả khi đã login — không redirect)
  const alwaysPublicPaths = new Set(["/spotify/callback"]);

  return (
    <>
      <Suspense fallback={<LoadingPageMain isLoading={true} />}>
        <AnimatePresence mode="wait">
          <Routes location={location} key={location.pathname}>
            {(isAuth ? privateRoutes : publicRoutes).map(
              // eslint-disable-next-line no-unused-vars
              ({ path, component: Component }) => {
                const Layout = getLayout(path);
                return (
                  <Route
                    key={path}
                    path={path}
                    element={
                      <LayoutWithSidebar Layout={Layout}>
                        <PageTransition preset={path === "/admin/users" ? "admin" : "default"}>
                          <Component />
                        </PageTransition>
                      </LayoutWithSidebar>
                    }
                  />
                );
              },
            )}

            {/* Route public luôn mở (Spotify OAuth callback…) — cả khi đã login */}
            {isAuth &&
              publicRoutes
                .filter(({ path }) => alwaysPublicPaths.has(path))
                // eslint-disable-next-line no-unused-vars
                .map(({ path, component: Component }) => {
                  const Layout = getLayout(path);
                  return (
                    <Route
                      key={`always-pub-${path}`}
                      path={path}
                      element={
                        <LayoutWithSidebar Layout={Layout}>
                          <PageTransition preset={path === "/admin/users" ? "admin" : "default"}>
                            <Component />
                          </PageTransition>
                        </LayoutWithSidebar>
                      }
                    />
                  );
                })}

            {/* Điều hướng khi chưa đăng nhập cố vào route cần auth */}
            {!loading &&
              !isAuth &&
              privateRoutes.map(({ path }) => (
                <Route
                  key={path}
                  path={path}
                  element={<Navigate to="/login" replace />}
                />
              ))}

            {/* Đã login mà vào public (/) → camera */}
            {!loading &&
              isAuth &&
              publicRoutes
                .filter(
                  ({ path }) =>
                    // Chỉ redirect entry public; route trùng auth (settings…) đã có ở privateRoutes
                    // Không redirect OAuth callback
                    !alwaysPublicPaths.has(path) &&
                    (path === "/" ||
                      path === "/login" ||
                      path === "/forgot-password"),
                )
                .map(({ path }) => (
                  <Route
                    key={`pub-redir-${path}`}
                    path={path}
                    element={<Navigate to="/locket" replace />}
                  />
                ))}

            {/* Catch-all: đã login → camera; chưa login → login */}
            <Route
              path="*"
              element={
                loading ? (
                  <LoadingPageMain isLoading={true} />
                ) : isAuth ? (
                  <Navigate to="/locket" replace />
                ) : (
                  <Navigate to="/login" replace />
                )
              }
            />
          </Routes>
        </AnimatePresence>
      </Suspense>
      <LoadingPageMain isLoading={loading} />
    </>
  );
}

export default App;