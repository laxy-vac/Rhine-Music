import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as THREE from "three";
import { MusicLayoutTransition } from "../src/music-layout-transition.ts";
import { deploymentStep } from "../src/music-shelf-deployment.ts";
import { musicArrayCompositionFrame } from "../src/music-layout-framing.ts";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "../src/music-display-layout.ts";
import { archiveFraming } from "../src/viewport-layout.ts";

const CENTER = new THREE.Vector3(0, 1.85, 0);
const CASE_BOUNDS = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
const CASE_BOUND_ARRAYS = { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() };
const ARRAY_EXTRA_GROUND = MUSIC_ARRAY_VIEW.floorY + CASE_BOUNDS.min.y - MUSIC_SHELF_VIEW.floorDrop;
const ARRAY_EXTRA_Y = ARRAY_EXTRA_GROUND - CASE_BOUNDS.max.y - .24;
// Frozen from e6ae98f, the pre-transition camera contract. MATRIX reused
// MUSIC_ARRAY_VIEW until the separate MATRIX framing policy was introduced.
const LEGACY_MATRIX_CAMERA = Object.freeze({
  yaw: 59, elevation: 25, span: 7.33, distance: 140,
  aim: Object.freeze({ x: -1.091, y: -.045, z: .481 }),
  detailYaw: 8, detailElevation: 20, detailDistance: 72,
});
const SCENE_SOURCE = await readFile(new URL("../src/scene.ts", import.meta.url), "utf8");
const LEGACY_ARRAY_FRAME = Object.freeze({ pixelsPerUnit: .54 * 98, referenceWidth: 936, referenceHeight: 731,
  portraitAspect: 1.05, portraitSpan: 10.5 });
function legacyViewportSpan(width, height, span, detail = 0) {
  width = Math.max(1, width); height = Math.max(1, height);
  const aspect = width / height, portrait = aspect < LEGACY_ARRAY_FRAME.portraitAspect;
  const baseSpan = span + (5.9 - span) * detail;
  const portraitDetailSpan = Math.max(6.3 / aspect, 3.7 * height / Math.max(100, .54 * height - 156));
  return portrait
    ? Math.max(baseSpan, 8.4 / aspect + (portraitDetailSpan - 8.4 / aspect) * detail)
    : Math.max(baseSpan, baseSpan * (16 / 9) / aspect);
}
function legacyArrayFrame(width, height, availableWidth, arrayScale) {
  width = Math.max(1, width); height = Math.max(1, height);
  availableWidth = Math.max(1, availableWidth);
  const scale = Math.max(.01, arrayScale);
  const zoom = THREE.MathUtils.clamp(Math.min(availableWidth / LEGACY_ARRAY_FRAME.referenceWidth,
    height / LEGACY_ARRAY_FRAME.referenceHeight), 1, 1.6);
  const span = height / (LEGACY_ARRAY_FRAME.pixelsPerUnit * zoom * scale);
  const portrait = width / height < LEGACY_ARRAY_FRAME.portraitAspect;
  return { span, effectiveSpan: portrait ? legacyViewportSpan(width, height, LEGACY_ARRAY_FRAME.portraitSpan) / scale : span };
}
function legacyMatrixSpan(width, height, detail = 0, compact = false) {
  // `compact` affects detail placement, not the legacy visible-height rule.
  void compact;
  return legacyViewportSpan(width, height, LEGACY_MATRIX_CAMERA.span, detail);
}
const MATRIX_OVERVIEW_SPAN = legacyMatrixSpan(1600, 1000);
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
  aim: new THREE.Vector3(LEGACY_MATRIX_CAMERA.aim.x, LEGACY_MATRIX_CAMERA.aim.y, LEGACY_MATRIX_CAMERA.aim.z),
  yaw: LEGACY_MATRIX_CAMERA.yaw, elevation: LEGACY_MATRIX_CAMERA.elevation,
  distance: LEGACY_MATRIX_CAMERA.distance, span: MATRIX_OVERVIEW_SPAN,
  offsets: latticeOffsets(GRID_ROWS * 2),
};
const STEP = 1 / 120;
const MAX_FRAMES = 50000;

