import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import * as metadataValues from "../src/music-metadata-values.mjs";

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

function makeTrack(albumId, index, artist, title, artists) {
  return {
    id: `${albumId}-track-${String(index + 1).padStart(2, "0")}`,
    albumId,
    title,
    artist,
    ...(artists ? { artists: [...artists] } : {}),
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

function makeRecord({ id, title, artist, category, year, trackCount, needle = false, albumArtists, trackArtist, trackArtists }) {
  const tracks = Array.from({ length: trackCount }, (_, index) => makeTrack(
    id,
    index,
    needle && index === 0 ? "Guest Artist" : artist,
    needle && index === 0 ? "Needle" : `${title} Track ${String(index + 1).padStart(2, "0")}`,
    needle && index === 0 ? undefined : trackArtists,
  ));
  if (trackArtist && !needle) for (const track of tracks) track.artist = trackArtist;
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
      ...(albumArtists ? { artists: [...albumArtists] } : {}),
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

export function createArtistCreditRecords() {
  return [
    makeRecord({ id: "lead-credit-b", title: "B Lead Album", artist: "Album Lead / Album Guest B", albumArtists: ["Album Lead", "Album Guest B"],
      trackArtist: "Track Lead / GuestBravo", trackArtists: ["Track Lead", "GuestBravo"], category: "Rock", year: 2001, trackCount: 1 }),
    makeRecord({ id: "lead-credit-a", title: "A Lead Album", artist: "Album Lead / Album Guest A", albumArtists: ["Album Lead", "Album Guest A"],
      trackArtist: "Track Lead / GuestAlpha", trackArtists: ["Track Lead", "GuestAlpha"], category: "Rock", year: 2000, trackCount: 1 }),
    makeRecord({ id: "ac-dc-credit", title: "AC/DC Album", artist: "AC/DC", albumArtists: ["AC/DC"],
      trackArtist: "AC/DC", trackArtists: ["AC/DC"], category: "Rock", year: 1979, trackCount: 1 }),
  ];
}

export function createGridPaginationRecords() {
  return [
    makeRecord({ id: "grid-alpha", title: "Alpha Grid", artist: "Alpha Artist", category: "Alternative", year: 1992, trackCount: 64, needle: true }),
    makeRecord({ id: "grid-classical", title: "Classical Grid", artist: "Classical Artist", category: "Classical", year: 1978, trackCount: 55 }),
    makeRecord({ id: "grid-jazz", title: "Jazz Grid", artist: "Jazz Artist", category: "Jazz", year: 1964, trackCount: 47 }),
    makeRecord({ id: "grid-pop", title: "Pop Grid", artist: "Pop Artist", category: "Pop", year: 2014, trackCount: 45 }),
  ];
}

export function createFortyFiveAlbumRecords() {
  return Array.from({ length: 45 }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return makeRecord({ id: `matrix-album-${number}`, title: `Matrix Album ${number}`, artist: "Matrix Artist",
      category: "Matrix", year: 1980 + index, trackCount: 1 });
  });
}

export async function createTrackFixture(seedRecords) {
  const records = seedRecords || [
    makeRecord({ id: "album-rock", title: "Rock Album", artist: "Alpha Artist", category: "Alternative", year: 2002, trackCount: 24, needle: true }),
    makeRecord({ id: "album-jazz", title: "Jazz Album", artist: "Beta Artist", category: "Jazz", year: 1994, trackCount: 5 }),
  ];
  const musicOrderSource = await readFile(path.join(project, "src/music-order.ts"), "utf8");
  const musicOrder = runModule(musicOrderSource, "music-order.js", specifier => {
    if (specifier === "./music-metadata-values.mjs") return metadataValues;
    throw new Error(`Unexpected music order import: ${specifier}`);
  });
  const dataSource = await readFile(path.join(project, "src/data.ts"), "utf8");
  const archiveContent = { records, categories: [], columns: [] };
  const dataModule = runModule(dataSource, "data.js", specifier => {
    if (specifier === "../content/archives.json") return { __esModule: true, default: archiveContent };
    if (specifier === "./music-order.ts") return musicOrder;
    throw new Error(`Unexpected data import: ${specifier}`);
  });
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
    if (specifier === "./music-order.ts") return musicOrder;
    if (specifier === "./music-application-state") return applicationState;
    throw new Error(`Unexpected public catalog import: ${specifier}`);
  });
  const musicGridPageSource = await readFile(path.join(project, "src/music-grid-page.ts"), "utf8");
  const musicGridPage = runModule(musicGridPageSource, "music-grid-page.js", specifier => {
    if (specifier === "./music-application-state") return applicationState;
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-view-settings") return viewSettings;
    throw new Error(`Unexpected grid page import: ${specifier}`);
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
  const interfaceLabelsSource = await readFile(path.join(project, "src/music-interface-labels.ts"), "utf8");
  const interfaceLabels = runModule(interfaceLabelsSource, "music-interface-labels.js", specifier => {
    throw new Error(`Unexpected music interface labels import: ${specifier}`);
  });
  const catalogMarkup = runModule(markupSource, "music-catalog-markup.js", specifier => {
    if (specifier === "./music-application-state") return applicationState;
    if (specifier === "./i18n") return { trUi: key => ({
      "显示": "SHOW", "布局": "LAYOUT", "分组": "GROUP", "排序": "SORT", "每页数量": "PER PAGE",
    })[key] ?? key };
    if (specifier === "./music-interface-labels") return interfaceLabels;
    if (specifier === "./music-view-settings") return viewSettings;
    if (specifier === "./music-catalog") return musicCatalog;
    if (specifier === "./music-grid-page") return musicGridPage;
    throw new Error(`Unexpected catalog markup import: ${specifier}`);
  });
  return { catalog: musicCatalog, shelves: musicShelves, musicCatalog, musicShelves, musicGridPage, arrayLayout, displayLayout,
    applicationState, viewSettings, catalogMarkup, records, dataModule, musicOrder,
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
  const { musicCatalog: catalog, musicShelves: shelves, applicationState, records, catalogMarkup, dataModule, musicOrder } = fixture;
  const musicApplication = applicationState.musicApplication;
  const originalRecords = records;

  const splitCases = [
    ["Lead / Guest", "Lead"], ["Lead/Guest", "Lead"], ["Diana Ross/Marvin Gaye", "Diana Ross"],
    ["张学友/黎明", "张学友"], ["Lead／Guest", "Lead"], ["MCR/Paramore", "MCR"],
    ["Lead; Guest", "Lead"], ["Lead；Guest", "Lead"],
    ["Lead、Guest", "Lead"], ["Lead，Guest", "Lead"], ["Lead|Guest", "Lead"],
    ["Lead feat. Guest", "Lead"], ["Lead ft. Guest", "Lead"], ["Lead FT. Guest", "Lead"],
    ["Lead featuring Guest", "Lead"], ["Lead (Feat. Guest)", "Lead"], ["Lead (featuring Guest)", "Lead"],
    ["Lead with Guest", "Lead"], ["Lead x Guest", "Lead"], ["Lead + Guest", "Lead"], ["张三&李四", "张三"],
    ["AC/DC", "AC/DC"], ["Simon & Garfunkel", "Simon & Garfunkel"], ["Simon & Garfunkel feat. Guest", "Simon & Garfunkel"],
    ["Hall & Oates", "Hall & Oates"], ["Florence + the Machine", "Florence + the Machine"],
    ["She & Him", "She & Him"], ["Dan + Shay", "Dan + Shay"], ["MAN WITH A MISSION", "MAN WITH A MISSION"],
    ["Earth, Wind & Fire", "Earth, Wind & Fire"],
    ["Lead, Guest", "Lead, Guest"], ["Dr. Dre", "Dr. Dre"], ["Smith-Jones", "Smith-Jones"],
    ["张和李", "张和李"], ["Max", "Max"], ["Within Temptation", "Within Temptation"],
  ];
  for (const [credit, expected] of splitCases) {
    assert.equal(musicOrder.leadMusicArtist(credit), expected, `Lead artist parsing preserves the expected credit: ${credit}`);
  }
  assert.equal(musicOrder.leadMusicArtist("Lead / Guest", ["Lead", "Guest"]), "Lead",
    "A structured ordered artist list selects its first name.");
  assert.equal(musicOrder.leadMusicArtist("Lead / Guest", ["AC/DC"]), "AC/DC",
    "A single structured artist name is kept intact, even when it contains a slash.");
  assert.equal(musicOrder.leadMusicArtist("陈奕迅/王菲", ["陈奕迅/王菲"]), "陈奕迅",
    "A joined collaboration stored in a single native tag still groups by its lead artist.");
  assert.equal(musicOrder.musicArtistKey({ artist: "Lead / Guest", artists: ["Lead", "Guest"] }), "lead",
    "Album artist keys normalize the structured lead name.");

  const creditAlbums = createArtistCreditRecords().map(record => record.album);
  const orderedCredits = musicOrder.orderMusicAlbums(creditAlbums, "artist");
  const leadAlbumIndexes = orderedCredits.flatMap((album, index) => musicOrder.musicArtistKey(album) === "album lead" ? [index] : []);
  assert.equal(leadAlbumIndexes.length, 2, "Different album guests share the same primary artist key.");
  assert.equal(leadAlbumIndexes[1], leadAlbumIndexes[0] + 1, "Primary artist sorting keeps collaborations contiguous.");

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

  const fortyFiveFixture = await createTrackFixture(createFortyFiveAlbumRecords());
  const { musicCatalog: fortyFiveCatalog, musicShelves: fortyFiveShelves } = fortyFiveFixture;
  fortyFiveCatalog.configureMusicCatalog({ layout: "array", show: "albums", group: "none", sort: "added" }, "");
  const fortyFiveEntries = fortyFiveCatalog.getMusicDisplayEntries();
  const fortyFiveCanonicalShelves = fortyFiveShelves.getMusicCatalogShelves();
  const fortyFiveKeys = Array.from(fortyFiveCanonicalShelves, shelf => Array.from(shelf.entryKeys)).flat();
  assert.equal(fortyFiveEntries.length, 45, "The MATRIX regression fixture has forty-five canonical album entries.");
  assert.deepEqual(Array.from(fortyFiveCanonicalShelves, shelf => shelf.entryKeys.length), [20, 20, 5],
    "Forty-five canonical entries occupy two full twenty-slot shelves and one five-entry shelf.");
  assert.equal(new Set(fortyFiveKeys).size, 45, "Canonical shelves never pad or duplicate entry identities.");
  assert.deepEqual(fortyFiveKeys, Array.from(fortyFiveEntries, entry => entry.key),
    "Packing preserves the complete catalog order and every real entry exactly once.");

  configure(catalog, { layout: "array", group: "genre", sort: "added" });
  const matrixShelfKeys = Array.from(shelves.getMusicCatalogShelves(), shelf => Array.from(shelf.entryKeys));
  assert.deepEqual(matrixShelfKeys.map(keys => keys.length), [20, 9],
    "MATRIX packs public catalog groups into the shared twenty-slot shelves");
  configure(catalog, { layout: "shelf", group: "genre", sort: "added" });
  assert.deepEqual(Array.from(shelves.getMusicCatalogShelves(), shelf => Array.from(shelf.entryKeys)), matrixShelfKeys,
    "switching layouts keeps every public entry at the same canonical shelf address");
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

  const gridFixture = await createTrackFixture(createGridPaginationRecords());
  const { musicCatalog: gridCatalog, musicGridPage, applicationState: gridApplication, viewSettings: gridViewSettings, catalogMarkup: gridMarkupModule } = gridFixture;
  const gridState = gridApplication.musicApplication;
  assert.deepEqual(Array.from(gridViewSettings.musicGridPageSizes), [10, 36, 50, 75, 100, 200]);
  assert.equal(gridViewSettings.defaultMusicViewSettings.gridPageSize, 36);
  assert.equal(gridViewSettings.normalizeMusicViewSettings({ gridPageSize: 99 }).gridPageSize, 36);
  assert.equal(gridState.view.gridPageSize, 36, "New catalogs start with 36 entries per grid page.");
  gridCatalog.configureMusicCatalog({ layout: "grid", show: "tracks", group: "genre", sort: "added" }, "");
  const fullGroups = Array.from(gridCatalog.getMusicCatalogGroups());
  const fullKeys = fullGroups.flatMap(group => Array.from(group.entryKeys));
  assert.equal(fullKeys.length, 211, "The pagination fixture exceeds the largest supported page size.");
  assert.equal(new Set(fullKeys).size, fullKeys.length);
  assert.deepEqual(Array.from(fullGroups, group => group.entryKeys.length), [64, 55, 47, 45]);

  const defaultGridPage = musicGridPage.getMusicGridPage();
  assert.equal(defaultGridPage.pageIndex, 0);assert.equal(defaultGridPage.pageSize, 36);
  assert.equal(defaultGridPage.pageCount, 6);assert.equal(defaultGridPage.total, 211);
  const flattenPage = page => Array.from(page.groups).flatMap(group => Array.from(group.entryKeys));
  const expectedSizes = size => Math.ceil(211 / size);
  for (const pageSize of gridViewSettings.musicGridPageSizes) {
    gridCatalog.configureMusicCatalog({ gridPageSize: pageSize }, "");
    assert.equal(gridState.gridPage, 0, `${pageSize}: changing page size resets the page index.`);
    const first = musicGridPage.getMusicGridPage();
    assert.equal(first.pageSize, pageSize);assert.equal(first.pageIndex, 0);
    assert.equal(first.pageCount, expectedSizes(pageSize));assert.equal(first.total, fullKeys.length);
    const seen = [];
    for (let pageIndex = 0; pageIndex < first.pageCount; pageIndex++) {
      gridState.setGridPage(pageIndex);
      const page = musicGridPage.getMusicGridPage();
      const start = pageIndex * pageSize;
      const count = Math.min(pageSize, fullKeys.length - start);
      const keys = flattenPage(page);
      assert.equal(page.pageIndex, pageIndex);assert.equal(page.pageSize, pageSize);
      assert.equal(page.pageCount, first.pageCount);assert.equal(page.total, fullKeys.length);
      assert.equal(page.end - page.start, keys.length);
      assert.equal(keys.length, count, `${pageSize}: every page respects its selected card limit.`);
      assert.deepEqual(keys, fullKeys.slice(start, start + count), `${pageSize}: page slices preserve sorted grouped order.`);
      seen.push(...keys);
      const html = gridMarkupModule.musicGridMarkup(0, keys[0]);
      assert.equal((html.match(/data-foobar-entry=/g) || []).length, count, `${pageSize}: the grid markup contains only the current page.`);
      assert.match(html, /data-music-grid-page=/, "Grid markup includes page navigation controls.");
    }
    assert.deepEqual(seen, fullKeys, `${pageSize}: traversing pages produces every entry once in order.`);
    assert.equal(new Set(seen).size, fullKeys.length, `${pageSize}: page navigation does not duplicate entry keys.`);
    const last = musicGridPage.paginateMusicGridGroups(fullGroups, pageSize, first.pageCount - 1);
    assert.equal(flattenPage(last).length, 211 - pageSize * (first.pageCount - 1), `${pageSize}: the last page contains the remainder.`);
  }

  const crossingGroupPage = musicGridPage.paginateMusicGridGroups(fullGroups, 36, 1);
  assert.deepEqual(Array.from(crossingGroupPage.groups, ({ group, index, entryKeys }) => [group.name, index, entryKeys.length, group.entryKeys.length]), [
    ["Alternative", 0, 28, 64], ["Classical", 1, 8, 55],
  ], "A page crossing a group boundary slices visible keys while preserving each group's full count.");
  for (const [requested, expected] of [[-2, 0], [2.8, 2], [Infinity, 0], [NaN, 0], [500, 5]]) {
    const page = musicGridPage.paginateMusicGridGroups(fullGroups, 36, requested);
    assert.equal(page.pageIndex, expected, `Invalid page request ${String(requested)} is clamped to a legal index.`);
  }
  const emptyGridPage = musicGridPage.paginateMusicGridGroups([], 36, 500);
  assert.equal(emptyGridPage.pageCount, 1);assert.equal(emptyGridPage.pageIndex, 0);
  assert.equal(emptyGridPage.total, 0);assert.equal(emptyGridPage.start, 0);assert.equal(emptyGridPage.end, 0);
  assert.deepEqual(Array.from(emptyGridPage.groups), []);
  assert.equal(musicGridPage.paginateMusicGridGroups(fullGroups, 12, 0).pageSize, 36,
    "Unsupported page sizes fall back to the public default.");

  gridCatalog.configureMusicCatalog({ gridPageSize: 36 }, "");
  const preservedEntry = gridCatalog.getMusicDisplayEntries()[25];
  gridCatalog.focusMusicEntry(preservedEntry.key);
  gridState.setGridPage(4);
  const preservedFocus = gridState.catalogFocus;
  gridState.setGridPage(2);
  assert.equal(gridState.catalogFocus.entryKey, preservedFocus.entryKey, "Manual page changes do not alter catalog focus.");
  gridCatalog.configureMusicCatalog({ layout: "array" }, "");
  assert.equal(gridState.gridPage, 2, "Switching to a spatial layout preserves the grid page.");
  gridCatalog.configureMusicCatalog({ layout: "grid" }, "");
  assert.equal(gridState.gridPage, 2, "Returning to Grid preserves the runtime page index.");
  gridCatalog.configureMusicCatalog({ sort: "title" }, "");
  assert.equal(gridState.gridPage, 0, "Sorting resets the page index.");
  gridState.setGridPage(3);gridCatalog.configureMusicCatalog({ group: "artist" }, "");
  assert.equal(gridState.gridPage, 0, "Regrouping resets the page index.");
  gridState.setGridPage(3);gridCatalog.configureMusicCatalog({ show: "albums" }, "");
  assert.equal(gridState.gridPage, 0, "Changing SHOW resets the page index.");
  gridState.setGridPage(3);gridCatalog.configureMusicCatalog({ show: "tracks" }, "Needle");
  assert.equal(gridState.gridPage, 0, "Filtering resets the page index.");
  assert.equal(musicGridPage.getMusicGridPage().total, 1);
  gridCatalog.configureMusicCatalog({}, "no-synthetic-match");
  assert.equal(gridState.gridPage, 0);assert.equal(musicGridPage.getMusicGridPage().total, 0);
  gridCatalog.configureMusicCatalog({}, "");
  assert.equal(musicGridPage.getMusicGridPage().total, 211, "Clearing a filter restores the full grid result.");
  const revealEntry = gridCatalog.getMusicDisplayEntries()[77];
  gridCatalog.focusMusicEntry(revealEntry.key);gridState.setGridPage(0);musicGridPage.revealMusicGridEntry(revealEntry.key);
  assert.equal(gridState.gridPage, 2, "Focusing an entry reveals its containing page.");
  assert.equal(gridState.catalogFocus.entryKey, revealEntry.key, "Revealing an entry preserves its stable identity.");

  const artistCreditFixture = await createTrackFixture(createArtistCreditRecords());
  const artistCreditCatalog = artistCreditFixture.musicCatalog;
  const artistCreditRecords = artistCreditFixture.records;
  artistCreditCatalog.configureMusicCatalog({ show: "albums", group: "artist", sort: "artist" }, "");
  let creditGroups = artistCreditCatalog.getMusicCatalogGroups();
  const albumLeadGroup = creditGroups.find(group => group.name === "Album Lead");
  assert.ok(albumLeadGroup, "Album artist grouping uses the first structured album artist.");
  assert.equal(albumLeadGroup.entryKeys.length, 2, "Albums with different guests share their lead artist group.");
  const albumLeadEntries = Array.from(albumLeadGroup.entryKeys, key => artistCreditCatalog.getMusicEntryByKey(key)).filter(Boolean);
  assert.deepEqual(Array.from(albumLeadEntries, entry => entry.record.title), ["A Lead Album", "B Lead Album"],
    "Albums sharing a lead artist sort together while retaining their canonical order.");
  assert.equal(albumLeadEntries[1].record.en, "Album Lead / Album Guest B");
  assert.equal(albumLeadEntries[1].album.artist, "Album Lead / Album Guest B");
  assert.deepEqual(albumLeadEntries[1].album.artists, ["Album Lead", "Album Guest B"]);
  assert.strictEqual(albumLeadEntries[1].album, artistCreditRecords[0].album,
    "Album sorting and grouping do not replace or clone the canonical album object.");
  assert.match(artistCreditFixture.catalogMarkup.musicGridMarkup(albumLeadEntries[1].recordIndex, albumLeadEntries[1].key),
    /Album Lead \/ Album Guest B/, "Album cards display the complete original artist credit.");

  artistCreditCatalog.configureMusicCatalog({ show: "tracks", group: "artist", sort: "artist" }, "");
  creditGroups = artistCreditCatalog.getMusicCatalogGroups();
  const trackLeadGroup = creditGroups.find(group => group.name === "Track Lead");
  assert.ok(trackLeadGroup, "Track view groups by the first structured track artist.");
  assert.equal(trackLeadGroup.entryKeys.length, 2, "Track collaborations share their lead artist group.");
  const trackLeadEntries = Array.from(trackLeadGroup.entryKeys, key => artistCreditCatalog.getMusicEntryByKey(key)).filter(Boolean);
  assert.deepEqual(Array.from(trackLeadEntries, entry => entry.track.title), ["A Lead Album Track 01", "B Lead Album Track 01"],
    "Different track guests remain adjacent under their shared lead artist.");
  const guestTrackEntry = artistCreditCatalog.getMusicEntryByKey("track|lead-credit-b|lead-credit-b-track-01");
  assert.ok(guestTrackEntry);
  assert.equal(guestTrackEntry.track.artist, "Track Lead / GuestBravo");
  assert.deepEqual(guestTrackEntry.track.artists, ["Track Lead", "GuestBravo"]);
  assert.strictEqual(guestTrackEntry.track, artistCreditRecords[0].album.tracks[0],
    "Sorting preserves the canonical non-first track identity.");
  assert.match(artistCreditFixture.catalogMarkup.musicGridMarkup(guestTrackEntry.recordIndex, guestTrackEntry.key),
    /Track Lead \/ GuestBravo/, "Track cards display the complete original artist credit.");

  artistCreditCatalog.configureMusicCatalog({ show: "tracks", group: "az", sort: "added" }, "");
  creditGroups = artistCreditCatalog.getMusicCatalogGroups();
  assert.deepEqual(Array.from(creditGroups, group => group.name), ["A", "T"],
    "A-Z grouping uses primary artist names and keeps structured AC/DC intact.");
  artistCreditCatalog.configureMusicCatalog({ show: "tracks", group: "none", sort: "artist" }, "");
  const globallySortedTracks = artistCreditCatalog.getMusicCatalogGroups()[0].entryKeys;
  const collaborationIndexes = Array.from(globallySortedTracks).flatMap((key, index) =>
    key.startsWith("track|lead-credit-") ? [index] : []);
  assert.equal(collaborationIndexes.length, 2);
  assert.equal(collaborationIndexes[1], collaborationIndexes[0] + 1,
    "Different guests with one primary artist remain adjacent in the global artist sort.");
  artistCreditCatalog.configureMusicCatalog({ show: "tracks", group: "artist", sort: "artist" }, "GuestBravo");
  creditGroups = artistCreditCatalog.getMusicCatalogGroups();
  assert.equal(creditGroups.length, 1);
  assert.equal(creditGroups[0].name, "Track Lead", "Searching a guest keeps the result under the lead artist group.");
  assert.deepEqual(Array.from(creditGroups[0].entryKeys), [guestTrackEntry.key],
    "The complete raw artist credit remains searchable by guest name.");

  dataModule.setMusicAlbums(creditAlbums, [], "artist");
  const albumLeadColumn = dataModule.archiveColumns.indexOf("Album Lead");
  assert.notEqual(albumLeadColumn, -1, "Artist shelf labels use the lead name.");
  const albumLeadRecords = dataModule.columnFiles(albumLeadColumn).map(index => dataModule.records[index]);
  assert.deepEqual(Array.from(albumLeadRecords, record => record.title), ["A Lead Album", "B Lead Album"]);
  assert.deepEqual(Array.from(albumLeadRecords, record => [record.en, record.lead]), [
    ["Album Lead / Album Guest A", "Album Lead / Album Guest A"],
    ["Album Lead / Album Guest B", "Album Lead / Album Guest B"],
  ], "Album compatibility records retain the complete original artist text for display.");
  assert.deepEqual(albumLeadRecords[0].album.artists, ["Album Lead", "Album Guest A"],
    "Grouping keeps the canonical ordered artist list on the album object.");

  console.log("Public TRACKS catalog, focus, navigation, shelves and shared grid markup passed with synthetic records.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runChecks();
