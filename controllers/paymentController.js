const axios = require("axios");
const { v4: uuidv4 } = require("uuid");
const Transaction = require("../models/Transaction");
const User = require("../models/User");
const { sendTelegramMessage } = require("../utils/telegram");

// 🔹 Create NowPayments Invoice
exports.createCryptoPayment = async (req, res) => {
  const { amount, botId } = req.body;
  const user = req.userDB;

  try {
    const referenceId = uuidv4();

    const nowRes = await axios.post(
      "https://api.nowpayments.io/v1/invoice",
      {
        price_amount: amount,
        price_currency: "usd",
        order_id: referenceId,
        order_description: `Bot Purchase: ${botId}`,
        success_url: `https://bot-moon-h7x3.onrender.com/payment/success?ref=${referenceId}`,
        cancel_url: `https://bot-moon-h7x3.onrender.com/payment/cancel`,
      },
      {
        headers: {
          "x-api-key": process.env.NOWPAYMENTS_API_KEY,
          "Content-Type": "application/json",
        },
      }
    );

    const invoice = nowRes.data;

    const tx = new Transaction({
      userId: user._id,
      amount,
      transactionType: "recharge",
      paymentMethod: "crypto",
      referenceId,
      metadata: {
        botId,
        invoiceId: invoice.id,
        paymentUrl: invoice.invoice_url,
      },
    });

    await tx.save();

    res.status(200).json({ invoice_url: invoice.invoice_url });
  } catch (err) {
    console.error("❌ NowPayments Error:", err.response?.data || err.message);
    res.status(500).json({ message: "Payment failed" });
  }
};

// 🔹 Handle Webhook
exports.nowPaymentsWebhook = async (req, res) => {
  const { payment_status, order_id, amount_received } = req.body;

  try {
    const tx = await Transaction.findOne({ referenceId: order_id });
    if (!tx) return res.status(404).json({ message: "Transaction not found" });

    tx.metadata.paymentStatus = payment_status;
    tx.metadata.amountReceived = amount_received;

    if (payment_status === "confirmed" || payment_status === "finished") {
      if (tx.status !== "approved") {
        tx.status = "approved";

        // ✅ Auto-create bot instance
        const existing = await BotInstance.findOne({
          userId: tx.userId,
          botId: tx.metadata.botId,
        });

        if (!existing) {
          await BotInstance.create({
            userId: tx.userId,
            botId: tx.metadata.botId,
            isActive: true,
            config: {}, // You can prefill config defaults here if needed
          });
        }

        // ✅ Send email (handled below in Part 2)
        const user = await User.findById(tx.userId);
        if (user?.email) {
          await sendBotSuccessEmail(user.email, tx.metadata.botId);
        }

        if (user?.telegramId) {
          await sendTelegramMessage(
            user.telegramId,
            `🚀 Your *${tx.metadata.botId}* bot has been activated!\n\nCheck it in your dashboard 👉 https://yourfrontend.com/dashboard`
          );
        }
      }
    } else if (payment_status === "failed") {
      tx.status = "rejected";
    }

    await tx.save();

    res.status(200).json({ message: "Webhook received" });
  } catch (err) {
    console.error("Webhook Error:", err.message);
    res.status(500).json({ message: "Webhook error" });
  }
};

// 🔹 Optional: Check Status
exports.getPaymentStatus = async (req, res) => {
  const { ref } = req.query;

  try {
    const tx = await Transaction.findOne({ referenceId: ref });
    if (!tx) return res.status(404).json({ message: "Not found" });

    res.json({
      status: tx.status,
      bot: tx.metadata.botId,
      amount: tx.amount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
