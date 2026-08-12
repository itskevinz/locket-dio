const {
  updateUploadStats,
  updateUploadStatsErrorCode,
} = require("../../../services/DioServices/UpTodateStats");
const {
  logInfo,
  logSuccess,
  logWarning,
  logGroup,
  logBanner,
  logLoading,
  logTable,
  logError,
} = require("../../../utils/logEventUtils");
const {
  processImageBuffer,
} = require("../../../utils/process/processImageBuffer");
const {
  processVideoBuffer,
  generateThumbnail,
} = require("../../../utils/process/processVideoBuffer");
const { formatFileSize } = require("../../../helpers/formatHelpers");
const { deleteTempFile } = require("../../../helpers/memoryHelpers");
const {
  isUploadAllowed,
  getResolution,
} = require("../../../services/DioServices/DioSecurity");
const serverConfig = require("../../../config/app.config");
const { storageServices } = require("../../../services");
const { postImageToLocketV2, postVideoToLocketV2 } = require("../services");
const { signature } = require("../../../utils/tokenUtils");
const {
  sendDiscordWebhook,
} = require("../../../utils/logCustome/sendDiscordWebhook");
const {
  hasInvalidSignatureLog,
  markInvalidSignatureLog,
} = require("../../../utils/logCustome/invalidSignatureStore");

const { limits } = serverConfig;

const getClientIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip;
};

