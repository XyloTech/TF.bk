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
    apiKey: { type: String, default: "" }, // MODIFIED: Not required, default empty
    apiSecretKey: { type: String, default: "" }, // MODIFIED: Not required, default empty. Stores *encrypted* key.
    telegramId: { type: String, default: "" },
    active: { type: Boolean, default: true },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    accountType: {
      type: String,
      enum: ["demo", "paid"],
      required: true,
      default: "demo",
    },
    strategy: { type: String, default: "DEFAULT_STRATEGY" },
    exchange: {
      type: String,
      // MODIFIED: Not strictly required at instance creation for demo. User will set it on configure page.
      // required: true, <--- REMOVED
      enum: ["", "BINANCE", "KUCOIN", "BYBIT", "BINGX", "OKX", "BITGET"], // MODIFIED: Added "" to allow empty string
      uppercase: true,
      default: "", // MODIFIED: Default to empty string
    },
    running: { type: Boolean, default: false },
    lastExecuted: { type: Date },
    config: {
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
  if (this.isModified("apiSecretKey")) {
    try {
      // Only encrypt if apiSecretKey is a non-empty string
      if (
        this.apiSecretKey &&
        typeof this.apiSecretKey === "string" &&
        this.apiSecretKey.trim() !== ""
      ) {
        this.apiSecretKey = encrypt(this.apiSecretKey.trim()); // Trim before encrypting
      } else {
        // If it's empty, ensure it's stored as an empty string
        this.apiSecretKey = "";
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
    // apiKey is not encrypted, but still good to remove from default toJSON
    // unless specifically selected for an internal operation.
    delete ret.apiKey;
    delete ret.apiSecretKey; // encrypted secret key
    delete ret.__v;
    return ret;
  },
});

// Indexes for performance
BotInstanceSchema.index({ userId: 1, createdAt: -1 });
BotInstanceSchema.index({ accountType: 1, active: 1, expiryDate: 1 });
BotInstanceSchema.index({ running: 1 });
// --- MODIFICATION FOR TESTING ---
// Comment out the unique index for demo accounts to allow multiple demos per user/bot for testing
/*
BotInstanceSchema.index(
  { userId: 1, botId: 1, accountType: 1 },
  { unique: true, partialFilterExpression: { accountType: "demo" } }
); // Ensures only one demo per user per bot template
*/
// --- END OF MODIFICATION ---

module.exports = mongoose.model("BotInstance", BotInstanceSchema);
