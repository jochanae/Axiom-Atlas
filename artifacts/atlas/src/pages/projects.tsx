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
  linkedRepo?: string | null;
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
              marginBottom: p.linkedRepo ? 4 : 0,
            }}>
              {p.description}
            </div>
          )}
          {p.linkedRepo ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: p.description ? 0 : 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="rgba(74,222,128,0.7)" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "rgba(74,222,128,0.6)",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {(() => {
                  try {
                    const r = JSON.parse(p.linkedRepo);
                    const full = typeof r === "string" ? r : (r.fullName ?? p.linkedRepo);
                    return full.includes("/") ? full.split("/")[1] : full;
                  } catch {
                    return p.linkedRepo.includes("/") ? p.linkedRepo.split("/")[1] : p.linkedRepo;
                  }
                })()}
              </span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: p.description ? 0 : 2 }}>
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="rgba(120,113,108,0.35)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                <circle cx="8" cy="10" r="1" fill="rgba(120,113,108,0.35)" stroke="none" />
                <circle cx="12" cy="10" r="1" fill="rgba(120,113,108,0.35)" stroke="none" />
              </svg>
              <span style={{
                fontFamily: "var(--app-font-mono)",
                fontSize: 10,
                color: "rgba(120,113,108,0.35)",
                letterSpacing: "0.02em",
              }}>
                Chat only
              </span>
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
