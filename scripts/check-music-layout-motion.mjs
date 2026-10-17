import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicMatrixDrag } from "../src/music-matrix-drag.ts";
import {
  MusicLayoutTransition,
  musicGeometryPose,
  shelfEntryCamera,
  shelfEntryFrame,
  shelfEntryPose,
} from "../src/music-layout-transition.ts";
import { shelfAssemblySlot, shelfDeployment, shelfSlotDeployment } from "../src/music-shelf-deployment.ts";

const axisAligned = {
  lane: { x: 100, y: 0 },
  row: { x: 0, y: 100 },
};

function close(actual, expected, epsilon = 1e-6) {
  assert.ok(Number.isFinite(actual), `expected a finite number, got ${actual}`);
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function assertPosition(actual, expected, epsilon = 1e-6) {
  assert.ok(actual, "expected an active position");
  close(actual.lane, expected.lane, epsilon);
  close(actual.row, expected.row, epsilon);
}

function assertFiniteVector(vector) {
  assert.ok(vector.toArray().every(Number.isFinite), "expected a finite vector");
}

function visibleSpan(camera, aim) {
  return 2 * camera.position.distanceTo(aim) *
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}

function matrixAt(position, scale = new THREE.Vector3(1, 1, 1), rotation = new THREE.Quaternion()) {
  return new THREE.Matrix4().compose(position.clone(), rotation.clone(), scale.clone());
}

function assertMatrixClose(actual, expected, epsilon = 1e-6) {
  for (let index = 0; index < 16; index++) close(actual.elements[index], expected.elements[index], epsilon);
}

function matrixPose(matrix) {
  const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  matrix.decompose(position, rotation, scale);
  return { position, rotation, scale };
}

function matrixBasisLengths(matrix) {
  const e = matrix.elements;
  return [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
}

test("musicGeometryPose preserves actual dimensions for zero and partially-zero matrices", () => {
  const zero = matrixAt(new THREE.Vector3(3, -2, 7), new THREE.Vector3(0, 0, 0));
  const naiveZero = matrixPose(zero).scale;
  assert.deepEqual(naiveZero.toArray(), [1, 1, 1], "Three decompose reports unit scale for a singular matrix");
  const zeroPose = musicGeometryPose(zero);
  assert.deepEqual(zeroPose.scale.toArray(), [0, 0, 0]);
  assert.deepEqual(zeroPose.position.toArray(), [3, -2, 7]);

  const partial = matrixAt(new THREE.Vector3(-1, 4, 2), new THREE.Vector3(0, 2, 3),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .37));
  const naivePartial = matrixPose(partial).scale;
  assert.deepEqual(naivePartial.toArray(), [1, 1, 1], "Three decompose cannot recover a zero axis");
  const partialPose = musicGeometryPose(partial);
  assert.deepEqual(partialPose.scale.toArray(), [0, 2, 3]);
  assert.deepEqual(partialPose.position.toArray(), [-1, 4, 2]);
});

function transitionCase(toShelf, sourceYaw = 0, reverseTargetPool = false,
  sourceCatalog = new Map(), targetCatalog = new Map(), sourceHover = 0, cameraAspect = 16 / 10) {
  const sourceSelected = { lane: 2, row: 12, foobarEntryKey: "selected" };
  const targetSelected = { lane: 5, row: 20, foobarEntryKey: "selected" };
  const sourceHeading = toShelf ? 0 : Math.PI;
  const targetHeading = toShelf ? Math.PI : 0;
  const sourceRow = toShelf ? .62 : 1;
  const targetRow = toShelf ? 1 : .62;
  const sourceAnchor = new THREE.Vector3(-.4, -4.6, .25);
  const targetAnchor = new THREE.Vector3(1.2, -4.6, -2.17);
  const sourceSelectedRestMatrix = matrixAt(sourceAnchor, new THREE.Vector3(1.1, .9, 1));
  const sourceSelectedActualMatrix = sourceSelectedRestMatrix.clone();
  sourceSelectedActualMatrix.setPosition(sourceAnchor.clone().add(new THREE.Vector3(0, sourceHover, 0)));
  const sourceSelectedMatrix = sourceSelectedActualMatrix;
  const camera = new THREE.PerspectiveCamera(62, cameraAspect, .1, 200);
  const aim = new THREE.Vector3(0, -4.2, 0);
  const sourceElevation = .12, sourceDistance = 20;
  camera.position.copy(aim).add(new THREE.Vector3(
    Math.sin(sourceYaw) * Math.cos(sourceElevation), Math.sin(sourceElevation),
    Math.cos(sourceYaw) * Math.cos(sourceElevation),
  ).multiplyScalar(sourceDistance));
  camera.lookAt(aim);
  const offsets = [
    { lane: 0, row: 1, key: "shared" },
    { lane: -1, row: 0, key: "source-only" },
  ];
  const sourceColumnSpacing = toShelf ? 5.2 : 4.95;
  const targetColumnSpacing = toShelf ? 4.95 : 5.2;
  const hoverOffset = new THREE.Vector3(0, sourceHover, 0);
  const sourceSamples = offsets.map(({ lane, row, key }) => {
    const cell = { lane: sourceSelected.lane + lane, row: sourceSelected.row + row, foobarEntryKey: key };
    const local = new THREE.Vector3(lane * sourceColumnSpacing, 0, row * sourceRow).applyAxisAngle(new THREE.Vector3(0, 1, 0), sourceHeading);
    const restPosition = sourceAnchor.clone().add(local);
    const restMatrix = matrixAt(restPosition, new THREE.Vector3(1, .8, 1));
    return { cell, restMatrix, matrix: matrixAt(restPosition.clone().add(hoverOffset), new THREE.Vector3(1, .8, 1)), alpha: 1, tint: .1 };
  });
  const targetOffsets = [
    { lane: 0, row: 0, key: "selected" },
    { lane: 0, row: 1, key: "shared" },
    { lane: 1, row: 0, key: "target-only" },
    { lane: -1, row: 1, key: "target-extra" },
  ];
  const targetCells = targetOffsets.map(({ lane, row, key }) => ({
    lane: targetSelected.lane + lane,
    row: targetSelected.row + row,
    foobarEntryKey: key,
  })).concat([{ lane: targetSelected.lane + 3, row: targetSelected.row + 3 }]);
  if (reverseTargetPool) targetCells.reverse();
  const targetMatrixFor = (cell) => {
    const lane = cell.lane - targetSelected.lane, row = cell.row - targetSelected.row;
    const local = new THREE.Vector3(lane * targetColumnSpacing, 0, row * targetRow).applyAxisAngle(new THREE.Vector3(0, 1, 0), targetHeading);
    return matrixAt(targetAnchor.clone().add(local), new THREE.Vector3(1, .8, 1));
  };
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, camera, aim,
    toShelf ? { column: 5.2, row: .62 } : { column: -4.95, row: -1 }, toShelf, 4.45, -4.6, Number(!toShelf),
    sourceCatalog, new THREE.Vector3(0, 1.85, 0), sourceSelectedRestMatrix);
  const union = transition.bindCells(targetCells, targetSelected, toShelf ? -1 : .62,
    cell => new Set(targetOffsets.map(item => item.key)).has(cell.foobarEntryKey), targetCatalog);
  transition.prepareTarget(targetAnchor);
  return { transition, sourceSelected, targetSelected, sourceSelectedMatrix, sourceSelectedRestMatrix,
    sourceSamples, targetCells, targetMatrixFor, targetAnchor, camera, aim, union, sourceRow, targetRow, sourceHover };
}

test("matrix drag waits for 10px, follows the camera center, and clears clicks", () => {
  const drag = new MusicMatrixDrag();
  drag.begin(100, 100, { lane: 2, row: 3 }, axisAligned, 0);

  assert.equal(drag.move(109.9, 100, 10), false);
  assert.equal(drag.dragging, false);
  assertPosition(drag.position, { lane: 2, row: 3 });

  assert.equal(drag.move(110, 100, 20), true);
  assert.equal(drag.dragging, true);
  assertPosition(drag.position, { lane: 1.9, row: 3 });
  assert.equal(drag.end(20), true);

  const click = new MusicMatrixDrag();
  click.begin(0, 0, { lane: 4, row: -2 }, axisAligned, 0);
  assert.equal(click.end(5), false);
  assert.equal(click.active, false);
  assert.equal(click.position, undefined);
});

test("oblique camera axes invert both positive and negative screen motion", () => {
  const axes = {
    lane: { x: 80, y: 40 },
    row: { x: -20, y: 60 },
  };
  const cases = [
    { lane: 1.5, row: -0.75 },
    { lane: -0.5, row: 1.25 },
  ];

  for (const projected of cases) {
    const drag = new MusicMatrixDrag();
    drag.begin(200, 300, { lane: 0, row: 0 }, axes, 0);
    const dx = projected.lane * axes.lane.x + projected.row * axes.row.x;
    const dy = projected.lane * axes.lane.y + projected.row * axes.row.y;
    assert.equal(drag.move(200 + dx, 300 + dy, 20), true);
    assertPosition(drag.position, {
      lane: -projected.lane,
      row: -projected.row,
    });
  }
});

