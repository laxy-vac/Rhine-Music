import * as THREE from "three";
import { MUSIC_MODEL } from "./music-model.ts";
import type { CaseLayout } from "./case-layout";
import { ThemeTransition } from "./theme-transition.ts";

/** The original side key, fixed to each layout's window instead of its album. */
export class MusicSelectionLighting {
  readonly source = new THREE.SpotLight("#ffe3b2", 180 * 64 * 0.7, 0, 0.32, 0.95, 2);
  private quality: "basic" | "high" | "full" = "high";
  private readonly bounce = new THREE.PointLight("#ffe3b2", .24, 5, 2);
  private layout?: CaseLayout;
  private readonly column = { value: new THREE.Vector3() };
  private readonly scatterColor = { value: new THREE.Color("#ffdba3") };
  private readonly scatterStrength = { value: 1 };
  private readonly printAmbient = { value: 0.5 };
  private readonly shellBounds = { value: new THREE.Vector4(
    MUSIC_MODEL.center.x - MUSIC_MODEL.width / 2,
    MUSIC_MODEL.center.y - MUSIC_MODEL.height / 2,
    MUSIC_MODEL.center.y + MUSIC_MODEL.height / 2,
    1 / MUSIC_MODEL.height,
  ) };
  private readonly edgeFalloff = { value: new THREE.Vector2(1.7, 24) };

  private readonly aim = new THREE.Vector3();
  private readonly arrayOffset = this.windowOffset(-38, 35);
  private readonly matrixOffset = this.windowOffset(59, 25);
  private readonly arrayBounce = this.windowOffset(-38, 35, new THREE.Vector3(0, -.25, .28));
  private readonly matrixBounce = this.windowOffset(59, 25, new THREE.Vector3(0, -.25, .28));
  private progress = -1;
  private transformUpdates = 0;

  constructor(private readonly scene: THREE.Scene) {
    this.source.name = "Fixed selection window key";
    this.source.castShadow = false;
    this.source.visible = false;
    // Preserve the original independent directional/contact-shadow rig.
    this.bounce.name = "Fixed window reflected fill";
    this.bounce.visible = false;
    scene.add(this.source, this.source.target, this.bounce);
  }

