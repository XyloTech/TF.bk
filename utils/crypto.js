// utils/crypto.js
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config(); // Load .env variables

const ALGORITHM = "aes-256-cbc"; // AES encryption algorithm
const SECRET_KEY_HEX = process.env.CRYPTO_SECRET_KEY; // Your 64-char hex key from .env
const IV_LENGTH = 16; // Initialization Vector length for AES

// Validate the HEX string length and format for a 32-byte key
if (
  !SECRET_KEY_HEX ||
  SECRET_KEY_HEX.length !== 64 ||
  !/^[0-9a-fA-F]+$/.test(SECRET_KEY_HEX)
) {
  console.error(
    "❌ FATAL: CRYPTO_SECRET_KEY is missing in .env, is not 64 hex characters long, or contains invalid characters. It must represent a 32-byte key for aes-256-cbc."
  );
  // Exit critically as encryption/decryption will fail
  process.exit(1);
}

// Convert the hex string to a 32-byte Buffer
const key = Buffer.from(SECRET_KEY_HEX, "hex");

// Final check for the derived key's byte length
if (key.length !== 32) {
  console.error(
    "❌ FATAL: Derived key is not 32 bytes long. This should not happen if CRYPTO_SECRET_KEY is a valid 64-character hex string."
  );
  process.exit(1);
}

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
    throw error; // Re-throw the error so the caller can handle it
  }
}

// Decrypt function
function decrypt(text) {
  if (
    text === null ||
    typeof text === "undefined" ||
    text === "" ||
    !text.includes(":") // A basic check that it might be our encrypted format
  ) {
    return text; // Return as is if not seemingly encrypted
  }
  try {
    const parts = text.split(":");
    // Check if the IV part has the correct hex length (IV_LENGTH * 2 for hex)
    if (parts.length !== 2 || parts[0].length !== IV_LENGTH * 2) {
      console.warn(
        // Use warn as it might be an old unencrypted value
        "Decryption warning: Input text does not match expected encrypted format (IV length or parts mismatch). Returning original text.",
        text
      );
      return text; // Return original text if format is clearly wrong
    }

    const iv = Buffer.from(parts[0], "hex"); // parts.shift() modifies the array, so use index
    const encryptedText = parts[1]; // parts.join(':') is not needed if we ensure parts[0] is IV

    // Additional check for IV buffer length after conversion
    if (iv.length !== IV_LENGTH) {
      console.warn(
        "Decryption warning: Decoded IV length is incorrect. Returning original text.",
        text
      );
      return text;
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    console.error("Decryption failed for text:", text, "Error:", error.message);
    // It's safer to throw an error here if decryption truly fails after passing initial checks
    // Or, if you suspect old, unencrypted data might be passed, you could return the original text.
    // For now, throwing an error is better to signal a problem.
    // Consider that if `text` was actually an old unencrypted value, and `key` changed, this will fail.
    throw new Error(
      "Decryption failed. Check CRYPTO_SECRET_KEY and data integrity."
    );
  }
}

module.exports = { encrypt, decrypt };
