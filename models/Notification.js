const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: { type: String, required: true },
    type: {
      type: String,
      enum: ["low_balance", "trade_update", "system_alert"],
      required: true,
    },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// 🔹 Index for fast lookup
NotificationSchema.index({ userId: 1 });

module.exports = mongoose.model("Notification", NotificationSchema);
