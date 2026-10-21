import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as THREE from 'three';
import { createAlbumPrintMaterial } from '../src/music-model.ts';

// Transpile the small production TypeScript modules without changing the
// project environment. Runtime imports are resolved to the installed modules.
function sourceModule(path, overrides = {}) {
  const url = new URL(path, import.meta.url);
  const { outputText } = ts.transpileModule(fs.readFileSync(url, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  const code = outputText.replace(/from\s+(["'])([^"']+)\1/g, (_match, _quote, specifier) =>
    `from ${JSON.stringify(overrides[specifier] ?? (specifier.startsWith('.') ? new URL(specifier, url).href : import.meta.resolve(specifier)))}`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

const transitionUrl = sourceModule('../src/theme-transition.ts');
const { MusicSelectionLighting } = await import(sourceModule('../src/music-lighting.ts', {
  './theme-transition.ts': transitionUrl,
}));
const { createCaseIllumination } = await import(sourceModule('../src/case-illumination.ts'));

const finiteState = (state) => {
  assert.ok([...state.position, ...state.target, ...state.fillPosition,
    state.layoutProgress, state.transformUpdates].every(Number.isFinite), 'Lighting state stays finite');
};
const sameTransform = (a, b) => assert.deepEqual(
  { position: a.position, target: a.target, fillPosition: a.fillPosition },
  { position: b.position, target: b.target, fillPosition: b.fillPosition },
);
function originalCameraOffset(yawDegrees, elevationDegrees, local = new THREE.Vector3(-6, -2.2, 4.5).multiplyScalar(8)) {
  const yaw = THREE.MathUtils.degToRad(yawDegrees);
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const view = new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
  const camera = new THREE.PerspectiveCamera();
  camera.position.copy(view).multiplyScalar(140);
  camera.lookAt(0, 0, 0);
  return local.clone().applyQuaternion(camera.quaternion);
}
const approxVector = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual.length() - expected.length()) < epsilon, 'Vector magnitudes match');
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(actual.getComponent(i) - expected.getComponent(i)) < epsilon,
    `Vector component ${i} remains within ${epsilon}`);
};
const fixtureAim = (origin, layout) => origin.clone().add(new THREE.Vector3(
  layout.bounds.min[0] + 0.14, layout.center.y + layout.height * 0.12, layout.center.z,
));

const layout = {
  width: 4.45, height: 3.35, depth: 0.14,
  center: { x: 0, y: 1.85, z: 0 },
  bounds: { min: [-2.225, 0.175, -0.07], max: [2.225, 3.525, 0.07] },
};
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight('#ffffff', '#403020', 0.4);
const key = new THREE.DirectionalLight('#ffffff', 1);
const fill = new THREE.DirectionalLight('#ffffff', 0.3);
key.position.set(-6, 14, -5);
key.target.position.set(0, 0, 0);
fill.position.set(7, 8, -10);
fill.target.position.set(0, 0, 0);
key.castShadow = true;
fill.castShadow = false;
scene.add(hemi, key, key.target, fill, fill.target);
const existingLights = scene.children.filter((child) => child instanceof THREE.Light);
const keyPosition = key.position.clone();
const keyTarget = key.target.position.clone();
const fillPosition = fill.position.clone();
const fillTarget = fill.target.position.clone();
const keyShadow = key.castShadow;
const lighting = new MusicSelectionLighting(scene);
const addedLights = scene.children.filter((child) => child instanceof THREE.Light)
  .filter((child) => !existingLights.includes(child));
assert.equal(addedLights.length, 2, 'The existing diffuse key and fill are retained');
assert.strictEqual(addedLights[0], lighting.source);
const bounceLight = addedLights.find((light) => light !== lighting.source);
assert.ok(lighting.source instanceof THREE.SpotLight, 'The authored diffuse window key is retained');
assert.equal(lighting.source.castShadow, false, 'The diffuse source adds no shadow pass');
assert.ok(bounceLight instanceof THREE.PointLight, 'The original diffuse reflected fill is retained');
assert.equal(bounceLight.castShadow, false, 'The reflected fill adds no shadow pass');
assert.equal(scene.children.filter((child) => child instanceof THREE.SpotLight).length, 1);
assert.equal(scene.children.filter((child) => child instanceof THREE.PointLight).length, 1);
assert.equal(scene.children.filter((child) => child instanceof THREE.RectAreaLight).length, 0,
  'Wide reflections reuse the baked environment rather than costly per-fragment area integration');
assert.equal(lighting.state.fillVisible, false, 'The local fill starts hidden below full quality');
assert.equal(key.castShadow, keyShadow);
const allowedLights = [...existingLights, ...addedLights];
const assertMainLightsFixed = () => {
  assert.ok(key.position.equals(keyPosition) && key.target.position.equals(keyTarget),
    'The original directional key position and target stay fixed');
  assert.ok(fill.position.equals(fillPosition) && fill.target.position.equals(fillTarget),
    'The original directional fill position and target stay fixed');
  assert.equal(key.castShadow, keyShadow, 'The original directional shadow setting stays fixed');
};

const origin = new THREE.Vector3(2.25, -2.1, -1.4);
lighting.setWindow(0, origin, layout);
lighting.update(true);
const arrayState = structuredClone(lighting.state);
assert.equal(arrayState.type, 'SpotLight');
assert.equal(arrayState.fixedTo, 'selection-window');
assert.equal(arrayState.reflection, 'prefiltered-softbox');
assert.equal(arrayState.punctualSpecular, false);
assert.equal(arrayState.layoutProgress, 0);
assert.deepEqual(arrayState.target, fixtureAim(origin, layout).toArray());
assert.ok(new THREE.Vector3().fromArray(arrayState.position).sub(new THREE.Vector3().fromArray(arrayState.target))
  .distanceTo(originalCameraOffset(-38, 35)) < 1e-9,
  'ARRAY q=0 retains the original camera-local spot offset');
approxVector(new THREE.Vector3().fromArray(arrayState.fillPosition).sub(new THREE.Vector3().fromArray(arrayState.target)),
  originalCameraOffset(-38, 35, new THREE.Vector3(0, -0.25, 0.28)));
finiteState(arrayState);
assertMainLightsFixed();

// Both legacy shader paths keep their GLSL, but the column uniform now points
// at the fixed preview origin and is shared by shell and print materials.
const shellShader = {
  uniforms: {},
  vertexShader: '#include <begin_vertex>\nvoid main() {}',
  fragmentShader: '#include <lights_physical_pars_fragment>\n#include <lights_fragment_end>\n#include <opaque_fragment>\nvoid main() {}',
};
lighting.shade(shellShader, 'Frosted_Polymer');
assert.ok(shellShader.vertexShader.includes('vMusicOrigin = (modelMatrix * musicOrigin).xyz'));
assert.ok(shellShader.fragmentShader.includes('musicLightColumn'));
assert.ok(shellShader.fragmentShader.includes('topRim'));
assert.ok(shellShader.fragmentShader.includes('edgeScatter'));
assert.ok(shellShader.fragmentShader.includes('musicEdgeFalloff'));
assert.ok(shellShader.fragmentShader.includes('reflectedLight.directSpecular *= musicWindowLight'));
assert.ok(shellShader.fragmentShader.includes('#define RE_Direct MusicDiffuseDirect'));
assert.ok(shellShader.fragmentShader.includes('BRDF_Lambert(material.diffuseContribution)'));
const diffuseOnly = shellShader.fragmentShader.split('void MusicDiffuseDirect')[1].split('#undef RE_Direct')[0];
assert.ok(!diffuseOnly.includes('directSpecular') && !diffuseOnly.includes('clearcoatSpecular') && !diffuseOnly.includes('sheenSpecular'),
  'Punctual sources cannot add a narrow shell, clearcoat or sheen highlight');
assert.ok(!shellShader.fragmentShader.includes('totalEmissiveRadiance *='), 'Window shaping preserves authored emission');
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(origin));
assert.deepEqual(shellShader.uniforms.musicShellBounds.value.toArray(),
  [layout.bounds.min[0], layout.bounds.min[1], layout.bounds.max[1], 1 / layout.height]);
assert.equal(shellShader.uniforms.musicScatterFidelity.value, 0.25,
  'High quality retains the original shader at reduced ribbon strength');

const print = createAlbumPrintMaterial(new THREE.Texture());
const printProperties = {
  type: print.type, map: print.map, color: print.color.getHex(), emissive: print.emissive.getHex(),
  emissiveIntensity: print.emissiveIntensity, toneMapped: print.toneMapped, fog: print.fog,
  transparent: print.transparent, opacity: print.opacity,
};
const printShader = {
  uniforms: {},
  vertexShader: '#include <begin_vertex>\nvoid main() {}',
  fragmentShader: '#include <lights_lambert_pars_fragment>\n#include <opaque_fragment>\nvoid main() {}',
};
lighting.shadePrint(printShader);
assert.ok(!printShader.fragmentShader.includes('MusicDiffuseDirect'), 'Matte artwork retains its original Lambert light path');
assert.ok(printShader.fragmentShader.includes('printLight'));
assert.ok(printShader.fragmentShader.includes('outgoingLight *= mix(musicPrintAmbient, 1.0, printLight)'));
assert.ok(printShader.vertexShader.includes('vMusicPrintOrigin'));
assert.strictEqual(printShader.uniforms.musicPrintLightColumn, shellShader.uniforms.musicLightColumn,
  'Shell and print shader paths share the same cached origin uniform');
assert.ok(printShader.uniforms.musicPrintLightColumn.value.equals(origin));
assert.ok(print.isMeshLambertMaterial, 'Printed art keeps its diffuse Lambert material');
assert.equal(print.emissive.getHex(), 0, 'Printed art is not self-emissive');
assert.equal(print.toneMapped, false);
assert.equal(print.fog, true);
const printShaderGuard = {
  uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <opaque_fragment>',
};
const printShaderGuardBefore = structuredClone(printShaderGuard);
lighting.shade(printShaderGuard, 'Album_Print');
assert.deepEqual(printShaderGuard, printShaderGuardBefore, 'Artwork skips the shell shader path');

const noOpCount = lighting.state.transformUpdates;
const baseState = structuredClone(lighting.state);
const virtualModel = new THREE.Group();
const virtualCamera = new THREE.PerspectiveCamera();
for (let i = 0; i < 2000; i++) {
  virtualModel.position.set(i * 0.1, Math.sin(i), -i * 0.2);
  virtualCamera.position.set(-i, i * 0.2, i + 1);
  virtualCamera.lookAt(virtualModel.position);
  lighting.setWindow(0, origin, layout);
  lighting.update(true);
}
assert.equal(lighting.state.transformUpdates, noOpCount,
  'Repeated unchanged window configuration does not rebuild transforms');
assert.deepEqual(lighting.state.position, baseState.position);
assert.deepEqual(lighting.state.target, baseState.target);
assert.deepEqual(lighting.state.fillPosition, baseState.fillPosition);
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(origin),
  'Model and camera motion cannot move the shell lighting column');
