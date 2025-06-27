const mongoose = require('mongoose');
const Bot = require('../models/Bot');
const dotenv = require('dotenv');
dotenv.config();

const botTemplates = [
  {
    _id: "681cae396254a493c139b408",
    name: "Binance Auto Trade Bot",
    description: "Fully automated trading on Binance via secure API, 24/7 trading based on real-time market logic, Wallet-based fee deduction: 20% of profit, Bot pauses if fee wallet is empty, Designed for volatile market performance, Priority technical support, Advanced risk management settings.",
    price: 50,
    profitFee: 20,
    features: [
      "Fully automated trading on Binance via secure API",
      "24/7 trading based on real-time market logic",
      "Wallet-based fee deduction: 20% of profit",
      "Bot pauses if fee wallet is empty",
      "Designed for volatile market performance",
      "Priority technical support",
      "Advanced risk management settings",
    ],
    active: true,
    imageUrl: "/binance-logo.svg",
    defaultConfig: {
      max_open_trades: 3,
      stake_currency: "USDT",
      stake_amount: "unlimited",
      pair_whitelist: ["BTC/USDT", "ETH/USDT"],
    },
    defaultStrategy: "SampleEmaRsiStrategy.py",
  },
  {
    _id: "681cae396254a493c139b409",
    name: "CoinEx Auto Trade Bot",
    description: "Plug & play auto-trading for CoinEx, Spot and futures supported, API-based secure auto execution, Wallet-based fee deduction: 20% of profit, Bot pauses if fee wallet is empty, Perfect for beginners to crypto trading, Community support access.",
    price: 50,
    profitFee: 20,
    features: [
      "Plug & play auto-trading for CoinEx",
      "Spot and futures supported",
      "API-based secure auto execution",
      "Wallet-based fee deduction: 20% of profit",
      "Bot pauses if fee wallet is empty",
      "Perfect for beginners to crypto trading",
      "Community support access",
    ],
    active: true,
    imageUrl: "/coinex-logo.svg",
    defaultConfig: {
      max_open_trades: 3,
      stake_currency: "USDT",
      stake_amount: "unlimited",
      pair_whitelist: ["BTC/USDT", "ETH/USDT"],
    },
    defaultStrategy: "SampleEmaRsiStrategy.py",
  },
];

async function seedBots() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB Connected...');

    await Bot.deleteMany({});
    console.log('Existing bots removed.');

    await Bot.insertMany(botTemplates);
    console.log('Bot templates seeded successfully!');

  } catch (error) {
    console.error('Error seeding bot templates:', error);
  } finally {
    mongoose.connection.close();
  }
}

seedBots();