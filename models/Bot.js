const mongoose = require("mongoose");

const BotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    profitFee: { type: Number, required: true },
    features: [{ type: String }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// 🔹 Index for performance
BotSchema.index({ name: 1 });

module.exports = mongoose.model("Bot", BotSchema);
