// routes/paymentRoutes.js
const express = require("express");
const {
  rechargeAmount
} = require("../controllers/transactionController"); // Adjust path
const {
  createBotPurchasePayment,
  createRechargePayment,
  nowPaymentsWebhook,
  getPaymentStatus,
  validateAddress,
  getWithdrawalFee,
  getEstimatedConversionPrice,
  createPayout,
  getMinimumPaymentAmount,
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

router.get("/minimum-amount", authenticateUser, getMinimumPaymentAmount);

// POST /api/payments/webhook - NowPayments sends status updates (Needs RAW body for signature check)
// Apply express.raw() BEFORE the controller handles it.
router.post(
  "/webhook",
  express.raw({ type: 'application/json' }), // Ensure raw body is available for signature verification
  nowPaymentsWebhook
);

// GET /api/payments/status?ref=... - User checks status
router.get("/status", authenticateUser, getPaymentStatus);
router.post("/validate-address", authenticateUser, validateAddress);

// --- Withdrawal Fee Endpoint ---
router.get("/withdrawal-fee", authenticateUser, express.json(), getWithdrawalFee);

// --- Estimated Price Endpoint ---
router.get(
  "/estimated-price",
  authenticateUser,
  express.json(),
  getEstimatedConversionPrice
);

router.post(
  "/create-payout", authenticateUser, express.json(), createPayout
);

// POST /api/payments/purchase - Assuming this is for bot purchase based on frontend error
router.post(
  "/purchase",
  authenticateUser,
  express.json(),
  createBotPurchasePayment
);

// GET /api/payments/recharge-amount - User fetches their total recharge amount
router.get(
  "/recharge-amount",
  authenticateUser,
  rechargeAmount
);

// router.post("/payout-webhook", payoutWebhook); // No auth middleware for webhooks
module.exports = router;
