import * as THREE from "three";
import { MUSIC_MODEL } from "./music-model";
import { ROW_SPACING } from "./archive-loop";

/** A physical tray under the existing 3D cases, independent of their skin. */
export class MusicShelf {
  readonly group = new THREE.Group();
  private readonly parts: THREE.InstancedMesh[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly offset = new THREE.Matrix4();
  private readonly material = new THREE.MeshStandardMaterial({ color: "#b3b7b3", roughness: .42, metalness: .48 });
  private readonly rim = new THREE.MeshPhysicalMaterial({ color: "#e1e4dc", roughness: .28, metalness: .06, transmission: .24, thickness: .06, ior: 1.46, clearcoat: .22, envMapIntensity: .72 });
  private readonly index = new THREE.MeshStandardMaterial({ color: "#b56834", roughness: .48, metalness: .12 });
  constructor(count: number) {
    const w = MUSIC_MODEL.width + .22;
    const sections: [number, number, number, number, THREE.Material][] = [
      [w, .12, 0, -.06, this.material],
      [.08, .27, -w / 2, .06, this.rim], [.08, .27, w / 2, .06, this.rim],
      [.012, .016, -w / 2 - .045, -.035, this.index],
    ];
    for (const [width, height, x, y, material] of sections) {
      const geometry = new THREE.BoxGeometry(width, height, ROW_SPACING + .012).translate(x, y + .175, 0);
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      this.parts.push(mesh);
      this.group.add(mesh);
    }
    this.group.name = "Optional physical record shelves";
    this.group.visible = false;
  }
  setSlot(index: number, x: number, y: number, z: number) {
    this.offset.makeTranslation(x, y, z);
    this.matrix.copy(this.offset);
    for (const part of this.parts) part.setMatrixAt(index, this.matrix);
  }
  finish() { for (const part of this.parts) part.instanceMatrix.needsUpdate = true; }
  setMode(night: boolean, accent: string, design: "rhine" | "archive" = "rhine") {
    const archive = design === "archive";
    this.material.color.set(night ? "#667078" : archive ? "#acb1ac" : "#c1c4bb");
    this.material.metalness = archive ? .64 : .44;
    this.material.roughness = archive ? .38 : .46;
    this.rim.color.set(night ? "#9baab8" : "#e1e4dc");
    this.rim.transmission = archive ? .08 : .24;
    this.rim.roughness = archive ? .34 : .28;
    this.index.color.set(accent);
    this.index.emissive.set(accent).multiplyScalar(night ? .035 : .015);
  }
}
