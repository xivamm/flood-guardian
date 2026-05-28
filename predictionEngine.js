import { readConfig } from "./stateManager.js";

/**
 * Prediction Engine for Flood Guardian
 * Analyzes historical data and current levels to forecast flood risk.
 */

export function generatePrediction(state, currentData) {
  const history = state.history || [];
  const rainfall = state.lastRainWarning || "NONE";
  const { laMesa, ugong } = currentData;
  const config = readConfig();

  let reasons = [];
  let score = 0; // Internal prediction score (0-100)

  // 1. Analyze Rainfall Impact
  if (rainfall === "RED") {
    score += 40;
    reasons.push("Heavy rainfall warning active (RED)");
  } else if (rainfall === "ORANGE") {
    score += 25;
    reasons.push("Significant rainfall active (ORANGE)");
  } else if (rainfall === "YELLOW") {
    score += 10;
    reasons.push("Rainfall monitoring (YELLOW)");
  }

  // 2. Analyze La Mesa Trend
  if (laMesa && state.lastLaMesaLevel) {
    const laMesaDiff = laMesa.current - state.lastLaMesaLevel;
    if (laMesaDiff >= 0.05) {
      score += 30;
      reasons.push("La Mesa rising significantly");
    } else if (laMesaDiff >= 0.02) {
      score += 15;
      reasons.push("La Mesa showing steady rise");
    }
  }

  // 3. Analyze Historical Consistency (Last 3 checks)
  let consistencyScore = 0;
  if (history.length >= 3) {
    const recent = history.slice(-3);
    const risingCount = recent.filter((h, i) => {
      if (i === 0) return false;
      return h.laMesaLevel > (recent[i-1].laMesaLevel || 0);
    }).length;

    if (risingCount >= 2 && rainfall !== "NONE") {
      score += 20;
      consistencyScore = 20;
      reasons.push("Consistent upward pressure in last hour");
    }
  }

  // 4. Map score to prediction
  let status = "Stable";
  if (score >= 80) status = "High Flood Potential 🚨";
  else if (score >= 50) status = "Rising Risk ⚠️";
  else if (score >= 20) status = "Possible Rise 👀";

  // 5. Confidence Score (60-95%)
  let confidenceVal = 65;
  if (history.length > 5) confidenceVal += 10;
  if (history.length > 10) confidenceVal += 10;
  if (consistencyScore > 0 || score > 70) confidenceVal += 10;
  confidenceVal = Math.min(confidenceVal, 95);

  // 6. Context-Aware Advice
  const hour = new Date().getHours();
  const isNight = hour >= 20 || hour < 5;
  const isMorning = hour >= 5 && hour < 12;
  let advice = config.customAdvice || "Everything seems stable for now. Chill mode muna.";

  if (status.includes("High")) {
    advice = isNight ? "🚨 Gising muna tayo. Pack your essentials and stay ready." : "🚨 Prepare for evacuation. Monitor official orders.";
  } else if (status.includes("Risk")) {
    advice = isNight ? "⚠️ Rising levels at night. Charge phones and keep lights nearby." : "⚠️ Moving valuables to higher ground is recommended.";
  } else if (status.includes("Rise")) {
    advice = isMorning ? "👀 Possible rise this morning. Observe muna tayo habang maliwanag." : "👀 Stay alert. Monitor dashboard every hour.";
  }

  // --- PREMIUM PREDICTION UI ---
  const message = 
`🧠 <b>FLOOD PREDICTION</b>
━━━━━━━━━━━━━━━━

<b>FORECAST</b>
${status.toUpperCase()}

<b>CONFIDENCE</b>
${confidenceVal}% Accurate Score

💡 <b>REASONS</b>
${reasons.length ? reasons.map(r => `• ${r}`).join("\n") : "• Environment is stable"}

❤️ <b>ADVICE</b>
${advice}

📍 ${config.areaName}`;

  return { status, confidence: confidenceVal, reasons, score, message };
}
