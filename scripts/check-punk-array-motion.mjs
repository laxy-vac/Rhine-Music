// Focused pure contracts; the companion --array-composition audit checks real Scene matrices.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(project, ".tools", "array-hover");
const bundled = await build({
  stdin: { contents: 'export * from "./src/music-array-motion.ts";',
    resolveDir: project, sourcefile: "punk-array-motion-check.ts" },
  bundle: true, write: false, platform: "node", format: "esm", logLevel: "silent",
});
const { MusicArrayMotion: PunkArrayMotion, MusicArrayCaseMotion, ARRAY_SELECTED_EXTRA_LIFT, ARRAY_SELECTED_BELL_LIFT,
  ARRAY_HOVER_LIFT, arrayHoverLift, arrayNeighborLift, arrayLaneAppearance } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
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

assert.ok(Math.abs(ARRAY_SELECTED_EXTRA_LIFT + ARRAY_SELECTED_BELL_LIFT - 2.098) < 1e-12,
  "The original global selected lift stays unchanged.");
assert.ok(Math.abs(ARRAY_SELECTED_BELL_LIFT - .748) < 1e-12, "The local selected-case bump stays fixed at 0.748.");
assert.equal(arrayNeighborLift(0, "off"), ARRAY_SELECTED_BELL_LIFT, "The selected center remains full height at every quality level.");
assert.equal(ARRAY_HOVER_LIFT, .5);
for (const distance of [0, 1, 2, 3, 4]) {
  const expected = ARRAY_HOVER_LIFT * Math.exp(-distance * distance / 2.2);
  assert.ok(Math.abs(arrayHoverLift(distance) - expected) < 1e-12 &&
    Math.abs(arrayHoverLift(-distance) - expected) < 1e-12,
  "The hover profile is a symmetric Gaussian with a fixed .5 center.");
}
assert.equal(arrayHoverLift(Infinity), 0, "Invalid hover distances contribute no lift.");
const cells = [0, 1].flatMap(lane => Array.from({ length: 20 }, (_, slot) => ({ key: lane + ":" + slot, lane, row: 12 + slot })));
const dt = 1 / 60;
const levels = [
  { level: "off", radius: 0 }, { level: "basic", radius: 1 },
  { level: "reduced", radius: 2 }, { level: "full", radius: 4 },
];
const laneProfile = (caseMotion, lane = 0) => cells.filter(cell => cell.lane === lane)
  .map(cell => ({ row: cell.row, height: caseMotion.sample(cell.lane, cell.row) }));
