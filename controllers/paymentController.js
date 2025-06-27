// controllers/paymentController.js
const axios = require('axios');
const { v4: uuidv4 } = require("uuid");
const { 
  verifyNowPaymentsSignature,
  createPayment,
  getPaymentStatus: getPaymentStatusService,
  validateAddress: validateAddressService,
  getMinimumPaymentAmount: getMinimumPaymentAmountService,
  getWithdrawalFee,
  getEstimatedPrice,
  createPayout: createPayoutService,
} = require("../services/nowPaymentsService");
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





exports.createPayout = async (req, res) => {
  const operation = "createPayout";
  const { address, amount, currency, ipn_callback_url, extra_id } = req.body;
  const requestingUser = req.userDB; // User from JWT token

  // 1. Input Validation
  if (!address || !amount || !currency) {
    logger.warn({
      operation,
      message: "Missing required fields for payout: address, amount, or currency",
      userId: requestingUser._id,
    });
    return res.status(400).json({ message: "Address, amount, and currency are required for payout." });
  }

  if (typeof amount !== "number" || amount <= 0) {
    logger.warn({
      operation,
      message: "Invalid amount provided for payout",
      userId: requestingUser._id,
      amount,
    });
    return res.status(400).json({ message: "Amount must be a positive number for payout." });
  }

  try {
    // 2. Check user's balance (simplified - actual implementation needs to check user's balance in DB)
    // For now, assuming user has sufficient balance. This needs to be integrated with User model.
    const user = await User.findById(requestingUser._id);
    if (!user || user.balance < amount) {
      logger.warn({
        operation,
        message: "Insufficient balance for payout",
        userId: requestingUser._id,
        requestedAmount: amount,
        currentBalance: user ? user.balance : 'N/A',
      });
      return res.status(400).json({ message: "Insufficient balance." });
    }

    // 3. Create a new Transaction record (pending payout)
    const newTransaction = new Transaction({
      userId: requestingUser._id,
      type: TRANSACTION_TYPES.PAYOUT,
      amount: -amount, // Negative amount for payout
      currency: currency.toUpperCase(),
      status: PAYOUT_STATUS.WAITING, // Custom status for payout initiation
      description: `Withdrawal to ${address}`,
      metadata: {
        payoutAddress: address,
        payoutCurrency: currency,
        extraId: extra_id || null,
      },
    });
    await newTransaction.save();

    // 4. Construct payload for NowPayments API
    const nowPaymentsPayload = {
      address: address,
      amount: amount,
      currency: currency.toLowerCase(),
      ipn_callback_url: ipn_callback_url || `${API_BASE_URL}/api/payments/nowpayments-ipn-payout`,
      // You might want to use a different IPN URL for payouts vs payments
      external_id: newTransaction._id.toString(), // Our transaction ID as external_id
      extra_id: extra_id || null,
    };

    logger.info({
      operation,
      message: "Attempting to create payout with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      payload: nowPaymentsPayload,
    });

    // 5. Make request to NowPayments API via service
    const nowPaymentsRes = await createPayoutService(nowPaymentsPayload);

    const { payout_id, status } = nowPaymentsRes.data;

    // 6. Update the Transaction with payoutId and status
    newTransaction.paymentGatewayId = payout_id;
    newTransaction.paymentGatewayStatus = status; // NowPayments initial status
    // Map NowPayments status to our internal status
    if (status === 'waiting') {
      newTransaction.status = PAYOUT_STATUS.WAITING;
    } else if (status === 'processing') {
      newTransaction.status = PAYOUT_STATUS.PROCESSING;
    } else if (status === 'sent') {
      newTransaction.status = PAYOUT_STATUS.SENT;
    } else if (status === 'failed') {
      newTransaction.status = PAYOUT_STATUS.FAILED;
    } else if (status === 'cancelled') {
      newTransaction.status = PAYOUT_STATUS.CANCELLED;
    }
    await newTransaction.save();

    // 7. Deduct amount from user's balance (if not already handled by IPN)
    // It's generally safer to deduct on IPN confirmation for crypto, but for immediate feedback,
    // you might deduct here and refund on IPN failure.
    // For this example, we'll assume IPN handles final balance update.

    logger.info({
      operation,
      message: "Payout created successfully with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      payoutId: payout_id,
      nowPaymentsStatus: status,
    });

    // 8. Return payout details to the frontend
    res.status(200).json({
      message: "Payout initiated successfully.",
      payoutId: payout_id,
      status: newTransaction.status,
      transactionId: newTransaction._id,
    });

  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error creating payout",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      userId: requestingUser._id,
      address,
      amount,
      currency,
    });

    // If a transaction was created but an error occurred with NowPayments, mark it as failed
    if (newTransaction && newTransaction._id) {
      newTransaction.status = PAYOUT_STATUS.FAILED; // Or a more specific 'gateway_error'
      newTransaction.notes = `NowPayments API error: ${errMsg}`;
      await newTransaction.save().catch(saveErr => {
        logger.error({ operation, message: "Failed to update transaction status after NowPayments payout error", transactionId: newTransaction._id, saveErr: saveErr.message });
      });
    }

    res.status(statusCode).json({ message: errMsg });
  }
};

