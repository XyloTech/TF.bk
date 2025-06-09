// const mongoose = require("mongoose");
// const bcrypt = require("bcrypt");

// const UserSchema = new mongoose.Schema(
//   {
//     firebaseUID: { type: String, required: true, unique: true, index: true }, // Store Firebase UID
//     fullName: { type: String, trim: true, default: "" },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//       lowercase: true,
//       trim: true,
//       index: true,
//     },
//     role: { type: String, enum: ["user", "admin"], default: "user" },
//     telegramId: { type: String, default: "" },
//     referralCode: { type: String, unique: true, sparse: true, index: true },
//     referralLink: { type: String, default: "" },
//     accountBalance: { type: Number, default: 0.0 },
//     minimumBalance: { type: Number, default: 5.0 },
//     status: {
//       type: String,
//       enum: ["active", "banned", "inactive"],
//       default: "active",
//     },
//     // NEW: Track if user has completed the initial registration/referral step
//     registrationComplete: { type: Boolean, default: false },
//   },
//   { timestamps: true }
// );

// //  Auto-remove sensitive fields from JSON responses
// UserSchema.set("toJSON", {
//   transform: function (doc, ret) {
//     delete ret.__v;
//     return ret;
//   },
// });

// module.exports = mongoose.model("User", UserSchema);

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
      index: true,
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

module.exports = mongoose.model("User", UserSchema);
