// routes/paymentRoutes.js
const express = require("express");
const {
  createCryptoPayment,
  nowPaymentsWebhook,
  getPaymentStatus,
} = require("../controllers/paymentController"); // Adjust path
const authenticateUser = require("../middleware/authMiddleware"); // Adjust path

const router = express.Router();

// POST /api/payments/create - User initiates payment (Needs JSON body)
router.post("/create", authenticateUser, express.json(), createCryptoPayment); // Ensure JSON parsing if not global

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
