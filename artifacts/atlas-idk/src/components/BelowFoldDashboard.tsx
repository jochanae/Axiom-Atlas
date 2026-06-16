import { useEffect, useRef, useState, type ReactNode } from "react";
import { Project } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { StatCard } from "./stat-card";
import { CompactReadinessRing } from "./ReadinessRing";
import { useProjectState } from "../hooks/useProjectState";
import { fetchGitHubStatus } from "@/hooks/useGitHub";

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
            Activity
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

type HeroStats = {
  sessionsThisWeek: number;
  totalDecisions: number;
  activeProjects: number;
  violations: number;
  dailySessions: { day: string; sessions: number }[];
};

function HeroChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--atlas-surface)",
      border: "1px solid rgba(201,162,76,0.3)",
      borderRadius: 10, padding: "10px 14px",
      backdropFilter: "blur(12px)",
    }}>
      <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginBottom: 4, fontFamily: "var(--app-font-mono)" }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--atlas-gold)", lineHeight: 1 }}>
        {payload[0]?.value}
      </div>
      <div style={{ fontSize: 10, color: "var(--atlas-muted)", marginTop: 2, opacity: 0.7 }}>
        {payload[0]?.value === 1 ? "session" : "sessions"}
      </div>
    </div>
  );
}

function StatsHero() {
  const [stats, setStats] = useState<HeroStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats/dashboard", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setStats(data);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!stats) return null;

  return (
    <>
      {/* Stat tiles */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        gap: 12,
        marginBottom: 28,
      }}>
        <StatCard index={0} label="Sessions This Week" value={stats.sessionsThisWeek} sub="thinking sessions" accent="var(--atlas-gold)" />
        <StatCard index={1} label="Committed Decisions" value={stats.totalDecisions} sub="in the ledger" accent="#6EE7B7" />
        <StatCard index={2} label="Active Projects" value={stats.activeProjects} sub="sessions this week" accent="#818CF8" />
        <StatCard
          index={3}
          label="Overrides"
          value={stats.violations}
          sub={stats.violations === 0 ? "clean ledger" : "direction shifted"}
          accent={stats.violations > 0 ? "var(--atlas-ember)" : "#6EE7B7"}
        />
      </div>

      {/* Sessions chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.18 }}
        className="atlas-discovery-card"
        style={{ padding: "22px 18px 14px" }}
      >
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)" }}>Sessions This Week</div>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 2, letterSpacing: "0.08em", opacity: 0.6 }}>
            THINKING SESSIONS / DAY
          </div>
        </div>
        {stats.dailySessions.every((d) => d.sessions === 0) ? (
          <div style={{
            height: 140, display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 11, opacity: 0.45,
          }}>
            No sessions this week yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={stats.dailySessions} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
              <defs>
                <linearGradient id="bfdHeroGold" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C9A24C" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#C9A24C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 6" stroke="var(--atlas-border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)" }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)" }} axisLine={false} tickLine={false} />
              <Tooltip content={<HeroChartTooltip />} cursor={{ stroke: "rgba(201,162,76,0.15)", strokeWidth: 1 }} />
              <Area
                type="monotone" dataKey="sessions"
                stroke="var(--atlas-gold)" strokeWidth={2}
                fill="url(#bfdHeroGold)"
                dot={{ r: 3, fill: "var(--atlas-gold)", strokeWidth: 0 }}
                activeDot={{ r: 5, fill: "var(--atlas-gold)" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </motion.div>
    </>
  );
}

export function BelowFoldDashboard({ projects, onOpenProject, onOpenLedger, onOpenParking, committedCount = 0, parkedCount, briefing, briefingLoading }: Props) {
  const mostRecentProjectId = projects.reduce<number | null>((latestId, project) => {
    if (latestId == null) return project.id;
    const latestProject = projects.find((p) => p.id === latestId);
    if (!latestProject) return project.id;
    return new Date(project.updatedAt).getTime() > new Date(latestProject.updatedAt).getTime()
      ? project.id
      : latestId;
  }, null);
  const projectState = useProjectState(mostRecentProjectId);

  if (projects.length === 0) return null;


  const recent = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);
  const actualCommitted = projectState.state ? projectState.decisions.length : committedCount;
  const actualParked = projectState.state ? projectState.parkedCount : parkedCount ?? projects.length;

  return (
    <div className="atlas-below-fold-dashboard" style={{ width: "100%", maxWidth: 560, padding: "0 0 120px", display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{`
        @keyframes briefingSlideDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bfd-spin { to { transform: rotate(360deg); } }
        @keyframes bfd-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
      `}</style>


      {/* Scroll hint / divider */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
          Your overview
        </span>
        <div style={{ flex: 1, height: 1, background: "var(--atlas-gold-border)" }} />
      </div>

      {/* 0. STAT TILES + SESSIONS CHART (was the dashboard hero) */}
      <RevealOnScroll delayMs={0} className="bfd-col-left">
        <StatsHero />
      </RevealOnScroll>

      {/* 1. WHERE WERE WE */}
      <RevealOnScroll delayMs={40} className="bfd-col-left">

        <div className="atlas-discovery-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
                Where were we
              </h3>
            </div>
            <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.4 }}>
              Last 30 days
            </span>
          </div>
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
      <RevealOnScroll delayMs={80} className="bfd-col-left">
        <ActivityHubCard onOpenProject={onOpenProject} />
      </RevealOnScroll>

      {/* 3. COGNITIVE MOMENTUM (parking) — right column, top */}
      <RevealOnScroll delayMs={120} className="bfd-col-right">
        <div className="atlas-discovery-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
              Cognitive Momentum
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

      {/* 4. CONNECTIONS DOCK — right column, bottom */}
      <RevealOnScroll delayMs={200} className="bfd-col-right">
        <ConnectionsDock />
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

