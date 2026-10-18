import * as THREE from "three";
import type { ArchiveRecord } from "./data.ts";
import { assetUrl } from "./asset-url.ts";
import { labelMarkSvg } from "./brand.ts";
import type { CaseLayout } from "./case-layout.ts";
import { paintArchiveLabel, rhineSourceBadge } from "./archive-label.ts";
import { applyCaseMaterials } from "./case-materials";
import type { CaseAppearance } from "./case-settings";
import { albumLabelTileSizeForRows, createPaperAtlasLayout, type PaperAtlasLayout } from "./paper-atlas-layout.ts";

export type RhineInfoRecord = Pick<ArchiveRecord, "id" | "album">;
export type RhineSourceBadge = ReturnType<typeof rhineSourceBadge>;

const LABEL_WIDTH = 1024;
const LABEL_HEIGHT = 440;
const LABEL_COLUMNS = 16;
const LABEL_TILE_WIDTH = 256;
const BADGE_ATLAS_WIDTH = 512;
const BADGE_ATLAS_HEIGHT = 256;
const BADGE_CELL_SIZE = 256;
const BADGE_SIZE = 0.60;
const BADGE_GAP = 0.08;
const BADGE_ROW_WIDTH = BADGE_SIZE * 2 + BADGE_GAP;

const badgeVertexShader = `
#ifdef USE_INSTANCING
attribute float rhineBadgeType;
#else
uniform float uBadgeKind;
#endif
varying vec2 vLocalUv;
varying float vBadgeKind;
void main() {
  vLocalUv = uv;
#ifdef USE_INSTANCING
  vBadgeKind = rhineBadgeType;
  vec4 modelViewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
#else
  vBadgeKind = uBadgeKind;
  vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
#endif
  gl_Position = projectionMatrix * modelViewPosition;
}
`;

const badgeFragmentShader = `
uniform sampler2D uBadgeAtlas;
uniform float uTime;
uniform float uReduced;
varying vec2 vLocalUv;
varying float vBadgeKind;
void main() {
  if (vBadgeKind < 0.5) discard;
  float paired = step(2.5, vBadgeKind);
  float rightMark = step(0.5, vLocalUv.x);
  float center = paired * (rightMark - 0.5) * ${BADGE_SIZE + BADGE_GAP};
  vec2 markUv = vec2(((vLocalUv.x - 0.5) * ${BADGE_ROW_WIDTH} - center) / ${BADGE_SIZE} + 0.5, vLocalUv.y);
  if (markUv.x < 0.0 || markUv.x > 1.0) discard;
  float dsd = mix(step(1.5, vBadgeKind), rightMark, paired);
  vec4 badge = texture2D(uBadgeAtlas, vec2(markUv.x * 0.5 + dsd * 0.5, markUv.y));
  if (badge.a < 0.008) discard;
  float phase = fract(markUv.x - uTime * 0.12);
  float sweep = pow(max(0.0, 1.0 - abs(phase - 0.5) * 2.0), 16.0) * (1.0 - uReduced);
  float pulse = 0.5 + 0.5 * sin(uTime * 0.95);
  vec3 reflectedGold = vec3(1.0, 0.82, 0.52) * (0.025 + pulse * 0.025 + sweep * 0.13);
  gl_FragColor = vec4(badge.rgb + reflectedGold * badge.a, badge.a);
  #include <colorspace_fragment>
}
`;

function clockSeconds(): number {
  return typeof performance !== "undefined" ? performance.now() / 1000 : Date.now() / 1000;
}

function formatLabelNumber(index: number | undefined): string {
  const valid = typeof index === "number" && Number.isFinite(index) && Number.isInteger(index) && index >= 0;
  return valid ? `NO.${String(index + 1).padStart(3, "0")}` : "NO.---";
}

function badgeType(badge: RhineSourceBadge): number {
  return badge === "hi-res" ? 1 : badge === "dsd" ? 2 : badge === "hi-res-dsd" ? 3 : 0;
}

function badgeKeyValue(badge: RhineSourceBadge): RhineSourceBadge | null {
  return badge ?? null;
}

