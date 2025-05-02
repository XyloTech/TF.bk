const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const UserSchema = new mongoose.Schema(
  {
    firebaseUID: { type: String, required: true, unique: true, index: true }, // Store Firebase UID
    fullName: { type: String, trim: true, default: "" },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    telegramId: { type: String, default: "" },
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referralLink: { type: String, default: "" },
    accountBalance: { type: Number, default: 0.0 },
    minimumBalance: { type: Number, default: 5.0 },
    status: {
      type: String,
      enum: ["active", "banned", "inactive"],
      default: "active",
    },
    // NEW: Track if user has completed the initial registration/referral step
    registrationComplete: { type: Boolean, default: false },
  },
  { timestamps: true }
);

//  Auto-remove sensitive fields from JSON responses
UserSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("User", UserSchema);
