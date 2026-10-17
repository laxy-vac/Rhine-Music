import * as THREE from "three";
import type { ArchiveCell } from "./archive-loop";
import { deploymentStep as ease, shelfAssemblySlot, type ShelfSlotFrame } from "./music-shelf-deployment.ts";

export type GeometryPose = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };
export type CanonicalSlot = { lane: number; row: number; order: number };
export type LayoutSample = { cell: ArchiveCell; matrix: THREE.Matrix4; restMatrix?: THREE.Matrix4; alpha: number; tint: number };
type MotionCell = ArchiveCell & { motionId?: string };
type Source = GeometryPose & { actual: GeometryPose; id: string; cell: ArchiveCell; alpha: number; tint: number; canonical?: CanonicalSlot };
type Item = { id: string; cell: MotionCell; source?: Source; target?: ArchiveCell; targetPose?: GeometryPose;
  sourceCanonical?: CanonicalSlot; targetCanonical?: CanonicalSlot; selected: boolean; priority: number; distance: number;
  transportX?: number; targetAppearance?: { alpha: number; tint: number } };
const same = (a: ArchiveCell, b: ArchiveCell) => a.lane === b.lane && a.row === b.row;
const turn = (point: THREE.Vector3, angle: number) => point.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
/** Integral of a short smooth velocity ramp, with a long constant-speed centre. */
const cruise = (value: number, start: number, end: number) => {
  const p = THREE.MathUtils.clamp((value - start) / (end - start), 0, 1), ramp = .18;
  const integral = (s: number) => s ** 6 - 3 * s ** 5 + 2.5 * s ** 4;
  return p < ramp ? ramp * integral(p / ramp) / (1 - ramp)
    : p > 1 - ramp ? 1 - ramp * integral((1 - p) / ramp) / (1 - ramp)
      : (p - ramp / 2) / (1 - ramp);
};

export const musicGeometryPose = (matrix: THREE.Matrix4): GeometryPose => {
  const value = { position: new THREE.Vector3().setFromMatrixPosition(matrix), rotation: new THREE.Quaternion(), scale: new THREE.Vector3() };
  const e = matrix.elements;
  value.scale.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  if (value.scale.x * value.scale.y * value.scale.z > 1e-12) matrix.decompose(value.position, value.rotation, value.scale);
  return value;
};

/** Stable occurrence identities own their physical paths, independently of pool indices. */
export class MusicLayoutTransition {
  private elapsed = 0;
  readonly duration = 3.6;
  private q = 0;
  private qVelocity = 0;
  private desiredEnd: 0 | 1 = 1;
  active = false;
  private source: Source[] = [];
  private sourceSelected?: GeometryPose;
  private sourceSelectedActual?: GeometryPose;
  private sourceCell: ArchiveCell = { lane: 0, row: 0 };
  private targetCell: ArchiveCell = { lane: 0, row: 0 };
  private sourceHeading = 0;
  private targetHeading = 0;
  private sourceRow = .62;
  private targetRow = 1;
  private width = 4.45;
  private fromShelf = false;
  private toShelf = false;
  private sourceCatalog = new Map<string, CanonicalSlot>();
  private plan?: MotionCell[];
  private items = new Map<string, Item>();
  private epoch = 0;
  private sourceCamera = new THREE.PerspectiveCamera();
  private sourceAim = new THREE.Vector3();
  private sourceSpan = 1;
  private sourceRack = 0;
  private sourceTitles = 0;
  private targetAnchor = new THREE.Vector3();
  private targetAnchorReady = false;
  private selectedTarget?: GeometryPose;
  private targetCamera?: { position: THREE.Vector3; aim: THREE.Vector3; span: number };
  private caseCenter = new THREE.Vector3(0, 1.85, 0);
  private sourceFocus = new THREE.Vector2();
  private sourceActualFocus = new THREE.Vector2();
  private targetFocus?: THREE.Vector2;
  get bound() { return !!this.plan; }
  get settled() { return this.elapsed >= .32 && Math.abs(this.q - this.desiredEnd) < 1e-8 && Math.abs(this.qVelocity) < 1e-8; }
  private get sourceResidual() { return 1 - ease(this.elapsed, 0, .32); }
  get floorAmount() { return this.toShelf ? ease(this.q, .7, .86) : 1 - ease(this.q, .14, .3); }

