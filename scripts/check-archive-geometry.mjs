import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { musicArrayCompositionFrame, musicMatrixOverviewSpan } from "../src/music-layout-framing.ts";

const useRound2Snapshot = process.argv.includes("--round-2");
const transitionModule = useRound2Snapshot
  ? await import("../.tools/animation-refinement-2026-10-18/round-2-source/music-layout-transition.ts")
  : await import("../src/music-layout-transition.ts");
const { MusicLayoutTransition, musicGeometryPose } = transitionModule;

const STEP = 1 / 120;
const MAX_PHASE_SECONDS = 10;
const MAX_PHASE_FRAMES = Math.ceil(MAX_PHASE_SECONDS / STEP);
const Q_BOUND = 1e-8;
const VELOCITY_BOUND = .35;

function currentQ(transition) { return useRound2Snapshot ? transition.progress : transition.frame.q; }
function transitionComplete(transition) { return useRound2Snapshot ? transition.progress >= 1 : transition.settled; }
const MATRIX_LANES = 9;
const MATRIX_ROWS = 48;
const MATRIX_WINDOW_ROWS = 16;
const ARRAY_ROWS = 20;
const ARRAY_CAPACITY = MATRIX_LANES * ARRAY_ROWS;
const MATRIX_CAPACITY = MATRIX_LANES * MATRIX_ROWS;
const CASE_SIZE = new THREE.Vector3(4.45, 3.35, .14);
const BASE_Y = -4.6;
const INSPECTION_Z = -2.17;
const CASE_BOUNDS = { min: [-2.225, .175, -.07], max: [2.225, 3.525, .07] };
const CASE_CENTER = { x: 0, y: 1.85, z: 0 };
const ARRAY_OVERVIEW_SPAN = musicArrayCompositionFrame(1920, 1080, 1100, .8, -1, CASE_BOUNDS, CASE_CENTER, false).effectiveSpan;
const MATRIX_OVERVIEW_SPAN = musicMatrixOverviewSpan(ARRAY_OVERVIEW_SPAN);
const SOURCE_SELECTED_LIFT = .9;
const ARRAY_SELECTED_LIFT = 1.35 + .748;
const AABB_EPSILON = 1e-6;
const SAT_EPSILON = 1e-6;

const groupsToRun = [
  { name: "group [7,28,3], selected item 27", groupLengths: [7, 28, 3], selectedOrder: 27 },
  { name: "single long group [65], selected item 27", groupLengths: [65], selectedOrder: 27 },
  { name: "group none [38], ARRAY packed by 20", groupLengths: [38], selectedOrder: 27 },
];

const round = value => Math.round(value * 1e5) / 1e5;
const roundVector = vector => vector.toArray().map(round);
const keyOf = cell => cell.foobarEntryKey;
const signature = cell => `${keyOf(cell)}|${cell.lane}|${cell.row}`;
const mod = (value, count) => ((value % count) + count) % count;

function matrixAt(position, scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Quaternion()) {
  return new THREE.Matrix4().compose(position.clone(), rotation.clone(), scale.clone());
}

