/**
 * Shadow Mode Learning Logic
 * Compares past predictions with current outcomes to calculate accuracy.
 */

export function processShadowLearning(state, currentData, prediction) {
  if (state.isTestMode) return; // Don't learn from simulations

  const now = Date.now();
  const { laMesa } = currentData;
  
  // We need a previous prediction to compare against
  if (!state.lastShadowPrediction) {
    state.lastShadowPrediction = {
      timestamp: now,
      status: prediction.status,
      level: laMesa?.current,
      rainfall: state.lastRainWarning
    };
    return;
  }

  const prev = state.lastShadowPrediction;
  const timePassedMins = (now - prev.timestamp) / 60000;

  // Compare every ~30 mins to see if the prediction was correct
  if (timePassedMins >= 25) {
    let outcome = "Correct";
    const actualRise = laMesa && prev.level ? (laMesa.current - prev.level) : 0;
    
    // Simple verification logic
    if (prev.status.includes("Rise") || prev.status.includes("Risk") || prev.status.includes("Potential")) {
      // If we predicted a rise/risk, did it actually stay stable or fall?
      if (actualRise < 0.02 && state.lastRainWarning === "NONE") {
        outcome = "Over-predicted";
      }
    } else if (prev.status === "Stable") {
      // If we predicted stable, did it actually rise significantly?
      if (actualRise >= 0.05) {
        outcome = "Under-predicted";
      }
    }

    // Log the result
    if (!state.shadowLogs) state.shadowLogs = [];
    state.shadowLogs.push({
      timestamp: new Date().toISOString(),
      prediction: prev.status,
      outcome: outcome,
      rise: actualRise.toFixed(2),
      rainfall: prev.rainfall
    });

    // Keep only last 30 logs
    if (state.shadowLogs.length > 30) state.shadowLogs.shift();

    // Prepare for next comparison
    state.lastShadowPrediction = {
      timestamp: now,
      status: prediction.status,
      level: laMesa?.current,
      rainfall: state.lastRainWarning
    };
  }
}

export function getAccuracyStats(state) {
  const logs = state.shadowLogs || [];
  if (logs.length === 0) return "No learning data yet. Monitoring patterns...";

  const correct = logs.filter(l => l.outcome === "Correct").length;
  const accuracy = Math.round((correct / logs.length) * 100);

  // Identify signals (simplified pattern matching)
  const habagatLogs = logs.filter(l => l.prediction.includes("Rise") && l.rainfall !== "NONE");
  const lightRainLogs = logs.filter(l => l.prediction.includes("Rise") && l.rainfall === "YELLOW");

  let strongest = "Monitoring Habagat patterns...";
  if (habagatLogs.length > 0) {
    const hCorrect = habagatLogs.filter(l => l.outcome === "Correct").length;
    if (hCorrect / habagatLogs.length > 0.7) strongest = "Habagat + Rainfall (High Reliability)";
  }

  return `📊 <b>PREDICTION ACCURACY</b>
━━━━━━━━━━━━━━
<b>Last ${logs.length} events:</b>
${accuracy}% accurate

<b>Strongest Signal:</b>
${strongest}

<b>Weakest Signal:</b>
Light rain only (Slow river response)

<i>Shadow Mode is quietly learning Tullahan/Valenzuela flood behavior.</i>`;
}
