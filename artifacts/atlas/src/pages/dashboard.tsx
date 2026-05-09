import { useState } from "react";
import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { toast } from "sonner";
import { StatCard } from "@/components/stat-card";
import { useLocation } from "wouter";

const BASE_DATA = [
  { day: "Mon", score: 62, tasks: 8 },
  { day: "Tue", score: 74, tasks: 11 },
  { day: "Wed", score: 69, tasks: 9 },
  { day: "Thu", score: 81, tasks: 14 },
  { day: "Fri", score: 88, tasks: 16 },
  { day: "Sat", score: 77, tasks: 12 },
  { day: "Sun", score: 91, tasks: 18 },
];

function randomize(data: typeof BASE_DATA) {
  return data.map((d) => ({
    ...d,
    score: Math.max(40, Math.min(99, d.score + Math.floor((Math.random() - 0.5) * 20))),
    tasks: Math.max(4, d.tasks + Math.floor((Math.random() - 0.5) * 6)),
  }));
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(10,10,15,0.92)",
        border: "1px solid rgba(201,162,76,0.3)",
        borderRadius: 10,
        padding: "10px 14px",
        backdropFilter: "blur(12px)",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginBottom: 4, fontFamily: "monospace" }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#C9A24C", lineHeight: 1 }}>
        {payload[0]?.value}
      </div>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{payload[0]?.name}</div>
    </div>
  );
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState(BASE_DATA);
  const [refreshing, setRefreshing] = useState(false);
  const [key, setKey] = useState(0);

  const stats = {
    score: data[data.length - 1].score,
    tasks: data.reduce((s, d) => s + d.tasks, 0),
    focusHours: Math.round(data.reduce((s, d) => s + d.tasks * 0.72, 0) * 10) / 10,
    streak: 7,
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      const next = randomize(BASE_DATA);
      setData(next);
      setKey((k) => k + 1);
      setRefreshing(false);
      toast.success("Data refreshed", {
        description: `Productivity score updated to ${next[next.length - 1].score}`,
        duration: 3500,
      });
    }, 600);
  };

  return (
    <div
      style={{
        height: "100dvh",
        overflowY: "auto",
        background: "#0a0a0f",
        color: "#fff",
        fontFamily: "var(--app-font-sans, sans-serif)",
        paddingBottom: 48,
      }}
    >
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 28px",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          position: "sticky",
          top: 0,
          background: "rgba(10,10,15,0.88)",
          backdropFilter: "blur(16px)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button
            onClick={() => setLocation("/home")}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              color: "rgba(255,255,255,0.5)",
              cursor: "pointer",
              padding: "6px 12px",
              fontSize: 12,
              fontFamily: "inherit",
              transition: "all 160ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; e.currentTarget.style.color = "#C9A24C"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
          >
            ← Back
          </button>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
              Performance Dashboard
            </div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 1 }}>
              7-DAY PRODUCTIVITY OVERVIEW
            </div>
          </div>
        </div>

        <motion.button
          onClick={handleRefresh}
          disabled={refreshing}
          whileTap={{ scale: 0.96 }}
          style={{
            background: "rgba(201,162,76,0.12)",
            border: "1px solid rgba(201,162,76,0.4)",
            borderRadius: 10,
            color: "#C9A24C",
            cursor: refreshing ? "not-allowed" : "pointer",
            padding: "9px 20px",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: refreshing ? 0.6 : 1,
            transition: "all 200ms",
          }}
        >
          <span style={{ display: "inline-block", animation: refreshing ? "spin 0.7s linear infinite" : "none" }}>↻</span>
          {refreshing ? "Refreshing…" : "Refresh Data"}
        </motion.button>
      </motion.header>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 0" }}>
        {/* Stat cards */}
        <motion.div
          key={`cards-${key}`}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          <StatCard index={0} label="Productivity Score" value={stats.score} sub="↑ 4pts from last week" accent="#C9A24C" />
          <StatCard index={1} label="Tasks Completed" value={stats.tasks} sub="across 7 days" accent="#6EE7B7" />
          <StatCard index={2} label="Focus Hours" value={stats.focusHours} sub="deep work logged" accent="#818CF8" />
          <StatCard index={3} label="Day Streak" value={`${stats.streak}🔥`} sub="consecutive active days" accent="#F97316" />
        </motion.div>

        {/* Productivity trend chart */}
        <motion.div
          key={`chart-${key}`}
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.35 }}
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            padding: "28px 24px 20px",
            backdropFilter: "blur(12px)",
            marginBottom: 20,
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Productivity Trend</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 3, fontFamily: "monospace" }}>SCORE / DAY — CURRENT WEEK</div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C9A24C" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="#C9A24C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <YAxis domain={[40, 100]} tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(201,162,76,0.2)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="score" stroke="#C9A24C" strokeWidth={2.5} fill="url(#goldGrad)" dot={{ r: 4, fill: "#C9A24C", strokeWidth: 0 }} activeDot={{ r: 6, fill: "#C9A24C", stroke: "rgba(201,162,76,0.3)", strokeWidth: 6 }} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Task volume chart */}
        <motion.div
          key={`chart2-${key}`}
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.48 }}
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 20,
            padding: "28px 24px 20px",
            backdropFilter: "blur(12px)",
          }}
        >
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Daily Task Volume</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 3, fontFamily: "monospace" }}>TASKS COMPLETED / DAY</div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 6" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.25)", fontSize: 10, fontFamily: "monospace" }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(110,231,183,0.2)", strokeWidth: 1 }} />
              <Line type="monotone" dataKey="tasks" stroke="#6EE7B7" strokeWidth={2.5} dot={{ r: 4, fill: "#6EE7B7", strokeWidth: 0 }} activeDot={{ r: 6, fill: "#6EE7B7", stroke: "rgba(110,231,183,0.3)", strokeWidth: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
