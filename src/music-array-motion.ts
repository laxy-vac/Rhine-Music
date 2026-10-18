import { damp, type Spring } from "./motion.ts";
import type { WaveQuality } from "./quality-motion";
import { MUSIC_SHELF_VIEW } from "./music-display-layout.ts";

/** Columns ahead of the active shelf fade away; later shelves recede into the page. */
export function arrayLaneAppearance(lane: number, focus: number) {
  const pos = lane - focus;
  const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
  return {
    alpha: clamp(1 + pos) * clamp((4 - pos) / .8),
    tint: Math.round(clamp(.38 * clamp(pos) + .14 * Math.max(0, pos), .8) * 10) / 10,
  };
}

export const ARRAY_SELECTED_EXTRA_LIFT = 1.35;
// Keep the original caseTargets centre lift while varying the sampled footprint.
export const ARRAY_SELECTED_BELL_LIFT = .748;
export const ARRAY_HOVER_LIFT = .5;
const NEIGHBOR_RADII: Record<WaveQuality, number> = { off: 0, basic: 1, reduced: 2, full: 4 };

/** ARRAY samples one compact rise; the level changes its width, not its peak. */
export function arrayNeighborLift(distance: number, level: WaveQuality = "full") {
  if (!Number.isFinite(distance)) return 0;
  const radius = NEIGHBOR_RADII[level], offset = Math.abs(distance);
  if (offset > radius) return 0;
  return ARRAY_SELECTED_BELL_LIFT * (1 + Math.cos(Math.PI * offset / (radius + 1))) / 2;
}

/** The reference hover is a separate, softer Gaussian over nearby shelf slots. */
export function arrayHoverLift(distance: number) {
  return Number.isFinite(distance) ? ARRAY_HOVER_LIFT * Math.exp(-distance * distance / 2.2) : 0;
}

export type ArrayMotionCell = { key: string; lane: number; row: number };

/** Independent selection and hover rises, followed by per-case damped springs. */
export class MusicArrayCaseMotion {
  private heights = new Map<string, Spring>();
  private cells = new Map<string, string>();

  step(cells: readonly ArrayMotionCell[], selectedKey: string, selectedLane: number, selectedRow: number,
    level: WaveQuality, hoveredKey: string | undefined, dt: number, reduced: boolean) {
    if (!Number.isFinite(dt) || dt < 0) return;
    const hovered = hoveredKey ? cells.find(cell => cell.key === hoveredKey && cell.lane === selectedLane) : undefined;
    this.cells.clear();
    const present = new Set<string>();
    for (const cell of cells) {
      if (present.has(cell.key)) continue;
      present.add(cell.key);
      this.cells.set(`${cell.lane}:${cell.row}`, cell.key);
      const active = cell.lane === selectedLane;
      const selected = cell.key === selectedKey;
      const selectedLift = selected ? ARRAY_SELECTED_BELL_LIFT : arrayNeighborLift(cell.row - selectedRow, level);
      const target = active ? selectedLift + (hovered ? arrayHoverLift(cell.row - hovered.row) : 0) : 0;
      let state = this.heights.get(cell.key);
      if (!state) { state = { value: target, velocity: 0 }; this.heights.set(cell.key, state); }
      if (reduced) { state.value = target; state.velocity = 0; }
      else damp(state, target, active ? 13 : 7, dt);
    }
    for (const key of this.heights.keys()) if (!present.has(key)) this.heights.delete(key);
  }

  sample(lane: number, row: number) {
    const at = (slot: number) => Math.max(0, this.heights.get(this.cells.get(`${lane}:${slot}`) ?? "")?.value ?? 0);
    const first = Math.floor(row), last = Math.ceil(row);
    return first === last ? at(first) : at(first) * (last - row) + at(last) * (row - first);
  }

  clear() {
    this.heights.clear(); this.cells.clear();
  }
}

/** Each physical rack owns its slot position; only the active rack advances. */
export class MusicArrayMotion {
  private readonly firstRow: number;
  private keys: readonly string[] = [];
  private rows = new Map<string, Spring>();
  private activeKey: string | undefined;

  constructor(firstRow: number) {
    this.firstRow = Number.isFinite(firstRow) ? firstRow : 12;
  }

  bind(keys: readonly string[], lane: number, row: number, snap = false, visibleSlots = 6) {
    this.keys = [...keys];
    const present = new Set(keys);
    for (const key of this.rows.keys()) if (!present.has(key)) this.rows.delete(key);
    const state = this.activate(lane);
    if (state && snap && Number.isFinite(row)) {
      state.value = this.targetRow(row, visibleSlots);
      state.velocity = 0;
    }
  }

  private activate(lane: number) {
    const key = this.keys[lane];
    if (this.activeKey !== key) {
      const previous = this.activeKey === undefined ? undefined : this.rows.get(this.activeKey);
      if (previous) previous.velocity = 0;
      this.activeKey = key;
    }
    if (key === undefined) return undefined;
    let state = this.rows.get(key);
    if (!state) {
      state = { value: this.firstRow, velocity: 0 };
      this.rows.set(key, state);
    }
    return state;
  }

  targetRow(row: number, visibleSlots = 6) {
    const visible = Number.isFinite(visibleSlots) ? Math.max(6, Math.min(MUSIC_SHELF_VIEW.slots, visibleSlots)) : 6;
    return this.firstRow + Math.max(0, Math.min(MUSIC_SHELF_VIEW.slots - visible,
      row - this.firstRow - MUSIC_SHELF_VIEW.previewSlot));
  }

  step(lane: number, row: number, rate: number, dt: number, reduced: boolean, visibleSlots = 6) {
    if (![row, rate, dt].every(Number.isFinite) || rate <= 0 || dt < 0) return;
    const state = this.activate(lane);
    if (!state) return;
    const target = this.targetRow(row, visibleSlots);
    if (reduced) { state.value = target; state.velocity = 0; }
    else damp(state, target, rate, dt);
  }

  row(lane: number) { return this.rows.get(this.keys[lane])?.value ?? this.firstRow; }
  velocity(lane: number) { return this.rows.get(this.keys[lane])?.velocity ?? 0; }

  rail(lane: number, spacing: number, centerRow: number, inspectionZ: number) {
    return inspectionZ - (this.row(lane) - centerRow) * spacing;
  }
}
