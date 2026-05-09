import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import WeatherChart from "../components/WeatherChart";
import OutfitSuggestion from "../components/OutfitSuggestion";

// ── WMO weather code → human readable ────────────────────────────────────────
function wmoToCondition(code: number): string {
  if (code === 0) return "Clear sky";
  if (code <= 3) return code === 1 ? "Mainly clear" : code === 2 ? "Partly cloudy" : "Overcast";
  if (code <= 48) return "Foggy";
  if (code <= 55) return "Drizzle";
  if (code <= 65) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Rain showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

function wmoToIcon(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 65) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌦️";
  if (code <= 86) return "🌨️";
  return "⛈️";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Types ─────────────────────────────────────────────────────────────────────
interface ForecastDay {
  day: string;
  high: number;
  low: number;
  avgTemp: number;
  condition: string;
  icon: string;
  avgWind: number;
}

interface WeatherData {
  city: string;
  country: string;
  forecast: ForecastDay[];
}

// ── API ───────────────────────────────────────────────────────────────────────
async function fetchWeather(city: string): Promise<WeatherData> {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
  );
  const geoData = await geoRes.json() as { results?: Array<{ name: string; country: string; latitude: number; longitude: number }> };
  const loc = geoData.results?.[0];
  if (!loc) throw new Error(`City "${city}" not found`);

  const forecastRes = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,windspeed_10m_max,weathercode&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=auto&forecast_days=3`
  );
  const forecastData = await forecastRes.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      temperature_2m_mean: number[];
      precipitation_sum: number[];
      windspeed_10m_max: number[];
      weathercode: number[];
    };
  };

  const d = forecastData.daily;
  const forecast: ForecastDay[] = d.time.map((t, i) => {
    const date = new Date(t + "T12:00:00");
    const code = d.weathercode[i];
    const precip = d.precipitation_sum[i];
    const cond = wmoToCondition(code) + (precip > 0.1 ? " with rain" : "");
    return {
      day: DAYS[date.getDay()],
      high: Math.round(d.temperature_2m_max[i]),
      low: Math.round(d.temperature_2m_min[i]),
      avgTemp: Math.round(d.temperature_2m_mean[i]),
      condition: cond,
      icon: wmoToIcon(code),
      avgWind: Math.round(d.windspeed_10m_max[i]),
    };
  });

  return { city: loc.name, country: loc.country, forecast };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WeatherPage() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WeatherData | null>(null);

  const search = useCallback(async (city: string) => {
    if (!city.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchWeather(city.trim());
      setData(result);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fetch weather");
    } finally {
      setLoading(false);
    }
  }, []);

  const today = data?.forecast[0];

  return (
    <div style={{
      minHeight: "100dvh",
      background: "linear-gradient(135deg, #0a0f1e 0%, #0f172a 50%, #0a1628 100%)",
      fontFamily: "'Geist', system-ui, sans-serif",
      color: "#e2e8f0",
    }}>
      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "16px 24px",
        borderBottom: "1px solid rgba(99,102,241,0.15)",
        backdropFilter: "blur(12px)",
        background: "rgba(10,15,30,0.8)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <button
          onClick={() => navigate("/home")}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 13 }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8l4-4" stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to Atlas
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⛅</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", letterSpacing: "0.04em" }}>Weather & Wardrobe</span>
        </div>
        <div style={{ width: 90 }} />
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "32px 20px 60px" }}>

        {/* Search */}
        <div style={{ marginBottom: 36 }}>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12, fontFamily: "'Geist Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Enter a city
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") search(query); }}
              placeholder="e.g. New York, London, Tokyo..."
              style={{
                flex: 1, padding: "13px 16px",
                borderRadius: 12,
                border: "1px solid rgba(99,102,241,0.3)",
                background: "rgba(15,23,42,0.8)",
                color: "#e2e8f0", fontSize: 15,
                outline: "none",
                fontFamily: "inherit",
                transition: "border-color 180ms",
              }}
              onFocus={e => (e.currentTarget.style.borderColor = "rgba(99,102,241,0.7)")}
              onBlur={e => (e.currentTarget.style.borderColor = "rgba(99,102,241,0.3)")}
            />
            <button
              onClick={() => search(query)}
              disabled={loading || !query.trim()}
              style={{
                padding: "13px 22px", borderRadius: 12,
                background: loading ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.9)",
                border: "none", color: "#fff",
                fontSize: 14, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
                transition: "all 180ms", whiteSpace: "nowrap",
              }}
            >
              {loading ? "Loading..." : "Get Forecast"}
            </button>
          </div>
          {error && (
            <p style={{ marginTop: 10, color: "#f87171", fontSize: 13 }}>{error}</p>
          )}
        </div>

        {/* Empty state */}
        {!data && !loading && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 64, marginBottom: 16 }}>🌍</div>
            <p style={{ color: "#475569", fontSize: 15 }}>Search for any city to see the 3-day forecast and outfit suggestion.</p>
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 16, animation: "spin 2s linear infinite", display: "inline-block" }}>🌀</div>
            <p style={{ color: "#475569", fontSize: 15 }}>Fetching forecast...</p>
          </div>
        )}

        {/* Results */}
        {data && !loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

            {/* City header */}
            <div style={{ textAlign: "center" }}>
              <h1 style={{ fontSize: 32, fontWeight: 800, color: "#f1f5f9", margin: "0 0 4px 0" }}>
                {data.city}
                <span style={{ fontSize: 18, color: "#64748b", fontWeight: 400, marginLeft: 8 }}>{data.country}</span>
              </h1>
              <p style={{ color: "#64748b", fontSize: 13, fontFamily: "'Geist Mono', monospace", letterSpacing: "0.06em" }}>
                3-DAY FORECAST
              </p>
            </div>

            {/* Today summary cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {data.forecast.map((day, i) => (
                <div
                  key={i}
                  style={{
                    background: i === 0 ? "rgba(99,102,241,0.15)" : "rgba(15,23,42,0.6)",
                    border: `1px solid ${i === 0 ? "rgba(99,102,241,0.4)" : "rgba(99,102,241,0.12)"}`,
                    borderRadius: 14, padding: "16px 12px", textAlign: "center",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <div style={{ fontSize: 10, fontFamily: "'Geist Mono', monospace", letterSpacing: "0.12em", color: i === 0 ? "#a5b4fc" : "#475569", textTransform: "uppercase", marginBottom: 8 }}>
                    {i === 0 ? "Today" : day.day}
                  </div>
                  <div style={{ fontSize: 28, marginBottom: 6 }}>{day.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9" }}>{day.high}°</div>
                  <div style={{ fontSize: 13, color: "#64748b" }}>{day.low}°</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 6, lineHeight: 1.4 }}>{day.condition.replace(" with rain", "")}</div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <WeatherChart forecast={data.forecast} />

            {/* Outfit suggestion for today */}
            {today && (
              <OutfitSuggestion
                temp={today.avgTemp}
                condition={today.condition}
                windSpeed={today.avgWind}
              />
            )}

            {/* Wind & detail strip */}
            {today && (
              <div style={{
                display: "flex", gap: 12,
                background: "rgba(15,23,42,0.6)",
                borderRadius: 14, padding: "16px 20px",
                border: "1px solid rgba(99,102,241,0.12)",
                flexWrap: "wrap",
              }}>
                {[
                  { label: "Today's High", value: `${today.high}°F` },
                  { label: "Today's Low", value: `${today.low}°F` },
                  { label: "Avg Temp", value: `${today.avgTemp}°F` },
                  { label: "Max Wind", value: `${today.avgWind} mph` },
                ].map(item => (
                  <div key={item.label} style={{ flex: 1, minWidth: 100, textAlign: "center" }}>
                    <div style={{ fontSize: 10, fontFamily: "'Geist Mono', monospace", letterSpacing: "0.1em", color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#a5b4fc" }}>{item.value}</div>
                  </div>
                ))}
              </div>
            )}

          </div>
        )}
      </main>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
