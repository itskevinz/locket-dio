const sharp = require("sharp");
const heicConvert = require("heic-convert");
const { logSuccess } = require("../logEventUtils");
const {
  LOCKET_IMAGE_OUTPUT_MAX_MB,
  LOCKET_IMAGE_OUTPUT_MAX_BYTES,
  assertLocketImageOutput,
} = require("../../config/imageUploadPolicy");

const logInfo = (tag, message) => {
  console.log(`[${tag.toUpperCase()}] ${message}`);
};

const prepareImageForProcessing = async (imageBuffer) => {
  try {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error("Input Buffer is empty");
    }

    let image = sharp(imageBuffer, { failOn: "truncated" }).rotate();
    const metadata = await image.metadata();
    const { format } = metadata;

    logInfo(
      "prepareImage",
      `Detected format: ${format || "unknown"}, bytes=${imageBuffer.length}`,
    );

    const unsupportedFormats = ["heif", "heic"];
    if (unsupportedFormats.includes(format?.toLowerCase())) {
      logInfo(
        "prepareImage",
        `Using heic-convert to convert ${format} to JPEG`,
      );

      const jpegBuffer = await heicConvert({
        buffer: imageBuffer,
        format: "JPEG",
        quality: 1,
      });

      if (!jpegBuffer?.length) {
        throw new Error("HEIC convert produced empty buffer");
      }

      image = sharp(jpegBuffer, { failOn: "truncated" }).rotate();
      logInfo("prepareImage", "✅ Successfully converted HEIC to JPEG");
    }

    return image;
  } catch (err) {
    logInfo("prepareImage", `Error preparing image: ${err.message}`);
    throw new Error("Cannot prepare image format: " + err.message);
  }
};

async function encodeHighQualityWebp(basePipeline, side, quality) {
  let pipe = basePipeline.clone();
  if (side && side > 0) {
    pipe = pipe.resize(side, side, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: true,
    });
  }

  return pipe
    .webp({
      quality,
      alphaQuality: 100,
      smartSubsample: false,
      effort: 4,
    })
    .toBuffer();
}

/**
 * Process image for Locket upload — stable high quality.
 *
 * Rules:
 * - Center-crop to square at the source resolution.
 * - Accept high-resolution phone sources, but cap the Locket object to a
 *   display-sized square. Source acceptance and final Storage size are two
 *   separate limits.
 * - Always use high-quality lossy WebP. Lossless WebP makes dark/noisy camera
 *   frames expand unpredictably and can cross Firebase Storage Rules limits.
 * - Guarantee the returned buffer stays within maxSizeMB or fail before the
 *   Firebase request instead of surfacing a misleading intermittent 403.
 */
const processImageBuffer = async ({
  imageBuffer,
  maxSizeMB = LOCKET_IMAGE_OUTPUT_MAX_MB,
  resolution = 2048,
}) => {
  try {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) {
      throw new Error(
        `Input Buffer is empty or too small (${imageBuffer?.length ?? 0} bytes)`,
      );
    }

    logInfo(
      "processImageBuffer",
      "Start processing image (storage-safe high quality)...",
    );

    let image = await prepareImageForProcessing(imageBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    logInfo("processImageBuffer", `Original size: ${width}x${height}`);

    if (!width || !height) {
      throw new Error("Invalid image dimensions");
    }

    const cropSide = Math.min(width, height);
    const left = Math.max(0, Math.floor((width - cropSide) / 2));
    const top = Math.max(0, Math.floor((height - cropSide) / 2));

    const squared = image.extract({
      left,
      top,
      width: cropSide,
      height: cropSide,
    });

    const requestedResolution = Number(resolution);
    const targetSide = Number.isFinite(requestedResolution) && requestedResolution > 0
      ? Math.max(720, Math.min(requestedResolution, 4096))
      : 2048;
    const outSide = Math.min(cropSide, targetSide);

    logInfo(
      "processImageBuffer",
      cropSide > outSide
        ? `Downscale ${cropSide}px → ${outSide}px (lanczos3)`
        : `Keep native square ${outSide}px (no upscale)`,
    );

    // A caller may request a smaller output, but can never raise the proven
    // Locket/Firebase ceiling and silently reintroduce finalize 403s.
    const requestedMaxBytes =
      Math.max(
        0.5,
        Number(maxSizeMB) || LOCKET_IMAGE_OUTPUT_MAX_MB,
      ) * 1024 * 1024;
    const maxBytes = Math.min(
      requestedMaxBytes,
      LOCKET_IMAGE_OUTPUT_MAX_BYTES,
    );
    let processedBuffer;

    // Preserve the selected resolution first and lower quality gradually.
    for (const quality of [95, 92, 90, 88, 85, 82]) {
      processedBuffer = await encodeHighQualityWebp(squared, outSide, quality);
      logInfo(
        "processImageBuffer",
        `${outSide}px WebP q${quality} → ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      );
      if (processedBuffer.length <= maxBytes) {
        logSuccess(
          "processImageBuffer",
          `✅ End processing image buffer (${outSide}px q${quality}).`,
        );
        return assertLocketImageOutput(processedBuffer);
      }
    }

    // Sensor noise can still be expensive at 2K. Reduce resolution in small
    // steps, keeping a visually high quality encode at every step.
    const fallbackSides = [1920, 1600, 1440, 1280, 1080, 960, 720]
      .filter((side) => side < outSide);
    for (const side of fallbackSides) {
      const quality = side >= 1600 ? 90 : side >= 1080 ? 88 : 84;
      processedBuffer = await encodeHighQualityWebp(squared, side, quality);
      logInfo(
        "processImageBuffer",
        `Fallback ${side}px q${quality} → ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      );
      if (processedBuffer.length <= maxBytes) {
        logSuccess(
          "processImageBuffer",
          `✅ End processing image buffer (${side}px q${quality}).`,
        );
        return assertLocketImageOutput(processedBuffer);
      }
    }

    throw new Error(
      `Processed WebP remains above upload budget (${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB > ${(maxBytes / 1024 / 1024).toFixed(2)}MB)`,
    );
  } catch (err) {
    throw new Error("❌ Lỗi xử lý ảnh: " + err.message);
  }
};

module.exports = {
  processImageBuffer,
};