assert.ok(printShader.uniforms.musicPrintLightColumn.value.equals(origin),
  'Model and camera motion cannot move the print lighting column');
assertMainLightsFixed();

lighting.setWindow(1, origin, layout);
const matrixState = structuredClone(lighting.state);
assert.equal(matrixState.layoutProgress, 1);
assert.ok(new THREE.Vector3().fromArray(matrixState.position).sub(new THREE.Vector3().fromArray(matrixState.target))
  .distanceTo(originalCameraOffset(59, 25)) < 1e-9,
  'MATRIX q=1 retains the original camera-local spot offset');
approxVector(new THREE.Vector3().fromArray(matrixState.fillPosition).sub(new THREE.Vector3().fromArray(matrixState.target)),
  originalCameraOffset(59, 25, new THREE.Vector3(0, -0.25, 0.28)));
assert.notDeepEqual(matrixState.position, arrayState.position, 'The two layouts retain distinct spot positions');
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(origin), 'q changes do not move the fixed shader column');
assertMainLightsFixed();

const endpointDistance = new THREE.Vector3().fromArray(matrixState.position)
  .distanceTo(new THREE.Vector3().fromArray(arrayState.position));
lighting.setWindow(0.49, origin, layout);
const beforeMiddle = structuredClone(lighting.state);
lighting.setWindow(0.5, origin, layout);
const middleState = structuredClone(lighting.state);
lighting.setWindow(0.51, origin, layout);
const afterMiddle = structuredClone(lighting.state);
assert.equal(middleState.layoutProgress, 0.5);
assert.ok(new THREE.Vector3().fromArray(beforeMiddle.position).distanceTo(new THREE.Vector3().fromArray(middleState.position)) < endpointDistance * 0.1 &&
  new THREE.Vector3().fromArray(middleState.position).distanceTo(new THREE.Vector3().fromArray(afterMiddle.position)) < endpointDistance * 0.1,
  'Small q changes make small source-position changes');
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(origin));
assertMainLightsFixed();

