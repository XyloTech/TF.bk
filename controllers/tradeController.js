const Trade = require("../models/Trade");
const BotInstance = require("../models/BotInstance");
const { sendNotification } = require("../socket");
// 🔹 Get Trades of a Bot Instance
exports.getTrades = async (req, res) => {
  try {
    const { botInstanceId } = req.params;

    const trades = await Trade.find({ botInstanceId }).sort({ createdAt: -1 });
    res.json(trades);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Create Trade (For automation)
exports.createTrade = async (req, res) => {
  try {
    const { botInstanceId, tradeDetails, profit, status } = req.body;

    // Ensure bot instance belongs to user
    const botInstance = await BotInstance.findOne({
      _id: botInstanceId,
      userId: req.userDB._id,
    });
    if (!botInstance)
      return res
        .status(403)
        .json({ message: "Unauthorized to trade with this bot" });

    const trade = new Trade({
      botInstanceId,
      tradeDetails,
      profit,
      status: status || "open",
    });

    await trade.save();

    // 🔹 Send WebSocket notification
    sendNotification(
      req.userDB._id,
      "trade_update",
      "New trade executed successfully!"
    );
    res.status(201).json(trade);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
