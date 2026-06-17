import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import JSZip from "jszip";
import { toast } from "sonner";
import { CodeEditor } from "@/components/code/CodeEditor";
import { ForgeSyncPanel } from "@/components/code/ForgeSyncPanel";
import { useCodegen, type CodegenFile } from "@/hooks/useCodegen";
import { useGithubPushToken } from "@/hooks/useGithubPushToken";
import { apiUrl } from "@/lib/api";
import { parseLinkedRepo } from "@/lib/githubRepo";
import {
  ArrowLeft,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  Github,
  Download,
  RefreshCw,
  Search,
  Copy,
  Check,
  Clock,
  ChevronRight,
  ChevronDown,
  Layers,
  Hammer,
  Wand2,
  Activity,
  AlertTriangle,
} from "lucide-react";

/* ──────────────────────────────────────────────────────────────────────────
   /code — Generation Workspace (UI Shell with Mock Data)
   ──────────────────────────────────────────────────────────────────────────
   This page is the widescreen mirror of the inline chat code generation
   engine. Atlas streams files here; the user reviews, diffs, pushes to
   GitHub, downloads a zip, or extracts to Forge.

   Backend contracts live at the bottom of this file (Developer Handoff
   Blueprint). All data here is MOCK and conforms to those types.
   ────────────────────────────────────────────────────────────────────────── */

export interface GeneratedFile {
  id: string;
  runId: string;
  path: string;              // "src/components/Foo.tsx"
  language: string;
  bytes: number;
  lines: number;
  content: string;
  createdAt: string;         // ISO
  updatedAt: string;         // ISO
  status: string;
  previousContent?: string | null;
}

export type CodeRunStatus = string;

export interface GenerationRun {
  id: string;
  projectId: number;
  userId: number;
  prompt: string;
  intent: string;
  model: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  summary: string;
  commitSha: string | null;
  pushedToBranch: string | null;
}

export interface ProjectStub {
  id: number;
  name: string;
  repo?: string | null;       // "owner/repo"
  linkedRepo?: string | null;
  githubToken?: string | null;
  defaultBranch?: string;
}

type RunsResponse = GenerationRun[];

// ── API fetchers ─────────────────────────────────────────────────────────────
async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path), { credentials: "include" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }
  return res.json() as Promise<T>;
}

function getProjectIdFromUrl(): number | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get("projectId");
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  const stored = window.localStorage.getItem("atlas:lastProjectId");
  if (stored && /^\d+$/.test(stored)) return Number(stored);
  return null;
}

function getRunIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("runId");
}


// ── Tree builder ─────────────────────────────────────────────────────────────
type TreeNode = {
  name: string;
  path: string;
  file?: GeneratedFile;
  children?: Record<string, TreeNode>;
};

function buildTree(files: GeneratedFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: {} };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((part, i) => {
      cur.children = cur.children || {};
      if (!cur.children[part]) {
        cur.children[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          children: i < parts.length - 1 ? {} : undefined,
        };
      }
      if (i === parts.length - 1) cur.children[part].file = f;
      cur = cur.children[part];
    });
  }
  return root;
}

// ── Styling helpers ──────────────────────────────────────────────────────────
const PANEL: React.CSSProperties = {
  background: "color-mix(in oklab, var(--atlas-surface) 92%, transparent)",
  border: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent)",
  borderRadius: 14,
  backdropFilter: "blur(14px)",
};

const MONO: React.CSSProperties = {
  fontFamily: "var(--app-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
};

type MobilePane = "Files" | "Code" | "Activity";

function normalizeFileStatus(status: string): "new" | "modified" | "unchanged" | "deleted" {
  if (status === "new" || status === "modified" || status === "unchanged" || status === "deleted") {
    return status;
  }
  return "modified";
}

function statusColor(s: GeneratedFile["status"]) {
  const status = normalizeFileStatus(s);
  if (status === "new") return "#7CE3A0";
  if (status === "modified") return "#E6C687";
  if (status === "deleted") return "#FF8A8A";
  return "rgba(255,255,255,0.45)";
}

function runStatusTint(s: CodeRunStatus) {
  if (s === "completed") return "#7CE3A0";
  if (s === "failed") return "#FF8A8A";
  return "rgba(255,255,255,0.55)";
}

