/**
 * ═══════════════════════════════════════════════════════════════════
 *  🛡️ Payload Validation Middleware
 * ═══════════════════════════════════════════════════════════════════
 *
 * Kiểm tra Content-Type, body size, và cung cấp schema validation helpers.
 * Không thay đổi API contract hiện tại.
 */

/**
 * Chặn Content-Type không hợp lệ cho JSON endpoints.
 * Chỉ áp dụng cho POST/PUT/PATCH có body.
 */
function requireJsonContentType(req, res, next) {
  const path = String(req.path || req.url || "").split("?")[0];
  // This route intentionally accepts raw image/video/audio bytes and applies
  // its own size limit in vercelDrive. Do not classify it as a JSON endpoint.
  if (path === "/api/drive-backup") return next();

  // Chỉ kiểm tra khi có body
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    const contentType = req.headers["content-type"] || "";
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);

    // Nếu có body nhưng Content-Type không phải JSON
    if (contentLength > 0 && !contentType.includes("application/json") && !contentType.includes("multipart/form-data") && !contentType.includes("application/x-www-form-urlencoded") && !contentType.includes("application/octet-stream")) {
      return res.status(415).json({
        success: false,
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "Content-Type không được hỗ trợ",
      });
    }
  }
  next();
}

/**
 * Giới hạn độ dài chuỗi trong body JSON — chống payload bomb.
 * Chuỗi nhị phân Base64 phải được giữ nguyên; cắt giữa chuỗi sẽ tạo ảnh hỏng
 * nhưng Sharp vẫn có thể giải mã được vài dòng pixel đầu tiên.
 */
const MAX_STRING_LEN = 10000; // 10K chars — đủ cho bài viết dài
const MAX_INLINE_BASE64_LEN = 6400000; // ảnh 4.5MB → Base64 khoảng 6.3MB
const BINARY_STRING_KEYS = new Set([
  "mediaBase64",
  "base64",
  "dataBase64",
]);

function sanitizeBodyStrings(req, res, next) {
  if (req.body && typeof req.body === "object") {
    const validationError = truncateStrings(req.body, MAX_STRING_LEN, 0);
    if (validationError) {
      return res.status(413).json({
        success: false,
        code: validationError.code,
        error: validationError.message,
      });
    }
  }
  next();
}

function truncateStrings(obj, maxLen, depth) {
  if (depth > 10) return null; // Chống infinite recursion
  if (Array.isArray(obj)) {
    // Giới hạn mảng tối đa 1000 phần tử
    if (obj.length > 1000) obj.length = 1000;
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === "string" && obj[i].length > maxLen) {
        obj[i] = obj[i].slice(0, maxLen);
      } else if (typeof obj[i] === "object" && obj[i] !== null) {
        const nestedError = truncateStrings(obj[i], maxLen, depth + 1);
        if (nestedError) return nestedError;
      }
    }
  } else if (typeof obj === "object" && obj !== null) {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === "string") {
        if (BINARY_STRING_KEYS.has(key)) {
          if (obj[key].length > MAX_INLINE_BASE64_LEN) {
            return {
              code: "INLINE_MEDIA_TOO_LARGE",
              message: "Ảnh gửi trực tiếp quá lớn. Vui lòng tải lại để dùng luồng upload tệp.",
            };
          }
          // Tuyệt đối không cắt chuỗi Base64: cắt sẽ làm hỏng phần cuối ảnh.
          continue;
        }

        if (obj[key].length > maxLen) {
          obj[key] = obj[key].slice(0, maxLen);
        }
      } else if (typeof obj[key] === "object" && obj[key] !== null) {
        const nestedError = truncateStrings(obj[key], maxLen, depth + 1);
        if (nestedError) return nestedError;
      }
    }
  }

  return null;
}

/**
 * Kiểm tra file upload: magic bytes + MIME
 * Dùng cho endpoint upload ảnh/video
 */
const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);

const ALLOWED_VIDEO_MIMES = new Set([
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
]);

