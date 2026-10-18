import { DynamicDrawUsage, InstancedBufferAttribute } from "three";
import type { BufferGeometry, InstancedMesh } from "three";

type InstanceAttribute = InstancedBufferAttribute & {
  array: { [index: number]: number; readonly length: number; readonly byteLength: number; set(source: ArrayLike<number>, offset?: number): void };
};

type GeometryInstanceAttribute = {
  name: string;
  source: InstanceAttribute;
  packed: InstanceAttribute;
};

type GeometryAttributeSignature = [string, unknown, unknown, number | null];

type MeshBuffers = {
  sourceGeometry: BufferGeometry;
  sourceIndex: BufferGeometry["index"];
  sourceIndexVersion: number | null;
  sourceAttributes: GeometryAttributeSignature[];
  sourceMatrix: InstanceAttribute;
  sourceMatrixArray: InstanceAttribute["array"];
  sourceColor: InstanceAttribute | null;
  sourceColorArray: InstanceAttribute["array"] | null;
  sourcePreviousMatrix: InstanceAttribute | null;
  sourcePreviousMatrixArray: InstanceAttribute["array"] | null;
  capacity: number;
  supported: boolean;
  drawGeometry?: BufferGeometry;
  packedMatrix?: InstanceAttribute;
  packedColor?: InstanceAttribute | null;
  packedPreviousMatrix?: InstanceAttribute | null;
  geometryAttributes: GeometryInstanceAttribute[];
};

type MeshRestoreState = {
  mesh: InstancedMesh;
  geometry: BufferGeometry;
  instanceMatrix: InstanceAttribute;
  instanceColor: InstanceAttribute | null;
  previousInstanceMatrix: InstanceAttribute | null;
  count: number;
};

type MeshWithPreviousMatrix = InstancedMesh & {
  previousInstanceMatrix?: InstanceAttribute | null;
  morphTexture?: unknown;
};

const MATRIX_SENTINEL = "__musicInstanceDrawListMatrix";
const COLOR_SENTINEL = "__musicInstanceDrawListColor";
const PREVIOUS_MATRIX_SENTINEL = "__musicInstanceDrawListPreviousMatrix";

function asInstanceAttribute(value: unknown): InstanceAttribute | null {
  if (!value || typeof value !== "object") return null;
  const attribute = value as InstanceAttribute;
  return attribute.isInstancedBufferAttribute === true ? attribute : null;
}

function sourceAttributeSignature(geometry: BufferGeometry): GeometryAttributeSignature[] {
  const signature: GeometryAttributeSignature[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const candidate = attribute as {
      array?: unknown;
      version?: number;
      isInstancedBufferAttribute?: boolean;
      isInterleavedBufferAttribute?: boolean;
      data?: { array?: unknown; version?: number };
    };
    const array = candidate.array ?? candidate.data?.array;
    const version = candidate.isInstancedBufferAttribute
      ? null
      : candidate.isInterleavedBufferAttribute
        ? candidate.data?.version ?? 0
        : candidate.version ?? 0;
    signature.push([name, attribute, array, version]);
  }
  return signature;
}

function makePackedAttribute(source: InstanceAttribute, capacity: number): InstanceAttribute | null {
  if (!Number.isInteger(source.meshPerAttribute) || source.meshPerAttribute !== 1) return null;
  if (!Number.isInteger(source.itemSize) || source.itemSize < 1 || source.count < capacity) return null;
  const ArrayType = source.array.constructor as new (length: number) => InstanceAttribute["array"];
  let array: InstanceAttribute["array"];
  try {
    array = new ArrayType(capacity * source.itemSize);
  } catch {
    return null;
  }
  const packed = new InstancedBufferAttribute(array as never, source.itemSize, source.normalized, 1) as InstanceAttribute;
  packed.name = source.name;
  packed.setUsage(DynamicDrawUsage);
  packed.gpuType = source.gpuType;
  return packed;
}

function copyPackedAttribute(
  source: InstanceAttribute,
  packed: InstanceAttribute,
  slots: readonly number[],
): void {
  const itemSize = source.itemSize;
  for (let drawIndex = 0; drawIndex < slots.length; drawIndex += 1) {
    const sourceOffset = slots[drawIndex] * itemSize;
    const destinationOffset = drawIndex * itemSize;
    for (let component = 0; component < itemSize; component += 1) {
      packed.array[destinationOffset + component] = source.array[sourceOffset + component];
    }
  }
  packed.clearUpdateRanges();
  if (slots.length > 0) packed.addUpdateRange(0, slots.length * itemSize);
  packed.needsUpdate = true;
}

function uniqueAttributeName(geometry: BufferGeometry, base: string): string {
  let name = base;
  let suffix = 0;
  while (geometry.getAttribute(name)) name = `${base}${++suffix}`;
  return name;
}

