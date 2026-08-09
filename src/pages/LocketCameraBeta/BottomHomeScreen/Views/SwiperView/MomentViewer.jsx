import { ImageOff, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { OverlayRenderer } from "@/components/Overlay";
import { applyLocalOverlayToMoment } from "@/utils/overlay/reconcilePostedOverlay";
import {
  useAuthStore,
  useMomentActivityStore,
  useMomentsStoreV2,
  useUploadQueueStore,
  resolveMomentOwnerUid,
  resolveMyUid,
} from "@/stores";
import MomentOwnerInfo from "../../Layout/MomentOwnerInfo";

const NON_TEXT_OVERLAY_TYPES = new Set([
  "music",
  "poll",
  "review",
  "color_palette",
  "streak",
  "locket_count",
  "weather",
  "location",
  "battery",
  "time",
  "heart",
  "special",
  "decorative",
  "template",
  "image_icon",
  "image_gif",
  "caption_gif",
  "caption_image",
  "star_sign",
  "static_content",
]);

const IMAGE_URL_RE = /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|webp)(?:[?#]|$)/i;
const VIDEO_URL_RE = /\.(?:m4v|mov|mp4|webm)(?:[?#]|$)/i;

function isUsableMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  const url = value.trim();
  return !(
    url.startsWith("inline:") ||
    url.startsWith("blob:") ||
    url.startsWith("data:")
  );
}

function looksLikeImageUrl(value) {
  return typeof value === "string" && IMAGE_URL_RE.test(value);
}

function looksLikeVideoUrl(value) {
  if (typeof value !== "string") return false;
  return VIDEO_URL_RE.test(value) || /\/moments\/videos\//i.test(value);
}

function hasObjectContent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0,
  );
}

function isRenderableOverlayData(value) {
  if (!value) return false;
  if (Array.isArray(value)) {
    return value.some((item) => isRenderableOverlayData(item?.data || item));
  }
  if (typeof value !== "object") return false;

  const data = value.data && typeof value.data === "object" ? value.data : value;
  const text = data.text || data.caption || value.alt_text || "";
  if (typeof text === "string" && text.trim()) return true;

  const type = String(data.type || value.type || "").toLowerCase();
  const overlayId = String(value.overlay_id || data.overlay_id || "").toLowerCase();
  const resolvedType =
    type ||
    (overlayId.startsWith("caption:")
      ? overlayId.slice("caption:".length)
      : "");

  if (NON_TEXT_OVERLAY_TYPES.has(resolvedType)) return true;

  const isPlainCaption =
    !resolvedType ||
    resolvedType === "caption" ||
    resolvedType === "standard" ||
    resolvedType === "default";

  return (
    !isPlainCaption &&
    (hasObjectContent(data.payload) || hasObjectContent(data.icon))
  );
}

function resolveMomentOverlay(moment) {
  if (!moment || typeof moment !== "object") return null;

  const legacyCaption =
    (Array.isArray(moment.captions)
      ? moment.captions.find((item) => item?.text || item?.caption)
      : null) || null;

  const captionText =
    moment.caption || legacyCaption?.text || legacyCaption?.caption || "";

  if (Array.isArray(moment.overlays)) {
    if (isRenderableOverlayData(moment.overlays)) return moment.overlays;
  } else if (moment.overlays && typeof moment.overlays === "object") {
    const overlay = moment.overlays;
    const overlayText = overlay.text || overlay.caption || captionText || "";
    const resolved = {
      ...overlay,
      type: overlay.type || legacyCaption?.type || "caption",
      text: overlayText,
      caption: overlayText,
      text_color:
        overlay.text_color || overlay.textColor || legacyCaption?.text_color,
      icon: overlay.icon || legacyCaption?.icon || {},
      background: overlay.background || legacyCaption?.background || {},
      payload: overlay.payload || legacyCaption?.payload || {},
    };

    if (isRenderableOverlayData(resolved)) return resolved;
  }

  if (!captionText) return null;

  return {
    type: legacyCaption?.type || "caption",
    overlay_id:
      legacyCaption?.type === "music" ? "caption:music" : "caption:standard",
    text: captionText,
    caption: captionText,
    text_color: legacyCaption?.text_color,
    icon: legacyCaption?.icon || {},
    background: legacyCaption?.background || {},
    payload: legacyCaption?.payload || {},
  };
}

const MomentViewer = ({ moment, handleClose }) => {
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isImageReady, setIsImageReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const stableOverlayRef = useRef({ momentId: null, data: null });
  const repairedGhostRef = useRef(null);

  const { user } = useAuthStore();
  const myUid = resolveMyUid(user);
  const ownerUid = resolveMomentOwnerUid(moment);
  const isOwnMoment = Boolean(myUid && ownerUid && myUid === ownerUid);

  const pullLatestMoments = useMomentsStoreV2((s) => s.pullLatestMoments);
  const removeMoment = useMomentsStoreV2((s) => s.removeMoment);

  const pollCounts = useMomentActivityStore((s) =>
    isOwnMoment && moment?.id ? s.byMomentId[moment.id]?.pollCounts : null,
  );

  const postedMomentFallback = useUploadQueueStore((s) => {
    if (!moment?.id || !Array.isArray(s.postedMoments)) return null;
    return (
      s.postedMoments.find(
        (item) => item?.id === moment.id || item?.postId === moment.id,
      ) || null
    );
  });

  const rawThumbnailUrl =
    moment?.thumbnailUrl || moment?.thumbnail_url || null;
  const rawImageUrl = moment?.imageUrl || moment?.image_url || null;
  const rawVideoUrl = moment?.videoUrl || moment?.video_url || null;

  const thumbnailUrl = useMemo(() => {
    const candidates = [rawThumbnailUrl, rawImageUrl];

    if (looksLikeImageUrl(rawVideoUrl)) candidates.push(rawVideoUrl);

    return (
      candidates.find(
        (url) => isUsableMediaUrl(url) && !looksLikeVideoUrl(url),
      ) || null
    );
  }, [rawImageUrl, rawThumbnailUrl, rawVideoUrl]);

  const videoUrl = useMemo(() => {
    if (!isUsableMediaUrl(rawVideoUrl)) return null;
    if (looksLikeImageUrl(rawVideoUrl)) return null;
    return rawVideoUrl;
  }, [rawVideoUrl]);

  const resolvedMoment = useMemo(() => {
    const savedLocalOverlay = resolveMomentOverlay(postedMomentFallback);
    return savedLocalOverlay
      ? applyLocalOverlayToMoment(moment, savedLocalOverlay)
      : moment;
  }, [moment, postedMomentFallback]);

  const resolvedOverlayData = useMemo(
    () =>
      resolveMomentOverlay(resolvedMoment) ||
      resolveMomentOverlay(postedMomentFallback),
    [resolvedMoment, postedMomentFallback],
  );

  const momentId = moment?.id || null;
  if (stableOverlayRef.current.momentId !== momentId) {
    stableOverlayRef.current = { momentId, data: null };
  }
  if (resolvedOverlayData) {
    stableOverlayRef.current.data = resolvedOverlayData;
  }
  const overlayData = resolvedOverlayData || stableOverlayRef.current.data;

  useEffect(() => {
    setIsVideoReady(false);
    setIsImageReady(false);
    setVideoFailed(false);
    setImageFailed(false);
    setIsRefreshing(false);
  }, [momentId, thumbnailUrl, videoUrl]);

  const hasMediaUrl = Boolean(thumbnailUrl || videoUrl);
  const mediaUnavailable =
    (!thumbnailUrl || imageFailed) && (!videoUrl || videoFailed);

  useEffect(() => {
    if (
      !momentId ||
      hasMediaUrl ||
      !String(momentId).startsWith("local_") ||
      repairedGhostRef.current === momentId
    ) {
      return undefined;
    }

    repairedGhostRef.current = momentId;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        await pullLatestMoments(null);
        if (cancelled) return;
        await removeMoment(momentId, null);
        if (!cancelled) handleClose?.();
      } catch (error) {
        console.warn("repair local moment without media:", error);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [handleClose, hasMediaUrl, momentId, pullLatestMoments, removeMoment]);

  const handleRefreshMedia = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setImageFailed(false);
    setVideoFailed(false);
    setIsImageReady(false);
    setIsVideoReady(false);

    try {
      await pullLatestMoments(null);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="moment-enter flex w-full flex-col justify-center items-center">
      <div
        className="relative flex flex-col items-center w-full gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Đóng khoảnh khắc"
          onClick={handleClose}
          className="absolute flex justify-center items-center top-4 right-4 z-50 p-2 bg-black/40 rounded-full hover:bg-black/60"
        >
          <X className="w-6 h-6 text-white" />
        </button>

        <div className="h-full w-full border-t border-b border-base-300 sm:max-w-sm max-w-md aspect-square flex items-center justify-center relative bg-base-300 rounded-[64px] overflow-hidden">
          {hasMediaUrl && !isImageReady && !isVideoReady && !mediaUnavailable && (
            <div className="moment-skeleton absolute inset-0 w-full h-full skeleton rounded-[64px] z-0" />
          )}

          {thumbnailUrl && !imageFailed && (
            <img
              src={thumbnailUrl}
              alt={resolvedMoment?.caption || "Moment"}
              className={`moment-media-fade absolute inset-0 w-full h-full object-cover rounded-[64px] transition-opacity duration-300 z-10 ${
                isVideoReady ? "opacity-0" : "opacity-100"
              }`}
              onLoad={() => setIsImageReady(true)}
              onError={() => setImageFailed(true)}
              referrerPolicy="no-referrer"
            />
          )}

          {videoUrl && !videoFailed && (
            <video
              src={videoUrl}
              className={`moment-media-fade absolute inset-0 w-full h-full object-cover rounded-[64px] transition-opacity duration-300 z-20 ${
                isVideoReady ? "opacity-100" : "opacity-0"
              }`}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={thumbnailUrl || undefined}
              onLoadedData={() => setIsVideoReady(true)}
              onCanPlay={() => setIsVideoReady(true)}
              onError={() => setVideoFailed(true)}
            />
          )}

          {mediaUnavailable && (
            <div className="absolute inset-0 z-25 flex flex-col items-center justify-center gap-3 bg-base-300 px-6 text-center">
              <ImageOff className="h-10 w-10 opacity-60" />
              <p className="text-sm font-medium opacity-75">
                Media của bài này chưa đồng bộ xong.
              </p>
              <button
                type="button"
                onClick={handleRefreshMedia}
                disabled={isRefreshing}
                className="btn btn-sm btn-outline gap-2"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                />
                {isRefreshing ? "Đang đồng bộ" : "Đồng bộ lại"}
              </button>
            </div>
          )}

          <div className="moment-overlay-enter absolute inset-0 z-30">
            <OverlayRenderer
              overlayData={overlayData}
              momentId={moment?.id}
              pollCounts={pollCounts}
              pollVariant={isOwnMoment ? "owner" : "friend"}
            />
          </div>
        </div>

        <MomentOwnerInfo
          user={moment?.user}
          date={moment?.createTime ?? moment?.date}
          groupId={moment?.group_id}
        />
      </div>
    </div>
  );
};

export default MomentViewer;
