// routes/paymentRoutes.js
const express = require("express");
const {
  createBotPurchasePayment,
  createRechargePayment,
  nowPaymentsWebhook,
  getPaymentStatus,
  minimumAmount,
  validateAddress,
  withdrawalFee,
  estimatedPrice,
  createPayout,
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

router.get("/minimum-amount", authenticateUser, express.json(), minimumAmount);

// POST /api/payments/webhook - NowPayments sends status updates (Needs RAW body for signature check)
// Apply express.raw() BEFORE the controller handles it.
router.post(
  "/webhook",
  express.raw({ type: "application/json" }), // Capture raw body as buffer
  nowPaymentsWebhook
);

// GET /api/payments/status?ref=... - User checks status
router.get("/status", authenticateUser, getPaymentStatus);
router.post("/validate-address", authenticateUser, validateAddress);

// --- Withdrawal Fee Endpoint ---
router.get("/withdrawal-fee", authenticateUser, express.json(), withdrawalFee);

// --- Estimated Price Endpoint ---
router.get(
  "/estimated-price",
  authenticateUser,
  express.json(),
  estimatedPrice
);

router.post("/create-payout", authenticateUser, express.json(), createPayout);
// router.post("/payout-webhook", payoutWebhook); // No auth middleware for webhooks
module.exports = router; // router.post("/payout-webhook", payoutWebhook); // No auth middleware for webhooks

module.exports = router;
