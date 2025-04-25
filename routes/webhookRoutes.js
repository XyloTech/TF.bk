// routes/webhookRoutes.js
const express = require("express");
const { handleFreqtradeTrade } = require("../controllers/webhookController");
const verifyFreqtradeWebhook = require("../middleware/verifyFreqtradeWebhook"); // <--- Import the new middleware

const router = express.Router();

// Route to handle incoming trade webhooks from Freqtrade
router.post(
  "/freqtrade/trade",
  // 1. Use express.raw() FIRST to get the raw body buffer needed for signature verification
  express.raw({ type: "application/json" }), // Adjust 'type' if Freqtrade sends a different Content-Type
  // 2. Apply the verification middleware NEXT
  verifyFreqtradeWebhook,
  // 3. If verification passes, THEN run the controller
  handleFreqtradeTrade
);

module.exports = router;
