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