const settledMotion = (motion, motionCells, key, lane, row, level, hoveredKey = undefined, frames = 240, reduced = false) => {
  for (let frame = 0; frame < frames; frame++) motion.step(motionCells, key, lane, row, level, hoveredKey, dt, reduced);
  return motion;
};
const staticProfiles = [];
for (const { level, radius } of levels) {
  const caseMotion = settledMotion(new MusicArrayCaseMotion(), cells, "0:8", 0, 20, level);
  const profile = laneProfile(caseMotion), at = row => profile.find(value => value.row === row).height;
  const activeNeighbors = profile.filter(value => value.row !== 20 && value.height > 1e-10);
  assert.equal(at(20), ARRAY_SELECTED_BELL_LIFT, level + " preserves the fixed selected-case height.");
  assert.equal(activeNeighbors.length, radius * 2, level + " raises exactly the configured number of neighbors in a full column.");
  for (let distance = 0; distance <= 5; distance++) {
    const expected = arrayNeighborLift(distance, level);
    assert.ok(Math.abs(at(20 - distance) - expected) < 1e-12 && Math.abs(at(20 + distance) - expected) < 1e-12,
      level + " has a symmetric single bump at distance " + distance + ".");
    if (distance > 0 && distance <= radius)
      assert.ok(expected > 0 && expected < at(20 - distance + 1), level + " bump falls with distance at " + distance + ".");
    if (distance > radius) assert.equal(expected, 0, level + " has no shoulder beyond its configured radius.");
  }
  assert.deepEqual(laneProfile(caseMotion, 1).map(value => value.height), Array(20).fill(0),
    level + " cannot lift any cell in a different column.");
  const resting = laneProfile(caseMotion);
  for (let frame = 0; frame < 240; frame++) caseMotion.step(cells, "0:8", 0, 20, level, undefined, dt, false);
  assert.deepEqual(laneProfile(caseMotion), resting, level + " holds one static profile without late rebound or oscillation.");
  staticProfiles.push({ level, radius, activeNeighbors: activeNeighbors.map(value => value.row), profile });

  const hover = settledMotion(new MusicArrayCaseMotion(), cells, "0:8", 0, 20, level);
  const baseline = laneProfile(hover);
  for (let frame = 0; frame < 240; frame++) hover.step(cells, "0:8", 0, 20, level, "0:8", dt, false);
  assert.ok(Math.abs(hover.sample(0, 20) - (ARRAY_SELECTED_BELL_LIFT + ARRAY_HOVER_LIFT)) < 1e-10,
    level + " hover adds 0.5 at the selected entry while retaining its selection bump.");
  assert.ok(laneProfile(hover).every((value, index) =>
    Math.abs(value.height - baseline[index].height - arrayHoverLift(value.row - 20)) < 1e-10),
  level + " selected hover overlays its independent Gaussian profile on the selection bump.");
  assert.deepEqual(laneProfile(hover, 1).map(value => value.height), Array(20).fill(0),
    level + " hover cannot lift a different lane.");
  for (let frame = 0; frame < 240; frame++) hover.step(cells, "0:8", 0, 20, level, undefined, dt, false);
  assert.ok(laneProfile(hover).every((value, index) => Math.abs(value.height - baseline[index].height) < 1e-10),
    level + " smoothly restores the static selection bump after pointer leave.");

  const otherHoverKey = "0:5", otherHoverRow = 17;
  const otherHover = settledMotion(new MusicArrayCaseMotion(), cells, "0:8", 0, 20, level, otherHoverKey);
  const otherHoverProfile = laneProfile(otherHover);
  assert.ok(Math.abs(otherHover.sample(0, otherHoverRow) -
    (arrayNeighborLift(otherHoverRow - 20, level) + arrayHoverLift(0))) < 1e-10,
  level + " independently raises a hovered non-selected entry.");
  assert.ok(otherHoverProfile.every(value =>
    Math.abs(value.height - arrayNeighborLift(value.row - 20, level) - arrayHoverLift(value.row - otherHoverRow)) < 1e-10),
  level + " overlays the selected bell and hover Gaussian at every occupied row.");
  assert.deepEqual(laneProfile(otherHover, 1).map(value => value.height), Array(20).fill(0),
    level + " cannot carry the hover profile into another lane.");
}

const movingHover = settledMotion(new MusicArrayCaseMotion(), cells, "0:8", 0, 20, "full");
const movingBaseline = laneProfile(movingHover);
movingHover.step(cells, "0:8", 0, 20, "full", "0:5", dt, false);
const firstHover = laneProfile(movingHover);
assert.ok(firstHover.find(value => value.row === 17).height > movingBaseline.find(value => value.row === 17).height,
  "A newly hovered non-selected entry starts rising immediately.");
for (let frame = 0; frame < 240; frame++) movingHover.step(cells, "0:8", 0, 20, "full", "0:5", dt, false);
const firstHoverSettled = laneProfile(movingHover);
movingHover.step(cells, "0:8", 0, 20, "full", "0:6", dt, false);
const movedHover = laneProfile(movingHover);
assert.ok(movedHover.find(value => value.row === 17).height > movingBaseline.find(value => value.row === 17).height &&
  movedHover.find(value => value.row === 18).height > firstHoverSettled.find(value => value.row === 18).height,
"Moving hover smoothly transfers the profile from the previous entry to the new entry.");
for (let frame = 0; frame < 240; frame++) movingHover.step(cells, "0:8", 0, 20, "full", "0:6", dt, false);
const secondHoverSettled = laneProfile(movingHover);
assert.ok(secondHoverSettled.every(value =>
  Math.abs(value.height - arrayNeighborLift(value.row - 20, "full") - arrayHoverLift(value.row - 18)) < 1e-10),
"The moved hover settles at the new entry without changing the selected bump.");
movingHover.step(cells, "0:8", 0, 20, "full", undefined, dt, false);
const leavingHover = laneProfile(movingHover);
assert.ok(leavingHover.find(value => value.row === 18).height > movingBaseline.find(value => value.row === 18).height,
  "Pointer leave starts a smooth hover-profile return instead of snapping down.");
