// controllers/paymentController.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto"); // Import Node.js crypto module
const Transaction = require("../models/Transaction"); // Adjust path
const User = require("../models/User"); // Adjust path
const BotInstance = require("../models/BotInstance"); // Adjust path
const Bot = require("../models/Bot"); // To get default strategy etc.
const { sendBotSuccessEmail } = require("../utils/email"); // Adjust path for email utility
const { sendTelegramMessage } = require("../utils/telegram"); // Adjust path for telegram utility

// Ensure required environment variables are present
if (!process.env.NOWPAYMENTS_API_KEY) {
  console.error("FATAL ERROR: NOWPAYMENTS_API_KEY is not set in .env");
  // process.exit(1); // Optional: Exit if critical
}
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET; // Get secret from env
if (!NOWPAYMENTS_IPN_SECRET && process.env.NODE_ENV === "production") {
  // Check in production
  console.error(
    "FATAL ERROR: NOWPAYMENTS_IPN_SECRET is not set in .env. Webhook verification will fail in production."
  );
  // process.exit(1); // Exit if critical in production
} else if (!NOWPAYMENTS_IPN_SECRET) {
  console.warn(
    "WARNING: NOWPAYMENTS_IPN_SECRET is not set. Webhook verification is disabled (OK for dev, NOT for production)."
  );
}

const FRONTEND_URL = process.env.FRONTEND_URL || "https://yourfrontend.com"; // Use an env var for frontend URL

// --- Helper Function for Verification ---
function verifyNowPaymentsSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) {
    console.error(
      "Webhook verification failed: Missing 'x-nowpayments-sig' header."
    );
    return false;
  }
  if (!secret) {
    console.error(
      "Webhook verification skipped: NOWPAYMENTS_IPN_SECRET is not configured."
    );
    // Return true in non-production if secret is missing, but false in production
    return process.env.NODE_ENV !== "production";
  }

  try {
    const hmac = crypto.createHmac("sha512", secret);
    // IMPORTANT: Use the rawBody (Buffer) directly for HMAC update
    const calculatedSignature = hmac.update(rawBody).digest("hex");

    // Use timingSafeEqual for security against timing attacks
    const trusted = Buffer.from(calculatedSignature, "utf8");
    const untrusted = Buffer.from(signatureHeader, "utf8");

    if (
      trusted.length !== untrusted.length ||
      !crypto.timingSafeEqual(trusted, untrusted)
    ) {
      console.warn("Invalid NowPayments webhook signature.");
      console.log("Received:", signatureHeader);
      console.log("Calculated:", calculatedSignature);
      return false;
    }
    console.log("NowPayments webhook signature verified successfully.");
    return true;
  } catch (error) {
    console.error("Error during NowPayments signature verification:", error);
    return false;
  }
}
// --- End Helper Function ---

