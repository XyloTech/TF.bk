const mongoose = require("mongoose");
const BotInstance = require("../models/BotInstance");
require("dotenv").config(); // in case env used for DB

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function deactivateExpiredBots() {
  const now = new Date();
  const result = await BotInstance.updateMany(
    { expiryDate: { $lte: now }, active: true },
    { $set: { active: false } }
  );
  console.log(`🧹 Deactivated ${result.modifiedCount} expired bots`);
  process.exit(0);
}

deactivateExpiredBots();
