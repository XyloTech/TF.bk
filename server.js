const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const errorHandler = require("./middleware/errorHandler");

dotenv.config();

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send(
    "CryptoBot Pro - Automated Cryptocurrency Trading app is running..."
  );
});

const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};
app.use(cors(corsOptions));

// Import Routes
const authRoutes = require("./routes/authRoutes"); // Handles login, register
const userRoutes = require("./routes/userRoutes"); // Handles user profile & API keys
const transactionRoutes = require("./routes/transactionRoutes"); // Handles transactions

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/transactions", transactionRoutes);

mongoose.connect(process.env.MONGO_URI, {
  maxPoolSize: 10, // Optimized for high traffic
});

app.use(errorHandler); // Global error handler

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
