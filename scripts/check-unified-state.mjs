import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";
import { normalizeWindowAspect } from "../src/window-aspect-model.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function transpile(source, filename, module = ts.ModuleKind.ESNext) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module },
    fileName: filename.endsWith(".ts") ? filename : `${filename}.ts`,
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `${filename} transpilation failed: ${errors.map(item => ts.flattenDiagnosticMessageText(item.messageText, "\n")).join("\n")}`);
  return result.outputText;
}

function runModule(source, filename, requireMock) {
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: requireMock };
  vm.runInNewContext(transpile(source, filename, ts.ModuleKind.CommonJS), sandbox, { filename });
  return module.exports;
}

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;

const viewSource = await readFile(path.join(project, "src/music-view-settings.ts"), "utf8");
const viewModule = await import(dataModule(transpile(viewSource, "music-view-settings.ts")));
const stateSource = (await readFile(path.join(project, "src/music-application-state.ts"), "utf8"))
  .replace('from "./music-view-settings"', `from ${JSON.stringify(dataModule(transpile(viewSource, "music-view-settings.ts")))}`);
const stateModule = await import(dataModule(transpile(stateSource, "music-application-state.ts")));

const {
  defaultMusicViewSettings,
  normalizeMusicViewSettings,
  migrateMusicViewSettings,
  legacyCatalogOptions,
  musicViewFromLegacy,
} = viewModule;
const { MusicApplicationState } = stateModule;

assert.deepEqual(normalizeMusicViewSettings(undefined), defaultMusicViewSettings,
  "New preferences use the public default view.");
assert.deepEqual(migrateMusicViewSettings(undefined, undefined, "shelf"), {
  ...defaultMusicViewSettings, layout: "shelf",
}, "An unconfigured Archive profile preserves its initial shelf view.");
assert.deepEqual(migrateMusicViewSettings(undefined, undefined, "array"), defaultMusicViewSettings,
  "An unconfigured Future profile keeps the public array default.");
assert.deepEqual(migrateMusicViewSettings(
  { layout: "grid", show: "invalid", group: "none", sort: "invalid" },
  { layout: "array", show: "tracks", group: "genre", sort: "year" },
), { layout: "grid", show: "tracks", group: "none", sort: "year" },
"Migration chooses a valid current field first, then falls back to that field's legacy value.");
for (const [legacyLayout, currentLayout] of [["array", "shelf"], ["future", "array"], ["grid", "grid"]]) {
  assert.equal(musicViewFromLegacy({ layout: legacyLayout, show: "albums", group: "genre", sort: "artist" }).layout,
    currentLayout, `Legacy ${legacyLayout} migrates to ${currentLayout}.`);
}
assert.equal(normalizeMusicViewSettings({ group: "artist" }).group, "artist",
  "The public schema retains the former Future artist grouping.");
const serializedView = { layout: "array", show: "tracks", group: "decade", sort: "title" };
assert.deepEqual(migrateMusicViewSettings(
  JSON.parse(JSON.stringify(serializedView)),
  legacyCatalogOptions(serializedView),
), serializedView, "Current view settings survive JSON persistence and the legacy projection.");