test("a release after an 80ms pause snaps without carrying stale velocity", () => {
  const drag = new MusicMatrixDrag();
  drag.begin(0, 0, { lane: 0, row: 0 }, axisAligned, 0);
  drag.move(-20, 0, 20);
  drag.move(-40, 0, 40);
  const beforeRelease = drag.position;
  assertPosition(beforeRelease, { lane: 0.4, row: 0 });

  assert.equal(drag.end(121), true);
  assert.equal(drag.phase, "snapping");
  const afterStep = drag.step(0.05);
  assert.ok(afterStep.lane < beforeRelease.lane);

  for (let frame = 0; frame < 120 && !drag.settled; frame++) drag.step(1 / 60);
  assert.equal(drag.settled, true);
  assertPosition(drag.position, { lane: 0, row: 0 });
});

test("inertial motion stays finite and finishes exactly on integer cells", () => {
  const drag = new MusicMatrixDrag();
  drag.begin(0, 0, { lane: 2.25, row: -1.6 }, axisAligned, 0);
  drag.move(-20, 10, 20);
  drag.move(-40, 20, 40);
  assert.equal(drag.end(40), true);
  assert.equal(drag.phase, "coasting");

  let current;
  for (let frame = 0; frame < 1200 && !drag.settled; frame++) {
    current = drag.step(1 / 60);
    assert.ok(current);
    assert.ok(Number.isFinite(current.lane));
    assert.ok(Number.isFinite(current.row));
  }

  assert.equal(drag.settled, true);
  const finalPosition = drag.position;
  assert.ok(finalPosition);
  assert.equal(finalPosition.lane, Math.round(finalPosition.lane));
  assert.equal(finalPosition.row, Math.round(finalPosition.row));
  assertPosition(drag.step(1), finalPosition);
});

test("a new drag during coast continues from the current camera center", () => {
  const drag = new MusicMatrixDrag();
  drag.begin(0, 0, { lane: 1, row: 0 }, axisAligned, 0);
  drag.move(-20, 0, 20);
  drag.move(-40, 0, 40);
  drag.end(40);
  drag.step(0.05);
  const beforeNewDrag = drag.position;
  assert.ok(beforeNewDrag);

  drag.begin(100, 100, { lane: -500, row: 30 }, axisAligned, 50);
  assertPosition(drag.position, beforeNewDrag);
  assert.equal(drag.move(110, 100, 60), true);
  assertPosition(drag.position, {
    lane: beforeNewDrag.lane - 0.1,
    row: beforeNewDrag.row,
  });
});

const layoutStep = 1 / 120;
const layoutMaxFrames = 10 * 120;

function assertBoundedTransition(transition, label) {
  const { q, qVelocity } = transition.frame;
  assert.ok(Number.isFinite(q) && Number.isFinite(qVelocity), label + ": q/v must stay finite");
  assert.ok(q >= -1e-8 && q <= 1 + 1e-8, label + ": q must stay within [0, 1]");
  assert.ok(Math.abs(qVelocity) <= .35, label + ": q velocity must remain bounded");
}

function advanceUntil(transition, predicate, label = "transition threshold") {
  let frames = 0;
  while (!predicate() && frames < layoutMaxFrames) {
    transition.advance(layoutStep);
    frames++;
    assertBoundedTransition(transition, label);
  }
  assert.ok(predicate(), label + ": threshold not reached; q=" + transition.frame.q);
  return frames;
}

function advanceUntilQ(transition, targetQ, label = "q threshold") {
  return advanceUntil(transition, () => transition.frame.q >= targetQ, label + " (q>=" + targetQ + ")");
}

function advanceUntilSettled(transition, label = "transition") {
  let frames = 0;
  while (!transition.settled && frames < layoutMaxFrames) {
    transition.advance(layoutStep);
    frames++;
    assertBoundedTransition(transition, label);
  }
  assert.equal(transition.settled, true, label + ": did not settle within 10 seconds");
  return frames;
}

function assertRetargetKeepsMotionState(transition, cells, destination, label) {
  const before = { q: transition.frame.q, qVelocity: transition.frame.qVelocity,
    ids: cells.map(cell => cell.motionId ?? null) };
  assert.equal(transition.retarget(destination), true, label + ": expected retarget to be accepted");
  assert.equal(transition.frame.q, before.q, label + ": retarget must preserve q");
  assert.equal(transition.frame.qVelocity, before.qVelocity, label + ": retarget must preserve q velocity");
  assert.deepEqual(cells.map(cell => cell.motionId ?? null), before.ids, label + ": retarget must not rebind motion identities");
  assertBoundedTransition(transition, label);
}

function matricesAt(fixture) {
  const result = new Map();
  for (const cell of fixture.union) {
    const matrix = fixture.targetMatrixFor(cell);
    fixture.transition.apply(matrix, cell, cell.foobarEntryKey === "selected");
    const id = cell.foobarEntryKey ?? "empty:" + cell.lane + ":" + cell.row;
    result.set(id, matrix);
  }
  return result;
}

test("geometric layout transition preserves source and target poses and stages unmatched cases by size", () => {
  for (const toShelf of [true, false]) {
    const fixture = transitionCase(toShelf);
    const keys = fixture.union.map(cell => cell.foobarEntryKey).filter(Boolean);
    for (const key of ["selected", "shared", "source-only", "target-only", "target-extra"])
      assert.equal(keys.filter(value => value === key).length, 1, "expected one union cell for " + key);

    const sourceByKey = new Map(fixture.sourceSamples.map(sample => [sample.cell.foobarEntryKey, sample.matrix]));
    let previousOutgoing = Infinity;
    let previousIncoming = -Infinity;
    const sample = (endpoint, label) => {
      const matrices = matricesAt(fixture);
      const outgoingScale = matrixBasisLengths(matrices.get("source-only"))[0];
      const incomingScale = matrixBasisLengths(matrices.get("target-only"))[0];
      assert.ok(outgoingScale <= previousOutgoing + 1e-8, "source-only geometry must shrink continuously at " + label);
      assert.ok(incomingScale + 1e-8 >= previousIncoming, "incoming geometry must grow continuously at " + label);
      previousOutgoing = outgoingScale;
      previousIncoming = incomingScale;

      if (endpoint === "source") {
        assertMatrixClose(matrices.get("selected"), fixture.sourceSelectedMatrix);
        assertMatrixClose(matrices.get("shared"), sourceByKey.get("shared"));
        assertMatrixClose(matrices.get("source-only"), sourceByKey.get("source-only"));
        assert.ok(Math.abs(incomingScale) < 1e-6,
          "incoming matrix starts with zero size; direction=" + toShelf + ", progress=" +
            fixture.transition.progress + ", scale=" + incomingScale);
        close(matrixBasisLengths(matrices.get("target-extra"))[0], 0);
      }
      if (endpoint === "target") {
        assertMatrixClose(matrices.get("selected"), fixture.targetMatrixFor(fixture.targetCells.find(cell => cell.foobarEntryKey === "selected")));
        assertMatrixClose(matrices.get("shared"), fixture.targetMatrixFor(fixture.targetCells.find(cell => cell.foobarEntryKey === "shared")));
        assertMatrixClose(matrices.get("target-only"), fixture.targetMatrixFor(fixture.targetCells.find(cell => cell.foobarEntryKey === "target-only")));
        close(outgoingScale, 0);
        close(incomingScale, 1);
      }
    };
    sample("source", "q=0");
    for (const q of [.02, .05, .1, .14, .2, .3, .5, .7, .86, .9, .97]) {
      advanceUntilQ(fixture.transition, q, "geometry sample q=" + q);
      sample(undefined, "q=" + fixture.transition.frame.q);
    }
    advanceUntilSettled(fixture.transition, "normal endpoint");
    sample("target", "settled q=1");
  }
});

test("the union keeps explicit entry identities when the target pool order changes", () => {
  const forward = transitionCase(true);
  const reversed = transitionCase(true, 0, true);
  const expected = ["selected", "shared", "source-only", "target-only", "target-extra"].sort();
  const keysOf = fixture => fixture.union.map(cell => cell.foobarEntryKey).filter(Boolean).sort();
  assert.deepEqual(keysOf(forward), expected);
  assert.deepEqual(keysOf(reversed), expected);

  const byKey = fixture => new Map(fixture.union.filter(cell => cell.foobarEntryKey)
    .map(cell => [cell.foobarEntryKey, (cell.lane - fixture.targetSelected.lane) + ":" + (cell.row - fixture.targetSelected.row)]));
  assert.deepEqual([...byKey(forward)].sort(), [...byKey(reversed)].sort());
});