function positionOf(matrix) {
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

function basisLengths(matrix) {
  const e = matrix.elements;
  return [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
}

function matrixError(actual, expected) {
  let error = 0;
  for (let index = 0; index < 16; index++) error = Math.max(error, Math.abs(actual.elements[index] - expected.elements[index]));
  return error;
}

function makeCatalog(groupLengths) {
  const groups = groupLengths.map(length => Array.from({ length }));
  const starts = [];
  const catalog = new Map();
  let order = 0;
  for (let lane = 0; lane < groups.length; lane++) {
    starts[lane] = order;
    for (let row = 0; row < groups[lane].length; row++) {
      const key = `record-${order}`;
      groups[lane][row] = key;
      catalog.set(key, { lane, row, order });
      order++;
    }
  }
  return { groups, starts, catalog, count: order };
}

function packCatalog(matrixCatalog) {
  return new Map([...matrixCatalog.catalog.entries()].map(([key, slot]) => [key, {
    lane: Math.floor(slot.order / ARRAY_ROWS), row: slot.order % ARRAY_ROWS, order: slot.order,
  }]));
}

function matrixPoolCells(layout, selectedKey, allowedKeys) {
  const selected = layout.catalog.get(selectedKey);
  const firstRow = Math.max(0, selected.row - Math.floor(MATRIX_WINDOW_ROWS / 2));
  const cells = [];
  for (let lane = 0; lane < MATRIX_LANES; lane++) {
    const group = lane % layout.groups.length;
    for (let row = firstRow; row < firstRow + MATRIX_WINDOW_ROWS; row++) {
      const localRow = mod(row, layout.groups[group].length);
      const key = layout.groups[group][localRow];
      if (allowedKeys && !allowedKeys.has(key)) continue;
      cells.push({ lane, row, foobarEntryKey: key });
    }
  }
  return cells;
}

function arrayCells(arrayCatalog, keys) {
  return [...keys].map(key => {
    const slot = arrayCatalog.get(key);
    return { lane: slot.lane, row: slot.row, foobarEntryKey: key };
  }).sort((a, b) => arrayCatalog.get(a.foobarEntryKey).order - arrayCatalog.get(b.foobarEntryKey).order);
}

function padPool(cells, capacity, offset) {
  const padded = [...cells];
  while (padded.length < capacity) padded.push({ lane: -10000 - offset - padded.length, row: -10000 - padded.length });
  return padded;
}

function catalogDistance(cell, anchor, slot, anchorSlot) {
  const lane = cell.lane - anchor.lane - (slot.lane - anchorSlot.lane);
  const row = cell.row - anchor.row - (slot.row - anchorSlot.row);
  return lane * lane * 400 + row * row;
}

function expectedPairs(sourceCells, targetCells, sourceCatalog, targetCatalog, sourceSelected, targetSelected) {
  const bySource = new Map(), byTarget = new Map();
  for (const cell of sourceCells) {
    const list = bySource.get(keyOf(cell)) ?? [];
    list.push(cell);
    bySource.set(keyOf(cell), list);
  }
  for (const cell of targetCells) {
    const list = byTarget.get(keyOf(cell)) ?? [];
    list.push(cell);
    byTarget.set(keyOf(cell), list);
  }
  const sourceOrigin = sourceCatalog.get(keyOf(sourceSelected));
  const targetOrigin = targetCatalog.get(keyOf(targetSelected));
  const pairs = new Map(), consumedTargets = new Set();
  for (const entry of new Set([...bySource.keys(), ...byTarget.keys()])) {
    const sources = [...(bySource.get(entry) ?? [])];
    const targets = [...(byTarget.get(entry) ?? [])];
    if (useRound2Snapshot) {
      // The archived implementation paired the nearest occurrences even when
      // neither was the exact canonical offset; model that historical contract.
      sources.sort((a, b) => catalogDistance(a, sourceSelected, sourceCatalog.get(entry), sourceOrigin) -
        catalogDistance(b, sourceSelected, sourceCatalog.get(entry), sourceOrigin));
      targets.sort((a, b) => catalogDistance(a, targetSelected, targetCatalog.get(entry), targetOrigin) -
        catalogDistance(b, targetSelected, targetCatalog.get(entry), targetOrigin));
      if (sources.length && targets.length) {
        pairs.set(sources[0].motionId, targets[0]);
        consumedTargets.add(signature(targets[0]));
      }
      continue;
    }
    // A match exists only when both pool occurrences occupy the entry's
    // canonical offset from their selected item. Extra duplicate instances
    // remain retiring/arriving geometry rather than being paired by proximity.
    const canonicalSource = sources.find(cell => catalogDistance(cell, sourceSelected, sourceCatalog.get(entry), sourceOrigin) < .001);
    const canonicalTarget = targets.find(cell => catalogDistance(cell, targetSelected, targetCatalog.get(entry), targetOrigin) < .001);
    if (canonicalSource && canonicalTarget) {
      pairs.set(canonicalSource.motionId, canonicalTarget);
      consumedTargets.add(signature(canonicalTarget));
    }
  }
  return { pairs, consumedTargets };
}

function layoutPosition(cell, selected, anchor, heading, rowSpacing, columnSpacing = 5.2) {
  const offset = new THREE.Vector3((cell.lane - selected.lane) * columnSpacing, 0, (cell.row - selected.row) * rowSpacing);
  offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  return anchor.clone().add(offset);
}

function makeCamera(yaw, aim) {
  const camera = new THREE.PerspectiveCamera(78, 16 / 10, .1, 300);
  const elevation = .14;
  camera.position.copy(aim).add(new THREE.Vector3(
    Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation),
  ).multiplyScalar(60));
  camera.lookAt(aim);
  return camera;
}

function targetMatrixFor(cell, selected, targetSelected, targetAnchor, targetMode, targetRowSpacing) {
  const heading = targetMode === "matrix" ? Math.PI : 0;
  const position = layoutPosition(cell, targetSelected, targetAnchor, heading, targetRowSpacing);
  if (selected) position.y = targetAnchor.y;
  else position.y = BASE_Y;
  return matrixAt(position);
}

function makeObb(matrix, entry) {
  const e = matrix.elements;
  const columns = [
    new THREE.Vector3(e[0], e[1], e[2]),
    new THREE.Vector3(e[4], e[5], e[6]),
    new THREE.Vector3(e[8], e[9], e[10]),
  ];
  const scales = columns.map(column => column.length());
  if (scales.some(scale => scale <= 1e-7)) return undefined;
  const axes = columns.map((column, index) => column.clone().divideScalar(scales[index]));
  const half = [CASE_SIZE.x * scales[0] / 2, CASE_SIZE.y * scales[1] / 2, CASE_SIZE.z * scales[2] / 2];
  const local = new THREE.Box3(CASE_SIZE.clone().multiplyScalar(-.5), CASE_SIZE.clone().multiplyScalar(.5));
  const aabb = local.clone().applyMatrix4(matrix);
  return { id: entry.motionId, key: entry.foobarEntryKey, cell: { lane: entry.lane, row: entry.row }, matrix: matrix.clone(),
    axes, half, center: positionOf(matrix), aabb, dimensions: scales.map((scale, index) => scale * CASE_SIZE.getComponent(index)) };
}

function sat(a, b) {
  const delta = b.center.clone().sub(a.center);
  const axes = [...a.axes, ...b.axes];
  for (const axisA of a.axes) for (const axisB of b.axes) axes.push(new THREE.Vector3().crossVectors(axisA, axisB));
  let penetration = Infinity;
  let smallestGap = Infinity;
  for (const rawAxis of axes) {
    const length = rawAxis.length();
    if (length <= 1e-8) continue;
    const axis = rawAxis.clone().divideScalar(length);
    let radiusA = 0, radiusB = 0;
    for (let index = 0; index < 3; index++) {
      radiusA += a.half[index] * Math.abs(axis.dot(a.axes[index]));
      radiusB += b.half[index] * Math.abs(axis.dot(b.axes[index]));
    }
    const gap = Math.abs(delta.dot(axis)) - radiusA - radiusB;
    if (gap > SAT_EPSILON) smallestGap = Math.min(smallestGap, gap);
    else penetration = Math.min(penetration, -gap);
  }
  if (smallestGap < Infinity) return { overlap: false, gap: smallestGap };
  return { overlap: true, penetration: Math.max(0, penetration) };
}

function broadphaseAndSat(boxes) {
  const sorted = [...boxes].sort((a, b) => a.aabb.min.x - b.aabb.min.x);
  const overlaps = [], nearMisses = [];
  let aabbCandidates = 0, satChecks = 0;
  for (let left = 0; left < sorted.length; left++) {
    const a = sorted[left];
    for (let right = left + 1; right < sorted.length; right++) {
      const b = sorted[right];
      if (b.aabb.min.x > a.aabb.max.x + AABB_EPSILON) break;
      if (b.aabb.min.y > a.aabb.max.y + AABB_EPSILON || b.aabb.max.y < a.aabb.min.y - AABB_EPSILON ||
          b.aabb.min.z > a.aabb.max.z + AABB_EPSILON || b.aabb.max.z < a.aabb.min.z - AABB_EPSILON) continue;
      aabbCandidates++;
      satChecks++;
      const result = sat(a, b);
      if (result.overlap) overlaps.push({ a, b, penetration: result.penetration });
      else nearMisses.push({ a, b, gap: result.gap });
    }
  }
  return { overlaps, nearMisses, aabbCandidates, satChecks };
}

function boxReport(box) {
  return { entryKey: box.key, motionId: box.id, cell: box.cell,
    center: roundVector(box.center), dimensions: box.dimensions.map(round),
    aabb: { min: roundVector(box.aabb.min), max: roundVector(box.aabb.max) },
    matrix: box.matrix.elements.map(round) };
}

function makeScenario(spec) {
  const matrixLayout = makeCatalog(spec.groupLengths);
  const arrayCatalog = packCatalog(matrixLayout);
  const selectedKey = `record-${spec.selectedOrder}`;
  const selectedMatrixSlot = matrixLayout.catalog.get(selectedKey);
  const rowStart = Math.max(0, selectedMatrixSlot.row - Math.floor(MATRIX_WINDOW_ROWS / 2));
  const matrixCells = [];
  for (let lane = 0; lane < MATRIX_LANES; lane++) {
    const group = lane % matrixLayout.groups.length;
    for (let row = rowStart; row < rowStart + MATRIX_WINDOW_ROWS; row++) {
      const local = mod(row, matrixLayout.groups[group].length);
      const key = matrixLayout.groups[group][local];
      matrixCells.push({ lane, row, foobarEntryKey: key,
        motionId: `source:matrix:${lane}:${row}:${key}` });
    }
  }
  const windowKeys = new Set(matrixCells.map(keyOf));
  const allArrayWindowCells = [...windowKeys].map(key => {
    const slot = arrayCatalog.get(key);
    return { lane: slot.lane, row: slot.row, foobarEntryKey: key };
  }).sort((a, b) => arrayCatalog.get(keyOf(a)).order - arrayCatalog.get(keyOf(b)).order);
  const matrixSourceSelected = matrixLayout.catalog.get(selectedKey);
  const arraySourceSelected = arrayCatalog.get(selectedKey);
  return { ...spec, matrixLayout, matrixCatalog: matrixLayout.catalog, arrayCatalog, selectedKey, rowStart,
    matrixCells, windowKeys, arrayCells: allArrayWindowCells, matrixSourceSelected, arraySourceSelected };
}

function runRetargetContracts({ transition, plan, toShelf, sourceMode, scenario }) {
  const ids = plan.map(cell => cell.motionId ?? null);
  const result = { events: [], errors: [], samples: 0, minimumQ: Infinity, maximumQ: -Infinity,
    maximumAbsVelocity: 0, settledChecks: 0, samePlanMotionIds: true };
  const observe = label => {
    const { q, qVelocity } = transition.frame;
    result.samples++;
    if (!Number.isFinite(q) || !Number.isFinite(qVelocity))
      result.errors.push({ label, reason: "non-finite q/v", q, qVelocity });
    else {
      result.minimumQ = Math.min(result.minimumQ, q);
      result.maximumQ = Math.max(result.maximumQ, q);
      result.maximumAbsVelocity = Math.max(result.maximumAbsVelocity, Math.abs(qVelocity));
      if (q < -Q_BOUND || q > 1 + Q_BOUND || Math.abs(qVelocity) > VELOCITY_BOUND)
        result.errors.push({ label, reason: "q/v outside bounded envelope", q: round(q), qVelocity: round(qVelocity), qBound: Q_BOUND, velocityBound: VELOCITY_BOUND });
    }
    if (ids.some((id, index) => id !== (plan[index].motionId ?? null))) {
      result.samePlanMotionIds = false;
      result.errors.push({ label, reason: "motionId rebinding in fixed plan" });
    }
  };
  const request = (label, destination) => {
    const before = { q: transition.frame.q, qVelocity: transition.frame.qVelocity };
    const accepted = transition.retarget(destination);
    result.events.push({ label, accepted, q: round(transition.frame.q), qVelocity: round(transition.frame.qVelocity), desiredEnd: transition.frame.desiredEnd });
    if (!accepted) result.errors.push({ label, reason: "retarget rejected", destination });
    if (transition.frame.q !== before.q || transition.frame.qVelocity !== before.qVelocity)
      result.errors.push({ label, reason: "retarget changed current q or velocity", before, after: { q: transition.frame.q, qVelocity: transition.frame.qVelocity } });
    observe(label);
    return accepted;
  };
  const advanceUntil = (label, predicate) => {
    let frames = 0;
    while (!predicate() && frames < MAX_PHASE_FRAMES) {
      transition.advance(STEP);
      frames++;
      observe(label);
    }
    if (!predicate()) result.errors.push({ label, reason: "q threshold timed out", q: round(transition.frame.q) });
    result.events.push({ label, reached: predicate(), frames, q: round(transition.frame.q), qVelocity: round(transition.frame.qVelocity) });
    return predicate();
  };
  const settle = label => {
    let frames = 0;
    while (!transition.settled && frames < MAX_PHASE_FRAMES) {
      transition.advance(STEP);
      frames++;
      observe(label);
    }
    result.settledChecks++;
    if (!transition.settled) result.errors.push({ label, reason: "retarget did not settle within 10 seconds", q: round(transition.frame.q), qVelocity: round(transition.frame.qVelocity) });
    result.events.push({ label, settled: transition.settled, frames, q: round(transition.frame.q), qVelocity: round(transition.frame.qVelocity) });
    return transition.settled;
  };

  const sourceIsShelf = sourceMode === "array";
  for (const threshold of [.03, .2, .5, .8, .97]) {
    const label = "reverse-at-q-" + threshold;
    if (request("start-" + label, toShelf) && advanceUntil(label, () => transition.frame.q >= threshold)) {
      request(label, sourceIsShelf);
      settle("settle-after-" + label);
    }
  }
  // Exercise three consecutive mid-route reversals without rebuilding or rebinding the plan.
  if (request("start-middle-route", toShelf) && advanceUntil("middle-q-0.36", () => transition.frame.q >= .36) &&
      request("middle-reverse-1", sourceIsShelf) && advanceUntil("middle-q-0.31-return", () => transition.frame.q <= .31) &&
      request("middle-reverse-2", toShelf) && advanceUntil("middle-q-0.43", () => transition.frame.q >= .43) &&
      request("middle-reverse-3", sourceIsShelf)) {
    settle("settle-after-three-middle-reversals");
  }
  if (Number.isFinite(result.minimumQ)) result.minimumQ = round(result.minimumQ);
  if (Number.isFinite(result.maximumQ)) result.maximumQ = round(result.maximumQ);
  result.maximumAbsVelocity = round(result.maximumAbsVelocity);
  result.contractBounds = { q: [-Q_BOUND, 1 + Q_BOUND], absVelocity: VELOCITY_BOUND };
  result.scenario = scenario.name;
  return result;
}

async function runDirection(scenario, sourceMode, targetMode) {
  const sourceCatalog = sourceMode === "matrix" ? scenario.matrixCatalog : scenario.arrayCatalog;
  const targetCatalog = targetMode === "matrix" ? scenario.matrixCatalog : scenario.arrayCatalog;
  const sourceSelectedSlot = sourceCatalog.get(scenario.selectedKey);
  const targetSelectedSlot = targetCatalog.get(scenario.selectedKey);
  const sourceSelected = { lane: sourceSelectedSlot.lane, row: sourceSelectedSlot.row, foobarEntryKey: scenario.selectedKey };
  const targetSelected = { lane: targetSelectedSlot.lane, row: targetSelectedSlot.row, foobarEntryKey: scenario.selectedKey };
  const sourceCells = sourceMode === "matrix" ? scenario.matrixCells : scenario.arrayCells.map((cell, index) => ({
    ...cell, motionId: `source:array:${cell.foobarEntryKey}:${index}`,
  }));
  const targetActiveCells = targetMode === "matrix"
    ? matrixPoolCells(scenario.matrixLayout, scenario.selectedKey, scenario.windowKeys)
    : scenario.arrayCells.map(cell => ({ ...cell }));
  const targetCapacity = targetMode === "matrix" ? MATRIX_CAPACITY : ARRAY_CAPACITY;
  const targetCells = padPool(targetActiveCells, targetCapacity, targetMode === "matrix" ? 50000 : 70000);
  const sourceHeading = sourceMode === "matrix" ? 0 : Math.PI;
  const targetHeading = targetMode === "matrix" ? 0 : Math.PI;
  const sourceRowSpacing = sourceMode === "matrix" ? .62 : 1;
  const targetRowSpacing = targetMode === "matrix" ? .62 : 1;
  const selectedLift = mode => mode === "matrix" ? SOURCE_SELECTED_LIFT : ARRAY_SELECTED_LIFT;
  const sourceAnchor = new THREE.Vector3(0, BASE_Y + selectedLift(sourceMode), INSPECTION_Z);
  const targetAnchor = new THREE.Vector3(0, BASE_Y + selectedLift(targetMode), INSPECTION_Z);
  const sourceSelectedMatrix = matrixAt(sourceAnchor);
  const cameraAim = new THREE.Vector3(0, BASE_Y, INSPECTION_Z);
  const sourceYaw = THREE.MathUtils.degToRad(sourceMode === "matrix" ? 38 : -59);
  const camera = makeCamera(sourceYaw, cameraAim);
  const arrayColumnSpacing = Math.max(4.7, CASE_SIZE.x + .5);
  const sourceColumnDirection = sourceMode === "matrix" ? 5.2 : -arrayColumnSpacing;
  const targetColumnDirection = targetMode === "matrix" ? 5.2 : -arrayColumnSpacing;
  const toShelf = targetMode === "array";
  const sourceRack = sourceMode === "array" ? 1 : 0;
  const transition = new MusicLayoutTransition();
  const sourceMatrices = new Map();
  const sourceSamples = sourceCells.map(cell => {
    const selectedSample = cell.foobarEntryKey === scenario.selectedKey && cell.lane === sourceSelected.lane && cell.row === sourceSelected.row;
    const position = layoutPosition(cell, sourceSelected, sourceAnchor, sourceHeading, sourceRowSpacing, Math.abs(sourceColumnDirection));
    if (!selectedSample) position.y = BASE_Y;
    const matrix = selectedSample ? sourceSelectedMatrix.clone() : matrixAt(position);
    sourceMatrices.set(cell.motionId, matrix.clone());
    return { cell, matrix, alpha: 1, tint: 0 };
  });
  const targetPositionFor = (cell, selected = false) => {
    const position = layoutPosition(cell, targetSelected, targetAnchor, targetHeading, targetRowSpacing, Math.abs(targetColumnDirection));
    position.y = selected ? targetAnchor.y : BASE_Y;
    return matrixAt(position);
  };
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, camera, cameraAim,
    { column: sourceColumnDirection, row: sourceMode === "matrix" ? sourceRowSpacing : -sourceRowSpacing },
    toShelf, CASE_SIZE.x, BASE_Y, sourceRack, sourceCatalog);
  const plan = transition.bindCells(targetCells, targetSelected, targetMode === "matrix" ? targetRowSpacing : -targetRowSpacing,
    cell => scenario.windowKeys.has(keyOf(cell)), targetCatalog);
  transition.prepareTarget(targetAnchor);

  const pairs = expectedPairs(sourceCells, targetActiveCells, sourceCatalog, targetCatalog, sourceSelected, targetSelected);
  const targetBySignature = new Map(targetActiveCells.map(cell => [signature(cell), cell]));
  const planById = new Map(plan.filter(cell => cell.motionId).map(cell => [cell.motionId, cell]));
  const sourceOnlyIds = sourceCells.map(cell => cell.motionId).filter(id => !pairs.pairs.has(id));
  const pairedIdsMissing = [...pairs.pairs.keys()].filter(id => !planById.has(id));
  const endpointErrors = [];
  const collisionPairs = new Map();
  const previousCenters = new Map();
  const motionSteps = new Map();
  let largeStepCount = 0;
  let aabbCandidateCount = 0, satChecks = 0, testedFrames = 0;
  let visibleCases = 0, skippedZeroSize = 0, minimumSeparatingGap = Infinity;
  let minimumHorizontalAabbGap = Infinity;
  let maxStepDisplacement = { distance: 0 };
  const phaseStats = {
    forward: { frames: 0, elapsedSeconds: 0, settled: false, completed: false },
    reverse: { frames: 0, elapsedSeconds: 0, settled: false, completed: false },
  };
  let totalFrames = 0;

  const sampleFrame = (phase, frame, elapsed, endpoint) => {
    const q = currentQ(transition);
    const matrices = [];
    for (const cell of plan) {
      if (!cell.motionId) continue;
      const selected = transition.isSelected(cell);
      const matrix = targetPositionFor(cell, selected);
      transition.apply(matrix, cell, selected);
      const id = cell.motionId;
      const sourceMatrix = sourceMatrices.get(id);
      const pairedTarget = pairs.pairs.get(id);
      if (endpoint === "source") {
        if (sourceMatrix) {
          const error = matrixError(matrix, sourceMatrix);
          if (error > 1e-4 && endpointErrors.length < 50)
            endpointErrors.push({ endpoint: "source", entryKey: keyOf(cell), motionId: id, error: round(error), actual: matrix.elements.map(round), expected: sourceMatrix.elements.map(round) });
        } else if (basisLengths(matrix).some(length => length > 1e-5) && endpointErrors.length < 50) {
          endpointErrors.push({ endpoint: "incoming-zero", entryKey: keyOf(cell), motionId: id, dimensions: basisLengths(matrix).map(round) });
        }
      }
      if (endpoint === "target") {
        if (pairedTarget) {
          const expected = targetPositionFor(pairedTarget, selected);
          const error = matrixError(matrix, expected);
          if (error > 1e-4 && endpointErrors.length < 50)
            endpointErrors.push({ endpoint: "target", entryKey: keyOf(cell), motionId: id, error: round(error), actual: matrix.elements.map(round), expected: expected.elements.map(round) });
        } else if (sourceMatrix) {
          if (basisLengths(matrix).some(length => length > 1e-5) && endpointErrors.length < 50)
            endpointErrors.push({ endpoint: "source-zero", entryKey: keyOf(cell), motionId: id, dimensions: basisLengths(matrix).map(round) });
        } else if (targetBySignature.has(signature(cell))) {
          const expected = targetPositionFor(targetBySignature.get(signature(cell)), selected);
          const error = matrixError(matrix, expected);
          if (error > 1e-4 && endpointErrors.length < 50)
            endpointErrors.push({ endpoint: "incoming-target", entryKey: keyOf(cell), motionId: id, error: round(error), actual: matrix.elements.map(round), expected: expected.elements.map(round) });
        }
      }
      const center = positionOf(matrix);
      const previous = previousCenters.get(id);
      if (previous) {
        const distance = center.distanceTo(previous);
        const stats = motionSteps.get(id) ?? { maxDisplacement: 0, samples: 0 };
        stats.samples++;
        if (distance > stats.maxDisplacement) stats.maxDisplacement = distance;
        motionSteps.set(id, stats);
        if (distance > .5) largeStepCount++;
        if (distance > maxStepDisplacement.distance)
          maxStepDisplacement = { distance, entryKey: keyOf(cell), motionId: id, q };
      }
      previousCenters.set(id, center);
      const box = makeObb(matrix, cell);
      if (box) matrices.push(box);
      else skippedZeroSize++;
    }

    const checks = broadphaseAndSat(matrices);
    testedFrames++;
    phaseStats[phase].frames++;
    phaseStats[phase].elapsedSeconds = elapsed;
    aabbCandidateCount += checks.aabbCandidates;
    satChecks += checks.satChecks;
    visibleCases = Math.max(visibleCases, matrices.length);
    for (const near of checks.nearMisses) minimumSeparatingGap = Math.min(minimumSeparatingGap, near.gap);
    for (let left = 0; left < matrices.length; left++) for (let right = left + 1; right < matrices.length; right++) {
      const a = matrices[left], b = matrices[right];
      if (a.aabb.max.y < b.aabb.min.y || b.aabb.max.y < a.aabb.min.y) continue;
      const dx = Math.max(0, a.aabb.min.x - b.aabb.max.x, b.aabb.min.x - a.aabb.max.x);
      const dz = Math.max(0, a.aabb.min.z - b.aabb.max.z, b.aabb.min.z - a.aabb.max.z);
      const gap = Math.hypot(dx, dz);
      if (gap > 0) minimumHorizontalAabbGap = Math.min(minimumHorizontalAabbGap, gap);
    }
    for (const hit of checks.overlaps) {
      const pairKey = [hit.a.id, hit.b.id].sort().join("||");
      const prior = collisionPairs.get(pairKey) ?? { samples: 0, maximumPenetration: 0, phaseSamples: { forward: 0, reverse: 0 }, worst: undefined };
      prior.samples++;
      prior.phaseSamples[phase]++;
      if (hit.penetration > prior.maximumPenetration) {
        prior.maximumPenetration = hit.penetration;
        prior.worst = { phase, frame, q: round(q), time: round(elapsed), penetration: round(hit.penetration),
          a: boxReport(hit.a), b: boxReport(hit.b) };
      }
      collisionPairs.set(pairKey, prior);
    }
  };

  const simulateUntilComplete = (phase, endpointAtStart, endpointAtComplete) => {
    let frame = 0;
    let elapsed = 0;
    sampleFrame(phase, frame, elapsed, endpointAtStart);
    while (!transitionComplete(transition) && frame < MAX_PHASE_FRAMES) {
      transition.advance(STEP);
      frame++;
      elapsed += STEP;
      sampleFrame(phase, frame, elapsed, transitionComplete(transition) ? endpointAtComplete : undefined);
    }
    phaseStats[phase].completed = transitionComplete(transition);
    phaseStats[phase].settled = useRound2Snapshot ? null : transition.settled;
    phaseStats[phase].completionCriterion = useRound2Snapshot ? "progress >= 1" : "settled";
    if (!transitionComplete(transition))
      endpointErrors.push({ endpoint: `${phase}-did-not-complete`, elapsedSeconds: round(elapsed), q: round(currentQ(transition)), qVelocity: useRound2Snapshot ? null : round(transition.frame.qVelocity) });
    totalFrames += frame + 1;
  };

  // Round 3 reverses one fixed A/B plan with retarget. The archived round-2
  // API has no retarget, so its forward and reverse baselines are separate begins.
  simulateUntilComplete("forward", "source", "target");
  let retargetChecks;
  if (useRound2Snapshot) {
    phaseStats.reverse = { skipped: "round-2 transition API has no retarget", completed: false, settled: null };
    retargetChecks = { skipped: "round-2 transition API has no retarget", errors: [] };
  } else {
    const reverseRetargetAccepted = transition.retarget(sourceMode === "array");
    if (!reverseRetargetAccepted)
      endpointErrors.push({ endpoint: "reverse-retarget-rejected", q: round(currentQ(transition)), desiredEnd: transition.frame.desiredEnd });
    else
      simulateUntilComplete("reverse", undefined, "source");
    retargetChecks = runRetargetContracts({ transition, plan, toShelf, sourceMode, targetMode,
      targetCells, targetSelected, targetCatalog, scenario });
  }

  const rankedCollisions = [...collisionPairs.values()].sort((a, b) => b.maximumPenetration - a.maximumPenetration);
  return {
    scenario: scenario.name,
    direction: useRound2Snapshot ? `${sourceMode}->${targetMode}` : `${sourceMode}->${targetMode}->${sourceMode} (single fixed plan)`,
    pool: { sourceMode, sourceCapacity: sourceMode === "matrix" ? MATRIX_CAPACITY : ARRAY_CAPACITY,
      sourceSamples: sourceSamples.length, targetMode, targetCapacity, activeTargetCells: targetActiveCells.length,
      planItems: plan.filter(cell => cell.motionId).length, uniqueWindowEntries: scenario.windowKeys.size,
      matrixPoolLanes: MATRIX_LANES, matrixPoolRows: MATRIX_ROWS, sampledMatrixRowsPerLane: MATRIX_WINDOW_ROWS },
    selected: { entryKey: scenario.selectedKey, sourceCell: sourceSelected, targetCell: targetSelected,
      sourceLift: selectedLift(sourceMode), targetLift: selectedLift(targetMode) },
    sampling: { stepSeconds: STEP, maxPhaseSeconds: MAX_PHASE_SECONDS, samples: testedFrames, totalFrames,
      phases: phaseStats, maxStepDisplacement: {
      ...maxStepDisplacement, distance: round(maxStepDisplacement.distance) },
      stepDisplacementsOverHalfMeter: largeStepCount },
    broadphase: { visibleCasesPeak: visibleCases, zeroSizeCasesSkipped: skippedZeroSize,
      aabbCandidateCount, satChecks, minimumSeparatingAxisGap: Number.isFinite(minimumSeparatingGap) ? round(minimumSeparatingGap) : null,
      minimumHorizontalAabbGap: Number.isFinite(minimumHorizontalAabbGap) ? round(minimumHorizontalAabbGap) : null },
    collisions: { uniquePairs: collisionPairs.size, sampleHits: rankedCollisions.reduce((sum, item) => sum + item.samples, 0),
      maximumPenetration: rankedCollisions.length ? round(rankedCollisions[0].maximumPenetration) : 0,
      worstPairs: rankedCollisions.slice(0, 20).map(item => ({ samples: item.samples, phaseSamples: item.phaseSamples, ...item.worst })) },
    endpoints: { errors: endpointErrors, unmatchedSourceIds: sourceOnlyIds.length, pairedIdsMissingFromPlan: pairedIdsMissing },
    retarget: retargetChecks,
  };
}

