const Referral = require("../models/Referral");
const User = require("../models/User");
const logger = require("../utils/logger");
const mongoose = require("mongoose"); // Optional: for transactions
const { sendNotification } = require("../socket"); // Optional: For real-time notification

// Configuration (move to config file ideally)
const COMMISSION_RATE = parseFloat(
  process.env.REFERRAL_COMMISSION_RATE || "0.10"
); // e.g., 10%
const MINIMUM_PURCHASE_AMOUNT = parseFloat(
  process.env.REFERRAL_MIN_PURCHASE || "10.0"
); // e.g., $10 minimum purchase to qualify

/**
 * Processes a referral reward when a referred user completes a qualifying action.
 * @param {string} referredUserId - The MongoDB ObjectId (as string) of the user who completed the action.
 * @param {number} actionValue - The value of the action (e.g., purchase amount) used for commission calculation.
 * @param {string} [actionId] - Optional identifier for the action (e.g., orderId, transactionId) for logging.
 */
const processReferralReward = async (
  referredUserId,
  actionValue,
  actionId = null
) => {
  const operation = "processReferralReward";
  logger.info({
    operation,
    referredUserId,
    actionValue,
    actionId,
    message: "Attempting to process referral reward...",
  });

  if (actionValue < MINIMUM_PURCHASE_AMOUNT) {
    logger.info({
      operation,
      referredUserId,
      actionValue,
      minimum: MINIMUM_PURCHASE_AMOUNT,
      message: "Action value below minimum threshold. No referral commission.",
    });
    return;
  }

  let session = null; // For MongoDB transaction
  try {
    // Find the referral record where this user was the one referred AND the reward hasn't been given yet
    const referral = await Referral.findOne({
      referredId: referredUserId,
      purchaseMade: false, // IMPORTANT: Only process once
    }); //.populate('referrerId', 'email'); // Optionally populate referrer email for logging

    if (!referral) {
      logger.info({
        operation,
        referredUserId,
        message:
          "No pending referral found for this user or reward already processed.",
      });
      return; // Not a referred user or already processed
    }

    const referrerId = referral.referrerId;
    const commission = actionValue * COMMISSION_RATE;

    // Ensure commission is a positive value
    if (commission <= 0) {
      logger.warn({
        operation,
        referredUserId,
        referrerId,
        commission,
        message: "Calculated commission is zero or negative. Skipping reward.",
      });
      return;
    }

    // Use a transaction to ensure both updates succeed or fail together
    session = await mongoose.startSession();
    session.startTransaction();

    // 1. Update the Referral record
    referral.purchaseMade = true;
    referral.commissionEarned = commission;
    await referral.save({ session });
    logger.info({
      operation,
      referralId: referral._id,
      message: "Referral record updated.",
      commission,
    });

    // 2. Update the Referrer's balance
    const updatedReferrer = await User.findByIdAndUpdate(
      referrerId,
      { $inc: { accountBalance: commission } },
      { new: true, session } // Return the updated document
    );

    if (!updatedReferrer) {
      // This should ideally not happen if referrerId is valid
      throw new Error(
        `Referrer user ${referrerId} not found during balance update.`
      );
    }
    logger.info({
      operation,
      referrerId,
      message: "Referrer account balance updated.",
      newBalance: updatedReferrer.accountBalance,
    });

    // Commit the transaction
    await session.commitTransaction();
    logger.info({
      operation,
      referralId: referral._id,
      referrerId,
      message:
        "Referral reward processed successfully (Transaction committed).",
    });

    // Optional: Notify referrer about the commission earned
    sendNotification(
      referrerId.toString(),
      "commission_earned",
      `You earned $${commission.toFixed(2)} commission from a referral!`
    );
  } catch (error) {
    logger.error({
      operation,
      referredUserId,
      actionId,
      error: error.message,
      stack: error.stack,
    });
    // If transaction started, abort it
    if (session) {
      try {
        await session.abortTransaction();
        logger.info({
          operation,
          message: "Transaction aborted due to error.",
        });
      } catch (abortError) {
        logger.error({
          operation,
          message: "Failed to abort transaction.",
          error: abortError.message,
        });
      }
    }
    // Decide how to handle failures - potentially add to a retry queue?
    // For now, we just log the error.
  } finally {
    // End the session
    if (session) {
      session.endSession();
    }
  }
};

module.exports = { processReferralReward };
