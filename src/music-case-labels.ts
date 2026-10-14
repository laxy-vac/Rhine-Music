import * as THREE from "three";
import type { ArchiveRecord } from "./data";
import { MUSIC_MODEL, createAlbumPrintMaterial } from "./music-model";

const COLUMNS = 16;
const MAX_SLOTS = 432;
const TILE_WIDTH = 256;
const TILE_HEIGHT = 32;
const SELECTED_WIDTH = 512;
const SELECTED_HEIGHT = 64;
const PAPER = "#e9e6dd";
const INK = "#1b1c18";
const DEFAULT_ACCENT = "#b98b57";
const TITLE_X = -0.35;
const TITLE_Z = MUSIC_MODEL.depth * 0.13;
const TITLE_Y = MUSIC_MODEL.center.y + MUSIC_MODEL.height / 2 + 0.002;
// Keep the title print inside the box's top projection while leaving a clear
// strip of shell visible around it.
const TITLE_DEPTH = MUSIC_MODEL.depth * 0.46;
const TITLE_WIDTH = MUSIC_MODEL.width * 0.7;

function titleKey(record?: ArchiveRecord) {
  return record ? `${record.id}\u0000${record.title}` : undefined;
}

function isCjk(value: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(value);
}

function displayTitle(record: ArchiveRecord) {
  const title = record.title.trim();
  return title ? title.toLocaleUpperCase("en-US") : "UNTITLED";
}

/**
 * Prints a small paper title strip onto each native 3D case and the selected
 * case. Atlas tiles are drawn only when a record or accent changes.
 */
export class MusicCaseLabels {
  readonly array: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;

  private readonly columns = COLUMNS;
  private readonly rows: number;
  private readonly capacity: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  private readonly atlasCanvas = document.createElement("canvas");
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly atlas: THREE.CanvasTexture;
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly slotRecords: (ArchiveRecord | undefined)[];
  private readonly slotKeys: (string | undefined)[];
  private selectedRecord?: ArchiveRecord;
  private selectedKey?: string;
  private accent = DEFAULT_ACCENT;
  private enabled = false;
  private atlasDirty = false;
  private selectedDirty = false;
  private matrixDirty = false;

