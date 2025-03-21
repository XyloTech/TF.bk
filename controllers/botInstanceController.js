const BotInstance = require("../models/BotInstance");
const Bot = require("../models/Bot");

// 🔹 Purchase Bot
exports.purchaseBot = async (req, res) => {
  try {
    const { botId } = req.body;
    const bot = await Bot.findById(botId);

    if (!bot) return res.status(404).json({ message: "Bot not found" });

    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1); // 1-month subscription

    const botInstance = new BotInstance({
      botId,
      userId: req.userDB._id,
      apiKey: req.userDB.apiKey,
      apiSecretKey: req.userDB.apiSecretKey,
      telegramId: req.userDB.telegramId,
      purchaseDate: new Date(),
      expiryDate,
    });

    await botInstance.save();
    res.status(201).json(botInstance);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Get User Bots
exports.getUserBots = async (req, res) => {
  try {
    const bots = await BotInstance.find({ userId: req.userDB._id }).populate(
      "botId"
    );
    res.json(bots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
