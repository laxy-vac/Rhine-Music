import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function transpile(source, filename) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: filename.endsWith(".ts") ? filename : `${filename}.ts`,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${filename} transpilation failed: ${errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
  return result.outputText;
}

function runModule(source, filename, requireMock) {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: requireMock };
  vm.runInNewContext(transpile(source, filename), sandbox, { filename });
  return module.exports;
}

function makeTrack(albumId, index, artist, title) {
  return {
    id: `${albumId}-track-${String(index + 1).padStart(2, "0")}`,
    albumId,
    title,
    artist,
    trackNumber: index + 1,
    discNumber: index < 20 ? 1 : 2,
    duration: 180 + index,
    format: "FLAC",
    codec: "FLAC",
    browserPlayable: true,
    audioUrl: `/audio/${albumId}/${index + 1}.flac`,
    relativePath: `${albumId}/disc-${index < 20 ? 1 : 2}/${index + 1}.flac`,
  };
}

function makeRecord({ id, title, artist, category, year, trackCount, needle = false }) {
  const tracks = Array.from({ length: trackCount }, (_, index) => makeTrack(
    id,
    index,
    needle && index === 0 ? "Guest Artist" : artist,
    needle && index === 0 ? "Needle" : `${title} Track ${String(index + 1).padStart(2, "0")}`,
  ));
  return {
    id,
    title,
    en: artist,
    department: artist,
    category,
    date: String(year),
    lead: artist,
    clearance: `${trackCount} tracks`,
    abstract: `${id}/`,
    findings: [category],
    source: "fixture",
    album: {
      id,
      title,
      artist,
      year,
      genreId: category.toLowerCase(),
      rawGenres: [category],
      folder: `${id}/`,
      coverUrl: `/covers/${id}.jpg`,
      tracks,
      producers: [],
      offline: false,
    },
  };
}

export async function createTrackFixture() {
  const records = [
    makeRecord({ id: "album-rock", title: "Rock Album", artist: "Alpha Artist", category: "Alternative", year: 2002, trackCount: 24, needle: true }),
    makeRecord({ id: "album-jazz", title: "Jazz Album", artist: "Beta Artist", category: "Jazz", year: 1994, trackCount: 5 }),
  ];
  const dataModule = { records };
  const viewSettingsSource = await readFile(path.join(project, "src/music-view-settings.ts"), "utf8");
  const viewSettings = runModule(viewSettingsSource, "music-view-settings.js", specifier => {
    throw new Error(`Unexpected view settings import: ${specifier}`);
  });
  const applicationStateSource = await readFile(path.join(project, "src/music-application-state.ts"), "utf8");
  const applicationState = runModule(applicationStateSource, "music-application-state.js", specifier => {
    if (specifier === "./music-view-settings") return viewSettings;
    throw new Error(`Unexpected app state import: ${specifier}`);
  });
  const musicCatalogSource = await readFile(path.join(project, "src/music-catalog.ts"), "utf8");
  const musicCatalog = runModule(musicCatalogSource, "music-catalog.js", specifier => {
    if (specifier === "./data") return dataModule;
    if (specifier === "./music-application-state") return applicationState;
    throw new Error(`Unexpected public catalog import: ${specifier}`);
  });
  const displayLayoutSource = await readFile(path.join(project, "src/music-display-layout.ts"), "utf8");
  const displayLayout = runModule(displayLayoutSource, "music-display-layout.js", specifier => {
    throw new Error(`Unexpected display layout import: ${specifier}`);
  });
  const musicShelvesSource = await readFile(path.join(project, "src/music-catalog-shelves.ts"), "utf8");
  const musicShelves = runModule(musicShelvesSource, "music-catalog-shelves.js", specifier => {
    if (specifier === "./data") return dataModule;
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-display-layout") return displayLayout;
    throw new Error(`Unexpected public shelves import: ${specifier}`);
  });
  const archiveLoopSource = await readFile(path.join(project, "src/archive-loop.ts"), "utf8");
  const archiveLoop = runModule(archiveLoopSource, "archive-loop.js", specifier => {
    if (specifier === "./data.ts") return {
      archiveColumns: [],
      columnFiles: () => [],
      fileLocation: () => ({ lane: 0, row: 12 }),
    };
    if (specifier === "./music-display-layout") return displayLayout;
    throw new Error(`Unexpected archive loop import: ${specifier}`);
  });
  const arrayLayoutSource = await readFile(path.join(project, "src/music-array-layout.ts"), "utf8");
  const arrayLayout = runModule(arrayLayoutSource, "music-array-layout.js", specifier => {
    if (specifier === "./archive-loop") return archiveLoop;
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-catalog-shelves") return musicShelves;
    if (specifier === "./music-display-layout") return displayLayout;
    throw new Error(`Unexpected public array layout import: ${specifier}`);
  });
  const catalogSource = await readFile(path.join(project, "src/foobar-catalog.ts"), "utf8");
  const shelvesSource = await readFile(path.join(project, "src/foobar-shelves.ts"), "utf8");
  const catalog = runModule(catalogSource, "foobar-catalog.js", (specifier) => {
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-application-state") return applicationState;
    if (specifier === "./music-view-settings") return viewSettings;
    throw new Error(`Unexpected catalog import: ${specifier}`);
  });
  const shelves = runModule(shelvesSource, "foobar-shelves.js", (specifier) => {
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-catalog-shelves") return musicShelves;
    throw new Error(`Unexpected shelf import: ${specifier}`);
  });
  return { catalog, shelves, musicCatalog, musicShelves, arrayLayout, displayLayout, applicationState, viewSettings, records,
    replaceRecords(next) { dataModule.records = next; } };
}

