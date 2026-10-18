import * as THREE from "three";
import { deploymentStep } from "./music-shelf-deployment";
import { casePartTransformMatrix } from "./case-materials";
import type { CaseLayout } from "./case-layout";
import type { CaseAppearance, CaseTransform } from "./case-settings";

export type PunkCaseDisplayMount = {
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  left: number;
  right: number;
  top: number;
  gapY: number;
  attachmentOverlap: number;
  corners: [number[], number[], number[], number[]];
  frameBounds: { min: number[]; max: number[] };
  clipBounds: { min: number[]; max: number[] };
  currentMatrix: number[];
};

const identity: CaseTransform = {
  visible: true,
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

/** Power and scan share the same eased phases as the shelf deployment. */
export function punkCaseDisplayPhase(
  q: number,
  shelf: boolean,
  active: boolean,
  reduced: boolean,
): { power: number; scan: number } {
  const endpoint = shelf ? 1 : 0;
  if (reduced || !active) return { power: endpoint, scan: endpoint };
  return {
    power: 1 - deploymentStep(q, 0.72, 0.92),
    scan: 1 - deploymentStep(q, 0.22, 0.68),
  };
}

type PartBounds = { bounds: THREE.Box3; pivot: THREE.Vector3 };

function partBounds(model: THREE.Object3D, prefix: string, part: "frame" | "clip"): PartBounds | undefined {
  const meshes: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh && object.name.startsWith(prefix)) meshes.push(object);
  });
  // The production exporter batches like-material parts. Its joined frame
  // retains the upper beam's real top face, but not the individual beam name.
  if (!meshes.length) model.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.casePart === part)
      meshes.push(object);
  });
  if (!meshes.length) return;

  const bounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  let pivot: THREE.Vector3 | undefined;
  for (const mesh of meshes) {
    const rest = mesh.geometry.getAttribute("caseRestPosition");
    if (!rest) continue;
    const savedPivot = mesh.geometry.userData.casePartPivot;
    if (!pivot && Array.isArray(savedPivot) && savedPivot.length >= 3)
      pivot = new THREE.Vector3(savedPivot[0], savedPivot[1], savedPivot[2]);
    for (let index = 0; index < rest.count; index++) {
      bounds.expandByPoint(point.fromBufferAttribute(rest, index));
    }
  }
  if (bounds.isEmpty()) return;
  return { bounds, pivot: pivot ?? bounds.getCenter(new THREE.Vector3()) };
}

function transformedBounds(part: PartBounds, transform: CaseTransform): THREE.Box3 {
  const matrix = casePartTransformMatrix(transform, part.pivot);
  return part.bounds.clone().applyMatrix4(matrix);
}

/**
 * Locate the small top display from Punk's named rest-geometry parts. The
 * returned frame matrix is the same transform used for the frame mesh, so a
 * mounted plane follows frame edits without using the clip's transform.
 */
export function punkCaseDisplayMount(
  layout: CaseLayout,
  model?: THREE.Object3D,
  appearance?: CaseAppearance,
): PunkCaseDisplayMount | undefined {
  if (!model || model.userData.caseStructure !== "punk") return;
  const frameTransform = appearance?.transforms?.frame ?? identity;
  const clipTransform = appearance?.transforms?.clip ?? identity;
  if (!frameTransform.visible || !clipTransform.visible) return;

  const beam = partBounds(model, "punk_frame_top_beam", "frame");
  const clip = partBounds(model, "punk_top_clip", "clip");
  if (!beam || !clip) return;

  const scale = Number.isFinite(layout.sourceScale) && layout.sourceScale > 0
    ? layout.sourceScale
    : 1;
  const left = beam.bounds.min.x + 0.16 * scale;
  const clipBounds = transformedBounds(clip, clipTransform);
  const clipCenterZ = clipBounds.getCenter(new THREE.Vector3()).z;
  const depth = Math.min(0.22 * scale, beam.bounds.getSize(new THREE.Vector3()).z - 0.07 * scale);
  if (!(depth > 0)) return;

  const zMin = beam.bounds.min.z + depth / 2;
  const zMax = beam.bounds.max.z - depth / 2;
  if (zMax < zMin) return;
  const z = THREE.MathUtils.clamp(clipCenterZ, zMin, zMax);
  const gapY = 0.001 * scale;
  const attachmentOverlap = 0.006 * scale;
  const y = beam.bounds.max.y + gapY;

  const frameMatrix = casePartTransformMatrix(frameTransform, beam.pivot);
  const leftOnFrame = new THREE.Vector3(left, y, z).applyMatrix4(frameMatrix);
  const rightOnClip = clipBounds.min.x + attachmentOverlap;
  const frameXAxis = frameMatrix.elements[0]!;
  if (Math.abs(frameXAxis) < 1e-5) return;
  const right = left + (rightOnClip - leftOnFrame.x) / frameXAxis;
  const width = Math.abs(right - left);
  if (!(width > 0.01 * scale)) return;

  const x = (left + right) / 2;
  const planeMatrix = frameMatrix.clone()
    .multiply(new THREE.Matrix4().makeTranslation(x, y, z))
    .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  const corner = (cx: number, cy: number) =>
    new THREE.Vector3(cx, cy, 0).applyMatrix4(planeMatrix).toArray();
  const corners: [number[], number[], number[], number[]] = [
    corner(-width / 2, -depth / 2),
    corner(width / 2, -depth / 2),
    corner(width / 2, depth / 2),
    corner(-width / 2, depth / 2),
  ];
  const frameFinalBounds = beam.bounds.clone().applyMatrix4(frameMatrix);

  return {
    x,
    y,
    z,
    width,
    depth,
    left: Math.min(left, right),
    right: Math.max(left, right),
    top: y,
    gapY,
    attachmentOverlap,
    corners,
    frameBounds: { min: frameFinalBounds.min.toArray(), max: frameFinalBounds.max.toArray() },
    clipBounds: { min: clipBounds.min.toArray(), max: clipBounds.max.toArray() },
    currentMatrix: planeMatrix.toArray(),
  };
}
