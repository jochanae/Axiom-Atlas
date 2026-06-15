import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { updateProject, useUpdateProject, createProject, useCreateProject, useGetProject, getGetProjectQueryKey, useListProjects, getListProjectsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGitHub } from "@/hooks/useGitHub";
import { Switch } from "@/components/ui/switch";
import type { WorkspaceLens } from "@/hooks/useChatLens";
import {
  type LinkedRepo,
  type GhRepo,
  type GhTreeItem,
  type GhTreeNode,
  type GhFileContent,
  type GhCommitSummary,
  CommitHistoryCard,
} from "../../pages/workspace";
import {
  CommitHistorySkeleton,
  GhTreeNodeRow,
  buildTree,
} from "@/components/workspace/CommitHistory";
import { getLinkedRepoFullName, parseLinkedRepo, serializeLinkedRepo } from "@/lib/githubRepo";
import { getAuthHeaders } from "@/lib/api";

// ── Lens-aware file bucket helpers ─────────────────────────────────
const IMAGE_EXT = new Set(["png","jpg","jpeg","gif","webp","svg","ico","avif","bmp","heic"]);
const DOC_EXT   = new Set(["md","mdx","txt","pdf","doc","docx","rtf","csv","xlsx","xls"]);
const ARCH_EXT  = new Set(["zip","tar","gz","tgz","rar","7z"]);
function extOf(p: string) { const i = p.lastIndexOf("."); return i >= 0 ? p.slice(i+1).toLowerCase() : ""; }
function bucketOf(p: string): "images"|"docs"|"archives"|"code" {
  const e = extOf(p);
  if (IMAGE_EXT.has(e)) return "images";
  if (DOC_EXT.has(e))   return "docs";
  if (ARCH_EXT.has(e))  return "archives";
  return "code";
}

const RECENTS_CAP = 20;
function readRecents(projectId: number): string[] {
  try { return JSON.parse(localStorage.getItem(`atlas-recents-${projectId}`) ?? "[]") as string[]; } catch { return []; }
}
function pushRecent(projectId: number, path: string) {
  try {
    const cur = readRecents(projectId).filter(p => p !== path);
    cur.unshift(path);
    localStorage.setItem(`atlas-recents-${projectId}`, JSON.stringify(cur.slice(0, RECENTS_CAP)));
  } catch {}
}

const GITHUB_RECONNECT_MESSAGE = "GitHub token needs to be reconnected.";

function DbUrlInput({ projectId, onSave }: { projectId: number; onSave: (url: string) => void }) {
  const [value, setValue] = useState("");

  const save = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try { localStorage.setItem(`atlas-db-url-${projectId}`, trimmed); } catch {}
    onSave(trimmed);
    setValue("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        placeholder="postgres://user:pass@host/db"
        autoComplete="off"
        style={{
          width: "100%",
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          color: "var(--atlas-fg)",
          fontSize: 11,
          fontFamily: "var(--app-font-mono)",
          outline: "none",
          boxSizing: "border-box",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
      />
      <button
        type="button"
        disabled={!value.trim()}
        onClick={save}
        style={{
          padding: "7px",
          borderRadius: 6,
          background: value.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)",
          border: "none",
          color: value.trim() ? "#0D0B09" : "var(--atlas-muted)",
          fontSize: 10,
          fontFamily: "var(--app-font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: value.trim() ? "pointer" : "not-allowed",
        }}
      >
        Connect
      </button>
    </div>
  );
}

function githubHeaders(token: string | null): HeadersInit {
  return token ? { "x-github-token": token } : {};
}

function DatabaseConnectionSection({
  projectId,
  dbUrl,
  onDbUrlChange,
}: {
  projectId: number;
  dbUrl: string | null;
  onDbUrlChange: (url: string | null) => void;
}) {
  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--atlas-border)" }}>
      <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.13em", color: "var(--atlas-muted)", opacity: 0.65, textTransform: "uppercase", marginBottom: 8 }}>
        Database Connection
      </div>
      {dbUrl ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80", flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-fg)", opacity: 0.7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {dbUrl.replace(/:[^:@]*@/, ":***@")}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              const newUrl = prompt("Paste new PostgreSQL connection string (or leave blank to remove):");
              if (newUrl === null) return;
              if (!newUrl.trim()) {
                try { localStorage.removeItem(`atlas-db-url-${projectId}`); } catch {}
                onDbUrlChange(null);
              } else {
                try { localStorage.setItem(`atlas-db-url-${projectId}`, newUrl.trim()); } catch {}
                onDbUrlChange(newUrl.trim());
              }
            }}
            style={{ fontSize: 10, color: "var(--atlas-muted)", background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", alignSelf: "flex-start", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
          >
            Change
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6, lineHeight: 1.6 }}>
            Paste your project's Postgres connection string so Atlas can inspect its schema.
          </div>
          <DbUrlInput projectId={projectId} onSave={(url) => { onDbUrlChange(url); }} />
        </div>
      )}
    </div>
  );
}

