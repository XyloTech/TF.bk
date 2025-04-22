// crypto-bot/middleware/errorHandler.js
const logger = require("../utils/logger");

const errorHandler = (err, req, res, next) => {
  // Log error with request details
  const errorDetails = {
    method: req.method,
    path: req.path,
    query: req.query,
    body: req.method === "POST" || req.method === "PUT" ? req.body : undefined,
    error: err.message,
    stack: process.env.NODE_ENV === "production" ? undefined : err.stack,
  };

  logger.error(`API Error: ${err.message}`, errorDetails);

  // Custom error types handling
  if (err.name === "ValidationError") {
    return res.status(400).json({
      message: "Validation failed",
      errors: err.errors || [err.message],
    });
  }

  if (err.name === "UnauthorizedError") {
    return res.status(401).json({ message: "Invalid or expired token" });
  }

  if (err.name === "ForbiddenError") {
    return res.status(403).json({ message: err.message || "Access denied" });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    return res.status(409).json({
      message: "Duplicate entry error",
      field: Object.keys(err.keyValue || {})[0],
    });
  }

  // Default error response
  const statusCode = err.status || err.statusCode || 500;
  const response = {
    message: err.message || "Internal Server Error",
  };

  // Only include stack trace in development
  if (process.env.NODE_ENV !== "production") {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
