import { toast } from "sonner";
import { Session } from "@workspace/api-client-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { haptics } from "@/lib/haptics";
import { sounds } from "@/lib/sounds";
import { useThemeMode, type ThemeMode } from "@/lib/theme";

// ── Theme palette for the Flow canvas (parchment / obsidian) ────────────────
type FlowPalette = {
  // background + grid
  rootBg: string;
  dotGrid: string;
  // text + accents
  goldText: string;        // strong gold/cognac for headings/icons
  goldSoft: string;        // 0.55–0.7 alpha
  goldRgb: string;         // "212,175,55" or "180,83,9"
  emberRgb: string;        // for blockers
  emberText: string;
  decisionRgb: string;     // for decision nodes
  decisionText: string;
  decisionTextResolved: string;
  fgRgb: string;           // body text triple
  fgText: string;
  mutedRgb: string;
  mutedText: string;
  // panels
  panelBg: string;
  panelBorder: string;
  panelShadow: string;
  inputBg: string;
  // edges
  edgeDim: string;
  edgeGold: string;
  // toasts
  toastBg: string;
  toastBorder: string;
  toastText: string;
};

function flowPaletteFor(theme: ThemeMode): FlowPalette {
  if (theme === "parchment") {
    return {
      rootBg: "#FAFAF7",
      dotGrid: "rgba(11,11,11,0.08)",
      goldText: "#92400E",
      goldSoft: "rgba(146,64,14,0.7)",
      goldRgb: "180,83,9",
      emberRgb: "146,64,14",
      emberText: "rgba(146,64,14,0.92)",
      decisionRgb: "146,64,14",
      decisionText: "rgba(146,64,14,0.92)",
      decisionTextResolved: "rgba(146,64,14,0.75)",
      fgRgb: "26,23,20",
      fgText: "#1A1714",
      mutedRgb: "107,94,82",
      mutedText: "rgba(107,94,82,0.85)",
      panelBg: "#FFFFFF",
      panelBorder: "rgba(17,17,17,0.10)",
      panelShadow: "0 10px 32px rgba(17,17,17,0.06)",
      inputBg: "#FFFFFF",
      edgeDim: "rgba(17,17,17,0.18)",
      edgeGold: "rgba(180,83,9,0.75)",
      toastBg: "#FFFFFF",
      toastBorder: "rgba(17,17,17,0.10)",
      toastText: "#92400E",
    };
  }
  return {
    rootBg: "#0C0A09",
    dotGrid: "oklch(0.30 0.01 60 / 30%)",
    goldText: "#D4AF37",
    goldSoft: "rgba(201,162,76,0.7)",
    goldRgb: "212,175,55",
    emberRgb: "239,100,60",
    emberText: "rgba(239,120,80,0.90)",
    decisionRgb: "196,82,26",
    decisionText: "rgba(230,130,80,0.90)",
    decisionTextResolved: "rgba(196,82,26,0.75)",
    fgRgb: "231,229,226",
    fgText: "#E7E5E4",
    mutedRgb: "120,113,108",
    mutedText: "rgba(120,113,108,0.7)",
    panelBg: "rgba(20,18,14,0.97)",
    panelBorder: "rgba(212,175,55,0.45)",
    panelShadow: "0 10px 32px rgba(0,0,0,0.7)",
    inputBg: "var(--atlas-surface)",
    edgeDim: "oklch(0.35 0.01 60 / 50%)",
    edgeGold: "rgba(212,175,55,0.6)",
    toastBg: "oklch(0.15 0.01 60)",
    toastBorder: "oklch(0.76 0.12 85 / 30%)",
    toastText: "#D4AF37",
  };
}

export type FlowNodeMeta = "must" | "should" | "could" | "wont";

export interface ArchNode {
  id: string;
  label: string;
  type: "goal" | "requirement" | "blocker" | "priority" | "decision" | "sprint" | "wont";
  resolved: boolean;
  x: number;
  y: number;
  moved?: boolean;
  details?: string;
  meta?: FlowNodeMeta;
  moscow?: FlowNodeMeta;
  question?: string;
  strategicAnswer?: string;
}

export function isNodeDefined(node: ArchNode): boolean {
  return Boolean(node.strategicAnswer && node.strategicAnswer.trim().length > 0);
}

// ── Handover snapshot ─────────────────────────────────────────────────────────
// Build a structured payload that captures the current Flow state for handing
// off to a new Atlas chat session. The hash is content-addressed so the
// Workspace header can detect drift since the last handover.

// Structured snapshot of the Flow at handover time. `summary` is the
// human-readable seed message; `nodes` + `edges` preserve the full graph so
// downstream features (diff, replay, regenerate) can read it without parsing
// the sentence form back out.
export interface HandoverSnapshotNode {
  id: string;
  type: ArchNode["type"];
  label: string;
  meta?: ArchNode["meta"];
  moscow?: ArchNode["moscow"];
  details?: string;
  resolved: boolean;
  strategicAnswer?: string;
}
export interface HandoverSnapshotEdge {
  id: string;
  from: string;
  to: string;
}
export interface HandoverSnapshot {
  title: string;
  summary: string;
  hash: string;
  definedCount: number;
  totalCount: number;
  goalLabel: string;
  nodes: HandoverSnapshotNode[];
  edges: HandoverSnapshotEdge[];
}

function djb2Hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
  }
  // Force unsigned + base36 for compactness.
  return (h >>> 0).toString(36);
}

export function computeNodeStateHash(nodes: ArchNode[]): string {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const serial = sorted.map(n => [
    n.id,
    n.type,
    n.label,
    n.moscow ?? n.meta ?? "",
    (n.details ?? "").trim(),
    (n.strategicAnswer ?? "").trim(),
  ].join("\u0001")).join("\u0002");
  return djb2Hash(serial);
}

export function buildHandoverSnapshot(
  nodes: ArchNode[],
  edges: ArchEdge[],
): HandoverSnapshot {
  const goalNode = nodes.find(n => n.type === "goal") ?? nodes[0];
  const goalLabel = (goalNode?.label ?? "Untitled goal").trim();

  const defined = nodes.filter(n => isNodeDefined(n));
  const unanswered = nodes.filter(
    n => !isNodeDefined(n) && !(n.type === "priority" && n.meta === "wont"),
  );
  const blockers = nodes.filter(n => n.type === "blocker");

  const fmtInline = (items: ArchNode[]) =>
    items.length === 0
      ? "none"
      : items
          .map(n => {
            const ans = isNodeDefined(n) ? ` → ${n.strategicAnswer!.trim()}` : "";
            const meta = n.meta ? ` (${n.meta})` : "";
            return `${n.label}${meta}${ans}`;
          })
          .join(", ");

  const edgeList =
    edges.length === 0
      ? "none"
      : edges
          .map(e => {
            const from = nodes.find(n => n.id === e.from)?.label ?? e.from;
            const to = nodes.find(n => n.id === e.to)?.label ?? e.to;
            return `${from} → ${to}`;
          })
          .join(", ");

  const definedInline = fmtInline(defined.filter(n => n.id !== goalNode?.id));
  const unansweredInline = fmtInline(unanswered.filter(n => n.id !== goalNode?.id));
  const blockersInline = fmtInline(blockers);

  const summary =
    `Working from this Flow snapshot: ${goalLabel}. ` +
    `Defined: ${definedInline}. ` +
    `Unresolved: ${unansweredInline}. ` +
    `Open blockers: ${blockersInline}. ` +
    `Edges: ${edgeList}.`;

  const titleBase = `Working session — ${goalLabel}`;
  const snapshotNodes: HandoverSnapshotNode[] = nodes.map(n => ({
    id: n.id,
    type: n.type,
    label: n.label,
    meta: n.meta,
    moscow: n.moscow,
    details: n.details?.trim() || undefined,
    resolved: isNodeDefined(n),
    strategicAnswer: n.strategicAnswer?.trim() || undefined,
  }));
  const snapshotEdges: HandoverSnapshotEdge[] = edges.map(e => ({
    id: e.id, from: e.from, to: e.to,
  }));
  return {
    title: titleBase.length > 80 ? `${titleBase.slice(0, 77)}…` : titleBase,
    summary,
    hash: computeNodeStateHash(nodes),
    definedCount: defined.length,
    totalCount: nodes.length,
    goalLabel,
    nodes: snapshotNodes,
    edges: snapshotEdges,
  };
}

// Per-node persisted state shape. Back-compat: legacy DB rows store a bare
// boolean per id; we read both shapes and always write the object form.
export type PersistedNodeState = boolean | {
  resolved: boolean;
  strategicAnswer?: string;
  label?: string;
  type?: ArchNode["type"];
  x?: number;
  y?: number;
  moved?: boolean;
  details?: string;
  meta?: FlowNodeMeta;
  moscow?: FlowNodeMeta;
  question?: string;
};
export type NodeStateMap = Record<string, PersistedNodeState>;

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
}

// ── Icons per spec ────────────────────────────────────────────────────────────
function getNodeIcon(node: ArchNode): string {
  if (node.type === "goal")        return "◎";
  if (node.type === "requirement") return "◈";
  if (node.type === "blocker")     return "⚠";
  if (node.type === "decision")    return "◆";
  if (node.type === "sprint")      return "△";
  if (node.type === "wont")        return "✕";
  if (node.type === "priority") {
    if (node.meta === "must")   return "■";
    if (node.meta === "should") return "□";
    if (node.meta === "could")  return "◻";
    if (node.meta === "wont")   return "✕";
    return "■";
  }
  return "●";
}

