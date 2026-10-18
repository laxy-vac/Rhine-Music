import assert from 'node:assert/strict';
import * as THREE from 'three';

const pendingDecodes = new Map();
class FakeImage {
  naturalWidth = 512;
  naturalHeight = 512;
  privateSrc = '';
  static autoResolve = false;

  set src(value) { this.privateSrc = value; }
  get src() { return this.privateSrc; }
  decode() {
    if (FakeImage.autoResolve) return Promise.resolve();
    return new Promise((resolve) => pendingDecodes.set(this.privateSrc, resolve));
  }
}

class FakeContext2D {
  drawImageCount = 0;
  fillTextCount = 0;
  setTransform() {}
  clearRect() {}
  fillRect() {}
  beginPath() {}
  arc() {}
  stroke() {}
  fillText() { this.fillTextCount++; }
  drawImage() { this.drawImageCount++; }
}

class FakeCanvas {
  width = 1;
  height = 1;
  context = new FakeContext2D();
  getContext() { return this.context; }
}

globalThis.document = { createElement: () => new FakeCanvas() };
globalThis.Image = FakeImage;
const { CoverAtlas } = await import('../src/cover-atlas.ts');

const covers = new CoverAtlas(4, 8192, 1);
const sameFallbackA = { id: 'metadata-a', title: 'No Cover' };
const sameFallbackB = { id: 'metadata-b', title: 'No Cover' };
const differentFallback = { id: 'metadata-c', title: 'Another No Cover' };

covers.setSlot(0, sameFallbackA);
const firstFallbackTile = covers.contentTiles.atlasSlotAt(0);
const firstDirtyCount = covers.dirtySlots.size;
const tileDrawsAfterFirst = covers.tileCanvas.getContext('2d').drawImageCount;
covers.setSlot(1, sameFallbackB);
assert.equal(covers.contentTiles.atlasSlotAt(1), firstFallbackTile,
  'Metadata identities with identical fallback pixels share one atlas tile');
assert.equal(covers.dirtySlots.size, firstDirtyCount, 'A content hit does not dirty another tile');
assert.equal(covers.tileCanvas.getContext('2d').drawImageCount, tileDrawsAfterFirst,
  'A content hit skips cover rasterization');
assert.deepEqual(covers.tileOffsets.slice(4, 8), covers.tileOffsets.slice(0, 4),
  'The physical instance changes UVs to the shared content tile');

covers.setSlot(2, differentFallback);
assert.notEqual(covers.contentTiles.atlasSlotAt(2), firstFallbackTile,
  'Distinct placeholder text keeps distinct pixels');

const url = 'https://covers.invalid/shared.png';
const pendingA = { id: 'album-a', title: 'Pending A', album: { coverUrl: url } };
const pendingB = { id: 'album-b', title: 'Pending B', album: { coverUrl: url } };
covers.dirtySlots.clear();
const tileDrawsBeforePending = covers.tileCanvas.getContext('2d').drawImageCount;
covers.setSlot(0, pendingA);
covers.setSlot(3, pendingB);
const firstPendingTile = covers.contentTiles.atlasSlotAt(0);
assert.notEqual(covers.contentTiles.atlasSlotAt(3), firstPendingTile,
  'Different visible fallback titles remain distinct until the shared image is decoded');
assert.equal(pendingDecodes.size, 1, 'Duplicate URLs share one asynchronous image decode');

const decode = [...pendingDecodes.values()][0];
const load = [...covers.pendingImages.values()][0];
decode();
await load;
const imageKey = JSON.stringify(['image', url]);
assert.equal(covers.slotKeys[0], imageKey);
assert.equal(covers.slotKeys[3], imageKey);
assert.equal(covers.contentTiles.atlasSlotAt(0), covers.contentTiles.atlasSlotAt(3),
  'Decoded URL promotion merges all resident fallback owners onto one tile');
assert.equal(covers.tileCanvas.getContext('2d').drawImageCount, tileDrawsBeforePending + 1,
  'One URL upgrade rasterizes the resident image once regardless of owner count');
assert.ok(covers.dirtySlots.has(covers.contentTiles.atlasSlotAt(0)),
  'The upgraded resident tile is scheduled for upload');

const upgradedTile = covers.contentTiles.atlasSlotAt(0);
const drawsAfterUpgrade = covers.tileCanvas.getContext('2d').drawImageCount;
const dirtyAfterUpgrade = covers.dirtySlots.size;
covers.setSlot(1, { id: 'album-c', title: 'Different title, same art', album: { coverUrl: url } });
assert.equal(covers.contentTiles.atlasSlotAt(1), upgradedTile);
assert.equal(covers.tileCanvas.getContext('2d').drawImageCount, drawsAfterUpgrade,
  'An already resident URL hit skips rasterization even across record IDs and titles');
assert.equal(covers.dirtySlots.size, dirtyAfterUpgrade,
  'An already resident URL hit schedules no GPU upload');

const snapshotRecord = { id: 'album-a', title: 'Pending A', album: { coverUrl: url } };
await covers.select(snapshotRecord);
const selectedMap = covers.selected.material.map;
const mapVersion = selectedMap.version;
selectedMap.anisotropy = 2;
const outgoingA = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
const outgoingB = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
covers.snapshot(outgoingA);
covers.snapshot(outgoingB);
assert.equal(selectedMap.anisotropy, 2,
  'Creating outgoing snapshots preserves the selected map quality setting');
