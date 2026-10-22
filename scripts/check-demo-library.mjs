import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { createTrackFixture } from "./check-foobar-tracks.mjs";

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

function runModule(source, filename, requireMock, globals = {}) {
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require: requireMock,
    structuredClone: globalThis.structuredClone,
    ...globals,
  };
  vm.runInNewContext(transpile(source, filename), sandbox, { filename });
  return module.exports;
}

async function readSource(relativePath) {
  return readFile(path.join(project, relativePath), "utf8");
}

async function loadDemoLibrary(fixture) {
  const caseSettings = runModule(
    await readSource("src/case-settings.ts"),
    "case-settings.ts",
    (specifier) => { throw new Error(`Unexpected case settings import: ${specifier}`); },
  );
  const demoLibrary = runModule(
    await readSource("src/demo-library.ts"),
    "demo-library.ts",
    (specifier) => {
      if (specifier === "./case-settings") return caseSettings;
      if (specifier === "./music-display-layout") return fixture.displayLayout;
      if (specifier === "./music-view-settings") return fixture.viewSettings;
      throw new Error(`Unexpected demo library import: ${specifier}`);
    },
  );
  return { ...demoLibrary, caseSettings };
}

async function loadSpatialLayout(fixture) {
  return runModule(
    await readSource("src/music-spatial-layout.ts"),
    "music-spatial-layout.ts",
    (specifier) => {
      if (specifier === "./data") return fixture.dataModule;
      if (specifier === "./music-array-layout") return fixture.arrayLayout;
      if (specifier === "./music-catalog") return fixture.musicCatalog;
      if (specifier === "./music-catalog-shelves") return fixture.musicShelves;
      if (specifier === "./music-display-layout") return fixture.displayLayout;
      throw new Error(`Unexpected spatial layout import: ${specifier}`);
    },
  );
}

async function loadCatalogGrid(fixture) {
  return runModule(
    await readSource("src/music-catalog-grid.ts"),
    "music-catalog-grid.ts",
    (specifier) => {
      if (specifier === "./music-catalog-markup") return fixture.catalogMarkup;
      if (specifier === "./music-catalog") return fixture.musicCatalog;
      if (specifier === "./music-application-state") return fixture.applicationState;
      if (specifier === "./music-grid-page") return fixture.musicGridPage;
      throw new Error(`Unexpected catalog grid import: ${specifier}`);
    },
    { document: { activeElement: null, createComment: () => ({ parentNode: null, nextSibling: null }) } },
  );
}

