import "./styles.css";
import React, { useEffect, useRef } from "react";
import { useAppCamera } from "@/context/AppContext";
import { getVideoRecordLimit } from "@/hooks/useFeature";
import { CAMERA_CONFIG } from "@/config/configAlias";
import { SonnerInfo } from "@/components/uikit/SonnerToast";
import { usePostStore } from "@/stores";
import { useTranslation } from "react-i18next";
import { getPerfProfile } from "@/utils/device/perfProfile";
import { captureSharpSquarePhoto } from "@/utils/device/capturePhoto";
import { createInstantShutterPreview } from "@/utils/device/instantShutterPreview";

/** Giữ nhẹ để quay — đủ phân biệt tap chụp vs hold quay */
const HOLD_TO_RECORD_MS = 300;

let cachedMime = null;
function pickMimeType() {
  if (cachedMime !== null) return cachedMime;
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
    "video/webm;codecs=vp9",
  ];
  for (const t of candidates) {
    try {
      if (
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t)
      ) {
        cachedMime = t;
        return t;
      }
    } catch {
      /* ignore */
    }
  }
  cachedMime = "";
  return "";
}

/**
 * Profile quay — ưu tiên mượt (30fps canvas) hơn 60fps nặng.
 */
function recordProfile() {
  const p = getPerfProfile();
  const imgTarget = CAMERA_CONFIG.imageSizePx || 1920;
  const vidTarget = CAMERA_CONFIG.videoResolutionPx || 1080;

  if (p.isLowEnd) {
    return {
      size: Math.min(vidTarget, 720),
      maxSize: 720,
      fps: 24,
      bitrate: 2_800_000,
      jpegQ: 0.9,
      captureSize: Math.min(imgTarget, 1280),
      maxCapture: 1440,
    };
  }
  if (p.isAndroid || p.isMobile || p.isIOS) {
    return {
      size: Math.min(vidTarget, 1080),
      maxSize: 1080,
      fps: 30,
      bitrate: 5_000_000,
      jpegQ: 0.92,
      captureSize: Math.min(imgTarget, 1920),
      maxCapture: 1920,
    };
  }
  return {
    size: Math.min(vidTarget, 1080),
    maxSize: 1080,
    fps: 30,
    bitrate: 7_000_000,
    jpegQ: 0.93,
    captureSize: imgTarget,
    maxCapture: 2560,
  };
}

