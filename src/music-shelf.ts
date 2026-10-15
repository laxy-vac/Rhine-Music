import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MUSIC_MODEL } from "./music-model";
import { ROW_SPACING } from "./archive-loop";
import { MusicArrayAppearance } from "./music-array-appearance";
import { createMusicShelfTextures, disposeMusicShelfTextures } from "./music-shelf-textures";
import { createMusicShelfBedGeometry, createMusicShelfSeparatorGeometry, MUSIC_SHELF_TRAY_THICKNESS } from "./music-shelf-rail";
import type { StylePalette } from "./music-style";

type ShelfPart = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;
  size: THREE.Vector3;
  offsets: THREE.Vector3[];
  radius: number;
};

/** Themeable, instanced metal tray details under each upright record case. */
export class MusicShelf {
  readonly group = new THREE.Group();
  readonly textures = createMusicShelfTextures();
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
  private readonly inset = new THREE.MeshStandardMaterial({ color: "#d7d9d3", roughness: .74, metalness: .12 });
  private readonly bedBand = new THREE.MeshStandardMaterial({ roughness: .95, metalness: .02 });
  private readonly tick = new THREE.MeshStandardMaterial({ color: "#e4e7df", roughness: .56, metalness: .18 });
  private dimensions = { width: 0, depth: 0, spacing: 0 };

