import { useEffect, useState, useRef } from "react";
import { ImageOff } from "lucide-react";
import { MdSlowMotionVideo } from "react-icons/md";
import ScrollReveal from "@/components/Effects/ScrollReveal";
import { useSelectedStore } from "@/stores";

/**
 * Lưới khoảnh khắc — KHÔNG nút Làm mới.
 * Tự cập nhật qua socket + poll (BottomHomeScreen).
 */
const MomentsGallery = ({
  visibleCount,
  increaseVisibleCount,
  moments,
  loadMoreOlder,
  hasMore,
  loading,
  isLoadingMore,
}) => {
  const setSelectedMoment = useSelectedStore((s) => s.setSelectedMoment);
  const setSelectedMomentId = useSelectedStore((s) => s.setSelectedMomentId);
  const selectedFriendUid = useSelectedStore((s) => s.selectedFriendUid);

  const [loadedItems, setLoadedItems] = useState([]);
  const [failedItems, setFailedItems] = useState([]);
  const lastElementRef = useRef(null);
  const observerRef = useRef(null);

  const visibleMoments = moments.slice(0, visibleCount);

  // Infinite scroll — tự load thêm khi chạm cuối
  useEffect(() => {
    if (!lastElementRef.current) return;

    observerRef.current?.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;

        if (visibleCount < moments.length) {
          increaseVisibleCount();
          return;
        }

        if (loadMoreOlder && hasMore && !isLoadingMore) {
          loadMoreOlder(selectedFriendUid);
        }
      },
      {
        rootMargin: "300px",
        threshold: 0.1,
      },
    );

    observerRef.current.observe(lastElementRef.current);

    return () => observerRef.current?.disconnect();
  }, [
    visibleCount,
    moments.length,
    hasMore,
    isLoadingMore,
    loadMoreOlder,
    selectedFriendUid,
    increaseVisibleCount,
  ]);

  const handleLoaded = (id) => {
    setLoadedItems((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const handleFailed = (id) => {
    setFailedItems((prev) => (prev.includes(id) ? prev : [...prev, id]));
    handleLoaded(id);
  };

  if (moments.length === 0) {
    // Loading skeleton im lặng — không chữ "Đang tải"
    if (loading) {
      return (
        <div
          data-ios-history-grid="true"
          className="grid gap-1 grid-cols-3 md:grid-cols-6 md:gap-2 w-full"
        >
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={`empty-sk-${idx}`}
              className="aspect-square rounded-2xl skeleton"
            />
          ))}
        </div>
      );
    }
    return (
      <div
        data-ios-history-grid="true"
        className="grid grid-cols-3 md:grid-cols-6 md:gap-2 w-full h-full"
      >
        <div className="aspect-square bg-base-300/40 rounded-2xl border border-dashed border-base-content/15" />
      </div>
    );
  }

  return (
    <div
      data-ios-history-grid="true"
      className="grid gap-1 grid-cols-3 md:grid-cols-6 md:gap-2"
    >
      {visibleMoments.map((item, index) => {
        const isLoaded = loadedItems.includes(item.id);
        const isFailed = failedItems.includes(item.id);
        const isLastItem = index === visibleMoments.length - 1;
        // Ba hàng đầu đang nằm ngay trong viewport điện thoại: tải ưu tiên,
        // tránh Chrome Android trì hoãn ảnh do toàn bộ lưới đều `lazy`.
        const shouldPrioritize = index < 9;

        return (
          <ScrollReveal
            key={item.id}
            delay={(index % 6) * 0.05}
            amount={0.1}
          >
            <div
              ref={isLastItem ? lastElementRef : null}
              data-ios-history-tile="true"
              onClick={() => {
                setSelectedMoment(index);
                setSelectedMomentId(item.id);
              }}
              className="aspect-square overflow-hidden cursor-pointer rounded-2xl relative group w-full h-full bg-base-300/30"
            >
              {!isLoaded && (
                <div className="absolute inset-0 skeleton w-full h-full rounded-2xl z-10" />
              )}

              {isFailed && (
                <div
                  data-ios-history-media-error="true"
                  className="absolute inset-0 z-20 flex items-center justify-center bg-base-300/70"
                >
                  <ImageOff className="h-6 w-6 opacity-65" strokeWidth={1.8} />
                </div>
              )}

              <img
                src={item.thumbnail_url || item.image_url || item.thumbnailUrl}
                alt=""
                className={`object-cover w-full h-full rounded-2xl transition-opacity duration-300 ${
                  isLoaded && !isFailed ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => handleLoaded(item.id)}
                onError={() => handleFailed(item.id)}
                loading={shouldPrioritize ? "eager" : "lazy"}
                fetchPriority={shouldPrioritize ? "high" : "auto"}
                decoding="async"
              />

              {(item.video_url || item.videoUrl) && (
                <div className="absolute top-2 right-2 bg-primary/30 rounded-full z-20 p-0.5">
                  <MdSlowMotionVideo className="text-white" />
                </div>
              )}
            </div>
          </ScrollReveal>
        );
      })}

      {loading &&
        Array.from({ length: 3 }).map((_, idx) => (
          <ScrollReveal key={`skeleton-${idx}`} delay={idx * 0.1}>
            <div className="aspect-square overflow-hidden rounded-2xl relative">
              <div className="absolute inset-0 skeleton w-full h-full rounded-2xl" />
            </div>
          </ScrollReveal>
        ))}
    </div>
  );
};

export default MomentsGallery;
