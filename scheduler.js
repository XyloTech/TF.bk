// scheduler.js
const cron = require("node-cron");
const BotInstance = require("./models/BotInstance"); // Adjust path
const User = require("./models/User"); // Adjust path
const { stopFreqtradeProcess } = require("./services/freqtrade"); // Adjust path
const { sendNotification } = require("./socket"); // Adjust path for WebSocket notifications

let scheduledTask = null;

const checkExpiredDemos = async () => {
  console.log("🕒 [Scheduler] Running check for expired demo bot instances...");
  const now = new Date();

  try {
    // Find demo instances that are still marked active but whose expiry is past
    const expiredDemos = await BotInstance.find({
      accountType: "demo",
      active: true, // Only target active ones that shouldn't be
      expiryDate: { $lt: now },
    })
      .select("_id userId botId exchange") // Select only needed fields
      .populate({ path: "userId", select: "_id email telegramId" }); // Get user info for notification

    if (expiredDemos.length === 0) {
      console.log(" [Scheduler] No expired demo instances found.");
      return;
    }

    console.log(
      `⚠️ [Scheduler] Found ${expiredDemos.length} expired demo instances to deactivate.`
    );

    for (const instance of expiredDemos) {
      const instanceIdStr = instance._id.toString();
      const userIdStr = instance.userId?._id?.toString();
      console.log(
        `[Scheduler] Processing expired demo instance ID: ${instanceIdStr} for user ${
          userIdStr || "N/A"
        }`
      );

      try {
        // Stop the process via PM2 and mark inactive in DB
        // Pass markInactive = true
        await stopFreqtradeProcess(instanceIdStr, true);

        // Send notification (WebSocket is preferred for real-time UI update)
        if (userIdStr) {
          const notificationMsg = `Your demo period for the bot (${instance.exchange}) has expired. Please subscribe to continue trading.`;
          // Send via Socket.IO to the user's private room
          sendNotification(userIdStr, "demo_expired", notificationMsg);
          console.log(
            `[Scheduler] Sent demo_expired notification for instance ${instanceIdStr} to user ${userIdStr}`
          );

          // TODO: Optionally send Telegram notification if needed
          // if (instance.userId.telegramId && process.env.TELEGRAM_BOT_TOKEN) {
          //    // Import and call your Telegram sending function here
          // }
        }
      } catch (stopError) {
        console.error(
          `[Scheduler] Failed to stop/deactivate expired demo instance ${instanceIdStr}:`,
          stopError
        );
        // Consider adding alerting for repeated failures
      }
    }
  } catch (error) {
    console.error(
      "❌ [Scheduler] Error during expired demo check task:",
      error
    );
  }
};

const initScheduler = () => {
  if (scheduledTask) {
    console.warn("[Scheduler] Scheduler already initialized.");
    return;
  }
  // Schedule to run every hour (at minute 0). Adjust as needed.
  console.log(
    " [Scheduler] Initializing expired demo checker (runs hourly)..."
  );
  scheduledTask = cron.schedule("0 * * * *", checkExpiredDemos, {
    // Runs at 0 minutes past the hour
    scheduled: true,
    timezone: "Etc/UTC", // Use UTC for consistency
  });

  // Optional: Run once on startup after a short delay to catch up immediately
  console.log("[Scheduler] Running initial check shortly...");
  setTimeout(checkExpiredDemos, 15 * 1000); // Run 15 seconds after server starts

  console.log(" [Scheduler] Initialized.");
};

const stopScheduler = () => {
  if (scheduledTask) {
    console.log("⏹️ [Scheduler] Stopping...");
    scheduledTask.stop();
    scheduledTask = null;
    console.log(" [Scheduler] Stopped.");
  }
};

module.exports = { initScheduler, stopScheduler };