lighting.setQuality('full');
lighting.update(true);
assert.equal(lighting.state.fillVisible, true, 'Full quality enables the bounded local fill');
const fullFill = structuredClone(lighting.state.fillPosition);
assert.deepEqual(fullFill, lighting.state.fillPosition);
assert.equal(shellShader.uniforms.musicScatterFidelity.value, 0.25,
  'Full quality also keeps ribbon intensity at the reduced level');
lighting.setQuality('basic');
lighting.update(true);
assert.equal(lighting.state.fillVisible, false, 'Basic quality hides the local fill');
assert.deepEqual(lighting.state.fillPosition, fullFill, 'Quality changes never move the fixed fill');
assert.equal(shellShader.uniforms.musicScatterFidelity.value, 0,
  'Basic quality can omit only the small ribbon term');
lighting.setQuality('high');
lighting.update(true);
assert.equal(lighting.state.fillVisible, false);
assert.equal(shellShader.uniforms.musicScatterFidelity.value, 0.25);

// Reverse and repeat a bridge sample. Positions and cached shader origins are
// deterministic because neither is derived from live model/camera transforms.
lighting.setWindow(0.25, origin, layout);
const returnSample = structuredClone(lighting.state);
lighting.setWindow(0.5, origin, layout);
assert.deepEqual(lighting.state.position, middleState.position);
lighting.setWindow(0, origin, layout);
sameTransform(lighting.state, arrayState);
lighting.setWindow(0.25, origin, layout);
sameTransform(lighting.state, returnSample);