function close(actual, expected, epsilon = 1e-6) {
  assert.ok(Number.isFinite(actual), `expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

test("pre-transition ARRAY and MATRIX camera contracts remain independent", () => {
  assert.deepEqual({ yaw: MUSIC_ARRAY_VIEW.yaw, elevation: MUSIC_ARRAY_VIEW.elevation, span: MUSIC_ARRAY_VIEW.span,
    distance: MUSIC_ARRAY_VIEW.distance, aim: MUSIC_ARRAY_VIEW.aim }, {
    yaw: LEGACY_MATRIX_CAMERA.yaw, elevation: LEGACY_MATRIX_CAMERA.elevation, span: LEGACY_MATRIX_CAMERA.span,
    distance: LEGACY_MATRIX_CAMERA.distance, aim: LEGACY_MATRIX_CAMERA.aim,
  }, "e6ae98f used the shared MUSIC_ARRAY_VIEW contract for ordinary MATRIX");
  const viewports = [
    { name: "16:9", width: 1920, height: 1080, compact: false },
    { name: "16:10", width: 1600, height: 1000, compact: false },
    { name: "portrait", width: 390, height: 844, compact: true },
  ];
  for (const viewport of viewports) {
    const overviewSpan = legacyMatrixSpan(viewport.width, viewport.height, 0, viewport.compact);
    const detailSpan = legacyMatrixSpan(viewport.width, viewport.height, 1, viewport.compact);
    close(archiveFraming(viewport.width, viewport.height, LEGACY_MATRIX_CAMERA.span, 0, viewport.compact).span, overviewSpan);
    close(archiveFraming(viewport.width, viewport.height, LEGACY_MATRIX_CAMERA.span, 1, viewport.compact).span, detailSpan);
    const camera = new THREE.PerspectiveCamera(34, viewport.width / viewport.height, 5, 300);
    const aim = new THREE.Vector3(LEGACY_MATRIX_CAMERA.aim.x, LEGACY_MATRIX_CAMERA.aim.y, LEGACY_MATRIX_CAMERA.aim.z);
    const direction = outward(LEGACY_MATRIX_CAMERA);
    camera.position.copy(aim).addScaledVector(direction, LEGACY_MATRIX_CAMERA.distance);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(overviewSpan / (2 * LEGACY_MATRIX_CAMERA.distance)));
    close(camera.position.distanceTo(aim), 140);
    close(visibleSpan(camera, aim), overviewSpan, .00001);
    close(THREE.MathUtils.radToDeg(Math.atan2(-direction.x, direction.z)), 59, .00001);
    close(THREE.MathUtils.radToDeg(Math.asin(direction.y)), 25, .00001);
    close(THREE.MathUtils.lerp(LEGACY_MATRIX_CAMERA.yaw, LEGACY_MATRIX_CAMERA.detailYaw, 1), 8, .00001);
    close(THREE.MathUtils.lerp(LEGACY_MATRIX_CAMERA.elevation, LEGACY_MATRIX_CAMERA.detailElevation, 1), 20, .00001);
    close(THREE.MathUtils.lerp(LEGACY_MATRIX_CAMERA.distance, LEGACY_MATRIX_CAMERA.detailDistance, 1), 72, .00001);
    assert.equal(legacyMatrixSpan(viewport.width, viewport.height, 0), overviewSpan,
      `${viewport.name}: MATRIX span depends on viewport only, not ARRAY scale or catalog length`);
  }
});

test("ArchiveScene routes ordinary MATRIX through the legacy shared camera frame", () => {
  assert.match(SCENE_SOURCE,
    /const arrayCamera = musicLibrary && !cinematic \? this\.shelfView[\s\S]*?: MUSIC_ARRAY_VIEW : undefined;/,
    "ordinary MATRIX resolves to MUSIC_ARRAY_VIEW when the shelf override is inactive");
  assert.match(SCENE_SOURCE,
    /const span = arrayCamera\?\.span \?\? THREE\.MathUtils\.lerp\([\s\S]*?\n\s*7\.33,\n\s*settle,\n\s*\);/,
    "the shared camera retains the old 7.33 span target");
  assert.match(SCENE_SOURCE,
    /const distance = THREE\.MathUtils\.lerp\([\s\S]*?arrayCamera\?\.distance \?\? THREE\.MathUtils\.lerp\(28 \+ 7 \* orbit, 140, settle\),\n\s*72,\n\s*detail,\n\s*\);/,
    "the shared camera retains the old 140-to-72 distance rule");
  assert.match(SCENE_SOURCE, /archiveFraming\(width, height, span, detail,/,
    "Scene applies the established viewport framing to MATRIX");
  assert.match(SCENE_SOURCE, /const arrayComposition = localArray \? this\.arrayComposition\(\) : undefined;/,
    "ARRAY composition and arrayScale stay scoped to local ARRAY mode");
  assert.match(SCENE_SOURCE, /const cameraPosition = cameraAim\s*\.clone\(\)\s*\.addScaledVector\(viewDirection, distance\);/,
    "Scene derives the MATRIX camera position from the legacy aim, angle and distance");
  assert.doesNotMatch(SCENE_SOURCE,
    /\b(?:matrixOverview|matrixNormalSpan|matrixMusicIntro)\b|MUSIC_MATRIX_VIEW|musicMatrixOverviewSpan|musicMatrixResidentFrame/,
    "no MATRIX-specific framing override replaces the shared endpoints");
});

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
  pose.position.y = ARRAY_EXTRA_Y;
  pose.rotation.identity();
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

function expectedRiseSchedule(flight, route) {
  const residents = flight.plan.map(cell => flight.transition.routeFor(cell))
    .filter(candidate => candidate?.resident).map(candidate => candidate.arrayCell);
  const columns = new Map();
  for (const cell of residents) {
    const column = columns.get(cell.lane) ?? { min: cell.row, max: cell.row };
    column.min = Math.min(column.min, cell.row);
    column.max = Math.max(column.max, cell.row);
    columns.set(cell.lane, column);
  }
  const selected = flight.plan.find(cell => flight.transition.isSelected(cell));
  const selectedRoute = selected && flight.transition.routeFor(selected);
  assert.ok(selectedRoute?.arrayCell, "the selected actor anchors the rise schedule");
  const cell = route.arrayCell;
  const edgeDistance = route.resident ? 0 : Math.min(...[...columns].map(([lane, range]) => {
    const rowGap = cell.row < range.min ? range.min - cell.row : cell.row > range.max ? cell.row - range.max : 0;
    return Math.hypot(4 * (cell.lane - lane), rowGap);
  }));
  const alongDistance = Math.abs(cell.row - selectedRoute.arrayCell.row) * .36;
  const start = .18 + .34 * (1 - Math.exp(-(edgeDistance + alongDistance) / 9));
  return { edgeDistance, alongDistance, start, end: start + .44 };
}

function assertRiseRoutesAtQ(flight, q, label) {
  const extras = [];
  const residentsByLane = new Map();
  for (const cell of flight.plan) {
    const route = flight.transition.routeFor(cell);
    if (!route) continue;
    const rise = route.rise;
    assert.ok(rise && typeof rise === "object", `${label}: ${cell.foobarEntryKey} exposes its rise schedule`);
    const expected = expectedRiseSchedule(flight, route);
    close(rise.edgeDistance, expected.edgeDistance, .000001);
    close(rise.alongDistance, expected.alongDistance, .000001);
    close(rise.start, expected.start, .000001);
    close(rise.end, expected.end, .000001);
    const amount = deploymentStep(q, expected.start, expected.end);
    close(rise.amount, amount, .000001);
    close(rise.lift, route.resident ? .22 * Math.sin(Math.PI * amount) ** 2 : 0, .000001);
    if (route.resident) {
      const rows = residentsByLane.get(route.arrayCell.lane) ?? [];
      rows.push({ row: route.arrayCell.row, start: rise.start });
      residentsByLane.set(route.arrayCell.lane, rows);
    } else extras.push({ route, amount });
  }
  if (extras.length) {
    const starts = extras.map(item => item.route.rise.start);
    assert.ok(Math.max(...starts) - Math.min(...starts) > .1,
      `${label}: extras at different boundary distances start at different q values`);
    const qMid = .5;
    const midAmounts = extras.map(item => deploymentStep(qMid, item.route.rise.start, item.route.rise.end));
    assert.ok(Math.max(...midAmounts) - Math.min(...midAmounts) > .1,
      `${label}: extras are at visibly different rise phases through the midpoint`);
    const byLane = new Map();
    for (const item of extras) {
      const rows = byLane.get(item.route.arrayCell.lane) ?? [];
      rows.push({ row: item.route.arrayCell.row, start: item.route.rise.start });
      byLane.set(item.route.arrayCell.lane, rows);
    }
    for (const [lane, rows] of byLane) {
      rows.sort((a, b) => a.row - b.row);
      for (let index = 1; index < rows.length; index++) {
        const before = extras.find(item => item.route.arrayCell.lane === lane && item.route.arrayCell.row === rows[index - 1].row);
        const after = extras.find(item => item.route.arrayCell.lane === lane && item.route.arrayCell.row === rows[index].row);
        const distanceDelta = (after.route.rise.edgeDistance + after.route.rise.alongDistance) -
          (before.route.rise.edgeDistance + before.route.rise.alongDistance);
        const startGap = rows[index].start - rows[index - 1].start;
        if (distanceDelta !== 0) assert.ok((distanceDelta > 0) === (startGap > 0),
          `${label}: neighboring extra rise starts follow their combined boundary distance`);
        assert.ok(Math.abs(startGap) <= .055,
          `${label}: neighboring extra rows have continuous rise starts (${startGap})`);
      }
    }
  }
  const selection = flight.plan.find(cell => flight.transition.isSelected(cell));
  const selectedRow = flight.transition.routeFor(selection).arrayCell.row;
  for (const rows of residentsByLane.values()) {
    rows.sort((a, b) => a.row - b.row);
    for (let index = 1; index < rows.length; index++) {
      const before = Math.abs(rows[index - 1].row - selectedRow), after = Math.abs(rows[index].row - selectedRow);
      if (before !== after) assert.ok((after > before) === (rows[index].start > rows[index - 1].start),
        `${label}: resident rise timing follows distance from selection`);
      assert.ok(Math.abs(rows[index].start - rows[index - 1].start) <= .02,
        `${label}: neighboring resident rise schedules remain close`);
    }
  }
}

function expectedRelativePosition(flight, cell, q, heading, arrayPoseCache = new Map()) {
  const hero = flight.plan.find(candidate => flight.transition.isSelected(candidate));
  assert.ok(hero, "selected hero exists in the bound lattice");
  const arrayPose = arrayEndpointPose(flight, cell, arrayPoseCache);
  const matrixPose = matrixEndpointPose(flight, cell);
  const arrayHero = arrayEndpointPose(flight, hero, arrayPoseCache);
  const matrixHero = matrixEndpointPose(flight, hero);
  const route = flight.transition.routeFor(cell), heroRoute = flight.transition.routeFor(hero);
  const blend = deploymentStep(q);
  const expected = arrayPose.position.clone().sub(arrayHero.position)
    .lerp(matrixPose.position.clone().sub(matrixHero.position), blend)
  const itemAmount = deploymentStep(q, route.rise.start, route.rise.end);
  const heroAmount = deploymentStep(q, heroRoute.rise.start, heroRoute.rise.end);
  const itemLift = route.resident ? .22 * Math.sin(Math.PI * itemAmount) ** 2 : 0;
  const heroLift = .22 * Math.sin(Math.PI * heroAmount) ** 2;
  if (route.resident) expected.y += itemLift - heroLift;
  else expected.y = THREE.MathUtils.lerp(arrayPose.position.y, matrixPose.position.y,
    itemAmount) -
    THREE.MathUtils.lerp(arrayHero.position.y, matrixHero.position.y, blend) - heroLift;
  return expected.applyQuaternion(yawQuaternion(heading));
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
    const route = flight.transition.routeFor(cell), heroRoute = flight.transition.routeFor(hero);
    const sampleRise = value => ({ start: value.start, end: value.end,
      amount: deploymentStep(state.frame.q, value.start, value.end) });
    vectorNear(actual, expected, .025, `single deploymentStep pose for ${id} at q=${state.frame.q.toFixed(3)} ` +
      `itemRise=${JSON.stringify(sampleRise(route.rise))} heroRise=${JSON.stringify(sampleRise(heroRoute.rise))}`);
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
  const expectedIds = flight.plan.filter(cell => flight.transition.routeFor(cell))
    .map(cell => flight.transition.occurrenceId(cell)).sort();
  assert.deepEqual([...state.matricesById.keys()].sort(), expectedIds,
    `${label} keeps the same physical actor identities in the scene`);
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
  close(arrayToMatrix.targetCamera.position.distanceTo(arrayToMatrix.targetCamera.aim), LEGACY_MATRIX_CAMERA.distance, .00001);
  vectorNear(arrayToMatrix.targetCamera.aim, MATRIX.aim, .00001, "MATRIX retains the legacy overview aim");
  close(visibleSpan(arrayToMatrix.targetCamera.camera, arrayToMatrix.targetCamera.aim), MATRIX.span, .03);
  assert.ok(arrayToMatrix.targetCamera.position.y < arrayToMatrix.sourceCamera.position.y,
    "MATRIX endpoint camera must sit lower in world space");
  assertCameraEndpoint(arrayEnd.camera, arrayEnd.aim, arrayToMatrix.targetCamera);

  const matrixEnd = moveToSettled(matrixToArray);
  assert.deepEqual(matrixToArray.transition.endpointSelection, matrixToArray.targetSelected);
  assertTargetPoses(matrixToArray, matrixEnd);
  assertCameraEndpoint(matrixEnd.camera, matrixEnd.aim, matrixToArray.targetCamera);
});

test("MATRIX loop copies retain unique physical occurrences and submerged ARRAY endpoints", () => {
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

  const forwardFlight = makeFlight("array", "matrix"), reverseFlight = makeFlight("matrix", "array");
  const qSamples = [0, .1, .2, .35, .5, .65, .8, .9, 1];
  const previousY = new Map();
  const forwardStates = new Map(), reverseStates = new Map();
  const expectedGround = q => THREE.MathUtils.lerp(-4.63, ARRAY_EXTRA_GROUND,
    1 - deploymentStep(q, .65, .95));
  for (const q of qSamples) {
    const forwardState = advanceToQ(forwardFlight, q, .0000001);
    forwardStates.set(q, forwardState);
    close(forwardState.frame.extraRise, deploymentStep(q, .18, .96), .000001);
    close(forwardState.frame.groundY, expectedGround(q), .000001);
    assertRiseRoutesAtQ(forwardFlight, forwardState.frame.q, `ARRAY→MATRIX q=${q}`);
    for (const cell of forwardFlight.plan) {
      const route = forwardFlight.transition.routeFor(cell);
      if (!route || route.resident) continue;
      const id = forwardFlight.transition.occurrenceId(cell);
      const address = `${cell.foobarEntryKey}|${route.arrayCell.lane}|${route.arrayCell.row}`;
      assert.equal(forwardFlight.transition.isExtra(cell), true, `${id} is an extra physical occurrence`);
      const matrix = forwardState.matricesById.get(id);
      const position = matrixPosition(matrix);
      const arrayY = arrayEndpointPose(forwardFlight, cell).position.y;
      const matrixY = matrixEndpointPose(forwardFlight, cell).position.y;
      close(position.y, THREE.MathUtils.lerp(arrayY, matrixY, route.rise.amount), .015);
      assert.ok(basisLengths(matrix).every(value => Math.abs(value - 1) < 1e-7), `${id} stays full size at q=${q}`);
      assert.equal(forwardState.appearances.get(id).alpha, 1, `${id} stays opaque at q=${q}`);
      const previous = previousY.get(address);
      if (previous != null) assert.ok(position.y >= previous - .015, `${id} rises monotonically as q increases`);
      previousY.set(address, position.y);
      if (q === 0) {
        const top = Math.max(...transformedCorners(matrix).map(point => point.y));
        assert.ok(top < forwardState.frame.groundY - .239, `${id} begins completely below the opaque floor`);
      }
    }
  }
  for (const q of [...qSamples].reverse()) {
    const reverseState = advanceToQ(reverseFlight, q, .0000001);
    reverseStates.set(q, reverseState);
    close(reverseState.frame.extraRise, deploymentStep(q, .18, .96), .000001);
    close(reverseState.frame.groundY, expectedGround(q), .000001);
    assertRiseRoutesAtQ(reverseFlight, reverseState.frame.q, `MATRIX→ARRAY q=${q}`);
    for (const cell of reverseFlight.plan) {
      const route = reverseFlight.transition.routeFor(cell);
      if (!route || route.resident) continue;
      const id = reverseFlight.transition.occurrenceId(cell);
      const matrix = reverseState.matricesById.get(id);
      const expectedY = THREE.MathUtils.lerp(arrayEndpointPose(reverseFlight, cell).position.y,
        matrixEndpointPose(reverseFlight, cell).position.y, route.rise.amount);
      close(matrixPosition(matrix).y, expectedY, .015);
      assert.ok(basisLengths(matrix).every(value => Math.abs(value - 1) < 1e-7), `${id} stays full size in reverse at q=${q}`);
      assert.equal(reverseState.appearances.get(id).alpha, 1, `${id} stays opaque in reverse at q=${q}`);
    }
  }
  for (const q of qSamples) {
    const forwardState = forwardStates.get(q), reverseState = reverseStates.get(q);
    const reverseByAddress = new Map();
    for (const cell of reverseFlight.plan) {
      const route = reverseFlight.transition.routeFor(cell);
      if (route && !route.resident) reverseByAddress.set(`${cell.foobarEntryKey}|${route.arrayCell.lane}|${route.arrayCell.row}`, cell);
    }
    for (const cell of forwardFlight.plan) {
      const route = forwardFlight.transition.routeFor(cell);
      if (!route || route.resident) continue;
      const address = `${cell.foobarEntryKey}|${route.arrayCell.lane}|${route.arrayCell.row}`;
      const reverseCell = reverseByAddress.get(address);
      assert.ok(reverseCell, `${address} retains its paired reverse occurrence`);
      const id = forwardFlight.transition.occurrenceId(cell), reverseId = reverseFlight.transition.occurrenceId(reverseCell);
      assertMatrixNear(forwardState.matricesById.get(id), reverseState.matricesById.get(reverseId), .015,
        `${address} has the same pose in both directions at q=${q}`);
    }
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

test("resident actors keep identity, opacity and unit scale while the camera clips naturally", () => {
  const flights = [makeFlight("array", "matrix"), makeFlight("matrix", "array")];
  const qSamples = Array.from({ length: 21 }, (_, index) => index / 20);
  for (const flight of flights) {
    assertResidentRoutes(flight);
    const sourceIds = new Set(flight.sourceSamples.map(sample => sample.cell.motionId));
    const residentLiftTracks = new Map();
    const sampleOrder = flight.sourceName === "array" ? qSamples : [...qSamples].reverse();
    for (const q of sampleOrder) {
      const state = advanceToQ(flight, q, .0000001);
      assertRiseRoutesAtQ(flight, state.frame.q, `${flight.sourceName}→${flight.targetName} q=${q}`);
      assertAllActorsPresentAndOpaque(flight, state, `${flight.sourceName}→${flight.targetName} q=${q}`);
      assertDirectLatticePath(flight, state);
      assertNoCaseOverlaps(state, `${flight.sourceName}→${flight.targetName} q=${q}`);
      for (const id of sourceIds) {
        assert.ok(state.matricesById.has(id), `existing physical occurrence ${id} remains present at q=${q}`);
      }
      for (const cell of flight.plan) {
        const route = flight.transition.routeFor(cell);
        if (!route?.resident) continue;
        const id = flight.transition.occurrenceId(cell), track = residentLiftTracks.get(id) ?? [];
        track.push({ q: state.frame.q, lift: route.rise.lift, start: route.rise.start, row: route.arrayCell.row });
        residentLiftTracks.set(id, track);
      }
    }
    const selected = flight.plan.find(cell => flight.transition.isSelected(cell));
    const selectedRoute = flight.transition.routeFor(selected), selectedRow = selectedRoute.arrayCell.row;
    close(selectedRoute.rise.start, .18, .000001);
    close(selectedRoute.rise.end, .62, .000001);
    for (const [id, track] of residentLiftTracks) {
      const ordered = track.sort((a, b) => a.q - b.q);
      assert.ok(ordered.length === qSamples.length, `${id} keeps a sampled resident lift track`);
      close(ordered[0].lift, 0, .000001);
      close(ordered.at(-1).lift, 0, .000001);
      const peak = Math.max(...ordered.map(sample => sample.lift));
      assert.ok(peak > .19, `${id} receives the resident float lift (peak=${peak})`);
      const peakIndex = ordered.findIndex(sample => sample.lift === peak);
      assert.ok(ordered.slice(1, peakIndex + 1).every((sample, index) =>
        sample.lift + .001 >= ordered[index].lift), `${id} resident lift rises to one peak`);
      assert.ok(ordered.slice(peakIndex + 1).every((sample, index) =>
        sample.lift <= ordered[peakIndex + index].lift + .001), `${id} resident lift falls after its peak`);
    }
    for (const lane of [...new Set([...residentLiftTracks.keys()].map(id => {
      const cell = flight.plan.find(candidate => flight.transition.occurrenceId(candidate) === id);
      return flight.transition.routeFor(cell).arrayCell.lane;
    }))]) {
      const rows = [...residentLiftTracks.entries()].map(([id, track]) => {
        const cell = flight.plan.find(candidate => flight.transition.occurrenceId(candidate) === id);
        const route = flight.transition.routeFor(cell);
        return route.arrayCell.lane === lane ? { row: route.arrayCell.row, start: track[0].start } : null;
      }).filter(Boolean).sort((a, b) => a.row - b.row);
      for (let index = 1; index < rows.length; index++) {
        const previousDistance = Math.abs(rows[index - 1].row - selectedRow);
        const currentDistance = Math.abs(rows[index].row - selectedRow);
        if (previousDistance !== currentDistance)
          assert.ok((currentDistance > previousDistance) === (rows[index].start > rows[index - 1].start),
            `resident lane ${lane} rises in ordered waves away from the selected row`);
        assert.ok(Math.abs(rows[index].start - rows[index - 1].start) <= .02,
          `resident lane ${lane} keeps adjacent rise starts close`);
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

test("responsive ARRAY framing matches the legacy scale rule while MATRIX keeps its own legacy frame", () => {
  const bounds = { min: CASE_BOUNDS.min.toArray(), max: CASE_BOUNDS.max.toArray() };
  const cases = [
    { name: "Future", width: 1920, height: 1080, availableWidth: 1100, scale: .8, compact: false },
    { name: "Punk", width: 1920, height: 1080, availableWidth: 1920, scale: .8, compact: false },
    { name: "portrait", width: 390, height: 844, availableWidth: 390, scale: .8, compact: true },
  ];
  const frames = cases.map(viewport => {
    const frame = musicArrayCompositionFrame(viewport.width, viewport.height, viewport.availableWidth,
      viewport.scale, -1, bounds, CENTER, viewport.compact);
    const legacy = legacyArrayFrame(viewport.width, viewport.height, viewport.availableWidth, viewport.scale);
    close(frame.span, legacy.span);
    close(frame.effectiveSpan, legacy.effectiveSpan);
    close(frame.availableWidth, viewport.availableWidth);
    assert.ok(frame.effectiveSpan > 0 && Number.isFinite(frame.effectiveSpan));
    return frame;
  });
  const [future, punk, portrait] = frames;
  const normalScale = musicArrayCompositionFrame(1920, 1080, 1920, 1, -1, bounds, CENTER, false);
  assert.ok(future.effectiveSpan > punk.effectiveSpan,
    "the narrower archive reading pane preserves the legacy ARRAY viewport response");
  assert.ok(punk.effectiveSpan > normalScale.effectiveSpan,
    "arrayScale .8 widens ARRAY relative to scale 1, as in the old rule");
  assert.ok(portrait.effectiveSpan > 0, "portrait ARRAY framing uses the legacy portrait response");
  for (const viewport of cases) {
    const matrixSpan = legacyMatrixSpan(viewport.width, viewport.height);
    close(matrixSpan, legacyViewportSpan(viewport.width, viewport.height, 7.33, 0));
    close(archiveFraming(viewport.width, viewport.height, MUSIC_ARRAY_VIEW.span, 0, viewport.compact).span, matrixSpan);
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
