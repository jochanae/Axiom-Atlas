import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { motion } from "framer-motion";
import { toast } from "sonner";

// ── Mock data ──────────────────────────────────────────────────────────────────
const generateData = () => [
  { day: "Mon", productivity: 62 + Math.floor(Math.random() * 10) },
  { day: "Tue", productivity: 75 + Math.floor(Math.random() * 10) },
  { day: "Wed", productivity: 68 + Math.floor(Math.random() * 10) },
  { day: "Thu", productivity: 84 + Math.floor(Math.random() * 10) },
  { day: "Fri", productivity: 79 + Math.floor(Math.random() * 10) },
  { day: "Sat", productivity: 55 + Math.floor(Math.random() * 10) },
  { day: "Sun", productivity: 91 + Math.floor(Math.random() * 10) },
];

// ── Stat cards config ─────────────────────────────────────────────────────────
const STATS = [
  { label: "Tasks Completed", value: "128", delta: "+12%", up: true },
  { label: "Focus Hours", value: "34.5h", delta: "+8%", up: true },
  { label: "Blockers Logged", value: "4", delta: "-2", up: false },
  { label: "Team Velocity", value: "92", delta: "+5%", up: true },
];

// ── Animation variants ────────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12 },
  },
};

const springIn = {
  hidden: { opacity: 0, y: 32, scale: 0.96 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 260, damping: 22 },
  },
};

// ── Custom tooltip for the chart ──────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "rgba(15,15,20,0.92)",
        border: "1px solid rgba(139,92,246,0.4)",
        borderRadius: 10,
        padding: "10px 16px",
        backdropFilter: "blur(8px)",
      }}
    >
      <p style={{ color: "#a78bfa", fontWeight: 600, margin: 0 }}>{label}</p>
      <p style={{ color: "#e2e8f0", margin: "4px 0 0" }}>
        {payload[0].value}
        <span style={{ color: "#64748b", fontSize: 12 }}> pts</span>
      </p>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [data, setData] = useState(generateData());
  const [key, setKey] = useState(0); // force re-animation on refresh

  const handleRefresh = () => {
    setData(generateData());
    setKey((k) => k + 1);
    toast.success("Data refreshed", {
      description: "Productivity trend updated with latest metrics.",
      style: {
        background: "rgba(15,15,20,0.95)",
        border: "1px solid rgba(139,92,246,0.5)",
        color: "#e2e8f0",
      },
    });
  };

  return (
    <div style={styles.page}>
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        style={styles.header}
      >
        <div>
          <h1 style={styles.title}>Performance Dashboard</h1>
          <p style={styles.subtitle}>Weekly productivity overview</p>
        </div>
        <button onClick={handleRefresh} style={styles.refreshBtn}>
          ↻ Refresh Data
        </button>
      </motion.div>

      {/* ── Stat cards ── */}
      <motion.div
        key={`cards-${key}`}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        style={styles.cardGrid}
      >
        {STATS.map((stat) => (
          <motion.div key={stat.label} variants={springIn} style={styles.card}>
            <p style={styles.cardLabel}>{stat.label}</p>
            <p style={styles.cardValue}>{stat.value}</p>
            <span
              style={{
                ...styles.cardDelta,
                color: stat.up ? "#34d399" : "#f87171",
              }}
            >
              {stat.delta}
            </span>
          </motion.div>
        ))}
      </motion.div>

      {/* ── Chart ── */}
      <motion.div
        key={`chart-${key}`}
        variants={springIn}
        initial="hidden"
        animate="visible"
        style={styles.chartCard}
      >
        <p style={styles.chartTitle}>Productivity Trend</p>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#8b5cf6" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
            />
            <XAxis
              dataKey="day"
              tick={{ fill: "#64748b", fontSize: 13 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[40, 100]}
              tick={{ fill: "#64748b", fontSize: 13 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="productivity"
              stroke="url(#lineGradient)"
              strokeWidth={3}
              dot={{ r: 5, fill: "#8b5cf6", strokeWidth: 2, stroke: "#1e1e2e" }}
              activeDot={{ r: 7, fill: "#a78bfa" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 50%, #0a0a0f 100%)",
    padding: "40px 32px",
    fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
    maxWidth: 1100,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 40,
  },
  title: {
    margin: 0,
    fontSize: 28,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-0.5px",
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 14,
    color: "#475569",
  },
  refreshBtn: {
    padding: "10px 22px",
    borderRadius: 10,
    border: "1px solid rgba(139,92,246,0.5)",
    background: "rgba(139,92,246,0.12)",
    color: "#a78bfa",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    letterSpacing: "0.3px",
    transition: "all 0.2s ease",
  },
  cardGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
    marginBottom: 28,
  },
  card: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    padding: "24px 28px",
    backdropFilter: "blur(12px)",
  },
  cardLabel: {
    margin: 0,
    fontSize: 13,
    color: "#475569",
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.8px",
  },
  cardValue: {
    margin: "10px 0 6px",
    fontSize: 32,
    fontWeight: 700,
    color: "#f1f5f9",
    letterSpacing: "-1px",
  },
  cardDelta: {
    fontSize: 13,
    fontWeight: 600,
  },
  chartCard: {
    background:
      "linear-gradient(145deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)",
    border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: 16,
    padding: "28px 24px 16px",
    backdropFilter: "blur(12px)",
  },
  chartTitle: {
    margin: "0 0 20px",
    fontSize: 16,
    fontWeight: 600,
    color: "#cbd5e1",
    letterSpacing: "-0.2px",
  },
};