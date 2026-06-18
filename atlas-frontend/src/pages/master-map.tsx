import { useEffect, useMemo, useRef, useState } from "react";
import { useEntryReferrer } from "@/hooks/useEntryReferrer";
import { useLocation } from "wouter";
import * as THREE from "three";
import { haptics } from "@/lib/haptics";
import { useThemeMode, type ThemeMode } from "@/lib/theme";
import { useMapStore, type MapNode } from "@/lib/master-map-store";
import { LayerStack, type LayerNodeRecord } from "@/lib/master-map-layers";

// ── Theme palette for the 3D scene + HUD ─────────────────────────────────────
type ScenePalette = {
  sceneBg: number;
  fog: number;
  ambient: number;
  goldLight: number;
  fillLight: number;
  rimLight: number;
  star: number;
  starOpacityScale: number;
  nexBody: number;
  nexEmissive: number;
  nexWire: number;
  nexRing: number;
  spoke: number;
  tracer: number;
  // CSS strings
  pageBg: string;
  headerBg: string;
  headerBorder: string;
  goldText: string;
  goldTextStrong: string;
  mutedText: string;
  labelText: string;
  hintText: string;
  panelBg: string;
  panelBorder: string;
  panelShadow: string;
  pickerBg: string;
  pickerBorder: string;
  pickerShadow: string;
  pickerItemText: string;
  warpBloom: string;
  warpConic: string;
};

function paletteFor(theme: ThemeMode): ScenePalette {
  if (theme === "parchment") {
    return {
      sceneBg: 0xFAFAF7,
      fog: 0xFAFAF7,
      ambient: 0xEDEAE2,
      goldLight: 0xB45309,
      fillLight: 0xC9A24C,
      rimLight: 0x92400E,
      star: 0x111111,
      starOpacityScale: 0.35,
      nexBody: 0xFFFFFF,
      nexEmissive: 0xB45309,
      nexWire: 0x111111,
      nexRing: 0x111111,
      spoke: 0x111111,
      tracer: 0xB45309,
      pageBg: "#FAFAF7",
      headerBg: "rgba(255,255,255,0.45)",
      headerBorder: "rgba(17,17,17,0.08)",
      // Label tokens promoted to stamped charcoal so satellite names stay
      // crisp against the cream canvas (was muddy tan/brown ~0.7 alpha).
      goldText: "rgba(17,17,17,0.92)",
      goldTextStrong: "#111111",
      mutedText: "rgba(17,17,17,0.55)",
      labelText: "#111111",
      hintText: "rgba(17,17,17,0.32)",
      panelBg: "rgba(255,255,255,0.96)",
      panelBorder: "rgba(17,17,17,0.10)",
      panelShadow: "0 10px 32px rgba(17,17,17,0.06), 0 0 0 0.5px rgba(17,17,17,0.04)",
      pickerBg: "rgba(255,255,255,0.98)",
      pickerBorder: "rgba(17,17,17,0.10)",
      pickerShadow: "0 12px 40px rgba(17,17,17,0.10)",
      pickerItemText: "#111111",
      warpBloom: "radial-gradient(ellipse 55% 55% at 50% 50%, rgba(17,17,17,0.10) 0%, transparent 65%)",
      warpConic: "repeating-conic-gradient(rgba(17,17,17,0.04) 0deg 1.5deg, transparent 1.5deg 20deg)",
    };
  }
  return {
    sceneBg: 0x090806,
    fog: 0x090806,
    ambient: 0x1a1208,
    goldLight: 0xC9A24C,
    fillLight: 0x6040a0,
    rimLight: 0x402010,
    star: 0xC9A24C,
    starOpacityScale: 1,
    nexBody: 0x0D0A06,
    nexEmissive: 0xC9A24C,
    nexWire: 0xC9A24C,
    nexRing: 0xC9A24C,
    spoke: 0xC9A24C,
    tracer: 0xC9A24C,
    pageBg: "#090806",
    headerBg: "rgba(9,8,6,0.25)",
    headerBorder: "rgba(201,162,76,0.06)",
    goldText: "rgba(201,162,76,0.7)",
    goldTextStrong: "rgba(201,162,76,0.92)",
    mutedText: "var(--atlas-muted)",
    labelText: "rgba(232,229,225,0.90)",
    hintText: "rgba(201,162,76,0.13)",
    panelBg: "rgba(13,11,9,0.92)",
    panelBorder: "rgba(201,162,76,0.22)",
    panelShadow: "0 8px 32px rgba(0,0,0,0.72), 0 0 0 0.5px rgba(0,0,0,0.5)",
    pickerBg: "rgba(13,11,9,0.96)",
    pickerBorder: "rgba(201,162,76,0.16)",
    pickerShadow: "0 12px 40px rgba(0,0,0,0.82)",
    pickerItemText: "#D4D0CB",
    warpBloom: "radial-gradient(ellipse 55% 55% at 50% 50%, rgba(201,162,76,0.18) 0%, transparent 65%)",
    warpConic: "repeating-conic-gradient(rgba(201,162,76,0.035) 0deg 1.5deg, transparent 1.5deg 20deg)",
  };
}

const BASE_URL = (import.meta as any).env?.BASE_URL?.replace?.(/\/$/, "") ?? "";
const POLL_INTERVAL = 30_000;
const ORBIT_R = 220;
const NEXIUM_R = 44;
const NODE_R = 23;
const CAM_Z = 520;

// ── types ───────────────────────────────────────────────────────────────────

type Project = {
  id: number;
  name: string;
  updatedAt: string;
  entryCount?: number;
  latestEntryAt?: string | null;
  latestSnapshotScore?: number | null;
  status?: "shaping" | "committed" | "archived";
  surfaceMode?: "ambient" | "operational";
};
type Connection = { a: number; b: number; strength: number };
type DecisionStats = { committed: number; tension: number };
type PeekEntry = { id: number; title: string };
type PeekState = {
  projectId: number;
  nodeIdx: number;
  name: string;
  score: number;
  entries: PeekEntry[];
  loading: boolean;
};
type Tension = {
  projectA: { id: number; name: string };
  projectB: { id: number; name: string };
  entryA: { id?: number; title: string };
  entryB: { id?: number; title: string };
  score: number;
};
type HoveredTension = { index: number; tension: Tension };

// ── helpers ─────────────────────────────────────────────────────────────────

function actLevel(u: string): number {
  const h = (Date.now() - new Date(u).getTime()) / 3_600_000;
  return h < 24 ? 1.0 : h < 72 ? 0.65 : h < 168 ? 0.35 : 0.15;
}
function actLabel(u: string): string {
  const h = (Date.now() - new Date(u).getTime()) / 3_600_000;
  if (h < 1) return "Active now";
  if (h < 24) return "Active today";
  if (h < 48) return "Yesterday";
  if (h < 168) return `${Math.floor(h / 24)}d ago`;
  return `${Math.floor(h / 168)}w ago`;
}
function isRecentEntry(lat?: string | null) {
  return !!lat && Date.now() - new Date(lat).getTime() < 2 * 3_600_000;
}
function nodeHue(name: string) { return (name.charCodeAt(0) * 47 + name.length * 13) % 360; }
function nodeColor(name: string) { return new THREE.Color().setHSL(nodeHue(name) / 360, 0.55, 0.45); }
function nodeGlassColor(name: string) { return new THREE.Color().setHSL(nodeHue(name) / 360, 0.18, 0.82); }

function nodePos3D(i: number, total: number): THREE.Vector3 {
  const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(
    Math.cos(angle) * ORBIT_R,
    Math.sin(angle) * ORBIT_R,
    Math.sin(i * 1.618) * 55,
  );
}
function buildConns(projects: Project[]): Connection[] {
  const out: Connection[] = [];
  for (let i = 0; i < projects.length; i++) {
    for (let j = i + 1; j < projects.length; j++) {
      const a = projects[i], b = projects[j];
      const s = Math.min(actLevel(a.updatedAt), actLevel(b.updatedAt));
      if ((a.entryCount ?? 0) > 0 && (b.entryCount ?? 0) > 0 && s >= 0.3)
        out.push({ a: i, b: j, strength: s });
    }
  }
  return out;
}
async function fetchAll(): Promise<{ nexus: Project | null; list: Project[] }> {
  const lR = await fetch(`${BASE_URL}/api/projects`, { credentials: "include" });
  const raw: Project[] = lR.ok ? await lR.json() : [];
  // Constellation shows the system of record — only committed projects render as nodes.
  // Shaping projects orbit invisibly until they commit.
  const committed = raw.filter((p) => (p.status ?? "committed") === "committed");
  return { nexus: null, list: committed };
}

// ── component ────────────────────────────────────────────────────────────────

