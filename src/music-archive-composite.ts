import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

/** Last output pass; snapshots stay on the GPU and contain no second scene. */
export class MusicArchiveComposite extends Pass {
  private source = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, type: THREE.UnsignedByteType });
  private spare = this.source.clone();
  private lastBuffer?: THREE.WebGLRenderTarget;
  private width = 1;
  private height = 1;
  private material = new THREE.ShaderMaterial({
    name: "Archive optical reframe",
    uniforms: {
      tDiffuse: { value: null }, tSource: { value: this.source.texture },
      mode: { value: 0 }, outgoing: { value: 0 }, incoming: { value: 1 },
      reveal: { value: 1 }, background: { value: new THREE.Color() },
    },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tSource;
      uniform float mode, outgoing, incoming, reveal;
      uniform vec3 background;
      varying vec2 vUv;
      float sweep(float p) {
        return smoothstep(vUv.x - .09, vUv.x + .09, mix(-.1, 1.1, p));
      }
      void main() {
        vec4 current = texture2D(tDiffuse, vUv);
        if (mode < .5) { gl_FragColor = current; return; }
        if (mode < 1.5) {
          vec3 previous = texture2D(tSource, (vUv - .5) * (1. + .012 * (1. - outgoing)) + .5).rgb;
          // Old and new layouts never form a double exposure.
          gl_FragColor = vec4(mix(background, previous, outgoing) +
            (current.rgb - background) * sweep(incoming), 1.);
        } else if (mode < 2.5) {
          gl_FragColor = vec4(mix(background, current.rgb, sweep(reveal)), 1.);
        } else {
          gl_FragColor = vec4(mix(texture2D(tSource, vUv).rgb, current.rgb, sweep(reveal)), 1.);
        }
      }`,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  private quad = new FullScreenQuad(this.material);
  snapshotRevision = 0;

  constructor() {
    super();
    this.source.texture.name = "Archive previous composed frame";
    this.spare.texture.name = "Archive snapshot staging";
    this.source.texture.colorSpace = this.spare.texture.colorSpace = THREE.NoColorSpace;
    this.source.texture.generateMipmaps = this.spare.texture.generateMipmaps = false;
  }

  /** Capture the actual composite on reversal, or the bare racks for entry. */
  capture(renderer: THREE.WebGLRenderer, raw = false) {
    if (!this.lastBuffer) return false;
    this.spare.setSize(this.width, this.height);
    const target = renderer.getRenderTarget();
    const mode = this.material.uniforms.mode.value;
    this.material.uniforms.tDiffuse.value = this.lastBuffer.texture;
    if (raw) this.material.uniforms.mode.value = 0;
    try {
      renderer.setRenderTarget(this.spare);
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(target);
      this.material.uniforms.mode.value = mode;
    }
    [this.source, this.spare] = [this.spare, this.source];
    this.material.uniforms.tSource.value = this.source.texture;
    this.snapshotRevision++;
    return true;
  }

  setFrame(mode: number, color: THREE.Color, outgoing = 0, incoming = 1, reveal = 1) {
    this.material.uniforms.mode.value = mode;
    this.material.uniforms.background.value.copy(color).convertLinearToSRGB();
    this.material.uniforms.outgoing.value = outgoing;
    this.material.uniforms.incoming.value = incoming;
    this.material.uniforms.reveal.value = reveal;
  }
  override setSize(width: number, height: number) {
    if (this.width === width && this.height === height) return;
    this.width = width; this.height = height;
    // A resize must not erase the image currently covering a layout change.
    // Its normalized UVs remain usable until the next capture replaces it.
    this.spare.setSize(width, height);
    this.lastBuffer = undefined;
  }
  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    this.lastBuffer = readBuffer;
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  override dispose() {
    this.source.dispose(); this.spare.dispose(); this.material.dispose(); this.quad.dispose();
  }
}
