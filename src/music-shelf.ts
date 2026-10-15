import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MUSIC_MODEL } from "./music-model";
import { ROW_SPACING } from "./archive-loop";
import { MusicArrayAppearance } from "./music-array-appearance";
import type { StylePalette } from "./music-style";

type ShelfPart = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  size: THREE.Vector3;
  offsets: THREE.Vector3[];
  radius: number;
};

/** Themeable, instanced metal tray details under each upright record case. */
export class MusicShelf {
  readonly group = new THREE.Group();
  private readonly parts: ShelfPart[] = [];
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private boxDisposed = false;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly rotation = new THREE.Quaternion();
  private readonly slotCapacity: number;
  private readonly appearance: MusicArrayAppearance;
  private readonly ownsAppearance: boolean;
  private readonly appearanceBackground = new THREE.Color("#e8e5e1");
  private readonly base = new THREE.MeshStandardMaterial({ color: "#b3b7b3", roughness: .46, metalness: .42 });
  private readonly rim = new THREE.MeshStandardMaterial({ color: "#e1e4dc", roughness: .28, metalness: .52 });
  private readonly inset = new THREE.MeshStandardMaterial({ color: "#d7d9d3", roughness: .74, metalness: .12 });
  private readonly groove = new THREE.MeshStandardMaterial({ color: "#8c9186", roughness: .82, metalness: .14 });
  private readonly accent = new THREE.MeshStandardMaterial({ color: "#b56834", roughness: .48, metalness: .18 });
  private readonly tick = new THREE.MeshStandardMaterial({ color: "#e4e7df", roughness: .56, metalness: .18 });
  private dimensions = { width: 0, depth: 0, spacing: 0 };

  constructor(count: number, appearance?: MusicArrayAppearance) {
    const capacity = Math.max(1, Math.floor(count));
    this.slotCapacity = capacity;
    this.ownsAppearance = !appearance;
    this.appearance = appearance ?? new MusicArrayAppearance(this.appearanceBackground);
    const makePart = (name: string, material: THREE.Material, multiplier = 1, radius = .003) => {
      const mesh = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(this.box, material, capacity * multiplier);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      this.parts.push({
        mesh,
        size: new THREE.Vector3(),
        offsets: Array.from({ length: multiplier }, () => new THREE.Vector3()),
        radius,
      });
    };
    makePart("Record shelf tray", this.base, 1, .003);
    makePart("Record shelf glass rims", this.rim, 2, .0035);
    makePart("Record shelf recessed bed", this.inset, 1, 0);
    makePart("Record shelf guide grooves", this.groove, 2, 0);
    makePart("Record shelf index strip", this.accent, 1, 0);
    makePart("Record shelf tick", this.tick, 1, 0);
    this.group.name = "Physical record trays";
    this.setDimensions(MUSIC_MODEL.width, MUSIC_MODEL.depth, ROW_SPACING);
    this.group.visible = false;
  }

  /** Update cached tray dimensions and beveled geometry only when bounds change. */
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
    base.offsets[0]!.set(0, -.015, 0);

    const rims = this.parts[1]!;
    rims.size.set(.045, .035, trayDepth);
    rims.offsets[0]!.set(-halfWidth + .005, -.0215, 0);
    rims.offsets[1]!.set(halfWidth - .005, -.0215, 0);

    const inset = this.parts[2]!;
    inset.size.set(Math.max(.1, trayWidth - .11), .0016, Math.max(.1, trayDepth - .11));
    inset.offsets[0]!.set(0, -.0052, 0);

    const grooves = this.parts[3]!;
    grooves.size.set(.002, .00025, Math.max(.1, trayDepth * .72));
    grooves.offsets[0]!.set(-trayWidth * .19, -.00435, 0);
    grooves.offsets[1]!.set(trayWidth * .19, -.00435, 0);

    const index = this.parts[4]!;
    index.size.set(.018, .026, .052);
    index.offsets[0]!.set(-halfWidth - .012, -.018, trayDepth * .46);

    const tick = this.parts[5]!;
    tick.size.set(.075, .009, .018);
    tick.offsets[0]!.set(halfWidth - .12, -.008, trayDepth * .45);