exports.getEstimatedConversionPrice = async (req, res) => {
  const operation = "getEstimatedConversionPrice";
  const { currency_from, currency_to, amount } = req.query;
  const requestingUser = req.userDB;

  if (!currency_from || !currency_to || !amount) {
    logger.warn({
      operation,
      message: "Missing required query parameters: currency_from, currency_to, or amount",
      userId: requestingUser._id,
    });
    return res.status(400).json({ message: "currency_from, currency_to, and amount are required." });
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    logger.warn({
      operation,
      message: "Invalid amount provided for estimated conversion price",
      userId: requestingUser._id,
      amount,
    });
    return res.status(400).json({ message: "Amount must be a positive number." });
  }

  try {
    logger.info({
      operation,
      message: `Fetching estimated conversion price for ${amount} ${currency_from} to ${currency_to}`,
      userId: requestingUser._id,
    });

    const estimatedPriceData = await getEstimatedPrice(
      parseFloat(amount),
      currency_from.toLowerCase(),
      currency_to.toLowerCase()
    );

    logger.info({
      operation,
      message: "Estimated conversion price retrieved successfully",
      userId: requestingUser._id,
      estimatedPriceData,
    });

    res.status(200).json(estimatedPriceData);
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error fetching estimated conversion price",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      userId: requestingUser._id,
      currency_from,
      currency_to,
      amount,
    });
    res.status(statusCode).json({ message: errMsg });
  }
};

exports.getWithdrawalFee = async (req, res) => {
  const operation = "getWithdrawalFee";
  const { currency, amount } = req.query;
  const requestingUser = req.userDB;

  if (!currency || !amount) {
    logger.warn({
      operation,
      message: "Missing required query parameters: currency or amount",
      userId: requestingUser._id,
    });
    return res.status(400).json({ message: "Currency and amount are required." });
  }

  if (isNaN(amount) || parseFloat(amount) <= 0) {
    logger.warn({
      operation,
      message: "Invalid amount provided for withdrawal fee",
      userId: requestingUser._id,
      amount,
    });
    return res.status(400).json({ message: "Amount must be a positive number." });
  }

  try {
    logger.info({
      operation,
      message: `Fetching withdrawal fee for ${amount} ${currency}`,
      userId: requestingUser._id,
    });

    const feeData = await getWithdrawalFee(currency.toLowerCase(), parseFloat(amount));

    logger.info({
      operation,
      message: "Withdrawal fee retrieved successfully",
      userId: requestingUser._id,
      feeData,
    });

    res.status(200).json(feeData);
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error fetching withdrawal fee",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      userId: requestingUser._id,
      currency,
      amount,
    });
    res.status(statusCode).json({ message: errMsg });
  }
};

