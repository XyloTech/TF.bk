// controllers/botInstanceController.js

const BotInstance = require("../models/BotInstance");
const Bot = require("../models/Bot"); // Assuming Bot model is needed for purchaseBot

// 🔹 Purchase Bot
exports.purchaseBot = async (req, res) => {
  try {
    const {
      botId,
      apiKey,
      apiSecretKey,
      telegramId, // User might provide this, or you might fetch from User model later
      strategy,
      exchange,
      config,
      accountType: requestedAccountType,
    } = req.body;

    // Validate required fields for purchase
    if (!botId || !apiKey || !apiSecretKey || !exchange) {
      return res
        .status(400)
        .json({
          message:
            "Missing required fields (botId, apiKey, apiSecretKey, exchange).",
        });
    }

    const bot = await Bot.findById(botId);
    if (!bot)
      return res.status(404).json({ message: "Bot template not found" });

    // Determine the final account type and calculate expiry date accordingly
    const accountType = requestedAccountType === "paid" ? "paid" : "demo";
    const purchaseDate = new Date();
    let expiryDate;

    if (accountType === "paid") {
      // Paid User: Set expiry to 1 month from purchaseDate
      expiryDate = new Date(purchaseDate);
      expiryDate.setMonth(expiryDate.getMonth() + 1);
      console.log(
        `Setting PAID expiry for user ${req.userDB._id} - BotInstance: ${expiryDate}`
      );
    } else {
      // Demo User: Set expiry to 24 hours from purchaseDate
      expiryDate = new Date(purchaseDate.getTime() + 24 * 60 * 60 * 1000); // 24 hours
      console.log(
        `Setting DEMO expiry for user ${req.userDB._id} - BotInstance: ${expiryDate}`
      );
    }

    // Consider adding a check if user already has an active instance for this botId?

    const botInstance = new BotInstance({
      botId,
      userId: req.userDB._id,
      apiKey,
      apiSecretKey, // pre-save hook will hash this
      telegramId: telegramId || req.userDB.telegramId || "", // Use provided ID, fallback to user profile ID, or empty
      strategy: strategy || "DEFAULT_STRATEGY", // Use provided or default
      exchange: exchange, // Should be required, defaulting here is less ideal
      config: config || {}, // Ensure config is an object
      purchaseDate,
      expiryDate,
      accountType,
      active: true, // New instances start active
      running: false, // New instances are not running initially
    });

    await botInstance.save();

    // botInstance.toJSON() will be called automatically, removing sensitive fields
    res.status(201).json(botInstance);
  } catch (error) {
    console.error("Error purchasing bot instance:", error);
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    // Handle potential duplicate key errors if constraints exist (e.g., unique keys per user/exchange)
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
    // Find instances belonging to the logged-in user
    // Populate 'botId' to get details from the referenced 'Bot' model (like bot name, description)
    const bots = await BotInstance.find({ userId: req.userDB._id })
      .populate("botId", "name description imageUrl") // Select specific fields from Bot model
      .sort({ createdAt: -1 }); // Sort by creation date, newest first

    // bots will automatically have sensitive fields removed by toJSON
    res.json(bots);
  } catch (error) {
    console.error("Error fetching user bots:", error);
    res.status(500).json({ message: "Failed to retrieve bot instances." });
  }
};

// 🔹 Update API Keys for a Specific Bot Instance ---- NEW FUNCTION ----
exports.updateBotInstanceKeys = async (req, res) => {
  try {
    const { botInstanceId } = req.params; // Get the ID from the URL parameter
    const { apiKey, apiSecretKey } = req.body; // Get new keys from the request body
    const userId = req.userDB._id; // Get the ID of the authenticated user

    // Basic validation for incoming keys
    if (!apiKey || !apiSecretKey) {
      return res
        .status(400)
        .json({ message: "API Key and Secret Key are required." });
    }
    // Add more validation? (e.g., check key format/length if possible)

    // Find the specific bot instance belonging to the logged-in user
    // Ensure you select the fields needed for update, although here we just need to find it
    const botInstance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId, // IMPORTANT: Ensure the user owns this instance
    });

    if (!botInstance) {
      // Use 404 Not Found if the resource doesn't exist or isn't accessible by the user
      return res
        .status(404)
        .json({
          message:
            "Bot instance not found or you do not have permission to modify it.",
        });
    }

    // Update the keys on the found instance object in memory
    botInstance.apiKey = apiKey;
    botInstance.apiSecretKey = apiSecretKey; // The pre-save hook will hash this when .save() is called

    // Save the updated instance (this triggers the pre-save hook for hashing)
    const updatedInstance = await botInstance.save();

    // Respond with success message. Avoid sending back the instance data here unless necessary.
    // The toJSON transform should apply if you do send it back, but it's often safer not to.
    res.json({ message: "API keys updated successfully for bot instance." });
  } catch (error) {
    console.error("Error updating bot instance keys:", error);
    // Handle potential validation errors from the model during save
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    res.status(500).json({ message: "Failed to update API keys." });
  }
};
