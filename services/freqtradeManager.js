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
  process.env.FREQTRADE_EXECUTABLE_PATH || path.resolve(__dirname, "../../venv/Scripts/python.exe"); // Default to venv python executable
const FREQTRADE_USER_DATA_DIR =
  process.env.FREQTRADE_USER_DATA_DIR || path.resolve(__dirname, "../../data/ft_user_data"); // Base user-data dir

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
      logger.info(" PM2 connected"); // Use logger
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
// (ensureStrategyFile function remains the same as your latest version)
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

// --- Helper: Generate Freqtrade Config (Uses Lodash Merge) ---
async function generateInstanceConfig(instance) {
  const instanceIdStr = instance._id.toString();

  // Ensure FREQTRADE_USER_DATA_DIR is absolute
  const absoluteBaseUserDataDir = path.resolve(FREQTRADE_USER_DATA_DIR);
  if (!absoluteBaseUserDataDir) {
    throw new Error(
      "FREQTRADE_USER_DATA_DIR is not defined or could not be resolved."
    );
  }
  logger.debug(
    `Absolute Base User Data Dir resolved to: ${absoluteBaseUserDataDir}`
  );

  // Generate ABSOLUTE paths for this instance
  const instanceUserDataPath = path.join(
    absoluteBaseUserDataDir,
    instanceIdStr
  );
  const configFilePath = path.join(instanceUserDataPath, "config.json");
  const logFileName = `freqtrade_${instanceIdStr}.log`;
  // dbFilePath is now only needed for the SQLite fallback case
  const dbFilePath = path.join(instanceUserDataPath, "tradesv3.sqlite");
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
  // ... (same as before) ...
  const botTemplate = await Bot.findById(instance.botId);
  if (!botTemplate) {
    logger.warn(
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
  // ... (same as before) ...
  let effectiveStrategyFile = instance.strategy;
  if (!effectiveStrategyFile && botTemplate?.defaultStrategy) {
    logger.info(
      `Instance ${instanceIdStr} strategy not set, using default from template: ${botTemplate.defaultStrategy}`
    );
    effectiveStrategyFile = botTemplate.defaultStrategy;
  }
  if (!effectiveStrategyFile) {
    throw new Error(
      `Strategy is not defined for instance ${instanceIdStr} and no default found on Bot template ${instance.botId}.`
    );
  }
  instance.strategy = effectiveStrategyFile;
  const strategyNameForConfig = await ensureStrategyFile(
    instance,
    instanceUserDataPath,
    strategiesDestDir
  );
  logger.info(`Using strategy name in config: ${strategyNameForConfig}`);

  // --- 3. Decrypt API Secret ---
  // ... (same as before) ...
  let decryptedSecretKey;
  try {
    decryptedSecretKey = decrypt(instance.apiSecretKey);
  } catch (error) {
    logger.error(
      `Decryption failed for instance ${instanceIdStr}: ${error.message}`
    );
    throw new Error(
      `Configuration error: Could not decrypt API secret for instance ${instanceIdStr}. Check CRYPTO_SECRET_KEY and data integrity.`
    );
  }

  // --- 4. Determine DB URL (PostgreSQL or SQLite Fallback) --- START OF CHANGE ---
  const pgUser = process.env.FT_PG_USER;
  const pgPassword = process.env.FT_PG_PASSWORD;
  const pgHost = process.env.FT_PG_HOST;
  const pgPort = process.env.FT_PG_PORT || "5432"; // Default PG port
  const pgDatabase = process.env.FT_PG_DATABASE;

  let dbUrl; // Variable to hold the final DB URL

  if (pgUser && pgPassword && pgHost && pgDatabase) {
    // Use PostgreSQL if all required environment variables are set
    // Use encodeURIComponent for user/password in case they contain special characters
    dbUrl = `postgresql+psycopg2://${encodeURIComponent(
      pgUser
    )}:${encodeURIComponent(
      pgPassword
    )}@${pgHost}:${pgPort}/${encodeURIComponent(pgDatabase)}`;
    logger.info(
      `Instance ${instanceIdStr}: Using PostgreSQL database connection.`
    );
  } else {
    // Fallback to SQLite (useful for local dev, but WILL NOT PERSIST ON RENDER FREE TIER)
    logger.warn(
      `Instance ${instanceIdStr}: PostgreSQL environment variables not fully set (FT_PG_USER, FT_PG_PASSWORD, FT_PG_HOST, FT_PG_DATABASE must all be present). Falling back to SQLite (WILL NOT PERSIST ON RENDER FREE TIER).`
    );
    // dbFilePath defined earlier
    dbUrl = `sqlite:///${dbFilePath.replace(/\\/g, "/")}`;
  }
  // --- END OF CHANGE ---

  // --- 5. Define Configuration Layers ---
  const backendManagedConfig = {
    dry_run: instance.accountType === "demo",
    exchange: {
      name: instance.exchange.toLowerCase(),
      key: instance.apiKey,
      secret: decryptedSecretKey,
    },
    user_data_dir: instanceUserDataPath.replace(/\\/g, "/"),
    db_url: dbUrl, // <--- Use the determined dbUrl (PostgreSQL or SQLite)
    logfile: logFileName,
    bot_name: `ft_${instanceIdStr}`,
    strategy: strategyNameForConfig,
  };
  logger.debug(
    "Backend Managed Config (with absolute paths):",
    backendManagedConfig // This will now show the correct db_url
  );

  // Layer 2: Bot Template Defaults
  const templateDefaultConfig = templateDefaults;

  // Layer 3: User Instance Overrides
  const userInstanceConfig =
    instance.config && typeof instance.config === "object"
      ? instance.config
      : {};
  logger.debug(
    `Instance specific config overrides for ${instanceIdStr}:`,
    userInstanceConfig
  );

  // --- 6. Merge User and Template Configs ---
  // ... (same as before) ...
  let mergedConfig = merge({}, templateDefaultConfig, userInstanceConfig);
  logger.debug("Merged Template + User Config:", mergedConfig);

  // --- 7. Handle Strategy Specific Parameters ---
  // ... (same as before) ...
  const strategyParams = userInstanceConfig.strategy_params || {};
  if (
    Object.keys(strategyParams).length > 0 &&
    typeof strategyParams === "object"
  ) {
    mergedConfig = merge(mergedConfig, strategyParams);
    logger.info(
      `Merged strategy_params for instance ${instanceIdStr}:`,
      Object.keys(strategyParams)
    );
  } else if (userInstanceConfig.strategy_params) {
    logger.warn(
      `Instance ${instanceIdStr}: 'strategy_params' found in config but was not a non-empty object. Ignoring.`
    );
  }
  delete mergedConfig.strategy_params;

  // --- 8. Combine with Backend Managed Config ---
  // ... (same as before) ...
  let finalConfig = merge({}, mergedConfig, backendManagedConfig);
  logger.debug("Final Merged Config (Before Sanitization):", finalConfig);

  // --- 9. Final Sanitization/Validation ---
  // ... (same sanitization logic for pairlists, max_open_trades, etc. as before) ...
  if (
    !finalConfig.pairlists ||
    !Array.isArray(finalConfig.pairlists) ||
    finalConfig.pairlists.length === 0 ||
    finalConfig.pairlists.some((p) => typeof p !== "object" || !p.method)
  ) {
    logger.warn(
      `Instance ${instanceIdStr}: Correcting invalid or missing pairlists structure. Defaulting to StaticPairList.`
    );
    finalConfig.pairlists = [{ method: "StaticPairList" }];
  }

  if (finalConfig.pairlists[0]?.method === "StaticPairList") {
    const currentWhitelist = finalConfig.exchange?.pair_whitelist;
    if (
      !currentWhitelist ||
      !Array.isArray(currentWhitelist) ||
      currentWhitelist.length === 0
    ) {
      logger.warn(
        `Instance ${instanceIdStr}: StaticPairList used, but exchange.pair_whitelist missing, invalid, or empty. Checking instance/template 'pairs' or defaulting to ['BTC/USDT'].`
      );
      if (!finalConfig.exchange) finalConfig.exchange = {};
      const fallbackPairs =
        userInstanceConfig.pairs || templateDefaultConfig.pairs;
      finalConfig.exchange.pair_whitelist =
        Array.isArray(fallbackPairs) && fallbackPairs.length > 0
          ? fallbackPairs
          : ["BTC/USDT"];
      logger.info(
        `Instance ${instanceIdStr}: Set exchange.pair_whitelist to: ${JSON.stringify(
          finalConfig.exchange.pair_whitelist
        )}`
      );
    }
  }

  if (
    finalConfig.max_open_trades === undefined ||
    typeof finalConfig.max_open_trades !== "number" ||
    !Number.isInteger(finalConfig.max_open_trades) ||
    finalConfig.max_open_trades < -1
  ) {
    logger.warn(
      `Instance ${instanceIdStr}: Correcting invalid max_open_trades (${finalConfig.max_open_trades}). Setting to template default or 5.`
    );
    const templateMax = templateDefaultConfig.max_open_trades;
    finalConfig.max_open_trades =
      typeof templateMax === "number" &&
      Number.isInteger(templateMax) &&
      templateMax >= -1
        ? templateMax
        : 5;
  }

  // --- Final check log before writing ---
  logger.debug(
    `Instance ${instanceIdStr}: finalConfig JUST BEFORE writeFile (AFTER SANITIZATION & ABSOLUTE PATHS):`,
    JSON.stringify(finalConfig, null, 2)
  );

  // --- 10. Write Config File ---
  // ... (same as before) ...
  try {
    const configData = JSON.stringify(finalConfig, null, 2);
    logger.debug(`Attempting to write config to: ${configFilePath}`);
    await fs.writeFile(configFilePath, configData);
    logger.info(
      `SUCCESS: Wrote config for instance ${instanceIdStr} at ${configFilePath}`
    );
    // Return dbFilePath only if SQLite was used, maybe adjust return object?
    // For simplicity, keep return object same for now.
    return {
      configFilePath,
      logFilePath: logFileName,
      // dbFilePath is less relevant if using PG, but keep for consistency or remove if preferred
      dbFilePath: dbUrl.startsWith("sqlite") ? dbFilePath : null,
      instanceUserDataPath,
      strategyName: strategyNameForConfig,
    };
  } catch (writeError) {
    logger.error(`ERROR writing config file ${configFilePath}:`, writeError);
    throw new Error(
      `Failed to write configuration file for instance ${instanceIdStr}. Check permissions for ${instanceUserDataPath}. Error: ${writeError.message}`
    );
  }
} // End of generateInstanceConfig function

// --- Start Freqtrade Process (Uses generateInstanceConfig) ---
// (startFreqtradeProcess function remains the same as your latest version)
async function startFreqtradeProcess(instanceId) {

  // Validate FREQTRADE_EXECUTABLE_PATH
  const isExecutablePathValid = await fs.access(FREQTRADE_EXECUTABLE_PATH, fs.constants.F_OK | fs.constants.X_OK)
    .then(() => true)
    .catch(() => false);

  if (!FREQTRADE_EXECUTABLE_PATH || !isExecutablePathValid) {
    const errorMessage = `FREQTRADE_EXECUTABLE_PATH is not set or points to an invalid/inaccessible path: ${FREQTRADE_EXECUTABLE_PATH}`;
    logger.error(`❌ ${errorMessage}`);
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: false, status: `Failed to start: ${errorMessage}` },
    });
    throw new Error(errorMessage);
  }

  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;


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
    name: processName,
    script: FREQTRADE_EXECUTABLE_PATH,
    args: [
      "-m",
      "freqtrade",
      "trade",
      "--config",
      configPaths.configFilePath,
      "-vv",
    ],
    cwd: process.cwd(), // Set the current working directory to the backend root
    exec_mode: "fork",
    autorestart: false,
    out_file: pm2OutLogPath,
    error_file: pm2ErrLogPath,
    merge_logs: false,
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
  };

  logger.info(
    // Use logger
    `Attempting to start PM2 process ${processName} using config: ${configPaths.configFilePath}`
  );
  logger.info(`PM2 log output: ${pm2OutLogPath}`); // Use logger
  logger.info(`PM2 error output: ${pm2ErrLogPath}`); // Use logger
  logger.debug("PM2 Start Options:", pm2Options); // Log options
  logger.info(`[freqtradeManager] PM2 out_file: ${pm2Options.out_file}`);
  logger.info(`[freqtradeManager] PM2 error_file: ${pm2Options.error_file}`);
  logger.info(`[freqtradeManager] Attempting pm2.start for process: ${processName}`);

  // --- Start Process ---
  try {
    // PM2 start is asynchronous
    logger.debug(`[freqtradeManager] Calling pm2.start with options: ${JSON.stringify(pm2Options, null, 2)}`);
    const apps = await new Promise((resolve, reject) => {
      pm2.start(pm2Options, (startErr, apps) => {
        if (startErr) {
          logger.error(`PM2 start error for ${processName}:`, startErr); // Log the full error object directly
          // Ensure startErr is always a string for consistent error messages
          const errorToReject = startErr instanceof Error ? startErr : new Error(String(startErr));
          errorToReject.message = `PM2 start failed for ${processName}: ${errorToReject.message || String(startErr)}`;
          logger.error(`[freqtradeManager] PM2 start failed for ${processName}. Error: ${errorToReject.message}`);
          return reject(errorToReject);
        }
        logger.debug(`[freqtradeManager] pm2.start callback received apps: ${JSON.stringify(apps, null, 2)}`);
        resolve(apps); // Resolve the promise with the apps info
      });
    });

    logger.debug(`[freqtradeManager] pm2.start promise resolved with apps: ${JSON.stringify(apps, null, 2)}`);

    // Check if PM2 actually started the process (apps array might be empty on some errors)
    if (
      !apps ||
      apps.length === 0 ||
      !apps[0]?.pm2_env ||
      apps[0].pm2_env.status !== "online"
    ) {
      const pm2Status = apps?.[0]?.pm2_env?.status || "unknown";
      logger.error(
        `PM2 failed to bring process ${processName} online. Status: ${pm2Status}`
      );
      throw new Error(`PM2 failed to start process: ${pm2Status}. Check PM2 logs for details.`);
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
      {
        name: startError?.name,
        message: startError?.message,
        stack: startError?.stack,
        fullError: startError, // Log the full error object for inspection
      }
    ); // Use logger
    // Ensure DB reflects the failure
    await BotInstance.findByIdAndUpdate(instanceId, {
      $set: { running: false },
    });
    // Attempt cleanup in case PM2 created a failed entry
    await new Promise((resolve) => pm2.delete(processName, () => resolve()));
    // Ensure startError is always a string for consistent error messages
    let errorMessage = "Unknown error during PM2 process start";
    if (startError) {
      errorMessage = startError.message || (startError.fullError && startError.fullError.message) || String(startError);
    }
    throw new Error(`Failed to start bot process: ${errorMessage}. Check PM2 logs for details.`);
  }
}