function flightMode(name) {
  return name === "array" ? {
    selected: { lane: 2, row: 16, foobarEntryKey: "hero" },
    spacing: { column: -4.95, row: -1 }, anchor: new THREE.Vector3(0, -2.502, 0),
    aim: new THREE.Vector3(0, -4.425, -2.17), yaw: -38, elevation: 35, distance: 140, span: ARRAY_OVERVIEW_SPAN,
    offsets: [["hero", 0, 0], ["core-1", 0, 1], ["core-2", 0, 2], ["screen-left", -1, 0], ["screen-right", 1, 0]],
  } : {
    selected: { lane: 2, row: 15, foobarEntryKey: "hero" },
    spacing: { column: -5.2, row: -.62 }, anchor: new THREE.Vector3(0, -3.25, 0),
    aim: new THREE.Vector3(-1.091, -.045, .481), yaw: 59, elevation: 25, distance: 170, span: MATRIX_OVERVIEW_SPAN,
    offsets: [["hero", 0, 0], ["core-1", 0, 1], ["core-2", 0, 2], ["screen-left", -1, 0], ["screen-right", 1, 0]],
  };
}

function flightOutward(mode) {
  const yaw = THREE.MathUtils.degToRad(mode.yaw), elevation = THREE.MathUtils.degToRad(mode.elevation);
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
}

