// Focused pure contracts; the companion --array-composition audit checks real Scene matrices.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools", "array-composition");
const bundled = await build({
  stdin: { contents: 'export * from "./src/music-array-motion.ts";',
    resolveDir: project, sourcefile: "punk-array-motion-check.ts" },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { MusicArrayMotion: PunkArrayMotion, MusicArrayCaseMotion, ARRAY_SELECTED_EXTRA_LIFT, ARRAY_SELECTED_BELL_LIFT,
  ARRAY_HOVER_LIFT, arrayNeighborLift, arrayLaneAppearance } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
const first = 12;
const motion = new PunkArrayMotion(first);
const keys = ["shelf-a", "shelf-b", "shelf-c", "shelf-d"];
motion.bind(keys, 0, first, true, 6);
const rail = lane => motion.rail(lane, 1.2, 15.5, -2.17);
const initial = keys.map((_, lane) => ({ row: motion.row(lane), rail: rail(lane) }));
assert.deepEqual(initial.map(value => value.row), [first, first, first, first], "Every new column starts at the same first-card anchor.");
assert.deepEqual(initial.map(value => value.rail), [rail(0), rail(0), rail(0), rail(0)], "Every new column's first card starts at the same world Z.");
for (let slot = 0; slot < 5; slot++)
  assert.equal(motion.targetRow(first + slot), first, "Selecting any of the first five cards must not scroll the column.");
assert.equal(motion.targetRow(first + 5), first + 1, "The sixth card advances the anchor only enough to remain in view.");
assert.equal(motion.targetRow(first + 19), first + 14, "The last card clamps to the last full six-card window.");
assert.equal(motion.targetRow(first + 19, 8), first + 12, "The final anchor follows the live eight-card viewport capacity.");
for (let frame = 0; frame < 20; frame++) motion.step(0, 22, 3.7, 1 / 60, false, 6);
assert.ok(motion.row(0) > first && motion.row(0) < motion.targetRow(22), "Active rail must interpolate before reaching its clamped anchor target.");
for (const lane of [1, 2, 3]) {
  assert.equal(motion.row(lane), initial[lane].row, "Another lane's row remains exactly held.");
  assert.equal(rail(lane), initial[lane].rail, "Another lane's rail remains exactly held.");
}
const interrupted = motion.row(0);
assert.notEqual(motion.velocity(0), 0, "The interruption fixture must carry residual velocity.");
motion.step(1, 18, 3.7, 1 / 60, false, 6);
assert.equal(motion.velocity(0), 0, "The previous lane loses its residual velocity at the lane switch.");
for (let frame = 0; frame < 40; frame++) motion.step(1, 18, 3.7, 1 / 60, false, 6);
assert.equal(motion.row(0), interrupted, "Switching lanes freezes the former lane immediately, including residual velocity.");
assert.ok(motion.row(1) > first && motion.row(1) < motion.targetRow(18));
const rowsBeforeReorder = keys.map((_, lane) => motion.row(lane));
motion.bind(["shelf-c", "shelf-a", "new-shelf", "shelf-b"], 3, 18, false, 6);
assert.equal(motion.row(0), rowsBeforeReorder[2]);
assert.equal(motion.row(1), rowsBeforeReorder[0]);
assert.equal(motion.row(2), first, "A new stable shelf key starts at its first row.");
assert.equal(motion.row(3), rowsBeforeReorder[1], "Reordering shelves preserves each stable key's individual position.");
motion.step(3, 27, 3.7, 1 / 60, true, 6);
const remembered = motion.row(3);
motion.bind(["shelf-a", "new-shelf", "shelf-b"], 1, 12, false, 6);
motion.bind(["shelf-c", "shelf-a", "new-shelf", "shelf-b"], 3, 12, false, 6);
assert.equal(motion.row(3), remembered, "Leaving and returning to a stable shelf key restores its remembered scroll anchor.");
motion.step(3, 27, 3.7, 1 / 60, true, 6);
assert.equal(motion.row(3), motion.targetRow(27), "Reduced motion immediately positions the active lane at its clamped anchor.");
assert.equal(motion.row(1), interrupted, "Reduced motion cannot move an inactive lane.");
motion.bind(["shelf-c", "shelf-a", "new-shelf", "shelf-b"], 1, 16, true, 6);
assert.equal(motion.row(1), first, "Explicit bind snap applies the first-five-card no-scroll rule.");
const finiteBefore = [0, 1, 2, 3].map(lane => motion.row(lane));
for (const [row, rate, dt] of [[NaN, 3.7, 1 / 60], [Infinity, 3.7, 1 / 60], [20, NaN, 1 / 60],
  [20, 0, 1 / 60], [20, -1, 1 / 60], [20, 3.7, Infinity], [20, 3.7, -1]]) motion.step(1, row, rate, dt, false, 6);
assert.deepEqual([0, 1, 2, 3].map(lane => motion.row(lane)), finiteBefore, "Invalid numeric updates preserve the last finite lane state.");
motion.step(99, 22, 3.7, 1 / 60, false, 6);
assert.deepEqual([0, 1, 2, 3].map(lane => motion.row(lane)), finiteBefore, "A missing lane cannot move any bound shelf.");
assert.equal(new PunkArrayMotion(NaN).row(0), 12, "An invalid constructor position falls back to the declared first slot.");

const expectedAppearance = [
  { lane: -1, alpha: 0, tint: 0 },
  { lane: 0, alpha: 1, tint: 0 },
  { lane: 1, alpha: 1, tint: 0.5 },
  { lane: 2, alpha: 1, tint: 0.7 },
  { lane: 3, alpha: 1, tint: 0.8 },
];
for (const expected of expectedAppearance) {
  const actual = arrayLaneAppearance(expected.lane, 0);
  assert.ok(Math.abs(actual.alpha - expected.alpha) < 1e-12 && Math.abs(actual.tint - expected.tint) < 1e-12,
    "Lane appearance preserves the active/right/left-focus contract: " + JSON.stringify({ expected, actual }));
}
assert.equal(arrayLaneAppearance(4, 0).alpha, 0, "The former column on the right is fully hidden.");
assert.equal(arrayLaneAppearance(1, 1).alpha, 1, "Changing focus carries the tint/fade window with the selected column.");

assert.ok(Math.abs(ARRAY_SELECTED_EXTRA_LIFT + ARRAY_SELECTED_BELL_LIFT - 2.098) < 1e-12, "Selection uses the original persistent lift.");
assert.equal(ARRAY_HOVER_LIFT, .5);
const cells = [0, 1].flatMap(lane => Array.from({ length: 20 }, (_, slot) => ({ key: lane + ":" + slot, lane, row: 12 + slot })));
const waves = ["off", "basic", "reduced", "full"].map(level => {
  const caseMotion = new MusicArrayCaseMotion();
  const update = (hover = false, reduced = false, lane = 0, row = 20) => caseMotion.step(cells, lane + ":" + (row - 12), lane, row, level, hover, 1 / 60, reduced);
  update();
  const resting = cells.filter(cell => cell.lane === 0).map(cell => ({ row: cell.row, height: caseMotion.sample(cell.lane, cell.row) }));
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT, "Off and reduced quality preserve selected shape.");
  assert.equal(caseMotion.sample(1, 20), 0, "Another lane receives no wave.");
  for (let frame = 0; frame < 300; frame++) update();
  assert.deepEqual(cells.filter(cell => cell.lane === 0).map(cell => ({ row: cell.row, height: caseMotion.sample(0, cell.row) })), resting,
    "Selection shape persists beyond the old pulse lifetime.");
  update(true, true);
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT + ARRAY_HOVER_LIFT);
  update(false, true);
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT);
  update(false, true, 1, 18);
  assert.equal(caseMotion.sample(0, 20), 0, "Reduced lane change clears former shape immediately.");
  assert.equal(caseMotion.sample(1, 18), ARRAY_SELECTED_BELL_LIFT);
  const neighbor = resting.find(value => value.row === 21).height;
  if (level === "off") assert.equal(neighbor, 0);
  else assert.ok(neighbor > 0 && resting.find(value => value.row === 22).height > 0);
  return { level, neighbor, resting };
});
const strengths = waves.map(value => value.neighbor);
assert.ok(strengths[0] === 0 && strengths[1] > 0 && strengths[1] < strengths[2] && strengths[2] < strengths[3]);
assert.ok(Math.abs(strengths[3] - arrayNeighborLift(1)) < 1e-12);
await mkdir(output, { recursive: true });
const report = { ok: true, scope: "Pure common ARRAY lane anchor, selection window, stable-key memory, lane appearance, persistent selection/neighbor shape and reduced-motion contracts; real transforms are audited separately.",
  initial, interrupted, rowsBeforeReorder, remembered, finalRows: [0, 1, 2, 3].map(lane => motion.row(lane)), expectedAppearance, strengths, waves };
await writeFile(path.join(output, "pure-motion-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, checks: ["shared first-card anchor", "first-five-card no-scroll", "visible-slot clamping", "active-only damping", "immediate old-lane freeze", "stable-key reorder and return memory", "lane appearance", "persistent selection shape", "selected hover", "reduced snap", "ordered wave strength"], report: ".tools/array-composition/pure-motion-audit.json" }, null, 2));
