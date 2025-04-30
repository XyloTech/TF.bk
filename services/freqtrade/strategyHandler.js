// /services/freqtrade/strategyHandler.js
const path = require("path");
const { copyFileSafe, ensureDirExists } = require("./fileUtils");
const logger = require("../../utils/logger");

// --- Robust Path Resolution for Source Directory ---
// Get the relative path from the environment or use a default
// User provided: STRATEGY_SOURCE_DIR=./freqtrade_strategies
const envStrategySourceDir =
  process.env.STRATEGY_SOURCE_DIR || "./freqtrade_strategies";

// Resolve the path absolutely, relative to the project root (assuming this file is in services/freqtrade/)
// This makes it independent of the Current Working Directory (CWD)
// Adjust '../../' if your file structure is different (e.g., if this file is deeper or shallower)
const absoluteStrategySourceDir = path.resolve(
  __dirname,
  "../../",
  envStrategySourceDir
);
logger.debug(
  `[StrategyHandler] Absolute strategy source directory resolved to: ${absoluteStrategySourceDir}`
);
// --- End Robust Path Resolution ---

/**
 * Ensures the correct strategy file exists in the instance's strategies directory.
 * Copies the file from the central STRATEGY_SOURCE_DIR.
 * @param {object} instance - The BotInstance mongoose document. Must contain 'strategy'.
 * @param {string} strategiesDir - The absolute path to the instance's destination strategies directory.
 * @returns {Promise<string>} The strategy name without the .py extension.
 * @throws {Error} If STRATEGY_SOURCE_DIR env var is missing or instance.strategy is missing.
 */
async function ensureStrategyFile(instance, strategiesDir) {
  const instanceIdStr = instance._id.toString(); // For logging context

  // Use the pre-resolved absolute path
  const strategySourceBaseDir = absoluteStrategySourceDir;
  if (!strategySourceBaseDir) {
    // This check might be redundant if the module-level resolution throws, but good practice.
    logger.error(
      "[StrategyHandler] Absolute strategy source directory could not be determined."
    );
    throw new Error("Missing or failed resolution of STRATEGY_SOURCE_DIR");
  }
  // We already logged the resolved path when the module loaded.

  let strategyFile = instance.strategy?.trim();
  if (!strategyFile) {
    logger.error(
      `[StrategyHandler] Instance ${instanceIdStr} is missing strategy filename.`
    );
    throw new Error(`Missing strategy filename for instance ${instanceIdStr}`);
  }
  logger.debug(
    `[StrategyHandler] Instance ${instanceIdStr}: Raw strategy name: '${strategyFile}'`
  );

  // Normalize extension - ensure it ends with .py for file operations
  if (!strategyFile.toLowerCase().endsWith(".py")) {
    const originalName = strategyFile;
    strategyFile += ".py";
    logger.debug(
      `[StrategyHandler] Instance ${instanceIdStr}: Appended .py extension. Now: '${strategyFile}' (Original: '${originalName}')`
    );
  }

  // Prevent potential path traversal in strategy filename (basic check)
  if (strategyFile.includes("/") || strategyFile.includes("\\")) {
    logger.error(
      `[StrategyHandler] Instance ${instanceIdStr}: Invalid strategy filename contains path separators: '${strategyFile}'`
    );
    throw new Error(`Invalid characters in strategy filename: ${strategyFile}`);
  }

  // Construct absolute source and destination paths
  const sourcePath = path.join(strategySourceBaseDir, strategyFile); // Use path.join for safety
  const destinationPath = path.join(strategiesDir, strategyFile); // strategiesDir is already absolute

  logger.debug(
    `[StrategyHandler] Instance ${instanceIdStr}: Preparing to copy strategy.`
  );
  logger.debug(`[StrategyHandler]   Source: ${sourcePath}`);
  logger.debug(`[StrategyHandler]   Destination: ${destinationPath}`);

  try {
    // Ensure destination directory exists
    await ensureDirExists(strategiesDir); // EnsureDir might log internally

    // Copy the file
    const copied = await copyFileSafe(sourcePath, destinationPath); // Assume copyFileSafe returns true/false or throws
    if (copied) {
      logger.debug(
        `[StrategyHandler] Instance ${instanceIdStr}: Successfully copied strategy file.`
      );
    } else {
      // Assuming copyFileSafe returns false if file exists and is identical, which is okay.
      // If it returns false on failure, we need to handle that. Let's assume it throws on real failure.
      logger.debug(
        `[StrategyHandler] Instance ${instanceIdStr}: Strategy file copy operation completed (may have existed).`
      );
    }
  } catch (error) {
    logger.error(
      `[StrategyHandler] Instance ${instanceIdStr}: Failed to ensure strategy file at destination. Error: ${error.message}`
    );
    logger.error(`[StrategyHandler]   Source: ${sourcePath}`);
    logger.error(`[StrategyHandler]   Destination: ${destinationPath}`);
    // Add stack trace for detailed debugging if needed
    // logger.error(error.stack);

    // Re-throw a more specific error, potentially checking for common issues like 'ENOENT' (Source not found)
    if (error.code === "ENOENT" && error.path === sourcePath) {
      throw new Error(`Strategy source file not found: ${sourcePath}`);
    }
    throw new Error(
      `Failed to copy strategy file for instance ${instanceIdStr}: ${error.message}`
    );
  }

  // Return the strategy name *without* the .py extension for the Freqtrade config
  const strategyNameForConfig = strategyFile.replace(/\.py$/i, "");
  logger.debug(
    `[StrategyHandler] Instance ${instanceIdStr}: Returning strategy name for config: '${strategyNameForConfig}'`
  );
  return strategyNameForConfig;
}

module.exports = {
  ensureStrategyFile,
};