function flightCamera(mode) {
  const camera = new THREE.PerspectiveCamera(34, 16 / 10, 5, 300);
  const position = mode.aim.clone().addScaledVector(flightOutward(mode), mode.distance);
  camera.position.copy(position);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(mode.span / (2 * mode.distance)));
  camera.lookAt(mode.aim); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return { camera, position, aim: mode.aim.clone(), span: mode.span };
}

function flightCell(mode, key, laneOffset, rowOffset) {
  return { lane: mode.selected.lane + laneOffset, row: mode.selected.row + rowOffset, foobarEntryKey: key };
}

function flightMatrix(mode, cell, selected = false) {
  const position = mode.anchor.clone().add(new THREE.Vector3(
    (cell.lane - mode.selected.lane) * mode.spacing.column, 0,
    (cell.row - mode.selected.row) * mode.spacing.row));
  if (!selected) position.y = -4.55;
  return matrixAt(position);
}

function flightCorners(matrix) {
  const bounds = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y])
    for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  return points;
}

function makeFlightObb(matrix, cell) {
  const e = matrix.elements;
  const columns = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]), new THREE.Vector3(e[8], e[9], e[10])];
  const scales = columns.map(column => column.length());
  if (scales.some(scale => scale <= 1e-7)) return undefined;
  const axes = columns.map((column, index) => column.clone().divideScalar(scales[index]));
  const half = [CASE_SIZE.x * scales[0] / 2, CASE_SIZE.y * scales[1] / 2, CASE_SIZE.z * scales[2] / 2];
  const local = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
  const aabb = local.clone().applyMatrix4(matrix);
  const center = new THREE.Vector3(0, 1.85, 0).applyMatrix4(matrix);
  return { id: cell.motionId, key: cell.foobarEntryKey, cell: { lane: cell.lane, row: cell.row }, matrix: matrix.clone(),
    axes, half, center, aabb, dimensions: scales.map((scale, index) => scale * CASE_SIZE.getComponent(index)) };
}