const ALLOWED_AUDIO_MIMES = new Set([
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav",
]);

// Magic bytes signatures
const MAGIC_SIGNATURES = [
  { mime: "image/jpeg",     bytes: [0xFF, 0xD8, 0xFF] },
  { mime: "image/png",      bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: "image/gif",      bytes: [0x47, 0x49, 0x46] },
  { mime: "image/webp",     bytes: [0x52, 0x49, 0x46, 0x46], offset4: [0x57, 0x45, 0x42, 0x50] },
  { mime: "video/mp4",      bytes: null, ftyp: true }, // ftyp box at offset 4
  { mime: "video/quicktime", bytes: null, ftyp: true },
  { mime: "video/webm",     bytes: [0x1A, 0x45, 0xDF, 0xA3] },
  { mime: "audio/mpeg",     bytes: [0xFF, 0xFB] }, // MP3
  { mime: "audio/mpeg",     bytes: [0xFF, 0xF3] },
  { mime: "audio/mpeg",     bytes: [0xFF, 0xF2] },
  { mime: "audio/mpeg",     bytes: [0x49, 0x44, 0x33] }, // ID3 tag
  { mime: "audio/ogg",      bytes: [0x4F, 0x67, 0x67, 0x53] },
  { mime: "audio/wav",      bytes: [0x52, 0x49, 0x46, 0x46] },
];

/**
 * Kiểm tra buffer có phải file hợp lệ không dựa trên magic bytes
 */
function detectFileType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return null;

  for (const sig of MAGIC_SIGNATURES) {
    if (sig.ftyp) {
      // MP4/MOV: bytes 4-7 là "ftyp"
      if (buffer.length >= 8 && buffer.toString("ascii", 4, 8) === "ftyp") {
        return "video/mp4";
      }
      continue;
    }

    if (sig.bytes) {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[i] !== sig.bytes[i]) { match = false; break; }
      }
      if (match) {
        // WEBP: thêm kiểm tra offset 8-11
        if (sig.offset4 && buffer.length >= 12) {
          let match2 = true;
          for (let i = 0; i < sig.offset4.length; i++) {
            if (buffer[8 + i] !== sig.offset4[i]) { match2 = false; break; }
          }
          if (match2) return "image/webp";
          continue;
        }
        return sig.mime;
      }
    }
  }
  return null;
}

/**
 * Middleware: validate upload buffer (cho express.raw endpoints)
 * Options: { maxBytes, allowedMimes: Set }
 */
function validateUploadBuffer({ maxBytes, allowedMimes }) {
  return (req, res, next) => {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;

    if (!buffer || buffer.length === 0) {
      return next(); // Để controller xử lý empty body
    }

    // Kiểm tra dung lượng
    if (maxBytes && buffer.length > maxBytes) {
      return res.status(413).json({
        success: false,
        code: "PAYLOAD_TOO_LARGE",
        error: `File vượt quá giới hạn ${Math.round(maxBytes / 1024 / 1024)}MB`,
      });
    }

    // Kiểm tra magic bytes
    if (allowedMimes) {
      const detectedType = detectFileType(buffer);
      const declaredType = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();

      if (detectedType && !allowedMimes.has(detectedType)) {
        return res.status(415).json({
          success: false,
          code: "UNSUPPORTED_FILE_TYPE",
          error: "Loại file không được hỗ trợ",
        });
      }

      // Nếu MIME khai báo khác với magic bytes (giả mạo MIME)
      if (detectedType && declaredType && allowedMimes.has(declaredType) && !allowedMimes.has(detectedType)) {
        return res.status(415).json({
          success: false,
          code: "MIME_MISMATCH",
          error: "Content-Type không khớp với nội dung file",
        });
      }
    }

    next();
  };
}

module.exports = {
  requireJsonContentType,
  sanitizeBodyStrings,
  validateUploadBuffer,
  detectFileType,
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  ALLOWED_AUDIO_MIMES,
};
