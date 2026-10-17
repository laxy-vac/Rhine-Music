import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const sourcePath = path.join(projectRoot, "src", "music-style.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const pickerSyncCalls = [];
const module = { exports: {} };
const sandbox = {
  Node: { TEXT_NODE: 3 },
  exports: module.exports,
  module,
  require(specifier) {
    if (specifier === "./assets/style/tokens.json")
      return { default: JSON.parse(readFileSync(path.join(projectRoot, "src", "assets", "style", "tokens.json"), "utf8")) };
    if (specifier === "./i18n") return { uiLanguage: () => "en" };
    if (specifier === "./future-appearance-picker") return {
      futureAppearancePickerMarkup: (palette, mode) =>
        `<div data-test-future-picker="${palette}" data-test-mode="${mode}"></div>`,
      syncFutureAppearancePicker: (root, palette, mode) => pickerSyncCalls.push({ root, palette, mode }),
    };
    throw new Error(`Unexpected module import in music-style.ts: ${specifier}`);
  },
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
const styleModule = module.exports;

const futureSoft = styleModule.normalizeMusicStyle({ design: "rhine" });
const futureOriginal = styleModule.normalizeMusicStyle({ design: "rhine", dayPalette: "original" });
const invalidFuture = styleModule.normalizeMusicStyle({ design: "rhine", dayPalette: "neon" });
assert.equal(futureSoft.dayPalette, "soft", "legacy Future preferences default to the existing soft palette");
assert.equal(invalidFuture.dayPalette, "soft", "invalid Future palette values normalize to soft");
assert.equal(futureOriginal.dayPalette, "original", "the original Future palette survives normalization");

const originalDay = styleModule.stylePalette(futureOriginal, "day");
for (const [key, value] of Object.entries({
  fg: "#080a08",
  muted: "#77756d",
  line: "#aaa59a",
  accent: "#9b7247",
  bg: "#e8e5e1",
  surface: "#edebe4",
  panel: "#edebe4",
  well: "#e7e3d9",
})) assert.equal(originalDay[key], value, `original day token ${key}`);
assert.equal(originalDay["text-muted"], "#77756d", "additional text tokens map to the official muted color");
assert.equal(originalDay["line-faint"], "#aaa59a", "additional line tokens map to the official rule color");
assert.equal(
  JSON.stringify(styleModule.stylePalette(futureOriginal, "night")),
  JSON.stringify(styleModule.stylePalette(futureSoft, "night")),
  "the day palette choice leaves Future night tokens unchanged",
);

const archiveWithInvalidFuturePalette = styleModule.normalizeMusicStyle({
  design: "archive",
  dayPalette: "original",
});
assert.equal(archiveWithInvalidFuturePalette.dayPalette, "soft", "Punk normalization fixes the Future palette field to its default");
for (const mode of ["day", "night"]) {
  assert.equal(
    JSON.stringify(styleModule.stylePalette(archiveWithInvalidFuturePalette, mode)),
    JSON.stringify(styleModule.stylePalette(styleModule.archiveMusicStyle, mode)),
    `Punk ${mode} tokens remain unchanged`,
  );
}

const initialProfiles = styleModule.normalizeDesignProfiles(undefined, futureOriginal, "day");
const switchedToPunk = styleModule.normalizeDesignProfiles(
  initialProfiles,
  archiveWithInvalidFuturePalette,
  "day",
);
assert.equal(switchedToPunk.rhine.style.dayPalette, "original", "switching to Punk retains the saved Future palette profile");
assert.equal(switchedToPunk.archive.style.dayPalette, "soft", "the Punk profile retains its default palette field");
const switchedBackToFuture = styleModule.normalizeDesignProfiles(
  switchedToPunk,
  switchedToPunk.rhine.style,
  "night",
);
assert.equal(switchedBackToFuture.rhine.style.dayPalette, "original", "switching back restores the saved Future palette");
assert.equal(switchedBackToFuture.rhine.mode, "night", "profile mode remains the global day/night mirror");

const removedProperties = new Set();
const setProperties = new Map();
const stage = {
  dataset: { futureDayPalette: "stale", scheme: "stale" },
  style: {
    removeProperty(property) { removedProperties.add(property); setProperties.delete(property); },
    setProperty(property, value) { setProperties.set(property, value); },
  },
};
styleModule.applyStylePalette(stage, futureOriginal, "day");
assert.equal(stage.dataset.design, "rhine", "Future data-design mapping");
assert.equal(stage.dataset.futureDayPalette, "original", "Future palette maps to data-future-day-palette");
assert.ok(removedProperties.has("--ink"), "Future clears stale inline palette variables before using CSS tokens");
styleModule.applyStylePalette(stage, archiveWithInvalidFuturePalette, "day");
assert.equal(stage.dataset.futureDayPalette, undefined, "switching to Punk removes the Future-only data attribute");

const futureMarkup = styleModule.musicStyleMarkup(futureOriginal, "day", true);
assert.match(futureMarkup, /data-test-future-picker="original"/, "Future STYLE uses the new appearance picker markup");
assert.match(futureMarkup, /data-follow-system-theme/, "Future picker keeps the independent system-follow control");
const punkMarkup = styleModule.musicStyleMarkup(archiveWithInvalidFuturePalette, "day", false);
assert.match(punkMarkup, /class="theme-mode-buttons"/, "Punk retains its existing day/night buttons");
assert.doesNotMatch(punkMarkup, /data-test-future-picker/, "Punk does not expose the Future picker");

const preview = {
  dataset: { previewDesign: "rhine", previewMode: "night" },
  style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); } },
};
const dayButton = { dataset: { theme: "day" }, value: undefined, setAttribute(name, value) { this[name] = value; } };
const nightButton = { dataset: { theme: "night" }, value: undefined, setAttribute(name, value) { this[name] = value; } };
const followSystem = { checked: false };
const modeIndicator = { lastChild: { nodeType: 3, textContent: 'LIGHT' } };
const root = {
  querySelector(selector) { return selector === '.style-mode-indicator' ? modeIndicator : null; },
  querySelectorAll(selector) {
    if (selector === ".theme-choice-preview") return [preview];
    if (selector === "button[data-theme]") return [dayButton, nightButton];
    if (selector === "[data-follow-system-theme]") return [followSystem];
    return [];
  },
};
styleModule.syncMusicStyleAppearance(root, futureOriginal, "night", true);
assert.equal(modeIndicator.lastChild.textContent, 'DARK', 'the visible mode label updates without rebuilding the picker');
assert.equal(preview.dataset.previewMode, "night", "live design preview tracks mode without replacing its DOM");
assert.equal(preview.style.values.get("--mini-bg"), styleModule.stylePalette(futureOriginal, "night").bg, "live preview uses the selected design palette");
assert.equal(dayButton["aria-pressed"], "false");
assert.equal(nightButton["aria-pressed"], "true");
assert.equal(followSystem.checked, true);
assert.equal(pickerSyncCalls.at(-1).root, root);
assert.equal(pickerSyncCalls.at(-1).palette, "original");
assert.equal(pickerSyncCalls.at(-1).mode, "night");

const css = readFileSync(path.join(projectRoot, "src", "future-day-palette.css"), "utf8");
assert.match(css, /\.music-app\[data-design="rhine"\]\[data-theme="day"\]\[data-future-day-palette="original"\]/);
assert.match(css, /--ink:\s*#080a08/);
assert.match(css, /--page-bg:\s*#e8e5e1/);
assert.doesNotMatch(css, /data-theme="night"/, "the CSS override is limited to Future day mode");

console.log("Future day palette checks passed.");
