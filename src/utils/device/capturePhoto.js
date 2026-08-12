/**
 * Highest-quality still capture for Huy Locket.
 *
 * Priority:
 *  - Android: capture the live <video> frame first so the saved square uses the
 *    exact same frame/FOV/crop the user saw before pressing the shutter.
 *  - Other browsers: ImageCapture.takePhoto() first for native still bytes.
 *  - Remaining fallbacks: grabFrame() / <video> → canvas.
 *
 * Important:
 * - Never reduce capture quality because a device is classified as low-end.
 * - Android camera HALs can return a takePhoto()/grabFrame frame with a
 *   different FOV or orientation from the HTMLVideoElement viewfinder. That
 *   looks like the picture suddenly zooms after capture, so Android snapshots
 *   the actual live <video> element at full negotiated track resolution.
 * - Rear native stills on non-Android are not re-encoded when they already fit
 *   the reliable inline-upload budget. The API performs the center-square crop.
 * - Canvas fallbacks prefer PNG only while it still fits the inline path. Large
 *   mobile PNGs are encoded as high-quality JPEG so they do not fall into the
 *   less reliable large-file proxy route.
 */

// StorageServices sends images up to 4.5 MB inline. Keep a little headroom so
// camera metadata / browser encoder differences never switch Android captures
// to the temporary PUT route used by large media.
export const CAMERA_INLINE_TARGET_BYTES = Math.floor(4.25 * 1024 * 1024);

const NATIVE_JPEG_QUALITIES = [0.96, 0.9, 0.84];
const RESIZED_JPEG_QUALITIES = [0.92, 0.84];
const FALLBACK_SIDES = [2560, 2048, 1600];

export function cameraJpegEncodingPlan(nativeSide) {
  const side = Math.max(1, Math.floor(Number(nativeSide) || 1));
  const plan = NATIVE_JPEG_QUALITIES.map((quality) => ({ side, quality }));

  for (const fallbackSide of FALLBACK_SIDES) {
    if (fallbackSide >= side) continue;
    for (const quality of RESIZED_JPEG_QUALITIES) {
      plan.push({ side: fallbackSide, quality });
    }
  }

  const finalSide = Math.min(side, FALLBACK_SIDES.at(-1));
  plan.push({ side: finalSide, quality: 0.72 });
  return plan.filter(
    (attempt, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.side === attempt.side &&
          candidate.quality === attempt.quality,
      ) === index,
  );
}

function isAndroidBrowser() {
  try {
    return /Android/i.test(navigator?.userAgent || "");
  } catch {
    return false;
  }
}

function getLiveTrack(video) {
  try {
    return video?.srcObject?.getVideoTracks?.()?.[0] || null;
  } catch {
    return null;
  }
}

function extensionForMime(type = "") {
  const t = String(type).toLowerCase();
  if (t.includes("png")) return "png";
  if (t.includes("webp")) return "webp";
  if (t.includes("heic") || t.includes("heif")) return "heic";
  return "jpg";
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      type,
      quality,
    );
  });
}

function resizeSquareCanvas(sourceCanvas, side) {
  if (sourceCanvas.width === side && sourceCanvas.height === side) {
    return sourceCanvas;
  }

  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false,
  });
  if (!ctx) throw new Error("no 2d context");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(sourceCanvas, 0, 0, side, side);
  return canvas;
}

export async function encodeSquareCanvasForUpload(canvas) {
  try {
    const png = await canvasToBlob(canvas, "image/png");
    if (png.size <= CAMERA_INLINE_TARGET_BYTES) return png;
  } catch {
    /* JPEG attempts below */
  }

  let lastBlob = null;
  let lastSide = null;
  let workingCanvas = canvas;
  for (const attempt of cameraJpegEncodingPlan(canvas.width)) {
    if (attempt.side !== lastSide) {
      workingCanvas = resizeSquareCanvas(canvas, attempt.side);
      lastSide = attempt.side;
    }
    lastBlob = await canvasToBlob(
      workingCanvas,
      "image/jpeg",
      attempt.quality,
    );
    if (lastBlob.size <= CAMERA_INLINE_TARGET_BYTES) return lastBlob;
  }

  return lastBlob;
}

/**
 * Center-crop a decoded source without downscaling.
 * This is mathematically the same crop as object-fit: cover + object-position:
 * center when the destination is square.
 */
async function cropSourceToSquareBlob(source, srcW, srcH, opts = {}) {
  const mirror = Boolean(opts.mirror);
  if (!srcW || !srcH) throw new Error("invalid dimensions");

  const nativeSide = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - nativeSide) / 2);
  const sy = Math.floor((srcH - nativeSide) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = nativeSide;
  canvas.height = nativeSide;

  const ctx = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false,
  });
  if (!ctx) throw new Error("no 2d context");

  // No scaling => no smoothing / resampling.
  ctx.imageSmoothingEnabled = false;

  if (mirror) {
    ctx.translate(nativeSide, 0);
    ctx.scale(-1, 1);
  }

  // drawImage() runs synchronously. For a HTMLVideoElement this freezes the
  // current viewfinder frame before React can swap/unmount the live <video>.
  ctx.drawImage(
    source,
    sx,
    sy,
    nativeSide,
    nativeSide,
    0,
    0,
    nativeSide,
    nativeSide,
  );

  return encodeSquareCanvasForUpload(canvas);
}

