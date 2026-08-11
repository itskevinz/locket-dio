import { Swiper, SwiperSlide } from "swiper/react";
import { EffectCards } from "swiper/modules";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import "swiper/css";
import "swiper/css/effect-cards";
import { Loader2, SmilePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRollcallMediaObjectUrl } from "@/services";
import {
  getRollcallMainCandidates,
  getRollcallThumbnailCandidates,
  isVideoMedia,
  isSignedUrlExpired,
  shouldLoadMediaIndex,
  preloadRollcallNeighbors,
  mediaIdOf,
  logRollcallNet,
} from "@/utils/rollcallMedia";

const LOAD_TIMEOUT_MS = 9000;
const MAX_RETRIES = 2;

function RollcallImages({ items, onActiveChange }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const total = items?.length || 0;

  // Progressive preload: current + next + prev only
  useEffect(() => {
    if (!items?.length) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await preloadRollcallNeighbors(items, activeIndex, { concurrency: 2 });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeIndex, items]);

  // Notify parent of initial active item once
  useEffect(() => {
    if (items?.[0]) onActiveChange?.(items[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount / items identity only
  }, [items]);

  if (!total) return null;

  return (
    <div className="w-full max-w-sm mx-auto overflow-hidden">
      <Swiper
        effect="cards"
        grabCursor
        modules={[EffectCards]}
        className="w-78 sm:w-78 aspect-[3/4]"
        cardsEffect={{
          rotate: true,
          perSlideOffset: 10,
          perSlideRotate: 1,
          slideShadows: false,
        }}
        onSlideChange={(swiper) => {
          const idx = swiper.activeIndex;
          setActiveIndex(idx);
          onActiveChange?.(items[idx]);
        }}
      >
        {items.map((item, index) => {
          const isActive = index === activeIndex;
          const load = shouldLoadMediaIndex(index, activeIndex);
          const priority =
            index === activeIndex
              ? "active"
              : load
                ? "neighbor"
                : "idle";

          return (
            <SwiperSlide key={item.uid || item.id || index}>
              <div className="relative w-full h-full overflow-hidden rounded-lg">
                <RollcallMedia
                  item={item}
                  index={index}
                  load={load}
                  priority={priority}
                  isActive={isActive}
                />

                {/* COUNTER – chỉ slide active */}
                {isActive && (
                  <div className="absolute z-[2] font-semibold top-2 right-2 bg-base-300/80 backdrop-blur px-3 py-1 rounded-full text-sm">
                    {activeIndex + 1}/{total}
                  </div>
                )}

                {/* OPEN REACTION MODAL */}
                {isActive && (
                  <ReactionButton onClick={() => console.log("open modal")} />
                )}

                {/* LIST EMOJI REACTIONS */}
                {isActive && <ReactionList reactions={item.reactions} />}
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
}

export default RollcallImages;

function ReactionButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="
        absolute z-[2] bottom-2 right-2
        bg-base-100/80 backdrop-blur
        p-2 rounded-full
      "
    >
      <SmilePlus className="w-6 h-6" />
    </button>
  );
}

function ReactionList({ reactions = [] }) {
  if (!reactions.length) return null;

  return (
    <div className="absolute z-[2] bottom-4 left-4 flex">
      {reactions.map((r) => (
        <span
          key={r.uid}
          style={{
            transform: `
              translate(${r.x * 10}px, ${r.y * 10}px)
              rotate(${r.rotation}rad)
              scale(${r.scale})
            `,
          }}
          className="text-2xl select-none"
        >
          {r.reaction}
        </span>
      ))}
    </div>
  );
}

/**
 * Loads media only when `load` is true (active ± 1).
 * Images try direct URLs and an authenticated server blob in parallel.
 */
const RollcallMedia = memo(function RollcallMedia({
  item,
  index,
  load,
  priority,
  isActive,
}) {
  const { t } = useTranslation("main");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [retryKey, setRetryKey] = useState(0);
  const [authenticatedUrl, setAuthenticatedUrl] = useState("");
  const [authenticatedState, setAuthenticatedState] = useState("idle");
  const loadStarted = useRef(0);
  const authenticatedAbortRef = useRef(null);
  const authenticatedUrlRef = useRef("");
  const id = mediaIdOf(item, index);
  const video = isVideoMedia(item);

  const replaceAuthenticatedUrl = useCallback((nextUrl) => {
    if (authenticatedUrlRef.current) {
      URL.revokeObjectURL(authenticatedUrlRef.current);
    }
    authenticatedUrlRef.current = nextUrl || "";
    setAuthenticatedUrl(nextUrl || "");
  }, []);

  useEffect(
    () => () => {
      authenticatedAbortRef.current?.abort();
      if (authenticatedUrlRef.current) {
        URL.revokeObjectURL(authenticatedUrlRef.current);
        authenticatedUrlRef.current = "";
      }
    },
    [],
  );

  const mainCandidates = useMemo(
    () =>
      getRollcallMainCandidates(item, {
        // Existing media proxy is image-safe. Keep videos direct until range proxy exists.
        includeProxy: !video,
      }),
    [item, video],
  );

  const thumbnailCandidates = useMemo(
    () => getRollcallThumbnailCandidates(item, { includeProxy: !video }),
    [item, video],
  );

  const mediaCandidates = useMemo(() => {
    const candidates = video
      ? mainCandidates
      : [...mainCandidates, ...thumbnailCandidates];
    return candidates.filter(
      (url, position) => url && candidates.indexOf(url) === position,
    );
  }, [mainCandidates, thumbnailCandidates, video]);

  const authenticatedCandidates = useMemo(() => {
    const candidates = [
      ...getRollcallMainCandidates(item, { includeProxy: false }),
      ...(video
        ? []
        : getRollcallThumbnailCandidates(item, { includeProxy: false })),
    ];
    return candidates.filter(
      (url, position) =>
        /^https:\/\//i.test(url) && candidates.indexOf(url) === position,
    );
  }, [item, video]);

  const candidateSignature = mediaCandidates.join("|");
  const authenticatedSignature = authenticatedCandidates.join("|");
  const currentUrl = mediaCandidates[candidateIndex] || "";
  const displayUrl = authenticatedUrl || currentUrl;
  const posterUrl = thumbnailCandidates[0] || undefined;
  const expired = isSignedUrlExpired(
    item?.main_url || item?.mainUrl || mainCandidates[0] || "",
  );

  // Reset visual state when item URLs / retry / load window changes
  useEffect(() => {
    authenticatedAbortRef.current?.abort();
    replaceAuthenticatedUrl("");
    setAuthenticatedState("idle");

    if (!load) {
      setLoaded(false);
      setFailed(false);
      setTimedOut(false);
      setCandidateIndex(0);
      return;
    }
    setLoaded(false);
    setFailed(false);
    setTimedOut(false);
    setCandidateIndex(0);
    loadStarted.current = performance.now();
  }, [
    load,
    candidateSignature,
    authenticatedSignature,
    retryKey,
    replaceAuthenticatedUrl,
  ]);

  // Authenticated backend fallback for images/videos. Runs in parallel with direct media.
  useEffect(() => {
    if (!load || !authenticatedCandidates.length || loaded) return;

    const controller = new AbortController();
    authenticatedAbortRef.current = controller;
    let disposed = false;
    setAuthenticatedState("loading");

    (async () => {
      for (let i = 0; i < authenticatedCandidates.length; i += 1) {
        try {
          const objectUrl = await getRollcallMediaObjectUrl(
            authenticatedCandidates[i],
            { signal: controller.signal },
          );

          if (disposed || controller.signal.aborted) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          setLoaded(false);
          setFailed(false);
          setTimedOut(false);
          loadStarted.current = performance.now();
          replaceAuthenticatedUrl(objectUrl);
          setAuthenticatedState("success");
          logRollcallNet({
            type: "image_authenticated_proxy",
            status: 200,
            mediaKind: "image",
            index,
            candidate: i,
          });
          return;
        } catch (error) {
          if (
            disposed ||
            controller.signal.aborted ||
            error?.name === "CanceledError" ||
            error?.code === "ERR_CANCELED"
          ) {
            return;
          }

          logRollcallNet({
            type: "image_authenticated_proxy_error",
            status: error?.response?.status || "error",
            mediaKind: "image",
            index,
            candidate: i,
          });
        }
      }

      if (!disposed && !controller.signal.aborted) {
        setAuthenticatedState("error");
      }
    })();

    return () => {
      disposed = true;
      controller.abort();
    };
  }, [
    load,
    video,
    authenticatedSignature,
    retryKey,
    loaded,
    authenticatedCandidates,
    index,
    replaceAuthenticatedUrl,
  ]);

  // If direct URLs are exhausted and authenticated fetch also failed, show failure.
  useEffect(() => {
    if (
      load &&
      !loaded &&
      authenticatedState === "error" &&
      candidateIndex >= mediaCandidates.length - 1
    ) {
      setFailed(true);
      setTimedOut(true);
    }
  }, [
    load,
    loaded,
    authenticatedState,
    candidateIndex,
    mediaCandidates.length,
  ]);

  // 8–10s timeout → move to next direct candidate before showing failure
  useEffect(() => {
    if (!load || loaded || failed || !currentUrl || authenticatedUrl) return;
    const timer = setTimeout(() => {
      if (candidateIndex < mediaCandidates.length - 1) {
        setCandidateIndex((value) => value + 1);
        setTimedOut(false);
        loadStarted.current = performance.now();
        logRollcallNet({
          type: "media_timeout_fallback",
          status: "next_candidate",
          ms: LOAD_TIMEOUT_MS,
          mediaKind: video ? "video" : "image",
          index,
          candidate: candidateIndex + 1,
        });
        return;
      }

      // Wait for authenticated image request before declaring final failure.
      if (authenticatedState === "loading") return;

      setTimedOut(true);
      logRollcallNet({
        type: video ? "video_timeout" : "image_timeout",
        status: "timeout",
        ms: LOAD_TIMEOUT_MS,
        mediaKind: video ? "video" : "image",
        index,
        candidate: candidateIndex,
      });
    }, LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [
    load,
    loaded,
    failed,
    retryKey,
    video,
    index,
    currentUrl,
    authenticatedUrl,
    authenticatedState,
    candidateIndex,
    mediaCandidates.length,
  ]);

  const handleLoaded = useCallback(() => {
    setLoaded(true);
    setTimedOut(false);
    setFailed(false);

    // Direct URL worked: stop the extra authenticated request.
    if (!authenticatedUrl && authenticatedState === "loading") {
      authenticatedAbortRef.current?.abort();
      setAuthenticatedState("idle");
    }

    logRollcallNet({
      type: video ? "video_ready" : "image_load",
      status: 200,
      ms: Math.round(
        performance.now() - (loadStarted.current || performance.now()),
      ),
      mediaKind: video ? "video" : "image",
      index,
      candidate: authenticatedUrl ? "authenticated" : candidateIndex,
    });
  }, [
    video,
    index,
    candidateIndex,
    authenticatedUrl,
    authenticatedState,
  ]);

  const handleError = useCallback(() => {
    // Authenticated blob itself failed to decode: fall back to direct candidates.
    if (authenticatedUrl) {
      replaceAuthenticatedUrl("");
      setAuthenticatedState("error");
      setLoaded(false);
      setFailed(false);
      setTimedOut(false);
      return;
    }

    if (candidateIndex < mediaCandidates.length - 1) {
      setCandidateIndex((value) => value + 1);
      setLoaded(false);
      setFailed(false);
      setTimedOut(false);
      loadStarted.current = performance.now();
      logRollcallNet({
        type: "media_fallback",
        status: "next_candidate",
        ms: Math.round(
          performance.now() - (loadStarted.current || performance.now()),
        ),
        mediaKind: video ? "video" : "image",
        index,
        candidate: candidateIndex + 1,
      });
      return;
    }

    // Image backend is still trying; do not show a false failure yet.
    if (authenticatedState === "loading") {
      setFailed(false);
      setTimedOut(false);
      return;
    }

    setFailed(true);
    setTimedOut(true);
    logRollcallNet({
      type: video ? "video_error" : "image_error",
      status: "error",
      ms: Math.round(
        performance.now() - (loadStarted.current || performance.now()),
      ),
      mediaKind: video ? "video" : "image",
      index,
      candidate: candidateIndex,
    });
  }, [
    video,
    index,
    authenticatedUrl,
    authenticatedState,
    candidateIndex,
    mediaCandidates.length,
    replaceAuthenticatedUrl,
  ]);

  const handleRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) return;
    const next = retryCount + 1;
    setRetryCount(next);
    setFailed(false);
    setTimedOut(false);
    setLoaded(false);
    setCandidateIndex(0);
    authenticatedAbortRef.current?.abort();
    replaceAuthenticatedUrl("");
    setAuthenticatedState("idle");
    const delay = next === 1 ? 400 : 1200;
    logRollcallNet({
      type: "media_retry",
      status: next,
      ms: delay,
      mediaKind: video ? "video" : "image",
      index,
    });
    setTimeout(() => setRetryKey((key) => key + 1), delay);
  }, [retryCount, video, index, replaceAuthenticatedUrl]);

  useEffect(() => {
    if (!load || !expired) return;
    logRollcallNet({
      type: "signed_url_expired",
      status: "expired",
      mediaKind: video ? "video" : "image",
      index,
    });
  }, [load, expired, video, index]);

  // Placeholder when not in load window — same frame, no network
  if (!load) {
    return <div className="relative w-full h-full bg-base-300" />;
  }

  if (!displayUrl && authenticatedState !== "loading") {
    return (
      <div className="relative w-full h-full bg-base-300 flex flex-col items-center justify-center gap-2">
        <span className="text-sm opacity-70">
          {t("left.image_load_failed", {
            defaultValue: "Không tìm thấy đường dẫn media",
          })}
        </span>
      </div>
    );
  }

  const showOverlay = !loaded || timedOut || failed;

  return (
    <div className="relative w-full h-full">
      {showOverlay && (
        <div className="absolute inset-0 bg-base-300 flex flex-col items-center justify-center gap-2 z-[1]">
          {!failed && !timedOut && (
            <>
              <Loader2 className="w-6 h-6 animate-spin opacity-70" />
              <span className="text-sm opacity-70">
                {t("left.image_loading")}
              </span>
            </>
          )}
          {(timedOut || failed) && (
            <>
              <span className="text-sm opacity-70">
                {t("left.image_load_failed", {
                  defaultValue: "Tải media thất bại",
                })}
              </span>
              {retryCount < MAX_RETRIES && (
                <button
                  type="button"
                  onClick={handleRetry}
                  className="text-sm text-blue-500 px-3 py-1 bg-blue-500/10 hover:bg-blue-500/20 rounded-lg font-medium transition-colors"
                >
                  {t("left.retry", { defaultValue: "Thử lại" })}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {video && displayUrl ? (
        <video
          key={`${id}-v-${retryKey}-${candidateIndex}`}
          src={displayUrl}
          poster={posterUrl}
          preload={isActive ? "metadata" : "none"}
          playsInline
          controls={isActive}
          autoPlay={false}
          onLoadedData={handleLoaded}
          onLoadedMetadata={handleLoaded}
          onError={handleError}
          className={`
            w-full h-full object-cover
            transition-opacity duration-300
            ${loaded ? "opacity-100" : "opacity-0"}
          `}
        />
      ) : displayUrl ? (
        <img
          key={`${id}-i-${retryKey}-${authenticatedUrl ? "auth" : candidateIndex}`}
          src={displayUrl}
          alt=""
          loading={priority === "active" ? "eager" : "lazy"}
          fetchPriority={priority === "active" ? "high" : "low"}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={handleLoaded}
          onError={handleError}
          className={`
            w-full h-full object-cover
            transition-opacity duration-300
            ${loaded ? "opacity-100" : "opacity-0"}
          `}
          draggable={false}
        />
      ) : null}
    </div>
  );
});
