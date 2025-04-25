const mongoose = require("mongoose"); // Ensure Mongoose is required
const BotInstance = require("../models/BotInstance"); // Ensure BotInstance is required
const BotLog = require("../models/BotLog"); // Your model for logs
const logger = require("../utils/logger"); // Require the logger

// 🔹 Get Logs of a Bot Instance (UPDATED with Ownership Check)
exports.getLogsForBot = async (req, res) => {
  const operation = "getLogsForBot";
  try {
    const { botInstanceId } = req.params;
    // Ensure user is authenticated and req.userDB is populated by middleware
    if (!req.userDB || !req.userDB._id) {
      logger.error({
        operation,
        message: "Authentication missing in getLogsForBot",
      });
      return res.status(401).json({ message: "Authentication required." });
    }
    const userId = req.userDB._id;

    // Validate the incoming ID format
    if (!mongoose.Types.ObjectId.isValid(botInstanceId)) {
      logger.warn({
        operation,
        message: "Invalid botInstanceId format provided",
        botInstanceId,
        userId,
      });
      return res
        .status(400)
        .json({ message: "Invalid Bot Instance ID format." });
    }

    // --- Ownership Check ---
    logger.info({
      operation,
      message: "Checking ownership",
      botInstanceId,
      userId,
    });
    const botInstance = await BotInstance.findById(botInstanceId).select(
      "userId"
    ); // Fetch only the userId for check

    if (!botInstance) {
      // Instance doesn't exist
      logger.warn({
        operation,
        message: "Bot instance not found during ownership check",
        botInstanceId,
        userId,
      });
      // Return 404 to avoid revealing information
      return res.status(404).json({ message: "Bot instance not found." });
    }

    // Compare owner ID with authenticated user ID
    if (!botInstance.userId.equals(userId)) {
      // User does not own this instance
      logger.warn({
        operation,
        message: "Permission denied trying to access bot instance logs",
        botInstanceId,
        userId,
        ownerId: botInstance.userId, // Log the actual owner ID for internal review
      });
      // Return 404 for security (don't confirm existence if not owned)
      return res
        .status(404)
        .json({ message: "Bot instance not found or access denied." });
    }
    logger.info({
      operation,
      message: "Ownership verified",
      botInstanceId,
      userId,
    });
    // --- End Ownership Check ---

    // Ownership verified, proceed to fetch logs using your BotLog model
    // Consider adding pagination here for potentially large log sets
    const { limit = 100, page = 1 } = req.query; // Example pagination query params
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const logs = await BotLog.find({ botInstanceId })
      .sort({ timestamp: -1 }) // Sort by timestamp descending (newest first)
      .skip(skip)
      .limit(parseInt(limit));

    // Optionally get total count for pagination headers/metadata
    // const totalLogs = await BotLog.countDocuments({ botInstanceId });

    logger.info({
      operation,
      message: "Logs fetched successfully",
      botInstanceId,
      userId,
      logCount: logs.length,
      page,
      limit,
    });
    res.json(logs); // Send the fetched logs
  } catch (error) {
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    const userIdForLog = req.userDB?._id || "UNKNOWN_USER";
    logger.error({
      operation,
      message: `Error fetching logs for instance ${botInstanceIdForLog}, user ${userIdForLog}`,
      error: error.message,
      stack: error.stack,
      botInstanceId: botInstanceIdForLog,
      userId: userIdForLog,
    });
    // Use err.message if available, otherwise a generic message
    res.status(500).json({
      message: `Failed to retrieve logs: ${
        error.message || "Internal server error"
      }`,
    });
  }
};
