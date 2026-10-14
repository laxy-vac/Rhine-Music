import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetUrl } from "./asset-url.ts";
import { nativeCaseLayout, type CaseRect } from "./case-layout.ts";
import { filterRhineShellGeometry, relocateRhineLabelGeometry, RHINE_LABEL_SHIFT_X } from "./rhine-shell-geometry";

export type RhineCaseDetail = "low" | "medium" | "high";

type RhineCasePart =
  | "frame"
  | "cover"
  | "back"
  | "fasteners"
  | "trim"
  | "trimHighlight"
  | "lettering"
  | "label"
  | "ink"
  | "accent";

type RhineSurface = {
  part: RhineCasePart;
};

type GeometryGroup = {
  start: number;
  count: number;
  materialIndex: number;
};

type SourceMeshPart = {
  object: THREE.Mesh;
  sourceMaterial: THREE.Material;
  surface: string;
  part: RhineCasePart;
  assemblyPart?: string;
  groups: GeometryGroup[] | null;
};

type CaseNative = {
  color: string;
  roughness: number;
  metalness: number;
  transmission: number;
  thickness: number;
  ior: number;
  attenuationColor: string;
  attenuationDistance: number;
  emissive: string;
  emissiveIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  iridescence: number;
};

// Reuse RhineLabUI's shell, keeping the unmodified GLB as the source asset.
// The music variant omits the exhibition components and holds an album card.
const SOURCE_PATH = "assets/archive-cassette.glb";
const ALBUM_CARD_THICKNESS = 0.012;
const ALBUM_WINDOW_MARGIN = 0.02;
const INTERNAL_SURFACES = new Set([
  "Subsurface_Optics", "Optical_Film", "Optical_Film_Edge",
  "Amber_Optical_Inlay",
]);
const DETAIL_LEVEL: Record<RhineCaseDetail, 0 | 1 | 2> = {
  low: 0,
  medium: 1,
  high: 2,
};

const RHINE_SURFACES: Record<string, RhineSurface> = {
  Ivory_Edges: { part: "frame" },
  Frosted_Polymer: { part: "cover" },
  Optical_Diffuser: { part: "back" },
  Titanium_Fasteners: { part: "fasteners" },
  Case_Engraving: { part: "trim" },
  Case_Engraving_Highlight: { part: "trimHighlight" },
  Moulded_Lettering: { part: "lettering" },
  Printed_Label: { part: "label" },
  Carbon_Ink: { part: "ink" },
  // These two source materials also contain label glyphs and perimeter trim.
  // Select their exterior islands instead of removing the whole material.
  Internal_Ceramic: { part: "lettering" },
  Optical_Edges: { part: "trimHighlight" },
  Champagne_Index: { part: "accent" },
  Index_Inlay: { part: "accent" },
};

const GLTF_SOURCES = new Map<string, Promise<THREE.Group>>();

function sourceScene(path: string): Promise<THREE.Group> {
  const url = assetUrl(path);
  let pending = GLTF_SOURCES.get(url);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(url).then(({ scene }) => {
      scene.updateMatrixWorld(true);
      return scene;
    });
    GLTF_SOURCES.set(url, pending);
    pending.catch(() => {
      if (GLTF_SOURCES.get(url) === pending) GLTF_SOURCES.delete(url);
    });
  }
  return pending;
}

function normalizedMaterialName(material: THREE.Material): string {
  const name = material.name.split("__").pop() ?? material.name;
  return name.replace(/\.\d+$/, "");
}

function toColorHex(value: unknown, fallback: string): string {
  return value instanceof THREE.Color ? `#${value.getHexString()}` : fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && !Number.isNaN(value) ? value : fallback;
}

