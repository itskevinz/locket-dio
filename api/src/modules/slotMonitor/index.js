const { installCompletedWatchGuard } = require("./completionGuard");

// Install before routes/services capture store methods so completed FRIENDS rows
// can never be resurrected as active slot watches by an older client sync.
installCompletedWatchGuard();

const slotMonitorRoutes = require("./routes");
const { startSlotMonitorWorker: startCoreSlotMonitorWorker } = require("./service");
const { startRelationshipWorker } = require("./relationshipWorker");
const { startTelegramBotPolling } = require("./telegramBot");

function startSlotMonitorWorker() {
  const workerStarted = startCoreSlotMonitorWorker();
  startRelationshipWorker();
  startTelegramBotPolling();
  return workerStarted;
}

module.exports = {
  slotMonitorRoutes,
  startSlotMonitorWorker,
};
