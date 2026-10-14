import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTrackFixture } from "./check-foobar-tracks.mjs";

const {
  catalog: foobarCatalog,
  musicCatalog,
  musicShelves,
  arrayLayout,
  displayLayout,
  applicationState,
  records,
  replaceRecords,
} = await createTrackFixture();
const musicApplication = applicationState.musicApplication;
const originalRecords = records;
const initialView = musicApplication.view;
assert.ok(Object.isFrozen(initialView), "The public view snapshot is immutable.");
assert.strictEqual(musicApplication.view, initialView, "Unchanged view reads keep a stable reference.");
musicCatalog.configureMusicCatalog({ layout: "array" }, "");
const spatialArrayView = musicApplication.view;
assert.notStrictEqual(spatialArrayView, initialView);
assert.ok(Object.isFrozen(spatialArrayView));
assert.equal(musicApplication.spatialLayout, "array");
musicCatalog.configureMusicCatalog({ layout: "grid" }, "");
assert.equal(musicApplication.spatialLayout, "array", "Grid remembers the prior spatial view.");
musicCatalog.configureMusicCatalog({ layout: "shelf" }, "");
assert.equal(musicApplication.spatialLayout, "shelf");
musicCatalog.configureMusicCatalog({ layout: "grid" }, "");
assert.equal(musicApplication.spatialLayout, "shelf", "Returning to Grid restores the last spatial view.");

function visibleEntries() {
  return Array.from(musicCatalog.getMusicCatalogGroups(), group =>
    Array.from(group.entryKeys, key => musicCatalog.getMusicEntryByKey(key)).filter(Boolean))
    .flat();
}

musicCatalog.configureMusicCatalog({ layout: "shelf", show: "albums", group: "genre", sort: "artist" }, "");
const albumEntries = musicCatalog.getMusicDisplayEntries();
assert.equal(albumEntries.length, records.length, "Album SHOW creates one stable entry per canonical album.");
assert.deepEqual(Array.from(albumEntries, entry => [entry.key, entry.albumId, entry.recordIndex]), [
  ["album-rock", "album-rock", 0],
  ["album-jazz", "album-jazz", 1],
]);
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["Alternative", "Jazz"]);
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogRecords()), [0, 1]);
assert.strictEqual(records, originalRecords, "The public catalog leaves the canonical album records array intact.");

musicCatalog.configureMusicCatalog({ show: "tracks", group: "genre", sort: "artist" }, "");
const trackEntries = musicCatalog.getMusicDisplayEntries();
assert.equal(trackEntries.length, 29);
assert.equal(new Set(trackEntries.map(entry => entry.key)).size, 29, "Track display keys remain unique.");
for (const entry of trackEntries) {
  assert.equal(entry.key, `track|${entry.albumId}|${entry.trackId}`);
  assert.strictEqual(entry.album, records[entry.recordIndex].album, "Track entries retain their canonical album object.");
  assert.notStrictEqual(entry.record, records[entry.recordIndex], "Track display records are copies, not canonical records.");
}
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["Alternative", "Jazz"]);
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.entryKeys.length), [24, 5]);
musicCatalog.configureMusicCatalog({ layout: "array", group: "genre", sort: "added" }, "");
assert.deepEqual(Array.from(musicShelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [24, 5],
  "Grouped ARRAY keeps one column per catalog group, even when a group exceeds twenty entries.");
musicCatalog.configureMusicCatalog({ group: "artist" }, "");
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["Alpha Artist", "Beta Artist", "Guest Artist"]);
assert.deepEqual(Array.from(musicShelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [23, 5, 1],
  "Artist groups also map to one ARRAY column each.");
musicCatalog.configureMusicCatalog({ group: "none" }, "");
assert.deepEqual(Array.from(musicShelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [20, 9],
  "Ungrouped ARRAY uses twenty-entry shelf pages.");
for (const layout of ["shelf", "grid"]) {
  musicCatalog.configureMusicCatalog({ layout, group: "genre" }, "");
  assert.deepEqual(Array.from(musicShelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [20, 9],
    `${layout.toUpperCase()} uses twenty-entry shelf pages.`);
}
musicCatalog.configureMusicCatalog({ layout: "shelf", group: "artist", sort: "added" }, "");
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["Alpha Artist", "Beta Artist", "Guest Artist"]);

const savedCategories = records.map(record => record.category);
const savedGenreIds = records.map(record => record.album.genreId);
records.forEach(record => { record.category = "Shared Genre"; });
trackEntries.forEach(entry => { entry.record.category = "Shared Genre"; });
records[0].album.genreId = "canonical-genre-a";
records[1].album.genreId = "canonical-genre-b";
musicCatalog.configureMusicCatalog({ group: "genre", sort: "artist" }, "");
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["Shared Genre", "Shared Genre"]);
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.key).sort(),
  ["genre:canonical-genre-a", "genre:canonical-genre-b"],
  "Genre grouping keys use canonical genre IDs when labels match.");
