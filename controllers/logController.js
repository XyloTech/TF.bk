const BotLog = require("../models/BotLog");

exports.getLogsForBot = async (req, res) => {
  try {
    const { botInstanceId } = req.params;
    const logs = await BotLog.find({ botInstanceId }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
