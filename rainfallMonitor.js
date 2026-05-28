import puppeteer from "puppeteer";
import { sendTelegram, broadcastTelegram } from "./notifier.js";
import { readState, writeState } from "./stateManager.js";

async function checkRainfall() {
  let browser;
  const state = readState();
  const now = Date.now();
  const testHeader = state.isTestMode ? "🧪 <b>TEST MODE</b>\n<i>Simulation only. No real flood detected.</i>\n\n" : "";

  try {
    let text = "";
    let pageText = "";

    if (state.isTestMode && state.testMockData) {
      pageText = state.testMockData.weatherRawText || "";
      text = pageText.toLowerCase();
    } else {
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });
      const page = await browser.newPage();
      await page.goto("https://www.pagasa.dost.gov.ph", { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise(resolve => setTimeout(resolve, 8000));
      pageText = await page.evaluate(() => document.body.innerText);
      text = pageText.toLowerCase();
    }

    let warning = null;
    const hasMetroManila = text.includes("metro manila") || text.includes("ncr") || text.includes("quezon city") || text.includes("valenzuela");
    if (text.includes("red rainfall")) warning = "RED";
    else if (text.includes("orange rainfall")) warning = "ORANGE";
    else if (text.includes("yellow rainfall")) warning = "YELLOW";
    
    let stormName = null;
    let stormStatus = null;
    let stormRelevance = "No active storm directly affecting NCR.";
    const stormMatch = pageText.match(/(Tropical Storm|Typhoon|Super Typhoon|Severe Tropical Storm|Tropical Depression)\s+([A-Z]{3,})/i);
    if (stormMatch) {
      stormStatus = stormMatch[1];
      stormName = stormMatch[2];
      const relevanceMatch = pageText.toLowerCase().includes("moving") || pageText.toLowerCase().includes("towards");
      if (relevanceMatch && hasMetroManila) stormRelevance = "Directly affecting or moving towards NCR.";
      else if (text.includes("monsoon") || text.includes("habagat")) stormRelevance = "Enhancing Southwest Monsoon (Habagat).";
      else stormRelevance = "Inside PAR. Monitoring movement.";
    }

    let forecast = "Metro Manila: Partly cloudy to cloudy skies.";
    if (text.includes("thunderstorm")) forecast = "Expected thunderstorms later today.";
    else if (text.includes("isolated rain")) forecast = "Isolated rain showers expected.";
    else if (text.includes("monsoon") || text.includes("habagat")) forecast = "Monsoon rains (Habagat) expected.";

    state.health.weatherMonitor = "Online";
    state.health.lastSuccessfulWeatherCheck = now;
    state.health.lastCheck = now;
    state.health.weatherStaleAlerted = false;

    const weatherIcon = warning === "RED" ? "🔴" : warning === "ORANGE" ? "🟠" : warning === "YELLOW" ? "🟡" : "🟢";
    const weatherLabel = warning ? `${warning} RAINFALL` : "NORMAL";
    
    // --- PREMIUM WEATHER UI ---
    const weatherUpdate = 
`${testHeader}🌧 <b>WEATHER & FORECAST</b>
━━━━━━━━━━━━━━━━

📍 <b>AREA</b>
NCR / Valenzuela

📢 <b>LIVE STATUS</b>
${weatherIcon} ${weatherLabel}

🔮 <b>FORECAST (NEXT 24H)</b>
${forecast}

${warning ? "⚠️ May active rainfall warning. Ingat po!" : "☀️ Mukhang stable ang panahon."}`;

    // --- PREMIUM STORM UI ---
    const stormUpdate = 
`${testHeader}🌀 <b>STORM WATCH</b>
━━━━━━━━━━━━━━━━

<b>STATUS</b>
${stormName ? `${stormStatus} ${stormName}` : "No Active Storm in PAR"}

<b>RELEVANCE</b>
${stormRelevance}

💡 <b>VALENZUELA RISK</b>
${stormName ? "⚠️ Possible river rise due to monsoon rains." : "✅ No typhoon-related risk detected."}

❤️ <b>ADVICE</b>
${stormName ? "Stay tuned to PAGASA updates. Secure items." : "Safe and clear for now."}`;

    let shouldAlert = false;
    if (warning && warning !== state.lastRainWarning) shouldAlert = true;
    if (stormName && stormName !== state.lastStormName) shouldAlert = true;
    
    state.latestWeatherUpdate = weatherUpdate;
    state.latestStormUpdate = stormUpdate;
    state.lastRainWarning = warning;
    state.lastStormName = stormName;
    writeState(state);

    if (shouldAlert) {
      await broadcastTelegram(`${testHeader}🔔 <b>WEATHER ALERT</b>\n\n${stormName ? stormUpdate.replace(testHeader, "") : weatherUpdate.replace(testHeader, "")}`);
    }
  } catch (error) {
    console.error("Rainfall Monitor Error:", error.message);
    state.health.weatherMonitor = "Offline";
    state.health.lastCheck = now;
    const lastSuccess = state.health.lastSuccessfulWeatherCheck || 0;
    const mins = Math.floor((now - lastSuccess) / 60000);
    if (mins >= 60 && !state.health.weatherStaleAlerted) {
      await sendTelegram(`⚠️ <b>Weather Data Delay</b>\nPAGASA unavailable (${mins} mins ago).`);
      state.health.weatherStaleAlerted = true;
    }
    writeState(state);
  } finally {
    if (browser) await browser.close();
  }
}

export default checkRainfall;
