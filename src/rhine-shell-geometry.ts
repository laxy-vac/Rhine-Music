import * as THREE from "three";

export const RHINE_LABEL_SHIFT_X = 2.78;

/** Relocate the original label as a unit, leaving the lower ornaments in place. */
export function relocateRhineLabelGeometry(geometry: THREE.BufferGeometry, surface: string): THREE.BufferGeometry {
  const wholeLabel = surface === "Printed_Label" || surface === "Carbon_Ink";
  if (!wholeLabel && surface !== "Internal_Ceramic") return geometry;
  const position = geometry.getAttribute("position");
  for (let vertex = 0; vertex < position.count; vertex++) {
    const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
    const labelGlyph = x >= -1.9 && x <= -.8 && y >= 2.8 && y <= 3.3 && z > .2;
    if (wholeLabel || labelGlyph) position.setX(vertex, x + RHINE_LABEL_SHIFT_X);
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

type AttributeReader = {
  count: number;
  itemSize: number;
  normalized: boolean;
  name: string;
  usage: number;
  isInstancedBufferAttribute?: boolean;
  meshPerAttribute?: number;
  isInterleavedBufferAttribute?: boolean;
  offset?: number;
  array?: ArrayLike<number>;
  data?: { array: ArrayLike<number>; stride: number };
  getComponent?: (index: number, component: number) => number;
  getX: (index: number) => number;
  getY: (index: number) => number;
  getZ: (index: number) => number;
  getW: (index: number) => number;
};

function normalizedValue(value: number, array: ArrayLike<number>): number {
  if (array instanceof Int8Array) return Math.max(value / 127, -1);
  if (array instanceof Uint8Array || array instanceof Uint8ClampedArray) return value / 255;
  if (array instanceof Int16Array) return Math.max(value / 32767, -1);
  if (array instanceof Uint16Array) return value / 65535;
  if (array instanceof Int32Array) return Math.max(value / 2147483647, -1);
  if (array instanceof Uint32Array) return value / 4294967295;
  return value;
}

function componentValue(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number, component: number): number {
  const reader = attribute as unknown as AttributeReader;
  if (reader.getComponent) return reader.getComponent(index, component);
  if (component === 0) return reader.getX(index);
  if (component === 1) return reader.getY(index);
  if (component === 2) return reader.getZ(index);
  if (component === 3) return reader.getW(index);

  const array = reader.isInterleavedBufferAttribute ? reader.data!.array : reader.array!;
  const stride = reader.isInterleavedBufferAttribute ? reader.data!.stride : reader.itemSize;
  const offset = reader.isInterleavedBufferAttribute ? reader.offset ?? 0 : 0;
  const value = array[index * stride + offset + component];
  return reader.normalized ? normalizedValue(value, array) : value;
}

function shouldRetainTriangle(surface: string, points: readonly (readonly number[])[]): boolean {
  if (surface === "Internal_Ceramic") return points.every(point => point[2] >= 0);
  if (surface === "Optical_Edges")
    return points.every(([x, y]) => y < 0.7 || y > 3.6 || Math.abs(x) > 2.3);
  return true;
}

function copyAttribute(
  source: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  sourceVertices: readonly number[],
): THREE.BufferAttribute {
  const values = new Float32Array(sourceVertices.length * source.itemSize);
  for (let outVertex = 0; outVertex < sourceVertices.length; outVertex++) {
    for (let component = 0; component < source.itemSize; component++) {
      values[outVertex * source.itemSize + component] = componentValue(source, sourceVertices[outVertex], component);
    }
  }

  const reader = source as unknown as AttributeReader;
  const result = reader.isInstancedBufferAttribute
    ? new THREE.InstancedBufferAttribute(values, source.itemSize, false, reader.meshPerAttribute ?? 1)
    : new THREE.BufferAttribute(values, source.itemSize, false);
  result.name = reader.name;
  result.setUsage(reader.usage as Parameters<typeof result.setUsage>[0]);
  return result;
}

function sourceElementVertex(geometry: THREE.BufferGeometry, element: number): number {
  return geometry.getIndex()?.getX(element) ?? element;
}

function drawRanges(geometry: THREE.BufferGeometry, elementCount: number) {
  const drawStart = Math.max(0, geometry.drawRange.start);
  const drawEnd = Math.min(elementCount, Number.isFinite(geometry.drawRange.count)
    ? drawStart + geometry.drawRange.count
    : elementCount);
  const sourceGroups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: elementCount, materialIndex: 0 }];

  return sourceGroups.map(group => ({
    materialIndex: group.materialIndex,
    start: Math.ceil(Math.max(drawStart, group.start) / 3) * 3,
    end: Math.min(drawEnd, group.start + group.count),
  }));
}

