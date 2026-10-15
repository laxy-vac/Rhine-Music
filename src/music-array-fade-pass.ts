import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";
import type { MusicArrayAppearance } from "./music-array-appearance";

const COMPOSITE_VERTEX_SHADER = /* glsl */ `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 projectionMatrix;
uniform mat4 modelViewMatrix;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tMask;
uniform vec3 pageOutputColor;
varying vec2 vUv;

void main() {
  vec4 base = texture2D(tDiffuse, vUv);
  float tint = clamp(texture2D(tMask, vUv).r, 0.0, 1.0);
  gl_FragColor = vec4(mix(base.rgb, pageOutputColor, tint), base.a);
}
`;

/** Applies the array's background fade once, after scene tone and output mapping. */
export class MusicArrayFadePass extends Pass {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly appearance: MusicArrayAppearance;
  private readonly maskTarget: THREE.WebGLRenderTarget;
  private readonly maskMaterial: THREE.MeshBasicMaterial;
  private readonly compositeMaterial: THREE.RawShaderMaterial;
  private readonly quad: FullScreenQuad;
  private readonly pageOutputColor = new THREE.Color(0x000000);

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    appearance: MusicArrayAppearance,
  ) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.appearance = appearance;
    this.needsSwap = true;
    this.enabled = false;

    this.maskTarget = new THREE.WebGLRenderTarget(1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.maskTarget.texture.name = "MusicArrayFadeMask";
    this.maskTarget.texture.colorSpace = THREE.NoColorSpace;
    this.maskTarget.texture.generateMipmaps = false;

    this.maskMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
      depthTest: true,
      depthWrite: true,
    });
    const originalHook = this.maskMaterial.onBeforeCompile;
    this.maskMaterial.onBeforeCompile = (shader, renderer) => {
      originalHook.call(this.maskMaterial, shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <opaque_fragment>",
          "gl_FragColor = vec4(vMusicArrayAlphaTint.y, 0.0, 0.0, 1.0);",
        )
        // Store the row amount directly, without scene fog or output mapping.
        .replace("#include <fog_fragment>", "");
    };
    this.maskMaterial.customProgramCacheKey = () => "music-array-fade-mask-v1";
    this.appearance.patchAuxiliary(this.maskMaterial);

    this.compositeMaterial = new THREE.RawShaderMaterial({
      name: "MusicArrayFadeComposite",
      uniforms: {
        tDiffuse: { value: null },
        tMask: { value: this.maskTarget.texture },
        pageOutputColor: { value: this.pageOutputColor },
      },
      vertexShader: COMPOSITE_VERTEX_SHADER,
      fragmentShader: COMPOSITE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.compositeMaterial);
  }

  setBackground(color: THREE.Color): void {
    this.pageOutputColor.copy(color).convertLinearToSRGB();
  }

  override setSize(width: number, height: number): void {
    this.maskTarget.setSize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ): void {
    const oldTarget = renderer.getRenderTarget();
    const oldCubeFace = renderer.getActiveCubeFace();
    const oldMipmapLevel = renderer.getActiveMipmapLevel();
    const oldAutoClear = renderer.autoClear;
    const oldClearColor = renderer.getClearColor(new THREE.Color()).clone();
    const oldClearAlpha = renderer.getClearAlpha();
    const oldShadowAutoUpdate = renderer.shadowMap.autoUpdate;
    const oldShadowNeedsUpdate = renderer.shadowMap.needsUpdate;
    const oldOverrideMaterial = this.scene.overrideMaterial;
    const oldBackground = this.scene.background;
    const oldFog = this.scene.fog;

    try {
      this.scene.overrideMaterial = this.maskMaterial;
      this.scene.background = null;
      this.scene.fog = null;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = false;
      renderer.setRenderTarget(this.maskTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.camera);
    } finally {
      this.scene.overrideMaterial = oldOverrideMaterial;
      this.scene.background = oldBackground;
      this.scene.fog = oldFog;
      renderer.shadowMap.autoUpdate = oldShadowAutoUpdate;
      renderer.shadowMap.needsUpdate = oldShadowNeedsUpdate;
      renderer.autoClear = oldAutoClear;
      renderer.setClearColor(oldClearColor, oldClearAlpha);
      renderer.setRenderTarget(oldTarget, oldCubeFace, oldMipmapLevel);
    }

    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.appearance.unpatch(this.maskMaterial);
    this.maskMaterial.dispose();
    this.maskTarget.dispose();
    this.compositeMaterial.dispose();
    this.quad.dispose();
  }
}