// ============================================================================
// Connections Dock
// ============================================================================

type ConnType = "github" | "railway" | "lovable" | "cursor" | "custom";

type Connection = {
  id: string | number;
  type: ConnType;
  label?: string | null;
  url?: string | null;
  meta?: Record<string, any> | null;
};

type ConnStatus = {
  state?: "active" | "error" | "building" | "failed" | "linked" | "loading" | "success" | string;
  message?: string | null;
  timestamp?: string | null;
  // GitHub-specific
  lastCommitMessage?: string | null;
  lastCommitAt?: string | null;
  // Railway-specific
  lastDeployStatus?: string | null;
  lastDeployAt?: string | null;
};

const CONN_META: Record<string, { name: string; initials: string }> = {
  github:  { name: "GitHub",  initials: "GH" },
  railway: { name: "Railway", initials: "RW" },
  lovable: { name: "Lovable", initials: "LV" },
  cursor:  { name: "Cursor",  initials: "CU" },
  custom:  { name: "Custom",  initials: "URL" },
};


function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function dotForStatus(type: ConnType, st?: ConnStatus): { color: string; pulse: boolean; label: string } {
  if (!st || st.state === "loading") {
    return { color: "rgba(160,160,160,0.5)", pulse: false, label: "Loading…" };
  }
  if (type === "github") {
    if (st.state === "read-only") return { color: "rgba(201,162,76,0.85)", pulse: false, label: "Read-only (no personal token)" };
    if (st.state === "not-connected") return { color: "rgba(248,113,113,0.85)", pulse: false, label: "Not connected" };
    if (st.state === "connected") return { color: "rgba(74,222,128,0.7)", pulse: true, label: "GitHub connected" };
    if (st.state === "error" || st.state === "failed") return { color: "rgba(248,113,113,0.85)", pulse: false, label: st.message ?? "Error" };
    const msg = st.lastCommitMessage ? truncate(st.lastCommitMessage, 40) : "Active";
    const when = st.lastCommitAt ? formatRelative(st.lastCommitAt) : "";
    return { color: "rgba(74,222,128,0.7)", pulse: true, label: when ? `${msg} · ${when}` : msg };
  }
  if (type === "railway") {
    const s = (st.lastDeployStatus ?? st.state ?? "").toUpperCase();
    const when = st.lastDeployAt ? formatRelative(st.lastDeployAt) : "";
    if (s === "SUCCESS" || s === "ACTIVE") return { color: "rgba(74,222,128,0.7)", pulse: true, label: when ? `Live · ${when}` : "Live" };
    if (s === "BUILDING" || s === "DEPLOYING" || s === "QUEUED") return { color: "rgba(245,191,107,0.85)", pulse: true, label: when ? `Building · ${when}` : "Building" };
    if (s === "FAILED" || s === "CRASHED" || s === "ERROR") return { color: "rgba(248,113,113,0.85)", pulse: false, label: when ? `Failed · ${when}` : "Failed" };
    return { color: "rgba(160,160,160,0.5)", pulse: false, label: when || "—" };
  }
  if (type === "lovable") return { color: "rgba(168,85,247,0.55)", pulse: false, label: "Linked" };
  return { color: "rgba(96,165,250,0.55)", pulse: false, label: "Linked" }; // cursor
}

