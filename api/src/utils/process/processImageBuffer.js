const sharp = require("sharp");
const heicConvert = require("heic-convert");
const { logSuccess } = require("../logEventUtils");

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

async function encodeLosslessWebp(basePipeline, side) {
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
      lossless: true,
      alphaQuality: 100,
      effort: 4,
    })
    .toBuffer();
}

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
 * Process image for Locket upload — full-quality first.
 *
 * Rules:
 * - Center-crop to square at the source resolution.
 * - No default 1920/1440/1080 downscale.
 * - First encode is lossless WebP so camera pixels are not damaged by another
 *   lossy compression pass.
 * - If an unusually complex/high-megapixel image exceeds the soft output
 *   budget, keep the same resolution and try q100/q98/q96 first.
 * - Resolution is reduced only as an emergency stability fallback for very
 *   large images that still exceed the budget.
 *
 * `resolution` is optional. Passing null/undefined means native resolution.
 */
const processImageBuffer = async ({
  imageBuffer,
  maxSizeMB = 32,
  resolution = null,
}) => {
  try {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length < 32) {
      throw new Error(
        `Input Buffer is empty or too small (${imageBuffer?.length ?? 0} bytes)`,
      );
    }

    logInfo(
      "processImageBuffer",
      "Start processing image (full-quality, lossless-first)...",
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
    const hasExplicitResolution =
      Number.isFinite(requestedResolution) && requestedResolution > 0;
    const outSide = hasExplicitResolution
      ? Math.min(cropSide, Math.max(720, Math.min(requestedResolution, 8192)))
      : cropSide;

    logInfo(
      "processImageBuffer",
      outSide === cropSide
        ? `Keep native square ${outSide}px`
        : `Explicit resize ${cropSide}px → ${outSide}px`,
    );

    const maxBytes = Math.max(4, Number(maxSizeMB) || 32) * 1024 * 1024;

    // 1) Lossless at native square resolution.
    let processedBuffer = await encodeLosslessWebp(squared, outSide);
    logInfo(
      "processImageBuffer",
      `Lossless WebP → ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`,
    );

    if (processedBuffer.length <= maxBytes) {
      logSuccess("processImageBuffer", "✅ End processing image buffer (lossless).");
      return processedBuffer;
    }

    // 2) Keep every pixel before considering any resize.
    for (const quality of [100, 98, 96]) {
      processedBuffer = await encodeHighQualityWebp(squared, outSide, quality);
      logInfo(
        "processImageBuffer",
        `Native ${outSide}px WebP q${quality} → ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      );
      if (processedBuffer.length <= maxBytes) {
        logSuccess(
          "processImageBuffer",
          `✅ End processing image buffer (native q${quality}).`,
        );
        return processedBuffer;
      }
    }

    // 3) Emergency only: extremely large images can consume hundreds of MB in
    // Sharp/Railway memory. Keep a high resolution and high quality instead of
    // the old 1440/1080 fallbacks.
    const emergencySides = [4096, 3072].filter((side) => outSide > side);
    for (const side of emergencySides) {
      const quality = side === 4096 ? 98 : 96;
      processedBuffer = await encodeHighQualityWebp(squared, side, quality);
      logInfo(
        "processImageBuffer",
        `Emergency ${side}px q${quality} → ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      );
      if (processedBuffer.length <= maxBytes) break;
    }

    const finalSize = (processedBuffer.length / 1024 / 1024).toFixed(2);
    logInfo("processImageBuffer", `✅ Final image size: ${finalSize}MB`);
    logSuccess("processImageBuffer", "✅ End processing image buffer.");
    return processedBuffer;
  } catch (err) {
    throw new Error("❌ Lỗi xử lý ảnh: " + err.message);
  }
};

module.exports = {
  processImageBuffer,
};
