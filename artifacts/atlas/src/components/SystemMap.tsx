import { toast } from "sonner";
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
  auth: "Controls who can access your app and how they prove their identity. Must be defined before anything else.",
  db: "The permanent storage layer. Every piece of data your app remembers lives here in structured tables.",
  api: "The communication layer between your UI and your database. Routes define how data flows in and out.",
  state: "Temporary memory your app holds while a user is active. Manages UI interactions before data is saved.",
  ui: "The visual shell — screens, components, and layouts your users interact with directly.",
  logic: "The rules engine — business logic, calculations, validations, and automated processes.",
};

const NODE_PIVOT_QUESTIONS: Record<string, string> = {
  auth: "Who needs to log in, and how should they verify their identity?",
  db: "What are the main things your app needs to remember permanently?",
  api: "What actions will your app need to perform on that data?",
  state: "What does your app need to remember while a user is actively using it?",
  ui: "What are the primary screens or views your users will navigate between?",
  logic: "What rules or calculations does your app need to enforce automatically?",
};

const SPRINT_LABELS = [
  { sprint: 1, x: 180, y: 60 },
  { sprint: 2, x: 350, y: 250 },
  { sprint: 3, x: 180, y: 390 },
];

const EDGE_FLOW_STYLE = `
@keyframes edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -20; }
}
`;

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_DEFAULT_MOBILE = 0.85;
const ZOOM_DEFAULT_DESKTOP = 1.0;
const TAP_THRESHOLD = 8;
const CANVAS_PADDING = 80;
const STORAGE_KEY = "axiom-system-map-nodes";

type BuilderType = "lovable" | "cursor" | "replit" | null;

const INITIAL_NODES: ArchNode[] = [
  { id: "auth",  label: "Authentication",  type: "auth",     resolved: false, x: 300, y: 80  },
  { id: "db",    label: "Database",         type: "database", resolved: false, x: 150, y: 200 },
  { id: "api",   label: "API Routes",       type: "api",      resolved: false, x: 450, y: 200 },
  { id: "state", label: "State Management", type: "state",    resolved: false, x: 300, y: 320 },
  { id: "ui",    label: "UI Components",    type: "ui",       resolved: false, x: 150, y: 440 },
  { id: "logic", label: "Business Logic",   type: "logic",    resolved: false, x: 450, y: 440 },
];

const INITIAL_EDGES: ArchEdge[] = [
  { id: "e1", from: "auth",  to: "db"    },
  { id: "e2", from: "auth",  to: "api"   },
  { id: "e3", from: "api",   to: "db"    },
  { id: "e4", from: "api",   to: "state" },
  { id: "e5", from: "state", to: "ui"    },
  { id: "e6", from: "state", to: "logic" },
  { id: "e7", from: "logic", to: "api"  },
];

function loadNodes(): ArchNode[] {
  try {
    const r = localStorage.getItem(STORAGE_KEY);
    return r ? JSON.parse(r) : INITIAL_NODES;
  } catch { return INITIAL_NODES; }
}

function detectBuilder(): BuilderType {
  try {
    const host = window.location.hostname;
    if (host.includes("replit") || host.includes("janeway") || host.includes("worf") ||
        host.includes("repl.co") || host.includes("repl.run") ||
        typeof (window as unknown as Record<string, unknown>).__REPLIT__ !== "undefined") return "replit";
    if (host.includes("lovable") || host.includes("lovableproject")) return "lovable";
    if (host.includes("cursor")) return "cursor";
  } catch {}
  return null;
}

interface SystemMapProps {
  onReadinessChange?: (score: number) => void;
  onNodesChange?: (nodes: ArchNode[]) => void;
  compact?: boolean;
  onNodeFocus?: (text: string) => void;
  atmosphere?: string;
  detectedBuilder?: string;
}