test("same-coordinate different entries receive independent retiring and arriving paths", () => {
  const sourceSelected = { lane: 2, row: 12, foobarEntryKey: "selected" };
  const targetSelected = { lane: 5, row: 20, foobarEntryKey: "selected" };
  const sourceAnchor = new THREE.Vector3(0, -4.6, 0);
  const targetAnchor = new THREE.Vector3(1, -4.6, -2);
  const sourceSelectedMatrix = matrixAt(sourceAnchor);
  const sourceCell = { lane: 3, row: 12, foobarEntryKey: "retiring" };
  const sourceMatrix = matrixAt(new THREE.Vector3(5.2, -4.6, 0));
  const targetCells = [
    { ...targetSelected },
    { lane: 6, row: 20, foobarEntryKey: "arriving" },
    { lane: 7, row: 20 },
  ];
  const transition = new MusicLayoutTransition();
  transition.begin([{ cell: sourceCell, matrix: sourceMatrix, alpha: .25, tint: .7 }], sourceSelected,
    sourceSelectedMatrix, new THREE.PerspectiveCamera(), new THREE.Vector3(),
    { column: 5.2, row: .62 }, true, 4.45, -4.6, 0);
  const union = transition.bindCells(targetCells, targetSelected, -1, cell => Boolean(cell.foobarEntryKey));
  transition.prepareTarget(targetAnchor);

  const retiring = union.find(cell => cell.foobarEntryKey === "retiring");
  const arriving = union.find(cell => cell.foobarEntryKey === "arriving");
  assert.ok(retiring && arriving);
  assert.equal(retiring.lane, arriving.lane);
  assert.equal(retiring.row, arriving.row);
  assert.notEqual(transition.occurrenceId(retiring), transition.occurrenceId(arriving));
  assert.deepEqual(transition.appearance(retiring, { alpha: 1, tint: .1 }), { alpha: .25, tint: .7 });
  assert.deepEqual(transition.appearance(arriving, { alpha: 1, tint: .1 }), { alpha: 1, tint: .1 });

  const targetPose = cell => matrixAt(new THREE.Vector3(
    targetAnchor.x + (cell.lane - targetSelected.lane) * -4.95,
    targetAnchor.y,
    targetAnchor.z + (cell.row - targetSelected.row) * -1,
  ));
  const retiringAtStart = targetPose(retiring);
  transition.apply(retiringAtStart, retiring);
  assertMatrixClose(retiringAtStart, sourceMatrix);
  const arrivingAtStart = targetPose(arriving);
  transition.apply(arrivingAtStart, arriving);
  close(Math.hypot(...matrixBasisLengths(arrivingAtStart)), 0);

  advanceUntilSettled(transition, "same-coordinate identity transition");
  assert.deepEqual(transition.appearance(retiring, { alpha: 1, tint: .1 }), { alpha: .25, tint: .7 });
  assert.deepEqual(transition.appearance(arriving, { alpha: 1, tint: .1 }), { alpha: 1, tint: .1 });
  const retiringAtEnd = targetPose(retiring);
  transition.apply(retiringAtEnd, retiring);
  close(Math.hypot(...matrixBasisLengths(retiringAtEnd)), 0);
  const arrivingTarget = targetPose(arriving);
  const arrivingAtEnd = arrivingTarget.clone();
  transition.apply(arrivingAtEnd, arriving);
  assertMatrixClose(arrivingAtEnd, arrivingTarget);
});

test("canonical catalog pairing survives the 21st entry when groups [7, 28, 3] are split", () => {
  const groupedCatalog = (groups, slotLimit = Infinity) => {
    const catalog = new Map();
    let laneStart = 0, order = 0;
    for (const length of groups) {
      for (let local = 0; local < length; local++) {
        const lane = laneStart + (Number.isFinite(slotLimit) ? Math.floor(local / slotLimit) : 0);
        const row = Number.isFinite(slotLimit) ? local % slotLimit : local;
        catalog.set("record-" + order, { lane, row, order });
        order++;
      }
      laneStart += Number.isFinite(slotLimit) ? Math.ceil(length / slotLimit) : 1;
    }
    return catalog;
  };
  const sourceCatalog = groupedCatalog([7, 28, 3]);
  const targetCatalog = groupedCatalog([7, 28, 3], 20);
  const selectedKey = "record-0", splitEntryKey = "record-27", tailEntryKey = "record-35";
  assert.equal(sourceCatalog.size, 38);
  assert.equal(targetCatalog.size, 38);
  assert.deepEqual(sourceCatalog.get(splitEntryKey), { lane: 1, row: 20, order: 27 });
  assert.deepEqual(targetCatalog.get(splitEntryKey), { lane: 2, row: 0, order: 27 });
  assert.deepEqual(sourceCatalog.get(tailEntryKey), { lane: 2, row: 0, order: 35 });
  assert.deepEqual(targetCatalog.get(tailEntryKey), { lane: 3, row: 0, order: 35 });

  const sourceSelected = { lane: 0, row: 0, foobarEntryKey: selectedKey };
  const targetSelected = { ...sourceSelected };
  const sourceAnchor = new THREE.Vector3(-.5, -4.6, .25);
  const targetAnchor = new THREE.Vector3(.75, -4.6, -2.17);
  const sourceSelectedMatrix = matrixAt(sourceAnchor);
  const sourceKeys = [splitEntryKey, tailEntryKey];
  const sourceSamples = sourceKeys.map(key => {
    const location = sourceCatalog.get(key);
    const cell = { lane: location.lane, row: location.row, foobarEntryKey: key };
    const position = sourceAnchor.clone().add(new THREE.Vector3(location.lane * 5.2, 0, location.row * .62));
    return { cell, matrix: matrixAt(position, new THREE.Vector3(1, .8, 1)), alpha: 1, tint: .1 };
  });
  const targetCells = [selectedKey, splitEntryKey, tailEntryKey].map(key => {
    const location = targetCatalog.get(key);
    return { lane: location.lane, row: location.row, foobarEntryKey: key };
  });
  const targetMatrixFor = cell => {
    const location = targetCatalog.get(cell.foobarEntryKey);
    const offset = new THREE.Vector3((location.lane - targetCatalog.get(selectedKey).lane) * 4.95, 0,
      (location.row - targetCatalog.get(selectedKey).row));
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    return matrixAt(targetAnchor.clone().add(offset), new THREE.Vector3(1, .8, 1));
  };
  const camera = new THREE.PerspectiveCamera(60, 16 / 10, .1, 200);
  camera.position.set(-1, 4, 18);
  const aim = new THREE.Vector3(0, -4, 0);
  camera.lookAt(aim);
  const transition = new MusicLayoutTransition();
  transition.begin(sourceSamples, sourceSelected, sourceSelectedMatrix, camera, aim,
    { column: 5.2, row: .62 }, true, 4.45, -4.6, 0, sourceCatalog);
  const union = transition.bindCells(targetCells, targetSelected, -1,
    cell => Boolean(cell.foobarEntryKey), targetCatalog);
  transition.prepareTarget(targetAnchor);
  assert.equal(transition.frame.matched, 2);

  const pairedCells = [];
  for (const key of [splitEntryKey, tailEntryKey]) {
    const cell = union.find(item => item.foobarEntryKey === key);
    const source = sourceSamples.find(sample => sample.cell.foobarEntryKey === key);
    assert.ok(cell && source);
    assert.equal(cell.lane, targetCatalog.get(key).lane);
    assert.equal(cell.row, targetCatalog.get(key).row);
    const start = targetMatrixFor(cell);
    transition.apply(start, cell);
    assertMatrixClose(start, source.matrix);
    pairedCells.push({ cell, source });
  }
  advanceUntilSettled(transition, "canonical split-group transition");
  for (const { cell } of pairedCells) {
    const end = targetMatrixFor(cell);
    const expected = end.clone();
    transition.apply(end, cell);
    assertMatrixClose(end, expected);
  }
});