// ── Strategic pivot questions per spec ────────────────────────────────────────
function getPivotQuestion(node: ArchNode): string {
  if (node.question) return node.question;
  if (node.type === "goal")        return "What does winning look like? What's the outcome you'll be proud of?";
  if (node.type === "requirement") return "What must exist for this goal to be achievable?";
  if (node.type === "blocker")     return "What could prevent this from shipping or succeeding?";
  if (node.type === "decision")    return "Who owns this decision, and what information do you need to make it?";
  if (node.type === "sprint")      return "What is the single deliverable that makes this sprint complete?";
  if (node.type === "wont")        return "What are we consciously leaving out, and why?";
  if (node.type === "priority") {
    if (node.meta === "must")   return "Why is this non-negotiable? What breaks without it?";
    if (node.meta === "should") return "What's the cost of deferring this to v2?";
    if (node.meta === "could")  return "Under what conditions does this become a Must?";
    if (node.meta === "wont")   return "Who asked for this, and why are we saying no?";
  }
  return "What does this mean for the project?";
}

const EDGE_FLOW_STYLE = `
@keyframes edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -20; }
}
@keyframes node-fly-in {
  from { opacity: 0; transform: translate(var(--fly-dx), var(--fly-dy)) scale(0.2); }
  to   { opacity: 1; transform: translate(0px, 0px) scale(1); }
}
@keyframes gold-pulse {
  0%, 100% { box-shadow: 0 0 10px rgba(212,175,55,0.30); }
  50%      { box-shadow: 0 0 22px rgba(212,175,55,0.60); }
}
@keyframes gold-pulse-parchment {
  0%, 100% { box-shadow: 0 0 10px rgba(180,83,9,0.32); }
  50%      { box-shadow: 0 0 22px rgba(180,83,9,0.55); }
}
@keyframes amber-pulse-parchment {
  0%, 100% { box-shadow: 0 0 6px rgba(146,64,14,0.18); }
  50%      { box-shadow: 0 0 14px rgba(146,64,14,0.38); }
}
.flow-node-strike::after {
  content: "";
  position: absolute;
  left: 8px;
  right: 8px;
  top: 50%;
  height: 1.5px;
  background: currentColor;
  opacity: 0.55;
  transform: rotate(-28deg);
}
`;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_DEFAULT_MOBILE = 0.85;
const ZOOM_DEFAULT_DESKTOP = 1.0;
const TAP_THRESHOLD = 8;
const CANVAS_PADDING = 80;
const RADIAL_CENTER_X = 300;
const RADIAL_CENTER_Y = 250;
const RADIAL_RADIUS = 180;
const BASE_STORAGE_KEY = "axiom-flow-nodes";

// Seeded radial mission map — replaces the lonely-goal default so the canvas
// reads as "populated" the moment a user opens a new project. Positions orbit
// the goal at (300, 250); fitMap() auto-zooms to fit on mount and resize.
// The goal label/details are project-aware so the canvas reads as a real
// goal ("Ship <project>") instead of the generic placeholder "The Goal".
function goalLabelFor(projectName?: string): string {
  const trimmed = (projectName ?? "").trim();
  if (!trimmed || /^untitled/i.test(trimmed)) return "Name the goal";
  return `Ship ${trimmed}`;
}
function goalDetailsFor(projectName?: string): string {
  const trimmed = (projectName ?? "").trim();
  if (!trimmed || /^untitled/i.test(trimmed)) {
    return "Tap to state the outcome — what does winning look like?";
  }
  return `What does shipping ${trimmed} actually look like? Tap to sharpen the outcome.`;
}
function buildInitialNodes(projectName?: string): ArchNode[] {
  return [
    { id: "goal",        label: goalLabelFor(projectName),  type: "goal",        resolved: false, x: 300, y: 250, details: goalDetailsFor(projectName) },
    { id: "must-1",      label: "Core requirement", type: "requirement", resolved: false, x: 300, y:  80, meta: "must",  details: "Tap to define the must-have that makes v1 real." },
    { id: "blocker-1",   label: "Open blocker",     type: "blocker",     resolved: false, x: 520, y: 160, details: "Tap to name a blocker that's slowing the goal down." },
    { id: "decision-1",  label: "Open decision",    type: "decision",    resolved: false, x: 520, y: 340, details: "Tap to capture a decision that's still in tension." },
    { id: "sprint-1",    label: "Initial Milestone", type: "sprint",      resolved: false, x:  80, y: 160, details: "What single deliverable closes this milestone?" },
    { id: "should-1",    label: "Should-have",      type: "priority",    resolved: false, x:  80, y: 340, meta: "should", details: "What's the cost of deferring this?" },
    { id: "must-2",      label: "Foundation",       type: "requirement", resolved: false, x: 300, y: 420, meta: "must",  details: "What has to be true before everything else?" },
  ];
}

const INITIAL_EDGES: ArchEdge[] = [
  { id: "e-goal-must-1",     from: "goal", to: "must-1" },
  { id: "e-goal-blocker-1",  from: "goal", to: "blocker-1" },
  { id: "e-goal-decision-1", from: "goal", to: "decision-1" },
  { id: "e-goal-sprint-1",   from: "goal", to: "sprint-1" },
  { id: "e-goal-should-1",   from: "goal", to: "should-1" },
  { id: "e-goal-must-2",     from: "goal", to: "must-2" },
];

export function layoutRadial(nodes: ArchNode[]): ArchNode[] {
  const layoutableNodes = nodes.filter(n => n.type !== "goal" && !n.moved);
  const count = layoutableNodes.length;
  let ringIndex = 0;

  return nodes.map(node => {
    if (node.moved) return node;
    if (node.type === "goal") {
      return { ...node, x: RADIAL_CENTER_X, y: RADIAL_CENTER_Y };
    }
    const angle = (ringIndex / Math.max(count, 1)) * 2 * Math.PI - Math.PI / 2;
    ringIndex += 1;
    return {
      ...node,
      x: RADIAL_CENTER_X + Math.cos(angle) * RADIAL_RADIUS,
      y: RADIAL_CENTER_Y + Math.sin(angle) * RADIAL_RADIUS,
    };
  });
}

function addEdgeIfMissing(edges: ArchEdge[], from: string, to: string): ArchEdge[] {
  if (from === to || edges.some(e => e.from === from && e.to === to)) return edges;
  return [...edges, { id: `e-${from}-${to}`, from, to }];
}

