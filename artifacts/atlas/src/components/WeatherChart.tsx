import React from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface ForecastDay {
  day: string;
  high: number;
  low: number;
  avgTemp: number;
  condition: string;
  icon: string;
  avgWind: number;
}

interface WeatherChartProps {
  forecast: ForecastDay[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: "rgba(15, 23, 42, 0.95)",
          border: "1px solid rgba(99, 102, 241, 0.3)",
          borderRadius: "12px",
          padding: "12px 16px",
          color: "#f1f5f9",
          fontSize: "13px",
          backdropFilter: "blur(8px)",
        }}
      >
        <p style={{ fontWeight: 700, marginBottom: 6, color: "#a5b4fc" }}>{label}</p>
        {payload.map((entry: any) => (
          <p key={entry.name} style={{ margin: "2px 0", color: entry.color }}>
            {entry.name}: <strong>{entry.value}°F</strong>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function WeatherChart({ forecast }: WeatherChartProps) {
  if (!forecast || forecast.length === 0) return null;

  return (
    <div
      style={{
        background: "rgba(15, 23, 42, 0.6)",
        borderRadius: "16px",
        padding: "24px",
        border: "1px solid rgba(99, 102, 241, 0.2)",
        backdropFilter: "blur(12px)",
      }}
    >
      <h3 style={{ color: "#e2e8f0", marginBottom: 20, fontSize: "16px", fontWeight: 600 }}>
        3-Day Temperature Forecast
      </h3>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={forecast} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="highGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="lowGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="avgGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis
            dataKey="day"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "rgba(148, 163, 184, 0.2)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}°`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ color: "#94a3b8", fontSize: "13px", paddingTop: "16px" }}
          />
          <Area
            type="monotone"
            dataKey="high"
            name="High"
            stroke="#f97316"
            strokeWidth={2.5}
            fill="url(#highGradient)"
            dot={{ fill: "#f97316", strokeWidth: 0, r: 5 }}
            activeDot={{ r: 7, fill: "#f97316" }}
          />
          <Area
            type="monotone"
            dataKey="avgTemp"
            name="Avg"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#avgGradient)"
            dot={{ fill: "#22d3ee", strokeWidth: 0, r: 4 }}
            activeDot={{ r: 6, fill: "#22d3ee" }}
          />
          <Area
            type="monotone"
            dataKey="low"
            name="Low"
            stroke="#6366f1"
            strokeWidth={2.5}
            fill="url(#lowGradient)"
            dot={{ fill: "#6366f1", strokeWidth: 0, r: 5 }}
            activeDot={{ r: 7, fill: "#6366f1" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}