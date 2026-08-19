const { installCompletedWatchGuard } = require("./completionGuard");

// Install before routes/services capture store methods so completed FRIENDS rows
// can never be resurrected as active slot watches by an older client sync.
installCompletedWatchGuard();

const slotMonitorRoutes = require("./routes");
const { startSlotMonitorWorker: startCoreSlotMonitorWorker } = require("./service");
const { startRelationshipWorker } = require("./relationshipWorker");
const { startTelegramBotPolling } = require("./telegramBot");

function isWorkerEnabled() {
  const value = String(process.env.SLOT_MONITOR_WORKER_ENABLED || "true")
    .trim()
    .toLowerCase();
  return !["0", "false", "off", "no", "disabled"].includes(value);
}

function startSlotMonitorWorker() {
  if (!isWorkerEnabled()) {
    console.log("[slot-monitor] worker role disabled by SLOT_MONITOR_WORKER_ENABLED");
    return false;
  }

  const workerStarted = startCoreSlotMonitorWorker();
  startRelationshipWorker();
  startTelegramBotPolling();
  return workerStarted;
}

module.exports = {
  slotMonitorRoutes,
  startSlotMonitorWorker,
};
