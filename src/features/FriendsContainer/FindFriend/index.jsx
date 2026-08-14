import { useEffect, useRef, useState } from "react";
import axios from "axios";
import NormalItemFriend from "./NormalItemFriend";
import { FaSearchPlus } from "react-icons/fa";
import SearchInput from "@/components/uikit/Input/SearchInput";
import CelebItemFriend from "./CelebItemFriend";
import { Bell } from "lucide-react";
import { useSlotMonitor } from "../../SlotMonitor/useSlotMonitor";
import SlotWatchModal from "../../SlotMonitor/SlotWatchModal";
import {
  SonnerInfo,
  SonnerPromiseV2,
  SonnerWarning,
} from "@/components/uikit/SonnerToast";
import {
  FindFriendByUserName,
  getFriendshipStatus,
  SendRequestToCelebrity,
  SendRequestToFriend,
  SendRequestToFriendDirect,
  shareHistoryWithFriend,
} from "@/services";
import BouncyLoader from "@/components/uikit/Loading/Bouncy";
import { useFeatureVisible } from "@/hooks/useFeature";
import { useLocation, useNavigate } from "react-router-dom";
import { useShareHistory } from "@/stores";
import { getMyLocalId } from "@/utils/auth/getMyLocalId";
import { useTranslation } from "react-i18next";
import {
  classifyFriendRequestError,
  FRIENDSHIP_STATUS,
  friendshipStatusFromUser,
  normalizeFriendUsername,
} from "./friendSearchUtils";

