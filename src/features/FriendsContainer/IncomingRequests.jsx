import React, { useEffect, useState } from "react";
import { FaStarOfLife } from "react-icons/fa";
import {
  AcceptRequestToFriend,
  getListRequestFriendV2,
  loadFriendDetailsV3,
  shareHistoryWithFriend,
} from "@/services";
import { useApp } from "@/context/AppContext";
import { Check } from "lucide-react";
import { SonnerError, SonnerInfo, SonnerSuccess } from "@/components/uikit/SonnerToast";
import { useAuthStore, useFriendStoreV3, useShareHistory } from "@/stores";
import { useTranslation } from "react-i18next";
import { FallbackAvatar } from "@/components/common";

const IncomingFriendRequests = () => {
  const { t } = useTranslation("features");
  const { user } = useAuthStore();
  const { navigation } = useApp();
  const { isFriendsTabOpen } = navigation;

  const [friends, setFriends] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showAllFriends, setShowAllFriends] = useState(false);
  const [lastFetchAt, setLastFetchAt] = useState(0);

  const addFriendLocal = useFriendStoreV3((s) => s.addFriendLocal);

  const { shareHistoryOn, toggleShareHistoryOn } = useShareHistory();
  // ✅ CHỈ reset state khi mở tab — KHÔNG gọi API
  useEffect(() => {
    if (isFriendsTabOpen) {
      setFriends([]);
      setNextPageToken(null);
      setShowAllFriends(false);
      setErrorMessage(null);
    }
  }, [isFriendsTabOpen]);

  // ✅ Fetch khi user bấm nút
  const fetchFriendRequests = async (pageToken = null) => {
    if (!user) return;

    const now = Date.now();

    // 🚫 chống spam (5 giây)
    if (now - lastFetchAt < 5000) return;

    setLastFetchAt(now);
    setLoading(true);

    try {
      const result = await getListRequestFriendV2(pageToken);

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
      setErrorMessage(t("friends.incoming.load_error"));
    }

    setLoading(false);
  };

  const handleAcceptRequest = async (uid) => {
    try {
      const data = await AcceptRequestToFriend(uid);

      if (data) {
        addFriendLocal(data);

        // remove khỏi list
        setFriends((prev) => prev.filter((f) => f.uid !== uid));

        SonnerSuccess(
          t("friends.notif_title"),
          t("friends.incoming.accept_success", { name: data.firstName }),
        );
        if (shareHistoryOn) {
          await shareHistoryWithFriend(uid);
          SonnerInfo(t("friends.incoming.history_shared"));
        }
      } else {
        SonnerError(
          t("friends.notif_title"),
          t("friends.request_not_found"),
        );
      }
    } catch (error) {
      console.error("❌ Lỗi khi chấp nhận:", error);
      SonnerError(t("friends.accept_failed"));
    }
  };

  const visibleFriends = showAllFriends ? friends : friends.slice(0, 3);

  return (
    <div>
      <h2 className="flex flex-row items-center gap-2 text-base-content font-semibold text-md lg:text-xl mb-3">
        <FaStarOfLife size={22} /> {t("friends.incoming.title")}
      </h2>

      {/* ✅ Nút fetch */}
      {friends.length === 0 && !loading && (
        <div className="flex justify-center my-4">
          <button
            onClick={() => fetchFriendRequests()}
            className="bg-yellow-500 text-black px-4 py-2 rounded-full font-semibold"
          >
            {t("friends.incoming.fetch_btn")}
          </button>
        </div>
      )}

      {loading && friends.length === 0 ? (
        <p className="text-center text-gray-400 h-[70px]">{t("friends.incoming.loading")}</p>
      ) : errorMessage ? (
        <p className="text-center text-red-500 h-[70px]">{errorMessage}</p>
      ) : friends.length === 0 ? (
        <p className="text-center text-gray-400 h-[70px]">{t("friends.incoming.not_loaded")}</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {visibleFriends.map((friend) => (
              <div
                key={friend.uid}
                className="flex items-center gap-3 rounded-md justify-between"
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
                  className="btn flex items-center bg-yellow-500 text-black px-3 py-1 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAcceptRequest(friend.uid);
                  }}
                >
                  <Check className="w-5 h-5" strokeWidth={3} />
                  <span className="text-base font-semibold ml-1">
                    {t("friends.incoming.accept_btn")}
                  </span>
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
                className="bg-base-200 hover:bg-base-300 text-base-content font-semibold px-4 py-2 rounded-3xl"
              >
                {nextPageToken
                  ? t("friends.incoming.see_more")
                  : showAllFriends
                    ? t("friends.incoming.show_all")
                    : t("friends.incoming.see_more")}
              </button>
              <hr className="flex-grow border-t border-base-content" />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default IncomingFriendRequests;
