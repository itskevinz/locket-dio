import SearchInput from "@/components/uikit/Input/SearchInput";
import LoadingRing from "@/components/uikit/Loading/ring";
import { SonnerPromiseV2 } from "@/components/uikit/SonnerToast";
import { removeFriend, toggleHiddenFriend } from "@/services";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EyeOff, RefreshCcw } from "lucide-react";
import { useRef, useMemo, useState, useCallback } from "react";
import { FaUserFriends } from "react-icons/fa";
import FriendItem from "./FriendItem";
import { useFriendObjects } from "@/stores";
import { useTranslation } from "react-i18next";

// Mỗi FriendItem cao khoảng 76px (avatar 64px + padding py-2 = 8px top + 8px bottom)
const ITEM_HEIGHT = 80;
// Số item hiển thị ban đầu khi chưa mở rộng
const INITIAL_COUNT = 3;

const FriendList = ({
  loading,
  refreshFriendsData,
  removeFriendLocal,
  hiddenUserState,
  showAllFriends,
  setShowAllFriends,
}) => {
  const { t } = useTranslation("features");
  const friendObjects = useFriendObjects();
  const parentRef = useRef(null);

  const [lastUpdated, setLastUpdated] = useState(() =>
    localStorage.getItem("friendsUpdatedAt"),
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [isFocused, setIsFocused] = useState(null);
  const [viewMode, setViewMode] = useState("visible");

  // --------- handlers (memoized để tránh re-render FriendItem) ---------

  const handleRefreshFriends = useCallback(async () => {
    await SonnerPromiseV2(refreshFriendsData(), {
      loading: t("friends.list.syncing"),
      success: () => {
        const updatedAt = new Date().toISOString();
        localStorage.setItem("friendsUpdatedAt", updatedAt);
        setLastUpdated(updatedAt);
        return t("friends.list.sync_success");
      },
      error: (err) => err?.message || t("friends.list.sync_failed"),
    });
  }, [refreshFriendsData, t]);

  const handleDeleteFriend = useCallback(
    (uid) =>
      SonnerPromiseV2(
        removeFriend(uid).then((result) => {
          if (result !== uid) throw new Error("DELETE_FAILED");
          removeFriendLocal(uid);
          return result;
        }),
        {
          loading: t("friends.list.deleting"),
          success: t("friends.list.delete_success"),
          error: t("friends.list.error_retry"),
        },
      ),
    [removeFriendLocal, t],
  );

  const handleHiddenFriend = useCallback(
    (relation, uid) => {
      if (!relation) return;
      const prevHidden = relation.hidden ?? false;
      hiddenUserState(uid, !prevHidden);
      return SonnerPromiseV2(
        toggleHiddenFriend(uid).then((res) => {
          if (!res?.success) throw new Error("UPDATE_FAILED");
          return res;
        }),
        {
          loading: t("friends.list.updating_hidden"),
          success: t("friends.list.update_hidden_success"),
          error: () => {
            hiddenUserState(uid, prevHidden);
            return t("friends.list.update_hidden_failed");
          },
        },
      );
    },
    [hiddenUserState, t],
  );

  // --------- visible / hidden + search ---------

  const visibleFriends = useMemo(
    () => friendObjects.filter((friend) => !friend.relation?.hidden),
    [friendObjects],
  );

  const hiddenFriends = useMemo(
    () => friendObjects.filter((friend) => friend.relation?.hidden),
    [friendObjects],
  );

  const filteredFriends = useMemo(() => {
    const source = viewMode === "hidden" ? hiddenFriends : visibleFriends;
    const term = searchTerm.trim().toLowerCase();
    if (!term) return source;

    return source.filter((friend) => {
      const fullName = `${friend.firstName || ""} ${friend.lastName || ""}`.toLowerCase();
      const username = (friend.username || "").toLowerCase();
      return fullName.includes(term) || username.includes(term);
    });
  }, [hiddenFriends, searchTerm, viewMode, visibleFriends]);

  // Danh sách ẩn luôn hiển thị đầy đủ để người dùng tìm và gỡ ẩn ngay.
  // Danh sách thường vẫn giữ hành vi "Xem thêm" cũ.
  const listItems = useMemo(() => {
    if (viewMode === "hidden" || searchTerm || showAllFriends) {
      return filteredFriends;
    }
    return filteredFriends.slice(0, INITIAL_COUNT);
  }, [filteredFriends, showAllFriends, searchTerm, viewMode]);

  // --------- virtualizer (chỉ kích hoạt khi danh sách dài) ---------

  const shouldVirtualize =
    (viewMode === "hidden" || showAllFriends || !!searchTerm) &&
    listItems.length > INITIAL_COUNT;

  const rowVirtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 5, // render thêm 5 item ngoài viewport để scroll mượt
    enabled: shouldVirtualize,
  });

  const switchView = useCallback((mode) => {
    setViewMode(mode);
    setSearchTerm("");
    setIsFocused(null);
  }, []);

  return (
    <div>
      <h1 className="flex items-center gap-2 font-semibold text-md mb-1">
        <FaUserFriends size={25} className="scale-x-[-1]" /> {t("friends.list.title")}
      </h1>
      <div className="mt-1 space-y-1 text-sm text-base-content/80">
        <p>{t("friends.list.sync_tip")}</p>
        {/* Free-for-all Premium: full friend list — no paywall tip */}
      </div>

      {/* Chuyển nhanh giữa bạn bè thường và bạn bè đã ẩn */}
      <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-base-200 p-1">
        <button
          type="button"
          onClick={() => switchView("visible")}
          className={`btn btn-sm h-auto min-h-10 rounded-xl border-0 ${
            viewMode === "visible"
              ? "btn-primary text-primary-content"
              : "btn-ghost"
          }`}
        >
          <FaUserFriends size={17} />
          <span>Bạn bè</span>
          <span className="opacity-70">({visibleFriends.length})</span>
        </button>
        <button
          type="button"
          onClick={() => switchView("hidden")}
          className={`btn btn-sm h-auto min-h-10 rounded-xl border-0 ${
            viewMode === "hidden"
              ? "btn-primary text-primary-content"
              : "btn-ghost"
          }`}
        >
          <EyeOff className="h-4 w-4" />
          <span>Bạn bè đã ẩn</span>
          <span className="opacity-70">({hiddenFriends.length})</span>
        </button>
      </div>

      {viewMode === "hidden" && (
        <p className="mt-2 text-xs text-base-content/60">
          Mở menu của người bạn muốn khôi phục rồi chọn “Gỡ ẩn”.
        </p>
      )}

      {/* Search + refresh */}
      <div className="flex gap-2 items-center mt-2">
        <SearchInput
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          isFocused={isFocused}
          setIsFocused={setIsFocused}
          placeholder={
            viewMode === "hidden"
              ? "Tìm trong bạn bè đã ẩn..."
              : t("friends.list.search_placeholder")
          }
        />
        <button
          className={`btn btn-base-200 text-sm flex items-center gap-2 ${
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
          onClick={handleRefreshFriends}
          disabled={loading}
        >
          {loading ? (
            <>
              <LoadingRing size={20} stroke={2} />
              <span>{t("friends.list.syncing_btn")}</span>
            </>
          ) : (
            <>
              <RefreshCcw className="w-5 h-5" />
              <span>{t("friends.list.sync_btn")}</span>
            </>
          )}
        </button>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <p className="text-xs text-gray-500 mt-1">
          {t("friends.list.last_updated", {
            time: new Date(lastUpdated).toLocaleString(),
          })}
        </p>
      )}

      {/* List */}
      <div className="mt-4">
        {filteredFriends.length === 0 && (
          <p className="text-gray-400 text-center mt-10">
            {viewMode === "hidden"
              ? searchTerm
                ? "Không tìm thấy bạn bè đã ẩn phù hợp"
                : "Chưa có bạn bè nào bị ẩn"
              : t("friends.list.no_friends_to_show")}
          </p>
        )}

        {shouldVirtualize ? (
          /* ---- VIRTUAL SCROLLING khi danh sách dài ---- */
          <div ref={parentRef} className="h-2/3 overflow-y-auto">
            <div
              style={{
                height: rowVirtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const friend = listItems[virtualRow.index];
                return (
                  <div
                    key={friend.uid}
                    style={{
                      position: "absolute",
                      top: virtualRow.start,
                      left: 0,
                      right: 0,
                      height: virtualRow.size,
                    }}
                  >
                    <FriendItem
                      friend={friend}
                      onDelete={handleDeleteFriend}
                      onHidden={handleHiddenFriend}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* ---- NORMAL render khi ít item (≤ INITIAL_COUNT) ---- */
          listItems.map((friend) => (
            <FriendItem
              key={friend.uid}
              friend={friend}
              onDelete={handleDeleteFriend}
              onHidden={handleHiddenFriend}
            />
          ))
        )}

        {/* Expand / Collapse button - chỉ áp dụng danh sách bạn bè thường */}
        {viewMode === "visible" &&
          !searchTerm &&
          filteredFriends.length > INITIAL_COUNT && (
            <div className="flex items-center gap-4 mt-4">
              <hr className="flex-grow border-t border-base-content" />
              <button
                onClick={() => setShowAllFriends(!showAllFriends)}
                className="bg-base-200 hover:bg-base-300 text-base-content font-semibold px-4 py-2 rounded-3xl"
              >
                {showAllFriends
                  ? t("friends.list.collapse")
                  : t("friends.list.expand", {
                      count: filteredFriends.length - INITIAL_COUNT,
                    })}
              </button>
              <hr className="flex-grow border-t border-base-content" />
            </div>
          )}
      </div>
    </div>
  );
};

export default FriendList;
