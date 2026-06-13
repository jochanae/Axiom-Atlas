import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type ArtifactId = number | string;

interface Artifact {
  id: ArtifactId;
  type: string;
  title: string;
  content: string;
  status: string;
  pinned: boolean;
  parentId: ArtifactId | null;
  sources: unknown;
  createdAt: string;
  updatedAt: string;
}

type ArtifactApiRecord = Partial<Omit<Artifact, "parentId">> & {
  id: ArtifactId;
  parentId?: ArtifactId | null;
  parent_id?: ArtifactId | null;
  created_at?: string;
  updated_at?: string;
};

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

function normalizeArtifact(raw: ArtifactApiRecord): Artifact {
  const createdAt = raw.createdAt ?? raw.created_at ?? new Date().toISOString();

  return {
    id: raw.id,
    type: raw.type ?? "document",
    title: raw.title ?? "Untitled artifact",
    content: raw.content ?? "",
    status: raw.status ?? "draft",
    pinned: Boolean(raw.pinned),
    parentId: raw.parentId ?? raw.parent_id ?? null,
    sources: raw.sources ?? null,
    createdAt,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? createdAt,
  };
}

async function fetchArtifacts(
  projectId: number,
  sessionId?: number,
  filter?: WorkbenchFilter,
  search?: string,
): Promise<Artifact[]> {
  const params = new URLSearchParams();
  params.set("projectId", String(projectId));
  if (sessionId !== undefined) params.set("sessionId", String(sessionId));
  if (filter && filter !== "all") params.set("type", filter);
  if (search) params.set("search", search);

  const response = await fetch(`/api/artifacts?${params.toString()}`, { credentials: "include" });
  if (!response.ok) throw new Error("Failed to fetch artifacts");

  const data = (await response.json()) as ArtifactApiRecord[] | { artifacts?: ArtifactApiRecord[] };
  const artifacts = Array.isArray(data) ? data : (data.artifacts ?? []);
  return artifacts.map(normalizeArtifact);
}

async function updateArtifact(id: ArtifactId, body: Partial<Artifact>): Promise<Artifact> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(String(id))}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Failed to update artifact");

  return normalizeArtifact((await response.json()) as ArtifactApiRecord);
}

