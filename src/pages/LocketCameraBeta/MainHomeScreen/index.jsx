import React, { lazy, Suspense } from "react";
import { Home, LayoutGrid, MessageCircle } from "lucide-react";
import { useAppNavigation } from "@/context/AppContext";

import HeaderHome from "./Layout/HeaderHome";
import BottomMenu from "../BottomHomeScreen/Layout/BottomMenu";
import HistoryArrow from "./Layout/HistoryButton";
import ActionControls from "./ActionControls";
import MediaPreview from "./Layout/MediaPreview";
import { usePostStore, useMomentDraftStore } from "@/stores";
import clsx from "clsx";
import DragDropOverlay from "@/components/animations/DragDropOverlay";
import { SonnerInfo } from "@/components/uikit/SonnerToast";
import { useTranslation } from "react-i18next";
import { useAppCamera } from "@/context/AppContext";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import "./mobileLocket.css";
import "./iosLocketV2.css";

const BottomHomeScreen = lazy(() => import("../BottomHomeScreen"));
const SelectFriendsList = lazy(() => import("./Layout/SelectFriends"));

export default function MainHomeScreen() {
  const {
    isHomeOpen,
    isProfileOpen,
    isBottomOpen,
    setIsHomeOpen,
    setIsProfileOpen,
    setIsBottomOpen,
    setFriendsTabOpen,
    setIsSidebarOpen,
    setOptionModalOpen,
    isFriendHistoryOpen,
    setFriendHistoryOpen,
  } = useAppNavigation();
  const selectedFile = usePostStore((s) => s.selectedFile);
  const preview = usePostStore((s) => s.preview);
  const hasCaptured = !!(selectedFile || preview);

  // --- Keyboard Shortcuts logic ---
  useKeyboardShortcuts();

  // --- Drag & Drop logic ---
  const [isDragging, setIsDragging] = React.useState(false);
  const dragCounter = React.useRef(0);
  const { t } = useTranslation("main");
  const camera = useAppCamera();

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const rawFile = e.dataTransfer.files?.[0];
    if (!rawFile) return;

    if (camera?.setCameraActive) {
      camera.setCameraActive(false);
    }

    const fileType = rawFile.type.startsWith("image/")
      ? "image"
      : rawFile.type.startsWith("video/")
        ? "video"
        : null;

    if (!fileType) {
      SonnerInfo(t("home.only_media_supported_short", { defaultValue: "Định dạng không được hỗ trợ" }));
      return;
    }

    const proceed = await useMomentDraftStore.getState().requestReplaceOrContinue(rawFile);
    if (!proceed) return;

    usePostStore.getState().resetMedia();

    if (fileType === "image") {
      usePostStore.getState().setImageToCrop(rawFile);
      return;
    }
    if (fileType === "video") {
      usePostStore.getState().setVideoToCrop(rawFile);
      return;
    }
    await useMomentDraftStore.getState().applyNewMediaFile(rawFile);
  };

  return (
    <>
      <DragDropOverlay isDragging={isDragging} />
      <div
        data-locket-home="true"
        className={clsx(
          "relative transition-all duration-500 flex flex-col justify-center items-center w-full h-[100vh] text-base-content",
          {
            "translate-x-full": isProfileOpen,
            "-translate-x-full": !isProfileOpen && isHomeOpen,
            "translate-x-0": !isProfileOpen && !isHomeOpen,
          },
        )}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <HeaderHome
          setIsHomeOpen={setIsHomeOpen}
          setIsProfileOpen={setIsProfileOpen}
          setFriendsTabOpen={setFriendsTabOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          isBottomOpen={isBottomOpen}
          setFriendHistoryOpen={setFriendHistoryOpen}
          isFriendHistoryOpen={isFriendHistoryOpen}
          selectedFile={selectedFile}
        />
        <div
          className={clsx(
            "w-full h-full flex flex-1 flex-col transition-all duration-500 justify-center items-center",
            {
              "translate-x-0": isBottomOpen,
              "fixed translate-y-full": !isBottomOpen,
            },
          )}
        >
          <div data-ios-history-scroll="true" className="w-full h-full overflow-y-auto">
            <div data-ios-history-spacer="true" className="h-16" />
            <Suspense fallback={null}>
              <BottomHomeScreen />
            </Suspense>
          </div>
          <BottomMenu
            setIsBottomOpen={setIsBottomOpen}
            setOptionModalOpen={setOptionModalOpen}
            setIsProfileOpen={setIsProfileOpen}
            setIsHomeOpen={setIsHomeOpen}
          />
        </div>
        <div
          data-capture-stack="true"
          className={clsx(
            "w-full h-full flex flex-col transition-all duration-500 justify-evenly items-center",
            {
              "translate-x-0": !isBottomOpen,
              "fixed -translate-y-full": isBottomOpen,
            },
          )}
        >
          <div data-capture-spacer="true" className="h-10" />
          <div data-media-preview-shell="true" className="w-full max-w-md px-2">
            <MediaPreview />
          </div>
          <ActionControls />
          <div data-history-region="true" className="relative w-full">
            <div
              className={clsx("transition-all duration-300", {
                "opacity-0 invisible hidden": !hasCaptured,
                "opacity-100 visible": hasCaptured,
              })}
            >
              <Suspense fallback={null}>
                <SelectFriendsList />
              </Suspense>
            </div>

            {/* Chỉ Lịch sử — không nút calendar cạnh đó */}
            <div
              className={clsx("transition-all duration-300", {
                "opacity-0 invisible hidden": hasCaptured,
                "opacity-100 visible": !hasCaptured,
              })}
            >
              <HistoryArrow setIsBottomOpen={setIsBottomOpen} />
            </div>
          </div>

          {!hasCaptured && !isBottomOpen && (
            <nav className="iosCameraBottomNav" aria-label="Điều hướng camera iOS">
              <button
                type="button"
                className="iosCameraNavButton"
                aria-label={t("bottom.back_to_grid", {
                  defaultValue: "Mở lịch sử",
                })}
                onClick={() => setIsBottomOpen(true)}
              >
                <LayoutGrid aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iosCameraNavButton is-active"
                aria-label={t("bottom.return_home", {
                  defaultValue: "Camera",
                })}
              >
                <Home aria-hidden="true" />
              </button>
              <button
                type="button"
                className="iosCameraNavButton"
                aria-label="Tin nhắn"
                onClick={() => setIsHomeOpen(true)}
              >
                <MessageCircle aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      </div>
    </>
  );
}
