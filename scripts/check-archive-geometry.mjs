import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "../src/music-display-layout.ts";
import { musicArrayCompositionFrame, musicMatrixOverviewSpan } from "../src/music-layout-framing.ts";
import { MusicLayoutTransition } from "../src/music-layout-flight.ts";
import { deploymentStep } from "../src/music-shelf-deployment.ts";

const STEP = 1 / 60;
const MAX_PHASE_SECONDS = 10;
const MAX_PHASE_FRAMES = Math.ceil(MAX_PHASE_SECONDS / STEP);
const Q_BOUND = 1e-8;
const VELOCITY_LIMIT = .44;
const MATRIX_LANES = 9;
const LOOP_COLUMNS = 9;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];
const MATRIX_ROWS = 48;
const MATRIX_WINDOW_ROWS = MATRIX_ROWS;
const ARRAY_ROWS = 20;
const ARRAY_CAPACITY = MATRIX_LANES * ARRAY_ROWS;
const MATRIX_CAPACITY = MATRIX_LANES * MATRIX_ROWS;
const CASE_BOUNDS = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
const CASE_CENTER = new THREE.Vector3(0, 1.85, 0);
const CASE_SIZE = CASE_BOUNDS.getSize(new THREE.Vector3());
const BASE_Y = -4.6;
const INSPECTION_Z = -2.17;
const MATRIX_COLUMN_SPACING = 5.2;
const ARRAY_COLUMN_SPACING = Math.max(4.7, CASE_SIZE.x + .5);
const ARRAY_SELECTED_LIFT = 1.35 + .748;
const MATRIX_SELECTED_LIFT = .9;
const MATRIX_ROW_SPACING = .62;
const ARRAY_ROW_SPACING = 1;
const AABB_EPSILON = 1e-6;
const SAT_EPSILON = 1e-6;
const DIRECT_POSE_TOLERANCE = 2e-4;
const MATRIX_CONTINUITY_TOLERANCE = 2e-5;
const ARRAY_GROUND_Y = MUSIC_ARRAY_VIEW.floorY + CASE_BOUNDS.min.y - MUSIC_SHELF_VIEW.floorDrop;
const OUTPUT_PATH = path.join(process.cwd(), ".tools", "emergence-motion-2026-10-18", "check-archive-geometry.json");

const scenariosToRun = [
  { name: "[20,20,5]", groupLengths: [20, 20, 5], selectedOrder: 1 },
  { name: "[20,19]-selected-row-211", groupLengths: [20, 19], selectedOrder: 19, matrixSelectedRow: 211 },
  { name: "[20,18]", groupLengths: [20, 18], selectedOrder: 1 },
  { name: "[20,20,20,5]", groupLengths: [20, 20, 20, 5], selectedOrder: 1 },
];

const round = value => Math.round(Number(value) * 1e5) / 1e5;
const roundVector = vector => vector.toArray().map(round);
const keyOf = cell => cell?.foobarEntryKey;
const signature = cell => `${cell?.foobarEntryKey ?? ""}|${Number(cell?.lane)}|${Number(cell?.row)}`;
const cellKey = cell => Number.isFinite(Number(cell?.lane)) && Number.isFinite(Number(cell?.row))
  ? `${Number(cell.lane)}:${Number(cell.row)}` : null;
const mod = (value, count) => ((value % count) + count) % count;
const addError = (errors, error) => { if (errors.length < 120) errors.push(error); };

const ARRAY_OVERVIEW_SPAN = musicArrayCompositionFrame(1920, 1080, 1100, .8, -1,
  { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() },
  { x: CASE_CENTER.x, y: CASE_CENTER.y, z: CASE_CENTER.z }, false).effectiveSpan;
const MATRIX_OVERVIEW_SPAN = musicMatrixOverviewSpan(ARRAY_OVERVIEW_SPAN);

function makeMatrix(position, rotation = new THREE.Quaternion(), scale = new THREE.Vector3(1, 1, 1)) {
  return new THREE.Matrix4().compose(position.clone(), rotation.clone(), scale.clone());
}

