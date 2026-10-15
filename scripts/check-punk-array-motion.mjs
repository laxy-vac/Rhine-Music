// Focused pure contracts; the companion --array-composition audit checks real Scene matrices.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools", "array-echo");
const bundled = await build({
  stdin: { contents: 'export * from "./src/music-array-motion.ts";',
    resolveDir: project, sourcefile: "punk-array-motion-check.ts" },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { MusicArrayMotion: PunkArrayMotion, MusicArrayCaseMotion, ARRAY_SELECTED_EXTRA_LIFT, ARRAY_SELECTED_BELL_LIFT,
  ARRAY_HOVER_LIFT, arrayNeighborLift, arrayLaneAppearance, arrayRackWave } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
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

assert.ok(Math.abs(ARRAY_SELECTED_EXTRA_LIFT + ARRAY_SELECTED_BELL_LIFT - 2.098) < 1e-12, "Selection keeps the original persistent bell and extra lift.");
assert.equal(ARRAY_SELECTED_BELL_LIFT, arrayNeighborLift(0));
assert.equal(ARRAY_HOVER_LIFT, .5);
const cells = [0, 1].flatMap(lane => Array.from({ length: 20 }, (_, slot) => ({ key: lane + ":" + slot, lane, row: 12 + slot })));
const dt = 1 / 60;
const snapshot = (caseMotion, lane = 0) => cells.filter(cell => cell.lane === lane)
  .map(cell => ({ row: cell.row, height: caseMotion.sample(cell.lane, cell.row) }));
const staticShapes = ["off", "basic", "reduced", "full"].map(level => {
  const caseMotion = new MusicArrayCaseMotion();
  const update = (hover = false, reduced = false, lane = 0, row = 20) =>
    caseMotion.step(cells, lane + ":" + (row - 12), lane, row, level, hover, dt, reduced, false);
  update();
  const resting = snapshot(caseMotion);
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT, "The selected case keeps its persistent static bell.");
  assert.equal(caseMotion.sample(1, 20), 0, "Another column receives no selection shape or wave.");
  for (let frame = 0; frame < 300; frame++) update();
  assert.deepEqual(snapshot(caseMotion), resting, "Persistent selected/neighbor shape settles and remains stable without interaction.");
  update(true, true);
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT + ARRAY_HOVER_LIFT,
    level + " hover adds exactly 0.5 to the selected static bell.");
  update(false, true);
  assert.equal(caseMotion.sample(0, 20), ARRAY_SELECTED_BELL_LIFT, "Pointer leave removes the hover lift.");
  update(false, true, 1, 18);
  assert.equal(caseMotion.sample(0, 20), 0, "Changing lanes clears the former column immediately.");
  assert.equal(caseMotion.sample(1, 18), ARRAY_SELECTED_BELL_LIFT);
  const neighbor = resting.find(value => value.row === 21).height;
  return { level, neighbor, resting };
});
const staticNeighborStrengths = staticShapes.map(value => value.neighbor);
assert.ok(staticNeighborStrengths[0] === 0 && staticNeighborStrengths[1] > 0 &&
  staticNeighborStrengths[1] < staticNeighborStrengths[2] && staticNeighborStrengths[2] < staticNeighborStrengths[3],
"Static quality-dependent neighbor shoulders retain their established 0/.35/.65/1 quality ordering.");
assert.ok(Math.abs(staticNeighborStrengths[3] - arrayNeighborLift(1)) < 1e-12);

function dynamicPeak(level, useNotification = true) {
  const baseline = new MusicArrayCaseMotion(), active = new MusicArrayCaseMotion();
  baseline.step(cells, "0:8", 0, 20, level, false, dt, false, false);
  active.step(cells, "0:8", 0, 20, level, false, dt, false, false);
  let peak = 0, frameOfPeak = 0;
  for (let frame = 1; frame <= 90; frame++) {
    if (frame === 1 && useNotification) active.selectionChanged("0:9", 0, 21);
    baseline.step(cells, "0:9", 0, 21, level, false, dt, false, false);
    // Omitting selectionChanged exercises the optional-argument legacy fallback.
    active.step(cells, "0:9", 0, 21, level, false, dt, false);
    const delta = Math.max(0, ...cells.filter(cell => cell.lane === 0)
      .map(cell => Math.abs(active.sample(0, cell.row) - baseline.sample(0, cell.row))));
    if (delta > peak) { peak = delta; frameOfPeak = frame; }
  }
  return { level, peak, frameOfPeak };
}
const dynamicPeaks = ["off", "basic", "reduced", "full"].map(level => dynamicPeak(level, level !== "full"));
assert.equal(dynamicPeaks[0].peak, 0, "OFF produces no dynamic neighbor displacement.");
assert.ok(dynamicPeaks[1].peak > 0 && dynamicPeaks[1].peak < dynamicPeaks[2].peak && dynamicPeaks[2].peak < dynamicPeaks[3].peak,
  "Selection-triggered dynamic peak grows distinctly from basic through reduced to full.");
