// services/freqtradeManager.js
const pm2 = require("pm2");
const path = require("path");
const fs = require("fs").promises;
const merge = require("lodash.merge"); // Ensure you have run: npm install lodash.merge
const BotInstance = require("../models/BotInstance"); // Adjust path as needed
const Bot = require("../models/Bot"); // Adjust path as needed
const User = require("../models/User"); // Adjust path (if needed, though not directly used here)
const { decrypt } = require("../utils/crypto"); // Adjust path as needed
const logger = require("../utils/logger"); // Adjust path as needed

// --- Configuration ---
// !! IMPORTANT: Adjust these values based on YOUR Freqtrade setup !!
const FREQTRADE_EXECUTABLE_PATH =
  process.env.FREQTRADE_EXECUTABLE_PATH || "freqtrade"; // Or absolute path
const FREQTRADE_USER_DATA_DIR =
  process.env.FREQTRADE_USER_DATA_DIR || path.resolve("./freqtrade-user-data"); // Base user-data dir

// --- Strategy Source Directory (from .env) ---
const STRATEGY_SOURCE_DIR = process.env.STRATEGY_SOURCE_DIR;
if (!STRATEGY_SOURCE_DIR) {
  logger.warn(
    // Use logger
    "⚠️ WARNING: STRATEGY_SOURCE_DIR is not set in .env. Strategy file copying will fail. Please set it to the directory containing your .py strategy files."
  );
  // Consider making this fatal if strategies are essential:
  // logger.error("❌ FATAL: STRATEGY_SOURCE_DIR is not set in .env."); process.exit(1);
}

// --- PM2 Connection Handling ---
let isPm2Connected = false;

const connectPm2 = () => {
  return new Promise((resolve, reject) => {
    if (isPm2Connected) return resolve();
    pm2.connect((err) => {
      if (err) {
        logger.error("❌ PM2 connection error:", err); // Use logger
        return reject(
          new Error(
            "Failed to connect to PM2 daemon. Bot management unavailable."
          )
        );
      }
      logger.info("✅ PM2 connected"); // Use logger
      isPm2Connected = true;
      resolve();
    });
  });
};

