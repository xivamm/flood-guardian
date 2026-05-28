import puppeteer from "puppeteer";
import { sendTelegram, broadcastTelegram } from "./notifier.js";
import { readState, writeState } from "./stateManager.js";
import { getDetailedLocalWeather, getRainIntensity } from "./weatherService.js";

async function checkRainfall() {
  let browser;
  const state = readState();
  const now = Date.now();
  const testHeader = state.isTestMode ? "🧪 <b>TEST MODE</b>\n<i>Simulation only. No real flood detected.</i>\n\n" : "";
  const WEATHER_URL = "https://www.pagasa.dost.gov.ph";

  try {
    // --- PART 1: PAGASA Scraping (Warnings & Storms) ---
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
      await page.goto(WEATHER_URL, { waitUntil: "networkidle2", timeout: 60000 });
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

    // --- PART 2: Detailed Local Weather (Valenzuela, Philippines) ---
    const local = await getDetailedLocalWeather();
    let localWeatherStr = "Local metrics unavailable.";
    if (local) {
      localWeatherStr = 
`📍 <b>GEN T. DE LEON AREA</b>
🌡️ <b>Temp:</b> ${local.temp}°C (Feels like ${local.feelsLike}°C)
🌬️ <b>Wind:</b> ${local.windSpeed} km/h
💧 <b>Humidity:</b> ${local.humidity}%
🌧️ <b>Rainfall:</b> ${local.rainMM}mm (${getRainIntensity(local.rainMM)})
🎲 <b>Rain Chance:</b> ${local.rainChance}%`;
      
      state.latestLocalWeather = local;
    }

    state.health.weatherMonitor = "Online";
    state.health.lastSuccessfulWeatherCheck = now;
    state.health.lastCheck = now;
    state.health.weatherStaleAlerted = false;

    const weatherIcon = warning === "RED" ? "🔴" : warning === "ORANGE" ? "🟠" : warning === "YELLOW" ? "🟡" : "🟢";
    const weatherLabel = warning ? `${warning} RAINFALL` : "NORMAL";
    
    const weatherUpdate = 
`${testHeader}🌧 <b>WEATHER & FORECAST</b>
━━━━━━━━━━━━━━━━

📢 <b>PAGASA STATUS</b>
${weatherIcon} ${weatherLabel}

${localWeatherStr}

🔗 <a href="${WEATHER_URL}">🔗 Source (PAGASA)</a>

${warning || (local && parseFloat(local.rainMM) > 3.0) ? "⚠️ May active weather concern. Ingat po!" : "☀️ Mukhang stable ang panahon."}`;

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
${stormName ? "Stay tuned to PAGASA updates. Secure items." : "Safe and clear for now."}

🔗 <b>Reference:</b> <a href="${WEATHER_URL}">Official Advisory</a>`;

    let shouldAlert = false;
    if (warning && warning !== state.lastRainWarning) shouldAlert = true;
    if (stormName && stormName !== state.lastStormName) shouldAlert = true;
    
    // Proactive Alert for Heavy Local Rain (Threshold lowered for earlier warning)
    if (local && parseFloat(local.rainMM) >= 3.0 && !state.lastLocalRainAlerted) {
      shouldAlert = true;
      state.lastLocalRainAlerted = true;
    } else if (local && parseFloat(local.rainMM) < 1.0) {
      state.lastLocalRainAlerted = false;
    }

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
    writeState(state);
  } finally {
    if (browser) await browser.close();
  }
}

export default checkRainfall;
