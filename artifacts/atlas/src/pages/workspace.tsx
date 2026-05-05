import { useState, useRef, useEffect, useCallback } from "react";
import type React from "react";
import { useParams, useLocation } from "wouter";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { StatusGlyph } from "../components/StatusGlyph";
import { CapsuleTag } from "../components/CapsuleTag";
import { ZipDragOverlay, ZipPanel, parseZip, assembleContext } from "../components/ZipImport";
import type { ZipEntry } from "../components/ZipImport";
import {
  useGetProject,
  useListSessions,
  useListEntries,
  useListMessages,
  useCreateSession,
  useCreateEntry,
  useUpdateProject,
  useUpdateEntry,
  getListEntriesQueryKey,
  getListSessionsQueryKey,
  getGetProjectQueryKey,
} from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────────────
interface CatchPayload {
  v: number;
  against: { id: string; title: string };
  leadSentence: string;
}

interface FileEdit {
  path: string;
  language: string;
  content: string;
}

interface PushRecord {
  id: string;
  path: string;
  filename: string;
  branch: string;
  commitUrl: string;
  originalContent: string | null;
  newContent: string;
  pushedAt: string;
  rolledBack: boolean;
}

interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  intentType?: string | null;
  catchPayload?: CatchPayload | null;
  catchResolved?: boolean;
  fileEdit?: FileEdit;
  fileEdits?: FileEdit[];
  memoryChips?: string[];
  sentAt?: string;
  imageB64?: string;
  imageMimeType?: string;
}

interface LinkedRepo {
  fullName: string;
  defaultBranch: string;
  name: string;
}

type RightTab = "ledger" | "files" | "preview" | "memory" | "map";

interface ProjectScan {
  projectName: string;
  description: string;
  stack: string[];
  routes: string[];
  pages: string[];
  components: string[];
  tables: string[];
  authEnabled: boolean;
  summary: string;
  scannedAt: string;
  repo: string;
  branch: string;
  totalFiles: number;
}

// ── User profile helpers ──────────────────────────────────────────────────────
interface UserProfile {
  name: string;
  stack: string;
  projects: string;
  notes: string;
  photoUrl?: string;
}

function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem("atlas-user-profile");
    if (raw) return JSON.parse(raw);
  } catch {}
  return { name: "", stack: "React, React Router, Tailwind CSS, Supabase", projects: "Compani, IntoIQ, CoinsBloom, PresentQ, SanctumIQ, Atlas", notes: "", photoUrl: "" };
}

function saveProfile(p: UserProfile) {
  try { localStorage.setItem("atlas-user-profile", JSON.stringify(p)); } catch {}
}

function profileToString(p: UserProfile): string {
  const parts: string[] = [];
  if (p.name) parts.push(`Name: ${p.name}`);
  if (p.stack) parts.push(`Stack: ${p.stack}`);
  if (p.projects) parts.push(`Projects: ${p.projects}`);
  if (p.notes) parts.push(`Notes: ${p.notes}`);
  return parts.join("\n");
}

// ── Hooks ────────────────────────────────────────────────────────────────────
function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.innerWidth < 1024);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 1024);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

// ── useVoiceInput ─────────────────────────────────────────────────────────────
function useVoiceInput(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const callbackRef = useRef(onTranscript);
  callbackRef.current = onTranscript;

  const isSupported =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = useCallback(() => {
    if (!isSupported) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const text = Array.from(e.results as any[])
        .map((r: any) => r[0].transcript)
        .join(" ");
      callbackRef.current(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [isSupported, listening]);

  return { listening, toggle, isSupported };
}

// ── MenuBtn — reusable dropdown menu item ─────────────────────────────────────
function MenuBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "9px 12px", borderRadius: 7, cursor: "pointer", color: "rgba(231,229,228,0.8)", fontSize: 13, textAlign: "left" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: "rgba(120,113,108,0.6)", display: "flex", flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  );
}

// ── AtlasLogo ────────────────────────────────────────────────────────────────
function AtlasLogo({ small }: { small?: boolean }) {
  const s = small ? 15 : 18;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={s} height={s} viewBox="0 0 20 20" fill="none" aria-hidden>
        <circle cx="10" cy="10" r="8" stroke="#C9A24C" strokeWidth="1.2" />
        <circle cx="10" cy="10" r="3.2" stroke="#C9A24C" strokeWidth="0.9" />
        <line x1="10" y1="2" x2="10" y2="18" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
        <line x1="2" y1="10" x2="18" y2="10" stroke="#C9A24C" strokeWidth="0.7" strokeDasharray="1.8 2.4" />
      </svg>
      <span
        style={{
          fontFamily: "var(--app-font-sans)",
          fontSize: small ? 12 : 13,
          fontWeight: 500,
          letterSpacing: "0.14em",
          color: "var(--atlas-fg)",
          textTransform: "uppercase",
          opacity: 0.82,
        }}
      >
        Atlas
      </span>
    </div>
  );
}

// ── DecisionCatchCard ────────────────────────────────────────────────────────
function DecisionCatchCard({
  payload,
  projectId,
  sessionId,
  onProceed,
  onAdjust,
}: {
  payload: CatchPayload;
  projectId: number;
  sessionId: number;
  onProceed: () => void;
  onAdjust: () => void;
}) {
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [showReason, setShowReason] = useState(false);

  const handleProceed = () => {
    if (!showReason) { setShowReason(true); return; }
    createEntry.mutate(
      {
        projectId,
        data: {
          title: `Override: ${payload.against.title}`,
          summary: reason || payload.leadSentence,
          status: "committed",
          severity: "committed",
          mode: "decide",
          sessionId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          onProceed();
        },
      }
    );
  };

  return (
    <div
      role="alert"
      aria-label="Decision Catch"
      className="atlas-catch-card atlas-bubble-in"
      style={{ padding: "12px 14px", marginTop: 10 }}
    >
      {/* Header label */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
        <span
          aria-hidden
          style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: "var(--atlas-ember)",
            boxShadow: "0 0 8px color-mix(in oklab, var(--atlas-ember) 60%, transparent)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9.5,
            letterSpacing: "0.14em", textTransform: "uppercase" as const,
            color: "var(--atlas-ember)",
          }}
        >
          Before you do
        </span>
      </div>

      {/* Linked decision — the committed entry this catch is against */}
      <div
        style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 6,
          background: "color-mix(in oklab, var(--atlas-ember) 6%, transparent)",
          border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 22%, transparent)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em",
            textTransform: "uppercase" as const, color: "var(--atlas-ember)",
            opacity: 0.65, marginBottom: 3,
          }}
        >
          Against
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--atlas-fg)", lineHeight: 1.35 }}>
          {payload.against.title}
        </div>
      </div>

      {/* Lead sentence */}
      <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.65, color: "var(--atlas-fg)", opacity: 0.85 }}>
        {payload.leadSentence}
      </p>

      {/* Optional reason textarea */}
      {showReason && (
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="One line on why — optional, but it helps later."
          rows={2}
          style={{
            marginBottom: 12, width: "100%",
            background: "var(--atlas-surface-alt)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 6, padding: "8px 10px",
            fontSize: 12, color: "var(--atlas-fg)",
            fontFamily: "var(--app-font-sans)", outline: "none", resize: "none",
            transition: "border-color 160ms ease",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
        {/* Ghost: Proceed anyway */}
        <button
          disabled={createEntry.isPending}
          onClick={handleProceed}
          style={{
            padding: "5px 12px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent",
            color: "color-mix(in oklab, var(--atlas-ember) 90%, var(--atlas-fg))",
            border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 55%, transparent)",
            borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            opacity: createEntry.isPending ? 0.5 : 1,
            transition: "all 160ms ease",
          }}
        >
          {createEntry.isPending ? "Logging…" : showReason ? "Confirm" : "Proceed anyway"}
        </button>

        {/* Primary: Adjust */}
        <button
          disabled={createEntry.isPending}
          onClick={() => { setShowReason(false); setReason(""); onAdjust(); }}
          style={{
            padding: "6px 13px", fontSize: 10, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: "var(--atlas-bg)",
            border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 75%, transparent)",
            borderRadius: 4,
            boxShadow: "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent), inset 0 1px 0 rgba(255,255,255,0.15)",
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            transition: "opacity 160ms ease",
          }}
        >
          Adjust
        </button>

        {showReason && (
          <button
            onClick={() => { setShowReason(false); setReason(""); }}
            style={{
              marginLeft: "auto", fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              background: "transparent", color: "var(--atlas-muted)",
              border: "none", cursor: "pointer", opacity: 0.6,
            }}
          >
            cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chat bubbles + Memory Chips ──────────────────────────────────────────────
// ── MemoryChips ───────────────────────────────────────────────────────────────
function MemoryChips({
  chips,
  onDismiss,
}: {
  chips: string[];
  onDismiss: (chip: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div
      style={{
        display: "flex", flexWrap: "wrap", gap: 5,
        padding: "6px 14px 2px", flexShrink: 0,
      }}
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="atlas-bubble-in"
          style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            padding: "3px 7px 3px 9px", borderRadius: 20,
            fontFamily: "var(--app-font-mono)", fontSize: 9.5,
            letterSpacing: "0.05em",
            color: "var(--atlas-muted)",
            background: "color-mix(in oklab, var(--atlas-surface) 85%, var(--atlas-bg))",
            border: "0.5px solid var(--atlas-border)",
            transition: "border-color 160ms ease",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "rgba(201,162,76,0.22)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--atlas-border)")}
        >
          {chip}
          <button
            onClick={() => onDismiss(chip)}
            aria-label={`Dismiss ${chip}`}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--atlas-muted)", opacity: 0.45,
              fontSize: 12, lineHeight: 1, padding: "0 1px",
              display: "flex", alignItems: "center",
            }}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

const LINE_HEIGHT_PX = 23.8; // 14px * 1.7 line-height
const COLLAPSE_LINES = 3;

function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function UserBubble({
  content,
  sentAt,
  onCopy,
  onEdit,
}: {
  content: string;
  sentAt?: string;
  onCopy: () => void;
  onEdit: () => void;
}) {
  const lines = content.split("\n");
  const isTall = lines.length > COLLAPSE_LINES || content.length > 180;
  const [expanded, setExpanded] = useState(!isTall);
  const [hov, setHov] = useState(false);
  const [copied, setCopied] = useState(false);

  const displayContent = !expanded
    ? lines.slice(0, COLLAPSE_LINES).join("\n") + (lines.length > COLLAPSE_LINES ? "…" : "")
    : content;

  const handleCopy = () => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopied(true);
    onCopy();
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className="atlas-bubble-in"
      style={{ display: "flex", justifyContent: "flex-end", marginBottom: 24 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ maxWidth: "74%", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
        {/* Bubble */}
        <div
          className="atlas-user-bubble"
          style={{
            padding: "11px 15px",
            borderRadius: "12px 12px 3px 12px",
            width: "100%",
          }}
        >
          <div
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9,
              letterSpacing: "0.12em", textTransform: "uppercase",
              color: "var(--atlas-ember)", opacity: 0.65, marginBottom: 6,
            }}
          >
            You
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--atlas-fg)", whiteSpace: "pre-wrap" }}>
            {displayContent}
          </div>
          {isTall && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                marginTop: 6, background: "none", border: "none",
                color: "var(--atlas-ember)", fontSize: 10,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                cursor: "pointer", padding: 0, opacity: 0.7,
              }}
            >
              {expanded ? "Show less ↑" : "Show more ↓"}
            </button>
          )}
          {/* Timestamp */}
          {sentAt && (
            <div style={{
              textAlign: "right", marginTop: 4,
              fontSize: 8.5, fontFamily: "var(--app-font-mono)",
              color: "var(--atlas-muted)", opacity: 0.3,
            }}>
              {formatTimestamp(sentAt)}
            </div>
          )}
        </div>

        {/* Action row — icon-only, visible on hover */}
        <div style={{ display: "flex", gap: 4, opacity: hov ? 1 : 0, transition: "opacity 180ms ease", justifyContent: "flex-end" }}>
          {/* Copy */}
          <button className={`atlas-icon-action${copied ? " copy-done" : ""}`} onClick={handleCopy} title={copied ? "Copied!" : "Copy"}>
            {copied
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            }
          </button>
          {/* Edit */}
          <button className="atlas-icon-action" onClick={onEdit} title="Edit &amp; resend">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Diff utilities ────────────────────────────────────────────────────────────
type DiffLine = { type: "added" | "removed" | "context"; line: string };
type DiffItem = DiffLine | { type: "ellipsis"; count: number };

function computeLineDiff(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length, n = b.length;
  if (m > 400 || n > 400) {
    return b.map((line) => ({ type: "added" as const, line }));
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      result.unshift({ type: "context", line: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: "added", line: b[j - 1] });
      j--;
    } else {
      result.unshift({ type: "removed", line: a[i - 1] });
      i--;
    }
  }
  return result;
}

function collapseDiff(lines: DiffLine[], ctx = 3): DiffItem[] {
  const relevant = new Set<number>();
  lines.forEach((l, i) => {
    if (l.type !== "context") {
      for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) relevant.add(k);
    }
  });
  if (relevant.size === 0) {
    const preview = lines.slice(0, ctx);
    const rest = lines.length - preview.length;
    return [...preview, ...(rest > 0 ? [{ type: "ellipsis" as const, count: rest }] : [])];
  }
  const result: DiffItem[] = [];
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!relevant.has(i)) continue;
    if (last !== -1 && i > last + 1) result.push({ type: "ellipsis" as const, count: i - last - 1 });
    result.push(lines[i]);
    last = i;
  }
  if (last < lines.length - 1) result.push({ type: "ellipsis" as const, count: lines.length - 1 - last });
  return result;
}

