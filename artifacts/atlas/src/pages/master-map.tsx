import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import * as THREE from "three";
import { haptics } from "@/lib/haptics";

const BASE_URL = (import.meta as any).env?.BASE_URL?.replace?.(/\/$/, "") ?? "";
const POLL_INTERVAL = 30_000;
const ORBIT_R = 220;
const NEXIUM_HALF = 42;
const NODE_R = 22;
const CAM_Z_DEFAULT = 520;

type Project = {
  id: number;
  name: string;
  updatedAt: string;
  entryCount?: number;
  latestEntryAt?: string | null;
  isNexus?: boolean;
};
type Connection = { a: number; b: number; strength: number };
type ScreenPos = { x: number; y: number };

// ── helpers ────────────────────────────────────────────────────────────────

function actLevel(updatedAt: string): number {
  const h = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (h < 24) return 1.0;
  if (h < 72) return 0.65;
  if (h < 168) return 0.35;
  return 0.15;
}
function actLabel(updatedAt: string): string {
  const h = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000;
  if (h < 1) return "Active now";
  if (h < 24) return "Active today";
  if (h < 48) return "Yesterday";
  if (h < 168) return `${Math.floor(h / 24)}d ago`;
  return `${Math.floor(h / 168)}w ago`;
}
function isRecentEntry(lat?: string | null) {
  return !!lat && (Date.now() - new Date(lat).getTime()) < 2 * 3_600_000;
}
function nodeHue(name: string) { return (name.charCodeAt(0) * 47 + name.length * 13) % 360; }
function nodeThreeColor(name: string) { return new THREE.Color().setHSL(nodeHue(name) / 360, 0.55, 0.45); }
function nodePos3D(i: number, total: number): THREE.Vector3 {
  const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
  return new THREE.Vector3(
    Math.cos(angle) * ORBIT_R,
    Math.sin(angle) * ORBIT_R,
    Math.sin(i * 1.618) * 50,
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
  const [nR, lR] = await Promise.all([
    fetch(`${BASE_URL}/api/projects/nexus`, { credentials: "include" }),
    fetch(`${BASE_URL}/api/projects`, { credentials: "include" }),
  ]);
  const nexus = nR.ok ? await nR.json() : null;
  const raw: Project[] = lR.ok ? await lR.json() : [];
  return { nexus, list: raw.filter(p => !p.isNexus) };
}

// ── component ───────────────────────────────────────────────────────────────

export default function MasterMap() {
  const [, setLocation] = useLocation();
  const [nexusProject, setNexusProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const [focusedPos, setFocusedPos] = useState<ScreenPos | null>(null);
  const [warping, setWarping] = useState(false);

  // mutable refs (read inside Three.js loop without stale closures)
  const projectsRef = useRef<Project[]>([]);
  const nexusRef = useRef<Project | null>(null);
  const focusedIdRef = useRef<number | null>(null);
  const rippleIds = useRef<Set<number>>(new Set());
  const rippleTimers = useRef<number[]>([]);
  const prevEntryDates = useRef<Map<number, string>>(new Map());
  const gyroTilt = useRef({ x: 0, y: 0 });
  const camZTarget = useRef(CAM_Z_DEFAULT);
  const warpTarget = useRef<{ pos: THREE.Vector3; cb: () => void; start: number } | null>(null);

  // three.js object refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // sync refs
  useEffect(() => { focusedIdRef.current = focusedId; }, [focusedId]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { nexusRef.current = nexusProject; }, [nexusProject]);

  // initial fetch
  useEffect(() => {
    setLoading(true);
    fetchAll().then(({ nexus, list }) => {
      setNexusProject(nexus);
      setProjects(list);
      setConnections(buildConns(list));
      const m = new Map<number, string>();
      list.forEach(p => { if (p.latestEntryAt) m.set(p.id, p.latestEntryAt); });
      prevEntryDates.current = m;
      const recent = new Set(list.filter(p => isRecentEntry(p.latestEntryAt)).map(p => p.id));
      rippleIds.current = recent;
    }).finally(() => setLoading(false));
  }, []);

  // polling
  useEffect(() => {
    if (loading) return;
    const id = setInterval(() => {
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
    return () => clearInterval(id);
  }, [loading]);

  // gyroscope
  useEffect(() => {
    const handler = (e: DeviceOrientationEvent) => {
      gyroTilt.current = {
        x: ((e.beta ?? 45) - 45) / 90 * 0.18,
        y: (e.gamma ?? 0) / 90 * 0.25,
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

  // Three.js scene — rebuilds when data is ready
  useEffect(() => {
    if (loading || !canvasRef.current || !nexusProject) return;
    const canvas = canvasRef.current;
    const W = canvas.offsetWidth || window.innerWidth;
    const H = canvas.offsetHeight || window.innerHeight;

    // ── Scene ──────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0C0A09);
    scene.fog = new THREE.FogExp2(0x0C0A09, 0.0008);

    const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 2000);
    camera.position.set(0, 0, CAM_Z_DEFAULT);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRef.current = renderer;

    // ── Lights ─────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x2a1f10, 1.8));
    const centerLight = new THREE.PointLight(0xC9A24C, 5.5, 750);
    scene.add(centerLight);
    const rimLight = new THREE.PointLight(0x4a3010, 2.0, 900);
    rimLight.position.set(0, 300, -200);
    scene.add(rimLight);

    // ── Starfield ──────────────────────────────────────
    const starGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(700 * 3);
    for (let i = 0; i < 700; i++) {
      sPos[i*3]   = (Math.random() - 0.5) * 2000;
      sPos[i*3+1] = (Math.random() - 0.5) * 2000;
      sPos[i*3+2] = (Math.random() - 0.5) * 900 - 200;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xC9A24C, size: 1.1, transparent: true, opacity: 0.16 }));
    scene.add(stars);

    // ── Nexium ─────────────────────────────────────────
    const nexMesh = new THREE.Mesh(
      new THREE.BoxGeometry(NEXIUM_HALF * 2, NEXIUM_HALF * 2, NEXIUM_HALF * 2),
      new THREE.MeshStandardMaterial({ color: 0x1C1208, emissive: 0xC9A24C, emissiveIntensity: 0.4, roughness: 0.45, metalness: 0.75 }),
    );
    scene.add(nexMesh);

    // ── Project nodes ──────────────────────────────────
    const projs = projectsRef.current;
    const positions: THREE.Vector3[] = projs.map((_, i) => nodePos3D(i, projs.length));
    const nodeMeshes: THREE.Mesh[] = [];
    const rippleMeshes: THREE.Mesh[] = [];
    rippleTimers.current = new Array(projs.length).fill(0);

    projs.forEach((p, i) => {
      const col = nodeThreeColor(p.name);
      const act = actLevel(p.updatedAt);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(NODE_R, 28, 28),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.1 + act * 0.35, roughness: 0.6, metalness: 0.35 }),
      );
      mesh.position.copy(positions[i]);
      scene.add(mesh);
      nodeMeshes.push(mesh);

      // ripple torus (billboard in loop)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(NODE_R, 1.8, 8, 64),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide }),
      );
      ring.position.copy(positions[i]);
      scene.add(ring);
      rippleMeshes.push(ring);
    });

    // ── Spokes (Nexium → nodes) ────────────────────────
    projs.forEach((p, i) => {
      const act = actLevel(p.updatedAt);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, positions[i].x, positions[i].y, positions[i].z]), 3,
      ));
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: 0xC9A24C, transparent: true, opacity: 0.1 + act * 0.3,
      })));
    });

    // ── Neural filament curves ─────────────────────────
    buildConns(projs).forEach(({ a, b, strength }) => {
      const pA = positions[a], pB = positions[b];
      const mid = pA.clone().add(pB).multiplyScalar(0.5);
      const dir = pB.clone().sub(pA);
      const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar(65);
      mid.add(perp).setZ(mid.z + 25);
      const curve = new THREE.QuadraticBezierCurve3(pA, mid, pB);
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(50));
      const colA = nodeThreeColor(projs[a].name);
      const blended = colA.clone().lerp(nodeThreeColor(projs[b].name), 0.5);
      scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: blended, transparent: true, opacity: 0.07 + strength * 0.24,
      })));
    });

    // ── Raycaster ──────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const hitTest = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObjects([nexMesh, ...nodeMeshes]);
    };

    const projectToScreen = (pos3d: THREE.Vector3) => {
      const v = pos3d.clone().project(camera);
      return {
        x: (v.x * 0.5 + 0.5) * canvas.clientWidth,
        y: (-v.y * 0.5 + 0.5) * canvas.clientHeight,
      };
    };

    const handleClick = (cx: number, cy: number) => {
      const hits = hitTest(cx, cy);
      if (!hits.length) { setFocusedId(null); setFocusedPos(null); return; }
      const obj = hits[0].object as THREE.Mesh;
      if (obj === nexMesh) {
        haptics.tap();
        const nex = nexusRef.current;
        if (nex) setLocation(`/project/${nex.id}`);
        return;
      }
      const idx = nodeMeshes.indexOf(obj);
      if (idx < 0) return;
      const proj = projectsRef.current[idx];
      haptics.tap();
      if (focusedIdRef.current === proj.id) {
        setFocusedId(null); setFocusedPos(null);
      } else {
        setFocusedId(proj.id);
        setFocusedPos(projectToScreen(nodeMeshes[idx].position));
      }
    };

    const onCanvasClick = (e: MouseEvent) => handleClick(e.clientX, e.clientY);
    let tx = 0, ty = 0;
    const onTouchStart = (e: TouchEvent) => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; };
    const onTouchEnd = (e: TouchEvent) => {
      const t = e.changedTouches[0];
      if (Math.abs(t.clientX - tx) < 10 && Math.abs(t.clientY - ty) < 10)
        handleClick(t.clientX, t.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      const hits = hitTest(e.clientX, e.clientY);
      canvas.style.cursor = hits.length ? "pointer" : "crosshair";
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZTarget.current = Math.max(280, Math.min(780, camZTarget.current + e.deltaY * 0.28));
    };

    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // ── Resize ─────────────────────────────────────────
    const onResize = () => {
      const nw = canvas.offsetWidth, nh = canvas.offsetHeight;
      camera.aspect = nw / nh; camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(canvas.parentElement!);

    // ── Animation loop ─────────────────────────────────
    let frameId = 0;
    const t0 = Date.now();

    const loop = () => {
      frameId = requestAnimationFrame(loop);
      const t = (Date.now() - t0) / 1000;

      // Nexium spin + breathe
      nexMesh.rotation.y = t * 0.2;
      nexMesh.rotation.x = t * 0.1;
      (nexMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.35 + Math.sin(t * 1.6) * 0.13;

      // Stars slow drift
      stars.rotation.y = t * 0.00015;

      // Gyro smooth lerp
      camera.rotation.x += (gyroTilt.current.x - camera.rotation.x) * 0.04;
      camera.rotation.y += (gyroTilt.current.y - camera.rotation.y) * 0.04;

      // Zoom
      camera.position.z += (camZTarget.current - camera.position.z) * 0.07;

      // Warp camera dive
      if (warpTarget.current) {
        const elapsed = Date.now() - warpTarget.current.start;
        const ease = Math.min(elapsed / 780, 1);
        camera.position.lerp(warpTarget.current.pos, 0.08 + ease * 0.06);
        if (elapsed >= 780) {
          const cb = warpTarget.current.cb;
          warpTarget.current = null;
          cb();
        }
      }

      // Node focused glow + scale
      nodeMeshes.forEach((mesh, i) => {
        const pid = projectsRef.current[i]?.id;
        const focused = pid === focusedIdRef.current;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        const base = 0.1 + actLevel(projectsRef.current[i]?.updatedAt ?? "") * 0.35;
        mat.emissiveIntensity = focused ? base + 0.28 + Math.sin(t * 3.2) * 0.1 : base;
        const targetScale = focused ? 1.18 : 1.0;
        mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * 0.12);
      });

      // Ripple rings
      rippleMeshes.forEach((ring, i) => {
        const pid = projectsRef.current[i]?.id;
        const active = pid !== undefined &&
          (rippleIds.current.has(pid) || isRecentEntry(projectsRef.current[i]?.latestEntryAt));
        ring.lookAt(camera.position);
        const mat = ring.material as THREE.MeshBasicMaterial;
        if (active) {
          rippleTimers.current[i] = (rippleTimers.current[i] + 0.011) % 1;
          const rt = rippleTimers.current[i];
          ring.scale.setScalar(1 + rt * 3.0);
          mat.opacity = 0.65 * (1 - rt);
        } else {
          mat.opacity = 0;
          rippleTimers.current[i] = 0;
        }
      });

      // Labels — direct DOM update (no React re-render)
      labelEls.current.forEach((el, i) => {
        if (!el || !nodeMeshes[i]) return;
        const sp = projectToScreen(nodeMeshes[i].position);
        el.style.left = `${sp.x}px`;
        el.style.top = `${sp.y + NODE_R + 8}px`;
      });

      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [loading, nexusProject]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Navigate with warp ─────────────────────────────────────────────────
  const navigate = useCallback((id: number, openMap = false) => {
    haptics.tap();
    const idx = projectsRef.current.findIndex(p => p.id === id);
    const renderer = rendererRef.current;
    if (idx >= 0 && renderer) {
      // We need camera and node mesh pos — read from canvas via renderer
      // Access scene objects via a ref is not ideal; use a simple approach:
      // Just fire warp overlay + navigate after delay
    }
    setWarping(true);
    setTimeout(() => {
      try { if (openMap) sessionStorage.setItem("atlas-open-tab", "map"); } catch {}
      setLocation(`/project/${id}`);
    }, 820);
  }, [setLocation]);

  const focusedProject = focusedId !== null ? projects.find(p => p.id === focusedId) : null;
  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0C0A09", fontFamily: "var(--app-font-sans)" }}>
      <style>{STYLES}</style>

      {/* WebGL canvas */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
      />

      {/* Label overlay — positions set directly in animation loop */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {projects.map((p, i) => {
          const act = actLevel(p.updatedAt);
          const isFocused = p.id === focusedId;
          return (
            <div
              key={p.id}
              ref={el => { labelEls.current[i] = el; }}
              style={{
                position: "absolute", transform: "translateX(-50%)",
                textAlign: "center", pointerEvents: "none",
                opacity: focusedId !== null && !isFocused ? 0.38 : 1,
                transition: "opacity 220ms ease",
              }}
            >
              <div style={{ fontSize: 10.5, fontWeight: 600, color: isFocused ? "rgba(231,229,228,0.95)" : "rgba(231,229,228,0.62)", letterSpacing: "0.01em", whiteSpace: "nowrap" }}>
                {p.name}
              </div>
              <div style={{ fontSize: 8.5, color: act > 0.6 ? "rgba(201,162,76,0.65)" : "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                {actLabel(p.updatedAt)}
              </div>
              {(p.entryCount ?? 0) > 0 && (
                <div style={{ fontSize: 7.5, color: "rgba(201,162,76,0.32)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                  {p.entryCount} decisions
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Action card (pointer-events: auto so buttons work) */}
      {focusedProject && focusedPos && (
        <NodeCard
          project={focusedProject}
          pos={focusedPos}
          onClose={() => { setFocusedId(null); setFocusedPos(null); }}
          onWorkspace={() => navigate(focusedProject.id)}
          onMap={() => navigate(focusedProject.id, true)}
        />
      )}

      {/* Warp overlay */}
      {warping && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 90, pointerEvents: "none",
          background: "#0C0A09",
          animation: "warp-fade 820ms ease both",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(201,162,76,0.12) 0%, transparent 70%)",
            animation: "warp-zoom 820ms ease both",
          }} />
          <div style={{
            position: "absolute", inset: 0,
            backgroundImage: `repeating-conic-gradient(rgba(201,162,76,0.04) 0deg 2deg, transparent 2deg 18deg)`,
            animation: "warp-spin 820ms linear both",
          }} />
        </div>
      )}

      {/* Header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px 10px",
        borderBottom: "1px solid rgba(201,162,76,0.08)",
        background: "rgba(12,10,9,0.72)", backdropFilter: "blur(14px)",
      }}>
        <button onClick={() => setLocation("/home")} style={{
          width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(201,162,76,0.18)",
          background: "rgba(201,162,76,0.06)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", color: "rgba(201,162,76,0.7)", flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13L5 8l5-5" />
          </svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,162,76,0.5)", fontFamily: "var(--app-font-mono)" }}>Axiom</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "rgba(201,162,76,0.9)", letterSpacing: "0.01em", lineHeight: 1.2 }}>Master Map</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {connections.length > 0 && (
            <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.35)", letterSpacing: "0.08em" }}>
              {connections.length} link{connections.length !== 1 ? "s" : ""}
            </div>
          )}
          <div style={{ fontSize: 10, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.4)", letterSpacing: "0.08em" }}>
            {projects.length} project{projects.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.4)", letterSpacing: "0.1em" }}>
            Loading constellation…
          </div>
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center",
        pointerEvents: "none", zIndex: 10,
        fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase",
        color: "rgba(201,162,76,0.15)", fontFamily: "var(--app-font-mono)",
      }}>
        {isMobile ? "Tap node · Tilt device for parallax" : "Tap node · Scroll to zoom"}
      </div>
    </div>
  );
}

// ── NodeCard ────────────────────────────────────────────────────────────────

function NodeCard({ project, pos, onClose, onWorkspace, onMap }: {
  project: Project; pos: ScreenPos;
  onClose: () => void; onWorkspace: () => void; onMap: () => void;
}) {
  const CARD_W = 214, CARD_H = 155;
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = pos.x - CARD_W / 2;
  let top = pos.y + NODE_R + 14;
  left = Math.max(8, Math.min(left, vw - CARD_W - 8));
  if (top + CARD_H > vh - 8) top = pos.y - CARD_H - NODE_R - 8;
  if (top < 56) top = 56;

  const hue = nodeHue(project.name);
  const act = actLevel(project.updatedAt);

  return (
    <div style={{
      position: "absolute", left, top, width: CARD_W, zIndex: 50,
      background: "rgba(14,11,8,0.97)",
      border: `1px solid hsla(${hue},55%,55%,0.38)`,
      borderRadius: 12, padding: "12px 14px",
      boxShadow: `0 12px 40px rgba(0,0,0,0.85), 0 0 0 1px rgba(0,0,0,0.4), 0 0 24px -8px hsla(${hue},55%,55%,0.2)`,
      animation: "card-in 150ms ease both",
      fontFamily: "var(--app-font-sans)",
    }}>
      <button onClick={onClose} style={{
        position: "absolute", top: 7, right: 8, background: "none", border: "none",
        cursor: "pointer", color: "rgba(120,113,108,0.45)", fontSize: 13, lineHeight: 1, padding: "2px 4px",
      }}>✕</button>
      <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(231,229,228,0.9)", marginBottom: 1, paddingRight: 18, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {project.name}
      </div>
      <div style={{ fontSize: 9, color: "rgba(120,113,108,0.45)", fontFamily: "var(--app-font-mono)", marginBottom: 10, display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: act > 0.6 ? "rgba(201,162,76,0.55)" : "rgba(120,113,108,0.45)" }}>{actLabel(project.updatedAt)}</span>
        {(project.entryCount ?? 0) > 0 && (
          <span style={{ color: "rgba(201,162,76,0.35)" }}>· {project.entryCount} decision{project.entryCount !== 1 ? "s" : ""}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button onClick={onWorkspace} style={{
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
        <button onClick={onMap} style={{
          width: "100%", padding: "7px 10px", borderRadius: 7,
          background: "transparent", border: "1px solid rgba(201,162,76,0.1)",
          color: "rgba(120,113,108,0.6)", fontSize: 11,
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
}

// ── CSS ─────────────────────────────────────────────────────────────────────

const STYLES = `
@keyframes card-in {
  from { opacity: 0; transform: translateY(5px) scale(0.97); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes warp-fade {
  0%   { opacity: 0; }
  30%  { opacity: 0; }
  70%  { opacity: 0.6; }
  100% { opacity: 1; }
}
@keyframes warp-zoom {
  0%   { transform: scale(0.5); opacity: 0; }
  50%  { opacity: 1; }
  100% { transform: scale(4); opacity: 0; }
}
@keyframes warp-spin {
  0%   { transform: rotate(0deg) scale(0.8); opacity: 0; }
  40%  { opacity: 0.6; }
  100% { transform: rotate(8deg) scale(2); opacity: 0; }
}
`;
