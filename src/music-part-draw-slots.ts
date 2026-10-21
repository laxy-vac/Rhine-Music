import {
  Box3,
  Frustum,
  Material,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
} from "three";
import type { InstancedMesh } from "three";

const WORLD_MARGIN = 0.04;

type PositionLike = {
  count: number;
  itemSize: number;
  version?: number;
  array?: unknown;
  data?: { array?: unknown; version?: number };
  isInterleavedBufferAttribute?: boolean;
};

type MeshWithMorph = InstancedMesh & { morphTexture?: unknown };

type MeshPartState = {
  geometry: InstancedMesh["geometry"] | null;
  position: PositionLike | null;
  positionArray: unknown;
  positionVersion: number;
  positionCount: number;
  positionItemSize: number;
  bounds: Box3;
  boundsAttempted: boolean;
  slots: number[];
  supported: boolean;
};

function positionArray(attribute: PositionLike | null): unknown {
  return attribute?.isInterleavedBufferAttribute ? attribute.data?.array : attribute?.array;
}

function positionVersion(attribute: PositionLike | null): number {
  return attribute?.isInterleavedBufferAttribute ? attribute.data?.version ?? 0 : attribute?.version ?? 0;
}

function finiteBox(box: Box3): boolean {
  return !box.isEmpty() &&
    Number.isFinite(box.min.x) && Number.isFinite(box.min.y) && Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) && Number.isFinite(box.max.y) && Number.isFinite(box.max.z);
}

function finiteMatrix(matrix: Matrix4): boolean {
  const elements = matrix.elements;
  for (let index = 0; index < 16; index += 1)
    if (!Number.isFinite(elements[index])) return false;
  return true;
}

function hasVertexDisplacement(material: Material): boolean {
  const candidate = material as Material & { displacementMap?: unknown; displacementScale?: number };
  return Boolean(candidate.displacementMap) && (candidate.displacementScale ?? 0) !== 0;
}

function isMaterialBoundsSafe(mesh: InstancedMesh, material: Material, hasRestPosition: boolean): boolean {
  if (hasVertexDisplacement(material)) return false;

  // These project-owned vertex hooks were checked: case optics and selection
  // lighting only export varyings; the atlas hooks change UVs; the badge shader
  // keeps the standard instanceMatrix -> projection path. None moves vertices.
  const knownCasePart = Boolean(mesh.userData.casePart) && hasRestPosition && material instanceof MeshPhysicalMaterial;
  const knownCoverAtlas = mesh.geometry.hasAttribute("coverTile") && material instanceof MeshLambertMaterial;
  const knownLabelAtlas = mesh.userData.rhineAlbumInfo === true && mesh.userData.role === "label" &&
    material instanceof MeshBasicMaterial;
  const knownBadgeAtlas = mesh.userData.rhineAlbumInfo === true && mesh.userData.role === "badge" &&
    material instanceof ShaderMaterial;
  if (knownCasePart || knownCoverAtlas || knownLabelAtlas || knownBadgeAtlas) return true;

  // Arbitrary custom shaders and onBeforeCompile hooks can alter `position`.
  // Restrict the generic path to standard Three materials with its stock hook.
  if (material instanceof ShaderMaterial || material.onBeforeCompile !== Material.prototype.onBeforeCompile)
    return false;
  return material instanceof MeshBasicMaterial || material instanceof MeshLambertMaterial ||
    material instanceof MeshStandardMaterial;
}

/**
 * Supplies a conservative, per-part main-camera slot list to MusicInstanceDrawList.
 * Call beginFrame with the existing whole-box visible list; shadows keep using
 * their original list. Each provider result preserves the source slot order.
 */
export class MusicPartDrawSlots {
  /** Diagnostic parity switch: false returns the unfiltered whole-box slot list. */
  enabled = true;
  readonly stats = { wholeBoxInstances: 0, submittedInstances: 0, wholeBoxTriangles: 0, submittedTriangles: 0 };

  private readonly states = new Map<InstancedMesh, MeshPartState>();
  private sourceSlots: readonly number[] = [];
  private frustum?: Frustum;
  private readonly instanceMatrix = new Matrix4();
  private readonly combinedMatrix = new Matrix4();
  private readonly worldBounds = new Box3();

  /** Stable callback suitable for MusicInstanceDrawList's per-mesh slots argument. */
  readonly forMesh = (mesh: InstancedMesh): readonly number[] => {
    const slots = this.filterMesh(mesh);
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
    this.stats.wholeBoxInstances += this.sourceSlots.length;
    this.stats.submittedInstances += slots.length;
    this.stats.wholeBoxTriangles += this.sourceSlots.length * triangles;
    this.stats.submittedTriangles += slots.length * triangles;
    return slots;
  };

  beginFrame(meshes: readonly InstancedMesh[], slots: readonly number[], frustum: Frustum): void {
    this.sourceSlots = slots;
    this.frustum = frustum;
    this.stats.wholeBoxInstances = this.stats.submittedInstances = 0;
    this.stats.wholeBoxTriangles = this.stats.submittedTriangles = 0;

    // Mesh lists are small and this avoids allocating a Set on every frame.
    for (const mesh of this.states.keys()) {
      let present = false;
      for (const candidate of meshes) {
        if (candidate === mesh) {
          present = true;
          break;
        }
      }
      if (!present) this.states.delete(mesh);
    }
  }