  private windowOffset(yawDegrees: number, elevationDegrees: number, local = new THREE.Vector3(-48, -17.6, 36)) {
    const yaw = THREE.MathUtils.degToRad(yawDegrees);
    const elevation = THREE.MathUtils.degToRad(elevationDegrees);
    const view = new THREE.Vector3(-Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation), Math.cos(yaw) * Math.cos(elevation));
    const right = new THREE.Vector3().crossVectors(THREE.Object3D.DEFAULT_UP, view).normalize();
    const up = new THREE.Vector3().crossVectors(view, right).normalize();
    // Original camera-local (-6, -2.2, 4.5) * 8, evaluated against the
    // authored resting view once. Never rotate with navigation/parallax.
    return view.multiplyScalar(local.z).addScaledVector(up, local.y).addScaledVector(right, local.x);
  }

  /** q changes only during ARRAY/MATRIX conversion. Never pass a live model or camera. */
  setWindow(q: number, origin: THREE.Vector3, layout: CaseLayout) {
    const progress = THREE.MathUtils.clamp(q, 0, 1);
    if (progress === this.progress && this.column.value.equals(origin) && this.layout === layout) return;
    this.progress = progress;
    this.layout = layout;
    this.column.value.copy(origin);
    this.aim.set(layout.bounds.min[0] + .14, layout.center.y + layout.height * .12, layout.center.z).add(origin);
    this.shellBounds.value.set(layout.bounds.min[0], layout.bounds.min[1], layout.bounds.max[1], 1 / Math.max(.01, layout.height));
    this.source.position.copy(this.arrayOffset).lerp(this.matrixOffset, progress)
      .setLength(this.arrayOffset.length()).add(this.aim);
    this.source.target.position.copy(this.aim);
    this.bounce.position.copy(this.arrayBounce).lerp(this.matrixBounce, progress)
      .setLength(this.arrayBounce.length()).add(this.aim);
    this.transformUpdates++;
  }

  // All quality levels share the same source; no moving local fill is added.
  setQuality(quality: "basic" | "high" | "full") { this.quality = quality; }

  setTheme(theme: "day" | "night" | "dusk", key: THREE.DirectionalLight, transition?: ThemeTransition) {
    const night = theme === "night";
    const targets = transition ?? new ThemeTransition();
    targets.number(this.scene, "environmentIntensity", night ? 0.20 : 0.28);
    targets.number(key, "intensity", night ? 0.30 : 0.45);
    for (const child of this.scene.children) {
      if (child instanceof THREE.HemisphereLight) targets.number(child, "intensity", night ? 0.30 : 0.45);
      if (child instanceof THREE.DirectionalLight && child !== key) targets.number(child, "intensity", night ? 0.04 : 0.06);
    }
    targets.color(this.source.color, night ? "#dbe9ff" : "#ffe3b2");
    targets.number(this.source, "intensity", (night ? 130 : 180) * 64 * 0.7);
    targets.color(this.bounce.color, night ? "#dbe9ff" : "#ffe3b2");
    targets.color(this.scatterColor.value, night ? "#cee5ff" : "#ffdba3");
    targets.number(this.scatterStrength, "value", night ? .72 : 1);
    targets.number(this.printAmbient, "value", night ? .12 : theme === "dusk" ? .38 : .5);
    if (!transition) targets.finish();
  }

  /** Diffuse printed art shares the fixed window field, never the shell's glow.
   * All ownership states use world transforms, so changing instance/mesh cannot
   * change the exposure; extraction and return pass continuously through it.
   */
  shadePrint(shader: THREE.WebGLProgramParametersWithUniforms) {
    shader.uniforms.musicPrintLightColumn = this.column;
    shader.uniforms.musicPrintAmbient = this.printAmbient;
    shader.vertexShader = "varying vec3 vMusicPrintOrigin;\n" + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vec4 musicPrintOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        musicPrintOrigin = instanceMatrix * musicPrintOrigin;
      #endif
      vMusicPrintOrigin = (modelMatrix * musicPrintOrigin).xyz;
    `);
    shader.fragmentShader = `
      varying vec3 vMusicPrintOrigin;
      uniform vec3 musicPrintLightColumn;
      uniform float musicPrintAmbient;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      // The low local key reaches nearby rows/lanes; the stacked shelf shelters
      // the rest. The lifted cover stays in the light while its neighbors fall
      // below it. This attenuation only removes diffuse light, never adds white.
      vec3 printDistance = (vMusicPrintOrigin - musicPrintLightColumn) / vec3(6.0, 3.35, 5.5);
      float printLight = exp(-dot(printDistance, printDistance));
      outgoingLight *= mix(musicPrintAmbient, 1.0, printLight);
      #include <opaque_fragment>
    `);
  }

  /** Shared by instances, the lifted CD and returning copies; no extra render pass.
   * WebGL transmission cannot propagate light between glass layers. This bounded
   * scattering term approximates that transport from the spine into the panel.
   */
  shade(shader: THREE.WebGLProgramParametersWithUniforms, surface: string, material?: THREE.MeshPhysicalMaterial) {
    // Covers are independent surface prints. Keep this guard even when a
    // caller accidentally registers them with the shell lighting controller.
    if (surface === "Album_Print") return;
    shader.uniforms.musicLightColumn = this.column;
    shader.uniforms.musicScatterColor = this.scatterColor;
    shader.uniforms.musicScatterStrength = this.scatterStrength;
    const optical = { value: 1 };
    if (material) Object.defineProperty(optical, "value", { get: () => material.transmission });
    shader.uniforms.musicOpticalScatter = optical;
    const fidelity = { value: this.quality === "basic" ? 0 : 0.25 };
    // Read the chosen fidelity without replacing compiled materials.
    Object.defineProperty(fidelity, "value", { get: () => this.quality === "basic" ? 0 : 0.25 });
    shader.uniforms.musicScatterFidelity = fidelity;
    shader.uniforms.musicShellBounds = this.shellBounds;
    shader.uniforms.musicEdgeFalloff = this.edgeFalloff;
    const declarations = `
      varying vec3 vMusicLocal;
      varying vec3 vMusicOrigin;
    `;
    shader.vertexShader = declarations + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `
      #include <begin_vertex>
      vMusicLocal = position;
      vec4 musicOrigin = vec4(0.0, 0.0, 0.0, 1.0);
      #ifdef USE_INSTANCING
        musicOrigin = instanceMatrix * musicOrigin;
      #endif
      vMusicOrigin = (modelMatrix * musicOrigin).xyz;
    `);
    shader.fragmentShader = declarations + `
      uniform vec3 musicLightColumn;
      uniform vec3 musicScatterColor;
      uniform float musicScatterStrength;
      uniform float musicOpticalScatter;
      uniform float musicScatterFidelity;
      // left X, bottom Y, top Y, inverse height — shared with the real shell.
      uniform vec4 musicShellBounds;
      uniform vec2 musicEdgeFalloff;
    ` + shader.fragmentShader;
    const glass = surface === "Frosted_Polymer";
    const spine = surface === "Ivory_Edges";
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
      float laneDistance = abs(vMusicOrigin.x - musicLightColumn.x);
      float laneRadius = laneDistance / 3.2;
      float coreLight = exp(-laneRadius * laneRadius * laneRadius * laneRadius);
      float spillRadius = laneDistance / 7.2;
      float spillLight = exp(-spillRadius * spillRadius * spillRadius * spillRadius);
      // Both neighboring genre columns receive a broad, weaker wash. Two lanes
      // away it has almost vanished; only nearby rows carry the cross-shelf band.
      float laneLight = 0.58 * coreLight + 0.42 * spillLight;
      float rowDistance = (vMusicOrigin.z - musicLightColumn.z) / 5.5;
      float rowLight = exp(-rowDistance * rowDistance);
      float hotDistance = (vMusicOrigin.z - musicLightColumn.z) / 1.1;
      float hotLight = exp(-hotDistance * hotDistance);
      // The reference has a warm local ribbon, not uniformly glowing spines.
      float neighborDistance = (vMusicOrigin.z - musicLightColumn.z) / 2.4;
      float neighborLight = exp(-neighborDistance * neighborDistance);
      float guidedLight = 0.58 * coreLight * mix(0.12, 1.0, rowLight)
                        + 0.42 * spillLight * neighborLight;
      outgoingLight *= mix(0.96, 1.04, guidedLight);
      ${glass || spine ? `
        float fromSpine = max(0.0, vMusicLocal.x - musicShellBounds.x);
        float edgeTransport = exp(-fromSpine * musicEdgeFalloff.x);
        float panelHeight = clamp((vMusicLocal.y - musicShellBounds.y) * musicShellBounds.w, 0.0, 1.0);
        float lowerLight = mix(1.0, 0.62, panelHeight);
        float topRim = exp(-max(0.0, musicShellBounds.z - vMusicLocal.y) * musicEdgeFalloff.y);
        float grazing = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
        float edgeScatter = ${spine ? '0.30' : '0.14'} * edgeTransport + ${spine ? '0.016' : '0.003'};
        outgoingLight += musicScatterColor * musicScatterStrength * guidedLight * edgeScatter * lowerLight * musicOpticalScatter;
        // A narrow glint at the top and the lit spine changes with viewing angle.
        // Warm light stays on the glass; the independent cover has no such term.
        float ribbon = topRim * (0.22 + 0.78 * edgeTransport) + ${spine ? '0.18' : '0.035'} * edgeTransport * grazing;
        outgoingLight += musicScatterColor * musicScatterStrength * laneLight * hotLight * ribbon * 0.8 * musicScatterFidelity * musicOpticalScatter;
      ` : ''}
      #include <opaque_fragment>
    `);
  }

  update(visible: boolean) {
    this.source.visible = visible;
    this.bounce.visible = visible && this.quality === "full";
  }

  get state() {
    return {
      visible: this.source.visible, type: this.source.type,
      position: this.source.position.toArray(), target: this.aim.toArray(),
      layoutProgress: this.progress, transformUpdates: this.transformUpdates,
      fixedTo: "selection-window",
      reflection: "prefiltered-softbox",
      fillVisible: this.bounce.visible, fillPosition: this.bounce.position.toArray(),
    };
  }
}
