const mongoose = require("mongoose");
const bcrypt = require("bcrypt"); // Make sure bcrypt is installed and required

const BotInstanceSchema = new mongoose.Schema(
  {
    botId: { type: mongoose.Schema.Types.ObjectId, ref: "Bot", required: true },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    apiKey: { type: String, required: true },
    apiSecretKey: { type: String, required: true },
    telegramId: { type: String },
    active: { type: Boolean, default: true },
    purchaseDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    accountType: {
      type: String,
      enum: ["demo", "paid"],
      required: true,
      default: "demo",
    },

    // 🧠 NEW FIELDS FOR SCALABILITY
    strategy: { type: String, default: "DEFAULT_STRATEGY" },
    exchange: {
      type: String,
      required: true,
      enum: ["BINANCE", "KUCOIN", "BYBIT"],
    }, // Added BYBIT as example
    running: { type: Boolean, default: false }, // ⬅ helps manage running state
    lastExecuted: { type: Date }, // ⬅ scheduling / freshness tracking
    config: {
      type: Object,
      default: {},
      validate: {
        validator: function (v) {
          // Basic check: ensure it's an object (and not null/array)
          return typeof v === "object" && v !== null && !Array.isArray(v);
        },
        message: "Invalid config object",
      },
    },
  },
  { timestamps: true }
);
// Pre-save hook to hash apiSecretKey before saving
BotInstanceSchema.pre("save", async function (next) {
  if (this.isModified("apiSecretKey")) {
    try {
      const salt = await bcrypt.genSalt(10);
      this.apiSecretKey = await bcrypt.hash(this.apiSecretKey, salt);
    } catch (error) {
      return next(error); // Pass error to next middleware
    }
  }
  next();
});

// Remove sensitive fields from JSON responses
BotInstanceSchema.set("toJSON", {
  transform: function (doc, ret) {
    delete ret.apiKey;
    delete ret.apiSecretKey;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model("BotInstance", BotInstanceSchema);
