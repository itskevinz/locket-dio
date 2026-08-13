const { supabase, isSupabaseConfigured } = require("../../../config/supabase");
const {
  getUserStats,
} = require("../../../utils/cache/localUploadStats");

/**
 * Full Premium for every user (Huy Locket free-for-all / self-host).
 * No paywall — all premium features + high limits, never expires.
 */
async function buildLocalFreePlan(uid, email, phone, name, picture) {
  const now = new Date().toISOString();
  const short = String(uid || "guest").slice(0, 6).toUpperCase();
  const uploadStats = await getUserStats(uid);
  return {
    user: {
      uid,
      email: email ?? null,
      phone: phone ?? null,
      name: name ?? null,
      picture: picture ?? null,
      customer_code: `HL-${short}`,
      is_active: true,
      deleted_at: null,
      created_at: now,
      updated_at: now,
    },
    plan: {
      id: "premium",
      name: "Premium",
      badge: {
        text: "Premium",
        gradient: "linear-gradient(135deg, #a855f7, #ec4899)",
        highlight_color: "#ffffff",
      },
    },
    subscription: {
      is_active: true,
      start_at: now,
      expires_at: null, // vĩnh viễn
      is_expired: false,
    },
    upload_stats: uploadStats,
    features: {
      camera: true,
      upload: true,
      moments: true,
      unlimited_media: true,
      unlimited_storage: true,
      custom_theme: true,
      high_quality: true,
      priority_support: true,
      early_access: true,
      longer_video: true,
      all_tools: true,
      music: true,
      caption: true,
      friends: true,
      widget: true,
    },
    feature_blocks: {},
    limits: {
      // Technical per-file cap; total storage remains unrestricted.
      image_storage_limit_mb: 10,
      video_storage_limit_mb: 99999,
      storage_limit_mb: 99999,
      video_record_max_length: 15,
      daily_image_limit: null,
      daily_video_limit: null,
    },
  };
}

exports.getUserPlanV3 = async (uid) => {
  if (!isSupabaseConfigured) {
    return null; // controller will register local free plan
  }

  const { data, error } = await supabase
    .from("v_user_profile_full")
    .select("*")
    .eq("uid", uid)
    .single();

  if (error && error.code === "PGRST116") return null;

  if (error) throw new Error(error.message);

  if (!data) return null;

  return data;
};

exports.getMemberFamily = async (uid) => {
  if (!isSupabaseConfigured) return null;

  const { data, error } = await supabase
    .from("v_membership_detail")
    .select("*")
    .eq("owner_uid", uid)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data || null;
};

exports.registerDefaultPlan = async (uid, email, phone, name, picture) => {
  if (!isSupabaseConfigured) {
    // No DB — plan lives only in this request response (free local).
    return buildLocalFreePlan(uid, email, phone, name, picture);
  }

  const { error } = await supabase.rpc("upsert_user_plan", {
    p_uid: uid,
    p_email: email ?? null,
    p_phone: phone ?? null,
    p_name: name ?? null,
    p_picture: picture ?? null,
  });

  if (error) throw new Error(error.message);
};

exports.getLocalFreePlan = buildLocalFreePlan;

exports.updateInfoUserPlan = async ({
  uid,
  email,
  phone,
  name,
  picture,
  username,
}) => {
  if (!isSupabaseConfigured) return true;

  const { error } = await supabase.rpc("upsert_user_plan", {
    p_uid: uid,
    p_email: email ?? null,
    p_phone: phone ?? null,
    p_name: name ?? null,
    p_picture: picture ?? null,
    p_username: username ?? null,
  });

  if (error)
    throw new Error("❌ Cập nhật thông tin user thất bại: " + error.message);

  return true;
};

exports.ValidateCoupon = async ({ code, planId, user_id, subtotal }) => {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabase.rpc("check_and_apply_coupon", {
      p_plan_id: planId,
      p_coupon_code: code,
      p_user_id: user_id,
    });
    console.log(data);

    if (error) {
      console.error("❌ Lỗi khi kiểm tra coupon:", error.message);
      return null;
    }

    if (!data) return null;

    return data;
  } catch (err) {
    console.error("❌ Lỗi khi gọi Supabase Function:", err.message);
    throw err;
  }
};