function hasUnsupportedInterleavedInstanceAttribute(geometry: BufferGeometry): boolean {
  return Object.values(geometry.attributes).some((attribute) => {
    const candidate = attribute as { isInterleavedBufferAttribute?: boolean; data?: { isInstancedInterleavedBuffer?: boolean } };
    return candidate.isInterleavedBufferAttribute === true && candidate.data?.isInstancedInterleavedBuffer === true;
  });
}

function isPrefix(slots: readonly number[], count: number): boolean {
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] !== index) return false;
  }
  return slots.length <= count;
}

/**
 * Temporarily packs nonzero logical instances into the draw prefix. The source
 * meshes remain the authoritative logical pool after every render callback.
 */
export class MusicInstanceDrawList {
  enabled = true;

  private readonly buffers = new Map<InstancedMesh, MeshBuffers>();
  private rendering = false;

  render(
    meshes: readonly InstancedMesh[],
    slots: readonly number[] | ((mesh: InstancedMesh) => readonly number[]),
    render: () => void,
  ): void {
    if (this.rendering) {
      render();
      return;
    }

    const uniqueMeshes = [...new Set(meshes)];
    this.prune(uniqueMeshes);
    if (!this.enabled) {
      render();
      return;
    }
    const restore: MeshRestoreState[] = [];
    this.rendering = true;
    try {
      for (const mesh of uniqueMeshes) {
        if (!mesh.visible) continue;
        const meshSlots = typeof slots === "function" ? slots(mesh) : slots;
        const logicalCount = mesh.count;
        if (!this.validSlots(meshSlots, logicalCount, mesh.instanceMatrix.count)) continue;
        if (meshSlots.length === logicalCount && isPrefix(meshSlots, logicalCount)) continue;

        restore.push({
          mesh,
          geometry: mesh.geometry,
          instanceMatrix: mesh.instanceMatrix as InstanceAttribute,
          instanceColor: mesh.instanceColor as InstanceAttribute | null,
          previousInstanceMatrix: asInstanceAttribute((mesh as MeshWithPreviousMatrix).previousInstanceMatrix),
          count: mesh.count,
        });

        if (meshSlots.length === 0 || isPrefix(meshSlots, logicalCount)) {
          mesh.count = meshSlots.length;
          continue;
        }

        const buffers = this.getBuffers(mesh);
        if (!buffers?.supported || !buffers.drawGeometry || !buffers.packedMatrix) continue;

        copyPackedAttribute(buffers.sourceMatrix, buffers.packedMatrix, meshSlots);
        if (buffers.sourceColor && buffers.packedColor)
          copyPackedAttribute(buffers.sourceColor, buffers.packedColor, meshSlots);
        if (buffers.sourcePreviousMatrix && buffers.packedPreviousMatrix)
          copyPackedAttribute(buffers.sourcePreviousMatrix, buffers.packedPreviousMatrix, meshSlots);
        for (const attribute of buffers.geometryAttributes)
          copyPackedAttribute(attribute.source, attribute.packed, meshSlots);

        mesh.geometry = buffers.drawGeometry;
        mesh.instanceMatrix = buffers.packedMatrix;
        mesh.instanceColor = buffers.packedColor ?? null;
        const meshWithPrevious = mesh as MeshWithPreviousMatrix;
        if (buffers.packedPreviousMatrix) meshWithPrevious.previousInstanceMatrix = buffers.packedPreviousMatrix;
        mesh.count = meshSlots.length;
      }

      render();
    } finally {
      for (let index = restore.length - 1; index >= 0; index -= 1) {
        const state = restore[index];
        state.mesh.geometry = state.geometry;
        state.mesh.instanceMatrix = state.instanceMatrix;
        state.mesh.instanceColor = state.instanceColor;
        const meshWithPrevious = state.mesh as MeshWithPreviousMatrix;
        if (meshWithPrevious.previousInstanceMatrix !== undefined)
          meshWithPrevious.previousInstanceMatrix = state.previousInstanceMatrix;
        state.mesh.count = state.count;
      }
      this.rendering = false;
    }
  }

  dispose(): void {
    if (this.rendering) throw new Error("Cannot dispose the instance draw list during rendering.");
    for (const buffers of this.buffers.values()) this.disposeBuffers(buffers);
    this.buffers.clear();
  }

  private validSlots(slots: readonly number[], logicalCount: number, capacity: number): boolean {
    if (slots.length > capacity) return false;
    return slots.every((slot) => Number.isInteger(slot) && slot >= 0 && slot < logicalCount);
  }

  private prune(meshes: readonly InstancedMesh[]): void {
    const active = new Set(meshes);
    for (const [mesh, buffers] of this.buffers) {
      if (!active.has(mesh)) {
        this.disposeBuffers(buffers);
        this.buffers.delete(mesh);
      }
    }
  }

