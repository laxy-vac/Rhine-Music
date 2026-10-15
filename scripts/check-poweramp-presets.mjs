import test from "node:test";
import assert from "node:assert/strict";
import { importPowerampPreset, normalizeProcessing, processingDefault } from "../src/audio-processing-model.mjs";
import { parseStandardEqPresetFile, serializeStandardEqPresetFile } from "../src/standard-eq-preset-format.mjs";

const graphicBands = [31, 62, 124, 249, 498, 996, 1995, 3993, 7993, 16000]
  .map((frequency, index) => ({
    type: 2,
    channels: 0,
    frequency,
    q: 0,
    gain: index === 5 ? 5.999999523162842 : 0,
    color: 0,
  }));

test("Poweramp graphic import keeps mode, control points, and numeric precision", () => {
  const parsed = parseStandardEqPresetFile(JSON.stringify({
    name: "嵌入名称",
    parametric: false,
    preamp: -1.25,
    bands: graphicBands,
  }), "headphones.json");
  assert.equal(parsed.format, "poweramp");
  assert.equal(parsed.eq.name, "headphones");
  assert.equal(parsed.eq.mode, "graphic");
  assert.equal(parsed.eq.preamp, -1.25);
  assert.equal(parsed.eq.bands[5].gain, 5.999999523162842);
  assert.equal(parsed.tone, undefined);
});

test("Poweramp tone prefix uses local defaults for missing or zero cutoff and Q", () => {
  const parsed = parseStandardEqPresetFile(JSON.stringify({
    parametric: true,
    preamp: 0,
    bands: [
      { type: 0, channels: 0, gain: 4, color: 0 },
      { type: 1, channels: 0, frequency: 0, q: 0, gain: -2, color: 0 },
      { type: 3, channels: 0, frequency: 1200, q: 1.25, gain: 3, color: 0 },
    ],
  }), "tone-example.json");
  assert.equal(parsed.format, "poweramp");
  assert.equal(parsed.eq.bands.length, 1);
  assert.equal(parsed.tone.bass.frequency, 80);
  assert.equal(parsed.tone.bass.q, 0.707);
  assert.equal(parsed.tone.bass.gain, 4);
  assert.equal(parsed.tone.treble.frequency, 8000);
  assert.equal(parsed.tone.treble.q, 0.707);
  assert.equal(parsed.tone.treble.gain, -2);
  assert.equal("enabled" in parsed.tone, false);
});

test("ordinary Poweramp low/high-pass bands on separate channels stay in the EQ", () => {
  const parsed = parseStandardEqPresetFile(JSON.stringify({
    parametric: true,
    bands: [
      { type: 0, channels: 1, frequency: 80, q: 0.8, gain: 0, color: 0 },
      { type: 1, channels: 2, frequency: 10000, q: 0.7, gain: 0, color: 0 },
    ],
  }));
  assert.equal(parsed.tone, undefined);
  assert.deepEqual(parsed.eq.bands.map((band) => band.channels), [1, 2]);
});

test("Poweramp empty parametric presets and tone-only presets parse as empty EQ", () => {
  const empty = parseStandardEqPresetFile(JSON.stringify({ parametric: true, bands: [] }), "empty.json");
  assert.equal(empty.eq.mode, "parametric");
  assert.deepEqual(empty.eq.bands, []);
  const toneOnly = parseStandardEqPresetFile(JSON.stringify({
    parametric: true,
    bands: [
      { type: 0, channels: 0, gain: 1, color: 0 },
      { type: 1, channels: 0, gain: 2, color: 0 },
    ],
  }));
  assert.deepEqual(toneOnly.eq.bands, []);
  assert.equal(toneOnly.tone.bass.gain, 1);
  assert.equal(toneOnly.tone.treble.gain, 2);
});

test("Rhine standard EQ files preserve local settings without carrying native or LSP fields", () => {
  const settings = normalizeProcessing({
    eq: {
      enabled: true,
      mode: "parametric",
      preamp: -2.5,
      bandwidth: 1.7,
      bands: [
        { type: 4, channels: 1, frequency: 105.25, q: 0.84375, gain: 6.125, enabled: false, locked: true },
        { type: 3, channels: 2, frequency: 2200, q: 1.234567, gain: -3.75 },
      ],
    },
    tone: {
      enabled: true,
      bass: { frequency: 91, q: 0.8125, gain: 4.5 },
      treble: { frequency: 9600, q: 0.625, gain: -1.25 },
    },
  }, { clamp: false });
  const text = serializeStandardEqPresetFile(settings);
  const payload = JSON.parse(text);
  assert.deepEqual(Object.keys(payload), ["format", "schemaVersion", "eq", "tone"]);
  assert.equal(payload.format, "rhine-standard-eq-preset");
  assert.equal(payload.schemaVersion, 1);
  assert.equal("name" in payload, false);
  assert.equal("parametric" in payload, false);
  assert.equal("bands" in payload, false);
  assert.equal("engine" in payload.eq, false);
  assert.equal("lsp" in payload.eq, false);

  const restored = parseStandardEqPresetFile(text, "my-eq.rhine-eq");
  assert.equal(restored.format, "rhine-standard");
  assert.equal(restored.eq.name, "my-eq");
  assert.equal(restored.eq.engine, "standard");
  assert.deepEqual(restored.eq.bands, settings.eq.bands);
  assert.deepEqual(restored.tone, settings.tone);
  assert.throws(() => importPowerampPreset(text), /parametric/);
});

test("Rhine standard EQ parser rejects unknown fields, invalid versions, and LSP payloads", () => {
  const baseline = JSON.parse(serializeStandardEqPresetFile(processingDefault));
  assert.throws(() => parseStandardEqPresetFile(JSON.stringify({ ...baseline, custom: true })), /字段/);
  assert.throws(() => parseStandardEqPresetFile(JSON.stringify({ ...baseline, schemaVersion: 2 })), /版本/);
  const lsp = normalizeProcessing({ eq: { engine: "lsp" } });
  assert.throws(() => serializeStandardEqPresetFile(lsp), /LSP/);
  assert.throws(() => parseStandardEqPresetFile(JSON.stringify({ ...baseline, format: "third-party" })), /格式/);
});

test("BOM and local file names are accepted without being stored in the preset body", () => {
  const text = `\uFEFF${serializeStandardEqPresetFile(processingDefault)}`;
  const parsed = parseStandardEqPresetFile(text, "平直.rhine-eq");
  assert.equal(parsed.eq.name, "平直");
  assert.equal(JSON.parse(text.replace(/^\uFEFF/, "")).eq.name, undefined);
});
