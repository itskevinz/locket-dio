/**
 * Chuẩn hóa ảnh client-side khi thật sự cần thiết.
 * Ảnh web-native hợp lệ và không vượt maxEdge được giữ nguyên byte để tránh
 * giảm chất lượng do JPEG bị encode lại chỉ vì mở Studio cắt ảnh.
 *
 * Lưu ý Android: File do picker trả về có thể là handle tạm thời. Vì vậy kể
 * cả khi pass-through vẫn phải đọc bytes ngay và tạo File mới do trang sở hữu,
 * nếu không vài giây sau IndexedDB / upload có thể lỗi InvalidBlob / NotReadableError.
 */

const PASSTHROUGH_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e || new Error("Image load failed"));
    img.src = url;
  });
}

function markMaterialized(file) {
  try {
    file.__prepared = true;
    file.__materialized = true;
  } catch {
    /* custom marker is optional */
  }
  return file;
}

async function cloneFileBytes(file) {
  const bytes = await file.arrayBuffer();
  if (!bytes?.byteLength) throw new Error("File buffer rỗng");
  return markMaterialized(
    new File(
      [bytes],
      (file.name && String(file.name)) || `locket-${Date.now()}.jpg`,
      {
        type: file.type || "application/octet-stream",
        lastModified: Number(file.lastModified) || Date.now(),
      },
    ),
  );
}

function canvasToJpegFile(canvas, name = "image.jpg", quality = 0.98) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("toBlob failed"));
          return;
        }
        const file = new File([blob], name.replace(/\.[^.]+$/i, ".jpg"), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        resolve(markMaterialized(file));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * @param {File|Blob} file
 * @param {{ maxEdge?: number, forceJpeg?: boolean }} [opts]
 * @returns {Promise<File|Blob>}
 */
export async function prepareImageForCrop(file, opts = {}) {
  if (!file) throw new Error("Thiếu file ảnh");
  const maxEdge = opts.maxEdge ?? 2048;
  const forceJpeg = opts.forceJpeg === true;

  // 1) createImageBitmap (nhanh, hỗ trợ nhiều format trên mobile)
  let source = null;
  try {
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file);
    }
  } catch {
    source = null;
  }

  // 2) Fallback <img>
  let objectUrl = null;
  if (!source) {
    objectUrl = URL.createObjectURL(file);
    try {
      const img = await loadImageFromUrl(objectUrl);
      if (typeof createImageBitmap === "function") {
        try {
          source = await createImageBitmap(img);
        } catch {
          source = img;
        }
      } else {
        source = img;
      }
    } finally {
      // giữ url nếu source là img element vẫn dùng — revoke sau draw/return
    }
  }

  if (!source) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw new Error("Trình duyệt không đọc được ảnh này");
  }

  const sw = source.naturalWidth || source.width || 0;
  const sh = source.naturalHeight || source.height || 0;
  if (sw < 2 || sh < 2) {
    if (source.close) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw new Error("Ảnh không hợp lệ (kích thước 0)");
  }

  // JPG/PNG/WebP browser đã decode được và kích thước vẫn an toàn:
  // giữ NGUYÊN bytes nhưng clone sang File memory-backed do trang sở hữu.
  // Không return thẳng File picker của Android vì handle có thể hết quyền sau đó.
  const inputType = String(file.type || "").toLowerCase();
  const canPassThrough =
    !forceJpeg &&
    PASSTHROUGH_TYPES.has(inputType) &&
    sw <= maxEdge &&
    sh <= maxEdge;

  if (canPassThrough) {
    try {
      const safeFile = await cloneFileBytes(file);
      if (source.close) source.close();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return safeFile;
    } catch (e) {
      // Nếu Android đã thu hồi handle nhưng bitmap đã decode xong, vẫn có thể
      // cứu ảnh bằng cách vẽ source sang canvas phía dưới.
      console.warn("[crop] materialize pass-through failed, fallback canvas", e);
    }
  }

  let w = sw;
  let h = sh;
  if (w > maxEdge || h > maxEdge) {
    const r = Math.min(maxEdge / w, maxEdge / h);
    w = Math.max(1, Math.round(w * r));
    h = Math.max(1, Math.round(h * r));
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) {
    if (source.close) source.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw new Error("Canvas không khả dụng");
  }
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  if ("imageSmoothingEnabled" in ctx) ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);

  if (source.close) source.close();
  if (objectUrl) URL.revokeObjectURL(objectUrl);

  const baseName =
    (file.name && String(file.name)) || `locket-${Date.now()}.jpg`;
  return canvasToJpegFile(canvas, baseName, 0.98);
}

/**
 * Kiểm tra browser có decode được file không (không revoke sớm).
 */
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
    img.onload = () => {
      const ok =
        (img.naturalWidth || 0) > 0 && (img.naturalHeight || 0) > 0;
      done(ok);
    };
    img.onerror = () => done(false);
    // timeout — một số máy treo onload
    setTimeout(() => done(false), 8000);
    img.src = url;
  });
}
