const logger = require("../utils/logger");
const { startFreqtradeBacktest } = require("../services/freqtradeManager");

exports.startBacktest = async (req, res) => {
  const operation = "startBacktest";
  const userId = req.userDB?._id;

  if (!userId) {
    logger.error({ operation, message: "Authentication missing" });
    return res.status(401).json({ message: "Authentication required." });
  }

  try {
    const { strategy, timeframe, startDate, endDate, botInstanceId } = req.body;

    if (!strategy || !timeframe || !startDate || !endDate || !botInstanceId) {
      logger.warn({
        operation,
        message: "Missing required backtest parameters",
        userId,
        body: req.body,
      });
      return res.status(400).json({ message: "Missing required backtest parameters." });
    }

    logger.info({
      operation,
      message: "Starting Freqtrade backtest",
      userId,
      strategy,
      timeframe,
      startDate,
      endDate,
      botInstanceId,
    });

    const result = await startFreqtradeBacktest(
      userId,
      botInstanceId,
      strategy,
      timeframe,
      startDate,
      endDate
    );

    if (result.success) {
      logger.info({
        operation,
        message: "Freqtrade backtest initiated successfully",
        userId,
        result: result.message,
      });
      res.status(200).json({ message: result.message, backtestId: result.backtestId });
    } else {
      logger.error({
        operation,
        message: "Failed to initiate Freqtrade backtest",
        userId,
        error: result.message,
      });
      res.status(500).json({ message: result.message });
    }
  } catch (error) {
    logger.error({
      operation,
      message: "Error in startBacktest controller",
      userId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: "Internal server error during backtest initiation." });
  }
};