// services/freqtradeManager.js
const pm2 = require("pm2");
const path = require("path");
const fs = require("fs").promises;
const merge = require("lodash.merge"); // Rename variable to 'merge' // Ensure you have run: npm install lodash.merge
const BotInstance = require("../models/BotInstance"); // Adjust path
const Bot = require("../models/Bot"); // Import Bot model
const User = require("../models/User"); // Adjust path (if needed, though not directly used here)
const { decrypt } = require("../utils/crypto"); // Adjust path
const logger = require("../utils/logger");
// --- Configuration ---
// !! IMPORTANT: Adjust these values based on YOUR Freqtrade setup !!
const FREQTRADE_EXECUTABLE_PATH =
  process.env.FREQTRADE_EXECUTABLE_PATH || "freqtrade";
const FREQTRADE_USER_DATA_DIR =
  process.env.FREQTRADE_USER_DATA_DIR || path.resolve("./freqtrade-user-data");
// --- Strategy Source Directory (from .env) ---
const STRATEGY_SOURCE_DIR = process.env.STRATEGY_SOURCE_DIR;
if (!STRATEGY_SOURCE_DIR) {
  console.warn(
    "⚠️ WARNING: STRATEGY_SOURCE_DIR is not set in .env. Strategy file copying will fail. Please set it to the directory containing your .py strategy files."
  );
  // Consider making this fatal if strategies are essential:
  // console.error("❌ FATAL: STRATEGY_SOURCE_DIR is not set in .env."); process.exit(1);
}

// --- PM2 Connection Handling ---
let isPm2Connected = false;

const connectPm2 = () => {
  return new Promise((resolve, reject) => {
    if (isPm2Connected) return resolve();
    pm2.connect((err) => {
      if (err) {
        console.error("❌ PM2 connection error:", err);
        return reject(
          new Error(
            "Failed to connect to PM2 daemon. Bot management unavailable."
          )
        );
      }
      console.log("✅ PM2 connected");
      isPm2Connected = true;
      resolve();
    });
  });
};

const disconnectPm2 = () => {
  if (isPm2Connected) {
    console.log("🔌 Disconnecting from PM2...");
    pm2.disconnect();
    isPm2Connected = false;
  }
};
// Add listeners for graceful shutdown
process.on("SIGINT", disconnectPm2);
process.on("SIGTERM", disconnectPm2);
process.on("exit", disconnectPm2);
// --- End PM2 Connection ---

// --- Helper: Ensure Strategy File Exists & Copy ---
async function ensureStrategyFile(instance, instanceUserDataPath) {
  const instanceIdStr = instance._id.toString();
  if (!STRATEGY_SOURCE_DIR)
    throw new Error(
      "Strategy source directory (STRATEGY_SOURCE_DIR) is not configured in .env."
    );

  // Ensure instance.strategy holds the filename (e.g., "MyStrategy.py")
  const strategyFileName = instance.strategy;
  if (!strategyFileName)
    throw new Error(
      `Strategy filename not defined for instance ${instanceIdStr}`
    );
  if (!strategyFileName.endsWith(".py")) {
    console.warn(
      `Strategy name "${strategyFileName}" for instance ${instanceIdStr} might be missing the .py extension.`
    );
    // Decide if you want to enforce .py or automatically add it
  }

  const sourceStrategyPath = path.join(STRATEGY_SOURCE_DIR, strategyFileName);
  const strategiesDestDir = path.join(instanceUserDataPath, "strategies");
  const destStrategyPath = path.join(strategiesDestDir, strategyFileName);
  logger.info(
    `ensureStrategyFile: Checking for strategy file at absolute path: ${path.resolve(
      sourceStrategyPath
    )}`
  );
  try {
    // 1. Check if source file exists and is readable
    await fs.access(sourceStrategyPath, fs.constants.R_OK);

    // 2. Ensure destination directory exists
    await fs.mkdir(strategiesDestDir, { recursive: true });

    // 3. Copy the strategy file
    await fs.copyFile(sourceStrategyPath, destStrategyPath);
    console.log(
      `Copied strategy ${strategyFileName} to ${strategiesDestDir} for instance ${instanceIdStr}`
    );

    // 4. Return strategy name *without* .py extension for Freqtrade config
    return strategyFileName.replace(/\.py$/i, ""); // Case-insensitive removal of .py
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error(`Strategy source file not found: ${sourceStrategyPath}`);
      throw new Error(
        `Required strategy file '${strategyFileName}' not found in STRATEGY_SOURCE_DIR.`
      );
    } else if (error.code === "EACCES") {
      console.error(
        `Permission denied accessing strategy source/destination for ${strategyFileName}`
      );
      throw new Error(
        `Permission error handling strategy file '${strategyFileName}'.`
      );
    } else {
      console.error(
        `Error copying strategy file ${strategyFileName} for instance ${instanceIdStr}:`,
        error
      );
      throw new Error(`Failed to prepare strategy file: ${error.message}`);
    }
  }
}

