import * as THREE from "three";
import { createCaseStudioLighting } from "./case-studio-lighting";
import { createAlbumInsert } from "./album-insert";
import { createAlbumPrintMaterial } from "./music-model";
import { setCaseAlbumOcclusion, setCaseGlassFrost } from "./case-materials";
import { getCaseLayout, type CaseRect } from "./case-layout.ts";
import {
  applyCaseAppearance,
  createCaseModel,
  disposeCaseModel,
} from "./case-model";
import type { CaseAppearance, CaseSettings } from "./case-settings";
import type { RenderQuality } from "./render-quality";
import { createCaseIllumination } from "./case-illumination";

type Point = [number, number];
type Quad = [Point, Point, Point, Point];
type ProjectionAxes = { x: Point; y: Point; z: Point };

export interface CaseSpriteTemplate {
  axes: ProjectionAxes;
  array: { origin: Point };
  array_res: [number, number];
  array_ppu: number;
  inspect_res: [number, number];
  inspect_ppu: number;
}

export interface EditableCaseSprites {
  arrayPaper?: HTMLCanvasElement;
  inspectPaper?: HTMLCanvasElement[];
  arrayClear: HTMLCanvasElement;
  arrayFrost: HTMLCanvasElement;
  inspect: HTMLCanvasElement[];
  array: { cover: Quad; label: Quad; body: Quad; origin: Point; center: Point };
  inspectFrames: Array<{
    cover: Quad;
    label: Quad;
    body: Quad;
    origin: Point;
    center: Point;
    axes: ProjectionAxes;
  }>;
  inspect_ppu: number;
}

type CaseSpriteQuality = RenderQuality & {
  modelDetail?: "low" | "medium" | "high";
  lighting?: string;
};

const CACHE_LIMIT = 3;
const spriteCache = new Map<string, Promise<EditableCaseSprites>>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function appearanceCopy(value: CaseAppearance): CaseAppearance {
  return structuredClone(value);
}

function makeRenderer(width: number, height: number, quality: CaseSpriteQuality) {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: quality.antialias === "smaa",
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.transmissionResolutionScale = clamp(quality.transmission, 0.25, 1);
  renderer.shadowMap.enabled = quality.shadows > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

function cameraBasis(axes: ProjectionAxes, ppu: number) {
  // Source sprite metadata uses Blender Z-up; editable models use Three Y-up.
  const right = new THREE.Vector3(axes.x[0], axes.z[0], -axes.y[0]).multiplyScalar(1 / ppu).normalize();
  const up = new THREE.Vector3(-axes.x[1], -axes.z[1], axes.y[1]).multiplyScalar(1 / ppu);
  up.addScaledVector(right, -up.dot(right)).normalize();
  const forward = new THREE.Vector3().crossVectors(right, up).normalize();
  return { right, up, forward };
}

function basisQuaternion(right: THREE.Vector3, up: THREE.Vector3, forward: THREE.Vector3) {
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, forward),
  );
}