function normalizeGoalNodes(
  nodes: ArchNode[],
  edges: ArchEdge[],
): { nodes: ArchNode[]; edges: ArchEdge[]; goalId?: string } {
  const goals = nodes.filter(n => n.type === "goal");
  if (goals.length <= 1) {
    return { nodes, edges, goalId: goals[0]?.id };
  }

  const edgeCounts = new Map<string, number>();
  for (const goal of goals) edgeCounts.set(goal.id, 0);
  for (const edge of edges) {
    if (edgeCounts.has(edge.from)) edgeCounts.set(edge.from, (edgeCounts.get(edge.from) ?? 0) + 1);
    if (edgeCounts.has(edge.to)) edgeCounts.set(edge.to, (edgeCounts.get(edge.to) ?? 0) + 1);
  }

  const keptGoal = [...goals].sort((a, b) => {
    const countDiff = (edgeCounts.get(b.id) ?? 0) - (edgeCounts.get(a.id) ?? 0);
    return countDiff !== 0 ? countDiff : a.id.localeCompare(b.id);
  })[0];
  const droppedGoalIds = new Set(goals.filter(goal => goal.id !== keptGoal.id).map(goal => goal.id));
  const edgeKeys = new Set<string>();
  const normalizedEdges: ArchEdge[] = [];

  for (const edge of edges) {
    const from = droppedGoalIds.has(edge.from) ? keptGoal.id : edge.from;
    const to = droppedGoalIds.has(edge.to) ? keptGoal.id : edge.to;
    if (from === to) continue;
    const key = `${from}\u0001${to}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    normalizedEdges.push({ ...edge, from, to });
  }

  return {
    nodes: nodes.filter(node => !droppedGoalIds.has(node.id)),
    edges: normalizedEdges,
    goalId: keptGoal.id,
  };
}

// Detect the EXACT untouched legacy "lonely goal" default — every field must
// match the original seed and no edges may exist. Any user-edited goal (label,
// position, resolved state, details) is preserved untouched.
const LEGACY_GOAL_DEFAULT = {
  id: "goal",
  label: "The Goal",
  type: "goal" as const,
  resolved: false,
  x: 300,
  y: 250,
  details: "What does winning look like for this project?",
};

function isLegacyDefault(parsedNodes: unknown, parsedEdges: unknown): boolean {
  if (!Array.isArray(parsedNodes) || parsedNodes.length !== 1) return false;
  const only = parsedNodes[0] as Partial<ArchNode>;
  if (only?.id !== LEGACY_GOAL_DEFAULT.id) return false;
  if (only?.type !== LEGACY_GOAL_DEFAULT.type) return false;
  if (only?.label !== LEGACY_GOAL_DEFAULT.label) return false;
  if (only?.resolved !== LEGACY_GOAL_DEFAULT.resolved) return false;
  if (only?.x !== LEGACY_GOAL_DEFAULT.x) return false;
  if (only?.y !== LEGACY_GOAL_DEFAULT.y) return false;
  if (only?.details !== LEGACY_GOAL_DEFAULT.details) return false;
  if (only?.meta !== undefined) return false;
  if (only?.question !== undefined) return false;
  // No edges may exist — a user who built relationships is not on the default.
  if (Array.isArray(parsedEdges) && parsedEdges.length > 0) return false;
  return true;
}

// Detect a seeded goal node that still carries the original generic
// "The Goal" label. Projects seeded before the goal became project-aware
// land here; we rewrite ONLY the goal label/details, never user edits.
function isStaleGenericGoal(node: Partial<ArchNode> | undefined): boolean {
  if (!node) return false;
  if (node.id !== "goal" || node.type !== "goal") return false;
  return node.label === "The Goal";
}

// Migration marker so we only ever reseed a given project once. After a
// successful reseed (or after we decide a project is NOT legacy), we stamp this
// key and never reconsider that project again.
const MIGRATION_KEY_SUFFIX = "-seed-v2-applied";

function loadNodes(key: string, projectName?: string): ArchNode[] {
  try {
    const migrationKey = `${key}${MIGRATION_KEY_SUFFIX}`;
    const alreadyMigrated = localStorage.getItem(migrationKey) === "1";
    const r = localStorage.getItem(key);
    if (!r) {
      // Brand-new project: seed and mark migrated.
      localStorage.setItem(migrationKey, "1");
      return buildInitialNodes(projectName);
    }
    const parsed = JSON.parse(r) as ArchNode[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(migrationKey, "1");
      return buildInitialNodes(projectName);
    }
    // Rewrite stale generic "The Goal" label on existing projects so the
    // canvas reads as a real goal. Only the goal label/details are updated;
    // all other fields (position, resolved, meta) are preserved.
    const upgraded = parsed.map(n =>
      isStaleGenericGoal(n)
        ? { ...n, label: goalLabelFor(projectName), details: goalDetailsFor(projectName) }
        : n
    );
    if (alreadyMigrated) return upgraded;
    const edgesRaw = localStorage.getItem(`${key}-edges`);
    const parsedEdges = edgesRaw ? JSON.parse(edgesRaw) : null;
    if (isLegacyDefault(parsed, parsedEdges)) {
      localStorage.setItem(migrationKey, "1");
      return buildInitialNodes(projectName);
    }
    // Not legacy — stamp it so we never re-check.
    localStorage.setItem(migrationKey, "1");
    return upgraded;
  } catch { return buildInitialNodes(projectName); }
}

function loadEdges(key: string): ArchEdge[] {
  try {
    const r = localStorage.getItem(`${key}-edges`);
    const stored = localStorage.getItem(key);
    const parsedNodes = stored ? JSON.parse(stored) : null;
    const parsedEdges = r ? JSON.parse(r) : null;
    if (isLegacyDefault(parsedNodes, parsedEdges)) return INITIAL_EDGES;
    return parsedEdges ?? INITIAL_EDGES;
  } catch { return INITIAL_EDGES; }
}

interface AxiomFlowProps {
  projectId?: number;
  onReadinessChange?: (score: number) => void;
  onNodesChange?: (nodes: ArchNode[]) => void;
  compact?: boolean;
  onBackToChat?: () => void;
  onNodeFocus?: (text: string) => void;
  atmosphere?: string;
  detectedBuilder?: string;
  initialNodeState?: NodeStateMap | null;
  pendingNodes?: ArchNode[];
  onPendingConsumed?: () => void;
  onUnansweredQuestionOpen?: (payload: { node: ArchNode; mirror: string }) => void;
  onHandover?: (payload: { snapshot: HandoverSnapshot; title: string }) => void;
  handoverPending?: boolean;
  lastHandoverHash?: string | null;
  // Controlled snapshot stream — workspace uses this to render the desktop
  // handover button + workspace-header drift indicator without remounting.
  onSnapshotChange?: (snapshot: HandoverSnapshot | null) => void;
  // Optional controlled-popover. When both provided, AxiomFlow defers
  // open/close to the workspace so a desktop trigger can drive the same UI.
  handoverOpen?: boolean;
  onHandoverOpenChange?: (open: boolean) => void;
  // Workspace-owned breakpoint. Passed in so desktop/mobile detection is
  // consistent with the rest of the app and there is no chance of a tablet
  // width range showing both the desktop tab-bar trigger and the footer pill.
  isMobile?: boolean;
  projectName?: string;
}

export function AxiomFlow({
  projectId,
  onReadinessChange,
  onNodesChange,
  compact,
  onBackToChat,
  onNodeFocus,
  initialNodeState,
  detectedBuilder,
  pendingNodes,
  onPendingConsumed,
  onUnansweredQuestionOpen,
  onHandover,
  handoverPending,
  lastHandoverHash: _lastHandoverHash,
  onSnapshotChange,
  handoverOpen: handoverOpenProp,
  onHandoverOpenChange,
  isMobile: isMobileProp,
  projectName,
}: AxiomFlowProps) {
  const storageKey = `${BASE_STORAGE_KEY}${projectId ? `-${projectId}` : ""}`;
  // Prefer the workspace-provided breakpoint; fall back to a local snapshot
  // only when AxiomFlow is rendered standalone (e.g. legacy contexts).
  const isMobile = isMobileProp ?? (typeof window !== "undefined" && window.innerWidth < 768);
  const theme = useThemeMode();
  const palette = flowPaletteFor(theme);
  const [, setLocation] = useLocation();
  const [nodes, setNodes] = useState<ArchNode[]>(() => loadNodes(storageKey, projectName));
  const [edges, setEdges] = useState<ArchEdge[]>(() => loadEdges(storageKey));
  const mapSeenKey = projectId ? `atlas-map-seen-${projectId}` : "atlas-map-seen-standalone";
  const [summaryCollapsed, setSummaryCollapsed] = useState(() => {
    try { return localStorage.getItem(mapSeenKey) === "1"; } catch { return false; }
  });

  useEffect(() => {
    try { setSummaryCollapsed(localStorage.getItem(mapSeenKey) === "1"); } catch { setSummaryCollapsed(false); }
  }, [mapSeenKey]);

  // If projectName arrives or changes after mount and the goal node still
  // carries the generic "The Goal" label, rewrite just the goal to read as
  // a real, project-aware goal. User-edited labels are left untouched.
  useEffect(() => {
    setNodes(prev => {
      const goal = prev.find(n => n.id === "goal");
      if (!goal || goal.label !== "The Goal") return prev;
      return prev.map(n =>
        n.id === "goal"
          ? { ...n, label: goalLabelFor(projectName), details: goalDetailsFor(projectName) }
          : n
      );
    });
  }, [projectName]);

  // Sync strategicAnswer from DB on first load. `resolved` is now strictly
  // derived from a non-empty strategicAnswer — legacy `Record<id, boolean>`
  // rows are intentionally NOT migrated to "resolved", so a previously-checked
  // node with no captured answer falls back to the amber-pulse unanswered state.
  const dbLoadedRef = useRef(false);
  useEffect(() => {
    if (!projectId || dbLoadedRef.current) return;
    dbLoadedRef.current = true;
    fetch(`/api/projects/${projectId}/flow`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { nodes: ArchNode[]; edges: ArchEdge[] } | null) => {
        if (!data || !Array.isArray(data.nodes) || data.nodes.length === 0) return;
        setNodes(data.nodes);
        setEdges(data.edges ?? []);
      })
      .catch(() => {});
  }, [projectId]);

  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current || !initialNodeState) return;
    dbSyncedRef.current = true;
    setNodes(prev => prev.map(n => {
      const raw = initialNodeState[n.id];
      if (raw === undefined) return { ...n, resolved: isNodeDefined(n) };
      if (typeof raw === "boolean") return { ...n, resolved: isNodeDefined(n) };
      const answer = typeof raw.strategicAnswer === "string" ? raw.strategicAnswer : undefined;
      const hasAnswer = Boolean(answer && answer.trim().length > 0);
      const next: ArchNode = {
        ...n,
        label: typeof raw.label === "string" && raw.label.trim() ? raw.label : n.label,
        type: raw.type ?? n.type,
        x: typeof raw.x === "number" ? raw.x : n.x,
        y: typeof raw.y === "number" ? raw.y : n.y,
        moved: typeof raw.moved === "boolean" ? raw.moved : n.moved,
        details: typeof raw.details === "string" ? raw.details : n.details,
        meta: raw.meta ?? n.meta,
        moscow: raw.moscow ?? n.moscow,
        question: typeof raw.question === "string" ? raw.question : n.question,
        resolved: hasAnswer,
      };
      if (hasAnswer) next.strategicAnswer = answer;
      return next;
    }));
  }, [initialNodeState]);

  // Track newly-added node IDs for fly-in animation
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());

  // Merge pending nodes from Forge, then tidy them through the normal node state
  // path so existing onNodesChange/local/DB persistence all observe the update.
  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (!pendingNodes || pendingNodes.length === 0 || pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;

    // Cleanup: when Forge delivers real nodes, drop untouched seed placeholders
    // (unresolved, no strategicAnswer, label still default). Preserve the goal.
    const SEED_IDS = new Set(["must-1", "must-2", "should-1", "sprint-1", "blocker-1", "decision-1"]);
    const SEED_DEFAULT_LABELS: Record<string, string> = {
      "must-1": "Core requirement",
      "must-2": "Foundation",
      "should-1": "Should-have",
      "sprint-1": "Initial Milestone",
      "blocker-1": "Open blocker",
      "decision-1": "Open decision",
    };
    let nextNodes = nodes.filter(n => {
      if (!SEED_IDS.has(n.id)) return true;
      const untouched = !n.resolved
        && !n.strategicAnswer
        && n.label === SEED_DEFAULT_LABELS[n.id];
      return !untouched;
    });
    const survivorIds = new Set(nextNodes.map(n => n.id));
    let nextEdges = edges.filter(e => survivorIds.has(e.from) && survivorIds.has(e.to));
    let normalized = normalizeGoalNodes(nextNodes, nextEdges);
    nextNodes = normalized.nodes;
    nextEdges = normalized.edges;

    const incomingGoals = pendingNodes.filter(n => n.type === "goal");
    const incomingGoal = incomingGoals[incomingGoals.length - 1];
    if (incomingGoal) {
      const existingGoal = nextNodes.find(n => n.type === "goal");
      if (existingGoal) {
        nextNodes = nextNodes.map(n =>
          n.id === existingGoal.id
            ? { ...n, label: incomingGoal.label, details: incomingGoal.details }
            : n
        );
      } else {
        nextNodes = [{ ...incomingGoal, x: RADIAL_CENTER_X, y: RADIAL_CENTER_Y }, ...nextNodes];
      }
    }

    const goalNode = nextNodes.find(n => n.type === "goal") || nextNodes[0];
    const newlyAdded: string[] = [];
    for (const newNode of pendingNodes) {
      if (newNode.type === "goal") continue;
      const existingNode = nextNodes.find(n => n.id === newNode.id);
      if (existingNode) {
        nextNodes = nextNodes.map(n => {
          if (n.id !== newNode.id) return n;
          const merged = {
            ...n,
            ...newNode,
            strategicAnswer: newNode.strategicAnswer ?? n.strategicAnswer,
            moved: n.moved,
          };
          return n.moved ? { ...merged, x: n.x, y: n.y } : merged;
        });
      } else {
        nextNodes = [...nextNodes, newNode];
        newlyAdded.push(newNode.id);
      }
      if (goalNode) {
        nextEdges = addEdgeIfMissing(nextEdges, goalNode.id, newNode.id);
      }
    }

    normalized = normalizeGoalNodes(nextNodes, nextEdges);
    nextNodes = layoutRadial(normalized.nodes);
    nextEdges = normalized.edges;

    if (newlyAdded.length > 0) {
      haptics.tap();
      sounds.tap();
      setNewlyAddedIds(prev => new Set([...prev, ...newlyAdded]));
      setTimeout(() => {
        setNewlyAddedIds(prev => {
          const next = new Set(prev);
          for (const id of newlyAdded) next.delete(id);
          return next;
        });
      }, 650);
    }

    setNodes(nextNodes);
    setEdges(nextEdges);

    setTimeout(() => {
      pendingConsumedRef.current = false;
      onPendingConsumed?.();
    }, 100);
  }, [pendingNodes, onPendingConsumed, nodes, edges]);

  const [zoom, setZoom] = useState(isMobile ? ZOOM_DEFAULT_MOBILE : ZOOM_DEFAULT_DESKTOP);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeCardNodeId, setActiveCardNodeId] = useState<string | null>(null);
  const [editingDetailsNodeId, setEditingDetailsNodeId] = useState<string | null>(null);
  const [detailsDraft, setDetailsDraft] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    dragging: false,
    startX: 0, startY: 0,
    startPanX: 0, startPanY: 0,
    moved: false,
    lastTap: 0,
    lastNodeTapTime: 0,
    pinchStartDist: 0,
    pinchStartZoom: 1,
  });
  const nodeDragState = useRef({
    nodeId: null as string | null,
    startX: 0,
    startY: 0,
    nodeStartX: 0,
    nodeStartY: 0,
    moved: false,
  });

  const startNodeDrag = useCallback((nodeId: string, e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    const point = "touches" in e ? e.touches[0] : e;
    if (!point) return;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragState.current.dragging = false;
    dragState.current.moved = false;
    dragState.current.lastNodeTapTime = Date.now();
    nodeDragState.current = {
      nodeId,
      startX: point.clientX,
      startY: point.clientY,
      nodeStartX: node.x,
      nodeStartY: node.y,
      moved: false,
    };
  }, [nodes]);

  const updateNodeDrag = useCallback((clientX: number, clientY: number) => {
    const nd = nodeDragState.current;
    if (!nd.nodeId) return false;
    const clientDx = clientX - nd.startX;
    const clientDy = clientY - nd.startY;
    if (Math.abs(clientDx) > TAP_THRESHOLD || Math.abs(clientDy) > TAP_THRESHOLD) {
      nd.moved = true;
      dragState.current.moved = true;
    }
    if (!nd.moved) return true;
    const dx = clientDx / zoom;
    const dy = clientDy / zoom;
    setNodes(prev => prev.map(n =>
      n.id === nd.nodeId
        ? { ...n, x: nd.nodeStartX + dx, y: nd.nodeStartY + dy }
        : n
    ));
    return true;
  }, [zoom]);

  const finishNodeDrag = useCallback(() => {
    const nd = nodeDragState.current;
    if (!nd.nodeId) return false;
    const nodeId = nd.nodeId;
    const moved = nd.moved;
    nodeDragState.current = {
      nodeId: null,
      startX: 0,
      startY: 0,
      nodeStartX: 0,
      nodeStartY: 0,
      moved: false,
    };
    if (moved) {
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, moved: true } : n));
    }
    return true;
  }, []);

  // Readiness: exclude wont-priority nodes from both numerator and denominator.
  // A node counts toward readiness only if it has a locked-in strategicAnswer.
  const nonWontNodes = nodes.filter(n => !(n.type === "priority" && n.meta === "wont"));
  const readinessScore = Math.round(
    (nonWontNodes.filter(isNodeDefined).length / Math.max(nonWontNodes.length, 1)) * 100
  );
  const goalForSummary = nodes.find(n => n.type === "goal") ?? nodes[0];
  const mustCount = nodes.filter(n => getMoscow(n) === "must").length;
  const shouldCount = nodes.filter(n => getMoscow(n) === "should").length;
  const openDecisionCount = nodes.filter(n => n.type === "decision" && !isNodeDefined(n)).length;
  const blockerCount = nodes.filter(n => n.type === "blocker").length;
  const definedCount = nodes.filter(isNodeDefined).length;
  const isEmptyMap = definedCount === 0;
  const projectLabel = projectName?.trim() || "this project";

  useEffect(() => { onReadinessChange?.(readinessScore); }, [readinessScore, onReadinessChange]);

  useEffect(() => {
    onNodesChange?.(nodes);
    try { localStorage.setItem(storageKey, JSON.stringify(nodes)); } catch {}
  }, [nodes, onNodesChange, storageKey]);

  const flowSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!projectId || !dbLoadedRef.current) return;
    if (flowSaveTimerRef.current) clearTimeout(flowSaveTimerRef.current);
    flowSaveTimerRef.current = setTimeout(() => {
      fetch(`/api/projects/${projectId}/flow`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges }),
      }).catch(() => {});
    }, 1500);
    return () => {
      if (flowSaveTimerRef.current) clearTimeout(flowSaveTimerRef.current);
    };
  }, [nodes, edges, projectId]);

  useEffect(() => {
    try { localStorage.setItem(`${storageKey}-edges`, JSON.stringify(edges)); } catch {}
  }, [edges, storageKey]);

  useEffect(() => {
    if (nodes.filter(n => n.type === "goal").length <= 1) return;
    const normalized = normalizeGoalNodes(nodes, edges);
    setNodes(layoutRadial(normalized.nodes));
    setEdges(normalized.edges);
  }, [nodes, edges]);

  // Center the viewport on a specific (x, y) world coordinate while preserving
  // the current zoom. Used for the Intel Panel goal re-anchor: tapping the
  // goal re-centers the map around it instead of fitting all bounds.
  const centerOnPoint = useCallback((cx: number, cy: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPan({ x: rect.width / 2 / zoom - cx, y: rect.height / 2 / zoom - cy });
  }, [zoom]);

  const fitMap = useCallback(() => {
    if (!containerRef.current || nodes.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const minX = Math.min(...nodes.map(n => n.x)) - 40;
    const maxX = Math.max(...nodes.map(n => n.x)) + 40;
    const minY = Math.min(...nodes.map(n => n.y)) - 30;
    const maxY = Math.max(...nodes.map(n => n.y)) + 60;
    const mapW = maxX - minX + CANVAS_PADDING * 2;
    const mapH = maxY - minY + CANVAS_PADDING * 2;
    const scaleX = rect.width / mapW;
    const scaleY = rect.height / mapH;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(scaleX, scaleY)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    setZoom(newZoom);
    setPan({ x: rect.width / 2 / newZoom - centerX, y: rect.height / 2 / newZoom - centerY });
  }, [nodes]);

  useEffect(() => {
    fitMap();
    const observer = new ResizeObserver(() => fitMap());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [fitMap]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current;
    ds.dragging = true; ds.startX = e.clientX; ds.startY = e.clientY;
    ds.startPanX = pan.x; ds.startPanY = pan.y; ds.moved = false;
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (updateNodeDrag(e.clientX, e.clientY)) return;
    const ds = dragState.current;
    if (!ds.dragging) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) ds.moved = true;
    setPan({ x: ds.startPanX + dx / zoom, y: ds.startPanY + dy / zoom });
  }, [updateNodeDrag, zoom]);

  const onMouseUp = useCallback(() => {
    if (finishNodeDrag()) return;
    dragState.current.dragging = false;
  }, [finishNodeDrag]);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z - e.deltaY * 0.001)));
  }, []);

  const resetView = useCallback(() => {
    fitMap();
    toast("View Reset", {
      duration: 1000,
      style: {
        color: palette.toastText,
        background: palette.toastBg,
        border: "1px solid rgba(167,139,250,0.45)",
        boxShadow: "0 0 0 1px rgba(167,139,250,0.18), 0 0 28px rgba(167,139,250,0.45), 0 0 60px rgba(139,92,246,0.28)",
      },
    });
  }, [fitMap]);

  const tidyLayout = useCallback(() => {
    const normalized = normalizeGoalNodes(nodes, edges);
    setNodes(layoutRadial(normalized.nodes));
    setEdges(normalized.edges);
    haptics.tap();
  }, [nodes, edges]);

  const onDoubleClick = useCallback(() => { resetView(); }, [resetView]);

  const onContainerClick = useCallback(() => {
    if (!dragState.current.moved && Date.now() - dragState.current.lastNodeTapTime > 150) {
      setActiveCardNodeId(null);
    }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const ds = dragState.current;
    if (e.touches.length === 1) {
      ds.dragging = true; ds.startX = e.touches[0].clientX; ds.startY = e.touches[0].clientY;
      ds.startPanX = pan.x; ds.startPanY = pan.y; ds.moved = false;
    } else if (e.touches.length === 2) {
      ds.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      ds.pinchStartDist = Math.hypot(dx, dy);
      ds.pinchStartZoom = zoom;
    }
  }, [pan, zoom]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const ds = dragState.current;
    if (e.touches.length === 1 && updateNodeDrag(e.touches[0].clientX, e.touches[0].clientY)) {
      return;
    }
    if (e.touches.length === 1 && ds.dragging) {
      const dx = e.touches[0].clientX - ds.startX;
      const dy = e.touches[0].clientY - ds.startY;
      if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) ds.moved = true;
      setPan({ x: ds.startPanX + dx / zoom, y: ds.startPanY + dy / zoom });
    } else if (e.touches.length === 2 && ds.pinchStartDist > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, ds.pinchStartZoom * (dist / ds.pinchStartDist))));
    }
  }, [updateNodeDrag, zoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (finishNodeDrag()) return;
    const ds = dragState.current;
    ds.dragging = false;
    if (e.changedTouches.length === 1 && !ds.moved) {
      const now = Date.now();
      if (now - ds.lastTap < 180) {
        resetView();
        ds.lastTap = 0;
      } else {
        ds.lastTap = now;
      }
    }
  }, [finishNodeDrag, resetView]);

  // Track last-mirrored node so we don't spam the chat with duplicates on
  // repeated taps of the same unanswered node.
  const lastMirroredRef = useRef<string | null>(null);

  const handleNodeTap = useCallback((nodeId: string, e: React.MouseEvent | React.TouchEvent) => {
    dragState.current.lastNodeTapTime = Date.now();
    dragState.current.dragging = false;
    if (!dragState.current.moved) {
      e.stopPropagation();
      haptics.tap();
      sounds.tap();
      if (activeCardNodeId === nodeId) {
        setActiveCardNodeId(null);
      } else {
        setActiveCardNodeId(nodeId);
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
          const question = getPivotQuestion(node);
          if (onNodeFocus) onNodeFocus(question);
          // Goal re-anchor: tapping the goal recenters the viewport on the
          // goal's world coordinates while preserving zoom.
          if (node.type === "goal") {
            requestAnimationFrame(() => centerOnPoint(node.x, node.y));
          }
          // Chat mirror — only for unanswered nodes, debounced per-node.
          if (!isNodeDefined(node) && onUnansweredQuestionOpen && lastMirroredRef.current !== nodeId) {
            lastMirroredRef.current = nodeId;
            onUnansweredQuestionOpen({
              node,
              mirror: `🜸 ${node.label} — ${question}`,
            });
          }
        }
      }
    }
  }, [activeCardNodeId, nodes, onNodeFocus, onUnansweredQuestionOpen, centerOnPoint]);

  const handleLockInAnswer = useCallback((nodeId: string, answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    let lockedLabel = "";
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      lockedLabel = n.label;
      return { ...n, strategicAnswer: trimmed, resolved: true };
    }));
    haptics.nodeResolved();
    sounds.nodeResolved();
    toast(`${lockedLabel || "Node"} defined`, {
      duration: 1600,
      style: {
        color: theme === "parchment" ? "#F5F1E8" : "#0D0B09",
        background: palette.goldText,
        border: "1px solid rgba(167,139,250,0.55)",
        boxShadow: "0 0 0 1px rgba(167,139,250,0.22), 0 0 28px rgba(167,139,250,0.5), 0 0 60px rgba(139,92,246,0.32)",
        fontWeight: 700,
        letterSpacing: "0.04em",
      },
    });
    // Reset mirror tracker so re-tap after answer is treated fresh.
    if (lastMirroredRef.current === nodeId) lastMirroredRef.current = null;
    setActiveCardNodeId(null);
  }, []);

  const startDetailsEdit = useCallback((node: ArchNode) => {
    setEditingDetailsNodeId(node.id);
    setDetailsDraft(node.details ?? "");
  }, []);

  const saveDetailsEdit = useCallback((nodeId: string) => {
    const trimmed = detailsDraft.trim();
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, details: trimmed || undefined } : n));
    setEditingDetailsNodeId(null);
    setDetailsDraft("");
  }, [detailsDraft]);

  const cancelDetailsEdit = useCallback(() => {
    setEditingDetailsNodeId(null);
    setDetailsDraft("");
  }, []);

  // ── Handover state ────────────────────────────────────────────────────────
  const [handoverOpenInternal, setHandoverOpenInternal] = useState(false);
  const [handoverTitle, setHandoverTitle] = useState("");
  const handoverInputRef = useRef<HTMLInputElement>(null);
  const controlledOpen = handoverOpenProp !== undefined && !!onHandoverOpenChange;
  const handoverOpen = controlledOpen ? !!handoverOpenProp : handoverOpenInternal;
  const setHandoverOpen = useCallback((open: boolean) => {
    if (controlledOpen) onHandoverOpenChange!(open);
    else setHandoverOpenInternal(open);
  }, [controlledOpen, onHandoverOpenChange]);

  const currentSnapshot = onHandover ? buildHandoverSnapshot(nodes, edges) : null;
  const handoverEnabled = !!onHandover && (currentSnapshot?.definedCount ?? 0) > 0;

  // Stream the snapshot upward so the workspace can render its own header
  // drift pill and desktop trigger button.
  useEffect(() => {
    if (!onSnapshotChange) return;
    onSnapshotChange(currentSnapshot);
  }, [onSnapshotChange, currentSnapshot?.hash, currentSnapshot?.definedCount]);

  // When the popover is opened (from inside or outside), seed the title input
  // and select it.
  useEffect(() => {
    if (!handoverOpen || !currentSnapshot) return;
    setHandoverTitle(currentSnapshot.title);
    setTimeout(() => handoverInputRef.current?.select(), 40);
  }, [handoverOpen]);

  const openHandover = useCallback(() => {
    if (!handoverEnabled) return;
    setHandoverOpen(true);
  }, [handoverEnabled, setHandoverOpen]);

  const confirmHandover = useCallback(() => {
    if (!onHandover || !currentSnapshot) return;
    const title = handoverTitle.trim() || currentSnapshot.title;
    // Don't close the popover here — let the workspace close it from the
    // mutation's success path so failed handovers preserve the user's title
    // input and any context they had on screen.
    onHandover({ snapshot: currentSnapshot, title });
  }, [onHandover, currentSnapshot, handoverTitle]);

  const strokeWidth = Math.max(1, Math.min(2, 1.5 / zoom));

  const activeCardNode = activeCardNodeId ? nodes.find(n => n.id === activeCardNodeId) : null;
  const activeCardMoscow = activeCardNode ? getMoscow(activeCardNode) : undefined;
  let cardLeft = 0;
  let cardTop = 0;
  const CARD_W = 228;
  if (activeCardNode) {
    const nodeScreenX = (activeCardNode.x + pan.x) * zoom;
    const nodeScreenY = (activeCardNode.y + pan.y) * zoom;
    cardLeft = nodeScreenX - CARD_W / 2;
    cardTop = nodeScreenY - 180;
    const containerW = containerRef.current?.offsetWidth ?? 600;
    cardLeft = Math.max(8, Math.min(cardLeft, containerW - CARD_W - 8));
    if (cardTop < 50) cardTop = nodeScreenY + 75;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden system-map-glow"
      style={{
        borderRadius: compact ? 0 : 8,
        background: palette.rootBg,
        transition: "box-shadow 1s ease",
        touchAction: "none",
        cursor: dragState.current.dragging ? "grabbing" : "grab",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClick={onContainerClick}
    >
      <style>{EDGE_FLOW_STYLE}</style>

      {/* Dot grid */}
      <div className="absolute inset-0" style={{
        backgroundImage: `radial-gradient(circle at 1px 1px, ${palette.dotGrid} 1px, transparent 0)`,
        backgroundSize: "40px 40px",
      }} />

      {/* Header label */}
      <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
        {onBackToChat && (
          <button
            onClick={(e) => { e.stopPropagation(); onBackToChat(); }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              width: 20,
              height: 20,
              minWidth: 20,
              minHeight: 20,
              padding: 0,
              background: "transparent",
              border: "none",
              color: "var(--atlas-gold)",
              opacity: 0.7,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            aria-label="Back to chat"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); haptics.tap(); setLocation("/map"); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          title="Open Master Map"
          aria-label="Open Master Map"
          style={{
            width: 22, height: 22, padding: 0,
            background: "transparent", border: "none",
            color: "var(--atlas-gold)", opacity: 0.7,
            cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="6" rx="1" />
            <rect x="16" y="16" width="6" height="6" rx="1" />
            <rect x="2" y="16" width="6" height="6" rx="1" />
            <path d="M12 8v4M12 12H5v4M12 12h7v4" />
          </svg>
        </button>
      </div>

      {nodes.length > 0 && (
        summaryCollapsed ? (
          <button
            onClick={(e) => { e.stopPropagation(); setSummaryCollapsed(false); }}
            onMouseDown={(e) => e.stopPropagation()}
            title="Show Flow summary"
            style={{
              position: "absolute",
              right: 14,
              top: 14,
              zIndex: 12,
              width: 30,
              height: 30,
              borderRadius: 8,
              background: palette.panelBg,
              border: `1px solid rgba(${palette.goldRgb},0.32)`,
              color: palette.goldText,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <path d="M3 4h10M3 8h7M3 12h5" />
            </svg>
          </button>
        ) : (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: "50%",
              top: 42,
              transform: "translateX(-50%)",
              zIndex: 12,
              width: "min(520px, calc(100% - 28px))",
              background: theme === "parchment"
                ? `linear-gradient(rgba(255,252,245,0.96), rgba(252,247,236,0.96)) padding-box, linear-gradient(135deg, rgba(${palette.goldRgb},0.55), rgba(${palette.goldRgb},0.18) 45%, rgba(${palette.goldRgb},0.55)) border-box`
                : "linear-gradient(rgba(10,10,12,0.78), rgba(10,10,12,0.78)) padding-box, linear-gradient(135deg, rgba(167,139,250,0.75), rgba(139,92,246,0.35) 50%, rgba(167,139,250,0.75)) border-box",
              border: "1.5px solid transparent",
              borderRadius: 12,
              padding: "12px 14px",
              boxShadow: theme === "parchment"
                ? `0 0 0 1px rgba(${palette.goldRgb},0.16), 0 8px 24px rgba(146,64,14,0.08), 0 20px 50px rgba(146,64,14,0.06)`
                : "0 0 24px rgba(139,92,246,0.35), 0 0 60px rgba(139,92,246,0.18), 0 20px 60px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(167,139,250,0.08)",
              backdropFilter: "blur(20px) saturate(140%)",
              pointerEvents: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: palette.goldText, flexShrink: 0, boxShadow: `0 0 8px ${palette.goldText}` }} />
              <span style={{ flex: 1, fontFamily: "var(--app-font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: theme === "parchment" ? "rgba(60,40,15,0.78)" : "rgba(231,229,226,0.85)" }}>
                {isEmptyMap ? `${projectLabel} — nothing mapped yet` : "Here's what Atlas mapped from your conversation"}
              </span>
              <button
                onClick={() => {
                  setSummaryCollapsed(true);
                  try { localStorage.setItem(mapSeenKey, "1"); } catch {}
                }}
                style={{ background: "transparent", border: "none", color: palette.fgText, opacity: 0.55, cursor: "pointer", fontSize: 16, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
            <div style={{ color: theme === "parchment" ? "rgba(60,40,15,0.72)" : "rgba(200,200,205,0.78)", fontSize: 12, lineHeight: 1.55, marginBottom: 12 }}>
              {isEmptyMap ? (
                <>Atlas hasn't extracted anything for <b style={{ color: theme === "parchment" ? "rgba(40,25,8,0.95)" : "rgba(231,229,226,0.95)", fontWeight: 600 }}>{projectLabel}</b> yet — the nodes below are empty placeholders, not real content. Tap any node to define it, or tap <b style={{ color: palette.goldText, fontWeight: 600 }}>Get started</b> and tell Atlas what you're building.</>
              ) : (
                <>Your goal is <b style={{ color: theme === "parchment" ? "rgba(40,25,8,0.95)" : "rgba(231,229,226,0.95)", fontWeight: 600 }}>{goalForSummary?.label ?? "your first node"}</b>. So far Atlas has captured {definedCount} of {nodes.length} nodes — {mustCount} must-haves, {shouldCount} should-haves, {openDecisionCount} open decisions, {blockerCount} blockers. Tap any node to edit.</>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {isEmptyMap && onNodeFocus && (
                <button
                  onClick={() => {
                    setSummaryCollapsed(true);
                    try { localStorage.setItem(mapSeenKey, "1"); } catch {}
                    onNodeFocus(`Let's map ${projectLabel}. What does winning look like, and what are the must-haves to get there?`);
                  }}
                  style={{
                    padding: "7px 12px",
                    borderRadius: 7,
                    background: `linear-gradient(180deg, ${palette.goldText} 0%, #B8942A 100%)`,
                    border: `1px solid rgba(${palette.goldRgb},0.55)`,
                    color: "#0C0A09",
                    cursor: "pointer",
                    fontFamily: "var(--app-font-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    boxShadow: `0 0 16px rgba(${palette.goldRgb},0.25)`,
                  }}
                >
                  Get started
                </button>
              )}
              <button
                onClick={() => {
                  setSummaryCollapsed(true);
                  try { localStorage.setItem(mapSeenKey, "1"); } catch {}
                }}
                style={{
                  padding: "7px 12px",
                  borderRadius: 7,
                  background: "transparent",
                  border: `1px solid rgba(255,255,255,0.10)`,
                  color: "rgba(231,229,226,0.7)",
                  cursor: "pointer",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        )
      )}

      {/* No floating pill in the canvas — handover is triggered from the
          CockpitBar navRight (mobile) or the RightPanel tab bar (desktop).
          The popover below still renders inside the canvas when open. */}

      {/* Handover inline confirm popover */}
      {onHandover && handoverOpen && currentSnapshot && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute z-30"
          style={{
            bottom: 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: 320,
            maxWidth: "calc(100% - 24px)",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 12,
            padding: 14,
            boxShadow: palette.panelShadow,
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: "0.14em",
            color: palette.goldText, fontFamily: "var(--app-font-mono)",
            textTransform: "uppercase", marginBottom: 8,
          }}>
            Hand off to Atlas
          </div>
          <div style={{
            fontSize: 10.5, color: palette.fgText,
            marginBottom: 10, lineHeight: 1.5,
          }}>
            Atlas will start a new chat seeded with this Flow snapshot
            ({currentSnapshot.definedCount}/{currentSnapshot.totalCount} defined).
          </div>
          <input
            ref={handoverInputRef}
            value={handoverTitle}
            onChange={(e) => setHandoverTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirmHandover(); }
              if (e.key === "Escape") { e.preventDefault(); setHandoverOpen(false); }
            }}
            placeholder="Session title"
            style={{
              width: "100%",
              background: palette.inputBg,
              border: `1px solid rgba(${palette.goldRgb},0.30)`,
              borderRadius: 7,
              padding: "7px 10px",
              color: palette.fgText,
              fontSize: 11.5,
              fontFamily: "inherit",
              outline: "none",
              marginBottom: 10,
              boxSizing: "border-box",
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setHandoverOpen(false)}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: 7,
                background: "transparent",
                border: `1px solid rgba(${palette.mutedRgb},0.30)`,
                color: palette.fgText,
                fontFamily: "var(--app-font-mono)",
                fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em",
                textTransform: "uppercase", cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={confirmHandover}
              disabled={!!handoverPending}
              style={{
                flex: 2, padding: "7px 10px", borderRadius: 7,
                background: `rgba(${palette.goldRgb},0.20)`,
                border: `1px solid rgba(${palette.goldRgb},0.60)`,
                color: palette.goldText,
                fontFamily: "var(--app-font-mono)",
                fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em",
                textTransform: "uppercase",
                cursor: handoverPending ? "not-allowed" : "pointer",
                opacity: handoverPending ? 0.5 : 1,
              }}
            >
              {handoverPending ? "Handing over…" : "Hand over to Atlas"}
            </button>
          </div>
        </div>
      )}

      {/* Transformable canvas */}
      <div
        ref={canvasRef}
        style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          transformOrigin: "0 0",
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        {/* SVG edges */}
        <svg className="absolute inset-0 h-full w-full" style={{ overflow: "visible" }}>
          <defs>
            <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {edges.map(edge => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const bothResolved = isNodeDefined(fromNode) && isNodeDefined(toNode);
            return (
              <line
                key={edge.id}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke={bothResolved ? palette.edgeGold : palette.edgeDim}
                strokeWidth={bothResolved ? 1 : 0.5}
                strokeLinecap="round"
                opacity={bothResolved ? 0.85 : 0.40}
                filter={bothResolved ? "url(#edge-glow)" : undefined}
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(node => {
          const goalNode = nodes.find(n => n.type === "goal") || nodes[0];
          const goalX = goalNode ? goalNode.x : 300;
          const goalY = goalNode ? goalNode.y : 250;
          return (
            <FlowNodeComponent
              key={node.id}
              node={node}
              onFocus={handleNodeTap}
              onDragStart={startNodeDrag}
              newlyAdded={newlyAddedIds.has(node.id)}
              goalX={goalX}
              goalY={goalY}
              palette={palette}
            />
          );
        })}
      </div>

      {/* Node info card */}
      {activeCardNode && (
        <div
          style={{
            position: "absolute", left: cardLeft, top: cardTop,
            width: CARD_W, zIndex: 50,
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 10, padding: 13,
            boxShadow: palette.panelShadow,
            pointerEvents: "auto",
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => { e.stopPropagation(); setActiveCardNodeId(null); }}
            style={{
              position: "absolute", top: 6, right: 8,
              color: palette.mutedText, background: "none", border: "none",
              cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px",
            }}
          >✕</button>

          {/* Node label + type badge */}
          <div style={{ fontSize: 12, fontWeight: 700, color: palette.goldText, marginBottom: 4, paddingRight: 24 }}>
            {activeCardNode.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: palette.mutedText, fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {activeCardNode.type}
            </span>
            {activeCardMoscow && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                padding: "1px 6px", borderRadius: 4,
                background: activeCardMoscow === "must" ? `rgba(${palette.goldRgb},0.22)`
                  : activeCardMoscow === "should" ? `rgba(${palette.goldRgb},0.10)`
                  : `rgba(${palette.mutedRgb},0.10)`,
                color: activeCardMoscow === "must" ? palette.goldText
                  : activeCardMoscow === "should" ? `rgba(${palette.goldRgb},0.75)`
                  : palette.mutedText,
                border: `1px solid ${activeCardMoscow === "must" ? `rgba(${palette.goldRgb},0.4)`
                  : activeCardMoscow === "should" ? `rgba(${palette.goldRgb},0.22)`
                  : `rgba(${palette.mutedRgb},0.2)`}`,
              }}>
                {activeCardMoscow.toUpperCase()}
              </span>
            )}
          </div>

          {editingDetailsNodeId === activeCardNode.id ? (
            <textarea
              autoFocus
              value={detailsDraft}
              onChange={(e) => setDetailsDraft(e.target.value)}
              onBlur={() => saveDetailsEdit(activeCardNode.id)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelDetailsEdit();
                }
              }}
              style={{
                width: "100%",
                minHeight: 58,
                resize: "vertical",
                borderRadius: 7,
                border: `1px solid rgba(${palette.goldRgb},0.26)`,
                background: palette.inputBg,
                color: palette.fgText,
                fontSize: 11,
                lineHeight: 1.55,
                padding: "7px 8px",
                marginBottom: 10,
                outline: "none",
                fontFamily: "var(--app-font-sans)",
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => startDetailsEdit(activeCardNode)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "text",
                fontSize: 11,
                color: activeCardNode.details ? `rgba(${palette.fgRgb},0.75)` : palette.mutedText,
                lineHeight: 1.6,
                maxHeight: 80,
                overflowY: "auto",
                marginBottom: 10,
                fontStyle: activeCardNode.details ? "normal" : "italic",
              }}
              title="Edit description"
            >
              {activeCardNode.details || "No description yet — tap to add"}
            </button>
          )}

          {/* Strategic pivot question */}
          <div style={{
            fontSize: 11, color: palette.fgText, lineHeight: 1.6,
            fontStyle: "italic", marginBottom: 12,
            paddingBottom: 10,
            borderBottom: `1px solid rgba(${palette.goldRgb},0.10)`,
          }}>
            {getPivotQuestion(activeCardNode)}
          </div>

          {/* Lock In Answer — replaces the legacy Mark resolved toggle */}
          <AnswerCapture
            key={activeCardNode.id}
            node={activeCardNode}
            onLockIn={(answer) => handleLockInAnswer(activeCardNode.id, answer)}
            palette={palette}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          right: 14,
          bottom: 10,
          zIndex: 8,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); tidyLayout(); }}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          title="Tidy layout"
          aria-label="Tidy layout"
          style={{
            padding: "7px 10px",
            borderRadius: 8,
            background: palette.panelBg,
            border: `1px solid rgba(${palette.goldRgb},0.32)`,
            color: palette.goldText,
            cursor: "pointer",
            fontFamily: "var(--app-font-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            boxShadow: palette.panelShadow,
          }}
        >
          Tidy layout
        </button>
      </div>

      {/* Hint — compact (?) icon, expands on hover/tap */}
      <div
        title="Tap node · Pinch to zoom · Double-tap to fit"
        style={{
          position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
          width: 18, height: 18, borderRadius: "50%",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, fontFamily: "var(--app-font-mono)",
          color: theme === "parchment" ? "rgba(146,64,14,0.55)" : "rgba(201,162,76,0.55)",
          border: `1px solid ${theme === "parchment" ? "rgba(146,64,14,0.22)" : "rgba(201,162,76,0.22)"}`,
          background: theme === "parchment" ? "rgba(255,252,245,0.55)" : "rgba(10,10,12,0.45)",
          cursor: "help", zIndex: 6, userSelect: "none",
        }}
      >
        ?
      </div>

      <div style={{
        position: "absolute", bottom: 10, left: 14,
        pointerEvents: "none", zIndex: 5,
        fontSize: 8, letterSpacing: "0.22em",
        fontFamily: "var(--app-font-mono)",
        textTransform: "uppercase",
        color: theme === "parchment" ? "rgba(146,64,14,0.30)" : "rgba(201,162,76,0.28)",
      }}>
        Axiom Flow
      </div>
    </div>
  );
}

