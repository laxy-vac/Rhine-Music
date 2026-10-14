import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { RenderQuality } from "./render-quality";

/** Neutral specimen lighting shared by the editor and cached Punk projections.
 * The forward key lets surface labels cast a shadow onto the recessed inlay. */
export function createCaseStudioLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const room = new RoomEnvironment();
  // These emitters only exist in the reflection capture. The visible editor
  // and archive contain no extra walls or light-panel props. Long softboxes
  // give the rail bevels a moving, narrow highlight instead of painted lines.
  const stripGeometry = new THREE.PlaneGeometry(1, 1);
  const stripMaterial = new THREE.MeshLambertMaterial({
    color: 0x000000,
    emissive: 0xffffff,
    emissiveIntensity: 18,
    side: THREE.DoubleSide,
  });
  const addStrip = (position: THREE.Vector3, width: number, height: number) => {
    const strip = new THREE.Mesh(stripGeometry, stripMaterial);
    strip.position.copy(position);
    strip.scale.set(width, height, 1);
    strip.lookAt(0, 3.5, 0);
    room.add(strip);
  };
  addStrip(new THREE.Vector3(-1.5, 10.5, 12), 20, .35);
  addStrip(new THREE.Vector3(-9, 5, 9), .38, 13);
  addStrip(new THREE.Vector3(11, 5, 3), .3, 9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const reflection = pmrem.fromScene(room, .018);
  room.dispose(); pmrem.dispose();
  scene.environment = reflection.texture;
  scene.environmentIntensity = .38;

  const ambient = new THREE.HemisphereLight("#ffffff", "#858580", .7);
  const key = new THREE.DirectionalLight("#ffffff", 2.05);
  key.position.set(-3.5, 7, 10);
  key.target.position.set(0, 1.85, 0);
  key.castShadow = true;
  key.shadow.camera.left = -3.2; key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2; key.shadow.camera.bottom = -3.2;
  key.shadow.camera.near = .5; key.shadow.camera.far = 24;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -.00012;
  key.shadow.normalBias = .0015;
  key.shadow.radius = 3.2;
  const fill = new THREE.DirectionalLight("#ffffff", .22);
  fill.position.set(5, 2, 5);
  scene.add(ambient, key, key.target, fill);
  renderer.shadowMap.type = THREE.PCFShadowMap;

  return {
    setTheme(_theme: "day" | "night") {
      // The source skins use one studio exposure on either UI background.
      // Keep whites neutral instead of tinting every material blue or amber.
      renderer.toneMappingExposure = 1;
    },
    setQuality(quality: Pick<RenderQuality, "shadows">) {
      renderer.shadowMap.enabled = quality.shadows > 0;
      key.castShadow = renderer.shadowMap.enabled;
      const size = Math.max(512, Math.min(2048, quality.shadows));
      if (key.shadow.mapSize.x !== size) {
        key.shadow.map?.dispose(); key.shadow.map = null;
        key.shadow.mapSize.set(size, size);
      }
      renderer.shadowMap.needsUpdate = true;
    },
    dispose() {
      scene.remove(ambient, key, key.target, fill);
      key.shadow.dispose();
      if (scene.environment === reflection.texture) scene.environment = null;
      reflection.dispose();
    },
  };
}
