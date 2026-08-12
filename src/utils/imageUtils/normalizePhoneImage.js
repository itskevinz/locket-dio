import { MAX_IMAGE_UPLOAD_MB } from "../../config/uploadLimits.js";

const MB = 1024 * 1024;
const HEADER_BYTES = 128 * 1024;
const DEFAULT_MAX_EDGE = 2048;
const DEFAULT_OUTPUT_TYPE = "image/jpeg";
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jpe",
  "png",
  "webp",
  "gif",
  "heic",
  "heif",
  "avif",
  "bmp",
  "tif",
  "tiff",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "mov",
  "m4v",
  "webm",
  "3gp",
  "3g2",
]);

const MIME_TO_FORMAT = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

const EXTENSION_TO_FORMAT = {
  jpg: "jpeg",
  jpeg: "jpeg",
  jpe: "jpeg",
  png: "png",
  webp: "webp",
  gif: "gif",
  heic: "heic",
  heif: "heif",
  avif: "avif",
  bmp: "bmp",
  tif: "tiff",
  tiff: "tiff",
};

export class PhoneImageError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "PhoneImageError";
    this.code = code;
  }
}

function fileExtension(file) {
  const match = String(file?.name || "")
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]+)$/);
  return match?.[1] || "";
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function hasBytes(bytes, expected, offset = 0) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function isLikelyPhoneImage(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (MIME_TO_FORMAT[mime]) return true;
  return IMAGE_EXTENSIONS.has(fileExtension(file));
}

export function isLikelyPhoneVideo(file) {
  const mime = String(file?.type || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  return VIDEO_EXTENSIONS.has(fileExtension(file));
}

export function classifyPhoneMedia(file) {
  if (isLikelyPhoneImage(file)) return "image";
  if (isLikelyPhoneVideo(file)) return "video";
  return null;
}

/** Detect common phone image containers from magic bytes, then MIME/name. */
export async function detectPhoneImageFormat(file) {
  if (!file?.slice || !file?.arrayBuffer) return null;

  let bytes = new Uint8Array();
  try {
    bytes = new Uint8Array(
      await file.slice(0, Math.min(Number(file.size) || HEADER_BYTES, HEADER_BYTES)).arrayBuffer(),
    );
  } catch {
    // Android may revoke a temporary picker handle. MIME/name fallback below
    // still lets the caller produce a useful error during materialization.
  }

  if (bytes.length >= 3 && hasBytes(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (
    bytes.length >= 8 &&
    hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) {
    return "gif";
  }
  if (bytes.length >= 2 && ascii(bytes, 0, 2) === "BM") return "bmp";
  if (
    bytes.length >= 4 &&
    (hasBytes(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
      hasBytes(bytes, [0x4d, 0x4d, 0x00, 0x2a]))
  ) {
    return "tiff";
  }

  if (bytes.length >= 16 && ascii(bytes, 4, 4) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length - 8, 64)).toLowerCase();
    if (/avif|avis/.test(brands)) return "avif";
    if (/heic|heix|hevc|hevx|heim|heis/.test(brands)) return "heic";
    if (/mif1|msf1/.test(brands)) return "heif";
  }

  const mimeFormat = MIME_TO_FORMAT[String(file.type || "").toLowerCase()];
  return mimeFormat || EXTENSION_TO_FORMAT[fileExtension(file)] || null;
}

function read16(view, offset, littleEndian) {
  if (offset < 0 || offset + 2 > view.byteLength) return null;
  return view.getUint16(offset, littleEndian);
}

function read32(view, offset, littleEndian) {
  if (offset < 0 || offset + 4 > view.byteLength) return null;
  return view.getUint32(offset, littleEndian);
}

/** Parse JPEG EXIF orientation (1..8). Non-JPEG/absent metadata returns 1. */
export function parseJpegExifOrientation(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;

    const payload = offset + 2;
    if (
      marker === 0xe1 &&
      segmentLength >= 14 &&
      ascii(bytes, payload, 6) === "Exif\0\0"
    ) {
      const tiff = payload + 6;
      const byteOrder = ascii(bytes, tiff, 2);
      const littleEndian = byteOrder === "II";
      if (!littleEndian && byteOrder !== "MM") return 1;
      if (read16(view, tiff + 2, littleEndian) !== 42) return 1;

      const ifdOffset = read32(view, tiff + 4, littleEndian);
      if (ifdOffset == null) return 1;
      const ifd = tiff + ifdOffset;
      const count = read16(view, ifd, littleEndian);
      if (count == null) return 1;

      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > bytes.length) break;
        if (read16(view, entry, littleEndian) !== 0x0112) continue;
        const value = read16(view, entry + 8, littleEndian);
        return value >= 1 && value <= 8 ? value : 1;
      }
      return 1;
    }

    offset += segmentLength;
  }
  return 1;
}

