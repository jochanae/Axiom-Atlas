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
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
}

const NODE_ICONS: Record<string, string> = {
  goal:        "◎",
  requirement: "◈",
  blocker:     "⊗",
  priority:    "◆",
  decision:    "◉",
  sprint:      "△",
};

const NODE_DESCRIPTIONS: Record<string, string> = {
  goal:        "The single north star for this project. Everything flows from here.",
  requirement: "A capability or constraint the project must satisfy. Ranked by MoSCoW priority.",
  blocker:     "Something preventing forward progress. Must be resolved or bypassed.",
  priority:    "A ranked item competing for attention or resources.",
  decision:    "A committed choice that constrains future options. Logged permanently.",
  sprint:      "A bounded work increment with a defined goal and deadline.",
};

const EDGE_FLOW_STYLE = `
@keyframes edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -20; }
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
  { id: "goal-1", label: "The Goal", type: "goal", resolved: false, x: 300, y: 200 },
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

  const dbSyncedRef = useRef(false);
  useEffect(() => {
    if (dbSyncedRef.current || !initialNodeState) return;
    dbSyncedRef.current = true;
    setNodes(prev => prev.map(n => ({
      ...n,
      resolved: initialNodeState[n.id] !== undefined ? initialNodeState[n.id] : n.resolved,
    })));
  }, [initialNodeState]);

  const pendingConsumedRef = useRef(false);
  useEffect(() => {
    if (!pendingNodes || pendingNodes.length === 0 || pendingConsumedRef.current) return;
    pendingConsumedRef.current = true;

    let delay = 0;
    pendingNodes.forEach(newNode => {
      setTimeout(() => {
        setNodes(prev => {
          if (prev.find(n => n.id === newNode.id)) return prev;
          haptics.tap();
          sounds.tap();
          return [...prev, newNode];
        });
        setEdges(prev => {
          const goalNode = nodes[0];
          if (!goalNode) return prev;
          const edgeId = `e-${goalNode.id}-${newNode.id}`;
          if (prev.find(e => e.id === edgeId)) return prev;
          return [...prev, { id: edgeId, from: goalNode.id, to: newNode.id }];
        });
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

  const nonWontNodes = nodes.filter(n => n.meta !== "wont");
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
          const text = node.resolved
            ? `${node.label} is resolved. Describe what you want to change.`
            : node.type === "goal"
              ? `Let's define your goal. What is the single outcome this project must achieve?`
              : node.type === "blocker"
                ? `What's blocking you on "${node.label}"? What would it take to clear it?`
                : `Let's refine "${node.label}". ${NODE_DESCRIPTIONS[node.type] || ""}`;
          onNodeFocus(text);
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
  const CARD_W = 220;
  if (activeCardNode) {
    const nodeScreenX = (activeCardNode.x + pan.x) * zoom;
    const nodeScreenY = (activeCardNode.y + pan.y) * zoom;
    cardLeft = nodeScreenX - CARD_W / 2;
    cardTop = nodeScreenY - 160;
    const containerW = containerRef.current?.offsetWidth ?? 600;
    cardLeft = Math.max(8, Math.min(cardLeft, containerW - CARD_W - 8));
    if (cardTop < 50) cardTop = nodeScreenY + 70;
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
        {nodes.map(node => (
          <FlowNodeComponent key={node.id} node={node} onFocus={handleNodeTap} />
        ))}
      </div>

      {/* Node info card */}
      {activeCardNode && (
        <div
          style={{
            position: "absolute", left: cardLeft, top: cardTop,
            width: CARD_W, zIndex: 50,
            background: "rgba(20, 18, 14, 0.97)",
            border: "1px solid rgba(212, 175, 55, 0.4)",
            borderRadius: 10, padding: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
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

          <div style={{ fontSize: 12, fontWeight: 600, color: "#D4AF37", marginBottom: 4, paddingRight: 20 }}>
            {activeCardNode.label}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "rgba(120,113,108,0.7)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {activeCardNode.type}
            </span>
            {activeCardNode.meta && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                padding: "1px 6px", borderRadius: 4,
                background: activeCardNode.meta === "must" ? "rgba(212,175,55,0.2)"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.10)"
                  : activeCardNode.meta === "could" ? "rgba(120,113,108,0.12)"
                  : "rgba(120,113,108,0.08)",
                color: activeCardNode.meta === "must" ? "#D4AF37"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.7)"
                  : "rgba(120,113,108,0.6)",
                border: `1px solid ${activeCardNode.meta === "must" ? "rgba(212,175,55,0.4)"
                  : activeCardNode.meta === "should" ? "rgba(212,175,55,0.2)"
                  : "rgba(120,113,108,0.2)"}`,
              }}>
                {activeCardNode.meta.toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5, marginBottom: 10 }}>
            {NODE_DESCRIPTIONS[activeCardNode.type] || ""}
          </div>

          {activeCardNode.details && (
            <div style={{
              fontSize: 11, color: "rgba(229,231,235,0.8)", lineHeight: 1.6,
              maxHeight: 100, overflowY: "auto", marginBottom: 10,
              borderTop: "1px solid rgba(212,175,55,0.12)", paddingTop: 8,
            }}>
              {activeCardNode.details}
            </div>
          )}

          <button
            onClick={() => handleToggleResolved(activeCardNode.id)}
            style={{
              width: "100%", padding: "7px 10px", borderRadius: 7,
              background: activeCardNode.resolved ? "rgba(212,175,55,0.12)" : "rgba(212,175,55,0.18)",
              border: `1px solid ${activeCardNode.resolved ? "rgba(212,175,55,0.3)" : "rgba(212,175,55,0.5)"}`,
              color: "#D4AF37", fontSize: 11, fontWeight: 700, cursor: "pointer",
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
        color: "oklch(0.76 0.12 85 / 25%)",
        fontFamily: "var(--app-font-mono)",
      }}>
        TAP NODE · PINCH TO ZOOM · DOUBLE-TAP TO FIT
      </div>
    </div>
  );
}

