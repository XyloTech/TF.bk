// crypto-bot/server.js
const dotenv = require("dotenv");
dotenv.config();


const express = require("express");

const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const slowDown = require("express-slow-down");
const config = require("./config/config");
const logger = require("./utils/logger"); // Ensure logger is available early
require('./config/firebase'); // Initialize Firebase Admin SDK

const backtestRoutes = require('./routes/backtestRoutes');
const orderRoutes = require('./routes/orderRoutes');

// --- Middleware ---
const errorHandler = require("./middleware/errorHandler");
const { generalRateLimiter } = require("./middleware/rateLimiter");
const securityHeaders = require("./middleware/securityHeaders");

// --- Services & Utils ---
const { setupSocket } = require("./socket");
// Ensure this path correctly points to your services/freqtrade/index.js or freqtradeManager.js
// which should export connectPm2 and disconnectPm2
const { connectPm2, disconnectPm2 } = require("./services/freqtrade");
const {
  initializePm2EventMonitor,
} = require("./services/freqtrade/pm2ProcessMonitor"); // <--- YOUR IMPORT (GOOD!)
const { initScheduler, stopScheduler } = require("./scheduler");

const app = express();
// Trust the first proxy hop (common for platforms like Render, Heroku)
app.set("trust proxy", 1);

const http = require('http');
const server = http.createServer(app);

// mongoose.set("debug", true); // Keep this for dev, consider removing for prod
// --- Core Middleware ---
app.use(express.json({
  limit: "1mb",
  verify: (req, res, buf) => {
    if (req.originalUrl === '/api/payments/webhook') {
      req.rawBody = buf.toString();
    }
  },
}));
app.use(express.raw({ type: 'application/json', limit: '1mb' }));
app.use(securityHeaders); // Your custom security headers from middleware
// app.use(helmet()); // If securityHeaders isn't a full replacement for helmet, you might want both or to integrate.
const requestLogger = require('./middleware/requestLogger');
app.use(requestLogger);

