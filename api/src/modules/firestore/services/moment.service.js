const fs = require("fs");
const { logInfo, logError, logWarning } = require("../../../utils/logEventUtils");
const {
  instanceFirestoreUpload,
  instanceFirestoreInit,
  instanceFirestoreGet,
} = require("../utils/http");
const { generateFirestoreId } = require("../../../utils");
const { buildResumableUploadUrl } = require("../utils/resumableUpload");
const publishedMedia = require("../../storage/publishedMediaStore");

const createStorageUploadError = (message, cause) => {
  const error = new Error(message);
  const status = Number(cause?.response?.status || cause?.status || 0);
  if (status >= 400 && status <= 599) {
    error.status = status;
  }
  error.code = status === 403 ? "FIREBASE_STORAGE_FORBIDDEN" : "FIREBASE_STORAGE_UPLOAD_FAILED";
  return error;
};

const logStorageRejection = (scope, err) => {
  const data = err?.response?.data;
  const safeMessage =
    data?.error?.message ||
    data?.message ||
    (typeof data === "string" ? data.slice(0, 300) : undefined) ||
    err?.message ||
    "Unknown Firebase Storage error";
  console.error(`[${scope}] Firebase Storage rejected upload`, {
    status: err?.response?.status,
    code: data?.error?.code,
    message: safeMessage,
  });
};

/**
 * Tải hình ảnh khoảnh khắc (moment image) lên Firebase Storage.
 * Nếu Firebase từ chối ghi bằng 403, lưu ảnh vào volume bền vững của Huy Locket
 * và trả URL public để postMomentV2 vẫn có thể sử dụng ảnh.
 *
 * @param {string} localId - ID người dùng sở hữu khoảnh khắc
 * @param {string} idToken - Firebase ID token để xác thực
 * @param {File|Buffer} fileBuffer - Dữ liệu tệp hình ảnh (Buffer hoặc đối tượng File chứa thuộc tính path)
 * @param {string} [mediaId] - (Tuỳ chọn) ID dùng làm tên file. Nếu không truyền, sẽ tự sinh ID mới.
 * @returns {Promise<string>} URL ảnh dùng cho postMomentV2
 */
const uploadMomentImage = async (localId, idToken, fileBuffer, mediaId) => {
  try {
    logInfo("uploadMomentImage", "Start");

    const imageId = mediaId || generateFirestoreId();
    const imageName = `${imageId}.webp`;
    const fileSize = fileBuffer.size || fileBuffer.length;

    logInfo("uploadMomentImage", "Create name Image", {
      localId,
      imageName,
      fileSize,
    });

    const objectPath = `users/${localId}/moments/thumbnails/${imageName}`;
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

    let imageBuffer;
    if (fileBuffer instanceof Buffer) {
      imageBuffer = fileBuffer;
    } else {
      imageBuffer = fs.readFileSync(fileBuffer.path);
    }

    try {
      await instanceFirestoreUpload.put(resumableUploadUrl, imageBuffer);
    } catch (err) {
      logStorageRejection("uploadMomentImage", err);
      const status = Number(err?.response?.status || 0);

      if (status === 403) {
        try {
          const saved = publishedMedia.publishBuffer(imageBuffer, "image/webp");
          const fallbackUrl = publishedMedia.buildPublicUrl(saved.filename);
          logWarning(
            "uploadMomentImage",
            `Firebase 403 -> durable fallback ${saved.filename} (${saved.size} bytes)`,
          );
          return fallbackUrl;
        } catch (fallbackErr) {
          logError("uploadMomentImage fallback", fallbackErr.message);
        }
      }

      throw createStorageUploadError(
        "Failed to upload moment image to Firebase Storage",
        err,
      );
    }

    const getRes = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken },
    });

    if (!getRes?.data?.downloadTokens) {
      throw new Error("Missing download tokens in uploaded file metadata");
    }

    const downloadToken = getRes.data.downloadTokens;
    logInfo("uploadMomentImage", "End");
    return `${objectUrl}?alt=media&token=${downloadToken}`;
  } catch (error) {
    logError("uploadMomentImage", error.message);
    throw error;
  } finally {
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
 * @returns {Promise<string>} Trả về URL tải về công khai của video kèm token truy cập
 */
const uploadMomentVideo = async (localId, idToken, fileBuffer, mediaId) => {
  try {
    logInfo("uploadMomentVideo", "Start");

    const videoId = mediaId || generateFirestoreId();
    const videoName = `${videoId}.mp4`;
    const videoSize = fileBuffer.length || fileBuffer.size;

    logInfo("uploadMomentVideo", "Create name Video:", {
      localId,
      videoName,
      videoSize,
    });

    const objectPath = `users/${localId}/moments/videos/${videoName}`;
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

    let videoBuffer;
    if (fileBuffer instanceof Buffer) {
      videoBuffer = fileBuffer;
    } else {
      videoBuffer = fs.readFileSync(fileBuffer.path);
    }

    try {
      await instanceFirestoreUpload.put(resumableUploadUrl, videoBuffer);
    } catch (err) {
      logStorageRejection("uploadMomentVideo", err);
      throw createStorageUploadError(
        "Failed to upload moment video to Firebase Storage",
        err,
      );
    }

    const getResponse = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken },
    });

    if (!getResponse?.data?.downloadTokens) {
      throw new Error("Missing download tokens in uploaded video metadata");
    }

    const downloadToken = getResponse.data.downloadTokens;
    logInfo("uploadMomentVideo", "End");
    return `${objectUrl}?alt=media&token=${downloadToken}`;
  } catch (error) {
    console.error("❌ uploadMomentVideo error details:", {
      message: error.message,
      stack: error.stack,
    });
    logError("uploadMomentVideo", error.message);
    throw error;
  } finally {
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