function resourceError(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
      else reject(new Error(`Image has no decoded pixels: ${url}`));
    };
    image.onerror = () => reject(new Error(`Could not load image: ${url}`));
    image.src = url;
  });
}

function configureCanvasTexture(texture: THREE.CanvasTexture, anisotropy: number): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.max(1, Math.floor(anisotropy));
}

function copyCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** Shared unlit archive labels; Rhine additionally carries source-format marks. */
export class CaseAlbumInfo {
  readonly arrayLabel: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly arrayBadge: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly selectedLabel: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly selectedBadge: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  readonly ready: Promise<void>;

  private readonly count: number;
  private readonly atlasLayout: PaperAtlasLayout;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  private readonly anisotropy: number;
  private readonly structure: "rhine" | "punk";
  private readonly labelCanvasHeight: number;
  private readonly tileOffsets: Float32Array;
  private readonly tilePages: Float32Array;
  private readonly badgeTypes: Float32Array;
  private readonly slotRecords: (RhineInfoRecord | undefined)[];
  private readonly slotIndices: (number | undefined)[];
  private readonly slotKeys: (string | undefined)[];
  private readonly slotNumberTexts: string[];
  private readonly slotBadges: RhineSourceBadge[];
  private readonly labelTileCanvas: HTMLCanvasElement;
  private readonly arrayLabelCanvases: HTMLCanvasElement[];
  private readonly selectedCanvas: HTMLCanvasElement;
  private readonly badgeAtlasCanvas: HTMLCanvasElement;
  private readonly arrayLabelTextures: THREE.CanvasTexture[];
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly badgeAtlasTexture: THREE.CanvasTexture;
  private readonly arrayLabelMaterial: THREE.MeshBasicMaterial;
  private readonly arrayBadgeMaterial: THREE.ShaderMaterial;
  private readonly selectedLabelMaterial: THREE.MeshBasicMaterial;
  private readonly selectedBadgeMaterial: THREE.ShaderMaterial;
  private layout: CaseLayout;
  private selectedRecord?: RhineInfoRecord;
  private selectedIndex?: number;
  private selectedKey?: string;
  private selectedBadgeKind: RhineSourceBadge;
  private labelMarkImage?: HTMLImageElement;
  private hiResImage?: HTMLImageElement;
  private dsdImage?: HTMLImageElement;
  private readonly assetErrors: Record<string, string> = {};
  private assetsSettled = false;
  private visible = false;
  private partVisible = true;
  private disposed = false;
  private motionTime?: number;
  private reduced = false;
  private frozenTime = clockSeconds();
  private lastRenderedTime = this.frozenTime;

  constructor(count: number, layout: CaseLayout, maxTextureSize = 4096, anisotropy = 1, structure: "rhine" | "punk" = "rhine") {
    this.count = Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0);
    this.layout = { ...layout, label: { ...layout.label } };
    this.structure = structure;
    this.labelCanvasHeight = structure === "punk" ? Math.max(1, Math.round(LABEL_WIDTH * layout.label.height / layout.label.width)) : LABEL_HEIGHT;
    this.anisotropy = Math.max(1, Math.floor(Number.isFinite(anisotropy) ? anisotropy : 1));
    const maxSize = Math.max(LABEL_COLUMNS, Math.floor(Number.isFinite(maxTextureSize) ? maxTextureSize : 4096));
    this.atlasLayout = createPaperAtlasLayout(this.count, maxSize, LABEL_COLUMNS,
      (rows, limit) => albumLabelTileSizeForRows(rows, limit, this.labelCanvasHeight));
    this.tileWidth = this.atlasLayout.tileWidth;
    this.tileHeight = this.atlasLayout.tileHeight;