// A viewport-origin change updates the cached column; a new layout reference
// updates aim and shell bounds. Identical values/references stay idempotent.
const shiftedOrigin = origin.clone().add(new THREE.Vector3(1, 0, 0));
const beforeOriginChange = lighting.state.transformUpdates;
lighting.setWindow(0, shiftedOrigin, layout);
assert.equal(lighting.state.transformUpdates, beforeOriginChange + 1);
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(shiftedOrigin));
assert.ok(printShader.uniforms.musicPrintLightColumn.value.equals(shiftedOrigin));
const oldBounds = shellShader.uniforms.musicShellBounds.value.clone();
const nextLayout = {
  ...layout, height: 3.45,
  center: { ...layout.center, y: 1.825 },
  bounds: { min: [-2.2, 0.1, -0.07], max: [2.2, 3.55, 0.07] },
};
const beforeLayoutChange = lighting.state.transformUpdates;
lighting.setWindow(0, shiftedOrigin, nextLayout);
assert.equal(lighting.state.transformUpdates, beforeLayoutChange + 1,
  'Changing the layout reference recomputes aim and shell bounds once');
assert.notDeepEqual(shellShader.uniforms.musicShellBounds.value.toArray(), oldBounds.toArray());
assert.ok(shellShader.uniforms.musicLightColumn.value.equals(shiftedOrigin));
assert.ok(lighting.source.target.position.distanceTo(fixtureAim(shiftedOrigin, nextLayout)) < 1e-9);