records.forEach((record, index) => { record.category = savedCategories[index]; record.album.genreId = savedGenreIds[index]; });
trackEntries.forEach(entry => { entry.record.category = records[entry.recordIndex].category; });
musicCatalog.configureMusicCatalog({ layout: "shelf", group: "az", sort: "added" }, "");

musicCatalog.configureMusicCatalog({ group: "az", sort: "added" }, "");
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogGroups(), group => group.name), ["A", "B", "G"],
  "A-Z grouping uses the visible track artist.");
musicCatalog.configureMusicCatalog({ group: "none", sort: "title" }, "");
const titleOrder = visibleEntries().map(entry => entry.track.title);
assert.deepEqual(titleOrder, [...titleOrder].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true })),
  "TITLE sorting uses track titles.");
musicCatalog.configureMusicCatalog({ sort: "year" }, "");
assert.equal(visibleEntries()[0].recordIndex, 1, "YEAR sorting inherits the canonical album year.");
musicCatalog.configureMusicCatalog({ sort: "added" }, "Needle");
const queryEntries = visibleEntries();
assert.deepEqual(Array.from(queryEntries, entry => entry.track.title), ["Needle"], "Query filters individual track entries.");
assert.deepEqual(Array.from(musicCatalog.getMusicCatalogRecords()), [0], "Filtered main results still expose canonical album indexes.");
assert.deepEqual({ ...musicCatalog.getMusicCatalogOptions() }, { ...musicApplication.view });
assert.deepEqual({ ...foobarCatalog.getFoobarCatalogOptions() }, {
  layout: "array", show: "tracks", group: "none", sort: "added",
}, "The legacy shim projects public view settings without changing SHOW/GROUP/SORT/query state.");

foobarCatalog.configureFoobarCatalog({ layout: "future", show: "tracks", group: "none", sort: "added" }, "Needle");
assert.equal(musicCatalog.getMusicCatalogOptions().layout, "array", "Legacy FUTURE projects to the public array layout.");
assert.equal(musicApplication.query, "Needle");
assert.equal(musicCatalog.getMusicCatalogGroups()[0].entryKeys.length, 1);

musicCatalog.configureMusicCatalog({ layout: "shelf", show: "tracks", group: "none", sort: "added" }, "");
const shelfReference = musicShelves.getMusicCatalogShelves();
assert.strictEqual(musicShelves.getMusicCatalogShelves(), shelfReference,
  "Shelf reads reuse the same array while the catalog revision is unchanged.");
musicShelves.getMusicEntryLocation(shelfReference[0].entryKeys[4]);
assert.strictEqual(musicShelves.getMusicCatalogShelves(), shelfReference,
  "Location and focus-memory reads do not invalidate the shelf cache.");
musicCatalog.configureMusicCatalog({ sort: "title" }, "");
const rebuiltShelfReference = musicShelves.getMusicCatalogShelves();
assert.notStrictEqual(rebuiltShelfReference, shelfReference,
  "A catalog version change rebuilds the shelf projection.");
assert.strictEqual(musicShelves.getMusicCatalogShelves(), rebuiltShelfReference,
  "The rebuilt shelf projection is reused on the hot path.");

