// routes/webhookRoutes.js
const express = require("express");
const { handleFreqtradeTrade } = require("../controllers/webhookController");
// const verifyWebhookSecret = require('../middleware/verifyWebhookSecret'); // We'll add this later

const router = express.Router();

// Route to handle incoming trade webhooks from Freqtrade
// We'll add security middleware later. Apply express.json() first.
router.post("/freqtrade/trade", express.json(), handleFreqtradeTrade);

module.exports = router;