test("one heading field stays continuous in both directions and midpoint spacing keeps adjacent cases apart", () => {
  for (const toShelf of [true, false]) {
    const fixture = transitionCase(toShelf);
    let previousHeading = fixture.transition.heading;
    let checkedMidpoint = false;
    for (let frame = 0; frame < layoutMaxFrames; frame++) {
      if (frame > 0 && !fixture.transition.settled) fixture.transition.advance(layoutStep);
      const heading = fixture.transition.heading;
      assert.ok(Number.isFinite(heading));
      assert.ok(Math.abs(heading - previousHeading) < .1, "heading must not jump between frames");
      if (toShelf) assert.ok(heading + 1e-10 >= previousHeading);
      else assert.ok(heading <= previousHeading + 1e-10);
      previousHeading = heading;

      const spacing = fixture.transition.rowSpacing;
      assert.ok(Number.isFinite(spacing) && spacing > 0);
      if (!checkedMidpoint && fixture.transition.frame.q >= .5) {
        assert.ok(spacing > Math.max(fixture.sourceRow, fixture.targetRow) + 1,
          "the turn should open additional row clearance at its midpoint");
        const selected = fixture.union.find(cell => cell.foobarEntryKey === "selected");
        const neighbor = fixture.union.find(cell => cell.foobarEntryKey === "shared");
        const selectedMatrix = fixture.targetMatrixFor(selected);
        const neighborMatrix = fixture.targetMatrixFor(neighbor);
        fixture.transition.apply(selectedMatrix, selected, true);
        fixture.transition.apply(neighborMatrix, neighbor, false);
        const distance = matrixPose(selectedMatrix).position.distanceTo(matrixPose(neighborMatrix).position);
        assert.ok(distance > 1.5, "adjacent records must not compress to the same center");
        checkedMidpoint = true;
      }
      if (fixture.transition.settled) break;
    }
    assert.equal(fixture.transition.settled, true, "heading path must run through settled endpoint");
    assert.equal(checkedMidpoint, true, "heading path must include its midpoint");
  }
});

test("camera heading follows the physical ARRAY-to-shelf direction continuously in both directions", () => {
  const arrayYaw = THREE.MathUtils.degToRad(-59);
  const shelfYaw = THREE.MathUtils.degToRad(38);
  for (const toShelf of [true, false]) {
    const sourceYaw = toShelf ? arrayYaw : shelfYaw;
    const targetYaw = toShelf ? shelfYaw : arrayYaw;
    const fixture = transitionCase(toShelf, sourceYaw);
    const sourcePosition = fixture.camera.position.clone();
    const sourceAim = fixture.aim.clone();
    const sourceFov = fixture.camera.fov;
    const targetAim = new THREE.Vector3(2, -3, -1);
    const targetElevation = .2;
    const targetDistance = 22;
    const targetPosition = targetAim.clone().add(new THREE.Vector3(
      Math.sin(targetYaw) * Math.cos(targetElevation), Math.sin(targetElevation),
      Math.cos(targetYaw) * Math.cos(targetElevation),
    ).multiplyScalar(targetDistance));
    const targetSpan = 14;
    let previousPosition = sourcePosition.clone();
    let previousFov = sourceFov;

    let frame = 0;
    while (!fixture.transition.settled && frame < layoutMaxFrames) {
      if (frame > 0) fixture.transition.advance(layoutStep);
      const renderedAim = sourceAim.clone();
      fixture.transition.applyCamera(fixture.camera, renderedAim, targetPosition, targetAim, targetSpan);
      assertFiniteVector(fixture.camera.position);
      assertFiniteVector(renderedAim);
      assert.ok(Number.isFinite(fixture.camera.fov) && fixture.camera.fov > 0 && fixture.camera.fov < 180);
      const distance = fixture.camera.position.distanceTo(previousPosition);
      assert.ok(distance < 1, "camera position must change smoothly between samples");
      assert.ok(Math.abs(fixture.camera.fov - previousFov) < 2, "camera lens must change smoothly between samples");
      previousPosition.copy(fixture.camera.position);
      previousFov = fixture.camera.fov;
      if (frame === 0) {
        assert.ok(fixture.camera.position.distanceTo(sourcePosition) < 1e-8);
        assert.ok(renderedAim.distanceTo(sourceAim) < 1e-8);
        close(fixture.camera.fov, sourceFov, 1e-8);
      }
      frame++;
    }
    assert.equal(fixture.transition.settled, true, "camera path must settle within 10 seconds");
    const renderedAim = sourceAim.clone();
    fixture.transition.applyCamera(fixture.camera, renderedAim, targetPosition, targetAim, targetSpan);
    assert.ok(fixture.camera.position.distanceTo(targetPosition) < 1e-8);
    assert.ok(renderedAim.distanceTo(targetAim) < 1e-8);
    close(visibleSpan(fixture.camera, renderedAim), targetSpan, 1e-7);
  }
});

test("camera focus bounds keep all eight tilted-case corners inside two aspect ratios and leave endpoints exact", () => {
  const localCorners = [];
  for (const x of [-2.225, 2.225]) for (const y of [-1.675, 1.675]) for (const z of [-.07, .07])
    localCorners.push(new THREE.Vector3(x, y, z));
  const bounds = { minX: -.48, maxX: .52, minY: -.46, maxY: .5 };
  const shortBounds = { minX: -.48, maxX: .52, minY: -.1, maxY: .1 };
  const targetYaw = .52, targetElevation = .17, targetDistance = 22;

  for (const aspect of [16 / 10, .72]) {
    const fixture = transitionCase(true, 0, false, new Map(), new Map(), 0, aspect);
    const selected = fixture.union.find(cell => cell.foobarEntryKey === "selected");
    const directTarget = fixture.targetMatrixFor(selected);
    const targetPose = matrixPose(directTarget);
    const tiltedTarget = matrixAt(targetPose.position, targetPose.scale,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(.13, -.21, .08)));
    const targetAim = fixture.aim.clone().add(new THREE.Vector3(.25, .12, -.35));
    const targetPosition = targetAim.clone().add(new THREE.Vector3(
      Math.sin(targetYaw) * Math.cos(targetElevation), Math.sin(targetElevation),
      Math.cos(targetYaw) * Math.cos(targetElevation),
    ).multiplyScalar(targetDistance));
    const targetSpan = 14;
    const focusPointFor = matrix => new THREE.Vector3(0, 1.85, 0).applyMatrix4(matrix);
    const currentSelectedMatrix = () => {
      const matrix = tiltedTarget.clone();
      fixture.transition.apply(matrix, selected, true);
      return matrix;
    };
    const cornersFor = matrix => localCorners.map(point => point.clone().applyMatrix4(matrix));
    const cameraState = focusRect => {
      const matrix = currentSelectedMatrix();
      const focus = focusPointFor(matrix);
      const renderedAim = fixture.aim.clone();
      const corners = cornersFor(matrix);
      const focusBounds = focusRect ? { ...focusRect, corners } : undefined;
      fixture.transition.applyCamera(fixture.camera, renderedAim, targetPosition, targetAim, targetSpan, focus, focusBounds);
      fixture.camera.updateProjectionMatrix();
      fixture.camera.updateMatrixWorld(true);
      return { position: fixture.camera.position.clone(), aim: renderedAim.clone(), fov: fixture.camera.fov,
        projected: corners.map(point => point.clone().project(fixture.camera)) };
    };
    const assertEndpointUnchanged = (label, rect = bounds) => {
      const noBounds = cameraState(false);
      const withBounds = cameraState(rect);
      assert.ok(withBounds.position.distanceTo(noBounds.position) < 1e-8, label + ": focus bounds must not shift endpoint camera position");
      assert.ok(withBounds.aim.distanceTo(noBounds.aim) < 1e-8, label + ": focus bounds must not shift endpoint aim");
      close(withBounds.fov, noBounds.fov, 1e-8);
    };

    assertEndpointUnchanged("source endpoint with tight rect", shortBounds);
    for (const q of [.2, .5, .8]) {
      advanceUntilQ(fixture.transition, q, "focus-bound sample q=" + q + " aspect=" + aspect);
      const state = cameraState(bounds);
      assert.equal(state.projected.length, 8);
      for (const [index, point] of state.projected.entries()) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
          "projected case corner must remain finite at aspect=" + aspect + " q=" + q);
        assert.ok(point.x >= bounds.minX - 2e-3 && point.x <= bounds.maxX + 2e-3 &&
          point.y >= bounds.minY - 2e-3 && point.y <= bounds.maxY + 2e-3,
        "corner " + index + " must remain inside focus rect at aspect=" + aspect + " q=" + q +
          ": projected=" + point.toArray().map(value => Number(value.toFixed(4))));
      }

      const unconstrained = cameraState(undefined);
      assert.ok(unconstrained.projected.some(point => point.y < shortBounds.minY || point.y > shortBounds.maxY),
        "the original FOV must not fit the deliberately short rect at aspect=" + aspect + " q=" + q);
      const minimumFov = cameraState(shortBounds);
      assert.ok(minimumFov.fov > unconstrained.fov + .1,
        "an infeasible original FOV should expand only within the transition at aspect=" + aspect + " q=" + q);
      for (const [index, point] of minimumFov.projected.entries()) {
        assert.ok(point.x >= shortBounds.minX - 2e-3 && point.x <= shortBounds.maxX + 2e-3 &&
          point.y >= shortBounds.minY - 2e-3 && point.y <= shortBounds.maxY + 2e-3,
        "expanded FOV must fit corner " + index + " inside short rect at aspect=" + aspect + " q=" + q +
          ": projected=" + point.toArray().map(value => Number(value.toFixed(4))));
      }
    }
    advanceUntilSettled(fixture.transition, "focus-bound target endpoint");
    assertEndpointUnchanged("target endpoint with tight rect", shortBounds);
  }
});

