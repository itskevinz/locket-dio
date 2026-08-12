import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCroppedImg, getFileSizeMB } from "@/utils";
import { prepareImageForCrop } from "@/utils/process/PrsImage/prepareImageForCrop";
import clsx from "clsx";
import { usePostStore } from "@/stores";
import { convertImageToBlob } from "@/services";
import CropCanvas from "./CropCanvas";
import CropFooter from "./CropFooter";
import { SonnerError, SonnerInfo } from "@/components/uikit/SonnerToast";

/**
 * Crop Image Studio — luôn chuẩn hóa ảnh client-side trước khi crop
 * để tránh màn xám / nút Cắt bị khóa trên mobile.
 */
const CropImageStudio = () => {
  const { t } = useTranslation("features");
  const setMediaFromFile = usePostStore((s) => s.setMediaFromFile);
  const imageToCrop = usePostStore((s) => s.imageToCrop);
  const setImageToCrop = usePostStore((s) => s.setImageToCrop);

  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [cropError, setCropError] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  /** File JPEG đã chuẩn hóa (hiển thị + crop) */
  const [workFile, setWorkFile] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [converting, setConverting] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const [cropping, setCropping] = useState(false);

  const prepareGen = useRef(0);
  const urlRef = useRef(null);

  const revokeUrl = useCallback(() => {
    if (urlRef.current) {
      try {
        URL.revokeObjectURL(urlRef.current);
      } catch {
        /* ignore */
      }
      urlRef.current = null;
    }
  }, []);

  const applyWorkFile = useCallback(
    (file) => {
      revokeUrl();
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      setWorkFile(file);
      setImageUrl(url);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setMinZoom(1);
      setCroppedAreaPixels(null);
      setMediaReady(false);
      setCropError("");
    },
    [revokeUrl],
  );

  // Chuẩn hóa ảnh khi mở studio
  useEffect(() => {
    if (!imageToCrop) {
      prepareGen.current += 1;
      revokeUrl();
      setWorkFile(null);
      setImageUrl(null);
      setPreparing(false);
      setMediaReady(false);
      setCropError("");
      return;
    }

    const gen = ++prepareGen.current;
    let cancelled = false;

    (async () => {
      setPreparing(true);
      setCropError("");
      setMediaReady(false);
      revokeUrl();
      setWorkFile(null);
      setImageUrl(null);

      try {
        // 1) Nhận dạng + auto-orient + chuyển JPEG hoàn toàn ở client.
        const prepared = await prepareImageForCrop(imageToCrop, {
          maxEdge: 2048,
        });
        if (cancelled || gen !== prepareGen.current) return;
        applyWorkFile(prepared);
      } catch (localErr) {
        console.warn("[crop] local prepare failed:", localErr);

        // 2) Remote convert là fallback cuối cho container ít gặp.
        try {
          const blob = await convertImageToBlob(imageToCrop);
          if (cancelled || gen !== prepareGen.current) return;
          const file = new File(
            [blob],
            (imageToCrop.name || "image").replace(/\.[^.]+$/, ".jpg"),
            { type: blob.type || "image/jpeg", lastModified: Date.now() },
          );
          file.__converted = true;
          file.__prepared = true;
          const again = await prepareImageForCrop(file);
          if (cancelled || gen !== prepareGen.current) return;
          applyWorkFile(again);
        } catch (remoteErr) {
          console.error("[crop] remote convert failed:", remoteErr);
          if (cancelled || gen !== prepareGen.current) return;
          setCropError(
            t("crop_image.crop_failed_detail", {
              error:
                localErr?.message ||
                "Không đọc được ảnh. Hãy chọn một ảnh điện thoại hợp lệ khác.",
            }),
          );
        }
      } finally {
        if (!cancelled && gen === prepareGen.current) {
          setPreparing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [imageToCrop, applyWorkFile, revokeUrl, t]);

  // Cleanup URL on unmount
  useEffect(() => () => revokeUrl(), [revokeUrl]);

  // Timeout nếu cropper không fire onMediaLoaded
  useEffect(() => {
    if (!imageUrl || preparing || mediaReady) return;
    const t = setTimeout(() => {
      if (!mediaReady) {
        // Vẫn cho phép crop nếu có pixels sau
        setMediaReady(true);
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [imageUrl, preparing, mediaReady]);

  const handleConvertImage = async () => {
    const src = workFile || imageToCrop;
    if (!src) return;
    try {
      setConverting(true);
      setCropError("");
      // Local re-encode trước
      try {
        const prepared = await prepareImageForCrop(src, { maxEdge: 1920 });
        applyWorkFile(prepared);
        SonnerInfo("Đã chuyển sang JPEG");
        return;
      } catch {
        /* remote */
      }
      const blob = await convertImageToBlob(src);
      const file = new File(
        [blob],
        (src.name || "image").replace(/\.[^.]+$/, ".jpg"),
        { type: blob.type || "image/jpeg", lastModified: Date.now() },
      );
      file.__converted = true;
      try {
        applyWorkFile(await prepareImageForCrop(file));
      } catch {
        applyWorkFile(file);
      }
      SonnerInfo("Đã chuyển đổi ảnh");
    } catch (err) {
      console.error(err);
      SonnerError("Chuyển đổi thất bại", err?.message || "");
      setCropError(t("crop_image.crop_failed_default"));
    } finally {
      setConverting(false);
    }
  };

  const handleCropConfirm = useCallback(async () => {
    const file = workFile;
    if (!file) return;

    // Nếu chưa có vùng crop — dùng full ảnh (square center sau)
    let area = croppedAreaPixels;
    if (!area) {
      SonnerInfo("Đang chuẩn bị vùng cắt…");
      return;
    }

    try {
      setCropping(true);
      setCropError("");
      const croppedFile = await getCroppedImg(file, area);
      if (!croppedFile) throw new Error("Crop empty");
      setMediaFromFile(croppedFile);
      setImageToCrop(null);
    } catch (e) {
      console.error("Crop failed", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object"
            ? JSON.stringify(e)
            : String(e);
      setCropError(t("crop_image.crop_failed_detail", { error: msg }));
      SonnerError("Cắt ảnh thất bại", msg);
    } finally {
      setCropping(false);
    }
  }, [
    croppedAreaPixels,
    workFile,
    setMediaFromFile,
    setImageToCrop,
    t,
  ]);

  useEffect(() => {
    if (imageToCrop) {
      setShowCropper(true);
    } else {
      const timer = setTimeout(() => setShowCropper(false), 280);
      return () => clearTimeout(timer);
    }
  }, [imageToCrop]);

  useEffect(() => {
    document.body.style.overflow = imageToCrop ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [imageToCrop]);

  const displayFile = workFile;
  const fileName = displayFile?.name;
  const fileType = displayFile?.type;
  const fileSizeMB = getFileSizeMB(displayFile);
  const fileExt = displayFile?.name?.split(".").pop()?.toLowerCase();

  const busy = preparing || converting || cropping;
  const cropDisabled =
    busy || !imageUrl || !mediaReady || !croppedAreaPixels;

  const handleSkipCrop = () => {
    const file = workFile;
    if (!file) return;
    setMediaFromFile(file);
    setImageToCrop(null);
  };

  if (!showCropper) return null;

  return (
    <div
      className={clsx(
        "fixed flex flex-col inset-0 z-50 bg-base-100/40 backdrop-blur-xl transition-all duration-300 ease-out overflow-hidden",
        {
          "opacity-100": imageToCrop,
          "opacity-0 pointer-events-none": !imageToCrop,
        },
      )}
    >
      <CropCanvas
        converting={preparing || converting}
        imageUrl={imageUrl}
        crop={crop}
        zoom={zoom}
        minZoom={minZoom}
        setCrop={setCrop}
        setZoom={setZoom}
        setMinZoom={setMinZoom}
        setCroppedAreaPixels={setCroppedAreaPixels}
        onMediaReady={() => setMediaReady(true)}
        onMediaError={() => {
          setMediaReady(false);
          setCropError(
            "Ảnh không hiển thị. Bấm Chuyển đổi hoặc chọn ảnh JPG/PNG khác.",
          );
        }}
      />

      <CropFooter
        imageToCrop={displayFile}
        needConvert={!mediaReady || Boolean(cropError)}
        converting={preparing || converting}
        cropDisabled={cropDisabled}
        cropping={cropping}
        cropError={cropError}
        fileName={fileName}
        fileType={fileType}
        fileExt={fileExt}
        fileSizeMB={fileSizeMB}
        onCancel={() => setImageToCrop(null)}
        onConvert={handleConvertImage}
        onCrop={handleCropConfirm}
        canSkipCrop={Boolean(workFile) && !preparing}
        onSkip={handleSkipCrop}
      />
    </div>
  );
};

export default CropImageStudio;