    this.tileOffsets = new Float32Array(this.count * 4);
    this.tilePages = new Float32Array(this.count);
    this.badgeTypes = new Float32Array(this.count);
    this.slotRecords = Array(this.count);
    this.slotIndices = Array(this.count);
    this.slotKeys = Array(this.count);
    this.slotNumberTexts = Array.from({ length: this.count }, () => "NO.---");
    this.slotBadges = Array.from({ length: this.count }, () => undefined);
    for (let slot = 0; slot < this.count; slot++) {
      const location = this.atlasLayout.locate(slot)!;
      const page = this.atlasLayout.pages[location.page];
      const column = location.localSlot % LABEL_COLUMNS;
      const row = Math.floor(location.localSlot / LABEL_COLUMNS);
      this.tileOffsets.set([
        column / LABEL_COLUMNS,
        1 - (row + 1) / page.rows,
        1 / LABEL_COLUMNS,
        1 / page.rows,
      ], slot * 4);
      this.tilePages[slot] = location.page;
    }

    this.labelTileCanvas = document.createElement("canvas");
    this.labelTileCanvas.width = this.tileWidth;
    this.labelTileCanvas.height = this.tileHeight;
    this.arrayLabelCanvases = this.atlasLayout.pages.map(page => {
      const canvas = document.createElement("canvas");
      canvas.width = page.width;
      canvas.height = page.height;
      return canvas;
    });
    this.selectedCanvas = document.createElement("canvas");
    this.selectedCanvas.width = LABEL_WIDTH;
    this.selectedCanvas.height = this.labelCanvasHeight;
    this.badgeAtlasCanvas = document.createElement("canvas");
    this.badgeAtlasCanvas.width = BADGE_ATLAS_WIDTH;
    this.badgeAtlasCanvas.height = BADGE_ATLAS_HEIGHT;

    this.arrayLabelTextures = this.arrayLabelCanvases.map(canvas => new THREE.CanvasTexture(canvas));
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    this.badgeAtlasTexture = new THREE.CanvasTexture(this.badgeAtlasCanvas);
    for (const texture of this.arrayLabelTextures) configureCanvasTexture(texture, this.anisotropy);
    configureCanvasTexture(this.selectedTexture, this.anisotropy);
    configureCanvasTexture(this.badgeAtlasTexture, this.anisotropy);

    this.arrayLabelMaterial = this.createLabelMaterial(this.arrayLabelTextures[0], true, this.arrayLabelTextures[1]);
    this.selectedLabelMaterial = this.createLabelMaterial(this.selectedTexture, false);
    this.arrayBadgeMaterial = this.createBadgeMaterial(0, true);
    this.selectedBadgeMaterial = this.createBadgeMaterial(0, false);

    this.arrayLabel = new THREE.InstancedMesh(this.createArrayLabelGeometry(), this.arrayLabelMaterial, this.count);
    this.arrayBadge = new THREE.InstancedMesh(this.createArrayBadgeGeometry(), this.arrayBadgeMaterial, this.count);
    this.selectedLabel = new THREE.Mesh(this.createLabelGeometry(), this.selectedLabelMaterial);
    this.selectedBadge = new THREE.Mesh(this.createBadgeGeometry(), this.selectedBadgeMaterial);
    this.attachBadgeClock(this.arrayBadge);
    this.attachBadgeClock(this.selectedBadge);
    this.arrayLabel.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrayBadge.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrayLabel.frustumCulled = false;
    this.arrayBadge.frustumCulled = false;
    this.arrayLabel.visible = false;
    this.arrayBadge.visible = false;
    this.selectedLabel.visible = false;
    this.selectedBadge.visible = false;
    this.arrayLabel.name = "Rhine album label atlas";
    this.arrayBadge.name = "Rhine album badge atlas";
    this.selectedLabel.name = "Selected Rhine album label";
    this.selectedBadge.name = "Selected Rhine album badge";

    this.selectedBadgeKind = undefined;
    this.tagMesh(this.arrayLabel, "label", false);
    this.tagMesh(this.arrayBadge, "badge", false);
    this.tagMesh(this.selectedLabel, "label", false);
    this.tagMesh(this.selectedBadge, "badge", false);
    this.arrayLabel.userData.archiveIndex = this.slotIndices;
    this.arrayLabel.userData.numberText = this.slotNumberTexts;
    this.arrayLabel.userData.formatBadge = this.slotBadges;
    this.arrayBadge.userData.archiveIndex = this.slotIndices;
    this.arrayBadge.userData.numberText = this.slotNumberTexts;
    this.arrayBadge.userData.formatBadge = this.slotBadges;
    this.arrayBadge.userData.badgeType = this.badgeTypes;
    this.selectedBadge.userData.badgeType = 0;