const disconnectPm2 = () => {
  if (isPm2Connected) {
    logger.info("🔌 Disconnecting from PM2..."); // Use logger
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
  // Optional: Check for .py extension
  if (!strategyFileName.toLowerCase().endsWith(".py")) {
    logger.warn(
      // Use logger
      `Strategy name "${strategyFileName}" for instance ${instanceIdStr} might be missing the .py extension.`
    );
  }

  const sourceStrategyPath = path.join(STRATEGY_SOURCE_DIR, strategyFileName);
  const strategiesDestDir = path.join(instanceUserDataPath, "strategies");
  const destStrategyPath = path.join(strategiesDestDir, strategyFileName);
  logger.info(
    // Use logger
    `ensureStrategyFile: Checking for strategy file: ${sourceStrategyPath}`
  ); // Log source path
  logger.debug(
    // Use logger
    `ensureStrategyFile: Destination path: ${destStrategyPath}`
  ); // Log destination path

  try {
    // 1. Check if source file exists and is readable
    await fs.access(sourceStrategyPath, fs.constants.R_OK);
    logger.debug(`Source strategy file found: ${sourceStrategyPath}`); // Use logger

    // 2. Ensure destination directory exists
    await fs.mkdir(strategiesDestDir, { recursive: true });
    logger.debug(
      `Strategies destination directory ensured: ${strategiesDestDir}`
    ); // Use logger

    // 3. Copy the strategy file
    await fs.copyFile(sourceStrategyPath, destStrategyPath);
    logger.info(
      // Use logger
      `Copied strategy ${strategyFileName} to ${strategiesDestDir} for instance ${instanceIdStr}`
    );

    // 4. Return strategy name *without* .py extension for Freqtrade config
    return strategyFileName.replace(/\.py$/i, ""); // Case-insensitive removal of .py
  } catch (error) {
    if (error.code === "ENOENT") {
      logger.error(`Strategy source file not found: ${sourceStrategyPath}`); // Use logger
      throw new Error(
        `Required strategy file '${strategyFileName}' not found in STRATEGY_SOURCE_DIR.`
      );
    } else if (error.code === "EACCES") {
      logger.error(
        // Use logger
        `Permission denied accessing strategy source/destination for ${strategyFileName}`
      );
      throw new Error(
        `Permission error handling strategy file '${strategyFileName}'.`
      );
    } else {
      logger.error(
        // Use logger
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

  // Ensure FREQTRADE_USER_DATA_DIR is absolute
  const absoluteBaseUserDataDir = path.resolve(FREQTRADE_USER_DATA_DIR);
  if (!absoluteBaseUserDataDir) {
    // Add a check here in case FREQTRADE_USER_DATA_DIR is not set or invalid
    throw new Error(
      "FREQTRADE_USER_DATA_DIR is not defined or could not be resolved."
    );
  }
  logger.debug(
    `Absolute Base User Data Dir resolved to: ${absoluteBaseUserDataDir}`
  );

  // Generate ABSOLUTE paths for this instance
  const instanceUserDataPath = path.join(
    absoluteBaseUserDataDir, // Use absolute base
    instanceIdStr
  );
  const configFilePath = path.join(instanceUserDataPath, "config.json");
  // Path for logfile setting inside config (relative to instance user_data_dir is fine here)
  const logFileName = `freqtrade_${instanceIdStr}.log`;
  // Absolute path for db_url
  const dbFilePath = path.join(instanceUserDataPath, "tradesv3.sqlite");
  // Absolute path for strategies subdir (used later)
  const strategiesDestDir = path.join(instanceUserDataPath, "strategies");

  // Ensure user data directory for this instance exists
  try {
    await fs.mkdir(instanceUserDataPath, { recursive: true });
    logger.debug(`Ensured user data directory exists: ${instanceUserDataPath}`);
  } catch (mkdirError) {
    logger.error(
      `Failed to create instance user data directory ${instanceUserDataPath}:`,
      mkdirError
    );
    throw new Error(
      `Failed to create instance user data directory. Check permissions for ${absoluteBaseUserDataDir}. Error: ${mkdirError.message}`
    );
  }

  // --- 1. Fetch Bot Template for Defaults ---
  const botTemplate = await Bot.findById(instance.botId);
  if (!botTemplate) {
    logger.warn(
      // Use logger
      `Bot template ${instance.botId} not found for instance ${instanceIdStr}. Using minimal defaults.`
    );
  }
  const templateDefaults =
    botTemplate?.defaultConfig && typeof botTemplate.defaultConfig === "object"
      ? botTemplate.defaultConfig
      : {};
  logger.debug(
    `Loaded template defaults for bot ${instance.botId}:`,
    templateDefaults
  );

  // --- 2. Resolve Strategy and Copy File ---
  let effectiveStrategyFile = instance.strategy; // May include .py
  if (!effectiveStrategyFile && botTemplate?.defaultStrategy) {
    logger.info(
      // Use logger
      `Instance ${instanceIdStr} strategy not set, using default from template: ${botTemplate.defaultStrategy}`
    );
    effectiveStrategyFile = botTemplate.defaultStrategy;
  }
  if (!effectiveStrategyFile) {
    throw new Error(
      `Strategy is not defined for instance ${instanceIdStr} and no default found on Bot template ${instance.botId}.`
    );
  }
  // Ensure instance object has the effective strategy filename for ensureStrategyFile
  instance.strategy = effectiveStrategyFile;
  // Copy the file and get the name for the config (without .py)
  // Pass the absolute strategies path to the helper
  const strategyNameForConfig = await ensureStrategyFile(
    instance,
    instanceUserDataPath, // Pass instance user data path base (though not strictly needed by new ensureStrategyFile)
    strategiesDestDir // Pass absolute strategy dest dir
  );
  logger.info(`Using strategy name in config: ${strategyNameForConfig}`);

  // --- 3. Decrypt API Secret ---
  let decryptedSecretKey;
  try {
    decryptedSecretKey = decrypt(instance.apiSecretKey);
  } catch (error) {
    // Error is logged within decrypt function if configured
    logger.error(
      `Decryption failed for instance ${instanceIdStr}: ${error.message}`
    ); // Add logging here too
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
      // pair_whitelist: [], // Initialized later if needed by StaticPairList sanitization
    },
    // --- USE ABSOLUTE PATHS IN CONFIG ---
    user_data_dir: instanceUserDataPath.replace(/\\/g, "/"), // Freqtrade prefers forward slashes
    db_url: `sqlite:///${dbFilePath.replace(/\\/g, "/")}`, // Absolute path, forward slashes
    logfile: logFileName, // Relative path is okay here as it's relative TO user_data_dir
    // ------------------------------------
    bot_name: `ft_${instanceIdStr}`,
    strategy: strategyNameForConfig,
  };
  logger.debug(
    "Backend Managed Config (with absolute paths):",
    backendManagedConfig
  );

  // Layer 2: Bot Template Defaults (from Bot model)
  const templateDefaultConfig = templateDefaults;

  // Layer 3: User Instance Overrides (from instance.config)
  const userInstanceConfig =
    instance.config && typeof instance.config === "object"
      ? instance.config
      : {};
  logger.debug(
    `Instance specific config overrides for ${instanceIdStr}:`,
    userInstanceConfig
  );

  // --- 5. Merge User and Template Configs ---
  let mergedConfig = merge({}, templateDefaultConfig, userInstanceConfig);
  logger.debug("Merged Template + User Config:", mergedConfig);

  // --- 6. Handle Strategy Specific Parameters ---
  const strategyParams = userInstanceConfig.strategy_params || {};
  if (
    Object.keys(strategyParams).length > 0 &&
    typeof strategyParams === "object"
  ) {
    mergedConfig = merge(mergedConfig, strategyParams); // Merge strategy params into the main config
    logger.info(
      // Use logger
      `Merged strategy_params for instance ${instanceIdStr}:`,
      Object.keys(strategyParams)
    );
  } else if (userInstanceConfig.strategy_params) {
    logger.warn(
      // Use logger
      `Instance ${instanceIdStr}: 'strategy_params' found in config but was not a non-empty object. Ignoring.`
    );
  }
  // Clean up the strategy_params key regardless if it exists at top level after merge
  delete mergedConfig.strategy_params; // Important to avoid Freqtrade warning

  // --- 7. Combine with Backend Managed Config ---
  // Backend managed settings ALWAYS take precedence over template/user settings
  // Merge backendManagedConfig last to ensure it overrides if necessary
  let finalConfig = merge({}, mergedConfig, backendManagedConfig);
  logger.debug(
    "Final Merged Config (Before Sanitization/Overrides):",
    finalConfig
  );

  // --- 8. Final Sanitization/Validation ---

  // Ensure pairlists exists, is an array of objects, and contains at least one entry
  if (
    !finalConfig.pairlists ||
    !Array.isArray(finalConfig.pairlists) ||
    finalConfig.pairlists.length === 0 ||
    finalConfig.pairlists.some((p) => typeof p !== "object" || !p.method) // Check for object and method key
  ) {
    logger.warn(
      // Use logger
      `Instance ${instanceIdStr}: Correcting invalid or missing pairlists structure. Defaulting to StaticPairList.`
    );
    // Default to StaticPairList if invalid or missing
    finalConfig.pairlists = [{ method: "StaticPairList" }];
    // If we default to StaticPairList, we MUST ensure exchange.pair_whitelist exists and is an array
    // Moved this logic inside the next block for consolidation
  }

  // If StaticPairList is used (either by default or explicitly), ensure exchange.pair_whitelist exists and is valid
  if (finalConfig.pairlists[0]?.method === "StaticPairList") {
    const currentWhitelist = finalConfig.exchange?.pair_whitelist; // Use optional chaining
    // Check if whitelist is missing, not an array, or empty
    if (
      !currentWhitelist ||
      !Array.isArray(currentWhitelist) ||
      currentWhitelist.length === 0
    ) {
      logger.warn(
        // Use logger
        `Instance ${instanceIdStr}: StaticPairList used, but exchange.pair_whitelist missing, invalid, or empty. Checking instance/template 'pairs' or defaulting to ['BTC/USDT'].`
      );
      if (!finalConfig.exchange) finalConfig.exchange = {}; // Ensure exchange object exists
      // Check template or instance config for a 'pairs' key as a fallback before hardcoding
      const fallbackPairs =
        userInstanceConfig.pairs || templateDefaultConfig.pairs;
      finalConfig.exchange.pair_whitelist =
        Array.isArray(fallbackPairs) && fallbackPairs.length > 0
          ? fallbackPairs
          : ["BTC/USDT"]; // Ultimate fallback
      logger.info(
        `Instance ${instanceIdStr}: Set exchange.pair_whitelist to: ${JSON.stringify(
          finalConfig.exchange.pair_whitelist
        )}`
      );
    }
  }

  // Ensure max_open_trades is valid
  if (
    finalConfig.max_open_trades === undefined || // Check if it exists at all
    typeof finalConfig.max_open_trades !== "number" ||
    !Number.isInteger(finalConfig.max_open_trades) ||
    finalConfig.max_open_trades < -1 // -1 means unlimited
  ) {
    logger.warn(
      // Use logger
      `Instance ${instanceIdStr}: Correcting invalid max_open_trades (${finalConfig.max_open_trades}). Setting to template default or 5.`
    );
    const templateMax = templateDefaultConfig.max_open_trades;
    finalConfig.max_open_trades =
      typeof templateMax === "number" &&
      Number.isInteger(templateMax) &&
      templateMax >= -1
        ? templateMax
        : 5; // Sensible fallback (adjust if needed)
  }
  // Add more checks as needed

  // --- Apply Debug Overrides --- REMOVE AFTER TESTING ---
  logger.warn(
    `Instance ${instanceIdStr}: APPLYING FORCE startup_candle_count to 50 for testing!`
  );
  finalConfig.startup_candle_count = 50;

  logger.warn(
    `Instance ${instanceIdStr}: APPLYING FORCE StaticPairList with BTC/USDT FOR TESTING!`
  );
  finalConfig.pairlists = [{ method: "StaticPairList" }];
  // Ensure exchange object exists before modifying it
  if (!finalConfig.exchange) {
    finalConfig.exchange = {};
  }
  // Ensure backend keys/secret/name are preserved if they existed
  finalConfig.exchange = {
    ...finalConfig.exchange, // Keep existing exchange name, key/secret etc. if set
    pair_whitelist: ["BTC/USDT"], // Set/override the whitelist under exchange
  };

  // REMOVE potentially conflicting top-level 'pairs' key if it exists from instance/template config merge
  if (finalConfig.pairs) {
    logger.warn(
      `Instance ${instanceIdStr}: Removing potentially conflicting top-level 'pairs' key for testing.`
    );
    delete finalConfig.pairs;
  }
  // --- End Debug Overrides ---

  // Final check log before writing
  logger.debug(
    `Instance ${instanceIdStr}: finalConfig JUST BEFORE writeFile (WITH OVERRIDES & ABSOLUTE PATHS):`,
    JSON.stringify(finalConfig, null, 2)
  );

  // --- 9. Write Config File ---
  try {
    const configData = JSON.stringify(finalConfig, null, 2); // Pretty print
    logger.debug(`Attempting to write config to: ${configFilePath}`);
    await fs.writeFile(configFilePath, configData);
    logger.info(
      `SUCCESS: Wrote config for instance ${instanceIdStr} at ${configFilePath}`
    );
    // Return paths needed by the caller (e.g., startFreqtradeProcess)
    // Return relative log file name as freqtrade process might need it relative to user_data_dir
    return {
      configFilePath,
      logFilePath: logFileName, // Return the relative log file name defined earlier
      dbFilePath,
      instanceUserDataPath, // May be useful for the caller
      strategyName: strategyNameForConfig,
    };
  } catch (writeError) {
    logger.error(`ERROR writing config file ${configFilePath}:`, writeError);
    throw new Error(
      `Failed to write configuration file for instance ${instanceIdStr}. Check permissions for ${instanceUserDataPath}. Error: ${writeError.message}`
    );
  }
} // End of generateInstanceConfig function

// Ensure this function definition replaces the old one as well
async function ensureStrategyFile(
  instance,
  instanceUserDataPath,
  strategiesDestDir
) {
  // instanceUserDataPath is passed but not strictly needed here anymore as strategiesDestDir is absolute
  const instanceIdStr = instance._id.toString();

  // Validate essential config/inputs first
  if (!STRATEGY_SOURCE_DIR) {
    logger.error(
      "Configuration Error: STRATEGY_SOURCE_DIR is not defined in environment/config."
    );
    throw new Error("STRATEGY_SOURCE_DIR is not configured.");
  }
  const strategyFileName = instance.strategy; // Assumes .py extension might be present
  if (!strategyFileName || typeof strategyFileName !== "string") {
    logger.error(
      `Instance ${instanceIdStr}: Strategy filename is missing or invalid.`
    );
    throw new Error(
      `Strategy filename not defined or invalid for instance ${instanceIdStr}`
    );
  }
  // Basic sanitization: trim whitespace and remove leading/trailing slashes
  const cleanStrategyFileName = strategyFileName
    .trim()
    .replace(/^[/\\]+|[/\\]+$/g, "");
  if (!cleanStrategyFileName) {
    logger.error(
      `Instance ${instanceIdStr}: Strategy filename is empty after cleaning.`
    );
    throw new Error(
      `Strategy filename is empty or invalid for instance ${instanceIdStr}`
    );
  }
  if (!cleanStrategyFileName.toLowerCase().endsWith(".py")) {
    logger.warn(
      `Strategy file '${cleanStrategyFileName}' for instance ${instanceIdStr} seems to be missing the .py extension. Assuming it should be added.`
    );
    // Optionally add .py extension if missing? Or throw error? For now, proceed cautiously.
    // Consider adding '.py' if you are sure it's always omitted in the input `instance.strategy`
    // cleanStrategyFileName += '.py'; // Uncomment if you want to auto-append .py
  }

  const sourceStrategyPath = path.resolve(
    STRATEGY_SOURCE_DIR,
    cleanStrategyFileName
  ); // Use resolve for robustness
  // Use the passed-in absolute destination directory + cleaned filename
  const destStrategyPath = path.join(strategiesDestDir, cleanStrategyFileName);

  logger.info(
    `ensureStrategyFile: Instance ${instanceIdStr}. Attempting copy.`
  );
  logger.debug(` -> Source: ${sourceStrategyPath}`);
  logger.debug(` -> Dest Dir: ${strategiesDestDir}`);
  logger.debug(` -> Dest Full Path: ${destStrategyPath}`);

  try {
    logger.debug(`Checking access to source: ${sourceStrategyPath}`);
    await fs.access(sourceStrategyPath, fs.constants.R_OK); // Check read access
    logger.debug(`Source file access confirmed.`);

    // Ensure the absolute destination directory exists
    logger.debug(`Ensuring destination directory: ${strategiesDestDir}`);
    await fs.mkdir(strategiesDestDir, { recursive: true });
    logger.debug(`Destination directory ensured.`);

    logger.debug(
      `Attempting fs.copyFile from ${sourceStrategyPath} to ${destStrategyPath}`
    );
    await fs.copyFile(sourceStrategyPath, destStrategyPath);
    logger.info(
      `SUCCESS: Copied strategy ${cleanStrategyFileName} to ${strategiesDestDir} for instance ${instanceIdStr}`
    );

    // Return the strategy NAME (without .py) for the config file
    return cleanStrategyFileName.replace(/\.py$/i, "");
  } catch (error) {
    logger.error(
      `ERROR in ensureStrategyFile for instance ${instanceIdStr}:`,
      error
    );
    // Provide more specific error messages based on code
    if (error.code === "ENOENT") {
      logger.error(`Strategy source file not found at ${sourceStrategyPath}`);
      throw new Error(
        `Strategy source file not found: ${sourceStrategyPath}. Please ensure '${cleanStrategyFileName}' exists in '${STRATEGY_SOURCE_DIR}'.`
      );
    } else if (error.code === "EACCES") {
      logger.error(
        `Permission denied accessing source (${sourceStrategyPath}) or writing to destination (${destStrategyPath}).`
      );
      throw new Error(
        `Permission denied handling strategy file. Check read permissions for source and write permissions for destination. Source: ${sourceStrategyPath}, Dest Dir: ${strategiesDestDir}`
      );
    } else {
      logger.error(
        `An unexpected error occurred during strategy file preparation: ${error.message}`
      );
      throw new Error(`Failed to prepare strategy file: ${error.message}`);
    }
  }
}

// Remember to ensure that startFreqtradeProcess and stopFreqtradeProcess
// correctly use the paths returned by this updated generateInstanceConfig function.
// Specifically, they should use `configFilePath` when constructing the command line arguments.
// --- Start Freqtrade Process (Uses generateInstanceConfig) ---
async function startFreqtradeProcess(instanceId) {
  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;
  logger.info(`Attempting to start Freqtrade process: ${processName}`);

  // Fetch latest instance data fresh each time
  const instance = await BotInstance.findById(instanceId).populate(
    "botId",
    "defaultStrategy defaultConfig" // Populate needed fields from Bot template
  );
  if (!instance) throw new Error(`BotInstance ${instanceIdStr} not found`);
  logger.debug(`Fetched BotInstance data for ${instanceIdStr}:`, instance);

  // --- Status & Permission Checks ---
  if (!instance.active) {
    logger.warn(`Instance ${instanceIdStr} is inactive. Start aborted.`);
    throw new Error("Instance is inactive.");
  }
  const now = new Date();
  if (instance.expiryDate && instance.expiryDate < now) {
    logger.warn(
      `Instance ${instanceIdStr} expired on ${instance.expiryDate.toISOString()}. Start aborted.`
    );
    // Optionally mark as inactive here if needed
    // await BotInstance.findByIdAndUpdate(instanceId, { $set: { active: false, running: false } });
    throw new Error(
      `Subscription/Demo expired on ${instance.expiryDate.toISOString()}`
    );
  }

  // Check if PM2 process exists and is running
  const existingProcess = await new Promise((resolve) => {
    pm2.describe(processName, (err, list) =>
      resolve(list && list.length > 0 ? list[0] : null)
    );
  });
  if (
    existingProcess &&
    ["online", "launching", "waiting restart", "stopping", "errored"].includes(
      // Include more states just in case
      existingProcess.pm2_env?.status
    )
  ) {
    // If process exists but DB says not running, update DB
    if (!instance.running) {
      logger.warn(
        `Instance ${instanceIdStr}: PM2 process found (status: ${existingProcess.pm2_env?.status}) but DB state is not running. Updating DB.`
      );
      await BotInstance.findByIdAndUpdate(instanceId, {
        $set: { running: true, lastExecuted: new Date() },
      });
    }
    logger.info(
      // Use logger
      `PM2 process ${processName} already exists (status: ${existingProcess.pm2_env?.status}). Ensuring it's stopped before restart.`
    );
    // Attempt to stop and delete before restarting for a clean slate
    try {
      await stopFreqtradeProcess(instanceId); // Use the existing stop function
      logger.info(`Cleaned up existing PM2 process ${processName}.`);
    } catch (cleanupError) {
      logger.error(
        `Error cleaning up existing PM2 process ${processName}, proceeding with start attempt anyway:`,
        cleanupError
      );
    }
    // Note: If the process was genuinely running fine, this stop/start might be unnecessary.
    // Consider refining this logic based on desired behavior (e.g., only restart if 'errored').
    // For now, ensuring a clean start is prioritized for debugging.
  } else if (existingProcess) {
    logger.warn(
      `PM2 process ${processName} exists but status is unexpected: ${existingProcess.pm2_env?.status}. Attempting delete before start.`
    );
    await new Promise((resolve) => pm2.delete(processName, () => resolve())); // Attempt delete
  } else {
    logger.info(
      `No existing PM2 process found for ${processName}. Proceeding with clean start.`
    );
  }

  // --- Generate Config (Includes Strategy Copy) ---
  let configPaths;
  try {
    // Pass the populated instance object
    configPaths = await generateInstanceConfig(instance);
  } catch (configError) {
    logger.error(
      // Use logger
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
  // Freqtrade reads strategy, db, logfile, user_data_dir FROM the config file
  const freqtradeArgs = [
    "trade",
    "--config",
    configPaths.configFilePath,
    "-vv", // Set verbosity to highest level for debugging
  ];

  // Construct paths for PM2 logs within the instance's user_data dir
  const instanceUserDataPath = path.join(
    FREQTRADE_USER_DATA_DIR,
    instanceIdStr
  );
  const pm2OutLogPath = path.join(instanceUserDataPath, "pm2_out.log");
  const pm2ErrLogPath = path.join(instanceUserDataPath, "pm2_err.log");

  const pm2Options = {
    script: FREQTRADE_EXECUTABLE_PATH,
    name: processName,
    args: freqtradeArgs,
    exec_mode: "fork",
    autorestart: false, // Managed by our logic (avoids rapid restart loops on error)
    log_date_format: "YYYY-MM-DD HH:mm:ss Z", // Added seconds
    // PM2 logs capture wrapper stdout/stderr (useful for crashes before freqtrade logs)
    out_file: pm2OutLogPath,
    error_file: pm2ErrLogPath,
    merge_logs: false, // Keep PM2 logs separate (out vs err)
    // cwd: instanceUserDataPath, // Optional: Set CWD if relative paths cause issues
    // env: { ... }, // Optional: Set environment variables if needed by Freqtrade/Python
  };

  logger.info(
    // Use logger
    `Attempting to start PM2 process ${processName} using config: ${configPaths.configFilePath}`
  );
  logger.info(`PM2 log output: ${pm2OutLogPath}`); // Use logger
  logger.info(`PM2 error output: ${pm2ErrLogPath}`); // Use logger
  logger.debug("PM2 Start Options:", pm2Options); // Log options

  // --- Start Process ---
  try {
    // PM2 start is asynchronous
    const apps = await new Promise((resolve, reject) => {
      pm2.start(pm2Options, (startErr, apps) => {
        if (startErr) {
          logger.error(`PM2 start error for ${processName}:`, startErr); // Log detailed error
          return reject(startErr); // Reject the promise on PM2 start error
        }
        resolve(apps); // Resolve the promise with the apps info
      });
    });

    // Check if PM2 actually started the process (apps array might be empty on some errors)
    if (
      !apps ||
      apps.length === 0 ||
      !apps[0]?.pm2_env ||
      apps[0].pm2_env.status !== "online"
    ) {
      logger.error(
        `PM2 failed to bring process ${processName} online. Status: ${
          apps?.[0]?.pm2_env?.status || "unknown"
        }`
      );
      throw new Error(`PM2 failed to start process ${processName}.`);
    }

    logger.info(
      `Successfully initiated PM2 process start for: ${processName}. PM2 status: ${apps[0].pm2_env.status}`
    ); // Use logger
    // Update DB status AFTER successful PM2 start confirmation
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: true, lastExecuted: new Date() },
    });
    const updatedInstance = await BotInstance.findById(instanceId);
    return {
      message: `Bot ${instanceIdStr} started successfully.`,
      instance: updatedInstance,
    };
  } catch (startError) {
    // This catch block now catches errors from the pm2.start callback or the check after
    logger.error(
      `Error during PM2 process start for ${processName}:`,
      startError
    ); // Use logger
    // Ensure DB reflects the failure
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: false },
    });
    // Attempt cleanup in case PM2 created a failed entry
    await new Promise((resolve) => pm2.delete(processName, () => resolve()));
    throw new Error(`Failed to start bot process: ${startError.message}`);
  }
}

