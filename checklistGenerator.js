import { readConfig } from "./stateManager.js";

/**
 * Generates a context-aware emergency checklist based on risk level and time.
 */
export function generateChecklist(predictionStatus) {
  const config = readConfig();
  const hour = new Date().getHours();
  const isNight = hour >= 18 || hour < 5;
  
  let checklist = [];
  let title = "✅ ALL CLEAR";
  let subtitle = "Environment is stable. Chill mode muna.";

  if (predictionStatus.includes("High Flood Potential")) {
    title = "🚨 HIGH PRIORITY ACTIONS";
    subtitle = "Situation is critical. Prepare for possible evacuation.";
    checklist = [
      "🎒 Pack emergency bag (Clothes, Meds, Food)",
      "🔌 Unplug appliances & move to higher ground",
      "📻 Monitor Valenzuela City official advisories",
      "📱 Keep communication lines open 24/7",
      "🚗 Plan your route to the nearest evacuation center"
    ];
  } else if (predictionStatus.includes("Rising Risk")) {
    title = "⚠️ PREPAREDNESS CHECKLIST";
    subtitle = "Risk is increasing. Good idea to prepare while early ❤️";
    checklist = [
      "🔋 Charge phones and powerbanks now",
      "📄 Secure important documents in plastic bags",
      "🔦 Prepare flashlight and spare batteries",
      "🛣️ Monitor nearby street flood levels",
      "🧹 Check if drainage near your house is clear"
    ];
  } else if (predictionStatus.includes("Possible Rise")) {
    title = "👀 OBSERVATION LIST";
    subtitle = "Medyo may ulan o pagtaas. Silip lang paminsan.";
    checklist = [
      "📱 Keep your phone nearby and charged",
      "🌊 Observe river movement and nearby drainage",
      "🌧️ Monitor weather updates every hour",
      "🏠 Ensure pets are in a safe spot"
    ];
  }

  // Night Mode Additions
  if (isNight && checklist.length > 0) {
    if (!checklist.includes("🔦 Prepare flashlight and spare batteries")) {
      checklist.unshift("🔦 Keep a flashlight within reach by your bed");
    }
    checklist.unshift("🔋 Ensure phones are plugged in before sleeping");
  }

  // Location Specifics
  if (checklist.length > 0) {
    checklist.push(`📍 Note: High risk of ${config.characteristics?.primaryRisk || "river flooding"}`);
  }

  const message = 
`📋 <b>${title}</b>
━━━━━━━━━━━━━━
${subtitle}

${checklist.length > 0 ? checklist.map(item => `• ${item}`).join("\n") : "• No immediate actions needed."}

❤️ <b>Stay safe, ${config.areaName.split(' ')[0]}!</b>`;

  return message;
}
