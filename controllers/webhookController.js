// controllers/webhookController.js
const logger = require("../utils/logger"); // Assuming you have this logger utility

exports.handleFreqtradeTrade = async (req, res, next) => {
  logger.info("Received Freqtrade Webhook:", {
    headers: req.headers, // Log headers (might contain useful info)
    body: req.body, // Log the entire payload
  });

  // TODO: Implement security verification (shared secret)
  // TODO: Parse req.body to extract trade details
  // TODO: Extract botInstanceId from req.body.bot_name
  // TODO: Find/Update/Create trade record in MongoDB `trades` collection
  // TODO: Handle different webhook types (entry, exit, cancel, etc.)

  // Always send a quick 200 OK response to Freqtrade
  res.status(200).json({ message: "Webhook received successfully." });
};