function matrixScale(matrix) {
  const e = matrix.elements;
  return [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
}

function matrixError(actual, expected) {
  let error = 0;
  for (let index = 0; index < 16; index++)
    error = Math.max(error, Math.abs(actual.elements[index] - expected.elements[index]));
  return error;
}

function makeCatalog(groupLengths) {
  const groups = groupLengths.map(length => Array.from({ length }));
  const catalog = new Map();
  let order = 0;
  for (let lane = 0; lane < groups.length; lane++) {
    for (let row = 0; row < groups[lane].length; row++) {
      const key = `record-${order}`;
      groups[lane][row] = key;
      catalog.set(key, { lane, row: 12 + row, order });
      order++;
    }
  }
  return { groups, catalog, count: order };
}

function packCatalog(matrixLayout) {
  return new Map(matrixLayout.catalog);
}

function makeArrayCells(arrayCatalog, selectedCell) {
  const lastLane = selectedCell.lane + 3;
  return [...arrayCatalog.entries()].map(([foobarEntryKey, slot]) => ({
    lane: slot.lane, row: slot.row, foobarEntryKey,
  })).filter(cell => cell.lane >= selectedCell.lane && cell.lane <= lastLane)
    .sort((left, right) => arrayCatalog.get(left.foobarEntryKey).order - arrayCatalog.get(right.foobarEntryKey).order);
}

function makeMatrixCells(matrixLayout, selectedCell) {
  const arrayCatalog = packCatalog(matrixLayout);
  const arrayColumns = Math.max(1, Math.ceil(matrixLayout.count / ARRAY_ROWS));
  const slotsByLane = new Map();
  for (const [foobarEntryKey, slot] of arrayCatalog) {
    const slots = slotsByLane.get(slot.lane) ?? [];
    slots.push({ ...slot, foobarEntryKey });
    slotsByLane.set(slot.lane, slots);
  }
  for (const slots of slotsByLane.values()) slots.sort((a, b) => a.row - b.row);
  const selected = selectedCell;
  const nearestOccurrence = (value, center, period) =>
    value + Math.floor((center - value + period / 2) / period) * period;
  const cells = [];
  for (let index = 0; index < MATRIX_LANES * MATRIX_ROWS; index++) {
    const baseLane = POOL_LANES[Math.floor(index / MATRIX_ROWS)];
    const baseRow = index % MATRIX_ROWS - (MATRIX_ROWS - 32) / 2;
    const lane = nearestOccurrence(baseLane, selected.lane, LOOP_COLUMNS);
    const row = nearestOccurrence(baseRow, selected.row, MATRIX_ROWS);
    const shelf = mod(lane, arrayColumns);
    const shelfSlots = slotsByLane.get(shelf) ?? [];
    const slot = shelfSlots[mod(row - 12, shelfSlots.length)];
    cells.push({ lane, row, ...(slot ? { foobarEntryKey: slot.foobarEntryKey } : {}) });
  }
  return cells;
}

function padPool(cells, capacity, offset) {
  const padded = [...cells];
  while (padded.length < capacity) padded.push({ lane: -10000 - offset - padded.length, row: -10000 - padded.length });
  return padded;
}

function makeScenario(spec) {
  const matrixLayout = makeCatalog(spec.groupLengths);
  const arrayCatalog = packCatalog(matrixLayout);
  const selectedKey = `record-${spec.selectedOrder}`;
  if (!matrixLayout.catalog.has(selectedKey) || !arrayCatalog.has(selectedKey))
    throw new Error(`${spec.name} has no selected fixture item ${selectedKey}`);
  const selectedCell = { lane: arrayCatalog.get(selectedKey).lane,
    row: arrayCatalog.get(selectedKey).row, foobarEntryKey: selectedKey };
  const matrixSelected = { ...selectedCell, row: spec.matrixSelectedRow ?? selectedCell.row };
  const arrayCells = [...arrayCatalog.entries()].map(([foobarEntryKey, slot]) => ({
    lane: slot.lane, row: slot.row, foobarEntryKey,
  }));
  return { ...spec, count: matrixLayout.count, matrixLayout, matrixCatalog: matrixLayout.catalog, arrayCatalog, selectedKey,
    selectedCell, matrixSelected, arrayCells, visibleArrayCells: makeArrayCells(arrayCatalog, selectedCell),
    matrixCells: makeMatrixCells(matrixLayout, matrixSelected) };
}

function modeSelected(mode, scenario) {
  return { ...(mode === "array" ? scenario.selectedCell : scenario.matrixSelected) };
}

function modeAnchor(mode) {
  return new THREE.Vector3(0, BASE_Y + (mode === "array" ? ARRAY_SELECTED_LIFT : MATRIX_SELECTED_LIFT), INSPECTION_Z);
}

function modeCamera(mode) {
  const isArray = mode === "array";
  const yaw = THREE.MathUtils.degToRad(isArray ? -38 : 59);
  const elevation = THREE.MathUtils.degToRad(isArray ? 35 : 25);
  const distance = isArray ? 140 : 170;
  const aim = isArray ? new THREE.Vector3(0, -4.425, -2.17) : new THREE.Vector3(-1.091, -.045, .481);
  const span = isArray ? ARRAY_OVERVIEW_SPAN : MATRIX_OVERVIEW_SPAN;
  const camera = new THREE.PerspectiveCamera(34, 16 / 10, 5, 300);
  const outward = new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation));
  camera.position.copy(aim).addScaledVector(outward, distance);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * distance)));
  camera.lookAt(aim);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { camera, position: camera.position.clone(), aim, span };
}

function layoutMatrix(mode, cell, selected, anchor, isSelected) {
  const columnSpacing = mode === "array" ? -ARRAY_COLUMN_SPACING : -MATRIX_COLUMN_SPACING;
  const rowSpacing = mode === "array" ? -ARRAY_ROW_SPACING : -MATRIX_ROW_SPACING;
  const offset = new THREE.Vector3((cell.lane - selected.lane) * columnSpacing, 0,
    (cell.row - selected.row) * rowSpacing);
  const position = anchor.clone().add(offset);
  position.y = isSelected ? anchor.y : BASE_Y;
  return makeMatrix(position);
}

