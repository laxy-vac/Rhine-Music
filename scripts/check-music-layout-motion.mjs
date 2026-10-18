import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { MusicMatrixDrag } from "../src/music-matrix-drag.ts";
import {
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
