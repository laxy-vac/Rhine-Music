import assert from "node:assert/strict";
import * as THREE from "three";
import { MusicInstanceShadows } from "../src/music-instance-shadows.ts";

function makeSource(name = "case pool") {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.setAttribute("logicalSlot", new THREE.InstancedBufferAttribute(
    new Float32Array([10, 11, 12, 13]), 1,
  ));
  const material = new THREE.MeshPhysicalMaterial();
  const source = new THREE.InstancedMesh(geometry, material, 4);
  source.name = name;
  source.castShadow = true;
  source.frustumCulled = false;
  source.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(Array.from({ length: 12 }, (_, index) => index + 1)), 3,
  );
  source.customDepthMaterial = new THREE.MeshDepthMaterial();
  source.customDistanceMaterial = new THREE.MeshDistanceMaterial();
  for (let index = 0; index < 4; index += 1) {
    source.setMatrixAt(index, new THREE.Matrix4().makeTranslation(index + 1, 2, 3));
  }
  source.instanceMatrix.needsUpdate = true;
  return { source, geometry, material };
}

const { source, geometry, material } = makeSource();
const scene = new THREE.Scene();
scene.add(source);
const camera = new THREE.PerspectiveCamera();
const light = new THREE.DirectionalLight();
let expectCopy = true;
let throwFromShadowRender = false;
let shadowRenderCalls = 0;
let capturedCopy;

const originalShadowRender = function (lights, renderScene, renderCamera) {
  assert.equal(this, shadowMap, "original render keeps its shadow-map receiver");
  assert.equal(renderScene, scene);
  assert.equal(renderCamera, camera);
  shadowRenderCalls += 1;

  const copies = renderScene.children.filter((child) => child.userData.musicInstanceShadowCopy);
  if (!expectCopy) {
    assert.equal(copies.length, 0);
    return;
  }

  assert.equal(source.visible, false, "only the original caster is hidden during shadow traversal");
  assert.equal(copies.length, 1);
  capturedCopy = copies[0];
  assert.equal(renderScene.children[renderScene.children.indexOf(source) + 1], capturedCopy,
    "copy is inserted immediately after its original to preserve traversal order");
  assert.equal(capturedCopy.visible, true);
  assert.equal(capturedCopy.castShadow, true);
  assert.equal(capturedCopy.count, 2, "shadow-only list uses the requested compact count");
  assert.equal(capturedCopy.geometry.getAttribute("logicalSlot").getX(0), 13);
  assert.equal(capturedCopy.geometry.getAttribute("logicalSlot").getX(1), 11);
  assert.equal(capturedCopy.instanceMatrix.array[12], 4);
  assert.equal(capturedCopy.instanceMatrix.array[16 + 12], 2);
  assert.deepEqual(Array.from(capturedCopy.instanceColor.array.slice(0, 6)), [10, 11, 12, 4, 5, 6]);
  assert.equal(capturedCopy.material, source.material);
  assert.equal(capturedCopy.customDepthMaterial, source.customDepthMaterial);
  assert.equal(capturedCopy.customDistanceMaterial, source.customDistanceMaterial);
  assert.equal(capturedCopy.layers.mask, source.layers.mask);
  assert.equal(capturedCopy.matrixAutoUpdate, false);
  assert.equal(capturedCopy.matrixWorldAutoUpdate, false);
  assert.deepEqual(capturedCopy.matrixWorld.elements, source.matrixWorld.elements);
  if (throwFromShadowRender) throw new Error("intentional shadow failure");
};

const shadowMap = {
  enabled: true,
  autoUpdate: false,
  needsUpdate: true,
  render: originalShadowRender,
};
const renderer = { shadowMap };
const shadows = new MusicInstanceShadows();
const sourceMatrix = source.instanceMatrix;
const sourceColor = source.instanceColor;

shadows.render(renderer, scene, [source], [3, 1], () => {
  assert.equal(source.visible, true, "source remains visible before the shadow pass");
  assert.notEqual(shadowMap.render, originalShadowRender, "shadow renderer is wrapped only around this render");
  shadowMap.render([light], scene, camera);
});
assert.equal(shadowMap.render, originalShadowRender, "shadow renderer method is restored");
assert.equal(source.visible, true, "original visibility is restored after shadow rendering");
assert.deepEqual(scene.children, [source], "temporary copies are removed and child order is restored");
assert.equal(source.instanceMatrix, sourceMatrix, "source matrix buffer is never swapped");
assert.equal(source.instanceColor, sourceColor, "source color buffer is never swapped");
assert.equal(source.count, 4);
assert.equal(shadowRenderCalls, 1);
let copyDisposed = false;
capturedCopy.addEventListener("dispose", () => { copyDisposed = true; });

throwFromShadowRender = true;
assert.throws(() => shadows.render(renderer, scene, [source], [3, 1], () => {
  shadowMap.render([light], scene, camera);
}), /intentional shadow failure/);
assert.equal(shadowMap.render, originalShadowRender, "exception restores the shadow renderer method");
assert.equal(source.visible, true, "exception restores the source visibility");
assert.deepEqual(scene.children, [source], "exception removes the temporary copy");
assert.equal(source.instanceMatrix, sourceMatrix);
assert.equal(source.instanceColor, sourceColor);

throwFromShadowRender = false;
shadowMap.enabled = false;
expectCopy = false;
shadows.render(renderer, scene, [source], [3, 1], () => {
  assert.equal(shadowMap.render, originalShadowRender, "disabled shadows bypass the wrapper");
  shadowMap.render([light], scene, camera);
  assert.equal(source.visible, true);
});
assert.equal(scene.children.length, 1);

shadowMap.enabled = true;
shadowMap.needsUpdate = false;
shadows.render(renderer, scene, [source], [3, 1], () => {
  assert.equal(shadowMap.render, originalShadowRender, "clean cached shadows bypass the wrapper");
  shadowMap.render([light], scene, camera);
});

shadowMap.needsUpdate = true;
const nonCaster = makeSource("noncaster");
nonCaster.source.castShadow = false;
scene.add(nonCaster.source);
shadows.render(renderer, scene, [nonCaster.source], [3, 1], () => {
  assert.equal(shadowMap.render, originalShadowRender, "noncasters do not create shadow copies");
  shadowMap.render([light], scene, camera);
});
assert.equal(nonCaster.source.visible, true);
scene.remove(nonCaster.source);

shadows.render(renderer, scene, [], [3, 1], () => {});
assert.equal(copyDisposed, true, "removing a source prunes and disposes its copy");
assert.deepEqual(scene.children, [source]);

let sourceGeometryDisposed = false;
let sourceMaterialDisposed = false;
geometry.addEventListener("dispose", () => { sourceGeometryDisposed = true; });
material.addEventListener("dispose", () => { sourceMaterialDisposed = true; });
shadows.dispose();
assert.equal(sourceGeometryDisposed, false, "shadow helper never disposes shared source geometry");
assert.equal(sourceMaterialDisposed, false, "shadow helper never disposes shared source material");

for (const fixture of [{ source, geometry, material }, nonCaster]) {
  fixture.source.removeFromParent();
  fixture.source.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
}

console.log("MusicInstanceShadows pure checks passed.");
