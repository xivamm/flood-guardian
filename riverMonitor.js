import puppeteer from "puppeteer";
import { sendTelegram, broadcastTelegram } from "./notifier.js";
import { readState, writeState, readConfig } from "./stateManager.js";
import { generatePrediction } from "./predictionEngine.js";
import { processShadowLearning } from "./shadowMode.js";
import { generateChecklist } from "./checklistGenerator.js";

function getStatus(current, alert, alarm, critical) {
  if (current >= critical) return "HIGH RISK";
  if (current >= alarm) return "PREPARE";
  if (current >= alert) return "OBSERVE";
  return "SAFE";
}

function emojiStatus(status) {
  switch (status) {
    case "HIGH RISK": return "🔴";
    case "PREPARE": return "🟠";
    case "OBSERVE": return "🟡";
    case "SAFE": return "🟢";
    default: return "⚪";
  }
}

function getFloodVibe(score) {
  if (score >= 71) return { emoji: "🔴", label: "HIGH RISK", bar: "█ " };
  if (score >= 46) return { emoji: "🟠", label: "PREPARE", bar: "█ " };
  if (score >= 21) return { emoji: "🟡", label: "OBSERVE", bar: "█ " };
  return { emoji: "🟢", label: "SAFE", bar: "█ " };
}