assert.equal(selectedMap.version, mapVersion,
  'A snapshot does not flag an unchanged selected texture for upload');
assert.strictEqual(outgoingA.material.map, selectedMap,
  'Outgoing copies lease the selected immutable 1024px texture');
assert.strictEqual(outgoingB.material.map, selectedMap,
  'Repeated snapshots share the same immutable texture');
assert.equal(covers.selectedSnapshotLease.entry.references, 3,
  'Selected view and both outgoing owners hold independent leases');

await covers.select(snapshotRecord);
assert.strictEqual(covers.selected.material.map, selectedMap,
  'Reselecting a cached cover rebinds the resident high-resolution map');
assert.equal(covers.selected.material.map.anisotropy, 2,
  'Reselecting a cached map retains the current external quality setting');
assert.equal(selectedMap.version, mapVersion,
  'A resident reselect does not repaint or upload the high-resolution texture');

const alternate = { id: 'album-no-cover', title: 'Separate Album' };
await covers.select(alternate);
assert.equal(covers.selected.material.map.anisotropy, 2,
  'A newly selected high-resolution entry inherits the current map quality setting');
assert.strictEqual(outgoingA.material.map, selectedMap,
  'Changing the selected map does not change an outgoing album identity');
assert.notStrictEqual(covers.selected.material.map, selectedMap);

outgoingA.userData.releaseCoverTexture();
outgoingA.userData.releaseCoverTexture();
outgoingB.userData.releaseCoverTexture();
assert.equal(covers.snapshotTextures.get(imageKey).references, 0,
  'Each outgoing release is idempotent and leaves one bounded zero-reference LRU entry');
await covers.select(snapshotRecord);
assert.strictEqual(covers.selected.material.map, selectedMap,
  'A later selection reuses the zero-reference high-resolution LRU entry');
assert.equal(covers.selected.material.map.anisotropy, 2,
  'Returning to an old cache entry does not restore stale anisotropy');
assert.equal(selectedMap.version, mapVersion);

covers.dispose();

// A retained 1024px selected/outgoing entry must not make an evicted array
// tile or decoded-image LRU entry look like decoded pixels are still resident.
FakeImage.autoResolve = true;
const evictionCovers = new CoverAtlas(4, 8192, 1);
const retainedUrl = 'https://covers.invalid/retained-after-lru.png';
const retainedRecord = {
  id: 'retained-album', title: 'Retained Album', album: { coverUrl: retainedUrl },
};
const retainedImageKey = JSON.stringify(['image', retainedUrl]);
evictionCovers.setSlot(0, retainedRecord);
const retainedLoad = evictionCovers.pendingImages.get(retainedUrl);
assert.ok(retainedLoad, 'The initial retained URL starts one decode');
await retainedLoad;
await evictionCovers.select(retainedRecord);
const retainedMap = evictionCovers.selected.material.map;
const retainedOutgoing = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial());
evictionCovers.snapshot(retainedOutgoing);
assert.strictEqual(retainedOutgoing.material.map, retainedMap);

for (let i = 0; i < 8; i++) {
  evictionCovers.setSlot(0, { id: `churn-${i}`, title: `Churn ${i}` });
}
assert.equal(evictionCovers.contentTiles.has(retainedImageKey), false,
  'Array content residency can evict the retained URL tile independently');

for (let i = 0; i < 49; i++) {
  const record = {
    id: `lru-${i}`, title: `LRU ${i}`,
    album: { coverUrl: `https://covers.invalid/lru-${i}.png` },
  };
  await evictionCovers.select(record);
}
assert.equal(evictionCovers.decodedImages.has(retainedUrl), false,
  'The decoded-image LRU evicts the original URL after more than 48 other covers');
assert.equal(evictionCovers.snapshotTextures.has(retainedImageKey), true,
  'An outgoing high-resolution owner can keep its texture resident after those evictions');
assert.ok(evictionCovers.snapshotTextures.get(retainedImageKey)?.value.decodedImage,
  'The retained high-resolution entry keeps the decoded source image for atlas recovery');

const tileDrawsBeforeRetry = evictionCovers.tileCanvas.getContext('2d').drawImageCount;
evictionCovers.setSlot(1, retainedRecord);
assert.equal(evictionCovers.pendingImages.has(retainedUrl), false,
  'The retained decoded image is reused without another asynchronous decode');
assert.equal(evictionCovers.slotKeys[1], retainedImageKey,
  'The reappearing URL receives its decoded image key');
assert.ok(evictionCovers.tileCanvas.getContext('2d').drawImageCount > tileDrawsBeforeRetry,
  'The resident array tile is repainted from the retained decoded image instead of staying a fallback');

retainedOutgoing.userData.releaseCoverTexture();
evictionCovers.dispose();
console.log('Cover atlas passed: content-key UV reuse, URL decode sharing/promotion/retry after independent eviction, quality-preserving selected/outgoing cache reuse, and immutable texture leases.');
