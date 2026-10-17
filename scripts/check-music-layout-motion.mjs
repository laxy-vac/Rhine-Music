import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicMatrixDrag } from "../src/music-matrix-drag.ts";
import {
  MusicLayoutTransition,
  shelfEntryCamera,
  shelfEntryFrame,
} from "../src/music-layout-transition.ts";

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

const layoutDuration = 1.12;

test("layout transition is linear and release/resolve weights do not overlap", () => {
  const transition = new MusicLayoutTransition();
  transition.begin();
  assert.equal(transition.active, true);
  close(transition.progress, 0);

  let previousProgress = 0;
  let previousOutgoing = 1;
  let previousIncoming = 0;
  for (let step = 0; step <= 100; step++) {
    if (step > 0) transition.advance(layoutDuration / 100);
    const expectedProgress = step / 100;
    const progress = transition.progress;
    close(progress, expectedProgress, 1e-12);
    assert.ok(progress >= previousProgress, "progress must be monotonic");

    const { outgoing, incoming, phase } = transition.frame;
    assert.ok(outgoing >= -1e-12 && outgoing <= 1 + 1e-12);
    assert.ok(incoming >= -1e-12 && incoming <= 1 + 1e-12);
    assert.ok(
      !(outgoing > 1e-12 && incoming > 1e-12),
      "the two frames must not cross-fade",
    );
    assert.ok(outgoing <= previousOutgoing + 1e-12, "release weight must not rise");
    assert.ok(incoming + 1e-12 >= previousIncoming, "resolve weight must not fall");
    assert.equal(phase, progress < 0.34 ? "release" : "resolve");

    previousProgress = progress;
    previousOutgoing = outgoing;
    previousIncoming = incoming;
  }

  close(transition.progress, 1);
  close(transition.frame.outgoing, 0);
  close(transition.frame.incoming, 1);
  transition.finishFrame();
  assert.equal(transition.active, false);
  close(transition.progress, 1);
});

test("the .34 boundary separates release from resolve", () => {
  const before = new MusicLayoutTransition();
  before.begin();
  before.advance(layoutDuration * (0.34 - 1e-6));
  assert.equal(before.frame.phase, "release");
  assert.ok(before.frame.outgoing > 0);
  close(before.frame.incoming, 0);

  const after = new MusicLayoutTransition();
  after.begin();
  after.advance(layoutDuration * 0.34 + 1e-12);
  close(after.progress, 0.34, 1e-10);
  assert.equal(after.frame.phase, "resolve");
  close(after.frame.outgoing, 0);
  assert.ok(after.frame.incoming > 0);
});

test("begin resets a partial or completed transition for a reverse layout choice", () => {
  const transition = new MusicLayoutTransition();
  transition.begin();
  transition.advance(layoutDuration / 2);
  close(transition.progress, 0.5);

  transition.begin();
  assert.equal(transition.active, true);
  close(transition.progress, 0);
  close(transition.frame.outgoing, 1);
  close(transition.frame.incoming, 0);
  assert.equal(transition.frame.phase, "release");

  transition.advance(layoutDuration);
  close(transition.progress, 1);
  transition.finishFrame();
  assert.equal(transition.active, false);
  transition.begin();
  assert.equal(transition.active, true);
  close(transition.progress, 0);
});

test("shelf entry reveals structure, then catalog, then reaches ready monotonically", () => {
  const boundaries = [
    { time: 21.99, structure: 0, catalog: 0, casesVisible: false, phase: "structure" },
    { time: 22, structure: 0, catalog: 0, casesVisible: false, phase: "structure" },
    { time: 22.65, structure: 1, catalog: 0, casesVisible: false, phase: "structure" },
    { time: 22.75, structure: 1, catalog: 0, casesVisible: true, phase: "catalog" },
    { time: 24.1, structure: 1, catalog: 1, casesVisible: true, phase: "ready" },
  ];
  for (const expected of boundaries) {
    const actual = shelfEntryFrame(expected.time);
    close(actual.structure, expected.structure);
    close(actual.catalog, expected.catalog);
    assert.equal(actual.casesVisible, expected.casesVisible);
    assert.equal(actual.phase, expected.phase);
  }

  let previousStructure = 0;
  let previousCatalog = 0;
  let previousCasesVisible = false;
  for (let time = 21.9; time <= 24.2; time += 0.025) {
    const frame = shelfEntryFrame(time);
    assert.ok(frame.structure >= previousStructure - 1e-12);
    assert.ok(frame.catalog >= previousCatalog - 1e-12);
    assert.ok(!previousCasesVisible || frame.casesVisible);
    previousStructure = frame.structure;
    previousCatalog = frame.catalog;
    previousCasesVisible = frame.casesVisible;
  }
});