const notifiedFullPeak = dynamicPeak("full", true);
assert.ok(notifiedFullPeak.peak > 0 && notifiedFullPeak.frameOfPeak > 1,
  "An explicit selectionChanged notification drives a delayed full-quality packet.");

const nearArrival = arrayRackWave("full", 7, 5, 0, 20, .23);
const beforeFarArrival = arrayRackWave("full", 11, 5, 0, 20, .45);
const afterFarArrival = arrayRackWave("full", 11, 5, 0, 20, .57);
assert.ok(nearArrival > 0 && beforeFarArrival === 0 && afterFarArrival > 0,
  "The full wave reaches farther occupied rows later instead of applying a constant rack-wide wobble.");
const reflectedDelta = age => arrayRackWave("full", 2, 1, 0, 10, age) - arrayRackWave("full", 2, 1, -100, 100, age);
assert.equal(reflectedDelta(.2), 0, "A boundary reflection cannot arrive before its round-trip path.");
assert.ok(reflectedDelta(.32) > 0 && reflectedDelta(.5) < 0,
  "The reflected packet has its own traveling phase after reaching the physical rack end.");
const returnBefore = arrayRackWave("full", 21, 21, 12, 31, 1.2);
const returnAfter = arrayRackWave("full", 21, 21, 12, 31, 1.6);
const unboundedAtReturn = arrayRackWave("full", 21, 21, -100, 100, 1.6);
assert.equal(returnBefore, 0, "The direct packet at its source has dissipated by the return test window.");
assert.ok(returnAfter > 0 && unboundedAtReturn === 0,
  "A physical-end return remains visible after the direct source packet has dissipated.");
const waveTiming = { nearArrival, beforeFarArrival, afterFarArrival,
  reflectedDelta: [.2, .32, .5, 1.2, 1.6].map(age => ({ age, value: age >= 1.2
    ? arrayRackWave("full", 21, 21, 12, 31, age) - arrayRackWave("full", 21, 21, -100, 100, age)
    : reflectedDelta(age) })), returnBefore, returnAfter };

const sequenceBase = new MusicArrayCaseMotion(), sequenceActive = new MusicArrayCaseMotion();
sequenceBase.step(cells, "0:8", 0, 20, "full", false, dt, false, false);
sequenceActive.step(cells, "0:8", 0, 20, "full", false, dt, false, false);
let selectedKey = "0:8", selectedRow = 20;
const rapidPeakByFrame = [];
for (let frame = 1; frame <= 300; frame++) {
  if (frame <= 4) {
    selectedKey = "0:" + (8 + frame); selectedRow = 20 + frame;
    sequenceActive.selectionChanged(selectedKey, 0, selectedRow);
  }
  sequenceBase.step(cells, selectedKey, 0, selectedRow, "full", false, dt, false, false);
  sequenceActive.step(cells, selectedKey, 0, selectedRow, "full", false, dt, false, true);
  const displacement = Math.max(0, ...cells.filter(cell => cell.lane === 0)
    .map(cell => Math.abs(sequenceActive.sample(0, cell.row) - sequenceBase.sample(0, cell.row))));
  rapidPeakByFrame.push({ frame, time: frame * dt, displacement });
}
const rapidPeak = Math.max(...rapidPeakByFrame.map(value => value.displacement));
const rapidTail = Math.max(...rapidPeakByFrame.slice(-24).map(value => value.displacement));
assert.ok(rapidPeak > 0 && rapidPeak <= .75 + 1e-12, "Rapid selections add bounded, overlapping echoes at the rack's documented cap.");
assert.ok(rapidTail < 1e-10 && rapidTail < rapidPeak / 100,
  "The overlapping wave train naturally decays after inputs stop.");

const continuity = new MusicArrayCaseMotion();
continuity.step(cells, "0:7", 0, 19, "full", false, dt, false, false);
continuity.selectionChanged("0:8", 0, 20);
for (let frame = 0; frame < 20; frame++) continuity.step(cells, "0:8", 0, 20, "full", false, dt, false, true);
const caughtBefore = continuity.sample(0, 22);
assert.ok(caughtBefore > arrayNeighborLift(2), "The continuity fixture must catch a positive crest on the next selected case.");
continuity.selectionChanged("0:10", 0, 22);
continuity.step(cells, "0:10", 0, 22, "full", false, 0, false, true);
const caughtAfter = continuity.sample(0, 22);
assert.ok(Math.abs(caughtAfter - caughtBefore) < 1e-10,
  "Selecting a case caught by the previous crest carries its visible lift into the selection spring without a one-frame drop.");