const state = new MusicApplicationState();
const initialStateView = state.view;
assert.ok(Object.isFrozen(initialStateView), "Public app view snapshots are frozen.");
assert.strictEqual(state.view, initialStateView, "An unchanged view keeps the same reference.");
state.configureView({ layout: "grid", show: "tracks", group: "none", sort: "title" }, "needle query");
const gridStateView = state.view;
assert.notStrictEqual(gridStateView, initialStateView, "A settings change replaces the immutable view snapshot.");
assert.ok(Object.isFrozen(gridStateView));
assert.equal(state.spatialLayout, "array", "Grid remembers the initial spatial layout.");
state.configureView({ layout: "shelf" }, "needle query");
assert.equal(state.spatialLayout, "shelf");
state.configureView({ layout: "grid" }, "needle query");
assert.equal(state.spatialLayout, "shelf", "Returning to Grid retains the last spatial layout.");
state.selectAlbum(2, "album-b");
state.focusEntry({ entryKey: "track|album-b|needle-track", albumId: "album-b", trackId: "needle-track" });
state.mode = "detail";
state.activeTab = "about";
state.infoScrollTop = 120;
assert.equal(state.selectedTrackId, "needle-track");
state.reconcileAlbums(["album-c", "album-b", "album-a"]);
assert.equal(state.selectedIndex, 1, "Reordering follows the selected album identity.");
assert.equal(state.selectedAlbumId, "album-b");
assert.equal(state.selectedTrackId, "needle-track", "Reordering retains focus inside the selected album.");
assert.equal(state.infoScrollTop, 120, "Reordering preserves the selected album's reading position.");
assert.equal(state.query, "needle query");
assert.deepEqual(state.view, { layout: "grid", show: "tracks", group: "none", sort: "title" });
state.reconcileAlbums(["album-c", "album-a"]);
assert.equal(state.selectedIndex, 0, "Removing the selection uses the first-album fallback.");
assert.equal(state.selectedAlbumId, "album-c");
assert.equal(state.selectedTrackId, undefined, "Removing the focused album clears track focus.");
assert.equal(state.infoScrollTop, 0, "Changing to another album clears the old album's reading position.");
assert.equal(state.activeTab, "about", "Catalog reconciliation leaves the information tab intact.");
assert.equal(state.mode, "detail", "Catalog reconciliation leaves the presentation mode intact.");
state.selectAlbum(1, "album-b");
state.focusEntry({ entryKey: "track|album-b|needle-track", albumId: "album-b", trackId: "needle-track" });
state.reconcileAlbums(["album-c", "album-b", "album-a"], (albumId, trackId) =>
  !(albumId === "album-b" && trackId === "needle-track"));
assert.equal(state.selectedAlbumId, "album-b", "Removing a track does not remove its parent album.");
assert.equal(state.selectedTrackId, undefined, "Removing the focused track clears stale track focus.");
assert.equal(state.catalogFocus, undefined);

const desktopSource = await readFile(path.join(project, "desktop/main.cjs"), "utf8");
const selectorStart = desktopSource.indexOf("const preferenceKeys=");
const selectorEnd = desktopSource.indexOf("const selectAudioPresetStore=", selectorStart);
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, "The desktop preference selector must remain extractable.");
const selectPreferences = new Function(
  "windowAspectModel", "Buffer",
  `${desktopSource.slice(selectorStart, selectorEnd)};return selectPreferences;`,
)({ normalizeWindowAspect }, Buffer);
const allowedPayload = {
  theme: "night",
  windowAspect: "21:9",
  view: { layout: "grid", show: "tracks", group: "az", sort: "year" },
  style: { design: "archive", scheme: "flare" },
  styleProfiles: { rhine: { mode: "day" }, archive: { mode: "night" } },
  caseProfiles: { rhine: { id: "rhine-case" }, archive: { id: "archive-case" } },
  futurePunkPresets: [{ id: "future-user" }],
  archivePunkPresets: [{ id: "archive-user" }],
  unknownField: true,
};
const selectedPreferences = selectPreferences(allowedPayload);
for (const key of ["view", "styleProfiles", "caseProfiles", "futurePunkPresets", "archivePunkPresets"])
  assert.deepEqual(selectedPreferences[key], allowedPayload[key], `Desktop preference whitelist retains ${key}.`);
assert.equal(selectedPreferences.windowAspect, "21:9");
assert.equal(Object.hasOwn(selectedPreferences, "unknownField"), false,
  "Desktop persistence continues to drop unrecognized preference fields.");

const styleSource = await readFile(path.join(project, "src/music-style.ts"), "utf8");
const styleTree = ts.createSourceFile("music-style.ts", styleSource, ts.ScriptTarget.Latest, true);
const styleNames = new Set([
  "defaultMusicStyle", "archiveMusicStyle", "CASE_STYLES", "SCHEMES", "TEXT_SCALES",
  "ARRAY_SCALES", "INSPECT_SCALES", "isOneOf", "closestScale", "normalizeMusicStyle",
  "normalizeDesignProfiles",
]);
const styleStatements = styleTree.statements.filter(statement => {
  if (ts.isFunctionDeclaration(statement)) return styleNames.has(statement.name?.text || "");
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.some(declaration =>
    ts.isIdentifier(declaration.name) && styleNames.has(declaration.name.text));
});
const styleRuntimeSource = transpile(styleStatements.map(statement => statement.getText(styleTree)).join("\n"), "music-style-helpers.ts")
  .replace(/^export /gm, "");
const styleRuntime = new Function(
  `${styleRuntimeSource};return {defaultMusicStyle,archiveMusicStyle,normalizeMusicStyle,normalizeDesignProfiles};`,
)();

