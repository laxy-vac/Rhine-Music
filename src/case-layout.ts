import * as THREE from "three";
import { MUSIC_COVER, MUSIC_MODEL } from "./music-model";

export type CaseRect = {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
};
export type CaseLayout = {
  insertThickness?: number;
  width: number;
  height: number;
  depth: number;
  center: { x: number; y: number; z: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  cover: CaseRect;
  label: CaseRect;
  sourceScale: number;
  sourceYOffset: number;
};

export const minimalCaseLayout: CaseLayout = {
  width: MUSIC_MODEL.width,
  height: MUSIC_MODEL.height,
  depth: MUSIC_MODEL.depth,
  center: { ...MUSIC_MODEL.center },
  bounds: {
    min: [
      -MUSIC_MODEL.width / 2,
      MUSIC_MODEL.center.y - MUSIC_MODEL.height / 2,
      -MUSIC_MODEL.depth / 2,
    ],
    max: [
      MUSIC_MODEL.width / 2,
      MUSIC_MODEL.center.y + MUSIC_MODEL.height / 2,
      MUSIC_MODEL.depth / 2,
    ],
  },
  cover: { ...MUSIC_COVER },
  label: {
    x: 1.95,
    y: MUSIC_MODEL.center.y,
    z: 0.09,
    width: 0.46,
    height: 0.32,
  },
  sourceScale: 1,
  sourceYOffset: 0,
};

/** Fit by height with one uniform scale: never stretch the source silhouette or depth. */
export function nativeCaseLayout(
  bounds: THREE.Box3,
  cover: CaseRect,
  label: CaseRect,
  referenceHeight = bounds.max.y - bounds.min.y,
): CaseLayout {
  const scale = MUSIC_MODEL.height / referenceHeight;
  const offset =
    MUSIC_MODEL.center.y - (bounds.min.y + referenceHeight / 2) * scale;
  const min = bounds.min.clone().multiplyScalar(scale);
  min.y += offset;
  const max = bounds.max.clone().multiplyScalar(scale);
  max.y += offset;
  const rect = (r: CaseRect): CaseRect => ({
    x: r.x * scale,
    y: r.y * scale + offset,
    z: r.z * scale,
    width: r.width * scale,
    height: r.height * scale,
  });
  return {
    width: max.x - min.x,
    height: max.y - min.y,
    depth: max.z - min.z,
    center: {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2,
    },
    bounds: {
      min: min.toArray() as [number, number, number],
      max: max.toArray() as [number, number, number],
    },
    cover: rect(cover),
    label: rect(label),
    sourceScale: scale,
    sourceYOffset: offset,
  };
}

export function getCaseLayout(model?: THREE.Object3D): CaseLayout {
  return model?.userData.caseLayout ?? minimalCaseLayout;
}
