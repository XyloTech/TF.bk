// crypto-bot/middleware/requestLogger.js
const logger = require("../utils/logger");

const requestLogger = (req, res, next) => {
  // Skip logging for health checks or other frequent endpoints
  if (req.path === "/" || req.path === "/health") {
    return next();
  }

  const start = process.hrtime();

  res.on("finish", () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;

    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration.toFixed(2)}ms`,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      userId: req.userDB?._id,
    };

    if (res.statusCode >= 400) {
      logger.warn(`HTTP ${req.method} ${req.path} ${res.statusCode}`, logData);
    } else {
      logger.info(`HTTP ${req.method} ${req.path} ${res.statusCode}`, logData);
    }
  });

  next();
};

module.exports = requestLogger;
