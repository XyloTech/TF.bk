const User = require("../models/User");
const Trade = require("../models/Trade");
const Referral = require("../models/Referral"); // Import Referral model
const { startOfDay, endOfDay, startOfMonth, subMonths } = require('date-fns');
const logger = require("../utils/logger"); // Assuming logger exists

// 🔹 Get User Profile
exports.getProfile = async (req, res) => {
  if (!req.userDB) {
    return res
      .status(401)
      .json({ message: "Authentication error: User not found." });
  }
  // userDB is transformed by toJSON in the model
  let tradingStats = {};
  try {
    tradingStats = await getTradingStats(req.userDB._id);
  } catch (err) {
    console.warn({ message: "Trading stats failed", error: err.message }); // Using console.warn as logger might not be imported
  }
  const userProfile = req.userDB.toJSON();
  userProfile.tradingStats = tradingStats;
  res.json(userProfile);
};

// 🔹 Update User Profile (Non-sensitive fields)
exports.updateProfile = async (req, res) => {
  // ... (keep existing updateProfile logic as provided previously) ...
  // Ensure you don't allow updating referralCode, referralLink, accountBalance etc here
  try {
    const { fullName, telegramId /* Add other updatable fields */ } = req.body;
    const userId = req.userDB._id;

    const updates = {};
    if (typeof fullName === "string") updates.fullName = fullName.trim();
    if (typeof telegramId === "string") updates.telegramId = telegramId.trim();

    if (Object.keys(updates).length === 0) {
      return res
        .status(400)
        .json({ message: "No valid fields provided for update." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updates },
      { new: true, runValidators: true, context: "query" }
    );

    if (!updatedUser)
      return res.status(404).json({ message: "User not found." });

    res.json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    logger.error({
      operation: "updateProfile",
      userId: req.userDB?._id,
      error: error.message,
      stack: error.stack,
    });
    if (error.name === "ValidationError") {
      return res
        .status(400)
        .json({ message: "Validation failed", errors: error.errors });
    }
    res
      .status(500)
      .json({ message: "Failed to update profile due to a server error." });
  }
};

// 🔹 NEW: Complete Registration / Track Referral
// This endpoint should be called by the frontend once after the user's first login/auth,
// passing the referral code if one was present in the signup URL.
exports.completeRegistration = async (req, res) => {
  const operation = "completeRegistration";
  const userId = req.userDB._id;
  const userEmail = req.userDB.email;
  const { referralCode } = req.body; // Frontend needs to send this if available { "referralCode": "ABC123XYZ" }
  console.log("completeRegistration called with referralCode:", referralCode);

  try {
    const user = req.userDB; // User already fetched by auth middleware

    // Idempotency: Check if registration already completed
    if (user.registrationComplete) {
      logger.info({
        operation,
        userId,
        message: "Registration already completed.",
      });
      return res
        .status(200)
        .json({ message: "Registration already completed.", user });
    }

    let referrerUser = null;
    if (
      referralCode &&
      typeof referralCode === "string" &&
      referralCode.trim() !== ""
    ) {
      const cleanReferralCode = referralCode.trim();
      logger.info({
        operation,
        userId,
        message: `Attempting to find referrer with code: ${cleanReferralCode}`,
      });

      referrerUser = await User.findOne({ referralCode: cleanReferralCode });

      if (referrerUser) {
        console.log(
          `self Referrer found: ${referrerUser._id} (${referrerUser.email})`
        );
        // Prevent self-referral
        if (referrerUser._id.toString() === userId.toString()) {
          logger.warn({
            operation,
            userId,
            message: "Self-referral attempt detected.",
          });
          referrerUser = null; // Nullify referrer if self-referral
        } else {
          logger.info({
            operation,
            userId,
            message: `Referrer found: ${referrerUser._id} (${referrerUser.email})`,
          });
          // --- Create Referral Record ---
          const existingReferral = await Referral.findOne({
            referredId: userId,
          }); // Check if already referred
          if (!existingReferral) {
            const newReferral = new Referral({
              referrerId: referrerUser._id,
              referredId: userId,
              // status: "PENDING",
              // purchaseMade: false, // Default
              // commissionEarned: 2, // Default
              // completedAt: null, // Default
            });
            await newReferral.save();
            logger.info({
              operation,
              userId,
              message: `Referral record created successfully. Referrer: ${referrerUser._id}, Referred: ${userId}`,
            });

            // Optional: Notify referrer via Socket.IO
            // const { sendNotification } = require('../socket'); // Adjust path
            // sendNotification(referrerUser._id.toString(), 'new_referral', `Someone signed up using your link! (${userEmail})`);
          } else {
            logger.warn({
              operation,
              userId,
              message: `User already has a referral record (Ref ID: ${existingReferral._id}). Skipping creation.`,
            });
          }
          // --- End Create Referral Record ---
        }
      } else {
        logger.warn({
          operation,
          userId,
          message: `Referral code '${cleanReferralCode}' provided but no matching user found.`,
        });
      }
    } else {
      logger.info({
        operation,
        userId,
        message: "No referral code provided during registration completion.",
      });
    }

    // Mark registration as complete for the new user
    user.registrationComplete = true;
    await user.save();

    logger.info({
      operation,
      userId,
      message: "User registration marked as complete.",
    });

    res
      .status(200)
      .json({ message: "Registration completed successfully.", user });
  } catch (error) {
    logger.error({
      operation,
      userId,
      error: error.message,
      stack: error.stack,
    });
    res
      .status(500)
      .json({ message: "An error occurred during registration completion." });
  }
};

// 🔹 NEW: Get User's Own Referral Info
exports.getMyReferralInfo = async (req, res) => {
  const operation = "getMyReferralInfo";
  const userId = req.userDB._id;
  try {
    // Fetch fresh user data in case link/code changed (though unlikely without specific action)
    const user = await User.findById(userId).select(
      "referralCode referralLink"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Optionally fetch aggregate stats
    // const referralStats = await Referral.aggregate([
    //   { $match: { referrerId: userId } }, // Match referrals made BY this user
    //   {
    //     $group: {
    //       _id: null, // Group all referrals for this user
    //       totalReferrals: { $sum: 1 },
    //       successfulReferrals: { $sum: { $cond: ["$purchaseMade", 1, 0] } }, // Count referrals where purchase was made
    //       totalCommission: { $sum: "$commissionAmount" },
    //     },
    //   },
    // ]);
    const referralStats = await Referral.aggregate([
      {
        $match: {
          referrerId: userId, // Match referrals made by this user
        },
      },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: 1 }, // Count all referrals
          successfulReferrals: {
            $sum: {
              $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0],
            },
          },
          totalCommissionEarned: {
            $sum: {
              $cond: [
                { $eq: ["$status", "COMPLETED"] },
                "$commissionAmount",
                0,
              ],
            },
          },
        },
      },
    ]);
    console.log("referralStats:", referralStats);


