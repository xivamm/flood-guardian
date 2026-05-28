import puppeteer from "puppeteer";
import { sendTelegram, broadcastTelegram } from "./notifier.js";
import { readState, writeState, readConfig } from "./stateManager.js";
import { generatePrediction } from "./predictionEngine.js";
import { processShadowLearning } from "./shadowMode.js";
import { generateChecklist } from "./checklistGenerator.js";

function getStatus(current, alert, alarm, critical) {
  if (current >= critical) return "CRITICAL";
  if (current >= alarm) return "ALARM";
  if (current >= alert) return "ALERT";
  return "NORMAL";
}

function emojiStatus(status) {
  switch (status) {
    case "CRITICAL": return "🔴";
    case "ALARM": return "🟠";
    case "ALERT": return "🟡";
    case "NORMAL": return "🟢";
    default: return "⚪";
  }
}

function getFloodVibe(score) {
  if (score >= 71) return { emoji: "🚨", label: "READY MODE", bar: "🟥" };
  if (score >= 46) return { emoji: "⚠️", label: "PREPARE MODE", bar: "🟧" };
  if (score >= 21) return { emoji: "👀", label: "OBSERVE MODE", bar: "🟨" };
  return { emoji: "✅", label: "CHILL MODE", bar: "🟩" };
}

async function checkRiver() {
  let browser;
  const state = readState();
  const config = readConfig();
  const now = Date.now();
  const testHeader = state.isTestMode ? "🧪 <b>TEST MODE</b>\n<i>This is a simulation. No real flood detected.</i>\n\n" : "";

  try {
    let laMesa = null;
    let ugong = null;
    let laMesaStatus = "UNKNOWN";
    let ugongStatus = "OFFLINE";

    if (state.isTestMode && state.testMockData) {
      console.log("🧪 Using Mock River Data...");
      laMesa = state.testMockData.laMesa;
      ugong = state.testMockData.ugong;
    } else {
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });

      const page = await browser.newPage();
      await page.goto("https://pasig-marikina-tullahanffws.pagasa.dost.gov.ph/water/table.do", {
        waitUntil: "networkidle2",
        timeout: 60000
      });

      await new Promise(resolve => setTimeout(resolve, 8000));

      const rawPageText = await page.evaluate(() => document.body.innerText);
      const pageText = rawPageText.replace(/\(\*\)/g, "");

      const parseDam = (name, text) => {
        const regex = new RegExp(`${name}\\s+([\\d.]+)\\s+[\\d.]+\\s+[\\d.]+\\s+[\\d.]+\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`, 'i');
        const match = text.match(regex);
        return match ? {
          current: parseFloat(match[1]),
          alert: parseFloat(match[2]),
          alarm: parseFloat(match[3]),
          critical: parseFloat(match[4])
        } : null;
      };

      laMesa = parseDam("La Mesa Dam", pageText);
      ugong = parseDam("Ugong", pageText);
    }

    // Update Health
    state.health.riverMonitor = "Online";
    state.health.lastSuccessfulRiverCheck = now;
    state.health.lastCheck = now;
    state.health.riverStaleAlerted = false;

    const rainfall = state.lastRainWarning || "NONE";
    laMesaStatus = laMesa ? getStatus(laMesa.current, laMesa.alert, laMesa.alarm, laMesa.critical) : "UNKNOWN";
    ugongStatus = ugong && ugong.current > 0 ? getStatus(ugong.current, ugong.alert, ugong.alarm, ugong.critical) : "OFFLINE";

    // --- Community Report Summary ---
    const threeHours = 3 * 60 * 60 * 1000;
    if (!state.communityReports) state.communityReports = [];
    state.communityReports = state.communityReports.filter(r => (now - r.timestamp) < threeHours);
    
    const counts = state.communityReports.reduce((acc, r) => {
      acc[r.depth] = (acc[r.depth] || 0) + 1;
      return acc;
    }, {});
    
    let communitySummary = "No reports from residents yet.";
    if (state.communityReports.length > 0) {
      communitySummary = Object.entries(counts)
        .map(([depth, count]) => `• ${depth}: ${count} report${count > 1 ? 's' : ''}`)
        .join("\n");
    }

    // Scoring & Logic
    let score = 0;
    let reasons = [];
    if (laMesaStatus === "CRITICAL") { score += 40; reasons.push("High upstream water"); }
    else if (laMesaStatus === "ALARM") { score += 25; reasons.push("Rising upstream water"); }
    
    if (ugongStatus === "CRITICAL") { score += 30; reasons.push("Local river critical"); }
    
    // Community reports impact score
    if (counts.Tao || counts.Lagpas) score += 20;

    if (rainfall === "RED") { score += 45; reasons.push("Heavy rainfall warning"); }
    else if (rainfall === "ORANGE") { score += 30; reasons.push("Strong rainfall warning"); }

    const prevLaMesa = state.lastLaMesaLevel || laMesa?.current;
    let trendText = "➡ Stable";
    if (laMesa && prevLaMesa) {
      const diff = laMesa.current - prevLaMesa;
      if (diff >= 0.03) trendText = `⬆ Rising (+${diff.toFixed(2)}m)`;
      else if (diff <= -0.03) trendText = `⬇ Lowering (${Math.abs(diff).toFixed(2)}m)`;
    }

    const vibe = getFloodVibe(score);
    const riskBar = vibe.bar.repeat(Math.floor(score / 10)) + "⬜".repeat(10 - Math.floor(score / 10));

    // UI Template
    const dashboard = 
