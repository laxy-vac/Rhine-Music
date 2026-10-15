import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { MusicArrayAppearance } from "./music-array-appearance";
import type { MusicStyle, StylePalette } from "./music-style";
import { MusicShelf, musicShelfFinish } from "./music-shelf";
import { createMusicShelfRailGeometry } from "./music-shelf-rail";
import { MUSIC_SHELF_VIEW } from "./music-display-layout";
import { createMusicSurfaceTextures, disposeMusicSurfaceTextures } from "./music-surface-textures";

export type MusicSceneSlot = {
  x: number;
  y: number;
  z: number;
  visible: boolean;
  row: number;
  lane: number;
  alpha?: number;
  tint?: number;
};

export type MusicSceneResourceUpdate = {
  shelf: boolean;
  slots: readonly MusicSceneSlot[];
  width: number;
  depth: number;
  rowSpacing: number;
  floorY: number;
  environment?: THREE.Texture | null;
  environmentIntensity?: number;
};

type Lane = { x: number; minZ: number; maxZ: number; minRow: number; maxRow: number; alpha: number; tint: number };
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
  private readonly appearance: MusicArrayAppearance;
  private readonly ownsAppearance: boolean;
  private readonly appearanceBackground = new THREE.Color("#e8e5e1");
  private readonly box = new THREE.BoxGeometry(1, 1, 1);
  private readonly roundedBox = new RoundedBoxGeometry(1, 1, 1, 1, .025);
  private readonly railSection = createMusicShelfRailGeometry();
  private readonly backstopSection = createMusicShelfRailGeometry(true);
  private readonly footGeometry = new THREE.SphereGeometry(.5, 10, 6);
  private readonly underframeGeometry = new THREE.CylinderGeometry(.5, .5, 1, 20, 1, false).rotateX(Math.PI / 2);
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
  private readonly railTopMaterial = new THREE.MeshStandardMaterial({ roughness: .27, metalness: .55 });
  private readonly backstopTopMaterial = new THREE.MeshStandardMaterial({ roughness: .48, metalness: .32 });
  private readonly endFaceMaterial = new THREE.MeshStandardMaterial({ roughness: .65, metalness: .25 });
  private readonly channelMaterial = new THREE.MeshStandardMaterial({ roughness: .8, metalness: .15 });
  private readonly hazardMaterial = new THREE.MeshStandardMaterial({ roughness: .64, metalness: .12 });
  private readonly endPlatformMaterial = new THREE.MeshStandardMaterial({ roughness: .9, metalness: .12 });
  private readonly contactShadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: .28, depthWrite: false,
    toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  private readonly floorMaterial = new THREE.MeshStandardMaterial({
    color: "#71766e", roughness: .86, metalness: .06, map: null,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  private readonly floorLineMaterial = new THREE.MeshStandardMaterial({
    color: "#d2d5cd", roughness: .82, metalness: .04, transparent: true,
    opacity: .14, depthWrite: false,
  });
  private readonly laneBase: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneLeftGuide: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material[]>;
  private readonly laneRightGuide: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material[]>;
  private readonly laneAccentLines: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneEndCaps: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material[]>;
  private readonly laneHazards: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>;
  private readonly laneFeet: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneUnderframe: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneFootPins: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly laneContactShadows: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>;
  private readonly laneEndPlatforms: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material[]>;
  private readonly lanePlates: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly plateMarks: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly floorPanels: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>;
  private readonly floorTicks: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>;
  private readonly rowLabels: RowLabel[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly identity = new THREE.Quaternion();
  private readonly reverseRail = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0));
  private readonly horizontal = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private style: MusicStyle | null = null;
  private rowLabelColor = "#283b48";
  private silverEnvironmentFactor = 1;

  constructor(count: number, appearance?: MusicArrayAppearance) {
    this.capacity = Math.max(1, Math.floor(count));
    this.ownsAppearance = !appearance;
    this.appearance = appearance ?? new MusicArrayAppearance(this.appearanceBackground);
    this.trays = new MusicShelf(this.capacity, this.appearance);
    for (const material of [this.frameMaterial, this.edgeMaterial, this.railTopMaterial, this.backstopTopMaterial]) {
      material.roughnessMap = this.trays.textures.roughness;
      material.normalMap = this.trays.textures.normal;
      material.normalScale.set(.12, .12);
    }
    this.hazardMaterial.map = this.trays.textures.hazard;
    this.endPlatformMaterial.map = this.trays.textures.endBed;
    this.endPlatformMaterial.roughnessMap = this.trays.textures.roughness;
    this.endPlatformMaterial.normalMap = this.trays.textures.normal;
    this.endPlatformMaterial.normalScale.set(.16, .16);
    this.contactShadowMaterial.map = this.trays.textures.contactShadow;
    this.trays.textures.hazard.repeat.x = 5;
    const makeBoxes = <M extends THREE.Material | THREE.Material[]>(name: string, material: M,
      amount = this.capacity, geometry: THREE.BufferGeometry = this.box) => {
      const mesh = new THREE.InstancedMesh<THREE.BufferGeometry, M>(geometry, material, amount);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.group.add(mesh);
      return mesh;
    };
    this.laneBase = makeBoxes("Music shelf base", this.frameMaterial, this.capacity, this.roundedBox);
    const guideMaterials = [this.edgeMaterial, this.railTopMaterial, this.channelMaterial];
    this.laneLeftGuide = makeBoxes("Music shelf left guide", [this.edgeMaterial, this.backstopTopMaterial, this.channelMaterial], this.capacity, this.backstopSection);
    this.laneRightGuide = makeBoxes("Music shelf right guide", guideMaterials, this.capacity, this.railSection);
    const guides = new THREE.Group();
    guides.name = "Music shelf side rails";
    guides.add(this.laneLeftGuide, this.laneRightGuide);
    this.group.add(guides);
    this.laneAccentLines = makeBoxes("Music shelf continuous edge lines", this.accentMaterial, this.capacity * 2);
    this.laneEndCaps = makeBoxes("Music shelf end caps", Array.from({ length: 6 }, () => this.edgeMaterial), this.capacity * 2);
    this.laneFeet = makeBoxes("Music shelf support feet", this.frameMaterial, this.capacity * 4);
    this.laneUnderframe = makeBoxes("Music shelf underframe", this.frameMaterial, this.capacity * 2, this.underframeGeometry);
    this.laneBase.castShadow = this.laneBase.receiveShadow = true;
    this.laneFeet.castShadow = this.laneFeet.receiveShadow = true;
    this.laneUnderframe.castShadow = this.laneUnderframe.receiveShadow = true;
    this.laneFootPins = makeBoxes("Music shelf foot pins", this.railTopMaterial, this.capacity * 4, this.footGeometry);
    this.laneContactShadows = new THREE.InstancedMesh(this.plane, this.contactShadowMaterial, this.capacity * 4);
    this.laneContactShadows.name = "Music shelf contact shadows";
    this.laneContactShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.laneContactShadows.frustumCulled = false;
    this.group.add(this.laneContactShadows);
    this.laneEndPlatforms = makeBoxes("Music shelf end platforms", [this.endPlatformMaterial, this.channelMaterial], this.capacity * 2);
    this.laneHazards = new THREE.InstancedMesh(this.plane, this.hazardMaterial, this.capacity);
    this.laneHazards.name = "Music shelf end safety stripes";
    this.laneHazards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.laneHazards.frustumCulled = false;
    this.group.add(this.laneHazards);
    this.lanePlates = makeBoxes("Music shelf front number plates", this.plateMaterial, this.capacity, this.roundedBox);
    this.plateMarks = makeBoxes("Music shelf plate markers", this.channelMaterial, this.capacity, this.roundedBox);
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
    if (this.ownsAppearance) {
      this.appearanceBackground.set(palette.bg);
      this.appearance.setBackground(this.appearanceBackground);
    }
    this.trays.setMode(night, palette.accent, style.design, palette);
    const finish = musicShelfFinish(night, style.design, palette);
    this.frameMaterial.color.copy(finish.base);
    this.frameMaterial.metalness = archive ? .3 : .24;
    this.frameMaterial.roughness = .55;
    this.edgeMaterial.color.copy(finish.wall);
    this.edgeMaterial.metalness = archive ? .32 : .28;
    this.edgeMaterial.roughness = .48;
    this.edgeMaterial.transmission = 0;
    this.edgeMaterial.clearcoat = archive ? .12 : .24;
    this.railTopMaterial.color.copy(finish.rail);
    this.backstopTopMaterial.color.copy(finish.backstop);
    this.backstopTopMaterial.metalness = archive ? .32 : .55;
    this.backstopTopMaterial.roughness = archive ? .48 : .27;
    this.endFaceMaterial.color.copy(finish.endFace);
    this.laneEndCaps.material = archive
      ? [this.edgeMaterial, this.edgeMaterial, this.backstopTopMaterial, this.frameMaterial, this.endFaceMaterial, this.endFaceMaterial]
      : Array.from({ length: 6 }, () => this.edgeMaterial);
    this.silverEnvironmentFactor = finish.railEnvironment;
    this.channelMaterial.color.copy(finish.channel);
    this.channelMaterial.roughness = finish.channelRoughness;
    this.channelMaterial.metalness = finish.channelMetalness;
    this.hazardMaterial.color.set(palette.accent);
    this.endPlatformMaterial.color.copy(finish.bed);
    this.plateMaterial.color.copy(finish.plate);
    this.plateMaterial.metalness = .12;
    this.plateMaterial.roughness = .78;
    this.accentMaterial.color.set(palette.accent);
    this.accentMaterial.emissive.set(palette.accent).multiplyScalar(night ? .18 : .065);
    this.rowLabelColor = "#1b1c18";
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
    // An implicit StandardMaterial environment uses scene.environmentIntensity
    // directly. Borrow it explicitly only for Punk silver to retain its calibrated
    // reflection multiplier, while still following the Scene's changing light.
    const environment = style.design === "archive" ? options.environment ?? null : null;
    const environmentIntensity = Number.isFinite(options.environmentIntensity) ? Math.max(0, options.environmentIntensity!) : 1;
    const silverIntensity = environmentIntensity * this.silverEnvironmentFactor;
    if (this.railTopMaterial.envMap !== environment) {
      this.railTopMaterial.envMap = environment;
      this.railTopMaterial.needsUpdate = true;
    }
    this.railTopMaterial.envMapIntensity = silverIntensity;
    this.trays.setRailEnvironment(environment, silverIntensity);
    const rackVisible = style.design === "rhine" || style.shelf;
    this.trays.group.visible = rackVisible;
    const width = positive(options.width, 4.45);
    const depth = positive(options.depth, .14);
    const rowSpacing = Math.max(positive(options.rowSpacing, .62), depth + .2);
    const floorY = Number.isFinite(options.floorY) ? options.floorY : -4.6;
    const groundY = floorY - MUSIC_SHELF_VIEW.floorDrop;
    this.trays.setDimensions(width, depth, rowSpacing);
    this.laneEndPlatforms.geometry = this.trays.bedGeometry;

    const lanes = new Map<number, Lane>();
    for (let index = 0; index < this.capacity; index++) {
      const slot = options.slots[index];
      const alpha = Number.isFinite(slot?.alpha) ? clamp01(slot!.alpha!) : 1;
      const tint = Number.isFinite(slot?.tint) ? clamp01(slot!.tint!) : 0;
      const finite = Boolean(slot && finiteSlot(slot));
      const valid = Boolean(slot?.visible && finite && alpha > 0);
      this.trays.setSlot(index, finite ? slot!.x : 0, floorY, finite ? slot!.z : 0,
        valid && rackVisible, valid ? alpha : 0, tint);
      const tickVisible = valid && slot!.row % 5 === 0;
      this.writeBox(this.floorTicks, index, slot?.x ?? 0, groundY + .0005, slot?.z ?? 0,
        [.12, .001, .006], tickVisible);
      this.appearance.write(this.floorTicks, index, valid ? alpha : 0, tint);
      if (!valid) continue;
      const lane = lanes.get(slot!.lane);
      if (lane) {
        lane.minZ = Math.min(lane.minZ, slot!.z);
        lane.maxZ = Math.max(lane.maxZ, slot!.z);
        lane.minRow = Math.min(lane.minRow, slot!.row);
        lane.maxRow = Math.max(lane.maxRow, slot!.row);
      } else {
        lanes.set(slot!.lane, { x: slot!.x, minZ: slot!.z, maxZ: slot!.z, minRow: slot!.row, maxRow: slot!.row, alpha, tint });
      }
    }
    const laneList = [...lanes.entries()].sort(([a], [b]) => a - b).slice(0, this.capacity);
    const laneCount = laneList.length;
    this.laneBase.count = laneCount;
    this.laneLeftGuide.count = laneCount;
    this.laneRightGuide.count = laneCount;
    this.laneAccentLines.count = laneCount * 2;
    this.laneEndCaps.count = laneCount * 2;
    this.laneHazards.count = laneCount;
    this.laneFeet.count = laneCount * 4;
    this.laneUnderframe.count = laneCount * 2;
    this.laneFootPins.count = laneCount * 4;
    this.laneContactShadows.count = laneCount * 4;
    this.laneEndPlatforms.count = laneCount * 2;
    this.lanePlates.count = laneCount;
    this.plateMarks.count = laneCount;
    const floorHasPanel = style.floor === "real";
    this.floorPanels.visible = floorHasPanel;
    this.floorPanels.count = floorHasPanel ? laneCount : 0;
    const panelFloor = groundY + .0002;

    laneList.forEach(([, lane], laneIndex) => {
      // The source places front at slot -1 and back at slot 20, in addition
      // to its twenty regular slots. Both ends have a full empty landing.
      const span = Math.max(rowSpacing, lane.maxZ - lane.minZ + rowSpacing * 3);
      const centerZ = (lane.minZ + lane.maxZ) / 2;
      this.writeBox(this.laneBase, laneIndex, lane.x, floorY - .1475, centerZ,
        [width + .22, .135, span + .08], rackVisible);
      this.appearance.write(this.laneBase, laneIndex, lane.alpha, lane.tint);
      const sideX = width / 2 + .10;
      for (let side = 0; side < 2; side++) {
        const direction = side ? 1 : -1;
        const index = laneIndex * 2 + side;
        const guide = side ? this.laneRightGuide : this.laneLeftGuide;
        this.writeBox(guide, laneIndex, lane.x + direction * sideX, floorY, centerZ,
          [1, 1, span + .07], rackVisible, side ? this.identity : this.reverseRail);
        this.appearance.write(guide, laneIndex, lane.alpha, lane.tint);
        this.writeBox(this.laneAccentLines, index, lane.x + direction * (sideX + .101), floorY - (side ? .16 : .09), centerZ,
          [.006, .014, span], rackVisible);
        const endZ = centerZ + direction * (span / 2 + .018);
        this.writeBox(this.laneEndCaps, index, lane.x, floorY - .1475, endZ,
          [width + .38, .135, .072], rackVisible);
        this.writeBox(this.laneEndPlatforms, index, lane.x, floorY - .0525,
          side ? lane.maxZ + rowSpacing : lane.minZ - rowSpacing,
          [Math.max(.1, width - .09), .055, rowSpacing * .99], rackVisible);
        // Two round longitudinal rods sit under the tray, just inboard of
        // the bare square posts. They must not form ribs on the record deck.
        this.writeBox(this.laneUnderframe, index, lane.x + direction * (width * .38 - .08),
          floorY - .275, centerZ, [.14, .14, span + .04], rackVisible);
        for (const mesh of [this.laneAccentLines,
          this.laneEndCaps, this.laneEndPlatforms, this.laneUnderframe]) this.appearance.write(mesh, index, lane.alpha, lane.tint);
        for (let foot = 0; foot < 2; foot++) {
          const footIndex = laneIndex * 4 + side * 2 + foot;
          const legTop = floorY - .16;
          const legZ = endZ - direction * .02;
          this.writeBox(this.laneFeet, footIndex, lane.x + (foot ? 1 : -1) * width * .38,
            (legTop + groundY) / 2, legZ, [.15, legTop - groundY, .14], rackVisible);
          this.writeBox(this.laneFootPins, footIndex, lane.x + (foot ? 1 : -1) * width * .38,
            floorY - .32, legZ + direction * .073, [.055, .055, .018], rackVisible);
          this.appearance.write(this.laneFeet, footIndex, lane.alpha, lane.tint);
          this.appearance.write(this.laneFootPins, footIndex, lane.alpha, lane.tint);
          // A bounded contact-AO approximation complements the actual shadow
          // map, like the original floor's separate shade layer. Fade its alpha
          // toward the ground; do not tint a rectangular patch of that ground.
          this.writePlane(this.laneContactShadows, footIndex, lane.x + (foot ? 1 : -1) * width * .38,
            groundY + .0006, legZ, [.42, .34], rackVisible);
          this.appearance.write(this.laneContactShadows, footIndex, lane.alpha * (1 - lane.tint), 0);
        }
      }

      const frontZ = lane.maxZ + rowSpacing * 1.5 + .063;
      const plateY = floorY - .1475;
      this.writePlane(this.laneHazards, laneIndex, lane.x - width * .16, plateY, frontZ + .0065,
        [width * .68, .10], rackVisible, true);
      this.appearance.write(this.laneHazards, laneIndex, lane.alpha, lane.tint);
      this.writeBox(this.lanePlates, laneIndex, lane.x + width * .32, plateY, frontZ, [.82, .105, .012], rackVisible);
      this.appearance.write(this.lanePlates, laneIndex, lane.alpha, lane.tint);
      this.writeBox(this.plateMarks, laneIndex, lane.x + width * .32 - .35, plateY + .047, frontZ + .007,
        [.04, .008, .003], rackVisible);
      this.appearance.write(this.plateMarks, laneIndex, lane.alpha, lane.tint);
      this.writePlane(this.floorPanels, laneIndex, lane.x, panelFloor, centerZ,
        [width + .48, span + .18], options.shelf && floorHasPanel);
      this.appearance.write(this.floorPanels, laneIndex, lane.alpha, lane.tint);
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
      const plateY = floorY - .1475;
      const plateFront = lane.maxZ + rowSpacing * 1.5 + .070;
      label.mesh.position.set(lane.x + width * .32, plateY, plateFront);
      label.mesh.scale.set(.72, .09, 1);
      label.material.opacity = lane.alpha * (1 - lane.tint);
      label.mesh.visible = rackVisible && lane.alpha > 0;
    }

    this.trays.finish();
    this.markUpdated(this.laneBase, this.laneLeftGuide, this.laneRightGuide, this.laneAccentLines,
      this.laneEndCaps, this.laneHazards, this.laneFeet, this.laneUnderframe, this.laneFootPins, this.laneContactShadows, this.laneEndPlatforms,
      this.lanePlates, this.plateMarks, this.floorPanels, this.floorTicks);
  }

  dispose(): void {
    this.trays.dispose();
    if (this.ownsAppearance) this.appearance.dispose();
    for (const mesh of [this.laneBase, this.laneLeftGuide, this.laneRightGuide, this.laneAccentLines,
      this.laneEndCaps, this.laneHazards, this.laneFeet, this.laneUnderframe, this.laneFootPins, this.laneContactShadows, this.laneEndPlatforms,
      this.lanePlates, this.plateMarks, this.floorPanels, this.floorTicks]) mesh.dispose();
    this.box.dispose();
    this.roundedBox.dispose();
    this.railSection.dispose();
    this.backstopSection.dispose();
    this.footGeometry.dispose();
    this.underframeGeometry.dispose();
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
    this.railTopMaterial.dispose();
    this.backstopTopMaterial.dispose();
    this.endFaceMaterial.dispose();
    this.channelMaterial.dispose();
    this.hazardMaterial.dispose();
    this.endPlatformMaterial.dispose();
    this.contactShadowMaterial.dispose();
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
      label.context.font = "600 68px 'Archive Mono', 'Geist Mono', monospace";
      label.context.textAlign = "left";
      label.context.textBaseline = "middle";
      label.context.fillText(`ROW ${String(lane + 1).padStart(2, "0")}`, 12, 48, 492);
    }
    label.lane = lane;
    label.texture.needsUpdate = true;
  }

  private writeBox(mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>, index: number,
    x: number, y: number, z: number, dimensions: readonly [number, number, number], visible: boolean,
    rotation = this.identity) {
    this.position.set(x, y, z);
    this.scale.set(dimensions[0], dimensions[1], dimensions[2]);
    if (!visible) this.scale.set(0, 0, 0);
    this.matrix.compose(this.position, rotation, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private writePlane(mesh: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.Material>, index: number,
    x: number, y: number, z: number, dimensions: readonly [number, number], visible: boolean, vertical = false) {
    this.position.set(x, y, z);
    this.scale.set(dimensions[0], dimensions[1], 1);
    if (!visible) this.scale.set(0, 0, 0);
    this.matrix.compose(this.position, vertical ? this.identity : this.horizontal, this.scale);
    mesh.setMatrixAt(index, this.matrix);
  }

  private markUpdated(...meshes: THREE.InstancedMesh[]) {
    for (const mesh of meshes) {
      mesh.instanceMatrix.needsUpdate = true;
      this.appearance.finish(mesh);
    }
  }
}

function finiteSlot(slot: MusicSceneSlot): boolean {
  return Number.isFinite(slot.x) && Number.isFinite(slot.y) && Number.isFinite(slot.z) &&
    Number.isFinite(slot.row) && Number.isFinite(slot.lane);
}

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp01(value: number) {
  return THREE.MathUtils.clamp(value, 0, 1);
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
