import "dotenv/config";
import checkRiver from "./riverMonitor.js";
import checkRainfall from "./rainfallMonitor.js";
import checkCommands from "./telegramCommands.js";
import { readState, writeState } from "./stateManager.js";
import { sendTelegram } from "./notifier.js";

async function main() {
  console.log("🚀 Flood Guardian starting...");

  // Run monitors once at start
  await checkRainfall();
  await checkRiver();

  console.log("📡 Listening for Telegram commands...");

  let lastMonitorCheck = Date.now();
  const FIVE_MINUTES = 5 * 60 * 1000;

  // For GitHub Actions, we run once and exit
  if (process.env.GITHUB_ACTIONS_RUN === "true") {
    console.log("🎬 Running single check for GitHub Actions...");
    await checkCommands();
    return;
  }

  while (true) {
    try {
      // --- Watchdog Check ---
      const state = readState();
      const now = Date.now();
      const lastCheck = state.health?.lastCheck || 0;
      const minutesSinceLastCheck = Math.floor((now - lastCheck) / 60000);

      if (lastCheck > 0) {
        if (minutesSinceLastCheck >= 40 && !state.health.watchdogUrgentAlerted) {
          await sendTelegram(`🚨 <b>Flood Guardian Urgent Issue</b>\n\nNo successful monitoring in ${minutesSinceLastCheck} mins.\nThis is a critical delay. Please check GitHub Actions or the local PC.`);
          state.health.watchdogUrgentAlerted = true;
          writeState(state);
        } else if (minutesSinceLastCheck >= 20 && !state.health.watchdogWarningAlerted) {
          await sendTelegram(`⚠️ <b>Flood Guardian Check Delayed</b>\n\nNo successful monitoring in ${minutesSinceLastCheck} mins.\nRecommend manual /status check.`);
          state.health.watchdogWarningAlerted = true;
          writeState(state);
        }
      }

      // Check for commands (Long Polling - waits up to 30s)
      await checkCommands();

      // Periodically check monitors every 5 minutes
      if (Date.now() - lastMonitorCheck > FIVE_MINUTES) {
        console.log("🔄 Running periodic monitor check...");
        await checkRainfall();
        await checkRiver();
        lastMonitorCheck = Date.now();
      }
    } catch (error) {
      console.error("Loop error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

main();
