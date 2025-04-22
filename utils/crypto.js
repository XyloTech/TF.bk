// utils/crypto.js
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config(); // Load .env variables

const ALGORITHM = "aes-256-cbc"; // AES encryption algorithm
const SECRET_KEY = process.env.CRYPTO_SECRET_KEY; // Your secret key from .env
const IV_LENGTH = 16; // Initialization Vector length for AES

if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  console.error(
    "❌ FATAL: CRYPTO_SECRET_KEY is missing in .env or is not 32 characters long."
  );
  // Exit critically as encryption/decryption will fail
  process.exit(1);
}

// Use a constant key derived from the environment variable
const key = Buffer.from(SECRET_KEY, "utf-8");

// Encrypt function
function encrypt(text) {
  if (text === null || typeof text === "undefined" || text === "") {
    return text;
  }
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text.toString(), "utf8", "hex");
    encrypted += cipher.final("hex");
    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("Encryption error:", error);
    throw error;
  }
}

// Decrypt function
function decrypt(text) {
  if (
    text === null ||
    typeof text === "undefined" ||
    text === "" ||
    !text.includes(":")
  ) {
    return text; // Return as is if not seemingly encrypted
  }
  try {
    const parts = text.split(":");
    if (
      parts.length !== 2 ||
      Buffer.from(parts[0], "hex").length !== IV_LENGTH
    ) {
      console.error(
        "Decryption error: Invalid encrypted format (IV mismatch or missing)."
      );
      // Throw error because data format is incorrect
      throw new Error("Invalid encrypted data format.");
    }
    const iv = Buffer.from(parts.shift(), "hex");
    const encryptedText = parts.join(":");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed:", error.message);
    // Throw error to signal failure, prevents using corrupted data
    throw new Error(
      "Decryption failed. Check CRYPTO_SECRET_KEY and data integrity."
    );
  }
}

module.exports = { encrypt, decrypt };
