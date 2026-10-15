import * as THREE from "three";

type AppearanceShader = Parameters<THREE.Material["onBeforeCompile"]>[0];

type MaterialWrapper = {
  hook: THREE.Material["onBeforeCompile"];
  cacheKey: THREE.Material["customProgramCacheKey"];
  originalHook: THREE.Material["onBeforeCompile"];
  originalCacheKeyMethod: THREE.Material["customProgramCacheKey"];
};

const VERSION = "music-array-appearance-v3";
const VERTEX_DECLARATION_MARKER = "MUSIC_ARRAY_APPEARANCE_VERTEX_DECLARATION_V3";
const VERTEX_VALUE_MARKER = "MUSIC_ARRAY_APPEARANCE_VERTEX_VALUE_V3";
const VERTEX_COLOR_MARKER = "MUSIC_ARRAY_APPEARANCE_VERTEX_COLOR_V3";
const FRAGMENT_MARKER = "MUSIC_ARRAY_APPEARANCE_FRAGMENT_V3";

/**
 * Carries per-instance row styling and shares ordered alpha discard with depth
 * passes. MusicArrayFadePass applies colour once after glass and output compose.
 */
export class MusicArrayAppearance {
  private readonly pageColor = new THREE.Color();
  private readonly wrappers = new WeakMap<THREE.Material, MaterialWrapper>();
  private readonly instanceAttributes = new WeakMap<THREE.InstancedMesh, THREE.InstancedBufferAttribute>();
  private readonly assignedDepthMeshes = new Set<THREE.InstancedMesh>();
  private depthMaterial?: THREE.MeshDepthMaterial;

  constructor(background: THREE.Color) {
    this.setBackground(background);
  }

  setBackground(color: THREE.Color): void {
    this.pageColor.copy(color);
  }

  get backgroundColor() { return this.pageColor; }

  write(mesh: THREE.InstancedMesh, index: number, alpha: number, tint: number): void {
    const capacity = mesh.instanceMatrix.count;
    if (!Number.isInteger(index) || index < 0 || index >= capacity) return;

    const instanceColor = this.ensureInstanceAttribute(mesh);
    const offset = index * 3;
    instanceColor.array[offset] = 1 + THREE.MathUtils.clamp(alpha, 0, 1);
    instanceColor.array[offset + 1] = 1 + THREE.MathUtils.clamp(tint, 0, 1);
    instanceColor.array[offset + 2] = 1;

    if (mesh.castShadow && !mesh.customDepthMaterial) {
      const depthMaterial = this.getDepthMaterial();
      mesh.customDepthMaterial = depthMaterial;
      this.assignedDepthMeshes.add(mesh);
    }

    if (Array.isArray(mesh.material)) {
      for (const material of mesh.material) this.patchAuxiliary(material);
    } else {
      this.patchAuxiliary(mesh.material);
    }
  }

  finish(mesh: THREE.InstancedMesh): void {
    const instanceColor = this.instanceAttributes.get(mesh);
    if (instanceColor && mesh.instanceColor === instanceColor) {
      instanceColor.needsUpdate = true;
    }
  }

  release(mesh: THREE.InstancedMesh): void {
    this.assignedDepthMeshes.delete(mesh);
    if (this.depthMaterial && mesh.customDepthMaterial === this.depthMaterial) {
      mesh.customDepthMaterial = undefined;
    }
    this.instanceAttributes.delete(mesh);
  }

  patchAuxiliary(material: THREE.Material): void {
    const previous = this.wrappers.get(material);
    if (
      previous &&
      material.onBeforeCompile === previous.hook &&
      material.customProgramCacheKey === previous.cacheKey
    ) {
      return;
    }

    const originalHook = material.onBeforeCompile;
    const originalCacheKeyMethod = material.customProgramCacheKey;
    const originalCacheKey = originalCacheKeyMethod.bind(material);
    const hook: THREE.Material["onBeforeCompile"] = (shader, renderer) => {
      originalHook.call(material, shader, renderer);
      this.patchShader(shader);
    };
    const cacheKey: THREE.Material["customProgramCacheKey"] = () =>
      `${originalCacheKey()}-${VERSION}`;

    material.onBeforeCompile = hook;
    material.customProgramCacheKey = cacheKey;
    material.needsUpdate = true;
    this.wrappers.set(material, { hook, cacheKey, originalHook, originalCacheKeyMethod });
  }