async function checkRiver() {
  let browser;
  const state = readState();
  const config = readConfig();
  const now = Date.now();
  const testHeader = state.isTestMode ? "🧪 <b>TEST MODE</b>\n<i>Simulation only. No real flood detected.</i>\n\n" : "";

  try {
    let laMesa = null;
    let ugong = null;
    let laMesaStatus = "UNKNOWN";
    let ugongStatus = "OFFLINE";

    if (state.isTestMode && state.testMockData) {
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
        return match ? { current: parseFloat(match[1]), alert: parseFloat(match[2]), alarm: parseFloat(match[3]), critical: parseFloat(match[4]) } : null;
      };

      laMesa = parseDam("La Mesa Dam", pageText);
      ugong = parseDam("Ugong", pageText);
    }

    state.health.riverMonitor = "Online";
    state.health.lastSuccessfulRiverCheck = now;
    state.health.lastCheck = now;
    state.health.riverStaleAlerted = false;

    const rainfall = state.lastRainWarning || "NONE";
    laMesaStatus = laMesa ? getStatus(laMesa.current, laMesa.alert, laMesa.alarm, laMesa.critical) : "UNKNOWN";
    ugongStatus = ugong && ugong.current > 0 ? getStatus(ugong.current, ugong.alert, ugong.alarm, ugong.critical) : "OFFLINE";

    // Community Reports
    const threeHours = 3 * 60 * 60 * 1000;
    if (!state.communityReports) state.communityReports = [];
    state.communityReports = state.communityReports.filter(r => (now - r.timestamp) < threeHours);
    const counts = state.communityReports.reduce((acc, r) => { acc[r.depth] = (acc[r.depth] || 0) + 1; return acc; }, {});
    
    let commReportStr = "";
    if (state.communityReports.length > 0) {
      commReportStr = `🟢 Passable: ${counts.None || 0}\n🟡 Ankle: ${counts.Sakong || 0}\n🟠 Knee: ${counts.Tuhod || 0}\n🔴 High: ${(counts.Tao || 0) + (counts.Lagpas || 0)}`;
    } else {
      commReportStr = "No reports from residents yet.";
    }

    // Scoring
    let score = 0;
    let reasons = [];
    if (laMesaStatus === "HIGH RISK") { score += 40; reasons.push("High upstream water"); }
    else if (laMesaStatus === "PREPARE") { score += 25; reasons.push("Upstream pressure rising"); }
    
    if (ugongStatus === "HIGH RISK") { score += 30; reasons.push("Local river critical"); }
    if (counts.Tao || counts.Lagpas) { score += 20; reasons.push("Resident flood reports"); }
    if (rainfall === "RED") { score += 45; reasons.push("Heavy rainfall active"); }
    else if (rainfall === "ORANGE") { score += 30; reasons.push("Significant rainfall"); }
    score = Math.min(score, 100);

    const prevLaMesa = state.lastLaMesaLevel || laMesa?.current;
    let trendText = "➡ Stable";
    if (laMesa && prevLaMesa) {
      const diff = laMesa.current - prevLaMesa;
      if (diff >= 0.03) trendText = `⬆ Rising (+${diff.toFixed(2)}m)`;
      else if (diff <= -0.03) trendText = `⬇ Lowering (${Math.abs(diff).toFixed(2)}m)`;
    }

    const vibe = getFloodVibe(score);
    const barCount = Math.floor(score / 10);
    const riskBar = vibe.bar.repeat(barCount) + "░ ".repeat(10 - barCount);

    // --- PREMIUM DASHBOARD ---
    const dashboard = 
`${testHeader}🛟 <b>FLOOD GUARD VALENZUELA</b>
━━━━━━━━━━━━━━━━

📍 <b>AREA</b>
${config.areaName}

🌊 <b>RIVER STATUS</b>
La Mesa       ${emojiStatus(laMesaStatus)} ${laMesaStatus} (${laMesa?.current?.toFixed(2) || "N/A"})
${config.nearbyRiver.split(' ')[0]}         ${emojiStatus(ugongStatus)} ${ugongStatus} (${ugong?.current?.toFixed(2) || "0.00"})

📈 <b>TREND</b>
${trendText}

🌧 <b>WEATHER</b>
${rainfall === "NONE" ? "🟢 Normal Rainfall" : `⚠️ ${rainfall} Warning`}

🧠 <b>FLOOD RISK</b>
${vibe.emoji} <b>${vibe.label} MODE</b>
<code>${riskBar}</code> ${score}%

💡 <b>WHY?</b>
${reasons.length ? reasons.map(r => `• ${r}`).join("\n") : "• Stable environment"}

👥 <b>COMMUNITY REPORTS</b>
${commReportStr}

❤️ <b>ADVICE</b>
${score >= 71 ? "Situation is critical. Prepare for evacuation." : 
  score >= 46 ? "Prepare mode. Move valuables to higher ground." : 
  score >= 21 ? "Observe mode muna. Silip lang paminsan 👀" : "Chill mode — safe and stable."}`;

    // Update state
    state.latestDashboard = dashboard;
    state.latestRiverUpdate = `${testHeader}🌊 <b>RIVER DETAILS</b>\n━━━━━━━━━━━━━━\n<b>La Mesa:</b> ${laMesa?.current?.toFixed(2)}m\n<b>Status:</b> ${laMesaStatus}\n\n<b>Community:</b>\n${commReportStr}`;
    state.latestTrendUpdate = `${testHeader}📈 <b>MOVEMENT & TREND</b>\n━━━━━━━━━━━━━━\n<b>Status:</b> ${trendText}\n<b>Last:</b> ${prevLaMesa?.toFixed(2)}m\n<b>New:</b> ${laMesa?.current?.toFixed(2)}m`;

    const prediction = generatePrediction(state, { laMesa, ugong });
    state.latestPredictionUpdate = `${testHeader}${prediction.message.replace(testHeader, "")}`;
    state.latestChecklist = generateChecklist(prediction.status);
    processShadowLearning(state, { laMesa, ugong }, prediction);

    state.lastLaMesaLevel = laMesa?.current;
    state.lastUgongLevel = ugong?.current;

    const snapshot = JSON.stringify({ laMesaStatus, rainfall, trendText, score, predictionStatus: prediction.status });
    const changed = snapshot !== state.lastDashboardSnapshot;
    
    const lastSnapshot = JSON.parse(state.lastDashboardSnapshot || "{}");
    const oldPredictionStatus = lastSnapshot.predictionStatus || "Stable";
    const statusOrder = ["Stable", "Possible Rise 👀", "Rising Risk ⚠️", "High Flood Potential 🚨"];
    const oldIndex = statusOrder.indexOf(oldPredictionStatus);
    const newIndex = statusOrder.indexOf(prediction.status);
    const lastAlertTime = state.lastAlertTime || 0;

    if (newIndex > oldIndex) {
      if (prediction.status !== state.lastAlertedStatus || (now - lastAlertTime > 7200000)) {
        const escalationAlert = 
`${testHeader}🚨 <b>RISK ESCALATION</b>
━━━━━━━━━━━━━━━━
<b>${config.areaName}</b>

<b>Risk:</b>
${emojiStatus(prediction.status.includes("High") ? "HIGH RISK" : prediction.status.includes("Rising") ? "PREPARE" : "OBSERVE")} ${prediction.status.toUpperCase()}

<b>Reason:</b>
${prediction.reasons.map(r => `• ${r}`).join("\n")}

❤️ <b>Suggestion:</b>
${prediction.status.includes("High") ? "Prepare emergency bag. Monitor evacuation orders." : "Charge phones while early. Observe drainage."}`;
        
        await broadcastTelegram(escalationAlert);
        state.lastAlertedStatus = prediction.status;
        state.lastAlertTime = now;
      }
    } else if (newIndex < oldIndex) {
      if (prediction.status !== state.lastAlertedStatus) {
        await broadcastTelegram(`${testHeader}✅ <b>SITUATION EASING</b>\nRisk lowered to ${prediction.status.toUpperCase()}\n\nStill monitor weather, but less concern for now ❤️`);
        state.lastAlertedStatus = prediction.status;
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
    const mins = Math.floor((now - lastSuccess) / 60000);
    if (mins >= 60 && !state.health.riverStaleAlerted) {
      await sendTelegram(`⚠️ <b>Data Delay</b>\nRiver source unavailable. Using last known (${mins} mins ago).`);
      state.health.riverStaleAlerted = true;
    }
    writeState(state);
  } finally {
    if (browser) await browser.close();
  }
}

export default checkRiver;