const syntheticTrackA = { id: "album-a-track", albumId: "album-a", title: "First song", artist: "Artist A", trackNumber: 1, duration: 180, format: "FLAC", relativePath: "a/first.flac" };
const syntheticTrackB = { id: "needle-track", albumId: "album-b", title: "Needle song", artist: "Artist B", trackNumber: 1, duration: 181, format: "FLAC", relativePath: "b/needle.flac" };
const syntheticTrackB2 = { id: "album-b-track-2", albumId: "album-b", title: "Second song", artist: "Artist B", trackNumber: 2, duration: 182, format: "FLAC", relativePath: "b/second.flac" };
const albumA = { id: "album-a", title: "Album A", artist: "Artist A", year: 2001, genreId: "rock", rawGenres: ["Rock"], tracks: [syntheticTrackA], offline: false };
const albumB = { id: "album-b", title: "Album B", artist: "Artist B", year: 2002, genreId: "jazz", rawGenres: ["Jazz"], tracks: [syntheticTrackB2, syntheticTrackB], offline: false };
const records = [
  { id: "album-a", title: "Album A", en: "Artist A", lead: "Artist A", category: "Rock", date: "2001", findings: [], album: albumA },
  { id: "album-b", title: "Album B", en: "Artist B", lead: "Artist B", category: "Jazz", date: "2002", findings: [], album: albumB },
];

const application = stateModule.musicApplication;
application.configureView({ layout: "shelf", show: "tracks", group: "none", sort: "title" }, "");
application.configureView({ layout: "array", show: "tracks", group: "none", sort: "title" }, "Needle");
application.selectAlbum(1, "album-b");
application.mode = "detail";
application.activeTab = "about";
const dataFixture = { records };
const musicCatalogSource = await readFile(path.join(project, "src/music-catalog.ts"), "utf8");
const musicCatalog = runModule(musicCatalogSource, "music-catalog.js", specifier => {
  if (specifier === "./data") return dataFixture;
  if (specifier === "./music-application-state") return stateModule;
  throw new Error(`Unexpected public catalog import: ${specifier}`);
});
const catalogSource = await readFile(path.join(project, "src/foobar-catalog.ts"), "utf8");
const catalog = runModule(catalogSource, "foobar-catalog.js", specifier => {
  if (specifier === "./music-catalog") return musicCatalog;
  if (specifier === "./music-application-state") return stateModule;
  if (specifier === "./music-view-settings") return viewModule;
  throw new Error(`Unexpected compatibility catalog import: ${specifier}`);
});
catalog.setFoobarFocus("track|album-b|needle-track");
assert.equal(application.selectedTrackId, "needle-track", "The production catalog focus adapter updates public track focus.");
assert.equal(catalog.getFoobarFocusedEntry(application.selectedIndex)?.track?.id, "needle-track",
  "The compatibility catalog resolves focus through the public catalog and app state.");
assert.equal(musicCatalog.getMusicFocusedEntry(application.selectedIndex)?.track?.id, "needle-track",
  "The public catalog resolves focus from the same synthetic records and app state.");

const musicAppSource = await readFile(path.join(project, "src/music-app.ts"), "utf8");
const appFunctionNames = ["currentAlbum", "savePrefs", "syncSelectionMotion", "syncDesignIdentity", "setTheme", "switchDesign", "playAlbum"];
const appTree = ts.createSourceFile("music-app.ts", musicAppSource, ts.ScriptTarget.Latest, true);
const appStatements = appTree.statements.filter(statement =>
  ts.isFunctionDeclaration(statement) && appFunctionNames.includes(statement.name?.text || ""));
const foundAppFunctions = new Set(appStatements.map(statement => statement.name?.text));
assert.deepEqual([...foundAppFunctions].sort(), [...appFunctionNames].sort(),
  "Extract the real application context and playback functions from music-app.ts.");

