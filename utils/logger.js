const { createLogger, format, transports } = require("winston");

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(), // Logs to console
    new transports.File({ filename: "logs/error.log", level: "error" }), // Logs errors to file
    new transports.File({ filename: "logs/combined.log" }), // Logs everything
  ],
});

module.exports = logger;
