const fs = require("fs");
const { logInfo, logError } = require("../../../utils/logEventUtils");
const {
  instanceFirestoreUpload,
  instanceFirestoreInit,
  instanceFirestoreGet,
} = require("../utils/http");
const { generateFirestoreId } = require("../../../utils");
const { buildResumableUploadUrl } = require("../utils/resumableUpload");

const createStorageUploadError = (
  message,
  cause,
  { stage = "finalize", fileSize = 0 } = {},
) => {
  const error = new Error(message);
  const status = Number(cause?.response?.status || cause?.status || 0);
  if (status >= 400 && status <= 599) {
    error.status = status;
  }
  error.stage = stage;
  error.fileSize = Number(fileSize) || 0;
  error.code = status === 403
    ? stage === "init"
      ? "FIREBASE_STORAGE_INIT_FORBIDDEN"
      : "FIREBASE_STORAGE_FINALIZE_FORBIDDEN"
    : "FIREBASE_STORAGE_UPLOAD_FAILED";
  if (status === 403) {
    const sizeMB = error.fileSize
      ? `, ${(error.fileSize / 1024 / 1024).toFixed(2)} MB`
      : "";
    error.message = stage === "init"
      ? "Firebase Storage từ chối khởi tạo upload (403). Phiên đăng nhập hoặc App Check có thể đã hết hạn."
      : `Firebase Storage từ chối hoàn tất upload (403${sizeMB}).`;
  }
  return error;
};

const logStorageRejection = (scope, err, details = {}) => {
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
    ...details,
  });
};

/**
 * Tải hình ảnh khoảnh khắc (moment image) lên Firebase Storage.
 * @param {string} localId - ID người dùng sở hữu khoảnh khắc
 * @param {string} idToken - Firebase ID token để xác thực
 * @param {File|Buffer} fileBuffer - Dữ liệu tệp hình ảnh (Buffer hoặc đối tượng File chứa thuộc tính path)
 * @param {string} [mediaId] - (Tuỳ chọn) ID dùng làm tên file. Nếu không truyền, sẽ tự sinh ID mới.
 * @returns {Promise<string>} URL Firebase đã được Locket chấp nhận để dùng cho postMomentV2
 */
const uploadMomentImage = async (
  localId,
  idToken,
  fileBuffer,
  mediaId,
  appCheckToken,
) => {
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

    let response;
    try {
      response = await instanceFirestoreInit.post(uploadUrl, body, {
        meta: {
          idToken,
          appCheckToken,
          fileSize,
          contentType: "image/webp",
        },
      });
    } catch (err) {
      logStorageRejection("uploadMomentImage:init", err, { fileSize });
      throw createStorageUploadError(
        "Failed to initialize moment image upload",
        err,
        { stage: "init", fileSize },
      );
    }

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
      // The resumable URL returned by Firebase already carries the upload
      // session authorization. Adding a short-lived App Check/ID token here
      // caused valid sessions to be rejected intermittently with 403.
      await instanceFirestoreUpload.put(resumableUploadUrl, imageBuffer);
    } catch (err) {
      logStorageRejection("uploadMomentImage:finalize", err, {
        fileSize: imageBuffer.length,
      });
      throw createStorageUploadError(
        "Failed to upload moment image to Firebase Storage",
        err,
        { stage: "finalize", fileSize: imageBuffer.length },
      );
    }

    const getRes = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken, appCheckToken },
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
const uploadMomentVideo = async (
  localId,
  idToken,
  fileBuffer,
  mediaId,
  appCheckToken,
) => {
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

    let response;
    try {
      response = await instanceFirestoreInit.post(uploadUrl, body, {
        meta: {
          idToken: idToken,
          appCheckToken,
          fileSize: videoSize,
          contentType: "video/mp4",
        },
      });
    } catch (err) {
      logStorageRejection("uploadMomentVideo:init", err, {
        fileSize: videoSize,
      });
      throw createStorageUploadError(
        "Failed to initialize moment video upload",
        err,
        { stage: "init", fileSize: videoSize },
      );
    }

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
      logStorageRejection("uploadMomentVideo:finalize", err, {
        fileSize: videoBuffer.length,
      });
      throw createStorageUploadError(
        "Failed to upload moment video to Firebase Storage",
        err,
        { stage: "finalize", fileSize: videoBuffer.length },
      );
    }

    const getResponse = await instanceFirestoreGet.get(objectUrl, {
      meta: { idToken, appCheckToken },
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

const uploadMomentVideoThumbnail = async (
  localId,
  idToken,
  _video,
  thumbnail,
  mediaId,
  appCheckToken,
) => {
  logInfo("uploadMomentVideoThumbnail", "Start uploading thumbnail", {
    mediaId,
  });
  return uploadMomentImage(
    localId,
    idToken,
    thumbnail,
    mediaId,
    appCheckToken,
  );
};

module.exports = {
  uploadMomentImage,
  uploadMomentVideo,
  uploadMomentVideoThumbnail,
};
