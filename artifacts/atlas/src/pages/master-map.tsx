import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { haptics } from "@/lib/haptics";

const BASE_URL = (import.meta as any).env?.BASE_URL?.replace?.(/\/$/, "") ?? "";

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.2;
const TAP_THRESHOLD = 8;
const CENTER_X = 300;
const CENTER_Y = 300;
const NEXIUM_R = 52;
const PROJECT_R = 36;
const POLL_INTERVAL = 30_000;

type Project = {
  id: number;
  name: string;
  description?: string | null;
  updatedAt: string;
  isNexus?: boolean;
  entryCount?: number;
  latestEntryAt?: string | null;
};

type Connection = {
  a: number;
  b: number;
  strength: number;
};

function activityLevel(updatedAt: string): number {
  const h = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (h < 24) return 1.0;
  if (h < 72) return 0.65;
  if (h < 168) return 0.35;
  return 0.15;
}

function activityLabel(updatedAt: string): string {
  const h = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (h < 1) return "Active now";
  if (h < 24) return "Active today";
  if (h < 48) return "Yesterday";
  if (h < 168) return `${Math.floor(h / 24)}d ago`;
  return `${Math.floor(h / 168)}w ago`;
}

function isRecentEntry(latestEntryAt?: string | null): boolean {
  if (!latestEntryAt) return false;
  return (Date.now() - new Date(latestEntryAt).getTime()) < 2 * 3_600_000;
}

function projectColor(name: string): string {
  const hue = (name.charCodeAt(0) * 47 + name.length * 13) % 360;
  return `hsl(${hue}, 28%, 24%)`;
}

function projectBorderColor(name: string, alpha = 0.55): string {
  const hue = (name.charCodeAt(0) * 47 + name.length * 13) % 360;
  return `hsla(${hue}, 55%, 55%, ${alpha})`;
}

function projectHue(name: string): number {
  return (name.charCodeAt(0) * 47 + name.length * 13) % 360;
}

function radialPos(index: number, total: number, radius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
  return { x: CENTER_X + radius * Math.cos(angle), y: CENTER_Y + radius * Math.sin(angle) };
}

function orbitRadius(count: number): number {
  if (count <= 4) return 190;
  if (count <= 7) return 210;
  return 230;
}

function buildConnections(projects: Project[]): Connection[] {
  const result: Connection[] = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i];
      const b = projects[j];
      const hasEntries = (a.entryCount ?? 0) > 0 && (b.entryCount ?? 0) > 0;
      const actA = activityLevel(a.updatedAt);
      const actB = activityLevel(b.updatedAt);
      const strength = Math.min(actA, actB);
      if (hasEntries && strength >= 0.3) {
        result.push({ a: i, b: j, strength });
      }
    }
  }
  return result;
}

function neuralPath(ax: number, ay: number, bx: number, by: number): string {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const perp = 38;
  const cpx = mx + (-dy / len) * perp;
  const cpy = my + (dx / len) * perp;
  return `M ${ax} ${ay} Q ${cpx} ${cpy} ${bx} ${by}`;
}

async function fetchProjects(): Promise<{ nexus: Project | null; list: Project[] }> {
  const [nexusRes, listRes] = await Promise.all([
    fetch(`${BASE_URL}/api/projects/nexus`, { credentials: "include" }),
    fetch(`${BASE_URL}/api/projects`, { credentials: "include" }),
  ]);
  const nexus = nexusRes.ok ? await nexusRes.json() : null;
  const list: Project[] = listRes.ok ? await listRes.json() : [];
  return { nexus, list: list.filter(p => !p.isNexus) };
}

