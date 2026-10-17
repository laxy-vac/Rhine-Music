export type MusicMatrixPosition = { lane: number; row: number };
export type MusicMatrixAxis = { x: number; y: number };
export type MusicMatrixAxes = { lane: MusicMatrixAxis; row: MusicMatrixAxis };
export type MusicMatrixMotionPhase = "idle" | "coasting" | "snapping";

type DragSample = { position: MusicMatrixPosition; timeMs: number };
type InverseAxes = { lane: MusicMatrixAxis; row: MusicMatrixAxis };

const DRAG_THRESHOLD = 10;
const SAMPLE_WINDOW_MS = 120;
const RELEASE_IDLE_MS = 80;
const MIN_SAMPLE_SPAN_MS = 8;
const FRICTION = 2.4;
const COAST_END_SPEED = 0.6;
const COAST_START_SPEED = 0.75;
const SNAP_RATE = 10;

const zeroPosition = (): MusicMatrixPosition => ({ lane: 0, row: 0 });
const copyPosition = (position: MusicMatrixPosition): MusicMatrixPosition => ({
  lane: position.lane,
  row: position.row,
});
const finitePosition = (position: MusicMatrixPosition) =>
  Number.isFinite(position.lane) && Number.isFinite(position.row);

function invertAxes(axes: MusicMatrixAxes): InverseAxes | null {
  const { lane, row } = axes;
  const values = [lane.x, lane.y, row.x, row.y];
  if (!values.every(Number.isFinite)) return null;

  const determinant = lane.x * row.y - row.x * lane.y;
  const area = Math.hypot(lane.x, lane.y) * Math.hypot(row.x, row.y);
  if (!Number.isFinite(area) || area <= 0 || Math.abs(determinant) <= area * 0.001)
    return null;

  return {
    lane: { x: row.y / determinant, y: -row.x / determinant },
    row: { x: -lane.y / determinant, y: lane.x / determinant },
  };
}

/** Continuous two-axis matrix dragging with inertial coast and cell settling. */
export class MusicMatrixDrag {
  private center: MusicMatrixPosition | null = null;
  private startCenter = zeroPosition();
  private startPointer = { x: 0, y: 0 };
  private lastPointer = { x: 0, y: 0 };
  private inverse: InverseAxes | null = null;
  private samples: DragSample[] = [];
  private lastMotionMs = -Infinity;
  private motionDirection = { x: 0, y: 0 };
  private velocity = zeroPosition();
  private target = zeroPosition();
  private _dragging = false;
  private ended = false;
  private _phase: MusicMatrixMotionPhase = "idle";

  get dragging() {
    return this._dragging;
  }

  /** A gesture or its settling motion owns a camera center until clear(). */
  get active() {
    return this.center !== null;
  }

  get moving() {
    return this.active && (this._dragging || this._phase !== "idle");
  }

  get settled() {
    return this.active && this.ended && !this._dragging && this._phase === "idle";
  }

  get position(): MusicMatrixPosition | undefined {
    return this.center ? copyPosition(this.center) : undefined;
  }

  get phase(): MusicMatrixMotionPhase {
    return this._phase;
  }

  begin(
    x: number,
    y: number,
    center: MusicMatrixPosition,
    axes: MusicMatrixAxes,
    timeMs: number,
  ): void {
    const continuation = this.moving ? this.center : null;
    const initialCenter = continuation ?? center;
    this.center = finitePosition(initialCenter)
      ? copyPosition(initialCenter)
      : zeroPosition();
    this.startCenter = copyPosition(this.center);
    this.startPointer = { x, y };
    this.lastPointer = { x, y };
    this.inverse = invertAxes(axes);
    this.samples = [{ position: copyPosition(this.center), timeMs }];
    this.lastMotionMs = -Infinity;
    this.motionDirection = { x: 0, y: 0 };
    this.velocity = zeroPosition();
    this.target = copyPosition(this.center);
    this._dragging = false;
    this.ended = false;
    this._phase = "idle";
  }