export default function MasterMap() {
  const [location, setLocation] = useLocation();
  const { goBack: exitToReferrer } = useEntryReferrer();

  const theme = useThemeMode();
  const palette = paletteFor(theme);
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [warping, setWarping] = useState(false);
  const [statsVersion, setStatsVersion] = useState(0);
  const [peek, setPeek] = useState<PeekState | null>(null);
  const [tensions, setTensions] = useState<Tension[]>([]);
  const [tensionsVersion, setTensionsVersion] = useState(0);
  const [hoveredTension, setHoveredTension] = useState<HoveredTension | null>(null);

  const projectsRef = useRef<Project[]>([]);
  const projectPositionsRef = useRef<Map<number, [number, number, number]>>(new Map());
  const hoveredIdxRef = useRef<number | null>(null);
  const rippleIds = useRef<Set<number>>(new Set());
  const rippleTimers = useRef<number[]>([]);
  const prevEntryDates = useRef<Map<number, string>>(new Map());
  const gyroTilt = useRef({ x: 0, y: 0 });
  const camZTarget = useRef(CAM_Z);
  const warpTarget = useRef<{ pos: THREE.Vector3; cb: () => void; start: number } | null>(null);
  const statsRef = useRef<Map<number, DecisionStats>>(new Map());
  const tensionsRef = useRef<Tension[]>([]);
  const hoveredTensionRef = useRef<HoveredTension | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const peekElRef = useRef<HTMLDivElement | null>(null);
  const peekRef = useRef<PeekState | null>(null);
  const tensionTooltipElRef = useRef<HTMLDivElement | null>(null);

  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const warpFnRef = useRef<((destId: number) => void) | null>(null);
  const recenterFnRef = useRef<(() => void) | null>(null);
  const layerStackRef = useRef<LayerStack | null>(null);
  const layer2TooltipRef = useRef<{ rec: LayerNodeRecord } | null>(null);
  const [layer2Tooltip, setLayer2Tooltip] = useState<{
    id: string;
    label: string;
    description?: string;
    x: number;
    y: number;
  } | null>(null);
  const [layer2Empty, setLayer2Empty] = useState(false);
  const [layer2Loading, setLayer2Loading] = useState(false);

  const mapState = useMapStore();
  const currentLayer = mapState.currentLayer;
  const focusedNodeId = mapState.focusedNodeId;
  const context = mapState.context;
  const navigateToNode = useMapStore((s) => s.navigateToNode);
  const resetToSource = useMapStore((s) => s.resetToSource);
  const currentLayerRef = useRef(currentLayer);
  useEffect(() => { currentLayerRef.current = currentLayer; }, [currentLayer]);
  const goBackRef = useRef<(() => void) | null>(null);


  // Recompute on every render — wouter's useLocation only tracks pathname, not
  // search params, so memoizing on [location] misses ?projectId changes when
  // navigating in from a project tile.
  const activeProjectId = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("projectId") ?? params.get("activeProjectId") ?? params.get("project") ?? sessionStorage.getItem("atlas-active-project-id");
      const parsed = raw ? Number(raw) : NaN;
      if (Number.isFinite(parsed)) return parsed;
      // Fall back to most recently updated project
      if (projects.length > 0) return projects[0].id;
      return null;
    } catch {
      return null;
    }
  })();
  const activeProjectIdRef = useRef(activeProjectId);
  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);




  useEffect(() => { hoveredIdxRef.current = hoveredIdx; }, [hoveredIdx]);
  useEffect(() => {
    projectsRef.current = projects;
    if (projects.length > 0) {
      try { (navigator as any).vibrate?.([40]); } catch {}
    }
  }, [projects]);
  useEffect(() => { peekRef.current = peek; }, [peek]);
  useEffect(() => { tensionsRef.current = tensions; }, [tensions]);
  useEffect(() => { hoveredTensionRef.current = hoveredTension; }, [hoveredTension]);

  // Reset to Layer 1 on page mount
  useEffect(() => { resetToSource(); }, [resetToSource]);

  // Fetch & populate Layer 2/3 children whenever the focused node changes
  useEffect(() => {
    const ls = layerStackRef.current;
    if (!ls) return;
    if (currentLayer === 1 || !focusedNodeId) {
      ls.hideAll();
      setLayer2Tooltip(null);
      layer2TooltipRef.current = null;
      setLayer2Empty(false);
      setLayer2Loading(false);
      return;
    }
    const target = mapState.cameraTarget;
    let cancelled = false;
    setLayer2Loading(true);
    (async () => {
      try {
        if (currentLayer === 2 && context.projectId) {
          const r = await fetch(`${BASE_URL}/api/projects/${context.projectId}/map-nodes`, { credentials: "include" });
          const list: MapNode[] = r.ok ? await r.json() : [];
          if (cancelled) return;
          ls.populate(2, target, list);
          setLayer2Empty(list.length === 0);
        } else if (currentLayer === 3 && context.projectId && context.parentLabel) {
          const r = await fetch(`${BASE_URL}/api/projects/${context.projectId}/entries`, { credentials: "include" });
          const raw = r.ok ? await r.json() : [];
          const entries: Array<{ id: number | string; title: string; description?: string }> = Array.isArray(raw) ? raw : [];
          const sprintTitle = context.parentLabel.toLowerCase();
          const filtered = entries
            .filter((e) => (e.title ?? "").toLowerCase().includes(sprintTitle))
            .slice(0, 8)
            .map<MapNode>((e) => ({
              id: String(e.id),
              label: e.title,
              type: "LEAF",
              description: e.description,
              position: [0, 0, 0],
              color: "#C9A24C",
            }));
          if (cancelled) return;
          ls.populate(3, target, filtered, { maxChildren: 8 });
          setLayer2Empty(filtered.length === 0);
        }
      } catch {
        if (!cancelled) { ls.hideAll(); setLayer2Empty(true); }
      } finally {
        if (!cancelled) setLayer2Loading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentLayer, focusedNodeId, context.projectId, context.parentLabel, mapState.cameraTarget]);

  // Pause loop when tab hidden (perf)
  const tabVisibleRef = useRef(true);
  useEffect(() => {
    const onVis = () => { tabVisibleRef.current = document.visibilityState === "visible"; };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── cross-project tensions ─────────────────────────────────────────────────
  useEffect(() => {
    if (loading) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${BASE_URL}/api/projects/tensions`, { credentials: "include" });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        const list: Tension[] = Array.isArray(data) ? data : (data?.tensions ?? []);
        setTensions(list);
        setTensionsVersion(v => v + 1);
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, [loading, projects]);


  // ── decision stats (per project) ───────────────────────────────────────────
  useEffect(() => {
    if (loading || projects.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(projects.map(async (p) => {
        try {
          const r = await fetch(`${BASE_URL}/api/projects/${p.id}/entries?status=committed`, { credentials: "include" });
          if (!r.ok) return [p.id, { committed: 0, tension: 0 }] as const;
          const list = await r.json() as Array<{
            deviation?: boolean; isViolation?: boolean;
            catchAgainstId?: number | null; supersedesId?: number | null;
          }>;
          const committed = list.length;
          const tension = list.filter(e =>
            e.deviation || e.isViolation || e.catchAgainstId != null || e.supersedesId != null
          ).length;
          return [p.id, { committed, tension }] as const;
        } catch {
          return [p.id, { committed: 0, tension: 0 }] as const;
        }
      }));
      if (cancelled) return;
      const m = new Map<number, DecisionStats>();
      results.forEach(([id, s]) => m.set(id, s));
      statsRef.current = m;
      setStatsVersion(v => v + 1);
    })();
    return () => { cancelled = true; };
  }, [loading, projects]);


  // ── data ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    fetchAll().then(({ list }) => {
      setProjects(list);
      setConnections(buildConns(list));
      const m = new Map<number, string>();
      list.forEach(p => { if (p.latestEntryAt) m.set(p.id, p.latestEntryAt); });
      prevEntryDates.current = m;
      rippleIds.current = new Set(list.filter(p => isRecentEntry(p.latestEntryAt)).map(p => p.id));
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading) return;
    const iv = setInterval(() => {
      fetchAll().then(({ list }) => {
        const fresh: number[] = [];
        list.forEach(p => {
          const prev = prevEntryDates.current.get(p.id);
          if (p.latestEntryAt && (!prev || p.latestEntryAt > prev)) fresh.push(p.id);
          if (p.latestEntryAt) prevEntryDates.current.set(p.id, p.latestEntryAt);
        });
        if (fresh.length) {
          fresh.forEach(id => rippleIds.current.add(id));
          setTimeout(() => fresh.forEach(id => rippleIds.current.delete(id)), 3200);
        }
      });
    }, POLL_INTERVAL);
    return () => clearInterval(iv);
  }, [loading]);

  // ── gyroscope ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      gyroTilt.current = {
        x: ((e.beta ?? 45) - 45) / 90,
        y: (e.gamma ?? 0) / 90,
      };
    };
    const register = async () => {
      if (typeof (DeviceOrientationEvent as any).requestPermission === "function") {
        try {
          if (await (DeviceOrientationEvent as any).requestPermission() === "granted")
            window.addEventListener("deviceorientation", handler);
        } catch {}
      } else {
        window.addEventListener("deviceorientation", handler);
      }
    };
    register();
    return () => window.removeEventListener("deviceorientation", handler);
  }, []);

  // ── Three.js scene ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (loading || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const W = canvas.offsetWidth || window.innerWidth;
    const H = canvas.offsetHeight || window.innerHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.sceneBg);
    scene.fog = new THREE.FogExp2(palette.fog, 0.00075);

    // Camera
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 2000);
    camera.position.set(0, 0, CAM_Z);

    // ── Lights ────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(palette.ambient, theme === "parchment" ? 3.2 : 2.5));

    const goldLight = new THREE.PointLight(palette.goldLight, 8, 800);
    goldLight.position.set(0, 0, 0);
    scene.add(goldLight);

    const fillLight = new THREE.PointLight(palette.fillLight, 2.5, 700);
    fillLight.position.set(-200, 300, 200);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(palette.rimLight, 2.0, 600);
    rimLight.position.set(100, -200, -150);
    scene.add(rimLight);

    // ── Starfield — 3 depth layers for parallax ───────────────────────────
    const makeStarLayer = (count: number, spread: number, z: number, size: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        pos[i*3]   = (Math.random() - 0.5) * spread;
        pos[i*3+1] = (Math.random() - 0.5) * spread;
        pos[i*3+2] = (Math.random() - 0.5) * 400 + z;
      }
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: palette.star, size, transparent: true, opacity: opacity * palette.starOpacityScale }));
      scene.add(pts);
      return pts;
    };
    const starsBack = makeStarLayer(500, 2400, -500, 1.0, 0.12);   // distant, very slow
    const starsMid  = makeStarLayer(250, 1200, -200, 1.4, 0.20);   // mid
    const starsFront= makeStarLayer(80,  600,   100, 2.0, 0.30);   // near, fast

    // ── Nexium — faceted icosahedron diamond ──────────────────────────────
    const nexIco = new THREE.IcosahedronGeometry(NEXIUM_R, 1);
    const nexMat = new THREE.MeshPhysicalMaterial({
      color: palette.nexBody,
      emissive: palette.nexEmissive,
      emissiveIntensity: theme === "parchment" ? 0.18 : 0.55,
      roughness: theme === "parchment" ? 0.55 : 0.12,
      metalness: theme === "parchment" ? 0.05 : 0.85,
      clearcoat: theme === "parchment" ? 0.3 : 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: theme === "parchment" ? 0.3 : 1.0,
    });
    const nexMesh = new THREE.Mesh(nexIco, nexMat);
    scene.add(nexMesh);

    // Nexium wireframe cage
    const nexWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(NEXIUM_R * 1.12, 1),
      new THREE.MeshBasicMaterial({ color: palette.nexWire, wireframe: true, transparent: true, opacity: theme === "parchment" ? 0.28 : 0.12 }),
    );
    scene.add(nexWire);

    // Nexium orbit ring
    const nexRingMesh = new THREE.Mesh(
      new THREE.TorusGeometry(NEXIUM_R * 1.55, 1.2, 8, 80),
      new THREE.MeshBasicMaterial({ color: palette.nexRing, transparent: true, opacity: theme === "parchment" ? 0.42 : 0.28 }),
    );
    nexRingMesh.rotation.x = Math.PI / 2.8;
    scene.add(nexRingMesh);

    // Nexium "SOURCE" label handled in HTML overlay — we add a ref below

    // ── Project nodes — glass spheres ─────────────────────────────────────
    const projs = projectsRef.current;
    const positions: THREE.Vector3[] = projs.map((_, i) => nodePos3D(i, projs.length));
    const nodeMeshes: THREE.Mesh[] = [];
    const haloMeshes: THREE.Mesh[] = [];
    const rippleMeshes: THREE.Mesh[] = [];
    

    const baseScales: number[] = [];
    rippleTimers.current = new Array(projs.length).fill(0);

    // Ledger overlay color constants
    const GOLD = new THREE.Color(0xC9A24C);
    const AMBER = new THREE.Color(0xD28852); // color-mix 60% #d97757 / 40% gold

    projs.forEach((p, i) => {
      const act = actLevel(p.updatedAt);
      const stats = statsRef.current.get(p.id) ?? { committed: 0, tension: 0 };
      const hueCol = nodeColor(p.name);
      const hueGlass = nodeGlassColor(p.name);

      // Decision health → color + emissive intensity
      let bodyColor: THREE.Color;
      let emissiveColor: THREE.Color;
      let emissiveBoost = 0;
      if (stats.committed === 0) {
        bodyColor = hueGlass;
        emissiveColor = hueCol;
      } else if (stats.tension > 0) {
        bodyColor = AMBER.clone();
        emissiveColor = AMBER.clone();
        emissiveBoost = 0.18;
      } else {
        bodyColor = GOLD.clone();
        emissiveColor = GOLD.clone();
        emissiveBoost = 0.22;
      }

      // Size: scale 1.0x → 2.0x by committed count (saturates at 8)
      const sizeBoost = 1 + Math.min(stats.committed / 8, 1);
      baseScales.push(sizeBoost);

      // Glass sphere
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(NODE_R, 36, 36),
        new THREE.MeshPhysicalMaterial({
          color: bodyColor,
          emissive: emissiveColor,
          emissiveIntensity: 0.12 + act * 0.32 + emissiveBoost,
          roughness: 0.08,
          metalness: 0.04,
          clearcoat: 1.0,
          clearcoatRoughness: 0.05,
          transparent: true,
          opacity: 0.86,
          reflectivity: 1.0,
        }),
      );
      mesh.position.copy(positions[i]);
      mesh.scale.setScalar(sizeBoost);
      scene.add(mesh);
      nodeMeshes.push(mesh);

      // Active project halo ring — persistent pulsing ring
      const haloRing = new THREE.Mesh(
        new THREE.TorusGeometry(NODE_R * 2.1, 3.5, 16, 80),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0x7DD3C8),
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
        }),
      );
      haloRing.position.copy(positions[i]);
      haloRing.scale.setScalar(sizeBoost);
      scene.add(haloRing);
      haloMeshes.push(haloRing);
      projectPositionsRef.current.set(projs[i].id, [positions[i].x, positions[i].y, positions[i].z]);

      // Ripple ring (billboarded) — keep per-name hue so pulse stays recognizable
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(NODE_R, 1.5, 8, 64),
        new THREE.MeshBasicMaterial({ color: hueCol, transparent: true, opacity: 0, side: THREE.DoubleSide }),
      );
      ring.position.copy(positions[i]);
      ring.scale.setScalar(sizeBoost);
      scene.add(ring);
      rippleMeshes.push(ring);


    });

    // ── Spokes Nexium → nodes ─────────────────────────────────────────────
    type SpokeTracer = { mesh: THREE.Mesh; to: THREE.Vector3; t: number; speed: number };
    const spokeTracers: SpokeTracer[] = [];

    projs.forEach((p, i) => {
      const act = actLevel(p.updatedAt);
      // Spoke line
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, positions[i].x, positions[i].y, positions[i].z]), 3,
      ));
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: palette.spoke, transparent: true, opacity: (theme === "parchment" ? 0.18 : 0.08) + act * 0.22,
      })));

      // Tracer bead — pulses outward from Nexium
      const tracerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: palette.tracer, transparent: true, opacity: 0 }),
      );
      scene.add(tracerMesh);
      spokeTracers.push({
        mesh: tracerMesh,
        to: positions[i].clone(),
        t: (i / Math.max(projs.length, 1)),  // staggered start per node
        speed: 0.0045 + act * 0.003,
      });
    });

    // ── Neural filament curves + tracers ──────────────────────────────────
    type FilamentTracer = { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; t: number; speed: number };
    const filamentTracers: FilamentTracer[] = [];

    buildConns(projs).forEach(({ a, b, strength }) => {
      const pA = positions[a], pB = positions[b];
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const dir = pB.clone().sub(pA);
      const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar(70);
      mid.add(perp).setZ(mid.z + 30);
      const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);

      const colA = nodeColor(projs[a].name);
      const blended = colA.clone().lerp(nodeColor(projs[b].name), 0.5);

      // Filament line
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(60));
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: blended, transparent: true, opacity: 0.06 + strength * 0.22,
      })));

      // Tracer bead
      const ft = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 8, 8),
        new THREE.MeshBasicMaterial({ color: blended, transparent: true, opacity: 0 }),
      );
      scene.add(ft);
      filamentTracers.push({ mesh: ft, curve, t: Math.random(), speed: 0.0035 + strength * 0.003 });
    });

    // ── Cross-project tension filaments (from /api/projects/tensions) ─────
    type TensionFilament = {
      line: THREE.Line;
      mid: THREE.Vector3;
      tension: Tension;
      baseOpacity: number;
      phase: number;
      high: boolean;
    };
    const tensionFilaments: TensionFilament[] = [];
    const tensionLineMeshes: THREE.Line[] = [];

    (tensionsRef.current ?? []).forEach((ten, ti) => {
      const ia = projs.findIndex(p => p.id === ten?.projectA?.id);
      const ib = projs.findIndex(p => p.id === ten?.projectB?.id);
      if (ia < 0 || ib < 0) return;
      const pA = positions[ia], pB = positions[ib];
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const dir = pB.clone().sub(pA);
      // Opposite perpendicular vs. existing buildConns filaments → visually distinct from spokes
      const perp = new THREE.Vector3(dir.y, -dir.x, 0).normalize().multiplyScalar(110);
      mid.add(perp).setZ(mid.z - 30);
      const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);

      const high = (ten.score ?? 0) >= 0.6;
      // rgba(201,162,76,0.25) low / rgba(217,119,87,0.55) high
      const color = new THREE.Color(high ? 0xD97757 : 0xC9A24C);
      const baseOpacity = high ? 0.55 : 0.25;

      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(64));
      const mat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: baseOpacity,
      });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      tensionLineMeshes.push(line);
      tensionFilaments.push({
        line, mid: curve.getPoint(0.5), tension: ten,
        baseOpacity, phase: ti * 1.3, high,
      });
    });

    // ── Layer 2/3 stack ───────────────────────────────────────────────────
    const layerStack = new LayerStack(scene);
    layerStackRef.current = layerStack;

    // ── Raycasting ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 6 };
    const ndc = new THREE.Vector2();

    const setRay = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };

    const hitTest = (cx: number, cy: number) => {
      setRay(cx, cy);
      return raycaster.intersectObjects([nexMesh, ...nodeMeshes]);
    };

    const tensionHitTest = (): HoveredTension | null => {
      if (!tensionLineMeshes.length) return null;
      const hits = raycaster.intersectObjects(tensionLineMeshes);
      if (!hits.length) return null;
      const idx = tensionLineMeshes.indexOf(hits[0].object as THREE.Line);
      if (idx < 0) return null;
      return { index: idx, tension: tensionFilaments[idx].tension };
    };


    const toScreen = (pos3d: THREE.Vector3) => {
      const v = pos3d.clone().project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
    };

    const warpTo = (destId: number, targetPos: THREE.Vector3, params = "") => {
      // If we're warping into a flow view, prime the RightPanel tab flag so
      // the workspace lands directly on the AxiomFlow map (not the ledger).
      if (params.includes("view=flow")) {
        try { sessionStorage.setItem("atlas-open-tab", "map"); } catch {}
      }
      const camNow = camera.position.clone();
      const dir = targetPos.clone().sub(camNow).normalize();
      warpTarget.current = {
        pos: camNow.clone().add(dir.multiplyScalar(500)),
        start: Date.now(),
        cb: () => setLocation(`/project/${destId}${params}`),
      };
      setWarping(true);
      setTimeout(() => {
        if (!warpTarget.current) return;
        setLocation(`/project/${destId}${params}`);
      }, 950);
    };

    const openPeek = async (idx: number) => {
      const proj = projectsRef.current[idx];
      if (!proj) return;
      setPeek({
        projectId: proj.id,
        nodeIdx: idx,
        name: proj.name,
        score: Math.round(proj.latestSnapshotScore ?? 0),
        entries: [],
        loading: true,
      });
      try {
        const r = await fetch(`${BASE_URL}/api/projects/${proj.id}/entries?status=committed`, { credentials: "include" });
        const list = r.ok ? (await r.json()) as Array<{ id: number; title: string }> : [];
        const top3 = list.slice(0, 3).map(e => ({ id: e.id, title: e.title }));
        setPeek(prev => prev && prev.projectId === proj.id ? { ...prev, entries: top3, loading: false } : prev);
      } catch {
        setPeek(prev => prev && prev.projectId === proj.id ? { ...prev, loading: false } : prev);
      }
    };

    const handleLayer23Click = (cx: number, cy: number): boolean => {
      // Layer 1 project taps are handled by the outer hitTest → dive to Layer 2.
      if (currentLayerRef.current === 1) return false;
      setRay(cx, cy);
      const hit = layerStack.hit(raycaster);
      if (hit === "source") {
        haptics.tap();
        resetToSource();
        return true;
      }
      if (hit) {
        haptics.tap();
        const layer = currentLayerRef.current;
        if (hit.subType === "BLUEPRINT") {
          setLocation(`/blueprints/${hit.id}`);
          return true;
        }
        if (layer === 2) {
          // Any Layer 2 node drills into Layer 3 (Assets) with this node as focus.
          const projectId = useMapStore.getState().context.projectId;
          const projectName = useMapStore.getState().context.projectName;
          navigateToNode(hit.id, [hit.worldPos.x, hit.worldPos.y, hit.worldPos.z], 3, {
            projectId,
            projectName,
            parentId: hit.id,
            parentLabel: hit.label,
          });
          return true;
        }
        if (hit.subType === "DECISION") {
          setLocation(`/entry/${hit.id}`);
          return true;
        }
        // Default: show glassmorphic tooltip
        const sp = hit.worldPos.clone().project(camera);
        setLayer2Tooltip({
          id: hit.id,
          label: hit.label,
          description: hit.description,
          x: (sp.x * 0.5 + 0.5) * canvas.clientWidth,
          y: (-sp.y * 0.5 + 0.5) * canvas.clientHeight,
        });
        layer2TooltipRef.current = { rec: hit };
        return true;
      }
      // Empty tap on layer 2/3 → dismiss tooltip
      setLayer2Tooltip(null);
      layer2TooltipRef.current = null;
      return true;
    };

    const handleClick = (cx: number, cy: number) => {
      if (handleLayer23Click(cx, cy)) return;
      const hits = hitTest(cx, cy);
      if (!hits.length) {
        // Tap on a tension filament shows tooltip; else dismiss peek/tension
        const th = tensionHitTest();
        if (th) {
          haptics.tap();
          setHoveredTension(th);
          return;
        }
        if (peekRef.current) { haptics.tap(); setPeek(null); }
        if (hoveredTensionRef.current) setHoveredTension(null);
        return;
      }
      const obj = hits[0].object as THREE.Mesh;
      haptics.tap();
      if (obj === nexMesh || obj === nexWire) {
        setPeek(null);
        setWarping(true);
        setTimeout(() => setLocation("/home?surface=global-insight&seed=portfolio"), 950);
        return;
      }
      const idx = nodeMeshes.indexOf(obj);
      if (idx < 0) return;
      // Layer 1: tap a project node → dive straight to Layer 2 (Architecture).
      const proj = projectsRef.current[idx];
      if (proj) {
        const pos = nodePos3D(idx, projectsRef.current.length);
        setPeek(null);
        navigateToNode(String(proj.id), [pos.x, pos.y, pos.z], 2, {
          projectId: proj.id,
          projectName: proj.name,
        });
        return;
      }
      openPeek(idx);
    };

    // ── Mouse drag + click ────────────────────────────────────────────────
    let mouseDownX = 0, mouseDownY = 0, lastMX = 0, lastMY = 0;
    let isMouseDrag = false;

    const onMouseDown = (e: MouseEvent) => {
      mouseDownX = lastMX = e.clientX;
      mouseDownY = lastMY = e.clientY;
      isMouseDrag = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (e.buttons & 1) {
        const dx = e.clientX - lastMX;
        const dy = e.clientY - lastMY;
        if (Math.hypot(e.clientX - mouseDownX, e.clientY - mouseDownY) > 6) {
          isMouseDrag = true;
          isDraggingRef.current = true;
        }
        if (isMouseDrag) {
          panRef.current.x += dx * 1.4;
          panRef.current.y -= dy * 1.4;
          canvas.style.cursor = "grabbing";
        }
      } else {
        isDraggingRef.current = false;
        const hits = hitTest(e.clientX, e.clientY);
        if (hits.length) {
          const obj = hits[0].object as THREE.Mesh;
          const i = nodeMeshes.indexOf(obj);
          setHoveredIdx(i >= 0 ? i : null);
          setHoveredTension(null);
          canvas.style.cursor = "pointer";
        } else {
          setHoveredIdx(null);
          const th = tensionHitTest();
          setHoveredTension(th);
          canvas.style.cursor = th ? "help" : "grab";
        }
      }
      lastMX = e.clientX;
      lastMY = e.clientY;
    };
    const onCanvasClick = (e: MouseEvent) => {
      if (isMouseDrag) { isMouseDrag = false; return; }
      handleClick(e.clientX, e.clientY);
    };

    // ── Touch drag + pinch + tap ──────────────────────────────────────────
    let tStartX = 0, tStartY = 0, tLastX = 0, tLastY = 0;
    let isTouchDrag = false;
    let pinchStartDist = 0, pinchStartZ = CAM_Z;
    let tStartTime = 0;
    let lastTapTime = 0, lastTapX = 0, lastTapY = 0;
    let edgeSwipeCandidate = false;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        tStartX = tLastX = e.touches[0].clientX;
        tStartY = tLastY = e.touches[0].clientY;
        isTouchDrag = false;
        tStartTime = performance.now();
        edgeSwipeCandidate = tStartX < 24 && currentLayerRef.current > 1;
        isDraggingRef.current = false;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDist = Math.hypot(dx, dy);
        pinchStartZ = camZTarget.current;
        isDraggingRef.current = true;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - tLastX;
        const dy = e.touches[0].clientY - tLastY;
        if (Math.hypot(e.touches[0].clientX - tStartX, e.touches[0].clientY - tStartY) > 8) {
          isTouchDrag = true;
          isDraggingRef.current = true;
        }
        if (isTouchDrag && !edgeSwipeCandidate) {
          panRef.current.x += dx * 1.4;
          panRef.current.y -= dy * 1.4;
        }
        tLastX = e.touches[0].clientX;
        tLastY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (pinchStartDist > 0) {
          camZTarget.current = Math.max(220, Math.min(900, pinchStartZ * (pinchStartDist / dist)));
        }
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        isDraggingRef.current = false;
        const t = e.changedTouches[0];
        // Edge-swipe back: started near left edge and swiped right > 60px
        if (edgeSwipeCandidate && (t.clientX - tStartX) > 60 && Math.abs(t.clientY - tStartY) < 80) {
          haptics.tap();
          goBackRef.current?.();
          edgeSwipeCandidate = false;
          isTouchDrag = false;
          return;
        }
        if (!isTouchDrag) {
          const now = performance.now();
          // Double-tap detection — navigate deeper
          if (now - lastTapTime < 320 && Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 30) {
            lastTapTime = 0;
            handleClick(t.clientX, t.clientY);
          } else {
            lastTapTime = now;
            lastTapX = t.clientX; lastTapY = t.clientY;
            handleClick(t.clientX, t.clientY);
          }
        }
        isTouchDrag = false;
        edgeSwipeCandidate = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZTarget.current = Math.max(220, Math.min(900, camZTarget.current + e.deltaY * 0.28));
    };

    // ── Expose recenter + warpFn to React layer ───────────────────────────
    recenterFnRef.current = () => {
      panRef.current = { x: 0, y: 0 };
      camZTarget.current = CAM_Z;
    };
    warpFnRef.current = (destId: number) => {
      const projs = projectsRef.current;
      const idx = projs.findIndex(p => p.id === destId);
      if (idx >= 0) warpTo(destId, nodeMeshes[idx].position, "?view=flow");
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Resize
    const ro = new ResizeObserver(() => {
      const nw = canvas.offsetWidth, nh = canvas.offsetHeight;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    });
    ro.observe(canvas.parentElement!);


    // ── Animation loop ─────────────────────────────────────────────────────
    let frameId = 0;
    const t0 = Date.now();

    const loop = () => {
      frameId = requestAnimationFrame(loop);
      if (!tabVisibleRef.current) return;
      const t = (Date.now() - t0) / 1000;
      const nowMs = performance.now();
      const layerNow = currentLayerRef.current;
      const storeState = useMapStore.getState();

      // ── Nexium rotation + breathe ──
      nexMesh.rotation.y = t * 0.22;
      nexMesh.rotation.x = t * 0.11;
      nexWire.rotation.y = -t * 0.14;
      nexWire.rotation.x = t * 0.07;
      nexRingMesh.rotation.z = t * 0.08;
      const glow = 0.45 + Math.sin(t * 1.8) * 0.15;
      nexMat.emissiveIntensity = glow;
      goldLight.intensity = 6 + Math.sin(t * 1.8) * 2;




      // ── Camera: layer-aware target & zoom ──
      const gx = gyroTilt.current.x;
      const gy = gyroTilt.current.y;
      const panDist = Math.hypot(panRef.current.x, panRef.current.y);
      if (!isDraggingRef.current && panDist > 480) {
        panRef.current.x *= 0.96;
        panRef.current.y *= 0.96;
      }

      if (layerNow === 1) {
        const targetX = gy * 95 + panRef.current.x;
        const targetY = -gx * 70 + panRef.current.y;
        camera.position.x += (targetX - camera.position.x) * 0.055;
        camera.position.y += (targetY - camera.position.y) * 0.055;
        camera.position.z += (camZTarget.current - camera.position.z) * 0.07;
        starsBack.position.x  = camera.position.x * 0.12;
        starsBack.position.y  = camera.position.y * 0.12;
        starsMid.position.x   = camera.position.x * 0.28;
        starsMid.position.y   = camera.position.y * 0.28;
        starsFront.position.x = camera.position.x * 0.55;
        starsFront.position.y = camera.position.y * 0.55;
        camera.lookAt(0, 0, 0);
      } else {
        // Cinematic camera: lerp toward target with zoom-derived offset
        const tgt = storeState.cameraTarget;
        const zoom = storeState.zoomLevel;
        const desired = new THREE.Vector3(
          tgt[0],
          tgt[1] + zoom * 0.4 * 10, // scale to match world units (~25 ≈ CAM_Z)
          tgt[2] + zoom * 10,
        );
        camera.position.lerp(desired, 0.08);
        camera.lookAt(tgt[0], tgt[1], tgt[2]);
      }

      // ── Warp dive ──
      if (warpTarget.current) {
        const elapsed = Date.now() - warpTarget.current.start;
        const ease = (elapsed / 850) * (elapsed / 850); // accelerate
        camera.position.lerp(warpTarget.current.pos, Math.min(ease * 0.15, 0.18));
        if (elapsed >= 850) {
          const cb = warpTarget.current.cb;
          warpTarget.current = null;
          cb();
        }
      }

      // ── Spoke tracers (gold beads fly Nexium → node) ──
      spokeTracers.forEach(st => {
        st.t = (st.t + st.speed) % 1;
        st.mesh.position.lerpVectors(new THREE.Vector3(0, 0, 0), st.to, st.t);
        const mat = st.mesh.material as THREE.MeshBasicMaterial;
        const edge = Math.min(st.t * 7, (1 - st.t) * 7, 1);
        mat.opacity = edge * 0.85;
      });

      // ── Filament tracers (colored beads traverse bezier curves) ──
      filamentTracers.forEach(ft => {
        ft.t = (ft.t + ft.speed) % 1;
        ft.mesh.position.copy(ft.curve.getPoint(ft.t));
        const mat = ft.mesh.material as THREE.MeshBasicMaterial;
        const edge = Math.min(ft.t * 6, (1 - ft.t) * 6, 1);
        mat.opacity = edge * 0.72;
      });

      // ── Tension filaments: slow pulse, brighten on hover ──
      tensionFilaments.forEach((tf, i) => {
        const mat = tf.line.material as THREE.LineBasicMaterial;
        const pulse = 0.7 + 0.3 * Math.sin(t * 1.6 + tf.phase);
        const hovered = hoveredTensionRef.current?.index === i;
        mat.opacity = Math.min(1, tf.baseOpacity * pulse * (hovered ? 1.8 : 1));
      });

      // ── Node hover glow + scale (respects per-node baseScale from Ledger overlay) ──
      const layer1FadeTarget = layerNow === 1 ? 0.86 : 0.15;
      nodeMeshes.forEach((mesh, i) => {
        const hovered = i === hoveredIdxRef.current && layerNow === 1;
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        const proj = projectsRef.current[i];
        const stats = proj ? statsRef.current.get(proj.id) ?? { committed: 0, tension: 0 } : { committed: 0, tension: 0 };
        const boost = stats.committed === 0 ? 0 : (stats.tension > 0 ? 0.18 : 0.22);
        const base = 0.12 + actLevel(proj?.updatedAt ?? "") * 0.3 + boost;
        mat.emissiveIntensity = hovered ? base + 0.32 + Math.sin(t * 3.5) * 0.12 : base;
        mat.opacity += (layer1FadeTarget - mat.opacity) * 0.08;
        const bs = baseScales[i] ?? 1;
        const tgt = bs * (hovered ? 1.15 : 1.0);
        mesh.scale.setScalar(mesh.scale.x + (tgt - mesh.scale.x) * 0.11);
      });
      // Tick Layer 2/3
      layerStack.tick(t, nowMs);
      // Update Layer 2 tooltip screen position
      if (layer2TooltipRef.current) {
        const rec = layer2TooltipRef.current.rec;
        const sp = rec.worldPos.clone().project(camera);
        setLayer2Tooltip((prev) => prev ? {
          ...prev,
          x: (sp.x * 0.5 + 0.5) * canvas.clientWidth,
          y: (-sp.y * 0.5 + 0.5) * canvas.clientHeight,
        } : prev);
      }

      // ── Active project halo ──
      haloMeshes.forEach((halo, i) => {
        const pid = projectsRef.current[i]?.id;
        const isActive = pid !== undefined && pid === activeProjectIdRef.current;
        halo.lookAt(camera.position);
        const mat = halo.material as THREE.MeshBasicMaterial;
        const bs = baseScales[i] ?? 1;
        if (isActive) {
          // Breathing pulse — scale between 1.08x and 1.22x
          const pulse = 1.15 + Math.sin(t * 2.2) * 0.07;
          halo.scale.setScalar(bs * pulse);
          // Opacity breathes between 0.45 and 0.85
          mat.opacity = 0.55 + Math.sin(t * 1.8) * 0.3;
          // Gold color with slight warmth shift on pulse
          mat.color.setHex(0x7DD3C8);
        } else {
          mat.opacity += (0 - mat.opacity) * 0.12;
        }
      });

      // ── Ripple rings ──
      rippleMeshes.forEach((ring, i) => {
        const pid = projectsRef.current[i]?.id;
        const active = pid !== undefined &&
          (rippleIds.current.has(pid) || isRecentEntry(projectsRef.current[i]?.latestEntryAt));
        ring.lookAt(camera.position);
        const mat = ring.material as THREE.MeshBasicMaterial;
        const bs = baseScales[i] ?? 1;
        if (active) {
          rippleTimers.current[i] = (rippleTimers.current[i] + 0.011) % 1;
          const rt = rippleTimers.current[i];
          ring.scale.setScalar(bs * (1 + rt * 3.2));
          mat.opacity = 0.6 * (1 - rt);
        } else {
          ring.scale.setScalar(bs);
          mat.opacity = 0;
          rippleTimers.current[i] = 0;
        }
      });

      // ── Stars slow rotation ──
      starsBack.rotation.y  = t * 0.00008;
      starsMid.rotation.y   = t * 0.00016;
      starsFront.rotation.y = t * 0.0003;

      // ── Labels ──
      labelEls.current.forEach((el, i) => {
        if (!el || !nodeMeshes[i]) return;
        const sp = toScreen(nodeMeshes[i].position);
        el.style.left = `${sp.x}px`;
        el.style.top = `${sp.y + NODE_R * (baseScales[i] ?? 1) + 7}px`;
      });

      // ── Peek panel positioning (smart anchor: above/below/side, always clamped) ──
      const pk = peekRef.current;
      const pkEl = peekElRef.current;
      if (pk && pkEl && nodeMeshes[pk.nodeIdx]) {
        const sp = toScreen(nodeMeshes[pk.nodeIdx].position);
        const bs = baseScales[pk.nodeIdx] ?? 1;
        const vw = canvas.clientWidth;
        const vh = canvas.clientHeight;
        const rect = pkEl.getBoundingClientRect();
        const cardW = rect.width || 240;
        const cardH = rect.height || 200;
        const margin = 12;
        const gap = 12 + NODE_R * bs;
        const safeRight = currentLayerRef.current === 1 ? 112 : 0;
        const safeBottom = currentLayerRef.current === 1 ? 104 : 0;
        const maxX = Math.max(margin, vw - margin - safeRight);
        const maxY = Math.max(margin, vh - margin - safeBottom);

        // Score each of 4 placements by how much the card would overflow the viewport.
        // The placement with least overflow wins. Preference order on ties: above, below, right, left.
        type Placement = { name: "above" | "below" | "right" | "left"; tx: number; ty: number; transform: string };
        const candidates: Placement[] = [
          { name: "above", tx: sp.x - cardW / 2, ty: sp.y - gap - cardH, transform: "translate(-50%, -100%)" },
          { name: "below", tx: sp.x - cardW / 2, ty: sp.y + gap,         transform: "translate(-50%, 0)" },
          { name: "right", tx: sp.x + gap,       ty: sp.y - cardH / 2,   transform: "translate(0, -50%)" },
          { name: "left",  tx: sp.x - gap - cardW, ty: sp.y - cardH / 2, transform: "translate(-100%, -50%)" },
        ];
        const overflow = (p: Placement) =>
          Math.max(0, margin - p.tx) +
          Math.max(0, p.tx + cardW - (vw - margin)) +
          Math.max(0, margin - p.ty) +
          Math.max(0, p.ty + cardH - (vh - margin));
        const best = candidates.reduce((a, b) => (overflow(b) < overflow(a) ? b : a));

        // Clamp into viewport as a final safety net (handles cards larger than viewport).
        const dx =
          Math.max(margin - best.tx, 0) +
          Math.min(0, maxX - (best.tx + cardW));
        const dy =
          Math.max(margin - best.ty, 0) +
          Math.min(0, maxY - (best.ty + cardH));

        // Anchor pos is the pre-transform reference point; reconstruct from tx/ty + transform.
        const anchorX = best.transform.includes("-50%,") ? best.tx + cardW / 2
          : best.transform.includes("-100%,") ? best.tx + cardW : best.tx;
        const anchorY = best.transform.includes(", -50%)") ? best.ty + cardH / 2
          : best.transform.includes(", -100%)") ? best.ty + cardH : best.ty;

        pkEl.style.left = `${anchorX + dx}px`;
        pkEl.style.top = `${anchorY + dy}px`;
        pkEl.style.transform = best.transform;
        pkEl.dataset.placement = best.name;
      }

      // ── Tension tooltip positioning (anchored at curve midpoint) ──
      const ht = hoveredTensionRef.current;
      const htEl = tensionTooltipElRef.current;
      if (ht && htEl && tensionFilaments[ht.index]) {
        const sp = toScreen(tensionFilaments[ht.index].mid);
        htEl.style.left = `${sp.x}px`;
        htEl.style.top = `${sp.y - 12}px`;
      }

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
      layerStack.clear();
      layerStackRef.current = null;
      renderer.dispose();
    };
  }, [loading, theme, statsVersion, tensionsVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = window.innerWidth < 768;

  // Back navigation: layer 3 → 2 (back to project node), layer 2 → 1 (source)
  const goBack = () => {
    const s = useMapStore.getState();
    if (s.currentLayer === 3 && s.context.projectId != null) {
      const exact = projectPositionsRef.current.get(s.context.projectId);
      const proj = projects.find((p) => p.id === s.context.projectId);
      if (exact && proj) {
        navigateToNode(String(proj.id), exact, 2, {
          projectId: proj.id,
          projectName: proj.name,
          parentId: undefined,
          parentLabel: undefined,
        });
        return;
      }
    }
    resetToSource();
  };
  goBackRef.current = goBack;

  return (
    <div style={{ position: "fixed", inset: 0, background: palette.pageBg, fontFamily: "var(--app-font-sans)" }}>
      <style>{STYLES}</style>

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "grab" }}
      />

      {/* Layer label (center of canvas) — Foundation / Architecture / Assets */}
      {/* Hidden when the empty-state overlay is showing, otherwise the hint
          text bleeds through the popup card and overlaps its buttons. */}
      {!(currentLayer === 2 && layer2Empty) && (
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, calc(-50% + 58px))",
          textAlign: "center", pointerEvents: "none", zIndex: 5,
        }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.22em", color: palette.goldText, fontFamily: "var(--app-font-mono)", textTransform: "uppercase" }}>
            {currentLayer === 1 ? "FOUNDATION" : currentLayer === 2 ? "ARCHITECTURE" : "ASSETS"}
          </div>
          <div style={{ marginTop: 4, fontSize: 9, letterSpacing: "0.04em", color: palette.goldText, opacity: 0.6, fontFamily: "var(--app-font-sans)" }}>
            Pulled from your ledger · tap any node to drill in
          </div>
        </div>
      )}

      {/* Project labels — positioned by animation loop */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: currentLayer === 1 ? "block" : "none" }}>
        {projects.map((p, i) => {
          const act = actLevel(p.updatedAt);
          const isHovered = i === hoveredIdx;
          const isActiveProject = p.id === activeProjectId;
          return (
            <div key={p.id} ref={el => { labelEls.current[i] = el; }} style={{
              position: "absolute", transform: "translateX(-50%)", textAlign: "center",
              pointerEvents: "none",
              opacity: hoveredIdx !== null && !isHovered ? 0.28 : 1,
              transition: "opacity 180ms ease",
              ...(isActiveProject ? {
                minWidth: 118,
                padding: "8px 12px 7px",
                borderRadius: 12,
                border: "1px solid rgba(var(--atlas-gold-rgb),0.42)",
                background: "rgba(var(--atlas-bg-rgb),0.68)",
              } : {}),
            }}>
              {isActiveProject && (
                <div style={{
                  position: "absolute",
                  top: -9,
                  right: -7,
                  borderRadius: 999,
                  border: "1px solid rgba(var(--atlas-gold-rgb),0.35)",
                  background: "rgba(var(--atlas-bg-rgb),0.92)",
                  color: "var(--atlas-gold)",
                  fontFamily: "var(--app-font-mono)",
                  fontSize: 7,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  padding: "2px 5px",
                }}>
                  ACTIVE
                </div>
              )}
              <div style={{ fontSize: isHovered ? 11.5 : 10.5, fontWeight: 600, color: isHovered ? (theme === "parchment" ? "#1A1714" : "#E8E5E1") : palette.labelText, letterSpacing: "0.01em", whiteSpace: "nowrap", transition: "font-size 150ms ease, color 150ms ease" }}>
                {p.name}
              </div>
              <div style={{ fontSize: 8.5, color: act > 0.6 ? palette.goldText : palette.mutedText, fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                {actLabel(p.updatedAt)}
              </div>
              {(p.entryCount ?? 0) > 0 && (
                <div style={{ fontSize: 7.5, color: palette.goldText, fontFamily: "var(--app-font-mono)", marginTop: 1, opacity: 0.75 }}>
                  {p.entryCount} decisions
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Loading overlay — while Layer 2/3 children are being fetched */}
      {currentLayer >= 2 && layer2Loading && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 39, pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 14px",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 999,
            backdropFilter: "blur(16px)",
            fontFamily: "var(--app-font-mono)",
            fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
            color: palette.goldText,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              border: `1.5px solid ${palette.goldText}`,
              borderTopColor: "transparent",
              animation: "mm-spin 0.9s linear infinite",
            }} />
            Loading map
          </div>
          <style>{`@keyframes mm-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Empty Layer 2 state — project explored but no decisions yet */}
      {currentLayer === 2 && layer2Empty && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 40, pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{ position: "relative", width: 320, height: 320, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {/* Ghost orbiting node */}
            <div style={{
              position: "absolute", top: 30, left: "50%", transform: "translateX(-50%)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              opacity: 0.18,
            }}>
              <div style={{
                width: 14, height: 14, borderRadius: "50%",
                border: `1px dashed ${palette.goldText}`, background: "transparent",
              }} />
              <div style={{
                fontSize: 9, fontFamily: "var(--app-font-mono)", color: palette.goldText,
                letterSpacing: "0.14em", textTransform: "uppercase",
              }}>
                First Decision
              </div>
            </div>

            {/* Anchor: project name + message */}
            <div style={{
              textAlign: "center", maxWidth: 280,
              padding: "16px 18px 14px",
              borderRadius: 14,
              background: "rgba(var(--atlas-bg-rgb), 0.92)",
              border: `1px solid ${palette.panelBorder}`,
              boxShadow: "0 18px 40px -18px rgba(0,0,0,0.55)",
              backdropFilter: "blur(8px)",
              pointerEvents: "auto",
            }}>
              <div style={{
                fontSize: 15, fontWeight: 600, color: palette.goldTextStrong,
                fontFamily: "var(--app-font-sans)", letterSpacing: "0.01em",
                marginBottom: 8,
              }}>
                {context.projectName ?? "Project"}
              </div>
              {(() => {
                const proj = projects.find(p => p.id === context.projectId);
                const score = proj?.latestSnapshotScore;
                const updated = proj?.updatedAt ? new Date(proj.updatedAt) : null;
                const daysAgo = updated ? Math.floor((Date.now() - updated.getTime()) / 86400000) : null;
                const lastActive = daysAgo === 0 ? "Active today" : daysAgo === 1 ? "Yesterday" : daysAgo != null ? `${daysAgo}d ago` : null;
                const stats = context.projectId ? statsRef.current.get(context.projectId) : undefined;
                const committed = stats?.committed ?? 0;
                const tension = stats?.tension ?? 0;
                const entryCount = proj?.entryCount ?? 0;
                const projectId = context.projectId;
                return (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    {(score != null || lastActive) && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        {score != null && (
                          <span style={{
                            fontSize: 10, fontFamily: "var(--app-font-mono)",
                            color: palette.goldText, letterSpacing: "0.08em",
                            background: "rgba(201,162,76,0.08)",
                            border: "1px solid rgba(201,162,76,0.2)",
                            borderRadius: 4, padding: "2px 6px",
                          }}>
                            {Math.round(score)}% ready
                          </span>
                        )}
                        {lastActive && (
                          <span style={{
                            fontSize: 10, fontFamily: "var(--app-font-mono)",
                            color: palette.mutedText, letterSpacing: "0.06em",
                          }}>
                            {lastActive}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Ledger counts */}
                    <div style={{
                      display: "flex", gap: 14, alignItems: "center",
                      fontSize: 9.5, fontFamily: "var(--app-font-mono)",
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      color: palette.mutedText,
                    }}>
                      <span><strong style={{ color: palette.goldTextStrong, fontWeight: 600 }}>{committed}</strong> committed</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span><strong style={{ color: palette.goldTextStrong, fontWeight: 600 }}>{tension}</strong> in tension</span>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span><strong style={{ color: palette.goldTextStrong, fontWeight: 600 }}>{entryCount}</strong> entries</span>
                    </div>

                    <div style={{
                      fontSize: 11, color: palette.mutedText,
                      fontFamily: "var(--app-font-sans)", lineHeight: 1.55,
                      textAlign: "center",
                    }}>
                      {committed === 0
                        ? <>No decisions committed yet.<br />Name the first thing worth deciding.</>
                        : <>Drill deeper or keep building from where you left off.</>}
                    </div>

                    {/* Quick actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: 2, alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!projectId) return;
                          try { sessionStorage.setItem("atlas-open-tab", "map"); } catch {}
                          setLocation(`/project/${projectId}?view=flow`);
                        }}
                        style={{
                          padding: "6px 14px",
                          background: "rgba(201,162,76,0.12)",
                          border: `1px solid ${palette.goldText}`,
                          borderRadius: 6,
                          color: palette.goldTextStrong,
                          fontSize: 10.5,
                          fontFamily: "var(--app-font-mono)",
                          letterSpacing: "0.06em",
                          cursor: "pointer",
                          textTransform: "uppercase",
                          pointerEvents: "auto",
                        }}
                      >
                        Open flow map →
                      </button>
                      {projectId && (
                        <button
                          type="button"
                          title="Open workspace"
                          aria-label="Open workspace"
                          onClick={() => { window.location.href = `/project/${projectId}`; }}
                          style={{
                            width: 30, height: 30,
                            display: "inline-flex", alignItems: "center", justifyContent: "center",
                            background: "transparent",
                            border: `1px solid ${palette.panelBorder}`,
                            borderRadius: 6,
                            color: palette.goldText,
                            fontSize: 13,
                            fontFamily: "var(--app-font-mono)",
                            cursor: "pointer",
                            pointerEvents: "auto",
                            lineHeight: 1,
                          }}
                        >
                          ↗
                        </button>
                      )}
                      {committed > 0 && projectId && (
                        <button
                          type="button"
                          onClick={() => { window.location.href = `/ledger/${projectId}`; }}
                          style={{
                            padding: "6px 14px",
                            background: "transparent",
                            border: `1px solid ${palette.panelBorder}`,
                            borderRadius: 6,
                            color: palette.goldText,
                            fontSize: 10.5,
                            fontFamily: "var(--app-font-mono)",
                            letterSpacing: "0.06em",
                            cursor: "pointer",
                            textTransform: "uppercase",
                            pointerEvents: "auto",
                          }}
                        >
                          Ledger →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}


      {/* Warp overlay */}
      {warping && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 90, pointerEvents: "none",
          background: palette.pageBg, animation: "warp-dark 900ms cubic-bezier(0.4,0,1,1) both",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: palette.warpBloom,
            animation: "warp-bloom 900ms ease both",
          }} />
          <div style={{
            position: "absolute", inset: 0,
            background: palette.warpConic,
            animation: "warp-conic 900ms ease both",
          }} />
        </div>
      )}

      {/* Peek panel — tooltip above tapped node; positioned by animation loop */}
      {peek && (
        <div
          ref={peekElRef}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            transform: "translate(-50%, -100%)",
            zIndex: 60,
            minWidth: 200,
            width: "min(260px, calc(100vw - 32px))",
            maxWidth: 260,
            padding: "10px 12px 11px",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 10,
            boxShadow: palette.panelShadow,
            backdropFilter: "blur(18px)",
            fontFamily: "var(--app-font-sans)",
            color: palette.labelText,
            pointerEvents: "auto",
            animation: "picker-in 140ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          <button
            onClick={(e) => { e.stopPropagation(); setPeek(null); }}
            aria-label="Dismiss"
            style={{
              position: "absolute", top: 4, right: 6,
              width: 18, height: 18, padding: 0,
              background: "transparent", border: "none",
              color: palette.mutedText, fontSize: 14, lineHeight: 1, cursor: "pointer",
            }}
          >×</button>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: palette.goldTextStrong, letterSpacing: "0.01em", paddingRight: 16, lineHeight: 1.25 }}>
            {peek.name}
          </div>
          <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.1em", marginTop: 2, textTransform: "uppercase" }}>
            Readiness · {peek.score}%
          </div>
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {peek.loading ? (
              <div style={{ fontSize: 10.5, color: palette.mutedText, fontFamily: "var(--app-font-mono)", letterSpacing: "0.08em" }}>
                Loading committed…
              </div>
            ) : peek.entries.length === 0 ? (
              <div style={{ fontSize: 10.5, color: palette.mutedText, fontFamily: "var(--app-font-mono)", letterSpacing: "0.04em", fontStyle: "italic" }}>
                No committed entries yet
              </div>
            ) : (
              peek.entries.map(e => (
                <div key={e.id} style={{
                  fontSize: 11, color: palette.labelText, lineHeight: 1.35,
                  overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box",
                  WebkitLineClamp: 1, WebkitBoxOrient: "vertical",
                }}>
                  <span style={{ color: palette.goldText, marginRight: 6 }}>◆</span>
                  {e.title}
                </div>
              ))
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              const id = peek.projectId;
              setPeek(null);
              warpFnRef.current?.(id);
            }}
            style={{
              marginTop: 10, width: "100%",
              padding: "7px 10px",
              background: theme === "parchment" ? "rgba(180,83,9,0.14)" : "rgba(201,162,76,0.14)",
              border: `1px solid ${palette.panelBorder}`,
              borderRadius: 7,
              color: palette.goldTextStrong,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              fontFamily: "var(--app-font-mono)", cursor: "pointer",
            }}
          >
            Open Project →
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              haptics.tap();
              const proj = projectsRef.current[peek.nodeIdx];
              if (!proj) return;
              const pos = nodePos3D(peek.nodeIdx, projectsRef.current.length);
              setPeek(null);
              navigateToNode(String(proj.id), [pos.x, pos.y, pos.z], 2, {
                projectId: proj.id,
                projectName: proj.name,
              });
            }}
            style={{
              marginTop: 6, width: "100%",
              padding: "7px 10px",
              background: "transparent",
              border: `1px solid ${palette.panelBorder}`,
              borderRadius: 7,
              color: palette.goldTextStrong,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              fontFamily: "var(--app-font-mono)", cursor: "pointer",
            }}
          >
            Explore →
          </button>
          {/* Tail intentionally omitted — placement is dynamic (above/below/left/right);
              a fixed-bottom tail would point into space when the card flips. */}
        </div>
      )}

      {/* Tension tooltip — anchored to filament midpoint; positioned by loop */}
      {hoveredTension && (
        <div
          ref={tensionTooltipElRef}
          style={{
            position: "absolute",
            transform: "translate(-50%, -100%)",
            zIndex: 55,
            minWidth: 200,
            maxWidth: 260,
            padding: "8px 11px 9px",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 9,
            boxShadow: palette.panelShadow,
            backdropFilter: "blur(18px)",
            fontFamily: "var(--app-font-sans)",
            color: palette.labelText,
            pointerEvents: "none",
            animation: "picker-in 120ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          <div style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>
            Tension · {Math.round((hoveredTension.tension.score ?? 0) * 100)}%
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: palette.goldTextStrong, lineHeight: 1.3 }}>
            {hoveredTension.tension.projectA?.name} <span style={{ color: palette.mutedText, margin: "0 5px" }}>↔</span> {hoveredTension.tension.projectB?.name}
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ fontSize: 10.5, color: palette.labelText, lineHeight: 1.35 }}>
              <span style={{ color: palette.goldText, marginRight: 5 }}>◆</span>
              {hoveredTension.tension.entryA?.title}
            </div>
            <div style={{ fontSize: 10.5, color: palette.labelText, lineHeight: 1.35 }}>
              <span style={{ color: palette.goldText, marginRight: 5 }}>◆</span>
              {hoveredTension.tension.entryB?.title}
            </div>
          </div>
        </div>
      )}


      {/* Header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px",
        borderBottom: `1px solid ${palette.headerBorder}`,
        background: palette.headerBg, backdropFilter: "blur(24px)",
      }}>
        <button onClick={() => exitToReferrer("/home")} style={{
          width: 32, height: 32, borderRadius: 8, border: `1px solid ${palette.panelBorder}`,
          background: theme === "parchment" ? "rgba(180,83,9,0.08)" : "rgba(201,162,76,0.06)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", color: palette.goldText, flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13L5 8l5-5" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: palette.mutedText, fontFamily: "var(--app-font-mono)" }}>
            Axiom · Satellite View
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: palette.goldTextStrong, letterSpacing: "0.01em", lineHeight: 1.2 }}>
            Master Map
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {connections.length > 0 && (
            <div style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.08em" }}>
              {connections.length} link{connections.length !== 1 ? "s" : ""}
            </div>
          )}
          <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.08em" }}>
            {projects.length} satellite{projects.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {/* Layer breadcrumb — only shown in Layer 2/3 */}
      {currentLayer > 1 && (
        <div
          onClick={() => { haptics.tap(); goBack(); }}
          style={{
            position: "absolute", top: 64, left: 16, zIndex: 25,
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 11px 6px 8px",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 999,
            boxShadow: palette.panelShadow,
            backdropFilter: "blur(16px)",
            cursor: "pointer",
            fontFamily: "var(--app-font-mono)",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke={palette.goldTextStrong} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13L5 8l5-5" />
          </svg>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: palette.goldTextStrong }}>
            {currentLayer === 3 ? (context.projectName ?? "Project") : "Portfolio"}
          </span>
          {context.projectName && currentLayer === 2 && (
            <>
              <span style={{ color: palette.mutedText, fontSize: 10 }}>·</span>
              <span style={{ fontSize: 10, color: palette.mutedText, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {context.projectName}
              </span>
            </>
          )}
          {context.projectName && currentLayer === 3 && context.parentLabel && (
            <>
              <span style={{ color: palette.mutedText, fontSize: 10 }}>·</span>
              <span style={{ fontSize: 10, color: palette.mutedText, letterSpacing: "0.08em" }}>
                {context.parentLabel}
              </span>
            </>
          )}
        </div>
      )}

      {/* Layer 2/3 node tooltip — glassmorphic, anchored at tapped node */}
      {layer2Tooltip && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            left: layer2Tooltip.x,
            top: layer2Tooltip.y,
            transform: "translate(-50%, calc(-100% - 14px))",
            zIndex: 58,
            minWidth: 200,
            maxWidth: 260,
            padding: "9px 12px 10px",
            background: palette.panelBg,
            border: `1px solid ${palette.panelBorder}`,
            borderRadius: 10,
            boxShadow: palette.panelShadow,
            backdropFilter: "blur(18px)",
            fontFamily: "var(--app-font-sans)",
            color: palette.labelText,
            animation: "picker-in 140ms cubic-bezier(0.22,1,0.36,1) both",
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 600, color: palette.goldTextStrong, lineHeight: 1.3 }}>
            {layer2Tooltip.label}
          </div>
          {layer2Tooltip.description && (
            <div style={{ marginTop: 5, fontSize: 10.5, color: palette.mutedText, lineHeight: 1.4 }}>
              {layer2Tooltip.description}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.1em" }}>
            Initializing constellation…
          </div>
        </div>
      )}

      {/* View Key HUD — floating glassmorphism pod, top-right */}
      {!loading && (
        <ViewKey
          allProjects={projects}
          palette={palette}
          onRecenter={() => recenterFnRef.current?.()}
          onDive={(id) => warpFnRef.current?.(id)}
          onNewIdea={async () => {
            try {
              const res = await fetch(`${BASE_URL}/api/projects`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ name: "New Idea" }),
              });
              if (!res.ok) return;
              const proj = await res.json() as { id: number };
              setLocation(`/project/${proj.id}?view=flow`);
            } catch { /* silent */ }
          }}
        />
      )}

      <div style={{
        position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center",
        pointerEvents: "none", zIndex: 10,
        fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase",
        color: palette.hintText, fontFamily: "var(--app-font-mono)",
      }}>
        {isMobile ? "Tap node · Drag to pan · Pinch to zoom" : "Tap node · Drag to pan · Scroll to zoom"}
      </div>
    </div>
  );
}

// ── ViewKey HUD ───────────────────────────────────────────────────────────────

function ViewKey({ allProjects, palette, onRecenter, onDive, onNewIdea }: {
  allProjects: Project[];
  palette: ScenePalette;
  onRecenter: () => void;
  onDive: (id: number) => void;
  onNewIdea: () => void;
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const flowRootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!flowOpen) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && flowRootRef.current && !flowRootRef.current.contains(target)) {
        setFlowOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFlowOpen(false); };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [flowOpen]);
  const allNodes = [...allProjects];
  const goldSoft = palette.goldText;
  const goldStrong = palette.goldTextStrong;
  const tintBg = palette.pickerItemText.startsWith("#3") ? "rgba(180,83,9,0.10)" : "rgba(201,162,76,0.11)";
  const tintBgHover = palette.pickerItemText.startsWith("#3") ? "rgba(180,83,9,0.18)" : "rgba(201,162,76,0.18)";
  const tintBorder = palette.pickerItemText.startsWith("#3") ? "rgba(180,83,9,0.18)" : "rgba(201,162,76,0.14)";

  return (
    <div ref={flowRootRef} style={{ position: "absolute", top: 68, right: 14, zIndex: 50 }}>
      {/* Glass pod */}
      <div style={{
        background: palette.panelBg,
        backdropFilter: "blur(20px)",
        border: `1px solid ${palette.panelBorder}`,
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: palette.panelShadow,
      }}>
        {/* SATELLITE — active, re-centers camera */}
        <button onClick={onRecenter} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          padding: "10px 14px", width: "100%",
          background: tintBg,
          border: "none", borderBottom: `1px solid ${tintBorder}`,
          cursor: "pointer", color: goldStrong,
          transition: "background 150ms ease",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = tintBgHover)}
          onMouseLeave={(e) => (e.currentTarget.style.background = tintBg)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.28" />
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="11" />
          </svg>
          <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em" }}>SATELLITE</span>
        </button>

        {/* FLOW — opens project quick-picker */}
        <button onClick={() => setFlowOpen(v => !v)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          padding: "10px 14px", width: "100%",
          background: flowOpen ? tintBg : "transparent",
          border: "none", cursor: "pointer",
          color: flowOpen ? goldSoft : palette.mutedText,
          transition: "color 160ms ease, background 160ms ease",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.color = goldSoft; }}
          onMouseLeave={(e) => { if (!flowOpen) e.currentTarget.style.color = palette.mutedText; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="2" />
            <circle cx="5" cy="5" r="1.5" />
            <circle cx="19" cy="5" r="1.5" />
            <circle cx="5" cy="19" r="1.5" />
            <circle cx="19" cy="19" r="1.5" />
            <line x1="6.5" y1="6.5" x2="10.5" y2="10.5" />
            <line x1="17.5" y1="6.5" x2="13.5" y2="10.5" />
            <line x1="6.5" y1="17.5" x2="10.5" y2="13.5" />
            <line x1="17.5" y1="17.5" x2="13.5" y2="13.5" />
          </svg>
          <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em" }}>FLOW</span>
        </button>
      </div>

      {/* Project quick-picker — slides out to the left */}
      {flowOpen && (
        <div style={{
          position: "absolute", top: 0, right: "calc(100% + 8px)",
          background: palette.pickerBg,
          backdropFilter: "blur(22px)",
          border: `1px solid ${palette.pickerBorder}`, borderRadius: 10,
          padding: "6px 0", minWidth: 188, maxHeight: 320, overflowY: "auto",
          boxShadow: palette.pickerShadow,
          animation: "picker-in 140ms cubic-bezier(0.22,1,0.36,1) both",
        }}>
          <div style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", color: palette.mutedText, letterSpacing: "0.12em", padding: "5px 12px 7px", textTransform: "uppercase" }}>
            Select Flow
          </div>
          {/* New idea entry — creates a blank project and opens its Flow */}
          <button onClick={() => { setFlowOpen(false); onNewIdea(); }} style={{
            width: "100%", padding: "8px 12px", background: "transparent", border: "none",
            borderBottom: `1px solid ${tintBorder}`,
            cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
            color: goldSoft, fontSize: 12.5,
            fontFamily: "var(--app-font-sans)", transition: "background 120ms ease",
            marginBottom: 2,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = tintBg)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.8 }}>
              <line x1="8" y1="2" x2="8" y2="14" /><line x1="2" y1="8" x2="14" y2="8" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>New idea</span>
          </button>
          {allNodes.map(p => {
            const hue = nodeHue(p.name);
            return (
              <button key={p.id} onClick={() => { setFlowOpen(false); onDive(p.id); }} style={{
                width: "100%", padding: "8px 12px", background: "transparent", border: "none",
                cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                color: palette.pickerItemText, fontSize: 12.5,
                fontFamily: "var(--app-font-sans)", transition: "background 120ms ease",
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = tintBg)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: `hsl(${hue},55%,55%)`, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes picker-in {
  from { opacity: 0; transform: translateX(8px) scale(0.97); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
@keyframes warp-dark {
  0%   { opacity: 0; }
  35%  { opacity: 0; }
  75%  { opacity: 0.7; }
  100% { opacity: 1; }
}
@keyframes warp-bloom {
  0%   { transform: scale(0.4); opacity: 0; }
  45%  { opacity: 1; }
  100% { transform: scale(5); opacity: 0; }
}
@keyframes warp-conic {
  0%   { transform: rotate(0deg) scale(0.7); opacity: 0; }
  35%  { opacity: 0.8; }
  100% { transform: rotate(12deg) scale(2.5); opacity: 0; }
}
`;
