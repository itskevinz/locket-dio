const fs = require("fs");

const {
  logInfo,
  logError,
  logBanner,
} = require("../../../utils/logEventUtils");
const { videoPayloadV2 } = require("../payloads");
const { instanceLocketV2 } = require("../../../libs");
const {
  uploadMomentVideoThumbnail,
  uploadMomentVideo,
} = require("../../firestore");
const { generateFirestoreId } = require("../../../utils");
const {
  ensureMusicOptionsData,
} = require("../../music/services/ensureMusicPayload");
const {
  preserveSubmittedOverlay,
} = require("../utils/preserveSubmittedOverlay");
const { extractConfirmedMoment } = require("../utils/confirmedMoment");
const { appCheckServices } = require("../../appcheck/services");

const postVideoToLocket = async (
  idToken,
  videoUrl,
  thumbnailUrl,
  rawOptions,
  appCheckToken,
) => {
  try {
    let optionsData = rawOptions || {};
    if (optionsData.type === "music") {
      optionsData = await ensureMusicOptionsData(optionsData);
      const p = optionsData?.payload || {};
      if (!p.isrc) {
        const err = new Error(
          "Thiếu mã ISRC bài hát. Chọn lại bài từ tìm nhạc rồi đăng.",
        );
        err.status = 400;
        throw err;
      }
      if (!p.spotify_url && !p.apple_music_url) {
        const err = new Error(
          "Thiếu link Apple Music / Spotify. Chọn lại bài rồi đăng.",
        );
        err.status = 400;
        throw err;
      }
    }

    const { type } = optionsData;
    const postData = (() => {
      logBanner(`Type đang sử dụng: ${type}`);
      switch (type) {
        case "default":
          return videoPayloadV2.videoPostPayloadDefault({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "decorative":
          return videoPayloadV2.videoPostPayloadDecorative({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "custome":
        case "custom":
          return videoPayloadV2.videoPostPayloadCustome({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "image_icon":
        case "image_gif":
        case "caption_image":
        case "caption_gif":
        case "template":
          return videoPayloadV2.videoPostPayloadImageIcon({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "star_sign":
          return videoPayloadV2.videoPostPayloadStarSign({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "time":
          return videoPayloadV2.videoPostPayloadTime({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "review":
          return videoPayloadV2.videoPostPayloadReview({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "music":
          return videoPayloadV2.videoPostPayloadMusic({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "battery":
          return videoPayloadV2.videoPostPayloadBattery({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "heart":
          return videoPayloadV2.videoPostPayloadHeart({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "streak":
          return videoPayloadV2.videoPostPayloadStreak({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "locket_count":
          return videoPayloadV2.videoPostPayloadLocketCount({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "location":
          return videoPayloadV2.videoPostPayloadLocation({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "weather":
          return videoPayloadV2.videoPostPayloadWeather({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "special":
          return videoPayloadV2.videoPostPayloadEffect({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "color_palette":
          return videoPayloadV2.videoPostPayloadPalette({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        case "poll":
          return videoPayloadV2.videoPostPayloadPoll({
            videoUrl,
            thumbnailUrl,
            optionsData,
          });
        default:
          throw new Error(`Không hỗ trợ type: ${type}`);
      }
    })();

    const response = await instanceLocketV2.post("postMomentV2", postData, {
      meta: { idToken, appCheckToken },
    });

    if (!response.data) {
      throw new Error(`Failed to create post: ${response?.statusText}`);
    }

    const responseData = await response.data;
    const confirmedMoment = extractConfirmedMoment(responseData);
    const submittedMoment = preserveSubmittedOverlay(confirmedMoment, postData);

    logInfo("postVideoToLocket", "End");
    return submittedMoment;
  } catch (error) {
    logError("postVideoToLocket", error.message);
    console.error("Status:", error.response?.status);
    console.error("Response:", error.response?.data);
    console.error("Message:", error.message);

    const responseError = error.response?.data?.error;
    const wrapped = new Error(
      error.response?.data?.message ||
        responseError?.message ||
        (typeof responseError === "string" ? responseError : null) ||
        error.message ||
        "Failed to create post",
    );
    const status = Number(error.response?.status || error.status || 500);
    wrapped.status = status >= 400 && status <= 599 ? status : 500;
    wrapped.code = responseError?.code || error.code || "POST_MOMENT_FAILED";
    throw wrapped;
  }
};

const postVideoToLocketV2 = async ({
  idToken,
  localId,
  mediaData,
  optionsData,
}) => {
  try {
    if (!mediaData || !mediaData.fileBuffer) {
      throw new Error("File buffer is missing from media data");
    }

    const { fileBuffer, thumbnail } = mediaData;
    logInfo("postVideoToLocketV2", "Start");

    const mediaId = generateFirestoreId();
    logInfo("postVideoToLocketV2", `Shared mediaId: ${mediaId}`);
    const appCheckToken = await appCheckServices.getOrCreateAppCheckToken();

    let videoAsBuffer;
    if (Buffer.isBuffer(fileBuffer)) {
      videoAsBuffer = fileBuffer;
    } else if (fileBuffer && fileBuffer.path) {
      videoAsBuffer = fs.readFileSync(fileBuffer.path);
    } else {
      throw new Error("Invalid fileBuffer: path or Buffer is required.");
    }

    const thumbnailUrl = await uploadMomentVideoThumbnail(
      localId,
      idToken,
      fileBuffer,
      thumbnail,
      mediaId,
      appCheckToken,
    );

    if (!thumbnailUrl) {
      throw new Error("Failed to upload thumbnail");
    }

    const videoUrl = await uploadMomentVideo(
      localId,
      idToken,
      videoAsBuffer,
      mediaId,
      appCheckToken,
    );

    if (!videoUrl) {
      throw new Error("Failed to upload video");
    }

    const data = await postVideoToLocket(
      idToken,
      videoUrl,
      thumbnailUrl,
      optionsData,
      appCheckToken,
    );

    logInfo("postVideoToLocketV2", "End");
    data.video_url = videoUrl;
    data.thumbnail_url = thumbnailUrl;
    return data;
  } catch (error) {
    logError("postVideoToLocketV2", error.message);
    throw error;
  } finally {
    if (mediaData && mediaData.fileBuffer && mediaData.fileBuffer.path) {
      fs.unlinkSync(mediaData.fileBuffer.path);
    }
  }
};

module.exports = {
  postVideoToLocketV2,
};
