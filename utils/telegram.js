const axios = require("axios");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

exports.sendTelegramMessage = async (telegramId, message) => {
  if (!telegramId || !TELEGRAM_BOT_TOKEN) return;

  try {
    await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: telegramId,
      text: message,
      parse_mode: "Markdown",
    });
    console.log(`📨 Telegram message sent to ${telegramId}`);
  } catch (err) {
    console.error("❌ Telegram message failed:", err.message);
  }
};
