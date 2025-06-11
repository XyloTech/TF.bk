// controllers/paymentController.js
const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const BotInstance = require("../models/BotInstance");
const Bot = require("../models/Bot");
const { sendGenericSuccessEmail } = require("../utils/email");
const { sendTelegramMessage } = require("../utils/telegram");
const { processReferralReward } = require("../services/rewardService");
const logger = require("../utils/logger");
const Notification = require("../models/Notification");
const { sendNotification } = require("../socket");

// --- Constants ---
const TRANSACTION_TYPES = {
  BOT_PURCHASE: "bot_purchase",
  BALANCE_RECHARGE: "balance_recharge",
  PAYOUT: "payout",
  // Add other types from your Transaction model enum if needed elsewhere in this controller
};

const PAYMENT_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  // Consider: "NEEDS_ATTENTION" if a payment is approved but provisioning fails partially
};

const NOWPAYMENTS_STATUS = {
  CONFIRMED: "confirmed",
  SENDING: "sending",
  FINISHED: "finished",
  FAILED: "failed",
  REFUNDED: "refunded",
  EXPIRED: "expired",
  // Add any other statuses NowPayments might send
};
const PAYOUT_STATUS = {
  WAITING: "WAITING",
  PROCESSING: "PROCESSING",
  SENT: "SENT",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

// --- Environment Variable Checks & Configuration ---
if (!process.env.NOWPAYMENTS_API_KEY) {
  logger.fatal(
    "FATAL ERROR: NOWPAYMENTS_API_KEY is not set in .env. Payment creation will fail."
  );
  // process.exit(1); // Uncomment in production if this is truly fatal for app startup
}
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
if (!NOWPAYMENTS_IPN_SECRET) {
  const message =
    "NOWPAYMENTS_IPN_SECRET is not set. Webhook verification WILL BE INSECURE.";
  if (process.env.NODE_ENV === "production") {
    logger.fatal(
      `FATAL ERROR: ${message} This is unacceptable for production.`
    );
    // process.exit(1); // Uncomment in production
  } else {
    logger.error(
      `CRITICAL WARNING: ${message} OK for local dev only if you understand the risk.`
    );
  }
}
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:5000"; // For self-reference if needed
const MIN_RECHARGE_AMOUNT = parseFloat(process.env.MIN_RECHARGE_AMOUNT) || 1; // Default to $1

// --- Helper Function for Currency Formatting ---
function formatCurrency(value, currency = "USD") {
  if (typeof value !== "number" || isNaN(value)) {
    value = 0;
  }
  // Using toLocaleString for potentially better localization if needed in future
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// --- Helper Function for NowPayments Signature Verification ---
function verifyNowPaymentsSignature(rawBody, signatureHeader, secret) {
  const operation = "verifyNowPaymentsSignature";
  if (!signatureHeader) {
    logger.error({
      operation,
      message: "Verification failed: Missing 'x-nowpayments-sig' header.",
    });
    return false;
  }
  if (!secret) {
    // This case should ideally be caught by startup checks, but as a safeguard:
    logger.error({
      operation,
      message:
        "Verification failed: NOWPAYMENTS_IPN_SECRET is not configured. Cannot verify.",
    });
    return false; // Always fail if secret is missing, regardless of environment.
  }
  if (
    rawBody === undefined ||
    rawBody === null ||
    typeof rawBody.toString !== "function"
  ) {
    logger.error({
      operation,
      message: "Verification failed: rawBody is missing or invalid.",
    });
    return false;
  }

  try {
    const hmac = crypto.createHmac("sha512", secret);
    const calculatedSignature = hmac
      .update(rawBody.toString("utf8"))
      .digest("hex"); // Ensure rawBody is string for HMAC

    const trusted = Buffer.from(calculatedSignature, "utf8");
    const untrusted = Buffer.from(signatureHeader, "utf8");

    if (
      trusted.length !== untrusted.length ||
      !crypto.timingSafeEqual(trusted, untrusted)
    ) {
      logger.warn({
        operation,
        message: "Invalid NowPayments webhook signature.",
        received: signatureHeader,
        calculated: calculatedSignature,
      });
      return false;
    }
    logger.info({
      operation,
      message: "NowPayments webhook signature verified successfully.",
    });
    return true;
  } catch (error) {
    logger.error({
      operation,
      message: "Error during NowPayments signature verification",
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

// ! --------------------------------------------------------------------------

exports.validateAddress = async (req, res) => {
  const operation = "validateAddress";
  const { address, currency } = req.body;
  const requestingUser = req.userDB;
  console.log("validateAddress request body: ", req.body);

  // Input validation
  if (!address || !currency) {
    logger.warn({
      operation,
      message: "Missing required fields: address or currency",
      userId: requestingUser._id,
      providedData: { address: !!address, currency: !!currency },
    });
    return res.status(400).json({
      message: "Address and currency are required fields.",
    });
  }

  if (typeof address !== "string" || typeof currency !== "string") {
    logger.warn({
      operation,
      message: "Invalid data types for address or currency",
      userId: requestingUser._id,
    });
    return res.status(400).json({
      message: "Address and currency must be strings.",
    });
  }

  try {
    logger.info({
      operation,
      message: `Validating address for user ${requestingUser._id}`,
      currency,
      address: address.substring(0, 10) + "...", // Log partial address for privacy
    });

    const nowPaymentsPayload = {
      address: address.trim(),
      currency: currency.toLowerCase().trim(),
      extra_id: null,
    };

    const nowRes = await axios.post(
      "https://api.nowpayments.io/v1/payout/validate-address",
      nowPaymentsPayload,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    logger.info({
      operation,
      message: "Address validation successful",
      userId: requestingUser._id,
      currency,
      isValid: nowRes.data.status || nowRes.status === 200,
    });

    res.status(200).json({
      valid: nowRes.data.status !== false,
      currency: currency.toLowerCase(),
      address: address,
      extra_id: null,
      nowpayments_response: nowRes.data,
    });
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Address validation error",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      userId: requestingUser._id,
      currency,
    });

    // If it's a validation error from NowPayments (400), return structured response
    if (statusCode === 400) {
      return res.status(200).json({
        valid: false,
        currency: currency.toLowerCase(),
        address: address,
        extra_id: null,
        error: errMsg,
        nowpayments_response: err.response?.data,
      });
    }

    res.status(statusCode >= 400 && statusCode < 500 ? statusCode : 500).json({
      message: errMsg || "Failed to validate address. Please try again later.",
    });
  }
};
// ! --------------------------------------------------------------------------

// 🔹 Create NowPayments Invoice for BOT PURCHASE
exports.createBotPurchasePayment = async (req, res) => {
  const operation = "createBotPurchasePayment";
  const { amount, botId, userIdToCredit } = req.body;
  const requestingUser = req.userDB;
  const targetUserId = userIdToCredit || requestingUser._id.toString();

  const clientAmount = parseFloat(amount);
  if (isNaN(clientAmount) || clientAmount <= 0) {
    logger.warn({
      operation,
      message: "Invalid payment amount from client.",
      clientAmount,
      targetUserId,
      requestingUserId: requestingUser._id,
    });
    return res
      .status(400)
      .json({ message: "Invalid payment amount provided." });
  }

  let botTemplate;
  try {
    if (
      !botId ||
      typeof botId !== "string" ||
      !mongoose.Types.ObjectId.isValid(botId)
    ) {
      logger.warn({
        operation,
        message: "Invalid Bot ID provided for purchase.",
        targetUserId,
        botIdProvided: botId,
      });
      return res
        .status(400)
        .json({ message: "Valid Bot ID is required for purchase." });
    }
    botTemplate = await Bot.findById(botId);
    if (!botTemplate) {
      logger.warn({
        operation,
        message: `Bot template ${botId} not found.`,
        targetUserId,
      });
      return res
        .status(404)
        .json({ message: `Bot template with ID ${botId} not found.` });
    }
    if (
      parseFloat(botTemplate.price.toFixed(2)) !==
      parseFloat(clientAmount.toFixed(2))
    ) {
      logger.warn({
        operation,
        message: `Price mismatch for bot ${botId}. Client: ${clientAmount}, DB: ${botTemplate.price}`,
        userId: targetUserId,
        botId,
      });
      return res
        .status(400)
        .json({ message: "Bot price mismatch. Please refresh and try again." });
    }
  } catch (err) {
    logger.error({
      operation,
      message: "Error fetching/validating Bot template",
      error: err.message,
      stack: err.stack,
      botId,
      targetUserId,
    });
    return res
      .status(500)
      .json({ message: "An error occurred while validating bot information." });
  }

  try {
    const referenceId = uuidv4();
    const orderDescription = `Subscription for ${
      botTemplate.name || `Bot ID: ${botId}`
    }`;
    logger.info({
      operation,
      message: `Creating invoice for Bot Purchase. User: ${targetUserId}, Bot: ${botId}, Amount: ${botTemplate.price}, Ref: ${referenceId}`,
    });

    const nowPaymentsPayload = {
      price_amount: botTemplate.price,
      price_currency: "usd",
      order_id: referenceId,
      order_description: orderDescription,
      ipn_callback_url: `${API_BASE_URL}/api/payments/webhook`, // Recommended to use API base URL
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
      amount: botTemplate.price,
      transactionType: TRANSACTION_TYPES.BOT_PURCHASE,
      paymentMethod: "crypto",
      status: PAYMENT_STATUS.PENDING,
      referenceId: referenceId,
      metadata: {
        botId: botTemplate._id.toString(),
        botName: botTemplate.name,
        botPriceAtPurchase: botTemplate.price,
        feeCreditPercentageApplied: botTemplate.feeCreditPercentage,
        durationMonthsApplied: botTemplate.durationMonths,
        invoiceId: invoice.id,
        paymentUrl: invoice.invoice_url,
        requestingUserId: requestingUser._id.toString(),
      },
    });
    await tx.save();
    logger.info({
      operation,
      message: `Transaction ${referenceId} (${PAYMENT_STATUS.PENDING}) created for Bot Purchase. Invoice: ${invoice.id}`,
      targetUserId,
    });

    res
      .status(200)
      .json({ invoice_url: invoice.invoice_url, referenceId: referenceId });
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    logger.error({
      operation,
      message: "Bot Purchase Invoice Creation Error",
      error: errMsg,
      errorFull: err.response?.data || err,
      stack: err.stack,
      targetUserId,
    });
    res.status(500).json({
      message:
        errMsg || "Failed to create payment invoice. Please try again later.",
    });
  }
};

// 🔹 Create NowPayments Invoice for ACCOUNT RECHARGE
exports.createRechargePayment = async (req, res) => {
  const operation = "createRechargePayment";
  const {
    amount,
    currency,
    order_description,
    userIdToCredit,
    case: paymentCase,
  } = req.body;
  console.log("request body: ", req.body);
  const requestingUser = req.userDB;
  const targetUserId = userIdToCredit || requestingUser._id.toString();

  // Optionally validate the 'case' field
  if (paymentCase && paymentCase !== "recharge") {
    return res.status(400).json({ message: "Invalid payment case." });
  }

  const rechargeAmount = parseFloat(amount);
  const payCurrency = (currency || "usd").toLowerCase();

  if (isNaN(rechargeAmount) || rechargeAmount < MIN_RECHARGE_AMOUNT) {
    logger.warn({
      operation,
      message: `Invalid recharge amount: ${rechargeAmount}. Min: ${MIN_RECHARGE_AMOUNT}`,
      targetUserId,
      requestingUserId: requestingUser._id,
    });
    return res.status(400).json({
      message: `Invalid recharge amount. Minimum is ${formatCurrency(
        MIN_RECHARGE_AMOUNT
      )}.`,
    });
  }

  try {
    const referenceId = uuidv4();
    const orderDescription =
      order_description ||
      `Account Balance Recharge: ${formatCurrency(
        rechargeAmount,
        payCurrency.toUpperCase()
      )}`;
    logger.info({
      operation,
      message: `Creating invoice for Account Recharge. User: ${targetUserId}, Amount: ${rechargeAmount}, Ref: ${referenceId}`,
    });

    const nowPaymentsPayload = {
      price_amount: rechargeAmount,
      price_currency: "usd",
      pay_currency: payCurrency, // Dynamically set pay_currency based on request
      order_id: referenceId,
      order_description: orderDescription,
      ipn_callback_url: `${API_BASE_URL}/api/payments/webhook`,
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
      amount: rechargeAmount,
      transactionType: TRANSACTION_TYPES.BALANCE_RECHARGE,
      paymentMethod: "crypto",
      status: PAYMENT_STATUS.PENDING,
      referenceId: referenceId,
      metadata: {
        description: orderDescription,
        invoiceId: invoice.id,
        paymentUrl: invoice.invoice_url,
        requestingUserId: requestingUser._id.toString(),
        currency: payCurrency,
      },
    });
    await tx.save();
    logger.info({
      operation,
      message: `Transaction ${referenceId} (${PAYMENT_STATUS.PENDING}) created for Account Recharge. Invoice: ${invoice.id}`,
      targetUserId,
    });

    res
      .status(200)
      .json({ invoice_url: invoice.invoice_url, referenceId: referenceId });
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    logger.error({
      operation,
      message: "Recharge Invoice Creation Error",
      error: errMsg,
      errorFull: err.response?.data || err,
      stack: err.stack,
      targetUserId,
    });
    res.status(500).json({
      message:
        errMsg || "Failed to create payment invoice. Please try again later.",
    });
  }
};

// --- Private Helper Function for Webhook Successful Payment Processing ---
async function _processSuccessfulPayment(tx, webhookData, user) {
  const operation = "webhook._processSuccessfulPayment";
  let amountToCreditToFeeBalance = 0;
  let notificationMessage = "";
  let userFriendlyName = "";
  let botActivationError = null; // To track errors during bot provisioning

  // Determine amount to credit and initial notification message
  if (tx.transactionType === TRANSACTION_TYPES.BALANCE_RECHARGE) {
    amountToCreditToFeeBalance = tx.amount;
    userFriendlyName = "Account Balance";
    notificationMessage = `Your account balance has been successfully recharged by ${formatCurrency(
      tx.amount
    )}.`;
    logger.info({
      operation,
      userId: user._id,
      txId: tx._id,
      message: `Processing full amount ${tx.amount} for balance_recharge.`,
    });
  } else if (tx.transactionType === TRANSACTION_TYPES.BOT_PURCHASE) {
    const feeCreditPercentage = tx.metadata.feeCreditPercentageApplied || 0;
    amountToCreditToFeeBalance = tx.amount * feeCreditPercentage;
    const platformShare = tx.amount * (1 - feeCreditPercentage);

    userFriendlyName = tx.metadata.botName || "Your Bot";
    let creditMsgPart =
      amountToCreditToFeeBalance > 0
        ? `${formatCurrency(amountToCreditToFeeBalance)} added to fee balance.`
        : "Subscription activated.";
    notificationMessage = `Payment for ${userFriendlyName} confirmed! ${creditMsgPart}`;

    logger.info({
      operation,
      userId: user._id,
      txId: tx._id,
      message: `Bot purchase: total ${
        tx.amount
      }, crediting ${amountToCreditToFeeBalance} (at ${
        feeCreditPercentage * 100
      }%) to balance. Platform share: ${platformShare}.`,
    });

    // --- Bot Activation Logic ---
    const botIdToActivate = tx.metadata.botId;
    const durationMonths = tx.metadata.durationMonthsApplied || 1;

    if (!botIdToActivate) {
      botActivationError =
        "BotId missing in transaction metadata. Cannot activate bot.";
      logger.error({ operation, message: botActivationError, txId: tx._id });
    } else {
      const botTemplate = await Bot.findById(botIdToActivate).select(
        "name defaultStrategy defaultConfig"
      ); // Ensure fields exist
      if (!botTemplate) {
        botActivationError = `Bot template ${botIdToActivate} not found during activation.`;
        logger.error({
          operation,
          message: botActivationError,
          txId: tx._id,
          botId: botIdToActivate,
        });
      } else {
        let botInstance = await BotInstance.findOne({
          userId: user._id,
          botId: botIdToActivate,
        });
        const now = new Date();
        let newExpiryDate;
        let isNewInstance = false;

        if (botInstance) {
          logger.info({
            operation,
            message: `Updating existing BotInstance ${botInstance._id} for tx ${tx.referenceId}`,
          });
          botInstance.active = true;
          botInstance.accountType = "paid";
          const currentExpiry =
            botInstance.expiryDate && botInstance.expiryDate > now
              ? botInstance.expiryDate
              : now;
          newExpiryDate = new Date(currentExpiry);
          newExpiryDate.setMonth(newExpiryDate.getMonth() + durationMonths);
          botInstance.expiryDate = newExpiryDate;
        } else {
          logger.info({
            operation,
            message: `Creating new BotInstance for tx ${tx.referenceId}, botId: ${botIdToActivate}`,
          });
          isNewInstance = true;
          newExpiryDate = new Date(now);
          newExpiryDate.setMonth(newExpiryDate.getMonth() + durationMonths);
          botInstance = new BotInstance({
            userId: user._id,
            botId: botIdToActivate,
            botName: botTemplate.name,
            strategy: botTemplate.defaultStrategy,
            config: botTemplate.defaultConfig || {}, // Ensure defaultConfig exists on Bot model
            purchaseDate: now,
            expiryDate: newExpiryDate,
            accountType: "paid",
            active: true, // User will need to add API keys, exchange, etc.
            // apiKey, apiSecretKey, exchange: to be set by user via UI
          });
        }
        try {
          await botInstance.save();
          tx.metadata.processedInstanceId = botInstance._id.toString();
          const expiryDateString =
            botInstance.expiryDate?.toLocaleDateString() || "N/A";
          notificationMessage += ` Your subscription is active until ${expiryDateString}.`;
          logger.info({
            operation,
            message: `BotInstance ${botInstance._id} ${
              isNewInstance ? "created" : "updated"
            }. Expiry: ${expiryDateString}`,
          });
        } catch (instanceSaveError) {
          botActivationError = `Failed to save BotInstance ${
            botInstance._id ? botInstance._id : "new"
          }: ${instanceSaveError.message}`;
          logger.error({
            operation,
            message: botActivationError,
            error: instanceSaveError,
            stack: instanceSaveError.stack,
          });
        }
      }
    }
  } else {
    logger.error({
      operation,
      message: `Unknown transactionType '${tx.transactionType}' for tx ${tx.referenceId}.`,
      txId: tx._id,
    });
    tx.status = PAYMENT_STATUS.REJECTED; // Mark as rejected if type is unknown
    tx.metadata.error =
      (tx.metadata.error || "") +
      ` Unknown transaction type: ${tx.transactionType}`;
    return; // Stop further processing for this transaction
  }

  // If bot activation failed, update transaction and skip balance/notifications
  if (botActivationError) {
    tx.metadata.error =
      (tx.metadata.error || "") +
      ` Bot Activation Error: ${botActivationError}`;
    // Decide if this makes the whole transaction 'rejected' or a special status like 'approved_needs_attention'
    // For simplicity here, if bot activation fails, we might consider the core service not delivered.
    // However, payment was made. This is a business decision.
    // Let's assume for now, we log error, but if payment was taken, user might still expect something or support.
    // We won't update balance if bot activation was the primary goal and it failed.
    logger.warn({
      operation,
      message: `Payment ${tx.referenceId} for ${user._id} processed, but bot activation failed. Details: ${botActivationError}`,
    });
    // tx.status = PAYMENT_STATUS.NEEDS_ATTENTION; // If you have such a status
  } else {
    // Update User Balance if no critical bot activation error OR if it's a pure recharge
    if (amountToCreditToFeeBalance >= 0) {
      // Ensure non-negative credit
      user.accountBalance = parseFloat(
        ((user.accountBalance || 0) + amountToCreditToFeeBalance).toFixed(2)
      );
      try {
        await user.save();
        logger.info({
          operation,
          message: `User ${user._id} balance updated. New balance: ${user.accountBalance}`,
          txId: tx._id,
        });
        // Append new balance to notification if balance was changed
        if (
          amountToCreditToFeeBalance > 0 ||
          tx.transactionType === TRANSACTION_TYPES.BALANCE_RECHARGE
        ) {
          notificationMessage += ` New fee balance: ${formatCurrency(
            user.accountBalance
          )}.`;
        }
      } catch (userSaveError) {
        logger.error({
          operation,
          message: `CRITICAL: Failed to save user ${user._id} balance after payment. Manual intervention required.`,
          error: userSaveError,
          txId: tx._id,
        });
        tx.metadata.error =
          (tx.metadata.error || "") +
          " Critical: Failed to update user balance.";
        // Potentially set tx.status to PAYMENT_STATUS.NEEDS_ATTENTION
        return; // Stop further good-path processing if user balance save fails
      }
    }

    // Process Referral Reward (only if main processing was successful)
    if (tx.amount > 0) {
      logger.info({
        operation,
        message: `Attempting referral reward for tx ${tx.referenceId}, type: ${tx.transactionType}`,
      });
      try {
        await processReferralReward(
          user._id.toString(),
          tx.amount,
          tx.referenceId
        );
      } catch (referralError) {
        logger.error({
          operation,
          message: "Error processing referral reward",
          error: referralError.message,
          txId: tx._id,
        });
        // Non-critical for the payment itself, just log.
      }
    }

    // Send Notifications (only if main processing was successful)
    if (notificationMessage) {
      try {
        await Notification.create({
          userId: user._id,
          message: notificationMessage,
          type: "payment_success",
        });
        sendNotification(user._id.toString(), "payment_success", {
          message: notificationMessage,
          balance: user.accountBalance,
          transactionType: tx.transactionType,
          processedInstanceId: tx.metadata.processedInstanceId,
        });

        if (user.email && process.env.SMTP_HOST) {
          await sendGenericSuccessEmail(
            user.email,
            "Payment Successful",
            notificationMessage
          );
        }
        if (user.telegramId && process.env.TELEGRAM_BOT_TOKEN) {
          let telegramMsg = `✅ ${notificationMessage}`;
          if (
            tx.transactionType === TRANSACTION_TYPES.BOT_PURCHASE &&
            tx.metadata.processedInstanceId
          ) {
            telegramMsg += `\n\n➡️ Configure your new bot: ${FRONTEND_URL}/dashboard/bots/${tx.metadata.processedInstanceId}`;
          }
          await sendTelegramMessage(user.telegramId, telegramMsg);
        }
      } catch (notificationError) {
        logger.error({
          operation,
          message: "Error sending one or more notifications",
          error: notificationError.message,
          txId: tx._id,
        });
      }
    }
  }
}

exports.minimumAmount = async (req, res) => {
  const operation = "minimumAmount";
  try {
    const response = await axios.get(
      "https://api.nowpayments.io/v1/min-amount",
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
        params: {
          currency_from: req.query.currency_from || "btc",
          currency_to: "usd",
          fiat_equivalent: "usd",
          is_fee_paid_by_user: "False",
        },
      }
    );

    // Return all relevant fields as received from NowPayments
    res.status(200).json({
      currency_from: response.data.currency_from,
      currency_to: response.data.currency_to,
      min_amount: response.data.min_amount,
      fiat_equivalent: response.data.fiat_equivalent,
    });
  } catch (err) {
    logger.error({
      operation,
      message: "Error fetching minimum amount from NowPayments",
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Failed to fetch minimum amount." });
  }
};

// 🔹 Handle NowPayments Webhook (IPN - Instant Payment Notification)
exports.nowPaymentsWebhook = async (req, res) => {
  const operation = "nowPaymentsWebhook";

  const signature = req.headers["x-nowpayments-sig"];
  // ASSUMPTION: express.json({ verify: ... }) is set up in server.js to populate req.rawBody
  if (req.rawBody === undefined) {
    logger.error({
      operation,
      message:
        "req.rawBody is undefined. express.json({ verify: ... }) middleware might not be set up correctly for webhook route.",
    });
    return res
      .status(500)
      .json({ message: "Internal server configuration error for webhook." });
  }
  const isVerified = verifyNowPaymentsSignature(
    req.rawBody,
    signature,
    NOWPAYMENTS_IPN_SECRET
  );

  if (!isVerified) {
    // Strict check: If IPN secret is configured, any verification failure is final.
    if (NOWPAYMENTS_IPN_SECRET) {
      logger.error({
        operation,
        message: "Webhook signature verification FAILED. Rejecting request.",
      });
      return res
        .status(403)
        .json({ message: "Invalid signature. Request rejected." });
    }
    // If IPN secret is NOT configured (dev/test only, logged at startup), log and proceed with caution.
    logger.warn({
      operation,
      message:
        "Webhook verification skipped as NOWPAYMENTS_IPN_SECRET is not set. Processing for dev/testing.",
    });
  }

  const webhookData = req.body; // This is the parsed JSON body
  if (
    !webhookData ||
    typeof webhookData !== "object" ||
    Object.keys(webhookData).length === 0
  ) {
    logger.error({
      operation,
      message: "Webhook body is not a valid parsed object or is empty.",
      receivedBodyType: typeof webhookData,
    });
    return res.status(400).json({ message: "Invalid request body format." });
  }
  logger.info({
    operation,
    message: `Received NowPayments Webhook (Signature Verified: ${isVerified})`,
    data: webhookData,
  });

  const { payment_status, order_id } = webhookData; // Basic fields for initial lookup
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

    if (tx.status !== PAYMENT_STATUS.PENDING) {
      logger.info({
        operation,
        referenceId: tx.referenceId,
        message: `Transaction status is already '${tx.status}'. Skipping further processing.`,
      });
      return res.status(200).json({
        message: `Transaction already processed (${tx.status}). Webhook acknowledged.`,
      });
    }

    // Populate metadata from webhook
    tx.metadata.paymentStatusNowPayments = webhookData.payment_status;
    tx.metadata.amountPaidCrypto = webhookData.pay_amount;
    tx.metadata.priceAmountNowPayments = webhookData.price_amount;
    tx.metadata.paymentIdNowPayments = webhookData.payment_id;
    tx.metadata.payinHashNowPayments = webhookData.payin_hash;
    tx.metadata.outcomeAmountNowPayments = webhookData.outcome_amount;
    tx.metadata.outcomeCurrencyNowPayments = webhookData.outcome_currency;
    tx.metadata.webhookReceivedAt = new Date();
    tx.metadata.webhookVerifiedByApp = isVerified; // Our app's verification status

    const successfulStatuses = [
      NOWPAYMENTS_STATUS.CONFIRMED,
      NOWPAYMENTS_STATUS.SENDING,
      NOWPAYMENTS_STATUS.FINISHED,
    ];
    const failedStatuses = [
      NOWPAYMENTS_STATUS.FAILED,
      NOWPAYMENTS_STATUS.REFUNDED,
      NOWPAYMENTS_STATUS.EXPIRED,
    ];

    if (successfulStatuses.includes(payment_status)) {
      if (tx.status !== PAYMENT_STATUS.APPROVED) {
        // Idempotency for our internal status
        tx.status = PAYMENT_STATUS.APPROVED; // Tentatively mark approved
        logger.info({
          operation,
          message: `Tx ${tx.referenceId} approved by webhook (${payment_status}). Processing.`,
          userId: tx.userId,
          type: tx.transactionType,
        });

        const user = await User.findById(tx.userId);
        if (!user) {
          logger.error({
            operation,
            message: `User ${tx.userId} not found for approved tx ${tx.referenceId}. Cannot process.`,
            txId: tx._id,
          });
          tx.status = PAYMENT_STATUS.REJECTED;
          tx.metadata.error =
            (tx.metadata.error || "") +
            " User not found for processing payment.";
        } else {
          await _processSuccessfulPayment(tx, webhookData, user); // This function might modify tx.status or tx.metadata.error
        }
      }
    } else if (failedStatuses.includes(payment_status)) {
      if (tx.status !== PAYMENT_STATUS.REJECTED) {
        tx.status = PAYMENT_STATUS.REJECTED;
        tx.metadata.failureReason =
          webhookData.payment_status_description || payment_status; // Store reason if available
        logger.info({
          operation,
          message: `Tx ${tx.referenceId} status set to ${payment_status} by webhook. Marking rejected.`,
          userId: tx.userId,
        });
      }
    } else {
      logger.info({
        operation,
        message: `Webhook for Tx ${tx.referenceId}, status: ${payment_status}. Awaiting final confirmation.`,
        userId: tx.userId,
      });
      // No change to tx.status, keep it PENDING but update metadata.
    }

    await tx.save();
    logger.info({
      operation,
      message: `Transaction ${tx.referenceId} saved with final status: ${tx.status}.`,
      userId: tx.userId,
    });
    res.status(200).json({ message: "Webhook received and processed." });
  } catch (err) {
    logger.error({
      operation,
      message: "Webhook Global Error",
      error: err.message,
      stack: err.stack,
      referenceId: order_id,
    });
    // For internal errors, if we can't even process the transaction lookup, a 500 is appropriate.
    // If transaction is found but subsequent processing fails, a 200 might still be sent to NowPayments
    // to prevent retries for a persistently failing transaction, while our internal logs capture the issue.
    // However, a 500 does signal to NowPayments that our server had an issue.
    res
      .status(500)
      .json({ message: "Internal server error processing webhook." });
  }
};

// 🔹 Get Payment Status (For Frontend Polling)
exports.getPaymentStatus = async (req, res) => {
  const operation = "getPaymentStatus";
  const { ref } = req.query;

  if (!req.userDB || !req.userDB._id) {
    logger.error({
      operation,
      message: "Authentication missing in getPaymentStatus",
    });
    return res.status(401).json({ message: "Authentication required." });
  }
  const userId = req.userDB._id.toString();

  if (!ref || typeof ref !== "string") {
    logger.warn({
      operation,
      message: "Missing or invalid reference ID for getPaymentStatus",
      userId,
      ref,
    });
    return res
      .status(400)
      .json({ message: "Valid transaction reference ID is required." });
  }

  try {
    const tx = await Transaction.findOne({
      referenceId: ref,
      userId: userId,
    }).select(
      "referenceId status amount transactionType createdAt " +
        "metadata.botId metadata.botName metadata.paymentStatusNowPayments metadata.paymentUrl metadata.processedInstanceId " +
        "metadata.feeCreditPercentageApplied metadata.durationMonthsApplied metadata.description metadata.error" // Include error
    );

    if (!tx) {
      logger.warn({
        operation,
        message: "Transaction not found or access denied for getPaymentStatus",
        referenceId: ref,
        userId,
      });
      return res
        .status(404)
        .json({ message: "Transaction not found or access denied." });
    }

    const responseData = {
      referenceId: tx.referenceId,
      status: tx.status,
      transactionType: tx.transactionType,
      botId: tx.metadata?.botId,
      botName:
        tx.metadata?.botName ||
        (tx.transactionType === TRANSACTION_TYPES.BALANCE_RECHARGE
          ? tx.metadata?.description
          : undefined),
      amount: tx.amount,
      createdAt: tx.createdAt,
      paymentStatusNowPayments: tx.metadata?.paymentStatusNowPayments,
      paymentUrl:
        tx.status === PAYMENT_STATUS.PENDING
          ? tx.metadata?.paymentUrl
          : undefined,
      botInstanceId:
        tx.status === PAYMENT_STATUS.APPROVED &&
        tx.transactionType === TRANSACTION_TYPES.BOT_PURCHASE
          ? tx.metadata?.processedInstanceId
          : undefined,
      feeCreditPercentageApplied:
        tx.transactionType === TRANSACTION_TYPES.BOT_PURCHASE
          ? tx.metadata?.feeCreditPercentageApplied
          : undefined,
      durationMonthsApplied:
        tx.transactionType === TRANSACTION_TYPES.BOT_PURCHASE
          ? tx.metadata?.durationMonthsApplied
          : undefined,
      errorMessage: tx.metadata?.error, // Send error message if any
    };
    logger.info({
      operation,
      message: "Payment status retrieved successfully",
      data: responseData,
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
const mongoose = require("mongoose");
const ObjectId = mongoose.Types.ObjectId;

// --- Withdrawal Fee Endpoint ---
exports.withdrawalFee = async (req, res) => {
  const operation = "withdrawalFee";
  const { currency, amount } = req.query;

  if (!currency || !amount) {
    return res
      .status(400)
      .json({ message: "currency and amount are required query parameters." });
  }

  try {
    const response = await axios.get(
      "https://api.nowpayments.io/v1/payout/fee",
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
        },
        params: {
          currency,
          amount,
        },
      }
    );

    res.status(200).json({
      currency: response.data.currency,
      fee: response.data.fee,
    });
  } catch (err) {
    logger.error({
      operation,
      message: "Error fetching withdrawal fee from NowPayments",
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Failed to fetch withdrawal fee." });
  }
};

// 🔹 Estimate Conversion Price
exports.estimatedPrice = async (req, res) => {
  const operation = "estimatedPrice";
  const { amount, currency_from, currency_to } = req.query;

  if (!amount || !currency_from || !currency_to) {
    return res.status(400).json({
      message:
        "amount, currency_from, and currency_to are required query parameters.",
    });
  }

  try {
    const response = await axios.get("https://api.nowpayments.io/v1/estimate", {
      headers: {
        "x-api-key": process.env.NOWPAYMENTS_API_KEY,
      },
      params: {
        amount,
        currency_from,
        currency_to,
      },
    });

    res.status(200).json({
      currency_from: response.data.currency_from,
      amount_from: response.data.amount_from,
      currency_to: response.data.currency_to,
      estimated_amount: response.data.estimated_amount,
    });
  } catch (err) {
    logger.error({
      operation,
      message: "Error fetching estimated price from NowPayments",
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({ message: "Failed to fetch estimated price." });
  }
};

// Helper to fetch NowPayments Bearer Token
async function getNowPaymentsBearerToken() {
  try {
    const response = await axios.post(
      "https://api.nowpayments.io/v1/auth",
      {
        email: process.env.NOWPAYMENTS_EMAIL,
        password: process.env.NOWPAYMENTS_PASSWORD,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    return response.data.token;
  } catch (err) {
    logger.error({
      operation: "getNowPaymentsBearerToken",
      message: "Failed to fetch NowPayments Bearer token",
      error: err.message,
      stack: err.stack,
    });
    throw new Error("Failed to fetch NowPayments Bearer token");
  }
}

exports.createPayout = async (req, res) => {
  const operation = "createPayout";
  const { withdrawals, ipn_callback_url } = req.body;
  const requestingUser = req.userDB;

  // Input validation
  if (!withdrawals || !Array.isArray(withdrawals) || withdrawals.length === 0) {
    logger.warn({
      operation,
      message: "Invalid or missing withdrawals array",
      userId: requestingUser._id,
    });
    return res.status(400).json({
      message:
        "Withdrawals array is required and must contain at least one withdrawal.",
    });
  }

  // Validate each withdrawal
  const totalAmount = withdrawals.reduce((sum, withdrawal, index) => {
    if (!withdrawal.address || !withdrawal.currency || !withdrawal.amount) {
      throw new Error(
        `Withdrawal ${index + 1}: address, currency, and amount are required.`
      );
    }
    if (typeof withdrawal.amount !== "number" || withdrawal.amount <= 0) {
      throw new Error(
        `Withdrawal ${index + 1}: amount must be a positive number.`
      );
    }
    return sum + withdrawal.amount;
  }, 0);

  try {
    // Check if user has sufficient balance for total payout amount
    const userBalance = requestingUser.accountBalance || 0;

    logger.info({
      operation,
      message: `Creating payout for user ${requestingUser._id}`,
      withdrawalCount: withdrawals.length,
      totalAmount,
      userBalance,
    });

    // Fetch Bearer token dynamically
    const bearerToken = await getNowPaymentsBearerToken();

    // Create reference ID for tracking
    const referenceId = uuidv4();
    const callbackUrl =
      ipn_callback_url || `${API_BASE_URL}/api/payments/payout-webhook`;

    const nowPaymentsPayload = {
      ipn_callback_url: callbackUrl,
      withdrawals: withdrawals.map((w) => ({
        address: w.address.trim(),
        currency: w.currency.toLowerCase().trim(),
        amount: w.amount,
        ipn_callback_url: w.ipn_callback_url || callbackUrl,
        extra_id: w.extra_id || null,
        payout_description:
          w.payout_description || `Payout for user ${requestingUser._id}`,
        unique_external_id:
          w.unique_external_id || `${referenceId}-${Date.now()}`,
      })),
    };

    const nowRes = await axios.post(
      "https://api.nowpayments.io/v1/payout",
      nowPaymentsPayload,
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const payoutResponse = nowRes.data;

    // Create transaction records for each withdrawal
    const transactionPromises = payoutResponse.withdrawals.map(
      async (withdrawal, index) => {
        const tx = new Transaction({
          userId: requestingUser._id,
          amount: parseFloat(withdrawal.amount),
          transactionType: TRANSACTION_TYPES.PAYOUT,
          paymentMethod: "crypto",
          status: PAYMENT_STATUS.PENDING,
          referenceId: `${referenceId}-${index}`,
          metadata: {
            payoutBatchId: payoutResponse.id,
            payoutId: withdrawal.id,
            currency: withdrawal.currency,
            address: withdrawal.address,
            extraId: withdrawal.extra_id,
            payoutStatus: withdrawal.status,
            payoutDescription: withdrawal.payout_description,
            uniqueExternalId: withdrawal.unique_external_id,
            ipnCallbackUrl: withdrawal.ipn_callback_url,
            requestingUserId: requestingUser._id.toString(),
            createdAt: withdrawal.created_at || withdrawal.createdAt,
          },
        });
        return tx.save();
      }
    );

    await Promise.all(transactionPromises);

    logger.info({
      operation,
      message: `Payout batch ${payoutResponse.id} created successfully`,
      userId: requestingUser._id,
      batchId: payoutResponse.id,
      withdrawalCount: payoutResponse.withdrawals.length,
    });

    res.status(200).json({
      success: true,
      batchId: payoutResponse.id,
      referenceId: referenceId,
      withdrawals: payoutResponse.withdrawals.map((w) => ({
        id: w.id,
        address: w.address,
        currency: w.currency,
        amount: w.amount,
        status: w.status,
        created_at: w.created_at || w.createdAt,
      })),
    });
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;

    logger.error({
      operation,
      message: "Payout creation error",
      error: errMsg,
      errorFull: err.response?.data || err,
      stack: err.stack,
      userId: requestingUser._id,
    });

    res.status(500).json({
      message: errMsg || "Failed to create payout. Please try again later.",
    });
  }
};