function makeFlight(scenario, sourceMode, targetMode) {
  const sourceCatalog = scenario.arrayCatalog;
  const targetCatalog = scenario.arrayCatalog;
  const sourceSelected = modeSelected(sourceMode, scenario);
  const targetSelected = modeSelected(targetMode, scenario);
  const sourceCells = (sourceMode === "array" ? scenario.visibleArrayCells : scenario.matrixCells).map((cell, index) => ({
    ...cell, motionId: `${sourceMode}:${cell.foobarEntryKey}:${cell.lane}:${cell.row}:${index}`,
  }));
  const targetActiveCells = targetMode === "array" ? scenario.arrayCells.map(cell => ({ ...cell }))
    : scenario.matrixCells.map(cell => ({ ...cell }));
  const targetCapacity = targetMode === "array" ? ARRAY_CAPACITY : MATRIX_CAPACITY;
  const targetCells = padPool(targetActiveCells, targetCapacity, targetMode === "array" ? 70000 : 50000);
  const sourceAnchor = modeAnchor(sourceMode), targetAnchor = modeAnchor(targetMode);
  const sourceSelectedMatrix = layoutMatrix(sourceMode, sourceSelected, sourceSelected, sourceAnchor, true);
  const sourceCamera = modeCamera(sourceMode), targetCamera = modeCamera(targetMode);
  const sourceSpacing = sourceMode === "array" ? { column: -ARRAY_COLUMN_SPACING, row: -ARRAY_ROW_SPACING }
    : { column: -MATRIX_COLUMN_SPACING, row: -MATRIX_ROW_SPACING };
  const targetRowSpacing = targetMode === "array" ? -ARRAY_ROW_SPACING : -MATRIX_ROW_SPACING;
  const sourceSamples = sourceCells.map(cell => {
    const selected = cell.foobarEntryKey === scenario.selectedKey && cell.lane === sourceSelected.lane &&
      cell.row === sourceSelected.row;
    const matrix = selected ? sourceSelectedMatrix.clone() : layoutMatrix(sourceMode, cell, sourceSelected, sourceAnchor, false);
    return { cell, matrix, restMatrix: matrix.clone(), alpha: 1, tint: 0 };
  });
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceSpacing, targetMode === "array", CASE_SIZE.x, BASE_Y, Number(sourceMode === "array"), sourceCatalog,
    CASE_CENTER, sourceSelectedMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const targetBySignature = new Map(targetActiveCells.map(cell => [signature(cell), cell]));
  const plan = transition.bindCells(targetCells, targetSelected, targetRowSpacing,
    cell => targetBySignature.has(signature(cell)), targetCatalog);
  const targetSelectedMatrix = layoutMatrix(targetMode, targetSelected, targetSelected, targetAnchor, true);
  transition.prepareTarget(new THREE.Vector3().setFromMatrixPosition(targetSelectedMatrix));
  for (const cell of plan) {
    if (!transition.occurrenceId(cell)) continue;
    const selected = transition.isSelected(cell);
    const targetCell = targetBySignature.get(signature(cell));
    const matrix = selected ? targetSelectedMatrix.clone()
      : layoutMatrix(targetMode, targetCell ?? cell, targetSelected, targetAnchor, false);
    transition.primeTarget(cell, matrix, selected);
    transition.appearance(cell, { alpha: 1, tint: 0 });
  }
  if (!transition.targetsReady) throw new Error(`${scenario.name} ${sourceMode}->${targetMode}: target poses were not primed`);
  const initialCamera = sourceCamera.camera.clone(), initialAim = sourceCamera.aim.clone();
  transition.applyCamera(initialCamera, initialAim, targetCamera.position, targetCamera.aim, targetCamera.span);
  const fixedIds = plan.map(cell => transition.occurrenceId(cell)).filter(Boolean);
  return { scenario, sourceMode, targetMode, sourceSelected, targetSelected, sourceAnchor, targetAnchor,
    sourceCamera, targetCamera, sourceCells, targetActiveCells, targetBySignature, plan, transition,
    fixedIds, errors: [], collisions: new Map(), routeById: new Map(), bootstrapFrames: [], endpointSnapshots: new Map(),
    directPose: { samples: 0, extraSamples: 0, maxError: 0, extraMaxError: 0, worst: null,
      headingMaxError: 0, rowSpacingMaxError: 0 },
    qRange: { min: Infinity, max: -Infinity, maxAbsVelocity: 0 },
    counts: { samples: 0, satChecks: 0, aabbCandidates: 0, visiblePeak: 0, residentPeak: 0, mOnlyPeak: 0,
      positiveDepthFailures: 0, scaleFailures: 0, alphaFailures: 0 },
    phaseFrames: { outward: 0, return: 0, retarget: 0 },
    lastSnapshot: null, arrayEndpointFrame: null, matrixEndpointFrame: null, endpointMatrices: null,
  };
}

function boundsCorners(matrix) {
  const points = [];
  for (const x of [CASE_BOUNDS.min.x, CASE_BOUNDS.max.x])
    for (const y of [CASE_BOUNDS.min.y, CASE_BOUNDS.max.y])
      for (const z of [CASE_BOUNDS.min.z, CASE_BOUNDS.max.z])
        points.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  return points;
}

function projectBox(matrix, camera) {
  const corners = boundsCorners(matrix);
  const view = corners.map(point => point.clone().applyMatrix4(camera.matrixWorldInverse));
  const depths = view.map(point => -point.z);
  const projected = corners.map(point => point.clone().project(camera));
  const finite = projected.every(point => [point.x, point.y, point.z].every(Number.isFinite));
  const minX = finite ? Math.min(...projected.map(point => point.x)) : NaN;
  const maxX = finite ? Math.max(...projected.map(point => point.x)) : NaN;
  const minY = finite ? Math.min(...projected.map(point => point.y)) : NaN;
  const maxY = finite ? Math.max(...projected.map(point => point.y)) : NaN;
  const depthMin = Math.min(...depths), depthMax = Math.max(...depths);
  const visible = finite && depthMax >= camera.near && depthMin <= camera.far &&
    maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1;
  return { visible, positiveDepth: depthMin > camera.near && depthMax < camera.far,
    depthMin, depthMax, minX, maxX, minY, maxY };
}

function makeObb(matrix, cell) {
  const e = matrix.elements;
  const columns = [new THREE.Vector3(e[0], e[1], e[2]), new THREE.Vector3(e[4], e[5], e[6]),
    new THREE.Vector3(e[8], e[9], e[10])];
  const scales = columns.map(column => column.length());
  if (scales.some(scale => !Number.isFinite(scale) || scale <= 1e-8)) return null;
  const axes = columns.map((column, index) => column.clone().divideScalar(scales[index]));
  const half = [CASE_SIZE.x * scales[0] / 2, CASE_SIZE.y * scales[1] / 2, CASE_SIZE.z * scales[2] / 2];
  const localCenter = CASE_BOUNDS.getCenter(new THREE.Vector3());
  const center = localCenter.applyMatrix4(matrix);
  const aabb = CASE_BOUNDS.clone().applyMatrix4(matrix);
  return { id: cell.motionId, key: cell.foobarEntryKey, cell: { lane: cell.lane, row: cell.row },
    matrix: matrix.clone(), axes, half, center, aabb, dimensions: scales.map((scale, index) => scale * CASE_SIZE.getComponent(index)) };
}

function sat(a, b) {
  const delta = b.center.clone().sub(a.center);
  const axes = [...a.axes, ...b.axes];
  for (const axisA of a.axes) for (const axisB of b.axes)
    axes.push(new THREE.Vector3().crossVectors(axisA, axisB));
  let penetration = Infinity, smallestGap = Infinity;
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
  return smallestGap < Infinity ? { overlap: false, gap: smallestGap }
    : { overlap: true, penetration: Math.max(0, penetration) };
}

function broadphaseAndSat(boxes) {
  const sorted = [...boxes].sort((left, right) => left.aabb.min.x - right.aabb.min.x);
  const overlaps = [];
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
      const collision = sat(a, b);
      if (collision.overlap) overlaps.push({ a, b, penetration: collision.penetration });
    }
  }
  return { overlaps, aabbCandidates, satChecks };
}

