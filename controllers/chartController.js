// controllers/chartController.js
const mongoose = require("mongoose");
const Trade = require("../models/Trade"); // Assuming Trade model has 'profit' and 'createdAt'
const BotInstance = require("../models/BotInstance");
const logger = require("../utils/logger");

/**
 * Aggregates trade data for performance charting.
 * Query Params:
 *  - granularity: 'daily' (default), 'hourly', 'monthly'
 *  - period: '7d', '30d' (default), '90d', 'all'
 *  - status: 'closed' (default), 'all' // Usually only closed trades contribute to profit charts
 */
exports.getPerformanceChartData = async (req, res) => {
  const operation = "getPerformanceChartData";
  try {
    const { botInstanceId } = req.params;
    const userId = req.userDB?._id; // Assumes authenticateUser middleware ran

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

    // --- Ownership Check (Essential!) ---
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

    // --- Parse Query Params ---
    const {
      granularity = "daily", // daily, hourly, monthly
      period = "30d", // 7d, 30d, 90d, all
      status = "closed", // closed, all
    } = req.query;

    // --- Build Aggregation Pipeline ---
    const pipeline = [];

    // 1. $match stage: Filter by botInstanceId, status, and time period
    const matchStage = {
      botInstanceId: new mongoose.Types.ObjectId(botInstanceId),
    };
    if (status === "closed") {
      matchStage.status = "closed"; // Filter only closed trades if requested
    }

    let startDate;
    const now = new Date();
    switch (period) {
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "all":
        startDate = null; // No start date filter for 'all'
        break;
      case "30d":
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    if (startDate) {
      matchStage.createdAt = { $gte: startDate }; // Assuming 'createdAt' field exists on Trade
    }

    pipeline.push({ $match: matchStage });

    // 2. $project stage: Extract necessary fields and maybe format date early
    // Project profit and the date field used for grouping
    pipeline.push({
      $project: {
        _id: 0, // Exclude the original _id
        profit: 1, // Include profit field
        timestamp: "$createdAt", // Rename createdAt to timestamp for clarity
      },
    });

    // 3. $group stage: Group by granularity and sum profit
    let groupFormat;
    let groupId;

    switch (granularity) {
      case "hourly":
        groupId = {
          year: { $year: "$timestamp" },
          month: { $month: "$timestamp" },
          day: { $dayOfMonth: "$timestamp" },
          hour: { $hour: "$timestamp" },
        };
        groupFormat = "%Y-%m-%dT%H:00:00.000Z"; // UTC Hour format
        break;
      case "monthly":
        groupId = {
          year: { $year: "$timestamp" },
          month: { $month: "$timestamp" },
        };
        groupFormat = "%Y-%m-01T00:00:00.000Z"; // UTC Month start format
        break;
      case "daily":
      default:
        groupId = {
          year: { $year: "$timestamp" },
          month: { $month: "$timestamp" },
          day: { $dayOfMonth: "$timestamp" },
        };
        groupFormat = "%Y-%m-%dT00:00:00.000Z"; // UTC Day start format
        break;
    }

    pipeline.push({
      $group: {
        _id: groupId,
        totalProfit: { $sum: "$profit" }, // Sum profit for the period
        // You could also calculate cumulative profit here if needed (more complex)
        // Or get the timestamp of the first trade in the group for accurate x-axis point
        timestamp: { $min: "$timestamp" }, // Get the earliest timestamp in the group
      },
    });

    // 4. $sort stage: Sort by the grouped date/time
    pipeline.push({
      $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.hour": 1 }, // Sort chronologically
    });

    // 5. $project stage (final): Format the output
    pipeline.push({
      $project: {
        _id: 0, // Exclude the group _id object
        // Format the timestamp from the group's min timestamp
        timestamp: {
          $dateToString: {
            format: groupFormat,
            date: "$timestamp",
            timezone: "UTC",
          },
        },
        value: "$totalProfit", // Rename totalProfit to a generic 'value' for charts
      },
    });

    // --- Execute Aggregation ---
    logger.info({
      operation,
      message: `Executing aggregation pipeline for ${botInstanceId}`,
      granularity,
      period,
      status,
      userId,
    });
    const chartData = await Trade.aggregate(pipeline);
    logger.info({
      operation,
      message: `Aggregation successful for ${botInstanceId}`,
      dataPoints: chartData.length,
      userId,
    });

    res.json(chartData);
  } catch (error) {
    const botInstanceIdForLog = req.params.botInstanceId || "UNKNOWN_INSTANCE";
    const userIdForLog = req.userDB?._id || "UNKNOWN_USER";
    logger.error({
      operation,
      message: `Error generating chart data for instance ${botInstanceIdForLog}`,
      error: error.message,
      stack: error.stack,
      botInstanceId: botInstanceIdForLog,
      userId: userIdForLog,
      query: req.query,
    });
    res.status(500).json({ message: "Failed to generate chart data." });
  }
};
