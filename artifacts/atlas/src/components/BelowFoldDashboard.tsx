import { useEffect, useRef, useState, type ReactNode } from "react";

type RecentProject = {
  id: number;
  name: string;
  description?: string | null;
  updatedAt: string;
};

type Props = {
  projects: RecentProject[];
  onOpenProject: (id: number) => void;
  onOpenLedger?: () => void;
};

function RevealOnScroll({ children, delayMs = 0 }: { children: ReactNode; delayMs?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setRevealed(true); return; }
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) { setRevealed(true); obs.disconnect(); } },
      { threshold: 0.12, rootMargin: "0px 0px -30px 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{
      opacity: revealed ? 1 : 0,
      transform: revealed ? "translateY(0)" : "translateY(14px)",
      transition: `opacity 550ms cubic-bezier(0.4,0,0.2,1) ${delayMs}ms, transform 550ms cubic-bezier(0.4,0,0.2,1) ${delayMs}ms`,
    }}>
      {children}
    </div>
  );
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const cardBase: React.CSSProperties = {
  background: "rgba(28,25,23,0.6)",
  border: "1px solid rgba(201,162,76,0.10)",
  borderRadius: 12,
  padding: "16px 18px",
  backdropFilter: "blur(8px)",
};

export function BelowFoldDashboard({ projects, onOpenProject, onOpenLedger }: Props) {
  if (projects.length === 0) return null;

  const recent = projects.slice(0, 4);
  const lastProject = projects[0];

  return (
    <div style={{ width: "100%", maxWidth: 560, padding: "36px 0 120px", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(201,162,76,0.08)" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.45 }}>
          Recent Activity
        </span>
        <div style={{ flex: 1, height: 1, background: "rgba(201,162,76,0.08)" }} />
      </div>

      {/* Atlas noticed card */}
      {lastProject && (
        <RevealOnScroll delayMs={0}>
          <div style={{ ...cardBase, borderColor: "rgba(201,162,76,0.14)", background: "rgba(20,17,15,0.7)" }}>
            <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(201,162,76,0.55)", marginBottom: 8 }}>
              Atlas noticed
            </div>
            <p style={{ fontSize: 13, color: "var(--atlas-fg)", opacity: 0.75, margin: 0, lineHeight: 1.55, fontStyle: "italic", fontFamily: "var(--app-font-sans)" }}>
              You've been building in "{lastProject.name}." Every session counts — ready to pick up where you left off?
            </p>
            <button
              type="button"
              onClick={() => onOpenProject(lastProject.id)}
              style={{
                marginTop: 12, padding: "7px 14px", borderRadius: 7, border: "1px solid rgba(201,162,76,0.22)",
                background: "transparent", color: "var(--atlas-gold)", fontSize: 11,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", cursor: "pointer",
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.06)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              Continue →
            </button>
          </div>
        </RevealOnScroll>
      )}

      {/* Momentum / Ledger card */}
      <RevealOnScroll delayMs={80}>
        <div style={cardBase}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 12, fontWeight: 600, fontFamily: "var(--app-font-sans)", color: "var(--atlas-fg)", opacity: 0.85 }}>
              Your Momentum
            </h3>
            {onOpenLedger && (
              <button type="button" onClick={onOpenLedger} style={{ background: "transparent", border: "none", fontSize: 11, color: "rgba(201,162,76,0.6)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.04em" }}>
                Open ledger →
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(12,10,9,0.5)", border: "1px solid rgba(201,162,76,0.08)" }}>
              <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", lineHeight: 1 }}>{projects.length}</div>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", marginTop: 4, opacity: 0.7 }}>projects active</div>
            </div>
            <div style={{ padding: "12px 14px", borderRadius: 8, background: "rgba(12,10,9,0.5)", border: "1px solid rgba(201,162,76,0.08)" }}>
              <div style={{ fontSize: 22, fontWeight: 300, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", lineHeight: 1 }}>—</div>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", marginTop: 4, opacity: 0.7 }}>decisions logged</div>
            </div>
          </div>
        </div>
      </RevealOnScroll>

      {/* Recent projects list */}
      <RevealOnScroll delayMs={160}>
        <div style={cardBase}>
          <h3 style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 600, fontFamily: "var(--app-font-sans)", color: "var(--atlas-fg)", opacity: 0.85 }}>
            Where were we
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  width: "100%", padding: "8px 8px", borderRadius: 8,
                  border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                  animation: `atlas-bubble-in 280ms both ${i * 60}ms`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 22%, 20%)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 600, color: "rgba(231,229,228,0.7)",
                  fontFamily: "var(--app-font-mono)",
                }}>
                  {p.name[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                      {p.description}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.5, flexShrink: 0 }}>
                  {formatRelative(p.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        </div>
      </RevealOnScroll>
    </div>
  );
}
