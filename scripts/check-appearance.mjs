import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { CardAppearance } from "../src/appearance.ts";
import { MusicArrayAppearance } from "../src/music-array-appearance.ts";
import { MusicArrayFadePass } from "../src/music-array-fade-pass.ts";

const appearance = new CardAppearance();
const high = new THREE.MeshPhysicalMaterial({
  color: "#fffdfa",
  transmission: 0.9,
  roughness: 0.21,
  attenuationColor: "#eee6df",
  attenuationDistance: 2,
});
const low = new THREE.MeshPhysicalMaterial({
  color: "#fff7ed",
  transmission: 0.78,
  roughness: 0.28,
  attenuationColor: "#d4c7b4",
  attenuationDistance: 1.2,
});
appearance.register("Frosted_Polymer", high, low);
const group = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(), high);
body.userData.surface = "Frosted_Polymer";
group.add(body);
appearance.prepare(group);
appearance.apply(group, 0);
assert.ok(body.material.color.equals(low.color));
assert.equal(body.material.transmission, low.transmission);
assert.ok(body.material.attenuationColor.equals(low.attenuationColor));
assert.equal(body.material.attenuationDistance, low.attenuationDistance);
let last = body.material.transmission;
for (let i = 1; i <= 100; i++) {
  appearance.apply(group, i / 100);
  assert.ok(
    Math.abs(body.material.transmission - last) < 0.00121,
    "Surface changes continuously",
  );
  last = body.material.transmission;
  assert.ok(
    body.material.attenuationColor.equals(
      low.attenuationColor.clone().lerp(high.attenuationColor, i / 100),
    ),
  );
  assert.equal(
    body.material.attenuationDistance,
    THREE.MathUtils.lerp(1.2, 2, i / 100),
  );
}
assert.ok(body.material.color.equals(high.color));
assert.equal(body.material.transmission, high.transmission);
assert.ok(body.material.attenuationColor.equals(high.attenuationColor));

// Opaque glTF surfaces may be Standard materials without absorption properties.
const opaque = new THREE.MeshStandardMaterial({ color: "#c7beb6" });
appearance.register("Opaque", opaque, opaque.clone());
const solid = new THREE.Mesh(new THREE.BoxGeometry(), opaque);
solid.userData.surface = "Opaque";
const solids = new THREE.Group();
solids.add(solid);
appearance.prepare(solids);
assert.doesNotThrow(() => appearance.apply(solids, 0.5));

// Default unbounded absorption must not turn into NaN during interpolation.
const clear = new THREE.MeshPhysicalMaterial();
appearance.register("Clear", clear, clear.clone());
const glass = new THREE.Mesh(new THREE.BoxGeometry(), clear);
glass.userData.surface = "Clear";
solids.add(glass);
appearance.prepare(solids);
appearance.apply(solids, 0.5);
assert.equal(glass.material.attenuationDistance, Infinity);
appearance.dispose(solids);

// A file selected again while descending must keep its own material state.
const returning = group.clone(true);
appearance.prepare(returning);
appearance.apply(returning, 0.37);
appearance.apply(group, 0.81);
assert.notEqual(returning.children[0].material, body.material);
assert.equal(returning.children[0].userData.appearance.value, 0.37);
assert.equal(body.userData.appearance.value, 0.81);
appearance.apply(returning, 1e-8);
assert.ok(
  Math.abs(returning.children[0].material.transmission - low.transmission) <
    1e-8,
  "Array handoff has the same surface",
);

const shader = {
  uniforms: {},
  vertexShader: "#include <begin_vertex>",
  fragmentShader: "#include <color_fragment>\n#include <roughnessmap_fragment>",
};
body.material.onBeforeCompile(shader, null);
assert.equal(shader.uniforms.archiveQuality, body.userData.appearance);
assert.ok(shader.fragmentShader.includes("roughnessFactor = mix(mix(0.28"));
appearance.dispose(returning);
assert.ok(body.material.color.r > 0);

const arrayAppearance = new MusicArrayAppearance(new THREE.Color("#eae5e1"));
const arrayBodyMaterial = new THREE.MeshPhysicalMaterial();
const arrayBody = new THREE.InstancedMesh(new THREE.BoxGeometry(), arrayBodyMaterial, 2);
arrayBody.castShadow = true;
arrayAppearance.write(arrayBody, 0, 0.25, 0.4);
arrayAppearance.write(arrayBody, 1, 0.75, 0.2, true);
const instanceColor = arrayBody.instanceColor;
assert.ok(instanceColor);
const writtenInstanceColor = Array.from(instanceColor.array);
const expectedInstanceColor = [1.25, 1.4, 1, 1.75, 1.2, 2];
assert.equal(writtenInstanceColor.length, expectedInstanceColor.length);
writtenInstanceColor.forEach((value, index) => assert.ok(Math.abs(value - expectedInstanceColor[index]) < 1e-6,
  `The extra flag occupies instanceColor.b while alpha/tint channels remain stable at component ${index}.`));