export default function MasterMap() {
  const [, setLocation] = useLocation();
  const [nexusProject, setNexusProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [rippleIds, setRippleIds] = useState<Set<number>>(new Set());
  const prevEntryDates = useRef<Map<number, string>>(new Map());

  const isMobile = window.innerWidth < 768;
  const [zoom, setZoom] = useState(isMobile ? 0.82 : 1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({
    dragging: false, startX: 0, startY: 0,
    startPanX: 0, startPanY: 0, moved: false,
    lastTap: 0, lastNodeTapTime: 0,
    pinchStartDist: 0, pinchStartZoom: 1,
  });

  const applyData = useCallback((nexus: Project | null, list: Project[], isInit = false) => {
    setNexusProject(nexus);
    setProjects(list);
    if (isInit) {
      // Seed initial entry dates — no ripple on first load
      const m = new Map<number, string>();
      list.forEach(p => { if (p.latestEntryAt) m.set(p.id, p.latestEntryAt); });
      prevEntryDates.current = m;
    } else {
      // Detect new entries since last poll
      const newRipples: number[] = [];
      list.forEach(p => {
        const prev = prevEntryDates.current.get(p.id);
        if (p.latestEntryAt && (!prev || p.latestEntryAt > prev)) {
          newRipples.push(p.id);
        }
        if (p.latestEntryAt) prevEntryDates.current.set(p.id, p.latestEntryAt);
      });
      if (newRipples.length > 0) {
        setRippleIds(prev => new Set([...prev, ...newRipples]));
        setTimeout(() => {
          setRippleIds(prev => {
            const next = new Set(prev);
            newRipples.forEach(id => next.delete(id));
            return next;
          });
        }, 2400);
      }
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchProjects().then(({ nexus, list }) => {
      applyData(nexus, list, true);
    }).finally(() => setLoading(false));

    const interval = setInterval(() => {
      fetchProjects().then(({ nexus, list }) => applyData(nexus, list, false));
    }, POLL_INTERVAL);

    return () => clearInterval(interval);
  }, [applyData]);

  const fitMap = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setPan({ x: rect.width / 2 / zoom - CENTER_X, y: rect.height / 2 / zoom - CENTER_Y });
  }, [zoom]);

  useEffect(() => { fitMap(); }, []);

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

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const ds = dragState.current;
    if (e.touches.length === 1) {
      ds.dragging = true; ds.startX = e.touches[0].clientX; ds.startY = e.touches[0].clientY;
      ds.startPanX = pan.x; ds.startPanY = pan.y; ds.moved = false;
    } else if (e.touches.length === 2) {
      ds.dragging = false;
      ds.pinchStartDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
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
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, ds.pinchStartZoom * (dist / ds.pinchStartDist))));
    }
  }, [zoom]);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    const ds = dragState.current;
    ds.dragging = false;
    if (e.changedTouches.length === 1 && !ds.moved) {
      const now = Date.now();
      if (now - ds.lastTap < 180) { fitMap(); ds.lastTap = 0; }
      else ds.lastTap = now;
    }
  }, [fitMap]);

  const handleContainerClick = useCallback(() => {
    if (!dragState.current.moved && Date.now() - dragState.current.lastNodeTapTime > 150)
      setFocusedId(null);
  }, []);

  const navigateToProject = useCallback((id: number, openMap = false) => {
    try { if (openMap) sessionStorage.setItem("atlas-open-tab", "map"); } catch {}
    setLocation(`/project/${id}`);
  }, [setLocation]);

  const handleNodeTap = useCallback((id: number, e: React.MouseEvent | React.TouchEvent) => {
    dragState.current.lastNodeTapTime = Date.now();
    e.stopPropagation();
    if (!dragState.current.moved) {
      haptics.tap();
      setFocusedId(prev => prev === id ? null : id);
    }
  }, []);

  const orbit = orbitRadius(projects.length);
  const connections = buildConnections(projects);
  const focusedProject = focusedId !== null ? projects.find(p => p.id === focusedId) : null;

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "var(--atlas-bg, #0C0A09)",
      display: "flex", flexDirection: "column",
      fontFamily: "var(--app-font-sans, sans-serif)",
    }}>
      <style>{STYLES}</style>

      {/* Header */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px 10px",
        borderBottom: "1px solid rgba(201,162,76,0.1)",
        background: "rgba(12,10,9,0.92)", backdropFilter: "blur(8px)",
        zIndex: 20,
      }}>
        <button
          onClick={() => setLocation("/home")}
          style={{
            width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(201,162,76,0.18)",
            background: "rgba(201,162,76,0.06)", display: "flex", alignItems: "center",
            justifyContent: "center", cursor: "pointer", color: "rgba(201,162,76,0.7)", flexShrink: 0,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13L5 8l5-5" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,162,76,0.5)", fontFamily: "var(--app-font-mono)" }}>
            Axiom
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(201,162,76,0.9)", letterSpacing: "0.01em", lineHeight: 1.2 }}>
            Master Map
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {connections.length > 0 && (
            <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.4)", letterSpacing: "0.08em" }}>
              {connections.length} link{connections.length !== 1 ? "s" : ""}
            </div>
          )}
          <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.45)", letterSpacing: "0.08em" }}>
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", touchAction: "none", cursor: "grab" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={handleContainerClick}
      >
        {/* Dot grid */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(201,162,76,0.08) 1px, transparent 0)",
          backgroundSize: "36px 36px",
        }} />

        {/* Transformable canvas */}
        <div style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          transformOrigin: "0 0",
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
        }}>
          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
            <defs>
              <radialGradient id="nexium-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(201,162,76,0.3)" />
                <stop offset="100%" stopColor="rgba(201,162,76,0)" />
              </radialGradient>
            </defs>

            {/* Nexium ambient glow */}
            <circle cx={CENTER_X} cy={CENTER_Y} r={NEXIUM_R + 30}
              fill="url(#nexium-glow)" style={{ animation: "nexium-breathe 3s ease-in-out infinite" }} />

            {/* Orbit ring */}
            <circle cx={CENTER_X} cy={CENTER_Y} r={orbit}
              fill="none" stroke="rgba(201,162,76,0.06)" strokeWidth="1" strokeDasharray="4 8" />

            {/* ── Neural filaments between project pairs ── */}
            {connections.map(({ a, b, strength }) => {
              const posA = radialPos(a, projects.length, orbit);
              const posB = radialPos(b, projects.length, orbit);
              const pA = projects[a];
              const pB = projects[b];
              const hueA = projectHue(pA.name);
              const hueB = projectHue(pB.name);
              const alpha = 0.06 + strength * 0.22;
              const animated = strength > 0.6;
              const d = neuralPath(posA.x, posA.y, posB.x, posB.y);
              return (
                <g key={`${a}-${b}`}>
                  {/* Soft colored glow under the filament */}
                  <path d={d} fill="none"
                    stroke={`hsla(${hueA}, 55%, 55%, ${alpha * 0.5})`}
                    strokeWidth={animated ? 4 : 2.5}
                    strokeLinecap="round"
                  />
                  {/* Main filament */}
                  <path d={d} fill="none"
                    stroke={`hsla(${Math.round((hueA + hueB) / 2)}, 50%, 60%, ${alpha + 0.08})`}
                    strokeWidth={animated ? 1.4 : 0.9}
                    strokeDasharray={animated ? "6 5" : "3 8"}
                    strokeLinecap="round"
                    style={animated ? { animation: "edge-flow 2.5s linear infinite" } : undefined}
                  />
                </g>
              );
            })}

            {/* ── Nexium spokes to each project ── */}
            {projects.map((p, i) => {
              const pos = radialPos(i, projects.length, orbit);
              const act = activityLevel(p.updatedAt);
              const alpha = 0.12 + act * 0.35;
              const dashFlow = act > 0.6;
              return (
                <line key={p.id}
                  x1={CENTER_X} y1={CENTER_Y} x2={pos.x} y2={pos.y}
                  stroke={`rgba(201,162,76,${alpha})`}
                  strokeWidth={dashFlow ? 1.2 : 0.8}
                  strokeDasharray={dashFlow ? "5 5" : "3 7"}
                  style={dashFlow ? { animation: "edge-flow 2s linear infinite" } : undefined}
                />
              );
            })}

            {/* ── Ripple rings for nodes with new entries ── */}
            {projects.map((p, i) => {
              const pos = radialPos(i, projects.length, orbit);
              const showRipple = rippleIds.has(p.id) || isRecentEntry(p.latestEntryAt);
              if (!showRipple) return null;
              return (
                <circle key={`ripple-${p.id}`}
                  cx={pos.x} cy={pos.y} r={PROJECT_R}
                  fill="none"
                  stroke={projectBorderColor(p.name, 0.7)}
                  strokeWidth="1.5"
                  style={{ animation: "node-ripple 2s ease-out infinite" }}
                />
              );
            })}
          </svg>

          {/* Nexium center node */}
          <button
            onClick={e => {
              e.stopPropagation();
              dragState.current.lastNodeTapTime = Date.now();
              if (!dragState.current.moved && nexusProject) {
                haptics.tap();
                navigateToProject(nexusProject.id);
              }
            }}
            style={{
              position: "absolute",
              left: CENTER_X - NEXIUM_R, top: CENTER_Y - NEXIUM_R,
              width: NEXIUM_R * 2, height: NEXIUM_R * 2,
              borderRadius: 18,
              background: "linear-gradient(135deg, rgba(201,162,76,0.18) 0%, rgba(146,64,14,0.22) 100%)",
              border: "1.5px solid rgba(201,162,76,0.7)",
              boxShadow: "0 0 28px -6px rgba(201,162,76,0.5), inset 0 1px 0 rgba(201,162,76,0.2)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 4, cursor: "pointer", animation: "nexium-pulse 2.8s ease-in-out infinite",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(201,162,76,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
              <circle cx="12" cy="4" r="1.2" fill="rgba(201,162,76,0.7)" />
              <circle cx="12" cy="20" r="1.2" fill="rgba(201,162,76,0.7)" />
              <circle cx="4" cy="12" r="1.2" fill="rgba(201,162,76,0.7)" />
              <circle cx="20" cy="12" r="1.2" fill="rgba(201,162,76,0.7)" />
            </svg>
            <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.16em", color: "rgba(201,162,76,0.9)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase" }}>
              Nexium
            </span>
          </button>
          <div style={{
            position: "absolute",
            left: CENTER_X - 40, top: CENTER_Y + NEXIUM_R + 6,
            width: 80, textAlign: "center",
            fontSize: 9.5, color: "rgba(201,162,76,0.45)",
            fontFamily: "var(--app-font-mono)", letterSpacing: "0.06em",
            pointerEvents: "none",
          }}>
            Command Space
          </div>

          {/* Project nodes */}
          {projects.map((p, i) => {
            const pos = radialPos(i, projects.length, orbit);
            const act = activityLevel(p.updatedAt);
            const isFocused = focusedId === p.id;
            const glowAlpha = 0.1 + act * 0.45;
            const borderAlpha = 0.25 + act * 0.55;
            const borderColor = projectBorderColor(p.name, borderAlpha);
            const bg = projectColor(p.name);
            const initials = p.name.slice(0, 2).toUpperCase();
            const hasEntries = (p.entryCount ?? 0) > 0;

            return (
              <g key={p.id}>
                <button
                  onClick={e => handleNodeTap(p.id, e)}
                  onTouchEnd={e => { e.preventDefault(); handleNodeTap(p.id, e); }}
                  style={{
                    position: "absolute",
                    left: pos.x - PROJECT_R, top: pos.y - PROJECT_R,
                    width: PROJECT_R * 2, height: PROJECT_R * 2,
                    borderRadius: 14,
                    background: bg,
                    border: `1.5px solid ${borderColor}`,
                    boxShadow: isFocused
                      ? `0 0 22px -4px ${projectBorderColor(p.name, 0.7)}, 0 0 0 3px ${projectBorderColor(p.name, 0.2)}`
                      : `0 0 ${Math.round(8 + act * 18)}px -4px ${projectBorderColor(p.name, glowAlpha)}`,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 2, cursor: "pointer",
                    transition: "box-shadow 200ms ease, border-color 200ms ease, transform 200ms ease",
                    transform: isFocused ? "scale(1.1)" : "scale(1)",
                    zIndex: isFocused ? 10 : 1,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "rgba(231,229,228,0.85)", fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em" }}>
                    {initials}
                  </span>
                  {hasEntries && (
                    <span style={{ fontSize: 7.5, color: projectBorderColor(p.name, 0.6), fontFamily: "var(--app-font-mono)", letterSpacing: "0.05em" }}>
                      {p.entryCount}
                    </span>
                  )}
                </button>
                <div style={{
                  position: "absolute",
                  left: pos.x - 50, top: pos.y + PROJECT_R + 6,
                  width: 100, textAlign: "center", pointerEvents: "none",
                }}>
                  <div style={{ fontSize: 10.5, fontWeight: 600, color: isFocused ? "rgba(231,229,228,0.9)" : "rgba(231,229,228,0.6)", fontFamily: "var(--app-font-sans)", letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name}
                  </div>
                  <div style={{ fontSize: 8.5, color: act > 0.6 ? "rgba(201,162,76,0.6)" : "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                    {activityLabel(p.updatedAt)}
                  </div>
                </div>
              </g>
            );
          })}

          {/* Empty state */}
          {!loading && projects.length === 0 && (
            <div style={{
              position: "absolute", left: CENTER_X - 100, top: CENTER_Y + 80,
              width: 200, textAlign: "center",
              fontSize: 11, color: "rgba(120,113,108,0.4)",
              fontFamily: "var(--app-font-sans)", lineHeight: 1.5,
            }}>
              No projects yet. Create one from the home screen.
            </div>
          )}
        </div>

        {/* Node action card — screen space */}
        {focusedProject && (() => {
          const idx = projects.findIndex(p => p.id === focusedProject.id);
          const pos = radialPos(idx, projects.length, orbit);
          const screenX = (pos.x + pan.x) * zoom;
          const screenY = (pos.y + pan.y) * zoom;
          const containerW = containerRef.current?.offsetWidth ?? 400;
          const containerH = containerRef.current?.offsetHeight ?? 600;
          const CARD_W = 210;
          const CARD_H = 148;
          let cardLeft = screenX - CARD_W / 2;
          let cardTop = screenY - CARD_H - PROJECT_R * zoom - 12;
          cardLeft = Math.max(8, Math.min(cardLeft, containerW - CARD_W - 8));
          if (cardTop < 8) cardTop = screenY + PROJECT_R * zoom + 12;
          if (cardTop + CARD_H > containerH - 8) cardTop = containerH - CARD_H - 8;

          return (
            <div onClick={e => e.stopPropagation()} style={{
              position: "absolute", left: cardLeft, top: cardTop,
              width: CARD_W, zIndex: 50,
              background: "rgba(20,18,14,0.97)",
              border: `1px solid ${projectBorderColor(focusedProject.name, 0.45)}`,
              borderRadius: 12, padding: "12px 14px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)",
              animation: "card-in 150ms ease both",
            }}>
              <button onClick={() => setFocusedId(null)} style={{
                position: "absolute", top: 7, right: 8,
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(120,113,108,0.5)", fontSize: 13, lineHeight: 1, padding: "2px 4px",
              }}>✕</button>

              <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(231,229,228,0.9)", marginBottom: 1, paddingRight: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {focusedProject.name}
              </div>
              <div style={{ fontSize: 9, color: "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)", marginBottom: 10, display: "flex", gap: 8 }}>
                <span>{activityLabel(focusedProject.updatedAt)}</span>
                {(focusedProject.entryCount ?? 0) > 0 && (
                  <span style={{ color: "rgba(201,162,76,0.45)" }}>· {focusedProject.entryCount} decision{focusedProject.entryCount !== 1 ? "s" : ""}</span>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button onClick={() => navigateToProject(focusedProject.id)} style={{
                  width: "100%", padding: "7px 10px", borderRadius: 7,
                  background: "rgba(201,162,76,0.08)", border: "1px solid rgba(201,162,76,0.25)",
                  color: "rgba(201,162,76,0.9)", fontSize: 11, fontWeight: 600,
                  fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.04em",
                  textAlign: "left", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M8 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V8" /><path d="M10 2h4v4M14 2L8 8" />
                  </svg>
                  Open Workspace
                </button>
                <button onClick={() => navigateToProject(focusedProject.id, true)} style={{
                  width: "100%", padding: "7px 10px", borderRadius: 7,
                  background: "transparent", border: "1px solid rgba(201,162,76,0.12)",
                  color: "rgba(120,113,108,0.7)", fontSize: 11,
                  fontFamily: "var(--app-font-mono)", cursor: "pointer", letterSpacing: "0.04em",
                  textAlign: "left", display: "flex", alignItems: "center", gap: 6,
                }}>
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="1" y="1" width="6" height="6" rx="1.5" /><rect x="9" y="1" width="6" height="6" rx="1.5" />
                    <rect x="1" y="9" width="6" height="6" rx="1.5" /><rect x="9" y="9" width="6" height="6" rx="1.5" />
                  </svg>
                  Open System Map
                </button>
              </div>
            </div>
          );
        })()}

        {/* Loading */}
        {loading && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center",
            justifyContent: "center", pointerEvents: "none",
          }}>
            <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.4)", letterSpacing: "0.1em" }}>
              Loading constellation…
            </div>
          </div>
        )}

        {/* Hint */}
        <div style={{
          position: "absolute", bottom: 12, left: 0, right: 0,
          textAlign: "center", pointerEvents: "none",
          fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase",
          color: "rgba(201,162,76,0.18)", fontFamily: "var(--app-font-mono)",
        }}>
          Tap node · Pinch to zoom · Double-tap to center
        </div>
      </div>
    </div>
  );
}

const STYLES = `
@keyframes nexium-pulse {
  0%, 100% { box-shadow: 0 0 28px -6px rgba(201,162,76,0.5), inset 0 1px 0 rgba(201,162,76,0.2); }
  50%       { box-shadow: 0 0 42px -4px rgba(201,162,76,0.7), inset 0 1px 0 rgba(201,162,76,0.3); }
}
@keyframes nexium-breathe {
  0%, 100% { opacity: 0.6; transform: scale(1); }
  50%       { opacity: 1; transform: scale(1.08); }
}
@keyframes edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -20; }
}
@keyframes node-ripple {
  0%   { r: ${PROJECT_R}; opacity: 0.7; }
  100% { r: ${PROJECT_R * 2.6}; opacity: 0; }
}
@keyframes card-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