  get progress() { return this.active ? this.desiredEnd === 1 ? this.q : 1 - this.q : 1; }
  private get travel() { return cruise(this.q, .3, .7); }
  get heading() { return THREE.MathUtils.lerp(this.sourceHeading, this.targetHeading, this.travel); }
  get rowSpacing() {
    const clearance = Math.max(this.width + .55, this.sourceRow, this.targetRow);
    return this.q < .3 ? THREE.MathUtils.lerp(this.sourceRow, clearance, ease(this.q, .14, .3))
      : THREE.MathUtils.lerp(clearance, this.targetRow, cruise(this.q, .7, 1));
  }
  get rackDeployment() { return THREE.MathUtils.lerp(this.sourceRack, Number(this.toShelf),
    this.toShelf ? ease(this.q, .86, 1) : ease(this.q, 0, .14)); }
  get titleAmount() { return THREE.MathUtils.lerp(this.sourceTitles, Number(this.toShelf),
    this.toShelf ? ease(this.q, .9, 1) : ease(this.q, 0, .14)); }
  get frame() { return { phase: this.progress < .18 ? "release" : this.progress < .82 ? "reconfigure" : "dock",
    q: this.q, qVelocity: this.qVelocity, desiredEnd: this.desiredEnd,
    heading: this.heading, rowSpacing: this.rowSpacing, rackDeployment: this.rackDeployment, geometric: true,
    matched: [...this.items.values()].filter(item => item.source && item.target).length,
    retiring: [...this.items.values()].filter(item => item.source && !item.target).length,
    arriving: [...this.items.values()].filter(item => !item.source && item.target).length }; }

  begin(samples: LayoutSample[], selected: ArchiveCell, matrix: THREE.Matrix4, camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3, spacing: { column: number; row: number }, toShelf: boolean, width: number,
    _baseY: number, rackDeployment: number, catalog = new Map<string, CanonicalSlot>(), center = new THREE.Vector3(0, 1.85, 0), restSelected?: THREE.Matrix4) {
    const heading = this.active ? this.heading : spacing.row < 0 ? Math.PI : 0;
    const row = this.active ? this.rowSpacing : Math.abs(spacing.row);
    const titles = this.active ? this.titleAmount : Number(spacing.row < 0);
    this.sourceHeading = heading; this.targetHeading = toShelf ? Math.PI : 0;
    this.sourceRow = row; this.sourceCell = { ...selected }; this.sourceSelected = musicGeometryPose(restSelected ?? matrix);
    this.sourceSelectedActual = musicGeometryPose(matrix);
    this.fromShelf = spacing.row < 0; this.toShelf = toShelf; this.width = width; this.sourceRack = rackDeployment;
    this.sourceTitles = titles; this.sourceCatalog = catalog; this.epoch++;
    this.plan = undefined; this.items.clear(); this.targetAnchorReady = false; this.selectedTarget = undefined; this.targetCamera = undefined;
    this.caseCenter.copy(center); this.targetFocus = undefined;
    this.source = samples.filter(sample => sample.cell.foobarEntryKey).map((sample, index) => ({
      ...musicGeometryPose(sample.restMatrix ?? sample.matrix), actual: musicGeometryPose(sample.matrix),
      id: (sample.cell as MotionCell).motionId ?? `${this.epoch}:${sample.cell.foobarEntryKey}:${sample.cell.lane}:${sample.cell.row}:${index}`,
      cell: { ...sample.cell }, alpha: sample.alpha, tint: sample.tint, canonical: catalog.get(sample.cell.foobarEntryKey!),
    })).filter(source => source.alpha > .001 && source.actual.scale.x * source.actual.scale.y * source.actual.scale.z > 1e-9);
    this.sourceCamera.copy(camera); this.sourceCamera.updateMatrixWorld(); this.sourceAim.copy(aim);
    const sourcePoint = center.clone().applyMatrix4(restSelected ?? matrix).project(this.sourceCamera);
    this.sourceFocus.set(sourcePoint.x, sourcePoint.y);
    const actualPoint = center.clone().applyMatrix4(matrix).project(this.sourceCamera);
    this.sourceActualFocus.set(actualPoint.x, actualPoint.y);
    this.sourceSpan = 2 * camera.position.distanceTo(aim) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.elapsed = this.q = this.qVelocity = 0; this.desiredEnd = 1; this.active = true;
  }
  retarget(toShelf: boolean) {
    if (!this.active || (toShelf !== this.toShelf && toShelf !== this.fromShelf)) return false;
    this.desiredEnd = toShelf === this.toShelf ? 1 : 0;
    return true;
  }
  advance(dt: number) {
    if (!this.active) return;
    this.elapsed += Math.max(0, dt);
    const accelerationLimit = 1.8, speedLimit = .34, omega = 14;
    for (let remaining = Math.min(.5, Math.max(0, dt)); remaining > 0;) {
      const step = Math.min(1 / 180, remaining); remaining -= step;
      let acceleration = THREE.MathUtils.clamp(omega * omega * (this.desiredEnd - this.q) - 2 * omega * this.qVelocity,
        -accelerationLimit, accelerationLimit);
      // Brake while there is still room in the CURRENT direction, including
      // an opposite request near either end. Do not hide overshoot by clamping q.
      const room = this.qVelocity > 0 ? 1 - this.q : this.q;
      if (Math.abs(this.qVelocity) > 1e-6 &&
        this.qVelocity * this.qVelocity / (2 * accelerationLimit) + Math.abs(this.qVelocity) * step > .72 * room)
        acceleration = -Math.sign(this.qVelocity) * accelerationLimit;
      const nextVelocity = THREE.MathUtils.clamp(this.qVelocity + acceleration * step, -speedLimit, speedLimit);
      this.q += (this.qVelocity + nextVelocity) * .5 * step;
      this.qVelocity = nextVelocity;
      if (Math.abs(this.q - this.desiredEnd) < 1e-5 && Math.abs(this.qVelocity) < 1e-4) {
        this.q = this.desiredEnd; this.qVelocity = 0; break;
      }
    }
  }
  clear() { this.active = false; this.plan = undefined; this.source = []; this.items.clear(); }