// --- Stop Freqtrade Process ---
async function stopFreqtradeProcess(instanceId, markInactive = false) {
  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;
  logger.info(`Attempting to stop PM2 process: ${processName}`); // Use logger

  try {
    // Stop the process
    await new Promise((resolve, reject) => {
      pm2.stop(processName, (err) => {
        if (
          err &&
          err.message?.toLowerCase().includes("process name not found")
        ) {
          logger.warn(
            // Use logger
            `PM2 process ${processName} not found or already stopped.`
          );
          resolve(); // Resolve even if not found, as the goal is achieved
        } else if (err) {
          logger.error(`PM2 stop error for ${processName}:`, err); // Use logger
          reject(err); // Reject on actual stop error
        } else {
          logger.info(`Successfully stopped PM2 process: ${processName}`); // Use logger
          resolve();
        }
      });
    });

    // Delete the process from PM2 management
    await new Promise((resolve) => {
      // No reject needed, just log warnings
      pm2.delete(processName, (err) => {
        if (
          err &&
          !err.message?.toLowerCase().includes("process name not found")
        ) {
          logger.warn(`PM2 delete warning for ${processName}: ${err.message}`); // Use logger
        } else if (!err) {
          logger.info(`Successfully deleted PM2 process: ${processName}`); // Use logger
        }
        resolve(); // Resolve regardless of delete outcome
      });
    });

    // Update DB status
    const updateFields = { running: false };
    if (markInactive) {
      updateFields.active = false;
      logger.info(
        // Use logger
        `Instance ${instanceIdStr} marked as inactive due to expiry/action.`
      );
    }
    await BotInstance.findByIdAndUpdate(instanceId, { $set: updateFields });
    logger.info(
      // Use logger
      `Instance ${instanceIdStr} DB status updated: running=false${
        markInactive ? ", active=false" : ""
      }`
    );

    return { message: `Bot ${instanceIdStr} stopped successfully.` };
  } catch (error) {
    // This primarily catches errors from pm2.stop
    logger.error(
      // Use logger
      `Error in stopFreqtradeProcess for instance ${instanceIdStr}:`,
      error
    );
    // Attempt to mark as not running in DB even if PM2 failed
    try {
      await BotInstance.findByIdAndUpdate(instanceId, {
        $set: { running: false },
      });
    } catch (dbError) {
      logger.error(
        // Use logger
        `Failed to update instance ${instanceIdStr} status after stop failure:`,
        dbError
      );
    }
    // Re-throw the original error that caused the failure (likely pm2.stop error)
    throw error;
  }
}

module.exports = {
  connectPm2,
  disconnectPm2,
  startFreqtradeProcess,
  stopFreqtradeProcess,
  generateInstanceConfig, // Exporting this might be useful for testing/debugging
};
