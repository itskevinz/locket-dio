import { createImage } from "./createImage";

function markMaterialized(file) {
  try {
    file.__prepared = true;
    file.__materialized = true;
  } catch {
    /* marker optional */
  }
  return file;
}

async function cloneOwnedFile(file) {
  const bytes = await file.arrayBuffer();
  if (!bytes?.byteLength) throw new Error("File buffer rỗng");
  return markMaterialized(
    new File([bytes], file.name || "cropped-image.jpg", {
      type: file.type || "image/jpeg",
      lastModified: Number(file.lastModified) || Date.now(),
    }),
  );
}

/**
 * Cắt vùng pixels từ file → JPEG.
 * Clamp crop vào biên ảnh để tránh canvas trống trên mobile.
 * Nếu vùng cắt chính là toàn bộ ảnh và không xoay, giữ nguyên bytes nhưng
 * vẫn clone sang File memory-backed để Android không mất quyền đọc file picker.
 */
export const getCroppedImg = async (file, crop, rotation = 0) => {
  if (!file || !crop) throw new Error("Thiếu file hoặc vùng cắt");

  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await createImage(imageUrl);
    const imgW = image.naturalWidth || image.width;
    const imgH = image.naturalHeight || image.height;
    if (!imgW || !imgH) throw new Error("Ảnh không có kích thước");

    // Clamp vào biên ảnh
    let sx = Math.max(0, Math.round(Number(crop.x) || 0));
    let sy = Math.max(0, Math.round(Number(crop.y) || 0));
    let sw = Math.max(1, Math.round(Number(crop.width) || 0));
    let sh = Math.max(1, Math.round(Number(crop.height) || 0));
    if (sx + sw > imgW) sw = Math.max(1, imgW - sx);
    if (sy + sh > imgH) sh = Math.max(1, imgH - sy);

    // Square ảnh Locket tải về thường đã đúng 1:1. Nếu user không thay đổi
    // khung cắt thì không recompress; chỉ detach khỏi file handle của Android.
    const fullFrame =
      !rotation &&
      sx <= 1 &&
      sy <= 1 &&
      Math.abs(sw - imgW) <= 1 &&
      Math.abs(sh - imgH) <= 1;
    if (fullFrame) {
      try {
        return await cloneOwnedFile(file);
      } catch (e) {
        // Bitmap đã load thì vẫn cứu được bằng canvas ở phía dưới.
        console.warn("[crop] full-frame materialize failed, fallback canvas", e);
      }
    }

    // Chỉ resize khi ảnh crop thật sự quá lớn. Không ép 1536 -> 1080 nữa.
    const maxOut = 2048;
    let outW = sw;
    let outH = sh;
    if (outW > maxOut || outH > maxOut) {
      const r = Math.min(maxOut / outW, maxOut / outH);
      outW = Math.max(1, Math.round(outW * r));
      outH = Math.max(1, Math.round(outH * r));
    }

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas context not available");

    canvas.width = outW;
    canvas.height = outH;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, outW, outH);

    // Ưu tiên nội suy chất lượng cao khi browser hỗ trợ.
    if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";

    if (rotation) {
      ctx.save();
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(
        image,
        sx,
        sy,
        sw,
        sh,
        -outW / 2,
        -outH / 2,
        outW,
        outH,
      );
      ctx.restore();
    } else {
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, outW, outH);
    }

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        "image/jpeg",
        0.98,
      );
    });

    return markMaterialized(
      new File([blob], "cropped-image.jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      }),
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};