function getNodeVisualStyle(node: ArchNode): {
  opacity: number;
  borderStyle: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  textDecoration: string;
  shadow: string;
} {
  const isResolved = node.resolved;
  const meta = node.meta;

  if (node.type === "goal") {
    return {
      opacity: 1,
      borderStyle: "solid",
      borderColor: isResolved ? "rgba(212,175,55,0.9)" : "rgba(212,175,55,0.55)",
      bgColor: isResolved ? "rgba(212,175,55,0.18)" : "rgba(212,175,55,0.07)",
      textColor: "#D4AF37",
      textDecoration: "none",
      shadow: isResolved ? "0 0 20px rgba(212,175,55,0.35)" : "0 0 12px rgba(212,175,55,0.15)",
    };
  }

  if (node.type === "blocker") {
    return {
      opacity: isResolved ? 0.55 : 1,
      borderStyle: "solid",
      borderColor: isResolved ? "rgba(120,113,108,0.4)" : "rgba(239,68,68,0.55)",
      bgColor: isResolved ? "rgba(120,113,108,0.08)" : "rgba(239,68,68,0.08)",
      textColor: isResolved ? "rgba(120,113,108,0.7)" : "rgba(239,100,100,0.9)",
      textDecoration: "none",
      shadow: isResolved ? "none" : "0 0 10px rgba(239,68,68,0.2)",
    };
  }

  if (meta === "wont") {
    return {
      opacity: 0.35,
      borderStyle: "solid",
      borderColor: "rgba(120,113,108,0.25)",
      bgColor: "transparent",
      textColor: "rgba(120,113,108,0.5)",
      textDecoration: "line-through",
      shadow: "none",
    };
  }

  if (meta === "could") {
    return {
      opacity: isResolved ? 0.85 : 0.75,
      borderStyle: "dashed",
      borderColor: isResolved ? "rgba(212,175,55,0.45)" : "rgba(120,113,108,0.45)",
      bgColor: "transparent",
      textColor: isResolved ? "rgba(212,175,55,0.75)" : "rgba(120,113,108,0.65)",
      textDecoration: "none",
      shadow: "none",
    };
  }

  if (meta === "should") {
    return {
      opacity: 0.65,
      borderStyle: "solid",
      borderColor: isResolved ? "rgba(212,175,55,0.55)" : "rgba(212,175,55,0.30)",
      bgColor: isResolved ? "rgba(212,175,55,0.12)" : "rgba(212,175,55,0.04)",
      textColor: isResolved ? "rgba(212,175,55,0.85)" : "rgba(231,229,228,0.65)",
      textDecoration: "none",
      shadow: "none",
    };
  }

  return {
    opacity: 1,
    borderStyle: "solid",
    borderColor: isResolved ? "rgba(212,175,55,0.85)" : "rgba(212,175,55,0.45)",
    bgColor: isResolved ? "rgba(212,175,55,0.15)" : "rgba(212,175,55,0.06)",
    textColor: isResolved ? "#D4AF37" : "rgba(231,229,228,0.87)",
    textDecoration: "none",
    shadow: isResolved ? "0 0 14px rgba(212,175,55,0.25)" : "none",
  };
}

function FlowNodeComponent({
  node,
  onFocus,
}: {
  node: ArchNode;
  onFocus: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
}) {
  const visual = getNodeVisualStyle(node);
  const isGoal = node.type === "goal";
  const size = isGoal ? 72 : 60;

  return (
    <button
      onClick={e => onFocus(node.id, e)}
      onTouchEnd={e => { e.preventDefault(); onFocus(node.id, e); }}
      className={`absolute flex flex-col items-center gap-1 transition-all duration-300 ${node.resolved && node.meta !== "wont" ? "animate-node-resolve" : ""}`}
      style={{
        left: node.x - size / 2,
        top: node.y - size / 2 + (isGoal ? 0 : 6),
        background: "none", border: "none", padding: 0, cursor: "pointer",
        opacity: visual.opacity,
      }}
    >
      <div style={{
        width: size, height: size,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: isGoal ? "50%" : 14,
        border: `${isGoal ? 2 : 1.5}px ${visual.borderStyle} ${visual.borderColor}`,
        background: visual.bgColor,
        boxShadow: visual.shadow,
        fontSize: isGoal ? 22 : 18,
        color: visual.textColor,
        transition: "all 300ms ease",
        animation: !node.resolved && node.meta !== "wont" && node.type !== "blocker"
          ? "amber-pulse 2s ease-in-out infinite" : undefined,
      }}>
        {NODE_ICONS[node.type] || "●"}
      </div>
      <span style={{
        fontSize: isGoal ? 11 : 10,
        fontWeight: isGoal ? 700 : 500,
        color: visual.textColor,
        whiteSpace: "nowrap",
        textDecoration: visual.textDecoration,
        maxWidth: 90,
        overflow: "hidden",
        textOverflow: "ellipsis",
        letterSpacing: isGoal ? "0.04em" : 0,
      }}>
        {node.label}
      </span>
    </button>
  );
}
