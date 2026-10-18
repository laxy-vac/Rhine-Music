import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';

function sourceModule(path) {
  const url = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const code = outputText.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) =>
    'from ' + JSON.stringify(specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)));
  return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
}

const { MusicSharedDepthBokehPass } = await import(sourceModule('../src/music-shared-depth-bokeh.ts'));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 2, 0.5, 100);
const highLayer = 1 << 31;
camera.layers.mask = 1 | highLayer;
const originalBackground = new THREE.Color('#253647');
const originalOverride = new THREE.MeshBasicMaterial({ color: '#8a7462' });
scene.background = originalBackground;
scene.overrideMaterial = originalOverride;

const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
const highLayerMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
highLayerMesh.layers.mask = highLayer;
const points = new THREE.Points(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -2)]),
  new THREE.PointsMaterial({ size: 1 }),
);
const line = new THREE.Line(
  new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 0, -1)]),
  new THREE.LineBasicMaterial(),
);
const hiddenParent = new THREE.Group();
const hiddenPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
hiddenParent.visible = false;
hiddenParent.add(hiddenPoints);
scene.add(mesh, highLayerMesh, points, line, hiddenParent);

const pass = new MusicSharedDepthBokehPass(scene, camera, { focus: 25, aperture: 0.0018, maxblur: 0.011 });
pass.setSize(64, 32);
const sharedTarget = new THREE.WebGLRenderTarget(64, 32);
sharedTarget.depthTexture = new THREE.DepthTexture(64, 32);
const mismatchedTarget = new THREE.WebGLRenderTarget(32, 32);
mismatchedTarget.depthTexture = new THREE.DepthTexture(32, 32);
const writeBuffer = new THREE.WebGLRenderTarget(64, 32);
const readBuffer = new THREE.WebGLRenderTarget(64, 32);
const previousTarget = new THREE.WebGLRenderTarget(8, 8);
const depthTextureBefore = pass.uniforms.tDepth.value;
const depthMaterial = pass.depthMaterial;
const originalCameraMask = camera.layers.mask;
const originalMeshMask = mesh.layers.mask;
const originalHighLayerMeshMask = highLayerMesh.layers.mask;
const originalPointsMask = points.layers.mask;
const originalLineMask = line.layers.mask;
const originalHiddenParentMask = hiddenParent.layers.mask;
const originalHiddenPointsMask = hiddenPoints.layers.mask;

let currentTarget = previousTarget;
let clearCount = 0;
let sceneRenderCount = 0;
let failDepthRender = false;
let inspectDepthState = true;
const renderer = {
  autoClear: true,
  getRenderTarget() { return currentTarget; },
  setRenderTarget(target) { currentTarget = target; },
  clear() { clearCount++; },
  getClearColor(target) { return target.set('#121b24'); },
  getClearAlpha() { return 0.75; },
  setClearColor() {},
  setClearAlpha() {},
  render(object, renderCamera) {
    if (object !== scene) return;
    sceneRenderCount++;
    if (inspectDepthState) {
      assert.strictEqual(renderCamera, camera);
      assert.strictEqual(currentTarget, sharedTarget, 'Point/line depth appends to the AO render target');
      assert.equal(this.autoClear, false, 'The existing AO color/depth is not cleared');
      assert.equal(scene.background, null, 'A background cannot force a render-target clear');
      assert.strictEqual(scene.overrideMaterial, depthMaterial);
      assert.equal(depthMaterial.colorWrite, false, 'The AO normal color texture remains intact');
      assert.equal(depthMaterial.depthWrite, true, 'Depth geometry contributes to the shared depth texture');
      assert.equal(camera.layers.mask, highLayer);
      assert.equal(points.layers.mask, highLayer);
      assert.equal(line.layers.mask, highLayer);
      assert.equal(mesh.layers.mask, 0, 'Ordinary meshes are excluded from the append pass');
      assert.equal(highLayerMesh.layers.mask, 0, 'A mesh originally on bit 31 is excluded too');
      assert.equal(hiddenParent.layers.mask, 0);
      assert.equal(hiddenPoints.layers.mask, 0);
      assert.equal(hiddenParent.visible, false, 'An invisible parent remains invisible');
    }
    if (failDepthRender) throw new Error('mock depth append failure');
  },
};

pass.setDepthSource(() => ({ target: sharedTarget, eligible: true }));
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(pass.reuseEnabled, true);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 0,
  'A valid shared depth texture uses its scalar depth channel');
assert.strictEqual(pass.uniforms.tDepth.value, depthTextureBefore,
  'The borrowed depth texture uniform is restored after compositing');
