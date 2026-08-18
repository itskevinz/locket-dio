import React, { useEffect } from "react";
import { BookUser } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppNavigation } from "@/context/AppContext";
import FriendsContainer from "@/features/FriendsContainer";
import NotificationCenter from "@/features/SlotMonitor/NotificationCenter";
import SlotWatchInline from "@/features/SlotMonitor/SlotWatchInline";
import SlotNotificationSettings from "@/features/SlotMonitor/SlotNotificationSettings";

const FriendManager = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isFriendsTabOpen, setFriendsTabOpen } = useAppNavigation();
  const isSlotPage = new URLSearchParams(location.search).get("slot") === "1";
  const openedFromSlotPage = location.state?.fromSlotPage === true;

  useEffect(() => {
    if (isSlotPage) {
      setFriendsTabOpen(false);
      return undefined;
    }

    setFriendsTabOpen(true);
    return () => setFriendsTabOpen(false);
  }, [isSlotPage, setFriendsTabOpen]);

  if (isSlotPage) {
    return (
      <div className="min-h-[80vh] bg-base-100">
        <SlotWatchInline />
        <div
          id="slot-notification-settings"
          className="mx-auto w-full max-w-5xl scroll-mt-4 px-4 pb-6"
        >
          <SlotNotificationSettings />
        </div>
        <NotificationCenter />
      </div>
    );
  }

  const handleFriendsClose = () => {
    if (openedFromSlotPage) {
      navigate("/friends?slot=1", { replace: true, state: null });
    }
  };

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center bg-base-100 text-base-content px-4 text-center gap-3">
      <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-base-200">
        <BookUser className="w-6 h-6" />
      </div>
      <p className="font-medium">Quản lý bạn bè</p>
      <p className="text-sm text-base-content/60">
        Tìm bạn, quản lý lời mời và Canh Slot Celeb.
      </p>
      {!isFriendsTabOpen && (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setFriendsTabOpen(true)}
        >
          Mở quản lý bạn bè
        </button>
      )}
      <FriendsContainer onClose={handleFriendsClose} />
    </div>
  );
};

export default FriendManager;
