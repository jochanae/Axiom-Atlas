import { useState, useMemo, useEffect } from "react";
import { useLocation } from "wouter";
import { useListProjects, listEntries } from "@workspace/api-client-react";
import type { Entry, Project } from "@workspace/api-client-react";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { FooterAuditLine } from "../components/FooterAuditLine";
import { relativeTime } from "../lib/atlas-utils";

export default function GuardReport() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading: projectsLoading } = useListProjects();
  const [allEntries, setAllEntries] = useState<Entry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  useEffect(() => {
    if (projects.length === 0 || projectsLoading) return;
    setEntriesLoading(true);
    Promise.all(projects.map((p: Project) => listEntries(p.id, {}).catch(() => [] as Entry[])))
      .then((results) => setAllEntries(results.flat()))
      .finally(() => setEntriesLoading(false));
  }, [projects, projectsLoading]);

  const loading = projectsLoading || entriesLoading;

  const stats = useMemo(() => {
    const total = allEntries.length;
    const committed = allEntries.filter((e) => e.status === "committed").length;
    const violations = allEntries.filter((e) => e.isViolation).length;
    const blockers = allEntries.filter((e) => e.severity === "blocker").length;
    const healthRate = total > 0 ? Math.round(((total - violations) / total) * 100) : 100;

    const byMode: Record<string, number> = {};
    for (const e of allEntries) {
      const m = (e.mode ?? "think").toUpperCase();
      byMode[m] = (byMode[m] ?? 0) + 1;
    }

    const byVerb: Record<string, { count: number; violations: number }> = {};
    for (const e of allEntries) {
      const v = e.verb ?? "note";
      if (!byVerb[v]) byVerb[v] = { count: 0, violations: 0 };
      byVerb[v].count++;
      if (e.isViolation) byVerb[v].violations++;
    }

    const recentViolations = allEntries.filter((e) => e.isViolation).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 20);

    return { total, committed, violations, blockers, healthRate, byMode, byVerb, recentViolations };
  }, [allEntries]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)", color: "var(--foreground)", paddingBottom: 80, overflowY: "auto" }}>
      <FooterAuditLine />

      {/* Header */}
      <header style={{ padding: "14px 18px 12px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, zIndex: 20, background: "var(--background)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <button
            type="button"
            onClick={() => setLocation("/home")}
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--muted-text)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            ← Workspace
          </button>
          <button
            type="button"
            onClick={() => setLocation(-1 as unknown as string)}
            style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--accent-gold)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
          >
            Ledger →
          </button>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>Guard Report</h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-text)", margin: "4px 0 0", letterSpacing: "0.06em" }}>
          System health · Decision validation metrics
        </p>
      </header>

      {loading ? (
        <div style={{ padding: 80, display: "flex", justifyContent: "center" }}>
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <main style={{ padding: "16px 18px" }}>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
            <StatCard label="Total Entries" value={stats.total} />
            <StatCard label="System Health" value={`${stats.healthRate}%`} accent={stats.healthRate >= 95 ? "var(--phosphor)" : stats.healthRate >= 80 ? "var(--accent-gold)" : "var(--ember)"} />
            <StatCard label="Committed" value={stats.committed} accent="var(--phosphor)" />
            <StatCard label="Violations" value={stats.violations} accent={stats.violations > 0 ? "var(--ember)" : "var(--muted-text)"} />
          </div>

          {/* Intent / Mode distribution */}
          <section style={{ marginBottom: 24 }}>
            <SectionHeader>Mode Distribution</SectionHeader>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {Object.entries(stats.byMode).sort((a, b) => b[1] - a[1]).map(([mode, count]) => {
                const color = mode === "BUILD" ? "#60a5fa" : mode === "DECIDE" ? "#fbbf24" : mode === "THINK" ? "#a78bfa" : mode === "PLAN" ? "#34d399" : mode === "EXPLORE" ? "var(--phosphor)" : "var(--muted-text)";
                return (
                  <div key={mode} style={{ padding: "6px 12px", borderRadius: 8, background: `color-mix(in oklab, ${color} 10%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 25%, transparent)`, fontFamily: "var(--font-mono)", fontSize: 10 }}>
                    <span style={{ color, fontWeight: 600 }}>{mode}</span>
                    <span style={{ color: "var(--muted-text)", marginLeft: 6 }}>{count}</span>
                  </div>
                );
              })}
              {Object.keys(stats.byMode).length === 0 && (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-text)" }}>No entries yet.</p>
              )}
            </div>
          </section>

          {/* Verb breakdown */}
          {Object.keys(stats.byVerb).length > 0 && (
            <section style={{ marginBottom: 24 }}>
              <SectionHeader>Entries by Verb</SectionHeader>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {Object.entries(stats.byVerb).sort((a, b) => b[1].count - a[1].count).map(([verb, { count, violations }]) => (
                  <div key={verb} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--border)" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--foreground)", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{verb}</span>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent-gold)" }}>{count} entries</span>
                      {violations > 0 && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ember)" }}>{violations} violations</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent violations */}
          {stats.recentViolations.length > 0 && (
            <section>
              <SectionHeader>Recent Violations</SectionHeader>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {stats.recentViolations.map((e) => (
                  <div key={e.id} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--atlas-surface)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(146,64,14,0.12)", color: "var(--ember)", border: "1px solid rgba(146,64,14,0.2)" }}>
                          ⚠ violation
                        </span>
                        {e.verb && (
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--accent-gold)", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{e.verb}</span>
                        )}
                      </div>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-text)" }}>{relativeTime(e.createdAt)}</span>
                    </div>
                    <p style={{ fontSize: 12, lineHeight: 1.5, color: "color-mix(in oklab, var(--foreground) 70%, transparent)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                      {e.title}
                    </p>
                    {e.summary && (
                      <p style={{ fontSize: 11, lineHeight: 1.5, color: "var(--muted-text)", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                        {e.summary}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {stats.violations === 0 && stats.total > 0 && (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--phosphor)" }}>
                No violations recorded. System operating at full integrity.
              </p>
            </div>
          )}

          {stats.total === 0 && (
            <div style={{ padding: "60px 24px", textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 4, border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
                <div style={{ width: 8, height: 8, background: "var(--phosphor)", borderRadius: "50%" }} />
              </div>
              <p style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-text)" }}>
                No data yet — commit some decisions to see the guard report.
              </p>
            </div>
          )}
        </main>
      )}
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div style={{ padding: "14px", borderRadius: 10, background: "var(--atlas-surface)", border: "1px solid var(--border)", backdropFilter: "blur(12px)" }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "var(--muted-text)", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: accent ?? "var(--foreground)", letterSpacing: "-0.02em" }}>{value}</div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--accent-gold)", fontWeight: 600, margin: "0 0 10px" }}>
      {children}
    </h2>
  );
}