  constructor(count: number, appearance?: MusicArrayAppearance) {
    const capacity = Math.max(1, Math.floor(count));
    this.slotCapacity = capacity;
    this.ownsAppearance = !appearance;
    this.appearance = appearance ?? new MusicArrayAppearance(this.appearanceBackground);
    this.inset.map = this.textures.bed;
    for (const material of [this.base, this.inset, this.bedBand, this.tick]) {
      material.roughnessMap = this.textures.roughness;
      material.normalMap = this.textures.normal;
      material.normalScale.set(.16, .16);
    }
    const makePart = (name: string, material: THREE.Material | THREE.Material[], multiplier = 1, radius = .003) => {
      const mesh = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(this.box, material, capacity * multiplier);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = material === this.base || (Array.isArray(material) && material.includes(this.inset));
      this.group.add(mesh);
      this.parts.push({
        mesh,
        size: new THREE.Vector3(),
        offsets: Array.from({ length: multiplier }, () => new THREE.Vector3()),
        radius,
      });
    };
    makePart("Record shelf tray", this.base, 1, .003);
    makePart("Record shelf recessed bed", [this.inset, this.bedBand], 1, 0);
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
    const trayDepth = Math.max(next.spacing * .99, next.depth + .08);
    const base = this.parts[0]!;
    base.size.set(trayWidth, .13, trayDepth);
    base.offsets[0]!.set(0, -.145, 0);

    const inset = this.parts[1]!;
    inset.size.set(Math.max(.1, next.width - .09), MUSIC_SHELF_TRAY_THICKNESS, Math.max(.1, trayDepth - .014));
    inset.offsets[0]!.set(0, -.08 + MUSIC_SHELF_TRAY_THICKNESS / 2, 0);

    const tick = this.parts[2]!;
    // Adjacent source sprites cover their end faces: the assembled deck is
    // flat. These are flush silver separators, never raised transverse ribs.
    tick.size.set(Math.max(.1, trayWidth - .14), .0015, .018);
    tick.offsets[0]!.set(0, -.08 + MUSIC_SHELF_TRAY_THICKNESS + .00125, trayDepth * .49);

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

  /** End landings borrow this geometry; this object remains its sole owner. */
  get bedGeometry() { return this.parts[1]!.mesh.geometry; }

  setMode(night: boolean, _accent: string, design: "rhine" | "archive" = "rhine", palette?: StylePalette) {
    const archive = design === "archive";
    if (this.ownsAppearance && palette?.bg) {
      this.appearanceBackground.set(palette.bg);
      this.appearance.setBackground(this.appearanceBackground);
    }
    const finish = musicShelfFinish(night, design, palette);
    // The large metal base supports a separate grey/black tray. This slot
    // plate overlaps the continuous lane plate and must use the same finish.
    this.base.color.copy(finish.supportPlate);
    this.base.metalness = .8;
    this.base.roughness = .34;
    this.base.normalScale.set(.12, .12);
    // The original mid sprite is darker than the two empty end platforms.
    this.inset.color.copy(finish.midBed);
    this.inset.metalness = .12;
    this.inset.roughness = .9;
    this.bedBand.color.copy(finish.channel);
    this.bedBand.roughness = finish.channelRoughness;
    this.bedBand.metalness = finish.channelMetalness;
    this.tick.color.copy(finish.rail);
    this.tick.roughness = archive ? .32 : .56;
    this.tick.metalness = archive ? .48 : .18;
  }

  /** Borrow the owning Scene's environment; its lifetime stays with the Scene. */
  setRailEnvironment(environment: THREE.Texture | null, intensity: number) {
    if (this.tick.envMap !== environment) {
      this.tick.envMap = environment;
      this.tick.needsUpdate = true;
    }
    this.tick.envMapIntensity = intensity;
  }

  setPlateEnvironment(environment: THREE.Texture | null, intensity: number) {
    if (this.base.envMap !== environment) {
      this.base.envMap = environment;
      this.base.needsUpdate = true;
    }
    this.base.envMapIntensity = intensity;
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    for (const part of this.parts) {
      part.mesh.dispose();
      geometries.add(part.mesh.geometry);
    }
    for (const geometry of geometries) geometry.dispose();
    if (!this.boxDisposed) this.box.dispose();
    for (const material of [this.base, this.inset, this.bedBand, this.tick]) material.dispose();
    disposeMusicShelfTextures(this.textures);
    if (this.ownsAppearance) this.appearance.dispose();
    this.parts.length = 0;
    this.group.clear();
  }

  private updateGeometry(part: ShelfPart) {
    const previous = part.mesh.geometry;
    const next = part.mesh.material === this.tick
      ? createMusicShelfSeparatorGeometry(this.dimensions.width)
        .translate(0, -part.offsets[0]!.y, 0)
        .scale(1 / part.size.x, 1 / part.size.y, 1 / part.size.z)
      : Array.isArray(part.mesh.material) && part.mesh.material.includes(this.inset)
        ? createMusicShelfBedGeometry(part.size, Math.max(.01, this.dimensions.width - .28))
        : normalizedRoundedBox(part.size, part.radius);
    next.computeBoundingBox();
    next.computeBoundingSphere();
    part.mesh.geometry = next;
    if (previous !== this.box) previous.dispose();
  }
}

/** Interface paper colours cannot also define the tray's metal/matte contrast. */
export function musicShelfFinish(night: boolean, design: "rhine" | "archive", palette?: StylePalette) {
  const archive = design === "archive";
  if (archive) {
    // Calibrate rendered metal roles independently. Mixing the page colour
    // into dark albedos lifted the black bands and gave the frame a navy cast.
    return {
      base: new THREE.Color(night ? "#c4c6c7" : "#a1a5a9"),
      wall: new THREE.Color(night ? "#8d93aa" : "#6f778d"),
      backstop: new THREE.Color(night ? "#9f9c98" : "#797e84"),
      rail: new THREE.Color(night ? "#e9f2ff" : "#dfeaff"),
      supportPlate: new THREE.Color(night ? "#e9f2ff" : "#dfeaff"),
      bed: new THREE.Color(night ? "#d7d0c8" : "#a9aeb6"),
      midBed: new THREE.Color(night ? "#a9a5a0" : "#878b93"),
      plate: new THREE.Color(night ? "#d2c7ba" : "#d2d5db"),
      channel: new THREE.Color(night ? "#101011" : "#101113"),
      railEnvironment: night ? 2.25 : 1.3,
      plateEnvironment: night ? 2.5 : 1.5,
      channelRoughness: .95,
      channelMetalness: .02,
    };
  }
  const tint = new THREE.Color(palette?.surface ?? (night ? "#162234" : "#efede7"));
  const metal = (day: string, dark: string) => new THREE.Color(night ? dark : day).lerp(tint, .06);
  const base = metal("#b9c1c4", "#4d5a68");
  const rail = metal("#dce2e5", "#8e9faf");
  const bed = metal("#b4bec3", "#404d5a");
  return {
    base, wall: base.clone(), backstop: rail.clone(), rail, supportPlate: rail.clone(), bed, midBed: bed.clone().multiplyScalar(.60), plate: rail.clone(),
    channel: metal("#282e33", "#101923"),
    railEnvironment: 1,
    plateEnvironment: 1,
    channelRoughness: .8,
    channelMetalness: .15,
  };
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