// ── Per-spec node visual rules ────────────────────────────────────────────────
interface NodeVisual {
  size: number;
  borderRadius: number | string;
  borderWidth: number;
  borderStyle: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  textDecoration: string;
  shadow: string;
  opacity: number;
  pulse: boolean;
  labelSize: number;
  labelWeight: number;
}

function getNodeVisual(node: ArchNode, palette: FlowPalette): NodeVisual {
  const G = palette.goldRgb;
  const E = palette.emberRgb;
  const D = palette.decisionRgb;
  const F = palette.fgRgb;
  const M = palette.mutedRgb;
  const isParchment = palette.rootBg === "#FAFAF7";
  // In parchment (light) mode, node labels read as "stamped charcoal" rather
  // than amber so they don't blend into the cream canvas. Gold/ember tokens
  // are still used everywhere else (badges, chips, brackets) where they pop.
  const goldText = isParchment ? "#111111" : palette.goldText;
  const emberLabel = isParchment ? "#111111" : palette.emberText;
  const fgSoft = `rgba(${F},0.88)`;
  const fgSofter = `rgba(${F},0.82)`;
  // "defined" = a strategicAnswer is locked in. This is the ONLY signal of a
  // resolved/answered node — `node.resolved` is now strictly derived from the
  // presence of an answer. Defined nodes earn the gold treatment + gold pulse;
  // unanswered kind-set nodes keep the amber pulse; blockers always stay
  // ember-static regardless of answer.
  const defined = isNodeDefined(node);
  const resolved = defined;

  if (node.type === "goal") {
    return {
      size: 72,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: resolved ? `rgba(${G},0.95)` : `rgba(${G},0.65)`,
      bgColor: resolved ? `rgba(${G},0.18)` : `rgba(${G},0.06)`,
      textColor: goldText,
      textDecoration: "none",
      shadow: resolved ? `0 0 36px rgba(${G},0.40), 0 0 14px rgba(${G},0.22)`
        : `0 0 26px rgba(${G},0.20), 0 0 10px rgba(${G},0.12)`,
      opacity: 1,
      pulse: !resolved,
      labelSize: 10,
      labelWeight: 700,
    };
  }

  if (node.type === "requirement") {
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: resolved ? `rgba(${G},0.65)` : `rgba(${G},0.38)`,
      bgColor: resolved ? `rgba(${G},0.14)` : `rgba(${G},0.04)`,
      textColor: resolved ? goldText : fgSoft,
      textDecoration: "none",
      shadow: resolved ? `0 0 12px rgba(${G},0.22)` : "none",
      opacity: 1,
      pulse: !resolved,
      labelSize: 8.5,
      labelWeight: 500,
    };
  }

  if (node.type === "blocker") {
    // Spec: blockers stay ember-static regardless of answer state — they
    // represent an open risk, not a checklist item.
    return {
      size: 56,
      borderRadius: 4,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: `rgba(${E},0.65)`,
      bgColor: `rgba(${E},0.07)`,
      textColor: emberLabel,
      textDecoration: "none",
      shadow: `0 0 10px rgba(${E},0.20)`,
      opacity: 1,
      pulse: false,
      labelSize: 8.5,
      labelWeight: 500,
    };
  }

  if (node.type === "wont") {
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: `rgba(${E},0.38)`,
      bgColor: `rgba(${E},0.06)`,
      textColor: `rgba(${E},0.62)`,
      textDecoration: "line-through",
      shadow: "none",
      opacity: 0.58,
      pulse: false,
      labelSize: 8.5,
      labelWeight: 500,
    };
  }

  if (node.type === "priority") {
    if (node.meta === "wont") {
      return {
        size: 56,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: `rgba(${M},0.22)`,
        bgColor: "transparent",
        textColor: `rgba(${M},0.45)`,
        textDecoration: "line-through",
        shadow: "none",
        opacity: 0.35,
        pulse: false,
        labelSize: 8.5,
        labelWeight: 400,
      };
    }
    if (node.meta === "could") {
      return {
        size: 56,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: resolved ? `rgba(${G},0.40)` : `rgba(${M},0.40)`,
        bgColor: "transparent",
        textColor: resolved ? `rgba(${G},0.65)` : `rgba(${M},0.55)`,
        textDecoration: "none",
        shadow: "none",
        opacity: resolved ? 0.85 : 0.70,
        pulse: !resolved,
        labelSize: 8.5,
        labelWeight: 400,
      };
    }
    if (node.meta === "should") {
      return {
        size: 56,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: "solid",
        borderColor: resolved ? `rgba(${G},0.55)` : `rgba(${G},0.28)`,
        bgColor: resolved ? `rgba(${G},0.12)` : `rgba(${G},0.04)`,
        textColor: resolved ? `rgba(${G},0.85)` : fgSofter,
        textDecoration: "none",
        shadow: "none",
        opacity: 0.65,
        pulse: !resolved,
        labelSize: 8.5,
        labelWeight: 500,
      };
    }
    // must (default)
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: resolved ? `rgba(${G},0.90)` : `rgba(${G},0.55)`,
      bgColor: resolved ? `rgba(${G},0.16)` : `rgba(${G},0.06)`,
      textColor: resolved ? goldText : fgSoft,
      textDecoration: "none",
      shadow: resolved ? `0 0 14px rgba(${G},0.28)` : "none",
      opacity: 1,
      pulse: !resolved,
      labelSize: 8.5,
      labelWeight: 600,
    };
  }

  if (node.type === "decision") {
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: resolved ? `rgba(${D},0.50)` : `rgba(${D},0.70)`,
      bgColor: resolved ? `rgba(${D},0.10)` : `rgba(${D},0.06)`,
      textColor: resolved ? palette.decisionTextResolved : palette.decisionText,
      textDecoration: "none",
      shadow: resolved ? "none" : `0 0 10px rgba(${D},0.18)`,
      opacity: 1,
      pulse: !resolved,
      labelSize: 8.5,
      labelWeight: 500,
    };
  }

  if (node.type === "sprint") {
    return {
      size: 48,
      borderRadius: 20,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: resolved ? `rgba(${G},0.45)` : `rgba(${G},0.22)`,
      bgColor: resolved ? `rgba(${G},0.10)` : `rgba(${G},0.04)`,
      textColor: resolved ? `rgba(${G},0.75)` : `rgba(${M},0.65)`,
      textDecoration: "none",
      shadow: "none",
      opacity: resolved ? 1 : 0.75,
      pulse: !resolved,
      labelSize: 8,
      labelWeight: 500,
    };
  }

  return {
    size: 56, borderRadius: 14, borderWidth: 1.5,
    borderStyle: "solid", borderColor: `rgba(${G},0.45)`,
    bgColor: `rgba(${G},0.06)`,
    textColor: palette.fgText, textDecoration: "none",
    shadow: "none", opacity: 1, pulse: false, labelSize: 8.5, labelWeight: 500,
  };
}

