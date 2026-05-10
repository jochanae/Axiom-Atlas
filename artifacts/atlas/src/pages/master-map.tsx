import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import * as THREE from "three";
import { haptics } from "@/lib/haptics";

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
  isNexus?: boolean;
};
type Connection = { a: number; b: number; strength: number };

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
  const [nR, lR] = await Promise.all([
    fetch(`${BASE_URL}/api/projects/nexus`, { credentials: "include" }),
    fetch(`${BASE_URL}/api/projects`, { credentials: "include" }),
  ]);
  const nexus = nR.ok ? await nR.json() : null;
  const raw: Project[] = lR.ok ? await lR.json() : [];
  return { nexus, list: raw.filter(p => !p.isNexus) };
}

// ── component ────────────────────────────────────────────────────────────────

export default function MasterMap() {
  const [, setLocation] = useLocation();
  const [nexusProject, setNexusProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [warping, setWarping] = useState(false);

  const projectsRef = useRef<Project[]>([]);
  const nexusRef = useRef<Project | null>(null);
  const hoveredIdxRef = useRef<number | null>(null);
  const rippleIds = useRef<Set<number>>(new Set());
  const rippleTimers = useRef<number[]>([]);
  const prevEntryDates = useRef<Map<number, string>>(new Map());
  const gyroTilt = useRef({ x: 0, y: 0 });
  const camZTarget = useRef(CAM_Z);
  const warpTarget = useRef<{ pos: THREE.Vector3; cb: () => void; start: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => { hoveredIdxRef.current = hoveredIdx; }, [hoveredIdx]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { nexusRef.current = nexusProject; }, [nexusProject]);

  // ── data ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    setLoading(true);
    fetchAll().then(({ nexus, list }) => {
      setNexusProject(nexus);
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
    if (loading || !canvasRef.current || !nexusProject) return;
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
    scene.background = new THREE.Color(0x090806);
    scene.fog = new THREE.FogExp2(0x090806, 0.00075);

    // Camera
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 2000);
    camera.position.set(0, 0, CAM_Z);

    // ── Lights ────────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x1a1208, 2.5));

    const goldLight = new THREE.PointLight(0xC9A24C, 8, 800);
    goldLight.position.set(0, 0, 0);
    scene.add(goldLight);

    const fillLight = new THREE.PointLight(0x6040a0, 2.5, 700);
    fillLight.position.set(-200, 300, 200);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0x402010, 2.0, 600);
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
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xC9A24C, size, transparent: true, opacity }));
      scene.add(pts);
      return pts;
    };
    const starsBack = makeStarLayer(500, 2400, -500, 1.0, 0.12);   // distant, very slow
    const starsMid  = makeStarLayer(250, 1200, -200, 1.4, 0.20);   // mid
    const starsFront= makeStarLayer(80,  600,   100, 2.0, 0.30);   // near, fast

    // ── Nexium — faceted icosahedron diamond ──────────────────────────────
    const nexIco = new THREE.IcosahedronGeometry(NEXIUM_R, 1);
    const nexMat = new THREE.MeshPhysicalMaterial({
      color: 0x0D0A06,
      emissive: 0xC9A24C,
      emissiveIntensity: 0.55,
      roughness: 0.12,
      metalness: 0.85,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      reflectivity: 1.0,
    });
    const nexMesh = new THREE.Mesh(nexIco, nexMat);
    scene.add(nexMesh);

    // Nexium wireframe cage
    const nexWire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(NEXIUM_R * 1.12, 1),
      new THREE.MeshBasicMaterial({ color: 0xC9A24C, wireframe: true, transparent: true, opacity: 0.12 }),
    );
    scene.add(nexWire);

    // Nexium orbit ring
    const nexRingMesh = new THREE.Mesh(
      new THREE.TorusGeometry(NEXIUM_R * 1.55, 1.2, 8, 80),
      new THREE.MeshBasicMaterial({ color: 0xC9A24C, transparent: true, opacity: 0.28 }),
    );
    nexRingMesh.rotation.x = Math.PI / 2.8;
    scene.add(nexRingMesh);

    // Nexium "SOURCE" label handled in HTML overlay — we add a ref below

    // ── Project nodes — glass spheres ─────────────────────────────────────
    const projs = projectsRef.current;
    const positions: THREE.Vector3[] = projs.map((_, i) => nodePos3D(i, projs.length));
    const nodeMeshes: THREE.Mesh[] = [];
    const rippleMeshes: THREE.Mesh[] = [];
    rippleTimers.current = new Array(projs.length).fill(0);

    projs.forEach((p, i) => {
      const act = actLevel(p.updatedAt);
      const col = nodeColor(p.name);
      const glass = nodeGlassColor(p.name);

      // Glass sphere
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(NODE_R, 36, 36),
        new THREE.MeshPhysicalMaterial({
          color: glass,
          emissive: col,
          emissiveIntensity: 0.12 + act * 0.32,
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
      scene.add(mesh);
      nodeMeshes.push(mesh);

      // Ripple ring (billboarded)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(NODE_R, 1.5, 8, 64),
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, side: THREE.DoubleSide }),
      );
      ring.position.copy(positions[i]);
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
        color: 0xC9A24C, transparent: true, opacity: 0.08 + act * 0.22,
      })));

      // Tracer bead — pulses outward from Nexium
      const tracerMesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xC9A24C, transparent: true, opacity: 0 }),
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

    // ── Raycasting ────────────────────────────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    const hitTest = (cx: number, cy: number) => {
      const rect = canvas.getBoundingClientRect();
      ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
      return raycaster.intersectObjects([nexMesh, ...nodeMeshes]);
    };

    const toScreen = (pos3d: THREE.Vector3) => {
      const v = pos3d.clone().project(camera);
      return { x: (v.x * 0.5 + 0.5) * canvas.clientWidth, y: (-v.y * 0.5 + 0.5) * canvas.clientHeight };
    };

    const warpTo = (destId: number, targetPos: THREE.Vector3) => {
      const camNow = camera.position.clone();
      const dir = targetPos.clone().sub(camNow).normalize();
      warpTarget.current = {
        pos: camNow.clone().add(dir.multiplyScalar(500)),
        start: Date.now(),
        cb: () => setLocation(`/project/${destId}`),
      };
      setWarping(true);
      setTimeout(() => {
        if (!warpTarget.current) return;
        setLocation(`/project/${destId}`);
      }, 950);
    };

    const handleClick = (cx: number, cy: number) => {
      const hits = hitTest(cx, cy);
      if (!hits.length) return;
      const obj = hits[0].object as THREE.Mesh;
      haptics.tap();
      if (obj === nexMesh || obj === nexWire) {
        const nex = nexusRef.current;
        if (nex) warpTo(nex.id, new THREE.Vector3(0, 0, 0));
        return;
      }
      const idx = nodeMeshes.indexOf(obj);
      if (idx < 0) return;
      const proj = projectsRef.current[idx];
      warpTo(proj.id, nodeMeshes[idx].position);
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
      if (hits.length) {
        const obj = hits[0].object as THREE.Mesh;
        const i = nodeMeshes.indexOf(obj);
        setHoveredIdx(i >= 0 ? i : null);
      } else {
        setHoveredIdx(null);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camZTarget.current = Math.max(260, Math.min(800, camZTarget.current + e.deltaY * 0.28));
    };

    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd);
    canvas.addEventListener("mousemove", onMouseMove);
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
      const t = (Date.now() - t0) / 1000;

      // ── Nexium rotation + breathe ──
      nexMesh.rotation.y = t * 0.22;
      nexMesh.rotation.x = t * 0.11;
      nexWire.rotation.y = -t * 0.14;
      nexWire.rotation.x = t * 0.07;
      nexRingMesh.rotation.z = t * 0.08;
      const glow = 0.45 + Math.sin(t * 1.8) * 0.15;
      nexMat.emissiveIntensity = glow;
      goldLight.intensity = 6 + Math.sin(t * 1.8) * 2;

      // ── Gyro parallax (true layered depth) ──
      const gx = gyroTilt.current.x;
      const gy = gyroTilt.current.y;
      // Camera position drifts with gyro — each Z-layer appears to shift at different rate
      camera.position.x += (gy * 95 - camera.position.x) * 0.032;
      camera.position.y += (-gx * 70 - camera.position.y) * 0.032;
      camera.position.z += (camZTarget.current - camera.position.z) * 0.07;
      // Star layers parallax: further back = moves less (nearer to camera parallaxes faster)
      starsBack.position.x  = camera.position.x * 0.12;
      starsBack.position.y  = camera.position.y * 0.12;
      starsMid.position.x   = camera.position.x * 0.28;
      starsMid.position.y   = camera.position.y * 0.28;
      starsFront.position.x = camera.position.x * 0.55;
      starsFront.position.y = camera.position.y * 0.55;
      camera.lookAt(0, 0, 0);

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

      // ── Node hover glow + scale ──
      nodeMeshes.forEach((mesh, i) => {
        const hovered = i === hoveredIdxRef.current;
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        const base = 0.12 + actLevel(projectsRef.current[i]?.updatedAt ?? "") * 0.3;
        mat.emissiveIntensity = hovered ? base + 0.32 + Math.sin(t * 3.5) * 0.12 : base;
        const tgt = hovered ? 1.15 : 1.0;
        mesh.scale.setScalar(mesh.scale.x + (tgt - mesh.scale.x) * 0.11);
      });

      // ── Ripple rings ──
      rippleMeshes.forEach((ring, i) => {
        const pid = projectsRef.current[i]?.id;
        const active = pid !== undefined &&
          (rippleIds.current.has(pid) || isRecentEntry(projectsRef.current[i]?.latestEntryAt));
        ring.lookAt(camera.position);
        const mat = ring.material as THREE.MeshBasicMaterial;
        if (active) {
          rippleTimers.current[i] = (rippleTimers.current[i] + 0.011) % 1;
          const rt = rippleTimers.current[i];
          ring.scale.setScalar(1 + rt * 3.2);
          mat.opacity = 0.6 * (1 - rt);
        } else {
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
        el.style.top = `${sp.y + NODE_R + 7}px`;
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
    };
  }, [loading, nexusProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#090806", fontFamily: "var(--app-font-sans)" }}>
      <style>{STYLES}</style>

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "crosshair" }}
      />

      {/* Nexium label (center of canvas) */}
      <div style={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, calc(-50% + 58px))",
        textAlign: "center", pointerEvents: "none", zIndex: 5,
      }}>
        <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.22em", color: "rgba(201,162,76,0.55)", fontFamily: "var(--app-font-mono)", textTransform: "uppercase" }}>
          SOURCE
        </div>
      </div>

      {/* Project labels — positioned by animation loop */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {projects.map((p, i) => {
          const act = actLevel(p.updatedAt);
          const isHovered = i === hoveredIdx;
          return (
            <div key={p.id} ref={el => { labelEls.current[i] = el; }} style={{
              position: "absolute", transform: "translateX(-50%)", textAlign: "center",
              pointerEvents: "none",
              opacity: hoveredIdx !== null && !isHovered ? 0.28 : 1,
              transition: "opacity 180ms ease",
            }}>
              <div style={{ fontSize: isHovered ? 11.5 : 10.5, fontWeight: 600, color: isHovered ? "rgba(231,229,228,1)" : "rgba(231,229,228,0.58)", letterSpacing: "0.01em", whiteSpace: "nowrap", transition: "font-size 150ms ease, color 150ms ease" }}>
                {p.name}
              </div>
              <div style={{ fontSize: 8.5, color: act > 0.6 ? "rgba(201,162,76,0.65)" : "rgba(120,113,108,0.42)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                {actLabel(p.updatedAt)}
              </div>
              {(p.entryCount ?? 0) > 0 && (
                <div style={{ fontSize: 7.5, color: "rgba(201,162,76,0.3)", fontFamily: "var(--app-font-mono)", marginTop: 1 }}>
                  {p.entryCount} decisions
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Warp overlay */}
      {warping && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 90, pointerEvents: "none",
          background: "#090806", animation: "warp-dark 900ms cubic-bezier(0.4,0,1,1) both",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 55% 55% at 50% 50%, rgba(201,162,76,0.18) 0%, transparent 65%)",
            animation: "warp-bloom 900ms ease both",
          }} />
          <div style={{
            position: "absolute", inset: 0,
            background: "repeating-conic-gradient(rgba(201,162,76,0.035) 0deg 1.5deg, transparent 1.5deg 20deg)",
            animation: "warp-conic 900ms ease both",
          }} />
        </div>
      )}

      {/* Header */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 20,
        display: "flex", alignItems: "center", gap: 10, padding: "12px 16px 10px",
        borderBottom: "1px solid rgba(201,162,76,0.07)",
        background: "rgba(9,8,6,0.78)", backdropFilter: "blur(16px)",
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
          <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,162,76,0.45)", fontFamily: "var(--app-font-mono)" }}>
            Axiom · Satellite View
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: "rgba(201,162,76,0.92)", letterSpacing: "0.01em", lineHeight: 1.2 }}>
            Master Map
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          {connections.length > 0 && (
            <div style={{ fontSize: 8.5, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.35)", letterSpacing: "0.08em" }}>
              {connections.length} link{connections.length !== 1 ? "s" : ""}
            </div>
          )}
          <div style={{ fontSize: 9, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.38)", letterSpacing: "0.08em" }}>
            {projects.length} satellite{projects.length !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      {loading && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 10 }}>
          <div style={{ fontSize: 11, fontFamily: "var(--app-font-mono)", color: "rgba(201,162,76,0.35)", letterSpacing: "0.1em" }}>
            Initializing constellation…
          </div>
        </div>
      )}

      <div style={{
        position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center",
        pointerEvents: "none", zIndex: 10,
        fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase",
        color: "rgba(201,162,76,0.13)", fontFamily: "var(--app-font-mono)",
      }}>
        {isMobile ? "Tap node to dive · Tilt for parallax depth" : "Tap node to dive · Scroll to zoom"}
      </div>
    </div>
  );
}

// ── CSS ──────────────────────────────────────────────────────────────────────

const STYLES = `
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