exports.createRechargePayment = async (req, res) => {
  const operation = "createRechargePayment";
  const { amount, currency, order_description, userIdToCredit, case: paymentCase } = req.body;
  const requestingUser = req.userDB; // User from JWT token

  // 1. Input Validation
  if (!amount || !currency || !order_description || paymentCase !== "recharge") {
    logger.warn({
      operation,
      message: "Missing required fields or invalid case for recharge",
      userId: requestingUser._id,
      providedData: { amount: !!amount, currency: !!currency, order_description: !!order_description, paymentCase },
    });
    return res.status(400).json({ message: "Amount, currency, order_description, and 'case' as 'recharge' are required." });
  }

  if (typeof amount !== "number" || amount <= 0) {
    logger.warn({
      operation,
      message: "Invalid amount provided for recharge",
      userId: requestingUser._id,
      amount,
    });
    return res.status(400).json({ message: "Amount must be a positive number." });
  }

  try {
    // 2. Generate a unique referenceId
    const referenceId = uuidv4();

    // 3. Create a new Transaction record (pending)
    const newTransaction = new Transaction({
      userId: requestingUser._id,
      type: TRANSACTION_TYPES.BALANCE_RECHARGE,
      amount: amount,
      currency: currency.toUpperCase(),
      status: PAYMENT_STATUS.PENDING,
      referenceId: referenceId,
      description: order_description,
      metadata: {
        ...(userIdToCredit && { userIdToCredit: userIdToCredit }),
      },
    });
    await newTransaction.save();

    // 4. Construct payload for NowPayments API
    const nowPaymentsPayload = {
      price_amount: amount,
      price_currency: "usd", // Assuming USD as the base currency for recharge
      pay_currency: currency.toLowerCase(), // User selected currency for payment
      ipn_callback_url: `${API_BASE_URL}/api/payments/nowpayments-ipn`,
      order_id: newTransaction._id.toString(),
      order_description: order_description,
      success_url: `${FRONTEND_URL}/dashboard?payment=success&ref=${referenceId}`,
      cancel_url: `${FRONTEND_URL}/dashboard?payment=cancelled&ref=${referenceId}`,
    };

    logger.info({
      operation,
      message: "Attempting to create recharge payment with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      referenceId,
      payload: nowPaymentsPayload,
    });

    // 5. Make request to NowPayments API via service
    let nowPaymentsRes;
    try {
      nowPaymentsRes = await createPayment(nowPaymentsPayload);
    } catch (nowPaymentsError) {
      logger.error({
        operation,
        message: "Failed to create recharge payment with NowPayments API",
        error: nowPaymentsError.message,
        nowPaymentsResponse: nowPaymentsError.response ? {
          status: nowPaymentsError.response.status,
          data: nowPaymentsError.response.data,
          headers: nowPaymentsError.response.headers
        } : 'No response object from NowPayments API',
        userId: requestingUser._id,
        transactionId: newTransaction._id,
        payload: nowPaymentsPayload,
      });
      throw nowPaymentsError; // Re-throw to be caught by the main try/catch block
    }

    const { invoice_url, payment_id } = nowPaymentsRes.data;

    // 6. Update the Transaction with paymentId and invoice_url
    newTransaction.paymentGatewayId = payment_id;
    newTransaction.invoiceUrl = invoice_url;
    await newTransaction.save();

    logger.info({
      operation,
      message: "Recharge payment created successfully with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      paymentId: payment_id,
      invoiceUrl: invoice_url,
    });

    // 7. Return invoice_url and referenceId to the frontend
    res.status(200).json({
      invoice_url,
      referenceId,
      message: "Recharge payment initiated successfully.",
    });

  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error creating recharge payment",
      error: errMsg,
      statusCode,
      errorDetails: err.response?.data || err.message,
      nowPaymentsResponse: err.response ? {
        status: err.response.status,
        data: err.response.data,
        headers: err.response.headers
      } : 'No response object',
      userId: requestingUser._id,
      amount,
      currency,
    });

    // If a transaction was created but an error occurred with NowPayments, mark it as failed
    if (newTransaction && newTransaction._id) {
      newTransaction.status = PAYMENT_STATUS.REJECTED;
      newTransaction.notes = `NowPayments API error: ${errMsg}`;
      await newTransaction.save().catch(saveErr => {
        logger.error({ operation, message: "Failed to update transaction status after NowPayments recharge error", transactionId: newTransaction._id, saveErr: saveErr.message });
      });
    }

    res.status(statusCode).json({ message: errMsg });
  }
};