const startingProfiles = styleRuntime.normalizeDesignProfiles({
  rhine: { style: styleRuntime.defaultMusicStyle, mode: "day" },
  archive: { style: { ...styleRuntime.archiveMusicStyle, scheme: "flare", arrayScale: 1.15, textScale: 1.1 }, mode: "day" },
}, { ...styleRuntime.archiveMusicStyle, scheme: "flare", arrayScale: 1.15, textScale: 1.1 }, "day");
const caseProfiles = {
  rhine: { id: "rhine-case", color: "#123456" },
  archive: { id: "archive-case", color: "#654321" },
};
const caseSnapshot = structuredClone(caseProfiles);
const preferences = {
  style: { ...startingProfiles.archive.style },
  theme: startingProfiles.archive.mode,
  windowAspect: "21:9",
  quality: "original",
  renderQuality: { scale: 110, pixelRatio: 1.5, antialias: "smaa" },
  view: undefined,
  foobarArchive: undefined,
  styleProfiles: undefined,
  caseProfiles,
  output: { backend: "wasapi", processing: { preamp: 2 } },
  reduced: false,
};
const designProfiles = startingProfiles;
const saved = [];
const sceneCalls = { styles: [], themes: [], cases: [] };
const playbackCalls = [];
const playbackOrderChanges = [];
const titleMotionCalls = [];
const playerState = { playbackOrder: "shuffle" };
const uiNodes = new Map();
const textNode = () => ({ nodeType: 3, textContent: "" });
const themeButtons = ["day", "night"].map(theme => {
  const label = { textContent: "" };
  const attributes = {};
  return {
    dataset: { theme },
    label,
    attributes,
    querySelector: () => label,
    setAttribute: (name, value) => { attributes[name] = value; },
  };
});
for (const [selector, node] of [
  ["#selection-code", { firstChild: textNode() }],
  [".music-brand strong", { textContent: "" }],
  [".music-brand > span", { innerHTML: "" }],
  ["#genre-position", { firstChild: textNode() }],
]) uiNodes.set(selector, node);
const stage = {
  dataset: {},
  querySelectorAll: selector => selector === ".theme-switch button[data-theme]" ? themeButtons : [],
};
const scene = {
  setTheme: (...args) => sceneCalls.themes.push(args),
  setMusicStyle: (...args) => sceneCalls.styles.push(args),
  setCaseSettings: value => { sceneCalls.cases.push(value); return Promise.resolve(); },
};
const albumPanelCalls = { active: [], open: [], finished: 0 };
const appScope = {
  albums: [albumA, albumB],
  albumPanel: {
    finish: () => { albumPanelCalls.finished++; },
    setActive: value => albumPanelCalls.active.push(value),
    setOpen: value => albumPanelCalls.open.push(value),
  },
  applyStylePalette: (_stage, style, theme) => sceneCalls.styles.push({ palette: style.design, theme }),
  applyWindowAspect: (_stage, aspect, background) => sceneCalls.styles.push({ aspect, background }),
  browseTransition: { finish() {}, dispose() {} },
  caseProfiles,
  designProfiles,
  detailTransition: { finish() {}, dispose() {} },
  document: { fonts: { load: () => Promise.resolve() } },
  fit: () => {},
  catalogGrid: undefined,
  foobarShell: { setActive: () => {} },
  getFoobarCatalogOptions: catalog.getFoobarCatalogOptions,
  getFoobarFocusedEntry: catalog.getFoobarFocusedEntry,
  getMusicFocusedEntry: musicCatalog.getMusicFocusedEntry,
  getMusicCatalogOptions: musicCatalog.getMusicCatalogOptions,
  legacyCatalogOptions: viewModule.legacyCatalogOptions,
  musicApplication: application,
  Node: { TEXT_NODE: 3 },
  normalizeMusicStyle: styleRuntime.normalizeMusicStyle,
  page: "music",
  playbackControls: { update() {} },
  player: {
    play: (id, tracks) => { playbackCalls.push({ id, tracks }); },
    setPlaybackOrder: value => { playbackOrderChanges.push(value); },
  },
  playerState,
  preferences,
  processingSettings: { preamp: 2 },
  records,
  renderThemePage: () => {},
  requestAnimationFrame: callback => { callback(0); return 0; },
  save: (key, value) => saved.push({ key, value: JSON.parse(JSON.stringify(value)) }),
  scene,
  sortLabel: { code: "GENRE" },
  stage,
  stopFoobarIntro: undefined,
  stylePalette: (style, theme) => ({ bg: `${style.design}-${theme}-background` }),
  syncThemeButtons: () => {},
  syncThemeButtonsCount: 0,
  selectionMotionEnabled: () => false,
  textMotion: { refresh() {}, setEnabled() {} },
  titleMotion: { finish() {}, update: (...args) => titleMotionCalls.push(args) },
  themeNames: { day: "DAY", night: "NIGHT" },
  trUi: value => value,
  ui: (strings, ...values) => strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  updateSelection: () => {},
  viewer: { setTheme() {} },
};
appScope.$ = selector => {
  if (!uiNodes.has(selector)) throw new Error(`Unexpected music-app selector in fixture: ${selector}`);
  return uiNodes.get(selector);
};
const appFunctionSource = transpile(appStatements.map(statement => statement.getText(appTree)).join("\n"), "music-app-context.ts")
  .replace(/^export /gm, "");
