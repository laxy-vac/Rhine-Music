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
  const markupSource = await readFile(path.join(project, "src/music-catalog-markup.ts"), "utf8");
  const catalogMarkup = runModule(markupSource, "music-catalog-markup.js", specifier => {
    if (specifier === "./music-application-state") return applicationState;
    if (specifier === "./music-view-settings") return viewSettings;
    if (specifier === "./music-catalog") return musicCatalog;
    throw new Error(`Unexpected catalog markup import: ${specifier}`);
  });
  return { catalog: musicCatalog, shelves: musicShelves, musicCatalog, musicShelves, arrayLayout, displayLayout,
    applicationState, viewSettings, catalogMarkup, records,
    replaceRecords(next) { dataModule.records = next; } };
}

function configure(catalog, options, query = "") {
  catalog.configureMusicCatalog(options, query);
}

function entriesForGroup(catalog, group) {
  return Array.from(group.entryKeys, key => catalog.getMusicEntryByKey(key)).filter(Boolean);
}

function assertGroupNames(groups, expectedNames, label) {
  assert.deepEqual(Array.from(groups, group => group.name), expectedNames, label);
}

export async function runChecks() {
  const fixture = await createTrackFixture();
  const { musicCatalog: catalog, musicShelves: shelves, applicationState, records, catalogMarkup } = fixture;
  const musicApplication = applicationState.musicApplication;
  const originalRecords = records;

  configure(catalog, { layout: "shelf", show: "albums", group: "genre", sort: "artist" });
  const albumEntries = catalog.getMusicDisplayEntries();
  assert.equal(albumEntries.length, 2, "album SHOW creates one public entry per canonical album");
  assert.deepEqual(Array.from(albumEntries, entry => [entry.index, entry.recordIndex]), [[0, 0], [1, 1]]);
  assert.deepEqual(Array.from(catalog.getMusicCatalogRecords()), [0, 1]);
  assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [2],
    "SHELF keeps the two visible album entries together regardless of their group labels");

  configure(catalog, { show: "tracks", group: "genre", sort: "artist" });
  const trackEntries = catalog.getMusicDisplayEntries();
  assert.equal(trackEntries.length, 29, "TRACKS flattens 24 + 5 songs");
  assert.equal(new Set(trackEntries.map(entry => entry.key)).size, 29, "each track has a distinct stable key");
  assert.equal(trackEntries[0].track.title, "Needle");
  assert.equal(trackEntries[0].record.title, "Needle", "the public display record uses the track title");
  assert.equal(trackEntries[0].record.en, "Guest Artist", "the public display record uses the track artist");
  assert.strictEqual(trackEntries[0].record.album, records[0].album, "track entries retain the canonical album and cover source");
  assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [20, 9],
    "the public shelf renderer fills twenty entries before continuing the next group");
  assert.strictEqual(records, originalRecords, "TRACKS never replaces the album-based canonical records array");
  assert.equal(records.length, 2);

  configure(catalog, { layout: "array", group: "genre", sort: "added" });
  assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [24, 5],
    "grouped ARRAY keeps each public catalog group in its own column");
  configure(catalog, { layout: "shelf", group: "decade", sort: "added" });
  let groups = catalog.getMusicCatalogGroups();
  assertGroupNames(groups, ["1990s", "2000s"], "decade grouping inherits the parent album year");
  assert.deepEqual(Array.from(groups, group => group.entryKeys.length), [5, 24]);

  configure(catalog, { group: "az", sort: "added" });
  groups = catalog.getMusicCatalogGroups();
  assertGroupNames(groups, ["A", "B", "G"], "A-Z grouping uses each track's artist");
  assert.deepEqual(Array.from(groups, group => group.entryKeys.length), [23, 5, 1]);

  configure(catalog, { group: "none", sort: "added" });
  groups = catalog.getMusicCatalogGroups();
  assert.equal(groups.length, 1);
  assert.deepEqual(Array.from(groups[0].entryKeys), Array.from(trackEntries, entry => entry.key),
    "ADDED keeps source album and disc/track order");

  configure(catalog, { sort: "artist" });
  let ordered = entriesForGroup(catalog, catalog.getMusicCatalogGroups()[0]);
  const artists = ordered.map(entry => entry.track.artist || entry.record.album.artist);
  assert.deepEqual(artists, [...artists].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true })),
    "ARTIST sorting uses each track artist");
  configure(catalog, { sort: "title" });
  ordered = entriesForGroup(catalog, catalog.getMusicCatalogGroups()[0]);
  const titles = ordered.map(entry => entry.track.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true })),
    "TITLE sorting uses each track title");
  configure(catalog, { sort: "year" });
  ordered = entriesForGroup(catalog, catalog.getMusicCatalogGroups()[0]);
  assert.equal(ordered[0].recordIndex, 1, "YEAR sorting inherits the 1994 parent album year");
  assert.equal(ordered.at(-1).recordIndex, 0);

  configure(catalog, { group: "genre", sort: "artist" }, "Needle");
  groups = catalog.getMusicCatalogGroups();
  const needleEntries = groups.flatMap(group => entriesForGroup(catalog, group));
  assert.equal(needleEntries.length, 1, "a track query excludes its sibling tracks");
  assert.equal(needleEntries[0].track.title, "Needle");
  assert.deepEqual(Array.from(catalog.getMusicCatalogRecords()), [0], "filtered results retain canonical parent indexes");

  configure(catalog, { group: "none", sort: "added" });
  const allShelves = shelves.getMusicCatalogShelves();
  const firstTrack = catalog.getMusicEntryByKey(allShelves[0].entryKeys[0]);
  const secondTrack = catalog.getMusicEntryByKey(allShelves[0].entryKeys[1]);
  catalog.focusMusicEntry(firstTrack.key);
  const firstLocation = shelves.getMusicEntryLocation(firstTrack.key);
  assert.equal(firstLocation.slot, 0);
  const rowTarget = shelves.navigateMusicEntry(firstTrack.recordIndex, "row", 1);
  assert.equal(rowTarget.key, secondTrack.key, "row navigation returns the next stable entry");
  assert.equal(musicApplication.catalogFocus.entryKey, firstTrack.key,
    "pure navigation leaves focus changes to its caller");
  catalog.focusMusicEntry(rowTarget.key);
  assert.equal(musicApplication.catalogFocus.entryKey, secondTrack.key);

  const rememberedTarget = catalog.getMusicEntryByKey(allShelves[1].entryKeys[6]);
  const currentEntry = catalog.getMusicEntryByKey(allShelves[0].entryKeys[7]);
  shelves.getMusicEntryLocation(rememberedTarget.key);
  catalog.focusMusicEntry(currentEntry.key);
  const laneTarget = shelves.navigateMusicEntry(currentEntry.recordIndex, "lane", 1);
  assert.equal(laneTarget.key, rememberedTarget.key, "lane navigation restores the destination shelf slot");
  assert.equal(musicApplication.catalogFocus.entryKey, currentEntry.key,
    "lane navigation does not commit public focus");

  const tools = catalogMarkup.musicCatalogToolsMarkup();
  assert.match(tools, /data-foobar-catalog="show"/);
  assert.match(tools, /data-foobar-catalog="group"/);
  assert.match(tools, /data-foobar-catalog="sort"/);
  assert.match(tools, /aria-label="LAYOUT"/, "the Punk browse toolbar exposes the shared layout choices");
  for (const layout of ["shelf", "array", "grid"]) {
    assert.match(tools, new RegExp(`data-music-layout="${layout}"`));
  }
  assert.doesNotMatch(tools, /data-foobar-catalog="layout"/, "layout uses the public view handler");
  assert.match(tools, /data-action="foobar-random"/, "RANDOM PICK remains part of the Punk shell");

  const gridMarkup = catalogMarkup.musicGridMarkup(1, rememberedTarget.key);
  assert.equal((gridMarkup.match(/class="foobar-grid-card foobar-album-item foobar-track-card/g) || []).length, 29,
    "the shared grid renders one card per public track entry");
  assert.equal((gridMarkup.match(/data-foobar-track=/g) || []).length, 29);
  assert.equal((gridMarkup.match(/data-foobar-entry=/g) || []).length, 29);
  assert.match(gridMarkup, /data-foobar-record="1" data-foobar-entry="track\|album-jazz\|album-jazz-track-03" data-foobar-track="album-jazz-track-03"/);
  assert.match(gridMarkup, /foobar-album-grid/);
  assert.doesNotMatch(gridMarkup, /foobar-track-list|foobar-track-row|foobar-track-album/);

  configure(catalog, { show: "albums", group: "genre", sort: "artist" });
  const restoredAlbumEntries = catalog.getMusicDisplayEntries();
  assert.deepEqual(Array.from(restoredAlbumEntries, entry => [entry.index, entry.recordIndex]), [[0, 0], [1, 1]],
    "switching back to ALBUMS restores canonical entries");
  assert.deepEqual(Array.from(catalog.getMusicCatalogRecords()), [0, 1]);
  assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => shelf.entryKeys.length), [2]);
  assert.strictEqual(records, originalRecords);
  assert.equal(records.length, 2);

  console.log("Public TRACKS catalog, focus, navigation, shelves and shared grid markup passed with synthetic records.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runChecks();
