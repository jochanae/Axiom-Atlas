import { useState, useEffect, useCallback, useRef } from "react";
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
import { StatCard } from "@/components/stat-card";
import { LoadingSpinner } from "@/components/ui/loading-spinner";

interface DashboardStats {
  sessionsThisWeek: number;
  totalDecisions: number;
  parkedDecisions: number;
  violations: number;
  activeProjects: number;
  dailySessions: { day: string; sessions: number }[];
  recentSessions: {
    id: number;
    title: string;
    createdAt: string;
    mode: string | null;
    projectId: number;
    projectName: string;
  }[];
  projectHealth: {
    id: number;
    name: string;
    description: string | null;
    committed: number;
    parked: number;
    violations: number;
    totalEntries: number;
    healthRate: number;
    lastSession: string | null;
  }[];
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ChartTooltip({ active, payload, label }: any) {
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

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSpinner, setShowSpinner] = useState(true);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setShowSpinner(true);
    if (spinnerTimer.current) clearTimeout(spinnerTimer.current);
    setError(null);
    try {
      const res = await fetch("/api/stats/dashboard", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      setStats(await res.json());
    } catch {
      setError("Could not load stats.");
    } finally {
      setLoading(false);
      spinnerTimer.current = setTimeout(() => setShowSpinner(false), 800);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div style={{
      height: "100dvh", overflowY: "auto",
      background: "transparent", color: "var(--atlas-fg)",
      fontFamily: "var(--app-font-sans)", paddingBottom: 60,
    }}>
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px",
          borderBottom: "1px solid var(--atlas-border)",
          position: "sticky", top: 0,
          background: "var(--atlas-bg)", backdropFilter: "blur(16px)",
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={() => setLocation("/home")}
            style={{
              background: "transparent", border: "1px solid var(--atlas-border)",
              borderRadius: 8, color: "var(--atlas-muted)",
              cursor: "pointer", padding: "6px 12px",
              fontSize: 12, fontFamily: "inherit", transition: "all 160ms",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; e.currentTarget.style.color = "var(--atlas-gold)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
          >
            ← Home
          </button>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--atlas-fg)" }}>
              Dashboard
            </div>
            <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 1, opacity: 0.55, letterSpacing: "0.08em" }}>
              7-DAY ACTIVITY OVERVIEW
            </div>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
            border: "1px solid rgba(201,162,76,0.25)",
            borderRadius: 8, color: "var(--atlas-gold)",
            cursor: loading ? "not-allowed" : "pointer",
            padding: "7px 16px", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
            opacity: loading ? 0.5 : 1, transition: "all 160ms",
          }}
          onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 14%, transparent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 8%, transparent)"; }}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </motion.header>

      {/* Body */}
      {showSpinner && !stats ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}>
          <LoadingSpinner size="lg" color="atlas" />
        </div>
      ) : error ? (
        <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 12 }}>
          {error}{" "}
          <button onClick={load} style={{ color: "var(--atlas-gold)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            Retry
          </button>
        </div>
      ) : stats ? (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 18px 0" }}>

          {/* ── Stat cards ───────────────────────────────────────────────── */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14, marginBottom: 24,
          }}>
            <StatCard index={0} label="Sessions This Week" value={stats.sessionsThisWeek} sub="thinking sessions" accent="var(--atlas-gold)" />
            <StatCard index={1} label="Committed Decisions" value={stats.totalDecisions} sub="in the ledger" accent="#6EE7B7" />
            <StatCard index={2} label="Active Projects" value={stats.activeProjects} sub="sessions this week" accent="#818CF8" />
            <StatCard
              index={3}
              label="Violations"
              value={stats.violations}
              sub={stats.violations === 0 ? "clean ledger" : "decisions broken"}
              accent={stats.violations > 0 ? "var(--atlas-ember)" : "#6EE7B7"}
            />
          </div>

          {/* ── Sessions chart ───────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.18 }}
            style={{
              background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
              borderRadius: 16, padding: "22px 18px 14px", marginBottom: 18,
            }}
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
                    <linearGradient id="dashGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C9A24C" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#C9A24C" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 6" stroke="var(--atlas-border)" vertical={false} />
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)" }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)" }}
                    axisLine={false} tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(201,162,76,0.15)", strokeWidth: 1 }} />
                  <Area
                    type="monotone" dataKey="sessions"
                    stroke="var(--atlas-gold)" strokeWidth={2}
                    fill="url(#dashGold)"
                    dot={{ r: 3, fill: "var(--atlas-gold)", strokeWidth: 0 }}
                    activeDot={{ r: 5, fill: "var(--atlas-gold)" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </motion.div>

          {/* ── Two columns: Recent Sessions + Project Health ─────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>

            {/* Recent Sessions */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.28 }}
              style={{
                background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
                borderRadius: 16, padding: "18px 16px",
              }}
            >
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>Recent Sessions</div>
                <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 2, letterSpacing: "0.06em", opacity: 0.55 }}>
                  ACROSS ALL PROJECTS
                </div>
              </div>
              {stats.recentSessions.length === 0 ? (
                <div style={{ color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 11, opacity: 0.4, padding: "20px 0", textAlign: "center" }}>
                  No sessions yet
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {stats.recentSessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setLocation(`/project/${s.projectId}`)}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 9,
                        padding: "8px 8px", borderRadius: 8,
                        background: "transparent", border: "none",
                        cursor: "pointer", textAlign: "left",
                        transition: "background 120ms ease",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.05)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: "var(--atlas-gold)", flexShrink: 0,
                        marginTop: 6, opacity: 0.55,
                      }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: "var(--atlas-fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.title || "Untitled session"}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 1, fontFamily: "var(--app-font-mono)", letterSpacing: "0.03em" }}>
                          {s.projectName}
                        </div>
                      </div>
                      <span style={{ fontSize: 9, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.4, flexShrink: 0, letterSpacing: "0.03em", marginTop: 2 }}>
                        {relTime(s.createdAt)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Project Health */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.36 }}
              style={{
                background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
                borderRadius: 16, padding: "18px 16px",
              }}
            >
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>Project Health</div>
                <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 2, letterSpacing: "0.06em", opacity: 0.55 }}>
                  DECISION INTEGRITY
                </div>
              </div>
              {stats.projectHealth.length === 0 ? (
                <div style={{ color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 11, opacity: 0.4, padding: "20px 0", textAlign: "center" }}>
                  No projects yet
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {stats.projectHealth.slice(0, 5).map((p) => {
                    const healthy = p.healthRate >= 90;
                    const warn = p.healthRate >= 70 && p.healthRate < 90;
                    const hColor = healthy ? "#6EE7B7" : warn ? "var(--atlas-gold)" : "var(--atlas-ember)";
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setLocation(`/project/${p.id}`)}
                        style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "7px 8px", borderRadius: 8,
                          background: "transparent", border: "none",
                          cursor: "pointer", textAlign: "left",
                          transition: "background 120ms ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.05)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{
                          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                          background: `hsl(${(p.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 700, color: "var(--atlas-fg)",
                          fontFamily: "var(--app-font-mono)",
                        }}>
                          {p.name[0]?.toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: "var(--atlas-fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 1, fontFamily: "var(--app-font-mono)" }}>
                            {p.committed} committed{p.violations > 0 ? ` · ${p.violations} violations` : " · clean"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: hColor, fontFamily: "var(--app-font-mono)", lineHeight: 1 }}>
                            {p.healthRate}%
                          </div>
                          <div style={{ fontSize: 8, color: hColor, opacity: 0.65, letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 2 }}>
                            health
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {stats.projectHealth.length > 5 && (
                    <button
                      type="button"
                      onClick={() => setLocation("/compass")}
                      style={{
                        background: "transparent", border: "none",
                        color: "var(--atlas-gold)", fontSize: 10,
                        fontFamily: "var(--app-font-mono)", cursor: "pointer",
                        letterSpacing: "0.06em", opacity: 0.65, padding: "4px 8px",
                        textAlign: "left", marginTop: 4,
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}
                    >
                      View all in Compass →
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          </div>

          {/* ── Parked decisions callout ─────────────────────────────────── */}
          {stats.parkedDecisions > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.44 }}
              style={{
                background: "color-mix(in oklab, var(--atlas-gold) 4%, var(--atlas-surface))",
                border: "1px solid rgba(201,162,76,0.14)",
                borderRadius: 12, padding: "14px 18px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 22, fontWeight: 200, color: "var(--atlas-gold)", fontFamily: "var(--app-font-sans)", lineHeight: 1 }}>
                  {stats.parkedDecisions}
                </span>
                <span style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.65 }}>
                  ideas parked · waiting for their moment
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLocation("/parking")}
                style={{
                  background: "transparent", border: "1px solid rgba(201,162,76,0.22)",
                  borderRadius: 7, color: "var(--atlas-gold)", cursor: "pointer",
                  padding: "6px 14px", fontSize: 10,
                  fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
                  transition: "all 140ms",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.08)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Review →
              </button>
            </motion.div>
          )}
        </div>
      ) : null}
    </div>
  );
}