  constructor(count: number, maxTextureSize: number, anisotropy: number) {
    const maxSize = Math.max(this.columns, Math.floor(maxTextureSize) || 4096);
    this.tileWidth = Math.max(1, Math.min(TILE_WIDTH, Math.floor(maxSize / this.columns)));
    const proportionalHeight = Math.max(1, Math.floor(this.tileWidth * TILE_HEIGHT / TILE_WIDTH));
    const maximumRows = Math.max(1, Math.floor(maxSize / proportionalHeight));
    this.capacity = Math.min(MAX_SLOTS, Math.max(0, Math.floor(count)), this.columns * maximumRows);
    this.rows = Math.max(1, Math.ceil(this.capacity / this.columns));
    this.tileHeight = Math.max(
      1,
      Math.min(TILE_HEIGHT, Math.floor(maxSize / this.rows), Math.floor(this.tileWidth * TILE_HEIGHT / TILE_WIDTH)),
    );
    this.atlasCanvas.width = this.columns * this.tileWidth;
    this.atlasCanvas.height = this.rows * this.tileHeight;
    this.selectedCanvas.width = SELECTED_WIDTH;
    this.selectedCanvas.height = SELECTED_HEIGHT;
    this.slotRecords = Array(this.capacity);
    this.slotKeys = Array(this.capacity);

    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = THREE.LinearFilter;
    this.atlas.magFilter = THREE.LinearFilter;
    this.atlas.anisotropy = Math.max(1, Math.min(4, anisotropy));

    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    this.selectedTexture.colorSpace = THREE.SRGBColorSpace;
    this.selectedTexture.generateMipmaps = false;
    this.selectedTexture.minFilter = THREE.LinearFilter;
    this.selectedTexture.magFilter = THREE.LinearFilter;
    this.selectedTexture.anisotropy = Math.max(1, Math.min(8, anisotropy));

    const labelGeometry = () => new THREE.PlaneGeometry(TITLE_WIDTH, TITLE_DEPTH)
      .rotateX(-Math.PI / 2)
      .translate(TITLE_X, TITLE_Y, TITLE_Z);
    const geometry = labelGeometry();
    const labelTiles = new Float32Array(this.capacity * 4);
    for (let index = 0; index < this.capacity; index++) {
      labelTiles.set([
        (index % this.columns) / this.columns,
        1 - (Math.floor(index / this.columns) + 1) / this.rows,
        1 / this.columns,
        1 / this.rows,
      ], index * 4);
    }
    geometry.setAttribute(
      "labelTile",
      new THREE.InstancedBufferAttribute(labelTiles, 4),
    );

    const material = this.makeMaterial(this.atlas);
    const compilePrint = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compilePrint.call(material, shader, renderer);
      shader.vertexShader = `attribute vec4 labelTile;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvMapUv = labelTile.xy + uv * labelTile.zw;",
      );
    };
    material.customProgramCacheKey = () => "native-case-label-atlas-v1";
    this.array = new THREE.InstancedMesh(geometry, material, this.capacity);
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.array.frustumCulled = false;
    this.array.visible = false;
    this.array.name = "Native case title atlas";

    this.selected = new THREE.Mesh(labelGeometry(), this.makeMaterial(this.selectedTexture));
    this.selected.userData.nativeCaseLabel = true;
    this.selected.userData.surface = "Native_Case_Title";
    this.selected.userData.albumCover = true;
    this.selected.visible = false;
    this.selected.name = "Selected native case title";
  }

  private makeMaterial(map: THREE.Texture) {
    const material = createAlbumPrintMaterial(map);
    Object.assign(material, {
      side: THREE.DoubleSide,
      alphaTest: 0.01,
      toneMapped: false,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });
    return material;
  }

  private drawTitle(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    record: ArchiveRecord,
  ) {
    context.clearRect(x, y, width, height);
    context.fillStyle = PAPER;
    context.fillRect(x, y, width, height);

    const insetY = Math.max(1, Math.round(height * 0.2));
    const stripeWidth = Math.max(1, Math.round(width * 0.012));
    const stripeX = x + Math.max(2, Math.round(width * 0.035));
    context.fillStyle = this.accent;
    context.fillRect(stripeX, y + insetY, stripeWidth, height - insetY * 2);

    const title = displayTitle(record);
    const fontSize = Math.max(7, Math.round(height * 0.52));
    const font = isCjk(title)
      ? `600 ${fontSize}px "Microsoft YaHei UI", MiSans, sans-serif`
      : `600 ${fontSize}px "Archive Mono", ui-monospace, Consolas, monospace`;
    context.font = font;
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = INK;

    const textX = stripeX + stripeWidth + Math.max(4, Math.round(width * 0.025));
    const rightInset = Math.max(3, Math.round(width * 0.035));
    const available = Math.max(0, x + width - rightInset - textX);
    const glyphs = Array.from(title);
    let fitted = title;
    if (context.measureText(fitted).width > available) {
      while (glyphs.length > 0) {
        glyphs.pop();
        fitted = `${glyphs.join("")}…`;
        if (context.measureText(fitted).width <= available) break;
      }
      if (context.measureText(fitted).width > available) fitted = "";
    }

    context.save();
    context.beginPath();
    context.rect(textX, y, available, height);
    context.clip();
    if (fitted) context.fillText(fitted, textX, y + height / 2);
    context.restore();
  }

  private redrawSlot(index: number) {
    const record = this.slotRecords[index];
    const context = this.atlasCanvas.getContext("2d");
    if (!context) return;
    const x = (index % this.columns) * this.tileWidth;
    const y = Math.floor(index / this.columns) * this.tileHeight;
    context.clearRect(x, y, this.tileWidth, this.tileHeight);
    if (record) this.drawTitle(context, x, y, this.tileWidth, this.tileHeight, record);
    this.atlasDirty = true;
  }

  private redrawSelected() {
    const context = this.selectedCanvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, SELECTED_WIDTH, SELECTED_HEIGHT);
    if (this.selectedRecord)
      this.drawTitle(context, 0, 0, SELECTED_WIDTH, SELECTED_HEIGHT, this.selectedRecord);
    this.selectedDirty = true;
  }

  setStyle(visible: boolean, accent: string) {
    const nextAccent = accent || DEFAULT_ACCENT;
    const accentChanged = nextAccent !== this.accent;
    this.accent = nextAccent;
    this.enabled = visible;
    this.array.visible = visible;
    this.selected.visible = visible && Boolean(this.selectedRecord);
    if (!accentChanged) return;
    for (let index = 0; index < this.capacity; index++)
      if (this.slotRecords[index]) this.redrawSlot(index);
    if (this.selectedRecord) this.redrawSelected();
  }

  setSlot(index: number, record: ArchiveRecord | undefined) {
    if (index < 0 || index >= this.capacity) return;
    const key = titleKey(record);
    if (this.slotKeys[index] === key) return;
    this.slotKeys[index] = key;
    this.slotRecords[index] = record;
    this.redrawSlot(index);
  }

  setMatrixAt(index: number, matrix: THREE.Matrix4) {
    if (index < 0 || index >= this.capacity) return;
    this.array.setMatrixAt(index, matrix);
    this.matrixDirty = true;
  }

  finish() {
    if (this.matrixDirty) {
      this.array.instanceMatrix.needsUpdate = true;
      this.matrixDirty = false;
    }
    if (this.atlasDirty) {
      this.atlas.needsUpdate = true;
      this.atlasDirty = false;
    }
    if (this.selectedDirty) {
      this.selectedTexture.needsUpdate = true;
      this.selectedDirty = false;
    }
  }

  setSelected(record: ArchiveRecord | undefined) {
    const key = titleKey(record);
    if (this.selectedKey !== key) {
      this.selectedKey = key;
      this.selectedRecord = record;
      this.redrawSelected();
    }
    this.selected.visible = this.enabled && Boolean(record);
  }

  /** Give a returning model clone a private title texture before selection moves. */
  snapshot(mesh: THREE.Mesh) {
    const canvas = document.createElement("canvas");
    canvas.width = SELECTED_WIDTH;
    canvas.height = SELECTED_HEIGHT;
    const context = canvas.getContext("2d");
    if (context) context.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = this.selectedTexture.anisotropy;
    texture.needsUpdate = true;
    mesh.material = this.makeMaterial(texture);
    mesh.userData.nativeLabelSnapshot = true;
  }
}
