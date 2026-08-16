import React, { useEffect, useState } from "react";
import {
  getOutgoingRequestFriend,
  loadFriendDetailsV3,
  rejectFriendRequests,
} from "@/services";
import { useApp } from "@/context/AppContext";
import { X } from "lucide-react";
import { BsCheckCircleFill } from "react-icons/bs";
import { SonnerError, SonnerSuccess } from "@/components/uikit/SonnerToast";
import { useAuthStore } from "@/stores";
import { useTranslation } from "react-i18next";

import { FallbackAvatar } from "@/components/common";

const OutgoingRequest = () => {
  const { t } = useTranslation("features");
  const { navigation } = useApp();
  const { user } = useAuthStore();
  const { isFriendsTabOpen } = navigation;

  const [friends, setFriends] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showAllFriends, setShowAllFriends] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState(0);

  // ✅ CHỈ reset state khi mở tab — KHÔNG fetch
  useEffect(() => {
    if (isFriendsTabOpen) {
      setFriends([]);
      setNextPageToken(null);
      setShowAllFriends(false);
      setErrorMessage(null);
    }
  }, [isFriendsTabOpen]);

  // ✅ Fetch khi bấm nút
  const fetchFriendRequests = async (pageToken = null) => {
    if (!user) return;

    const now = Date.now();

    // 🚫 chống spam 5s
    if (now - lastFetchAt < 5000) return;

    setLastFetchAt(now);
    setLoading(true);

    try {
      const result = await getOutgoingRequestFriend(pageToken);

      if (result?.errorMessage) {
        setErrorMessage(result.errorMessage);
      } else {
        const frienddetails = await loadFriendDetailsV3(result?.friends);

        setFriends((prev) =>
          pageToken ? [...prev, ...frienddetails] : frienddetails,
        );

        setNextPageToken(result.nextPageToken || null);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage(t("friends.outgoing.load_error"));
    }

    setLoading(false);
  };

  const handleCancelRequest = async (uid, name) => {
    if (window.confirm(t("friends.outgoing.cancel_confirm", { name }))) {
      try {
        await rejectFriendRequests(uid, "outgoing");

        SonnerSuccess(
          t("friends.outgoing.cancel_success_title"),
          t("friends.outgoing.cancel_success_desc", { name }),
        );

        // ✅ remove khỏi list
        setFriends((prev) => prev.filter((f) => f.uid !== uid));
      } catch (error) {
        console.error("❌ Lỗi khi huỷ:", error);
        SonnerError(t("friends.outgoing.cancel_failed"));
      }
    }
  };

  const visibleFriends = showAllFriends ? friends : friends.slice(0, 3);

  return (
    <div>
      <h2 className="flex items-center gap-2 font-semibold text-md lg:text-xl mb-3">
        <BsCheckCircleFill size={22} /> {t("friends.outgoing.title")}
      </h2>

      {/* ✅ Nút fetch */}
      {friends.length === 0 && !loading && (
        <div className="flex justify-center my-4">
          <button
            onClick={() => fetchFriendRequests()}
            className="bg-yellow-500 text-black px-4 py-2 rounded-full font-semibold"
          >
            {t("friends.outgoing.fetch_btn")}
          </button>
        </div>
      )}

      {loading && friends.length === 0 ? (
        <p className="text-center text-gray-400 h-[70px]">{t("friends.outgoing.loading")}</p>
      ) : errorMessage ? (
        <p className="text-center text-red-500 h-[70px]">{errorMessage}</p>
      ) : friends.length === 0 ? (
        <p className="text-center text-gray-400 h-[70px]">{t("friends.outgoing.not_loaded")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {visibleFriends.map((friend) => (
              <div
                key={friend.uid}
                className="flex items-center gap-3 justify-between"
              >
                <div className="flex items-center gap-3">
                  <FallbackAvatar
                    src={friend.profilePic && friend.profilePic !== "./default-avatar.png" ? friend.profilePic : null}
                    name={friend.firstName || friend.lastName || friend.displayName || friend.username}
                    alt={`${friend.firstName} ${friend.lastName}`}
                    className="w-16 h-16 rounded-full border-[3.5px] p-0.5 border-amber-400 object-cover"
                  />
                  <div>
                    <h2 className="font-medium">
                      {friend.firstName} {friend.lastName}
                    </h2>
                    <p className="text-sm text-gray-500 underline">
                      @{friend.username || t("friends.no_username")}
                    </p>
                  </div>
                </div>

                <button
                  className="p-1 px-2.5 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancelRequest(friend.uid, friend.firstName);
                  }}
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            ))}
          </div>

          {(friends.length > 3 || nextPageToken) && (
            <div className="flex items-center gap-4 mt-4">
              <hr className="flex-grow border-t border-base-content" />
              <button
                onClick={async () => {
                  if (!showAllFriends) {
                    setShowAllFriends(true);
                  } else if (nextPageToken) {
                    await fetchFriendRequests(nextPageToken);
                  }
                }}
                className="bg-base-200 hover:bg-base-300 font-semibold px-4 py-2 rounded-3xl"
              >
                {nextPageToken
                  ? t("friends.outgoing.see_more")
                  : showAllFriends
                    ? t("friends.outgoing.show_all")
                    : t("friends.outgoing.see_more")}
              </button>
              <hr className="flex-grow border-t border-base-content" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default OutgoingRequest;
