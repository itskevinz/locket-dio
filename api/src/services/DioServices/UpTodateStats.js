// utils/uploadStats.js
const { supabase, isSupabaseConfigured } = require("../../config/supabase");
const { formatFileSize } = require("../../helpers/formatHelpers");
const {
  logInfo,
  logError,
  logSuccess,
  logTable,
} = require("../../utils/logEventUtils");
const {
  incrementUserStats,
  getUserStats,
} = require("../../utils/cache/localUploadStats");

//#region updateUploadStats
/**
 * Cập nhật thống kê upload cho user
 * @param {string} uid - User ID
 * @param {'image'|'video'} mediaType - Loại media
 * @param {number} sizeInBytes - Kích thước file (bytes)
 * @param {boolean} isError - Có lỗi hay không
 */
const updateUploadStats = async ({
  uid,
  mediaType,
  sizeInBytes,
  isError = false,
}) => {
  try {
    logTable(
      "updateUploadStats",
      {
        localId: uid,
        mediaType: mediaType || "N/A",
        sizeInBytes: sizeInBytes || 0,
        sizeInMB: formatFileSize(sizeInBytes),
        isError,
      },
      `${isError ? "❌ Upload Error" : "✅ Upload Success"} - User ${uid}`,
    );

    // Always keep a local copy so Pricing stats work without Supabase
    try {
      await incrementUserStats({
        uid,
        mediaType: isError ? null : mediaType,
        sizeInBytes: isError ? 0 : sizeInBytes,
        isError,
      });
    } catch (e) {
      logError("updateUploadStats", `Local stats fail: ${e.message}`);
    }

    if (!isSupabaseConfigured) {
      logInfo("updateUploadStats", "Local upload stats updated (no Supabase)");
      return true;
    }

    const { error } = await supabase.rpc("increment_upload_stats_v3", {
      p_uid: uid,
      p_media_type: isError ? null : mediaType,
      p_size_bytes: isError ? 0 : sizeInBytes,
      p_is_error: isError,
    });

    if (error) throw error;

    logSuccess("updateUploadStats", `Incrementing for user ${uid}`);

    return true;
  } catch (error) {
    logError(
      "updateUploadStats",
      `Error updating upload stats: ${error.message}`,
    );
    return false;
  }
};

/** Read stats for plan response / Pricing UI */
const getUploadStatsForUser = (uid) => getUserStats(uid);

/**
 * Cập nhật error_count +1 cho user khi có lỗi upload
 * @param {string} uid - User ID
 */

//#region updateUploadStatsErrorCode
const updateUploadStatsErrorCode = async (uid) => {
  try {
    logInfo(
      "updateUploadStatsErrorCode",
      `Incrementing error_count for user ${uid}`,
    );

    await updateUploadStats({
      uid: uid,
      mediaType: null,
      sizeInBytes: 0,
      isError: true,
    });

    return null;
  } catch (error) {
    logError(
      "updateUploadStatsErrorCode",
      `Error updating error count: ${error.message}`,
    );
    throw new Error(`Lỗi cập nhật số lần lỗi upload: ${error.message}`);
  }
};

module.exports = {
  updateUploadStats,
  updateUploadStatsErrorCode,
  getUploadStatsForUser,
};
