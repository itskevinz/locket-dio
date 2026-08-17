import { Palette, Users, X } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useApp } from "@/context/AppContext";
import GeneralThemes from "./components/GeneralSections";
import PlanBadge from "@/components/uikit/PlanBadge/PlanBadge";
import Footer from "@/components/Footer";
import { useFeatureVisible } from "@/hooks/useFeature";
import SavedCaptions from "./components/SavedSections";
import {
  useOverlayDataStore,
  useOverlayUserStore,
} from "@/stores/OverlayStores";
import CaptionSections from "./components/OverlaySections";
import JapaneseCaptionSections from "./components/JapaneseCaptionSections";
import { useOverlayEditorStore } from "@/stores";
import { SonnerInfo } from "@/components/uikit/SonnerToast";
import NotesSection from "./components/NotesSection";
import MyWebPollModal from "@/features/FriendsContainer/WebPoll/MyWebPollModal";
import clsx from "clsx";

const ScreenCustomeStudio = () => {
  const { t } = useTranslation("features");
  const popupRef = useRef(null);
  const { navigation } = useApp();

  const { isFilterOpen, setIsFilterOpen } = navigation;
  const { userCaptions } = useOverlayUserStore();
  const sectionOverlays = useOverlayDataStore((s) => s.sectionOverlays);
  const refilterNow = useOverlayDataStore((s) => s.refilterNow);
  const fetchCaptionOverlays = useOverlayDataStore(
    (s) => s.fetchCaptionOverlays,
  );
  const startRealtimeRefresh = useOverlayDataStore(
    (s) => s.startRealtimeRefresh,
  );

  const updateOverlayEditor = useOverlayEditorStore(
    (s) => s.updateOverlayEditor,
  );
  const resetOverlayEditor = useOverlayEditorStore((s) => s.resetOverlayEditor);
  const [pollManagerOpen, setPollManagerOpen] = useState(false);

  const savedCaptionSection = sectionOverlays.find(
    (s) => s.section_id === "saved_caption",
  );

  const canShowSavedCaptions = savedCaptionSection?.active ?? false;

  const canUseCaptionGif = useFeatureVisible("caption_gif");
  const canUseCaptionIcon = useFeatureVisible("caption_icon");
  const canUseCaptionimage = useFeatureVisible("caption_image");

  useEffect(() => {
    document.body.style.overflow = isFilterOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isFilterOpen]);

  // Caption Season realtime: khi mở studio → refilter ngay + soft fetch
  useEffect(() => {
    if (!isFilterOpen) return;
    try {
      startRealtimeRefresh();
      refilterNow();
      // Silent refresh so match pills stay current without blocking UI
      fetchCaptionOverlays(true, { silent: true });
    } catch {
      /* ignore */
    }
  }, [isFilterOpen, refilterNow, fetchCaptionOverlays, startRealtimeRefresh]);

  const handleSelectCaption = (caption) => {
    resetOverlayEditor();

    // Strip picker-only VI / JP helper fields — never enter editor or Locket payload
    const {
      vi: _vi,
      vi_label: _viLabel,
      translation: _tr,
      viLabel: _viLabel2,
      romaji: _romaji,
      romaji_label: _romajiLabel,
      _jp_preset: _jpFlag,
      category: _cat,
      ja: _ja,
      ...safeCaption
    } = caption || {};

    const rawText =
      safeCaption?.text != null && String(safeCaption.text).trim() !== ""
        ? String(safeCaption.text)
        : safeCaption?.caption != null &&
            String(safeCaption.caption).trim() !== ""
          ? String(safeCaption.caption)
          : "";

    // Theme gợi ý (custom): text null → editable, caption trống để user gõ
    const isCustomTheme =
      safeCaption?.type === "custom" || safeCaption?.is_editable === true;

    // Decorative/template: giữ text API; custom: để trống (chỉ áp màu nền)
    // Japanese presets: text is already JA-only
    const text = isCustomTheme ? "" : rawText;

    updateOverlayEditor({
      ...safeCaption,
      overlay_id: safeCaption?.overlay_id || safeCaption?.id || "standard",
      text_color: safeCaption?.text_color || "#FFFFFF",
      text,
      caption: text,
      type: safeCaption?.type || "default",
      is_editable: isCustomTheme ? true : Boolean(safeCaption?.is_editable),
      color_top: safeCaption?.colortop || safeCaption?.color_top || "",
      color_bottom: safeCaption?.colorbottom || safeCaption?.color_bottom || "",
      // icon rỗng {} → bỏ để không vỡ UI
      icon:
        safeCaption?.icon && safeCaption.icon.type && safeCaption.icon.data
          ? safeCaption.icon
          : null,
    });

    setIsFilterOpen(false);
  };

  const handleUseWebPollCaption = (poll) => {
    if (!poll?.question) return;
    setPollManagerOpen(false);
    handleSelectCaption({
      overlay_id: "poll",
      background: { colors: ["#685AF7", "#685AF7"] },
      caption: poll.question,
      text: poll.question,
      type: "poll",
      text_color: "#FFFFFFF0",
      payload: {
        right_emoji: "👎",
        left_emoji: "👍",
        web_poll_id: poll.id || poll.pollId || poll.poll_id || null,
        question: poll.question,
      },
    });
  };

  return (
    <div
      className={clsx(
        "fixed inset-0 bg-base-100/10 backdrop-blur-[4px] transition-opacity duration-500 z-[62]",
        {
          "opacity-100": isFilterOpen,
          "opacity-0 pointer-events-none": !isFilterOpen,
        },
      )}
      onClick={() => setIsFilterOpen(false)}
    >
      {/* Popup */}
      <div
        ref={popupRef}
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "fixed border-t border-base-300 bottom-0 left-0 w-full h-2/3 bg-base-100 rounded-t-4xl shadow-lg transition-all duration-500 z-[63] flex flex-col text-base-content",
          {
            "translate-y-0 opacity-100": isFilterOpen,
            "translate-y-full opacity-0": !isFilterOpen,
          },
        )}
      >
        {/* Header - Ghim cố định */}
        <div className="flex justify-between rounded-t-4xl items-center py-2 px-4 bg-base-100 sticky top-0 left-0 right-0 z-50">
          <div className="flex items-center space-x-2 text-primary">
            <Palette size={22} />
            <div className="text-2xl font-lovehouse mt-1.5 font-semibold">
              Customize studio{" "}
            </div>
            <PlanBadge />
          </div>
          <button
            onClick={() => setIsFilterOpen(false)}
            className="text-primary cursor-pointer"
          >
            <X size={30} />
          </button>
        </div>
        {/* Nội dung - Cuộn được */}
        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Chung always first */}
          <GeneralThemes
            title={t("custom_studio.general_title")}
            onSelect={handleSelectCaption}
          />

          <div className="px-4">
            <button
              type="button"
              onClick={() => setPollManagerOpen(true)}
              className="flex w-full items-center gap-3 rounded-3xl border border-[#6956ff]/35 bg-[#6956ff]/10 px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-[#6956ff]/15 hover:shadow-md active:translate-y-0"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#6956ff] text-white shadow-sm">
                <Users size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-extrabold text-[#6956ff]">
                  Bình chọn & kết quả
                </span>
                <span className="mt-0.5 block text-xs text-base-content/55">
                  Tạo câu hỏi, xem tổng lượt và danh sách ai đã chọn 👍 / 👎
                </span>
              </span>
              <span className="rounded-full bg-[#6956ff] px-2.5 py-1 text-[10px] font-black text-white">
                XEM
              </span>
            </button>
          </div>

          {/* 🇯🇵 Caption Nhật Bản — right after Chung */}
          <JapaneseCaptionSections onSelect={handleSelectCaption} />

          <CaptionSections
            sections={sectionOverlays}
            onSelect={handleSelectCaption}
          />

          {canShowSavedCaptions && (
            <SavedCaptions
              title={t("custom_studio.kanade_caption_title")}
              captions={userCaptions}
              onSelect={handleSelectCaption}
            />
          )}
          {/* <FeatureGate canUse={canUseCaptionimage}>
            <ImageCaptionSelector title="🎨 Caption Ảnh - Truy cập sớm" />
          </FeatureGate> */}

          <NotesSection />
          <div className="bottom-0">
            <Footer />
          </div>
        </div>
      </div>

      <MyWebPollModal
        open={pollManagerOpen}
        onClose={() => setPollManagerOpen(false)}
        onUseCaption={handleUseWebPollCaption}
      />
    </div>
  );
};

export default ScreenCustomeStudio;
