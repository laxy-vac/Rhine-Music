import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  entryPoints: [path.join(project, "src", "archive-label.ts")],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  target: "node20",
  define: { "import.meta.env.BASE_URL": '"/"' },
});
const sourceText = built.outputFiles[0]?.text;
assert.ok(sourceText, "esbuild must compile the label helpers in memory.");
const compiledModule = { exports: {} };
new Function("require", "module", "exports", sourceText)(
  createRequire(import.meta.url), compiledModule, compiledModule.exports,
);
const { paintArchiveLabel, rhineSourceBadge } = compiledModule.exports;
assert.equal(typeof paintArchiveLabel, "function");
assert.equal(typeof rhineSourceBadge, "function");

function createMockCanvas(width = 1024, height = 440) {
  const calls = [];
  const context = {
    fillStyle: "",
    font: "",
    save() { calls.push({ type: "save" }); },
    restore() { calls.push({ type: "restore" }); },
    setTransform(...matrix) { calls.push({ type: "setTransform", matrix }); },
    clearRect(...rect) { calls.push({ type: "clearRect", rect }); },
    fillRect(...rect) { calls.push({ type: "fillRect", rect, fillStyle: this.fillStyle }); },
    fillText(text, x, y) { calls.push({ type: "fillText", text, x, y, fillStyle: this.fillStyle, font: this.font }); },
    drawImage(image, x, y, imageWidth, imageHeight) {
      calls.push({ type: "drawImage", image, x, y, width: imageWidth, height: imageHeight });
    },
  };
  return {
    canvas: {
      width,
      height,
      getContext(kind) {
        assert.equal(kind, "2d");
        return context;
      },
    },
    calls,
  };
}

const expectedRects = [
  { rect: [0, 0, 1024, 440], fillStyle: "#e6e2d9" },
  { rect: [12, 12, 1000, 6], fillStyle: "#171713" },
  { rect: [12, 419, 1000, 3], fillStyle: "#171713" },
  { rect: [782, 32, 221, 39], fillStyle: "#171713" },
];
const expectedTextsBeforeNumber = [
  { text: "RHINE LAB, LLC.", x: 22, y: 116, fillStyle: "#171713", font: "bold 81px MiSans, sans-serif" },
  { text: "INTERNAL DATABASE", x: 25, y: 174, fillStyle: "#878476", font: "32px MiSans, sans-serif" },
];
const expectedTextsAfterNumber = [
  { text: "R L / I S", x: 809, y: 61, fillStyle: "#eee9de", font: "24px MiSans, sans-serif" },
  { text: "INFO", x: 830, y: 143, fillStyle: "#171713", font: "bold 64px MiSans, sans-serif" },
];

for (const [index, number] of [
  [0, "NO.001"],
  [1, "NO.002"],
  [998, "NO.999"],
  [999, "NO.1000"],
  [undefined, "NO.---"],
  [-1, "NO.---"],
  [1.5, "NO.---"],
  [Number.NaN, "NO.---"],
  [Number.POSITIVE_INFINITY, "NO.---"],
]) {
  const { canvas, calls } = createMockCanvas();
  paintArchiveLabel(canvas, index);
  assert.equal(calls[0]?.type, "save");
  assert.deepEqual(calls[1], { type: "setTransform", matrix: [1, 0, 0, 1, 0, 0] });
  assert.equal(calls.at(-1)?.type, "restore");
  assert.deepEqual(calls.filter(call => call.type === "fillRect").map(({ rect, fillStyle }) => ({ rect, fillStyle })), expectedRects);
  const textCalls = calls.filter(call => call.type === "fillText").map(({ text, x, y, fillStyle, font }) => ({ text, x, y, fillStyle, font }));
  assert.deepEqual(textCalls.slice(0, 2), expectedTextsBeforeNumber);
  assert.deepEqual(textCalls[2], { text: number, x: 22, y: 360, fillStyle: "#171713", font: "bold 130px MiSans, sans-serif" });
  assert.deepEqual(textCalls.slice(3), expectedTextsAfterNumber);
  assert.equal(calls.some(call => call.type === "drawImage"), false,
    "No drawImage call is allowed when no mark is supplied.");
}

const scaled = createMockCanvas(512, 220);
paintArchiveLabel(scaled.canvas, 0);
assert.deepEqual(scaled.calls[1], { type: "setTransform", matrix: [0.5, 0, 0, 0.5, 0, 0] },
  "The original 1024×440 design grid must scale with the target canvas dimensions.");
assert.deepEqual(scaled.calls.filter(call => call.type === "fillRect").map(({ rect }) => rect),
  expectedRects.map(({ rect }) => rect), "Scaled canvases must keep the same logical label layout.");

const readyMark = { complete: true, naturalWidth: 210, naturalHeight: 98 };
const contained = createMockCanvas(1024, 614);
paintArchiveLabel(contained.canvas, 0, readyMark, { fit: "contain" });
assert.deepEqual(contained.calls.filter(call => call.type === "setTransform").map(call => call.matrix), [
  [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 87],
], "The 1024×440 label artwork must be centered without stretching inside a 1024×614 Punk plaque.");
assert.deepEqual(contained.calls.find(call => call.type === "clearRect")?.rect, [0, 0, 1024, 614],
  "Contain mode must clear the full target canvas before painting the background and label.");
