import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MUSIC_CD_ASSET } from "./music-cd-asset";
import { PUNK_CASE_ASSET } from "./punk-case-asset";
import { assetUrl } from "./asset-url";
import { normalizeMusicGeometry } from "./music-model";
import { minimalCaseLayout, nativeCaseLayout } from "./case-layout";
import { applyCaseMaterials } from "./case-materials";
import { createRhineCaseModel } from "./rhine-case-model";
import {
  casePartsForStructure,
  type CaseAppearance,
  type CasePart,
  type CaseStructure,
} from "./case-settings";

type CaseDetail = "low" | "medium" | "high";
const LEVEL = { low: 0, medium: 1, high: 2 };
const sources = new Map<string, Promise<THREE.Group>>();

function sourceScene(path: string) {
  const url = assetUrl(path);
  let pending = sources.get(url);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then(({ scene }) => {
      scene.updateMatrixWorld(true);
      return scene;
    });
    sources.set(url, pending);
    pending.catch(() => {
      if (sources.get(url) === pending) sources.delete(url);
    });
  }
  return pending;
}

function physical(source: THREE.Material, part: CasePart) {
  const material =
    source instanceof THREE.MeshPhysicalMaterial
      ? source.clone()
      : new THREE.MeshPhysicalMaterial();
  if (
    !(source instanceof THREE.MeshPhysicalMaterial) &&
    source instanceof THREE.MeshStandardMaterial
  )
    THREE.MeshStandardMaterial.prototype.copy.call(material, source);
  // StandardMaterial.copy resets defines; keep the physical shader branch
  // available when an opaque source part is changed to transmitting glass.
  material.defines = { STANDARD: "", PHYSICAL: "" };
  material.userData = { ...material.userData, caseOwned: true, casePart: part };
  return material;
}

async function loadCase(structure: "minimal" | "punk", detail: CaseDetail) {
  const source = await sourceScene(
    structure === "minimal" ? MUSIC_CD_ASSET : PUNK_CASE_ASSET,
  );
  const root = new THREE.Group();
  root.name = `Case_${structure}`;
  root.userData.caseStructure = structure;
  root.userData.caseDetail = LEVEL[detail];
  const bounds = new THREE.Box3().setFromObject(source);
  // The print rectangle is measured from the original white case.json projection.
  // Artwork sits behind the thin glass window, with square proportions preserved.
  const layout =
    structure === "minimal"
      ? structuredClone(minimalCaseLayout)
      : nativeCaseLayout(
          bounds,
          { x: -0.41, y: 1.75, z: 0.105, width: 2.78, height: 2.78 },
          { x: 1.46, y: 1.94, z: 0.211, width: 0.54, height: 0.32 },
          3.5,
        );
  if (structure === "punk") layout.insertThickness = .012 * layout.sourceScale;
  root.userData.caseLayout = layout;
  root.userData.caseFront = { normal: [0, 0, 1], cover: { ...layout.cover } };
  root.userData.caseSourceBounds = {
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
    size: bounds.getSize(new THREE.Vector3()).toArray(),
  };
  root.userData.caseProvenance =
    structure === "punk" ? "multiview-reconstruction-v1" : "original-minimal";
  const supported = new Set(casePartsForStructure(structure));
  const minimalParts: Record<string, CasePart> = {
    Frosted_Polymer: "cover",
    Ivory_Edges: "frame",
    Optical_Diffuser: "back",
  };
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (Array.isArray(object.material))
      throw new Error(`Unexpected multi-material case mesh: ${object.name}`);
    // glTFLoader expands a multi-primitive node into a Group of Mesh children.
    // The node extras stay on the Group; inherit them before flattening.
    let owner: THREE.Object3D = object;
    while (owner !== source && !owner.userData.casePart && owner.parent)
      owner = owner.parent;
    const metadata = owner.userData;
    const surface = object.material.name.replace(/\.\d+$/, "");
    const part =
      structure === "minimal"
        ? minimalParts[surface]
        : (metadata.casePart as CasePart);
    if (!part || !supported.has(part)) return;
    const minDetail = metadata.minDetail as CaseDetail | undefined;
    if (minDetail && LEVEL[minDetail] > LEVEL[detail]) return;
    const geometry = object.geometry.clone();
    geometry.userData = {
      ...geometry.userData,
      caseOwned: true,
      casePart: part,
      caseProceduralTangents: structure === "punk",
    };
    delete geometry.userData.musicDimensions;
    geometry.applyMatrix4(object.matrixWorld);
    if (structure === "minimal") normalizeMusicGeometry(geometry);
    else {
      geometry.scale(
        layout.sourceScale,
        layout.sourceScale,
        layout.sourceScale,
      );
      geometry.translate(0, layout.sourceYOffset, 0);
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, physical(object.material, part));
    mesh.name = object.name;
    mesh.userData = {
      ...metadata,
      ...object.userData,
      casePart: part,
      surface,
      caseDetail: LEVEL[detail],
      preserveCaseFinish: structure !== "minimal",
      caseLayeredGlass: structure === "punk",
      caseGlassWindow: structure === "punk" && part === "cover" ? { ...layout.cover } : undefined,
      caseAlbumWindow: structure === "punk" ? { ...layout.cover } : undefined,
      caseThinWallTube: structure === "punk" && part === "optics",
    };
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  });
  root.userData.caseStats = {
    meshCount: root.children.length,
    triangleCount: root.children.reduce((count, child) => {
      const geometry = (child as THREE.Mesh).geometry;
      return (
        count +
        (geometry.index?.count ?? geometry.getAttribute("position").count) / 3
      );
    }, 0),
  };
  root.updateMatrixWorld(true);
  return root;
}

export async function createCaseModel(
  structure: CaseStructure,
  detail: CaseDetail,
): Promise<THREE.Group> {
  if (structure === "rhine") {
    const root = await createRhineCaseModel(detail);
    root.traverse((child) => {
      if (child.userData.casePart) child.userData.preserveCaseFinish = true;
    });
    return root;
  }
  return loadCase(structure, detail);
}

export function applyCaseAppearance(
  root: THREE.Object3D,
  appearance: CaseAppearance,
  _quality: { lighting?: string; transmission?: number } = {},
) {
  // Quality changes sampling and geometry detail, never the selected optical material.
  applyCaseMaterials(root, appearance);
}

export function disposeCaseModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.geometry.userData.caseOwned) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material])
      if (material.userData.caseOwned) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const texture of material.userData.caseOwnedTextures ?? [])
      if (texture instanceof THREE.Texture) texture.dispose();
    material.dispose();
  }
}