async function cropBlobToSquareBlob(blob, opts = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("image decode failed"));
        el.src = url;
      });
      return cropSourceToSquareBlob(
        img,
        img.naturalWidth,
        img.naturalHeight,
        opts,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    return await cropSourceToSquareBlob(
      bitmap,
      bitmap.width,
      bitmap.height,
      opts,
    );
  } finally {
    if (typeof bitmap.close === "function") {
      try {
        bitmap.close();
      } catch {
        /* ignore */
      }
    }
  }
}

async function takeNativePhotoBlob(track) {
  if (!track || typeof ImageCapture === "undefined") return null;
  try {
    const ic = new ImageCapture(track);
    if (typeof ic.takePhoto !== "function") return null;
    const blob = await ic.takePhoto();
    if (blob && blob.size > 1024) return blob;
  } catch {
    /* unsupported/busy — fall through to frame capture */
  }
  return null;
}

async function grabFrameBlob(track, opts = {}) {
  if (!track || typeof ImageCapture === "undefined") return null;

  let ic;
  try {
    ic = new ImageCapture(track);
  } catch {
    return null;
  }
  if (typeof ic.grabFrame !== "function") return null;

  try {
    const frame = await ic.grabFrame();
    if (!frame || !frame.width) return null;
    try {
      return await cropSourceToSquareBlob(frame, frame.width, frame.height, {
        mirror: opts.mirror,
      });
    } finally {
      if (typeof frame.close === "function") {
        try {
          frame.close();
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    return null;
  }
}

/**
 * Capture the exact frame currently painted by the HTMLVideoElement.
 *
 * Do not await rAF before drawImage: the UI starts a provisional shutter
 * preview in parallel and may unmount the live video. Drawing immediately also
 * prevents a one-frame framing change while the Android camera HAL is busy.
 */
async function captureViewfinderBlob(video, opts = {}) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }
  try {
    return await cropSourceToSquareBlob(
      video,
      video.videoWidth,
      video.videoHeight,
      { mirror: opts.mirror },
    );
  } catch {
    return null;
  }
}

/**
 * @param {HTMLVideoElement} video
 * @param {{
 *   mirror?: boolean,
 *   onPreviewUrl?: (url: string) => void,
 *   preferViewfinderFrame?: boolean,
 * }} [opts]
 * @returns {Promise<{ file: File, blob: Blob, method: string }>}
 */
export async function captureSharpSquarePhoto(video, opts = {}) {
  if (!video) throw new Error("no video");

  const mirror = Boolean(opts.mirror);
  const track = getLiveTrack(video);
  const preferViewfinderFrame =
    opts.preferViewfinderFrame ?? isAndroidBrowser();

  const emitPreview = (blob) => {
    if (typeof opts.onPreviewUrl !== "function" || !blob) return;
    try {
      opts.onPreviewUrl(URL.createObjectURL(blob));
    } catch {
      /* ignore */
    }
  };

  const toResult = (blob, method) => {
    const type = blob.type || "image/jpeg";
    return {
      file: new File([blob], `locket_dio.${extensionForMime(type)}`, {
        type,
        lastModified: Date.now(),
      }),
      blob,
      method,
    };
  };

  // ── Android: exact viewfinder frame first ──
  // HTMLVideoElement is the source of truth for what the user saw. Some Android
  // implementations make ImageCapture.takePhoto() narrower and some also expose
  // grabFrame() with a subtly different sensor crop/orientation. Capturing the
  // live video element itself guarantees the post-shot image cannot jump zoom.
  // The camera stream is requested at up to 2560×1920, and this path never
  // downsizes the square, so still quality is kept at full negotiated track res.
  if (preferViewfinderFrame) {
    const viewfinder = await captureViewfinderBlob(video, { mirror });
    if (viewfinder) {
      emitPreview(viewfinder);
      return toResult(viewfinder, "video.canvas.viewfinder");
    }

    // If the HTMLVideoElement was not ready, try the same live MediaStream track
    // before falling back to a native still with potentially different FOV.
    if (track?.readyState === "live") {
      const grabbed = await grabFrameBlob(track, { mirror });
      if (grabbed) {
        emitPreview(grabbed);
        return toResult(grabbed, "ImageCapture.grabFrame.viewfinder-fallback");
      }
    }
  }

  // ── Native still — highest-quality bytes where FOV remains stable ──
  if (track?.readyState === "live") {
    const raw = await takeNativePhotoBlob(track);
    if (raw) {
      // Rear camera: keep native bytes when possible. Backend does the square
      // center crop with a lossless-first WebP pipeline, avoiding browser JPEG
      // recompression entirely.
      if (!mirror && raw.size <= CAMERA_INLINE_TARGET_BYTES) {
        emitPreview(raw);
        return toResult(raw, "ImageCapture.takePhoto.native");
      }

      // Front camera must match the mirrored preview; oversized native stills
      // also need to fit the 25 MB transport budget.
      const squared = await cropBlobToSquareBlob(raw, { mirror });
      emitPreview(squared);
      return toResult(squared, "ImageCapture.takePhoto.square");
    }
  }

  // ── grabFrame fallback ──
  if (track?.readyState === "live") {
    const grabbed = await grabFrameBlob(track, { mirror });
    if (grabbed) {
      emitPreview(grabbed);
      return toResult(grabbed, "ImageCapture.grabFrame");
    }
  }

  // ── Video frame — universal Safari/iOS fallback ──
  if (video.videoWidth && video.readyState >= 2) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const blob = await cropSourceToSquareBlob(
      video,
      video.videoWidth,
      video.videoHeight,
      { mirror },
    );
    emitPreview(blob);
    return toResult(blob, "video.canvas.lossless-first");
  }

  throw new Error("camera_not_ready");
}
