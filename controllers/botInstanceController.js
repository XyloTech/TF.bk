// controllers/botInstanceController.js
const mongoose = require("mongoose");
const BotInstance = require("../models/BotInstance");
const Bot = require("../models/Bot");
const {
  startFreqtradeProcess,
  stopFreqtradeProcess,
} = require("../services/freqtrade");
const logger = require("../utils/logger");

// 🔹 Purchase Bot (Handles Demo Shell Creation and Paid Bot Creation)
exports.purchaseBot = async (req, res) => {
  const operation = "purchaseBot";
  try {
    const {
      botId: requestedBotId,
      telegramId: requestedTelegramId,
      strategy: requestedStrategy,
      config: requestedConfig,
      accountType: requestedAccountType, // Frontend sends this for demo initiation
    } = req.body;
    const userId = req.userDB._id;

    logger.info(
      `[${operation}] User: ${userId} attempting to purchase/initiate bot. Body:`,
      // Mask sensitive fields if they were accidentally sent for demo
      {
        ...req.body,
        apiKey: req.body.apiKey ? "***" : undefined,
        apiSecretKey: req.body.apiSecretKey ? "***" : undefined,
      }
    );

    const accountType = requestedAccountType === "paid" ? "paid" : "demo";

    // Validate Bot Template ID
    if (!requestedBotId || !mongoose.Types.ObjectId.isValid(requestedBotId)) {
      logger.warn(
        `[${operation}] Invalid Bot ID provided. UserID: ${userId}, BotID: ${requestedBotId}`
      );
      return res
        .status(400)
        .json({ message: "Valid Bot ID (botId) is required." });
    }
    const botTemplate = await Bot.findById(requestedBotId);
    if (!botTemplate) {
      logger.warn(
        `[${operation}] Bot template not found. UserID: ${userId}, BotID: ${requestedBotId}`
      );
      return res.status(404).json({ message: "Bot template not found." });
    }
    logger.info(
      `[${operation}] Found bot template: ${botTemplate.name} for BotID: ${requestedBotId}`
    );

    // --- Repeat Demo Prevention (primary check, DB index is backup) ---
    if (accountType === "demo") {
      logger.info(
        `[${operation}] Demo request. Checking for existing demo for User: ${userId}, BotID: ${requestedBotId}`
      );
      // The unique index on BotInstance model will also prevent this at DB level
      const existingDemo = await BotInstance.findOne({
        userId: userId,
        botId: requestedBotId,
        accountType: "demo",
      });
      if (existingDemo) {
        logger.warn(
          `[${operation}] User ${userId} already has a demo for BotID ${requestedBotId}. Instance: ${existingDemo._id}`
        );
        return res
          .status(403)
          .json({ message: "You have already used a demo for this bot." });
      }
      logger.info(
        `[${operation}] No existing demo found for User: ${userId}, BotID: ${requestedBotId}. Proceeding.`
      );
    }

    const purchaseDate = new Date();
    let expiryDate;

    // Prepare base instance data
    let instanceData = {
      botId: requestedBotId,
      userId,
      telegramId:
        requestedTelegramId ||
        req.userDB.telegramId || // User's global default
        botTemplate.defaultTelegramId || // Template's default
        "", // Fallback
      strategy:
        requestedStrategy ||
        botTemplate.defaultStrategy || // Template's default
        "DEFAULT_STRATEGY", // Fallback
      config:
        (typeof requestedConfig === "object" &&
        requestedConfig !== null &&
        !Array.isArray(requestedConfig)
          ? requestedConfig
          : botTemplate.defaultConfig) || {}, // Template's default or empty
      purchaseDate,
      accountType,
      active: true,
      running: false,
      // For DEMO initiation, keys and exchange are intentionally left to default (empty string from model)
      // They will be set by the user on the configure page
      apiKey: "",
      apiSecretKey: "",
      exchange: "",
    };

    if (accountType === "paid") {
      // For PAID bots, API keys and exchange MUST be provided at purchase if this endpoint is used.
      // This path assumes a direct paid creation, not one following a payment gateway webhook.
      const { apiKey, apiSecretKey, exchange: paidExchange } = req.body;
      if (!apiKey || !apiSecretKey || !paidExchange) {
        logger.warn(
          `[${operation}] Missing apiKey, apiSecretKey, or exchange for PAID bot creation. User: ${userId}`
        );
        return res.status(400).json({
          message:
            "For paid bots, apiKey, apiSecretKey, and exchange are required at purchase.",
        });
      }

      const validExchanges = BotInstance.schema
        .path("exchange")
        .enumValues.filter((e) => e !== ""); // Valid non-empty exchanges
      if (
        typeof paidExchange !== "string" ||
        !validExchanges.includes(paidExchange.toUpperCase())
      ) {
        logger.warn(
          `[${operation}] Invalid exchange '${paidExchange}' for PAID bot. User: ${userId}`
        );
        return res.status(400).json({
          message: `Invalid exchange. Supported exchanges: ${validExchanges.join(
            ", "
          )}`,
        });
      }

      instanceData.apiKey = apiKey.trim();
      instanceData.apiSecretKey = apiSecretKey; // Pre-save hook will encrypt this plain text
      instanceData.exchange = paidExchange.toUpperCase();

      expiryDate = new Date(purchaseDate);
      expiryDate.setMonth(
        expiryDate.getMonth() + (botTemplate.durationMonths || 1)
      );
      logger.info(
        `[${operation}] Setting PAID expiry for User ${userId} to: ${expiryDate}`
      );
    } else {
      // Demo account
      expiryDate = new Date(purchaseDate.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      logger.info(
        `[${operation}] Setting DEMO expiry for User ${userId} to: ${expiryDate}`
      );
    }
    instanceData.expiryDate = expiryDate;

    const botInstance = new BotInstance(instanceData);
    await botInstance.save(); // This will trigger the pre-save hook for apiSecretKey
    logger.info(
      `[${operation}] Successfully created BotInstance ${botInstance._id} for User ${userId}, Type: ${accountType}`
    );

    res.status(201).json(botInstance.toJSON());
  } catch (error) {
    logger.error(
      `[${operation}] Error creating bot instance for User ${req.userDB?._id}:`,
      {
        // It's often helpful to log the actual error object first, then extra context
        error: error, // or error.message, error.stack if 'error' object is too verbose
        message: error.message, // Redundant if error object is logged
        stack: error.stack, // Redundant if error object is logged
        userId: req.userDB?._id, // Context
        bodyReceived: { ...req.body, apiKey: "***", apiSecretKey: "***" }, // Masked body
      }
    );
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    if (error.code === 11000) {
      logger.warn(
        `[${operation}] Duplicate key error (E11000) for User ${req.userDB?._id}, likely tried to create duplicate demo. Details:`,
        error.keyValue
      );
      return res.status(409).json({
        message:
          "Operation failed. You might have already created a demo for this bot.",
        details: error.keyValue,
      });
    }
    res.status(500).json({ message: "Failed to create bot instance." });
  }
};

// 🔹 Get User Bots
exports.getUserBots = async (req, res) => {
  const operation = "getUserBots";
  try {
    const userId = req.userDB._id;
    const bots = await BotInstance.find({ userId: userId })
      .populate("botId", "name description imageUrl price defaultStrategy")
      .sort({ createdAt: -1 });

    res.json(bots.map((bot) => bot.toJSON()));
  } catch (error) {
    logger.error(
      `[${operation}] Error fetching user bots for User ${req.userDB?._id}:`,
      error
    );
    res.status(500).json({ message: "Failed to retrieve bot instances." });
  }
};

// 🔹 Update API Keys, Secret, Telegram ID, and Exchange for a Specific Bot Instance
exports.updateBotInstanceKeys = async (req, res) => {
  const operation = "updateBotInstanceKeys";
  try {
    const { botInstanceId } = req.params;
    const { apiKey, apiSecretKey, telegramId, exchange } = req.body;
    const userId = req.userDB._id;

    logger.info(
      `[${operation}] Attempting to update BotInstance ${botInstanceId} for User ${userId}. Payload:`,
      {
        ...req.body,
        apiKey: apiKey ? "***" : undefined,
        apiSecretKey: apiSecretKey ? "***" : undefined,
      }
    );

    const botInstance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId,
    });

    if (!botInstance) {
      logger.warn(
        `[${operation}] BotInstance ${botInstanceId} not found or permission denied for User ${userId}.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }

    let updatedFields = false;
    let criticalConfigChanged = false;

    // API Key Update Logic
    if (apiKey !== undefined) {
      const newApiKey = apiKey.trim();
      // Check if it's a change from the current (unencrypted) apiKey
      if (newApiKey !== botInstance.apiKey) {
        botInstance.apiKey = newApiKey; // Store trimmed, unencrypted
        updatedFields = true;
        criticalConfigChanged = true;
        logger.info(
          `[${operation}] Updated API Key for BotInstance ${botInstanceId}.`
        );
      }
    }

    // API Secret Key Update Logic
    if (apiSecretKey !== undefined) {
      // If apiSecretKey is provided, it's assumed to be new plain text.
      // The pre-save hook will encrypt it if it's non-empty.
      // If it's an empty string, it means user wants to clear it.
      // We can't compare to the existing encrypted secret, so any provided value is treated as a change.
      botInstance.apiSecretKey = apiSecretKey; // Store plain text temporarily; pre-save encrypts
      updatedFields = true;
      criticalConfigChanged = true;
      logger.info(
        `[${operation}] API Secret Key provided for BotInstance ${botInstanceId}. Will be processed on save.`
      );
    }

    // Telegram ID Update Logic
    if (telegramId !== undefined && typeof telegramId === "string") {
      const newTelegramId = telegramId.trim();
      if (newTelegramId !== botInstance.telegramId) {
        botInstance.telegramId = newTelegramId;
        updatedFields = true;
        criticalConfigChanged = true;
        logger.info(
          `[${operation}] Updated Telegram ID for BotInstance ${botInstanceId} to '${newTelegramId}'.`
        );
      }
    }

    // Exchange Update Logic
    if (exchange !== undefined) {
      const newExchange =
        typeof exchange === "string" ? exchange.trim().toUpperCase() : "";

      if (newExchange !== botInstance.exchange) {
        if (newExchange !== "") {
          // If setting to a non-empty value
          const validExchanges = BotInstance.schema
            .path("exchange")
            .enumValues.filter((e) => e !== "");
          if (!validExchanges.includes(newExchange)) {
            logger.warn(
              `[${operation}] Invalid exchange value '${newExchange}' for BotInstance ${botInstanceId}.`
            );
            return res.status(400).json({
              message: `Invalid exchange value. Supported: ${validExchanges.join(
                ", "
              )}`,
            });
          }
        }
        // Allow setting/changing exchange if:
        // 1. The instance's current exchange is empty (e.g., new demo shell)
        // 2. OR The bot is not running
        if (botInstance.exchange === "" || !botInstance.running) {
          botInstance.exchange = newExchange;
          updatedFields = true;
          criticalConfigChanged = true;
          logger.info(
            `[${operation}] Updated Exchange for BotInstance ${botInstanceId} to '${newExchange}'.`
          );
        } else {
          // Bot is running and exchange is already set and different from new one
          logger.warn(
            `[${operation}] Attempt to change exchange on running BotInstance ${botInstanceId}.`
          );
          return res.status(400).json({
            message: "Please stop the bot before changing the exchange.",
          });
        }
      }
    }

    if (!updatedFields) {
      logger.info(
        `[${operation}] No actual changes detected for BotInstance ${botInstanceId}.`
      );
      return res
        .status(400)
        .json({ message: "No changes provided to update." });
    }

    if (botInstance.running && criticalConfigChanged) {
      logger.warn(
        `[${operation}] Critical config change attempted on running BotInstance ${botInstanceId} while other non-critical fields might have been updated if !updatedFields was false.`
      );
      // This check is a safeguard; individual field logic should ideally prevent this.
      // Re-fetch to ensure no partial save if this happens due to complex conditions.
      // However, if updatedFields is true, it means some field IS being changed.
      return res.status(400).json({
        message:
          "Please stop the bot before updating critical configurations (API keys, Secret, Telegram ID, Exchange).",
      });
    }

    await botInstance.save(); // Triggers pre-save hook for apiSecretKey
    logger.info(
      `[${operation}] Successfully saved updates for BotInstance ${botInstanceId}.`
    );

    const updatedInstance = await BotInstance.findById(botInstanceId);
    res.json({
      message: "Bot instance configuration updated successfully.",
      instance: updatedInstance.toJSON(),
    });
  } catch (error) {
    logger.error(
      `[${operation}] Error updating bot instance ${req.params.botInstanceId} for User ${req.userDB?._id}:`,
      {
        error: error.message,
        stack: error.stack,
        body: req.body,
      }
    );
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    if (error.code === 11000) {
      // Should not happen on update unless unique index is violated somehow unexpectedly
      logger.error(
        `[${operation}] Unexpected E11000 error on update for BotInstance ${req.params.botInstanceId}.`,
        error.keyValue
      );
      return res.status(500).json({
        message: "An unexpected conflict occurred while saving.",
        details: error.keyValue,
      });
    }
    res.status(500).json({
      message: "Failed to update bot instance configuration. Please try again.",
    });
  }
};

// 🔹 Get Bot Instance Configuration Details (for config page)
exports.getBotInstanceConfigDetails = async (req, res) => {
  const operation = "getBotInstanceConfigDetails";
  try {
    const { botInstanceId } = req.params;
    const userId = req.userDB._id;

    logger.info(
      `[${operation}] Fetching details for BotInstance ${botInstanceId}, User ${userId}.`
    );

    const instance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId,
    }).select(
      "apiKey apiSecretKey telegramId exchange active running accountType expiryDate" // Selected fields
    );

    if (!instance) {
      logger.warn(
        `[${operation}] BotInstance ${botInstanceId} not found for User ${userId}.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }

    res.json({
      apiKeySet: !!(instance.apiKey && instance.apiKey.trim() !== ""),
      apiSecretSet: !!(
        instance.apiSecretKey && instance.apiSecretKey.trim() !== ""
      ),
      telegramId: instance.telegramId || "",
      exchange: instance.exchange || "",
      active: instance.active,
      running: instance.running,
      accountType: instance.accountType,
      expiryDate: instance.expiryDate
        ? instance.expiryDate.toISOString()
        : undefined,
    });
  } catch (error) {
    logger.error(
      `[${operation}] Error fetching bot instance config details for BotInstance ${req.params.botInstanceId}, User ${req.userDB?._id}:`,
      { error: error.message, stack: error.stack }
    );
    res.status(500).json({
      message: "Failed to retrieve bot instance configuration details.",
    });
  }
};