  private getBuffers(mesh: InstancedMesh): MeshBuffers | null {
    const geometry = mesh.geometry;
    const matrix = mesh.instanceMatrix as InstanceAttribute;
    const color = mesh.instanceColor as InstanceAttribute | null;
    const previousMatrix = asInstanceAttribute((mesh as MeshWithPreviousMatrix).previousInstanceMatrix);
    const capacity = matrix.count;
    const signature = sourceAttributeSignature(geometry);
    const indexVersion = geometry.index?.version ?? null;
    let buffers = this.buffers.get(mesh);

    if (buffers && (
      buffers.sourceGeometry !== geometry ||
      buffers.sourceIndex !== geometry.index ||
      buffers.sourceIndexVersion !== indexVersion ||
      buffers.sourceMatrix !== matrix ||
      buffers.sourceMatrixArray !== matrix.array ||
      buffers.sourceColor !== color ||
      buffers.sourceColorArray !== (color?.array ?? null) ||
      buffers.sourcePreviousMatrix !== previousMatrix ||
      buffers.sourcePreviousMatrixArray !== (previousMatrix?.array ?? null) ||
      buffers.capacity !== capacity ||
      signature.length !== buffers.sourceAttributes.length ||
      signature.some((entry, index) => entry[0] !== buffers!.sourceAttributes[index][0] ||
        entry[1] !== buffers!.sourceAttributes[index][1] ||
        entry[2] !== buffers!.sourceAttributes[index][2] ||
        entry[3] !== buffers!.sourceAttributes[index][3])
    )) {
      this.disposeBuffers(buffers);
      this.buffers.delete(mesh);
      buffers = undefined;
    }

    if (buffers) return buffers.supported ? buffers : null;

    const next = this.createBuffers(mesh, signature);
    this.buffers.set(mesh, next);
    return next.supported ? next : null;
  }

  private createBuffers(mesh: InstancedMesh, signature: GeometryAttributeSignature[]): MeshBuffers {
    const sourceGeometry = mesh.geometry;
    const sourceMatrix = mesh.instanceMatrix as InstanceAttribute;
    const sourceColor = mesh.instanceColor as InstanceAttribute | null;
    const sourcePreviousMatrix = asInstanceAttribute((mesh as MeshWithPreviousMatrix).previousInstanceMatrix);
    const capacity = sourceMatrix.count;
    const base: MeshBuffers = {
      sourceGeometry,
      sourceIndex: sourceGeometry.index,
      sourceIndexVersion: sourceGeometry.index?.version ?? null,
      sourceAttributes: signature,
      sourceMatrix,
      sourceMatrixArray: sourceMatrix.array,
      sourceColor,
      sourceColorArray: sourceColor?.array ?? null,
      sourcePreviousMatrix,
      sourcePreviousMatrixArray: sourcePreviousMatrix?.array ?? null,
      capacity,
      supported: false,
      geometryAttributes: [],
    };

    const meshWithPrevious = mesh as MeshWithPreviousMatrix;
    if (meshWithPrevious.morphTexture) return base;
    if (hasUnsupportedInterleavedInstanceAttribute(sourceGeometry)) return base;

    const packedMatrix = makePackedAttribute(sourceMatrix, capacity);
    if (!packedMatrix) return base;
    const packedColor = sourceColor ? makePackedAttribute(sourceColor, capacity) : null;
    if (sourceColor && !packedColor) return base;
    const packedPreviousMatrix = sourcePreviousMatrix ? makePackedAttribute(sourcePreviousMatrix, capacity) : null;
    if (sourcePreviousMatrix && !packedPreviousMatrix) return base;

    const drawGeometry = sourceGeometry.clone();
    const geometryAttributes: GeometryInstanceAttribute[] = [];
    for (const [name, sourceAttribute] of Object.entries(sourceGeometry.attributes)) {
      const instanceAttribute = asInstanceAttribute(sourceAttribute);
      if (!instanceAttribute) continue;
      const packed = makePackedAttribute(instanceAttribute, capacity);
      if (!packed) {
        drawGeometry.dispose();
        return base;
      }
      geometryAttributes.push({ name, source: instanceAttribute, packed });
      drawGeometry.setAttribute(name, packed);
    }

    drawGeometry.setAttribute(uniqueAttributeName(drawGeometry, MATRIX_SENTINEL), packedMatrix);
    if (packedColor)
      drawGeometry.setAttribute(uniqueAttributeName(drawGeometry, COLOR_SENTINEL), packedColor);
    if (packedPreviousMatrix)
      drawGeometry.setAttribute(uniqueAttributeName(drawGeometry, PREVIOUS_MATRIX_SENTINEL), packedPreviousMatrix);

    return {
      ...base,
      supported: true,
      drawGeometry,
      packedMatrix,
      packedColor,
      packedPreviousMatrix,
      geometryAttributes,
    };
  }

  private disposeBuffers(buffers: MeshBuffers): void {
    buffers.drawGeometry?.dispose();
  }
}