assert.strictEqual(pass.uniforms.tColor.value, readBuffer.texture);
assert.equal(pass.uniforms.nearClip.value, camera.near);
assert.equal(pass.uniforms.farClip.value, camera.far);
assert.equal(sceneRenderCount, 1, 'Points and lines add one depth-only scene render');
assert.equal(clearCount, 1, 'Only the normal Bokeh composite target is cleared');
assert.strictEqual(currentTarget, writeBuffer, 'The shared path writes the ordinary Bokeh composite');
assert.equal(renderer.autoClear, true);
assert.strictEqual(scene.background, originalBackground);
assert.strictEqual(scene.overrideMaterial, originalOverride);
assert.equal(depthMaterial.colorWrite, true);
assert.equal(depthMaterial.depthWrite, true);
assert.equal(camera.layers.mask, originalCameraMask);
assert.equal(mesh.layers.mask, originalMeshMask);
assert.equal(highLayerMesh.layers.mask, originalHighLayerMeshMask);
assert.equal(points.layers.mask, originalPointsMask);
assert.equal(line.layers.mask, originalLineMask);
assert.equal(hiddenParent.layers.mask, originalHiddenParentMask);
assert.equal(hiddenPoints.layers.mask, originalHiddenPointsMask);

// Exceptions during the point/line append still restore the renderer and scene.
currentTarget = previousTarget;
failDepthRender = true;
assert.throws(() => pass.render(renderer, writeBuffer, readBuffer), /mock depth append failure/);
failDepthRender = false;
assert.strictEqual(currentTarget, previousTarget);
assert.equal(renderer.autoClear, true);
assert.strictEqual(scene.background, originalBackground);
assert.strictEqual(scene.overrideMaterial, originalOverride);
assert.equal(depthMaterial.colorWrite, true);
assert.equal(depthMaterial.depthWrite, true);
assert.equal(camera.layers.mask, originalCameraMask);
assert.equal(mesh.layers.mask, originalMeshMask);
assert.equal(highLayerMesh.layers.mask, originalHighLayerMeshMask);
assert.equal(points.layers.mask, originalPointsMask);
assert.equal(line.layers.mask, originalLineMask);
assert.equal(hiddenParent.layers.mask, originalHiddenParentMask);
assert.equal(hiddenPoints.layers.mask, originalHiddenPointsMask);
assert.strictEqual(pass.uniforms.tDepth.value, depthTextureBefore);

// With no visible Points/Lines, the shared path skips the extra scene render.
scene.remove(points, line);
sceneRenderCount = 0;
inspectDepthState = false;
currentTarget = previousTarget;
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(sceneRenderCount, 0);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 0);
assert.equal(hiddenParent.visible, false, 'Invisible parent contents do not trigger an empty scene render');

// Ineligible or mismatched depth falls back to the original packed BokehPass.
pass.setDepthSource(() => ({ target: mismatchedTarget, eligible: true }));
sceneRenderCount = 0;
currentTarget = previousTarget;
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 1,
  'A target with mismatched dimensions uses packed Bokeh depth');
assert.equal(sceneRenderCount, 1, 'The original BokehPass depth render is used on fallback');
assert.strictEqual(pass.uniforms.tDepth.value, depthTextureBefore);
assert.equal(renderer.autoClear, true);

pass.setDepthSource(() => ({ target: sharedTarget, eligible: true }));
sceneRenderCount = 0;
currentTarget = previousTarget;
pass.render(renderer, writeBuffer, mismatchedTarget);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 1,
  'A read buffer with mismatched dimensions also disables shared depth');
assert.equal(sceneRenderCount, 1);

pass.setDepthSource(() => ({ target: sharedTarget, eligible: false }));
sceneRenderCount = 0;
currentTarget = previousTarget;
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 1,
  'An ineligible scene uses the original packed-depth path');
assert.equal(sceneRenderCount, 1);

pass.reuseEnabled = false;
pass.setDepthSource(() => ({ target: sharedTarget, eligible: true }));
sceneRenderCount = 0;
currentTarget = previousTarget;
pass.render(renderer, writeBuffer, readBuffer);
assert.equal(pass.materialBokeh.defines.DEPTH_PACKING, 1,
  'Disabling reuse forces the original packed-depth path');
assert.equal(sceneRenderCount, 1);

pass.dispose();
sharedTarget.dispose();
mismatchedTarget.dispose();
writeBuffer.dispose();
readBuffer.dispose();
previousTarget.dispose();
originalOverride.dispose();
mesh.geometry.dispose();
mesh.material.dispose();
highLayerMesh.geometry.dispose();
highLayerMesh.material.dispose();
points.geometry.dispose();
points.material.dispose();
line.geometry.dispose();
line.material.dispose();
hiddenPoints.geometry.dispose();
hiddenPoints.material.dispose();
console.log('Music shared-depth Bokeh passed: validated shared depth, depth-only Points/Lines append, state restoration, no-extra-pass case, and packed-depth fallback.');
