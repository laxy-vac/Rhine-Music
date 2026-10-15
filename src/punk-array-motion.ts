import { damp, type Spring } from "./motion";

/** Each physical rack owns its slot position; only the active rack advances. */
export class PunkArrayMotion {
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