  dispose(): void {
    this.states.clear();
    this.sourceSlots = [];
    this.frustum = undefined;
  }

  private filterMesh(mesh: InstancedMesh): readonly number[] {
    const slots = this.sourceSlots;
    const frustum = this.frustum;
    if (!this.enabled || !frustum || slots.length === 0 || !mesh.visible) return slots;

    const state = this.stateFor(mesh);
    if (!state?.supported) return slots;

    const capacity = mesh.instanceMatrix.count;
    const count = mesh.count;
    const meshWorld = mesh.matrixWorld;
    if (!finiteMatrix(meshWorld)) return slots;

    const result = state.slots;
    result.length = 0;
    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (!Number.isInteger(slot) || slot < 0 || slot >= count || slot >= capacity) {
        result.length = 0;
        return slots;
      }

      // Read this mesh's matrix for the logical slot. Most archive pools share
      // the same buffer, but correctness does not depend on that optimization.
      mesh.getMatrixAt(slot, this.instanceMatrix);
      if (!finiteMatrix(this.instanceMatrix)) {
        result.length = 0;
        return slots;
      }
      this.combinedMatrix.multiplyMatrices(meshWorld, this.instanceMatrix);
      this.worldBounds.copy(state.bounds).applyMatrix4(this.combinedMatrix).expandByScalar(WORLD_MARGIN);
      if (!finiteBox(this.worldBounds)) {
        result.length = 0;
        return slots;
      }
      if (frustum.intersectsBox(this.worldBounds)) result.push(slot);
    }
    return result;
  }

  private stateFor(mesh: InstancedMesh): MeshPartState | undefined {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position") as unknown as PositionLike | undefined;
    let state = this.states.get(mesh);
    if (!state) {
      state = {
        geometry: null,
        position: null,
        positionArray: undefined,
        positionVersion: -1,
        positionCount: -1,
        positionItemSize: -1,
        bounds: new Box3(),
        boundsAttempted: false,
        slots: [],
        supported: false,
      };
      this.states.set(mesh, state);
    }

    const array = positionArray(position ?? null);
    const version = positionVersion(position ?? null);
    const geometryChanged = state.geometry !== geometry || state.position !== (position ?? null) ||
      state.positionArray !== array || state.positionVersion !== version ||
      state.positionCount !== (position?.count ?? -1) || state.positionItemSize !== (position?.itemSize ?? -1);
    if (geometryChanged) {
      state.geometry = geometry;
      state.position = position ?? null;
      state.positionArray = array;
      state.positionVersion = version;
      state.positionCount = position?.count ?? -1;
      state.positionItemSize = position?.itemSize ?? -1;
      state.boundsAttempted = false;
    }

    // Material and metadata can be replaced in place while geometry remains
    // stable, so re-check the cheap support gate every frame.
    if (!this.supportedMesh(mesh, position ?? null)) state.supported = false;
    else if (!state.boundsAttempted) {
      state.supported = this.refreshBounds(mesh, state, position ?? null);
      state.boundsAttempted = true;
    } else state.supported = finiteBox(state.bounds);
    return state;
  }

  private refreshBounds(mesh: InstancedMesh, state: MeshPartState, position: PositionLike | null): boolean {
    if (!position || position.count <= 0 || position.itemSize < 3) return false;
    if ((mesh as MeshWithMorph).morphTexture || mesh.geometry.morphAttributes.position?.length) return false;
    if (!this.supportedMesh(mesh, position)) return false;
    try {
      // Compute from current vertex data instead of trusting a possibly stale
      // cached geometry.boundingBox, then retain our own per-mesh snapshot.
      mesh.geometry.computeBoundingBox();
      if (!mesh.geometry.boundingBox || !finiteBox(mesh.geometry.boundingBox)) return false;
      state.bounds.copy(mesh.geometry.boundingBox);
      return finiteBox(state.bounds);
    } catch {
      return false;
    }
  }

  private supportedMesh(mesh: InstancedMesh, position: PositionLike | null): boolean {
    if (!position || position.count <= 0 || position.itemSize < 3) return false;
    if ((mesh as MeshWithMorph).morphTexture || mesh.geometry.morphAttributes.position?.length) return false;
    const knownBadgeClock = mesh.userData.rhineAlbumInfo === true && mesh.userData.role === "badge";
    if (mesh.onBeforeRender !== Object3D.prototype.onBeforeRender && !knownBadgeClock) return false;
    const hasRestPosition = mesh.geometry.hasAttribute("caseRestPosition");
    const material = mesh.material;
    if (Array.isArray(material)) {
      if (material.length === 0) return false;
      for (const candidate of material)
        if (!candidate || !isMaterialBoundsSafe(mesh, candidate, hasRestPosition)) return false;
      return true;
    }
    return Boolean(material && isMaterialBoundsSafe(mesh, material, hasRestPosition));
  }
}