function getMoscow(node: ArchNode): FlowNodeMeta | undefined {
  return node.moscow ?? node.meta ?? (node.type === "wont" ? "wont" : undefined);
}

function MoscowBadge({ value, palette }: { value: FlowNodeMeta; palette: FlowPalette }) {
  const G = palette.goldRgb;
  const E = palette.emberRgb;
  const M = palette.mutedRgb;
  const label = value === "wont" ? "WON'T" : value.toUpperCase();
  const style =
    value === "must"
      ? { background: `rgba(${G},0.82)`, border: `1px solid rgba(${G},0.90)`, color: palette.rootBg }
      : value === "should"
        ? { background: "transparent", border: `1px solid rgba(${G},0.50)`, color: `rgba(${G},0.82)` }
        : value === "could"
          ? { background: `rgba(${M},0.12)`, border: `1px solid rgba(${M},0.22)`, color: `rgba(${M},0.78)` }
          : { background: `rgba(${E},0.10)`, border: `1px solid rgba(${E},0.28)`, color: `rgba(${E},0.72)` };
  return (
    <span style={{
      ...style,
      fontFamily: "var(--app-font-mono)",
      fontSize: 6.5,
      fontWeight: 800,
      letterSpacing: "0.10em",
      borderRadius: 999,
      padding: "1px 4px",
      marginTop: -3,
      lineHeight: 1.4,
    }}>
      {label}
    </span>
  );
}

