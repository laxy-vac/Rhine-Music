import * as THREE from "three";
import type { CaseLayout } from "./case-layout";

/** One cached paper atlas follows the same matrices as the physical cases. */
export class MusicCaseTitles {
  readonly array: THREE.InstancedMesh;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas = document.createElement("canvas");
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly keys: string[] = [];
  private selectedKey = "";
  private accent = "#b56834";
  private layoutKey = "";
  private readonly columns = 8;
  private readonly rows: number;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  constructor(count: number, maxTextureSize: number) {
    this.rows = Math.max(1, Math.ceil(count / this.columns));
    this.tileWidth = Math.min(512, Math.floor(maxTextureSize / this.columns));
    this.tileHeight = Math.min(64, Math.floor(maxTextureSize / this.rows));
    this.canvas.width = this.tileWidth * this.columns; this.canvas.height = this.tileHeight * this.rows;
    this.selectedCanvas.width = this.tileWidth; this.selectedCanvas.height = this.tileHeight;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    for (const texture of [this.texture, this.selectedTexture]) {
      texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    }
    const geometry = new THREE.PlaneGeometry(1, 1);
    const offsets = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) offsets.set([i % this.columns / this.columns,
      1 - (Math.floor(i / this.columns) + 1) / this.rows, 1 / this.columns, 1 / this.rows], i * 4);
    geometry.setAttribute("titleTile", new THREE.InstancedBufferAttribute(offsets, 4));
    const material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    material.onBeforeCompile = shader => {
      shader.vertexShader = "attribute vec4 titleTile;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", "#include <uv_vertex>\nvMapUv = titleTile.xy + uv * titleTile.zw;");
    };
    material.customProgramCacheKey = () => "music-case-title-atlas-v1";
    this.array = new THREE.InstancedMesh(geometry, material, count);
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.array.frustumCulled = false;
    this.selected = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.selectedTexture, toneMapped: false }));
    this.selected.userData.musicCaseTitle = true;
    this.array.visible = this.selected.visible = false;
  }
  setLayout(layout: CaseLayout) {
    const key = JSON.stringify(layout.bounds);
    if (this.layoutKey === key) return;
    this.layoutKey = key;
    const shape = () => new THREE.PlaneGeometry(Math.max(.1, layout.width - .5), .22).rotateX(-Math.PI / 2)
      .translate(layout.center.x, layout.bounds.max[1] + .012, layout.center.z);
    for (const mesh of [this.array, this.selected]) {
      const old = mesh.geometry; const geometry = shape();
      if (mesh === this.array) geometry.setAttribute("titleTile", old.getAttribute("titleTile"));
      mesh.geometry = geometry; old.dispose();
    }
  }
  setStyle(accent: string) {
    if (this.accent === accent) return;
    this.accent = accent; this.keys.length = 0; this.selectedKey = "";
  }
  private paint(canvas: HTMLCanvasElement, title: string, x: number, y: number) {
    const ctx = canvas.getContext("2d")!;
    ctx.save(); ctx.translate(x, y); ctx.scale(this.tileWidth / 512, this.tileHeight / 64);
    ctx.fillStyle = "#e9e6dd"; ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = this.accent; ctx.fillRect(0, 0, 8, 64);
    ctx.fillStyle = "#1b1c18"; ctx.font = '500 29px "Archive Mono", "Microsoft YaHei UI", sans-serif'; ctx.textBaseline = "middle";
    let text = title;
    while (text && ctx.measureText(text + (text === title ? "" : "…")).width > 472) text = text.slice(0, -1);
    ctx.fillText(text + (text === title ? "" : "…"), 20, 33); ctx.restore();
  }
  setSlot(index: number, title: string) {
    if (this.keys[index] === title) return;
    this.keys[index] = title; this.paint(this.canvas, title, index % this.columns * this.tileWidth, Math.floor(index / this.columns) * this.tileHeight);
    this.texture.needsUpdate = true;
  }
  select(title: string) {
    if (this.selectedKey === title) return;
    this.selectedKey = title; this.paint(this.selectedCanvas, title, 0, 0); this.selectedTexture.needsUpdate = true;
  }
  snapshot(group: THREE.Group) {
    const mesh = group.children.find(child => child.userData.musicCaseTitle) as typeof this.selected | undefined;
    if (!mesh) return;
    const canvas = document.createElement("canvas"); canvas.width = this.tileWidth; canvas.height = this.tileHeight;
    canvas.getContext("2d")!.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    mesh.material = this.selected.material.clone(); mesh.material.map = texture;
  }
  dispose() {
    this.texture.dispose(); this.selectedTexture.dispose(); this.array.geometry.dispose(); this.selected.geometry.dispose();
    (this.array.material as THREE.Material).dispose(); this.selected.material.dispose();
  }
}
