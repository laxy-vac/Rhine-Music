import * as THREE from "three";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

type SharedDepthSource = {
  target: THREE.WebGLRenderTarget;
  eligible: boolean;
} | undefined;

type BokehUniform = { value: unknown };

/** Reuses a matching scene depth texture while preserving BokehPass fallback behavior. */
export class MusicSharedDepthBokehPass extends BokehPass {
  reuseEnabled = true;

  private depthSource?: () => SharedDepthSource;
  private passWidth = 1;
  private passHeight = 1;
  private readonly sharedQuad: FullScreenQuad;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly perspectiveCamera: THREE.PerspectiveCamera;

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera, params: ConstructorParameters<typeof BokehPass>[2]) {
    super(scene, camera, params);
    // Bokeh's original packed depth is stored in an RGBA16F target. Match that
    // storage rounding when reading native depth, so its existing blur does not
    // change merely because the second geometry pass has been removed.
    this.materialBokeh.fragmentShader = this.materialBokeh.fragmentShader.replace(
      "return texture2D( tDepth, screenPosition ).x;",
      `vec4 packedDepth = packDepthToRGBA( texture2D( tDepth, screenPosition ).x );
      packedDepth.rg = unpackHalf2x16( packHalf2x16( packedDepth.rg ) );
      packedDepth.ba = unpackHalf2x16( packHalf2x16( packedDepth.ba ) );
      return unpackRGBAToDepth( packedDepth );`,
    );
    this.perspectiveCamera = camera;
    this.sharedQuad = new FullScreenQuad(this.materialBokeh);

    // Three r183 stores these with underscores at runtime; the installed type
    // declarations expose the older public property names.
    const internals = this as BokehPass & {
      _materialDepth?: THREE.MeshDepthMaterial;
      materialDepth?: THREE.MeshDepthMaterial;
    };
    const depthMaterial = internals._materialDepth ?? internals.materialDepth;
    if (!depthMaterial) throw new Error("BokehPass depth material is unavailable");
    this.depthMaterial = depthMaterial;
  }

  setDepthSource(source: (() => SharedDepthSource) | undefined) {
    this.depthSource = source;
  }

  override setSize(width: number, height: number) {
    super.setSize(width, height);
    this.passWidth = width;
    this.passHeight = height;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime = 0,
    maskActive = false,
  ) {
    const source = this.reuseEnabled ? this.depthSource?.() : undefined;
    const depthTexture = source?.eligible ? this.validDepthTexture(source.target, readBuffer) : undefined;
    if (!source?.eligible || !depthTexture) {
      this.setDepthPacking(1);
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      return;
    }

    this.setDepthPacking(0);
    const uniforms = this.uniforms as Record<string, BokehUniform>;
    const oldDepth = uniforms.tDepth.value;
    try {
      this.appendPointsAndLines(renderer, source.target);
      uniforms.tDepth.value = depthTexture;
      uniforms.tColor.value = readBuffer.texture;
      uniforms.nearClip.value = this.perspectiveCamera.near;
      uniforms.farClip.value = this.perspectiveCamera.far;

      if (this.renderToScreen) {
        renderer.setRenderTarget(null);
        this.sharedQuad.render(renderer);
      } else {
        renderer.setRenderTarget(writeBuffer);
        renderer.clear();
        this.sharedQuad.render(renderer);
      }
    } finally {
      uniforms.tDepth.value = oldDepth;
    }
  }

  override dispose() {
    this.sharedQuad.dispose();
    super.dispose();
  }

  private validDepthTexture(target: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const depthTexture = target.depthTexture;
    const image = depthTexture?.image as { width?: number; height?: number } | undefined;
    if (!depthTexture?.isDepthTexture || !image) return undefined;
    if (target.width !== this.passWidth || target.height !== this.passHeight) return undefined;
    if (readBuffer.width !== this.passWidth || readBuffer.height !== this.passHeight) return undefined;
    if (image.width !== this.passWidth || image.height !== this.passHeight) return undefined;
    return depthTexture;
  }

  private setDepthPacking(packing: 0 | 1) {
    if (this.materialBokeh.defines.DEPTH_PACKING !== packing) {
      this.materialBokeh.defines.DEPTH_PACKING = packing;
      this.materialBokeh.needsUpdate = true;
    }
  }

  private appendPointsAndLines(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    const pointsAndLines: { object: THREE.Object3D }[] = [];
    const originalCameraLayers = this.camera.layers.mask;
    this.scene.traverseVisible((object) => {
      const candidate = object as THREE.Object3D & {
        isPoints?: boolean;
        isLine?: boolean;
        isLine2?: boolean;
      };
      if (!(candidate.isPoints || candidate.isLine || candidate.isLine2)) return;
      if ((candidate.layers.mask & originalCameraLayers) === 0) return;
      pointsAndLines.push({ object: candidate });
    });
    if (pointsAndLines.length === 0) return;

    const allObjectLayers: { object: THREE.Object3D; layers: number }[] = [];
    this.scene.traverse((object) => allObjectLayers.push({ object, layers: object.layers.mask }));
    const highLayer = 1 << 31;
    const originalTarget = renderer.getRenderTarget();
    const originalAutoClear = renderer.autoClear;
    const originalBackground = this.scene.background;
    const originalOverride = this.scene.overrideMaterial;
    const originalColorWrite = this.depthMaterial.colorWrite;
    const originalDepthWrite = this.depthMaterial.depthWrite;

    try {
      renderer.autoClear = false;
      this.scene.background = null;
      this.scene.overrideMaterial = this.depthMaterial;
      this.depthMaterial.colorWrite = false;
      this.depthMaterial.depthWrite = true;
      for (const { object } of allObjectLayers) object.layers.mask = 0;
      this.camera.layers.mask = highLayer;
      for (const { object } of pointsAndLines) object.layers.mask = highLayer;
      renderer.setRenderTarget(target);
      renderer.render(this.scene, this.camera);
    } finally {
      try {
        renderer.setRenderTarget(originalTarget);
      } finally {
        for (const { object, layers } of allObjectLayers) object.layers.mask = layers;
        this.camera.layers.mask = originalCameraLayers;
        this.depthMaterial.colorWrite = originalColorWrite;
        this.depthMaterial.depthWrite = originalDepthWrite;
        this.scene.overrideMaterial = originalOverride;
        this.scene.background = originalBackground;
        renderer.autoClear = originalAutoClear;
      }
    }
  }
}
