// crypto-bot/middleware/securityHeaders.js
const helmet = require("helmet");

// Configure security headers
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // May need adjustment based on your specific needs
});

module.exports = securityHeaders;
