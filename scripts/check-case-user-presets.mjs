import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { normalizeWindowAspect } from "../src/window-aspect-model.mjs";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureEntry = `
import { caseAppearancePresets, casePreset } from "./src/case-settings.ts";
export { caseAppearancePresets, casePreset, normalizeCaseSettings } from "./src/case-settings.ts";
export { CASE_USER_PRESET_LIMIT, caseUserPresetAppearance, caseUserPresetMatches, normalizeCaseUserPresets } from "./src/case-user-presets.ts";
`;
const built = await build({
  stdin: { contents: fixtureEntry, resolveDir: project, sourcefile: "case-user-presets-check.ts", loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "es2022",
});
const bundle = built.outputFiles[0]?.text;
assert.ok(bundle, "esbuild must compile the case preset check in memory.");
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);
const {
  CASE_USER_PRESET_LIMIT,
  caseAppearancePresets,
  casePreset,
  caseUserPresetAppearance,
  caseUserPresetMatches,
  normalizeCaseUserPresets,
} = api;

const builtInsBefore = JSON.stringify(caseAppearancePresets);
const rhineAppearance = casePreset("original", "rhine");
rhineAppearance.surfaces.cover.transmissionOverride = .37;
rhineAppearance.surfaces.cover.opacityOverride = .4;
const rhineReloaded = api.normalizeCaseSettings(JSON.parse(JSON.stringify({ structure: "rhine", appearances: { rhine: rhineAppearance } })), "rhine");
assert.equal(rhineReloaded.appearances.rhine.surfaces.cover.transmissionOverride, .37);
assert.equal(rhineReloaded.appearances.rhine.surfaces.cover.opacityOverride, .4);
assert.equal(rhineReloaded.appearances.rhine.surfaces.cover.preserveSource, true, "Optical sliders must keep the original Rhine material enabled after preferences reload.");
const archiveDefault = api.normalizeCaseSettings(undefined, "archive");
assert.equal(archiveDefault.enabled, true, "New Archive profiles must start in editable Punk mode.");
const archiveLegacyAppearance = casePreset("glass", "punk");
archiveLegacyAppearance.preset = "custom";
archiveLegacyAppearance.presetRevision = 4;
archiveLegacyAppearance.surfaces.frame.color = "#2357A1";
archiveLegacyAppearance.transforms = {
  frame: { visible: true, offset: [.2, -.1, .3], rotation: [4, 5, 6], scale: [1.1, .9, 1] },
};
const archiveFixture = { structure: "punk", appearances: { punk: archiveLegacyAppearance } };
const archiveEnabledBaseline = api.normalizeCaseSettings(JSON.parse(JSON.stringify({ ...archiveFixture, enabled: true })), "archive");
const archiveLegacy = api.normalizeCaseSettings(JSON.parse(JSON.stringify({ ...archiveFixture, enabled: false })), "archive");
assert.equal(archiveLegacy.enabled, true, "A legacy Archive disabled flag must migrate directly to the editable case.");
assert.deepEqual(archiveLegacy.appearances.punk, archiveEnabledBaseline.appearances.punk,
  "Forcing Archive editable mode must not alter the normalized Punk appearance.");
