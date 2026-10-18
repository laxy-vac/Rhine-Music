import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicLayoutTransition } from "../src/music-layout-transition.ts";
import { musicArrayCompositionFrame, musicMatrixOverviewSpan } from "../src/music-layout-framing.ts";

const CENTER = new THREE.Vector3(0, 1.85, 0);
const CASE_BOUNDS = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
const CASE_BOUND_ARRAYS = { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() };
const ARRAY_OVERVIEW_SPAN = musicArrayCompositionFrame(1920, 1080, 1100, .8, -1, CASE_BOUND_ARRAYS, CENTER, false).effectiveSpan;
const MATRIX_OVERVIEW_SPAN = musicMatrixOverviewSpan(ARRAY_OVERVIEW_SPAN);
const RACK_BOUNDS = new THREE.Box3(new THREE.Vector3(-12, -4.425, -18), new THREE.Vector3(12, -.425, 18));
const ARRAY = {
  selected: { lane: 2, row: 16, foobarEntryKey: "hero" },
  spacing: { column: -4.95, row: -1 }, anchor: new THREE.Vector3(0, -2.502, 0),
  aim: new THREE.Vector3(0, -4.425, -2.17), yaw: -38, elevation: 35, distance: 140, span: ARRAY_OVERVIEW_SPAN,
  offsets: [
    ["hero", 0, 0], ["core-1", 0, 1], ["core-2", 0, 2],
    ["near", 1, 4], ["near-next", 1, 5], ["wrap-a", 4, -2], ["wrap-b", 0, 9], ["retiring", 1, 0],
  ],
};
const MATRIX = {
  selected: { lane: 2, row: 15, foobarEntryKey: "hero" },
  spacing: { column: -5.2, row: -.62 }, anchor: new THREE.Vector3(0, -3.25, 0),
  aim: new THREE.Vector3(-1.091, -.045, .481), yaw: 59, elevation: 25, distance: 170, span: MATRIX_OVERVIEW_SPAN,
  offsets: [
    ["hero", 0, 0], ["core-1", 0, 1], ["core-2", 0, 2],
    ["near", 1, 4], ["near-next", 1, 5], ["wrap-a", -4, 4], ["wrap-b", 0, -8], ["arriving", 1, 0],
  ],
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

function smoothstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

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

function endpointMatrix(mode, cell, selected = false) {
  const position = mode.anchor.clone().add(new THREE.Vector3(
    (cell.lane - mode.selected.lane) * mode.spacing.column, 0,
    (cell.row - mode.selected.row) * mode.spacing.row,
  ));
  if (!selected) position.y = -4.55;
  return matrixAt(position);
}

function endpointBasePosition(mode, cell, q, heading) {
  const pivot = ARRAY.anchor.clone().lerp(MATRIX.anchor, smoothstep(q));
  const position = matrixPosition(endpointMatrix(mode, cell));
  position.sub(pivot).applyQuaternion(yawQuaternion(heading)).add(pivot);
  const lift = .28 * smoothstep(Math.max(0, Math.min(1, q / .12))) *
    (1 - smoothstep(Math.max(0, Math.min(1, (q - .65) / .25))));
  position.y += lift;
  return position;
}

function localZBounds(matrices, keys, heading) {
  const inverse = yawQuaternion(-heading);
  const values = keys.flatMap(key => transformedCorners(matrices.get(key)).map(point => point.applyQuaternion(inverse).z));
  return { min: Math.min(...values), max: Math.max(...values) };
}

function modeCells(mode) {
  return mode.offsets.map(([key, lane, row]) => endpointCell(mode, key, lane, row));
}

function makeFlight(sourceName, targetName, { alignmentLift = 0, extraOffsets = {} } = {}) {
  const sourceMode = sourceName === "array" ? ARRAY : MATRIX;
  const targetMode = targetName === "array" ? ARRAY : MATRIX;
  const sourceSelected = { ...sourceMode.selected };
  const targetSelected = { ...targetMode.selected };
  const sourceCells = [...modeCells(sourceMode), ...(extraOffsets[sourceName] ?? [])
    .map(([key, lane, row]) => endpointCell(sourceMode, key, lane, row))];
  const targetCells = [...modeCells(targetMode), ...(extraOffsets[targetName] ?? [])
    .map(([key, lane, row]) => endpointCell(targetMode, key, lane, row)), { lane: -10000, row: -10000 }];
  const sourceByKey = new Map(sourceCells.map(cell => [cell.foobarEntryKey, cell]));
  const targetByKey = new Map(targetCells.filter(cell => cell.foobarEntryKey).map(cell => [cell.foobarEntryKey, cell]));
  const sourceSelectedRestMatrix = endpointMatrix(sourceMode, sourceSelected, true);
  const sourceSelectedMatrix = sourceSelectedRestMatrix.clone();
  if (alignmentLift) {
    const position = matrixPosition(sourceSelectedMatrix);
    position.y += alignmentLift;
    sourceSelectedMatrix.setPosition(position);
  }
  const sourceCamera = cameraEnd(sourceMode);
  const sourceSamples = sourceCells.map(cell => {
    const selected = cell.foobarEntryKey === "hero";
    const restMatrix = selected ? sourceSelectedRestMatrix.clone() : endpointMatrix(sourceMode, cell);
    const matrix = selected ? sourceSelectedMatrix.clone() : restMatrix.clone();
    if (alignmentLift && cell.foobarEntryKey === "core-1") {
      const position = matrixPosition(matrix);
      position.y += alignmentLift;
      matrix.setPosition(position);
    }
    return { cell: { ...cell }, matrix, restMatrix, alpha: 1, tint: 0 };
  });
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetName === "array", 4.45, -4.6, Number(sourceName === "array"), new Map(), CENTER,
    sourceSelectedRestMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetByKey.has(cell.foobarEntryKey), new Map());
  transition.prepareTarget(matrixPosition(endpointMatrix(targetMode, targetSelected, true)));
  const targetMatrices = new Map();
  for (const cell of plan) {
    const matrix = targetByKey.has(cell.foobarEntryKey)
      ? endpointMatrix(targetMode, targetByKey.get(cell.foobarEntryKey), cell.foobarEntryKey === "hero")
      : endpointMatrix(targetMode, cell);
    if (cell.foobarEntryKey) targetMatrices.set(cell.foobarEntryKey, matrix.clone());
    transition.primeTarget(cell, matrix, transition.isSelected(cell));
  }
  assert.equal(transition.targetsReady, true, "the render-like priming pass must cache selected and target poses");
  const targetCamera = cameraEnd(targetMode);
  const camera = sourceCamera.camera.clone();
  const aim = sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, targetCamera.position, targetCamera.aim, targetCamera.span);
  return { transition, sourceName, targetName, sourceMode, targetMode, sourceSelected, targetSelected, sourceSamples,
    sourceCells, targetCells, sourceByKey, targetByKey, sourceCamera, targetCamera, camera, aim, plan, targetMatrices };
}