for (let frame = 0; frame < 240; frame++) movingHover.step(cells, "0:8", 0, 20, "full", undefined, dt, false);
assert.ok(laneProfile(movingHover).every((value, index) => Math.abs(value.height - movingBaseline[index].height) < 1e-10),
  "Pointer leave restores the original selected profile after settling.");

const edgeProfiles = [];
for (const { level, radius } of levels) for (const count of [1, 5, 20]) {
  const slots = [...new Set([0, Math.floor((count - 1) / 2), count - 1])];
  for (const selectedSlot of slots) {
    const edgeCells = [
      ...Array.from({ length: count }, (_, slot) => ({ key: "edge:" + slot, lane: 0, row: 12 + slot })),
      ...Array.from({ length: 20 }, (_, slot) => ({ key: "other:" + slot, lane: 1, row: 12 + slot })),
    ];
    const selectedRow = 12 + selectedSlot, selectedKey = "edge:" + selectedSlot;
    const edge = settledMotion(new MusicArrayCaseMotion(), edgeCells, selectedKey, 0, selectedRow, level, undefined, 240, true);
    const actual = edgeCells.filter(cell => cell.lane === 0).map(cell => ({ row: cell.row, height: edge.sample(0, cell.row) }));
    const actualNeighbors = actual.filter(value => value.row !== selectedRow && value.height > 1e-10);
    const expectedCount = Math.min(radius, selectedSlot) + Math.min(radius, count - selectedSlot - 1);
    assert.equal(actualNeighbors.length, expectedCount,
      level + " respects physical occupied-row boundaries for " + count + " slots at row " + selectedRow + ".");
    for (const cell of edgeCells) {
      const value = edge.sample(cell.lane, cell.row);
      assert.ok(Number.isFinite(value), "Every single/final-five/full-column sample remains finite.");
      assert.ok(Number.isFinite(edge.sample(cell.lane, cell.row + .5)), "Fractional samples interpolate finitely at rack ends.");
      if (cell.lane === 0) {
        const expected = cell.row === selectedRow ? ARRAY_SELECTED_BELL_LIFT : arrayNeighborLift(cell.row - selectedRow, level);
        assert.ok(Math.abs(value - expected) < 1e-12, "Boundary profile matches only physically occupied slots.");
      } else assert.equal(value, 0, "Edge fixtures cannot affect another column.");
    }
    edgeProfiles.push({ level, count, selectedRow, expectedCount, actualNeighbors: actualNeighbors.map(value => value.row) });
  }
}

const reducedMotionProfiles = [];
for (const { level } of levels) {
  const reducedMotion = new MusicArrayCaseMotion();
  reducedMotion.step(cells, "0:8", 0, 20, level, undefined, dt, true);
  reducedMotion.step(cells, "0:9", 0, 21, level, undefined, dt, true);
  const settled = laneProfile(reducedMotion);
  for (let frame = 0; frame < 120; frame++) reducedMotion.step(cells, "0:9", 0, 21, level, undefined, dt, true);
  assert.deepEqual(laneProfile(reducedMotion), settled, level + " reduced motion snaps to one static profile with no animation.");
  assert.equal(reducedMotion.sample(0, 21), ARRAY_SELECTED_BELL_LIFT);
  assert.equal(reducedMotion.sample(1, 21), 0);
  reducedMotionProfiles.push({ level, selected: 21, profile: settled });
}

const continuity = new MusicArrayCaseMotion();
continuity.step(cells, "0:7", 0, 19, "full", undefined, dt, false);
for (let frame = 0; frame < 20; frame++) continuity.step(cells, "0:7", 0, 19, "full", undefined, dt, false);
const beforeSelection = continuity.sample(0, 20);
assert.ok(beforeSelection > 0 && beforeSelection < ARRAY_SELECTED_BELL_LIFT);
continuity.step(cells, "0:8", 0, 20, "full", undefined, 0, false);
const afterZeroDtSelection = continuity.sample(0, 20);
assert.equal(afterZeroDtSelection, beforeSelection,
  "A neighbor already rising into selection inherits its spring height without a dt=0 jump.");
