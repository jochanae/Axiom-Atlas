import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import type React from "react";
import { useParams, useLocation, Link } from "wouter";
import { useRequireAuth } from "@/hooks/useAuth";
import { useSound } from "@/hooks/useSound";
import { AxiomFlow } from "../components/AxiomFlow";
import type { ArchNode, NodeStateMap, HandoverSnapshot } from "../components/AxiomFlow";
import { SystemMap } from "../components/SystemMap";
import type { ArchNode as SystemMapNode } from "../components/SystemMap";
import { TheForge } from "../components/TheForge";
import { CockpitBar } from "../components/CockpitBar";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import { AccountHubPanel } from "../components/AccountHubPanel";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { StatusGlyph } from "../components/StatusGlyph";
import { CapsuleTag } from "../components/CapsuleTag";
import { ZipDragOverlay, ZipPanel, parseZip, assembleContext } from "../components/ZipImport";
import { ProjectSettingsPanel } from "../components/ProjectSettingsPanel";
import type { ZipEntry } from "../components/ZipImport";
import {
  useGetProject,
  useListProjects,
  useListSessions,
  useListEntries,
  useListMessages,
  useCreateSession,
  useCreateEntry,
  useCreateProject,
  useUpdateProject,
  useUpdateEntry,
  useDeleteProject,
  useListReadinessSnapshots,
  useRecordReadinessSnapshot,
  getListReadinessSnapshotsQueryKey,
  getListEntriesQueryKey,
  getListSessionsQueryKey,
  getGetProjectQueryKey,
  getListProjectsQueryKey,
} from "@workspace/api-client-react";
import type { Entry } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ReadinessRing,
  ReadinessTrend,
  ReadinessMode,
  READINESS_MODE_KEY,
  computeBlendedScore,
} from "../components/ReadinessRing";

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
  memoryChips?: MemoryChip[];
  sentAt?: string;
  imageB64?: string;
  imageMimeType?: string;
  autoFetchedFiles?: string[];
  model?: string;
  isDeepDive?: boolean;
}

type MemoryChip = { label: string; insight?: string };

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
  const [mobile, setMobile] = useState(() => window.innerWidth < 760);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 760);
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
function MenuBtn({ icon, label, onClick, badge, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; badge?: string; disabled?: boolean }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "9px 12px", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", color: "var(--atlas-fg)", opacity: disabled ? 0.45 : 1, fontSize: 13, textAlign: "left" }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-fg) 8%, transparent)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: "var(--atlas-muted)", display: "flex", flexShrink: 0, opacity: 0.7 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, letterSpacing: "0.1em", flexShrink: 0 }}>{badge}</span>
      )}
    </button>
  );
}

// ── AtlasLogo ────────────────────────────────────────────────────────────────
const MODE_LABEL_COLORS: Record<string, string> = {
  THINK: "rgba(147,197,253,0.55)",
  PLAN:  "rgba(212,175,55,0.38)",
  BUILD: "rgba(74,222,128,0.45)",
};

function AtlasLogo({ small, mode }: { small?: boolean; mode?: "THINK" | "PLAN" | "BUILD" }) {
  const imgSize = small ? 22 : 26;
  const modeLabel = mode ? `${mode} MODE` : null;
  const modeColor = mode ? (MODE_LABEL_COLORS[mode] ?? "var(--atlas-muted)") : "var(--atlas-muted)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <img
        src="/axiom-logo.svg"
        alt="Axiom"
        width={imgSize}
        height={imgSize}
        style={{ borderRadius: "20%", flexShrink: 0 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 1.5, lineHeight: 1 }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
          fontSize: small ? 10 : 11,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: "var(--atlas-gold)",
          textTransform: "uppercase",
        }}>
          AXIOM
        </span>
        {modeLabel && (
          <span style={{
            fontFamily: "'IBM Plex Mono', var(--app-font-mono)",
            fontSize: 7.5,
            fontWeight: 500,
            letterSpacing: "0.14em",
            color: modeColor,
            textTransform: "uppercase",
            transition: "color 300ms ease",
          }}>
            {modeLabel}
          </span>
        )}
      </div>
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

