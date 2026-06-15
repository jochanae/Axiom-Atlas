import { useState } from "react";
import type { MemoryChip } from "@/pages/workspace";

export function InsightChip({
  chip,
  onPark,
  onDismiss,
}: {
  chip: MemoryChip;
  onPark: (chip: MemoryChip) => void;
  onDismiss?: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasInsight = !!chip.insight;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 20,
          background: open ? "rgba(201,162,76,0.14)" : "rgba(201,162,76,0.07)",
          border: `1px solid ${open ? "rgba(201,162,76,0.42)" : "rgba(201,162,76,0.18)"}`,
          fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
          color: open ? "rgba(201,162,76,1)" : "rgba(201,162,76,0.75)",
          cursor: "pointer", transition: "all 140ms ease",
        }}
        onMouseEnter={(e) => { if (!open) { e.currentTarget.style.background = "rgba(201,162,76,0.12)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; } }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)"; } }}
      >
        <span style={{ opacity: 0.55, fontSize: 9 }}>◆</span>
        {chip.label}
        {hasInsight && (
          <span style={{ fontSize: 8, opacity: 0.45, display: "inline-block", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>▾</span>
        )}
      </button>
      {open && (
        <div
          className="atlas-bubble-in"
          style={{
            marginTop: 5, borderRadius: 9,
            background: "var(--atlas-surface-alt)",
            border: "1px solid rgba(201,162,76,0.2)",
            padding: "11px 13px", maxWidth: 300,
            position: "relative", zIndex: 5,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: hasInsight ? 6 : 8, letterSpacing: "-0.01em" }}>
            {chip.label}
          </div>
          {chip.insight && (
            <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: 10, fontStyle: "italic", opacity: 0.85 }}>
              {chip.insight}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <button
              type="button"
              onClick={() => { onPark(chip); setOpen(false); }}
              style={{
                background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
                border: "1px solid rgba(201,162,76,0.3)",
                borderRadius: 6, color: "var(--atlas-gold)",
                fontSize: 10, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", padding: "4px 10px",
                letterSpacing: "0.05em", transition: "background 130ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 20%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 12%, transparent)")}
            >
              Park this →
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={() => { onDismiss(chip.label); setOpen(false); }}
                style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 11, opacity: 0.38, padding: "4px 5px", transition: "opacity 120ms", fontFamily: "var(--app-font-mono)" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.38")}
              >
                Dismiss
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 14, opacity: 0.3, padding: "2px 6px", marginLeft: "auto", lineHeight: 1, transition: "opacity 120ms" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.65")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.3")}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
