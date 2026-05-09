import { useLocation } from "wouter";
import { useListProjects, useListSessions } from "@workspace/api-client-react";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { relativeTime } from "../lib/atlas-utils";

export default function Sessions() {
  const [, setLocation] = useLocation();
  const { data: projects = [], isLoading: projectsLoading } = useListProjects();

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
          <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--atlas-fg)" }}>Sessions</h1>
          <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", margin: "4px 0 0", letterSpacing: "0.06em", opacity: 0.6 }}>
            All conversations across projects
          </p>
        </div>
      </header>

      {projectsLoading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <LoadingSpinner size="lg" color="atlas" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
            </svg>
          }
          title="No sessions yet"
          body="Start a conversation in any project — your sessions will appear here."
          action={{ label: "Open a project", onClick: () => setLocation("/home") }}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {projects.map((project) => (
            <ProjectSessionGroup key={project.id} project={project} onOpen={(id) => setLocation(`/project/${id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectSessionGroup({ project, onOpen }: { project: { id: number; name: string }; onOpen: (id: number) => void }) {
  const { data: sessions = [], isLoading } = useListSessions(project.id);

  if (isLoading || sessions.length === 0) return null;

  return (
    <div style={{ borderBottom: "1px solid var(--atlas-border)" }}>
      <div style={{ padding: "10px 16px 6px", fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.7 }}>
        {project.name}
      </div>
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onOpen(project.id)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", padding: "10px 16px", border: "none",
            background: "transparent", textAlign: "left", cursor: "pointer",
            transition: "background 120ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-fg) 4%, transparent)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: "var(--atlas-phosphor)",
              boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-phosphor) 55%, transparent)",
              display: "inline-block",
            }} />
            <span style={{ fontSize: 13, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)" }}>
              {s.title || `Session ${s.id}`}
            </span>
          </div>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.06em", flexShrink: 0 }}>
            {relativeTime(s.createdAt)}
          </span>
        </button>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, body, action }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 32px", gap: 14, textAlign: "center" }}>
      <span style={{ color: "var(--atlas-muted)", opacity: 0.3 }}>{icon}</span>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--atlas-fg)", letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontSize: 12.5, color: "var(--atlas-muted)", lineHeight: 1.6, maxWidth: 280, opacity: 0.7 }}>{body}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            marginTop: 8, padding: "9px 20px", borderRadius: 8,
            background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
            border: "1px solid rgba(201,162,76,0.3)",
            color: "var(--atlas-gold)", fontSize: 11.5,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
            cursor: "pointer",
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