function boxReport(box) {
  return { entryKey: box.key, motionId: box.id, cell: box.cell, center: roundVector(box.center),
    dimensions: box.dimensions.map(round), aabb: { min: roundVector(box.aabb.min), max: roundVector(box.aabb.max) },
    matrix: box.matrix.elements.map(round) };
}

function cloneRoute(route) {
  return route ? { segment: route.segment, core: route.core, resident: route.resident,
    hasArray: route.hasArray, hasMatrix: route.hasMatrix,
    arrayCell: route.arrayCell ? { lane: route.arrayCell.lane, row: route.arrayCell.row } : null } : null;
}

function makePoseSnapshot(flight, context) {
  const { transition, sourceCamera, targetCamera } = flight;
  const camera = sourceCamera.camera.clone(), renderedAim = sourceCamera.aim.clone();
  transition.applyCamera(camera, renderedAim, targetCamera.position, targetCamera.aim, targetCamera.span);
  camera.updateMatrixWorld(true);
  const frame = transition.frame;
  const q = Number(frame.q), qVelocity = Number(frame.qVelocity);
  const expectedRise = deploymentStep(q, .2, 1);
  const expectedGroundY = THREE.MathUtils.lerp(-4.63, ARRAY_GROUND_Y, 1 - deploymentStep(q, .65, .95));
  flight.counts.samples++;
  flight.qRange.min = Math.min(flight.qRange.min, q);
  flight.qRange.max = Math.max(flight.qRange.max, q);
  flight.qRange.maxAbsVelocity = Math.max(flight.qRange.maxAbsVelocity, Math.abs(qVelocity));
  if (!Number.isFinite(q) || q < -Q_BOUND || q > 1 + Q_BOUND)
    addError(flight.errors, { context, reason: "q outside canonical bounds", q: round(q), bound: Q_BOUND });
  if (!Number.isFinite(qVelocity) || Math.abs(qVelocity) > VELOCITY_LIMIT + 1e-7)
    addError(flight.errors, { context, reason: "q velocity exceeds .44", q: round(q), qVelocity: round(qVelocity) });
  if (Math.abs(Number(frame.extraRise) - expectedRise) > 1e-8)
    addError(flight.errors, { context, reason: "extraRise is not the independent .2-to-1 vertical phase",
      q: round(q), actual: round(frame.extraRise), expected: round(expectedRise) });
  if (Math.abs(Number(frame.groundY) - expectedGroundY) > 1e-8)
    addError(flight.errors, { context, reason: "groundY does not follow the floor phase",
      q: round(q), actual: round(frame.groundY), expected: round(expectedGroundY) });

  const instances = [], boxes = [];
  let visibleCount = 0, residentCount = 0, mOnlyCount = 0, mOnlyOffscreenCount = 0;
  for (const cell of flight.plan) {
    const id = transition.occurrenceId(cell);
    if (!id || !cell.foobarEntryKey) continue;
    const selected = transition.isSelected(cell);
    const targetCell = flight.targetBySignature.get(signature(cell));
    const matrix = selected ? layoutMatrix(flight.targetMode, flight.targetSelected, flight.targetSelected,
      flight.targetAnchor, true) : layoutMatrix(flight.targetMode, targetCell ?? cell, flight.targetSelected, flight.targetAnchor, false);
    transition.apply(matrix, cell, selected);
    const route = transition.routeFor(cell);
    const appearance = transition.appearance(cell, { alpha: 1, tint: 0 });
    const alpha = Number(appearance?.alpha);
    const scale = matrixScale(matrix);
    const unitScale = scale.every(value => Number.isFinite(value) && Math.abs(value - 1) <= 1e-6);
    const projection = projectBox(matrix, camera);
    const box = makeObb(matrix, cell);
    if (!route) addError(flight.errors, { context, reason: "motion id has no route metadata", id, entry: cell.foobarEntryKey });
    if (!unitScale) {
      flight.counts.scaleFailures++;
      addError(flight.errors, { context, reason: "case scale is not one", id, q: round(q), scale: scale.map(round) });
    }
    if (!Number.isFinite(alpha) || alpha <= .001) {
      flight.counts.alphaFailures++;
      addError(flight.errors, { context, reason: "case alpha hides geometry", id, q: round(q), alpha });
    }
    if (route) {
      const arrayCell = route.arrayCell;
      const arrayKey = cellKey(arrayCell);
      if (typeof route.resident !== "boolean" || typeof route.hasArray !== "boolean" ||
          typeof route.hasMatrix !== "boolean" || route.core !== route.resident || route.hasArray !== route.resident || !arrayKey)
        addError(flight.errors, { context, reason: "resident/endpoint route contract mismatch", id, entry: cell.foobarEntryKey, route: cloneRoute(route) });
      const routeState = `${route.resident}|${route.hasArray}|${route.hasMatrix}|${arrayKey}`;
      const previousRoute = flight.routeById.get(id);
      if (previousRoute != null && previousRoute !== routeState)
        addError(flight.errors, { context, reason: "fixed route or arrayCell changed", id, before: previousRoute, after: routeState });
      else flight.routeById.set(id, routeState);
      if (route.resident) {
        residentCount++;
        const canonical = flight.scenario.arrayCatalog.get(cell.foobarEntryKey);
        if (!canonical || canonical.lane !== arrayCell.lane || canonical.row !== arrayCell.row)
          addError(flight.errors, { context, reason: "resident arrayCell differs from the canonical 20-slot address",
            id, entry: cell.foobarEntryKey, routeArrayCell: arrayCell, canonical });
      }
      if (route.resident === false && route.hasArray === false && route.hasMatrix === true) {
        mOnlyCount++;
        if (!Number.isFinite(alpha) || Math.abs(alpha - 1) > 1e-6)
          addError(flight.errors, { context, reason: "M-only loop copy uses opacity masking", id, q: round(q), alpha });
        if (!unitScale) addError(flight.errors, { context, reason: "M-only loop copy uses scale masking", id, q: round(q), scale: scale.map(round) });
        if (!projection.visible) mOnlyOffscreenCount++;
      }
    }
    if (!projection.positiveDepth) {
      flight.counts.positiveDepthFailures++;
      addError(flight.errors, { context, reason: "case bbox is outside positive camera depth", id, q: round(q),
        depthMin: round(projection.depthMin), depthMax: round(projection.depthMax), near: camera.near, far: camera.far });
    }
    if (projection.visible) visibleCount++;
    if (box && alpha > .001) boxes.push(box);
    instances.push({ id, entry: cell.foobarEntryKey, cell: { lane: cell.lane, row: cell.row }, selected,
      route: cloneRoute(route), arrayCellKey: cellKey(route?.arrayCell), alpha, scale: scale.map(round),
      matrix: matrix.toArray(), projection, aabb: box ? { min: box.aabb.min.toArray(), max: box.aabb.max.toArray() } : null });
  }
  const checks = broadphaseAndSat(boxes);
  flight.counts.aabbCandidates += checks.aabbCandidates;
  flight.counts.satChecks += checks.satChecks;
  flight.counts.visiblePeak = Math.max(flight.counts.visiblePeak, visibleCount);
  flight.counts.residentPeak = Math.max(flight.counts.residentPeak, residentCount);
  flight.counts.mOnlyPeak = Math.max(flight.counts.mOnlyPeak, mOnlyCount);
  for (const overlap of checks.overlaps) {
    const pairKey = [overlap.a.id, overlap.b.id].sort().join("||");
    const previous = flight.collisions.get(pairKey) ?? { samples: 0, maximumPenetration: 0, worst: null };
    previous.samples++;
    if (overlap.penetration > previous.maximumPenetration) {
      previous.maximumPenetration = overlap.penetration;
      previous.worst = { context, q: round(q), penetration: round(overlap.penetration),
        a: boxReport(overlap.a), b: boxReport(overlap.b) };
    }
    flight.collisions.set(pairKey, previous);
  }
  const snapshot = { context, q, qVelocity, progress: Number(frame.progress), desiredEnd: Number(frame.desiredEnd),
    heading: Number(frame.heading), rowSpacing: Number(frame.rowSpacing), path: frame.path, prepared: frame.prepared,
    extraRise: Number(frame.extraRise), groundY: Number(frame.groundY), rowOffsets: frame.rowOffsets,
    settled: transition.settled, visibleCount, residentCount, mOnlyCount, mOnlyOffscreenCount,
    boxCount: boxes.length, collisions: checks.overlaps.length, instances };
  if (Math.abs(q) <= 1e-7) flight.endpointSnapshots.set(0, snapshot);
  if (Math.abs(q - 1) <= 1e-7) flight.endpointSnapshots.set(1, snapshot);
  if (Math.abs(q) <= 1e-7) flight.arrayEndpointFrame = snapshot;
  if (Math.abs(q - 1) <= 1e-7) flight.matrixEndpointFrame = snapshot;
  flight.lastSnapshot = snapshot;
  if (flight.endpointMatrices) checkDirectPose(flight, snapshot);
  else flight.bootstrapFrames.push(snapshot);
  return snapshot;
}