musicCatalog.configureMusicCatalog({ layout: "array", show: "tracks", group: "none", sort: "added" }, "");
const shelves = musicShelves.getMusicCatalogShelves();
assert.deepEqual(Array.from(shelves, shelf => shelf.entryKeys.length), [20, 9]);
const firstEntry = musicCatalog.getMusicEntryByKey(shelves[0].entryKeys[0]);
const firstShelfLastEntry = musicCatalog.getMusicEntryByKey(shelves[0].entryKeys.at(-1));
const lastShelfFirstEntry = musicCatalog.getMusicEntryByKey(shelves[1].entryKeys[0]);
const lastShelfLastEntry = musicCatalog.getMusicEntryByKey(shelves.at(-1).entryKeys.at(-1));

musicCatalog.focusMusicEntry(firstEntry.key);
const wrappedRow = musicShelves.navigateMusicEntry(firstEntry.recordIndex, "row", -1);
assert.strictEqual(wrappedRow, firstShelfLastEntry, "ARRAY row navigation wraps around its shelf.");
assert.equal(musicApplication.catalogFocus.entryKey, firstEntry.key,
  "Pure navigation returns a destination without committing public focus.");

musicShelves.getMusicEntryLocation(firstShelfLastEntry.key);
musicCatalog.focusMusicEntry(lastShelfFirstEntry.key);
const wrappedLane = musicShelves.navigateMusicEntry(lastShelfFirstEntry.recordIndex, "lane", 1);
assert.strictEqual(wrappedLane, firstShelfLastEntry, "ARRAY lane navigation wraps and reuses the target shelf's remembered slot.");
assert.equal(musicApplication.catalogFocus.entryKey, lastShelfFirstEntry.key,
  "Lane navigation also leaves focus changes to its caller.");

musicCatalog.configureMusicCatalog({ layout: "shelf" }, "");
musicCatalog.focusMusicEntry(firstEntry.key);
assert.equal(musicShelves.navigateMusicEntry(firstEntry.recordIndex, "row", -1), undefined,
  "SHELF row navigation stops at the first slot.");
assert.equal(musicShelves.navigateMusicEntry(firstEntry.recordIndex, "lane", -1), undefined,
  "SHELF lane navigation stops before the first shelf.");

musicCatalog.configureMusicCatalog({ layout: "grid" }, "");
musicCatalog.focusMusicEntry(lastShelfLastEntry.key);
assert.equal(musicShelves.navigateMusicEntry(lastShelfLastEntry.recordIndex, "row", 1), undefined,
  "GRID row navigation stops at the final slot.");
assert.equal(musicShelves.navigateMusicEntry(lastShelfLastEntry.recordIndex, "lane", 1), undefined,
  "GRID lane navigation stops after the final shelf.");

musicCatalog.configureMusicCatalog({ layout: "array" }, "");
const sameAlbumTracks = trackEntries.filter(entry => entry.albumId === "album-rock").slice(0, 2);
const arrayStart = { lane: 2, row: displayLayout.MUSIC_ARRAY_VIEW.firstRow };
musicCatalog.focusMusicEntry(sameAlbumTracks[0].key);
const firstTrackCell = arrayLayout.musicArraySelectionCell(sameAlbumTracks[0].recordIndex, arrayStart);
assert.deepEqual({ ...arrayLayout.musicArrayCell(firstTrackCell) }, {
  lane: firstTrackCell.lane,
  row: firstTrackCell.row,
  foobarEntryKey: sameAlbumTracks[0].key,
  foobarTrackId: sameAlbumTracks[0].trackId,
}, "An array cell carries the clicked entry and track identity.");
musicCatalog.focusMusicEntry(sameAlbumTracks[1].key);
const secondTrackCell = arrayLayout.musicArraySelectionCell(sameAlbumTracks[1].recordIndex, firstTrackCell, {
  axis: "row", direction: 1,
});
assert.notEqual(firstTrackCell.row, secondTrackCell.row,
  "Two tracks from one album map to separate array cells.");
assert.equal(arrayLayout.musicArrayEntry(secondTrackCell).key, sameAlbumTracks[1].key,
  "Resolving a cell click returns the same stable track entry.");
assert.equal(arrayLayout.musicArrayCell(secondTrackCell).foobarTrackId, sameAlbumTracks[1].trackId);

