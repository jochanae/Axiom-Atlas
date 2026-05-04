import type { ReactNode } from "react";
import type { Severity } from "./StatusGlyph";

const severityColor: Record<Severity, string> = {
  blocker:   "var(--atlas-ember)",
  parked:    "var(--atlas-gold)",
  committed: "var(--atlas-phosphor)",
  neutral:   "var(--atlas-gold)",
};

export function CapsuleTag({
  children,
  severity = "neutral",
  variant = "ghost",
  size = "sm",
}: {
  children: ReactNode;
  severity?: Severity;
  variant?: "ghost" | "solid";
  size?: "xs" | "sm";
}) {
  const color = severityColor[severity];
  const padding = size === "xs" ? "1px 6px" : "2px 8px";
  const fontSize = size === "xs" ? 9 : 10;

  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "var(--app-font-mono)",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    borderRadius: 2,
    padding,
    fontSize,
    lineHeight: 1,
  };

  if (variant === "solid") {
    return (
      <span style={{
        ...base,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        color,
        border: `0.5px solid color-mix(in srgb, ${color} 50%, transparent)`,
      }}>
        {children}
      </span>
    );
  }

  return (
    <span style={{
      ...base,
      background: "transparent",
      color: `color-mix(in srgb, ${color} 85%, var(--atlas-fg))`,
      border: `0.5px solid color-mix(in srgb, ${color} 55%, transparent)`,
    }}>
      {children}
    </span>
  );
}