function cameraFor(
  width: number,
  height: number,
  ppu: number,
  basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 },
  target: THREE.Vector3,
) {
  const camera = new THREE.OrthographicCamera(
    -width / (2 * ppu),
    width / (2 * ppu),
    height / (2 * ppu),
    -height / (2 * ppu),
    0.01,
    100,
  );
  camera.position.copy(target).addScaledVector(basis.forward, 20);
  camera.quaternion.copy(basisQuaternion(basis.right, basis.up, basis.forward));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function projectPoint(point: THREE.Vector3, camera: THREE.Camera, width: number, height: number): Point {
  const ndc = point.clone().project(camera);
  return [(ndc.x + 1) * width / 2, (1 - ndc.y) * height / 2];
}

function projectedAxes(basis: { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 }, ppu: number): ProjectionAxes {
  const axis = (vector: THREE.Vector3): Point => [vector.dot(basis.right) * ppu, -vector.dot(basis.up) * ppu];
  return {
    x: axis(new THREE.Vector3(1, 0, 0)),
    y: axis(new THREE.Vector3(0, 0, -1)),
    z: axis(new THREE.Vector3(0, 1, 0)),
  };
}

function coverCorners(cover: CaseRect): THREE.Vector3[] {
  const left = cover.x - cover.width / 2;
  const right = cover.x + cover.width / 2;
  const top = cover.y + cover.height / 2;
  const bottom = cover.y - cover.height / 2;
  return [
    new THREE.Vector3(left, top, cover.z),
    new THREE.Vector3(right, top, cover.z),
    new THREE.Vector3(right, bottom, cover.z),
    new THREE.Vector3(left, bottom, cover.z),
  ];
}

function labelCorners(label: CaseRect): THREE.Vector3[] {
  const left = label.x - label.width / 2;
  const right = label.x + label.width / 2;
  const top = label.y + label.height / 2;
  const bottom = label.y - label.height / 2;
  const z = label.z;
  return [
    new THREE.Vector3(left, top, z),
    new THREE.Vector3(right, top, z),
    new THREE.Vector3(right, bottom, z),
    new THREE.Vector3(left, bottom, z),
  ];
}

function labelPartPivot(root: THREE.Object3D, fallback: THREE.Vector3) {
  let pivot: THREE.Vector3 | undefined;
  root.traverse((object) => {
    if (pivot || !(object instanceof THREE.Mesh) || object.userData.casePart !== "label")
      return;
    const value = object.geometry.userData.casePartPivot;
    if (Array.isArray(value) && value.length === 3)
      pivot = new THREE.Vector3(value[0], value[1], value[2]);
  });
  return pivot ?? fallback;
}

function transformedLabelCorners(
  label: CaseRect,
  root: THREE.Object3D,
  appearance: CaseAppearance,
): THREE.Vector3[] {
  const corners = labelCorners(label);
  const transform = appearance.transforms?.label;
  if (!transform) return corners;
  if (!transform.visible) {
    const epsilon = 0.0001;
    return [
      new THREE.Vector3(label.x - epsilon, label.y + epsilon, label.z),
      new THREE.Vector3(label.x + epsilon, label.y + epsilon, label.z),
      new THREE.Vector3(label.x + epsilon, label.y - epsilon, label.z),
      new THREE.Vector3(label.x - epsilon, label.y - epsilon, label.z),
    ];
  }

  const pivot = labelPartPivot(
    root,
    new THREE.Vector3(label.x, label.y, label.z),
  );
  const rotation = transform.rotation.map(THREE.MathUtils.degToRad) as [
    number,
    number,
    number,
  ];
  const matrix = new THREE.Matrix4().makeTranslation(
    -pivot.x,
    -pivot.y,
    -pivot.z,
  );
  matrix.premultiply(
    new THREE.Matrix4().compose(
      new THREE.Vector3(),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(...transform.scale),
    ),
  );
  matrix.premultiply(
    new THREE.Matrix4().makeTranslation(
      pivot.x + transform.offset[0],
      pivot.y + transform.offset[1],
      pivot.z + transform.offset[2],
    ),
  );
  return corners.map((point) => point.applyMatrix4(matrix));
}

function bodyCorners(bounds: THREE.Box3): THREE.Vector3[] {
  const { min, max } = bounds;
  const corners: THREE.Vector3[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z));
  return corners;
}

function projectBodyBounds(
  bounds: THREE.Box3,
  camera: THREE.Camera,
  width: number,
  height: number,
): Quad {
  const projected = bodyCorners(bounds).map((point) =>
    projectPoint(point, camera, width, height),
  );
  const minX = Math.min(...projected.map(([x]) => x));
  const maxX = Math.max(...projected.map(([x]) => x));
  const minY = Math.min(...projected.map(([, y]) => y));
  const maxY = Math.max(...projected.map(([, y]) => y));
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

function coverTransmissionAlpha(root: THREE.Object3D, transmissionBlend: number) {
  let visibleCover = false;
  const transmissions: number[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "cover" || !object.visible)
      return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const visibleMaterials = materials.filter((material) => material.visible);
    if (visibleMaterials.length === 0) return;
    visibleCover = true;
    for (const material of visibleMaterials)
      transmissions.push(
        material instanceof THREE.MeshPhysicalMaterial
          ? THREE.MathUtils.clamp(material.transmission, 0, 1)
          : 0,
      );
  });
  if (!visibleCover) return 0;
  const transmission = transmissions.length
    ? transmissions.reduce((sum, value) => sum + value, 0) / transmissions.length
    : 0;
  return 1 - transmission * transmissionBlend;
}