// ── InsightChip ───────────────────────────────────────────────────────────────
function InsightChip({
  chip,
  onPark,
  onDismiss,
}: {
  chip: MemoryChip;
  onPark: (chip: MemoryChip) => void;
  onDismiss?: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasInsight = !!chip.insight;
  return (
    <div style={{ display: "inline-flex", flexDirection: "column" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "2px 8px", borderRadius: 20,
          background: open ? "rgba(201,162,76,0.14)" : "rgba(201,162,76,0.07)",
          border: `1px solid ${open ? "rgba(201,162,76,0.42)" : "rgba(201,162,76,0.18)"}`,
          fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
          color: open ? "rgba(201,162,76,1)" : "rgba(201,162,76,0.75)",
          cursor: "pointer", transition: "all 140ms ease",
        }}
        onMouseEnter={(e) => { if (!open) { e.currentTarget.style.background = "rgba(201,162,76,0.12)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; } }}
        onMouseLeave={(e) => { if (!open) { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)"; } }}
      >
        <span style={{ opacity: 0.55, fontSize: 9 }}>◆</span>
        {chip.label}
        {hasInsight && (
          <span style={{ fontSize: 8, opacity: 0.45, display: "inline-block", transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>▾</span>
        )}
      </button>
      {open && (
        <div
          className="atlas-bubble-in"
          style={{
            marginTop: 5, borderRadius: 9,
            background: "var(--atlas-surface-alt)",
            border: "1px solid rgba(201,162,76,0.2)",
            padding: "11px 13px", maxWidth: 300,
            position: "relative", zIndex: 5,
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: hasInsight ? 6 : 8, letterSpacing: "-0.01em" }}>
            {chip.label}
          </div>
          {chip.insight && (
            <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: 10, fontStyle: "italic", opacity: 0.85 }}>
              {chip.insight}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <button
              type="button"
              onClick={() => { onPark(chip); setOpen(false); }}
              style={{
                background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
                border: "1px solid rgba(201,162,76,0.3)",
                borderRadius: 6, color: "var(--atlas-gold)",
                fontSize: 10, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", padding: "4px 10px",
                letterSpacing: "0.05em", transition: "background 130ms",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 20%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 12%, transparent)")}
            >
              Park this →
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={() => { onDismiss(chip.label); setOpen(false); }}
                style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 11, opacity: 0.38, padding: "4px 5px", transition: "opacity 120ms", fontFamily: "var(--app-font-mono)" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.38")}
              >
                Dismiss
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 14, opacity: 0.3, padding: "2px 6px", marginLeft: "auto", lineHeight: 1, transition: "opacity 120ms" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.65")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.3")}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MemoryChips (session-level, above the input) ──────────────────────────────
function MemoryChips({
  chips,
  onDismiss,
  onPark,
}: {
  chips: MemoryChip[];
  onDismiss: (label: string) => void;
  onPark: (chip: MemoryChip) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "6px 14px 2px", flexShrink: 0 }}>
      {chips.map((chip) => (
        <InsightChip key={chip.label} chip={chip} onPark={onPark} onDismiss={onDismiss} />
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
          style={{
            position: "relative",
            padding: "11px 15px 11px 17px",
            borderRadius: "16px 4px 16px 16px",
            width: "100%",
            background: "var(--atlas-surface)",
            cursor: isTall ? "pointer" : "default",
            transition: "all 280ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onClick={isTall ? () => setExpanded((v) => !v) : undefined}
        >
          <div
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9,
              letterSpacing: "0.15em", textTransform: "uppercase",
              color: "var(--atlas-muted)", opacity: 0.75, marginBottom: 8, textAlign: "right",
            }}
          >
            YOU{sentAt ? ` · ${formatTimestamp(sentAt)}` : ""}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--atlas-fg)", opacity: 0.85, whiteSpace: "pre-wrap", fontFamily: "var(--app-font-mono)", letterSpacing: "-0.01em" }}>
            {displayContent}
          </div>
          {isTall && (
            <div style={{ marginTop: 5, fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "var(--atlas-gold)", opacity: 0.5 }}>
              {expanded ? "SHOW LESS ↑" : "SHOW MORE ↓"}
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
  onPrCreated,
}: {
  fileEdits: FileEdit[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onClose: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const _projectId = projectId; void _projectId;

  const [selectedIdx, setSelectedIdx] = useState(0);
  const [useNewBranch, setUseNewBranch] = useState(true);
  const [branchName, setBranchName] = useState(`atlas/fix-${today}-${Date.now().toString(36).slice(-4)}`);
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
  const [creatingPr, setCreatingPr] = useState(false);
  const [prResult, setPrResult] = useState<{ prUrl: string; prNumber: number } | null>(null);
  const [prError, setPrError] = useState<string | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: modalProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = modalProject?.githubToken ?? null;

  useEffect(() => {
    setConfirmPush(false);
    if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
  }, [useNewBranch]);

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

  const handleCreatePR = async () => {
    if (!linkedRepo || !token || !success) return;
    setCreatingPr(true);
    setPrError(null);
    try {
      const prRes = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({
          repo: linkedRepo.fullName,
          head: success.branch,
          base: linkedRepo.defaultBranch,
          title: commitMsg,
          body: `Generated by Atlas\n\n**Files changed:**\n${fileEdits.map((fe) => `- \`${fe.path}\``).join("\n")}`,
        }),
      });
      const d = await prRes.json() as any;
      if (!prRes.ok) throw new Error(d.error || d.detail || `PR creation failed: HTTP ${prRes.status}`);
      setPrResult({ prUrl: d.prUrl, prNumber: d.prNumber });
      onPrCreated?.(d.prUrl);
    } catch (e: any) {
      setPrError(e.message ?? "PR creation failed");
    } finally {
      setCreatingPr(false);
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
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <a href={success.commitUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", fontSize: 12, fontFamily: "var(--app-font-mono)", textDecoration: "none" }}>View commit on GitHub →</a>
                    {useNewBranch && (
                      prResult ? (
                        <a href={prResult.prUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 6, background: "rgba(134,239,172,0.08)", border: "1px solid rgba(134,239,172,0.25)", color: "rgba(134,239,172,0.85)", fontSize: 12, fontFamily: "var(--app-font-mono)", textDecoration: "none" }}>
                          ✓ PR #{prResult.prNumber} opened →
                        </a>
                      ) : (
                        <button onClick={handleCreatePR} disabled={creatingPr} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 14px", borderRadius: 6, background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.2)", color: "var(--atlas-gold)", fontSize: 12, fontFamily: "var(--app-font-mono)", cursor: creatingPr ? "not-allowed" : "pointer", opacity: creatingPr ? 0.5 : 1, transition: "all 160ms ease" }}>
                          {creatingPr ? "Opening PR…" : "Open Pull Request →"}
                        </button>
                      )
                    )}
                    {prError && <div style={{ fontSize: 11, color: "rgba(252,165,165,0.75)", marginTop: 2 }}>{prError}</div>}
                  </div>
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
                            <span style={{ flex: 1, padding: "1px 8px 1px 2px", color: isAdded ? "rgba(134,239,172,0.85)" : isRemoved ? "rgba(252,165,165,0.7)" : "var(--atlas-muted)", whiteSpace: "pre" as const, overflowX: "auto" }}>{item.line || " "}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <pre style={{ margin: 0, padding: "10px", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 5, fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.6, color: "var(--atlas-fg)", overflowX: "auto", maxHeight: 280, overflowY: "auto", whiteSpace: "pre" }}>{currentFile.content}</pre>
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
          <div style={{ padding: "14px 20px", borderTop: "1px solid var(--atlas-border)" }}>
            {!useNewBranch && confirmPush && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(146,64,14,0.12)", border: "1px solid rgba(146,64,14,0.4)", fontSize: 12, color: "rgba(251,191,36,0.92)", lineHeight: 1.5 }}>
                ⚠ You're pushing directly to {linkedRepo?.defaultBranch ?? "main"}. This cannot be undone. Tap again to confirm.
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
              <button
                onClick={() => {
                  if (!useNewBranch) {
                    if (!confirmPush) {
                      setConfirmPush(true);
                      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
                      confirmTimerRef.current = setTimeout(() => setConfirmPush(false), 5000);
                      return;
                    }
                    if (confirmTimerRef.current) { clearTimeout(confirmTimerRef.current); confirmTimerRef.current = null; }
                    setConfirmPush(false);
                  }
                  void handlePush();
                }}
                disabled={pushing || !linkedRepo}
                style={{ padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)", color: "var(--atlas-bg)", border: "none", cursor: pushing || !linkedRepo ? "not-allowed" : "pointer", opacity: pushing || !linkedRepo ? 0.5 : 1, transition: "opacity 160ms ease" }}
              >
                {pushing ? "Pushing…" : !useNewBranch && confirmPush ? "Confirm push →" : fileEdits.length > 1 ? `Push ${fileEdits.length} files →` : "Push to GitHub"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── StreamingText ─────────────────────────────────────────────────────────────
function StreamingText({
  text,
  speed = 35,
  animate = true,
  onComplete,
  style,
}: {
  text: string;
  speed?: number;
  animate?: boolean;
  onComplete?: () => void;
  style?: React.CSSProperties;
}) {
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : Infinity);
  const words = useRef<string[]>([]);
  const completeCalled = useRef(false);

  useEffect(() => {
    words.current = text.match(/\S+|\n/g) ?? [];
    if (!animate) { setVisibleCount(Infinity); return; }
    setVisibleCount(0);
    completeCalled.current = false;
  }, [text, animate]);

  useEffect(() => {
    if (!animate) return;
    const total = words.current.length;
    if (visibleCount >= total) {
      if (!completeCalled.current) { completeCalled.current = true; onComplete?.(); }
      return;
    }
    const lastWord = words.current[visibleCount - 1] ?? "";
    const pause = /[.!?]$/.test(lastWord)
      ? speed * 4
      : speed * (0.6 + Math.random() * 0.8);
    const timer = setTimeout(() => {
      const burst = Math.random() > 0.7 ? 2 : 1;
      setVisibleCount((c) => Math.min(c + burst, total));
    }, pause);
    return () => clearTimeout(timer);
  }, [visibleCount, animate, speed, onComplete]);

  const done = !animate || visibleCount >= (words.current.length || Infinity);
  if (done) {
    return <div style={style}>{text}</div>;
  }
  const visible = words.current.slice(0, visibleCount).join(" ");
  return (
    <div style={style}>
      {visible}
      <span className="atlas-cursor" />
    </div>
  );
}

function splitIntoChunks(text: string): string[] {
  if (text.length < 300) return [text];
  const raw = text.split(/\n{2,}/);
  const chunks: string[] = [];
  for (const segment of raw) {
    const trimmed = segment.trim();
    if (trimmed) chunks.push(trimmed);
  }
  return chunks.length > 0 ? chunks : [text];
}

// ── ChunkedBubbles ────────────────────────────────────────────────────────────
function ChunkedBubbles({
  text,
  isNew,
  textStyle,
}: {
  text: string;
  isNew: boolean;
  textStyle?: React.CSSProperties;
}) {
  const chunks = splitIntoChunks(text);
  const [revealed, setRevealed] = useState(isNew ? 0 : chunks.length);

  useEffect(() => {
    if (!isNew || revealed >= chunks.length) return;
    const timer = setTimeout(
      () => setRevealed((r) => r + 1),
      revealed === 0 ? 100 : 600 + Math.random() * 400,
    );
    return () => clearTimeout(timer);
  }, [revealed, chunks.length, isNew]);

  const visibleChunks = chunks.slice(0, isNew ? Math.min(revealed + 1, chunks.length) : chunks.length);
  return (
    <>
      {visibleChunks.map((chunk, i) => (
        <StreamingText
          key={i}
          text={chunk}
          animate={isNew && i === revealed && revealed < chunks.length}
          style={{ ...textStyle, ...(i < visibleChunks.length - 1 ? { marginBottom: 12 } : {}) }}
        />
      ))}
    </>
  );
}

// ── AssistantBubble ───────────────────────────────────────────────────────────
function AssistantBubble({
  message,
  isNew = false,
  projectId,
  sessionId,
  linkedRepo,
  onCatchProceed,
  onCatchAdjust,
  onPark,
  onCommit,
  onRegenerate,
  onPushSuccess,
  onPreviewCode,
  onPrCreated,
}: {
  message: ChatMessage;
  isNew?: boolean;
  projectId: number;
  sessionId: number;
  linkedRepo: LinkedRepo | null;
  onCatchProceed: () => void;
  onCatchAdjust: () => void;
  onPark: (content: string) => void;
  onCommit: (content: string) => void;
  onRegenerate: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPreviewCode?: (code: string) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const [parkDone, setParkDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selfApplyStatus, setSelfApplyStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [selfApplyMsg, setSelfApplyMsg] = useState("");
  const activeEdits = message.fileEdits ?? (message.fileEdit ? [message.fileEdit] : []);

  // Detect previewable code block (html, jsx, tsx, css, or untagged with HTML tags)
  const previewableCode = useMemo(() => {
    const regex = /```(\w*)\n([\s\S]+?)```/g;
    let match;
    const previewLangs = new Set(["html", "jsx", "tsx", "css", "vue", "svelte", ""]);
    while ((match = regex.exec(message.content)) !== null) {
      const lang = (match[1] ?? "").toLowerCase();
      const code = match[2] ?? "";
      if (previewLangs.has(lang) || /<[a-zA-Z][\s\S]*?>/.test(code)) return code;
    }
    return null;
  }, [message.content]);

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
            color: "var(--atlas-gold)", opacity: 0.85, marginBottom: 7,
          }}
        >
          <span>Atlas</span>
          {message.model && message.model !== "claude" && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 6px", borderRadius: 4,
              background: message.model === "gpt4o"
                ? "rgba(16,163,127,0.12)"
                : message.model === "gemini"
                ? "rgba(66,133,244,0.12)"
                : "rgba(201,162,76,0.08)",
              border: `1px solid ${message.model === "gpt4o" ? "rgba(16,163,127,0.28)" : message.model === "gemini" ? "rgba(66,133,244,0.28)" : "rgba(201,162,76,0.2)"}`,
              fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
              color: message.model === "gpt4o" ? "#10a37f" : message.model === "gemini" ? "#4285f4" : "var(--atlas-gold)",
            }}>
              {message.model === "gpt4o" ? "GPT-4o" : message.model === "gemini" ? "Gemini" : message.model}
            </span>
          )}
          {message.isDeepDive && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 6px", borderRadius: 4,
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.28)",
              fontSize: 8, fontWeight: 700, letterSpacing: "0.08em",
              color: "#a78bfa",
            }}>
              DEEP DIVE
            </span>
          )}
          {message.sentAt && (
            <span style={{ opacity: 0.75 }}>
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
        {/* Memory chips — click to expand insight and park */}
        {message.memoryChips && message.memoryChips.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5, marginBottom: 8 }}>
            {message.memoryChips.map((chip) => (
              <InsightChip
                key={chip.label}
                chip={chip}
                onPark={(c) => onPark(`${c.label}${c.insight ? `: ${c.insight}` : ""}`)}
              />
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

        {message.autoFetchedFiles && message.autoFetchedFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {message.autoFetchedFiles.map((fp) => (
              <div
                key={fp}
                title={fp}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 4,
                  background: "rgba(201,162,76,0.06)",
                  border: "1px solid rgba(201,162,76,0.18)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)",
                  color: "var(--atlas-muted)", letterSpacing: "0.03em",
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.6 }}>
                  <path d="M2 1h5l3 3v7H2V1z" stroke="var(--atlas-gold)" strokeWidth="1.1" />
                  <path d="M7 1v3h3" stroke="var(--atlas-gold)" strokeWidth="1.1" />
                </svg>
                {fp.split("/").pop() ?? fp}
              </div>
            ))}
          </div>
        )}

        <ChunkedBubbles
          text={message.content}
          isNew={isNew}
          textStyle={{ fontSize: 14, lineHeight: 1.78, color: "var(--atlas-fg)", opacity: 0.9, whiteSpace: "pre-wrap" }}
        />

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


        {/* Apply to Atlas itself (self-edits to artifacts/atlas or artifacts/api-server) */}
        {selfEdits.length > 0 && (
          <div style={{ marginTop: userEdits.length > 0 ? 6 : 10 }}>
            <button
              onClick={handleSelfApply}
              disabled={selfApplyStatus === "applying" || selfApplyStatus === "done"}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "7px 13px", borderRadius: 7,
                background: selfApplyStatus === "done"
                  ? "rgba(52,211,153,0.08)"
                  : selfApplyStatus === "error"
                    ? "rgba(239,68,68,0.08)"
                    : "rgba(120,113,108,0.12)",
                border: `1px solid ${selfApplyStatus === "done" ? "rgba(52,211,153,0.3)" : selfApplyStatus === "error" ? "rgba(239,68,68,0.3)" : "rgba(120,113,108,0.2)"}`,
                color: selfApplyStatus === "done" ? "#34d399" : selfApplyStatus === "error" ? "rgba(252,165,165,0.85)" : "var(--atlas-muted)",
                fontSize: 11.5, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.05em",
                cursor: selfApplyStatus === "applying" || selfApplyStatus === "done" ? "default" : "pointer",
                opacity: selfApplyStatus === "applying" ? 0.6 : 1,
                transition: "all 160ms ease",
              }}
            >
              {selfApplyStatus === "done"
                ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
                : selfApplyStatus === "error"
                  ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v6M7 10.5v1" /></svg>
                  : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 1v8M4 6l3 3 3-3" /><path d="M2 11h10" /></svg>
              }
              {selfApplyStatus === "applying" ? "Applying…"
                : selfApplyStatus === "done" ? (selfApplyMsg || "Applied")
                : selfApplyStatus === "error" ? (selfApplyMsg || "Apply failed")
                : selfEdits.length === 1
                  ? `Apply ${selfEdits[0].path.split("/").pop()} to Atlas`
                  : `Apply ${selfEdits.length} files to Atlas`}
            </button>
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
          {/* Preview in Sandbox */}
          {previewableCode && onPreviewCode && (
            <button
              className="atlas-icon-action"
              title="Preview in Sandbox"
              onClick={() => onPreviewCode(previewableCode)}
              style={{ color: "var(--atlas-gold)", opacity: hov ? 0.85 : 0.32 }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="12" height="9" rx="1.5" />
                <path d="M5 5.5l2 2-2 2M8.5 9.5h1.5" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {showPushModal && activeEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={activeEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
          onPushSuccess={(records) => { onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
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
  const [showDetails, setShowDetails] = useState(false);

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
  const hasDetails = !!(entry.details || (entry.touched && entry.touched.length > 0));

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
        <Link
          href={`/entry/${entry.id}`}
          onClick={(e) => e.stopPropagation()}
          style={{ flex: 1, fontSize: 12.5, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.4, textDecoration: "none" }}
        >
          {entry.title}
        </Link>
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
        <div style={{ marginLeft: 20, marginBottom: 14, background: "var(--atlas-surface-alt)", border: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)", borderRadius: 10, padding: "14px 16px" }}>
          {/* Category tags + status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "rgba(120,113,108,0.45)", textTransform: "uppercase" as const }}>
              {modeLabel} · {typeLabel}
            </span>
            {entry.buildId && (
              <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(120,113,108,0.1)", border: "0.5px solid rgba(120,113,108,0.2)", color: "rgba(120,113,108,0.65)", padding: "1px 7px", borderRadius: 10 }}>
                #{entry.buildId}
              </span>
            )}
            {entry.costOfLesson && (
              <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.55)" }}>
                cost: {entry.costOfLesson}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: entry.isViolation ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.07)", border: `1px solid ${entry.isViolation ? "rgba(239,68,68,0.18)" : "rgba(74,222,128,0.18)"}`, color: entry.isViolation ? "rgba(239,68,68,0.75)" : "rgba(74,222,128,0.75)", padding: "2px 9px", borderRadius: 20, textTransform: "uppercase" as const }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {entry.isViolation ? "BLOCKER" : "REVERSIBLE"}
            </span>
          </div>

          {/* Title */}
          <Link
            href={`/entry/${entry.id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--atlas-fg)", marginBottom: 8, lineHeight: 1.35, textDecoration: "none" }}
          >
            {entry.title}
          </Link>

          {/* Short definition (italic intro) */}
          {shortDef && (
            <div style={{ fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: context ? 12 : 10, fontStyle: "italic" }}>
              {shortDef}
            </div>
          )}

          {/* WHAT IT MEANS */}
          {context && (
            <>
              <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(120,113,108,0.45)", marginBottom: 5 }}>
                What it means
              </div>
              <div style={{ fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.65, marginBottom: 12 }}>
                {context}
              </div>
            </>
          )}

          {/* Details toggle */}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              style={{
                marginBottom: 10, background: "transparent", border: "none",
                cursor: "pointer", padding: 0,
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "rgba(120,113,108,0.5)", textTransform: "uppercase" as const,
              }}
            >
              <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                style={{ transform: showDetails ? "rotate(180deg)" : "none", transition: "transform 160ms ease", flexShrink: 0 }}>
                <path d="M2 4l4 4 4-4" />
              </svg>
              Details
            </button>
          )}

          {/* Details panel */}
          {hasDetails && showDetails && (
            <div style={{
              marginBottom: 12,
              background: "rgba(12,10,9,0.6)",
              border: "1px solid rgba(201,162,76,0.1)",
              borderRadius: 6,
              padding: "10px 12px",
            }}>
              {entry.details && (
                <pre style={{
                  margin: 0, marginBottom: (entry.touched && entry.touched.length > 0) ? 10 : 0,
                  fontSize: 11, fontFamily: "var(--app-font-mono)",
                  color: "var(--atlas-muted)", lineHeight: 1.6,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {entry.details}
                </pre>
              )}
              {entry.touched && entry.touched.length > 0 && (
                <>
                  <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(120,113,108,0.45)", marginBottom: 6 }}>
                    Touched files
                  </div>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 3 }}>
                    {entry.touched.map((f, i) => (
                      <li key={i} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.6)", letterSpacing: "0.03em" }}>
                        · {f}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
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
              <Link
                href={`/entry/${entry.id}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em",
                  color: committed ? "var(--atlas-fg)" : "var(--atlas-muted)",
                  textDecoration: "none",
                }}
              >
                {entry.title}
              </Link>
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
// ── diff stat helper ──────────────────────────────────────────────────────────
function diffStat(original: string | null, next: string): { additions: number; deletions: number } {
  if (!original) return { additions: next.split("\n").filter(l => l.trim()).length, deletions: 0 };
  // Bag-of-lines approach: O(n), handles repeated lines correctly
  const bag = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const aBag = bag(original);
  const bBag = bag(next);
  let deletions = 0;
  for (const [l, c] of aBag) { const bc = bBag.get(l) ?? 0; if (c > bc) deletions += c - bc; }
  let additions = 0;
  for (const [l, c] of bBag) { const ac = aBag.get(l) ?? 0; if (c > ac) additions += c - ac; }
  return { additions, deletions };
}

// ── PushDiffCard ──────────────────────────────────────────────────────────────
// Groups one commit's worth of file pushes into a collapsible diff card.
function PushDiffCard({ records, onRollbackAll }: { records: PushRecord[]; onRollbackAll: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  const [rolling, setRolling] = useState(false);
  const [done, setDone] = useState(records.every(r => r.rolledBack));

  const first = records[0];
  const canRollback = records.some(r => r.originalContent && !r.rolledBack);

  const stats = records.map(r => ({ ...r, ...diffStat(r.originalContent, r.newContent) }));
  const totalAdded = stats.reduce((s, r) => s + r.additions, 0);
  const totalDeleted = stats.reduce((s, r) => s + r.deletions, 0);

  return (
    <div style={{ borderRadius: 8, background: "rgba(0,0,0,0.22)", border: "1px solid var(--atlas-border)", marginBottom: 7, overflow: "hidden" }}>
      {/* Collapsible header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10" fill="none"
          style={{ flexShrink: 0, transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", opacity: 0.45 }}
        >
          <path d="M3 2l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", flex: 1 }}>
          {records.length} File{records.length !== 1 ? "s" : ""} Changed
        </span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "#4ade80", opacity: 0.8 }}>+{totalAdded}</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "#f87171", opacity: 0.8, marginRight: 4 }}>-{totalDeleted}</span>
        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, color: "var(--atlas-muted)", opacity: 0.45 }}>
          {new Date(first.pushedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </button>

      {/* File list */}
      {open && (
        <div style={{ borderTop: "1px solid var(--atlas-border)" }}>
          {stats.map(r => {
            const ext = r.filename.split(".").pop()?.toLowerCase() ?? "";
            const iconColor =
              ext === "ts" || ext === "tsx" ? "#60a5fa"
              : ext === "js" || ext === "jsx" ? "#fbbf24"
              : ext === "css" || ext === "scss" ? "#a78bfa"
              : ext === "json" ? "#34d399"
              : ext === "md" ? "#C9A24C"
              : ext === "py" ? "#4ade80"
              : ext === "html" ? "#f97316"
              : ext === "sh" || ext === "bash" ? "#86efac"
              : "rgba(120,113,108,0.65)";
            const isNew = r.originalContent === null;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid rgba(37,34,32,0.6)" }}>
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.8 }}>
                  <path d="M9 1H3a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V6L9 1z" stroke={iconColor} strokeWidth="1.2" strokeLinejoin="round" />
                  <path d="M9 1v5h5" stroke={iconColor} strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
                <span style={{ flex: 1, fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.filename}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "#4ade80", flexShrink: 0 }}>+{r.additions}</span>
                {isNew ? (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8.5, background: "rgba(74,222,128,0.12)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", padding: "0px 5px", borderRadius: 4, flexShrink: 0, letterSpacing: "0.04em" }}>New</span>
                ) : (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "#f87171", flexShrink: 0 }}>-{r.deletions}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {first.branch}
        </div>
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          {first.commitUrl && (
            <a href={first.commitUrl} target="_blank" rel="noopener noreferrer"
              style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", textDecoration: "none", opacity: 0.75 }}
            >
              View →
            </a>
          )}
          {canRollback && !done && (
            <button
              disabled={rolling}
              onClick={async () => { setRolling(true); await onRollbackAll(); setRolling(false); setDone(true); }}
              style={{ padding: "3px 9px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", background: rolling ? "rgba(255,255,255,0.03)" : "rgba(239,68,68,0.07)", border: `1px solid ${rolling ? "var(--atlas-border)" : "rgba(239,68,68,0.22)"}`, color: rolling ? "var(--atlas-muted)" : "rgba(252,165,165,0.8)", cursor: rolling ? "not-allowed" : "pointer", transition: "all 150ms ease" }}
            >
              {rolling ? "…" : "↺ Rollback"}
            </button>
          )}
          {done && <span style={{ padding: "3px 9px", fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.45 }}>rolled back</span>}
        </div>
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
  const { data: ledgerProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });

  const [vaultSaving, setVaultSaving] = useState(false);
  const [vaultSaved, setVaultSaved] = useState(false);

  const handleSaveToVault = async () => {
    if (vaultSaving || allCommitted.length === 0) return;
    setVaultSaving(true);
    const projectName = ledgerProject?.name ?? "Unknown Project";
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const title = `${projectName} — ${dateStr}`;
    const tagSet = new Set<string>();
    const lines = allCommitted.map((e) => {
      if (e.mode) tagSet.add(e.mode.toUpperCase());
      return `• ${e.title}${e.summary ? `\n  ${e.summary}` : ""}`;
    });
    const content = `Decision Ledger Snapshot — ${projectName}\n${dateStr}\n\n${lines.join("\n\n")}`;
    try {
      await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          projectName,
          title,
          content,
          entryCount: allCommitted.length,
          tags: tagSet.size > 0 ? Array.from(tagSet) : null,
        }),
      });
      setVaultSaved(true);
      setTimeout(() => setVaultSaved(false), 2500);
    } finally {
      setVaultSaving(false);
    }
  };

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
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10.5, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: parked.length > 0 ? "var(--atlas-fg)" : "var(--atlas-muted)", fontWeight: 600 }}>
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
        {pushHistory.length > 0 ? (() => {
          // Group records by commitUrl so multi-file commits show as one card
          const groups: PushRecord[][] = [];
          const seen = new Map<string, PushRecord[]>();
          for (const r of [...pushHistory].reverse()) {
            const key = r.commitUrl || r.id;
            if (!seen.has(key)) { seen.set(key, []); groups.push(seen.get(key)!); }
            seen.get(key)!.push(r);
          }
          return groups.map((group) => (
            <PushDiffCard
              key={group[0].commitUrl || group[0].id}
              records={group}
              onRollbackAll={async () => {
                for (const r of group) await onRollbackPush(r);
              }}
            />
          ));
        })() : (
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.35, lineHeight: 1.65 }}>
            Code pushes will appear here. Tap <strong style={{ opacity: 0.6 }}>Rollback</strong> on any to instantly restore the original.
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div style={{ padding: "8px 12px", borderTop: "1px solid var(--atlas-border)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
        <button
          onClick={handleSaveToVault}
          disabled={vaultSaving || allCommitted.length === 0}
          title={allCommitted.length === 0 ? "No committed decisions to save" : "Save a snapshot of this ledger to the Vault"}
          style={{
            width: "100%", padding: "7px", borderRadius: 6,
            background: vaultSaved ? "rgba(201,162,76,0.1)" : "transparent",
            border: `1px solid ${vaultSaved ? "rgba(201,162,76,0.4)" : "rgba(201,162,76,0.15)"}`,
            color: vaultSaved ? "var(--atlas-gold)" : "var(--atlas-muted)", fontSize: 11,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            cursor: vaultSaving || allCommitted.length === 0 ? "default" : "pointer",
            opacity: allCommitted.length === 0 ? 0.35 : vaultSaved ? 1 : 0.55,
            transition: "all 160ms ease",
          }}
          onMouseEnter={(e) => { if (!vaultSaving && allCommitted.length > 0 && !vaultSaved) { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)"; e.currentTarget.style.color = "var(--atlas-gold)"; } }}
          onMouseLeave={(e) => { if (!vaultSaved) { e.currentTarget.style.opacity = allCommitted.length === 0 ? "0.35" : "0.55"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.15)"; e.currentTarget.style.color = "var(--atlas-muted)"; } }}
        >
          {vaultSaved ? "◆ Saved to Vault" : vaultSaving ? "Saving…" : "◆ Save to Vault"}
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
          <span style={{ fontSize: 11.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", textAlign: "left" }}>
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
      <span style={{ fontSize: 11.5, color: isSelected ? "var(--atlas-fg)" : "var(--atlas-muted)", fontFamily: "var(--app-font-sans)", textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
  const createProject = useCreateProject();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: filesProject } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: allProjects } = useListProjects();

  const getGlobalToken = () => { try { return localStorage.getItem("atlas-github-token") || null; } catch { return null; } };
  const setGlobalToken = (t: string | null) => { try { if (t) localStorage.setItem("atlas-github-token", t); else localStorage.removeItem("atlas-github-token"); } catch {} };

  const [tokenState, setTokenState] = useState<string | null>(() => getGlobalToken());
  const [serverTokenAvailable, setServerTokenAvailable] = useState(false);
  const [serverTokenChecked, setServerTokenChecked] = useState(false);
  const tokenSynced = useRef(false);
  const [autoLinkStatus, setAutoLinkStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [autoLinkResult, setAutoLinkResult] = useState<{ linked: Array<{ projectName: string; repoFullName: string }>; skipped: string[] } | null>(null);

  // Check if server has a GITHUB_TOKEN configured — auto-connect if no manual token exists
  useEffect(() => {
    fetch("/api/github/server-token")
      .then(r => r.ok ? r.json() : { available: false })
      .then((d: any) => {
        const avail = !!d.available;
        setServerTokenAvailable(avail);
        setServerTokenChecked(true);
        if (avail && !getGlobalToken()) {
          setTokenState("__server__");
        }
      })
      .catch(() => setServerTokenChecked(true));
  }, []);

  useEffect(() => {
    if (!filesProject) return;
    const globalToken = getGlobalToken();
    const dbToken = filesProject.githubToken ?? null;

    if (globalToken || dbToken) {
      if (tokenSynced.current) return;
      tokenSynced.current = true;
      const t = globalToken ?? dbToken!;
      setTokenState(t);
      setGlobalToken(t);
      // Back-fill this project if it only had the token in localStorage
      if (!dbToken) updateProject.mutate({ id: projectId, data: { githubToken: t } });
      return;
    }

    // No token in localStorage or this project's DB — check sibling projects
    if (!allProjects) return;
    if (tokenSynced.current) return;
    tokenSynced.current = true;
    const sibling = allProjects.find((p) => p.id !== projectId && p.githubToken);
    if (sibling?.githubToken) {
      const t = sibling.githubToken;
      setTokenState(t);
      setGlobalToken(t);
      updateProject.mutate({ id: projectId, data: { githubToken: t } });
    }
  }, [filesProject, allProjects]);
  const [tokenInput, setTokenInput] = useState("");
  const [tokenSaveError, setTokenSaveError] = useState<string | null>(null);
  const [repos, setRepos] = useState<GhRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [linkRepoError, setLinkRepoError] = useState<string | null>(null);
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
  const [clearTokenError, setClearTokenError] = useState<string | null>(null);
  const [unlinkRepoError, setUnlinkRepoError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const autoLoadedRef = useRef(false);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");

  const runAutoScan = (repo: GhRepo, token: string) => {
    const scanKey = `atlas-scan-${projectId}`;
    setScanStatus("scanning");
    fetch("/api/github/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-github-token": token },
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

  // Reset auto-load gate when project switches
  useEffect(() => {
    autoLoadedRef.current = false;
    tokenSynced.current = false;
    setSelectedRepo(null);
    setTree([]);
    setSelectedPath(null);
    setFileContent(null);
    setView("repos");
    onFileContext(null);
  }, [projectId]);

  const handleAutoLink = async () => {
    if (!tokenState || autoLinkStatus === "running") return;
    setAutoLinkStatus("running");
    setAutoLinkResult(null);
    try {
      const res = await fetch("/api/github/auto-link", {
        method: "POST",
        headers: { "x-github-token": tokenState },
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

  const saveToken = (t: string) => {
    setTokenSaveError(null);
    setGlobalToken(t);
    updateProject.mutate(
      { id: projectId, data: { githubToken: t } },
      {
        onSuccess: () => {
          setTokenState(t);
          // Propagate token to every other project that doesn't have one yet
          (allProjects ?? [])
            .filter((p) => p.id !== projectId && !p.githubToken)
            .forEach((p) => {
              fetch(`/api/projects/${p.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ githubToken: t }),
              }).catch(() => {});
            });
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.message ?? "Failed to save token";
          setTokenSaveError(msg);
        },
      }
    );
  };

  const clearToken = () => {
    setClearTokenError(null);
    setIsDisconnecting(true);
    setGlobalToken(null); // clear globally
    updateProject.mutate(
      { id: projectId, data: { githubToken: null } },
      {
        onSuccess: () => {
          setIsDisconnecting(false);
          setDisconnectConfirm(false);
          setTokenState(null);
          setRepos([]); setSelectedRepo(null); setTree([]);
          setSelectedPath(null); setFileContent(null);
          setView("repos");
          onFileContext(null);
        },
        onError: (err: any) => {
          setIsDisconnecting(false);
          const msg = err?.response?.data?.error ?? err?.message ?? "Failed to disconnect GitHub";
          setClearTokenError(msg);
          setDisconnectConfirm(false);
        },
      }
    );
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
      const match = repos.find(r => r.fullName.toLowerCase() === savedRepo.fullName.toLowerCase());
      if (match) {
        autoLoadedRef.current = true;
        loadTree(match);
        // Re-inject cached scan context so AI always knows the repo structure
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
          } else if (tokenState) {
            runAutoScan(match, tokenState);
          }
        } catch {
          if (tokenState) runAutoScan(match, tokenState);
        }
      }
    } catch {}
  }, [repos, filesProject?.linkedRepo, loadTree]);

  // Link a repo to this project and load its tree
  const pickRepo = useCallback((repo: GhRepo) => {
    setLinkRepoError(null);
    updateProject.mutate(
      { id: projectId, data: { linkedRepo: JSON.stringify(repo) } },
      {
        onSuccess: () => {
          onLinkedRepoChange(repo);
          loadTree(repo);
          if (tokenState) runAutoScan(repo, tokenState);
        },
        onError: (err: any) => {
          const msg = err?.response?.data?.error ?? err?.message ?? "Failed to link repo";
          setLinkRepoError(msg);
        },
      }
    );
  }, [projectId, updateProject, onLinkedRepoChange, loadTree, tokenState]);

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

  // Token setup screen — only show after server check, and only if no token at all
  if (!tokenState) {
    if (!serverTokenChecked) {
      // Still checking — show a brief loading state to avoid flash
      return (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontSize: 10, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", opacity: 0.5 }}>connecting…</div>
        </div>
      );
    }
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 14 }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" opacity={0.25}>
          <path d="M12 2C6.48 2 2 6.48 2 12c0 4.42 2.87 8.17 6.84 9.49.5.09.68-.22.68-.48v-1.69c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.65.35-1.08.63-1.33-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.56 9.56 0 0112 6.8c.85.004 1.71.11 2.51.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10.01 10.01 0 0022 12c0-5.52-4.48-10-10-10z" fill="var(--atlas-fg)" />
        </svg>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.7, fontWeight: 500, marginBottom: 5 }}>Connect GitHub</div>
          <div style={{ fontSize: 11, color: "var(--atlas-muted)", lineHeight: 1.6, opacity: 0.6 }}>
            Paste your GitHub token once — it works<br />across all your projects automatically.
          </div>
        </div>
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 7 }}>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); setTokenSaveError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && tokenInput.trim()) saveToken(tokenInput.trim()); }}
            placeholder="ghp_…"
            autoComplete="off"
            style={{
              width: "100%", padding: "8px 10px", borderRadius: 6,
              background: "rgba(12,10,9,0.7)",
              border: `1px solid ${tokenSaveError ? "rgba(239,68,68,0.5)" : "var(--atlas-border)"}`,
              color: "var(--atlas-fg)", fontSize: 11, fontFamily: "var(--app-font-mono)",
              outline: "none", boxSizing: "border-box",
              transition: "border-color 160ms ease",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = tokenSaveError ? "rgba(239,68,68,0.5)" : "rgba(201,162,76,0.4)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = tokenSaveError ? "rgba(239,68,68,0.5)" : "var(--atlas-border)")}
          />
          {tokenSaveError && (
            <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4, marginTop: -2 }}>
              {tokenSaveError}
            </div>
          )}
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
          {tokenState === "__server__" ? (
            <span
              title="Connected automatically via Replit GitHub integration"
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 6,
                background: "rgba(52,211,153,0.07)",
                border: "1px solid rgba(52,211,153,0.18)",
                fontSize: 9.5, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.05em", color: "rgba(52,211,153,0.75)",
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", flexShrink: 0 }} />
              via Replit
            </span>
          ) : disconnectConfirm ? (
            <div style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(220,38,38,0.08)", border: "1px solid rgba(220,38,38,0.2)", borderRadius: 6, padding: "4px 8px" }}>
              <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(252,165,165,0.85)", letterSpacing: "0.04em" }}>Remove token?</span>
              <button
                onClick={() => setDisconnectConfirm(false)}
                disabled={isDisconnecting}
                style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, cursor: isDisconnecting ? "default" : "pointer", color: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", padding: "3px 8px", opacity: isDisconnecting ? 0.35 : 0.8, minHeight: 28 }}
              >Cancel</button>
              <button
                onClick={clearToken}
                disabled={isDisconnecting}
                style={{ background: "rgba(220,38,38,0.2)", border: "1px solid rgba(220,38,38,0.4)", borderRadius: 5, cursor: isDisconnecting ? "default" : "pointer", color: "rgba(252,165,165,0.95)", fontSize: 10, fontFamily: "var(--app-font-mono)", padding: "3px 8px", opacity: isDisconnecting ? 0.55 : 1, minHeight: 28 }}
              >{isDisconnecting ? "removing…" : "Remove"}</button>
            </div>
          ) : (
            <button
              onClick={() => setDisconnectConfirm(true)}
              title="Change GitHub token"
              style={{
                display: "flex", alignItems: "center", gap: 4,
                background: "rgba(212,175,55,0.06)",
                border: "1px solid rgba(212,175,55,0.18)",
                borderRadius: 6, cursor: "pointer",
                color: "rgba(212,175,55,0.65)", fontSize: 9.5,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
                padding: "4px 8px", minHeight: 28,
                transition: "all 140ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(212,175,55,0.12)"; e.currentTarget.style.color = "rgba(212,175,55,0.9)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(212,175,55,0.06)"; e.currentTarget.style.color = "rgba(212,175,55,0.65)"; }}
            >
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="5" cy="8" r="2.5" /><path d="M7.5 8h4M10 6v4" />
                <path d="M3 5.5L5.5 3 8 5.5" />
              </svg>
              token
            </button>
          )}
        </div>
      </div>

      {/* Inline errors for disconnect / unlink */}
      {clearTokenError && (
        <div style={{ margin: "4px 6px 0", padding: "6px 10px", borderRadius: 5, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ flexShrink: 0, opacity: 0.7 }}>✕</span>
          <span>{clearTokenError}</span>
        </div>
      )}
      {unlinkRepoError && (
        <div style={{ margin: "4px 6px 0", padding: "6px 10px", borderRadius: 5, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4, display: "flex", alignItems: "flex-start", gap: 6 }}>
          <span style={{ flexShrink: 0, opacity: 0.7 }}>✕</span>
          <span>{unlinkRepoError}</span>
        </div>
      )}

      {/* Repos list */}
      {view === "repos" && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }} className="scrollbar-none">

          {/* Auto-link all projects button — appears when repos are loaded */}
          {!reposLoading && repos.length > 0 && (allProjects ?? []).some(p => !p.linkedRepo) && (
            <div style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 6, background: "rgba(201,162,76,0.04)", border: "1px solid rgba(201,162,76,0.14)" }}>
              {autoLinkStatus !== "done" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", lineHeight: 1.4, opacity: 0.75 }}>
                    {(allProjects ?? []).filter(p => !p.linkedRepo).length} project{(allProjects ?? []).filter(p => !p.linkedRepo).length !== 1 ? "s" : ""} need a repo
                  </div>
                  <button
                    onClick={handleAutoLink}
                    disabled={autoLinkStatus === "running"}
                    style={{
                      flexShrink: 0, padding: "4px 10px", borderRadius: 4,
                      background: autoLinkStatus === "running" ? "rgba(201,162,76,0.08)" : "rgba(201,162,76,0.14)",
                      border: "1px solid rgba(201,162,76,0.3)",
                      color: "var(--atlas-gold)", fontSize: 10, fontFamily: "var(--app-font-mono)",
                      letterSpacing: "0.06em", cursor: autoLinkStatus === "running" ? "not-allowed" : "pointer",
                      opacity: autoLinkStatus === "running" ? 0.6 : 1, transition: "opacity 140ms ease",
                    }}
                  >
                    {autoLinkStatus === "running" ? "Linking…" : "Auto-link all →"}
                  </button>
                </div>
              )}
              {autoLinkStatus === "done" && autoLinkResult && (
                <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", lineHeight: 1.7 }}>
                  {autoLinkResult.linked.length > 0 && (
                    <div style={{ color: "#34d399" }}>
                      ✓ Linked: {autoLinkResult.linked.map(l => l.projectName).join(", ")}
                    </div>
                  )}
                  {autoLinkResult.skipped.length > 0 && (
                    <div style={{ color: "var(--atlas-muted)", opacity: 0.65 }}>
                      — No match: {autoLinkResult.skipped.join(", ")}
                    </div>
                  )}
                  {autoLinkResult.linked.length === 0 && autoLinkResult.skipped.length === 0 && (
                    <div style={{ color: "var(--atlas-muted)" }}>All projects already linked.</div>
                  )}
                </div>
              )}
              {autoLinkStatus === "error" && autoLinkResult && (
                <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)" }}>
                  ✗ {autoLinkResult.skipped[0] ?? "Auto-link failed"}
                </div>
              )}
            </div>
          )}

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
          {linkRepoError && (
            <div style={{ margin: "4px 4px 2px", padding: "7px 10px", borderRadius: 5, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.4 }}>
              {linkRepoError}
            </div>
          )}
          {!reposLoading && repos.map((repo) => {
            let linkedFullName: string | null = null;
            try {
              linkedFullName = filesProject?.linkedRepo ? JSON.parse(filesProject.linkedRepo).fullName : null;
            } catch {}
            const isLinked = linkedFullName === repo.fullName;
            return (
              <div
                key={repo.id}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 4,
                  marginBottom: 2,
                }}
              >
                {/* Main repo row — browse / link to current project */}
                <button
                  onClick={() => pickRepo(repo)}
                  style={{
                    flex: 1, display: "flex", flexDirection: "column", gap: 3,
                    padding: "8px 10px", borderRadius: 5,
                    background: isLinked ? "rgba(52,211,153,0.04)" : "transparent",
                    border: `1px solid ${isLinked ? "rgba(52,211,153,0.15)" : "transparent"}`,
                    cursor: "pointer", textAlign: "left",
                    transition: "all 120ms ease", minWidth: 0,
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
                    <span style={{ fontSize: 12, color: "var(--atlas-fg)", fontFamily: "var(--app-font-sans)", fontWeight: isLinked ? 600 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{repo.name}</span>
                    {repo.private && (
                      <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 3, background: "rgba(120,113,108,0.12)", color: "var(--atlas-muted)", border: "0.5px solid rgba(120,113,108,0.2)", flexShrink: 0 }}>
                        private
                      </span>
                    )}
                    {repo.language && (
                      <span style={{ fontSize: 8.5, color: "var(--atlas-muted)", marginLeft: "auto", fontFamily: "var(--app-font-mono)", opacity: 0.55, flexShrink: 0 }}>{repo.language}</span>
                    )}
                  </div>
                  {repo.description && (
                    <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.55, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: isLinked ? 11 : 0 }}>
                      {repo.description}
                    </div>
                  )}
                </button>

                {/* Import → New project button */}
                <button
                  title={`Create a new Axiom project for ${repo.name}`}
                  onClick={() => {
                    createProject.mutate(
                      { data: { name: repo.name } },
                      {
                        onSuccess: (newProject) => {
                          const token = localStorage.getItem("atlas-github-token") || null;
                          const repoJson = JSON.stringify(repo);
                          updateProject.mutate(
                            { id: newProject.id, data: { linkedRepo: repoJson, ...(token ? { githubToken: token } : {}) } },
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
                    flexShrink: 0, display: "flex", alignItems: "center", gap: 3,
                    padding: "5px 7px", borderRadius: 5,
                    background: "rgba(201,162,76,0.05)",
                    border: "1px solid rgba(201,162,76,0.15)",
                    cursor: createProject.isPending ? "not-allowed" : "pointer",
                    color: "rgba(201,162,76,0.55)",
                    transition: "all 140ms ease",
                    opacity: createProject.isPending ? 0.4 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!createProject.isPending) {
                      e.currentTarget.style.background = "rgba(201,162,76,0.12)";
                      e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)";
                      e.currentTarget.style.color = "rgba(201,162,76,0.9)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(201,162,76,0.05)";
                    e.currentTarget.style.borderColor = "rgba(201,162,76,0.15)";
                    e.currentTarget.style.color = "rgba(201,162,76,0.55)";
                  }}
                >
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M6 1v10M1 6h10" />
                  </svg>
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>project</span>
                </button>
              </div>
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
    </div>
  );
}

// ── Preview tab ──────────────────────────────────────────────────────────────
function PreviewTab({ projectId, sandboxCode, onSandboxConsumed }: {
  projectId: number;
  sandboxCode?: string | null;
  onSandboxConsumed?: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const updateProject = useUpdateProject();

  // Mode toggle
  const [previewMode, setPreviewMode] = useState<"url" | "sandbox" | "local">("url");

  // Device switcher
  type DeviceSize = "phone" | "tablet" | "desktop";
  const [deviceSize, setDeviceSize] = useState<DeviceSize>("desktop");
  const [isLandscape, setIsLandscape] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sandbox state
  const [sandboxInput, setSandboxInput] = useState("");
  const [sandboxRendered, setSandboxRendered] = useState<string | null>(null);
  const [sandboxExpanded, setSandboxExpanded] = useState(true);

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
  const [autoDetected, setAutoDetected] = useState<{ url: string; platform: string } | null>(null);
  const autoDetectTriedRef = useRef<string | null>(null);

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

  // ── Sandbox handoff from chat ────────────────────────────────────────────────
  const buildSrcdoc = (code: string): string => {
    const t = code.trim();
    if (/^\s*<!DOCTYPE/i.test(t) || /^\s*<html/i.test(t)) return t;
    return `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <script src="https://cdn.tailwindcss.com"><\/script>\n  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }</style>\n</head>\n<body>\n${t}\n</body>\n</html>`;
  };
  useEffect(() => {
    if (!sandboxCode) return;
    setPreviewMode("sandbox");
    setSandboxInput(sandboxCode);
    setSandboxRendered(buildSrcdoc(sandboxCode));
    setSandboxExpanded(false);
    onSandboxConsumed?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandboxCode]);

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
    if (!resolved) setAutoDetected(null);
  }, [projectId, project?.previewUrl]);

  // ── Auto-detect URL when repo is linked and no URL saved yet ────────────────
  useEffect(() => {
    const repoKey = linkedRepo?.fullName ?? null;
    if (!repoKey || !token || liveUrl || detecting) return;
    if (autoDetectTriedRef.current === `${projectId}:${repoKey}`) return;
    autoDetectTriedRef.current = `${projectId}:${repoKey}`;
    const run = async () => {
      setDetecting(true);
      try {
        const res = await fetch(`/api/github/deployment?repo=${encodeURIComponent(repoKey)}`, {
          headers: { "x-github-token": token },
        });
        if (!res.ok) return;
        const data = await res.json() as {
          detected: Array<{ url: string; platform: string; confidence: string }>;
          suggestions: Array<{ url: string; platform: string; confidence: string }>;
        };
        // Prefer high-confidence confirmed deployments
        const best = data.detected?.find((d) => d.confidence === "high")
          ?? data.detected?.[0]
          ?? null;
        if (best) {
          const u = normalize(best.url);
          setUrlInput(u);
          setLiveUrl(u);
          setIframeError(false);
          setIframeLoading(true);
          setReloadKey((k) => k + 1);
          setAutoDetected({ url: u, platform: best.platform });
          setDetectResults([]);
          try { localStorage.setItem(storageKey, u); } catch {}
          updateProject.mutate(
            { id: projectId, data: { previewUrl: u } },
            { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }) }
          );
        } else {
          // No confirmed URL — surface suggestions so user can pick
          const all = [
            ...(data.detected ?? []),
            ...(data.suggestions ?? []).filter((s) => !data.detected?.find((d) => d.url === s.url)),
          ];
          if (all.length > 0) setDetectResults(all);
        }
      } catch {}
      finally { setDetecting(false); }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedRepo?.fullName, token, liveUrl, projectId]);

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

  const handleGo = () => { if (urlInput.trim()) { setAutoDetected(null); applyUrl(urlInput.trim()); } };

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
    setDetectResults([]); setAutoDetected(null);
    autoDetectTriedRef.current = null;
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
    if (p === "Vercel") return "var(--atlas-fg)";
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

  // Device config
  const DEVICE_CONFIG = {
    phone:   { portrait: [390, 844],   landscape: [844, 390] },
    tablet:  { portrait: [768, 1024],  landscape: [1024, 768] },
    desktop: { portrait: [null, null], landscape: [null, null] },
  } as const;
  const orient = isLandscape ? "landscape" : "portrait";
  const [dW, dH] = DEVICE_CONFIG[deviceSize][orient];
  const scale = dW && containerW > 0 && containerW < dW + 24 ? (containerW - 24) / dW : 1;

  const deviceBtnStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", justifyContent: "center",
    gap: 3, padding: "4px 7px", borderRadius: 4,
    background: active ? "rgba(201,162,76,0.12)" : "transparent",
    border: `1px solid ${active ? "rgba(201,162,76,0.3)" : "transparent"}`,
    color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
    fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em",
    cursor: "pointer", transition: "all 140ms ease", opacity: active ? 1 : 0.5,
  });

  // Device iframe wrapper — inline to avoid component-in-component remounting
  const deviceWrapperStyle: React.CSSProperties = deviceSize === "desktop"
    ? { flex: 1, position: "relative", overflow: "hidden" }
    : { flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "hidden", padding: "12px 8px", background: "rgba(0,0,0,0.18)" };
  const deviceInnerStyle: React.CSSProperties = deviceSize === "desktop"
    ? { width: "100%", height: "100%", position: "absolute", inset: 0 }
    : {
        width: dW ?? undefined, height: dH ?? undefined,
        transform: `scale(${scale})`, transformOrigin: "top center",
        borderRadius: 14, overflow: "hidden", flexShrink: 0,
        boxShadow: "0 0 0 1px rgba(255,255,255,0.07), 0 8px 32px rgba(0,0,0,0.55)",
        background: "#fff",
      };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Mode toggle */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
        {(["url", "sandbox", "local"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setPreviewMode(m)}
            style={{
              flex: 1, padding: "7px 0", background: "transparent", border: "none",
              borderBottom: previewMode === m ? "2px solid var(--atlas-gold)" : "2px solid transparent",
              color: previewMode === m ? "var(--atlas-gold)" : "var(--atlas-muted)",
              fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: "pointer",
              opacity: previewMode === m ? 1 : 0.45,
              transition: "all 140ms ease",
            }}
          >
            {m === "url" ? "Live URL" : m === "sandbox" ? "Sandbox" : "Local Dev"}
          </button>
        ))}
      </div>

      {/* Device switcher — shown for URL + Sandbox modes */}
      {(previewMode === "url" || previewMode === "sandbox") && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "5px 8px", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
          <button style={deviceBtnStyle(deviceSize === "phone")} onClick={() => setDeviceSize("phone")}>
            <svg width="8" height="11" viewBox="0 0 8 11" fill="none"><rect x="0.5" y="0.5" width="7" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" /><circle cx="4" cy="8.5" r="0.6" fill="currentColor" /></svg>
            Phone
          </button>
          <button style={deviceBtnStyle(deviceSize === "tablet")} onClick={() => setDeviceSize("tablet")}>
            <svg width="10" height="11" viewBox="0 0 10 11" fill="none"><rect x="0.5" y="0.5" width="9" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" /><circle cx="5" cy="8.5" r="0.6" fill="currentColor" /></svg>
            Tablet
          </button>
          <button style={deviceBtnStyle(deviceSize === "desktop")} onClick={() => { setDeviceSize("desktop"); setIsLandscape(false); }}>
            <svg width="11" height="9" viewBox="0 0 11 9" fill="none"><rect x="0.5" y="0.5" width="10" height="7" rx="1" stroke="currentColor" strokeWidth="1" /><path d="M3 8.5h5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
            Desktop
          </button>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => { if (deviceSize !== "desktop") setIsLandscape((l) => !l); }}
            title={deviceSize === "desktop" ? "Rotate applies to Phone / Tablet only" : isLandscape ? "Switch to portrait" : "Switch to landscape"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              padding: "4px 8px", borderRadius: 4, cursor: deviceSize === "desktop" ? "not-allowed" : "pointer",
              background: isLandscape && deviceSize !== "desktop" ? "rgba(201,162,76,0.1)" : "transparent",
              border: `1px solid ${isLandscape && deviceSize !== "desktop" ? "rgba(201,162,76,0.28)" : "var(--atlas-border)"}`,
              color: isLandscape && deviceSize !== "desktop" ? "var(--atlas-gold)" : "var(--atlas-muted)",
              opacity: deviceSize === "desktop" ? 0.22 : 0.8,
              transition: "all 140ms ease",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 13L13 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M13 3v4M13 3H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 13H7M3 13v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em" }}>
              {deviceSize !== "desktop" ? (isLandscape ? "Landscape" : "Portrait") : "Rotate"}
            </span>
          </button>
        </div>
      )}

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
            <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {autoDetected ? (
                <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 4, background: "rgba(134,239,172,0.06)", border: "1px solid rgba(134,239,172,0.18)", flexShrink: 0 }}>
                  <span style={{ fontSize: 8, color: "rgba(134,239,172,0.7)" }}>✓</span>
                  <span style={{ fontSize: 9, ...sMono, color: "rgba(134,239,172,0.7)", letterSpacing: "0.06em" }}>
                    Auto-detected · {autoDetected.platform}
                  </span>
                  <button onClick={() => { setAutoDetected(null); autoDetectTriedRef.current = null; handleDetect(); }}
                    title="Re-run detection"
                    style={{ background: "transparent", border: "none", color: "rgba(134,239,172,0.4)", cursor: "pointer", fontSize: 10, padding: "0 0 0 3px", lineHeight: 1 }}>
                    ↺
                  </button>
                </div>
              ) : linkedRepo && token ? (
                <button onClick={handleDetect} disabled={detecting} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: detecting ? "rgba(255,255,255,0.04)" : "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: detecting ? "var(--atlas-muted)" : "var(--atlas-gold)", cursor: detecting ? "not-allowed" : "pointer", flexShrink: 0 }}>
                  {detecting ? "Detecting…" : "Auto-detect URL"}
                </button>
              ) : (
                <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.35 }}>Link a repo in Files to auto-detect URL</div>
              )}
              {liveUrl && (
                <button onClick={handleSaveToProject} disabled={savedIndicator || updateProject.isPending || !!autoDetected} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: (savedIndicator || autoDetected) ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.04)", border: `1px solid ${(savedIndicator || autoDetected) ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`, color: (savedIndicator || autoDetected) ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", cursor: (savedIndicator || autoDetected) ? "default" : "pointer", flexShrink: 0, transition: "all 160ms ease" }}>
                  {savedIndicator || autoDetected ? "✓ Saved to project" : project?.previewUrl === liveUrl ? "Saved to project" : "Save to project"}
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
          <div ref={containerRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {liveUrl && !iframeError ? (
            <div style={deviceWrapperStyle}>
              <div style={deviceInnerStyle}>
                {iframeLoading && (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--atlas-bg)", zIndex: 2 }}>
                    <LoadingSpinner size="sm" color="atlas" />
                    <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.4 }}>Loading preview…</div>
                  </div>
                )}
                <iframe key={`${liveUrl}-${reloadKey}`} src={liveUrl} title="Preview"
                  style={{ border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                  onLoad={() => setIframeLoading(false)}
                  onError={() => { setIframeError(true); setIframeLoading(false); }}
                />
              </div>
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
                {detecting
                  ? <>Searching for your live deployment…</>
                  : linkedRepo
                    ? <>Click <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Auto-detect URL</strong> to find<br />your live deployment automatically.</>
                    : <>Paste your deployment URL above,<br />or link a GitHub repo in Files<br />to auto-detect it.</>
                }
              </div>
              <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.25, textAlign: "center", lineHeight: 1.7, marginTop: 4, fontFamily: "var(--app-font-mono)" }}>
                This tab previews your live app URL.<br />To browse code files, use the Files tab.
              </div>
            </div>
          )}
          </div>
        </>
      )}

      {/* ── Sandbox mode ── */}
      {previewMode === "sandbox" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Code input area */}
          <div style={{ flexShrink: 0, borderBottom: "1px solid var(--atlas-border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 0" }}>
              <button
                onClick={() => setSandboxExpanded((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em", padding: "0 2px", opacity: 0.65 }}
              >
                <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ transition: "transform 140ms ease", transform: sandboxExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>
                  <path d="M2 1.5L6 4.5L2 7.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {sandboxExpanded ? "Hide code" : "Edit code"}
              </button>
              <div style={{ flex: 1 }} />
              {sandboxRendered && (
                <button
                  onClick={() => { setSandboxInput(""); setSandboxRendered(null); setSandboxExpanded(true); }}
                  style={{ padding: "2px 7px", borderRadius: 4, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 9, fontFamily: "var(--app-font-mono)", cursor: "pointer", opacity: 0.45, transition: "opacity 140ms ease" }}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
                >Clear</button>
              )}
            </div>
            {sandboxExpanded && (
              <div style={{ padding: "6px 8px 8px" }}>
                <textarea
                  value={sandboxInput}
                  onChange={(e) => setSandboxInput(e.target.value)}
                  placeholder="Paste HTML, CSS, or any component here…"
                  rows={6}
                  style={{
                    width: "100%", resize: "vertical", background: "rgba(12,10,9,0.8)",
                    border: "1px solid var(--atlas-border)", borderRadius: 6,
                    color: "var(--atlas-fg)", fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                    lineHeight: 1.6, padding: "7px 9px", outline: "none",
                    transition: "border-color 160ms ease", boxSizing: "border-box",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.35)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => { if (sandboxInput.trim()) { setSandboxRendered(buildSrcdoc(sandboxInput)); setSandboxExpanded(false); } }}
                    disabled={!sandboxInput.trim()}
                    style={{ padding: "5px 12px", borderRadius: 5, background: sandboxInput.trim() ? "var(--atlas-ember)" : "rgba(255,255,255,0.04)", border: "none", color: sandboxInput.trim() ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", cursor: sandboxInput.trim() ? "pointer" : "not-allowed", transition: "all 140ms ease" }}
                  >Render</button>
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.28 }}>HTML · Tailwind included</span>
                </div>
              </div>
            )}
          </div>
          {/* Sandbox preview area */}
          <div ref={containerRef} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {sandboxRendered ? (
              <div style={deviceWrapperStyle}>
                <div style={deviceInnerStyle}>
                  <iframe
                    key={sandboxRendered.slice(0, 80)}
                    srcDoc={sandboxRendered}
                    title="Sandbox Preview"
                    sandbox="allow-scripts allow-same-origin"
                    style={{ border: "none", width: "100%", height: "100%", display: "block", background: "#fff" }}
                  />
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" opacity={0.12}>
                  <path d="M8 6l-6 6 6 6M16 6l6 6-6 6" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                  Paste any HTML or component above<br />and hit <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Render</strong> to preview it.
                </div>
                <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.22, textAlign: "center", lineHeight: 1.7, fontFamily: "var(--app-font-mono)" }}>
                  Or tap Preview on any code block in the chat<br />to send it here instantly.
                </div>
              </div>
            )}
          </div>
        </div>
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
        <LoadingSpinner size="sm" color="atlas" />
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

  const saveMapToMemory = (data: ProjectScan, existingMemory: string) => {
    const scanBlock = [
      `[Project map — ${data.repo} — scanned ${data.scannedAt.slice(0, 10)}]`,
      data.description ? `Description: ${data.description}` : "",
      data.stack?.length ? `Stack: ${data.stack.join(", ")}` : "",
      data.routes?.length ? `Routes (${data.routes.length}): ${data.routes.slice(0, 12).join(", ")}` : "",
      data.pages?.length ? `Pages: ${data.pages.slice(0, 12).join(", ")}` : "",
      data.tables?.length ? `Tables: ${data.tables.join(", ")}` : "",
      `Auth: ${data.authEnabled ? "enabled" : "not found"}`,
      `Total files: ${data.totalFiles}`,
    ].filter(Boolean).join("\n");

    // Replace any previous project map block, or append
    const MAP_RE = /\[Project map —[^\]]*\][^\[]*/g;
    const stripped = existingMemory.replace(MAP_RE, "").trim();
    const updated = stripped ? `${stripped}\n\n${scanBlock}` : scanBlock;

    updateProject.mutate(
      { id: projectId, data: { memory: updated } },
      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) }); setSavedToMemory(true); } }
    );
  };

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
      // Auto-save to Atlas memory so every future chat knows the structure
      saveMapToMemory(data, project?.memory ?? "");
    } catch (e: any) {
      setError(e.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
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

          {/* Memory save status — auto-saved after every scan */}
          <div style={{
            display: "flex", alignItems: "center", gap: 7,
            padding: "8px 11px", borderRadius: 6,
            background: savedToMemory ? "rgba(34,197,94,0.06)" : "rgba(255,255,255,0.025)",
            border: `1px solid ${savedToMemory ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`,
            transition: "all 300ms ease",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: savedToMemory ? "#34d399" : "var(--atlas-muted)", opacity: savedToMemory ? 1 : 0.3 }} />
            <span style={{ fontSize: 10, ...sMono, color: savedToMemory ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", opacity: savedToMemory ? 1 : 0.45, letterSpacing: "0.04em" }}>
              {updateProject.isPending ? "Saving to memory…" : savedToMemory ? "Saved to Atlas memory — active in chat" : "Scan to save map to Atlas memory"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Platform detection ────────────────────────────────────────────────────────
function detectPlatform(): string {
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  if (host.includes("lovable")) return "LOVABLE";
  if (host.includes("replit") || host.includes("repl.co") || host.includes("replit.app")) return "REPLIT";
  if (host.includes("cursor")) return "CURSOR";
  if (host.includes("vercel")) return "VERCEL";
  if (host.includes("netlify")) return "NETLIFY";
  if (host.includes("localhost") || host.includes("127.0.0.1")) return "LOCAL";
  return "WEB";
}

// ── SystemMapWithCockpit ────────────────────────────────────────────────────
function SystemMapWithCockpit({ projectId, onHomeNav, onSendIntent, onBackToChat, onMapReadinessChange, onSystemNodeMessage, onHandover, handoverPending, lastHandoverHash, resolvedNodeIds, onResolvedConsumed, onSnapshotChange, handoverOpen, onHandoverOpenChange, isMobile }: { projectId?: number; onHomeNav: () => void; onSendIntent?: (text: string) => void; onBackToChat?: () => void; onMapReadinessChange?: (score: number) => void; onSystemNodeMessage?: (text: string) => void; onHandover?: (payload: { snapshot: HandoverSnapshot; title: string }) => void; handoverPending?: boolean; lastHandoverHash?: string | null; resolvedNodeIds?: string[]; onResolvedConsumed?: () => void; onSnapshotChange?: (s: HandoverSnapshot | null) => void; handoverOpen?: boolean; onHandoverOpenChange?: (open: boolean) => void; isMobile?: boolean }) {
  const [readinessScore, setReadinessScore] = useState(0);
  useEffect(() => { onMapReadinessChange?.(readinessScore); }, [readinessScore, onMapReadinessChange]);
  const [nodes, setNodes] = useState<ArchNode[]>([]);
  const [pendingNodes, setPendingNodes] = useState<ArchNode[]>([]);
  const [showChat, setShowChat] = useState(true);
  const [showQuickPrompt, setShowQuickPrompt] = useState(false);
  const [signals, setSignals] = useState<string[]>([""]);
  const [activeSignalIdx, setActiveSignalIdx] = useState(0);
  const [signalAdded, setSignalAdded] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const sentFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intent = signals[activeSignalIdx] ?? "";
  const setIntent = (val: string) => setSignals(prev => prev.map((s, i) => i === activeSignalIdx ? val : s));

  useEffect(() => () => { if (sentFlashTimerRef.current) clearTimeout(sentFlashTimerRef.current); }, []);

  const handleSend = useCallback(() => {
    if (!intent.trim()) return;
    onSendIntent?.(intent.trim());
    setSignals(prev => prev.map((s, i) => i === activeSignalIdx ? "" : s));
    setSentFlash(true);
    if (sentFlashTimerRef.current) clearTimeout(sentFlashTimerRef.current);
    sentFlashTimerRef.current = setTimeout(() => setSentFlash(false), 1400);
  }, [intent, onSendIntent, activeSignalIdx]);

  const addSignal = () => {
    setSignals(prev => [...prev, ""]);
    setActiveSignalIdx(signals.length);
    setSignalAdded(true);
    setTimeout(() => setSignalAdded(false), 1200);
  };

  const deleteActiveSignal = () => {
    if (signals.length <= 1) return;
    setSignals(prev => prev.filter((_, i) => i !== activeSignalIdx));
    setActiveSignalIdx(i => Math.max(0, i - 1));
  };
  const platform = detectPlatform();
  const { data: activeProject } = useGetProject(projectId ?? 0, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId ?? 0) },
  });
  const activeProjectName = activeProject?.name;
  const updateProject = useUpdateProject();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodesChange = useCallback((updatedNodes: ArchNode[]) => {
    setNodes(updatedNodes);
    if (!projectId) return;
    // New shape: per-node object { resolved, strategicAnswer? }. The DB column
    // is jsonb so this is a non-breaking change; AxiomFlow's hydration handler
    // tolerates the legacy boolean shape on read.
    const axiomState: Record<string, { resolved: boolean; strategicAnswer?: string }> = {};
    updatedNodes.forEach(n => {
      axiomState[n.id] = n.strategicAnswer
        ? { resolved: n.resolved, strategicAnswer: n.strategicAnswer }
        : { resolved: n.resolved };
    });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Merge with existing nodeState so arch layer nodes (auth/db/api/state/ui/logic) are preserved
      const currentNodeState = (activeProject?.nodeState as Record<string, unknown>) ?? {};
      updateProject.mutate({ id: projectId, data: { nodeState: { ...currentNodeState, ...axiomState } } });
    }, 1000);
  }, [projectId, updateProject, activeProject]);

  // Save architecture layer node state (SystemMap nodes: auth/db/api/state/ui/logic)
  // Merges with AxiomFlow's node state since both write to the same project.nodeState field
  const archSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (archSaveTimerRef.current) clearTimeout(archSaveTimerRef.current); }, []);

  const handleArchNodesChange = useCallback((updatedArchNodes: SystemMapNode[]) => {
    if (!projectId) return;
    const archState: Record<string, boolean> = {};
    updatedArchNodes.forEach(n => { archState[n.id] = n.resolved; });
    if (archSaveTimerRef.current) clearTimeout(archSaveTimerRef.current);
    archSaveTimerRef.current = setTimeout(() => {
      const currentNodeState = (activeProject?.nodeState as Record<string, boolean>) ?? {};
      updateProject.mutate({ id: projectId, data: { nodeState: { ...currentNodeState, ...archState } } });
    }, 1000);
  }, [projectId, updateProject, activeProject]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        height: 1, flexShrink: 0,
        background: "linear-gradient(to right, transparent 0%, rgba(212,175,55,0.18) 20%, rgba(212,175,55,0.38) 50%, rgba(212,175,55,0.18) 80%, transparent 100%)",
      }} />

      {/* Map area — Axiom Flow (strategic) + System Map (architecture readiness)
          When intent capture is visible, cap at 54% so the input section always
          has enough room on every phone size. */}
      <div style={{ position: "relative", flex: showChat ? "0 0 auto" : 1, height: showChat ? "min(54%, calc(100% - 316px))" : undefined, minHeight: showChat ? 200 : 0, overflow: "hidden", display: "flex", flexDirection: "column", transition: "flex 350ms ease" }}>
        {/* Axiom Flow canvas */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
          <AxiomFlow
            projectId={projectId}
            onReadinessChange={setReadinessScore}
            onNodesChange={handleNodesChange}
            compact
            detectedBuilder={platform.toLowerCase()}
            onNodeFocus={(text) => setIntent(text)}
            initialNodeState={(activeProject?.nodeState as NodeStateMap | null) ?? null}
            pendingNodes={pendingNodes}
            onPendingConsumed={() => setPendingNodes([])}
            onUnansweredQuestionOpen={({ mirror }) => onSystemNodeMessage?.(mirror)}
            onHandover={onHandover}
            handoverPending={handoverPending}
            lastHandoverHash={lastHandoverHash}
            onSnapshotChange={onSnapshotChange}
            handoverOpen={handoverOpen}
            onHandoverOpenChange={onHandoverOpenChange}
            isMobile={isMobile}
          />
        </div>
        {/* System Map — architecture layer readiness (auth/db/api/state/ui/logic)
            Hidden on mobile: its readiness score feeds the workspace header ring,
            and stacking two full canvases in the mobile overlay is confusing.
            Desktop keeps both views so the two layers remain visible at once. */}
        {!isMobile && (
          <div style={{
            flexShrink: 0, height: 180, position: "relative", overflow: "hidden",
            borderTop: "1px solid rgba(212,175,55,0.12)",
          }}>
            <SystemMap
              projectId={projectId}
              compact
              detectedBuilder={platform.toLowerCase()}
              onNodesChange={handleArchNodesChange}
              initialNodeState={(activeProject?.nodeState as NodeStateMap | null) ?? null}
              resolvedNodeIds={resolvedNodeIds}
              onResolvedConsumed={onResolvedConsumed}
            />
          </div>
        )}
      </div>

      {/* Toggle bar — thin seam between map and intent capture */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px",
        background: "oklch(0.11 0.01 60)",
        borderTop: "1px solid rgba(212,175,55,0.08)",
        flexShrink: 0,
      }}>
        {/* Static label — tells the user what the panel below is */}
        <span style={{
          color: "rgba(212,175,55,0.35)", fontSize: 10,
          fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
          userSelect: "none",
        }}>
          {showChat ? "intent capture" : "map fullscreen"}
        </span>
        <button
          onClick={() => setShowChat(v => !v)}
          style={{
            background: "rgba(212,175,55,0.07)", border: "1px solid rgba(212,175,55,0.28)",
            borderRadius: 5, padding: "2px 9px", cursor: "pointer",
            color: "rgba(212,175,55,0.78)", fontSize: 9,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
          }}>
          {showChat ? "⛶ Map only" : "⊠ Show input"}
        </button>
      </div>

      {/* INTENT CAPTURE */}
      {showChat && (
        <div style={{ flex: 1, minHeight: 190, overflow: "hidden", display: "flex", flexDirection: "column", background: "oklch(0.11 0.01 60)" }}>
          <style>{`@keyframes intent-dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}`}</style>

          {/* Section label — compact, no button here (controls moved into card header) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px 4px", flexShrink: 0 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#D4AF37", animation: "intent-dot-pulse 2s ease-in-out infinite", flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.12em" }}>INTENT CAPTURE</span>
          </div>

          {/* Prompt card — full remaining height */}
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "0 14px 12px" }}>
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              background: "rgba(20,18,14,0.92)",
              border: "1px solid rgba(212,175,55,0.16)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {/* Card header — platform badge + signal selector + add button, all in one row */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 10px 6px",
                borderBottom: "1px solid rgba(212,175,55,0.07)",
                flexShrink: 0,
              }}>
                {/* Platform badge — translucent pill, color keyed to detected system */}
                {(() => {
                  const p = platform.toLowerCase();
                  const isReplit  = p === "replit";
                  const isCursor  = p === "cursor";
                  const isLovable = p === "lovable";
                  const color  = isReplit  ? "oklch(0.74 0.18 150)"
                               : isCursor  ? "oklch(0.74 0.18 240)"
                               : isLovable ? "oklch(0.74 0.20 300)"
                               : "rgba(212,175,55,0.78)";
                  const bg     = isReplit  ? "oklch(0.28 0.12 150 / 28%)"
                               : isCursor  ? "oklch(0.28 0.12 240 / 28%)"
                               : isLovable ? "oklch(0.28 0.12 300 / 28%)"
                               : "rgba(212,175,55,0.10)";
                  const border = isReplit  ? "oklch(0.55 0.18 150 / 50%)"
                               : isCursor  ? "oklch(0.55 0.18 240 / 50%)"
                               : isLovable ? "oklch(0.55 0.20 300 / 50%)"
                               : "rgba(212,175,55,0.30)";
                  return (
                    <span style={{
                      fontSize: 9, fontWeight: 700, color,
                      background: bg, border: `1px solid ${border}`,
                      borderRadius: 999, padding: "2px 9px",
                      letterSpacing: "0.10em", textTransform: "uppercase",
                      flexShrink: 0, fontFamily: "var(--app-font-mono)",
                    }}>
                      {platform}
                    </span>
                  );
                })()}
                {/* Signal selector — inline, takes remaining space */}
                <select
                  value={activeSignalIdx}
                  onChange={e => setActiveSignalIdx(Number(e.target.value))}
                  style={{
                    flex: 1, minWidth: 0, background: "transparent",
                    border: "1px solid rgba(212,175,55,0.13)",
                    borderRadius: 5, padding: "3px 6px",
                    color: "rgba(212,175,55,0.65)", fontSize: 9.5,
                    fontFamily: "var(--app-font-mono)", cursor: "pointer",
                  }}>
                  {signals.map((s, i) => (
                    <option key={i} value={i}>Signal #{i + 1}{s.trim() ? ` — ${s.trim().slice(0, 22)}${s.trim().length > 22 ? "…" : ""}` : ""}</option>
                  ))}
                </select>
                {/* Delete signal — only shown when multiple signals exist */}
                {signals.length > 1 && (
                  <button
                    onClick={deleteActiveSignal}
                    title="Delete this signal"
                    style={{
                      width: 20, height: 20, borderRadius: 4, flexShrink: 0,
                      background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
                      color: "rgba(239,68,68,0.6)", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, lineHeight: 1,
                    }}
                  >×</button>
                )}
                {/* Add signal */}
                <button
                  onClick={addSignal}
                  style={{
                    background: signalAdded ? "rgba(212,175,55,0.22)" : "rgba(212,175,55,0.09)",
                    border: `1px solid ${signalAdded ? "rgba(212,175,55,0.7)" : "rgba(212,175,55,0.3)"}`,
                    borderRadius: 6, padding: "3px 9px", cursor: "pointer", flexShrink: 0,
                    color: "#D4AF37", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
                    fontFamily: "var(--app-font-mono)", transition: "all 300ms",
                  }}>
                  {signalAdded ? "✓" : "+ Signal"}
                </button>
              </div>

              {/* Textarea — minHeight:0 ensures it shrinks on small viewports/keyboard-up */}
              <textarea
                value={intent}
                onChange={e => setIntent(e.target.value)}
                placeholder="Describe what you want to build or change — e.g. 'Add login with Google to my Express app using passport.js'"
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                style={{
                  flex: 1, minHeight: 0, overflowY: "auto",
                  background: "transparent", border: "none", outline: "none",
                  resize: "none", padding: "12px 14px",
                  color: "var(--atlas-fg)", fontSize: 13, lineHeight: 1.6,
                  fontFamily: "inherit",
                }}
              />

              {/* Card footer */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "7px 14px",
                borderTop: "1px solid rgba(212,175,55,0.05)",
                flexShrink: 0,
              }}>
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.45)", padding: 4 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.45)", padding: 4 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  </button>
                  <button
                    onClick={handleSend}
                    style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: sentFlash ? "rgba(212,175,55,0.28)" : intent.trim() ? "rgba(212,175,55,0.14)" : "transparent",
                      border: `1px solid ${sentFlash ? "rgba(212,175,55,0.7)" : intent.trim() ? "rgba(212,175,55,0.38)" : "rgba(120,113,108,0.22)"}`,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: sentFlash ? "#D4AF37" : intent.trim() ? "#D4AF37" : "rgba(120,113,108,0.32)",
                      transition: "all 200ms",
                      fontSize: sentFlash ? 13 : undefined,
                      fontWeight: sentFlash ? 700 : undefined,
                    }}
                  >
                    {sentFlash ? "✓" : (
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Prompt sheet */}
      {showQuickPrompt && (
        <TheForge
          platform={platform}
          readinessScore={readinessScore}
          activeProjectName={activeProjectName}
          projectId={projectId}
          onClose={() => setShowQuickPrompt(false)}
          onNodesReady={(nodes) => { setPendingNodes(nodes); setShowQuickPrompt(false); }}
        />
      )}

      <CockpitBar
        readinessScore={readinessScore}
        nodes={nodes}
        onHomeNav={onHomeNav}
        onAxiomOpen={() => setShowQuickPrompt(true)}
        navLeft={onBackToChat ? (
          <button
            onClick={onBackToChat}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "8px 14px", borderRadius: 10,
              background: "rgba(212,175,55,0.08)",
              border: "1px solid rgba(212,175,55,0.22)",
              color: "#D4AF37", fontSize: 11, fontWeight: 700,
              letterSpacing: "0.06em", cursor: "pointer",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Chat
          </button>
        ) : undefined}
        navRight={isMobile && onHandover ? (
          // On mobile the handover trigger lives here, in the cockpit bar footer,
          // rather than as a floating pill inside the canvas.
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button
              onClick={() => onHandoverOpenChange?.(true)}
              disabled={handoverPending}
              title="Send Flow snapshot to Atlas as a new chat"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 12px", borderRadius: 10,
                background: handoverPending
                  ? "rgba(120,113,108,0.1)"
                  : "rgba(146,64,14,0.22)",
                border: `1px solid ${handoverPending ? "rgba(120,113,108,0.35)" : "rgba(146,64,14,0.65)"}`,
                color: handoverPending ? "rgba(120,113,108,0.7)" : "rgba(230,150,90,0.95)",
                fontSize: 11, fontWeight: 700,
                letterSpacing: "0.06em",
                fontFamily: "var(--app-font-mono)",
                cursor: handoverPending ? "not-allowed" : "pointer",
                transition: "all 160ms ease",
              }}
            >
              {handoverPending ? "Sending…" : "→ Atlas"}
            </button>
          </div>
        ) : undefined}
      />
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
  onHomeNav,
  forceTab,
  onSendIntent,
  onBackToChat,
  isMobile,
  onMapReadinessChange,
  onSystemNodeMessage,
  onHandover,
  handoverPending,
  lastHandoverHash,
  resolvedNodeIds,
  onResolvedConsumed,
  currentSnapshot,
  onSnapshotChange,
  handoverOpen,
  onHandoverOpenChange,
  sandboxCode,
  onSandboxConsumed,
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
  onHomeNav: () => void;
  forceTab?: RightTab;
  onSendIntent?: (text: string) => void;
  onBackToChat?: () => void;
  isMobile?: boolean;
  onMapReadinessChange?: (score: number) => void;
  onSystemNodeMessage?: (text: string) => void;
  onHandover?: (payload: { snapshot: HandoverSnapshot; title: string }) => void;
  handoverPending?: boolean;
  lastHandoverHash?: string | null;
  resolvedNodeIds?: string[];
  onResolvedConsumed?: () => void;
  currentSnapshot?: HandoverSnapshot | null;
  onSnapshotChange?: (s: HandoverSnapshot | null) => void;
  handoverOpen?: boolean;
  onHandoverOpenChange?: (open: boolean) => void;
  sandboxCode?: string | null;
  onSandboxConsumed?: () => void;
}) {
  const [tab, setTab] = useState<RightTab>(() => {
    try {
      const stored = sessionStorage.getItem("atlas-open-tab");
      if (stored === "map") {
        sessionStorage.removeItem("atlas-open-tab");
        return "map";
      }
    } catch {}
    return "ledger";
  });

  useEffect(() => {
    if (forceTab) setTab(forceTab);
  }, [forceTab]);

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
      label: "Flow",
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
      }}
    >
      {/* Tab bar — desktop only; on mobile the MobileTabBar drives navigation */}
      <div
        style={{
          display: isMobile ? "none" : "flex", alignItems: "center",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
          paddingLeft: 4,
        }}
      >
        {!isMobile && tabs.filter(t => t.id !== "map").map((t) => {
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
        {/* Desktop: handover trigger button — pushed to the right of the tabs.
            Mirrors the mobile footer pill in AxiomFlow. Switches to the Map
            tab and opens the popover so the user can confirm/title the
            snapshot before sending it to Atlas. */}
        {!isMobile && onHandover && (
          <>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => {
                setTab("map");
                onHandoverOpenChange?.(true);
              }}
              disabled={!currentSnapshot || (currentSnapshot?.definedCount ?? 0) === 0 || !!handoverPending}
              title={
                handoverPending
                  ? "Handing over to Atlas…"
                  : !currentSnapshot || currentSnapshot.definedCount === 0
                    ? "Define at least one node to hand over"
                    : "Send the current Axiom Flow snapshot to Atlas as a new chat"
              }
              style={{
                marginRight: 8,
                padding: "5px 11px",
                borderRadius: 5,
                background: !currentSnapshot || currentSnapshot.definedCount === 0 || handoverPending
                  ? "rgba(120,113,108,0.15)"
                  : "rgba(146,64,14,0.22)",
                border: `1px solid ${
                  !currentSnapshot || currentSnapshot.definedCount === 0 || handoverPending
                    ? "rgba(120,113,108,0.35)"
                    : "rgba(146,64,14,0.65)"
                }`,
                color: !currentSnapshot || currentSnapshot.definedCount === 0 || handoverPending
                  ? "rgba(120,113,108,0.7)"
                  : "rgba(230,150,90,0.95)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: !currentSnapshot || currentSnapshot.definedCount === 0 || handoverPending
                  ? "not-allowed"
                  : "pointer",
                transition: "all 160ms ease",
              }}
            >
              {handoverPending ? "Sending…" : "→ Atlas"}
            </button>
          </>
        )}

        {/* Mobile: spacer so close/fullscreen stay right-aligned */}
        {isMobile && <div style={{ flex: 1 }} />}

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
      {tab === "preview" && <PreviewTab projectId={projectId} sandboxCode={sandboxCode} onSandboxConsumed={onSandboxConsumed} />}
      {tab === "memory" && <MemoryTab projectId={projectId} />}
      {tab === "map" && <SystemMapWithCockpit projectId={projectId} onHomeNav={onHomeNav} onSendIntent={onSendIntent} onBackToChat={onBackToChat} onMapReadinessChange={onMapReadinessChange} onSystemNodeMessage={onSystemNodeMessage} onHandover={onHandover} handoverPending={handoverPending} lastHandoverHash={lastHandoverHash} resolvedNodeIds={resolvedNodeIds} onResolvedConsumed={onResolvedConsumed} onSnapshotChange={onSnapshotChange} handoverOpen={handoverOpen} onHandoverOpenChange={onHandoverOpenChange} isMobile={isMobile} />}
    </div>
  );
}