function runStatusLabel(s: CodeRunStatus) {
  return s || "unknown";
}

function fileCountForRun(run: GenerationRun) {
  return run.filesChanged;
}

function fileCountLabel(count: number) {
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function formatDuration(ms: number | null) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "0.0s";
  return `${(ms / 1000).toFixed(1)}s`;
}

function runUpdatedAt(run: GenerationRun) {
  return run.finishedAt ?? run.startedAt;
}

function runTitle(run: GenerationRun) {
  const summary = run.summary.trim();
  if (summary) return summary;

  const prompt = run.prompt.trim();
  if (!prompt) return "Generation run";
  if (prompt.length <= 60) return prompt;
  return `${prompt.slice(0, 57).trimEnd()}...`;
}

// ── File Tree ────────────────────────────────────────────────────────────────
function FileTree({
  node, depth, selectedPath, onSelect, openMap, toggleOpen, query, edits,
}: {
  node: TreeNode; depth: number; selectedPath: string;
  onSelect: (f: GeneratedFile) => void;
  openMap: Record<string, boolean>; toggleOpen: (p: string) => void;
  query: string;
  edits: Record<string, string>;
}) {
  if (!node.children) return null;
  const entries = Object.values(node.children).sort((a, b) => {
    const aDir = !!a.children, bDir = !!b.children;
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      {entries.map((child) => {
        const isFile = !!child.file;
        const matches = !query || child.path.toLowerCase().includes(query.toLowerCase());
        if (!matches && isFile) return null;
        const isOpen = openMap[child.path] ?? depth < 2;
        const selected = isFile && selectedPath === child.path;
        const isEdited = !!child.file && Object.prototype.hasOwnProperty.call(edits, child.file.id);

        return (
          <div key={child.path}>
            <button
              type="button"
              onClick={() => isFile ? onSelect(child.file!) : toggleOpen(child.path)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 6,
                padding: `5px 8px 5px ${8 + depth * 14}px`,
                background: selected ? "color-mix(in oklab, var(--atlas-gold) 14%, transparent)" : "transparent",
                border: "none", borderLeft: selected ? "2px solid var(--atlas-gold)" : "2px solid transparent",
                color: selected ? "var(--atlas-gold)" : "var(--atlas-fg)",
                cursor: "pointer", textAlign: "left", fontSize: 12.5, ...MONO,
                borderRadius: 6, marginBottom: 1,
              }}
              onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
              onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
              {isFile ? (
                <>
                  <FileCode2 size={13} strokeWidth={1.6} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {child.name}
                  </span>
                  {isEdited && (
                    <span style={{
                      ...MONO, fontSize: 9, color: "var(--atlas-gold)", letterSpacing: "0.08em",
                      textTransform: "uppercase", flexShrink: 0,
                    }}>
                      edited
                    </span>
                  )}
                  <span style={{
                    width: 6, height: 6, borderRadius: 99,
                    background: isEdited ? "var(--atlas-gold)" : statusColor(child.file!.status),
                    boxShadow: `0 0 8px ${isEdited ? "var(--atlas-gold)" : statusColor(child.file!.status)}`,
                  }} />
                </>
              ) : (
                <>
                  {isOpen
                    ? <ChevronDown size={12} strokeWidth={1.8} style={{ opacity: 0.6 }} />
                    : <ChevronRight size={12} strokeWidth={1.8} style={{ opacity: 0.6 }} />}
                  {isOpen
                    ? <FolderOpen size={13} strokeWidth={1.6} style={{ opacity: 0.7, color: "var(--atlas-gold)" }} />
                    : <Folder size={13} strokeWidth={1.6} style={{ opacity: 0.7 }} />}
                  <span style={{ flex: 1 }}>{child.name}</span>
                </>
              )}
            </button>
            {!isFile && isOpen && (
              <FileTree
                node={child} depth={depth + 1}
                selectedPath={selectedPath} onSelect={onSelect}
                openMap={openMap} toggleOpen={toggleOpen} query={query} edits={edits}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Code Viewer ──────────────────────────────────────────────────────────────
function CodeViewer({
  file,
  value,
  isEdited,
  onChange,
}: {
  file: GeneratedFile;
  value: string;
  isEdited: boolean;
  onChange: (next: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const lineCount = value.split("\n").length;
  const byteCount = new Blob([value]).size;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px",
        borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
      }}>
        <FileCode2 size={14} style={{ color: "var(--atlas-gold)" }} />
        <span style={{ ...MONO, fontSize: 12.5, color: "var(--atlas-fg)" }}>{file.path}</span>
        <span style={{
          ...MONO, fontSize: 10, padding: "2px 7px", borderRadius: 5,
          background: `color-mix(in oklab, ${statusColor(file.status)} 14%, transparent)`,
          color: statusColor(file.status), letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {file.status}
        </span>
        {isEdited && (
          <span style={{
            ...MONO, fontSize: 10, padding: "2px 7px", borderRadius: 5,
            background: "rgba(230,198,135,0.08)",
            color: "var(--atlas-gold)", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            unsaved
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: 11, color: "var(--atlas-muted)" }}>
          {lineCount} lines · {(byteCount / 1024).toFixed(1)} kb
        </span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
          }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "5px 9px", borderRadius: 7, fontSize: 11,
            background: "rgba(230,198,135,0.08)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 22%, transparent)",
            color: "var(--atlas-gold)", cursor: "pointer", ...MONO, letterSpacing: "0.05em",
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Code body */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden", background: "#0A0910" }}>
        <CodeEditor value={value} language={`${file.language} ${file.path}`} onChange={onChange} />
      </div>
    </div>
  );
}

// ── Activity rail (right) ────────────────────────────────────────────────────
function ActivityRail({
  run,
  files,
  runs,
  onSelectRun,
}: {
  run: GenerationRun;
  files: GeneratedFile[];
  runs: GenerationRun[];
  onSelectRun: (id: string) => void;
}) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", height: "100%" }}>
      <div>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: "0.16em", color: "var(--atlas-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Active Run
        </div>
        <div style={{
          padding: 12, borderRadius: 10,
          background: "color-mix(in oklab, var(--atlas-gold) 6%, transparent)",
          border: "1px solid color-mix(in oklab, var(--atlas-gold) 16%, transparent)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <RunStatusBadge status={run.status} />
            <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)" }}>
              {fileCountLabel(fileCountForRun(run))}
            </span>
          </div>
          <div style={{ marginBottom: 6, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)" }}>
            {runTitle(run)}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--atlas-fg)", lineHeight: 1.55 }}>
            {run.summary || "Build session"}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Stat label="Files" value={fileCountForRun(run).toString()} />
        <Stat label="Lines" value={`+${run.linesAdded} / -${run.linesRemoved}`} tint="#7CE3A0" />
        <Stat label="Duration" value={formatDuration(run.durationMs)} />
      </div>

      <div>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: "0.16em", color: "var(--atlas-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Summary
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--atlas-fg)", lineHeight: 1.55, opacity: 0.85 }}>
          {run.summary || "Build session"}
        </p>
      </div>

      <div>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: "0.16em", color: "var(--atlas-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Files in this run
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {files.length ? (
            files.map((f) => (
              <div key={f.id} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                borderRadius: 6, background: "rgba(255,255,255,0.02)",
              }}>
                <span style={{
                  width: 5, height: 5, borderRadius: 99, background: statusColor(f.status),
                  boxShadow: `0 0 6px ${statusColor(f.status)}`, flexShrink: 0,
                }} />
                <span style={{ ...MONO, fontSize: 11, color: "var(--atlas-fg)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.path}
                </span>
                <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)" }}>{f.language}</span>
              </div>
            ))
          ) : (
            <EmptyHint label="No files in this run yet." />
          )}
        </div>
      </div>

      <div>
        <div style={{ ...MONO, fontSize: 10, letterSpacing: "0.16em", color: "var(--atlas-muted)", textTransform: "uppercase", marginBottom: 8 }}>
          Run History
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {runs.map((r) => (
            <RunCard
              key={r.id}
              run={r}
              active={r.id === run.id}
              onSelect={() => onSelectRun(r.id)}
              compact
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: CodeRunStatus }) {
  const tint = runStatusTint(status);
  return (
    <span style={{
      ...MONO, fontSize: 9, padding: "2px 6px", borderRadius: 4,
      background: `color-mix(in oklab, ${tint} 16%, transparent)`,
      color: tint, letterSpacing: "0.1em", textTransform: "uppercase",
      border: `1px solid color-mix(in oklab, ${tint} 25%, transparent)`,
    }}>
      {runStatusLabel(status)}
    </span>
  );
}

function RunCard({
  run,
  active,
  onSelect,
  compact,
}: {
  run: GenerationRun;
  active: boolean;
  onSelect: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        textAlign: "left", cursor: "pointer",
        padding: compact ? "8px 10px" : "12px 14px", borderRadius: 10,
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
        background: active ? "rgba(230,198,135,0.06)" : "rgba(255,255,255,0.015)",
        color: "var(--atlas-fg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <RunStatusBadge status={run.status} />
        <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)" }}>
          {fileCountLabel(fileCountForRun(run))}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: 9.5, color: "var(--atlas-muted)" }}>
          {formatDuration(run.durationMs)}
        </span>
      </div>
      <div style={{ fontSize: compact ? 12 : 14, fontWeight: 500, color: "var(--atlas-fg)", marginBottom: 4 }}>
        {runTitle(run)}
      </div>
      <p style={{ margin: 0, fontSize: compact ? 11.5 : 12.5, color: "var(--atlas-fg)", opacity: 0.8, lineHeight: 1.45 }}>
        {run.summary || "Build session"}
      </p>
    </button>
  );
}

function RunList({
  runs,
  activeRunId,
  loading,
  onSelectRun,
}: {
  runs: GenerationRun[];
  activeRunId: string | null;
  loading: boolean;
  onSelectRun: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Activity size={14} style={{ color: "var(--atlas-gold)" }} />
        <span style={{ ...MONO, fontSize: 10, letterSpacing: "0.16em", color: "var(--atlas-muted)", textTransform: "uppercase" }}>
          Runs
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)" }}>{runs.length}</span>
      </div>
      {runs.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              active={run.id === activeRunId}
              onSelect={() => onSelectRun(run.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={loading ? "Loading generation workspace…" : "Runs"}
          hint={loading ? "Fetching runs from the backend." : "No runs returned yet."}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div style={{
      padding: "8px 10px", borderRadius: 8,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.04)",
      textAlign: "center",
    }}>
      <div style={{ ...MONO, fontSize: 14, fontWeight: 500, color: tint ?? "var(--atlas-gold)" }}>{value}</div>
      <div style={{ ...MONO, fontSize: 9, letterSpacing: "0.14em", color: "var(--atlas-muted)", textTransform: "uppercase", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function CodePage() {
  const [, navigate] = useLocation();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [showRail, setShowRail] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePane, setMobilePane] = useState<MobilePane>("Code");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(getRunIdFromUrl());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [isPushingGithub, setIsPushingGithub] = useState(false);
  const [showForgeSync, setShowForgeSync] = useState(false);

  const projectId = useMemo(() => getProjectIdFromUrl(), []);
  const codegen = useCodegen({
    projectId: projectId ?? 0,
    onResult: (file: CodegenFile) => {
      // Add the generated file to local state as a preview
      const tempFile = {
        id: `codegen-${Date.now()}`,
        runId: "codegen",
        path: file.filename,
        language: file.language,
        bytes: new Blob([file.content]).size,
        lines: file.content.split("\n").length,
        content: file.content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: "new" as const,
        previousContent: null,
      };
      setEdits((prev) => ({ ...prev, [tempFile.id]: file.content }));
      setSelectedFileId(tempFile.id);
      toast.success(`Generated ${file.filename}`);
    },
    onError: (msg: string) => {
      toast.error(msg);
    },
  });

  const handleBack = () => {
    if (projectId != null) {
      navigate(`/project/${projectId}`);
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/");
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const updateIsMobile = () => setIsMobile(mediaQuery.matches);

    updateIsMobile();
    mediaQuery.addEventListener("change", updateIsMobile);
    window.addEventListener("resize", updateIsMobile);

    return () => {
      mediaQuery.removeEventListener("change", updateIsMobile);
      window.removeEventListener("resize", updateIsMobile);
    };
  }, []);

  // Persist projectId for return visits
  useEffect(() => {
    if (projectId != null) window.localStorage.setItem("atlas:lastProjectId", String(projectId));
  }, [projectId]);

  // 1. Project
  const projectQ = useQuery<ProjectStub>({
    queryKey: ["code", "project", projectId],
    queryFn: () => fetchJson<ProjectStub>(`/api/projects/${projectId}`),
    enabled: projectId != null,
    staleTime: 60_000,
  });
  const githubPushToken = useGithubPushToken(projectQ.data?.githubToken);
  const linkedRepo = useMemo(
    () => parseLinkedRepo(projectQ.data?.linkedRepo ?? projectQ.data?.repo ?? null),
    [projectQ.data?.linkedRepo, projectQ.data?.repo],
  );

  // 2. Runs
  const runsQ = useQuery<RunsResponse>({
    queryKey: ["code", "runs", projectId],
    queryFn: () => fetchJson<RunsResponse>(`/api/projects/${projectId}/generation-runs`),
    enabled: projectId != null,
    refetchInterval: 10_000,
  });

  const runs = useMemo(() => {
    const rawRuns = runsQ.data ?? [];
    return [...rawRuns].sort((a, b) => {
      const aTime = new Date(runUpdatedAt(a)).getTime();
      const bTime = new Date(runUpdatedAt(b)).getTime();
      return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
    });
  }, [runsQ.data]);

  const activeRun = useMemo(() => {
    if (!runs.length) return null;
    if (selectedRunId) return runs.find((r) => r.id === selectedRunId) ?? runs[0];
    return runs[0];
  }, [runs, selectedRunId]);

  // 3. Files for the selected run
  const filesQ = useQuery<GeneratedFile[]>({
    queryKey: ["code", "run-files", projectId, activeRun?.id],
    queryFn: () => {
      if (projectId == null || !activeRun) return Promise.resolve([] as GeneratedFile[]);
      return fetchJson<GeneratedFile[]>(`/api/projects/${projectId}/generation-runs/${activeRun.id}/files`);
    },
    enabled: projectId != null && !!activeRun?.id,
  });


  const files = useMemo(() => filesQ.data ?? [], [filesQ.data]);
  const forgeSyncFiles = useMemo(
    () => files.map((file) => (
      Object.prototype.hasOwnProperty.call(edits, file.id)
        ? { ...file, content: edits[file.id] ?? "" }
        : file
    )),
    [edits, files],
  );
  const selectedFile = useMemo(() => {
    if (!files.length) return null;
    return files.find((f) => f.id === selectedFileId) ?? files[0];
  }, [files, selectedFileId]);

  const tree = useMemo(() => buildTree(files), [files]);
  const toggleOpen = (p: string) =>
    setOpenMap((m) => ({ ...m, [p]: !(m[p] ?? true) }));

  // Loading / error / empty states
  const loading = projectQ.isLoading || runsQ.isLoading || (!!activeRun && filesQ.isLoading);
  const error = projectQ.error || runsQ.error || filesQ.error;
  const isStreaming = false;
  const handleSelectRun = (id: string) => {
    setSelectedRunId(id);
    setSelectedFileId(null);
    if (isMobile) setMobilePane("Files");
  };

  const selectedFileValue = selectedFile
    ? edits[selectedFile.id] ?? selectedFile.content
    : "";

  const handleDownloadZip = async () => {
    if (!activeRun || files.length === 0) {
      toast.error("No files available to download.");
      return;
    }

    setIsDownloadingZip(true);
    try {
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.path, edits[file.id] ?? file.content ?? "");
      }

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${projectQ.data?.name || "atlas"}-run-${activeRun.id.slice(0, 8)}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Downloaded ${files.length} file${files.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast.error(e instanceof Error ? `Download failed: ${e.message}` : "Download failed.");
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handlePushToGithub = async () => {
    if (!activeRun || files.length === 0) {
      toast.error("No files available to push.");
      return;
    }
    if (!linkedRepo) {
      toast.error("No linked GitHub repository found for this project.");
      return;
    }
    if (!githubPushToken) {
      toast.error("GitHub token not found. Add it in the Connections tab.");
      return;
    }

    setIsPushingGithub(true);
    const branch = `atlas/run-${activeRun.id.slice(0, 8)}-${Date.now().toString(36).slice(-4)}`;
    try {
      const branchRes = await fetch("/api/github/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": githubPushToken },
        credentials: "include",
        body: JSON.stringify({
          repo: linkedRepo.fullName,
          branch,
          baseBranch: linkedRepo.defaultBranch,
        }),
      });
      if (!branchRes.ok) {
        const body = await branchRes.json().catch(() => ({})) as { error?: string; detail?: string };
        throw new Error(body.error ?? body.detail ?? `Branch creation failed: HTTP ${branchRes.status}`);
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const commitRes = await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": githubPushToken },
          credentials: "include",
          body: JSON.stringify({
            repo: linkedRepo.fullName,
            branch,
            path: file.path,
            content: edits[file.id] ?? file.content ?? "",
            message: files.length === 1
              ? `Atlas: update ${file.path.split("/").pop() ?? "generated file"}`
              : `Atlas: update generation run ${activeRun.id.slice(0, 8)} (${i + 1}/${files.length})`,
          }),
        });
        if (!commitRes.ok) {
          const body = await commitRes.json().catch(() => ({})) as { error?: string; detail?: string };
          throw new Error(body.error ?? body.detail ?? `Commit failed for ${file.path}: HTTP ${commitRes.status}`);
        }
      }

      toast.success(`Pushed ${files.length} file${files.length === 1 ? "" : "s"} to ${linkedRepo.fullName}:${branch}`);
    } catch (e) {
      toast.error(e instanceof Error ? `GitHub push failed: ${e.message}` : "GitHub push failed.");
    } finally {
      setIsPushingGithub(false);
    }
  };

  const handleOpenForgeSync = () => {
    if (projectId == null) {
      toast.error("Select a project before opening Forge Sync.");
      return;
    }
    if (!activeRun) {
      toast.error("No active generation run available for Forge Sync.");
      return;
    }

    setShowForgeSync(true);
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100dvh", maxHeight: "100dvh",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      background: "var(--atlas-bg)", color: "var(--atlas-fg)", overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)",
        width: 800, height: 400, pointerEvents: "none",
        background: "radial-gradient(ellipse at center top, rgba(230,198,135,0.08), transparent 70%)",
      }} />

      {/* Top bar */}
      <header style={{
        position: "relative", zIndex: 10,
        display: "flex", alignItems: "center", gap: 12, padding: "12px 18px",
        flexWrap: isMobile ? "wrap" : undefined, rowGap: isMobile ? 8 : undefined,
        borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
        background: "color-mix(in oklab, var(--atlas-surface) 70%, transparent)",
        backdropFilter: "blur(14px)",
      }}>
        <button
          onClick={handleBack}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px",
            background: "transparent", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, color: "var(--atlas-muted)", cursor: "pointer", fontSize: 12,
          }}
        >
          <ArrowLeft size={13} /> Back
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: "linear-gradient(135deg, rgba(230,198,135,0.22), rgba(230,198,135,0.06))",
            border: "1px solid rgba(230,198,135,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "var(--atlas-gold)",
          }}>
            <Code2 size={15} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em" }}>
              Generation Workspace
            </span>
            <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)", letterSpacing: "0.04em" }}>
              {projectQ.data
                ? `${projectQ.data.name}${projectQ.data.repo ? ` · ${projectQ.data.repo}` : ""}`
                : projectId == null
                  ? "No project selected"
                  : `Project #${projectId}`}
            </span>
          </div>
        </div>

        <span style={{ flex: 1 }} />

        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 99,
          background: isStreaming ? "rgba(124,227,160,0.08)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${isStreaming ? "rgba(124,227,160,0.25)" : "rgba(255,255,255,0.08)"}`,
          color: isStreaming ? "#7CE3A0" : "var(--atlas-muted)",
          fontSize: 11, ...MONO, letterSpacing: "0.06em",
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: 99,
            background: isStreaming ? "#7CE3A0" : "rgba(255,255,255,0.4)",
            boxShadow: isStreaming ? "0 0 8px #7CE3A0" : "none",
          }} />
          {isStreaming ? "STREAMING" : "MIRRORING CHAT"}
        </div>

        <ToolButton
          icon={<RefreshCw size={13} />}
          label="Refresh"
          onClick={() => { runsQ.refetch(); filesQ.refetch(); }}
        />
        <ToolButton
          icon={<Wand2 size={13} />}
          label={codegen.running ? "Generating…" : "Regenerate"}
          disabled={codegen.running || !activeRun}
          onClick={() => {
            if (!activeRun) return;
            void codegen.run(activeRun.prompt, activeRun.summary || undefined);
          }}
        />
        <ToolButton
          icon={<Hammer size={13} />}
          label="Forge Sync"
          onClick={handleOpenForgeSync}
        />
        <ToolButton
          icon={<Download size={13} />}
          label={isDownloadingZip ? "Downloading…" : "Download .zip"}
          onClick={() => { void handleDownloadZip(); }}
          disabled={isDownloadingZip}
        />
        <ToolButton
          icon={<Github size={13} />}
          label={isPushingGithub ? "Pushing…" : "Push to GitHub"}
          onClick={() => { void handlePushToGithub(); }}
          disabled={isPushingGithub}
          primary
        />
        <button
          onClick={() => setShowRail((v) => !v)}
          title="Toggle activity rail"
          style={{
            display: isMobile ? "none" : "inline-flex", alignItems: "center", justifyContent: "center",
            width: 30, height: 30, borderRadius: 7,
            background: showRail ? "rgba(230,198,135,0.1)" : "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            color: showRail ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer",
          }}
        >
          <Activity size={13} />
        </button>
      </header>

      {isMobile && (
        <div style={{
          position: "relative", zIndex: 9,
          padding: "8px 12px",
          borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
          background: "color-mix(in oklab, var(--atlas-surface) 70%, transparent)",
          backdropFilter: "blur(14px)",
        }}>
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4,
            padding: 3, borderRadius: 10,
            background: "color-mix(in oklab, var(--atlas-surface) 92%, transparent)",
            border: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent)",
          }}>
            {(["Files", "Code", "Activity"] as MobilePane[]).map((pane) => {
              const active = mobilePane === pane;
              return (
                <button
                  key={pane}
                  type="button"
                  onClick={() => setMobilePane(pane)}
                  style={{
                    padding: "7px 10px", borderRadius: 8,
                    background: active
                      ? "linear-gradient(135deg, rgba(230,198,135,0.9), rgba(230,198,135,0.7))"
                      : "transparent",
                    border: active
                      ? "1px solid rgba(230,198,135,0.9)"
                      : "1px solid transparent",
                    color: active ? "#0B0A0F" : "var(--atlas-muted)",
                    cursor: "pointer", fontSize: 11, letterSpacing: "0.08em",
                    textTransform: "uppercase", ...MONO,
                    boxShadow: active ? "0 4px 14px rgba(230,198,135,0.18)" : "none",
                  }}
                >
                  {pane}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{
        flex: 1, minHeight: 0, display: "grid",
        gridTemplateColumns: isMobile ? "1fr" : showRail ? "260px 1fr 340px" : "260px 1fr",
        gap: 12, padding: 12, position: "relative", zIndex: 1,
      }}>
        {/* LEFT — file tree */}
        {(!isMobile || mobilePane === "Files") && (
        <aside style={{ ...PANEL, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{
            padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.05)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Layers size={13} style={{ color: "var(--atlas-gold)" }} />
            <span style={{ ...MONO, fontSize: 10, letterSpacing: "0.14em", color: "var(--atlas-muted)", textTransform: "uppercase" }}>
              Files
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ ...MONO, fontSize: 10, color: "var(--atlas-muted)" }}>{files.length}</span>
          </div>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 8px",
              background: "rgba(255,255,255,0.03)", borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              <Search size={11} style={{ color: "var(--atlas-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find file…"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "var(--atlas-fg)", fontSize: 12, ...MONO,
                }}
              />
            </div>
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "6px 6px 14px" }}>
            {selectedFile ? (
              <FileTree
                node={tree} depth={0}
                selectedPath={selectedFile.path}
                onSelect={(f) => setSelectedFileId(f.id)}
                openMap={openMap} toggleOpen={toggleOpen} query={query} edits={edits}
              />
            ) : (
              <EmptyHint label={loading ? "Loading files…" : "No files in this run yet."} />
            )}
          </div>
          {activeRun && (
            <div style={{
              padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center", gap: 6,
              ...MONO, fontSize: 10, color: "var(--atlas-muted)",
            }}>
              <Clock size={10} /> Updated {new Date(runUpdatedAt(activeRun)).toLocaleTimeString()}
            </div>
          )}
        </aside>
        )}

        {/* CENTER — viewer */}
        {(!isMobile || mobilePane === "Code") && (
        <main style={{ ...PANEL, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {error ? (
            <ErrorState message={(error as Error).message} onRetry={() => { runsQ.refetch(); filesQ.refetch(); }} />
          ) : projectId == null ? (
            <EmptyState
              title="No project selected"
              hint="Open this page with ?projectId=<id> or select a project from the workspace."
            />
          ) : !loading && runs.length === 0 ? (
            <EmptyState
              title="No generation runs yet"
              hint="This project hasn't been generated yet. Start a run from the Forge or send a build intent in chat."
            />
          ) : selectedFile ? (

            <CodeViewer
              file={selectedFile}
              value={selectedFileValue}
              isEdited={Object.prototype.hasOwnProperty.call(edits, selectedFile.id)}
              onChange={(next) => setEdits((current) => ({ ...current, [selectedFile.id]: next }))}
            />
          ) : (
            <RunList
              runs={runs}
              activeRunId={activeRun?.id ?? null}
              loading={loading}
              onSelectRun={handleSelectRun}
            />
          )}
        </main>
        )}

        {/* RIGHT — activity */}
        {((isMobile && mobilePane === "Activity") || (!isMobile && showRail)) && (
          <aside style={{ ...PANEL, overflow: "hidden" }}>
            {activeRun ? (
              <ActivityRail
                run={activeRun}
                files={files}
                runs={runs}
                onSelectRun={handleSelectRun}
              />
            ) : (
              <EmptyHint label={loading ? "Loading runs…" : "No runs to show."} />
            )}
          </aside>
        )}
      </div>

      {showForgeSync && projectId != null && activeRun && (
        <ForgeSyncPanel
          projectId={projectId}
          runId={activeRun.id}
          files={forgeSyncFiles}
          runSummary={activeRun.summary}
          onClose={() => setShowForgeSync(false)}
        />
      )}
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div style={{
      padding: 20, ...MONO, fontSize: 11, color: "var(--atlas-muted)",
      textAlign: "center",
    }}>
      {label}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8, padding: 24, textAlign: "center",
    }}>
      <Code2 size={28} style={{ color: "var(--atlas-gold)", opacity: 0.6 }} />
      <div style={{ fontSize: 14, color: "var(--atlas-fg)" }}>{title}</div>
      <div style={{ ...MONO, fontSize: 11, color: "var(--atlas-muted)", maxWidth: 360 }}>{hint}</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 10, padding: 24, textAlign: "center",
    }}>
      <AlertTriangle size={26} style={{ color: "#FF8A8A" }} />
      <div style={{ fontSize: 14, color: "var(--atlas-fg)" }}>Couldn't load this run</div>
      <div style={{ ...MONO, fontSize: 11, color: "var(--atlas-muted)", maxWidth: 420 }}>{message}</div>
      <button
        onClick={onRetry}
        style={{
          marginTop: 6, padding: "6px 12px", borderRadius: 8,
          background: "rgba(230,198,135,0.08)",
          border: "1px solid color-mix(in oklab, var(--atlas-gold) 22%, transparent)",
          color: "var(--atlas-gold)", cursor: "pointer", fontSize: 12,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}
      >
        <RefreshCw size={12} /> Retry
      </button>
    </div>
  );
}

function ToolButton({
  icon,
  label,
  primary,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500,
        background: primary
          ? "linear-gradient(135deg, rgba(230,198,135,0.9), rgba(230,198,135,0.7))"
          : "rgba(230,198,135,0.06)",
        border: primary
          ? "1px solid rgba(230,198,135,0.9)"
          : "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
        color: primary ? "#0B0A0F" : "var(--atlas-gold)",
        cursor: disabled ? "not-allowed" : "pointer", letterSpacing: "-0.005em",
        opacity: disabled ? 0.58 : 1,
        boxShadow: primary ? "0 4px 14px rgba(230,198,135,0.25)" : "none",
      }}
    >
      {icon} {label}
    </button>
  );
}
