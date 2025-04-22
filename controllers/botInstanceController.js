// controllers/botInstanceController.js

const BotInstance = require("../models/BotInstance");
const Bot = require("../models/Bot"); // Assuming Bot model is needed for purchaseBot
const {
  startFreqtradeProcess,
  stopFreqtradeProcess,
} = require("../services/freqtradeManager"); // Adjust path if needed
// Note: Decrypt is handled by the manager, not directly needed here usually
const logger = require("../utils/logger");
// 🔹 Purchase Bot
exports.purchaseBot = async (req, res) => {
  try {
    let {
      // Use let to potentially modify config
      botId,
      apiKey,
      apiSecretKey,
      telegramId,
      strategy,
      exchange,
      config,
      accountType: requestedAccountType,
    } = req.body;
    const userId = req.userDB._id; // Get user ID from authenticated user

    // --- START: Repeat Demo Prevention ---
    const accountType = requestedAccountType === "paid" ? "paid" : "demo";

    if (accountType === "demo") {
      const existingDemo = await BotInstance.findOne({
        userId: userId,
        botId: botId, // Check for the same bot template
        accountType: "demo",
      });

      if (existingDemo) {
        return res
          .status(403)
          .json({ message: "You have already used a demo for this bot." });
      }
    }
    // --- END: Repeat Demo Prevention ---

    // Validate required fields
    if (!botId || !apiKey || !apiSecretKey || !exchange) {
      return res.status(400).json({
        message:
          "Missing required fields (botId, apiKey, apiSecretKey, exchange).",
      });
    }

    // Validate Bot Template
    const bot = await Bot.findById(botId);
    if (!bot)
      return res.status(404).json({ message: "Bot template not found" });

    // Normalize and Validate Exchange from Schema Enum
    const validExchanges = BotInstance.schema.path("exchange").enumValues;
    if (
      typeof exchange !== "string" ||
      !validExchanges.includes(exchange.toUpperCase())
    ) {
      return res.status(400).json({
        message: `Invalid exchange. Supported exchanges: ${validExchanges.join(
          ", "
        )}`,
      });
    }
    exchange = exchange.toUpperCase();

    // Ensure config is an object
    config =
      typeof config === "object" && config !== null && !Array.isArray(config)
        ? config
        : {};

    // Calculate expiry date
    const purchaseDate = new Date();
    let expiryDate;
    if (accountType === "paid") {
      expiryDate = new Date(purchaseDate);
      expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month expiry
      console.log(
        `Setting PAID expiry for user ${userId} - BotInstance: ${expiryDate}`
      );
    } else {
      expiryDate = new Date(purchaseDate.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      console.log(
        `Setting DEMO expiry for user ${userId} - BotInstance: ${expiryDate}`
      );
    }

    // Create new BotInstance document
    const botInstance = new BotInstance({
      botId,
      userId,
      apiKey,
      apiSecretKey, // Pass plain text key here, hook encrypts it
      telegramId: telegramId || req.userDB.telegramId || "",
      strategy: strategy || bot.defaultStrategy || "DEFAULT_STRATEGY", // Use bot template's default?
      exchange,
      config,
      purchaseDate,
      expiryDate,
      accountType,
      active: true,
      running: false,
    });

    await botInstance.save();

    res.status(201).json(botInstance); // toJSON removes sensitive fields
  } catch (error) {
    console.error("Error purchasing bot instance:", error);
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "Duplicate entry error.", details: error.keyValue });
    }
    res.status(500).json({ message: "Failed to purchase bot instance." });
  }
};

// 🔹 Get User Bots
exports.getUserBots = async (req, res) => {
  try {
    const userId = req.userDB._id;
    const bots = await BotInstance.find({ userId: userId })
      .populate("botId", "name description imageUrl price") // Populate necessary fields
      .sort({ createdAt: -1 });

    res.json(bots); // toJSON removes sensitive fields
  } catch (error) {
    console.error("Error fetching user bots:", error);
    res.status(500).json({ message: "Failed to retrieve bot instances." });
  }
};

// 🔹 Update API Keys for a Specific Bot Instance
exports.updateBotInstanceKeys = async (req, res) => {
  try {
    const { botInstanceId } = req.params;
    const { apiKey, apiSecretKey } = req.body;
    const userId = req.userDB._id;

    if (!apiKey || !apiSecretKey) {
      return res
        .status(400)
        .json({ message: "API Key and Secret Key are required." });
    }

    const botInstance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId,
    });

    if (!botInstance) {
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }

    if (botInstance.running) {
      return res
        .status(400)
        .json({ message: "Please stop the bot before updating API keys." });
    }

    // Update keys - Pass plain text, pre-save hook will encrypt the secret
    botInstance.apiKey = apiKey;
    botInstance.apiSecretKey = apiSecretKey;

    await botInstance.save(); // Triggers the pre-save hook

    res.json({
      message:
        "API keys updated successfully. You may need to restart the bot.",
    });
  } catch (error) {
    console.error("Error updating bot instance keys:", error);
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    res.status(500).json({ message: "Failed to update API keys." });
  }
};