async function branchArtifact(id: ArtifactId): Promise<Artifact> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(String(id))}/branch`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to branch artifact");

  return normalizeArtifact((await response.json()) as ArtifactApiRecord);
}

async function deleteArtifact(id: ArtifactId): Promise<void> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(String(id))}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!response.ok) throw new Error("Failed to delete artifact");
}

export function WorkbenchPanel({
  projectId,
  sessionId,
}: {
  projectId: number;
  sessionId?: number | null;
}) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<WorkbenchFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<ArtifactId>>(new Set());
  const [deleting, setDeleting] = useState<ArtifactId | null>(null);

  const activeSessionId = showAll ? undefined : (sessionId ?? undefined);
  const {
    data: artifacts,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["artifacts", projectId, activeSessionId, filter, search],
    queryFn: () => fetchArtifacts(projectId, activeSessionId, filter, search.trim() || undefined),
    enabled: projectId > 0,
    refetchInterval: 5000,
  });

  const toggleExpand = useCallback((id: ArtifactId) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const refreshArtifacts = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["artifacts", projectId] });
  }, [projectId, queryClient]);

  const togglePin = useCallback(
    async (id: ArtifactId, pinned: boolean) => {
      try {
        await updateArtifact(id, { pinned: !pinned });
        refreshArtifacts();
        toast.success(pinned ? "Artifact unpinned" : "Artifact pinned");
      } catch {
        toast.error("Failed to update artifact");
      }
    },
    [refreshArtifacts],
  );

  const handleBranch = useCallback(
    async (id: ArtifactId) => {
      try {
        await branchArtifact(id);
        refreshArtifacts();
        toast.success("Artifact branched");
      } catch {
        toast.error("Failed to branch artifact");
      }
    },
    [refreshArtifacts],
  );

  const handleDelete = useCallback(
    async (id: ArtifactId) => {
      if (!window.confirm("Delete this artifact?")) return;
      setDeleting(id);
      try {
        await deleteArtifact(id);
        refreshArtifacts();
        toast.success("Artifact deleted");
      } catch {
        toast.error("Failed to delete artifact");
      } finally {
        setDeleting(null);
      }
    },
    [refreshArtifacts],
  );

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid var(--atlas-border)",
            borderTopColor: "var(--atlas-gold)",
            animation: "spin 0.8s linear infinite",
          }}
        />
      </div>
    );
  }

  const list = artifacts ?? [];
  const pinned = list.filter((artifact) => artifact.pinned);
  const unpinned = list.filter((artifact) => !artifact.pinned);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          padding: "7px 10px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.08em",
              color: "var(--atlas-muted)",
              opacity: 0.6,
            }}
          >
            WORKBENCH
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                fontSize: 10,
                color: "var(--atlas-muted)",
                fontFamily: "var(--app-font-mono)",
              }}
            >
              {list.length} artifact{list.length === 1 ? "" : "s"}
            </span>
            {list.length > 0 && (
              <div style={{ display: "flex", gap: 4 }}>
                <ExportButton label="MD" onClick={() => exportMarkdown(list)} />
                <ExportButton label="PDF" onClick={() => void exportPdf(list)} />
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[false, true].map((all) => (
            <button
              key={String(all)}
              type="button"
              onClick={() => setShowAll(all)}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                border: "1px solid",
                borderColor: showAll === all ? "var(--atlas-gold)" : "var(--atlas-border)",
                background: showAll === all ? "rgba(201,162,76,0.08)" : "transparent",
                color: showAll === all ? "var(--atlas-gold)" : "var(--atlas-muted)",
                fontSize: 9,
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.06em",
                cursor: "pointer",
                transition: "all 160ms ease",
              }}
            >
              {all ? "All project" : "This session"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as WorkbenchFilter)}
            style={{
              background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)",
              fontSize: 10,
              fontFamily: "var(--app-font-mono)",
              borderRadius: 5,
              padding: "3px 6px",
              cursor: "pointer",
              outline: "none",
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
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search..."
            style={{
              flex: 1,
              background: "var(--atlas-surface)",
              border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)",
              fontSize: 10,
              fontFamily: "var(--app-font-sans)",
              borderRadius: 5,
              padding: "3px 8px",
              outline: "none",
            }}
          />
        </div>
      </div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "8px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {isError && (
          <div
            style={{
              textAlign: "center",
              padding: "28px 0",
              color: "var(--atlas-muted)",
              fontSize: 12,
            }}
          >
            Could not load artifacts.
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => void refetch()}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--atlas-border)",
                  background: "transparent",
                  color: "var(--atlas-gold)",
                  cursor: "pointer",
                  fontSize: 10,
                  fontFamily: "var(--app-font-mono)",
                }}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {!isError && list.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              color: "var(--atlas-muted)",
              fontSize: 12,
            }}
          >
            <div style={{ marginBottom: 8, opacity: 0.5 }}>
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
                style={{ margin: "0 auto" }}
              >
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            No artifacts yet
            <div style={{ fontSize: 10, marginTop: 4, opacity: 0.6 }}>
              Ask Atlas to plan, blueprint, research, or generate a visual
            </div>
          </div>
        )}
        {[...pinned, ...unpinned].map((artifact) => (
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
  const isImageSet = artifact.type === "image_set";
  let parsedContent: unknown = null;
  if (isPlanOrBlueprint || isImageSet) {
    try {
      parsedContent = JSON.parse(artifact.content);
    } catch {
      parsedContent = null;
    }
  }

  return (
    <div
      style={{
        borderRadius: 8,
        border: artifact.pinned
          ? "1px solid rgba(201,162,76,0.35)"
          : "1px solid var(--atlas-border)",
        background: artifact.pinned ? "rgba(201,162,76,0.04)" : "var(--atlas-surface)",
        overflow: "hidden",
        opacity: deleting ? 0.5 : 1,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        onClick={onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 9px",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: 8,
            fontFamily: "var(--app-font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            padding: "1px 5px",
            borderRadius: 4,
            background: "rgba(120,113,108,0.1)",
            color: "var(--atlas-muted)",
            border: "1px solid rgba(120,113,108,0.15)",
            flexShrink: 0,
          }}
        >
          {typeLabel}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--atlas-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {artifact.title}
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: statusColor,
            flexShrink: 0,
          }}
        />
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onTogglePin();
          }}
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: "2px 3px",
            color: artifact.pinned ? "var(--atlas-gold)" : "var(--atlas-muted)",
            opacity: artifact.pinned ? 1 : 0.4,
            transition: "opacity 160ms ease",
            lineHeight: 1,
          }}
          title={artifact.pinned ? "Unpin" : "Pin"}
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 10l4-4 4 4M8 6v8" />
          </svg>
        </button>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          stroke="var(--atlas-muted)"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d={expanded ? "M2 8l4-4 4 4" : "M2 4l4 4 4-4"} />
        </svg>
      </div>
      {expanded && (
        <div style={{ padding: "0 9px 8px", borderTop: "1px solid var(--atlas-border)" }}>
          {isImageSet && <ArtifactImages artifact={artifact} parsedContent={parsedContent} />}
          {isPlanOrBlueprint && <ArtifactSteps parsedContent={parsedContent} />}
          {!isPlanOrBlueprint && !isImageSet && (
            <div
              style={{
                marginTop: 8,
                fontSize: 10,
                color: "var(--atlas-fg)",
                opacity: 0.8,
                lineHeight: 1.5,
                maxHeight: 120,
                overflowY: "auto",
                fontFamily: "var(--app-font-sans)",
                whiteSpace: "pre-wrap",
              }}
            >
              {artifact.content.slice(0, 500)}
              {artifact.content.length > 500 && "..."}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <span
              style={{
                fontSize: 8,
                fontFamily: "var(--app-font-mono)",
                color: "var(--atlas-muted)",
                opacity: 0.5,
                flex: 1,
              }}
            >
              #{artifact.id} - {new Date(artifact.createdAt).toLocaleDateString()}
              {artifact.parentId ? ` - Branch of #${artifact.parentId}` : ""}
            </span>
            <button
              type="button"
              onClick={onBranch}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                border: "1px solid var(--atlas-border)",
                background: "transparent",
                color: "var(--atlas-muted)",
                fontSize: 9,
                fontFamily: "var(--app-font-mono)",
                cursor: "pointer",
              }}
            >
              Branch
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              style={{
                padding: "3px 8px",
                borderRadius: 5,
                border: "1px solid var(--atlas-border)",
                background: "transparent",
                color: "var(--atlas-muted)",
                fontSize: 9,
                fontFamily: "var(--app-font-mono)",
                cursor: deleting ? "not-allowed" : "pointer",
              }}
            >
              {deleting ? "Deleting" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ArtifactImages({
  artifact,
  parsedContent,
}: {
  artifact: Artifact;
  parsedContent: unknown;
}) {
  const content = parsedContent as Record<string, unknown> | null;
  const images = content?.images as
    | Array<{ b64: string; mime: string; style?: string }>
    | undefined;
  if (!images?.length) return null;

  return (
    <div
      style={{
        marginTop: 8,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
        gap: 6,
      }}
    >
      {images.map((image, index) => (
        <img
          key={`${image.mime}-${index}`}
          src={`data:${image.mime};base64,${image.b64}`}
          alt={image.style ?? "Generated visual"}
          style={{
            width: "100%",
            borderRadius: 6,
            border: "1px solid var(--atlas-border)",
            cursor: "pointer",
          }}
          onClick={(event) => {
            event.stopPropagation();
            const win = window.open("", "_blank");
            if (!win) return;
            win.document.write(
              `<img src="data:${escapeHtml(image.mime)};base64,${image.b64}" style="max-width:100%">`,
            );
            win.document.title = artifact.title;
          }}
        />
      ))}
    </div>
  );
}

function ArtifactSteps({ parsedContent }: { parsedContent: unknown }) {
  const content = parsedContent as Record<string, unknown> | null;
  const steps = content?.steps as
    | Array<{ order: number; description: string; moscow?: string }>
    | undefined;
  if (!steps?.length) return null;

  return (
    <div style={{ marginTop: 8 }}>
      {steps.map((step, index) => (
        <div
          key={`${step.order}-${index}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 0",
            fontSize: 10,
            color: "var(--atlas-fg)",
            opacity: 0.85,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "var(--atlas-border)",
              color: "var(--atlas-muted)",
              fontSize: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--app-font-mono)",
              flexShrink: 0,
            }}
          >
            {step.order}
          </span>
          <span style={{ flex: 1 }}>{step.description}</span>
          {step.moscow && (
            <span
              style={{
                fontSize: 7,
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "1px 4px",
                borderRadius: 3,
                background:
                  step.moscow === "must" ? "rgba(201,162,76,0.12)" : "rgba(120,113,108,0.1)",
                color: step.moscow === "must" ? "var(--atlas-gold)" : "var(--atlas-muted)",
                border: "1px solid",
                borderColor:
                  step.moscow === "must" ? "rgba(201,162,76,0.2)" : "rgba(120,113,108,0.15)",
              }}
            >
              {step.moscow}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function ExportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "2px 7px",
        borderRadius: 4,
        border: "1px solid var(--atlas-border)",
        background: "transparent",
        color: "var(--atlas-muted)",
        fontSize: 8,
        fontFamily: "var(--app-font-mono)",
        cursor: "pointer",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </button>
  );
}

function artifactContentToText(artifact: Artifact): string {
  if (artifact.type === "plan" || artifact.type === "blueprint") {
    try {
      const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
      const steps = parsed.steps as
        | Array<{ order: number; description: string; moscow?: string }>
        | undefined;
      if (steps?.length) {
        return steps
          .map(
            (step) =>
              `${step.order}. ${step.description}${step.moscow ? ` [${step.moscow.toUpperCase()}]` : ""}`,
          )
          .join("\n");
      }
    } catch {
      // Fall through to raw content.
    }
  }
  if (artifact.type === "image_set") {
    try {
      const parsed = JSON.parse(artifact.content) as Record<string, unknown>;
      const images = parsed.images as Array<{ style?: string }> | undefined;
      return images?.length
        ? `Contains ${images.length} generated image${images.length === 1 ? "" : "s"}`
        : "Generated visual asset";
    } catch {
      // Fall through to raw content.
    }
  }
  return artifact.content;
}

function exportMarkdown(artifacts: Artifact[]) {
  const date = new Date().toLocaleDateString();
  const lines = [
    `# Atlas Workbench Export - ${date}`,
    "",
    `*${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} exported*`,
    "",
    ...artifacts.flatMap((artifact) => [
      "---",
      "",
      `## ${artifact.title}`,
      "",
      `- **Type:** ${TYPE_LABELS[artifact.type] ?? artifact.type}`,
      `- **Status:** ${artifact.status}`,
      `- **ID:** #${artifact.id}`,
      `- **Created:** ${new Date(artifact.createdAt).toLocaleString()}`,
      artifact.parentId ? `- **Branch of:** #${artifact.parentId}` : "",
      "",
      artifactContentToText(artifact),
      "",
    ]),
  ].filter(Boolean);

  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `atlas-workbench-${filenameDateStamp()}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast.success("Exported as Markdown");
}

type Html2PdfWorker = {
  from: (element: HTMLElement) => {
    set: (options: Record<string, unknown>) => {
      save: () => Promise<void>;
    };
  };
};

async function exportPdf(artifacts: Artifact[]) {
  try {
    const html2pdf = ((await import("html2pdf.js")) as { default: () => Html2PdfWorker }).default;
    const date = new Date().toLocaleDateString();
    const container = document.createElement("div");
    container.style.cssText =
      "padding: 40px; font-family: system-ui, sans-serif; color: #1c1917; background: #fff; line-height: 1.6;";
    container.innerHTML = `<h1 style="font-size: 22px; margin-bottom: 8px;">Atlas Workbench Export</h1><p style="font-size: 12px; color: #78716c; margin-bottom: 24px;">${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} - ${escapeHtml(date)}</p>${artifacts.map((artifact) => `<div style="margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #e7e5e4;"><h2 style="font-size: 16px; margin-bottom: 6px;">${escapeHtml(artifact.title)}</h2><div style="font-size: 10px; color: #78716c; margin-bottom: 10px; font-family: monospace;">${escapeHtml(TYPE_LABELS[artifact.type] ?? artifact.type)} - ${escapeHtml(artifact.status)} - #${escapeHtml(String(artifact.id))}</div><div style="font-size: 12px; white-space: pre-wrap;">${escapeHtml(artifactContentToText(artifact))}</div></div>`).join("")}`;
    document.body.appendChild(container);
    await html2pdf()
      .from(container)
      .set({
        margin: 10,
        filename: `atlas-workbench-${filenameDateStamp()}.pdf`,
        html2canvas: { scale: 2 },
        jsPDF: { unit: "mm", format: "a4" },
      })
      .save();
    document.body.removeChild(container);
    toast.success("Exported as PDF");
  } catch (error) {
    toast.error("PDF export failed");
    console.error(error);
  }
}

function filenameDateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
