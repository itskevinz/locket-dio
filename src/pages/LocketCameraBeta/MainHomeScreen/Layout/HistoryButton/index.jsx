import React from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMomentsStoreV2, useSelectedStore } from "@/stores";

const HistoryArrow = ({ setIsBottomOpen }) => {
  const { t } = useTranslation("main");
  const selectedFriendUid = useSelectedStore((s) => s.selectedFriendUid);
  const selectedKey = selectedFriendUid ?? "all";
  const latestMoment = useMomentsStoreV2(
    (s) => s.momentsByUser[selectedKey]?.moments?.[0] ?? null,
  );

  const latestThumbnail =
    latestMoment?.thumbnail_url ||
    latestMoment?.thumbnailUrl ||
    latestMoment?.image_url ||
    latestMoment?.imageUrl ||
    null;

  const handleClick = () => {
    setIsBottomOpen(true);
  };

  return (
    <div className="flex flex-col items-center select-none" data-history-button="true">
      <button
        className="flex flex-col items-center cursor-pointer transition-transform hover:scale-105 active:scale-95"
        onClick={handleClick}
      >
        <span
          data-mobile-activity-pill="true"
          className="hidden items-center gap-2 rounded-full bg-base-300/70 px-5 py-3 text-lg font-semibold backdrop-blur-xl"
        >
          <span aria-hidden="true">✦</span>
          {t("home.activity", { defaultValue: "Hoạt động" })}
        </span>

        <span
          data-ios-history-button="true"
          className="hidden items-center gap-3 text-lg font-semibold"
        >
          <span
            data-ios-history-thumb="true"
            className="relative h-11 w-11 overflow-hidden rounded-[15px] bg-base-300/70"
            aria-hidden="true"
          >
            {latestThumbnail ? (
              <img
                src={latestThumbnail}
                alt=""
                className="h-full w-full object-cover"
                loading="eager"
                decoding="async"
              />
            ) : null}
          </span>
          <span className="flex items-center gap-1.5">
            {t("home.history", { defaultValue: "Lịch sử" })}
            <ChevronDown className="h-5 w-5 opacity-70" strokeWidth={3} />
          </span>
        </span>

        <span data-desktop-history-button="true" className="flex flex-col items-center">
          <div className="flex items-center justify-center space-x-2 mb-1">
            <span className="text-xl font-semibold text-base-content">
              {t("home.history")}
            </span>
          </div>
          <svg
            width="40"
            height="40"
            viewBox="0 0 40 40"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M4 8l17 7l17-7"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
    </div>
  );
};

export default HistoryArrow;
