import { DynamicDrawUsage, InstancedMesh } from "three";
import type { Object3D, Scene, WebGLRenderer } from "three";
import { MusicInstanceDrawList } from "./music-instance-draw-list.ts";

type InstanceAttribute = InstancedMesh["instanceMatrix"];
type CopyEntry = {
  source: InstancedMesh;
  copy: InstancedMesh;
  capacity: number;
  colorSignature: string | null;
  previousMatrixSignature: string | null;
};
type ShadowState = {
  source: InstancedMesh;
  parent: Object3D;
  wasVisible: boolean;
  copy: InstancedMesh;
};

type InstancedMeshWithShadowExtras = InstancedMesh & {
  previousInstanceMatrix?: InstanceAttribute | null;
  morphTexture?: unknown;
};

function attributeSignature(attribute: InstanceAttribute | null): string | null {
  if (!attribute) return null;
  return [attribute.itemSize, attribute.array.constructor, attribute.array.byteLength,
    attribute.normalized, attribute.meshPerAttribute].join(":");
}

function copyAttributeValues(source: InstanceAttribute, destination: InstanceAttribute): void {
  destination.array.set(source.array);
  destination.needsUpdate = true;
}

function effectivelyVisible(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function placeAfter(parent: NonNullable<InstancedMesh["parent"]>, source: InstancedMesh, copy: InstancedMesh): void {
  parent.add(copy);
  const sourceIndex = parent.children.indexOf(source);
  const copyIndex = parent.children.indexOf(copy);
  if (sourceIndex < 0 || copyIndex < 0) return;
  parent.children.splice(copyIndex, 1);
  parent.children.splice(parent.children.indexOf(source) + 1, 0, copy);
}

/**
 * Renders shadow-casting instance pools from a separate compact buffer while
 * leaving the main-camera instances available to the composer's other passes.
 */
export class MusicInstanceShadows {
  private readonly entries = new Map<InstancedMesh, CopyEntry>();
  private drawList = new MusicInstanceDrawList();
  private rendering = false;

  render(
    renderer: WebGLRenderer,
    scene: Scene,
    originals: readonly InstancedMesh[],
    shadowSlots: readonly number[],
    render: () => void,
  ): void {
    if (this.rendering) {
      render();
      return;
    }

    const uniqueOriginals = [...new Set(originals)];
    this.prune(uniqueOriginals);
    const shadowMap = renderer.shadowMap;
    if (!shadowMap.enabled || (!shadowMap.autoUpdate && !shadowMap.needsUpdate)) {
      render();
      return;
    }

    const active: CopyEntry[] = [];
    for (const source of uniqueOriginals) {
      const sourceWithExtras = source as InstancedMeshWithShadowExtras;
      if (!source.castShadow || sourceWithExtras.morphTexture) continue;
      const isVisible = effectivelyVisible(source);
      if (!isVisible && !this.entries.has(source)) continue;
      const entry = this.ensureCopy(source);
      if (!entry) continue;
      this.syncCopy(entry);
      entry.copy.visible = isVisible;
      if (isVisible) active.push(entry);
    }
    if (active.length === 0) {
      render();
      return;
    }

    const allCopies = [...this.entries.values()]
      .filter((entry) => entry.source.castShadow && !(entry.source as InstancedMeshWithShadowExtras).morphTexture)
      .map((entry) => entry.copy);
    const originalShadowRender = shadowMap.render;
    const owner = this;
    this.rendering = true;

    const wrappedShadowRender = function (this: typeof shadowMap, lights: Parameters<typeof originalShadowRender>[0],
      shadowScene: Parameters<typeof originalShadowRender>[1], camera: Parameters<typeof originalShadowRender>[2]) {
      if (!shadowMap.enabled || (!shadowMap.autoUpdate && !shadowMap.needsUpdate) || lights.length === 0)
        return originalShadowRender.call(this, lights, shadowScene, camera);

      const eligible = active.filter((entry) => entry.source.castShadow && effectivelyVisible(entry.source));
      if (eligible.length === 0) return originalShadowRender.call(this, lights, shadowScene, camera);

      const states: ShadowState[] = [];
      try {
        for (const entry of eligible) {
          const source = entry.source;
          const copy = entry.copy;
          const parent = source.parent ?? shadowScene;
          states.push({ source, copy, parent, wasVisible: source.visible });
          source.visible = false;
          copy.visible = true;
          copy.matrixWorld.copy(source.matrixWorld);
          copy.matrixWorldNeedsUpdate = false;
          placeAfter(parent, source, copy);
        }

        return owner.drawList.render(allCopies, shadowSlots, () =>
          originalShadowRender.call(this, lights, shadowScene, camera));
      } finally {
        for (let index = states.length - 1; index >= 0; index -= 1) {
          const state = states[index];
          state.parent.remove(state.copy);
          state.source.visible = state.wasVisible;
        }
      }
    };

    try {
      shadowMap.render = wrappedShadowRender;
      render();
    } finally {
      shadowMap.render = originalShadowRender;
      this.rendering = false;
    }
  }

  dispose(): void {
    if (this.rendering) throw new Error("Cannot dispose instance shadows during rendering.");
    for (const entry of this.entries.values()) this.disposeCopy(entry.copy);
    this.entries.clear();
    this.drawList.dispose();
  }

  private ensureCopy(source: InstancedMesh): CopyEntry | null {
    const sourceWithExtras = source as InstancedMeshWithShadowExtras;
    if (sourceWithExtras.morphTexture) return null;
    const colorSignature = attributeSignature(source.instanceColor);
    const previousMatrixSignature = attributeSignature(sourceWithExtras.previousInstanceMatrix ?? null);
    let entry = this.entries.get(source);
    if (entry && (entry.capacity !== source.instanceMatrix.count ||
      entry.colorSignature !== colorSignature ||
      entry.previousMatrixSignature !== previousMatrixSignature)) {
      this.disposeCopy(entry.copy);
      this.entries.delete(source);
      this.resetDrawList();
      entry = undefined;
    }
    if (entry) return entry;

    const copy = new InstancedMesh(source.geometry, source.material, source.instanceMatrix.count);
    copy.name = `${source.name || "Instance"} [shadow]`;
    copy.instanceMatrix = source.instanceMatrix.clone() as InstanceAttribute;
    copy.instanceMatrix.setUsage(DynamicDrawUsage);
    copy.instanceColor = (source.instanceColor?.clone() as InstanceAttribute | undefined) ?? null;
    copy.instanceColor?.setUsage(DynamicDrawUsage);
    const previous = sourceWithExtras.previousInstanceMatrix ?? null;
    if (previous) {
      (copy as InstancedMeshWithShadowExtras).previousInstanceMatrix = previous.clone() as InstanceAttribute;
      (copy as InstancedMeshWithShadowExtras).previousInstanceMatrix?.setUsage(DynamicDrawUsage);
    }
    copy.matrixAutoUpdate = false;
    copy.matrixWorldAutoUpdate = false;
    copy.castShadow = true;
    copy.userData = { ...source.userData, musicInstanceShadowCopy: true };
    entry = {
      source,
      copy,
      capacity: source.instanceMatrix.count,
      colorSignature,
      previousMatrixSignature,
    };
    this.entries.set(source, entry);
    this.syncCopy(entry);
    return entry;
  }

  private syncCopy(entry: CopyEntry): void {
    const { source, copy } = entry;
    const sourceWithExtras = source as InstancedMeshWithShadowExtras;
    const copyWithExtras = copy as InstancedMeshWithShadowExtras;

    copy.geometry = source.geometry;
    copy.material = source.material;
    copy.count = source.count;
    copy.instanceMatrix.array.set(source.instanceMatrix.array);
    copy.instanceMatrix.needsUpdate = true;
    if (source.instanceColor && copy.instanceColor) copyAttributeValues(source.instanceColor, copy.instanceColor);
    if (sourceWithExtras.previousInstanceMatrix && copyWithExtras.previousInstanceMatrix)
      copyAttributeValues(sourceWithExtras.previousInstanceMatrix, copyWithExtras.previousInstanceMatrix);

    copy.customDepthMaterial = source.customDepthMaterial;
    copy.customDistanceMaterial = source.customDistanceMaterial;
    copy.onBeforeShadow = source.onBeforeShadow;
    copy.onAfterShadow = source.onAfterShadow;
    copy.onBeforeRender = source.onBeforeRender;
    copy.onAfterRender = source.onAfterRender;
    copy.layers.mask = source.layers.mask;
    copy.matrix.copy(source.matrix);
    copy.matrixWorld.copy(source.matrixWorld);
    copy.matrixWorldNeedsUpdate = false;
    copy.renderOrder = source.renderOrder;
    copy.frustumCulled = source.frustumCulled;
    copy.receiveShadow = source.receiveShadow;
    copy.castShadow = true;
    copy.userData = { ...source.userData, musicInstanceShadowCopy: true };
    if (source.boundingBox) copy.boundingBox = source.boundingBox.clone();
    else copy.boundingBox = null;
    if (source.boundingSphere) copy.boundingSphere = source.boundingSphere.clone();
    else copy.boundingSphere = null;
  }

  private prune(originals: readonly InstancedMesh[]): void {
    const active = new Set(originals);
    let pruned = false;
    for (const [source, entry] of this.entries) {
      if (!active.has(source) || !source.castShadow || (source as InstancedMeshWithShadowExtras).morphTexture) {
        this.disposeCopy(entry.copy);
        this.entries.delete(source);
        pruned = true;
      }
    }
    if (pruned) this.resetDrawList();
  }

  private resetDrawList(): void {
    this.drawList.dispose();
    this.drawList = new MusicInstanceDrawList();
  }

  private disposeCopy(copy: InstancedMesh): void {
    copy.removeFromParent();
    copy.dispose();
  }
}