`${testHeader}🛟 <b>FLOOD GUARDIAN DASHBOARD</b>
━━━━━━━━━━━━━━

📍 <b>${config.areaName}</b>
🌊 <b>River Status:</b>
• La Mesa: ${emojiStatus(laMesaStatus)} ${laMesaStatus} (${laMesa?.current?.toFixed(2) || "N/A"})
• ${config.nearbyRiver}: ${emojiStatus(ugongStatus)} ${ugongStatus} (${ugong?.current?.toFixed(2) || "N/A"})

📈 <b>Trend:</b> ${trendText}
🌧 <b>Weather:</b> ${rainfall === "NONE" ? "🟢 Normal" : `⚠️ ${rainfall}`}

🧠 <b>FLOOD RISK:</b> ${score}%
${vibe.emoji} <b>${vibe.label}</b>
${riskBar}

💡 <b>Why?</b>
${reasons.length ? reasons.map(r => `• ${r}`).join("\n") : "• Stable environment"}

👥 <b>Community Reports (Last 3h):</b>
${communitySummary}

❤️ <b>Advice:</b>
${score >= 71 ? "Ready mode — prepare for possible evacuation." : 
  score >= 46 ? "Prepare mode — keep monitoring." : 
  score >= 21 ? "Observe mode — check for updates." : "Chill mode — safe and stable."}`;

    // Save state
    state.latestDashboard = dashboard;
    state.latestRiverUpdate = 
`${testHeader}🌊 <b>RIVER DETAILS</b>\n━━━━━━━━━━━━━━\n<b>La Mesa:</b> ${laMesa?.current?.toFixed(2)}m\n<b>Status:</b> ${laMesaStatus}\n\n<b>Community Feedback:</b>\n${communitySummary}`;
    state.latestTrendUpdate = 
`${testHeader}📈 <b>MOVEMENT & TREND</b>\n━━━━━━━━━━━━━━\n<b>Movement:</b> ${trendText}\n<b>Last:</b> ${prevLaMesa?.toFixed(2)}m\n<b>New:</b> ${laMesa?.current?.toFixed(2)}m`;

    const prediction = generatePrediction(state, { laMesa, ugong });
    state.latestPredictionUpdate = `${testHeader}${prediction.message.replace(testHeader, "")}`;
    state.latestChecklist = generateChecklist(prediction.status);
    processShadowLearning(state, { laMesa, ugong }, prediction);

    if (!state.history) state.history = [];
    state.history.push({
      timestamp: new Date().toISOString(),
      laMesaLevel: laMesa?.current,
      ugongLevel: ugong?.current,
      rainfall: rainfall,
      score: score,
      trend: trendText,
      isTest: state.isTestMode
    });

    state.lastLaMesaLevel = laMesa?.current;
    state.lastUgongLevel = ugong?.current;

    const snapshot = JSON.stringify({ laMesaStatus, rainfall, trendText, score, predictionStatus: prediction.status });
    const changed = snapshot !== state.lastDashboardSnapshot;
    
    const lastSnapshot = JSON.parse(state.lastDashboardSnapshot || "{}");
    const oldPredictionStatus = lastSnapshot.predictionStatus || "Stable";
    const newPredictionStatus = prediction.status;
    const statusOrder = ["Stable", "Possible Rise 👀", "Rising Risk ⚠️", "High Flood Potential 🚨"];
    const oldIndex = statusOrder.indexOf(oldPredictionStatus);
    const newIndex = statusOrder.indexOf(newPredictionStatus);
    const lastAlertTime = state.lastAlertTime || 0;
    const twoHours = 2 * 60 * 60 * 1000;

    if (newIndex > oldIndex) {
      if (newPredictionStatus !== state.lastAlertedStatus || (now - lastAlertTime > twoHours)) {
        await broadcastTelegram(`${testHeader}🚨 <b>RISK ESCALATION ALERT</b>\n\n${prediction.message.replace(testHeader, "")}`);
        state.lastAlertedStatus = newPredictionStatus;
        state.lastAlertTime = now;
      }
    } else if (newIndex < oldIndex) {
      if (newPredictionStatus !== state.lastAlertedStatus) {
        await broadcastTelegram(`${testHeader}✅ <b>SITUATION EASING</b>\nRisk lowered from ${oldPredictionStatus} → ${newPredictionStatus}\n\nStill monitor weather, but less concern for now ❤️`);
        state.lastAlertedStatus = newPredictionStatus;
        state.lastAlertTime = now;
      }
    }

    state.lastDashboardSnapshot = snapshot;
    writeState(state);
    if (changed) await sendTelegram(dashboard);

  } catch (error) {
    console.error("River Monitor Error:", error.message);
    state.health.riverMonitor = "Offline";
    state.health.lastCheck = now;
    const lastSuccess = state.health.lastSuccessfulRiverCheck || 0;
    const minutesStale = Math.floor((now - lastSuccess) / 60000);
    if (minutesStale >= 60 && !state.health.riverStaleAlerted) {
      await sendTelegram(`⚠️ <b>River Data Delay</b>\nRiver source temporarily unavailable.\nUsing last known status from ${minutesStale} mins ago.\n\nMonitoring continues ❤️`);
      state.health.riverStaleAlerted = true;
    }
    writeState(state);
  } finally {
    if (browser) await browser.close();
  }
}

export default checkRiver;
