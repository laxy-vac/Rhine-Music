import * as THREE from "three";
import { MUSIC_MODEL } from "./music-model";
import { ROW_SPACING } from "./archive-loop";
import type { StylePalette } from "./music-style";

type ShelfPart = {
  mesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.Material>;
  size: THREE.Vector3;
  offset: THREE.Vector3;
};

/** A small, themeable tray under one upright record case. */
export class MusicShelf {
  readonly group = new THREE.Group();
  private readonly parts: ShelfPart[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly slotCapacity: number;
  private readonly base = new THREE.MeshStandardMaterial({ color: "#b3b7b3", roughness: .42, metalness: .48 });
  private readonly rim = new THREE.MeshPhysicalMaterial({
    color: "#e1e4dc", roughness: .28, metalness: .06, transmission: .16,
    thickness: .035, ior: 1.46, clearcoat: .22, envMapIntensity: .45,
  });
  private readonly accent = new THREE.MeshStandardMaterial({ color: "#b56834", roughness: .48, metalness: .12 });
  private readonly tick = new THREE.MeshStandardMaterial({ color: "#e4e7df", roughness: .56, metalness: .18 });
  private dimensions = { width: 0, depth: 0, spacing: 0 };

  constructor(count: number) {
    const capacity = Math.max(1, Math.floor(count));
    this.slotCapacity = capacity;
    const makePart = (name: string, material: THREE.Material, multiplier = 1) => {
      const mesh = new THREE.InstancedMesh(this.box, material, capacity * multiplier);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.parts.push({ mesh, size: new THREE.Vector3(), offset: new THREE.Vector3() });
    };
    makePart("Record shelf tray", this.base);
    makePart("Record shelf glass rims", this.rim, 2);
    makePart("Record shelf index strip", this.accent);
    makePart("Record shelf tick", this.tick);
    this.group.name = "Physical record trays";
    this.setDimensions(MUSIC_MODEL.width, MUSIC_MODEL.depth, ROW_SPACING);
    this.group.visible = false;
  }

  /** Update cached tray dimensions only when the case bounds actually change. */
  setDimensions(width: number, depth: number, spacing: number) {
    const next = {
      width: positive(width, MUSIC_MODEL.width),
      depth: positive(depth, MUSIC_MODEL.depth),
      spacing: positive(spacing, ROW_SPACING),
    };
    if (same(this.dimensions.width, next.width) && same(this.dimensions.depth, next.depth) && same(this.dimensions.spacing, next.spacing)) return;
    this.dimensions = next;

    const trayWidth = next.width + .22;
    const trayDepth = Math.max(next.spacing * .94, next.depth + .08);
    const halfWidth = trayWidth / 2;
    const base = this.parts[0]!;
    base.size.set(trayWidth, .02, trayDepth);
    base.offset.set(0, -.015, 0);

    const rims = this.parts[1]!;
    rims.size.set(.045, .035, trayDepth);
    rims.offset.set(-halfWidth + .005, -.0215, 0);

    const index = this.parts[2]!;
    index.size.set(.018, .026, .052);
    index.offset.set(-halfWidth - .012, -.018, trayDepth * .46);

    const tick = this.parts[3]!;
    tick.size.set(.075, .009, .018);
    tick.offset.set(halfWidth - .12, -.008, trayDepth * .45);

  }

  setSlot(index: number, x: number, y: number, z: number, visible = true) {
    if (index < 0 || index >= this.slotCapacity) return;
    for (const part of this.parts) {
      this.position.set(x + part.offset.x, y + part.offset.y, z + part.offset.z);
      this.scale.copy(part.size);
      if (!visible) this.scale.set(0, 0, 0);
      this.matrix.compose(this.position, this.rotation, this.scale);
      part.mesh.setMatrixAt(index, this.matrix);
      if (part === this.parts[1]) {
        this.position.x = x - part.offset.x;
        this.matrix.compose(this.position, this.rotation, this.scale);
        part.mesh.setMatrixAt(index + this.slotCapacity, this.matrix);
      }
    }
  }

  finish() {
    for (const part of this.parts) part.mesh.instanceMatrix.needsUpdate = true;
  }

  setMode(night: boolean, accent: string, design: "rhine" | "archive" = "rhine", palette?: StylePalette) {
    const archive = design === "archive";
    this.base.color.set(palette?.surface ?? (night ? "#667078" : archive ? "#acb1ac" : "#c1c4bb"));
    this.base.metalness = archive ? .64 : .06;
    this.base.roughness = archive ? .38 : .52;
    this.rim.color.set(palette?.line ?? (night ? "#9baab8" : "#e1e4dc"));
    this.rim.transmission = archive ? .025 : .16;
    this.rim.metalness = archive ? .52 : .025;
    this.rim.roughness = archive ? .36 : .3;
    this.accent.color.set(accent);
    this.accent.emissive.set(accent).multiplyScalar(night ? .025 : .01);
    this.tick.color.set(palette?.muted ?? "#e4e7df");
  }

  dispose() {
    for (const part of this.parts) part.mesh.dispose();
    this.box.dispose();
    this.base.dispose();
    this.rim.dispose();
    this.accent.dispose();
    this.tick.dispose();
    this.parts.length = 0;
    this.group.clear();
  }

}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function same(a: number, b: number) {
  return Math.abs(a - b) < 1e-4;
}