function decompose(matrixArray) {
  const matrix = new THREE.Matrix4().fromArray(matrixArray);
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

function directPoseMatrix(q0Array, q1Array, selectedQ0Array, selectedQ1Array, q, heading, extra = false) {
  const amount = deploymentStep(q);
  const a = decompose(q0Array), b = decompose(q1Array);
  const selectedA = decompose(selectedQ0Array), selectedB = decompose(selectedQ1Array);
  const position = a.position.clone().lerp(b.position, amount);
  if (extra) position.y = THREE.MathUtils.lerp(a.position.y, b.position.y, deploymentStep(q, .2, 1));
  const rotation = a.rotation.clone().slerp(b.rotation, amount);
  const scale = a.scale.clone().lerp(b.scale, amount);
  const pivot = selectedA.position.clone().lerp(selectedB.position, amount);
  const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  position.sub(pivot).applyQuaternion(yaw).add(pivot);
  if (!extra) position.y += .28 * deploymentStep(q, 0, .06) * (1 - deploymentStep(q, .65, .9));
  rotation.premultiply(yaw);
  return new THREE.Matrix4().compose(position, rotation, scale);
}

function checkDirectPose(flight, snapshot) {
  const endpoint = flight.endpointMatrices;
  if (!endpoint) return;
  const amount = deploymentStep(snapshot.q);
  const expectedHeading = THREE.MathUtils.degToRad(10) * Math.sin(Math.PI * amount);
  const expectedRowSpacing = THREE.MathUtils.lerp(ARRAY_ROW_SPACING, MATRIX_ROW_SPACING, amount);
  const headingError = Math.abs(snapshot.heading - expectedHeading);
  const rowSpacingError = Math.abs(snapshot.rowSpacing - expectedRowSpacing);
  flight.directPose.headingMaxError = Math.max(flight.directPose.headingMaxError, headingError);
  flight.directPose.rowSpacingMaxError = Math.max(flight.directPose.rowSpacingMaxError, rowSpacingError);
  if (headingError > 1e-7) addError(flight.errors, { context: snapshot.context, reason: "heading is not a direct q function",
    q: round(snapshot.q), actual: snapshot.heading, expected: expectedHeading });
  if (rowSpacingError > 1e-7) addError(flight.errors, { context: snapshot.context, reason: "row spacing is not a direct q function",
    q: round(snapshot.q), actual: snapshot.rowSpacing, expected: expectedRowSpacing });
  for (const instance of snapshot.instances) {
    const pair = endpoint.byId.get(instance.id);
    if (!pair) {
      addError(flight.errors, { context: snapshot.context, reason: "fixed motion id is missing an endpoint pose", id: instance.id });
      continue;
    }
    const extra = instance.route?.resident === false;
    const expected = directPoseMatrix(pair.q0, pair.q1, endpoint.selectedQ0, endpoint.selectedQ1,
      snapshot.q, snapshot.heading, extra);
    const actual = new THREE.Matrix4().fromArray(instance.matrix);
    const error = matrixError(actual, expected);
    flight.directPose.samples++;
    if (extra) {
      flight.directPose.extraSamples++;
      flight.directPose.extraMaxError = Math.max(flight.directPose.extraMaxError, error);
    }
    if (error > flight.directPose.maxError) {
      flight.directPose.maxError = error;
      flight.directPose.worst = { q: round(snapshot.q), id: instance.id, entry: instance.entry, error: round(error) };
    }
    if (error > DIRECT_POSE_TOLERANCE)
      addError(flight.errors, { context: snapshot.context,
        reason: extra ? "extra matrix differs from eased XZ and independent vertical-rise path" : "resident matrix differs from ease(q)+heading+lift path",
        q: round(snapshot.q), id: instance.id, entry: instance.entry, error: round(error) });
  }
}

function initializeEndpointMatrices(flight) {
  const q0 = flight.endpointSnapshots.get(0), q1 = flight.endpointSnapshots.get(1);
  if (!q0 || !q1) {
    addError(flight.errors, { reason: "canonical q=0 and q=1 geometry endpoints were not both captured",
      hasQ0: !!q0, hasQ1: !!q1 });
    return;
  }
  const q0ById = new Map(q0.instances.map(instance => [instance.id, instance]));
  const q1ById = new Map(q1.instances.map(instance => [instance.id, instance]));
  const selected0 = q0.instances.find(instance => instance.selected);
  const selected1 = q1.instances.find(instance => instance.selected);
  if (!selected0 || !selected1 || selected0.id !== selected1.id)
    addError(flight.errors, { reason: "selected hero motion id changes between canonical endpoints",
      selectedQ0: selected0?.id ?? null, selectedQ1: selected1?.id ?? null });
  const byId = new Map();
  for (const [id, instance0] of q0ById) {
    const instance1 = q1ById.get(id);
    if (!instance1) {
      addError(flight.errors, { reason: "motion id is missing from q=1 endpoint", id });
      continue;
    }
    byId.set(id, { q0: instance0.matrix, q1: instance1.matrix,
      entry: instance0.entry, route: instance0.route, arrayCellKey: instance0.arrayCellKey });
  }
  for (const id of q1ById.keys()) if (!q0ById.has(id))
    addError(flight.errors, { reason: "motion id is missing from q=0 endpoint", id });
  flight.endpointMatrices = { byId, selectedQ0: selected0?.matrix, selectedQ1: selected1?.matrix,
    selectedId: selected0?.id ?? null };
  for (const snapshot of flight.bootstrapFrames) checkDirectPose(flight, snapshot);
  flight.bootstrapFrames = [];
}

function routeStableSnapshot(before, after) {
  const right = new Map(after.instances.map(instance => [instance.id, instance]));
  let matched = 0, missing = [], maxMatrixDelta = 0;
  for (const instance of before.instances) {
    const next = right.get(instance.id);
    if (!next) { missing.push(instance.id); continue; }
    matched++;
    const delta = Math.max(...instance.matrix.map((value, index) => Math.abs(value - next.matrix[index])));
    maxMatrixDelta = Math.max(maxMatrixDelta, delta);
  }
  return { matched, missing, maxMatrixDelta };
}

function recordArrayEndpointAudit(flight) {
  const endpoint = flight.arrayEndpointFrame;
  if (!endpoint) {
    addError(flight.errors, { reason: "ARRAY q=0 endpoint was not sampled" });
    return { ok: false, reason: "missing q=0 frame" };
  }
  const residents = endpoint.instances.filter(item => item.route?.resident === true);
  const lanes = [...new Set(residents.map(item => Number(item.route?.arrayCell?.lane)).filter(Number.isFinite))].sort((a, b) => a - b);
  const extras = endpoint.instances.filter(item => item.route?.resident === false &&
    item.route?.hasArray === false && item.route?.hasMatrix === true);
  const extraFacts = extras.map(item => {
    const bounds = item.aabb ? new THREE.Box3(new THREE.Vector3().fromArray(item.aabb.min),
      new THREE.Vector3().fromArray(item.aabb.max)) : new THREE.Box3();
    return { id: item.id, entry: item.entry, arrayCell: item.route.arrayCell, alpha: item.alpha,
      unitScale: item.scale.every(value => Math.abs(value - 1) <= 1e-6),
      positiveDepth: item.projection.positiveDepth,
      belowGround: bounds.max.y < endpoint.groundY - .239,
      verticalClearance: round(endpoint.groundY - bounds.max.y),
      bounds: { min: roundVector(bounds.min), max: roundVector(bounds.max) } };
  });
  const ok = residents.length === flight.scenario.count && lanes.length >= 2 && extras.length > 0 &&
    extraFacts.every(item => item.alpha != null && Math.abs(item.alpha - 1) <= 1e-6 && item.unitScale &&
      item.positiveDepth && item.belowGround);
  if (!ok) addError(flight.errors, { reason: "ARRAY endpoint does not keep canonical residents and fully buried M-only copies",
    residentCount: residents.length, expectedResidents: flight.scenario.count, residentLanes: lanes,
    mOnlyCount: extras.length, mOnlyFailures: extraFacts.filter(item => !(item.alpha != null && Math.abs(item.alpha - 1) <= 1e-6 &&
      item.unitScale && item.positiveDepth && item.belowGround)).slice(0, 10) });
  return { ok, residentCount: residents.length, expectedResidents: flight.scenario.count, residentLanes: lanes,
    mOnlyCount: extras.length, mOnlyBelowGroundCount: extraFacts.filter(item => item.belowGround).length,
    minimumVerticalClearance: extraFacts.length ? Math.min(...extraFacts.map(item => item.verticalClearance)) : null,
    mOnlySamples: extraFacts.slice(0, 24) };
}

function advanceUntil(flight, predicate, label, phase) {
  let frames = 0;
  while (!predicate() && frames < MAX_PHASE_FRAMES) {
    flight.transition.advance(STEP);
    makePoseSnapshot(flight, label);
    frames++;
    flight.phaseFrames[phase]++;
  }
  if (!predicate()) addError(flight.errors, { reason: "transition did not reach requested state within 10 seconds",
    label, q: round(flight.transition.frame.q), qVelocity: round(flight.transition.frame.qVelocity) });
  return frames;
}

function retargetAndCheck(flight, destinationToShelf, label) {
  const before = makePoseSnapshot(flight, `${label}:before`);
  const q = flight.transition.frame.q, qVelocity = flight.transition.frame.qVelocity;
  const accepted = flight.transition.retarget(destinationToShelf);
  if (!accepted) addError(flight.errors, { reason: "retarget was rejected", label, destinationToShelf });
  if (flight.transition.frame.q !== q || flight.transition.frame.qVelocity !== qVelocity)
    addError(flight.errors, { reason: "retarget changed q or qVelocity immediately", label,
      before: { q, qVelocity }, after: { q: flight.transition.frame.q, qVelocity: flight.transition.frame.qVelocity } });
  const after = makePoseSnapshot(flight, `${label}:after`);
  const continuity = routeStableSnapshot(before, after);
  if (continuity.matched !== before.instances.length || continuity.missing.length > 0 ||
      continuity.maxMatrixDelta > MATRIX_CONTINUITY_TOLERANCE)
    addError(flight.errors, { reason: "continuous retarget changed a case pose or motion id", label, continuity });
  return { label, accepted, q: round(q), qVelocity: round(qVelocity), continuity };
}

function runRetargetSequence(flight) {
  const sourceQ = flight.sourceMode === "array" ? 0 : 1;
  const sourceToShelf = flight.sourceMode === "array";
  const targetToShelf = flight.targetMode === "array";
  const progress = () => sourceQ === 0 ? flight.transition.frame.q : 1 - flight.transition.frame.q;
  const checks = [];
  checks.push(retargetAndCheck(flight, targetToShelf, "retarget-start-to-target"));
  advanceUntil(flight, () => progress() >= .36, "retarget-first-leg-q=.36", "retarget");
  checks.push(retargetAndCheck(flight, sourceToShelf, "retarget-reverse-1"));
  advanceUntil(flight, () => progress() <= .31, "retarget-return-q=.31", "retarget");
  checks.push(retargetAndCheck(flight, targetToShelf, "retarget-reverse-2"));
  advanceUntil(flight, () => progress() >= .43, "retarget-third-leg-q=.43", "retarget");
  checks.push(retargetAndCheck(flight, sourceToShelf, "retarget-reverse-3"));
  advanceUntil(flight, () => flight.transition.settled, "retarget-final-source-settle", "retarget");
  if (!flight.transition.settled || Math.abs(flight.transition.frame.q - sourceQ) > Q_BOUND)
    addError(flight.errors, { reason: "multi-reversal sequence did not settle at its source endpoint",
      sourceQ, q: round(flight.transition.frame.q), qVelocity: round(flight.transition.frame.qVelocity) });
  return checks;
}

function runFlightScenario(scenario, sourceMode, targetMode) {
  const flight = makeFlight(scenario, sourceMode, targetMode);
  const sourceQ = sourceMode === "array" ? 0 : 1;
  const targetQ = targetMode === "array" ? 0 : 1;
  const sourceToShelf = sourceMode === "array";
  const targetToShelf = targetMode === "array";
  const initialPlanIds = [...flight.fixedIds];
  const initial = makePoseSnapshot(flight, "source-endpoint");
  const sourceEndpointErrors = [];
  if (Math.abs(initial.q - sourceQ) > Q_BOUND)
    sourceEndpointErrors.push({ reason: "flight did not start at canonical source q", expected: sourceQ, actual: initial.q });

  advanceUntil(flight, () => flight.transition.settled, "outward-flight", "outward");
  const target = flight.lastSnapshot;
  if (!flight.transition.settled || Math.abs(flight.transition.frame.q - targetQ) > Q_BOUND)
    addError(flight.errors, { reason: "outward flight did not settle at the target endpoint",
      targetQ, q: round(flight.transition.frame.q) });
  if (flight.transition.endpointSelection?.foobarEntryKey !== scenario.selectedKey)
    addError(flight.errors, { reason: "outward endpoint changed selected catalog identity",
      expected: scenario.selectedKey, actual: flight.transition.endpointSelection });

  initializeEndpointMatrices(flight);
  const arrayEndpointAudit = recordArrayEndpointAudit(flight);

  const reverseEvent = retargetAndCheck(flight, sourceToShelf, "reverse-to-source");
  advanceUntil(flight, () => flight.transition.settled, "return-flight", "return");
  const returned = flight.lastSnapshot;
  if (!flight.transition.settled || Math.abs(flight.transition.frame.q - sourceQ) > Q_BOUND)
    addError(flight.errors, { reason: "reverse flight did not settle at its source endpoint",
      sourceQ, q: round(flight.transition.frame.q) });
  if (flight.transition.endpointSelection?.foobarEntryKey !== scenario.selectedKey)
    addError(flight.errors, { reason: "reverse endpoint changed selected catalog identity",
      expected: scenario.selectedKey, actual: flight.transition.endpointSelection });

  const retargetChecks = runRetargetSequence(flight);
  if (flight.fixedIds.length !== initialPlanIds.length || flight.fixedIds.some((id, index) => id !== initialPlanIds[index]))
    addError(flight.errors, { reason: "motionId plan changed during flight or retarget" });
  const collisions = [...flight.collisions.entries()].sort((a, b) => b[1].maximumPenetration - a[1].maximumPenetration)
    .map(([key, value]) => ({ key, samples: value.samples, maximumPenetration: round(value.maximumPenetration), worst: value.worst }));
  const residentLanes = [...new Set((flight.arrayEndpointFrame?.instances ?? [])
    .filter(item => item.route?.resident === true)
    .map(item => Number(item.route?.arrayCell?.lane)).filter(Number.isFinite))].sort((a, b) => a - b);
  const retargetErrors = flight.errors.filter(error => /retarget|reversal/i.test(String(error.reason ?? "")) ||
    /retarget/i.test(String(error.context ?? "")));
  return {
    fixture: { name: scenario.name, groupLengths: scenario.groupLengths, albumCount: scenario.count,
      canonicalArrayRowsPerColumn: ARRAY_ROWS, arrayColumnCount: Math.ceil(scenario.count / ARRAY_ROWS),
      selectedEntry: scenario.selectedKey },
    direction: `${sourceMode}->${targetMode}`, canonicalQ: { source: sourceQ, target: targetQ },
    matrixPool: { lanes: MATRIX_LANES, rows: MATRIX_ROWS, activeRowsPerLane: MATRIX_WINDOW_ROWS,
      sourceCells: flight.sourceCells.length, targetCells: flight.targetActiveCells.length,
      planItems: flight.fixedIds.length },
    selection: { source: flight.sourceSelected, target: flight.targetSelected,
      sourceSelectedLift: sourceMode === "array" ? ARRAY_SELECTED_LIFT : MATRIX_SELECTED_LIFT,
      targetSelectedLift: targetMode === "array" ? ARRAY_SELECTED_LIFT : MATRIX_SELECTED_LIFT },
    sampling: { stepSeconds: STEP, phaseFrames: flight.phaseFrames, totalSamples: flight.counts.samples,
      qRange: [round(flight.qRange.min), round(flight.qRange.max)],
      maximumAbsoluteQVelocity: round(flight.qRange.maxAbsVelocity),
      visibleBoxPeak: flight.counts.visiblePeak, residentPeak: flight.counts.residentPeak,
      mOnlyPeak: flight.counts.mOnlyPeak, satChecks: flight.counts.satChecks,
      aabbCandidates: flight.counts.aabbCandidates, positiveDepthFailures: flight.counts.positiveDepthFailures,
      scaleFailures: flight.counts.scaleFailures, alphaFailures: flight.counts.alphaFailures },
    resident: { lanes: residentLanes, expectedAtLeastTwoColumns: residentLanes.length >= 2,
      directPoseSamples: flight.directPose.samples, maximumDirectPoseError: round(flight.directPose.maxError),
      extraDirectPoseSamples: flight.directPose.extraSamples, maximumExtraDirectPoseError: round(flight.directPose.extraMaxError),
      worstDirectPose: flight.directPose.worst, maximumHeadingError: flight.directPose.headingMaxError,
      maximumRowSpacingError: flight.directPose.rowSpacingMaxError },
    arrayLoopEndpoint: arrayEndpointAudit,
    retarget: { reverseToSource: reverseEvent, midflightReversals: retargetChecks, errors: retargetErrors },
    endpointErrors: sourceEndpointErrors,
    geometryErrors: flight.errors,
    collisions: { uniquePairs: collisions.length, pairs: collisions.slice(0, 20) },
    endpoints: { sourceQ: round(initial.q), targetQ: round(target?.q), returnedQ: round(returned?.q),
      bothEndpointsCaptured: flight.endpointMatrices?.byId.size === flight.fixedIds.length,
      fixedMotionIds: flight.fixedIds.length },
  };
}

async function main() {
  const scenarios = [];
  for (const spec of scenariosToRun) {
    const scenario = makeScenario(spec);
    scenarios.push(runFlightScenario(scenario, "array", "matrix"));
    scenarios.push(runFlightScenario(scenario, "matrix", "array"));
  }
  const report = {
    generatedAt: new Date().toISOString(),
    contract: {
      implementation: "src/music-layout-flight.ts MusicLayoutTransition",
      canonicalArray: { rowsPerColumn: ARRAY_ROWS, fixtures: scenariosToRun.map(item => item.groupLengths),
        packing: "global catalog order; lane=floor(order/20), row=order%20" },
      matrixPool: { lanes: MATRIX_LANES, rows: MATRIX_ROWS, activeRowsPerLane: MATRIX_WINDOW_ROWS },
      path: "direct deploymentStep(q) endpoint pose mix, selected-anchor heading rotation, and q-based lift",
      qBounds: [-Q_BOUND, 1 + Q_BOUND], qVelocityLimit: VELOCITY_LIMIT,
      caseBounds: { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray(), dimensions: CASE_SIZE.toArray() },
      collisionMethod: "current-frame AABB broadphase followed by 15-axis OBB separating-axis test on the full transformed CASE_BOUNDS",
      cameraDepth: "production flight camera endpoints; every sampled case bbox is checked against camera near/far depth",
      loopCopies: "M-only copies remain unit-scale and alpha one; their ARRAY endpoint is a standard ARRAY lattice position with the full case bbox below the floor, then rises by extraRise",
    },
    scenarios,
    summary: {
      scenarios: scenarios.length,
      fixtures: scenariosToRun.length,
      directions: scenarios.length,
      sampleFrames: scenarios.reduce((sum, item) => sum + item.sampling.totalSamples, 0),
      uniqueCollisionPairs: scenarios.reduce((sum, item) => sum + item.collisions.uniquePairs, 0),
      collisionSamples: scenarios.reduce((sum, item) => sum + item.collisions.pairs.reduce((total, pair) => total + pair.samples, 0), 0),
      geometryErrors: scenarios.reduce((sum, item) => sum + item.geometryErrors.length + item.endpointErrors.length, 0),
      retargetEvents: scenarios.reduce((sum, item) => sum + item.retarget.midflightReversals.length, 0),
      retargetErrors: scenarios.reduce((sum, item) => sum + item.retarget.errors.length, 0),
      qVelocityLimit: VELOCITY_LIMIT,
      worstPenetration: Math.max(0, ...scenarios.flatMap(item => item.collisions.pairs.map(pair => pair.maximumPenetration))),
    },
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ outputPath: OUTPUT_PATH, summary: report.summary,
    scenarios: scenarios.map(item => ({ fixture: item.fixture.name, direction: item.direction,
      residentLanes: item.resident.lanes, samples: item.sampling.totalSamples,
      maxAbsVelocity: item.sampling.maximumAbsoluteQVelocity,
      maxDirectPoseError: item.resident.maximumDirectPoseError,
      arrayEndpoint: { residents: item.arrayLoopEndpoint.residentCount, mOnly: item.arrayLoopEndpoint.mOnlyCount,
        belowGround: item.arrayLoopEndpoint.mOnlyBelowGroundCount,
        minimumVerticalClearance: item.arrayLoopEndpoint.minimumVerticalClearance },
      geometryErrors: item.geometryErrors.length, collisions: item.collisions.uniquePairs })) }, null, 2));
  if (report.summary.geometryErrors > 0 || report.summary.uniqueCollisionPairs > 0 || report.summary.retargetErrors > 0)
    process.exitCode = 1;
}

await main();
