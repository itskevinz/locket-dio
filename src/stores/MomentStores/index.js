import { create } from "zustand";
import { GetAllMoments } from "@/services";
import { MOMENTS_CONFIG } from "@/config/configAlias";
import {
  bulkAddMoments,
  deleteMomentById,
  getAllMoments,
  getMomentsByUser,
} from "@/cache/momentDB";
import { mergeMomentMediaFields } from "@/utils/moment/momentMediaFields";
import { mergeStableMomentOrder } from "@/utils/moment/stableMomentOrder";

const { initialVisible, loadMoreLimit } = MOMENTS_CONFIG;

/* --------------------------------------------------
 * Default bucket
 * -------------------------------------------------- */
const defaultBucket = () => ({
  moments: [],
  loading: false,
  hasMore: true,
  isLoadingMore: false,
  visibleCount: initialVisible,
  nextCursorSeconds: null,
});

/** createTime luôn là ms number — tránh sort NaN làm bài "biến mất" */
function toCreateTimeMs(v) {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v > 0 && v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string" && v.trim()) {
    const n = Date.parse(v);
    return Number.isNaN(n) ? 0 : n;
  }
  if (v && typeof v === "object") {
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return 0;
}

function getMomentDateMs(moment) {
  return (
    toCreateTimeMs(moment?.date) ||
    toCreateTimeMs(moment?.createTime) ||
    0
  );
}

function getMomentCursorSeconds(moment) {
  const ms = getMomentDateMs(moment);
  return ms > 0 ? Math.floor(ms / 1000) : null;
}

function hasMusicOverlay(m) {
  const o = m?.overlays;
  if (!o) return false;
  if (o.type === "music" || o.overlay_id === "caption:music") return true;
  if (o.payload?.isrc || o.payload?.song_title) return true;
  const cap = Array.isArray(m?.captions) ? m.captions[0] : null;
  return Boolean(cap?.type === "music" || cap?.payload?.isrc);
}

/**
 * Merge moment: không xóa bài local; giữ overlay nhạc nếu API trả thiếu.
 */
function mergeMoment(local, incoming) {
  if (!incoming && !local) return null;
  if (!incoming) {
    return {
      ...local,
      createTime: toCreateTimeMs(local.createTime) || Date.now(),
    };
  }
  if (!local) {
    return {
      ...incoming,
      createTime: getMomentDateMs(incoming) || Date.now(),
    };
  }

  const createTime = Math.max(
    getMomentDateMs(local),
    getMomentDateMs(incoming),
    0,
  );

  const preferLocalMusic =
    hasMusicOverlay(local) && !hasMusicOverlay(incoming);

  return {
    ...local,
    ...incoming,
    createTime: createTime || Date.now(),
    overlays: preferLocalMusic
      ? local.overlays
      : incoming.overlays || local.overlays,
    captions: preferLocalMusic
      ? local.captions
      : incoming.captions || local.captions,
    ...mergeMomentMediaFields(local, incoming),
  };
}

function sortByCreateTimeDesc(list) {
  return [...list].sort(
    (a, b) => getMomentDateMs(b) - getMomentDateMs(a)
  );
}

function mergeFreshMomentsStable(existing, incoming) {
  return mergeStableMomentOrder(
    existing,
    sortByCreateTimeDesc(incoming),
    mergeMoment,
  );
}

function appendOlderMomentsStable(existing, incoming) {
  return mergeStableMomentOrder(
    existing,
    sortByCreateTimeDesc(incoming),
    mergeMoment,
    { newItemsAt: "end" },
  );
}

/* --------------------------------------------------
 * Store
 * -------------------------------------------------- */
