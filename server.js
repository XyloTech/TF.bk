// crypto-bot/server.js
const express = require("express");
const mongoose = require("mongoose");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const config = require("./config/config");
const requestLogger = require("./middleware/requestLogger");

// --- Middleware ---
const errorHandler = require("./middleware/errorHandler");
const { generalRateLimiter } = require("./middleware/rateLimiter");
const securityHeaders = require("./middleware/securityHeaders");
const requestLogger = require("./middleware/requestLogger");

// --- Services & Utils ---
const { setupSocket } = require("./socket");
const { connectPm2, disconnectPm2 } = require("./services/freqtradeManager");
const { initScheduler, stopScheduler } = require("./scheduler");

const app = express();
// Trust the first proxy hop (common for platforms like Render, Heroku)
app.set("trust proxy", 1);

const server = http.createServer(app);

mongoose.set("debug", true);
// --- Core Middleware ---
app.use(express.json({ limit: "1mb" }));
app.use(securityHeaders);
app.use(requestLogger);

// --- CORS Configuration ---
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || config.cors.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options("*", cors());

// --- Rate Limiting ---
app.use("/api", generalRateLimiter);

// --- Health Check ---
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(
    JSON.stringify({ status: "OK", message: "CryptoBot Pro API is running..." })
  );
});

// --- API Routes ---
app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/users", require("./routes/userRoutes"));
app.use("/api/bots", require("./routes/botRoutes"));
app.use("/api/bot-instances", require("./routes/botInstanceRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/referrals", require("./routes/referralRoutes"));
app.use("/api/trades", require("./routes/tradeRoutes"));
app.use("/api/transactions", require("./routes/transactionRoutes"));
app.use("/api/payments", require("./routes/paymentRoutes"));
app.use("/api/logs", require("./routes/logRoutes"));
app.use("/api/webhooks", require("./routes/webhookRoutes")); // <<< ADD THIS LINE
app.use("/api/charts", require("./routes/chartRoutes"));
// --- Global Error Handler (Must be last) ---
app.use(errorHandler);

// --- Startup Function ---
async function startServer() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log("✅ MongoDB connected");

    // 2. Connect to PM2
    await connectPm2();

    // 3. Setup WebSocket Server
    setupSocket(server);
    console.log("✅ WebSocket server initialized");

    // 4. Initialize Scheduler
    initScheduler();

    // 5. Start HTTP Server
    const PORT = config.port;
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT} (${config.env} mode)`);
      console.log(`🟢 Application ready!`);
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error);
    // Attempt graceful shutdown
    await mongoose
      .disconnect()
      .catch((err) => console.error("Failed to disconnect MongoDB:", err));
    disconnectPm2();
    process.exit(1);
  }
}

// --- Graceful Shutdown Handling ---
async function gracefulShutdown(signal) {
  console.log(`\n👋 Received ${signal}. Starting graceful shutdown...`);
  stopScheduler();
  disconnectPm2();

  try {
    await mongoose.disconnect();
    console.log("🔌 MongoDB disconnected.");
  } catch (err) {
    console.error("Error disconnecting MongoDB:", err);
  }

  server.close(() => {
    console.log("🚪 HTTP server closed.");
    console.log("🏁 Shutdown complete.");
    process.exit(0);
  });

  setTimeout(() => {
    console.error("⚠️ Could not close connections in time, forcing shutdown.");
    process.exit(1);
  }, 10000);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// --- Start the Application ---
startServer();
