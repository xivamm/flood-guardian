import axios from "axios";
import fs from "fs";
import { sendTelegram, broadcastTelegram, KEYBOARDS } from "./notifier.js";
import { readState, writeState, readConfig } from "./stateManager.js";
import checkRiver from "./riverMonitor.js";
import checkRainfall from "./rainfallMonitor.js";
import { getAccuracyStats } from "./shadowMode.js";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Removes reports older than 3 hours
 */
function cleanupReports(state) {
  const now = Date.now();
  const threeHours = 3 * 60 * 60 * 1000;
  if (!state.communityReports) state.communityReports = [];
  state.communityReports = state.communityReports.filter(r => (now - r.timestamp) < threeHours);
}

export async function checkCommands() {
  try {
    const state = readState();
    let lastUpdateId = state.lastUpdateId || 0;

    const response = await axios.get(
      `${TELEGRAM_URL}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`
    );

    const updates = response.data.result;

    if (!updates || !updates.length) {
      console.log("No new commands");
      return;
    }

    for (const update of updates) {
      lastUpdateId = update.update_id;
      
      // --- Handle Button Clicks (Callback Queries) ---
      if (update.callback_query) {
        const cb = update.callback_query;
        const data = cb.data;
        const chatId = cb.message.chat.id;
        const freshState = readState();

        if (data.startsWith("depth_")) {
          const depth = data.replace("depth_", "");
          
          if (!freshState.communityReports) freshState.communityReports = [];
          
          // Update or add report
          const existingIdx = freshState.communityReports.findIndex(r => r.chatId === chatId);
          if (existingIdx > -1) {
            freshState.communityReports[existingIdx] = { chatId, depth, timestamp: Date.now() };
          } else {
            freshState.communityReports.push({ chatId, depth, timestamp: Date.now() });
          }

          cleanupReports(freshState);
          writeState(freshState);

          await axios.post(`${TELEGRAM_URL}/answerCallbackQuery`, { callback_query_id: cb.id, text: `Salamat sa ulat! (${depth})` });
          await sendTelegram(`✅ <b>Ulat Natanggap:</b> ${depth}\nSalamat sa pakikipagtulungan, kababayan!`, chatId);
          
          // Refresh dashboard
          await checkRiver();
        }
        continue;
      }

      const text = update.message?.text;
      const chatId = update.message?.chat?.id;

      if (!text || !chatId) continue;

      // Re-read state for each command
      const freshState = readState();
      const config = readConfig();
      const recipients = JSON.parse(fs.readFileSync("./recipients.json", "utf-8"));
      const isAdmin = recipients.some(r => r.chatId === chatId.toString()) || chatId.toString() === process.env.TELEGRAM_CHAT_ID;

      console.log(`Command received: ${text} from ${chatId} (Admin: ${isAdmin})`);

      const parts = text.split(' ');
      const cmd = parts[0];
      const arg = parts[1];

      // Admin security gate
      const adminCommands = ["/testmode", "/simulate", "/testalert", "/accuracy", "/health", "/language"];
      if (adminCommands.includes(cmd) && !isAdmin) {
        await sendTelegram("❌ <b>Access Denied</b>\nThis command is restricted to administrators.", chatId);
        continue;
      }

      switch (cmd) {
        case "/status":
          await sendTelegram(freshState.latestDashboard || "🛟 No dashboard data yet.", chatId, KEYBOARDS.main);
          break;
        
        case "/predict":
          await sendTelegram(freshState.latestPredictionUpdate || "🧠 No prediction data yet. Monitoring in progress...", chatId, KEYBOARDS.main);
          break;

        case "/checklist":
          await sendTelegram(freshState.latestChecklist || "📋 No checklist data yet. Monitoring in progress...", chatId, KEYBOARDS.main);
          break;

        case "/report":
          await sendTelegram("📢 <b>Bayanihan Flood Report</b>\n\nGaano na po kataas ang baha sa mismong kinalalagyan niyo ngayon? Tap a button below:", chatId, KEYBOARDS.report);
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
          await sendTelegram(freshState.latestStormUpdate || "🌀 No storm data yet. Monitoring in progress...", chatId, KEYBOARDS.main);
          break;

        case "/accuracy":
          await sendTelegram(getAccuracyStats(freshState), chatId);
          break;

        case "/emergency":
          const dir = config.directory || {};
          const emergencyMsg = 
`☎️ <b>EMERGENCY DIRECTORY</b>
━━━━━━━━━━━━━━
Valenzuela City Hotlines:

• 🚑 <b>Rescue:</b> ${dir.Rescue}
• 👮 <b>Police:</b> ${dir.Police}
• 🚒 <b>Fire:</b> ${dir.Fire}
• ⛑️ <b>Red Cross:</b> ${dir.Red_Cross || dir["Red Cross"]}
• 📞 <b>National:</b> 911

<i>Tap the number to call. Stay safe!</i>`;
          await sendTelegram(emergencyMsg, chatId, KEYBOARDS.main);
          break;

        case "/map":
          const mapMsg = 
`🗺️ <b>HAZARD MAP</b>
━━━━━━━━━━━━━━
View the official Valenzuela City Flood Hazard Map to see high-risk streets and evacuation centers.

🔗 <a href="${config.mapLink}">Open Hazard Map</a>`;
          await sendTelegram(mapMsg, chatId, KEYBOARDS.main);
          break;

        case "/language":
          if (arg === "en") {
            config.language = "English";
            await sendTelegram("✅ Language set to <b>English</b>.", chatId);
          } else {
            config.language = "Tagalog";
            await sendTelegram("✅ Language set to <b>Tagalog</b>.", chatId);
          }
          fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
          break;

        case "/testalert":
          await sendTelegram("🔄 <b>BROADCAST TEST</b>\nSending test alerts to all registered recipients...", chatId);
          await broadcastTelegram("🔔 <b>FAMILY ALERT TEST</b>\nThis is a sample flood alert broadcast to all family members.\n\nStatus: 🟢 System Active");
          break;

        case "/testmode":
          if (arg === "on") {
            freshState.isTestMode = true;
            writeState(freshState);
            await sendTelegram("🧪 <b>TEST MODE: ON</b>\nReal monitoring is paused. Simulating initial state...", chatId);
            await checkRainfall();
            await checkRiver();
          } else {
            freshState.isTestMode = false;
            freshState.testMockData = null;
            writeState(freshState);
            await sendTelegram("✅ <b>TEST MODE: OFF</b>\nResuming real-time monitoring...", chatId);
            await checkRainfall();
            await checkRiver();
          }
          break;

        case "/simulate":
          if (!freshState.isTestMode) {
            await sendTelegram("❌ Please turn on /testmode first.", chatId);
            break;
          }
          
          let mock = {
            laMesa: { current: 78.50, alert: 79.00, alarm: 79.30, critical: 79.50 },
            ugong: { current: 10.00, alert: 14.85, alarm: 15.70, critical: 16.60 },
            weatherRawText: "Cloudy skies. No rainfall warning."
          };

          if (arg === "rain") {
            mock.weatherRawText = "Yellow Rainfall Warning in Metro Manila.";
            mock.laMesa.current = 78.85;
          } else if (arg === "habagat") {
            mock.weatherRawText = "Southwest Monsoon (Habagat) enhanced by Tropical Storm JANGMI.";
            mock.laMesa.current = 79.10;
            mock.ugong.current = 12.50;
          } else if (arg === "rising") {
            mock.weatherRawText = "Orange Rainfall Warning in NCR.";
            mock.laMesa.current = 79.35;
            mock.ugong.current = 14.90;
          } else if (arg === "flood") {
            mock.weatherRawText = "Red Rainfall Warning in Valenzuela. Typhoon JANGMI moving towards NCR.";
            mock.laMesa.current = 79.80;
            mock.ugong.current = 16.70;
          }

          freshState.testMockData = mock;
          writeState(freshState);
          await sendTelegram(`🧪 <b>Scenario Started: ${arg || "stable"}</b>\nUpdating dashboard...`, chatId);
          await checkRainfall();
          await checkRiver();
          break;

        case "/history":
          if (!freshState.history || freshState.history.length === 0) {
            await sendTelegram("📜 No history data available yet.", chatId);
          } else {
            const recent = freshState.history.slice(-6);
            let historyMsg = "📜 <b>RECENT TRENDS</b>\n━━━━━━━━━━━━━━\n\n";
            
            historyMsg += "<b>River Levels:</b>\n";
            recent.forEach(h => {
              const time = new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const testTag = h.isTest ? "🧪 " : "";
              historyMsg += `• ${time}: ${testTag}${h.laMesaLevel?.toFixed(2)}m → ${h.trend?.split(' ')[1] || "Stable"}\n`;
            });

            const rainHistory = recent.map(h => h.rainfall || "NONE").join(" → ");
            historyMsg += `\n<b>Rainfall:</b>\n${rainHistory}`;
            
            await sendTelegram(historyMsg, chatId, KEYBOARDS.main);
          }
          break;

        case "/health":
          const now = Date.now();
          const lastCheckMins = freshState.health?.lastCheck ? Math.floor((now - freshState.health.lastCheck) / 60000) : "N/A";
          
          const riverStatusIcon = freshState.health?.riverMonitor === "Online" ? "✅" : "⚠️";
          const weatherStatusIcon = freshState.health?.weatherMonitor === "Online" ? "✅" : "⚠️";
          const heartbeatIcon = (typeof lastCheckMins === "number" && lastCheckMins < 20) ? "✅" : "⚠️";

          const healthMsg = 
`⚙️ <b>SYSTEM HEALTH</b>
━━━━━━━━━━━━━━
${riverStatusIcon} River Monitor: ${freshState.health?.riverMonitor || "Unknown"}
${weatherStatusIcon} Rainfall Monitor: ${freshState.health?.weatherMonitor || "Unknown"}
${heartbeatIcon} Last Check: ${lastCheckMins} mins ago
✅ Prediction Engine: Healthy
✅ Telegram: Connected
${freshState.isTestMode ? "🧪 Mode: TEST MODE ON" : "✅ Mode: LIVE"}`;
          await sendTelegram(healthMsg, chatId);
          break;
        
        case "/help":
          const helpMessage = 
`🤖 <b>FLOOD GUARDIAN HELP</b>
━━━━━━━━━━━━━━

📢 <b>PUBLIC COMMANDS</b>
/status - Full flood dashboard
/weather - PAGASA weather update
/predict - Flood risk prediction
/checklist - Emergency actions
/report - Send a flood report
/storm - Tropical Cyclone Watch
/emergency - Important hotlines
/map - Hazard map link

ℹ️ <b>DETAILS</b>
/river - Detailed river levels
/trend - River movement trend
/history - Recent trend logs
/help - Show this message

${isAdmin ? `🧪 <b>ADMIN CONTROLS</b>
/health - Check bot status
/accuracy - Reliability logs
/language [tag/en] - Switch language
/testalert - Test notifications
/testmode [on/off]
/simulate [scenario]` : ""}

<i>Monitoring Tullahan / Valenzuela area.</i>`;
          await sendTelegram(helpMessage, chatId, KEYBOARDS.main);
          break;
      }
    }

    const finalState = readState();
    finalState.lastUpdateId = lastUpdateId;
    writeState(finalState);

  } catch (error) {
    console.error("Command error:", error.response?.data?.description || error.message);
  }
}

export default checkCommands;
