import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useGetProject, getGetProjectQueryKey, updateProject, useUpdateProject, Project, Entry, Session, useListSessions, getListSessionsQueryKey, createSession, useCreateSession, useDeleteSession, useListEntries, getListEntriesQueryKey, getListProjectsQueryKey, useDeleteProject, useCreateProject, useListProjects, createEntry, useCreateEntry, useListReadinessSnapshots, getListReadinessSnapshotsQueryKey, useRecordReadinessSnapshot } from "@workspace/api-client-react";
import { toast } from "sonner";
import { createPortal } from "react-dom";
import type React from "react";
import { useParams, useLocation } from "wouter";
import { useRequireAuth } from "@/hooks/useAuth";
import { useSound } from "@/hooks/useSound";
import { useProjectState } from "@/hooks/useProjectState";
import { useComposerDraft } from "@/hooks/useComposerDraft";
import { useChatStream } from "@/hooks/useChatStream";
import { useSmartAutoScroll } from "@/hooks/useSmartAutoScroll";

import { useChatLens } from "@/hooks/useChatLens";
import { useComposerZip } from "@/hooks/useComposerZip";
import { useParkingLot } from "@/hooks/useParkingLot";
import { useForceDesktop, useIsMobile, useIsTinyScreen, useIsDesktop } from "@/hooks/useBreakpoints";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useGitHub } from "@/hooks/useGitHub";
import { AxiomFlow } from "../components/AxiomFlow";
import type { ArchNode, NodeStateMap, HandoverSnapshot } from "../components/AxiomFlow";
import { SystemMap } from "../components/SystemMap";
import type { ArchNode as SystemMapNode } from "../components/SystemMap";
import { TheForge } from "../components/TheForge";
import { GlossaryTip } from "../components/GlossaryTip";
import { VisualVault } from "../components/VisualVault";
import { GenerateBlueprintPill } from "../components/BlueprintsTab";
import { ImageGenerator } from "../components/ImageGenerator";

import { UnifiedContextDock } from "../components/UnifiedContextDock";
import { UnifiedSubheader, type UnifiedSubheaderTab } from "../components/UnifiedSubheader";
import { ProjectsDrawer } from "../components/ProjectsDrawer";
import { UserMenuDropdown } from "../components/UserMenuDropdown";
import { AccountHubPanel } from "../components/AccountHubPanel";
import { PreviewPanel, type ManifestDecision } from "../components/workspace/PreviewPanel";
import { LedgerPanel } from "../components/workspace/LedgerPanel";
import { FilesPanel } from "../components/workspace/FilesPanel";
import { FlowPanel, extractPersistedFlowNodes } from "../components/workspace/FlowPanel";
import { MapTab } from "@/components/workspace/MapTab";
import { ParkingLotEntry } from "@/components/workspace/ParkingLotEntry";
import { StreamingText, ChunkedBubbles } from "@/components/workspace/StreamingText";
import { LinePatchReviewCard, ReviewPlanCard, ReviewTabPanel, PushDiffCard } from "@/components/workspace/ReviewCards";
import { MenuBtn, AtlasLogo } from "@/components/workspace/atoms";
import { CommitHistoryCard, CommitHistorySkeleton, buildTree, GhTreeNodeRow } from "@/components/workspace/CommitHistory";
export { CommitHistoryCard, CommitHistorySkeleton, buildTree, GhTreeNodeRow };

import { ArtifactsPanel } from "@/components/workspace/ArtifactsPanel";
import { StatusGlyph } from "../components/StatusGlyph";
import { CapsuleTag } from "../components/CapsuleTag";
import { ZipDragOverlay, ZipPanel } from "../components/ZipImport";
import { ProjectSettingsPanel } from "../components/ProjectSettingsPanel";
import { HistoryBookmarksSheet } from "../components/HistoryBookmarksSheet";
import { SessionHistorySheet } from "../components/SessionHistorySheet";
import { NewProjectModal } from "../components/NewProjectModal";
import { RefreshCw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useThemeMode } from "@/lib/theme";
import { getAuthHeaders } from "@/lib/api";
import { fileToBase64Safe } from "@/lib/image-resize";
import { reportError } from "../lib/errorReporter";
import { normalizeGitHubRepoInput, parseLinkedRepo, serializeLinkedRepo } from "../lib/githubRepo";
import { loadProfile } from "@/lib/userProfile";
import type { Plan, PlanExecution } from "../lib/plan";
import { useQueryClient } from "@tanstack/react-query";
import {
  ReadinessRing,
  ReadinessTrend,
  ReadinessMode,
  READINESS_MODE_KEY,
  computeBlendedScore,
  computeScoreFromNodeState,
  MODE_META,
} from "../components/ReadinessRing";
import { ChatTrayHeader } from "@/components/ChatTrayHeader";
import { LongPressTip, haptic } from "@/lib/long-press-tip";
import { UserBubble } from "@/components/workspace/UserBubble";
import { AtlasActivityBar } from "@/components/workspace/AtlasActivityBar";
import { AtlasThinkingBlock } from "@/components/workspace/AtlasThinkingBlock";
import { FocusModeAura } from "@/components/FocusModeAura";


// ── Types ────────────────────────────────────────────────────────────────────
import { InsightChip } from "@/components/workspace/InsightChip";
import { useGithubPushToken } from "@/hooks/useGithubPushToken";
import { AssistantBubble } from "@/components/workspace/AssistantBubble";
import { ChatStream } from "@/components/workspace/ChatStream";
import { ChatComposer } from "@/components/workspace/ChatComposer";
import { DeepDiveSheet } from "@/components/DeepDiveSheet";
import { UnifiedConversationSurface } from "@/components/UnifiedConversationSurface";
import { MemoryTab } from "@/components/workspace/MemoryTab";
import { BlueprintsTab } from "@/components/BlueprintsTab";
import { SecretsPanel } from "@/components/workspace/SecretsPanel";
import { JobsPanel } from "@/components/workspace/JobsPanel";
import { McpPanel } from "@/components/workspace/McpPanel";
import { LaunchModal, type LaunchMode } from "@/components/workspace/LaunchModal";
import {
  type PlanState,
} from "@/components/workspace/chatShared";
import { extractStrategicIntent } from "@/lib/forgeExtract";
import { submitForgeIntake } from "@/lib/forgeIntake";
import { useCodegen } from "@/hooks/useCodegen";
import { ForgeIntakeSheet, FORGE_INTAKE_OPEN_EVENT } from "@/components/ForgeIntakeSheet";
import { buildParkedEntryPayload } from "@/lib/parking";


export interface AlertPayload {
  type: string;
  headline: string;
  detail: string;
  action: string;
}

export interface FileEdit {
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
  resolved?: boolean;
};

type HomeHandoffMeta = {
  parkedCount: number;
  flowNodeCount: number;
  goalLabel: string;
  nodes?: HomeHandoffNode[];
  parkedTitles?: string[];
};

function hasHomeHandoffNodeData(meta: HomeHandoffMeta | null): boolean {
  return Boolean((meta?.flowNodeCount ?? 0) > 0 || (meta?.nodes?.length ?? 0) > 0);
}

export interface LinePatch {
  path: string;
  find: string;
  replace: string;
}

