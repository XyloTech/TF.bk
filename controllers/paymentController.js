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
const { processReferralReward } = require("../services/rewardService");
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
  const operation = "nowPaymentsWebhook";
  // --- Verification Step ---
  const signature = req.headers["x-nowpayments-sig"];
  const isVerified = verifyNowPaymentsSignature(
    req.body,
    signature,
    NOWPAYMENTS_IPN_SECRET
  );

  // --- STRICT Check in Production ---
  if (!isVerified && process.env.NODE_ENV === "production") {
    logger.error({
      operation,
      message: "Webhook verification FAILED in production. Rejecting request.",
    });
    return res.status(403).json({ message: "Invalid signature" });
  } else if (!isVerified) {
    logger.warn({
      operation,
      message:
        "Webhook verification failed/skipped (NODE_ENV!=production or missing secret). Processing anyway for testing.",
    });
  }
  // --- End Verification Step ---

  // --- Parse the JSON body AFTER verification ---
  let webhookData;
  try {
    webhookData = JSON.parse(req.body.toString());
    logger.info({
      operation,
      message: "Received Verified/Processed NowPayments Webhook (Body Parsed)",
      data: webhookData,
    });
  } catch (parseError) {
    logger.error({
      operation,
      message: "Failed to parse webhook JSON body after verification:",
      error: parseError,
    });
    return res.status(400).json({ message: "Invalid JSON body" });
  }
  // --- End JSON Parsing ---

  const {
    payment_status,
    order_id, // Our referenceId
    pay_amount,
    price_amount,
    price_currency,
    payment_id,
    payin_hash,
  } = webhookData;

  if (!order_id) {
    logger.error({
      operation,
      message: "Webhook missing order_id (referenceId).",
    });
    return res.status(400).json({ message: "Missing order_id" });
  }

  try {
    const tx = await Transaction.findOne({ referenceId: order_id });
    if (!tx) {
      logger.warn({
        operation,
        message: `Transaction not found for referenceId: ${order_id}. Acknowledging webhook.`,
        referenceId: order_id,
      });
      return res
        .status(200)
        .json({ message: "Transaction not found, webhook acknowledged." });
    }

    // --- Prevent processing non-pending transactions multiple times ---
    if (tx.status !== "pending") {
      logger.info({
        operation,
        referenceId: tx.referenceId,
        message: `Transaction status is already '${tx.status}'. Skipping webhook processing.`,
      });
      return res.status(200).json({
        message: `Transaction already processed (${tx.status}). Webhook acknowledged.`,
      });
    }

    // Update transaction metadata
    tx.metadata.paymentStatusNowPayments = payment_status;
    tx.metadata.amountPaidCrypto = pay_amount;
    tx.metadata.priceAmount = price_amount;
    tx.metadata.priceCurrency = price_currency;
    tx.metadata.paymentIdNowPayments = payment_id;
    tx.metadata.payinHash = payin_hash;
    tx.metadata.webhookReceivedAt = new Date();
    tx.metadata.webhookVerified = isVerified;

    let sendNotifications = false;
    let userFriendlyBotName =
      tx.metadata.botName || tx.metadata.botId || "Unknown Bot";
    let requiresReferralCheck = false; // <<<<<==== **** INITIALIZE THE FLAG HERE ****

    // --- Handle Payment Status ---
    if (["confirmed", "sending", "finished"].includes(payment_status)) {
      // Check if already processed (Important for Idempotency)
      if (tx.status !== "approved") {
        logger.info({
          operation,
          message: `Processing successful payment for Transaction ${tx.referenceId}`,
          userId: tx.userId,
          bot: userFriendlyBotName,
        });
        tx.status = "approved";
        requiresReferralCheck = true;

        const botId = tx.metadata.botId;
        const userId = tx.userId;

        if (!botId || !userId) {
          logger.error({
            operation,
            message: `Transaction ${tx.referenceId} missing botId or userId`,
            transactionId: tx.referenceId,
          });
          tx.status = "rejected"; // Revert status if crucial info missing
          tx.metadata.error = "Webhook Error: Missing botId/userId in metadata";
          requiresReferralCheck = false; // <<<<<==== Reset flag if error
        } else {
          const botTemplate = await Bot.findById(botId);
          if (!botTemplate) {
            logger.error({
              operation,
              message: `Bot template ${botId} not found for payment ${tx.referenceId}.`,
              botId: botId,
              transactionId: tx.referenceId,
            });
            tx.status = "rejected"; // Revert status if template missing
            tx.metadata.error = `Webhook Error: Bot template ${botId} not found.`;
            requiresReferralCheck = false; // <<<<<==== Reset flag if error
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
              /* Update existing */
              logger.info({
                operation,
                message: `Updating existing BotInstance ${botInstance._id}`,
                instanceId: botInstance._id,
                transactionId: order_id,
              });
              botInstance.accountType = "paid";
              botInstance.active = true;
              const currentExpiry = botInstance.expiryDate || now;
              newExpiryDate = new Date(
                Math.max(now.getTime(), currentExpiry.getTime())
              );
              newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
              botInstance.expiryDate = newExpiryDate;
            } else {
              /* Create new */
              logger.info({
                operation,
                message: `Creating new BotInstance from webhook`,
                transactionId: order_id,
              });
              isNewInstance = true;
              newExpiryDate = new Date(now);
              newExpiryDate.setMonth(newExpiryDate.getMonth() + 1);
              botInstance = new BotInstance({
                /* ... instance details ... */
              });
            }
            await botInstance.save();
            logger.info({
              operation,
              message: `BotInstance ${botInstance._id} ${
                isNewInstance ? "created" : "updated"
              }`,
              expiry: newExpiryDate,
              instanceId: botInstance._id,
            });
            sendNotifications = true;
            tx.metadata.processedInstanceId = botInstance._id;
          }
        }
      } else {
        logger.info({
          operation,
          message: `Transaction ${tx.referenceId} already approved. Skipping activation.`,
          transactionId: tx.referenceId,
        });
      }
    } else if (["failed", "refunded", "expired"].includes(payment_status)) {
      if (tx.status !== "rejected") {
        logger.info({
          operation,
          message: `Processing failed/rejected payment Tx ${tx.referenceId}`,
          status: payment_status,
          transactionId: tx.referenceId,
        });
        tx.status = "rejected";
      }
    } else {
      logger.info({
        operation,
        message: `Webhook for Tx ${tx.referenceId} status: ${payment_status}. Awaiting final status.`,
        status: payment_status,
        transactionId: tx.referenceId,
      });
    }

    // Save updated transaction status *before* triggering dependent actions
    await tx.save();
    logger.info({
      operation,
      message: `Transaction ${tx.referenceId} saved with status ${tx.status}`,
    });

    if (requiresReferralCheck && tx.status === "approved") {
      logger.info({
        operation,
        message: `Transaction approved, attempting referral reward processing...`,
        userId: tx.userId,
        transactionId: tx.referenceId,
        amount: tx.amount,
      });
      // Call the function
      await processReferralReward(
        tx.userId.toString(), // The user who paid (referred user)
        tx.amount, // The amount of the transaction
        tx.referenceId // Optional actionId for logging
      );
      logger.info({
        operation,
        message: `Referral reward processing attempted for ${tx.referenceId}`,
      }); // Log completion/attempt
    }

    // --- Send Notifications Only Once on Approval ---
    if (sendNotifications && tx.status === "approved") {
      // ... (Your existing notification logic) ...
      const user = await User.findById(tx.userId).select("email telegramId");
      const botInstance = await BotInstance.findById(
        tx.metadata.processedInstanceId
      ).select("expiryDate");
      const expiryDateString =
        botInstance?.expiryDate?.toLocaleDateString() || "N/A";
      if (user) {
        const notificationMessage = `Payment confirmed! Your ${userFriendlyBotName} bot subscription is active until ${expiryDateString}.`;
        const notificationType = "bot_status"; // Or 'payment_success' etc. Ensure this matches your Enum

        try {
          // Create persistent notification in DB
          await Notification.create({
            userId: tx.userId,
            message: notificationMessage,
            type: notificationType, // Use a relevant type from your Enum
            // 'read' defaults to false
          });
          logger.info({
            operation,
            message: `Created DB notification for user ${tx.userId} for tx ${tx.referenceId}`,
          });

          // Send real-time notification via Socket.IO
          sendNotification(
            tx.userId.toString(),
            notificationType,
            notificationMessage
          );
        } catch (notificationError) {
          logger.error({
            operation,
            message: `Failed to create/send notification for user ${tx.userId} / tx ${tx.referenceId}`,
            error: notificationError.message,
            userId: tx.userId,
            transactionId: tx.referenceId,
          });
          // Decide if this error is critical. Usually, it's okay to continue
          // even if notification fails, as the core bot activation succeeded.
        }
        if (user.email && process.env.SMTP_HOST) {
          try {
            await sendBotSuccessEmail(user.email, userFriendlyBotName);
          } catch (e) {
            logger.error({ operation: "emailSendError", error: e });
          }
        }
        if (user.telegramId && process.env.TELEGRAM_BOT_TOKEN) {
          try {
            await sendTelegramMessage(
              user.telegramId,
              `✅ ${notificationMessage}\n\n➡️ *NEXT STEP:* Please add your exchange API keys in the dashboard to start trading: ${FRONTEND_URL}/dashboard`
            );
          } catch (e) {
            logger.error({ operation: "telegramSendError", error: e });
          }
        }
      } else {
        logger.warn({
          operation,
          message: `User ${tx.userId} not found when trying to send notifications for tx ${tx.referenceId}`,
        });
      }
    }

    res.status(200).json({ message: "Webhook received and processed." });
  } catch (err) {
    logger.error({
      operation,
      message: "Webhook Processing Error",
      error: err.message,
      stack: err.stack,
      referenceId: order_id,
    });
    res
      .status(500)
      .json({ message: "Internal server error processing webhook." });
  }
};
exports.getPaymentStatus = async (req, res) => {
  // ... (implementation as provided previously) ...
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