test("shelf camera holds registration through 24.1 and settles exactly to normal framing", () => {
  const camera = new THREE.PerspectiveCamera(38, 16 / 10, 0.1, 100);
  const basePosition = new THREE.Vector3(4, 3, 13);
  const baseAim = new THREE.Vector3(1, -1, 2);
  const normalSpan = 18;
  const distance = basePosition.distanceTo(baseAim);
  const normalFov = THREE.MathUtils.radToDeg(
    2 * Math.atan(normalSpan / (2 * distance)),
  );
  const samples = [21.9, 22, 22.65, 22.75, 24, 24.1, 24.3125, 24.525, 24.7375, 24.95];
  const spans = [];

  for (const time of samples) {
    // scene.ts rebuilds the ordinary framing before applying this small lens settle.
    camera.position.copy(basePosition);
    camera.fov = normalFov;
    const aim = baseAim.clone();
    camera.lookAt(aim);
    const beforePosition = camera.position.clone();
    shelfEntryCamera(camera, aim, time);

    assertFiniteVector(camera.position);
    assertFiniteVector(aim);
    assert.ok(Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180);
    assert.ok(camera.position.distanceTo(beforePosition) < 1e-12);
    assert.ok(aim.distanceTo(baseAim) < 1e-12);

    const span = visibleSpan(camera, aim);
    const ratio = span / normalSpan;
    assert.ok(ratio >= 1 - 1e-9 && ratio <= 1.018 + 1e-9);
    if (time <= 24.1) close(ratio, 1.018, 1e-9);
    spans.push({ time, ratio });
  }

  const settlingSpans = spans.filter(({ time }) => time >= 24.1);
  for (let index = 1; index < settlingSpans.length; index++) {
    assert.ok(settlingSpans[index].ratio <= settlingSpans[index - 1].ratio + 1e-12);
  }
  close(settlingSpans.at(-1).ratio, 1, 1e-9);
  close(camera.fov, normalFov, 1e-9);
});

test("layout camera settles only around the target pose, independent of the old camera", () => {
  const targetPosition = new THREE.Vector3(-5, 6, 12);
  const targetAim = new THREE.Vector3(2, 1, 1);
  const targetSpan = 18;

  function renderFrom(startPosition, startAim, startFov, progress) {
    const transition = new MusicLayoutTransition();
    transition.begin();
    transition.advance(layoutDuration * progress);
    const camera = new THREE.PerspectiveCamera(startFov, 16 / 9, 0.1, 100);
    camera.position.copy(startPosition);
    const renderedAim = startAim.clone();
    camera.lookAt(renderedAim);
    transition.applyCamera(camera, renderedAim, targetPosition, targetAim, targetSpan);
    return { camera, renderedAim };
  }

  const samples = [0, 0.28, 0.5, 0.75, 1];
  for (const progress of samples) {
    const first = renderFrom(
      new THREE.Vector3(0, 2, 14),
      new THREE.Vector3(0, 0, 0),
      34,
      progress,
    );
    const second = renderFrom(
      new THREE.Vector3(40, -20, 5),
      new THREE.Vector3(-12, 9, 20),
      58,
      progress,
    );

    for (const axis of ["x", "y", "z"]) {
      close(first.camera.position[axis], second.camera.position[axis]);
      close(first.renderedAim[axis], targetAim[axis]);
      close(second.renderedAim[axis], targetAim[axis]);
    }
    close(first.camera.fov, second.camera.fov);
    assertFiniteVector(first.camera.position);
    assertFiniteVector(first.renderedAim);

    const targetOffset = targetPosition.clone().sub(targetAim);
    const renderedOffset = first.camera.position.clone().sub(first.renderedAim);
    const horizontalCross = targetOffset.x * renderedOffset.z - targetOffset.z * renderedOffset.x;
    const horizontalDot = targetOffset.x * renderedOffset.x + targetOffset.z * renderedOffset.z;
    const yaw = Math.abs(Math.atan2(horizontalCross, horizontalDot));
    assert.ok(yaw <= 0.025 + 1e-9);
    assert.ok(targetOffset.angleTo(renderedOffset) <= 0.025 + 1e-9);
    const ratio = visibleSpan(first.camera, first.renderedAim) / targetSpan;
    assert.ok(ratio >= 1 - 1e-9 && ratio <= 1.018 + 1e-9);
    if (progress === 0) close(yaw, 0.025, 1e-9);
    if (progress === 1) {
      assert.ok(first.camera.position.distanceTo(targetPosition) < 1e-9);
      close(ratio, 1, 1e-9);
    }
  }
});
