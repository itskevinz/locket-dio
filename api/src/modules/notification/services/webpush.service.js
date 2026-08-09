const webPush = require("web-push");
const { supabase, isSupabaseConfigured } = require("../../../config/supabase");
const { logInfo, logError } = require("../../../utils/logEventUtils");

// Legacy Supabase-backed Web Push. Canh Slot 24/7 quản lý VAPID riêng và lưu bền trong DB.
// Chỉ yêu cầu VAPID ở đây khi legacy Supabase push thực sự được cấu hình.
const vapidPublic = process.env.VAPID_PUBLIC_KEY || "";
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || "";
const isLegacyPushConfigured = Boolean(
  isSupabaseConfigured && vapidPublic && vapidPrivate,
);

if (!isSupabaseConfigured) {
  console.log(
    "[web-push] legacy Supabase push disabled; slot-monitor Web Push uses its own persistent VAPID config.",
  );
} else if (isLegacyPushConfigured) {
  webPush.setVapidDetails(
    "mailto:buiduchuy2010qn@gmail.com",
    vapidPublic,
    vapidPrivate,
  );
} else {
  console.warn(
    "[web-push] Legacy Supabase push is configured but VAPID keys are missing; legacy push send is disabled.",
  );
}

// Kích thước mỗi batch
const BATCH_SIZE = 100;

// Hàm chờ giữa các batch để tránh spam
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RegisterPush = async (subscription, origin) => {
  // Trích xuất endpoint để kiểm tra trùng lặp
  const endpoint = subscription?.endpoint;
  if (!endpoint) throw new Error("Thiếu endpoint trong subscription");
  console.log(subscription);

  if (!isSupabaseConfigured) {
    logInfo("RegisterPush", "Supabase off — skip push registration");
    return null;
  }

  const { data, error } = await supabase.from("push_subscriptions").upsert(
    {
      endpoint,
      subscription,
      origin,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "endpoint", // Đảm bảo không trùng
    },
  );

  if (error) throw error;
  return data;
};

const SyncRegisterPush = async (data, localId) => {
  // Trích xuất endpoint để kiểm tra trùng lặp
  const endpoint = data?.endpoint;
  if (!endpoint) throw new Error("Thiếu endpoint trong subscription");

  if (!isSupabaseConfigured) {
    logInfo("SyncRegisterPush", "Supabase off — skip push sync");
    return null;
  }

  const { error } = await supabase.rpc("save_push_subscription_v2", {
    p_user_id: localId,
    p_data: data,
  });

  if (error) throw error;
};

const sendPushNotification = async ({ title, body, url }) => {
  if (!isSupabaseConfigured) {
    logInfo("pushSend", "Supabase off — skip sendPushNotification");
    return { total: 0, sent: 0, failed: 0, failedDetails: [] };
  }

  if (!isLegacyPushConfigured) {
    const error = new Error("Legacy Web Push chưa cấu hình VAPID keys");
    error.code = "WEB_PUSH_NOT_CONFIGURED";
    throw error;
  }

  const payload = JSON.stringify({
    title,
    body,
    url,
  });

  // 🔹 Lấy tất cả subscriptions active
  let from = 0;
  const pageSize = 1000;

  const subscriptions = [];

  while (true) {
    const { data, error } = await supabase
      .from("push_subscriptionsv2")
      .select(
        `
        endpoint,
        p256dh,
        auth
      `,
      )
      .eq("active", true)
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    subscriptions.push(...data);

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  logInfo(
    "pushSend",
    `📋 Tổng số subscription active: ${subscriptions.length}`,
  );

  const sent = [];
  const failed = [];

  // 🔹 Chia batch
  const chunks = Array.from(
    {
      length: Math.ceil(subscriptions.length / BATCH_SIZE),
    },
    (_, i) => subscriptions.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE),
  );

  for (const [index, batch] of chunks.entries()) {
    logInfo(
      "pushSend",
      `📦 Gửi batch ${index + 1}/${chunks.length} (${batch.length} người dùng)`,
    );

    const results = await Promise.allSettled(
      batch.map((sub) => {
        const subscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        return webPush.sendNotification(subscription, payload);
      }),
    );

    await Promise.all(
      results.map(async (result, i) => {
        const sub = batch[i];

        if (result.status === "fulfilled") {
          sent.push(sub.endpoint);

          return;
        }

        const message = result.reason?.message || "Unknown error";

        logError("pushSend", `❌ Gửi lỗi tới ${sub.endpoint}`, message);

        // 🔹 subscription chết -> inactive
        await supabase
          .from("push_subscriptionsv2")
          .update({
            active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("endpoint", sub.endpoint);

        logInfo("pushSend", `⛔ Đã đánh dấu inactive: ${sub.endpoint}`);

        failed.push({
          endpoint: sub.endpoint,
          error: message,
        });
      }),
    );

    // nghỉ giữa batch
    await sleep(300);
  }

  return {
    total: subscriptions.length,
    sent: sent.length,
    failed: failed.length,
    failedDetails: failed,
  };
};

const testPushNotification = async ({ endpoint, title, body, url }) => {
  if (!isSupabaseConfigured) {
    return { success: false, endpoint, skipped: true };
  }

  if (!isLegacyPushConfigured) {
    const error = new Error("Legacy Web Push chưa cấu hình VAPID keys");
    error.code = "WEB_PUSH_NOT_CONFIGURED";
    throw error;
  }

  const payload = JSON.stringify({ title, body, url });

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("subscription")
    .eq("endpoint", endpoint)
    .limit(1);

  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error("Không tìm thấy subscription cho endpoint này");
  }

  try {
    await webPush.sendNotification(data[0].subscription, payload);
    return { success: true, endpoint };
  } catch (err) {
    logError("testPushSend", `❌ Gửi lỗi tới ${endpoint}`, err.message);
    throw err;
  }
};

module.exports = {
  RegisterPush,
  SyncRegisterPush,
  sendPushNotification,
  testPushNotification,
};
