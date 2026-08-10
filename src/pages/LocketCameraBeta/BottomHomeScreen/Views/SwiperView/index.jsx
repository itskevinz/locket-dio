import { useCallback, useEffect, useRef, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Virtual } from "swiper/modules";
import "swiper/css";
import "./swipePerformance.css";

import { useMomentsStoreV2, useSelectedStore } from "@/stores";
import QueueViewer from "./QueueViewer";
import MomentViewer from "./MomentViewer";

// The current post and its immediate neighbours stay hydrated. Crucially, the
// hydration window only moves AFTER Swiper finishes translating; mounting a new
// MomentViewer while the finger/transition is moving was a major Android hitch.
const VIEWER_RADIUS = 1;

const SwiperView = () => {
  const [swiperRef, setSwiperRef] = useState(null);

  const selectedMoment = useSelectedStore((s) => s.selectedMoment);
  const setSelectedMoment = useSelectedStore((s) => s.setSelectedMoment);

  const selectedQueue = useSelectedStore((s) => s.selectedQueue);

  const selectedMomentId = useSelectedStore((s) => s.selectedMomentId);
  const setSelectedMomentId = useSelectedStore((s) => s.setSelectedMomentId);

  const selectedFriendUid = useSelectedStore((s) => s.selectedFriendUid);

  const selectedKey = selectedFriendUid ?? "all";
  const bucket = useMomentsStoreV2((s) => s.momentsByUser[selectedKey]);
  const moments = bucket?.moments ?? [];

  const momentActive = typeof selectedMoment === "number";
  const queueActive = typeof selectedQueue === "number";
  const [renderIndex, setRenderIndex] = useState(() =>
    typeof selectedMoment === "number" ? selectedMoment : 0,
  );
  const pendingIndexRef = useRef(null);

  const setSwipePerformanceMode = useCallback((active) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (active) root.dataset.locketSwiping = "true";
    else delete root.dataset.locketSwiping;
  }, []);

  // Keep the expensive-detail paint policy stable for the entire viewer
  // lifetime. Previously blur/shadow toggled on every finger-down/up, which
  // itself produced a bright flash on some Android GPUs.
  useEffect(() => {
    if (typeof document === "undefined" || !momentActive) return undefined;
    document.documentElement.dataset.locketDetail = "true";
    return () => {
      delete document.documentElement.dataset.locketDetail;
      delete document.documentElement.dataset.locketSwiping;
    };
  }, [momentActive]);

  useEffect(
    () => () => {
      setSwipePerformanceMode(false);
    },
    [setSwipePerformanceMode],
  );

  useEffect(() => {
    if (!swiperRef || selectedMomentId == null) return;

    const newIndex = moments.findIndex((m) => m.id === selectedMomentId);
    if (newIndex === -1) return;

    // External/programmatic selection can still jump immediately. Normal finger
    // swipes do not update selectedMomentId until transition-end below.
    if (newIndex !== swiperRef.activeIndex) {
      pendingIndexRef.current = null;
      setRenderIndex(newIndex);
      if (newIndex !== selectedMoment) setSelectedMoment(newIndex);
      swiperRef.slideTo(newIndex, 0);
    }
  }, [
    moments,
    selectedMomentId,
    swiperRef,
    selectedMoment,
    setSelectedMoment,
  ]);

  const commitSettledIndex = useCallback(
    (swiper) => {
      const candidate = Number.isInteger(pendingIndexRef.current)
        ? pendingIndexRef.current
        : swiper?.activeIndex;
      pendingIndexRef.current = null;

      if (!Number.isInteger(candidate)) return;
      if (candidate < 0 || candidate >= moments.length) return;

      // This is intentionally after the transform finishes: React may now mount
      // the next neighbour, update stores and start the active video decoder
      // without competing with the 60fps gesture.
      setRenderIndex(candidate);
      if (candidate !== selectedMoment) setSelectedMoment(candidate);

      const nextId = moments[candidate]?.id;
      if (nextId != null && nextId !== selectedMomentId) {
        setSelectedMomentId(nextId);
      }
    },
    [
      moments,
      selectedMoment,
      selectedMomentId,
      setSelectedMoment,
      setSelectedMomentId,
    ],
  );

  const handleClose = useCallback(() => {
    pendingIndexRef.current = null;
    setSwipePerformanceMode(false);
    if (typeof document !== "undefined") {
      delete document.documentElement.dataset.locketDetail;
    }
    setSelectedMoment(null);
    setSelectedMomentId(null);
  }, [setSelectedMoment, setSelectedMomentId, setSwipePerformanceMode]);

  if (!momentActive && !queueActive) return null;

  if (queueActive) return <QueueViewer />;

  return (
    <div
      data-ios-detail-view="true"
      className="fixed inset-0 z-50 flex h-full w-full flex-col items-center justify-center"
    >
      <Swiper
        direction="vertical"
        className="flex h-full w-full max-w-md flex-col items-center justify-center aspect-square"
        modules={[Virtual]}
        onSwiper={(swiper) => {
          setSwiperRef(swiper);
          setRenderIndex(swiper.activeIndex);
        }}
        slidesPerView={1}
        initialSlide={selectedMoment}
        virtual={{ addSlidesBefore: 1, addSlidesAfter: 1 }}
        speed={280}
        threshold={6}
        resistanceRatio={0.72}
        onTouchStart={() => setSwipePerformanceMode(true)}
        onSliderFirstMove={() => setSwipePerformanceMode(true)}
        onTransitionStart={() => setSwipePerformanceMode(true)}
        onSlideChange={(swiper) => {
          const nextIndex = swiper.activeIndex;
          if (nextIndex < 0 || nextIndex >= moments.length) return;
          // Do NOT set React/Zustand state here. onSlideChange fires while the
          // slide is still moving and that was causing frame drops + white flash.
          pendingIndexRef.current = nextIndex;
        }}
        onTouchEnd={(swiper) => {
          if (!swiper?.animating) {
            setSwipePerformanceMode(false);
            commitSettledIndex(swiper);
          }
        }}
        onTransitionEnd={(swiper) => {
          setSwipePerformanceMode(false);
          commitSettledIndex(swiper);
        }}
      >
        {moments.map((slideContent, index) => {
          const distance = Math.abs(index - renderIndex);
          const shouldHydrateViewer = distance <= VIEWER_RADIUS;
          const isActive = index === renderIndex;

          return (
            <SwiperSlide
              key={slideContent.id}
              virtualIndex={index}
              className="flex h-full items-center justify-center"
            >
              <div className="flex h-full w-full items-center justify-center pb-26">
                {shouldHydrateViewer ? (
                  <MomentViewer
                    moment={slideContent}
                    handleClose={handleClose}
                    isActive={isActive}
                  />
                ) : (
                  <div className="h-full w-full" aria-hidden="true" />
                )}
              </div>
            </SwiperSlide>
          );
        })}
      </Swiper>
    </div>
  );
};

export default SwiperView;