assert.deepEqual(contained.calls.filter(call => call.type === "fillRect").slice(0, 2).map(({ rect, fillStyle }) => ({ rect, fillStyle })), [
  { rect: [0, 0, 1024, 614], fillStyle: "#e6e2d9" },
  { rect: [0, 0, 1024, 440], fillStyle: "#e6e2d9" },
], "Contain mode must retain the full paper plaque and centered original paper label.");
assert.deepEqual(contained.calls.find(call => call.type === "drawImage"), {
  type: "drawImage", image: readyMark, x: 790, y: 242, width: 210, height: 98,
});

const transparentInk = createMockCanvas(1024, 614);
paintArchiveLabel(transparentInk.canvas, 9, readyMark, { background: false, fit: "contain" });
assert.deepEqual(transparentInk.calls.filter(call => call.type === "setTransform").map(call => call.matrix), [
  [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 0, 87],
]);
assert.deepEqual(transparentInk.calls.find(call => call.type === "clearRect")?.rect, [0, 0, 1024, 614]);
assert.equal(transparentInk.calls.some(call => call.type === "fillRect" && call.fillStyle === "#e6e2d9"), false,
  "An ink-only layer must leave the physical Punk nameplate paper visible.");
assert.equal(transparentInk.calls.some(call => call.type === "fillText" && call.text === "NO.010"), true,
  "The transparent Punk ink layer must retain the canonical album number.");
assert.ok(transparentInk.calls.some(call => call.type === "drawImage" && call.image === readyMark),
  "The transparent Punk ink layer must retain the ready brand mark.");

const unready = createMockCanvas();
paintArchiveLabel(unready.canvas, 0, { complete: false, naturalWidth: 0, naturalHeight: 0 });
assert.equal(unready.calls.some(call => call.type === "drawImage"), false,
  "An image that has not loaded must not be drawn.");
const failed = createMockCanvas();
paintArchiveLabel(failed.canvas, 0, { complete: true, naturalWidth: 0, naturalHeight: 0 });
assert.equal(failed.calls.some(call => call.type === "drawImage"), false,
  "A failed or zero-size image must not be drawn.");
const withMark = createMockCanvas();
paintArchiveLabel(withMark.canvas, 0, readyMark);
assert.deepEqual(withMark.calls.find(call => call.type === "drawImage"), {
  type: "drawImage", image: readyMark, x: 790, y: 242, width: 210, height: 98,
});

function track(overrides = {}) {
  return {
    id: "track-1",
    albumId: "album-1",
    title: "Track",
    artist: "Artist",
    duration: 180,
    format: "FLAC",
    browserPlayable: true,
    audioUrl: "",
    relativePath: "",
    ...overrides,
  };
}

function sourceBadge(tracks) {
  const album = { tracks };
  const before = structuredClone(album);
  const badge = rhineSourceBadge(album);
  assert.deepEqual(album, before, "Badge classification must not mutate source track metadata.");
  return badge;
}

const dsd = track({ format: "DSF", codec: "DSD", sampleRate: 2_822_400, bitsPerSample: 1, lossless: true });
const hiResPcm = track({ format: "FLAC", codec: "FLAC", sampleRate: 96_000, bitsPerSample: 24, lossless: true });
const cdQuality = track({ format: "FLAC", codec: "FLAC", sampleRate: 44_100, bitsPerSample: 16, lossless: true });
const lossyHiRate = track({ format: "MP3", codec: "MP3", sampleRate: 96_000, bitsPerSample: 24, lossless: false });
const missingMetadata = track({ format: "FLAC", lossless: true });
assert.equal(rhineSourceBadge(undefined), undefined);
assert.equal(sourceBadge([]), undefined, "An empty album must not receive an album-level mark.");
assert.equal(sourceBadge([dsd]), "hi-res-dsd", "A full DSD album must receive both independently qualified marks.");
assert.equal(sourceBadge([hiResPcm]), "hi-res", "A full Hi-Res PCM album must receive the Hi-Res badge.");
assert.equal(sourceBadge([dsd, hiResPcm]), "hi-res",
  "A DSD plus Hi-Res PCM album is wholly Hi-Res, but not wholly DSD.");
assert.equal(sourceBadge([dsd, cdQuality]), undefined,
  "A DSD plus CD-quality album must not claim the entire album is Hi-Res or DSD.");
assert.equal(sourceBadge([dsd, lossyHiRate]), undefined,
  "A DSD plus lossy album must not receive an album-level source badge.");
assert.equal(sourceBadge([dsd, missingMetadata]), undefined,
  "A DSD plus unknown-format album must not receive an album-level source badge.");
assert.equal(sourceBadge([missingMetadata]), undefined,
  "Missing source sample-rate or bit-depth metadata must stay unmarked.");

console.log(JSON.stringify({
  ok: true,
  archiveLabelNumbers: ["NO.001", "NO.002", "NO.999", "NO.1000", "NO.---"],
  scaledCanvas: "512x220 uses the 1024x440 logical layout",
  optionalMark: "omitted/unready skipped; loaded image drawn at original coordinates",
  sourceBadges: {
    allDsd: "hi-res-dsd",
    allHiResPcm: "hi-res",
    mixedDsdAndHiResPcm: "hi-res",
    dsdAndCdQuality: undefined,
    dsdAndLossy: undefined,
    dsdAndUnknown: undefined,
    missingMetadata: undefined,
  },
}, null, 2));
