import { useState } from "react";
import { Link, useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { useListProjects, useCreateProject, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { extractApiErrorMessage } from "../lib/atlas-utils";

const sMono = { fontFamily: "'IBM Plex Mono', var(--app-font-mono)" } as const;
const sSans = { fontFamily: "var(--app-font-sans)" } as const;

export default function Projects() {
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [createError, setCreateError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const handleNew = () => {
    setCreateError(null);
    createProject.mutate(
      { data: { name: "New Project" } },
      {
        onSuccess: (created) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          if (created?.id) setLocation(`/project/${created.id}`);
        },
        onError: (err) => {
          setCreateError(extractApiErrorMessage(err));
        },
      }
    );
  };

  return (
    <div style={{
      minHeight: "100svh",
      background: "var(--atlas-bg)",
      color: "var(--atlas-fg)",
      display: "flex",
      flexDirection: "column",
      overflowY: "auto",
      ...sSans,
    }}>

      {/* ── Header ── */}
      <header style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px 20px",
        borderBottom: "1px solid var(--atlas-border)",
        flexShrink: 0,
        position: "sticky",
        top: 0,
        background: "var(--atlas-bg)",
        zIndex: 20,
      }}>
        <Link href="/home" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}>
          <img src="/axiom-logo.svg" alt="Axiom" width={24} height={24} style={{ borderRadius: "20%", flexShrink: 0 }} />
          <span style={{ ...sMono, fontSize: 11, fontWeight: 700, letterSpacing: "0.18em", color: "var(--atlas-gold)", textTransform: "uppercase" }}>
            AXIOM
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...sMono, fontSize: 10, letterSpacing: "0.14em", color: "var(--atlas-muted)", textTransform: "uppercase" }}>
            Projects
          </span>
          <span style={{ color: "var(--atlas-border)", fontSize: 14 }}>·</span>
          <span style={{ ...sMono, fontSize: 10, letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.5 }}>
            {projects?.length ?? 0}
          </span>
        </div>

        <button
          onClick={handleNew}
          disabled={createProject.isPending}
          style={{
            ...sMono,
            fontSize: 10,
            letterSpacing: "0.12em",
            fontWeight: 600,
            textTransform: "uppercase",
            padding: "7px 14px",
            borderRadius: 6,
            border: "1px solid rgba(201,162,76,0.35)",
            background: "rgba(201,162,76,0.07)",
            color: createProject.isPending ? "var(--atlas-muted)" : "var(--atlas-gold)",
            cursor: createProject.isPending ? "not-allowed" : "pointer",
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { if (!createProject.isPending) { e.currentTarget.style.background = "rgba(201,162,76,0.14)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.6)"; } }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; }}
        >
          {createProject.isPending ? "Creating…" : "+ New"}
        </button>
      </header>

      {/* ── Error ── */}
      {createError && (
        <div style={{ padding: "8px 20px", background: "rgba(239,68,68,0.08)", borderBottom: "1px solid rgba(239,68,68,0.2)" }}>
          <span style={{ ...sMono, fontSize: 11, color: "rgba(252,165,165,0.85)" }}>{createError}</span>
        </div>
      )}

      {/* ── Content ── */}
      <main style={{ flex: 1, padding: "20px 16px 40px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {isLoading ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
            <LoadingSpinner size="lg" color="atlas" />
          </div>
        ) : projects?.length === 0 ? (
          <div style={{
            marginTop: 60,
            border: "1px dashed var(--atlas-border)",
            borderRadius: 10,
            padding: "48px 24px",
            textAlign: "center",
          }}>
            <p style={{ ...sMono, fontSize: 11, color: "var(--atlas-muted)", letterSpacing: "0.08em" }}>
              No projects yet. What are we building?
            </p>
            <button
              onClick={handleNew}
              disabled={createProject.isPending}
              style={{
                marginTop: 20,
                ...sMono,
                fontSize: 11,
                letterSpacing: "0.12em",
                fontWeight: 600,
                textTransform: "uppercase",
                padding: "9px 22px",
                borderRadius: 7,
                border: "1px solid rgba(201,162,76,0.4)",
                background: "rgba(201,162,76,0.08)",
                color: "var(--atlas-gold)",
                cursor: "pointer",
              }}
            >
              + Initialize First Project
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {projects?.map((p, idx) => (
              <ProjectRow
                key={p.id}
                project={p}
                index={idx}
                hovered={hoveredId === p.id}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

type ProjectItem = {
  id: number;
  name: string;
  description?: string | null;
  status?: string | null;
  createdAt: string | Date;
};

function ProjectRow({
  project: p,
  index,
  hovered,
  onMouseEnter,
  onMouseLeave,
}: {
  project: ProjectItem;
  index: number;
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const date = new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const status = (p.status ?? "active").toLowerCase();

  return (
    <Link href={`/project/${p.id}`} style={{ textDecoration: "none", display: "block" }}>
      <div
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 16px",
          borderRadius: index === 0 ? "8px 8px 2px 2px" : "2px",
          background: hovered ? "var(--atlas-surface)" : "transparent",
          border: `1px solid ${hovered ? "rgba(201,162,76,0.18)" : "var(--atlas-border)"}`,
          transition: "all 180ms ease",
          marginBottom: 2,
        }}
      >
        {/* Index dot */}
        <span style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: 10,
          color: hovered ? "var(--atlas-gold)" : "var(--atlas-muted)",
          opacity: hovered ? 1 : 0.4,
          width: 20,
          flexShrink: 0,
          transition: "all 180ms ease",
          letterSpacing: "0.06em",
        }}>
          {String(index + 1).padStart(2, "0")}
        </span>

        {/* Name + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: "var(--app-font-sans)",
            fontSize: 14,
            fontWeight: 500,
            color: hovered ? "var(--atlas-fg)" : "rgba(231,229,228,0.82)",
            marginBottom: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 180ms ease",
          }}>
            {p.name}
          </div>
          {p.description && (
            <div style={{
              fontFamily: "var(--app-font-sans)",
              fontSize: 12,
              color: "var(--atlas-muted)",
              opacity: 0.75,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {p.description}
            </div>
          )}
        </div>

        {/* Date */}
        <span style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: 10,
          color: "var(--atlas-muted)",
          opacity: 0.5,
          flexShrink: 0,
          letterSpacing: "0.06em",
        }}>
          {date}
        </span>

        {/* Status pill */}
        <span style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: 9,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontWeight: 600,
          padding: "3px 8px",
          borderRadius: 4,
          flexShrink: 0,
          background: status === "active"
            ? "rgba(201,162,76,0.10)"
            : "rgba(120,113,108,0.12)",
          color: status === "active"
            ? "rgba(201,162,76,0.75)"
            : "var(--atlas-muted)",
          border: `1px solid ${status === "active" ? "rgba(201,162,76,0.2)" : "var(--atlas-border)"}`,
        }}>
          {status}
        </span>

        {/* Arrow */}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: hovered ? 0.7 : 0.2, transition: "opacity 180ms ease" }}>
          <path d="M2 6h8M7 3l3 3-3 3" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Link>
  );
}
