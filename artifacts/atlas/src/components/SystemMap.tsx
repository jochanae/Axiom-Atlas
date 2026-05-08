import { useCallback, useEffect, useRef, useState } from "react";

export interface ArchNode {
  id: string;
  label: string;
  type: "database" | "api" | "auth" | "state" | "logic" | "ui";
  resolved: boolean;
  x: number;
  y: number;
  details?: string;
}

export interface ArchEdge {
  id: string;
  from: string;
  to: string;
}

const NODE_ICONS: Record<string, string> = {
  database: "⬡",
  api: "◈",
  auth: "◉",
  state: "◆",
  logic: "△",
  ui: "□",
};

const NODE_DESCRIPTIONS: Record<string, string> = {
  auth: "Controls who can access your app and how they prove their identity.",
  db: "The permanent storage layer. Every piece of data your app remembers lives here.",
  api: "The communication layer between your UI and your database.",
  state: "Temporary memory your app holds while a user is active.",
  ui: "The visual shell — screens, components, and layouts.",
  logic: "The rules engine — business logic, calculations, validations.",
};

const INITIAL_NODES: ArchNode[] = [
  { id: "auth",  label: "Authentication",   type: "auth",     resolved: false, x: 300, y: 80  },
  { id: "db",    label: "Database",          type: "database", resolved: false, x: 150, y: 200 },
  { id: "api",   label: "API Routes",        type: "api",      resolved: false, x: 450, y: 200 },
  { id: "state", label: "State Management",  type: "state",    resolved: false, x: 300, y: 320 },
  { id: "ui",    label: "UI Components",     type: "ui",       resolved: false, x: 150, y: 440 },
  { id: "logic", label: "Business Logic",    type: "logic",    resolved: false, x: 450, y: 440 },
];

const INITIAL_EDGES: ArchEdge[] = [
  { id: "e1", from: "auth",  to: "db"    },
  { id: "e2", from: "auth",  to: "api"   },
  { id: "e3", from: "api",   to: "db"    },
  { id: "e4", from: "api",   to: "state" },
  { id: "e5", from: "state", to: "ui"    },
  { id: "e6", from: "state", to: "logic" },
  { id: "e7", from: "logic", to: "api"   },
];

const SPRINT_LABELS = [
  { sprint: 1, x: 100, y: 48,  subtitle: "Auth + Data"  },
  { sprint: 2, x: 340, y: 230, subtitle: "API + State"  },
  { sprint: 3, x: 100, y: 380, subtitle: "UI + Logic"   },
];

const EDGE_FLOW_STYLE = `
@keyframes edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -20; }
}
@keyframes amber-pulse-sm {
  0%, 100% { box-shadow: 0 0 8px rgba(212,175,55,0.3); }
  50% { box-shadow: 0 0 20px rgba(212,175,55,0.6); }
}
@keyframes node-resolve {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}
`;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_DEFAULT = 0.9;
const TAP_THRESHOLD = 8;
const CANVAS_PADDING = 80;
const STORAGE_KEY = "axiom-system-map-nodes";

type BuilderType = "lovable" | "cursor" | "replit" | null;

function detectBuilder(): BuilderType {
  try {
    const host = window.location.hostname;
    if (host.includes("replit") || host.includes("janeway") || host.includes("worf") ||
        host.includes("repl.co") || host.includes("repl.run") || host.includes("id.replit") ||
        typeof (window as any).__REPLIT__ !== "undefined") {
      return "replit";
    }
    if (host.includes("lovable") || host.includes("lovableproject")) return "lovable";
    if (host.includes("cursor")) return "cursor";
  } catch {}
  return null;
}

function loadNodes(): ArchNode[] {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : INITIAL_NODES;
  } catch { return INITIAL_NODES; }
}

interface SystemMapProps {
  onReadinessChange?: (score: number) => void;
  onNodesChange?: (nodes: ArchNode[]) => void;
  compact?: boolean;
}