function makeLongGroupFlight(sourceName, targetName) {
  const arraySelected = { lane: 1, row: 20, foobarEntryKey: "B0" };
  const matrixSelected = { lane: 1, row: 12, foobarEntryKey: "B0" };
  const arrayMode = { ...ARRAY, selected: arraySelected };
  const matrixMode = { ...MATRIX, selected: matrixSelected };
  const modes = { array: arrayMode, matrix: matrixMode };
  const sourceMode = modes[sourceName], targetMode = modes[targetName];
  const sourceSelected = { ...sourceMode.selected }, targetSelected = { ...targetMode.selected };
  const arrayCells = [
    ...Array.from({ length: 8 }, (_, index) => endpointCell(arrayMode, `A${20 + index}`, 0, -8 + index)),
    ...Array.from({ length: 12 }, (_, index) => endpointCell(arrayMode, `B${index}`, 0, index)),
  ];
  const matrixCells = [
    ...Array.from({ length: 8 }, (_, index) => endpointCell(matrixMode, `A${20 + index}`, -1, 8 + index)),
    ...Array.from({ length: 12 }, (_, index) => endpointCell(matrixMode, `B${index}`, 0, index)),
    ...Array.from({ length: 12 }, (_, index) => endpointCell(matrixMode, `B${index}`, 0, 12 + index)),
  ];
  const catalogFor = cells => {
    const catalog = new Map();
    cells.forEach((cell, order) => {
      if (cell.foobarEntryKey && !catalog.has(cell.foobarEntryKey))
        catalog.set(cell.foobarEntryKey, { lane: cell.lane, row: cell.row, order });
    });
    return catalog;
  };
  const catalogs = { array: catalogFor(arrayCells), matrix: catalogFor(matrixCells) };
  const sourceCells = sourceName === "array" ? arrayCells : matrixCells;
  const sourceSelectedMatrix = endpointMatrix(sourceMode, sourceSelected, true);
  const sourceCamera = cameraEnd(sourceMode);
  const sourceSamples = sourceCells.map(cell => {
    const selected = cell.foobarEntryKey === sourceSelected.foobarEntryKey &&
      cell.lane === sourceSelected.lane && cell.row === sourceSelected.row;
    const matrix = selected ? sourceSelectedMatrix.clone() : endpointMatrix(sourceMode, cell);
    return { cell: { ...cell, motionId: `${sourceName}:${cell.foobarEntryKey}:${cell.lane}:${cell.row}` },
      matrix, restMatrix: matrix.clone(), alpha: 1, tint: 0 };
  });
  const targetCells = [...(targetName === "array" ? arrayCells : matrixCells)];
  while (targetCells.length < 48) targetCells.push({ lane: -10000 - targetCells.length, row: -10000 - targetCells.length });
  const targetBySignature = new Map(targetCells.filter(cell => cell.foobarEntryKey)
    .map(cell => [`${cell.foobarEntryKey}|${cell.lane}|${cell.row}`, cell]));
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetName === "array", 4.45, -4.6, Number(sourceName === "array"), catalogs[sourceName], CENTER,
    sourceSelectedMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetBySignature.has(`${cell.foobarEntryKey}|${cell.lane}|${cell.row}`), catalogs[targetName]);
  const targetHero = endpointMatrix(targetMode, targetSelected, true);
  transition.prepareTarget(matrixPosition(targetHero));
  const targetMatrices = new Map();
  for (const cell of plan) {
    const key = `${cell.foobarEntryKey}|${cell.lane}|${cell.row}`;
    const selected = transition.isSelected(cell);
    const target = targetBySignature.has(key) ? targetBySignature.get(key) : undefined;
    const matrix = target ? endpointMatrix(targetMode, target, selected) : endpointMatrix(targetMode, cell, selected);
    if (target) targetMatrices.set(key, matrix.clone());
    transition.primeTarget(cell, matrix, selected);
  }
  assert.equal(transition.targetsReady, true);
  const targetCamera = cameraEnd(targetMode), camera = sourceCamera.camera.clone(), aim = sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, targetCamera.position, targetCamera.aim, targetCamera.span);
  return { transition, sourceName, targetName, sourceMode, targetMode, sourceSelected, targetSelected,
    sourceCells, sourceSamples, targetCells, targetCamera, sourceCamera, camera, aim, plan, targetMatrices,
    targetBySignature, catalogs };
}