export interface PushRecord {
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

export type AmbientSurface = {
  type: "MAP" | "WORKSPACE" | "DECISION";
  label: string;
  reason?: string | null;
  projectId?: number | null;
  workspaceId?: number | null;
} | null;

export type ClarifyPayload = {
  steps: Array<{
    question: string;
    options: string[];
    allowFreeText?: boolean;
  }>;
};

export interface BrowserResult {
  type: "screenshot" | "scrape" | "health" | "monitor";
  url: string;
  screenshotBase64?: string;
  analysis?: string;
  isHealthy?: boolean;
  issues?: string[];
  hasErrors?: boolean;
  consoleErrors?: string[];
  resourceErrors?: string[];
  errorPatterns?: string[];
  summary?: string;
}

export interface DeployQa {
  isHealthy: boolean;
  issues: string[];
  analysis?: string;
  screenshotBase64?: string;
}

export interface ChatMessage {
  id?: number;
  role: "user" | "assistant";
  content: string;
  researchResult?: { type: "research"; url: string; title: string; summary: string | null; headings: string[] } | null;
  displayAs?: "autoVerify";
  streaming?: boolean;
  terminalCmd?: unknown;
  terminalResult?: unknown;
  browserResult?: BrowserResult | null;
  deployQa?: DeployQa | null;
  intentType?: string | null;
  plan?: Plan;
  planFromHome?: boolean;
  planMode?: boolean;
  alertPayload?: AlertPayload | null;
  alertResolved?: boolean;
  clarify?: ClarifyPayload | null;
  fileEdit?: FileEdit;
  fileEdits?: FileEdit[];
  linePatches?: LinePatch[];
  memoryChips?: MemoryChip[];
  sentAt?: string;
  imageB64?: string;
  imageMimeType?: string;
  attachments?: Array<{ base64: string; mediaType: string; name?: string }>;
  autoFetchedFiles?: string[];
  model?: string;
  modelUsed?: string | null;
  isDeepDive?: boolean;
  autoPushed?: boolean;
  surface?: AmbientSurface;
  executionTimeMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costUsd?: number | null;
  artifact?: { type: string; title: string; content: string } | null;
  imageGen?: { images: Array<{ imageUrl: string; prompt: string; model: string; mode: "render" | "schematic" }> } | null;
  pendingSketch?: boolean;
  /** Time-travel: snapshot id linking this message to a workspace state. */
  snapshotId?: string;
  /** Time-travel: messages bypassed by a rollback. Kept in-array but filtered
   *  from upstream prompt history (safeguard #3) and dimmed in the UI. */
  reverted?: boolean;
}

export type MemoryChip = { label: string; insight?: string };

export interface LinkedRepo {
  fullName: string;
  defaultBranch: string;
  name: string;
}

type ManifestDecisionResponse = {
  ready?: boolean;
  missingCriteria?: string[];
  decision?: ManifestDecision;
  generatedCode?: string;
  componentName?: string;
};

type RightTab = "ledger" | "files" | "preview" | "memory" | "map" | "terminal" | "blueprints" | "connections" | "secrets" | "jobs" | "mcp" | "image" | "forge" | "artifacts" | "workbench";
type WorkspaceLeftTab = "chat" | "review" | "diff" | "blueprints" | "terminal" | "artifacts";
type OnboardingCoachId = "chat" | "ledger" | "flow";
const OPENING_MESSAGE_STORAGE_KEY = "atlas-opening-message";
const OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY = "atlas-opening-message-project-id";
const OPENING_CONVERSATION_STORAGE_KEY = "atlas-opening-conversation";
const THINK_FREELY_THREAD_STORAGE_KEY = "atlas-think-freely-thread";
const DEFAULT_NAMES = new Set([
  "New Project",
  "New Idea",
  "My Project",
  "Untitled",
  "Untitled project",
  "",
]);
type WorkspaceLens = "flow" | "build" | "look" | "scenario";

type LiveGenerationMode = "plan" | "blueprint" | "edit" | "thinking" | "sketch";

type ForgeState = { forged: boolean; dismissed: boolean };

type StoredThinkFreelyMessage = Omit<Partial<ChatMessage>, "id" | "role" | "content" | "sentAt"> & {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
  sentAt?: unknown;
};

function normalizeThinkFreelyThread(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ChatMessage[] => {
    if (!item || typeof item !== "object") return [];
    const message = item as StoredThinkFreelyMessage;
    if (message.role !== "user" && message.role !== "assistant") return [];
    if (typeof message.content !== "string") return [];

    const normalized: ChatMessage = {
      role: message.role,
      content: message.content,
    };
    if (typeof message.id === "number") normalized.id = message.id;
    const sentAt = typeof message.sentAt === "string"
      ? message.sentAt
      : typeof message.createdAt === "string"
        ? message.createdAt
        : undefined;
    if (sentAt) normalized.sentAt = sentAt;
    if (message.terminalCmd !== undefined) normalized.terminalCmd = message.terminalCmd;
    if (message.terminalResult !== undefined) normalized.terminalResult = message.terminalResult;
    if (typeof message.intentType === "string" || message.intentType === null) normalized.intentType = message.intentType;
    if (typeof message.model === "string") normalized.model = message.model;
    if (typeof message.modelUsed === "string" || message.modelUsed === null) normalized.modelUsed = message.modelUsed;
    if (typeof message.executionTimeMs === "number" || message.executionTimeMs === null) normalized.executionTimeMs = message.executionTimeMs;
    if (typeof message.inputTokens === "number" || message.inputTokens === null) normalized.inputTokens = message.inputTokens;
    if (typeof message.outputTokens === "number" || message.outputTokens === null) normalized.outputTokens = message.outputTokens;
    if (typeof message.costUsd === "number" || message.costUsd === null) normalized.costUsd = message.costUsd;
    if (message.plan) normalized.plan = message.plan;
    if (message.surface !== undefined) normalized.surface = message.surface;
    return [normalized];
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

export interface ProjectScan {
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

// User profile helpers moved to @/lib/userProfile.

// ProactiveAlertCard moved to @/components/workspace/AssistantBubble

// ── Chat bubbles + Memory Chips ──────────────────────────────────────────────

// ── InsightChip ───────────────────────────────────────────────────────────────



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






// InlineDiffCard moved to @/components/workspace/AssistantBubble

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

  // SKETCH_STEP: progressive steps emitted by the image-gen short-circuit.
  // Owns the card whenever any sketch step is present.
  const sketchSteps = [...content.matchAll(/SKETCH_STEP:\s*(.+)/gi)].map(m => m[1].trim());
  if (sketchSteps.length > 0) {
    mode = "sketch";
    steps.length = 0;
    for (const s of sketchSteps) uniquePush(steps, s);
  }

  return {
    mode,
    steps,
    shouldShow: pending || steps.length > 0,
  };
}




// AssistantBubble + AmbientEmergenceCard moved to @/components/workspace/AssistantBubble

// ── GitHub file browser ───────────────────────────────────────────────────────
export interface GhRepo {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  description: string | null;
  language: string | null;
  defaultBranch: string;
  updatedAt: string;
}

export interface GhTreeItem {
  path: string;
  type: "blob" | "tree";
  sha: string;
}

export interface GhFileContent {
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

export interface GhCommitSummary {
  sha: string;
  message: string;
  author: string;
  timestamp: string;
  url: string;
  files: GhCommitFile[];
}


export interface GhTreeNode {
  name: string;
  path: string;
  type: "blob" | "tree";
  ext?: string;
  children?: GhTreeNode[];
}

// ── Platform detection ────────────────────────────────────────────────────────

// ── GithubTokenInput ──────────────────────────────────────────────────────────
function GithubTokenInput({
  isConnected,
  isLoading,
  error,
  onDisconnect,
}: {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  onDisconnect: () => Promise<void>;
}) {
  const handleConnectWithGitHub = () => {
    void import("@/lib/oauthReturn").then(({ stashOauthReturn }) => stashOauthReturn());
    fetch("/api/github/oauth/start", {
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((r) => {
        if (r.status === 401) {
          window.location.href = "/login?reason=session_expired";
          return null;
        }
        return r.json() as Promise<{ url?: string }>;
      })
      .then((data) => {
        if (data?.url) window.location.href = data.url;
      });
  };

  if (isLoading) {
    return (
      <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.65 }}>
        Checking GitHub connection...
      </div>
    );
  }

  if (isConnected) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 11.5, color: "var(--atlas-fg)", opacity: 0.85, fontFamily: "var(--app-font-mono)" }}>
          GitHub connected at account level.
        </div>
        <button
          type="button"
          onClick={() => { void onDisconnect(); }}
          style={{
            alignSelf: "flex-start",
            padding: "6px 14px",
            borderRadius: 6,
            background: "transparent",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "rgba(252,165,165,0.8)",
            fontSize: 10,
            fontFamily: "var(--app-font-mono)",
            cursor: "pointer",
            letterSpacing: "0.06em",
          }}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--atlas-muted)", lineHeight: 1.6, opacity: 0.7 }}>
        Connect GitHub once for this account so Atlas can read and write code across projects.
      </div>
      {error && (
        <div style={{ fontSize: 10, color: "rgba(252,165,165,0.85)", fontFamily: "var(--app-font-mono)" }}>
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleConnectWithGitHub}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          borderRadius: 6,
          background: "var(--atlas-gold)",
          border: "none",
          color: "#0D0B09",
          fontSize: 10,
          fontFamily: "var(--app-font-mono)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        Connect with GitHub
      </button>
    </div>
  );
}

// ── ConnectionsTab ────────────────────────────────────────────────────────────
function ConnectionsTab({
  projectId,
  onSwitchToFiles,
  onOpenAccountSettings,
  showModelPicker,
  onShowModelPickerChange,
}: {
  projectId: number;
  onSwitchToFiles: () => void;
  onOpenAccountSettings: () => void;
  showModelPicker: boolean;
  onShowModelPickerChange: (v: boolean) => void;
}) {
  const { data: project } = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId) },
  });
  const updateProject = useUpdateProject();
  const {
    canRead: githubCanRead,
    canWrite: githubCanWrite,
    isLoading: githubLoading,
    error: githubError,
    status: githubStatus,
    statusLabel: githubStatusLabel,
  } = useGitHub(projectId);

  const [dbUrl, setDbUrl] = useState<string | null>(null);

  useEffect(() => {
    try { setDbUrl(localStorage.getItem(`atlas-db-url-${projectId}`)); } catch {}
  }, [projectId]);

  const linkedRepo = parseLinkedRepo(project?.linkedRepo);

  const repoName = linkedRepo?.fullName ?? null;
  const maskedDb = dbUrl ? dbUrl.replace(/:[^:@]*@/, ":***@") : null;

  const DOT_GREEN = "rgba(74,222,128,0.9)";
  const DOT_RED = "rgba(248,113,113,0.85)";
  const DOT_GOLD = "rgba(201,162,76,0.85)";

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "11px 14px",
    borderBottom: "1px solid var(--atlas-border)",
  };

  const dotStyle = (connected: boolean, colorOverride?: string): React.CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
    marginTop: 4,
    background: colorOverride ?? (connected ? DOT_GREEN : DOT_RED),
    boxShadow: colorOverride
      ? `0 0 6px ${colorOverride}`
      : connected
      ? "0 0 6px rgba(74,222,128,0.4)"
      : "0 0 6px rgba(248,113,113,0.3)",
  });

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--app-font-mono)",
    fontSize: 9,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--atlas-muted)",
    opacity: 0.65,
    marginBottom: 3,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 11.5,
    color: "var(--atlas-fg)",
    opacity: 0.85,
    fontFamily: "var(--app-font-mono)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };

  const missingStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(248,113,113,0.75)",
    fontStyle: "italic",
  };
  const readOnlyStyle: React.CSSProperties = {
    fontSize: 11.5,
    color: DOT_GOLD,
    opacity: 0.9,
    fontFamily: "var(--app-font-mono)",
  };

  const actionBtn: React.CSSProperties = {
    marginTop: 6,
    padding: "3px 9px",
    borderRadius: 5,
    border: "1px solid var(--atlas-border)",
    background: "transparent",
    color: "var(--atlas-gold)",
    fontSize: 10,
    fontFamily: "var(--app-font-mono)",
    letterSpacing: "0.07em",
    cursor: "pointer",
  };

  const removeRepo = () => {
    updateProject.mutate(
      { id: projectId, data: { linkedRepo: null } },
      {
        onSuccess: () => {
          toast.success("GitHub repo removed from this project.");
        },
        onError: () => {
          toast.error("Could not remove the linked repo.");
        },
      },
    );
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          padding: "7px 14px",
          borderBottom: "1px solid var(--atlas-border)",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
            color: "var(--atlas-muted)",
            opacity: 0.55,
          }}
        >
          Project Connections
        </span>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        <div style={rowStyle}>
          <div style={dotStyle(!!repoName)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>GitHub Repo</div>
            {repoName ? (
              <>
                <div style={valueStyle}>{repoName}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={onSwitchToFiles} style={actionBtn}>
                    Manage -&gt;
                  </button>
                  <button
                    type="button"
                    onClick={removeRepo}
                    style={{
                      ...actionBtn,
                      color: "rgba(252,165,165,0.9)",
                      border: "1px solid rgba(239,68,68,0.28)",
                    }}
                  >
                    Remove repo
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={missingStyle}>No repo linked</div>
                <button type="button" onClick={onSwitchToFiles} style={actionBtn}>
                  Link repo -&gt;
                </button>
              </>
            )}
          </div>
        </div>

        <div style={rowStyle}>
          <div
            style={dotStyle(
              githubCanWrite,
              githubLoading
                ? "rgba(160,160,160,0.5)"
                : githubStatus === "read-only"
                  ? DOT_GOLD
                  : undefined,
            )}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>GitHub</div>
            {githubLoading ? (
              <div style={missingStyle}>Checking connection...</div>
            ) : githubStatus === "read-only" ? (
              <div style={readOnlyStyle}>{githubStatusLabel}</div>
            ) : githubCanWrite ? (
              <div style={valueStyle}>{githubStatusLabel}</div>
            ) : (
              <div style={missingStyle}>{githubStatusLabel}</div>
            )}
            <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", opacity: 0.55, lineHeight: 1.5, marginTop: 4 }}>
              Projects inherit the user-level GitHub connection automatically.
            </div>
            <button type="button" onClick={onOpenAccountSettings} style={actionBtn}>
              Manage in account settings -&gt;
            </button>
            {githubError && (
              <div style={{ ...missingStyle, marginTop: 5, fontStyle: "normal" }}>{githubError}</div>
            )}
          </div>
        </div>

        <div style={rowStyle}>
          <div style={dotStyle(!!dbUrl)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={labelStyle}>Database</div>
            {maskedDb ? (
              <div style={valueStyle}>{maskedDb}</div>
            ) : (
              <div style={missingStyle}>No database connected</div>
            )}
            <button type="button" onClick={onSwitchToFiles} style={actionBtn}>
              {dbUrl ? "Change ->" : "Connect ->"}
            </button>
          </div>
        </div>

        <div style={rowStyle}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div>
              <div style={labelStyle}>Manual model selection</div>
              <div style={{ fontSize: 11, color: "var(--atlas-muted)", opacity: 0.55, marginTop: 2 }}>Show model picker in message bar</div>
            </div>
            <Switch
              checked={showModelPicker}
              onCheckedChange={onShowModelPickerChange}
            />
          </div>
        </div>

        <div
          style={{
            padding: "12px 14px",
            marginTop: 4,
          }}
        >
          {[!!repoName, githubCanRead, !!dbUrl].every(Boolean) ? (
            <div
              style={{
                fontSize: 11,
                color: "rgba(74,222,128,0.75)",
                fontFamily: "var(--app-font-mono)",
                letterSpacing: "0.04em",
              }}
            >
              All connections active - Atlas has full context.
            </div>
          ) : (
            <div
              style={{
                fontSize: 11,
                color: "var(--atlas-muted)",
                opacity: 0.55,
                lineHeight: 1.6,
              }}
            >
              {[
                !repoName && "Link a GitHub repo so Atlas can read and write files.",
                !githubCanRead && "Connect GitHub to enable file reading.",
                !dbUrl && "Connect a database so Atlas can reference your schema.",
              ]
                .filter(Boolean)
                .map((msg, i) => (
                  <div key={i} style={{ marginBottom: 4 }}>
                    {`. ${msg}`}
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RightPanel (tabbed) ──────────────────────────────────────────────────────
function RightPanel({
  projectId,
  projectName,
  entries,
  onClose,
  fullscreen,
  onToggleFullscreen,
  onFileContext,
  onLinkedRepoChange,
  dbUrl,
  onDbUrlChange,
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
  sessionId,
  manifestDecision,
  manifestPreviewHtml,
  pendingTerminalCommand,
  onTerminalCommandConsumed,
  onCommandComplete,
  wsLens,
  onOpenForge,
  externalForgeNodes,
  onForgeNodesConsumed,
  onForgeCompleted,
  onContinueSession,
  onNavLedger,
  onNavPreview,
  onOpenConnections,
  onOpenAccountSettings,
  onZipTrigger,
  zipLoaded,
  zipFileName,
  showModelPicker,
  onShowModelPickerChange,
  messages: messagesProp,
}: {
  projectId: number;
  projectName: string;
  entries: Entry[];
  onClose?: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onFileContext: (ctx: string | null) => void;
  onLinkedRepoChange: (repo: LinkedRepo | null) => void;
  dbUrl: string | null;
  onDbUrlChange: (url: string | null) => void;
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
  sessionId?: number;
  manifestDecision?: ManifestDecision | null;
  manifestPreviewHtml?: string | null;
  pendingTerminalCommand?: string | null;
  onTerminalCommandConsumed?: () => void;
  onCommandComplete?: (command: string, output: string, exitCode: number | null) => void;
  wsLens?: WorkspaceLens;
  onOpenForge?: () => void;
  externalForgeNodes?: ArchNode[];
  onForgeNodesConsumed?: () => void;
  onForgeCompleted?: () => void;
  onContinueSession?: (sessionId: number | string) => void;
  onNavLedger?: () => void;
  onNavPreview?: () => void;
  onOpenConnections?: () => void;
  onOpenAccountSettings: () => void;
  onZipTrigger?: () => void;
  zipLoaded?: boolean;
  zipFileName?: string;
  showModelPicker: boolean;
  onShowModelPickerChange: (v: boolean) => void;
  messages?: ChatMessage[];
}) {
  const [tab, setTab] = useState<RightTab>(() => {
    try {
      const stored = sessionStorage.getItem("atlas-open-tab");
      const viewFlow = new URLSearchParams(window.location.search).get("view") === "flow";
      // Either signal is sufficient to open directly on the flow map —
      // sessionStorage flag (set by intra-app handoffs) OR ?view=flow
      // (set by Master Map warp / "Open flow map" buttons).
      if (stored === "map" || viewFlow) {
        if (stored === "map") sessionStorage.removeItem("atlas-open-tab");
        return "map";
      }
    } catch {}
    return "ledger";
  });
  const [ledgerSubTab, setLedgerSubTab] = useState<"entries" | "memory">("entries");

  useEffect(() => {
    if (forceTab) setTab(forceTab);
  }, [forceTab]);

  const openConnections = useCallback(() => {
    setTab("connections");
    onOpenConnections?.();
  }, [onOpenConnections]);

  // Terminal is always available — no auto-fallback on lens change.


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
      id: "blueprints" as RightTab,
      label: "Blueprints",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <path d="M2 2h8l3 3v9H2V2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M10 2v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M4 7h6M4 9.5h6M4 12h4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
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
    {
      id: "connections" as RightTab,
      label: "Connections",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="12" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6.5 8h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M1.5 5.5C1.5 3.5 3 2 4 2M1.5 10.5C1.5 12.5 3 14 4 14" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity={0.45} />
          <path d="M14.5 5.5C14.5 3.5 13 2 12 2M14.5 10.5C14.5 12.5 13 14 12 14" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" opacity={0.45} />
        </svg>
      ),
    },
    {
      id: "secrets" as RightTab,
      label: "Secrets",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="3" y="7" width="10" height="7" rx="1.5" 
            stroke="currentColor" strokeWidth="1.2"/>
          <path d="M5 7V5a3 3 0 016 0v2" 
            stroke="currentColor" strokeWidth="1.2" 
            strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "jobs" as RightTab,
      label: "Jobs",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" 
          fill="none">
          <circle cx="8" cy="8" r="6" 
            stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8 5v3.5l2 1.5" 
            stroke="currentColor" strokeWidth="1.2" 
            strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "mcp" as RightTab,
      label: "MCP",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" 
          fill="none">
          <circle cx="4" cy="8" r="2" 
            stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="12" cy="4" r="2" 
            stroke="currentColor" strokeWidth="1.2"/>
          <circle cx="12" cy="12" r="2" 
            stroke="currentColor" strokeWidth="1.2"/>
          <path d="M6 7.5l4-2.5M6 8.5l4 2.5" 
            stroke="currentColor" strokeWidth="1.1" 
            strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: "image" as RightTab,
      label: "IMAGE",
      icon: (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="6" cy="6" r="1.2" fill="currentColor" opacity={0.55} />
          <path d="M3.5 12l3.2-3.2 2.1 2.1 1.6-1.6 2.1 2.7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    ...(wsLens === "build" || wsLens === "scenario" ? [{
      id: "terminal" as RightTab,
      label: "Console",
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
        background: "var(--atlas-surface-alt)", overflow: "hidden", minHeight: 0,
      }}
    >
      {/* Tab bar — desktop only; on mobile the MobileTabBar drives navigation */}
      <div
        style={{
          display: isMobile ? "none" : "flex", alignItems: "center",
          flexShrink: 0,
          paddingLeft: 6,
          overflowX: "auto",
          scrollbarWidth: "none",
          whiteSpace: "nowrap",
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
                padding: "10px 10px",
                background: "transparent", border: "none",
                borderBottom: `2px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                cursor: "pointer",
                color: active ? "var(--atlas-gold)" : "var(--atlas-muted)",
                opacity: active ? 1 : 0.55,
                transition: "all 160ms ease",
                fontFamily: "var(--app-font-mono)",
                fontSize: "var(--ts-xs)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                marginBottom: -1,
                flexShrink: 0,
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
                    fontSize: "var(--ts-tiny)",
                  }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
        {/* Desktop: passive Forge-awareness pill.
            Replaces the legacy "Forge Thread →" handoff button.
            Forge already reads thread context via the memory bucket;
            this pill surfaces that ambient connection and routes the
            user to the Memory tab to inspect what's been surfaced. */}
        {!isMobile && (
          <>
            <div style={{ flex: 1 }} />
            {(() => {
              const surfacedCount = currentSnapshot?.definedCount ?? 0;
              return (
                <button
                  onClick={() => setTab("memory")}
                  title="Forge is continuously reading this thread. Tap to inspect surfaced memories."
                  style={{
                    marginRight: 8,
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "rgba(201,162,76,0.06)",
                    border: "1px solid rgba(201,162,76,0.22)",
                    color: "rgba(201,162,76,0.85)",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: "var(--ts-xs)",
                    fontWeight: 500,
                    letterSpacing: "0.08em",
                    textTransform: "none",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    transition: "all 160ms ease",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.1)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(201,162,76,0.06)"; }}
                >
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: "var(--atlas-gold)",
                    boxShadow: "0 0 6px rgba(201,162,76,0.6)",
                  }} />
                  Forge is reading this thread
                  {surfacedCount > 0 && (
                    <span style={{ opacity: 0.75 }}>
                      · {surfacedCount} {surfacedCount === 1 ? "memory" : "memories"} surfaced
                    </span>
                  )}
                </button>
              );
            })()}
          </>
        )}

        {!isMobile && !onHandover && <div style={{ flex: 1 }} />}

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
              color: "var(--atlas-muted)", fontSize: "var(--ts-base)", lineHeight: 1,
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
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <LedgerPanel projectId={projectId} entries={entries} pushHistory={pushHistory} onRollbackPush={onRollbackPush} messages={messagesProp} />
        </div>
      )}
      {tab === "artifacts" && <ArtifactsPanel projectId={projectId} />}
      {tab === "blueprints" && <BlueprintsTab projectId={projectId} />}
      {tab === "files" && (
        <FilesPanel
          projectId={projectId}
          onFileContext={onFileContext}
          onLinkedRepoChange={onLinkedRepoChange}
          dbUrl={dbUrl}
          onDbUrlChange={onDbUrlChange}
          onZipTrigger={onZipTrigger}
          zipLoaded={zipLoaded}
          zipFileName={zipFileName}
          onOpenConnections={openConnections}
          wsLens={wsLens}
        />
      )}
      {tab === "connections" && <ConnectionsTab projectId={projectId} onSwitchToFiles={() => setTab("files")} onOpenAccountSettings={onOpenAccountSettings} showModelPicker={showModelPicker} onShowModelPickerChange={onShowModelPickerChange} />}
      {tab === "secrets" && (
        <SecretsPanel 
          projectId={projectId} 
          projectName={projectName} 
        />
      )}
      {tab === "jobs" && (
        <JobsPanel projectId={projectId} />
      )}
      {tab === "mcp" && (
        <McpPanel projectId={projectId} />
      )}
      {tab === "image" && (
        <div style={{ padding: 16 }}>
          <ImageGenerator compact />
        </div>
      )}
      {tab === "preview" && <PreviewPanel projectId={projectId} sandboxCode={sandboxCode} onSandboxConsumed={onSandboxConsumed} refreshTrigger={previewRefreshTrigger} sessionId={sessionId} onSwitchToFiles={() => setTab("files")} manifestDecision={manifestDecision} manifestPreviewHtml={manifestPreviewHtml} />}
      {tab === "memory" && <MemoryTab projectId={projectId} />}
      {tab === "map" && <FlowPanel projectId={projectId} onHomeNav={onHomeNav} onSendIntent={onSendIntent} onFillIntent={onFillIntent} onBackToChat={onBackToChat} onNavLedger={onNavLedger ?? (() => setTab("ledger"))} onNavPreview={onNavPreview ?? (() => setTab("preview"))} onMapReadinessChange={onMapReadinessChange} displayedReadinessScore={displayedReadinessScore} onSystemNodeMessage={onSystemNodeMessage} onHandover={onHandover} handoverPending={handoverPending} lastHandoverHash={lastHandoverHash} resolvedNodeIds={resolvedNodeIds} onResolvedConsumed={onResolvedConsumed} onSnapshotChange={onSnapshotChange} handoverOpen={handoverOpen} onHandoverOpenChange={onHandoverOpenChange} isMobile={isMobile} onOpenForge={onOpenForge} externalForgeNodes={externalForgeNodes} onForgeNodesConsumed={onForgeNodesConsumed} onForgeCompleted={onForgeCompleted} entryCount={entries?.length} />}
      {tab === "terminal" && <TerminalPanel pendingCommand={pendingTerminalCommand} onCommandConsumed={onTerminalCommandConsumed} onCommandComplete={onCommandComplete} scenarioLens={wsLens === "scenario"} projectId={projectId} />}
    </div>
  );
}

// ── TerminalPanel ─────────────────────────────────────────────────────────────
type TerminalLine = { text: string; kind: "input" | "output" | "stderr" | "system" | "error" | "warning" | "commentary" };

const TERMINAL_DANGER_PATTERNS: { pattern: RegExp; warning: string }[] = [
  { pattern: /(?:^|\s)git\s+reset\s+--hard(?:\s|$)/, warning: "This will permanently discard all uncommitted changes." },
  { pattern: /(?:^|\s)git\s+push(?=.*(?:^|\s)(?:--force|-f)(?:\s|$))/, warning: "This will overwrite remote history. This cannot be undone." },
  { pattern: /(?:^|\s)rm\s+-rf(?:\s|$)/, warning: "This will permanently delete files." },
  { pattern: /(?:^|\s)git\s+clean\s+-fd(?:\s|$)/, warning: "This will delete all untracked files." },
];

const TERMINAL_SUCCESS_EXPLANATIONS: { pattern: RegExp; explanation: string }[] = [
  { pattern: /^git\s+status(?:\s|$)/, explanation: "[ATLAS] Shows current branch, staged changes, and untracked files." },
  { pattern: /^git\s+push(?:\s|$)/, explanation: "[ATLAS] Changes pushed to GitHub. Replit will pick up the latest commit." },
  { pattern: /^git\s+commit(?:\s|$)/, explanation: "[ATLAS] Snapshot saved to local git history." },
  { pattern: /^git\s+pull(?:\s|$)/, explanation: "[ATLAS] Latest changes pulled from GitHub into your local branch." },
  { pattern: /^ls(?:\s|$)/, explanation: "[ATLAS] Lists files and folders in the current directory." },
  { pattern: /^pwd(?:\s|$)/, explanation: "[ATLAS] Shows your current location in the file system." },
];

function getTerminalWarning(command: string) {
  return TERMINAL_DANGER_PATTERNS.find(({ pattern }) => pattern.test(command))?.warning;
}

function getTerminalSuccessExplanation(command: string) {
  return TERMINAL_SUCCESS_EXPLANATIONS.find(({ pattern }) => pattern.test(command))?.explanation;
}

function buildAtlasCommitMessage(files: string[]): string {
  if (files.length === 0) return "";
  const buckets = {
    styles: 0, components: 0, pages: 0, hooks: 0, lib: 0,
    api: 0, db: 0, docs: 0, config: 0, tests: 0, other: 0,
  };
  for (const f of files) {
    const lower = f.toLowerCase();
    if (/\.(css|scss|sass)$/.test(lower) || lower.includes("/styles")) buckets.styles++;
    else if (lower.includes("/components/")) buckets.components++;
    else if (lower.includes("/pages/") || lower.includes("/routes/")) buckets.pages++;
    else if (lower.includes("/hooks/")) buckets.hooks++;
    else if (lower.includes("/lib/") || lower.includes("/utils/")) buckets.lib++;
    else if (lower.includes("/api/") || lower.includes("functions/")) buckets.api++;
    else if (lower.includes("migrations/") || lower.endsWith(".sql")) buckets.db++;
    else if (/\.(md|mdx)$/.test(lower)) buckets.docs++;
    else if (/\.(json|toml|yml|yaml)$/.test(lower) || lower.endsWith(".config.ts") || lower.endsWith(".config.js")) buckets.config++;
    else if (lower.includes(".test.") || lower.includes(".spec.")) buckets.tests++;
    else buckets.other++;
  }
  const parts: string[] = [];
  if (buckets.styles) parts.push(`refined styling`);
  if (buckets.components) parts.push(`updated ${buckets.components} component${buckets.components === 1 ? "" : "s"}`);
  if (buckets.pages) parts.push(`reworked ${buckets.pages} page${buckets.pages === 1 ? "" : "s"}`);
  if (buckets.hooks) parts.push(`adjusted hooks`);
  if (buckets.lib) parts.push(`tidied helpers`);
  if (buckets.api) parts.push(`updated backend logic`);
  if (buckets.db) parts.push(`evolved the database`);
  if (buckets.docs) parts.push(`refreshed docs`);
  if (buckets.config) parts.push(`tuned configuration`);
  if (buckets.tests) parts.push(`added tests`);
  if (parts.length === 0) {
    const sample = files.slice(0, 2).map(f => f.split("/").pop()).filter(Boolean).join(", ");
    parts.push(`updated ${files.length} file${files.length === 1 ? "" : "s"}${sample ? ` (${sample}${files.length > 2 ? "…" : ""})` : ""}`);
  }
  const summary = parts.length === 1
    ? parts[0]
    : parts.length === 2
      ? `${parts[0]} and ${parts[1]}`
      : `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
  // Capitalize first letter
  const cap = summary.charAt(0).toUpperCase() + summary.slice(1);
  return `Atlas: ${cap}`;
}

function TerminalPanel({

  pendingCommand,
  onCommandConsumed,
  onCommandComplete,
  scenarioLens,
  projectId,
}: {
  pendingCommand?: string | null;
  onCommandConsumed?: () => void;
  onCommandComplete?: (command: string, output: string, exitCode: number | null) => void;
  scenarioLens?: boolean;
  projectId?: number;
}) {
  const termTheme = useThemeMode();
  const isParchment = termTheme === "parchment";

  // ── Sync to GitHub state ──────────────────────────────────────────────────
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncFiles, setSyncFiles] = useState<string[]>([]);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncMsgTouched, setSyncMsgTouched] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "pushing" | "done" | "error">("idle");
  const [syncResult, setSyncResult] = useState<{ url: string; shortSha: string; filesCommitted: number } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const poll = () => {
      fetch("/api/self/modified", {
        credentials: "include",
        headers: getAuthHeaders(),
      })
        .then(r => r.ok ? r.json() : { files: [] })
        .then((d: any) => setSyncFiles(d.files ?? []))
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  // Auto-suggest a plain-English commit message describing Atlas's recent edits.
  useEffect(() => {
    if (syncMsgTouched) return;
    if (syncFiles.length === 0) { setSyncMsg(""); return; }
    setSyncMsg(buildAtlasCommitMessage(syncFiles));
  }, [syncFiles, syncMsgTouched]);

  const handlePush = async () => {
    if (syncStatus === "pushing") return;
    setSyncStatus("pushing");
    setSyncError(null);
    setSyncResult(null);
    try {
      const r = await fetch("/api/self/push", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ message: syncMsg.trim() || "feat: atlas self-update", files: syncFiles.length > 0 ? syncFiles : undefined }),
      });
      const d = await r.json() as any;
      if (!r.ok) { setSyncStatus("error"); setSyncError(d.error ?? "Push failed"); return; }
      setSyncStatus("done");
      setSyncResult({ url: d.url, shortSha: d.shortSha, filesCommitted: d.filesCommitted });
      setSyncFiles([]);
      setSyncMsg("");
      setSyncMsgTouched(false);
    } catch (err) {
      setSyncStatus("error");
      setSyncError(err instanceof Error ? err.message : "Network error");
    }
  };


  const [input, setInput] = useState("");
  const [lines, setLines] = useState<TerminalLine[]>([
    { text: "~/workspace$", kind: "system" },
  ]);
  const [running, setRunning] = useState(false);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fromAtlasRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const isDesktopView = useIsDesktop();
  const [nlMode, setNlMode] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nlPending, setNlPending] = useState(false);


  const killCommand = useCallback(() => {
    if (abortCtrlRef.current) {
      abortCtrlRef.current.abort();
      abortCtrlRef.current = null;
    }
    setRunning(false);
    setLines((prev) => [...prev, { text: "[killed]", kind: "system" as const }]);
  }, []);

  const addLine = useCallback((text: string, kind: TerminalLine["kind"]) => {
    const parts = text.split("\n");
    setLines((prev) => [
      ...prev,
      ...parts.filter((p) => p !== "").map((p) => ({ text: p, kind })),
    ]);
  }, []);

  const welcomeLines = useCallback((): TerminalLine[] => [
    { text: "~/workspace$", kind: "system" },
  ], []);

  const runCommand = useCallback(async (cmd: string) => {
    const trimmed = cmd.trim();
    if (!trimmed || running) return;

    // Built-in: clear / cls
    if (trimmed === "clear" || trimmed === "cls") {
      setLines(welcomeLines());
      return;
    }

    // Built-in: help
    if (trimmed === "help") {
      addLine(`$ ${trimmed}`, "input");
      addLine(
        `COMMON COMMANDS\n` +
        `───────────────────────────────\n` +
        `git status      see what changed in your repo\n` +
        `git push        send changes to GitHub → triggers deploy\n` +
        `git pull        get latest changes from GitHub\n` +
        `git log         see recent commits\n` +
        `git diff        see exact line changes\n` +
        `ls              list files in this folder\n` +
        `pwd             show current location\n` +
        `cat <file>      read a file's contents\n` +
        `clear           clear the terminal\n\n` +
        `ATLAS COMMANDS\n` +
        `───────────────────────────────\n` +
        `Ask Atlas in Chat and it can suggest\n` +
        `commands to run here automatically.`,
        "output"
      );
      return;
    }

    setRunning(true);
    setCmdHistory((h) => [trimmed, ...h.slice(0, 49)]);
    setHistIdx(-1);
    addLine(`$ ${trimmed}`, "input");

    // SCENARIO mode — explain rather than execute
    if (scenarioLens) {
      addLine("[SCENARIO] Asking Atlas what this command would do…", "system");
      try {
        const r = await fetch("/api/terminal/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...getAuthHeaders() },
          body: JSON.stringify({ command: trimmed, ...(projectId != null ? { projectId } : {}) }),
          credentials: "include",
        });
        const data = await r.json() as { explanation?: string; error?: string };
        if (data.explanation) {
          addLine(`[ATLAS EXPLAINS] ${data.explanation}`, "commentary");
        } else {
          addLine(`Error: ${data.error ?? "Could not generate explanation"}`, "error");
        }
      } catch (err) {
        addLine(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
      setRunning(false);
      return;
    }

    const warning = getTerminalWarning(trimmed);
    if (warning) addLine(`[ATLAS WARNING] ${warning}`, "warning");

    const outputChunks: string[] = [];
    let finalExitCode: number | null = null;

    const abortCtrl = new AbortController();
    abortCtrlRef.current = abortCtrl;

    try {
      const res = await fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ command: trimmed, ...(projectId != null ? { projectId } : {}) }),
        credentials: "include",
        signal: abortCtrl.signal,
      });

      if (!res.body) {
        const text = await res.text().catch(() => "");
        if (text) {
          outputChunks.push(text);
          addLine(text, res.ok ? "output" : "error");
        }
        finalExitCode = res.ok ? 0 : res.status;
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processSseBlock = (block: string) => {
          let evtName = "output";
          let evtData = "";
          for (const line of block.split("\n")) {
            const normalizedLine = line.endsWith("\r") ? line.slice(0, -1) : line;
            if (normalizedLine.startsWith("event: ")) evtName = normalizedLine.slice(7).trim();
            else if (normalizedLine.startsWith("data: ")) evtData = normalizedLine.slice(6);
          }
          if (!evtData) return;

          let payload: unknown = evtData;
          try { payload = JSON.parse(evtData); } catch {}

          if (evtName === "done") {
            let meta: unknown = payload;
            if (typeof payload === "string") {
              try { meta = JSON.parse(payload); } catch {}
            }
            if (meta && typeof meta === "object") {
              const doneMeta = meta as { exitCode?: unknown; exit_code?: unknown; code?: unknown };
              const rawExitCode = doneMeta.exitCode ?? doneMeta.exit_code ?? doneMeta.code;
              const parsedExitCode = typeof rawExitCode === "number"
                ? rawExitCode
                : typeof rawExitCode === "string" && rawExitCode.trim() !== ""
                  ? Number(rawExitCode)
                  : 0;
              finalExitCode = Number.isFinite(parsedExitCode) ? parsedExitCode : 0;
            } else {
              finalExitCode = 0;
            }
          } else if (evtName === "error") {
            const text = typeof payload === "string" ? payload : String(payload);
            outputChunks.push(text);
            addLine(text, "error");
            finalExitCode = finalExitCode ?? 1;
          } else if (typeof payload === "string") {
            outputChunks.push(payload);
            addLine(payload, evtName === "stderr" ? "stderr" : "output");
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) processSseBlock(block);
        }

        buffer += decoder.decode();
        if (buffer.trim()) processSseBlock(buffer);
        finalExitCode = finalExitCode ?? (res.ok ? 0 : res.status);
      }

      addLine(
        finalExitCode === 0 ? "✔ Exit code 0" : `✕ Exit code ${finalExitCode}`,
        finalExitCode === 0 ? "system" : "error"
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // user killed it — already handled by killCommand
      } else {
        addLine(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
      }
    }

    abortCtrlRef.current = null;

    if (finalExitCode === 0) {
      const explanation = getTerminalSuccessExplanation(trimmed);
      if (explanation) addLine(explanation, "commentary");
    }

    setRunning(false);

    if (fromAtlasRef.current && onCommandComplete) {
      const fullOutput = outputChunks.join("\n").trim();
      if (fullOutput) {
        onCommandComplete(trimmed, fullOutput.slice(0, 4000), finalExitCode);
      }
    }
    fromAtlasRef.current = false;
  }, [running, addLine, onCommandComplete, scenarioLens, welcomeLines, projectId]);

  useEffect(() => {
    if (pendingCommand) {
      fromAtlasRef.current = true;
      setInput("");
      runCommand(pendingCommand);
      onCommandConsumed?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const runNaturalLanguage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || nlPending || running) return;
    addLine(`▸ ${trimmed}`, "input");
    setNlPending(true);
    try {
      const r = await fetch("/api/terminal/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ command: trimmed, ...(projectId != null ? { projectId } : {}) }),
        credentials: "include",
      });
      const data = await r.json() as { explanation?: string; error?: string };
      if (data.explanation) addLine(`[ATLAS] ${data.explanation}`, "commentary");
      else addLine(`Error: ${data.error ?? "Atlas could not translate that request"}`, "error");
    } catch (err) {
      addLine(`Error: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setNlPending(false);
    }
  }, [addLine, nlPending, running, projectId]);

  const submitInput = useCallback(() => {
    const value = input;
    setInput("");
    if (nlMode) runNaturalLanguage(value);
    else runCommand(value);
  }, [input, nlMode, runCommand, runNaturalLanguage]);

  const [activeMacro, setActiveMacro] = useState<string>("npm run build");
  const runMacro = useCallback((cmd: string) => {
    if (cmd === "__clear__") { setLines(welcomeLines()); return; }
    setNlMode(false);
    runCommand(cmd);
  }, [runCommand, welcomeLines]);

  const MACROS: { label: string; shortLabel: string; icon: string; cmd: string }[] = [
    { label: "Build Project",         shortLabel: "Build",   icon: "🛠️", cmd: "npm run build" },
    { label: "Test Server",           shortLabel: "Test",    icon: "🔄", cmd: "curl -s -o /dev/null -w 'HTTP %{http_code}\\n' http://localhost:5173 || echo offline" },
    { label: "Install Dependencies",  shortLabel: "Install", icon: "📦", cmd: "npm install" },
    { label: "Clear Terminal",        shortLabel: "Clear",   icon: "🧹", cmd: "__clear__" },
  ];

  const HELP_GROUPS: { title: string; items: { cmd: string; desc: string }[] }[] = [
    { title: "Working with Files", items: [
      { cmd: "ls",          desc: "List files in this folder" },
      { cmd: "pwd",         desc: "Show current location" },
      { cmd: "cat <file>",  desc: "Read a file's contents" },
    ]},
    { title: "Checking Logs & Status", items: [
      { cmd: "git status",  desc: "See what changed in your repo" },
      { cmd: "git log",     desc: "See recent commits" },
      { cmd: "git diff",    desc: "See exact line changes" },
    ]},
    { title: "Fixed Actions", items: [
      { cmd: "git push",    desc: "Send changes to GitHub → deploy" },
      { cmd: "git pull",    desc: "Pull latest from GitHub" },
      { cmd: "clear",       desc: "Clear the terminal" },
    ]},
  ];

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      submitInput();
    } else if (!nlMode && e.key === "ArrowUp") {
      e.preventDefault();
      const next = Math.min(histIdx + 1, cmdHistory.length - 1);
      setHistIdx(next);
      setInput(cmdHistory[next] ?? "");
    } else if (!nlMode && e.key === "ArrowDown") {
      e.preventDefault();
      const next = Math.max(histIdx - 1, -1);
      setHistIdx(next);
      setInput(next === -1 ? "" : cmdHistory[next] ?? "");
    }
  };


  // ── Theme-aware terminal palette ──────────────────────────────────────────
  const termBg      = isParchment ? "#F4EFE6" : "#0A0908";
  const termInputBg = isParchment ? "#EAE4D8" : "var(--atlas-bg)";
  const termBorder  = isParchment ? "rgba(160,130,90,0.28)" : "var(--atlas-surface)";
  const termPrompt  = isParchment ? "#8B3E0E" : "rgba(201,162,76,0.75)";
  const termCaret   = isParchment ? "rgba(139,62,14,0.9)" : "rgba(201,162,76,0.9)";
  const termFgText  = isParchment ? "#2A1A0E" : "var(--atlas-fg)";

  const colorFor = (kind: TerminalLine["kind"]) => {
    if (kind === "input")      return isParchment ? "rgba(146,64,14,0.88)"  : "rgba(201,162,76,0.92)";
    if (kind === "stderr")     return isParchment ? "rgba(160,70,10,0.9)"   : "rgba(252,165,100,0.88)";
    if (kind === "system")     return isParchment ? "rgba(100,70,40,0.55)"  : "rgba(var(--atlas-muted-rgb),0.65)";
    if (kind === "error")      return isParchment ? "rgba(170,30,30,0.9)"   : "rgba(252,100,100,0.88)";
    if (kind === "warning")    return isParchment ? "#8B3E0E"               : "var(--atlas-gold)";
    if (kind === "commentary") return isParchment ? "rgba(100,70,40,0.72)"  : "var(--muted-foreground)";
    return termFgText;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: termBg, overflow: "hidden", position: "relative" }}>
      {/* ── Sync to GitHub bar ─────────────────────────────────────────── */}
      {!scenarioLens && (() => {
        const expanded = syncOpen || isDesktopView;
        const hasChanges = syncFiles.length > 0;
        const pulseColor = syncStatus === "pushing"
          ? "rgba(201,162,76,0.9)"
          : syncStatus === "done"
            ? "#34d399"
            : hasChanges
              ? "var(--atlas-gold)"
              : "rgba(var(--atlas-muted-rgb),0.45)";
        return (
        <div style={{
          borderBottom: `1px solid ${termBorder}`, flexShrink: 0,
          background: isDesktopView
            ? "linear-gradient(180deg, color-mix(in oklab, var(--atlas-gold) 5%, transparent), transparent 70%)"
            : "transparent",
        }}>
          {/* Header / toggle */}
          <button
            onClick={() => {
              if (isDesktopView) return;
              setSyncOpen(o => !o); setSyncStatus("idle"); setSyncError(null); setSyncResult(null);
            }}
            aria-expanded={expanded}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 8,
              padding: "9px 13px", background: "transparent", border: "none",
              cursor: isDesktopView ? "default" : "pointer", textAlign: "left",
            }}
          >
            {/* Live status dot */}
            <span style={{
              width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
              background: pulseColor,
              boxShadow: `0 0 8px ${pulseColor}`,
              animation: hasChanges || syncStatus === "pushing" ? "atlas-pulse 1.8s ease-in-out infinite" : "none",
            }} />
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
              <path d="M5.5 1v9M1 5.5l4.5-4.5 4.5 4.5" stroke={isParchment ? "#8B5E3C" : "rgba(201,162,76,0.7)"} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.12em", color: isParchment ? "#8B5E3C" : "rgba(201,162,76,0.78)", textTransform: "uppercase" }}>
              Sync to GitHub
            </span>
            {hasChanges && (
              <span style={{
                marginLeft: 8, padding: "1px 7px", borderRadius: 999,
                background: "rgba(201,162,76,0.14)", border: "0.5px solid rgba(201,162,76,0.35)",
                fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "var(--atlas-gold)",
              }}>
                {syncFiles.length} modified
              </span>
            )}
            {syncStatus === "done" && syncResult && (
              <span style={{
                marginLeft: 8, padding: "1px 7px", borderRadius: 999,
                background: "rgba(52,211,153,0.10)", border: "0.5px solid rgba(52,211,153,0.28)",
                fontSize: "var(--ts-xs)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
                color: "#34d399",
              }}>
                ✓ pushed {syncResult.shortSha}
              </span>
            )}
            {!isDesktopView && (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none" style={{ marginLeft: "auto", flexShrink: 0, transform: syncOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>
                <path d="M1 2.5l3 3 3-3" stroke={isParchment ? "#8B5E3C" : "rgba(201,162,76,0.5)"} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {isDesktopView && (
              <span style={{
                marginLeft: "auto",
                fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)",
                letterSpacing: "0.1em", color: "rgba(var(--atlas-muted-rgb),0.55)",
                textTransform: "uppercase",
              }}>
                {hasChanges ? "Awaiting push" : "In sync"}
              </span>
            )}
          </button>

          {/* Expanded panel */}
          {expanded && (
            <div style={{ padding: "0 13px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {/* File list — visual receipt */}
              {hasChanges ? (
                <div style={{
                  display: "flex", flexDirection: "column", gap: 3,
                  maxHeight: isDesktopView ? 120 : 160, overflowY: "auto",
                  padding: "6px 8px", borderRadius: 6,
                  border: `1px solid ${termBorder}`,
                  background: isParchment ? "rgba(240,228,210,0.4)" : "rgba(255,255,255,0.02)",
                }}>
                  {syncFiles.map(f => (
                    <div key={f} style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: isParchment ? "rgba(100,70,40,0.78)" : "rgba(var(--atlas-muted-rgb),0.78)", letterSpacing: "0.04em", padding: "2px 0", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "var(--atlas-gold)" }}>·</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: isParchment ? "rgba(100,70,40,0.5)" : "rgba(var(--atlas-muted-rgb),0.45)", letterSpacing: "0.05em" }}>
                  No tracked edits yet — Atlas writes files here when it self-updates.
                </div>
              )}

              {/* Commit message input (auto-suggested in plain English) */}
              <div style={{ position: "relative" }}>
                <input
                  value={syncMsg}
                  onChange={e => { setSyncMsg(e.target.value); setSyncMsgTouched(true); }}
                  placeholder={hasChanges ? "Atlas: …" : "Commit message (optional)"}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: isParchment ? "rgba(240,228,210,0.6)" : "rgba(255,255,255,0.04)",
                    border: `1px solid ${termBorder}`,
                    borderRadius: 6, padding: "8px 10px",
                    fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-sm)",
                    color: termFgText, outline: "none",
                  }}
                />
                {hasChanges && !syncMsgTouched && (
                  <span style={{
                    position: "absolute", top: -7, right: 8,
                    padding: "1px 6px", borderRadius: 999,
                    background: "color-mix(in oklab, var(--atlas-gold) 18%, var(--atlas-bg))",
                    border: "0.5px solid rgba(201,162,76,0.4)",
                    fontSize: "var(--ts-tiny)", fontFamily: "var(--app-font-mono)",
                    letterSpacing: "0.08em", color: "var(--atlas-gold)",
                    textTransform: "uppercase",
                  }}>
                    Atlas suggested
                  </span>
                )}
              </div>

              {/* Error / result */}
              {syncStatus === "error" && syncError && (
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "rgba(252,100,100,0.88)", lineHeight: 1.5 }}>
                  ✗ {syncError}
                </div>
              )}
              {syncStatus === "done" && syncResult && (
                <a
                  href={syncResult.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "#34d399", letterSpacing: "0.04em", textDecoration: "none" }}
                >
                  ✓ {syncResult.filesCommitted} file{syncResult.filesCommitted !== 1 ? "s" : ""} pushed · {syncResult.shortSha} →
                </a>
              )}

              {/* Golden deploy button */}
              <button
                onClick={handlePush}
                disabled={syncStatus === "pushing" || !hasChanges}
                onMouseEnter={(e) => { if (hasChanges) e.currentTarget.style.boxShadow = "0 0 24px rgba(201,162,76,0.45), inset 0 0 0 1px rgba(201,162,76,0.5)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = hasChanges ? "0 0 14px rgba(201,162,76,0.22), inset 0 0 0 1px rgba(201,162,76,0.28)" : "none"; }}
                style={{
                  padding: "10px 14px", borderRadius: 8,
                  background: hasChanges
                    ? "linear-gradient(180deg, color-mix(in oklab, var(--atlas-gold) 22%, transparent), color-mix(in oklab, var(--atlas-gold) 10%, transparent))"
                    : "transparent",
                  border: `1px solid ${hasChanges ? "rgba(201,162,76,0.55)" : termBorder}`,
                  color: hasChanges ? "var(--atlas-gold)" : "rgba(var(--atlas-muted-rgb),0.4)",
                  fontSize: "var(--ts-sm)", fontFamily: "var(--app-font-mono)",
                  letterSpacing: "0.16em", fontWeight: 600,
                  textTransform: "uppercase",
                  cursor: hasChanges && syncStatus !== "pushing" ? "pointer" : "not-allowed",
                  backdropFilter: "blur(14px)",
                  boxShadow: hasChanges ? "0 0 14px rgba(201,162,76,0.22), inset 0 0 0 1px rgba(201,162,76,0.28)" : "none",
                  transition: "all 200ms ease",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {syncStatus === "pushing" ? (
                  <>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: "var(--atlas-gold)",
                      animation: "atlas-pulse 1.2s ease-in-out infinite",
                    }} />
                    Pushing…
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M6 1v8M2.5 4.5L6 1l3.5 3.5M2 11h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Push to GitHub
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        );
      })()}


      {/* ── Command Deck (macros + NL toggle + help) ──────────────────── */}
      <div style={{
        flexShrink: 0,
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        borderBottom: `1px solid ${termBorder}`,
        background: isParchment ? "rgba(255,250,240,0.5)" : "rgba(255,255,255,0.02)",
        backdropFilter: "blur(14px)",
      }}>
        <div
          style={{
            flex: 1, minWidth: 0,
            display: "flex",
            overflowX: "auto",
            scrollbarWidth: "none",
            gap: 8,
          }}
        >
          {MACROS.map(m => {
            const isActive = activeMacro === m.cmd;
            return (
            <button
              key={m.label}
              onClick={() => { setActiveMacro(m.cmd); runMacro(m.cmd); }}
              disabled={running}
              aria-pressed={isActive}
              style={{
                flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: isDesktopView ? "8px 10px" : "6px 10px",
                borderRadius: 999,
                border: `1px solid ${isActive ? "rgba(201,162,76,0.55)" : "rgba(var(--atlas-muted-rgb),0.18)"}`,
                background: isActive ? "color-mix(in oklab, var(--atlas-gold) 12%, transparent)" : "transparent",
                color: isActive ? "var(--atlas-gold)" : "var(--atlas-muted)",
                fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)",
                letterSpacing: "0.05em", cursor: running ? "not-allowed" : "pointer",
                backdropFilter: isActive ? "blur(10px)" : "none",
                whiteSpace: "nowrap",
                boxShadow: isActive ? "inset 0 0 0 1px rgba(201,162,76,0.12)" : "none",
                opacity: isActive ? 1 : 0.78,
                transition: "all 160ms ease",
              }}
              onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.color = "var(--atlas-gold)"; e.currentTarget.style.borderColor = "rgba(201,162,76,0.3)"; } }}
              onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.color = "var(--atlas-muted)"; e.currentTarget.style.borderColor = "rgba(var(--atlas-muted-rgb),0.18)"; } }}
            >
              <span aria-hidden>{m.icon}</span>{isDesktopView ? m.label : m.shortLabel}
            </button>
          );})}
        </div>
        {/* NL toggle */}
        <button
          onClick={() => setNlMode(v => !v)}
          title={nlMode ? "Switch to Bash" : "Switch to Atlas Natural Language"}
          style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6,
            padding: "6px 10px", borderRadius: 999,
            border: `1px solid ${nlMode ? "var(--atlas-gold)" : termBorder}`,
            background: nlMode ? "color-mix(in oklab, var(--atlas-gold) 14%, transparent)" : "transparent",
            color: nlMode ? "var(--atlas-gold)" : "var(--atlas-muted)",
            fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)",
            letterSpacing: "0.08em", textTransform: "uppercase", cursor: "pointer",
          }}
        >
          <span style={{
            width: 22, height: 12, borderRadius: 999, position: "relative",
            background: nlMode ? "var(--atlas-gold)" : "rgba(255,255,255,0.12)",
            transition: "background 160ms ease",
          }}>
            <span style={{
              position: "absolute", top: 1, left: nlMode ? 11 : 1,
              width: 10, height: 10, borderRadius: "50%",
              background: nlMode ? "#0A0908" : "rgba(255,255,255,0.85)",
              transition: "left 160ms ease",
            }} />
          </span>
          {nlMode ? "Atlas" : "Bash"}
        </button>
        {/* Help button */}
        <button
          onClick={() => setHelpOpen(true)}
          aria-label="Open help cheat sheet"
          title="Help"
          style={{
            flexShrink: 0, width: 30, height: 30, borderRadius: "50%",
            border: "1px solid rgba(201,162,76,0.5)",
            background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
            color: "var(--atlas-gold)", cursor: "pointer",
            fontFamily: "var(--app-font-mono)", fontSize: 14, fontWeight: 700,
            boxShadow: "0 0 10px rgba(201,162,76,0.2)",
          }}
        >?</button>
      </div>

      {/* ── Main row: terminal (left) + optional desktop sidebar (right) ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "row" }}>
      {/* Output log */}
      <div
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: isDesktopView ? "0 0 70%" : 1, minWidth: 0,
          overflowY: "auto", padding: "12px 14px",
          fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-label)", lineHeight: 1.7,
          cursor: "text", position: "relative",
        }}
      >
        {lines.map((ln, i) => (
          i === 0 && !scenarioLens && ln.text.includes("ready") ? (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, color: colorFor(ln.kind), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: "#4ade80",
                boxShadow: "0 0 5px rgba(74,222,128,0.7)",
                display: "inline-block",
                animation: "atlas-pulse 2.4s ease-in-out infinite",
              }} />
              {ln.text}
            </div>
          ) : (
            <div key={i} style={{ color: colorFor(ln.kind), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {ln.text}
            </div>
          )
        ))}
        {(running || nlPending) && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3, color: "rgba(var(--atlas-muted-rgb),0.6)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(201,162,76,0.55)", display: "inline-block", animation: "atlas-pulse 1.2s ease-in-out infinite" }} />
            {nlPending ? "atlas thinking…" : "running…"}
          </div>
        )}
        {/* Inline active input row */}
        <div style={{
          marginTop: 10, paddingTop: 8,
          borderTop: `1px dashed ${termBorder}`,
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-body)",
            color: nlMode ? "var(--atlas-gold)" : termPrompt, flexShrink: 0,
          }}>{nlMode ? "▸" : "$"}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={running || nlPending}
            placeholder={
              running ? "running…" :
              nlPending ? "atlas thinking…" :
              nlMode ? "Tell Atlas what to do in plain English..." :
              "enter command"
            }
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            style={{
              flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none",
              fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-label)",
              color: termFgText,
              caretColor: termCaret,
            }}
          />
          {running ? (
            <button
              onClick={killCommand}
              title="Kill running command"
              style={{
                flexShrink: 0, padding: "3px 10px", borderRadius: 4,
                background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.4)",
                color: "rgba(252,100,100,0.9)", fontSize: "var(--ts-sm)", fontFamily: "var(--app-font-mono)",
                fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <svg width="8" height="8" viewBox="0 0 8 8" fill="rgba(252,100,100,0.9)">
                <rect width="8" height="8" rx="1" />
              </svg>
              kill
            </button>
          ) : input.trim() && (
            <button
              onClick={submitInput}
              style={{
                flexShrink: 0, padding: "3px 10px", borderRadius: 4,
                background: nlMode ? "color-mix(in oklab, var(--atlas-gold) 22%, transparent)" : "rgba(146,64,14,0.22)",
                border: `1px solid ${nlMode ? "var(--atlas-gold)" : "rgba(146,64,14,0.4)"}`,
                color: nlMode ? "var(--atlas-gold)" : "rgba(230,150,90,0.88)",
                fontSize: "var(--ts-sm)", fontFamily: "var(--app-font-mono)",
                fontWeight: 600, letterSpacing: "0.08em", cursor: "pointer",
              }}
            >
              {nlMode ? "ask" : "run"}
            </button>
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Desktop right sidebar — Atlas Assistant + Help Center */}
      {isDesktopView && (
        <aside style={{
          flex: "0 0 30%", minWidth: 280,
          borderLeft: `1px solid ${termBorder}`,
          background: isParchment ? "rgba(255,250,240,0.4)" : "rgba(255,255,255,0.02)",
          backdropFilter: "blur(18px)",
          overflowY: "auto", padding: "14px 14px 18px",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <div>
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 6 }}>
              Atlas Assistant
            </div>
            <p style={{ margin: 0, fontSize: "var(--ts-sm)", color: "var(--atlas-muted)", lineHeight: 1.5 }}>
              {nlMode
                ? "Plain-English mode is on. Type what you want and Atlas translates it."
                : "Flip the toggle to switch the prompt into plain English."}
            </p>
          </div>
          {HELP_GROUPS.map(group => (
            <div key={group.title}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 6 }}>
                {group.title}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {group.items.map(it => (
                  <button
                    key={it.cmd}
                    onClick={() => runMacro(it.cmd.replace(/\s*<.*?>$/, ""))}
                    style={{
                      textAlign: "left", padding: "8px 10px", borderRadius: 8,
                      border: `1px solid ${termBorder}`,
                      background: "rgba(255,255,255,0.02)",
                      cursor: "pointer", display: "flex", flexDirection: "column", gap: 2,
                    }}
                  >
                    <code style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-sm)", color: "var(--atlas-gold)" }}>{it.cmd}</code>
                    <span style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-muted)" }}>{it.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>
      )}
      </div>

      {/* ── Help drawer overlay (mobile + desktop) ──────────────────── */}
      {helpOpen && (
        <div
          onClick={() => setHelpOpen(false)}
          style={{
            position: "absolute", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.55)",
            backdropFilter: "blur(6px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: "60px 16px 16px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 460, maxHeight: "80vh", overflowY: "auto",
              background: isParchment ? "#FBF6EC" : "rgba(15,12,10,0.94)",
              border: "1px solid rgba(201,162,76,0.4)",
              borderRadius: 16,
              boxShadow: "0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(201,162,76,0.18)",
              backdropFilter: "blur(24px)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-label)", color: "var(--atlas-gold)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Console Cheat Sheet
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                aria-label="Close help"
                style={{
                  width: 26, height: 26, borderRadius: "50%",
                  border: `1px solid ${termBorder}`, background: "transparent",
                  color: "var(--atlas-muted)", cursor: "pointer",
                }}
              >×</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {HELP_GROUPS.map(group => (
                <div key={group.title}>
                  <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 6 }}>
                    {group.title}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {group.items.map(it => (
                      <button
                        key={it.cmd}
                        onClick={() => { setHelpOpen(false); runMacro(it.cmd.replace(/\s*<.*?>$/, "")); }}
                        style={{
                          textAlign: "left", padding: "8px 10px", borderRadius: 8,
                          border: `1px solid ${termBorder}`,
                          background: "rgba(255,255,255,0.03)",
                          cursor: "pointer", display: "flex", flexDirection: "column", gap: 2,
                        }}
                      >
                        <code style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-sm)", color: "var(--atlas-gold)" }}>{it.cmd}</code>
                        <span style={{ fontSize: "var(--ts-xs)", color: "var(--atlas-muted)" }}>{it.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── MobileTabBar ─────────────────────────────────────────────────────────────
function MobileTabBar({
  activeTab,
  onTabChange,
  entryCount,
}: {
  activeTab: "chat" | "ledger" | "files" | "map" | "preview" | "memory" | "blueprints" | "connections" | "forge";
  onTabChange: (tab: "chat" | "ledger" | "files" | "map" | "preview" | "memory" | "blueprints" | "connections" | "forge") => void;
  entryCount: number;
}) {
  const [showMore, setShowMore] = useState(false);

  const mainTabs: { id: "chat" | "ledger" | "files" | "map"; label: string; icon: React.ReactNode; badge?: number; alert?: boolean }[] = [
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
        borderTop: "1px solid rgba(var(--atlas-gold-rgb),0.12)",
        display: "flex",
        alignItems: "stretch",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {mainTabs.map(({ id, label, icon, badge, alert }) => {
        const active = activeTab === id;
        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            aria-label={id === "chat" ? "Open chat" : id === "ledger" ? "Open ledger" : id === "files" ? "Open files" : "Open map"}
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
                  fontSize: "var(--ts-tiny)",
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
                fontSize: "var(--ts-xs)",
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
      {/* ── More button ── */}
      <button
        onClick={() => setShowMore(true)}
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
          color: ["memory","blueprints","connections","forge"].includes(activeTab)
            ? "var(--atlas-gold)"
            : "var(--atlas-muted)",
          transition: "color 180ms ease",
          position: "relative",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {/* Active indicator bar */}
        <div style={{
          position: "absolute", top: 0, left: "20%", right: "20%", height: 2,
          borderRadius: "0 0 2px 2px",
          background: ["memory","blueprints","connections","forge"].includes(activeTab)
            ? "var(--atlas-gold)" : "transparent",
          transition: "background 180ms ease",
        }} />
        {/* ··· icon */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="19" cy="12" r="2" />
        </svg>
        <span style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em", textTransform: "uppercase", lineHeight: 1 }}>
          More
        </span>
      </button>

      {/* ── More sheet overlay ── */}
      {showMore && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setShowMore(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 290,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(4px)",
            }}
          />
          {/* Sheet */}
          <div
            style={{
              position: "fixed", bottom: 64, left: 0, right: 0,
              zIndex: 300,
              background: "var(--atlas-surface)",
              borderTop: "1px solid rgba(201,162,76,0.18)",
              borderRadius: "14px 14px 0 0",
              padding: "16px 0 12px",
            }}
          >
            <div style={{
              width: 36, height: 3, borderRadius: 2,
              background: "rgba(201,162,76,0.25)",
              margin: "0 auto 16px",
            }} />
            {(
              [
                {
                  id: "memory" as const,
                  label: "Memory",
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/>
                      <path d="M8 9h8M8 13h8M8 17h5"/>
                    </svg>
                  ),
                },
                {
                  id: "blueprints" as const,
                  label: "Blueprints",
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M3 9h18M9 21V9"/>
                    </svg>
                  ),
                },
                {
                  id: "connections" as const,
                  label: "Connections",
                  icon: (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="12" r="2"/>
                      <circle cx="18" cy="6" r="2"/>
                      <circle cx="18" cy="18" r="2"/>
                      <path d="M8 11l8-4M8 13l8 4"/>
                    </svg>
                  ),
                },
              ] as { id: "memory" | "blueprints" | "connections" | "forge"; label: string; icon: React.ReactNode }[]
            ).map(({ id, label, icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  onClick={() => { onTabChange(id); setShowMore(false); }}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "13px 24px",
                    background: active ? "rgba(201,162,76,0.07)" : "transparent",
                    border: "none",
                    borderLeft: `3px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                    cursor: "pointer",
                    color: active ? "var(--atlas-gold)" : "var(--atlas-fg)",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 12,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    textAlign: "left",
                    WebkitTapHighlightColor: "transparent",
                    transition: "all 160ms ease",
                  }}
                >
                  {icon}
                  {label}
                  {active && (
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--atlas-gold)", opacity: 0.7 }}>
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
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

const INTAKE_QUESTIONS = [
  { key: "what",          label: "What are you building?",                    hint: "Describe it plainly — one paragraph is fine.",         required: true  },
  { key: "who",           label: "Who is it for?",                            hint: "Who's the user and what problem does it solve?",       required: true  },
  { key: "stage",         label: "What stage are you at?",                    hint: "Idea / Early build / Live / Scaling",                  required: true  },
  { key: "working",       label: "What's already working?",                   hint: "What are you confident about? Skip if nothing yet.",   required: false },
  { key: "openQuestion",  label: "What's the open question?",                 hint: "The thing you haven't resolved. The real tension.",    required: true  },
  { key: "thinkingStyle", label: "How do you like to think through problems?", hint: "Do you want pushback, or space to explore?",          required: false },
];

type IntakeAnswerKey = (typeof INTAKE_QUESTIONS)[number]["key"];
type IntakeAnswers = Partial<Record<IntakeAnswerKey, string>>;

function cleanIntakeValue(value?: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildIntakeSeedNodes(answers: IntakeAnswers): ArchNode[] {
  const what = cleanIntakeValue(answers.what);
  const who = cleanIntakeValue(answers.who);
  const stage = cleanIntakeValue(answers.stage);
  const working = cleanIntakeValue(answers.working);
  const openQuestion = cleanIntakeValue(answers.openQuestion);
  const thinkingStyle = cleanIntakeValue(answers.thinkingStyle);

  const nodes: ArchNode[] = [
    {
      id: "intake-goal",
      label: "What we're building",
      type: "goal",
      resolved: Boolean(what),
      strategicAnswer: what || undefined,
      x: 300,
      y: 120,
      details: "Captured from Forge intake.",
      question: "What are we actually building?",
    },
    {
      id: "intake-audience",
      label: "Who it's for",
      type: "requirement",
      resolved: Boolean(who),
      strategicAnswer: who || undefined,
      x: 525,
      y: 205,
      details: "Primary user and problem context from intake.",
      question: "Who is this for, and what problem are they trying to solve?",
    },
    {
      id: "intake-stage",
      label: "Current stage",
      type: "sprint",
      resolved: Boolean(stage),
      strategicAnswer: stage || undefined,
      x: 470,
      y: 390,
      details: "Current build stage captured from intake.",
      question: "What stage is this project in right now?",
    },
    {
      id: "intake-working",
      label: "What's already working",
      type: "requirement",
      resolved: Boolean(working),
      strategicAnswer: working || undefined,
      x: 130,
      y: 390,
      details: "Known strengths and confirmed signals from intake.",
      question: "What is already working that we should preserve?",
    },
    {
      id: "intake-open-question",
      label: "Open question",
      type: "decision",
      resolved: Boolean(openQuestion),
      strategicAnswer: openQuestion || undefined,
      x: 75,
      y: 205,
      details: "The main unresolved tension captured from intake.",
      question: "What is still unresolved or in tension?",
    },
    {
      id: "intake-thinking-style",
      label: "Thinking style",
      type: "priority",
      resolved: Boolean(thinkingStyle),
      strategicAnswer: thinkingStyle || undefined,
      x: 300,
      y: 475,
      details: "Preferred problem-solving style from intake.",
      meta: "should",
      question: "How should Atlas think with you as this project evolves?",
    },
  ];

  return nodes.filter((node) => Boolean(node.strategicAnswer));
}

function buildIntakeGreeting(answers: IntakeAnswers): string {
  const what = cleanIntakeValue(answers.what) || "the project";
  const who = cleanIntakeValue(answers.who);
  const stage = cleanIntakeValue(answers.stage);
  const working = cleanIntakeValue(answers.working);
  const openQuestion = cleanIntakeValue(answers.openQuestion);

  const parts = [
    `Got it — we're building ${what}`,
    who ? `for ${who}` : "",
    stage ? `and you're currently at ${stage}` : "",
  ].filter(Boolean);

  const lead = `${parts.join(" ")}.`.replace(/\s+\./g, ".");
  const workingLine = working ? ` What's already working: ${working}.` : "";
  const tensionLine = openQuestion ? ` The live tension is ${openQuestion}.` : "";
  return `${lead}${workingLine}${tensionLine} Where do you want to push first?`;
}

function buildIntakeEntries(answers: IntakeAnswers): Array<{ title: string; summary: string }> {
  const items = [
    cleanIntakeValue(answers.what) ? { title: "What we're building", summary: cleanIntakeValue(answers.what) } : null,
    cleanIntakeValue(answers.who) ? { title: "Who it's for", summary: cleanIntakeValue(answers.who) } : null,
    cleanIntakeValue(answers.stage) ? { title: "Current stage", summary: cleanIntakeValue(answers.stage) } : null,
    cleanIntakeValue(answers.working) ? { title: "What's already working", summary: cleanIntakeValue(answers.working) } : null,
    cleanIntakeValue(answers.openQuestion) ? { title: "Open question", summary: cleanIntakeValue(answers.openQuestion) } : null,
    cleanIntakeValue(answers.thinkingStyle) ? { title: "Thinking style", summary: cleanIntakeValue(answers.thinkingStyle) } : null,
  ];

  return items.filter((item): item is { title: string; summary: string } => Boolean(item));
}

function ForgeIntake({ projectId, onComplete }: { projectId: number; onComplete: (answers: IntakeAnswers) => Promise<void> | void }) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = INTAKE_QUESTIONS[step];
  const isLast = step === INTAKE_QUESTIONS.length - 1;
  // All questions are skippable — intake enriches context, never gates entry.
  const canSkip = true;

  const skipAll = async () => {
    setSubmitting(true);
    setError(null);
    try {
      fetch("/api/forge/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ projectId, answers, skipped: true }),
      }).catch(() => {});
      await Promise.resolve(onComplete(answers));
    } catch {
      setError("Couldn't skip. Try again.");
      setSubmitting(false);
    }
  };

  const advance = async (val: string) => {
    const updated = { ...answers, [q.key]: val };
    setAnswers(updated);
    setValue("");

    if (!isLast) {
      setStep(step + 1);
      return;
    }

    // Final step — submit
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/forge/intake", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ projectId, answers: updated }),
      });
      if (!res.ok) throw new Error("Intake failed");
      await Promise.resolve(onComplete(updated));
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "var(--atlas-bg)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "24px 20px",
    }}>
      {/* Skip-all escape hatch — always visible */}
      <button
        type="button"
        onClick={skipAll}
        disabled={submitting}
        style={{
          position: "absolute", top: 16, right: 18,
          background: "transparent", border: "1px solid var(--atlas-border)",
          color: "var(--atlas-muted)", fontSize: 11, fontFamily: "var(--app-font-mono)",
          letterSpacing: "0.08em", textTransform: "uppercase",
          padding: "8px 12px", borderRadius: 6, cursor: submitting ? "wait" : "pointer",
        }}
        title="Skip intake — jump straight into the workspace"
      >
        Skip intake →
      </button>

      {/* Progress bar */}
      <div style={{ width: "100%", maxWidth: 560, marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {INTAKE_QUESTIONS.map((_, i) => (
            <div key={i} style={{ flex: 1, height: 2, borderRadius: 2, background: i <= step ? "var(--atlas-gold)" : "var(--atlas-border)", transition: "background 300ms" }} />
          ))}
        </div>
        <div style={{ fontFamily: "var(--app-font-mono)", fontSize: 9, letterSpacing: "0.13em", color: "var(--atlas-muted)", textTransform: "uppercase" }}>
          {step + 1} of {INTAKE_QUESTIONS.length} · optional
        </div>
      </div>

      {/* Question */}
      <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 600, color: "var(--atlas-fg)", lineHeight: 1.35 }}>
          {q.label}
        </div>
        <div style={{ fontSize: 13, color: "var(--atlas-muted)", lineHeight: 1.6 }}>
          {q.hint}
        </div>

        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && value.trim()) {
              advance(value.trim());
            }
          }}
          placeholder="Type your answer..."
          rows={4}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 8,
            background: "var(--atlas-surface)", border: "1px solid var(--atlas-border)",
            color: "var(--atlas-fg)", fontSize: 14, fontFamily: "inherit",
            resize: "none", outline: "none", lineHeight: 1.6, boxSizing: "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(201,162,76,0.45)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "var(--atlas-border)")}
        />

        {error && <div style={{ fontSize: 12, color: "#f87171" }}>{error}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            disabled={!value.trim() || submitting}
            onClick={() => value.trim() && advance(value.trim())}
            style={{
              flex: 1, padding: "12px", borderRadius: 8, border: "none",
              background: value.trim() ? "var(--atlas-gold)" : "var(--atlas-surface)",
              color: value.trim() ? "#0D0B09" : "var(--atlas-muted)",
              fontSize: 13, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
              textTransform: "uppercase", cursor: value.trim() && !submitting ? "pointer" : "not-allowed",
              fontWeight: 600,
            }}
          >
            {submitting ? "Starting..." : isLast ? "Begin" : "Next →"}
          </button>
          {canSkip && (
            <button
              type="button"
              onClick={() => advance("")}
              style={{
                padding: "12px 18px", borderRadius: 8,
                border: "1px solid var(--atlas-border)", background: "transparent",
                color: "var(--atlas-muted)", fontSize: 12, fontFamily: "var(--app-font-mono)",
                cursor: "pointer", letterSpacing: "0.06em",
              }}
            >
              Skip
            </button>
          )}
        </div>

        {step > 0 && (
          <button type="button" onClick={() => { setStep(step - 1); setValue(answers[INTAKE_QUESTIONS[step - 1].key] ?? ""); }}
            style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", fontSize: 12, cursor: "pointer", alignSelf: "flex-start", fontFamily: "var(--app-font-mono)", padding: 0 }}>
            ← Back
          </button>
        )}
      </div>
    </div>
  );
}