function projectFlightBox(matrix, camera) {
  const points = flightCorners(matrix);
  const view = points.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse));
  const projected = points.map(point => point.clone().project(camera));
  const depth = view.map(point => -point.z);
  const minX = Math.min(...projected.map(point => point.x)), maxX = Math.max(...projected.map(point => point.x));
  const minY = Math.min(...projected.map(point => point.y)), maxY = Math.max(...projected.map(point => point.y));
  const minZ = Math.min(...projected.map(point => point.z)), maxZ = Math.max(...projected.map(point => point.z));
  return { visible: depth.some(value => value > 0) && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1 && maxZ > -1 && minZ < 1,
    positiveDepth: depth.every(value => value > 0), projected };
}

function makeCurrentGeometryFlight(sourceName, targetName) {
  const sourceMode = flightMode(sourceName), targetMode = flightMode(targetName);
  const sourceSelected = { ...sourceMode.selected }, targetSelected = { ...targetMode.selected };
  const sourceCells = sourceMode.offsets.map(([key, lane, row]) => flightCell(sourceMode, key, lane, row));
  const targetCells = [...targetMode.offsets.map(([key, lane, row]) => flightCell(targetMode, key, lane, row)),
    { lane: -10000, row: -10000 }, { lane: -10001, row: -10001 }, { lane: -10002, row: -10002 }];
  const catalogFor = (cells) => new Map(cells.filter(cell => cell.foobarEntryKey).map((cell, order) =>
    [cell.foobarEntryKey, { lane: cell.lane, row: cell.row, order }]));
  const sourceCatalog = catalogFor(sourceCells), targetCatalog = catalogFor(targetCells);
  const sourceSelectedMatrix = flightMatrix(sourceMode, sourceSelected, true);
  const sourceCamera = flightCamera(sourceMode);
  const sourceSamples = sourceCells.map(cell => {
    const selected = cell.lane === sourceSelected.lane && cell.row === sourceSelected.row && cell.foobarEntryKey === "hero";
    const matrix = selected ? sourceSelectedMatrix.clone() : flightMatrix(sourceMode, cell);
    return { cell: { ...cell, motionId: `${sourceName}:${cell.foobarEntryKey}:${cell.lane}:${cell.row}` },
      matrix, restMatrix: matrix.clone(), alpha: 1, tint: 0 };
  });
  const targetBySignature = new Map(targetCells.filter(cell => cell.foobarEntryKey)
    .map(cell => [`${cell.foobarEntryKey}|${cell.lane}|${cell.row}`, cell]));
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetName === "array", CASE_SIZE.x, BASE_Y, Number(sourceName === "array"), sourceCatalog,
    new THREE.Vector3(0, 1.85, 0), sourceSelectedMatrix,
    { min: [-2.225, .175, -.07], max: [2.225, 3.525, .07] });
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetBySignature.has(`${cell.foobarEntryKey}|${cell.lane}|${cell.row}`), targetCatalog);
  const selectedTarget = flightMatrix(targetMode, targetSelected, true);
  transition.prepareTarget(new THREE.Vector3().setFromMatrixPosition(selectedTarget));
  const targetMatrices = new Map();
  for (const cell of plan) {
    const key = `${cell.foobarEntryKey}|${cell.lane}|${cell.row}`;
    const targetCell = targetBySignature.get(key);
    const matrix = targetCell ? flightMatrix(targetMode, targetCell, cell.foobarEntryKey === "hero")
      : flightMatrix(targetMode, cell, false);
    if (targetCell) targetMatrices.set(key, matrix.clone());
    transition.primeTarget(cell, matrix, transition.isSelected(cell));
  }
  if (!transition.targetsReady) throw new Error(`${sourceName}->${targetName} target priming is incomplete`);
  const targetCamera = flightCamera(targetMode), camera = sourceCamera.camera.clone(), aim = sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, targetCamera.position, targetCamera.aim, targetCamera.span);
  return { transition, sourceName, targetName, sourceMode, targetMode, sourceSelected, targetSelected,
    sourceCells, sourceCamera, targetCamera, targetCells, targetBySignature, targetMatrices, plan };
}