function assertLargeUnion(size, sourceName) {
  const targetName = sourceName === "array" ? "matrix" : "array";
  const sourceMode = sourceName === "array" ? ARRAY : MATRIX;
  const targetMode = targetName === "array" ? ARRAY : MATRIX;
  const shared = size / 2;
  const sourceSelected = { ...sourceMode.selected, foobarEntryKey: "shared-0" };
  const targetSelected = { ...targetMode.selected, foobarEntryKey: "shared-0" };
  const sourceEntries = [
    ...Array.from({ length: shared }, (_, index) => `shared-${index}`),
    ...Array.from({ length: size - shared }, (_, index) => `source-${index}`),
  ];
  const targetEntries = [
    ...Array.from({ length: shared }, (_, index) => `shared-${index}`),
    ...Array.from({ length: size - shared }, (_, index) => `target-${index}`),
  ];
  const sourceCells = sourceEntries.map((foobarEntryKey, index) => ({
    lane: sourceSelected.lane, row: sourceSelected.row + index, foobarEntryKey,
  }));
  const targetCells = targetEntries.map((foobarEntryKey, index) => ({
    lane: targetSelected.lane, row: targetSelected.row + index, foobarEntryKey,
  }));
  const sourceSelectedMatrix = endpointMatrix(sourceMode, sourceSelected, true);
  const sourceCamera = cameraEnd(sourceMode);
  const sourceSamples = sourceCells.map(cell => {
    const selected = cell.foobarEntryKey === "shared-0";
    const matrix = selected ? sourceSelectedMatrix.clone() : endpointMatrix(sourceMode, cell);
    return { cell, matrix, restMatrix: matrix.clone(), alpha: 1, tint: 0 };
  });
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetName === "array", 4.45, -4.6, Number(sourceName === "array"), new Map(), CENTER,
    sourceSelectedMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const targetByKey = new Map(targetCells.map(cell => [cell.foobarEntryKey, cell]));
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetByKey.has(cell.foobarEntryKey), new Map());
  const expectedUnion = size + (size - shared);
  assert.equal(plan.length, expectedUnion, `${sourceName} ${size}: bind retains the entire source/target union`);
  assert.ok(plan.length > 729, "the logical fixture exceeds the current 729-cell scene capacity without truncating the API plan");
  assert.equal(new Set(plan.map(cell => transition.occurrenceId(cell))).size, expectedUnion,
    `${sourceName} ${size}: every union owner has a unique motion identity`);
  assert.equal(plan.filter(cell => transition.routeFor(cell)?.hasArray && transition.routeFor(cell)?.hasMatrix).length, shared);
  assert.equal(plan.filter(cell => transition.routeFor(cell)?.hasArray && !transition.routeFor(cell)?.hasMatrix).length, size - shared);
  assert.equal(plan.filter(cell => !transition.routeFor(cell)?.hasArray && transition.routeFor(cell)?.hasMatrix).length, size - shared);
  for (let frame = 0; frame < 40 && !transition.settled; frame++) transition.advance(.5);
  assert.equal(transition.settled, true, `${sourceName} ${size}: endpoint reaches a settled owner map`);
  assert.deepEqual(transition.endpointSelection, targetSelected);
  for (const cell of plan) {
    const expected = targetByKey.get(cell.foobarEntryKey);
    if (expected) assert.deepEqual(transition.endpointCell(cell), expected);
    else assert.equal(transition.endpointCell(cell), undefined);
  }
  transition.clear();
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
  const signature = `${cell.foobarEntryKey}|${cell.lane}|${cell.row}`;
  return flight.targetMatrices.get(signature) ?? flight.targetMatrices.get(cell.foobarEntryKey);
}

function renderState(flight) {
  const { transition } = flight;
  const camera = flight.sourceCamera.camera.clone(), aim = flight.sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, flight.targetCamera.position, flight.targetCamera.aim, flight.targetCamera.span);
  camera.updateMatrixWorld(true);
  const matrices = new Map(), matricesByKey = new Map(), projected = new Map(), sides = new Map();
  for (const cell of transition.bound ? flight.plan : []) {
    const matrix = targetMatrixForCell(flight, cell)?.clone() ?? endpointMatrix(flight.targetMode, cell);
    transition.apply(matrix, cell, transition.isSelected(cell));
    const id = transition.occurrenceId(cell) ?? cell.foobarEntryKey;
    matrices.set(id, matrix);
    if (cell.foobarEntryKey) matricesByKey.set(cell.foobarEntryKey, matrix);
    const points = transformedCorners(matrix);
    const projectedPoints = points.map(point => point.clone().project(camera));
    projected.set(id, projectedPoints);
    sides.set(id, outsideSide(projectedPoints));
  }
  const rack = transition.rackTransform(RACK_BOUNDS, -4.425);
  return { camera, aim, matrices, matricesByKey, projected, sides, rack, frame: transition.frame };
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

function ownerFor(flight, cell) { return flight.transition.endpointCell(cell); }

