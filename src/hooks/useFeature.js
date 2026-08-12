import { useAuthStore } from "@/stores";
import { MAX_IMAGE_UPLOAD_MB } from "@/config/uploadLimits";

/**
 * Huy Locket — full Premium cho mọi user (không paywall).
 * Mọi feature flag client-side luôn mở; limits = gói Premium.
 * Không khóa theo plan / feature_blocks.
 */
export const FREE_FOR_ALL = true;

/** Giới hạn Premium (free-for-all) — không phải paywall */
const FREE_LIMITS = {
  maxImageSizeMB: MAX_IMAGE_UPLOAD_MB,
  maxVideoSizeMB: 50,
  storage_limit_mb: 99999,
  video_record_max_length: 15, // Premium: 15s
};

/**
 * Feature luôn visible khi FREE_FOR_ALL.
 * @param {string} [_type]
 * @returns {boolean}
 */
export const useFeatureVisible = (_type) => {
  if (FREE_FOR_ALL) return true;

  const userPlan = useAuthStore((s) => s.userPlan);
  if (!userPlan) return false;

  const blocks = userPlan?.feature_blocks || {};
  const features = userPlan?.features || {};

  if (blocks[_type]) return false;
  return features[_type] ?? false;
};

/**
 * Effective plan id for UI (pricing highlight, badge).
 * FREE_FOR_ALL → always "premium".
 */
export const useEffectivePlanId = () => {
  const userPlan = useAuthStore((s) => s.userPlan);
  if (FREE_FOR_ALL) return "premium";
  return userPlan?.plan?.id || "free";
};

export const useGetCode = () => {
  const userPlan = useAuthStore((s) => s.userPlan);
  return userPlan?.user?.customer_code;
};

export const getMaxUploads = () => {
  if (FREE_FOR_ALL) {
    return {
      maxImageSizeMB: FREE_LIMITS.maxImageSizeMB,
      maxVideoSizeMB: FREE_LIMITS.maxVideoSizeMB,
      storage_limit_mb: FREE_LIMITS.storage_limit_mb,
    };
  }

  const userPlan = useAuthStore((s) => s.userPlan);
  const limits = userPlan?.limits || {};

  return {
    maxImageSizeMB: limits.image_storage_limit_mb ?? FREE_LIMITS.maxImageSizeMB,
    maxVideoSizeMB: limits.video_storage_limit_mb ?? FREE_LIMITS.maxVideoSizeMB,
    storage_limit_mb: limits.storage_limit_mb ?? FREE_LIMITS.storage_limit_mb,
  };
};

export const getVideoRecordLimit = () => {
  if (FREE_FOR_ALL) return FREE_LIMITS.video_record_max_length;

  const userPlan = useAuthStore((s) => s.userPlan);
  return userPlan?.limits?.video_record_max_length ?? FREE_LIMITS.video_record_max_length;
};
