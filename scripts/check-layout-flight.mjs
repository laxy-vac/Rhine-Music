import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicLayoutTransition } from "../src/music-layout-transition.ts";
import { deploymentStep } from "../src/music-shelf-deployment.ts";
import { musicArrayCompositionFrame, musicMatrixOverviewSpan, musicMatrixResidentFrame } from "../src/music-layout-framing.ts";
import { MUSIC_MATRIX_VIEW } from "../src/music-display-layout.ts";

const CENTER = new THREE.Vector3(0, 1.85, 0);
const CASE_BOUNDS = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
const CASE_BOUND_ARRAYS = { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() };
const ARRAY_OVERVIEW_SPAN = musicArrayCompositionFrame(1920, 1080, 1100, .8, -1, CASE_BOUND_ARRAYS, CENTER, false).effectiveSpan;
const MATRIX_OVERVIEW_SPAN = musicMatrixOverviewSpan(ARRAY_OVERVIEW_SPAN);
const RACK_BOUNDS = new THREE.Box3(new THREE.Vector3(-12, -4.425, -18), new THREE.Vector3(12, -.425, 18));
const GRID_COLUMNS = 3;
const GRID_ROWS = 20;
const GRID_FIRST_ROW = 12;

function latticeOffsets(rows) {
  return Array.from({ length: GRID_COLUMNS }, (_, column) =>
    Array.from({ length: rows }, (_, row) => [
      column === 1 && row % GRID_ROWS === 10 ? "hero" : `entry-${column}-${row % GRID_ROWS}`,
      column - 1,
      row - 10,
    ])).flat();
}

const ARRAY = {
  selected: { lane: 2, row: GRID_FIRST_ROW + 10, foobarEntryKey: "hero" },
  spacing: { column: -4.95, row: -1 }, anchor: new THREE.Vector3(0, -2.502, 0),
  aim: new THREE.Vector3(0, -2.502, 0), yaw: -38, elevation: 35, distance: 140, span: 38,
  offsets: latticeOffsets(GRID_ROWS),
};
const MATRIX = {
  selected: { lane: 4, row: GRID_FIRST_ROW + 20 + 10, foobarEntryKey: "hero" },
  spacing: { column: -5.2, row: -.62 }, anchor: new THREE.Vector3(0, -3.25, 0),
  aim: new THREE.Vector3(0, -3.25, 0), yaw: 59, elevation: 25, distance: MUSIC_MATRIX_VIEW.distance, span: 50,
  offsets: latticeOffsets(GRID_ROWS * 2),
};
const STEP = 1 / 120;
const MAX_FRAMES = 50000;