  /** Returns true once this pointer path has crossed the 10px drag threshold. */
  move(x: number, y: number, timeMs: number): boolean {
    if (!this.center || !this.inverse) return false;

    const dx = x - this.startPointer.x;
    const dy = y - this.startPointer.y;
    if (!this._dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return false;
    this._dragging = true;
    this.ended = false;

    const position = {
      lane:
        this.startCenter.lane -
        (dx * this.inverse.lane.x + dy * this.inverse.lane.y),
      row:
        this.startCenter.row -
        (dx * this.inverse.row.x + dy * this.inverse.row.y),
    };
    this.center = position;

    const pointerDelta = { x: x - this.lastPointer.x, y: y - this.lastPointer.y };
    if (Math.hypot(pointerDelta.x, pointerDelta.y) > 1e-9) {
      this.lastMotionMs = timeMs;
      const previous = this.samples.at(-1);
      if (
        previous &&
        pointerDelta.x * this.motionDirection.x +
          pointerDelta.y * this.motionDirection.y <
          0
      ) {
        this.samples = [previous];
      }
      this.motionDirection = pointerDelta;
    }
    this.lastPointer = { x, y };

    const previous = this.samples.at(-1);
    const sample = { position: copyPosition(position), timeMs };
    if (previous?.timeMs === timeMs) this.samples[this.samples.length - 1] = sample;
    else this.samples.push(sample);
    this.samples = this.samples
      .filter((entry) => timeMs - entry.timeMs <= SAMPLE_WINDOW_MS)
      .slice(-32);
    return true;
  }

  /** Ends a drag and starts coasting or snapping; a click clears the gesture. */
  end(timeMs: number): boolean {
    if (!this.center || !this._dragging) {
      this.clear();
      return false;
    }

    this._dragging = false;
    this.ended = true;
    this.velocity = this.releaseVelocity(timeMs);
    this.target = {
      lane: Math.round(this.center.lane),
      row: Math.round(this.center.row),
    };
    this._phase =
      Math.max(Math.abs(this.velocity.lane), Math.abs(this.velocity.row)) >=
      COAST_START_SPEED
        ? "coasting"
        : "snapping";
    return true;
  }

  /** Advances inertia in seconds and returns the current logical camera center. */
  step(dt: number, reduced = false): MusicMatrixPosition | undefined {
    if (!this.center) return undefined;
    if (this._dragging || this._phase === "idle") return copyPosition(this.center);

    if (reduced) {
      this.center = {
        lane: Math.round(this.center.lane),
        row: Math.round(this.center.row),
      };
      this.velocity = zeroPosition();
      this.target = copyPosition(this.center);
      this._phase = "idle";
      return copyPosition(this.center);
    }

    const seconds = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 0.25) : 0;
    if (this._phase === "coasting") {
      const decay = Math.exp(-FRICTION * seconds);
      this.center.lane += (this.velocity.lane * (1 - decay)) / FRICTION;
      this.center.row += (this.velocity.row * (1 - decay)) / FRICTION;
      this.velocity.lane *= decay;
      this.velocity.row *= decay;
      if (
        Math.max(Math.abs(this.velocity.lane), Math.abs(this.velocity.row)) <
        COAST_END_SPEED
      ) {
        this.target = {
          lane: Math.round(this.center.lane + this.velocity.lane / FRICTION),
          row: Math.round(this.center.row + this.velocity.row / FRICTION),
        };
        this._phase = "snapping";
      }
    }

    if (this._phase === "snapping") this.stepSnap(seconds);
    return copyPosition(this.center);
  }

  clear(): void {
    this.center = null;
    this.startCenter = zeroPosition();
    this.startPointer = { x: 0, y: 0 };
    this.lastPointer = { x: 0, y: 0 };
    this.inverse = null;
    this.samples = [];
    this.lastMotionMs = -Infinity;
    this.motionDirection = { x: 0, y: 0 };
    this.velocity = zeroPosition();
    this.target = zeroPosition();
    this._dragging = false;
    this.ended = false;
    this._phase = "idle";
  }

  private releaseVelocity(timeMs: number): MusicMatrixPosition {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (
      !first ||
      !last ||
      timeMs - this.lastMotionMs > RELEASE_IDLE_MS ||
      last.timeMs - first.timeMs < MIN_SAMPLE_SPAN_MS
    )
      return zeroPosition();

    const scale = 1000 / (last.timeMs - first.timeMs);
    return {
      lane: (last.position.lane - first.position.lane) * scale,
      row: (last.position.row - first.position.row) * scale,
    };
  }

  private stepSnap(dt: number): void {
    const laneDelta = this.center!.lane - this.target.lane;
    const laneImpulse = this.velocity.lane + SNAP_RATE * laneDelta;
    const rowDelta = this.center!.row - this.target.row;
    const rowImpulse = this.velocity.row + SNAP_RATE * rowDelta;
    const decay = Math.exp(-SNAP_RATE * dt);

    this.center!.lane = this.target.lane + (laneDelta + laneImpulse * dt) * decay;
    this.velocity.lane = (this.velocity.lane - SNAP_RATE * laneImpulse * dt) * decay;
    this.center!.row = this.target.row + (rowDelta + rowImpulse * dt) * decay;
    this.velocity.row = (this.velocity.row - SNAP_RATE * rowImpulse * dt) * decay;

    if (
      Math.abs(this.center!.lane - this.target.lane) < 0.0001 &&
      Math.abs(this.center!.row - this.target.row) < 0.0001 &&
      Math.abs(this.velocity.lane) < 0.005 &&
      Math.abs(this.velocity.row) < 0.005
    ) {
      this.center = copyPosition(this.target);
      this.velocity = zeroPosition();
      this._phase = "idle";
    }
  }
}
