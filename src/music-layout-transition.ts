import * as THREE from "three";
import type { ArchiveCell } from "./archive-loop";
import { deploymentStep as ease, shelfAssemblySlot, type ShelfSlotFrame } from "./music-shelf-deployment.ts";

export type GeometryPose = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };
export type CanonicalSlot = { lane: number; row: number; order: number };
export type LayoutSample = { cell: ArchiveCell; matrix: THREE.Matrix4; restMatrix?: THREE.Matrix4; alpha: number; tint: number };
export const musicGeometryPose = (matrix: THREE.Matrix4): GeometryPose => {
  const value = { position: new THREE.Vector3().setFromMatrixPosition(matrix), rotation: new THREE.Quaternion(), scale: new THREE.Vector3() };
  const e = matrix.elements;
  value.scale.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  if (value.scale.x * value.scale.y * value.scale.z > 1e-12) matrix.decompose(value.position, value.rotation, value.scale);
  return value;
};

export { MusicLayoutTransition } from "./music-layout-flight.ts";

export function shelfEntryFrame(time: number) {
  // Each component already has its own eased travel. A second eased clock
  // would leave most of the opening empty, then rush the assembly midpoint.
  return { deployment: THREE.MathUtils.clamp((time - 22) / 3, 0, 1), phase: time < 25 ? "assemble" : "ready" };
}
export function shelfEntryPose(matrix: THREE.Matrix4, time: number, slot: ShelfSlotFrame, caseTop = 3.525) {
  const structure = shelfAssemblySlot(shelfEntryFrame(time).deployment, slot);
  const rise = structure.slotProgress, p = musicGeometryPose(matrix);
  p.position.x = slot.laneX + (p.position.x - slot.laneX) * structure.width;
  p.position.z = slot.frontZ + (p.position.z - slot.frontZ) * structure.length;
  const stowedY = structure.deckY - .12 - caseTop * p.scale.y;
  p.position.y = THREE.MathUtils.lerp(stowedY, structure.deckY + p.position.y - slot.floorY, rise);
  // Retain rigid vertical geometry and UVs. The opaque deck/floor reveals the
  // case from below, without flattening its glass, cover and trim together.
  p.scale.multiply(new THREE.Vector3(structure.width, structure.width > 0 && structure.length > 0 ? 1 : 0, structure.length));
  matrix.compose(p.position, p.rotation, p.scale);
}
export function shelfEntryCamera(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, time: number,
  focus?: { point: THREE.Vector3; restingPoint: THREE.Vector3 }) {
  camera.lookAt(aim); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const restingFocus = focus?.restingPoint.clone().project(camera);
  const t = ease(time, 22, 25.45), offset = camera.position.clone().sub(aim), distance = offset.length();
  const yaw = Math.atan2(offset.x, offset.z) + THREE.MathUtils.degToRad(13) * (1 - t);
  const elevation = Math.asin(offset.y / distance) - THREE.MathUtils.degToRad(5) * (1 - t);
  camera.position.copy(aim).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(distance)); camera.lookAt(aim);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (1 + .08 * (1 - t))));
  if (focus && restingFocus) {
    const desired = new THREE.Vector2(-.14, 0).lerp(new THREE.Vector2(restingFocus.x, restingFocus.y), t);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const outward = camera.position.clone().sub(aim).normalize(), relative = focus.point.clone().sub(camera.position);
    const depth = -relative.dot(outward), halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const correction = right.multiplyScalar(relative.dot(right) - desired.x * halfHeight * camera.aspect)
      .add(up.multiplyScalar(relative.dot(up) - desired.y * halfHeight));
    camera.position.add(correction); aim.add(correction); camera.lookAt(aim);
  }
}
