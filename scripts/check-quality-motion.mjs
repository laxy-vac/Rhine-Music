import assert from "node:assert/strict";
import {
  matchingPreset,
  normalizeQuality,
  qualityPresets,
  withQualityField,
} from "../src/render-quality.ts";
import { baselineSelectionWave } from "../src/motion.ts";
import {
  qualityIdleGain,
  qualityPulseLimit,
  qualitySelectionWave,
  qualityWaveLimit,
} from "../src/quality-motion.ts";

assert.deepEqual(normalizeQuality(null), qualityPresets.original);
for (const [key, value] of Object.entries({ wave: "full", modelDetail: "low", lighting: "full", terminalLight: "off", antialias: "smaa", shadows: 4096 })) {
  const result = withQualityField({ ...qualityPresets.original }, key, String(value));
  assert.equal(result[key], value, `the select event parser must retain ${key}'s actual type`);
  for (const other of Object.keys(result)) if (other !== key) assert.equal(result[other], qualityPresets.original[other]);
}
const oldStored = {
  scale: 115,
  pixelRatio: 1.5,
  antialias: "smaa",
  shadows: 1024,
  aoSamples: 16,
  aoResolution: 0.75,
  depthOfField: 55,
  transmission: 0.25,
  anisotropy: 8,
};
const migrated = normalizeQuality(oldStored);
for (const [key, value] of Object.entries(oldStored)) {
  assert.equal(migrated[key], value, `legacy setting ${key} is preserved`);
}
for (const key of ["wave", "modelDetail", "lighting", "terminalLight"]) {
  assert.equal(migrated[key], qualityPresets.original[key]);
}
assert.equal(normalizeQuality(undefined, false).wave, "reduced");
const invalidMotion = normalizeQuality({
  wave: "invalid",
  modelDetail: "invalid",
  lighting: "invalid",
  terminalLight: "invalid",
});
for (const key of ["wave", "modelDetail", "lighting", "terminalLight"]) {
  assert.equal(invalidMotion[key], qualityPresets.original[key]);
}

const expectedPresetMotion = {
  performance: ["basic", "low", "basic", "off"],
  original: ["reduced", "medium", "high", "local"],
  high: ["full", "high", "high", "full"],
  ultra: ["full", "high", "full", "full"],
};
for (const [name, quality] of Object.entries(qualityPresets)) {
  assert.equal(matchingPreset(normalizeQuality(quality)), name);
  assert.deepEqual(
    [
      quality.wave,
      quality.modelDetail,
      quality.lighting,
      quality.terminalLight,
    ],
    expectedPresetMotion[name],
  );
}
assert.equal(
  matchingPreset({ ...qualityPresets.original, wave: "basic" }),
  "custom",
);

assert.deepEqual(
  ["off", "basic", "reduced", "full"].map(qualityIdleGain),
  [0, 0.35, 0.65, 1],
);
assert.deepEqual(
  ["off", "basic", "reduced", "full"].map(qualityWaveLimit),
  [0, 0.2, 0.4, 0.6],
);
assert.deepEqual(
  ["off", "basic", "reduced", "full"].map(qualityPulseLimit),
  [0, 1, 3, 6],
);

assert.equal(qualitySelectionWave("off", 0, 0.5), 0);
for (const level of ["off", "basic", "reduced", "full"]) {
  assert.equal(qualitySelectionWave(level, Infinity, 1), 0);
  assert.equal(qualitySelectionWave(level, 1, NaN), 0);
}
assert.equal(
  qualitySelectionWave("full", 2.4, 1.5),
  baselineSelectionWave(2.4, 1.5),
);
assert.equal(qualitySelectionWave("full", 2, -0.01), 0);
assert.equal(qualitySelectionWave("full", 2, 3.21), 0);
assert.equal(qualitySelectionWave("reduced", 14, 1), 0);
assert.equal(qualitySelectionWave("basic", 3, 1), 0);

let sawPositive = false;
let sawNegative = false;
for (let distance = 0; distance <= 18; distance += 0.25) {
  for (let age = 0.05; age <= 3.2; age += 0.05) {
    const full = qualitySelectionWave("full", distance, age);
    const reduced = qualitySelectionWave("reduced", distance, age);
    const basic = qualitySelectionWave("basic", distance, age);
    assert.ok(
      Number.isFinite(full) &&
        Number.isFinite(reduced) &&
        Number.isFinite(basic),
    );
    sawPositive ||= full > 0;
    sawNegative ||= full < 0;
  }
}
assert.ok(sawPositive && sawNegative, "full wave retains both rise and trough");

const nearCutoff = qualitySelectionWave("reduced", 14 - 0.001, 1.1);
const beyondCutoff = qualitySelectionWave("reduced", 14 + 0.001, 1.1);
assert.ok(Math.abs(nearCutoff - beyondCutoff) < 0.0001);
const beforeEnd = qualitySelectionWave("full", 25.6, 3.199);
const afterEnd = qualitySelectionWave("full", 25.6, 3.201);
assert.ok(
  Math.abs(beforeEnd - afterEnd) < 0.0001,
  "wave fades continuously at 3.2s",
);

console.log(
  "Quality motion checks passed: storage migration, presets, bounded settings, finite waves and smooth cutoffs.",
);