function close(actual, expected, epsilon = 1e-6) {
  assert.ok(Number.isFinite(actual), `expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function matrixAt(position, scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Quaternion()) {
  return new THREE.Matrix4().compose(position.clone(), rotation.clone(), scale.clone());
}

function matrixPosition(matrix) { return new THREE.Vector3().setFromMatrixPosition(matrix); }

function yawQuaternion(angle) { return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle); }

function basisLengths(matrix) {
  const e = matrix.elements;
  return [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
}

function outward(mode) {
  const yaw = THREE.MathUtils.degToRad(mode.yaw), elevation = THREE.MathUtils.degToRad(mode.elevation);
  return new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
}

function cameraEnd(mode) {
  const camera = new THREE.PerspectiveCamera(34, 16 / 10, 5, 300);
  const position = mode.aim.clone().addScaledVector(outward(mode), mode.distance);
  camera.position.copy(position);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(mode.span / (2 * mode.distance)));
  camera.lookAt(mode.aim);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { camera, position, aim: mode.aim.clone(), span: mode.span };
}

function endpointCell(mode, key, laneOffset, rowOffset) {
  return { lane: mode.selected.lane + laneOffset, row: mode.selected.row + rowOffset, foobarEntryKey: key };
}

function sameCell(a, b) { return a.lane === b.lane && a.row === b.row; }

function endpointMatrix(mode, cell, selected = false) {
  const position = mode.anchor.clone().add(new THREE.Vector3(
    (cell.lane - mode.selected.lane) * mode.spacing.column, 0,
    (cell.row - mode.selected.row) * mode.spacing.row,
  ));
  if (!selected) position.y = -4.55;
  return matrixAt(position);
}

function modeCells(mode) {
  return mode.offsets.map(([key, lane, row]) => endpointCell(mode, key, lane, row));
}

function actorId(cell, selected) {
  return `${cell.foobarEntryKey}|${cell.lane - selected.lane}|${cell.row - selected.row}`;
}

function cellSignature(cell) {
  return `${cell.foobarEntryKey}|${cell.lane}|${cell.row}`;
}

function makeFlight(sourceName, targetName, { alignmentLift = 0 } = {}) {
  const sourceMode = sourceName === "array" ? ARRAY : MATRIX;
  const targetMode = targetName === "array" ? ARRAY : MATRIX;
  const sourceSelected = { ...sourceMode.selected };
  const targetSelected = { ...targetMode.selected };
  const sourceCells = modeCells(sourceMode);
  const targetCells = modeCells(targetMode);
  const sourceById = new Map(sourceCells.map(cell => [actorId(cell, sourceSelected), cell]));
  const targetBySignature = new Map(targetCells.filter(cell => cell.foobarEntryKey)
    .map(cell => [cellSignature(cell), cell]));
  const targetByRelative = new Map(targetCells.filter(cell => cell.foobarEntryKey)
    .map(cell => [actorId(cell, targetSelected), cell]));
  const sourceSelectedRestMatrix = endpointMatrix(sourceMode, sourceSelected, true);
  const sourceSelectedMatrix = sourceSelectedRestMatrix.clone();
  if (alignmentLift) {
    const position = matrixPosition(sourceSelectedMatrix);
    position.y += alignmentLift;
    sourceSelectedMatrix.setPosition(position);
  }
  const sourceCamera = cameraEnd(sourceMode);
  const sourceSamples = sourceCells.map(cell => {
    const selected = sameCell(cell, sourceSelected) && cell.foobarEntryKey === sourceSelected.foobarEntryKey;
    const restMatrix = selected ? sourceSelectedRestMatrix.clone() : endpointMatrix(sourceMode, cell);
    const matrix = selected ? sourceSelectedMatrix.clone() : restMatrix.clone();
    if (alignmentLift && !selected && cell.lane === sourceSelected.lane && cell.row === sourceSelected.row + 1) {
      const position = matrixPosition(matrix);
      position.y += alignmentLift;
      matrix.setPosition(position);
    }
    return { cell: { ...cell, motionId: actorId(cell, sourceSelected) }, matrix, restMatrix, alpha: 1, tint: 0 };
  });
  const sourceSampleById = new Map(sourceSamples.map(sample => [sample.cell.motionId, sample]));
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetName === "array", 4.45, -4.6, Number(sourceName === "array"), new Map(), CENTER,
    sourceSelectedRestMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetBySignature.has(cellSignature(cell)), new Map());
  transition.prepareTarget(matrixPosition(endpointMatrix(targetMode, targetSelected, true)));
  const targetMatrices = new Map();
  for (const cell of plan) {
    const target = targetBySignature.get(cellSignature(cell));
    const matrix = endpointMatrix(targetMode, target ?? cell, transition.isSelected(cell));
    if (target) targetMatrices.set(cellSignature(target), matrix.clone());
    transition.primeTarget(cell, matrix, transition.isSelected(cell));
  }
  assert.equal(transition.targetsReady, true, "the render-like priming pass must cache selected and target poses");
  const targetCamera = cameraEnd(targetMode);
  const camera = sourceCamera.camera.clone();
  const aim = sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, targetCamera.position, targetCamera.aim, targetCamera.span);
  return { transition, sourceName, targetName, sourceMode, targetMode, sourceSelected, targetSelected, sourceSamples,
    sourceById, sourceSampleById, targetBySignature, targetByRelative,
    sourceCamera, targetCamera, camera, aim, plan, targetMatrices };
}

function advanceToQ(flight, targetQ, epsilon = .00004) {
  const transition = flight.transition;
  const increasing = transition.frame.desiredEnd === 1;
  let frames = 0;
  while (Math.abs(transition.frame.q - targetQ) > epsilon && frames < MAX_FRAMES) {
    const before = transition.frame.q;
    const speed = Math.max(Math.abs(transition.frame.qVelocity), .05);
    const dt = Math.min(1 / 10000, Math.max(1e-7, Math.abs(targetQ - before) / speed));
    transition.advance(dt);
    frames++;
    if (transition.settled || (increasing ? transition.frame.q > targetQ + epsilon : transition.frame.q < targetQ - epsilon)) break;
    if (before === transition.frame.q && transition.settled) break;
  }
  assert.ok(Math.abs(transition.frame.q - targetQ) <= epsilon + .000001,
    `could not sample q=${targetQ}; got ${transition.frame.q}`);
  return renderState(flight);
}

function transformedCorners(matrix) {
  const result = [];
  for (const x of [CASE_BOUNDS.min.x, CASE_BOUNDS.max.x])
    for (const y of [CASE_BOUNDS.min.y, CASE_BOUNDS.max.y])
      for (const z of [CASE_BOUNDS.min.z, CASE_BOUNDS.max.z])
        result.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  return result;
}

function outsideSide(projected) {
  if (projected.every(point => point.x < -1)) return "left";
  if (projected.every(point => point.x > 1)) return "right";
  if (projected.every(point => point.y < -1)) return "bottom";
  if (projected.every(point => point.y > 1)) return "top";
  return undefined;
}

function targetMatrixForCell(flight, cell) {
  return flight.targetMatrices.get(cellSignature(cell));
}

function renderState(flight) {
  const { transition } = flight;
  const camera = flight.sourceCamera.camera.clone(), aim = flight.sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, flight.targetCamera.position, flight.targetCamera.aim, flight.targetCamera.span);
  camera.updateMatrixWorld(true);
  const matrices = new Map(), matricesById = new Map(), matricesByKey = new Map(), projected = new Map(), sides = new Map(), appearances = new Map();
  for (const cell of transition.bound ? flight.plan : []) {
    const selected = transition.isSelected(cell);
    const matrix = targetMatrixForCell(flight, cell)?.clone() ?? endpointMatrix(flight.targetMode, cell, selected);
    transition.apply(matrix, cell, selected);
    const id = transition.occurrenceId(cell) ?? cellSignature(cell);
    matrices.set(id, matrix);
    matricesById.set(id, matrix);
    if (cell.foobarEntryKey && !matricesByKey.has(cell.foobarEntryKey)) matricesByKey.set(cell.foobarEntryKey, matrix);
    appearances.set(id, transition.appearance(cell, { alpha: 1, tint: 0 }));
    const points = transformedCorners(matrix);
    const projectedPoints = points.map(point => point.clone().project(camera));
    projected.set(id, projectedPoints);
    sides.set(id, outsideSide(projectedPoints));
  }
  const rack = transition.rackTransform(RACK_BOUNDS, -4.425);
  return { camera, aim, matrices, matricesById, matricesByKey, projected, sides, appearances, rack, frame: transition.frame };
}

function moveToSettled(flight) {
  for (let frame = 0; frame < MAX_FRAMES; frame++) {
    if (flight.transition.settled) return renderState(flight);
    flight.transition.advance(STEP);
  }
  assert.fail(`flight did not settle: q=${flight.transition.frame.q}, end=${flight.transition.frame.desiredEnd}`);
}

function assertMatrixNear(actual, expected, epsilon = .04, label = "matrix") {
  for (let index = 0; index < 16; index++) {
    try { close(actual.elements[index], expected.elements[index], epsilon); }
    catch (error) { throw new Error(`${label} element ${index}: ${error.message}`); }
  }
}

function assertStartPoses(flight, state) {
  for (const sample of flight.sourceSamples) {
    const id = sample.cell.motionId;
    const selected = sameCell(sample.cell, flight.sourceSelected) && sample.cell.foobarEntryKey === flight.sourceSelected.foobarEntryKey;
    assertMatrixNear(state.matricesById.get(id), endpointMatrix(flight.sourceMode, sample.cell, selected), 1e-5,
      `source endpoint ${id}`);
  }
}

function assertTargetPoses(flight, state) {
  for (const cell of flight.plan) {
    const owner = flight.transition.endpointCell(cell);
    if (!owner) continue;
    const id = flight.transition.occurrenceId(cell);
    const expected = endpointMatrix(flight.targetMode, owner, flight.transition.isSelected(cell));
    assertMatrixNear(state.matricesById.get(id), expected, 1e-5, `target endpoint ${cellSignature(owner)}`);
  }
}

function poseOf(matrix) {
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

function arrayEndpointPose(flight, cell, cache = new Map()) {
  const id = flight.transition.occurrenceId(cell);
  const cached = cache.get(id);
  if (cached) return cached;
  const route = flight.transition.routeFor(cell);
  assert.ok(route, `route exists for ${id}`);
  const signature = `${cell.foobarEntryKey}|${route.arrayCell.lane}|${route.arrayCell.row}`;
  if (route.resident) {
    const matrix = flight.sourceName === "array"
      ? flight.sourceSampleById.get(id)?.restMatrix
      : flight.targetMatrices.get(signature);
    assert.ok(matrix, `resident ARRAY endpoint exists for ${signature}`);
    const pose = poseOf(matrix);
    cache.set(id, pose);
    return pose;
  }

  const residents = flight.plan.filter(candidate => flight.transition.routeFor(candidate)?.resident);
  const nearest = residents.sort((a, b) => {
    const left = flight.transition.routeFor(a).arrayCell, right = flight.transition.routeFor(b).arrayCell;
    return Math.abs(left.lane - route.arrayCell.lane) * 100 + Math.abs(left.row - route.arrayCell.row) -
      Math.abs(right.lane - route.arrayCell.lane) * 100 - Math.abs(right.row - route.arrayCell.row);
  })[0];
  const nearestRoute = nearest && flight.transition.routeFor(nearest);
  const reference = nearest && arrayEndpointPose(flight, nearest, cache);
  const pose = reference ? {
    position: reference.position.clone(), rotation: reference.rotation.clone(), scale: reference.scale.clone(),
  } : poseOf(endpointMatrix(ARRAY, route.arrayCell));
  const address = nearestRoute?.arrayCell ?? flight.sourceSelected;
  const arrayColumn = -Math.max(4.7, CASE_BOUNDS.getSize(new THREE.Vector3()).x + .5);
  const arrayRow = -1;
  pose.position.x += (route.arrayCell.lane - address.lane) * arrayColumn;
  pose.position.z += (route.arrayCell.row - address.row) * arrayRow;
  const lanes = residents.map(candidate => flight.transition.routeFor(candidate).arrayCell.lane);
  const firstLane = lanes.length ? Math.min(...lanes) : flight.sourceSelected.lane;
  const lastLane = lanes.length ? Math.max(...lanes) : flight.sourceSelected.lane;
  if (route.arrayCell.lane < firstLane) pose.position.x += 40;
  if (route.arrayCell.lane > lastLane) pose.position.x -= 40;
  if (route.arrayCell.row < 12) pose.position.z += 32;
  if (route.arrayCell.row > 31) pose.position.z -= 64;
  pose.scale.setScalar(1);
  cache.set(id, pose);
  return pose;
}

function matrixEndpointPose(flight, cell) {
  const route = flight.transition.routeFor(cell);
  assert.ok(route, `route exists for ${flight.transition.occurrenceId(cell)}`);
  const matrixCell = { lane: route.arrayCell.lane + MATRIX.selected.lane - ARRAY.selected.lane,
    row: route.arrayCell.row + MATRIX.selected.row - ARRAY.selected.row, foobarEntryKey: cell.foobarEntryKey };
  return poseOf(endpointMatrix(MATRIX, matrixCell, flight.transition.isSelected(cell)));
}

function expectedRelativePosition(flight, cell, q, heading, arrayPoseCache = new Map()) {
  const hero = flight.plan.find(candidate => flight.transition.isSelected(candidate));
  assert.ok(hero, "selected hero exists in the bound lattice");
  const arrayPose = arrayEndpointPose(flight, cell, arrayPoseCache);
  const matrixPose = matrixEndpointPose(flight, cell);
  const arrayHero = arrayEndpointPose(flight, hero, arrayPoseCache);
  const matrixHero = matrixEndpointPose(flight, hero);
  const blend = deploymentStep(q);
  return arrayPose.position.clone().sub(arrayHero.position)
    .lerp(matrixPose.position.clone().sub(matrixHero.position), blend)
    .applyQuaternion(yawQuaternion(heading));
}

function vectorNear(actual, expected, epsilon, label) {
  assert.ok(actual.distanceTo(expected) <= epsilon,
    `${label}: expected ${actual.toArray()} within ${epsilon} of ${expected.toArray()}`);
}

function obbFor(matrix, id) {
  const elements = matrix.elements;
  const axes = [
    new THREE.Vector3(elements[0], elements[1], elements[2]).normalize(),
    new THREE.Vector3(elements[4], elements[5], elements[6]).normalize(),
    new THREE.Vector3(elements[8], elements[9], elements[10]).normalize(),
  ];
  const scale = basisLengths(matrix), size = CASE_BOUNDS.getSize(new THREE.Vector3());
  return { id, center: matrixPosition(matrix), axes,
    half: [size.x * scale[0] / 2, size.y * scale[1] / 2, size.z * scale[2] / 2] };
}

function obbOverlaps(a, b) {
  const axes = [...a.axes, ...b.axes];
  for (const left of a.axes) for (const right of b.axes) axes.push(new THREE.Vector3().crossVectors(left, right));
  const delta = b.center.clone().sub(a.center);
  for (const raw of axes) {
    if (raw.lengthSq() < 1e-12) continue;
    const axis = raw.clone().normalize();
    const radius = (box, testAxis) => box.half.reduce((sum, half, index) => sum + half * Math.abs(testAxis.dot(box.axes[index])), 0);
    if (Math.abs(delta.dot(axis)) >= radius(a, axis) + radius(b, axis) - 1e-5) return false;
  }
  return true;
}

function assertNoCaseOverlaps(state, label) {
  const boxes = [...state.matricesById].map(([id, matrix]) => obbFor(matrix, id));
  for (let left = 0; left < boxes.length; left++) for (let right = left + 1; right < boxes.length; right++)
    assert.equal(obbOverlaps(boxes[left], boxes[right]), false,
      `${label}: ${boxes[left].id} intersects ${boxes[right].id}`);
}

function assertDirectLatticePath(flight, state) {
  const hero = flight.plan.find(cell => flight.transition.isSelected(cell));
  assert.ok(hero, "a selected actor anchors the resident lattice");
  const heroPosition = matrixPosition(state.matricesById.get(flight.transition.occurrenceId(hero)));
  const arrayPoseCache = new Map();
  for (const cell of flight.plan) {
    if (!flight.transition.routeFor(cell)) continue;
    const id = flight.transition.occurrenceId(cell);
    const actual = matrixPosition(state.matricesById.get(id)).sub(heroPosition);
    const expected = expectedRelativePosition(flight, cell, state.frame.q, state.frame.heading, arrayPoseCache);
    vectorNear(actual, expected, .025, `single deploymentStep pose for ${id} at q=${state.frame.q.toFixed(3)}`);
  }
}

function residentActorIds() {
  return new Set(modeCells(ARRAY).map(cell => actorId(cell, ARRAY.selected)));
}

function assertResidentRoutes(flight) {
  const expected = residentActorIds();
  const found = new Set();
  for (const cell of flight.plan) {
    const id = flight.transition.occurrenceId(cell), route = flight.transition.routeFor(cell);
    if (!route) continue;
    if (expected.has(id)) {
      found.add(id);
      assert.equal(route.resident, true, `${id} is a resident ARRAY slot`);
      assert.equal(route.core, true, `${id} keeps the legacy core flag as a resident alias`);
      assert.equal(route.hasArray, true, `${id} has its canonical ARRAY endpoint`);
      assert.deepEqual({ lane: route.arrayCell.lane, row: route.arrayCell.row },
        { lane: flight.sourceName === "array" ? flight.sourceById.get(id).lane : flight.targetByRelative.get(id).lane,
          row: flight.sourceName === "array" ? flight.sourceById.get(id).row : flight.targetByRelative.get(id).row },
        `${id} keeps its physical ARRAY lattice address`);
      assert.equal(route.hasMatrix, true, `${id} pairs with one MATRIX occurrence`);
    }
  }
  assert.equal(found.size, expected.size, "all three columns and twenty ARRAY rows are resident actors");
  return expected;
}

function assertAllActorsPresentAndOpaque(flight, state, label) {
  assert.equal(state.matricesById.size, flight.plan.filter(cell => flight.transition.routeFor(cell)).length,
    `${label} keeps a matrix for each bound physical occurrence`);
  for (const cell of flight.plan) {
    const route = flight.transition.routeFor(cell);
    if (!route) continue;
    const id = flight.transition.occurrenceId(cell), matrix = state.matricesById.get(id), appearance = state.appearances.get(id);
    assert.ok(matrix, `${label}: ${id} remains in the scene`);
    assert.ok(basisLengths(matrix).every(value => Math.abs(value - 1) < 1e-7), `${label}: ${id} remains full size`);
    assert.equal(appearance.alpha, 1, `${label}: ${id} does not fade to hide a discontinuity`);
  }
}

test("ARRAY/MATRIX share one 3x20 lattice and the camera path is direction-symmetric", () => {
  const arrayToMatrix = makeFlight("array", "matrix");
  const matrixToArray = makeFlight("matrix", "array");
  assert.equal(arrayToMatrix.transition.frame.q, 0);
  assert.equal(matrixToArray.transition.frame.q, 1);
  assert.equal(arrayToMatrix.plan.length, GRID_COLUMNS * GRID_ROWS * 2,
    "the plan contains sixty ARRAY residents and sixty additional MATRIX loop copies");
  assert.equal(matrixToArray.plan.length, arrayToMatrix.plan.length);
  const sharedIds = assertResidentRoutes(arrayToMatrix);
  assert.deepEqual(assertResidentRoutes(matrixToArray), sharedIds);

  const qSamples = [0, .1, .25, .5, .75, .9, 1];
  const forwardSamples = new Map(), reverseSamples = new Map();
  for (const q of qSamples) forwardSamples.set(q, advanceToQ(arrayToMatrix, q, .0000001));
  for (const q of [...qSamples].reverse()) reverseSamples.set(q, advanceToQ(matrixToArray, q, .0000001));
  for (const q of qSamples) {
    const forward = forwardSamples.get(q), reverse = reverseSamples.get(q);
    close(forward.frame.q, reverse.frame.q, .00015);
    close(forward.frame.rowSpacing, reverse.frame.rowSpacing, .00015);
    close(forward.frame.rowSpacing, THREE.MathUtils.lerp(1, .62, deploymentStep(q)), .00015);
    close(forward.frame.heading, reverse.frame.heading, .00015);
    assert.ok(Math.abs(forward.frame.heading) <= THREE.MathUtils.degToRad(10) + 1e-8);
    assert.equal(forward.frame.residentCases, GRID_COLUMNS * GRID_ROWS);
    assert.equal(reverse.frame.residentCases, GRID_COLUMNS * GRID_ROWS);
    assertFiniteCamera(forward.camera, forward.aim);
    assertFiniteCamera(reverse.camera, reverse.aim);
    assert.ok(Math.abs(forward.frame.cameraAsinArgument ?? 0) <= 1 + 1e-7);
    assert.ok(Math.abs(reverse.frame.cameraAsinArgument ?? 0) <= 1 + 1e-7);
    assertAllActorsPresentAndOpaque(arrayToMatrix, forward, `ARRAY→MATRIX q=${q}`);
    assertAllActorsPresentAndOpaque(matrixToArray, reverse, `MATRIX→ARRAY q=${q}`);
    assertDirectLatticePath(arrayToMatrix, forward);
    assertDirectLatticePath(matrixToArray, reverse);
    assertNoCaseOverlaps(forward, `ARRAY→MATRIX q=${q}`);
    assertNoCaseOverlaps(reverse, `MATRIX→ARRAY q=${q}`);
    for (const id of sharedIds) {
      assert.ok(forward.matricesById.has(id) && reverse.matricesById.has(id), `resident ${id} exists in both directions`);
      assertMatrixNear(forward.matricesById.get(id), reverse.matricesById.get(id), .015, `resident ${id} q=${q}`);
      assert.equal(forward.sides.get(id), undefined, `resident ${id} stays in view at q=${q}`);
      assert.equal(reverse.sides.get(id), undefined, `resident ${id} stays in view at q=${q}`);
    }
    assertMatrixNear(forward.rack.matrix, reverse.rack.matrix, .01, `rack q=${q}`);
    assert.equal(forward.rack.visible, reverse.rack.visible);
    assert.equal(forward.rack.visible, !forward.rack.outside);
    if (!forward.rack.visible) assert.ok(forward.rack.projected[1] < -1.1);
    assert.equal(forward.frame.rackDeployment, 1);
    assert.equal(reverse.frame.rackDeployment, 1);
    assert.ok(forward.camera.position.distanceTo(reverse.camera.position) < .0001,
      `hero-following camera position is symmetric at q=${q}`);
    assert.ok(forward.aim.distanceTo(reverse.aim) < .0001, `hero-following camera aim is symmetric at q=${q}`);
  }

  assertStartPoses(arrayToMatrix, forwardSamples.get(0));
  assertStartPoses(matrixToArray, reverseSamples.get(1));

  const arrayEnd = moveToSettled(arrayToMatrix);
  assert.deepEqual(arrayToMatrix.transition.endpointSelection, arrayToMatrix.targetSelected);
  assertTargetPoses(arrayToMatrix, arrayEnd);
  assert.ok(arrayToMatrix.targetCamera.position.distanceTo(matrixPosition(arrayToMatrix.targetMatrices.get(cellSignature(MATRIX.selected)))) >
    arrayToMatrix.sourceCamera.position.distanceTo(matrixPosition(endpointMatrix(ARRAY, ARRAY.selected, true))) + 10,
  "MATRIX pullback must increase camera-to-hero distance");
  assert.ok(arrayToMatrix.targetCamera.position.y < arrayToMatrix.sourceCamera.position.y,
    "MATRIX endpoint camera must sit lower in world space");
  assertCameraEndpoint(arrayEnd.camera, arrayEnd.aim, arrayToMatrix.targetCamera);

  const matrixEnd = moveToSettled(matrixToArray);
  assert.deepEqual(matrixToArray.transition.endpointSelection, matrixToArray.targetSelected);
  assertTargetPoses(matrixToArray, matrixEnd);
  assertCameraEndpoint(matrixEnd.camera, matrixEnd.aim, matrixToArray.targetCamera);
});

test("MATRIX loop copies use unique physical occurrences and monotonic ARRAY extensions", () => {
  const forward = makeFlight("array", "matrix");
  const reverse = makeFlight("matrix", "array");
  const laneOffset = MATRIX.selected.lane - ARRAY.selected.lane;
  const rowOffset = MATRIX.selected.row - ARRAY.selected.row;
  const extraMatrixCells = modeCells(MATRIX).filter(cell => cell.row - MATRIX.selected.row >= GRID_ROWS / 2);
  assert.equal(extraMatrixCells.length, GRID_COLUMNS * GRID_ROWS);

  for (const flight of [forward, reverse]) {
    const extras = [];
    for (const target of extraMatrixCells) {
      const arrayCell = { lane: target.lane - laneOffset, row: target.row - rowOffset, foobarEntryKey: target.foobarEntryKey };
      const planned = flight.plan.find(cell => {
        const route = flight.transition.routeFor(cell);
        return route?.hasMatrix && route.arrayCell.lane === arrayCell.lane &&
          route.arrayCell.row === arrayCell.row && cell.foobarEntryKey === target.foobarEntryKey;
      });
      assert.ok(planned, `loop copy ${cellSignature(target)} has a physical actor`);
      const route = flight.transition.routeFor(planned);
      assert.equal(route.resident, false, "a MATRIX-only loop copy is not mislabeled as an ARRAY resident");
      assert.equal(route.hasMatrix, true);
      assert.equal(route.hasArray, false);
      assert.deepEqual(route.arrayCell, { lane: arrayCell.lane, row: arrayCell.row },
        "the extra copy receives its fixed ARRAY extension address");
      extras.push({ cell: planned, route });
    }
    assert.equal(extras.length, GRID_COLUMNS * GRID_ROWS);
    const rowsByLane = new Map();
    for (const { route } of extras) {
      const rows = rowsByLane.get(route.arrayCell.lane) ?? [];
      rows.push(route.arrayCell.row);
      rowsByLane.set(route.arrayCell.lane, rows);
    }
    for (const rows of rowsByLane.values())
      assert.deepEqual(rows.sort((a, b) => a - b), Array.from({ length: GRID_ROWS }, (_, index) => GRID_FIRST_ROW + GRID_ROWS + index),
        "virtual ARRAY rows extend the canonical twenty rows monotonically");
  }

  const start = renderState(forward);
  const end = moveToSettled(forward);
  for (const { cell } of [...forward.plan.map(cell => ({ cell }))]) {
    const route = forward.transition.routeFor(cell);
    if (!route || route.resident) continue;
    const id = forward.transition.occurrenceId(cell);
    assert.equal(start.appearances.get(id).alpha, 1, `${id} starts opaque at its virtual ARRAY endpoint`);
    assert.equal(end.appearances.get(id).alpha, 1, `${id} ends opaque at its MATRIX endpoint`);
    assert.ok(basisLengths(start.matricesById.get(id)).every(value => Math.abs(value - 1) < 1e-7));
    assert.ok(basisLengths(end.matricesById.get(id)).every(value => Math.abs(value - 1) < 1e-7));
  }
});

test("retarget at five canonical q points preserves velocity and plan identity", () => {
  for (const threshold of [.03, .2, .5, .8, .97]) {
    const flight = makeFlight("array", "matrix");
    advanceToQ(flight, threshold, .00004);
    const q = flight.transition.frame.q, velocity = flight.transition.frame.qVelocity;
    const ids = flight.plan.map(cell => flight.transition.occurrenceId(cell));
    const before = renderState(flight);
    assert.ok(q >= 0 && q <= 1, `q=${q} remains within endpoint bounds`);
    assert.ok(Math.abs(velocity) <= .44 + 1e-8, `velocity=${velocity} remains within its speed bound`);
    assert.equal(flight.transition.retarget(true), true, `reverse accepted at q=${threshold}`);
    close(flight.transition.frame.q, q, 0);
    close(flight.transition.frame.qVelocity, velocity, 0);
    assert.deepEqual(flight.plan.map(cell => flight.transition.occurrenceId(cell)), ids);
    const after = renderState(flight);
    for (const id of ids) assertMatrixNear(after.matricesById.get(id), before.matricesById.get(id), .00001,
      `retarget keeps current pose for ${id}`);
    assert.ok(after.camera.position.distanceTo(before.camera.position) < .00001, "retarget keeps the current camera pose");
    moveToSettled(flight);
    close(flight.transition.frame.q, 0, 0);
  }
});

test("resident boxes never leave and every shared/loop actor follows the same deploymentStep", () => {
  const flights = [makeFlight("array", "matrix"), makeFlight("matrix", "array")];
  const qSamples = Array.from({ length: 21 }, (_, index) => index / 20);
  for (const flight of flights) {
    const residentIds = assertResidentRoutes(flight);
    const sourceIds = new Set(flight.sourceSamples.map(sample => sample.cell.motionId));
    const sourceStart = renderState(flight);
    const visibleResidentIds = new Set([...sourceIds].filter(id => residentIds.has(id) && sourceStart.sides.get(id) === undefined));
    assert.equal(visibleResidentIds.size, residentIds.size, "every existing resident starts fully in view");
    const sampleOrder = flight.sourceName === "array" ? qSamples : [...qSamples].reverse();
    for (const q of sampleOrder) {
      const state = advanceToQ(flight, q, .0000001);
      assertAllActorsPresentAndOpaque(flight, state, `${flight.sourceName}→${flight.targetName} q=${q}`);
      assertDirectLatticePath(flight, state);
      assertNoCaseOverlaps(state, `${flight.sourceName}→${flight.targetName} q=${q}`);
      for (const id of visibleResidentIds) assert.equal(state.sides.get(id), undefined,
        `resident ${id} remains in view at q=${q}`);
      for (const id of sourceIds) {
        assert.ok(state.matricesById.has(id), `existing physical occurrence ${id} remains present at q=${q}`);
      }
      for (const id of visibleResidentIds) {
        assert.equal(state.sides.get(id), undefined, `visible source occurrence ${id} does not leave and re-enter at q=${q}`);
      }
    }
  }
});

test("a pre-existing hover aligns for .18s at fixed q, then follows the same q-only path in reverse", () => {
  const aligned = makeFlight("array", "matrix", { alignmentLift: .28 });
  const residentIds = residentActorIds();
  assert.equal(aligned.transition.frame.q, 0);
  assert.equal(aligned.transition.frame.phase, "align");
  assert.equal(aligned.transition.frame.interactionSettling, true);
  const before = renderState(aligned);
  const hoverSample = aligned.sourceSamples.find(sample => sample.cell.lane === ARRAY.selected.lane &&
    sample.cell.row === ARRAY.selected.row + 1);
  for (const sample of [aligned.sourceSamples.find(value => value.cell.foobarEntryKey === "hero" &&
    value.cell.lane === ARRAY.selected.lane && value.cell.row === ARRAY.selected.row), hoverSample]) {
    assert.ok(sample);
    assertMatrixNear(before.matricesById.get(sample.cell.motionId), sample.matrix, .00001,
      `initial interaction alignment ${sample.cell.motionId}`);
  }
  aligned.transition.advance(.1);
  close(aligned.transition.frame.q, 0, 0);
  close(aligned.transition.frame.qVelocity, 0, 0);
  assert.equal(aligned.transition.frame.phase, "align");
  aligned.transition.advance(.08);
  close(aligned.transition.frame.q, 0, 0);
  assert.equal(aligned.transition.frame.interactionSettling, false);
  aligned.transition.advance(.01);
  assert.ok(aligned.transition.frame.q > 0, "q begins moving only after the .18s alignment window");

  const sampleQ = .43;
  const forward = advanceToQ(aligned, sampleQ, .0000001);
  const reverseFlight = makeFlight("matrix", "array");
  const reverse = advanceToQ(reverseFlight, sampleQ, .0000001);
  close(forward.frame.q, reverse.frame.q, .000001);
  for (const id of residentIds)
    assertMatrixNear(forward.matricesById.get(id), reverse.matricesById.get(id), .015, `aligned q-only ${id}`);
  assertMatrixNear(forward.rack.matrix, reverse.rack.matrix, .015, "aligned q-only rack");
  assert.ok(forward.camera.position.distanceTo(reverse.camera.position) < .0001, "camera path no longer contains elapsed-time residue");
  assert.ok(forward.aim.distanceTo(reverse.aim) < .0001);

  const beforeRetarget = renderState(aligned);
  const q = aligned.transition.frame.q, velocity = aligned.transition.frame.qVelocity;
  assert.equal(aligned.transition.retarget(true), true);
  close(aligned.transition.frame.q, q, 0);
  close(aligned.transition.frame.qVelocity, velocity, 0);
  const afterRetarget = renderState(aligned);
  for (const cell of aligned.plan) {
    const id = aligned.transition.occurrenceId(cell);
    assertMatrixNear(afterRetarget.matricesById.get(id), beforeRetarget.matricesById.get(id), .00001, `retarget-stable ${id}`);
  }
  assert.ok(afterRetarget.camera.position.distanceTo(beforeRetarget.camera.position) < .00001);
});

test("rack remains fully assembled and draw visibility ends only after the whole rig leaves view", () => {
  const flight = makeFlight("array", "matrix");
  const start = renderState(flight);
  assert.equal(flight.transition.frame.rackDeployment, 1);
  assert.equal(start.rack.visible, true);
  const end = moveToSettled(flight);
  assert.equal(flight.transition.frame.rackDeployment, 1);
  assert.equal(end.rack.outside, true);
  assert.equal(end.rack.visible, false);
  assert.ok(end.rack.projected[1] < -1.1, "the rig top must clear the draw boundary");
  assert.ok(end.rack.projected.every(Number.isFinite));
});

test("responsive ARRAY span feeds a wider MATRIX span for Future, Punk and portrait viewports", () => {
  const bounds = { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() };
  const future = musicArrayCompositionFrame(1920, 1080, 1100, .8, -1, bounds, CENTER, false);
  const punk = musicArrayCompositionFrame(1920, 1080, 1920, .8, -1, bounds, CENTER, false);
  const normalScale = musicArrayCompositionFrame(1920, 1080, 1920, 1, -1, bounds, CENTER, false);
  const portrait = musicArrayCompositionFrame(390, 844, 390, .8, -1, bounds, CENTER, true);
  for (const frame of [future, punk, portrait]) {
    assert.ok(frame.effectiveSpan > 0 && Number.isFinite(frame.effectiveSpan));
    assert.ok(musicMatrixOverviewSpan(frame.effectiveSpan) > frame.effectiveSpan);
    assert.equal(frame.availableWidth, frame === future ? 1100 : frame === punk ? 1920 : 390);
  }
  assert.ok(future.effectiveSpan > punk.effectiveSpan,
    "Future's narrower information viewport must use its measured available width");
  assert.ok(punk.effectiveSpan > normalScale.effectiveSpan,
    "arrayScale .8 must widen ARRAY relative to scale 1");
  assert.ok(portrait.effectiveSpan > 0, "portrait ARRAY framing feeds a finite MATRIX span");
});

test("resident MATRIX framing fits every case across four finite columns", () => {
  const points = [];
  for (let column = -2; column < 2; column++) for (let row = 0; row < GRID_ROWS; row++) {
    const cell = { lane: MATRIX.selected.lane + column, row: GRID_FIRST_ROW + row + 20, foobarEntryKey: `frame-${column}-${row}` };
    const matrix = endpointMatrix(MATRIX, cell);
    points.push(...transformedCorners(matrix));
  }
  const distance = MUSIC_MATRIX_VIEW.distance;
  const fullClip = { minX: -.96, maxX: .96, minY: -.94, maxY: .94 };
  const punkClip = { minX: -.96, maxX: .36, minY: -.94, maxY: .94 };
  const cases = [
    { name: "fullcanvas 1920x1080", aspect: 1920 / 1080, clip: fullClip },
    { name: "Punk 1920x1080", aspect: 1920 / 1080, clip: punkClip },
    { name: "fullcanvas portrait 390x844", aspect: 390 / 844, clip: fullClip },
    { name: "Punk portrait 390x844", aspect: 390 / 844, clip: punkClip },
  ];
  for (const viewport of cases) {
    const fitted = musicMatrixResidentFrame(MATRIX.aim.clone(), outward(MATRIX), MATRIX_OVERVIEW_SPAN,
      viewport.aspect, points, viewport.clip);
    const camera = new THREE.PerspectiveCamera(34, viewport.aspect, .1, 300);
    camera.position.copy(fitted.aim).addScaledVector(outward(MATRIX), distance);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(fitted.span / (2 * distance)));
    camera.lookAt(fitted.aim);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    for (const point of points) {
      const ndc = point.clone().project(camera);
      assert.ok(ndc.x >= viewport.clip.minX - .01 && ndc.x <= viewport.clip.maxX + .01 &&
        ndc.y >= viewport.clip.minY - .01 && ndc.y <= viewport.clip.maxY + .01,
      `${viewport.name}: case must stay inside clip ${JSON.stringify(viewport.clip)}, got ${ndc.toArray()}`);
    }
    assert.ok(fitted.span >= MATRIX_OVERVIEW_SPAN, `${viewport.name}: fitted span must not shrink the source frame`);
  }
});

test("settled endpoints rebind shared actors to the selected-offset physical cells", () => {
  const forward = makeFlight("array", "matrix");
  moveToSettled(forward);
  assert.deepEqual(forward.transition.endpointSelection, MATRIX.selected);
  const laneOffset = MATRIX.selected.lane - ARRAY.selected.lane;
  const rowOffset = MATRIX.selected.row - ARRAY.selected.row;
  const targetMatrixOwners = new Set();
  for (const cell of forward.plan) {
    const route = forward.transition.routeFor(cell);
    if (!route?.hasMatrix) continue;
    const owner = forward.transition.endpointCell(cell);
    assert.ok(owner, `MATRIX occurrence ${forward.transition.occurrenceId(cell)} has an endpoint owner`);
    assert.deepEqual(owner, {
      lane: route.arrayCell.lane + laneOffset, row: route.arrayCell.row + rowOffset,
      foobarEntryKey: cell.foobarEntryKey,
    });
    targetMatrixOwners.add(cellSignature(owner));
  }
  assert.equal(targetMatrixOwners.size, GRID_COLUMNS * GRID_ROWS * 2);

  const reverse = makeFlight("matrix", "array");
  moveToSettled(reverse);
  assert.deepEqual(reverse.transition.endpointSelection, ARRAY.selected);
  const restored = new Set();
  for (const cell of reverse.plan) {
    const route = reverse.transition.routeFor(cell);
    if (!route?.resident) continue;
    const owner = reverse.transition.endpointCell(cell);
    assert.ok(owner, `ARRAY resident ${reverse.transition.occurrenceId(cell)} restores a physical cell`);
    assert.deepEqual(owner, { lane: route.arrayCell.lane, row: route.arrayCell.row, foobarEntryKey: cell.foobarEntryKey });
    restored.add(cellSignature(owner));
  }
  assert.equal(restored.size, GRID_COLUMNS * GRID_ROWS);
});

function assertFiniteCamera(camera, aim) {
  assert.ok(camera.position.toArray().every(Number.isFinite));
  assert.ok(aim.toArray().every(Number.isFinite));
  assert.ok(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180);
}

function assertCameraEndpoint(camera, aim, expected) {
  assert.ok(camera.position.distanceTo(expected.position) < .03, "camera reaches its endpoint position");
  assert.ok(aim.distanceTo(expected.aim) < .03, "camera reaches its endpoint aim");
  close(visibleSpan(camera, aim), expected.span, .03);
}

function visibleSpan(camera, aim) {
  return 2 * camera.position.distanceTo(aim) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
