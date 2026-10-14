import * as THREE from "three";
import type { CaseAppearance, CasePart } from "./case-settings";
import type { RenderQuality } from "./render-quality";

/** A bounded approximation of light cast by visible emitting model parts. */
export function createCaseIllumination(scene: THREE.Scene) {
  const entries = Array.from({ length: 4 }, () => {
    const light = new THREE.PointLight(0xffffff, 0, 4.2, 2);
    light.name = "Case local surface emission";
    light.visible = false;
    scene.add(light);
    return { light, local: new THREE.Vector3(), enabled: false };
  });
  let currentModel: THREE.Object3D | undefined;
  let count = 0;
  function resolve(model: THREE.Object3D) {
    const parts = new Map<
      CasePart,
      { bounds: THREE.Box3; color: THREE.Color; strength: number }
    >();
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh) || !child.userData.casePart) return;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      const material = materials.find(
        (m) => m.visible && m instanceof THREE.MeshPhysicalMaterial,
      ) as THREE.MeshPhysicalMaterial | undefined;
      if (!material) return;
      const strength =
        material.emissiveIntensity *
        Math.max(material.emissive.r, material.emissive.g, material.emissive.b);
      if (strength <= 0.001) return;
      const part = child.userData.casePart as CasePart;
      const value = parts.get(part) ?? {
        bounds: new THREE.Box3(),
        color: material.emissive.clone(),
        strength,
      };
      if (strength > value.strength) {
        value.strength = strength;
        value.color.copy(material.emissive);
      }
      child.geometry.computeBoundingBox();
      value.bounds.union(child.geometry.boundingBox!);
      parts.set(part, value);
    });
    const active = [...parts.values()]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, count);
    entries.forEach((entry, i) => {
      const part = active[i];
      entry.enabled = !!part;
      if (!part) {
        entry.light.visible = false;
        return;
      }
      part.bounds.getCenter(entry.local);
      entry.local.z = part.bounds.max.z + 0.1;
      entry.light.color.copy(part.color);
      entry.light.intensity = part.strength * 0.65;
    });
  }
  return {
    apply(
      _appearance: CaseAppearance,
      quality: Pick<RenderQuality, "lighting">,
    ) {
      currentModel = undefined;
      count =
        quality.lighting === "full" ? 4 : quality.lighting === "high" ? 1 : 0;
    },
    update(model: THREE.Object3D, visible = true) {
      if (currentModel !== model) {
        currentModel = model;
        resolve(model);
      }
      model.updateWorldMatrix(true, false);
      for (const entry of entries) {
        entry.light.visible = visible && entry.enabled;
        if (entry.light.visible)
          entry.light.position
            .copy(entry.local)
            .applyMatrix4(model.matrixWorld);
      }
    },
    dispose() {
      for (const { light } of entries) {
        scene.remove(light);
        light.dispose();
      }
    },
  };
}