function assertStartPoses(flight, state) {
  for (const source of flight.sourceCells) {
    if (!source.foobarEntryKey) continue;
    assertMatrixNear(state.matricesByKey.get(source.foobarEntryKey),
      endpointMatrix(flight.sourceMode, source, source.foobarEntryKey === "hero"), 1e-5);
  }
}

function assertTargetPoses(flight, state) {
  for (const [key, expected] of flight.targetMatrices) {
    if (!flight.targetByKey.has(key)) continue;
    assertMatrixNear(state.matricesByKey.get(key), expected, 1e-5, `target endpoint ${key}`);
  }
}

test("ARRAY q=0 and MATRIX q=1 are exact endpoints with one canonical path in both directions", () => {
  const arrayToMatrix = makeFlight("array", "matrix");
  const matrixToArray = makeFlight("matrix", "array");
  assert.equal(arrayToMatrix.transition.frame.q, 0);
  assert.equal(matrixToArray.transition.frame.q, 1);

  const qSamples = [0, .15, .3, .5, .7, .85, 1];
  const forwardSamples = new Map(), reverseSamples = new Map();
  for (const q of qSamples) {
    forwardSamples.set(q, advanceToQ(arrayToMatrix, q));
  }
  for (const q of [...qSamples].reverse()) reverseSamples.set(q, advanceToQ(matrixToArray, q));
  for (const q of qSamples) {
    const forward = forwardSamples.get(q), reverse = reverseSamples.get(q);
    close(forward.frame.q, reverse.frame.q, .00015);
    close(forward.frame.rowSpacing, reverse.frame.rowSpacing, .00015);
    assert.ok(forward.frame.rowSpacing <= 1 + 1e-8 && forward.frame.rowSpacing >= .62 - 1e-8);
    close(forward.frame.heading, reverse.frame.heading, .00015);
    assert.ok(Math.abs(forward.frame.heading) <= THREE.MathUtils.degToRad(10) + 1e-8);
    assert.equal(forward.frame.coreCases, 3);
    const coreKeys = arrayToMatrix.plan.filter(cell => arrayToMatrix.transition.routeFor(cell)?.core)
      .map(cell => cell.foobarEntryKey).sort();
    assert.deepEqual(coreKeys, ["core-1", "core-2", "hero"]);
    assertFiniteCamera(forward.camera, forward.aim);
    assertFiniteCamera(reverse.camera, reverse.aim);
    assert.ok(Math.abs(forward.frame.cameraAsinArgument ?? 0) <= 1 + 1e-7);
    assert.ok(Math.abs(reverse.frame.cameraAsinArgument ?? 0) <= 1 + 1e-7);
    for (const key of ["hero", "core-1", "core-2", "near", "near-next", "wrap-a", "wrap-b"]) {
      const a = forward.matricesByKey.get(key), b = reverse.matricesByKey.get(key);
      assert.ok(a && b, `missing normal case pose for ${key}`);
      assertMatrixNear(a, b, .01);
    }
    assertMatrixNear(forward.rack.matrix, reverse.rack.matrix, .01);
    assert.equal(forward.rack.visible, reverse.rack.visible);
    assert.equal(forward.rack.visible, !forward.rack.outside);
    if (!forward.rack.visible) assert.ok(forward.rack.projected[1] < -1.1);
    assert.equal(forward.frame.rackDeployment, 1);
    assert.equal(reverse.frame.rackDeployment, 1);
  }

  assertStartPoses(arrayToMatrix, forwardSamples.get(0));
  assertStartPoses(matrixToArray, reverseSamples.get(1));

  const arrayEnd = moveToSettled(arrayToMatrix);
  assert.deepEqual(arrayToMatrix.transition.endpointSelection, arrayToMatrix.targetSelected);
  for (const cell of arrayToMatrix.plan) {
    const owner = ownerFor(arrayToMatrix, cell);
    if (arrayToMatrix.targetByKey.has(cell.foobarEntryKey)) assert.deepEqual(owner, arrayToMatrix.targetByKey.get(cell.foobarEntryKey));
    else assert.equal(owner, undefined);
  }
  for (const key of ["hero", "core-1", "core-2", "near", "near-next", "wrap-a", "wrap-b", "arriving"]) {
    const cell = arrayToMatrix.plan.find(value => value.foobarEntryKey === key);
    assert.ok(cell, `normal target plan includes ${key}`);
    assertMatrixNear(arrayEnd.matrices.get(arrayToMatrix.transition.occurrenceId(cell)),
      arrayToMatrix.targetMatrices.get(key), 1e-5);
  }
  assert.ok(arrayToMatrix.targetCamera.position.distanceTo(matrixPosition(arrayToMatrix.targetMatrices.get("hero"))) >
    arrayToMatrix.sourceCamera.position.distanceTo(matrixPosition(endpointMatrix(ARRAY, ARRAY.selected, true))) + 10,
  "MATRIX pullback must increase camera-to-hero distance");
  assert.ok(arrayToMatrix.targetCamera.position.y < arrayToMatrix.sourceCamera.position.y,
    "MATRIX endpoint camera must sit lower in world space");
  assertCameraEndpoint(arrayEnd.camera, arrayEnd.aim, arrayToMatrix.targetCamera);

  const matrixEnd = moveToSettled(matrixToArray);
  assert.deepEqual(matrixToArray.transition.endpointSelection, matrixToArray.targetSelected);
  for (const cell of matrixToArray.plan) {
    const owner = ownerFor(matrixToArray, cell);
    if (matrixToArray.targetByKey.has(cell.foobarEntryKey)) assert.deepEqual(owner, matrixToArray.targetByKey.get(cell.foobarEntryKey));
    else assert.equal(owner, undefined);
  }
  assertTargetPoses(matrixToArray, matrixEnd);
  assertCameraEndpoint(matrixEnd.camera, matrixEnd.aim, matrixToArray.targetCamera);
});