// 🔹 Start Bot Instance
exports.startBotInstance = async (req, res) => {
  const operation = "startBotInstance";
  if (!req.userDB || !req.userDB._id) {
    logger.error(`[${operation}] Authentication data missing.`);
    return res.status(401).json({ message: "Authentication data missing." });
  }

  const botInstanceId = req.params.botInstanceId;
  const loggedInUserId = req.userDB._id;

  try {
    logger.info(
      `[${operation}] Attempting findOne for BotInstance. ID: ${botInstanceId}, UserID: ${loggedInUserId}`
    );
    const instance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: loggedInUserId,
    });

    if (!instance) {
      logger.warn(
        `[${operation}] Bot instance ${botInstanceId} not found for User ${loggedInUserId}, or permission denied.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }
    logger.info(
      `[${operation}] Found instance ${instance._id} owned by user. Active: ${instance.active}, Running: ${instance.running}`
    );

    if (!instance.active) {
      logger.warn(
        `[${operation}] Attempt to start inactive instance ${instance._id}`
      );
      return res
        .status(403)
        .json({ message: "Cannot start bot: Instance is inactive." });
    }

    const now = new Date();
    if (instance.expiryDate < now) {
      logger.warn(
        `[${operation}] Attempt to start expired instance ${instance._id}. Expiry: ${instance.expiryDate}`
      );
      // Optionally deactivate the bot here if expired
      // instance.active = false; await instance.save();
      return res.status(403).json({
        message: `Cannot start bot: Subscription/Demo expired on ${instance.expiryDate.toLocaleDateString()}.`,
      });
    }

    // CRITICAL CHECK: Ensure all necessary configurations are set
    if (
      !instance.apiKey ||
      instance.apiKey.trim() === "" ||
      !instance.apiSecretKey || // This is the encrypted secret; its presence means a secret was set.
      instance.apiSecretKey.trim() === "" ||
      !instance.exchange ||
      instance.exchange.trim() === ""
    ) {
      logger.warn(
        `[${operation}] Attempt to start BotInstance ${instance._id} without complete configuration (API Keys/Secret/Exchange).`
      );
      return res.status(400).json({
        message:
          "Cannot start bot: API Key, API Secret, or Exchange is not configured. Please complete the setup.",
      });
    }

    if (instance.running) {
      logger.info(
        `[${operation}] Bot instance ${instance._id} is already reported as running. No action taken.`
      );
      // Depending on how freqtrade service manages state, you might still call startFreqtradeProcess
      // or just return current state. For now, assume it's a no-op if already running.
      return res.json({
        message: "Bot is already running.",
        instance: instance.toJSON(),
      });
    }

    logger.info(
      `[${operation}] All checks passed for instance ${instance._id}. Calling startFreqtradeProcess.`
    );
    const result = await startFreqtradeProcess(botInstanceId.toString());

    logger.info(
      `[${operation}] Start process result for instance ${instance._id}:`,
      result
    );
    res.json({
      message: result.message,
      instance: result.instance ? result.instance.toJSON() : instance.toJSON(),
    });
  } catch (error) {
    const userIdForLog = req.userDB ? req.userDB._id : "UNKNOWN_USER";
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    logger.error(
      `[${operation}] API Error processing start for instance ${botInstanceIdForLog} user ${userIdForLog}:`,
      error
    );

    const errorMessage = error.message || "An unknown error occurred";
    let statusCode = 500;

    if (
      errorMessage.includes("decrypt") ||
      errorMessage.includes("Configuration error") ||
      errorMessage.includes("Failed to prepare configuration") ||
      errorMessage.includes("Failed to start bot process")
    ) {
      statusCode = 500;
      logger.error(
        `[${operation}] Configuration/Process start error for instance ${botInstanceIdForLog}. Error: ${errorMessage}`
      );
    }
    res
      .status(statusCode)
      .json({ message: `Failed to start bot instance: ${errorMessage}` });
  }
};

// 🔹 Stop Bot Instance
exports.stopBotInstance = async (req, res) => {
  const operation = "stopBotInstance";
  if (!req.userDB || !req.userDB._id) {
    logger.error(`[${operation}] Authentication data missing.`);
    return res.status(401).json({ message: "Authentication data missing." });
  }

  const botInstanceId = req.params.botInstanceId;
  const loggedInUserId = req.userDB._id;

  try {
    logger.info(
      `[${operation}] Attempting findOne for BotInstance. ID: ${botInstanceId}, UserID: ${loggedInUserId}`
    );
    const instance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: loggedInUserId,
    });

    if (!instance) {
      logger.warn(
        `[${operation}] Bot instance ${botInstanceId} not found for User ${loggedInUserId}, or permission denied.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }
    logger.info(
      `[${operation}] Found instance ${instance._id} owned by user. Current running state: ${instance.running}`
    );

    if (!instance.running) {
      logger.info(
        `[${operation}] Bot instance ${instance._id} is already reported as stopped. No action taken.`
      );
      // Similar to start, if already stopped, can be a no-op.
      return res.json({
        message: "Bot is already stopped.",
        instance: instance.toJSON(),
      });
    }

    logger.info(
      `[${operation}] Calling stopFreqtradeProcess for instance ${instance._id}.`
    );
    const result = await stopFreqtradeProcess(botInstanceId.toString(), false);

    const updatedInstance = await BotInstance.findById(botInstanceId);
    logger.info(
      `[${operation}] Stop process result for instance ${instance._id}:`,
      result
    );
    res.json({
      message: result.message,
      instance: updatedInstance ? updatedInstance.toJSON() : instance.toJSON(),
    });
  } catch (error) {
    const userIdForLog = req.userDB ? req.userDB._id : "UNKNOWN_USER";
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    logger.error(
      `[${operation}] API Error stopping instance ${botInstanceIdForLog} for user ${userIdForLog}:`,
      error
    );
    res.status(500).json({
      message: `Failed to stop bot instance: ${
        error.message || "Unknown error"
      }`,
    });
  }
};