// 🔹 Helper function to calculate trading statistics
async function getTradingStats(userId) {
  try {
    const botInstanceIds = await User.findById(userId).distinct('botInstances');

    const stats = await Trade.aggregate([
      { $match: { botInstanceId: { $in: botInstanceIds } } }, // Match trades for user's bot instances
      { $group: {
        _id: null,
        totalProfit: { $sum: "$netProfit" },
        tradesCount: { $sum: 1 },
        winningTrades: { $sum: { $cond: [ { $gt: ["$netProfit", 0] }, 1, 0 ] } },
        totalFees: { $sum: "$platformFee" }
      }}
    ]);

    const result = stats[0] || {};

    const totalProfit = result.totalProfit || 0;
    const tradesCount = result.tradesCount || 0;
    const winningTrades = result.winningTrades || 0;
    const totalFees = result.totalFees || 0;

    const winRate = tradesCount > 0 ? (winningTrades / tradesCount) * 100 : 0;
    const averageFeePerTrade = tradesCount > 0 ? totalFees / tradesCount : 0;

    // For todayProfit and monthlyProfitChangePercent, more complex date-based aggregation is needed.
    // For now, we'll return placeholders.
    const today = new Date();
    const startOfToday = startOfDay(today);
    const endOfToday = endOfDay(today);

    const todayStats = await Trade.aggregate([
      { $match: {
          botInstanceId: { $in: botInstanceIds },
          createdAt: { $gte: startOfToday, $lte: endOfToday }
      }},
      { $group: {
          _id: null,
          todayProfit: { $sum: "$netProfit" }
      }}
    ]);
    const todayProfit = todayStats[0]?.todayProfit || 0;

    const startOfCurrentMonth = startOfMonth(today);
    const startOfPreviousMonth = startOfMonth(subMonths(today, 1));
    const endOfPreviousMonth = subMonths(startOfCurrentMonth, 1);

    const currentMonthStats = await Trade.aggregate([
      { $match: {
          botInstanceId: { $in: botInstanceIds },
          createdAt: { $gte: startOfCurrentMonth }
      }},
      { $group: {
          _id: null,
          profit: { $sum: "$netProfit" }
      }}
    ]);
    const currentMonthProfit = currentMonthStats[0]?.profit || 0;

    const previousMonthStats = await Trade.aggregate([
      { $match: {
          botInstanceId: { $in: botInstanceIds },
          createdAt: { $gte: startOfPreviousMonth, $lte: endOfPreviousMonth }
      }},
      { $group: {
          _id: null,
          profit: { $sum: "$netProfit" }
      }}
    ]);
    const previousMonthProfit = previousMonthStats[0]?.profit || 0;

    let monthlyProfitChangePercent = 0;
    if (previousMonthProfit !== 0) {
      monthlyProfitChangePercent = ((currentMonthProfit - previousMonthProfit) / previousMonthProfit) * 100;
    } else if (currentMonthProfit > 0) {
      monthlyProfitChangePercent = 100; // If previous month was 0 and current is positive
    } else if (currentMonthProfit < 0) {
      monthlyProfitChangePercent = -100; // If previous month was 0 and current is negative
    }

    return {
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      todayProfit: parseFloat(todayProfit.toFixed(2)),
      winRate: parseFloat(winRate.toFixed(2)),
      tradesCount: tradesCount,
      averageFeePerTrade: parseFloat(averageFeePerTrade.toFixed(2)),
      monthlyProfitChangePercent: parseFloat(monthlyProfitChangePercent.toFixed(2))
    };

  } catch (error) {
    logger.error({
      operation: "getTradingStats",
      userId: userId,
      error: error.message,
      stack: error.stack,
    });
    return {}; // Return empty object on error
  }
}


    res.json({
      success: true,
      referralCode: user.referralCode,
      referralLink: user.referralLink,
      stats: referralStats[0] || {
        totalReferrals: 0,
        successfulReferrals: 0,
        totalCommission: 0,
      }, // Provide defaults if no stats
    });
  } catch (error) {
    logger.error({
      operation,
      userId,
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: "Failed to retrieve referral info" });
  }
};

// 🔹 Get All Users (Admin Only) - Ensure route is protected
exports.getUsers = async (req, res) => {
  // ... (keep existing getUsers logic) ...
  try {
    const users = await User.find({})
      .select(
        "fullName email role status createdAt registrationComplete referralCode"
      ) // Select fields
      .sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (error) {
    logger.error({
      operation: "getUsersAdmin",
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ message: "Failed to retrieve users." });
  }
};
