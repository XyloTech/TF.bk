// models/Bot.js (ADD the defaultConfig field)
const mongoose = require("mongoose");

const BotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true }, // Added unique, trim
    description: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 }, // Added min: 0
    profitFee: { type: Number, required: true, min: 0, max: 100 },
    features: [{ type: String }],
    active: { type: Boolean, default: true },
    imageUrl: { type: String },
    // --- ADD THIS FIELD ---
    defaultConfig: {
      type: Object,
      default: {
        // --- Sensible Global Defaults ---
        max_open_trades: 3,
        stake_currency: "USDT",
        stake_amount: "unlimited",
        pair_whitelist: ["BTC/USDT", "ETH/USDT"],
        // Add other freqtrade config keys you want *template-level* defaults for
      },
    },
    // --- Default strategy filename (e.g., MyStrategy.py) ---
    defaultStrategy: {
      type: String,
      required: true,
      trim: true, // Added trim
      default: "SampleStrategy.py", // Make sure default has .py if that's the convention
    },
  },
  { timestamps: true }
);

BotSchema.index({ name: 1 });
BotSchema.index({ active: 1 });

module.exports = mongoose.model("Bot", BotSchema);