export function SystemMap({ onReadinessChange, onNodesChange, compact, onNodeFocus, atmosphere, detectedBuilder: detectedBuilderProp }: SystemMapProps) {
  const isMobile = window.innerWidth < 768;
  const [nodes, setNodes] = useState<ArchNode[]>(loadNodes);
  const edges = INITIAL_EDGES;
  const [zoom, setZoom] = useState(isMobile ? ZOOM_DEFAULT_MOBILE : ZOOM_DEFAULT_DESKTOP);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeCardNodeId, setActiveCardNodeId] = useState<string | null>(null);
  const [builder] = useState<BuilderType>(detectBuilder);

  // Use the prop if provided, otherwise fall back to auto-detected
  const effectiveBuilder: BuilderType = detectedBuilderProp
    ? (detectedBuilderProp.toLowerCase() as BuilderType)
    : builder;

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
    toast("Map Reset", {
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
      setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, resolved: !n.resolved } : n));

      if (activeCardNodeId === nodeId) {
        setActiveCardNodeId(null);
      } else {
        setActiveCardNodeId(nodeId);
        // Inject pivot message into chat — same as original addMessage behavior
        const node = nodes.find(n => n.id === nodeId);
        if (node && onNodeFocus) {
          const pivotText = node.resolved
            ? `Your ${node.label} layer is locked. To modify it, describe what you want to change.`
            : `Let's define your ${node.label}. ${NODE_PIVOT_QUESTIONS[nodeId] || ""}`;
          onNodeFocus(pivotText);
        }
      }
    }
  }, [activeCardNodeId, nodes, onNodeFocus]);

  const builderClass = effectiveBuilder === "lovable" ? "pulse-lovable"
    : effectiveBuilder === "cursor" ? "pulse-cursor"
    : effectiveBuilder === "replit" ? "pulse-replit" : "";

  const strokeWidth = Math.max(1, Math.min(2, 1.5 / zoom));

  const activeCardNode = activeCardNodeId ? nodes.find(n => n.id === activeCardNodeId) : null;
  let cardLeft = 0;
  let cardTop = 0;
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

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden system-map-glow ${builderClass}`}
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

      {/* Header */}
      <div className="absolute left-4 top-4 z-10 flex flex-col gap-1.5">
        <span className="text-xs font-bold tracking-widest text-gold uppercase">SYSTEM MAP</span>
        {effectiveBuilder && (
          <span className="self-start rounded-full border border-gold/30 bg-obsidian-surface px-2 py-0.5 text-[10px] text-gold-muted">
            {effectiveBuilder.toUpperCase()} DETECTED
          </span>
        )}
      </div>

      {/* % READY badge */}
      <div style={{ position: "absolute", right: 14, top: 14, zIndex: 10 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: "oklch(0.60 0.08 85)",
          background: "oklch(0.76 0.12 85 / 8%)",
          border: "0.5px solid oklch(0.76 0.12 85 / 25%)",
          borderRadius: 20, padding: "1px 8px", letterSpacing: "0.06em",
        }}>
          {readinessScore}% READY
        </span>
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
        {/* Sprint ghost labels */}
        {SPRINT_LABELS.map(({ sprint, x, y }) => (
          <div key={sprint} style={{
            position: "absolute", left: x, top: y,
            fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
            color: "oklch(0.76 0.12 85 / 10%)",
            textTransform: "uppercase", pointerEvents: "none", userSelect: "none",
            whiteSpace: "nowrap",
          }}>
            Sprint {sprint}
          </div>
        ))}

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
                stroke={bothResolved ? "oklch(0.76 0.12 85 / 60%)" : "oklch(0.35 0.01 60 / 50%)"}
                strokeWidth={strokeWidth}
                strokeDasharray={bothResolved ? "4 4" : "6 4"}
                style={bothResolved ? { animation: "edge-flow 1.5s linear infinite" } : undefined}
              />
            );
          })}
        </svg>

        {/* Nodes */}
        {nodes.map(node => (
          <NodeComponent key={node.id} node={node} onFocus={handleNodeTap} atmosphere={atmosphere} />
        ))}
      </div>

      {/* Node info card */}
      {activeCardNode && (
        <div
          style={{
            position: "absolute", left: cardLeft, top: cardTop,
            width: CARD_W, zIndex: 50,
            background: "rgba(20, 18, 14, 0.95)",
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

          <div style={{ fontSize: 11, marginBottom: 8, color: activeCardNode.resolved ? "#D4AF37" : "#F59E0B" }}>
            {activeCardNode.resolved ? "✓ Resolved" : "○ Needs Definition"}
          </div>

          <div style={{ fontSize: 11, color: "#9ca3af", lineHeight: 1.5, marginBottom: 8 }}>
            {NODE_DESCRIPTIONS[activeCardNodeId!] || ""}
          </div>

          {activeCardNode.resolved && (
            <div style={{
              fontSize: 12, color: "rgba(229,231,235,0.8)", lineHeight: 1.6,
              maxHeight: 160, overflowY: "auto", marginTop: 8,
              borderTop: "1px solid rgba(212,175,55,0.15)", paddingTop: 8,
            }}>
              {activeCardNode.details || "No details captured yet for this node."}
            </div>
          )}

          {!activeCardNode.resolved && (
            <div style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
              Tap to define this layer in the chat
            </div>
          )}
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

function NodeComponent({
  node,
  onFocus,
  atmosphere: _atmosphere,
}: {
  node: ArchNode;
  onFocus: (id: string, e: React.MouseEvent | React.TouchEvent) => void;
  atmosphere?: string;
}) {
  return (
    <button
      onClick={e => onFocus(node.id, e)}
      onTouchEnd={e => { e.preventDefault(); onFocus(node.id, e); }}
      className={`absolute flex flex-col items-center gap-1 transition-all duration-300 ${
        node.resolved ? "animate-node-resolve" : ""
      }`}
      style={{ left: node.x - 40, top: node.y - 30, background: "none", border: "none", padding: 0, cursor: "pointer" }}
    >
      <div className={`flex h-16 w-16 items-center justify-center rounded-xl border text-lg transition-all ${
        node.resolved
          ? "border-gold bg-gold/15 text-gold shadow-gold"
          : "border-amber-glow/40 bg-obsidian-surface text-amber-glow animate-amber-pulse"
      }`}>
        {NODE_ICONS[node.type] || "●"}
      </div>
      <span className={`text-[10px] font-medium whitespace-nowrap ${
        node.resolved ? "text-gold" : "text-silver-muted"
      }`}>
        {node.label}
      </span>
      <span style={{
        fontSize: 9, lineHeight: 1,
        color: node.resolved ? "#D4AF37" : "#F59E0B",
      }}>
        {node.resolved ? "100%" : node.details ? "50%" : "0%"}
      </span>
    </button>
  );
}