test("A28 remainder plus B12 second ARRAY shelf keeps MATRIX B12 loop copies out of the matched core", () => {
  const forward = makeLongGroupFlight("array", "matrix");
  const reverse = makeLongGroupFlight("matrix", "array");
  assert.deepEqual(forward.sourceCells.filter(cell => cell.foobarEntryKey.startsWith("A"))
    .map(cell => cell.row), Array.from({ length: 8 }, (_, index) => 12 + index));
  assert.deepEqual(forward.sourceCells.filter(cell => cell.foobarEntryKey.startsWith("B"))
    .map(cell => cell.row), Array.from({ length: 12 }, (_, index) => 20 + index));
  for (let index = 0; index < 12; index++)
    assert.deepEqual(reverse.sourceCells.filter(cell => cell.foobarEntryKey === `B${index}`).map(cell => cell.row),
      [12 + index, 24 + index]);

  const qSamples = [0, .2, .3, .5, .7, .85, 1];
  const forwardSamples = new Map(), reverseSamples = new Map();
  for (const q of qSamples) forwardSamples.set(q, advanceToQ(forward, q, .0000001));
  for (const q of [...qSamples].reverse()) reverseSamples.set(q, advanceToQ(reverse, q, .0000001));
  for (const q of qSamples) {
    const a = forwardSamples.get(q), b = reverseSamples.get(q);
    close(a.frame.q, b.frame.q, .000001);
    assert.equal(a.frame.coreCases, 12, "the canonical B0..B11 run forms the selected core segment");
    assert.equal(b.frame.coreCases, 12, "reverse flight keeps the same selected core segment");
    const matched = flight => flight.plan.filter(cell => {
      const route = flight.transition.routeFor(cell);
      return route?.hasArray && route.hasMatrix;
    });
    const byKey = (flight, state) => {
      const result = new Map();
      for (const cell of matched(flight)) {
        const route = flight.transition.routeFor(cell);
        if (cell.foobarEntryKey.startsWith("B")) {
          assert.equal(route.core, true, `${cell.foobarEntryKey} remains in the B core`);
          assert.equal(route.segment, 1, `${cell.foobarEntryKey} stays in the canonical second segment`);
        } else {
          assert.equal(route.core, false, `${cell.foobarEntryKey} remains a separate A segment`);
          assert.equal(route.segment, 0, `${cell.foobarEntryKey} stays in the canonical first segment`);
        }
        assert.equal(result.has(cell.foobarEntryKey), false, `only one canonical match for ${cell.foobarEntryKey}`);
        result.set(cell.foobarEntryKey, state.matrices.get(flight.transition.occurrenceId(cell)));
      }
      return result;
    };
    const aMatched = byKey(forward, a), bMatched = byKey(reverse, b);
    assert.equal(aMatched.size, 20);
    assert.deepEqual([...aMatched.keys()].sort(), [...bMatched.keys()].sort());
    for (const [key, matrix] of aMatched) assertMatrixNear(matrix, bMatched.get(key), .015, `${key} q=${q}`);
  }
});

test("retarget at five canonical q points preserves velocity and plan identity", () => {
  for (const threshold of [.03, .2, .5, .8, .97]) {
    const flight = makeFlight("array", "matrix");
    advanceToQ(flight, threshold, .00004);
    const q = flight.transition.frame.q, velocity = flight.transition.frame.qVelocity;
    const ids = flight.plan.map(cell => flight.transition.occurrenceId(cell));
    assert.equal(flight.transition.retarget(true), true, `reverse accepted at q=${threshold}`);
    close(flight.transition.frame.q, q, 0);
    close(flight.transition.frame.qVelocity, velocity, 0);
    assert.deepEqual(flight.plan.map(cell => flight.transition.occurrenceId(cell)), ids);
    moveToSettled(flight);
    close(flight.transition.frame.q, 0, 0);
  }
});

