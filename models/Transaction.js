const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: { type: Number, required: true },
    transactionType: {
      type: String,
      enum: ["recharge", "withdrawal", "trade_fee", "referral_bonus"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      enum: ["crypto", "bank_transfer", "card", "wallet"],
      required: true,
    },
    referenceId: { type: String, unique: true, required: true },
    metadata: { type: Object, default: {} },
  },
  { timestamps: true }
);

// 🔹 Index for user transactions
TransactionSchema.index({ userId: 1, referenceId: 1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