export const useMomentsStoreV2 = create((set, get) => ({
  momentsByUser: {},

  ensureBucket: (key) => {
    set((state) => {
      if (state.momentsByUser[key]) return state;
      return {
        momentsByUser: {
          ...state.momentsByUser,
          [key]: defaultBucket(),
        },
      };
    });
  },

  /* --------------------------------------------------
   * 1️⃣ Fetch initial (Local → API)
   * -------------------------------------------------- */
  fetchMoments: async (user, selectedFriendUid = null) => {
    if (!user) return;

    const key = selectedFriendUid ?? "all";
    get().ensureBucket(key);

    set((state) => {
      const bucket = state.momentsByUser[key] ?? defaultBucket();
      return {
        momentsByUser: {
          ...state.momentsByUser,
          [key]: {
            ...bucket,
            loading: true,
            hasMore: true,
            // A soft auth/data refresh must not collapse an already expanded
            // grid; shrinking it changes scrollHeight and jumps the viewport.
            visibleCount: bucket.moments.length
              ? Math.max(bucket.visibleCount, initialVisible)
              : initialVisible,
          },
        },
      };
    });

    try {
      /* ---------- Local DB ---------- */
      const localData = selectedFriendUid
        ? await getMomentsByUser(selectedFriendUid)
        : await getAllMoments();

      if (localData?.length) {
        set((state) => {
          const bucket = state.momentsByUser[key] ?? defaultBucket();
          return {
            momentsByUser: {
              ...state.momentsByUser,
              [key]: {
                ...bucket,
                moments: mergeFreshMomentsStable(bucket.moments, localData),
              },
            },
          };
        });
      }

      /* ---------- API sync ---------- */
      const apiData = await GetAllMoments({
        timestamp: Math.floor(Date.now() / 1000),
        friendId: selectedFriendUid,
        limit: initialVisible,
      });

      if (apiData?.length) {
        let mergedForCache = [];
        let nextCursorSeconds = null;

        // Calculate cursor from the oldest API moment
        const sortedApi = sortByCreateTimeDesc(apiData);
        if (sortedApi.length > 0) {
          nextCursorSeconds = getMomentCursorSeconds(sortedApi[sortedApi.length - 1]);
        }

        set((state) => {
          const bucket = state.momentsByUser[key] ?? defaultBucket();
          mergedForCache = mergeFreshMomentsStable(bucket.moments, apiData);
          
          return {
            momentsByUser: {
              ...state.momentsByUser,
              [key]: {
                ...bucket,
                moments: mergedForCache,
                nextCursorSeconds: nextCursorSeconds,
                hasMore: apiData.length >= initialVisible,
              },
            },
          };
        });

        if (mergedForCache.length) {
          await bulkAddMoments(mergedForCache);
        }
      } else {
        // No items returned initially
        set((state) => {
          const bucket = state.momentsByUser[key] ?? defaultBucket();
          return {
            momentsByUser: {
              ...state.momentsByUser,
              [key]: {
                ...bucket,
                hasMore: false,
              },
            },
          };
        });
      }
    } catch (err) {
      console.error("❌ fetchMoments error:", err);
    } finally {
      set((state) => {
        const bucket = state.momentsByUser[key];
        if (!bucket) return state;
        return {
          momentsByUser: {
            ...state.momentsByUser,
            [key]: {
              ...bucket,
              loading: false,
            },
          },
        };
      });
    }
  },

  reloadMoments: async (selectedFriendUid = null) => {
    return get().fetchMoments({ reload: true }, selectedFriendUid);
  },

  /* --------------------------------------------------
   * 2️⃣ Load more older (Fixed cursor pagination)
   * -------------------------------------------------- */
  loadMoreOlder: async (selectedFriendUid = null) => {
    const key = selectedFriendUid ?? "all";
    const bucket = get().momentsByUser[key];
    if (!bucket || bucket.isLoadingMore || !bucket.hasMore || !bucket.moments.length) {
      return;
    }

    set((state) => {
      const b = state.momentsByUser[key];
      if (!b) return state;
      return {
        momentsByUser: {
          ...state.momentsByUser,
          [key]: { ...b, isLoadingMore: true },
        },
      };
    });

    try {
      let currentCursorSeconds = bucket.nextCursorSeconds;
      
      // If we don't have a cursor yet from API, calculate from the oldest local item
      if (!currentCursorSeconds) {
        const oldestLocal = bucket.moments[bucket.moments.length - 1];
        currentCursorSeconds = getMomentCursorSeconds(oldestLocal) || Math.floor(Date.now() / 1000);
      }

      let attempts = 0;
      let hasAdvanced = false;
      let isExhausted = false;

      // Allow fetching up to 3 pages if we keep getting 100% duplicates
      while (attempts < 3 && !hasAdvanced && !isExhausted) {
        attempts++;
        
        const older = await GetAllMoments({
          timestamp: currentCursorSeconds,
          friendId: selectedFriendUid,
          limit: loadMoreLimit,
        });

        if (!older || !older.length) {
          isExhausted = true;
          break;
        }

        const sortedOlder = sortByCreateTimeDesc(older);
        const newCursorSeconds = getMomentCursorSeconds(sortedOlder[sortedOlder.length - 1]);

        let hasNewItems = false;
        
        set((state) => {
          const b = state.momentsByUser[key];
          if (!b) return state;

          const existingIds = new Set(b.moments.map((i) => i.id));
          const filtered = older.filter((m) => !existingIds.has(m.id));

          if (filtered.length > 0) {
            hasNewItems = true;
            
            return {
              momentsByUser: {
                ...state.momentsByUser,
                [key]: {
                  ...b,
                  // Pagination only appends genuinely older ids. Re-sorting
                  // the entire visible grid here used to move the user's row.
                  moments: appendOlderMomentsStable(b.moments, filtered),
                  nextCursorSeconds: newCursorSeconds,
                },
              },
            };
          } else {
            // Entire page was duplicates, just advance cursor to avoid infinite loop
            return {
              momentsByUser: {
                ...state.momentsByUser,
                [key]: {
                  ...b,
                  nextCursorSeconds: newCursorSeconds,
                },
              },
            };
          }
        });

        currentCursorSeconds = newCursorSeconds;

        if (older.length < loadMoreLimit) {
          isExhausted = true;
        }

        if (hasNewItems) {
          await bulkAddMoments(older);
          hasAdvanced = true; // We found new items, stop polling ahead
        } else if (!isExhausted) {
          // No new items but API returned full page, need to loop again to skip duplicates
          console.log("loadMoreOlder: Skipped duplicate page, fetching deeper...");
        }
      }

      // After loops finish, evaluate hasMore
      set((state) => {
        const b = state.momentsByUser[key];
        if (!b) return state;
        return {
          momentsByUser: {
            ...state.momentsByUser,
            [key]: {
              ...b,
              hasMore: !isExhausted,
            },
          },
        };
      });

    } catch (err) {
      console.error("❌ loadMoreOlder error:", err);
      // Let it throw up or log, but ensure finally resets isLoadingMore
    } finally {
      set((state) => {
        const b = state.momentsByUser[key];
        if (!b) return state;
        return {
          momentsByUser: {
            ...state.momentsByUser,
            [key]: {
              ...b,
              isLoadingMore: false,
            },
          },
        };
      });
    }
  },

  /* --------------------------------------------------
   * 3️⃣ Realtime add moment (Socket)
   * -------------------------------------------------- */
  addNewMoment: async (payload) => {
    const items = Array.isArray(payload) ? payload : [payload];
    if (!items.length) return;

    const dbQueue = [];

    set((state) => {
      const next = { ...state.momentsByUser };
      const freshByBucket = new Map();

      for (const raw of items) {
        if (!raw?.id) continue;
        const m = {
          ...raw,
          createTime: getMomentDateMs(raw) || Date.now(),
        };

        const ownerUid = m.userUid || m.user || m.owner;
        const keys = new Set([ownerUid ?? "all", "all"]);

        for (const key of keys) {
          if (!key) continue;
          const pending = freshByBucket.get(key) || [];
          pending.push(m);
          freshByBucket.set(key, pending);
        }

        dbQueue.push(m);
      }

      for (const [key, fresh] of freshByBucket) {
        const bucket = next[key] ?? defaultBucket();
        next[key] = {
          ...bucket,
          moments: mergeFreshMomentsStable(bucket.moments, fresh),
        };
      }

      return { momentsByUser: next };
    });

    if (dbQueue.length) {
      await bulkAddMoments(dbQueue);
    }
  },

  syncMomentsSnapshot: async (snapshot) => {
    if (!Array.isArray(snapshot) || !snapshot.length) return;
    await get().addNewMoment(snapshot);
  },

  pullLatestMoments: async (selectedFriendUid = null) => {
    const key = selectedFriendUid ?? "all";
    get().ensureBucket(key);

    try {
      const apiData = await GetAllMoments({
        timestamp: Math.floor(Date.now() / 1000),
        friendId: selectedFriendUid,
        limit: initialVisible,
      });

      if (!apiData?.length) return;

      const dbQueue = [];

      set((state) => {
        const next = { ...state.momentsByUser };
        const bucket = next[key] ?? defaultBucket();
        const mergedMoments = mergeFreshMomentsStable(bucket.moments, apiData);
        const mergedById = new Map(mergedMoments.map((m) => [m.id, m]));
        for (const m of apiData) {
          if (m?.id && mergedById.has(m.id)) dbQueue.push(mergedById.get(m.id));
        }

        next[key] = {
          ...bucket,
          moments: mergedMoments,
        };

        if (key !== "all") {
          const all = next["all"] ?? defaultBucket();
          next["all"] = {
            ...all,
            moments: mergeFreshMomentsStable(all.moments, apiData),
          };
        }

        return { momentsByUser: next };
      });

      if (dbQueue.length) {
        await bulkAddMoments(dbQueue);
      }
    } catch (err) {
      console.error("❌ pullLatestMoments error:", err);
    }
  },

  /* --------------------------------------------------
   * 4️⃣ Remove moment
   * -------------------------------------------------- */
  removeMoment: async (momentId, ownerUid = null) => {
    const key = ownerUid ?? "all";
    const bucket = get().momentsByUser[key];
    if (!bucket) return;

    set((state) => ({
      momentsByUser: {
        ...state.momentsByUser,
        [key]: {
          ...bucket,
          moments: bucket.moments.filter((m) => m.id !== momentId),
        },
      },
    }));

    await deleteMomentById(momentId);
  },

  /* --------------------------------------------------
   * 5️⃣ Visible count
   * -------------------------------------------------- */
  increaseVisibleCount: (selectedFriendUid = null) => {
    const key = selectedFriendUid ?? "all";
    const bucket = get().momentsByUser[key];
    if (!bucket) return;

    if (bucket.visibleCount < bucket.moments.length) {
      set((state) => ({
        momentsByUser: {
          ...state.momentsByUser,
          [key]: {
            ...bucket,
            visibleCount: Math.min(
              bucket.visibleCount + initialVisible,
              bucket.moments.length
            ),
          },
        },
      }));
    }
  },

  resetVisible: (selectedFriendUid = null) => {
    const key = selectedFriendUid ?? "all";
    const bucket = get().momentsByUser[key];
    if (!bucket) return;

    set((state) => ({
      momentsByUser: {
        ...state.momentsByUser,
        [key]: {
          ...bucket,
          visibleCount: initialVisible,
        },
      },
    }));
  },
}));
