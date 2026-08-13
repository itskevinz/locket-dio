import { useEffect, useRef } from "react";
import { useAppNavigation } from "@/context/AppContext";
import { useSocket } from "@/context/SocketContext";
import { useAuthStore, useMomentsStoreV2, useSelectedStore } from "@/stores";

import SwiperView from "./Views/SwiperView";
import GridMoments from "./Views/GridMoments";

/** Tự làm mới — Android poll thưa hơn (tiết kiệm CPU/pin) */
const isAndroidUA =
  typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent || "");
const POLL_OFFLINE_MS = isAndroidUA ? 25_000 : 12_000;
const POLL_ONLINE_MS = isAndroidUA ? 45_000 : 25_000;

const BottomHomeScreen = () => {
  const {
    isBottomOpen,
  } = useAppNavigation();

  const selectedMoment = useSelectedStore((s) => s.selectedMoment);
  const selectedQueue = useSelectedStore((s) => s.selectedQueue);
  const selectedFriendUid = useSelectedStore((s) => s.selectedFriendUid);

  const { user } = useAuthStore();
  const { socket, isConnected } = useSocket();

  const fetchMoments = useMomentsStoreV2((s) => s.fetchMoments);
  const addNewMoment = useMomentsStoreV2((s) => s.addNewMoment);
  const syncMomentsSnapshot = useMomentsStoreV2((s) => s.syncMomentsSnapshot);
  const pullLatestMoments = useMomentsStoreV2((s) => s.pullLatestMoments);
  const resetVisible = useMomentsStoreV2((s) => s.resetVisible);

  const friendRef = useRef(selectedFriendUid);
  friendRef.current = selectedFriendUid;

  // Changing side panels must not collapse the active history grid. Only a
  // real account/friend filter change starts that bucket from its first page.
  useEffect(() => {
    resetVisible(selectedFriendUid);
  }, [selectedFriendUid, resetVisible]);

  // Initial load + when filter friend changes
  useEffect(() => {
    fetchMoments(user, selectedFriendUid);
  }, [user, selectedFriendUid, fetchMoments]);

  // Auto-refresh when user opens history panel
  useEffect(() => {
    if (!isBottomOpen || !user) return;
    pullLatestMoments(selectedFriendUid);
  }, [isBottomOpen, user, selectedFriendUid, pullLatestMoments]);

  // Realtime socket: new posts from friends / self
  useEffect(() => {
    if (!socket || !user) return;

    const idToken = localStorage.getItem("idToken");
    if (!idToken) return;

    const handleMoments = (data) => {
      if (!data) return;

      // Always merge — never wipe feed with a partial "snapshot"
      if (Array.isArray(data)) {
        if (data.length === 0) return;
        if (data.length === 1) {
          addNewMoment(data[0]);
          return;
        }
        syncMomentsSnapshot(data);
        return;
      }

      addNewMoment(data);
    };

    const subscribe = () => {
      socket.emit("on_moments", {
        timestamp: null,
        token: idToken,
        friendId: null,
        limit: 20,
      });
    };

    socket.on("new_on_moments", handleMoments);

    if (socket.connected) {
      subscribe();
    }
    socket.on("connect", subscribe);

    return () => {
      socket.off("new_on_moments", handleMoments);
      socket.off("connect", subscribe);
    };
  }, [socket, user, addNewMoment, syncMomentsSnapshot]);

  // Poll backup — chỉ khi đang mở panel lịch sử (tránh giật camera)
  useEffect(() => {
    if (!user || !isBottomOpen) return;

    const pull = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      pullLatestMoments(friendRef.current);
    };

    const onVisible = () => {
      if (!document.hidden && isBottomOpen) pull();
    };

    document.addEventListener("visibilitychange", onVisible);

    const intervalMs = isConnected ? POLL_ONLINE_MS : POLL_OFFLINE_MS;
    const timer = window.setInterval(pull, intervalMs);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [user, isConnected, isBottomOpen, pullLatestMoments]);

  const selectedAnimate =
    (selectedMoment !== null && selectedQueue === null) ||
    (selectedMoment === null && selectedQueue !== null);

  return (
    <>
      <SwiperView />
      <GridMoments selectedAnimate={selectedAnimate} />
    </>
  );
};

export default BottomHomeScreen;
