// middleware/verifyFreqtradeWebhook.js
const crypto = require("crypto");
const logger = require("../utils/logger"); // Adjust path if needed

// Get the secret from environment variables
const FREQTRADE_WEBHOOK_SECRET = process.env.FREQTRADE_WEBHOOK_SECRET;
const FQ_SIGNATURE_HEADER = "x-freqtrade-signature"; // Default header Freqtrade might use

// Middleware function to verify the signature
const verifyFreqtradeWebhook = (req, res, next) => {
  const operation = "verifyFreqtradeWebhook";

  // 1. Check if the secret is configured (CRITICAL)
  if (!FREQTRADE_WEBHOOK_SECRET) {
    logger.error({
      operation,
      message: `CRITICAL: FREQTRADE_WEBHOOK_SECRET is not configured in environment variables. Rejecting webhook.`,
    });
    // Do NOT proceed without a secret configured on the server
    return res
      .status(500)
      .json({ message: "Webhook secret not configured on server." });
  }

  // 2. Check if the request body is available (should be raw buffer)
  if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
    logger.warn({
      operation,
      message: `Webhook request received without a valid raw body. Ensure express.raw() middleware is used correctly before this middleware.`,
    });
    return res
      .status(400)
      .json({ message: "Invalid or missing request body." });
  }

  // 3. Get the signature from the request header
  const receivedSignatureWithMethod = req.headers[FQ_SIGNATURE_HEADER];
  if (!receivedSignatureWithMethod) {
    logger.warn({
      operation,
      message: `Webhook request missing '${FQ_SIGNATURE_HEADER}' header. Rejecting.`,
    });
    return res
      .status(401)
      .json({ message: "Missing webhook signature header." });
  }

  // 4. Parse the signature (Freqtrade often sends 'sha512=signature')
  const signatureParts = receivedSignatureWithMethod.split("=");
  if (signatureParts.length !== 2 || signatureParts[0] !== "sha512") {
    logger.warn({
      operation,
      message: `Invalid signature format received: ${receivedSignatureWithMethod}. Expected 'sha512=...'`,
    });
    return res.status(401).json({ message: "Invalid signature format." });
  }
  const receivedSignature = signatureParts[1];

  try {
    // 5. Calculate the expected signature using HMAC-SHA512
    const hmac = crypto.createHmac("sha512", FREQTRADE_WEBHOOK_SECRET);
    const calculatedSignature = hmac.update(req.body).digest("hex"); // req.body must be the raw buffer

    // 6. Compare signatures using a timing-safe method
    const trusted = Buffer.from(calculatedSignature, "utf8");
    const untrusted = Buffer.from(receivedSignature, "utf8");

    if (
      trusted.length !== untrusted.length ||
      !crypto.timingSafeEqual(trusted, untrusted)
    ) {
      logger.warn({
        operation,
        message: `Invalid webhook signature. Verification failed.`,
        received: receivedSignature,
      });
      // logger.debug({ operation, calculated: calculatedSignature }); // Optional: log calculated only in debug
      return res.status(403).json({ message: "Invalid webhook signature." });
    }

    // 7. Signature is valid - proceed to the next middleware/controller
    logger.info({
      operation,
      message: `Freqtrade webhook signature verified successfully.`,
    });
    next();
  } catch (error) {
    logger.error({
      operation,
      message: `Error during webhook signature verification.`,
      error: error.message,
      stack: error.stack,
    });
    return res
      .status(500)
      .json({ message: "Error verifying webhook signature." });
  }
};

module.exports = verifyFreqtradeWebhook;