exports.createBotPurchasePayment = async (req, res) => {
  const operation = "createBotPurchasePayment";

  // Log incoming request for debugging
  logger.info({
    operation,
    message: "Incoming request to createBotPurchasePayment",
    body: req.body,
    userId: req.userDB?._id, // Assuming req.userDB is populated by auth middleware
  });

  logger.info({
    operation,
    message: "NOWPAYMENTS_API_KEY status",
    isSet: !!process.env.NOWPAYMENTS_API_KEY,
    maskedKey: process.env.NOWPAYMENTS_API_KEY ? process.env.NOWPAYMENTS_API_KEY.substring(0, 4) + '...' : 'Not Set'
  });

  // Ensure NowPayments API key is configured
  if (!process.env.NOWPAYMENTS_API_KEY) {
    logger.error({
      operation,
      message: "NOWPAYMENTS_API_KEY is not set. Cannot process payment.",
      userId: req.userDB?._id,
    });
    return res.status(500).json({ message: "Payment service not configured: Missing API Key." });
  }
  let { amount, botId, userIdToCredit } = req.body;
  
  // Enhanced amount parsing and validation
  try {
    amount = parseFloat(amount);
    if (isNaN(amount)) {
      throw new Error('Amount must be a valid number');
    }
  } catch (err) {
    logger.warn({
      operation,
      message: "Invalid amount format",
      userId: req.userDB?._id,
      amount: req.body.amount,
      error: err.message
    });
    return res.status(400).json({ message: "Amount must be a valid number." });
  }
  
  const requestingUser = req.userDB; // User from JWT token

  // 1. Input Validation
  if (!amount || !botId) {
    logger.warn({
      operation,
      message: "Missing required fields: amount or botId",
      userId: requestingUser._id,
      providedData: { 
        amount: req.body.amount, 
        botId: botId,
        rawAmountType: typeof req.body.amount
      },
    });
    return res.status(400).json({ 
      message: "Amount and botId are required.",
      details: {
        amountType: typeof req.body.amount,
        amountValue: req.body.amount
      }
    });
  }

  if (typeof amount !== "number" || amount <= 0) {
    logger.warn({
      operation,
      message: "Invalid amount provided",
      userId: requestingUser._id,
      amount,
      rawAmount: req.body.amount,
      amountType: typeof req.body.amount
    });
    return res.status(400).json({ 
      message: "Amount must be a positive number.",
      details: {
        parsedAmount: amount,
        rawAmount: req.body.amount
      }
    });
  }

  try {
    // 2. Fetch Bot and User details
    const bot = await Bot.findById(botId);
    if (!bot) {
      logger.warn({
        operation,
        message: "Bot not found",
        userId: requestingUser._id,
        botId,
      });
      return res.status(404).json({ message: "Bot not found." });
    }

    // Ensure the amount matches the bot's price
    if (amount !== bot.price) {
      logger.warn({
        operation,
        message: "Provided amount does not match bot price",
        userId: requestingUser._id,
        botId,
        providedAmount: amount,
        botPrice: bot.price,
      });
      return res.status(400).json({ message: "Provided amount does not match the bot's price." });
    }

    // 3. Generate a unique referenceId
    const referenceId = uuidv4();

    // 4. Create a new Transaction record (pending)
    const newTransaction = new Transaction({
      userId: requestingUser._id,
      type: TRANSACTION_TYPES.BOT_PURCHASE,
      amount: amount,
      currency: "USD", // Assuming USD for bot purchases
      status: PAYMENT_STATUS.PENDING,
      referenceId: referenceId,
      description: `Purchase of ${bot.name} bot`,
      metadata: {
        botId: bot._id,
        botName: bot.name,
        ...(userIdToCredit && { userIdToCredit: userIdToCredit }), // Include if provided
      },
    });
    await newTransaction.save();

    // 5. Construct payload for NowPayments API
    const nowPaymentsPayload = {
      price_amount: amount,
      price_currency: "usd",
      pay_currency: "btc", // Changed to BTC as NowPayments typically deals with cryptocurrencies
      ipn_callback_url: `${API_BASE_URL}/api/payments/nowpayments-ipn`,
      order_id: newTransaction._id.toString(), // Use our transaction ID as NowPayments order_id
      order_description: `BotMoon Bot Purchase: ${bot.name}`,
      success_url: `${FRONTEND_URL}/dashboard?payment=success&ref=${referenceId}`,
      cancel_url: `${FRONTEND_URL}/dashboard?payment=cancelled&ref=${referenceId}`,
    };

    logger.info({
      operation,
      message: "Attempting to create payment with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      referenceId,
      payload: nowPaymentsPayload,
    });
    console.log("🔍 Payload for NowPayments:", nowPaymentsPayload);

    // 6. Make request to NowPayments API via service
    let nowPaymentsRes;
    try {
      nowPaymentsRes = await createPayment(nowPaymentsPayload);
    } catch (nowPaymentsError) {
      logger.error({
        operation,
        message: "Failed to create payment with NowPayments API",
        error: nowPaymentsError.message,
        nowPaymentsResponse: nowPaymentsError.response ? { 
          status: nowPaymentsError.response.status, 
          data: nowPaymentsError.response.data, 
          headers: nowPaymentsError.response.headers 
        } : 'No response object from NowPayments API',
        userId: requestingUser._id,
        transactionId: newTransaction._id,
        payload: nowPaymentsPayload,
      });
      console.error("❌ NowPayments error:", nowPaymentsError.response?.data || nowPaymentsError.message);
      // Re-throw to be caught by the main try/catch block
      throw nowPaymentsError;
    }

    const { invoice_url, payment_id } = nowPaymentsRes.data;

    // 7. Update the Transaction with paymentId and invoice_url
    newTransaction.paymentGatewayId = payment_id;
    newTransaction.invoiceUrl = invoice_url;
    await newTransaction.save();

    logger.info({
      operation,
      message: "Payment created successfully with NowPayments",
      userId: requestingUser._id,
      transactionId: newTransaction._id,
      paymentId: payment_id,
      invoiceUrl: invoice_url,
    });

    // 8. Return invoice_url and referenceId to the frontend
    res.status(200).json({
      invoice_url,
      referenceId,
      message: "Payment initiated successfully.",
    });

  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error creating bot purchase payment",
      error: errMsg,
      statusCode,
      errorDetails: err.response?.data || err.message, // More specific error details
      nowPaymentsResponse: err.response ? { 
        status: err.response.status, 
        data: err.response.data, 
        headers: err.response.headers 
      } : 'No response object', // Log full NowPayments response if available
      userId: requestingUser._id,
      botId,
      amount,
    });
    console.error("Full error object:", err);

    // If a transaction was created but an error occurred with NowPayments, mark it as failed
    if (newTransaction && newTransaction._id) {
      newTransaction.status = PAYMENT_STATUS.REJECTED; // Or a more specific 'gateway_error'
      newTransaction.notes = `NowPayments API error: ${errMsg}`;
      await newTransaction.save().catch(saveErr => {
        logger.error({ operation, message: "Failed to update transaction status after NowPayments error", transactionId: newTransaction._id, saveErr: saveErr.message });
      });
    }

    res.status(statusCode).json({ message: errMsg });
  }
};


