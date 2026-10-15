// Focused pure contracts; the companion --unified-render audit checks real Scene matrices.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools", "punk-array-motion");
const bundled = await build({
  stdin: { contents: 'export { PunkArrayMotion } from "./src/punk-array-motion.ts"; export { punkArraySelectionWave } from "./src/quality-motion.ts";',
    resolveDir: project, sourcefile: "punk-array-motion-check.ts" },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { PunkArrayMotion, punkArraySelectionWave } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const first = 12;
const motion = new PunkArrayMotion(first);
const keys = ["shelf-a", "shelf-b", "shelf-c", "shelf-d"];
motion.bind(keys, 0, first, true);
const rail = lane => motion.rail(lane, 1.2, 15.5, -2.17);
const initial = keys.map((_, lane) => ({ row: motion.row(lane), rail: rail(lane) }));
for (let frame = 0; frame < 20; frame++) motion.step(0, 22, 3.7, 1 / 60, false);
assert.ok(motion.row(0) > first && motion.row(0) < 22, "Active rail must interpolate before reaching its target.");
for (const lane of [1, 2, 3]) {
  assert.equal(motion.row(lane), initial[lane].row, "Another lane's row remains exactly held.");
  assert.equal(rail(lane), initial[lane].rail, "Another lane's rail remains exactly held.");
}
const interrupted = motion.row(0);
assert.notEqual(motion.velocity(0), 0, "The interruption fixture must carry residual velocity.");
motion.step(1, 18, 3.7, 1 / 60, false);
assert.equal(motion.velocity(0), 0, "The previous lane loses its residual velocity at the lane switch.");
for (let frame = 0; frame < 40; frame++) motion.step(1, 18, 3.7, 1 / 60, false);
assert.equal(motion.row(0), interrupted, "Switching lanes freezes the former lane immediately, including residual velocity.");
assert.ok(motion.row(1) > first && motion.row(1) < 18);
const rowsBeforeReorder = keys.map((_, lane) => motion.row(lane));
motion.bind(["shelf-c", "shelf-a", "new-shelf", "shelf-b"], 3, 18);
assert.equal(motion.row(0), rowsBeforeReorder[2]);
assert.equal(motion.row(1), rowsBeforeReorder[0]);
assert.equal(motion.row(2), first, "A new stable shelf key starts at its first row.");
assert.equal(motion.row(3), rowsBeforeReorder[1], "Reordering shelves preserves each stable key's individual position.");
motion.step(3, 27, 3.7, 1 / 60, true);
assert.equal(motion.row(3), 27, "Reduced motion immediately positions the active lane.");
assert.equal(motion.row(1), interrupted, "Reduced motion cannot move an inactive lane.");
motion.bind(["shelf-c", "shelf-a", "new-shelf", "shelf-b"], 1, 16, true);
assert.equal(motion.row(1), 16, "Explicit bind snap positions the selected lane.");
const finiteBefore = [0, 1, 2, 3].map(lane => motion.row(lane));
for (const [row, rate, dt] of [[NaN, 3.7, 1 / 60], [Infinity, 3.7, 1 / 60], [20, NaN, 1 / 60],
  [20, 0, 1 / 60], [20, -1, 1 / 60], [20, 3.7, Infinity], [20, 3.7, -1]]) motion.step(1, row, rate, dt, false);
assert.deepEqual([0, 1, 2, 3].map(lane => motion.row(lane)), finiteBefore, "Invalid numeric updates preserve the last finite lane state.");
motion.step(99, 22, 3.7, 1 / 60, false);
assert.deepEqual([0, 1, 2, 3].map(lane => motion.row(lane)), finiteBefore, "A missing lane cannot move any bound shelf.");
assert.equal(new PunkArrayMotion(NaN).row(0), 12, "An invalid constructor position falls back to the declared first slot.");

const waves = ["off", "basic", "reduced", "full"].map(level => ({ level,
  samples: [0, .15, .3, .45, .7, 1, 1.6, 2.5].flatMap(age => [0, .5, 1, 2, 4, 8].map(distance => ({ age, distance, value: punkArraySelectionWave(level, distance, age) }))) }));
const energy = item => item.samples.reduce((sum, sample) => sum + Math.abs(sample.value), 0);
const strengths = waves.map(energy);
for (const level of ["off", "basic", "reduced", "full"]) for (const [distance, age] of [[NaN, 1], [1, Infinity], [1, -1], [1, 3.21]])
  assert.equal(punkArraySelectionWave(level, distance, age), 0, "Non-finite or out-of-lifetime wave samples are silent.");
assert.equal(strengths[0], 0, "Off emits no selection wave.");
assert.ok(strengths[1] > 0 && strengths[1] < strengths[2] && strengths[2] < strengths[3], "Light/medium/strong waves retain strictly ordered nonzero strength.");
for (let index = 0; index < waves[3].samples.length; index++) {
  const full = waves[3].samples[index].value;
  assert.ok(Math.abs(waves[1].samples[index].value - full * .35) < 1e-12);
  assert.ok(Math.abs(waves[2].samples[index].value - full * .65) < 1e-12);
}
await mkdir(output, { recursive: true });
const report = { ok: true, scope: "Pure lane rail ownership and wave-level contracts; real transforms are audited separately by --unified-render.",
  initial, interrupted, rowsBeforeReorder, finalRows: [0, 1, 2, 3].map(lane => motion.row(lane)), strengths, waves };
await writeFile(path.join(output, "pure-motion-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, checks: ["active-only damping", "immediate old-lane freeze", "stable-key reorder", "reduced snap", "ordered wave strength"], report: ".tools/punk-array-motion/pure-motion-audit.json" }, null, 2));