function setOptions(catalog, options, query = "") {
  catalog.configureFoobarCatalog(options, query);
}

function entrySequence(catalog, group) {
  return Array.from(group.records, (index) => catalog.getFoobarEntry(index));
}

function assertCatalogHasOnly(records, expectedNames, label) {
  assert.deepEqual(Array.from(records, (entry) => entry.name), expectedNames, label);
}

export async function runChecks() {
  const { catalog, shelves, records } = await createTrackFixture();
  const originalRecords = records;

  setOptions(catalog, { show: "albums", group: "genre", sort: "artist", layout: "array" });
  const albumEntries = catalog.getFoobarDisplayEntries();
  assert.equal(albumEntries.length, 2, "album mode should create one entry per canonical album");
  assert.deepEqual(Array.from(albumEntries, (entry) => [entry.index, entry.recordIndex]), [[0, 0], [1, 1]]);
  assert.deepEqual(Array.from(catalog.getFoobarCatalogRecords()), [0, 1]);
  assert.equal(shelves.getFoobarShelves().length, 1);

  setOptions(catalog, { show: "tracks", group: "genre", sort: "artist", layout: "array" });
  const trackEntries = catalog.getFoobarDisplayEntries();
  assert.equal(trackEntries.length, 29, "track mode should flatten 24 + 5 songs");
  assert.equal(new Set(Array.from(trackEntries, (entry) => entry.key)).size, 29, "each track needs a distinct stable key");
  assert.equal(trackEntries[0].track.title, "Needle");
  assert.equal(trackEntries[0].record.title, "Needle", "the display record uses the track title");
  assert.equal(trackEntries[0].record.en, "Guest Artist", "the display record uses the track artist");
  assert.equal(trackEntries[0].record.album, records[0].album, "track entries keep their parent album and cover source");
  assert.deepEqual(Array.from(shelves.getFoobarShelves(), (shelf) => shelf.records.length), [20, 9], "twenty-slot shelves spill groups without gaps");
  assert.strictEqual(records, originalRecords, "track mode must not replace the album-based records array");
  assert.equal(records.length, 2, "the canonical album count remains two");

  setOptions(catalog, { show: "tracks", group: "genre", sort: "added" });
  let groups = catalog.getFoobarCatalogGroups();
  assertCatalogHasOnly(groups, ["Alternative", "Jazz"], "genre groups sort by name");
  assert.deepEqual(Array.from(groups, (group) => group.records.length), [24, 5]);

  setOptions(catalog, { show: "tracks", group: "decade", sort: "added" });
  groups = catalog.getFoobarCatalogGroups();
  assertCatalogHasOnly(groups, ["1990s", "2000s"], "decade grouping inherits the parent album year");
  assert.deepEqual(Array.from(groups, (group) => group.records.length), [5, 24]);

  setOptions(catalog, { show: "tracks", group: "az", sort: "added" });
  groups = catalog.getFoobarCatalogGroups();
  assertCatalogHasOnly(groups, ["A", "B", "G"], "artist-initial grouping uses the individual track artist");
  assert.deepEqual(Array.from(groups, (group) => group.records.length), [23, 5, 1]);

  setOptions(catalog, { show: "tracks", group: "none", sort: "added" });
  groups = catalog.getFoobarCatalogGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual(Array.from(groups[0].records), Array.from({ length: 29 }, (_, index) => index), "ADDED keeps source album and disc/track order");

  setOptions(catalog, { show: "tracks", group: "none", sort: "artist" });
  let ordered = entrySequence(catalog, catalog.getFoobarCatalogGroups()[0]);
  const artists = ordered.map((entry) => entry.track.artist || entry.record.album.artist);
  assert.deepEqual(artists, [...artists].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true })), "artist sort uses each track artist");
  assert.equal(ordered[0].recordIndex, 0);

  setOptions(catalog, { show: "tracks", group: "none", sort: "title" });
  ordered = entrySequence(catalog, catalog.getFoobarCatalogGroups()[0]);
  const titles = ordered.map((entry) => entry.track.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true })), "title sort uses each track title");

  setOptions(catalog, { show: "tracks", group: "none", sort: "year" });
  ordered = entrySequence(catalog, catalog.getFoobarCatalogGroups()[0]);
  assert.equal(ordered[0].recordIndex, 1, "year sort places the 1994 parent album before the 2002 album");
  assert.equal(ordered.at(-1).recordIndex, 0);

  setOptions(catalog, { show: "tracks", group: "genre", sort: "artist" }, "Needle");
  groups = catalog.getFoobarCatalogGroups();
  const needleEntries = groups.flatMap((group) => entrySequence(catalog, group));
  assert.equal(needleEntries.length, 1, "a track query must not include sibling tracks");
  assert.equal(needleEntries[0].track.title, "Needle");
  assert.deepEqual(Array.from(catalog.getFoobarCatalogRecords()), [0], "main filtering still returns canonical album indexes");

  setOptions(catalog, { show: "tracks", group: "none", sort: "added" });
  groups = catalog.getFoobarCatalogGroups();
  const firstTrack = catalog.getFoobarEntry(groups[0].records[0]);
  const secondTrack = catalog.getFoobarEntry(groups[0].records[1]);
  catalog.setFoobarFocus(firstTrack.key);
  const firstLocation = shelves.getFoobarEntryLocation(firstTrack.key);
  assert.equal(firstLocation.slot, 0);
  const navigatedAlbum = shelves.navigateFoobar(firstTrack.recordIndex, "row", 1);
  assert.equal(navigatedAlbum, 0, "same-album row navigation returns the canonical album index");
  assert.equal(catalog.getFoobarFocusedEntry(0).key, secondTrack.key, "same-album navigation still moves the entry focus");

  const allShelves = shelves.getFoobarShelves();
  const rememberedTarget = catalog.getFoobarEntry(allShelves[1].records[6]);
  const currentEntry = catalog.getFoobarEntry(allShelves[0].records[7]);
  shelves.getFoobarEntryLocation(rememberedTarget.key);
  catalog.setFoobarFocus(currentEntry.key);
  shelves.getFoobarEntryLocation(currentEntry.key);
  assert.equal(shelves.navigateFoobar(currentEntry.recordIndex, "lane", 1), rememberedTarget.recordIndex, "lane navigation returns the target album index");
  assert.equal(catalog.getFoobarFocusedEntry(rememberedTarget.recordIndex).key, rememberedTarget.key, "lane navigation remembers the target shelf slot");

  const toolMarkup = catalog.foobarCatalogMarkup();
  assert.equal((toolMarkup.match(/class="foobar-layout-mark"/g) || []).length, 3, "all three layout choices receive the mark hook");
  const gridMarkup = catalog.foobarGridMarkup(0, rememberedTarget.key);
  assert.equal((gridMarkup.match(/class="foobar-grid-card foobar-album-item foobar-track-card/g) || []).length, 29, "track grid renders one small-cover card per track");
  assert.equal((gridMarkup.match(/data-foobar-track=/g) || []).length, 29);
  assert.equal((gridMarkup.match(/data-foobar-entry=/g) || []).length, 29);
  assert.match(gridMarkup, /data-foobar-record="1" data-foobar-entry="track\|album-jazz\|album-jazz-track-03" data-foobar-track="album-jazz-track-03"/);
  assert.match(gridMarkup, /foobar-album-grid/);
  assert.doesNotMatch(gridMarkup, /foobar-track-list|foobar-track-row|foobar-track-album/);

  setOptions(catalog, { show: "albums", group: "genre", sort: "artist" });
  const restoredAlbumEntries = catalog.getFoobarDisplayEntries();
  assert.deepEqual(Array.from(restoredAlbumEntries, (entry) => [entry.index, entry.recordIndex]), [[0, 0], [1, 1]], "switching back restores canonical album entries");
  assert.deepEqual(Array.from(catalog.getFoobarCatalogRecords()), [0, 1]);
  assert.deepEqual(Array.from(shelves.getFoobarShelves(), (shelf) => shelf.records.length), [2]);
  assert.strictEqual(records, originalRecords);
  assert.equal(records.length, 2);

  console.log("Foobar TRACKS catalog, focus, navigation, shelves and cards passed.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runChecks();
