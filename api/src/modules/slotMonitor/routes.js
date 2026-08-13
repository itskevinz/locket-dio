const express = require("express");
const { verifyIdToken } = require("../../middlewares/Auth");
const store = require("./store");
const eventStore = require("./eventStore");
const { sanitizeWatchInput } = require("./core");
const notificationRoutes = require("./notificationRoutes");
const {
  enableBackgroundPush,
  getPublicConfig,
  checkNowForUser,
  sendPushToUser,
  sendRealCelebrityRequest,
} = require("./service");

const router = express.Router();
const MAX_WATCHES = 20;

// Cài bảng + trigger lịch sử ngay khi API Slot Monitor khởi động để các sự kiện
// từ worker 24/7 được lưu kể cả khi người dùng không mở trang Celeb Center.
eventStore.ensureSchema().catch((error) => {
  console.warn("[slot-monitor] event history bootstrap failed", {
    code: error?.code || null,
    message: error?.message || "unknown",
  });
});

function mapWatch(row) {
  return {
    uid: row.celeb_uid,
    username: row.username,
    displayName: row.display_name || row.username,
    avatar: row.avatar_url || "",
    friendCount: Number(row.friend_count) || 0,
    maxFriends: Number(row.max_friends) || 0,
    status: row.status,
    lastWasFull: Boolean(row.last_was_full),
    lastCheckedAt: row.last_checked_at ? new Date(row.last_checked_at).getTime() : null,
    notifiedAt: row.notified_at ? new Date(row.notified_at).getTime() : null,
    enabled: Boolean(row.enabled),
    autoRequestEnabled: Boolean(row.auto_request_enabled),
    lastAutoRequestAt: row.last_auto_request_at
      ? new Date(row.last_auto_request_at).getTime()
      : null,
    lastAutoRequestStatus: row.last_auto_request_status || "",
    lastAutoRequestError: row.last_auto_request_error || "",
  };
}

function mapEvent(row) {
  return {
    id: String(row.id),
    uid: row.celeb_uid,
    username: row.username,
    type: row.event_type,
    availableSlots: Number(row.available_slots) || 0,
    friendCount: Number(row.friend_count) || 0,
    maxFriends: Number(row.max_friends) || 0,
    detail: row.detail || "",
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
  };
}

router.get("/config", async (_req, res) => {
  try {
    const config = await getPublicConfig();
    return res.json({ success: true, data: config });
  } catch (error) {
    return res.status(503).json({
      success: false,
      code: error?.code || "SLOT_MONITOR_UNAVAILABLE",
      message: "Canh Slot 24/7 chưa sẵn sàng.",
    });
  }
});

router.use("/notifications", notificationRoutes);

router.get("/watches", verifyIdToken, async (req, res, next) => {
  try {
    const rows = await store.listUserWatches(req.user.uid);
    return res.json({ success: true, data: rows.map(mapWatch) });
  } catch (error) {
    return next(error);
  }
});

router.get("/history", verifyIdToken, async (req, res, next) => {
  try {
    const rows = await eventStore.listEvents(req.user.uid, {
      celebUid: req.query?.uid || "",
      limit: req.query?.limit || 120,
    });
    return res.json({ success: true, data: rows.map(mapEvent) });
  } catch (error) {
    return next(error);
  }
});

router.post("/enable", verifyIdToken, async (req, res, next) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    const subscription = req.body?.subscription || null;
    const config = await enableBackgroundPush({
      userUid: req.user.uid,
      refreshToken,
      subscription,
      userAgent: req.headers["user-agent"] || "",
    });
    return res.json({
      success: true,
      message: "Canh Slot 24/7 đã bật.",
      data: config,
    });
  } catch (error) {
    const status = Number(error?.status) || 400;
    return res.status(status).json({
      success: false,
      code: error?.code || "SLOT_ENABLE_FAILED",
      message: error?.message || "Không thể bật Canh Slot 24/7.",
    });
  }
});

router.post("/watch", verifyIdToken, async (req, res, next) => {
  try {
    const watch = sanitizeWatchInput(req.body?.watch || req.body);
    if (!watch) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SLOT_WATCH",
        message: "Thông tin Celeb không hợp lệ.",
      });
    }

    const current = await store.listUserWatches(req.user.uid);
    const exists = current.some((item) => String(item.celeb_uid) === String(watch.uid));
    if (!exists && current.length >= MAX_WATCHES) {
      return res.status(400).json({
        success: false,
        code: "SLOT_WATCH_LIMIT",
        message: `Bạn chỉ có thể canh tối đa ${MAX_WATCHES} tài khoản.`,
      });
    }

    await store.upsertWatch(req.user.uid, watch);
    return res.json({ success: true, data: watch });
  } catch (error) {
    return next(error);
  }
});