const uploadMediaV3 = async (req, res, next) => {
  await logGroup(`📤 Upload Media Attempt`, async () => {
    logBanner("uploadMediaV3", "V3");
    try {
      logInfo("uploadMediaV3", "Start");

      const {
        mediaInfo,
        status,
        retryCount = 0,
        errorMessage = null,
        optionsData,
      } = req.body;
      const { localId, idToken } = req.user;
      const planData = req.plan;
      const {
        type,
        publicUrl,
        downloadURL,
        publicURL,
        url,
        name,
        size,
        path,
        mediaSignature,
      } = mediaInfo;

      if (!mediaInfo || !optionsData) {
        return res.status(400).json({
          message: "Missing mediaInfo or optionsData",
        });
      }
      const sizeInMB = size / (1024 * 1024);
      const technicalLimitMB =
        type === "image" ? limits.maxImageSize : limits.maxSizeAllowedFree;
      if (!isUploadAllowed(planData, sizeInMB, technicalLimitMB)) {
        logWarning(
          "uploadMediaV3",
          `🚫 Upload bị từ chối do vượt giới hạn gói`,
        );
        return res.status(413).json({
          success: false,
          code: type === "image" ? "IMAGE_TOO_LARGE" : "MEDIA_TOO_LARGE",
          message:
            type === "image"
              ? `Ảnh vượt quá giới hạn ${technicalLimitMB} MB.`
              : `Media vượt quá giới hạn ${technicalLimitMB} MB.`,
        });
      }
      logTable(
        "uploadMediaV3",
        {
          localId,
          type,
          name,
          status,
          retryCount,
          errorMessage,
          size: `${formatFileSize(size)}`,
        },
        "Parsed incoming data",
      );

      const hasInline = Boolean(
        mediaInfo.mediaBase64 || mediaInfo.base64 || mediaInfo.dataBase64,
      );

      if (!hasInline && !path) {
        return res.status(400).json({ error: "Missing file path" });
      }

      const isInlinePath =
        typeof path === "string" &&
        (path.startsWith("inline_") || path.startsWith("inline://"));
      const skipSig = hasInline || isInlinePath;

      if (!skipSig && path && mediaSignature) {
        const isValid = signature.verifySignature(path, mediaSignature);

        logInfo(
          "uploadMediaV3",
          isValid
            ? "✅ Signature verified successfully"
            : "❌ Invalid signature detected!",
        );

        if (!isValid) {
          const cacheKey = `${localId}:${path}`;
          const alreadyLogged = hasInvalidSignatureLog(cacheKey);

          if (!alreadyLogged) {
            markInvalidSignatureLog(cacheKey, {
              ip: getClientIp(req),
            });

            sendDiscordWebhook({
              threadId: "1503837608177041567",
              title: "🚨 Invalid Media Signature",
              color: 0xff0000,
              fields: {
                User: localId,
                IP: getClientIp(req),
                Path: path,
                Signature: mediaSignature,
              },
              files: [
                {
                  name: "request-body.json",
                  content: JSON.stringify(
                    {
                      ...req.body,
                      mediaInfo: {
                        ...mediaInfo,
                        mediaBase64: mediaInfo.mediaBase64
                          ? "[omitted]"
                          : undefined,
                      },
                    },
                    null,
                    2,
                  ),
                },
              ],
            }).catch(() => {});
          }

          return res.status(400).json({
            success: false,
            message: "Failed to verify media signature",
            data: null,
          });
        }
      } else if (skipSig) {
        logInfo("uploadMediaV3", "✅ Inline media (skip temp signature)");
      }

      if (sizeInMB > 150) {
        const ip = getClientIp(req);
        logWarning("uploadMediaV3", `❌ File quá lớn bị từ chối`, {
          ip,
          size: `${sizeInMB.toFixed(2)}MB`,
          name,
        });
        return res
          .status(403)
          .json({ error: "File quá lớn (tối đa 150MB được phép)" });
      }

      logLoading("uploadMediaV3", "Loading media buffer");

      const sourceUrl = publicUrl || publicURL || downloadURL || url;
      let mediaBuffer = null;
      let mediaPath = null;

      const inlineB64 =
        mediaInfo.mediaBase64 ||
        mediaInfo.base64 ||
        mediaInfo.dataBase64 ||
        null;
      if (inlineB64 && typeof inlineB64 === "string") {
        try {
          const raw = inlineB64.includes(",")
            ? inlineB64.split(",").pop()
            : inlineB64;
          mediaBuffer = Buffer.from(raw, "base64");
          if (mediaBuffer.length > 0) {
            logSuccess(
              "uploadMediaV3",
              `Loaded inline base64: ${formatFileSize(mediaBuffer.length)}`,
            );
          } else {
            mediaBuffer = null;
          }
        } catch (e) {
          logWarning("uploadMediaV3", `base64 decode fail: ${e.message}`);
          mediaBuffer = null;
        }
      }

      if (!mediaBuffer?.length) {
        try {
          const tempMedia = require("../../storage/tempMediaStore");
          const local = path && tempMedia.get(path);
          if (local?.buffer?.length) {
            mediaBuffer = local.buffer;
            mediaPath = local.filePath || null;
            logSuccess(
              "uploadMediaV3",
              `Loaded from temp store: ${formatFileSize(mediaBuffer.length)}`,
            );
          }
        } catch (e) {
          logWarning("uploadMediaV3", `temp store skip: ${e.message}`);
        }
      }

      if (!mediaBuffer?.length) {
        if (
          sourceUrl &&
          !String(sourceUrl).startsWith("inline:") &&
          !String(sourceUrl).startsWith("inline://")
        ) {
          const media = await storageServices.downloadMediaOnStorage(
            sourceUrl,
            type,
            name,
          );

          if (media?.buffer?.length) {
            mediaBuffer = media.buffer;
            mediaPath = media.path;
            logSuccess(
              "uploadMediaV3",
              `Downloaded media: ${formatFileSize(mediaBuffer.length)}`,
            );
          }
        }
      }

      if (!mediaBuffer?.length) {
        logWarning(
          "uploadMediaV3",
          `No media buffer path=${path} url=${String(sourceUrl || "").slice(0, 100)} inline=${Boolean(inlineB64)}`,
        );
        return res.status(404).json({
          message:
            "Không thể tải media (file rỗng hoặc hết hạn). Hãy chụp/chọn lại ảnh.",
        });
      }

      let processedBuffer;
      let thumbBuffer;

      try {
        if (type === "image") {
          // Accept 4K/high-resolution phone sources, then normalize the final
          // Locket object. Dark/noisy close-ups expand dramatically as
          // lossless WebP, so native 32 MB outputs can be rejected by Firebase
          // Storage Rules with a content-dependent 403.
          const resolution = getResolution({
            planData,
            normal: 1920,
            member: 2048,
          });
          processedBuffer = await processImageBuffer({
            imageBuffer: mediaBuffer,
            maxSizeMB: 2.5,
            resolution,
          });
        } else if (type === "video") {
          let videoCropData = null;
          if (optionsData) {
            if (typeof optionsData === "string") {
              try {
                const parsed = JSON.parse(optionsData);
                videoCropData = parsed?.videoCropData;
              } catch (e) {
                logWarning(
                  "uploadMediaV3",
                  "Failed to parse optionsData as JSON string",
                );
              }
            } else if (typeof optionsData === "object") {
              videoCropData = optionsData.videoCropData;
            }
          }

          processedBuffer = await processVideoBuffer({
            videoBuffer: mediaBuffer,
            filename: name,
            maxSizeMB: limits.maxVideoSizeMB,
            videoCropData,
          });
          thumbBuffer = await generateThumbnail(processedBuffer, localId);
        }
      } finally {
        deleteTempFile(mediaPath);
      }

      if (processedBuffer.length > 50 * 1024 * 1024) {
        logWarning(
          "uploadMediaV3",
          `File quá lớn sau xử lý: ${formatFileSize(processedBuffer.length)}`,
        );
        return res.status(403).json({ message: "Permission denied!" });
      }

      const {
        mediaBase64: _b64,
        base64: _b64b,
        dataBase64: _b64c,
        ...mediaInfoSafe
      } = mediaInfo;

      const mediaData = {
        fileBuffer: processedBuffer,
        thumbnail: thumbBuffer,
        publicId: name,
        size: mediaBuffer.length || size,
        ...mediaInfoSafe,
      };

      let response;

      if (type === "image") {
        logInfo("uploadMediaV3", "Posting image...");
        response = await postImageToLocketV2({
          idToken,
          localId,
          mediaData,
          optionsData,
        });
      } else if (type === "video") {
        logInfo("uploadMediaV3", "Posting video...");
        response = await postVideoToLocketV2({
          idToken,
          localId,
          mediaData,
          optionsData,
        });
      }

      logSuccess("uploadMediaV3", "✅ Media posted successfully");

      await storageServices.deleteFileFromStorageR2(mediaData.path).catch(() => {});

      await updateUploadStats({
        uid: localId,
        mediaType: type,
        sizeInBytes: size,
      }).catch(() => {});

      logInfo("uploadMediaV3", "End - Success");

      return res.status(200).json({
        success: true,
        message: "ok",
        data: response,
      });
    } catch (error) {
      const { localId } = req.user;
      logInfo("uploadMediaV3", `Error: ${error.message}`);
      if (localId) {
        updateUploadStatsErrorCode(localId).catch(() => {});
      }
      console.error("❌ Lỗi upload media:", error);
      next(error);
    }
  });
};

module.exports = {
  uploadMediaV3,
};

const parseAndValidateLocketPath = (path) => {
  const regex =
    /^LocketCloud\/(Beta[\d.]+)\/(D-\d{2}-\d{2}-\d{2})\/(video|image)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.(\w+))$/;

  const match = path.match(regex);
  if (!match) return null;

  const [, client, folder, type, uid, filename, ext] = match;

  return {
    isValid: true,
    client,
    folder,
    type,
    uid,
    filename,
    ext,
    name: filename.replace(`.${ext}`, ""),
  };
};
