// /services/freqtrade/configBuilder.js
const fs = require("fs").promises;
const path = require("path");
const merge = require("lodash.merge");
const { decrypt } = require("../../utils/crypto");
const logger = require("../../utils/logger");

const Bot = require("../../models/Bot");
const { ensureStrategyFile } = require("./strategyHandler");
const { resolveDatabaseUrl } = require("./dbUrls");
const { ensureDirExists } = require("./fileUtils");

// --- Robust Path Resolution ---
// Get the relative path from the environment or use a default
// User provided: FREQTRADE_USER_DATA_DIR=./data/ft_user_data
const envUserDataDir =
  process.env.FREQTRADE_USER_DATA_DIR || "./data/ft_user_data";

// Resolve the path absolutely, relative to the project root (assuming this file is in services/freqtrade/)
// This makes it independent of the Current Working Directory (CWD)
const absoluteUserDataBaseDir = path.resolve(
  __dirname,
  "../../",
  envUserDataDir
);
// --- End Robust Path Resolution ---

// Build config from DB data + templates + file handling logic
async function generateInstanceConfig(instance) {
  const instanceIdStr = instance._id.toString();
  logger.debug(
    `[ConfigBuilder] Starting config generation for instance: ${instanceIdStr}`
  );

  // Use the pre-calculated absolute base directory
  const baseDir = absoluteUserDataBaseDir;
  logger.debug(
    `[ConfigBuilder] Base user data directory resolved absolutely to: ${baseDir}` // Updated log message
  );

  const instanceDir = path.join(baseDir, instanceIdStr);
  logger.debug(`[ConfigBuilder] Instance directory set to: ${instanceDir}`);

  const strategiesDir = path.join(instanceDir, "strategies");
  const configFilePath = path.join(instanceDir, "config.json");
  const dbUrl = resolveDatabaseUrl(instanceIdStr, instanceDir);
  logger.debug(`[ConfigBuilder] Resolved DB URL: ${dbUrl}`);

  // --- Ensure Directories Exist ---
  await ensureDirExists(instanceDir);
  logger.debug(
    `[ConfigBuilder] Ensured instance directory exists: ${instanceDir}`
  );

  // --- Fetch Template & Determine Strategy ---
  const botTemplate = await Bot.findById(instance.botId);
  const templateDefaults = botTemplate?.defaultConfig || {};
  if (botTemplate) {
    logger.debug(
      `[ConfigBuilder] Fetched bot template defaults for botId: ${instance.botId}`
    );
  } else {
    logger.warn(
      `[ConfigBuilder] No bot template found for botId: ${instance.botId}. Using empty defaults.`
    );
  }

  const effectiveStrategy = instance.strategy || botTemplate?.defaultStrategy;
  logger.debug(
    `[ConfigBuilder] Determined effective strategy: ${
      effectiveStrategy || "None"
    }`
  );

  if (!effectiveStrategy) {
    logger.error(
      `[ConfigBuilder] Strategy could not be determined for instance ${instanceIdStr} (instance.strategy or template.defaultStrategy)`
    );
    throw new Error(`Strategy not defined for instance ${instanceIdStr}`);
  }

  // --- Ensure Strategy File & Handle Secrets ---
  instance.strategy = effectiveStrategy; // Assign back if it came from template
  // IMPORTANT: Assuming ensureStrategyFile internally uses STRATEGY_SOURCE_DIR and resolves it robustly (e.g., relative to project root)
  const strategyName = await ensureStrategyFile(instance, strategiesDir);
  logger.debug(
    `[ConfigBuilder] Strategy file ensured/placed. Resolved strategy name for config: ${strategyName}`
  );

  let apiSecret = null;
  try {
    apiSecret = decrypt(instance.apiSecretKey);
    logger.debug(
      `[ConfigBuilder] API Secret decrypted successfully for instance ${instanceIdStr}.`
    );
  } catch (error) {
    logger.error(
      `[ConfigBuilder] Failed to decrypt API secret for instance ${instanceIdStr}: ${error.message}`
    );
    throw new Error(
      `Failed to decrypt API secret for instance ${instanceIdStr}`
    );
  }

  // --- Prepare Backend Overrides ---
  const backendConfig = {
    dry_run: instance.accountType === "demo",
    exchange: {
      name: instance.exchange.toLowerCase(), // <--- APPLY .toLowerCase() HERE
      key: instance.apiKey,
      secret: apiSecret,
    },
    strategy: strategyName,
    bot_name: `ft_${instanceIdStr}`,
    logfile: `freqtrade_${instanceIdStr}.log`, // Consider making log path absolute too?
    db_url: dbUrl,
    // Verify if Freqtrade needs forward slashes here, path.join provides native format
    user_data_dir: instanceDir, // Pass the absolute path directly
    // user_data_dir: instanceDir.replace(/\\/g, "/"), // Keep if Freqtrade *requires* forward slashes
  };
  logger.debug(
    `[ConfigBuilder] Prepared backend-specific config overrides for instance ${instanceIdStr} (Secrets are included but not logged here).`
  );
  logger.debug(
    `[ConfigBuilder] Dry run status set to: ${backendConfig.dry_run}`
  );

  // --- Merge Configurations ---
  const userConfig = instance.config || {};
  logger.debug(
    `[ConfigBuilder] Merging configs for instance ${instanceIdStr}: templateDefaults, userConfig, backendConfig`
  );
  const merged = merge({}, templateDefaults, userConfig, backendConfig);

  // Ensure exit_pricing and entry_pricing are present
 main
  // These are minimal defaults to satisfy schema validation if not provided elsewhere
  merged.exit_pricing = merged.exit_pricing || {
    price_type: "ohlcv",
    data_key: "close",
    use_exit_signal: true,
    allow_df_rate_limit: false

  merged.exit_pricing = merged.exit_pricing || {
    price_type: "ohlcv",
    data_key: "close",
 master
  };
  merged.entry_pricing = merged.entry_pricing || {
    price_type: "ohlcv",
    data_key: "open",
 main
    price_side: "same",
    use_order_book: false,
    order_book_top: 1,
    price_last_balance: 0.0,
    check_depth_of_market: {
      enabled: false,
      bids_to_ask_delta: 1
    }
 master
  };

  // --- Apply Defaults & Validation ---
  if (!merged.pairlists?.length) {
    logger.debug(
      `[ConfigBuilder] Instance ${instanceIdStr}: No pairlist found in merged config, applying default StaticPairList.`
    );
    merged.pairlists = [{ method: "StaticPairList" }];
  }

  merged.exchange = merged.exchange || {}; // Ensure exchange object exists
  if (!merged.exchange.pair_whitelist?.length) {
    logger.debug(
      `[ConfigBuilder] Instance ${instanceIdStr}: No pair_whitelist found in merged config, applying default ['BTC/USDT'].`
    );
    merged.exchange.pair_whitelist = ["BTC/USDT"];
  }

  // Refined max_open_trades check (Use the clearer logic)
  const originalMaxOpenTrades = merged.max_open_trades;
  if (
    !(
      (Number.isInteger(merged.max_open_trades) &&
        merged.max_open_trades > 0) ||
      merged.max_open_trades === -1
    )
  ) {
    logger.debug(
      `[ConfigBuilder] Instance ${instanceIdStr}: Invalid or missing max_open_trades (${originalMaxOpenTrades}), defaulting to 5.`
    );
    merged.max_open_trades = 5;
  }

  // --- Log Final Keys (Safely) & Write File ---
  const finalKeys = Object.keys(merged);
  logger.debug(
    `[ConfigBuilder] Final merged config generated for instance ${instanceIdStr}. Keys: ${finalKeys.join(
      ", "
    )} (Secrets omitted from this log).`
  );

  const content = JSON.stringify(merged, null, 2);
  await fs.writeFile(configFilePath, content);
  logger.debug(
    `[ConfigBuilder] Successfully wrote final config for instance ${instanceIdStr} to: ${configFilePath}`
  );

  // --- Return Results ---
  logger.debug(
    `[ConfigBuilder] Finished generating config for instance ${instanceIdStr}.`
  );
  return {
    configFilePath, // This is now an absolute path
    dbUrl,
    instanceDir, // This is now an absolute path
    strategyName,
  };
}

module.exports = {
  generateInstanceConfig,
};
