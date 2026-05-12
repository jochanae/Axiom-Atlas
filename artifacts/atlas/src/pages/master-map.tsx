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
  const lR = await fetch(`${BASE_URL}/api/projects`, { credentials: "include" });
  const raw: Project[] = lR.ok ? await lR.json() : [];
  return { nexus: null, list: raw };
}

// ── component ────────────────────────────────────────────────────────────────

export default function MasterMap() {
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [warping, setWarping] = useState(false);

  const projectsRef = useRef<Project[]>([]);
  const hoveredIdxRef = useRef<number | null>(null);
  const rippleIds = useRef<Set<number>>(new Set());
  const rippleTimers = useRef<number[]>([]);
  const prevEntryDates = useRef<Map<number, string>>(new Map());
  const gyroTilt = useRef({ x: 0, y: 0 });
  const camZTarget = useRef(CAM_Z);
  const warpTarget = useRef<{ pos: THREE.Vector3; cb: () => void; start: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelEls = useRef<(HTMLDivElement | null)[]>([]);
  const panRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const warpFnRef = useRef<((destId: number) => void) | null>(null);
  const recenterFnRef = useRef<(() => void) | null>(null);

  useEffect(() => { hoveredIdxRef.current = hoveredIdx; }, [hoveredIdx]);
  useEffect(() => { projectsRef.current = projects; }, [projects]);

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

    const warpTo = (destId: number, targetPos: THREE.Vector3, params = "") => {
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

    const handleClick = (cx: number, cy: number) => {
      const hits = hitTest(cx, cy);
      if (!hits.length) return;
      const obj = hits[0].object as THREE.Mesh;
      haptics.tap();
      if (obj === nexMesh || obj === nexWire) {
        setWarping(true);
        setTimeout(() => setLocation("/nexus"), 950);
        return;
      }
      const idx = nodeMeshes.indexOf(obj);
      if (idx < 0) return;
      const proj = projectsRef.current[idx];
      warpTo(proj.id, nodeMeshes[idx].position, "?view=flow");
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
        canvas.style.cursor = hits.length ? "pointer" : "grab";
        if (hits.length) {
          const obj = hits[0].object as THREE.Mesh;
          const i = nodeMeshes.indexOf(obj);
          setHoveredIdx(i >= 0 ? i : null);
        } else {
          setHoveredIdx(null);
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

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        tStartX = tLastX = e.touches[0].clientX;
        tStartY = tLastY = e.touches[0].clientY;
        isTouchDrag = false;
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
        if (isTouchDrag) {
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
        if (!isTouchDrag) {
          const t = e.changedTouches[0];
          handleClick(t.clientX, t.clientY);
        }
        isTouchDrag = false;
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

      // ── Camera: gyro + pan offset + zoom ──
      const gx = gyroTilt.current.x;
      const gy = gyroTilt.current.y;
      // Rubber-band: spring pan back toward center if beyond threshold
      const panDist = Math.hypot(panRef.current.x, panRef.current.y);
      if (!isDraggingRef.current && panDist > 480) {
        panRef.current.x *= 0.96;
        panRef.current.y *= 0.96;
      }
      const targetX = gy * 95 + panRef.current.x;
      const targetY = -gx * 70 + panRef.current.y;
      camera.position.x += (targetX - camera.position.x) * 0.055;
      camera.position.y += (targetY - camera.position.y) * 0.055;
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
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("wheel", onWheel);
      ro.disconnect();
      renderer.dispose();
    };
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#090806", fontFamily: "var(--app-font-sans)" }}>
      <style>{STYLES}</style>

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "grab" }}
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
        <button onClick={() => setLocation("/nexus")} style={{
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

      {/* View Key HUD — floating glassmorphism pod, top-right */}
      {!loading && (
        <ViewKey
          allProjects={projects}
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
        color: "rgba(201,162,76,0.13)", fontFamily: "var(--app-font-mono)",
      }}>
        {isMobile ? "Tap node · Drag to pan · Pinch to zoom" : "Tap node · Drag to pan · Scroll to zoom"}
      </div>
    </div>
  );
}

// ── ViewKey HUD ───────────────────────────────────────────────────────────────

function ViewKey({ allProjects, onRecenter, onDive, onNewIdea }: {
  allProjects: Project[];
  onRecenter: () => void;
  onDive: (id: number) => void;
  onNewIdea: () => void;
}) {
  const [flowOpen, setFlowOpen] = useState(false);
  const allNodes = [...allProjects];

  return (
    <div style={{ position: "absolute", top: 68, right: 14, zIndex: 50 }}>
      {/* Glass pod */}
      <div style={{
        background: "rgba(9,8,6,0.84)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: "1px solid rgba(201,162,76,0.22)",
        borderRadius: 12,
        overflow: "hidden",
        boxShadow: "0 8px 32px rgba(0,0,0,0.72), 0 0 0 0.5px rgba(0,0,0,0.5)",
      }}>
        {/* SATELLITE — active, re-centers camera */}
        <button onClick={onRecenter} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          padding: "10px 14px", width: "100%",
          background: "rgba(201,162,76,0.11)",
          border: "none", borderBottom: "1px solid rgba(201,162,76,0.14)",
          cursor: "pointer", color: "rgba(201,162,76,0.92)",
          transition: "background 150ms ease",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.18)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.11)")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" fill="rgba(201,162,76,0.28)" />
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="11" />
          </svg>
          <span style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", fontWeight: 700, letterSpacing: "0.12em" }}>SATELLITE</span>
        </button>

        {/* FLOW — opens project quick-picker */}
        <button onClick={() => setFlowOpen(v => !v)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          padding: "10px 14px", width: "100%",
          background: flowOpen ? "rgba(201,162,76,0.07)" : "transparent",
          border: "none", cursor: "pointer",
          color: flowOpen ? "rgba(201,162,76,0.72)" : "rgba(120,113,108,0.52)",
          transition: "color 160ms ease, background 160ms ease",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(201,162,76,0.72)"; }}
          onMouseLeave={(e) => { if (!flowOpen) e.currentTarget.style.color = "rgba(120,113,108,0.52)"; }}
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
          background: "rgba(9,8,6,0.95)",
          backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
          border: "1px solid rgba(201,162,76,0.16)", borderRadius: 10,
          padding: "6px 0", minWidth: 188, maxHeight: 320, overflowY: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.82)",
          animation: "picker-in 140ms cubic-bezier(0.22,1,0.36,1) both",
        }}>
          <div style={{ fontSize: 7.5, fontFamily: "var(--app-font-mono)", color: "rgba(120,113,108,0.4)", letterSpacing: "0.12em", padding: "5px 12px 7px", textTransform: "uppercase" }}>
            Select Flow
          </div>
          {/* New idea entry — creates a blank project and opens its Flow */}
          <button onClick={() => { setFlowOpen(false); onNewIdea(); }} style={{
            width: "100%", padding: "8px 12px", background: "transparent", border: "none",
            borderBottom: "1px solid rgba(201,162,76,0.1)",
            cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: 8,
            color: "rgba(201,162,76,0.65)", fontSize: 12.5,
            fontFamily: "var(--app-font-sans)", transition: "background 120ms ease",
            marginBottom: 2,
          }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.07)")}
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
                color: "rgba(231,229,228,0.76)", fontSize: 12.5,
                fontFamily: "var(--app-font-sans)", transition: "background 120ms ease",
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(201,162,76,0.08)")}
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