// ── GitHubPushModal ───────────────────────────────────────────────────────────
function GitHubPushModal({
  fileEdits,
  linkedRepo,
  projectId,
  onClose,
  onPushSuccess,
}: {
  fileEdits: FileEdit[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onClose: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const _projectId = projectId; void _projectId;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [useNewBranch, setUseNewBranch] = useState(true);
  const [branchName, setBranchName] = useState(`atlas/fix-${today}`);
  const [commitMsg, setCommitMsg] = useState(
    fileEdits.length === 1
      ? `Atlas: update ${fileEdits[0]?.path.split("/").pop() ?? "file"}`
      : `Atlas: update ${fileEdits.length} files`
  );
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ commitUrl: string; branch: string } | null>(null);
  const [viewMode, setViewMode] = useState<"diff" | "full">("diff");
  const [originalContents, setOriginalContents] = useState<(string | null)[]>(() => fileEdits.map(() => null));
  const [loadingOriginals, setLoadingOriginals] = useState(true);
  const [rollingBack, setRollingBack] = useState(false);
  const [rolledBack, setRolledBack] = useState(false);

  const { data: modalProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = modalProject?.githubToken ?? null;

  useEffect(() => {
    if (!linkedRepo || !token) { setLoadingOriginals(false); return; }
    let cancelled = false;
    Promise.all(
      fileEdits.map((fe) =>
        fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(fe.path)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { "x-github-token": token } }
        )
          .then((r) => r.ok ? r.json() as Promise<{ content: string }> : null)
          .then((d) => (d as { content: string } | null)?.content ?? null)
          .catch(() => null)
      )
    ).then((originals) => {
      if (!cancelled) { setOriginalContents(originals); setLoadingOriginals(false); }
    });
    return () => { cancelled = true; };
  }, []);

  const currentFile = fileEdits[selectedIdx] ?? fileEdits[0];
  const currentOriginal = originalContents[selectedIdx] ?? null;
  const diffItems: DiffItem[] = currentOriginal !== null
    ? collapseDiff(computeLineDiff(currentOriginal, currentFile.content))
    : currentFile.content.split("\n").map((line) => ({ type: "added" as const, line }));

  const handlePush = async () => {
    if (!linkedRepo || !token) {
      setError("No linked repo or GitHub token found. Open the Files tab and link a repo first.");
      return;
    }
    setPushing(true);
    setError(null);
    try {
      const targetBranch = useNewBranch ? branchName : linkedRepo.defaultBranch;
      if (useNewBranch) {
        const branchRes = await fetch("/api/github/branch", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({ repo: linkedRepo.fullName, branch: branchName, baseBranch: linkedRepo.defaultBranch }),
        });
        if (!branchRes.ok) {
          const d = await branchRes.json().catch(() => ({})) as any;
          throw new Error(d.error || `Branch creation failed: HTTP ${branchRes.status}`);
        }
      }
      let lastCommitUrl = "";
      for (let i = 0; i < fileEdits.length; i++) {
        const fe = fileEdits[i];
        const commitRes = await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({
            repo: linkedRepo.fullName, branch: targetBranch, path: fe.path, content: fe.content,
            message: `${commitMsg}${fileEdits.length > 1 ? ` (${i + 1}/${fileEdits.length})` : ""}`,
          }),
        });
        if (!commitRes.ok) {
          const d = await commitRes.json().catch(() => ({})) as any;
          throw new Error(d.error || `Commit failed for ${fe.path}: HTTP ${commitRes.status}`);
        }
        const cd = await commitRes.json() as { commitUrl: string };
        lastCommitUrl = cd.commitUrl;
      }
      const records: PushRecord[] = fileEdits.map((fe, i) => ({
        id: `${Date.now()}-${i}`,
        path: fe.path,
        filename: fe.path.split("/").pop() ?? fe.path,
        branch: targetBranch,
        commitUrl: lastCommitUrl,
        originalContent: originalContents[i] ?? null,
        newContent: fe.content,
        pushedAt: new Date().toISOString(),
        rolledBack: false,
      }));
      onPushSuccess(records);
      setSuccess({ commitUrl: lastCommitUrl, branch: targetBranch });
    } catch (e: any) {
      setError(e.message ?? "Push failed");
    } finally {
      setPushing(false);
    }
  };

  const handleRollback = async () => {
    if (!linkedRepo || !token || !success) return;
    setRollingBack(true);
    try {
      for (let i = 0; i < fileEdits.length; i++) {
        const orig = originalContents[i];
        if (!orig) continue;
        const r = await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({
            repo: linkedRepo.fullName, branch: success.branch, path: fileEdits[i].path,
            content: orig, message: `Atlas: rollback ${fileEdits[i].path.split("/").pop()}`,
          }),
        });
        if (!r.ok) { const d = await r.json().catch(() => ({})) as any; throw new Error(d.error || "Rollback failed"); }
      }
      setRolledBack(true);
    } catch (e: any) {
      setError(e.message ?? "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  };

  const canRollback = originalContents.some((o) => o !== null);

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px 16px" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "100%", maxWidth: 680, background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)", borderRadius: 12, boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(201,162,76,0.08)", display: "flex", flexDirection: "column", maxHeight: "92vh", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M8 1C4.13 1 1 4.13 1 8c0 3.09 2 5.71 4.78 6.64.35.06.48-.15.48-.34v-1.2c-1.94.42-2.35-.94-2.35-.94-.32-.81-.78-1.03-.78-1.03-.64-.43.05-.42.05-.42.7.05 1.07.72 1.07.72.62 1.07 1.63.76 2.03.58.06-.45.24-.76.44-.93-1.55-.18-3.18-.77-3.18-3.44 0-.76.27-1.38.72-1.87-.07-.18-.31-.88.07-1.84 0 0 .59-.19 1.92.72A6.6 6.6 0 018 4.82c.59 0 1.19.08 1.74.23 1.33-.9 1.92-.72 1.92-.72.38.96.14 1.66.07 1.84.45.49.72 1.11.72 1.87 0 2.68-1.63 3.26-3.19 3.44.25.22.48.64.48 1.3v1.92c0 .19.13.4.48.33C13 13.71 15 11.09 15 8c0-3.87-3.13-7-7-7z" fill="currentColor" style={{ color: "var(--atlas-gold)" }} />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--atlas-fg)" }}>
                Push to GitHub
                {fileEdits.length > 1 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: "var(--atlas-gold)", opacity: 0.7, fontFamily: "var(--app-font-mono)" }}>{fileEdits.length} files</span>}
              </div>
              {linkedRepo && <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>{linkedRepo.fullName}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1, padding: "4px 6px", opacity: 0.5 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>×</button>
        </div>

        <div style={{ padding: "14px 20px", overflowY: "auto", flex: 1 }}>
          {success ? (
            <div style={{ textAlign: "center", padding: "24px 0" }}>
              {rolledBack ? (
                <>
                  <div style={{ fontSize: 22, marginBottom: 10, color: "rgba(134,239,172,0.8)" }}>↺</div>
                  <div style={{ fontSize: 14, color: "var(--atlas-fg)", marginBottom: 6 }}>Rolled back — {fileEdits.length > 1 ? `${fileEdits.length} files` : (fileEdits[0]?.path.split("/").pop() ?? "file")} restored</div>
                  <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 16 }}>Original versions pushed to <strong>{success.branch}</strong>.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 28, marginBottom: 12, color: "rgba(134,239,172,0.8)" }}>✓</div>
                  <div style={{ fontSize: 14, color: "var(--atlas-fg)", marginBottom: 4 }}>{fileEdits.length > 1 ? `${fileEdits.length} files pushed` : "Pushed"} to <strong>{success.branch}</strong></div>
                  {fileEdits.length > 1 && (
                    <div style={{ marginBottom: 8 }}>
                      {fileEdits.map((fe) => <div key={fe.path} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, lineHeight: 1.8 }}>{fe.path}</div>)}
                    </div>
                  )}
                  <a href={success.commitUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", fontSize: 12, fontFamily: "var(--app-font-mono)", textDecoration: "none", marginTop: 8 }}>View commit on GitHub →</a>
                  {canRollback && (
                    <div style={{ marginTop: 18 }}>
                      <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 10, lineHeight: 1.6 }}>Something break? Roll back to the original version instantly.</div>
                      <button onClick={handleRollback} disabled={rollingBack} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: rollingBack ? "rgba(255,255,255,0.04)" : "rgba(239,68,68,0.08)", border: `1px solid ${rollingBack ? "var(--atlas-border)" : "rgba(239,68,68,0.25)"}`, color: rollingBack ? "var(--atlas-muted)" : "rgba(252,165,165,0.85)", cursor: rollingBack ? "not-allowed" : "pointer", transition: "all 160ms ease" }}>
                        {rollingBack ? "Rolling back…" : `↺ Rollback ${fileEdits.length > 1 ? "all changes" : "this change"}`}
                      </button>
                      {error && <div style={{ marginTop: 8, fontSize: 11, color: "rgba(252,165,165,0.75)" }}>{error}</div>}
                    </div>
                  )}
                </>
              )}
              <div style={{ marginTop: 16 }}>
                <button onClick={onClose} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Close</button>
              </div>
            </div>
          ) : (
            <>
              {/* File tabs (multiple files) */}
              {fileEdits.length > 1 && (
                <div style={{ display: "flex", gap: 4, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
                  {fileEdits.map((fe, idx) => (
                    <button key={fe.path} onClick={() => setSelectedIdx(idx)} style={{ padding: "5px 11px", borderRadius: 5, fontSize: 10, fontFamily: "var(--app-font-mono)", whiteSpace: "nowrap" as const, background: idx === selectedIdx ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${idx === selectedIdx ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`, color: idx === selectedIdx ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer", transition: "all 140ms ease", flexShrink: 0 }}>
                      {fe.path.split("/").pop()}
                    </button>
                  ))}
                </div>
              )}

              {/* Diff / Full view */}
              <div style={{ padding: "10px 13px", borderRadius: 7, background: "rgba(0,0,0,0.25)", border: "1px solid var(--atlas-border)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>{currentFile.path}</span>
                  <div style={{ display: "flex", gap: 4 }}>
                    {(["diff", "full"] as const).map((m) => (
                      <button key={m} onClick={() => setViewMode(m)} style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: viewMode === m ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${viewMode === m ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`, color: viewMode === m ? "var(--atlas-gold)" : "var(--atlas-muted)", cursor: "pointer" }}>
                        {m === "diff" ? "Diff" : "Full"}
                      </button>
                    ))}
                  </div>
                </div>
                {viewMode === "diff" ? (
                  loadingOriginals ? (
                    <div style={{ padding: "12px 0", fontSize: 11, color: "var(--atlas-muted)", opacity: 0.5, fontFamily: "var(--app-font-mono)" }}>Loading original…</div>
                  ) : (
                    <div style={{ borderRadius: 5, overflow: "hidden", border: "1px solid rgba(255,255,255,0.04)", maxHeight: 280, overflowY: "auto", fontFamily: "var(--app-font-mono)", fontSize: 10.5, lineHeight: 1.55 }}>
                      {currentOriginal === null && (
                        <div style={{ padding: "5px 10px", fontSize: 10, color: "rgba(134,239,172,0.6)", background: "rgba(134,239,172,0.04)", borderBottom: "1px solid rgba(134,239,172,0.1)" }}>New file</div>
                      )}
                      {diffItems.map((item, idx) => {
                        if (item.type === "ellipsis") {
                          return <div key={idx} style={{ padding: "3px 10px", background: "rgba(0,0,0,0.2)", color: "rgba(120,113,108,0.4)", fontSize: 9.5, letterSpacing: "0.04em", borderTop: "1px solid rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>···  {item.count} unchanged {item.count === 1 ? "line" : "lines"}</div>;
                        }
                        const isAdded = item.type === "added";
                        const isRemoved = item.type === "removed";
                        return (
                          <div key={idx} style={{ display: "flex", alignItems: "flex-start", background: isAdded ? "rgba(134,239,172,0.06)" : isRemoved ? "rgba(239,68,68,0.05)" : "transparent", borderLeft: `2px solid ${isAdded ? "rgba(134,239,172,0.4)" : isRemoved ? "rgba(239,68,68,0.35)" : "transparent"}` }}>
                            <span style={{ width: 16, flexShrink: 0, textAlign: "center", color: isAdded ? "rgba(134,239,172,0.7)" : isRemoved ? "rgba(252,165,165,0.6)" : "transparent", fontSize: 10, paddingTop: 1, userSelect: "none" as const }}>{isAdded ? "+" : isRemoved ? "−" : " "}</span>
                            <span style={{ flex: 1, padding: "1px 8px 1px 2px", color: isAdded ? "rgba(134,239,172,0.85)" : isRemoved ? "rgba(252,165,165,0.7)" : "rgba(231,229,228,0.32)", whiteSpace: "pre" as const, overflowX: "auto" }}>{item.line || " "}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <pre style={{ margin: 0, padding: "10px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 5, fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.6, color: "rgba(231,229,228,0.7)", overflowX: "auto", maxHeight: 280, overflowY: "auto", whiteSpace: "pre" }}>{currentFile.content}</pre>
                )}
              </div>

              {/* Branch */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>TARGET BRANCH</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {[true, false].map((isNew) => (
                    <button key={String(isNew)} onClick={() => setUseNewBranch(isNew)} style={{ flex: 1, padding: "7px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", background: useNewBranch === isNew ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${useNewBranch === isNew ? "rgba(201,162,76,0.35)" : "var(--atlas-border)"}`, color: useNewBranch === isNew ? "var(--atlas-gold)" : "var(--atlas-muted)", transition: "all 160ms ease" }}>
                      {isNew ? "New branch (safe)" : `${linkedRepo?.defaultBranch ?? "main"} (direct)`}
                    </button>
                  ))}
                </div>
                {useNewBranch && (
                  <input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="branch name" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "rgba(0,0,0,0.3)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-mono)", outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
                )}
              </div>

              {/* Commit message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>COMMIT MESSAGE</div>
                <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="describe the change" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "rgba(0,0,0,0.3)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
              </div>

              {!linkedRepo && <div style={{ padding: "9px 12px", borderRadius: 6, marginBottom: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "rgba(252,165,165,0.8)" }}>No repo linked. Open the Files tab and link a GitHub repo to this project first.</div>}
              {error && <div style={{ padding: "9px 12px", borderRadius: 6, marginBottom: 14, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "rgba(252,165,165,0.8)" }}>{error}</div>}
            </>
          )}
        </div>

        {!success && (
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--atlas-border)", display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
            <button onClick={handlePush} disabled={pushing || !linkedRepo} style={{ padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)", color: "var(--atlas-bg)", border: "none", cursor: pushing || !linkedRepo ? "not-allowed" : "pointer", opacity: pushing || !linkedRepo ? 0.5 : 1, transition: "opacity 160ms ease" }}>
              {pushing ? "Pushing…" : fileEdits.length > 1 ? `Push ${fileEdits.length} files →` : "Push to GitHub"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  projectId,
  sessionId,
  linkedRepo,
  onCatchProceed,
  onCatchAdjust,
  onPark,
  onCommit,
  onRegenerate,
  onPushSuccess,
}: {
  message: ChatMessage;
  projectId: number;
  sessionId: number;
  linkedRepo: LinkedRepo | null;
  onCatchProceed: () => void;
  onCatchAdjust: () => void;
  onPark: (content: string) => void;
  onCommit: (content: string) => void;
  onRegenerate: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
}) {
  const [hov, setHov] = useState(false);
  const [parkDone, setParkDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selfApplyStatus, setSelfApplyStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [selfApplyMsg, setSelfApplyMsg] = useState("");
  const activeEdits = message.fileEdits ?? (message.fileEdit ? [message.fileEdit] : []);

  const SELF_PATH_RE = /^artifacts\/(atlas|api-server)\//;
  const selfEdits = activeEdits.filter((e) => SELF_PATH_RE.test(e.path));
  const userEdits = activeEdits.filter((e) => !SELF_PATH_RE.test(e.path));

  const handleSelfApply = async () => {
    if (selfApplyStatus === "applying") return;
    setSelfApplyStatus("applying");
    setSelfApplyMsg("");
    let lastMsg = "";
    try {
      for (const edit of selfEdits) {
        const res = await fetch("/api/self/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: edit.path, content: edit.content }),
        });
        const json = await res.json() as { ok?: boolean; message?: string; error?: string };
        if (!res.ok || !json.ok) throw new Error(json.error ?? "Apply failed");
        lastMsg = json.message ?? "Applied.";
      }
      setSelfApplyStatus("done");
      setSelfApplyMsg(lastMsg);
    } catch (err: unknown) {
      setSelfApplyStatus("error");
      setSelfApplyMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div
      className="atlas-bubble-in"
      style={{ display: "flex", justifyContent: "flex-start", marginBottom: 24 }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      <div style={{ maxWidth: "80%" }}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase",
            color: "var(--atlas-gold)", opacity: 0.65, marginBottom: 7,
          }}
        >
          <span>Atlas</span>
          {message.sentAt && (
            <span style={{ opacity: 0.55 }}>
              · {(() => {
                const diff = Date.now() - new Date(message.sentAt).getTime();
                const m = Math.floor(diff / 60000);
                if (m < 1) return "just now";
                if (m < 60) return `${m}m ago`;
                const h = Math.floor(m / 60);
                if (h < 24) return `${h}h ago`;
                return `${Math.floor(h / 24)}d ago`;
              })()}
            </span>
          )}
          {message.intentType && (
            <span style={{
              display: "inline-flex", alignItems: "center",
              padding: "1px 6px", borderRadius: 8, opacity: 1,
              background: message.intentType === "BUILD"
                ? "rgba(74,222,128,0.12)"
                : message.intentType === "PLAN"
                ? "rgba(201,162,76,0.12)"
                : "rgba(139,92,246,0.15)",
              border: `1px solid ${
                message.intentType === "BUILD" ? "rgba(74,222,128,0.3)"
                : message.intentType === "PLAN" ? "rgba(201,162,76,0.3)"
                : "rgba(139,92,246,0.3)"
              }`,
              fontSize: 8, fontWeight: 700, letterSpacing: "0.06em",
              color: message.intentType === "BUILD" ? "#4ade80"
                : message.intentType === "PLAN" ? "var(--atlas-gold)"
                : "#a78bfa",
            }}>
              {message.intentType}
            </span>
          )}
        </div>
        {/* Memory chips */}
        {message.memoryChips && message.memoryChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, marginBottom: 8 }}>
            {message.memoryChips.map((chip) => (
              <span
                key={chip}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 20,
                  background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.18)",
                  fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
                  color: "rgba(201,162,76,0.7)",
                }}
              >
                <span style={{ opacity: 0.6, fontSize: 9 }}>◆</span>
                {chip}
              </span>
            ))}
          </div>
        )}

        {message.imageB64 && (
          <div style={{ marginBottom: 12 }}>
            <img
              src={`data:${message.imageMimeType ?? "image/png"};base64,${message.imageB64}`}
              alt="Generated visual"
              style={{ maxWidth: "100%", borderRadius: 10, border: "1px solid rgba(201,162,76,0.2)", display: "block" }}
            />
          </div>
        )}

        <div style={{ fontSize: 14, lineHeight: 1.78, color: "var(--atlas-fg)", opacity: 0.9, whiteSpace: "pre-wrap" }}>
          {message.content}
        </div>

        {/* Code ready card — self-repair paths */}
        {selfEdits.length > 0 && (
          <div
            style={{
              marginTop: 12, padding: "11px 14px", borderRadius: 8,
              background: "rgba(56,189,248,0.04)", border: "1px solid rgba(56,189,248,0.18)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.22)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* wrench icon */}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M10.5 1.5A3.5 3.5 0 007 5c0 .36.05.71.14 1.04L2.5 10.5A1.5 1.5 0 004.5 12.5l4.46-4.64c.33.09.68.14 1.04.14a3.5 3.5 0 000-7z" stroke="rgba(56,189,248,0.9)" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="10.5" cy="5" r="1" fill="rgba(56,189,248,0.9)" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(56,189,248,0.9)", marginBottom: 2 }}>
                  {selfEdits.length === 1 ? "Self-repair ready" : `${selfEdits.length} Atlas files ready`}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {selfEdits.length === 1
                    ? <>{selfEdits[0].path.split("/").pop()}<span style={{ opacity: 0.5, marginLeft: 6 }}>· {selfEdits[0].content.split("\n").length} lines</span></>
                    : selfEdits.map((e) => e.path.split("/").pop()).join(", ")
                  }
                </div>
                {selfApplyStatus === "done" && (
                  <div style={{ fontSize: 10, color: "rgba(56,189,248,0.7)", marginTop: 3 }}>✓ {selfApplyMsg}</div>
                )}
                {selfApplyStatus === "error" && (
                  <div style={{ fontSize: 10, color: "var(--atlas-ember)", marginTop: 3 }}>✗ {selfApplyMsg}</div>
                )}
              </div>
            </div>
            <button
              onClick={handleSelfApply}
              disabled={selfApplyStatus === "applying" || selfApplyStatus === "done"}
              style={{
                flexShrink: 0, padding: "6px 13px", borderRadius: 5, fontSize: 11, fontWeight: 600,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                background: selfApplyStatus === "done"
                  ? "rgba(56,189,248,0.08)"
                  : "linear-gradient(180deg, rgba(56,189,248,0.9) 0%, rgba(14,165,233,0.85) 100%)",
                color: selfApplyStatus === "done" ? "rgba(56,189,248,0.5)" : "#0a1628",
                border: selfApplyStatus === "done" ? "1px solid rgba(56,189,248,0.2)" : "none",
                cursor: selfApplyStatus === "applying" || selfApplyStatus === "done" ? "default" : "pointer",
                opacity: selfApplyStatus === "applying" ? 0.6 : 1,
                transition: "opacity 160ms ease",
              }}
            >
              {selfApplyStatus === "applying" ? "Applying…" : selfApplyStatus === "done" ? "Applied ✓" : "Apply to Atlas →"}
            </button>
          </div>
        )}

        {/* Code ready card — user project paths */}
        {userEdits.length > 0 && (
          <div
            style={{
              marginTop: 12, padding: "11px 14px", borderRadius: 8,
              background: "rgba(201,162,76,0.05)", border: "1px solid rgba(201,162,76,0.2)",
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M3 2h8l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="var(--atlas-gold)" strokeWidth="1.2" />
                  <path d="M11 2v4h4" stroke="var(--atlas-gold)" strokeWidth="1.2" />
                  <path d="M5 8.5h6M5 11h4" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)", marginBottom: 2 }}>
                  {userEdits.length === 1 ? "Code ready" : `${userEdits.length} files ready`}
                </div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {userEdits.length === 1
                    ? <>{userEdits[0].path}<span style={{ opacity: 0.5, marginLeft: 6 }}>· {userEdits[0].content.split("\n").length} lines</span></>
                    : userEdits.map((fe) => fe.path.split("/").pop()).join(", ")
                  }
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowPushModal(true)}
              style={{ flexShrink: 0, padding: "6px 13px", borderRadius: 5, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)", color: "var(--atlas-bg)", border: "none", cursor: "pointer", boxShadow: "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent)", transition: "opacity 160ms ease" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              Review &amp; Push →
            </button>
          </div>
        )}

        {message.catchPayload && !message.catchResolved && (
          <DecisionCatchCard
            payload={message.catchPayload}
            projectId={projectId}
            sessionId={sessionId}
            onProceed={onCatchProceed}
            onAdjust={onCatchAdjust}
          />
        )}

        {/* Timestamp */}
        {message.sentAt && (
          <div style={{
            marginTop: 5, fontSize: 8.5, fontFamily: "var(--app-font-mono)",
            color: "var(--atlas-muted)", opacity: 0.28,
          }}>
            {formatTimestamp(message.sentAt)}
          </div>
        )}

        {/* Action row — icon-only cockpit buttons */}
        <div style={{ display: "flex", gap: 4, marginTop: 7, opacity: hov ? 1 : 0.32, transition: "opacity 180ms ease" }}>
          {/* Copy */}
          <button
            className={`atlas-icon-action${copied ? " copy-done" : ""}`}
            title={copied ? "Copied!" : "Copy response"}
            onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          >
            {copied
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            }
          </button>
          {/* Regenerate / Retry */}
          <button className="atlas-icon-action" title="Retry (regenerate)" onClick={onRegenerate}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 7a5.5 5.5 0 005.5 5.5 5.5 5.5 0 005.5-5.5 5.5 5.5 0 00-5.5-5.5 5.5 5.5 0 00-3.9 1.6" />
              <polyline points="1.5 1.5 1.5 4 4 4" />
            </svg>
          </button>
          {/* Park */}
          <button
            className={`atlas-icon-action${parkDone ? " done" : ""}`}
            title={parkDone ? "Parked" : "Park to inbox"}
            onClick={() => { if (!parkDone) { onPark(message.content); setParkDone(true); } }}
          >
            {parkDone
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4h12l-1.5 6.5a1 1 0 01-1 .8H3.5a1 1 0 01-1-.8L1 4z" /><path d="M4.5 4V3a1 1 0 011-1h3a1 1 0 011 1v1" /></svg>
            }
          </button>
          {/* Commit to ledger */}
          <button
            className={`atlas-icon-action${commitDone ? " done" : ""}`}
            title={commitDone ? "Committed to ledger" : "Commit to ledger"}
            onClick={() => { if (!commitDone) { onCommit(message.content); setCommitDone(true); } }}
          >
            {commitDone
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="1.5" width="10" height="11" rx="1.5" /><path d="M4.5 5h5M4.5 7.5h5M4.5 10h3" /></svg>
            }
          </button>
        </div>
      </div>

      {showPushModal && activeEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={activeEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
          onPushSuccess={(records) => { onPushSuccess(records); setShowPushModal(false); }}
        />
      )}
    </div>
  );
}

// ── Parking Lot entry ─────────────────────────────────────────────────────────
function timeAgo(date: string | Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

function ParkingLotEntry({ entry }: { entry: Entry }) {
  const queryClient = useQueryClient();
  const updateEntry = useUpdateEntry();
  const [done, setDone] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleResolve = () => {
    if (done) return;
    updateEntry.mutate(
      { id: entry.id, data: { status: "archived" } },
      { onSuccess: () => { setDone(true); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(entry.projectId, {}) }); } }
    );
  };

  const handleCommit = () => {
    if (done) return;
    updateEntry.mutate(
      { id: entry.id, data: { status: "committed", severity: "committed" } },
      { onSuccess: () => { setDone(true); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(entry.projectId, {}) }); } }
    );
  };

  const modeLabel = entry.mode ? entry.mode.toUpperCase() : "NOTE";
  const typeLabel = entry.verb ? entry.verb.toUpperCase() : "INSIGHT";
  const summary = entry.summary || "";
  const sentences = summary.split(/(?<=[.!?])\s+/);
  const shortDef = sentences.slice(0, 2).join(" ") || summary;
  const context = sentences.length > 2 ? sentences.slice(2).join(" ") : "";

  return (
    <div style={{ marginBottom: 2, position: "relative", opacity: done ? 0.4 : 1, transition: "opacity 300ms ease" }}>
      {/* Gold timeline vertical line */}
      {expanded && (
        <div style={{ position: "absolute", left: 5, top: 22, bottom: 14, width: 1, background: "rgba(201,162,76,0.2)" }} />
      )}

      {/* Collapsed header row */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", cursor: "pointer" }}
      >
        {/* Gold dot */}
        <span style={{ width: 11, height: 11, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, zIndex: 1, boxShadow: "0 0 0 3px rgba(201,162,76,0.1)", display: "inline-block" }} />
        {/* Expand caret */}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
          style={{ flexShrink: 0, color: "rgba(120,113,108,0.45)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>
          <path d="M2 4l4 4 4-4" />
        </svg>
        {/* Title */}
        <span style={{ flex: 1, fontSize: 12.5, color: "rgba(231,229,228,0.78)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4 }}>
          {entry.title}
        </span>
        {/* NOTE badge */}
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.07em", background: "rgba(120,113,108,0.12)", color: "rgba(120,113,108,0.6)", padding: "2px 7px", borderRadius: 4, flexShrink: 0, textTransform: "uppercase" as const }}>
          NOTE
        </span>
      </div>

      {/* Source line (collapsed) */}
      {!expanded && (
        <div style={{ paddingLeft: 20, paddingBottom: 6, fontSize: 10, color: "rgba(120,113,108,0.38)", fontFamily: "var(--app-font-mono)" }}>
          chat message · {timeAgo(entry.createdAt)}
        </div>
      )}

      {/* Expanded definition card */}
      {expanded && (
        <div style={{ marginLeft: 20, marginBottom: 14, background: "rgba(22,19,17,0.8)", border: "1px solid rgba(201,162,76,0.12)", borderRadius: 10, padding: "14px 16px" }}>
          {/* Category tags + status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "rgba(120,113,108,0.45)", textTransform: "uppercase" as const }}>
              {modeLabel} · {typeLabel}
            </span>
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: entry.isViolation ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.07)", border: `1px solid ${entry.isViolation ? "rgba(239,68,68,0.18)" : "rgba(74,222,128,0.18)"}`, color: entry.isViolation ? "rgba(239,68,68,0.75)" : "rgba(74,222,128,0.75)", padding: "2px 9px", borderRadius: 20, textTransform: "uppercase" as const }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {entry.isViolation ? "BLOCKER" : "REVERSIBLE"}
            </span>
          </div>

          {/* Title */}
          <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(231,229,228,0.9)", marginBottom: 8, lineHeight: 1.35 }}>
            {entry.title}
          </div>

          {/* Short definition (italic intro) */}
          {shortDef && (
            <div style={{ fontSize: 12, color: "rgba(231,229,228,0.55)", lineHeight: 1.65, marginBottom: context ? 12 : 10, fontStyle: "italic" }}>
              {shortDef}
            </div>
          )}

          {/* WHAT IT MEANS */}
          {context && (
            <>
              <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(120,113,108,0.45)", marginBottom: 5 }}>
                What it means
              </div>
              <div style={{ fontSize: 12, color: "rgba(231,229,228,0.5)", lineHeight: 1.65, marginBottom: 12 }}>
                {context}
              </div>
            </>
          )}

          {/* Source */}
          <div style={{ fontSize: 10, color: "rgba(120,113,108,0.35)", fontFamily: "var(--app-font-mono)", marginBottom: 12 }}>
            chat message · {timeAgo(entry.createdAt)}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleResolve} disabled={done || updateEntry.isPending}
              style={{ flex: 1, padding: "7px", borderRadius: 7, fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "transparent", border: "1px solid rgba(120,113,108,0.22)", color: "var(--atlas-muted)", cursor: done ? "default" : "pointer", transition: "all 150ms ease" }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.borderColor = "rgba(120,113,108,0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(120,113,108,0.22)"; }}
            >Resolve</button>
            <button onClick={handleCommit} disabled={done || updateEntry.isPending}
              style={{ flex: 1, padding: "7px", borderRadius: 7, fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: "var(--atlas-gold)", cursor: done ? "default" : "pointer", transition: "all 150ms ease" }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.background = "rgba(201,162,76,0.15)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; }}
            >Commit</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Ledger tab content ───────────────────────────────────────────────────────
function LedgerEntry({ entry }: { entry: Entry }) {
  const committed = entry.status === "committed";
  const severity = entry.severity as "blocker" | "parked" | "committed" | "neutral";

  const wrapperGradient = committed
    ? `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 55%, transparent) 0%,
        color-mix(in oklab, var(--atlas-gold) 18%, transparent) 28%,
        transparent 55%,
        color-mix(in oklab, var(--atlas-bg) 80%, transparent) 100%)`
    : `linear-gradient(135deg,
        color-mix(in oklab, var(--atlas-gold) 22%, transparent) 0%,
        color-mix(in oklab, var(--atlas-border) 70%, transparent) 60%,
        transparent 100%)`;

  const wrapperShadow = committed
    ? `0 1px 0 0 color-mix(in oklab, var(--atlas-gold) 8%, transparent) inset, 0 12px 32px -18px rgba(0,0,0,0.55)`
    : `0 6px 20px -14px rgba(0,0,0,0.4)`;

  const innerBg = committed
    ? "color-mix(in oklab, var(--atlas-bg) 92%, var(--atlas-surface))"
    : "var(--atlas-surface)";

  return (
    <article
      style={{
        padding: "0.5px", borderRadius: 6, marginBottom: 6,
        background: wrapperGradient,
        boxShadow: wrapperShadow,
      }}
    >
      <div
        style={{
          background: innerBg,
          borderRadius: 5.5,
          overflow: "hidden",
          backdropFilter: committed ? "blur(18px)" : "none",
          WebkitBackdropFilter: committed ? "blur(18px)" : "none",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 13px 8px" }}>
          <div style={{ paddingTop: 2, flexShrink: 0 }}>
            <StatusGlyph severity={severity} verb={entry.verb} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
              <span style={{
                fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em",
                color: committed ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.5)",
              }}>
                {entry.title}
              </span>
              {committed && <CapsuleTag severity="committed" size="xs">LOCKED</CapsuleTag>}
              {entry.deviation && <CapsuleTag severity="blocker" size="xs">DEVIATION</CapsuleTag>}
            </div>
          </div>
        </div>

        {/* Body */}
        {entry.summary && (
          <div style={{ padding: "0 13px 9px 37px" }}>
            <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.55, color: "var(--atlas-muted)" }}>
              {entry.summary}
            </p>
          </div>
        )}

        {/* Divider */}
        <div style={{
          margin: "0 13px", height: 1,
          background: "linear-gradient(to right, transparent, var(--atlas-border), transparent)",
        }} />

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 13px 7px" }}>
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
            textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.45,
          }}>
            {new Date(entry.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          {entry.mode && (
            <span style={{
              marginLeft: "auto",
              fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em",
              textTransform: "uppercase", padding: "2px 6px", borderRadius: 2,
              background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
              border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 20%, var(--atlas-border))",
              color: "var(--atlas-gold)",
            }}>
              {entry.mode}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

// ── PushHistoryEntry ──────────────────────────────────────────────────────────
function PushHistoryEntry({ record, onRollback }: { record: PushRecord; onRollback: () => Promise<void> }) {
  const [rolling, setRolling] = useState(false);
  const [done, setDone] = useState(record.rolledBack);
  return (
    <div style={{ padding: "10px 12px", borderRadius: 7, background: "rgba(0,0,0,0.2)", border: "1px solid var(--atlas-border)", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 11, color: "var(--atlas-fg)" }}>{record.filename}</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.5 }}>
          {new Date(record.pushedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.55, marginBottom: 7 }}>{record.branch}</div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        <a href={record.commitUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", textDecoration: "none", cursor: "pointer" }}>
          View →
        </a>
        {record.originalContent && !done && (
          <button
            disabled={rolling}
            onClick={async () => { setRolling(true); await onRollback(); setRolling(false); setDone(true); }}
            style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: rolling ? "rgba(255,255,255,0.03)" : "rgba(239,68,68,0.07)", border: `1px solid ${rolling ? "var(--atlas-border)" : "rgba(239,68,68,0.22)"}`, color: rolling ? "var(--atlas-muted)" : "rgba(252,165,165,0.8)", cursor: rolling ? "not-allowed" : "pointer", transition: "all 150ms ease" }}
          >
            {rolling ? "…" : "↺ Rollback"}
          </button>
        )}
        {done && <span style={{ padding: "3px 9px", fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5 }}>rolled back</span>}
      </div>
    </div>
  );
}

function LedgerTab({
  projectId,
  entries,
  activeCatch,
  pushHistory,
  onRollbackPush,
}: {
  projectId: number;
  entries: Entry[];
  activeCatch: CatchPayload | null;
  pushHistory: PushRecord[];
  onRollbackPush: (record: PushRecord) => Promise<void>;
}) {
  const parked = entries.filter((e) => e.status === "parked");

  // Three committed groups — mirrors original DecisionLedgerGrouped
  const inTensionId = activeCatch ? String(activeCatch.against.id) : null;
  const allCommitted = entries.filter((e) => e.status === "committed");
  const committedClean = allCommitted.filter(
    (e) => !e.deviation && String(e.id) !== inTensionId
  );
  const inTension = inTensionId
    ? allCommitted.filter((e) => String(e.id) === inTensionId)
    : [];
  const overridden = allCommitted.filter((e) => e.deviation);

  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    createEntry.mutate(
      { projectId, data: { title: newTitle.trim(), status: "committed", severity: "committed", mode: "decide" } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          setNewTitle(""); setShowAdd(false);
        },
      }
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Add entry inline */}
      {showAdd && (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <input
            autoFocus value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") { setShowAdd(false); setNewTitle(""); }
            }}
            placeholder="Decision title…"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6, marginBottom: 6,
              background: "rgba(12,10,9,0.6)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 12, outline: "none",
              fontFamily: "var(--app-font-sans)", transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            onClick={handleAdd} disabled={createEntry.isPending}
            style={{
              width: "100%", padding: "7px", borderRadius: 6,
              background: "var(--atlas-ember)", border: "none",
              color: "var(--atlas-fg)", fontSize: 11,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              cursor: createEntry.isPending ? "not-allowed" : "pointer",
              opacity: createEntry.isPending ? 0.6 : 1,
            }}
          >
            Commit
          </button>
        </div>
      )}

      {/* Entries list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }} className="scrollbar-none">
        {entries.length === 0 ? (
          <div style={{ textAlign: "center", padding: "36px 12px", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.5, lineHeight: 1.65 }}>
            Decisions made during your session will appear here.
          </div>
        ) : (
          <>
            {/* ── Group 1: Committed ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-phosphor)", boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-phosphor) 55%, transparent)" }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-phosphor)" }}>
                  Committed
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", marginLeft: "auto" }}>
                  {committedClean.length}
                </span>
              </div>
              {committedClean.length > 0 ? (
                committedClean.map((e) => <LedgerEntry key={e.id} entry={e} />)
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.45, padding: "6px 2px", lineHeight: 1.55 }}>
                  No committed decisions yet.
                </div>
              )}
            </div>

            {/* ── Group 2: In Tension ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span
                  aria-hidden
                  style={{
                    width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                    background: inTension.length > 0 ? "var(--atlas-ember)" : "var(--atlas-muted)",
                    boxShadow: inTension.length > 0
                      ? "0 0 8px color-mix(in oklab, var(--atlas-ember) 65%, transparent)"
                      : "none",
                    transition: "background 300ms ease, box-shadow 300ms ease",
                  }}
                />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: inTension.length > 0 ? "var(--atlas-ember)" : "var(--atlas-muted)", transition: "color 300ms ease" }}>
                  In Tension
                </span>
                {inTension.length > 0 && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-ember)", opacity: 0.7, marginLeft: "auto" }}>
                    {inTension.length}
                  </span>
                )}
              </div>
              {inTension.length > 0 ? (
                inTension.map((e) => (
                  <div
                    key={e.id}
                    style={{
                      borderRadius: 8,
                      border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 30%, var(--atlas-border))",
                      background: "color-mix(in oklab, var(--atlas-ember) 4%, transparent)",
                      overflow: "hidden",
                    }}
                  >
                    <LedgerEntry entry={e} />
                  </div>
                ))
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4, padding: "6px 2px", lineHeight: 1.55 }}>
                  No open tensions.
                </div>
              )}
            </div>

            {/* ── Group 3: Overridden ── */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, padding: "0 2px" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "var(--atlas-muted)", opacity: 0.5 }} />
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: "var(--atlas-muted)", opacity: 0.65 }}>
                  Overridden
                </span>
                {overridden.length > 0 && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.5, marginLeft: "auto" }}>
                    {overridden.length}
                  </span>
                )}
              </div>
              {overridden.length > 0 ? (
                <div style={{ opacity: 0.65 }}>
                  {overridden.map((e) => <LedgerEntry key={e.id} entry={e} />)}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.4, padding: "6px 2px", lineHeight: 1.55 }}>
                  Nothing overridden.
                </div>
              )}
            </div>

            {/* ── Parking Lot ── */}
            <div style={{ marginBottom: 10 }}>
              {/* Header row */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, padding: "0 2px" }}>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: parked.length > 0 ? "rgba(231,229,228,0.7)" : "var(--atlas-muted)", fontWeight: 600 }}>
                  Parking Lot
                </span>
                {parked.length > 0 && (
                  <span style={{ fontSize: 10, color: "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)" }}>
                    {parked.length} waiting · 0 resolved
                  </span>
                )}
              </div>
              {parked.length > 0 ? (
                <div style={{ paddingTop: 4 }}>
                  {parked.map((e) => <ParkingLotEntry key={e.id} entry={e} />)}
                  {/* Bottom item count */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 2px", borderTop: "1px solid rgba(201,162,76,0.1)" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", boxShadow: "0 0 6px rgba(201,162,76,0.4)" }} />
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(201,162,76,0.6)", letterSpacing: "0.06em" }}>
                      {parked.length} {parked.length === 1 ? "ITEM" : "ITEMS"}
                    </span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.35, padding: "6px 2px", lineHeight: 1.65 }}>
                  Tap <strong style={{ opacity: 0.6 }}>Park</strong> on any Atlas response to save a thought here without breaking your flow.
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Changes (push history) ── */}
      <div style={{ padding: "0 12px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, paddingTop: 12, borderTop: "1px solid var(--atlas-border)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: pushHistory.length > 0 ? "rgba(134,239,172,0.6)" : "var(--atlas-muted)", opacity: pushHistory.length > 0 ? 1 : 0.3, flexShrink: 0 }} />
          <span style={{ fontSize: 10.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--atlas-muted)" }}>Changes</span>
          {pushHistory.length > 0 && (
            <span style={{ marginLeft: "auto", fontSize: 9.5, fontFamily: "var(--app-font-mono)", background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.2)", color: "rgba(134,239,172,0.7)", padding: "1px 6px", borderRadius: 10 }}>
              {pushHistory.length}
            </span>
          )}
        </div>
        {pushHistory.length > 0 ? (
          [...pushHistory].reverse().map((record) => (
            <PushHistoryEntry
              key={record.id}
              record={record}
              onRollback={async () => {
                await onRollbackPush(record);
              }}
            />
          ))
        ) : (
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.35, lineHeight: 1.65 }}>
            Code pushes will appear here. Tap <strong style={{ opacity: 0.6 }}>Rollback</strong> on any to instantly restore the original.
          </div>
        )}
      </div>

      {/* Footer add button */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        <button
          onClick={() => setShowAdd(!showAdd)}
          style={{
            width: "100%", padding: "7px", borderRadius: 6,
            background: "transparent",
            border: "1px dashed rgba(201,162,76,0.2)",
            color: "var(--atlas-muted)", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: "pointer", opacity: 0.65,
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.65"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.2)"; }}
        >
          + Add decision
        </button>
      </div>
    </div>
  );
}

// ── GitHub file browser ───────────────────────────────────────────────────────
interface GhRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
}

interface GhTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

interface GhFileContent {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  lines: number;
}


function FileIcon({ ext }: { ext?: string }) {
  const color =
    ext === "md" ? "#C9A24C"
    : ext === "ts" || ext === "tsx" ? "#60a5fa"
    : ext === "js" || ext === "jsx" ? "#fbbf24"
    : ext === "css" ? "#a78bfa"
    : ext === "json" ? "#34d399"
    : "rgba(120,113,108,0.7)";
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path d="M3 2h7l3 3v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke={color} strokeWidth="1.1" />
      <path d="M10 2v3h3" stroke={color} strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon({ open }: { open?: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M1 4h5l1.5 1.5H15v8H1V4z"
        stroke={open ? "rgba(201,162,76,0.7)" : "rgba(201,162,76,0.45)"}
        strokeWidth="1.1"
        fill={open ? "rgba(201,162,76,0.07)" : "none"}
      />
    </svg>
  );
}

function buildTree(items: GhTreeItem[]): GhTreeNode[] {
  const root: GhTreeNode[] = [];
  const map: Record<string, GhTreeNode> = {};

  const sorted = [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const item of sorted) {
    const parts = item.path.split("/");
    const name = parts[parts.length - 1];
    const ext = name.includes(".") ? name.split(".").pop() : undefined;
    const node: GhTreeNode = { name, path: item.path, type: item.type, ext, children: item.type === "tree" ? [] : undefined };
    map[item.path] = node;

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = map[parentPath];
      if (parent?.children) parent.children.push(node);
    }
  }

  return root;
}

interface GhTreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  ext?: string;
  children?: GhTreeNode[];
}

function GhTreeNodeRow({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: GhTreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isSelected = selectedPath === node.path;

  if (node.type === "tree") {
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            width: "100%", display: "flex", alignItems: "center",
            gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
            background: "transparent", border: "none", cursor: "pointer",
            borderRadius: 3, transition: "background 100ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.04)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ flexShrink: 0, opacity: 0.35, transform: open ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 130ms ease" }}>
            <path d="M2 1l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <FolderIcon open={open} />
          <span style={{ fontSize: 11.5, color: "rgba(231,229,228,0.6)", fontFamily: "var(--app-font-sans)", textAlign: "left" }}>
            {node.name}
          </span>
        </button>
        {open && node.children?.map((child) => (
          <GhTreeNodeRow key={child.path} node={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      style={{
        width: "100%", display: "flex", alignItems: "center",
        gap: 5, padding: `3px 8px 3px ${8 + depth * 12}px`,
        background: isSelected ? "rgba(201,162,76,0.09)" : "transparent",
        border: "none", cursor: "pointer", borderRadius: 3,
        transition: "background 100ms ease",
        borderLeft: isSelected ? "2px solid rgba(201,162,76,0.55)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
    >
      <FileIcon ext={node.ext} />
      <span style={{ fontSize: 11.5, color: isSelected ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.5)", fontFamily: "var(--app-font-sans)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {node.name}
      </span>
    </button>
  );
}

function FilesTab({
  projectId,
  onFileContext,
  onLinkedRepoChange,
}: {
  projectId: number;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
}) {
  const updateProject = useUpdateProject();
  const { data: filesProject } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });

  const [tokenState, setTokenState] = useState<string | null>(null);
  const tokenSynced = useRef(false);
  useEffect(() => {
    if (!filesProject || tokenSynced.current) return;
    tokenSynced.current = true;
    setTokenState(filesProject.githubToken ?? null);
  }, [filesProject]);
  const [tokenInput, setTokenInput] = useState("");
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GhRepo | null>(null);
  const [tree, setTree] = useState<GhTreeNode[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState("main");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<GhFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [view, setView] = useState<"repos" | "tree" | "file">("repos");
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const autoLoadedRef = useRef(false);

  // Reset auto-load gate when project switches
  useEffect(() => {
    autoLoadedRef.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView("repos");
    onFileContext(null);
  }, [projectId]);

  const saveToken = (t: string) => {
    updateProject.mutate({ id: projectId, data: { githubToken: t } });
    setTokenState(t);
  };

  const clearToken = () => {
    updateProject.mutate({ id: projectId, data: { githubToken: null } });
    setTokenState(null);
    setRepos([]); setSelectedRepo(null); setTree([]);
    setSelectedPath(null); setFileContent(null);
    setView("repos");
    onFileContext(null);
  };

  const ghFetch = useCallback(async (path: string) => {
    const res = await fetch(path, { headers: { "x-github-token": tokenState! } });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `HTTP ${res.status}`);
    }
    return res.json();
  }, [tokenState]);

  useEffect(() => {
    if (!tokenState) return;
    setReposLoading(true);
    setReposError(null);
    ghFetch("/api/github/repos")
      .then((data) => setRepos(data as GhRepo[]))
      .catch((e) => setReposError(e.message))
      .finally(() => setReposLoading(false));
  }, [tokenState, ghFetch]);

  const loadTree = useCallback(async (repo: GhRepo) => {
    setSelectedRepo(repo);
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
      const nodes = buildTree((data.tree as GhTreeItem[]).filter(i => i.type === "blob" || i.type === "tree"));
      setTree(nodes);
    } catch (e: any) {
      setTreeError(e.message);
    } finally {
      setTreeLoading(false);
    }
  }, [ghFetch, onFileContext]);

  // Auto-load linked repo once repos are available (from DB)
  useEffect(() => {
    if (autoLoadedRef.current || repos.length === 0 || !filesProject?.linkedRepo) return;
    try {
      const savedRepo = JSON.parse(filesProject.linkedRepo) as GhRepo;
      const match = repos.find(r => r.fullName === savedRepo.fullName);
      if (match) {
        autoLoadedRef.current = true;
        loadTree(match);
      }
    } catch {}
  }, [repos, filesProject?.linkedRepo, loadTree]);

  // Link a repo to this project and load its tree
  const pickRepo = useCallback((repo: GhRepo) => {
    updateProject.mutate({ id: projectId, data: { linkedRepo: JSON.stringify(repo) } });
    onLinkedRepoChange(repo);
    loadTree(repo);
  }, [projectId, updateProject, onLinkedRepoChange, loadTree]);

  // Unlink the repo from this project
  const unlinkRepo = useCallback(() => {
    updateProject.mutate({ id: projectId, data: { linkedRepo: null } });
    onLinkedRepoChange(null);
    autoLoadedRef.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView("repos");
    onFileContext(null);
  }, [projectId, updateProject, onLinkedRepoChange, onFileContext]);

  const loadFile = useCallback(async (path: string) => {
    if (!selectedRepo) return;
    setSelectedPath(path);
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

  // Token setup screen
  if (!tokenState) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 14 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" opacity={0.25}>
          <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 6.8c.85.004 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" fill="var(--atlas-fg)" />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.7, fontWeight: 500, marginBottom: 5 }}>Connect GitHub</div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6, opacity: 0.6 }}>
            Paste a GitHub personal access token<br />to browse your repos.
          </div>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 7 }}>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) saveToken(tokenInput.trim()); }}
            placeholder="ghp_…"
            autoComplete="off"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
              color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
              outline: "none", boxSizing: "border-box",
              transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
          />
          <button
            onClick={() => tokenInput.trim() && saveToken(tokenInput.trim())}
            disabled={!tokenInput.trim()}
            style={{
              padding: "7px", borderRadius: 6, width: "100%",
              background: tokenInput.trim() ? "var(--atlas-ember)" : "rgba(37,34,32,0.6)",
              border: "none", color: "var(--atlas-fg)", fontSize: 10,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: tokenInput.trim() ? "pointer" : "not-allowed",
              transition: "background 160ms ease",
            }}
          >
            Connect
          </button>
        </div>
        <a
          href="https://github.com/settings/tokens/new?description=Atlas+Dev+Env&scopes=repo"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 9.5, color: "var(--atlas-gold)", opacity: 0.6, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}
        >
          Create token on GitHub →
        </a>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header breadcrumb */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <button
          onClick={() => { setView("repos"); setSelectedRepo(null); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: view === "repos" ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: view === "repos" ? 0.8 : 0.45, flexShrink: 0 }}
        >
          repos
        </button>
        {selectedRepo && (
          <>
            <span style={{ color: "var(--atlas-border)", fontSize: 10, flexShrink: 0 }}>/</span>
            <button
              onClick={() => { setView("tree"); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
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
              title="Unlink repo from this project"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", opacity: 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
            >
              unlink
            </button>
          )}
          {disconnectConfirm ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, padding: "3px 7px" }}>
              <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "rgba(252,165,165,0.85)", letterSpacing: "0.04em" }}>Disconnect GitHub?</span>
              <button
                onClick={() => setDisconnectConfirm(false)}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", padding: "1px 6px", opacity: 0.7 }}
              >Cancel</button>
              <button
                onClick={() => { setDisconnectConfirm(false); clearToken(); }}
                style={{ background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 4, cursor: "pointer", color: "rgba(252,165,165,0.9)", fontSize: 9, fontFamily: "var(--app-font-mono)", padding: "1px 6px" }}
              >Disconnect</button>
            </div>
          ) : (
            <button
              onClick={() => setDisconnectConfirm(true)}
              title="Disconnect GitHub"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1, opacity: 0.3, padding: "0 2px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.3")}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Repos list */}
      {view === "repos" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }} className="scrollbar-none">
          {reposLoading && (
            <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 10, ...sMuted, opacity: 0.4 }}>
              Loading repos…
            </div>
          )}
          {reposError && (
            <div style={{ padding: "16px 12px", textAlign: "center", fontSize: 11, color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)" }}>
              {reposError}
            </div>
          )}
          {!reposLoading && repos.map((repo) => {
            let linkedFullName: string | null = null;
            try {
              linkedFullName = filesProject?.linkedRepo ? JSON.parse(filesProject.linkedRepo).fullName : null;
            } catch {}
            const isLinked = linkedFullName === repo.fullName;
            return (
              <button
                key={repo.id}
                onClick={() => pickRepo(repo)}
                style={{
                  width: "100%", display: "flex", flexDirection: "column", gap: 3,
                  padding: "8px 10px", borderRadius: 5, marginBottom: 2,
                  background: isLinked ? "rgba(52,211,153,0.04)" : "transparent",
                  border: `1px solid ${isLinked ? "rgba(52,211,153,0.15)" : "transparent"}`,
                  cursor: "pointer", textAlign: "left",
                  transition: "all 120ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!isLinked) { e.currentTarget.style.background = "rgba(201,162,76,0.04)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.12)"; }
                }}
                onMouseLeave={(e) => {
                  if (!isLinked) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {isLinked && (
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
                  )}
                  <span style={{ fontSize: 12, color: isLinked ? "rgba(231,229,228,0.92)" : "rgba(231,229,228,0.75)", fontFamily: "var(--app-font-sans)", fontWeight: isLinked ? 600 : 500 }}>{repo.name}</span>
                  {repo.private && (
                    <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 3, background: "rgba(120,113,108,0.12)", color: "var(--atlas-muted)", border: "0.5px solid rgba(120,113,108,0.2)" }}>
                      private
                    </span>
                  )}
                  {repo.language && (
                    <span style={{ fontSize: 8.5, color: "var(--atlas-muted)", marginLeft: "auto", fontFamily: "var(--app-font-mono)", opacity: 0.55 }}>{repo.language}</span>
                  )}
                </div>
                {repo.description && (
                  <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.55, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: isLinked ? 11 : 0 }}>
                    {repo.description}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* File tree */}
      {view === "tree" && (
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
          {!treeLoading && tree.map((node) => (
            <GhTreeNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={loadFile} />
          ))}
        </div>
      )}

      {/* File content */}
      {view === "file" && (
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
                  color: "rgba(231,229,228,0.65)",
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
    </div>
  );
}

// ── Preview tab ──────────────────────────────────────────────────────────────
function PreviewTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const updateProject = useUpdateProject();

  // Mode toggle
  const [previewMode, setPreviewMode] = useState<"url" | "local">("url");

  // ── URL mode state ──────────────────────────────────────────────────────────
  const storageKey = `atlas-preview-${projectId}`;
  const [urlInput, setUrlInput] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [iframeError, setIframeError] = useState(false);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectResults, setDetectResults] = useState<Array<{ url: string; platform: string; confidence: string }>>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [savedIndicator, setSavedIndicator] = useState(false);

  // ── Local dev server state ──────────────────────────────────────────────────
  type DevStatus = "idle" | "cloning" | "installing" | "starting" | "running" | "error";
  const [devStatus, setDevStatus] = useState<DevStatus>("idle");
  const [devPort, setDevPort] = useState<number | null>(null);
  const [devLogs, setDevLogs] = useState<string[]>([]);
  const [devError, setDevError] = useState<string | null>(null);
  const [devReloadKey, setDevReloadKey] = useState(0);
  const devLogRef = useRef<HTMLDivElement>(null);

  const { data: previewProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const linkedRepo = (() => { try { return previewProject?.linkedRepo ? JSON.parse(previewProject.linkedRepo) as { fullName: string; defaultBranch?: string } : null; } catch { return null; } })();
  const token = previewProject?.githubToken ?? null;

  // Poll dev server status when in local mode
  useEffect(() => {
    if (previewMode !== "local") return;
    const poll = async () => {
      try {
        const r = await fetch("/api/devserver/status");
        if (!r.ok) return;
        const d = await r.json() as { status: DevStatus; port: number | null; logs: string[]; errorMsg: string | null };
        setDevStatus(d.status);
        setDevPort(d.port);
        setDevLogs(d.logs);
        setDevError(d.errorMsg);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [previewMode]);

  // Auto-scroll logs
  useEffect(() => {
    if (devLogRef.current) devLogRef.current.scrollTop = devLogRef.current.scrollHeight;
  }, [devLogs]);

  const startDev = async () => {
    if (!linkedRepo || !token) return;
    try {
      const r = await fetch("/api/devserver/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({ repoFullName: linkedRepo.fullName, branch: linkedRepo.defaultBranch ?? "main" }),
      });
      if (r.ok) {
        const d = await r.json() as { status: DevStatus };
        setDevStatus(d.status);
        setDevLogs([]);
        setDevPort(null);
        setDevReloadKey((k) => k + 1);
      }
    } catch {}
  };

  const stopDev = async () => {
    try {
      await fetch("/api/devserver/stop", { method: "POST" });
      setDevStatus("idle");
      setDevPort(null);
      setDevLogs([]);
    } catch {}
  };

  // Sync from DB on project load / switch
  useEffect(() => {
    const dbUrl = project?.previewUrl ?? "";
    const legacyUrl = (() => { try { return localStorage.getItem(storageKey) || ""; } catch { return ""; } })();
    const resolved = dbUrl || legacyUrl;
    setUrlInput(resolved);
    setLiveUrl(resolved);
    setIframeError(false);
    setIframeLoading(!!resolved);
    setDetectResults([]);
  }, [projectId, project?.previewUrl]);

  const normalize = (raw: string) =>
    raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;

  const applyUrl = (url: string) => {
    const u = normalize(url);
    setUrlInput(u);
    setLiveUrl(u);
    setIframeError(false);
    setIframeLoading(true);
    setReloadKey((k) => k + 1);
    try { localStorage.setItem(storageKey, u); } catch {}
  };

  const handleGo = () => { if (urlInput.trim()) applyUrl(urlInput.trim()); };

  const handleSaveToProject = () => {
    if (!liveUrl) return;
    updateProject.mutate(
      { id: projectId, data: { previewUrl: liveUrl } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setSavedIndicator(true);
          setTimeout(() => setSavedIndicator(false), 2500);
        },
      }
    );
  };

  const handleClear = () => {
    setLiveUrl(""); setUrlInput(""); setIframeError(false); setIframeLoading(false);
    setDetectResults([]);
    try { localStorage.removeItem(storageKey); } catch {}
    updateProject.mutate({ id: projectId, data: { previewUrl: null } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }),
    });
  };

  const handleDetect = async () => {
    if (!linkedRepo || !token) return;
    setDetecting(true);
    setDetectResults([]);
    try {
      const res = await fetch(`/api/github/deployment?repo=${encodeURIComponent(linkedRepo.fullName)}`, {
        headers: { "x-github-token": token },
      });
      if (res.ok) {
        const data = await res.json() as { detected: Array<{ url: string; platform: string; confidence: string }>; suggestions: Array<{ url: string; platform: string; confidence: string }> };
        const all = [...data.detected, ...data.suggestions.filter(s => !data.detected.find(d => d.url === s.url))];
        setDetectResults(all);
      }
    } catch {}
    setDetecting(false);
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };
  const platformColor = (p: string) => {
    if (p === "Vercel") return "rgba(255,255,255,0.75)";
    if (p === "Netlify") return "rgba(110,231,183,0.8)";
    if (p === "GitHub Pages") return "rgba(147,197,253,0.8)";
    if (p === "Replit") return "rgba(201,162,76,0.85)";
    return "var(--atlas-muted)";
  };

  const devStatusColor = () => {
    if (devStatus === "running") return "rgba(134,239,172,0.85)";
    if (devStatus === "error") return "rgba(252,165,165,0.85)";
    if (devStatus === "idle") return "var(--atlas-muted)";
    return "rgba(201,162,76,0.85)";
  };
  const devStatusLabel = () => {
    if (devStatus === "idle") return "Idle";
    if (devStatus === "cloning") return "Cloning repo…";
    if (devStatus === "installing") return "Installing deps…";
    if (devStatus === "starting") return "Starting server…";
    if (devStatus === "running") return `Running on :${devPort}`;
    if (devStatus === "error") return "Error";
    return devStatus;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        {(["url", "local"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPreviewMode(m)}
            style={{
              flex: 1, padding: "7px 0", background: "transparent", border: "none",
              borderBottom: previewMode === m ? "2px solid var(--atlas-gold)" : "2px solid transparent",
              color: previewMode === m ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
              opacity: previewMode === m ? 1 : 0.45,
              transition: "all 140ms ease",
            }}
          >
            {m === "url" ? "Live URL" : "Local Dev"}
          </button>
        ))}
      </div>

      {/* ── URL mode ── */}
      {previewMode === "url" && (
        <>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <div style={{ position: "relative", flex: 1, display: "flex", alignItems: "center" }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: 8, opacity: 0.25, flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="6" stroke="var(--atlas-fg)" strokeWidth="1.4" />
                  <path d="M8 2c-2 3-2 9 0 12M2 8h12" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
                <input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleGo()}
                  placeholder="Paste your deployment URL…"
                  style={{
                    width: "100%", paddingLeft: 26, paddingRight: 8, paddingTop: 5, paddingBottom: 5,
                    borderRadius: 5, background: "rgba(12,10,9,0.7)",
                    border: "1px solid var(--atlas-border)",
                    color: "var(--atlas-fg)", fontSize: 10.5, ...sMono, outline: "none",
                    transition: "border-color 160ms ease",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                />
              </div>
              <button onClick={handleGo} style={{
                padding: "5px 10px", borderRadius: 5, background: "var(--atlas-ember)",
                border: "none", color: "var(--atlas-fg)", fontSize: 10, ...sMono,
                letterSpacing: "0.08em", cursor: "pointer", flexShrink: 0,
              }}>Go</button>
              {liveUrl && (
                <>
                  <button
                    onClick={() => { setIframeError(false); setIframeLoading(true); setReloadKey((k) => k + 1); }}
                    title="Reload"
                    style={{ padding: "5px 7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0, lineHeight: 1, opacity: 0.55, transition: "opacity 160ms ease" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
                  >↺</button>
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                    style={{ padding: "5px 7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 10, lineHeight: 1, ...sMono, opacity: 0.55, textDecoration: "none", flexShrink: 0, transition: "opacity 160ms ease", display: "flex", alignItems: "center" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
                  >↗</a>
                  <button onClick={handleClear} title="Clear"
                    style={{ padding: "5px 7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 13, cursor: "pointer", flexShrink: 0, lineHeight: 1, opacity: 0.4, transition: "opacity 160ms ease" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.4")}
                  >×</button>
                </>
              )}
            </div>
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center" }}>
              {linkedRepo && token ? (
                <button onClick={handleDetect} disabled={detecting} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: detecting ? "rgba(255,255,255,0.04)" : "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: detecting ? "var(--atlas-muted)" : "var(--atlas-gold)", cursor: detecting ? "not-allowed" : "pointer", flexShrink: 0 }}>
                  {detecting ? "Detecting…" : "Auto-detect URL"}
                </button>
              ) : (
                <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.35 }}>Link a repo in Files to auto-detect URL</div>
              )}
              {liveUrl && (
                <button onClick={handleSaveToProject} disabled={savedIndicator || updateProject.isPending} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: savedIndicator ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${savedIndicator ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`, color: savedIndicator ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", cursor: savedIndicator ? "default" : "pointer", flexShrink: 0, transition: "all 160ms ease" }}>
                  {savedIndicator ? "✓ Saved" : project?.previewUrl === liveUrl ? "Saved to project" : "Save to project"}
                </button>
              )}
            </div>
            {detectResults.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 8.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.4, letterSpacing: "0.08em", textTransform: "uppercase" }}>Detected / suggested</div>
                {detectResults.slice(0, 4).map((r) => (
                  <button key={r.url} onClick={() => { applyUrl(r.url); setDetectResults([]); }}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, width: "100%", textAlign: "left", background: "rgba(255,255,255,0.03)", border: "1px solid var(--atlas-border)", cursor: "pointer", transition: "border-color 120ms ease" }}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.3)")}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                  >
                    <span style={{ fontSize: 8.5, ...sMono, color: platformColor(r.platform), opacity: 0.85, flexShrink: 0 }}>{r.platform}</span>
                    {r.confidence === "high" && <span style={{ fontSize: 7.5, ...sMono, color: "rgba(134,239,172,0.6)", flexShrink: 0 }}>✓ confirmed</span>}
                    <span style={{ flex: 1, fontSize: 9.5, ...sMono, color: "var(--atlas-fg)", opacity: 0.55, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.url}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {liveUrl && !iframeError ? (
            <div style={{ flex: 1, position: "relative" }}>
              {iframeLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--atlas-bg)", zIndex: 2 }}>
                  <LoadingSpinner size="sm" color="atlas" />
                  <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Loading preview…</div>
                </div>
              )}
              <iframe key={`${liveUrl}-${reloadKey}`} src={liveUrl} title="Preview"
                style={{ flex: 1, border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                onLoad={() => setIframeLoading(false)}
                onError={() => { setIframeError(true); setIframeLoading(false); }}
              />
            </div>
          ) : iframeError ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity={0.18}><circle cx="12" cy="12" r="9" stroke="var(--atlas-fg)" strokeWidth="1.4" /><path d="M12 8v4M12 16h.01" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" /></svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.5, textAlign: "center", lineHeight: 1.7 }}>This site blocks embedding.<br />Use the arrow to open it in a new tab.</div>
              <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 14px", borderRadius: 5, fontSize: 10, ...sMono, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", textDecoration: "none", letterSpacing: "0.08em" }}>Open in new tab ↗</a>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" opacity={0.12}><rect x="2" y="5" width="24" height="18" rx="2" stroke="var(--atlas-fg)" strokeWidth="1.5" /><path d="M2 10h24" stroke="var(--atlas-fg)" strokeWidth="1.5" /><circle cx="6" cy="7.5" r="1" fill="var(--atlas-fg)" /><circle cx="10" cy="7.5" r="1" fill="var(--atlas-fg)" /></svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                {linkedRepo ? <>Click <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Auto-detect URL</strong> to find<br />your live deployment automatically.</> : <>Paste your deployment URL above,<br />or link a GitHub repo in Files<br />to auto-detect it.</>}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Local Dev mode ── */}
      {previewMode === "local" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Controls bar */}
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
            {/* Status dot + label */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, flex: 1, minWidth: 0 }}>
              <div style={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                background: devStatusColor(),
                boxShadow: devStatus === "running" ? `0 0 6px ${devStatusColor()}` : "none",
                transition: "all 400ms ease",
              }} />
              <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: devStatusColor(), letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {devStatusLabel()}
              </span>
            </div>
            {/* Action buttons */}
            {devStatus === "running" || devStatus === "cloning" || devStatus === "installing" || devStatus === "starting" ? (
              <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
                {devStatus === "running" && (
                  <button
                    onClick={() => setDevReloadKey((k) => k + 1)}
                    title="Reload preview"
                    style={{ padding: "4px 8px", borderRadius: 4, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 11, cursor: "pointer", lineHeight: 1, opacity: 0.6 }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                  >↺</button>
                )}
                <button
                  onClick={stopDev}
                  style={{ padding: "4px 9px", borderRadius: 4, background: "rgba(220,38,38,0.1)", border: "1px solid rgba(220,38,38,0.25)", color: "rgba(252,165,165,0.85)", fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: "pointer" }}
                >Stop</button>
              </div>
            ) : (
              <button
                onClick={startDev}
                disabled={!linkedRepo || !token}
                title={!linkedRepo || !token ? "Link a GitHub repo in the Files tab first" : `Start dev server for ${linkedRepo?.fullName}`}
                style={{ padding: "4px 11px", borderRadius: 4, background: linkedRepo && token ? "rgba(201,162,76,0.12)" : "rgba(255,255,255,0.04)", border: `1px solid ${linkedRepo && token ? "rgba(201,162,76,0.3)" : "var(--atlas-border)"}`, color: linkedRepo && token ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", cursor: linkedRepo && token ? "pointer" : "not-allowed", flexShrink: 0, opacity: linkedRepo && token ? 1 : 0.4 }}
              >
                {devStatus === "error" ? "Retry" : "Start"}
              </button>
            )}
          </div>

          {/* No repo warning */}
          {(!linkedRepo || !token) && devStatus === "idle" && (
            <div style={{ padding: "10px 12px", flexShrink: 0, borderBottom: "1px solid var(--atlas-border)" }}>
              <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, lineHeight: 1.6 }}>
                Link a GitHub repo in the <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Files</strong> tab to start a local dev server.
              </div>
            </div>
          )}

          {/* Error message */}
          {devStatus === "error" && devError && (
            <div style={{ padding: "8px 12px", flexShrink: 0, borderBottom: "1px solid var(--atlas-border)", background: "rgba(220,38,38,0.05)" }}>
              <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "rgba(252,165,165,0.7)", lineHeight: 1.5 }}>{devError}</div>
            </div>
          )}

          {/* Log output */}
          {devLogs.length > 0 && devStatus !== "running" && (
            <div
              ref={devLogRef}
              style={{ flexShrink: 0, maxHeight: 160, overflowY: "auto", padding: "6px 10px", borderBottom: "1px solid var(--atlas-border)", background: "rgba(0,0,0,0.25)" }}
              className="scrollbar-none"
            >
              {devLogs.map((line, i) => (
                <div key={i} style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.65, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {line}
                </div>
              ))}
            </div>
          )}

          {/* Preview iframe when running */}
          {devStatus === "running" ? (
            <div style={{ flex: 1, position: "relative" }}>
              <iframe
                key={`devserver-${devReloadKey}`}
                src="/api/devserver/proxy"
                title="Local Dev Preview"
                style={{ border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
              />
            </div>
          ) : devStatus === "idle" && linkedRepo && token ? (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 10 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" opacity={0.12}><rect x="3" y="3" width="18" height="18" rx="2" stroke="var(--atlas-fg)" strokeWidth="1.5" /><path d="M9 9l6 3-6 3V9z" fill="var(--atlas-fg)" /></svg>
              <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.7 }}>
                Click <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Start</strong> to clone and run<br />{linkedRepo.fullName} locally.
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── MemoryTab ─────────────────────────────────────────────────────────────────
function MemoryTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project, isLoading } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const memory = project?.memory ?? "";

  const startEdit = () => {
    setDraft(memory);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: draft.trim() || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setEditing(false);
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const clear = async () => {
    if (!window.confirm("Clear all project memory? This cannot be undone.")) return;
    setSaving(true);
    updateProject.mutate(
      { id: projectId, data: { memory: null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
        },
        onSettled: () => setSaving(false),
      }
    );
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 10, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, ...sMono, letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.6 }}>project memory</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          {!editing && memory && (
            <button
              onClick={clear}
              disabled={saving}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.35, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.35")}
            >
              clear
            </button>
          )}
          {!editing && (
            <button
              onClick={startEdit}
              style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, letterSpacing: "0.06em", color: "var(--atlas-gold)", opacity: 0.55, padding: "2px 4px" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
            >
              edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={() => setEditing(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.4, padding: "2px 4px" }}
              >
                cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                style={{ background: "var(--atlas-ember)", border: "none", cursor: saving ? "not-allowed" : "pointer", fontSize: 9, ...sMono, letterSpacing: "0.08em", color: "var(--atlas-fg)", padding: "2px 8px", borderRadius: 4, opacity: saving ? 0.5 : 1 }}
              >
                {saving ? "saving…" : "save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px" }} className="scrollbar-none">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", height: "100%", minHeight: 200, resize: "none",
              background: "rgba(12,10,9,0.6)", border: "1px solid rgba(201,162,76,0.25)",
              borderRadius: 6, color: "var(--atlas-fg)", fontSize: 11,
              ...sMono, lineHeight: 1.65, padding: "10px 12px",
              outline: "none", boxSizing: "border-box",
            }}
          />
        ) : memory ? (
          <pre style={{
            margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word",
            fontSize: 11, color: "var(--atlas-fg)", opacity: 0.75, lineHeight: 1.7,
            ...sMono,
          }}>
            {memory}
          </pre>
        ) : (
          <div style={{ padding: "48px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.7, ...sMono }}>
              Nothing here yet.<br />
              As we work together, I'll build up<br />
              context about this project automatically.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MapTab ────────────────────────────────────────────────────────────────────
function MapSection({ label, items, color = "var(--atlas-muted)" }: { label: string; items: string[]; color?: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
        textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.5, marginBottom: 7,
      }}>
        {label} <span style={{ opacity: 0.5 }}>({items.length})</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {items.map((item) => (
          <span key={item} style={{
            padding: "3px 8px", borderRadius: 4,
            background: "rgba(255,255,255,0.04)", border: "1px solid var(--atlas-border)",
            fontSize: 10.5, fontFamily: "var(--app-font-mono)",
            color, opacity: 0.8,
          }}>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function MapTab({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const updateProject = useUpdateProject();

  const scanKey = `atlas-scan-${projectId}`;
  const [scan, setScan] = useState<ProjectScan | null>(() => {
    try {
      const raw = localStorage.getItem(scanKey);
      return raw ? JSON.parse(raw) as ProjectScan : null;
    } catch { return null; }
  });
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToMemory, setSavedToMemory] = useState(false);

  const { data: mapProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = mapProject?.githubToken ?? null;
  const linkedRepo = (() => { try { return mapProject?.linkedRepo ? JSON.parse(mapProject.linkedRepo) as { fullName: string; defaultBranch: string } : null; } catch { return null; } })();

  const handleScan = async () => {
    if (!linkedRepo || !token) return;
    setScanning(true);
    setError(null);
    setSavedToMemory(false);
    try {
      const res = await fetch("/api/github/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({ repo: linkedRepo.fullName, branch: linkedRepo.defaultBranch }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as any;
        throw new Error(d.error || `HTTP ${res.status}`);
      }
      const data = await res.json() as ProjectScan;
      setScan(data);
      try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
    } catch (e: any) {
      setError(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const handleSaveToMemory = () => {
    if (!scan) return;
    const scanBlock = [
      `[Project map — ${scan.repo} — scanned ${scan.scannedAt.slice(0, 10)}]`,
      `Description: ${scan.description}`,
      `Stack: ${(scan.stack || []).join(", ")}`,
      `Routes (${scan.routes?.length ?? 0}): ${(scan.routes || []).slice(0, 12).join(", ")}`,
      `Pages: ${(scan.pages || []).slice(0, 12).join(", ")}`,
      `Supabase tables: ${(scan.tables || []).join(", ")}`,
      `Auth enabled: ${scan.authEnabled ? "yes" : "not found"}`,
      `Total files: ${scan.totalFiles}`,
    ].join("\n");

    const existing = project?.memory ?? "";
    const updated = existing.trim() ? `${existing.trim()}\n\n${scanBlock}` : scanBlock;

    updateProject.mutate(
      { id: projectId, data: { memory: updated } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
          setSavedToMemory(true);
        },
      }
    );
  };

  const sMono: React.CSSProperties = { fontFamily: "var(--app-font-mono)" };

  if (!linkedRepo) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 12 }}>
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" opacity={0.2}>
          <rect x="1" y="1" width="30" height="30" rx="6" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 10h16M8 16h12M8 22h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.7 }}>
          Link a repo in the <strong style={{ color: "var(--atlas-fg)", opacity: 0.65 }}>Files</strong> tab first,<br />
          then come back here to map your project.
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid var(--atlas-border)",
        flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, ...sMono, letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.5 }}>
            {linkedRepo.fullName}
          </div>
          {scan && (
            <div style={{ fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.3, marginTop: 1 }}>
              Scanned {scan.scannedAt.slice(0, 10)} · {scan.totalFiles} files
            </div>
          )}
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          style={{
            padding: "5px 12px", borderRadius: 5, fontSize: 10, fontWeight: 600,
            ...sMono, letterSpacing: "0.08em",
            background: scanning
              ? "rgba(120,113,108,0.15)"
              : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: scanning ? "var(--atlas-muted)" : "var(--atlas-bg)",
            border: "none", cursor: scanning ? "not-allowed" : "pointer",
            transition: "all 160ms ease", flexShrink: 0,
          }}
        >
          {scanning ? "Scanning…" : scan ? "Re-scan" : "Scan Project"}
        </button>
      </div>

      {/* Scanning spinner */}
      {scanning && (
        <div style={{ padding: "24px 14px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}><LoadingSpinner size="sm" color="atlas" /></div>
          <div style={{ marginTop: 10, fontSize: 10, ...sMono, color: "var(--atlas-muted)", opacity: 0.45 }}>
            Reading key files and mapping structure…
          </div>
        </div>
      )}

      {/* Error */}
      {error && !scanning && (
        <div style={{
          margin: "10px 12px", padding: "9px 12px", borderRadius: 6,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
          fontSize: 11, color: "rgba(252,165,165,0.8)",
        }}>
          {error}
        </div>
      )}

      {/* Empty state */}
      {!scan && !scanning && !error && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", lineHeight: 1.8, textAlign: "center", opacity: 0.55, ...sMono }}>
            Click <strong style={{ color: "var(--atlas-gold)" }}>Scan Project</strong> to map<br />
            your routes, components, and tables.
          </div>
        </div>
      )}

      {/* Results */}
      {scan && !scanning && (
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 20px" }} className="scrollbar-none">
          {/* Project name + summary */}
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 5 }}>
              {scan.projectName}
            </div>
            <div style={{ fontSize: 12, color: "var(--atlas-fg)", opacity: 0.65, lineHeight: 1.7 }}>
              {scan.summary}
            </div>
          </div>

          {/* Stack badges */}
          {scan.stack && scan.stack.length > 0 && (
            <div style={{ marginBottom: 18, display: "flex", flexWrap: "wrap", gap: 5 }}>
              {scan.stack.map((s) => (
                <span key={s} style={{
                  padding: "3px 9px", borderRadius: 20,
                  background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", opacity: 0.85,
                }}>
                  {s}
                </span>
              ))}
              {scan.authEnabled && (
                <span style={{
                  padding: "3px 9px", borderRadius: 20,
                  background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(134,239,172,0.85)",
                }}>
                  Auth ✓
                </span>
              )}
            </div>
          )}

          <MapSection label="Routes" items={scan.routes || []} color="rgba(147,197,253,0.8)" />
          <MapSection label="Pages" items={scan.pages || []} color="rgba(216,180,254,0.8)" />
          <MapSection label="Components" items={scan.components || []} color="rgba(231,229,228,0.7)" />
          <MapSection label="Supabase Tables" items={scan.tables || []} color="rgba(110,231,183,0.8)" />

          {/* Stats row */}
          <div style={{
            marginTop: 4, marginBottom: 18, padding: "9px 12px", borderRadius: 7,
            background: "rgba(255,255,255,0.025)", border: "1px solid var(--atlas-border)",
            display: "flex", gap: 20,
          }}>
            {[
              ["Routes", scan.routes?.length ?? 0],
              ["Components", scan.components?.length ?? 0],
              ["Tables", scan.tables?.length ?? 0],
              ["Files", scan.totalFiles],
            ].map(([label, val]) => (
              <div key={label as string} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--atlas-fg)" }}>{val}</div>
                <div style={{ fontSize: 9, ...sMono, color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.06em" }}>
                  {label as string}
                </div>
              </div>
            ))}
          </div>

          {/* Save to memory */}
          <button
            onClick={handleSaveToMemory}
            disabled={savedToMemory || updateProject.isPending}
            style={{
              width: "100%", padding: "8px", borderRadius: 6,
              background: savedToMemory ? "rgba(34,197,94,0.1)" : "rgba(201,162,76,0.08)",
              border: `1px solid ${savedToMemory ? "rgba(34,197,94,0.25)" : "rgba(201,162,76,0.2)"}`,
              color: savedToMemory ? "rgba(134,239,172,0.8)" : "var(--atlas-gold)",
              fontSize: 10, ...sMono, letterSpacing: "0.08em",
              cursor: savedToMemory ? "default" : "pointer",
              transition: "all 160ms ease",
            }}
          >
            {savedToMemory ? "✓ Saved to Atlas Memory" : "Save map to Atlas Memory"}
          </button>
          <div style={{ marginTop: 7, fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.6 }}>
            Saving adds this map to project memory so Atlas knows your structure in every future chat.
          </div>
        </div>
      )}
    </div>
  );
}

// ── UserProfilePanel ──────────────────────────────────────────────────────────
function UserProfilePanel({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile>(loadProfile);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveProfile(profile);
    setSaved(true);
    setTimeout(() => { setSaved(false); onClose(); }, 700);
  };

  const field = (label: string, key: keyof UserProfile, placeholder: string, multiline?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>
        {label}
      </label>
      {multiline ? (
        <textarea
          value={profile[key]}
          onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          rows={3}
          style={{
            width: "100%", resize: "none", padding: "8px 10px", borderRadius: 6,
            background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
            outline: "none", boxSizing: "border-box", lineHeight: 1.6,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      ) : (
        <input
          type="text"
          value={profile[key]}
          onChange={(e) => setProfile((p) => ({ ...p, [key]: e.target.value }))}
          placeholder={placeholder}
          style={{
            width: "100%", padding: "8px 10px", borderRadius: 6,
            background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
            outline: "none", boxSizing: "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />
      )}
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
    }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)" }} />
      <div style={{
        position: "relative", zIndex: 1,
        width: 320, height: "100%",
        background: "var(--atlas-surface)",
        borderLeft: "1px solid var(--atlas-border)",
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.4)",
      }}>
        {/* Header */}
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--atlas-border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-fg)", opacity: 0.8 }}>Your Profile</span>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "var(--atlas-muted)", lineHeight: 1, opacity: 0.45, padding: "0 2px" }}>×</button>
        </div>

        {/* Fields */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 14 }} className="scrollbar-none">
          <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, lineHeight: 1.6, fontFamily: "var(--app-font-mono)" }}>
            This gets injected into every conversation so Atlas always knows who you are and what you're building.
          </div>
          {field("Your name", "name", "e.g. Jane")}
          {/* Photo URL */}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-muted)", opacity: 0.55, textTransform: "uppercase" }}>
              Photo URL
            </label>
            {profile.photoUrl && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
                <img src={profile.photoUrl} alt="" style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(201,162,76,0.25)" }} />
              </div>
            )}
            <input
              type="text"
              value={profile.photoUrl ?? ""}
              onChange={(e) => setProfile((p) => ({ ...p, photoUrl: e.target.value }))}
              placeholder="Paste your Google profile photo URL"
              style={{
                width: "100%", padding: "8px 10px", borderRadius: 6,
                background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)",
                color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
            />
            <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.35, lineHeight: 1.5 }}>
              Right-click your Google photo → Copy image address
            </div>
          </div>
          {field("Stack", "stack", "React, Tailwind, Supabase…")}
          {field("Projects", "projects", "Compani, IntoIQ, CoinsBloom…")}
          {field("Notes for Atlas", "notes", "Anything you want it to always know…", true)}
        </div>

        {/* Save */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <button
            onClick={handleSave}
            style={{
              width: "100%", padding: "9px", borderRadius: 6,
              background: saved ? "rgba(52,211,153,0.15)" : "var(--atlas-ember)",
              border: "none", color: saved ? "#34d399" : "var(--atlas-fg)",
              fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
              textTransform: "uppercase", cursor: "pointer",
              transition: "background 200ms ease, color 200ms ease",
            }}
          >
            {saved ? "Saved ✓" : "Save Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RightPanel (tabbed) ──────────────────────────────────────────────────────
function RightPanel({
  projectId,
  entries,
  activeCatch,
  onClose,
  fullscreen,
  onToggleFullscreen,
  onFileContext,
  onLinkedRepoChange,
  pushHistory,
  onRollbackPush,
}: {
  projectId: number;
  entries: Entry[];
  activeCatch: CatchPayload | null;
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
  pushHistory: PushRecord[];
  onRollbackPush: (record: PushRecord) => Promise<void>;
}) {
  const [tab, setTab] = useState<RightTab>("ledger");

  const tabs: { id: RightTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: "ledger",
      label: "Ledger",
      badge: entries.length || undefined,
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="1" width="12" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="3.5" cy="5" r="0.8" fill="currentColor" opacity={0.5} />
          <circle cx="3.5" cy="8" r="0.8" fill="currentColor" opacity={0.5} />
          <circle cx="3.5" cy="11" r="0.8" fill="currentColor" opacity={0.5} />
        </svg>
      ),
    },
    {
      id: "files",
      label: "Files",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M1 5h6l2 2h6v7H1V5z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 5V3a1 1 0 011-1h4l2 2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
    },
    {
      id: "preview",
      label: "Preview",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="3" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1 6h14" stroke="currentColor" strokeWidth="1.1" />
          <circle cx="3.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} />
          <circle cx="5.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} />
        </svg>
      ),
    },
    {
      id: "memory" as RightTab,
      label: "Memory",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5 5.5h6M5 8h6M5 10.5h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
          <circle cx="3.2" cy="5.5" r="0.7" fill="currentColor" opacity={0.45} />
          <circle cx="3.2" cy="8" r="0.7" fill="currentColor" opacity={0.45} />
          <circle cx="3.2" cy="10.5" r="0.7" fill="currentColor" opacity={0.45} />
        </svg>
      ),
    },
    {
      id: "map" as RightTab,
      label: "Map",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M1 3.5l4-1.5 5 2 4-1.5v9.5l-4 1.5-5-2-4 1.5V3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M5 2v9.5M10 4v9.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{
        height: "100%", display: "flex", flexDirection: "column",
        background: "var(--atlas-surface-alt)",
        borderLeft: "1px solid var(--atlas-border)",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex", alignItems: "center",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
          paddingLeft: 4,
        }}
      >
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "10px 12px",
                background: "transparent", border: "none",
                borderBottom: `2px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                cursor: "pointer",
                color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                opacity: active ? 1 : 0.55,
                transition: "all 160ms ease",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: -1,
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.opacity = "0.8"; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.opacity = "0.55"; }}
            >
              {t.icon}
              {t.label}
              {t.badge !== undefined && (
                <span
                  style={{
                    padding: "1px 4px", borderRadius: 3,
                    background: active ? "rgba(201,162,76,0.15)" : "rgba(120,113,108,0.15)",
                    fontSize: 8.5,
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Fullscreen toggle (mobile only) */}
        {onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            title={fullscreen ? "Restore" : "Full screen"}
            style={{
              marginLeft: onClose ? 0 : "auto", marginRight: 2,
              width: 28, height: 28, borderRadius: 6,
              background: "transparent", border: "none",
              color: "var(--atlas-muted)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.5, transition: "opacity 160ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            {fullscreen ? (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M5 1H1v4M11 1h4v4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M1 5V1h4M11 1h4v4M1 11v4h4M15 11v4h-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}

        {/* Close button (mobile only) */}
        {onClose && (
          <button
            onClick={onClose}
            style={{
              marginLeft: onToggleFullscreen ? 0 : "auto", marginRight: 6,
              width: 28, height: 28, borderRadius: 6,
              background: "transparent", border: "none",
              color: "var(--atlas-muted)", fontSize: 16, lineHeight: 1,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              opacity: 0.5, transition: "opacity 160ms ease",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}
          >
            ×
          </button>
        )}
      </div>

      {/* Tab content */}
      {tab === "ledger" && (
        <LedgerTab projectId={projectId} entries={entries} activeCatch={activeCatch} pushHistory={pushHistory} onRollbackPush={onRollbackPush} />
      )}
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
      {tab === "preview" && <PreviewTab projectId={projectId} />}
      {tab === "memory" && <MemoryTab projectId={projectId} />}
      {tab === "map" && <MapTab projectId={projectId} />}
    </div>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────────
export default function Workspace() {
  const { projectId } = useParams();
  const [, setLocation] = useLocation();
  const id = Number(projectId);
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);
  const [memoryChips, setMemoryChips] = useState<string[]>([]);
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [rightOpen, setRightOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [chatWidth, setChatWidth] = useState(() => {
    try { return parseInt(localStorage.getItem("atlas-chat-w") || "0") || 520; } catch { return 520; }
  });

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showSrcPicker, setShowSrcPicker] = useState(false);
  const [srcReadLoading, setSrcReadLoading] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [projectMode, setProjectMode] = useState<"THINK" | "PLAN" | "BUILD">(() => {
    try { return (localStorage.getItem(`atlas-mode-${id}`) as "THINK" | "PLAN" | "BUILD") || "THINK"; } catch { return "THINK"; }
  });
  const [mobileTab, setMobileTab] = useState<"chat" | "ledger" | "workshop">("chat");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const updateProjectHeader = useUpdateProject();

  const ATLAS_SRC_FILES = [
    { label: "workspace.tsx", path: "artifacts/atlas/src/pages/workspace.tsx", hint: "main UI · ~4k lines" },
    { label: "home.tsx", path: "artifacts/atlas/src/pages/home.tsx", hint: "home page" },
    { label: "chat.ts", path: "artifacts/api-server/src/routes/chat.ts", hint: "AI + memory route" },
    { label: "self.ts", path: "artifacts/api-server/src/routes/self.ts", hint: "self-repair route" },
    { label: "projects.ts", path: "artifacts/api-server/src/routes/projects.ts", hint: "projects API" },
  ];

  const handleReadSrc = async (filePath: string) => {
    setShowSrcPicker(false);
    setSrcReadLoading(true);
    try {
      const res = await fetch(`/api/self/read?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { content: string; lines: number };
      const label = filePath.split("/").pop() ?? filePath;
      setFileContext(`// ${label} (${json.lines} lines)\n${json.content}`);
    } catch {
      // silent
    } finally {
      setSrcReadLoading(false);
    }
  };

  const [fileContext, setFileContext] = useState<string | null>(null);
  const [chatPending, setChatPending] = useState(false);
  const [linkedRepo, setLinkedRepo] = useState<LinkedRepo | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resizing = useRef(false);
  const lastX = useRef(0);
  const initialSent = useRef(false);
  const touchStartX = useRef(0);

  const { data: project } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  const { data: sessions, isLoading: sessionsLoading } = useListSessions(id, {
    query: { enabled: !!id, queryKey: getListSessionsQueryKey(id) },
  });
  const { data: entries } = useListEntries(id, {}, { query: { enabled: !!id, queryKey: getListEntriesQueryKey(id, {}) } });
  const createSession = useCreateSession();
  const createEntry = useCreateEntry();

  // Load prior messages when a session already exists (resuming a project)
  const { data: priorMessages } = useListMessages(sessionId ?? 0, {
    query: { enabled: !!sessionId, queryKey: ["messages", sessionId] },
  });
  const priorLoaded = useRef(false);
  useEffect(() => {
    if (!priorMessages || priorMessages.length === 0 || priorLoaded.current || messages.length > 0) return;
    priorLoaded.current = true;
    setMessages(
      priorMessages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        intentType: m.intentType,
        sentAt: m.createdAt,
      }))
    );
  }, [priorMessages]);

  // Sync linkedRepo from project DB when project loads
  useEffect(() => {
    if (!project?.linkedRepo) return;
    try {
      const repo = JSON.parse(project.linkedRepo) as LinkedRepo;
      setLinkedRepo(repo);
    } catch {}
  }, [project?.linkedRepo]);

  // Persist last visited project for footer LEDGER shortcut
  useEffect(() => {
    if (id) { try { localStorage.setItem("atlas-last-project", String(id)); } catch {} }
  }, [id]);

  useEffect(() => {
    if (sessionsLoading) return;
    if (sessions && sessions.length > 0) {
      setSessionId(sessions[0].id);
    } else if (!createSession.isPending && !sessionId) {
      createSession.mutate(
        { projectId: id, data: { title: "Session", mode: "think" } },
        {
          onSuccess: (s) => {
            setSessionId(s.id);
            queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
          },
        }
      );
    }
  }, [sessions, sessionsLoading, id]);

  const doSend = useCallback(
    (text: string, sid: number, currentMessages: ChatMessage[], ctx?: string | null, imageData?: { base64: string; mediaType: string }) => {
      const userMsg: ChatMessage = { role: "user", content: text, sentAt: new Date().toISOString() };
      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const ledgerEntries = (entries || []).map((e: Entry) => ({ id: e.id, title: e.title, status: e.status }));
      const activeCtx = ctx !== undefined ? ctx : fileContext;

      setMessages((prev) => [...prev, userMsg]);
      setChatPending(true);

      const userProfileStr = profileToString(loadProfile());

      const body = {
        sessionId: sid,
        projectId: id,
        message: text,
        mode: "think",
        history,
        entries: ledgerEntries,
        ...(activeCtx ? { fileContext: activeCtx } : {}),
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
        ...(imageData ? { imageData } : {}),
      };

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((res) => {
          const cp = res.catchPayload as CatchPayload | null;
          const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : [])) as FileEdit[];
          const chips = (res.memoryChips ?? []) as string[];
          setMessages((prev) => [...prev, {
            id: res.messageId, role: "assistant",
            content: res.content, intentType: res.intentType, catchPayload: cp,
            sentAt: new Date().toISOString(),
            ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
            ...(chips.length > 0 ? { memoryChips: chips } : {}),
            ...(res.imageB64 ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType } : {}),
          }]);
          if (cp) setActiveCatch(cp);
          if (res.memoryChips && res.memoryChips.length > 0) {
            setMemoryChips((prev) => {
              const merged = [...prev];
              for (const c of res.memoryChips!) {
                if (!merged.includes(c)) merged.push(c);
              }
              return merged.slice(-12);
            });
          }
        })
        .catch(() => {
          setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again.", sentAt: new Date().toISOString() }]);
        })
        .finally(() => setChatPending(false));
    },
    [entries, id, fileContext]
  );

  const handleRegenerate = useCallback(
    (assistantMsgIndex: number) => {
      if (!sessionId || chatPending) return;
      // Find the user message that preceded this assistant response
      const msgsUpToAssistant = messages.slice(0, assistantMsgIndex);
      const prevUserMsg = [...msgsUpToAssistant].reverse().find((m) => m.role === "user");
      if (!prevUserMsg) return;
      // Remove the assistant message and resend
      const historyUpToPrevUser = msgsUpToAssistant.slice(0, msgsUpToAssistant.lastIndexOf(prevUserMsg));
      setMessages(msgsUpToAssistant.slice(0, msgsUpToAssistant.lastIndexOf(prevUserMsg) + 1));
      doSend(prevUserMsg.content, sessionId, historyUpToPrevUser);
    },
    [sessionId, chatPending, messages, doSend]
  );

  useEffect(() => {
    if (!sessionId || initialSent.current) return;
    const key = `atlas-initial-${id}`;
    const initial = sessionStorage.getItem(key);
    if (initial) {
      sessionStorage.removeItem(key);
      initialSent.current = true;
      setTimeout(() => {
        setInput("");
        doSend(initial, sessionId, []);
      }, 80);
    }
  }, [sessionId, id, doSend]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatPending]);

  // Close mobile panel on mobile→desktop resize
  useEffect(() => {
    if (!isMobile) setRightOpen(false);
  }, [isMobile]);

  // mobileTab drives rightOpen
  useEffect(() => {
    if (!isMobile) return;
    if (mobileTab === "chat") setRightOpen(false);
    else setRightOpen(true);
  }, [mobileTab, isMobile]);

  // When panel closes (swipe), reset tab to chat
  useEffect(() => {
    if (!rightOpen && isMobile) setMobileTab("chat");
  }, [rightOpen, isMobile]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !sessionId || chatPending) return;
    const current = messages;
    const file = attachedFile;
    setInput("");
    setAttachedFile(null);
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }

    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        doSend(text, sessionId, current, undefined, { base64, mediaType: file.type });
      };
      reader.onerror = () => doSend(text, sessionId, current);
      reader.readAsDataURL(file);
    } else {
      const messageText = file ? `${text}\n[Attached: ${file.name}]` : text;
      doSend(messageText, sessionId, current);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePark = useCallback(
    (content: string) => {
      if (!sessionId) return;
      const title = content.replace(/\n/g, " ").slice(0, 80).trim();
      createEntry.mutate(
        { projectId: id, data: { title, summary: content.slice(0, 500), status: "parked", severity: "parked", mode: "think", sessionId } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }) }
      );
    },
    [id, sessionId, createEntry, queryClient]
  );

  const handleCommit = useCallback(
    (content: string) => {
      if (!sessionId) return;
      const title = content.replace(/\n/g, " ").slice(0, 80).trim();
      createEntry.mutate(
        { projectId: id, data: { title, summary: content.slice(0, 500), status: "committed", severity: "committed", mode: "think", sessionId } },
        { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }) }
      );
    },
    [id, sessionId, createEntry, queryClient]
  );

  const handleRollbackPush = useCallback(async (record: PushRecord) => {
    const token = project?.githubToken ?? null;
    if (!linkedRepo || !token || !record.originalContent) return;
    await fetch("/api/github/commit", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-github-token": token },
      body: JSON.stringify({
        repo: linkedRepo.fullName, branch: record.branch,
        path: record.path, content: record.originalContent,
        message: `Atlas: rollback ${record.filename}`,
      }),
    });
    setPushHistory((prev) => prev.map((r) => r.id === record.id ? { ...r, rolledBack: true } : r));
  }, [linkedRepo]);

  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setTimeout(() => autoResize(), 0);
  }, []);

  const { listening: voiceListening, toggle: toggleVoice, isSupported: voiceSupported } =
    useVoiceInput(handleVoiceTranscript);

  const handleCatchProceed = (msgId?: number) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, catchResolved: true } : m));
    setActiveCatch(null);
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) });
  };

  const handleCatchAdjust = (msgId?: number) => {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, catchResolved: true } : m));
    setActiveCatch(null);
    textareaRef.current?.focus();
  };

  const dismissChip = useCallback((chip: string) => {
    setMemoryChips((prev) => prev.filter((c) => c !== chip));
  }, []);

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dx = ev.clientX - lastX.current;
      lastX.current = ev.clientX;
      setChatWidth((w) => {
        const next = Math.max(320, Math.min(window.innerWidth * 0.68, w + dx));
        try { localStorage.setItem("atlas-chat-w", String(Math.round(next))); } catch {}
        return next;
      });
    };
    const onUp = () => {
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const hasInput = input.trim().length > 0;
  const entryCount = entries?.length ?? 0;
  const parkedCount = entries?.filter((e) => e.status === "parked").length ?? 0;

  // ── ZIP import ─────────────────────────────────────────────────────────────
  const [zipFiles, setZipFiles] = useState<ZipEntry[]>([]);
  const [zipName, setZipName] = useState("");
  const [zipTruncated, setZipTruncated] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);

  const processZip = useCallback(async (file: File) => {
    try {
      const { entries: parsed, truncated } = await parseZip(file);
      setZipFiles(parsed);
      setZipName(file.name);
      setZipTruncated(truncated);
      setFileContext(assembleContext(file.name, parsed));
    } catch { /* ignore */ }
  }, []);

  const clearZip = useCallback(() => {
    setZipFiles([]);
    setZipName("");
    setZipTruncated(false);
    setFileContext(null);
  }, []);

  const toggleZipFile = useCallback((path: string) => {
    setZipFiles((prev) => {
      const next = prev.map((e) => e.path === path ? { ...e, selected: !e.selected } : e);
      setFileContext(assembleContext(zipName, next));
      return next;
    });
  }, [zipName]);

  const setAllZip = useCallback((selected: boolean) => {
    setZipFiles((prev) => {
      const next = prev.map((e) => ({ ...e, selected }));
      setFileContext(assembleContext(zipName, next));
      return next;
    });
  }, [zipName]);

  return (
    <div
      style={{ height: isMobile ? "calc(100dvh - 64px)" : "100vh", display: "flex", flexDirection: "column", background: "var(--atlas-bg)", overflow: "hidden", position: "relative" }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith(".zip")) await processZip(file);
      }}
    >

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, borderBottom: "1px solid var(--atlas-border)", background: "rgba(12,10,9,0.92)", backdropFilter: "blur(12px)" }}>
        {/* Main row: logo | centered project name | profile */}
        <div style={{ height: 46, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 14px" }}>

          {/* Left: Atlas logo → home */}
          <button
            onClick={() => setLocation("/")}
            style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 7, flexShrink: 0 }}
          >
            <AtlasLogo small />
          </button>

          {/* Center: project name + dropdown */}
          <div style={{ position: "relative", flex: 1, display: "flex", justifyContent: "center" }}>
            <button
              onClick={() => setShowProjectMenu((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 7, background: "transparent", border: "none", cursor: "pointer", padding: "5px 10px", borderRadius: 8, transition: "background 150ms ease", maxWidth: 260 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span className={sessionId ? "atlas-pulse-dot" : undefined} style={{ width: 7, height: 7, borderRadius: "50%", background: sessionId ? "#4ade80" : "rgba(120,113,108,0.4)", flexShrink: 0, display: "inline-block" }} />
              {renaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const newName = renameDraft.trim() || (project?.name ?? "");
                      updateProjectHeader.mutate({ id, data: { name: newName } }, {
                        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }); setRenaming(false); }
                      });
                    }
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  onBlur={() => setRenaming(false)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ background: "transparent", border: "none", outline: "none", color: "var(--atlas-fg)", fontSize: 13, fontWeight: 500, fontFamily: "var(--app-font-sans)", width: 160 }}
                />
              ) : (
                <span style={{ fontSize: 13, color: "rgba(231,229,228,0.88)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {project?.name ?? "…"}
                </span>
              )}
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ color: "rgba(120,113,108,0.5)", flexShrink: 0 }}>
                <path d="M2 4l4 4 4-4" />
              </svg>
            </button>

            {/* Dropdown menu */}
            {showProjectMenu && (
              <>
                <div onClick={() => setShowProjectMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)", background: "rgba(18,15,14,0.97)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "6px 4px", boxShadow: "0 12px 40px rgba(0,0,0,0.7)", backdropFilter: "blur(16px)", zIndex: 9999, minWidth: 220 }}>
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3l8-8z" /></svg>} label="Rename project" onClick={() => { setRenameDraft(project?.name ?? ""); setRenaming(true); setShowProjectMenu(false); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 6h6M5 9h4" /></svg>} label="Parking Lot" onClick={() => { setLocation("/parking"); setShowProjectMenu(false); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 4h12M2 8h8M2 12h6" /></svg>} label="View ledger" onClick={() => { setLocation(`/ledger/${id}`); setShowProjectMenu(false); }} />
                </div>
              </>
            )}
          </div>

          {/* Right: view switcher (mobile) + profile */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>

            {/* Mobile view switcher — collapses after selection */}
            {isMobile && (
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => { setShowViewMenu(v => !v); setShowProjectMenu(false); }}
                  style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 7, padding: "5px 9px", cursor: "pointer", color: "rgba(231,229,228,0.7)", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}
                >
                  {mobileTab}
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 4l4 4 4-4" /></svg>
                  {mobileTab !== "chat" && entryCount > 0 && (
                    <span style={{ fontSize: 8, background: "var(--atlas-ember)", color: "#fff", borderRadius: 6, padding: "1px 4px", fontWeight: 700 }}>{entryCount}</span>
                  )}
                </button>
                {showViewMenu && (
                  <>
                    <div onClick={() => setShowViewMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                    <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "rgba(18,15,14,0.97)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "5px 4px", boxShadow: "0 12px 36px rgba(0,0,0,0.7)", backdropFilter: "blur(16px)", zIndex: 9999, minWidth: 160 }}>
                      {([["chat", "Chat"], ["ledger", "Ledger"], ["workshop", "Workshop"]] as const).map(([tab, label]) => (
                        <button key={tab}
                          onClick={() => { setMobileTab(tab); setShowViewMenu(false); }}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: mobileTab === tab ? "rgba(201,162,76,0.08)" : "transparent", border: "none", padding: "9px 12px", borderRadius: 7, cursor: "pointer", color: mobileTab === tab ? "var(--atlas-gold)" : "rgba(231,229,228,0.75)", fontSize: 13 }}
                          onMouseEnter={(e) => { if (mobileTab !== tab) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                          onMouseLeave={(e) => { if (mobileTab !== tab) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span>{label}</span>
                          {tab === "ledger" && entryCount > 0 && <span style={{ fontSize: 9, background: "var(--atlas-ember)", color: "#fff", borderRadius: 6, padding: "1px 5px", fontWeight: 700 }}>{entryCount}</span>}
                          {mobileTab === tab && <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 8l4 4 6-7" /></svg>}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {sessionId && !isMobile && (
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(120,113,108,0.3)" }}>
                Session active
              </span>
            )}

            {/* Mode pill — always visible, tappable */}
            {(() => {
              const modeConfig = {
                THINK: { color: "#93c5fd", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.35)", desc: "Strategy & advice — no code" },
                PLAN:  { color: "var(--atlas-gold)", bg: "rgba(201,162,76,0.1)", border: "rgba(201,162,76,0.35)", desc: "Structure & outlines" },
                BUILD: { color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.35)", desc: "Writes code → push to GitHub" },
              } as const;
              const cfg = modeConfig[projectMode];
              return (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => { setShowModeMenu(v => !v); setShowProjectMenu(false); setShowViewMenu(false); }}
                    title={`Mode: ${projectMode} — ${cfg.desc}`}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 7, padding: "4px 8px", cursor: "pointer", color: cfg.color, fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0, transition: "all 180ms ease" }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0, display: "inline-block" }} />
                    {projectMode}
                  </button>
                  {showModeMenu && (
                    <>
                      <div onClick={() => setShowModeMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                      <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", background: "rgba(18,15,14,0.97)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "6px 4px", boxShadow: "0 12px 40px rgba(0,0,0,0.7)", backdropFilter: "blur(16px)", zIndex: 9999, minWidth: 210 }}>
                        <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(120,113,108,0.45)", padding: "4px 12px 6px" }}>Select mode</div>
                        {(["THINK", "PLAN", "BUILD"] as const).map((m) => {
                          const mc = modeConfig[m];
                          const active = projectMode === m;
                          return (
                            <button key={m}
                              onClick={() => { setProjectMode(m); try { localStorage.setItem(`atlas-mode-${id}`, m); } catch {} setShowModeMenu(false); }}
                              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: active ? mc.bg : "transparent", border: "none", padding: "8px 12px", borderRadius: 7, cursor: "pointer", transition: "background 120ms" }}
                              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                            >
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: mc.color, flexShrink: 0 }} />
                              <span style={{ flex: 1, textAlign: "left" }}>
                                <span style={{ display: "block", fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.08em", color: active ? mc.color : "rgba(231,229,228,0.8)" }}>{m}</span>
                                <span style={{ display: "block", fontSize: 10, color: "rgba(120,113,108,0.65)", marginTop: 1 }}>{mc.desc}</span>
                              </span>
                              {active && <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke={mc.color} strokeWidth="2.2" strokeLinecap="round"><path d="M3 8l4 4 6-7" /></svg>}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* Parking lot "P" badge */}
            <button
              onClick={() => setLocation("/parking")}
              title="Parking lot"
              style={{ position: "relative", width: 28, height: 28, borderRadius: 7, background: parkedCount > 0 ? "rgba(201,162,76,0.1)" : "transparent", border: `1px solid ${parkedCount > 0 ? "rgba(201,162,76,0.35)" : "rgba(120,113,108,0.2)"}`, color: parkedCount > 0 ? "var(--atlas-gold)" : "rgba(120,113,108,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700, flexShrink: 0, letterSpacing: "0.02em", transition: "all 200ms ease" }}
            >
              P
              {parkedCount > 0 && (
                <span style={{ position: "absolute", top: -5, right: -5, minWidth: 14, height: 14, borderRadius: 7, background: "var(--atlas-ember)", color: "#fff", fontSize: 8, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", fontFamily: "var(--app-font-mono)" }}>
                  {parkedCount}
                </span>
              )}
            </button>

            {/* User avatar */}
            <button
              onClick={() => setShowProfile(true)}
              title="Your profile"
              style={{ width: 34, height: 34, borderRadius: "50%", background: loadProfile().photoUrl ? "transparent" : "rgba(28,25,23,0.95)", border: "1.5px solid rgba(120,113,108,0.3)", color: "rgba(231,229,228,0.65)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontFamily: "var(--app-font-mono)", fontWeight: 600, flexShrink: 0, overflow: "hidden", padding: 0 }}
            >
              {(() => { const p = loadProfile(); if (p.photoUrl) return <img src={p.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />; return p.name ? p.name[0].toUpperCase() : "👤"; })()}
            </button>
          </div>
        </div>
      </div>

      {/* ── Two-pane body ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* ZIP drag overlay */}
        <ZipDragOverlay visible={isDragOver} />

        {/* Left: Chat */}
        <div
          style={{
            width: isMobile ? "100%" : chatWidth,
            minWidth: isMobile ? 0 : 300,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--atlas-bg)",
            overflow: "hidden",
          }}
        >
          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 22px 12px", position: "relative" }} className="scrollbar-none atlas-chat-timeline">
            {messages.length === 0 && !chatPending && (
              <div style={{ textAlign: "center", padding: "72px 20px" }}>
                <div style={{ fontSize: 22, fontWeight: 300, color: "rgba(231,229,228,0.3)", marginBottom: 8, letterSpacing: "-0.01em" }}>
                  {project ? project.name : "Ready."}
                </div>
                <div style={{ fontSize: 12, color: "rgba(120,113,108,0.45)" }}>
                  What are we working through today?
                </div>
              </div>
            )}

            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <UserBubble
                  key={i}
                  content={msg.content}
                  sentAt={msg.sentAt}
                  onCopy={() => {}}
                  onEdit={() => {
                    setInput(msg.content);
                    setTimeout(() => textareaRef.current?.focus(), 50);
                  }}
                />
              ) : (
                <AssistantBubble
                  key={i}
                  message={msg}
                  projectId={id}
                  sessionId={sessionId || 0}
                  linkedRepo={linkedRepo}
                  onCatchProceed={() => handleCatchProceed(msg.id)}
                  onCatchAdjust={() => handleCatchAdjust(msg.id)}
                  onPark={handlePark}
                  onCommit={handleCommit}
                  onRegenerate={() => handleRegenerate(i)}
                  onPushSuccess={(records) => setPushHistory((prev) => [...prev, ...records].slice(-5))}
                />
              )
            )}

            {chatPending && (
              <div className="atlas-bubble-in" style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.35, marginBottom: 8 }}>
                  Atlas
                </div>
                <LoadingSpinner size="sm" color="atlas" />
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Ledger status bar */}
          <div className="atlas-ledger-bar">
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: entryCount > 0 ? "var(--atlas-gold)" : "rgba(120,113,108,0.35)", flexShrink: 0, display: "inline-block", boxShadow: entryCount > 0 ? "0 0 6px rgba(201,162,76,0.45)" : "none", transition: "all 400ms ease" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: entryCount > 0 ? "rgba(201,162,76,0.65)" : "rgba(120,113,108,0.35)", transition: "color 400ms ease" }}>
              [{entryCount}] Ledger Entries
            </span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(120,113,108,0.3)" }}>·</span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: chatPending ? "rgba(74,222,128,0.55)" : "rgba(120,113,108,0.3)", transition: "color 300ms ease" }}>
              {chatPending ? "Generating" : "Session Active"}
            </span>
          </div>

          {/* Memory chips — what Atlas is tracking this session */}
          <MemoryChips chips={memoryChips} onDismiss={dismissChip} />

          {/* Input */}
          <div style={{ padding: "10px 14px 14px", flexShrink: 0 }}>
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                setAttachedFile(file);
                e.target.value = "";
              }}
            />
            {/* Hidden ZIP input */}
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await processZip(file);
                e.target.value = "";
              }}
            />

            {/* ZIP panel — shows when a ZIP is loaded */}
            {zipFiles.length > 0 && (
              <ZipPanel
                zipName={zipName}
                entries={zipFiles}
                truncated={zipTruncated}
                onToggle={toggleZipFile}
                onSelectAll={() => setAllZip(true)}
                onDeselectAll={() => setAllZip(false)}
                onClear={clearZip}
              />
            )}

            {/* Attachment pill */}
            {attachedFile && (
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
                  padding: "4px 10px", borderRadius: 6, width: "fit-content",
                  background: "rgba(201,162,76,0.07)",
                  border: "1px solid rgba(201,162,76,0.2)",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(201,162,76,0.8)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.7)", letterSpacing: "0.05em", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {attachedFile.name}
                </span>
                <button
                  onClick={() => setAttachedFile(null)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 13, lineHeight: 1, padding: "0 0 0 2px" }}
                >
                  ×
                </button>
              </div>
            )}

            <div className="atlas-input-shell" style={{ padding: "13px 15px" }}>
              <div style={{ position: "relative" }}>
                {!hasInput && (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute", top: 0, left: 0,
                      color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1.6,
                      opacity: 0.5, pointerEvents: "none",
                      fontFamily: "var(--app-font-sans)",
                    }}
                  >
                    Say it plainly…
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); autoResize(); }}
                  onKeyDown={handleKeyDown}
                  rows={2}
                  style={{
                    width: "100%", background: "transparent", border: "none", outline: "none",
                    color: "var(--atlas-fg)", fontSize: 14, lineHeight: 1.6,
                    resize: "none", fontFamily: "var(--app-font-sans)",
                    position: "relative", zIndex: 1,
                    minHeight: 46, maxHeight: 180, overflowY: "hidden", display: "block",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                {/* Left: paperclip + wrench (read Atlas source) */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                    style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: "transparent", border: "none",
                      color: attachedFile ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: attachedFile ? 1 : 0.4, transition: "opacity 160ms ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => { if (!attachedFile) e.currentTarget.style.opacity = "0.4"; }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* ZIP import button */}
                  <button
                    onClick={() => zipInputRef.current?.click()}
                    title="Load project ZIP into context"
                    style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: zipFiles.length > 0 ? "rgba(201,162,76,0.1)" : "transparent",
                      border: zipFiles.length > 0 ? "1px solid rgba(201,162,76,0.25)" : "1px solid transparent",
                      color: zipFiles.length > 0 ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: zipFiles.length > 0 ? 1 : 0.4, transition: "all 160ms ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => { if (!zipFiles.length) e.currentTarget.style.opacity = "0.4"; }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                      <line x1="12" y1="22.08" x2="12" y2="12" />
                    </svg>
                  </button>

                  {/* Wrench — read Atlas source into context */}
                  <button
                    onClick={() => setShowSrcPicker((v) => !v)}
                    title="Read Atlas source file into context"
                    style={{
                      width: 30, height: 30, borderRadius: 7,
                      background: showSrcPicker ? "rgba(56,189,248,0.1)" : "transparent",
                      border: showSrcPicker ? "1px solid rgba(56,189,248,0.3)" : "1px solid transparent",
                      color: showSrcPicker ? "rgba(56,189,248,0.9)" : "var(--atlas-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: srcReadLoading ? 0.5 : (showSrcPicker ? 1 : 0.4), transition: "all 160ms ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                    onMouseLeave={(e) => { if (!showSrcPicker) e.currentTarget.style.opacity = "0.4"; }}
                  >
                    {srcReadLoading ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" style={{ animation: "spin 1s linear infinite" }}>
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="10 6" />
                      </svg>
                    ) : (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <path d="M10.5 1.5A3.5 3.5 0 007 5c0 .36.05.71.14 1.04L2.5 10.5A1.5 1.5 0 004.5 12.5l4.46-4.64c.33.09.68.14 1.04.14a3.5 3.5 0 000-7z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        <circle cx="10.5" cy="4.5" r="1" fill="currentColor" />
                      </svg>
                    )}
                  </button>

                  {/* Source picker dropdown */}
                  {showSrcPicker && (
                    <div
                      style={{
                        position: "absolute", bottom: "calc(100% + 8px)", left: 0,
                        background: "rgba(18,15,14,0.97)", border: "1px solid rgba(56,189,248,0.2)",
                        borderRadius: 8, padding: "6px 4px",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(56,189,248,0.06)",
                        backdropFilter: "blur(12px)",
                        zIndex: 50, minWidth: 230,
                      }}
                    >
                      <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(56,189,248,0.5)", padding: "4px 10px 6px", borderBottom: "1px solid rgba(56,189,248,0.08)", marginBottom: 4 }}>
                        Read Atlas source into context
                      </div>
                      {ATLAS_SRC_FILES.map((f) => (
                        <button
                          key={f.path}
                          onClick={() => handleReadSrc(f.path)}
                          style={{
                            display: "block", width: "100%", textAlign: "left",
                            background: "transparent", border: "none",
                            padding: "6px 10px", borderRadius: 5,
                            cursor: "pointer",
                            transition: "background 120ms ease",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(56,189,248,0.07)")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          <div style={{ fontSize: 11.5, fontFamily: "var(--app-font-mono)", color: "rgba(231,229,228,0.85)", fontWeight: 500 }}>{f.label}</div>
                          <div style={{ fontSize: 9.5, color: "rgba(120,113,108,0.55)", marginTop: 1 }}>{f.hint}</div>
                        </button>
                      ))}
                      <div style={{ fontSize: 9, padding: "4px 10px 2px", color: "rgba(120,113,108,0.35)", borderTop: "1px solid rgba(56,189,248,0.06)", marginTop: 4 }}>
                        File loads into context · next message only
                      </div>
                    </div>
                  )}
                </div>

                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.3 }}>
                  {isMobile ? "Tap to send" : "Enter · Shift+Enter for newline"}
                </span>

                {/* Right: mic + send */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {voiceSupported && (
                    <button
                      onClick={toggleVoice}
                      title={voiceListening ? "Stop listening" : "Voice input"}
                      className={voiceListening ? "atlas-voice-active" : ""}
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: voiceListening ? "var(--atlas-ember)" : "rgba(37,34,32,0.6)",
                        border: `1px solid ${voiceListening ? "var(--atlas-ember)" : "var(--atlas-border)"}`,
                        color: voiceListening ? "var(--atlas-fg)" : "var(--atlas-muted)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 180ms ease", flexShrink: 0,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                        <rect x="5" y="1" width="6" height="9" rx="3" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M2 8a6 6 0 0012 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <line x1="8" y1="14" x2="8" y2="16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                  <button
                    className="atlas-send-btn"
                    onClick={handleSend}
                    disabled={!hasInput || chatPending || !sessionId}
                    style={{
                      width: 38, height: 38,
                      background: hasInput && !chatPending && sessionId ? "var(--atlas-ember)" : "rgba(37,34,32,0.7)",
                      border: hasInput ? "none" : "1px solid var(--atlas-border)",
                      boxShadow: hasInput && !chatPending ? "0 0 16px -3px rgba(146,64,14,0.5)" : "none",
                      opacity: chatPending ? 0.5 : 1,
                    }}
                  >
                    <svg viewBox="0 0 20 20" width={13} height={13}
                      fill={hasInput ? "var(--atlas-fg)" : "none"}
                      stroke={hasInput ? "var(--atlas-fg)" : "var(--atlas-muted)"}
                      strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 10L17 3 13 17l-3.5-5.5z" />
                      <path d="M17 3 9.5 11.5" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop: resize handle + right panel */}
        {!isMobile && (
          <>
            <div
              className="atlas-resize-handle"
              onMouseDown={onResizeMouseDown}
              onDoubleClick={() => setChatWidth(Math.floor(window.innerWidth * 0.5))}
              title="Drag · double-click for 50/50"
            />
            <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onFileContext={setFileContext}
                onLinkedRepoChange={setLinkedRepo}
                pushHistory={pushHistory}
                onRollbackPush={handleRollbackPush}
              />
            </div>
          </>
        )}

        {/* Mobile: overlay panel */}
        {isMobile && rightOpen && (
          <div
            style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end" }}
          >
            {/* Backdrop — hidden in fullscreen */}
            {!rightFullscreen && (
              <div
                onClick={() => setRightOpen(false)}
                style={{
                  position: "absolute", inset: 0,
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(2px)",
                }}
              />
            )}
            {/* Sheet — slide in from right; expands to full when fullscreen */}
            <div
              onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                if (rightFullscreen) return;
                const dx = e.changedTouches[0].clientX - touchStartX.current;
                if (dx > 60) setRightOpen(false);
              }}
              style={{
                position: "relative", zIndex: 1,
                width: rightFullscreen ? "100vw" : "88vw",
                maxWidth: rightFullscreen ? "none" : 420,
                height: "100%",
                animation: "atlas-slide-in-right 220ms cubic-bezier(0.4,0,0.2,1) both",
                transition: "width 220ms ease, max-width 220ms ease",
              }}
            >
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onClose={() => { setRightOpen(false); setRightFullscreen(false); }}
                fullscreen={rightFullscreen}
                onToggleFullscreen={() => setRightFullscreen((f) => !f)}
                onFileContext={setFileContext}
                onLinkedRepoChange={setLinkedRepo}
                pushHistory={pushHistory}
                onRollbackPush={handleRollbackPush}
              />
            </div>
          </div>
        )}
      </div>

      {/* User Profile Panel */}
      {showProfile && <UserProfilePanel onClose={() => setShowProfile(false)} />}

    </div>
  );
}
