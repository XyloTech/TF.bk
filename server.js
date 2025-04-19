const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");

dotenv.config();

const app = express();
app.use(express.json());

// 🌍 CORS
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};
app.use(cors(corsOptions));

// 🔁 Health Check
app.get("/", (req, res) => {
  res.send("✅ CryptoBot Pro API is running...");
});

// 🔗 ROUTES
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

// 🧼 Global Error Handler
app.use(errorHandler);

// ⚙️ MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    maxPoolSize: 10,
  })
  .then(() => {
    console.log("✅ MongoDB connected");
    const PORT = process.env.PORT || 5000;
    const server = app.listen(PORT, () =>
      console.log(`🚀 Server running on port ${PORT}`)
    );

    // ✅ Setup WebSocket
    const { setupSocket } = require("./socket");
    setupSocket(server);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
  });
