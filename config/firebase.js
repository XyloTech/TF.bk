const admin = require("firebase-admin");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");

// Define the path correctly
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

// Check if file exists before parsing
if (!fs.existsSync(serviceAccountPath)) {
  logger.error("❌ Firebase serviceAccountKey.json file is missing!");
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

logger.info("✅ Firebase Admin SDK initialized successfully.");

module.exports = admin;
