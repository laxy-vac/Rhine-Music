import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createFortyFiveAlbumRecords, createTrackFixture } from "./check-foobar-tracks.mjs";

const fixture = await createTrackFixture();
const { musicCatalog: catalog, musicShelves: shelves, arrayLayout, displayLayout, records } = fixture;
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(path.join(project, "src/music-spatial-layout.ts"), "utf8");
const transpiled = ts.transpileModule(source, {
  fileName: "music-spatial-layout.ts", reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});
const errors = (transpiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n"));
const module = { exports: {} };
const dependencies = { "./music-array-layout": arrayLayout, "./music-catalog": catalog,
  "./music-catalog-shelves": shelves, "./music-display-layout": displayLayout };
vm.runInNewContext(transpiled.outputText, {
  module, exports: module.exports,
  require(specifier) {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected spatial import: ${specifier}`);
    return dependencies[specifier];
  },
}, { filename: "music-spatial-layout.js" });
const spatial = module.exports;
const firstRow = displayLayout.MUSIC_ARRAY_VIEW.firstRow;
const cellAt = (lane, slot) => ({ lane, row: firstRow + slot });

catalog.configureMusicCatalog({ layout: "shelf", show: "tracks", group: "genre", sort: "added" }, "");
assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [20, 9]);
const canonicalShelfKeys = Array.from(shelves.getMusicCatalogShelves(), shelf => Array.from(shelf.entryKeys));
assert.equal(catalog.getMusicDisplayEntries().length, 29);
assert.equal(records.length, 2, "TRACKS never changes the canonical album records.");
const secondTrack = spatial.musicSpatialEntry(cellAt(0, 1), true);
assert.equal(secondTrack.trackId, records[0].album.tracks[1].id);
catalog.focusMusicEntry(spatial.musicSpatialEntry(cellAt(0, 0), true).key);
const requestedCell = { ...cellAt(700, 300), foobarEntryKey: secondTrack.key };
const secondSelection = spatial.musicSpatialSelectionCell(secondTrack.recordIndex, cellAt(-30, -100), true, { cell: requestedCell });
assert.deepEqual({ ...secondSelection }, { ...cellAt(0, 1), foobarEntryKey: secondTrack.key, foobarTrackId: secondTrack.trackId },
  "The requested non-first track wins over old focus and stale physical coordinates.");
catalog.focusMusicEntry(secondTrack.key);
assert.deepEqual({ ...spatial.musicSpatialSelectionCell(secondTrack.recordIndex, cellAt(400, 400), true) }, { ...secondSelection },
  "Finite selections use their canonical occurrence regardless of the old array coordinates.");
const jazzEntry = spatial.musicSpatialEntry(cellAt(1, 8), true);
assert.equal(jazzEntry.recordIndex, 1);
assert.equal(spatial.musicSpatialSelectionCell(0, cellAt(0, 0), true,
  { cell: { ...cellAt(1, 8), foobarEntryKey: jazzEntry.key } }).foobarEntryKey, secondTrack.key,
  "A requested key from another parent cannot replace this album's focused track.");
assert.equal(spatial.musicSpatialSelectionCell(0, cellAt(0, 0), true,
  { cell: { ...cellAt(0, 0), foobarEntryKey: "stale-key" } }).foobarEntryKey, secondTrack.key);

for (const cell of [cellAt(-1, 0), cellAt(2, 0), cellAt(0, -1), cellAt(0, 20), cellAt(1, 9), cellAt(0.5, 0), cellAt(0, 0.5)]) {
  assert.equal(spatial.musicSpatialEntry(cell, true), undefined, "Out-of-range shelf coordinates never wrap.");
  assert.deepEqual({ ...spatial.musicSpatialCell({ ...cell, foobarEntryKey: secondTrack.key }, true) }, cell,
    "An invalid cell drops stale entry identity.");
}

const poolRows = 48;
for (const center of [0, 0.25, 1, 1.75, 12]) {
  const pool = Array.from({ length: 9 * poolRows }, (_, index) => spatial.musicShelfPoolCell(index, center, poolRows));
  assert.equal(new Set(pool.map(cell => `${cell.lane}:${cell.row}`)).size, pool.length);
  assert.equal(pool[0].lane, Math.floor(center) - 1);
  assert.equal(pool.at(-1).lane, Math.floor(center) + 7);
  const visible = pool.map(cell => spatial.musicSpatialEntry(cell, true)).filter(Boolean);
  assert.equal(new Set(visible.map(entry => entry.key)).size, visible.length, "Finite shelf instances never repeat a visible entry.");
  if (center < 2) assert.equal(visible.length, 29, "The first two real shelves occupy twenty plus nine valid rows.");
  assert.ok(pool.filter(cell => cell.row >= firstRow + 20).every(cell => !spatial.musicSpatialEntry(cell, true)));
}

catalog.configureMusicCatalog({}, "no-synthetic-match");
assert.equal(shelves.getMusicCatalogShelves().length, 0);
assert.equal(spatial.musicSpatialEntry(cellAt(0, 0), true), undefined);
assert.equal(spatial.musicSpatialSelectionCell(0, cellAt(0, 0), true, { cell: requestedCell }).foobarEntryKey, undefined);
catalog.configureMusicCatalog({}, "Needle");
const filteredSelection = spatial.musicSpatialSelectionCell(0, cellAt(0, 0), true, { cell: requestedCell });
assert.equal(spatial.musicSpatialEntry(filteredSelection, true).track.title, "Needle",
  "A filtered-out requested key falls back to a visible entry of the same album.");
catalog.configureMusicCatalog({}, "");
assert.equal(spatial.musicSpatialEntry(cellAt(0, 1), true).key, secondTrack.key);
assert.equal(spatial.musicSpatialSelectionCell(0, cellAt(300, 300), true).foobarEntryKey, secondTrack.key,
  "Clearing the query restores the focused track identity.");

catalog.configureMusicCatalog({ layout: "array" }, "");
const arrayShelfKeys = Array.from(shelves.getMusicCatalogShelves(), shelf => Array.from(shelf.entryKeys));
assert.deepEqual(arrayShelfKeys, canonicalShelfKeys,
  "Switching between MATRIX and ARRAY keeps every entry at the same canonical shelf address.");
assert.deepEqual(arrayShelfKeys.map(keys => keys.length), [20, 9]);
assert.equal(arrayLayout.musicArrayEntry(cellAt(1, 8)).key, jazzEntry.key,
  "A split group keeps its ARRAY entry at the same MATRIX lattice address.");
assert.equal(arrayLayout.musicArrayEntry(cellAt(1, 8 + 9)).key, jazzEntry.key,
  "MATRIX repeats the last canonical entry after the partial shelf's actual nine-row period.");
for (let offset = -40; offset < 80; offset++) {
  const expected = arrayShelfKeys[1][((offset % arrayShelfKeys[1].length) + arrayShelfKeys[1].length) % arrayShelfKeys[1].length];
  assert.equal(arrayLayout.musicArrayEntry({ lane: 1, row: firstRow + offset }).key, expected,
    `Every integer row resolves on a partial shelf (offset ${offset}).`);
  assert.equal(arrayLayout.musicArrayEntry({ lane: 1, row: firstRow + offset + 9 }).key, expected,
    `The partial shelf repeats every nine rows (offset ${offset}).`);
}
assert.equal(arrayLayout.musicArrayEntry(cellAt(1 + arrayShelfKeys.length, 8)).key, jazzEntry.key,
  "Horizontal looping repeats shelves while retaining the physical lane coordinate.");

const snappedLaterCycle = arrayLayout.musicArraySnapCell({ lane: 3, row: firstRow + 17.4 });
assert.deepEqual({ ...snappedLaterCycle }, {
  lane: 3, row: firstRow + 17, foobarEntryKey: jazzEntry.key, foobarTrackId: jazzEntry.trackId,
}, "Snapping rounds to the nearest physical row without jumping to another partial-shelf cycle.");
const snappedEarlierCycle = arrayLayout.musicArraySnapCell({ lane: -1, row: firstRow + 10.6 });
assert.deepEqual({ ...snappedEarlierCycle }, {
  lane: -1, row: firstRow + 11,
  foobarEntryKey: arrayShelfKeys[1][((11 % 9) + 9) % 9],
  foobarTrackId: catalog.getMusicEntryByKey(arrayShelfKeys[1][2]).trackId,
}, "Snapping on a wrapped physical lane keeps its row cycle and repeated entry identity.");
const occupiedCell = arrayLayout.musicArraySnapCell({ lane: 1, row: firstRow + 8 });
assert.deepEqual({ ...occupiedCell }, {
  lane: 1, row: firstRow + 8, foobarEntryKey: arrayShelfKeys[1][8], foobarTrackId: jazzEntry.trackId,
}, "Snapping preserves an already occupied physical occurrence.");

for (const cell of [cellAt(-10, -100), cellAt(0, 0), cellAt(20, 200)]) {
  assert.strictEqual(spatial.musicSpatialEntry(cell, false), arrayLayout.musicArrayEntry(cell));
  assert.deepEqual({ ...spatial.musicSpatialCell(cell, false) }, { ...arrayLayout.musicArrayCell(cell) });
}
for (const navigation of [undefined, { axis: "row", direction: 1 }, { cell: requestedCell }]) {
  const current = cellAt(100, 100);
  assert.deepEqual({ ...spatial.musicSpatialSelectionCell(0, current, false, navigation) },
    { ...arrayLayout.musicArraySelectionCell(0, current, navigation) }, "Array selection delegates without changing its looping behavior.");
}

catalog.configureMusicCatalog({ group: "none", sort: "added", show: "tracks" }, "");
const shortShelf = shelves.getMusicCatalogShelves()[1];
assert.equal(shortShelf.entryKeys.length, 9);
const lastShortShelfEntry = catalog.getMusicEntryByKey(shortShelf.entryKeys[8]);
catalog.focusMusicEntry(lastShortShelfEntry.key);
const forwardEntry = shelves.navigateMusicEntry(lastShortShelfEntry.recordIndex, "row", 1);
catalog.focusMusicEntry(forwardEntry.key);
const forwardWrap = arrayLayout.musicArraySelectionCell(forwardEntry.recordIndex,
  { lane: 1, row: firstRow + 8, foobarEntryKey: lastShortShelfEntry.key }, { axis: "row", direction: 1 });
assert.deepEqual({ ...forwardWrap }, {
  lane: 1, row: firstRow + 9, foobarEntryKey: shortShelf.entryKeys[0], foobarTrackId: forwardEntry.trackId,
}, "Forward row navigation across a partial shelf moves continuously to the next row.");

const firstShortShelfEntry = catalog.getMusicEntryByKey(shortShelf.entryKeys[0]);
catalog.focusMusicEntry(firstShortShelfEntry.key);
const backwardEntry = shelves.navigateMusicEntry(firstShortShelfEntry.recordIndex, "row", -1);
catalog.focusMusicEntry(backwardEntry.key);
const backwardWrap = arrayLayout.musicArraySelectionCell(backwardEntry.recordIndex,
  { lane: 1, row: firstRow, foobarEntryKey: firstShortShelfEntry.key }, { axis: "row", direction: -1 });
assert.deepEqual({ ...backwardWrap }, {
  lane: 1, row: firstRow - 1, foobarEntryKey: shortShelf.entryKeys[8], foobarTrackId: backwardEntry.trackId,
}, "Backward row navigation across a partial shelf moves continuously to the previous row.");

const fortyFiveFixture = await createTrackFixture(createFortyFiveAlbumRecords());
const fortyFiveCatalog = fortyFiveFixture.musicCatalog;
const fortyFiveShelves = fortyFiveFixture.musicShelves;
const fortyFiveArray = fortyFiveFixture.arrayLayout;
fortyFiveCatalog.configureMusicCatalog({ layout: "array", show: "albums", group: "none", sort: "added" }, "");
const fortyFiveKeys = Array.from(fortyFiveShelves.getMusicCatalogShelves(), shelf => Array.from(shelf.entryKeys));
assert.deepEqual(fortyFiveKeys.map(keys => keys.length), [20, 20, 5], "The 45-entry catalog retains canonical 20/20/5 shelves.");
assert.equal(new Set(fortyFiveKeys.flat()).size, 45, "MATRIX repetition does not add canonical catalog entries.");
const shortKeys = fortyFiveKeys[2];
const mod = (value, count) => ((value % count) + count) % count;
for (let offset = -60; offset <= 60; offset++) {
  const expectedKey = shortKeys[mod(offset, shortKeys.length)];
  const entry = fortyFiveArray.musicArrayEntry({ lane: 5, row: firstRow + offset });
  assert.equal(entry.key, expectedKey, `Every physical row resolves on the five-entry shelf (offset ${offset}).`);
  assert.equal(fortyFiveArray.musicArrayEntry({ lane: 5, row: firstRow + offset + 5 }).key, expectedKey,
    `The five-entry shelf repeats every five rows (offset ${offset}).`);
}
for (let slot = 0; slot < shortKeys.length; slot++)
  assert.equal(fortyFiveArray.musicArrayEntry(cellAt(2, slot)).key, shortKeys[slot],
    `The first five physical rows remain the canonical five entries (slot ${slot}).`);

const duplicateKey = shortKeys[2];
const duplicateEntry = fortyFiveCatalog.getMusicEntryByKey(duplicateKey);
const duplicatePhysicalCell = { lane: 5, row: firstRow + 17, foobarEntryKey: duplicateKey };
const nearestDuplicate = fortyFiveArray.musicArraySelectionCell(duplicateEntry.recordIndex,
  { lane: 5, row: firstRow + 17 });
assert.deepEqual({ ...nearestDuplicate }, {
  lane: 5, row: firstRow + 17, foobarEntryKey: duplicateKey, foobarTrackId: undefined,
}, "Selection resolves the nearest physical copy using the target shelf's five-row period.");
assert.deepEqual({ ...fortyFiveArray.musicArraySelectionCell(duplicateEntry.recordIndex, cellAt(2, 2),
  { cell: duplicatePhysicalCell }) }, {
  lane: 5, row: firstRow + 17, foobarEntryKey: duplicateKey, foobarTrackId: undefined,
}, "An explicit repeated physical cell keeps its lane, row and canonical identity.");
assert.deepEqual({ ...fortyFiveArray.musicArraySnapCell({ lane: 5, row: firstRow + 17.4 }) }, {
  lane: 5, row: firstRow + 17, foobarEntryKey: duplicateKey, foobarTrackId: undefined,
}, "Dragging over a repeated copy snaps within the same physical cycle.");

const fifthLast = fortyFiveCatalog.getMusicEntryByKey(shortKeys[4]);
fortyFiveCatalog.focusMusicEntry(fifthLast.key);
const fifthNext = fortyFiveShelves.navigateMusicEntry(fifthLast.recordIndex, "row", 1);
fortyFiveCatalog.focusMusicEntry(fifthNext.key);
const fifthForward = fortyFiveArray.musicArraySelectionCell(fifthNext.recordIndex,
  { lane: 2, row: firstRow + 4, foobarEntryKey: fifthLast.key }, { axis: "row", direction: 1 });
assert.equal(fifthForward.row, firstRow + 5, "Forward navigation wraps continuously across the five-entry shelf.");
assert.equal(fortyFiveArray.musicArrayEntry(fifthForward).key, shortKeys[0]);
const fifthFirst = fortyFiveCatalog.getMusicEntryByKey(shortKeys[0]);
fortyFiveCatalog.focusMusicEntry(fifthFirst.key);
const fifthPrevious = fortyFiveShelves.navigateMusicEntry(fifthFirst.recordIndex, "row", -1);
fortyFiveCatalog.focusMusicEntry(fifthPrevious.key);
const fifthBackward = fortyFiveArray.musicArraySelectionCell(fifthPrevious.recordIndex,
  { lane: 2, row: firstRow, foobarEntryKey: fifthFirst.key }, { axis: "row", direction: -1 });
assert.equal(fifthBackward.row, firstRow - 1, "Backward navigation wraps continuously across the five-entry shelf.");
assert.equal(fortyFiveArray.musicArrayEntry(fifthBackward).key, shortKeys[4]);

fortyFiveCatalog.configureMusicCatalog({ group: "none", show: "albums", sort: "added" }, "");
const fullShelfEntry = fortyFiveCatalog.getMusicEntryByKey(fortyFiveKeys[1][0]);
fortyFiveCatalog.focusMusicEntry(fullShelfEntry.key);
fortyFiveShelves.getMusicEntryLocation(shortKeys[2]);
const laneTarget = fortyFiveShelves.navigateMusicEntry(fullShelfEntry.recordIndex, "lane", 1);
assert.equal(laneTarget.key, shortKeys[2]);
fortyFiveCatalog.focusMusicEntry(laneTarget.key);
const nearestLaneCell = fortyFiveArray.musicArraySelectionCell(laneTarget.recordIndex,
  { lane: 1, row: firstRow + 17 }, { axis: "lane", direction: 1 });
assert.equal(nearestLaneCell.lane, 2);
assert.equal(nearestLaneCell.row, firstRow + 17,
  "Lane navigation chooses the nearest occurrence using the destination shelf's actual period.");
assert.equal(fortyFiveArray.musicArrayEntry(nearestLaneCell).key, laneTarget.key);

catalog.configureMusicCatalog({}, "no-synthetic-match");
assert.deepEqual({ ...arrayLayout.musicArraySnapCell({ lane: 3, row: firstRow + 17 }) },
  { lane: 3, row: firstRow + 17 }, "An empty filtered catalog preserves drag coordinates and has no selected entry.");
console.log("Shared ARRAY/MATRIX mapping: canonical shelf identities, per-shelf row cycles, continuous navigation and same-cycle drag snapping passed with synthetic records.");