// ── MobileTabBar ─────────────────────────────────────────────────────────────
function MobileTabBar({
  activeTab,
  onTabChange,
  entryCount,
  activeCatch,
}: {
  activeTab: "chat" | "ledger" | "files" | "map" | "preview";
  onTabChange: (tab: "chat" | "ledger" | "files" | "map" | "preview") => void;
  entryCount: number;
  activeCatch: boolean;
}) {
  const tabs: { id: "chat" | "ledger" | "files" | "map" | "preview"; label: string; icon: React.ReactNode; badge?: number; alert?: boolean }[] = [
    {
      id: "chat",
      label: "Chat",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: "ledger",
      label: "Ledger",
      badge: entryCount > 0 ? entryCount : undefined,
      alert: activeCatch,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
          <rect x="9" y="3" width="6" height="4" rx="1" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="13" y2="16" />
        </svg>
      ),
    },
    {
      id: "files",
      label: "Files",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ),
    },
    {
      id: "preview",
      label: "Preview",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="15" rx="2" />
          <path d="M2 8h20" />
          <circle cx="5" cy="5.5" r="0.9" fill="currentColor" opacity={0.5} />
          <circle cx="8" cy="5.5" r="0.9" fill="currentColor" opacity={0.5} />
          <path d="M8 22h8M12 18v4" />
        </svg>
      ),
    },
    {
      id: "map",
      label: "Flow",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="2" />
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="20" cy="4" r="1.5" />
          <circle cx="4" cy="20" r="1.5" />
          <circle cx="20" cy="20" r="1.5" />
          <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
          <line x1="18.5" y1="5.5" x2="13.5" y2="10.5" />
          <line x1="5.5" y1="18.5" x2="10.5" y2="13.5" />
          <line x1="18.5" y1="18.5" x2="13.5" y2="13.5" />
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height: 64,
        zIndex: 200,
        background: "rgba(12,10,9,0.96)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderTop: "1px solid rgba(212,175,55,0.12)",
        display: "flex",
        alignItems: "stretch",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {tabs.map(({ id, label, icon, badge, alert }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: active ? "var(--atlas-gold)" : "rgba(210,205,200,0.65)",
              transition: "color 180ms ease",
              position: "relative",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            {/* Active indicator bar at top */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "20%",
                right: "20%",
                height: 2,
                borderRadius: "0 0 2px 2px",
                background: active ? "var(--atlas-gold)" : "transparent",
                transition: "background 180ms ease",
              }}
            />
            {/* Badge / alert dot */}
            {(badge !== undefined || alert) && (
              <div
                style={{
                  position: "absolute",
                  top: 8,
                  right: "calc(50% - 14px)",
                  minWidth: 14,
                  height: 14,
                  borderRadius: 7,
                  background: alert ? "var(--atlas-ember)" : "rgba(201,162,76,0.8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 8,
                  fontFamily: "var(--app-font-mono)",
                  color: "#fff",
                  fontWeight: 700,
                  padding: "0 3px",
                  boxShadow: alert ? "0 0 8px rgba(146,64,14,0.6)" : "none",
                }}
              >
                {badge !== undefined ? (badge > 9 ? "9+" : String(badge)) : "!"}
              </div>
            )}
            {icon}
            <span
              style={{
                fontSize: 9,
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                lineHeight: 1,
              }}
            >
              {label}
            </span>
          </button>
        );
      })}
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
  useRequireAuth();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);
  const { playSend, playCatch, playCommit, playPark, playNavigate } = useSound();
  const [memoryChips, setMemoryChips] = useState<MemoryChip[]>([]);
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [leftTab, setLeftTab] = useState<"chat" | "diff">("chat");
  const [sessionPrUrl, setSessionPrUrl] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(() =>
    new URLSearchParams(window.location.search).get("view") === "flow"
  );
  const [showProfile, setShowProfile] = useState(false);
  const [chatWidthPct, setChatWidthPct] = useState(45);
  const resizeDrag = useRef({ active: false, startX: 0, startPct: 45 });
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = useCallback((clientX: number) => {
    resizeDrag.current = { active: true, startX: clientX, startPct: chatWidthPct };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [chatWidthPct]);

  const doResize = useCallback((clientX: number) => {
    if (!resizeDrag.current.active || !containerRef.current) return;
    const totalW = containerRef.current.offsetWidth;
    const delta = clientX - resizeDrag.current.startX;
    const newPct = Math.min(70, Math.max(25, resizeDrag.current.startPct + (delta / totalW) * 100));
    setChatWidthPct(newPct);
  }, []);

  const endResize = useCallback(() => {
    resizeDrag.current.active = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => doResize(e.clientX);
    const onTouchMove = (e: TouchEvent) => { if (resizeDrag.current.active) { e.preventDefault(); doResize(e.touches[0].clientX); } };
    const onUp = () => endResize();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [doResize, endResize]);

  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [wsModel, setWsModel] = useState<string>(() => {
    try { const r = localStorage.getItem("atlas-home-context"); return r ? (JSON.parse(r).model ?? "claude") : "claude"; } catch { return "claude"; }
  });
  const [showWsModelSheet, setShowWsModelSheet] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showSrcPicker, setShowSrcPicker] = useState(false);
  const [srcReadLoading, setSrcReadLoading] = useState(false);
  const [showDeepDiveMenu, setShowDeepDiveMenu] = useState(false);
  const [deepDiveCopied, setDeepDiveCopied] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const modeBtnRef = useRef<HTMLButtonElement>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  // Close portaled header dropdowns on scroll/resize so they don't float off their anchors.
  useEffect(() => {
    if (!showProjectMenu && !showModeMenu) return;
    const close = () => { setShowProjectMenu(false); setShowModeMenu(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [showProjectMenu, showModeMenu]);
  const [projectMode, setProjectMode] = useState<"THINK" | "PLAN" | "BUILD">(() => {
    try { return (localStorage.getItem(`atlas-mode-${id}`) as "THINK" | "PLAN" | "BUILD") || "THINK"; } catch { return "THINK"; }
  });
  const [mobileTab, setMobileTab] = useState<"chat" | "ledger" | "files" | "map" | "preview">(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : "chat"
  );
  const [showDrawer, setShowDrawer] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  const importSource = (() => {
    try { return new URLSearchParams(window.location.search).get("source") ?? null; } catch { return null; }
  })();
  const importSourceLabel = importSource === "compani" ? "Compani Blueprints" : importSource === "axiom" ? "Axiom" : importSource ? importSource.charAt(0).toUpperCase() + importSource.slice(1) : null;
  const [showAxiomBanner, setShowAxiomBanner] = useState(() => {
    try {
      const dismissed = localStorage.getItem(`atlas-axiom-banner-${id}`);
      if (dismissed) return false;
      return !!new URLSearchParams(window.location.search).get("source");
    } catch { return false; }
  });
  const dismissAxiomBanner = () => {
    try { localStorage.setItem(`atlas-axiom-banner-${id}`, "1"); } catch { /* ignore */ }
    setShowAxiomBanner(false);
  };

  // Spec → Build handoff modal state
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [handoffSelected, setHandoffSelected] = useState<Set<number>>(new Set());


  // Intercept mode switch to BUILD — if there are PLAN messages, show the handoff modal
  const handleModeSelect = (m: "THINK" | "PLAN" | "BUILD") => {
    if (m === "BUILD" && projectMode !== "BUILD") {
      const planMsgs = messages.filter(msg => msg.role === "assistant" && msg.intentType === "PLAN" && msg.content.trim().length > 0);
      if (planMsgs.length > 0) {
        // Pre-select all PLAN messages
        setHandoffSelected(new Set(planMsgs.map((_, i) => i)));
        setShowHandoffModal(true);
        setShowModeMenu(false);
        return;
      }
    }
    setProjectMode(m);
    try { localStorage.setItem(`atlas-mode-${id}`, m); } catch {}
    setShowModeMenu(false);
  };

  // Auto-set BUILD mode when arriving via external handoff (Axiom, Compani, etc.)
  useEffect(() => {
    try {
      const src = new URLSearchParams(window.location.search).get("source");
      if (src) {
        setProjectMode("BUILD");
        localStorage.setItem(`atlas-mode-${id}`, "BUILD");
      }
    } catch { /* ignore */ }
  }, [id]);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [cloningProject, setCloningProject] = useState(false);
  const updateProjectHeader = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();
  const createProjectMutation = useCreateProject();

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
  const [pendingPhraseIdx, setPendingPhraseIdx] = useState(0);
  const [linkedRepo, setLinkedRepo] = useState<LinkedRepo | null>(null);

  const PENDING_PHRASES = [
    "Loading context…",
    "Reviewing your decisions…",
    "Thinking…",
    "Composing a response…",
  ];

  useEffect(() => {
    if (!chatPending) { setPendingPhraseIdx(0); return; }
    const t = setInterval(() => setPendingPhraseIdx(i => (i + 1) % PENDING_PHRASES.length), 2400);
    return () => clearInterval(t);
  }, [chatPending]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialSent = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importPrimed = useRef(false);
  const touchStartX = useRef(0);

  const { data: allProjects } = useListProjects();
  const { data: project, isLoading: projectLoading } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });

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
  const historyMsgCountRef = useRef<number>(0);
  useEffect(() => {
    if (!priorMessages || priorMessages.length === 0 || priorLoaded.current || messages.length > 0) return;
    priorLoaded.current = true;
    historyMsgCountRef.current = priorMessages.length;
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

  // Load push history from DB on project load (FIX 2)
  const pushHistoryLoaded = useRef(false);
  useEffect(() => {
    if (pushHistoryLoaded.current) return;
    const hist = project?.pushHistory;
    if (!Array.isArray(hist) || hist.length === 0) return;
    pushHistoryLoaded.current = true;
    setPushHistory(hist as PushRecord[]);
  }, [project?.pushHistory]);

  // Auto-load key repo files into AI context on session start.
  // Fires once per project whenever a linked repo exists — regardless
  // of which tab the user has open.  The user never has to manually open files.
  const repoCtxLoadedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!project?.linkedRepo) return;
    if (repoCtxLoadedFor.current === id) return;

    // Token resolution: DB record → localStorage → server-side GITHUB_TOKEN
    const token =
      project?.githubToken ??
      (() => { try { return localStorage.getItem("atlas-github-token"); } catch { return null; } })() ??
      "__server__";

    let cancelled = false;
    const parsedRepo = (() => {
      try {
        const r = JSON.parse(project.linkedRepo);
        // Handle both plain-string "owner/repo" and JSON { fullName, defaultBranch } formats
        if (typeof r === "string") return { fullName: r, defaultBranch: "main" };
        return r as { fullName: string; defaultBranch: string };
      }
      catch { return null; }
    })();
    if (!parsedRepo) return;

    const branch = parsedRepo.defaultBranch ?? "main";

    // Priority-ordered key files — first ones win when we cap at 5
    const KEY_FILES = [
      "package.json",
      "README.md", "readme.md", "README.mdx",
      "tsconfig.json", "tsconfig.app.json",
      "vite.config.ts", "vite.config.js",
      "next.config.js", "next.config.ts", "next.config.mjs",
      // src/ layout (Vite, CRA)
      "src/main.tsx", "src/main.ts",
      "src/index.tsx", "src/index.ts",
      "src/App.tsx", "src/App.ts",
      "src/app.tsx", "src/app.ts",
      // app/ layout (Next.js, TanStack Start, Remix)
      "app/root.tsx", "app/root.ts",
      "app/routes/__root.tsx", "app/routes/__root.ts",
      "app/app.tsx", "app/app.ts",
      "app/layout.tsx", "app/layout.ts",
      "app/page.tsx", "app/page.ts",
      // pages/ layout
      "pages/_app.tsx", "pages/_app.js",
      "pages/index.tsx", "pages/index.js",
      // root fallbacks
      "index.ts", "index.tsx", "index.js",
      "main.ts", "main.tsx",
    ];

    (async () => {
      try {
        // 1. Fetch flat tree
        const treeRes = await fetch(
          `/api/github/tree?repo=${encodeURIComponent(parsedRepo.fullName)}&branch=${encodeURIComponent(branch)}`,
          { headers: { "x-github-token": token } }
        );
        if (!treeRes.ok || cancelled) return;
        const treeData = await treeRes.json() as { branch: string; tree: Array<{ path: string; type: string }> };
        const resolvedBranch = treeData.branch ?? branch;
        const allBlobs = treeData.tree.filter(i => i.type === "blob").map(i => i.path);
        const blobSet = new Set(allBlobs);

        // 2. Identify up to 5 priority files that actually exist
        const toFetch = KEY_FILES.filter(p => blobSet.has(p)).slice(0, 5);
        if (cancelled) return;

        // 3. Fetch priority files in parallel (may be empty — tree alone is still useful)
        const results = await Promise.allSettled(
          toFetch.map(p =>
            fetch(
              `/api/github/file?repo=${encodeURIComponent(parsedRepo.fullName)}&path=${encodeURIComponent(p)}&branch=${encodeURIComponent(resolvedBranch)}`,
              { headers: { "x-github-token": token } }
            ).then(r => r.ok ? r.json() as Promise<{ path: string; content: string; lines: number }> : null)
          )
        );

        if (cancelled) return;

        // 4. Build combined context: header + full file tree + file contents
        const treelisting = allBlobs.join("\n");
        const parts: string[] = [
          `Repo: ${parsedRepo.fullName} (branch: ${resolvedBranch})\n\nFull file tree:\n${treelisting}`,
        ];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          if (r.status === "fulfilled" && r.value) {
            const file = r.value;
            const lines = file.content.split("\n");
            const body = lines.length > 200
              ? lines.slice(0, 200).join("\n") + "\n// ... (truncated)"
              : file.content;
            parts.push(`File: ${file.path}\n\`\`\`\n${body}\n\`\`\``);
          }
        }

        if (!cancelled && parts.length > 0) {
          repoCtxLoadedFor.current = id;
          setFileContext(parts.join("\n\n"));
        }
      } catch {
        // Silent — never break the workspace if GitHub fetch fails
      }
    })();

    return () => { cancelled = true; };
  }, [id, project?.linkedRepo, project?.githubToken]);

  // Auto-run analyze scan at workspace level so Atlas knows the full codebase
  // structure the moment a project opens — no FILES tab visit required.
  // Skips if a fresh scan (< 24h) already exists in localStorage.
  useEffect(() => {
    if (!project?.linkedRepo) return;
    const parsedRepo = (() => {
      try {
        const r = JSON.parse(project.linkedRepo);
        if (typeof r === "string") return { fullName: r, defaultBranch: "main" };
        return r as { fullName: string; defaultBranch: string };
      } catch { return null; }
    })();
    if (!parsedRepo?.fullName) return;

    const scanKey = `atlas-scan-${id}`;
    try {
      const cached = localStorage.getItem(scanKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { scannedAt?: string };
        if (parsed.scannedAt) {
          const ageMs = Date.now() - new Date(parsed.scannedAt).getTime();
          if (ageMs < 24 * 60 * 60 * 1000) return; // fresh — skip
        }
      }
    } catch { /* no cache or parse error — proceed */ }

    const token =
      project?.githubToken ??
      (() => { try { return localStorage.getItem("atlas-github-token"); } catch { return null; } })() ??
      "__server__";

    fetch("/api/github/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-github-token": token },
      body: JSON.stringify({ repo: parsedRepo.fullName, branch: parsedRepo.defaultBranch ?? "main" }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
      })
      .catch(() => { /* silent — never break the workspace */ });
  }, [id, project?.linkedRepo, project?.githubToken]);

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

      // Read cached project scan from localStorage and send as compact map string
      let projectMap: string | undefined;
      try {
        const rawScan = localStorage.getItem(`atlas-scan-${id}`);
        if (rawScan) {
          const s = JSON.parse(rawScan) as ProjectScan;
          const lines = [
            `Repo: ${s.repo} (scanned ${s.scannedAt?.slice(0, 10) ?? "recently"})`,
            s.description ? `What it does: ${s.description}` : "",
            s.stack?.length ? `Stack: ${s.stack.join(", ")}` : "",
            s.routes?.length ? `Routes (${s.routes.length}): ${s.routes.slice(0, 15).join(", ")}` : "",
            s.pages?.length ? `Pages: ${s.pages.slice(0, 12).join(", ")}` : "",
            s.components?.length ? `Components: ${s.components.slice(0, 12).join(", ")}` : "",
            s.tables?.length ? `DB Tables: ${s.tables.join(", ")}` : "",
            `Auth: ${s.authEnabled ? "enabled" : "not found"}`,
            `Total files: ${s.totalFiles}`,
            s.summary ? `Summary: ${s.summary}` : "",
          ].filter(Boolean).join("\n");
          if (lines.trim()) projectMap = lines;
        }
      } catch { /* non-fatal */ }

      const body = {
        sessionId: sid,
        projectId: id,
        message: text,
        model: wsModel,
        mode: projectMode.toLowerCase(),
        history,
        entries: ledgerEntries,
        ...(activeCtx ? { fileContext: activeCtx } : {}),
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
        ...(projectMap ? { projectMap } : {}),
        ...(imageData ? { imageData } : {}),
      };

      const controller = new AbortController();
      abortControllerRef.current = controller;

      fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((res) => {
          const cp = res.catchPayload as CatchPayload | null;
          const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : [])) as FileEdit[];
          const rawChips = (res.memoryChips ?? []) as Array<string | MemoryChip>;
          const normalizedChips: MemoryChip[] = rawChips.map((c) =>
            typeof c === "string" ? { label: c } : c
          );
          const aff = (res.autoFetchedFiles ?? []) as string[];
          setMessages((prev) => [...prev, {
            id: res.messageId, role: "assistant",
            content: res.content, intentType: res.intentType, catchPayload: cp,
            sentAt: new Date().toISOString(),
            model: res.model ?? wsModel,
            isDeepDive: !!res.isDeepDive,
            ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
            ...(normalizedChips.length > 0 ? { memoryChips: normalizedChips } : {}),
            ...(res.imageB64 ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType } : {}),
            ...(aff.length > 0 ? { autoFetchedFiles: aff } : {}),
          }]);
          if (cp) { playCatch(); setActiveCatch(cp); }
          if (normalizedChips.length > 0) {
            setMemoryChips((prev) => {
              const merged = [...prev];
              for (const c of normalizedChips) {
                if (!merged.some((m) => m.label === c.label)) merged.push(c);
              }
              return merged.slice(-12);
            });
          }
          if (res.resolvedNodes && res.resolvedNodes.length > 0) {
            setPendingResolvedNodeIds((prev) => {
              const merged = [...prev];
              for (const id of res.resolvedNodes!) {
                if (!merged.includes(id)) merged.push(id);
              }
              return merged;
            });
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again.", sentAt: new Date().toISOString() }]);
        })
        .finally(() => { setChatPending(false); abortControllerRef.current = null; });
    },
    [entries, id, fileContext, projectMode]
  );

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

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

  // Auto-prime AI context when arriving via external import (Compani, Axiom, etc.)
  // Only fires once, only when no messages exist, only when project has memory
  useEffect(() => {
    if (!sessionId || importPrimed.current || initialSent.current) return;
    const src = (() => { try { return new URLSearchParams(window.location.search).get("source"); } catch { return null; } })();
    if (!src) return;
    if (messages.length > 0) { importPrimed.current = true; return; }
    if (!project?.memory) return;
    importPrimed.current = true;
    const sourceLabel = src === "compani" ? "Compani Blueprints" : src === "axiom" ? "Axiom" : src;
    setTimeout(() => {
      doSend(`I just imported this project from ${sourceLabel}. Please read the spec you have in your memory and give me a brief summary of the project — what it is, what's been decided, and what we're building.`, sessionId, []);
    }, 200);
  }, [sessionId, messages.length, project?.memory, doSend]);

  const sendFromIntentCapture = useCallback((text: string) => {
    if (!text.trim() || !sessionId || chatPending) return;
    doSend(text.trim(), sessionId, messages);
  }, [sessionId, chatPending, messages, doSend]);

  // Mirror an unanswered Intel Panel question into the chat as an assistant
  // message — does not call the AI, just appends to the visible thread.
  const lastNodeMirrorRef = useRef<string | null>(null);
  const pushSystemNodeMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (lastNodeMirrorRef.current === trimmed) return;
    lastNodeMirrorRef.current = trimmed;
    setMessages((prev) => [
      ...prev,
      {
        role: "assistant",
        content: trimmed,
        intentType: "node_question",
        sentAt: new Date().toISOString(),
      },
    ]);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatPending]);

  // Close mobile panel on mobile→desktop resize
  useEffect(() => {
    if (!isMobile) setRightOpen(false);
  }, [isMobile]);

  // Surface tab drives right panel on both mobile and desktop
  useEffect(() => {
    if (mobileTab === "chat") setRightOpen(false);
    else setRightOpen(true);
  }, [mobileTab]);

  // When panel closes (swipe), reset tab to chat
  useEffect(() => {
    if (!rightOpen && isMobile) setMobileTab("chat");
  }, [rightOpen, isMobile]);

  // Clean ?view=flow from URL after reading it on mount
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "flow") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Pinch-to-zoom-out → return to Master Map (satellite view)
  useEffect(() => {
    if (!isMobile) return;
    let startDist = 0;
    let fired = false;
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        startDist = Math.hypot(dx, dy);
        fired = false;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || startDist === 0 || fired) return;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (dist - startDist > 90) {
        fired = true;
        startDist = 0;
        try { navigator.vibrate?.([6, 40, 6]); } catch {}
        setLocation("/map");
      }
    };
    const onEnd = () => { startDist = 0; fired = false; };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [isMobile, setLocation]);

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || !sessionId || chatPending) return;
    playSend();
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
      playPark();
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
        { onSuccess: () => { playCommit(); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); } }
      );
    },
    [id, sessionId, createEntry, queryClient, playCommit]
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

  const dismissChip = useCallback((label: string) => {
    setMemoryChips((prev) => prev.filter((c) => c.label !== label));
  }, []);


  const hasInput = input.trim().length > 0;
  const entryCount = entries?.length ?? 0;
  const parkedCount = entries?.filter((e) => e.status === "parked").length ?? 0;
  const committedCount = entries?.filter((e) => e.status === "committed").length ?? 0;
  const healthPct = entryCount > 0 ? Math.round((committedCount / entryCount) * 100) : 0;
  const [mapReadiness, setMapReadiness] = useState(0);
  const [readinessMode, setReadinessMode] = useState<ReadinessMode>(() => {
    const stored = localStorage.getItem(READINESS_MODE_KEY);
    return (stored === "arch" || stored === "decisions" || stored === "blended") ? stored : "blended";
  });
  const handleReadinessModeChange = (m: ReadinessMode) => {
    setReadinessMode(m);
    localStorage.setItem(READINESS_MODE_KEY, m);
  };
  const blendedReadiness = computeBlendedScore(mapReadiness, healthPct);
  const [pendingResolvedNodeIds, setPendingResolvedNodeIds] = useState<string[]>([]);
  const [desktopForceTab, setDesktopForceTab] = useState<RightTab | undefined>(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : undefined
  );
  const [sandboxCode, setSandboxCode] = useState<string | null>(null);
  const handlePreviewCode = useCallback((code: string) => {
    setSandboxCode(code);
    if (isMobile) {
      setMobileTab("preview");
      setRightOpen(true);
    } else {
      setDesktopForceTab("preview");
      setTimeout(() => setDesktopForceTab(undefined), 120);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // ── Readiness Snapshots ───────────────────────────────────────────────────
  const { data: readinessSnapshots } = useListReadinessSnapshots(
    id ? Number(id) : 0,
    { query: { enabled: !!id, queryKey: getListReadinessSnapshotsQueryKey(id ? Number(id) : 0) } }
  );
  const recordSnapshot = useRecordReadinessSnapshot();
  const lastRecordedScoreRef = useRef<number | null>(null);

  useEffect(() => {
    if (!id || blendedReadiness === 0) return;
    const timer = setTimeout(() => {
      if (lastRecordedScoreRef.current === blendedReadiness) return;
      lastRecordedScoreRef.current = blendedReadiness;
      recordSnapshot.mutate({ id: Number(id), data: { score: blendedReadiness } });
    }, 2000);
    return () => clearTimeout(timer);
  }, [id, blendedReadiness]);

  const readinessTrend: ReadinessTrend | undefined = (() => {
    if (!readinessSnapshots || readinessSnapshots.length < 2) return undefined;
    const sorted = [...readinessSnapshots].sort(
      (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
    );
    const current = sorted[0];
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const baseline24h = sorted.find(s => new Date(s.recordedAt) <= oneDayAgo);
    const baseline7d = sorted.find(s => new Date(s.recordedAt) <= sevenDaysAgo);
    const baseline = baseline24h ?? baseline7d ?? sorted[sorted.length - 1];
    if (!baseline || baseline.id === current?.id) return undefined;
    const label = baseline24h ? "today" : baseline7d ? "this week" : "since start";
    return {
      delta: (current?.score ?? blendedReadiness) - baseline.score,
      label,
      history: sorted.map(s => ({ score: s.score, recordedAt: s.recordedAt })),
    };
  })();

  // ── Handover (Flow → Workspace) ──────────────────────────────────────────
  const updateProjectFromHandover = useUpdateProject();
  const [handoverPending, setHandoverPending] = useState(false);
  // Live snapshot streamed up from AxiomFlow — drives the workspace-header
  // drift pill and the desktop "→ Atlas" trigger button in RightPanel.
  const [currentSnapshot, setCurrentSnapshot] = useState<HandoverSnapshot | null>(null);
  // Controlled state for the handover popover so a desktop trigger in the
  // tab bar can open the same popover that lives inside AxiomFlow.
  const [handoverOpen, setHandoverOpen] = useState(false);
  // Reset handover-derived UI when the active project changes, otherwise the
  // header drift pill and tab-bar button can briefly reflect the previous
  // project's snapshot until AxiomFlow remounts and streams a fresh one.
  useEffect(() => {
    setCurrentSnapshot(null);
    setHandoverOpen(false);
  }, [id]);

  const handleHandover = useCallback(({ snapshot, title }: { snapshot: HandoverSnapshot; title: string }) => {
    if (!id || handoverPending) return;
    setHandoverPending(true);
    createSession.mutate(
      {
        projectId: id,
        data: {
          title: title || snapshot.title,
          mode: "think",
          seedMessage: snapshot.summary,
          seedIntentType: "handover_snapshot",
        },
      },
      {
        onSuccess: (newSession) => {
          // Switch active session and seed the visible thread with the same
          // assistant message we just persisted server-side.
          setSessionId(newSession.id);
          setMessages([{
            role: "assistant",
            content: snapshot.summary,
            intentType: "handover_snapshot",
            sentAt: new Date().toISOString(),
          }]);
          // Stamp the project with the handover marker + content hash so the
          // Workspace can later detect drift.
          updateProjectFromHandover.mutate(
            {
              id,
              data: {
                lastHandoverAt: new Date().toISOString(),
                lastHandoverHash: snapshot.hash,
              },
            },
            {
              onSettled: () => {
                queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
              },
            }
          );
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
          // Surface the chat thread so the user sees the seeded snapshot.
          if (isMobile) {
            setMobileTab("chat");
            setRightOpen(false);
          }
          // Close the popover on success regardless of which trigger opened it.
          setHandoverOpen(false);
        },
        onSettled: () => setHandoverPending(false),
      }
    );
  }, [id, handoverPending, createSession, updateProjectFromHandover, queryClient, isMobile]);

  const focusSystemMap = useCallback(() => {
    if (isMobile) {
      setMobileTab("map");
      setRightOpen(true);
    } else {
      setDesktopForceTab("map");
      setTimeout(() => setDesktopForceTab(undefined), 80);
    }
  }, [isMobile]);

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

  // ── Project not found ────────────────────────────────────────────────────
  if (!projectLoading && !sessionsLoading && id && !project) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--atlas-bg)", gap: 20 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.4, textTransform: "uppercase" }}>Axiom</div>
        <div style={{ fontSize: 20, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "0.04em" }}>Project not found.</div>
        <button
          onClick={() => setLocation("/home")}
          style={{ padding: "10px 24px", borderRadius: 9, cursor: "pointer", background: "linear-gradient(180deg, #D4AF37 0%, #B8942A 100%)", border: "1px solid rgba(212,175,55,0.4)", color: "#0C0A09", fontSize: 11, fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase" }}
        >
          Go home
        </button>
      </div>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (projectLoading || (sessionsLoading && !sessionId)) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--atlas-bg)", overflow: "hidden" }}>
        <style>{`
          @keyframes shimmer { 0% { background-position: -600px 0; } 100% { background-position: 600px 0; } }
          .ws-shimmer { background: linear-gradient(90deg, rgba(255,255,255,0.03) 25%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0.03) 75%); background-size: 600px 100%; animation: shimmer 1.6s infinite linear; border-radius: 6px; }
        `}</style>
        {/* Header skeleton */}
        <div style={{ height: 46, flexShrink: 0, borderBottom: "1px solid rgba(201,162,76,0.08)", display: "flex", alignItems: "center", padding: "0 16px", gap: 10 }}>
          <div className="ws-shimmer" style={{ width: 28, height: 28, borderRadius: 7 }} />
          <div className="ws-shimmer" style={{ width: 60, height: 14 }} />
          <div style={{ flex: 1 }} />
          <div className="ws-shimmer" style={{ width: 80, height: 14 }} />
          <div className="ws-shimmer" style={{ width: 28, height: 28, borderRadius: "50%" }} />
        </div>
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Chat area skeleton */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "24px 20px", gap: 18 }}>
            <div className="ws-shimmer" style={{ height: 14, width: "65%" }} />
            <div className="ws-shimmer" style={{ height: 14, width: "80%" }} />
            <div className="ws-shimmer" style={{ height: 14, width: "50%" }} />
            <div style={{ marginTop: 12 }}>
              <div className="ws-shimmer" style={{ height: 14, width: "72%", marginBottom: 10 }} />
              <div className="ws-shimmer" style={{ height: 14, width: "58%" }} />
            </div>
          </div>
          {/* Right panel skeleton (desktop only) */}
          {!isMobile && (
            <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid rgba(201,162,76,0.08)", background: "var(--atlas-surface-alt)", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="ws-shimmer" style={{ height: 12, width: "60%" }} />
              <div className="ws-shimmer" style={{ height: 56, borderRadius: 8 }} />
              <div className="ws-shimmer" style={{ height: 56, borderRadius: 8 }} />
              <div className="ws-shimmer" style={{ height: 56, borderRadius: 8 }} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--atlas-bg)", overflow: "hidden", zIndex: 0, paddingBottom: isMobile ? "calc(64px + env(safe-area-inset-bottom, 0px))" : 0 }}
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
      <div className="atlas-app-header" style={{ flexShrink: 0, backdropFilter: "blur(16px)" }}>
        {/* Row 1: logo | project name (centered) | mode + P + avatar */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 14px", borderBottom: "1px solid rgba(212,175,55,0.12)", boxShadow: "0 1px 28px rgba(0,0,0,0.45)" }}>

          {/* Left: drawer button + Atlas logo → home */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              title="Menu"
              onClick={() => setShowDrawer(true)}
              style={{ width: 28, height: 28, borderRadius: 7, background: "transparent", border: "none", color: "rgba(120,113,108,0.45)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "color 160ms ease", flexShrink: 0 }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-gold)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(120,113,108,0.45)")}
            >
              <div style={{ position: "relative", width: 17, height: 17 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                </svg>
                <span style={{
                  position: "absolute", bottom: -1, right: -1,
                  width: 5, height: 5, borderRadius: "50%",
                  background: projectMode === "BUILD" ? "#4ade80" : projectMode === "PLAN" ? "#D4AF37" : "#93c5fd",
                  border: "1px solid #0C0A09",
                }} />
              </div>
            </button>
            <button
              onClick={() => setLocation("/home")}
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 7, flexShrink: 0 }}
            >
              <AtlasLogo small />
            </button>
            {/* Exit to Nexus */}
          </div>

          {/* Center: project name + readiness ring + dropdown — hidden in mobile map mode */}
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: isMobile && mobileTab === "map" ? "none" : "flex", alignItems: "center", gap: 4, maxWidth: "min(280px, calc(100% - 260px))" }}>
            <button
              ref={projectBtnRef}
              onClick={() => setShowProjectMenu((v) => !v)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8, transition: "background 150ms ease", minWidth: 0, overflow: "hidden", width: "100%" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {renaming ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={renameInputRef}
                    autoFocus
                    value={renameDraft}
                    disabled={updateProjectHeader.isPending}
                    onChange={(e) => { setRenameDraft(e.target.value); setRenameError(null); }}
                    onKeyDown={(e) => {
                      if (updateProjectHeader.isPending) return;
                      if (e.key === "Enter") {
                        const newName = renameDraft.trim() || (project?.name ?? "");
                        updateProjectHeader.mutate({ id, data: { name: newName } }, {
                          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }); setRenaming(false); setRenameError(null); },
                          onError: (err) => { setRenameError((err as Error)?.message ?? "Failed to rename."); setTimeout(() => renameInputRef.current?.focus(), 0); },
                        });
                      }
                      if (e.key === "Escape") { setRenaming(false); setRenameError(null); }
                    }}
                    onBlur={() => { if (updateProjectHeader.isPending) return; setRenaming(false); setRenameError(null); }}
                    style={{ background: "transparent", border: "none", outline: "none", color: "var(--atlas-fg)", fontSize: 13, fontWeight: 500, fontFamily: "var(--app-font-sans)", width: 160, textAlign: "center", opacity: updateProjectHeader.isPending ? 0.5 : 1, transition: "opacity 150ms ease" }}
                  />
                  {renameError && (
                    <span style={{ fontSize: 10.5, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)", marginTop: 2, lineHeight: 1.3, pointerEvents: "none" }}>
                      {renameError}
                    </span>
                  )}
                </div>
              ) : (
                <>
                  {/* Title row: status dot + name */}
                  <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", width: "100%" }}>
                    <span className={sessionId ? "atlas-pulse-dot" : undefined} style={{ width: 6, height: 6, borderRadius: "50%", background: sessionId ? "#4ade80" : "rgba(120,113,108,0.4)", flexShrink: 0, display: "inline-block" }} />
                    <span style={{ fontSize: 13, color: "var(--atlas-fg)", opacity: 0.92, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                      {project?.name ?? "…"}
                    </span>
                  </span>
                  {/* Chevron on its own line, centered below */}
                  <svg width="10" height="6" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(120,113,108,0.45)", flexShrink: 0 }}>
                    <path d="M1 1l5 5 5-5" />
                  </svg>
                </>
              )}
            </button>

            {/* Readiness ring — blended arch + decisions score; clicks to open Map panel */}
            {/* Drift pill — flow has changed since the last Atlas handover.
                Lives next to the project name so it's visible from any tab,
                not just the Map tab. */}
            {!!project?.lastHandoverHash && !!currentSnapshot && currentSnapshot.hash !== project.lastHandoverHash && (
              <span
                title="Architecture flow has changed since last Atlas handover"
                onClick={focusSystemMap}
                style={{
                  marginLeft: 6,
                  padding: "2px 7px",
                  borderRadius: 4,
                  background: "rgba(146,64,14,0.18)",
                  border: "1px solid rgba(146,64,14,0.55)",
                  color: "rgba(230,150,90,0.95)",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 8.5,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Updated since handover
              </span>
            )}

            {/* Dropdown menu — portaled to escape any parent stacking context */}
            {showProjectMenu && createPortal(
              <>
                <div onClick={() => setShowProjectMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                <div
                  className="atlas-popover"
                  style={{
                    position: "fixed",
                    top: (projectBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 6,
                    left: (projectBtnRef.current?.getBoundingClientRect().left ?? 0) + (projectBtnRef.current?.offsetWidth ?? 0) / 2,
                    transform: "translateX(-50%)",
                    zIndex: 9999, minWidth: 220,
                  }}
                >
                  {/* Switch to existing project — shown when other projects exist */}
                  {(allProjects ?? []).filter(p => p.id !== id).length > 0 && (() => {
                    const others = (allProjects ?? []).filter(p => p.id !== id).slice(0, 7);
                    const isEmptyNew = messages.length === 0 && project?.name === "New Project";
                    return (
                      <>
                        <div style={{ padding: "6px 12px 2px", fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.45 }}>
                          Switch to
                        </div>
                        {others.map(p => (
                          <MenuBtn
                            key={p.id}
                            icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5" /><circle cx="8" cy="8" r="2.2" /></svg>}
                            label={p.name}
                            onClick={() => {
                              setShowProjectMenu(false);
                              if (isEmptyNew) {
                                deleteProjectMutation.mutate({ id }, {
                                  onSuccess: () => {
                                    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                                    setLocation(`/project/${p.id}`);
                                  },
                                  onError: () => setLocation(`/project/${p.id}`),
                                });
                              } else {
                                setLocation(`/project/${p.id}`);
                              }
                            }}
                          />
                        ))}
                        <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
                      </>
                    );
                  })()}
                  <div style={{ height: 1, background: "var(--atlas-border)", margin: "6px 6px 4px", opacity: 0.5 }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3l8-8z" /></svg>} label="Rename project" onClick={() => { setRenameDraft(project?.name ?? ""); setRenaming(true); setShowProjectMenu(false); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2" /><path d="M13.7 9.4a1 1 0 010-2.8l.5-.2a1 1 0 00.6-1.5l-.7-1.2a1 1 0 00-1.5-.3l-.4.3a1 1 0 01-1.4-.6l-.1-.5a1 1 0 00-1-.8H8.3a1 1 0 00-1 .8l-.1.5a1 1 0 01-1.4.6l-.4-.3a1 1 0 00-1.5.3l-.7 1.2a1 1 0 00.6 1.5l.5.2a1 1 0 010 2.8l-.5.2a1 1 0 00-.6 1.5l.7 1.2a1 1 0 001.5.3l.4-.3a1 1 0 011.4.6l.1.5a1 1 0 001 .8h1.4a1 1 0 001-.8l.1-.5a1 1 0 011.4-.6l.4.3a1 1 0 001.5-.3l.7-1.2a1 1 0 00-.6-1.5l-.5-.2z" /></svg>} label="Project settings" onClick={() => { setShowProjectMenu(false); setShowProjectSettings(true); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 6h6M5 9h4" /></svg>} label="Parking Lot" onClick={() => { setLocation(`/parking?project=${id}`); setShowProjectMenu(false); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="9" height="9" rx="1.5" /><path d="M11 4V3a1 1 0 00-1-1H4a1 1 0 00-1 1v6a1 1 0 001 1h1" /></svg>} label={cloningProject ? "Cloning…" : "Clone project"} onClick={async () => { if (cloningProject) return; setShowProjectMenu(false); setCloningProject(true); try { const base = import.meta.env.BASE_URL.replace(/\/$/, ""); const res = await fetch(`${base}/api/projects/${id}/clone`, { method: "POST" }); if (res.ok) { const clone = await res.json(); queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }); setLocation(`/project/${clone.id}`); } } finally { setCloningProject(false); } }} />
                  <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 4h12M2 8h8M2 12h6" /></svg>} label="View ledger" onClick={() => { setLocation(`/ledger/${id}`); setShowProjectMenu(false); }} />
                  <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="14" height="10" rx="1.5" /><path d="M1 6h14" /><circle cx="3.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} /><circle cx="5.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} /></svg>} label="Dashboard" onClick={() => { setLocation("/dashboard"); setShowProjectMenu(false); }} />
                  <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
                  {confirmDeleteProject ? (
                    <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontSize: 11.5, color: "rgba(252,165,165,0.9)", fontFamily: "var(--app-font-mono)" }}>Delete "{project?.name}"?</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => { setConfirmDeleteProject(false); }} style={{ flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 11, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
                        <button onClick={() => {
                          deleteProjectMutation.mutate({ id }, {
                            onSuccess: () => {
                              queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                              setShowProjectMenu(false);
                              setConfirmDeleteProject(false);
                              setLocation("/home");
                            },
                          });
                        }} style={{ flex: 1, padding: "5px 0", borderRadius: 5, fontSize: 11, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.35)", color: "rgba(252,165,165,0.9)", cursor: "pointer", fontWeight: 600 }}>
                          {deleteProjectMutation.isPending ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <MenuBtn
                      icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 4 13 12 13 13 6" /><path d="M1 6h14" /><path d="M6 6V4a1 1 0 011-1h2a1 1 0 011 1v2" /></svg>}
                      label="Delete project"
                      onClick={() => setConfirmDeleteProject(true)}
                    />
                  )}
                </div>
              </>,
              document.body
            )}
          </div>

          {/* Right: % score + mode + P + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <ReadinessRing
              archScore={mapReadiness}
              decisionsScore={healthPct}
              mode={readinessMode}
              onModeChange={handleReadinessModeChange}
              onClick={focusSystemMap}
              trend={readinessTrend}
            />

            {/* Readiness score pill — only shown in mobile map mode (replaces the ring hidden in center) */}
            {isMobile && mobileTab === "map" && (
              <button
                onClick={focusSystemMap}
                title={`Readiness ${blendedReadiness}%`}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)",
                  borderRadius: 7, padding: "4px 8px", cursor: "pointer",
                  transition: "background 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.15)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.08)"; }}
              >
                <span style={{
                  fontFamily: "var(--app-font-mono)", fontSize: 11, fontWeight: 700,
                  color: "var(--atlas-gold)", letterSpacing: "0.04em",
                }}>
                  {blendedReadiness}%
                </span>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: blendedReadiness > 0 ? "var(--atlas-gold)" : "rgba(120,113,108,0.4)",
                  flexShrink: 0, display: "inline-block",
                  boxShadow: blendedReadiness > 0 ? "0 0 5px rgba(201,162,76,0.6)" : "none",
                }} />
              </button>
            )}

            {/* Mode pill — hidden in mobile map mode */}
            {!(isMobile && mobileTab === "map") && (() => {
              const modeConfig = {
                THINK: { color: "#93c5fd", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.35)", desc: "Strategy & advice — no code",
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6M10 22h4M12 2a7 7 0 0 1 7 7c0 2.6-1.4 4.9-3.5 6.2V17a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-1.8C6.4 13.9 5 11.6 5 9a7 7 0 0 1 7-7z" /></svg> },
                PLAN:  { color: "var(--atlas-gold)", bg: "rgba(201,162,76,0.1)", border: "rgba(201,162,76,0.35)", desc: "Structure & outlines",
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
                BUILD: { color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.35)", desc: "Writes code → push to GitHub",
                  icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> },
              };
              const cfg = modeConfig[projectMode];
              return (
                <div style={{ position: "relative" }}>
                  <button
                    ref={modeBtnRef}
                    onClick={() => { setShowModeMenu(v => !v); setShowProjectMenu(false); setShowViewMenu(false); }}
                    title={`Mode: ${projectMode} — ${cfg.desc}`}
                    style={{ display: "flex", alignItems: "center", gap: 5, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 7, padding: "5px 8px", cursor: "pointer", color: cfg.color, flexShrink: 0, transition: "all 180ms ease" }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, flexShrink: 0, display: "inline-block" }} />
                    {cfg.icon}
                  </button>
                  {showModeMenu && createPortal(
                    <>
                      <div onClick={() => setShowModeMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
                      <div
                        className="atlas-popover"
                        style={{
                          position: "fixed",
                          top: (modeBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 6,
                          right: Math.max(8, window.innerWidth - (modeBtnRef.current?.getBoundingClientRect().right ?? 0)),
                          zIndex: 9999, minWidth: 210,
                        }}
                      >
                        <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-muted)", opacity: 0.7, padding: "4px 12px 6px" }}>Select mode</div>
                        {(["THINK", "PLAN", "BUILD"] as const).map((m) => {
                          const mc = modeConfig[m];
                          const active = projectMode === m;
                          return (
                            <button key={m}
                              onClick={() => handleModeSelect(m)}
                              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: active ? mc.bg : "transparent", border: "none", padding: "8px 12px", borderRadius: 7, cursor: "pointer", transition: "background 120ms" }}
                              onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                              onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                            >
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: mc.color, flexShrink: 0 }} />
                              <span style={{ flex: 1, textAlign: "left" }}>
                                <span style={{ display: "block", fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.08em", color: active ? mc.color : "var(--atlas-fg)" }}>{m}</span>
                                <span style={{ display: "block", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.75, marginTop: 1 }}>{mc.desc}</span>
                              </span>
                              {active && <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke={mc.color} strokeWidth="2.2" strokeLinecap="round"><path d="M3 8l4 4 6-7" /></svg>}
                            </button>
                          );
                        })}
                      </div>
                    </>,
                    document.body
                  )}
                </div>
              );
            })()}

            {/* Parking Lot removed from header — lives in the Projects Drawer (Navigate → Parking Lot) */}


            {/* Return to Orbit — fly back to Master Map */}
            <button
              title="Return to Satellite View — Master Map"
              onClick={() => { try { navigator.vibrate?.(8); } catch {} setLocation("/map"); }}
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 0 : 5,
                padding: isMobile ? "5px 8px" : "4px 10px", borderRadius: 7, flexShrink: 0,
                background: "rgba(201,162,76,0.06)", border: "1px solid rgba(201,162,76,0.18)",
                color: "rgba(201,162,76,0.6)", cursor: "pointer",
                fontSize: 9.5, fontFamily: "var(--app-font-mono)",
                fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase",
                backdropFilter: "blur(8px)", whiteSpace: "nowrap",
                transition: "all 130ms ease",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.14)"; e.currentTarget.style.color = "rgba(201,162,76,0.95)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.38)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(201,162,76,0.06)"; e.currentTarget.style.color = "rgba(201,162,76,0.6)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)"; }}
            >
              {isMobile ? (
                /* Globe icon — mobile only */
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <ellipse cx="12" cy="12" rx="4" ry="10" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="4.5" y1="6" x2="19.5" y2="6" />
                  <line x1="4.5" y1="18" x2="19.5" y2="18" />
                </svg>
              ) : (
                /* Arrow + text — desktop */
                <>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 11V3M4 6l4-4 4 4" />
                    <path d="M2 13h12" opacity={0.45} />
                  </svg>
                  Orbit
                </>
              )}
            </button>

            {/* Avatar only — New Project moved to Projects Drawer (+ next to Projects heading) */}
            <UserMenuDropdown onOpenProfile={() => setShowProfile(true)} />
          </div>
        </div>

      </div>

      {/* ── Spec → Build handoff modal ── */}
      {showHandoffModal && (() => {
        const planMsgs = messages.filter(msg => msg.role === "assistant" && msg.intentType === "PLAN" && msg.content.trim().length > 0);
        const commitSelected = async () => {
          const toCommit = planMsgs.filter((_, i) => handoffSelected.has(i));
          for (const msg of toCommit) {
            const summary = msg.content.replace(/#{1,3}\s*/g, "").split("\n").find(l => l.trim().length > 15)?.trim().slice(0, 120) ?? msg.content.slice(0, 120);
            await createEntry.mutateAsync({ projectId: id, data: { title: summary.slice(0, 80), summary, status: "committed", severity: "committed", mode: "plan", sessionId: sessionId ?? undefined } }).catch(() => {});
          }
          setShowHandoffModal(false);
          setProjectMode("BUILD");
          try { localStorage.setItem(`atlas-mode-${id}`, "BUILD"); } catch {}
        };
        const skipAndBuild = () => {
          setShowHandoffModal(false);
          setProjectMode("BUILD");
          try { localStorage.setItem(`atlas-mode-${id}`, "BUILD"); } catch {}
        };
        return createPortal(
          <>
            <div onClick={skipAndBuild} style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} />
            <div style={{
              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
              zIndex: 9991, width: "min(520px, calc(100vw - 32px))",
              background: "var(--atlas-surface)", border: "1px solid rgba(74,222,128,0.28)",
              borderRadius: 16, padding: "28px 28px 24px", boxShadow: "0 32px 80px rgba(0,0,0,0.7)",
            }}>
              {/* Header */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#4ade80" }}>Switching to Build Mode</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--atlas-fg)", margin: 0, lineHeight: 1.6, opacity: 0.85 }}>
                  You have {planMsgs.length} planning {planMsgs.length === 1 ? "response" : "responses"} from this session. Commit the key decisions to your ledger before you start building?
                </p>
              </div>

              {/* Decision list */}
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 6, marginBottom: 22, maxHeight: 280, overflowY: "auto" as const }}>
                {planMsgs.map((msg, i) => {
                  const preview = msg.content.replace(/#{1,3}\s*/g, "").split("\n").find(l => l.trim().length > 15)?.trim().slice(0, 100) ?? msg.content.slice(0, 100);
                  const selected = handoffSelected.has(i);
                  return (
                    <button
                      key={i}
                      onClick={() => setHandoffSelected(prev => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      })}
                      style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: "10px 12px", borderRadius: 9,
                        background: selected ? "rgba(74,222,128,0.07)" : "rgba(255,255,255,0.025)",
                        border: `1px solid ${selected ? "rgba(74,222,128,0.3)" : "rgba(120,113,108,0.15)"}`,
                        cursor: "pointer", textAlign: "left" as const, transition: "all 140ms ease",
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        border: `1.5px solid ${selected ? "#4ade80" : "rgba(120,113,108,0.4)"}`,
                        background: selected ? "#4ade80" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        transition: "all 140ms ease",
                      }}>
                        {selected && <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="#0C0A09" strokeWidth="2.2" strokeLinecap="round"><path d="M2 6l3 3 5-5" /></svg>}
                      </span>
                      <span style={{ fontSize: 12, color: selected ? "var(--atlas-fg)" : "var(--atlas-muted)", lineHeight: 1.55, transition: "color 140ms" }}>
                        {preview}{preview.length >= 100 ? "…" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={commitSelected}
                  disabled={handoffSelected.size === 0}
                  style={{
                    flex: 1, padding: "11px 16px", borderRadius: 9, cursor: handoffSelected.size === 0 ? "not-allowed" : "pointer",
                    background: handoffSelected.size === 0 ? "rgba(74,222,128,0.08)" : "rgba(74,222,128,0.14)",
                    border: `1px solid ${handoffSelected.size === 0 ? "rgba(74,222,128,0.12)" : "rgba(74,222,128,0.4)"}`,
                    color: handoffSelected.size === 0 ? "rgba(74,222,128,0.3)" : "#4ade80",
                    fontSize: 11, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const,
                    transition: "all 160ms ease",
                  }}
                >
                  Lock in {handoffSelected.size > 0 ? `${handoffSelected.size} ` : ""}& Start Building
                </button>
                <button
                  onClick={skipAndBuild}
                  style={{
                    padding: "11px 16px", borderRadius: 9, cursor: "pointer",
                    background: "transparent", border: "1px solid rgba(120,113,108,0.2)",
                    color: "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)",
                    fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const,
                    opacity: 0.7,
                  }}
                >
                  Skip
                </button>
              </div>
            </div>
          </>,
          document.body
        );
      })()}

      {/* ── Axiom handoff banner ── */}
      {showAxiomBanner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 18px",
            background: "rgba(201,162,76,0.07)",
            borderBottom: "1px solid rgba(201,162,76,0.18)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontSize: 12, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.03em" }}>
              Spec loaded from {importSourceLabel ?? "external source"} — your architecture decisions are committed.
            </span>
          </div>
          <button
            onClick={dismissAxiomBanner}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(201,162,76,0.5)", fontSize: 16, lineHeight: 1, padding: "2px 4px", flexShrink: 0 }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Two-pane body ── */}
      <div ref={containerRef} style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>

        {/* ZIP drag overlay */}
        <ZipDragOverlay visible={isDragOver} />

        {/* Left: Chat */}
        <div
          style={{
            width: isMobile ? "100%" : `${chatWidthPct}%`,
            minWidth: isMobile ? 0 : 300,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            background: "var(--atlas-bg)",
            overflow: "hidden",
          }}
        >
          {/* ── Chat / Diff tab strip ── */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, paddingLeft: 4, background: "rgba(0,0,0,0.15)" }}>
            {(["chat", "diff"] as const).map((tab) => {
              const active = leftTab === tab;
              const label = tab === "chat" ? "Chat" : "Diff";
              const badge = tab === "diff" && pushHistory.length > 0 ? pushHistory.length : undefined;
              return (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  style={{
                    padding: "8px 14px", background: "transparent", border: "none",
                    borderBottom: `2px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                    color: active ? "var(--atlas-fg)" : "var(--atlas-muted)",
                    fontSize: 12, fontFamily: "var(--app-font-sans)", fontWeight: active ? 500 : 400,
                    cursor: "pointer", transition: "color 160ms ease, border-color 160ms ease",
                    marginBottom: -1, display: "flex", alignItems: "center", gap: 6,
                    opacity: active ? 1 : 0.6,
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.opacity = "0.9"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.opacity = "0.6"; }}
                >
                  {label}
                  {badge !== undefined && (
                    <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", background: "rgba(201,162,76,0.15)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)", padding: "0 4px", borderRadius: 8, lineHeight: "15px" }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
            {/* View PR pill — appears after a PR is created */}
            {sessionPrUrl && (
              <div style={{ marginLeft: "auto", paddingRight: 10 }}>
                <a
                  href={sessionPrUrl} target="_blank" rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "3px 10px", borderRadius: 6,
                    background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.28)",
                    color: "rgba(74,222,128,0.9)", fontSize: 10.5, fontFamily: "var(--app-font-mono)",
                    textDecoration: "none", letterSpacing: "0.02em", whiteSpace: "nowrap",
                  }}
                >
                  {/* PR icon */}
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="4" cy="4" r="2"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="4" r="2"/>
                    <path d="M4 6v4M6 4h3a1 1 0 011 1v3"/>
                  </svg>
                  View PR
                </a>
              </div>
            )}
          </div>

          {/* ── Session Diff view (when leftTab === "diff") ── */}
          {leftTab === "diff" ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px" }} className="scrollbar-none">
              {pushHistory.length === 0 ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, paddingBottom: 40 }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.2" strokeLinecap="round" style={{ opacity: 0.25 }}>
                    <path d="M9 1H3a1 1 0 00-1 1v18a1 1 0 001 1h18a1 1 0 001-1V9L13 1z"/><path d="M13 1v8h8"/><path d="M8 13h8M8 17h5"/>
                  </svg>
                  <div style={{ fontSize: 12, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.65 }}>
                    No code changes this session yet.<br />
                    <span style={{ fontSize: 10.5 }}>Push files from a Build response to see diffs here.</span>
                  </div>
                </div>
              ) : (() => {
                const groups: PushRecord[][] = [];
                const seen = new Map<string, PushRecord[]>();
                for (const r of [...pushHistory].reverse()) {
                  const key = r.commitUrl || r.id;
                  if (!seen.has(key)) { seen.set(key, []); groups.push(seen.get(key)!); }
                  seen.get(key)!.push(r);
                }
                return groups.map((group) => (
                  <PushDiffCard
                    key={group[0].commitUrl || group[0].id}
                    records={group}
                    onRollbackAll={async () => { for (const r of group) await handleRollbackPush(r); }}
                  />
                ));
              })()}
            </div>
          ) : (
          /* ── Chat view ── */
          <div style={{ flex: 1, overflowY: "auto", padding: "28px 22px 12px", position: "relative" }} className="scrollbar-none atlas-chat-timeline">
            {messages.length === 0 && !chatPending && (
              <div style={{ padding: "52px 20px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <>
                    <div style={{ fontSize: 20, fontWeight: 300, color: "var(--atlas-muted)", marginBottom: 6, letterSpacing: "-0.01em", textAlign: "center" }}>
                      {project ? project.name : "Ready."}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(120,113,108,0.4)", marginBottom: 28, textAlign: "center" }}>
                      What are we working through today?
                    </div>
                  </>
                {/* Starter prompts */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 }}>
                  {[
                    { label: "I need to make a decision", sub: "Walk me through it and lock it in" },
                    { label: "I'm not sure which direction to take", sub: "Think out loud, I'll catch contradictions" },
                    { label: "Audit my recent decisions", sub: "Review what I've committed to" },
                    { label: "I want to map my architecture", sub: "System Map + layer-by-layer spec" },
                  ].map((p, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInput(p.label);
                        setTimeout(() => textareaRef.current?.focus(), 0);
                      }}
                      style={{
                        display: "flex", flexDirection: "column", alignItems: "flex-start",
                        padding: "11px 14px", borderRadius: 9, cursor: "pointer",
                        background: "rgba(201,162,76,0.03)",
                        border: "1px solid rgba(201,162,76,0.08)",
                        textAlign: "left", transition: "all 160ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.18)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.03)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.08)"; }}
                    >
                      <span style={{ fontSize: 12.5, color: "var(--atlas-fg)", opacity: 0.8, fontWeight: 500, lineHeight: 1.3 }}>{p.label}</span>
                      <span style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.5, marginTop: 2 }}>{p.sub}</span>
                    </button>
                  ))}
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
                  isNew={msg.role === "assistant" && i >= historyMsgCountRef.current}
                  projectId={id}
                  sessionId={sessionId || 0}
                  linkedRepo={linkedRepo}
                  onCatchProceed={() => handleCatchProceed(msg.id)}
                  onCatchAdjust={() => handleCatchAdjust(msg.id)}
                  onPark={handlePark}
                  onCommit={handleCommit}
                  onRegenerate={() => handleRegenerate(i)}
                  onPreviewCode={handlePreviewCode}
                  onPrCreated={(url) => { setSessionPrUrl(url); setLeftTab("diff"); }}
                  onPushSuccess={(records) => {
                    setPushHistory((prev) => {
                      const next = [...prev, ...records].slice(-20);
                      updateProjectHeader.mutate({ id, data: { pushHistory: next } });
                      return next;
                    });
                    const filenames = records.map((r) => r.filename).join(", ");
                    const branch = records[0]?.branch ?? "unknown";
                    const commitUrl = records[0]?.commitUrl ?? "";
                    createEntry.mutate(
                      {
                        projectId: id,
                        data: {
                          title: `Code pushed: ${filenames}`,
                          summary: `Branch: ${branch} · Files: ${filenames} · Commit: ${commitUrl}`,
                          status: "committed",
                          severity: "committed",
                          mode: "BUILD",
                          verb: "github_push",
                        },
                      },
                      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }) }
                    );
                  }}
                />
              )
            )}

            {messages.filter(m => m.role !== "user").length >= 60 && !chatPending && wsModel !== "gemini" && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8, margin: "4px 0 16px",
                padding: "8px 12px", borderRadius: 8,
                background: "rgba(66,133,244,0.06)", border: "1px solid rgba(66,133,244,0.2)",
              }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                  <circle cx="8" cy="8" r="6" stroke="rgba(66,133,244,0.7)" strokeWidth="1.3" />
                  <path d="M8 5v4M8 10.5v.5" stroke="rgba(66,133,244,0.7)" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "rgba(231,229,228,0.6)", letterSpacing: "0.04em", flex: 1 }}>
                  Long thread. Gemini handles more context without losing the top.
                </span>
                <button
                  onClick={() => { setWsModel("gemini"); }}
                  style={{
                    fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.08em",
                    padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                    background: "rgba(66,133,244,0.15)", border: "1px solid rgba(66,133,244,0.35)",
                    color: "#4285f4", whiteSpace: "nowrap",
                  }}
                >
                  Switch →
                </button>
              </div>
            )}

            {chatPending && (
              <div className="atlas-bubble-in" style={{ marginBottom: 24 }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.35, marginBottom: 8 }}>
                  Atlas
                </div>
                <LoadingSpinner size="sm" color="atlas" />
                <div style={{
                  marginTop: 10,
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  color: "var(--atlas-muted)",
                  letterSpacing: "0.07em",
                  opacity: 0.65,
                  transition: "opacity 400ms ease",
                  minHeight: "1em",
                }}>
                  {PENDING_PHRASES[pendingPhraseIdx]}
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>
          )} {/* end chat/diff ternary */}

          {/* Ledger status bar */}
          <div className="atlas-ledger-bar">
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: entryCount > 0 ? "var(--atlas-gold)" : "rgba(200,190,185,0.45)", flexShrink: 0, display: "inline-block", boxShadow: entryCount > 0 ? "0 0 6px rgba(201,162,76,0.45)" : "none", transition: "all 400ms ease" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: entryCount > 0 ? "rgba(212,175,55,0.82)" : "rgba(200,190,185,0.6)", transition: "color 400ms ease" }}>
              [{entryCount}] Ledger Entries
            </span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(200,190,185,0.5)" }}>·</span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: chatPending ? "rgba(74,222,128,0.75)" : "rgba(200,190,185,0.6)", transition: "color 300ms ease" }}>
              {chatPending ? "Generating" : "Session Active"}
            </span>
          </div>

          {/* Memory chips — what Atlas is tracking this session */}
          <MemoryChips
            chips={memoryChips}
            onDismiss={dismissChip}
            onPark={(c) => {
              handlePark(`${c.label}${c.insight ? `: ${c.insight}` : ""}`);
              dismissChip(c.label);
            }}
          />

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
                      opacity: 0.82, pointerEvents: "none",
                      fontFamily: "var(--app-font-sans)",
                    }}
                  >
                    {projectMode === "PLAN" ? "What should we structure…" : projectMode === "BUILD" ? "What needs to be built or fixed…" : "Say it plainly…"}
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

                  {/* Deep Dive button */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setShowDeepDiveMenu(v => !v)}
                      title="Deep Dive — send this conversation to ChatGPT, Perplexity or Gemini"
                      style={{
                        width: 30, height: 30, borderRadius: 7,
                        background: showDeepDiveMenu ? "rgba(201,162,76,0.1)" : "transparent",
                        border: showDeepDiveMenu ? "1px solid rgba(201,162,76,0.25)" : "1px solid transparent",
                        color: showDeepDiveMenu ? "var(--atlas-gold)" : "var(--atlas-muted)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: showDeepDiveMenu ? 1 : 0.4, transition: "all 160ms ease", flexShrink: 0,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={e => { if (!showDeepDiveMenu) e.currentTarget.style.opacity = "0.4"; }}
                    >
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="8" cy="6" r="4" />
                        <path d="M8 10v5M5 13h6" />
                        <path d="M5.5 4.5L3 2M10.5 4.5L13 2" />
                      </svg>
                    </button>
                    {showDeepDiveMenu && (
                      <>
                      <div onClick={() => setShowDeepDiveMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 59 }} />
                      <div
                        className="atlas-popover"
                        style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 60, minWidth: 210 }}
                      >
                        <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(201,162,76,0.5)", padding: "4px 10px 6px", borderBottom: "1px solid rgba(201,162,76,0.08)", marginBottom: 4 }}>
                          Deep Dive
                        </div>
                        {([
                          { id: "chatgpt",    label: "ChatGPT",    sub: "Context auto-fills" },
                          { id: "perplexity", label: "Perplexity", sub: "Context auto-fills" },
                          { id: "gemini",     label: "Gemini",     sub: deepDiveCopied ? "Copied — paste when it opens" : "Copies context, paste once" },
                        ] as const).map(p => (
                          <button
                            key={p.id}
                            onClick={() => {
                              const recentMsgs = messages.slice(-5).map(m => `${m.role === "user" ? "Me" : "Atlas"}: ${m.content}`).join("\n\n");
                              const current = input.trim();
                              const ctx = [current ? `My question: ${current}` : "", recentMsgs].filter(Boolean).join("\n\n---\n\n").slice(0, 2000);
                              const encoded = encodeURIComponent(ctx);
                              setShowDeepDiveMenu(false);
                              if (p.id === "chatgpt") {
                                window.open(`https://chatgpt.com/?q=${encoded}`, "_blank");
                              } else if (p.id === "perplexity") {
                                window.open(`https://www.perplexity.ai/search?q=${encoded}`, "_blank");
                              } else {
                                navigator.clipboard.writeText(ctx).catch(() => {});
                                setDeepDiveCopied(true);
                                setTimeout(() => setDeepDiveCopied(false), 3000);
                                toast("Opening Gemini", {
                                  description: "Your context is copied — just paste it when you arrive.",
                                  duration: 4000,
                                });
                                setTimeout(() => window.open("https://gemini.google.com", "_blank"), 600);
                              }
                            }}
                            style={{
                              display: "block", width: "100%", textAlign: "left",
                              background: "transparent", border: "none",
                              padding: "7px 10px", borderRadius: 5, cursor: "pointer",
                              transition: "background 120ms ease",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "rgba(201,162,76,0.07)")}
                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                          >
                            <div style={{ fontSize: 12, color: "var(--atlas-fg)", fontWeight: 500 }}>{p.label}</div>
                            <div style={{ fontSize: 10, color: "var(--atlas-muted)", marginTop: 1, fontFamily: "var(--app-font-mono)" }}>{p.sub}</div>
                          </button>
                        ))}
                      </div>
                      </>
                    )}
                  </div>

                  {/* Source picker dropdown */}
                  {showSrcPicker && (
                    <div
                      className="atlas-popover"
                      style={{
                        position: "absolute", bottom: "calc(100% + 8px)", left: 0,
                        borderColor: "rgba(56,189,248,0.2)",
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
                          <div style={{ fontSize: 11.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-fg)", fontWeight: 500 }}>{f.label}</div>
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
                  {isMobile ? "type / for shortcuts" : "Enter · Shift+Enter for newline"}
                </span>

                {/* Right: model chip + mic + send */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Model selector — tappable chip, reserved slot for future model switching */}
                  <button
                    onClick={() => setShowWsModelSheet(true)}
                    title="Switch model"
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "4px 8px", borderRadius: 20,
                      background: "rgba(28,25,23,0.6)",
                      border: "1px solid rgba(37,34,32,0.9)",
                      cursor: "pointer", transition: "all 160ms ease", flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.32)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(28,25,23,0.6)"; e.currentTarget.style.borderColor = "rgba(37,34,32,0.9)"; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="rgba(120,113,108,0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M5.5 8.5L7 10l3-4" />
                    </svg>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "rgba(231,229,228,0.55)", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
                      {wsModel === "claude" ? "Claude" : wsModel === "gpt4o" ? "GPT-4o" : wsModel === "gemini" ? "Gemini" : wsModel}
                    </span>
                    <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ opacity: 0.35, flexShrink: 0 }}>
                      <path d="M1.5 3L4 5.5L6.5 3" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {voiceSupported && (
                    <button
                      onClick={toggleVoice}
                      title={voiceListening ? "Stop listening" : "Voice input"}
                      className={voiceListening ? "atlas-voice-active" : ""}
                      style={{
                        width: 32, height: 32, borderRadius: 8,
                        background: voiceListening ? "var(--atlas-ember)" : "var(--atlas-surface)",
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
                  {chatPending ? (
                    <button
                      onClick={handleStop}
                      title="Stop generating"
                      style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: "var(--atlas-surface)",
                        border: "1px solid rgba(146,64,14,0.55)",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, transition: "all 150ms ease",
                      }}
                    >
                      <svg viewBox="0 0 20 20" width={12} height={12} fill="var(--atlas-ember)">
                        <rect x="4" y="4" width="12" height="12" rx="2.5" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      className="atlas-send-btn"
                      onClick={handleSend}
                      disabled={!hasInput || !sessionId}
                      style={{
                        width: 38, height: 38,
                        background: hasInput && sessionId ? "var(--atlas-ember)" : "var(--atlas-surface)",
                        border: hasInput ? "none" : "1px solid var(--atlas-border)",
                        boxShadow: hasInput ? "0 0 16px -3px rgba(146,64,14,0.5)" : "none",
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
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Desktop: resize handle + right panel */}
        {!isMobile && (
          <>
            <div
              onMouseDown={(e) => { e.preventDefault(); startResize(e.clientX); }}
              onTouchStart={(e) => { startResize(e.touches[0].clientX); }}
              onDoubleClick={() => setChatWidthPct(45)}
              title="Drag to resize · Double-tap to reset"
              style={{
                width: 16, flexShrink: 0, cursor: "col-resize",
                background: "transparent",
                zIndex: 10,
                touchAction: "none",
                display: "flex",
                alignItems: "stretch",
                justifyContent: "center",
              }}
            >
              <div className="atlas-resize-thread" style={{
                width: 1,
                background: "var(--atlas-border)",
                transition: "background 200ms",
                pointerEvents: "none",
              }} />
            </div>
            <div style={{ flex: 1, minWidth: 240, overflow: "hidden" }}>
              <RightPanel
                projectId={id}
                entries={entries || []}
                activeCatch={activeCatch}
                onFileContext={setFileContext}
                onLinkedRepoChange={setLinkedRepo}
                pushHistory={pushHistory}
                onRollbackPush={handleRollbackPush}
                onHomeNav={() => setLocation("/home")}
                forceTab={isMobile && mobileTab === "map" ? "map" : isMobile && mobileTab === "files" ? "files" : desktopForceTab}
                onSendIntent={sendFromIntentCapture}
                onMapReadinessChange={setMapReadiness}
                onSystemNodeMessage={pushSystemNodeMessage}
                onHandover={handleHandover}
                handoverPending={handoverPending}
                lastHandoverHash={project?.lastHandoverHash ?? null}
                isMobile={false}
                resolvedNodeIds={pendingResolvedNodeIds}
                onResolvedConsumed={() => setPendingResolvedNodeIds([])}
                currentSnapshot={currentSnapshot}
                onSnapshotChange={setCurrentSnapshot}
                handoverOpen={handoverOpen}
                onHandoverOpenChange={setHandoverOpen}
                sandboxCode={sandboxCode}
                onSandboxConsumed={() => setSandboxCode(null)}
              />
            </div>
          </>
        )}

        {/* Mobile: overlay panel */}
        {isMobile && rightOpen && (
          <div
            style={{ position: "fixed", top: 46, left: 0, right: 0, bottom: mobileTab === "map" ? 0 : 64, zIndex: 50, display: "flex", justifyContent: "flex-end" }}
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
              className="atlas-slide-in-right"
              style={{
                position: "relative", zIndex: 1,
                width: "100vw",
                maxWidth: "none",
                height: "100%",
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
                onHomeNav={() => setLocation("/home")}
                forceTab={mobileTab === "map" ? "map" : mobileTab === "files" ? "files" : mobileTab === "preview" ? "preview" : undefined}
                onSendIntent={sendFromIntentCapture}
                onBackToChat={mobileTab === "map" ? () => { setMobileTab("chat"); setRightOpen(false); } : undefined}
                onMapReadinessChange={setMapReadiness}
                onSystemNodeMessage={pushSystemNodeMessage}
                onHandover={handleHandover}
                handoverPending={handoverPending}
                lastHandoverHash={project?.lastHandoverHash ?? null}
                isMobile
                resolvedNodeIds={pendingResolvedNodeIds}
                onResolvedConsumed={() => setPendingResolvedNodeIds([])}
                currentSnapshot={currentSnapshot}
                onSnapshotChange={setCurrentSnapshot}
                handoverOpen={handoverOpen}
                onHandoverOpenChange={setHandoverOpen}
                sandboxCode={sandboxCode}
                onSandboxConsumed={() => setSandboxCode(null)}
              />
            </div>
          </div>
        )}
      </div>

      {isMobile && mobileTab !== "map" && (
        <MobileTabBar
          activeTab={mobileTab}
          onTabChange={(tab) => setMobileTab(tab)}
          entryCount={entryCount}
          activeCatch={!!activeCatch}
        />
      )}

      {/* Terms · Privacy fixed link */}
      {!isMobile && (
        <div style={{ position: "fixed", bottom: 10, left: 12, display: "flex", gap: 12, zIndex: 10, pointerEvents: "none" }}>
          {[["Terms", "/terms"], ["Privacy", "/privacy"]].map(([label, href]) => (
            <a key={label} href={href} style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.25, letterSpacing: "0.08em", textDecoration: "none", pointerEvents: "auto" }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.5")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.25")}
            >{label}</a>
          ))}
        </div>
      )}

      {/* User Profile Panel */}
      {showProfile && <AccountHubPanel onClose={() => setShowProfile(false)} isMobile={isMobile} />}

      {/* Project Settings Panel */}
      {showProjectSettings && project && (
        <ProjectSettingsPanel
          project={project}
          onClose={() => setShowProjectSettings(false)}
          onSaved={() => { queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }); }}
        />
      )}

      {/* Projects Drawer */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={(allProjects ?? []).map((p: any) => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null }))}
        activeProjectId={id}
        onOpenProject={(projectId) => { setLocation(`/project/${projectId}`); setShowDrawer(false); }}
        onNewProject={() => {
          setShowDrawer(false);
          createProjectMutation.mutate({ data: { name: "New Project" } }, {
            onSuccess: (p) => {
              queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
              setLocation(`/project/${p.id}`);
            },
          });
        }}
        onOpenLedger={(projectId) => { setLocation(`/ledger/${projectId}`); setShowDrawer(false); }}
        onOpenParking={() => { setLocation(`/parking?project=${id}`); setShowDrawer(false); }}
        userLabel={loadProfile().name || null}
      />


      {/* ── Workspace model picker sheet ── */}
      {showWsModelSheet && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={() => setShowWsModelSheet(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
          <div style={{
            position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
            background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
            borderTop: "1px solid rgba(201,162,76,0.18)",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)", paddingBottom: 32,
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.12)", margin: "12px auto 4px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Model</span>
              <button onClick={() => setShowWsModelSheet(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(120,113,108,0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div style={{ padding: "0 14px" }}>
              {([
                { id: "claude",      label: "Claude",      sub: "Architect · Nuance & Strategy",    available: true,  icon: "C" },
                { id: "gpt4o",       label: "GPT-4o",      sub: "Mechanic · Speed & Logic",         available: true,  icon: "G" },
                { id: "gemini",      label: "Gemini",       sub: "Strategy · Long Context",          available: true,  icon: "Ge" },
                { id: "perplexity",  label: "Perplexity",  sub: "Librarian · Live Research",        available: false, icon: "P" },
                { id: "deepseek",    label: "DeepSeek",    sub: "Analyst · Deep Reasoning",         available: false, icon: "D" },
              ]).map(m => (
                <button
                  key={m.id}
                  disabled={!m.available}
                  onClick={() => { if (m.available) { setWsModel(m.id); setShowWsModelSheet(false); } }}
                  style={{
                    width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 8,
                    background: wsModel === m.id ? "rgba(201,162,76,0.06)" : "transparent",
                    border: `1px solid ${wsModel === m.id ? "rgba(201,162,76,0.22)" : "transparent"}`,
                    cursor: m.available ? "pointer" : "default",
                    display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                    opacity: m.available ? 1 : 0.32, transition: "all 140ms ease",
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: m.available ? "rgba(201,162,76,0.1)" : "rgba(37,34,32,0.8)",
                    border: `1px solid ${m.available ? "rgba(201,162,76,0.25)" : "rgba(37,34,32,0.9)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700,
                    color: m.available ? "rgba(201,162,76,0.85)" : "rgba(120,113,108,0.4)",
                    letterSpacing: "0.02em",
                  }}>
                    {m.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", display: "flex", alignItems: "center", gap: 6 }}>
                      {m.label}
                      {!m.available && (
                        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.55, border: "1px solid rgba(120,113,108,0.2)", borderRadius: 3, padding: "1px 4px" }}>KEY NEEDED</span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.05em", marginTop: 2, opacity: m.available ? 0.7 : 0.4 }}>{m.sub}</div>
                  </div>
                  {wsModel === m.id && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
              <div style={{ margin: "12px 0 4px", padding: "8px 12px", background: "rgba(201,162,76,0.04)", borderRadius: 6, border: "1px solid rgba(201,162,76,0.1)" }}>
                <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.07em", margin: 0, lineHeight: 1.6 }}>
                  TIP: Type <span style={{ color: "rgba(201,162,76,0.7)" }}>/deep [topic]</span> in any message to run a structured research analysis via Gemini — regardless of selected model.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
}