function projectQuad(points: THREE.Vector3[], camera: THREE.Camera, width: number, height: number): Quad {
  return points.map((point) => projectPoint(point, camera, width, height)) as Quad;
}

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = source.width;
  result.height = source.height;
  const ctx = result.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable for case sprites.");
  ctx.drawImage(source, 0, 0);
  return result;
}

function applyCoverAlpha(canvas: HTMLCanvasElement, cover: Quad, alpha: number) {
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskContext = mask.getContext("2d");
  const context = canvas.getContext("2d");
  if (!maskContext || !context) throw new Error("Canvas 2D is unavailable for case sprites.");
  maskContext.fillStyle = "#fff";
  maskContext.fillRect(0, 0, mask.width, mask.height);
  maskContext.beginPath();
  maskContext.moveTo(cover[0][0], cover[0][1]);
  for (let index = 1; index < cover.length; index++) maskContext.lineTo(cover[index][0], cover[index][1]);
  maskContext.closePath();
  maskContext.globalCompositeOperation = "destination-out";
  maskContext.fillStyle = "#000";
  maskContext.fill();
  maskContext.globalCompositeOperation = "source-over";
  maskContext.globalAlpha = clamp(alpha, 0, 1);
  maskContext.fillStyle = "#fff";
  maskContext.fill();
  maskContext.globalAlpha = 1;
  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = "source-over";
  mask.width = 0;
  mask.height = 0;
}

function renderAndCopy(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
): HTMLCanvasElement {
  renderer.setSize(width, height, false);
  renderer.clear(true, true, true);
  renderer.render(scene, camera);
  return copyCanvas(renderer.domElement);
}

function renderPaperField(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera,
  root: THREE.Group, paper: ReturnType<typeof createAlbumInsert>, mask: THREE.Mesh,
  white: THREE.MeshLambertMaterial, width: number, height: number) {
  const objects: Array<[THREE.Object3D, boolean]> = [];
  const materials = new Map<THREE.Material, boolean>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    objects.push([object, object.visible]);
    if (object.userData.casePart === "cover") object.visible = false;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!materials.has(material)) materials.set(material, material.colorWrite);
      material.colorWrite = false;
    }
  });
  const original = paper.material;
  paper.material = white;
  mask.visible = false;
  try { return renderAndCopy(renderer, scene, camera, width, height); }
  finally {
    paper.material = original;
    mask.visible = true;
    for (const [object, visible] of objects) object.visible = visible;
    for (const [material, colorWrite] of materials) material.colorWrite = colorWrite;
  }
}

function qualityOptions(quality: CaseSpriteQuality) {
  return {
    lighting: quality.lighting === "basic" ? "basic" : "refined",
    transmission: quality.transmission,
  };
}

function remember(key: string, promise: Promise<EditableCaseSprites>) {
  spriteCache.delete(key);
  spriteCache.set(key, promise);
  while (spriteCache.size > CACHE_LIMIT) {
    const oldest = spriteCache.keys().next().value as string | undefined;
    if (!oldest) break;
    spriteCache.delete(oldest);
  }
}

export function editableCaseSpriteKey(
  settings: CaseSettings,
  quality: RenderQuality,
  theme: "day" | "night" = "night",
  paletteKey = "",
): string {
  return JSON.stringify({
    structure: settings.structure,
    appearance: settings.appearances[settings.structure],
    quality,
    theme,
    paletteKey,
  });
}

export function createEditableCaseSprites(
  settings: CaseSettings,
  qualityInput: RenderQuality,
  template: CaseSpriteTemplate,
  theme: "day" | "night" = "night",
  paletteKey = "",
): Promise<EditableCaseSprites> {
  const quality = qualityInput as CaseSpriteQuality;
  const key = editableCaseSpriteKey(settings, qualityInput, theme, paletteKey);
  const cached = spriteCache.get(key);
  if (cached) {
    spriteCache.delete(key);
    spriteCache.set(key, cached);
    return cached;
  }
  let promise: Promise<EditableCaseSprites>;
  promise = buildEditableCaseSprites(settings, quality, template, theme).catch((error: unknown) => {
    if (spriteCache.get(key) === promise) spriteCache.delete(key);
    throw error;
  });
  remember(key, promise);
  return promise;
}