export function SystemMap({ onReadinessChange, onNodesChange, compact }: SystemMapProps) {
  const [nodes, setNodes] = useState<ArchNode[]>(loadNodes);
  const edges = INITIAL_EDGES;
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeCardNodeId, setActiveCardNodeId] = useState<string | null>(null);
  const [builder] = useState<BuilderType>(detectBuilder);

  const containerRef = useRef<HTMLDivElement>(null);

  const readinessScore = Math.round(
    (nodes.filter(n => n.resolved).length / Math.max(nodes.length, 1)) * 100
  );

  useEffect(() => { onReadinessChange?.(readinessScore); }, [readinessScore, onReadinessChange]);

  useEffect(() => {
    onNodesChange?.(nodes);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes)); } catch {}
  }, [nodes, onNodesChange]);

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
    const obs = new ResizeObserver(() => fitMap());
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [fitMap]);

  const dragState = useRef({
    dragging: false, startX: 0, startY: 0,
    startPanX: 0, startPanY: 0, moved: false,
    lastTap: 0, lastNodeTapTime: 0,
    pinchStartDist: 0, pinchStartZoom: 1,
  });

  // Store latest pan/zoom in refs so touch handlers never go stale
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  useEffect(() => { panRef.current = pan; }, [pan]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // Non-passive touchmove listener — must be attached via addEventListener
  // because React synthetic events are passive by default, which prevents
  // e.preventDefault() from stopping browser scroll/zoom during pinch.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: TouchEvent) => {
      if (e.touches.length >= 1) e.preventDefault();
      const ds = dragState.current;
      if (e.touches.length === 1 && ds.dragging) {
        const dx = e.touches[0].clientX - ds.startX;
        const dy = e.touches[0].clientY - ds.startY;
        if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) ds.moved = true;
        const z = zoomRef.current;
        setPan({ x: ds.startPanX + dx / z, y: ds.startPanY + dy / z });
      } else if (e.touches.length === 2 && ds.pinchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, ds.pinchStartZoom * (dist / ds.pinchStartDist))));
      }
    };
    el.addEventListener("touchmove", handler, { passive: false });
    return () => el.removeEventListener("touchmove", handler);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current;
    ds.dragging = true; ds.startX = e.clientX; ds.startY = e.clientY;
    ds.startPanX = pan.x; ds.startPanY = pan.y; ds.moved = false;
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const ds = dragState.current;
    if (!ds.dragging) return;
    const dx = e.clientX - ds.startX, dy = e.clientY - ds.startY;
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) ds.moved = true;
    setPan({ x: ds.startPanX + dx / zoom, y: ds.startPanY + dy / zoom });
  }, [zoom]);

  const onMouseUp = useCallback(() => { dragState.current.dragging = false; }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom(z => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z - e.deltaY * 0.001)));
  }, []);

  const onDoubleClick = useCallback(() => { fitMap(); }, [fitMap]);

  const onContainerClick = useCallback(() => {
    if (!dragState.current.moved && Date.now() - dragState.current.lastNodeTapTime > 150) {
      setActiveCardNodeId(null);
    }
  }, []);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const ds = dragState.current;
    if (e.touches.length === 1) {
      ds.dragging = true;
      ds.startX = e.touches[0].clientX; ds.startY = e.touches[0].clientY;
      ds.startPanX = panRef.current.x; ds.startPanY = panRef.current.y; ds.moved = false;
    } else if (e.touches.length === 2) {
      ds.dragging = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      ds.pinchStartDist = Math.hypot(dx, dy);
      ds.pinchStartZoom = zoomRef.current;
    }
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const ds = dragState.current;
    ds.dragging = false;
    if (e.changedTouches.length === 1 && !ds.moved) {
      const now = Date.now();
      if (now - ds.lastTap < 300) { fitMap(); ds.lastTap = 0; }
      else ds.lastTap = now;
    }
  }, [fitMap]);

  const handleNodeTap = useCallback((nodeId: string, e: React.MouseEvent | React.TouchEvent) => {
    dragState.current.lastNodeTapTime = Date.now();
    dragState.current.dragging = false;
    if (!dragState.current.moved) {
      e.stopPropagation();
      if (activeCardNodeId === nodeId) {
        setActiveCardNodeId(null);
      } else {
        setActiveCardNodeId(nodeId);
      }
    }
  }, [activeCardNodeId]);

  const toggleNodeResolved = (nodeId: string) => {
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, resolved: !n.resolved } : n));
  };

  const strokeWidth = Math.max(1, Math.min(2, 1.5 / zoom));

  const activeCardNode = activeCardNodeId ? nodes.find(n => n.id === activeCardNodeId) : null;
  let cardLeft = 0, cardTop = 0;
  const CARD_W = 220;
  if (activeCardNode) {
    const nodeScreenX = (activeCardNode.x + pan.x) * zoom;
    const nodeScreenY = (activeCardNode.y + pan.y) * zoom;
    cardLeft = nodeScreenX - CARD_W / 2;
    cardTop = nodeScreenY - 150;
    const containerW = containerRef.current?.offsetWidth ?? 600;
    cardLeft = Math.max(8, Math.min(cardLeft, containerW - CARD_W - 8));
    if (cardTop < 50) cardTop = nodeScreenY + 70;
  }

  const builderClass = builder === "lovable" ? "pulse-lovable"
    : builder === "cursor" ? "pulse-cursor"
    : builder === "replit" ? "pulse-replit"
    : "";

  return (
    <div
      ref={containerRef}
      className={`system-map-glow${builderClass ? ` ${builderClass}` : ""}`}
      style={{
        position: "relative", height: "100%", width: "100%",
        overflow: "hidden", borderRadius: compact ? 0 : 8,
        touchAction: "none",
        cursor: dragState.current.dragging ? "grabbing" : "grab",
        transition: "box-shadow 1s ease",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onClick={onContainerClick}
    >
      <style>{EDGE_FLOW_STYLE}</style>

      {/* Dot grid background */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle at 1px 1px, rgba(212,175,55,0.15) 1px, transparent 0)",
        backgroundSize: "40px 40px",
      }} />

      {/* SYSTEM MAP label — left */}
      <div style={{ position: "absolute", left: 14, top: 14, zIndex: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#D4AF37", letterSpacing: "0.1em" }}>
          SYSTEM MAP
        </span>
      </div>

      {/* % READY badge — top-right */}
      <div style={{ position: "absolute", right: 14, top: 14, zIndex: 10, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: "rgba(212,175,55,0.7)",
          background: "rgba(212,175,55,0.08)", border: "0.5px solid rgba(212,175,55,0.25)",
          borderRadius: 20, padding: "1px 8px", letterSpacing: "0.06em",
        }}>
          {readinessScore}% READY
        </span>
      </div>

      {/* Transformable canvas */}
      <div style={{
        position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
        transformOrigin: "0 0",
        transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
      }}>
        {/* Sprint cluster labels */}
        {SPRINT_LABELS.map(({ sprint, x, y, subtitle }) => (
          <div key={sprint} style={{
            position: "absolute", left: x, top: y,
            pointerEvents: "none", userSelect: "none",
            display: "flex", flexDirection: "column", gap: 2,
          }}>
            <span style={{
              fontSize: 8.5, fontWeight: 700, letterSpacing: "0.14em",
              color: "rgba(212,175,55,0.16)", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              Sprint {sprint}
            </span>
            <span style={{
              fontSize: 7.5, fontWeight: 500, letterSpacing: "0.09em",
              color: "rgba(212,175,55,0.09)", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}>
              {subtitle}
            </span>
          </div>
        ))}

        {/* SVG edges */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
          {edges.map(edge => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const both = fromNode.resolved && toNode.resolved;
            return (
              <line key={edge.id}
                x1={fromNode.x} y1={fromNode.y}
                x2={toNode.x} y2={toNode.y}
                stroke={both ? "rgba(212,175,55,0.6)" : "rgba(120,113,108,0.35)"}
                strokeWidth={strokeWidth}
                strokeDasharray={both ? "4 4" : "6 4"}
                style={both ? { animation: "edge-flow 1.5s linear infinite" } : undefined}
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(node => (
          <NodeComp key={node.id} node={node} onFocus={handleNodeTap} />
        ))}
      </div>

      {/* Node info card */}
      {activeCardNode && (
        <div
          style={{
            position: "absolute", left: cardLeft, top: cardTop,
            width: CARD_W, zIndex: 50,
            background: "rgba(20,18,14,0.97)",
            border: "1px solid rgba(212,175,55,0.4)",
            borderRadius: 10, padding: 12,
            boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={e => { e.stopPropagation(); setActiveCardNodeId(null); }}
            style={{
              position: "absolute", top: 6, right: 8,
              color: "#6b7280", background: "none", border: "none",
              cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 4px",
            }}
          >
            ✕
          </button>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#D4AF37", marginBottom: 4, paddingRight: 20 }}>
            {activeCardNode.label}
          </div>
          <div style={{ fontSize: 11, marginBottom: 8, color: activeCardNode.resolved ? "#D4AF37" : "#F59E0B" }}>
            {activeCardNode.resolved ? "✓ Resolved" : "○ Needs Definition"}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5, marginBottom: 10 }}>
            {NODE_DESCRIPTIONS[activeCardNodeId!] || ""}
          </div>
          <button
            onClick={e => { e.stopPropagation(); toggleNodeResolved(activeCardNode.id); setActiveCardNodeId(null); }}
            style={{
              width: "100%", background: activeCardNode.resolved ? "transparent" : "#D4AF37",
              border: activeCardNode.resolved ? "1px solid rgba(212,175,55,0.4)" : "none",
              borderRadius: 6, padding: "7px 0", fontSize: 11,
              fontWeight: 700, color: activeCardNode.resolved ? "#D4AF37" : "#0D0B09",
              cursor: "pointer",
            }}
          >
            {activeCardNode.resolved ? "Mark Unresolved" : "Mark Resolved"}
          </button>
        </div>
      )}

      {/* Hint */}
      <div style={{
        position: "absolute", right: 12, bottom: 10,
        fontSize: 9, color: "rgba(212,175,55,0.25)", letterSpacing: "0.06em",
        pointerEvents: "none",
      }}>
        TAP NODE · PINCH TO ZOOM · DOUBLE-TAP TO FIT
      </div>
    </div>
  );
}

function NodeComp({
  node,
  onFocus,
}: {
  node: ArchNode;
  onFocus: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
}) {
  return (
    <button
      onClick={e => onFocus(node.id, e)}
      onTouchEnd={e => { e.preventDefault(); onFocus(node.id, e); }}
      style={{
        position: "absolute",
        left: node.x - 40, top: node.y - 30,
        display: "flex", flexDirection: "column", alignItems: "center",
        gap: 4, background: "none", border: "none", cursor: "pointer",
        transition: "all 300ms",
        animation: node.resolved ? "node-resolve 0.4s ease-out" : "none",
      }}
    >
      <div style={{
        width: 64, height: 64, display: "flex", alignItems: "center",
        justifyContent: "center", borderRadius: 12, fontSize: 20,
        transition: "all 300ms",
        background: node.resolved ? "rgba(212,175,55,0.15)" : "rgba(37,34,32,1)",
        border: node.resolved ? "1px solid rgba(212,175,55,0.7)" : "1px solid rgba(245,158,11,0.35)",
        color: node.resolved ? "#D4AF37" : "#F59E0B",
        boxShadow: node.resolved ? "0 0 16px rgba(212,175,55,0.2)" : "0 0 8px rgba(245,158,11,0.25)",
        animation: node.resolved ? "none" : "amber-pulse-sm 2s ease-in-out infinite",
      }}>
        {NODE_ICONS[node.type] || "●"}
      </div>
      <span style={{
        fontSize: 10, fontWeight: 500, whiteSpace: "nowrap",
        color: node.resolved ? "#D4AF37" : "rgba(200,195,190,0.85)",
      }}>
        {node.label}
      </span>
      <span style={{
        fontSize: 9, color: node.resolved ? "#D4AF37" : "#F59E0B", lineHeight: 1,
      }}>
        {node.resolved ? "100%" : "0%"}
      </span>
    </button>
  );
}
