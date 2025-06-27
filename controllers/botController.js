const Bot = require("../models/Bot");

// 🔹 Get All Bots
exports.getBots = async (req, res) => {
  try {
    const bots = await Bot.find();
    res.json(bots);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Create Bot (Admin Only - To be Secured Later)
// 🔹 Get Bot by ID
exports.getBotById = async (req, res) => {
  try {
    const bot = await Bot.findById(req.params.id);
    if (!bot) {
      return res.status(404).json({ message: "Bot not found" });
    }
    res.json(bot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createBot = async (req, res) => {
  try {
    const { name, description, price, profitFee, features } = req.body;
    const bot = new Bot({ name, description, price, profitFee, features });
    await bot.save();
    res.status(201).json(bot);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
