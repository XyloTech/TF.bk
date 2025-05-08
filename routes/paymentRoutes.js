// routes/paymentRoutes.js
const express = require("express");
const {
  createBotPurchasePayment,
  createRechargePayment,
  nowPaymentsWebhook,
  getPaymentStatus,
} = require("../controllers/paymentController"); // Adjust path
const authenticateUser = require("../middleware/authMiddleware"); // Adjust path

const router = express.Router();

// POST /api/payments/create-bot-purchase - User initiates bot purchase
router.post(
  "/create-bot-purchase",
  authenticateUser,
  express.json(),
  createBotPurchasePayment
);

// POST /api/payments/create-recharge - User initiates account balance recharge
router.post(
  "/create-recharge",
  authenticateUser,
  express.json(),
  createRechargePayment
);

// POST /api/payments/webhook - NowPayments sends status updates (Needs RAW body for signature check)
// Apply express.raw() BEFORE the controller handles it.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }), // Capture raw body as buffer
  nowPaymentsWebhook
);

// GET /api/payments/status?ref=... - User checks status
router.get("/status", authenticateUser, getPaymentStatus);

module.exports = router;