test("a quick reverse preserves the current matrices, camera pose, and fixed motion identities", () => {
  const fixture = transitionCase(true);
  advanceUntilQ(fixture.transition, .74, "quick-reverse midpoint");
  const selected = fixture.union.find(cell => cell.foobarEntryKey === "selected");
  const midpointSelected = fixture.targetMatrixFor(selected);
  fixture.transition.apply(midpointSelected, selected, true);
  const midpointById = new Map();
  for (const cell of fixture.union.filter(item => item.foobarEntryKey && item.foobarEntryKey !== "selected")) {
    const matrix = fixture.targetMatrixFor(cell);
    fixture.transition.apply(matrix, cell, false);
    midpointById.set(cell.motionId, matrix.clone());
  }
  const reverseTargetCamera = new THREE.Vector3(-4, 3, 18);
  const reverseTargetAim = new THREE.Vector3(-1, -4, .5);
  const midpointAim = fixture.aim.clone();
  fixture.transition.applyCamera(fixture.camera, midpointAim, reverseTargetCamera, reverseTargetAim, 16);
  const cameraAtReverse = fixture.camera.position.clone();
  const aimAtReverse = midpointAim.clone();
  const fovAtReverse = fixture.camera.fov;
  const q = fixture.transition.frame.q, qVelocity = fixture.transition.frame.qVelocity;
  const motionIds = fixture.union.map(cell => cell.motionId ?? null);
  assertRetargetKeepsMotionState(fixture.transition, fixture.union, false, "quick reverse");

  for (const cell of fixture.union) {
    const matrix = fixture.targetMatrixFor(cell);
    fixture.transition.apply(matrix, cell, cell.foobarEntryKey === "selected");
    const expected = cell.foobarEntryKey === "selected" ? midpointSelected : midpointById.get(cell.motionId);
    if (expected) assertMatrixClose(matrix, expected, 1e-5);
  }
  const reverseAim = aimAtReverse.clone();
  fixture.transition.applyCamera(fixture.camera, reverseAim, reverseTargetCamera, reverseTargetAim, 16);
  assert.ok(fixture.camera.position.distanceTo(cameraAtReverse) < 1e-8);
  assert.ok(reverseAim.distanceTo(aimAtReverse) < 1e-8);
  close(fixture.camera.fov, fovAtReverse, 1e-8);
  assert.equal(fixture.transition.frame.q, q);
  assert.equal(fixture.transition.frame.qVelocity, qVelocity);
  assert.deepEqual(fixture.union.map(cell => cell.motionId ?? null), motionIds);

  advanceUntilSettled(fixture.transition, "quick reverse source endpoint");
  close(fixture.transition.frame.q, 0);
  const returnedSelected = fixture.targetMatrixFor(selected);
  fixture.transition.apply(returnedSelected, selected, true);
  assertMatrixClose(returnedSelected, fixture.sourceSelectedRestMatrix);
});

test("endpointCell carries terminal labels with their matrices into an immediate canonical rebind", () => {
  const baseY = -4.6;
  const sourceSelected = { lane: 1, row: 28, foobarEntryKey: "hero", physicalOccurrence: "A:hero", motionId: "A:hero" };
  const sourceCells = [
    sourceSelected,
    { lane: 0, row: 30, foobarEntryKey: "shared", physicalOccurrence: "A:shared", motionId: "A:shared" },
    { lane: 2, row: 30, foobarEntryKey: "retiring", physicalOccurrence: "A:retiring", motionId: "A:retiring" },
  ];
  const sourceCatalog = new Map([
    ["hero", { lane: 1, row: 0, order: 0 }],
    ["shared", { lane: 0, row: 2, order: 1 }],
    ["retiring", { lane: 2, row: 2, order: 2 }],
  ]);
  const targetSelected = { lane: 4, row: 7, foobarEntryKey: "hero", physicalOccurrence: "B:hero" };
  const targetCells = [
    targetSelected,
    { lane: 3, row: 9, foobarEntryKey: "shared", physicalOccurrence: "B:shared" },
    { lane: 5, row: 7, foobarEntryKey: "incoming", physicalOccurrence: "B:incoming" },
    { lane: -10000, row: -10000 },
  ];
  const targetCatalog = new Map([
    ["hero", { lane: 4, row: 7, order: 0 }],
    ["shared", { lane: 3, row: 9, order: 1 }],
    ["incoming", { lane: 5, row: 7, order: 2 }],
  ]);
  const sourceAnchor = new THREE.Vector3(0, baseY + .9, 0);
  const sourcePoseFor = cell => {
    const selected = cell.foobarEntryKey === "hero";
    const position = sourceAnchor.clone().add(new THREE.Vector3(
      (cell.lane - sourceSelected.lane) * 5.2, 0, (cell.row - sourceSelected.row) * .62,
    ));
    if (!selected) position.y = baseY;
    return matrixAt(position, selected ? new THREE.Vector3(1.1, .9, 1) : new THREE.Vector3(1, .8, 1));
  };
  const sourceMatrices = new Map(sourceCells.map(cell => [cell.physicalOccurrence, sourcePoseFor(cell)]));
  const camera = new THREE.PerspectiveCamera(62, 16 / 10, .1, 200);
  const aim = new THREE.Vector3(0, -4.2, 0);
  camera.position.copy(aim).add(new THREE.Vector3(0, 0, 20));
  camera.lookAt(aim);
  const transition = new MusicLayoutTransition();
  transition.begin(sourceCells.map(cell => ({ cell: { ...cell }, matrix: sourcePoseFor(cell), alpha: 1, tint: 0 })),
    sourceSelected, sourceMatrices.get("A:hero"), camera, aim, { column: 5.2, row: .62 }, true, 4.45, baseY, 0, sourceCatalog);
  const plan = transition.bindCells(targetCells, targetSelected, -1,
    cell => Boolean(cell.foobarEntryKey), targetCatalog);
  const targetAnchor = new THREE.Vector3(2, baseY + 2.1, -2.17);
  transition.prepareTarget(targetAnchor);
  const targetMatrixFor = (cell, selected, selectedCell, anchor, columnSpacing = 4.95, rowSpacing = 1) => {
    const local = new THREE.Vector3((cell.lane - selectedCell.lane) * columnSpacing, 0,
      (cell.row - selectedCell.row) * rowSpacing).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
    const position = anchor.clone().add(local);
    position.y = cell.foobarEntryKey === selectedCell.foobarEntryKey ? anchor.y : baseY;
    return matrixAt(position, cell.foobarEntryKey === selectedCell.foobarEntryKey
      ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(1, .8, 1));
  };
  const renderEndpoint = (cells, selectedCell, anchor) => {
    const matrices = new Map();
    const owners = new Map();
    for (const cell of cells) {
      if (!cell.motionId) continue;
      const matrix = targetMatrixFor(cell, false, selectedCell, anchor);
      transition.apply(matrix, cell, transition.isSelected(cell));
      matrices.set(cell.motionId, matrix.clone());
      owners.set(cell.motionId, transition.endpointCell(cell));
    }
    return { matrices, owners };
  };

  assert.equal(transition.endpointCell(plan.find(cell => cell.motionId)), undefined,
    "endpoint ownership is unavailable before settled");
  assert.equal(transition.endpointSelection, undefined, "endpoint selection is unavailable before settled");
  advanceUntilSettled(transition, "endpointCell forward B");
  assert.deepEqual(transition.endpointSelection, targetSelected, "B publishes its original raw selected coordinates");
  const atB = renderEndpoint(plan, targetSelected, targetAnchor);
  const targetByEntry = new Map(targetCells.filter(cell => cell.foobarEntryKey).map(cell => [cell.foobarEntryKey, cell]));
  for (const cell of plan.filter(cell => cell.motionId)) {
    const owner = atB.owners.get(cell.motionId);
    if (cell.foobarEntryKey === "retiring") {
      assert.equal(owner, undefined, "source-only occurrence has no owner at B");
      assert.ok(matrixBasisLengths(atB.matrices.get(cell.motionId)).every(value => value < 1e-8));
    } else {
      assert.deepEqual(owner, targetByEntry.get(cell.foobarEntryKey));
    }
  }

  assert.equal(transition.retarget(false), true);
  advanceUntilSettled(transition, "endpointCell return A");
  assert.deepEqual(transition.endpointSelection, sourceSelected, "A restores the original raw selected coordinates");
  const atA = renderEndpoint(plan, targetSelected, targetAnchor);
  const sourceByEntry = new Map(sourceCells.map(cell => [cell.foobarEntryKey, cell]));
  const returnedSamples = [];
  const returnedPoseById = new Map();
  const periodLabels = [
    Array.from({ length: 7 }, (_, row) => row === 2 ? "shared" : `group-0-${row}`),
    Array.from({ length: 28 }, (_, row) => row === 0 ? "hero" : `group-1-${row}`),
    Array.from({ length: 3 }, (_, row) => row === 0 ? "retiring" : `group-2-${row}`),
  ];
  const ordinaryEntryAt = cell => {
    const labels = periodLabels[cell.lane];
    return labels ? labels[((cell.row % labels.length) + labels.length) % labels.length] : undefined;
  };
  const hypotheticalSelected28 = { ...sourceSelected, row: sourceSelected.row + 28 };
  const arbitraryDelta = { lane: hypotheticalSelected28.lane - sourceSelected.lane,
    row: hypotheticalSelected28.row - sourceSelected.row };
  for (const cell of plan.filter(cell => cell.motionId)) {
    const owner = atA.owners.get(cell.motionId);
    const matrix = atA.matrices.get(cell.motionId);
    const sourceOwner = sourceByEntry.get(cell.foobarEntryKey);
    if (cell.foobarEntryKey === "incoming") {
      assert.equal(owner, undefined, "incoming-only occurrence has no owner at A");
      assert.ok(matrixBasisLengths(matrix).every(value => value < 1e-8));
      continue;
    }
    assert.deepEqual(owner, sourceOwner, "A restores the original source cell labels, including physical occurrence");
    assert.equal(ordinaryEntryAt(owner), owner.foobarEntryKey,
      "the original owner label resolves through its own [7, 28, 3] column cycle");
    returnedPoseById.set(cell.motionId, matrix.clone());
    returnedSamples.push({ cell: { ...owner }, matrix: matrix.clone(), alpha: 1, tint: 0 });
    const wronglyShiftedOwner = { ...owner, lane: owner.lane + arbitraryDelta.lane, row: owner.row + arbitraryDelta.row };
    if (owner.foobarEntryKey === "retiring")
      assert.notEqual(ordinaryEntryAt(wronglyShiftedOwner), owner.foobarEntryKey,
        "a selected 28-row cycle must not relabel an owner in the 3-row column");
  }
  const returnedSelected = returnedSamples.find(sample => sample.cell.physicalOccurrence === "A:hero");
  assert.ok(returnedSelected);
  assertMatrixClose(returnedSelected.matrix, sourceMatrices.get("A:hero"));
  assert.equal(ordinaryEntryAt(sourceByEntry.get("shared")), "shared");
  assert.equal(ordinaryEntryAt(sourceByEntry.get("retiring")), "retiring");

  transition.clear();
  assert.equal(transition.endpointCell(plan.find(cell => cell.motionId)), undefined,
    "terminal endpoint labels must be captured before clear");

  // The next layout uses a different canonical origin. Correct A labels must
  // still pair the same entries when the source matrices are rebound.
  const nextTargetSelected = { lane: 10, row: 30, foobarEntryKey: "hero", physicalOccurrence: "C:hero" };
  const nextTargetCells = [
    nextTargetSelected,
    { lane: 9, row: 32, foobarEntryKey: "shared", physicalOccurrence: "C:shared" },
    { lane: 11, row: 30, foobarEntryKey: "incoming", physicalOccurrence: "C:incoming" },
    { lane: -10000, row: -10000 },
  ];
  const nextTargetCatalog = new Map([
    ["hero", { lane: 10, row: 30, order: 0 }],
    ["shared", { lane: 9, row: 32, order: 1 }],
    ["incoming", { lane: 11, row: 30, order: 2 }],
  ]);
  const nextTargetAnchor = new THREE.Vector3(-3, baseY + 2.1, 1.5);
  transition.begin(returnedSamples, returnedSelected.cell, returnedSelected.matrix, camera, aim,
    { column: 5.2, row: .62 }, true, 4.45, baseY, 0, sourceCatalog);
  const nextPlan = transition.bindCells(nextTargetCells, nextTargetSelected, -1,
    cell => Boolean(cell.foobarEntryKey), nextTargetCatalog);
  transition.prepareTarget(nextTargetAnchor);
  assert.equal(transition.frame.matched, 2, "entry labels must recover canonical hero/shared pairing after clear and rebind");
  assert.equal(transition.frame.retiring, 1);
  assert.equal(transition.frame.arriving, 1);
  for (const cell of nextPlan.filter(cell => cell.motionId)) {
    const matrix = targetMatrixFor(cell, false, nextTargetSelected, nextTargetAnchor);
    transition.apply(matrix, cell, transition.isSelected(cell));
    const priorPose = returnedPoseById.get(cell.motionId);
    if (priorPose) assertMatrixClose(matrix, priorPose);
    else assert.ok(matrixBasisLengths(matrix).every(value => value < 1e-8), "next incoming occurrence starts at zero size");
  }
});

