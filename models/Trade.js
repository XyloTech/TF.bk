const mongoose = require("mongoose");

const TradeSchema = new mongoose.Schema(
  {
    botInstanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BotInstance",
      required: true,
    },
    tradeDetails: { type: Object, required: true },
    profit: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["open", "closed", "cancelled"],
      default: "open",
    },
  },
  { timestamps: true }
);

// 🔹 Index for performance
TradeSchema.index({ botInstanceId: 1 });

module.exports = mongoose.model("Trade", TradeSchema);
