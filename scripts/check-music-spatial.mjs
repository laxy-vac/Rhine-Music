import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTrackFixture } from "./check-foobar-tracks.mjs";

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
for (const cell of [cellAt(-10, -100), cellAt(0, 0), cellAt(20, 200)]) {
  assert.strictEqual(spatial.musicSpatialEntry(cell, false), arrayLayout.musicArrayEntry(cell));
  assert.deepEqual({ ...spatial.musicSpatialCell(cell, false) }, { ...arrayLayout.musicArrayCell(cell) });
}
for (const navigation of [undefined, { axis: "row", direction: 1 }, { cell: requestedCell }]) {
  const current = cellAt(100, 100);
  assert.deepEqual({ ...spatial.musicSpatialSelectionCell(0, current, false, navigation) },
    { ...arrayLayout.musicArraySelectionCell(0, current, navigation) }, "Array selection delegates without changing its looping behavior.");
}
console.log("Finite music shelf projection: 20/9 TRACKS pages, identity, bounds, unique pool, query recovery and unchanged array delegation passed with synthetic records.");