// --- Stop Freqtrade Process ---
async function stopFreqtradeProcess(instanceId, markInactive = true) {
  await connectPm2();
  const instanceIdStr = instanceId.toString();
  const processName = `freqtrade-${instanceIdStr}`;

  logger.info(`Attempting to stop PM2 process: ${processName}`);

  try {
    logger.debug(`[stopFreqtradeProcess] Listing PM2 processes to find ${processName}...`);
    // Check if the process exists in PM2 before attempting to delete
    const list = await new Promise((resolve, reject) => {
      pm2.list((err, processes) => {
        if (err) {
          logger.error(`[stopFreqtradeProcess] Error listing PM2 processes:`, err);
          return reject(err);
        }
        logger.debug(`[stopFreqtradeProcess] PM2 processes listed: ${processes.map(p => p.name).join(', ')}`);
        resolve(processes);
      });
    });

    const processExists = list.some(p => p.name === processName);
    logger.info(`[stopFreqtradeProcess] Process ${processName} exists in PM2: ${processExists}`);

    if (processExists) {
      logger.info(`[stopFreqtradeProcess] Deleting PM2 process: ${processName}`);
      await new Promise((resolve, reject) => {
        pm2.delete(processName, (err) => {
          if (err) {
            logger.error(`[stopFreqtradeProcess] Error deleting PM2 process ${processName}:`, err);
            return reject(new Error(`Failed to delete PM2 process: ${err.message}`));
          }
          logger.info(`[stopFreqtradeProcess] Successfully deleted PM2 process: ${processName}`);
          resolve();
        });
      });
    } else {
      logger.warn(`[stopFreqtradeProcess] PM2 process ${processName} not found. Assuming it's already stopped or never started.`);
    }

    // Update BotInstance status in DB
    const updateData = {
      running: false,
      status: "STOPPED",
    };
    if (markInactive) {
      updateData.active = false;
      logger.info(
        `Instance ${instanceIdStr} marked as inactive due to expiry/action.`
      );
    }

    logger.debug(`[stopFreqtradeProcess] Updating BotInstance ${instanceIdStr} in DB with data: ${JSON.stringify(updateData)}`);
    const updatedInstance = await BotInstance.findByIdAndUpdate(
      instanceId,
      { $set: updateData },
      { new: true }
    );

    if (!updatedInstance) {
      logger.warn(`[stopFreqtradeProcess] BotInstance ${instanceIdStr} not found in DB during stop process.`);
      return { message: "Bot instance not found in database." };
    }

    logger.info(`[stopFreqtradeProcess] Bot instance ${instanceIdStr} status updated to STOPPED in DB.`);
    return { message: `Bot "${updatedInstance.botId?.name || updatedInstance._id.toString().slice(-6)}" stopped successfully.` };
  } catch (error) {
    logger.error(
      `[stopFreqtradeProcess] Caught error for instance ${instanceIdStr}:`, { name: error.name, message: error.message, stack: error.stack }
    );
    // Attempt to mark as not running in DB even if PM2 failed
    try {
      logger.warn(`[stopFreqtradeProcess] Attempting to update DB status to running: false for ${instanceIdStr} after error.`);
      await BotInstance.findByIdAndUpdate(instanceId, {
        $set: { running: false, status: `ERROR_STOPPING: ${error.message}` },
      });
      logger.info(`[stopFreqtradeProcess] DB status updated to running: false for ${instanceIdStr}.`);
    } catch (dbError) {
      logger.error(
        `[stopFreqtradeProcess] Failed to update instance ${instanceIdStr} status after stop failure:`, { name: dbError.name, message: dbError.message, stack: dbError.stack }
      );
    }
    // Re-throw the original error that caused the failure (likely pm2.stop error)
    if (error.message.includes("Failed to delete PM2 process: process or namespace not found") || error.message.includes("process or namespace not found")) {
      logger.info(`[stopFreqtradeProcess] Process ${processName} was not found, but bot instance ${instanceIdStr} status updated to STOPPED in DB.`);
      // If the process was not found, it means it's already stopped or never started, so we can consider it a success.
      // We already updated the DB status above, so just return the success message.
      const updatedInstanceAfterError = await BotInstance.findById(instanceId);
      return { message: `Bot "${updatedInstanceAfterError?.botId?.name || updatedInstanceAfterError?._id.toString().slice(-6)}" stopped successfully.` };
    } else {
      throw error;
    }
  }
}

module.exports = {
  connectPm2,
  disconnectPm2,
  startFreqtradeProcess,
  stopFreqtradeProcess,
  generateInstanceConfig,
};
