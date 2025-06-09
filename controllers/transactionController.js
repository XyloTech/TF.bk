const Transaction = require("../models/Transaction");

// 🔹 Get User Transactions
exports.getTransactions = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      userId: req.userDB._id,
    }).sort({ createdAt: -1 });
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Create Transaction (Deposit, Withdrawal, Fees)
exports.createTransaction = async (req, res) => {
  try {
    const { amount, transactionType, paymentMethod, referenceId, metadata } =
      req.body;

    // Validate transaction
    if (
      !["recharge", "withdrawal", "trade_fee", "referral_bonus"].includes(
        transactionType
      )
    )
      return res.status(400).json({ message: "Invalid transaction type" });

    const transaction = new Transaction({
      userId: req.userDB._id,
      amount,
      transactionType,
      paymentMethod,
      referenceId,
      metadata,
    });

    await transaction.save();
    res.status(201).json(transaction);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// 🔹 Get User Recharge Amount (Total Recharge - Withdrawals)
exports.rechargeAmount = async (req, res) => {
  try {
    const userId = req.userDB._id;

    // Fetch all approved balance_recharge and withdrawal transactions for the user
    const transactions = await Transaction.find({
      userId,
      status: "approved",
      transactionType: { $in: ["balance_recharge", "withdrawal"] },
    });

    // Calculate total: sum of balance_recharge minus sum of withdrawal
    let totalRecharge = 0;
    let totalWithdrawal = 0;

    transactions.forEach((tx) => {
      if (tx.transactionType === "balance_recharge") {
        totalRecharge += tx.amount;
      } else if (tx.transactionType === "withdrawal") {
        totalWithdrawal += tx.amount;
      }
    });

    const netRecharge = totalRecharge - totalWithdrawal;

    res.json({
      total_recharge: totalRecharge,
      total_withdrawal: totalWithdrawal,
      net_recharge: netRecharge,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