  bindCells(target: ArchiveCell[], selected: ArchiveCell, rowSpacing: number, present: (cell: ArchiveCell) => boolean,
    catalog = new Map<string, CanonicalSlot>()) {
    if (this.plan) return this.plan;
    this.targetCell = { ...selected }; this.targetRow = Math.abs(rowSpacing);
    const bySource = new Map<string, Source[]>(), byTarget = new Map<string, ArchiveCell[]>();
    for (const source of this.source) {
      const list = bySource.get(source.cell.foobarEntryKey!) ?? []; list.push(source); bySource.set(source.cell.foobarEntryKey!, list);
    }
    for (const cell of target) if (cell.foobarEntryKey && present(cell)) {
      const list = byTarget.get(cell.foobarEntryKey) ?? []; list.push(cell); byTarget.set(cell.foobarEntryKey, list);
    }
    const sourceSelectedCanonical = this.sourceCatalog.get(this.sourceCell.foobarEntryKey ?? "");
    const targetSelectedCanonical = catalog.get(selected.foobarEntryKey ?? "");
    const occurrenceDistance = (cell: ArchiveCell, anchor: ArchiveCell, canonical?: CanonicalSlot, origin?: CanonicalSlot) => {
      const lane = cell.lane - anchor.lane - (canonical && origin ? canonical.lane - origin.lane : 0);
      const row = cell.row - anchor.row - (canonical && origin ? canonical.row - origin.row : 0);
      return lane * lane * 400 + row * row;
    };
    const entries = new Set([...bySource.keys(), ...byTarget.keys()]);
    const planned: Item[] = [];
    const make = (entry: string, source?: Source, destination?: ArchiveCell) => {
      const cell = destination ? { ...destination } : { ...source!.cell,
        lane: selected.lane + source!.cell.lane - this.sourceCell.lane,
        row: selected.row + source!.cell.row - this.sourceCell.row };
      const id = source?.id ?? `${this.epoch}:incoming:${entry}:${cell.lane}:${cell.row}`;
      const selectedItem = entry === selected.foobarEntryKey && !!destination && same(destination, selected) &&
        (!source || same(source.cell, this.sourceCell));
      const point = source?.position.clone().add(new THREE.Vector3(0, 1.7, 0)).project(this.sourceCamera);
      const onScreen = point && Math.abs(point.x) < 1.3 && Math.abs(point.y) < 1.3 && point.z > -1 && point.z < 1;
      const finite = (!!source && this.fromShelf) || (!!destination && this.toShelf);
      const dl = cell.lane - selected.lane, dr = cell.row - selected.row;
      planned.push({ id, cell: { ...cell, foobarEntryKey: entry, motionId: id }, source, target: destination,
        sourceCanonical: source?.canonical, targetCanonical: catalog.get(entry), selected: selectedItem,
        priority: selectedItem ? -1 : source && destination ? 0 : finite ? 1 : onScreen ? 2 : 3,
        distance: dl * dl * 12 + dr * dr * .1 });
    };
    for (const entry of entries) {
      const sources = bySource.get(entry) ?? [], destinations = byTarget.get(entry) ?? [];
      sources.sort((a, b) => occurrenceDistance(a.cell, this.sourceCell, a.canonical, sourceSelectedCanonical) -
        occurrenceDistance(b.cell, this.sourceCell, b.canonical, sourceSelectedCanonical));
      destinations.sort((a, b) => occurrenceDistance(a, selected, catalog.get(entry), targetSelectedCanonical) -
        occurrenceDistance(b, selected, catalog.get(entry), targetSelectedCanonical));
      const sourceIsCanonical = !sourceSelectedCanonical || !sources[0]?.canonical ||
        occurrenceDistance(sources[0].cell, this.sourceCell, sources[0].canonical, sourceSelectedCanonical) < .001;
      const targetIsCanonical = !targetSelectedCanonical || !catalog.get(entry) ||
        (!!destinations[0] && occurrenceDistance(destinations[0], selected, catalog.get(entry), targetSelectedCanonical) < .001);
      if (sources.length && destinations.length && sourceIsCanonical && targetIsCanonical)
        make(entry, sources.shift(), destinations.shift());
      for (const source of sources) make(entry, source);
      for (const destination of destinations) make(entry, undefined, destination);
    }
    const kept = planned.sort((a, b) => a.priority - b.priority || a.distance - b.distance).slice(0, target.length);
    for (const item of kept) this.items.set(item.id, item);
    const matched = kept.filter(item => item.source && item.target).sort((a, b) =>
      (a.targetCanonical?.order ?? (a.target!.lane * 10000 + a.target!.row)) -
      (b.targetCanonical?.order ?? (b.target!.lane * 10000 + b.target!.row)));
    const segments: Item[][] = [];
    for (const item of matched) {
      const segment = segments.at(-1), previous = segment?.at(-1);
      if (previous && previous.source!.cell.lane === item.source!.cell.lane && previous.target!.lane === item.target!.lane &&
        previous.source!.cell.row + 1 === item.source!.cell.row && previous.target!.row + 1 === item.target!.row) segment!.push(item);
      else segments.push([item]);
    }
    const anchorSegment = Math.max(0, segments.findIndex(segment => segment.some(item => item.selected)));
    segments.forEach((segment, index) => segment.forEach(item => item.transportX = (index - anchorSegment) * (this.width + .55)));
    this.plan = kept.map(item => item.cell);
    while (this.plan.length < target.length) this.plan.push({ lane: -10000, row: -10000 });
    return this.plan;
  }
  private item(cell: ArchiveCell) { return this.items.get((cell as MotionCell).motionId ?? ""); }
  occurrenceId(cell: ArchiveCell) { return (cell as MotionCell).motionId; }
  get endpointSelection(): ArchiveCell | undefined {
    return this.settled ? { ...(this.desiredEnd === 0 ? this.sourceCell : this.targetCell) } : undefined;
  }
  endpointCell(cell: ArchiveCell): ArchiveCell | undefined {
    if (!this.settled) return undefined;
    const item = this.item(cell), owner = this.desiredEnd === 0 ? item?.source?.cell : item?.target;
    return owner ? { ...owner } : undefined;
  }
  isSelected(cell: ArchiveCell) { return this.item(cell)?.selected ?? false; }
  appearance(cell: ArchiveCell, target: { alpha: number; tint: number }) {
    const item = this.item(cell), source = item?.source;
    if (item?.target && !item.targetAppearance) item.targetAppearance = { ...target };
    const destination = item?.targetAppearance ?? target;
    return source ? { alpha: item.target ? THREE.MathUtils.lerp(source.alpha, destination.alpha, this.travel) : source.alpha,
      tint: item.target ? THREE.MathUtils.lerp(source.tint, destination.tint, this.travel) : source.tint } : destination;
  }
  prepareTarget(anchor: THREE.Vector3) { if (!this.targetAnchorReady) { this.targetAnchor.copy(anchor); this.targetAnchorReady = true; } }
  private residualPose(pose: GeometryPose, rest: GeometryPose, actual: GeometryPose) {
    const amount = this.sourceResidual;
    if (amount <= 0) return;
    pose.position.addScaledVector(actual.position.clone().sub(rest.position), amount);
    pose.scale.addScaledVector(actual.scale.clone().sub(rest.scale), amount);
    const rotation = actual.rotation.clone().multiply(rest.rotation.clone().invert());
    pose.rotation.premultiply(new THREE.Quaternion().slerp(rotation, amount));
  }

