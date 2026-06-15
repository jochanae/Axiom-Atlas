import { useMemo, useState, type CSSProperties } from "react";

export type ThinkingStep = {
  id: string;
  phase: "scan" | "analyze" | "protect" | "render";
  label: string;
  durationMs?: number;
};

export type DeveloperLens = {
  routing: { activeModel: string; provider: string; fallbackTriggered: boolean };
  telemetry: { tokensPerSecond: number; inputTokens: number; executionStrategy: string };
};

export type ThinkingState = {
  status: "processing" | "streaming" | "completed";
  currentStep: ThinkingStep | null;
  history: ThinkingStep[];
  developerLens?: DeveloperLens;
};

interface Props {
  thinkingState: ThinkingState;
}

const monoFont = "var(--app-font-mono)";
const gold = "rgba(212,175,55,0.9)";

function formatDuration(durationMs?: number): string {
  if (durationMs == null) return "";
  if (durationMs < 1000) return `${durationMs}ms`;
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function DeveloperLensRow({ label, value }: { label: string; value: string | number | boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, lineHeight: 1.55 }}>
      <span style={{ opacity: 0.45 }}>{label}</span>
      <span style={{ color: "rgba(255,255,255,0.72)", textAlign: "right" }}>{String(value)}</span>
    </div>
  );
}

export function AtlasThinkingBlock({ thinkingState }: Props) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const { status, currentStep, history, developerLens } = thinkingState;
  const isProcessing = status === "processing";
  const collapsedLabels = useMemo(() => {
    const labels = history.length > 0 ? history.map((step) => step.label) : currentStep ? [currentStep.label] : [];
    return labels.length > 0 ? `✓ ${labels.join(" → ")}` : "✓ Thinking complete";
  }, [currentStep, history]);

  const containerStyle: CSSProperties = {
    background: isProcessing ? "rgba(212,175,55,0.04)" : "transparent",
    border: `1px solid ${isProcessing ? "rgba(212,175,55,0.12)" : "transparent"}`,
    borderRadius: 10,
    padding: isProcessing ? "10px 14px" : "4px 14px",
    maxHeight: isProcessing ? 260 : 18,
    overflow: "hidden",
    transition:
      "max-height 300ms cubic-bezier(0.25,1,0.5,1), padding 300ms cubic-bezier(0.25,1,0.5,1), background-color 300ms cubic-bezier(0.25,1,0.5,1), border-color 300ms cubic-bezier(0.25,1,0.5,1), opacity 300ms cubic-bezier(0.25,1,0.5,1), transform 300ms cubic-bezier(0.25,1,0.5,1)",
    transform: isProcessing ? "translateY(0)" : "translateY(-1px)",
    opacity: 1,
    willChange: "transform, opacity, max-height",
  };

  const drawerStyle: CSSProperties = {
    background: "rgba(212,175,55,0.04)",
    border: "1px solid rgba(212,175,55,0.1)",
    borderRadius: 8,
    padding: isDrawerOpen ? 10 : "0 10px",
    fontFamily: monoFont,
    fontSize: 11,
    color: "rgba(255,255,255,0.78)",
    maxHeight: isDrawerOpen ? 160 : 0,
    opacity: isDrawerOpen ? 1 : 0,
    overflow: "hidden",
    transform: isDrawerOpen ? "translateY(0)" : "translateY(-4px)",
    transition: "max-height 250ms ease, opacity 250ms ease, transform 250ms ease, padding 250ms ease",
    willChange: "transform, opacity, max-height",
  };

  return (
    <div>
      <style>{`
        @keyframes atlasPulse {
          0%,100%{opacity:0.5;transform:scale(1)}
          50%{opacity:1;transform:scale(1.35)}
        }
      `}</style>

      <div style={containerStyle}>
        {isProcessing ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {history.map((step) => (
              <div
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: 0.45,
                  transform: "translateZ(0)",
                  transition: "opacity 180ms ease, transform 180ms ease",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "rgba(80,180,120,0.7)",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    fontFamily: monoFont,
                    fontSize: 11,
                    color: "rgba(255,255,255,0.78)",
                    lineHeight: 1.4,
                  }}
                >
                  {step.label}
                </span>
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 10,
                    color: "rgba(255,255,255,0.65)",
                    lineHeight: 1,
                    minWidth: 34,
                    textAlign: "right",
                  }}
                >
                  {formatDuration(step.durationMs)}
                </span>
              </div>
            ))}

            {currentStep && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  transform: "translateZ(0)",
                  transition: "opacity 180ms ease, transform 180ms ease",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: gold,
                    flexShrink: 0,
                    animation: "atlasPulse 1.2s ease-in-out infinite",
                  }}
                />
                <span
                  style={{
                    fontFamily: monoFont,
                    fontSize: 12,
                    color: gold,
                    lineHeight: 1.4,
                  }}
                >
                  {currentStep.label}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              opacity: 0.35,
              fontFamily: monoFont,
              fontSize: 10,
              color: "rgba(255,255,255,0.76)",
              lineHeight: "10px",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              transform: "translateZ(0)",
              transition: "opacity 180ms ease, transform 180ms ease",
            }}
          >
            {collapsedLabels}
          </div>
        )}
      </div>

      {!isProcessing && (
        <div style={{ marginTop: 6 }}>
          <button
            type="button"
            onClick={() => setIsDrawerOpen((open) => !open)}
            aria-expanded={isDrawerOpen}
            style={{
              appearance: "none",
              background: "transparent",
              border: "none",
              padding: 0,
              color: "rgba(255,255,255,0.78)",
              fontFamily: monoFont,
              fontSize: 10,
              opacity: 0.4,
              cursor: "pointer",
              lineHeight: 1.4,
              transition: "opacity 180ms ease, transform 180ms ease",
              transform: isDrawerOpen ? "translateX(2px)" : "translateX(0)",
            }}
          >
            ↳ atlas · tap to inspect
          </button>

          <div style={{ ...drawerStyle, marginTop: isDrawerOpen ? 8 : 0 }}>
            <DeveloperLensRow label="model" value={developerLens?.routing.activeModel ?? "unavailable"} />
            <DeveloperLensRow label="provider" value={developerLens?.routing.provider ?? "unavailable"} />
            <DeveloperLensRow label="fallback" value={developerLens?.routing.fallbackTriggered ?? "unavailable"} />
            <DeveloperLensRow label="tokens/sec" value={developerLens?.telemetry.tokensPerSecond ?? "unavailable"} />
            <DeveloperLensRow label="input tokens" value={developerLens?.telemetry.inputTokens ?? "unavailable"} />
            <DeveloperLensRow label="strategy" value={developerLens?.telemetry.executionStrategy ?? "unavailable"} />
          </div>
        </div>
      )}
    </div>
  );
}