test("ARRAY-only exits by q=.2, matched cases morph while parked at q=.2..4, and MATRIX-only enters from q=.4", () => {
  const flight = makeFlight("array", "matrix");
  const retiring = flight.plan.find(cell => cell.foobarEntryKey === "retiring");
  const arriving = flight.plan.find(cell => cell.foobarEntryKey === "arriving");
  const near = flight.plan.find(cell => cell.foobarEntryKey === "near");
  const retiringRoute = flight.transition.routeFor(retiring), arrivingRoute = flight.transition.routeFor(arriving);
  assert.equal(retiringRoute.hasArray, true);
  assert.equal(retiringRoute.hasMatrix, false);
  assert.equal(arrivingRoute.hasArray, false);
  assert.equal(arrivingRoute.hasMatrix, true);
  assert.equal(flight.transition.routeFor(near).hasArray, true);
  assert.equal(flight.transition.routeFor(near).hasMatrix, true);
  assert.equal(flight.transition.routeFor(near).core, false);

  const states = new Map();
  for (const q of [0, .1, .2, .25, .3, .35, .4, .7, 1]) {
    const frame = advanceToQ(flight, q, .0000001);
    states.set(q, frame);
    const core = ["hero", "core-1", "core-2"];
    for (const key of core) {
      const cell = flight.plan.find(value => value.foobarEntryKey === key);
      const id = flight.transition.occurrenceId(cell);
      assert.ok(frame.projected.get(id).every(point => point.x > -1 && point.x < 1 && point.y > -1 && point.y < 1),
        `core case ${key} stays visible at q=${q}`);
    }
    for (const cell of flight.plan) {
      if (!cell.foobarEntryKey || !flight.transition.occurrenceId(cell)) continue;
      const id = flight.transition.occurrenceId(cell);
      const matrix = frame.matrices.get(id);
      assert.ok(basisLengths(matrix).every(scale => Math.abs(scale - 1) < 1e-7), `case ${cell.foobarEntryKey} remains full-size`);
      const points = transformedCorners(matrix);
      const depths = points.map(point => -point.clone().applyMatrix4(frame.camera.matrixWorldInverse).z);
      assert.ok(depths.every(depth => depth > 0), `case ${cell.foobarEntryKey} remains in front of the camera`);
      const side = frame.sides.get(id);
      const route = flight.transition.routeFor(cell);
      assert.ok(route, `route metadata exists for ${cell.foobarEntryKey}`);
      if (route.core) assert.ok(!side, `core case ${cell.foobarEntryKey} remains in the viewport at q=${q}`);
      if (route.hasArray && route.hasMatrix && !route.core && q >= .2 && q <= .4)
        assert.ok(side, `matched peripheral ${cell.foobarEntryKey} is fully parked during q=.2..4`);
      if (cell.foobarEntryKey === "retiring" && q === 0)
        assert.ok(!side, "ARRAY-only copy starts at its physical ARRAY position");
      if (cell.foobarEntryKey === "retiring" && q >= .2)
        assert.ok(side, `ARRAY-only cohort finishes its exit by q=.2 (sample=${q})`);
      if (cell.foobarEntryKey === "arriving" && q === .4)
        assert.ok(side, "MATRIX-only cohort begins fully parked at q=.4");
      if (cell.foobarEntryKey === "arriving" && q === 1)
        assert.ok(!side, "MATRIX-only copy reaches its physical MATRIX position");
      if (cell.foobarEntryKey === "near" && (q === 0 || q === 1))
        assert.ok(!side, `matched peripheral reaches a visible physical endpoint at q=${q}`);
    }
  }

  const sourcePhase = .2, sourceFrame = states.get(sourcePhase);
  const sourceMembers = ["retiring", "near", "wrap-a"];
  const cohortOffsetAt = (frame, key, mode, owner) => matrixPosition(frame.matricesByKey.get(key))
    .sub(endpointBasePosition(mode, owner, frame.frame.q, frame.frame.heading));
  const sourceOffsets = sourceMembers.map(key => cohortOffsetAt(sourceFrame, key, ARRAY, flight.sourceByKey.get(key)));
  for (const offset of sourceOffsets) assert.ok(offset.distanceTo(sourceOffsets[0]) < .001,
    "left-side ARRAY cases across matched and A-only segments share one cohort translation");
  const sourceStartOffset = cohortOffsetAt(states.get(0), "retiring", ARRAY, flight.sourceByKey.get("retiring"));
  const sourceMidOffset = cohortOffsetAt(states.get(.1), "retiring", ARRAY, flight.sourceByKey.get("retiring"));
  assert.ok(sourceStartOffset.length() < .001 && sourceMidOffset.length() > .001 &&
    sourceMidOffset.length() < sourceOffsets[0].length(), "A-only local translation grows gradually from q=0 to q=.2");
  const sourceLocal = sourceOffsets[0].clone().applyQuaternion(yawQuaternion(-sourceFrame.frame.heading));
  assert.ok(sourceLocal.x < 0 && Math.abs(sourceLocal.z) < .001, "left cohort exits along local -X");
  const sourceCoreZ = localZBounds(sourceFrame.matricesByKey, ["hero", "core-1", "core-2"], sourceFrame.frame.heading);
  const sourceBackZ = localZBounds(sourceFrame.matricesByKey, ["wrap-b"], sourceFrame.frame.heading);
  assert.ok(sourceCoreZ.min - sourceBackZ.max >= .059, "ARRAY front cohort clears the core envelope by .06");
  const sourceBackCell = flight.sourceByKey.get("wrap-b");
  const sourceBackOffset = matrixPosition(sourceFrame.matricesByKey.get("wrap-b"))
    .sub(endpointBasePosition(ARRAY, sourceBackCell, sourceFrame.frame.q, sourceFrame.frame.heading))
    .applyQuaternion(yawQuaternion(-sourceFrame.frame.heading));
  assert.ok(sourceBackOffset.z < 0 && Math.abs(sourceBackOffset.x) < .001, "front cohort exits along local -Z");

  const matrixPhase = .4, matrixFrame = states.get(matrixPhase);
  const matrixMembers = ["near", "arriving"];
  const matrixOffsets = matrixMembers.map(key => cohortOffsetAt(matrixFrame, key, MATRIX, flight.targetByKey.get(key)));
  assert.ok(matrixOffsets[0].distanceTo(matrixOffsets[1]) < .001,
    "left-side MATRIX cohort shares one translation across matched and incoming segments");
  const matrixLocal = matrixOffsets[0].clone().applyQuaternion(yawQuaternion(-matrixFrame.frame.heading));
  assert.ok(matrixLocal.x < 0 && Math.abs(matrixLocal.z) < .001, "left cohort enters along local -X");
  const matrixMidOffset = cohortOffsetAt(states.get(.7), "arriving", MATRIX, flight.targetByKey.get("arriving"));
  const matrixEndOffset = cohortOffsetAt(states.get(1), "arriving", MATRIX, flight.targetByKey.get("arriving"));
  assert.ok(matrixOffsets[1].length() > .001 && matrixMidOffset.length() > .001 && matrixEndOffset.length() < .001,
    "M-only translation eases from q=.4 and settles at its MATRIX endpoint");
  const matrixCoreZ = localZBounds(matrixFrame.matricesByKey, ["hero", "core-1", "core-2"], matrixFrame.frame.heading);
  const matrixFrontZ = localZBounds(matrixFrame.matricesByKey, ["wrap-b"], matrixFrame.frame.heading);
  assert.ok(matrixFrontZ.min - matrixCoreZ.max >= .059, "MATRIX rear cohort clears the core envelope by .06");
  const matrixBackOffset = matrixPosition(matrixFrame.matricesByKey.get("wrap-b"))
    .sub(endpointBasePosition(MATRIX, flight.targetByKey.get("wrap-b"), matrixFrame.frame.q, matrixFrame.frame.heading))
    .applyQuaternion(yawQuaternion(-matrixFrame.frame.heading));
  assert.ok(matrixBackOffset.z > 0 && Math.abs(matrixBackOffset.x) < .001, "rear cohort enters along local +Z");
});

