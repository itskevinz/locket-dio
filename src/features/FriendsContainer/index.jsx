import { useRef, useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { useAppNavigation } from "@/context/AppContext";
import { logWebUserAction } from "@/services/UserActivityService";
import { Clock3, X } from "lucide-react";
import { AcceptRequestToFriend } from "@/services";
import IncomingFriendRequests from "./IncomingRequests";
import { SonnerPromiseV2 } from "@/components/uikit/SonnerToast";
import OutgoingRequest from "./OutgoingRequest";
import { useFriendList, useFriendStoreV3 } from "@/stores";
import FindFriend from "./FindFriend";
import FriendList from "./FriendList";
import clsx from "clsx";
import { useTranslation } from "react-i18next";

const LiveClock = () => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-base-content/60 tabular-nums"
      aria-label="Giờ hiện tại"
    >
      <Clock3 className="w-3.5 h-3.5" />
      <span>
        {now.toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })}
      </span>
    </div>
  );
};

const FriendsContainer = ({ onClose }) => {
  const { t } = useTranslation("features");
  const popupRef = useRef(null);
  const navigation = useAppNavigation();

  const {
    loading,
    refreshFriendsData,
    removeFriendLocal,
    addFriendLocal,
    hiddenUserState,
  } = useFriendStoreV3();

  const friendList = useFriendList();

  const { isFriendsTabOpen, setFriendsTabOpen, isPWA } = navigation;
  // Free-for-all: luôn mở full danh sách bạn bè (không limit 100 / Premium)
  const [showAllFriends, setShowAllFriends] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [animate, setAnimate] = useState(false);

  const closeFriends = () => {
    setFriendsTabOpen(false);
    if (typeof onClose === "function") onClose();
  };

  useEffect(() => {
    document.body.style.overflow = showModal ? "hidden" : "";
    return () => (document.body.style.overflow = "");
  }, [showModal]);

  useEffect(() => {
    let animationTimer = null;
    let closeTimer = null;

    if (isFriendsTabOpen) {
      setShowModal(true);
      animationTimer = window.setTimeout(() => setAnimate(true), 10);
      // Mở tab bạn bè → luôn thử sync (force nếu list rỗng)
      refreshFriendsData().catch(() => {});
      logWebUserAction({
        actionType: "FRIENDS_VIEW",
        actionTitle: "Truy cập Danh sách Bạn bè & Nhóm",
        details: "Thành viên mở danh sách quản lý kết bạn, nhóm và lời mời",
      }).catch(() => {});
    } else {
      setAnimate(false);
      // Giữ full list khi mở lại — không collapse về 3
      setShowAllFriends(true);
      closeTimer = window.setTimeout(() => {
        setShowModal(false);
      }, 300);
    }

    // Quan trọng: nếu trạng thái đổi từ đóng → mở trước khi 300ms kết thúc,
    // hủy timer đóng cũ. Nếu không timer cũ sẽ đóng modal ngay sau khi route
    // /friends?slot=1 vừa yêu cầu mở, khiến người dùng chỉ thấy trang nền.
    return () => {
      if (animationTimer) window.clearTimeout(animationTimer);
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [isFriendsTabOpen]);

  const handleAcceptRequest = (uid) =>
    SonnerPromiseV2(
      AcceptRequestToFriend(uid).then((data) => {
        if (!data) {
          throw new Error("NOT_FOUND");
        }

        addFriendLocal(data);
        return data;
      }),
      {
        loading: t("friends.accepting_request"),
        success: (data) => t("friends.accept_success", { name: data.firstName }),
        error: (error) => {
          console.error(
            "❌ Lỗi khi chấp nhận lời mời:",
            error?.message || error,
          );

          return error?.message === "NOT_FOUND"
            ? t("friends.request_not_found")
            : t("friends.accept_failed");
        },
        description: {
          success: t("friends.notif_title"),
        },
      },
    );

  if (!showModal) return null;

  return ReactDOM.createPortal(
    <div
      className={clsx(
        "fixed inset-0 bg-base-100/30 backdrop-blur-[4px] transition-opacity duration-500 z-[60] overflow-hidden",
        {
          "opacity-100": animate,
          "opacity-0 pointer-events-none": !animate,
        },
      )}
      onClick={closeFriends}
    >
      <div
        ref={popupRef}
        className={clsx(
          "fixed border-t border-base-300 bottom-0 left-0 w-full bg-base-100 rounded-t-4xl shadow-lg transition-all duration-500 ease-in-out z-[63] flex flex-col text-base-content",
          {
            "translate-y-0": animate,
            "translate-y-full": !animate,
            "h-[95vh]": isPWA,
            "h-[85vh]": !isPWA,
          },
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={closeFriends}
          className="absolute top-2 right-3 z-10"
        >
          <X className="w-8 h-8 btn btn-circle p-1" />
        </button>
        {/* Header */}
        <div className="sticky top-0 shadow-md flex flex-col items-center pb-2 rounded-t-4xl">
          <div className="w-12 h-1.5 bg-base-content rounded-full mx-auto my-2" />
          <h1 className="text-2xl font-semibold text-base-content">
            ❤️‍🔥 {t("friends.friends_count", { count: friendList.length })}
          </h1>
          <h2 className="text-md font-semibold text-base-content">
            {t("friends.search_and_add")}
          </h2>
          <LiveClock />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-6 space-y-6">
          {/* Tìm kiếm */}
          <FindFriend refreshFriendsData={refreshFriendsData} />

          {/* Danh sách bạn bè */}
          <FriendList
            loading={loading}
            refreshFriendsData={refreshFriendsData}
            removeFriendLocal={removeFriendLocal}
            hiddenUserState={hiddenUserState}
            showAllFriends={showAllFriends}
            setShowAllFriends={setShowAllFriends}
          />

          {/* Requests */}
          <IncomingFriendRequests handleAcpFriend={handleAcceptRequest} />
          <OutgoingRequest />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default FriendsContainer;
