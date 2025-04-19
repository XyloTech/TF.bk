const mongoose = require("mongoose");

const BotLogSchema = new mongoose.Schema({
  botInstanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BotInstance",
    required: true,
  },
  type: {
    type: String,
    enum: ["start", "stop", "error", "performance"],
    required: true,
  },
  message: { type: String },
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("BotLog", BotLogSchema);
