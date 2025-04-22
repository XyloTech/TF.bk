// models/BotInstance.js
const mongoose = require("mongoose");
const { encrypt } = require("../utils/crypto"); // Adjust path if needed

const BotInstanceSchema = new mongoose.Schema(
  {
    botId: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    apiKey: { type: String, required: true },
    apiSecretKey: { type: String, required: true }, // Stores the *encrypted* secret key
    telegramId: { type: String, default: "" },
    active: { type: Boolean, default: true }, // Controls if the bot *can* be run (overall status)
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true }, // Demo or subscription expiry
    accountType: {
      type: String,
      enum: ["demo", "paid"],
      required: true,
      default: "demo",
    },
    strategy: { type: String, default: "DEFAULT_STRATEGY" }, // Consider making required or fetching from Bot model
    exchange: {
      type: String,
      required: true,
      enum: ["BINANCE", "KUCOIN", "BYBIT", "BINGX", "OKX", "BITGET"], // Add all supported exchanges
      uppercase: true, // Ensure consistent casing
    },
    running: { type: Boolean, default: false }, // Tracks if the PM2 process *should* be running
    lastExecuted: { type: Date }, // Timestamp of last start/significant action
    config: {
      // Optional Freqtrade override configurations specific to this instance
      type: Object,
      default: {},
      validate: {
        validator: function (v) {
          return typeof v === "object" && v !== null && !Array.isArray(v);
        },
        message: "Config must be a valid object.",
      },
    },
  },
  { timestamps: true }
);

// Pre-save hook to ENCRYPT apiSecretKey
BotInstanceSchema.pre("save", function (next) {
  // Only encrypt if the secret key is modified (or new)
  if (this.isModified("apiSecretKey")) {
    try {
      // Encrypt the plain text secret key before saving
      if (this.apiSecretKey) {
        // Avoid encrypting empty strings if possible
        this.apiSecretKey = encrypt(this.apiSecretKey);
      }
    } catch (error) {
      console.error(
        `Error encrypting apiSecretKey for instance ${this._id}:`,
        error
      );
      return next(error); // Pass error to Mongoose
    }
  }
  next();
});

// Remove sensitive fields from JSON responses
BotInstanceSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.apiKey; // Still remove API key for safety
    delete ret.apiSecretKey; // Remove ENCRYPTED secret key
    delete ret.__v;
    return ret;
  },
});

// Indexes for performance
BotInstanceSchema.index({ userId: 1, createdAt: -1 }); // Get user bots
BotInstanceSchema.index({ accountType: 1, active: 1, expiryDate: 1 }); // Scheduler check
BotInstanceSchema.index({ running: 1 }); // Potentially useful for finding running bots

module.exports = mongoose.model("BotInstance", BotInstanceSchema);
