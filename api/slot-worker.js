/**
 * Lightweight Render entrypoint for the 24/7 celebrity slot monitor.
 *
 * The public HTTP surface is intentionally limited to health checks so a
 * free Render web service can be kept awake without exposing a second copy
 * of the main API that is hosted on Vercel.
 */
const dotenv = require("dotenv");
const http = require("http");

const isProd = process.env.NODE_ENV === "production";
dotenv.config({ path: isProd ? ".env.production" : ".env.development" });
dotenv.config();

const { startSlotMonitorWorker } = require("./src/modules/slotMonitor");
const { rotateSlotMonitorEncryptionKey } = require("./src/modules/slotMonitor/keyRotation");
const {
  checkNotificationRelay,
  getRelayUrl,
} = require("./src/modules/slotMonitor/notificationRelay");

const PORT = Number(process.env.PORT) || 10000;
const startedAt = new Date().toISOString();
let workerStarted = false;
let keyRotation = { status: "pending" };

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://slot-worker.local").pathname;

  if (req.method === "GET" && (pathname === "/" || pathname === "/health")) {
    return sendJson(res, workerStarted ? 200 : 503, {
      status: workerStarted ? "healthy" : "unavailable",
      service: "huy-locket-slot-worker",
      worker: workerStarted ? "running" : "disabled",
      keyRotation,
      startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  }

  return sendJson(res, 404, {
    status: "not_found",
    service: "huy-locket-slot-worker",
  });
});

server.listen(PORT, "0.0.0.0", async () => {
  try {
    const result = await rotateSlotMonitorEncryptionKey();
    keyRotation = {
      status: result.skipped ? "skipped" : "complete",
      reason: result.reason || null,
      migrated: Number(result.migrated || 0),
      alreadyMigrated: Number(result.alreadyMigrated || 0),
      total: Number(result.total || 0),
    };
    console.log("[slot-worker] encryption key rotation", keyRotation);
  } catch (error) {
    keyRotation = {
      status: "failed",
      code: error?.code || null,
      message: error?.message || "unknown",
    };
    console.error("[slot-worker] encryption key rotation failed", keyRotation);
  }

  workerStarted = startSlotMonitorWorker();
  console.log(`[slot-worker] health server listening on 0.0.0.0:${PORT}`);

  checkNotificationRelay()
    .then((status) => {
      const providers = status?.providers || {};
      console.log("[slot-worker] Vercel notification relay ready", {
        relayUrl: getRelayUrl(),
        telegramConfigured: Boolean(providers?.telegram?.configured),
        emailConfigured: Boolean(providers?.email?.configured),
      });
    })
    .catch((error) => {
      console.warn("[slot-worker] Vercel notification relay unavailable", {
        relayUrl: getRelayUrl(),
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || "unknown",
      });
    });
});

function shutdown(signal) {
  console.log(`[slot-worker] ${signal} received; shutting down`);
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (error) => {
  console.error("[slot-worker] unhandled rejection", error?.message || error);
});
process.on("uncaughtException", (error) => {
  console.error("[slot-worker] uncaught exception", error?.message || error);
});
