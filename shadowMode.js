/**
 * Shadow Mode Learning Logic
 * Compares past predictions with current outcomes to calculate accuracy.
 */

export function processShadowLearning(state, currentData, prediction) {
  if (state.isTestMode) return; // Don't learn from simulations

  const now = Date.now();
  const { laMesa } = currentData;
  if (!state.lastShadowPrediction) {
    state.lastShadowPrediction = { timestamp: now, status: prediction.status, level: laMesa?.current, rainfall: state.lastRainWarning };
    return;
  }

  const prev = state.lastShadowPrediction;
  if ((now - prev.timestamp) / 60000 >= 25) {
    let outcome = "Correct";
    const actualRise = laMesa && prev.level ? (laMesa.current - prev.level) : 0;
    
    if (prev.status.includes("Rise") || prev.status.includes("Risk") || prev.status.includes("Potential")) {
      if (actualRise < 0.02 && state.lastRainWarning === "NONE") outcome = "Over-predicted";
    } else if (prev.status === "Stable") {
      if (actualRise >= 0.05) outcome = "Under-predicted";
    }

    if (!state.shadowLogs) state.shadowLogs = [];
    state.shadowLogs.push({ timestamp: new Date().toISOString(), prediction: prev.status, outcome: outcome, rise: actualRise.toFixed(2), rainfall: prev.rainfall });
    if (state.shadowLogs.length > 30) state.shadowLogs.shift();
    state.lastShadowPrediction = { timestamp: now, status: prediction.status, level: laMesa?.current, rainfall: state.lastRainWarning };
  }
}

export function getAccuracyStats(state) {
  const logs = state.shadowLogs || [];
  if (logs.length === 0) return "📊 <b>ACCURACY DATA</b>\n━━━━━━━━━━━━━━━━\nNo learning data yet. Monitoring patterns...";

  const correct = logs.filter(l => l.outcome === "Correct").length;
  const accuracy = Math.round((correct / logs.length) * 100);
  const habagatLogs = logs.filter(l => l.prediction.includes("Rise") && l.rainfall !== "NONE");
  let strongest = "Habagat + Rain (Monitoring)";
  if (habagatLogs.length > 0 && (habagatLogs.filter(l => l.outcome === "Correct").length / habagatLogs.length > 0.7)) strongest = "Habagat + Rain (Reliable)";

  // --- PREMIUM ACCURACY UI ---
  return `📊 <b>PREDICTION ACCURACY</b>
━━━━━━━━━━━━━━━━

<b>SCORE</b>
${accuracy}% Reliable

<b>SIGNAL RELIABILITY</b>
💪 Strong: ${strongest}
⚠️ Weak: Light rain only

<b>SAMPLE SIZE</b>
Last ${logs.length} monitoring events.

<i>Shadow Mode learns Tullahan flood behavior in the background.</i>`;
}
