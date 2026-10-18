import assert from "node:assert/strict";
import * as THREE from "three";
import { MusicPartDrawSlots } from "../src/music-part-draw-slots.ts";

function makeFrustum() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const projection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  return new THREE.Frustum().setFromProjectionMatrix(projection, camera.coordinateSystem);
}

function makeMesh(width = 1, material = new THREE.MeshBasicMaterial(), xs = [0]) {
  const geometry = new THREE.BoxGeometry(width, 0.6, 0.4);
  const mesh = new THREE.InstancedMesh(geometry, material, xs.length);
  mesh.count = xs.length;
  xs.forEach((x, index) => mesh.setMatrixAt(index, new THREE.Matrix4().makeTranslation(x, 0, 0)));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.updateMatrixWorld(true);
  return mesh;
}

const frustum = makeFrustum();
const helper = new MusicPartDrawSlots();
assert.equal(helper.enabled, true, "part filtering starts enabled for diagnostics");

const orderedSlots = [3, 2, 0, 1];
const part = makeMesh(1, new THREE.MeshBasicMaterial(), [0, -3, -1.53, 1.56]);
helper.beginFrame([part], orderedSlots, frustum);
const visible = helper.forMesh(part);
assert.deepEqual(Array.from(visible), [2, 0], "culling retains only intersecting parts in source order");
assert.equal(helper.forMesh(part), visible, "a mesh reuses the same filtered slots array");
assert.deepEqual(Array.from(visible), [2, 0], "the 0.04 world margin retains an edge-crossing part");

const small = makeMesh(0.2, new THREE.MeshBasicMaterial(), [1.53, 3]);
const wide = makeMesh(1, new THREE.MeshBasicMaterial(), [1.53, 3]);
const twoMeshSlots = [0, 1];
helper.beginFrame([wide, small], twoMeshSlots, frustum);
const wideSlots = helper.forMesh(wide);
const smallSlots = helper.forMesh(small);
assert.deepEqual(Array.from(wideSlots), [0], "the wide part's own bounds reach the frustum");
assert.deepEqual(Array.from(smallSlots), [], "the small part is culled using its own bounds");
assert.equal(helper.forMesh(small), smallSlots, "empty per-mesh results also keep a stable array");

const transformed = makeMesh(0.2, new THREE.MeshBasicMaterial(), [-2, 0]);
transformed.matrixAutoUpdate = false;
transformed.matrixWorld.makeTranslation(2, 0, 0);
transformed.matrixWorldNeedsUpdate = false;
helper.beginFrame([transformed], [0, 1], frustum);
assert.deepEqual(Array.from(helper.forMesh(transformed)), [0],
  "bounds use this mesh's matrixWorld multiplied by its per-slot instance matrix");

const moving = makeMesh(0.1, new THREE.MeshBasicMaterial(), [1.53]);
helper.beginFrame([moving], [0], frustum);
const movingSlots = helper.forMesh(moving);
assert.deepEqual(Array.from(movingSlots), [], "the initial small geometry is outside the frustum");
const position = moving.geometry.getAttribute("position");
position.setX(0, -0.6);
position.needsUpdate = true;
helper.beginFrame([moving], [0], frustum);
assert.equal(helper.forMesh(moving), movingSlots, "geometry refresh retains the per-mesh output array");
assert.deepEqual(Array.from(movingSlots), [0], "a position version change recomputes current bounds");
moving.geometry = new THREE.BoxGeometry(2, 0.2, 0.2);
helper.beginFrame([moving], [0], frustum);
assert.deepEqual(Array.from(helper.forMesh(moving)), [0], "geometry replacement recalculates bounds");

const knownCasePart = makeMesh(1, new THREE.MeshPhysicalMaterial(), [0]);
knownCasePart.geometry.setAttribute("caseRestPosition", knownCasePart.geometry.getAttribute("position").clone());
knownCasePart.userData.casePart = "cover";
knownCasePart.material.onBeforeCompile = () => {};
helper.beginFrame([knownCasePart], [0], frustum);
assert.deepEqual(Array.from(helper.forMesh(knownCasePart)), [0],
  "audited project case-part shader hooks remain eligible when caseRestPosition is present");

const unknownHook = makeMesh(1, new THREE.MeshBasicMaterial(), [0]);
unknownHook.material.onBeforeCompile = () => {};
const originalUnknownSlots = [0];
helper.beginFrame([unknownHook], originalUnknownSlots, frustum);
assert.equal(helper.forMesh(unknownHook), originalUnknownSlots,
  "unknown custom vertex hooks fall back to the original list");

const unknownShader = makeMesh(1, new THREE.ShaderMaterial(), [0]);
const originalShaderSlots = [0];
helper.beginFrame([unknownShader], originalShaderSlots, frustum);
assert.equal(helper.forMesh(unknownShader), originalShaderSlots,
  "unknown ShaderMaterial paths safely fall back");

const morph = makeMesh(1, new THREE.MeshBasicMaterial(), [0]);
morph.morphTexture = {};
const originalMorphSlots = [0];
helper.beginFrame([morph], originalMorphSlots, frustum);
assert.equal(helper.forMesh(morph), originalMorphSlots, "instanced morph textures fall back");

const displacedMaterial = new THREE.MeshPhysicalMaterial({ displacementMap: new THREE.DataTexture() });
const displaced = makeMesh(1, displacedMaterial, [0]);
const originalDisplacedSlots = [0];
helper.beginFrame([displaced], originalDisplacedSlots, frustum);
assert.equal(helper.forMesh(displaced), originalDisplacedSlots, "displacement maps fall back");

const nonfinite = new THREE.InstancedMesh(
  new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([Number.NaN, 0, 0], 3)),
  new THREE.MeshBasicMaterial(),
  1,
);
nonfinite.count = 1;
nonfinite.updateMatrixWorld(true);
const originalError = console.error;
console.error = () => {};
try {
  helper.beginFrame([nonfinite], [0], frustum);
  const originalNonfiniteSlots = [0];
  helper.beginFrame([nonfinite], originalNonfiniteSlots, frustum);
  assert.equal(helper.forMesh(nonfinite), originalNonfiniteSlots, "non-finite geometry bounds fall back");
} finally {
  console.error = originalError;
}

const invalidMatrix = makeMesh(1, new THREE.MeshBasicMaterial(), [0]);
const badMatrix = new THREE.Matrix4();
badMatrix.elements[12] = Number.NaN;
invalidMatrix.setMatrixAt(0, badMatrix);
helper.beginFrame([invalidMatrix], [0], frustum);
const originalInvalidMatrixSlots = [0];
helper.beginFrame([invalidMatrix], originalInvalidMatrixSlots, frustum);
assert.equal(helper.forMesh(invalidMatrix), originalInvalidMatrixSlots, "non-finite instance matrices fall back");

helper.enabled = false;
helper.beginFrame([part], orderedSlots, frustum);
assert.equal(helper.forMesh(part), orderedSlots, "diagnostic disable returns the original whole-box slots");
helper.dispose();

for (const mesh of [part, small, wide, transformed, moving, knownCasePart, unknownHook, unknownShader,
  morph, displaced, nonfinite, invalidMatrix]) {
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach(material => material.dispose());
  else mesh.material.dispose();
}

console.log("MusicPartDrawSlots pure checks passed.");
