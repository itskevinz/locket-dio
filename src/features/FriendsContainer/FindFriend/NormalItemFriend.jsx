import React, { useEffect, useState } from "react";
import FriendActionButton from "../components/FriendActionButton";
import { fetchUserById } from "@/services";

const GOLD_BADGE_URL =
  "https://cdn.locket-dio.com/v1/caption/caption-icon/locket_gold_badge.png";

const getBadge = (user) =>
  user?.badge ??
  user?._badge ??
  user?.profile?.badge ??
  user?.profile?._badge ??
  null;

export default function NormalItemFriend({
  friend,
  handleAddFriend,
  loading,
  disabled,
  status,
}) {
  const [resolvedBadge, setResolvedBadge] = useState(() => getBadge(friend));

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

  const isGold = resolvedBadge === "locket_gold";

  return (
    <div
      key={friend.uid}
      className="flex w-full items-center gap-3 space-y-2 rounded-md cursor-pointer justify-between"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <img
            src={friend.profile_picture_url || "./default-avatar.png"}
            alt={`${friend?.first_name} ${friend?.last_name}`}
            className="w-16 h-16 rounded-full border-[3.5px] p-0.5 border-amber-400 object-cover"
          />
          {isGold && (
            <img
              src={GOLD_BADGE_URL}
              alt="Locket Gold"
              className="absolute -right-1 -bottom-1 w-6 h-6 object-contain drop-shadow-sm"
              draggable={false}
            />
          )}
        </div>
        <div>
          <h2 className="font-medium">
            {friend?.first_name} {friend?.last_name}
          </h2>
          <p className="text-sm text-gray-500 underline">
            @{friend.username || "Không có username"}
          </p>
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
