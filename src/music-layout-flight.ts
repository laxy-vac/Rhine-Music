import * as THREE from "three";
import type { ArchiveCell } from "./archive-loop";
import { deploymentStep as ease } from "./music-shelf-deployment.ts";
import { musicGeometryPose, type GeometryPose, type CanonicalSlot, type LayoutSample } from "./music-layout-transition.ts";
import { musicLayoutAddresses } from "./music-layout-addresses.ts";
import { musicLayoutRiseSchedule, type MusicLayoutRise } from "./music-layout-rise.ts";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "./music-display-layout.ts";

type MotionCell = ArchiveCell & { motionId?: string };
type Source = GeometryPose & { actual: GeometryPose; id: string; cell: ArchiveCell; alpha: number; tint: number; canonical?: CanonicalSlot };
type Item = { id: string; cell: MotionCell; arrayCell: ArchiveCell; source?: Source; target?: ArchiveCell; targetPose?: GeometryPose;
  resident: boolean; selected: boolean; rise?: MusicLayoutRise; targetAppearance?: { alpha: number; tint: number }; virtualArray?: GeometryPose };
type Edge = "left" | "right" | "top" | "bottom";
type CameraEnd = { position: THREE.Vector3; aim: THREE.Vector3; span: number; fov: number };
type CameraFrame = { camera: THREE.PerspectiveCamera; aim: THREE.Vector3; focus: THREE.Vector3; asinArgument: number };
const same = (a: ArchiveCell, b: ArchiveCell) => a.lane === b.lane && a.row === b.row;
const clonePose = (p: GeometryPose): GeometryPose => ({ position: p.position.clone(), rotation: p.rotation.clone(), scale: p.scale.clone() });
const yawQuaternion = (angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
const mixPose = (a: GeometryPose, b: GeometryPose, t: number): GeometryPose => ({
  position: a.position.clone().lerp(b.position, t), rotation: a.rotation.clone().slerp(b.rotation, t), scale: a.scale.clone().lerp(b.scale, t),
});

/** One camera-led path: ARRAY is always q=0, MATRIX is always q=1. */
export class MusicLayoutTransition {
  readonly duration = 2.8;
  active = false;
  private q = 0;
  private qVelocity = 0;
  private desiredEnd: 0 | 1 = 1;
  private elapsed = 0;
  private alignmentDuration = 0;
  private source: Source[] = [];
  private sourceSelected?: GeometryPose;
  private sourceSelectedActual?: GeometryPose;
  private selectedTarget?: GeometryPose;
  private sourceCell: ArchiveCell = { lane: 0, row: 0 };
  private targetCell: ArchiveCell = { lane: 0, row: 0 };
  private fromShelf = false;
  private sourceRow = 1;
  private targetRow = .62;
  private plan?: MotionCell[];
  private items = new Map<string, Item>();
  private arraySelection: ArchiveCell = { lane: 0, row: 12 };
  private arrayColumn = -4.7;
  private arrayRow = -1;
  private catalog = new Map<string, CanonicalSlot>();
  private addresses?: ReturnType<typeof musicLayoutAddresses>;
  private focusRise: MusicLayoutRise = { start: .18, end: .62, edgeDistance: 0, alongDistance: 0 };
  private epoch = 0;
  private sourceCamera = new THREE.PerspectiveCamera();
  private sourceAim = new THREE.Vector3();
  private sourceSpan = 1;
  private targetCamera?: CameraEnd;
  private targetAnchor = new THREE.Vector3();
  private targetAnchorReady = false;
  private caseCenter = new THREE.Vector3(0, 1.85, 0);
  private bounds = new THREE.Box3(new THREE.Vector3(-2.225, .175, -.07), new THREE.Vector3(2.225, 3.525, .07));
  private cacheQ = NaN;
  private cacheElapsed = NaN;
  private cameraCache?: CameraFrame;
  private rackFrame?: { matrix: THREE.Matrix4; visible: boolean; outside: boolean; translation: number[]; projected: number[] };

  get bound() { return !!this.plan; }
  get settled() { return this.elapsed >= this.alignmentDuration && Math.abs(this.q - this.desiredEnd) < 1e-8 && Math.abs(this.qVelocity) < 1e-8; }
  get progress() { return this.active ? this.desiredEnd === 1 ? this.q : 1 - this.q : 1; }
  get heading() { return THREE.MathUtils.degToRad(10) * Math.sin(Math.PI * ease(this.q)); }
  get rowSpacing() { return THREE.MathUtils.lerp(this.fromShelf ? this.sourceRow : this.targetRow, this.fromShelf ? this.targetRow : this.sourceRow, ease(this.q)); }
  get floorAmount() { return 1 - ease(this.q, .65, .95); }
  get groundY() { return THREE.MathUtils.lerp(-4.63,
    MUSIC_ARRAY_VIEW.floorY + this.bounds.min.y - MUSIC_SHELF_VIEW.floorDrop, this.floorAmount); }
  get extraRise() { return ease(this.q, .18, .96); }
  get rackDeployment() { return this.active ? 1 : Number(this.q === 0); }
  get titleAmount() { return 1 - ease(this.q, .15, .7); }
  private get blend() { return this.fromShelf ? ease(this.q) : 1 - ease(this.q); }
  private get residual() { return this.alignmentDuration ? 1 - ease(this.elapsed, 0, this.alignmentDuration) : 0; }
  private riseFor(item?: Item) {
    const schedule = item?.rise ?? this.focusRise;
    const amount = ease(this.q, schedule.start, schedule.end);
    return { ...schedule, amount, lift: !item || item.resident ? .22 * Math.sin(Math.PI * amount) ** 2 : 0 };
  }
  get frame() { return { phase: this.residual > 0 ? "align" : this.progress < .3 ? "depart" : this.progress < .7 ? "orbit" : "arrive",
    q: this.q, qVelocity: this.qVelocity, desiredEnd: this.desiredEnd, heading: this.heading,
    rowSpacing: this.rowSpacing, rackDeployment: this.rackDeployment, geometric: true, path: "camera-orbit",
    interactionSettling: this.residual > 0,
    alignmentDuration: this.alignmentDuration, alignmentElapsed: Math.min(this.elapsed, this.alignmentDuration),
    prepared: this.targetsReady && !!this.targetCamera,
    matched: [...this.items.values()].filter(item => item.source && item.target).length,
    retiring: [...this.items.values()].filter(item => item.source && !item.target).length,
    arriving: [...this.items.values()].filter(item => !item.source && item.target).length,
    coreCases: [...this.items.values()].filter(item => item.resident).length,
    residentCases: [...this.items.values()].filter(item => item.resident).length,
    groundY: this.groundY, extraRise: this.extraRise, riseOrigin: { ...this.arraySelection },
    riseMode: "edge-wave", focusRise: this.riseFor(),
    rowOffsets: this.addresses ? Object.fromEntries(this.addresses.rowOffsets) : {},
    rackFlight: this.rackFrame ? { visible: this.rackFrame.visible, outside: this.rackFrame.outside,
      translation: this.rackFrame.translation, projected: this.rackFrame.projected } : null,
    cameraAsinArgument: this.cameraCache?.asinArgument ?? null,
  }; }

  begin(samples: LayoutSample[], selected: ArchiveCell, matrix: THREE.Matrix4, camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3, spacing: { column: number; row: number }, toShelf: boolean, width: number,
    _baseY: number, _rackDeployment: number, catalog = new Map<string, CanonicalSlot>(), center = new THREE.Vector3(0, 1.85, 0),
    restSelected?: THREE.Matrix4, bounds?: { min: readonly number[]; max: readonly number[] }) {
    this.fromShelf = !toShelf;
    this.q = this.fromShelf ? 0 : 1; this.desiredEnd = toShelf ? 0 : 1; this.qVelocity = this.elapsed = 0;
    this.sourceCell = { ...selected }; this.sourceRow = Math.abs(spacing.row);
    this.sourceSelected = musicGeometryPose(restSelected ?? matrix); this.sourceSelectedActual = musicGeometryPose(matrix);
    this.caseCenter.copy(center); this.catalog = catalog; this.addresses = undefined; this.epoch++;
    this.bounds = bounds ? new THREE.Box3(new THREE.Vector3().fromArray(bounds.min), new THREE.Vector3().fromArray(bounds.max))
      : new THREE.Box3(new THREE.Vector3(-width / 2, center.y - 1.675, center.z - .07), new THREE.Vector3(width / 2, center.y + 1.675, center.z + .07));
    this.source = samples.filter(sample => sample.cell.foobarEntryKey).map((sample, index) => ({
      ...musicGeometryPose(sample.restMatrix ?? sample.matrix), actual: musicGeometryPose(sample.matrix),
      id: (sample.cell as MotionCell).motionId ?? `${this.epoch}:${sample.cell.foobarEntryKey}:${sample.cell.lane}:${sample.cell.row}:${index}`,
      cell: { ...sample.cell }, alpha: sample.alpha, tint: sample.tint, canonical: catalog.get(sample.cell.foobarEntryKey!),
    })).filter(item => item.alpha > .001 && item.actual.scale.x * item.actual.scale.y * item.actual.scale.z > 1e-9);
    const displaced = (rest: GeometryPose, actual: GeometryPose) => rest.position.distanceToSquared(actual.position) > 1e-8 || rest.rotation.angleTo(actual.rotation) > 1e-4;
    // Finish a pre-existing hover/selection gesture before starting the shared
    // path. Once q moves, every pose is solely a function of q in both directions.
    this.alignmentDuration = displaced(this.sourceSelected, this.sourceSelectedActual) || this.source.some(item => displaced(item, item.actual)) ? .18 : 0;
    this.sourceCamera.copy(camera); this.sourceCamera.updateMatrixWorld(); this.sourceAim.copy(aim);
    this.sourceSpan = 2 * camera.position.distanceTo(aim) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.plan = undefined; this.items.clear(); this.selectedTarget = undefined;
    this.targetAnchorReady = false; this.targetCamera = undefined; this.rackFrame = undefined;
    this.active = true; this.invalidate();
  }
  private invalidate() { this.cameraCache = undefined; this.cacheQ = this.q; this.cacheElapsed = this.elapsed; }
  retarget(toShelf: boolean) { if (!this.active) return false; this.desiredEnd = toShelf ? 0 : 1; return true; }
  advance(dt: number) {
    if (!this.active) return;
    this.elapsed += Math.max(0, dt);
    const accelerationLimit = 2.2, speedLimit = .44, omega = 14;
    const flightTime = Math.min(Math.max(0, dt), Math.max(0, this.elapsed - this.alignmentDuration));
    for (let remaining = Math.min(.5, flightTime); remaining > 0;) {
      const step = Math.min(1 / 180, remaining); remaining -= step;
      let acceleration = THREE.MathUtils.clamp(omega * omega * (this.desiredEnd - this.q) - 2 * omega * this.qVelocity, -accelerationLimit, accelerationLimit);
      const room = this.qVelocity > 0 ? 1 - this.q : this.q;
      if (Math.abs(this.qVelocity) > 1e-6 && this.qVelocity ** 2 / (2 * accelerationLimit) + Math.abs(this.qVelocity) * step > .72 * room)
        acceleration = -Math.sign(this.qVelocity) * accelerationLimit;
      const velocity = THREE.MathUtils.clamp(this.qVelocity + acceleration * step, -speedLimit, speedLimit);
      this.q += (this.qVelocity + velocity) * .5 * step; this.qVelocity = velocity;
      if (Math.abs(this.q - this.desiredEnd) < 1e-5 && Math.abs(this.qVelocity) < 1e-4) { this.q = this.desiredEnd; this.qVelocity = 0; break; }
    }
    this.invalidate();
  }
  clear() {
    this.active = false; this.q = this.desiredEnd; this.qVelocity = 0;
    this.plan = undefined; this.source = []; this.items.clear(); this.cameraCache = undefined; this.addresses = undefined;
  }

  bindCells(target: ArchiveCell[], selected: ArchiveCell, rowSpacing: number, present: (cell: ArchiveCell) => boolean,
    catalog = new Map<string, CanonicalSlot>()) {
    if (this.plan) return this.plan;
    this.targetCell = { ...selected }; this.targetRow = Math.abs(rowSpacing);
    // Each MATRIX column repeats its valid entries. Freeze one complete cycle
    // per finite ARRAY column; its small rail-phase adjustment preserves all
    // residents while keeping a short last column densely filled in MATRIX.
    const arrayOrigin = this.fromShelf ? this.sourceCell : selected;
    const matrixOrigin = this.fromShelf ? selected : this.sourceCell;
    const matrixCells = this.fromShelf ? target : this.source.map(source => source.cell);
    this.addresses = musicLayoutAddresses(catalog.size ? catalog : this.catalog, arrayOrigin, matrixOrigin, matrixCells);
    this.arraySelection = { ...arrayOrigin };
    this.arrayColumn = -Math.max(4.7, this.bounds.max.x - this.bounds.min.x + .5);
    this.arrayRow = -(this.fromShelf ? this.sourceRow : this.targetRow);
    const toArray = (cell: ArchiveCell, shelf: boolean): ArchiveCell => shelf ? { ...cell } : this.addresses!.toArray(cell);
    const key = (cell: ArchiveCell) => `${cell.lane}:${cell.row}:${cell.foobarEntryKey}`;
    const paired = new Map<string, Item>();
    for (const source of this.source) {
      const address = toArray(source.cell, this.fromShelf);
      const destinationCell = this.fromShelf ? this.addresses.toMatrix(source.cell) : this.addresses.toArray(source.cell);
      const item: Item = { id: source.id, cell: { ...destinationCell, motionId: source.id }, arrayCell: address,
        source, resident: this.fromShelf, selected: same(source.cell, this.sourceCell) && source.cell.foobarEntryKey === this.sourceCell.foobarEntryKey };
      paired.set(key(address), item);
    }
    for (const cell of target) if (cell.foobarEntryKey && present(cell)) {
      const address = toArray(cell, !this.fromShelf), addressKey = key(address);
      let item = paired.get(addressKey);
      if (!item) {
        const id = `${this.epoch}:incoming:${addressKey}`;
        item = { id, cell: { ...cell, motionId: id }, arrayCell: address, resident: !this.fromShelf,
          selected: same(cell, selected) && cell.foobarEntryKey === selected.foobarEntryKey };
        paired.set(addressKey, item);
      }
      item.target = { ...cell }; item.cell = { ...cell, motionId: item.id };
      item.resident ||= !this.fromShelf;
    }
    const kept = [...paired.values()].sort((a, b) => Number(b.selected) - Number(a.selected) ||
      Number(b.resident) - Number(a.resident) || a.arrayCell.lane - b.arrayCell.lane || a.arrayCell.row - b.arrayCell.row);
    const schedule = musicLayoutRiseSchedule(kept.filter(item => item.resident).map(item => item.arrayCell), this.arraySelection);
    this.focusRise = schedule(this.arraySelection);
    for (const item of kept) { item.rise = schedule(item.arrayCell); this.items.set(item.id, item); }
    this.plan = kept.map(item => item.cell);
    while (this.plan.length < target.length) this.plan.push({ lane: -10000, row: -10000 });
    return this.plan;
  }
  private item(cell: ArchiveCell) { return this.items.get((cell as MotionCell).motionId ?? ""); }
  occurrenceId(cell: ArchiveCell) { return (cell as MotionCell).motionId; }
  routeFor(cell: ArchiveCell) {
    const item = this.item(cell);
    return item ? { segment: item.arrayCell.lane, core: item.resident, resident: item.resident,
      arrayCell: { lane: item.arrayCell.lane, row: item.arrayCell.row },
      hasArray: item.resident, hasMatrix: this.fromShelf ? !!item.target : !!item.source,
      rise: this.riseFor(item) } : undefined;
  }
  isSelected(cell: ArchiveCell) { return this.item(cell)?.selected ?? false; }
  isExtra(cell: ArchiveCell) { const item = this.item(cell); return !!item && !item.resident; }
  matrixCellForArray(cell: ArchiveCell) { return this.addresses?.toMatrix(cell); }
  get endpointSelection(): ArchiveCell | undefined { return this.settled ? { ...(this.desiredEnd === (this.fromShelf ? 0 : 1) ? this.sourceCell : this.targetCell) } : undefined; }
  endpointCell(cell: ArchiveCell): ArchiveCell | undefined {
    if (!this.settled) return undefined;
    const item = this.item(cell), owner = this.desiredEnd === (this.fromShelf ? 0 : 1) ? item?.source?.cell : item?.target;
    return owner ? { ...owner } : undefined;
  }
  appearance(cell: ArchiveCell, target: { alpha: number; tint: number }) {
    const item = this.item(cell);
    if (item?.target && !item.targetAppearance) item.targetAppearance = { ...target };
    if (!item) return target;
    // Extra loop copies rise through the opaque floor, never through a fade.
    if (!item.resident) return { alpha: 1, tint: 0 };
    const source = item.source ?? item.targetAppearance ?? target;
    const destination = item.targetAppearance ?? source;
    return { alpha: THREE.MathUtils.lerp(source.alpha, destination.alpha, this.blend),
      tint: THREE.MathUtils.lerp(source.tint, destination.tint, this.blend) };
  }
  prepareTarget(anchor: THREE.Vector3) { if (!this.targetAnchorReady) { this.targetAnchor.copy(anchor); this.targetAnchorReady = true; } }
  get targetsReady() { return !!this.selectedTarget && [...this.items.values()].every(item => !item.target || !!item.targetPose); }
  primeTarget(cell: ArchiveCell, matrix: THREE.Matrix4, selected = false) {
    if (selected) this.selectedTarget ??= musicGeometryPose(matrix);
    const item = this.item(cell);
    if (item?.target) item.targetPose ??= musicGeometryPose(matrix);
  }
  private virtualArrayPose(item: Item): GeometryPose {
    if (item.virtualArray) return item.virtualArray;
    // Continue ARRAY's ordinary lattice below the opaque scene floor. Extra
    // MATRIX copies emerge vertically as the camera opens the field.
    const residents = [...this.items.values()].filter(candidate => candidate.resident &&
      (this.fromShelf ? candidate.source : candidate.targetPose));
    const nearest = residents.sort((a, b) =>
      Math.abs(a.arrayCell.lane - item.arrayCell.lane) * 100 + Math.abs(a.arrayCell.row - item.arrayCell.row) -
      Math.abs(b.arrayCell.lane - item.arrayCell.lane) * 100 - Math.abs(b.arrayCell.row - item.arrayCell.row))[0];
    const reference = nearest?.selected ? this.endpointPoses(undefined, true).array : nearest ? this.fromShelf ? nearest.source! : nearest.targetPose! :
      this.fromShelf ? this.sourceSelected! : this.selectedTarget!;
    const address = nearest?.arrayCell ?? this.arraySelection, pose = clonePose(reference);
    pose.position.x += (item.arrayCell.lane - address.lane) * this.arrayColumn;
    pose.position.z += (item.arrayCell.row - address.row) * this.arrayRow;
    const arrayGround = MUSIC_ARRAY_VIEW.floorY + this.bounds.min.y - MUSIC_SHELF_VIEW.floorDrop;
    pose.position.y = arrayGround - this.bounds.max.y - .24;
    pose.rotation.identity();
    pose.scale.setScalar(1);
    return item.virtualArray = pose;
  }
  private endpointPoses(item?: Item, selected = false) {
    const source = selected ? this.sourceSelected! : item?.source;
    const target = selected ? this.selectedTarget ?? { ...clonePose(this.sourceSelected!), position: this.targetAnchor.clone() } : item?.targetPose;
    const a = this.fromShelf ? source : target, m = this.fromShelf ? target : source;
    return { array: a ?? (item ? this.virtualArrayPose(item) : m!), matrix: m ?? a!, hasArray: !!a, hasMatrix: !!m };
  }
  private baseline(item?: Item, selected = false): GeometryPose {
    const endpoints = this.endpointPoses(item, selected);
    const pose = mixPose(endpoints.array, endpoints.matrix, ease(this.q));
    const rise = this.riseFor(item);
    if (item && !item.resident) pose.position.y = THREE.MathUtils.lerp(endpoints.array.position.y,
      endpoints.matrix.position.y, rise.amount);
    const anchors = this.endpointPoses(undefined, true);
    const pivot = anchors.array.position.clone().lerp(anchors.matrix.position, ease(this.q));
    const rotation = yawQuaternion(this.heading);
    pose.position.sub(pivot).applyQuaternion(rotation).add(pivot);
    pose.position.y += rise.lift;
    pose.rotation.premultiply(rotation);
    if (this.residual > 0) {
      const source = selected ? this.sourceSelected : item?.source;
      const actual = selected ? this.sourceSelectedActual : item?.source?.actual;
      if (source && actual) {
        pose.position.addScaledVector(actual.position.clone().sub(source.position), this.residual);
        pose.rotation.premultiply(new THREE.Quaternion().slerp(actual.rotation.clone().multiply(source.rotation.clone().invert()), this.residual));
      }
    }
    return pose;
  }
  private focusPoint(pose: GeometryPose) { return this.caseCenter.clone().multiply(pose.scale).applyQuaternion(pose.rotation).add(pose.position); }
  private cameraAt(): CameraFrame {
    if (this.cameraCache && this.cacheQ === this.q && this.cacheElapsed === this.elapsed) return this.cameraCache;
    const sourceEnd: CameraEnd = { position: this.sourceCamera.position, aim: this.sourceAim, span: this.sourceSpan, fov: this.sourceCamera.fov };
    const targetEnd = this.targetCamera ?? sourceEnd;
    const a = this.fromShelf ? sourceEnd : targetEnd, m = this.fromShelf ? targetEnd : sourceEnd;
    const endpoints = this.endpointPoses(undefined, true), poses = { array: clonePose(endpoints.array), matrix: clonePose(endpoints.matrix) };
    if (this.residual > 0 && this.sourceSelected && this.sourceSelectedActual) {
      const sourcePose = this.fromShelf ? poses.array : poses.matrix;
      sourcePose.position.addScaledVector(this.sourceSelectedActual.position.clone().sub(this.sourceSelected.position), this.residual);
      sourcePose.rotation.premultiply(new THREE.Quaternion().slerp(this.sourceSelectedActual.rotation.clone()
        .multiply(this.sourceSelected.rotation.clone().invert()), this.residual));
    }
    const pointA = this.focusPoint(poses.array), pointM = this.focusPoint(poses.matrix), focus = this.focusPoint(this.baseline(undefined, true));
    const describe = (end: CameraEnd, point: THREE.Vector3) => {
      const v = end.position.clone().sub(end.aim).normalize(), camera = this.sourceCamera.clone();
      camera.position.copy(end.position); camera.lookAt(end.aim); camera.fov = end.fov;
      camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      return { yaw: Math.atan2(v.x, v.z), depth: end.position.clone().sub(point).dot(v), ndc: point.clone().project(camera), distance: end.position.distanceTo(end.aim) };
    };
    const ca = describe(a, pointA), cm = describe(m, pointM), t = ease(this.q);
    const yawDelta = Math.atan2(Math.sin(cm.yaw - ca.yaw), Math.cos(cm.yaw - ca.yaw));
    const yaw = ca.yaw + yawDelta * t + this.heading * .4;
    const n = ca.ndc.clone().lerp(cm.ndc, t), depth = THREE.MathUtils.lerp(ca.depth, cm.depth, t);
    const tan = THREE.MathUtils.lerp(Math.tan(THREE.MathUtils.degToRad(a.fov / 2)), Math.tan(THREE.MathUtils.degToRad(m.fov / 2)), t);
    const height = THREE.MathUtils.lerp(a.position.y, m.position.y, t), b = n.y * tan;
    const argument = (height - focus.y) / (depth * Math.sqrt(1 + b * b));
    if (!Number.isFinite(argument) || Math.abs(argument) > 1 + 1e-7) throw new Error("Archive flight has no feasible camera height");
    const elevation = Math.asin(THREE.MathUtils.clamp(argument, -1, 1)) + Math.atan(b);
    const outward = new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
    const up = new THREE.Vector3().crossVectors(outward, right).normalize();
    const camera = this.sourceCamera.clone();
    camera.position.copy(focus).addScaledVector(outward, depth).addScaledVector(right, -n.x * depth * tan * camera.aspect).addScaledVector(up, -n.y * depth * tan);
    const aim = camera.position.clone().addScaledVector(outward, -THREE.MathUtils.lerp(ca.distance, cm.distance, t));
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tan)); camera.lookAt(aim); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    this.cacheQ = this.q; this.cacheElapsed = this.elapsed;
    return this.cameraCache = { camera, aim, focus, asinArgument: argument };
  }
  /** Translate only on the ground plane; corners, not centres, clear the view. */
  private parkingOffset(points: THREE.Vector3[], weights: Map<Edge, number>, camera: THREE.PerspectiveCamera) {
    if ([...weights.values()].every(value => value === 0)) return new THREE.Vector3();
    const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const origin = center.clone().project(camera), forward = camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), px = 1 / (tan * camera.aspect), py = 1 / tan;
    const relative = center.clone().sub(camera.position), x = relative.dot(right), y = relative.dot(up), d = relative.dot(forward);
    let delta = new THREE.Vector3();
    for (let iteration = 0; iteration < 12; iteration++) {
      const translatedCenter = center.clone().add(delta).project(camera);
      const offsets = points.map(point => point.clone().add(delta).project(camera).sub(translatedCenter));
      const extrema = { minX: Math.min(...offsets.map(p => p.x)), maxX: Math.max(...offsets.map(p => p.x)),
        minY: Math.min(...offsets.map(p => p.y)), maxY: Math.max(...offsets.map(p => p.y)) };
      let nx = origin.x, ny = origin.y;
      for (const [edge, weight] of weights) {
        if (edge === "right") nx += Math.max(0, 1.35 - extrema.minX - origin.x) * weight;
        if (edge === "left") nx += Math.min(0, -1.35 - extrema.maxX - origin.x) * weight;
        if (edge === "top") ny += Math.max(0, 1.35 - extrema.minY - origin.y) * weight;
        if (edge === "bottom") ny += Math.min(0, -1.35 - extrema.maxY - origin.y) * weight;
      }
      const ax = px * right.x - nx * forward.x, az = px * right.z - nx * forward.z;
      const bx = py * up.x - ny * forward.x, bz = py * up.z - ny * forward.z;
      const rx = nx * d - px * x, ry = ny * d - py * y, determinant = ax * bz - az * bx;
      if (Math.abs(determinant) < 1e-9) throw new Error("Archive flight parking plane is singular");
      delta.set((rx * bz - az * ry) / determinant, 0, (ax * ry - rx * bx) / determinant);
    }
    return delta;
  }
  apply(matrix: THREE.Matrix4, cell: ArchiveCell, selected = false) {
    if (!this.active || !this.sourceSelected) return;
    const item = this.item(cell);
    if (!selected && !item) return;
    if (selected && !this.selectedTarget) this.selectedTarget = musicGeometryPose(matrix);
    if (item?.target && !item.targetPose) item.targetPose = musicGeometryPose(matrix);
    const pose = this.baseline(item, selected);
    matrix.compose(pose.position, pose.rotation, pose.scale);
  }
  applyCamera(camera: THREE.PerspectiveCamera, renderedAim: THREE.Vector3, targetPosition: THREE.Vector3,
    targetAim: THREE.Vector3, targetSpan: number, _focusPoint?: THREE.Vector3,
    _focusBounds?: { minX: number; maxX: number; minY: number; maxY: number; corners: THREE.Vector3[] }) {
    if (!this.active) return;
    if (!this.targetCamera) {
      this.targetCamera = { position: targetPosition.clone(), aim: targetAim.clone(), span: targetSpan,
        fov: THREE.MathUtils.radToDeg(2 * Math.atan(targetSpan / (2 * targetPosition.distanceTo(targetAim)))) };
      this.invalidate();
    }
    const frame = this.cameraAt(); camera.position.copy(frame.camera.position); camera.quaternion.copy(frame.camera.quaternion);
    camera.fov = frame.camera.fov; renderedAim.copy(frame.aim);
  }
  rackTransform(bounds: THREE.Box3, groundY: number) {
    if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) {
      return this.rackFrame = { matrix: new THREE.Matrix4(), visible: false, outside: true, translation: [0, 0, 0], projected: [0, -2, 0, -2] };
    }
    const anchors = this.endpointPoses(undefined, true), anchor = anchors.array.position.clone().lerp(anchors.matrix.position, ease(this.q));
    const matrix = new THREE.Matrix4().makeTranslation(-anchors.array.position.x, -groundY, -anchors.array.position.z);
    matrix.premultiply(new THREE.Matrix4().makeRotationY(this.heading));
    matrix.premultiply(new THREE.Matrix4().makeTranslation(anchor.x, groundY, anchor.z));
    const points: THREE.Vector3[] = [];
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
    const camera = this.cameraAt().camera;
    const translation = this.parkingOffset(points, new Map<Edge, number>([["bottom", ease(this.q, .12, .62)]]), camera);
    matrix.premultiply(new THREE.Matrix4().makeTranslation(translation.x, 0, translation.z));
    const projected = points.map(point => point.add(translation).project(camera));
    const maxY = Math.max(...projected.map(point => point.y));
    const outside = maxY < -1.1 && projected.every(point => point.z > -1 && point.z < 1);
    const visible = !outside;
    this.rackFrame = { matrix, visible, outside, translation: translation.toArray(),
      projected: [Math.min(...projected.map(p => p.x)), maxY, Math.max(...projected.map(p => p.x)), Math.min(...projected.map(p => p.y))] };
    return this.rackFrame;
  }
}
