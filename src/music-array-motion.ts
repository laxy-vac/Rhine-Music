import { damp, type Spring } from "./motion";
import { qualityIdleGain, type WaveQuality } from "./quality-motion";

// Adapted from RhinE 1.4.0 js/archive.js caseTargets (MIT).
export function arrayNeighborLift(distance: number) {
  if (!Number.isFinite(distance)) return 0;
  const square = distance * distance;
  return 1.1 * (Math.exp(-square / 4.5) - .32 * Math.exp(-square / 18));
}
export const ARRAY_SELECTED_EXTRA_LIFT = 1.35;
export const ARRAY_SELECTED_BELL_LIFT = arrayNeighborLift(0);
export const ARRAY_HOVER_LIFT = .5;

export type ArrayMotionCell = { key: string; lane: number; row: number };

/** Persistent local shoulders, with the original per-case critical springs. */
export class MusicArrayCaseMotion {
  private heights = new Map<string, Spring>();
  private cells = new Map<string, string>();

  step(cells: readonly ArrayMotionCell[], selectedKey: string, selectedLane: number, selectedRow: number,
    level: WaveQuality, hoverSelected: boolean, dt: number, reduced: boolean) {
    if (!Number.isFinite(dt) || dt < 0) return;
    this.cells.clear();
    const present = new Set<string>();
    for (const cell of cells) {
      if (present.has(cell.key)) continue;
      present.add(cell.key);
      this.cells.set(`${cell.lane}:${cell.row}`, cell.key);
      const active = cell.lane === selectedLane;
      const selected = cell.key === selectedKey;
      const target = !active ? 0 : selected
        ? ARRAY_SELECTED_BELL_LIFT + (hoverSelected ? ARRAY_HOVER_LIFT : 0)
        : Math.max(0, arrayNeighborLift(cell.row - selectedRow)) * qualityIdleGain(level);
      let state = this.heights.get(cell.key);
      if (!state) { state = { value: target, velocity: 0 }; this.heights.set(cell.key, state); }
      if (reduced) { state.value = target; state.velocity = 0; }
      else damp(state, target, active ? 13 : 7, dt);
    }
    for (const key of this.heights.keys()) if (!present.has(key)) this.heights.delete(key);
  }

  sample(lane: number, row: number) {
    const at = (slot: number) => this.heights.get(this.cells.get(`${lane}:${slot}`) ?? "")?.value ?? 0;
    const first = Math.floor(row), last = Math.ceil(row);
    return first === last ? at(first) : at(first) * (last - row) + at(last) * (row - first);
  }

  clear() { this.heights.clear(); this.cells.clear(); }
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

  bind(keys: readonly string[], lane: number, row: number, snap = false) {
    this.keys = [...keys];
    const present = new Set(keys);
    for (const key of this.rows.keys()) if (!present.has(key)) this.rows.delete(key);
    const state = this.activate(lane);
    if (state && snap && Number.isFinite(row)) {
      state.value = row;
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

  step(lane: number, row: number, rate: number, dt: number, reduced: boolean) {
    if (![row, rate, dt].every(Number.isFinite) || rate <= 0 || dt < 0) return;
    const state = this.activate(lane);
    if (!state) return;
    if (reduced) { state.value = row; state.velocity = 0; }
    else damp(state, row, rate, dt);
  }

  row(lane: number) { return this.rows.get(this.keys[lane])?.value ?? this.firstRow; }
  velocity(lane: number) { return this.rows.get(this.keys[lane])?.velocity ?? 0; }

  rail(lane: number, spacing: number, centerRow: number, inspectionZ: number) {
    return inspectionZ - (this.row(lane) - centerRow) * spacing;
  }
}
