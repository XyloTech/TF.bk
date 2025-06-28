const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema(
  {
    firebaseUID: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },

    fullName: {
      type: String,
      trim: true,
      default: "",
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      select: false, // Only select when needed
    },

    role: {
      type: String,
      enum: ["user", "admin", "moderator"],
      default: "user",
    },

    telegramId: {
      type: String,
      default: "",
    },

    // 🔗 Referral System
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    referralLink: {
      type: String,
      default: "",
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    referralBalance: {
      type: Number,
      default: 0.0,
    },

    // 💳 Wallet Tracking
    accountBalance: {
      type: Number,
      default: 0.0,
    },
    minimumBalance: {
      type: Number,
      default: 5.0,
    },

    // 📊 Status
    status: {
      type: String,
      enum: ["active", "banned", "inactive", "suspended"],
      default: "active",
    },
    suspicious: {
      type: Boolean,
      default: false,
    },
    registrationComplete: {
      type: Boolean,
      default: false,
    },

    // 🛡️ Security & Monitoring
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastSeenAt: {
      type: Date,
      default: null,
    },
    tokenVersion: {
      type: Number,
      default: 0, // Increment to invalidate JWTs
    },

    // 🗑️ Soft delete support
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },

    // 📈 Trading Statistics
    tradingStats: {
      totalProfit: { type: Number, default: 0 },
      monthlyProfitChangePercent: { type: Number, default: 0 },
      todayProfit: { type: Number, default: 0 },
      winRate: { type: Number, default: 0 }, // Expecting 0-100
      tradesCount: { type: Number, default: 0 },
      averageFeePerTrade: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// 🔒 Remove sensitive info from responses
UserSchema.set("toJSON", {
  transform: (doc, ret) => {
    delete ret.__v;
    delete ret.password;
    return ret;
  },
});

UserSchema.index({ firebaseUID: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ referralCode: 1 });

module.exports = mongoose.model("User", UserSchema);
