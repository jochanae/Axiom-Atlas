import { useState } from "react";
import { Thought, Message } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerContent, DrawerTrigger, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";

export type ThoughtMetrics = {
  executionTimeMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
};

function formatDuration(ms?: number | null): string | null {
  if (!ms || ms < 1000) return null;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s - m * 60);
  return `${m}m ${rest}s`;
}

function formatCost(usd?: number | null): string {
  if (usd == null) return "—";
  if (usd < 0.0001) return `<$0.0001`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

function fmtNum(n?: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString();
}

function Details({ metrics }: { metrics: ThoughtMetrics }) {
  const total = (metrics.inputTokens ?? 0) + (metrics.outputTokens ?? 0);
  const row = (k: string, v: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "6px 0", borderBottom: "1px solid var(--atlas-border)" }}>
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--atlas-muted)" }}>{k}</span>
      <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>{v}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 220 }}>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7, marginBottom: 8 }}>
        Usage
      </div>
      {row("Thought for", formatDuration(metrics.executionTimeMs) ?? "—")}
      {row("Input tokens", fmtNum(metrics.inputTokens))}
      {row("Output tokens", fmtNum(metrics.outputTokens))}
      {row("Total tokens", fmtNum(total || null))}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "8px 0 2px" }}>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--atlas-muted)" }}>Cost</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "var(--atlas-gold)" }}>{formatCost(metrics.costUsd)}</span>
      </div>
    </div>
  );
}

export function ThoughtForBadge({ metrics }: { metrics: ThoughtMetrics }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const label = formatDuration(metrics.executionTimeMs);
  if (!label) return null;

  const Trigger = (
    <button
      type="button"
      style={{
        fontFamily: "var(--app-font-mono)",
        fontSize: 10,
        letterSpacing: "0.08em",
        color: "var(--atlas-muted)",
        opacity: 0.6,
        background: "transparent",
        border: "none",
        padding: "0 0 4px",
        cursor: "pointer",
        transition: "opacity 150ms",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
    >
      Thought for {label}
    </button>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{Trigger}</DrawerTrigger>
        <DrawerContent style={{ background: "var(--atlas-bg)", borderColor: "var(--atlas-border)" }}>
          <div style={{ padding: "8px 20px 24px" }}>
            <DrawerTitle style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-fg)", marginBottom: 4 }}>
              Message usage
            </DrawerTitle>
            <DrawerDescription style={{ fontSize: 11, color: "var(--atlas-muted)", marginBottom: 16 }}>
              Tokens and cost for this reply.
            </DrawerDescription>
            <Details metrics={metrics} />
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{Trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        style={{ background: "var(--atlas-bg)", borderColor: "var(--atlas-border)", padding: 14 }}
      >
        <Details metrics={metrics} />
      </PopoverContent>
    </Popover>
  );
}
