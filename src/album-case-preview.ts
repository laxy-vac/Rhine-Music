import * as THREE from "three";
import { rhineSourceBadge } from "./archive-label";
import type { ArchiveRecord } from "./data";
import { createAlbumInsert, albumInsertGeometry } from "./album-insert";
import { createCaseIllumination } from "./case-illumination";
import { getCaseLayout, type CaseRect } from "./case-layout";
import { setCaseAlbumOcclusion } from "./case-materials";
import { createCaseModel, applyCaseAppearance, disposeCaseModel } from "./case-model.ts";
import { createCaseStudioLighting } from "./case-studio-lighting";
import { normalizeCaseSettings, type CaseSettings, type CaseStructure } from "./case-settings.ts";
import { trUi } from "./i18n";
import { createAlbumPrintMaterial } from "./music-model.ts";
import { CaseAlbumInfo } from "./rhine-album-info";
import { renderDimensions } from "./render-quality";
import type { RenderQuality } from "./render-quality.ts";

export type AlbumCasePreviewOptions = {
  getSettings: () => CaseSettings;
  getQuality: () => RenderQuality;
  getTheme: () => "day" | "night";
  getDesign: () => "rhine" | "archive";
  getAlbum: () => {
    coverUrl?: string;
    title?: string;
    record?: ArchiveRecord;
    index?: number;
    reduced?: boolean;
  };
};

export type AlbumCasePreviewHandle = {
  refresh(): void;
  setVisible(visible: boolean): void;
  destroy(): void;
};

type PreviewSnapshot = {
  settings: CaseSettings;
  quality: RenderQuality;
  theme: "day" | "night";
  design: "rhine" | "archive";
  structure: CaseStructure;
  detail: "low" | "medium" | "high";
  album: ReturnType<AlbumCasePreviewOptions["getAlbum"]>;
  signature: string;
  modelKey: string;
  appearanceKey: string;
  qualityKey: string;
  coverKey: string;
  albumInfoKey: string;
};

const FIT_MARGIN = 0.82;
const FRONT_DIRECTION = new THREE.Vector3(0.12, 0.075, 1).normalize();

function rectBounds(rect: CaseRect, depth = 0.001): THREE.Box3 {
  return new THREE.Box3(
    new THREE.Vector3(rect.x - rect.width / 2, rect.y - rect.height / 2, rect.z - depth),
    new THREE.Vector3(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.z + depth),
  );
}

function coverKeyFor(album: PreviewSnapshot["album"], theme: "day" | "night"): string {
  const url = album.coverUrl?.trim() ?? "";
  return url ? `url:${url}` : `placeholder:${theme}:${album.title?.trim() ?? ""}`;
}

function albumInfoKeyFor(album: PreviewSnapshot["album"]): string {
  return JSON.stringify([
    album.record?.id ?? null,
    typeof album.index === "number" && Number.isFinite(album.index) ? album.index : null,
    rhineSourceBadge(album.record?.album),
  ]);
}