function nativeMaterialValues(material: THREE.Material): CaseNative {
  const values = material as THREE.Material &
    Partial<THREE.MeshStandardMaterial> &
    Partial<THREE.MeshPhysicalMaterial>;
  return {
    color: toColorHex(values.color, "#ffffff"),
    roughness: toNumber(values.roughness, 1),
    metalness: toNumber(values.metalness, 0),
    transmission: toNumber(values.transmission, 0),
    thickness: toNumber(values.thickness, 0),
    ior: toNumber(values.ior, 1.5),
    attenuationColor: toColorHex(values.attenuationColor, "#ffffff"),
    attenuationDistance: toNumber(
      values.attenuationDistance,
      Number.POSITIVE_INFINITY,
    ),
    emissive: toColorHex(values.emissive, "#000000"),
    emissiveIntensity: toNumber(values.emissiveIntensity, 1),
    clearcoat: toNumber(values.clearcoat, 0),
    clearcoatRoughness: toNumber(values.clearcoatRoughness, 0),
    iridescence: toNumber(values.iridescence, 0),
  };
}

function clonePhysicalMaterial(
  source: THREE.Material,
): THREE.MeshPhysicalMaterial {
  let material: THREE.MeshPhysicalMaterial;
  if (source instanceof THREE.MeshPhysicalMaterial) {
    material = source.clone();
  } else {
    material = new THREE.MeshPhysicalMaterial();
    if (source instanceof THREE.MeshStandardMaterial) {
      // The standard copy routine transfers only standard PBR fields. Calling
      // MeshPhysicalMaterial.copy here would overwrite its physical defaults
      // with undefined fields from a standard material.
      THREE.MeshStandardMaterial.prototype.copy.call(material, source);
    } else {
      material.name = source.name;
      material.userData = { ...source.userData };
      material.side = source.side;
      material.opacity = source.opacity;
      material.transparent = source.transparent;
      material.depthTest = source.depthTest;
      material.depthWrite = source.depthWrite;
      material.toneMapped = source.toneMapped;
      const standardLike = source as THREE.Material & {
        color?: THREE.Color;
        map?: THREE.Texture | null;
        emissive?: THREE.Color;
        emissiveMap?: THREE.Texture | null;
      };
      if (standardLike.color instanceof THREE.Color)
        material.color.copy(standardLike.color);
      if (standardLike.map) material.map = standardLike.map;
      if (standardLike.emissive instanceof THREE.Color)
        material.emissive.copy(standardLike.emissive);
      if (standardLike.emissiveMap)
        material.emissiveMap = standardLike.emissiveMap;
    }
  }

  material.userData = { ...material.userData };
  material.defines = { STANDARD: "", PHYSICAL: "" };
  material.userData.caseNative = nativeMaterialValues(material);
  material.userData.caseOwned = true;
  material.userData.preserveSource = true;
  return material;
}

function geometryBounds(object: THREE.Mesh): THREE.Box3 {
  object.geometry.computeBoundingBox();
  const local = object.geometry.boundingBox;
  if (!local || local.isEmpty()) return new THREE.Box3().makeEmpty();
  return local.clone().applyMatrix4(object.matrixWorld);
}

function sourceParts(object: THREE.Mesh): SourceMeshPart[] {
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  if (materials.length === 0)
    throw new Error(
      `The Rhine cassette mesh "${object.name}" has no material.`,
    );

  const groups = object.geometry.groups as GeometryGroup[];
  if (materials.length > 1 && groups.length === 0)
    throw new Error(
      `The Rhine cassette mesh "${object.name}" has multiple materials but no geometry groups.`,
    );

  const parts: SourceMeshPart[] = [];
  for (
    let materialIndex = 0;
    materialIndex < materials.length;
    materialIndex++
  ) {
    const sourceMaterial = materials[materialIndex];
    const surface = normalizedMaterialName(sourceMaterial);
    if (INTERNAL_SURFACES.has(surface)) continue;
    const selected = RHINE_SURFACES[surface];
    const selectedGroups =
      materials.length > 1
        ? groups.filter((group) => group.materialIndex === materialIndex)
        : groups.length
          ? groups
          : null;

    if (selectedGroups && selectedGroups.length === 0) continue;
    if (!selected)
      throw new Error(
        `The Rhine cassette contains an unsupported case surface "${surface}" on "${object.name}".`,
      );

    parts.push({
      object,
      sourceMaterial,
      surface,
      part: selected.part,
      assemblyPart:
        typeof object.userData.assemblyPart === "string"
          ? object.userData.assemblyPart
          : undefined,
      groups: selectedGroups,
    });
  }
  return parts;
}

