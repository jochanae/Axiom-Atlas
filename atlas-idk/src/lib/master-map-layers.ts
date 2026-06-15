import * as THREE from "three";
import type { MapNode, SubComponentType } from "./master-map-store";
import { SUBTYPE_COLORS } from "./master-map-store";

// Parse "rgba(r,g,b,a)" or "#hex" → { color, alpha }
function parseColor(c: string): { color: THREE.Color; alpha: number } {
  if (c.startsWith("rgba")) {
    const m = c.match(/rgba\(([^)]+)\)/);
    if (m) {
      const [r, g, b, a] = m[1].split(",").map((s) => parseFloat(s.trim()));
      return { color: new THREE.Color(r / 255, g / 255, b / 255), alpha: a };
    }
  }
  return { color: new THREE.Color(c), alpha: 1 };
}

export type LayerNodeRecord = {
  id: string;
  label: string;
  subType?: SubComponentType;
  description?: string;
  mesh: THREE.Mesh;
  worldPos: THREE.Vector3;
};

export class LayerStack {
  scene: THREE.Scene;
  layer2Group: THREE.Group;
  layer3Group: THREE.Group;
  centerMarker: THREE.Mesh | null = null;
  sourceBreadcrumb: THREE.Mesh | null = null;
  breadcrumbLine: THREE.Line | null = null;
  records: LayerNodeRecord[] = [];
  startTime = 0;
  staggerMs = 80;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.layer2Group = new THREE.Group();
    this.layer3Group = new THREE.Group();
    this.layer2Group.visible = false;
    this.layer3Group.visible = false;
    scene.add(this.layer2Group);
    scene.add(this.layer3Group);
  }

  clear() {
    [this.layer2Group, this.layer3Group].forEach((g) => {
      while (g.children.length) {
        const c = g.children[0];
        g.remove(c);
        if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
        const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else if (m) m.dispose();
      }
    });
    this.records = [];
    this.centerMarker = null;
    this.sourceBreadcrumb = null;
    this.breadcrumbLine = null;
  }

  /** Populate a layer with a center node + orbiting children. */
  populate(
    layer: 2 | 3,
    centerWorldPos: [number, number, number],
    children: MapNode[],
    opts: { orbitRadius?: number; nodeRadius?: number; maxChildren?: number } = {},
  ) {
    this.clear();
    const group = layer === 2 ? this.layer2Group : this.layer3Group;
    group.visible = true;
    (layer === 2 ? this.layer3Group : this.layer2Group).visible = false;

    const orbitR = opts.orbitRadius ?? (layer === 2 ? 70 : 28);
    const nodeR = opts.nodeRadius ?? (layer === 2 ? 7 : 3.2);
    const limited = opts.maxChildren ? children.slice(0, opts.maxChildren) : children;

    const center = new THREE.Vector3(...centerWorldPos);

    // Center marker
    const centerMesh = new THREE.Mesh(
      new THREE.SphereGeometry(nodeR * 1.6, 24, 24),
      new THREE.MeshPhysicalMaterial({
        color: 0xc9a24c,
        emissive: 0xc9a24c,
        emissiveIntensity: 0.5,
        roughness: 0.2,
        metalness: 0.6,
        transparent: true,
        opacity: 0,
      }),
    );
    centerMesh.position.copy(center);
    group.add(centerMesh);
    this.centerMarker = centerMesh;

    // Source breadcrumb (micro-scaled, behind center)
    const breadcrumbPos = center.clone().add(new THREE.Vector3(0, 0, -120));
    const sb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.2, 1),
      new THREE.MeshBasicMaterial({ color: 0xc9a24c, transparent: true, opacity: 0.55 }),
    );
    sb.position.copy(breadcrumbPos);
    group.add(sb);
    this.sourceBreadcrumb = sb;

    const lineGeo = new THREE.BufferGeometry().setFromPoints([center, breadcrumbPos]);
    const line = new THREE.Line(
      lineGeo,
      new THREE.LineBasicMaterial({ color: 0xc9a24c, transparent: true, opacity: 0.18 }),
    );
    group.add(line);
    this.breadcrumbLine = line;

    // Orbiting children
    this.startTime = performance.now();
    limited.forEach((child, i) => {
      const angle = (i / limited.length) * Math.PI * 2 - Math.PI / 2;
      const localPos = new THREE.Vector3(
        Math.cos(angle) * orbitR,
        Math.sin(angle) * orbitR,
        Math.sin(i * 1.618) * (orbitR * 0.22),
      );
      const worldPos = center.clone().add(localPos);

      const colStr = child.color ?? (child.subType ? SUBTYPE_COLORS[child.subType] : "#C9A24C");
      const { color, alpha } = parseColor(colStr);

      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(nodeR, 24, 24),
        new THREE.MeshPhysicalMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.35,
          roughness: 0.18,
          metalness: 0.15,
          transparent: true,
          opacity: 0,
          clearcoat: 0.9,
        }),
      );
      mesh.position.copy(worldPos);
      mesh.userData = {
        id: child.id,
        label: child.label,
        subType: child.subType,
        description: child.description,
        targetOpacity: alpha * 0.92,
        delayMs: i * this.staggerMs,
      };
      group.add(mesh);
      this.records.push({
        id: child.id,
        label: child.label,
        subType: child.subType,
        description: child.description,
        mesh,
        worldPos,
      });
    });
  }

  hideAll() {
    this.layer2Group.visible = false;
    this.layer3Group.visible = false;
    this.clear();
  }

  /** Animate fade-in + gentle orbit pulse. Call every frame. */
  tick(t: number, nowMs: number) {
    if (this.centerMarker) {
      const mat = this.centerMarker.material as THREE.MeshPhysicalMaterial;
      mat.opacity += (0.95 - mat.opacity) * 0.08;
      mat.emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.1;
      this.centerMarker.rotation.y = t * 0.3;
    }
    this.records.forEach((rec) => {
      const mesh = rec.mesh;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      const elapsed = nowMs - this.startTime - (mesh.userData.delayMs ?? 0);
      const target = elapsed > 0 ? (mesh.userData.targetOpacity as number) : 0;
      mat.opacity += (target - mat.opacity) * 0.12;
      mat.emissiveIntensity = 0.3 + Math.sin(t * 1.6 + mesh.position.x) * 0.08;
    });
  }

  /** Raycast against active layer's child meshes. */
  hit(raycaster: THREE.Raycaster): LayerNodeRecord | "source" | null {
    const activeGroup = this.layer2Group.visible
      ? this.layer2Group
      : this.layer3Group.visible
      ? this.layer3Group
      : null;
    if (!activeGroup) return null;
    const meshes = this.records.map((r) => r.mesh);
    if (this.sourceBreadcrumb) meshes.push(this.sourceBreadcrumb);
    const hits = raycaster.intersectObjects(meshes);
    if (!hits.length) return null;
    const obj = hits[0].object;
    if (obj === this.sourceBreadcrumb) return "source";
    const rec = this.records.find((r) => r.mesh === obj);
    return rec ?? null;
  }

  hasActiveLayer() {
    return this.layer2Group.visible || this.layer3Group.visible;
  }
}
