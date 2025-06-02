// /services/freqtrade/index.js
const {
  connectPm2,
  disconnectPm2,
  startBotProcess,
  stopProcess,
  processStatus,
} = require("./pm2Controller");
const { generateInstanceConfig } = require("./configBuilder");
const BotInstance = require("../../models/BotInstance");
const logger = require("../../utils/logger");
const path = require("path");
const manager = require("../freqtradeManager");

async function startFreqtradeProcess(instanceId) {
  await connectPm2();
  const instance = await BotInstance.findById(instanceId).populate("botId");
  if (!instance || !instance.active)
    throw new Error("Instance invalid or inactive");

  const processName = `freqtrade-${instanceId}`;
  const status = await processStatus(processName);
  if (
    status &&
    ["online", "errored", "launching"].includes(status.pm2_env?.status)
  ) {
    await stopProcess(processName); // restart
  }

  const { configFilePath } = await generateInstanceConfig(instance);
  const PYTHON_BIN = path.resolve("./venv/Scripts/python.exe");

  await startBotProcess(instanceId.toString(), configFilePath, PYTHON_BIN);

  await BotInstance.findByIdAndUpdate(instanceId, {
    $set: { running: true, lastExecuted: new Date() },
  });
  return { message: `Bot ${instanceId} started` };
}

async function stopFreqtradeProcess(instanceId, markInactive = false) {
  // Add markInactive here
  await connectPm2();
  const processName = `freqtrade-${instanceId}`;
  await stopProcess(processName); // from pm2Controller

  const updateData = { $set: { running: false } };
  if (markInactive) {
    updateData.$set.active = false;
    logger.info(
      `[FreqtradeService] Instance ${instanceId} also marked as inactive.`
    );
  }

  await BotInstance.findByIdAndUpdate(instanceId, updateData);
  return { message: `Bot ${instanceId} stopped` };
}

module.exports = {
  startFreqtradeProcess,
  stopFreqtradeProcess,
  connectPm2,
  disconnectPm2,
  generateInstanceConfig: manager.generateInstanceConfig,
};
logger.info("[FreqtradeService Index] Now delegating to freqtradeManager.js");