// --- PM2 Control Functions ---

// 🔹 Start Bot Instance
exports.startBotInstance = async (req, res) => {
  if (!req.userDB || !req.userDB._id) {
    logger.error("CONTROLLER: req.userDB._id is missing in startBotInstance!");
    return res.status(401).json({ message: "Authentication data missing." });
  }

  const botInstanceId = req.params.botInstanceId;
  const loggedInUserId = req.userDB._id; // This is an ObjectId

  try {
    // --- Step 1: Find by ID only ---
    logger.info(
      `CONTROLLER: Attempting to find BotInstance by ID: ${botInstanceId}`
    );
    const instance = await BotInstance.findById(botInstanceId);

    // --- Step 2: Handle Not Found ---
    if (!instance) {
      logger.warn(
        `CONTROLLER: Bot instance not found for ID: ${botInstanceId}`
      );
      return res.status(404).json({ message: "Bot instance not found." });
    }
    logger.info(
      `CONTROLLER: Found instance by ID. Instance UserID: ${
        instance.userId
      } (Type: ${typeof instance.userId}), Active: ${instance.active}`
    );

    // --- Step 3: Verify Ownership ---
    // Use String comparison as it reliably worked in logs
    if (String(instance.userId) !== String(loggedInUserId)) {
      logger.warn(
        `CONTROLLER: Permission denied. Instance Owner: ${instance.userId}, Requester: ${loggedInUserId}`
      );
      return res
        .status(403)
        .json({ message: "Permission denied for this bot instance." });
    }
    logger.info(`CONTROLLER: Ownership verified for instance ${instance._id}.`);

    // --- Step 4: Check if Active --- <<<< ADDED BACK
    if (!instance.active) {
      logger.warn(
        `CONTROLLER: Attempt to start inactive instance ${instance._id}`
      );
      // Use 403 Forbidden status code
      return res
        .status(403)
        .json({ message: "Cannot start bot: Instance is inactive." });
    }
    logger.info(`CONTROLLER: Instance ${instance._id} is active.`);

    // --- Step 5: Check Expiry Date --- <<<< ADDED BACK
    const now = new Date();
    if (instance.expiryDate < now) {
      logger.warn(
        `CONTROLLER: Attempt to start expired instance ${instance._id}. Expiry: ${instance.expiryDate}`
      );
      // Use 403 Forbidden status code
      return res
        .status(403)
        .json({
          message: `Cannot start bot: Subscription/Demo expired on ${instance.expiryDate.toISOString()}`,
        });
    }
    logger.info(`CONTROLLER: Instance ${instance._id} is not expired.`);

    // --- Step 6: Proceed with starting the process ---
    logger.info(
      `CONTROLLER: All checks passed for instance ${instance._id}. Calling startFreqtradeProcess.`
    );
    const result = await startFreqtradeProcess(botInstanceId); // Pass ID

    logger.info(
      `CONTROLLER: Start process result for instance ${instance._id}:`,
      result
    );
    // Send the successful response from the manager
    res.json({ message: result.message, instance: result.instance });
  } catch (error) {
    // Catch errors from findById OR startFreqtradeProcess
    const userIdForLog = req.userDB ? req.userDB._id : "UNKNOWN_USER";
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    // Log the full error for detailed debugging
    logger.error(
      `CONTROLLER: API Error processing start for instance ${botInstanceIdForLog} user ${userIdForLog}:`,
      error
    );

    const errorMessage = error.message || "An unknown error occurred";
    let statusCode = 500; // Default

    // Check specific errors potentially thrown by startFreqtradeProcess
    if (
      errorMessage.includes("decrypt") ||
      errorMessage.includes("Configuration error") ||
      errorMessage.includes("Failed to prepare configuration") ||
      errorMessage.includes("Failed to start bot process")
    ) {
      statusCode = 500; // Keep as internal error
      logger.error(
        `CONTROLLER: Configuration/Process start error for instance ${botInstanceIdForLog}. Error: ${errorMessage}`
      );
    }
    // Note: inactive/expired errors are now handled BEFORE the catch block

    res
      .status(statusCode)
      .json({ message: `Failed to start bot instance: ${errorMessage}` });
  }
};

// 🔹 Stop Bot Instance
exports.stopBotInstance = async (req, res) => {
  try {
    const { botInstanceId } = req.params;
    const userId = req.userDB._id;

    const instance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId,
    });
    if (!instance) {
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }

    // Delegate (markInactive = false for user stop)
    const result = await stopFreqtradeProcess(botInstanceId, false);

    // Fetch the final state after stop
    const updatedInstance = await BotInstance.findById(botInstanceId);
    res.json({ message: result.message, instance: updatedInstance });
  } catch (error) {
    console.error(
      `API Error stopping instance ${req.params.botInstanceId} for user ${req.userDB._id}:`,
      error
    );
    res.status(500).json({
      message: `Failed to stop bot instance: ${
        error.message || "Unknown error"
      }`,
    });
  }
};