function ConnectionsDock() {
  const [, setLocation] = useLocation();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ConnStatus>>({});
  const [githubStatus, setGithubStatus] = useState<{
    connected: boolean;
    username?: string;
    error?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const goManage = () => setLocation("/connectors");

  const loadConnections = async (): Promise<Connection[]> => {
    try {
      const res = await fetch("/api/connections", { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const list: Connection[] = Array.isArray(data) ? data : (data.connections ?? []);
      setConnections(list);
      return list;
    } catch {
      setConnections([]);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const loadStatus = async (currentConnections = connections) => {
    try {
      const [connectionsResult, normalizedGithubStatus] = await Promise.all([
        fetch("/api/connections/status", { credentials: "include" }),
        fetchGitHubStatus().catch(() => null),
      ]);
      if (!connectionsResult.ok) return;
      const data = await connectionsResult.json();
      const raw: Record<string, any> = data.statuses ?? data ?? {};
      const map: Record<string, ConnStatus> = {};
      const connectionTypeById = new Map(currentConnections.map((connection) => [String(connection.id), connection.type]));
      for (const [id, s] of Object.entries(raw)) {
        if (!s || typeof s !== "object") continue;
        if (connectionTypeById.get(id) === "github" || s.type === "github") continue;
        map[id] = {
          state: s.status ?? s.state,
          message: s.message ?? s.lastCommit?.message ?? null,
          timestamp: s.timestamp ?? s.lastCommit?.timestamp ?? s.lastDeploy?.timestamp ?? null,
          lastCommitMessage: s.lastCommit?.message ?? s.lastCommitMessage ?? null,
          lastCommitAt: s.lastCommit?.timestamp ?? s.lastCommitAt ?? null,
          lastDeployStatus: s.lastDeploy?.status ?? s.lastDeployStatus ?? null,
          lastDeployAt: s.lastDeploy?.timestamp ?? s.lastDeployAt ?? null,
        };
      }
      if (normalizedGithubStatus) {
        for (const connection of currentConnections) {
          if (connection.type !== "github") continue;
          map[String(connection.id)] = {
            state: normalizedGithubStatus.status,
            message: normalizedGithubStatus.label,
          };
        }
      }
      setStatuses(map);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const githubConnected = params.get("github_connected");
    const githubUser = params.get("github_user");
    const githubError = params.get("github_error");

    if (githubConnected === "true") {
      setGithubStatus({ connected: true, username: githubUser ?? "GitHub" });
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (githubError) {
      setGithubStatus({ connected: false, error: githubError });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    fetchGitHubStatus()
      .then((status) => {
        const isConnected = status.canWrite || (status.canRead && status.hasServerToken);
        setGithubStatus((current) => current ?? {
          connected: isConnected,
          username: undefined,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void loadConnections().then((list) => loadStatus(list));
    const t = setInterval(loadStatus, 60_000);
    return () => clearInterval(t);
  }, []);

  const handleDelete = async (connection: Connection) => {
    setConnections((cs) => cs.filter((c) => c.id !== connection.id));
    try {
      await fetch(
        connection.type === "github" ? "/api/github/token" : `/api/connections/${connection.id}`,
        { method: "DELETE", credentials: "include" },
      );
      const nextConnections = await loadConnections();
      await loadStatus(nextConnections);
    } catch {}
  };

  // Add/manage flows live on /connectors now.

  const handleCardClick = (c: Connection) => {
    if ((c.type === "lovable" || c.type === "cursor") && c.url) {
      window.open(c.url, "_blank", "noopener");
    }
  };

  const visibleConnections = connections.filter((connection) => connection.type !== "github");

  return (
    <div className="atlas-discovery-card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: 9.5, fontWeight: 600, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.7 }}>
            Connections
          </h3>
          <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", opacity: 0.55, fontStyle: "italic" }}>
            Your active ecosystem
          </span>
        </div>
        <button
          type="button"
          onClick={goManage}
          aria-label="Manage connectors"
          style={{
            padding: "4px 10px", borderRadius: 6, cursor: "pointer",
            background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.25)",
            color: "var(--atlas-gold)", fontSize: 9.5, lineHeight: 1,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase",
          }}
        >
          Manage →
        </button>
      </div>

      <div style={{
        display: "flex", gap: 8, overflowX: "auto", padding: "2px 1px",
        border: "1px solid rgba(201,162,76,0.08)", borderRadius: 10,
        background: "rgba(255,255,255,0.015)",
        scrollbarWidth: "none",
      }}>
        {/* GitHub Connection */}
        <div style={{
          background: "color-mix(in oklab, var(--atlas-fg) 4%, transparent)",
          border: `1px solid ${githubStatus?.connected ? "rgba(74,222,128,0.30)" : "var(--atlas-border)"}`,
          borderRadius: 12,
          padding: "16px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* GitHub icon */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--atlas-fg)", opacity: 0.75, flexShrink: 0 }}>
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--atlas-fg)" }}>
                GitHub
              </div>
              <div style={{ fontSize: 12, color: "var(--atlas-muted)", marginTop: 2 }}>
                {githubStatus?.connected
                  ? `Connected${githubStatus.username ? ` · @${githubStatus.username}` : ""}`
                  : githubStatus?.error
                    ? "Connection failed — try again"
                    : "Not connected"}
              </div>
            </div>
          </div>

          {githubStatus?.connected ? (
            <button
              onClick={async () => {
                await fetch("/api/github/token", { method: "DELETE", credentials: "include" });
                setGithubStatus({ connected: false });
              }}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 8,
                color: "rgba(255,255,255,0.4)",
                fontSize: 12,
                padding: "5px 12px",
                cursor: "pointer",
              }}
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={async () => {
                try {
                  const { stashOauthReturn } = await import("@/lib/oauthReturn");
                  stashOauthReturn();
                  const res = await fetch("/api/github/oauth/start", {
                    method: "GET",
                    credentials: "include",
                    headers: { Accept: "application/json" },
                  });
                  if (res.status === 401) {
                    // Not logged in — send to login
                    window.location.href = "/login?reason=session_expired";
                    return;
                  }
                  const data = await res.json();
                  if (data.url) {
                    window.location.href = data.url;
                  } else {
                    alert("Failed to start GitHub connection");
                  }
                } catch (err) {
                  alert("Network error. Try again.");
                }
              }}
              style={{
                display: "block",
                padding: "8px 14px",
                borderRadius: 6,
                background: "rgba(201,162,76,0.12)",
                color: "#C9A24C",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                border: "none",
                fontFamily: "var(--app-font-mono)",
              }}
            >
              Connect via GitHub →
            </button>
          )}
        </div>
          {visibleConnections.map((c) => {
            const st = statuses[String(c.id)];
            const d = dotForStatus(c.type, loading ? { state: "loading" } : st);
            const meta = CONN_META[c.type] ?? { name: c.type, initials: c.type.slice(0, 2).toUpperCase() };
            const clickable = (c.type === "lovable" || c.type === "cursor") && !!c.url;
            return (
              <div key={c.id} style={{
                position: "relative",
                flex: "1 1 0", minWidth: 130,
                display: "flex", alignItems: "center", gap: 8,
                padding: "8px 10px", borderRadius: 8,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.05)",
                backdropFilter: "blur(8px)",
                cursor: clickable ? "pointer" : "default",
              }}
                onClick={clickable ? () => handleCardClick(c) : undefined}
              >
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.1)",
                  fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.7)",
                  letterSpacing: "0.04em",
                }}>
                  {meta.initials}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 11, color: "var(--atlas-fg)", opacity: 0.85, fontFamily: "var(--app-font-sans)", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {meta.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%", background: d.color, flexShrink: 0,
                      animation: d.pulse ? "bfd-pulse 1.8s ease-in-out infinite" : undefined,
                    }} />
                    <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.7, letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.label}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDelete(c); }}
                  aria-label={`Remove ${meta.name}`}
                  style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                    background: "transparent", border: "none", color: "var(--atlas-muted)",
                    opacity: 0.4, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.color = "rgba(248,113,113,0.9)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.4"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
                >
                  ×
                </button>
              </div>
            );
          })}
      </div>

      
    </div>
  );
}

function AddConnectionModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<ConnType>("custom");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setError(null);
    try {
      const body: Record<string, any> = { type };
      const trimmed = value.trim();
      if (type === "railway") {
        body.token = trimmed;
        if (label.trim()) body.label = label.trim();
      } else {
        // github, lovable, cursor, custom — all take a URL
        body.url = trimmed;
        if (label.trim()) body.label = label.trim();
      }
      // Backend requires label (min 1 char). Default sensibly when blank.
      if (!body.label) {
        if (type === "github") {
          const repoName = trimmed.replace(/\.git$/, "").split("/").filter(Boolean).pop();
          body.label = repoName || "GitHub";
        } else {
          body.label = type.charAt(0).toUpperCase() + type.slice(1);
        }
      }
      const res = await fetch("/api/connections", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = "";
        try { const j = await res.json(); detail = j?.error || j?.message || ""; } catch {}
        throw new Error(detail ? `${detail} (${res.status})` : `Save failed (${res.status})`);
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
      setSaving(false);
    }
  };

  const canSave = value.trim().length > 0 && !saving;

  const placeholderFor: Record<ConnType, string> = {
    custom:  "https://example.com",
    github:  "https://github.com/user/repo",
    railway: "Paste your Railway API token",
    lovable: "https://lovable.dev/projects/...",
    cursor:  "https://github.com/user/repo",
  };

  const hintFor: Record<ConnType, string> = {
    custom:  "Any URL — dashboard, docs, deploy log.",
    github:  "Paste the repo URL you want to track.",
    railway: "Token from railway.com/account/tokens.",
    lovable: "Your Lovable project URL.",
    cursor:  "A repository URL Cursor is editing.",
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 99999,
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      overflowY: "auto",
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: "100%", maxWidth: 380, borderRadius: 12,
        background: "var(--atlas-surface)", border: "1px solid var(--atlas-gold-border)",
        padding: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        maxHeight: "calc(100vh - 32px)", overflowY: "auto",
        margin: "auto",
      }}>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-fg)" }}>
            Add connection
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" style={{
            background: "transparent", border: "none", color: "var(--atlas-muted)",
            fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1,
          }}>×</button>
        </div>

        {/* Primary: label + URL */}
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional) — e.g. Production API"
          style={inputStyle}
        />
        <div style={{ height: 8 }} />
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholderFor[type]}
          style={inputStyle}
        />
        <p style={{ margin: "6px 2px 0", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.6, fontFamily: "var(--app-font-mono)" }}>
          {hintFor[type]}
        </p>

        {/* Quick-add type chips — optional */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {(["custom", "github", "railway", "lovable", "cursor"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setType(t)} style={{
              padding: "5px 10px", borderRadius: 14, cursor: "pointer",
              background: type === t ? "rgba(201,162,76,0.15)" : "transparent",
              border: `1px solid ${type === t ? "rgba(201,162,76,0.5)" : "rgba(201,162,76,0.15)"}`,
              color: type === t ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 10, fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.06em", textTransform: "uppercase",
            }}>
              {CONN_META[t].name}
            </button>
          ))}
        </div>

        {error && (
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "rgba(248,113,113,0.9)", fontFamily: "var(--app-font-mono)" }}>{error}</p>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} style={btnGhostStyle}>
            Cancel
          </button>
          <button type="button" disabled={!canSave} onClick={save} style={{
            ...btnPrimaryStyle, opacity: canSave ? 1 : 0.4, cursor: canSave ? "pointer" : "not-allowed",
          }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}


const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", borderRadius: 7,
  background: "rgba(0,0,0,0.3)", border: "1px solid var(--atlas-border)",
  color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-mono)",
  outline: "none",
};

const btnGhostStyle: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 7, cursor: "pointer",
  background: "transparent", border: "1px solid var(--atlas-border)",
  color: "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)",
  letterSpacing: "0.06em", textTransform: "uppercase",
};

const btnPrimaryStyle: React.CSSProperties = {
  padding: "7px 14px", borderRadius: 7,
  background: "rgba(201,162,76,0.18)", border: "1px solid rgba(201,162,76,0.5)",
  color: "var(--atlas-gold)", fontSize: 11, fontFamily: "var(--app-font-mono)",
  letterSpacing: "0.06em", textTransform: "uppercase",
};