test("matched peripheral baseline spacing morphs only across q=.2..4", () => {
  const flight = makeFlight("array", "matrix");
  const first = flight.plan.find(cell => cell.foobarEntryKey === "near");
  const second = flight.plan.find(cell => cell.foobarEntryKey === "near-next");
  const firstRoute = flight.transition.routeFor(first), secondRoute = flight.transition.routeFor(second);
  assert.equal(firstRoute.core, false);
  assert.equal(secondRoute.core, false);
  assert.equal(firstRoute.segment, secondRoute.segment, "adjacent matched cases share one rigid parking segment");
  for (const q of [.2, .3, .4]) {
    const frame = advanceToQ(flight, q, .0000001);
    const delta = matrixPosition(frame.matricesByKey.get("near-next"))
      .sub(matrixPosition(frame.matricesByKey.get("near")));
    const phase = smoothstep((q - .2) / .2);
    const expectedGap = 1 - .38 * phase;
    close(delta.length(), expectedGap, .002);
  }
});

test("one MATRIX cohort keeps matched and M-only multi-column and row spacing through entry", () => {
  const extraOffsets = {
    array: [
      ["cohort-c1-r8", 1, 8], ["cohort-c2-r8", 2, 8], ["cohort-c1-r9", 1, 9],
    ],
    matrix: [
      ["cohort-c1-r8", 1, 8], ["cohort-c2-r8", 2, 8], ["cohort-c1-r9", 1, 9],
      ["cohort-in-c2-r9", 2, 9], ["cohort-in-c3-r8", 3, 8], ["cohort-in-c3-r9", 3, 9],
      ["cohort-in-c4-r8", 4, 8],
    ],
  };
  const flight = makeFlight("array", "matrix", { extraOffsets });
  const pairs = [
    ["cohort-c1-r8", "cohort-c2-r8", "column"],
    ["cohort-c2-r8", "cohort-in-c3-r8", "column"],
    ["cohort-c2-r8", "cohort-in-c2-r9", "row"],
    ["cohort-in-c3-r8", "cohort-in-c3-r9", "row"],
  ];
  assert.equal(flight.transition.routeFor(flight.plan.find(cell => cell.foobarEntryKey === "cohort-c2-r8")).hasArray, true);
  assert.equal(flight.transition.routeFor(flight.plan.find(cell => cell.foobarEntryKey === "cohort-c2-r8")).hasMatrix, true);
  assert.equal(flight.transition.routeFor(flight.plan.find(cell => cell.foobarEntryKey === "cohort-in-c3-r8")).hasArray, false);
  assert.equal(flight.transition.routeFor(flight.plan.find(cell => cell.foobarEntryKey === "cohort-in-c3-r8")).hasMatrix, true);

  for (const q of [.4, .6, .8, 1]) {
    const frame = advanceToQ(flight, q, .0000001);
    const heading = yawQuaternion(frame.frame.heading);
    const column = new THREE.Vector3(MATRIX.spacing.column, 0, 0).applyQuaternion(heading);
    const row = new THREE.Vector3(0, 0, MATRIX.spacing.row).applyQuaternion(heading);
    for (const [from, to, axis] of pairs) {
      const actual = matrixPosition(frame.matricesByKey.get(to)).sub(matrixPosition(frame.matricesByKey.get(from)));
      const expected = axis === "column" ? column : row;
      assert.ok(actual.distanceTo(expected) < .0001,
        `${from}→${to} keeps target ${axis} spacing at q=${q} with shared rig yaw`);
    }
  }
});