arrayAppearance.setSubmersion(true, -4.42);
const compiledShaders = [];
function compileArrayShader(material, shaderLibrary, label) {
  arrayAppearance.patchAuxiliary(material);
  const shader = {
    uniforms: {},
    vertexShader: shaderLibrary.vertexShader,
    fragmentShader: shaderLibrary.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  assert.ok(shader.vertexShader.includes("MUSIC_ARRAY_APPEARANCE_VERTEX_DECLARATION_V4"), `${label}: vertex declaration hook`);
  assert.ok(shader.vertexShader.includes("MUSIC_ARRAY_APPEARANCE_VERTEX_VALUE_V4"), `${label}: per-instance extra hook`);
  assert.ok(shader.vertexShader.includes("MUSIC_ARRAY_APPEARANCE_VERTEX_WORLD_V4"), `${label}: world-space hook`);
  assert.ok(shader.fragmentShader.includes("MUSIC_ARRAY_APPEARANCE_FRAGMENT_V4"), `${label}: fragment discard hook`);
  assert.ok(shader.fragmentShader.includes("vMusicArrayExtra > 0.5 && vMusicArrayWorldY < uMusicArrayGroundY"),
    `${label}: extra-only ground clipping predicate`);
  assert.ok(shader.fragmentShader.indexOf("#include <clipping_planes_fragment>") <
    shader.fragmentShader.indexOf("uMusicArraySubmersionEnabled > 0.5"), `${label}: ground clipping follows Three's clipping planes`);
  assert.ok(shader.vertexShader.includes("musicArrayWorldPosition = batchingMatrix * musicArrayWorldPosition;"),
    `${label}: batching transform participates in world height`);
  assert.ok(shader.vertexShader.includes("musicArrayWorldPosition = instanceMatrix * musicArrayWorldPosition;"),
    `${label}: instance transform participates in world height`);
  assert.ok(shader.vertexShader.includes("musicArrayWorldPosition = modelMatrix * musicArrayWorldPosition;"),
    `${label}: object transform participates in world height`);
  assert.strictEqual(shader.uniforms.uMusicArraySubmersionEnabled.value, 1, `${label}: submersion starts enabled`);
  assert.equal(shader.uniforms.uMusicArrayGroundY.value, -4.42, `${label}: ground plane is passed in world units`);
  compiledShaders.push({ shader, label });
  return shader;
}

const bodyShader = compileArrayShader(arrayBodyMaterial, THREE.ShaderLib.standard, "shell/cover");
const titleMaterial = new THREE.MeshBasicMaterial();
const titleShader = compileArrayShader(titleMaterial, THREE.ShaderLib.basic, "title/label");
const normalMaterial = new THREE.MeshNormalMaterial();
const normalShader = compileArrayShader(normalMaterial, THREE.ShaderLib.normal, "AO normal");
const depthMaterial = arrayBody.customDepthMaterial;
assert.ok(depthMaterial, "A shadow-casting instanced shell receives the shared custom depth pass.");
const depthShader = compileArrayShader(depthMaterial, THREE.ShaderLib.depth, "custom depth/Bokeh depth");

const fadePass = new MusicArrayFadePass(new THREE.Scene(), new THREE.PerspectiveCamera(), arrayAppearance);
const fadeMaskShader = compileArrayShader(fadePass.maskMaterial, THREE.ShaderLib.basic, "fade mask");
assert.ok(fadeMaskShader.fragmentShader.includes("gl_FragColor = vec4(vMusicArrayAlphaTint.y, 0.0, 0.0, 1.0)"),
  "The fade mask keeps its tint output alongside the ground discard.");

const rhineInfoSource = await readFile(new URL("../src/rhine-album-info.ts", import.meta.url), "utf8");
const badgeVertex = rhineInfoSource.match(/const badgeVertexShader = `([\s\S]*?)`;/)?.[1];
const badgeFragmentTemplate = rhineInfoSource.match(/const badgeFragmentShader = `([\s\S]*?)`;/)?.[1];
assert.ok(badgeVertex && badgeFragmentTemplate, "The RhineInfo badge shader sources are available for the shader-hook check.");
assert.ok(badgeVertex.includes("#include <common>") && badgeVertex.includes("#include <begin_vertex>") &&
  badgeVertex.includes("#include <project_vertex>") && badgeVertex.includes("#include <clipping_planes_pars_vertex>") &&
  badgeVertex.includes("#include <clipping_planes_vertex>"), "The badge vertex shader exposes standard transform and clipping hooks.");
assert.ok(badgeFragmentTemplate.includes("#include <common>") && badgeFragmentTemplate.includes("#include <clipping_planes_pars_fragment>") &&
  badgeFragmentTemplate.includes("#include <clipping_planes_fragment>"), "The badge fragment shader exposes standard clipping hooks.");
const badgeFragment = badgeFragmentTemplate
  .replaceAll("${BADGE_SIZE + BADGE_GAP}", "0.68")
  .replaceAll("${BADGE_SIZE}", "0.6");
const badgeMaterial = new THREE.ShaderMaterial({ vertexShader: badgeVertex, fragmentShader: badgeFragment });
const badgeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), badgeMaterial, 1);
arrayAppearance.write(badgeMesh, 0, 1, 0, true);
assert.equal(badgeMesh.instanceColor.array[2], 2, "The actual instanced badge material receives the extra flag through write().");
const badgeShader = compileArrayShader(badgeMaterial, { vertexShader: badgeVertex, fragmentShader: badgeFragment }, "RhineInfo badge");
assert.ok(badgeShader.vertexShader.includes("vLocalUv = uv;") && badgeShader.vertexShader.includes("vBadgeKind = rhineBadgeType;"),
  "The array badge keeps its local UV and per-instance HiRes/DSD selector.");