musicCatalog.configureMusicCatalog({ group: "genre", sort: "artist" }, "no-synthetic-match");
assert.equal(musicCatalog.getMusicCatalogGroups().length, 0, "An empty query result has no visible groups.");
assert.equal(musicShelves.getMusicCatalogShelves().length, 0, "An empty query result has no shelves.");
assert.equal(musicCatalog.getMusicFocusedEntry(sameAlbumTracks[1].recordIndex), undefined,
  "A filtered-out entry cannot be resolved as the current visible focus.");
musicCatalog.configureMusicCatalog({}, "");
assert.equal(musicCatalog.getMusicCatalogGroups().length, 2, "Clearing the query restores catalog groups.");
assert.ok(musicShelves.getMusicCatalogShelves().length > 0, "Clearing the query rebuilds the shelf projection.");
assert.equal(musicCatalog.getMusicFocusedEntry(sameAlbumTracks[1].recordIndex).key, sameAlbumTracks[1].key,
  "Clearing the query restores a still-valid focused entry.");

for (const layout of ["shelf", "array", "grid"]) {
  const result = displayLayout.resolveMusicDisplayLayout(layout, ["shelf", "array", "grid"]);
  assert.equal(result.requested, layout);
  assert.equal(result.effective, layout);
  assert.equal(result.grid, layout === "grid");
}
assert.deepEqual({ ...displayLayout.resolveMusicDisplayLayout("grid", ["shelf", "array"]) }, {
  requested: "grid", effective: "array", canvas: "array", grid: false,
}, "An unavailable view retains the request and reports the array capability fallback.");
assert.deepEqual({ ...displayLayout.resolveMusicDisplayLayout("grid", []) }, {
  requested: "grid", effective: "array", canvas: "array", grid: false,
}, "An empty capability set retains the request with a safe array fallback.");

const arrayView = displayLayout.MUSIC_ARRAY_VIEW;
for (const key of ["columnSpacing", "rowSpacing", "centerLane", "centerRow", "firstRow", "floorY", "inspectionZ", "yaw", "elevation", "span", "distance"])
  assert.equal(typeof arrayView[key], "number", `MUSIC_ARRAY_VIEW.${key} remains a numeric public coordinate/camera value.`);
for (const coordinate of Object.values(arrayView.aim)) assert.equal(typeof coordinate, "number");
assert.deepEqual({ ...displayLayout.musicArrayPosition({ lane: 2, row: 15.5 }) }, { x: 0, y: -4.6, z: 0 });
const offsetPosition = displayLayout.musicArrayPosition({ lane: 3, row: 17 });
assert.equal(offsetPosition.x, 5.2);
assert.equal(offsetPosition.y, -4.6);
assert.ok(Math.abs(offsetPosition.z - 0.93) < 1e-12, "Array depth follows row spacing without floating-point rounding assumptions.");
assert.equal(displayLayout.musicArrayPosition.length, 1, "Array positioning has no theme parameter.");
assert.equal(displayLayout.resolveMusicDisplayLayout.length, 2, "Capability resolution has no theme parameter.");
assert.equal(displayLayout.musicPointerDragThreshold.length, 1, "Pointer threshold depends only on public layout.");
assert.equal(Object.hasOwn(arrayView, "theme"), false);
assert.strictEqual(records, originalRecords);

// Library refresh replaces the canonical records without changing view or focus.
musicCatalog.configureMusicCatalog({ show: "albums" }, "");
musicCatalog.focusMusicEntry(records[0].id);
const priorCatalogVersion = musicCatalog.getMusicCatalogVersion();
const priorApplicationRevision = musicApplication.catalogRevision;
const priorShelves = musicShelves.getMusicCatalogShelves();
const refreshedRecords = records.map((record, index) => index ? record : {
  ...record, title: "Refreshed Album", album: { ...record.album, title: "Refreshed Album" },
});
replaceRecords(refreshedRecords);
assert.equal(musicApplication.catalogRevision, priorApplicationRevision);
assert.ok(musicCatalog.getMusicCatalogVersion() > priorCatalogVersion,
  "A same-view library refresh invalidates shared grid/cell consumers.");
assert.equal(musicCatalog.getMusicFocusedEntry(0).key, records[0].id,
  "Refreshing metadata preserves the focused album identity.");
