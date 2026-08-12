const fs = require("fs");
const { logInfo, logError } = require("../../../utils/logEventUtils");
const {
  instanceFirestoreUpload,
  instanceFirestoreInit,
  instanceFirestoreGet,
} = require("../utils/http");
const { generateFirestoreId } = require("../../../utils");
const { buildResumableUploadUrl } = require("../utils/resumableUpload");

const createStorageUploadError = (message, cause) => {
  const error = new Error(message);
  const status = Number(cause?.response?.status || cause?.status || 0);
  if (status >= 400 && status <= 599) {
    error.status = status;
  }
  error.code = status === 403 ? "FIREBASE_STORAGE_FORBIDDEN" : "FIREBASE_STORAGE_UPLOAD_FAILED";
  return error;
};

/**
 * Tải hình ảnh khoảnh khắc (moment image) lên Firebase Storage.
 *
 * @param {string} localId - ID người dùng sở hữu khoảnh khắc
 * @param {string} idToken - Firebase ID token để xác thực
 * @param {File|Buffer} fileBuffer - Dữ liệu tệp hình ảnh (Buffer hoặc đối tượng File chứa thuộc tính path)
 * @param {string} [mediaId] - (Tuỳ chọn) ID dùng làm tên file. Nếu không truyền, sẽ tự sinh ID mới.
 *                             Truyền cùng mediaId với uploadMomentVideo để thumbnail và video có cùng tên base.
 * @returns {Promise<string>} Trả về URL tải về công khai của ảnh kèm token truy cập
 */
const uploadMomentImage = async (localId, idToken, fileBuffer, mediaId) => {
  try {
    logInfo("uploadMomentImage", "Start");

    // Nếu mediaId được truyền vào thì dùng luôn, ngược lại tự sinh ID mới
    const imageId = mediaId || generateFirestoreId();
    const imageName = `${imageId}.webp`;
    const fileSize = fileBuffer.size || fileBuffer.length;

    logInfo("uploadMomentImage", "Create name Image", {
      localId,
      imageName,
      fileSize,
    });

    // Bước 1: Khởi tạo đường dẫn lưu trữ khoảnh khắc ảnh (định dạng thumbnail webp)
    const objectPath = `users/${localId}/moments/thumbnails/${imageName}`;

    // Bước 2: Tạo link upload và URL gốc của tệp trên bucket locket-img
    const { uploadUrl, objectUrl } = buildResumableUploadUrl({
      bucket: "locket-img",
      objectPath: objectPath,
    });

    const body = {
      name: objectPath,
      contentType: "image/*",
      bucket: "",
      metadata: { creator: localId, visibility: "private" },
      cacheControl: "public, max-age=604800",
    };

    // Bước 3: Gửi yêu cầu khởi tạo session upload để lấy Upload URL từ Firebase
    const response = await instanceFirestoreInit.post(uploadUrl, body, {
      meta: {
        idToken,
        fileSize,
        contentType: "image/webp",
      },
    });

    const resumableUploadUrl = response.headers["x-goog-upload-url"] || response.headers["X-Goog-Upload-URL"];
    if (!resumableUploadUrl) {
      throw new Error("Missing upload URL in Firebase response headers");
    }

    // Bước 4: Chuyển đổi dữ liệu ảnh thành Buffer
    let imageBuffer;
    if (fileBuffer instanceof Buffer) {
      imageBuffer = fileBuffer;
    } else {
      imageBuffer = fs.readFileSync(fileBuffer.path);
    }

    // Bước 5: Upload dữ liệu binary lên Firebase Storage theo finalization request của Locket/iOS
    try {
      await instanceFirestoreUpload.put(resumableUploadUrl, imageBuffer);
    } catch (err) {
      console.error("Upload error detail:", err);
      throw createStorageUploadError(
        "Failed to upload moment image to Firebase Storage",
        err,
      );
    }

    // Bước 6: Lấy metadata để lấy token downloadToken
    const getRes = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken },
    });

    if (!getRes?.data?.downloadTokens) {
      throw new Error("Missing download tokens in uploaded file metadata");
    }

    const downloadToken = getRes.data.downloadTokens;

    logInfo("uploadMomentImage", "End");

    // Bước 7: Trả về URL tải về công khai
    const finalUrl = `${objectUrl}?alt=media&token=${downloadToken}`;
    return finalUrl;
  } catch (error) {
    logError("uploadMomentImage", error.message);
    throw error;
  } finally {
    // Bước 8: Dọn dẹp tệp tin tạm trên đĩa
    if (fileBuffer.path) {
      try {
        fs.unlinkSync(fileBuffer.path);
      } catch (unlinkErr) {
        logError("uploadMomentImage clean-up error", unlinkErr.message);
      }
    }
  }
};

