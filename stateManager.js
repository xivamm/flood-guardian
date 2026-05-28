import fs from "fs";
import path from "path";

const STATE_FILE = "./state/latest.json";

/**
 * Reads the latest state from the JSON file.
 * Returns a default state if the file doesn't exist.
 */
export function readState() {
  try {
    const defaults = getDefaultState();
    if (!fs.existsSync(STATE_FILE)) {
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      return defaults;
    }
    const data = fs.readFileSync(STATE_FILE, "utf-8");
    const loaded = JSON.parse(data);

    // Merge loaded state with defaults for missing keys
    return {
      ...defaults,
      ...loaded,
      health: { ...defaults.health, ...(loaded.health || {}) }
    };
  } catch (error) {
    console.error("Error reading state:", error.message);
    return getDefaultState();
  }
}

/**
 * Writes the provided state object to the JSON file.
 */
export function writeState(state) {
  try {
    // Ensure history doesn't exceed 12 items
    if (state.history && state.history.length > 12) {
      state.history = state.history.slice(-12);
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (error) {
    console.error("Error writing state:", error.message);
  }
}

/**
 * Reads the config.json file.
 */
export function readConfig() {
  try {
    const configPath = "./config.json";
    if (!fs.existsSync(configPath)) {
      return {
        areaName: "Tullahan / Valenzuela",
        nearbyRiver: "Ugong",
        floodSensitivity: "medium",
        customAdvice: ""
      };
    }
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (error) {
    console.error("Error reading config:", error.message);
    return {};
  }
}

function getDefaultState() {
  return {
    lastRainWarning: null,
    lastLaMesaLevel: null,
    lastUgongLevel: null,
    latestDashboard: null,
    latestRiverUpdate: null,
    latestWeatherUpdate: null,
    latestTrendUpdate: null,
    latestPredictionUpdate: null,
    latestStormUpdate: null,
    lastDashboardSnapshot: null,
    lastUpdateId: 0,
    history: [],
    lastAlertedStatus: "Stable",
    lastAlertTime: 0,
    
    // Community Crowd-Sourcing
    communityReports: [], // Array of { chatId, depth, timestamp }

    // Shadow Mode Learning
    shadowLogs: [], // Last 30 outcome comparisons

    // Testing & Simulation
    isTestMode: false,
    testMockData: null,

    // Health & Failsafe tracking
    health: {
      riverMonitor: "Unknown",
      weatherMonitor: "Unknown",
      lastCheck: 0,
      lastSuccessfulRiverCheck: 0,
      lastSuccessfulWeatherCheck: 0,
      watchdogAlerted: false
    }
  };
}