test("a pre-existing hover aligns for .18s at fixed q, then follows the same q-only path in reverse", () => {
  const aligned = makeFlight("array", "matrix", { alignmentLift: .28 });
  assert.equal(aligned.transition.frame.q, 0);
  assert.equal(aligned.transition.frame.phase, "align");
  assert.equal(aligned.transition.frame.interactionSettling, true);
  const before = renderState(aligned);
  for (const key of ["hero", "core-1"]) {
    const sample = aligned.sourceSamples.find(value => value.cell.foobarEntryKey === key);
    assertMatrixNear(before.matricesByKey.get(key), sample.matrix, .00001, `initial aligned ${key}`);
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
  for (const key of ["hero", "core-1", "core-2", "near", "near-next", "wrap-a", "wrap-b"])
    assertMatrixNear(forward.matricesByKey.get(key), reverse.matricesByKey.get(key), .015, `aligned q-only ${key}`);
  assertMatrixNear(forward.rack.matrix, reverse.rack.matrix, .015, "aligned q-only rack");
  assert.ok(forward.camera.position.distanceTo(reverse.camera.position) < .0001, "camera path no longer contains elapsed-time residue");
  assert.ok(forward.aim.distanceTo(reverse.aim) < .0001);

  const beforeRetarget = renderState(aligned);
  const q = aligned.transition.frame.q, velocity = aligned.transition.frame.qVelocity;
  assert.equal(aligned.transition.retarget(true), true);
  close(aligned.transition.frame.q, q, 0);
  close(aligned.transition.frame.qVelocity, velocity, 0);
  const afterRetarget = renderState(aligned);
  for (const key of ["hero", "core-1", "near", "near-next"])
    assertMatrixNear(afterRetarget.matricesByKey.get(key), beforeRetarget.matricesByKey.get(key), .00001, `retarget-stable ${key}`);
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

test("1000 and 4000 entry pure-logic unions preserve every source and target owner in both directions", () => {
  for (const size of [1000, 4000]) {
    assertLargeUnion(size, "array");
    assertLargeUnion(size, "matrix");
  }
});

test("settled MATRIX owners rebind immediately and reverse back to the original ARRAY physical cells", () => {
  const forward = makeFlight("array", "matrix");
  moveToSettled(forward);
  const matrixSamples = [];
  for (const cell of forward.plan) {
    const owner = forward.transition.endpointCell(cell);
    if (!owner) continue;
    const matrix = forward.targetMatrices.get(owner.foobarEntryKey)?.clone();
    assert.ok(matrix, `normal MATRIX owner has a cached pose for ${owner.foobarEntryKey}`);
    matrixSamples.push({ cell: { ...owner }, matrix, restMatrix: matrix.clone(), alpha: 1, tint: 0 });
  }
  const selected = forward.transition.endpointSelection;
  assert.deepEqual(selected, forward.targetSelected);

  const reverse = makeFlightFromSamples(matrixSamples, selected, MATRIX, ARRAY);
  moveToSettled(reverse);
  assert.deepEqual(reverse.transition.endpointSelection, ARRAY.selected);
  for (const cell of reverse.plan) {
    const owner = reverse.transition.endpointCell(cell);
    if (!reverse.targetByKey.has(cell.foobarEntryKey)) continue;
    assert.deepEqual(owner, reverse.targetByKey.get(cell.foobarEntryKey));
  }
});

function makeFlightFromSamples(sourceSamples, sourceSelected, sourceMode, targetMode) {
  const sourceCamera = cameraEnd(sourceMode), targetCamera = cameraEnd(targetMode);
  const targetCells = [...modeCells(targetMode), { lane: -10000, row: -10000 }], targetSelected = { ...targetMode.selected };
  const targetByKey = new Map(targetCells.filter(cell => cell.foobarEntryKey).map(cell => [cell.foobarEntryKey, cell]));
  const transition = new MusicLayoutTransition();
  const sourceSelectedMatrix = sourceSamples.find(sample => sample.cell.foobarEntryKey === "hero").matrix;
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, sourceCamera.camera, sourceCamera.aim,
    sourceMode.spacing, targetMode === ARRAY, 4.45, -4.6, Number(sourceMode === ARRAY), new Map(), CENTER,
    sourceSelectedMatrix, { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() });
  const plan = transition.bindCells(targetCells, targetSelected, targetMode.spacing.row,
    cell => targetByKey.has(cell.foobarEntryKey), new Map());
  const targetHero = endpointMatrix(targetMode, targetSelected, true);
  transition.prepareTarget(matrixPosition(targetHero));
  const targetMatrices = new Map();
  for (const cell of plan) {
    const matrix = endpointMatrix(targetMode, targetByKey.get(cell.foobarEntryKey) ?? cell, cell.foobarEntryKey === "hero");
    if (cell.foobarEntryKey && targetByKey.has(cell.foobarEntryKey)) targetMatrices.set(cell.foobarEntryKey, matrix.clone());
    transition.primeTarget(cell, matrix, transition.isSelected(cell));
  }
  assert.equal(transition.targetsReady, true);
  const camera = sourceCamera.camera.clone(), aim = sourceCamera.aim.clone();
  transition.applyCamera(camera, aim, targetCamera.position, targetCamera.aim, targetCamera.span);
  return { transition, sourceName: sourceMode === ARRAY ? "array" : "matrix", targetName: targetMode === ARRAY ? "array" : "matrix",
    sourceMode, targetMode, sourceSelected: { ...sourceSelected }, targetSelected, sourceCells: sourceSamples.map(s => s.cell),
    targetCells, sourceByKey: new Map(sourceSamples.map(s => [s.cell.foobarEntryKey, s.cell])), targetByKey,
    sourceCamera, targetCamera, camera, aim, plan, targetMatrices };
}

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
