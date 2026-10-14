import type { MusicLayout } from "./music-view-settings";

/** View contracts are independent of theme resources and rendering backends. */
export const MUSIC_ARRAY_VIEW = {
  columnSpacing: 5.2, rowSpacing: 0.62, centerLane: 2, centerRow: 15.5, firstRow: 12,
  floorY: -4.6, inspectionZ: -2.17,
  yaw: 59, elevation: 25, span: 7.33, distance: 140,
  aim: { x: -1.091, y: -0.045, z: 0.481 },
} as const;

/** The legacy shelf adapter consumes this projection contract until phase three. */
export const MUSIC_SHELF_VIEW = {
  slots: 20, rowSpacing: 1, columnSpacing: 4.7, originX: 0.37, bottomInset: 87,
} as const;

export interface MusicDisplayLayout {
  requested: MusicLayout;
  effective: MusicLayout;
  canvas: "array" | "shelf";
  grid: boolean;
}

/** An adapter may temporarily lack resources for a view; the user's choice stays intact. */
export function resolveMusicDisplayLayout(requested: MusicLayout, available: readonly MusicLayout[]): MusicDisplayLayout {
  const effective = available.includes(requested) ? requested : available.includes("array") ? "array" : available[0] ?? "array";
  return { requested, effective, canvas: effective === "shelf" ? "shelf" : "array", grid: effective === "grid" };
}

export function musicArrayPosition(cell: { lane: number; row: number }) {
  return {
    x: (cell.lane - MUSIC_ARRAY_VIEW.centerLane) * MUSIC_ARRAY_VIEW.columnSpacing,
    y: MUSIC_ARRAY_VIEW.floorY,
    z: (cell.row - MUSIC_ARRAY_VIEW.centerRow) * MUSIC_ARRAY_VIEW.rowSpacing,
  };
}

export function musicPointerDragThreshold(layout: MusicLayout) { return layout === "shelf" ? 12 : 6; }
