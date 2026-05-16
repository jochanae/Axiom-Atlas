import { useEffect, useRef } from "react";

type LiveGenerationCardProps = {
  mode: "plan" | "blueprint" | "edit" | "thinking";
  steps: string[];
  isComplete: boolean;
};

const MODE_LABELS: Record<LiveGenerationCardProps["mode"], string> = {
  plan: "Creating plan",
  blueprint: "Generating blueprint",
  edit: "Editing files",
  thinking: "Thinking...",
};

export function LiveGenerationCard({ mode, steps, isComplete }: LiveGenerationCardProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [steps.length]);

  return (
    <div
      className="atlas-live-generation-card"
      style={{
        margin: "0 0 18px",
        padding: "11px 13px",
        borderRadius: 10,
        background: "var(--atlas-surface)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 18%, var(--atlas-border))",
        borderLeft: "3px solid var(--atlas-gold)",
        boxShadow: "0 14px 36px -30px var(--atlas-gold)",
        maxWidth: "80%",
        opacity: isComplete ? 0.72 : 1,
        transition: "opacity 220ms ease, transform 220ms ease",
      }}
    >
      <style>{`
        @keyframes atlas-live-generation-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes atlas-live-generation-pulse {
          0%, 100% { opacity: 0.48; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes atlas-live-generation-cursor {
          0%, 45% { opacity: 1; }
          46%, 100% { opacity: 0; }
        }
        .atlas-live-generation-card {
          animation: atlas-live-generation-in 180ms ease-out;
        }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: steps.length > 0 ? 9 : 0 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "var(--atlas-gold)",
            display: "inline-block",
            flexShrink: 0,
            animation: isComplete ? "none" : "atlas-live-generation-pulse 1.2s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--atlas-gold)",
          }}
        >
          {MODE_LABELS[mode]}
        </span>
      </div>

      {steps.length > 0 && (
        <div
          ref={listRef}
          style={{
            maxHeight: 180,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 6,
            paddingRight: 2,
          }}
        >
          {steps.map((step, index) => {
            const isLatest = index === steps.length - 1;
            const isDone = isComplete || !isLatest;
            return (
              <div
                key={`${index}-${step}`}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 7,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10.5,
                  color: isLatest && !isComplete ? "var(--atlas-fg)" : "var(--atlas-muted)",
                  opacity: isDone ? 0.72 : 0.95,
                  lineHeight: 1.45,
                  transition: "opacity 160ms ease, color 160ms ease",
                }}
              >
                <span style={{ color: isDone ? "var(--atlas-phosphor)" : "var(--atlas-gold)", flexShrink: 0 }}>
                  {isDone ? "✓" : ">"}
                </span>
                <span>
                  {step}
                  {isLatest && !isComplete && (
                    <span
                      style={{
                        display: "inline-block",
                        width: 6,
                        height: 12,
                        marginLeft: 3,
                        borderRight: "1px solid var(--atlas-gold)",
                        verticalAlign: -2,
                        animation: "atlas-live-generation-cursor 1s step-end infinite",
                      }}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
