/**
 * Highest-quality still capture for Huy Locket.
 *
 * Priority:
 *  - Android: ImageCapture.grabFrame() first so the saved square uses the exact
 *    same live camera frame/FOV the user saw before pressing the shutter.
 *  - Other browsers: ImageCapture.takePhoto() first for native still bytes.
 *  - Remaining fallbacks: grabFrame() / <video> → canvas.
 *
 * Important:
 * - Never reduce capture quality because a device is classified as low-end.
 * - Android camera HALs can return a takePhoto() still with a different FOV
 *   from the live preview. That looks like the picture suddenly zooms after
 *   capture, so Android intentionally prefers the high-resolution live frame.
 * - Rear native stills on non-Android are not re-encoded when they already fit
 *   the upload transport budget. The API performs the center-square crop.
 * - Canvas fallbacks prefer PNG (lossless). JPEG quality=1 is used only when a
 *   lossless PNG would exceed the safe client upload budget.
 */

const JPEG_QUALITY_MAX = 1;
// API raw endpoint is 25 MB and temp storage has a little safety headroom.
const SAFE_CLIENT_IMAGE_BYTES = 23 * 1024 * 1024;

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

/**
 * Center-crop a decoded source without downscaling.
 * PNG is attempted first so pixels are not damaged by another lossy encode.
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

  // Lossless first. Typical 1080p/1440p/1920p square frames remain safely
  // below the transport limit. Very large/noisy photos fall back to max JPEG.
  try {
    const png = await canvasToBlob(canvas, "image/png");
    if (png.size <= SAFE_CLIENT_IMAGE_BYTES) return png;
  } catch {
    /* JPEG fallback below */
  }

  return canvasToBlob(canvas, "image/jpeg", JPEG_QUALITY_MAX);
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

  // ── Android: lock the final image to the exact live-view framing ──
  // Some Android OEM camera HALs expose a takePhoto() still with a narrower
  // field of view than the MediaStream. Swapping that still into the square UI
  // makes the image visibly "jump/zoom" after the shutter. grabFrame() comes
  // from this exact track, so its square center crop matches object-cover in the
  // square viewfinder pixel-for-pixel in framing while keeping full track res.
  if (preferViewfinderFrame && track?.readyState === "live") {
    const viewfinderFrame = await grabFrameBlob(track, { mirror });
    if (viewfinderFrame) {
      emitPreview(viewfinderFrame);
      return toResult(viewfinderFrame, "ImageCapture.grabFrame.viewfinder");
    }
  }

  // ── Native still — highest-quality bytes where FOV remains stable ──
  if (track?.readyState === "live") {
    const raw = await takeNativePhotoBlob(track);
    if (raw) {
      // Rear camera: keep native bytes when possible. Backend does the square
      // center crop with a lossless-first WebP pipeline, avoiding browser JPEG
      // recompression entirely.
      if (!mirror && raw.size <= SAFE_CLIENT_IMAGE_BYTES) {
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