router.patch("/watch/:uid", verifyIdToken, async (req, res, next) => {
  try {
    const hasEnabled = typeof req.body?.enabled === "boolean";
    const hasAutoRequest = typeof req.body?.autoRequestEnabled === "boolean";
    if (!hasEnabled && !hasAutoRequest) {
      return res.status(400).json({
        success: false,
        code: "INVALID_SLOT_WATCH_UPDATE",
        message: "Không có cấu hình Canh Slot hợp lệ để cập nhật.",
      });
    }

    if (hasEnabled) {
      await store.setWatchEnabled(req.user.uid, req.params.uid, req.body.enabled);
    }
    if (hasAutoRequest) {
      await store.setWatchAutoRequestEnabled(
        req.user.uid,
        req.params.uid,
        req.body.autoRequestEnabled,
      );
    }

    const rows = await store.listUserWatches(req.user.uid);
    const updated = rows.find(
      (item) => String(item.celeb_uid) === String(req.params.uid),
    );
    if (!updated) {
      return res.status(404).json({
        success: false,
        code: "SLOT_WATCH_NOT_FOUND",
        message: "Không tìm thấy Celeb đang canh.",
      });
    }

    return res.json({ success: true, data: mapWatch(updated) });
  } catch (error) {
    return next(error);
  }
});

router.delete("/watch/:uid", verifyIdToken, async (req, res, next) => {
  try {
    await store.removeWatch(req.user.uid, req.params.uid);
    return res.json({ success: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/check/:uid", verifyIdToken, async (req, res, next) => {
  try {
    const result = await checkNowForUser(req.user.uid, req.params.uid, req.user.idToken);
    return res.json({ success: true, data: result?.transition || null });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status !== 500) {
      return res.status(status).json({
        success: false,
        code: error?.code || "SLOT_CHECK_FAILED",
        message: error?.message || "Không thể kiểm tra slot.",
      });
    }
    return next(error);
  }
});

router.post("/retry/:uid", verifyIdToken, async (req, res, next) => {
  try {
    const beforeRows = await store.listUserWatches(req.user.uid);
    const before = beforeRows.find(
      (item) => String(item.celeb_uid) === String(req.params.uid),
    );
    if (!before) {
      return res.status(404).json({
        success: false,
        code: "SLOT_WATCH_NOT_FOUND",
        message: "Không tìm thấy Celeb đang canh.",
      });
    }

    const beforeAttemptAt = before.last_auto_request_at
      ? new Date(before.last_auto_request_at).getTime()
      : 0;

    // Luôn kiểm tra dữ liệu Locket thật trước khi retry. Nếu lần check này vừa bắt được
    // full -> có slot thì flow chuẩn có thể đã tự gửi request; khi đó không gửi lần hai.
    const checked = await checkNowForUser(
      req.user.uid,
      req.params.uid,
      req.user.idToken,
    );

    let rows = await store.listUserWatches(req.user.uid);
    let latest = rows.find(
      (item) => String(item.celeb_uid) === String(req.params.uid),
    );
    const afterAttemptAt = latest?.last_auto_request_at
      ? new Date(latest.last_auto_request_at).getTime()
      : 0;

    let autoRequest = null;
    if (afterAttemptAt && afterAttemptAt !== beforeAttemptAt) {
      autoRequest = {
        enabled: true,
        attempted: true,
        success: latest?.last_auto_request_status === "SENT",
        code: latest?.last_auto_request_status === "SENT" ? null : "AUTO_REQUEST_FAILED",
        message:
          latest?.last_auto_request_status === "SENT"
            ? "Locket đã xác nhận trạng thái request/quan hệ Celeb."
            : latest?.last_auto_request_error || "Locket chưa xác nhận request Celeb.",
      };
    } else {
      const availableSlots = Number(checked?.transition?.availableSlots) || 0;
      if (availableSlots <= 0) {
        return res.status(409).json({
          success: false,
          code: "SLOT_NOT_OPEN",
          message: "Celeb hiện không còn slot trống nên chưa gửi lại request.",
          data: checked?.transition || null,
        });
      }

      // Đây là thao tác retry thủ công do người dùng bấm, nên được phép gửi một lần
      // kể cả toggle auto hiện đã tắt. Không thay đổi cấu hình toggle trong DB.
      autoRequest = await sendRealCelebrityRequest(
        req.user.uid,
        req.user.idToken,
        { ...latest, auto_request_enabled: true },
      );
      rows = await store.listUserWatches(req.user.uid);
      latest = rows.find(
        (item) => String(item.celeb_uid) === String(req.params.uid),
      );
    }

    return res.json({
      success: true,
      data: {
        transition: checked?.transition || null,
        autoRequest,
        watch: latest ? mapWatch(latest) : null,
      },
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    if (status !== 500) {
      return res.status(status).json({
        success: false,
        code: error?.code || "SLOT_RETRY_FAILED",
        message: error?.message || "Không thể gửi lại request Celeb.",
      });
    }
    return next(error);
  }
});

router.post("/test-push", verifyIdToken, async (req, res, next) => {
  try {
    const result = await sendPushToUser(req.user.uid, {
      type: "slot-test",
      title: "🔔 Huy Locket Canh Slot",
      body: "Thông báo màn hình khóa đã hoạt động.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "slot-monitor-test",
      url: "/friends?slot=1",
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
