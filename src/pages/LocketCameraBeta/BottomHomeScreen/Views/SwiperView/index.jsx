import { useCallback, useEffect, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Virtual } from "swiper/modules";
import "swiper/css";
import "./swipePerformance.css";

import { useMomentsStoreV2, useSelectedStore } from "@/stores";
import QueueViewer from "./QueueViewer";
import MomentViewer from "./MomentViewer";

// Only the current post and its immediate neighbours need the full viewer.
// Keeping every MomentViewer mounted makes Android decode media, subscribe to
// stores and build overlays for posts that are nowhere near the viewport.
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

  const setSwipePerformanceMode = useCallback((active) => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (active) root.dataset.locketSwiping = "true";
    else delete root.dataset.locketSwiping;
  }, []);

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

    if (newIndex !== selectedMoment) {
      setSelectedMoment(newIndex);
      swiperRef.slideTo(newIndex, 0);
    }
  }, [moments, selectedMomentId, swiperRef, selectedMoment, setSelectedMoment]);

  const handleClose = useCallback(() => {
    setSwipePerformanceMode(false);
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
        onSwiper={setSwiperRef}
        slidesPerView={1}
        initialSlide={selectedMoment}
        // Explicitly keep Swiper's own virtual window tight as well. The
        // adjacent slides stay ready so the finger never swipes into a blank.
        virtual={{ addSlidesBefore: 1, addSlidesAfter: 1 }}
        speed={300}
        threshold={5}
        resistanceRatio={0.72}
        onTouchStart={() => setSwipePerformanceMode(true)}
        onSliderFirstMove={() => setSwipePerformanceMode(true)}
        onTransitionStart={() => setSwipePerformanceMode(true)}
        onTouchEnd={(swiper) => {
          // Touch can end before momentum/transition finishes. Keep the cheap
          // paint mode until Swiper reports that animation has actually ended.
          if (!swiper?.animating) setSwipePerformanceMode(false);
        }}
        onTransitionEnd={() => setSwipePerformanceMode(false)}
        onSlideChange={(swiper) => {
          const newIndex = swiper.activeIndex;

          if (newIndex === selectedMoment) return;
          if (newIndex < 0 || newIndex >= moments.length) return;

          setSelectedMoment(newIndex);
          setSelectedMomentId(moments[newIndex]?.id);
        }}
      >
        {moments.map((slideContent, index) => {
          const distance = Math.abs(index - selectedMoment);
          const shouldHydrateViewer = distance <= VIEWER_RADIUS;
          const isActive = index === selectedMoment;

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
