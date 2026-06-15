import { motion } from "framer-motion";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  index?: number;
}

export function StatCard({ label, value, sub, accent = "#C9A24C", index = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 22, delay: index * 0.08 }}
      style={{
        background: "color-mix(in oklab, var(--atlas-fg) 4%, transparent)",
        border: "1px solid color-mix(in oklab, var(--atlas-fg) 10%, transparent)",
        borderRadius: 16,
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        backdropFilter: "blur(12px)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(90deg, transparent, ${accent}55, transparent)`,
        }}
      />
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--atlas-muted)",
          fontFamily: "var(--app-font-mono, monospace)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "var(--atlas-fg)",
          lineHeight: 1,
          fontFamily: "var(--app-font-sans, sans-serif)",
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 12, color: accent, fontFamily: "var(--app-font-sans, sans-serif)", opacity: 0.85 }}>
          {sub}
        </span>
      )}
    </motion.div>
  );
}
