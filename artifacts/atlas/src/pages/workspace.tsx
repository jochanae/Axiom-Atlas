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
import { GlossaryTip } from "../components/GlossaryTip";
import { VisualVault } from "../components/VisualVault";
import { CockpitBar } from "../components/CockpitBar";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import { AccountHubPanel } from "../components/AccountHubPanel";
import { LoadingSpinner } from "../components/ui/loading-spinner";
import { StatusGlyph } from "../components/StatusGlyph";
import { CapsuleTag } from "../components/CapsuleTag";
import { ZipDragOverlay, ZipPanel, assembleContext } from "../components/ZipImport";
import { ProjectSettingsPanel } from "../components/ProjectSettingsPanel";
import { CommitCard } from "../components/CommitCard";
import { PlanCard } from "../components/PlanCard";
import { LiveGenerationCard } from "../components/LiveGenerationCard";
import { WorkbenchPanel } from "../components/Workbench/WorkbenchPanel";
import TerminalPanel from "../components/TerminalPanel";
import { Eye, TerminalSquare } from "lucide-react";
import { useThemeMode } from "@/lib/theme";
import { fileToBase64Safe } from "@/lib/image-resize";
import { detectDecisionMoment } from "@/lib/DecisionCatchEngine";
import { reportError } from "../lib/errorReporter";
import type { CommitCardPayload } from "@/lib/DecisionCatchEngine";
import type { Plan, PlanExecution } from "../lib/plan";
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
const ICON_TOUCH_TARGET_STYLE: React.CSSProperties = { minWidth: 44, minHeight: 44, padding: 9 };

interface CatchPayload {
  v: number;
  against: { id: string; title: string };
  leadSentence: string;
}

interface AlertPayload {
  type: string;
  headline: string;
  detail: string;
  action: string;
}

interface FileEdit {
  path: string;
  language: string;
  content: string;
}

type HomeHandoffNode = {
  id?: string;
  label: string;
  type: string;
  details?: string;
  meta?: string;
  moscow?: string;
};

type HomeHandoffMeta = {
  parkedCount: number;
  flowNodeCount: number;
  goalLabel: string;
  nodes?: HomeHandoffNode[];
  parkedTitles?: string[];
};

interface LinePatch {
  path: string;
  find: string;
  replace: string;
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
  plan?: Plan;
  planFromHome?: boolean;
  catchPayload?: CatchPayload | null;
  catchResolved?: boolean;
  fileEdit?: FileEdit;
  fileEdits?: FileEdit[];
  linePatches?: LinePatch[];
  memoryChips?: MemoryChip[];
  sentAt?: string;
  imageB64?: string;
  imageMimeType?: string;
  autoFetchedFiles?: string[];
  model?: string;
  isDeepDive?: boolean;
  autoPushed?: boolean;
  alertPayload?: AlertPayload | null;
  alertResolved?: boolean;
}

type MemoryChip = { label: string; insight?: string };

interface LinkedRepo {
  fullName: string;
  defaultBranch: string;
  name: string;
}

type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal" | "workbench";
type OnboardingCoachId = "chat" | "ledger" | "flow";
type WorkspaceLens = "flow" | "build" | "look" | "scenario";
type PlanState = "pending" | "reviewing" | "executing" | "completed" | "skipped";
type LiveGenerationMode = "plan" | "blueprint" | "edit" | "thinking";

type ForgeState = { forged: boolean; dismissed: boolean };

const FLOW_NODE_TYPES = new Set<ArchNode["type"]>(["goal", "requirement", "blocker", "priority", "decision", "sprint", "wont"]);
const FLOW_NODE_META = new Set(["must", "should", "could", "wont"]);
const SYSTEM_NODE_IDS = new Set(["auth", "db", "api", "state", "ui", "logic"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asFlowNodeType(value: unknown): ArchNode["type"] | null {
  return typeof value === "string" && FLOW_NODE_TYPES.has(value as ArchNode["type"])
    ? value as ArchNode["type"]
    : null;
}

function asFlowMeta(value: unknown): ArchNode["meta"] | undefined {
  return typeof value === "string" && FLOW_NODE_META.has(value)
    ? value as ArchNode["meta"]
    : undefined;
}

function flowNodeFallbackPosition(index: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / 8 - Math.PI / 2;
  return {
    x: Math.round(300 + 160 * Math.cos(angle)),
    y: Math.round(250 + 160 * Math.sin(angle)),
  };
}

function extractPersistedFlowNodes(nodeState: unknown): ArchNode[] {
  if (!isRecord(nodeState)) return [];
  return Object.entries(nodeState).flatMap(([id, raw], index): ArchNode[] => {
    if (SYSTEM_NODE_IDS.has(id) || !isRecord(raw)) return [];
    const label = typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : "";
    const type = asFlowNodeType(raw.type);
    if (!label || !type) return [];
    const fallback = flowNodeFallbackPosition(index);
    const strategicAnswer = typeof raw.strategicAnswer === "string" && raw.strategicAnswer.trim()
      ? raw.strategicAnswer.trim()
      : undefined;
    return [{
      id,
      label,
      type,
      resolved: Boolean(strategicAnswer) || raw.resolved === true,
      x: typeof raw.x === "number" ? raw.x : fallback.x,
      y: typeof raw.y === "number" ? raw.y : fallback.y,
      details: typeof raw.details === "string" && raw.details.trim() ? raw.details.trim() : undefined,
      meta: asFlowMeta(raw.meta),
      moscow: asFlowMeta(raw.moscow),
      question: typeof raw.question === "string" && raw.question.trim() ? raw.question.trim() : undefined,
      strategicAnswer,
    }];
  });
}

const LENS_CONFIG: Record<WorkspaceLens, {
  label: string;
  sub: string;
  color: string;
  borderColor: string;
  glowColor: string;
  bgTint: string;
  model: string;
}> = {
  flow:     { label: "Flow",     sub: "Think it through",            color: "#C9A24C", borderColor: "rgba(201,162,76,0.45)",  glowColor: "rgba(201,162,76,0.10)", bgTint: "transparent",                   model: "claude" },
  build:    { label: "Build",    sub: "Write code · push to GitHub", color: "#C4521A", borderColor: "rgba(196,82,26,0.45)",   glowColor: "rgba(196,82,26,0.10)",  bgTint: "transparent",                   model: "claude" },
  look:     { label: "Look",     sub: "CSS · animation · visual",    color: "#8B5CF6", borderColor: "rgba(139,92,246,0.40)",  glowColor: "rgba(139,92,246,0.10)", bgTint: "transparent",                   model: "gemini" },
  scenario: { label: "Scenario", sub: "What if — no commitment",     color: "#78716C", borderColor: "rgba(120,113,108,0.35)", glowColor: "rgba(120,113,108,0.06)", bgTint: "rgba(120,113,108,0.04)",       model: "" },
};

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
  const [mobile, setMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return mobile;
}

function useIsTinyScreen() {
  const [tiny, setTiny] = useState(() => window.innerWidth < 390);
  useEffect(() => {
    const handler = () => setTiny(window.innerWidth < 390);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return tiny;
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
function MenuBtn({ icon, label, onClick, badge, disabled, style }: { icon: React.ReactNode; label: string; onClick?: () => void; badge?: string; disabled?: boolean; style?: React.CSSProperties }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? "Coming soon" : undefined}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", background: "transparent", border: "none", padding: "9px 12px", borderRadius: 7, cursor: disabled ? "not-allowed" : "pointer", color: "var(--atlas-fg)", opacity: disabled ? 0.45 : 1, fontSize: 13, textAlign: "left", ...style }}
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
  PLAN:  "rgba(var(--atlas-gold-rgb),0.38)",
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

// ── DecisionLogCard ────────────────────────────────────────────────────────
function DecisionLogCard({
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

  const handleLog = () => {
    createEntry.mutate(
      {
        projectId,
        data: {
          title: `Override: ${payload.against.title}`,
          summary: payload.leadSentence,
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
      aria-label="Decision Log"
      className="atlas-catch-card atlas-bubble-in"
      style={{ padding: "10px 12px", marginTop: 8 }}
    >
      {/* Header row — label + dismiss */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
              background: "var(--atlas-ember)",
              boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-ember) 55%, transparent)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--app-font-mono)", fontSize: 9,
              letterSpacing: "0.14em", textTransform: "uppercase" as const,
              color: "var(--atlas-ember)", opacity: 0.85,
            }}
          >
            Heads up
          </span>
        </div>
        {/* Silent dismiss */}
        <button
          onClick={onProceed}
          title="Dismiss"
          aria-label="Dismiss"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1,
            padding: "2px 4px", opacity: 0.45, transition: "opacity 160ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
        >
          ×
        </button>
      </div>

      {/* Against chip */}
      <div
        style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          marginBottom: 7, padding: "3px 8px", borderRadius: 4,
          background: "color-mix(in oklab, var(--atlas-ember) 6%, transparent)",
          border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 20%, transparent)",
        }}
      >
        <span style={{
          fontFamily: "var(--app-font-mono)", fontSize: 8.5, letterSpacing: "0.1em",
          textTransform: "uppercase" as const, color: "var(--atlas-ember)", opacity: 0.6,
        }}>
          tensions with:
        </span>
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--atlas-fg)", opacity: 0.85 }}>
          {payload.against.title}
        </span>
      </div>

      {/* Lead sentence */}
      <p style={{ margin: "0 0 10px", fontSize: 12, lineHeight: 1.6, color: "var(--atlas-fg)", opacity: 0.75 }}>
        {payload.leadSentence}
      </p>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {/* Log the override to the ledger — single tap */}
        <button
          disabled={createEntry.isPending}
          onClick={handleLog}
          style={{
            padding: "4px 11px", fontSize: 9.5, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent",
            color: "color-mix(in oklab, var(--atlas-ember) 85%, var(--atlas-fg))",
            border: "0.5px solid color-mix(in oklab, var(--atlas-ember) 45%, transparent)",
            borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            opacity: createEntry.isPending ? 0.5 : 1,
            transition: "all 160ms ease",
          }}
        >
          {createEntry.isPending ? "Logging…" : "Log it"}
        </button>

        {/* Adjust — refocus the conversation */}
        <button
          disabled={createEntry.isPending}
          onClick={onAdjust}
          style={{
            padding: "5px 12px", fontSize: 9.5, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: "var(--atlas-bg)",
            border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 75%, transparent)",
            borderRadius: 4,
            boxShadow: "0 0 10px -4px color-mix(in oklab, var(--atlas-gold) 45%, transparent)",
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            transition: "opacity 160ms ease",
          }}
        >
          Adjust
        </button>
      </div>
    </div>
  );
}

