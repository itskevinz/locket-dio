import { create } from "zustand";
import {
  createDraft,
  updateDraftMedia,
  updateDraftMeta,
  listDraftsMeta,
  getDraftFull,
  getDraftMeta,
  deleteDraft,
  resetStuckPostingDrafts,
  draftMediaToFile,
  collectMetaFromStores,
  resolveDraftUid,
  requestDraftPersist,
  formatDraftSavedAt,
  DRAFT_STATUS,
  SYNC_STATUS,
  isRestoreInProgress,
  setRestoreInProgress,
  statusLabel,
  syncAll,
  ensureLocalMedia,
} from "@/utils/momentDraft";
import { usePostStore } from "./usePostStore";
import { useOverlayEditorStore } from "./useOverlayEditorStore";
import {
  SonnerError,
  SonnerInfo,
  SonnerSuccess,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";
import * as services from "@/services";
import { useUploadQueueStore } from "./useUploadPostStore";
import { useConnectivityStore } from "@/stores/useConnectivityStore";
import { resetAllPostData } from "@/utils";

let metaSaveTimer = null;
let mediaSaveChain = Promise.resolve();

function isDraftCloudOnline() {
  const c = useConnectivityStore.getState();
  return !c.isOffline && c.serverReachable !== false;
}

/** After local IDB write: push pending (sequential, never auto-post). */
function queueCloudSyncAfterLocalSave() {
  if (!isDraftCloudOnline()) return Promise.resolve({ skipped: true, offline: true });
  return syncAll().catch((e) => {
    console.warn("[moment-draft] sync after save", e?.message || e);
  });
}

function snapshotMetaFromStores() {
  const post = usePostStore.getState();
  const overlay = useOverlayEditorStore.getState().overlayData;
  return collectMetaFromStores({
    overlayData: overlay,
    audience: post.audience,
    selectedRecipients: post.selectedRecipients,
    selectedGroupId: post.selectedGroupId,
    videoCropData: post.videoCropData,
    restoreStreakData: post.restoreStreakData,
    enhancement: post.enhancement || null,
    // Keep original still if AI replaced active media
    originalMediaBlob:
      post.originalFile &&
      post.selectedFile &&
      post.originalFile !== post.selectedFile
        ? post.originalFile
        : post.originalFile || null,
  });
}

function applyMetaToStores(meta) {
  const ov = meta.overlays || meta.optionsData || {};
  useOverlayEditorStore.getState().updateOverlayEditor({
    overlay_id: ov.overlay_id || meta.captionStyle?.overlay_id || "standard",
    text: ov.text || meta.caption || "",
    caption: ov.caption || meta.caption || "",
    text_color: ov.text_color || meta.captionStyle?.text_color || "#FFFFFF",
    icon: ov.icon || meta.captionStyle?.icon || {},
    type: ov.type || meta.captionStyle?.type || "default",
    background: ov.background || meta.captionStyle?.background || { colors: [] },
    payload: ov.payload || meta.music || {},
    color_top: ov.color_top || meta.captionStyle?.color_top || "",
    color_bottom: ov.color_bottom || meta.captionStyle?.color_bottom || "",
  });
  const friendIds = Array.isArray(meta.selectedFriendIds)
    ? meta.selectedFriendIds
    : [];
  usePostStore.getState().setAudience(meta.audience || "all");
  usePostStore.getState().setSelectedRecipients(friendIds);
  if (meta.optionsData?.selectedGroupId) {
    usePostStore.getState().setSelectedGroupId(meta.optionsData.selectedGroupId);
  }
  if (meta.optionsData?.videoCropData) {
    usePostStore.getState().setVideoCropData(meta.optionsData.videoCropData);
  }
  if (meta.optionsData?.restoreStreakData) {
    usePostStore
      .getState()
      .setRestoreStreakData(meta.optionsData.restoreStreakData);
  }
  // enhancement meta restored with media in restoreDraftIntoStudio
}

export const useMomentDraftStore = create((set, get) => ({
  /** metadata rows only */
  drafts: [],
  draftCount: 0,
  /** currently editing draft UUID (null = unsaved studio session) */
  activeDraftId: null,
  /** library sheet open */
  libraryOpen: false,
  libraryFilter: "all", // all | image | video | failed
  /** single-draft UI compat */
  draftMeta: null,
  hasDraft: false,
  showRestoreModal: false,
  dismissedRestore: false,
  showReplacePrompt: false,
  pendingNewFile: null,
  loading: false,
  thumbnailUrl: null,
  /** global post lock — one draft at a time */
  postingDraftId: null,

  /**
   * Open library: show local cache immediately, then revalidate from cloud when online.
   * IndexedDB is cache/outbox only — never treat local-only as full account truth.
   */
  openLibrary: async () => {
    set({ libraryOpen: true });
    const uid = resolveDraftUid();
    await get().refreshList(uid);
    if (!isDraftCloudOnline()) {
      SonnerInfo("Ngoại tuyến — chỉ hiện bản nháp đã lưu trên máy này");
      return;
    }
    try {
      const r = await syncAll();
      await get().refreshList(uid);
      if (r?.pull?.ok === false) {
        SonnerWarning(
          "Không kéo được bản nháp từ tài khoản",
          r.pull.error || "Thử nút Đồng bộ",
        );
      }
    } catch (e) {
      console.warn("[moment-draft] openLibrary sync", e?.message || e);
      SonnerWarning("Đồng bộ bản nháp lỗi", e?.message || "");
    }
  },
  closeLibrary: () => set({ libraryOpen: false }),
  setLibraryFilter: (f) => set({ libraryFilter: f || "all" }),

  clearThumbnail: () => {
    const url = get().thumbnailUrl;
    if (url?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
    set({ thumbnailUrl: null });
  },

  refreshList: async (uid) => {
    const id = uid || resolveDraftUid();
    if (!id) {
      set({ drafts: [], draftCount: 0, hasDraft: false, draftMeta: null });
      return [];
    }
    const rows = await listDraftsMeta(id);
    set({
      drafts: rows,
      draftCount: rows.length,
      hasDraft: rows.length > 0,
      draftMeta: rows[0] || null,
    });
    return rows;
  },

  refreshDraftPresence: async (uid) => {
    const rows = await get().refreshList(uid);
    return rows.length > 0;
  },

  /**
   * After login: reset stuck posting + load list only.
   * Never auto-open restore modal or library (user opens via Draft badge).
   */
  checkAndOfferRestore: async (user) => {
    const uid = resolveDraftUid(user);
    if (!uid) return;
    set({ loading: true });
    try {
      await requestDraftPersist();
      await resetStuckPostingDrafts(uid);
      // Pull cloud shells + push pending when online
      try {
        const online = useConnectivityStore.getState().serverReachable !== false
          && !useConnectivityStore.getState().isOffline;
        if (online) {
          await syncAll();
        }
      } catch (e) {
        console.warn("[moment-draft] sync on login", e?.message || e);
      }
      const rows = await get().refreshList(uid);
      set({
        showRestoreModal: false,
        libraryOpen: false,
        loading: false,
        hasDraft: rows.length > 0,
        draftMeta: rows[0] || null,
      });
      if (!rows.length) get().clearThumbnail();
    } catch (e) {
      console.error("[moment-draft] check restore", e);
      set({ loading: false, showRestoreModal: false });
    }
  },

  /** Manual / online trigger: push + pull then refresh list */
  syncDraftsNow: async (silent = false) => {
    const uid = resolveDraftUid();
    if (!uid) return { ok: false };
    if (!isDraftCloudOnline()) {
      if (!silent) SonnerWarning("Cần mạng để đồng bộ bản nháp giữa các thiết bị");
      return { ok: false, offline: true };
    }
    try {
      const r = await syncAll();
      await get().refreshList(uid);
      const n = r?.pullAfter?.count || r?.pullBefore?.count || r?.pull?.count;
      if (r?.pullBefore?.ok === false || r?.pullAfter?.ok === false || r?.pull?.ok === false) {
        if (!silent) SonnerWarning("Kéo bản nháp thất bại", r.error || r.pull?.error || r.pullBefore?.error || "");
      } else if (typeof n === "number" && !silent) {
        SonnerInfo(
          n
            ? `Đã đồng bộ · ${n} bản trên tài khoản`
            : "Đã đồng bộ · chưa có bản nháp trên tài khoản",
        );
      }
      return r;
    } catch (e) {
      if (!silent) SonnerWarning("Đồng bộ thất bại", e?.message || "");
      return { ok: false, error: e?.message };
    }
  },

  retrySyncDraft: async (draftId) => {
    if (!draftId) return false;
    await updateDraftMeta(draftId, {
      syncStatus: SYNC_STATUS.PENDING_SYNC,
      lastSyncError: null,
    });
    await syncAll();
    await get().refreshList();
    return true;
  },

  /** Always open library (no blocking restore modal). */
  openRestoreModal: async () => {
    set({ dismissedRestore: true, showRestoreModal: false, libraryOpen: true });
    await get().openLibrary();
  },

  closeRestoreModal: () => set({ showRestoreModal: false }),
  dismissRestoreForLater: () =>
    set({ showRestoreModal: false, dismissedRestore: true }),
  setDismissedRestore: (v) => set({ dismissedRestore: Boolean(v) }),

  /**
   * Save current studio media as NEW draft (always new UUID) or update activeDraftId.
   * @param {{ asNew?: boolean, keepStudio?: boolean, clearAfter?: boolean }} opts
   */
  saveCurrentAsDraft: async (opts = {}) => {
    const { asNew = false, clearAfter = false } = opts;
    const uid = resolveDraftUid();
    if (!uid) {
      SonnerError("Chưa đăng nhập — không lưu được bản nháp.");
      return { error: "no-uid" };
    }
    let file = usePostStore.getState().selectedFile;
    const preview = usePostStore.getState().preview;
    if (!file && preview?.data?.startsWith("data:")) {
      try {
        const res = await fetch(preview.data);
        const blob = await res.blob();
        file = new File([blob], "locket_draft.jpg", {
          type: blob.type || "image/jpeg",
        });
        usePostStore.getState().setMediaFromFile(file);
      } catch {
        /* ignore */
      }
    }
    if (!file) {
      SonnerWarning("Chưa có ảnh/video để lưu bản nháp.");
      return { error: "no-file" };
    }

    const meta = snapshotMetaFromStores();
    const activeId = get().activeDraftId;

    mediaSaveChain = mediaSaveChain.then(async () => {
      let result;
      if (activeId && !asNew) {
        result = await updateDraftMedia(activeId, file, {
          ...meta,
          status: DRAFT_STATUS.READY,
        });
        if (!result.error) {
          await updateDraftMeta(activeId, {
            ...meta,
            status: DRAFT_STATUS.READY,
          });
          result = { id: activeId, ok: true };
        }
      } else {
        result = await createDraft({
          ownerUid: uid,
          file,
          meta: { ...meta, status: DRAFT_STATUS.READY },
        });
        if (result.id) {
          set({ activeDraftId: result.id });
        }
      }

      if (result.error === "quota" || result.error === "too-large") {
        SonnerError(
          result.message ||
            "Thiết bị không đủ dung lượng để lưu bản nháp này",
        );
      } else if (result.error) {
        SonnerError(result.message || "Không lưu được bản nháp.");
      } else {
        await get().refreshList(uid);
        if (clearAfter) {
          get().clearStudioAfterSave();
        }
        // Local first — cloud push only when online (never mark synced from IDB alone)
        if (isDraftCloudOnline()) {
          SonnerSuccess("Đã lưu bản nháp · đang đồng bộ tài khoản…");
          await queueCloudSyncAfterLocalSave();
          await get().refreshList(uid);
          const row = result.id
            ? (await getDraftMeta(result.id))
            : null;
          if (row?.syncStatus === SYNC_STATUS.SYNCED) {
            SonnerSuccess("Đã lưu vào tài khoản");
          } else if (row?.syncStatus === SYNC_STATUS.SYNC_FAILED) {
            SonnerWarning("Đồng bộ thất bại · Thử lại");
          }
        } else {
          SonnerSuccess("Đã lưu bản nháp · Chưa đồng bộ (ngoại tuyến)");
        }
      }
      return result;
    });
    return mediaSaveChain;
  },

  clearStudioAfterSave: () => {
    usePostStore.getState().resetMedia?.();
    try {
      resetAllPostData();
    } catch {
      /* optional */
    }
    set({ activeDraftId: null });
  },

  /** Auto-bind media after capture: update active or create new draft (never overwrite others). */
  saveMediaFromFile: async (file) => {
    if (!file || isRestoreInProgress()) return { skipped: true };
    const uid = resolveDraftUid();
    if (!uid) return { error: "no-uid" };

    mediaSaveChain = mediaSaveChain.then(async () => {
      const meta = snapshotMetaFromStores();
      const activeId = get().activeDraftId;
      let result;
      if (activeId) {
        result = await updateDraftMedia(activeId, file, {
          ...meta,
          status: DRAFT_STATUS.READY,
        });
      } else {
        result = await createDraft({
          ownerUid: uid,
          file,
          meta: { ...meta, status: DRAFT_STATUS.READY },
        });
        if (result.id) set({ activeDraftId: result.id });
      }
      if (result.error === "quota" || result.error === "too-large") {
        SonnerError(
          result.message ||
            "Thiết bị không đủ dung lượng để lưu bản nháp này",
        );
      } else if (result.id || result.ok) {
        await get().refreshList(uid);
        void queueCloudSyncAfterLocalSave().then(() => get().refreshList(uid));
      }
      return result;
    });
    return mediaSaveChain;
  },

  scheduleMetaSave: (delayMs = 250) => {
    if (isRestoreInProgress()) return;
    if (!get().activeDraftId) return;
    if (metaSaveTimer) clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(() => {
      metaSaveTimer = null;
      void get().flushMetaSave();
    }, delayMs);
  },

  flushMetaSave: async () => {
    if (isRestoreInProgress()) return;
    const draftId = get().activeDraftId;
    if (!draftId) return;
    if (metaSaveTimer) {
      clearTimeout(metaSaveTimer);
      metaSaveTimer = null;
    }
    const post = usePostStore.getState();
    if (!post.selectedFile && !post.preview) return;
    const meta = snapshotMetaFromStores();
    await updateDraftMeta(draftId, {
      ...meta,
      status: DRAFT_STATUS.READY,
    });
    await get().refreshList();
    void queueCloudSyncAfterLocalSave().then(() => get().refreshList());
  },

  restoreDraftIntoStudio: async (draftId) => {
    const uid = resolveDraftUid();
    if (!uid) {
      SonnerError("Chưa đăng nhập — không khôi phục được bản nháp.");
      return false;
    }
    const id = draftId || get().activeDraftId;
    if (!id) return false;
    set({ loading: true });
    setRestoreInProgress(true);
    try {
      // Download full media if only cloud shell present
      try {
        await ensureLocalMedia(id);
      } catch (e) {
        console.warn("[moment-draft] ensureLocalMedia", e?.message || e);
      }
      const loaded = await getDraftFull(id);
      if (!loaded?.meta || loaded.corrupt || !loaded.media?.blob) {
        SonnerError(
          loaded?.meta && !loaded.media?.blob
            ? "Chưa tải được ảnh/video từ tài khoản. Kiểm tra mạng."
            : "Bản nháp bị hỏng hoặc không đọc được.",
        );
        set({ loading: false });
        setRestoreInProgress(false);
        return false;
      }
      const file = draftMediaToFile(loaded.media, loaded.meta);
      if (!file) {
        SonnerError("Không tạo được file từ bản nháp.");
        set({ loading: false });
        setRestoreInProgress(false);
        return false;
      }
      usePostStore.getState().setMediaFromFile(file);
      // Restore original still if AI enhanced draft
      if (
        loaded.media.originalMediaBlob instanceof Blob &&
        loaded.meta?.enhancement?.enabled
      ) {
        try {
          const origFile = draftMediaToFile(
            {
              blob: loaded.media.originalMediaBlob,
              mimeType: loaded.media.mimeType,
              fileName: loaded.media.fileName,
            },
            loaded.meta,
          );
          if (origFile) {
            usePostStore.setState({
              originalFile: origFile,
              enhancement: loaded.meta.enhancement,
            });
          }
        } catch {
          /* keep single-file restore */
        }
      }
      applyMetaToStores(loaded.meta);
      set({
        activeDraftId: id,
        showRestoreModal: false,
        libraryOpen: false,
        dismissedRestore: false,
        hasDraft: true,
        draftMeta: loaded.meta,
        loading: false,
      });
      SonnerInfo("Đã mở bản nháp");
      return true;
    } catch (e) {
      console.error("[moment-draft] restore", e);
      SonnerError("Khôi phục bản nháp thất bại", e?.message || "");
      set({ loading: false });
      return false;
    } finally {
      setTimeout(() => setRestoreInProgress(false), 400);
    }
  },

  /**
   * Post a draft by id using existing createRequestPayloadV6 + upload queue.
   * One draft at a time. Delete only on API success.
   */
  postDraftById: async (draftId) => {
    if (!draftId) return false;
    if (get().postingDraftId) {
      SonnerWarning("Đang đăng một bản nháp khác — vui lòng chờ.");
      return false;
    }

    // Connectivity (health, not only navigator.onLine)
    try {
      const conn = await useConnectivityStore
        .getState()
        .checkConnectivity({ force: true });
      if (!conn?.browserOnline || !conn?.serverReachable) {
        SonnerWarning(
          "Đang ngoại tuyến",
          "Bản nháp vẫn được giữ. Thử đăng khi có mạng.",
        );
        await updateDraftMeta(draftId, {
          status: DRAFT_STATUS.FAILED,
          lastError: "Offline",
        });
        await get().refreshList();
        return false;
      }
    } catch {
      SonnerWarning("Không kết nối được máy chủ");
      return false;
    }

    set({ postingDraftId: draftId });
    await updateDraftMeta(draftId, {
      status: DRAFT_STATUS.POSTING,
      lastError: null,
    });
    await get().refreshList();

    // Preserve current studio (if any) then load draft
    const prevActive = get().activeDraftId;
    const prevFile = usePostStore.getState().selectedFile;

    setRestoreInProgress(true);
    try {
      // Download full media if only cloud shell present (same as restoreDraftIntoStudio)
      try {
        await ensureLocalMedia(draftId);
      } catch (e) {
        console.warn("[moment-draft] ensureLocalMedia (post)", e?.message || e);
      }
      const loaded = await getDraftFull(draftId);
      if (!loaded?.meta || loaded.corrupt || !loaded.media) {
        throw new Error("Bản nháp không đọc được");
      }
      const file = draftMediaToFile(loaded.media, loaded.meta);
      if (!file) throw new Error("Media trống");

      usePostStore.getState().setMediaFromFile(file);
      applyMetaToStores(loaded.meta);
      set({ activeDraftId: draftId });

      const payload = await services.createRequestPayloadV6();
      if (!payload) throw new Error("Không tạo được payload");

      // Tag queue item with draftId for success cleanup
      payload.draftId = draftId;
      await useUploadQueueStore.getState().enqueueUploadItem(payload);

      SonnerSuccess("Đã thêm vào hàng đợi đăng");
      // Clear studio after enqueue (upload runs async); draft stays until success
      try {
        usePostStore.getState().resetMedia?.();
        resetAllPostData();
      } catch {
        /* ignore */
      }
      set({ activeDraftId: null, libraryOpen: get().libraryOpen });
      return true;
    } catch (e) {
      console.error("[moment-draft] post failed", e);
      const attempts =
        ((await getDraftMeta(draftId))?.uploadAttempts || 0) + 1;
      await updateDraftMeta(draftId, {
        status: DRAFT_STATUS.FAILED,
        lastError: e?.message || "Đăng thất bại",
        uploadAttempts: attempts,
      });
      await get().refreshList();
      SonnerError("Đăng bản nháp thất bại", e?.message || "");
      // restore previous studio if any
      if (prevFile && prevActive) {
        set({ activeDraftId: prevActive });
      }
      return false;
    } finally {
      setRestoreInProgress(false);
      set({ postingDraftId: null });
    }
  },

  markPosting: async (draftId) => {
    const id = draftId || get().activeDraftId;
    if (!id) return;
    await updateDraftMeta(id, { status: DRAFT_STATUS.POSTING });
    await get().refreshList();
  },

  markEditing: async (draftId) => {
    const id = draftId || get().activeDraftId;
    if (!id) return;
    await updateDraftMeta(id, {
      status: DRAFT_STATUS.FAILED,
      lastError: "Đăng chưa thành công — thử lại.",
    });
    await get().refreshList();
  },

  clearAfterSuccessfulPost: async (draftId) => {
    const id = draftId || get().activeDraftId;
    if (!id) return;
    
    // Đọc trạng thái để xóa cloud nếu đã được đồng bộ
    try {
      const meta = await getDraftMeta(id);
      if (meta?.syncStatus === SYNC_STATUS.SYNCED || meta?.syncStatus === SYNC_STATUS.SYNC_FAILED) {
        const online = useConnectivityStore.getState().serverReachable !== false
            && !useConnectivityStore.getState().isOffline;
        
        if (online) {
          try {
            const { instanceMain } = await import("@/libs");
            await instanceMain.delete(`/api/drafts/${encodeURIComponent(id)}`);
          } catch (e) {
            if (e?.response?.status !== 404) throw e;
          }
          await deleteDraft(id);
        } else {
          await updateDraftMeta(id, { syncStatus: SYNC_STATUS.PENDING_DELETE });
          // Không xóa ngay local để pushPendingDrafts sau này có draft xóa cloud
        }
      } else {
        await deleteDraft(id);
      }
    } catch (e) {
      await updateDraftMeta(id, {
        syncStatus: SYNC_STATUS.PENDING_DELETE,
        lastSyncError: e?.message || "Lỗi xóa cloud khi hoàn tất",
      });
    }

    if (get().activeDraftId === id) set({ activeDraftId: null });
    get().clearThumbnail();
    await get().refreshList();
    set({
      showRestoreModal: false,
      dismissedRestore: false,
    });
  },

  /** Permanent delete with caller confirmation already done */
  confirmDeleteDraft: async (draftId) => {
    const id = draftId || get().activeDraftId;
    if (!id) return false;
    const meta = await getDraftMeta(id);
    const online =
      !useConnectivityStore.getState().isOffline &&
      useConnectivityStore.getState().serverReachable !== false;

    if (online && meta?.syncStatus === SYNC_STATUS.SYNCED) {
      // Delete cloud then local
      try {
        const { instanceMain } = await import("@/libs");
        await instanceMain.delete(`/api/drafts/${encodeURIComponent(id)}`);
      } catch (e) {
        if (e?.response?.status !== 404) {
          // Mark pending delete for later
          await updateDraftMeta(id, {
            syncStatus: SYNC_STATUS.PENDING_DELETE,
            lastSyncError: e?.message || "pending delete",
          });
          SonnerWarning("Đã đánh dấu xóa — sẽ xóa trên tài khoản khi mạng ổn.");
          await get().refreshList();
          return true;
        }
      }
    } else if (!online && meta?.syncStatus === SYNC_STATUS.SYNCED) {
      await updateDraftMeta(id, { syncStatus: SYNC_STATUS.PENDING_DELETE });
      SonnerInfo("Ngoại tuyến — sẽ xóa trên tài khoản khi có mạng.");
      // Hide from list by soft-flag: still delete local UI view by marking
      // Keep local until cloud delete succeeds — filter pending_delete from list?
    }

    const ok = await deleteDraft(id);
    if (!ok && meta?.syncStatus !== SYNC_STATUS.PENDING_DELETE) {
      SonnerError("Không thể xóa bản nháp.");
      return false;
    }
    if (get().activeDraftId === id) {
      set({ activeDraftId: null });
      try {
        usePostStore.getState().resetMedia?.();
        resetAllPostData();
      } catch {
        /* ignore */
      }
    }
    await get().refreshList();
    SonnerSuccess("Đã xóa bản nháp");
    return true;
  },

  softDeleteDraft: async (draftId) => get().confirmDeleteDraft(draftId),

  /** Clone media + meta into a new UUID draft (no overwrite). */
  duplicateDraft: async (draftId) => {
    const uid = resolveDraftUid();
    if (!uid || !draftId) {
      SonnerError("Không nhân bản được bản nháp.");
      return null;
    }
    try {
      const loaded = await getDraftFull(draftId);
      if (!loaded?.meta || loaded.corrupt || !loaded.media) {
        SonnerError("Bản nháp bị hỏng — không nhân bản được.");
        return null;
      }
      const file = draftMediaToFile(loaded.media, loaded.meta);
      if (!file) {
        SonnerError("Không đọc được media để nhân bản.");
        return null;
      }
      const src = loaded.meta;
      const result = await createDraft({
        ownerUid: uid,
        file,
        meta: {
          caption: src.caption || "",
          captionStyle: src.captionStyle || {},
          music: src.music || null,
          overlays: src.overlays || src.optionsData || {},
          audience: src.audience || "all",
          selectedFriendIds: Array.isArray(src.selectedFriendIds)
            ? src.selectedFriendIds.slice()
            : [],
          optionsData: src.optionsData || {},
          status: DRAFT_STATUS.READY,
        },
      });
      if (result.error) {
        SonnerError(
          result.message || "Không đủ dung lượng để nhân bản bản nháp.",
        );
        return null;
      }
      await get().refreshList(uid);
      SonnerSuccess("Đã nhân bản bản nháp");
      return result.id || null;
    } catch (e) {
      console.error("[moment-draft] duplicate", e);
      SonnerError("Nhân bản thất bại", e?.message || "");
      return null;
    }
  },

  // Replace-prompt: new capture while studio empty but drafts exist → open library
  requestReplaceOrContinue: async () => true,

  applyNewMediaFile: async (file, { onApplied } = {}) => {
    if (!file) return false;
    // New capture session: clear active draft so createDraft gets new UUID
    // only if studio already empty; if editing a draft, keep id (update media)
    const studioEmpty =
      !usePostStore.getState().selectedFile &&
      !usePostStore.getState().preview?.data;
    if (studioEmpty) {
      set({ activeDraftId: null });
    }
    usePostStore.getState().setMediaFromFile(file);
    onApplied?.(file);
    return true;
  },

  cancelReplacePrompt: () =>
    set({ showReplacePrompt: false, pendingNewFile: null }),
  acceptReplaceWithNew: async () => {
    const file = get().pendingNewFile;
    set({ showReplacePrompt: false, pendingNewFile: null, activeDraftId: null });
    if (file) {
      usePostStore.getState().setMediaFromFile(file);
      await get().saveMediaFromFile(file);
    }
    return true;
  },
  continueOldDraftFromPrompt: async () => {
    set({ showReplacePrompt: false, pendingNewFile: null });
    await get().restoreDraftIntoStudio();
  },

  formatSavedAt: (ts) => formatDraftSavedAt(ts),
  statusLabel,
}));