// 🔹 Create NowPayments Invoice for Bot Purchase/Subscription
exports.createCryptoPayment = async (req, res) => {
  // Assuming amount represents the subscription price in USD
  const { amount, botId, userIdToCredit } = req.body; // userIdToCredit might be passed by admin?
  const requestingUser = req.userDB; // The logged-in user initiating payment

  const targetUserId = userIdToCredit || requestingUser._id;

  if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
    return res.status(400).json({ message: "Invalid payment amount." });
  }
  const paymentAmount = parseFloat(amount);

  let botTemplate;
  try {
    botTemplate = await Bot.findById(botId);
    if (!botTemplate) {
      return res
        .status(404)
        .json({ message: `Bot template with ID ${botId} not found.` });
    }
    // Optional Price Check
    // if (botTemplate.price !== paymentAmount) { ... }
  } catch (err) {
    console.error("Error fetching Bot template:", err);
    return res
      .status(500)
      .json({ message: "Error validating bot information." });
  }

  try {
    const referenceId = uuidv4();
    console.log(
      `Creating NowPayments invoice for User: ${targetUserId}, Bot: ${botId}, Amount: ${paymentAmount}, Ref: ${referenceId}`
    );

    const nowPaymentsPayload = {
      price_amount: paymentAmount,
      price_currency: "usd",
      order_id: referenceId,
      order_description: `Subscription for ${
        botTemplate.name || `Bot ID: ${botId}`
      }`, // Use bot name if available
      // --- IMPORTANT: SET YOUR WEBHOOK URL IN NOWPAYMENTS DASHBOARD OR HERE ---
      // ipn_callback_url: `${process.env.API_BASE_URL}/api/payments/webhook`, // Use API_BASE_URL from .env
      success_url: `${FRONTEND_URL}/payment/success?ref=${referenceId}`,
      cancel_url: `${FRONTEND_URL}/payment/cancel?ref=${referenceId}`,
    };

    const nowRes = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      nowPaymentsPayload,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );
    const invoice = nowRes.data;

    const tx = new Transaction({
      userId: targetUserId,
      amount: paymentAmount,
      transactionType: "recharge",
      paymentMethod: "crypto",
      status: "pending",
      referenceId: referenceId,
      metadata: {
        botId: botId,
        botName: botTemplate.name, // Store name for convenience
        invoiceId: invoice.id,
        paymentUrl: invoice.invoice_url,
        requestingUserId: requestingUser._id,
      },
    });
    await tx.save();
    console.log(
      `Transaction ${referenceId} created (pending) for NowPayments invoice ${invoice.id}`
    );

    res
      .status(200)
      .json({ invoice_url: invoice.invoice_url, referenceId: referenceId });
  } catch (err) {
    console.error(
      "❌ NowPayments Invoice Creation Error:",
      err.response?.data || err.message
    );
    res.status(500).json({ message: "Failed to create payment invoice." });
  }
};