assert.equal(archiveLegacy.appearances.punk.surfaces.frame.color, "#2357A1");
assert.deepEqual(archiveLegacy.appearances.punk.transforms.frame, {
  visible: true, offset: [.2, -.1, .3], rotation: [4, 5, 6], scale: [1.1, .9, 1],
});
const sourceAppearance = casePreset("glass", "punk");
sourceAppearance.preset = "marble";
sourceAppearance.presetRevision = 1;
sourceAppearance.surfaces.cover = {
  ...sourceAppearance.surfaces.cover,
  finish: "glass",
  color: "#1234AB",
  roughness: 0.217,
  transmission: 0.937,
  ior: 1.73,
  emission: 0.12,
  pattern: "gradient",
  secondaryColor: "#ABCDEF",
  gradientAngle: -37,
  metalness: 0.37,
  clearcoat: 0.63,
  clearcoatRoughness: 0.29,
  iridescence: 0.11,
  thickness: 0.31,
  attenuationDistance: 3.17,
  preserveSource: false,
};
sourceAppearance.transforms = {
  frame: { visible: false, offset: [0.125, -0.25, 0.375], rotation: [12.5, -30, 45], scale: [1.25, 0.75, 2.5] },
  optics: { visible: true, offset: [-0.5, 0.25, 0], rotation: [0, 45, 0], scale: [0.9, 1.1, 1.2] },
};
const sourceBefore = JSON.stringify(sourceAppearance);
const snapshot = caseUserPresetAppearance(sourceAppearance);
assert.equal(JSON.stringify(sourceAppearance), sourceBefore, "Snapshot normalization must not mutate the source appearance.");
assert.equal(snapshot.preset, "custom");
assert.equal(snapshot.presetRevision, 4, "Personal snapshots must bypass built-in fingerprint migration.");
assert.equal(snapshot.surfaces.cover.color, "#1234AB");
assert.equal(snapshot.surfaces.cover.transmission, 0.937);
assert.equal(snapshot.surfaces.cover.ior, 1.73);
assert.equal(snapshot.surfaces.cover.clearcoatRoughness, 0.29);
assert.deepEqual(snapshot.transforms?.frame, {
  visible: false,
  offset: [0.125, -0.25, 0.375],
  rotation: [12.5, -30, 45],
  scale: [1.25, 0.75, 2.5],
});

sourceAppearance.surfaces.cover.color = "#000000";
sourceAppearance.transforms.frame.offset[0] = 9;
assert.equal(snapshot.surfaces.cover.color, "#1234AB", "Saved material data must be detached from the source.");
assert.equal(snapshot.transforms?.frame?.offset[0], 0.125, "Saved transforms must be detached from the source.");
const detached = caseUserPresetAppearance(snapshot);
detached.surfaces.cover.color = "#FFFFFF";
detached.transforms.frame.offset[1] = 8;
assert.equal(snapshot.surfaces.cover.color, "#1234AB", "Returned snapshots must be deeply independent.");
assert.equal(snapshot.transforms?.frame?.offset[1], -0.25);
assert.equal(JSON.stringify(caseAppearancePresets), builtInsBefore, "Preset normalization must leave built-in presets unchanged.");

const record = { id: "future_glass_1", name: "  Glass test  ", appearance: snapshot };
const normalized = normalizeCaseUserPresets([record]);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].name, "Glass test");
assert.equal(normalized[0].appearance.preset, "custom");
assert.deepEqual(
  normalizeCaseUserPresets(JSON.parse(JSON.stringify(normalized))),
  normalized,
  "Personal presets must survive a preferences JSON round trip.",
);
record.appearance.surfaces.cover.color = "#111111";
assert.equal(normalized[0].appearance.surfaces.cover.color, "#1234AB", "Normalized library records must not alias their inputs.");

const sameContentDifferentOrder = caseUserPresetAppearance(normalized[0].appearance);
sameContentDifferentOrder.preset = "aurora";
sameContentDifferentOrder.presetRevision = 1;
sameContentDifferentOrder.transforms = Object.fromEntries(Object.entries(sameContentDifferentOrder.transforms ?? {}).reverse());
sameContentDifferentOrder.surfaces = Object.fromEntries(
  Object.entries(sameContentDifferentOrder.surfaces).reverse().map(([part, surface]) => [
    part,
    Object.fromEntries(Object.entries(surface).reverse()),
  ]),
);
assert.equal(caseUserPresetMatches(normalized[0], sameContentDifferentOrder), true,
  "Matching must ignore preset labels and recursively ignore object insertion order.");
const noTransforms = caseUserPresetAppearance(normalized[0].appearance);
delete noTransforms.transforms;
const emptyTransforms = caseUserPresetAppearance(normalized[0].appearance);
emptyTransforms.transforms = {};
assert.equal(caseUserPresetMatches({ ...normalized[0], appearance: noTransforms }, emptyTransforms), true,
  "An omitted transforms object must match an empty one.");
