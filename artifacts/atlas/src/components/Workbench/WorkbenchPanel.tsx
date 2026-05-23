import { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

interface Artifact {
  id: number;
  type: string;
  title: string;
  content: string;
  status: string;
  pinned: boolean;
  parentId: number | null;
  sources: unknown;
  createdAt: string;
  updatedAt: string;
}

type WorkbenchFilter = "all" | "plan" | "blueprint" | "research" | "image_set" | "document";

const TYPE_LABELS: Record<string, string> = {
  plan: "Plan",
  blueprint: "Blueprint",
  research: "Research",
  image_set: "Images",
  document: "Doc",
  sketch: "Sketch",
  export: "Export",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "var(--atlas-muted)",
  active: "var(--atlas-phosphor)",
  superseded: "var(--atlas-ember)",
  final: "var(--atlas-gold)",
};

function fetchArtifacts(projectId: number, sessionId?: number, filter?: WorkbenchFilter, search?: string): Promise<Artifact[]> {
  const params = new URLSearchParams();
  params.set("projectId", String(projectId));
  if (sessionId !== undefined) params.set("sessionId", String(sessionId));
  if (filter && filter !== "all") params.set("type", filter);
  if (search) params.set("search", search);
  return fetch(`/api/artifacts?${params.toString()}`, { credentials: "include" })
    .then(r => { if (!r.ok) throw new Error("Failed to fetch artifacts"); return r.json(); });
}

function updateArtifact(id: number, body: Partial<Artifact>): Promise<Artifact> {
  return fetch(`/api/artifacts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  }).then(r => { if (!r.ok) throw new Error("Failed to update artifact"); return r.json(); });
}

function branchArtifact(id: number): Promise<Artifact> {
  return fetch(`/api/artifacts/${id}/branch`, {
    method: "POST",
    credentials: "include",
  }).then(r => { if (!r.ok) throw new Error("Failed to branch artifact"); return r.json(); });
}

function deleteArtifact(id: number): Promise<void> {
  return fetch(`/api/artifacts/${id}`, {
    method: "DELETE",
    credentials: "include",
  }).then(r => { if (!r.ok) throw new Error("Failed to delete artifact"); });
}

export function WorkbenchPanel({ projectId, sessionId }: { projectId: number; sessionId?: number }) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<WorkbenchFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState<number | null>(null);

  const activeSessionId = showAll ? undefined : sessionId;
  const { data: artifacts, isLoading } = useQuery({
    queryKey: ["artifacts", projectId, activeSessionId, filter, search],
    queryFn: () => fetchArtifacts(projectId, activeSessionId, filter, search || undefined),
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  const toggleExpand = useCallback((id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const togglePin = useCallback(async (id: number, pinned: boolean) => {
    await updateArtifact(id, { pinned: !pinned });
    queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] });
  }, [projectId, queryClient]);

  const handleBranch = useCallback(async (id: number) => {
    await branchArtifact(id);
    queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] });
  }, [projectId, queryClient]);

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm("Delete this artifact?")) return;
    setDeleting(id);
    try {
      await deleteArtifact(id);
      queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] });
    } finally { setDeleting(null); }
  }, [projectId, queryClient]);

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--atlas-border)", borderTopColor: "var(--atlas-gold)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  const list = artifacts ?? [];
  const pinned = list.filter(a => a.pinned);
  const unpinned = list.filter(a => !a.pinned);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.6 }}>
            WORKBENCH
          </span>
          <span style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)" }}>
            {list.length} artifact{list.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Scope toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <button
            onClick={() => setShowAll(false)}
            style={{
              padding: "3px 8px", borderRadius: 5, border: "1px solid",
              borderColor: !showAll ? "var(--atlas-gold)" : "var(--atlas-border)",
              background: !showAll ? "rgba(201,162,76,0.08)" : "transparent",
              color: !showAll ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
              cursor: "pointer", transition: "all 160ms ease",
            }}
          >
            This session
          </button>
          <button
            onClick={() => setShowAll(true)}
            style={{
              padding: "3px 8px", borderRadius: 5, border: "1px solid",
              borderColor: showAll ? "var(--atlas-gold)" : "var(--atlas-border)",
              background: showAll ? "rgba(201,162,76,0.08)" : "transparent",
              color: showAll ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
              cursor: "pointer", transition: "all 160ms ease",
            }}
          >
            All project
          </button>
        </div>

        {/* Filter + search */}
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value as WorkbenchFilter)}
            style={{
              background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 10, fontFamily: "var(--app-font-mono)",
              borderRadius: 5, padding: "3px 6px", cursor: "pointer", outline: "none",
            }}
          >
            <option value="all">All types</option>
            <option value="plan">Plans</option>
            <option value="blueprint">Blueprints</option>
            <option value="research">Research</option>
            <option value="image_set">Images</option>
            <option value="document">Documents</option>
          </select>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              flex: 1, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 10, fontFamily: "var(--app-font-sans)",
              borderRadius: 5, padding: "3px 8px", outline: "none",
            }}
          />
        </div>
      </div>

      {/* Artifact list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        {list.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--atlas-muted)", fontSize: 12 }}>
            <div style={{ marginBottom: 8, opacity: 0.5 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ margin: "0 auto" }}>
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            No artifacts yet
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
              Ask Atlas to plan, blueprint, or research something
            </div>
          </div>
        )}

        {[...pinned, ...unpinned].map(artifact => (
          <ArtifactCard
            key={artifact.id}
            artifact={artifact}
            expanded={expanded.has(artifact.id)}
            onToggleExpand={() => toggleExpand(artifact.id)}
            onTogglePin={() => togglePin(artifact.id, artifact.pinned)}
            onBranch={() => handleBranch(artifact.id)}
            onDelete={() => handleDelete(artifact.id)}
            deleting={deleting === artifact.id}
          />
        ))}
      </div>
    </div>
  );
}

function ArtifactCard({
  artifact,
  expanded,
  onToggleExpand,
  onTogglePin,
  onBranch,
  onDelete,
  deleting,
}: {
  artifact: Artifact;
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePin: () => void;
  onBranch: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const typeLabel = TYPE_LABELS[artifact.type] ?? artifact.type;
  const statusColor = STATUS_COLORS[artifact.status] ?? "var(--atlas-muted)";
  const isPlanOrBlueprint = artifact.type === "plan" || artifact.type === "blueprint";

  let parsedContent: unknown = null;
  if (isPlanOrBlueprint) {
    try { parsedContent = JSON.parse(artifact.content); } catch { parsedContent = null; }
  }

  return (
    <div style={{
      borderRadius: 8,
      border: artifact.pinned ? "1px solid rgba(201,162,76,0.35)" : "1px solid var(--atlas-border)",
      background: artifact.pinned ? "rgba(201,162,76,0.04)" : "var(--atlas-surface)",
      overflow: "hidden",
      opacity: deleting ? 0.5 : 1,
      transition: "opacity 200ms ease",
    }}>
      {/* Header row */}
      <div
        onClick={onToggleExpand}
        style={{
          display: "flex", alignItems: "center", gap: 7, padding: "7px 9px",
          cursor: "pointer", userSelect: "none",
        }}
      >
        {/* Type badge */}
        <span style={{
          fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
          textTransform: "uppercase", padding: "1px 5px", borderRadius: 4,
          background: "rgba(120,113,108,0.1)", color: "var(--atlas-muted)",
          border: "1px solid rgba(120,113,108,0.15)", flexShrink: 0,
        }}>
          {typeLabel}
        </span>

        {/* Title */}
        <span style={{
          flex: 1, fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {artifact.title}
        </span>

        {/* Status dot */}
        <span style={{
          width: 6, height: 6, borderRadius: "50%", background: statusColor,
          flexShrink: 0,
        }} />

        {/* Pin */}
        <button
          onClick={e => { e.stopPropagation(); onTogglePin(); }}
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            padding: "2px 3px", color: artifact.pinned ? "var(--atlas-gold)" : "var(--atlas-muted)",
            opacity: artifact.pinned ? 1 : 0.4, transition: "opacity 160ms ease",
            lineHeight: 1,
          }}
          title={artifact.pinned ? "Unpin" : "Pin"}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10l4-4 4 4M8 6v8" />
          </svg>
        </button>

        {/* Expand chevron */}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.6" strokeLinecap="round">
          <path d={expanded ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
        </svg>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 9px 8px", borderTop: "1px solid var(--atlas-border)" }}>
          {(() => {
            if (!isPlanOrBlueprint || !parsedContent) return null;
            if (typeof parsedContent !== "object" || parsedContent === null) return null;
            const content = parsedContent as Record<string, unknown>;
            if (!("steps" in content) || !Array.isArray(content.steps)) return null;
            const steps = content.steps as Array<{ order: number; description: string; type: string; moscow?: string }>;
            return (
              <div style={{ marginTop: 8 }}>
                {steps.map((step, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "3px 0",
                    fontSize: 10, color: "var(--atlas-fg)", opacity: 0.85,
                  }}>
                    <span style={{
                      width: 14, height: 14, borderRadius: "50%",
                      background: "var(--atlas-border)", color: "var(--atlas-muted)",
                      fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "var(--app-font-mono)", flexShrink: 0,
                    }}>
                      {step.order}
                    </span>
                    <span style={{ flex: 1 }}>{step.description}</span>
                    {step.moscow && (
                      <span style={{
                        fontSize: 7, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
                        textTransform: "uppercase", padding: "1px 4px", borderRadius: 3,
                        background: step.moscow === "must" ? "rgba(201,162,76,0.12)" : "rgba(120,113,108,0.1)",
                        color: step.moscow === "must" ? "var(--atlas-gold)" : "var(--atlas-muted)",
                        border: "1px solid",
                        borderColor: step.moscow === "must" ? "rgba(201,162,76,0.2)" : "rgba(120,113,108,0.15)",
                      }}>
                        {step.moscow}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Content preview (non-plan types) */}
          {!isPlanOrBlueprint && (
            <div style={{
              marginTop: 8, fontSize: 10, color: "var(--atlas-fg)", opacity: 0.8,
              lineHeight: 1.5, maxHeight: 120, overflowY: "auto",
              fontFamily: "var(--app-font-sans)", whiteSpace: "pre-wrap",
            }}>
              {artifact.content.slice(0, 500)}
              {artifact.content.length > 500 && "\u2026"}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <span style={{
              fontSize: 8, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)",
              opacity: 0.5, flex: 1,
            }}>
              #{artifact.id} · {new Date(artifact.createdAt).toLocaleDateString()}
              {artifact.parentId ? ` · Branch of #${artifact.parentId}` : ""}
            </span>
            <button
              onClick={onBranch}
              style={{
                padding: "3px 8px", borderRadius: 5, border: "1px solid var(--atlas-border)",
                background: "transparent", color: "var(--atlas-muted)", fontSize: 9,
                fontFamily: "var(--app-font-mono)", cursor: "pointer", transition: "all 160ms ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--atlas-gold)"; e.currentTarget.style.color = "var(--atlas-gold)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
            >
              Branch
            </button>
            <button
              onClick={onDelete}
              style={{
                padding: "3px 8px", borderRadius: 5, border: "1px solid var(--atlas-border)",
                background: "transparent", color: "var(--atlas-muted)", fontSize: 9,
                fontFamily: "var(--app-font-mono)", cursor: "pointer", transition: "all 160ms ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(239,68,68,0.4)"; e.currentTarget.style.color = "rgba(252,165,165,0.8)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--atlas-border)"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