// --- Helper: Generate Freqtrade Config (Uses Lodash Merge) ---
async function generateInstanceConfig(instance) {
  const instanceIdStr = instance._id.toString();
  const instanceUserDataPath = path.join(
    FREQTRADE_USER_DATA_DIR,
    instanceIdStr
  );
  const configFilePath = path.join(instanceUserDataPath, "config.json");
  const logFilePath = path.join(
    instanceUserDataPath,
    `freqtrade_${instanceIdStr}.log`
  );
  const dbFilePath = path.join(instanceUserDataPath, "tradesv3.sqlite");

  await fs.mkdir(instanceUserDataPath, { recursive: true });

  // --- 1. Fetch Bot Template for Defaults ---
  const botTemplate = await Bot.findById(instance.botId);
  if (!botTemplate) {
    console.warn(
      `Bot template ${instance.botId} not found for instance ${instanceIdStr}. Using minimal defaults.`
    );
  }
  // Get defaults from Bot template, ensure it's an object
  const templateDefaults =
    botTemplate?.defaultConfig && typeof botTemplate.defaultConfig === "object"
      ? botTemplate.defaultConfig
      : {};

  // --- 2. Resolve Strategy and Copy File ---
  // Ensure instance.strategy is set, using template default if necessary
  if (!instance.strategy && botTemplate?.defaultStrategy) {
    console.log(
      `Instance ${instanceIdStr} strategy not set, using default from template: ${botTemplate.defaultStrategy}`
    );
    // We don't save this back to the instance here, just use it for generation
    instance.strategy = botTemplate.defaultStrategy;
  }
  if (!instance.strategy) {
    // Final check if still no strategy
    throw new Error(
      `Strategy is not defined for instance ${instanceIdStr} and no default found on Bot template ${instance.botId}.`
    );
  }
  // Copy the file and get the name for the config (without .py)
  const strategyNameForConfig = await ensureStrategyFile(
    instance,
    instanceUserDataPath
  );

  // --- 3. Decrypt API Secret ---
  let decryptedSecretKey;
  try {
    decryptedSecretKey = decrypt(instance.apiSecretKey);
  } catch (error) {
    // Error is logged within decrypt, re-throw specific error here
    throw new Error(
      `Configuration error: Could not decrypt API secret for instance ${instanceIdStr}. Check CRYPTO_SECRET_KEY and data integrity.`
    );
  }

  // --- 4. Define Configuration Layers ---
  // Layer 1: Backend Managed (Essential, non-overrideable by user/template)
  const backendManagedConfig = {
    dry_run: instance.accountType === "demo",
    exchange: {
      name: instance.exchange.toLowerCase(),
      key: instance.apiKey,
      secret: decryptedSecretKey,
    },
    telegram: { enabled: false },
    api_server: { enabled: false },
    db_url: `sqlite:///${dbFilePath}`,
    logfile: logFilePath, // Freqtrade uses this path relative to user_data_dir if not absolute
    bot_name: `ft_${instanceIdStr}`,
    user_data_dir: instanceUserDataPath, // Inform Freqtrade where its data lives
    strategy: strategyNameForConfig, // The resolved strategy NAME
  };

  // Layer 2: Bot Template Defaults (from Bot model)
  const templateDefaultConfig = templateDefaults;

  // Layer 3: User Instance Overrides (from instance.config, ensure it's an object)
  const userInstanceConfig =
    instance.config && typeof instance.config === "object"
      ? instance.config
      : {};

  // --- 5. Merge Configuration ---
  // Merge order: User overrides Template. Base is applied separately.
  // Use empty objects as base to avoid modifying originals
  let mergedConfig = merge({}, templateDefaultConfig, userInstanceConfig);

  // --- 6. Handle Strategy Specific Parameters ---
  // Allow user to specify strategy parameters under a top-level key in instance.config
  // Example: instance.config = { "strategy_params": { "ema_short": 10, "rsi_period": 14 } }
  const strategyParams = userInstanceConfig.strategy_params || {};
  if (
    Object.keys(strategyParams).length > 0 &&
    typeof strategyParams === "object"
  ) {
    // Add params directly to the config (Freqtrade strategies can access top-level config keys)
    // Merging them directly allows strategies to access them as self.config['ema_short'] etc.
    mergedConfig = merge(mergedConfig, strategyParams);
    // Clean up the temporary key if you want (optional)
    // delete mergedConfig.strategy_params;
    console.log(
      `Merged strategy_params for instance ${instanceIdStr}:`,
      Object.keys(strategyParams)
    );
  } else if (userInstanceConfig.strategy_params) {
    console.warn(
      `Instance ${instanceIdStr}: 'strategy_params' found in config but was not a non-empty object. Ignoring.`
    );
  }
  // Clean up the strategy_params key regardless if it exists at top level after merge
  delete mergedConfig.strategy_params;

  // --- 7. Combine with Backend Managed Config ---
  // Backend managed settings ALWAYS take precedence over template/user settings
  // Use lodash merge again for deep merging (especially for 'exchange')
  let finalConfig = merge(mergedConfig, backendManagedConfig);

  // --- 8. Final Sanitization/Validation (Optional but Recommended) ---
  // Ensure certain structures are correct after merging
  if (
    finalConfig.exchange.pair_whitelist &&
    !Array.isArray(finalConfig.exchange.pair_whitelist)
  ) {
    console.warn(
      `Instance ${instanceIdStr}: Correcting invalid pair_whitelist.`
    );
    finalConfig.exchange.pair_whitelist =
      templateDefaultConfig.pair_whitelist || ["BTC/USDT"]; // Fallback
  }
  if (finalConfig.pairlists && !Array.isArray(finalConfig.pairlists)) {
    console.warn(`Instance ${instanceIdStr}: Correcting invalid pairlists.`);
    finalConfig.pairlists = templateDefaultConfig.pairlists || [
      { method: "StaticPairList" },
    ]; // Fallback
  }
  if (
    finalConfig.max_open_trades &&
    typeof finalConfig.max_open_trades !== "number"
  ) {
    console.warn(
      `Instance ${instanceIdStr}: Correcting invalid max_open_trades.`
    );
    finalConfig.max_open_trades =
      parseInt(finalConfig.max_open_trades, 10) || 1; // Fallback
  }
  // Add more checks as needed based on your allowed overrides

  // --- 9. Write Config File ---
  try {
    await fs.writeFile(configFilePath, JSON.stringify(finalConfig, null, 2)); // Pretty print
    console.log(
      `Generated config for instance ${instanceIdStr} at ${configFilePath}`
    );
    return {
      configFilePath,
      logFilePath,
      dbFilePath,
      strategyName: strategyNameForConfig,
    };
  } catch (writeError) {
    console.error(`Error writing config file ${configFilePath}:`, writeError);
    throw new Error(
      `Failed to write configuration file for instance ${instanceIdStr}.`
    );
  }
}

