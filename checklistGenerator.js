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

  if (predictionStatus.includes("High")) {
    title = "🔴 HIGH PRIORITY";
    subtitle = "Critical Situation. Act now.";
    checklist = [
      "🎒 Pack emergency bag (Clothes, Meds, Food)",
      "🔌 Unplug appliances & move to high ground",
      "📻 Monitor official Valenzuela City alerts",
      "📱 Keep communication lines open",
      "🚗 Know your nearest evacuation route"
    ];
  } else if (predictionStatus.includes("Risk")) {
    title = "🟠 PREPAREDNESS";
    subtitle = "Risk is increasing. Stay ready.";
    checklist = [
      "🔋 Charge phones and powerbanks now",
      "📄 Secure documents in plastic/waterproof bags",
      "🔦 Prepare flashlight and spare batteries",
      "🛣️ Monitor nearby street flood levels",
      "🧹 Check if drainage near your house is clear"
    ];
  } else if (predictionStatus.includes("Rise")) {
    title = "🟡 OBSERVATION";
    subtitle = "Medyo may ulan. Silip lang paminsan.";
    checklist = [
      "📱 Keep your phone nearby and charged",
      "🌊 Observe river and nearby drainage",
      "🌧️ Monitor weather updates every hour",
      "🏠 Ensure pets are in a safe spot"
    ];
  }

  if (isNight && checklist.length > 0) {
    checklist.unshift("🔋 Plug in phones before sleeping");
    checklist.unshift("🔦 Keep a light within reach by your bed");
  }

  // --- PREMIUM CHECKLIST UI ---
  const message = 
`📋 <b>EMERGENCY CHECKLIST</b>
━━━━━━━━━━━━━━━━

<b>STATUS</b>
${title}
<i>${subtitle}</i>

<b>ACTIONS</b>
${checklist.length > 0 ? checklist.map(item => `• ${item}`).join("\n") : "• No immediate actions needed."}

❤️ <b>Stay safe, ${config.areaName.split(' ')[0]}!</b>`;

  return message;
}
