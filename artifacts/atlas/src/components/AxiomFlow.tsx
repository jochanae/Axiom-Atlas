import { toast } from "sonner";
import { useCallback, useEffect, useRef, useState } from "react";
import { haptics } from "@/lib/haptics";
import { sounds } from "@/lib/sounds";

export type FlowNodeMeta = "must" | "should" | "could" | "wont";

export interface ArchNode {
  id: string;
  label: string;
  type: "goal" | "requirement" | "blocker" | "priority" | "decision" | "sprint";
  resolved: boolean;
  x: number;
  y: number;
  details?: string;
  meta?: FlowNodeMeta;
  question?: string;
}

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
`;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_DEFAULT_MOBILE = 0.85;
const ZOOM_DEFAULT_DESKTOP = 1.0;
const TAP_THRESHOLD = 8;
const CANVAS_PADDING = 80;
const BASE_STORAGE_KEY = "axiom-flow-nodes";

const INITIAL_NODES: ArchNode[] = [
  {
    id: "goal",
    label: "The Goal",
    type: "goal",
    resolved: false,
    x: 300,
    y: 250,
    details: "What does winning look like for this project?",
  },
];

const INITIAL_EDGES: ArchEdge[] = [];

function loadNodes(key: string): ArchNode[] {
  try {
    const r = localStorage.getItem(key);
    if (!r) return INITIAL_NODES;
    const parsed = JSON.parse(r) as ArchNode[];
    if (!Array.isArray(parsed) || parsed.length === 0) return INITIAL_NODES;
    return parsed;
  } catch { return INITIAL_NODES; }
}

function loadEdges(key: string): ArchEdge[] {
  try {
    const r = localStorage.getItem(`${key}-edges`);
    return r ? JSON.parse(r) : INITIAL_EDGES;
  } catch { return INITIAL_EDGES; }
}

interface AxiomFlowProps {
  projectId?: number;
  onReadinessChange?: (score: number) => void;
  onNodesChange?: (nodes: ArchNode[]) => void;
  compact?: boolean;
  onNodeFocus?: (text: string) => void;
  atmosphere?: string;
  detectedBuilder?: string;
  initialNodeState?: Record<string, boolean> | null;
  pendingNodes?: ArchNode[];
  onPendingConsumed?: () => void;
}

export function AxiomFlow({
  projectId,
  onReadinessChange,
  onNodesChange,
  compact,
  onNodeFocus,
  initialNodeState,
  detectedBuilder: _detectedBuilder,
  pendingNodes,
  onPendingConsumed,
}: AxiomFlowProps) {
  const storageKey = `${BASE_STORAGE_KEY}${projectId ? `-${projectId}` : ""}`;
  const isMobile = window.innerWidth < 768;
  const [nodes, setNodes] = useState<ArchNode[]>(() => loadNodes(storageKey));
  const [edges, setEdges] = useState<ArchEdge[]>(() => loadEdges(storageKey));

  // Sync resolved states from DB on first load
  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current || !initialNodeState) return;
    dbSyncedRef.current = true;
    setNodes(prev => prev.map(n => ({
      ...n,
      resolved: initialNodeState[n.id] !== undefined ? initialNodeState[n.id] : n.resolved,
    })));
  }, [initialNodeState]);

  // Track newly-added node IDs for fly-in animation
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());

  // Merge pending nodes from Forge with 60ms stagger + center-origin fly-in
  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (!pendingNodes || pendingNodes.length === 0 || pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;

    let delay = 0;
    const goalNode = nodes.find(n => n.type === "goal") || nodes[0];

    pendingNodes.forEach(newNode => {
      setTimeout(() => {
        setNodes(prev => {
          if (prev.find(n => n.id === newNode.id)) return prev;
          haptics.tap();
          sounds.tap();
          return [...prev, newNode];
        });
        // Mark as newly-added for fly-in animation, clear after 650ms
        setNewlyAddedIds(prev => new Set([...prev, newNode.id]));
        setTimeout(() => {
          setNewlyAddedIds(prev => {
            const next = new Set(prev);
            next.delete(newNode.id);
            return next;
          });
        }, 650);
        if (goalNode) {
          setEdges(prev => {
            const edgeId = `e-${goalNode.id}-${newNode.id}`;
            if (prev.find(e => e.id === edgeId)) return prev;
            return [...prev, { id: edgeId, from: goalNode.id, to: newNode.id }];
          });
        }
      }, delay);
      delay += 60;
    });

    setTimeout(() => {
      pendingConsumedRef.current = false;
      onPendingConsumed?.();
    }, delay + 100);
  }, [pendingNodes, onPendingConsumed, nodes]);

  const [zoom, setZoom] = useState(isMobile ? ZOOM_DEFAULT_MOBILE : ZOOM_DEFAULT_DESKTOP);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeCardNodeId, setActiveCardNodeId] = useState<string | null>(null);

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

  // Readiness: exclude wont-priority nodes from both numerator and denominator
  const nonWontNodes = nodes.filter(n => !(n.type === "priority" && n.meta === "wont"));
  const readinessScore = Math.round(
    (nonWontNodes.filter(n => n.resolved).length / Math.max(nonWontNodes.length, 1)) * 100
  );

  useEffect(() => { onReadinessChange?.(readinessScore); }, [readinessScore, onReadinessChange]);

  useEffect(() => {
    onNodesChange?.(nodes);
    try { localStorage.setItem(storageKey, JSON.stringify(nodes)); } catch {}
  }, [nodes, onNodesChange, storageKey]);

  useEffect(() => {
    try { localStorage.setItem(`${storageKey}-edges`, JSON.stringify(edges)); } catch {}
  }, [edges, storageKey]);

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
    const ds = dragState.current;
    if (!ds.dragging) return;
    const dx = e.clientX - ds.startX;
    const dy = e.clientY - ds.startY;
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) ds.moved = true;
    setPan({ x: ds.startPanX + dx / zoom, y: ds.startPanY + dy / zoom });
  }, [zoom]);

  const onMouseUp = useCallback(() => { dragState.current.dragging = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z - e.deltaY * 0.001)));
  }, []);

  const resetView = useCallback(() => {
    fitMap();
    toast("View Reset", {
      duration: 1000,
      style: { color: "#D4AF37", background: "oklch(0.15 0.01 60)", border: "1px solid oklch(0.76 0.12 85 / 30%)" },
    });
  }, [fitMap]);

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
  }, [zoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
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
  }, [resetView]);

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
        if (node && onNodeFocus) {
          onNodeFocus(getPivotQuestion(node));
        }
      }
    }
  }, [activeCardNodeId, nodes, onNodeFocus]);

  const handleToggleResolved = useCallback((nodeId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      const next = { ...n, resolved: !n.resolved };
      if (next.resolved) { haptics.nodeResolved(); sounds.nodeResolved(); }
      return next;
    }));
    setActiveCardNodeId(null);
  }, []);

  const strokeWidth = Math.max(1, Math.min(2, 1.5 / zoom));

  const activeCardNode = activeCardNodeId ? nodes.find(n => n.id === activeCardNodeId) : null;
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
        backgroundImage: `radial-gradient(circle at 1px 1px, oklch(0.30 0.01 60 / 30%) 1px, transparent 0)`,
        backgroundSize: "40px 40px",
      }} />

      {/* Header label */}
      <div className="absolute left-4 top-4 z-10">
        <span className="text-xs font-bold tracking-widest text-gold uppercase">AXIOM FLOW</span>
      </div>

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
          {edges.map(edge => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const bothResolved = fromNode.resolved && toNode.resolved;
            return (
              <line
                key={edge.id}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke={bothResolved ? "rgba(212,175,55,0.6)" : "oklch(0.35 0.01 60 / 50%)"}
                strokeWidth={bothResolved ? strokeWidth + 0.5 : strokeWidth}
                strokeDasharray={bothResolved ? "4 4" : "6 4"}
                style={bothResolved ? { animation: "edge-flow 1.5s linear infinite" } : undefined}
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
              newlyAdded={newlyAddedIds.has(node.id)}
              goalX={goalX}
              goalY={goalY}
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
            background: "rgba(20, 18, 14, 0.97)",
            border: "1px solid rgba(212, 175, 55, 0.38)",
            borderRadius: 10, padding: 13,
            boxShadow: "0 4px 24px rgba(0,0,0,0.65)",
            pointerEvents: "auto",
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => { e.stopPropagation(); setActiveCardNodeId(null); }}
            style={{
              position: "absolute", top: 6, right: 8,
              color: "#9ca3af", background: "none", border: "none",
              cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px",
            }}
          >✕</button>

          {/* Node label + type badge */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#D4AF37", marginBottom: 4, paddingRight: 24 }}>
            {activeCardNode.label}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 9, color: "rgba(120,113,108,0.7)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {activeCardNode.type}
            </span>
            {activeCardNode.meta && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                padding: "1px 6px", borderRadius: 4,
                background: activeCardNode.meta === "must" ? "rgba(212,175,55,0.22)"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.10)"
                  : "rgba(120,113,108,0.10)",
                color: activeCardNode.meta === "must" ? "#D4AF37"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.75)"
                  : "rgba(120,113,108,0.6)",
                border: `1px solid ${activeCardNode.meta === "must" ? "rgba(212,175,55,0.4)"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.22)"
                  : "rgba(120,113,108,0.2)"}`,
              }}>
                {activeCardNode.meta.toUpperCase()}
              </span>
            )}
          </div>

          {/* Strategic pivot question */}
          <div style={{
            fontSize: 11, color: "rgba(231,229,228,0.72)", lineHeight: 1.6,
            fontStyle: "italic", marginBottom: 12,
            paddingBottom: 10,
            borderBottom: "1px solid rgba(212,175,55,0.10)",
          }}>
            {getPivotQuestion(activeCardNode)}
          </div>

          {/* Details if present */}
          {activeCardNode.details && (
            <div style={{
              fontSize: 11, color: "rgba(229,231,235,0.75)", lineHeight: 1.6,
              maxHeight: 80, overflowY: "auto", marginBottom: 10,
            }}>
              {activeCardNode.details}
            </div>
          )}

          {/* Resolved toggle */}
          <button
            onClick={() => handleToggleResolved(activeCardNode.id)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: 7,
              background: activeCardNode.resolved ? "rgba(120,113,108,0.10)" : "rgba(212,175,55,0.16)",
              border: `1px solid ${activeCardNode.resolved ? "rgba(120,113,108,0.28)" : "rgba(212,175,55,0.45)"}`,
              color: activeCardNode.resolved ? "rgba(120,113,108,0.65)" : "#D4AF37",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
            }}
          >
            {activeCardNode.resolved ? "○ Mark unresolved" : "✓ Mark resolved"}
          </button>
        </div>
      )}

      {/* Hint */}
      <div style={{
        position: "absolute", bottom: 10, left: 0, right: 0,
        textAlign: "center", pointerEvents: "none",
        fontSize: 9, letterSpacing: "0.15em",
        color: "oklch(0.76 0.12 85 / 22%)",
        fontFamily: "var(--app-font-mono)",
      }}>
        TAP NODE · PINCH TO ZOOM · DOUBLE-TAP TO FIT
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

function getNodeVisual(node: ArchNode): NodeVisual {
  const resolved = node.resolved;

  if (node.type === "goal") {
    return {
      size: 72,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(212,175,55,0.95)" : "rgba(212,175,55,0.65)",
      bgColor: resolved ? "rgba(212,175,55,0.18)" : "rgba(212,175,55,0.06)",
      textColor: "#D4AF37",
      textDecoration: "none",
      shadow: resolved ? "0 0 24px rgba(212,175,55,0.45), 0 0 8px rgba(212,175,55,0.25)"
        : "0 0 14px rgba(212,175,55,0.22)",
      opacity: 1,
      pulse: !resolved,
      labelSize: 11,
      labelWeight: 700,
    };
  }

  if (node.type === "requirement") {
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(212,175,55,0.65)" : "rgba(212,175,55,0.38)",
      bgColor: resolved ? "rgba(212,175,55,0.14)" : "rgba(212,175,55,0.04)",
      textColor: resolved ? "#D4AF37" : "rgba(231,229,228,0.80)",
      textDecoration: "none",
      shadow: resolved ? "0 0 12px rgba(212,175,55,0.22)" : "none",
      opacity: 1,
      pulse: !resolved,
      labelSize: 9.5,
      labelWeight: 500,
    };
  }

  if (node.type === "blocker") {
    return {
      size: 56,
      borderRadius: 4,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(120,113,108,0.35)" : "rgba(239,100,60,0.65)",
      bgColor: resolved ? "rgba(120,113,108,0.06)" : "rgba(239,100,60,0.07)",
      textColor: resolved ? "rgba(120,113,108,0.60)" : "rgba(239,120,80,0.90)",
      textDecoration: "none",
      shadow: resolved ? "none" : "0 0 10px rgba(239,100,60,0.20)",
      opacity: resolved ? 0.6 : 1,
      pulse: false,
      labelSize: 9.5,
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
        borderColor: "rgba(120,113,108,0.22)",
        bgColor: "transparent",
        textColor: "rgba(120,113,108,0.45)",
        textDecoration: "line-through",
        shadow: "none",
        opacity: 0.35,
        pulse: false,
        labelSize: 9.5,
        labelWeight: 400,
      };
    }
    if (node.meta === "could") {
      return {
        size: 56,
        borderRadius: 14,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: resolved ? "rgba(212,175,55,0.40)" : "rgba(120,113,108,0.40)",
        bgColor: "transparent",
        textColor: resolved ? "rgba(212,175,55,0.65)" : "rgba(120,113,108,0.55)",
        textDecoration: "none",
        shadow: "none",
        opacity: resolved ? 0.85 : 0.70,
        pulse: false,
        labelSize: 9.5,
        labelWeight: 400,
      };
    }
    if (node.meta === "should") {
      return {
        size: 56,
        borderRadius: 14,
        borderWidth: 1.5,
        borderStyle: "solid",
        borderColor: resolved ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.28)",
        bgColor: resolved ? "rgba(212,175,55,0.12)" : "rgba(212,175,55,0.04)",
        textColor: resolved ? "rgba(212,175,55,0.85)" : "rgba(231,229,228,0.60)",
        textDecoration: "none",
        shadow: "none",
        opacity: 0.65,
        pulse: false,
        labelSize: 9.5,
        labelWeight: 500,
      };
    }
    // must (default)
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(212,175,55,0.90)" : "rgba(212,175,55,0.55)",
      bgColor: resolved ? "rgba(212,175,55,0.16)" : "rgba(212,175,55,0.06)",
      textColor: resolved ? "#D4AF37" : "rgba(231,229,228,0.87)",
      textDecoration: "none",
      shadow: resolved ? "0 0 14px rgba(212,175,55,0.28)" : "none",
      opacity: 1,
      pulse: !resolved,
      labelSize: 9.5,
      labelWeight: 600,
    };
  }

  if (node.type === "decision") {
    return {
      size: 56,
      borderRadius: 14,
      borderWidth: 1.5,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(196,82,26,0.50)" : "rgba(196,82,26,0.70)",
      bgColor: resolved ? "rgba(196,82,26,0.10)" : "rgba(196,82,26,0.06)",
      textColor: resolved ? "rgba(196,82,26,0.75)" : "rgba(230,130,80,0.90)",
      textDecoration: "none",
      shadow: resolved ? "none" : "0 0 10px rgba(196,82,26,0.18)",
      opacity: 1,
      pulse: false,
      labelSize: 9.5,
      labelWeight: 500,
    };
  }

  if (node.type === "sprint") {
    return {
      size: 48,
      borderRadius: 20,
      borderWidth: 1,
      borderStyle: "solid",
      borderColor: resolved ? "rgba(212,175,55,0.45)" : "rgba(212,175,55,0.22)",
      bgColor: resolved ? "rgba(212,175,55,0.10)" : "rgba(212,175,55,0.04)",
      textColor: resolved ? "rgba(212,175,55,0.75)" : "rgba(120,113,108,0.65)",
      textDecoration: "none",
      shadow: "none",
      opacity: resolved ? 1 : 0.75,
      pulse: false,
      labelSize: 9,
      labelWeight: 500,
    };
  }

  return {
    size: 56, borderRadius: 14, borderWidth: 1.5,
    borderStyle: "solid", borderColor: "rgba(212,175,55,0.45)",
    bgColor: "rgba(212,175,55,0.06)",
    textColor: "rgba(231,229,228,0.87)", textDecoration: "none",
    shadow: "none", opacity: 1, pulse: false, labelSize: 9.5, labelWeight: 500,
  };
}

function FlowNodeComponent({
  node,
  onFocus,
  newlyAdded = false,
  goalX = 300,
  goalY = 250,
}: {
  node: ArchNode;
  onFocus: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  newlyAdded?: boolean;
  goalX?: number;
  goalY?: number;
}) {
  const v = getNodeVisual(node);
  const icon = getNodeIcon(node);

  // Center-origin fly-in: translate from goal position to node position
  const flyDx = newlyAdded ? `${goalX - node.x}px` : "0px";
  const flyDy = newlyAdded ? `${goalY - node.y}px` : "0px";

  return (
    <button
      onClick={e => onFocus(node.id, e)}
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
      <div style={{
        width: v.size, height: v.size,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: v.borderRadius,
        border: `${v.borderWidth}px ${v.borderStyle} ${v.borderColor}`,
        background: v.bgColor,
        boxShadow: v.shadow,
        fontSize: node.type === "goal" ? 24 : 18,
        color: v.textColor,
        transition: "all 300ms ease",
        animation: v.pulse ? "amber-pulse 2s ease-in-out infinite" : undefined,
      }}>
        {icon}
      </div>
      <span style={{
        fontSize: v.labelSize,
        fontWeight: v.labelWeight,
        color: v.textColor,
        whiteSpace: "nowrap",
        textDecoration: v.textDecoration,
        maxWidth: 88,
        overflow: "hidden",
        textOverflow: "ellipsis",
        letterSpacing: node.type === "goal" ? "0.04em" : 0,
      }}>
        {node.label}
      </span>
    </button>
  );
}
