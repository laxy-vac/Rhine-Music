import * as THREE from "three";

const smooth = (t: number) => { t = THREE.MathUtils.clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };

/** One optical change of view. Cases never orbit or cross through each other. */
export class MusicLayoutTransition {
  private elapsed = 0;
  private readonly duration = 1.12;
  active = false;
  get progress() { return this.active ? this.elapsed / this.duration : 1; }
  get frame() {
    const t = this.progress;
    return {
      outgoing: 1 - smooth(t / .34),
      incoming: smooth((t - .34) / .66),
      phase: t < .34 ? "release" : "resolve",
    };
  }
  begin() { this.elapsed = 0; this.active = true; }
  advance(dt: number) { if (this.active) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt)); }
  finishFrame() { if (this.elapsed >= this.duration) this.clear(); }
  clear() { this.active = false; }
  applyCamera(camera: THREE.PerspectiveCamera, renderedAim: THREE.Vector3,
    targetPosition: THREE.Vector3, targetAim: THREE.Vector3, targetSpan: number) {
    if (!this.active) return;
    // The old frame covers target preparation; only a shallow settling move
    // becomes visible, rather than following every album between coordinates.
    const settle = 1 - smooth((this.progress - .28) / .72);
    const offset = targetPosition.clone().sub(targetAim);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), .025 * settle);
    renderedAim.copy(targetAim);
    camera.position.copy(targetAim).add(offset);
    camera.lookAt(renderedAim);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(targetSpan * (1 + .018 * settle) / (2 * offset.length())));
  }
}

/** Structure, catalog and controls each have one clear entrance beat. */
export function shelfEntryFrame(time: number) {
  return {
    structure: smooth((time - 22) / .65),
    catalog: smooth((time - 22.75) / 1.35),
    casesVisible: time >= 22.75,
    phase: time < 22.75 ? "structure" : time < 24.1 ? "catalog" : "ready",
  };
}

export function shelfEntryCamera(camera: THREE.PerspectiveCamera, aim: THREE.Vector3, time: number) {
  // Keep rack and catalog registrations identical during the reveal, then
  // settle the lens by 1.8% only after every case is present.
  const settle = 1 - smooth((time - 24.1) / .85);
  const distance = camera.position.distanceTo(aim);
  const span = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span * (1 + .018 * settle) / (2 * distance)));
}
