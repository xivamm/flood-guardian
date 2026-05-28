import fetch from "node-fetch";

/**
 * Fetches detailed weather for Valenzuela, Philippines (Gen T de Leon area)
 */
export async function getDetailedLocalWeather() {
  try {
    // We use Valenzuela,Philippines to ensure we get the right location
    const response = await fetch("https://wttr.in/Valenzuela,Philippines?format=j1");
    if (!response.ok) throw new Error("Weather service unavailable");
    
    const data = await response.json();
    const current = data.current_condition[0];
    const forecast = data.weather[0];

    // Attempt to get even more local for Gen T De Leon
    // If it fails, we fall back to the Valenzuela data already fetched
    return {
      temp: current.temp_C,
      condition: current.weatherDesc[0].value,
      windSpeed: current.windspeedKmph,
      humidity: current.humidity,
      rainMM: current.precipMM,
      rainChance: forecast.hourly[0].chanceofrain,
      feelsLike: current.FeelsLikeC,
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
