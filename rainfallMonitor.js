import puppeteer from "puppeteer";
import { sendTelegram, broadcastTelegram } from "./notifier.js";
import { readState, writeState } from "./stateManager.js";

async function checkRainfall() {
  let browser;
  const state = readState();
  const now = Date.now();
  const testHeader = state.isTestMode ? "🧪 <b>TEST MODE</b>\n<i>This is a simulation. No real flood detected.</i>\n\n" : "";

  try {
    let text = "";
    let pageText = "";

    if (state.isTestMode && state.testMockData) {
      console.log("🧪 Using Mock Weather Data...");
      pageText = state.testMockData.weatherRawText || "";
      text = pageText.toLowerCase();
    } else {
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });

      const page = await browser.newPage();
      
      // --- PART 1: Live Rainfall & Storm Data ---
      await page.goto("https://www.pagasa.dost.gov.ph", {
        waitUntil: "networkidle2",
        timeout: 60000
      });

      await new Promise(resolve => setTimeout(resolve, 8000));

      pageText = await page.evaluate(() => document.body.innerText);
      text = pageText.toLowerCase();
    }

    // 1a. Rainfall Warnings
    let warning = null;
    const hasMetroManila = text.includes("metro manila") || text.includes("ncr") || text.includes("quezon city") || text.includes("valenzuela");

    if (text.includes("red rainfall")) warning = "RED";
    else if (text.includes("orange rainfall")) warning = "ORANGE";
    else if (text.includes("yellow rainfall")) warning = "YELLOW";
    
    // 1b. Storm Detection
    let stormName = null;
    let stormStatus = null;
    let stormRelevance = "No active storm directly affecting NCR.";
    
    // Check for "Tropical Cyclone" section or text
    const stormMatch = pageText.match(/(Tropical Storm|Typhoon|Super Typhoon|Severe Tropical Storm|Tropical Depression)\s+([A-Z]{3,})/i);
    if (stormMatch) {
      stormStatus = stormMatch[1];
      stormName = stormMatch[2];
      
      const relevanceMatch = pageText.toLowerCase().includes("moving") || pageText.toLowerCase().includes("towards");
      if (relevanceMatch && hasMetroManila) {
        stormRelevance = "Directly affecting or moving towards NCR.";
      } else if (text.includes("monsoon") || text.includes("habagat")) {
        stormRelevance = "Enhancing Southwest Monsoon (Habagat). Expect heavy rains.";
      } else {
        stormRelevance = "Inside Philippine Area of Responsibility (PAR). Monitoring movement.";
      }
    }

    // --- PART 2: 24-Hour Forecast ---
    let forecast = "Metro Manila: Partly cloudy to cloudy skies.";
    if (text.includes("thunderstorm")) forecast = "Expected thunderstorms later today.";
    else if (text.includes("isolated rain")) forecast = "Isolated rain showers expected.";
    else if (text.includes("monsoon") || text.includes("habagat")) forecast = "Monsoon rains (Habagat) expected.";

    // Update Health
    state.health.weatherMonitor = "Online";
    state.health.lastSuccessfulWeatherCheck = now;
    state.health.lastCheck = now;
    state.health.weatherStaleAlerted = false;

    // Build the Weather Update
    const weatherIcon = warning === "RED" ? "🚨" : warning === "ORANGE" ? "⚠️" : warning === "YELLOW" ? "🌧" : "🟢";
    const weatherLabel = warning ? `${warning} RAINFALL` : "NO RAIN WARNING";
    
    const weatherUpdate = 
`${testHeader}🌦 <b>WEATHER & FORECAST</b>
━━━━━━━━━━━━━━
📍 <b>Area:</b> NCR / Valenzuela
📢 <b>Live Status:</b> ${weatherIcon} ${weatherLabel}

🔮 <b>Forecast (Next 24h):</b>
${forecast}

${warning ? "⚠️ May active rainfall warning. Ingat po!" : "☀️ Mukhang stable ang panahon."}`;

    // Build the Storm Update
    const stormUpdate = 
`${testHeader}🌀 <b>STORM WATCH</b>
━━━━━━━━━━━━━━
<b>Status:</b> ${stormName ? `${stormStatus} ${stormName}` : "No Active Storm in PAR"}
<b>Relevance:</b> ${stormRelevance}

💡 <b>Tullahan/Valenzuela Risk:</b>
${stormName ? "⚠️ Possible river rise due to enhanced monsoon or direct rain." : "✅ No typhoon-related risk detected."}

❤️ <b>Advice:</b>
${stormName ? "Stay tuned to PAGASA updates. Secure outdoor items." : "Safe and clear for now."}`;

    // Proactive Alert Logic
    let shouldAlert = false;
    if (warning && warning !== state.lastRainWarning) shouldAlert = true;
    if (stormName && stormName !== state.lastStormName) shouldAlert = true;
    
    // Save for next check
    state.latestWeatherUpdate = weatherUpdate;
    state.latestStormUpdate = stormUpdate;
    state.lastRainWarning = warning;
    state.lastStormName = stormName;

    writeState(state);

    if (shouldAlert) {
      await broadcastTelegram(`${testHeader}🔔 <b>PROACTIVE WEATHER/STORM ALERT</b>\n\n${stormName ? stormUpdate.replace(testHeader, "") : weatherUpdate.replace(testHeader, "")}`);
    } else {
      console.log("No proactive weather alert needed.");
    }

  } catch (error) {
    console.error("Rainfall Monitor Error:", error.message);
    state.health.weatherMonitor = "Offline";
    state.health.lastCheck = now;
    const lastSuccess = state.health.lastSuccessfulWeatherCheck || 0;
    const minutesStale = Math.floor((now - lastSuccess) / 60000);

    if (minutesStale >= 60 && !state.health.weatherStaleAlerted) {
      await sendTelegram(`⚠️ <b>Weather Data Delay</b>\nPAGASA unavailable. Last update ${minutesStale} mins ago.`);
      state.health.weatherStaleAlerted = true;
    }
    writeState(state);
  } finally {
    if (browser) await browser.close();
  }
}

export default checkRainfall;