assert.equal(musicCatalog.getMusicFocusedEntry(0).album.title, "Refreshed Album");
assert.notStrictEqual(musicShelves.getMusicCatalogShelves(), priorShelves);
assert.match(foobarCatalog.foobarGridMarkup(0), /Refreshed Album/,
  "The shared grid markup reflects refreshed metadata without changing selection.");

console.log("Public music catalog, shelf, array identity/navigation, display capability and neutral layout contracts passed with synthetic records.");

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function transpileProduction(source, filename, moduleKind) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: moduleKind },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0,
    `${filename} transpilation failed: ${errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
  return result.outputText;
}

function loadProductionCommonJs(source, filename) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: specifier => { throw new Error(`Unexpected ${filename} import: ${specifier}`); },
  };
  const sourceName = filename.endsWith(".ts") ? filename : `${filename}.ts`;
  vm.runInNewContext(transpileProduction(source, sourceName, ts.ModuleKind.CommonJS), sandbox, { filename });
  return module.exports;
}

const presentationSource = await readFile(path.join(project, "src/music-presentation.ts"), "utf8");
const { MusicPresentation } = loadProductionCommonJs(presentationSource, "music-presentation.js");
const musicAppSource = await readFile(path.join(project, "src/music-app.ts"), "utf8");
const musicAppAst = ts.createSourceFile("music-app.ts", musicAppSource, ts.ScriptTarget.Latest, true);
const requiredAppFunctions = ["navigationSelection", "stepAlbum", "commitSelection", "select", "applyMusicView"];
const appFunctionNodes = musicAppAst.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) && requiredAppFunctions.includes(statement.name?.text || ""));
assert.deepEqual(
  [...new Set(appFunctionNodes.map(statement => statement.name.text))].sort(),
  [...requiredAppFunctions].sort(),
  "Extract the production selection, navigation and view-update functions for the pending focus regression.",
);
const productionAppFunctions = transpileProduction(
  appFunctionNodes.map(statement => statement.getText(musicAppAst)).join("\n\n") +
    "\n globalThis.productionApp = { navigationSelection, stepAlbum, commitSelection, select, applyMusicView };",
  "music-app-selection-regression.ts",
  ts.ModuleKind.None,
);

async function runPendingTrackSelectionRegression(changeShow = false) {
  const fixture = await createTrackFixture();
  const { musicCatalog, musicShelves, applicationState: applicationStateModule, records: fixtureRecords } = fixture;
  const musicApplication = applicationStateModule.musicApplication;
  musicCatalog.configureMusicCatalog({ layout: "shelf", show: "tracks", group: "none", sort: "added" }, "");
  musicApplication.selectAlbum(0, fixtureRecords[0].id);
  musicApplication.activeTab = "about";
  musicApplication.infoScrollTop = 84;
  const entries = musicCatalog.getMusicDisplayEntries();
  const start = entries.find(entry => entry.albumId === "album-rock" && entry.track?.trackNumber === 24);
  const requestedTrack = entries.find(entry => entry.albumId === "album-jazz" && entry.track?.trackNumber === 2);
  assert.ok(start?.track && requestedTrack?.track, "The fixture contains a final A track and a non-first B track.");
  assert.notEqual(requestedTrack.key, entries.find(entry => entry.albumId === "album-jazz")?.key,
    "The pending request targets a non-first track from album B.");
  musicCatalog.focusMusicEntry(start.key);

  const menuCallbacks = [];
  const browseCallbacks = [];
  const updateSelectionCalls = [];
  const sceneCalls = [];
  const effectsCalls = [];
  const appScope = vm.createContext({
    musicApplication,
    records: fixtureRecords,
    presentation: undefined,
    ready: true,
    boot: undefined,
    libraryRebuilding: false,
    libraryIntent: undefined,
    musicCatalog,
    musicShelves,
    configureMusicCatalog: musicCatalog.configureMusicCatalog,
    getMusicCatalogRecords: musicCatalog.getMusicCatalogRecords,
    getMusicFocusedEntry: musicCatalog.getMusicFocusedEntry,
    getMusicEntryByKey: musicCatalog.getMusicEntryByKey,
    focusMusicEntry: musicCatalog.focusMusicEntry,
    navigateMusicEntry: musicShelves.navigateMusicEntry,
    wrap: (value, count) => count > 0 ? ((value % count) + count) % count : 0,
    cancelTrackReveal: () => {},
    updateSelection: () => updateSelectionCalls.push(musicApplication.selectedIndex),
    savePrefs: () => {},
    refreshFoobarSceneForLayoutChange: () => sceneCalls.push("layout"),
    foobarShell: { refreshCatalog() {} },
    preferences: { style: { design: "rhine" } },
    scene: { setMusicStyle: () => sceneCalls.push("style"), switchMusicAlbum: index => sceneCalls.push(`detail:${index}`) },
    effects: { play: value => effectsCalls.push(value) },
  });
  vm.runInContext(productionAppFunctions, appScope, { filename: "music-app-selection-regression.js" });
  const app = appScope.productionApp;
  const presentation = new MusicPresentation({
    presentationReady: () => true,
    archiveReady: () => true,
    archiveInteractive: () => true,
    enterCamera() {},
    returnCamera() {},
    select: request => app.commitSelection(request.index, request.navigation, false, request.entryKey),
    switchDetail: request => app.commitSelection(request.index, request.navigation, true, request.entryKey),
    prepareMenu() {},
    showMenu() {},
    hideMenu: done => menuCallbacks.push(done),
    hideBrowse: done => browseCallbacks.push(done),
    showBrowse() {},
    mode: mode => { musicApplication.mode = mode; },
  });
  appScope.presentation = presentation;

  presentation.open();
  assert.equal(presentation.phase, "opening");
  browseCallbacks.shift()();
  presentation.update();
  assert.equal(presentation.phase, "detail", "Album A is fully open before the switch begins.");

  app.stepAlbum(1);
  app.stepAlbum(1);
  assert.equal(presentation.phase, "switch-hiding", "The transition holds B's selection until the menu exit completes.");
  assert.equal(presentation.pendingSelection.index, 1);
  assert.equal(presentation.pendingSelection.entryKey, requestedTrack.key,
    "The canonical album index and non-first track key remain paired in the pending request.");
  assert.equal(musicApplication.selectedIndex, 0, "Album A remains the committed selection during the transition.");
  assert.equal(musicApplication.catalogFocus.entryKey, requestedTrack.key,
    "The live focus initially points to B's requested track.");

  app.applyMusicView(changeShow ? { show: "albums" } : { layout: "grid" });
  assert.equal(updateSelectionCalls.at(-1), 0,
    "View refresh still updates the committed A-side UI while B is pending.");
  assert.equal(presentation.pendingSelection.index, 1, "The view change leaves the pending canonical target intact.");
  if (!changeShow) musicCatalog.focusMusicEntry(start.key);
  const finishMenuExit = menuCallbacks.shift();
  assert.equal(typeof finishMenuExit, "function", "The real presentation captured its menu-exit completion.");
  finishMenuExit();
  assert.equal(presentation.phase, "switching");
  assert.equal(musicApplication.selectedIndex, 1, "Completing the transition commits album B.");
  assert.equal(musicApplication.activeTab, "about", "Changing view layout does not reset the information tab.");
  assert.equal(sceneCalls.at(-1), "detail:1", "The production detail-switch port receives B's canonical album index.");
  presentation.update();
  assert.equal(presentation.phase, "detail");

  if (changeShow) {
    assert.equal(musicApplication.catalogFocus.entryKey, "album-jazz",
      "When SHOW removes the pending track key, commit falls back to the visible album entry.");
    assert.equal(musicApplication.selectedTrackId, undefined,
      "The stale track identity is not retained after switching to ALBUMS.");
  } else {
    assert.equal(musicApplication.catalogFocus.entryKey, requestedTrack.key,
      "A layout-only refresh preserves the requested track identity through the real transition commit.");
    assert.equal(musicApplication.selectedTrackId, requestedTrack.track.id,
      "The committed same-album track identity survives the layout change.");
  }
  assert.ok(effectsCalls.length > 0, "The extracted production commit ran its mocked audio-feedback port.");
}

await runPendingTrackSelectionRegression(false);
await runPendingTrackSelectionRegression(true);
console.log("Production MusicPresentation + music-app pending TRACKS selection, layout update and stale-key fallback passed with synthetic records.");
