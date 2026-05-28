import axios from "axios";
import fs from "fs";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Sends a message to a specific Telegram chat with optional buttons.
 */
export async function sendTelegram(message, customChatId = CHAT_ID, replyMarkup = null) {
  if (!BOT_TOKEN) return;

  try {
    const payload = {
      chat_id: customChatId,
      text: message,
      parse_mode: "HTML",
    };

    if (replyMarkup) {
      payload.reply_markup = replyMarkup;
    }

    await axios.post(`${TELEGRAM_URL}/sendMessage`, payload);
  } catch (error) {
    console.error(`Telegram Error (${customChatId}):`, error.response?.data?.description || error.message);
  }
}

/**
 * Sends a message to all recipients in recipients.json.
 */
export async function broadcastTelegram(message) {
  try {
    const recipients = JSON.parse(fs.readFileSync("./recipients.json", "utf-8"));
    const promises = recipients.map(r => sendTelegram(message, r.chatId));
    await Promise.all(promises);
    console.log(`Broadcasted message to ${recipients.length} recipients.`);
  } catch (error) {
    console.error("Broadcast Error:", error.message);
    await sendTelegram(message);
  }
}

/**
 * Common Button Layouts
 */
export const KEYBOARDS = {
  main: {
    keyboard: [
      [{ text: "/status" }, { text: "/predict" }, { text: "/trend" }],
      [{ text: "/weather" }, { text: "/storm" }, { text: "/map" }],
      [{ text: "/checklist" }, { text: "/report" }, { text: "/emergency" }],
      [{ text: "/help" }, { text: "/history" }]
    ],
    resize_keyboard: true,
    persistent: true
  },
  report: {
    inline_keyboard: [
      [{ text: "🦶 Sakong", callback_data: "depth_Sakong" }, { text: "🦵 Tuhod", callback_data: "depth_Tuhod" }],
      [{ text: "🚶 Tao", callback_data: "depth_Tao" }, { text: "🚨 Lagpas-Tao", callback_data: "depth_Lagpas" }],
      [{ text: "✅ Wala nang baha", callback_data: "depth_None" }]
    ]
  }
};
