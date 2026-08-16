import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import {
  Ban,
  EyeOff,
  UserRoundX,
  X,
  Info,
  Eye,
  CircleEllipsis,
  Heart,
} from "lucide-react";
import { SonnerPromiseV2 } from "@/components/uikit/SonnerToast";
import ConfirmPoup from "@/features/PoupScreen/ConfirmPoup";
import { useTranslation } from "react-i18next";
import { FallbackAvatar } from "@/components/common";
import { blockFriend } from "@/services";
import { useFriendStoreV3 } from "@/stores";

function formatFriendDate(value) {
  if (!value) return "";

  const numericValue = Number(value);
  const normalizedValue = Number.isFinite(numericValue)
    ? numericValue < 1e12
      ? numericValue * 1000
      : numericValue
    : value;
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return "";

  const pad = (number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )} ${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
}

const AccountLabel = memo(function AccountLabel({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[11px] font-semibold text-warning">
      {children}
    </span>
  );
});

// memo tránh re-render khi parent re-render nhưng props không đổi
const FriendItem = memo(function FriendItem({ friend, onDelete, onHidden }) {
  const { t } = useTranslation("features");
  const { removeFriendLocal } = useFriendStoreV3();
  const [openMenuUid, setOpenMenuUid] = useState(null);
  const [openInfoUid, setOpenInfoUid] = useState(null);
  const [openDeleteModal, setOpenDeleteModal] = useState(false);
  const [openHiddenModal, setOpenHiddenModal] = useState(false);
  const [openBlockModal, setOpenBlockModal] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState(null);

  const menuRefs = useRef({});
  const infoRefs = useRef({});

  const relation = friend.relation || {};
  const isHidden = relation.hidden;
  const sharedHistoryOn = relation.sharedHistoryOn;
  const createdAt = relation.createdAt;
  const friendDate = formatFriendDate(createdAt);
  const isGold = friend.badge === "locket_gold";
  const isCelebrity = Boolean(friend.isCelebrity);

  const toggleMenu = useCallback(
    (uid) => setOpenMenuUid((prev) => (prev === uid ? null : uid)),
    [],
  );

  const toggleInfo = useCallback(
    (uid) => setOpenInfoUid((prev) => (prev === uid ? null : uid)),
    [],
  );

  // click-outside handler — chỉ bind khi có menu/info mở
  useEffect(() => {
    if (!openMenuUid && !openInfoUid) return;

    const handleClick = (e) => {
      if (openMenuUid) {
        const ref = menuRefs.current[openMenuUid];
        if (ref && !ref.contains(e.target)) setOpenMenuUid(null);
      }
      if (openInfoUid) {
        const ref = infoRefs.current[openInfoUid];
        if (ref && !ref.contains(e.target)) setOpenInfoUid(null);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenuUid, openInfoUid]);

  const handleDelete = useCallback(() => {
    onDelete(selectedFriend.uid);
    setOpenDeleteModal(false);
  }, [onDelete, selectedFriend]);

  const handleHidden = useCallback(() => {
    onHidden(relation, selectedFriend.uid);
    setOpenHiddenModal(false);
  }, [onHidden, relation, selectedFriend]);

  const handleBlock = useCallback(() => {
    const uid = selectedFriend?.uid;
    if (!uid) return;

    return SonnerPromiseV2(
      blockFriend(uid).then((result) => {
        if (!result?.confirmed) throw new Error("BLOCK_NOT_CONFIRMED");
        removeFriendLocal(uid);
        setOpenBlockModal(false);
        return result;
      }),
      {
        loading: "Đang block trên Locket...",
        success: "Đã block tài khoản trên Locket",
        error: (error) =>
          error?.response?.data?.message ||
          error?.message ||
          "Locket chưa xác nhận block. Vui lòng thử lại.",
      },
    );
  }, [removeFriendLocal, selectedFriend]);

  return (
    <>
      <div className="flex items-center justify-between py-2">
        {/* LEFT */}
        <div
          className={`flex min-w-0 items-center gap-3 ${isHidden ? "opacity-60" : ""}`}
        >
          <Avatar friend={friend} />

          <div className="min-w-0">
            <h2
              className={`font-medium truncate max-w-[52vw] sm:max-w-[360px] lg:max-w-[560px] ${
                isHidden ? "text-gray-400" : ""
              }`}
            >
              {friend.firstName} {friend.lastName}
            </h2>
            <p className="text-sm text-gray-500 truncate max-w-[52vw] sm:max-w-[430px] lg:max-w-[650px]">
              @{friend.username || "Không có username"}
              {friendDate ? ` • Ngày kết bạn: ${friendDate}` : ""}
            </p>

            {(isCelebrity || isGold) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {isCelebrity && <AccountLabel>Celebrity</AccountLabel>}
                {isGold && <AccountLabel>Locket Gold</AccountLabel>}
              </div>
            )}
          </div>

          {isHidden && (
            <div className="flex items-center gap-1 text-sm">
              <EyeOff className="w-4 h-4" /> {t("friends.item.hidden_label")}
            </div>
          )}
        </div>

        {/* RIGHT ACTIONS */}
        <div className="flex items-center gap-1">
          {/* INFO */}
          {!isHidden && (
            <div
              className="relative"
              ref={(el) => (infoRefs.current[friend.uid] = el)}
            >
              <button
                onClick={() => toggleInfo(friend.uid)}
                className="text-blue-500 p-2 rounded-full"
              >
                <Info className="w-5 h-5" />
              </button>

              <InfoDropdown
                open={openInfoUid === friend.uid}
                sharedHistoryOn={sharedHistoryOn}
                createdAt={createdAt}
              />
            </div>
          )}

          {/* MENU */}
          <div
            className="relative"
            ref={(el) => (menuRefs.current[friend.uid] = el)}
          >
            <button
              onClick={() => toggleMenu(friend.uid)}
              className="p-2 rounded-full"
            >
              {isHidden ? (
                <CircleEllipsis className="w-6 h-6" />
              ) : (
                <X className="w-6 h-6 text-red-500" />
              )}
            </button>

            <MenuDropdown
              open={openMenuUid === friend.uid}
              isHidden={isHidden}
              onHidden={() => {
                setSelectedFriend(friend);
                setOpenHiddenModal(true);
                setOpenMenuUid(null);
              }}
              onDelete={() => {
                setSelectedFriend(friend);
                setOpenDeleteModal(true);
                setOpenMenuUid(null);
              }}
              onBlock={() => {
                setSelectedFriend(friend);
                setOpenBlockModal(true);
                setOpenMenuUid(null);
              }}
            />
          </div>
        </div>
      </div>

      {/* DELETE MODAL */}
      <ConfirmPoup
        open={openDeleteModal}
        onClose={() => setOpenDeleteModal(false)}
        onConfirm={handleDelete}
        title={t("friends.item.delete_confirm.title", {
          name: `${friend?.firstName} ${friend?.lastName}`,
        })}
        icon={<X size={28} className="text-gray-600" />}
        labelConfirm={t("friends.item.delete_confirm.confirm_btn")}
      >
        {t("friends.item.delete_confirm.content")}
      </ConfirmPoup>

      {/* HIDDEN MODAL */}
      <ConfirmPoup
        open={openHiddenModal}
        onClose={() => setOpenHiddenModal(false)}
        onConfirm={handleHidden}
        title={
          isHidden
            ? t("friends.item.hidden_confirm.unhide_title", {
                name: `${friend?.firstName} ${friend?.lastName}`,
              })
            : t("friends.item.hidden_confirm.hide_title", {
                name: `${friend?.firstName} ${friend?.lastName}`,
              })
        }
        icon={
          isHidden ? (
            <Eye size={28} className="text-gray-600" />
          ) : (
            <EyeOff size={28} className="text-gray-500" />
          )
        }
        labelConfirm={
          isHidden
            ? t("friends.item.hidden_confirm.unhide_btn")
            : t("friends.item.hidden_confirm.hide_btn")
        }
      >
        {isHidden
          ? t("friends.item.hidden_confirm.unhide_content")
          : t("friends.item.hidden_confirm.hide_content")}
      </ConfirmPoup>

      {/* BLOCK MODAL */}
      <ConfirmPoup
        open={openBlockModal}
        onClose={() => setOpenBlockModal(false)}
        onConfirm={handleBlock}
        title={t("friends.item.block_confirm.title", {
          name: `${friend?.firstName} ${friend?.lastName}`,
        })}
        icon={<Ban size={28} className="text-gray-600" />}
        labelConfirm={t("friends.item.block_confirm.confirm_btn")}
      >
        {t("friends.item.block_confirm.content")}
      </ConfirmPoup>
    </>
  );
});

export default FriendItem;

/* ---------------- SUB COMPONENTS (memoized) ---------------- */

const Avatar = memo(function Avatar({ friend }) {
  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <FallbackAvatar
        src={friend.profilePic && friend.profilePic !== "/images/default_profile.png" ? friend.profilePic : null}
        name={friend.firstName || friend.lastName || friend.displayName || friend.username}
        alt={`${friend.firstName} ${friend.lastName}`}
        className="w-16 h-16 rounded-full border-[3.5px] p-0.5 border-amber-400 object-cover"
      />

      {friend.badge === "locket_gold" ? (
        <span
          className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-base-100 bg-amber-400 shadow-sm"
          aria-label="Locket Gold"
          title="Locket Gold"
        >
          <Heart
            size={13}
            className="text-white"
            fill="currentColor"
            strokeWidth={0}
          />
        </span>
      ) : friend.isCelebrity ? (
        <img
          src="https://cdn.locket-dio.com/v1/caption/caption-icon/celebrity_badge.png"
          alt="Celebrity"
          className="absolute bottom-0 right-0 w-6 h-6 p-0.5 bg-base-100 rounded-full"
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </div>
  );
});

const InfoDropdown = memo(function InfoDropdown({
  open,
  sharedHistoryOn,
  createdAt,
}) {
  const { t } = useTranslation("features");

  return (
    <div
      className={`absolute z-50 right-0 -top-20 origin-bottom-right bg-base-200 shadow-lg rounded-xl p-3 text-sm w-56 transition-all duration-500 ${
        open
          ? "opacity-100 scale-100"
          : "opacity-0 scale-95 pointer-events-none"
      }`}
    >
      <p>
        <span className="font-medium">
          {t("friends.item.info.share_history")}:
        </span>{" "}
        {sharedHistoryOn
          ? new Date(sharedHistoryOn).toLocaleString()
          : t("friends.item.info.unknown")}
      </p>
      <p>
        <span className="font-medium">
          {t("friends.item.info.friends_since")}:
        </span>{" "}
        {createdAt
          ? formatFriendDate(createdAt)
          : t("friends.item.info.unknown")}
      </p>
    </div>
  );
});

const MenuDropdown = memo(function MenuDropdown({
  open,
  isHidden,
  onHidden,
  onDelete,
  onBlock,
}) {
  const { t } = useTranslation("features");

  return (
    <div
      className={`absolute -top-38 right-1 origin-bottom-right bg-base-300 shadow-xl rounded-xl w-48 p-2 flex flex-col gap-2 transition-all duration-300 ${
        open
          ? "scale-100 opacity-100"
          : "scale-0 opacity-0 pointer-events-none"
      }`}
    >
      <button onClick={onHidden} className="btn w-full justify-between">
        {isHidden ? t("friends.item.menu.unhide") : t("friends.item.menu.hide")}
        {isHidden ? (
          <Eye className="w-5 h-5" />
        ) : (
          <EyeOff className="w-5 h-5" />
        )}
      </button>

      <button
        onClick={onDelete}
        className="btn w-full justify-between text-red-600"
      >
        {t("friends.item.menu.delete")} <UserRoundX className="w-5 h-5" />
      </button>

      <button
        onClick={onBlock}
        className="btn w-full justify-between text-red-700"
      >
        {t("friends.item.menu.block")} <Ban className="w-5 h-5" />
      </button>
    </div>
  );
});