/**
 * Tải video khoảnh khắc (moment video) lên Firebase Storage.
 *
 * @param {string} localId - ID người dùng sở hữu khoảnh khắc
 * @param {string} idToken - Firebase ID token dùng để xác thực
 * @param {File|Buffer} fileBuffer - Dữ liệu tệp video (Buffer hoặc đối tượng File chứa thuộc tính path)
 * @param {string} [mediaId] - (Tuỳ chọn) ID dùng làm tên file. Nếu không truyền, sẽ tự sinh ID mới.
 *                             Truyền cùng mediaId với uploadMomentImage để video và thumbnail có cùng tên base.
 * @returns {Promise<string>} Trả về URL tải về công khai của video kèm token truy cập
 */
const uploadMomentVideo = async (localId, idToken, fileBuffer, mediaId) => {
  try {
    logInfo("uploadMomentVideo", "Start");

    // Nếu mediaId được truyền vào thì dùng luôn, ngược lại tự sinh ID mới
    const videoId = mediaId || generateFirestoreId();
    const videoName = `${videoId}.mp4`;
    const videoSize = fileBuffer.length || fileBuffer.size;

    logInfo("uploadMomentVideo", "Create name Video:", {
      localId,
      videoName,
      videoSize,
    });

    // Bước 1: Khởi tạo đường dẫn lưu trữ khoảnh khắc video (định dạng mp4)
    const objectPath = `users/${localId}/moments/videos/${videoName}`;

    // Bước 2: Tạo link upload và URL gốc của tệp trên bucket locket-video
    const { uploadUrl, objectUrl } = buildResumableUploadUrl({
      bucket: "locket-video",
      objectPath: objectPath,
    });

    const body = {
      name: objectPath,
      contentType: "video/mp4",
      bucket: "",
      metadata: { creator: localId, visibility: "private" },
      cacheControl: "public, max-age=604800",
    };

    // Bước 3: Khởi tạo quá trình tải lên để nhận Upload URL
    const response = await instanceFirestoreInit.post(uploadUrl, body, {
      meta: {
        idToken: idToken,
        fileSize: videoSize,
        contentType: "video/mp4",
      },
    });

    const resumableUploadUrl = response.headers["x-goog-upload-url"] || response.headers["X-Goog-Upload-URL"] || (typeof response.headers.get === "function" && response.headers.get("X-Goog-Upload-URL"));
    if (!resumableUploadUrl) {
      throw new Error("Missing upload URL in Firebase response headers");
    }

    // Bước 4: Chuyển đổi dữ liệu video thành Buffer
    let videoBuffer;
    if (fileBuffer instanceof Buffer) {
      videoBuffer = fileBuffer;
    } else {
      videoBuffer = fs.readFileSync(fileBuffer.path);
    }

    // Bước 5: Thực hiện PUT dữ liệu binary video lên Firebase Storage
    try {
      await instanceFirestoreUpload.put(resumableUploadUrl, videoBuffer);
    } catch (err) {
      console.error("Upload error detail:", err);
      throw createStorageUploadError(
        "Failed to upload moment video to Firebase Storage",
        err,
      );
    }

    // Bước 6: Gọi API GET để kiểm tra sự tồn tại và lấy download token
    const getResponse = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken },
    });

    if (!getResponse?.data?.downloadTokens) {
      throw new Error("Missing download tokens in uploaded video metadata");
    }

    const downloadToken = getResponse.data.downloadTokens;

    logInfo("uploadMomentVideo", "End");

    // Bước 7: Trả về liên kết xem video trực tiếp có token xác thực
    const finalUrl = `${objectUrl}?alt=media&token=${downloadToken}`;
    return finalUrl;
  } catch (error) {
    console.error("❌ uploadMomentVideo error details:", {
      message: error.message,
      stack: error.stack,
    });
    logError("uploadMomentVideo", error.message);
    throw error;
  } finally {
    // Bước 8: Giải phóng tệp tin tạm trên đĩa
    if (fileBuffer.path) {
      try {
        fs.unlinkSync(fileBuffer.path);
      } catch (unlinkErr) {
        logError("uploadMomentVideo clean-up error", unlinkErr.message);
      }
    }
  }
};

module.exports = {
  uploadMomentImage,
  uploadMomentVideo,
};