// --- CORS Configuration ---
app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = ['http://localhost:3000', 'http://localhost:5000', ...(config.cors.allowedOrigins || [])];
      console.log(`CORS Debug - Origin: ${origin}, Allowed: ${allowedOrigins.join(', ')}`);
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log(`CORS: Blocked origin - ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options("*", cors()); // Pre-flight requests

// --- Rate Limiting ---
app.use("/api", generalRateLimiter); // Apply to all /api routes

// --- Health Check ---
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(
    JSON.stringify({ status: "OK", message: "CryptoBot Pro API is running..." })
  );
});
app.get("/health", (req, res) => {
  // A common health check endpoint
  res.status(200).json({ status: "UP" });
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
app.use("/api/webhooks", require("./routes/webhookRoutes"));
app.use("/api/charts", require("./routes/chartRoutes"));
app.use("/api/stats", require("./routes/statsRoutes"));

app.use('/api/backtest', backtestRoutes);
app.use('/api/order', orderRoutes);

// --- Not Found Handler (for API routes) ---
app.use("/api/*", (req, res, next) => {
  res.status(404).json({ message: "API endpoint not found." });
});

// Import the Bull queue
const exchangeQueue = require("./services/queue");

// Example endpoint to add a job to the queue
app.post("/api/add-exchange-job", async (req, res) => {
  try {
    const { userId, data } = req.body;
    if (!userId || !data) {
      return res.status(400).json({ message: "userId and data are required" });
    }
    const job = await exchangeQueue.add({ userId, data });
    res.status(200).json({ message: "Job added to queue", jobId: job.id });
  } catch (error) {
    console.error("Error adding job to queue:", error);
    res
      .status(500)
      .json({ message: "Failed to add job to queue", error: error.message });
  }
});

// --- Global Error Handler (Must be last) ---
app.use(errorHandler);

// --- Startup Function ---
async function startServer() {
  try {
    // 1. Connect to MongoDB
    await mongoose.connect(config.mongodb.uri, config.mongodb.options);
    console.log(" MongoDB connected"); // Use logger.info in production

    // 2. Connect to PM2
    // This connectPm2 should be the one from your services/freqtrade/index.js (which delegates to freqtradeManager.js)
    await connectPm2();
    console.log(" PM2 service connected"); // Use logger.info

    // 2a. Initialize PM2 Event Monitor AFTER PM2 is connected
    // This function will internally call pm2.launchBus()
    initializePm2EventMonitor();
    console.log(" PM2 Event Monitor initialized"); // Use logger.info

    // Temporary: Start a specific freqtrade process for debugging
    const debugInstanceId = '685c5fd7ed51d8473f4425f3'; // Replace with an actual instance ID from your data/ft_user_data
    logger.info(`[Server] Attempting to start debug Freqtrade instance: ${debugInstanceId}`);
    try {
      await require('./services/freqtrade').startFreqtradeProcess(debugInstanceId);
      logger.info(`[Server] Debug Freqtrade instance ${debugInstanceId} started successfully.`);
    } catch (debugError) {
      logger.error(`[Server] Failed to start debug Freqtrade instance ${debugInstanceId}: ${debugError.message}`, { stack: debugError.stack });
    }

    // 3. Setup WebSocket Server
    setupSocket(server); // setupSocket comes from your ./socket.js
    console.log(" WebSocket server initialized"); // Use logger.info

    // 4. Initialize Scheduler
    initScheduler(); // initScheduler from ./scheduler.js
    console.log(" Scheduler initialized"); // Use logger.info

    // 5. Start HTTP Server
    const PORT = process.env.PORT || 5002;
    server.listen(PORT, () => {
      logger.info(` Server running on port ${PORT} (${config.env} mode)`);
      logger.info(`🟢 Application ready! Access at http://localhost:${PORT}`);
    }).on('error', (err) => {
      logger.error(`❌ Server failed to start or encountered an error: ${err.message}`);
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use. Please ensure no other process is running on this port.`);
      }
      // Re-throw the error to be caught by the outer try-catch block
      throw err;
    });
  } catch (error) {
    console.error("❌ Server startup failed:", error); // Use logger.fatal or logger.error
    // Attempt graceful shutdown
    await mongoose
      .disconnect()
      .catch((err) => console.error("Failed to disconnect MongoDB:", err));
    disconnectPm2(); // This should also be the one from services/freqtrade/index.js
    process.exit(1);
  }
}

// --- Graceful Shutdown Handling ---
async function gracefulShutdown(signal) {
  console.log(`\n👋 Received ${signal}. Starting graceful shutdown...`); // logger.info
  stopScheduler(); // from ./scheduler.js

  // Disconnect PM2 first, as it might be managing processes that need to be stopped gracefully.
  // Ensure disconnectPm2 is the one from services/freqtrade/index.js (which delegates to freqtradeManager.js)
  // It internally checks if PM2 is connected before trying to disconnect.
  disconnectPm2();
  console.log(" PM2 service disconnected."); // logger.info

  // Close HTTP server to stop accepting new connections
  server.close(async () => {
    console.log("🚪 HTTP server closed."); // logger.info

    // Disconnect MongoDB after server is closed
    try {
      await mongoose.disconnect();
      console.log("🔌 MongoDB disconnected."); // logger.info
    } catch (err) {
      console.error("Error disconnecting MongoDB:", err); // logger.error
    }

    console.log("🏁 Shutdown complete."); // logger.info
    process.exit(0);
  });

  // Force shutdown if graceful shutdown takes too long
  setTimeout(() => {
    console.error("⚠️ Could not close connections in time, forcing shutdown."); // logger.error
    process.exit(1);
  }, 10000); // 10 seconds timeout
}

// Listen for termination signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Global error handlers
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason); // logger.error
  // Consider a more controlled shutdown or error reporting here
  // For now, it doesn't automatically call gracefulShutdown unless the nature of rejection requires it
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error); // logger.error
  // For uncaught exceptions, it's often safer to shut down as the app is in an unknown state.
  gracefulShutdown("UNCAUGHT_EXCEPTION");
});

// --- Start the Application ---
startServer();
