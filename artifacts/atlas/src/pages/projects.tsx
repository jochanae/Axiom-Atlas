import { useState, useCallback } from "react";
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
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);

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

  const handleDelete = useCallback(async (id: number) => {
    setDeletingId(id);
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE", credentials: "include" });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch {}
    setDeletingId(null);
    setConfirmDeleteId(null);
  }, [queryClient]);

  const handleArchive = useCallback(async (id: number, archive: boolean) => {
    try {
      await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: archive ? "archived" : "active" }),
      });
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch {}
  }, [queryClient]);

  const activeProjects = projects?.filter(p => (p.status ?? "active") !== "archived") ?? [];
  const archivedProjects = projects?.filter(p => p.status === "archived") ?? [];

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
            {activeProjects.length}
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
        ) : activeProjects.length === 0 && archivedProjects.length === 0 ? (
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
          <>
            {/* Active projects */}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {activeProjects.map((p, idx) => (
                <ProjectRow
                  key={p.id}
                  project={p}
                  index={idx}
                  hovered={hoveredId === p.id}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  confirmDelete={confirmDeleteId === p.id}
                  deleting={deletingId === p.id}
                  onRequestDelete={() => setConfirmDeleteId(p.id)}
                  onCancelDelete={() => setConfirmDeleteId(null)}
                  onConfirmDelete={() => handleDelete(p.id)}
                  onArchive={() => handleArchive(p.id, true)}
                />
              ))}
            </div>

            {/* Archived section */}
            {archivedProjects.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <button
                  onClick={() => setShowArchived(v => !v)}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    background: "transparent", border: "none", cursor: "pointer",
                    padding: "6px 0", marginBottom: showArchived ? 12 : 0,
                    width: "100%",
                  }}
                >
                  <span style={{ ...sMono, fontSize: 9, letterSpacing: "0.14em", color: "var(--atlas-muted)", textTransform: "uppercase", opacity: 0.55 }}>
                    Archived
                  </span>
                  <span style={{ ...sMono, fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4 }}>
                    ({archivedProjects.length})
                  </span>
                  <svg
                    width="10" height="10" viewBox="0 0 10 10" fill="none"
                    style={{ marginLeft: 2, opacity: 0.35, transition: "transform 160ms ease", transform: showArchived ? "rotate(180deg)" : "rotate(0deg)" }}
                  >
                    <path d="M2 3.5l3 3 3-3" stroke="var(--atlas-muted)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                {showArchived && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, opacity: 0.7 }}>
                    {archivedProjects.map((p, idx) => (
                      <ProjectRow
                        key={p.id}
                        project={p}
                        index={idx}
                        hovered={hoveredId === p.id}
                        onMouseEnter={() => setHoveredId(p.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        confirmDelete={confirmDeleteId === p.id}
                        deleting={deletingId === p.id}
                        onRequestDelete={() => setConfirmDeleteId(p.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onConfirmDelete={() => handleDelete(p.id)}
                        onArchive={() => handleArchive(p.id, false)}
                        isArchived
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
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
  confirmDelete,
  deleting,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onArchive,
  isArchived = false,
}: {
  project: ProjectItem;
  index: number;
  hovered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  confirmDelete: boolean;
  deleting: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onArchive: () => void;
  isArchived?: boolean;
}) {
  const date = new Date(p.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: index === 0 ? "8px 8px 2px 2px" : "2px",
        background: hovered ? "var(--atlas-surface)" : "transparent",
        border: `1px solid ${hovered ? "rgba(201,162,76,0.18)" : "var(--atlas-border)"}`,
        transition: "all 180ms ease",
        marginBottom: 2,
        position: "relative",
      }}
    >
      {/* Clickable link area */}
      <Link
        href={`/project/${p.id}`}
        style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}
        onClick={(e) => { if (confirmDelete) e.preventDefault(); }}
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

        {/* Arrow */}
        {!confirmDelete && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: hovered ? 0.7 : 0.2, transition: "opacity 180ms ease" }}>
            <path d="M2 6h8M7 3l3 3-3 3" stroke="var(--atlas-gold)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </Link>

      {/* Action buttons — visible on hover or confirm state */}
      {confirmDelete ? (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(252,165,165,0.7)", whiteSpace: "nowrap" }}>
            Delete?
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onConfirmDelete(); }}
            disabled={deleting}
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
              padding: "4px 9px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.4)",
              background: "rgba(239,68,68,0.12)", color: "rgba(252,165,165,0.9)",
              cursor: deleting ? "not-allowed" : "pointer", textTransform: "uppercase", fontWeight: 600,
            }}
          >
            {deleting ? "…" : "Yes"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCancelDelete(); }}
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
              padding: "4px 9px", borderRadius: 4, border: "1px solid var(--atlas-border)",
              background: "transparent", color: "var(--atlas-muted)",
              cursor: "pointer", textTransform: "uppercase",
            }}
          >
            No
          </button>
        </div>
      ) : hovered ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {/* Archive / Restore */}
          <button
            title={isArchived ? "Restore project" : "Archive project"}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onArchive(); }}
            style={{
              background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 4,
              padding: "4px 7px", cursor: "pointer", lineHeight: 1,
              color: "var(--atlas-muted)", transition: "all 140ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; e.currentTarget.style.color = "var(--atlas-gold)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
          >
            {isArchived ? (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 12V4M4 8l4-4 4 4" />
                <path d="M2 14h12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="12" height="3" rx="1" />
                <path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6" />
                <path d="M6 10h4" />
              </svg>
            )}
          </button>
          {/* Delete */}
          <button
            title="Delete project"
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onRequestDelete(); }}
            style={{
              background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 4,
              padding: "4px 7px", cursor: "pointer", lineHeight: 1,
              color: "var(--atlas-muted)", transition: "all 140ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; e.currentTarget.style.color = "rgba(252,165,165,0.8)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h10M6 4V2h4v2M13 4l-.867 9.143A2 2 0 0110.138 15H5.862a2 2 0 01-1.995-1.857L3 4" />
            </svg>
          </button>
        </div>
      ) : null}
    </div>
  );
}
