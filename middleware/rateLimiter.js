const rateLimit = require("express-rate-limit");

// 🔹 General API Rate Limit (60 requests per minute per IP)
const generalRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // Limit each IP to 60 requests per minute
  message: "Too many requests from this IP, please try again later.",
});

module.exports = { generalRateLimiter };
