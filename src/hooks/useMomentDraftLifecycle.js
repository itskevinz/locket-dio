import { useEffect, useRef, useState } from "react";
import {
  useAuthStore,
  useMomentDraftStore,
  useOverlayEditorStore,
  usePostStore,
  useUploadQueueStore,
} from "@/stores";
import { resolveDraftUid, requestDraftPersist } from "@/utils/momentDraft";
import { useConnectivityStore } from "@/stores/useConnectivityStore";

/**
 * Multi-draft autosave: meta → activeDraftId only; media after capture.
 * Also: account draft sync when online.
 */
export function useMomentDraftLifecycle() {
  const user = useAuthStore((s) => s.user);
  const isAuth = useAuthStore((s) => s.isAuth);
  const checkAndOfferRestore = useMomentDraftStore((s) => s.checkAndOfferRestore);
  const flushMetaSave = useMomentDraftStore((s) => s.flushMetaSave);
  const refreshDraftPresence = useMomentDraftStore((s) => s.refreshDraftPresence);
  const activeDraftId = useMomentDraftStore((s) => s.activeDraftId);
  const postingDraftId = useMomentDraftStore((s) => s.postingDraftId);
  const selectedFile = usePostStore((s) => s.selectedFile);
  const uploadInProgress = useUploadQueueStore(
    (s) =>
      s.isQueueRunning ||
      s.uploadItems.some((item) => item.status === "uploading"),
  );
  const isOffline = useConnectivityStore((s) => s.isOffline);
  const serverReachable = useConnectivityStore((s) => s.serverReachable);
  const prevUid = useRef(null);
  const mediaSaveVersion = useRef(0);
  const metaSaveVersion = useRef(0);
  const metaSaveTimer = useRef(null);
  const [mediaSaveState, setMediaSaveState] = useState("idle");
  const [metaSavePending, setMetaSavePending] = useState(false);

  const publishMediaSaveState = (next) => {
    setMediaSaveState(next);
    useMomentDraftStore.setState({ mediaAutosaveState: next });
  };

  useEffect(() => {
    if (!isAuth) return;
    void requestDraftPersist();
  }, [isAuth]);

  useEffect(() => {
    if (!isAuth || !user) return;
    const uid = resolveDraftUid(user);
    if (!uid) return;
    if (prevUid.current && prevUid.current !== uid) {
      useMomentDraftStore.setState({
        hasDraft: false,
        draftMeta: null,
        drafts: [],
        draftCount: 0,
        activeDraftId: null,
        showRestoreModal: false,
        dismissedRestore: false,
        libraryOpen: false,
        mediaAutosaveState: "idle",
        manualDraftSaveInProgress: false,
      });
      useMomentDraftStore.getState().clearThumbnail();
    }
    prevUid.current = uid;
    void checkAndOfferRestore(user);
  }, [isAuth, user, checkAndOfferRestore]);

  // When network returns: sync pending drafts
  useEffect(() => {
    if (!isAuth || isOffline || serverReachable === false) return;
    const t = setTimeout(() => {
      void useMomentDraftStore.getState().syncDraftsNow?.(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [isAuth, isOffline, serverReachable]);

  useEffect(() => {
    let disposed = false;

    const queueMetaSave = () => {
      if (!useMomentDraftStore.getState().activeDraftId) return;

      const version = ++metaSaveVersion.current;
      setMetaSavePending(true);
      if (metaSaveTimer.current) clearTimeout(metaSaveTimer.current);
      metaSaveTimer.current = setTimeout(() => {
        metaSaveTimer.current = null;
        void flushMetaSave()
          .then(() => {
            if (!disposed && metaSaveVersion.current === version) {
              setMetaSavePending(false);
            }
          })
          .catch(() => {
            /* Keep warning active until a later save succeeds. */
          });
      }, 250);
    };

    const unsubOverlay = useOverlayEditorStore.subscribe(() => {
      queueMetaSave();
    });
    const unsubPost = usePostStore.subscribe((state, prev) => {
      if (
        state.audience !== prev.audience ||
        state.selectedRecipients !== prev.selectedRecipients ||
        state.selectedGroupId !== prev.selectedGroupId ||
        state.videoCropData !== prev.videoCropData ||
        state.restoreStreakData !== prev.restoreStreakData
      ) {
        queueMetaSave();
      }
      // New media file → bind to active draft or create NEW uuid (never overwrite others).
      // A manual save can itself materialize preview data into selectedFile; skip the
      // parallel autosave in that case so one user action can never create two UUIDs.
      if (state.selectedFile && state.selectedFile !== prev.selectedFile) {
        const version = ++mediaSaveVersion.current;
        if (useMomentDraftStore.getState().manualDraftSaveInProgress) {
          publishMediaSaveState("idle");
          return;
        }

        publishMediaSaveState("saving");
        void useMomentDraftStore
          .getState()
          .saveMediaFromFile(state.selectedFile)
          .then((result) => {
            if (disposed || mediaSaveVersion.current !== version) return;
            publishMediaSaveState(result?.error ? "failed" : "saved");
          })
          .catch(() => {
            if (!disposed && mediaSaveVersion.current === version) {
              publishMediaSaveState("failed");
            }
          });
      } else if (!state.selectedFile && prev.selectedFile) {
        mediaSaveVersion.current += 1;
        publishMediaSaveState("idle");
        setMetaSavePending(false);
      }
    });
    return () => {
      disposed = true;
      unsubOverlay();
      unsubPost();
      if (metaSaveTimer.current) {
        clearTimeout(metaSaveTimer.current);
        metaSaveTimer.current = null;
      }
    };
  }, [flushMetaSave]);

  useEffect(() => {
    const flush = () => {
      if (metaSaveTimer.current) {
        clearTimeout(metaSaveTimer.current);
        metaSaveTimer.current = null;
      }
      const version = metaSaveVersion.current;
      void flushMetaSave()
        .then(() => {
          if (metaSaveVersion.current === version) {
            setMetaSavePending(false);
          }
        })
        .catch(() => {
          /* Keep beforeunload warning active when persistence fails. */
        });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [flushMetaSave]);

  useEffect(() => {
    const hasUnsavedMedia =
      Boolean(selectedFile) &&
      (mediaSaveState === "saving" ||
        mediaSaveState === "failed" ||
        !activeDraftId);
    const shouldWarnBeforeUnload =
      hasUnsavedMedia ||
      metaSavePending ||
      uploadInProgress ||
      Boolean(postingDraftId);

    if (!shouldWarnBeforeUnload) return;

    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [
    activeDraftId,
    mediaSaveState,
    metaSavePending,
    postingDraftId,
    selectedFile,
    uploadInProgress,
  ]);

  useEffect(() => {
    if (!isAuth) return;
    void refreshDraftPresence();
  }, [isAuth, refreshDraftPresence]);
}
