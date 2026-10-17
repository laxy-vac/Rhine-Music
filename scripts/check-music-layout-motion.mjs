import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicMatrixDrag } from "../src/music-matrix-drag.ts";
import { MusicLayoutTransition } from "../src/music-layout-transition.ts";

test("opposite archive axes travel around the focus instead of collapsing through it", () => {
  const motion = new MusicLayoutTransition();
  const source = new THREE.Matrix4().makeTranslation(4, 0, 1);
  const target = new THREE.Matrix4().makeTranslation(-4, 0, -1);
  const camera = new THREE.PerspectiveCamera(10, 1.5, 1, 300);
  camera.position.set(-60, 40, 100);
  motion.begin(new Map([["album", source]]), new THREE.Matrix4(), camera, new THREE.Vector3(), false, true);
  motion.prepareTarget(new THREE.Vector3());
  motion.advance(.725);
  const middle = target.clone(); motion.apply(middle, "album");
  const position = new THREE.Vector3().setFromMatrixPosition(middle);
  assert.ok(Math.hypot(position.x, position.z) > 4, "neighbor spacing must survive the halfway turn");
  motion.advance(.725);
  const end = target.clone(); motion.apply(end, "album");
  assert.ok(end.elements.every((value, index) => Math.abs(value - target.elements[index]) < 1e-8));
});

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

function matrixAt(position, rotation = [0, 0, 0], scale = [1, 1, 1]) {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(...rotation),
  );
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    quaternion,
    new THREE.Vector3(...scale),
  );
}

function assertPoseNear(actualMatrix, expectedMatrix, epsilon = 1e-6) {
  const actual = {
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
  const expected = {
    position: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
  };
  actualMatrix.clone().decompose(actual.position, actual.rotation, actual.scale);
  expectedMatrix
    .clone()
    .decompose(expected.position, expected.rotation, expected.scale);
  for (const axis of ["x", "y", "z"]) {
    close(actual.position[axis], expected.position[axis], epsilon);
    close(actual.scale[axis], expected.scale[axis], epsilon);
  }
  const rotationError = 1 - Math.abs(actual.rotation.dot(expected.rotation));
  assert.ok(
    rotationError <= epsilon,
    `rotation should match (angular similarity error ${rotationError})`,
  );
}

function assertFiniteVector(vector) {
  assert.ok(vector.toArray().every(Number.isFinite), "expected a finite vector");
}

function visibleSpan(camera, aim) {
  return 2 * camera.position.distanceTo(aim) *
    Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
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

test("layout morph preserves its start pose, interpolates, and reaches its target", () => {
  const transition = new MusicLayoutTransition();
  const source = matrixAt([0, 1, 2], [0.1, 0.2, -0.1], [1, 1.2, 0.8]);
  const selectedSource = matrixAt([-2, 0, 1]);
  const target = matrixAt([10, 5, -4], [0.4, 1.1, 0.3], [1.5, 0.7, 2]);
  const entries = new Map([["album-a", source.clone()]]);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  camera.position.set(0, 2, 14);
  const aim = new THREE.Vector3(0, 0, 0);
  camera.lookAt(aim);

  transition.begin(entries, selectedSource, camera, aim, false, true);
  assert.equal(transition.active, true);
  close(transition.progress, 0);
  close(transition.shelfAmount, 0);

  const atStart = target.clone();
  transition.apply(atStart, "album-a");
  assertPoseNear(atStart, source);
  const selectedAtStart = target.clone();
  transition.apply(selectedAtStart, undefined, true);
  assertPoseNear(selectedAtStart, selectedSource);

  transition.advance(0.725);
  close(transition.progress, 0.5);
  close(transition.shelfAmount, 0.5);
  const atMiddle = target.clone();
  transition.apply(atMiddle, "album-a");
  const middlePosition = new THREE.Vector3().setFromMatrixPosition(atMiddle);
  assert.ok(middlePosition.distanceTo(new THREE.Vector3(5, 3, -1)) < 1e-6);

  transition.advance(0.725);
  close(transition.progress, 1);
  close(transition.shelfAmount, 1);
  const atEnd = target.clone();
  transition.apply(atEnd, "album-a");
  assertPoseNear(atEnd, target);
  transition.finishFrame();
  assert.equal(transition.active, false);
});

test("layout camera keeps a finite visible span and finite vectors from start to end", () => {
  const transition = new MusicLayoutTransition();
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
  const startAim = new THREE.Vector3(1, -1, 2);
  const startPosition = new THREE.Vector3(4, 3, 13);
  camera.position.copy(startPosition);
  camera.lookAt(startAim);
  const startSpan = visibleSpan(camera, startAim);
  const targetPosition = new THREE.Vector3(-5, 6, 12);
  const targetAim = new THREE.Vector3(2, 1, 1);
  const targetSpan = 18;
  const renderedAim = startAim.clone();

  transition.begin(new Map(), matrixAt([0, 0, 0]), camera, startAim, false, true);
  for (const sample of [
    { dt: 0, expectedSpan: startSpan },
    { dt: 0.725, expectedSpan: (startSpan + targetSpan) / 2 * 1.09 },
    { dt: 0.725, expectedSpan: targetSpan },
  ]) {
    transition.advance(sample.dt);
    transition.applyCamera(camera, renderedAim, targetPosition, targetAim, targetSpan);
    assertFiniteVector(camera.position);
    assertFiniteVector(renderedAim);
    assert.ok(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180);
    close(visibleSpan(camera, renderedAim), sample.expectedSpan, 1e-5);
  }
  for (const axis of ["x", "y", "z"]) {
    close(camera.position[axis], targetPosition[axis]);
    close(renderedAim[axis], targetAim[axis]);
  }
});

test("a fast reverse retargets from the rendered pose and clear stops further morphing", () => {
  const transition = new MusicLayoutTransition();
  const source = matrixAt([-3, 1, 2], [0.1, -0.2, 0.3]);
  const outboundTarget = matrixAt([9, 4, -5], [0.5, 1.2, -0.4], [1.4, 0.8, 1.2]);
  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 100);
  camera.position.set(0, 1, 12);
  const renderedAim = new THREE.Vector3(0, 0, 0);

  transition.begin(new Map([["rack", source.clone()]]), source, camera, renderedAim, false, true);
  transition.advance(0.58);
  const inFlight = outboundTarget.clone();
  transition.apply(inFlight, "rack");
  const renderedPose = inFlight.clone();

  transition.begin(
    new Map([["rack", renderedPose.clone()]]),
    renderedPose,
    camera,
    renderedAim,
    true,
    false,
  );
  const reverseStart = source.clone();
  transition.apply(reverseStart, "rack");
  assertPoseNear(reverseStart, renderedPose);
  close(transition.shelfAmount, 1);

  transition.advance(2);
  const reverseEnd = source.clone();
  transition.apply(reverseEnd, "rack");
  assertPoseNear(reverseEnd, source);
  close(transition.shelfAmount, 0);

  transition.clear();
  assert.equal(transition.active, false);
  close(transition.progress, 1);
  close(transition.shelfAmount, 0);
  const unchanged = outboundTarget.clone();
  const beforeClearApply = unchanged.clone();
  transition.apply(unchanged, "rack");
  assertPoseNear(unchanged, beforeClearApply);
});