    for (const part of this.parts) this.updateGeometry(part);
    if (!this.boxDisposed) {
      this.box.dispose();
      this.boxDisposed = true;
    }
  }

  setSlot(index: number, x: number, y: number, z: number, visible = true, alpha = 1, tint = 0) {
    if (index < 0 || index >= this.slotCapacity) return;
    for (const part of this.parts) {
      this.scale.copy(part.size);
      if (!visible) this.scale.set(0, 0, 0);
      for (let copy = 0; copy < part.offsets.length; copy++) {
        const offset = part.offsets[copy]!;
        this.position.set(x + offset.x, y + offset.y, z + offset.z);
        this.matrix.compose(this.position, this.rotation, this.scale);
        const instanceIndex = index + this.slotCapacity * copy;
        part.mesh.setMatrixAt(instanceIndex, this.matrix);
        this.appearance.write(part.mesh, instanceIndex, alpha, tint);
      }
    }
  }

  finish() {
    for (const part of this.parts) {
      part.mesh.instanceMatrix.needsUpdate = true;
      this.appearance.finish(part.mesh);
    }
  }

  setMode(night: boolean, accent: string, design: "rhine" | "archive" = "rhine", palette?: StylePalette) {
    const archive = design === "archive";
    if (this.ownsAppearance && palette?.bg) {
      this.appearanceBackground.set(palette.bg);
      this.appearance.setBackground(this.appearanceBackground);
    }
    this.base.color.set(palette?.surface ?? (night ? "#667078" : archive ? "#acb1ac" : "#c1c4bb"));
    this.base.metalness = archive ? .64 : .42;
    this.base.roughness = archive ? .38 : .46;
    this.rim.color.set(palette?.["panel-hi"] ?? palette?.line ?? (night ? "#9baab8" : "#e1e4dc"));
    this.rim.metalness = archive ? .68 : .52;
    this.rim.roughness = archive ? .31 : .27;
    this.inset.color.set(palette?.well ?? palette?.surface ?? "#d7d9d3");
    this.inset.metalness = archive ? .22 : .12;
    this.inset.roughness = archive ? .68 : .76;
    this.groove.color.set(palette?.line ?? (night ? "#6d7a85" : "#9da39a"));
    this.groove.metalness = archive ? .24 : .14;
    this.groove.roughness = .82;
    this.accent.color.set(accent);
    this.accent.emissive.set(accent).multiplyScalar(night ? .025 : .01);
    this.tick.color.set(palette?.["panel-hi"] ?? palette?.muted ?? "#e4e7df");
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const part of this.parts) {
      part.mesh.dispose();
      geometries.add(part.mesh.geometry);
    }
    for (const geometry of geometries) geometry.dispose();
    if (!this.boxDisposed) this.box.dispose();
    for (const material of [this.base, this.rim, this.inset, this.groove, this.accent, this.tick]) material.dispose();
    if (this.ownsAppearance) this.appearance.dispose();
    this.parts.length = 0;
    this.group.clear();
  }

  private updateGeometry(part: ShelfPart) {
    const previous = part.mesh.geometry;
    const next = normalizedRoundedBox(part.size, part.radius);
    part.mesh.geometry = next;
    if (previous !== this.box) previous.dispose();
  }
}

function normalizedRoundedBox(size: THREE.Vector3, requestedRadius: number): THREE.BufferGeometry {
  const x = Math.max(.0001, size.x);
  const y = Math.max(.0001, size.y);
  const z = Math.max(.0001, size.z);
  if (requestedRadius <= 0) {
    const box = new THREE.BoxGeometry(x, y, z);
    box.scale(1 / x, 1 / y, 1 / z);
    box.computeBoundingBox();
    box.computeBoundingSphere();
    return box;
  }
  const radius = Math.min(requestedRadius, Math.min(x, y, z) * .45);
  const geometry = new RoundedBoxGeometry(x, y, z, 1, radius);
  geometry.scale(1 / x, 1 / y, 1 / z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function same(a: number, b: number) {
  return Math.abs(a - b) < 1e-4;
}
