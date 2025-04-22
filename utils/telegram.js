// crypto-bot/utils/telegram.js
const axios = require("axios");

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

exports.sendTelegramMessage = async (telegramId, message) => {
  if (!telegramId || !TELEGRAM_BOT_TOKEN) {
    console.warn("Missing telegramId or TELEGRAM_BOT_TOKEN");
    return false;
  }

  try {
    const response = await axios.post(`${TELEGRAM_API_URL}/sendMessage`, {
      chat_id: telegramId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    if (response.data && response.data.ok) {
      console.log(`📨 Telegram message sent to ${telegramId}`);
      return true;
    } else {
      console.error("❌ Telegram API error:", response.data);
      return false;
    }
  } catch (err) {
    console.error("❌ Telegram message failed:", err.message);
    return false;
  }
};
