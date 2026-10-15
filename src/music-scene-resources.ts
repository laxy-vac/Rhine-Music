import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { MusicStyle, StylePalette } from "./music-style";
import { MusicShelf } from "./music-shelf";
import { createMusicSurfaceTextures, disposeMusicSurfaceTextures } from "./music-surface-textures";

export type MusicSceneSlot = {
  x: number;
  y: number;
  z: number;
  visible: boolean;
  row: number;
  lane: number;
};

export type MusicSceneResourceUpdate = {
  shelf: boolean;
  slots: readonly MusicSceneSlot[];
  width: number;
  depth: number;
  rowSpacing: number;
  floorY: number;
};

type Lane = { x: number; minZ: number; maxZ: number; minRow: number; maxRow: number };
type RowLabel = {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  lane: number | null;
};

/** Shared Three.js tray, shelf frame and local floor details for music layouts. */
export class MusicSceneResources {
  readonly group = new THREE.Group();
  private readonly capacity: number;
  private readonly trays: MusicShelf;
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly roundedBox = new RoundedBoxGeometry(1, 1, 1, 1, .025);
  private readonly plane = new THREE.PlaneGeometry(1, 1);
  private readonly wood = createWoodTexture();
  private readonly surfaceTextures = createMusicSurfaceTextures();
  private readonly frameMaterial = new THREE.MeshStandardMaterial({ color: "#b9beb8", roughness: .52, metalness: .08 });
  private readonly edgeMaterial = new THREE.MeshPhysicalMaterial({
    color: "#d4d9d4", roughness: .32, metalness: .04, transmission: .12,
    thickness: .025, ior: 1.46, clearcoat: .2, envMapIntensity: .35,
  });
  private readonly plateMaterial = new THREE.MeshStandardMaterial({ color: "#b9beb8", roughness: .42, metalness: .18 });
  private readonly accentMaterial = new THREE.MeshStandardMaterial({ color: "#b56834", roughness: .48, metalness: .18 });
  private readonly floorMaterial = new THREE.MeshStandardMaterial({
    color: "#71766e", roughness: .86, metalness: .06, map: null,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  private readonly floorLineMaterial = new THREE.MeshStandardMaterial({
    color: "#d2d5cd", roughness: .82, metalness: .04, transparent: true,
    opacity: .14, depthWrite: false,
  });
  private readonly laneBase: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneSides: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly lanePlates: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly plateMarks: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly floorPanels: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>;
  private readonly floorTicks: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly rowLabels: RowLabel[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private readonly horizontal = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private style: MusicStyle | null = null;
  private rowLabelColor = "#283b48";

  constructor(count: number) {
    this.capacity = Math.max(1, Math.floor(count));
    this.trays = new MusicShelf(this.capacity);
    const makeBoxes = (name: string, material: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
      amount = this.capacity, geometry: THREE.BufferGeometry = this.box) => {
      const mesh = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(geometry, material, amount);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      return mesh;
    };
    this.laneBase = makeBoxes("Music shelf base", this.frameMaterial, this.capacity, this.roundedBox);
    this.laneSides = makeBoxes("Music shelf side rails", this.edgeMaterial, this.capacity * 2, this.roundedBox);
    this.lanePlates = makeBoxes("Music shelf front number plates", this.plateMaterial, this.capacity, this.roundedBox);
    this.plateMarks = makeBoxes("Music shelf plate markers", this.accentMaterial, this.capacity, this.roundedBox);
    this.floorPanels = new THREE.InstancedMesh(this.plane, this.floorMaterial, this.capacity);
    this.floorPanels.name = "Local music floor finish";
    this.floorPanels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.floorPanels.frustumCulled = false;
    this.floorPanels.castShadow = false;
    this.floorPanels.receiveShadow = false;
    this.group.add(this.floorPanels);
    this.floorTicks = makeBoxes("Music floor seams and locator marks", this.floorLineMaterial);
    this.createRowLabels();
    this.group.add(this.trays.group);
    this.group.name = "Music shelf and floor resources";
    this.group.visible = false;
  }

  setStyle(style: MusicStyle, night: boolean, palette: StylePalette): void {
    this.style = { ...style };
    const archive = style.design === "archive";
    this.trays.setMode(night, palette.accent, style.design, palette);

    this.frameMaterial.color.set(archive ? palette.well : palette.surface);
    this.frameMaterial.metalness = archive ? .62 : .055;
    this.frameMaterial.roughness = archive ? .4 : .56;
    this.edgeMaterial.color.set(archive ? palette.line : palette.surface);
    this.edgeMaterial.metalness = archive ? .74 : .025;
    this.edgeMaterial.roughness = archive ? .34 : .3;
    this.edgeMaterial.transmission = archive ? 0 : .13;
    this.edgeMaterial.clearcoat = archive ? .12 : .24;
    this.plateMaterial.color.set(archive ? palette.panel : palette.surface);
    this.plateMaterial.metalness = archive ? .58 : .045;
    this.plateMaterial.roughness = archive ? .42 : .54;
    this.accentMaterial.color.set(palette.accent);
    this.accentMaterial.emissive.set(palette.accent).multiplyScalar(night ? .025 : .01);
    this.rowLabelColor = archive ? palette.accent : palette.fg;
    for (const label of this.rowLabels) this.drawRowLabel(label, label.lane, this.rowLabelColor);

    this.floorMaterial.map = style.floor === "real" ? this.wood : null;
    this.floorMaterial.color.set(style.floor === "real" ? "#ffffff" : style.floor === "deck" ? palette.well : palette.bg);
    this.floorMaterial.metalness = .035;
    this.floorMaterial.roughness = .78;
    this.floorMaterial.needsUpdate = true;
    this.floorLineMaterial.color.set(palette.line);
    this.floorLineMaterial.opacity = .14;
  }

  /** Apply the selected finish to the large, stationary scene floor. */
  applyGroundFinish(material: THREE.MeshStandardMaterial): void {
    const floor = this.style?.floor ?? "plain";
    material.map = floor === "real" ? null : floor === "deck"
      ? this.surfaceTextures.deckColor : this.surfaceTextures.plainColor;
    material.roughnessMap = floor === "real" ? null : this.surfaceTextures.roughness;
    material.normalMap = floor === "real" ? null : this.surfaceTextures.normal;
    if (floor === "real") {
      material.normalScale.set(0, 0);
      material.roughness = .95;
      material.metalness = 0;
    } else if (floor === "deck") {
      material.normalScale.set(.12, .12);
      material.roughness = .76;
      material.metalness = .12;
    } else {
      material.normalScale.set(.1, .1);
      material.roughness = .94;
      material.metalness = .025;
    }
    material.needsUpdate = true;
  }

  update(options: MusicSceneResourceUpdate): void {
    const style = this.style;
    if (!style || !options.shelf) {
      this.group.visible = false;
      this.trays.group.visible = false;
      return;
    }

    this.group.visible = true;
    const rackVisible = style.design === "rhine" || style.shelf;
    this.trays.group.visible = rackVisible;
    const width = positive(options.width, 4.45);
    const depth = positive(options.depth, .14);
    const rowSpacing = Math.max(positive(options.rowSpacing, .62), depth + .2);
    const floorY = Number.isFinite(options.floorY) ? options.floorY : -4.6;
    this.trays.setDimensions(width, depth, rowSpacing);

    const lanes = new Map<number, Lane>();
    for (let index = 0; index < this.capacity; index++) {
      const slot = options.slots[index];
      const valid = Boolean(slot?.visible && finiteSlot(slot));
      this.trays.setSlot(index, valid ? slot!.x : 0, floorY, valid ? slot!.z : 0, valid && rackVisible);
      const tickVisible = valid && slot!.row % 5 === 0;
      this.writeBox(this.floorTicks, index, slot?.x ?? 0, floorY - .22 + .0005, slot?.z ?? 0,
        [.12, .001, .006], tickVisible);
      if (!valid) continue;
      const lane = lanes.get(slot!.lane);
      if (lane) {
        lane.minZ = Math.min(lane.minZ, slot!.z);
        lane.maxZ = Math.max(lane.maxZ, slot!.z);
        lane.minRow = Math.min(lane.minRow, slot!.row);
        lane.maxRow = Math.max(lane.maxRow, slot!.row);
      } else {
        lanes.set(slot!.lane, { x: slot!.x, minZ: slot!.z, maxZ: slot!.z, minRow: slot!.row, maxRow: slot!.row });
      }
    }
    const laneList = [...lanes.entries()].sort(([a], [b]) => a - b).slice(0, this.capacity);
    const laneCount = laneList.length;
    this.laneBase.count = laneCount;
    this.laneSides.count = laneCount * 2;
    this.lanePlates.count = laneCount;
    this.plateMarks.count = laneCount;
    const floorHasPanel = style.floor === "real";
    this.floorPanels.visible = floorHasPanel;
    this.floorPanels.count = floorHasPanel ? laneCount : 0;
    const panelFloor = floorY - .218;

    laneList.forEach(([, lane], laneIndex) => {
      const span = Math.max(rowSpacing, lane.maxZ - lane.minZ + rowSpacing + depth);
      const centerZ = (lane.minZ + lane.maxZ) / 2;
      this.writeBox(this.laneBase, laneIndex, lane.x, floorY - .062, centerZ,
        [width + .34, .036, span], rackVisible);
      const sideX = width / 2 + .17;
      this.writeBox(this.laneSides, laneIndex * 2, lane.x - sideX, floorY - .043, centerZ,
        [.055, .085, span], rackVisible);
      this.writeBox(this.laneSides, laneIndex * 2 + 1, lane.x + sideX, floorY - .043, centerZ,
        [.055, .085, span], rackVisible);

      const frontZ = lane.maxZ + depth / 2 + .06;
      const plateY = floorY - .04;
      this.writeBox(this.lanePlates, laneIndex, lane.x, plateY, frontZ, [.82, .075, .055], rackVisible);
      this.writeBox(this.plateMarks, laneIndex, lane.x - .29, plateY + .028, frontZ,
        [.09, .008, .012], rackVisible);
      this.writePlane(this.floorPanels, laneIndex, lane.x, panelFloor, centerZ,
        [width + .48, span + .18], options.shelf && floorHasPanel);
    });

    const labelLanes = [...laneList].sort(([, a], [, b]) => Math.abs(a.x) - Math.abs(b.x)).slice(0, this.rowLabels.length);
    for (let index = 0; index < this.rowLabels.length; index++) {
      const label = this.rowLabels[index]!;
      const entry = labelLanes[index];
      if (!entry) {
        label.mesh.visible = false;
        label.lane = null;
        continue;
      }
      const [laneNumber, lane] = entry;
      if (label.lane !== laneNumber) this.drawRowLabel(label, laneNumber, this.rowLabelColor);
      const plateY = floorY - .04;
      const plateFront = lane.maxZ + depth / 2 + .06 + .028;
      label.mesh.position.set(lane.x, plateY, plateFront);
      label.mesh.scale.set(.76, .053, 1);
      label.mesh.visible = rackVisible;
    }

    this.trays.finish();
    this.markUpdated(this.laneBase, this.laneSides, this.lanePlates, this.plateMarks, this.floorPanels, this.floorTicks);
  }

  dispose(): void {
    this.trays.dispose();
    for (const mesh of [this.laneBase, this.laneSides, this.lanePlates, this.plateMarks, this.floorPanels, this.floorTicks]) mesh.dispose();
    this.box.dispose();
    this.roundedBox.dispose();
    this.plane.dispose();
    this.wood.dispose();
    disposeMusicSurfaceTextures(this.surfaceTextures);
    for (const label of this.rowLabels) {
      label.mesh.removeFromParent();
      label.material.dispose();
      label.texture.dispose();
    }
    this.frameMaterial.dispose();
    this.edgeMaterial.dispose();
    this.plateMaterial.dispose();
    this.accentMaterial.dispose();
    this.floorMaterial.dispose();
    this.floorLineMaterial.dispose();
    this.group.clear();
  }

  private createRowLabels() {
    if (typeof document === "undefined") return;
    for (let index = 0; index < 9; index++) {
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 96;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const material = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, depthWrite: false, toneMapped: false,
      });
      const mesh = new THREE.Mesh(this.plane, material);
      mesh.name = `Music shelf row label ${index + 1}`;
      mesh.visible = false;
      this.group.add(mesh);
      this.rowLabels.push({ canvas, context, texture, material, mesh, lane: null });
    }
  }

  private drawRowLabel(label: RowLabel, lane: number | null, color: string) {
    label.context.clearRect(0, 0, label.canvas.width, label.canvas.height);
    if (lane !== null) {
      label.context.fillStyle = color;
      label.context.font = "700 34px 'Archive Mono', 'Geist Mono', monospace";
      label.context.textAlign = "center";
      label.context.textBaseline = "middle";
      label.context.fillText(`ROW ${String(lane + 1).padStart(3, "0")}`, 256, 48, 492);
    }
    label.lane = lane;
    label.texture.needsUpdate = true;
  }

  private writeBox(mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>, index: number,
    x: number, y: number, z: number, dimensions: readonly [number, number, number], visible: boolean) {
    this.position.set(x, y, z);
    this.scale.set(dimensions[0], dimensions[1], dimensions[2]);
    if (!visible) this.scale.set(0, 0, 0);
    this.matrix.compose(this.position, this.identity, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private writePlane(mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>, index: number,
    x: number, y: number, z: number, dimensions: readonly [number, number], visible: boolean) {
    this.position.set(x, y, z);
    this.scale.set(dimensions[0], dimensions[1], 1);
    if (!visible) this.scale.set(0, 0, 0);
    this.matrix.compose(this.position, this.horizontal, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private markUpdated(...meshes: THREE.InstancedMesh[]) {
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}

function finiteSlot(slot: MusicSceneSlot): boolean {
  return Number.isFinite(slot.x) && Number.isFinite(slot.y) && Number.isFinite(slot.z) &&
    Number.isFinite(slot.row) && Number.isFinite(slot.lane);
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function createWoodTexture() {
  const width = 256;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const seam = y % 32 < 1 ? -20 : 0;
    for (let x = 0; x < width; x++) {
      const grain = Math.sin(y * .31 + Math.sin(x * .045) * 1.7) * 6 + Math.sin(y * .9 + x * .012) * 2;
      const fleck = ((x * 17 + y * 31) % 13 === 0 ? -5 : 0) + seam;
      const offset = (y * width + x) * 4;
      data[offset] = clampByte(126 + grain + fleck);
      data[offset + 1] = clampByte(82 + grain * .72 + fleck * .66);
      data[offset + 2] = clampByte(49 + grain * .45 + fleck * .38);
      data[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function clampByte(value: number) { return Math.max(0, Math.min(255, Math.round(value))); }