function sampleCurrentFlight(flight) {
  const camera = flight.sourceCamera.camera.clone(), aim = flight.sourceCamera.aim.clone();
  flight.transition.applyCamera(camera, aim, flight.targetCamera.position, flight.targetCamera.aim, flight.targetCamera.span);
  camera.updateMatrixWorld(true);
  const boxes = [], endpointErrors = [];
  let visibleCore = 0, visibleCount = 0;
  for (const cell of flight.plan) {
    if (!cell.foobarEntryKey || !flight.transition.occurrenceId(cell)) continue;
    const key = `${cell.foobarEntryKey}|${cell.lane}|${cell.row}`;
    const matrix = flight.targetMatrices.get(key)?.clone() ?? flightMatrix(flight.targetMode, cell);
    flight.transition.apply(matrix, cell, flight.transition.isSelected(cell));
    const scale = basisLengths(matrix);
    if (scale.some(value => Math.abs(value - 1) > 1e-7)) endpointErrors.push({ reason: "non-unit case scale", key: cell.foobarEntryKey, q: flight.transition.frame.q, scale });
    const projection = projectFlightBox(matrix, camera);
    if (projection.visible) {
      visibleCount++;
      if (flight.transition.routeFor(cell)?.core) visibleCore++;
      const box = makeFlightObb(matrix, cell);
      if (box) boxes.push(box);
    }
    if (projection.visible && !projection.positiveDepth)
      endpointErrors.push({ reason: "visible case lacks positive camera depth", key: cell.foobarEntryKey, q: flight.transition.frame.q });
    if (flight.transition.settled) {
      const owner = flight.transition.endpointCell(cell), expected = flight.targetBySignature.get(key);
      if (expected && JSON.stringify(owner) !== JSON.stringify(expected))
        endpointErrors.push({ reason: "terminal owner mismatch", key: cell.foobarEntryKey, owner, expected });
    }
  }
  const collisions = broadphaseAndSat(boxes).overlaps;
  const asinArgument = flight.transition.frame.cameraAsinArgument;
  if (!Number.isFinite(asinArgument) || Math.abs(asinArgument) > 1 + 1e-7)
    endpointErrors.push({ reason: "camera height solve is infeasible", q: flight.transition.frame.q, asinArgument });
  return { q: flight.transition.frame.q, camera, aim, visibleCount, visibleCore, boxes: boxes.length,
    collisions: collisions.map(item => ({ a: item.a.key, b: item.b.key, penetration: item.penetration })),
    endpointErrors, asinArgument };
}

