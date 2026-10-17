import * as THREE from "three";

type Pose = { position: THREE.Vector3; rotation: THREE.Quaternion; scale: THREE.Vector3 };
const smooth = (t: number) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
const pose = (matrix: THREE.Matrix4): Pose => {
  const result = { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), scale: new THREE.Vector3() };
  matrix.decompose(result.position, result.rotation, result.scale);
  return result;
};

/** Retarget from the last rendered poses, including a reversal mid-orbit. */
export class MusicLayoutTransition {
  private source = new Map<string, Pose>();
  private selected?: Pose;
  private elapsed = 0;
  private readonly duration = 1.45;
  private cameraPosition = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private span = 1;
  private fromShelf = false;
  private toShelf = false;
  private targetAnchor?: THREE.Vector3;
  private retarget = false;
  active = false;
  get progress() { return this.active ? smooth(this.elapsed / this.duration) : 1; }
  get shelfAmount() { return THREE.MathUtils.lerp(Number(this.fromShelf), Number(this.toShelf), this.progress); }

  begin(entries: Map<string, THREE.Matrix4>, selected: THREE.Matrix4, camera: THREE.PerspectiveCamera,
    aim: THREE.Vector3, fromShelf: boolean, toShelf: boolean) {
    this.retarget = this.active;
    this.targetAnchor = undefined;
    this.source = new Map([...entries].map(([key, matrix]) => [key, pose(matrix)]));
    this.selected = pose(selected);
    this.cameraPosition.copy(camera.position); this.aim.copy(aim);
    this.span = 2 * camera.position.distanceTo(aim) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.fromShelf = fromShelf; this.toShelf = toShelf;
    this.elapsed = 0; this.active = true;
  }
  advance(dt: number) { if (this.active) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt)); }
  finishFrame() { if (this.elapsed >= this.duration) this.clear(); }
  clear() { this.active = false; this.source.clear(); this.selected = undefined; }
  prepareTarget(anchor: THREE.Vector3) { this.targetAnchor = anchor; }

  apply(matrix: THREE.Matrix4, key: string | undefined, selected = false, primary = true) {
    if (!this.active) return;
    const source = selected ? this.selected : key ? this.source.get(key) : undefined;
    const target = pose(matrix), t = this.progress;
    if (source && primary) {
      if (!selected && this.selected && this.targetAnchor) {
        // Both spatial axes reverse between the two layouts. Going around the
        // focus avoids crushing every lane through one Cartesian midpoint.
        const from = source.position.clone().sub(this.selected.position);
        const to = target.position.clone().sub(this.targetAnchor);
        const startAngle = Math.atan2(from.z, from.x), endAngle = Math.atan2(to.z, to.x);
        let turn = Math.atan2(Math.sin(endAngle - startAngle), Math.cos(endAngle - startAngle));
        const direction = this.toShelf ? 1 : -1;
        if (!this.retarget && turn * direction < 0) turn += direction * Math.PI * 2;
        const radius = THREE.MathUtils.lerp(Math.hypot(from.x, from.z), Math.hypot(to.x, to.z), t);
        target.position.lerpVectors(this.selected.position, this.targetAnchor, t).add(new THREE.Vector3(
          Math.cos(startAngle + turn * t) * radius,
          THREE.MathUtils.lerp(from.y, to.y, t), Math.sin(startAngle + turn * t) * radius));
      } else target.position.lerpVectors(source.position, target.position, t);
      target.rotation.copy(source.rotation.clone().slerp(target.rotation, t));
      target.scale.lerpVectors(source.scale, target.scale, t);
    } else target.scale.multiplyScalar(smooth(Math.min(1, t * 1.5)));
    matrix.compose(target.position, target.rotation, target.scale);
  }
  applyCamera(camera: THREE.PerspectiveCamera, renderedAim: THREE.Vector3,
    targetPosition: THREE.Vector3, targetAim: THREE.Vector3, targetSpan: number) {
    if (!this.active) return;
    const t = this.progress;
    const from = this.cameraPosition.clone().sub(this.aim);
    const to = targetPosition.clone().sub(targetAim);
    const distance = THREE.MathUtils.lerp(from.length(), to.length(), t);
    const direction = from.normalize().lerp(to.normalize(), t).normalize();
    renderedAim.lerpVectors(this.aim, targetAim, t);
    camera.position.copy(renderedAim).addScaledVector(direction, distance);
    camera.lookAt(renderedAim);
    const span = THREE.MathUtils.lerp(this.span, targetSpan, t) * (1 + .09 * Math.sin(Math.PI * t));
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * distance)));
  }
}

/** ARRAY's authored final act: the catalog feeds into its racks, then opens out. */
export function shelfEntryPose(matrix: THREE.Matrix4, time: number, laneDistance: number, rowDistance: number) {
  const delay = Math.min(.75, Math.abs(laneDistance) * .18 + Math.abs(rowDistance) * .026);
  const t = smooth((time - 22.15 - delay) / 2.65);
  const target = pose(matrix);
  target.position.x += laneDistance * 1.1 * (1 - t);
  target.position.z -= (5.5 + Math.abs(rowDistance) * .11) * (1 - t);
  target.position.y -= .65 * (1 - t);
  matrix.compose(target.position, target.rotation, target.scale);
}

export function shelfEntryCamera(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, time: number) {
  const t = smooth((time - 22) / 4.65);
  const offset = camera.position.clone().sub(aim);
  const distance = offset.length();
  const yaw = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(-10), Math.atan2(-offset.x, offset.z), t);
  const elevation = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(14), Math.asin(offset.y / distance), t);
  const span = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(aim).add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation),
    Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(distance));
  camera.lookAt(aim);
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span * (1 + .2 * (1 - t)) / (2 * distance)));
}