// 🔹 Handle NowPayments Webhook (IPN - Instant Payment Notification)
exports.nowPaymentsWebhook = async (req, res) => {
  // --- Verification Step ---
  const signature = req.headers["x-nowpayments-sig"];
  // req.body is the raw Buffer here because of express.raw() in the route
  const isVerified = verifyNowPaymentsSignature(
    req.body,
    signature,
    NOWPAYMENTS_IPN_SECRET
  );

  // --- STRICT Check in Production ---
  if (!isVerified && process.env.NODE_ENV === "production") {
    console.error(
      "Webhook verification FAILED in production. Rejecting request."
    );
    return res.status(403).json({ message: "Invalid signature" });
  } else if (!isVerified) {
    console.warn(
      "Webhook verification failed/skipped (NODE_ENV!=production or missing secret). Processing anyway for testing, but DO NOT deploy this way."
    );
  }
  // --- End Verification Step ---

  // --- Parse the JSON body AFTER verification ---
  let webhookData;
  try {
    // req.body is a Buffer, convert to string and parse
    webhookData = JSON.parse(req.body.toString());
    console.log(
      "Received Verified/Processed NowPayments Webhook (Body Parsed):",
      webhookData
    );
  } catch (parseError) {
    console.error(
      "Failed to parse webhook JSON body after verification:",
      parseError
    );
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  // --- End JSON Parsing ---

  // Destructure data from the PARSED body
  const {
    payment_status,
    order_id, // This is OUR referenceId
    pay_amount,
    price_amount,
    price_currency,
    payment_id,
    payin_hash,
    // ... other fields
  } = webhookData;

  if (!order_id) {
    console.error("Webhook missing order_id (referenceId).");
    return res.status(400).json({ message: "Missing order_id" });
  }

  try {
    // Find our corresponding transaction record
    const tx = await Transaction.findOne({ referenceId: order_id });
    if (!tx) {
      console.warn(
        `Transaction not found for referenceId (order_id): ${order_id}. Acknowledging webhook.`
      );
      // Return 200 OK even if not found
      return res
        .status(200)
        .json({ message: "Transaction not found, webhook acknowledged." });
    }

    // Update transaction metadata
    tx.metadata.paymentStatusNowPayments = payment_status;
    tx.metadata.amountPaidCrypto = pay_amount; // Actual amount paid in crypto
    tx.metadata.priceAmount = price_amount; // Original amount requested
    tx.metadata.priceCurrency = price_currency;
    tx.metadata.paymentIdNowPayments = payment_id;
    tx.metadata.payinHash = payin_hash;
    tx.metadata.webhookReceivedAt = new Date();
    tx.metadata.webhookVerified = isVerified; // Record if signature was OK

    let sendNotifications = false;
    let userFriendlyBotName =
      tx.metadata.botName || tx.metadata.botId || "Unknown Bot"; // Use name if available

    // --- Handle Payment Status ---
    if (["confirmed", "sending", "finished"].includes(payment_status)) {
      // 'finished' is the most reliable success state
      if (tx.status !== "approved") {
        console.log(
          `Processing successful payment for Transaction ${tx.referenceId} (User: ${tx.userId}, Bot: ${userFriendlyBotName})`
        );
        tx.status = "approved";

        const botId = tx.metadata.botId;
        const userId = tx.userId;

        if (!botId || !userId) {
          console.error(
            `Transaction ${tx.referenceId} is missing botId or userId in metadata.`
          );
          tx.status = "rejected";
          tx.metadata.error = "Webhook Error: Missing botId/userId in metadata";
        } else {
          // Fetch Bot template *once*
          const botTemplate = await Bot.findById(botId);
          if (!botTemplate) {
            console.error(
              `Bot template ${botId} not found while processing payment ${tx.referenceId}. Cannot activate instance.`
            );
            tx.status = "rejected";
            tx.metadata.error = `Webhook Error: Bot template ${botId} not found.`;
          } else {
            // Find existing or prepare new instance data
            let botInstance = await BotInstance.findOne({
              userId: userId,
              botId: botId,
            });
            const now = new Date();
            let newExpiryDate;
            let isNewInstance = false;

            if (botInstance) {
              // Update existing
              console.log(
                `Updating existing BotInstance ${botInstance._id} from webhook ${order_id}`
              );
              botInstance.accountType = "paid";
              botInstance.active = true;
              const currentExpiry = botInstance.expiryDate || now;
              newExpiryDate = new Date(
                Math.max(now.getTime(), currentExpiry.getTime())
              );
              newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
              botInstance.expiryDate = newExpiryDate;
              // Optional: Reset config to template default on renewal? Decide this.
              // botInstance.config = botTemplate.defaultConfig || {};
            } else {
              // Create new
              console.log(`Creating new BotInstance from webhook ${order_id}`);
              isNewInstance = true;
              newExpiryDate = new Date(now);
              newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
              botInstance = new BotInstance({
                userId: userId,
                botId: botId,
                apiKey: "",
                apiSecretKey: "", // Keys must be added by user
                active: true,
                accountType: "paid",
                purchaseDate: now,
                expiryDate: newExpiryDate,
                strategy: botTemplate.defaultStrategy, // From template
                exchange: "BINANCE", // TODO: Make configurable during purchase/settings?
                running: false,
                config: botTemplate.defaultConfig || {}, // From template
              });
            }
            await botInstance.save(); // Save changes
            console.log(
              `BotInstance ${botInstance._id} ${
                isNewInstance ? "created" : "updated"
              }. New Expiry: ${newExpiryDate}`
            );
            sendNotifications = true;
            tx.metadata.processedInstanceId = botInstance._id;
          }
        }
      } else {
        console.log(
          `Transaction ${tx.referenceId} already approved. Skipping activation logic.`
        );
      }
    } else if (["failed", "refunded", "expired"].includes(payment_status)) {
      if (tx.status !== "rejected") {
        console.log(
          `Processing failed/rejected payment for Transaction ${tx.referenceId}. Status: ${payment_status}`
        );
        tx.status = "rejected";
      }
    } else {
      console.log(
        `Webhook for Tx ${tx.referenceId} with status: ${payment_status}. Awaiting final status.`
      );
    }

    await tx.save(); // Save updated transaction

    // --- Send Notifications Only Once on Approval ---
    if (sendNotifications && tx.status === "approved") {
      const user = await User.findById(tx.userId).select("email telegramId");
      const botInstance = await BotInstance.findById(
        tx.metadata.processedInstanceId
      ).select("expiryDate");
      const expiryDateString =
        botInstance?.expiryDate?.toLocaleDateString() || "N/A";
      if (user) {
        // Send Email...
        if (user.email && process.env.SMTP_HOST) {
          try {
            await sendBotSuccessEmail(user.email, userFriendlyBotName);
          } catch (e) {
            console.error("Email Error:", e);
          }
        }
        // Send Telegram...
        if (user.telegramId && process.env.TELEGRAM_BOT_TOKEN) {
          try {
            await sendTelegramMessage(
              user.telegramId,
              `🚀 Payment confirmed! Your *${userFriendlyBotName}* bot subscription is active until ${expiryDateString}.\n\n➡️ *NEXT STEP:* Please add your exchange API keys in the dashboard to start trading: ${FRONTEND_URL}/dashboard`
            );
          } catch (e) {
            console.error("Telegram Error:", e);
          }
        }
      }
    }

    res.status(200).json({ message: "Webhook received and processed." });
  } catch (err) {
    console.error("❌ Webhook Processing Error:", err.message, err.stack);
    res
      .status(500)
      .json({ message: "Internal server error processing webhook." });
  }
};

// 🔹 Get Payment Status (For Frontend Polling)
exports.getPaymentStatus = async (req, res) => {
  const operation = "getPaymentStatus";
  const { ref } = req.query;

  // Ensure user is authenticated and req.userDB is populated by middleware
  if (!req.userDB || !req.userDB._id) {
    logger.error({
      operation,
      message: "Authentication missing in getPaymentStatus",
    });
    return res.status(401).json({ message: "Authentication required." });
  }
  const userId = req.userDB._id;

  if (!ref) {
    logger.warn({ operation, message: "Missing reference ID", userId });
    return res
      .status(400)
      .json({ message: "Missing transaction reference ID." });
  }

  try {
    logger.info({
      operation,
      message: "Fetching payment status",
      referenceId: ref,
      userId,
    });
    const tx = await Transaction.findOne({
      referenceId: ref,
      userId: userId, // Ensure user owns this transaction
    }).select(
      // Select necessary fields, including the one holding the instance ID
      "referenceId status amount createdAt metadata.botId metadata.botName metadata.paymentStatusNowPayments metadata.paymentUrl metadata.processedInstanceId"
      // Removed exclusion of sensitive fields, assuming they are not needed or handled by model's toJSON if necessary
    );

    if (!tx) {
      logger.warn({
        operation,
        message: "Transaction not found or access denied",
        referenceId: ref,
        userId,
      });
      return res
        .status(404)
        .json({ message: "Transaction not found or access denied." });
    }

    // --- Construct the response ---
    const responseData = {
      referenceId: tx.referenceId,
      status: tx.status, // Our internal status ('pending', 'approved', 'rejected')
      botId: tx.metadata?.botId, // Use optional chaining
      botName: tx.metadata?.botName, // Use optional chaining
      amount: tx.amount,
      createdAt: tx.createdAt,
      paymentStatusNowPayments: tx.metadata?.paymentStatusNowPayments, // Use optional chaining
      paymentUrl: tx.status === "pending" ? tx.metadata?.paymentUrl : undefined, // Use optional chaining

      // --- Include botInstanceId only if status is approved ---
      botInstanceId:
        tx.status === "approved" ? tx.metadata?.processedInstanceId : undefined,
      // --------------------------------------------------------
    };

    logger.info({
      operation,
      message: "Payment status retrieved successfully",
      referenceId: ref,
      userId,
      responseStatus: responseData.status,
      hasInstanceId: !!responseData.botInstanceId,
    });
    res.json(responseData);
  } catch (err) {
    logger.error({
      operation,
      message: "Error fetching payment status",
      referenceId: ref,
      userId,
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Error retrieving payment status." });
  }
};
