import * as THREE from "three";
import type { MusicSelectionLighting } from "./music-lighting";
import type { ArchiveRecord } from "./data";
import type { CaseRect } from "./case-layout.ts";
import { MUSIC_COVER, createAlbumPrintMaterial } from "./music-model.ts";
import { albumInsertGeometry, createAlbumInsert } from "./album-insert.ts";

// Default print layout. Rhine/Punk shells retarget it to a card inside the glass.
export const COVER_SIZE = MUSIC_COVER;
type CoverImage = { source: HTMLCanvasElement; width: number; height: number };
const COVER_PAINT_SIZE = 1024;
// Use the same UV margin at every texture resolution. A fixed two-pixel inset
// made the 256px atlas artwork smaller than its 1024px lifted/returning copy.
export const COVER_INSET = 1 / 128;
const COVER_PAINT_MARGIN = COVER_PAINT_SIZE * COVER_INSET;

export function containCover(
  width: number,
  height: number,
  boxWidth: number,
  boxHeight: number,
) {
  const scale = Math.min(
    boxWidth / Math.max(1, width),
    boxHeight / Math.max(1, height),
  );
  const drawnWidth = width * scale,
    drawnHeight = height * scale;
  return {
    x: (boxWidth - drawnWidth) / 2,
    y: (boxHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
  };
}

function paintCover(
  canvas: HTMLCanvasElement,
  record: ArchiveRecord | undefined,
  image?: CoverImage,
) {
  // These canvases feed WebGL uploads and crop/copy operations. Keeping their
  // pixels on the CPU avoids a GPU readback of the large atlas for every tile.
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  // Paint in one logical coordinate space, including fallback art and labels.
  // Ownership can move between atlas/selection/snapshot without rescaling art.
  const width = COVER_PAINT_SIZE,
    height = COVER_PAINT_SIZE,
    margin = COVER_PAINT_MARGIN;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.clearRect(0, 0, width, height);
  if (image) {
    const box = containCover(image.width, image.height, width - margin * 2, height - margin * 2);
    context.drawImage(
      image.source,
      box.x + margin,
      box.y + margin,
      box.width,
      box.height,
    );
    return;
  }
  // A missing cover is explicit and never substituted with another album's art.
  const size = height - margin * 2,
    left = (width - size) / 2;
  context.fillStyle = "#c9c9c4";
  context.fillRect(left, margin, size, size);
  context.strokeStyle = "#f8f7f1";
  context.lineWidth = Math.max(1, height / 180);
  context.beginPath();
  context.arc(width / 2, height * 0.43, height * 0.2, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(width / 2, height * 0.43, height * 0.04, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "#3f4849";
  context.textAlign = "center";
  context.font = `500 ${Math.max(12, height * 0.045)}px sans-serif`;
  context.fillText(
    record?.title ?? "暂无专辑封面",
    width / 2,
    height * 0.8,
    height * 0.83,
  );
  context.font = `${Math.max(9, height * 0.025)}px sans-serif`;
  context.fillText(
    "LOCAL COLLECTION / NO COVER",
    width / 2,
    height * 0.87,
    height * 0.83,
  );
}

/** One fixed-size atlas for the visible pool, regardless of total library size. */
export class CoverAtlas {
  readonly array: THREE.InstancedMesh;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  readonly arrayInsert: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  readonly selectedInsert: THREE.Mesh<THREE.BoxGeometry, THREE.MeshLambertMaterial>;
  private readonly atlasCanvas = document.createElement("canvas");
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly tileCanvas = document.createElement("canvas");
  private readonly uploadCanvas = document.createElement("canvas");
  private readonly uploadTexture = new THREE.CanvasTexture(this.uploadCanvas);
  private readonly dirtySlots = new Set<number>();
  private atlasUploaded = false;
  private readonly atlas: THREE.CanvasTexture;
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly pendingImages = new Map<string, Promise<CoverImage | undefined>>();
  private readonly decodedImages = new Map<string, CoverImage | undefined>();
  private readonly slotKeys: (string | undefined)[];
  private readonly recordKeys = new WeakMap<ArchiveRecord, string>();
  private readonly tileOffsets: Float32Array;
  private layout: CaseRect = { ...COVER_SIZE };
  private insertThickness = 0;
  private selectedRecord?: ArchiveRecord;
  private selectedKey?: string;
  private generation = 0;
  private disposed = false;
  private readonly columns = 16;
  private readonly rows: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;

  constructor(
    count: number,
    maxTextureSize: number,
    anisotropy: number,
    lighting?: MusicSelectionLighting,
    layout: CaseRect = COVER_SIZE,
  ) {
    this.layout = { ...layout };
    this.rows = Math.ceil(count / this.columns);
    this.tileWidth = Math.min(
      256,
      Math.floor(maxTextureSize / this.columns),
      Math.floor(maxTextureSize / this.rows),
    );
    this.tileHeight = this.tileWidth;
    this.atlasCanvas.width = this.columns * this.tileWidth;
    this.atlasCanvas.height = this.rows * this.tileHeight;
    this.tileCanvas.width = this.tileWidth;
    this.tileCanvas.height = this.tileHeight;
    this.selectedCanvas.width = COVER_PAINT_SIZE;
    this.selectedCanvas.height = COVER_PAINT_SIZE;
    this.slotKeys = Array(count);
    this.atlas = new THREE.CanvasTexture(this.atlasCanvas);
    this.atlas.colorSpace = THREE.SRGBColorSpace;
    // No whole-atlas mip pyramid: independent transparent tile margins prevent bleed.
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = THREE.LinearFilter;
    this.uploadTexture.colorSpace = THREE.SRGBColorSpace;
    this.uploadTexture.generateMipmaps = false;
    this.atlas.anisotropy = Math.min(4, anisotropy);
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    this.selectedTexture.colorSpace = THREE.SRGBColorSpace;
    this.selectedTexture.anisotropy = Math.min(8, anisotropy);
    const tileOffsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      tileOffsets.set(
        [
          (i % this.columns) / this.columns,
          1 - (Math.floor(i / this.columns) + 1) / this.rows,
          1 / this.columns,
          1 / this.rows,
        ],
        i * 4,
      );
    }
    this.tileOffsets = tileOffsets;
    // Instances, selected art and snapshots use one matte diffuse material and
    // one moving light field; no ownership-specific brightness/scale switches.
    const makePrint = (texture: THREE.Texture) => {
      const print = createAlbumPrintMaterial(texture);
      const compile = print.onBeforeCompile;
      print.onBeforeCompile = (shader, renderer) => {
        compile.call(print, shader, renderer);
        lighting?.shadePrint(shader);
      };
      print.customProgramCacheKey = () => `album-diffuse-print-${Boolean(lighting)}-v1`;
      return print;
    };
    const material = makePrint(this.atlas);
    const compileAtlas = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
      compileAtlas.call(material, shader, renderer);
      shader.vertexShader = "attribute vec4 coverTile;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvMapUv = coverTile.xy + uv * coverTile.zw;",
      );
    };
    material.customProgramCacheKey = () => `album-diffuse-atlas-${Boolean(lighting)}-v1`;
    this.array = new THREE.InstancedMesh(
      this.createArrayGeometry(this.layout),
      material,
      count,
    );
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.array.frustumCulled = false;
    this.array.visible = false;
    this.array.name = "Album cover atlas";
    this.array.receiveShadow = true;
    this.selected = new THREE.Mesh(
      this.createSelectedGeometry(this.layout),
      makePrint(this.selectedTexture),
    );
    this.selected.userData.albumCover = true;
    this.selected.visible = false;
    this.selected.name = "Selected album cover";
    this.selected.receiveShadow = true;

    this.selectedInsert = createAlbumInsert(this.layout, 0);
    this.selectedInsert.visible = false;
    this.selectedInsert.name = "Selected album paper insert";
    this.arrayInsert = new THREE.InstancedMesh(
      albumInsertGeometry(this.layout, 0),
      this.selectedInsert.material.clone(),
      count,
    );
    this.arrayInsert.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.arrayInsert.frustumCulled = false;
    this.arrayInsert.visible = false;
    this.arrayInsert.name = "Album paper insert atlas";
    this.arrayInsert.userData.albumInsert = true;
    this.arrayInsert.castShadow = true;
    this.arrayInsert.receiveShadow = true;
    this.selectedInsert.material.userData.albumInsertTemplate = true;
  }

  private createArrayGeometry(rect: CaseRect) {
    const geometry = new THREE.PlaneGeometry(rect.width, rect.height).translate(
      rect.x,
      rect.y,
      rect.z,
    );
    geometry.setAttribute(
      "coverTile",
      new THREE.InstancedBufferAttribute(this.tileOffsets, 4),
    );
    return geometry;
  }

  private createSelectedGeometry(rect: CaseRect) {
    return new THREE.PlaneGeometry(rect.width, rect.height).translate(
      rect.x,
      rect.y,
      rect.z,
    );
  }

  /** Retarget the cover and insert geometry while keeping atlas textures resident. */
  setLayout(rect: CaseRect, thickness = 0) {
    if (this.disposed) return;
    const next = { ...rect };
    const nextThickness = Number.isFinite(thickness) ? Math.max(0, thickness) : 0;
    if (
      this.layout.x === next.x &&
      this.layout.y === next.y &&
      this.layout.z === next.z &&
      this.layout.width === next.width &&
      this.layout.height === next.height &&
      this.insertThickness === nextThickness
    )
      return;

    const oldArrayGeometry = this.array.geometry;
    const oldSelectedGeometry = this.selected.geometry;
    const oldArrayInsertGeometry = this.arrayInsert.geometry;
    const oldSelectedInsertGeometry = this.selectedInsert.geometry;
    this.array.geometry = this.createArrayGeometry(next);
    this.selected.geometry = this.createSelectedGeometry(next);
    this.arrayInsert.geometry = albumInsertGeometry(next, nextThickness);
    this.selectedInsert.geometry = albumInsertGeometry(next, nextThickness);
    this.layout = next;
    this.insertThickness = nextThickness;
    oldArrayGeometry.dispose();
    oldSelectedGeometry.dispose();
    oldArrayInsertGeometry.dispose();
    oldSelectedInsertGeometry.dispose();
    this.syncInsertVisibility();
  }

  setVisibility(arrayVisible: boolean, selectedVisible: boolean) {
    this.array.visible = arrayVisible;
    this.selected.visible = selectedVisible;
    this.syncInsertVisibility();
  }

  private syncInsertVisibility() {
    const hasInsert = this.insertThickness > 0;
    this.arrayInsert.visible = hasInsert && this.array.visible;
    this.selectedInsert.visible = hasInsert && this.selected.visible;
  }

  private cachedImage(url?: string) {
    if (!url || !this.decodedImages.has(url)) return undefined;
    const image = this.decodedImages.get(url);
    this.decodedImages.delete(url);
    this.decodedImages.set(url, image);
    return image;
  }

  private loadImage(url?: string) {
    if (!url) return Promise.resolve(undefined);
    if (this.decodedImages.has(url)) return Promise.resolve(this.cachedImage(url));
    let pending = this.pendingImages.get(url);
    if (!pending) {
      const generation = this.generation;
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      pending = image
        .decode()
        .then(() => {
          // Retain bounded thumbnails, not decoded multi-megapixel source art.
          const width = image.naturalWidth,
            height = image.naturalHeight;
          const scale = Math.min(1, 1024 / Math.max(width, height));
          const source = document.createElement("canvas");
          source.width = Math.max(1, Math.round(width * scale));
          source.height = Math.max(1, Math.round(height * scale));
          source
            .getContext("2d", { willReadFrequently: true })!
            .drawImage(image, 0, 0, source.width, source.height);
          image.src = "";
          return { source, width, height };
        })
        .catch(() => undefined)
        .then((decoded) => {
          if (!this.disposed && generation === this.generation) {
            this.decodedImages.set(url, decoded);
            if (this.decodedImages.size > 48)
              this.decodedImages.delete(this.decodedImages.keys().next().value!);
          }
          if (this.pendingImages.get(url) === pending) this.pendingImages.delete(url);
          return decoded;
        });
      // Share every in-flight decode across the pool; only completed images
      // enter the bounded LRU, so cycling slots cannot evict pending requests.
      this.pendingImages.set(url, pending);
    }
    return pending;
  }

  private recordKey(record: ArchiveRecord | undefined) {
    // Description/metadata refreshes replace record objects without changing
    // their print. Cache only the visual identity, not the object reference.
    let key = record ? this.recordKeys.get(record) : "";
    if (record && key === undefined) {
      key = JSON.stringify([record.id, record.album?.coverUrl, record.title]);
      this.recordKeys.set(record, key);
    }
    return key!;
  }

  private copyCover(canvas: HTMLCanvasElement, key: string) {
    const selected = this.selectedKey === key && canvas !== this.selectedCanvas;
    const slot = selected ? -1 : this.slotKeys.indexOf(key);
    if (!selected && slot < 0) return false;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Copy the whole painted tile, including its UV inset, exactly once.
    if (selected) context.drawImage(this.selectedCanvas, 0, 0, canvas.width, canvas.height);
    else context.drawImage(
      this.atlasCanvas,
      (slot % this.columns) * this.tileWidth,
      Math.floor(slot / this.columns) * this.tileHeight,
      this.tileWidth, this.tileHeight,
      0, 0, canvas.width, canvas.height,
    );
    return true;
  }

  setSlot(slot: number, record: ArchiveRecord | undefined) {
    const key = this.recordKey(record);
    if (this.slotKeys[slot] === key) return;
    const image = this.cachedImage(record?.album?.coverUrl);
    // Reuse the target album's existing print before assigning this slot's
    // identity; otherwise the lookup could copy the slot's previous album.
    if (image) paintCover(this.tileCanvas, record, image);
    else if (!this.copyCover(this.tileCanvas, key)) paintCover(this.tileCanvas, record);
    this.slotKeys[slot] = key;
    const generation = this.generation;
    const draw = (image?: CoverImage) => {
      if (this.disposed || generation !== this.generation || this.slotKeys[slot] !== key) return;
      if (image) paintCover(this.tileCanvas, record, image);
      const x = (slot % this.columns) * this.tileWidth,
        y = Math.floor(slot / this.columns) * this.tileHeight;
      const context = this.atlasCanvas.getContext("2d", { willReadFrequently: true })!;
      context.clearRect(x, y, this.tileWidth, this.tileHeight);
      context.drawImage(this.tileCanvas, x, y);
      this.dirtySlots.add(slot);
    };
    draw();
    if (!image) void this.loadImage(record?.album?.coverUrl).then((loaded) => {
      if (loaded) draw(loaded);
    });
  }

  /** Keep the 432-slot atlas resident. A changed cover must not upload the
   * whole 4096 × 6912 canvas (108 MiB) during a navigation frame. Adjacent
   * dirty tiles in each row share one rectangular GPU transfer.
   */
  flushUploads(renderer: THREE.WebGLRenderer) {
    if (!this.dirtySlots.size) return;
    if (!this.atlasUploaded) {
      renderer.initTexture(this.atlas);
      this.atlasUploaded = true;
      this.dirtySlots.clear();
      return;
    }
    const slots = [...this.dirtySlots].sort((a, b) => a - b);
    for (let i = 0; i < slots.length;) {
      const start = slots[i++];
      let end = start;
      while (i < slots.length && slots[i] === end + 1 &&
        Math.floor(slots[i] / this.columns) === Math.floor(start / this.columns)) end = slots[i++];
      const x = (start % this.columns) * this.tileWidth;
      const y = Math.floor(start / this.columns) * this.tileHeight;
      const width = (end - start + 1) * this.tileWidth;
      this.uploadCanvas.width = width;
      this.uploadCanvas.height = this.tileHeight;
      this.uploadCanvas.getContext("2d", { willReadFrequently: true })!.drawImage(this.atlasCanvas,
        x, y, width, this.tileHeight, 0, 0, width, this.tileHeight);
      renderer.copyTextureToTexture(this.uploadTexture, this.atlas, null,
        new THREE.Vector2(x, this.atlasCanvas.height - y - this.tileHeight));
    }
    this.dirtySlots.clear();
  }

  async select(record: ArchiveRecord | undefined) {
    this.selectedRecord = record;
    const key = this.recordKey(record);
    if (this.selectedKey === key) return;
    const generation = this.generation;
    const cached = this.cachedImage(record?.album?.coverUrl);
    if (cached) paintCover(this.selectedCanvas, record, cached);
    else if (!this.copyCover(this.selectedCanvas, key)) paintCover(this.selectedCanvas, record);
    this.selectedKey = key;
    this.selectedTexture.needsUpdate = true;
    if (cached) return;
    const image = await this.loadImage(record?.album?.coverUrl);
    if (
      !image ||
      this.disposed ||
      generation !== this.generation ||
      this.selectedKey !== key
    )
      return;
    paintCover(this.selectedCanvas, record, image);
    this.selectedTexture.needsUpdate = true;
  }

  snapshot(mesh: THREE.Mesh) {
    const canvas = document.createElement("canvas");
    canvas.width = this.selectedCanvas.width;
    canvas.height = this.selectedCanvas.height;
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.selectedTexture.anisotropy;
    mesh.material = this.selected.material.clone();
    mesh.material.onBeforeCompile = this.selected.material.onBeforeCompile;
    mesh.material.customProgramCacheKey = this.selected.material.customProgramCacheKey;
    (mesh.material as THREE.MeshLambertMaterial).map = texture;
    const record = this.selectedRecord;
    mesh.userData.coverDisposed = false;
    void this.loadImage(record?.album?.coverUrl).then((image) => {
      if (!image || mesh.userData.coverDisposed || this.disposed) return;
      paintCover(canvas, record, image);
      texture.needsUpdate = true;
    });
  }

  reset() {
    this.generation++;
    this.setVisibility(false, false);
    this.slotKeys.fill(undefined);
    this.selectedRecord = undefined;
    this.selectedKey = undefined;
    this.pendingImages.clear();
    this.decodedImages.clear();
  }
  dispose() {
    this.disposed = true;
    this.setVisibility(false, false);
    this.pendingImages.clear();
    this.decodedImages.clear();
    this.atlas.dispose();
    this.uploadTexture.dispose();
    this.selectedTexture.dispose();
    this.array.geometry.dispose();
    (this.array.material as THREE.Material).dispose();
    this.selected.geometry.dispose();
    this.selected.material.dispose();
    this.arrayInsert.geometry.dispose();
    this.arrayInsert.material.dispose();
    this.selectedInsert.geometry.dispose();
    this.selectedInsert.material.dispose();
  }
}
