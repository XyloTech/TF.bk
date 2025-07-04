// crypto-bot/config/config.js
const path = require("path");

// Required environment variables
const requiredEnvVars = ["MONGO_URI", "JWT_SECRET", "CRYPTO_SECRET_KEY"];

// Validate required environment variables
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Missing required environment variables: ${missingEnvVars.join(", ")}`
  );
}

const cryptoSecretKeyFromEnv = process.env.CRYPTO_SECRET_KEY;

if (cryptoSecretKeyFromEnv.length !== 64) {
  throw new Error(
    "CRYPTO_SECRET_KEY must be exactly 64 hexadecimal characters long (to represent a 32-byte key)."
  );
}

// Configuration object
module.exports = {
  env: process.env.NODE_ENV || "development",
  port: process.env.PORT || 5002,
  mongodb: {
    uri: process.env.MONGO_URI,
    options: {
      maxPoolSize: 10,
    },
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  crypto: {
    secretKey: process.env.CRYPTO_SECRET_KEY,
  },
  cors: {


    allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((s) =>
      s.trim()
    ) || ["https://botmoon-pro.netlify.app/", "http://localhost:3000"],

  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  },
  nowpayments: {
    apiKey: process.env.NOWPAYMENTS_API_KEY,
    ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET,
  },
  email: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  frontend: {
    url: process.env.FRONTEND_URL || "https://yourfrontend.com",
  },
  freqtrade: {
    executablePath: process.env.FREQTRADE_EXECUTABLE_PATH || "freqtrade",
    userDataDir:
      process.env.FREQTRADE_USER_DATA_DIR ||
      path.resolve("./freqtrade-user-data"),
    strategySourceDir: process.env.STRATEGY_SOURCE_DIR,
  },
};
