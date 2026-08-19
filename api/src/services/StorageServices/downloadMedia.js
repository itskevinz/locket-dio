const os = require("os");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { logError, logInfo } = require("../../utils/logEventUtils");
const { getTodayFolder } = require("../../helpers/dayHelpers");
const r2Storage = require("./r2Storage");

// Deployment marker: direct R2 temp-media reads are required in production.
function extractTempMediaId(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value), "https://huy-locket.local");
    const match = parsed.pathname.match(/\/api\/media-temp\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    const match = String(value).match(/\/api\/media-temp\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

const downloadMediaOnStorage = async (
  url,
  mediaType = "image",
  filename = "temp"
) => {
  try {
    // Media tạm của Huy Locket đã nằm trong private R2. Khi backend cần đọc
    // lại file để xử lý/đăng Locket, đọc trực tiếp bằng S3 credentials thay vì
    // gọi vòng qua duchi.vercel.app/dio-api. Request server-to-server qua web
    // có thể mang IP AWS/Vercel và bị WAF chặn 403 dù object R2 vẫn tồn tại.
    const tempMediaId = extractTempMediaId(url);
    if (tempMediaId && r2Storage.isConfigured()) {
      try {
        const object = await r2Storage.getBuffer(tempMediaId);
        if (object?.buffer?.length) {
          logInfo(
            "downloadMediaOnStorage",
            `Loaded ${tempMediaId} directly from R2 (${object.buffer.length} bytes)`,
          );
          return { buffer: object.buffer, path: null };
        }
      } catch (r2Error) {
        // Giữ fallback HTTP cho object cũ/local-temp trong giai đoạn chuyển đổi.
        logInfo(
          "downloadMediaOnStorage",
          `Direct R2 read unavailable for ${tempMediaId}; trying URL fallback: ${r2Error.message}`,
        );
      }
    }

    // Thư mục tạm dựa trên hệ thống
    const tmpBaseDir = path.join(os.tmpdir(), "dowloads-media");

    // Thư mục con theo loại media
    const downloadDir =
      mediaType === "image"
        ? path.join(tmpBaseDir, getTodayFolder(), "images")
        : path.join(tmpBaseDir, getTodayFolder(), "videos");

    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    // Xác định phần mở rộng
    const ext = mediaType === "image" ? ".webp" : ".mp4";

    // Loại bỏ phần mở rộng cũ nếu filename đã có
    let safeName = filename.replace(/\//g, "_");
    if (!safeName.endsWith(ext)) {
      safeName += ext;
    }

    // Đường dẫn file cuối cùng
    const downloadPath = path.join(downloadDir, safeName);

    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    if (response.status !== 200) {
      throw new Error(`Tải media thất bại với mã lỗi: ${response.status}`);
    }

    const writer = fs.createWriteStream(downloadPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        fs.readFile(downloadPath, (err, data) => {
          if (err) return reject(new Error("Lỗi đọc file tạm: " + err.message));
          resolve({ buffer: data, path: downloadPath }); // Trả về cả buffer và đường dẫn file
        });
      });
      writer.on("error", (err) =>
        reject(new Error("Lỗi ghi file: " + err.message))
      );
    });
  } catch (err) {
    logError(
      "downloadMediaOnStorage",
      `❌ Lỗi khi tải media từ URL: ${err.message}`
    );
    return null;
  }
};

module.exports = { downloadMediaOnStorage };
