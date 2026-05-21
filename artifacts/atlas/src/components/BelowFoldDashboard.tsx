import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { CompactReadinessRing } from "./ReadinessRing";

type RecentProject = {
  id: number;
  name: string;
  description?: string | null;
  updatedAt: string;
  latestSnapshotScore?: number | null;
};

type Props = {
  projects: RecentProject[];
  onOpenProject: (id: number) => void;
  onOpenLedger?: () => void;
  onOpenParking?: () => void;
  onOpenQuickPrompt?: () => void;
  committedCount?: number;
  parkedCount?: number;
  briefing?: string | null;
  briefingLoading?: boolean;
};

type ActivityItem = {
  type: "commit" | "decision" | "session";
  projectId: number;
  projectName: string;
  title: string;
  subtitle?: string;
  url?: string;
  sha?: string;
  timestamp: string;
};

function RevealOnScroll({ children, delayMs = 0, className }: { children: ReactNode; delayMs?: number; className?: string }) {
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
    <div ref={ref} className={className} style={{
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

const TYPE_COLOR: Record<ActivityItem["type"], string> = {
  commit:   "rgba(74,222,128,0.75)",
  decision: "rgba(201,162,76,0.8)",
  session:  "rgba(99,102,241,0.75)",
};

const TYPE_LABEL: Record<ActivityItem["type"], string> = {
  commit:   "push",
  decision: "decision",
  session:  "session",
};

function ActivityHubCard({ onOpenProject }: { onOpenProject: (id: number) => void }) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch("/api/nexus/activity", { credentials: "include" })
      .then(r => r.ok ? r.json() : { items: [] })
      .then((data: { items: ActivityItem[] }) => setItems(data.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visible = expanded ? items : items.slice(0, 6);

  return (
    <div className="atlas-discovery-card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
            <span className="bfd-mobile-label">Activity</span>
            <span className="bfd-desktop-label">Activity feed</span>
          </h3>
          {/* Legend */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.55 }}>
            {(["commit", "decision", "session"] as const).map(t => (
              <span key={t} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.04em" }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: TYPE_COLOR[t], display: "inline-block", flexShrink: 0 }} />
                {t}
              </span>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
          Live
        </span>
      </div>

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0" }}>
          <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid rgba(201,162,76,0.2)", borderTopColor: "rgba(201,162,76,0.7)", animation: "spin 0.8s linear infinite" }} />
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.04em" }}>Syncing…</span>
        </div>
      ) : items.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: "var(--atlas-muted)", opacity: 0.5, fontStyle: "italic", lineHeight: 1.5 }}>
          No activity yet. Link a GitHub repo or start a workspace session.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {visible.map((item, i) => (
              <ActivityRow key={`${item.type}-${item.projectId}-${item.timestamp}-${i}`} item={item} onOpenProject={onOpenProject} />
            ))}
          </div>
          {items.length > 6 && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{ marginTop: 10, background: "transparent", border: "none", fontSize: 10.5, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.04em", opacity: 0.7, padding: "4px 0" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.7"; }}
            >
              {expanded ? "SHOW LESS ↑" : `+${items.length - 6} MORE ↓`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ActivityRow({ item, onOpenProject }: { item: ActivityItem; onOpenProject: (id: number) => void }) {
  const dot = TYPE_COLOR[item.type];
  const label = TYPE_LABEL[item.type];

  const inner = (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "7px 8px", borderRadius: 7,
      cursor: "pointer", transition: "background 140ms ease",
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(201,162,76,0.04)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
    >
      {/* Dot + vertical line */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, paddingTop: 3 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 2 }}>
          {/* Project chip */}
          <span style={{
            fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)",
            background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
            borderRadius: 4, padding: "1px 5px", letterSpacing: "0.04em", flexShrink: 0,
            whiteSpace: "nowrap", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {item.projectName}
          </span>
          {/* Type badge */}
          <span style={{
            fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
            textTransform: "uppercase", color: dot, opacity: 0.8, flexShrink: 0,
          }}>
            {label}
          </span>
          {item.sha && (
            <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.04em" }}>
              {item.sha}
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: "var(--atlas-fg)", opacity: 0.82, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-sans)" }}>
          {item.title}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.subtitle}
          </div>
        )}
      </div>

      {/* Time */}
      <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, flexShrink: 0, paddingTop: 2, letterSpacing: "0.02em" }}>
        {formatRelative(item.timestamp)}
      </span>
    </div>
  );

  // Commits open in new tab, decisions/sessions navigate to project
  if (item.type === "commit" && item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", display: "block" }}>
        {inner}
      </a>
    );
  }
  return (
    <div onClick={() => onOpenProject(item.projectId)} style={{ cursor: "pointer" }}>
      {inner}
    </div>
  );
}

export function BelowFoldDashboard({ projects, onOpenProject, onOpenLedger, onOpenParking, onOpenQuickPrompt, committedCount = 0, parkedCount, briefing, briefingLoading }: Props) {
  const [showBriefing, setShowBriefing] = useState(false);
  if (projects.length === 0) return null;

  const recent = projects.slice(0, 5);
  const actualParked = parkedCount ?? projects.length;

  return (
    <div className="bfd-dashboard" style={{ width: "100%", maxWidth: 560, padding: "0 0 120px", display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`
        @keyframes briefingSlideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bfd-spin { to { transform: rotate(360deg); } }
        .bfd-overview-divider { order: 0; }
        .bfd-where { order: 1; }
        .bfd-activity { order: 2; }
        .bfd-momentum { order: 3; }
        .bfd-connections { order: 4; }
        .bfd-cognitive { order: 5; }
        @media (min-width: 1024px) {
          .bfd-dashboard {
            max-width: 1100px !important;
            display: grid !important;
            grid-template-columns: repeat(20, minmax(0, 1fr));
            gap: 16px !important;
          }
          .bfd-overview-divider { grid-column: 1 / -1; order: 0; }
          .bfd-connections { grid-column: 1 / -1; order: 1; }
          .bfd-where { grid-column: span 13; order: 2; }
          .bfd-momentum { grid-column: span 7; order: 3; }
          .bfd-activity { grid-column: span 10; order: 4; }
          .bfd-cognitive { grid-column: span 10; order: 5; }
          .bfd-mobile-label { display: none; }
          .bfd-desktop-label { display: inline; }
        }
        @media (max-width: 1023px) {
          .bfd-desktop-label { display: none; }
        }
      `}</style>

      {/* Scroll hint / divider */}
      <div className="bfd-overview-divider" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
          Your overview
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
      </div>

      {/* CONNECTIONS DOCK / QUICK PROMPT */}
      {onOpenQuickPrompt && (
        <RevealOnScroll delayMs={200} className="bfd-connections">
          <div className="atlas-discovery-card" style={{ cursor: "pointer", height: "100%", boxSizing: "border-box" }} onClick={onOpenQuickPrompt}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
                <span className="bfd-mobile-label">Quick Prompt</span>
                <span className="bfd-desktop-label">Connections Dock</span>
              </h3>
              <span style={{ fontSize: 10, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em", opacity: 0.75 }}>
                Open →
              </span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.55, opacity: 0.75 }}>
              Describe what you want to build. Pick your platform. Get a ready-to-paste prompt — no filler.
            </p>
            <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
              {["Cursor", "Replit", "Lovable", "Bolt"].map(p => (
                <span key={p} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.6)", border: "1px solid rgba(201,162,76,0.15)", borderRadius: 20, padding: "3px 10px" }}>
                  {p}
                </span>
              ))}
            </div>
          </div>
        </RevealOnScroll>
      )}

      {/* 1. WHERE WERE WE */}
      <RevealOnScroll delayMs={0} className="bfd-where">
        <div className="atlas-discovery-card" style={{ height: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: showBriefing ? 10 : 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
                Where were we
              </h3>
              <button
                type="button"
                onClick={() => setShowBriefing(v => !v)}
                title="Show briefing"
                style={{
                  background: showBriefing ? "rgba(201,162,76,0.12)" : "transparent",
                  border: `1px solid ${showBriefing ? "rgba(201,162,76,0.35)" : "rgba(201,162,76,0.18)"}`,
                  borderRadius: 5,
                  padding: "2px 6px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  transition: "all 150ms ease",
                }}
              >
                <span style={{ fontSize: 10, color: "var(--atlas-gold)", opacity: showBriefing ? 1 : 0.6, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
                  ✦
                </span>
                <span style={{ fontSize: 8.5, color: "var(--atlas-gold)", opacity: showBriefing ? 0.9 : 0.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  Briefing
                </span>
              </button>
            </div>
            <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
              Last 30 days
            </span>
          </div>

          {/* Inline briefing panel */}
          {showBriefing && (
            <div style={{
              marginBottom: 14,
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(201,162,76,0.04)",
              border: "1px solid rgba(201,162,76,0.12)",
              animation: "briefingSlideDown 200ms ease forwards",
            }}>
              {briefingLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid rgba(201,162,76,0.2)", borderTopColor: "rgba(201,162,76,0.7)", animation: "bfd-spin 0.8s linear infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.04em" }}>Atlas is preparing your briefing…</span>
                </div>
              ) : briefing ? (
                (() => {
                  const sentences = briefing.split(/(?<=[.!?])\s+/);
                  const status = sentences[0] ?? "";
                  const rest = sentences.slice(1).join(" ");
                  return (
                    <>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 400, color: "var(--atlas-fg)", lineHeight: 1.6, fontFamily: "var(--app-font-sans)", opacity: 0.88 }}>
                        {status}
                      </p>
                      {rest && (
                        <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--atlas-gold)", opacity: 0.7, fontStyle: "italic", lineHeight: 1.5, fontFamily: "var(--app-font-sans)" }}>
                          {rest}
                        </p>
                      )}
                    </>
                  );
                })()
              ) : (
                <p style={{ margin: 0, fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.5, fontStyle: "italic" }}>
                  No briefing available yet.
                </p>
              )}
            </div>
          )}
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
                <div style={{
                  width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                  background: MODE_COLORS[i % 4], opacity: 0.8,
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
                <CompactReadinessRing score={p.latestSnapshotScore ?? 0} />
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

      {/* 2. ACTIVITY HUB */}
      <RevealOnScroll delayMs={80} className="bfd-activity">
        <ActivityHubCard onOpenProject={onOpenProject} />
      </RevealOnScroll>

      {/* 3. YOUR MOMENTUM */}
      <RevealOnScroll delayMs={160} className="bfd-momentum">
        <div className="atlas-discovery-card" style={{ height: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              Your Momentum
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {onOpenLedger && (
                <button type="button" onClick={onOpenLedger} style={{ background: "transparent", border: "none", fontSize: 10, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.05em", opacity: 0.75 }}>
                  Ledger →
                </button>
              )}
              <DashboardLink />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <MetricCell value={committedCount} label="DECISIONS COMMITTED" />
            <MetricCell value={projects.length} label="PROJECTS ACTIVE" />
          </div>
        </div>
      </RevealOnScroll>

      {/* 4. UNFINISHED THOUGHTS */}
      <RevealOnScroll delayMs={240} className="bfd-cognitive">
        <div className="atlas-discovery-card" style={{ height: "100%", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              <span className="bfd-mobile-label">Unfinished Thoughts</span>
              <span className="bfd-desktop-label">Cognitive Momentum</span>
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
    </div>
  );
}

function DashboardLink() {
  const [, nav] = useLocation();
  return (
    <button
      type="button"
      onClick={() => nav("/dashboard")}
      style={{
        background: "transparent", border: "none", fontSize: 10,
        color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)",
        cursor: "pointer", letterSpacing: "0.05em", opacity: 0.75,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.75")}
    >
      Dashboard →
    </button>
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