for (let frame = 0; frame < 120; frame++) continuity.step(cells, "0:8", 0, 20, "full", undefined, dt, false);
assert.ok(Math.abs(continuity.sample(0, 20) - ARRAY_SELECTED_BELL_LIFT) < 1e-9,
  "The selected-case spring then settles to the fixed selected target.");

const rapid = new MusicArrayCaseMotion(), navigation = [];
let rapidRow = 21;
rapid.step(cells, "0:9", 0, rapidRow, "full", undefined, dt, false);
for (const direction of [1, 1, 1, -1, -1, -1]) {
  rapidRow += direction; navigation.push({ direction, row: rapidRow });
  rapid.step(cells, "0:" + (rapidRow - 12), 0, rapidRow, "full", undefined, dt, false);
  assert.ok(Math.max(...laneProfile(rapid).map(value => value.height)) <= ARRAY_SELECTED_BELL_LIFT + 1e-12,
    "Rapid reversals cannot accumulate into a second wave or exceed the fixed bump peak.");
}
assert.equal(rapidRow, 21, "The forward/reverse navigation sequence returns to its starting selected row.");
const stoppedTarget = Array.from({ length: 20 }, (_, slot) => ({ row: 12 + slot,
  height: slot + 12 === rapidRow ? ARRAY_SELECTED_BELL_LIFT : arrayNeighborLift(slot + 12 - rapidRow, "full") }));
const stoppedSeries = [];
for (let frame = 1; frame <= 300; frame++) {
  rapid.step(cells, "0:9", 0, rapidRow, "full", undefined, dt, false);
  if (frame % 30 === 0) stoppedSeries.push({ frame, time: frame * dt, profile: laneProfile(rapid) });
}
const stopProfile = laneProfile(rapid);
assert.ok(stopProfile.every((value, index) => Math.abs(value.height - stoppedTarget[index].height) < 1e-9),
  "After several seconds the final selection has exactly one static bump and no delayed return motion.");
for (let frame = 0; frame < 120; frame++) rapid.step(cells, "0:9", 0, rapidRow, "full", undefined, dt, false);
assert.ok(laneProfile(rapid).every((value, index) => Math.abs(value.height - stopProfile[index].height) < 1e-12),
  "The stopped profile remains unchanged instead of pulsing periodically.");

await mkdir(output, { recursive: true });
const report = { ok: true,
  scope: "Pure ARRAY lane anchor, stable-key memory, fixed selected bell, level-controlled selection bump, independent Gaussian hover profile, smooth hover move/leave, reduced-motion, occupied-boundary profiles, and rapid spring continuity; MATRIX global wave behavior is guarded by the Scene compatibility check.",
  initial, interrupted, rowsBeforeReorder, remembered, finalRows: [0, 1, 2, 3].map(lane => motion.row(lane)), expectedAppearance,
  staticProfiles, edgeProfiles, reducedMotionProfiles, selectionContinuity: { beforeSelection, afterZeroDtSelection, afterSettle: continuity.sample(0, 20) },
  rapidNavigation: navigation, stoppedSeries, stopProfile };
await writeFile(path.join(output, "pure-motion-audit.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: true, checks: ["shared first-card anchor", "first-five-card no-scroll", "visible-slot clamping", "active-only damping",
  "immediate old-lane freeze", "stable-key reorder and return memory", "lane appearance", "fixed selected bell and unchanged global lift",
  "exact OFF/basic/reduced/full neighbor counts", "symmetric cosine bump taper", "actual occupied-row boundary clipping", "independent Gaussian hover profile on selection and another entry",
  "hover overlay preserves the selected profile at every quality level", "smooth hover movement and pointer-leave recovery",
  "reduced-motion snap", "one-step dt=0 selection continuity", "rapid forward/reverse input without added energy", "seconds-later static profile without rebound"],
  report: ".tools/array-hover/pure-motion-audit.json" }, null, 2));