  apply(matrix: THREE.Matrix4, cell: ArchiveCell, selected = false) {
    if (!this.active || !this.sourceSelected) return;
    const item = this.item(cell);
    const source = selected ? this.sourceSelected : item?.source;
    if (!selected && !item) return;
    if (selected && !this.selectedTarget) this.selectedTarget = musicGeometryPose(matrix);
    if (item?.target && !item.targetPose) item.targetPose = musicGeometryPose(matrix);
    const savedTarget = selected ? this.selectedTarget! : item?.targetPose ?? musicGeometryPose(matrix);
    const target = { position: savedTarget.position.clone(), rotation: savedTarget.rotation.clone(), scale: savedTarget.scale.clone() };
    if (!selected && item?.source && !item.target) {
      const size = 1 - ease(this.q, 0, .14);
      const pose = { position: item.source.position.clone(), rotation: item.source.rotation.clone(), scale: item.source.scale.clone() };
      this.residualPose(pose, item.source, item.source.actual);
      pose.position.y -= .12 * (1 - size); pose.scale.multiplyScalar(size);
      matrix.compose(pose.position, pose.rotation, pose.scale); return;
    }
    if (!source) {
      const size = ease(this.q, .86, 1);
      const offset = turn(target.position.clone().sub(this.targetAnchor).setY(0), -this.targetHeading);
      offset.z *= this.rowSpacing / this.targetRow;
      turn(offset, this.targetHeading);
      target.position.x = this.targetAnchor.x + offset.x; target.position.z = this.targetAnchor.z + offset.z;
      target.position.y -= .12 * (1 - size);
      matrix.compose(target.position, target.rotation, target.scale.multiplyScalar(size)); return;
    }
    const t = this.travel;
    const from = turn(source.position.clone().sub(this.sourceSelected.position).setY(0), -this.sourceHeading);
    const to = turn(target.position.clone().sub(this.targetAnchor).setY(0), -this.targetHeading);
    const logicalRow = THREE.MathUtils.lerp(from.z / this.sourceRow, to.z / this.targetRow, t);
    const transportX = selected ? 0 : item!.transportX ?? from.x;
    const x = this.q < .3 ? THREE.MathUtils.lerp(from.x, transportX, ease(this.q, .14, .3))
      : THREE.MathUtils.lerp(transportX, to.x, ease(this.q, .7, .86));
    const offset = new THREE.Vector3(x, 0, logicalRow * this.rowSpacing);
    turn(offset, this.heading);
    const y = THREE.MathUtils.lerp(source.position.y, target.position.y, t) + .1 * Math.sin(Math.PI * this.q) ** 2;
    target.position.lerpVectors(this.sourceSelected.position, this.targetAnchor, t).add(offset).setY(y);
    target.scale.lerpVectors(source.scale, target.scale, t);
    target.rotation.copy(source.rotation.clone().slerp(target.rotation, t));
    this.residualPose(target, source, selected ? this.sourceSelectedActual! : item!.source!.actual);
    matrix.compose(target.position, target.rotation, target.scale);
  }
  applyCamera(camera: THREE.PerspectiveCamera, renderedAim: THREE.Vector3,
    targetPosition: THREE.Vector3, targetAim: THREE.Vector3, targetSpan: number, focusPoint?: THREE.Vector3,
    focusBounds?: { minX: number; maxX: number; minY: number; maxY: number; corners: THREE.Vector3[] }) {
    if (!this.active) return;
    if (!this.targetCamera) this.targetCamera = { position: targetPosition.clone(), aim: targetAim.clone(), span: targetSpan };
    const destination = this.targetCamera;
    const t = this.travel, from = this.sourceCamera.position.clone().sub(this.sourceAim), to = destination.position.clone().sub(destination.aim);
    const yaw = Math.atan2(from.x, from.z), targetYaw = Math.atan2(to.x, to.z);
    const delta = Math.atan2(Math.sin(targetYaw - yaw), Math.cos(targetYaw - yaw));
    const elevation = THREE.MathUtils.lerp(Math.asin(from.y / from.length()), Math.asin(to.y / to.length()), t);
    const angle = yaw + delta * t, distance = THREE.MathUtils.lerp(from.length(), to.length(), t);
    renderedAim.lerpVectors(this.sourceAim, destination.aim, t);
    camera.position.copy(renderedAim).add(new THREE.Vector3(Math.sin(angle) * Math.cos(elevation), Math.sin(elevation),
      Math.cos(angle) * Math.cos(elevation)).multiplyScalar(distance)); camera.lookAt(renderedAim);
    const span = THREE.MathUtils.lerp(this.sourceSpan, destination.span, t) *
      (1 + .34 * ease(this.q, .14, .3) * (1 - cruise(this.q, .7, 1)));
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * distance)));
    if (focusPoint && this.selectedTarget) {
      if (!this.targetFocus) {
        const endpoint = this.sourceCamera.clone(); endpoint.aspect = camera.aspect;
        endpoint.position.copy(destination.position); endpoint.lookAt(destination.aim);
        endpoint.fov = THREE.MathUtils.radToDeg(2 * Math.atan(destination.span / (2 * to.length())));
        endpoint.updateProjectionMatrix(); endpoint.updateMatrixWorld();
        const matrix = new THREE.Matrix4().compose(this.selectedTarget.position, this.selectedTarget.rotation, this.selectedTarget.scale);
        const point = this.caseCenter.clone().applyMatrix4(matrix).project(endpoint);
        this.targetFocus = new THREE.Vector2(point.x, point.y);
      }
      const sourceFocus = this.sourceFocus.clone().lerp(this.sourceActualFocus, this.sourceResidual);
      const waypoint = sourceFocus.clone().clampScalar(-.75, .75);
      const desired = this.q < .14 ? sourceFocus.lerp(waypoint, ease(this.q, 0, .14))
        : waypoint.lerp(this.targetFocus, ease(this.q, .14, .86));
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const outward = camera.position.clone().sub(renderedAim).normalize();
      const relative = focusPoint.clone().sub(camera.position), depth = -relative.dot(outward);
      let halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      let dx = relative.dot(right) - desired.x * halfHeight * camera.aspect;
      let dy = relative.dot(up) - desired.y * halfHeight;
      if (focusBounds) {
        const corners = focusBounds.corners.map(point => {
          const offset = point.clone().sub(camera.position);
          return { d: -offset.dot(outward), x: offset.dot(right), y: offset.dot(up) };
        });
        const insetX = (focusBounds.maxX - focusBounds.minX) * .01, insetY = (focusBounds.maxY - focusBounds.minY) * .01;
        const interval = (tan: number) => {
          let lowX = -Infinity, highX = Infinity, lowY = -Infinity, highY = Infinity;
          for (const { x, y, d } of corners) {
            lowX = Math.max(lowX, x - (focusBounds.maxX - insetX) * d * tan * camera.aspect);
            highX = Math.min(highX, x - (focusBounds.minX + insetX) * d * tan * camera.aspect);
            lowY = Math.max(lowY, y - (focusBounds.maxY - insetY) * d * tan);
            highY = Math.min(highY, y - (focusBounds.minY + insetY) * d * tan);
          }
          return { lowX, highX, lowY, highY, feasible: lowX <= highX && lowY <= highY };
        };
        const amount = ease(this.q, 0, .14) * (1 - ease(this.q, .86, 1));
        const originalTan = halfHeight / depth;
        let tan = originalTan, limits = interval(tan);
        if (!limits.feasible) {
          let low = tan, high = tan * 4;
          for (let step = 0; step < 20; step++) {
            const middle = (low + high) / 2;
            if (interval(middle).feasible) high = middle; else low = middle;
          }
          tan = THREE.MathUtils.lerp(originalTan, high, amount); limits = interval(tan);
          camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tan));
          halfHeight = depth * tan;
          dx = relative.dot(right) - desired.x * halfHeight * camera.aspect;
          dy = relative.dot(up) - desired.y * halfHeight;
        }
        // A lateral camera translation preserves each corner's depth. Solve
        // their intersection directly instead of treating perspective offsets
        // as a rigid 2D rectangle. The endpoint composition stays untouched.
        const { lowX, highX, lowY, highY } = limits;
        dx = THREE.MathUtils.lerp(dx, lowX <= highX ? THREE.MathUtils.clamp(dx, lowX, highX) : (lowX + highX) / 2, amount);
        dy = THREE.MathUtils.lerp(dy, lowY <= highY ? THREE.MathUtils.clamp(dy, lowY, highY) : (lowY + highY) / 2, amount);
      }
      const correction = right.multiplyScalar(dx).add(up.multiplyScalar(dy));
      camera.position.add(correction); renderedAim.add(correction); camera.lookAt(renderedAim);
    }
  }
}

