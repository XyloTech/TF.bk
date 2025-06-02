// crypto-bot/services/freqtrade/pm2ProcessMonitor.js
const pm2 = require("pm2");
const logger = require("../../utils/logger");
const BotInstance = require("../../models/BotInstance");
const Notification = require("../../models/Notification"); // For creating persistent notifications
const { sendNotification } = require("../../socket");

let isMonitorInitialized = false;

function initializePm2EventMonitor() {
  if (isMonitorInitialized) {
    logger.warn("[PM2Monitor] Monitor already initialized.");
    return;
  }

  logger.info("[PM2Monitor] Initializing PM2 event bus listener...");

  pm2.launchBus((err, pm2_bus) => {
    if (err) {
      logger.error("[PM2Monitor] Could not launch PM2 event bus:", err);
      isMonitorInitialized = false; // Ensure it can be retried if server restarts PM2 connection
      return;
    }
    isMonitorInitialized = true;
    logger.info("[PM2Monitor] PM2 event bus connected successfully.");

    pm2_bus.on("process:event", async (packet) => {
      try {
        // Wrap entire handler in try/catch to prevent monitor crashing
        const processInfo = packet.process;
        const processName = processInfo?.name;
        const event = packet.event;
        const pm2InstanceId = processInfo?.pm_id; // PM2's internal ID for the process

        if (processName && processName.startsWith("freqtrade-")) {
          const instanceId = processName.replace("freqtrade-", "");
          const botNameForLog = `Bot ${instanceId.slice(-6)}`; // Generic name for logs initially

          //   logger.debug(
          //     `[PM2Monitor] Event '${event}' for PM2 ID ${pm2InstanceId}, Process '${processName}' (Instance ID: ${instanceId}) | Status: ${processInfo?.pm2_env?.status}`
          //   );

          // We are interested in unexpected exits, errors, or stop events that result in an errored state.
          // 'stop' event can also mean PM2 manually stopped it. We only care if it led to error.
          // 'restart overlimit' means PM2 gave up.
          if (
            event === "exit" ||
            event === "error" ||
            (event === "stop" && processInfo?.pm2_env?.status === "errored") ||
            event === "restart overlimit"
          ) {
            logger.warn(
              `[PM2Monitor] Process ${processName} (Instance: ${instanceId}) emitted critical event: '${event}'. PM2 Status: ${processInfo?.pm2_env?.status}. PM2 restarts: ${processInfo?.pm2_env?.restart_time}`
            );

            const botInstance = await BotInstance.findById(instanceId)
              .populate("userId", "_id") // Only need user's _id
              .populate("botId", "name"); // Get bot template name

            if (!botInstance) {
              logger.warn(
                `[PM2Monitor] BotInstance ${instanceId} not found in DB for PM2 event processing.`
              );
              return;
            }

            const actualBotName = botInstance.botId?.name || botNameForLog;

            // Only act if the database thought the bot was running
            if (botInstance.running) {
              logger.info(
                `[PM2Monitor] Bot "${actualBotName}" (Instance ${instanceId}) was marked as running. Updating status due to PM2 event '${event}'.`
              );
              botInstance.running = false;
              // Optionally, set a specific status field on the BotInstance model
              // botInstance.internalDisplayStatus = "CRASHED";
              await botInstance.save();

              if (botInstance.userId?._id) {
                const userIdStr = botInstance.userId._id.toString();
                const notificationMessage = `Bot "${actualBotName}" stopped unexpectedly or encountered an error and could not be restarted by PM2. Please check logs.`;

                // Send WebSocket notification for immediate UI update
                sendNotification(userIdStr, "bot_status_update", {
                  instanceId: instanceId,
                  status: "CRASHED_PM2", // A clear status for the frontend
                  running: false,
                  botName: actualBotName,
                  message: notificationMessage,
                });

                // Create a persistent database notification
                await Notification.create({
                  userId: botInstance.userId._id,
                  type: "system_alert", // Or a more specific type like 'bot_crashed'
                  message: notificationMessage,
                });
                logger.info(
                  `[PM2Monitor] Sent CRASHED_PM2 notification (WebSocket & DB) for instance ${instanceId} to user ${userIdStr}`
                );
              } else {
                logger.warn(
                  `[PM2Monitor] Instance ${instanceId} is missing userId, cannot send user notification for crash.`
                );
              }
            } else {
              //   logger.info(`[PM2Monitor] Bot "${actualBotName}" (Instance ${instanceId}) already marked as stopped in DB. PM2 event '${event}' ignored for DB update/notification.`);
            }
          } else if (event === "online") {
            // This event fires when a process (re)starts and PM2 considers it online.
            // If you want to notify about successful auto-restarts:
            // const botInstance = await BotInstance.findById(instanceId).populate("userId", "_id").populate("botId", "name");
            // if (botInstance && !botInstance.running) { // If DB thought it was stopped but PM2 brought it online (e.g. after manual pm2 restart)
            //    logger.info(`[PM2Monitor] Process ${processName} (Instance: ${instanceId}) is now 'online'. Updating DB if needed.`);
            //    botInstance.running = true;
            //    await botInstance.save();
            //    // Send "RESTARTED" notification
            // }
          }
        }
      } catch (packetProcessingError) {
        logger.error(
          "[PM2Monitor] Error processing PM2 packet:",
          packetProcessingError,
          packet
        );
      }
    });

    pm2_bus.on("error", (busError) => {
      logger.error("[PM2Monitor] PM2 Bus Error:", busError);
      // Consider re-initializing the bus on certain types of errors if it disconnects.
      isMonitorInitialized = false; // Allow re-init on next attempt
    });

    pm2_bus.on("close", () => {
      logger.warn("[PM2Monitor] PM2 Bus connection closed.");
      isMonitorInitialized = false; // Allow re-init
    });
  });
}

module.exports = { initializePm2EventMonitor };