test("retargets at q 0.03, 0.2, 0.5, 0.8, and 0.97 preserve q, velocity, and motion identities", () => {
  for (const toShelf of [true, false]) {
    for (const threshold of [.03, .2, .5, .8, .97]) {
      const fixture = transitionCase(toShelf);
      advanceUntilQ(fixture.transition, threshold, "retarget point");
      const before = { q: fixture.transition.frame.q, qVelocity: fixture.transition.frame.qVelocity };
      assertRetargetKeepsMotionState(fixture.transition, fixture.union, !toShelf,
        "reverse at q=" + threshold + " toShelf=" + toShelf);
      assert.equal(fixture.transition.frame.desiredEnd, 0);
      assert.equal(fixture.transition.frame.q, before.q);
      assert.equal(fixture.transition.frame.qVelocity, before.qVelocity);
      advanceUntilSettled(fixture.transition, "settle after q=" + threshold + " reversal");
      close(fixture.transition.frame.q, 0);
    }
  }
});

test("three consecutive reversals keep one plan and preserve velocity at every retarget", () => {
  const fixture = transitionCase(true);
  const initialIds = fixture.union.map(cell => cell.motionId ?? null);

  advanceUntilQ(fixture.transition, .2, "three-reverse first point");
  assertRetargetKeepsMotionState(fixture.transition, fixture.union, false, "three-reverse 1");
  advanceUntil(fixture.transition, () => fixture.transition.frame.q <= .16, "three-reverse return leg 1");
  assertRetargetKeepsMotionState(fixture.transition, fixture.union, true, "three-reverse 2");
  advanceUntilQ(fixture.transition, .22, "three-reverse second outward point");
  assertRetargetKeepsMotionState(fixture.transition, fixture.union, false, "three-reverse 3");
  advanceUntilSettled(fixture.transition, "three-reverse final source endpoint");

  close(fixture.transition.frame.q, 0);
  assert.deepEqual(fixture.union.map(cell => cell.motionId ?? null), initialIds);
});

test("source hover residual reaches rest and does not return when retargeting back to A", () => {
  const hoverLift = .28;
  const fixture = transitionCase(true, 0, false, new Map(), new Map(), hoverLift);
  const sourceRestByKey = new Map(fixture.sourceSamples.map(sample => [sample.cell.foobarEntryKey, sample.restMatrix]));
  const sourceActualByKey = new Map(fixture.sourceSamples.map(sample => [sample.cell.foobarEntryKey, sample.matrix]));
  const selected = fixture.union.find(cell => cell.foobarEntryKey === "selected");

  const selectedAtStart = fixture.targetMatrixFor(selected);
  fixture.transition.apply(selectedAtStart, selected, true);
  assertMatrixClose(selectedAtStart, fixture.sourceSelectedMatrix);
  for (const key of ["shared", "source-only"]) {
    const cell = fixture.union.find(item => item.foobarEntryKey === key);
    const atStart = fixture.targetMatrixFor(cell);
    fixture.transition.apply(atStart, cell);
    assertMatrixClose(atStart, sourceActualByKey.get(key));
  }

  advanceUntilQ(fixture.transition, .5, "hover residual fade window");
  assertRetargetKeepsMotionState(fixture.transition, fixture.union, false, "hover residual reverse");
  advanceUntil(fixture.transition, () => fixture.transition.frame.q <= .1, "hover residual early return");
  const earlyReturnedSelected = fixture.targetMatrixFor(selected);
  fixture.transition.apply(earlyReturnedSelected, selected, true);
  const earlySelectedPosition = matrixPose(earlyReturnedSelected).position;
  const restSelectedPosition = matrixPose(fixture.sourceSelectedRestMatrix).position;
  close(earlySelectedPosition.x, restSelectedPosition.x);
  close(earlySelectedPosition.z, restSelectedPosition.z);
  assert.ok(Math.abs(earlySelectedPosition.y - restSelectedPosition.y) < .02,
    "the remaining y offset may be the route's small arch, but not the original hover lift");
  const sourceOnly = fixture.union.find(cell => cell.foobarEntryKey === "source-only");
  const earlyReturnedSourceOnly = fixture.targetMatrixFor(sourceOnly);
  fixture.transition.apply(earlyReturnedSourceOnly, sourceOnly);
  assert.ok(matrixBasisLengths(earlyReturnedSourceOnly)[0] > 0, "source-only geometry should still be partially visible on return");
  assert.ok(matrixPose(earlyReturnedSourceOnly).position.y <= matrixPose(fixture.sourceSamples.find(sample => sample.cell.foobarEntryKey === "source-only").restMatrix).position.y + 1e-6,
    "once source residual expires, the return path must not retain the positive hover lift");
  advanceUntilSettled(fixture.transition, "hover residual returned to A");
  close(fixture.transition.frame.q, 0);

  const assertRestingSource = () => {
    const returnedSelected = fixture.targetMatrixFor(selected);
    fixture.transition.apply(returnedSelected, selected, true);
    assertMatrixClose(returnedSelected, fixture.sourceSelectedRestMatrix);
    for (const key of ["shared", "source-only"]) {
      const cell = fixture.union.find(item => item.foobarEntryKey === key);
      const returned = fixture.targetMatrixFor(cell);
      fixture.transition.apply(returned, cell);
      assertMatrixClose(returned, sourceRestByKey.get(key));
    }
    const incoming = fixture.union.find(item => item.foobarEntryKey === "target-only");
    const collapsedIncoming = fixture.targetMatrixFor(incoming);
    fixture.transition.apply(collapsedIncoming, incoming);
    assert.ok(matrixBasisLengths(collapsedIncoming).every(value => value < 1e-8));
  };
  assertRestingSource();
  fixture.transition.advance(layoutStep);
  assertRestingSource();
  assert.equal(hoverLift, .28, "fixture starts with a distinct hover displacement");
});

