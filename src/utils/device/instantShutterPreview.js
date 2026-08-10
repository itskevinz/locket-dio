const PREVIEW_MAX_EDGE = 512;
const PREVIEW_JPEG_QUALITY = 0.86;

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob || null),
      "image/jpeg",
      PREVIEW_JPEG_QUALITY,
    );
  });
}

/**
 * Create a tiny frozen frame immediately after a shutter tap.
 *
 * This blob is UI-only. It is never used as the final uploaded photo; the
 * high-quality ImageCapture pipeline continues in parallel.
 */
export async function createInstantShutterPreview(video, { mirror = false } = {}) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return null;
  }

  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const side = Math.min(srcW, srcH);
  const sx = Math.floor((srcW - side) / 2);
  const sy = Math.floor((srcH - side) / 2);
  const out = Math.max(1, Math.min(PREVIEW_MAX_EDGE, side));

  const canvas = document.createElement("canvas");
  canvas.width = out;
  canvas.height = out;

  const ctx = canvas.getContext("2d", {
    alpha: false,
    desynchronized: true,
    willReadFrequently: false,
  });
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = out < side;
  ctx.imageSmoothingQuality = "low";

  if (mirror) {
    ctx.setTransform(-1, 0, 0, 1, out, 0);
  }

  ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out);

  const blob = await canvasToBlob(canvas);
  if (!blob) return null;

  try {
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}
