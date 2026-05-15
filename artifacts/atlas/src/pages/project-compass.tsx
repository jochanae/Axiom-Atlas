import { useLocation } from "wouter";
import { useListProjects, useListEntries } from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { LoadingSpinner } from "../components/ui/loading-spinner";

export default function ProjectCompass() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading } = useListProjects();

  return (
    <div style={{
      height: "100dvh", overflowY: "auto",
      background: "transparent", color: "var(--atlas-fg)",
      display: "flex", flexDirection: "column", paddingBottom: 80,
    }}>
      {/* Header */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "var(--atlas-bg)", borderBottom: "1px solid var(--atlas-border)",
        backdropFilter: "blur(12px)", flexShrink: 0,
      }}>
        <div style={{ padding: "10px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={() => setLocation("/home")}
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "var(--atlas-muted)",
              background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7,
            }}
          >
            ← Home
          </button>
          <span style={{ color: "var(--atlas-border)", fontSize: 12, opacity: 0.5 }}>·</span>
          <button type="button" onClick={() => setLocation("/dashboard")}
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em",
              textTransform: "uppercase", color: "var(--atlas-gold)",
              background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7,
            }}
          >
            Dashboard →
          </button>
        </div>
        <div style={{ padding: "0 16px 14px", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>
              Project Compass
            </h1>
            <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>
              Decision health across all projects
            </p>
          </div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-gold)", opacity: 0.55, letterSpacing: "0.08em" }}>
            {projects.length} PROJECT{projects.length !== 1 ? "S" : ""}
          </div>
        </div>
      </header>

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingSpinner size="lg" color="atlas" />
        </div>
      ) : projects.length === 0 ? (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          padding: "60px 32px", gap: 14, textAlign: "center",
        }}>
          <span style={{ color: "var(--atlas-muted)", opacity: 0.3 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
          </span>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>No projects yet</div>
          <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.6, maxWidth: 280, opacity: 0.7 }}>
            Create a project and start making decisions. Compass shows you how each one is tracking.
          </div>
          <button type="button" onClick={() => setLocation("/home")}
            style={{
              marginTop: 8, padding: "9px 20px", borderRadius: 8,
              background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
              border: "1px solid rgba(201,162,76,0.3)",
              color: "var(--atlas-gold)", fontSize: 11.5,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: "pointer",
            }}
          >
            Start a project
          </button>
        </div>
      ) : (
        <main style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {projects.map((p) => (
            <ProjectHealthCard
              key={p.id}
              project={p}
              onOpen={() => setLocation(`/project/${p.id}`)}
              onLedger={() => setLocation(`/ledger/${p.id}`)}
            />
          ))}
        </main>
      )}
    </div>
  );
}

function ProjectHealthCard({
  project,
  onOpen,
  onLedger,
}: {
  project: { id: number; name: string; description?: string | null };
  onOpen: () => void;
  onLedger: () => void;
}) {
  const { data: entries = [], isLoading } = useListEntries(project.id, {});

  const committed = entries.filter((e: Entry) => e.status === "committed").length;
  const parked = entries.filter((e: Entry) => e.status === "parked").length;
  const violations = entries.filter((e: Entry) => e.isViolation).length;
  const total = entries.length;
  const healthRate = total > 0 ? Math.round(((total - violations) / total) * 100) : 100;

  const healthy = healthRate >= 90;
  const warn = healthRate >= 70 && healthRate < 90;
  const hColor = healthy ? "#6EE7B7" : warn ? "var(--atlas-gold)" : "var(--atlas-ember)";
  const hLabel = healthy ? "Healthy" : warn ? "Monitor" : "At Risk";

  const byMode: Record<string, number> = {};
  for (const e of entries) {
    const m = ((e.mode as string | null) ?? "THINK").toUpperCase();
    byMode[m] = (byMode[m] ?? 0) + 1;
  }
  const topModes = Object.entries(byMode).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div
      style={{
        background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
        borderRadius: 12, overflow: "hidden",
        transition: "border-color 140ms ease",
      }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,76,0.25)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)")}
    >
      {/* Main click row */}
      <button
        type="button"
        onClick={onOpen}
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "14px 16px", width: "100%",
          background: "transparent", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: `hsl(${(project.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)",
        }}>
          {project.name[0]?.toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.name}
          </div>
          {project.description && (
            <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", marginTop: 2, opacity: 0.6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project.description}
            </div>
          )}
        </div>
        {isLoading ? (
          <LoadingSpinner size="sm" color="atlas" />
        ) : (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: hColor, fontFamily: "var(--app-font-mono)", lineHeight: 1 }}>
              {healthRate}%
            </div>
            <div style={{ fontSize: 8.5, color: hColor, opacity: 0.7, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
              {hLabel}
            </div>
          </div>
        )}
      </button>

      {/* Stats row — only shown when there are entries */}
      {!isLoading && total > 0 && (
        <div style={{
          display: "flex", alignItems: "center",
          padding: "10px 16px", borderTop: "1px solid var(--atlas-border)", gap: 0,
        }}>
          <HealthStat value={committed} label="committed" color="var(--atlas-gold)" />
          <HealthDivider />
          <HealthStat value={parked} label="parked" color="var(--atlas-muted)" />
          {violations > 0 && (
            <>
              <HealthDivider />
              <HealthStat value={violations} label="overrides" color="var(--atlas-ember)" />
            </>
          )}
          {topModes.length > 0 && (
            <>
              <div style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 4 }}>
                {topModes.map(([mode, count]) => (
                  <div key={mode} style={{
                    padding: "3px 7px", borderRadius: 5,
                    background: "var(--atlas-surface-alt)",
                    fontFamily: "var(--app-font-mono)", fontSize: 9,
                    color: "var(--atlas-muted)", letterSpacing: "0.05em",
                  }}>
                    {mode} {count}
                  </div>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onLedger(); }}
            style={{
              marginLeft: 12, background: "transparent", border: "none",
              color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", fontSize: 9,
              cursor: "pointer", letterSpacing: "0.08em", opacity: 0.65, padding: "4px 6px",
              transition: "opacity 120ms",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.65")}
          >
            LEDGER →
          </button>
        </div>
      )}

      {/* Empty state inline */}
      {!isLoading && total === 0 && (
        <div style={{
          padding: "8px 16px 12px",
          borderTop: "1px solid var(--atlas-border)",
          fontFamily: "var(--app-font-mono)", fontSize: 10,
          color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.04em",
        }}>
          No decisions committed yet
        </div>
      )}
    </div>
  );
}

function HealthStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div style={{ paddingRight: 16, minWidth: 52 }}>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 15, fontWeight: 600, color, lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function HealthDivider() {
  return <div style={{ width: 1, height: 26, background: "var(--atlas-border)", marginRight: 16, flexShrink: 0 }} />;
}