function FlowNodeComponent({
  node,
  onFocus,
  onDragStart,
  newlyAdded = false,
  goalX = 300,
  goalY = 250,
  palette,
}: {
  node: ArchNode;
  onFocus: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  onDragStart: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  newlyAdded?: boolean;
  goalX?: number;
  goalY?: number;
  palette: FlowPalette;
}) {
  const v = getNodeVisual(node, palette);
  const icon = getNodeIcon(node);
  const defined = isNodeDefined(node);
  const moscow = getMoscow(node);
  const isParchment = palette.rootBg === "#FAFAF7";
  const goldPulseName = isParchment ? "gold-pulse-parchment" : "gold-pulse";
  const amberPulseName = isParchment ? "amber-pulse-parchment" : "amber-pulse";

  // Center-origin fly-in: translate from goal position to node position
  const flyDx = newlyAdded ? `${goalX - node.x}px` : "0px";
  const flyDy = newlyAdded ? `${goalY - node.y}px` : "0px";

  return (
    <button
      onClick={e => onFocus(node.id, e)}
      onMouseDown={e => onDragStart(node.id, e)}
      onTouchStart={e => onDragStart(node.id, e)}
      onTouchEnd={e => { e.preventDefault(); onFocus(node.id, e); }}
      style={{
        position: "absolute",
        left: node.x - v.size / 2,
        top: node.y - v.size / 2,
        background: "none", border: "none", padding: 0, cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
        opacity: v.opacity,
        transition: "opacity 300ms ease",
        // CSS custom properties for the fly-in keyframe
        ["--fly-dx" as string]: flyDx,
        ["--fly-dy" as string]: flyDy,
        animation: newlyAdded ? "node-fly-in 420ms cubic-bezier(0.16, 1, 0.3, 1) forwards" : undefined,
      }}
    >
      <div className={node.type === "wont" || moscow === "wont" ? "flow-node-strike" : undefined} style={{
        width: v.size, height: v.size,
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: v.borderRadius,
        border: `${v.borderWidth}px ${v.borderStyle} ${v.borderColor}`,
        background: v.bgColor,
        boxShadow: v.shadow,
        fontSize: node.type === "goal" ? 24 : 18,
        color: v.textColor,
        transition: "all 300ms ease",
        // Blockers stay ember-static regardless of state — they never pulse.
        animation: node.type === "blocker"
          ? undefined
          : defined
            ? `${goldPulseName} 2.4s ease-in-out infinite`
            : v.pulse ? `${amberPulseName} 2s ease-in-out infinite` : undefined,
      }}>
        {icon}
      </div>
      {moscow && <MoscowBadge value={moscow} palette={palette} />}
      <span
        title={node.label}
        style={{
          fontSize: v.labelSize,
          fontWeight: v.labelWeight,
          color: v.textColor,
          whiteSpace: "normal",
          textDecoration: v.textDecoration,
          maxWidth: 140,
          maxHeight: "2.4em",
          lineHeight: 1.2,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          letterSpacing: node.type === "goal" ? "0.04em" : 0,
        }}
      >
        {node.label}
      </span>
      {defined && (
        <span style={{
          fontSize: 7.5,
          fontWeight: 700,
          letterSpacing: "0.18em",
          color: `rgba(${palette.goldRgb},0.78)`,
          fontFamily: "var(--app-font-mono)",
          textTransform: "uppercase",
          marginTop: -2,
        }}>
          DEFINED
        </span>
      )}
    </button>
  );
}