// --- Start Freqtrade Process (Uses generateInstanceConfig) ---
async function startFreqtradeProcess(instanceId) {
  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;

  // Fetch latest instance data fresh each time
  const instance = await BotInstance.findById(instanceId).populate(
    "botId",
    "defaultStrategy"
  ); // Populate needed fields
  if (!instance) throw new Error(`BotInstance ${instanceIdStr} not found`);

  // --- Status & Permission Checks ---
  if (!instance.active) throw new Error("Instance is inactive.");
  const now = new Date();
  if (instance.expiryDate < now)
    throw new Error(
      `Subscription/Demo expired on ${instance.expiryDate.toISOString()}`
    );

  // Check if PM2 process exists and is running
  const existingProcess = await new Promise((resolve) => {
    pm2.describe(processName, (err, list) =>
      resolve(list && list.length > 0 ? list[0] : null)
    );
  });
  if (
    existingProcess &&
    ["online", "launching", "waiting restart"].includes(
      existingProcess.pm2_env?.status
    )
  ) {
    if (!instance.running) {
      await BotInstance.findByIdAndUpdate(instanceId, {
        $set: { running: true, lastExecuted: new Date() },
      });
    }
    console.log(
      `PM2 process ${processName} already running (status: ${existingProcess.pm2_env?.status}).`
    );
    // Fetch potentially updated instance data after DB update
    return {
      message: `Bot ${instanceIdStr} is already running.`,
      instance: await BotInstance.findById(instanceId),
    };
  }

  // --- Generate Config (Includes Strategy Copy) ---
  let configPaths;
  try {
    // Pass the populated instance object
    configPaths = await generateInstanceConfig(instance);
  } catch (configError) {
    console.error(
      `Error preparing config/strategy for ${instanceIdStr}:`,
      configError
    );
    // Ensure DB shows not running if config fails
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: false },
    });
    // Provide a clearer error message back to the controller
    throw new Error(`Failed to prepare configuration: ${configError.message}`);
  }

  // --- Prepare PM2 Start Options ---
  // Freqtrade now reads strategy, db, logfile, user_data_dir FROM the config file
  const freqtradeArgs = ["trade", "--config", configPaths.configFilePath];

  const pm2Options = {
    script: FREQTRADE_EXECUTABLE_PATH,
    name: processName,
    args: freqtradeArgs,
    exec_mode: "fork",
    autorestart: false, // Managed by our logic
    log_date_format: "YYYY-MM-DD HH:mm Z",
    // PM2 logs capture wrapper stdout/stderr (useful for crashes before freqtrade logs)
    out_file: path.join(FREQTRADE_USER_DATA_DIR, instanceIdStr, "pm2_out.log"),
    error_file: path.join(
      FREQTRADE_USER_DATA_DIR,
      instanceIdStr,
      "pm2_err.log"
    ),
    merge_logs: false, // Keep PM2 logs separate
  };

  console.log(
    `Starting PM2 process ${processName} using config: ${configPaths.configFilePath}`
  );

  // --- Start Process ---
  try {
    await new Promise((resolve, reject) => {
      pm2.start(pm2Options, (err, apps) => {
        if (err) return reject(err);
        resolve(apps);
      });
    });
    console.log(`Successfully initiated PM2 process start for: ${processName}`);
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: true, lastExecuted: new Date() },
    });
    const updatedInstance = await BotInstance.findById(instanceId);
    return {
      message: `Bot ${instanceIdStr} started successfully.`,
      instance: updatedInstance,
    };
  } catch (startError) {
    console.error(`Error starting PM2 process ${processName}:`, startError);
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: false },
    });
    await new Promise((resolve) => pm2.delete(processName, () => resolve())); // Attempt cleanup
    throw new Error(`Failed to start bot process: ${startError.message}`);
  }
}