/** Filter the Rhine source's internal optical islands without changing its other shell details. */
export function filterRhineShellGeometry(
  geometry: THREE.BufferGeometry,
  surface: string,
): THREE.BufferGeometry {
  if (surface !== "Internal_Ceramic" && surface !== "Optical_Edges") return geometry;
  const position = geometry.getAttribute("position");
  if (!position) return geometry;

  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  const retainedIndices: number[] = [];
  const compactSourceVertices: number[] = [];
  const compactIndexBySourceVertex = new Map<number, number>();
  const outputGroups: { start: number; count: number; materialIndex: number }[] = [];

  for (const range of drawRanges(geometry, elementCount)) {
    const groupStart = retainedIndices.length;
    for (let element = range.start; element + 2 < range.end; element += 3) {
      const sourceVertices = [
        sourceElementVertex(geometry, element),
        sourceElementVertex(geometry, element + 1),
        sourceElementVertex(geometry, element + 2),
      ];
      const points = sourceVertices.map(vertex => [
        componentValue(position, vertex, 0),
        componentValue(position, vertex, 1),
        componentValue(position, vertex, 2),
      ]);
      if (!shouldRetainTriangle(surface, points)) continue;

      for (const sourceVertex of sourceVertices) {
        let compactVertex = compactIndexBySourceVertex.get(sourceVertex);
        if (compactVertex === undefined) {
          compactVertex = compactSourceVertices.length;
          compactIndexBySourceVertex.set(sourceVertex, compactVertex);
          compactSourceVertices.push(sourceVertex);
        }
        retainedIndices.push(compactVertex);
      }
    }
    const count = retainedIndices.length - groupStart;
    if (geometry.groups.length && count > 0)
      outputGroups.push({ start: groupStart, count, materialIndex: range.materialIndex ?? 0 });
  }

  const output = new THREE.BufferGeometry();
  output.name = geometry.name;
  output.userData = { ...geometry.userData };
  output.morphTargetsRelative = geometry.morphTargetsRelative;
  for (const [name, attribute] of Object.entries(geometry.attributes))
    output.setAttribute(name, copyAttribute(attribute, compactSourceVertices));
  const morphAttributes = output.morphAttributes as Record<string, THREE.BufferAttribute[]>;
  for (const [name, attributes] of Object.entries(geometry.morphAttributes))
    morphAttributes[name] = attributes.map(attribute => copyAttribute(attribute, compactSourceVertices));

  const compactIndexArray = compactSourceVertices.length > 65535
    ? new Uint32Array(retainedIndices)
    : new Uint16Array(retainedIndices);
  output.setIndex(new THREE.BufferAttribute(compactIndexArray, 1));
  for (const group of outputGroups) output.addGroup(group.start, group.count, group.materialIndex);
  output.setDrawRange(0, retainedIndices.length);

  if (compactSourceVertices.length > 0) {
    output.computeBoundingBox();
    output.computeBoundingSphere();
  } else {
    output.boundingBox = new THREE.Box3();
    output.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
  }
  return output;
}