test("shared shelf deployment stages have exact endpoints, stay monotone, and order slots front to back", () => {
  const start = shelfDeployment(0), end = shelfDeployment(1);
  assert.ok(Object.values(start).every(value => value === 0));
  assert.ok(Object.values(end).every(value => value === 1));
  close(shelfEntryFrame(22.3).deployment, .1);
  close(shelfEntryFrame(22.8).deployment, .8 / 3);
  close(shelfEntryFrame(25).deployment, 1);
  const previous = Object.fromEntries(Object.keys(start).map(key => [key, 0]));
  for (let step = 0; step <= 100; step++) {
    const frame = shelfDeployment(step / 100);
    for (const [key, value] of Object.entries(frame)) {
      assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
      assert.ok(value + 1e-12 >= previous[key], key + " stage must be monotone");
      previous[key] = value;
    }
  }

  for (const ratio of [0, .5, 1]) {
    close(shelfSlotDeployment(0, ratio), 0);
    close(shelfSlotDeployment(1, ratio), 1);
    let previousSlot = 0;
    for (let step = 0; step <= 100; step++) {
      const value = shelfSlotDeployment(step / 100, ratio);
      assert.ok(value + 1e-12 >= previousSlot);
      previousSlot = value;
    }
  }
  const front = shelfSlotDeployment(.6, 0);
  const middle = shelfSlotDeployment(.6, .5);
  const back = shelfSlotDeployment(.6, 1);
  assert.ok(front >= middle && middle >= back, "slot parts should extend in a stable front-to-back order");
});

test("shelf entry cases follow nonzero lane/slot anchors and ride the shared deck", () => {
  const caseBottom = .175, caseTop = 3.525;
  const times = Array.from({ length: 121 }, (_, index) => 22 + index * .025);
  for (const rowRatio of [0, .5, 1]) {
    const slot = { laneX: 2.25, frontZ: 5.5, floorY: -3.4, rowRatio };
    const original = matrixAt(new THREE.Vector3(slot.laneX + 1.3, slot.floorY - caseBottom, -8),
      new THREE.Vector3(2, 1, 1));
    let previous = { x: 0, y: 0, z: 0 };
    let previousX = slot.laneX, previousZ = slot.frontZ, previousDeckY = shelfAssemblySlot(0, slot).deckY;
    let previousTopY = -Infinity, previousVisibleHeight = 0;

    for (const time of times) {
      const current = original.clone();
      shelfEntryPose(current, time, slot);
      const pose = musicGeometryPose(current);
      const dimensions = matrixBasisLengths(current);
      const assembly = shelfAssemblySlot(shelfEntryFrame(time).deployment, slot);
      const bottomY = pose.position.y + caseBottom * dimensions[1];
      const topY = pose.position.y + caseTop * dimensions[1];
      const visibleHeight = Math.max(0, topY - assembly.deckY);
      assertFiniteVector(pose.position);
      assert.ok(dimensions.every(Number.isFinite));
      assert.ok(Number.isFinite(current.determinant()));
      if (dimensions[0] > 0 && dimensions[2] > 0) {
        assert.ok(dimensions[1] > 0, "an XZ-area-bearing case must retain positive render thickness at time " + time);
        assert.ok(current.determinant() > 0, "an XZ-area-bearing case transform must remain nonsingular at time " + time);
        close(dimensions[1], matrixBasisLengths(original)[1], 1e-8,
          "case vertical geometry remains rigid rather than flattening at time " + time);
        for (const offset of [0, 1, 2]) {
          const sourceAxis = new THREE.Vector3().fromArray(original.elements, offset * 4).normalize();
          const deployedAxis = new THREE.Vector3().fromArray(current.elements, offset * 4).normalize();
          assert.ok(sourceAxis.distanceTo(deployedAxis) < 1e-8,
            "case rotation must remain rigid without entry tilt at time " + time);
        }
        const inverse = current.clone().invert();
        const normal = new THREE.Matrix3().getNormalMatrix(current);
        assert.ok(inverse.elements.every(Number.isFinite), "partial case inverse must stay finite at time " + time);
        assert.ok(normal.elements.every(Number.isFinite), "partial case normal matrix must stay finite at time " + time);
      }
      assert.ok(dimensions[0] + 1e-8 >= previous.x);
      assert.ok(dimensions[1] + 1e-8 >= previous.y);
      assert.ok(dimensions[2] + 1e-8 >= previous.z);
      assert.ok(pose.position.x + 1e-8 >= previousX, "the case should open outward from its lane center");
      assert.ok(pose.position.z <= previousZ + 1e-8, "the case should extend from the rail front into its slot");
      assert.ok(assembly.deckY + 1e-8 >= previousDeckY, "the shared deck should rise without reversing");
      assert.ok(topY + 1e-8 >= previousTopY, "the case top should rise monotonically out of the deck");
      assert.ok(visibleHeight + 1e-8 >= previousVisibleHeight, "visible case height should not reverse");
      assert.ok(bottomY <= assembly.deckY + 1e-6, "the case bottom stays at or below the deck while rising");
      previous = { x: dimensions[0], y: dimensions[1], z: dimensions[2] };
      previousX = pose.position.x;
      previousZ = pose.position.z;
      previousDeckY = assembly.deckY;
      previousTopY = topY;
      previousVisibleHeight = visibleHeight;
      if (time === 22) {
        close(pose.position.x, slot.laneX);
        close(pose.position.y, assembly.deckY - .12 - caseTop);
        close(pose.position.z, slot.frontZ);
        close(Math.hypot(...dimensions), 0);
        assert.deepEqual(dimensions, [0, 0, 0], "fully stowed case geometry remains exactly zero");
        close(current.determinant(), 0);
      }
      if (rowRatio === 1 && (Math.abs(time - 22.3) < 1e-8 || Math.abs(time - 22.8) < 1e-8)) {
        close(assembly.slotProgress, 0);
        assert.ok(topY <= assembly.deckY - .09 + 1e-6,
          "a not-yet-raised case top must remain hidden below the deck lip");
        close(topY, assembly.deckY - .12, 1e-6,
          "a not-yet-raised rigid case remains tucked below the opaque deck");
        close(visibleHeight, 0);
        close(dimensions[1], 1);
      }
      if (time >= 25 - 1e-9) {
        assertMatrixClose(current, original, 1e-5);
        close(pose.position.x, original.elements[12]);
        close(pose.position.z, original.elements[14]);
        close(assembly.deckY, slot.floorY);
      }
    }
  }

  // Adjacent physical rows preserve their actual XZ clearance while expanding.
  // The case's local depth is .14 and its centers are one shelf-row apart.
  const rowSpacing = 1;
  const rowSlot = { laneX: 2.25, frontZ: 5.5, floorY: -3.4, rowRatio: .5 };
  for (const time of [22.3, 22.8, 23.2, 25]) {
    const rows = [0, 1].map((row) => {
      const matrix = matrixAt(new THREE.Vector3(rowSlot.laneX + .2, rowSlot.floorY,
        rowSlot.frontZ - 2 - row * rowSpacing));
      shelfEntryPose(matrix, time, rowSlot);
      return matrix;
    });
    const first = musicGeometryPose(rows[0]), second = musicGeometryPose(rows[1]);
    const firstDepth = matrixBasisLengths(rows[0])[2] * .14;
    const secondDepth = matrixBasisLengths(rows[1])[2] * .14;
    const zClearance = Math.abs(first.position.z - second.position.z) - (firstDepth + secondDepth) / 2;
    assert.ok(zClearance > 0, "adjacent case rows keep positive XZ clearance at time " + time + ": " + zClearance);
    close(first.position.x, second.position.x, 1e-8);
    for (const matrix of rows) {
      const basis = matrixBasisLengths(matrix);
      if (basis[0] > 0 && basis[2] > 0) {
        close(matrix.elements[1], 0, 1e-8);
        close(matrix.elements[2], 0, 1e-8);
        close(matrix.elements[4], 0, 1e-8);
        close(matrix.elements[6], 0, 1e-8);
        close(matrix.elements[8], 0, 1e-8);
        close(matrix.elements[9], 0, 1e-8);
      }
    }
  }
});

