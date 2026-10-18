import assert from "node:assert/strict";
import * as THREE from "three";
import { MusicInstanceDrawList } from "../src/music-instance-draw-list.ts";

function makeMesh(capacity = 4) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const logicalAttribute = new THREE.InstancedBufferAttribute(
    new Float32Array(Array.from({ length: capacity }, (_, index) => 10 + index)),
    1,
  );
  geometry.setAttribute("logicalSlot", logicalAttribute);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), capacity);
  mesh.name = "draw-list-test";
  mesh.count = capacity;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(Array.from({ length: capacity * 3 }, (_, index) => index + 1)),
    3,
  );
  for (let index = 0; index < capacity; index += 1) {
    const matrix = new THREE.Matrix4().makeTranslation(index + 1, 0, 0);
    mesh.setMatrixAt(index, matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, geometry, logicalAttribute, matrix: mesh.instanceMatrix, color: mesh.instanceColor };
}

const helper = new MusicInstanceDrawList();
const { mesh, geometry, logicalAttribute, matrix, color } = makeMesh();
const originalLogicalValues = Array.from(logicalAttribute.array);
let drawGeometry;
let drawMatrix;
let drawColor;

helper.render([mesh], [3, 1], () => {
  assert.notEqual(mesh.geometry, geometry, "non-prefix slots use a per-mesh geometry clone");
  assert.notEqual(mesh.instanceMatrix, matrix);
  assert.notEqual(mesh.instanceColor, color);
  assert.equal(mesh.count, 2);
  drawGeometry = mesh.geometry;
  drawMatrix = mesh.instanceMatrix;
  drawColor = mesh.instanceColor;

  const packedLogical = mesh.geometry.getAttribute("logicalSlot");
  assert.equal(packedLogical.getX(0), 13);
  assert.equal(packedLogical.getX(1), 11);
  assert.equal(mesh.instanceMatrix.array[12], 4);
  assert.equal(mesh.instanceMatrix.array[16 + 12], 2);
  assert.deepEqual(Array.from(mesh.instanceColor.array.slice(0, 6)), [10, 11, 12, 4, 5, 6]);
  assert.ok(Object.values(mesh.geometry.attributes).includes(mesh.instanceMatrix),
    "the packed matrix attribute is attached to its geometry for disposal");
  assert.ok(Object.values(mesh.geometry.attributes).includes(mesh.instanceColor),
    "the packed color attribute is attached to its geometry for disposal");
});

assert.equal(mesh.geometry, geometry, "finally restores the logical geometry");
assert.equal(mesh.instanceMatrix, matrix, "finally restores the logical matrix buffer");
assert.equal(mesh.instanceColor, color, "finally restores the logical color buffer");
assert.equal(mesh.count, 4, "finally restores the logical count");
assert.deepEqual(Array.from(logicalAttribute.array), originalLogicalValues,
  "packing never mutates atlas-owned logical slot attributes");

assert.throws(() => helper.render([mesh], [3, 1], () => {
  assert.notEqual(mesh.geometry, geometry);
  assert.equal(mesh.instanceMatrix, drawMatrix, "fixed-capacity packed matrix buffer is reused");
  assert.equal(mesh.instanceColor, drawColor, "fixed-capacity packed color buffer is reused");
  assert.equal(mesh.instanceMatrix.array.byteLength, matrix.array.byteLength,
    "packed buffer byte length stays fixed as draw count changes");
  throw new Error("intentional render failure");
}), /intentional render failure/);
assert.equal(mesh.geometry, geometry, "finally restores resources when render throws");
assert.equal(mesh.instanceMatrix, matrix);
assert.equal(mesh.instanceColor, color);
assert.equal(mesh.count, 4);

let disposedDrawGeometry = false;
drawGeometry.addEventListener("dispose", () => { disposedDrawGeometry = true; });

const prefixMesh = makeMesh();
let prefixClone;
helper.render([prefixMesh.mesh], [0, 1], () => {
  prefixClone = prefixMesh.mesh.geometry;
  assert.equal(prefixMesh.mesh.count, 2);
  assert.equal(prefixMesh.mesh.geometry, prefixMesh.geometry,
    "prefix packing only narrows count and does not clone geometry");
});
assert.equal(prefixMesh.mesh.geometry, prefixMesh.geometry);
assert.equal(prefixMesh.mesh.count, 4);
assert.equal(prefixClone, prefixMesh.geometry);
assert.equal(disposedDrawGeometry, true, "meshes no longer passed prune their GPU geometry resources");

let fullPrefixGeometry;
helper.render([prefixMesh.mesh], [0, 1, 2, 3], () => {
  fullPrefixGeometry = prefixMesh.mesh.geometry;
  assert.equal(prefixMesh.mesh.count, 4);
});
assert.equal(fullPrefixGeometry, prefixMesh.geometry, "full prefix remains untouched");

const hiddenMesh = makeMesh();
hiddenMesh.mesh.visible = false;
helper.render([hiddenMesh.mesh], [3, 1], () => {
  assert.equal(hiddenMesh.mesh.geometry, hiddenMesh.geometry);
  assert.equal(hiddenMesh.mesh.instanceMatrix, hiddenMesh.matrix);
  assert.equal(hiddenMesh.mesh.count, 4);
});

const groupedMesh = makeMesh();
groupedMesh.geometry.setAttribute("grouped", new THREE.InstancedBufferAttribute(
  new Float32Array([7, 8]), 1, false, 2,
));
helper.render([groupedMesh.mesh], [3, 1], () => {
  assert.equal(groupedMesh.mesh.geometry, groupedMesh.geometry,
    "meshPerAttribute groups safely fall back without changing draw semantics");
  assert.equal(groupedMesh.mesh.count, 4);
});

