import { Router, Request, Response } from "express";

const router = Router();

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY || "YOUR_API_KEY_PLACEHOLDER";
const BASE_URL = "https://api.openweathermap.org/data/2.5";

// GET /api/weather/current?city=Miami  OR  ?lat=25.77&lon=-80.19
router.get("/current", async (req: Request, res: Response) => {
  try {
    const { city, lat, lon } = req.query;

    let url = "";
    if (city) {
      url = `${BASE_URL}/weather?q=${encodeURIComponent(city as string)}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    } else if (lat && lon) {
      url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial`;
    } else {
      return res.status(400).json({ error: "Provide either city or lat/lon" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message || "OpenWeather error" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error("Weather current error:", error);
    return res.status(500).json({ error: "Failed to fetch current weather" });
  }
});

// GET /api/weather/forecast?city=Miami  OR  ?lat=25.77&lon=-80.19
router.get("/forecast", async (req: Request, res: Response) => {
  try {
    const { city, lat, lon } = req.query;

    let url = "";
    if (city) {
      url = `${BASE_URL}/forecast?q=${encodeURIComponent(city as string)}&appid=${OPENWEATHER_API_KEY}&units=imperial&cnt=24`;
    } else if (lat && lon) {
      url = `${BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=imperial&cnt=24`;
    } else {
      return res.status(400).json({ error: "Provide either city or lat/lon" });
    }

    const response = await fetch(url);
    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.message || "OpenWeather error" });
    }

    const data = await response.json();

    // Process into clean 3-day summary
    const dailyMap: Record<string, { temps: number[]; conditions: string[]; icons: string[]; wind: number[] }> = {};

    for (const item of data.list) {
      const date = new Date(item.dt * 1000);
      const dayKey = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

      if (!dailyMap[dayKey]) {
        dailyMap[dayKey] = { temps: [], conditions: [], icons: [], wind: [] };
      }
      dailyMap[dayKey].temps.push(item.main.temp);
      dailyMap[dayKey].conditions.push(item.weather[0].main);
      dailyMap[dayKey].icons.push(item.weather[0].icon);
      dailyMap[dayKey].wind.push(item.wind.speed);
    }

    const forecast = Object.entries(dailyMap)
      .slice(0, 3)
      .map(([day, values]) => ({
        day,
        high: Math.round(Math.max(...values.temps)),
        low: Math.round(Math.min(...values.temps)),
        avgTemp: Math.round(values.temps.reduce((a, b) => a + b, 0) / values.temps.length),
        condition: values.conditions[Math.floor(values.conditions.length / 2)],
        icon: values.icons[Math.floor(values.icons.length / 2)],
        avgWind: Math.round(values.wind.reduce((a, b) => a + b, 0) / values.wind.length),
      }));

    return res.json({ city: data.city.name, country: data.city.country, forecast });
  } catch (error) {
    console.error("Weather forecast error:", error);
    return res.status(500).json({ error: "Failed to fetch forecast" });
  }
});

export default router;