// Theme changes preserve every light transform and the key's existing shadow.
const themeTransforms = structuredClone(lighting.state);
const themeLook = [];
for (const theme of ['day', 'dusk', 'night']) {
  lighting.setTheme(theme, key);
  themeLook.push([lighting.source.color.getHex(), lighting.source.intensity,
    key.intensity, hemi.intensity, fill.intensity]);
  finiteState(lighting.state);
  sameTransform(lighting.state, themeTransforms);
  assertMainLightsFixed();
  assert.equal(key.castShadow, keyShadow, 'Themes preserve the original directional shadow setting');
}
assert.notDeepEqual(themeLook[0], themeLook[2], 'Day and night retain distinct lighting looks');
assert.ok(themeLook.flat().every((value) => Number.isFinite(value) && value >= 0),
  'Every theme retains finite nonnegative light values');
assert.ok(Math.abs(themeLook[0][1] - 180 * 64 * .7) < 1e-9, 'Diffuse illumination retains its original intensity');
assert.deepEqual(scene.children.filter((child) => child instanceof THREE.Light), allowedLights,
  'Theme changes do not add or remove light objects');

lighting.setTheme('night', key, undefined, 'archive');
assert.equal(scene.environmentIntensity, .20, 'Punk retains its night ambient level');
assert.equal(shellShader.uniforms.musicWindowAmbient.value, 1, 'Punk does not receive Future night shaping');
assert.equal(printShader.uniforms.musicPrintAmbient.value, .12);
lighting.setTheme('night', key, undefined, 'rhine');
assert.equal(scene.environmentIntensity, .10);
assert.equal(shellShader.uniforms.musicWindowAmbient.value, .24, 'Only Future night concentrates illumination');
assert.equal(printShader.uniforms.musicPrintAmbient.value, .06);
lighting.setTheme('day', key, undefined, 'rhine');
assert.equal(shellShader.uniforms.musicWindowAmbient.value, 1, 'Daylight restores the shared soft look');
sameTransform(lighting.state, themeTransforms);

lighting.setQuality('full');
const beforeHide = structuredClone(lighting.state);
lighting.update(false);
assert.equal(lighting.state.visible, false);
assert.equal(lighting.state.fillVisible, false, 'Hidden view disables the local fill');
sameTransform(lighting.state, beforeHide);
assertMainLightsFixed();

// Hidden case-emission lights return before traversing or updating model
// matrices; the visible path still resolves and follows real emitting parts.
const caseScene = new THREE.Scene();
const caseLighting = createCaseIllumination(caseScene);
caseLighting.apply({}, { lighting: 'full' });
const model = new THREE.Group();
const frame = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), new THREE.MeshPhysicalMaterial({
  color: '#dddddd', emissive: '#ff5000', emissiveIntensity: 0.8,
}));
frame.userData.casePart = 'frame';
model.add(frame);
let traversals = 0;
let worldUpdates = 0;
const traverse = model.traverse.bind(model);
const updateWorldMatrix = model.updateWorldMatrix.bind(model);
model.traverse = (callback) => { traversals++; return traverse(callback); };
model.updateWorldMatrix = (...args) => { worldUpdates++; return updateWorldMatrix(...args); };
caseLighting.update(model, true);
assert.ok(traversals > 0, 'Visible case lighting resolves emissive model parts');
assert.ok(worldUpdates > 0, 'Visible case lighting updates model world matrices');
const caseLights = caseScene.children.filter((child) => child instanceof THREE.PointLight);
assert.ok(caseLights.some((light) => light.visible && light.intensity > 0),
  'Visible case lighting still enables a light for a real emissive part');
const activeLight = caseLights.find((light) => light.visible);
const activePosition = activeLight.position.clone();
model.position.x += 3;
caseLighting.update(model, true);
assert.ok(Math.abs(activeLight.position.x - activePosition.x - 3) < 1e-9,
  'Visible case lighting follows the model world transform');
traversals = 0;
worldUpdates = 0;
caseLighting.update(model, false);
assert.equal(traversals, 0, 'Hidden case lights do not traverse the model');
assert.equal(worldUpdates, 0, 'Hidden case lights do not update world matrices');
assert.ok(caseLights.every((light) => !light.visible), 'Hidden case lighting turns off all local lights');

console.log('Music lighting passed: wide baked studio reflections replace punctual shell highlights; original diffuse lights, ARRAY/MATRIX directions and fixed anchors remain; only Future night concentrates reflected light; print, emission, shadow and lifecycle contracts are preserved.');