export function shelfEntryFrame(time: number) {
  // Each component already has its own eased travel. A second eased clock
  // would leave most of the opening empty, then rush the assembly midpoint.
  return { deployment: THREE.MathUtils.clamp((time - 22) / 3, 0, 1), phase: time < 25 ? "assemble" : "ready" };
}
export function shelfEntryPose(matrix: THREE.Matrix4, time: number, slot: ShelfSlotFrame, caseTop = 3.525) {
  const structure = shelfAssemblySlot(shelfEntryFrame(time).deployment, slot);
  const rise = structure.slotProgress, p = musicGeometryPose(matrix);
  p.position.x = slot.laneX + (p.position.x - slot.laneX) * structure.width;
  p.position.z = slot.frontZ + (p.position.z - slot.frontZ) * structure.length;
  const stowedY = structure.deckY - .12 - caseTop * p.scale.y;
  p.position.y = THREE.MathUtils.lerp(stowedY, structure.deckY + p.position.y - slot.floorY, rise);
  // Retain rigid vertical geometry and UVs. The opaque deck/floor reveals the
  // case from below, without flattening its glass, cover and trim together.
  p.scale.multiply(new THREE.Vector3(structure.width, structure.width > 0 && structure.length > 0 ? 1 : 0, structure.length));
  matrix.compose(p.position, p.rotation, p.scale);
}
export function shelfEntryCamera(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, time: number,
  focus?: { point: THREE.Vector3; restingPoint: THREE.Vector3 }) {
  camera.lookAt(aim); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  const restingFocus = focus?.restingPoint.clone().project(camera);
  const t = ease(time, 22, 25.45), offset = camera.position.clone().sub(aim), distance = offset.length();
  const yaw = Math.atan2(offset.x, offset.z) + THREE.MathUtils.degToRad(13) * (1 - t);
  const elevation = Math.asin(offset.y / distance) - THREE.MathUtils.degToRad(5) * (1 - t);
  camera.position.copy(aim).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(distance)); camera.lookAt(aim);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (1 + .08 * (1 - t))));
  if (focus && restingFocus) {
    const desired = new THREE.Vector2(-.14, 0).lerp(new THREE.Vector2(restingFocus.x, restingFocus.y), t);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const outward = camera.position.clone().sub(aim).normalize(), relative = focus.point.clone().sub(camera.position);
    const depth = -relative.dot(outward), halfHeight = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const correction = right.multiplyScalar(relative.dot(right) - desired.x * halfHeight * camera.aspect)
      .add(up.multiplyScalar(relative.dot(up) - desired.y * halfHeight));
    camera.position.add(correction); aim.add(correction); camera.lookAt(aim);
  }
}
