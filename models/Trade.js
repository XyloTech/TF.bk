const mongoose = require("mongoose");

const TradeSchema = new mongoose.Schema(
  {
    botInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotInstance",
      required: true,
    },
    tradeDetails: { type: Object, required: true },
    grossProfit: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    netProfit: { type: Number, default: 0 },
    profit: { type: Number, default: 0 }, // For backward compatibility, will store netProfit
    status: {
      type: String,
      enum: ["open", "closed", "cancelled"],
      default: "open",
    },
  },
  { timestamps: true }
);

// 🔹 Index for performance
TradeSchema.index({ botInstanceId: 1, createdAt: -1 });

module.exports = mongoose.model("Trade", TradeSchema);
