import { useState } from "react";
import {
  ChevronDown,
  Download,
  Megaphone,
  Menu,
  MessageCircle,
  UsersRound,
} from "lucide-react";
import HistorySelectFriend from "@/features/HistorySelectFriend";
import { useAuthStore, useFriendList } from "@/stores";
import { useAppNavigation } from "@/context/AppContext";
import { downloadBlob } from "@/services";
import { useTranslation } from "react-i18next";
import { useAutoDriveBackup } from "@/hooks/useAutoDriveBackup";
import AppUpdateButton from "@/components/AppUpdateButton";
import GlobalNotificationCenter from "@/components/GlobalNotificationCenter";
import { SonnerInfo, SonnerWarning } from "@/components/uikit/SonnerToast";

/**
 * The capture preview is a square with object-cover/object-center. Export images
 * with the same centre crop so Download matches exactly what the user sees.
 * Keep the largest possible square (min source dimension) to avoid upscaling.
 */
async function cropImageToPreviewSquare(blob) {
  if (!blob || typeof document === "undefined") return blob;

  let image = null;
  let objectUrl = "";

  try {
    if (typeof createImageBitmap === "function") {
      try {
        image = await createImageBitmap(blob);
      } catch {
        // Safari/older browsers: fall back to HTMLImageElement below.
      }
    }

    if (!image) {
      objectUrl = URL.createObjectURL(blob);
      image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("image load failed"));
        img.src = objectUrl;
      });
    }

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) return blob;

    const side = Math.min(width, height);
    const sourceX = (width - side) / 2;
    const sourceY = (height - side) / 2;

    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      side,
      side,
      0,
      0,
      side,
      side,
    );

    const square = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (out) =>
          out ? resolve(out) : reject(new Error("square crop toBlob failed")),
        "image/jpeg",
        0.96,
      );
    });
    return square || blob;
  } catch (error) {
    console.warn(
      "[download] square preview crop failed, using original:",
      error?.message || error,
    );
    return blob;
  } finally {
    if (typeof image?.close === "function") {
      try {
        image.close();
      } catch {
        /* ignore */
      }
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

const HeaderHome = ({
  setIsHomeOpen,
  setIsProfileOpen,
  setFriendsTabOpen,
  setIsSidebarOpen,
  isBottomOpen,
  setFriendHistoryOpen,
  isFriendHistoryOpen,
  selectedFile,
}) => {
  const { t } = useTranslation("main");
  const { user } = useAuthStore();
  const { isSidebarOpen } = useAppNavigation();

  const friendList = useFriendList();

  // Backup Drive ngầm sau khi chụp (mọi user — Drive admin; nút quản lý chỉ trong menu admin)
  useAutoDriveBackup(selectedFile);

  const [isImageLoaded, setIsImageLoaded] = useState(false);

  const [isVisible, setIsVisible] = useState(false);
  const [friendName, setFriendName] = useState("Mọi người");

  const toggleDropdown = () => {
    // Nếu bottom đang mở → dùng animation logic
    if (isBottomOpen) {
      if (!isVisible) {
        // Mở dropdown
        setIsVisible(true);
        setTimeout(() => setFriendHistoryOpen(true), 10);
      } else {
        // Đóng dropdown
        setFriendHistoryOpen(false);
        setTimeout(() => setIsVisible(false), 500);
      }
      return;
    }

    // Nếu bottom đang đóng → mở tab bạn bè
    setFriendsTabOpen(true);
  };
  const handleDownload = async () => {
    if (!selectedFile) return;

    try {
      SonnerInfo(t("home.preparing_download", { defaultValue: "Đang tải…" }));
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      let file = selectedFile;
      let fileName = `huylocket-${timestamp}.jpg`;

      // Ảnh tải về phải khớp khung preview vuông 1:1 (object-cover/object-center).
      // Crop trước, sau đó mới thêm watermark để watermark cũng nằm trong ảnh vuông.
      if (String(selectedFile.type || "").startsWith("image/")) {
        const {
          applyLocketStyleWatermark,
          ensureJpegFileName,
          isSaveWatermarkEnabled,
        } = await import("@/utils/imageUtils/applyWatermark");

        file = await cropImageToPreviewSquare(selectedFile);
        if (isSaveWatermarkEnabled()) {
          file = await applyLocketStyleWatermark(file, {
            forceImage: true,
          });
        }
        fileName = ensureJpegFileName(`huylocket-${timestamp}.jpg`);
      } else {
        const extension = selectedFile.type?.split("/")[1] || "mp4";
        fileName = `huylocket-${timestamp}.${extension}`;
      }

      // Tải thẳng về máy — không mở share sheet
      downloadBlob(file, fileName);
    } catch (err) {
      console.error("❌ Download error:", err);
      SonnerWarning(
        t("home.download_error", { defaultValue: "Không tải được ảnh" }),
      );
    }
  };

  return (
    <>
      {selectedFile && (
        <div
          data-locket-header="true"
          className="fixed top-0 left-0 w-full px-2 pt-1 flex items-center justify-between z-50"
        >
          <div></div>
          <div className="absolute flex justify-center items-center flex-row gap-1 left-1/2 transform -translate-x-1/2 text-xl font-semibold text-base-content">
            {t("home.send_to")}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleDownload}
              className="w-11 h-11 flex items-center justify-center hover:bg-base-300 rounded-full transition"
            >
              <Download size={28} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}
      {!selectedFile && (
        <div
          data-locket-header="true"
          className="fixed top-0 left-0 w-full px-2 pt-1 flex items-center justify-between z-50"
        >
          {/* Avatar hồ sơ + nút cập nhật tròn (luôn hiện — bấm hoặc vào lại web tự update) */}
          <div data-header-left="true" className="flex items-center gap-2">
            <button
              data-header-profile="true"
              onClick={() => setIsProfileOpen(true)}
              className="relative flex items-center justify-center w-11 h-11 cursor-pointer active:scale-105"
            >
              <div className="bg-base-300/70 backdrop-blur-[4px] w-11.5 h-11.5 rounded-full absolute" />

              {!isImageLoaded && (
                <div className="absolute w-5 h-5 border-t-transparent border-white rounded-full animate-spin" />
              )}

              <img
                src={user?.profilePicture || "/images/default_profile.png"}
                alt="avatar"
                onLoad={() => setIsImageLoaded(true)}
                onError={(e) => {
                  e.currentTarget.src = "/images/default_profile.png";
                }}
                className={`rounded-full h-9.5 w-9.5 relative backdrop-blur-3xl transition-opacity duration-300 ${
                  isImageLoaded ? "opacity-100" : "opacity-0 bg-base-300"
                }`}
              />
            </button>
            <div data-header-update="true">
              <AppUpdateButton />
            </div>
          </div>

          <button
            type="button"
            data-friends-pill="true"
            className="absolute flex z-90 transition-all justify-center items-center flex-row gap-1 left-1/2 
          -translate-x-1/2 text-lg font-semibold bg-base-300/70 backdrop-blur-[4px] 
          hover:bg-base-300 px-3 py-2 rounded-3xl select-none"
            onClick={toggleDropdown}
          >
            {isBottomOpen ? (
              <>
                <span>{friendName === "Mọi người" ? t("home.everyone") : friendName}</span>
                <ChevronDown
                  className={`ml-1 w-5 h-5 transition-transform ${
                    isFriendHistoryOpen ? "rotate-180" : ""
                  }`}
                  strokeWidth={3}
                />
              </>
            ) : (
              <>
                <span data-friends-desktop-content="true" className="flex items-center gap-1">
                  <svg
                    className="w-6 h-6"
                    aria-hidden="true"
                    xmlns="http://www.w3.org/2000/svg"
                    width="24"
                    height="24"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12 6a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm-1.5 8a4 4 0 0 0-4 4 2 2 0 0 0 2 2h7a2 2 0 0 0 2-2 4 4 0 0 0-4-4h-3Zm6.82-3.096a5.51 5.51 0 0 0-2.797-6.293 3.5 3.5 0 1 1 2.796 6.292ZM19.5 18h.5a2 2 0 0 0 2-2 4 4 0 0 0-4-4h-1.1a5.503 5.503 0 0 1-.471.762A5.998 5.998 0 0 1 19.5 18ZM4 7.5a3.5 3.5 0 0 1 5.477-2.889 5.5 5.5 0 0 0-2.796 6.293A3.501 3.501 0 0 1 4 7.5ZM7.1 12H6a4 4 0 0 0-4 4 2 2 0 0 0 2 2h.5a5.998 5.998 0 0 1 3.071-5.238A5.505 5.505 0 0 1 7.1 12Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t("home.friends_count", {
                    count: friendList.length || 0,
                  })}
                </span>
                <span data-friends-mobile-content="true" className="hidden items-center gap-1">
                  {t("home.friends", { defaultValue: "Bạn" })}
                  <ChevronDown className="w-5 h-5" strokeWidth={3} />
                </span>
                <span data-friends-ios-content="true" className="hidden items-center gap-2">
                  <UsersRound className="h-6 w-6" strokeWidth={2.8} />
                  <span>
                    {friendList.length === 1
                      ? "1 người bạn"
                      : `${friendList.length || 0} người bạn`}
                  </span>
                </span>
              </>
            )}
          </button>

          {/* Nút bên phải — Drive admin chỉ trong Sidebar menu, không hiện nút vàng ở đây */}
          <div data-header-right="true" className="flex items-center gap-3">
            <button
              data-header-chat="true"
              onClick={() => setIsHomeOpen(true)}
              className="w-11 h-11 flex items-center justify-center bg-base-300/70 backdrop-blur-[4px] rounded-full hover:bg-base-300 transition active:scale-105"
            >
              <MessageCircle strokeWidth={2} />
            </button>
            <div
              data-header-notifications="true"
              className="w-11 h-11 [&>button]:w-11 [&>button]:h-11 [&>button]:min-h-0 [&>button]:bg-base-300/70 [&>button]:backdrop-blur-[4px] [&>button]:rounded-full [&>button]:hover:bg-base-300 [&>button]:transition [&>button]:active:scale-105"
            >
              <GlobalNotificationCenter />
            </div>
            <button
              type="button"
              id="hamburger-menu-trigger"
              aria-label="Toggle navigation menu"
              aria-expanded={isSidebarOpen}
              aria-controls="huy-locket-nav-drawer"
              onClick={() => setIsSidebarOpen(true)}
              className="w-11 h-11 flex items-center justify-center bg-base-300/70 backdrop-blur-[4px] rounded-full hover:bg-base-300 transition active:scale-105"
            >
              <Menu
                className="iosHeaderDefaultIcon"
                size={28}
                strokeWidth={2}
                aria-hidden="true"
              />
              <Megaphone
                className="iosHeaderMegaphoneIcon"
                size={27}
                strokeWidth={2.35}
                aria-hidden="true"
              />
            </button>
          </div>

          <HistorySelectFriend
            isVisible={isVisible}
            setIsVisible={setIsVisible}
            setFriendName={setFriendName}
            onClick={toggleDropdown}
          />
        </div>
      )}
    </>
  );
};

export default HeaderHome;