    this.paintBadgeAtlas();
    this.refresh();
    this.syncResourceStatus();
    this.ready = this.loadAssets();
  }

  private tagMesh(mesh: THREE.Mesh, role: "label" | "badge", ownedTexture: boolean): void {
    mesh.userData.rhineAlbumInfo = true;
    mesh.userData.role = role;
    mesh.userData.assemblyPart = this.structure === "punk" ? "cover" : "carrier";
    if (this.structure === "punk" && role === "label") mesh.userData.casePart = "label";
    mesh.userData.rhineInfoOwnedTexture = ownedTexture;
  }

  private labelPosition(layout = this.layout) {
    const scale = layout.sourceScale || 1;
    if (this.structure === "punk") return {
      scale,
      x: layout.label.x,
      y: layout.label.y,
      z: layout.label.z + 0.002 * scale,
      width: layout.label.width * .96,
      height: layout.label.height * .96,
    };
    return {
      scale,
      x: layout.label.x + 0.025 * scale,
      y: layout.label.y,
      z: layout.label.z + 0.045 * scale,
      width: layout.label.width + 0.12 * scale,
      height: (layout.label.width + 0.12 * scale) * LABEL_HEIGHT / LABEL_WIDTH,
    };
  }

  private createLabelGeometry(): THREE.PlaneGeometry {
    const placement = this.labelPosition();
    const geometry = new THREE.PlaneGeometry(
      placement.width,
      placement.height,
    ).translate(placement.x, placement.y, placement.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private createBadgeGeometry(): THREE.PlaneGeometry {
    const placement = this.labelPosition();
    const geometry = new THREE.PlaneGeometry(BADGE_ROW_WIDTH * placement.scale, BADGE_SIZE * placement.scale).translate(
      placement.x,
      placement.y - 0.95 * placement.scale,
      placement.z,
    );
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private createArrayLabelGeometry(): THREE.PlaneGeometry {
    const geometry = this.createLabelGeometry();
    geometry.setAttribute("rhineTile", new THREE.InstancedBufferAttribute(this.tileOffsets, 4).setUsage(THREE.StaticDrawUsage));
    if (this.atlasLayout.paged)
      geometry.setAttribute("rhinePage", new THREE.InstancedBufferAttribute(this.tilePages, 1).setUsage(THREE.StaticDrawUsage));
    return geometry;
  }

  private createArrayBadgeGeometry(): THREE.PlaneGeometry {
    const geometry = this.createBadgeGeometry();
    geometry.setAttribute("rhineBadgeType", new THREE.InstancedBufferAttribute(this.badgeTypes, 1).setUsage(THREE.DynamicDrawUsage));
    return geometry;
  }

  private createLabelMaterial(texture: THREE.CanvasTexture, instanced: boolean, page1Texture?: THREE.CanvasTexture): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      fog: false,
      // This is an opaque printed label. Its depth must also hide the shell
      // behind it when Three draws the transmitting glass in a later pass.
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    material.userData.rhineInfoOwnedTexture = false;
    if (instanced) {
      const compile = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        shader.vertexShader = `attribute vec4 rhineTile;\n${shader.vertexShader}`;
        const pageVarying = page1Texture ? "attribute float rhinePage;\nvarying float vRhinePage;\n" : "";
        if (pageVarying) shader.vertexShader = pageVarying + shader.vertexShader;
        const uvPatch = `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = rhineTile.xy + uv * rhineTile.zw;\n${page1Texture ? " vRhinePage = rhinePage;\n" : ""}#endif`;
        shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", uvPatch);
        if (page1Texture) {
          shader.uniforms.uRhinePage1Map = { value: page1Texture };
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
            "#include <common>\nuniform sampler2D uRhinePage1Map;\nvarying float vRhinePage;");
          shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
            #ifdef USE_MAP
              vec4 sampledDiffuseColor;
              if ( vRhinePage < 0.5 ) sampledDiffuseColor = texture2D( map, vMapUv );
              else sampledDiffuseColor = texture2D( uRhinePage1Map, vMapUv );
              #ifdef DECODE_VIDEO_TEXTURE
                sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
              #endif
              diffuseColor *= sampledDiffuseColor;
            #endif
          `);
        }
      };
      material.customProgramCacheKey = () => `rhine-album-label-atlas-v2-${Number(!!page1Texture)}`;
    }
    return material;
  }

  private createBadgeMaterial(kind: number, instanced: boolean): THREE.ShaderMaterial {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBadgeAtlas: { value: this.badgeAtlasTexture },
        uBadgeKind: { value: kind },
        uTime: { value: this.lastRenderedTime },
        uReduced: { value: this.reduced ? 1 : 0 },
      },
      vertexShader: badgeVertexShader,
      fragmentShader: badgeFragmentShader,
      toneMapped: false,
      fog: false,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    material.userData.rhineInfoOwnedTexture = false;
    material.userData.rhineInfoInstanced = instanced;
    return material;
  }

  private attachBadgeClock(mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>): void {
    const material = mesh.material;
    mesh.onBeforeRender = () => {
      const time = this.reduced ? this.frozenTime : this.motionTime ?? clockSeconds();
      this.lastRenderedTime = time;
      material.uniforms.uTime.value = time;
      material.uniforms.uReduced.value = this.reduced ? 1 : 0;
      material.uniformsNeedUpdate = true;
    };
  }

  private keyFor(record: RhineInfoRecord | undefined, index: number | undefined, badge: RhineSourceBadge): string {
    return JSON.stringify([
      record?.id ?? null,
      typeof index === "number" && Number.isFinite(index) ? index : index === undefined ? null : String(index),
      badgeKeyValue(badge),
    ]);
  }

  private async loadAssets(): Promise<void> {
    const markUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(labelMarkSvg)}`;
    const fontsReady = document.fonts ? Promise.allSettled([
      document.fonts.load("bold 81px MiSans"),
      document.fonts.load("32px MiSans"),
    ]) : Promise.resolve();
    const results = await Promise.allSettled([
      loadImage(markUrl),
      this.structure === "rhine" ? loadImage(assetUrl("audio-tech/hi-res.svg")) : Promise.resolve(undefined),
      this.structure === "rhine" ? loadImage(assetUrl("audio-tech/dsd.svg")) : Promise.resolve(undefined),
    ]);
    await fontsReady;
    if (this.disposed) return;
    const keys = ["labelMark", "hiRes", "dsd"] as const;
    const images: (HTMLImageElement | undefined)[] = [];
    results.forEach((result, index) => {
      const key = keys[index];
      if (result.status === "fulfilled") images[index] = result.value;
      else {
        images[index] = undefined;
        this.assetErrors[key] = resourceError(result.reason);
      }
    });
    this.labelMarkImage = images[0];
    this.hiResImage = images[1];
    this.dsdImage = images[2];
    this.assetsSettled = true;
    this.paintBadgeAtlas();
    this.refresh();
    this.syncResourceStatus();
  }

  private paintBadgeCell(
    context: CanvasRenderingContext2D,
    image: HTMLImageElement | undefined,
    kind: "hi-res" | "dsd",
    x: number,
  ): void {
    context.save();
    context.beginPath();
    context.rect(x, 0, BADGE_CELL_SIZE, BADGE_ATLAS_HEIGHT);
    context.clip();
    if (image) {
      const sourceWidth = image.naturalWidth || BADGE_CELL_SIZE;
      const sourceHeight = image.naturalHeight || BADGE_CELL_SIZE;
      const maxWidth = kind === "hi-res" ? 208 : 220;
      const maxHeight = kind === "hi-res" ? 208 : 190;
      const fit = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
      const width = sourceWidth * fit;
      const height = sourceHeight * fit;
      const left = x + (BADGE_CELL_SIZE - width) / 2;
      const top = (BADGE_ATLAS_HEIGHT - height) / 2;
      context.shadowColor = "rgba(221, 199, 124, 0.48)";
      context.shadowBlur = 18;
      context.drawImage(image, left, top, width, height);
      if (kind === "dsd") {
        context.shadowColor = "transparent";
        context.shadowBlur = 0;
        context.globalCompositeOperation = "source-in";
        context.fillStyle = "#b4802c";
        context.fillRect(x, 0, BADGE_CELL_SIZE, BADGE_ATLAS_HEIGHT);
        context.globalCompositeOperation = "source-over";
      }
    } else {
      context.fillStyle = "#b4802c";
      context.shadowColor = "rgba(221, 199, 124, 0.5)";
      context.shadowBlur = 15;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = kind === "hi-res" ? "bold 30px sans-serif" : "bold 42px sans-serif";
      context.fillText(kind === "hi-res" ? "HI-RES" : "DSD", x + BADGE_CELL_SIZE / 2, BADGE_ATLAS_HEIGHT / 2);
    }
    context.restore();
  }

  private paintBadgeAtlas(): void {
    const context = this.badgeAtlasCanvas.getContext("2d")!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, BADGE_ATLAS_WIDTH, BADGE_ATLAS_HEIGHT);
    this.paintBadgeCell(context, this.hiResImage, "hi-res", 0);
    this.paintBadgeCell(context, this.dsdImage, "dsd", BADGE_CELL_SIZE);
    this.badgeAtlasTexture.needsUpdate = true;
  }

  private paintSlot(slot: number, force = false): void {
    const record = this.slotRecords[slot];
    const index = this.slotIndices[slot];
    const badge = this.structure === "rhine" ? rhineSourceBadge(record?.album) : undefined;
    const key = this.keyFor(record, index, badge);
    if (!force && this.slotKeys[slot] === key) return;
    this.slotKeys[slot] = key;
    this.slotBadges[slot] = badge;
    this.slotNumberTexts[slot] = formatLabelNumber(index);
    paintArchiveLabel(this.labelTileCanvas, index, this.labelMarkImage, { fit: this.structure === "punk" ? "contain" : "stretch" });
    const location = this.atlasLayout.locate(slot)!;
    const column = location.localSlot % LABEL_COLUMNS;
    const row = Math.floor(location.localSlot / LABEL_COLUMNS);
    const x = column * this.tileWidth;
    const y = row * this.tileHeight;
    const context = this.arrayLabelCanvases[location.page].getContext("2d")!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(x, y, this.tileWidth, this.tileHeight);
    context.drawImage(this.labelTileCanvas, x, y, this.tileWidth, this.tileHeight);
    this.arrayLabelTextures[location.page].needsUpdate = true;
    this.badgeTypes[slot] = badgeType(badge);
    this.arrayBadge.geometry.getAttribute("rhineBadgeType").setX(slot, this.badgeTypes[slot]);
    this.arrayBadge.geometry.getAttribute("rhineBadgeType").needsUpdate = true;
    this.arrayLabel.userData.archiveIndex = this.slotIndices;
    this.arrayLabel.userData.numberText = this.slotNumberTexts;
    this.arrayLabel.userData.formatBadge = this.slotBadges;
    this.arrayBadge.userData.archiveIndex = this.slotIndices;
    this.arrayBadge.userData.numberText = this.slotNumberTexts;
    this.arrayBadge.userData.formatBadge = this.slotBadges;
    this.arrayBadge.userData.badgeType = this.badgeTypes;
  }

  private paintSelected(force = false): void {
    const badge = this.structure === "rhine" ? rhineSourceBadge(this.selectedRecord?.album) : undefined;
    const key = this.keyFor(this.selectedRecord, this.selectedIndex, badge);
    if (!force && this.selectedKey === key) return;
    this.selectedKey = key;
    this.selectedBadgeKind = badge;
    paintArchiveLabel(this.selectedCanvas, this.selectedIndex, this.labelMarkImage, { fit: this.structure === "punk" ? "contain" : "stretch" });
    this.selectedTexture.needsUpdate = true;
    const kind = badgeType(badge);
    this.selectedBadgeMaterial.uniforms.uBadgeKind.value = kind;
    this.selectedBadgeMaterial.uniformsNeedUpdate = true;
    this.selectedLabel.userData.archiveIndex = this.selectedIndex;
    this.selectedLabel.userData.numberText = formatLabelNumber(this.selectedIndex);
    this.selectedBadge.userData.archiveIndex = this.selectedIndex;
    this.selectedBadge.userData.numberText = formatLabelNumber(this.selectedIndex);
    this.selectedBadge.userData.formatBadge = badge;
    this.selectedBadge.userData.badgeType = kind;
    this.updateVisibility();
  }

  private syncResourceStatus(): void {
    const errors = { ...this.assetErrors };
    const resources = {
      state: !this.assetsSettled ? "loading" : Object.keys(errors).length ? "degraded" : "ready",
      labelMark: this.labelMarkImage ? "loaded" : this.assetsSettled ? "omitted" : "pending",
      hiResBadge: this.structure === "punk" ? "not-used" : this.hiResImage ? "loaded" : this.assetsSettled ? "text-fallback" : "text-fallback-pending",
      dsdBadge: this.structure === "punk" ? "not-used" : this.dsdImage ? "loaded" : this.assetsSettled ? "text-fallback" : "text-fallback-pending",
      errors,
    };
    for (const mesh of [this.arrayLabel, this.arrayBadge, this.selectedLabel, this.selectedBadge])
      mesh.userData.rhineAlbumInfoResources = resources;
  }

  private updateVisibility(): void {
    this.selectedLabel.visible = this.visible && this.partVisible;
    this.selectedBadge.visible = this.structure === "rhine" && this.visible && badgeType(this.selectedBadgeKind) > 0;
    this.arrayLabel.visible = this.visible && this.partVisible && this.count > 0;
    this.arrayBadge.visible = this.structure === "rhine" && this.visible && this.count > 0;
  }

  /** Set one visible-pool slot. An explicit refresh handles in-place metadata edits. */
  setSlot(slot: number, record?: RhineInfoRecord, index?: number): void {
    if (this.disposed || !Number.isInteger(slot) || slot < 0 || slot >= this.count) return;
    if (this.slotRecords[slot] === record && this.slotIndices[slot] === index) return;
    this.slotRecords[slot] = record;
    this.slotIndices[slot] = index;
    this.slotKeys[slot] = undefined;
    this.paintSlot(slot, true);
  }

  select(record?: RhineInfoRecord, index?: number): void {
    if (this.disposed) return;
    this.selectedRecord = record;
    this.selectedIndex = index;
    this.paintSelected();
  }

  /** Recompute visual keys and repaint after record metadata was edited in place. */
  refresh(): void {
    if (this.disposed) return;
    this.slotKeys.fill(undefined);
    for (let slot = 0; slot < this.count; slot++) this.paintSlot(slot, true);
    this.selectedKey = undefined;
    this.paintSelected(true);
  }

  setLayout(layout: CaseLayout): void {
    if (this.disposed) return;
    const previous = this.labelPosition();
    this.layout = { ...layout, label: { ...layout.label } };
    const next = this.labelPosition();
    if (previous.x === next.x && previous.y === next.y && previous.z === next.z &&
      previous.width === next.width && previous.height === next.height && previous.scale === next.scale) return;
    const oldGeometries = [
      this.arrayLabel.geometry,
      this.arrayBadge.geometry,
      this.selectedLabel.geometry,
      this.selectedBadge.geometry,
    ];
    this.arrayLabel.geometry = this.createArrayLabelGeometry();
    this.arrayBadge.geometry = this.createArrayBadgeGeometry();
    this.selectedLabel.geometry = this.createLabelGeometry();
    this.selectedBadge.geometry = this.createBadgeGeometry();
    oldGeometries.forEach(geometry => geometry.dispose());
  }

  setVisibility(visible: boolean): void {
    if (this.disposed) return;
    this.visible = visible;
    this.updateVisibility();
  }

  /** Keep a Punk plaque's print on the same pivot as its editable physical plate. */
  applyAppearance(appearance: CaseAppearance, model: THREE.Object3D): void {
    if (this.disposed || this.structure !== "punk") return;
    let pivot: number[] | undefined;
    model.traverse(object => {
      if (pivot || !(object instanceof THREE.Mesh) || object.userData.rhineAlbumInfo || object.userData.casePart !== "label") return;
      const value = object.geometry.userData.casePartPivot;
      if (Array.isArray(value) && value.length === 3) pivot = value;
      else {
        object.geometry.computeBoundingBox();
        const basePivot = object.geometry.boundingBox!.getCenter(new THREE.Vector3()).toArray();
        pivot = basePivot;
        object.geometry.userData.casePartPivot = [...basePivot];
      }
    });
    for (const mesh of [this.selectedLabel, this.arrayLabel]) {
      if (pivot) mesh.geometry.userData.casePartPivot = [...pivot];
      applyCaseMaterials(mesh, appearance);
    }
    this.partVisible = appearance.transforms?.label?.visible !== false;
    this.updateVisibility();
  }

  setMotion(time: number | undefined, reduced: boolean): void {
    if (this.disposed) return;
    if (reduced && !this.reduced)
      this.frozenTime = time ?? (this.lastRenderedTime || clockSeconds());
    if (!reduced) this.motionTime = Number.isFinite(time) ? time : undefined;
    this.reduced = reduced;
    this.arrayBadgeMaterial.uniforms.uReduced.value = reduced ? 1 : 0;
    this.selectedBadgeMaterial.uniforms.uReduced.value = reduced ? 1 : 0;
    this.arrayBadgeMaterial.uniformsNeedUpdate = true;
    this.selectedBadgeMaterial.uniformsNeedUpdate = true;
  }

  /** Give an outgoing group a private label map/material and an independent badge shader. */
  snapshot(group: THREE.Group): void {
    if (this.disposed) return;
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh ||
        object.userData.rhineAlbumInfo !== true) return;
      if (object.userData.role === "label") {
        const canvas = copyCanvas(this.selectedCanvas, LABEL_WIDTH, this.labelCanvasHeight);
        const texture = new THREE.CanvasTexture(canvas);
        configureCanvasTexture(texture, this.anisotropy);
        const material = this.createLabelMaterial(texture, false);
        material.userData.rhineInfoOwnedTexture = true;
        material.visible = this.selectedLabel.material.visible;
        object.material = material;
        object.visible = this.visible;
        object.userData.rhineInfoOwnedTexture = true;
      } else if (object.userData.role === "badge") {
        const kind = Number(object.userData.badgeType ?? this.selectedBadgeMaterial.uniforms.uBadgeKind.value) || 0;
        const material = this.createBadgeMaterial(kind, false);
        object.material = material;
        this.attachBadgeClock(object as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>);
        object.userData.badgeType = kind;
        object.userData.rhineInfoOwnedTexture = false;
        object.userData.rhineAlbumInfoResources = this.selectedBadge.userData.rhineAlbumInfoResources;
      }
      object.userData.assemblyPart = this.structure === "punk" ? "cover" : "carrier";
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of [this.arrayLabel, this.arrayBadge, this.selectedLabel, this.selectedBadge])
      mesh.removeFromParent();
    this.arrayLabel.geometry.dispose();
    this.arrayBadge.geometry.dispose();
    this.selectedLabel.geometry.dispose();
    this.selectedBadge.geometry.dispose();
    this.arrayLabelMaterial.dispose();
    this.arrayBadgeMaterial.dispose();
    this.selectedLabelMaterial.dispose();
    this.selectedBadgeMaterial.dispose();
    for (const texture of this.arrayLabelTextures) texture.dispose();
    this.selectedTexture.dispose();
    this.badgeAtlasTexture.dispose();
  }
}

// Preserve the earlier public name for existing callers and isolated checks.
export { CaseAlbumInfo as RhineAlbumInfo };
