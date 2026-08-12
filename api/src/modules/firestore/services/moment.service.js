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
 * Initialize a resumable upload session on Firebase Storage.
 * Returns the signed resumable upload URL from the response headers.
 */
const initResumableSession = async (uploadUrl, body, meta) => {
  const response = await instanceFirestoreInit.post(uploadUrl, body, { meta });
  const resumableUrl =
    response.headers["x-goog-upload-url"] ||
    response.headers["X-Goog-Upload-URL"];
  if (!resumableUrl) {
    throw new Error("Missing upload URL in Firebase response headers");
  }
  return resumableUrl;
};

/**
 * Attempt a finalize PUT on a resumable URL. If the first attempt fails with
 * 403, refresh the App Check token, re-init a brand-new resumable session, and
 * retry the upload once. This handles the case where a resumable session has
 * expired or Firebase tightened storage-rule enforcement between init and
 * finalize.
 *
 * @returns {Promise<void>}
 */
const finalizeWithRetry = async ({
  buffer,
  resumableUploadUrl,
  uploadUrl,
  body,
  initMeta,
  scope,
}) => {
  const MAX_ATTEMPTS = 2;
  let currentUrl = resumableUploadUrl;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await instanceFirestoreUpload.put(currentUrl, buffer);
      return; // success
    } catch (err) {
      const status = Number(err?.response?.status || err?.status || 0);
      logStorageRejection(`${scope}:finalize(attempt ${attempt})`, err, {
        fileSize: buffer.length,
      });

      // Only retry on 403 and only once
      if (status === 403 && attempt < MAX_ATTEMPTS) {
        logInfo(
          scope,
          "Finalize 403 — refreshing AppCheck token and re-initializing resumable session...",
        );
        try {
          const { appCheckServices } = require("../../appcheck/services");
          const freshAppCheck =
            await appCheckServices.getOrCreateAppCheckToken();
          const retryMeta = { ...initMeta, appCheckToken: freshAppCheck };
          currentUrl = await initResumableSession(uploadUrl, body, retryMeta);
          logInfo(scope, "Re-init succeeded, retrying finalize...");
        } catch (reinitErr) {
          logStorageRejection(`${scope}:re-init`, reinitErr, {
            fileSize: buffer.length,
          });
          // Cannot re-init → throw the original finalize error
          throw createStorageUploadError(
            `Failed to upload ${scope.includes("video") ? "video" : "image"} to Firebase Storage`,
            err,
            { stage: "finalize", fileSize: buffer.length },
          );
        }
        continue; // retry finalize with fresh session
      }

      // Non-403 or exhausted retries → throw
      throw createStorageUploadError(
        `Failed to upload ${scope.includes("video") ? "video" : "image"} to Firebase Storage`,
        err,
        { stage: "finalize", fileSize: buffer.length },
      );
    }
  }
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

    const initMeta = {
      idToken,
      appCheckToken,
      fileSize,
      contentType: "image/webp",
    };

    let resumableUploadUrl;
    try {
      resumableUploadUrl = await initResumableSession(
        uploadUrl,
        body,
        initMeta,
      );
    } catch (err) {
      logStorageRejection("uploadMomentImage:init", err, { fileSize });
      throw createStorageUploadError(
        "Failed to initialize moment image upload",
        err,
        { stage: "init", fileSize },
      );
    }

    let imageBuffer;
    if (fileBuffer instanceof Buffer) {
      imageBuffer = fileBuffer;
    } else {
      imageBuffer = fs.readFileSync(fileBuffer.path);
    }

    // Finalize: upload binary data via the resumable URL.
    // Retries once with a fresh session if the finalize is rejected with 403.
    await finalizeWithRetry({
      buffer: imageBuffer,
      resumableUploadUrl,
      uploadUrl,
      body,
      initMeta,
      scope: "uploadMomentImage",
    });

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

    const initMeta = {
      idToken,
      appCheckToken,
      fileSize: videoSize,
      contentType: "video/mp4",
    };

    let resumableUploadUrl;
    try {
      resumableUploadUrl = await initResumableSession(
        uploadUrl,
        body,
        initMeta,
      );
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

    let videoBuffer;
    if (fileBuffer instanceof Buffer) {
      videoBuffer = fileBuffer;
    } else {
      videoBuffer = fs.readFileSync(fileBuffer.path);
    }

    // Finalize: upload binary data via the resumable URL.
    // Retries once with a fresh session if the finalize is rejected with 403.
    await finalizeWithRetry({
      buffer: videoBuffer,
      resumableUploadUrl,
      uploadUrl,
      body,
      initMeta,
      scope: "uploadMomentVideo",
    });

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