async function runCurrentGeometry() {
  const scenarios = [];
  for (const [sourceName, targetName] of [["array", "matrix"], ["matrix", "array"]]) {
    const flight = makeCurrentGeometryFlight(sourceName, targetName);
    const endpointErrors = [];
    const collisions = new Map();
    let frames = 0, visibleCasePeak = 0, visibleCorePeak = 0, onscreenBoxPeak = 0;
    const initialQ = flight.transition.frame.q;
    const sample = () => {
      const current = sampleCurrentFlight(flight);
      endpointErrors.push(...current.endpointErrors);
      visibleCasePeak = Math.max(visibleCasePeak, current.visibleCount);
      visibleCorePeak = Math.max(visibleCorePeak, current.visibleCore);
      onscreenBoxPeak = Math.max(onscreenBoxPeak, current.boxes);
      for (const pair of current.collisions) {
        const key = [pair.a, pair.b].sort().join("|");
        const value = collisions.get(key) ?? { samples: 0, maximumPenetration: 0 };
        value.samples++;
        value.maximumPenetration = Math.max(value.maximumPenetration, pair.penetration);
        collisions.set(key, value);
      }
      frames++;
      if (current.visibleCore === 0) endpointErrors.push({ reason: "no visible core case", q: current.q });
    };
    sample();
    while (!flight.transition.settled && frames < MAX_PHASE_FRAMES) {
      flight.transition.advance(STEP);
      sample();
    }
    if (!flight.transition.settled) endpointErrors.push({ reason: "flight did not settle", q: flight.transition.frame.q });
    if (flight.transition.frame.rackDeployment !== 1)
      endpointErrors.push({ reason: "rack lost full deployment", rackDeployment: flight.transition.frame.rackDeployment });
    scenarios.push({ direction: `${sourceName}->${targetName}`, startQ: initialQ, endQ: flight.transition.frame.q,
      selected: flight.transition.endpointSelection, frames, visibleCasePeak, visibleCorePeak, onscreenBoxPeak,
      matchedCoreCases: flight.transition.frame.coreCases, endpointErrors,
      onscreenCollisionPairs: [...collisions.entries()].map(([key, value]) => ({ key, ...value })) });
  }
  const report = {
    generatedAt: new Date().toISOString(),
    contract: {
      modeAxes: {
        array: { column: [-4.95, 0, 0], row: [0, 0, -1] },
        matrix: { column: [-5.2, 0, 0], row: [0, 0, -.62] },
      },
      phaseWindows: { arrayOnlyExit: [0, .2], matchedPeripheralMorphAndParking: [.2, .4], matrixOnlyEntry: [.4, 1] },
      peripheralMotion: "shared ARRAY/MATRIX endpoint half-field translation on rig-local +/-X or +/-Z; front/back cohorts clear the current core envelope by 0.06",
      priming: "bind pool, prepare selected anchor, prime every normal target and selected pose, cache target camera, then advance",
      collisionScope: "synthetic five-case core and neighboring screen boxes; only boxes projected into the viewport are tested",
      coverageNote: "Mirror-side segment parking is exercised by check-layout-flight.mjs. This checker covers the visible synthetic core/onscreen cases only; it does not claim collision-free physical motion for every record in the full library.",
      caseDimensions: CASE_SIZE.toArray(),
    },
    scenarios,
    summary: {
      directions: scenarios.length,
      sampleFrames: scenarios.reduce((sum, scenario) => sum + scenario.frames, 0),
      onscreenCollisionPairs: scenarios.reduce((sum, scenario) => sum + scenario.onscreenCollisionPairs.length, 0),
      endpointErrors: scenarios.reduce((sum, scenario) => sum + scenario.endpointErrors.length, 0),
      minimumVisibleCorePeak: Math.min(...scenarios.map(scenario => scenario.visibleCorePeak)),
    },
  };
  return report;
}