const staticMesh = makeMesh();
let originalStaticDrawGeometry;
helper.render([staticMesh.mesh], [3, 1], () => {
  originalStaticDrawGeometry = staticMesh.mesh.geometry;
});
let oldStaticGeometryDisposed = false;
originalStaticDrawGeometry.addEventListener("dispose", () => { oldStaticGeometryDisposed = true; });
const sourcePosition = staticMesh.geometry.getAttribute("position");
const nextPosition = sourcePosition.getX(0) + 2;
sourcePosition.setX(0, nextPosition);
sourcePosition.needsUpdate = true;
const sourceIndex = staticMesh.geometry.index;
const nextIndex = (sourceIndex.getX(0) + 1) % sourcePosition.count;
sourceIndex.setX(0, nextIndex);
sourceIndex.needsUpdate = true;
let refreshedStaticGeometry;
helper.render([staticMesh.mesh], [3, 1], () => {
  refreshedStaticGeometry = staticMesh.mesh.geometry;
  assert.notEqual(refreshedStaticGeometry, originalStaticDrawGeometry,
    "in-place static position/index updates refresh the packed clone");
  assert.equal(refreshedStaticGeometry.getAttribute("position").getX(0), nextPosition);
  assert.equal(refreshedStaticGeometry.index.getX(0), nextIndex);
});
assert.equal(oldStaticGeometryDisposed, true, "static version refresh releases the previous clone");

const perMeshA = makeMesh();
const perMeshB = makeMesh();
helper.render([perMeshA.mesh, perMeshB.mesh], (candidate) =>
  candidate === perMeshA.mesh ? [3, 1] : [2, 0], () => {
  assert.notEqual(perMeshA.mesh.geometry, perMeshA.geometry);
  assert.notEqual(perMeshB.mesh.geometry, perMeshB.geometry);
  assert.equal(perMeshA.mesh.count, 2);
  assert.equal(perMeshB.mesh.count, 2);
  assert.deepEqual(Array.from(perMeshA.mesh.geometry.getAttribute("logicalSlot").array.slice(0, 2)), [13, 11]);
  assert.deepEqual(Array.from(perMeshB.mesh.geometry.getAttribute("logicalSlot").array.slice(0, 2)), [12, 10]);
  assert.equal(perMeshA.mesh.instanceMatrix.array[12], 4);
  assert.equal(perMeshA.mesh.instanceMatrix.array[16 + 12], 2);
  assert.equal(perMeshB.mesh.instanceMatrix.array[12], 3);
  assert.equal(perMeshB.mesh.instanceMatrix.array[16 + 12], 1);
});
assert.equal(perMeshA.mesh.geometry, perMeshA.geometry, "per-mesh slot provider restores the first mesh");
assert.equal(perMeshB.mesh.geometry, perMeshB.geometry, "per-mesh slot provider restores the second mesh");
assert.equal(perMeshA.mesh.count, 4);
assert.equal(perMeshB.mesh.count, 4);

const mismatchB = makeMesh();
mismatchB.mesh.count = 3;
helper.render([perMeshA.mesh, mismatchB.mesh], (candidate) =>
  candidate === perMeshA.mesh ? [1, 0] : [3, 1], () => {
  assert.notEqual(perMeshA.mesh.geometry, perMeshA.geometry,
    "a per-mesh invalid slot range falls back only for that mesh");
  assert.equal(perMeshA.mesh.count, 2);
  assert.equal(mismatchB.mesh.geometry, mismatchB.geometry);
  assert.equal(mismatchB.mesh.count, 3);
});
assert.equal(perMeshA.mesh.geometry, perMeshA.geometry);
assert.equal(mismatchB.mesh.geometry, mismatchB.geometry);

const morphMesh = makeMesh();
morphMesh.mesh.morphTexture = {};
helper.render([morphMesh.mesh], [3, 1], () => {
  assert.equal(morphMesh.mesh.geometry, morphMesh.geometry,
    "per-instance morph textures safely fall back");
});

const replacementMesh = makeMesh();
let replacedDrawGeometry;
helper.render([replacementMesh.mesh], [3, 1], () => {
  replacedDrawGeometry = replacementMesh.mesh.geometry;
});
let replacementDisposed = false;
replacedDrawGeometry.addEventListener("dispose", () => { replacementDisposed = true; });
const replacementGeometry = new THREE.BoxGeometry(2, 2, 2);
replacementMesh.mesh.geometry = replacementGeometry;
helper.render([replacementMesh.mesh], [3, 1], () => {
  assert.notEqual(replacementMesh.mesh.geometry, replacementGeometry);
});
assert.equal(replacementDisposed, true, "replaced logical geometry prunes its old packed clone");
assert.equal(replacementMesh.mesh.geometry, replacementGeometry);

const disabledHelper = new MusicInstanceDrawList();
disabledHelper.enabled = false;
disabledHelper.render([mesh], [3, 1], () => {
  assert.equal(mesh.geometry, geometry);
  assert.equal(mesh.count, 4);
});
disabledHelper.dispose();

helper.dispose();
for (const item of [mesh, prefixMesh.mesh, hiddenMesh.mesh, groupedMesh.mesh, staticMesh.mesh,
  perMeshA.mesh, perMeshB.mesh, mismatchB.mesh, morphMesh.mesh, replacementMesh.mesh]) {
  item.geometry.dispose();
  item.material.dispose();
}

console.log("MusicInstanceDrawList pure checks passed.");
