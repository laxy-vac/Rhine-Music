import * as THREE from "three";
import type { CaseLayout } from "./case-layout";
import { archiveFraming } from "./viewport-layout.ts";
import { ARRAY_SELECTED_BELL_LIFT, ARRAY_SELECTED_EXTRA_LIFT } from "./music-array-motion.ts";
import { MUSIC_SHELF_VIEW } from "./music-display-layout.ts";

export type MusicArrayComposition = {
  span: number;
  effectiveSpan: number;
  availableWidth: number;
  visibleSlots: number;
};

/** Resolve ARRAY's responsive camera span and shelf window without scene state. */
export function musicArrayCompositionFrame(
  width: number,
  height: number,
  availableWidth: number,
  arrayScale: number,
  shelfRowSpacing: number,
  bounds: CaseLayout["bounds"],
  center: CaseLayout["center"],
  compact: boolean,
): MusicArrayComposition {
  width = Math.max(1, width);
  height = Math.max(1, height);
  availableWidth = Math.max(1, availableWidth);
  const scale = Math.max(.01, arrayScale);
  const zoom = THREE.MathUtils.clamp(Math.min(availableWidth / MUSIC_SHELF_VIEW.referenceWidth,
    height / MUSIC_SHELF_VIEW.referenceHeight), 1, 1.6);
  const pixelScale = MUSIC_SHELF_VIEW.pixelsPerUnit * zoom * scale;
  const yaw = THREE.MathUtils.degToRad(-38), elevation = THREE.MathUtils.degToRad(35);
  const view = new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), view).normalize();
  const up = new THREE.Vector3().crossVectors(view, right).normalize();
  let visibleSlots = 0;
  for (let slot = 0; slot < MUSIC_SHELF_VIEW.slots; slot++) {
    let maxX = -Infinity, minY = Infinity;
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]])
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const point = new THREE.Vector3(x - center.x,
          y - bounds.min[1] + ARRAY_SELECTED_EXTRA_LIFT + ARRAY_SELECTED_BELL_LIFT,
          z - center.z + slot * shelfRowSpacing);
        maxX = Math.max(maxX, availableWidth * MUSIC_SHELF_VIEW.originX + point.dot(right) * pixelScale);
        minY = Math.min(minY, height - MUSIC_SHELF_VIEW.bottomInset - point.dot(up) * pixelScale);
      }
    if (maxX > availableWidth || minY < 56) break;
    visibleSlots++;
  }
  const span = height / pixelScale;
  const portraitSpan = archiveFraming(width, height, 10.5, 0, compact);
  const effectiveSpan = portraitSpan.portrait ? portraitSpan.span / scale : span;
  return { span, effectiveSpan, availableWidth, visibleSlots: Math.max(6, visibleSlots) };
}
