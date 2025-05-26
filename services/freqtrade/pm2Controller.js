const pm2 = require("pm2");
const path = require("path");
const logger = require("../../utils/logger");
const fs = require("fs").promises;

const envUserDataDir =
  process.env.FREQTRADE_USER_DATA_DIR || "./data/ft_user_data";
const absoluteUserDataBaseDir = path.resolve(
  __dirname,
  "../../",
  envUserDataDir
);
logger.debug(
  `[PM2Controller] User Data Base Directory: ${absoluteUserDataBaseDir}`
);

let isConnected = false;

// PM2 Connect Handler
const connectPm2 = () =>
  new Promise((resolve, reject) => {
    if (isConnected) {
      logger.debug("[PM2Controller] Already connected to PM2");
      return resolve();
    }
    logger.info("[PM2Controller] Connecting to PM2...");
    pm2.connect((err) => {
      if (err) {
        logger.error("[PM2Controller] Connection failed:", err);
        return reject(err);
      }
      isConnected = true;
      logger.info("[PM2Controller] Connected to PM2.");
      resolve();
    });
  });

// PM2 Disconnect
function disconnectPm2() {
  if (isConnected) {
    logger.info("[PM2Controller] Disconnecting from PM2...");
    pm2.disconnect();
    isConnected = false;
  }
}

// Stop Process
async function stopProcess(processName) {
  logger.info(`[PM2Controller] Stopping process: ${processName}`);
  return new Promise((resolve, reject) => {
    pm2.delete(processName, (err) => {
      if (err) {
        logger.warn(`[PM2Controller] Could not stop ${processName}`, err);
        return reject(err);
      }
      logger.info(`[PM2Controller] Process ${processName} stopped.`);
      resolve();
    });
  });
}

// Start Bot Instance via PM2
async function startBotProcess(instanceIdStr, configPath, scriptPath) {
  const processName = `freqtrade-${instanceIdStr}`;
  logger.info(`[PM2Controller] Starting Freqtrade instance: ${processName}`);

  const absolutePythonPath = path.resolve(scriptPath);
  const absoluteConfigPath = path.resolve(configPath);
  const strategyPath = path.join(
    absoluteUserDataBaseDir,
    instanceIdStr,
    "strategies"
  );
  const logDir = path.join(absoluteUserDataBaseDir, instanceIdStr, "logs");

  // Ensure logs directory exists
  await fs.mkdir(logDir, { recursive: true });

  const opts = {
    script: absolutePythonPath, // Python executable
    interpreter: "none",
    args: [
      "-u", // unbuffered output
      "-m",
      "freqtrade",
      "trade",
      "--config",
      absoluteConfigPath,
      "--strategy-path",
      strategyPath,
      "-vv",
    ],
    name: processName,
    exec_mode: "fork",
    env: {
      PYTHONIOENCODING: "UTF-8",
      PYTHONUNBUFFERED: "1",
      // You can add more env vars here if needed
    },
    out_file: path.join(logDir, "pm2_out.log"),
    error_file: path.join(logDir, "pm2_err.log"),
    autorestart: true,
    min_uptime: 5000,
    max_restarts: 5,
  };

  logger.debug(
    `[PM2Controller] PM2 Launch Command: ${opts.script} ${opts.args.join(" ")}`
  );

  return new Promise((resolve, reject) => {
    pm2.start(opts, (err, apps) => {
      if (err) {
        logger.error(
          `[PM2Controller] Error starting ${processName}:`,
          err.message
        );
        return reject(new Error(`PM2 failed to start process: ${err.message}`));
      }
      logger.info(
        `[PM2Controller] Process ${processName} started successfully.`
      );
      resolve(apps[0]);
    });
  });
}

// PM2 Status Check
async function processStatus(name) {
  logger.debug(`[PM2Controller] Getting status for: ${name}`);
  return new Promise((resolve) => {
    pm2.describe(name, (err, list) => {
      if (err || !list || list.length === 0) {
        logger.warn(`[PM2Controller] Could not find process: ${name}`);
        return resolve(null);
      }
      resolve(list[0]);
    });
  });
}

// Graceful PM2 Shutdown
const gracefulShutdown = () => {
  logger.info("[PM2Controller] Gracefully shutting down...");
  disconnectPm2();
  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

module.exports = {
  connectPm2,
  disconnectPm2,
  startBotProcess,
  stopProcess,
  processStatus,
};
