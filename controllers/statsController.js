const mongoose = require("mongoose");
const Trade = require("../models/Trade");
const BotInstance = require("../models/BotInstance");
const logger = require("../utils/logger"); // Assuming logger exists

// Helper function to get UTC date boundaries
const getUTCDateBoundaries = () => {
  const now = new Date();
  const startOfTodayUTC = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const startOfMonthUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const startOfLastMonthUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0)
  );
  return { now, startOfTodayUTC, startOfMonthUTC, startOfLastMonthUTC };
};

/**
 * GET /api/stats/trading
 * Calculates and returns trading statistics for the logged-in user.
 */
exports.getTradingStats = async (req, res) => {
  const operation = "getTradingStats";
  const userId = req.userDB?._id;

  if (!userId) {
    // Should be caught by authMiddleware, but good practice
    return res.status(401).json({ message: "Unauthorized: User not found." });
  }

  logger.info({ operation, userId, message: "Fetching trading stats..." });

  try {
    // 1. Find all BotInstance IDs for the current user
    const userBotInstances = await BotInstance.find({ userId })
      .select("_id")
      .lean();
    const botInstanceIds = userBotInstances.map((instance) => instance._id);

    if (botInstanceIds.length === 0) {
      logger.info({
        operation,
        userId,
        message: "User has no bot instances. Returning default stats.",
      });
      // Return default zeroed stats if user has no bots
      return res.json({
        totalProfit: 0,
        todayProfit: 0,
        winRate: 0,
        tradesCount: 0,
        activePositions: 0,
        monthlyProfitChangePercent: 0,
      });
    }

    // 2. Define Date Boundaries (UTC)
    const { startOfTodayUTC, startOfMonthUTC, startOfLastMonthUTC } =
      getUTCDateBoundaries();

    // 3. Perform Aggregation on Trades
    const statsAggregation = await Trade.aggregate([
      // Stage 1: Match trades belonging to the user's bot instances
      { $match: { botInstanceId: { $in: botInstanceIds } } },

      // Stage 2: Use $facet to calculate multiple aggregates in parallel
      {
        $facet: {
          // --- Calculations for CLOSED trades ---
          overallClosed: [
            { $match: { status: "closed" } },
            {
              $group: {
                _id: null,
                totalProfit: { $sum: "$profit" },
                totalTradesCount: { $sum: 1 },
                winningTrades: {
                  $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] },
                },
              },
            },
          ],
          todayClosed: [
            // Using createdAt of closed trades for daily calculation
            {
              $match: {
                status: "closed",
                createdAt: { $gte: startOfTodayUTC },
              },
            },
            {
              $group: {
                _id: null,
                todayProfit: { $sum: "$profit" },
              },
            },
          ],
          currentMonthClosed: [
            // Using createdAt of closed trades
            {
              $match: {
                status: "closed",
                createdAt: { $gte: startOfMonthUTC },
              },
            },
            {
              $group: {
                _id: null,
                currentMonthProfit: { $sum: "$profit" },
              },
            },
          ],
          lastMonthClosed: [
            // Using createdAt of closed trades
            {
              $match: {
                status: "closed",
                createdAt: { $gte: startOfLastMonthUTC, $lt: startOfMonthUTC },
              },
            },
            {
              $group: {
                _id: null,
                lastMonthProfit: { $sum: "$profit" },
              },
            },
          ],
          // --- Calculation for OPEN trades ---
          activePositions: [
            { $match: { status: "open" } },
            { $count: "count" },
          ],
        },
      },

      // Stage 3: Project results from $facet arrays (handle empty arrays with $ifNull)
      {
        $project: {
          totalProfit: {
            $ifNull: [{ $first: "$overallClosed.totalProfit" }, 0],
          },
          totalTradesCount: {
            $ifNull: [{ $first: "$overallClosed.totalTradesCount" }, 0],
          },
          winningTrades: {
            $ifNull: [{ $first: "$overallClosed.winningTrades" }, 0],
          },
          todayProfit: { $ifNull: [{ $first: "$todayClosed.todayProfit" }, 0] },
          activePositions: {
            $ifNull: [{ $first: "$activePositions.count" }, 0],
          },
          currentMonthProfit: {
            $ifNull: [{ $first: "$currentMonthClosed.currentMonthProfit" }, 0],
          },
          lastMonthProfit: {
            $ifNull: [{ $first: "$lastMonthClosed.lastMonthProfit" }, 0],
          },
        },
      },
    ]);

    // 4. Extract results and calculate derived metrics
    const result = statsAggregation[0] || {}; // Get the first (and only) result or default object

    const {
      totalProfit = 0,
      totalTradesCount = 0,
      winningTrades = 0,
      todayProfit = 0,
      activePositions = 0,
      currentMonthProfit = 0,
      lastMonthProfit = 0,
    } = result;

    // Calculate Win Rate (%)
    const winRate =
      totalTradesCount > 0 ? (winningTrades / totalTradesCount) * 100 : 0;

    // Calculate Monthly Profit Change (%) - Handle division by zero and zero cases
    let monthlyProfitChangePercent = 0;
    if (lastMonthProfit !== 0) {
      // Calculate percentage change relative to the absolute value of last month's profit
      monthlyProfitChangePercent =
        ((currentMonthProfit - lastMonthProfit) / Math.abs(lastMonthProfit)) *
        100;
    } else if (currentMonthProfit > 0) {
      // If last month was 0 and current is positive, it's an infinite increase
      // Represent as null, Infinity, or a large number depending on frontend needs
      monthlyProfitChangePercent = null; // Or Infinity, or 10000 etc. Null is often clearer.
    } // If both are 0 or current is negative/zero when last was 0, change is 0%

    const finalStats = {
      totalProfit,
      todayProfit,
      winRate, // Send as percentage value
      tradesCount: totalTradesCount, // Send the count of *closed* trades
      activePositions,
      monthlyProfitChangePercent, // Can be null
    };

    logger.info({
      operation,
      userId,
      message: "Successfully fetched trading stats.",
      stats: finalStats,
    });
    res.json(finalStats);
  } catch (error) {
    logger.error({
      operation,
      userId,
      message: `Error fetching trading stats: ${error.message}`,
      error,
      stack: error.stack,
    });
    res.status(500).json({ message: "Failed to retrieve trading statistics." });
  }
};
