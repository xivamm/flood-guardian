import axios from "axios";
import fs from "fs";
import { sendTelegram, broadcastTelegram, KEYBOARDS } from "./notifier.js";
import { readState, writeState, readConfig } from "./stateManager.js";
import checkRiver from "./riverMonitor.js";
import checkRainfall from "./rainfallMonitor.js";
import { getAccuracyStats } from "./shadowMode.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

function cleanupReports(state) {
  const now = Date.now();
  if (!state.communityReports) state.communityReports = [];
  state.communityReports = state.communityReports.filter(r => (now - r.timestamp) < 10800000);
}

export async function checkCommands() {
  try {
    const state = readState();
    let lastUpdateId = state.lastUpdateId || 0;
    const response = await axios.get(`${TELEGRAM_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
    const updates = response.data.result;
    if (!updates || !updates.length) return;

    for (const update of updates) {
      lastUpdateId = update.update_id;
      if (update.callback_query) {
        const cb = update.callback_query;
        const freshState = readState();
        if (cb.data.startsWith("depth_")) {
          const depth = cb.data.replace("depth_", "");
          if (!freshState.communityReports) freshState.communityReports = [];
          const idx = freshState.communityReports.findIndex(r => r.chatId === cb.message.chat.id);
          if (idx > -1) freshState.communityReports[idx] = { chatId: cb.message.chat.id, depth, timestamp: Date.now() };
          else freshState.communityReports.push({ chatId: cb.message.chat.id, depth, timestamp: Date.now() });
          cleanupReports(freshState);
          writeState(freshState);
          await axios.post(`${TELEGRAM_URL}/answerCallbackQuery`, { callback_query_id: cb.id, text: `Salamat! (${depth})` });
          await sendTelegram(`✅ <b>Ulat Natanggap</b>\nDepth: ${depth}\nSalamat sa pakikipagtulungan!`, cb.message.chat.id);
          await checkRiver();
        }
        continue;
      }

      const text = update.message?.text;
      const chatId = update.message?.chat?.id;
      if (!text || !chatId) continue;

      const freshState = readState();
      const config = readConfig();
      const recipients = JSON.parse(fs.readFileSync("./recipients.json", "utf-8"));
      const isAdmin = recipients.some(r => r.chatId === chatId.toString()) || chatId.toString() === process.env.TELEGRAM_CHAT_ID;
      const cmd = text.split(' ')[0];
      const arg = text.split(' ')[1];

      const adminCommands = ["/testmode", "/simulate", "/testalert", "/accuracy", "/health", "/language"];
      if (adminCommands.includes(cmd) && !isAdmin) {
        await sendTelegram("❌ <b>Access Denied</b>\nThis command is restricted to admins.", chatId);
        continue;
      }

      switch (cmd) {
        case "/status":
          await sendTelegram(freshState.latestDashboard || "🛟 No dashboard data yet.", chatId, KEYBOARDS.main);
          break;
        case "/predict":
          await sendTelegram(freshState.latestPredictionUpdate || "🧠 No prediction data yet.", chatId, KEYBOARDS.main);
          break;
        case "/checklist":
          await sendTelegram(freshState.latestChecklist || "📋 No checklist data yet.", chatId, KEYBOARDS.main);
          break;
        case "/report":
          await sendTelegram("📢 <b>Bayanihan Flood Report</b>\nGaano na po kataas ang baha sa inyo? Tap below:", chatId, KEYBOARDS.report);
          break;
        case "/river":
          await sendTelegram(freshState.latestRiverUpdate || "🌊 No river data yet.", chatId, KEYBOARDS.main);
          break;
        case "/weather":
          await sendTelegram(freshState.latestWeatherUpdate || "🌦 No weather data yet.", chatId, KEYBOARDS.main);
          break;
        case "/trend":
          await sendTelegram(freshState.latestTrendUpdate || "📈 No trend data yet.", chatId, KEYBOARDS.main);
          break;
        case "/storm":
          await sendTelegram(freshState.latestStormUpdate || "🌀 No storm data yet.", chatId, KEYBOARDS.main);
          break;
        case "/accuracy":
          await sendTelegram(getAccuracyStats(freshState), chatId);
          break;
        case "/emergency":
          const dir = config.directory || {};
          await sendTelegram(`☎️ <b>EMERGENCY DIRECTORY</b>\n━━━━━━━━━━━━━━\nValenzuela City Hotlines:\n\n• 🚑 Rescue: ${dir.Rescue}\n• 👮 Police: ${dir.Police}\n• 🚒 Fire: ${dir.Fire}\n• 📞 National: 911\n\n<i>Tap to call. Stay safe!</i>`, chatId, KEYBOARDS.main);
          break;
        case "/map":
          await sendTelegram(`🗺️ <b>HAZARD MAP</b>\n━━━━━━━━━━━━━━\nView official high-risk areas.\n\n🔗 <a href="${config.mapLink}">Open Hazard Map</a>`, chatId, KEYBOARDS.main);
          break;
        case "/language":
          config.language = arg === "en" ? "English" : "Tagalog";
          fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
          await sendTelegram(`✅ Language set to <b>${config.language}</b>.`, chatId);
          break;
        case "/testalert":
          await broadcastTelegram("🔔 <b>FAMILY ALERT TEST</b>\nPremium Alert UI Test.\n\nStatus: 🟢 System Active");
          break;
        case "/testmode":
          freshState.isTestMode = arg === "on";
          writeState(freshState);
          await sendTelegram(`🧪 <b>TEST MODE: ${freshState.isTestMode ? "ON" : "OFF"}</b>`, chatId);
          await checkRainfall(); await checkRiver();
          break;
        case "/simulate":
          if (!freshState.isTestMode) { await sendTelegram("❌ Turn on /testmode first.", chatId); break; }
          let mock = { laMesa: { current: 78.50, alert: 79.00, alarm: 79.30, critical: 79.50 }, ugong: { current: 10.00, alert: 14.85, alarm: 15.70, critical: 16.60 }, weatherRawText: "Cloudy." };
          if (arg === "flood") { mock.weatherRawText = "Red Rainfall. Typhoon."; mock.laMesa.current = 79.80; mock.ugong.current = 16.70; }
          else if (arg === "rising") { mock.weatherRawText = "Orange. Rising."; mock.laMesa.current = 79.35; mock.ugong.current = 14.90; }
          freshState.testMockData = mock; writeState(freshState);
          await sendTelegram(`🧪 <b>Scenario: ${arg}</b>`, chatId);
          await checkRainfall(); await checkRiver();
          break;
        case "/history":
          if (!freshState.history || !freshState.history.length) { await sendTelegram("📜 No history yet.", chatId); break; }
          const recent = freshState.history.slice(-6);
          let hMsg = "📜 <b>RECENT TRENDS</b>\n━━━━━━━━━━━━━━\n\n";
          recent.forEach(h => {
            const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            hMsg += `• ${time}: ${h.isTest ? "🧪 " : ""}${h.laMesaLevel?.toFixed(2)}m (${h.trend?.split(' ')[1] || "Stable"})\n`;
          });
          await sendTelegram(hMsg, chatId, KEYBOARDS.main);
          break;
        case "/health":
          const lastCheckMins = freshState.health?.lastCheck ? Math.floor((Date.now() - freshState.health.lastCheck) / 60000) : "N/A";
          await sendTelegram(`⚙️ <b>SYSTEM HEALTH</b>\n━━━━━━━━━━━━━━\n✅ River: ${freshState.health?.riverMonitor}\n✅ Weather: ${freshState.health?.weatherMonitor}\n✅ Last: ${lastCheckMins} mins ago\n✅ Status: LIVE`, chatId);
          break;
        case "/help":
          const helpMsg = 
`🤖 <b>FLOOD GUARDIAN HELP</b>
━━━━━━━━━━━━━━━━

🌊 <b>FLOOD</b>
/status - Dashboard
/predict - Prediction
/trend - Movement
/checklist - Actions
/history - Logs

🌧 <b>WEATHER</b>
/weather - Rainfall
/storm - Cyclone
/map - Hazard Map

🚨 <b>EMERGENCY</b>
/emergency - Hotlines
/report - Send Report

${isAdmin ? `🧪 <b>ADMIN</b>
/health - Status
/accuracy - Reliability
/language - Toggle
/testmode - Simulation` : ""}

<i>Monitoring Tullahan / Valenzuela.</i>`;
          await sendTelegram(helpMsg, chatId, KEYBOARDS.main);
          break;
      }
    }
    const finalState = readState();
    finalState.lastUpdateId = lastUpdateId;
    writeState(finalState);
  } catch (error) {
    console.error("Command error:", error.message);
  }
}

export default checkCommands;