const FindFriend = ({ refreshFriendsData }) => {
  const { t } = useTranslation("features");
  const navigate = useNavigate();
  const location = useLocation();
  const { watchedCelebs, slotPushState } = useSlotMonitor();
  const isSendRequest = useFeatureVisible("send_friend_request");
  const { shareHistoryOn, toggleShareHistoryOn } = useShareHistory();

  const [searchState, setSearchState] = useState("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [searchTermFind, setSearchTermFind] = useState("");
  const [foundUser, setFoundUser] = useState(null);
  const [isFocusedFind, setIsFocusedFind] = useState(null);
  const [sending, setSending] = useState(false);
  const [directSending, setDirectSending] = useState(false);
  const [isWatchModalOpen, setIsWatchModalOpen] = useState(false);
  const [friendshipStatus, setFriendshipStatus] = useState(
    FRIENDSHIP_STATUS.NONE,
  );

  const searchSequenceRef = useRef(0);
  const activeSearchRef = useRef(null);
  const lastSearchRef = useRef("");
  const sendingRef = useRef(false);
  const directSendingRef = useRef(false);
  const mountedRef = useRef(true);
  const slotJumpHandledRef = useRef("");

  const getDirectRequestErrorMessage = (error) => {
    const status = Number(error?.response?.status || error?.status || 0);
    const code = error?.response?.data?.code || error?.code || "";
    const serverMessage = error?.response?.data?.message || error?.message || "";

    if (code === "UPSTREAM_AUTH_FAILED" || status === 401 || status === 403) {
      return "Không thể xác thực với Locket qua Direct. Vui lòng thử lại.";
    }
    if (code === "USER_NOT_FOUND" || status === 404) {
      return "Người dùng không tồn tại hoặc không tìm thấy.";
    }
    if (code === "RATE_LIMITED" || status === 429) {
      return "Bạn thao tác quá nhanh. Vui lòng thử lại sau.";
    }
    if (code === "REQUEST_NOT_CONFIRMED") {
      return "Locket chưa ghi nhận lời mời. Không tính là thành công.";
    }
    if (code === "REQUEST_CONFLICT" || status === 409) {
      return "Yêu cầu kết bạn bị xung đột.";
    }
    if (!error?.response) {
      return "Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.";
    }
    return serverMessage || "Không thể gửi lời mời kết bạn qua Direct Beta.";
  };

  const getRequestMessage = (error, action = "search") => {
    switch (classifyFriendRequestError(error)) {
      case "auth-required":
        return t(
          "friends.find.auth_required",
          "Bạn cần đăng nhập trước khi tìm bạn.",
        );
      case "session-expired":
        return t(
          "friends.find.session_expired",
          "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
        );
      case "rate-limit":
        return t(
          "friends.find.rate_limited",
          "Bạn thao tác quá nhanh. Vui lòng thử lại sau.",
        );
      case "timeout":
        return t(
          "friends.find.timeout",
          "Máy chủ phản hồi quá chậm. Vui lòng thử lại.",
        );
      case "network":
        return t(
          "friends.find.network_error",
          "Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.",
        );
      case "server":
        return t(
          "friends.find.server_error",
          "Máy chủ đang gặp sự cố. Vui lòng thử lại sau.",
        );
      default:
        return action === "send"
          ? t("friends.find.send_failed", "Không thể gửi lời mời kết bạn.")
          : t("friends.find.error_try_again");
    }
  };

  const handleFindFriend = async (rawUsername) => {
    const username = normalizeFriendUsername(rawUsername);

    if (!username) {
      activeSearchRef.current?.controller.abort();
      activeSearchRef.current = null;
      setFoundUser(null);
      setFriendshipStatus(FRIENDSHIP_STATUS.NONE);
      setErrorMsg("");
      setSearchState("idle");
      return null;
    }

    if (
      activeSearchRef.current?.loading &&
      activeSearchRef.current.username === username
    ) {
      return null;
    }

    activeSearchRef.current?.controller.abort();

    const controller = new AbortController();
    const requestId = ++searchSequenceRef.current;
    activeSearchRef.current = {
      controller,
      loading: true,
      requestId,
      username,
    };
    lastSearchRef.current = username;

    setSearchState("loading");
    setFoundUser(null);
    setFriendshipStatus(FRIENDSHIP_STATUS.NONE);
    setErrorMsg("");

    try {
      const result = await FindFriendByUserName(username, {
        signal: controller.signal,
      });

      if (requestId !== searchSequenceRef.current || controller.signal.aborted) {
        return null;
      }

      if (!result?.success || !result?.data || Object.keys(result?.data || {}).length === 0) {
        setSearchState("empty");
        return null;
      }

      const user = result.data;
      setFoundUser(user);
      setFriendshipStatus(friendshipStatusFromUser(user));
      setSearchState("success");

      try {
        const status = await getFriendshipStatus(user.uid);
        if (
          requestId === searchSequenceRef.current &&
          !controller.signal.aborted
        ) {
          setFriendshipStatus(status);
        }
      } catch {
        // Kết quả tìm kiếm vẫn hợp lệ; giữ trạng thái đi kèm response tìm kiếm.
      }

      return user;
    } catch (error) {
      if (axios.isCancel(error) || controller.signal.aborted) return null;
      if (requestId !== searchSequenceRef.current) return null;

      const errorType = classifyFriendRequestError(error);
      if (errorType === "not-found") {
        setSearchState("empty");
      } else {
        setErrorMsg(getRequestMessage(error));
        setSearchState("error");
      }
      return null;
    } finally {
      if (activeSearchRef.current?.requestId === requestId) {
        activeSearchRef.current.loading = false;
      }
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const stateUsername = normalizeFriendUsername(location.state?.slotUsername);
    const queryUsername = normalizeFriendUsername(params.get("username"));
    const slotRequested = params.get("slot") === "1" || Boolean(stateUsername);
    const slotUsername = stateUsername || queryUsername;

    if (!slotRequested && !slotUsername) return;

    const eventKey = `${location.key}:${location.search}:${slotUsername}`;
    if (slotJumpHandledRef.current === eventKey) return;
    slotJumpHandledRef.current = eventKey;

    if (slotRequested) setIsWatchModalOpen(true);
    if (slotUsername) {
      setSearchTermFind(slotUsername);
      handleFindFriend(slotUsername);
    }

    if (location.state?.slotUsername) {
      navigate(`${location.pathname}${location.search || ""}`, {
        replace: true,
        state: null,
      });
    }
    // Chỉ xử lý deep-link Canh Slot một lần; handleFindFriend cố ý không đưa vào deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.pathname, location.search, location.state, navigate]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      searchSequenceRef.current += 1;
      activeSearchRef.current?.controller.abort();
      activeSearchRef.current = null;
    },
    [],
  );

  const handleSearchTermChange = (value) => {
    setSearchTermFind(value);
    if (normalizeFriendUsername(value) === lastSearchRef.current) return;

    searchSequenceRef.current += 1;
    activeSearchRef.current?.controller.abort();
    activeSearchRef.current = null;
    setFoundUser(null);
    setFriendshipStatus(FRIENDSHIP_STATUS.NONE);
    setErrorMsg("");
    setSearchState("idle");
  };

  const syncAfterConfirmedRequest = async (
    uid,
    { username = lastSearchRef.current, isCelebrity = false } = {},
  ) => {
    const optimisticRawStatus = isCelebrity
      ? "outgoing-follow-request"
      : "outgoing-request";

    if (mountedRef.current) {
      setFriendshipStatus(FRIENDSHIP_STATUS.OUTGOING);
    }

    try {
      const latest = await FindFriendByUserName(username);
      if (!mountedRef.current) return;
      if (latest?.success && latest?.data?.uid === uid) {
        const latestStatus = friendshipStatusFromUser(latest.data);
        const isPropagationLag =
          latestStatus === FRIENDSHIP_STATUS.NONE ||
          latestStatus === FRIENDSHIP_STATUS.UNKNOWN;

        setFoundUser((current) => ({
          ...latest.data,
          ...(isPropagationLag && current?.uid === uid
            ? { friendship_status: optimisticRawStatus }
            : {}),
        }));

        if (!isPropagationLag) {
          setFriendshipStatus(latestStatus);
        }
      }
    } catch {
      // Request đã được upstream xác nhận. Sync tìm kiếm chỉ là best-effort.
    }

    try {
      const latestStatus = await getFriendshipStatus(uid);
      if (
        mountedRef.current &&
        latestStatus !== FRIENDSHIP_STATUS.NONE &&
        latestStatus !== FRIENDSHIP_STATUS.UNKNOWN
      ) {
        setFriendshipStatus(latestStatus);
      }
    } catch {
      // Giữ trạng thái OUTGOING đã xác nhận thay vì kéo UI về "+ Kết bạn".
    }

    try {
      await refreshFriendsData?.();
    } catch {
      // Danh sách bạn bè có thể đồng bộ chậm; không biến request đã gửi thành lỗi UI.
    }
  };

  const handleAddFriend = async () => {
    if (!foundUser || sendingRef.current) return;

    if (!isSendRequest) {
      SonnerWarning(
        t("friends.find.feature_locked_title"),
        t("friends.find.feature_locked_desc"),
        {
          action: {
            label: t("friends.find.upgrade_label"),
            onClick: () => navigate("/pricing"),
          },
        },
      );
      return;
    }

    const currentUid = getMyLocalId();
    if (currentUid && currentUid === String(foundUser.uid)) {
      SonnerInfo(
        t("friends.find.cannot_add_self", "Bạn không thể tự kết bạn với mình."),
      );
      return;
    }

    if (friendshipStatus === FRIENDSHIP_STATUS.FRIENDS) {
      SonnerInfo(t("friends.find.already_friends", "Hai bạn đã là bạn bè."));
      return;
    }

    if (friendshipStatus === FRIENDSHIP_STATUS.OUTGOING) {
      SonnerInfo(
        t("friends.find.already_sent", "Lời mời kết bạn đã được gửi trước đó."),
      );
      return;
    }

    const targetUser = foundUser;
    const targetUsername = lastSearchRef.current;
    const targetIsCelebrity = Boolean(targetUser.celebrity);
    const optimisticRawStatus = targetIsCelebrity
      ? "outgoing-follow-request"
      : "outgoing-request";

    sendingRef.current = true;
    setSending(true);
    let requestConfirmed = false;

    try {
      const sendRequest = targetIsCelebrity
        ? SendRequestToCelebrity(targetUser.uid)
        : SendRequestToFriend(targetUser.uid);
      const confirmedSendRequest = sendRequest.then((response) => {
        if (response?.success) return response;
        const rejected = new Error("Friend request rejected");
        rejected.response = {
          status: response?.status || 400,
          data: { code: response?.code || "REQUEST_REJECTED" },
        };
        throw rejected;
      });

      await SonnerPromiseV2(confirmedSendRequest, {
        loading: t("friends.find.sending_request"),
        success: t("friends.find.send_success"),
        error: (error) => getRequestMessage(error, "send"),
      });

      requestConfirmed = true;
      if (mountedRef.current) {
        setFriendshipStatus(FRIENDSHIP_STATUS.OUTGOING);
        setFoundUser((current) =>
          current?.uid === targetUser.uid
            ? { ...current, friendship_status: optimisticRawStatus }
            : current,
        );
      }

      await syncAfterConfirmedRequest(targetUser.uid, {
        username: targetUsername,
        isCelebrity: targetIsCelebrity,
      });

      if (!targetIsCelebrity && shareHistoryOn) {
        try {
          await shareHistoryWithFriend(targetUser.uid);
          SonnerInfo(t("friends.find.history_share_info"));
        } catch {
          SonnerWarning(
            t(
              "friends.find.history_share_failed",
              "Đã gửi lời mời nhưng chưa thể chia sẻ lịch sử.",
            ),
          );
        }
      }
    } catch (error) {
      if (requestConfirmed) {
        console.warn("[friends] confirmed request background sync failed", error);
      }
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  };

  const handleDirectAddFriend = async () => {
    if (!foundUser || directSendingRef.current) return;

    if (!isSendRequest) {
      SonnerWarning(
        t("friends.find.feature_locked_title"),
        t("friends.find.feature_locked_desc"),
        {
          action: {
            label: t("friends.find.upgrade_label"),
            onClick: () => navigate("/pricing"),
          },
        },
      );
      return;
    }

    const currentUid = getMyLocalId();
    if (currentUid && currentUid === String(foundUser.uid)) {
      SonnerInfo(
        t("friends.find.cannot_add_self", "Bạn không thể tự kết bạn với mình."),
      );
      return;
    }

    if (friendshipStatus === FRIENDSHIP_STATUS.FRIENDS) {
      SonnerInfo(t("friends.find.already_friends", "Hai bạn đã là bạn bè."));
      return;
    }

    if (friendshipStatus === FRIENDSHIP_STATUS.OUTGOING) {
      SonnerInfo(
        t("friends.find.already_sent", "Lời mời kết bạn đã được gửi trước đó."),
      );
      return;
    }

    const targetUser = foundUser;
    const targetUsername = lastSearchRef.current;

    directSendingRef.current = true;
    setDirectSending(true);
    let requestConfirmed = false;

    try {
      const sendRequest = SendRequestToFriendDirect(targetUser.uid).then(
        (response) => {
          if (response?.success) return response;
          const rejected = new Error(
            response?.message || "Direct friend request rejected",
          );
          rejected.response = {
            status: response?.status || 400,
            data: {
              code: response?.code || "REQUEST_REJECTED",
              message: response?.message,
            },
          };
          throw rejected;
        },
      );

      const response = await SonnerPromiseV2(sendRequest, {
        loading: "Đang gửi qua Direct Beta...",
        success: (res) => {
          const verification = res?.data;
          const rel = String(
            res?.relationship || verification?.relationship || "",
          )
            .trim()
            .toUpperCase();
          const already = Boolean(
            res?.alreadyPersisted || verification?.alreadyPersisted,
          );
          const sent = Boolean(res?.sentNow || verification?.sentNow);

          if (already && (rel === "FRIENDS" || rel === "FRIEND")) {
            return "Đã là bạn";
          }
          if (already && rel === "OUTGOING") {
            return "Đã có lời mời trước đó";
          }
          if (sent) {
            return "Đã gửi và xác minh";
          }
          return "Đã gửi và xác minh";
        },
        error: (error) => getDirectRequestErrorMessage(error),
      });

      requestConfirmed = true;
      const verification = response?.data;
      const rel = String(
        response?.relationship || verification?.relationship || "",
      )
        .trim()
        .toUpperCase();
      const already = Boolean(
        response?.alreadyPersisted || verification?.alreadyPersisted,
      );

      if (already && (rel === "FRIENDS" || rel === "FRIEND")) {
        if (mountedRef.current) {
          setFriendshipStatus(FRIENDSHIP_STATUS.FRIENDS);
          setFoundUser((current) =>
            current?.uid === targetUser.uid
              ? { ...current, friendship_status: "friends" }
              : current,
          );
        }
      } else {
        if (mountedRef.current) {
          setFriendshipStatus(FRIENDSHIP_STATUS.OUTGOING);
          setFoundUser((current) =>
            current?.uid === targetUser.uid
              ? { ...current, friendship_status: "outgoing-request" }
              : current,
          );
        }
      }

      await syncAfterConfirmedRequest(targetUser.uid, {
        username: targetUsername,
        isCelebrity: false,
      });

      if (shareHistoryOn) {
        try {
          await shareHistoryWithFriend(targetUser.uid);
          SonnerInfo(t("friends.find.history_share_info"));
        } catch {
          SonnerWarning(
            t(
              "friends.find.history_share_failed",
              "Đã gửi lời mời nhưng chưa thể chia sẻ lịch sử.",
            ),
          );
        }
      }
    } catch (error) {
      if (requestConfirmed) {
        console.warn(
          "[friends-direct] confirmed request background sync failed",
          error,
        );
      }
    } finally {
      directSendingRef.current = false;
      if (mountedRef.current) setDirectSending(false);
    }
  };

  const isCelebrity = foundUser?.celebrity === true;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h2 className="flex items-center gap-2 text-md font-semibold">
          <FaSearchPlus size={22} /> {t("friends.find.search_title")}
        </h2>
        {watchedCelebs.length > 0 && (
          <button
            type="button"
            onClick={() => setIsWatchModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/15 text-primary text-xs font-semibold hover:bg-primary/25 transition-colors"
          >
            <Bell size={14} /> Đang canh: {watchedCelebs.length}
          </button>
        )}
      </div>
      <p className="text-sm">{t("friends.find.anti_spam")}</p>
      {watchedCelebs.length > 0 && (
        <p className="mt-1 text-xs text-base-content/50">
          {slotPushState?.enabled
            ? "Canh Slot 24/7 đang bật — có slot sẽ báo ra điện thoại/màn hình khóa."
            : "Mở Đang canh để bật thông báo 24/7 khi không mở Huy Locket."}
        </p>
      )}

      <div className="flex items-center justify-between py-3">
        <div className="flex items-center gap-3">
          <div>
            <p className="font-medium">{t("friends.find.share_history_title")}</p>
            <p className="text-sm text-base-content/60">
              {t("friends.find.share_history_desc")}
            </p>
          </div>
        </div>

        <input
          type="checkbox"
          checked={shareHistoryOn}
          onChange={toggleShareHistoryOn}
          className="toggle toggle-secondary"
        />
      </div>

      <div className="flex gap-2 items-center">
        <SearchInput
          searchTerm={searchTermFind}
          setSearchTerm={handleSearchTermChange}
          isFocused={isFocusedFind}
          setIsFocused={setIsFocusedFind}
          placeholder={t("friends.find.add_friend_placeholder")}
        />

        {searchTermFind && (
          <button
            disabled={searchState === "loading"}
            className="btn btn-base-200 text-base flex items-center gap-2 rounded-full disabled:opacity-50"
            onClick={() => handleFindFriend(searchTermFind)}
          >
            {searchState === "loading" ? (
              <>
                <BouncyLoader size={25} /> {t("friends.find.wait")}
              </>
            ) : (
              t("friends.find.search_btn")
            )}
          </button>
        )}
      </div>

      <div className="w-full flex justify-center mt-2">
        {searchState === "loading" && (
          <p className="text-gray-400 h-[70px] text-center flex items-center justify-center">
            {t("friends.find.searching")}
          </p>
        )}

        {searchState === "empty" && (
          <p className="text-gray-400 h-[70px] text-center flex items-center justify-center">
            {t("friends.find.user_not_exist", "Không tìm thấy người dùng")}
          </p>
        )}

        {searchState === "error" && (
          <div className="text-error h-[70px] text-center flex flex-col items-center justify-center">
            <p>{errorMsg}</p>
            <button
              className="btn btn-sm btn-outline mt-2"
              onClick={() => handleFindFriend(lastSearchRef.current)}
            >
              {t("friends.find.retry", "Thử lại")}
            </button>
          </div>
        )}

        {searchState === "idle" && (
          <p className="text-gray-400 h-[70px] text-center flex items-center justify-center">
            {t("friends.find.no_data")}
          </p>
        )}

        {searchState === "success" && foundUser &&
          (isCelebrity ? (
            <CelebItemFriend
              friend={foundUser}
              handleAddFriend={handleAddFriend}
              loading={sending}
              disabled={sending || directSending}
            />
          ) : (
            <NormalItemFriend
              friend={foundUser}
              handleAddFriend={handleAddFriend}
              handleDirectAddFriend={handleDirectAddFriend}
              loading={sending}
              directLoading={directSending}
              disabled={sending || directSending}
              status={friendshipStatus}
            />
          ))}
      </div>

      <SlotWatchModal
        isOpen={isWatchModalOpen}
        onClose={() => setIsWatchModalOpen(false)}
      />
    </div>
  );
};

export default FindFriend;