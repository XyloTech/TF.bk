const mongoose = require("mongoose");

const BotInstanceSchema = new mongoose.Schema(
  {
    botId: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    apiKey: { type: String, required: true },
    apiSecretKey: { type: String, required: true },
    telegramId: { type: String, required: true },
    active: { type: Boolean, default: false },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
  },
  { timestamps: true }
);

// 🔹 Foreign key indexes
BotInstanceSchema.index({ botId: 1, userId: 1 });

module.exports = mongoose.model("BotInstance", BotInstanceSchema);