export async function readPhoneImageOrientation(file, format) {
  if ((format || (await detectPhoneImageFormat(file))) !== "jpeg") return 1;
  try {
    const bytes = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
    return parseJpegExifOrientation(bytes);
  } catch {
    return 1;
  }
}

function loadHtmlImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.style.imageOrientation = "from-image";
    image.onload = () => resolve({ source: image, objectUrl });
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("image decode failed"));
    };
    image.src = objectUrl;
  });
}

async function decodeNativeImage(blob) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob, {
        imageOrientation: "from-image",
        premultiplyAlpha: "default",
        colorSpaceConversion: "default",
      });
      return { source: bitmap, objectUrl: "" };
    } catch {
      try {
        // Some older WebKit versions decode the image but reject options.
        const bitmap = await createImageBitmap(blob);
        return { source: bitmap, objectUrl: "" };
      } catch {
        // HTMLImageElement fallback below.
      }
    }
  }
  return loadHtmlImage(blob);
}

async function decodeHeicImage(file) {
  try {
    return await decodeNativeImage(file);
  } catch (nativeError) {
    try {
      // Large HEIC decoder stays in a lazy chunk and is downloaded only when a
      // browser cannot decode an iPhone HEIC/HEIF photo itself.
      const { heicTo } = await import("heic-to/csp");
      const converted = await heicTo({
        blob: file,
        type: "image/jpeg",
        quality: 0.95,
      });
      const blob = Array.isArray(converted) ? converted[0] : converted;
      if (!blob) throw new Error("HEIC conversion returned no pixels");
      return await decodeNativeImage(blob);
    } catch (cause) {
      throw new PhoneImageError(
        "HEIC_DECODE_FAILED",
        "Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c \u1ea3nh HEIC/HEIF n\u00e0y. H\u00e3y th\u1eed xu\u1ea5t \u1ea3nh t\u01b0\u01a1ng th\u00edch t\u1eeb iPhone.",
        cause || nativeError,
      );
    }
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new PhoneImageError("IMAGE_ENCODE_FAILED", "Kh\u00f4ng m\u00e3 h\u00f3a \u0111\u01b0\u1ee3c \u1ea3nh.")),
      type,
      quality,
    );
  });
}

function outputFileName(name, outputType) {
  const extension = outputType === "image/webp" ? "webp" : "jpg";
  const stem = String(name || `huy-locket-${Date.now()}`)
    .replace(/\.[^.]+$/i, "")
    .trim();
  return `${stem || `huy-locket-${Date.now()}`}.${extension}`;
}

function markNormalized(file, details) {
  try {
    Object.defineProperties(file, {
      __prepared: { value: true, configurable: true },
      __materialized: { value: true, configurable: true },
      __normalizedPhoneImage: { value: true, configurable: true },
      __sourceFormat: { value: details.format, configurable: true },
      __sourceOrientation: { value: details.orientation, configurable: true },
    });
  } catch {
    // Custom markers are diagnostic only.
  }
  return file;
}

/**
 * Decode a common phone image, bake its EXIF/container orientation into pixels,
 * resize safely, strip unstable metadata and emit a browser-owned JPEG/WebP.
 */
