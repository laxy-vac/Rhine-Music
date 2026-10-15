import { damp, type Spring } from "./motion";
import { qualityIdleGain, type WaveQuality } from "./quality-motion";
import { MUSIC_SHELF_VIEW } from "./music-display-layout";

/** Columns ahead of the active shelf fade away; later shelves recede into the page. */
export function arrayLaneAppearance(lane: number, focus: number) {
  const pos = lane - focus;
  const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value));
  return {
    alpha: clamp(1 + pos) * clamp((4 - pos) / .8),
    tint: Math.round(clamp(.38 * clamp(pos) + .14 * Math.max(0, pos), .8) * 10) / 10,
  };
}

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

const RACK_WAVES = {
  basic: { amplitude: .12, speed: 14, radius: 3, damping: 5.5, duration: .65, limit: .2 },
  reduced: { amplitude: .22, speed: 12, radius: 10, damping: 3.5, duration: .95, limit: .4 },
  full: { amplitude: .36, speed: 12, radius: Infinity, damping: 2.4, duration: 1.15, limit: .75 },
} as const;

/** A travelling crest followed by a trough; full adds free-end reflections. */
export function arrayRackWave(level: WaveQuality, row: number, source: number, first: number, last: number,
  age: number, energy = 1) {
  if (level === "off" || ![row, source, first, last, age, energy].every(Number.isFinite) ||
    last <= first || row < first || row > last || source < first || source > last || age < 0) return 0;
  const settings = RACK_WAVES[level];
  const packet = (distance: number) => {
    if (distance > settings.radius) return 0;
    const time = age - distance / settings.speed;
    if (time <= 0 || time >= settings.duration) return 0;
    const attack = Math.min(1, time / .06), release = Math.min(1, (settings.duration - time) / .12);
    const range = Number.isFinite(settings.radius) ? Math.max(0, 1 - (distance / (settings.radius + 1)) ** 2) : 1;
    return settings.amplitude * energy * range * Math.exp(-distance / 48 - settings.damping * time) *
      Math.sin(2 * Math.PI * 2.4 * time) * attack * release;
  };
  const direct = packet(Math.abs(row - source));
  return level === "full" ? direct + .62 * (
    packet(source - first + row - first) + packet(last - source + last - row)) : direct;
}

type RackSelection = { key: string; lane: number; row: number };
type RackImpulse = RackSelection & { first: number; last: number; time: number; energy: number };

/** Persistent local shoulders, with the original per-case critical springs. */
export class MusicArrayCaseMotion {
  private heights = new Map<string, Spring>();
  private cells = new Map<string, string>();
  private waveRows = new Map<number, number>();
  private impulses: RackImpulse[] = [];
  private pendingSelections: RackSelection[] = [];
  private previousSelection?: RackSelection;
  private waveLevel: WaveQuality = "off";
  private clock = 0;
  private activeLane = -1;

  /** Keep fast wheel/reversal inputs even if several arrive before one frame. */
  selectionChanged(key: string, lane: number, row: number) {
    if (!key || !Number.isFinite(lane) || !Number.isFinite(row)) return;
    this.pendingSelections.push({ key, lane, row });
    if (this.pendingSelections.length > 128) this.pendingSelections.shift();
  }

  step(cells: readonly ArrayMotionCell[], selectedKey: string, selectedLane: number, selectedRow: number,
    level: WaveQuality, hoverSelected: boolean, dt: number, reduced: boolean, interactive = true) {
    if (!Number.isFinite(dt) || dt < 0) return;
    const carriedLift = !reduced && this.activeLane === selectedLane && this.previousSelection?.key !== selectedKey
      ? this.waveRows.get(selectedRow) ?? 0 : 0;
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
      // A card caught by a passing wave starts extraction at its visible height.
      if (selected && carriedLift) state.value = Math.max(0, state.value + carriedLift);
      if (reduced) { state.value = target; state.velocity = 0; }
      else damp(state, target, active ? 13 : 7, dt);
    }
    for (const key of this.heights.keys()) if (!present.has(key)) this.heights.delete(key);
    this.clock += Math.min(dt, .05);
    this.waveRows.clear();
    const current = { key: selectedKey, lane: selectedLane, row: selectedRow };
    const activeRows = cells.filter(cell => cell.lane === selectedLane && present.has(cell.key)).map(cell => cell.row);
    const first = Math.min(...activeRows), last = Math.max(...activeRows);
    if (this.activeLane !== selectedLane || this.waveLevel !== level || reduced || !interactive || level === "off")
      this.impulses = [];
    this.activeLane = selectedLane;
    this.waveLevel = level;
    const selections = this.pendingSelections.splice(0);
    if (!selections.length || selections[selections.length - 1].key !== selectedKey) selections.push(current);
    for (const selection of selections) {
      const previous = this.previousSelection;
      if (!reduced && interactive && level !== "off" && selection.lane === selectedLane &&
        previous?.lane === selectedLane && previous.key !== selection.key && last > first) {
        this.impulses.push({ ...selection, first, last, time: this.clock,
          energy: 1 + Math.min(3, Math.abs(selection.row - previous.row)) * .12 });
      }
      this.previousSelection = selection;
    }
    this.previousSelection = current;
    if (reduced || !interactive || level === "off") return;
    const settings = RACK_WAVES[level];
    this.impulses = this.impulses.filter(impulse => impulse.lane === selectedLane &&
      this.clock - impulse.time < (level === "full" ? 2 * (impulse.last - impulse.first) : settings.radius) /
        settings.speed + settings.duration).slice(-128);
    for (const row of new Set(activeRows)) {
      if (row === selectedRow) continue;
      let displacement = 0;
      for (const impulse of this.impulses)
        displacement += arrayRackWave(level, row, impulse.row, impulse.first, impulse.last, this.clock - impulse.time, impulse.energy);
      this.waveRows.set(row, settings.limit * Math.tanh(displacement / settings.limit));
    }
  }

  sample(lane: number, row: number) {
    const at = (slot: number) => Math.max(0, (this.heights.get(this.cells.get(`${lane}:${slot}`) ?? "")?.value ?? 0) +
      (lane === this.activeLane ? this.waveRows.get(slot) ?? 0 : 0));
    const first = Math.floor(row), last = Math.ceil(row);
    return first === last ? at(first) : at(first) * (last - row) + at(last) * (row - first);
  }

  clear() {
    this.heights.clear(); this.cells.clear(); this.waveRows.clear(); this.impulses = []; this.pendingSelections = [];
    this.previousSelection = undefined; this.activeLane = -1; this.clock = 0; this.waveLevel = "off";
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