const CameraButton = () => {
  const { t } = useTranslation("main");
  const camera = useAppCamera();
  const {
    videoRef,
    isHolding,
    setIsHolding,
    setHoldTime,
    cameraMode,
    setCameraActive,
    setLoading,
  } = camera;

  const setMediaFromFile = usePostStore((s) => s.setMediaFromFile);
  // Dynamic import store to avoid circular deps at module init
  const applyMedia = async (file) => {
    try {
      const { useMomentDraftStore } = await import("@/stores");
      const ok = await useMomentDraftStore
        .getState()
        .applyNewMediaFile(file);
      if (!ok) return false;
      setCameraActive(false);
      return true;
    } catch {
      setMediaFromFile(file);
      setCameraActive(false);
      return true;
    }
  };

  const holdStartTimeRef = useRef(null);
  const holdTimeoutRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const isTryingToRecordRef = useRef(false);
  const isRecordingRef = useRef(false);
  const drawRafRef = useRef(0);
  const capturingRef = useRef(false);
  const captureFinalizedRef = useRef(false);
  const canvasRef = useRef(null);
  const pointerIdRef = useRef(null);

  const MAX_RECORD_TIME = getVideoRecordLimit();

  const startHold = (e) => {
    // pointer events: 1 path cho touch + mouse
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    if (capturingRef.current || isRecordingRef.current) return;

    try {
      e.currentTarget?.setPointerCapture?.(e.pointerId);
      pointerIdRef.current = e.pointerId;
    } catch {
      /* ignore */
    }

    isTryingToRecordRef.current = true;
    isRecordingRef.current = false;
    holdStartTimeRef.current = Date.now();

    holdTimeoutRef.current = setTimeout(() => {
      if (!isTryingToRecordRef.current) return;
      beginVideoRecord();
    }, HOLD_TO_RECORD_MS);
  };

  const beginVideoRecord = () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      SonnerInfo(t("home.camera_not_ready"));
      isTryingToRecordRef.current = false;
      setIsHolding(false);
      return;
    }

    isRecordingRef.current = true;
    setIsHolding(true);

    // Haptic nhẹ khi bắt đầu quay (nếu có)
    try {
      navigator.vibrate?.(12);
    } catch {
      /* ignore */
    }

    const prof = recordProfile();
    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 720;
    const side = Math.min(vw, vh);
    const outputSize = Math.min(side, prof.maxSize || prof.size || 1080);

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvasRef.current = canvas;
    }
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d", {
      alpha: false,
      desynchronized: true,
      willReadFrequently: false,
    });
    if (!ctx) {
      isRecordingRef.current = false;
      setIsHolding(false);
      return;
    }
    // medium = mượt hơn high trên mobile GPU
    ctx.imageSmoothingEnabled = outputSize < side;
    ctx.imageSmoothingQuality = "medium";

    const canvasStream = canvas.captureStream(prof.fps);
    const mimeType = pickMimeType();
    const recorderOptions = {};
    if (mimeType) {
      recorderOptions.mimeType = mimeType;
      recorderOptions.videoBitsPerSecond = prof.bitrate;
    }

    let recorder;
    try {
      recorder = new MediaRecorder(canvasStream, recorderOptions);
    } catch {
      try {
        recorder = new MediaRecorder(canvasStream);
      } catch (err) {
        console.error("MediaRecorder fail", err);
        isRecordingRef.current = false;
        setIsHolding(false);
        SonnerInfo(t("home.camera_not_ready"));
        return;
      }
    }
    mediaRecorderRef.current = recorder;

    const chunks = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data?.size > 0) chunks.push(ev.data);
    };

    recorder.onstop = () => {
      if (drawRafRef.current) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = 0;
      }
      try {
        canvasStream.getTracks().forEach((tr) => tr.stop());
      } catch {
        /* ignore */
      }

      if (!chunks.length) {
        isRecordingRef.current = false;
        setIsHolding(false);
        return;
      }

      const finalMime = recorder.mimeType || mimeType || "video/webm";
      const ext = finalMime.includes("mp4") ? "mp4" : "webm";
      const blob = new Blob(chunks, { type: finalMime });
      const file = new File([blob], `locket_dio.${ext}`, { type: finalMime });

      void applyMedia(file);
      setLoading?.(false);
      isRecordingRef.current = false;
      setIsHolding(false);
    };

    recorder.onerror = () => {
      isRecordingRef.current = false;
      setIsHolding(false);
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    };

    try {
      recorder.start(200);
    } catch {
      try {
        recorder.start();
      } catch {
        isRecordingRef.current = false;
        setIsHolding(false);
        return;
      }
    }

    const frameInterval = 1000 / prof.fps;
    let lastFrame = 0;
    const isFront = cameraMode === "user";
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    const drawFrame = (ts) => {
      if (recorder.state !== "recording") return;
      if (ts - lastFrame < frameInterval - 2) {
        drawRafRef.current = requestAnimationFrame(drawFrame);
        return;
      }
      lastFrame = ts;

      if (video.readyState >= 2) {
        if (isFront) {
          ctx.setTransform(-1, 0, 0, 1, outputSize, 0);
        } else {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        ctx.drawImage(
          video,
          sx,
          sy,
          side,
          side,
          0,
          0,
          outputSize,
          outputSize,
        );
      }
      drawRafRef.current = requestAnimationFrame(drawFrame);
    };
    drawRafRef.current = requestAnimationFrame(drawFrame);

    setTimeout(() => {
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
    }, MAX_RECORD_TIME * 1000);
  };

  const endHold = (e) => {
    if (e?.preventDefault) e.preventDefault();

    try {
      if (pointerIdRef.current != null) {
        e?.currentTarget?.releasePointerCapture?.(pointerIdRef.current);
      }
    } catch {
      /* ignore */
    }
    pointerIdRef.current = null;

    if (!isTryingToRecordRef.current && !isRecordingRef.current) {
      return;
    }

    const heldTime = Date.now() - (holdStartTimeRef.current || Date.now());
    clearTimeout(holdTimeoutRef.current);
    setHoldTime(heldTime);

    const wasTrying = isTryingToRecordRef.current;
    isTryingToRecordRef.current = false;
    holdStartTimeRef.current = null;

    // Đang quay → stop
    if (
      isRecordingRef.current &&
      mediaRecorderRef.current?.state === "recording"
    ) {
      try {
        mediaRecorderRef.current.requestData?.();
      } catch {
        /* ignore */
      }
      try {
        mediaRecorderRef.current.stop();
      } catch {
        /* ignore */
      }
      return;
    }

    if (isHolding && !isRecordingRef.current) {
      setIsHolding(false);
      return;
    }

    const isCancel =
      e?.type === "pointercancel" ||
      e?.type === "pointerleave" ||
      e?.type === "lostpointercapture";
    if (isCancel) {
      setIsHolding(false);
      return;
    }

    // Tap ngắn → chụp ngay
    if (wasTrying && !isRecordingRef.current) {
      captureImage();
    }
  };

  /**
   * Chụp nhanh về cảm giác nhưng vẫn giữ ảnh cuối ở chất lượng native.
   * Một frozen preview 512px chỉ dùng để phản hồi UI; file upload vẫn đi qua
   * ImageCapture.takePhoto()/grabFrame pipeline chất lượng cao.
   */
  const captureImage = () => {
    if (capturingRef.current) return;
    const video = videoRef.current;
    if (!video) return;

    if (!video.videoWidth || video.readyState < 2) {
      const track = video.srcObject?.getVideoTracks?.()?.[0];
      if (!track || track.readyState !== "live") {
        SonnerInfo(t("home.camera_not_ready"));
        return;
      }
    }

    capturingRef.current = true;
    captureFinalizedRef.current = false;
    const mirror = cameraMode === "user";

    // Feedback tức thì
    try {
      navigator.vibrate?.(8);
    } catch {
      /* ignore */
    }

    // Start the high-quality still FIRST so Android's camera HAL receives the
    // shutter request before React swaps the live <video> for a frozen preview.
    const fullQualityCapture = captureSharpSquarePhoto(video, { mirror });

    // In parallel, freeze the exact visible frame at tiny UI-only resolution.
    // This normally appears within one paint instead of waiting for takePhoto().
    void createInstantShutterPreview(video, { mirror }).then((url) => {
      if (!url) return;
      if (!capturingRef.current || captureFinalizedRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
        return;
      }

      usePostStore.setState({
        preview: { type: "image", data: url, capturePending: true },
        selectedFile: null,
        isSizeMedia: null,
      });
      // Preview mode parks (does not stop) the live track, so the native still
      // request already in flight can finish without keeping the user waiting.
      setCameraActive(false);
    });

    fullQualityCapture
      .then(async ({ file, blob, method }) => {
        captureFinalizedRef.current = true;

        if (import.meta.env?.DEV) {
          console.info("[capture]", method, file?.size);
        }

        // Replace the tiny provisional frame with the real still immediately;
        // draft/IndexedDB work can then finish without delaying the visual shot.
        try {
          const currentPreview = usePostStore.getState().preview;
          const finalUrl = URL.createObjectURL(blob);
          if (
            currentPreview?.capturePending &&
            typeof currentPreview.data === "string" &&
            currentPreview.data.startsWith("blob:")
          ) {
            try {
              URL.revokeObjectURL(currentPreview.data);
            } catch {
              /* ignore */
            }
          }
          usePostStore.setState({
            preview: { type: "image", data: finalUrl, capturePending: true },
            selectedFile: null,
            isSizeMedia: null,
          });
          setCameraActive(false);
        } catch {
          /* applyMedia below still owns the final file */
        }

        return applyMedia(file);
      })
      .catch((err) => {
        captureFinalizedRef.current = true;
        console.warn("[capture] failed:", err?.message || err);

        const currentPreview = usePostStore.getState().preview;
        if (currentPreview?.capturePending) {
          try {
            if (
              typeof currentPreview.data === "string" &&
              currentPreview.data.startsWith("blob:")
            ) {
              URL.revokeObjectURL(currentPreview.data);
            }
          } catch {
            /* ignore */
          }
          usePostStore.getState().resetMedia?.();
        }
        setCameraActive(true);
        SonnerInfo(t("home.camera_not_ready"));
      })
      .finally(() => {
        capturingRef.current = false;
      });
  };

  useEffect(() => {
    // Pre-warm mime detection
    pickMimeType();
    return () => {
      if (mediaRecorderRef.current?.state === "recording") {
        try {
          mediaRecorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      clearTimeout(holdTimeoutRef.current);
    };
  }, []);

  return (
    <button
      type="button"
      onPointerDown={startHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onContextMenu={(e) => e.preventDefault()}
      id="camera-shutter-button"
      aria-label="Chụp ảnh"
      className="relative flex items-center justify-center rounded-full"
      style={{
        width: 72,
        height: 72,
        minWidth: 64,
        minHeight: 64,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {/* Outer accent ring — scale animation on child only */}
      <div
        className={`absolute rounded-full border-camera-custome text-white/90 z-10 ${
          isHolding ? "animate-borderExpand" : ""
        }`}
        style={{ width: 64, height: 64 }}
      />
      <div
        className={`absolute rounded-full bg-white z-0 transition-transform duration-150 ${
          isHolding ? "scale-[0.78] opacity-90" : "scale-100 opacity-100"
        }`}
        style={{ width: 54, height: 54 }}
      />
    </button>
  );
};

export default CameraButton;