const edgeReports = [];
for (const count of [1, 5, 20]) {
  const edgeCells = [
    ...Array.from({ length: count }, (_, slot) => ({ key: "edge:" + slot, lane: 0, row: 12 + slot })),
    ...Array.from({ length: 20 }, (_, slot) => ({ key: "other:" + slot, lane: 1, row: 12 + slot })),
  ];
  const edge = new MusicArrayCaseMotion();
  const initialSlot = count - 1, initialKey = "edge:" + initialSlot, initialRow = 12 + initialSlot;
  edge.step(edgeCells, initialKey, 0, initialRow, "full", false, dt, false, false);
  if (count > 1) {
    const nextKey = "edge:0";
    edge.selectionChanged(nextKey, 0, 12);
    edge.step(edgeCells, nextKey, 0, 12, "full", false, dt, false, true);
  } else {
    edge.selectionChanged(initialKey, 0, initialRow);
    edge.step(edgeCells, initialKey, 0, initialRow, "full", false, dt, false, true);
  }
  const samples = [
    ...edgeCells.flatMap(cell => [edge.sample(cell.lane, cell.row), edge.sample(cell.lane, cell.row + .5)]),
    ...[-1, 11, 32].map(row => edge.sample(0, row)),
    arrayRackWave("full", 11, 12, 12, 12, .5), arrayRackWave("full", 13, 12, 12, 20, .5),
    arrayRackWave("full", NaN, 12, 12, 20, .5),
  ];
  assert.ok(samples.every(Number.isFinite), "A " + count + "-slot active rack keeps every boundary/interpolated sample finite.");
  assert.equal(edge.sample(1, 18), 0, "A selected lane's wave never enters the neighboring column.");
  edgeReports.push({ count, initialRow, samplesFinite: true, otherLane: edge.sample(1, 18) });
}

const reducedMotion = new MusicArrayCaseMotion();
reducedMotion.step(cells, "0:8", 0, 20, "full", false, dt, true, false);
reducedMotion.selectionChanged("0:9", 0, 21);
reducedMotion.step(cells, "0:9", 0, 21, "full", false, dt, true, true);
const reducedMotionRest = snapshot(reducedMotion);
for (let frame = 0; frame < 120; frame++) reducedMotion.step(cells, "0:9", 0, 21, "full", false, dt, true, true);
assert.deepEqual(snapshot(reducedMotion), reducedMotionRest, "Reduced motion snaps to static targets and suppresses all wave animation.");
assert.equal(reducedMotion.sample(0, 21), ARRAY_SELECTED_BELL_LIFT);
assert.equal(reducedMotion.sample(1, 21), 0);

const clearedMotion = new MusicArrayCaseMotion();
clearedMotion.step(cells, "0:8", 0, 20, "full", false, dt, false, false);
clearedMotion.selectionChanged("0:9", 0, 21);
clearedMotion.step(cells, "0:9", 0, 21, "full", false, dt, false, true);
clearedMotion.step(cells, "0:9", 0, 21, "full", false, dt, true, false);
assert.equal(clearedMotion.sample(0, 23), arrayNeighborLift(2),
  "Turning off interaction clears dynamic packets while preserving the static neighbor shape.");

await mkdir(output, { recursive: true });
const report = { ok: true,
  scope: "Pure ARRAY lane anchor, stable-key memory, legacy persistent bell/quality shoulders, selection-triggered bounded packets, physical-end return echoes, hover, and reduced-motion contracts; real transforms are audited separately.",
  initial, interrupted, rowsBeforeReorder, remembered, finalRows: [0, 1, 2, 3].map(lane => motion.row(lane)), expectedAppearance,
  staticNeighborStrengths, staticShapes, dynamicPeaks, notifiedFullPeak, waveTiming, rapidPeak, rapidTail, rapidPeakByFrame,
  selectionContinuity: { caughtBefore, caughtAfter },
  edgeReports, reducedMotionRest, clearedInactiveSample: clearedMotion.sample(0, 23) };
await writeFile(path.join(output, "pure-motion-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, checks: ["shared first-card anchor", "first-five-card no-scroll", "visible-slot clamping", "active-only damping",
  "immediate old-lane freeze", "stable-key reorder and return memory", "lane appearance", "persistent static selection and quality shoulders",
  "four distinct selection-wave peaks", "selectionChanged and legacy fallback", "direct propagation and physical-boundary reflection",
  "bounded overlapping rapid selection train and decay", "wave-to-selection continuity", "first/final/partial/single-slot rack boundaries", "hover plus/minus 0.5", "reduced-motion snap", "interaction and inactive-column guards"],
  report: ".tools/array-echo/pure-motion-audit.json" }, null, 2));