async function main() {
  if (!useRound2Snapshot) {
    const report = await runCurrentGeometry();
    const outputPath = path.join(process.cwd(), ".tools", "animation-refinement-2026-10-18", "check-archive-geometry.json");
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify({ outputPath, summary: report.summary,
      scenarios: report.scenarios.map(({ direction, startQ, endQ, frames, visibleCorePeak, onscreenBoxPeak,
        matchedCoreCases, endpointErrors, onscreenCollisionPairs }) => ({ direction, startQ, endQ, frames,
        visibleCorePeak, onscreenBoxPeak, matchedCoreCases, endpointErrors: endpointErrors.length,
        onscreenCollisionPairs: onscreenCollisionPairs.length })) }, null, 2));
    if (report.summary.endpointErrors > 0 || report.summary.onscreenCollisionPairs > 0) process.exitCode = 1;
    return;
  }
  const report = { generatedAt: new Date().toISOString(), contract: {
    caseSize: CASE_SIZE.toArray(), broadphase: "sorted-by-x current-frame AABB candidate pruning",
    narrowphase: "15-axis OBB separating-axis test", sampleRateHz: 120,
    transitionVersion: useRound2Snapshot ? "round-2 snapshot" : "current geometric source",
    transitionSampling: useRound2Snapshot
      ? "advance until progress >= 1, with a 10-second cap; each direction uses the archived API"
      : "advance until settled, with a 10-second cap per leg; reverse via retarget on the same fixed plan",
    retargetEnvelope: { q: [-Q_BOUND, 1 + Q_BOUND], absoluteVelocity: VELOCITY_BOUND },
    physicalModes: {
      matrix: { headingRadians: 0, rowSpacing: .62, columnDirection: 5.2, shelfDeployment: false },
      array: { headingRadians: Math.PI, rowSpacing: 1, columnDirection: -Math.max(4.7, CASE_SIZE.x + .5), shelfDeployment: true },
    },
    coverageNote: "Synthetic catalog fixtures; case OBB is 4.45 x 3.35 x 0.14 and MATRIX samples a 9 x 16 local window from a 9 x 48 pool. This is not coverage of every renderer case model or the full library.",
    sourceMatrixPool: { lanes: MATRIX_LANES, rows: MATRIX_ROWS, sampledRowsPerLane: MATRIX_WINDOW_ROWS },
  }, scenarios: [] };
  for (const spec of groupsToRun) {
    const scenario = makeScenario(spec);
    report.scenarios.push(await runDirection(scenario, "matrix", "array"));
    if (useRound2Snapshot) report.scenarios.push(await runDirection(scenario, "array", "matrix"));
  }
  report.summary = {
    scenarios: report.scenarios.length,
    sampleFrames: report.scenarios.reduce((sum, item) => sum + item.sampling.samples, 0),
    uniqueCollisionPairs: report.scenarios.reduce((sum, item) => sum + item.collisions.uniquePairs, 0),
    collisionSamples: report.scenarios.reduce((sum, item) => sum + item.collisions.sampleHits, 0),
    endpointErrors: report.scenarios.reduce((sum, item) => sum + item.endpoints.errors.length + item.endpoints.pairedIdsMissingFromPlan.length, 0),
    retargetContractErrors: report.scenarios.reduce((sum, item) => sum + item.retarget.errors.length, 0),
    worstPenetration: Math.max(0, ...report.scenarios.map(item => item.collisions.maximumPenetration)),
  };
  const outputPath = path.join(process.cwd(), ".tools", "animation-refinement-2026-10-18",
    useRound2Snapshot ? "round-2-collisions-corrected.json" : "check-archive-geometry.json");
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath, summary: report.summary,
    scenarios: report.scenarios.map(item => ({ name: item.scenario, direction: item.direction,
      planItems: item.pool.planItems, frames: item.sampling.samples, phases: item.sampling.phases,
      collisions: item.collisions.uniquePairs, maxPenetration: item.collisions.maximumPenetration,
      endpointErrors: item.endpoints.errors.length, unmatchedSourceIds: item.endpoints.unmatchedSourceIds,
      missingPlanIds: item.endpoints.pairedIdsMissingFromPlan,
      retargetErrors: item.retarget.errors.length, retargetEnvelope: {
        minQ: item.retarget.minimumQ, maxQ: item.retarget.maximumQ, maxAbsVelocity: item.retarget.maximumAbsVelocity,
      } })) }, null, 2));
  if (report.summary.endpointErrors > 0 || report.summary.retargetContractErrors > 0 || report.summary.uniqueCollisionPairs > 0)
    process.exitCode = 1;
}

await main();
