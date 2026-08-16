const { verifyRelayEnvelope } = require("../src/modules/slotMonitor/notificationRelay");
const {
  sendConfiguredNotifications,
} = require("../src/modules/slotMonitor/notificationService");
const { getProviderConfig } = require("../src/modules/slotMonitor/notifiers");

module.exports = async function slotNotificationRelay(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      success: false,
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed",
    });
  }

  try {
    const envelope = verifyRelayEnvelope(
      req.body || {},
      req.headers?.["x-slot-relay-signature"] || "",
    );

    if (envelope.operation === "status") {
      return res.status(200).json({
        success: true,
        data: {
          providers: getProviderConfig(),
          runtime: "vercel",
        },
      });
    }

    const result = await sendConfiguredNotifications(
      envelope.userUid,
      envelope.payload,
      { eventId: envelope.eventId },
    );

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    const status = Number(error?.status) || 500;
    console.warn("[slot-notification-relay] request failed", {
      code: error?.code || null,
      status,
    });
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      success: false,
      code: error?.code || "SLOT_NOTIFICATION_RELAY_FAILED",
      message: error?.message || "Slot notification relay failed",
    });
  }
};