const appFunctions = new Function(
  ...Object.keys(appScope),
  `${appFunctionSource};return {${appFunctionNames.join(",")}};`,
)(...Object.values(appScope));

const detailMode = application.mode;
application.mode = "archive";
appFunctions.syncSelectionMotion();
assert.equal(titleMotionCalls.at(-1)?.[0], "Needle song",
  "The real selection-motion function uses the focused catalog entry title across designs.");
application.mode = detailMode;

const globalStateSnapshot = () => ({
  view: application.view,
  query: application.query,
  selectedIndex: application.selectedIndex,
  selectedAlbumId: application.selectedAlbumId,
  selectedTrackId: application.selectedTrackId,
  activeTab: application.activeTab,
  mode: application.mode,
  quality: preferences.quality,
  renderQuality: preferences.renderQuality,
  windowAspect: preferences.windowAspect,
  playbackOrder: playerState.playbackOrder,
});
const stableState = structuredClone(globalStateSnapshot());
await appFunctions.setTheme("night");
assert.deepEqual(globalStateSnapshot(), stableState, "Changing day/night appearance preserves shared app state and playback order.");
assert.equal(preferences.theme, "night");
assert.equal(saved.at(-1).value.styleProfiles.archive.mode, "night", "The active design's appearance is saved in its own profile.");

await appFunctions.switchDesign("rhine");
assert.deepEqual(globalStateSnapshot(), stableState, "Switching design preserves view, query, selection, track focus, tab, mode, quality, aspect and playback order.");
assert.equal(preferences.style.design, "rhine");
assert.equal(preferences.theme, "day", "Rhine restores its own saved day/night mode.");
assert.strictEqual(sceneCalls.cases.at(-1), caseProfiles.rhine, "Rhine uses its own case profile.");
assert.equal(albumPanelCalls.open.at(-1), true, "The shared right panel remains open when app mode is detail.");
assert.equal(sceneCalls.styles.filter(value => value?.aspect).at(-1).aspect, "21:9");
assert.deepEqual(preferences.caseProfiles, caseSnapshot, "Switching visual design does not merge or replace per-design case settings.");
assert.equal(saved.at(-1).value.view.layout, "array");
assert.equal(saved.at(-1).value.foobarArchive.layout, "future", "Saving retains the legacy projection of the new public view state.");
assert.equal(saved.at(-1).value.foobarArchive.show, "tracks");
assert.equal(playbackOrderChanges.length, 0, "A theme switch does not reset player ordering.");
application.mode = "archive";
appFunctions.syncSelectionMotion();
assert.equal(titleMotionCalls.at(-1)?.[0], "Needle song",
  "Future also retains the focused track title when selection motion is synchronized.");
application.mode = stableState.mode;
appFunctions.playAlbum();
assert.notEqual(albumB.tracks[0].id, application.selectedTrackId, "The retained-track fixture must differ from the album fallback.");
assert.equal(playbackCalls.at(-1)?.id, "needle-track", "Future starts the retained focused track rather than its album's first track.");

await appFunctions.setTheme("night");
await appFunctions.switchDesign("archive");
assert.deepEqual(globalStateSnapshot(), stableState, "Returning to Archive retains the same shared view and playback context.");
assert.equal(preferences.theme, "night", "Archive restores its independent night setting.");
assert.deepEqual(preferences.style, startingProfiles.archive.style, "Archive restores its own visual style profile.");
assert.strictEqual(sceneCalls.cases.at(-1), caseProfiles.archive, "Archive uses its own case profile.");
assert.deepEqual(preferences.caseProfiles, caseSnapshot);
assert.equal(playbackOrderChanges.length, 0);

appFunctions.playAlbum();
assert.equal(playbackCalls.at(-1)?.id, "needle-track", "The real playAlbum function starts the focused synthetic track.");
assert.strictEqual(playbackCalls.at(-1)?.tracks, albumB.tracks, "Focused playback remains inside the selected album.");
assert.equal(application.selectedAlbumId, "album-b");
assert.equal(application.activeTab, "about");
assert.equal(application.mode, "detail");

console.log("Unified public view, app state, preference allowlist, real catalog focus, design switching and playback orchestration passed with synthetic records and mocked UI/render/audio ports.");
