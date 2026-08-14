import { clearAllDB } from "@/cache/configDB";
import {
  GetUserDataV2,
  GetUserLocket,
  logout,
  syncPushSubscription,
  updateUserInfo,
} from "@/services";
import {
  getToken,
  removeToken,
  saveMemberToken,
  clearMemberToken,
  saveUserCache,
  getUserCache,
  clearUserCache,
} from "@/utils";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { endUserActivitySession } from "@/services/UserActivityService";

const ONE_DAY = 1000 * 60 * 60 * 24;

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      userPlan: null,
      uploadStats: null,
      isAuth: false,
      loading: true,

      lastSyncAt: 0,
      lastFetchPlanAt: 0,

      // =========================
      // HYDRATE
      // =========================
      hydrateAuth: () => {
        const { idToken, refreshToken } = getToken() || {};
        const token = idToken || refreshToken;

        if (!token) {
          set({
            user: null,
            isAuth: false,
            loading: false,
          });
          return;
        }

        // ⚡ Có token → đăng nhập ngay, vào camera không chờ API
        const cachedUser = get()?.user || null;
        set({
          isAuth: true,
          loading: false,
          ...(cachedUser ? { user: cachedUser } : {}),
        });
      },

      // =========================
      // INIT
      // =========================
      initAuth: async () => {
        const { idToken, refreshToken } = getToken() || {};
        const token = idToken || refreshToken;
        if (!token) {
          set({
            user: null,
            userPlan: null,
            uploadStats: null,
            isAuth: false,
            loading: false,
          });
          return;
        }

        const now = Date.now();
        const { lastFetchPlanAt, lastSyncAt } = get();

        try {
          // =========================
          // 1. Fetch plan nếu quá TTL (không đá login nếu plan API lỗi)
          // =========================
          if (!lastFetchPlanAt || now - lastFetchPlanAt > 5 * 60 * 1000) {
            try {
              const planRes = await GetUserDataV2();
              if (planRes) {
                saveMemberToken(planRes?.session);
                set({
                  userPlan: planRes,
                  uploadStats: planRes?.upload_stats,
                  lastFetchPlanAt: now,
                });
              }
            } catch (planErr) {
              console.warn(
                "Plan fetch failed (login still kept):",
                planErr?.message || planErr,
              );
            }
          }

          // =========================
          // 2. Fetch user nếu chưa có
          // =========================
          let { user } = get();

          if (!user) {
            try {
              user = await GetUserLocket();
              if (user) set({ user });
            } catch (userErr) {
              console.warn(
                "GetUserLocket failed:",
                userErr?.message || userErr,
              );
            }
          }

          // =========================
          // 3. Background sync (1 ngày)
          // =========================
          if (!lastSyncAt || now - lastSyncAt > ONE_DAY) {
            if (user) updateUserInfo(user).catch(() => {});
            syncPushSubscription().catch(() => {});

            set({ lastSyncAt: now });
          }

          // Token còn → giữ session; plan/user lỗi không được đá ra login
          set({ isAuth: true, loading: false });
        } catch (err) {
          console.error("Auth init error:", err);
          // Chỉ clear session nếu token thực sự hỏng (401 do interceptor)
          const status = err?.status || err?.response?.status;
          if (status === 401) {
            set({
              user: null,
              userPlan: null,
              uploadStats: null,
              isAuth: false,
              loading: false,
            });
          } else {
            set({ isAuth: true, loading: false });
          }
        }
      },

      // =========================
      // FORCE REFRESH
      // =========================
      fetchUserData: async () => {
        try {
          set({ loading: true });

          const planRes = await GetUserDataV2();

          saveMemberToken(planRes?.session);

          // Đồng bộ thống kê từ bài đã đăng (moments của user)
          let uploadStats = planRes?.upload_stats || null;
          try {
            const {
              syncUploadStatsFromPosts,
              loadCachedUploadStats,
            } = await import("@/utils/syncUploadStatsFromPosts");
            const { syncUploadStatsToServer } = await import(
              "@/services/LocketDioServices/MemberPlans"
            );
            // Show cache immediately if plan stats are empty
            const cached = loadCachedUploadStats();
            if (
              cached &&
              (!uploadStats ||
                !(
                  Number(uploadStats.image_uploaded || uploadStats.image_uploads) ||
                  Number(uploadStats.video_uploaded || uploadStats.video_uploads)
                ))
            ) {
              uploadStats = cached;
            }
            const synced = await syncUploadStatsFromPosts();
            if (synced) {
              uploadStats = synced;
              // Best-effort persist on API so next /api/cn returns real numbers
              await syncUploadStatsToServer(synced);
              // Re-fetch plan to merge server copy (optional soft)
              if (planRes) {
                planRes.upload_stats = synced;
              }
            }
          } catch (syncErr) {
            console.warn(
              "upload stats sync skipped:",
              syncErr?.message || syncErr,
            );
          }

          set({
            userPlan: planRes
              ? { ...planRes, upload_stats: uploadStats || planRes.upload_stats }
              : planRes,
            uploadStats,
            lastFetchPlanAt: Date.now(),
            loading: false,
          });
        } catch (err) {
          console.error("fetchUserData error:", err);
          set({ loading: false });
        }
      },

      // =========================
      // LOGOUT
      // =========================
      clearAndlogout: async () => {
        // Warn if drafts still pending account sync
        try {
          const { listDraftsMeta, resolveDraftUid, SYNC_STATUS, syncAll } =
            await import("@/utils/momentDraft");
          const uid = resolveDraftUid();
          if (uid) {
            const rows = await listDraftsMeta(uid);
            const pending = rows.filter(
              (d) =>
                d.syncStatus === SYNC_STATUS.PENDING_SYNC ||
                d.syncStatus === SYNC_STATUS.SYNC_FAILED ||
                d.syncStatus === SYNC_STATUS.SYNCING ||
                !d.syncStatus,
            );
            if (pending.length > 0) {
              const syncFirst = window.confirm(
                `Có ${pending.length} bản nháp chưa đồng bộ.\n\nOK = đồng bộ rồi đăng xuất\nCancel = giữ trên thiết bị và đăng xuất`,
              );
              if (syncFirst) {
                try {
                  await syncAll();
                } catch (e) {
                  console.warn("sync before logout", e);
                  const still = window.confirm(
                    "Đồng bộ chưa xong. Vẫn đăng xuất và giữ bản nháp trên thiết bị?",
                  );
                  if (!still) return;
                }
              }
            }
          }
        } catch (e) {
          console.warn("logout draft check", e);
        }

        // Best-effort close the verified website session while the ID token still exists.
        try {
          await endUserActivitySession();
        } catch (error) {
          console.warn("[activity] logout event was not recorded:", error.code || error.message);
        }

        // 1) Xóa token / storage TRƯỚC — tránh hydrateAuth set lại isAuth
        removeLocalStorage();
        removeToken();
        clearMemberToken();
        clearUserCache();

        // 2) Clear state ngay (sync) để route public mở được
        set({
          user: null,
          userPlan: null,
          uploadStats: null,
          isAuth: false,
          loading: false,
          lastSyncAt: 0,
          lastFetchPlanAt: 0,
        });

        // Clear in-memory draft UI so next account never sees old list
        try {
          const { useMomentDraftStore } = await import(
            "@/stores/PostStores/useMomentDraftStore"
          );
          useMomentDraftStore.setState({
            drafts: [],
            draftCount: 0,
            hasDraft: false,
            draftMeta: null,
            activeDraftId: null,
            libraryOpen: false,
          });
          useMomentDraftStore.getState().clearThumbnail?.();
        } catch {
          /* ignore */
        }

        // 3) Clear HuyLocketDB caches only (momentDraftDB is separate; scoped by ownerUid)
        try {
          await clearAllDB();
        } catch (e) {
          console.warn("clearAllDB:", e?.message || e);
        }

        // 4) Gọi API logout — lỗi cũng bỏ qua (đã clear local)
        try {
          await logout();
        } catch (e) {
          console.warn("logout API:", e?.message || e);
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
        userPlan: state.userPlan,
        uploadStats: state.uploadStats,
        lastSyncAt: state.lastSyncAt,
        lastFetchPlanAt: state.lastFetchPlanAt,
      }),
    },
  ),
);

function removeLocalStorage() {
  localStorage.removeItem("friendsUpdatedAt");
  localStorage.removeItem("friendsLastSync");
  localStorage.removeItem("huylocket-welcome-seen");
  localStorage.removeItem("rememberMe");
  localStorage.removeItem("isFullview");
}