exports.getPaymentStatus = async (req, res) => {
  const operation = "getPaymentStatus";
  const { ref: referenceId } = req.query;
  const requestingUser = req.userDB; // User from JWT token

  if (!referenceId) {
    logger.warn({
      operation,
      message: "Missing referenceId in query parameters",
      userId: requestingUser._id,
    });
    return res.status(400).json({ message: "referenceId is required." });
  }

  try {
    const transaction = await Transaction.findOne({ referenceId, userId: requestingUser._id });

    if (!transaction) {
      logger.warn({
        operation,
        message: "Transaction not found or not associated with user",
        userId: requestingUser._id,
        referenceId,
      });
      return res.status(404).json({ message: "Payment not found." });
    }

    // Fetch latest status from NowPayments if paymentGatewayId exists
    let nowPaymentsStatus = transaction.paymentGatewayStatus;
    if (transaction.paymentGatewayId) {
      try {
        const nowPaymentsData = await getPaymentStatusService(transaction.paymentGatewayId);
        nowPaymentsStatus = nowPaymentsData.payment_status;
        // Optionally update the transaction status in DB if it changed
        if (transaction.paymentGatewayStatus !== nowPaymentsStatus) {
          transaction.paymentGatewayStatus = nowPaymentsStatus;
          await transaction.save();
        }
      } catch (nowPaymentsErr) {
        logger.error({
          operation,
          message: "Failed to fetch latest status from NowPayments",
          error: nowPaymentsErr.message,
          paymentGatewayId: transaction.paymentGatewayId,
        });
        // Continue with existing status if API call fails
      }
    }

    // Determine bot details if applicable
    let botName = null;
    let botInstanceId = null;
    if (transaction.type === TRANSACTION_TYPES.BOT_PURCHASE && transaction.metadata && transaction.metadata.botId) {
      const bot = await Bot.findById(transaction.metadata.botId);
      if (bot) {
        botName = bot.name;
      }
      if (transaction.metadata.botInstanceId) {
        botInstanceId = transaction.metadata.botInstanceId;
      }
    }

    // Construct the response object as per documentation
    const response = {
      referenceId: transaction.referenceId,
      status: transaction.status,
      transactionType: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      createdAt: transaction.createdAt,
      paymentStatusNowPayments: nowPaymentsStatus, // Use fetched status
      paymentUrl: transaction.invoiceUrl || null,
      botId: transaction.metadata?.botId || null,
      botName: botName,
      botInstanceId: botInstanceId,
      feeCreditPercentageApplied: transaction.metadata?.feeCreditPercentageApplied || 0,
      durationMonthsApplied: transaction.metadata?.durationMonthsApplied || 0,
      errorMessage: transaction.notes || null, // Use notes for error messages
    };

    logger.info({
      operation,
      message: "Payment status retrieved successfully",
      userId: requestingUser._id,
      referenceId,
      status: transaction.status,
    });

    res.status(200).json(response);

  } catch (err) {
    logger.error({
      operation,
      message: "Error retrieving payment status",
      error: err.message,
      errorFull: err,
      userId: requestingUser._id,
      referenceId,
    });
    res.status(500).json({ message: "Internal server error." });
  }
};

