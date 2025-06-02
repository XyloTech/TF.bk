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

const server = http.createServer(app);

// mongoose.set("debug", true); // Keep this for dev, consider removing for prod
// --- Core Middleware ---
app.use(express.json({ limit: "1mb" }));
app.use(securityHeaders); // Your custom security headers from middleware
// app.use(helmet()); // If securityHeaders isn't a full replacement for helmet, you might want both or to integrate.
app.use(requestLogger);

// --- CORS Configuration ---
app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || config.cors.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        logger.warn(`CORS: Blocked origin - ${origin}`); // Added logging for blocked origins
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

// --- Not Found Handler (for API routes) ---
app.use("/api/*", (req, res, next) => {
  res.status(404).json({ message: "API endpoint not found." });
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

    // 3. Setup WebSocket Server
    setupSocket(server); // setupSocket comes from your ./socket.js
    console.log(" WebSocket server initialized"); // Use logger.info

    // 4. Initialize Scheduler
    initScheduler(); // initScheduler from ./scheduler.js
    console.log(" Scheduler initialized"); // Use logger.info

    // 5. Start HTTP Server
    const PORT = config.port;
    server.listen(PORT, () => {
      console.log(` Server running on port ${PORT} (${config.env} mode)`); // Use logger.info
      console.log(`🟢 Application ready! Access at http://localhost:${PORT}`); // Use logger.info
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
