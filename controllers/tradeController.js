const mongoose = require("mongoose"); // Ensure Mongoose is required
const Trade = require("../models/Trade");
const BotInstance = require("../models/BotInstance"); // Ensure BotInstance is required
const User = require("../models/User"); // Import User model
const Bot = require("../models/Bot"); // Import Bot model
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
    page = page > 0 ? page : 1;
    limit = limit > 0 && limit <= 100 ? limit : 20;
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

    // --- Database Queries (Parallel) ---
    // Fetch trades including necessary details for percentage calculation
    const [tradesFromDB, totalTrades] = await Promise.all([
      Trade.find({ botInstanceId })
        // Explicitly select fields within tradeDetails if needed, though .lean() usually gets all
        // .select('+tradeDetails.entryPrice +tradeDetails.exitPrice +tradeDetails.side')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // Keep using .lean() for performance
      Trade.countDocuments({ botInstanceId }),
    ]);
    // --- End Database Queries ---

    // --- Process Trades: Calculate Percentage and Format ---
    const trades = tradesFromDB.map((trade) => {
      let profitPercentage = 0; // Default to 0
      const details = trade.tradeDetails || {}; // Handle cases where tradeDetails might be missing

      const grossProfit = trade.grossProfit ?? 0;
      const platformFee = trade.platformFee ?? 0;
      const netProfit = trade.netProfit ?? 0;

      // *** START DEBUG LOGGING ***
      if (trade._id.toString() === "680cda20f8a7f092fa6ece16") {
        console.log("--- DEBUGGING TRADE 680cda... ---");
        console.log("Raw tradeDetails:", trade.tradeDetails);
        console.log("Raw Status:", trade.status);
        console.log("Extracted details.entryPrice:", details.entryPrice);
        console.log("Extracted details.exitPrice:", details.exitPrice);
        console.log("Extracted details.side:", details.side);
        console.log("Extracted details.type:", details.type);
        const sideForCalc =
          details.side?.toLowerCase() || details.type?.toLowerCase();
        console.log("Calculated side variable:", sideForCalc);
        console.log("----------------------------------");
      }
      // *** END DEBUG LOGGING ***
      // Calculate only for closed trades with valid entry price
      if (
        trade.status === "closed" &&
        details.entryPrice &&
        details.entryPrice !== 0
      ) {
        const entry = details.entryPrice;
        // Use exitPrice if available, otherwise estimate based on profit (less accurate)
        const exit =
          details.exitPrice ?? entry + trade.profit / (details.amount || 1);

        // Determine side consistently (check 'side' first, then maybe 'type')
        const side = details.side?.toLowerCase() || details.type?.toLowerCase();

        if (side === "long" || side === "buy") {
          profitPercentage = ((exit - entry) / entry) * 100;
        } else if (side === "short" || side === "sell") {
          profitPercentage = ((entry - exit) / entry) * 100;
        }
        // *** Log intermediate percentage ***
        if (trade._id.toString() === "680cda20f8a7f092fa6ece16") {
          console.log("Intermediate calculated %:", profitPercentage);
        }
      }

      // Map to the final desired structure for the frontend
      return {
        id: trade._id.toString(), // Mongo ID as string
        pair: details.pair || "N/A", // Pair name
        type:
          details.side?.toLowerCase() === "long" ||
          details.side?.toLowerCase() === "buy"
            ? "BUY"
            : "SELL", // Standardize to BUY/SELL
        entryPrice: details.entryPrice ?? 0, // Entry price
        exitPrice: details.exitPrice ?? 0, // Exit price (0 if open/missing)
        grossProfit: grossProfit,
        platformFee: platformFee,
        netProfit: netProfit,
        profit: netProfit, // For backward compatibility, still provide 'profit' as net profit
        profitPercentage: parseFloat(profitPercentage.toFixed(2)), // Calculated percentage (2 decimal places)
        status: trade.status, // Added status back in case UI needs it
        timestamp: trade.createdAt.getTime(), // Creation time as epoch milliseconds
      };
    });
    // --- End Process Trades ---

    const totalPages = Math.ceil(totalTrades / limit);

    logger.info({
      operation,
      message: "Trades fetched and processed successfully with pagination",
      botInstanceId,
      userId,
      tradeCount: trades.length,
      totalTrades,
      currentPage: page,
      totalPages,
    });

    // --- Send Response ---
    res.json({
      trades, // The array of processed trades
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
    // Calculate gross profit (profit before platform fees)
    const grossProfit = profit;
    let platformFee = 0;
    let netProfit = profit;

    // Only apply platform fee if there's a profit
    if (grossProfit > 0) {
      // Fetch bot details to get the profitFee percentage
      const bot = await Bot.findById(botInstance.botId).select("profitFee");
      const profitFeePercentage = bot?.profitFee || 0.20; // Default to 20% if not set

      platformFee = grossProfit * profitFeePercentage;
      netProfit = grossProfit - platformFee;

      // Deduct fee from user's wallet balance
      const user = await User.findById(userId);
      if (user) {
        user.accountBalance -= platformFee;
        // Pause bot if account balance falls below a threshold (e.g., 0 or a configurable minimum)
        // This threshold can be defined in config or as a bot setting
        const FEE_WALLET_THRESHOLD = 0; // Example threshold
        if (user.accountBalance < FEE_WALLET_THRESHOLD) {
          botInstance.status = "PAUSED";
          botInstance.isActive = false; // Assuming isActive also controls bot operation
          logger.warn({
            operation,
            message: `User ${userId} account balance (${user.accountBalance}) below threshold. Pausing bot instance ${botInstanceId}.`,
            userId,
            botInstanceId,
          });
        }
        await user.save();
      } else {
        logger.error({
          operation,
          message: `User ${userId} not found when deducting fees for bot instance ${botInstanceId}.`,
          userId,
          botInstanceId,
        });
      }
    }

    const trade = new Trade({
      botInstanceId,
      tradeDetails,
      grossProfit: grossProfit,
      platformFee: platformFee,
      netProfit: netProfit,
      profit: netProfit, // Keep 'profit' field for backward compatibility, but it now stores net profit
      status: status || "open",
    });

    await trade.save();
    // Save updated bot instance status if it was paused
    if (botInstance.isModified('status') || botInstance.isModified('isActive')) {
      await botInstance.save();
    }

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