export async function normalizePhoneImage(file, options = {}) {
  if (!file) {
    throw new PhoneImageError("IMAGE_MISSING", "Thi\u1ebfu file \u1ea3nh.");
  }

  const maxInputBytes =
    Number(options.maxInputBytes) || MAX_IMAGE_UPLOAD_MB * MB;
  if (Number(file.size) > maxInputBytes) {
    throw new PhoneImageError(
      "IMAGE_TOO_LARGE",
      `\u1ea2nh v\u01b0\u1ee3t qu\u00e1 gi\u1edbi h\u1ea1n ${Math.round(maxInputBytes / MB)} MB.`,
    );
  }

  const format = await detectPhoneImageFormat(file);
  if (!format) {
    throw new PhoneImageError(
      "IMAGE_FORMAT_UNSUPPORTED",
      "\u0110\u1ecbnh d\u1ea1ng \u1ea3nh n\u00e0y ch\u01b0a \u0111\u01b0\u1ee3c h\u1ed7 tr\u1ee3.",
    );
  }

  const orientation = await readPhoneImageOrientation(file, format);
  let decoded = null;
  try {
    decoded = ["heic", "heif"].includes(format)
      ? await decodeHeicImage(file)
      : await decodeNativeImage(file);

    const source = decoded.source;
    const sourceWidth = Number(source.naturalWidth || source.width || 0);
    const sourceHeight = Number(source.naturalHeight || source.height || 0);
    if (sourceWidth < 2 || sourceHeight < 2) {
      throw new PhoneImageError(
        "IMAGE_DIMENSIONS_INVALID",
        "\u1ea2nh kh\u00f4ng h\u1ee3p l\u1ec7 ho\u1eb7c kh\u00f4ng c\u00f3 k\u00edch th\u01b0\u1edbc.",
      );
    }

    const maxEdge = Math.max(256, Number(options.maxEdge) || DEFAULT_MAX_EDGE);
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const requestedType =
      options.outputType === "image/webp" ? "image/webp" : DEFAULT_OUTPUT_TYPE;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: requestedType === "image/webp" });
    if (!ctx) {
      throw new PhoneImageError("CANVAS_UNAVAILABLE", "Tr\u00ecnh duy\u1ec7t kh\u00f4ng t\u1ea1o \u0111\u01b0\u1ee3c canvas \u1ea3nh.");
    }

    if (requestedType === "image/jpeg") {
      ctx.fillStyle = options.backgroundColor || "#000000";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // createImageBitmap(..., { imageOrientation: "from-image" }) and the
    // HTMLImage fallback both expose display-oriented pixels. Drawing them once
    // bakes EXIF 2..8 / HEIF irot-imir into the output; JPEG/WebP has no stale
    // orientation metadata left to rotate a second time on Locket.
    ctx.drawImage(source, 0, 0, width, height);

    const quality = Math.min(1, Math.max(0.65, Number(options.quality) || 0.92));
    let outputType = requestedType;
    let blob = await canvasToBlob(canvas, outputType, quality);
    if (outputType === "image/webp" && blob.type !== "image/webp") {
      outputType = "image/jpeg";
      blob = await canvasToBlob(canvas, outputType, quality);
    }
    if (blob.size > maxInputBytes && quality > 0.78) {
      blob = await canvasToBlob(canvas, outputType, 0.78);
    }
    if (blob.size > maxInputBytes) {
      throw new PhoneImageError(
        "NORMALIZED_IMAGE_TOO_LARGE",
        `\u1ea2nh sau x\u1eed l\u00fd v\u1eabn v\u01b0\u1ee3t ${Math.round(maxInputBytes / MB)} MB.`,
      );
    }

    const normalized = new File(
      [blob],
      outputFileName(file.name, outputType),
      {
        type: outputType,
        lastModified: Number(file.lastModified) || Date.now(),
      },
    );
    return markNormalized(normalized, { format, orientation });
  } catch (error) {
    if (error instanceof PhoneImageError) throw error;
    throw new PhoneImageError(
      "IMAGE_DECODE_FAILED",
      "Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c \u1ea3nh n\u00e0y tr\u00ean thi\u1ebft b\u1ecb.",
      error,
    );
  } finally {
    try {
      decoded?.source?.close?.();
    } catch {
      /* ignore */
    }
    if (decoded?.objectUrl) URL.revokeObjectURL(decoded.objectUrl);
  }
}
