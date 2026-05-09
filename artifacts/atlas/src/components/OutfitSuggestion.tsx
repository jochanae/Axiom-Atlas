import React from "react";

interface OutfitProps {
  temp: number;
  condition: string;
  windSpeed: number;
}

interface OutfitResult {
  summary: string;
  items: string[];
  emoji: string;
  colorAccent: string;
}

function getOutfit(temp: number, condition: string, windSpeed: number): OutfitResult {
  const isRain = condition.toLowerCase().includes("rain") || condition.toLowerCase().includes("drizzle");
  const isSnow = condition.toLowerCase().includes("snow");
  const isHighWind = windSpeed > 20;
  const cond = condition.toLowerCase();

  let result: OutfitResult;

  if (temp < 32) {
    if (isSnow) {
      result = {
        summary: "Bundle up — it's freezing and snowing.",
        items: ["Heavy insulated parka", "Thermal base layers", "Waterproof snow boots", "Wool gloves", "Beanie or fur-lined hat", "Thick scarf"],
        emoji: "🧣",
        colorAccent: "#6366f1",
      };
    } else {
      result = {
        summary: "It's below freezing. Full winter mode.",
        items: ["Heavy coat", "Sweater or fleece mid-layer", "Warm boots", "Gloves", "Scarf", "Winter hat"],
        emoji: "🧥",
        colorAccent: "#818cf8",
      };
    }
  } else if (temp >= 32 && temp < 50) {
    if (isRain) {
      result = {
        summary: "Cold and wet — dress for both.",
        items: ["Waterproof jacket", "Sweater underneath", "Waterproof boots", "Umbrella", "Light scarf"],
        emoji: "☔",
        colorAccent: "#38bdf8",
      };
    } else {
      result = {
        summary: "Chilly — jacket and layers required.",
        items: ["Medium weight jacket", "Jeans or warm trousers", "Closed-toe shoes or boots", "Light scarf or neck warmer"],
        emoji: "🧤",
        colorAccent: "#7dd3fc",
      };
    }
  } else if (temp >= 50 && temp < 65) {
    if (isRain) {
      result = {
        summary: "Cool with rain — stay dry and comfortable.",
        items: ["Light waterproof jacket", "Long-sleeve shirt", "Jeans", "Waterproof shoes", "Compact umbrella"],
        emoji: "🌧️",
        colorAccent: "#22d3ee",
      };
    } else {
      result = {
        summary: "Cool and comfortable — layer lightly.",
        items: ["Hoodie or light jacket", "Jeans or chinos", "Sneakers or casual shoes", "Light scarf optional"],
        emoji: "🪂",
        colorAccent: "#34d399",
      };
    }
  } else if (temp >= 65 && temp < 75) {
    if (isRain) {
      result = {
        summary: "Warm but rainy — light layers, stay dry.",
        items: ["Light cardigan or windbreaker", "T-shirt", "Casual trousers or jeans", "Compact umbrella"],
        emoji: "🌦️",
        colorAccent: "#a3e635",
      };
    } else {
      result = {
        summary: "Perfect weather — dress comfortably.",
        items: ["T-shirt or light blouse", "Jeans, chinos, or skirt", "Sneakers", "Light layer for evening"],
        emoji: "😎",
        colorAccent: "#facc15",
      };
    }
  } else {
    if (isRain) {
      result = {
        summary: "Hot and rainy — stay light and dry.",
        items: ["Breathable light top", "Shorts or light trousers", "Waterproof sandals or sneakers", "Compact umbrella"],
        emoji: "🌩️",
        colorAccent: "#fb923c",
      };
    } else {
      result = {
        summary: "Hot day — go light and protect your skin.",
        items: ["Breathable t-shirt or tank", "Shorts or light dress", "Sandals or lightweight sneakers", "Sunglasses", "Sunscreen", "Hat for sun protection"],
        emoji: "☀️",
        colorAccent: "#f97316",
      };
    }
  }

  // Wind override — append to any outfit
  if (isHighWind && !isSnow) {
    result.items.push("Windbreaker (winds are strong today)");
    result.summary += " High winds — add a windbreaker.";
  }

  return result;
}

export default function OutfitSuggestion({ temp, condition, windSpeed }: OutfitProps) {
  const outfit = getOutfit(temp, condition, windSpeed);

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.6)",
        borderRadius: "16px",
        padding: "24px",
        border: `1px solid ${outfit.colorAccent}40`,
        backdropFilter: "blur(12px)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Accent glow */}
      <div
        style={{
          position: "absolute",
          top: -40,
          right: -40,
          width: 120,
          height: 120,
          borderRadius: "50%",
          background: `${outfit.colorAccent}20`,
          filter: "blur(30px)",
          pointerEvents: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 36 }}>{outfit.emoji}</span>
        <div>
          <h3 style={{ color: outfit.colorAccent, fontSize: "16px", fontWeight: 700, margin: 0 }}>
            Outfit Suggestion
          </h3>
          <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0 0" }}>
            Based on {Math.round(temp)}°F · {condition}
          </p>
        </div>
      </div>

      <p style={{ color: "#e2e8f0", fontSize: "15px", marginBottom: 16, fontWeight: 500 }}>
        {outfit.summary}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {outfit.items.map((item, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              background: "rgba(255,255,255,0.04)",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: outfit.colorAccent,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#cbd5e1", fontSize: "14px" }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}