function isReducedDetail(
  detail: RhineCaseDetail,
  surface: string,
): boolean {
  if (detail === "high") return false;

  const fineEtching =
    surface === "Moulded_Lettering" ||
    surface === "Case_Engraving";
  // The source groups screw highlights with engraving highlights in one mesh.
  // Retain that mesh at every detail level so the screws keep their highlights.
  if (fineEtching) return true;

  return (
    detail === "low" &&
    (surface === "Index_Inlay" || surface === "Champagne_Index")
  );
}

function sourceCoverRect(glassBounds: THREE.Box3): CaseRect {
  // Album on the left, original label on the right. Stay inside the narrow
  // left press detail; the print sits .034 behind the source pane's back face.
  return { x: -.74, y: 1.96, z: glassBounds.min.z - .034, width: 2.52, height: 2.52 };
}

function sourceLabelRect(
  labelBounds: THREE.Box3,
  modelBounds: THREE.Box3,
): CaseRect {
  const bounds = labelBounds.isEmpty() ? modelBounds : labelBounds;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  return {
    x: center.x,
    y: center.y,
    z: bounds.max.z,
    width: size.x,
    height: size.y,
  };
}

function createGeometry(
  part: SourceMeshPart,
  scale: number,
  yOffset: number,
): THREE.BufferGeometry {
  let geometry = part.object.geometry.clone();
  geometry.userData = { ...geometry.userData };
  delete geometry.userData.musicDimensions;

  if (part.groups) {
    geometry.clearGroups();
    for (const group of part.groups)
      geometry.addGroup(group.start, group.count, 0);
  }

  geometry.applyMatrix4(part.object.matrixWorld);
  const shell = filterRhineShellGeometry(geometry, part.surface);
  if (shell !== geometry) { geometry.dispose(); geometry = shell; }
  relocateRhineLabelGeometry(geometry, part.surface);
  geometry.scale(scale, scale, scale);
  geometry.translate(0, yOffset, 0);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.caseOwned = true;
  geometry.userData.casePart = part.part;
  geometry.userData.surface = part.surface;
  return geometry;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const drawCount =
    geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const count = geometry.groups.length
    ? geometry.groups.reduce((total, group) => total + group.count, 0)
    : drawCount;
  return Math.floor(count / 3);
}

