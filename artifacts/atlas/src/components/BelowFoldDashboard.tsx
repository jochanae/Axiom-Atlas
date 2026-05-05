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
  onOpenParking?: () => void;
  committedCount?: number;
  parkedCount?: number;
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

const MODE_COLORS: Record<number, string> = {
  0: "#C9A24C",
  1: "#06B6D4",
  2: "#8B5CF6",
  3: "#10B981",
};

export function BelowFoldDashboard({ projects, onOpenProject, onOpenLedger, onOpenParking, committedCount = 0, parkedCount }: Props) {
  if (projects.length === 0) return null;

  const recent = projects.slice(0, 5);
  const lastProject = projects[0];
  const actualParked = parkedCount ?? projects.length;

  return (
    <div style={{ width: "100%", maxWidth: 560, padding: "0 0 120px", display: "flex", flexDirection: "column", gap: 14 }}>

      {/* Scroll hint / divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
          Your workspace
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
      </div>

      {/* 1. ATLAS NOTICED */}
      {lastProject && (
        <RevealOnScroll delayMs={0}>
          <div className="atlas-discovery-card">
            <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10, opacity: 0.8 }}>
              Atlas noticed
            </div>
            <p style={{ fontSize: 13, color: "var(--atlas-fg)", opacity: 0.75, margin: 0, lineHeight: 1.6, fontStyle: "italic" }}>
              You've been returning to "{lastProject.name}." Every session gets you closer — what's the next move?
            </p>
          </div>
        </RevealOnScroll>
      )}

      {/* 2. YOUR MOMENTUM */}
      <RevealOnScroll delayMs={80}>
        <div className="atlas-discovery-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              Your Momentum
            </h3>
            {onOpenLedger && (
              <button type="button" onClick={onOpenLedger} style={{ background: "transparent", border: "none", fontSize: 10, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.05em", opacity: 0.75 }}>
                Open ledger →
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <MetricCell value={committedCount} label="DECISIONS COMMITTED" />
            <MetricCell value={projects.length} label="PROJECTS ACTIVE" />
          </div>
        </div>
      </RevealOnScroll>

      {/* 3. UNFINISHED THOUGHTS */}
      <RevealOnScroll delayMs={160}>
        <div className="atlas-discovery-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              Unfinished Thoughts
            </h3>
            {onOpenParking && (
              <button type="button" onClick={onOpenParking} style={{ background: "transparent", border: "none", fontSize: 10, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.05em", opacity: 0.75 }}>
                Open parking →
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 28, fontWeight: 200, color: "var(--atlas-gold)", lineHeight: 1, fontFamily: "var(--app-font-sans)" }}>
              {actualParked}
            </span>
            <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.65 }}>
              items parked
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--atlas-muted)", opacity: 0.6, fontStyle: "italic", lineHeight: 1.5 }}>
            Ideas waiting for their moment.
          </p>
        </div>
      </RevealOnScroll>

      {/* 4. WHERE WERE WE */}
      <RevealOnScroll delayMs={240}>
        <div className="atlas-discovery-card">
          <h3 style={{ margin: "0 0 12px", fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
            Where were we
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {recent.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onOpenProject(p.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 11,
                  width: "100%", padding: "8px 8px", borderRadius: 8,
                  border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.05)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {/* Mode dot */}
                <div style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: MODE_COLORS[i % 4],
                  opacity: 0.8,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-sans)" }}>
                    {p.name}
                  </div>
                  {p.description && (
                    <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                      {p.description}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.45, flexShrink: 0 }}>
                  {formatRelative(p.updatedAt)}
                </div>
              </button>
            ))}
          </div>
          {projects.length > 5 && (
            <button type="button"
              style={{ marginTop: 8, background: "transparent", border: "none", fontSize: 10.5, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.04em", opacity: 0.7, padding: "4px 8px" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
            >
              VIEW ALL →
            </button>
          )}
        </div>
      </RevealOnScroll>
    </div>
  );
}

function MetricCell({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-gold-border)" }}>
      <div style={{ fontSize: 26, fontWeight: 200, color: "var(--atlas-gold)", fontFamily: "var(--app-font-sans)", lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginTop: 5, textTransform: "uppercase", opacity: 0.65 }}>
        {label}
      </div>
    </div>
  );
}
