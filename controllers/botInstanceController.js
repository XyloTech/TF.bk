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
  const loggedInUserId = req.userDB._id; // This should be an ObjectId

  try {
    // --- Step 1: Find instance by ID and verify ownership in one query ---
    logger.info(
      `CONTROLLER: Attempting findOne for BotInstance. ID: ${botInstanceId}, UserID: ${loggedInUserId}`
    );
    const instance = await BotInstance.findOne({
      _id: botInstanceId, // Mongoose handles casting string ID to ObjectId
      userId: loggedInUserId, // Compare ObjectId from user with ObjectId in DB
    });

    // --- Step 2: Handle Not Found or Permission Denied ---
    if (!instance) {
      // This now covers both cases: instance doesn't exist OR it exists but doesn't belong to this user
      logger.warn(
        `CONTROLLER: Bot instance not found for ID: ${botInstanceId} and UserID: ${loggedInUserId}, or permission denied.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }
    logger.info(
      `CONTROLLER: Found instance owned by user. Instance ID: ${instance._id}, Active: ${instance.active}`
    );

    // --- Step 3: Check if Active ---
    if (!instance.active) {
      logger.warn(
        `CONTROLLER: Attempt to start inactive instance ${instance._id}`
      );
      return res
        .status(403)
        .json({ message: "Cannot start bot: Instance is inactive." });
    }
    logger.info(`CONTROLLER: Instance ${instance._id} is active.`);

    // --- Step 4: Check Expiry Date ---
    const now = new Date();
    if (instance.expiryDate < now) {
      logger.warn(
        `CONTROLLER: Attempt to start expired instance ${instance._id}. Expiry: ${instance.expiryDate}`
      );
      return res.status(403).json({
        message: `Cannot start bot: Subscription/Demo expired on ${instance.expiryDate.toISOString()}`,
      });
    }
    logger.info(`CONTROLLER: Instance ${instance._id} is not expired.`);

    // --- Step 5: Proceed with starting the process ---
    logger.info(
      `CONTROLLER: All checks passed for instance ${instance._id}. Calling startFreqtradeProcess.`
    );
    const result = await startFreqtradeProcess(botInstanceId); // Pass ID

    logger.info(
      `CONTROLLER: Start process result for instance ${instance._id}:`,
      result
    );
    // Send the successful response from the manager
    // Ensure result.instance exists before sending
    res.json({
      message: result.message,
      instance: result.instance || instance,
    });
  } catch (error) {
    // Catch errors from findOne OR startFreqtradeProcess
    const userIdForLog = req.userDB ? req.userDB._id : "UNKNOWN_USER";
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
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
  if (!req.userDB || !req.userDB._id) {
    logger.error("CONTROLLER: req.userDB._id is missing in stopBotInstance!");
    return res.status(401).json({ message: "Authentication data missing." });
  }

  const botInstanceId = req.params.botInstanceId;
  const loggedInUserId = req.userDB._id; // This should be an ObjectId

  try {
    // --- Step 1: Find instance by ID and verify ownership in one query ---
    logger.info(
      `CONTROLLER (STOP): Attempting findOne for BotInstance. ID: ${botInstanceId}, UserID: ${loggedInUserId}`
    );
    const instance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: loggedInUserId,
    });

    // --- Step 2: Handle Not Found or Permission Denied ---
    if (!instance) {
      logger.warn(
        `CONTROLLER (STOP): Bot instance not found for ID: ${botInstanceId} and UserID: ${loggedInUserId}, or permission denied.`
      );
      return res
        .status(404)
        .json({ message: "Bot instance not found or permission denied." });
    }
    logger.info(
      `CONTROLLER (STOP): Found instance owned by user. Instance ID: ${instance._id}.`
    );

    // --- Step 3: Proceed with stopping the process ---
    logger.info(
      `CONTROLLER (STOP): Calling stopFreqtradeProcess for instance ${instance._id}.`
    );
    // Delegate (markInactive = false for user stop)
    const result = await stopFreqtradeProcess(botInstanceId, false);

    // Fetch the final state after stop for accurate response
    const updatedInstance = await BotInstance.findById(botInstanceId);
    logger.info(
      `CONTROLLER (STOP): Stop process result for instance ${instance._id}:`,
      result
    );
    res.json({
      message: result.message,
      instance: updatedInstance || instance,
    }); // Return updated if possible
  } catch (error) {
    const userIdForLog = req.userDB ? req.userDB._id : "UNKNOWN_USER";
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    logger.error(
      `CONTROLLER (STOP): API Error stopping instance ${botInstanceIdForLog} for user ${userIdForLog}:`,
      error
    );
    res.status(500).json({
      message: `Failed to stop bot instance: ${
        error.message || "Unknown error"
      }`,
    });
  }
};