test("shelf entry camera is finite and continuous through its settling path", () => {
  const basePosition = new THREE.Vector3(4, 3, 13);
  const baseAim = new THREE.Vector3(1, -1, 2);
  const baseFov = 38;
  let previousPosition;
  let previousFov;
  for (let time = 22; time <= 25.45 + 1e-9; time += .05) {
    const camera = new THREE.PerspectiveCamera(baseFov, 16 / 10, .1, 100);
    camera.position.copy(basePosition);
    camera.fov = baseFov;
    const aim = baseAim.clone();
    shelfEntryCamera(camera, aim, time);
    assertFiniteVector(camera.position);
    assertFiniteVector(aim);
    assert.ok(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180);
    assert.ok(camera.position.distanceTo(basePosition) < 10);
    if (previousPosition) assert.ok(camera.position.distanceTo(previousPosition) < 1);
    if (previousFov !== undefined) assert.ok(Math.abs(camera.fov - previousFov) < 1);
    assert.ok(aim.distanceTo(baseAim) < 1e-12);
    previousPosition = camera.position.clone();
    previousFov = camera.fov;
  }
  const finalCamera = new THREE.PerspectiveCamera(baseFov, 16 / 10, .1, 100);
  finalCamera.position.copy(basePosition);
  finalCamera.fov = baseFov;
  shelfEntryCamera(finalCamera, baseAim.clone(), 25.45);
  finalCamera.updateProjectionMatrix();
  finalCamera.updateMatrixWorld(true);
  close(finalCamera.fov, baseFov, 1e-9);

  const backSlot = { laneX: 2.25, frontZ: 5.5, floorY: -3.4, rowRatio: 1 };
  const caseBottom = .175, caseTop = 3.525, caseCenterY = (caseBottom + caseTop) / 2;
  const normalCase = matrixAt(new THREE.Vector3(backSlot.laneX + 1.3, backSlot.floorY - caseBottom, -8),
    new THREE.Vector3(2, 1, 1));
  const caseCenter = new THREE.Vector3(0, caseCenterY, 0);
  const restingPoint = caseCenter.clone().applyMatrix4(normalCase);
  const visibleFocusPoint = (matrix, time) => {
    const pose = musicGeometryPose(matrix);
    const verticalScale = matrixBasisLengths(matrix)[1];
    const assembly = shelfAssemblySlot(shelfEntryFrame(time).deployment, backSlot);
    const bottom = pose.position.y + caseBottom * verticalScale;
    const top = pose.position.y + caseTop * verticalScale;
    const point = caseCenter.clone().applyMatrix4(matrix);
    point.y = (Math.max(bottom, assembly.deckY) + Math.max(top, assembly.deckY)) / 2;
    return point;
  };
  const normalOrientationCamera = new THREE.PerspectiveCamera(baseFov, 16 / 10, .1, 100);
  normalOrientationCamera.position.copy(basePosition);
  normalOrientationCamera.lookAt(baseAim);
  const normalOrientation = normalOrientationCamera.quaternion.clone();
  const priorOrbitOrientation = new THREE.Quaternion().setFromEuler(new THREE.Euler(.23, -.41, .17));
  const renderWithIncomingOrientation = (time, orientation) => {
    const deployedCase = normalCase.clone();
    shelfEntryPose(deployedCase, time, backSlot);
    const point = visibleFocusPoint(deployedCase, time);
    const camera = new THREE.PerspectiveCamera(baseFov, 16 / 10, .1, 100);
    camera.position.copy(basePosition);
    camera.fov = baseFov;
    camera.quaternion.copy(orientation);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const aim = baseAim.clone();
    shelfEntryCamera(camera, aim, time, { point, restingPoint });
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    return { camera, aim, point };
  };
  for (const time of [22.3, 22.8, 24.2, 25.45]) {
    const normalInput = renderWithIncomingOrientation(time, normalOrientation);
    const orbitInput = renderWithIncomingOrientation(time, priorOrbitOrientation);
    assert.ok(orbitInput.camera.position.distanceTo(normalInput.camera.position) < 1e-8,
      "entry camera position must not inherit previous orbit at time " + time);
    const orientationDelta = orbitInput.camera.quaternion.angleTo(normalInput.camera.quaternion);
    assert.ok(orientationDelta < 1e-7,
      "entry camera orientation must normalize to its aim at time " + time + " delta=" + orientationDelta);
    assert.ok(orbitInput.aim.distanceTo(normalInput.aim) < 1e-8,
      "entry camera aim must not inherit previous orbit at time " + time);
    close(orbitInput.camera.fov, normalInput.camera.fov, 1e-8);
    if (time === 25.45) {
      assert.ok(orbitInput.camera.position.distanceTo(basePosition) < 1e-8);
      assert.ok(normalInput.camera.position.distanceTo(basePosition) < 1e-8);
      assert.ok(orbitInput.aim.distanceTo(baseAim) < 1e-8);
      assert.ok(normalInput.aim.distanceTo(baseAim) < 1e-8);
      close(orbitInput.camera.fov, baseFov, 1e-9);
      close(normalInput.camera.fov, baseFov, 1e-9);
    }
  }
  let previousFocusPosition, previousFocusAim, previousFocusFov;
  for (let time = 22; time <= 25.45 + 1e-9; time += .05) {
    const deployedCase = normalCase.clone();
    shelfEntryPose(deployedCase, time, backSlot);
    const currentPoint = visibleFocusPoint(deployedCase, time);
    const camera = new THREE.PerspectiveCamera(baseFov, 16 / 10, .1, 100);
    camera.position.copy(basePosition);
    camera.fov = baseFov;
    const aim = baseAim.clone();
    camera.lookAt(aim);
    shelfEntryCamera(camera, aim, time, { point: currentPoint, restingPoint });
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    assertFiniteVector(camera.position);
    assertFiniteVector(aim);
    assertFiniteVector(currentPoint);
    assert.ok(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180);
    const projected = currentPoint.clone().project(camera);
    assertFiniteVector(projected);
    assert.ok(projected.x >= -.9 && projected.x <= .9 && projected.y >= -.9 && projected.y <= .9,
      "the deployed back-row case focus should stay inside the stage at time " + time + ": " + projected.toArray());
    if (Math.abs(time - 22.3) < 1e-8 || Math.abs(time - 22.8) < 1e-8) {
      const deployment = shelfEntryFrame(time).deployment;
      const assembly = shelfAssemblySlot(deployment, backSlot);
      assert.ok(deployment > 0 && deployment < 1);
      close(assembly.slotProgress, 0);
      const pose = musicGeometryPose(deployedCase);
      const top = pose.position.y + caseTop * matrixBasisLengths(deployedCase)[1];
      assert.ok(top <= assembly.deckY - .09 + 1e-6,
        "the selected back-row case remains concealed while its slot rise is zero");
      close(currentPoint.y, assembly.deckY, 1e-8,
        "camera focus uses the deck surface until the case becomes visible");
    }
    if (previousFocusPosition) {
      assert.ok(camera.position.distanceTo(previousFocusPosition) < 1,
        "focus camera translation should remain continuous at time " + time);
      assert.ok(aim.distanceTo(previousFocusAim) < 1,
        "focus camera aim should remain continuous at time " + time);
      assert.ok(Math.abs(camera.fov - previousFocusFov) < 1,
        "focus camera lens should remain continuous at time " + time);
    }
    previousFocusPosition = camera.position.clone();
    previousFocusAim = aim.clone();
    previousFocusFov = camera.fov;

    if (time >= 25.45 - 1e-8) {
      assert.ok(camera.position.distanceTo(basePosition) < 1e-8,
        "focused camera should restore normal position at 25.45; time=" + time + " delta=" + camera.position.distanceTo(basePosition));
      assert.ok(aim.distanceTo(baseAim) < 1e-8,
        "focused camera should restore normal aim at 25.45; time=" + time + " delta=" + aim.distanceTo(baseAim));
      close(camera.fov, baseFov, 1e-9);
      const expectedNormalFocus = restingPoint.clone().project(finalCamera);
      assert.ok(projected.distanceTo(expectedNormalFocus) < 1e-8,
        "the last frame should compose to the normal case matrix and camera framing");
    }
  }
});
