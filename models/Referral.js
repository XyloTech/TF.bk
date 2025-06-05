const mongoose = require("mongoose");

const ReferralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    referredId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED", "CANCELLED"],
      default: "PENDING",
    },
    commissionAmount: {
      type: Number,
      default: 2,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// 🔹 Foreign key indexes
ReferralSchema.index({ referrerId: 1, referredId: 1 });

module.exports = mongoose.model("Referral", ReferralSchema);
