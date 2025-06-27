const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;
const NOWPAYMENTS_API_BASE_URL = 'https://api.nowpayments.io/v1';

// --- Environment Variable Checks & Configuration --- 
if (!NOWPAYMENTS_API_KEY) {
  logger.error(
    "FATAL ERROR: NOWPAYMENTS_API_KEY is not set. NowPayments API calls will fail."
  );
}
if (!NOWPAYMENTS_IPN_SECRET) {
  const message =
    "NOWPAYMENTS_IPN_SECRET is not set. Webhook verification WILL BE INSECURE.";
  if (process.env.NODE_ENV === "production") {
    logger.fatal(
      `FATAL ERROR: ${message} This is unacceptable for production.`
    );
  } else {
    logger.error(
      `CRITICAL WARNING: ${message} OK for local dev only if you understand the risk.`
    );
  }
}

const nowPaymentsApi = axios.create({
  baseURL: NOWPAYMENTS_API_BASE_URL,
  headers: {
    'x-api-key': NOWPAYMENTS_API_KEY,
    'Content-Type': 'application/json',
  },
});

/**
 * Verifies the signature of a NowPayments webhook.
 * @param {Buffer} rawBody - The raw request body from the webhook.
 * @param {string} signatureHeader - The 'x-nowpayments-sig' header value.
 * @returns {boolean} - True if the signature is valid, false otherwise.
 */
function verifyNowPaymentsSignature(rawBody, signatureHeader) {
  const operation = "verifyNowPaymentsSignature";
  if (!signatureHeader) {
    logger.error({ operation, message: "Verification failed: Missing 'x-nowpayments-sig' header." });
    return false;
  }
  if (!NOWPAYMENTS_IPN_SECRET) {
    logger.error({ operation, message: "Verification failed: NOWPAYMENTS_IPN_SECRET is not configured. Cannot verify." });
    return false;
  }
  if (!rawBody || typeof rawBody.toString !== "function") {
    logger.error({ operation, message: "Verification failed: rawBody is missing or invalid." });
    return false;
  }

  try {
    const hmac = crypto.createHmac("sha512", NOWPAYMENTS_IPN_SECRET);
    const calculatedSignature = hmac.update(rawBody.toString("utf8")).digest("hex");

    const trusted = Buffer.from(calculatedSignature, "utf8");
    const untrusted = Buffer.from(signatureHeader, "utf8");

    if (trusted.length !== untrusted.length || !crypto.timingSafeEqual(trusted, untrusted)) {
      logger.warn({ operation, message: "Invalid NowPayments webhook signature.", received: signatureHeader, calculated: calculatedSignature });
      return false;
    }
    logger.info({ operation, message: "NowPayments webhook signature verified successfully." });
    return true;
  } catch (error) {
    logger.error({ operation, message: "Error during NowPayments signature verification", error: error.message, stack: error.stack });
    return false;
  }
}

/**
 * Creates a new payment with NowPayments.
 * @param {object} payload - The payment payload for NowPayments API.
 * @returns {Promise<object>} - The response data from NowPayments.
 */
async function createPayment(payload) {
  try {
    const response = await nowPaymentsApi.post('/payment', payload);
    return response.data;
  } catch (error) {
    logger.error({ message: 'Error creating NowPayments payment', error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Gets the status of a payment from NowPayments.
 * @param {string} paymentId - The ID of the payment.
 * @returns {Promise<object>} - The payment status data from NowPayments.
 */
async function getPaymentStatus(paymentId) {
  try {
    const response = await nowPaymentsApi.get(`/payment/${paymentId}`);
    return response.data;
  } catch (error) {
    logger.error({ message: `Error getting NowPayments payment status for ID: ${paymentId}`, error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Validates a crypto wallet address.
 * @param {string} address - The wallet address to validate.
 * @param {string} currency - The currency of the wallet address.
 * @returns {Promise<object>} - The validation result from NowPayments.
 */
async function validateAddress(address, currency) {
  try {
    const response = await nowPaymentsApi.post('/validate-address', { address, currency });
    return response.data;
  } catch (error) {
    logger.error({ message: `Error validating address ${address} for currency ${currency}`, error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Gets the minimum payment amount for a currency pair.
 * @param {string} currencyFrom - The source currency.
 * @param {string} currencyTo - The target currency.
 * @returns {Promise<object>} - The minimum payment amount data from NowPayments.
 */
async function getMinimumPaymentAmount(currencyFrom, currencyTo) {
  try {
    const response = await nowPaymentsApi.get('/min-amount', { params: { currency_from: currencyFrom, currency_to: currencyTo } });
    return response.data;
  } catch (error) {
    logger.error({ message: `Error getting minimum payment amount for ${currencyFrom} to ${currencyTo}`, error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Gets the withdrawal fee for a specific currency and amount.
 * @param {string} currency - The currency for withdrawal.
 * @param {number} amount - The amount to withdraw.
 * @returns {Promise<object>} - The withdrawal fee data from NowPayments.
 */
async function getWithdrawalFee(currency, amount) {
  try {
    const response = await nowPaymentsApi.get('/payout/fee', { params: { currency, amount } });
    return response.data;
  } catch (error) {
    logger.error({ message: `Error getting withdrawal fee for ${amount} ${currency}`, error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Gets the estimated conversion price between two currencies.
 * @param {number} amount - The amount to convert.
 * @param {string} currencyFrom - The source currency.
 * @param {string} currencyTo - The target currency.
 * @returns {Promise<object>} - The estimated price data from NowPayments.
 */
async function getEstimatedPrice(amount, currencyFrom, currencyTo) {
  try {
    const response = await nowPaymentsApi.get('/estimate', { params: { amount, currency_from: currencyFrom, currency_to: currencyTo } });
    return response.data;
  } catch (error) {
    logger.error({ message: `Error getting estimated price for ${amount} ${currencyFrom} to ${currencyTo}`, error: error.message, details: error.response?.data });
    throw error;
  }
}

/**
 * Creates a payout (withdrawal) with NowPayments.
 * @param {object} payload - The payout payload for NowPayments API.
 * @returns {Promise<object>} - The response data from NowPayments.
 */
async function createPayout(payload) {
  try {
    const response = await nowPaymentsApi.post('/payout', payload);
    return response.data;
  } catch (error) {
    logger.error({ message: 'Error creating NowPayments payout', error: error.message, details: error.response?.data });
    throw error;
  }
}

module.exports = {
  verifyNowPaymentsSignature,
  createPayment,
  getPaymentStatus,
  validateAddress,
  getMinimumPaymentAmount,
  getWithdrawalFee,
  getEstimatedPrice,
  createPayout,
};