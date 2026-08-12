import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Files,
  Gauge,
  ImageDown,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  STATUS_UPLOAD_MOMENT,
  useUploadQueueStore,
} from "@/stores/PostStores/useUploadPostStore";
import { useMomentDraftStore } from "@/stores/PostStores/useMomentDraftStore";
import { createDraft, resolveDraftUid } from "@/utils/momentDraft";
import {
  classifyPhoneMedia,
  normalizePhoneImage,
} from "@/utils/imageUtils";

function humanBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${units[i]}`;
}

function statusMeta(status) {
  if (status === STATUS_UPLOAD_MOMENT.UPLOADING) return { label: "Đang tải", className: "badge-info" };
  if (status === STATUS_UPLOAD_MOMENT.FAILED) return { label: "Thất bại", className: "badge-error" };
  if (status === STATUS_UPLOAD_MOMENT.DONE) return { label: "Hoàn tất", className: "badge-success" };
  return { label: "Đang chờ", className: "badge-warning" };
}

async function normalizeQueuedImage(file) {
  const normalized = await normalizePhoneImage(file, {
    maxEdge: 2048,
    outputType: "image/jpeg",
    quality: 0.9,
  });
  return {
    file: normalized,
    compressed: normalized.size < file.size,
    normalized: true,
    savedBytes: Math.max(0, file.size - normalized.size),
  };
}

export default function UploadQueuePanel({ onOpenDrafts }) {
  const inputRef = useRef(null);
  const [progressMap, setProgressMap] = useState({});
  const [preparing, setPreparing] = useState(false);
  const [prepareText, setPrepareText] = useState("");
  const [online, setOnline] = useState(() => navigator.onLine !== false);

  const uploadItems = useUploadQueueStore((s) => s.uploadItems);
  const postedMoments = useUploadQueueStore((s) => s.postedMoments);
  const isQueueRunning = useUploadQueueStore((s) => s.isQueueRunning);
  const hydrateUploadQueue = useUploadQueueStore((s) => s.hydrateUploadQueue);
  const resumeQueue = useUploadQueueStore((s) => s.resumeQueue);
  const retryUploadItem = useUploadQueueStore((s) => s.retryUploadItem);
  const removeUploadItemById = useUploadQueueStore((s) => s.removeUploadItemById);
  const postDraftById = useMomentDraftStore((s) => s.postDraftById);
  const refreshList = useMomentDraftStore((s) => s.refreshList);

  useEffect(() => {
    hydrateUploadQueue();
  }, [hydrateUploadQueue]);

  useEffect(() => {
    const onProgress = (event) => {
      const detail = event.detail || {};
      if (!detail.id) return;
      setProgressMap((current) => ({
        ...current,
        [detail.id]: { ...(current[detail.id] || {}), ...detail },
      }));
    };
    const onOnline = () => {
      setOnline(true);
      resumeQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("huy-locket-upload-progress", onProgress);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("huy-locket-upload-progress", onProgress);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [resumeQueue]);

  const stats = useMemo(() => {
    const queued = uploadItems.filter((i) => i.status === STATUS_UPLOAD_MOMENT.QUEUED).length;
    const uploading = uploadItems.filter((i) => i.status === STATUS_UPLOAD_MOMENT.UPLOADING).length;
    const failed = uploadItems.filter((i) => i.status === STATUS_UPLOAD_MOMENT.FAILED).length;
    return { queued, uploading, failed };
  }, [uploadItems]);

  const handleMultiFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || preparing) return;
    const uid = resolveDraftUid();
    if (!uid) {
      toast.error("Cần đăng nhập để tạo hàng đợi");
      return;
    }

    setPreparing(true);
    let added = 0;
    let savedBytes = 0;
    let failed = 0;
    try {
      for (let index = 0; index < files.length; index += 1) {
        const raw = files[index];
        const mediaType = classifyPhoneMedia(raw);
        if (!mediaType) {
          failed += 1;
          continue;
        }
        setPrepareText(`Chuẩn bị ${index + 1}/${files.length}: ${raw.name}`);
        let optimized = { file: raw, compressed: false, normalized: false, savedBytes: 0 };
        try {
          if (mediaType === "image") {
            optimized = await normalizeQueuedImage(raw);
          }
        } catch (error) {
          failed += 1;
          toast.error(`Không xử lý được ${raw.name}`, {
            description: error?.message || "Ảnh không hợp lệ.",
          });
          continue;
        }
        savedBytes += optimized.savedBytes || 0;
        const result = await createDraft({
          ownerUid: uid,
          file: optimized.file,
          meta: {
            caption: "",
            audience: "all",
            optionsData: {
              draftFolder: "Hàng đợi nhanh",
              draftTags: ["upload-queue"],
              optimizedImage: optimized.compressed,
              normalizedPhoneImage: optimized.normalized,
            },
          },
        });
        if (!result?.id) continue;
        added += 1;
        await postDraftById(result.id);
      }
      await refreshList(uid);
      await hydrateUploadQueue();
      if (added) {
        toast.success(`Đã thêm ${added} file vào hàng đợi`, {
          description: savedBytes > 0
            ? `Ảnh đã xoay đúng và tối ưu, giảm ${humanBytes(savedBytes)} trước upload.`
            : "Ảnh điện thoại đã được xoay đúng và chuẩn hóa trước upload.",
        });
      } else if (!failed) {
        toast.warning("Không có file hợp lệ để thêm");
      }
    } finally {
      setPreparing(false);
      setPrepareText("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 text-base-content">
      <section className="overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-lg">
        <header className="border-b border-base-300 p-4 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-2xl font-bold"><UploadCloud className="h-6 w-6" /> Upload 2.0</h2>
              <p className="mt-1 text-sm text-base-content/60">
                Hàng đợi nhiều file, tiếp tục an toàn khi có mạng, giữ bài lỗi để thử lại và hiển thị tiến độ truyền thật tới API.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input ref={inputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleMultiFiles} />
              <button type="button" className="btn btn-sm btn-primary" disabled={preparing} onClick={() => inputRef.current?.click()}>
                <Files className="h-4 w-4" /> Thêm nhiều file
              </button>
              <button type="button" className="btn btn-sm btn-outline" disabled={isQueueRunning || !online} onClick={() => resumeQueue()}>
                <Play className="h-4 w-4" /> Chạy/Resume
              </button>
            </div>
          </div>

          {!online && (
            <div className="alert alert-warning mt-4 py-2 text-sm">
              <WifiOff className="h-4 w-4" /> Mất mạng — hàng đợi được giữ lại và sẽ tiếp tục an toàn khi online.
            </div>
          )}
          {preparing && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-base-200 px-3 py-2 text-sm">
              <span className="loading loading-spinner loading-xs" /> {prepareText || "Đang chuẩn bị file..."}
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl bg-base-200/50 p-3"><div className="text-xs text-base-content/55">Đang chờ</div><div className="text-2xl font-bold">{stats.queued}</div></div>
            <div className="rounded-2xl bg-info/10 p-3"><div className="text-xs text-base-content/55">Đang upload</div><div className="text-2xl font-bold">{stats.uploading}</div></div>
            <div className="rounded-2xl bg-error/10 p-3"><div className="text-xs text-base-content/55">Lỗi</div><div className="text-2xl font-bold">{stats.failed}</div></div>
            <div className="rounded-2xl bg-success/10 p-3"><div className="text-xs text-base-content/55">Đã đăng lưu cục bộ</div><div className="text-2xl font-bold">{postedMoments.length}</div></div>
          </div>
        </header>

        <div className="p-4 sm:p-5">
          {uploadItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-base-300 py-14 text-center">
              <ImageDown className="mx-auto h-8 w-8 text-base-content/35" />
              <p className="mt-2 text-sm text-base-content/55">Hàng đợi đang trống.</p>
              <button type="button" className="btn btn-sm btn-ghost mt-2" onClick={onOpenDrafts}>Mở Bản nháp 2.0</button>
            </div>
          ) : (
            <div className="space-y-3">
              {uploadItems.map((item) => {
                const meta = statusMeta(item.status);
                const p = progressMap[item.id] || {};
                const percent = typeof p.progress === "number" ? p.progress : null;
                return (
                  <article key={item.id} className="rounded-2xl border border-base-300 bg-base-200/25 p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`badge badge-sm ${meta.className}`}>{meta.label}</span>
                          <span className="text-xs font-semibold">{item.contentType === "video" || item.mediaInfo?.type === "video" ? "Video" : "Ảnh"}</span>
                          {Number(item.retryCount || 0) > 0 && <span className="text-[11px] text-base-content/50">retry {item.retryCount}</span>}
                        </div>
                        <p className="mt-1 max-w-xl truncate text-xs text-base-content/50">{item.mediaInfo?.fileName || item.fileName || item.id}</p>
                      </div>
                      <div className="flex gap-1">
                        {item.status === STATUS_UPLOAD_MOMENT.FAILED && (
                          <button type="button" className="btn btn-xs btn-outline" disabled={!online} onClick={() => retryUploadItem(item.id)}><RotateCcw size={12} /> Thử lại</button>
                        )}
                        {item.status !== STATUS_UPLOAD_MOMENT.UPLOADING && (
                          <button type="button" aria-label="Xóa khỏi hàng đợi" className="btn btn-xs btn-ghost text-error" onClick={() => removeUploadItemById(item.id)}><Trash2 size={12} /></button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-base-content/55">
                        <span className="flex items-center gap-1"><Gauge size={12} />
                          {p.phase === "processing" ? "API đã nhận xong · Locket đang xử lý" : percent != null ? `${percent}%` : "Chờ dữ liệu tiến độ thật"}
                        </span>
                        <span>
                          {p.loaded ? `${humanBytes(p.loaded)}${p.total ? ` / ${humanBytes(p.total)}` : ""}` : ""}
                          {p.speedBps ? ` · ${humanBytes(p.speedBps)}/s` : ""}
                        </span>
                      </div>
                      <progress
                        className="progress progress-primary w-full"
                        value={percent == null ? undefined : percent}
                        max="100"
                      />
                      {item.errorMessage && <p className="mt-2 text-xs text-error">{item.errorMessage}</p>}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
