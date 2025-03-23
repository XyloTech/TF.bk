const express = require("express");
const router = express.Router();
const {
  createCryptoPayment,
  nowPaymentsWebhook,
  getPaymentStatus,
} = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");

// 🔐 Create payment (user must be logged in)
router.post("/create-payment", authMiddleware, createCryptoPayment);

// 🌐 Webhook (open route)
router.post("/webhook", nowPaymentsWebhook);

// 🔎 Check payment status (optional for frontend)
router.get("/status", getPaymentStatus);

module.exports = router;