  unpatch(material: THREE.Material): void {
    const wrapper = this.wrappers.get(material);
    if (!wrapper) return;

    this.wrappers.delete(material);
    if (
      material.onBeforeCompile !== wrapper.hook ||
      material.customProgramCacheKey !== wrapper.cacheKey
    ) {
      return;
    }

    material.onBeforeCompile = wrapper.originalHook;
    material.customProgramCacheKey = wrapper.originalCacheKeyMethod;
    material.needsUpdate = true;
  }

  dispose(): void {
    if (this.depthMaterial) {
      for (const mesh of this.assignedDepthMeshes) {
        if (mesh.customDepthMaterial === this.depthMaterial) {
          mesh.customDepthMaterial = undefined;
        }
      }
      this.assignedDepthMeshes.clear();
      this.depthMaterial.dispose();
      this.depthMaterial = undefined;
    }
  }

  private ensureInstanceAttribute(mesh: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
    const capacity = mesh.instanceMatrix.count;
    let attribute = this.instanceAttributes.get(mesh);
    if (!attribute || mesh.instanceColor !== attribute || attribute.count !== capacity) {
      const values = new Float32Array(capacity * 3);
      for (let i = 0; i < capacity; i += 1) {
        values[i * 3] = 2;
        values[i * 3 + 1] = 1;
        values[i * 3 + 2] = 1;
      }
      attribute = new THREE.InstancedBufferAttribute(values, 3);
      attribute.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = attribute;
      this.instanceAttributes.set(mesh, attribute);
    }
    return attribute;
  }

  private getDepthMaterial(): THREE.MeshDepthMaterial {
    if (!this.depthMaterial) {
      this.depthMaterial = new THREE.MeshDepthMaterial({
        depthPacking: THREE.RGBADepthPacking,
      });
      this.patchAuxiliary(this.depthMaterial);
    }
    return this.depthMaterial;
  }

  private patchShader(shader: AppearanceShader): void {
    if (!shader.vertexShader.includes(`#include <common>`) || !shader.vertexShader.includes(`#include <begin_vertex>`)) {
      return;
    }

    if (!shader.vertexShader.includes(VERTEX_DECLARATION_MARKER)) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>\n// ${VERTEX_DECLARATION_MARKER}\nvarying vec2 vMusicArrayAlphaTint;`,
      );
    }
    if (!shader.vertexShader.includes(VERTEX_VALUE_MARKER)) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n// ${VERTEX_VALUE_MARKER}\nvMusicArrayAlphaTint = vec2(1.0, 0.0);\n#ifdef USE_INSTANCING_COLOR\nvMusicArrayAlphaTint = instanceColor.rg - vec2(1.0);\n#endif`,
      );
    }
    if (
      shader.vertexShader.includes(`#include <color_vertex>`) &&
      !shader.vertexShader.includes(VERTEX_COLOR_MARKER)
    ) {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <color_vertex>",
        `#include <color_vertex>\n// ${VERTEX_COLOR_MARKER}\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb /= instanceColor.rgb;\n#endif`,
      );
    }

    const fragmentShader = shader.fragmentShader;
    if (
      fragmentShader.includes(FRAGMENT_MARKER) ||
      !fragmentShader.includes(`#include <common>`) ||
      !fragmentShader.includes(`#include <clipping_planes_fragment>`)
    ) {
      return;
    }

    shader.fragmentShader = fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec2 vMusicArrayAlphaTint;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>\n// ${FRAGMENT_MARKER}\nfloat musicArrayAlpha = clamp(vMusicArrayAlphaTint.x, 0.0, 1.0);\nvec2 musicArrayPixel = mod(floor(gl_FragCoord.xy), 4.0);\nvec2 musicArrayHalfPixel = floor(musicArrayPixel * 0.5);\nfloat musicArrayLowX = mod(musicArrayPixel.x, 2.0);\nfloat musicArrayLowY = mod(musicArrayPixel.y, 2.0);\nfloat musicArrayHighX = mod(musicArrayHalfPixel.x, 2.0);\nfloat musicArrayHighY = mod(musicArrayHalfPixel.y, 2.0);\nfloat musicArrayLowBayer = mod(2.0 * musicArrayLowX + 3.0 * musicArrayLowY - 4.0 * musicArrayLowX * musicArrayLowY, 4.0);\nfloat musicArrayHighBayer = mod(2.0 * musicArrayHighX + 3.0 * musicArrayHighY - 4.0 * musicArrayHighX * musicArrayHighY, 4.0);\nfloat musicArrayBayer = 4.0 * musicArrayLowBayer + musicArrayHighBayer;\nif (musicArrayAlpha <= (musicArrayBayer + 0.5) / 16.0) discard;`,
    );
  }
}
