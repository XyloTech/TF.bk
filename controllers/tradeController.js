const mongoose = require("mongoose"); // Ensure Mongoose is required
const Trade = require("../models/Trade");
const BotInstance = require("../models/BotInstance"); // Ensure BotInstance is required
const logger = require("../utils/logger"); // Require the logger
// const { sendNotification } = require("../socket"); // Uncomment if using sockets

// 🔹 Get Trades of a Bot Instance (UPDATED with Ownership Check)
exports.getTrades = async (req, res) => {
  const operation = "getTrades";
  try {
    const { botInstanceId } = req.params;
    const userId = req.userDB?._id;

    // --- Basic Auth and Input Validation ---
    if (!userId) {
      logger.error({ operation, message: "Authentication missing" });
      return res.status(401).json({ message: "Authentication required." });
    }
    if (!mongoose.Types.ObjectId.isValid(botInstanceId)) {
      logger.warn({
        operation,
        message: "Invalid botInstanceId format",
        botInstanceId,
        userId,
      });
      return res
        .status(400)
        .json({ message: "Invalid Bot Instance ID format." });
    }

    // --- Ownership Check ---
    const botInstance = await BotInstance.findById(botInstanceId).select(
      "userId"
    );
    if (!botInstance) {
      logger.warn({
        operation,
        message: "Bot instance not found",
        botInstanceId,
        userId,
      });
      return res.status(404).json({ message: "Bot instance not found." });
    }
    if (!botInstance.userId.equals(userId)) {
      logger.warn({
        operation,
        message: "Permission denied",
        botInstanceId,
        userId,
        ownerId: botInstance.userId,
      });
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

    // --- Pagination Logic ---
    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    // Validate and set defaults for pagination
    page = page > 0 ? page : 1; // Default to page 1 if invalid
    limit = limit > 0 && limit <= 100 ? limit : 20; // Default to 20, max 100 per page

    const skip = (page - 1) * limit;
    logger.info({
      operation,
      message: "Pagination details",
      botInstanceId,
      userId,
      page,
      limit,
      skip,
    });
    // --- End Pagination Logic ---

    // --- Database Queries (Parallel for efficiency) ---
    const [trades, totalTrades] = await Promise.all([
      // Query for the paginated trades
      Trade.find({ botInstanceId })
        .sort({ createdAt: -1 }) // Sort by newest first
        .skip(skip)
        .limit(limit)
        .lean(), // Use .lean() for potentially better performance on read-only data
      // Query for the total count of trades matching the filter
      Trade.countDocuments({ botInstanceId }),
    ]);
    // --- End Database Queries ---

    const totalPages = Math.ceil(totalTrades / limit);

    logger.info({
      operation,
      message: "Trades fetched successfully with pagination",
      botInstanceId,
      userId,
      tradeCount: trades.length,
      totalTrades,
      currentPage: page,
      totalPages,
    });

    // --- Send Response with Pagination Metadata ---
    res.json({
      trades, // The array of trades for the current page
      pagination: {
        currentPage: page,
        limit: limit,
        totalTrades: totalTrades,
        totalPages: totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
    // --- End Send Response ---
  } catch (error) {
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    const userIdForLog = req.userDB?._id || "UNKNOWN_USER";
    logger.error({
      operation,
      message: `Error fetching trades for instance ${botInstanceIdForLog}`,
      error: error.message,
      stack: error.stack,
      botInstanceId: botInstanceIdForLog,
      userId: userIdForLog,
    });
    res.status(500).json({ message: "Failed to retrieve trades." });
  }
};

// 🔹 Create Trade (For automation - Assuming ownership check was already present)
exports.createTrade = async (req, res) => {
  const operation = "createTrade";
  try {
    const { botInstanceId, tradeDetails, profit, status } = req.body;
    // Ensure user is authenticated and req.userDB is populated by middleware
    if (!req.userDB || !req.userDB._id) {
      logger.error({
        operation,
        message: "Authentication missing in createTrade",
      });
      return res.status(401).json({ message: "Authentication required." });
    }
    const userId = req.userDB._id;

    // Validate the incoming ID format
    if (!mongoose.Types.ObjectId.isValid(botInstanceId)) {
      logger.warn({
        operation,
        message: "Invalid botInstanceId format provided for create",
        botInstanceId,
        userId,
      });
      return res
        .status(400)
        .json({ message: "Invalid Bot Instance ID format." });
    }

    // Ensure bot instance belongs to user (This check was likely correct already)
    logger.info({
      operation,
      message: "Checking ownership for createTrade",
      botInstanceId,
      userId,
    });
    const botInstance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: userId, // Check ownership directly
    }).select("_id"); // Only need to confirm existence and ownership

    if (!botInstance) {
      logger.warn({
        operation,
        message: "Bot instance not found or permission denied for createTrade",
        botInstanceId,
        userId,
      });
      return res
        .status(403) // Use 403 Forbidden as it's an unauthorized action attempt
        .json({
          message: "Unauthorized to create trade for this bot instance.",
        });
    }
    logger.info({
      operation,
      message: "Ownership verified for createTrade",
      botInstanceId,
      userId,
    });

    // Proceed with trade creation
    const trade = new Trade({
      botInstanceId,
      tradeDetails,
      profit,
      status: status || "open",
    });

    await trade.save();

    // 🔹 Send WebSocket notification (Uncomment and ensure sendNotification works if needed)
    // if (typeof sendNotification === 'function') {
    //     sendNotification(
    //         userId.toString(), // Ensure userId is string if required
    //         "trade_update",
    //         `New trade created for bot instance ${botInstanceId}`
    //     );
    // } else {
    //     logger.warn({ operation, message: "sendNotification function not available/configured", userId });
    // }

    logger.info({
      operation,
      message: "Trade created successfully",
      botInstanceId,
      userId,
      tradeId: trade._id,
    });
    res.status(201).json(trade);
  } catch (error) {
    const botInstanceIdForLog = req.body.botInstanceId || "UNKNOWN_INSTANCE";
    const userIdForLog = req.userDB?._id || "UNKNOWN_USER";
    logger.error({
      operation,
      message: `Error creating trade for instance ${botInstanceIdForLog}, user ${userIdForLog}`,
      error: error.message,
      stack: error.stack,
      botInstanceId: botInstanceIdForLog,
      userId: userIdForLog,
      // Avoid logging full req.body in production if it contains sensitive details
      // requestBody: process.env.NODE_ENV !== 'production' ? req.body : { details: 'omitted' }
      requestBody: { details: "omitted" }, // Safer default
    });
    res.status(500).json({ message: "Failed to create trade." });
  }
};
