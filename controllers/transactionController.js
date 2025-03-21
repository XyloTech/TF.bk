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