emptyTransforms.surfaces.cover.color = "#FFFFFF";
assert.equal(caseUserPresetMatches(normalized[0], emptyTransforms), false,
  "A material difference must make the appearance stop matching.");

const textOnlyName = "<img src=x onerror=alert(1)>";
const malformed = normalizeCaseUserPresets([
  { id: "duplicate", name: "First", appearance: snapshot },
  { id: "duplicate", name: "Second", appearance: snapshot },
  { id: "different", name: " first ", appearance: snapshot },
  { id: "bad id", name: "Bad ID", appearance: snapshot },
  { id: "bad-newline\n", name: "Bad newline", appearance: snapshot },
  { id: "blank", name: "   ", appearance: snapshot },
  { id: "long", name: "x".repeat(65), appearance: snapshot },
  { id: "I".repeat(81), name: "Long ID", appearance: snapshot },
  { id: "bad-surfaces", name: "Bad surfaces", appearance: { ...snapshot, surfaces: [] } },
  { id: "I".repeat(80), name: "x".repeat(64), appearance: snapshot },
  { id: "unsafe-name", name: textOnlyName, appearance: snapshot },
]);
assert.deepEqual(malformed.map(item => [item.id, item.name]), [
  ["duplicate", "First"],
  ["I".repeat(80), "x".repeat(64)],
  ["unsafe-name", textOnlyName],
], "Invalid records and duplicate IDs/names must be discarded; length boundaries pass and names remain plain text data.");
assert.deepEqual(normalizeCaseUserPresets({ id: "not-an-array" }), []);

const limited = normalizeCaseUserPresets(Array.from({ length: CASE_USER_PRESET_LIMIT + 2 }, (_, index) => ({
  id: `preset_${index}`,
  name: `Preset ${index}`,
  appearance: snapshot,
})));
assert.equal(limited.length, CASE_USER_PRESET_LIMIT, "The personal library must stay within its preference-size bound.");

const archiveAppearance = caseUserPresetAppearance(snapshot);
archiveAppearance.surfaces.frame.color = "#EE642F";
const archiveNormalized = normalizeCaseUserPresets([{
  id: "archive_glass_1",
  name: "Archive glass",
  appearance: archiveAppearance,
}]);
assert.equal(archiveNormalized.length, 1);
assert.notEqual(archiveNormalized[0].appearance.surfaces.frame.color, normalized[0].appearance.surfaces.frame.color,
  "The Archive and Future libraries must be able to hold different Punk snapshots.");

const desktopMain = await readFile(path.join(project, "desktop", "main.cjs"), "utf8");
const selectorStart = desktopMain.indexOf("const preferenceKeys=");
const selectorEnd = desktopMain.indexOf("const selectAudioPresetStore=", selectorStart);
assert.ok(selectorStart >= 0 && selectorEnd > selectorStart, "The desktop preference selector must be extractable.");
const selectorSource = desktopMain.slice(selectorStart, selectorEnd);
const selectPreferences = new Function(
  "windowAspectModel",
  "Buffer",
  `${selectorSource};return selectPreferences;`,
)({ normalizeWindowAspect }, Buffer);
const desktopRoundTrip = selectPreferences({
  language: "en",
  windowAspect: "16:9",
  futurePunkPresets: normalized,
  archivePunkPresets: archiveNormalized,
  unknownField: true,
});
assert.deepEqual(desktopRoundTrip.futurePunkPresets, normalized,
  "The desktop preference whitelist must retain Future Punk presets.");
assert.deepEqual(desktopRoundTrip.archivePunkPresets, archiveNormalized,
  "The desktop preference whitelist must retain Archive Punk presets independently.");
assert.notStrictEqual(desktopRoundTrip.futurePunkPresets, desktopRoundTrip.archivePunkPresets,
  "The desktop preference fields must remain separate arrays.");
assert.equal(Object.hasOwn(desktopRoundTrip, "unknownField"), false,
  "The preference selector must continue to discard unknown fields.");

console.log("Case user preset checks passed: bounded Future/Archive JSON persistence, normalized deep copies, stable matching, and desktop allowlist.");