exports.getMinimumPaymentAmount = async (req, res) => {
  const operation = "getMinimumPaymentAmount";
  const { currency_from, currency_to } = req.query;
  const requestingUser = req.userDB;

  if (!currency_from || !currency_to) {
    logger.warn({
      operation,
      message: "Missing required query parameters: currency_from or currency_to",
      userId: requestingUser._id,
    });
    return res.status(400).json({ message: "currency_from and currency_to are required." });
  }

  try {
    logger.info({
      operation,
      message: `Fetching minimum payment amount for ${currency_from} to ${currency_to}`,
      userId: requestingUser._id,
    });

    const minAmountData = await getMinimumPaymentAmountService(currency_from.toLowerCase(), currency_to.toLowerCase());

    logger.info({
      operation,
      message: "Minimum payment amount retrieved successfully",
      userId: requestingUser._id,
      minAmountData,
    });

    res.status(200).json(minAmountData);
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error fetching minimum payment amount",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      userId: requestingUser._id,
      currency_from,
      currency_to,
    });
    res.status(statusCode).json({ message: errMsg });
  }
};

exports.validateAddress = async (req, res) => {
  const operation = "validateAddress";
  const { address, currency } = req.body;
  const requestingUser = req.userDB;

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

    const nowRes = await validateAddressService(address.trim(), currency.toLowerCase().trim(), req.body.extra_id || null);

    logger.info({
      operation,
      message: "Address validation successful",
      userId: requestingUser._id,
      currency,
      isValid: nowRes.data.status || nowRes.status === 200,
    });

    res.status(200).json({
      valid: nowRes.data.status !== false, // NowPayments returns 'status: true/false' for validation
      currency: currency.toLowerCase(),
      address: address,
      extra_id: nowRes.data.extra_id || null, // Use extra_id from NowPayments response if available
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

    // For any error during validation, return valid: false and an error message
    res.status(200).json({
      valid: false,
      currency: currency.toLowerCase(),
      address: address,
      extra_id: null,
      errorMessage: errMsg || "Failed to validate address. Please try again later.",
    });
  }
};

exports.getMinimumPaymentAmount = async (req, res) => {
  const operation = "getMinimumPaymentAmount";
  const { currency_from, currency_to } = req.query;

  // 1. Input Validation
  if (!currency_from || !currency_to) {
    logger.warn({
      operation,
      message: "Missing required query parameters: currency_from or currency_to",
      providedData: { currency_from: !!currency_from, currency_to: !!currency_to },
    });
    return res.status(400).json({ message: "currency_from and currency_to are required query parameters." });
  }

  try {
    logger.info({
      operation,
      message: `Fetching minimum payment amount for ${currency_from} to ${currency_to}`,
    });

    // 2. Make request to NowPayments API
    const nowPaymentsRes = await axios.get(
      `https://api.nowpayments.io/v1/min-amount?currency_from=${currency_from.toLowerCase()}&currency_to=${currency_to.toLowerCase()}`,
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const { min_amount, currency_from: res_currency_from, currency_to: res_currency_to, fiat_equivalent } = nowPaymentsRes.data;

    // 3. Return the response to the frontend
    res.status(200).json({
      currency_from: res_currency_from,
      currency_to: res_currency_to,
      min_amount: parseFloat(min_amount),
      fiat_equivalent: parseFloat(fiat_equivalent),
    });

  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    const statusCode = err.response?.status || 500;

    logger.error({
      operation,
      message: "Error fetching minimum payment amount",
      error: errMsg,
      statusCode,
      errorFull: err.response?.data || err,
      currency_from,
      currency_to,
    });

    res.status(statusCode).json({ message: errMsg });
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
