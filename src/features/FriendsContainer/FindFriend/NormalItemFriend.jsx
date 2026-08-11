import React, { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import FriendActionButton from "../components/FriendActionButton";
import { fetchUserById, getListIdFriends } from "@/services";

const getBadge = (user) =>
  user?.badge ??
  user?._badge ??
  user?.profile?.badge ??
  user?.profile?._badge ??
  null;

const formatFriendSince = (value) => {
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
};

export default function NormalItemFriend({
  friend,
  handleAddFriend,
  loading,
  disabled,
  status,
}) {
  const [resolvedBadge, setResolvedBadge] = useState(() => getBadge(friend));
  const [friendSince, setFriendSince] = useState("");

  useEffect(() => {
    let active = true;
    const badgeFromSearch = getBadge(friend);

    setResolvedBadge(badgeFromSearch);

    // Kết quả tìm theo username đôi khi không kèm badge, trong khi fetchUserV2 có.
    // Chỉ enrich đúng user đang hiển thị để Gold badge xuất hiện ngay trước khi kết bạn.
    if (badgeFromSearch || !friend?.uid) {
      return () => {
        active = false;
      };
    }

    fetchUserById(friend.uid)
      .then((profile) => {
        if (active) setResolvedBadge(getBadge(profile));
      })
      .catch(() => {
        // Badge là dữ liệu bổ sung; lỗi enrich không được làm hỏng kết quả tìm kiếm.
      });

    return () => {
      active = false;
    };
  }, [friend]);

  useEffect(() => {
    let active = true;
    const isFriend =
      status === "FRIENDS" || friend?.friendship_status === "friends";

    setFriendSince("");
    if (!isFriend || !friend?.uid) {
      return () => {
        active = false;
      };
    }

    // Ngày kết bạn phải lấy từ relation thật trong getAllFriendsV2,
    // không dùng createdAt của hồ sơ vì đó có thể là ngày tạo tài khoản.
    getListIdFriends()
      .then((relations) => {
        if (!active || !Array.isArray(relations)) return;
        const relation = relations.find(
          (item) => String(item?.uid || "") === String(friend.uid),
        );
        const createdAt =
          relation?.createdAt ??
          relation?.created_at ??
          relation?.friendship_created_at ??
          null;
        setFriendSince(formatFriendSince(createdAt));
      })
      .catch(() => {
        // Không có relation thì chỉ ẩn ngày kết bạn; không ảnh hưởng kết quả tìm kiếm.
      });

    return () => {
      active = false;
    };
  }, [friend?.uid, friend?.friendship_status, status]);

  const isGold = resolvedBadge === "locket_gold";

  return (
    <div
      key={friend.uid}
      className="flex w-full items-center gap-3 space-y-2 rounded-md cursor-pointer justify-between"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="relative shrink-0 w-16 h-16">
          <img
            src={friend.profile_picture_url || "./default-avatar.png"}
            alt={`${friend?.first_name} ${friend?.last_name}`}
            className="w-16 h-16 rounded-full border-[3.5px] p-0.5 border-amber-400 object-cover"
          />
          {isGold && (
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
          )}
        </div>

        <div className="min-w-0">
          <h2 className="font-medium truncate">
            {friend?.first_name} {friend?.last_name}
          </h2>
          <p className="text-sm text-base-content/60 truncate">
            @{friend.username || "Không có username"}
            {friendSince ? ` • Ngày kết bạn: ${friendSince}` : ""}
          </p>
          {isGold && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-xs font-semibold text-amber-500">
                Locket Gold
              </span>
            </div>
          )}
        </div>
      </div>

      <FriendActionButton
        status={status}
        onAdd={handleAddFriend}
        loading={loading}
        onAccept={() => console.log("accept")}
        onReject={() => console.log("reject")}
        disabled={disabled}
      />
    </div>
  );
}