export function FilesPanel({
  projectId,
  onFileContext,
  onLinkedRepoChange,
  dbUrl,
  onDbUrlChange,
  onZipTrigger,
  zipLoaded,
  zipFileName,
  onOpenConnections,
  wsLens: wsLensProp,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
  dbUrl: string | null;
  onDbUrlChange: (url: string | null) => void;
  onZipTrigger?: () => void;
  zipLoaded?: boolean;
  zipFileName?: string;
  onOpenConnections?: () => void;
  wsLens?: WorkspaceLens;
}) {
  // Live-subscribed lens: prefer prop, else read localStorage + listen for changes
  const [lensLocal, setLensLocal] = useState<WorkspaceLens>(() => {
    try { return (localStorage.getItem(`atlas-ws-lens-v2-${projectId}`) as WorkspaceLens) || "flow"; } catch { return "flow"; }
  });
  useEffect(() => {
    const key = `atlas-ws-lens-v2-${projectId}`;
    const onStorage = (e: StorageEvent) => { if (e.key === key && e.newValue) setLensLocal(e.newValue as WorkspaceLens); };
    const onCustom = () => { try { const v = localStorage.getItem(key) as WorkspaceLens | null; if (v) setLensLocal(v); } catch {} };
    window.addEventListener("storage", onStorage);
    window.addEventListener("atlas-lens-changed", onCustom);
    onCustom();
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("atlas-lens-changed", onCustom); };
  }, [projectId]);
  const wsLens: WorkspaceLens = wsLensProp ?? lensLocal;
  const updateProject = useUpdateProject();
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: filesProject } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: allProjects } = useListProjects();

  const {
    canRead,
    isLoading,
    error: githubConnectionError,
    statusLabel: githubStatusLabelFromHook,
    tokenHeader,
    connect,
  } = useGitHub(projectId);
  const [showModelPicker, setShowModelPicker] =
    useState(() =>
      localStorage.getItem("atlas-power-model-picker")
      === "1"
    );
  const [autoLinkStatus, setAutoLinkStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [autoLinkResult, setAutoLinkResult] = useState<{ linked: Array<{ projectName: string; repoFullName: string }>; skipped: string[] } | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [linkRepoError, setLinkRepoError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [tree, setTree] = useState<GhTreeNode[]>([]);
  const [flatFiles, setFlatFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState("main");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<GhFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const isConnected = !!filesProject?.linkedRepo || !!zipLoaded || !!dbUrl;
  const [view, setView] = useState<"repos" | "tree" | "file">(isConnected ? "tree" : "repos");
  const [filesSubTab, setFilesSubTab] = useState<"files" | "history">("files");
  const [commits, setCommits] = useState<GhCommitSummary[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [commitsReason, setCommitsReason] = useState<string | null>(null);
  const [unlinkRepoError, setUnlinkRepoError] = useState<string | null>(null);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const autoLoadedRef = useRef(false);
  const [oauthConnected, setOauthConnected] = useState(false);

  useEffect(() => {
    fetch("/api/github/status", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: any) => {
        if (data?.hasUserToken || data?.hasAccountToken) {
          setOauthConnected(true);
        }
      })
      .catch(() => {});
  }, []);

  const token = tokenHeader ?? (oauthConnected ? "__oauth__" : null);
  const canBrowseGitHub = canRead || oauthConnected;
  const githubStatusLabel = oauthConnected ? "GitHub connected" : githubStatusLabelFromHook;
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaveError, setTokenSaveError] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const importKey = `atlas-full-import-${projectId}`;
  const [importStatus, setImportStatus] = useState<"idle" | "importing" | "done" | "error">(() => {
    try { return localStorage.getItem(importKey) ? "done" : "idle"; } catch { return "idle"; }
  });
  const [importResult, setImportResult] = useState<{
    decisions: string[];
    tables: string[];
    stack: string[];
    ledgerEntriesCreated: number;
    summary: string | null;
  } | null>(() => {
    try {
      const raw = localStorage.getItem(importKey);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const [fileSearch, setFileSearch] = useState("");
  const [treeViewMode, setTreeViewMode] = useState<"tree" | "buckets">(() => (wsLens === "build" ? "tree" : "buckets"));
  const lastLensRef = useRef<WorkspaceLens>(wsLens);
  useEffect(() => {
    if (lastLensRef.current !== wsLens) {
      lastLensRef.current = wsLens;
      setTreeViewMode(wsLens === "build" ? "tree" : "buckets");
    }
  }, [wsLens]);
  const [recents, setRecents] = useState<string[]>(() => readRecents(projectId));
  useEffect(() => { setRecents(readRecents(projectId)); }, [projectId]);

  // Auto-jump out of the hub the moment a source is connected
  useEffect(() => {
    if (isConnected && view === "repos") setView("tree");
    if (!isConnected && view !== "repos") setView("repos");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  const runAutoScan = (repo: GhRepo, token: string) => {
    const scanKey = `atlas-scan-${projectId}`;
    setScanStatus("scanning");
    fetch("/api/github/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...githubHeaders(token) },
      body: JSON.stringify({ repo: repo.fullName, branch: repo.defaultBranch }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) { setScanStatus("error"); return; }
        try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
        setScanStatus("done");
        const lines = [
          `[Repo overview — ${data.repo}]`,
          `Stack: ${(data.stack as string[] || []).join(", ")}`,
          `Routes: ${(data.routes as string[] || []).slice(0, 12).join(", ")}`,
          `Pages: ${(data.pages as string[] || []).slice(0, 12).join(", ")}`,
          data.tables?.length ? `Tables: ${(data.tables as string[]).join(", ")}` : "",
          `Summary: ${data.summary}`,
        ].filter(Boolean);
        onFileContext(lines.join("\n"));
      })
      .catch(() => setScanStatus("error"));
  };

  const runFullImport = () => {
    if (importStatus === "importing") return;
    const token = selectedRepo
      ? (localStorage.getItem(`atlas-github-token-${projectId}`) || localStorage.getItem("atlas-github-token") || "__server__")
      : "__server__";
    setImportStatus("importing");
    fetch("/api/github/full-import", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
      body: JSON.stringify({ projectId }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const result = {
          decisions: data.decisions ?? [],
          tables: data.tables ?? [],
          stack: data.stack ?? [],
          ledgerEntriesCreated: data.ledgerEntriesCreated ?? 0,
          summary: data.summary ?? null,
        };
        try { localStorage.setItem(importKey, JSON.stringify(result)); } catch {}
        setImportResult(result);
        setImportStatus("done");
      })
      .catch(() => setImportStatus("error"));
  };

  // Reset auto-load gate when project switches
  useEffect(() => {
    autoLoadedRef.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView(isConnected ? "tree" : "repos");
    setFilesSubTab("files");
    setCommits([]);
    setCommitsError(null);
    setCommitsReason(null);
    setImportStatus(localStorage.getItem(`atlas-full-import-${projectId}`) ? "done" : "idle");
    setImportResult(null);
    onFileContext(null);
  }, [projectId]);

  const loadCommits = useCallback(async () => {
    setCommitsLoading(true);
    setCommitsError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/commits`, { credentials: "include" });
      const data = await res.json().catch(() => ({})) as { commits?: GhCommitSummary[]; reason?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCommits(data.commits ?? []);
      setCommitsReason(data.reason ?? null);
    } catch (e) {
      setCommits([]);
      setCommitsReason(null);
      setCommitsError(e instanceof Error ? e.message : "Could not load commits");
    } finally {
      setCommitsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (filesSubTab !== "history") return;
    void loadCommits();
  }, [filesSubTab, loadCommits]);

  const handleAutoLink = async () => {
    if (!token || autoLinkStatus === "running") return;
    setAutoLinkStatus("running");
    setAutoLinkResult(null);
    try {
      const res = await fetch("/api/github/auto-link", {
        method: "POST",
        headers: githubHeaders(token),
      });
      const data = await res.json() as any;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAutoLinkResult({ linked: data.linked ?? [], skipped: data.skipped ?? [] });
      setAutoLinkStatus("done");
      queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    } catch (e: any) {
      setAutoLinkStatus("error");
      setAutoLinkResult({ linked: [], skipped: [e.message ?? "Unknown error"] });
    }
  };

  const ghFetch = useCallback(async (path: string) => {
    const res = await fetch(path, { headers: githubHeaders(token) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error(GITHUB_RECONNECT_MESSAGE);
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setReposLoading(true);
    setReposError(null);
    ghFetch("/api/github/repos")
      .then((data) => setRepos(data as GhRepo[]))
      .catch((e) => setReposError(e.message))
      .finally(() => setReposLoading(false));
  }, [token, ghFetch]);

  const loadTree = useCallback(async (repo: GhRepo) => {
    setSelectedRepo(repo);
    setFilesSubTab("files");
    setView("tree");
    setTree([]);
    setTreeLoading(true);
    setTreeError(null);
    setSelectedPath(null);
    setFileContent(null);
    onFileContext(null);
    try {
      const data = await ghFetch(`/api/github/tree?repo=${encodeURIComponent(repo.fullName)}&branch=${repo.defaultBranch}`) as any;
      setRepoBranch(data.branch);
      const items = (data.tree as GhTreeItem[]).filter(i => i.type === "blob" || i.type === "tree");
      const nodes = buildTree(items);
      setTree(nodes);
      setFlatFiles(items.filter(i => i.type === "blob").map(i => ({
        path: i.path,
        name: i.path.split("/").pop() ?? i.path,
      })));
    } catch (e: any) {
      setTreeError(e.message);
    } finally {
      setTreeLoading(false);
    }
  }, [ghFetch, onFileContext]);

  // Auto-load linked repo once repos are available (from DB)
  useEffect(() => {
    if (autoLoadedRef.current || repos.length === 0 || !filesProject?.linkedRepo) return;
    const savedRepo = parseLinkedRepo(filesProject.linkedRepo);
    if (!savedRepo?.fullName) return;

    const match = repos.find(r => r.fullName.toLowerCase() === savedRepo.fullName.toLowerCase());
    if (!match) return;

    autoLoadedRef.current = true;
    loadTree(match);
    const scanKey = `atlas-scan-${projectId}`;
    try {
      const cached = localStorage.getItem(scanKey);
      if (cached) {
        const data = JSON.parse(cached) as { repo: string; stack: string[]; routes: string[]; pages: string[]; tables?: string[]; summary: string };
        const lines = [
          `[Repo overview — ${data.repo}]`,
          `Stack: ${(data.stack || []).join(", ")}`,
          `Routes: ${(data.routes || []).slice(0, 12).join(", ")}`,
          `Pages: ${(data.pages || []).slice(0, 12).join(", ")}`,
          data.tables?.length ? `Tables: ${data.tables.join(", ")}` : "",
          `Summary: ${data.summary}`,
        ].filter(Boolean);
        setScanStatus("done");
        onFileContext(lines.join("\n"));
      } else if (token) {
        runAutoScan(match, token);
      }
    } catch {
      if (token) runAutoScan(match, token);
    }
  }, [repos, filesProject?.linkedRepo, loadTree, onFileContext, projectId, token]);

  // Link a repo to this project and load its tree
  const pickRepo = useCallback((repo: GhRepo) => {
    setLinkRepoError(null);
    updateProject.mutate(
      { id: projectId, data: { linkedRepo: serializeLinkedRepo(repo) } },
      {
        onSuccess: () => {
          onLinkedRepoChange(repo);
          loadTree(repo);
          if (token) runAutoScan(repo, token);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.message ?? "Failed to link repo";
          setLinkRepoError(msg);
        },
      }
    );
  }, [projectId, updateProject, onLinkedRepoChange, loadTree, token]);

  // Unlink the repo from this project
  const unlinkRepo = useCallback(() => {
    setUnlinkRepoError(null);
    setIsUnlinking(true);
    updateProject.mutate(
      { id: projectId, data: { linkedRepo: null } },
      {
        onSuccess: () => {
          setIsUnlinking(false);
          onLinkedRepoChange(null);
          autoLoadedRef.current = false;
          setSelectedRepo(null);
          setTree([]);
          setSelectedPath(null);
          setFileContent(null);
          setView("repos");
          onFileContext(null);
        },
        onError: (err: any) => {
          setIsUnlinking(false);
          const msg = err?.response?.data?.error ?? err?.message ?? "Failed to unlink repo";
          setUnlinkRepoError(msg);
        },
      }
    );
  }, [projectId, updateProject, onLinkedRepoChange, onFileContext]);

  const loadFile = useCallback(async (path: string) => {
    if (!selectedRepo) return;
    setFilesSubTab("files");
    setSelectedPath(path);
    pushRecent(projectId, path);
    setRecents(readRecents(projectId));
    setView("file");
    setFileContent(null);
    setFileLoading(true);
    setFileError(null);
    onFileContext(null);
    try {
      const data = await ghFetch(
        `/api/github/file?repo=${encodeURIComponent(selectedRepo.fullName)}&path=${encodeURIComponent(path)}&branch=${repoBranch}`
      ) as GhFileContent;
      setFileContent(data);
      const ctx = `File: ${data.path} (${selectedRepo.fullName}, branch: ${repoBranch})\n\`\`\`\n${data.content}\n\`\`\``;
      onFileContext(ctx);
    } catch (e: any) {
      setFileError(e.message);
    } finally {
      setFileLoading(false);
    }
  }, [selectedRepo, repoBranch, ghFetch, onFileContext]);

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
  const sMuted = { color: "var(--atlas-muted)", ...sMono };
  const onShowModelPickerChange = (checked: boolean) => {
    if (checked) {
      localStorage.setItem("atlas-power-model-picker", "1");
      setShowModelPicker(true);
    } else {
      localStorage.removeItem("atlas-power-model-picker");
      setShowModelPicker(false);
    }
  };
  const saveToken = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setTokenSaveError(null);
    const connected = await connect(trimmed);
    if (connected) {
      setTokenInput("");
      return;
    }
    setTokenSaveError(githubConnectionError ?? "Failed to save token");
  }, [connect, githubConnectionError]);
  const modelPickerToggleRow = (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--atlas-border)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.08em", color: "var(--atlas-fg)", opacity: 0.75 }}>
            Manual model selection
          </div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 2 }}>
            Show model picker in message bar
          </div>
        </div>
        <Switch
          checked={showModelPicker}
          onCheckedChange={onShowModelPickerChange}
        />
      </div>
    </div>
  );

  if (!canBrowseGitHub) {
    if (isLoading) return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.5 }}>connecting…</div>
      </div>
    );
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 14 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" opacity={0.25}>
          <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 6.8c.85.004 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" fill="var(--atlas-fg)" /></svg>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.7, fontWeight: 500, marginBottom: 5 }}>Connect GitHub</div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6, opacity: 0.6 }}>
            Connect your GitHub account to link repos<br />and enable AI write-back across all projects.
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              const { stashOauthReturn } = await import("@/lib/oauthReturn");
              stashOauthReturn();
              const res = await fetch("/api/github/oauth/start", {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json" },
              });
              if (res.status === 401) {
                // Not logged in — send to login
                window.location.href = "/login?reason=session_expired";
                return;
              }
              const data = await res.json();
              if (data.url) {
                window.location.href = data.url;
              } else {
                alert("Failed to start GitHub connection");
              }
            } catch (err) {
              alert("Network error. Try again.");
            }
          }}
          style={{
            display: "block",
            padding: "8px 14px",
            borderRadius: 6,
            background: "rgba(201,162,76,0.12)",
            color: "#C9A24C",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            border: "none",
            fontFamily: "var(--app-font-mono)",
          }}
        >
          Connect via GitHub →
        </button>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center", fontFamily: "var(--app-font-mono)" }}>or paste a personal access token</div>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setTokenSaveError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) saveToken(tokenInput.trim()); }}
            placeholder="ghp_…"
            autoComplete="off"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              background: "var(--atlas-surface)",
              border: `1px solid ${tokenSaveError ? "rgba(239,68,68,0.5)" : "var(--atlas-border)"}`,
              color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
              outline: "none", boxSizing: "border-box", transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = tokenSaveError ? "rgba(239,68,68,0.5)" : "rgba(201,162,76,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = tokenSaveError ? "rgba(239,68,68,0.5)" : "var(--atlas-border)")}
          />
          {tokenSaveError && (
            <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4, marginTop: -2 }}>{tokenSaveError}</div>
          )}
          <button
            type="button"
            onClick={() => tokenInput.trim() && saveToken(tokenInput.trim())}
            disabled={!tokenInput.trim()}
            style={{
              padding: "7px", borderRadius: 6, width: "100%",
              background: tokenInput.trim() ? "var(--atlas-ember)" : "var(--atlas-surface)",
              border: "none", color: "var(--atlas-fg)", fontSize: 10,
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: tokenInput.trim() ? "pointer" : "not-allowed",
              transition: "background 160ms ease",
            }}
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header breadcrumb */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <button
          onClick={() => { setFilesSubTab("files"); setView("repos"); setSelectedRepo(null); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: view === "repos" ? "rgba(201,162,76,0.08)" : "rgba(255,255,255,0.04)",
            border: `0.5px solid ${view === "repos" ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`,
            borderRadius: 4, cursor: "pointer", padding: "3px 7px",
            color: view === "repos" ? "var(--atlas-gold)" : "var(--atlas-fg)",
            fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
            flexShrink: 0, opacity: view === "repos" ? 1 : 0.75,
          }}
          title="Connect or switch source"
        >
          {view === "repos" ? "sources" : "+ source"}
        </button>

        {selectedRepo && (
          <>
            <span style={{ color: "var(--atlas-border)", fontSize: 10, flexShrink: 0 }}>/</span>
            <button
              onClick={() => { setFilesSubTab("files"); setView("tree"); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: view === "tree" ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: view === "tree" ? 1 : 0.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 90 }}
            >
              {selectedRepo.name}
            </button>
            {/* Linked badge + unlink */}
            <span
              title="Linked to this project — auto-loads next time"
              style={{
                display: "inline-flex", alignItems: "center", gap: 3,
                padding: "1px 5px", borderRadius: 3, flexShrink: 0,
                background: "rgba(52,211,153,0.07)",
                border: "0.5px solid rgba(52,211,153,0.2)",
              }}
            >
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
              <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "#34d399" }}>linked</span>
            </span>
            {scanStatus === "scanning" && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 5px", borderRadius: 3, flexShrink: 0, background: "rgba(201,162,76,0.07)", border: "0.5px solid rgba(201,162,76,0.2)" }}>
                <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, opacity: 0.7, animation: "pulse 1.2s ease-in-out infinite" }} />
                <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-gold)", opacity: 0.8 }}>analyzing…</span>
              </span>
            )}
            {scanStatus === "done" && (
              <span title="Repo structure analyzed and injected into chat context" style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "1px 5px", borderRadius: 3, flexShrink: 0, background: "rgba(201,162,76,0.07)", border: "0.5px solid rgba(201,162,76,0.2)" }}>
                <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-gold)" }}>◆ mapped</span>
              </span>
            )}
          </>
        )}
        {selectedPath && (
          <>
            <span style={{ color: "var(--atlas-border)", fontSize: 10, flexShrink: 0 }}>/</span>
            <span style={{ color: "var(--atlas-gold)", fontSize: 10, fontFamily: "var(--app-font-mono)", opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 80 }}>
              {selectedPath.split("/").pop()}
            </span>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {selectedRepo && (
            <button
              onClick={unlinkRepo}
              disabled={isUnlinking}
              title="Unlink repo from this project"
              style={{ background: "transparent", border: "none", cursor: isUnlinking ? "default" : "pointer", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", opacity: isUnlinking ? 0.55 : 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => { if (!isUnlinking) e.currentTarget.style.opacity = "0.8"; }}
              onMouseLeave={(e) => { if (!isUnlinking) e.currentTarget.style.opacity = "0.35"; }}
            >
              {isUnlinking ? "unlinking…" : "unlink"}
            </button>
          )}
          <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: githubStatusLabel === "GitHub connected" ? "#34d399" : "var(--atlas-gold)", opacity: 0.75 }}>
            {githubStatusLabel}
          </span>
        </div>
      </div>

      {selectedRepo && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          {(["files", "history"] as const).map((tab) => {
            const active = filesSubTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setFilesSubTab(tab)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--atlas-gold)" : "var(--atlas-border)"}`,
                  background: active ? "rgba(var(--atlas-gold-rgb),0.10)" : "transparent",
                  color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 9.5,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                {tab === "files" ? "Files" : "Commits"}
              </button>
            );
          })}
          {filesSubTab === "history" && (
            <button
              type="button"
              onClick={() => void loadCommits()}
              aria-label="Refresh commit history"
              disabled={commitsLoading}
              style={{
                marginLeft: "auto",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid var(--atlas-border)",
                background: "transparent",
                color: "var(--atlas-muted)",
                cursor: commitsLoading ? "default" : "pointer",
                opacity: commitsLoading ? 0.45 : 0.8,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ↻
            </button>
          )}
        </div>
      )}

      {/* Inline errors for unlink */}
      {unlinkRepoError && (
        <div style={{ margin: "4px 6px 0", padding: "6px 10px", borderRadius: 5, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ flexShrink: 0, opacity: 0.7 }}>✕</span>
          <span>{unlinkRepoError}</span>
        </div>
      )}

      {filesSubTab === "history" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 10px 14px" }} className="scrollbar-none">
          {commitsLoading ? (
            <CommitHistorySkeleton />
          ) : commitsError ? (
            <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--atlas-ember)", fontSize: 11, fontFamily: "var(--app-font-mono)", lineHeight: 1.5 }}>
              {commitsError}
            </div>
          ) : commits.length === 0 ? (
            <div style={{ padding: "34px 12px", textAlign: "center", color: "var(--atlas-muted)", fontSize: 12, lineHeight: 1.6 }}>
              {commitsReason === "no_repo" ? "No commits yet. Link a GitHub repo to see history." : "No commits yet."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {commits.map((commit, i) => <CommitHistoryCard key={commit.sha} commit={commit} projectId={projectId} canRevert={i !== commits.length - 1} />)}
            </div>
          )}
        </div>
      )}

      {/* Repos list — Luxury Obsidian dashboard layout */}
      {filesSubTab === "files" && view === "repos" && (() => {
        const linkedFullName = getLinkedRepoFullName(filesProject?.linkedRepo);
        const linkedRepo = repos.find(r => r.fullName === linkedFullName) ?? null;
        const glassCard: React.CSSProperties = {
          background: "rgba(10,10,10,0.55)",
          backdropFilter: "blur(20px) saturate(140%)",
          border: "1px solid rgba(38,38,38,0.85)",
          borderRadius: 16,
          transition: "border-color 240ms ease, background 240ms ease",
        };
        const sectionLabel: React.CSSProperties = {
          fontSize: 10,
          fontFamily: "var(--app-font-mono)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          fontWeight: 700,
          color: "var(--atlas-muted)",
          opacity: 0.85,
        };
        const goldGradient: React.CSSProperties = {
          background: "linear-gradient(90deg, #fde68a 0%, #facc15 45%, #c9a24c 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        };

        const browseHub: Array<{ key: string; idx: string; label: string; sub: string; onClick: () => void; active?: boolean }> = [
          {
            key: "repos",
            idx: "01",
            label: "Active Repos",
            sub: `${repos.length} connected`,
            onClick: () => {},
            active: true,
          },
          {
            key: "zip",
            idx: "02",
            label: zipLoaded ? "ZIP Loaded" : "Upload ZIP",
            sub: zipLoaded ? (zipFileName ?? "Active") : "No repo needed",
            onClick: () => onZipTrigger?.(),
            active: !!zipLoaded,
          },
          {
            key: "db",
            idx: "03",
            label: dbUrl ? "Database Linked" : "Database",
            sub: dbUrl ? "Connected" : "Connect Postgres",
            onClick: () => {
              const el = document.getElementById(`atlas-db-section-${projectId}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            },
            active: !!dbUrl,
          },
        ];

        return (
          <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 20px", display: "flex", flexDirection: "column", gap: 22 }} className="scrollbar-none">

            {/* ── 1. BROWSE HUB ────────────────────────────────────────── */}
            <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 style={{ ...sectionLabel, ...goldGradient, margin: 0, fontWeight: 700 }}>Browse Hub</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                {browseHub.map((card) => (
                  <button
                    key={card.key}
                    type="button"
                    onClick={card.onClick}
                    style={{
                      ...glassCard,
                      padding: 12,
                      textAlign: "left",
                      cursor: "pointer",
                      position: "relative",
                      overflow: "hidden",
                      minWidth: 0,
                      borderColor: card.active ? "rgba(201,162,76,0.35)" : "rgba(38,38,38,0.85)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = card.active ? "rgba(201,162,76,0.35)" : "rgba(38,38,38,0.85)"; }}
                  >
                    <span style={{
                      position: "absolute", top: -20, right: -20, width: 80, height: 80,
                      borderRadius: "50%", background: "rgba(201,162,76,0.08)", filter: "blur(28px)", pointerEvents: "none",
                    }} />
                    <div style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.55, letterSpacing: "0.1em", marginBottom: 4 }}>
                      {card.idx}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 400, color: "var(--atlas-fg)", letterSpacing: "-0.01em", lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {card.sub}
                    </div>
                  </button>
                ))}
              </div>

            </section>

            {/* Auto-link banner */}
            {!reposLoading && repos.length > 0 && (allProjects ?? []).some(p => !p.linkedRepo) && (
              <div style={{ ...glassCard, padding: "10px 14px", borderColor: "rgba(201,162,76,0.2)" }}>
                {autoLinkStatus !== "done" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.4, opacity: 0.8 }}>
                      {(allProjects ?? []).filter(p => !p.linkedRepo).length} project{(allProjects ?? []).filter(p => !p.linkedRepo).length !== 1 ? "s" : ""} need a repo
                    </div>
                    <button
                      onClick={handleAutoLink}
                      disabled={autoLinkStatus === "running"}
                      style={{
                        flexShrink: 0, padding: "5px 11px", borderRadius: 6,
                        background: "rgba(201,162,76,0.14)",
                        border: "1px solid rgba(201,162,76,0.35)",
                        color: "var(--atlas-gold)", fontSize: 10, fontFamily: "var(--app-font-mono)",
                        letterSpacing: "0.06em", cursor: autoLinkStatus === "running" ? "not-allowed" : "pointer",
                        opacity: autoLinkStatus === "running" ? 0.6 : 1,
                      }}
                    >
                      {autoLinkStatus === "running" ? "Linking…" : "Auto-link all →"}
                    </button>
                  </div>
                )}
                {autoLinkStatus === "done" && autoLinkResult && (
                  <div style={{ fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.7 }}>
                    {autoLinkResult.linked.length > 0 && (
                      <div style={{ color: "#34d399" }}>✓ Linked: {autoLinkResult.linked.map(l => l.projectName).join(", ")}</div>
                    )}
                    {autoLinkResult.skipped.length > 0 && (
                      <div style={{ color: "var(--atlas-muted)", opacity: 0.65 }}>— No match: {autoLinkResult.skipped.join(", ")}</div>
                    )}
                    {autoLinkResult.linked.length === 0 && autoLinkResult.skipped.length === 0 && (
                      <div style={{ color: "var(--atlas-muted)" }}>All projects already linked.</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {reposLoading && (
              <div style={{ padding: "32px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>Loading repos…</div>
            )}
            {reposError && (
              <div style={{ padding: "20px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                <span>{reposError}</span>
                {reposError === GITHUB_RECONNECT_MESSAGE && (
                  <button type="button" onClick={onOpenConnections} style={{ padding: "7px 12px", borderRadius: 6, background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer" }}>
                    Open connections
                  </button>
                )}
              </div>
            )}
            {linkRepoError && (
              <div style={{ padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10.5, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)" }}>
                {linkRepoError}
              </div>
            )}

            {/* ── 2. FEATURED ASSETS ───────────────────────────────────── */}
            {!reposLoading && linkedRepo && (
              <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <h2 style={{ ...sectionLabel, margin: 0 }}>Featured</h2>
                  <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", opacity: 0.8 }}>Visual View</span>
                </div>
                <button
                  type="button"
                  onClick={() => pickRepo(linkedRepo)}
                  style={{ ...glassCard, aspectRatio: "16 / 9", padding: 4, display: "flex", flexDirection: "column", justifyContent: "space-between", cursor: "pointer", textAlign: "left", overflow: "hidden", position: "relative" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(38,38,38,0.85)"; }}
                >
                  <div style={{
                    flex: 1, borderRadius: 12,
                    background: "linear-gradient(135deg, rgba(201,162,76,0.08) 0%, rgba(10,10,10,0.9) 60%, rgba(0,0,0,0.95) 100%)",
                    border: "1px solid rgba(38,38,38,0.6)",
                    position: "relative", overflow: "hidden",
                  }}>
                    <div style={{ position: "absolute", inset: 0, background: "radial-gradient(circle at 20% 20%, rgba(201,162,76,0.15), transparent 50%)" }} />
                    <div style={{ position: "absolute", bottom: 10, left: 14, fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                      {linkedRepo.defaultBranch} · {linkedRepo.language ?? "—"}
                    </div>
                  </div>
                  <div style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{linkedRepo.name}</p>
                      <p style={{ margin: "2px 0 0", fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>Linked Repository</p>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 9, color: "#34d399", padding: "3px 9px", background: "rgba(52,211,153,0.1)", borderRadius: 999, border: "1px solid rgba(52,211,153,0.25)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em" }}>Live</span>
                  </div>
                </button>
              </section>
            )}

            {/* ── 3. ALL FILES (Repos dense grid) ──────────────────────── */}
            {!reposLoading && repos.length > 0 && (
              <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "1px solid rgba(38,38,38,0.7)", paddingBottom: 8 }}>
                  <h2 style={{ ...sectionLabel, margin: 0 }}>All Repositories</h2>
                  <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6 }}>Data Density</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                  {repos.map((repo) => {
                    const isLinked = linkedFullName === repo.fullName;
                    const emblem = (repo.language ?? repo.name).charAt(0).toUpperCase();
                    return (
                      <div
                        key={repo.id}
                        style={{
                          ...glassCard,
                          padding: 12,
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          borderColor: isLinked ? "rgba(52,211,153,0.28)" : "rgba(38,38,38,0.85)",
                          background: isLinked ? "rgba(52,211,153,0.04)" : "rgba(10,10,10,0.55)",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => pickRepo(repo)}
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 12, background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
                        >
                          {/* Glowing emblem */}
                          <div style={{
                            width: 38, height: 38, borderRadius: 10,
                            background: "rgba(201,162,76,0.06)",
                            border: "1px solid rgba(201,162,76,0.22)",
                            boxShadow: "0 0 14px rgba(201,162,76,0.06)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                          }}>
                            <span style={{ fontSize: 13, fontFamily: "var(--app-font-mono)", fontWeight: 700, color: "var(--atlas-gold)" }}>{emblem}</span>
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              {isLinked && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />}
                              <span style={{ fontSize: 13, color: "var(--atlas-fg)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.name}</span>
                              {repo.private && (
                                <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 3, background: "rgba(120,113,108,0.15)", color: "var(--atlas-muted)", border: "0.5px solid rgba(120,113,108,0.25)", flexShrink: 0 }}>private</span>
                              )}
                            </div>
                            <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.55, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {repo.language ?? "—"}{repo.description ? ` · ${repo.description}` : ""}
                            </div>
                          </div>
                        </button>
                        <button
                          title={`Create a new Axiom project for ${repo.name}`}
                          onClick={() => {
                            createProject.mutate(
                              { data: { name: repo.name } },
                              {
                                onSuccess: (newProject) => {
                                  const repoJson = serializeLinkedRepo(repo);
                                  updateProject.mutate(
                                    { id: newProject.id, data: { linkedRepo: repoJson } },
                                    {
                                      onSuccess: () => {
                                        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                                        navigate(`/project/${newProject.id}`);
                                      },
                                    }
                                  );
                                },
                              }
                            );
                          }}
                          disabled={createProject.isPending}
                          style={{
                            flexShrink: 0, display: "flex", alignItems: "center", gap: 4,
                            padding: "6px 9px", borderRadius: 6,
                            background: "rgba(201,162,76,0.06)",
                            border: "1px solid rgba(201,162,76,0.22)",
                            cursor: createProject.isPending ? "not-allowed" : "pointer",
                            color: "rgba(201,162,76,0.85)",
                            opacity: createProject.isPending ? 0.4 : 1,
                          }}
                        >
                          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M6 1v10M1 6h10" />
                          </svg>
                          <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em" }}>project</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        );
      })()}

      {/* File tree */}
      {filesSubTab === "files" && view === "tree" && (
        <>
          {selectedRepo && (
            <div style={{
              margin: "8px 10px",
              borderRadius: 8,
              border: `1px solid ${importStatus === "done" ? "rgba(201,162,76,0.25)" : "rgba(255,255,255,0.06)"}`,
              background: importStatus === "done" ? "rgba(201,162,76,0.04)" : "rgba(255,255,255,0.02)",
              padding: "10px 12px",
              flexShrink: 0,
            }}>
              {importStatus === "idle" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 2 }}>
                      Deep Import
                    </div>
                    <div style={{ fontSize: 10, color: "var(--atlas-muted)", lineHeight: 1.4 }}>
                      Atlas reads your repo and seeds your ledger with the architectural decisions already made.
                    </div>
                  </div>
                  <button
                    onClick={runFullImport}
                    style={{
                      flexShrink: 0,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px solid rgba(201,162,76,0.35)",
                      background: "rgba(201,162,76,0.1)",
                      color: "var(--atlas-gold)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Import
                  </button>
                </div>
              )}

              {importStatus === "importing" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "var(--atlas-gold)", opacity: 0.7,
                    animation: "pulse 1.2s ease-in-out infinite", flexShrink: 0,
                  }} />
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 1 }}>
                      Analyzing repo…
                    </div>
                    <div style={{ fontSize: 10, color: "var(--atlas-muted)" }}>
                      Reading files and extracting decisions. This takes ~20 seconds.
                    </div>
                  </div>
                </div>
              )}

              {importStatus === "done" && importResult && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: "var(--atlas-gold)", fontWeight: 700, letterSpacing: "0.06em" }}>◆ IMPORTED</span>
                    <span style={{ fontSize: 9, color: "var(--atlas-muted)" }}>
                      {importResult.ledgerEntriesCreated} decision{importResult.ledgerEntriesCreated !== 1 ? "s" : ""} added to ledger
                    </span>
                    <button
                      onClick={runFullImport}
                      title="Re-run full import"
                      style={{
                        marginLeft: "auto", background: "transparent", border: "none",
                        cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9,
                        fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", opacity: 0.5,
                        padding: "2px 4px",
                      }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = "0.5"; }}
                    >
                      re-import
                    </button>
                  </div>
                  {importResult.summary && (
                    <p style={{ fontSize: 10, color: "var(--atlas-muted)", lineHeight: 1.5, margin: "0 0 6px" }}>
                      {importResult.summary}
                    </p>
                  )}
                  {importResult.decisions.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {importResult.decisions.slice(0, 5).map((d, i) => (
                        <span key={i} style={{
                          fontSize: 9, padding: "2px 6px", borderRadius: 4,
                          background: "rgba(201,162,76,0.08)", color: "var(--atlas-gold)",
                          border: "0.5px solid rgba(201,162,76,0.2)",
                        }}>
                          {d.length > 40 ? d.slice(0, 40) + "…" : d}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {importStatus === "error" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 10, color: "var(--atlas-muted)" }}>
                    Import failed. Check your GitHub token in the Files tab.
                  </div>
                  <button
                    onClick={runFullImport}
                    style={{
                      flexShrink: 0, padding: "5px 10px", borderRadius: 6,
                      border: "1px solid rgba(255,255,255,0.1)", background: "transparent",
                      color: "var(--atlas-muted)", fontSize: 10, cursor: "pointer",
                    }}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto", padding: "6px 2px" }} className="scrollbar-none">
            {treeLoading && (
              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
                Loading tree…
              </div>
            )}
            {treeError && (
              <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
                {treeError}
              </div>
            )}
            {/* Search input + Tree/Type toggle */}
            <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid var(--atlas-border)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 8, background: "var(--atlas-bg)", border: "1px solid var(--atlas-border)" }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11 11l2.5 2.5"/>
              </svg>
              <input
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                placeholder="Search files..."
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "var(--atlas-fg)", fontSize: 12,
                  fontFamily: "var(--app-font-sans)",
                }}
              />
              {fileSearch && (
                <button
                  onClick={() => setFileSearch("")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1, padding: 0 }}
                >
                  ×
                </button>
              )}
            </div>
            {!fileSearch.trim() && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {(["tree", "buckets"] as const).map((m) => {
                  const active = treeViewMode === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setTreeViewMode(m)}
                      style={{
                        padding: "3px 10px",
                        borderRadius: 999,
                        border: `1px solid ${active ? "var(--atlas-gold)" : "var(--atlas-border)"}`,
                        background: active ? "rgba(201,162,76,0.10)" : "transparent",
                        color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                        cursor: "pointer",
                        fontFamily: "var(--app-font-mono)",
                        fontSize: 9,
                        letterSpacing: "0.1em",
                        textTransform: "uppercase",
                      }}
                    >
                      {m === "tree" ? "Tree" : "By Type"}
                    </button>
                  );
                })}
                <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  {wsLens} lens
                </span>
              </div>
            )}
          </div>

          {/* Recents strip (when not searching) */}
          {!fileSearch.trim() && recents.length > 0 && (
            <div style={{ padding: "10px 12px 6px", borderBottom: "1px solid var(--atlas-border)" }}>
              <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.6, marginBottom: 6 }}>
                Recent
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {recents.slice(0, 6).map((p) => {
                  const name = p.split("/").pop() ?? p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => loadFile(p)}
                      title={p}
                      style={{
                        maxWidth: 160,
                        padding: "3px 9px",
                        borderRadius: 999,
                        background: "rgba(201,162,76,0.05)",
                        border: "1px solid rgba(201,162,76,0.18)",
                        color: "var(--atlas-fg)",
                        fontSize: 10,
                        fontFamily: "var(--app-font-mono)",
                        cursor: "pointer",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* File list — search results / tree / buckets */}
          {!treeLoading && (
            fileSearch.trim() ? (
              // Flat search results
              <div style={{ overflowY: "auto", flex: 1 }}>
                {flatFiles
                  .filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase()))
                  .slice(0, 50)
                  .map(f => (
                    <button
                      key={f.path}
                      onClick={() => { loadFile(f.path); setFileSearch(""); }}
                      style={{
                        width: "100%", textAlign: "left", padding: "8px 14px",
                        background: selectedPath === f.path ? "rgba(201,162,76,0.06)" : "transparent",
                        border: "none", cursor: "pointer", display: "flex", flexDirection: "column", gap: 2,
                        borderBottom: "1px solid var(--atlas-border)",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
                      onMouseLeave={e => (e.currentTarget.style.background = selectedPath === f.path ? "rgba(201,162,76,0.06)" : "transparent")}
                    >
                      <span style={{ fontSize: 12, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
                        {f.name}
                      </span>
                      <span style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.6, fontFamily: "var(--app-font-mono)" }}>
                        {f.path}
                      </span>
                    </button>
                  ))
                }
                {flatFiles.filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase())).length === 0 && (
                  <div style={{ padding: "24px 14px", textAlign: "center", color: "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)" }}>
                    No files matching "{fileSearch}"
                  </div>
                )}
              </div>
            ) : treeViewMode === "tree" ? (
              // Native folder tree (Build lens default)
              <div style={{ overflowY: "auto", flex: 1 }}>
                {tree.map((node) => (
                  <GhTreeNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={loadFile} />
                ))}
              </div>
            ) : (
              // By-Type buckets (Flow / Look / Scenario default)
              <BucketsView
                files={flatFiles}
                linkedRepo={selectedRepo}
                branch={repoBranch}
                selectedPath={selectedPath}
                onSelect={loadFile}
                lensIsVisual={wsLens === "look"}
              />
            )
          )}
          </div>
        </>
      )}

      {/* File content */}
      {filesSubTab === "files" && view === "file" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {fileLoading && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
              Loading file…
            </div>
          )}
          {fileError && (
            <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
              {fileError}
            </div>
          )}
          {fileContent && (
            <>
              <div style={{ padding: "6px 10px 5px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", opacity: 0.75, letterSpacing: "0.04em" }}>
                  {fileContent.lines} lines{fileContent.truncated ? " (truncated)" : ""}
                </span>
                <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.04em" }}>
                  {Math.round(fileContent.size / 1024 * 10) / 10} KB
                </span>
                <div style={{
                  marginLeft: "auto", display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 7px", borderRadius: 4,
                  background: "rgba(52,211,153,0.08)", border: "0.5px solid rgba(52,211,153,0.2)",
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", boxShadow: "0 0 6px rgba(52,211,153,0.6)", flexShrink: 0 }} />
                  <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "#34d399" }}>
                    In context
                  </span>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }} className="scrollbar-none">
                <pre style={{
                  margin: 0, fontSize: 10.5, lineHeight: 1.7,
                  color: "var(--atlas-fg)",
                  fontFamily: "var(--app-font-mono)",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {fileContent.content}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
      <div id={`atlas-db-section-${projectId}`} style={{ flexShrink: 0, padding: "0 10px 12px" }}>
        <DatabaseConnectionSection projectId={projectId} dbUrl={dbUrl} onDbUrlChange={onDbUrlChange} />
        {modelPickerToggleRow}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// BucketsView — lens-aware "By Type" presentation
// Images bucket leads, then Documents, then Archives, then collapsible Code.
// In Look lens, Images render as a visual grid; otherwise as a compact list.
// ─────────────────────────────────────────────────────────────────────
function BucketsView({
  files,
  linkedRepo,
  branch,
  selectedPath,
  onSelect,
  lensIsVisual,
}: {
  files: Array<{ path: string; name: string }>;
  linkedRepo: GhRepo | null;
  branch: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  lensIsVisual: boolean;
}) {
  const [codeOpen, setCodeOpen] = useState(false);
  const buckets = useMemo(() => {
    const out: Record<"images"|"docs"|"archives"|"code", typeof files> = { images: [], docs: [], archives: [], code: [] };
    for (const f of files) out[bucketOf(f.path)].push(f);
    return out;
  }, [files]);

  const sectionLabel: React.CSSProperties = {
    fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.16em",
    textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.7,
    margin: "0 0 8px",
  };
  const fileRow = (f: { path: string; name: string }) => {
    const active = selectedPath === f.path;
    return (
      <button
        key={f.path}
        type="button"
        onClick={() => onSelect(f.path)}
        style={{
          width: "100%", display: "flex", flexDirection: "column", gap: 2,
          padding: "7px 12px", textAlign: "left",
          background: active ? "rgba(201,162,76,0.08)" : "transparent",
          border: "none", borderBottom: "1px solid rgba(38,38,38,0.6)",
          cursor: "pointer", color: "var(--atlas-fg)",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
        onMouseLeave={e => (e.currentTarget.style.background = active ? "rgba(201,162,76,0.08)" : "transparent")}
      >
        <span style={{ fontSize: 12, fontFamily: "var(--app-font-mono)" }}>{f.name}</span>
        <span style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55, fontFamily: "var(--app-font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
      </button>
    );
  };

  return (
    <div style={{ overflowY: "auto", flex: 1, padding: "12px 12px 20px" }} className="scrollbar-none">
      {/* IMAGES */}
      {buckets.images.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <h3 style={sectionLabel}>Images · {buckets.images.length}</h3>
          {lensIsVisual && linkedRepo ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {buckets.images.slice(0, 60).map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => onSelect(f.path)}
                  title={f.path}
                  style={{
                    aspectRatio: "1 / 1", padding: 0, border: "1px solid rgba(38,38,38,0.85)",
                    borderRadius: 10, overflow: "hidden", background: "rgba(10,10,10,0.6)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  <img
                    src={`https://raw.githubusercontent.com/${linkedRepo.fullName}/${branch}/${f.path}`}
                    alt={f.name}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </button>
              ))}
            </div>
          ) : (
            <div>{buckets.images.slice(0, 40).map(fileRow)}</div>
          )}
        </section>
      )}

      {/* DOCUMENTS */}
      {buckets.docs.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <h3 style={sectionLabel}>Documents · {buckets.docs.length}</h3>
          <div>{buckets.docs.slice(0, 50).map(fileRow)}</div>
        </section>
      )}

      {/* ARCHIVES */}
      {buckets.archives.length > 0 && (
        <section style={{ marginBottom: 18 }}>
          <h3 style={sectionLabel}>Archives · {buckets.archives.length}</h3>
          <div>{buckets.archives.map(fileRow)}</div>
        </section>
      )}

      {/* CODE (collapsed by default in non-Build lenses) */}
      {buckets.code.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setCodeOpen((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "transparent", border: "none", padding: 0,
              color: "var(--atlas-muted)", cursor: "pointer", marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--atlas-gold)", opacity: 0.7 }}>{codeOpen ? "▾" : "▸"}</span>
            <h3 style={{ ...sectionLabel, margin: 0 }}>Code · {buckets.code.length}</h3>
          </button>
          {codeOpen && <div>{buckets.code.slice(0, 200).map(fileRow)}</div>}
        </section>
      )}

      {files.length === 0 && (
        <div style={{ padding: "24px 12px", textAlign: "center", color: "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)", opacity: 0.6 }}>
          No files yet.
        </div>
      )}
    </div>
  );
}


