// const mongoose = require("mongoose");

// const TransactionSchema = new mongoose.Schema(
//   {
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     amount: { type: Number, required: true },
//     transactionType: {
//       type: String,
//       enum: [
//         "bot_purchase", // For when a user buys a bot subscription
//         "balance_recharge",
//         "withdrawal",
//         "trade_fee",
//         "referral_bonus",
//         "system_credit",
//         "refund",
//       ],
//       required: true,
//     },
//     status: {
//       type: String,
//       enum: ["pending", "approved", "rejected"],
//       default: "pending",
//     },
//     paymentMethod: {
//       type: String,
//       enum: ["crypto", "bank_transfer", "card", "wallet"],
//       required: true,
//     },
//     referenceId: { type: String, unique: true, required: true },
//     metadata: { type: Object, default: {} },
//   },
//   { timestamps: true }
// );

// // 🔹 Index for user transactions
// TransactionSchema.index({ userId: 1, referenceId: 1 });

// module.exports = mongoose.model("Transaction", TransactionSchema);

const mongoose = require("mongoose");

const TransactionSchema = new mongoose.Schema(
  {
    // User making the transaction
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Actual transaction amount
    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Categorized transaction type
    transactionType: {
      type: String,
      enum: [
        "bot_purchase",
        "balance_recharge",
        "withdrawal",
        "trade_fee",
        "referral_bonus",
        "system_credit",
        "refund",
        "referral_withdrawal",
        "chargeback",
        "penalty",
        "bot_fee",
      ],
      required: true,
      index: true,
    },

    // Approval status
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "failed"],
      default: "pending",
      index: true,
    },

    // Payment source
    paymentMethod: {
      type: String,
      enum: ["crypto", "bank_transfer", "card", "wallet", "admin_adjustment"],
      required: true,
    },

    // Currency used (for multi-currency support)
    currency: {
      type: String,
      default: "usd", // Can be crypto (e.g., BTC, USDT) or fiat
      uppercase: true,
    },

    // External or internal reference ID
    referenceId: {
      type: String,
      unique: true,
      required: true,
    },

    // Custom data for third-party gateway or internal audit
    metadata: {
      type: Object,
      default: {},
    },

    // Wallet balance after the transaction (for auditing)
    balanceAfterTransaction: {
      type: Number,
      default: null,
    },

    // Soft delete flag
    isDeleted: {
      type: Boolean,
      default: false,
    },

    // Timestamp when transaction was approved/rejected
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// 🔹 Indexes for performance
TransactionSchema.index({ userId: 1, referenceId: 1 });
TransactionSchema.index({ status: 1, transactionType: 1 });
TransactionSchema.index({ createdAt: 1 });

module.exports = mongoose.model("Transaction", TransactionSchema);