// --- Stop Freqtrade Process ---
async function stopFreqtradeProcess(instanceId, markInactive = false) {
  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;
  console.log(`Attempting to stop PM2 process: ${processName}`);

  try {
    // Stop
    await new Promise((resolve, reject) => {
      pm2.stop(processName, (err) => {
        if (
          err &&
          err.message?.toLowerCase().includes("process name not found")
        ) {
          console.warn(
            `PM2 process ${processName} not found or already stopped.`
          );
          resolve();
        } else if (err) {
          console.error(`PM2 stop error for ${processName}:`, err);
          reject(err);
        } else {
          console.log(`Successfully stopped PM2 process: ${processName}`);
          resolve();
        }
      });
    });

    // Delete from PM2
    await new Promise((resolve) => {
      pm2.delete(processName, (err) => {
        if (
          err &&
          !err.message?.toLowerCase().includes("process name not found")
        ) {
          console.warn(`PM2 delete warning for ${processName}: ${err.message}`);
        } else {
          console.log(`Successfully deleted PM2 process: ${processName}`);
        }
        resolve();
      });
    });

    // Update DB
    const updateFields = { running: false };
    if (markInactive) {
      updateFields.active = false;
      console.log(
        `Instance ${instanceIdStr} marked as inactive due to expiry/action.`
      );
    }
    await BotInstance.findByIdAndUpdate(instanceId, { $set: updateFields });
    console.log(
      `Instance ${instanceIdStr} DB status updated: running=false${
        markInactive ? ", active=false" : ""
      }`
    );

    return { message: `Bot ${instanceIdStr} stopped successfully.` };
  } catch (error) {
    console.error(
      `Error in stopFreqtradeProcess for instance ${instanceIdStr}:`,
      error
    );
    // Attempt to mark as not running in DB even if PM2 failed
    try {
      await BotInstance.findByIdAndUpdate(instanceId, {
        $set: { running: false },
      });
    } catch (dbError) {
      console.error(
        `Failed to update instance ${instanceIdStr} status after stop failure:`,
        dbError
      );
    }
    throw error;
  }
}

module.exports = {
  connectPm2,
  disconnectPm2,
  startFreqtradeProcess,
  stopFreqtradeProcess,
};