// ── ProactiveAlertCard ───────────────────────────────────────────────────────
function ProactiveAlertCard({
  payload,
  projectId,
  sessionId,
  onDismiss,
}: {
  payload: AlertPayload;
  projectId: number;
  sessionId: number;
  onDismiss: () => void;
}) {
  const createEntry = useCreateEntry();
  const queryClient = useQueryClient();

  const handleNote = () => {
    createEntry.mutate(
      {
        projectId,
        data: {
          title: payload.headline,
          summary: payload.detail,
          status: "committed",
          severity: "neutral",
          mode: "THINK",
          sessionId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(projectId, {}) });
          onDismiss();
        },
      }
    );
  };

  return (
    <div
      role="status"
      aria-label="Atlas notice"
      className="atlas-bubble-in"
      style={{
        marginTop: 8, padding: "10px 12px", borderRadius: 8,
        background: "color-mix(in oklab, var(--atlas-gold) 5%, var(--atlas-surface))",
        border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 28%, transparent)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
            background: "var(--atlas-gold)",
            boxShadow: "0 0 6px color-mix(in oklab, var(--atlas-gold) 48%, transparent)",
          }} />
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: 9,
            letterSpacing: "0.14em", textTransform: "uppercase" as const,
            color: "var(--atlas-gold)", opacity: 0.85,
          }}>
            {payload.headline}
          </span>
        </div>
        <button
          onClick={onDismiss}
          title="Dismiss"
          aria-label="Dismiss notice"
          style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: "var(--atlas-muted)", fontSize: 14, lineHeight: 1,
            padding: "2px 4px", opacity: 0.45, transition: "opacity 160ms",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.45")}
        >×</button>
      </div>

      <p style={{ margin: "0 0 9px", fontSize: 12, lineHeight: 1.6, color: "var(--atlas-fg)", opacity: 0.75 }}>
        {payload.detail}
      </p>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          disabled={createEntry.isPending}
          onClick={handleNote}
          style={{
            padding: "4px 11px", fontSize: 9.5, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent",
            color: "color-mix(in oklab, var(--atlas-gold) 85%, var(--atlas-fg))",
            border: "0.5px solid color-mix(in oklab, var(--atlas-gold) 42%, transparent)",
            borderRadius: 4,
            cursor: createEntry.isPending ? "not-allowed" : "pointer",
            opacity: createEntry.isPending ? 0.5 : 1,
            transition: "all 160ms ease",
          }}
        >
          {createEntry.isPending ? "Noting…" : (payload.action || "Note it")}
        </button>
        <button
          onClick={onDismiss}
          style={{
            padding: "4px 11px", fontSize: 9.5, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase" as const,
            background: "transparent",
            color: "var(--atlas-muted)",
            border: "0.5px solid color-mix(in oklab, var(--atlas-border) 70%, transparent)",
            borderRadius: 4, cursor: "pointer", opacity: 0.6,
            transition: "opacity 160ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
        >
          Got it
        </button>
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
        <button
          type="button"
          disabled={!isTall}
          style={{
            position: "relative",
            padding: "11px 15px 11px 17px",
            borderRadius: "16px 4px 16px 16px",
            width: "100%",
            background: "var(--atlas-surface)",
            border: "none",
            textAlign: "left",
            font: "inherit",
            cursor: isTall ? "pointer" : "default",
            transition: "all 280ms cubic-bezier(0.4, 0, 0.2, 1)",
          }}
          onClick={isTall ? () => setExpanded((v) => !v) : undefined}
          aria-label={isTall ? (expanded ? "Collapse message" : "Expand message") : undefined}
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
        </button>

        {/* Action row — icon-only, visible on hover */}
        <div style={{ display: "flex", gap: 4, opacity: hov ? 1 : 0, transition: "opacity 180ms ease", justifyContent: "flex-end" }}>
          {/* Copy */}
          <button className={`atlas-icon-action${copied ? " copy-done" : ""}`} onClick={handleCopy} title={copied ? "Copied!" : "Copy"} aria-label="Copy message" style={ICON_TOUCH_TARGET_STYLE}>
            {copied
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            }
          </button>
          {/* Edit */}
          <button className="atlas-icon-action" onClick={onEdit} title="Edit &amp; resend" aria-label="Edit message" style={ICON_TOUCH_TARGET_STYLE}>
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
  autoRunCmd = "pnpm typecheck",
}: {
  fileEdits: FileEdit[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onClose: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
  autoRunCmd?: string;
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
  const [typechecking, setTypechecking] = useState(false);
  const [typecheckResult, setTypecheckResult] = useState<{ errors: Array<{ line: number; col: number; message: string }>; clean: boolean } | null>(null);
  const [localApplying, setLocalApplying] = useState(false);
  const [localApplied, setLocalApplied] = useState<string[] | null>(null);
  const [localApplyError, setLocalApplyError] = useState<string | null>(null);

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
      if (autoRunCmd.trim()) {
        try {
          const termRes = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ command: autoRunCmd }),
          });
          const reader = termRes.body?.getReader();
          const decoder = new TextDecoder();
          let termOutput = "";
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              termOutput += decoder.decode(value);
            }
          }
          if (termOutput.toLowerCase().includes("error")) {
            toast.error("Post-push typecheck found issues — check Terminal tab");
          } else {
            toast.success("✓ typecheck passed");
          }
        } catch {
          // terminal exec failed silently
        }
      }
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
          <button onClick={onClose} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", fontSize: 18, lineHeight: 1, padding: "4px 6px", opacity: 0.5 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.5")}>×</button>
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
                      <button onClick={handleRollback} disabled={rollingBack} style={{ padding: "7px 16px", borderRadius: 6, fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: rollingBack ? "var(--atlas-glass-bg)" : "rgba(239,68,68,0.08)", border: `1px solid ${rollingBack ? "var(--atlas-border)" : "rgba(239,68,68,0.25)"}`, color: rollingBack ? "var(--atlas-muted)" : "rgba(252,165,165,0.85)", cursor: rollingBack ? "not-allowed" : "pointer", transition: "all 160ms ease" }}>
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
                    <div style={{ borderRadius: 5, overflow: "hidden", border: "1px solid var(--atlas-glass-bg)", maxHeight: 280, overflowY: "auto", fontFamily: "var(--app-font-mono)", fontSize: 10.5, lineHeight: 1.55 }}>
                      {currentOriginal === null && (
                        <div style={{ padding: "5px 10px", fontSize: 10, color: "rgba(134,239,172,0.6)", background: "rgba(134,239,172,0.04)", borderBottom: "1px solid rgba(134,239,172,0.1)" }}>New file</div>
                      )}
                      {diffItems.map((item, idx) => {
                        if (item.type === "ellipsis") {
                          return <div key={idx} style={{ padding: "3px 10px", background: "rgba(0,0,0,0.2)", color: "rgba(var(--atlas-muted-rgb),0.4)", fontSize: 9.5, letterSpacing: "0.04em", borderTop: "1px solid rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>···  {item.count} unchanged {item.count === 1 ? "line" : "lines"}</div>;
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
                  <pre style={{ margin: 0, padding: "10px", background: "rgba(0,0,0,0.35)", border: "1px solid var(--atlas-glass-bg)", borderRadius: 5, fontSize: 10.5, fontFamily: "var(--app-font-mono)", lineHeight: 1.6, color: "var(--atlas-fg)", overflowX: "auto", maxHeight: 280, overflowY: "auto", whiteSpace: "pre" }}>{currentFile.content}</pre>
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
                  <input value={branchName} onChange={(e) => setBranchName(e.target.value)} placeholder="branch name" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-mono)", outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
                )}
              </div>

              {/* Commit message */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", marginBottom: 8 }}>COMMIT MESSAGE</div>
                <input value={commitMsg} onChange={(e) => setCommitMsg(e.target.value)} placeholder="describe the change" style={{ width: "100%", padding: "8px 11px", borderRadius: 6, background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", fontSize: 12, outline: "none", boxSizing: "border-box" }} onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.4)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")} />
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
            {typecheckResult && (
              <div style={{
                marginBottom: 10, padding: "8px 12px", borderRadius: 6,
                background: typecheckResult.clean ? "rgba(52,211,153,0.07)" : "rgba(239,68,68,0.07)",
                border: `1px solid ${typecheckResult.clean ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: typecheckResult.clean ? "rgba(52,211,153,0.9)" : "rgba(239,68,68,0.85)", marginBottom: typecheckResult.errors.length > 0 ? 6 : 0 }}>
                  {typecheckResult.clean ? "✓ No syntax errors detected" : `⚠ ${typecheckResult.errors.length} error${typecheckResult.errors.length !== 1 ? "s" : ""} found`}
                </div>
                {typecheckResult.errors.slice(0, 6).map((e, i) => (
                  <div key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(239,68,68,0.75)", lineHeight: 1.6 }}>
                    <span style={{ opacity: 0.55 }}>L{e.line}:{e.col} </span>{e.message}
                  </div>
                ))}
                {typecheckResult.errors.length > 6 && (
                  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", marginTop: 3 }}>
                    +{typecheckResult.errors.length - 6} more — share with Atlas to fix
                  </div>
                )}
              </div>
            )}
            {localApplied && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.3)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(52,211,153,0.9)", marginBottom: localApplied.length > 1 ? 4 : 0 }}>
                  ✓ Applied to workspace — Vite is hot-reloading
                </div>
                {localApplied.map((p, i) => (
                  <div key={i} style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "rgba(52,211,153,0.6)", lineHeight: 1.6 }}>{p}</div>
                ))}
              </div>
            )}
            {localApplyError && (
              <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 6, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", fontSize: 11, color: "rgba(239,68,68,0.8)", fontFamily: "var(--app-font-mono)", lineHeight: 1.55 }}>
                {localApplyError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 12, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
              <button
                onClick={async () => {
                  if (localApplying) return;
                  setLocalApplying(true);
                  setLocalApplied(null);
                  setLocalApplyError(null);
                  try {
                    const r = await fetch("/api/github/apply-local", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      credentials: "include",
                      body: JSON.stringify({ files: fileEdits.map(fe => ({ path: fe.path, content: fe.content })) }),
                    });
                    if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Apply failed"); }
                    const result = await r.json() as { applied: string[]; requiresServerBuild: boolean };
                    setLocalApplied(result.applied);
                    if (result.requiresServerBuild) {
                      toast("Building server…", { icon: "⚙️" });
                      fetch("/api/terminal/exec", {
                        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
                        body: JSON.stringify({ command: "pnpm --filter @workspace/api-server run build" }),
                      }).catch(() => {});
                    }
                  } catch (e) {
                    setLocalApplyError(e instanceof Error ? e.message : "Local apply failed");
                  } finally {
                    setLocalApplying(false);
                  }
                }}
                disabled={localApplying}
                style={{ padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: localApplied ? "rgba(52,211,153,0.1)" : "var(--atlas-glass-bg)", border: `1px solid ${localApplied ? "rgba(52,211,153,0.3)" : "var(--atlas-border)"}`, color: localApplied ? "rgba(52,211,153,0.8)" : "var(--atlas-muted)", cursor: localApplying ? "default" : "pointer", opacity: localApplying ? 0.55 : 1, transition: "all 150ms ease" }}
              >
                {localApplying ? "Applying…" : localApplied ? "✓ Applied" : "Apply to workspace"}
              </button>
              <button
                onClick={async () => {
                  const currentFile = fileEdits[selectedIdx] ?? fileEdits[0];
                  if (!currentFile || typechecking) return;
                  setTypechecking(true);
                  setTypecheckResult(null);
                  try {
                    const r = await fetch("/api/github/typecheck", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ content: currentFile.content, path: currentFile.path }),
                      credentials: "include",
                    });
                    if (r.ok) setTypecheckResult(await r.json() as { errors: Array<{ line: number; col: number; message: string }>; clean: boolean });
                  } catch { /* non-fatal */ } finally { setTypechecking(false); }
                }}
                disabled={typechecking}
                style={{ padding: "8px 14px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.28)", color: "var(--atlas-gold)", cursor: typechecking ? "default" : "pointer", opacity: typechecking ? 0.55 : 1, transition: "opacity 150ms ease" }}
              >
                {typechecking ? "Checking…" : "Pre-check →"}
              </button>
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
  onVisibleTextChange,
  style,
}: {
  text: string;
  speed?: number;
  animate?: boolean;
  onComplete?: () => void;
  onVisibleTextChange?: (visibleText: string) => void;
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
  const visible = done ? text : words.current.slice(0, visibleCount).join(" ");
  useEffect(() => {
    onVisibleTextChange?.(visible);
  }, [visible, onVisibleTextChange]);

  if (done) {
    return <div style={style}>{text}</div>;
  }
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
  onStreamTextChange,
  onComplete,
}: {
  text: string;
  isNew: boolean;
  textStyle?: React.CSSProperties;
  onStreamTextChange?: (visibleText: string) => void;
  onComplete?: () => void;
}) {
  const chunks = splitIntoChunks(text);
  const [revealed, setRevealed] = useState(isNew ? 0 : chunks.length);
  const completedRef = useRef(false);

  useEffect(() => {
    if (!isNew || revealed >= chunks.length) return;
    const timer = setTimeout(
      () => setRevealed((r) => r + 1),
      revealed === 0 ? 100 : 600 + Math.random() * 400,
    );
    return () => clearTimeout(timer);
  }, [revealed, chunks.length, isNew]);

  useEffect(() => {
    completedRef.current = false;
  }, [text, isNew]);

  const visibleChunks = chunks.slice(0, isNew ? Math.min(revealed + 1, chunks.length) : chunks.length);
  return (
    <>
      {visibleChunks.map((chunk, i) => (
        <StreamingText
          key={i}
          text={chunk}
          animate={isNew && i === revealed && revealed < chunks.length}
          onVisibleTextChange={(visible) => {
            if (!isNew) return;
            onStreamTextChange?.([...chunks.slice(0, i), visible].join("\n\n"));
          }}
          onComplete={() => {
            if (!isNew || i !== chunks.length - 1 || completedRef.current) return;
            completedRef.current = true;
            onComplete?.();
          }}
          style={{ ...textStyle, ...(i < visibleChunks.length - 1 ? { marginBottom: 12 } : {}) }}
        />
      ))}
    </>
  );
}

// ── LinePatchReviewCard ───────────────────────────────────────────────────────
function LinePatchReviewCard({
  linePatches,
  linkedRepo,
  projectId,
  onPushSuccess,
  onPrCreated,
}: {
  linePatches: LinePatch[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
}) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchedEdits, setPatchedEdits] = useState<FileEdit[] | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = project?.githubToken ?? null;

  const pathGroups = useMemo(() => {
    const groups: Record<string, LinePatch[]> = {};
    for (const p of linePatches) {
      if (!groups[p.path]) groups[p.path] = [];
      groups[p.path].push(p);
    }
    return groups;
  }, [linePatches]);

  const uniquePaths = Object.keys(pathGroups);
  const patchCount = linePatches.length;
  const fileCount = uniquePaths.length;

  const handleApply = async () => {
    if (!linkedRepo) { setError("No repo linked — connect a GitHub repo in the Files tab."); return; }
    if (!token) { setError("No GitHub token — add your personal token in the Files tab."); return; }
    setApplying(true);
    setError(null);
    try {
      const edits: FileEdit[] = [];
      for (const [filePath, patches] of Object.entries(pathGroups)) {
        const r = await fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { "x-github-token": token } }
        );
        if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
        const data = await r.json() as { content: string };
        let content = data.content;
        for (const patch of patches) {
          const idx = content.indexOf(patch.find);
          if (idx === -1) throw new Error(
            `Anchor not found in ${filePath.split("/").pop()}. The file may have changed since Atlas last read it — ask Atlas to re-read the file first.`
          );
          content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
        }
        const ext = filePath.split(".").pop() ?? "";
        const lang = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
        edits.push({ path: filePath, language: lang, content });
      }
      setPatchedEdits(edits);
      setShowPushModal(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <div style={{
        marginTop: 12, padding: "11px 14px", borderRadius: 8,
        background: "rgba(201,162,76,0.05)", border: "1px solid rgba(201,162,76,0.2)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, flexShrink: 0, background: "rgba(201,162,76,0.12)", border: "1px solid rgba(201,162,76,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
              <circle cx="4.5" cy="4.5" r="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
              <circle cx="4.5" cy="11.5" r="2" stroke="var(--atlas-gold)" strokeWidth="1.2" />
              <path d="M6.2 5.8L14 3M6.2 10.2L14 13M9 8H14" stroke="var(--atlas-gold)" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--atlas-gold)", marginBottom: 2 }}>
              {patchCount} patch{patchCount !== 1 ? "es" : ""} ready
            </div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {fileCount === 1
                ? uniquePaths[0]
                : `${fileCount} files — ${uniquePaths.map(p => p.split("/").pop()).join(", ")}`}
            </div>
          </div>
        </div>
        <button
          onClick={handleApply}
          disabled={applying}
          style={{
            flexShrink: 0, padding: "6px 13px", borderRadius: 5, fontSize: 11, fontWeight: 600,
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
            background: applying
              ? "rgba(201,162,76,0.25)"
              : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 78%, #6a4a18) 100%)",
            color: applying ? "var(--atlas-gold)" : "var(--atlas-bg)",
            border: "none", cursor: applying ? "default" : "pointer",
            boxShadow: applying ? "none" : "0 0 12px -4px color-mix(in oklab, var(--atlas-gold) 50%, transparent)",
            transition: "opacity 160ms ease",
          }}
        >
          {applying ? "Applying…" : "Apply & Review →"}
        </button>
      </div>

      {error && (
        <div style={{
          marginTop: 8, padding: "8px 12px", borderRadius: 6,
          background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
          fontSize: 11, color: "rgba(239,68,68,0.85)", fontFamily: "var(--app-font-mono)", lineHeight: 1.55,
        }}>
          {error}
        </div>
      )}

      {showPushModal && patchedEdits && patchedEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={patchedEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => setShowPushModal(false)}
          onPushSuccess={(records) => { onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
        />
      )}
    </>
  );
}

type InlinePreviewLine = { type: "added" | "removed"; line: string };

function InlineDiffCard({
  fileEdits,
  linePatches,
  linkedRepo,
  projectId,
  trustMode,
  onReviewDiff,
  onPushSuccess,
  onPrCreated,
  onEditDeclined,
}: {
  fileEdits: FileEdit[];
  linePatches: LinePatch[];
  linkedRepo: LinkedRepo | null;
  projectId: number;
  trustMode: "review" | "auto";
  onReviewDiff: () => void;
  onPushSuccess: (records: PushRecord[]) => void;
  onPrCreated?: (prUrl: string) => void;
  onEditDeclined?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [patchedEdits, setPatchedEdits] = useState<FileEdit[] | null>(null);
  const [showPushModal, setShowPushModal] = useState(false);
  const [originals, setOriginals] = useState<Record<string, string | null>>({});
  const pushSucceededRef = useRef(false);

  const { data: project } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const token = project?.githubToken ?? null;
  const fileEditKey = fileEdits.map((edit) => `${edit.path}:${edit.content.length}`).join("|");

  useEffect(() => {
    if (!linkedRepo || !token || fileEdits.length === 0) return;
    let cancelled = false;
    void Promise.all(
      fileEdits.map(async (edit) => {
        try {
          const r = await fetch(
            `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(edit.path)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
            { headers: { "x-github-token": token } }
          );
          if (!r.ok) return [edit.path, null] as const;
          const d = await r.json() as { content?: string };
          return [edit.path, d.content ?? null] as const;
        } catch {
          return [edit.path, null] as const;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setOriginals(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [fileEditKey, linkedRepo?.fullName, linkedRepo?.defaultBranch, token]);

  const patchGroups = useMemo(() => {
    const groups: Record<string, LinePatch[]> = {};
    for (const patch of linePatches) {
      if (!groups[patch.path]) groups[patch.path] = [];
      groups[patch.path].push(patch);
    }
    return groups;
  }, [linePatches]);

  const previewLines = useMemo<InlinePreviewLine[]>(() => {
    if (fileEdits.length > 0) {
      return fileEdits.flatMap((edit) => {
        const original = originals[edit.path];
        const lines = original !== undefined && original !== null
          ? computeLineDiff(original, edit.content).filter((line) => line.type !== "context")
          : edit.content.split("\n").map((line) => ({ type: "added" as const, line }));
        return lines.map((line) => ({ type: line.type as "added" | "removed", line: line.line }));
      });
    }
    return linePatches.flatMap((patch) => [
      ...patch.find.split("\n").map((line) => ({ type: "removed" as const, line })),
      ...patch.replace.split("\n").map((line) => ({ type: "added" as const, line })),
    ]);
  }, [fileEdits, linePatches, originals]);

  const targetPaths = fileEdits.length > 0
    ? fileEdits.map((edit) => edit.path)
    : Object.keys(patchGroups);
  const firstPath = targetPaths[0] ?? "changes";
  const filename = targetPaths.length > 1
    ? `${firstPath.split("/").pop() ?? firstPath} +${targetPaths.length - 1}`
    : firstPath;
  const changedCount = previewLines.length;
  const visibleLines = open ? previewLines : previewLines.slice(0, 3);

  const applyLinePatches = async () => {
    if (!linkedRepo) { setError("No repo linked — connect a GitHub repo in the Files tab."); return; }
    if (!token) { setError("No GitHub token — add your personal token in the Files tab."); return; }
    setApplying(true);
    setError(null);
    try {
      const edits: FileEdit[] = [];
      for (const [filePath, patches] of Object.entries(patchGroups)) {
        const r = await fetch(
          `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
          { headers: { "x-github-token": token } }
        );
        if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
        const data = await r.json() as { content: string };
        let content = data.content;
        for (const patch of patches) {
          const idx = content.indexOf(patch.find);
          if (idx === -1) throw new Error(`Anchor not found in ${filePath.split("/").pop()}. Ask Atlas to re-read the file first.`);
          content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
        }
        const ext = filePath.split(".").pop() ?? "";
        const language = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
        edits.push({ path: filePath, language, content });
      }
      setPatchedEdits(edits);
      pushSucceededRef.current = false;
      setShowPushModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply patches.");
    } finally {
      setApplying(false);
    }
  };

  const handleApply = () => {
    if (fileEdits.length > 0) {
      pushSucceededRef.current = false;
      setShowPushModal(true);
      return;
    }
    void applyLinePatches();
  };

  const modalEdits = fileEdits.length > 0 ? fileEdits : patchedEdits;

  if (trustMode === "auto") {
    return (
      <div style={{ marginTop: 12, fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-muted)", opacity: 0.65 }}>
        Applied automatically
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          marginTop: 12,
          borderRadius: 8,
          background: "var(--atlas-surface)",
          border: "1px solid var(--atlas-border)",
          overflow: "hidden",
        }}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Collapse" : "Expand"}
          style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: open ? "1px solid var(--atlas-border)" : "none", background: "transparent", borderLeft: "none", borderRight: "none", borderTop: "none", cursor: "pointer", textAlign: "left" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ flexShrink: 0, transition: "transform 160ms ease", transform: open ? "rotate(90deg)" : "rotate(0deg)", opacity: 0.55 }}>
            <path d="M3 2l4 3-4 3" stroke="var(--atlas-fg)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--app-font-mono)", fontSize: 10.5, color: "var(--atlas-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {filename}
          </span>
          <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.7 }}>
            {changedCount} line{changedCount === 1 ? "" : "s"} changed
          </span>
        </button>

        <div style={{ background: "var(--atlas-bg)", fontFamily: "var(--app-font-mono)", fontSize: 10.5, lineHeight: 1.55 }}>
          {visibleLines.map((line, idx) => {
            const added = line.type === "added";
            return (
              <div
                key={`${idx}-${line.type}-${line.line}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  background: added
                    ? "color-mix(in oklab, var(--atlas-phosphor) 8%, transparent)"
                    : "color-mix(in oklab, var(--atlas-ember) 8%, transparent)",
                  borderLeft: `2px solid ${added ? "var(--atlas-phosphor)" : "var(--atlas-ember)"}`,
                }}
              >
                <span style={{ width: 18, flexShrink: 0, textAlign: "center", color: added ? "var(--atlas-phosphor)" : "var(--atlas-ember)", userSelect: "none" as const }}>
                  {added ? "+" : "-"}
                </span>
                <span style={{ flex: 1, padding: "1px 8px 1px 0", color: "var(--atlas-muted)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {line.line || " "}
                </span>
              </div>
            );
          })}
          {!open && previewLines.length > 3 && (
            <div style={{ padding: "4px 12px", color: "var(--atlas-muted)", opacity: 0.45 }}>
              + {previewLines.length - 3} more changed line{previewLines.length - 3 === 1 ? "" : "s"}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, padding: "8px 10px", borderTop: "1px solid var(--atlas-border)" }}>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onReviewDiff(); }}
            style={{ padding: "5px 10px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em" }}
          >
            Review in Diff →
          </button>
          <button
            type="button"
            disabled={applying}
            onClick={(e) => { e.stopPropagation(); handleApply(); }}
            style={{ padding: "5px 12px", borderRadius: 5, background: "var(--atlas-gold)", border: "1px solid var(--atlas-gold)", color: "var(--atlas-bg)", cursor: applying ? "not-allowed" : "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: applying ? 0.55 : 1 }}
          >
            {applying ? "Applying..." : "Apply"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 6, background: "color-mix(in oklab, var(--atlas-ember) 9%, transparent)", border: "1px solid color-mix(in oklab, var(--atlas-ember) 24%, transparent)", color: "var(--atlas-ember)", fontFamily: "var(--app-font-mono)", fontSize: 11, lineHeight: 1.55 }}>
          {error}
        </div>
      )}

      {showPushModal && modalEdits && modalEdits.length > 0 && (
        <GitHubPushModal
          fileEdits={modalEdits}
          linkedRepo={linkedRepo}
          projectId={projectId}
          onClose={() => { setShowPushModal(false); if (!pushSucceededRef.current) onEditDeclined?.(); }}
          onPushSuccess={(records) => { pushSucceededRef.current = true; onPushSuccess(records); setShowPushModal(false); }}
          onPrCreated={onPrCreated}
        />
      )}
    </>
  );
}

function atlasActivityStatus(content: string): string {
  const planStep = content.match(/PLAN_STEP:\s*(.+)/i)?.[1]?.trim();
  if (planStep) return planStep;
  if (/LINE_PATCH/i.test(content)) return "Patching code...";
  if (/FILE_EDIT/i.test(content)) return "Preparing changes...";
  if (/FILE_READ/i.test(content)) return "Reading files...";
  if (/\b(git|push)\b/i.test(content)) return "Pushing to GitHub...";
  return "Atlas is thinking...";
}

const LIVE_FILENAME_RE = /(?:[\w.-]+\/)+(?:[\w.-]+\.\w+)|\b[\w.-]+\.(?:tsx?|jsx?|css|scss|json|mdx?|html|py|go|rs|sql|ya?ml)\b/g;

function uniquePush(items: string[], item: string): void {
  if (!item || items.includes(item)) return;
  items.push(item);
}

function parseLiveGeneration(content: string, pending: boolean): { mode: LiveGenerationMode; steps: string[]; shouldShow: boolean } {
  const steps: string[] = [];
  let mode: LiveGenerationMode = "thinking";
  const filenames = [...content.matchAll(LIVE_FILENAME_RE)].map((match) => match[0]).slice(0, 4);
  for (const filename of filenames) {
    uniquePush(steps, `Reading ${filename.split("/").pop() ?? filename}...`);
  }

  const editMatch = content.match(/FILE_EDIT(?:_START)?[\s\S]{0,160}?(?:path:\s*)?((?:[\w.-]+\/)+(?:[\w.-]+\.\w+)|[\w.-]+\.\w+)/i);
  if (/FILE_EDIT/i.test(content)) {
    mode = "edit";
    uniquePush(steps, `Preparing changes to ${editMatch?.[1]?.split("/").pop() ?? filenames[0]?.split("/").pop() ?? "files"}...`);
  }

  const patchMatch = content.match(/LINE_PATCH(?:_START)?[\s\S]{0,160}?(?:path:\s*)?((?:[\w.-]+\/)+(?:[\w.-]+\.\w+)|[\w.-]+\.\w+)/i);
  if (/LINE_PATCH/i.test(content)) {
    mode = "edit";
    uniquePush(steps, `Patching ${patchMatch?.[1]?.split("/").pop() ?? filenames[0]?.split("/").pop() ?? "file"}...`);
  }

  const numbered = [...content.matchAll(/^\s*(\d+)[.)]\s+/gm)].map((match) => Number(match[1])).filter(Number.isFinite);
  if (numbered.length > 0) {
    mode = mode === "edit" ? "edit" : "plan";
    for (const n of numbered.slice(-5)) uniquePush(steps, `Drafting step ${n}...`);
  }

  if (/\b(analy[sz]ing|checking|inspect|reviewing)\b/i.test(content)) {
    if (mode === "thinking") mode = "plan";
    uniquePush(steps, "Analyzing codebase...");
  }

  if (/\b(git|push|github|commit)\b/i.test(content)) {
    mode = "edit";
    uniquePush(steps, "Preparing to push...");
  }

  if (/\b(blueprint|architecture|architectural|moscow|must|should|could|won't|wont)\b/i.test(content) && (numbered.length >= 3 || /BLUEPRINT/.test(content))) {
    mode = "blueprint";
  }

  const planStep = content.match(/PLAN_STEP:\s*(.+)/i)?.[1]?.trim();
  if (planStep) {
    mode = "edit";
    uniquePush(steps, planStep.endsWith("...") ? planStep : `${planStep}...`);
  }

  return {
    mode,
    steps,
    shouldShow: pending || steps.length > 0,
  };
}

function AtlasActivityBar({ content }: { content: string }) {
  return (
    <div
      style={{
        margin: "2px 0 18px",
        padding: "6px 10px",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        background: "color-mix(in oklab, var(--atlas-gold) 7%, transparent)",
        border: "1px solid color-mix(in oklab, var(--atlas-gold) 14%, transparent)",
        pointerEvents: "none",
      }}
    >
      <span
        className="atlas-pulse-dot"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--atlas-gold)",
          display: "inline-block",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontFamily: "var(--app-font-mono)",
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--atlas-muted)",
          textTransform: "uppercase",
        }}
      >
        {atlasActivityStatus(content)}
      </span>
    </div>
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
  onRunCommand,
  onExtractToForge,
  onReviewDiff,
  onStreamActivityUpdate,
  onStreamActivityComplete,
  onCommitCardDone,
  planState,
  planExecution,
  onPlanStateChange,
  onPlanExecutionChange,
  onExecuteHomePlan,
  trustMode,
  agenticMode,
  onEditDeclined,
  onAlertDismiss,
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
  onRunCommand?: (command: string) => void;
  onExtractToForge?: (content: string) => void;
  onReviewDiff: () => void;
  onStreamActivityUpdate?: (content: string) => void;
  onStreamActivityComplete?: () => void;
  onCommitCardDone?: () => void;
  planState?: PlanState;
  planExecution?: PlanExecution;
  onPlanStateChange?: (messageId: number, state: PlanState) => void;
  onPlanExecutionChange?: (messageId: number, execution: PlanExecution | null) => void;
  onExecuteHomePlan?: (plan: Plan) => void;
  trustMode: "review" | "auto";
  agenticMode?: boolean;
  onEditDeclined?: () => void;
  onAlertDismiss?: () => void;
}) {
  const [hov, setHov] = useState(false);
  const hovTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [parkDone, setParkDone] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [showPushModal, setShowPushModal] = useState(false);
  const [showPlanPushModal, setShowPlanPushModal] = useState(false);
  const [planPushEdits, setPlanPushEdits] = useState<FileEdit[] | null>(null);
  const [copied, setCopied] = useState(false);
  const [selfApplyStatus, setSelfApplyStatus] = useState<"idle" | "applying" | "done" | "error">("idle");
  const [selfApplyMsg, setSelfApplyMsg] = useState("");
  const [commitCardDone, setCommitCardDone] = useState(false);
  const activeEdits = message.fileEdits ?? (message.fileEdit ? [message.fileEdit] : []);
  const planMessageId = message.id ?? 0;
  const { data: planProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const planGithubToken = planProject?.githubToken ?? null;

  // Parse CMD_EXEC block from Atlas response
  const { cmdExec, cleanContent } = useMemo(() => {
    const m = message.content.match(/CMD_EXEC:(\{[^}]*\})/);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]) as { command: string; description?: string };
        if (typeof parsed.command === "string") {
          return {
            cmdExec: parsed,
            cleanContent: message.content.replace(/\n?CMD_EXEC:\{[^}]*\}/g, "").trim(),
          };
        }
      } catch {}
    }
    return { cmdExec: null, cleanContent: message.content };
  }, [message.content]);

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
  const commitPayload = useMemo<CommitCardPayload | null>(
    () => detectDecisionMoment(message.content),
    [message.content]
  );

  const setPlanStatus = (state: PlanState) => {
    if (!message.plan) return;
    onPlanStateChange?.(planMessageId, state);
  };

  const setPlanExecution = (execution: PlanExecution | null) => {
    if (!message.plan) return;
    onPlanExecutionChange?.(planMessageId, execution);
  };

  const resolvePlanLinePatches = async (): Promise<FileEdit[]> => {
    if (!message.linePatches?.length) return [];
    if (!linkedRepo) throw new Error("No repo linked - connect a GitHub repo in the Files tab.");
    if (!planGithubToken) throw new Error("No GitHub token - add your personal token in the Files tab.");
    const groups: Record<string, LinePatch[]> = {};
    for (const patch of message.linePatches) {
      if (!groups[patch.path]) groups[patch.path] = [];
      groups[patch.path].push(patch);
    }
    const edits: FileEdit[] = [];
    for (const [filePath, patches] of Object.entries(groups)) {
      const r = await fetch(
        `/api/github/file?repo=${encodeURIComponent(linkedRepo.fullName)}&path=${encodeURIComponent(filePath)}&branch=${encodeURIComponent(linkedRepo.defaultBranch)}`,
        { headers: { "x-github-token": planGithubToken } }
      );
      if (!r.ok) throw new Error(`Could not fetch ${filePath.split("/").pop()} (${r.status})`);
      const data = await r.json() as { content: string };
      let content = data.content;
      for (const patch of patches) {
        const idx = content.indexOf(patch.find);
        if (idx === -1) throw new Error(`Anchor not found in ${filePath.split("/").pop()}. Ask Atlas to re-read the file first.`);
        content = content.slice(0, idx) + patch.replace + content.slice(idx + patch.find.length);
      }
      const ext = filePath.split(".").pop() ?? "";
      const language = ["ts", "tsx"].includes(ext) ? "typescript" : ["js", "jsx"].includes(ext) ? "javascript" : ext;
      edits.push({ path: filePath, language, content });
    }
    return edits;
  };

  const handlePlanApprove = async () => {
    if (!message.plan || planState === "executing") return;
    const firstStepOrder = message.plan.steps[0]?.order ?? 1;
    setPlanStatus("executing");
    setPlanExecution({ currentStepOrder: firstStepOrder, completedStepOrders: [] });
    onStreamActivityUpdate?.(`PLAN_STEP:${message.plan.steps[0]?.description ?? message.plan.title}`);

    const codeEdits = userEdits.length > 0 ? userEdits : activeEdits;
    const hasCodeChanges = codeEdits.length > 0 || (message.linePatches?.length ?? 0) > 0;

    if (message.planFromHome && !hasCodeChanges) {
      onExecuteHomePlan?.(message.plan);
      return;
    }

    if (!hasCodeChanges) {
      setPlanExecution({
        completedStepOrders: message.plan.steps.map((step) => step.order),
        changedFiles: 0,
        statusMessage: "Done. 0 files changed.",
      });
      setPlanStatus("completed");
      onStreamActivityComplete?.();
      return;
    }

    try {
      const patchEdits = await resolvePlanLinePatches();
      const modalEdits = [...codeEdits, ...patchEdits];
      if (modalEdits.length === 0) {
        setPlanExecution({
          completedStepOrders: message.plan.steps.map((step) => step.order),
          changedFiles: 0,
          statusMessage: "Done. 0 files changed.",
        });
        setPlanStatus("completed");
        onStreamActivityComplete?.();
        return;
      }
      const pushStep = message.plan.steps.find((step) => step.type === "push") ?? message.plan.steps[message.plan.steps.length - 1];
      setPlanExecution({
        currentStepOrder: pushStep?.order,
        completedStepOrders: message.plan.steps.filter((step) => step.order !== pushStep?.order).map((step) => step.order),
      });
      onStreamActivityUpdate?.(`PLAN_STEP:${pushStep?.description ?? "Review and push changes"}`);
      setPlanPushEdits(modalEdits);
      setShowPlanPushModal(true);
    } catch (error) {
      setPlanExecution({
        currentStepOrder: undefined,
        completedStepOrders: [],
        failedStep: {
          order: firstStepOrder,
          error: error instanceof Error ? error.message : "Plan execution failed.",
        },
      });
      setPlanStatus("pending");
      onStreamActivityComplete?.();
    }
  };

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
      onTouchStart={() => {
        if (hovTimerRef.current) clearTimeout(hovTimerRef.current);
        setHov(true);
        hovTimerRef.current = setTimeout(() => setHov(false), 3000);
      }}
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
              background: false
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
          text={cleanContent}
          isNew={isNew}
          onStreamTextChange={onStreamActivityUpdate}
          onComplete={onStreamActivityComplete}
          textStyle={{ fontSize: 14, lineHeight: 1.78, color: "var(--atlas-fg)", opacity: 0.9, whiteSpace: "pre-wrap" }}
        />

        {message.plan && planState !== "skipped" && (
          <PlanCard
            plan={message.plan}
            messageId={planMessageId}
            projectId={projectId}
            isExecuting={planState === "executing"}
            isExpanded={planState === "reviewing"}
            isCompleted={planState === "completed"}
            execution={planExecution}
            onReview={() => setPlanStatus(planState === "reviewing" ? "pending" : "reviewing")}
            onSkip={() => setPlanStatus("skipped")}
            onApprove={() => void handlePlanApprove()}
          />
        )}

        {showPlanPushModal && planPushEdits && planPushEdits.length > 0 && message.plan && (
          <GitHubPushModal
            fileEdits={planPushEdits}
            linkedRepo={linkedRepo}
            projectId={projectId}
            onClose={() => {
              setShowPlanPushModal(false);
              setPlanStatus("pending");
              setPlanExecution(null);
              onStreamActivityComplete?.();
            }}
            onPushSuccess={(records) => {
              onPushSuccess(records);
              const changedFiles = new Set(records.map((record) => record.path)).size;
              setPlanExecution({
                completedStepOrders: message.plan?.steps.map((step) => step.order) ?? [],
                changedFiles,
                statusMessage: `Done. ${changedFiles} file${changedFiles === 1 ? "" : "s"} changed.`,
              });
              setPlanStatus("completed");
              setShowPlanPushModal(false);
              onStreamActivityComplete?.();
            }}
            onPrCreated={onPrCreated}
          />
        )}

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

        {(userEdits.length > 0 || (message.linePatches && message.linePatches.length > 0)) && (
          <InlineDiffCard
            fileEdits={userEdits}
            linePatches={message.linePatches ?? []}
            linkedRepo={linkedRepo}
            projectId={projectId}
            trustMode={trustMode}
            onReviewDiff={onReviewDiff}
            onPushSuccess={onPushSuccess}
            onPrCreated={onPrCreated}
            onEditDeclined={onEditDeclined}
          />
        )}

        {commitPayload && !commitCardDone && (
          <CommitCard
            payload={commitPayload}
            projectId={projectId}
            sessionId={sessionId}
            sourceMessageId={message.id}
            onDone={() => {
              setCommitCardDone(true);
              onCommitCardDone?.();
            }}
          />
        )}

        {message.catchPayload && !message.catchResolved && (
          <DecisionLogCard
            payload={message.catchPayload}
            projectId={projectId}
            sessionId={sessionId}
            onProceed={onCatchProceed}
            onAdjust={onCatchAdjust}
          />
        )}

        {message.alertPayload && !message.alertResolved && (
          <ProactiveAlertCard
            payload={message.alertPayload}
            projectId={projectId}
            sessionId={sessionId}
            onDismiss={() => onAlertDismiss?.()}
          />
        )}

        {/* CMD_EXEC — runnable command card suggested by Atlas */}
        {cmdExec && (
          <div
            style={{
              marginTop: 12, padding: "10px 14px",
              borderRadius: 8,
              background: "var(--atlas-surface)",
              border: agenticMode
                ? "1px solid rgba(201,162,76,0.40)"
                : "1px solid rgba(201,162,76,0.22)",
              display: "flex", alignItems: "center", gap: 10,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.65 }}>
              <path d="M2 4l5 4-5 4" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M9 12h5" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 12.5, color: "rgba(201,162,76,0.92)", letterSpacing: "0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {cmdExec.command}
              </div>
              {cmdExec.description && (
                <div style={{ fontSize: 11, color: "var(--atlas-muted)", marginTop: 2, opacity: 0.8 }}>{cmdExec.description}</div>
              )}
            </div>
            {agenticMode ? (
              <div style={{
                flexShrink: 0, padding: "5px 10px", borderRadius: 5,
                background: "rgba(201,162,76,0.10)",
                border: "1px solid rgba(201,162,76,0.30)",
                color: "rgba(201,162,76,0.80)",
                fontSize: 10, fontWeight: 600, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 4,
              }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
                Auto
              </div>
            ) : (
              <button
                onClick={() => onRunCommand?.(cmdExec.command)}
                style={{
                  flexShrink: 0, padding: "5px 12px", borderRadius: 5,
                  background: "rgba(146,64,14,0.25)",
                  border: "1px solid rgba(146,64,14,0.55)",
                  color: "rgba(230,150,90,0.95)",
                  fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.08em", cursor: "pointer",
                  transition: "all 140ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(146,64,14,0.4)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(146,64,14,0.25)")}
              >
                Run →
              </button>
            )}
          </div>
        )}

        {/* Action row — icon-only cockpit buttons */}
        <div style={{ display: "flex", gap: 4, marginTop: 7, opacity: hov ? 1 : 0.32, transition: "opacity 180ms ease" }}>
          {/* Copy */}
          <button
            className={`atlas-icon-action${copied ? " copy-done" : ""}`}
            title={copied ? "Copied!" : "Copy response"}
            aria-label="Copy message"
            style={ICON_TOUCH_TARGET_STYLE}
            onClick={() => { navigator.clipboard.writeText(message.content).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
          >
            {copied
              ? <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M2 7l3 3 7-7" /></svg>
              : <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" /></svg>
            }
          </button>
          {/* Regenerate / Retry */}
          <button className="atlas-icon-action" title="Retry (regenerate)" aria-label="Retry" onClick={onRegenerate} style={ICON_TOUCH_TARGET_STYLE}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 7a5.5 5.5 0 005.5 5.5 5.5 5.5 0 005.5-5.5 5.5 5.5 0 00-5.5-5.5 5.5 5.5 0 00-3.9 1.6" />
              <polyline points="1.5 1.5 1.5 4 4 4" />
            </svg>
          </button>
          {/* Park */}
          <button
            className={`atlas-icon-action${parkDone ? " done" : ""}`}
            title={parkDone ? "Parked" : "Park to inbox"}
            aria-label="Save to parking lot"
            style={ICON_TOUCH_TARGET_STYLE}
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
            aria-label="Save to ledger"
            style={ICON_TOUCH_TARGET_STYLE}
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
              aria-label="Toggle preview"
              onClick={() => onPreviewCode(previewableCode)}
              style={{ ...ICON_TOUCH_TARGET_STYLE, color: "var(--atlas-gold)", opacity: hov ? 0.85 : 0.32 }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="2" width="12" height="9" rx="1.5" />
                <path d="M5 5.5l2 2-2 2M8.5 9.5h1.5" />
              </svg>
            </button>
          )}
          {/* Extract to Forge — surfaces on structured/lengthy responses */}
          {onExtractToForge && message.content.length > 200 && (
            <button
              className="atlas-icon-action"
              title="Extract to Forge — turn this response into strategic nodes"
              aria-label="Open Forge"
              onClick={() => onExtractToForge(message.content)}
              style={{
                ...ICON_TOUCH_TARGET_STYLE,
                display: "flex", alignItems: "center", gap: 4,
                opacity: hov ? 1 : 0.32,
                padding: "4px 7px", borderRadius: 5,
                border: hov ? "1px solid rgba(201,162,76,0.30)" : "1px solid transparent",
                background: hov ? "rgba(201,162,76,0.07)" : "transparent",
                transition: "all 180ms ease",
              }}
            >
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 1v8M4 6l3 3 3-3" />
                <path d="M2 10v1.5A1.5 1.5 0 003.5 13h7a1.5 1.5 0 001.5-1.5V10" />
              </svg>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", color: "var(--atlas-gold)" }}>FORGE</span>
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
          style={{ flexShrink: 0, color: "rgba(var(--atlas-muted-rgb),0.45)", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}>
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
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.07em", background: "rgba(var(--atlas-muted-rgb),0.12)", color: "rgba(var(--atlas-muted-rgb),0.6)", padding: "2px 7px", borderRadius: 4, flexShrink: 0, textTransform: "uppercase" as const }}>
          NOTE
        </span>
      </div>

      {/* Source line (collapsed) */}
      {!expanded && (
        <div style={{ paddingLeft: 20, paddingBottom: 6, fontSize: 10, color: "rgba(var(--atlas-muted-rgb),0.38)", fontFamily: "var(--app-font-mono)" }}>
          chat message · {timeAgo(entry.createdAt)}
        </div>
      )}

      {/* Expanded definition card */}
      {expanded && (
        <div style={{ marginLeft: 20, marginBottom: 14, background: "var(--atlas-surface-alt)", border: "1px solid color-mix(in oklab, var(--atlas-gold) 12%, transparent)", borderRadius: 10, padding: "14px 16px" }}>
          {/* Category tags + status badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color: "rgba(var(--atlas-muted-rgb),0.45)", textTransform: "uppercase" as const }}>
              {modeLabel} · {typeLabel}
            </span>
            {entry.buildId && (
              <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(var(--atlas-muted-rgb),0.1)", border: "0.5px solid rgba(var(--atlas-muted-rgb),0.2)", color: "rgba(var(--atlas-muted-rgb),0.65)", padding: "1px 7px", borderRadius: 10 }}>
                #{entry.buildId}
              </span>
            )}
            {entry.costOfLesson && (
              <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(var(--atlas-muted-rgb),0.55)" }}>
                cost: {entry.costOfLesson}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: entry.isViolation ? "rgba(239,68,68,0.08)" : "rgba(74,222,128,0.07)", border: `1px solid ${entry.isViolation ? "rgba(239,68,68,0.18)" : "rgba(74,222,128,0.18)"}`, color: entry.isViolation ? "rgba(239,68,68,0.75)" : "rgba(74,222,128,0.75)", padding: "2px 9px", borderRadius: 20, textTransform: "uppercase" as const }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
              {entry.isViolation ? "OVERRIDE" : "REVERSIBLE"}
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
              <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "rgba(var(--atlas-muted-rgb),0.45)", marginBottom: 5 }}>
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
                color: "rgba(var(--atlas-muted-rgb),0.5)", textTransform: "uppercase" as const,
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
              background: "var(--atlas-surface)",
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
                  <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "rgba(var(--atlas-muted-rgb),0.45)", marginBottom: 6 }}>
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
          <div style={{ fontSize: 10, color: "rgba(var(--atlas-muted-rgb),0.35)", fontFamily: "var(--app-font-mono)", marginBottom: 12 }}>
            chat message · {timeAgo(entry.createdAt)}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleResolve} disabled={done || updateEntry.isPending}
              style={{ flex: 1, padding: "7px", borderRadius: 7, fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "transparent", border: "1px solid rgba(var(--atlas-muted-rgb),0.22)", color: "var(--atlas-muted)", cursor: done ? "default" : "pointer", transition: "all 150ms ease" }}
              onMouseEnter={(e) => { if (!done) e.currentTarget.style.borderColor = "rgba(var(--atlas-muted-rgb),0.5)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(var(--atlas-muted-rgb),0.22)"; }}
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
              {entry.deviation && <CapsuleTag severity="blocker" size="xs">SHIFTED</CapsuleTag>}
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
              : "rgba(var(--atlas-muted-rgb),0.65)";
            const isNew = r.originalContent === null;
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--atlas-surface)" }}>
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
              background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
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
                  <span style={{ fontSize: 10, color: "rgba(var(--atlas-muted-rgb),0.45)", fontFamily: "var(--app-font-mono)" }}>
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

interface GhCommitFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

interface GhCommitSummary {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
  files: GhCommitFile[];
}


function FileIcon({ ext }: { ext?: string }) {
  const color =
    ext === "md" ? "#C9A24C"
    : ext === "ts" || ext === "tsx" ? "#60a5fa"
    : ext === "js" || ext === "jsx" ? "#fbbf24"
    : ext === "css" ? "#a78bfa"
    : ext === "json" ? "#34d399"
    : "rgba(var(--atlas-muted-rgb),0.7)";
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

function formatCommitTimeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.max(0, Math.floor(diff / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function CommitHistoryCard({ commit }: { commit: GhCommitSummary }) {
  const [expanded, setExpanded] = useState(false);
  const firstLine = commit.message.split("\n")[0] || "(no commit message)";
  const displayMessage = expanded || firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77)}...`;
  return (
    <div
      style={{
        width: "100%",
        borderRadius: 8,
        background: "var(--atlas-surface)",
        border: "1px solid var(--atlas-border)",
        color: "var(--atlas-fg)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={{
            flex: 1,
            minWidth: 0,
            textAlign: "left",
            padding: "10px 12px",
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--atlas-fg)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis" }}>
            {displayMessage}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginTop: 4 }}>
            <span style={{ fontSize: 10.5, color: "var(--atlas-muted)" }}>{commit.author}</span>
            <span style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.55 }}>·</span>
            <span style={{ fontSize: 10.5, color: "var(--atlas-muted)" }}>{formatCommitTimeAgo(commit.timestamp)}</span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.65 }}>{commit.sha.slice(0, 7)}</span>
          </div>
        </button>
        <a
          href={commit.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View commit on GitHub"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: "var(--atlas-gold)",
            textDecoration: "none",
            fontSize: 15,
            lineHeight: 1,
            padding: "10px 12px",
            flexShrink: 0,
            opacity: 0.78,
          }}
        >
          ↗
        </a>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--atlas-border)", padding: "9px 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
            {commit.message || "(no commit message)"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {commit.files.length > 0 ? commit.files.map((file) => (
              <div key={file.filename} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5, color: "var(--atlas-fg)", fontFamily: "var(--app-font-mono)" }}>
                  {file.filename}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-phosphor)", flexShrink: 0 }}>
                  +{file.additions}
                </span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, color: "var(--atlas-ember)", flexShrink: 0 }}>
                  -{file.deletions}
                </span>
              </div>
            )) : (
              <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.65 }}>No file details available.</div>
            )}
          </div>
          <a
            href={commit.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "var(--atlas-gold)", textDecoration: "none", alignSelf: "flex-start" }}
          >
            View on GitHub →
          </a>
        </div>
      )}
    </div>
  );
}

function CommitHistorySkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <style>{`@keyframes atlas-history-pulse{0%,100%{opacity:.36}50%{opacity:.72}}`}</style>
      {[0, 1, 2].map((idx) => (
        <div key={idx} style={{ padding: "12px", borderRadius: 8, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface)", animation: "atlas-history-pulse 1.4s ease-in-out infinite" }}>
          <div style={{ height: 12, width: "72%", borderRadius: 4, background: "var(--atlas-muted)", opacity: 0.28, marginBottom: 9 }} />
          <div style={{ height: 9, width: "42%", borderRadius: 4, background: "var(--atlas-muted)", opacity: 0.18 }} />
        </div>
      ))}
    </div>
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
      // Never write the __server__ sentinel to the DB — it's not a real token
      if (!dbToken && t !== "__server__") updateProject.mutate({ id: projectId, data: { githubToken: t } });
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
      if (t !== "__server__") updateProject.mutate({ id: projectId, data: { githubToken: t } });
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
  const [flatFiles, setFlatFiles] = useState<Array<{ path: string; name: string }>>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState("main");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<GhFileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [view, setView] = useState<"repos" | "tree" | "file">("repos");
  const [filesSubTab, setFilesSubTab] = useState<"files" | "history">("files");
  const [commits, setCommits] = useState<GhCommitSummary[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [commitsReason, setCommitsReason] = useState<string | null>(null);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [clearTokenError, setClearTokenError] = useState<string | null>(null);
  const [unlinkRepoError, setUnlinkRepoError] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const autoLoadedRef = useRef(false);
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [fileSearch, setFileSearch] = useState("");

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
    setFilesSubTab("files");
    setCommits([]);
    setCommitsError(null);
    setCommitsReason(null);
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
    setFilesSubTab("files");
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
              background: "var(--atlas-surface)",
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
              background: tokenInput.trim() ? "var(--atlas-ember)" : "var(--atlas-surface)",
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
          onClick={() => { setFilesSubTab("files"); setView("repos"); setSelectedRepo(null); setSelectedPath(null); setFileContent(null); onFileContext(null); }}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: view === "repos" ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", opacity: view === "repos" ? 0.8 : 0.45, flexShrink: 0 }}
        >
          repos
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
                style={{ background: "transparent", border: "1px solid var(--atlas-border)", borderRadius: 5, cursor: isDisconnecting ? "default" : "pointer", color: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", padding: "3px 8px", opacity: isDisconnecting ? 0.35 : 0.8, minHeight: 28 }}
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
                background: "rgba(var(--atlas-gold-rgb),0.06)",
                border: "1px solid rgba(var(--atlas-gold-rgb),0.18)",
                borderRadius: 6, cursor: "pointer",
                color: "rgba(var(--atlas-gold-rgb),0.65)", fontSize: 9.5,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
                padding: "4px 8px", minHeight: 28,
                transition: "all 140ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(var(--atlas-gold-rgb),0.12)"; e.currentTarget.style.color = "rgba(var(--atlas-gold-rgb),0.9)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(var(--atlas-gold-rgb),0.06)"; e.currentTarget.style.color = "rgba(var(--atlas-gold-rgb),0.65)"; }}
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
                {tab === "files" ? "Files" : "History"}
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
              {commits.map((commit) => <CommitHistoryCard key={commit.sha} commit={commit} />)}
            </div>
          )}
        </div>
      )}

      {/* Repos list */}
      {filesSubTab === "files" && view === "repos" && (
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
                      <span style={{ fontSize: 8, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", padding: "1px 5px", borderRadius: 3, background: "rgba(var(--atlas-muted-rgb),0.12)", color: "var(--atlas-muted)", border: "0.5px solid rgba(var(--atlas-muted-rgb),0.2)", flexShrink: 0 }}>
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
      {filesSubTab === "files" && view === "tree" && (
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
          {/* Search input */}
          <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid var(--atlas-border)" }}>
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
          </div>

          {/* File list — search results or tree */}
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
            ) : (
              // Normal tree view
              <div style={{ overflowY: "auto", flex: 1 }}>
                {tree.map((node) => (
                  <GhTreeNodeRow key={node.path} node={node} depth={0} selectedPath={selectedPath} onSelect={loadFile} />
                ))}
              </div>
            )
          )}
        </div>
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
    </div>
  );
}

// ── Preview tab ──────────────────────────────────────────────────────────────
function PreviewTab({ projectId, sandboxCode, onSandboxConsumed, refreshTrigger }: {
  projectId: number;
  sandboxCode?: string | null;
  onSandboxConsumed?: () => void;
  refreshTrigger?: number;
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

  // ── Devserver state ──────────────────────────────────────────────────────────
  type DsStatus = "idle" | "cloning" | "installing" | "starting" | "running" | "error";
  const [dsStatus, setDsStatus] = useState<DsStatus>("idle");
  const [dsLogs, setDsLogs] = useState<string[]>([]);
  const [dsPort, setDsPort] = useState<number | null>(null);
  const [dsErrorMsg, setDsErrorMsg] = useState<string | null>(null);
  const [dsStarting, setDsStarting] = useState(false);
  const dsLogsEndRef = useRef<HTMLDivElement>(null);

  // Poll status while active
  useEffect(() => {
    if (previewMode !== "local" || dsStatus === "idle") return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch("/api/devserver/status", { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json() as { status: string; port: number | null; logs: string[]; errorMsg: string | null };
        setDsStatus(d.status as DsStatus);
        setDsLogs(d.logs);
        setDsPort(d.port);
        setDsErrorMsg(d.errorMsg);
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [previewMode, dsStatus]);

  // Auto-scroll logs
  useEffect(() => {
    dsLogsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [dsLogs]);

  const handleDsStart = async () => {
    if (!linkedRepo) return;
    setDsStarting(true);
    setDsLogs([]);
    setDsErrorMsg(null);
    const token = project?.githubToken ?? "__server__";
    try {
      const r = await fetch("/api/devserver/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        credentials: "include",
        body: JSON.stringify({ repoFullName: linkedRepo.fullName, branch: linkedRepo.defaultBranch ?? "main" }),
      });
      const d = await r.json() as { status?: string; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Failed to start");
      setDsStatus((d.status ?? "cloning") as DsStatus);
    } catch (e) {
      setDsErrorMsg(e instanceof Error ? e.message : "Start failed");
      setDsStatus("error");
    } finally {
      setDsStarting(false);
    }
  };

  const handleDsStop = async () => {
    await fetch("/api/devserver/stop", { method: "POST", credentials: "include" });
    setDsStatus("idle");
    setDsLogs([]);
    setDsPort(null);
    setDsErrorMsg(null);
  };

  const DS_STAGE_LABELS: Record<DsStatus, string> = {
    idle: "Idle",
    cloning: "Cloning repo…",
    installing: "Installing dependencies…",
    starting: "Starting dev server…",
    running: "Running",
    error: "Error",
  };
  const DS_STAGE_PROGRESS: Record<DsStatus, number> = {
    idle: 0, cloning: 20, installing: 50, starting: 80, running: 100, error: 0,
  };

  // Sync external refresh trigger (from push success) into local reloadKey
  const prevRefreshTrigger = useRef(refreshTrigger ?? 0);
  useEffect(() => {
    if ((refreshTrigger ?? 0) > prevRefreshTrigger.current) {
      prevRefreshTrigger.current = refreshTrigger ?? 0;
      setIframeLoading(true);
      setIframeError(false);
      setReloadKey((k) => k + 1);
    }
  }, [refreshTrigger]);
  const [autoDetected, setAutoDetected] = useState<{ url: string; platform: string } | null>(null);
  const autoDetectTriedRef = useRef<string | null>(null);

  const { data: previewProject } = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  const linkedRepo = (() => { try { return previewProject?.linkedRepo ? JSON.parse(previewProject.linkedRepo) as { fullName: string; defaultBranch?: string } : null; } catch { return null; } })();
  const token = previewProject?.githubToken ?? null;


  // ── Sandbox handoff from chat ────────────────────────────────────────────────
  const buildSrcdoc = (code: string): string => {
    const t = code.trim();
    // Already a full HTML doc
    if (/^\s*<!DOCTYPE/i.test(t) || /^\s*<html/i.test(t)) return t;

    // Detect React/JSX: has imports from react, JSX syntax, or export default function
    const isReact = /from\s+['"]react['"]|useState|useEffect|export\s+default\s+function|export\s+default\s+class|<[A-Z][A-Za-z]*[\s/>]/.test(t);

    if (isReact) {
      // Capture which function/class was the default export before stripping
      const exportMatch = t.match(/export\s+default\s+(?:function|class)\s+([A-Z]\w*)/);
      // Also handle: export default SomeName; at end of file
      const namedExportMatch = t.match(/export\s+default\s+([A-Z]\w*)\s*;/);
      const mainComponent = exportMatch?.[1] ?? namedExportMatch?.[1];

      let processed = t
        // Strip all import lines
        .replace(/^import\s+.*?\n/gm, "")
        // Remove export default from function/class declaration
        .replace(/export\s+default\s+(function|class)\s+/g, "$1 ")
        // Remove standalone export default SomeName;
        .replace(/export\s+default\s+[A-Z]\w*\s*;\s*/g, "");

      // If we couldn't find a named export, find the last uppercase function as fallback
      const fallback = mainComponent ?? [...processed.matchAll(/function\s+([A-Z]\w*)\s*\(/g)].pop()?.[1];

      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://unpkg.com/react@18/umd/react.development.js"><\/script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"><\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }</style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    const { useState, useEffect, useCallback, useRef, useMemo, useContext, createContext } = React;
    const useNavigate = () => () => {};
    const useLocation = () => ({ pathname: "/" });
    const useParams = () => ({});
    const Link = ({ children, to, className, style, onClick }) => (
      <a href={to ?? "#"} className={className} style={style} onClick={onClick}>{children}</a>
    );

    ${processed}

    ${fallback ? `ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(${fallback}));` : ""}
  <\/script>
</body>
</html>`;
    }

    // Plain HTML
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; padding: 0; }</style>
</head>
<body>
${t}
</body>
</html>`;
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
            {m === "url" ? "Live URL" : m === "sandbox" ? "Sandbox" : "Local"}
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
                    borderRadius: 5, background: "var(--atlas-surface)",
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
                    aria-label="Reload preview"
                    style={{ padding: "5px 7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0, lineHeight: 1, opacity: 0.55, transition: "opacity 160ms ease" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
                  >↺</button>
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab"
                    style={{ padding: "5px 7px", borderRadius: 5, background: "transparent", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", fontSize: 10, lineHeight: 1, ...sMono, opacity: 0.55, textDecoration: "none", flexShrink: 0, transition: "opacity 160ms ease", display: "flex", alignItems: "center" }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.55")}
                  >↗</a>
                  <button onClick={handleClear} title="Clear" aria-label="Clear preview"
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
                <button onClick={handleDetect} disabled={detecting} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: detecting ? "var(--atlas-glass-bg)" : "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.2)", color: detecting ? "var(--atlas-muted)" : "var(--atlas-gold)", cursor: detecting ? "not-allowed" : "pointer", flexShrink: 0 }}>
                  {detecting ? "Detecting…" : "Auto-detect URL"}
                </button>
              ) : (
                <div style={{ fontSize: 9.5, ...sMono, color: "var(--atlas-muted)", opacity: 0.35 }}>Link a repo in Files to auto-detect URL</div>
              )}
              {liveUrl && (
                <button onClick={handleSaveToProject} disabled={savedIndicator || updateProject.isPending || !!autoDetected} style={{ marginLeft: "auto", padding: "4px 10px", borderRadius: 4, fontSize: 9.5, ...sMono, letterSpacing: "0.08em", background: (savedIndicator || autoDetected) ? "rgba(34,197,94,0.08)" : "var(--atlas-glass-bg)", border: `1px solid ${(savedIndicator || autoDetected) ? "rgba(34,197,94,0.2)" : "var(--atlas-border)"}`, color: (savedIndicator || autoDetected) ? "rgba(134,239,172,0.8)" : "var(--atlas-muted)", cursor: (savedIndicator || autoDetected) ? "default" : "pointer", flexShrink: 0, transition: "all 160ms ease" }}>
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
                    width: "100%", resize: "vertical", background: "var(--atlas-surface)",
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
                    style={{ padding: "5px 12px", borderRadius: 5, background: sandboxInput.trim() ? "var(--atlas-ember)" : "var(--atlas-glass-bg)", border: "none", color: sandboxInput.trim() ? "var(--atlas-fg)" : "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", cursor: sandboxInput.trim() ? "pointer" : "not-allowed", transition: "all 140ms ease" }}
                  >Render</button>
                  <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.28 }}>React + HTML · Tailwind included</span>
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
                  Paste any HTML or React component above<br />and hit <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Render</strong> to preview it.
                </div>
                <div style={{ fontSize: 9.5, color: "var(--atlas-muted)", opacity: 0.22, textAlign: "center", lineHeight: 1.7, fontFamily: "var(--app-font-mono)" }}>
                  Or tap Preview on any code block in the chat<br />to send it here instantly.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Local dev server mode ── */}
      {previewMode === "local" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {!linkedRepo ? (
            /* ── No repo linked ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 20px", gap: 12 }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" opacity={0.12}>
                <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="var(--atlas-fg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <div style={{ fontSize: 11.5, color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.8 }}>
                Link a GitHub repo in the <strong style={{ color: "var(--atlas-gold)", opacity: 0.8, fontWeight: 500 }}>Files</strong> tab<br />to run a live dev server here.
              </div>
            </div>
          ) : dsStatus === "running" && dsPort ? (
            /* ── Running — show proxy iframe ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
              {/* Top bar */}
              <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--atlas-border)", background: "var(--atlas-surface)" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "rgba(52,211,153,0.8)", letterSpacing: "0.05em" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "rgba(52,211,153,0.8)", display: "inline-block", boxShadow: "0 0 6px rgba(52,211,153,0.5)" }} />
                  Live · {linkedRepo.fullName} · :{dsPort}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => { setReloadKey(k => k + 1); }}
                  title="Reload preview"
                  aria-label="Reload preview"
                  style={{ background: "transparent", border: "none", cursor: "pointer", padding: "2px 6px", color: "var(--atlas-muted)", fontSize: 10, fontFamily: "var(--app-font-mono)", borderRadius: 4, opacity: 0.55, transition: "opacity 140ms" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.55")}
                >↺</button>
                <button
                  onClick={handleDsStop}
                  style={{ padding: "3px 10px", borderRadius: 4, fontSize: 9.5, fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", color: "rgba(239,68,68,0.7)", cursor: "pointer", transition: "all 140ms" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.14)"; e.currentTarget.style.color = "rgba(239,68,68,0.95)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; e.currentTarget.style.color = "rgba(239,68,68,0.7)"; }}
                >Stop</button>
              </div>
              <iframe
                key={`devserver-${reloadKey}`}
                src="/api/devserver/proxy/"
                title="Dev server preview"
                style={{ flex: 1, border: "none", width: "100%", display: "block", background: "#fff" }}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              />
            </div>
          ) : dsStatus === "error" ? (
            /* ── Error state ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", gap: 16 }}>
              <div style={{ padding: "12px 16px", borderRadius: 8, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)", maxWidth: 280, width: "100%" }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(239,68,68,0.8)", marginBottom: 4 }}>Dev server error</div>
                <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(239,68,68,0.65)", lineHeight: 1.6 }}>{dsErrorMsg ?? "Unknown error"}</div>
              </div>
              {dsLogs.length > 0 && (
                <div style={{ width: "100%", maxWidth: 320, maxHeight: 120, overflowY: "auto", background: "rgba(12,10,9,0.8)", border: "1px solid var(--atlas-border)", borderRadius: 6, padding: "7px 10px" }} className="scrollbar-none">
                  {dsLogs.slice(-20).map((l, i) => (
                    <div key={i} style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", lineHeight: 1.7, opacity: 0.7 }}>{l}</div>
                  ))}
                </div>
              )}
              <button
                onClick={handleDsStart}
                disabled={dsStarting}
                style={{ padding: "8px 20px", borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", background: "rgba(201,162,76,0.1)", border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)", cursor: dsStarting ? "default" : "pointer", opacity: dsStarting ? 0.5 : 1 }}
              >
                {dsStarting ? "Starting…" : "Retry →"}
              </button>
            </div>
          ) : dsStatus !== "idle" ? (
            /* ── Active: cloning / installing / starting ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              {/* Progress header */}
              <div style={{ flexShrink: 0, padding: "14px 14px 10px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 10.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.06em" }}>
                    {DS_STAGE_LABELS[dsStatus]}
                  </span>
                  <button
                    onClick={handleDsStop}
                    style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", opacity: 0.5, padding: 0 }}
                  >cancel</button>
                </div>
                {/* Progress bar */}
                <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 2,
                    width: `${DS_STAGE_PROGRESS[dsStatus]}%`,
                    background: "linear-gradient(90deg, var(--atlas-ember), var(--atlas-gold))",
                    transition: "width 600ms ease",
                    boxShadow: "0 0 8px -1px var(--atlas-gold)",
                  }} />
                </div>
              </div>
              {/* Log pane */}
              <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px", margin: "0 2px" }} className="scrollbar-none">
                <div style={{ background: "rgba(12,10,9,0.7)", border: "1px solid var(--atlas-border)", borderRadius: 7, padding: "10px 12px", minHeight: "100%" }}>
                  {dsLogs.length === 0 ? (
                    <div style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.3 }}>Waiting for output…</div>
                  ) : dsLogs.map((l, i) => (
                    <div key={i} style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", lineHeight: 1.75, opacity: i < dsLogs.length - 4 ? 0.45 : 0.85 }}>{l}</div>
                  ))}
                  <div ref={dsLogsEndRef} />
                </div>
              </div>
            </div>
          ) : (
            /* ── Idle — launch screen ── */
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", gap: 18 }}>
              {/* Repo pill */}
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.18)", borderRadius: 20, padding: "5px 13px" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="var(--atlas-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.04em" }}>{linkedRepo.fullName}</span>
              </div>
              {/* Description */}
              <div style={{ textAlign: "center", maxWidth: 250 }}>
                <p style={{ margin: "0 0 5px", fontSize: 12.5, color: "var(--atlas-fg)", fontWeight: 500, lineHeight: 1.5 }}>Run dev server</p>
                <p style={{ margin: 0, fontSize: 10.5, color: "var(--atlas-muted)", lineHeight: 1.7 }}>
                  Clones your repo, installs dependencies, and runs it live. Works with private repos.
                </p>
              </div>
              {/* Time note */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 20, background: "rgba(255,255,255,0.03)", border: "1px solid var(--atlas-border)" }}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="var(--atlas-muted)" strokeWidth="1.3"/><path d="M8 5v3l2 1.5" stroke="var(--atlas-muted)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                <span style={{ fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.5, letterSpacing: "0.03em" }}>First boot takes ~1–2 min</span>
              </div>
              {/* Launch button */}
              <button
                onClick={handleDsStart}
                disabled={dsStarting}
                style={{
                  padding: "11px 28px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                  background: dsStarting
                    ? "rgba(201,162,76,0.15)"
                    : "linear-gradient(180deg, var(--atlas-gold) 0%, color-mix(in oklab, var(--atlas-gold) 75%, #6a4a18) 100%)",
                  color: dsStarting ? "var(--atlas-gold)" : "var(--atlas-bg)",
                  border: "none", cursor: dsStarting ? "default" : "pointer",
                  boxShadow: dsStarting ? "none" : "0 0 20px -6px color-mix(in oklab, var(--atlas-gold) 50%, transparent)",
                  transition: "all 180ms ease",
                  opacity: dsStarting ? 0.6 : 1,
                }}
              >
                {dsStarting ? "Launching…" : "Launch →"}
              </button>
            </div>
          )}
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
        <span style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", color: "var(--atlas-muted)", opacity: 0.6 }}>
          {(() => {
            try {
              const p = memory ? JSON.parse(memory) : null;
              const count = p?.entries?.length ?? 0;
              return count > 0 ? `memory · ${count} entries` : "project memory";
            } catch { return "project memory"; }
          })()}
        </span>
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
      <div style={{ flex: 1, overflowY: "auto", maxHeight: "calc(100vh - 200px)", padding: "10px 12px" }} className="scrollbar-none">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
            style={{
              width: "100%", height: "100%", minHeight: 200, resize: "none",
              background: "var(--atlas-surface)", border: "1px solid rgba(201,162,76,0.25)",
              borderRadius: 6, color: "var(--atlas-fg)", fontSize: 11,
              ...sMono, lineHeight: 1.65, padding: "10px 12px",
              outline: "none", boxSizing: "border-box",
            }}
          />
        ) : (
          (() => {
            const tierConfig = [
              { tier: 1, label: "CORE", sublabel: "Never decays", color: "rgba(201,162,76,0.9)", bg: "rgba(201,162,76,0.08)", border: "rgba(201,162,76,0.25)" },
              { tier: 2, label: "PATTERNS", sublabel: "180 days", color: "rgba(99,130,239,0.9)", bg: "rgba(99,130,239,0.06)", border: "rgba(99,130,239,0.2)" },
              { tier: 3, label: "MILESTONES", sublabel: "90 days", color: "rgba(34,197,94,0.85)", bg: "rgba(34,197,94,0.06)", border: "rgba(34,197,94,0.18)" },
              { tier: 4, label: "CURRENT", sublabel: "30 days", color: "rgba(251,146,60,0.85)", bg: "rgba(251,146,60,0.06)", border: "rgba(251,146,60,0.18)" },
              { tier: 5, label: "FLEETING", sublabel: "7 days", color: "rgba(148,163,184,0.7)", bg: "rgba(148,163,184,0.04)", border: "rgba(148,163,184,0.15)" },
            ];

            let parsed: { v: number; entries: { tier: number; text: string; createdAt: string; retrievalCount: number }[] } | null = null;
            try { parsed = memory ? JSON.parse(memory) : null; } catch { parsed = null; }

            if (!parsed?.entries?.length) {
              return (
                <div style={{ padding: "48px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "var(--atlas-muted)", opacity: 0.4, lineHeight: 1.7, fontFamily: "var(--app-font-mono)" }}>
                    Nothing here yet.<br />Atlas builds memory as you work.
                  </div>
                </div>
              );
            }

            const totalCount = parsed.entries.length;

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.45, letterSpacing: "0.08em", paddingBottom: 4, borderBottom: "1px solid var(--atlas-border)" }}>
                  {totalCount} MEMORY {totalCount === 1 ? "ENTRY" : "ENTRIES"} ACROSS {tierConfig.filter(t => parsed!.entries.some(e => e.tier === t.tier)).length} TIERS
                </div>
                {tierConfig.map(({ tier, label, sublabel, color, bg, border }) => {
                  const entries = parsed!.entries.filter(e => e.tier === tier);
                  if (entries.length === 0) return null;
                  return (
                    <div key={tier} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", color, fontWeight: 600 }}>T{tier} · {label}</span>
                        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.4 }}>{sublabel}</span>
                        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color, opacity: 0.5, marginLeft: "auto" }}>{entries.length}</span>
                      </div>
                      {entries.map((entry, i) => (
                        <div key={i} style={{ padding: "7px 10px", borderRadius: 6, background: bg, border: `1px solid ${border}`, fontSize: 11, color: "var(--atlas-fg)", lineHeight: 1.55, fontFamily: "var(--app-font-mono)", opacity: 0.85 }}>
                          {entry.text}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()
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
            background: "var(--atlas-glass-bg)", border: "1px solid var(--atlas-border)",
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
              ? "rgba(var(--atlas-muted-rgb),0.15)"
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
          <MapSection label="Components" items={scan.components || []} color="var(--atlas-fg)" />
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
  if (host.includes("axiomsystem")) return "Axiom";
  if (host.includes("lovable")) return "LOVABLE";
  if (host.includes("replit") || host.includes("repl.co") || host.includes("replit.app")) return "REPLIT";
  if (host.includes("cursor")) return "CURSOR";
  if (host.includes("vercel")) return "VERCEL";
  if (host.includes("netlify")) return "NETLIFY";
  if (host.includes("localhost") || host.includes("127.0.0.1")) return "LOCAL";
  return "WEB";
}

// ── SystemMapWithCockpit ────────────────────────────────────────────────────
function SystemMapWithCockpit({ projectId, onHomeNav, onSendIntent, onFillIntent, onBackToChat, onMapReadinessChange, displayedReadinessScore, onSystemNodeMessage, onHandover, handoverPending, lastHandoverHash, resolvedNodeIds, onResolvedConsumed, onSnapshotChange, handoverOpen, onHandoverOpenChange, isMobile, onOpenForge, externalForgeNodes, onForgeNodesConsumed, onForgeCompleted }: { projectId?: number; onHomeNav: () => void; onSendIntent?: (text: string) => void; onFillIntent?: (text: string) => void; onBackToChat?: () => void; onMapReadinessChange?: (score: number) => void; displayedReadinessScore?: number; onSystemNodeMessage?: (text: string) => void; onHandover?: (payload: { snapshot: HandoverSnapshot; title: string }) => void; handoverPending?: boolean; lastHandoverHash?: string | null; resolvedNodeIds?: string[]; onResolvedConsumed?: () => void; onSnapshotChange?: (s: HandoverSnapshot | null) => void; handoverOpen?: boolean; onHandoverOpenChange?: (open: boolean) => void; isMobile?: boolean; onOpenForge?: () => void; externalForgeNodes?: ArchNode[]; onForgeNodesConsumed?: () => void; onForgeCompleted?: () => void }) {
  const [readinessScore, setReadinessScore] = useState(0);
  useEffect(() => { onMapReadinessChange?.(readinessScore); }, [readinessScore, onMapReadinessChange]);

  // Consume nodes pushed from the external Forge button into the canvas
  useEffect(() => {
    if (externalForgeNodes && externalForgeNodes.length > 0) {
      setPendingNodes(externalForgeNodes);
      onForgeNodesConsumed?.();
    }
  }, [externalForgeNodes, onForgeNodesConsumed]);
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

  const [flowChatTab, setFlowChatTab] = useState<"flow" | "intent">("flow");
  const [flowMessages, setFlowMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [flowAttachedFiles, setFlowAttachedFiles] = useState<File[]>([]);
  const flowFileInputRef = useRef<HTMLInputElement>(null);
  const [chatFullscreen, setChatFullscreen] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const [flowInput, setFlowInput] = useState("");
  const flowScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (sentFlashTimerRef.current) clearTimeout(sentFlashTimerRef.current); }, []);

  useEffect(() => {
    if (flowScrollRef.current) {
      flowScrollRef.current.scrollTop = flowScrollRef.current.scrollHeight;
    }
  }, [flowMessages, flowLoading]);

  const sendFlowMessage = useCallback(async (text: string) => {
    if (!text.trim() || flowLoading) return;
    const files = flowAttachedFiles;
    setFlowAttachedFiles([]);
    const imageFile = files.find(f => f.type.startsWith("image/"));
    const otherFiles = files.filter(f => f !== imageFile);
    const suffix = otherFiles.length > 0 ? `\n[Attached: ${otherFiles.map(f => f.name).join(", ")}]` : "";
    const fullText = text + suffix;
    setFlowMessages(prev => [...prev, { role: "user", content: fullText }]);
    setFlowInput("");
    setFlowLoading(true);
    try {
      const nodeContext = nodes.length > 0
        ? `Current canvas nodes:\n${nodes.map(n => `- [${n.type}] ${n.label}${n.strategicAnswer ? " (answered)" : " (unanswered)"}`).join("\n")}`
        : "Canvas is empty — no nodes yet.";
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectId,
          message: fullText,
          flowMode: true,
          flowNodes: nodes,
          history: flowMessages.map(m => ({ role: m.role, content: m.content })),
          projectMap: nodeContext,
          mode: "plan",
          ...(imageFile ? await fileToBase64Safe(imageFile).then(r => ({ imageBase64: r.base64, imageMediaType: r.mediaType })).catch(() => ({ imageBase64: "", imageMediaType: "" })) : {}),
        }),
      }).then(r => r.ok ? r.json() : Promise.reject(r.status));
      const incoming = (res.flowNodes ?? []) as ArchNode[];
      setFlowMessages(prev => [...prev, { role: "assistant", content: res.content ?? "" }]);
      if (incoming.length > 0) setPendingNodes(incoming);
    } catch (error) {
      void reportError(error, { projectId });
      setFlowMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Try again." }]);
    } finally {
      setFlowLoading(false);
    }
  }, [flowMessages, flowAttachedFiles, flowLoading, nodes, projectId]);

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
  const themeMode = useThemeMode();
  const { data: activeProject } = useGetProject(projectId ?? 0, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId ?? 0) },
  });
  const activeProjectName = activeProject?.name;
  const updateProject = useUpdateProject();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodesChange = useCallback((updatedNodes: ArchNode[]) => {
    setNodes(updatedNodes);
    if (!projectId) return;
    // New shape: per-node object with display metadata plus resolution state.
    // The DB column is jsonb so this is non-breaking; AxiomFlow's hydration
    // handler still tolerates the legacy boolean shape on read.
    const axiomState: Record<string, {
      resolved: boolean;
      strategicAnswer?: string;
      label: string;
      type: ArchNode["type"];
      x: number;
      y: number;
      details?: string;
      meta?: ArchNode["meta"];
      moscow?: ArchNode["moscow"];
      question?: string;
    }> = {};
    updatedNodes.forEach(n => {
      axiomState[n.id] = {
        resolved: n.resolved,
        ...(n.strategicAnswer ? { strategicAnswer: n.strategicAnswer } : {}),
        label: n.label,
        type: n.type,
        x: n.x,
        y: n.y,
        ...(n.details ? { details: n.details } : {}),
        ...(n.meta ? { meta: n.meta } : {}),
        ...(n.moscow ? { moscow: n.moscow } : {}),
        ...(n.question ? { question: n.question } : {}),
      };
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
        background: "linear-gradient(to right, transparent 0%, rgba(var(--atlas-gold-rgb),0.18) 20%, rgba(var(--atlas-gold-rgb),0.38) 50%, rgba(var(--atlas-gold-rgb),0.18) 80%, transparent 100%)",
      }} />

      {/* Map area — Axiom Flow (strategic) + System Map (architecture readiness)
          When intent capture is visible, cap at 54% so the input section always
          has enough room on every phone size. */}
      <div style={{ position: "relative", flex: chatFullscreen ? "0 0 0" : showChat ? "0 0 auto" : 1, height: chatFullscreen ? 0 : showChat ? "min(54%, calc(100% - 316px))" : undefined, minHeight: chatFullscreen ? 0 : showChat ? 200 : 0, overflow: "hidden", display: "flex", flexDirection: "column", transition: "flex 350ms ease" }}>
        {/* Axiom Flow canvas */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
          {/* Empty map nudge — show Forge prompt when canvas has no nodes yet */}
          {nodes.length === 0 && onOpenForge && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10, pointerEvents: "none" }}>
              <button
                onClick={onOpenForge}
                aria-label="Open Forge"
                style={{
                  pointerEvents: "auto", display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 6,
                  padding: "14px 20px", borderRadius: 12, cursor: "pointer",
                  background: "rgba(var(--atlas-gold-rgb),0.06)",
                  border: "1px dashed rgba(var(--atlas-gold-rgb),0.3)",
                  color: "rgba(var(--atlas-gold-rgb),0.6)",
                  backdropFilter: "blur(4px)",
                  transition: "all 200ms ease",
                }}
              >
                <svg width={18} height={18} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                  <path d="M9 2L3 8.5l2.5 2.5L12 4.5 9 2z" />
                  <path d="M5.5 11L2 14.5" />
                  <path d="M11 3.5L13 5.5" />
                </svg>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase" as const }}>
                  Forge — populate from a transcript
                </span>
              </button>
            </div>
          )}
          <AxiomFlow
            projectId={projectId}
            onReadinessChange={setReadinessScore}
            onNodesChange={handleNodesChange}
            compact
            onBackToChat={onBackToChat}
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
            borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.12)",
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

      {/* Toggle bar — map / chat fullscreen controls */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "4px 12px",
        background: "var(--atlas-flow-pane-bg)",
        borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.08)",
        flexShrink: 0,
      }}>
        <span style={{
          color: "rgba(var(--atlas-gold-rgb),0.35)", fontSize: 10,
          fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
          userSelect: "none",
        }}>
          {chatFullscreen ? "flow chat" : showChat ? "intent capture" : "map fullscreen"}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {/* Map fullscreen button */}
          <button
            onClick={() => { setChatFullscreen(false); setShowChat(v => !v); }}
            style={{
              background: "rgba(var(--atlas-gold-rgb),0.07)", border: "1px solid rgba(var(--atlas-gold-rgb),0.28)",
              borderRadius: 5, padding: "2px 9px", cursor: "pointer",
              color: "rgba(var(--atlas-gold-rgb),0.78)", fontSize: 9,
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
            }}>
            {showChat ? "⛶ Map full" : "⊠ Show both"}
          </button>
          {/* Chat fullscreen button — only when chat is visible */}
          {showChat && (
            <button
              onClick={() => setChatFullscreen(v => !v)}
              style={{
                background: chatFullscreen ? "rgba(var(--atlas-gold-rgb),0.14)" : "rgba(var(--atlas-gold-rgb),0.07)",
                border: `1px solid ${chatFullscreen ? "rgba(var(--atlas-gold-rgb),0.5)" : "rgba(var(--atlas-gold-rgb),0.28)"}`,
                borderRadius: 5, padding: "2px 9px", cursor: "pointer",
                color: "rgba(var(--atlas-gold-rgb),0.78)", fontSize: 9,
                fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em",
              }}>
              {chatFullscreen ? "⊠ Show map" : "⛶ Chat full"}
            </button>
          )}
        </div>
      </div>

      {/* INTENT CAPTURE */}
      {showChat && (
        <div style={{ flex: 1, minHeight: 190, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--atlas-flow-pane-bg)" }}>
          <style>{`@keyframes intent-dot-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.6;transform:scale(.85)}}`}</style>

          {/* Tab switcher — FLOW CHAT | INTENT */}
          <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "5px 14px 4px", flexShrink: 0, borderBottom: "1px solid rgba(var(--atlas-gold-rgb),0.08)" }}>
            <button
              onClick={() => setFlowChatTab("flow")}
              style={{
                background: flowChatTab === "flow" ? "rgba(var(--atlas-gold-rgb),0.12)" : "transparent",
                border: "none", borderBottom: flowChatTab === "flow" ? "2px solid rgba(var(--atlas-gold-rgb),0.7)" : "2px solid transparent",
                padding: "3px 10px 4px", cursor: "pointer",
                color: flowChatTab === "flow" ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.55)",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                fontFamily: "var(--app-font-mono)", textTransform: "uppercase",
                transition: "all 180ms ease",
              }}
            >⬡ Flow Chat</button>
            <button
              onClick={() => setFlowChatTab("intent")}
              style={{
                background: flowChatTab === "intent" ? "rgba(var(--atlas-gold-rgb),0.12)" : "transparent",
                border: "none", borderBottom: flowChatTab === "intent" ? "2px solid rgba(var(--atlas-gold-rgb),0.7)" : "2px solid transparent",
                padding: "3px 10px 4px", cursor: "pointer",
                color: flowChatTab === "intent" ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.55)",
                fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                fontFamily: "var(--app-font-mono)", textTransform: "uppercase",
                transition: "all 180ms ease",
              }}
            >Intent</button>
          </div>

          {/* FLOW CHAT — Atlas drives the canvas */}
          {flowChatTab === "flow" && (
            <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", padding: "0 14px 10px" }}>
              {/* Message list */}
              <div
                ref={flowScrollRef}
                style={{
                  flex: 1, minHeight: 0, overflowY: "auto",
                  padding: "8px 0 4px",
                  display: "flex", flexDirection: "column", gap: 8,
                }}
              >
                {flowMessages.length === 0 && (
                  <div style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    height: "100%", gap: 6, opacity: 0.45,
                  }}>
                    <span style={{ fontSize: 18 }}>⬡</span>
                    <span style={{ fontSize: 10, color: "rgba(var(--atlas-muted-rgb),0.8)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textAlign: "center", lineHeight: 1.5 }}>
                      Talk to Atlas.<br />Nodes appear on the canvas as you plan.
                    </span>
                  </div>
                )}
                {flowMessages.map((m, i) => (
                  <div key={i} style={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "86%",
                    background: m.role === "user"
                      ? "rgba(var(--atlas-gold-rgb),0.12)"
                      : "var(--atlas-surface)",
                    border: m.role === "user"
                      ? "1px solid rgba(var(--atlas-gold-rgb),0.28)"
                      : "1px solid rgba(var(--atlas-gold-rgb),0.10)",
                    borderRadius: m.role === "user" ? "10px 10px 2px 10px" : "10px 10px 10px 2px",
                    padding: "7px 10px",
                    fontSize: 12, lineHeight: 1.55,
                    color: m.role === "user" ? "#E7E5E4" : "var(--atlas-fg)",
                    fontFamily: "inherit",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {m.content}
                  </div>
                ))}
                {flowLoading && (
                  <div style={{
                    alignSelf: "flex-start",
                    background: "var(--atlas-surface)",
                    border: "1px solid rgba(var(--atlas-gold-rgb),0.10)",
                    borderRadius: "10px 10px 10px 2px",
                    padding: "8px 12px",
                    display: "flex", gap: 4, alignItems: "center",
                  }}>
                    {[0, 1, 2].map(d => (
                      <div key={d} style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: "rgba(var(--atlas-gold-rgb),0.6)",
                        animation: `intent-dot-pulse 1.2s ease-in-out ${d * 0.2}s infinite`,
                      }} />
                    ))}
                  </div>
                )}
              </div>

              {/* Hidden file input for Flow Chat */}
              <input
                ref={flowFileInputRef}
                type="file"
                multiple
                accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.txt,.md,.csv,.json,.js,.ts,.tsx,.jsx"
                style={{ display: "none" }}
                onChange={(e) => {
                  const incoming = Array.from(e.target.files ?? []).slice(0, 10);
                  setFlowAttachedFiles(prev => [...prev, ...incoming].slice(0, 10));
                  e.target.value = "";
                }}
              />

              {/* Flow Chat attachment preview strip */}
              {flowAttachedFiles.length > 0 && (
                <div style={{ display: "flex", gap: 5, marginBottom: 6, overflowX: "auto", paddingBottom: 2, flexShrink: 0 }}>
                  {flowAttachedFiles.map((file, idx) => (
                    <div key={idx} style={{ position: "relative", flexShrink: 0 }}>
                      {file.type.startsWith("image/") ? (
                        <img src={URL.createObjectURL(file)} alt={file.name} style={{ width: 46, height: 46, borderRadius: 6, objectFit: "cover", border: "1px solid rgba(var(--atlas-gold-rgb),0.25)", display: "block" }} />
                      ) : (
                        <div style={{ width: 46, height: 46, borderRadius: 6, background: "rgba(var(--atlas-gold-rgb),0.07)", border: "1px solid rgba(var(--atlas-gold-rgb),0.2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, overflow: "hidden" }}>
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(var(--atlas-gold-rgb),0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          <span style={{ fontSize: 7, color: "rgba(var(--atlas-gold-rgb),0.55)", maxWidth: 40, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-mono)" }}>{file.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
                        </div>
                      )}
                      <button onClick={() => setFlowAttachedFiles(prev => prev.filter((_, i) => i !== idx))} aria-label="Remove attachment" style={{ position: "absolute", top: -4, right: -4, minWidth: 44, minHeight: 44, borderRadius: "50%", background: "var(--atlas-bg)", border: "1px solid rgba(var(--atlas-gold-rgb),0.3)", cursor: "pointer", color: "var(--atlas-fg)", fontSize: 9, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, zIndex: 1 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input row */}
              <div style={{
                display: "flex", gap: 6, alignItems: "flex-end",
                paddingTop: 6, borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.07)",
                flexShrink: 0,
              }}>
                {/* Paperclip button */}
                <button
                  onClick={() => flowFileInputRef.current?.click()}
                  title="Attach file"
                  aria-label="Attach file"
                  style={{
                    minWidth: 44, minHeight: 44, padding: 8, flexShrink: 0, borderRadius: 7,
                    background: "transparent", border: "none",
                    color: flowAttachedFiles.length > 0 ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.4)",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "color 160ms ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = "var(--atlas-gold)")}
                  onMouseLeave={e => { if (!flowAttachedFiles.length) e.currentTarget.style.color = "rgba(var(--atlas-muted-rgb),0.4)"; }}
                >
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <textarea
                  value={flowInput}
                  onChange={e => setFlowInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendFlowMessage(flowInput); }
                  }}
                  placeholder="What are you building? Atlas will map it..."
                  rows={2}
                  disabled={flowLoading}
                  style={{
                    flex: 1, resize: "none", background: "var(--atlas-surface)",
                    border: "1px solid rgba(var(--atlas-gold-rgb),0.20)", borderRadius: 8,
                    padding: "7px 10px", color: "var(--atlas-fg)", fontSize: 12,
                    lineHeight: 1.5, fontFamily: "inherit", outline: "none",
                    opacity: flowLoading ? 0.6 : 1,
                  }}
                />
                <button
                  onClick={() => sendFlowMessage(flowInput)}
                  disabled={!flowInput.trim() || flowLoading}
                  aria-label="Send message"
                  style={{
                    minWidth: 44, minHeight: 44, padding: 6, flexShrink: 0, borderRadius: 8,
                    background: flowInput.trim() && !flowLoading ? "rgba(var(--atlas-gold-rgb),0.18)" : "transparent",
                    border: `1px solid ${flowInput.trim() && !flowLoading ? "rgba(var(--atlas-gold-rgb),0.45)" : "rgba(var(--atlas-muted-rgb),0.2)"}`,
                    cursor: flowInput.trim() && !flowLoading ? "pointer" : "not-allowed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: flowInput.trim() && !flowLoading ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.3)",
                    transition: "all 180ms ease",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Intent capture — prompt card */}
          {flowChatTab === "intent" && (
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "0 14px 12px" }}>
            <div style={{
              height: "100%", display: "flex", flexDirection: "column",
              background: "rgba(var(--atlas-surface-rgb),0.92)",
              border: "1px solid rgba(var(--atlas-gold-rgb),0.16)",
              borderRadius: 12, overflow: "hidden",
            }}>
              {/* Card header — platform badge + signal selector + add button, all in one row */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 10px 6px",
                borderBottom: "1px solid rgba(var(--atlas-gold-rgb),0.07)",
                flexShrink: 0,
              }}>
                {/* Platform badge — translucent pill, color keyed to detected system */}
                {(() => {
                  const p = platform.toLowerCase();
                  const isReplit  = p === "replit";
                  const isCursor  = p === "cursor";
                  const isLovable = p === "lovable";
                  const isParchment = themeMode === "parchment";
                  const color  = isReplit  ? (isParchment ? "oklch(0.42 0.16 150)" : "oklch(0.74 0.18 150)")
                               : isCursor  ? (isParchment ? "oklch(0.42 0.16 240)" : "oklch(0.74 0.18 240)")
                               : isLovable ? (isParchment ? "oklch(0.42 0.18 300)" : "oklch(0.74 0.20 300)")
                               : "rgba(var(--atlas-gold-rgb),0.78)";
                  const bg     = isReplit  ? (isParchment ? "oklch(0.88 0.08 150 / 55%)" : "oklch(0.28 0.12 150 / 28%)")
                               : isCursor  ? (isParchment ? "oklch(0.88 0.08 240 / 55%)" : "oklch(0.28 0.12 240 / 28%)")
                               : isLovable ? (isParchment ? "oklch(0.88 0.10 300 / 55%)" : "oklch(0.28 0.12 300 / 28%)")
                               : "rgba(var(--atlas-gold-rgb),0.10)";
                  const border = isReplit  ? (isParchment ? "oklch(0.50 0.16 150 / 60%)" : "oklch(0.55 0.18 150 / 50%)")
                               : isCursor  ? (isParchment ? "oklch(0.50 0.16 240 / 60%)" : "oklch(0.55 0.18 240 / 50%)")
                               : isLovable ? (isParchment ? "oklch(0.50 0.18 300 / 60%)" : "oklch(0.55 0.20 300 / 50%)")
                               : "rgba(var(--atlas-gold-rgb),0.30)";
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
                    border: "1px solid rgba(var(--atlas-gold-rgb),0.13)",
                    borderRadius: 5, padding: "3px 6px",
                    color: "rgba(var(--atlas-gold-rgb),0.65)", fontSize: 9.5,
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
                    aria-label="Delete signal"
                    style={{
                      minWidth: 44, minHeight: 44, padding: 12, borderRadius: 4, flexShrink: 0,
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
                    background: signalAdded ? "rgba(var(--atlas-gold-rgb),0.22)" : "rgba(var(--atlas-gold-rgb),0.09)",
                    border: `1px solid ${signalAdded ? "rgba(var(--atlas-gold-rgb),0.7)" : "rgba(var(--atlas-gold-rgb),0.3)"}`,
                    borderRadius: 6, padding: "3px 9px", cursor: "pointer", flexShrink: 0,
                    color: "var(--atlas-gold)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em",
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
                borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.05)",
                flexShrink: 0,
              }}>
                <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.45)", padding: 4 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.45)", padding: 4 }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  </button>
                  <button
                    onClick={handleSend}
                    style={{
                      width: 30, height: 30, borderRadius: 8,
                      background: sentFlash ? "rgba(var(--atlas-gold-rgb),0.28)" : intent.trim() ? "rgba(var(--atlas-gold-rgb),0.14)" : "transparent",
                      border: `1px solid ${sentFlash ? "rgba(var(--atlas-gold-rgb),0.7)" : intent.trim() ? "rgba(var(--atlas-gold-rgb),0.38)" : "rgba(var(--atlas-muted-rgb),0.22)"}`,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: sentFlash ? "var(--atlas-gold)" : intent.trim() ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.32)",
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
          )}
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
          onNodesReady={(nodes) => { setPendingNodes(nodes); onForgeCompleted?.(); setShowQuickPrompt(false); }}
          onFillChatInput={onFillIntent}
        />
      )}

      <CockpitBar
        readinessScore={displayedReadinessScore ?? readinessScore}
        nodes={nodes}
        onHomeNav={onHomeNav}
        onAxiomOpen={() => setShowQuickPrompt(true)}
        navLeft={undefined}
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
                  ? "rgba(var(--atlas-muted-rgb),0.1)"
                  : "rgba(146,64,14,0.22)",
                border: `1px solid ${handoverPending ? "rgba(var(--atlas-muted-rgb),0.35)" : "rgba(146,64,14,0.65)"}`,
                color: handoverPending ? "rgba(var(--atlas-muted-rgb),0.7)" : "rgba(230,150,90,0.95)",
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
  onFillIntent,
  onBackToChat,
  isMobile,
  onMapReadinessChange,
  displayedReadinessScore,
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
  previewRefreshTrigger,
  pendingTerminalCommand,
  onTerminalCommandConsumed,
  onCommandComplete,
  wsLens,
  onOpenForge,
  externalForgeNodes,
  onForgeNodesConsumed,
  onForgeCompleted,
  sessionId,
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
  onFillIntent?: (text: string) => void;
  onBackToChat?: () => void;
  isMobile?: boolean;
  onMapReadinessChange?: (score: number) => void;
  displayedReadinessScore?: number;
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
  previewRefreshTrigger?: number;
  pendingTerminalCommand?: string | null;
  onTerminalCommandConsumed?: () => void;
  onCommandComplete?: (command: string, output: string, exitCode: number | null) => void;
  wsLens?: WorkspaceLens;
  onOpenForge?: () => void;
  externalForgeNodes?: ArchNode[];
  onForgeNodesConsumed?: () => void;
  onForgeCompleted?: () => void;
  sessionId?: number | null;
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
  const [ledgerSubTab, setLedgerSubTab] = useState<"entries" | "memory">("entries");

  useEffect(() => {
    if (forceTab) setTab(forceTab);
  }, [forceTab]);

  // Auto-fallback terminal tab when lens changes to one that hides it
  useEffect(() => {
    if (wsLens !== "build" && wsLens !== "scenario" && tab === "terminal") {
      setTab("ledger");
    }
  }, [wsLens, tab]);

  const tabs: { id: RightTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: "workbench",
      label: "Workbench",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="1" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="1" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <rect x="9" y="9" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      ),
    },
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
    ...(wsLens === "build" || wsLens === "scenario" ? [{
      id: "terminal" as RightTab,
      label: "Terminal",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 6l3 2.5L4 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      ),
    }] : []),
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
                    background: active ? "rgba(201,162,76,0.15)" : "rgba(var(--atlas-muted-rgb),0.15)",
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
            Mirrors the mobile footer pill in AxiomFlow. Opens Atlas home. */}
        {!isMobile && onHandover && (
          <>
            <div style={{ flex: 1 }} />
            <button
              onClick={onHomeNav}
              title="Open Atlas home"
              style={{
                marginRight: 8,
                padding: "5px 11px",
                borderRadius: 5,
                background: "rgba(146,64,14,0.22)",
                border: "1px solid rgba(146,64,14,0.65)",
                color: "rgba(230,150,90,0.95)",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9.5,
                fontWeight: 600,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                cursor: "pointer",
                transition: "all 160ms ease",
              }}
            >
              → Atlas
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
              aria-label={fullscreen ? "Collapse" : "Expand"}
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
            aria-label="Dismiss"
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
      {tab === "workbench" && <WorkbenchPanel projectId={projectId} sessionId={sessionId ?? undefined} />}
      {tab === "ledger" && (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Sub-tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0 }}>
            {(["entries", "memory"] as const).map(st => (
              <button
                key={st}
                onClick={() => setLedgerSubTab(st)}
                style={{
                  flex: 1, padding: "8px 0", background: "transparent", border: "none",
                  borderBottom: ledgerSubTab === st ? "2px solid var(--atlas-gold)" : "2px solid transparent",
                  fontSize: 10, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
                  textTransform: "uppercase" as const,
                  color: ledgerSubTab === st ? "var(--atlas-gold)" : "var(--atlas-muted)",
                  cursor: "pointer", transition: "all 160ms ease",
                }}
              >
                {st === "entries" ? "Ledger" : "Memory"}
              </button>
            ))}
          </div>
          {/* Sub-tab content */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {ledgerSubTab === "entries"
              ? <LedgerTab projectId={projectId} entries={entries} activeCatch={activeCatch} pushHistory={pushHistory} onRollbackPush={onRollbackPush} />
              : <MemoryTab projectId={projectId} />
            }
          </div>
        </div>
      )}
      {tab === "files" && <FilesTab projectId={projectId} onFileContext={onFileContext} onLinkedRepoChange={onLinkedRepoChange} />}
      {tab === "preview" && <PreviewTab projectId={projectId} sandboxCode={sandboxCode} onSandboxConsumed={onSandboxConsumed} refreshTrigger={previewRefreshTrigger} />}
      {tab === "memory" && <MemoryTab projectId={projectId} />}
      {tab === "map" && <SystemMapWithCockpit projectId={projectId} onHomeNav={onHomeNav} onSendIntent={onSendIntent} onFillIntent={onFillIntent} onBackToChat={onBackToChat} onMapReadinessChange={onMapReadinessChange} displayedReadinessScore={displayedReadinessScore} onSystemNodeMessage={onSystemNodeMessage} onHandover={onHandover} handoverPending={handoverPending} lastHandoverHash={lastHandoverHash} resolvedNodeIds={resolvedNodeIds} onResolvedConsumed={onResolvedConsumed} onSnapshotChange={onSnapshotChange} handoverOpen={handoverOpen} onHandoverOpenChange={onHandoverOpenChange} isMobile={isMobile} onOpenForge={onOpenForge} externalForgeNodes={externalForgeNodes} onForgeNodesConsumed={onForgeNodesConsumed} onForgeCompleted={onForgeCompleted} />}
      {tab === "terminal" && (wsLens === "build" || wsLens === "scenario") && <TerminalPanel pendingCommand={pendingTerminalCommand} onCommandConsumed={onTerminalCommandConsumed} onCommandComplete={onCommandComplete} scenarioLens={wsLens === "scenario"} />}
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
  activeTab: "chat" | "ledger" | "files" | "map" | "preview" | "workbench";
  onTabChange: (tab: "chat" | "ledger" | "files" | "map" | "preview" | "workbench") => void;
  entryCount: number;
  activeCatch: boolean;
}) {
  const [, navTo] = useLocation();
  const tabs: { id: "chat" | "ledger" | "files" | "map" | "preview" | "workbench"; label: string; icon: React.ReactNode; badge?: number; alert?: boolean }[] = [
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
      id: "workbench",
      label: "Workbench",
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="2" width="8" height="8" rx="1" />
          <rect x="14" y="2" width="8" height="8" rx="1" />
          <rect x="2" y="14" width="8" height="8" rx="1" />
          <rect x="14" y="14" width="8" height="8" rx="1" />
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
        background: "var(--atlas-surface)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.12)",
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
            onClick={() => { if (id === "map") { navTo("/map"); } else { onTabChange(id); } }}
            aria-label={id === "chat" ? "Open chat" : id === "ledger" ? "Open ledger" : id === "files" ? "Open files" : id === "preview" ? "Toggle preview" : id === "workbench" ? "Open workbench" : "Open map"}
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
              color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
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

function WorkspaceOnboardingCoach({
  isMobile,
  dismissed,
  onDismiss,
}: {
  isMobile: boolean;
  dismissed: Record<OnboardingCoachId, boolean>;
  onDismiss: (id: OnboardingCoachId) => void;
}) {
  const marks: Array<{ id: OnboardingCoachId; label: string; text: string }> = [
    { id: "chat", label: "Chat tab", text: "Talk to Atlas. Describe what you're building." },
    { id: "ledger", label: "Ledger tab", text: "Every decision you make gets logged here." },
    { id: "flow", label: "Flow tab", text: "Your thinking becomes a visual map." },
  ];
  const visibleMarks = marks.filter((mark) => !dismissed[mark.id]);
  if (visibleMarks.length === 0) return null;

  const placement: Record<OnboardingCoachId, React.CSSProperties> = isMobile
    ? {
        chat: { left: 8, bottom: 78, width: "30%" },
        ledger: { left: "35%", bottom: 78, width: "30%" },
        flow: { right: 8, bottom: 78, width: "30%" },
      }
    : {
        chat: { left: "6vw", bottom: 112, width: 260 },
        ledger: { right: 300, top: 94, width: 260 },
        flow: { right: 24, top: 94, width: 260 },
      };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 700, pointerEvents: "none" }}>
      <div style={{ position: "absolute", inset: 0, background: "var(--atlas-bg)", opacity: 0.72 }} />
      {visibleMarks.map((mark) => (
        <div
          key={mark.id}
          style={{
            position: "absolute",
            ...placement[mark.id],
            background: "var(--atlas-surface)",
            border: "1px solid var(--atlas-border)",
            borderRadius: 12,
            padding: isMobile ? "10px 9px" : "14px 15px",
            color: "var(--atlas-fg)",
            pointerEvents: "auto",
            boxSizing: "border-box",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: isMobile ? 9 : 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
              {mark.label}
            </span>
          </div>
          <p style={{ margin: 0, color: "var(--atlas-fg)", fontSize: isMobile ? 11 : 13, lineHeight: 1.45 }}>
            {mark.text}
          </p>
          <button
            type="button"
            onClick={() => onDismiss(mark.id)}
            style={{
              marginTop: 10,
              width: "100%",
              border: "1px solid var(--atlas-gold)",
              background: "var(--atlas-gold)",
              color: "var(--atlas-bg)",
              borderRadius: 999,
              padding: isMobile ? "7px 8px" : "8px 10px",
              fontSize: isMobile ? 9 : 10,
              fontWeight: 800,
              fontFamily: "var(--app-font-mono)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            Got it
          </button>
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: isMobile ? undefined : "100%",
              bottom: isMobile ? "100%" : undefined,
              width: 1,
              height: 18,
              background: "var(--atlas-gold)",
              opacity: 0.8,
            }}
          />
        </div>
      ))}
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
  const isTinyScreen = useIsTinyScreen();
  useRequireAuth();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [planStates, setPlanStates] = useState<Map<number, PlanState>>(() => new Map());
  const [planExecutions, setPlanExecutions] = useState<Map<number, PlanExecution>>(() => new Map());
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [activeCatch, setActiveCatch] = useState<CatchPayload | null>(null);

  // Reset all chat state when the project changes so old messages never bleed into a new workspace
  useEffect(() => {
    setMessages([]);
    setPlanStates(new Map());
    setPlanExecutions(new Map());
    setSessionId(null);
    setActiveCatch(null);
    priorLoaded.current = false;
    homePlanLoadedRef.current = false;
  }, [id]);
  const { playSend, playCatch, playCommit, playPark, playNavigate } = useSound();
  const [memoryChips, setMemoryChips] = useState<MemoryChip[]>([]);
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [leftTab, setLeftTab] = useState<"chat" | "diff" | "terminal">("chat");
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

  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [wsModel, setWsModel] = useState<string>(() => {
    try { const r = localStorage.getItem("atlas-home-context"); return r ? (JSON.parse(r).model ?? "claude") : "claude"; } catch { return "claude"; }
  });
  const [wsLens, setWsLensRaw] = useState<WorkspaceLens>(() => {
    try { return (localStorage.getItem(`atlas-ws-lens-v2-${id}`) as WorkspaceLens) || "flow"; } catch { return "flow"; }
  });
  const [showLensPicker, setShowLensPicker] = useState(false);
  const [detectedLens, setDetectedLens] = useState<WorkspaceLens | null>(null);
  const scenarioStartIdxRef = useRef<number>(-1);
  const [showScenarioPrompt, setShowScenarioPrompt] = useState(false);
  const sendCtxRef = useRef({ wsLens: "flow" as WorkspaceLens, wsModel: "claude" });
  const [pendingLensSwitch, setPendingLensSwitch] = useState<WorkspaceLens | null>(null);
  const [scenarioBuffer, setScenarioBuffer] = useState<Array<{ role: string; content: string }>>([]);
  const [showWsModelSheet, setShowWsModelSheet] = useState(false);
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [showSrcPicker, setShowSrcPicker] = useState(false);
  const [srcReadLoading, setSrcReadLoading] = useState(false);
  const [showDeepDiveMenu, setShowDeepDiveMenu] = useState(false);
  const [deepDiveCopied, setDeepDiveCopied] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [switchToExpanded, setSwitchToExpanded] = useState(false);
  const [switchProjectDeleteId, setSwitchProjectDeleteId] = useState<number | null>(null);
  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);
  // Close portaled header dropdowns on scroll/resize so they don't float off their anchors.
  useEffect(() => {
    if (!showProjectMenu) return;
    const close = () => { setShowProjectMenu(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [showProjectMenu]);

  const setWsLens = useCallback((newLens: WorkspaceLens) => {
    const currentMessages = messages;
    if (wsLens === "scenario" && scenarioStartIdxRef.current >= 0 && currentMessages.length > scenarioStartIdxRef.current) {
      setPendingLensSwitch(newLens);
      setShowScenarioPrompt(true);
      return;
    }
    setWsLensRaw(newLens);
    setDetectedLens(null);
    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, newLens); } catch {}
    if (newLens === "scenario") {
      scenarioStartIdxRef.current = currentMessages.length;
    } else {
      scenarioStartIdxRef.current = -1;
    }
    const cfg = LENS_CONFIG[newLens];
    if (cfg.model) setWsModel(cfg.model);
    setShowLensPicker(false);
  }, [wsLens, messages, id]);

  // Warn on page-leave if an unsaved scenario is in progress
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (wsLens === "scenario" && scenarioStartIdxRef.current >= 0) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [wsLens]);

  // Auto-fallback terminal tab when switching to lenses that don't support it
  useEffect(() => {
    if (wsLens !== "build" && wsLens !== "scenario" && leftTab === "terminal") {
      setLeftTab("chat");
    }
  }, [wsLens, leftTab]);

  const [mobileTab, setMobileTab] = useState<"chat" | "ledger" | "files" | "map" | "preview" | "workbench">(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : "chat"
  );
  const [onboardingCoachVisible, setOnboardingCoachVisible] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get("onboarding") === "true"
        && !localStorage.getItem("axiom_onboarding_complete");
    } catch {
      return false;
    }
  });
  const [onboardingCoachDismissed, setOnboardingCoachDismissed] = useState<Record<OnboardingCoachId, boolean>>({
    chat: false,
    ledger: false,
    flow: false,
  });
  const [showDrawer, setShowDrawer] = useState(false);
  const [showVault, setShowVault] = useState(false);
  const [showForgeExternal, setShowForgeExternal] = useState(false);
  const [forgePreloadContent, setForgePreloadContent] = useState<string | undefined>(undefined);
  const [externalForgeNodes, setExternalForgeNodes] = useState<ArchNode[]>([]);
  const [forgeState, setForgeState] = useState<ForgeState | null>(null);
  const [forgeContext, setForgeContext] = useState<string | null>(() => {
    try { return sessionStorage.getItem(`atlas-forge-ctx-${id}`) ?? null; } catch { return null; }
  });
  // Reload per-project forge state when project ID changes — prevents cross-project state contamination
  useEffect(() => {
    try { setForgeContext(sessionStorage.getItem(`atlas-forge-ctx-${id}`) ?? null); } catch { setForgeContext(null); }
  }, [id]);
  // Explicit state captured at pill-open time so TheForge always gets a stable context snapshot
  const [forgeActiveProjectName, setForgeActiveProjectName] = useState<string | undefined>(undefined);
  const [forgeActiveProjectId, setForgeActiveProjectId] = useState<number | undefined>(undefined);
  const [autoNameKey, setAutoNameKey] = useState(0);
  const [firstRunDismissed, setFirstRunDismissed] = useState(false);
  const [firstRunInput, setFirstRunInput] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [trustMode, setTrustMode] = useState<"review" | "auto">("review");
  const [agenticMode, setAgenticMode] = useState(true);
  const [agenticIterCount, setAgenticIterCount] = useState(0);
  const [autoRunCmd] = useState<string>("");
  const [previewRefreshTrigger, setPreviewRefreshTrigger] = useState(0);

  const importSource = (() => {
    try { return new URLSearchParams(window.location.search).get("source") ?? null; } catch { return null; }
  })();
  const isHomeHandoff = importSource === "home-handoff";
  const [homeHandoffMeta, setHomeHandoffMeta] = useState<HomeHandoffMeta | null>(() => {
    try {
      const raw = sessionStorage.getItem(`atlas-home-handoff-${id}`);
      return raw ? JSON.parse(raw) as HomeHandoffMeta : null;
    } catch { return null; }
  });
  const [showHomeHandoffBanner, setShowHomeHandoffBanner] = useState(() => {
    try { return isHomeHandoff && sessionStorage.getItem(`atlas-home-handoff-banner-${id}`) !== "1"; } catch { return isHomeHandoff; }
  });
  const [showHomeHandoffDrawer, setShowHomeHandoffDrawer] = useState(false);
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

  useEffect(() => {
    if (!isHomeHandoff) return;
    let meta = homeHandoffMeta;
    if (!meta) {
      try {
        const raw = sessionStorage.getItem(`atlas-home-handoff-${id}`);
        meta = raw ? JSON.parse(raw) as HomeHandoffMeta : null;
        setHomeHandoffMeta(meta);
      } catch {}
    }
    try { sessionStorage.setItem(`atlas-home-handoff-banner-${id}`, "1"); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isHomeHandoff]);

  useEffect(() => {
    if (!showHomeHandoffBanner || showHomeHandoffDrawer) return;
    const timer = setTimeout(() => setShowHomeHandoffBanner(false), 4000);
    return () => clearTimeout(timer);
  }, [showHomeHandoffBanner, showHomeHandoffDrawer]);

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    try { sessionStorage.setItem("atlas-active-project-id", String(id)); } catch {}
  }, [id]);

  const dismissOnboardingCoach = useCallback((markId: OnboardingCoachId) => {
    setOnboardingCoachDismissed((prev) => {
      const next = { ...prev, [markId]: true };
      if (next.chat && next.ledger && next.flow) {
        setOnboardingCoachVisible(false);
        try {
          localStorage.setItem("axiom_onboarding_complete", "true");
          const url = new URL(window.location.href);
          url.searchParams.delete("onboarding");
          window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
        } catch {}
      }
      return next;
    });
  }, []);

  // Spec → Build handoff modal state
  const [showHandoffModal, setShowHandoffModal] = useState(false);
  const [handoffSelected, setHandoffSelected] = useState<Set<number>>(new Set());


  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameEscapeRef = useRef(false);
  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [cloningProject, setCloningProject] = useState(false);
  const updateProjectHeader = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();
  const createProjectMutation = useCreateProject();

  const handleDeleteProjectFromSwitcher = useCallback((projectToDeleteId: number) => {
    deleteProjectMutation.mutate({ id: projectToDeleteId }, {
      onSuccess: () => {
        queryClient.setQueryData(getListProjectsQueryKey(), (current: unknown) => (
          Array.isArray(current) ? current.filter((p: any) => p?.id !== projectToDeleteId) : current
        ));
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setSwitchProjectDeleteId(null);
        if (projectToDeleteId === id) {
          setShowProjectMenu(false);
          setLocation("/home");
        }
      },
      onError: () => {
        toast.error("Project could not be deleted.");
      },
    });
  }, [deleteProjectMutation, id, queryClient, setLocation]);

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
  const [activityStream, setActivityStream] = useState<{ active: boolean; content: string }>({ active: false, content: "" });
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
  const chatPanelScrollRef = useRef<HTMLDivElement>(null);
  const [showWsScrollBtn, setShowWsScrollBtn] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const initialSent = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const importPrimed = useRef(false);
  const touchStartX = useRef(0);
  const homeHandoffDbLoadedRef = useRef<number | null>(null);
  const homePlanLoadedRef = useRef(false);

  const { data: allProjects } = useListProjects();
  const { data: project, isLoading: projectLoading } = useGetProject(id, { query: { enabled: !!id, queryKey: getGetProjectQueryKey(id) } });
  // True when forge has run this session OR when saved AxiomFlow nodes exist for this project
  const hasForgeNodes = forgeContext !== null ||
    Object.keys((project?.nodeState ?? {}) as Record<string, unknown>)
      .some(k => !["auth", "db", "api", "state", "ui", "logic"].includes(k));
  const isBrandNewProject = messages.length === 0 && !hasForgeNodes;

  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const controller = new AbortController();
    setForgeState(null);
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${id}/forge-state`, { credentials: "include", signal: controller.signal });
        if (!res.ok) throw new Error(`Forge state failed: HTTP ${res.status}`);
        const data = await res.json() as ForgeState;
        setForgeState({ forged: !!data.forged, dismissed: !!data.dismissed });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        void reportError(error, { projectId: id });
        setForgeState({ forged: hasForgeNodes, dismissed: false });
      }
    })();
    return () => controller.abort();
  }, [id, hasForgeNodes]);

  const updateForgeState = useCallback(async (action: "forged" | "dismissed") => {
    if (!Number.isFinite(id)) return;
    try {
      const res = await fetch(`/api/projects/${id}/forge-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`Forge state update failed: HTTP ${res.status}`);
      const data = await res.json() as { forgedAt?: string | null; dismissedAt?: string | null; forged?: boolean; dismissed?: boolean };
      setForgeState({
        forged: action === "forged" || !!data.forgedAt || !!data.forged,
        dismissed: action === "dismissed" || !!data.dismissedAt || !!data.dismissed,
      });
    } catch (error) {
      void reportError(error, { projectId: id });
      setForgeState((prev) => ({
        forged: action === "forged" ? true : prev?.forged ?? hasForgeNodes,
        dismissed: action === "dismissed" ? true : prev?.dismissed ?? false,
      }));
    }
  }, [hasForgeNodes, id]);

  const { data: sessions, isLoading: sessionsLoading } = useListSessions(id, {
    query: { enabled: !!id, queryKey: getListSessionsQueryKey(id) },
  });
  const { data: entries } = useListEntries(id, {}, { query: { enabled: !!id, queryKey: getListEntriesQueryKey(id, {}) } });
  const createSession = useCreateSession();
  const createEntry = useCreateEntry();
  const [parkedEntries, setParkedEntries] = useState<Entry[]>([]);
  const [showParkingDrawer, setShowParkingDrawer] = useState(false);

  const refreshParkedEntries = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${id}/entries?status=parked`);
      if (!res.ok) return;
      const data = await res.json() as Entry[];
      setParkedEntries(data);
    } catch {
      // Parking lot count is ambient UI; never interrupt chat if it fails.
    }
  }, [id]);

  useEffect(() => {
    void refreshParkedEntries();
  }, [refreshParkedEntries]);

  useEffect(() => {
    void refreshParkedEntries();
  }, [entries?.length, refreshParkedEntries]);

  const homeHandoffNodes = useMemo<HomeHandoffNode[]>(() => {
    if (homeHandoffMeta?.nodes?.length) return homeHandoffMeta.nodes;
    try {
      const raw = localStorage.getItem(`axiom-flow-nodes-${id}`);
      const stored = raw ? JSON.parse(raw) as HomeHandoffNode[] : [];
      return stored
        .filter((node) => node && typeof node.label === "string" && typeof node.type === "string")
        .map((node) => ({
          id: node.id,
          label: node.label,
          type: node.type,
          details: node.details,
          meta: node.meta,
          moscow: node.moscow,
        }));
    } catch {
      return [];
    }
  }, [homeHandoffMeta, id]);

  const homeHandoffParkedTitles = useMemo(() => {
    if (homeHandoffMeta?.parkedTitles?.length) return homeHandoffMeta.parkedTitles;
    return parkedEntries.flatMap((entry) => entry.title ? [entry.title] : []);
  }, [homeHandoffMeta, parkedEntries]);

  const handlePushAll = useCallback(async (fileEdits: FileEdit[]) => {
    if (!linkedRepo) return;
    const token = project?.githubToken ?? null;
    if (!token) return;
    const today = new Date().toISOString().slice(0, 10);
    const branch = `atlas/auto-${today}-${Date.now().toString(36).slice(-4)}`;
    try {
      await fetch("/api/github/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-github-token": token },
        body: JSON.stringify({ repo: linkedRepo.fullName, branch, baseBranch: linkedRepo.defaultBranch }),
      });
      for (let i = 0; i < fileEdits.length; i++) {
        const fe = fileEdits[i];
        await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-github-token": token },
          body: JSON.stringify({
            repo: linkedRepo.fullName, branch, path: fe.path, content: fe.content,
            message: fileEdits.length === 1
              ? `Atlas: update ${fe.path.split("/").pop()}`
              : `Atlas: update ${fileEdits.length} files (${i + 1}/${fileEdits.length})`,
          }),
        });
      }
      toast.success(`AUTO: pushed ${fileEdits.length} file${fileEdits.length > 1 ? "s" : ""} to ${branch}`);
      if (autoRunCmd.trim()) {
        try {
          const termRes = await fetch("/api/terminal/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ command: autoRunCmd }),
          });
          const reader = termRes.body?.getReader();
          const decoder = new TextDecoder();
          let termOutput = "";
          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              termOutput += decoder.decode(value);
            }
          }
          if (termOutput.toLowerCase().includes("error")) {
            toast.error("Post-push typecheck found issues — check Terminal tab");
          } else {
            toast.success("✓ typecheck passed");
          }
        } catch {
          // terminal exec failed silently
        }
      }
    } catch (e: unknown) {
      toast.error(`AUTO push failed: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }, [linkedRepo, project, autoRunCmd]);

  useEffect(() => {
    if (trustMode !== "auto") return;
    messages.forEach(msg => {
      if (msg.fileEdits?.length && !msg.autoPushed) {
        msg.autoPushed = true;
        handlePushAll(msg.fileEdits);
      }
    });
  }, [messages, trustMode, handlePushAll]);

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

  // Always-current ref so doSend doesn't capture stale state
  sendCtxRef.current = { wsLens, wsModel };

  const doSend = useCallback(
    (text: string, sid: number, currentMessages: ChatMessage[], ctx?: string | null, imageData?: { base64: string; mediaType: string }) => {
      const userMsg: ChatMessage = { role: "user", content: text, sentAt: new Date().toISOString() };
      const history = currentMessages.map((m) => ({ role: m.role, content: m.content }));
      const ledgerEntries = (entries || []).map((e: Entry) => ({ id: e.id, title: e.title, status: e.status }));
      const activeCtx = ctx !== undefined ? ctx : fileContext;

      setMessages((prev) => [...prev, userMsg]);
      setChatPending(true);
      setActivityStream({ active: true, content: "" });

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

      // Read from always-current ref so stale closure never sends wrong lens/model
      const lensCtx = sendCtxRef.current;
      const isScenario = lensCtx.wsLens === "scenario";
      const body = {
        sessionId: sid,
        projectId: id,
        message: text,
        model: lensCtx.wsModel,
        workspaceLens: lensCtx.wsLens,
        scenarioMode: isScenario,
        history,
        entries: ledgerEntries,
        ...(activeCtx ? { fileContext: activeCtx } : {}),
        ...(userProfileStr ? { userProfile: userProfileStr } : {}),
        ...(projectMap ? { projectMap } : {}),
        ...(imageData ? { imageData } : {}),
        ...(forgeContext ? { forgeContext } : {}),
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
          // Detect LENS_DRIFT signal in response content and strip it
          if (res.content && typeof res.content === "string") {
            const driftMatch = res.content.match(/LENS_DRIFT:\s*(flow|build|look|scenario)/i);
            if (driftMatch) {
              const drifted = driftMatch[1].toLowerCase() as WorkspaceLens;
              if (drifted !== sendCtxRef.current.wsLens) {
                setDetectedLens(drifted);
              }
              res.content = res.content.replace(/\n?LENS_DRIFT:\s*(flow|build|look|scenario)\s*$/i, "").trim();
            } else {
              // No drift token — clear any stale indicator so suggestion doesn't linger
              setDetectedLens(null);
            }
          }
          const cp = res.catchPayload as CatchPayload | null;
          const ap = res.alertPayload as AlertPayload | null;
          const fes = (res.fileEdits ?? (res.fileEdit ? [res.fileEdit] : [])) as FileEdit[];
          const lps = (res.linePatches ?? []) as LinePatch[];
          const aff = (res.autoFetchedFiles ?? []) as string[];
          setActivityStream({
            active: true,
            content: [
              res.content ?? "",
              res.plan?.mode === "blueprint" ? "BLUEPRINT" : res.plan ? "PLAN" : "",
              aff.length > 0 ? "FILE_READ" : "",
              fes.length > 0 ? "FILE_EDIT" : "",
              lps.length > 0 ? "LINE_PATCH" : "",
            ].filter(Boolean).join("\n"),
          });
          const rawChips = (res.memoryChips ?? []) as Array<string | MemoryChip>;
          const normalizedChips: MemoryChip[] = rawChips.map((c) =>
            typeof c === "string" ? { label: c } : c
          );
          setMessages((prev) => [...prev, {
            id: res.messageId, role: "assistant",
            content: res.content, intentType: res.intentType, catchPayload: cp,
            ...(ap ? { alertPayload: ap } : {}),
            ...(res.plan ? { plan: res.plan as Plan } : {}),
            sentAt: new Date().toISOString(),
            model: res.model ?? wsModel,
            isDeepDive: !!res.isDeepDive,
            ...(fes.length > 0 ? { fileEdits: fes, fileEdit: fes[0] } : {}),
            ...(lps.length > 0 ? { linePatches: lps } : {}),
            ...(normalizedChips.length > 0 ? { memoryChips: normalizedChips } : {}),
            ...(res.imageB64 ? { imageB64: res.imageB64, imageMimeType: res.imageMimeType } : {}),
            ...(aff.length > 0 ? { autoFetchedFiles: aff } : {}),
          }]);
          // Capture scenario messages in isolated buffer (not persisted to DB)
          if (isScenario) {
            setScenarioBuffer(prev => [
              ...prev,
              { role: "user", content: text },
              { role: "assistant", content: res.content ?? "" },
            ]);
          }
          // Auto-switch to Diff tab when Atlas proposes file changes
          if (fes && fes.length > 0) {
            setLeftTab("diff");
            setMobileTab("preview"); // switches to diff view on mobile
          }
          // Notify user when a plan/blueprint/research is saved to Workbench
          if (res.plan) {
            toast.success(
              () => (
                <span
                  onClick={() => {
                    if (isMobile) { setMobileTab("workbench"); setRightOpen(true); }
                    else { setDesktopForceTab("workbench"); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  }}
                  style={{ cursor: "pointer", textDecoration: "underline", color: "var(--atlas-gold)" }}
                >
                  {res.plan.mode === "blueprint" ? "Blueprint" : "Plan"} saved — open Workbench
                </span>
              ),
              { duration: 5000 }
            );
          }
          // Notify user when a generated image is saved to Workbench
          if (res.imageB64) {
            toast.success(
              () => (
                <span
                  onClick={() => {
                    if (isMobile) { setMobileTab("workbench"); setRightOpen(true); }
                    else { setDesktopForceTab("workbench"); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  }}
                  style={{ cursor: "pointer", textDecoration: "underline", color: "var(--atlas-gold)" }}
                >
                  Visual saved — open Workbench
                </span>
              ),
              { duration: 5000 }
            );
          }
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
          // Auto-name: update project name silently when Atlas generates one on the first message
          if (res.autoName && typeof res.autoName === "string") {
            setAutoNameKey((k) => k + 1);
            queryClient.setQueryData(getGetProjectQueryKey(id), (old: unknown) => {
              if (old && typeof old === "object" && "name" in old) return { ...(old as object), name: res.autoName };
              return old;
            });
            queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") {
            setActivityStream({ active: false, content: "" });
            return;
          }
          void reportError(err, { projectId: id });
          setMessages((prev) => [...prev, { role: "assistant", content: "Something went wrong. Please try again.", sentAt: new Date().toISOString() }]);
          setActivityStream({ active: false, content: "" });
        })
        .finally(() => { setChatPending(false); abortControllerRef.current = null; });
    },
    [entries, id, fileContext]
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

  const updatePlanState = useCallback((messageId: number, state: PlanState) => {
    setPlanStates((prev) => {
      const next = new Map(prev);
      next.set(messageId, state);
      return next;
    });
  }, []);

  const updatePlanExecution = useCallback((messageId: number, execution: PlanExecution | null) => {
    setPlanExecutions((prev) => {
      const next = new Map(prev);
      if (execution) next.set(messageId, execution);
      else next.delete(messageId);
      return next;
    });
  }, []);

  const executeHomePlan = useCallback((plan: Plan) => {
    if (!sessionId || chatPending) return;
    const planText = [
      `Approved plan from home: ${plan.title}`,
      ...plan.steps.map((step) => `${step.order}. [${step.type}] ${step.file ? `${step.file} - ` : ""}${step.description}`),
    ].join("\n");
    doSend(
      `${planText}\n\nExecute this plan in this workspace. Read the relevant files first if needed, then return FILE_EDIT or LINE_PATCH blocks for any code changes so I can review and push them.`,
      sessionId,
      messages
    );
  }, [chatPending, doSend, messages, sessionId]);

  useEffect(() => {
    if (!sessionId || homePlanLoadedRef.current || messages.length > 0) return;
    let plan: Plan | null = null;
    try {
      const raw = sessionStorage.getItem(`atlas-home-plan-${id}`);
      plan = raw ? JSON.parse(raw) as Plan : null;
      if (raw) sessionStorage.removeItem(`atlas-home-plan-${id}`);
    } catch {
      plan = null;
    }
    if (!plan) return;
    homePlanLoadedRef.current = true;
    initialSent.current = true;
    const messageId = -Date.now();
    setPlanStates((prev) => {
      const next = new Map(prev);
      next.set(messageId, "pending");
      return next;
    });
    setMessages([{
      id: messageId,
      role: "assistant",
      content: "This plan came over from Home. Review it here, then approve it when you want Atlas to execute it inside this workspace.",
      intentType: "PLAN",
      plan,
      planFromHome: true,
      sentAt: new Date().toISOString(),
    }]);
  }, [id, messages.length, sessionId]);

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

  // Home-to-workspace handoff — fires when arriving via "Take to workspace" on home page
  const homeHandoffPrimed = useRef(false);
  useEffect(() => {
    if (!sessionId || homeHandoffPrimed.current || initialSent.current) return;
    const fromHome = (() => { try { return new URLSearchParams(window.location.search).get("from") === "home"; } catch { return false; } })();
    if (!fromHome) return;
    if (messages.length > 0) { homeHandoffPrimed.current = true; return; }
    if (!project?.memory) return;
    try {
      const mem = JSON.parse(project.memory);
      const briefEntry = mem?.entries?.find((e: any) =>
        e.tier === 1 && typeof e.text === "string" && e.text.startsWith("Project brief from home conversation:")
      );
      if (!briefEntry) { homeHandoffPrimed.current = true; return; }
      homeHandoffPrimed.current = true;
      const briefText = (briefEntry.text as string).replace("Project brief from home conversation: ", "");
      setTimeout(() => {
        doSend(`I've just arrived from our home conversation. You have my project brief in memory: "${briefText}". Acknowledge what we discussed and where we're starting — then ask what's first.`, sessionId, []);
      }, 300);
    } catch { homeHandoffPrimed.current = true; }
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
    setShowHomeHandoffBanner(false);
    // Auto-dismiss any active catch — user chose to keep moving
    if (activeCatch) {
      setMessages((prev) => prev.map((m) =>
        m.catchPayload && !m.catchResolved ? { ...m, catchResolved: true } : m
      ));
      setActiveCatch(null);
    }
    playSend();
    const current = messages;
    const files = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }

    const imageFile = files.find(f => f.type.startsWith("image/"));
    const otherFiles = files.filter(f => f !== imageFile);
    const suffix = otherFiles.length > 0 ? `\n[Attached: ${otherFiles.map(f => f.name).join(", ")}]` : "";
    const fullText = text + suffix;

    if (imageFile) {
      fileToBase64Safe(imageFile)
        .then(({ base64, mediaType }) => doSend(fullText, sessionId, current, undefined, { base64, mediaType }))
        .catch(() => doSend(fullText, sessionId, current));
    } else {
      doSend(fullText, sessionId, current);
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
        { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); void refreshParkedEntries(); } }
      );
    },
    [id, sessionId, createEntry, queryClient, refreshParkedEntries]
  );

  const handleCommit = useCallback(
    (content: string) => {
      if (!sessionId) return;
      const title = content
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/`(.+?)`/g, "$1")
        .replace(/\[(.+?)\]\(.+?\)/g, "$1")
        .replace(/\n/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 80)
        .trim();
      createEntry.mutate(
        { projectId: id, data: { title, summary: content.slice(0, 500), status: "committed", severity: "committed", mode: "think", sessionId } },
        { onSuccess: () => { playCommit(); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); void refreshParkedEntries(); } }
      );
    },
    [id, sessionId, createEntry, queryClient, playCommit, refreshParkedEntries]
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
  const parkedCount = parkedEntries.length;
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
  const displayedReadinessScore =
    readinessMode === "arch" ? mapReadiness :
    readinessMode === "decisions" ? healthPct :
    blendedReadiness;
  const [pendingResolvedNodeIds, setPendingResolvedNodeIds] = useState<string[]>([]);
  const [desktopForceTab, setDesktopForceTab] = useState<RightTab | undefined>(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : undefined
  );
  useEffect(() => {
    if (!isHomeHandoff || !Number.isFinite(id) || homeHandoffDbLoadedRef.current === id) return;
    homeHandoffDbLoadedRef.current = id;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`, { credentials: "include", signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json() as { nodeState?: unknown };
        const persistedNodes = extractPersistedFlowNodes(data.nodeState);
        if (persistedNodes.length === 0) return;
        setExternalForgeNodes(persistedNodes);
        setHomeHandoffMeta((prev) => ({
          parkedCount: prev?.parkedCount ?? parkedEntries.length,
          flowNodeCount: persistedNodes.length,
          goalLabel: persistedNodes.find(n => n.type === "goal")?.label ?? prev?.goalLabel ?? persistedNodes[0]?.label ?? "your goal",
          parkedTitles: prev?.parkedTitles,
          nodes: persistedNodes.map(n => ({
            id: n.id,
            label: n.label,
            type: n.type,
            details: n.details,
            meta: n.meta,
            moscow: n.moscow,
          })),
        }));
        if (isMobile) {
          setMobileTab("map");
          setRightOpen(true);
        } else {
          setDesktopForceTab("map");
          setTimeout(() => setDesktopForceTab(undefined), 120);
        }
      } catch {
        // Handoff details are a progressive enhancement; keep the workspace usable.
      }
    })();
    return () => controller.abort();
  }, [id, isHomeHandoff, isMobile, parkedEntries.length]);
  const openPreviewPanel = useCallback(() => {
    if (isMobile) {
      setMobileTab("preview");
      setRightOpen(true);
    } else {
      setDesktopForceTab("preview");
      setTimeout(() => setDesktopForceTab(undefined), 120);
    }
  }, [isMobile]);
  const [sandboxCode, setSandboxCode] = useState<string | null>(null);
  const handlePreviewCode = useCallback((code: string) => {
    setSandboxCode(code);
    openPreviewPanel();
  }, [openPreviewPanel]);

  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | null>(null);
  const handleRunCommand = useCallback((command: string) => {
    setPendingTerminalCommand(command);
    setLeftTab("terminal");
  }, []);

  // ── Agentic auto-execute ──────────────────────────────────────────────────
  const agenticAutoRunRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!agenticMode || chatPending) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const match = lastMsg.content.match(/CMD_EXEC:(\{[^\n}]*\})/);
    if (!match) return;
    let cleanup: (() => void) | undefined;
    try {
      const parsed = JSON.parse(match[1]) as { command?: string };
      const cmd = parsed.command;
      if (!cmd?.trim()) return;
      const key = (lastMsg.sentAt ?? String(messages.length)) + cmd;
      if (agenticAutoRunRef.current.has(key)) return;
      agenticAutoRunRef.current.add(key);
      setAgenticIterCount((n) => n + 1);
      const t = setTimeout(() => handleRunCommand(cmd), 900);
      cleanup = () => clearTimeout(t);
    } catch {}
    return cleanup;
  }, [messages, chatPending, agenticMode, handleRunCommand]);

  // Session memory write — fires when user navigates away / hides the tab.
  // Calls the summarize endpoint which asks Claude Haiku to distill the session
  // into a T3 (episodic) memory entry on the project, so Atlas remembers
  // what was worked on the next time the workspace opens.
  const summarizedSessionRef = useRef<number | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const assistantCount = messages.filter((m) => m.role === "assistant").length;
    if (assistantCount < 2) return;
    const onHide = () => {
      if (!document.hidden) return;
      if (summarizedSessionRef.current === sessionId) return; // already saved this session
      summarizedSessionRef.current = sessionId;
      void fetch(`/api/sessions/${sessionId}/summarize`, {
        method: "POST",
        credentials: "include",
      });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [sessionId, messages]);

  const messagesRef = useRef<ChatMessage[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const handleTerminalComplete = useCallback((command: string, output: string, exitCode: number | null) => {
    if (!sessionId) return;
    const truncated = output.length > 3500 ? output.slice(0, 3500) + "\n[...output truncated]" : output;
    const formattedText = `Terminal output for \`${command}\`:\n\`\`\`\n${truncated}\n\`\`\`\nExit code: ${exitCode ?? "unknown"}`;
    doSend(formattedText, sessionId, messagesRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
  const processZip = useCallback(async (file: File) => {
    try {
      // Upload to server for full extraction (400k chars, 500 lines/file)
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload/code-context", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as Record<string, unknown>));
        const msg = typeof body.error === "string" ? body.error : `Upload failed (${res.status})`;
        toast.error(msg);
        return;
      }
      const data = await res.json() as {
        fileContext: string;
        summary: string;
        fileCount: number;
        totalChars: number;
        skipped: number;
        filePaths: string[];
        files: Array<{ path: string; content: string; lines: number; truncated: boolean }>;
      };
      const parsed: ZipEntry[] = data.files.map((f) => ({
        path: f.path,
        content: f.content,
        lines: f.lines,
        selected: true,
      }));
      setZipFiles(parsed);
      setZipName(file.name);
      setZipTruncated(data.files.some((f) => f.truncated));
      setFileContext(data.fileContext);
      toast.success(data.summary);
    } catch {
      toast.error("ZIP upload failed — check connection");
    }
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

  const liveGeneration = useMemo(
    () => parseLiveGeneration(activityStream.content, chatPending),
    [activityStream.content, chatPending]
  );

  // ── Project not found ────────────────────────────────────────────────────
  if (!projectLoading && !sessionsLoading && id && !project) {
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "var(--atlas-bg)", gap: 20 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.35em", color: "var(--atlas-gold)", opacity: 0.4, textTransform: "uppercase" }}>Axiom</div>
        <div style={{ fontSize: 20, fontWeight: 300, color: "var(--atlas-fg)", letterSpacing: "0.04em" }}>Project not found.</div>
        <button
          onClick={() => setLocation("/home")}
          style={{ padding: "10px 24px", borderRadius: 9, cursor: "pointer", background: "linear-gradient(180deg, var(--atlas-gold) 0%, #B8942A 100%)", border: "1px solid rgba(var(--atlas-gold-rgb),0.4)", color: "#0C0A09", fontSize: 11, fontWeight: 700, fontFamily: "var(--app-font-mono)", letterSpacing: "0.14em", textTransform: "uppercase" }}
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
          @keyframes atlas-name-fresh { from { opacity: 0; transform: translateY(-2px); } to { opacity: 0.92; transform: translateY(0); } }
          .atlas-name-fresh { animation: atlas-name-fresh 0.5s ease forwards; }
          .atlas-name-pencil { opacity: 0; transition: opacity 150ms ease; }
          button:hover .atlas-name-pencil, button:focus .atlas-name-pencil { opacity: 0.4; }
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
      style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--atlas-surface)", overflow: "hidden", zIndex: 0, paddingBottom: isMobile ? "calc(64px + env(safe-area-inset-bottom, 0px))" : 0 }}
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
        <div className="atlas-app-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 14px", borderBottom: "1px solid rgba(var(--atlas-gold-rgb),0.12)", boxShadow: "0 1px 28px rgba(0,0,0,0.45)" }}>

          {/* Left: drawer button + Atlas logo + Trust Mode */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setLocation("/home")}
              aria-label="Go home"
              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 4, display: "flex", borderRadius: 7, flexShrink: 0 }}
            >
              <AtlasLogo small />
            </button>
            {/* Autopilot toggle — lightning bolt both states */}
            <button
              onClick={() => {
                if (trustMode === "review") {
                  const confirmed = window.confirm("Turn on Autopilot?\n\nAtlas can apply iterative changes continuously during this session. Diffs may be grouped instead of shown individually. You can turn it off anytime — git history stays recoverable.");
                  if (!confirmed) return;
                  setTrustMode("auto");
                } else {
                  setTrustMode("review");
                }
              }}
              title={trustMode === "auto" ? "Autopilot ON — Atlas applies changes continuously. Tap to turn off." : "Autopilot OFF — you review every diff. Tap to turn on."}
              aria-label="Toggle trust mode"
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 0 : 5,
                padding: isMobile ? "5px 7px" : "4px 10px",
                borderRadius: 6, fontSize: 10, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.08em", cursor: "pointer",
                background: trustMode === "auto" ? "rgba(239,100,68,0.12)" : "var(--atlas-surface)",
                border: trustMode === "auto" ? "1px solid rgba(239,100,68,0.35)" : "1px solid var(--atlas-border)",
                color: trustMode === "auto" ? "rgba(239,100,68,0.9)" : "var(--atlas-muted)",
                transition: "all 300ms ease", flexShrink: 0,
              }}
            >
              {/* Lightning bolt — both states, intensity signals on/off */}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ opacity: trustMode === "auto" ? 1 : 0.55 }}>
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              {!isMobile && <span>{trustMode === "auto" ? "Autopilot ON" : "Autopilot OFF"}</span>}
            </button>
            {/* Agent mode toggle */}
            <button
              onClick={() => { setAgenticMode((v) => !v); setAgenticIterCount(0); }}
              title={agenticMode ? "Agent mode ON — commands run automatically. Tap to switch to manual." : "Agent mode OFF — you tap Run for each command. Tap to enable auto-execute."}
              aria-label="Toggle agent mode"
              style={{
                display: "flex", alignItems: "center", gap: isMobile ? 0 : 5,
                padding: isMobile ? "5px 7px" : "4px 10px",
                borderRadius: 6, fontSize: 10, fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.08em", cursor: "pointer",
                background: agenticMode ? "rgba(201,162,76,0.12)" : "var(--atlas-surface)",
                border: agenticMode ? "1px solid rgba(201,162,76,0.35)" : "1px solid var(--atlas-border)",
                color: agenticMode ? "rgba(201,162,76,0.9)" : "var(--atlas-muted)",
                transition: "all 300ms ease", flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ opacity: agenticMode ? 1 : 0.45 }}>
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                <path d="M8 5l8 7-8 7V5z" />
              </svg>
              {!isMobile && <span>{agenticMode ? "Agent ON" : "Agent OFF"}</span>}
            </button>
          </div>

          {/* Center: project name + readiness ring + dropdown — hidden in mobile map mode */}
          <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: isMobile && mobileTab === "map" ? "none" : "flex", alignItems: "center", gap: 4, maxWidth: "min(280px, calc(100% - 260px))" }}>
            <button
              ref={projectBtnRef}
              onClick={() => setShowProjectMenu((v) => !v)}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, background: "transparent", border: "none", cursor: "pointer", padding: "4px 8px", borderRadius: 8, transition: "background 150ms ease", minWidth: 0, overflow: "hidden", width: "100%" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--atlas-glass-bg)"; }}
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
                        e.preventDefault();
                        const newName = renameDraft.trim() || (project?.name ?? "");
                        updateProjectHeader.mutate({ id, data: { name: newName } }, {
                          onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }); setRenaming(false); setRenameError(null); },
                          onError: (err) => { setRenameError((err as Error)?.message ?? "Failed to rename."); setTimeout(() => renameInputRef.current?.focus(), 0); },
                        });
                      }
                      if (e.key === "Escape") { renameEscapeRef.current = true; setRenaming(false); setRenameError(null); }
                    }}
                    onBlur={() => {
                      if (updateProjectHeader.isPending) return;
                      if (renameEscapeRef.current) { renameEscapeRef.current = false; return; }
                      const newName = renameDraft.trim() || (project?.name ?? "");
                      updateProjectHeader.mutate({ id, data: { name: newName } }, {
                        onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) }); setRenaming(false); setRenameError(null); },
                        onError: (err) => { setRenameError((err as Error)?.message ?? "Failed to rename."); setTimeout(() => renameInputRef.current?.focus(), 0); },
                      });
                    }}
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
                  {/* Title row: status dot + name (tap to rename) + pencil hint */}
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", width: "100%" }}
                    onClick={(e) => { e.stopPropagation(); setRenameDraft(project?.name ?? ""); setRenaming(true); }}
                    title="Tap to rename"
                  >
                    <span className={sessionId ? "atlas-pulse-dot" : undefined} style={{ width: 6, height: 6, borderRadius: "50%", background: sessionId ? "#4ade80" : "rgba(var(--atlas-muted-rgb),0.4)", flexShrink: 0, display: "inline-block" }} />
                    <span
                      key={autoNameKey}
                      className={autoNameKey > 0 ? "atlas-name-fresh" : undefined}
                      style={{ fontSize: 13, color: "var(--atlas-fg)", opacity: 0.92, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}
                    >
                      {project?.name ?? "…"}
                    </span>
                    <span className="atlas-name-pencil" style={{ fontSize: 10, color: "var(--atlas-muted)", flexShrink: 0, lineHeight: 1 }}>✎</span>
                  </span>
                  {/* Chevron on its own line, centered below */}
                  <svg width="10" height="6" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: "rgba(var(--atlas-muted-rgb),0.45)", flexShrink: 0 }}>
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
              <button
                type="button"
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
              </button>
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
                  {(allProjects ?? []).filter(p => p.id !== id && p.status !== "archived").length > 0 && (() => {
                    const others = (allProjects ?? []).filter(p => p.id !== id && p.status !== "archived");
                    const isEmptyNew = messages.length === 0 && project?.name === "New Project";
                    return (
                      <>
                        {/* Collapsible "Switch to" header */}
                        <button
                          onClick={() => setSwitchToExpanded(x => !x)}
                          style={{
                            display: "flex", alignItems: "center", justifyContent: "space-between",
                            width: "100%", background: "transparent", border: "none",
                            padding: "6px 12px 4px", cursor: "pointer",
                          }}
                        >
                          <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.45 }}>
                            Switch to
                          </span>
                          <svg
                            width="11" height="11" viewBox="0 0 10 6" fill="none"
                            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                            style={{ color: "var(--atlas-gold)", opacity: 0.7, transition: "transform 200ms ease", transform: switchToExpanded ? "rotate(0deg)" : "rotate(-90deg)", flexShrink: 0 }}
                          >
                            <path d="M1 1l4 4 4-4" />
                          </svg>
                        </button>
                        {switchToExpanded && (
                          <div style={{ maxHeight: "60vh", overflowY: "auto", paddingRight: 2 }}>
                            {/* New idea — creates blank project + opens its workspace */}
                            <MenuBtn
                              icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" /></svg>}
                              label={createProjectMutation.isPending ? "Creating…" : "New idea"}
                              onClick={() => {
                                if (createProjectMutation.isPending) return;
                                setShowProjectMenu(false);
                                createProjectMutation.mutate({ data: { name: "New Project" } }, {
                                  onSuccess: (created) => {
                                    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                                    setLocation(`/project/${created.id}`);
                                  },
                                });
                              }}
                              style={{ color: "color-mix(in oklab, var(--atlas-gold) 75%, var(--atlas-muted))", borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 8%, transparent)" }}
                            />
                            {others.map(p => {
                              const confirming = switchProjectDeleteId === p.id;
                              if (confirming) {
                                return (
                                  <div key={p.id} style={{ padding: "9px 12px", display: "flex", flexDirection: "column", gap: 7, borderRadius: 7, background: "color-mix(in oklab, var(--atlas-gold) 7%, transparent)" }}>
                                    <div style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.45 }}>
                                      Delete {p.name}? This cannot be undone.
                                    </div>
                                    <div style={{ display: "flex", gap: 6 }}>
                                      <button
                                        type="button"
                                        onClick={() => setSwitchProjectDeleteId(null)}
                                        style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface-alt)", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 11 }}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        disabled={deleteProjectMutation.isPending}
                                        onClick={() => handleDeleteProjectFromSwitcher(p.id)}
                                        style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid color-mix(in oklab, var(--atlas-gold) 36%, var(--atlas-border))", background: "color-mix(in oklab, var(--atlas-gold) 13%, var(--atlas-surface))", color: "var(--atlas-gold)", cursor: deleteProjectMutation.isPending ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700 }}
                                      >
                                        {deleteProjectMutation.isPending ? "Deleting…" : "Confirm"}
                                      </button>
                                    </div>
                                  </div>
                                );
                              }
                              return (
                                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <MenuBtn
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
                                    style={{ width: "auto", minWidth: 0, flex: 1 }}
                                  />
                                  <button
                                    type="button"
                                    aria-label={`Delete ${p.name}`}
                                    title={`Delete ${p.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSwitchProjectDeleteId(p.id);
                                    }}
                                    style={{
                                      flexShrink: 0,
                                      width: 30,
                                      height: 30,
                                      borderRadius: 7,
                                      border: "1px solid transparent",
                                      background: "transparent",
                                      color: "var(--atlas-muted)",
                                      cursor: "pointer",
                                      fontSize: 17,
                                      lineHeight: 1,
                                      opacity: 0.72,
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = "color-mix(in oklab, var(--atlas-gold) 8%, transparent)";
                                      e.currentTarget.style.borderColor = "color-mix(in oklab, var(--atlas-gold) 18%, transparent)";
                                      e.currentTarget.style.color = "var(--atlas-gold)";
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = "transparent";
                                      e.currentTarget.style.borderColor = "transparent";
                                      e.currentTarget.style.color = "var(--atlas-muted)";
                                    }}
                                  >
                                    ×
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
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
                  <MenuBtn
                    icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="3" rx="1" /><path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6" /><path d="M6 10h4" /></svg>}
                    label="Archive project"
                    onClick={() => {
                      updateProjectHeader.mutate({ id, data: { status: "archived" } }, {
                        onSuccess: () => {
                          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                          setShowProjectMenu(false);
                          setLocation("/projects");
                        },
                      });
                    }}
                  />
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

          {/* Right: vault + % score + mode + avatar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {/* Lens chip — dot-only on tiny screens */}
            <button
              title={`Lens: ${LENS_CONFIG[wsLens].sub}`}
              onClick={() => setShowLensPicker(true)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: isTinyScreen ? "5px 6px" : "3px 8px", borderRadius: 20,
                background: "transparent",
                border: `1px solid ${detectedLens ? LENS_CONFIG[detectedLens].borderColor : "rgba(var(--atlas-muted-rgb),0.2)"}`,
                cursor: "pointer", transition: "all 180ms ease", flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = LENS_CONFIG[wsLens].borderColor; e.currentTarget.style.background = LENS_CONFIG[wsLens].glowColor; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = detectedLens ? LENS_CONFIG[detectedLens].borderColor : "rgba(var(--atlas-muted-rgb),0.2)"; e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: detectedLens ? LENS_CONFIG[detectedLens].color : LENS_CONFIG[wsLens].color, flexShrink: 0, transition: "background 220ms ease" }} />
              {!isTinyScreen && (
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: detectedLens ? LENS_CONFIG[detectedLens].color : LENS_CONFIG[wsLens].color, letterSpacing: "0.08em", transition: "color 220ms ease", whiteSpace: "nowrap" }}>
                  {LENS_CONFIG[wsLens].label}{detectedLens ? ` → ${LENS_CONFIG[detectedLens].label}` : ""}
                </span>
              )}
            </button>

            {/* Vault — hidden from header on tiny screens (moved to input bar) */}
            {!isTinyScreen && (
              <button
                title="Visual Vault"
                aria-label="Open visual vault"
                onClick={() => setShowVault(true)}
                style={{
                  minWidth: 44, minHeight: 44, padding: 8, borderRadius: 7,
                  background: "transparent", border: "none",
                  color: "rgba(201,162,76,0.45)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "color 160ms ease", flexShrink: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--atlas-gold)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(201,162,76,0.45)")}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
              </button>
            )}
            <ReadinessRing
              archScore={mapReadiness}
              decisionsScore={healthPct}
              mode={readinessMode}
              onModeChange={handleReadinessModeChange}
              onClick={focusSystemMap}
              trend={readinessTrend}
            />
            {sessionPrUrl ? (
              <a
                href={sessionPrUrl}
                target="_blank"
                rel="noopener noreferrer"
                title="View Pull Request"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", borderRadius: 6,
                  background: "rgba(134,239,172,0.08)",
                  border: "1px solid rgba(134,239,172,0.25)",
                  color: "rgba(134,239,172,0.85)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)",
                  textDecoration: "none", letterSpacing: "0.06em",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
                </svg>
                PR
              </a>
            ) : pushHistory.length > 0 ? (
              <button
                onClick={() => setLeftTab("diff")}
                title="Open Pull Request"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 8px", borderRadius: 6,
                  background: "rgba(201,162,76,0.06)",
                  border: "1px solid rgba(201,162,76,0.2)",
                  color: "var(--atlas-gold)",
                  fontSize: 10, fontFamily: "var(--app-font-mono)",
                  cursor: "pointer", letterSpacing: "0.06em",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z"/>
                </svg>
                PR
              </button>
            ) : null}

            {/* Readiness score pill — only shown in mobile map mode (replaces the ring hidden in center) */}
            {isMobile && mobileTab === "map" && (
              <button
                onClick={focusSystemMap}
                title={`Readiness ${displayedReadinessScore}%`}
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
                  {displayedReadinessScore}%
                </span>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: displayedReadinessScore > 0 ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.4)",
                  flexShrink: 0, display: "inline-block",
                  boxShadow: displayedReadinessScore > 0 ? "0 0 5px rgba(var(--atlas-gold-rgb),0.6)" : "none",
                }} />
              </button>
            )}

            {/* Parking Lot removed from header — lives in the Projects Drawer (Navigate → Parking Lot) */}


            {!isMobile && (
              <button
                title="Open Preview"
                aria-label="Toggle preview"
                onClick={openPreviewPanel}
                style={{
                  minWidth: 44, minHeight: 44, padding: 8, borderRadius: 7,
                  background: "transparent", border: "none",
                  color: "var(--atlas-muted)", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "color 160ms ease, opacity 160ms ease", flexShrink: 0,
                  opacity: 0.65,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--atlas-gold)"; e.currentTarget.style.opacity = "1"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--atlas-muted)"; e.currentTarget.style.opacity = "0.65"; }}
              >
                <Eye size={15} strokeWidth={1.7} />
              </button>
            )}

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
        };
        const skipAndBuild = () => {
          setShowHandoffModal(false);
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
                        border: `1px solid ${selected ? "rgba(74,222,128,0.3)" : "rgba(var(--atlas-muted-rgb),0.15)"}`,
                        cursor: "pointer", textAlign: "left" as const, transition: "all 140ms ease",
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        border: `1.5px solid ${selected ? "#4ade80" : "rgba(var(--atlas-muted-rgb),0.4)"}`,
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
                    background: "transparent", border: "1px solid rgba(var(--atlas-muted-rgb),0.2)",
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
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {(showHomeHandoffBanner || showHomeHandoffDrawer) && (
        <style>{`
          @keyframes atlas-handoff-drawer-in {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      )}

      {(showHomeHandoffBanner || showHomeHandoffDrawer) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 18px",
            background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
            borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, display: "inline-block" }} />
            <span style={{ fontSize: 12, color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {homeHandoffMeta?.parkedCount ?? 0} ideas parked · {homeHandoffMeta?.flowNodeCount ?? 0} flow nodes mapped · conversation memory loaded
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setShowHomeHandoffDrawer(true)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--atlas-gold)",
                cursor: "pointer",
                fontFamily: "var(--app-font-mono)",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "2px 0",
                textTransform: "uppercase",
              }}
            >
              View →
            </button>
            {!showHomeHandoffDrawer && (
              <button
                onClick={() => setShowHomeHandoffBanner(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-gold)", fontSize: 16, lineHeight: 1, padding: "2px 4px", flexShrink: 0, opacity: 0.55 }}
                title="Dismiss"
                aria-label="Dismiss"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {showHomeHandoffDrawer && (
        <div
          role="region"
          aria-label="Home handoff details"
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 95,
            background: "rgba(var(--atlas-bg-rgb),0.98)",
            borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.24)",
            boxShadow: "0 -18px 48px rgba(var(--atlas-bg-rgb),0.85)",
            borderRadius: "18px 18px 0 0",
            padding: "18px 18px calc(18px + env(safe-area-inset-bottom))",
            animation: "atlas-handoff-drawer-in 220ms ease-out",
          }}
        >
          <div style={{ width: 36, height: 3, borderRadius: 999, background: "rgba(var(--atlas-muted-rgb),0.65)", margin: "0 auto 16px" }} />
          <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 4 }}>
                  Home handoff
                </div>
                <div style={{ color: "var(--atlas-fg)", fontSize: 15, fontWeight: 600 }}>
                  Picked up from your home session
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Flow Nodes
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {homeHandoffNodes.length > 0 ? homeHandoffNodes.map((node) => (
                    <div key={node.id ?? `${node.type}-${node.label}`} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                        <span style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                        <span style={{ color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>{node.type}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {(node.moscow ?? node.meta) && (
                          <span style={{ flexShrink: 0, color: "var(--atlas-gold)", border: "1px solid rgba(var(--atlas-gold-rgb),0.28)", background: "rgba(var(--atlas-gold-rgb),0.08)", borderRadius: 999, padding: "1px 6px", fontFamily: "var(--app-font-mono)", fontSize: 8, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            {node.moscow ?? node.meta}
                          </span>
                        )}
                        {node.details && (
                          <span style={{ minWidth: 0, color: "var(--atlas-muted)", fontSize: 11, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {node.details}
                          </span>
                        )}
                      </div>
                    </div>
                  )) : (
                    <div style={{ color: "var(--atlas-muted)", fontSize: 12, lineHeight: 1.5 }}>No flow node details were saved for this handoff.</div>
                  )}
                </div>
              </section>

              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Parked Ideas
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {homeHandoffParkedTitles.length > 0 ? homeHandoffParkedTitles.map((title) => (
                    <div key={title} style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.45 }}>
                      {title}
                    </div>
                  )) : (
                    <div style={{ color: "var(--atlas-muted)", fontSize: 12, lineHeight: 1.5 }}>No parked ideas were saved for this handoff.</div>
                  )}
                </div>
              </section>

              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Memory
                </div>
                <div style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.5 }}>
                  Conversation memory loaded from home session
                </div>
              </section>
            </div>

            <button
              type="button"
              onClick={() => { setShowHomeHandoffDrawer(false); setShowHomeHandoffBanner(false); }}
              style={{
                width: "100%",
                borderRadius: 12,
                border: "1px solid rgba(var(--atlas-gold-rgb),0.35)",
                background: "rgba(var(--atlas-gold-rgb),0.14)",
                color: "var(--atlas-gold)",
                cursor: "pointer",
                fontFamily: "var(--app-font-mono)",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                padding: "12px 14px",
                textTransform: "uppercase",
              }}
            >
              Got it
            </button>
          </div>
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
            position: "relative",
          }}
        >
          {/* ── Chat / Diff / Terminal tab strip ── */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--atlas-border)", flexShrink: 0, paddingLeft: 4, background: "var(--atlas-glass-bg)" }}>
            {(["chat", "diff", "terminal"] as const).filter(tab => tab !== "terminal" || wsLens === "build" || wsLens === "scenario").map((tab) => {
              const active = leftTab === tab;
              const label = tab === "chat" ? "Chat" : tab === "diff" ? "Diff" : "Terminal";
              const badge = tab === "diff" && pushHistory.length > 0 ? pushHistory.length : undefined;
              return (
                <button
                  key={tab}
                  onClick={() => setLeftTab(tab)}
                  aria-label={tab === "terminal" ? "Open terminal" : tab === "diff" ? "View diff" : "Open chat"}
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
                  {tab === "terminal" && <TerminalSquare size={13} strokeWidth={1.7} />}
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

          {leftTab === "diff" ? (
            <div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "16px 14px" }} className="scrollbar-none">
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
          ) : leftTab === "terminal" ? (
            <TerminalPanel pendingCommand={pendingTerminalCommand} onCommandConsumed={() => setPendingTerminalCommand(null)} onCommandComplete={handleTerminalComplete} scenarioLens={wsLens === "scenario"} />
          ) : (
          /* ── Chat view ── */
          <div
            ref={chatPanelScrollRef}
            aria-live="polite"
            aria-label="Atlas conversation"
            aria-busy={chatPending ? "true" : "false"}
            onScroll={(e) => {
              const el = e.currentTarget;
              setShowWsScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
            }}
            style={{ flex: 1, overflowY: "auto", padding: "28px 22px 12px", position: "relative" }}
            className="scrollbar-none atlas-chat-timeline"
          >
            {messages.length === 0 && !chatPending && isHomeHandoff && homeHandoffMeta && (
              <div style={{ padding: "52px 20px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ maxWidth: 520, color: "var(--atlas-fg)", fontSize: 15, lineHeight: 1.75, textAlign: "center", opacity: 0.88 }}>
                  Picked up where we left off. Your flow map has {homeHandoffMeta.flowNodeCount} nodes — {homeHandoffMeta.goalLabel} is the center. What do you want to tackle first?
                </div>
              </div>
            )}
            {messages.length === 0 && !chatPending && !(isHomeHandoff && homeHandoffMeta) && (
              <div style={{ padding: "52px 20px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                {isBrandNewProject ? (
                    <div style={{ fontSize: 20, fontWeight: 300, color: "var(--atlas-muted)", marginBottom: 28, letterSpacing: "-0.01em", textAlign: "center" }}>
                      New project. Before we build — do you have a <GlossaryTip term="north star">The one outcome that makes everything else worth building.</GlossaryTip> for this? Or should we start from what's in your head?
                    </div>
                ) : (
                  <>
                    <div style={{ fontSize: 20, fontWeight: 300, color: "var(--atlas-muted)", marginBottom: 6, letterSpacing: "-0.01em", textAlign: "center" }}>
                      {project ? project.name : "Ready."}
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(var(--atlas-muted-rgb),0.4)", marginBottom: 28, textAlign: "center" }}>
                      What are we working through today?
                    </div>
                  </>
                )}
                {/* Starter prompts */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 }}>
                  {[
                    { label: "I need to make a decision", sub: "Walk me through it and log it" },
                    { label: "I'm not sure which direction to take", sub: "Think out loud, I'll help you see the tension" },
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
                  onRunCommand={handleRunCommand}
                  agenticMode={agenticMode}
                  onPrCreated={(url) => { setSessionPrUrl(url); setLeftTab("diff"); }}
                  onExtractToForge={(content) => { setForgePreloadContent(content); setShowForgeExternal(true); }}
                  onReviewDiff={() => setLeftTab("diff")}
                  onStreamActivityUpdate={(content) => {
                    const markers = [
                      msg.autoFetchedFiles && msg.autoFetchedFiles.length > 0 ? "FILE_READ" : "",
                      msg.fileEdits && msg.fileEdits.length > 0 ? "FILE_EDIT" : "",
                      msg.linePatches && msg.linePatches.length > 0 ? "LINE_PATCH" : "",
                    ].filter(Boolean).join("\n");
                    setActivityStream({ active: true, content: [content, markers].filter(Boolean).join("\n") });
                  }}
                  onStreamActivityComplete={() => setActivityStream({ active: false, content: "" })}
                  onCommitCardDone={() => {
                    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) });
                    void refreshParkedEntries();
                  }}
                  planState={planStates.get(msg.id ?? 0) ?? "pending"}
                  planExecution={planExecutions.get(msg.id ?? 0)}
                  onPlanStateChange={updatePlanState}
                  onPlanExecutionChange={updatePlanExecution}
                  onExecuteHomePlan={executeHomePlan}
                  trustMode={trustMode}
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
                      { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); void refreshParkedEntries(); } }
                    );
                    // Refresh preview iframe after push — immediate + follow-up for slower deployments
                    setPreviewRefreshTrigger((t) => t + 1);
                    setTimeout(() => setPreviewRefreshTrigger((t) => t + 1), 25000);
                    setTimeout(() => setPreviewRefreshTrigger((t) => t + 1), 55000);
                    // Close the FILE_EDIT loop — tell Atlas the push landed so it can continue
                    if (sessionId) {
                      const plural = records.length > 1 ? `${records.length} files` : `"${records[0]?.filename}"`;
                      const confirmNote = commitUrl ? ` Commit: ${commitUrl}` : "";
                      doSend(
                        `FILE_EDIT_CONFIRMED: ${plural} pushed to ${branch}.${confirmNote} Continue.`,
                        sessionId,
                        messagesRef.current,
                      );
                    }
                  }}
                  onEditDeclined={() => {
                    if (sessionId) {
                      const editsInFlight = messages
                        .filter((m) => m.role === "assistant" && m.fileEdits && m.fileEdits.length > 0)
                        .slice(-1)[0]?.fileEdits?.map((e) => e.path.split("/").pop()).join(", ") ?? "the proposed changes";
                      doSend(
                        `FILE_EDIT_DECLINED: User reviewed but did not push ${editsInFlight}. Awaiting further instruction.`,
                        sessionId,
                        messagesRef.current,
                      );
                    }
                  }}
                  onAlertDismiss={() => {
                    setMessages((prev) => prev.map((m) =>
                      m.id === msg.id ? { ...m, alertResolved: true } : m
                    ));
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
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-fg)", letterSpacing: "0.04em", flex: 1 }}>
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

            {activityStream.active && liveGeneration.shouldShow ? (
              <LiveGenerationCard
                mode={liveGeneration.mode}
                steps={liveGeneration.steps}
                isComplete={false}
              />
            ) : activityStream.active ? (
              <AtlasActivityBar content={activityStream.content} />
            ) : null}

            <div ref={bottomRef} />

            {showWsScrollBtn && (
              <button
                onClick={() => chatPanelScrollRef.current?.scrollTo({ top: chatPanelScrollRef.current.scrollHeight, behavior: "smooth" })}
                style={{
                  position: "sticky",
                  bottom: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--atlas-surface)",
                  border: "1px solid var(--atlas-gold)",
                  borderRadius: 20,
                  padding: "6px 16px",
                  color: "var(--atlas-gold)",
                  fontSize: 12,
                  fontFamily: "var(--app-font-mono)",
                  cursor: "pointer",
                  boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
                  letterSpacing: "0.04em",
                  zIndex: 20,
                }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span> latest
              </button>
            )}
          </div>
          )} {/* end chat/diff ternary */}

          {/* Ledger status bar */}
          <div className="atlas-ledger-bar">
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: entryCount > 0 ? "var(--atlas-gold)" : "rgba(200,190,185,0.45)", flexShrink: 0, display: "inline-block", boxShadow: entryCount > 0 ? "0 0 6px rgba(201,162,76,0.45)" : "none", transition: "all 400ms ease" }} />
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: entryCount > 0 ? "rgba(var(--atlas-gold-rgb),0.82)" : "rgba(200,190,185,0.6)", transition: "color 400ms ease" }}>
              [{entryCount}] Ledger Entries
            </span>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(200,190,185,0.5)" }}>·</span>
            {agenticMode && agenticIterCount > 0 ? (
              <span style={{
                fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em",
                textTransform: "uppercase", display: "flex", alignItems: "center", gap: 4,
                color: "rgba(201,162,76,0.85)", transition: "color 300ms ease",
              }}>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.9, flexShrink: 0 }}>
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
                Agent · Loop {agenticIterCount} / 8
              </span>
            ) : (
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: chatPending ? "rgba(74,222,128,0.75)" : "rgba(200,190,185,0.6)", transition: "color 300ms ease" }}>
                {chatPending ? "Generating" : "Session Active"}
              </span>
            )}
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

          {/* Forge shortcut — visible on Chat tab only */}
          {leftTab === "chat" && forgeState && !forgeState.dismissed && (
            <div style={{ padding: "0 14px 8px", flexShrink: 0 }}>
              {forgeState.forged ? (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <button
                    aria-label="Open The Forge"
                    title="The Forge — re-run or review strategic map"
                    onClick={() => { setForgeActiveProjectName(project?.name); setForgeActiveProjectId(id); setShowForgeExternal(true); }}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 28, height: 28, borderRadius: 8,
                      background: "rgba(var(--atlas-gold-rgb),0.07)",
                      border: "1px solid rgba(var(--atlas-gold-rgb),0.22)",
                      color: "rgba(var(--atlas-gold-rgb),0.85)",
                      cursor: "pointer",
                    }}
                  >
                    <svg width={12} height={12} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 2L3 8.5l2.5 2.5L12 4.5 9 2z" />
                      <path d="M5.5 11L2 14.5" />
                      <path d="M11 3.5L13 5.5" />
                    </svg>
                  </button>
                  <button
                    aria-label="Dismiss Forge shortcut"
                    title="Dismiss Forge shortcut"
                    onClick={() => void updateForgeState("dismissed")}
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 22, height: 22, borderRadius: 999,
                      border: "1px solid rgba(var(--atlas-gold-rgb),0.18)",
                      background: "rgba(var(--atlas-gold-rgb),0.04)",
                      color: "rgba(var(--atlas-gold-rgb),0.65)",
                      cursor: "pointer", fontSize: 13, lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setForgeActiveProjectName(project?.name); setForgeActiveProjectId(id); setShowForgeExternal(true); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 7,
                    padding: "6px 10px 6px 12px", borderRadius: 8,
                    background: "rgba(var(--atlas-gold-rgb),0.07)",
                    border: "1px solid rgba(var(--atlas-gold-rgb),0.22)",
                    color: "rgba(var(--atlas-gold-rgb),0.85)",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-mono)", fontSize: 9.5,
                    letterSpacing: "0.1em", textTransform: "uppercase" as const,
                    transition: "all 160ms ease",
                  }}
                >
                  <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 2L3 8.5l2.5 2.5L12 4.5 9 2z" />
                    <path d="M5.5 11L2 14.5" />
                    <path d="M11 3.5L13 5.5" />
                  </svg>
                  Forge — Extract strategy from a doc or transcript
                </button>
              )}
            </div>
          )}

          {/* Input — hidden when Terminal tab is active (terminal has its own input row) */}
          {leftTab !== "terminal" && <div style={{ padding: "10px 14px 14px", flexShrink: 0, position: "sticky", bottom: 0, zIndex: 30, background: "var(--atlas-bg)", borderTop: "1px solid var(--atlas-border)" }}>
            {/* Hidden file input — handles both images and ZIP files */}
            <input
              ref={fileInputRef}
              id="ws-file-input"
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp,.zip,application/zip"
              style={{ position: "absolute", width: "1px", height: "1px", opacity: 0, pointerEvents: "none", overflow: "hidden" }}
              multiple
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                const zipFile = files.find(f => f.name.endsWith(".zip") || f.type === "application/zip");
                const imgFiles = files.filter(f => !f.name.endsWith(".zip") && f.type !== "application/zip");
                if (zipFile) await processZip(zipFile);
                if (imgFiles.length > 0) setAttachedFiles(prev => [...prev, ...imgFiles].slice(0, 10));
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

            {/* ── First-run onboarding overlay ── */}
            {!firstRunDismissed && !sessionsLoading && !projectLoading && sessions !== undefined && messages.length === 0 && (sessions.length === 0) && (entries?.length ?? 0) === 0 && !linkedRepo && (
              <div style={{
                marginBottom: 12, borderRadius: 12, background: "rgba(201,162,76,0.05)",
                border: "1px solid rgba(201,162,76,0.18)", padding: "16px 16px 14px",
                flexShrink: 0,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--atlas-gold)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
                      <circle cx="8" cy="8" r="7" /><path d="M8 5v4M8 11.5v.5" />
                    </svg>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--atlas-gold)", letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.9 }}>New workspace</span>
                  </div>
                  <button onClick={() => setFirstRunDismissed(true)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--atlas-muted)", padding: "2px 4px", lineHeight: 1, fontSize: 16, opacity: 0.5 }}>×</button>
                </div>
                <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--atlas-fg)", lineHeight: 1.6, opacity: 0.8 }}>
                  What are you building?
                </p>
                <textarea
                  value={firstRunInput}
                  onChange={e => setFirstRunInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      if (firstRunInput.trim() && sessionId) {
                        const initCtx = `[WORKSPACE INIT] The user just described what they are building. Use this to immediately initialize project memory with PROJECT_MEMORY: tags (MEMORY_T1 for the core idea, MEMORY_T4 for stack/context if mentioned). Then greet them, confirm you've captured it, and suggest linking their GitHub repo in the Files tab to unlock code-aware features.`;
                        doSend(firstRunInput.trim(), sessionId, messages, initCtx);
                        setFirstRunDismissed(true);
                        setFirstRunInput("");
                      }
                    }
                  }}
                  placeholder="e.g. A SaaS to let agencies manage client portals…"
                  rows={2}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(201,162,76,0.18)",
                    borderRadius: 8, color: "var(--atlas-fg)", fontSize: 13, fontFamily: "var(--app-font-sans)",
                    lineHeight: 1.6, padding: "8px 11px", resize: "none", boxSizing: "border-box",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--atlas-muted)", opacity: 0.6 }}>
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 00-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0020 4.77 5.07 5.07 0 0019.91 1S18.73.65 16 2.48a13.38 13.38 0 00-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 005 4.77a5.44 5.44 0 00-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 009 18.13V22" />
                    </svg>
                    Link a repo in <strong style={{ color: "var(--atlas-gold)", fontWeight: 500, opacity: 0.8 }}>Files</strong> to unlock code features
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => setFirstRunDismissed(true)} style={{ background: "none", border: "1px solid var(--atlas-border)", borderRadius: 7, color: "var(--atlas-muted)", fontSize: 12, padding: "5px 12px", cursor: "pointer" }}>Skip</button>
                    <button
                      onClick={() => {
                        if (firstRunInput.trim() && sessionId) {
                          const initCtx = `[WORKSPACE INIT] The user just described what they are building. Use this to immediately initialize project memory with PROJECT_MEMORY: tags (MEMORY_T1 for the core idea, MEMORY_T4 for stack/context if mentioned). Then greet them, confirm you've captured it, and suggest linking their GitHub repo in the Files tab to unlock code-aware features.`;
                          doSend(firstRunInput.trim(), sessionId, messages, initCtx);
                          setFirstRunDismissed(true);
                          setFirstRunInput("");
                        }
                      }}
                      disabled={!firstRunInput.trim() || !sessionId}
                      style={{ background: "var(--atlas-ember)", border: "none", borderRadius: 7, color: "#fff", fontSize: 12, fontWeight: 600, padding: "5px 14px", cursor: (firstRunInput.trim() && sessionId) ? "pointer" : "not-allowed", opacity: (firstRunInput.trim() && sessionId) ? 1 : 0.4 }}
                    >
                      Start →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Attachment preview strip */}
            {attachedFiles.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8, overflowX: "auto", paddingBottom: 2, flexShrink: 0 }}>
                {attachedFiles.map((file, idx) => (
                  <div key={idx} style={{ position: "relative", flexShrink: 0 }}>
                    {file.type.startsWith("image/") ? (
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        style={{ width: 54, height: 54, borderRadius: 7, objectFit: "cover", border: "1px solid rgba(201,162,76,0.25)", display: "block" }}
                      />
                    ) : (
                      <div style={{ width: 54, height: 54, borderRadius: 7, background: "rgba(201,162,76,0.07)", border: "1px solid rgba(201,162,76,0.2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, overflow: "hidden" }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="rgba(201,162,76,0.6)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <span style={{ fontSize: 8, color: "rgba(201,162,76,0.55)", maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em" }}>{file.name.split(".").pop()?.toUpperCase() ?? "FILE"}</span>
                      </div>
                    )}
                    <button
                      onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                      aria-label="Remove attachment"
                      style={{ position: "absolute", top: -5, right: -5, minWidth: 44, minHeight: 44, borderRadius: "50%", background: "var(--atlas-bg)", border: "1px solid rgba(201,162,76,0.3)", cursor: "pointer", color: "var(--atlas-fg)", fontSize: 10, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, zIndex: 1 }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}

            <div
              className="atlas-input-shell"
              style={{
                padding: "13px 15px",
                borderColor: LENS_CONFIG[detectedLens ?? wsLens].borderColor,
                boxShadow: `0 4px 24px rgba(0,0,0,0.28), 0 0 14px -8px ${LENS_CONFIG[detectedLens ?? wsLens].glowColor}`,
                transition: "border-color 220ms ease, box-shadow 220ms ease",
                ...(wsLens === "scenario" ? { background: "rgba(120,113,108,0.04)" } : {}),
              }}
            >
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
                    {wsLens === "build" ? "What needs to be built or fixed…" : wsLens === "look" ? "What visual change do you need…" : wsLens === "scenario" ? "What if…" : "What are you turning over?"}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  aria-label="Message Atlas"
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
                {/* Left: paperclip + vault (tiny screens) + wrench (read Atlas source) */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, position: "relative" }}>
                  <label
                    htmlFor="ws-file-input"
                    title="Attach image or project ZIP"
                    aria-label="Attach file"
                    style={{
                      minWidth: 44, minHeight: 44, padding: 7, borderRadius: 7,
                      background: (attachedFiles.length > 0 || zipFiles.length > 0) ? "rgba(201,162,76,0.08)" : "transparent",
                      border: (attachedFiles.length > 0 || zipFiles.length > 0) ? "1px solid rgba(201,162,76,0.2)" : "1px solid transparent",
                      color: (attachedFiles.length > 0 || zipFiles.length > 0) ? "var(--atlas-gold)" : "var(--atlas-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      opacity: (attachedFiles.length > 0 || zipFiles.length > 0) ? 1 : 0.4, transition: "all 160ms ease",
                      flexShrink: 0, userSelect: "none",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M13 7.5l-5.5 5.5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54l-6 6a1 1 0 01-1.42-1.42l5.5-5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </label>

                  {/* Vault — shown in input bar only on tiny screens */}
                  {isTinyScreen && (
                    <button
                      title="Visual Vault"
                      aria-label="Open visual vault"
                      onClick={() => setShowVault(true)}
                      style={{
                        minWidth: 44, minHeight: 44, padding: 7, borderRadius: 7,
                        background: "transparent", border: "1px solid transparent",
                        color: "var(--atlas-muted)", cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: 0.4, transition: "all 160ms ease", flexShrink: 0,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--atlas-gold)"; e.currentTarget.style.opacity = "1"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--atlas-muted)"; e.currentTarget.style.opacity = "0.4"; }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7" rx="1"/>
                        <rect x="14" y="3" width="7" height="7" rx="1"/>
                        <rect x="3" y="14" width="7" height="7" rx="1"/>
                        <rect x="14" y="14" width="7" height="7" rx="1"/>
                      </svg>
                    </button>
                  )}

                  {/* Wrench — read Atlas source into context */}
                  <button
                    onClick={() => setShowSrcPicker((v) => !v)}
                    title="Read Atlas source file into context"
                    aria-label="Read Atlas source file into context"
                    style={{
                      minWidth: 44, minHeight: 44, padding: 7, borderRadius: 7,
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
                      aria-label="Open deep dive menu"
                      style={{
                        minWidth: 44, minHeight: 44, padding: 7, borderRadius: 7,
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
                          { id: "chatgpt", label: "ChatGPT", sub: "Context auto-fills" },
                          { id: "perplexity", label: "Perplexity", sub: "Context auto-fills" },
                          { id: "gemini", label: "Gemini", sub: deepDiveCopied ? "Copied — paste when it opens" : "Copies context, paste once" },
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
                                setTimeout(() => window.open("https://gemini.google.com", "_blank"), 2500);
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
                          <div style={{ fontSize: 9.5, color: "rgba(var(--atlas-muted-rgb),0.55)", marginTop: 1 }}>{f.hint}</div>
                        </button>
                      ))}
                      <div style={{ fontSize: 9, padding: "4px 10px 2px", color: "rgba(var(--atlas-muted-rgb),0.35)", borderTop: "1px solid rgba(56,189,248,0.06)", marginTop: 4 }}>
                        File loads into context · next message only
                      </div>
                    </div>
                  )}
                </div>

                {!isTinyScreen && (
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.06em", color: "var(--atlas-muted)", opacity: 0.3 }}>
                    {isMobile ? "type / for shortcuts" : "Enter · Shift+Enter for newline"}
                  </span>
                )}

                {/* Right: model chip + mic + send */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {/* Model selector — tappable chip, reserved slot for future model switching */}
                  <button
                    onClick={() => setShowWsModelSheet(true)}
                    title="Switch model"
                    aria-label="Switch model"
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "4px 8px", borderRadius: 20,
                      background: "var(--atlas-surface)",
                      border: "1px solid var(--atlas-surface)",
                      cursor: "pointer", transition: "all 160ms ease", flexShrink: 0,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(201,162,76,0.07)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.32)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "var(--atlas-surface)"; e.currentTarget.style.borderColor = "var(--atlas-surface)"; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="rgba(var(--atlas-muted-rgb),0.7)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="8" cy="8" r="6" />
                      <path d="M5.5 8.5L7 10l3-4" />
                    </svg>
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 9.5, color: "var(--atlas-fg)", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
                      {wsModel === "claude" ? "Claude" : wsModel === "gemini" ? "Gemini" : wsModel}
                    </span>
                    <svg width="7" height="7" viewBox="0 0 8 8" fill="none" style={{ opacity: 0.35, flexShrink: 0 }}>
                      <path d="M1.5 3L4 5.5L6.5 3" stroke="var(--atlas-fg)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {voiceSupported && (
                    <button
                      onClick={toggleVoice}
                      title={voiceListening ? "Stop listening" : "Voice input"}
                      aria-label="Voice input"
                      className={voiceListening ? "atlas-voice-active" : ""}
                      style={{
                        minWidth: 44, minHeight: 44, padding: 6, borderRadius: 8,
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
                      aria-label="Stop generating"
                      style={{
                        minWidth: 44, minHeight: 44, padding: 3, borderRadius: 10,
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
                      aria-label="Send message"
                      style={{
                        minWidth: 44, minHeight: 44, padding: 3,
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
          </div>}

          {parkedCount > 0 && !showParkingDrawer && (
            <button
              type="button"
              onClick={() => { setShowParkingDrawer(true); void refreshParkedEntries(); }}
              style={{
                position: "absolute",
                right: 16,
                bottom: 104,
                zIndex: 42,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "6px 10px",
                borderRadius: 999,
                background: "var(--atlas-surface)",
                border: "1px solid var(--atlas-border)",
                color: "var(--atlas-muted)",
                cursor: "pointer",
                fontFamily: "var(--app-font-mono)",
                fontSize: 9,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                boxShadow: "0 12px 28px -20px var(--atlas-gold)",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block", flexShrink: 0 }} />
              {parkedCount} items
            </button>
          )}

          {showParkingDrawer && (
            <>
              <div
                onClick={() => setShowParkingDrawer(false)}
                style={{ position: "absolute", inset: 0, zIndex: 44, background: "color-mix(in oklab, var(--atlas-bg) 56%, transparent)" }}
              />
              <div
                className="atlas-slide-in-right"
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 45,
                  width: "min(360px, 92%)",
                  background: "var(--atlas-bg)",
                  borderLeft: "1px solid var(--atlas-border)",
                  boxShadow: "-24px 0 60px -38px var(--atlas-gold)",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ padding: "13px 14px", borderBottom: "1px solid var(--atlas-border)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", display: "inline-block" }} />
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
                    Parking Lot
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", opacity: 0.65 }}>
                    {parkedCount} items
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowParkingDrawer(false)}
                    style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 3px", opacity: 0.65 }}
                    aria-label="Close parking lot"
                  >
                    ×
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px" }} className="scrollbar-none">
                  {parkedEntries.length === 0 ? (
                    <div style={{ padding: "30px 10px", textAlign: "center", color: "var(--atlas-muted)", fontSize: 12, opacity: 0.6 }}>
                      Nothing parked right now.
                    </div>
                  ) : (
                    parkedEntries.map((entry) => <ParkingLotEntry key={entry.id} entry={entry} />)
                  )}
                </div>
              </div>
            </>
          )}
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
                onFillIntent={(text) => { setInput(text); setTimeout(() => autoResize(), 0); }}
                onMapReadinessChange={setMapReadiness}
                displayedReadinessScore={displayedReadinessScore}
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
                previewRefreshTrigger={previewRefreshTrigger}
                pendingTerminalCommand={pendingTerminalCommand}
                onTerminalCommandConsumed={() => setPendingTerminalCommand(null)}
                onCommandComplete={handleTerminalComplete}
                wsLens={wsLens}
                onOpenForge={() => setShowForgeExternal(true)}
                externalForgeNodes={externalForgeNodes}
                onForgeNodesConsumed={() => setExternalForgeNodes([])}
                onForgeCompleted={() => void updateForgeState("forged")}
                sessionId={sessionId ?? undefined}
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
                forceTab={mobileTab === "map" ? "map" : mobileTab === "files" ? "files" : mobileTab === "preview" ? "preview" : mobileTab === "workbench" ? "workbench" : undefined}
                onSendIntent={sendFromIntentCapture}
                onFillIntent={(text) => { setInput(text); setTimeout(() => autoResize(), 0); }}
                onBackToChat={mobileTab === "map" ? () => { setMobileTab("chat"); setRightOpen(false); } : undefined}
                onMapReadinessChange={setMapReadiness}
                displayedReadinessScore={displayedReadinessScore}
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
                previewRefreshTrigger={previewRefreshTrigger}
                pendingTerminalCommand={pendingTerminalCommand}
                onTerminalCommandConsumed={() => setPendingTerminalCommand(null)}
                onCommandComplete={handleTerminalComplete}
                wsLens={wsLens}
                onOpenForge={() => setShowForgeExternal(true)}
                externalForgeNodes={externalForgeNodes}
                onForgeNodesConsumed={() => setExternalForgeNodes([])}
                onForgeCompleted={() => void updateForgeState("forged")}
                sessionId={sessionId ?? undefined}
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

      {onboardingCoachVisible && (
        <WorkspaceOnboardingCoach
          isMobile={isMobile}
          dismissed={onboardingCoachDismissed}
          onDismiss={dismissOnboardingCoach}
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

      {showForgeExternal && (
        <TheForge
          projectId={forgeActiveProjectId ?? id}
          activeProjectName={forgeActiveProjectName ?? project?.name}
          preloadContent={forgePreloadContent}
          onClose={() => { setShowForgeExternal(false); setForgePreloadContent(undefined); }}
          onNodesReady={(nodes) => {
            // Push nodes to Flow canvas
            setExternalForgeNodes(nodes);
            // Store forge context for chat system prompt injection
            const ctx = nodes.map(n => `[${n.type}] ${n.label}`).join(" | ");
            setForgeContext(ctx);
            try { sessionStorage.setItem(`atlas-forge-ctx-${id}`, ctx); } catch {}
            void updateForgeState("forged");
            // Also switch right panel to the map tab so nodes are visible
            setDesktopForceTab("map");
            setTimeout(() => setDesktopForceTab(undefined), 80);
            if (isMobile) setMobileTab("map");
            setShowForgeExternal(false);
            setForgePreloadContent(undefined);
          }}
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
        onOpenQuickPrompt={() => { setShowDrawer(false); setShowForgeExternal(true); }}
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
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--atlas-border)", margin: "12px auto 4px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Model</span>
              <button onClick={() => setShowWsModelSheet(false)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div style={{ padding: "0 14px" }}>
              {([
                { id: "claude", label: "Claude", sub: "Architect · Nuance & Strategy", available: true, icon: "C" },
                { id: "gemini", label: "Gemini", sub: "Strategy · Long Context", available: true, icon: "Ge" },
                { id: "gpt4o", label: "GPT-4o", sub: "Mechanic · Speed & Logic", available: false, icon: "G" },
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
                    background: m.available ? "rgba(201,162,76,0.1)" : "var(--atlas-surface)",
                    border: `1px solid ${m.available ? "rgba(201,162,76,0.25)" : "var(--atlas-surface)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: "var(--app-font-mono)", fontSize: 9, fontWeight: 700,
                    color: m.available ? "rgba(201,162,76,0.85)" : "rgba(var(--atlas-muted-rgb),0.4)",
                    letterSpacing: "0.02em",
                  }}>
                    {m.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)", display: "flex", alignItems: "center", gap: 6 }}>
                      {m.label}
                      {!m.available && (
                        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.55, border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", borderRadius: 3, padding: "1px 4px" }}>COMING SOON</span>
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

      {/* ── Lens picker sheet ── */}
      {showLensPicker && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div onClick={() => setShowLensPicker(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }} />
          <div style={{
            position: "relative", zIndex: 1, width: "100%", maxWidth: 480,
            background: "var(--atlas-surface)", borderRadius: "16px 16px 0 0",
            borderTop: "1px solid rgba(201,162,76,0.18)",
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)", paddingBottom: 32,
          }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "var(--atlas-border)", margin: "12px auto 4px" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 16px 10px" }}>
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Lens</span>
              <button onClick={() => setShowLensPicker(false)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.6)", fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div style={{ padding: "0 14px" }}>
              {(Object.entries(LENS_CONFIG) as [WorkspaceLens, typeof LENS_CONFIG[WorkspaceLens]][]).map(([lensId, cfg]) => (
                <button
                  key={lensId}
                  onClick={() => setWsLens(lensId)}
                  style={{
                    width: "100%", textAlign: "left", padding: "11px 12px", borderRadius: 8,
                    background: wsLens === lensId ? `${cfg.glowColor}` : "transparent",
                    border: `1px solid ${wsLens === lensId ? cfg.borderColor : "transparent"}`,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 10, marginBottom: 2,
                    transition: "all 140ms ease",
                  }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: `${cfg.glowColor}`,
                    border: `1px solid ${cfg.borderColor}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: cfg.color, display: "block" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--app-font-sans)", fontSize: 13, fontWeight: 500, color: "var(--atlas-fg)" }}>
                      <span style={{ color: cfg.color }}>{cfg.label}</span>
                      {cfg.model && (
                        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.6, border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", borderRadius: 3, padding: "1px 4px" }}>
                          {cfg.model === "claude" ? "Claude" : "Gemini"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.05em", marginTop: 2, opacity: 0.7 }}>{cfg.sub}</div>
                  </div>
                  {wsLens === lensId && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {detectedLens === lensId && wsLens !== lensId && (
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 8, color: cfg.color, letterSpacing: "0.1em", border: `1px solid ${cfg.borderColor}`, borderRadius: 3, padding: "1px 5px", opacity: 0.85 }}>SUGGESTED</span>
                  )}
                </button>
              ))}
              <div style={{ margin: "10px 0 2px", padding: "8px 12px", background: "rgba(201,162,76,0.04)", borderRadius: 6, border: "1px solid rgba(201,162,76,0.1)" }}>
                <p style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, color: "var(--atlas-muted)", letterSpacing: "0.07em", margin: 0, lineHeight: 1.6 }}>
                  Lens shapes how Atlas responds — and sets the model. <span style={{ color: "rgba(201,162,76,0.7)" }}>Scenario</span> keeps the model you're already using.
                </p>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Scenario exit prompt ── */}
      {showScenarioPrompt && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 20px" }}>
          <div onClick={() => setShowScenarioPrompt(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} />
          <div style={{
            position: "relative", zIndex: 1, width: "100%", maxWidth: 360,
            background: "var(--atlas-surface)", borderRadius: 14,
            border: "1px solid rgba(120,113,108,0.35)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)", padding: "20px 20px 18px",
          }}>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(120,113,108,0.7)", marginBottom: 8 }}>Leaving Scenario</div>
            <div style={{ fontFamily: "var(--app-font-sans)", fontSize: 14, color: "var(--atlas-fg)", lineHeight: 1.5, marginBottom: 16 }}>
              What do you want to do with the scenario messages?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={async () => {
                  // Keep: persist buffered scenario messages to session DB
                  if (scenarioBuffer.length > 0 && sessionId) {
                    try {
                      await fetch("/api/chat/scenario-keep", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sessionId, messages: scenarioBuffer }),
                      });
                    } catch { /* non-fatal — messages stay in client state */ }
                  }
                  setScenarioBuffer([]);
                  if (pendingLensSwitch) {
                    setWsLensRaw(pendingLensSwitch);
                    setDetectedLens(null);
                    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, pendingLensSwitch); } catch {}
                    const cfg = LENS_CONFIG[pendingLensSwitch];
                    if (cfg.model) setWsModel(cfg.model);
                    scenarioStartIdxRef.current = -1;
                    setPendingLensSwitch(null);
                  }
                  setShowScenarioPrompt(false);
                  setShowLensPicker(false);
                }}
                style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: 13, textAlign: "left" }}
              >
                Keep — bring it into the project
              </button>
              <button
                onClick={() => {
                  // Discard: remove scenario messages from client state (already not in DB)
                  if (scenarioStartIdxRef.current >= 0) {
                    setMessages(prev => prev.slice(0, scenarioStartIdxRef.current));
                  }
                  setScenarioBuffer([]);
                  if (pendingLensSwitch) {
                    setWsLensRaw(pendingLensSwitch);
                    setDetectedLens(null);
                    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, pendingLensSwitch); } catch {}
                    const cfg = LENS_CONFIG[pendingLensSwitch];
                    if (cfg.model) setWsModel(cfg.model);
                    setPendingLensSwitch(null);
                  }
                  scenarioStartIdxRef.current = -1;
                  setShowScenarioPrompt(false);
                  setShowLensPicker(false);
                }}
                style={{ padding: "10px 14px", borderRadius: 8, background: "transparent", border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: 13, textAlign: "left" }}
              >
                Discard — remove from this session
              </button>
              <button
                onClick={() => { setShowScenarioPrompt(false); setPendingLensSwitch(null); }}
                style={{ padding: "8px 14px", borderRadius: 8, background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.06em", opacity: 0.55 }}
              >
                Stay in Scenario
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showVault && (
        <VisualVault
          projectId={id}
          onClose={() => setShowVault(false)}
        />
      )}

    </div>
  );
}