// ── AnswerCapture: textarea + Lock In Answer button ──────────────────────────
function AnswerCapture({
  node,
  onLockIn,
  palette,
}: {
  node: ArchNode;
  onLockIn: (answer: string) => void;
  palette: FlowPalette;
}) {
  const [draft, setDraft] = useState<string>(node.strategicAnswer ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const defined = isNodeDefined(node);
  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== (node.strategicAnswer ?? "").trim();

  useEffect(() => {
    // Auto-focus the textarea so the user can start typing immediately.
    const t = setTimeout(() => taRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, []);

  const submit = () => { if (canSubmit) onLockIn(draft); };

  return (
    <div>
      {defined && (
        <div style={{
          fontSize: 8.5, fontWeight: 700, letterSpacing: "0.18em",
          color: `rgba(${palette.goldRgb},0.85)`, fontFamily: "var(--app-font-mono)",
          marginBottom: 6,
        }}>
          ◆ DEFINED — EDIT TO REPLACE
        </div>
      )}
      <textarea
        ref={taRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={defined ? "Refine your answer…" : "Type your answer…"}
        rows={3}
        style={{
          width: "100%",
          background: palette.inputBg,
          border: `1px solid rgba(${palette.goldRgb},0.28)`,
          borderRadius: 7,
          padding: "8px 10px",
          color: palette.fgText,
          fontSize: 11.5,
          lineHeight: 1.5,
          fontFamily: "inherit",
          resize: "vertical",
          outline: "none",
          marginBottom: 8,
          boxSizing: "border-box",
        }}
      />
      <button
        onClick={submit}
        disabled={!canSubmit}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: 7,
          background: canSubmit ? `rgba(${palette.goldRgb},0.20)` : `rgba(${palette.mutedRgb},0.08)`,
          border: `1px solid ${canSubmit ? `rgba(${palette.goldRgb},0.55)` : `rgba(${palette.mutedRgb},0.22)`}`,
          color: canSubmit ? palette.goldText : `rgba(${palette.mutedRgb},0.55)`,
          fontSize: 11, fontWeight: 700,
          cursor: canSubmit ? "pointer" : "not-allowed",
          fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em",
          textTransform: "uppercase",
          transition: "background 200ms ease, border-color 200ms ease",
        }}
      >
        ⌘↵ Lock In Answer
      </button>
    </div>
  );
}