// ── Workspace ────────────────────────────────────────────────────────────────
export default function Workspace() {
  const { projectId } = useParams();
  const [, setLocation] = useLocation();
  const id = Number(projectId) || Number(window.location.pathname.split('/project/')[1]?.split('/')[0]);
  const searchParams = new URLSearchParams(window.location.search);
  const [showIntake, setShowIntake] = useState(searchParams.get("intake") === "true");
  const globalMode = searchParams.get("global") === "true";
  const effectiveId = globalMode ? 0 : id;
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [createProjectError, setCreateProjectError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const isMobile = useIsMobile() && !isDesktop;
  const isTinyScreen = useIsTinyScreen();
  useRequireAuth();


  const {
    input, setInput,
    attachedFiles, setAttachedFiles,
    inputFocused, setInputFocused,
    firstRunDismissed, setFirstRunDismissed,
    firstRunInput, setFirstRunInput,
    textareaRef,
    fileInputRef,
  } = useComposerDraft();


  const [planStates, setPlanStates] = useState<Map<number, PlanState>>(() => new Map());
  const [planExecutions, setPlanExecutions] = useState<Map<number, PlanExecution>>(() => new Map());
  const [atlasGreeting, setAtlasGreeting] = useState<string | null>(null);
  const [greetingLoading, setGreetingLoading] = useState(false);

  // Session bootstrap deps for useChatStream — moved up from below so the hook
  // can own sessionId/ensureSessionId. project/projectLoading/hasForgeNodes etc.
  // still live in their original spot below.
  const projectState = useProjectState(Number.isFinite(id) ? id : null);
  // Run the session list whenever projectState errored OR finished loading
  // without an activeSession. Previously this was gated on error only, which
  // meant a successful `/state` response with `activeSession: null` never
  // triggered a fallback — so the chat bootstrap created a brand-new session
  // every visit and orphaned prior conversations. Now we always recover the
  // most recent existing session before falling through to creation.
  const useProjectStateFallback =
    !!projectState.error || (!projectState.loading && !projectState.activeSession);
  const { data: fallbackSessions, isLoading: fallbackSessionsLoading } = useListSessions(id, {
    query: { enabled: !!id && useProjectStateFallback, queryKey: getListSessionsQueryKey(id) },
  });
  const sessions = projectState.activeSession
    ? [projectState.activeSession]
    : (fallbackSessions
        ? [...fallbackSessions].sort((a, b) => {
            const at = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bt = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bt - at;
          })
        : fallbackSessions);
  const sessionsLoading = projectState.loading && !projectState.activeSession
    ? true
    : (useProjectStateFallback ? fallbackSessionsLoading : false);
  const createSession = useCreateSession();

  // ── Hoisted deps for useChatStream (B2c) ────────────────────────────────────
  const { playSend, playCommit, playPark, playNavigate } = useSound();
  const {
    wsModel, setWsModel,
    wsLens, setWsLensRaw,
    showLensPicker, setShowLensPicker,
    detectedLens, setDetectedLens,
    showScenarioPrompt, setShowScenarioPrompt,
    pendingLensSwitch, setPendingLensSwitch,
    scenarioBuffer, setScenarioBuffer,
    showWsModelSheet, setShowWsModelSheet,
    sendCtxRef,
    scenarioStartIdxRef,
  } = useChatLens(id);
  const [leftTab, setLeftTab] = useState<WorkspaceLeftTab>(() => {
    try {
      const stored = sessionStorage.getItem("atlas-open-left-tab");
      if (
        stored === "chat" ||
        stored === "diff" ||
        stored === "blueprints" ||
        stored === "artifacts" ||
        stored === "terminal"
      ) {
        sessionStorage.removeItem("atlas-open-left-tab");
        return stored;
      }
    } catch {}
    return "chat";
  });
  const [subheaderOpen, setSubheaderOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<"chat" | "ledger" | "blueprints" | "files" | "map" | "preview" | "memory" | "connections" | "artifacts" | "workbench" | "mcp">(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : "chat"
  );
  const [rightOpen, setRightOpen] = useState(() =>
    new URLSearchParams(window.location.search).get("view") === "flow"
  );
  const [desktopForceTab, setDesktopForceTab] = useState<RightTab | undefined>(() =>
    new URLSearchParams(window.location.search).get("view") === "flow" ? "map" : undefined
  );
  const [sandboxCode, setSandboxCode] = useState<string | null>(null);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [manifestPreviewHtml, setManifestPreviewHtml] = useState<string | null>(null);
  const [manifestDecision, setManifestDecision] = useState<ManifestDecision | null>(null);
  const openPreviewPanel = useCallback(() => {
    if (isMobile) {
      setMobileTab("preview");
      setRightOpen(true);
    } else {
      setDesktopForceTab("preview");
      setTimeout(() => setDesktopForceTab(undefined), 120);
    }
  }, [isMobile]);
  const handlePreviewCode = useCallback((code: string) => {
    setSandboxCode(code);
    openPreviewPanel();
  }, [openPreviewPanel]);
  const [latestRun, setLatestRun] = useState<any | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const workspaceMountedAtRef = useRef<number>(Date.now());
  const acknowledgedRunRef = useRef<string>("");
  const latestRunKey = useCallback((run: any | null) => {
    if (!run) return "";
    return String(run.id ?? run.runId ?? run.finishedAt ?? run.updatedAt ?? run.startedAt ?? run.createdAt ?? "");
  }, []);
  useEffect(() => {
    if (!Number.isFinite(id)) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/projects/${id}/runs`);
        if (!res.ok) return;
        const runs = await res.json();
        const completed = Array.isArray(runs)
          ? runs.find((r: any) => (r.runStatus ?? r.status) === "completed")
          : null;
        if (completed) {
          setLatestRun((prev) => prev && latestRunKey(prev) === latestRunKey(completed) ? prev : completed);
        }
      } catch {}
    };
    void poll();
    const iv = setInterval(poll, 3000);
    return () => clearInterval(iv);
  }, [id, latestRunKey]);
  const [showMoreSheet, setShowMoreSheet] = useState(false);
  const [launchModal, setLaunchModal] = useState<{ open: boolean; mode: LaunchMode }>({ open: false, mode: "preview" });
  const [showModelPicker, setShowModelPicker] = useState(() => {
    try { return localStorage.getItem("atlas-power-model-picker") === "1"; } catch { return false; }
  });
  const [autoNameKey, setAutoNameKey] = useState(0);
  const [pendingResolvedNodeIds, setPendingResolvedNodeIds] = useState<string[]>([]);
  const [fileContext, setFileContext] = useState<string | null>(null);
  const [codeContextStatus, setCodeContextStatus] = useState<{ summary: string; fileCount: number } | null>(null);
  const [codeContextUploading, setCodeContextUploading] = useState(false);
  const uploadCodeContextZip = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      toast.error("Please select a .zip file");
      return;
    }
    setCodeContextUploading(true);
    try {
      const { API_BASE } = await import("@/lib/api");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/api/upload/code-context`, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json() as { fileContext: string; summary: string; fileCount: number; filePaths: string[] };
      setFileContext(data.fileContext);
      setCodeContextStatus({ summary: data.summary, fileCount: data.fileCount });
      toast.success(data.summary || `${data.fileCount} files loaded from zip`);
    } catch (err) {
      console.error("code-context upload failed", err);
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setCodeContextUploading(false);
    }
  }, []);
  const clearCodeContext = useCallback(() => {
    setFileContext(null);
    setCodeContextStatus(null);
  }, []);
  const [dbUrl, setDbUrl] = useState<string | null>(() => {
    try { return localStorage.getItem(`atlas-db-url-${id}`) ?? null; } catch { return null; }
  });
  const [forgeContext, setForgeContext] = useState<string | null>(() => {
    try { return sessionStorage.getItem(`atlas-forge-ctx-${id}`) ?? null; } catch { return null; }
  });
  useEffect(() => {
    try { setForgeContext(sessionStorage.getItem(`atlas-forge-ctx-${id}`) ?? null); } catch { setForgeContext(null); }
  }, [id]);
  useEffect(() => {
    try { setDbUrl(localStorage.getItem(`atlas-db-url-${id}`) ?? null); } catch { setDbUrl(null); }
  }, [id]);
  const { data: fallbackEntries } = useListEntries(id, {}, {
    query: { enabled: !!id && useProjectStateFallback, queryKey: getListEntriesQueryKey(id, {}) },
  });
  const entries = useMemo<Entry[]>(() => {
    if (!projectState.state) return fallbackEntries ?? [];
    const entryMap = new Map<number, Entry>();
    [...projectState.decisions, ...projectState.parked].forEach((entry) => {
      entryMap.set(entry.id, entry);
    });
    return [...entryMap.values()];
  }, [fallbackEntries, projectState.decisions, projectState.parked, projectState.state]);
  const [thinkingState, setThinkingState] = useState<{ status: "processing"|"streaming"|"completed"; currentStep: any; history: any[]; developerLens?: any } | null>(null);
  const stepStartRef = useRef<number>(Date.now());
  const handleThinkingSendStart = useCallback(() => {
    stepStartRef.current = Date.now();
    setThinkingState(null);
  }, []);
  const handleThinkingStep = useCallback((event: { phase?: any; verb?: string; target?: string }) => {
    setThinkingState(prev => ({
      status: "processing",
      currentStep: { id: Date.now().toString(), phase: event.phase, label: event.verb + (event.target ? " " + event.target : "") },
      history: prev ? [...prev.history, ...(prev.currentStep ? [{ ...prev.currentStep, durationMs: Date.now() - stepStartRef.current }] : [])] : [],
      developerLens: prev?.developerLens,
    }));
    stepStartRef.current = Date.now();
  }, []);
  const handleFirstStreamingToken = useCallback(() => {
    setThinkingState(prev => prev ? { ...prev, status: "streaming" } : prev);
  }, []);
  const handleThinkingDone = useCallback((payload: any) => {
    setThinkingState(prev => prev ? { ...prev, status: "completed", developerLens: payload?.developerLens } : prev);
  }, []);

  const {
    messages,
    setMessages,
    messagesRef,
    historyMsgCountRef,
    priorLoadedRef: priorLoaded,
    sessionId,
    setSessionId,
    ensureSessionId,
    chatPending,
    setChatPending,
    activityStream,
    setActivityStream,
    liveStep,
    abortControllerRef,
    memoryChips,
    setMemoryChips,
    doSend,
    handleRegenerate,
  } = useChatStream(effectiveId, {
    sessions,
    sessionsLoading,
    createSession,
    queryClient,
    getListSessionsQueryKey,
    mapPriorMessage: (m) => {
      const raw = m as typeof m & {
        terminalCmd?: unknown; terminal_cmd?: unknown;
        terminalResult?: unknown; terminal_result?: unknown;
        modelUsed?: string | null; model_used?: string | null;
        executionTimeMs?: number | null; execution_time_ms?: number | null;
        inputTokens?: number | null; input_tokens?: number | null;
        outputTokens?: number | null; output_tokens?: number | null;
        costUsd?: number | string | null; cost_usd?: number | string | null;
      };
      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        terminalCmd: raw.terminalCmd ?? raw.terminal_cmd,
        terminalResult: raw.terminalResult ?? raw.terminal_result,
        modelUsed: raw.modelUsed ?? raw.model_used ?? null,
        intentType: m.intentType,
        sentAt: m.createdAt,
        executionTimeMs: raw.executionTimeMs ?? raw.execution_time_ms ?? null,
        inputTokens: raw.inputTokens ?? raw.input_tokens ?? null,
        outputTokens: raw.outputTokens ?? raw.output_tokens ?? null,
        costUsd: raw.costUsd != null ? Number(raw.costUsd) : raw.cost_usd != null ? Number(raw.cost_usd) : null,
      };
    },
    entries,
    fileContext,
    forgeContext,
    dbUrl,
    sendCtxRef,
    setDetectedLens,
    setScenarioBuffer,
    setLeftTab,
    setMobileTab,
    setPendingResolvedNodeIds,
    setAutoNameKey,
    getGetProjectQueryKey,
    getListProjectsQueryKey,
    reportError,
    onSendStart: handleThinkingSendStart,
    onStepEvent: handleThinkingStep,
    onFirstStreamingToken: handleFirstStreamingToken,
    onDoneEvent: handleThinkingDone,
    onFlowNodes: (nodes) => {
      const archNodes: ArchNode[] = nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: (["goal","requirement","blocker","priority","decision","sprint","wont"].includes(n.type)
          ? n.type : "goal") as ArchNode["type"],
        resolved: false,
        x: n.x,
        y: n.y,
        question: n.question,
      }));
      setExternalForgeNodes((prev) => {
        const existingIds = new Set(prev.map(p => p.id));
        const newNodes = archNodes.filter(n => !existingIds.has(n.id));
        return newNodes.length > 0 ? [...prev, ...newNodes] : prev;
      });
    },
  });

  const thinkFreelyThreadLoadedRef = useRef(false);
  useEffect(() => {
    if (thinkFreelyThreadLoadedRef.current) return;
    thinkFreelyThreadLoadedRef.current = true;

    let storedThread: string | null = null;
    try {
      const storedOpeningConversation = sessionStorage.getItem(OPENING_CONVERSATION_STORAGE_KEY);
      const storedOpeningProjectId = sessionStorage.getItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
      if (storedOpeningConversation !== null) {
        if (storedOpeningProjectId === String(id)) {
          storedThread = storedOpeningConversation;
        }
        sessionStorage.removeItem(OPENING_CONVERSATION_STORAGE_KEY);
        sessionStorage.removeItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
      } else {
        storedThread = sessionStorage.getItem(THINK_FREELY_THREAD_STORAGE_KEY);
      }
      if (storedThread !== null && storedOpeningConversation === null) {
        sessionStorage.removeItem(THINK_FREELY_THREAD_STORAGE_KEY);
      }
    } catch {
      storedThread = null;
    }
    if (!storedThread) return;

    let parsedThread: unknown = null;
    try {
      parsedThread = JSON.parse(storedThread);
    } catch {
      parsedThread = null;
    }
    const transferredMessages = normalizeThinkFreelyThread(parsedThread);
    if (transferredMessages.length === 0) return;

    priorLoaded.current = true;
    historyMsgCountRef.current = transferredMessages.length;
    setMessages(transferredMessages);
  }, [historyMsgCountRef, id, priorLoaded, setMessages]);

  useEffect(() => {
    if (messages.length > 0 || greetingLoading || atlasGreeting) return;
    setGreetingLoading(true);
    fetch(`/api/projects/${id}/greeting`, {
      credentials: "include",
      headers: getAuthHeaders(),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.message) setAtlasGreeting(data.message);
      })
      .catch(() => {})
      .finally(() => setGreetingLoading(false));
  }, [id, messages.length]);

  // Reset workspace-owned chat state when the project changes.
  // (messages / sessionId / priorLoaded / historyMsgCountRef portion lives in useChatStream)
  useEffect(() => {
    setPlanStates(new Map());
    setPlanExecutions(new Map());
    setThinkingState(null);
    setManifestPreviewHtml(null);
    setManifestDecision(null);
    homePlanLoadedRef.current = false;
    // Note: abort/chatPending/activityStream reset is owned by useChatStream.
    // Reset auto-prime guards so a fresh ?source=handoff load can seed its first message.
    initialSent.current = false;
    importPrimed.current = false;
    homeHandoffPrimed.current = false;
    setAutoNameKey(0);
  }, [id]);

  // Reset preview-ready chip when switching projects or sessions.
  useEffect(() => {
    setPreviewReady(false);
    acknowledgedRunRef.current = "";
    workspaceMountedAtRef.current = Date.now();
  }, [id, sessionId]);

  // Session-gated, non-intrusive "Atlas Build ready" detection.
  // Only fires for runs that (a) belong to the current session, (b) finished
  // after this workspace instance mounted, and (c) when not viewing the flow map.
  useEffect(() => {
    if (!latestRun) return;
    if ((latestRun.runStatus ?? latestRun.status) !== "completed") return;
    const viewIsFlow = new URLSearchParams(window.location.search).get("view") === "flow";
    if (viewIsFlow) return;
    const runSessionId = latestRun.sessionId ?? latestRun.session_id ?? null;
    if (runSessionId == null || sessionId == null) return;
    if (Number(runSessionId) !== Number(sessionId)) return;
    const finishedAtRaw = latestRun.finishedAt ?? latestRun.finished_at ?? latestRun.updatedAt ?? latestRun.updated_at ?? latestRun.createdAt ?? latestRun.created_at;
    const finishedAt = finishedAtRaw ? new Date(finishedAtRaw).getTime() : 0;
    if (!finishedAt || finishedAt < workspaceMountedAtRef.current) return;
    const key = latestRunKey(latestRun);
    if (acknowledgedRunRef.current === key) return;
    acknowledgedRunRef.current = key;
    setPreviewReady(true);
  }, [latestRun, sessionId, latestRunKey]);

  // useSound / memoryChips / leftTab moved above (consumed by useChatStream).
  const [pushHistory, setPushHistory] = useState<PushRecord[]>([]);
  const [sessionPrUrl, setSessionPrUrl] = useState<string | null>(null);
  const [latestPlanArtifact, setLatestPlanArtifact] = useState<{ type: string; title: string; content: string } | null>(null);
  void latestPlanArtifact;
  const [showProfile, setShowProfile] = useState(false);
  useEffect(() => {
    const mountedAt = Date.now();
    const open = () => {
      if (Date.now() - mountedAt > 400) setShowProfile(true);
    };
    window.addEventListener("axiom:open-account-hub", open);
    return () => window.removeEventListener("axiom:open-account-hub", open);
  }, []);

  // Atlas Core center-button → switch to chat tab + focus composer
  useEffect(() => {
    const onFocus = () => {
      setMobileTab("chat");
      setRightOpen(false);
      const el = textareaRef.current;
      if (!el) return;
      setTimeout(() => {
        try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
        el.focus();
      }, 80);
    };
    window.addEventListener("atlas:focus-composer", onFocus);
    return () => window.removeEventListener("atlas:focus-composer", onFocus);
  }, []);

  // Default split: chat-leaning. Tablets (768–1279) get 62/38 so the chat
  // pane has room for the composer; desktop (≥1280) gets 55/45.
  const defaultChatPct = () => {
    if (typeof window === "undefined") return 55;
    const w = window.innerWidth;
    if (w < 1280) return 62;
    return 55;
  };
  const [chatWidthPct, setChatWidthPct] = useState(defaultChatPct);
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

  // useChatLens destructure moved above (consumed by useChatStream).
  const [rightFullscreen, setRightFullscreen] = useState(false);
  const [desktopRightFull, setDesktopRightFull] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [switchToExpanded, setSwitchToExpanded] = useState(false);
  const [switchProjectDeleteId, setSwitchProjectDeleteId] = useState<number | null>(null);
  // null = panel closed; string = open with current draft
  const [archiveReasonDraft, setArchiveReasonDraft] = useState<string | null>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [threadSearchDraft, setThreadSearchDraft] = useState<string | null>(null);
  const [threadSearchStatus, setThreadSearchStatus] = useState<string>("");
  const threadSearchCursorRef = useRef<{ q: string; matches: number[]; idx: number }>({ q: "", matches: [], idx: -1 });

  const projectBtnRef = useRef<HTMLButtonElement>(null);
  const [showViewMenu, setShowViewMenu] = useState(false);

  const runThreadSearch = useCallback((query: string, direction: 1 | -1 = 1) => {
    const q = query.trim().toLowerCase();
    if (!q) { setThreadSearchStatus(""); return; }
    const cur = threadSearchCursorRef.current;
    if (cur.q !== q) {
      const matches: number[] = [];
      messages.forEach((m, i) => {
        if ((m.content ?? "").toLowerCase().includes(q)) matches.push(i);
      });
      threadSearchCursorRef.current = { q, matches, idx: -1 };
    }
    const ref = threadSearchCursorRef.current;
    if (ref.matches.length === 0) { setThreadSearchStatus("No matches"); return; }
    ref.idx = (ref.idx + direction + ref.matches.length) % ref.matches.length;
    const targetIdx = ref.matches[ref.idx];
    setThreadSearchStatus(`${ref.idx + 1} of ${ref.matches.length}`);
    requestAnimationFrame(() => {
      const root = chatPanelScrollRef.current;
      if (!root) return;
      const el = root.querySelector<HTMLElement>(`[data-atlas-msg-idx="${targetIdx}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prev = el.style.boxShadow;
      const prevT = el.style.transition;
      el.style.transition = "box-shadow 200ms ease";
      el.style.boxShadow = "0 0 0 2px color-mix(in oklab, var(--atlas-gold) 65%, transparent)";
      window.setTimeout(() => { el.style.boxShadow = prev; el.style.transition = prevT; }, 1400);
    });
  }, [messages]);



  const downloadConversation = useCallback((format: "md" | "json") => {
    const pname = projectState.project?.name ?? "atlas";
    const projectName = pname.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${projectName}-conversation-${stamp}.${format}`;
    let blob: Blob;
    if (format === "json") {
      blob = new Blob([JSON.stringify({
        project: pname,
        sessionId,
        exportedAt: new Date().toISOString(),
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          sentAt: m.sentAt ?? null,
          model: (m as any).model ?? null,
        })),
      }, null, 2)], { type: "application/json" });
    } else {
      const lines: string[] = [
        `# ${pname} — Conversation`,
        `_Exported ${new Date().toLocaleString()}_`,
        "",
      ];
      for (const m of messages) {
        const who = m.role === "user" ? "You" : "Atlas";
        lines.push(`## ${who}`);
        lines.push("");
        lines.push((m.content ?? "").trim());
        lines.push("");
        lines.push("---");
        lines.push("");
      }
      blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  }, [messages, projectState.project, sessionId]);


  const handleNewSession = useCallback(async () => {
    if (sessionActionBusy) return;
    setSessionActionBusy(true);
    try {
      const s = await createSession.mutateAsync({ projectId: id, data: { title: "New session", mode: "think" } });
      setMessages([]);
      priorLoaded.current = false;
      historyMsgCountRef.current = 0;
      setSessionId(s.id);
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
      setShowProjectMenu(false);
      toast.success("Started a new session");
    } catch (e) {
      reportError(e, { projectId: id });
      toast.error("Could not start new session");
    } finally {
      setSessionActionBusy(false);
    }
  }, [createSession, id, queryClient, setMessages, priorLoaded, historyMsgCountRef, setSessionId, sessionActionBusy]);

  const handleArchiveAndNew = useCallback(async (_reason: string) => {
    if (sessionActionBusy) return;
    setSessionActionBusy(true);
    try {
      const s = await createSession.mutateAsync({ projectId: id, data: { title: "New session", mode: "think" } });
      setMessages([]);
      priorLoaded.current = false;
      historyMsgCountRef.current = 0;
      setSessionId(s.id);
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
      setArchiveReasonDraft(null);
      setShowProjectMenu(false);
      toast.success("Started a new session.");
    } catch (e) {
      reportError(e, { projectId: id });
      toast.error("Could not start new session");
    } finally {
      setSessionActionBusy(false);
    }
  }, [createSession, id, queryClient, setMessages, priorLoaded, historyMsgCountRef, setSessionId, sessionActionBusy]);

  // ── Sessions sheet (gold-clock) data + actions ────────────────────────────
  const [sessionsSheetOpen, setSessionsSheetOpen] = useState(false);
  const { data: allSessionsForSheet = [], isLoading: allSessionsForSheetLoading } = useListSessions(id, {
    query: { enabled: !!id && sessionsSheetOpen, queryKey: getListSessionsQueryKey(id) },
  });
  const deleteSessionMutation = useDeleteSession();

  const handleSwitchSession = useCallback((sid: number | string) => {
    const numId = typeof sid === "string" ? Number(sid) : sid;
    if (!Number.isFinite(numId) || numId === sessionId) {
      setSessionsSheetOpen(false);
      return;
    }
    setMessages([]);
    priorLoaded.current = false;
    historyMsgCountRef.current = 0;
    setSessionId(numId);
    queryClient.invalidateQueries({ queryKey: ["messages", numId] });
    setSessionsSheetOpen(false);
  }, [sessionId, setMessages, priorLoaded, historyMsgCountRef, setSessionId, queryClient]);

  const handleDeleteSessionFromSheet = useCallback(async (sid: number | string) => {
    const numId = typeof sid === "string" ? Number(sid) : sid;
    if (!Number.isFinite(numId)) return;
    try {
      await deleteSessionMutation.mutateAsync({ id: numId });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey(id) });
      if (numId === sessionId) {
        setMessages([]);
        priorLoaded.current = false;
        historyMsgCountRef.current = 0;
        setSessionId(null);
      }
      toast.success("Session deleted");
    } catch (e) {
      reportError(e, { projectId: id });
      toast.error("Could not delete session");
    }
  }, [deleteSessionMutation, queryClient, id, sessionId, setMessages, priorLoaded, historyMsgCountRef, setSessionId]);






  // Close portaled header dropdowns on scroll/resize so they don't float off their anchors.
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showProjectMenu) return;
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      // Ignore scrolls that originate inside the popover itself.
      if (target && projectMenuRef.current && projectMenuRef.current.contains(target)) return;
      setShowProjectMenu(false);
    };
    const onResize = () => setShowProjectMenu(false);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
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
    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, newLens); window.dispatchEvent(new Event("atlas-lens-changed")); } catch {}
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

  // Terminal is always available — no auto-fallback on lens change.


  // mobileTab moved above (consumed by useChatStream).
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
  useEffect(() => {
    // The project-name chevron dispatches `open-projects-drawer` and opens the
    // full project dropdown (switch / rename / settings / clone / ledger /
    // dashboard / archive / delete). The folder icon dispatches the separate
    // `open-nav-drawer` event and opens the global navigation drawer.
    const openProjectMenu = () => setShowProjectMenu(true);
    const openNavDrawer = () => {
      // Folder icon ALWAYS opens the side nav drawer — never the per-project menu.
      setShowProjectMenu(false);
      setShowDrawer(true);
    };
    const closeProjectMenu = () => setShowProjectMenu(false);
    window.addEventListener("axiom:open-projects-drawer", openProjectMenu);
    window.addEventListener("axiom:open-nav-drawer", openNavDrawer);
    window.addEventListener("axiom:close-project-menu", closeProjectMenu);
    return () => {
      window.removeEventListener("axiom:open-projects-drawer", openProjectMenu);
      window.removeEventListener("axiom:open-nav-drawer", openNavDrawer);
      window.removeEventListener("axiom:close-project-menu", closeProjectMenu);
    };
  }, []);
  const [showVault, setShowVault] = useState(false);
  const [showForgeExternal, setShowForgeExternal] = useState(false);
  const [forgePreloadContent, setForgePreloadContent] = useState<string | undefined>(undefined);
  const [externalForgeNodes, setExternalForgeNodes] = useState<ArchNode[]>([]);
  const [forgeState, setForgeState] = useState<ForgeState | null>(null);
  // forgeContext state + reload effect moved above (consumed by useChatStream).
  // Explicit state captured at pill-open time so TheForge always gets a stable context snapshot
  const [forgeActiveProjectName, setForgeActiveProjectName] = useState<string | undefined>(undefined);
  const [forgeActiveProjectId, setForgeActiveProjectId] = useState<number | undefined>(undefined);
  // Scope: when Forge is opened from a Master Map node, hydrate just that node's context
  const [forgeScopeNodeId, setForgeScopeNodeId] = useState<string | null>(null);
  const [forgeScopeNodeLabel, setForgeScopeNodeLabel] = useState<string | null>(null);
  // URL-driven scoped entry: /project/:id?forgeNode=<id>&forgeNodeLabel=<label> opens Forge scoped.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const n = sp.get("forgeNode");
      if (n) {
        setForgeScopeNodeId(n);
        setForgeScopeNodeLabel(sp.get("forgeNodeLabel"));
        setShowForgeExternal(true);
      }
    } catch { /* noop */ }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // autoNameKey moved above (consumed by useChatStream).
  const [trustMode, setTrustMode] = useState<"review" | "auto">("review");
  const [autoRunCmd] = useState<string>("");
  const [previewRefreshTrigger, setPreviewRefreshTrigger] = useState(0);

  const importSource = (() => {
    try { return new URLSearchParams(window.location.search).get("source") ?? null; } catch { return null; }
  })();
  const isHomeHandoff = importSource === "home-handoff";

  // Commit carryover: ambient thread on /home was committed into this project.
  // Payload comes from sessionStorage seeded by the home-screen commit flow;
  // `greeting` is optional and falls back to a generic line in ChatStream.
  // Backend handoff (Cursor): persist `project.committed_at` + `project.commit_synthesis`
  // and seed this sessionStorage key from the commit transition.
  const [commitCarryover, setCommitCarryover] = useState<{ committedAt: string; greeting?: string | null } | null>(() => {
    try {
      if (importSource !== "commit-carryover") return null;
      const raw = sessionStorage.getItem(`atlas-commit-carryover-${id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { committedAt?: string; greeting?: string | null };
      if (!parsed?.committedAt) return null;
      return { committedAt: parsed.committedAt, greeting: parsed.greeting ?? null };
    } catch { return null; }
  });

  // Strip the source param + clear the storage key after consumption so a refresh
  // doesn't replay the marker against newer chat activity.
  useEffect(() => {
    if (!commitCarryover) return;
    try { sessionStorage.removeItem(`atlas-commit-carryover-${id}`); } catch {}
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("source") === "commit-carryover") {
        url.searchParams.delete("source");
        window.history.replaceState({}, "", url.toString());
      }
    } catch {}
    // Keep the marker visible for the session; clear on unmount/navigation.
    return () => setCommitCarryover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const [homeHandoffMeta, setHomeHandoffMeta] = useState<HomeHandoffMeta | null>(() => {
    try {
      const raw = sessionStorage.getItem(`atlas-home-handoff-${id}`);
      return raw ? JSON.parse(raw) as HomeHandoffMeta : null;
    } catch { return null; }
  });
  const [homeHandoffDataSettled, setHomeHandoffDataSettled] = useState(() => !isHomeHandoff || hasHomeHandoffNodeData(homeHandoffMeta));
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
    if (!isHomeHandoff) {
      setHomeHandoffDataSettled(true);
      return;
    }
    if (hasHomeHandoffNodeData(homeHandoffMeta)) {
      setHomeHandoffDataSettled(true);
      return;
    }
    setHomeHandoffDataSettled(false);
    const timer = setTimeout(() => setHomeHandoffDataSettled(true), 1200);
    return () => clearTimeout(timer);
  }, [id, isHomeHandoff, homeHandoffMeta]);

  useEffect(() => {
    if (!homeHandoffDataSettled || !showHomeHandoffBanner || showHomeHandoffDrawer) return;
    const timer = setTimeout(() => setShowHomeHandoffBanner(false), 4000);
    return () => clearTimeout(timer);
  }, [homeHandoffDataSettled, showHomeHandoffBanner, showHomeHandoffDrawer]);

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

  const [confirmDeleteProject, setConfirmDeleteProject] = useState(false);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const [forgeIntakeSheetOpen, setForgeIntakeSheetOpen] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);
  const [showDeepDive, setShowDeepDive] = useState(false);
  const [deepDiveContext, setDeepDiveContext] = useState("");
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

  const handleCreateProjectFromWorkspace = useCallback((name: string, githubRepo?: string) => {
    setCreateProjectError(null);
    createProjectMutation.mutate(
      { data: { name } },
      {
        onSuccess: (project) => {
          setShowNewProjectModal(false);
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          const normalizedRepo = normalizeGitHubRepoInput(githubRepo);
          if (normalizedRepo) {
            void fetch(`/api/projects/${project.id}`, {
              method: "PATCH",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ linkedRepo: serializeLinkedRepo({ fullName: normalizedRepo }) }),
            }).catch(() => {});
          }
          setLocation(`/project/${project.id}?intake=true`);
        },
        onError: (error) => {
          setCreateProjectError(error instanceof Error ? error.message : "Failed to create project");
        },
      },
    );
  }, [createProjectMutation, queryClient, setLocation]);

  // fileContext moved above (consumed by useChatStream).
  // chatPending owned by useChatStream.
  const [agenticMode, setAgenticMode] = useState(true);
  const [agenticIterCount, setAgenticIterCount] = useState(0);
  useEffect(() => { setAgenticIterCount(0); }, [sessionId]);
  useEffect(() => { if (!agenticMode) setAgenticIterCount(0); }, [agenticMode]);
  // activityStream owned by useChatStream.
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

  // Track content growth (streaming reveal) so the scroll-to-bottom arrow
  // updates even when the user isn't scrolling.
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let rafId: number | null = null;
    let cancelled = false;

    const attach = (el: HTMLDivElement) => {
      const recompute = () => {
        setShowWsScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
      };
      recompute();
      ro = new ResizeObserver(recompute);
      ro.observe(el);
      Array.from(el.children).forEach((c) => ro!.observe(c as Element));
      mo = new MutationObserver(() => {
        Array.from(el.children).forEach((c) => ro!.observe(c as Element));
        recompute();
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
      el.addEventListener("scroll", recompute, { passive: true });
      (el as unknown as { __wsRecompute?: () => void }).__wsRecompute = recompute;
    };

    const waitForRef = () => {
      if (cancelled) return;
      const el = chatPanelScrollRef.current;
      if (el) { attach(el); return; }
      rafId = requestAnimationFrame(waitForRef);
    };
    waitForRef();

    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro?.disconnect();
      mo?.disconnect();
      const el = chatPanelScrollRef.current as (HTMLDivElement & { __wsRecompute?: () => void }) | null;
      if (el?.__wsRecompute) {
        el.removeEventListener("scroll", el.__wsRecompute);
        delete el.__wsRecompute;
      }
    };
  }, []);
  const initialSent = useRef(false);
  const [openingMessage, setOpeningMessage] = useState<{ message: string; projectId: string | null } | null>(() => {
    try {
      // Quick Action V2 handoff (resume=quickaction): consume the
      // sessionStorage payload, hoist {intent, prompt} into the existing
      // opening-message pipeline, strip the query param, and clear state.
      try {
        const params = new URLSearchParams(window.location.search);
        if (params.get("resume") === "quickaction") {
          const raw = sessionStorage.getItem(`atlas:quickaction:resume:${id}`);
          sessionStorage.removeItem(`atlas:quickaction:resume:${id}`);
          params.delete("resume");
          const nextSearch = params.toString();
          const nextUrl =
            window.location.pathname +
            (nextSearch ? `?${nextSearch}` : "") +
            window.location.hash;
          window.history.replaceState({}, "", nextUrl);
          if (raw) {
            const payload = JSON.parse(raw) as { intent?: string; prompt?: string };
            const intent = (payload?.intent ?? "").toLowerCase();
            const text = (payload?.prompt ?? "").trim();
            if (text) {
              const prefix =
                intent === "build"
                  ? "Build: "
                  : intent === "think"
                  ? "Think through: "
                  : intent === "decide"
                  ? "Decide: "
                  : "";
              const seeded = `${prefix}${text}`;
              sessionStorage.setItem(OPENING_MESSAGE_STORAGE_KEY, seeded);
              sessionStorage.setItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY, String(id));
              return { message: seeded, projectId: String(id) };
            }
          }
        }
      } catch {}

      const storedOpeningMessage = sessionStorage.getItem(OPENING_MESSAGE_STORAGE_KEY);
      const storedProjectId = sessionStorage.getItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
      if (storedOpeningMessage !== null) {
        if (storedProjectId !== String(id)) {
          sessionStorage.removeItem(OPENING_MESSAGE_STORAGE_KEY);
          sessionStorage.removeItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
          return null;
        }
        return { message: storedOpeningMessage, projectId: storedProjectId };
      }
      return null;
    } catch {
      return null;
    }
  });
  // abortControllerRef owned by useChatStream.
  const importPrimed = useRef(false);
  const touchStartX = useRef(0);
  const homeHandoffDbLoadedRef = useRef<number | null>(null);
  const homePlanLoadedRef = useRef(false);

  const { data: allProjects } = useListProjects();
  // projectState / useProjectStateFallback moved above (consumed by useChatStream).
  const { data: fallbackProject, isLoading: fallbackProjectLoading } = useGetProject(id, {
    query: { enabled: !!id && useProjectStateFallback, queryKey: getGetProjectQueryKey(id) },
  });
  const project = projectState.project ?? fallbackProject;
  const addLocalMessage = useCallback((role: "user" | "assistant", content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        role,
        content,
        sentAt: new Date().toISOString(),
      },
    ]);
  }, [setMessages]);
  const launchPreviewUrl = project?.previewUrl ?? (() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(`atlas-preview-${id}`);
    } catch {
      return null;
    }
  })();
  const projectLoading = projectState.loading && !project ? true : fallbackProjectLoading;
  const githubPushToken = useGithubPushToken(project?.githubToken);
  // True when forge has run this session OR when saved AxiomFlow nodes exist for this project
  const hasForgeNodes = forgeContext !== null ||
    Object.keys((project?.nodeState ?? {}) as Record<string, unknown>)
      .some(k => !["auth", "db", "api", "state", "ui", "logic"].includes(k));
  const isBrandNewProject = messages.length === 0 && !chatPending && (priorLoaded.current || !sessionId) && !hasForgeNodes;
  const projectName = project?.name?.trim() ?? "";
  const isFirstMessage =
    chatPending && messages.filter((message) => message.role === "user").length === 1;
  const showProjectNameSkeleton =
    isFirstMessage && autoNameKey === 0 && DEFAULT_NAMES.has(projectName);

  async function handleManifest() {
    if (!project?.id) return;
    setManifestLoading(true);
    try {
      const projectIdType = project.id === null
        ? "null"
        : project.id === undefined
          ? "undefined"
          : typeof project.id;
      const projectIdStr = String(project.id);
      const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectIdStr);
      const looksInt = /^\d+$/.test(projectIdStr);
      const idShape = looksUuid ? "uuid" : looksInt ? "integer" : "other";

      const res = await fetch("/api/manifest/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({ projectId: project.id, sessionId }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await res.json() as ManifestDecisionResponse
        : null;

      if (res.status === 404) {
        const backendError = data && "error" in data && typeof data.error === "string" ? data.error : "Project not found";
        const diag = `Manifest 404 · ${backendError} · projectId=${projectIdStr} (type=${projectIdType}, shape=${idShape}, len=${projectIdStr.length})`;
        toast.error(diag, { duration: 10000 });
        console.error("[Manifest 404 diagnostic]", {
          projectId: project.id,
          projectIdType,
          projectIdString: projectIdStr,
          idShape,
          backendError,
        });
        throw new Error(diag);
      }

      if (!res.ok) {
        const errorMessage = data && "error" in data && typeof data.error === "string"
          ? data.error
          : `Manifest failed with status ${res.status}`;
        throw new Error(errorMessage);
      }

      if (!data) {
        throw new Error("Manifest returned an unreadable response");
      }

      if (!data.ready) {
        const missing = (data.missingCriteria ?? []).join(", ");
        addLocalMessage("assistant", `Atlas needs a bit more clarity before it can manifest this project.\n\nMissing: ${missing}\n\nContinue the conversation to fill in the gaps, then try again.`);
        return;
      }

      if (!data.decision) {
        throw new Error("Manifest response did not include a decision");
      }

      // V1 only supports atlas-generated.
      if (data.decision.activeEngine !== "atlas-generated") {
        addLocalMessage("assistant", `The manifest engine selected "${data.decision.activeEngine}" for this project. Only Atlas Generated is wired in V1 — escalation paths are coming soon.`);
        return;
      }

      if (!data.generatedCode || !data.componentName) {
        throw new Error("Manifest response did not include generated preview code");
      }

      setManifestDecision(data.decision);

      const previewRes = await fetch("/api/preview/component", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        credentials: "include",
        body: JSON.stringify({
          code: data.generatedCode,
          componentName: data.componentName,
        }),
      });
      if (!previewRes.ok) {
        throw new Error(`Preview render failed with status ${previewRes.status}`);
      }
      const previewHtml = await previewRes.text();
      setManifestPreviewHtml(previewHtml);
      openPreviewPanel();
    } catch (err) {
      console.error("Manifest failed:", err);
      const message = err instanceof Error ? err.message : "Manifest failed";
      toast.error(message);
      addLocalMessage("assistant", `Manifest couldn't complete: ${message}`);
    } finally {
      setManifestLoading(false);
    }
  }

  useEffect(() => {
    const titleSpan = document.querySelector<HTMLSpanElement>(
      ".atlas-app-header button[title^='Tap to switch project'] > span",
    );
    if (!titleSpan) return;
    if (showProjectNameSkeleton) {
      titleSpan.classList.add("atlas-project-name-autoname-pulse");
      titleSpan.setAttribute("data-atlas-autoname-placeholder", "Naming project");
    } else {
      titleSpan.classList.remove("atlas-project-name-autoname-pulse");
      titleSpan.removeAttribute("data-atlas-autoname-placeholder");
    }
    return () => {
      titleSpan.classList.remove("atlas-project-name-autoname-pulse");
      titleSpan.removeAttribute("data-atlas-autoname-placeholder");
    };
  }, [autoNameKey, showProjectNameSkeleton]);

  useEffect(() => {
    if (projectState.forgeState) {
      setForgeState({
        forged: !!projectState.forgeState.forged,
        dismissed: !!projectState.forgeState.dismissed,
      });
    } else if (projectState.state && !projectState.loading) {
      setForgeState({ forged: hasForgeNodes, dismissed: false });
    }
  }, [hasForgeNodes, projectState.forgeState, projectState.loading, projectState.state]);

  const updateForgeState = useCallback(async (action: "forged" | "dismissed") => {
    if (!Number.isFinite(id)) return;
    try {
      const res = await fetch(`/api/projects/${id}/forge-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
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

  // fallbackEntries + entries moved above (consumed by useChatStream).
  // createSession moved above (consumed by useChatStream).
  const createEntry = useCreateEntry();
  // creatingSessionRef + ensureSessionId now owned by useChatStream.
  const { showParkingDrawer, setShowParkingDrawer, refreshParkedEntries } = useParkingLot(id, {
    projectState,
    queryClient,
    useProjectStateFallback,
    getListEntriesQueryKey,
    getListSessionsQueryKey,
  });

  const parkedEntries = projectState.state
    ? projectState.parked
    : entries.filter((entry) => entry.status === "parked");

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
    if (!linkedRepo) {
      toast.error(
        "No repository linked. Link a repo in the header dropdown.",
        { duration: 4000 }
      );
      return;
    }
    const token = githubPushToken;
    if (!token) {
      toast.error(
        "GitHub token not found. Add it in the Connections tab.",
        { duration: 4000 }
      );
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    const branch = `atlas/auto-${today}-${Date.now().toString(36).slice(-4)}`;
    try {
      await fetch("/api/github/branch", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
        body: JSON.stringify({ repo: linkedRepo.fullName, branch, baseBranch: linkedRepo.defaultBranch }),
      });
      for (let i = 0; i < fileEdits.length; i++) {
        const fe = fileEdits[i];
        await fetch("/api/github/commit", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
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
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            credentials: "include",
            body: JSON.stringify({ command: autoRunCmd, projectId: id }),
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
  }, [linkedRepo, githubPushToken, autoRunCmd]);

  useEffect(() => {
    if (trustMode !== "auto") return;
    messages.forEach(msg => {
      if (msg.fileEdits?.length && !msg.autoPushed) {
        msg.autoPushed = true;
        handlePushAll(msg.fileEdits);
      }
    });
  }, [messages, trustMode, handlePushAll]);

  // Prior-message hydration moved into useChatStream.

  // Sync linkedRepo from project DB when project loads
  useEffect(() => {
    setLinkedRepo(parseLinkedRepo(project?.linkedRepo) as LinkedRepo | null);
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

    const token = githubPushToken ?? "__server__";

    let cancelled = false;
    const parsedRepo = parseLinkedRepo(project.linkedRepo);
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
          { headers: { ...getAuthHeaders(), "x-github-token": token } }
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
              { headers: { ...getAuthHeaders(), "x-github-token": token } }
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
  }, [githubPushToken, id, project?.linkedRepo]);

  // Auto-run analyze scan at workspace level so Atlas knows the full codebase
  // structure the moment a project opens — no FILES tab visit required.
  // Skips if a fresh scan (< 24h) already exists in localStorage.
  useEffect(() => {
    if (!project?.linkedRepo) return;
    const parsedRepo = parseLinkedRepo(project.linkedRepo);
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

    const token = githubPushToken ?? "__server__";

    fetch("/api/github/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
      body: JSON.stringify({ repo: parsedRepo.fullName, branch: parsedRepo.defaultBranch ?? "main" }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
      })
      .catch(() => { /* silent — never break the workspace */ });
  }, [githubPushToken, id, project?.linkedRepo]);

  // Persist last visited project for footer LEDGER shortcut
  useEffect(() => {
    if (id) { try { localStorage.setItem("atlas-last-project", String(id)); } catch {} }
  }, [id]);

  // ensureSessionId + session bootstrap effect now owned by useChatStream.

  // Always-current ref so doSend doesn't capture stale state
  const ghToken = githubPushToken ?? (() => { try { return localStorage.getItem("atlas-github-token") || null; } catch { return null; } })();
  sendCtxRef.current = {
    wsLens,
    wsModel,
    githubToken: ghToken,
  };

  // doSend / handleRegenerate owned by useChatStream.



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

  const reviewMessages = useMemo(
    () => messages.filter((message) =>
      message.role === "assistant" &&
      !!message.plan &&
      (planStates.get(message.id ?? 0) ?? "pending") !== "skipped"
    ),
    [messages, planStates]
  );
  const showReviewTab = reviewMessages.length > 0;
  const pendingReviewCount = useMemo(
    () => reviewMessages.filter((m) => (planStates.get(m.id ?? 0) ?? "pending") === "pending").length,
    [reviewMessages, planStates]
  );
  const chatPlanStates = useMemo(() => {
    if (!showReviewTab) return planStates;
    const next = new Map(planStates);
    for (const message of reviewMessages) {
      next.set(message.id ?? 0, "skipped");
    }
    return next;
  }, [planStates, reviewMessages, showReviewTab]);

  useEffect(() => {
    if (leftTab === "review" && !showReviewTab) {
      setLeftTab("chat");
    }
  }, [leftTab, showReviewTab]);

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
    if (openingMessage === null || initialSent.current) return;
    if (openingMessage.projectId !== String(id)) {
      try {
        sessionStorage.removeItem(OPENING_MESSAGE_STORAGE_KEY);
        sessionStorage.removeItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
      } catch {}
      setOpeningMessage(null);
      return;
    }
    if (!sessionId || sessionsLoading) return;
    const trimmedOpeningMessage = openingMessage.message.trim();
    if (!trimmedOpeningMessage) {
      try {
        sessionStorage.removeItem(OPENING_MESSAGE_STORAGE_KEY);
        sessionStorage.removeItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
      } catch {}
      setOpeningMessage(null);
      return;
    }
    initialSent.current = true;
    setInput("");
    doSend(trimmedOpeningMessage, sessionId, []);
    try {
      sessionStorage.removeItem(OPENING_MESSAGE_STORAGE_KEY);
      sessionStorage.removeItem(OPENING_MESSAGE_PROJECT_ID_STORAGE_KEY);
    } catch {}
    setOpeningMessage(null);
  }, [openingMessage, id, sessionId, sessionsLoading, doSend, setInput]);

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
    const fromHome = (() => {
      try {
        const params = new URLSearchParams(window.location.search);
        return params.get("from") === "home" || params.get("source") === "home-handoff";
      } catch {
        return false;
      }
    })();
    if (!fromHome) return;
    if (messages.length > 0) { homeHandoffPrimed.current = true; return; }
    if (!project) return;
    const primeHomeHandoff = (prompt: string) => {
      homeHandoffPrimed.current = true;
      void fetch(`/api/sessions/${sessionId}/idea-mode`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }).catch(() => {});
      setTimeout(() => {
        doSend(prompt, sessionId, []);
      }, 300);
    };
    const fallbackPrompt = `I've just arrived in the ${project.name} workspace. ${project.description ? `Here's what we're building: ${project.description}. ` : ""}Acknowledge we're starting and ask what's first.`;
    if (!project.memory) {
      primeHomeHandoff(fallbackPrompt);
      return;
    }
    try {
      const mem = JSON.parse(project.memory);
      const briefEntry = mem?.entries?.find((e: any) =>
        e.tier === 1 && typeof e.text === "string" && e.text.startsWith("Project brief from home conversation:")
      );
      if (!briefEntry) {
        primeHomeHandoff(fallbackPrompt);
        return;
      }
      const briefText = (briefEntry.text as string).replace("Project brief from home conversation: ", "");
      primeHomeHandoff(`I've just arrived from our home conversation. You have my project brief in memory: "${briefText}". Acknowledge what we discussed and where we're starting — then ask what's first.`);
    } catch { primeHomeHandoff(fallbackPrompt); }
  }, [sessionId, messages.length, project, doSend]);

  const sendFromIntentCapture = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || chatPending) return;
    if (atlasGreeting) setAtlasGreeting(null);
    if (trimmed.includes("TERMINAL_CMD:") && leftTab !== "chat") {
      setLeftTab("chat");
    }
    if (trimmed.includes("TERMINAL_CMD:") && mobileTab !== "chat") {
      setMobileTab("chat");
    }
    doSend(trimmed, sessionId, messages);
  }, [sessionId, chatPending, messages, doSend, atlasGreeting, leftTab, mobileTab]);

  // Bridge: CommitHistoryCard (and other detached UI) dispatches
  // "atlas:workspace-send" with { text } — route it into the chat.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { text?: string } | undefined;
      const text = detail?.text?.trim();
      if (!text || !sessionId) return;
      doSend(text, sessionId, messagesRef.current);
    };
    window.addEventListener("atlas:workspace-send", handler);
    return () => window.removeEventListener("atlas:workspace-send", handler);
  }, [sessionId, doSend]);

  // ARTIFACT protocol — intercept ARTIFACT: <json> lines in assistant responses.
  // Strips the line from display and POSTs the artifact to /api/artifacts.
  const processedArtifactRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ARTIFACT_RE = /^ARTIFACT:\s*(\{.*\})\s*$/m;
    messages.forEach((m, idx) => {
      if (m.role !== "assistant" || m.streaming) return;
      if (typeof m.content !== "string") return;
      const match = m.content.match(ARTIFACT_RE);
      if (!match) return;
      const key = `${m.id ?? `i${idx}`}`;
      if (processedArtifactRef.current.has(key)) return;
      processedArtifactRef.current.add(key);

      let parsed: { type?: string; title?: string; content?: string } | null = null;
      try { parsed = JSON.parse(match[1]); } catch { parsed = null; }

      // Strip the line from displayed message
      const cleaned = m.content.replace(ARTIFACT_RE, "").replace(/\n{3,}/g, "\n\n").trim();

      if (!parsed || !parsed.type || !parsed.title || typeof parsed.content !== "string") {
        setMessages((prev) => prev.map((pm, pi) => (pi === idx ? { ...pm, content: cleaned } : pm)));
        toast("Failed to save artifact.");
        return;
      }

      const artifact = { type: parsed.type, title: parsed.title, content: parsed.content };
      setMessages((prev) => prev.map((pm, pi) => (pi === idx ? { ...pm, content: cleaned, artifact } : pm)));
      if (artifact.type === "plan") setLatestPlanArtifact(artifact);

      const title = parsed.title;
      void (async () => {
        try {
          const res = await fetch("/api/artifacts", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", ...getAuthHeaders() },
            body: JSON.stringify({
              projectId: id,
              ...(sessionId ? { sessionId } : {}),
              type: parsed!.type,
              title,
              content: parsed!.content,
            }),
          });
          if (!res.ok) throw new Error();
          toast(`${title} saved to Artifacts.`);
        } catch {
          toast("Failed to save artifact.");
        }
      })();
    });
  }, [messages, setMessages, id, sessionId]);

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

  // Smart Anchor: stick to bottom only when user is already near it.
  // If they scrolled up to re-read while Atlas streams, freeze instead of yanking back.
  // A fresh user message (userMsgCount increments) bypasses the freeze.
  const userMsgCount = useMemo(
    () => messages.filter((m) => m.role === "user").length,
    [messages],
  );
  useSmartAutoScroll(chatPanelScrollRef, [messages.length, chatPending], {
    forceDeps: [userMsgCount],
    behavior: "auto",
  });


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
    const maxH = parseFloat(getComputedStyle(el).maxHeight) || 180;
    el.style.height = Math.min(el.scrollHeight, maxH) + "px";
  };

  const sendPreparingSession = !sessionId && (sessionsLoading || createSession.isPending);

  const handleSend = async (opts?: { mode: "plan" | "build" }) => {
    const text = input.trim();
    if ((!text && attachedFiles.length === 0) || chatPending) return;
    const sid = sessionId ?? await ensureSessionId().catch(() => null);
    if (!sid) return;
    if (atlasGreeting) setAtlasGreeting(null);
    setShowHomeHandoffBanner(false);
    playSend();
    const current = messages;
    const files = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    if (textareaRef.current) {
      // Clear inline height so the textarea collapses back to its ambient
      // single-line size (driven by style minHeight), then blur to dismiss
      // the expanded sheet — draft state is already cleared above.
      textareaRef.current.style.height = "";
      textareaRef.current.blur();
    }
    setInputFocused(false);

    const imageFiles = files.filter(f => f.type.startsWith("image/")).slice(0, 10);
    const otherFiles = files.filter(f => !f.type.startsWith("image/"));
    // Collect selected zip entries as text context for Atlas
    const zipContext = zipFiles
      .filter(z => z.selected && z.content)
      .map(z => `// FILE: ${z.path}\n${z.content}`)
      .join('\n\n---\n\n');
    const suffix = (otherFiles.length > 0 || zipFiles.length > 0)
      ? `\n[Attached: ${[...otherFiles.map(f => f.name), ...(zipFiles.length > 0 ? [`${zipName} (${zipFiles.filter(z=>z.selected).length}/${zipFiles.length} files)`] : [])].join(", ")}]`
      : "";
    const fullText = (text + suffix).trim() || (files.length > 0 ? "(attachment)" : "");

    if (fullText.includes("TERMINAL_CMD:") && leftTab !== "chat") {
      setLeftTab("chat");
    }
    if (fullText.includes("TERMINAL_CMD:") && mobileTab !== "chat") {
      setMobileTab("chat");
    }

    const sendOpts = {
      mode: opts?.mode,
      planMode: opts?.mode === "plan",
      buildMode: opts?.mode === "build",
    };
    if (imageFiles.length > 0) {
      Promise.all(imageFiles.map(f =>
        fileToBase64Safe(f).then(({ base64, mediaType }) => ({ base64, mediaType, name: f.name }))
      ))
        .then((attachments) => doSend(fullText, sid, current, zipContext || undefined, attachments, sendOpts))
        .catch(() => {
          const fallbackText = fullText || `[Attached: ${imageFiles.map(f => f.name).join(", ")}]`;
          doSend(fallbackText, sid, current, zipContext || undefined, undefined, sendOpts);
        });
    } else {
      doSend(fullText, sid, current, zipContext || undefined, undefined, sendOpts);
    }
  };

  const doSendFromComposer = useCallback((...args: Parameters<typeof doSend>) => {
    if (atlasGreeting) setAtlasGreeting(null);
    doSend(...args);
  }, [atlasGreeting, doSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePark = useCallback(
    (content: string) => {
      if (!sessionId) return;
      haptic.short();
      playPark();
      createEntry.mutate(
        { projectId: id, data: { ...buildParkedEntryPayload(content, sessionId) } },
        { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); void refreshParkedEntries(); } }
      );
    },
    [id, sessionId, createEntry, queryClient, refreshParkedEntries, playPark]
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
        { onSuccess: () => { haptic.short(); playCommit(); queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); void refreshParkedEntries(); } }
      );
    },
    [id, sessionId, createEntry, queryClient, playCommit, refreshParkedEntries]
  );

  const handleRollbackPush = useCallback(async (record: PushRecord) => {
    const token = githubPushToken;
    if (!linkedRepo || !token || !record.originalContent) return;
    await fetch("/api/github/commit", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
      body: JSON.stringify({
        repo: linkedRepo.fullName, branch: record.branch,
        path: record.path, content: record.originalContent,
        message: `Atlas: rollback ${record.filename}`,
      }),
    });
    setPushHistory((prev) => prev.map((r) => r.id === record.id ? { ...r, rolledBack: true } : r));
  }, [linkedRepo, githubPushToken]);

  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
    setTimeout(() => autoResize(), 0);
  }, []);

  const { listening: voiceListening, toggle: toggleVoice, isSupported: voiceSupported } =
    useVoiceInput(handleVoiceTranscript);

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

  // ── Manual + auto readiness rescan ────────────────────────────────────────
  const [isScanning, setIsScanning] = useState(false);
  const autoScanTriggeredRef = useRef<Set<number>>(new Set());
  const hasLinkedRepo = !!project?.linkedRepo;
  const runScan = useCallback(async (silent: boolean) => {
    if (!Number.isFinite(id)) return;
    if (!silent) setIsScanning(true);
    try {
      const parsedRepo = project?.linkedRepo ? parseLinkedRepo(project.linkedRepo) : null;
      if (parsedRepo?.fullName) {
        const scanKey = `atlas-scan-${id}`;
        try { localStorage.removeItem(scanKey); } catch {}
        try {
          const token = githubPushToken ?? "__server__";
          const analyze = await fetch("/api/github/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...getAuthHeaders(), "x-github-token": token },
            body: JSON.stringify({ repo: parsedRepo.fullName, branch: parsedRepo.defaultBranch ?? "main" }),
          });
          if (analyze.ok) {
            const data = await analyze.json().catch(() => null);
            if (data) {
              try { localStorage.setItem(scanKey, JSON.stringify(data)); } catch {}
            }
          }
        } catch {
          // Silent — never block readiness scanning if GitHub analyze fails
        }
      }
      const r = await fetch(`/api/projects/${id}/scan`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ source: "github" }),
      });
      if (!r.ok) {
        if (!silent) {
          if (r.status === 400 || r.status === 404) {
            toast.error("No GitHub repo linked", {
              description: "Connect one in the Files tab.",
              className: "atlas-toast-pill",
            });
          } else {
            toast.error("Scan failed", {
              description: "Try again in a moment.",
              className: "atlas-toast-pill",
            });
          }
        }
        return;
      }
      const body = await r.json().catch(() => ({} as any));
      const newScore =
        typeof body?.score === "number" ? body.score :
        typeof body?.snapshot?.score === "number" ? body.snapshot.score :
        typeof body?.latestSnapshotScore === "number" ? body.latestSnapshotScore :
        null;
      const prev = mapReadiness;
      let rounded: number | null = null;
      if (newScore != null) {
        rounded = Math.round(newScore);
        setMapReadiness(rounded);
        if (prev > 0 && rounded < prev) haptic.warn();
      }
      queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
      if (!silent) {
        if (rounded != null) {
          const delta = prev > 0 ? rounded - prev : 0;
          const deltaStr = delta > 0 ? ` ↑${delta}` : delta < 0 ? ` ↓${Math.abs(delta)}` : "";
          toast.success(`${rounded}%${deltaStr}`, {
            description: "Readiness updated",
            className: "atlas-toast-pill",
          });
        } else {
          toast.success("Scanned", { className: "atlas-toast-pill" });
        }
      }
    } catch {
      if (!silent) toast.error("Scan failed", {
        description: "Check your connection.",
        className: "atlas-toast-pill",
      });
    } finally {
      if (!silent) setIsScanning(false);
    }
  }, [githubPushToken, id, queryClient, mapReadiness, project?.linkedRepo]);

  useEffect(() => {
    if (!Number.isFinite(id) || !hasLinkedRepo) return;
    if (autoScanTriggeredRef.current.has(id)) return;
    if (project?.latestSnapshotScore != null) return;
    autoScanTriggeredRef.current.add(id);
    void runScan(true);
  }, [id, hasLinkedRepo, project?.latestSnapshotScore, runScan]);

  // pendingResolvedNodeIds moved above (consumed by useChatStream).
  useEffect(() => {
    if (!isHomeHandoff || !Number.isFinite(id) || homeHandoffDbLoadedRef.current === id) return;
    homeHandoffDbLoadedRef.current = id;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${id}`, {
          credentials: "include",
          headers: getAuthHeaders(),
          signal: controller.signal,
        });
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
      } catch {
        // Handoff details are a progressive enhancement; keep the workspace usable.
      } finally {
        if (!cancelled) setHomeHandoffDataSettled(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [id, isHomeHandoff, parkedEntries.length]);
  const [pendingTerminalCommand, setPendingTerminalCommand] = useState<string | null>(null);
  const handleRunCommand = useCallback((command: string) => {
    setPendingTerminalCommand(command);
    setLeftTab("terminal");
    if (wsLens !== "build" && wsLens !== "scenario") {
      setWsLensRaw("build");
    }
  }, [wsLens]);

  // Shared Forge-nodes apply pipeline. Used by TheForge's onNodesReady AND
  // by the in-composer / assistant-bubble Forge intake flows so all three
  // surfaces produce identical side effects (canvas, ctx, nodeState, ledger).
  const applyForgeNodes = useCallback((nodes: ArchNode[]) => {
    setExternalForgeNodes(nodes);
    const ctx = nodes.map(n => `[${n.type}] ${n.label}`).join(" | ");
    setForgeContext(ctx);
    try { sessionStorage.setItem(`atlas-forge-ctx-${id}`, ctx); } catch { /* noop */ }

    const targetProjectId = forgeActiveProjectId ?? id;
    if (Number.isFinite(targetProjectId) && nodes.length > 0) {
      const currentNodeState = ((project?.nodeState ?? {}) as Record<string, unknown>);
      const forgedState: Record<string, unknown> = {};
      nodes.forEach((n) => {
        forgedState[n.id] = {
          resolved: n.resolved,
          label: n.label,
          type: n.type,
          x: n.x,
          y: n.y,
          ...(n.details ? { details: n.details } : {}),
          ...(n.meta ? { meta: n.meta } : {}),
          ...(n.moscow ? { moscow: n.moscow } : {}),
          ...(n.question ? { question: n.question } : {}),
          ...(n.strategicAnswer ? { strategicAnswer: n.strategicAnswer } : {}),
        };
      });
      updateProjectHeader.mutate(
        { id: targetProjectId, data: { nodeState: { ...currentNodeState, ...forgedState } } },
        { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() }); } }
      );

      const resolvedCount = nodes.filter(n => n.resolved).length;
      const summary = nodes.slice(0, 6).map(n => `[${n.type}] ${n.label}`).join(" · ");
      createEntry.mutate(
        {
          projectId: targetProjectId,
          data: {
            title: `Forge run · ${nodes.length} node${nodes.length === 1 ? "" : "s"} mapped`,
            summary: summary.slice(0, 500),
            details: `Forge committed ${nodes.length} node${nodes.length === 1 ? "" : "s"} into the system map (${resolvedCount} resolved).`,
            status: "committed",
            severity: "committed",
            verb: "new",
            mode: "build",
            sessionId: sessionId ?? null,
          },
        },
        { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) }); } }
      );
    }

    void updateForgeState("forged");
    setDesktopForceTab("map");
    setTimeout(() => setDesktopForceTab(undefined), 80);
    if (isMobile) setMobileTab("map");
  }, [id, forgeActiveProjectId, project, sessionId, isMobile, updateProjectHeader, createEntry, queryClient, updateForgeState]);

  // ── Codegen bridge (atlas-codegen edge function → sandbox preview) ──────────
  const codegen = useCodegen({
    projectId: id,
    sessionId: sessionId ?? null,
    onResult: (file) => {
      setSandboxCode(file.content);
      openPreviewPanel();
      toast(`Generated ${file.filename}`);
    },
    onError: (msg) => toast(`Codegen failed: ${msg}`),
  });

  // Detect a BUILD intent in a Forge transcript so we can auto-fire codegen
  // after intake commits nodes into the system map.
  const BUILD_INTENT_RE = /\b(build|generate|create|scaffold|prototype|make|render|design)\b/i;

  const handleForgeIntake = useCallback(async (content: string) => {
    try {
      const result = await submitForgeIntake({ transcript: content, projectId: id });
      applyForgeNodes(result.nodes);
      toast(`Forge intake · ${result.nodes.length} node${result.nodes.length === 1 ? "" : "s"} mapped`);

      // Decision-led builder: once the intent is committed (Forge nodes mapped),
      // a detected BUILD verb hands off to the codegen pipeline.
      if (BUILD_INTENT_RE.test(content)) {
        void codegen.run(content, result.summary);
      }
    } catch (e) {
      toast("Forge intake failed — try a more specific description.");
      throw e;
    }
  }, [id, applyForgeNodes, codegen]);

  // Open the ForgeIntakeSheet from anywhere (LifecycleGlyph long-press, etc).
  useEffect(() => {
    const open = () => setForgeIntakeSheetOpen(true);
    window.addEventListener(FORGE_INTAKE_OPEN_EVENT, open as EventListener);
    return () => window.removeEventListener(FORGE_INTAKE_OPEN_EVENT, open as EventListener);
  }, []);




  // messagesRef + summarize effect owned by useChatStream.


  const handleTerminalComplete = useCallback((_command: string, _output: string, _exitCode: number | null) => {
    // Keep terminal execution local to the terminal panel. Sending command output
    // back through chat was causing unsolicited assistant follow-ups that could
    // switch the right panel into other views.
  }, []);

  const unifiedSubheaderTab: UnifiedSubheaderTab =
    leftTab === "diff" || leftTab === "review" ? "changes"
    : leftTab === "blueprints" ? "blueprints"
    : leftTab === "artifacts" ? "artifacts"
    : leftTab === "terminal" ? "console"
    : "chat";

  const handleUnifiedSubheaderTabChange = useCallback((tab: UnifiedSubheaderTab) => {
    if (tab === "chat") {
      setLeftTab("chat");
      if (isMobile) {
        setMobileTab("chat");
        setRightOpen(false);
      }
      return;
    }
    if (tab === "changes") {
      setLeftTab("diff");
      return;
    }
    if (tab === "blueprints") {
      setLeftTab("blueprints");
      return;
    }
    if (tab === "artifacts") {
      setLeftTab("artifacts");
      return;
    }
    setLeftTab("terminal");
  }, [isMobile]);

  // (legacy subheader menu actions removed — those entries live in the composer ... menu now)


  const handleReviewPushSuccess = useCallback((records: PushRecord[]) => {
    haptic.double();
    setPushHistory((prev) => {
      const next = [...prev, ...records].slice(-20);
      updateProjectHeader.mutate({ id, data: { pushHistory: next } });
      return next;
    });
    const filenames = records.map((record) => record.filename).join(", ");
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
    setPreviewRefreshTrigger((tick) => tick + 1);
    setTimeout(() => setPreviewRefreshTrigger((tick) => tick + 1), 25000);
    setTimeout(() => setPreviewRefreshTrigger((tick) => tick + 1), 55000);
    fetch(`/api/deploy/after-push?atlasProjectId=${id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hasVercel?: boolean; status?: string; alias?: string; url?: string; visualQa?: DeployQa; autoMonitoringSetUp?: boolean; autoMonitoringMessage?: string } | null) => {
        if (!data?.hasVercel) return;
        const host = data.alias
          ? `https://${data.alias}`
          : data.url
            ? `https://${data.url}`
            : null;
        const content =
          data.status === "ready"
            ? `Deployed ✓${host ? `\n\nLive at ${host}` : ""}${data.autoMonitoringSetUp ? "\n\nI've set up automatic monitoring for your app." : ""}`
            : data.status === "failed"
              ? "Deploy failed. Check your Vercel dashboard — the build may need a fix."
              : null;
        if (!content) return;
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant" as const,
            content,
            model: "system",
            intentType: "BUILD",
            sentAt: new Date().toISOString(),
            ...(data.visualQa ? { deployQa: data.visualQa } : {}),
          },
        ]);
      })
      .catch(() => {});
    if (sessionId) {
      if (agenticMode && agenticIterCount >= 8) {
        return;
      }
      const repoName = linkedRepo?.fullName ?? "unknown repo";
      const filePaths = records.map((record) => record.path).join(", ");
      if (agenticMode) setAgenticIterCount((count) => count + 1);
      doSend(
        `[FILE_COMMITTED] ${records.length} file(s) committed to ${repoName}: ${filePaths}. Verify the build.`,
        sessionId,
        messagesRef.current,
        undefined,
        undefined,
        { displayAs: "autoVerify" },
      );
    }
  }, [agenticIterCount, agenticMode, createEntry, doSend, id, linkedRepo?.fullName, queryClient, refreshParkedEntries, sessionId, updateProjectHeader]);

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

  const hydrateWorkspaceFromIntake = useCallback(async (answers: IntakeAnswers) => {
    const seededNodes = buildIntakeSeedNodes(answers);
    const seededEntries = buildIntakeEntries(answers);
    const nextForgeContext = seededNodes.map((node) => `[${node.type}] ${node.label}${node.strategicAnswer ? `: ${node.strategicAnswer}` : ""}`).join(" | ");
    const greeting = buildIntakeGreeting(answers);

    if (seededNodes.length > 0) {
      setExternalForgeNodes(seededNodes);
      setHomeHandoffMeta({
        parkedCount: parkedEntries.length,
        flowNodeCount: seededNodes.length,
        goalLabel: seededNodes.find((node) => node.type === "goal")?.strategicAnswer ?? seededNodes[0]?.strategicAnswer ?? seededNodes[0]?.label ?? "your project",
        parkedTitles: parkedEntries.slice(0, 6).map((entry) => entry.title),
        nodes: seededNodes.map((node) => ({
          id: node.id,
          label: node.label,
          type: node.type,
          details: node.details,
          meta: node.meta,
          moscow: node.moscow,
        })),
      });
    }

    setForgeContext(nextForgeContext || null);
    try { sessionStorage.setItem(`atlas-forge-ctx-${id}`, nextForgeContext); } catch {}
    setAtlasGreeting(greeting);
    setGreetingLoading(false);
    void updateForgeState("forged");

    if (seededEntries.length > 0) {
      await Promise.all(seededEntries.map((entry) =>
        createEntry.mutateAsync({
          projectId: id,
          data: {
            title: entry.title,
            summary: entry.summary.slice(0, 500),
            status: "parked",
            severity: "parked",
            mode: "think",
            verb: "forge_intake",
          },
        }).catch(() => null)
      ));
    }

    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) });
    void refreshParkedEntries();

    if (isMobile) {
      setMobileTab("map");
      setRightOpen(true);
    } else {
      setDesktopForceTab("map");
      setTimeout(() => setDesktopForceTab(undefined), 120);
    }
  }, [createEntry, id, isMobile, parkedEntries, queryClient, refreshParkedEntries, updateForgeState]);

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
  const {
    zipFiles, setZipFiles,
    zipName, setZipName,
    zipTruncated, setZipTruncated,
    isDragOver, setIsDragOver,
    processZip, clearZip, toggleZipFile, setAllZip,
  } = useComposerZip(id, setFileContext);

  const liveGeneration = useMemo(
    () => {
      // Codegen run takes priority — its synthetic step stream owns the card.
      if (codegen.running || codegen.steps.length > 0) {
        return { mode: codegen.mode, steps: codegen.steps, shouldShow: true };
      }
      return parseLiveGeneration(activityStream.content, chatPending);
    },
    [activityStream.content, chatPending, codegen.running, codegen.steps, codegen.mode]
  );
  useEffect(() => {
    if (/FILE_EDIT/i.test(activityStream.content)) setSubheaderOpen(true);
  }, [activityStream.content]);
  useEffect(() => {
    const msg = messages[messages.length - 1];
    if (
      msg?.role === "assistant" &&
      !msg.streaming &&
      ((msg.fileEdits?.length ?? 0) > 0 || /FILE_EDIT/i.test(msg.content ?? ""))
    ) {
      setSubheaderOpen(true);
    }
  }, [messages]);

  // ── Project not found ────────────────────────────────────────────────────
  // Do NOT redirect on fetch failure — stay on the workspace and show an inline
  // notice. Auto-redirecting back to /home masked real backend errors.
  const projectNotFound = !projectLoading && !sessionsLoading && !!id && !project;

  if (projectNotFound) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 14, padding: 24,
        background: "var(--atlas-bg)", color: "var(--atlas-fg)", textAlign: "center",
      }}>
        <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.3em", textTransform: "uppercase", color: "var(--atlas-gold)", opacity: 0.6 }}>
          Workspace
        </div>
        <div style={{ fontSize: 16, fontWeight: 400, letterSpacing: "-0.01em", maxWidth: 360 }}>
          Couldn't load this project right now.
        </div>
        <div style={{ fontSize: 12, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.6, maxWidth: 320, lineHeight: 1.6 }}>
          The backend didn't respond. Check your connection and retry — you won't be redirected.
        </div>
        <button
          onClick={() => queryClient.invalidateQueries()}
          style={{
            marginTop: 4, padding: "9px 20px", borderRadius: 8,
            background: "color-mix(in oklab, var(--atlas-gold) 12%, transparent)",
            border: "1px solid rgba(201,162,76,0.3)", color: "var(--atlas-gold)",
            fontSize: 11, fontFamily: "var(--app-font-mono)", letterSpacing: "0.1em",
            textTransform: "uppercase", cursor: "pointer",
          }}
        >
          Retry
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
    <>
      <FocusModeAura focus={project ? "project" : "none"} />
      {showIntake && (
        <ForgeIntake
          projectId={id}
          onComplete={async (answers) => {
            await hydrateWorkspaceFromIntake(answers);
            setShowIntake(false);
            const url = new URL(window.location.href);
            url.searchParams.delete("intake");
            window.history.replaceState({}, "", url.toString());
          }}
        />
      )}
      {!showIntake && (
    <div
      style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "var(--atlas-bg)", overflow: "hidden", zIndex: 0, paddingBottom: isMobile ? "calc(var(--atlas-dock-height) + env(safe-area-inset-bottom, 0px))" : 0 }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file && file.name.toLowerCase().endsWith(".zip")) await processZip(file);
      }}
    >
      <style>{`
        .atlas-chat-timeline {
          flex: 1 !important;
          min-height: 0 !important;
          overflow-y: auto !important;
          padding-top: 8px !important;
          scroll-padding-top: 8px;
        }
        @keyframes atlas-project-name-autoname-pulse {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.78; }
        }
        .atlas-project-name-autoname-pulse {
          color: transparent !important;
          opacity: 1 !important;
          position: relative;
        }
        .atlas-project-name-autoname-pulse::before {
          animation: atlas-project-name-autoname-pulse 1.4s ease-in-out infinite;
          color: var(--atlas-fg);
          content: attr(data-atlas-autoname-placeholder);
          left: 0;
          opacity: 0.45;
          position: absolute;
          top: 0;
        }
      `}</style>
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: "var(--atlas-home-atmosphere)",
          opacity: 0.6,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>

      <UnifiedSubheader
        activeTab={unifiedSubheaderTab}
        onTabChange={handleUnifiedSubheaderTabChange}
        hasProject={Boolean(project)}
        isMobile={isMobile}
        showWorkspaceMenu
        projectStatus={project?.status}
        onManifest={handleManifest}
        manifestLoading={manifestLoading}
        onLaunch={() => {
          // Preview-first toggle. Play ALWAYS surfaces the running app preview,
          // regardless of which tab/module is currently active. Panel maximize
          // is handled by each panel's own expand control — not here.
          // If preview is already open in the launcher, close it (return to
          // the previous view / acts as a publish-sheet placeholder toggle).
          if (launchModal.open && launchModal.mode === "preview") {
            setLaunchModal((s) => ({ ...s, open: false }));
            return;
          }
          // Also reflect intent in mobile tab so closing returns to preview tab.
          if (isMobile) setMobileTab("preview");
          setLaunchModal({ open: true, mode: "preview" });
        }}
        expanded={subheaderOpen}
        onExpandedChange={setSubheaderOpen}
      />

      <LaunchModal
        open={launchModal.open}
        mode={launchModal.mode}
        onClose={() => setLaunchModal((s) => ({ ...s, open: false }))}
        linkedRepo={linkedRepo}
        previewUrl={launchPreviewUrl}
      />

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
                  <span style={{ fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#4ade80" }}>Switching to Build Mode</span>
                </div>
                <p style={{ fontSize: "var(--ts-body)", color: "var(--atlas-fg)", margin: 0, lineHeight: 1.6, opacity: 0.85 }}>
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
                      <span style={{ fontSize: "var(--ts-label)", color: selected ? "var(--atlas-fg)" : "var(--atlas-muted)", lineHeight: 1.55, transition: "color 140ms" }}>
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
                    fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const,
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
                    color: "var(--atlas-muted)", fontSize: "var(--ts-caption)", fontFamily: "var(--app-font-mono)",
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
            animation: "atlas-spec-banner-drop 520ms cubic-bezier(0.22, 1, 0.36, 1) both",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(90deg, transparent, rgba(201,162,76,0.18), transparent)",
              transform: "translateX(-100%)",
              animation: "atlas-spec-banner-shimmer 1.4s ease-out 280ms 1 forwards",
              pointerEvents: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0, display: "inline-block", boxShadow: "0 0 8px rgba(201,162,76,0.7)" }} />
            <span style={{ fontSize: "var(--ts-label)", color: "var(--atlas-gold)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.03em" }}>
              Spec loaded from {importSourceLabel ?? "external source"} — your architecture decisions are committed.
            </span>
          </div>
          <button
            onClick={dismissAxiomBanner}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(201,162,76,0.5)", fontSize: "var(--ts-base)", lineHeight: 1, padding: "2px 4px", flexShrink: 0, position: "relative" }}
            title="Dismiss"
            aria-label="Dismiss"
          >
            ×
          </button>
          <style>{`
            @keyframes atlas-spec-banner-drop {
              from { transform: translateY(-100%); opacity: 0; }
              to   { transform: translateY(0); opacity: 1; }
            }
            @keyframes atlas-spec-banner-shimmer {
              from { transform: translateX(-100%); }
              to   { transform: translateX(100%); }
            }
          `}</style>
        </div>
      )}

      {homeHandoffDataSettled && (showHomeHandoffBanner || showHomeHandoffDrawer) && (
        <style>{`
          @keyframes atlas-handoff-drawer-in {
            from { transform: translateY(100%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
        `}</style>
      )}

      {homeHandoffDataSettled && (showHomeHandoffBanner || showHomeHandoffDrawer) && (() => {
        const handoffNodes = homeHandoffNodes;
        const getMo = (n: HomeHandoffNode) => n.moscow ?? n.meta ?? (n.type === "wont" ? "wont" : undefined);
        const isDefined = (n: HomeHandoffNode) => Boolean(n.resolved) || Boolean(n.details && n.details.trim() && !/^tap to /i.test(n.details));
        const mustCount = handoffNodes.filter(n => getMo(n) === "must").length;
        const shouldCount = handoffNodes.filter(n => getMo(n) === "should").length;
        const openDecisionCount = handoffNodes.filter(n => n.type === "decision" && !isDefined(n)).length;
        const blockerCount = handoffNodes.filter(n => n.type === "blocker").length;
        const definedCount = handoffNodes.filter(isDefined).length;
        const totalCount = Math.max(homeHandoffMeta?.flowNodeCount ?? 0, handoffNodes.length);
        const goalLabel = homeHandoffMeta?.goalLabel?.trim() || "your first node";
        const projectLabel = project?.name ?? "this project";
        const parkedCount = homeHandoffMeta?.parkedCount ?? 0;
        const isEmpty = totalCount === 0;
        return (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px 16px",
              background: "color-mix(in oklab, var(--atlas-gold) 8%, transparent)",
              borderBottom: "1px solid color-mix(in oklab, var(--atlas-gold) 20%, transparent)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--atlas-gold)", flexShrink: 0 }} />
              <span style={{ flex: 1, fontFamily: "var(--app-font-mono)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
                {isEmpty ? `${projectLabel} — nothing mapped yet` : "Here's what Atlas mapped from your conversation"}
              </span>
              <button
                type="button"
                onClick={() => setShowHomeHandoffDrawer(true)}
                style={{ background: "transparent", border: "none", color: "var(--atlas-gold)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "2px 6px" }}
              >
                View →
              </button>
              {!showHomeHandoffDrawer && (
                <button
                  onClick={() => setShowHomeHandoffBanner(false)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--atlas-gold)", fontSize: 16, lineHeight: 1, padding: "2px 4px", opacity: 0.55 }}
                  title="Dismiss"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              )}
            </div>
            <div style={{ color: "var(--atlas-fg)", fontSize: 12, lineHeight: 1.55, opacity: 0.88 }}>
              {isEmpty ? (
                <>Atlas hasn't extracted anything for <b>{projectLabel}</b> yet — open Flow and start mapping.</>
              ) : (
                <>Your goal is <b>{goalLabel}</b>. Atlas captured {definedCount} of {totalCount} nodes — {mustCount} must-haves, {shouldCount} should-haves, {openDecisionCount} open decisions, {blockerCount} blockers{parkedCount > 0 ? `, ${parkedCount} ideas parked` : ""}. Open Flow or Ledger to edit.</>
              )}
            </div>
          </div>
        );
      })()}

      {homeHandoffDataSettled && showHomeHandoffDrawer && (
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
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 4 }}>
                  Home handoff
                </div>
                <div style={{ color: "var(--atlas-fg)", fontSize: "var(--ts-h3)", fontWeight: 600 }}>
                  Picked up from your home session
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Flow Nodes
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {homeHandoffNodes.length > 0 ? homeHandoffNodes.map((node) => (
                    <div key={node.id ?? `${node.type}-${node.label}`} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minWidth: 0 }}>
                        <span style={{ color: "var(--atlas-fg)", fontSize: "var(--ts-label)", lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.label}</span>
                        <span style={{ color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0 }}>{node.type}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {(node.moscow ?? node.meta) && (
                          <span style={{ flexShrink: 0, color: "var(--atlas-gold)", border: "1px solid rgba(var(--atlas-gold-rgb),0.28)", background: "rgba(var(--atlas-gold-rgb),0.08)", borderRadius: 999, padding: "1px 6px", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            {node.moscow ?? node.meta}
                          </span>
                        )}
                        {node.details && (
                          <span style={{ minWidth: 0, color: "var(--atlas-muted)", fontSize: "var(--ts-caption)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {node.details}
                          </span>
                        )}
                      </div>
                    </div>
                  )) : (
                    <div style={{ color: "var(--atlas-muted)", fontSize: "var(--ts-label)", lineHeight: 1.5 }}>No flow node details were saved for this handoff.</div>
                  )}
                </div>
              </section>

              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Parked Ideas
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 180, overflowY: "auto" }}>
                  {homeHandoffParkedTitles.length > 0 ? homeHandoffParkedTitles.map((title) => (
                    <div key={title} style={{ color: "var(--atlas-fg)", fontSize: "var(--ts-label)", lineHeight: 1.45 }}>
                      {title}
                    </div>
                  )) : (
                    <div style={{ color: "var(--atlas-muted)", fontSize: "var(--ts-label)", lineHeight: 1.5 }}>No parked ideas were saved for this handoff.</div>
                  )}
                </div>
              </section>

              <section style={{ border: "1px solid rgba(var(--atlas-gold-rgb),0.16)", borderRadius: 12, padding: 12, background: "rgba(var(--atlas-surface-rgb),0.78)" }}>
                <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)", marginBottom: 10 }}>
                  Memory
                </div>
                <div style={{ color: "var(--atlas-fg)", fontSize: "var(--ts-label)", lineHeight: 1.5 }}>
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
                fontSize: "var(--ts-label)",
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

      {/* ── Two-pane body (owned by UnifiedConversationSurface on desktop) ── */}
      <UnifiedConversationSurface
        mode="operational"
        projectId={id}
        flowPanel={!isMobile ? (
          <RightPanel
            projectId={id}
            projectName={project?.name ?? "Project"}
            entries={entries || []}
            onFileContext={setFileContext}
            onLinkedRepoChange={setLinkedRepo}
            dbUrl={dbUrl}
            onDbUrlChange={setDbUrl}
            pushHistory={pushHistory}
            onRollbackPush={handleRollbackPush}
            onHomeNav={() => setLocation("/home")}
            forceTab={isMobile && mobileTab === "map" ? "map" : isMobile && mobileTab === "files" ? "files" : isMobile && mobileTab === "blueprints" ? "blueprints" : isMobile && mobileTab === "memory" ? "memory" : isMobile && mobileTab === "connections" ? "connections" : desktopForceTab}
            onSendIntent={sendFromIntentCapture}
            onFillIntent={(text) => { setInput(text); setTimeout(() => autoResize(), 0); }}
            onMapReadinessChange={setMapReadiness}
            displayedReadinessScore={displayedReadinessScore}
            onSystemNodeMessage={pushSystemNodeMessage}
            onHandover={handleHandover}
            handoverPending={handoverPending}
            lastHandoverHash={project?.lastHandoverHash ?? null}
            isMobile={false}
            fullscreen={desktopRightFull}
            onToggleFullscreen={() => setDesktopRightFull((v) => !v)}
            resolvedNodeIds={pendingResolvedNodeIds}
            onResolvedConsumed={() => setPendingResolvedNodeIds([])}
            currentSnapshot={currentSnapshot}
            onSnapshotChange={setCurrentSnapshot}
            handoverOpen={handoverOpen}
            onHandoverOpenChange={setHandoverOpen}
            sandboxCode={sandboxCode}
            onSandboxConsumed={() => setSandboxCode(null)}
            previewRefreshTrigger={previewRefreshTrigger}
            sessionId={sessionId ?? undefined}
            manifestDecision={manifestDecision}
            manifestPreviewHtml={manifestPreviewHtml}
            pendingTerminalCommand={pendingTerminalCommand}
            onTerminalCommandConsumed={() => setPendingTerminalCommand(null)}
            onCommandComplete={handleTerminalComplete}
            wsLens={wsLens}
            onBackToChat={() => {
              setLeftTab("chat");
              setDesktopRightFull(false);
              setDesktopForceTab("ledger");
              setTimeout(() => setDesktopForceTab(undefined), 80);
            }}
            onOpenForge={() => setShowForgeExternal(true)}
            externalForgeNodes={externalForgeNodes}
            onForgeNodesConsumed={() => setExternalForgeNodes([])}
            onForgeCompleted={() => void updateForgeState("forged")}
            onContinueSession={(sid) => { setSessionId(Number(sid)); setMobileTab("chat"); setRightOpen(false); }}
            onOpenAccountSettings={() => setShowProfile(true)}
            onZipTrigger={() => {
              const input = document.getElementById("ws-file-input") as HTMLInputElement | null;
              input?.click();
            }}
            zipLoaded={zipFiles.length > 0}
            zipFileName={zipName}
            showModelPicker={showModelPicker}
            onShowModelPickerChange={(val: boolean) => {
              setShowModelPicker(val);
              try { localStorage.setItem("atlas-power-model-picker", val ? "1" : "0"); } catch {}
            }}
            messages={messages}
          />
        ) : undefined}
        showFlow={!isMobile}
        hostShell={({ stream, panels }) => (
          <div ref={containerRef} style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", ...(isMobile ? null : { margin: "8px", borderRadius: 14, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface-alt)", boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }) }}>
            {stream}
            {!isMobile && (
              <>
                {!desktopRightFull && (
                  <div
                    onMouseDown={(e) => { e.preventDefault(); startResize(e.clientX); }}
                    onTouchStart={(e) => { startResize(e.touches[0].clientX); }}
                    onDoubleClick={() => setChatWidthPct(defaultChatPct())}
                    title="Drag to resize · Double-tap to reset"
                    style={{
                      width: 12, flexShrink: 0, cursor: "col-resize",
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
                      transition: "background 200ms",
                      pointerEvents: "none",
                    }} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 240, overflow: "hidden", background: "transparent", position: "relative" }}>
                  {panels.flow}
                </div>
              </>
            )}
          </div>
        )}
      >
        {/* Children below become `stream` inside hostShell. */}
        <>


        {/* ZIP drag overlay */}
        <ZipDragOverlay visible={isDragOver} />

        {/* Left: Chat */}
        <div
          style={{
            width: isMobile ? "100%" : (desktopRightFull ? 0 : `${chatWidthPct}%`),
            minWidth: isMobile ? 0 : (desktopRightFull ? 0 : 420),
            flexShrink: 0,
            display: desktopRightFull && !isMobile ? "none" : "flex",
            flexDirection: "column",
            background: "transparent",
            overflow: "hidden",
            position: "relative",
            // Desktop card chrome lifted onto the outer
            // UnifiedConversationSurface wrapper so left + right read as
            // one unified surface (no inner seam). Mobile keeps its
            // existing edge-to-edge presentation.
            margin: 0,
            borderRadius: 0,
            border: "none",
            boxShadow: "none",
          }}
        >
          {leftTab === "review" ? (
            <ReviewTabPanel
              messages={reviewMessages}
              projectId={id}
              linkedRepo={linkedRepo}
              githubPushToken={githubPushToken}
              planStates={planStates}
              planExecutions={planExecutions}
              onPlanStateChange={updatePlanState}
              onPlanExecutionChange={updatePlanExecution}
              onExecuteHomePlan={executeHomePlan}
              onStreamActivityUpdate={(msg, content) => {
                const markers = [
                  msg.autoFetchedFiles && msg.autoFetchedFiles.length > 0 ? "FILE_READ" : "",
                  msg.fileEdits && msg.fileEdits.length > 0 ? "FILE_EDIT" : "",
                  msg.linePatches && msg.linePatches.length > 0 ? "LINE_PATCH" : "",
                ].filter(Boolean).join("\n");
                const activityContent = [content, markers].filter(Boolean).join("\n");
                if (/FILE_EDIT/i.test(activityContent)) setSubheaderOpen(true);
                setActivityStream({ active: true, content: activityContent });
              }}
              onStreamActivityComplete={() => setActivityStream({ active: false, content: "" })}
              onPushSuccess={handleReviewPushSuccess}
              onPrCreated={(url) => { setSessionPrUrl(url); setLeftTab("diff"); }}
            />
          ) : leftTab === "diff" ? (
            <div style={{ flex: 1, height: "100%", overflowY: "auto", padding: "16px 14px" }} className="scrollbar-none">
                    {pushHistory.length === 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 8, paddingBottom: 40 }}>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--atlas-muted)" strokeWidth="1.2" strokeLinecap="round" style={{ opacity: 0.25 }}>
                          <path d="M9 1H3a1 1 0 00-1 1v18a1 1 0 001 1h18a1 1 0 001-1V9L13 1z"/><path d="M13 1v8h8"/><path d="M8 13h8M8 17h5"/>
                        </svg>
                        <div style={{ fontSize: "var(--ts-label)", color: "var(--atlas-muted)", opacity: 0.4, textAlign: "center", lineHeight: 1.65 }}>
                          No code changes this session yet.<br />
                          <span style={{ fontSize: "var(--ts-sm)" }}>Push files from a Build response to see diffs here.</span>
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
            <TerminalPanel pendingCommand={pendingTerminalCommand} onCommandConsumed={() => setPendingTerminalCommand(null)} onCommandComplete={handleTerminalComplete} scenarioLens={wsLens === "scenario"} projectId={project?.id} />
          ) : leftTab === "blueprints" ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <BlueprintsTab projectId={id} />
            </div>
          ) : leftTab === "artifacts" ? (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <ArtifactsPanel projectId={id} />
            </div>
          ) : null}

          <UnifiedConversationSurface
            mode="operational"
            projectId={id}
            chatStreamProps={leftTab !== "review" && leftTab !== "diff" && leftTab !== "terminal" && leftTab !== "blueprints" && leftTab !== "artifacts" ? {
              scrollRef: chatPanelScrollRef,
              bottomRef: bottomRef,
              onScroll: (e) => {
                const el = e.currentTarget;
                setShowWsScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
              },
              showScrollBtn: showWsScrollBtn,
              onScrollToLatest: () => {
                const el = chatPanelScrollRef.current;
                if (!el) return;
                // Use scrollTop directly — more reliable on Android Chrome
                // than scrollTo with smooth behavior
                const target = el.scrollHeight - el.clientHeight;
                el.scrollTop = target;
                // Belt and suspenders — also try after a frame
                requestAnimationFrame(() => {
                  if (el) el.scrollTop = el.scrollHeight - el.clientHeight;
                });
              },
              messages,
              chatPending,
              activityStream,
              liveGeneration,
              liveStep,
              thinkingBlock: thinkingState && (
                <AtlasThinkingBlock thinkingState={thinkingState} />
              ),
              historyMsgCountRef,
              priorLoaded: priorLoaded.current,
              isHomeHandoff,
              homeHandoffMeta,
              isBrandNewProject,
              atlasGreeting,
              greetingLoading,
              project,
              onStarterPrompt: (label) => {
                setInput(label);
                setTimeout(() => textareaRef.current?.focus(), 0);
              },
              wsModel,
              wsLens,
              onSwitchToGemini: () => { setWsModel("gemini"); },
              onEditUserMessage: (content) => {
                setInput(content);
                setTimeout(() => textareaRef.current?.focus(), 50);
              },
              projectId: id,
              sessionId,
              linkedRepo,
              trustMode,
              onPark: handlePark,
              onCommit: handleCommit,
              onRegenerate: (i) => handleRegenerate(i),
              onSend: (msg) => sendFromIntentCapture(msg),
              onPreviewCode: handlePreviewCode,
              onRunCommand: handleRunCommand,
              onPrCreated: (url) => { setSessionPrUrl(url); setLeftTab("diff"); },
              onExtractToForge: (content) => { setForgePreloadContent(extractStrategicIntent(content)); setShowForgeExternal(true); },
              onForgeIntake: handleForgeIntake,
              onReviewDiff: () => setLeftTab("diff"),
              onOpenArtifact: (_title: string) => {
                setLeftTab("artifacts");
                if (isMobile) setMobileTab("artifacts");
              },
              onEditDeclined: () => {
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
              },
              onAlertDismiss: (msg) => {
                setMessages((prev) => prev.map((m) =>
                  m.id === msg.id ? { ...m, alertResolved: true } : m
                ));
              },
              onStreamActivityUpdate: (msg, content) => {
                const markers = [
                  msg.autoFetchedFiles && msg.autoFetchedFiles.length > 0 ? "FILE_READ" : "",
                  msg.fileEdits && msg.fileEdits.length > 0 ? "FILE_EDIT" : "",
                  msg.linePatches && msg.linePatches.length > 0 ? "LINE_PATCH" : "",
                ].filter(Boolean).join("\n");
                const activityContent = [content, markers].filter(Boolean).join("\n");
                if (/FILE_EDIT/i.test(activityContent)) setSubheaderOpen(true);
                setActivityStream({ active: true, content: activityContent });
              },
              onStreamActivityComplete: () => setActivityStream({ active: false, content: "" }),
              onCommitCardDone: () => {
                queryClient.invalidateQueries({ queryKey: getListEntriesQueryKey(id, {}) });
                void refreshParkedEntries();
              },
              planStates: chatPlanStates,
              planExecutions,
              onPlanStateChange: updatePlanState,
              onPlanExecutionChange: updatePlanExecution,
              onExecuteHomePlan: executeHomePlan,
              onPushSuccess: handleReviewPushSuccess,
              commitCarryover,
            } : null}
            betweenSlot={
              agenticMode && agenticIterCount > 0 ? (
                <div className="atlas-ledger-bar" style={{ opacity: 0.55 }}>
                  <span style={{ fontFamily: 'var(--app-font-mono)', fontSize: "var(--ts-xs)", letterSpacing: '0.1em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4, color: 'rgba(201,162,76,0.85)' }}>
                    <svg width='8' height='8' viewBox='0 0 24 24' fill='currentColor' style={{ opacity: 0.9, flexShrink: 0 }}>
                      <path d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' />
                    </svg>
                    Agent · Loop {agenticIterCount} / 8
                  </span>
                </div>
              ) : null
            }
            composerProps={{
              leftTab,
              fileInputRef,
              processZip,
              attachedFiles,
              setAttachedFiles,
              zipFiles,
              zipName,
              zipTruncated,
              toggleZipFile,
              setAllZip,
              clearZip,
              uploadCodeContextZip,
              codeContextStatus,
              codeContextUploading,
              clearCodeContext,
              firstRunDismissed,
              setFirstRunDismissed,
              sessionsLoading,
              projectLoading,
              sessions,
              messages,
              entries,
              linkedRepo,
              firstRunInput,
              setFirstRunInput,
              sessionId,
              doSend: doSendFromComposer,
              projectId: id,
              isMobile,
              setMobileTab,
              setDesktopForceTab,
              hasInput,
              hasAttachments: attachedFiles.length > 0,
              inputFocused,
              setInputFocused,
              wsLens,
              textareaRef,
              input,
              setInput,
              autoResize,
              handleKeyDown,
              voiceSupported,
              voiceListening,
              toggleVoice,
              chatPending,
              handleSend,
              createSessionPending: createSession.isPending,
              onAbort: () => {
                try { abortControllerRef.current?.abort(); } catch { /* noop */ }
              },
              sendPreparingSession,

              parkedCount,
              showParkingDrawer,
              setShowParkingDrawer,
              refreshParkedEntries,
              onPark: handlePark,
              onForgeIntake: handleForgeIntake,
              showModelPicker,
              wsModel,
              onOpenModelSheet: () => setShowWsModelSheet(true),
              onOpenSessionsHistory: () => setSessionsSheetOpen(true),
              onSketch: (prompt) => {
                if (!sessionId) { toast("Open or start a session first"); return; }
                doSendFromComposer(prompt, sessionId, messagesRef.current ?? messages);
              },
              onComposerMenuAction: (action) => {

                if (action === "settings") { setShowProjectSettings(true); return; }
                if (action === "forge-intake") { setForgeIntakeSheetOpen(true); return; }
                if (action === "history") { setShowHistorySheet(true); return; }
                if (action === "mcp") {
                  if (isMobile) { setMobileTab("mcp"); setRightOpen(true); }
                  else { setDesktopForceTab("mcp" as never); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  return;
                }
                if (action === "files") {
                  if (isMobile) { setMobileTab("files"); setRightOpen(true); }
                  else { setDesktopForceTab("files" as never); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  return;
                }
                if (action === "connectors") { window.location.href = `/connectors?projectId=${id}`; return; }
                if (action === "code") { window.location.href = `/code?projectId=${id}`; return; }
                if (action === "share") { setShowProjectSettings(true); return; }
                if (action === "publish") { window.open("https://lovable.dev/publish", "_blank"); return; }
                if (action === "more:forge") { setShowForgeExternal(true); return; }
                if (action === "more:rescan") { if (!isScanning) void runScan(false); return; }
                if (action === "more:memory") {
                  if (isMobile) { setMobileTab("memory"); setRightOpen(true); }
                  else { setDesktopForceTab("memory" as never); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  return;
                }
                if (action === "more:blueprints") {
                  if (isMobile) { setMobileTab("blueprints"); setRightOpen(true); }
                  else { setDesktopForceTab("blueprints" as never); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  return;
                }
                if (action === "more:artifacts") {
                  if (isMobile) { setMobileTab("artifacts"); setRightOpen(true); }
                  else { setDesktopForceTab("artifacts" as never); setTimeout(() => setDesktopForceTab(undefined), 120); }
                  return;
                }
                if (action === "more:console") { setLeftTab("terminal"); return; }
                if (action === "more:changes") { setLeftTab("diff"); return; }
                if (action === "more:deep-dive") {
                  const recent = (messages ?? []).slice(-6).map((m: any) => {
                    const role = m.role === "user" ? "ME" : "ATLAS";
                    const text = typeof m.content === "string" ? m.content : "";
                    return text ? `[${role}] ${text}` : "";
                  }).filter(Boolean).join("\n\n");
                  const projectLine = project?.name ? `Project: ${project.name}\n\n` : "";
                  const draftLine = input.trim() ? `Current draft:\n${input.trim()}\n\n` : "";
                  const recentLine = recent ? `Recent thread:\n${recent}\n\n` : "";
                  const prompt = `I'm thinking through something in Axiom (a strategic thinking partner). Help me deep-dive this — challenge assumptions, surface what I'm missing, and end with a concrete recommendation I can bring back.\n\n${projectLine}${draftLine}${recentLine}`;
                  setDeepDiveContext(prompt);
                  setShowDeepDive(true);
                  return;
                }
              },
            }}

          />

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
                  <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>
                    Parking Lot
                  </span>
                  <span style={{ marginLeft: "auto", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", opacity: 0.65 }}>
                    {parkedCount} items
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowParkingDrawer(false)}
                    style={{ background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontSize: "var(--ts-base)", lineHeight: 1, padding: "0 3px", opacity: 0.65 }}
                    aria-label="Close parking lot"
                  >
                    ×
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px" }} className="scrollbar-none">
                  {parkedEntries.length === 0 ? (
                    <div style={{ padding: "30px 10px", textAlign: "center", color: "var(--atlas-muted)", fontSize: "var(--ts-label)", opacity: 0.6 }}>
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

        {/* Desktop resize handle + right panel now live in the outer
            UnifiedConversationSurface hostShell above (RightPanel is the
            `flowPanel` slot). Mobile overlay stays here. */}



        {/* Soft "Atlas Build ready" chip — non-intrusive surface for a completed run.
            Tapping switches to the preview tab; dismiss keeps the user where they are. */}
        {previewReady && (
          <div
            style={{
              position: "fixed",
              left: "50%",
              transform: "translateX(-50%)",
              bottom: isMobile ? (mobileTab === "map" ? 16 : 76) : 24,
              zIndex: 60,
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px 8px 14px",
              borderRadius: 999,
              background: "rgba(13, 11, 9, 0.92)",
              border: "1px solid rgba(var(--atlas-gold-rgb), 0.45)",
              boxShadow: "0 10px 32px -12px rgba(0,0,0,0.6), 0 0 0 1px rgba(var(--atlas-gold-rgb), 0.15)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              fontFamily: "var(--app-font-mono)",
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--atlas-gold)",
              animation: "atlas-slide-in-right 240ms ease",
            }}
            role="status"
            aria-live="polite"
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--atlas-gold)",
                boxShadow: "0 0 10px var(--atlas-gold)",
              }}
            />
            <button
              type="button"
              onClick={() => { setPreviewReady(false); openPreviewPanel(); }}
              style={{
                background: "transparent",
                border: "none",
                color: "inherit",
                font: "inherit",
                letterSpacing: "inherit",
                textTransform: "inherit",
                cursor: "pointer",
                padding: 0,
              }}
            >
              Atlas Build ready →
            </button>
            <button
              type="button"
              onClick={() => setPreviewReady(false)}
              aria-label="Dismiss"
              style={{
                background: "transparent",
                border: "none",
                color: "rgba(var(--atlas-muted-rgb), 0.7)",
                cursor: "pointer",
                padding: "0 2px",
                marginLeft: 2,
                fontSize: 14,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
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
                projectName={project?.name ?? "Project"}
                entries={entries || []}
                onClose={() => { setRightOpen(false); setRightFullscreen(false); }}
                fullscreen={rightFullscreen}
                onToggleFullscreen={() => setRightFullscreen((f) => !f)}
                onFileContext={setFileContext}
                onLinkedRepoChange={setLinkedRepo}
                dbUrl={dbUrl}
                onDbUrlChange={setDbUrl}
                pushHistory={pushHistory}
                onRollbackPush={handleRollbackPush}
                onHomeNav={() => setLocation("/home")}
                forceTab={
                  mobileTab === "ledger" ? "ledger" :
                  mobileTab === "map" ? "map" :
                  mobileTab === "files" ? "files" :
                  mobileTab === "preview" ? "preview" :
                  mobileTab === "blueprints" ? "blueprints" :
                  mobileTab === "memory" ? "memory" :
                  mobileTab === "connections" ? "connections" :
                  mobileTab === "mcp" ? "mcp" :
                  undefined
                }
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
                sessionId={sessionId ?? undefined}
                manifestDecision={manifestDecision}
                manifestPreviewHtml={manifestPreviewHtml}
                pendingTerminalCommand={pendingTerminalCommand}
                onTerminalCommandConsumed={() => setPendingTerminalCommand(null)}
                onCommandComplete={handleTerminalComplete}
                wsLens={wsLens}
                onOpenForge={() => setShowForgeExternal(true)}
                externalForgeNodes={externalForgeNodes}
                onForgeNodesConsumed={() => setExternalForgeNodes([])}
                onForgeCompleted={() => void updateForgeState("forged")}
                onContinueSession={(sid) => { setSessionId(Number(sid)); setMobileTab("chat"); setRightOpen(false); }}
                onNavLedger={() => setMobileTab("ledger")}
                onNavPreview={() => setMobileTab("preview")}
                onOpenConnections={() => setMobileTab("connections")}
                onOpenAccountSettings={() => setShowProfile(true)}
                onZipTrigger={() => {
                  const input = document.getElementById("ws-file-input") as HTMLInputElement | null;
                  input?.click();
                }}
                zipLoaded={zipFiles.length > 0}
                zipFileName={zipName}
                showModelPicker={showModelPicker}
                onShowModelPickerChange={(val: boolean) => {
                  setShowModelPicker(val);
                  try { localStorage.setItem("atlas-power-model-picker", val ? "1" : "0"); } catch {}
                }}
                messages={messages}
              />
            </div>
          </div>
        )}
        </>
      </UnifiedConversationSurface>


      {isMobile && mobileTab !== "map" && (
        <UnifiedContextDock
          mode="operational"
          activeOperationalTab={(["chat","ledger","preview","map","files"].includes(mobileTab) ? mobileTab : undefined) as "chat" | "ledger" | "preview" | "map" | "files" | undefined}
          onAtlasCore={() => { setMobileTab("chat"); setLeftTab("chat"); setRightOpen(false); }}
          onChat={() => { setMobileTab("chat"); setLeftTab("chat"); }}

          onLedger={() => {
            setMobileTab("ledger");
            setRightOpen(true);
          }}
          onPreview={() => setMobileTab("preview")}
          onFlow={() => setLocation("/map")}
          entryCount={entryCount}
        />
      )}

      {isMobile && showMoreSheet && (
        <>
          <div
            onClick={() => setShowMoreSheet(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 290,
              background: "rgba(0,0,0,0.55)",
              backdropFilter: "blur(4px)",
            }}
          />
          <div
            role="dialog"
            aria-label="More tools"
            style={{
              position: "fixed",
              bottom: "calc(var(--atlas-dock-height, 64px) + env(safe-area-inset-bottom, 0px))",
              left: 0, right: 0,
              zIndex: 300,
              background: "var(--atlas-surface)",
              borderTop: "1px solid rgba(201,162,76,0.18)",
              borderRadius: "14px 14px 0 0",
              padding: "12px 0 10px",
              boxShadow: "0 -10px 30px rgba(0,0,0,0.45)",
            }}
          >
            <div style={{
              width: 36, height: 3, borderRadius: 2,
              background: "rgba(201,162,76,0.25)",
              margin: "0 auto 10px",
            }} />
            {([
              {
                id: "files" as const,
                label: "Files",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>
                  </svg>
                ),
                onSelect: () => { setMobileTab("files"); setShowMoreSheet(false); },
              },
              {
                id: "memory" as const,
                label: "Memory",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z"/>
                    <path d="M8 9h8M8 13h8M8 17h5"/>
                  </svg>
                ),
                onSelect: () => { setMobileTab("memory"); setShowMoreSheet(false); },
              },
              {
                id: "blueprints" as const,
                label: "Blueprints",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M3 9h18M9 21V9"/>
                  </svg>
                ),
                onSelect: () => { setMobileTab("blueprints"); setShowMoreSheet(false); },
              },
              {
                id: "connections" as const,
                label: "Connections",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="12" r="2"/>
                    <circle cx="18" cy="6" r="2"/>
                    <circle cx="18" cy="18" r="2"/>
                    <path d="M8 11l8-4M8 13l8 4"/>
                  </svg>
                ),
                onSelect: () => { setMobileTab("connections"); setShowMoreSheet(false); },
              },
              {
                id: "mcp" as const,
                label: "MCP",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="5" cy="12" r="2.5"/>
                    <circle cx="19" cy="6" r="2.5"/>
                    <circle cx="19" cy="18" r="2.5"/>
                    <path d="M7.5 11l9-4M7.5 13l9 4"/>
                  </svg>
                ),
                onSelect: () => { setMobileTab("mcp"); setShowMoreSheet(false); },
              },
              ...(hasLinkedRepo ? [{
                id: "rescan" as const,
                label: isScanning ? "Rescanning…" : "Rescan repo",
                icon: (
                  <RefreshCw size={18} style={{ animation: isScanning ? "atlas-rescan-spin 1.4s linear infinite" : undefined }} />
                ),
                onSelect: () => {
                  if (isScanning) return;
                  toast.info("Rescanning repository", {
                    description: "Pulling the latest from GitHub and refreshing project memory.",
                    className: "atlas-toast-pill",
                  });
                  void runScan(false);
                  setShowMoreSheet(false);
                },
              }] : []),
              ...(hasLinkedRepo ? [{
                id: "fullimport" as const,
                label: "Deep Import",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                ),
                onSelect: () => {
                  setMobileTab("files");
                  setShowMoreSheet(false);
                  toast.info("Opening Files tab — tap Import to begin.", { className: "atlas-toast-pill" });
                },
              }] : []),
            ]).map(({ id, label, icon, onSelect }) => {
              const active = mobileTab === id;
              return (
                <button
                  key={id}
                  onClick={onSelect}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "13px 22px",
                    background: active ? "rgba(201,162,76,0.07)" : "transparent",
                    border: "none",
                    borderLeft: `3px solid ${active ? "var(--atlas-gold)" : "transparent"}`,
                    cursor: "pointer",
                    color: active ? "var(--atlas-gold)" : "var(--atlas-fg)",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 12,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    textAlign: "left",
                    WebkitTapHighlightColor: "transparent",
                    transition: "all 160ms ease",
                  }}
                >
                  {icon}
                  {label}
                  {active && (
                    <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--atlas-gold)", opacity: 0.7 }}>
                      ACTIVE
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
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
            <a key={label} href={href} style={{ fontSize: "var(--ts-micro)", fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", opacity: 0.25, letterSpacing: "0.08em", textDecoration: "none", pointerEvents: "auto" }}
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

      {/* Forge intake — bottom sheet opened by Atlas Pulse long-press or "+" menu */}
      <ForgeIntakeSheet
        open={forgeIntakeSheetOpen}
        onClose={() => setForgeIntakeSheetOpen(false)}
        onIntake={handleForgeIntake}
        onOpenProjectDna={() => setShowProjectSettings(true)}
        projectName={project?.name ?? null}
      />

      <HistoryBookmarksSheet
        projectId={Number.isFinite(id) ? id : null}
        open={showHistorySheet}
        onClose={() => setShowHistorySheet(false)}
      />

      <DeepDiveSheet
        open={showDeepDive}
        onClose={() => setShowDeepDive(false)}
        initialContext={deepDiveContext}
        onPasteBack={(text) => {
          setInput((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
        }}
      />

      <SessionHistorySheet
        open={sessionsSheetOpen}
        onClose={() => setSessionsSheetOpen(false)}
        title={`${(project?.name ?? "PROJECT").toString().toUpperCase()} · SESSIONS`}
        loading={allSessionsForSheetLoading}
        emptyHint="No sessions yet. Tap NEW to start one."
        items={(allSessionsForSheet ?? []).map((s: Session) => ({
          id: s.id,
          title: s.title || "Untitled session",
          msgCount: (s as any).messageCount ?? (s as any).chat_messages?.length ?? 0,
          timestamp: (s as any).updatedAt ?? (s as any).createdAt ?? null,
          active: s.id === sessionId,
        }))}
        onNew={() => { setSessionsSheetOpen(false); void handleNewSession(); }}
        onSelect={(sid) => handleSwitchSession(sid)}
        onDelete={(sid) => handleDeleteSessionFromSheet(sid)}
      />




      {showForgeExternal && (
        <TheForge
          projectId={forgeActiveProjectId ?? id}
          activeProjectName={forgeActiveProjectName ?? project?.name}
          preloadContent={forgePreloadContent}
          scopeNodeId={forgeScopeNodeId}
          scopeNodeLabel={forgeScopeNodeLabel}
          onClearScope={() => { setForgeScopeNodeId(null); setForgeScopeNodeLabel(null); }}
          onClose={() => { setShowForgeExternal(false); setForgePreloadContent(undefined); setForgeScopeNodeId(null); setForgeScopeNodeLabel(null); }}
          onNodesReady={(nodes) => {
            applyForgeNodes(nodes);
            setShowForgeExternal(false);
            setForgePreloadContent(undefined);
          }}
        />
      )}

      {/* ── Project dropdown menu — restored from pre-shell-refactor version.
            Opened by the project chevron in UnifiedShell (via the
            axiom:open-projects-drawer event). Anchored top-center beneath
            the shell header since the trigger lives in the shell. ── */}
      {showProjectMenu && createPortal(
        <>
          <div onClick={() => setShowProjectMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9998 }} />
           <div
             ref={projectMenuRef}
             className="atlas-popover"
             style={{
               position: "fixed",
               top: 56,
               left: "50%",
               transform: "translateX(-50%)",
               zIndex: 9999,
               minWidth: 240,
               maxWidth: "calc(100vw - 24px)",
               maxHeight: "calc(100vh - 80px)",
               overflowY: "auto",
               WebkitOverflowScrolling: "touch",
               overscrollBehavior: "contain",
             }}
           >
            {isMobile && window.innerWidth < 420 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "8px 6px 6px",
                  padding: "8px 12px",
                  borderRadius: 8,
                  background: "rgba(28,25,23,0.55)",
                  border: "1px solid rgba(201,162,76,0.18)",
                }}
                title="Current branch"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ opacity: 0.75, color: "var(--atlas-gold)", flexShrink: 0 }}>
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-muted)" }}>Branch</span>
                <span style={{ fontFamily: "var(--app-font-mono)", fontSize: 12, color: "var(--atlas-fg)", marginLeft: "auto" }}>main</span>
              </div>
            )}
            {(allProjects ?? []).filter((p: any) => p.id !== id && p.status !== "archived").length > 0 && (() => {

              const others = (allProjects ?? []).filter((p: any) => p.id !== id && p.status !== "archived");
              return (
                <>
                  <button
                    onClick={() => setSwitchToExpanded(x => !x)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      width: "calc(100% - 12px)", margin: "6px",
                      background: "color-mix(in oklab, var(--atlas-gold) 10%, transparent)",
                      border: "1px solid color-mix(in oklab, var(--atlas-gold) 28%, transparent)",
                      padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--atlas-gold)" }}>
                        <path d="M3 6h10M3 6l3-3M3 6l3 3M13 10H3M13 10l-3-3M13 10l-3 3" />
                      </svg>
                      <span style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "var(--atlas-gold)", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>
                        Switch project
                      </span>
                    </span>
                    <svg width="11" height="11" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--atlas-gold)", transform: switchToExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms ease" }}>
                      <path d="M1 1l4 4 4-4" />
                    </svg>
                  </button>
                  {switchToExpanded && (
                    <div style={{ padding: "0 6px 6px", display: "flex", flexDirection: "column", gap: 2 }}>
                      {others.map((p: any) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <button
                            onClick={() => { setLocation(`/project/${p.id}`); setShowProjectMenu(false); }}
                            style={{ flex: 1, textAlign: "left", padding: "8px 10px", borderRadius: 6, background: "transparent", border: "1px solid transparent", color: "var(--atlas-fg)", fontSize: 12.5, cursor: "pointer", fontFamily: "var(--app-font-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--atlas-glass-bg)"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                          >
                            {p.name}
                          </button>
                          {switchProjectDeleteId === p.id ? (
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={() => setSwitchProjectDeleteId(null)} style={{ padding: "4px 8px", borderRadius: 4, fontSize: 10, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
                              <button onClick={() => handleDeleteProjectFromSwitcher(p.id)} style={{ padding: "4px 8px", borderRadius: 4, fontSize: 10, background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.4)", color: "rgba(252,165,165,0.95)", cursor: "pointer", fontWeight: 600 }}>Delete</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setSwitchProjectDeleteId(p.id)}
                              title="Delete project"
                              style={{ width: 24, height: 24, borderRadius: 4, background: "transparent", border: "1px solid transparent", color: "var(--atlas-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.borderColor = "rgba(239,68,68,0.3)"; e.currentTarget.style.color = "rgba(252,165,165,0.95)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "var(--atlas-muted)"; }}
                            >×</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
                </>
              );
            })()}
            <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 2l3 3-8 8H3v-3l8-8z" /></svg>} label="Rename project" onClick={() => { setShowProjectMenu(false); window.dispatchEvent(new CustomEvent("axiom:rename-project")); }} />
            <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="2" /><path d="M13.7 9.4a1 1 0 010-2.8l.5-.2a1 1 0 00.6-1.5l-.7-1.2a1 1 0 00-1.5-.3l-.4.3a1 1 0 01-1.4-.6l-.1-.5a1 1 0 00-1-.8H8.3a1 1 0 00-1 .8l-.1.5a1 1 0 01-1.4.6l-.4-.3a1 1 0 00-1.5.3l-.7 1.2a1 1 0 00.6 1.5l.5.2a1 1 0 010 2.8l-.5.2a1 1 0 00-.6 1.5l.7 1.2a1 1 0 001.5.3l.4-.3a1 1 0 011.4.6l.1.5a1 1 0 001 .8h1.4a1 1 0 001-.8l.1-.5a1 1 0 011.4-.6l.4.3a1 1 0 001.5-.3l.7-1.2a1 1 0 00-.6-1.5l-.5-.2z" /></svg>} label="Project settings" onClick={() => { setShowProjectMenu(false); setShowProjectSettings(true); }} />
            <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5" /><path d="M5 6h6M5 9h4" /></svg>} label="Parking Lot" onClick={() => { setLocation(`/parking?project=${id}`); setShowProjectMenu(false); }} />
            <MenuBtn
              icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="9" height="9" rx="1.5" /><path d="M11 4V3a1 1 0 00-1-1H4a1 1 0 00-1 1v6a1 1 0 001 1h1" /></svg>}
              label={cloningProject ? "Cloning…" : "Clone project"}
              onClick={async () => {
                if (cloningProject) return;
                setShowProjectMenu(false);
                setCloningProject(true);
                try {
                  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                  const res = await fetch(`${base}/api/projects/${id}/clone`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                  });
                  if (res.ok) {
                    const clone = await res.json();
                    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                    setLocation(`/project/${clone.id}`);
                  }
                } finally { setCloningProject(false); }
              }}
            />
            <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
            <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"><path d="M2 4h12M2 8h8M2 12h6" /></svg>} label="View ledger" onClick={() => { setLocation(`/ledger/${id}`); setShowProjectMenu(false); }} />
            <MenuBtn icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="3" width="14" height="10" rx="1.5" /><path d="M1 6h14" /><circle cx="3.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} /><circle cx="5.5" cy="4.5" r="0.7" fill="currentColor" opacity={0.5} /></svg>} label="Dashboard" onClick={() => { setLocation("/dashboard"); setShowProjectMenu(false); }} />
            <div style={{ height: 1, background: "var(--atlas-border)", margin: "4px 6px", opacity: 0.5 }} />
            <div style={{ padding: "6px 12px 2px", fontSize: 9.5, fontFamily: "var(--app-font-mono)", color: "var(--atlas-muted)", letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.7 }}>Conversation</div>
            {threadSearchDraft === null ? (
              <MenuBtn
                icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>}
                label="Search in thread"
                disabled={messages.length === 0}
                onClick={() => { threadSearchCursorRef.current = { q: "", matches: [], idx: -1 }; setThreadSearchStatus(""); setThreadSearchDraft(""); }}
              />
            ) : (
              <div style={{ padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", justifyContent: "space-between" }}>
                  <span>Search thread</span>
                  {threadSearchStatus && <span style={{ opacity: 0.7 }}>{threadSearchStatus}</span>}
                </div>
                <input
                  autoFocus
                  type="text"
                  value={threadSearchDraft}
                  onChange={(e) => { setThreadSearchDraft(e.target.value); threadSearchCursorRef.current = { q: "", matches: [], idx: -1 }; setThreadSearchStatus(""); }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); runThreadSearch(threadSearchDraft, e.shiftKey ? -1 : 1); }
                    else if (e.key === "Escape") { setThreadSearchDraft(null); setThreadSearchStatus(""); }
                  }}
                  placeholder="Find in conversation…"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface-alt)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-sans)", outline: "none", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setThreadSearchDraft(null); setThreadSearchStatus(""); }} style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Close</button>
                  <button onClick={() => runThreadSearch(threadSearchDraft, -1)} disabled={!threadSearchDraft.trim()} style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-fg)", cursor: threadSearchDraft.trim() ? "pointer" : "not-allowed", opacity: threadSearchDraft.trim() ? 1 : 0.5 }}>Prev</button>
                  <button onClick={() => runThreadSearch(threadSearchDraft, 1)} disabled={!threadSearchDraft.trim()} style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, background: "color-mix(in oklab, var(--atlas-gold) 18%, transparent)", border: "1px solid color-mix(in oklab, var(--atlas-gold) 40%, transparent)", color: "var(--atlas-gold)", cursor: threadSearchDraft.trim() ? "pointer" : "not-allowed", fontWeight: 600, opacity: threadSearchDraft.trim() ? 1 : 0.5 }}>Next</button>
                </div>
              </div>
            )}
            <MenuBtn
              icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 7l4 4 4-4M2 14h12" /></svg>}
              label="Download as Markdown"
              disabled={messages.length === 0}
              onClick={() => { downloadConversation("md"); setShowProjectMenu(false); }}
            />
            <MenuBtn
              icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2v9M4 7l4 4 4-4M2 14h12" /></svg>}
              label="Download as JSON"
              disabled={messages.length === 0}
              onClick={() => { downloadConversation("json"); setShowProjectMenu(false); }}
            />
            <MenuBtn
              icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v10M3 8h10" /></svg>}
              label={sessionActionBusy ? "Working…" : "New session"}
              disabled={sessionActionBusy}
              onClick={() => { void handleNewSession(); }}
            />
            {archiveReasonDraft === null ? (
              <MenuBtn
                icon={<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="12" height="3" rx="1" /><path d="M3 6v7a1 1 0 001 1h8a1 1 0 001-1V6" /><path d="M6 10h4" /></svg>}
                label="Archive & start new"
                disabled={!sessionId || messages.length === 0 || sessionActionBusy}
                onClick={() => setArchiveReasonDraft("")}
              />
            ) : (
              <div style={{ padding: "6px 8px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 10.5, color: "var(--atlas-muted)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Why archive?</div>
                <input
                  autoFocus
                  type="text"
                  value={archiveReasonDraft}
                  onChange={(e) => setArchiveReasonDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && archiveReasonDraft.trim()) { e.preventDefault(); void handleArchiveAndNew(archiveReasonDraft); }
                    else if (e.key === "Escape") { setArchiveReasonDraft(null); }
                  }}
                  placeholder="e.g. Pivoted from B2C to B2B"
                  style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--atlas-border)", background: "var(--atlas-surface-alt)", color: "var(--atlas-fg)", fontSize: 12, fontFamily: "var(--app-font-sans)", outline: "none", boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setArchiveReasonDraft(null)} style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, background: "var(--atlas-surface-alt)", border: "1px solid var(--atlas-border)", color: "var(--atlas-muted)", cursor: "pointer" }}>Cancel</button>
                  <button
                    onClick={() => { if (archiveReasonDraft && archiveReasonDraft.trim()) void handleArchiveAndNew(archiveReasonDraft); }}
                    disabled={!archiveReasonDraft.trim() || sessionActionBusy}
                    style={{ flex: 1, padding: "6px 0", borderRadius: 5, fontSize: 11, background: "color-mix(in oklab, var(--atlas-gold) 18%, transparent)", border: "1px solid color-mix(in oklab, var(--atlas-gold) 40%, transparent)", color: "var(--atlas-gold)", cursor: archiveReasonDraft.trim() ? "pointer" : "not-allowed", fontWeight: 600, opacity: archiveReasonDraft.trim() ? 1 : 0.5 }}
                  >{sessionActionBusy ? "Archiving…" : "Archive"}</button>
                </div>
              </div>
            )}
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

      {/* Projects Drawer */}
      <ProjectsDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        projects={(allProjects ?? []).map((p: any) => ({ id: p.id, name: p.name, description: p.description, latestSnapshotScore: p.latestSnapshotScore ?? null }))}
        activeProjectId={id}
        onOpenProject={(projectId) => { setLocation(`/project/${projectId}`); setShowDrawer(false); }}
        onNewProject={() => {
          setShowDrawer(false);
          setCreateProjectError(null);
          setShowNewProjectModal(true);
        }}
        onOpenLedger={(projectId) => { setLocation(`/ledger/${projectId}`); setShowDrawer(false); }}
        onOpenParking={() => { setLocation(`/parking?project=${id}`); setShowDrawer(false); }}
        onOpenQuickPrompt={() => { setShowDrawer(false); setShowForgeExternal(true); }}
        userLabel={loadProfile().name || null}
      />

      <NewProjectModal
        open={showNewProjectModal}
        onClose={() => { setShowNewProjectModal(false); setCreateProjectError(null); }}
        onCreate={(name, repo) => handleCreateProjectFromWorkspace(name, repo)}
        creating={createProjectMutation.isPending}
        error={createProjectError}
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
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Model</span>
              <button onClick={() => setShowWsModelSheet(false)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.6)", fontSize: "var(--ts-display)", lineHeight: 1, padding: 4 }}>×</button>
            </div>
            <div style={{ padding: "0 14px" }}>
              {([
                { id: "multi", label: "Multi-Agent", sub: "Default · Atlas orchestrates Claude, GPT, Gemini & Haiku", available: true, icon: "★" },
                { id: "claude", label: "Claude", sub: "Architect · Nuance & Strategy", available: true, icon: "C" },
                { id: "gpt4o", label: "GPT-4o", sub: "Mechanic · Speed & Logic", available: true, icon: "G" },
                { id: "gemini", label: "Gemini", sub: "Strategy · Long Context", available: true, icon: "Ge" },
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
                    fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", fontWeight: 700,
                    color: m.available ? "rgba(201,162,76,0.85)" : "rgba(var(--atlas-muted-rgb),0.4)",
                    letterSpacing: "0.02em",
                  }}>
                    {m.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-body)", fontWeight: 500, color: "var(--atlas-fg)", display: "flex", alignItems: "center", gap: 6 }}>
                      {m.label}
                      {!m.available && (
                        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.55, border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", borderRadius: 3, padding: "1px 4px" }}>KEY NEEDED</span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", letterSpacing: "0.05em", marginTop: 2, opacity: m.available ? 0.7 : 0.4 }}>{m.sub}</div>
                  </div>
                  {wsModel === m.id && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              ))}
              <div style={{ margin: "12px 0 4px", padding: "8px 12px", background: "rgba(201,162,76,0.04)", borderRadius: 6, border: "1px solid rgba(201,162,76,0.1)" }}>
                <p style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", letterSpacing: "0.07em", margin: 0, lineHeight: 1.6 }}>
                  TIP: Type /deep [topic] for structured research via Gemini, or /research [url] to analyze any product or competitor page.
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
              <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--atlas-gold)" }}>Lens</span>
              <button onClick={() => setShowLensPicker(false)} aria-label="Dismiss" style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(var(--atlas-muted-rgb),0.6)", fontSize: "var(--ts-display)", lineHeight: 1, padding: 4 }}>×</button>
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-body)", fontWeight: 500, color: "var(--atlas-fg)" }}>
                      <span style={{ color: cfg.color }}>{cfg.label}</span>
                      {cfg.model && (
                        <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", color: "var(--atlas-muted)", letterSpacing: "0.1em", opacity: 0.6, border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", borderRadius: 3, padding: "1px 4px" }}>
                          {cfg.model === "claude" ? "Claude" : "Gemini"}
                        </span>
                      )}
                    </div>
                    <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", letterSpacing: "0.05em", marginTop: 2, opacity: 0.7 }}>{cfg.sub}</div>
                  </div>
                  {wsLens === lensId && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="var(--atlas-gold)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {detectedLens === lensId && wsLens !== lensId && (
                    <span style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-tiny)", color: cfg.color, letterSpacing: "0.1em", border: `1px solid ${cfg.borderColor}`, borderRadius: 3, padding: "1px 5px", opacity: 0.85 }}>SUGGESTED</span>
                  )}
                </button>
              ))}
              <div style={{ margin: "10px 0 2px", padding: "8px 12px", background: "rgba(201,162,76,0.04)", borderRadius: 6, border: "1px solid rgba(201,162,76,0.1)" }}>
                <p style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", color: "var(--atlas-muted)", letterSpacing: "0.07em", margin: 0, lineHeight: 1.6 }}>
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
            <div style={{ fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-xs)", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(120,113,108,0.7)", marginBottom: 8 }}>Leaving Scenario</div>
            <div style={{ fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-md)", color: "var(--atlas-fg)", lineHeight: 1.5, marginBottom: 16 }}>
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
                        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                        body: JSON.stringify({ sessionId, messages: scenarioBuffer }),
                      });
                    } catch { /* non-fatal — messages stay in client state */ }
                  }
                  setScenarioBuffer([]);
                  if (pendingLensSwitch) {
                    setWsLensRaw(pendingLensSwitch);
                    setDetectedLens(null);
                    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, pendingLensSwitch); window.dispatchEvent(new Event("atlas-lens-changed")); } catch {}
                    const cfg = LENS_CONFIG[pendingLensSwitch];
                    if (cfg.model) setWsModel(cfg.model);
                    scenarioStartIdxRef.current = -1;
                    setPendingLensSwitch(null);
                  }
                  setShowScenarioPrompt(false);
                  setShowLensPicker(false);
                }}
                style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.25)", color: "var(--atlas-gold)", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-body)", textAlign: "left" }}
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
                    try { localStorage.setItem(`atlas-ws-lens-v2-${id}`, pendingLensSwitch); window.dispatchEvent(new Event("atlas-lens-changed")); } catch {}
                    const cfg = LENS_CONFIG[pendingLensSwitch];
                    if (cfg.model) setWsModel(cfg.model);
                    setPendingLensSwitch(null);
                  }
                  scenarioStartIdxRef.current = -1;
                  setShowScenarioPrompt(false);
                  setShowLensPicker(false);
                }}
                style={{ padding: "10px 14px", borderRadius: 8, background: "transparent", border: "1px solid rgba(var(--atlas-muted-rgb),0.2)", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-sans)", fontSize: "var(--ts-body)", textAlign: "left" }}
              >
                Discard — remove from this session
              </button>
              <button
                onClick={() => { setShowScenarioPrompt(false); setPendingLensSwitch(null); }}
                style={{ padding: "8px 14px", borderRadius: 8, background: "transparent", border: "none", color: "var(--atlas-muted)", cursor: "pointer", fontFamily: "var(--app-font-mono)", fontSize: "var(--ts-micro)", letterSpacing: "0.06em", opacity: 0.55 }}
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
    </div>
      )}
    </>
  );
}