assert.ok(badgeShader.vertexShader.indexOf("vMusicArrayExtra = 0.0;") <
  badgeShader.vertexShader.indexOf("#ifdef USE_INSTANCING_COLOR"),
  "A selected, non-instanced badge keeps the default extra flag at zero.");
assert.ok(badgeShader.fragmentShader.includes("uBadgeAtlas") && badgeShader.fragmentShader.includes("uTime") &&
  badgeShader.fragmentShader.includes("uReduced"), "The array badge retains its atlas, clock and reduced-motion inputs.");
const selectedBadgeMaterial = new THREE.ShaderMaterial({ vertexShader: badgeVertex, fragmentShader: badgeFragment });
const selectedBadgeMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), selectedBadgeMaterial);
assert.equal(selectedBadgeMesh.instanceColor, undefined, "The selected badge is a regular Mesh without an extra attribute.");
const selectedBadgeShader = compileArrayShader(selectedBadgeMaterial,
  { vertexShader: badgeVertex, fragmentShader: badgeFragment }, "selected RhineInfo badge");
assert.ok(selectedBadgeShader.vertexShader.includes("vMusicArrayExtra = 0.0;"),
  "A patched non-instanced badge initializes the extra flag to zero.");
for (const { shader, label } of compiledShaders) {
  assert.strictEqual(shader.uniforms.uMusicArraySubmersionEnabled, bodyShader.uniforms.uMusicArraySubmersionEnabled,
    `${label}: shared submersion uniform remains live after compilation`);
  assert.strictEqual(shader.uniforms.uMusicArrayGroundY, bodyShader.uniforms.uMusicArrayGroundY,
    `${label}: shared ground uniform remains live after compilation`);
}

arrayAppearance.setSubmersion(false, -3.9);
for (const { shader, label } of compiledShaders) {
  assert.strictEqual(shader.uniforms.uMusicArraySubmersionEnabled.value, 0, `${label}: disable updates the compiled shader immediately`);
  assert.equal(shader.uniforms.uMusicArrayGroundY.value, -3.9, `${label}: ground updates without recompilation`);
}
assert.match(badgeMaterial.customProgramCacheKey(), /music-array-appearance-v4/,
  "The appearance shader cache key is versioned for the new hooks.");
assert.match(rhineInfoSource, /const BADGE_SHADER_CACHE_VERSION = "rhine-album-badge-submersion-v2";/,
  "The custom RhineInfo badge shader has its own cache version.");
assert.match(rhineInfoSource, /material\.customProgramCacheKey = \(\) => `\$\{BADGE_SHADER_CACHE_VERSION\}-\$\{Number\(instanced\)\}`;/,
  "Both instanced and selected badge variants use the versioned source key.");

fadePass.dispose();
arrayAppearance.dispose();
arrayBody.geometry.dispose();
arrayBodyMaterial.dispose();
badgeMesh.geometry.dispose();
titleMaterial.dispose();
normalMaterial.dispose();
badgeMaterial.dispose();
selectedBadgeMesh.geometry.dispose();
selectedBadgeMaterial.dispose();
console.log(
  "Appearance interpolation and array ground clipping passed for shell/cover, title/label, custom depth, AO/normal, Bokeh depth, fade mask and RhineInfo badges.",
);