export function setupAlbumCasePreview(
  host: HTMLElement,
  options: AlbumCasePreviewOptions,
): AlbumCasePreviewHandle {
  let destroyed = false;
  let visible = false;
  let snapshot: PreviewSnapshot | undefined;
  let appliedSignature = "";
  let cachedSettingsInput = "";
  let cachedSettingsDesign: "rhine" | "archive" | undefined;
  let cachedSettings: CaseSettings | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene | undefined;
  let camera: THREE.PerspectiveCamera | undefined;
  let studio: ReturnType<typeof createCaseStudioLighting> | undefined;
  let illumination: ReturnType<typeof createCaseIllumination> | undefined;
  let model: THREE.Group | undefined;
  let modelKey = "";
  let pendingModelKey = "";
  let modelRevision = 0;
  let albumInfo: CaseAlbumInfo | undefined;
  let albumInfoStructure: CaseStructure | undefined;
  let albumInfoAnisotropy = 0;
  let appearanceKey = "";
  let coverGeometry: THREE.PlaneGeometry | undefined;
  let coverMaterial: THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | undefined;
  let coverMesh: THREE.Mesh | undefined;
  let coverLayoutKey = "";
  let insertMesh: ReturnType<typeof createAlbumInsert> | undefined;
  let insertKey = "";
  let currentCoverKey = "";
  let coverRevision = 0;
  let readonlyCanvas: HTMLCanvasElement | undefined;
  let contextLost = false;
  let resizeObserver: ResizeObserver | undefined;
  let windowResizeHandler: (() => void) | undefined;
  let documentVisibilityHandler: (() => void) | undefined;
  let contextLostHandler: ((event: Event) => void) | undefined;
  let contextRestoredHandler: (() => void) | undefined;
  const ownedTextures = new Set<THREE.Texture>();

  function setPreviewState(state: "loading" | "ready" | "error", structure: CaseStructure) {
    const changed = host.dataset.casePreviewState !== state || host.dataset.caseStructure !== structure;
    host.dataset.casePreviewState = state;
    host.dataset.caseStructure = structure;
    if (changed) host.dispatchEvent(new CustomEvent("case-preview-state", { detail: { state, structure } }));
  }

  function readSnapshot(): PreviewSnapshot {
    const design = options.getDesign();
    const rawSettings = options.getSettings();
    const rawSettingsKey = JSON.stringify(rawSettings);
    if (!cachedSettings || cachedSettingsInput !== rawSettingsKey || cachedSettingsDesign !== design) {
      cachedSettings = normalizeCaseSettings(rawSettings, design);
      cachedSettingsInput = rawSettingsKey;
      cachedSettingsDesign = design;
    }
    const settings = cachedSettings;
    const structure = settings.structure;
    const quality = { ...options.getQuality() };
    const theme = options.getTheme();
    const album = { ...options.getAlbum() };
    const detail = structure === "minimal" ? "low" : quality.modelDetail;
    const qualityKey = JSON.stringify(quality);
    const appearanceKey = JSON.stringify([
      settings.appearances[structure],
      theme,
      quality.lighting,
      quality.transmission,
    ]);
    const coverKey = coverKeyFor(album, theme);
    const albumInfoKey = albumInfoKeyFor(album);
    const settingsKey = JSON.stringify(settings);
    const signature = JSON.stringify([
      design,
      theme,
      settingsKey,
      qualityKey,
      coverKey,
      albumInfoKey,
      album.reduced === true,
    ]);
    return {
      settings,
      quality,
      theme,
      design,
      structure,
      detail,
      album,
      signature,
      modelKey: `${structure}:${detail}`,
      appearanceKey,
      qualityKey,
      coverKey,
      albumInfoKey,
    };
  }

  function canRender(): boolean {
    return !destroyed && visible && document.visibilityState !== "hidden" && host.isConnected;
  }

  function render(): void {
    if (!canRender() || contextLost || !renderer || !scene || !camera || host.dataset.casePreviewState !== "ready") return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width <= 0 || height <= 0) return;
    renderer.render(scene, camera);
  }

  function applyThemeAndQuality(next: PreviewSnapshot): void {
    if (!renderer || !studio) return;
    studio.setTheme(next.theme);
    studio.setQuality(next.quality);
    renderer.transmissionResolutionScale = next.quality.transmission;
    const coverTexture = coverMaterial?.map;
    if (coverTexture) {
      const anisotropy = Math.max(1, Math.min(next.quality.anisotropy, renderer.capabilities.getMaxAnisotropy()));
      if (coverTexture.anisotropy !== anisotropy) {
        coverTexture.anisotropy = anisotropy;
        coverTexture.needsUpdate = true;
      }
    }
    if (scene) scene.background = null;
  }

  function createRenderer(next: PreviewSnapshot): boolean {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: next.quality.antialias !== "off",
        premultipliedAlpha: false,
      });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = next.theme === "night" ? 1.08 : 1.05;
      renderer.setClearColor(0x000000, 0);
      readonlyCanvas = renderer.domElement;
      readonlyCanvas.style.display = "block";
      readonlyCanvas.style.width = "100%";
      readonlyCanvas.style.height = "100%";
      readonlyCanvas.style.pointerEvents = "none";
      readonlyCanvas.style.backgroundColor = "transparent";
      readonlyCanvas.setAttribute("aria-hidden", "true");
      readonlyCanvas.tabIndex = -1;
      readonlyCanvas.hidden = true;
      host.append(readonlyCanvas);
      contextLost = false;

      scene ??= new THREE.Scene();
      scene.background = null;
      camera ??= new THREE.PerspectiveCamera(28, 1, 0.01, 100);
      illumination ??= createCaseIllumination(scene);
      studio = createCaseStudioLighting(renderer, scene);
      studio.setTheme(next.theme);
      studio.setQuality(next.quality);
      renderer.transmissionResolutionScale = next.quality.transmission;
      if (!coverMesh) {
        const cover = getCaseLayout().cover;
        coverGeometry = new THREE.PlaneGeometry(cover.width, cover.height);
        coverLayoutKey = `${cover.width}:${cover.height}`;
        coverMaterial = createAlbumPrintMaterial(null);
        coverMesh = new THREE.Mesh(coverGeometry, coverMaterial);
        coverMesh.name = "IndependentAlbumCover";
        coverMesh.position.set(cover.x, cover.y, cover.z);
        coverMesh.renderOrder = 2;
        coverMesh.visible = false;
        scene.add(coverMesh);
      }
      contextLostHandler = (event) => {
        event.preventDefault();
        contextLost = true;
        readonlyCanvas!.hidden = true;
        if (snapshot) setPreviewState("error", snapshot.structure);
      };
      contextRestoredHandler = () => {
        contextLost = false;
        appliedSignature = "";
        if (canRender()) refresh();
      };
      readonlyCanvas.addEventListener("webglcontextlost", contextLostHandler);
      readonlyCanvas.addEventListener("webglcontextrestored", contextRestoredHandler);
      return true;
    } catch {
      disposeRenderer();
      setPreviewState("error", next.structure);
      return false;
    }
  }

  function disposeRenderer(): void {
    if (readonlyCanvas && contextLostHandler) readonlyCanvas.removeEventListener("webglcontextlost", contextLostHandler);
    if (readonlyCanvas && contextRestoredHandler) readonlyCanvas.removeEventListener("webglcontextrestored", contextRestoredHandler);
    contextLostHandler = undefined;
    contextRestoredHandler = undefined;
    studio?.dispose();
    studio = undefined;
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      renderer = undefined;
    }
    readonlyCanvas = undefined;
  }

  function resizePreview(force = false): void {
    if (!canRender() || !renderer || !camera || !snapshot) return;
    const width = Math.floor(host.clientWidth);
    const height = Math.floor(host.clientHeight);
    if (width <= 0 || height <= 0) return;
    const dimensions = renderDimensions(
      snapshot.quality,
      width,
      height,
      1,
      window.devicePixelRatio || 1,
      renderer.capabilities.maxTextureSize,
    );
    renderer.setPixelRatio(dimensions.ratio);
    renderer.setSize(width, height, false);
    renderer.transmissionResolutionScale = snapshot.quality.transmission;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (model) fitCamera();
    if (force) studio?.setQuality(snapshot.quality);
    render();
  }

  function startObservers(): void {
    if (!canRender()) return;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver ??= new ResizeObserver(() => resizePreview());
      resizeObserver.observe(host);
    } else if (!windowResizeHandler) {
      windowResizeHandler = () => resizePreview();
      window.addEventListener("resize", windowResizeHandler);
    }
  }

  function stopObservers(): void {
    resizeObserver?.disconnect();
    if (windowResizeHandler) {
      window.removeEventListener("resize", windowResizeHandler);
      windowResizeHandler = undefined;
    }
  }

  function makePlaceholderTexture(title: string, theme: "day" | "night"): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d");
    if (context) {
      const night = theme === "night";
      context.fillStyle = night ? "#182536" : "#e7e1d8";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = night ? "#53667b" : "#b4a18c";
      context.lineWidth = 2;
      context.strokeRect(28, 28, 456, 456);
      context.fillStyle = night ? "#d9e3ee" : "#4a4741";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "500 17px sans-serif";
      context.fillText(trUi("暂无封面"), 256, 226, 400);
      context.fillStyle = night ? "#a6b7ca" : "#756f65";
      context.font = "400 22px sans-serif";
      context.fillText(title.trim().slice(0, 28) || trUi("唱片盒体预览"), 256, 276, 400);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  function setCoverTexture(texture: THREE.Texture): void {
    if (!coverMaterial || coverMaterial.map === texture) return;
    const previous = coverMaterial.map;
    coverMaterial.map = texture;
    coverMaterial.needsUpdate = true;
    ownedTextures.add(texture);
    if (previous && ownedTextures.delete(previous)) previous.dispose();
    render();
  }

  function setCover(next: PreviewSnapshot): void {
    if (!coverMaterial || next.coverKey === currentCoverKey) return;
    currentCoverKey = next.coverKey;
    const revision = ++coverRevision;
    const url = next.album.coverUrl?.trim() ?? "";
    const title = next.album.title?.trim() ?? "";

    // Replace the previous print before starting the next image request.
    setCoverTexture(makePlaceholderTexture(title, next.theme));
    if (!url) return;

    let texture: THREE.Texture | undefined;
    try {
      texture = new THREE.TextureLoader().load(
        url,
        (loaded) => {
          if (destroyed || revision !== coverRevision || currentCoverKey !== next.coverKey) {
            loaded.dispose();
            return;
          }
          loaded.colorSpace = THREE.SRGBColorSpace;
          loaded.anisotropy = renderer
            ? Math.max(1, Math.min(next.quality.anisotropy, renderer.capabilities.getMaxAnisotropy()))
            : 1;
          loaded.needsUpdate = true;
          setCoverTexture(loaded);
        },
        undefined,
        () => {
          texture?.dispose();
          if (destroyed || revision !== coverRevision || currentCoverKey !== next.coverKey) return;
        },
      );
      texture.colorSpace = THREE.SRGBColorSpace;
    } catch {
      texture?.dispose();
    }
  }

  function updateCoverLayout(): void {
    if (!model || !coverMesh || !coverMaterial || !scene) return;
    const layout = getCaseLayout(model);
    const cover = layout.cover;
    const geometryKey = `${cover.width}:${cover.height}`;
    if (coverLayoutKey !== geometryKey) {
      const previous = coverMesh.geometry;
      const nextGeometry = new THREE.PlaneGeometry(cover.width, cover.height);
      coverMesh.geometry = nextGeometry;
      coverGeometry = nextGeometry;
      coverLayoutKey = geometryKey;
      previous.dispose();
    }
    coverMesh.position.set(cover.x, cover.y, cover.z);
    const thickness = layout.insertThickness ?? 0;
    const physical = thickness > 0;
    if (!(coverMaterial instanceof THREE.MeshLambertMaterial)) {
      const previous = coverMaterial;
      coverMaterial = createAlbumPrintMaterial(previous.map);
      coverMesh.material = coverMaterial;
      previous.dispose();
    }
    // Minimal is a front-surface print; the other structures put the same
    // matte print on a physical insert. Both must occlude later glass draws.
    coverMaterial.depthWrite = true;
    coverMesh.renderOrder = physical ? 0 : 2;
    coverMesh.receiveShadow = true;
    coverMesh.visible = visible;
    if (physical) {
      const nextKey = JSON.stringify([cover, thickness]);
      if (!insertMesh) {
        insertMesh = createAlbumInsert(cover, thickness);
        scene.add(insertMesh);
      } else if (insertKey !== nextKey) {
        const previous = insertMesh.geometry;
        insertMesh.geometry = albumInsertGeometry(cover, thickness);
        previous.dispose();
      }
      insertKey = nextKey;
      insertMesh.visible = visible;
    } else if (insertMesh) {
      insertMesh.visible = false;
    }
    setCaseAlbumOcclusion(model, physical && coverMesh.visible && insertMesh?.visible === true);
  }

  function disposeAlbumInfo(): void {
    if (!albumInfo) return;
    scene?.remove(albumInfo.selectedLabel, albumInfo.selectedBadge);
    albumInfo.dispose();
    albumInfo = undefined;
    albumInfoStructure = undefined;
    albumInfoAnisotropy = 0;
  }

  function syncAlbumInfo(next: PreviewSnapshot): void {
    if (!model || !scene || !renderer || next.structure === "minimal") {
      disposeAlbumInfo();
      return;
    }
    const anisotropy = Math.max(1, Math.min(next.quality.anisotropy, renderer.capabilities.getMaxAnisotropy()));
    if (!albumInfo || albumInfoStructure !== next.structure || albumInfoAnisotropy !== anisotropy) {
      disposeAlbumInfo();
      const info = albumInfo = new CaseAlbumInfo(
        0,
        getCaseLayout(model),
        renderer.capabilities.maxTextureSize,
        anisotropy,
        next.structure,
      );
      albumInfoStructure = next.structure;
      albumInfoAnisotropy = anisotropy;
      scene.add(info.selectedLabel, info.selectedBadge);
      void info.ready.then(() => {
        if (!destroyed && albumInfo === info) render();
      });
    }
    albumInfo.setLayout(getCaseLayout(model));
    albumInfo.select(next.album.record, next.album.index);
    if (next.structure === "punk") albumInfo.applyAppearance(next.settings.appearances.punk, model);
    albumInfo.setVisibility(visible);
    albumInfo.setMotion(undefined, next.album.reduced === true);
  }

  function fitCamera(): void {
    if (!camera || !model || !scene) return;
    model.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(model);
    const layout = getCaseLayout(model);
    bounds.union(new THREE.Box3(
      new THREE.Vector3(...layout.bounds.min),
      new THREE.Vector3(...layout.bounds.max),
    ));
    bounds.union(rectBounds(layout.cover, Math.max(0.001, (layout.insertThickness ?? 0) / 2)));
    bounds.union(rectBounds(layout.label, 0.002));
    for (const object of [coverMesh, insertMesh, albumInfo?.selectedLabel, albumInfo?.selectedBadge]) {
      if (!object || !object.visible) continue;
      object.updateWorldMatrix(true, false);
      bounds.union(new THREE.Box3().setFromObject(object));
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(FRONT_DIRECTION, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, FRONT_DIRECTION).normalize();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const tanVertical = Math.tan(fov / 2) * FIT_MARGIN;
    const tanHorizontal = tanVertical * Math.max(0.01, camera.aspect);
    const corners = [
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
      new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
    ];
    let distance = 0;
    for (const corner of corners) {
      const relative = corner.sub(center);
      const towardCamera = relative.dot(FRONT_DIRECTION);
      distance = Math.max(
        distance,
        Math.abs(relative.dot(right)) / tanHorizontal + towardCamera,
        Math.abs(relative.dot(up)) / tanVertical + towardCamera,
      );
    }
    distance += Math.max(0.06, size.length() * 0.055);
    camera.near = Math.max(0.01, distance / 1000);
    camera.far = Math.max(80, distance + size.length() * 4);
    camera.position.copy(center).addScaledVector(FRONT_DIRECTION, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  function presentModel(next: PreviewSnapshot, forceAppearance: boolean): void {
    if (!model || !scene || !camera || !renderer) return;
    if (forceAppearance || appearanceKey !== next.appearanceKey) {
      applyCaseAppearance(model, next.settings.appearances[next.structure], {
        lighting: next.theme === "night" ? "refined" : "baseline",
        transmission: next.quality.transmission,
      });
      appearanceKey = next.appearanceKey;
    }
    updateCoverLayout();
    syncAlbumInfo(next);
    illumination?.apply(next.settings.appearances[next.structure], next.quality);
    illumination?.update(model);
    fitCamera();
    if (canRender() && !contextLost && readonlyCanvas) {
      readonlyCanvas.hidden = false;
      setPreviewState("ready", next.structure);
      resizePreview();
    }
  }

  function beginModelLoad(next: PreviewSnapshot): void {
    if (pendingModelKey === next.modelKey) return;
    pendingModelKey = next.modelKey;
    const revision = ++modelRevision;
    if (model) model.visible = false;
    if (coverMesh) coverMesh.visible = false;
    if (insertMesh) insertMesh.visible = false;
    albumInfo?.setVisibility(false);
    if (readonlyCanvas) readonlyCanvas.hidden = true;
    setPreviewState("loading", next.structure);
    void createCaseModel(next.structure, next.detail).then((nextModel) => {
      if (destroyed || revision !== modelRevision) {
        disposeCaseModel(nextModel);
        return;
      }
      pendingModelKey = "";
      disposeAlbumInfo();
      if (model) {
        scene?.remove(model);
        disposeCaseModel(model);
      }
      model = nextModel;
      modelKey = next.modelKey;
      model.visible = true;
      scene?.add(model);
      appearanceKey = "";
      const latest = snapshot;
      if (!latest || latest.modelKey !== modelKey) return;
      presentModel(latest, true);
    }).catch(() => {
      if (destroyed || revision !== modelRevision) return;
      pendingModelKey = "";
      if (model) model.visible = false;
      if (coverMesh) coverMesh.visible = false;
      if (insertMesh) insertMesh.visible = false;
      albumInfo?.setVisibility(false);
      if (readonlyCanvas) readonlyCanvas.hidden = true;
      appliedSignature = snapshot?.signature ?? next.signature;
      setPreviewState("error", next.structure);
    });
  }

  function applySnapshot(next: PreviewSnapshot, previous?: PreviewSnapshot): void {
    host.dataset.caseStructure = next.structure;
    if (!createRenderer(next)) return;

    const antialiasChanged = !!previous && (previous.quality.antialias !== next.quality.antialias);
    if (antialiasChanged && renderer) {
      const wasReady = model && modelKey === next.modelKey;
      disposeRenderer();
      if (!createRenderer(next)) return;
      if (wasReady && readonlyCanvas) readonlyCanvas.hidden = false;
    }

    applyThemeAndQuality(next);
    setCover(next);
    const qualityChanged = previous?.qualityKey !== next.qualityKey;
    if (qualityChanged) {
      studio?.setQuality(next.quality);
      if (model) illumination?.apply(next.settings.appearances[next.structure], next.quality);
    }

    if (!model || modelKey !== next.modelKey) {
      beginModelLoad(next);
      return;
    }
    if (previous?.albumInfoKey !== next.albumInfoKey || previous?.album.reduced !== next.album.reduced) {
      syncAlbumInfo(next);
    }
    presentModel(next, previous?.appearanceKey !== next.appearanceKey || qualityChanged);
    resizePreview(qualityChanged);
  }

  function refresh(): void {
    if (destroyed) return;
    let next: PreviewSnapshot;
    try {
      next = readSnapshot();
    } catch {
      const structure = snapshot?.structure ?? "minimal";
      appliedSignature = "";
      setPreviewState("error", structure);
      return;
    }
    const previous = snapshot;
    snapshot = next;
    host.dataset.caseStructure = next.structure;
    if (!canRender()) return;
    if (appliedSignature === next.signature &&
      (host.dataset.casePreviewState === "error" ||
        (host.dataset.casePreviewState === "loading" && pendingModelKey === next.modelKey))) return;
    if (appliedSignature === next.signature && renderer && modelKey === next.modelKey && host.dataset.casePreviewState === "ready") return;
    try {
      applySnapshot(next, previous);
      appliedSignature = next.signature;
    } catch {
      if (readonlyCanvas) readonlyCanvas.hidden = true;
      appliedSignature = next.signature;
      setPreviewState("error", next.structure);
    }
  }

  function onDocumentVisibilityChange(): void {
    if (!visible || destroyed) return;
    if (document.visibilityState === "hidden") {
      stopObservers();
      return;
    }
    appliedSignature = "";
    startObservers();
    refresh();
  }

  host.dataset.casePreviewState = "loading";
  try {
    const initial = readSnapshot();
    snapshot = initial;
    setPreviewState("loading", initial.structure);
  } catch {
    host.dataset.caseStructure = "minimal";
    setPreviewState("error", "minimal");
  }

  return {
    refresh,
    setVisible(nextVisible: boolean): void {
      if (destroyed || visible === nextVisible) return;
      visible = nextVisible;
      if (!visible) {
        stopObservers();
        if (readonlyCanvas) readonlyCanvas.hidden = true;
        albumInfo?.setVisibility(false);
        return;
      }
      appliedSignature = "";
      if (!documentVisibilityHandler) {
        documentVisibilityHandler = onDocumentVisibilityChange;
        document.addEventListener("visibilitychange", documentVisibilityHandler);
      }
      startObservers();
      refresh();
      resizePreview(true);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      visible = false;
      modelRevision++;
      coverRevision++;
      stopObservers();
      if (documentVisibilityHandler) document.removeEventListener("visibilitychange", documentVisibilityHandler);
      documentVisibilityHandler = undefined;
      disposeAlbumInfo();
      if (model) {
        scene?.remove(model);
        disposeCaseModel(model);
        model = undefined;
      }
      if (coverMesh) scene?.remove(coverMesh);
      if (insertMesh) {
        scene?.remove(insertMesh);
        insertMesh.geometry.dispose();
        insertMesh.material.dispose();
        insertMesh = undefined;
      }
      coverGeometry?.dispose();
      coverGeometry = undefined;
      coverMaterial?.dispose();
      coverMaterial = undefined;
      for (const texture of ownedTextures) texture.dispose();
      ownedTextures.clear();
      illumination?.dispose();
      illumination = undefined;
      disposeRenderer();
      camera = undefined;
      scene = undefined;
    },
  };
}
