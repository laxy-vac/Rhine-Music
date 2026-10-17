import { MUSIC_SHELF_VIEW } from "./music-display-layout.ts";

/** Final world-space slot anchors shared by the rack and its record case. */
export type ShelfSlotFrame = {
  laneX: number;
  frontZ: number;
  floorY: number;
  rowRatio: number;
};

export const deploymentStep = (value: number, start = 0, end = 1) => {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Physical dimensions of the telescoping structure, shared with its cases. */
export function shelfDeployment(amount: number) {
  return {
    width: deploymentStep(amount, 0, .3),
    length: deploymentStep(amount, .05, .7),
    supports: deploymentStep(amount, 0, .4),
    rails: deploymentStep(amount, .2, .85),
    labels: deploymentStep(amount, .72, 1),
  };
}

export const shelfSlotDeployment = (amount: number, rowRatio: number) =>
  deploymentStep(amount, .2 + .35 * Math.max(0, Math.min(1, rowRatio)), .55 + .35 * Math.max(0, Math.min(1, rowRatio)));

/** All load-bearing parts follow one deck; only their local growth differs. */
export function shelfAssemblySlot(amount: number, slot: ShelfSlotFrame) {
  const structure = shelfDeployment(amount);
  const slotProgress = shelfSlotDeployment(amount, slot.rowRatio);
  const groundY = slot.floorY - MUSIC_SHELF_VIEW.floorDrop;
  const stowedDeckY = groundY + .16;
  return {
    width: structure.width,
    length: structure.length,
    slotProgress,
    // Preserve the exact resting frame when the structure is fully deployed.
    deckY: structure.supports === 1 ? slot.floorY
      : stowedDeckY + (slot.floorY - stowedDeckY) * structure.supports,
  };
}
