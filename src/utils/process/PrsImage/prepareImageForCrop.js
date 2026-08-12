import { normalizePhoneImage } from "../../imageUtils/normalizePhoneImage.js";

/**
 * Materialize every gallery/phone image into an orientation-safe JPEG before
 * it enters the crop editor. This prevents Android picker handles, stale EXIF
 * orientation and HEIC/AVIF container details from leaking into upload.
 */
export async function prepareImageForCrop(file, opts = {}) {
  return normalizePhoneImage(file, {
    maxEdge: opts.maxEdge ?? 2048,
    maxInputBytes: opts.maxInputBytes,
    outputType: opts.outputType || "image/jpeg",
    quality: opts.quality ?? 0.94,
  });
}

/** Check whether the browser can render a blob without revoking its URL early. */
export function canBrowserRenderImage(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(false);
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    img.onload = () =>
      done((img.naturalWidth || 0) > 0 && (img.naturalHeight || 0) > 0);
    img.onerror = () => done(false);
    setTimeout(() => done(false), 8000);
    img.src = url;
  });
}