async function buildEditableCaseSprites(
  settings: CaseSettings,
  quality: CaseSpriteQuality,
  template: CaseSpriteTemplate,
  theme: "day" | "night",
): Promise<EditableCaseSprites> {
  const detail = quality.modelDetail ?? "medium";
  const root = await createCaseModel(settings.structure, detail);
  const layout = getCaseLayout(root);
  let renderer: THREE.WebGLRenderer | undefined;
  let studio: ReturnType<typeof createCaseStudioLighting> | undefined;
  let illumination: ReturnType<typeof createCaseIllumination> | undefined;
  let paper: ReturnType<typeof createAlbumInsert> | undefined;
  let paperMask: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | undefined;
  let paperWhite: THREE.MeshLambertMaterial | undefined;
  try {
    const arrayWidth = template.array_res[0];
    const arrayHeight = template.array_res[1];
    const inspectWidth = template.inspect_res[0];
    const inspectHeight = template.inspect_res[1];
    const arrayPpu = template.array_ppu;
    const inspectPpu = template.inspect_ppu;
    const arrayBasis = cameraBasis(template.axes, arrayPpu);
    const origin = template.array.origin;
    const arrayTarget = arrayBasis.right.clone().multiplyScalar((arrayWidth / 2 - origin[0]) / arrayPpu)
      .addScaledVector(arrayBasis.up, (origin[1] - arrayHeight / 2) / arrayPpu);
    const arrayCamera = cameraFor(arrayWidth, arrayHeight, arrayPpu, arrayBasis, arrayTarget);

    const scene = new THREE.Scene();
    illumination = createCaseIllumination(scene);
    scene.add(root);
    if (layout.insertThickness) {
      paper = createAlbumInsert(layout.cover, layout.insertThickness);
      paperMask = new THREE.Mesh(new THREE.PlaneGeometry(layout.cover.width, layout.cover.height),
        // Three clears the transmission buffer to white/.5 when the canvas
        // is transparent. Explicitly erase that colour under the insert;
        // a depth-only mask would leave a bright veil in the front glass.
        new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending,
          transparent: false, colorWrite: true, depthWrite: true, toneMapped: false, fog: false }));
      paperMask.position.set(layout.cover.x, layout.cover.y, layout.cover.z);
      paperMask.renderOrder = -101;
      paperWhite = createAlbumPrintMaterial(null);
      scene.add(paper, paperMask);
    }
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = quality.shadows > 0;
        object.receiveShadow = quality.shadows > 0;
      }
    });

    renderer = makeRenderer(Math.max(arrayWidth, inspectWidth), Math.max(arrayHeight, inspectHeight), quality);
    studio = createCaseStudioLighting(renderer, scene);
    studio.setTheme(theme); studio.setQuality(quality);
    const appearance = appearanceCopy(settings.appearances[settings.structure]);
    const applyQuality = qualityOptions(quality);
    applyCaseAppearance(root, appearance, applyQuality);
    setCaseAlbumOcclusion(root, Boolean(paper));
    illumination.apply(appearance, quality);
    illumination.update(root);
    root.updateMatrixWorld(true);
    const modelBounds = new THREE.Box3().setFromObject(root);
    if (modelBounds.isEmpty()) {
      modelBounds.set(
        new THREE.Vector3(...layout.bounds.min),
        new THREE.Vector3(...layout.bounds.max),
      );
    }
    const modelCenter = modelBounds.getCenter(new THREE.Vector3());
    const arrayCover = projectQuad(coverCorners(layout.cover), arrayCamera, arrayWidth, arrayHeight);
    const labelPoints = transformedLabelCorners(layout.label, root, appearance);
    const arrayLabel = projectQuad(labelPoints, arrayCamera, arrayWidth, arrayHeight);
    const arrayBody = projectBodyBounds(modelBounds, arrayCamera, arrayWidth, arrayHeight);
    const arrayCenter = projectPoint(modelCenter, arrayCamera, arrayWidth, arrayHeight);
    // Non-layered legacy structures keep their earlier sprite transparency.
    // Punk uses an opaque insert and the actual front-glass pass instead.
    const clearStrength = .82;
    const frostStrength = .62;
    const clearCoverAlpha = coverTransmissionAlpha(root, clearStrength);
    const arrayClear = renderAndCopy(
      renderer,
      scene,
      arrayCamera,
      arrayWidth,
      arrayHeight,
    );
    // Three renders the configurable case material into the shell sprite.
    // The projected cover area keeps the established album-art overlay path;
    // alpha there lets that existing image remain visible beneath the model.
    if (!paper) applyCoverAlpha(arrayClear, arrayCover, clearCoverAlpha);
    const arrayPaper = paper && paperMask && paperWhite
      ? renderPaperField(renderer, scene, arrayCamera, root, paper, paperMask, paperWhite, arrayWidth, arrayHeight) : undefined;

    const frostAppearance = appearanceCopy(appearance);
    applyCaseAppearance(root, frostAppearance, applyQuality);
    if (paper) setCaseGlassFrost(root, 1);
    else root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || object.userData.casePart !== "cover" || !object.visible)
        return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials)
        if (material.visible && material instanceof THREE.MeshPhysicalMaterial)
          material.roughness = Math.max(0.64, material.roughness);
    });
    const frostCoverAlpha = coverTransmissionAlpha(root, frostStrength);
    const arrayFrost = renderAndCopy(renderer, scene, arrayCamera, arrayWidth, arrayHeight);
    if (!paper) applyCoverAlpha(arrayFrost, arrayCover, frostCoverAlpha);

    applyCaseAppearance(root, appearance, applyQuality);
    const start = arrayBasis;
    const finalForward = new THREE.Vector3(0.16, -0.06, 0.985).normalize();
    const finalRight = new THREE.Vector3(0, 1, 0).cross(finalForward).normalize();
    const finalUp = new THREE.Vector3().crossVectors(finalForward, finalRight).normalize();
    const startRotation = basisQuaternion(start.right, start.up, start.forward);
    const endRotation = basisQuaternion(finalRight, finalUp, finalForward);
    const inspectCount = 5;
    const inspect: HTMLCanvasElement[] = [];
    const inspectPaper: HTMLCanvasElement[] = [];
    const inspectFrames: EditableCaseSprites["inspectFrames"] = [];
    const inspectTarget = modelCenter.clone();
    const inspectCoverAlpha = coverTransmissionAlpha(root, clearStrength);
    for (let index = 0; index < inspectCount; index++) {
      const t = index / (inspectCount - 1);
      const rotation = startRotation.clone().slerp(endRotation, t);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).normalize();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).normalize();
      const basis = { right, up, forward };
      const camera = cameraFor(inspectWidth, inspectHeight, inspectPpu, basis, inspectTarget);
      const cover = projectQuad(coverCorners(layout.cover), camera, inspectWidth, inspectHeight);
      const label = projectQuad(labelPoints, camera, inspectWidth, inspectHeight);
      const image = renderAndCopy(renderer, scene, camera, inspectWidth, inspectHeight);
      if (!paper) applyCoverAlpha(image, cover, inspectCoverAlpha);
      if (paper && paperMask && paperWhite)
        inspectPaper.push(renderPaperField(renderer, scene, camera, root, paper, paperMask, paperWhite, inspectWidth, inspectHeight));
      inspect.push(image);
      inspectFrames.push({
        cover,
        label,
        body: projectBodyBounds(modelBounds, camera, inspectWidth, inspectHeight),
        origin: projectPoint(new THREE.Vector3(), camera, inspectWidth, inspectHeight),
        center: [inspectWidth / 2, inspectHeight / 2],
        axes: projectedAxes(basis, inspectPpu),
      });
    }

    return {
      arrayClear,
      arrayFrost,
      inspect,
      arrayPaper,
      inspectPaper: paper ? inspectPaper : undefined,
      array: { cover: arrayCover, label: arrayLabel, body: arrayBody, origin: [...origin], center: arrayCenter },
      inspectFrames,
      inspect_ppu: inspectPpu,
    };
  } finally {
    illumination?.dispose();
    studio?.dispose();
    if (renderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
    disposeCaseModel(root);
    paper?.geometry.dispose(); paper?.material.dispose();
    paperMask?.geometry.dispose(); paperMask?.material.dispose(); paperWhite?.dispose();
  }
}
