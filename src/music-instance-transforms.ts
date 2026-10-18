import type { InstancedMesh, InstancedBufferAttribute } from "three";

/** Case parts have independent geometry/materials but the same logical pose pool. */
export class MusicInstanceTransforms {
  enabled = true;

  bind(meshes: readonly InstancedMesh[]): InstancedBufferAttribute | undefined {
    const first = meshes[0]?.instanceMatrix;
    if (!first) return undefined;
    if (this.enabled) {
      for (const mesh of meshes)
        if (mesh.instanceMatrix.count === first.count) mesh.instanceMatrix = first;
      return first;
    }
    // Restore independent buffers for diagnostics before the caller writes poses.
    const seen = new Set<InstancedBufferAttribute>();
    for (const mesh of meshes) {
      if (seen.has(mesh.instanceMatrix)) mesh.instanceMatrix = mesh.instanceMatrix.clone() as InstancedBufferAttribute;
      seen.add(mesh.instanceMatrix);
    }
    return undefined;
  }
}
