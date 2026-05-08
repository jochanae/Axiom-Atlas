import { useLocation } from "wouter";
import { useListProjects, useListEntries } from "@workspace/api-client-react";
import { LoadingSpinner } from "../components/ui/loading-spinner";

export default function ProjectCompass() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading } = useListProjects();

  return (
    <div style={{ minHeight: "100dvh", background: "var(--atlas-bg)", color: "var(--atlas-fg)", display: "flex", flexDirection: "column", paddingBottom: 80 }}>

      {/* Header */}
      <header style={{
        position: "sticky", top: 0, zIndex: 20,
        background: "var(--atlas-bg)", borderBottom: "1px solid var(--atlas-border)",
        backdropFilter: "blur(12px)", flexShrink: 0,
      }}>
        <div style={{ padding: "10px 16px 10px", display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setLocation("/home")}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", background: "transparent", border: "none", padding: 0, cursor: "pointer", opacity: 0.7 }}
          >
            ← Home
          </button>
        </div>
        <div style={{ padding: "0 16px 14px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>Project Compass</h1>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>
            Decision health across all your projects
          </p>
        </div>
      </header>

      {isLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingSpinner size="lg" color="atlas" />
        </div>
      ) : projects.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 32px", gap: 14, textAlign: "center" }}>
          <span style={{ color: "var(--atlas-muted)", opacity: 0.3 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
            </svg>
          </span>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>No projects yet</div>
          <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.6, maxWidth: 280, opacity: 0.7 }}>
            Create a project and start making decisions. The compass shows you how each project is tracking.
          </div>
          <button
            type="button"
            onClick={() => setLocation("/home")}
            style={{
              marginTop: 8, padding: "9px 20px", borderRadius: 8,
              background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
              border: "1px solid rgba(201,162,76,0.3)",
              color: "var(--atlas-gold)", fontSize: 11.5,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
              cursor: "pointer",
            }}
          >
            Start a project
          </button>
        </div>
      ) : (
        <main style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Coming soon banner */}
          <div style={{
            padding: "12px 14px", borderRadius: 8,
            background: "color-mix(in oklab, var(--atlas-gold) 6%, transparent)",
            border: "1px solid rgba(201,162,76,0.18)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7 }}>
              <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-gold)", opacity: 0.75, letterSpacing: "0.05em" }}>
              Full compass view coming soon — project health scoring, momentum tracking, and drift detection.
            </span>
          </div>

          {/* Project cards — basic summary */}
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => setLocation(`/project/${p.id}`)} />
          ))}
        </main>
      )}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: { id: number; name: string; description?: string | null }; onOpen: () => void }) {
  const { data: entries = [] } = useListEntries(project.id, {});
  const committed = entries.filter((e) => e.status === "committed").length;
  const violations = entries.filter((e) => e.isViolation).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "14px 16px", borderRadius: 10,
        background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
        textAlign: "left", cursor: "pointer", width: "100%",
        transition: "border-color 140ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.3)")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
    >
      {/* Initial avatar */}
      <div style={{
        width: 36, height: 36, borderRadius: 9, flexShrink: 0,
        background: `hsl(${(project.name.charCodeAt(0) * 37) % 360}, 22%, 22%)`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 700, color: "var(--atlas-fg)",
        fontFamily: "var(--app-font-mono)",
      }}>
        {project.name[0]?.toUpperCase()}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {project.name}
        </div>
        {project.description && (
          <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", marginTop: 2, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {project.description}
          </div>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 14, fontWeight: 600, color: "var(--atlas-gold)" }}>{committed}</div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.08em" }}>committed</div>
        </div>
        {violations > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 14, fontWeight: 600, color: "var(--atlas-ember)" }}>{violations}</div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.08em" }}>violations</div>
          </div>
        )}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: "var(--atlas-muted)", opacity: 0.4 }}>
          <path d="M2 6h8M6 2l4 4-4 4" />
        </svg>
      </div>
    </button>
  );
}
