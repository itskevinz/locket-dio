import { useState, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
const EmojiPicker = lazy(() => import("@/features/EmojiStudio"));
import { SendMessageMoment, SendReactMoment } from "@/services";
import { getMomentById } from "@/cache/momentDB";
import {
  SonnerError,
  SonnerPromiseV2,
  SonnerSuccess,
} from "@/components/uikit/SonnerToast";
import { markMomentViewedOnce } from "@/cache/viewedMomentDB";
import {
  useAuthStore,
  useMomentsStoreV2,
  useMomentActivityStore,
  useSelectedStore,
  useUserSetting,
  resolveMyUid,
  resolveMomentOwnerUid,
  useReactionStore,
  useFriendStoreV3,
} from "@/stores";
import MomentActivity from "./MomentActivity";
import MomentReplyBar from "./MomentReplyBar";

const MomentInteraction = () => {
  const { t } = useTranslation("main");
  const { user } = useAuthStore();
  const myUid = resolveMyUid(user);

  const selectedMomentId = useSelectedStore((s) => s.selectedMomentId);
  const selectedFriendUid = useSelectedStore((s) => s.selectedFriendUid);

  const selectedKey = selectedFriendUid ?? "all";
  const moments =
    useMomentsStoreV2((s) => s.momentsByUser[selectedKey]?.moments) ?? [];

  const knownOwnerFromList = useMemo(() => {
    if (!selectedMomentId) return null;
    const m = moments.find((item) => item.id === selectedMomentId);
    return resolveMomentOwnerUid(m);
  }, [moments, selectedMomentId]);

  const syncForSelectedMoment = useMomentActivityStore(
    (s) => s.syncForSelectedMoment,
  );
  const fetchActivityForMoment = useMomentActivityStore(
    (s) => s.fetchActivityForMoment,
  );
  const clearActive = useMomentActivityStore((s) => s.clearActive);
  const activityEntry = useMomentActivityStore((s) =>
    selectedMomentId ? s.byMomentId[selectedMomentId] : null,
  );

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const [showFullInput, setShowFullInput] = useState(false);
  const [message, setMessage] = useState("");

  const HOLD_DELAY_MS = 1000;

  const holdStartRef = useRef(null);
  const holdTimeoutRef = useRef(null);

  const [holdingEmoji, setHoldingEmoji] = useState(null);
  const [intensity, setIntensity] = useState(0);

  const touchStartPosRef = useRef(null);
  const movedRef = useRef(false);
  const sendingRef = useRef(false);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  // thêm state

  const [isLoadingMomentMeta, setIsLoadingMomentMeta] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isSendingReaction, setIsSendingReaction] = useState(false);

  // ownerUid: từ store (sau sync) hoặc fallback từ list moments
  const ownerUid = activityEntry?.ownerUid ?? knownOwnerFromList;
  const isOwnMoment = Boolean(myUid && ownerUid && myUid === ownerUid);

  const friendMap = useFriendStoreV3((s) => s.friendDetailsMap);

  const userDetail = ownerUid ? (friendMap?.[ownerUid] ?? null) : null;

  // isPublic chỉ lấy từ store sau khi sync xong; undefined = chưa có dữ liệu
  // KHÔNG dùng fallback `?? true` vì sẽ hiển thị sai khi moment thực sự là private
  const isPublic = activityEntry?.isPublic;
  const activity = activityEntry?.activity ?? [];
  const pollCounts = activityEntry?.pollCounts ?? null;
  const isLoadingActivity = activityEntry?.loading ?? false;

  useEffect(() => {
    if (!selectedMomentId) {
      clearActive();
      return;
    }

    let cancelled = false;

    const run = async () => {
      setIsLoadingMomentMeta(true);

      try {
        await syncForSelectedMoment({
          momentId: selectedMomentId,
          myUid,
          ownerUid: knownOwnerFromList,
        });
      } finally {
        if (!cancelled) {
          setIsLoadingMomentMeta(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [
    selectedMomentId,
    myUid,
    knownOwnerFromList,
    syncForSelectedMoment,
    clearActive,
  ]);

  // Keep the owner's public poll totals fresh while the moment is visible.
  // Votes are written by friends through Locket, so this lightweight refresh
  // makes their choices appear without forcing the owner to close/reopen it.
  useEffect(() => {
    if (
      !selectedMomentId ||
      !myUid ||
      !ownerUid ||
      !isOwnMoment ||
      isPublic !== true ||
      !pollCounts?.isPoll
    ) {
      return undefined;
    }

    const refreshActivity = () => {
      fetchActivityForMoment({
        momentId: selectedMomentId,
        myUid,
        ownerUid,
      });
    };

    const intervalId = window.setInterval(refreshActivity, 10_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshActivity();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    selectedMomentId,
    myUid,
    ownerUid,
    isOwnMoment,
    isPublic,
    pollCounts?.isPoll,
    fetchActivityForMoment,
  ]);

  const showSeenMoments = useUserSetting((s) => s.showSeenMoments);

  useEffect(() => {
    if (!selectedMomentId || !ownerUid || isOwnMoment) return;
    if (!showSeenMoments) return;

    const markViewed = async () => {
      try {
        const payload = {
          id: selectedMomentId,
          user: ownerUid,
        };

        if (userDetail?.isCelebrity) {
          payload.celebrity = ownerUid;
        }
        await markMomentViewedOnce(payload);
      } catch (err) {
        console.error("❌ Lỗi mark viewed:", err);
      }
    };

    markViewed();
  }, [
    selectedMomentId,
    ownerUid,
    isOwnMoment,
    showSeenMoments,
    userDetail?.isCelebrity,
  ]);

  const triggerReaction = useReactionStore((s) => s.triggerReaction);

  const getIntensity = (startTime) => {
    const HOLD_MAX_MS = 5000;

    const elapsed = Date.now() - startTime;

    return Number(Math.min(elapsed / HOLD_MAX_MS, 1).toFixed(6));
  };

  const handlePointerDown = (e, emoji) => {
    touchStartPosRef.current = {
      x: e.clientX,
      y: e.clientY,
    };

    movedRef.current = false;

    holdTimeoutRef.current = setTimeout(() => {
      holdStartRef.current = Date.now();
      setHoldingEmoji(emoji);
    }, HOLD_DELAY_MS);
  };

  const handlePointerMove = (e) => {
    if (!touchStartPosRef.current) return;

    const dx = e.clientX - touchStartPosRef.current.x;
    const dy = e.clientY - touchStartPosRef.current.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > 10) {
      movedRef.current = true;

      holdStartRef.current = null;

      setHoldingEmoji(null);
      setIntensity(0);
    }
  };

  const handlePointerUp = (emoji) => {
    if (movedRef.current) {
      cleanupHold();
      return;
    }

    let power = 0;

    if (holdStartRef.current) {
      power = getIntensity(holdStartRef.current);
    }

    sendReact(emoji, power);

    cleanupHold();
  };

  const handlePointerCancel = () => {
    cleanupHold();
  };

  const cleanupHold = () => {
    clearTimeout(holdTimeoutRef.current);

    holdTimeoutRef.current = null;
    holdStartRef.current = null;
    touchStartPosRef.current = null;
    movedRef.current = false;

    setHoldingEmoji(null);
    setIntensity(0);
  };

  useEffect(() => {
    if (!holdingEmoji) return;

    const interval = setInterval(() => {
      if (!holdStartRef.current) return;

      setIntensity(getIntensity(holdStartRef.current));
    }, 16);

    return () => clearInterval(interval);
  }, [holdingEmoji]);

  const sendReact = async (emoji, power = 0) => {
    if (isSendingReaction || !selectedMomentId) return;

    try {
      setIsSendingReaction(true);

      // trigger effect
      await SendReactMoment(emoji, selectedMomentId, power);
      triggerReaction(emoji);
      SonnerSuccess(t("bottom.reaction_sent_success"));
      setShowEmojiPicker(false);
    } catch (error) {
      SonnerError(t("bottom.reaction_sent_failed"));
      console.error("Lỗi khi gửi react:", error);
    } finally {
      setIsSendingReaction(false);
    }
  };

  const handleSend = async () => {
    if (isSendingMessage || !message.trim() || !selectedMomentId) return;

    setIsSendingMessage(true);

    try {
      await SonnerPromiseV2(
        (async () => {
          const moment = await getMomentById(selectedMomentId);
          await SendMessageMoment(message, moment.id, moment.user);
        })(),
        {
          loading: t("bottom.sending_message"),
          success: t("bottom.message_sent_success"),
          error: t("bottom.message_sent_failed"),
        },
      );

      triggerReaction("💬");

      setMessage("");
      setShowFullInput(false);
    } catch (error) {
      console.error("❌ Lỗi khi gửi message:", error);
    } finally {
      setIsSendingMessage(false);
    }
  };

  const fullName = `${userDetail?.firstName || ""} ${
    userDetail?.lastName || ""
  }`.trim();
  const shortName =
    fullName.length > 10 ? fullName.slice(0, 10) + "…" : fullName;

  useEffect(() => {
    if (!showFullInput) return;

    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowFullInput(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [showFullInput]);

  if (!selectedMomentId) return null;

  if (isOwnMoment) {
    return (
      <MomentActivity
        isPublic={isPublic}
        activity={activity}
        pollCounts={pollCounts}
        isLoading={isLoadingActivity || isLoadingMomentMeta}
      />
    );
  }

  return (
    <>
      <MomentReplyBar
        showFullInput={showFullInput}
        wrapperRef={wrapperRef}
        inputRef={inputRef}
        shortName={shortName}
        message={message}
        setMessage={setMessage}
        handleSend={handleSend}
        isSendingMessage={isSendingMessage}
        isSendingReaction={isSendingReaction}
        userDetail={userDetail}
        holdingEmoji={holdingEmoji}
        intensity={intensity}
        handlePointerDown={handlePointerDown}
        handlePointerUp={handlePointerUp}
        handlePointerCancel={handlePointerCancel}
        handlePointerMove={handlePointerMove}
        setShowFullInput={setShowFullInput}
        setShowEmojiPicker={setShowEmojiPicker}
      />
      <Suspense fallback={null}>
        <EmojiPicker
          open={showEmojiPicker}
          onClose={() => setShowEmojiPicker(false)}
        />
      </Suspense>
    </>
  );
};

export default MomentInteraction;
