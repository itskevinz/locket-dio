import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, MoreVertical, Image as ImageIcon, Video, Play, Camera, RefreshCw, AlertTriangle,
  Search, Filter, CheckCircle2, Circle, Download, Trash2
} from "lucide-react";
import { useMomentDraftStore, usePostStore } from "@/stores";
import { useConnectivityStore } from "@/stores/useConnectivityStore";
import { useAppCamera } from "@/context/AppContext";
import { OverlayRenderer } from "@/components/Overlay";
import { SonnerInfo, SonnerError, SonnerSuccess } from "@/components/uikit/SonnerToast";
import { instanceMain } from "@/libs";
import {
  getDraftThumbnailBlob,
  getDraftMediaBlob,
  ensureLocalThumbnail,
  ensureLocalMedia,
  deleteDraft,
  DRAFT_STATUS,
  SYNC_STATUS,
  formatDraftStatusLine,
  formatDraftCreatedAt,
} from "@/utils/momentDraft";

// --- HELPERS ---
function buildOverlayData(draft) {
  const ov = draft?.overlays || draft?.optionsData || {};
  const caption = draft?.caption || ov.caption || ov.text || "";
  const style = draft?.captionStyle || {};
  const music = draft?.music || null;
  const type =
    ov.type ||
    style.type ||
    (music || ov.payload?.isrc || ov.payload?.song_title ? "music" : "default");

  return {
    ...ov,
    overlay_id: ov.overlay_id || style.overlay_id || "standard",
    type,
    text: ov.text || ov.caption || caption,
    caption: ov.caption || ov.text || caption,
    text_color: ov.text_color || style.text_color || "#FFFFFF",
    background: ov.background || style.background || { colors: [] },
    color_top: ov.color_top || style.color_top || "",
    color_bottom: ov.color_bottom || style.color_bottom || "",
    icon: ov.icon || style.icon || {},
    payload:
      ov.payload ||
      (music
        ? {
            ...music,
            song_title: music.song_title || music.song_name,
          }
        : {}),
  };
}