function makeGridHost() {
  return {
    hidden: false,
    innerHTML: "",
    scrollTop: 0,
    classList: { add() {} },
    addEventListener() {},
    before() {},
    contains() { return false; },
    getClientRects() { return this.hidden ? [] : [{}]; },
    getBoundingClientRect() { return { top: 0, bottom: 400 }; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

async function assertCatalogGridEmptyStates(fixture, demo) {
  const gridModule = await loadCatalogGrid(fixture);
  const originalMarkup = fixture.catalogMarkup.musicGridMarkup;
  let markupCalls = 0;
  fixture.catalogMarkup.musicGridMarkup = (...args) => {
    markupCalls++;
    return originalMarkup(...args);
  };

  const host = makeGridHost();
  const root = { dataset: { design: "rhine" } };
  const grid = gridModule.setupMusicCatalogGrid(root, host);
  fixture.dataModule.setMusicAlbums([], [], "genre");
  fixture.musicCatalog.configureMusicCatalog({ layout: "grid", show: "albums", group: "genre", sort: "artist" }, "");
  grid.update("grid", 0, false, true);
  assert.equal(host.hidden, true, "an empty library hides the grid host");
  assert.equal(host.innerHTML, "", "an empty library creates no grid markup");
  assert.equal(markupCalls, 0, "an empty library skips the markup renderer");

  fixture.dataModule.setMusicAlbums(Array.from(demo.demoAlbums), Array.from(demo.demoGenres), "genre");
  const query = "__demo_query_without_matches__";
  fixture.musicCatalog.configureMusicCatalog({ layout: "grid", show: "albums", group: "genre", sort: "artist" }, query);
  grid.update("grid", 0, false, false);
  assert.equal(host.hidden, false, "a search with no matches keeps the populated library grid visible");
  assert.equal(markupCalls, 1, "an empty search result still renders the grid");
  assert.match(host.innerHTML, /class="foobar-catalog-empty"/, "the grid renders its empty search-result state");
  assert.ok(host.innerHTML.includes(query), "the no-result state includes the active query");

  fixture.catalogMarkup.musicGridMarkup = originalMarkup;
}

function assertCounts(values, expected, label) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  assert.equal(counts.size, expected.length, `${label} has the expected number of groups`);
  for (const [value, count] of expected) assert.equal(counts.get(value), count, `${label}: ${value}`);
}

function assertShelfRows(shelves, expectedCount, slots, label) {
  assert.equal(shelves.length, expectedCount, `${label}: shelf count`);
  assert.deepEqual(Array.from(shelves, (shelf) => shelf.entryKeys.length), Array(expectedCount).fill(slots), `${label}: shelf slots`);
}

export async function runChecks() {
  const fixture = await createTrackFixture([]);
  const demo = await loadDemoLibrary(fixture);
  const spatial = await loadSpatialLayout(fixture);
  const { demoAlbums, demoGenres } = demo;

  assert.equal(demo.DEMO_SHELF_COLUMNS, 4);
  assert.equal(demo.DEMO_SLOTS_PER_COLUMN, fixture.displayLayout.MUSIC_SHELF_VIEW.slots);
  assert.equal(demoAlbums.length, 80, "four columns of twenty create eighty demo albums");
  assert.equal(new Set(demoAlbums.map((album) => album.id)).size, 80, "album IDs are unique");
  assert.equal(new Set(demoAlbums.map((album) => album.title)).size, 80, "album names are unique and clearly marked as visual demos");
  assert.ok(demoAlbums.every((album) => album.title.includes("视觉演示专辑")));

  assert.equal(demoGenres.length, 4);
  assertCounts(demoAlbums.map((album) => album.genreId), demoGenres.map((genre) => [genre.id, 20]), "albums per genre");
  assert.equal(new Set(demoAlbums.map((album) => album.artist)).size, 4, "exactly four demo artists are used");
  assert.ok(demoAlbums.every((album) => /^[ABCD]/.test(album.artist)), "demo artists begin with A, B, C, or D");
  assertCounts(demoAlbums.map((album) => album.artist), ["Aster Audio", "Boreal Ensemble", "Cinder Studio", "Delta Tapes"].map((artist) => [artist, 20]), "albums per artist");
  assertCounts(demoAlbums.map((album) => `${Math.floor(album.year / 10) * 10}s`), [["1990s", 20], ["2000s", 20], ["2010s", 20], ["2020s", 20]], "albums per decade");
  assert.deepEqual(Array.from(new Set(demoAlbums.map((album) => album.coverUrl))).sort(), [
    "/demo-covers/landscape.png",
    "/demo-covers/portrait.png",
    "/demo-covers/square.png",
  ], "the demo catalog reuses the three existing cover paths");

  const trackIds = [];
  for (const album of demoAlbums) {
    assert.equal(album.tracks.length, 1, `${album.id} has one virtual track`);
    const track = album.tracks[0];
    trackIds.push(track.id);
    assert.equal(track.albumId, album.id);
    assert.match(track.title, /视觉演示曲目.*无音频/);
    assert.equal(track.audioUrl, "");
    assert.equal(track.browserPlayable, false);
    assert.equal(track.format, "DEMO");
    assert.equal(track.duration, 0);
    assert.equal(track.relativePath, "");
  }
  assert.equal(new Set(trackIds).size, 80, "virtual track IDs are unique");

  const profiles = demo.createDemoCaseProfiles();
  assert.equal(profiles.rhine.structure, "rhine");
  assert.equal(profiles.rhine.appearances.rhine.preset, "original");
  assert.equal(profiles.archive.structure, "punk");
  assert.equal(profiles.archive.appearances.punk.preset, "white");

  const { casePreset, defaultCaseSettings } = demo.caseSettings;
  const savedProfiles = {
    rhine: defaultCaseSettings("rhine"),
    archive: defaultCaseSettings("archive"),
  };
  savedProfiles.rhine.structure = "punk";
  const futurePunk = casePreset("marble", "punk");
  futurePunk.preset = "custom";
  futurePunk.presetRevision = 4;
  futurePunk.surfaces.frame.color = "#8956B8";
  futurePunk.surfaces.cover.roughness = 0.193;
  futurePunk.transforms = {
    frame: { visible: false, offset: [0.125, -0.25, 0.375], rotation: [12, -30, 45], scale: [1.2, 0.8, 1.1] },
  };
  savedProfiles.rhine.appearances.punk = futurePunk;
  savedProfiles.rhine.appearances.rhine.surfaces.cover.transmissionOverride = 0.37;
  savedProfiles.rhine.appearances.rhine.surfaces.cover.opacityOverride = 0.4;
  const archivePunk = casePreset("glass", "punk");
  archivePunk.surfaces.frame.color = "#347E67";
  archivePunk.transforms = {
    clip: { visible: true, offset: [0.2, 0.1, -0.3], rotation: [5, 15, -25], scale: [1, 1.1, 0.9] },
  };
  savedProfiles.archive.appearances.punk = archivePunk;
  const savedBeforeDemo = structuredClone(savedProfiles);

  const firstDemoProfiles = demo.createDemoCaseProfiles(savedProfiles);
  assert.equal(firstDemoProfiles.rhine.structure, "rhine",
    "Future demo entry must keep Rhine as its active case structure.");
  assert.equal(firstDemoProfiles.archive.structure, "punk",
    "Archive demo entry must keep Punk as its active case structure.");
  assert.deepEqual(firstDemoProfiles.rhine.appearances.punk, savedBeforeDemo.rhine.appearances.punk,
    "Future demo profiles must retain the saved Punk preset, material edits, and transforms.");
  assert.deepEqual(firstDemoProfiles.rhine.appearances.rhine, savedBeforeDemo.rhine.appearances.rhine,
    "Future demo profiles must retain saved Rhine optics and structure settings.");
  assert.deepEqual(firstDemoProfiles.archive.appearances.punk, savedBeforeDemo.archive.appearances.punk,
    "Archive demo profiles must retain their independent Punk appearance.");
  assert.equal(JSON.stringify(savedProfiles), JSON.stringify(savedBeforeDemo),
    "Creating demo profiles must not write or mutate the user's saved case defaults.");

  const savedFutureFrameColor = savedProfiles.rhine.appearances.punk.surfaces.frame.color;
  firstDemoProfiles.rhine.appearances.punk.surfaces.frame.color = "#111111";
  firstDemoProfiles.rhine.appearances.punk.transforms.frame.offset[1] = 7;
  assert.equal(savedProfiles.rhine.appearances.punk.surfaces.frame.color, savedFutureFrameColor,
    "Demo Punk material edits must not alias the user's saved profile.");
  assert.equal(savedProfiles.rhine.appearances.punk.transforms.frame.offset[1], -0.25,
    "Demo transforms must be deeply cloned from the user's saved profile.");

  // Mirror the app's explicit onChange persistence after a user edits Punk during demo.
  const updatedSavedProfiles = structuredClone(savedBeforeDemo);
  updatedSavedProfiles.rhine.structure = "punk";
  updatedSavedProfiles.rhine.appearances.punk.surfaces.frame.color = "#5D37B4";
  updatedSavedProfiles.rhine.appearances.punk.transforms.frame.offset[1] = 0.425;
  const expectedReenteredPunk = structuredClone(updatedSavedProfiles.rhine.appearances.punk);
  const secondDemoProfiles = demo.createDemoCaseProfiles(updatedSavedProfiles);
  assert.equal(secondDemoProfiles.rhine.structure, "rhine",
    "Reentering Future demo must restore the default active Rhine structure.");
  assert.deepEqual(secondDemoProfiles.rhine.appearances.punk, expectedReenteredPunk,
    "Reentering demo must preserve the user's latest Punk appearance from saved profiles.");
  assert.deepEqual(secondDemoProfiles.archive.appearances.punk, savedBeforeDemo.archive.appearances.punk,
    "Reentering demo must keep Archive's Punk profile separate from Future.");
  assert.deepEqual(updatedSavedProfiles.rhine.appearances.punk, expectedReenteredPunk,
    "Repeated demo entry must leave the saved user profile unchanged.");

  for (const [design, layout] of [["rhine", "array"], ["archive", "shelf"]]) {
    const view = demo.demoViewForDesign(design);
    assert.equal(view.layout, layout);
    assert.equal(view.show, "albums");
    assert.equal(view.group, "genre");
    assert.equal(view.sort, "artist");
    assert.equal(view.gridPageSize, 36);
  }

  fixture.dataModule.setMusicAlbums(Array.from(demoAlbums), Array.from(demoGenres), "genre");
  const expectedKeys = new Set();
  const groupOptions = ["genre", "artist", "decade", "az", "none"];
  const sortOptions = ["artist", "title", "year", "added"];
  const showOptions = ["albums", "tracks"];
  for (const show of showOptions) {
    for (const group of groupOptions) {
      for (const sort of sortOptions) {
        fixture.musicCatalog.configureMusicCatalog({ layout: "shelf", show, group, sort }, "");
        const entries = Array.from(fixture.musicCatalog.getMusicDisplayEntries());
        assert.equal(entries.length, 80, `${show}/${group}/${sort} exposes every demo item`);
        const keys = entries.map((entry) => entry.key);
        assert.equal(new Set(keys).size, 80, `${show}/${group}/${sort} has unique display keys`);
        const groupedKeys = Array.from(fixture.musicCatalog.getMusicCatalogGroups())
          .flatMap((entryGroup) => Array.from(entryGroup.entryKeys));
        assert.deepEqual(groupedKeys.slice().sort(), keys.slice().sort(), `${show}/${group}/${sort} grouping retains all entries`);
        assertShelfRows(Array.from(fixture.musicShelves.getMusicCatalogShelves()), 4, 20, `${show}/${group}/${sort}`);
        if (show === "tracks") {
          assert.ok(entries.every((entry) => entry.track?.format === "DEMO" && entry.track.audioUrl === "" && !entry.track.browserPlayable),
            `${show}/${group}/${sort} retains all non-playable visual tracks`);
        }
        if (show === "albums" && group === "genre" && sort === "artist") {
          keys.forEach((key) => expectedKeys.add(key));
        }
      }
    }
  }
  assert.equal(expectedKeys.size, 80);

  fixture.musicCatalog.configureMusicCatalog({ layout: "shelf", show: "albums", group: "genre", sort: "artist" }, "");
  const activeShelves = Array.from(fixture.musicShelves.getMusicCatalogShelves());
  assertShelfRows(activeShelves, 4, 20, "default demo shelf");
  for (let lane = 0; lane < 7; lane++) {
    for (let slot = 0; slot < 20; slot++) {
      const cell = { lane, row: 12 + slot };
      const entry = spatial.musicSpatialEntry(cell, true);
      assert.ok(entry, `demo shelf lane ${lane}, slot ${slot} resolves an entry`);
      if (lane >= 4) {
        const repeated = spatial.musicSpatialEntry({ lane: lane - 4, row: cell.row }, true);
        assert.equal(entry.key, repeated.key, `demo shelf lane ${lane} reuses the matching active column`);
      }
    }
  }
  assert.equal(
    spatial.musicSpatialEntry({ lane: -1, row: 12 }, true)?.key,
    spatial.musicSpatialEntry({ lane: 3, row: 12 }, true)?.key,
    "demo shelf lanes loop in both directions",
  );

  const ordinaryAlbum = {
    id: "ordinary-fixture-album",
    title: "Ordinary Fixture Album",
    artist: "Fixture Artist",
    genreId: "fixture",
    year: 2001,
    rawGenres: ["Fixture"],
    folder: "fixture/ordinary",
    tracks: [],
    producers: [],
    offline: false,
  };
  fixture.dataModule.setMusicAlbums([ordinaryAlbum], [{ id: "fixture", name: "Fixture" }], "genre");
  fixture.musicCatalog.configureMusicCatalog({ layout: "shelf", show: "albums", group: "genre", sort: "artist" }, "");
  assert.ok(spatial.musicSpatialEntry({ lane: 0, row: 12 }, true), "the ordinary shelf's active lane resolves");
  assert.equal(spatial.musicSpatialEntry({ lane: -1, row: 12 }, true), undefined, "ordinary negative lanes stay empty");
  assert.equal(spatial.musicSpatialEntry({ lane: 1, row: 12 }, true), undefined, "ordinary out-of-range lanes stay empty");

  fixture.dataModule.setMusicAlbums([], [], "genre");
  for (const shelf of [true, false]) {
    fixture.musicCatalog.configureMusicCatalog({ layout: shelf ? "shelf" : "array", show: "albums", group: "genre", sort: "artist" }, "");
    assert.equal(fixture.musicCatalog.getMusicDisplayEntries().length, 0);
    assert.equal(fixture.musicShelves.getMusicCatalogShelves().length, 0);
    assert.doesNotThrow(() => spatial.musicSpatialEntry({ lane: -1, row: 12 }, shelf));
    assert.equal(spatial.musicSpatialEntry({ lane: -1, row: 12 }, shelf), undefined);
    assert.doesNotThrow(() => spatial.musicSpatialCell({ lane: -1, row: 12 }, shelf));
  }

  await assertCatalogGridEmptyStates(fixture, demo);

  console.log("Demo library distribution, saved case profile cloning, repeat-entry appearance retention, virtual audio boundary, view profiles, catalog combinations, shelf loops, empty-directory mapping and grid empty states passed.");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await runChecks();
