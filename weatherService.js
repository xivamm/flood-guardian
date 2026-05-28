import fetch from "node-fetch";

/**
 * Fetches detailed weather for Valenzuela (Gen T de Leon area)
 */
export async function getDetailedLocalWeather() {
  try {
    const response = await fetch("https://wttr.in/Valenzuela?format=j1");
    if (!response.ok) throw new Error("Weather service unavailable");
    
    const data = await response.json();
    const current = data.current_condition[0];
    const forecast = data.weather[0];

    return {
      temp: current.temp_C,
      condition: current.weatherDesc[0].value,
      windSpeed: current.windspeedKmph,
      humidity: current.humidity,
      rainMM: current.precipMM,
      rainChance: forecast.hourly[0].chanceofrain,
      uvIndex: current.uvIndex,
      isRaining: parseFloat(current.precipMM) > 0
    };
  } catch (error) {
    console.error("Weather API Error:", error.message);
    return null;
  }
}

/**
 * Map rainfall MM to human-readable status
 */
export function getRainIntensity(mm) {
  const val = parseFloat(mm);
  if (val === 0) return "No Rain";
  if (val < 2.5) return "Light Rain 🌧";
  if (val < 7.5) return "Moderate Rain ⛈";
  if (val < 15) return "Heavy Rain 🚨";
  return "Torrential Rain 🌊";
}