const downloadBlob = (blob, filename) => {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function DraftLibrary() {
  const open = useMomentDraftStore((s) => s.libraryOpen);
  const closeLibrary = useMomentDraftStore((s) => s.closeLibrary);
  const drafts = useMomentDraftStore((s) => s.drafts);
  const refreshList = useMomentDraftStore((s) => s.refreshList);
  const restoreDraftIntoStudio = useMomentDraftStore((s) => s.restoreDraftIntoStudio);
  const postDraftById = useMomentDraftStore((s) => s.postDraftById);
  const confirmDeleteDraft = useMomentDraftStore((s) => s.confirmDeleteDraft);
  const duplicateDraft = useMomentDraftStore((s) => s.duplicateDraft);
  const postingDraftId = useMomentDraftStore((s) => s.postingDraftId);
  const retrySyncDraft = useMomentDraftStore((s) => s.retrySyncDraft);
  const syncDraftsNow = useMomentDraftStore((s) => s.syncDraftsNow);
  const isOffline = useConnectivityStore((s) => s.isOffline);
  const camera = useAppCamera();
  const setCameraActive = camera?.setCameraActive;

  const listRef = useRef(null);
  const scrollRestoreRef = useRef(0);
  const offlineToastOnce = useRef(false);
  const cameraPausedRef = useRef(false);

  const [confirmId, setConfirmId] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [syncing, setSyncing] = useState(false);
  
  // Features
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState("all");
  const [syncFilter, setSyncFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState("desc");
  
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  
  const [previewId, setPreviewId] = useState(null);

  useEffect(() => {
    if (!open) return undefined;

    cameraPausedRef.current = true;
    try {
      setCameraActive?.(false);
      const stream = camera?.streamRef?.current;
      stream?.getVideoTracks?.()?.forEach((t) => {
        try {
          t.enabled = false;
        } catch {}
      });
      const videoEl = camera?.videoRef?.current;
      if (videoEl) {
        try {
          videoEl.pause?.();
        } catch {}
      }
    } catch {}

    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.classList.add("draft-library-open");

    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouch;
      document.documentElement.classList.remove("draft-library-open");

      const post = usePostStore.getState();
      const hasStudioMedia = !!(post.selectedFile || post.preview?.data);
      if (!hasStudioMedia && cameraPausedRef.current) {
        try {
          const stream = camera?.streamRef?.current;
          stream?.getVideoTracks?.()?.forEach((t) => {
            try {
              t.enabled = true;
            } catch {}
          });
          setCameraActive?.(true);
        } catch {}
      }
      cameraPausedRef.current = false;
    };
  }, [open, camera, setCameraActive]);

  useEffect(() => {
    if (!open) {
      offlineToastOnce.current = false;
      setMenuId(null);
      setConfirmId(null);
      setPreviewId(null);
      setMultiSelectMode(false);
      setSelectedIds(new Set());
      return;
    }
    void refreshList();
    requestAnimationFrame(() => {
      if (listRef.current && scrollRestoreRef.current > 0) {
        listRef.current.scrollTop = scrollRestoreRef.current;
      }
    });
    if (isOffline && !offlineToastOnce.current) {
      offlineToastOnce.current = true;
      SonnerInfo("Đang ngoại tuyến · Bản nháp vẫn được lưu");
    }
  }, [open, refreshList, isOffline, drafts.length]);

  useEffect(() => {
    if (!menuId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setMenuId(null);
    };
    const onDown = () => setMenuId(null);
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("click", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onDown);
    };
  }, [menuId]);

  const processedDrafts = useMemo(() => {
    let result = [...drafts];
    
    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(d => {
        const text = d.caption || d.overlays?.caption || d.overlays?.text || "";
        return text.toLowerCase().includes(q);
      });
    }
    
    // Media Filter
    if (mediaFilter === "image") {
      result = result.filter(d => d.mediaType !== "video");
    } else if (mediaFilter === "video") {
      result = result.filter(d => d.mediaType === "video");
    }
    
    // Sync Filter
    if (syncFilter === "synced") {
      result = result.filter(d => d.syncStatus === SYNC_STATUS.SYNCED);
    } else if (syncFilter === "local") {
      result = result.filter(d => d.syncStatus === SYNC_STATUS.PENDING_SYNC || !d.syncStatus);
    } else if (syncFilter === "error") {
      result = result.filter(d => d.syncStatus === SYNC_STATUS.SYNC_FAILED || d.syncStatus === SYNC_STATUS.CONFLICT);
    }
    
    // Sort
    result.sort((a, b) => {
      const ta = a.createdAt || a.updatedAt || 0;
      const tb = b.createdAt || b.updatedAt || 0;
      return sortOrder === "desc" ? tb - ta : ta - tb;
    });
    
    return result;
  }, [drafts, searchQuery, mediaFilter, syncFilter, sortOrder]);

  const saveScroll = () => {
    if (listRef.current) {
      scrollRestoreRef.current = listRef.current.scrollTop;
    }
  };

  const onEdit = async (id) => {
    setMenuId(null);
    setPreviewId(null);
    saveScroll();
    setBusyId(id);
    try {
      await restoreDraftIntoStudio(id);
    } finally {
      setBusyId(null);
    }
  };

  const onPost = async (id) => {
    setMenuId(null);
    setPreviewId(null);
    if (postingDraftId || isOffline) return;
    saveScroll();
    setBusyId(id);
    try {
      await postDraftById(id);
    } finally {
      setBusyId(null);
    }
  };
  
  const onDownload = async (id) => {
    setMenuId(null);
    setBusyId(id);
    try {
      const draft = drafts.find(d => d.id === id);
      if (!draft) return;
      let blob = await getDraftMediaBlob(id);
      if (!blob && !isOffline) {
        await ensureLocalMedia(id);
        blob = await getDraftMediaBlob(id);
      }
      if (blob) {
        const ext = draft.mediaType === "video" ? "mp4" : "jpg";
        downloadBlob(blob, `draft_${id}.${ext}`);
        SonnerSuccess("Đã lưu vào thiết bị");
      } else {
        SonnerError("Không thể tải file gốc");
      }
    } catch {
      SonnerError("Lỗi tải xuống");
    } finally {
      setBusyId(null);
    }
  };

  const onDelete = async (id) => {
    setBusyId(id);
    try {
      await confirmDeleteDraft(id);
      setConfirmId(null);
      setMenuId(null);
      setPreviewId(null);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelection = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBusyId("bulk");
    try {
      for (const id of selectedIds) {
        await confirmDeleteDraft(id);
      }
      setSelectedIds(new Set());
      setMultiSelectMode(false);
      setConfirmId(null);
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!drafts.length) {
      setConfirmId(null);
      return;
    }
    if (isOffline) {
      SonnerError("Cần mạng để xóa tất cả bản nháp trên tài khoản.");
      return;
    }

    const snapshot = drafts.filter((draft) => draft?.id);
    let deletedCount = 0;
    let failedCount = 0;
    let cursor = 0;
    const workerCount = Math.min(6, snapshot.length);
    const isSyntheticCloudDraft = (id) =>
      /(?:__cloud_\d+)+$/i.test(String(id || ""));

    setBusyId("delete-all");
    try {
      const worker = async () => {
        while (true) {
          const index = cursor;
          cursor += 1;
          if (index >= snapshot.length) return;

          const id = snapshot[index]?.id;
          if (!id) continue;

          try {
            // Synthetic conflict copies only live in the local cache / hidden
            // cloud history. Avoid wasting a network round-trip for them.
            if (!isSyntheticCloudDraft(id)) {
              try {
                await instanceMain.delete(
                  `/api/drafts/${encodeURIComponent(id)}`,
                  { timeout: 10_000 },
                );
              } catch (error) {
                if (error?.response?.status !== 404) throw error;
              }
            }

            const localDeleted = await deleteDraft(id);
            if (localDeleted === false) throw new Error("LOCAL_DELETE_FAILED");
            deletedCount += 1;
          } catch (error) {
            failedCount += 1;
            console.warn(
              "[draft-library] delete all item failed",
              id,
              error?.message || error,
            );
          }
        }
      };

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      setSelectedIds(new Set());
      setMultiSelectMode(false);
      setConfirmId(null);
      setMenuId(null);
      setPreviewId(null);
      await refreshList();

      if (failedCount > 0) {
        SonnerError(
          `Đã xóa ${deletedCount}/${snapshot.length} bản nháp`,
          `${failedCount} bản chưa xóa được · thử lại sau.`,
        );
      } else {
        SonnerSuccess(`Đã xóa tất cả ${deletedCount} bản nháp`);
      }
    } finally {
      setBusyId(null);
    }
  };
  
  const handleBulkSync = async () => {
    if (selectedIds.size === 0 || isOffline) return;
    setBusyId("bulk");
    try {
      for (const id of selectedIds) {
        const d = drafts.find(x => x.id === id);
        if (d && (d.syncStatus === SYNC_STATUS.SYNC_FAILED || d.syncStatus === SYNC_STATUS.CONFLICT || !d.syncStatus)) {
           await retrySyncDraft?.(id);
        }
      }
      setMultiSelectMode(false);
      setSelectedIds(new Set());
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  const shell = (
    <div
      className="draft-library-root fixed inset-0 z-[320] flex flex-col text-base-content bg-base-100 isolate"
      role="dialog"
      aria-modal="true"
    >
      <header
        className="relative z-10 flex flex-col gap-2 px-4 py-3 border-b border-base-300 shrink-0 bg-base-100/95 backdrop-blur"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate tracking-tight">Thư viện bản nháp</h2>
            <p className="text-xs font-medium opacity-60">
              {drafts.length} bản nháp {isOffline ? " · Ngoại tuyến" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!isOffline && (
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-1 text-primary hidden sm:flex"
                disabled={syncing}
                onClick={() => {
                  setSyncing(true);
                  syncDraftsNow?.().finally(() => setSyncing(false));
                }}
              >
                <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
                Đồng bộ
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle bg-base-200 ml-2"
              onClick={() => closeLibrary()}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 mt-1 overflow-x-auto no-scrollbar pb-1">
          <div className="relative flex-1 min-w-[140px] max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input 
              type="text" 
              placeholder="Tìm caption..." 
              className="input input-sm w-full bg-base-200 rounded-full pl-8 pr-3 text-sm focus:outline-none border-transparent focus:border-base-300"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <select 
            className="select select-sm bg-base-200 rounded-full border-transparent focus:border-base-300 text-sm focus:outline-none px-3 font-medium"
            value={mediaFilter}
            onChange={(e) => setMediaFilter(e.target.value)}
          >
            <option value="all">Tất cả</option>
            <option value="image">Chỉ ảnh</option>
            <option value="video">Chỉ video</option>
          </select>
          
          <select 
            className="select select-sm bg-base-200 rounded-full border-transparent focus:border-base-300 text-sm focus:outline-none px-3 font-medium"
            value={syncFilter}
            onChange={(e) => setSyncFilter(e.target.value)}
          >
            <option value="all">Mọi trạng thái</option>
            <option value="synced">Đã đồng bộ</option>
            <option value="local">Chưa đồng bộ</option>
            <option value="error">Lỗi đồng bộ</option>
          </select>

          <select 
            className="select select-sm bg-base-200 rounded-full border-transparent focus:border-base-300 text-sm focus:outline-none px-3 font-medium"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
          >
            <option value="desc">Mới nhất</option>
            <option value="asc">Cũ nhất</option>
          </select>
          
          <button 
            type="button"
            className={`btn btn-sm rounded-full border-0 font-medium whitespace-nowrap px-4 transition-colors ${multiSelectMode ? 'bg-primary text-primary-content hover:bg-primary/90' : 'bg-base-200 hover:bg-base-300'}`}
            onClick={() => {
              setMultiSelectMode(!multiSelectMode);
              if (multiSelectMode) setSelectedIds(new Set());
            }}
          >
            {multiSelectMode ? "Hủy chọn" : "Chọn nhiều"}
          </button>
          <button
            type="button"
            className="btn btn-sm rounded-full border-0 font-semibold whitespace-nowrap px-4 bg-error/10 text-error hover:bg-error/20"
            disabled={!drafts.length || Boolean(busyId) || Boolean(postingDraftId) || isOffline}
            title={isOffline ? "Cần mạng để xóa tất cả bản nháp trên tài khoản" : "Xóa toàn bộ bản nháp"}
            onClick={() => setConfirmId("all")}
          >
            <Trash2 size={14} /> Xóa tất cả
          </button>
        </div>
      </header>

      <div
        ref={listRef}
        className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-4 py-4 bg-base-100/50"
        style={{ paddingBottom: multiSelectMode ? "calc(5rem + env(safe-area-inset-bottom))" : "max(2.5rem, env(safe-area-inset-bottom))" }}
      >
        {!processedDrafts.length ? (
          <div className="flex flex-col items-center justify-center text-center py-20 px-6 gap-3 min-h-[50vh]">
            <div className="w-16 h-16 rounded-full bg-base-200 flex items-center justify-center opacity-80 mb-2">
              <ImageIcon size={28} />
            </div>
            <p className="text-base font-semibold">Không tìm thấy bản nháp</p>
            <p className="text-sm opacity-60">Hãy thử thay đổi bộ lọc hoặc chụp ảnh mới.</p>
          </div>
        ) : (
          <ul className="draft-library-grid">
            {processedDrafts.map((d) => (
              <DraftPreviewCard
                key={d.id}
                draft={d}
                busy={busyId === d.id || busyId === "bulk" || busyId === "delete-all" || postingDraftId === d.id}
                posting={postingDraftId === d.id}
                offline={isOffline}
                menuOpen={menuId === d.id}
                onToggleMenu={(e) => {
                  e?.stopPropagation?.();
                  if (multiSelectMode) return;
                  setMenuId((cur) => (cur === d.id ? null : d.id));
                }}
                onPreview={() => {
                  if (multiSelectMode) toggleSelection(d.id);
                  else setPreviewId(d.id);
                }}
                onEdit={() => onEdit(d.id)}
                onPost={() => onPost(d.id)}
                onDownload={() => onDownload(d.id)}
                onDeleteRequest={() => {
                  setMenuId(null);
                  setConfirmId(d.id);
                }}
                onRetrySync={() => {
                  if (isOffline) return;
                  void retrySyncDraft?.(d.id);
                }}
                selectable={multiSelectMode}
                selected={selectedIds.has(d.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Multi-select bottom bar */}
      {multiSelectMode && (
        <div className="absolute bottom-0 inset-x-0 z-40 bg-base-100 border-t border-base-300 p-3 flex items-center justify-between shadow-[0_-10px_30px_rgba(0,0,0,0.05)]"
             style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <span className="text-sm font-bold pl-2">{selectedIds.size} mục đã chọn</span>
          <div className="flex gap-2">
            {!isOffline && (
              <button 
                className="btn btn-ghost btn-sm rounded-xl font-semibold gap-1 text-primary"
                disabled={selectedIds.size === 0 || busyId === "bulk"}
                onClick={handleBulkSync}
              >
                Đồng bộ
              </button>
            )}
            <button 
              className="btn btn-error btn-sm rounded-xl font-semibold gap-1"
              disabled={selectedIds.size === 0 || busyId === "bulk"}
              onClick={() => setConfirmId("bulk")}
            >
              <Trash2 size={14} /> Xóa
            </button>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewId && (
        <PreviewModal 
          draft={drafts.find(d => d.id === previewId)}
          onClose={() => setPreviewId(null)}
          onEdit={() => onEdit(previewId)}
          onPost={() => onPost(previewId)}
          onDownload={() => onDownload(previewId)}
          onDelete={() => { setPreviewId(null); setConfirmId(previewId); }}
          busy={busyId === previewId || postingDraftId === previewId}
          offline={isOffline}
        />
      )}

      {/* Confirm Delete Modal */}
      {confirmId && (
        <div className="absolute inset-0 z-[400] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-[24px] p-6 shadow-2xl border border-base-300 bg-base-100 scale-in">
            <h3 className="text-lg font-bold mb-2">
              {confirmId === "all"
                ? `Xóa tất cả ${drafts.length} bản nháp?`
                : confirmId === "bulk"
                  ? `Xóa ${selectedIds.size} bản nháp?`
                  : "Xóa bản nháp này?"}
            </h3>
            <p className="text-sm opacity-75 mb-6 leading-relaxed">
              {confirmId === "all"
                ? "Tất cả bản nháp trên tài khoản và thiết bị này sẽ bị xóa vĩnh viễn. Thao tác này không thể hoàn tác."
                : "Dữ liệu chưa đăng sẽ bị xóa vĩnh viễn và không thể khôi phục."}
            </p>
            <div className="flex flex-col gap-2 w-full">
              <button
                type="button"
                className="btn btn-error w-full rounded-2xl font-bold"
                disabled={Boolean(busyId)}
                onClick={() => confirmId === "all" ? handleDeleteAll() : confirmId === "bulk" ? handleBulkDelete() : onDelete(confirmId)}
              >
                {busyId === "delete-all" ? "Đang xóa…" : "Xóa vĩnh viễn"}
              </button>
              <button
                type="button"
                className="btn btn-ghost bg-base-200 w-full rounded-2xl font-bold"
                disabled={Boolean(busyId)}
                onClick={() => setConfirmId(null)}
              >
                Giữ lại
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(
      <>
        <DraftLibraryStyles />
        {shell}
      </>,
      document.body,
    );
  }
  return <><DraftLibraryStyles />{shell}</>;
}

// --- STYLES ---
const _draftStylesInserted = { current: false };
function DraftLibraryStyles() {
  useEffect(() => {
    if (_draftStylesInserted.current) return undefined;
    _draftStylesInserted.current = true;
    const style = document.createElement("style");
    style.setAttribute("data-draft-library", "scoped");
    style.textContent = `
      .draft-library-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        width: 100%;
        max-width: 1400px;
        margin: 0 auto;
        list-style: none;
        padding: 0;
      }
      @media (min-width: 768px) {
        .draft-library-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
      }
      @media (min-width: 1024px) {
        .draft-library-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }
      }
      @media (min-width: 1280px) {
        .draft-library-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
      }
      @media (min-width: 1536px) {
        .draft-library-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
      }
      
      .draft-card-inner {
        transform: scale(1);
        transition: transform 0.16s cubic-bezier(0.2, 0, 0, 1);
      }
      @media (hover: hover) {
        .draft-card-inner:hover {
          transform: scale(0.98);
        }
      }
      
      @keyframes draft-skeleton-pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.2; }
      }
      .draft-thumb-skeleton {
        animation: draft-skeleton-pulse 1.5s ease-in-out infinite;
        background: var(--fallback-b3,oklch(var(--b3)/1));
      }
      .scale-in {
        animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }
      @keyframes scaleIn {
        from { opacity: 0; transform: scale(0.95) translateY(10px); }
        to { opacity: 1; transform: scale(1) translateY(0); }
      }
      
      .no-scrollbar::-webkit-scrollbar { display: none; }
      .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    `;
    document.head.appendChild(style);
    return () => {
      _draftStylesInserted.current = false;
      style.remove();
    };
  }, []);
  return null;
}

// --- DRAFT CARD ---
function DraftPreviewCard({
  draft, busy, posting, offline, menuOpen, onToggleMenu, onPreview,
  onEdit, onPost, onDownload, onDeleteRequest, onRetrySync, selectable, selected
}) {
  const thumbUrlRef = useRef(null);
  const [thumbUrl, setThumbUrl] = useState(null);
  const [thumbLoadState, setThumbLoadState] = useState("loading");

  const isVideo = draft.mediaType === "video";
  const syncFailed = draft.syncStatus === SYNC_STATUS.SYNC_FAILED || draft.syncStatus === SYNC_STATUS.CONFLICT;
  const isLocal = draft.syncStatus === SYNC_STATUS.PENDING_SYNC || !draft.syncStatus;
  
  const overlayData = useMemo(() => buildOverlayData(draft), [draft]);
  const captionText = overlayData.caption || "";

  useEffect(() => {
    let cancelled = false;
    setThumbLoadState("loading");
    (async () => {
      let blob = await getDraftThumbnailBlob(draft.id);
      if (!blob && !offline) {
        try {
          const r = await ensureLocalThumbnail(draft.id);
          blob = r?.blob || (await getDraftThumbnailBlob(draft.id));
        } catch {}
      }
      if (cancelled) return;
      if (!blob) {
        setThumbLoadState("error");
        return;
      }
      if (thumbUrlRef.current) {
        try { URL.revokeObjectURL(thumbUrlRef.current); } catch {}
      }
      const u = URL.createObjectURL(blob);
      thumbUrlRef.current = u;
      setThumbUrl(u);
      setThumbLoadState("loaded");
    })();
    return () => {
      cancelled = true;
      if (thumbUrlRef.current) {
        try { URL.revokeObjectURL(thumbUrlRef.current); } catch {}
        thumbUrlRef.current = null;
      }
    };
  }, [draft.id, offline]);

  return (
    <li className="list-none group outline-none select-none" tabIndex={0}>
      <div className="relative draft-card-inner h-full flex flex-col">
        
        {/* Aspect Ratio Container (3:4) */}
        <div 
          role="button"
          className={`relative aspect-square w-full overflow-hidden rounded-2xl bg-base-200 shadow-sm cursor-pointer border-2 transition-colors ${selected ? 'border-primary shadow-primary/20' : 'border-transparent'}`}
          onClick={onPreview}
        >
          {/* Checkbox (Multi-select) */}
          {selectable && (
            <div className="absolute top-2 left-2 z-30 drop-shadow-md bg-black/10 rounded-full">
              {selected ? <CheckCircle2 className="text-primary fill-base-100" size={24} /> : <Circle className="text-white/90" size={24} />}
            </div>
          )}

          {/* Menu Button (Single select) */}
          {!selectable && (
            <div className="absolute top-2 right-2 z-30 drop-shadow-md">
              <button
                type="button"
                className="btn btn-circle btn-xs bg-black/40 border-0 text-white hover:bg-black/70 backdrop-blur-sm transition-colors"
                onClick={onToggleMenu}
                disabled={busy}
              >
                <MoreVertical size={16} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 mt-1 w-48 rounded-2xl bg-base-100/95 backdrop-blur-xl shadow-xl border border-base-300 overflow-hidden z-40 text-base-content font-semibold py-1 scale-in"
                  onClick={e => e.stopPropagation()}
                >
                  <button className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-base-200 transition-colors" disabled={busy} onClick={onEdit}>Tiếp tục chỉnh sửa</button>
                  <button className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-base-200 transition-colors disabled:opacity-50" disabled={busy || posting || offline} onClick={onPost}>{posting ? "Đang đăng..." : "Đăng ngay"}</button>
                  <button className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-base-200 transition-colors" disabled={busy} onClick={onDownload}>Tải xuống</button>
                  {(syncFailed || isLocal) && (
                    <button className="w-full text-left px-4 py-2.5 text-[13px] hover:bg-base-200 transition-colors disabled:opacity-50" disabled={busy || offline} onClick={onRetrySync}>Thử đồng bộ lại</button>
                  )}
                  <div className="my-1 border-t border-base-300/50"></div>
                  <button className="w-full text-left px-4 py-2.5 text-[13px] text-error hover:bg-error/10 transition-colors" disabled={busy || posting} onClick={onDeleteRequest}>Xóa bản nháp</button>
                </div>
              )}
            </div>
          )}

          {/* Media Thumbnail */}
          {thumbUrl ? (
            <img src={thumbUrl} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
          ) : thumbLoadState === "loading" ? (
            <div className="absolute inset-0 draft-thumb-skeleton" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-base-content/40 bg-base-300/50">
              {isVideo ? <Video size={36} className="opacity-30 mb-2" /> : <ImageIcon size={36} className="opacity-30 mb-2" />}
              <span className="text-xs font-semibold">Chưa có ảnh</span>
            </div>
          )}

          {/* Video Indicator */}
          {isVideo && (
            <div className="absolute top-2 right-2 z-20 bg-black/40 rounded-full p-1.5 backdrop-blur-sm shadow-sm" style={{ display: selectable ? 'block' : (menuOpen ? 'none' : 'block') }}>
              <Video size={14} className="text-white" />
            </div>
          )}
          
          {/* Sync Status Badge */}
          <div className="absolute bottom-0 inset-x-0 h-24 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none z-10" />
          <div className="absolute bottom-2.5 inset-x-3 z-20 flex flex-col gap-1 pointer-events-none text-white drop-shadow-md">
            {captionText && <p className="text-[13px] font-bold truncate leading-tight">{captionText}</p>}
            <div className="flex items-center gap-1.5 text-[11px] font-medium opacity-90">
              <span className="truncate">{formatDraftCreatedAt(draft.createdAt || draft.updatedAt)}</span>
              {syncFailed && <AlertTriangle size={12} className="text-error drop-shadow-md" />}
              {!syncFailed && isLocal && <RefreshCw size={10} className="opacity-70" />}
            </div>
          </div>

          {posting && (
            <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 text-white">
              <span className="loading loading-spinner loading-md" />
              <span className="text-xs font-bold tracking-wide">Đang đăng...</span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// --- PREVIEW MODAL ---
function PreviewModal({ draft, onClose, onEdit, onPost, onDownload, onDelete, busy, offline }) {
  const [mediaUrl, setMediaUrl] = useState(null);
  const [thumbUrl, setThumbUrl] = useState(null);
  const [loadingMedia, setLoadingMedia] = useState(true);
  
  const isVideo = draft.mediaType === "video";
  const overlayData = useMemo(() => buildOverlayData(draft), [draft]);
  
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const thumb = await getDraftThumbnailBlob(draft.id);
      if (thumb && !cancelled) setThumbUrl(URL.createObjectURL(thumb));
      
      let blob = await getDraftMediaBlob(draft.id);
      if (!blob && !offline) {
        try {
          await ensureLocalMedia(draft.id);
          blob = await getDraftMediaBlob(draft.id);
        } catch {}
      }
      if (cancelled) return;
      if (blob) {
        setMediaUrl(URL.createObjectURL(blob));
      }
      setLoadingMedia(false);
    })();
    return () => {
      cancelled = true;
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    };
  }, [draft.id, offline]);

  return (
    <div className="fixed inset-0 z-[350] bg-black/95 flex flex-col scale-in backdrop-blur-xl">
      <header className="absolute top-0 inset-x-0 z-50 flex items-center justify-between p-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
        <button className="btn btn-circle btn-sm bg-white/20 hover:bg-white/30 text-white border-0 transition-colors" onClick={onClose}><X size={20} /></button>
        <div className="flex items-center gap-3">
          <span className="text-white/90 text-sm font-semibold tracking-wide drop-shadow-md">
            {formatDraftCreatedAt(draft.createdAt || draft.updatedAt)}
          </span>
          <button className="btn btn-circle btn-sm bg-white/20 hover:bg-white/30 text-white border-0 transition-colors" onClick={onDownload} disabled={busy} title="Tải xuống">
            <Download size={16} />
          </button>
        </div>
      </header>
      
      <div className="flex-1 w-full h-full flex items-center justify-center relative overflow-hidden px-2 pb-24">
        {mediaUrl ? (
          isVideo ? (
            <video src={mediaUrl} poster={thumbUrl} autoPlay loop playsInline className="w-full max-h-[85vh] object-contain rounded-3xl" />
          ) : (
            <img src={mediaUrl} alt="" className="w-full max-h-[85vh] object-contain rounded-3xl" />
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {loadingMedia ? (
              <div className="flex flex-col items-center gap-3 text-white/70">
                <span className="loading loading-spinner loading-lg" />
                <span className="text-sm font-medium">Đang tải bản nháp gốc...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 text-white/50">
                <AlertTriangle size={48} className="opacity-50" />
                <span className="text-sm font-medium">Không thể tải file gốc</span>
              </div>
            )}
          </div>
        )}
        
        {/* Caption layer */}
        <div className="absolute inset-0 pointer-events-none flex items-end justify-center pb-28">
          <div className="scale-90 origin-bottom">
            <OverlayRenderer overlayData={overlayData} momentId={`preview-${draft.id}`} />
          </div>
        </div>
      </div>
      
      <footer className="absolute bottom-0 inset-x-0 z-50 p-4 bg-gradient-to-t from-black/80 to-transparent flex items-center justify-center gap-3" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
        <button className="btn bg-white/10 hover:bg-white/20 text-white rounded-3xl flex-1 border-0 h-14 font-semibold text-base transition-colors" onClick={onDelete} disabled={busy}><Trash2 size={20} /> Xóa</button>
        <button className="btn bg-base-100 hover:bg-base-200 text-base-content rounded-3xl flex-1 border-0 h-14 font-bold text-base transition-colors shadow-xl" onClick={onEdit} disabled={busy}>Tiếp tục chỉnh</button>
        <button className="btn btn-primary text-primary-content rounded-3xl flex-1 border-0 h-14 font-bold text-base shadow-xl shadow-primary/30" onClick={onPost} disabled={busy || offline}>{offline ? "Ngoại tuyến" : "Đăng ngay"}</button>
      </footer>
    </div>
  );
}