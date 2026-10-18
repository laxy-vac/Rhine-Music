import * as THREE from "three";
import type { CaseLayout } from "./case-layout";
import type { CaseAppearance } from "./case-settings";
import { createPaperAtlasLayout, musicTitleTileSizeForRows, type PaperAtlasLayout } from "./paper-atlas-layout.ts";
import { punkCaseDisplayMount, type PunkCaseDisplayMount } from "./punk-case-display";

/** One cached paper atlas follows the same matrices as the physical cases. */
export class MusicCaseTitles {
  readonly array: THREE.InstancedMesh;
  readonly selected: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly atlasLayout: PaperAtlasLayout;
  private readonly canvases: HTMLCanvasElement[];
  private readonly selectedCanvas = document.createElement("canvas");
  private readonly textures: THREE.CanvasTexture[];
  private readonly selectedTexture: THREE.CanvasTexture;
  private readonly keys: string[] = [];
  private selectedKey = "";
  private accent = "#b56834";
  private layoutKey = "";
  private mount?: PunkCaseDisplayMount;
  private displayEnabled = false;
  private readonly displayPower = { value: 0 };
  private readonly displayScan = { value: 0 };
  private paintCount = 0;
  private readonly columns = 8;
  private readonly tileWidth: number;
  private readonly tileHeight: number;
  private readonly selectedTileWidth: number;
  private readonly selectedTileHeight: number;
  constructor(count: number, maxTextureSize: number) {
    this.atlasLayout = createPaperAtlasLayout(count, maxTextureSize, this.columns, musicTitleTileSizeForRows);
    this.tileWidth = this.atlasLayout.tileWidth;
    this.tileHeight = this.atlasLayout.tileHeight;
    this.selectedTileWidth = this.tileWidth;
    this.selectedTileHeight = this.tileHeight;
    this.canvases = this.atlasLayout.pages.map(page => {
      const canvas = document.createElement("canvas");
      canvas.width = page.width; canvas.height = page.height;
      return canvas;
    });
    this.textures = this.canvases.map(canvas => new THREE.CanvasTexture(canvas));
    this.selectedCanvas.width = this.selectedTileWidth; this.selectedCanvas.height = this.selectedTileHeight;
    this.selectedTexture = new THREE.CanvasTexture(this.selectedCanvas);
    for (const texture of [...this.textures, this.selectedTexture]) {
      texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    }
    const geometry = new THREE.PlaneGeometry(1, 1);
    const offsets = new Float32Array(count * 4);
    const pages = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const location = this.atlasLayout.locate(i)!;
      const page = this.atlasLayout.pages[location.page];
      const column = location.localSlot % this.columns, row = Math.floor(location.localSlot / this.columns);
      offsets.set([column / this.columns, 1 - (row + 1) / page.rows,
        1 / this.columns, 1 / page.rows], i * 4);
      pages[i] = location.page;
    }
    geometry.setAttribute("titleTile", new THREE.InstancedBufferAttribute(offsets, 4));
    if (this.atlasLayout.paged)
      geometry.setAttribute("titlePage", new THREE.InstancedBufferAttribute(pages, 1));
    const material = new THREE.MeshBasicMaterial({ map: this.textures[0], toneMapped: false });
    this.configureDisplayMaterial(material, true);
    this.array = new THREE.InstancedMesh(geometry, material, count);
    this.array.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.array.frustumCulled = false;
    this.array.castShadow = this.array.receiveShadow = false;
    this.array.userData.punkDisplay = true;
    const selectedMaterial = new THREE.MeshBasicMaterial({ map: this.selectedTexture, toneMapped: false });
    this.configureDisplayMaterial(selectedMaterial, false);
    this.selected = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), selectedMaterial);
    this.selected.castShadow = this.selected.receiveShadow = false;
    this.selected.userData.musicCaseTitle = true;
    this.selected.userData.punkDisplay = true;
    this.array.visible = this.selected.visible = false;
  }
  setLayout(layout: CaseLayout, model?: THREE.Object3D, appearance?: CaseAppearance) {
    const mount = punkCaseDisplayMount(layout, model, appearance);
    const key = JSON.stringify({
      layout: layout.bounds,
      scale: layout.sourceScale,
      model: model?.uuid,
      transforms: appearance?.transforms,
      mount,
    });
    if (this.layoutKey === key) return;
    this.layoutKey = key;
    this.mount = mount;
    const shape = () => {
      if (!mount) return new THREE.PlaneGeometry(0.001, 0.001);
      return new THREE.PlaneGeometry(mount.width, mount.depth)
        .applyMatrix4(new THREE.Matrix4().fromArray(mount.currentMatrix));
    };
    for (const mesh of [this.array, this.selected]) {
      const old = mesh.geometry; const geometry = shape();
      if (mesh === this.array) {
        geometry.setAttribute("titleTile", old.getAttribute("titleTile"));
        const page = old.getAttribute("titlePage");
        if (page) geometry.setAttribute("titlePage", page);
      }
      mesh.geometry = geometry; old.dispose();
    }
    this.updateDisplayVisibility();
  }
  setDisplay(enabled: boolean, power: number, scan: number) {
    this.displayEnabled = enabled;
    this.displayPower.value = enabled && this.mount ? clamp01(power) : 0;
    this.displayScan.value = enabled && this.mount ? clamp01(scan) : 0;
    this.updateDisplayVisibility();
  }
  get state() {
    const material = this.selected.material;
    return {
      eligible: this.displayEnabled && Boolean(this.mount),
      power: this.displayPower.value,
      scan: this.displayScan.value,
      accent: this.accent,
      title: this.selectedKey,
      arrayVisible: this.array.visible,
      selectedVisible: this.selected.visible,
      instanceCount: this.array.count,
      mount: this.mount ?? null,
      material: {
        type: material.type,
        fog: material.fog,
        toneMapped: material.toneMapped,
        depthTest: material.depthTest,
        depthWrite: material.depthWrite,
        castShadow: this.array.castShadow || this.selected.castShadow,
        receiveShadow: this.array.receiveShadow || this.selected.receiveShadow,
        pbr: material instanceof THREE.MeshStandardMaterial,
        reflection: material.envMap !== null,
        refraction: material.envMap !== null && material.envMap.mapping === THREE.CubeRefractionMapping,
        renderPass: false,
        renderTarget: false,
      },
      paintCount: this.paintCount,
    };
  }
  setStyle(accent: string) {
    if (this.accent === accent) return;
    this.accent = accent; this.keys.length = 0; this.selectedKey = "";
  }
  private paint(canvas: HTMLCanvasElement, title: string, x: number, y: number,
    tileWidth = this.tileWidth, tileHeight = this.tileHeight) {
    this.paintCount++;
    const ctx = canvas.getContext("2d")!;
    ctx.save(); ctx.translate(x, y); ctx.scale(tileWidth / 512, tileHeight / 64);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = this.accent; ctx.fillRect(0, 0, 6, 64);
    ctx.fillStyle = "#1b1c18"; ctx.font = '500 29px "Archive Mono", "Microsoft YaHei UI", sans-serif'; ctx.textBaseline = "middle";
    let text = title;
    while (text && ctx.measureText(text + (text === title ? "" : "…")).width > 472) text = text.slice(0, -1);
    ctx.fillText(text + (text === title ? "" : "…"), 20, 33); ctx.restore();
  }
  setSlot(index: number, title: string) {
    const location = this.atlasLayout.locate(index);
    if (!location) return;
    if (this.keys[index] === title) return;
    this.keys[index] = title;
    this.paint(this.canvases[location.page], title, location.localSlot % this.columns * this.tileWidth,
      Math.floor(location.localSlot / this.columns) * this.tileHeight);
    this.textures[location.page].needsUpdate = true;
  }
  select(title: string) {
    if (this.selectedKey === title) return;
    this.selectedKey = title; this.paint(this.selectedCanvas, title, 0, 0, this.selectedTileWidth, this.selectedTileHeight);
    this.selectedTexture.needsUpdate = true;
  }
  snapshot(group: THREE.Group) {
    const mesh = group.children.find(child => child.userData.musicCaseTitle) as typeof this.selected | undefined;
    if (!mesh) return;
    const canvas = document.createElement("canvas"); canvas.width = this.selectedTileWidth; canvas.height = this.selectedTileHeight;
    canvas.getContext("2d")!.drawImage(this.selectedCanvas, 0, 0);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    mesh.material = this.selected.material.clone(); mesh.material.map = texture;
    this.configureDisplayMaterial(mesh.material, false);
  }
  dispose() {
    for (const texture of this.textures) texture.dispose();
    this.selectedTexture.dispose(); this.array.geometry.dispose(); this.selected.geometry.dispose();
    (this.array.material as THREE.Material).dispose(); this.selected.material.dispose();
  }
  private configureDisplayMaterial(material: THREE.MeshBasicMaterial, instanced: boolean) {
    material.fog = false;
    material.toneMapped = false;
    material.depthTest = true;
    material.depthWrite = true;
    material.envMap = null;
    material.onBeforeCompile = shader => {
      shader.vertexShader = "varying vec2 vTitleUv;\n" +
        (instanced ? "attribute vec4 titleTile;\n" : "") + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <uv_vertex>", instanced
        ? "#include <uv_vertex>\nvTitleUv = uv;\nvMapUv = titleTile.xy + uv * titleTile.zw;"
        : "#include <uv_vertex>\nvTitleUv = uv;");
      if (instanced && this.atlasLayout.paged) {
        shader.vertexShader = "attribute float titlePage;\nvarying float vTitlePage;\n" + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace("vMapUv = titleTile.xy + uv * titleTile.zw;",
          "vMapUv = titleTile.xy + uv * titleTile.zw;\nvTitlePage = titlePage;");
        shader.uniforms.uTitlePage1Map = { value: this.textures[1] };
      }
      shader.uniforms.uPunkDisplayPower = this.displayPower;
      shader.uniforms.uPunkDisplayScan = this.displayScan;
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
        "#include <common>\nuniform float uPunkDisplayPower;\nuniform float uPunkDisplayScan;\nvarying vec2 vTitleUv;" +
        (instanced && this.atlasLayout.paged ? "\nuniform sampler2D uTitlePage1Map;\nvarying float vTitlePage;" : ""));
      const mapSample = instanced && this.atlasLayout.paged
        ? `
          #ifdef USE_MAP
            vec4 sampledDiffuseColor;
            if ( vTitlePage < 0.5 ) sampledDiffuseColor = texture2D( map, vMapUv );
            else sampledDiffuseColor = texture2D( uTitlePage1Map, vMapUv );
            #ifdef DECODE_VIDEO_TEXTURE
              sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
            #endif
            diffuseColor *= sampledDiffuseColor;
          #endif
        `
        : "#include <map_fragment>";
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>",
        `${mapSample}\nif ( uPunkDisplayPower <= 0.0001 ) discard;\n` +
        "float titleRevealed = step(vTitleUv.x, uPunkDisplayScan);\n" +
        "float titleAccent = 1.0 - step(0.018, vTitleUv.x);\n" +
        "diffuseColor.rgb = mix(vec3(1.0), diffuseColor.rgb, max(titleRevealed, titleAccent));");
    };
    material.customProgramCacheKey = () =>
      `music-case-title-display-v3-${Number(instanced)}-${Number(instanced && this.atlasLayout.paged)}`;
  }
  private updateDisplayVisibility() {
    const visible = this.displayEnabled && Boolean(this.mount) && this.displayPower.value > 0.0001;
    this.array.visible = visible;
    this.selected.visible = visible;
  }
}

function clamp01(value: number) {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;
}