/** Adapt the original Rhine shell into a cassette containing a square album card. */
export async function createRhineCaseModel(
  detail: RhineCaseDetail,
): Promise<THREE.Group> {
  const scene = await sourceScene(SOURCE_PATH);
  const modelBounds = new THREE.Box3().makeEmpty();
  const glassBounds = new THREE.Box3().makeEmpty();
  const labelBounds = new THREE.Box3().makeEmpty();
  const parts: SourceMeshPart[] = [];

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const bounds = geometryBounds(object);
    if (bounds.isEmpty()) return;
    const meshParts = sourceParts(object);
    if (meshParts.length === 0) return;
    modelBounds.union(bounds);
    for (const part of meshParts) {
      if (part.surface === "Frosted_Polymer") glassBounds.union(bounds);
      if (part.surface === "Printed_Label") labelBounds.union(bounds.clone().translate(new THREE.Vector3(RHINE_LABEL_SHIFT_X, 0, 0)));
      parts.push(part);
    }
  });

  if (parts.length === 0 || modelBounds.isEmpty())
    throw new Error("The Rhine cassette has no reusable case geometry.");
  if (glassBounds.isEmpty()) throw new Error("The Rhine shell has no front pane.");

  const nativeCover = sourceCoverRect(glassBounds);
  const nativeLabel = sourceLabelRect(labelBounds, modelBounds);
  const layout = nativeCaseLayout(modelBounds, nativeCover, nativeLabel);
  layout.insertThickness = ALBUM_CARD_THICKNESS * layout.sourceScale;
  const window = { ...layout.cover,
    width: layout.cover.width + 2 * ALBUM_WINDOW_MARGIN * layout.sourceScale,
    height: layout.cover.height + 2 * ALBUM_WINDOW_MARGIN * layout.sourceScale };

  const root = new THREE.Group();
  root.name = "Case_rhine";
  root.userData.caseStructure = "rhine";
  root.userData.caseDetail = DETAIL_LEVEL[detail];
  root.userData.caseProvenance = "RhineLabUI/archive-cassette.glb";
  root.userData.caseVariant = "inset-album-shell";
  root.userData.caseRemovedSurfaces = [...INTERNAL_SURFACES];
  root.userData.caseGlassDepth = [glassBounds.min.z * layout.sourceScale, glassBounds.max.z * layout.sourceScale];
  root.userData.caseLayout = layout;
  root.userData.caseFront = {
    normal: [0, 0, 1],
    cover: { ...layout.cover },
  };
  const nativeSize = modelBounds.getSize(new THREE.Vector3());
  root.userData.caseSourceBounds = {
    min: modelBounds.min.toArray(),
    max: modelBounds.max.toArray(),
    size: nativeSize.toArray(),
  };

  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const surfaceTriangles: Record<string, number> = {};
  let totalTriangles = 0;

  try {
    for (const part of parts) {
      if (isReducedDetail(detail, part.surface)) continue;

      const geometry = createGeometry(
        part,
        layout.sourceScale,
        layout.sourceYOffset,
      );
      const material = clonePhysicalMaterial(part.sourceMaterial);
      // The source pane is a closed solid. Rendering both sides injects its
      // back face into Three's transmission buffer, blurring labels outside
      // the local window when clarity changes. Its outward faces suffice.
      if (part.part === "cover") material.side = THREE.FrontSide;
      ownedGeometries.add(geometry);
      ownedMaterials.add(material);

      material.userData.casePart = part.part;
      material.userData.surface = part.surface;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = part.object.name || `Case_${part.surface}`;
      mesh.position.set(0, 0, 0);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(1, 1, 1);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = part.object.visible;
      mesh.frustumCulled = part.object.frustumCulled;
      mesh.renderOrder = part.object.renderOrder;
      mesh.userData = {
        ...part.object.userData,
        casePart: part.part,
        surface: part.surface,
        caseDetail: DETAIL_LEVEL[detail],
        caseRhineOptics: true,
      };
      if (part.assemblyPart) mesh.userData.assemblyPart = part.assemblyPart;
      if (part.part === "cover") {
        mesh.userData.caseGlassWindow = window;
        mesh.userData.caseRhineAlbumWindow = true;
        mesh.userData.caseRhineWindowThickness = (glassBounds.max.z - glassBounds.min.z) * layout.sourceScale;
        mesh.userData.caseLayeredGlass = true;
      }
      if (part.part === "back") mesh.userData.caseAlbumWindow = layout.cover;

      const triangles = triangleCount(geometry);
      totalTriangles += triangles;
      surfaceTriangles[part.surface] =
        (surfaceTriangles[part.surface] ?? 0) + triangles;
      root.add(mesh);
    }
  } catch (error) {
    for (const geometry of ownedGeometries) geometry.dispose();
    for (const material of ownedMaterials) material.dispose();
    throw error;
  }

  root.userData.caseStats = {
    meshCount: root.children.length,
    triangleCount: totalTriangles,
    surfaceTriangles,
  };
  root.updateMatrixWorld(true);
  return root;
}
