import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  stdin: {
    contents: `import * as THREE from "three"; import { CaseAlbumInfo } from "./src/rhine-album-info.ts"; export { THREE, CaseAlbumInfo };`,
    resolveDir: project,
    sourcefile: "selected-label-residency-check.ts",
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "es2022",
});

const paintCounts = { text: 0 };
class FakeContext {
  save() {}
  restore() {}
  setTransform() {}
  clearRect() {}
  fillRect() {}
  fillText() { paintCounts.text++; }
  drawImage() {}
  beginPath() {}
  rect() {}
  clip() {}
}
class FakeCanvas {
  width = 300;
  height = 150;
  context = new FakeContext();
  getContext() { return this.context; }
}
class FakeImage {
  width = 32;
  height = 16;
  naturalWidth = 32;
  naturalHeight = 16;
  set src(_value) { queueMicrotask(() => this.onload?.()); }
}
globalThis.document = {
  documentElement: { lang: "en" },
  createElement(name) {
    if (name !== "canvas") throw new Error(`Unexpected DOM element: ${name}`);
    return new FakeCanvas();
  },
  fonts: { load: async () => [] },
};
globalThis.Image = FakeImage;

let api;
try {
  api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
} catch (error) {
  console.error(error?.name, error?.message);
  console.error(String(error?.stack ?? "").split("\n").filter(line => !line.includes("data:text/javascript;base64")).slice(-4).join("\n"));
  process.exit(1);
}
const { THREE, CaseAlbumInfo } = api;
const layout = {
  width: 4, height: 4, depth: .3, center: { x: 0, y: 2, z: 0 },
  bounds: { min: [-2, 0, -.15], max: [2, 4, .15] },
  cover: { x: 0, y: 2, z: .1, width: 2.8, height: 2.8 },
  label: { x: 0, y: 3.3, z: .15, width: 3.5, height: .5 }, sourceScale: 1, sourceYOffset: 0,
};

function makeSnapshot(info) {
  const group = new THREE.Group();
  const label = new THREE.Mesh(info.selectedLabel.geometry, new THREE.MeshBasicMaterial({ map: info.selectedLabel.material.map }));
  label.userData = { ...info.selectedLabel.userData };
  group.add(label);
  info.snapshot(group);
  return label;
}
function cleanupSnapshot(label) {
  label.userData.releaseRhineInfoTexture?.();
  label.userData.releaseRhineInfoTexture?.();
  label.material.dispose();
  if (label.userData.rhineInfoOwnedTexture) label.material.map?.dispose();
}
function record(id) { return { id }; }

const info = new CaseAlbumInfo(0, layout, 4096, 8, "punk");
await info.ready;
info.select(record("number-nine-a"), 8);
const nine = info.selectedLabel.material.map;
const nineVersion = nine.version;
const paintedAfterMiss = paintCounts.text;
info.select(record("number-nine-b"), 8);
assert.strictEqual(info.selectedLabel.material.map, nine, "The same printed number reuses its resident texture.");
assert.equal(nine.version, nineVersion, "A cache hit does not dirty or upload the texture again.");
assert.equal(paintCounts.text, paintedAfterMiss, "A cache hit does not repaint the label canvas.");

const oldSnapshot = makeSnapshot(info);
assert.strictEqual(oldSnapshot.material.map, nine);
assert.equal(oldSnapshot.userData.rhineInfoOwnedTexture, false);
assert.equal(typeof oldSnapshot.userData.releaseRhineInfoTexture, "function");
const oldGenerationEntry = info.selectedLabelLease.entry;
info.refresh();
assert.notStrictEqual(info.selectedLabel.material.map, nine, "Refresh advances the resource generation.");
assert.strictEqual(oldSnapshot.material.map, nine, "An outgoing copy keeps its original printed pixels.");
assert.equal(oldGenerationEntry.references, 1, "Refresh releases selected ownership but preserves the outgoing lease.");

info.select(record("number-one"), 0);
const one = info.selectedLabel.material.map;
one.anisotropy = 2;
one.needsUpdate = true;
info.select(record("number-nine-c"), 8);
const nineAfterQuality = info.selectedLabel.material.map;
assert.equal(nineAfterQuality.anisotropy, 2, "An active sampling-quality change reaches cached maps before switching.");
const nineAfterSyncVersion = nineAfterQuality.version;
const oneAfterSyncVersion = one.version;
const textAfterSync = paintCounts.text;
info.select(record("number-one-b"), 0);
assert.strictEqual(info.selectedLabel.material.map, one);
info.select(record("number-nine-d"), 8);
assert.strictEqual(info.selectedLabel.material.map, nineAfterQuality);
assert.equal(nineAfterQuality.version, nineAfterSyncVersion, "Revisiting a synchronized cache entry does not dirty it again.");
assert.equal(one.version, oneAfterSyncVersion, "Revisiting the paired cache entry does not dirty it again.");
assert.equal(paintCounts.text, textAfterSync, "The cached 9/1/9 selection sequence does not repaint.");

cleanupSnapshot(oldSnapshot);
info.dispose();

const full = new CaseAlbumInfo(0, layout, 4096, 1, "punk");
await full.ready;
const pinnedSnapshots = [];
for (let index = 0; index < 16; index++) {
  full.select(record(`pinned-${index}`), index);
  pinnedSnapshots.push(makeSnapshot(full));
}
full.select(record("seventeenth"), 16);
assert.strictEqual(full.selectedLabel.material.map, full.selectedTexture, "A fully pinned cache uses the original private selected texture.");
const capacityFallback = makeSnapshot(full);
assert.equal(capacityFallback.userData.rhineInfoOwnedTexture, true, "Capacity fallback owns a full-size private snapshot texture.");
assert.notStrictEqual(capacityFallback.material.map, full.selectedTexture, "The snapshot copies the current active map.");
assert.equal(capacityFallback.material.map.image.width, 1024, "Capacity fallback keeps the selected label's full print width.");
for (const label of [...pinnedSnapshots, capacityFallback]) cleanupSnapshot(label);
full.dispose();

const diagnostic = new CaseAlbumInfo(0, layout, 4096, 1, "punk");
await diagnostic.ready;
diagnostic.labelResidencyEnabled = false;
diagnostic.select(record("private-path"), 8);
assert.strictEqual(diagnostic.selectedLabel.material.map, diagnostic.selectedTexture, "The diagnostic switch keeps the legacy private-texture path.");
const privateSnapshot = makeSnapshot(diagnostic);
assert.equal(privateSnapshot.userData.rhineInfoOwnedTexture, true);
assert.equal(privateSnapshot.userData.releaseRhineInfoTexture, undefined);
cleanupSnapshot(privateSnapshot);
diagnostic.dispose();

console.log("Selected label residency passed: same-number hits, refresh generation leases, sampling propagation, pinned-capacity fallback, and diagnostic private path.");
