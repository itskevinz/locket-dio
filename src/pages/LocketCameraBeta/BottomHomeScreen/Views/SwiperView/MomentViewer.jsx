import { ImageOff, RefreshCw, X } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { OverlayRenderer } from "@/components/Overlay";
import { GetAllMoments } from "@/services";
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
const TARGETED_MEDIA_REFRESH_LIMIT = 60;

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

function toTimestampSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value > 1e12 ? value / 1000 : value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
  }

  if (value && typeof value === "object") {
    if (typeof value._seconds === "number") return Math.floor(value._seconds);
    if (typeof value.seconds === "number") return Math.floor(value.seconds);
  }

  return 0;
}

function getMomentTimestampSeconds(moment) {
  return (
    toTimestampSeconds(moment?.date) ||
    toTimestampSeconds(moment?.createTime) ||
    0
  );
}

function getAlternateStorageHostUrl(value) {
  if (!isUsableMediaUrl(value)) return null;

  if (value.includes("https://cdn.locketcamera.com")) {
    return value.replace(
      "https://cdn.locketcamera.com",
      "https://firebasestorage.googleapis.com",
    );
  }

  if (value.includes("https://firebasestorage.googleapis.com")) {
    return value.replace(
      "https://firebasestorage.googleapis.com",
      "https://cdn.locketcamera.com",
    );
  }

  return null;
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

const MomentViewer = ({ moment, handleClose, isActive = true }) => {
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [isImageReady, setIsImageReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [imageSrcOverride, setImageSrcOverride] = useState(null);
  const [videoSrcOverride, setVideoSrcOverride] = useState(null);
  const stableOverlayRef = useRef({ momentId: null, data: null });
  const repairedGhostRef = useRef(null);
  const attemptedImageUrlsRef = useRef(new Set());
  const attemptedVideoUrlsRef = useRef(new Set());
  const videoRef = useRef(null);

  const { user } = useAuthStore();
  const myUid = resolveMyUid(user);
  const ownerUid = resolveMomentOwnerUid(moment);
  const isOwnMoment = Boolean(myUid && ownerUid && myUid === ownerUid);

  const pullLatestMoments = useMomentsStoreV2((s) => s.pullLatestMoments);
  const addNewMoment = useMomentsStoreV2((s) => s.addNewMoment);
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

  const imageSrc = imageSrcOverride || thumbnailUrl;
  const videoSrc = videoSrcOverride || videoUrl;

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
    setImageSrcOverride(null);
    setVideoSrcOverride(null);
    attemptedImageUrlsRef.current = new Set(
      thumbnailUrl ? [thumbnailUrl] : [],
    );
    attemptedVideoUrlsRef.current = new Set(videoUrl ? [videoUrl] : []);
  }, [momentId, thumbnailUrl, videoUrl]);

  // A video decoder is one of the most expensive things on this screen. Keep
  // only the active slide's decoder alive; neighbours keep their image poster
  // so finger-following remains instant without hidden videos playing behind it.
  useEffect(() => {
    const video = videoRef.current;
    if (!isActive) {
      setIsVideoReady(false);
      try {
        video?.pause();
      } catch {
        /* best effort */
      }
      return;
    }

    if (video) {
      const playPromise = video.play?.();
      if (playPromise?.catch) playPromise.catch(() => {});
    }
  }, [isActive, videoSrc]);

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

  const handleImageError = () => {
    if (!imageSrc) {
      setImageFailed(true);
      return;
    }

    attemptedImageUrlsRef.current.add(imageSrc);
    const fallbackUrl = getAlternateStorageHostUrl(imageSrc);

    if (fallbackUrl && !attemptedImageUrlsRef.current.has(fallbackUrl)) {
      attemptedImageUrlsRef.current.add(fallbackUrl);
      setIsImageReady(false);
      setImageSrcOverride(fallbackUrl);
      return;
    }

    setImageFailed(true);
  };

  const handleVideoError = () => {
    if (!videoSrc) {
      setVideoFailed(true);
      return;
    }

    attemptedVideoUrlsRef.current.add(videoSrc);
    const fallbackUrl = getAlternateStorageHostUrl(videoSrc);

    if (fallbackUrl && !attemptedVideoUrlsRef.current.has(fallbackUrl)) {
      attemptedVideoUrlsRef.current.add(fallbackUrl);
      setIsVideoReady(false);
      setVideoSrcOverride(fallbackUrl);
      return;
    }

    setVideoFailed(true);
  };

  const refetchCurrentMoment = async () => {
    if (!momentId) return false;

    const targetTimestamp = getMomentTimestampSeconds(moment);
    if (!targetTimestamp) return false;

    const scopes = ownerUid ? [ownerUid, null] : [null];

    for (const friendId of scopes) {
      try {
        // Start just after the post time so Firestore's descending cursor includes
        // the target even when multiple moments share the same second.
        const apiData = await GetAllMoments({
          timestamp: targetTimestamp + 2,
          friendId,
          limit: TARGETED_MEDIA_REFRESH_LIMIT,
        });

        const freshMoment = apiData?.find(
          (item) =>
            item?.id === momentId || item?.canonical_uid === momentId,
        );

        if (freshMoment) {
          await addNewMoment(freshMoment);
          return true;
        }
      } catch (error) {
        console.warn("targeted moment media refresh failed:", error);
      }
    }

    return false;
  };

  const handleRefreshMedia = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setImageFailed(false);
    setVideoFailed(false);
    setIsImageReady(false);
    setIsVideoReady(false);
    setImageSrcOverride(null);
    setVideoSrcOverride(null);
    attemptedImageUrlsRef.current = new Set(
      thumbnailUrl ? [thumbnailUrl] : [],
    );
    attemptedVideoUrlsRef.current = new Set(videoUrl ? [videoUrl] : []);

    try {
      const refreshed = await refetchCurrentMoment();
      if (!refreshed) {
        // Keep the old behavior only as a last fallback for very recent posts.
        await pullLatestMoments(ownerUid || null);
      }
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
          {hasMediaUrl &&
            !isImageReady &&
            !(isActive && isVideoReady) &&
            !mediaUnavailable && (
              <div className="moment-skeleton absolute inset-0 w-full h-full skeleton rounded-[64px] z-0" />
            )}

          {imageSrc && !imageFailed && (
            <img
              src={imageSrc}
              alt={resolvedMoment?.caption || "Moment"}
              className={`moment-media-fade absolute inset-0 w-full h-full object-cover rounded-[64px] transition-opacity duration-300 z-10 ${
                isActive && isVideoReady ? "opacity-0" : "opacity-100"
              }`}
              onLoad={() => setIsImageReady(true)}
              onError={handleImageError}
              referrerPolicy="no-referrer"
              decoding="async"
            />
          )}

          {isActive && videoSrc && !videoFailed && (
            <video
              ref={videoRef}
              src={videoSrc}
              className={`moment-media-fade absolute inset-0 w-full h-full object-cover rounded-[64px] transition-opacity duration-300 z-20 ${
                isVideoReady ? "opacity-100" : "opacity-0"
              }`}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={imageSrc || undefined}
              onLoadedData={() => setIsVideoReady(true)}
              onCanPlay={() => setIsVideoReady(true)}
              onError={handleVideoError}
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

export default memo(MomentViewer);
