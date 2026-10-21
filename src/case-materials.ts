import * as THREE from "three";
import type { CaseRect } from "./case-layout";
import { caseAlbumOcclusionGLSL, caseAlbumOcclusionApplyGLSL } from "./case-album-occlusion";
import type {
  CaseAppearance,
  CasePart,
  CaseSurface,
  CaseTransform,
} from "./case-settings";

type Physical = THREE.MeshPhysicalMaterial;
type Shader = Parameters<Physical["onBeforeCompile"]>[0];
type PatternState = {
  kind: { value: number };
  secondary: { value: THREE.Color };
  direction: { value: THREE.Vector2 };
  frost: { value: number };
  window: { value: THREE.Vector4 };
  album: { value: THREE.Vector4 };
  albumDepth: { value: number };
  albumPresent: { value: number };
  tubeTransmission: { value: number };
  tubeIor: { value: number };
  insetWindow: { value: number };
  insetTransmission: { value: number };
  insetOutsideTransmission: { value: number };
  insetThickness: { value: number };
  wrapped: Physical["onBeforeCompile"];
};
const patterns = new WeakMap<Physical, PatternState>();
const baseGeometry = new WeakMap<
  THREE.BufferGeometry,
  {
    position: THREE.BufferAttribute;
    normal?: THREE.BufferAttribute;
    tangent?: THREE.BufferAttribute;
    bounds: THREE.Box3;
    key: string;
  }
>();
const kinds: Record<string, number> = {
  none: 0,
  marble: 1,
  carbon: 2,
  gradient: 3,
  brushed: 4,
};
const identity: CaseTransform = {
  visible: true,
  offset: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

function geometryBase(geometry: THREE.BufferGeometry) {
  let base = baseGeometry.get(geometry);
  if (!base) {
    // Editable finishes can enable anisotropy after glTF loading. Preserve an
    // explicit, transformable tangent basis for their directional reflections.
    if (!geometry.hasAttribute("tangent") && geometry.hasAttribute("normal")) {
      if (geometry.userData.caseProceduralTangents) {
        // The brushed grain uses model coordinates, not the cube's UV islands.
        // A continuous orthonormal basis avoids tangent reversals on bevels.
        const normal = geometry.getAttribute("normal");
        const values = new Float32Array(normal.count * 4);
        const n = new THREE.Vector3();
        for (let i = 0; i < normal.count; i++) {
          n.fromBufferAttribute(normal, i).normalize();
          const sign = n.z >= 0 ? 1 : -1;
          const a = -1 / (sign + n.z);
          values.set([1 + sign * n.x * n.x * a, sign * n.x * n.y * a, -sign * n.x, 1], i * 4);
        }
        geometry.setAttribute("tangent", new THREE.BufferAttribute(values, 4));
      } else if (geometry.index && geometry.hasAttribute("uv")) geometry.computeTangents();
    }
    const position = geometry
      .getAttribute("position")
      .clone() as THREE.BufferAttribute;
    geometry.computeBoundingBox();
    base = {
      position,
      normal: geometry.getAttribute("normal")?.clone() as
        THREE.BufferAttribute | undefined,
      tangent: geometry.getAttribute("tangent")?.clone() as
        THREE.BufferAttribute | undefined,
      bounds: geometry.boundingBox!.clone(),
      key: "",
    };
    geometry.setAttribute("caseRestPosition", position.clone());
    baseGeometry.set(geometry, base);
  }
  return base;
}

function rememberNative(material: Physical) {
  const n = (material.userData.caseNative ??= {
    color: `#${material.color.getHexString()}`,
    roughness: material.roughness,
    metalness: material.metalness,
    transmission: material.transmission,
    thickness: material.thickness,
    ior: material.ior,
    attenuationColor: `#${material.attenuationColor.getHexString()}`,
    attenuationDistance: material.attenuationDistance,
    emissive: `#${material.emissive.getHexString()}`,
    emissiveIntensity: material.emissiveIntensity,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
    iridescence: material.iridescence,
  });
  n.transparent ??= material.transparent;
  n.opacity ??= material.opacity;
  n.alphaTest ??= material.alphaTest;
  n.side ??= material.side;
  n.depthWrite ??= material.depthWrite;
  n.anisotropy ??= material.anisotropy;
  n.iridescenceIOR ??= material.iridescenceIOR;
  n.iridescenceThicknessRange ??= [...material.iridescenceThicknessRange];
  return n;
}

function restoreNative(material: Physical) {
  const n = rememberNative(material);
  for (const key of ["color", "attenuationColor", "emissive"] as const)
    if (typeof n[key] === "string") material[key].set(n[key]);
  for (const key of [
    "roughness",
    "metalness",
    "transmission",
    "thickness",
    "ior",
    "emissiveIntensity",
    "clearcoat",
    "clearcoatRoughness",
    "iridescence",
    "opacity",
    "alphaTest",
    "anisotropy",
    "iridescenceIOR",
  ] as const)
    if (Number.isFinite(n[key])) material[key] = n[key];
  material.attenuationDistance =
    Number.isFinite(n.attenuationDistance) && n.attenuationDistance > 0
      ? n.attenuationDistance
      : Infinity;
  material.transparent = n.transparent === true;
  material.side = n.side ?? material.side;
  material.depthWrite = n.depthWrite ?? true;
  material.iridescenceThicknessRange = [...n.iridescenceThicknessRange] as [
    number,
    number,
  ];
}

function patternShader(material: Physical, surface: CaseSurface, window?: CaseRect, album?: CaseRect, albumPresent = false, albumDepthOffset = 0, thinTube = false, insetWindow = false, insetThickness = .03, insetOutsideTransmission = material.transmission) {
  let state = patterns.get(material);
  if (!state || state.wrapped !== material.onBeforeCompile) {
    const prior = material.onBeforeCompile;
    const priorKey = material.customProgramCacheKey.bind(material);
    const next = {
      kind: { value: 0 },
      secondary: { value: new THREE.Color() },
      direction: { value: new THREE.Vector2(0, 1) },
      frost: { value: 0 },
      window: { value: new THREE.Vector4(0, 0, 0, 0) },
      album: { value: new THREE.Vector4(0, 0, 0, 0) },
      albumDepth: { value: 0 },
      albumPresent: { value: 0 },
      tubeTransmission: { value: 0 },
      tubeIor: { value: 1.46 },
      insetWindow: { value: 0 },
      insetTransmission: { value: .98 },
      insetOutsideTransmission: { value: 0 },
      insetThickness: { value: .03 },
      wrapped: undefined!,
    } as unknown as PatternState;
    next.wrapped = (shader: Shader, renderer: THREE.WebGLRenderer) => {
      prior.call(material, shader, renderer);
      shader.uniforms.casePatternKind = next.kind;
      shader.uniforms.casePatternSecondary = next.secondary;
      shader.uniforms.caseGradientDirection = next.direction;
      shader.uniforms.caseWindowFrost = next.frost;
      shader.uniforms.caseArtworkWindow = next.window;
      shader.uniforms.caseAlbumRect = next.album;
      shader.uniforms.caseAlbumDepth = next.albumDepth;
      shader.uniforms.caseAlbumPresent = next.albumPresent;
      shader.uniforms.caseTubeTransmission = next.tubeTransmission;
      shader.uniforms.caseTubeIor = next.tubeIor;
      shader.uniforms.caseInsetWindow = next.insetWindow;
      shader.uniforms.caseInsetTransmission = next.insetTransmission;
      shader.uniforms.caseInsetOutsideTransmission = next.insetOutsideTransmission;
      shader.uniforms.caseInsetThickness = next.insetThickness;
      shader.vertexShader =
        "attribute vec3 caseRestPosition;\nvarying vec3 vCaseRest;\nvarying vec3 vCaseGeometryPosition;\nvarying vec3 vCaseGeometryNormal;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvCaseRest = caseRestPosition;\nvCaseGeometryPosition = position;\nvCaseGeometryNormal = normal;",
      );
      shader.fragmentShader =
        `
varying vec3 vCaseRest;
uniform float casePatternKind;
uniform vec3 casePatternSecondary;
uniform vec2 caseGradientDirection;
uniform float caseWindowFrost;
uniform vec4 caseArtworkWindow;
uniform float caseTubeTransmission;
uniform float caseTubeIor;
uniform float caseInsetWindow;
uniform float caseInsetTransmission;
uniform float caseInsetOutsideTransmission;
uniform float caseInsetThickness;
float caseHash(vec3 p) { return fract(sin(dot(p,vec3(17.17,73.71,39.23)))*43758.5453); }
float caseNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(caseHash(i),caseHash(i+vec3(1,0,0)),f.x),mix(caseHash(i+vec3(0,1,0)),caseHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(caseHash(i+vec3(0,0,1)),caseHash(i+vec3(1,0,1)),f.x),mix(caseHash(i+vec3(0,1,1)),caseHash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
` + caseAlbumOcclusionGLSL + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
if (casePatternKind > 0.5 && casePatternKind < 1.5) {
  vec3 p=vCaseRest*3.0;
  float turbulence=caseNoise(p)*1.8+caseNoise(p*2.7)*.36+caseNoise(p*7.0)*.12;
  float vein=pow(.5+.5*sin((p.x*.65+p.y*.92+turbulence)*3.6),14.0);
  diffuseColor.rgb=mix(diffuseColor.rgb,casePatternSecondary,vein*.7+caseNoise(p*3.0)*.08);
} else if(casePatternKind < 2.5 && casePatternKind > 1.5) {
  vec2 uv=vec2(vCaseRest.x+vCaseRest.y,vCaseRest.y-vCaseRest.x)*38.0;
  float cell=mod(floor(uv.x)+floor(uv.y),2.0);
  float fiber=.5+.5*sin(mix(uv.x,uv.y,cell)*18.849556);
  diffuseColor.rgb=mix(diffuseColor.rgb,casePatternSecondary,.22+fiber*.24+cell*.14);
} else if(casePatternKind < 3.5 && casePatternKind > 2.5) {
  vec2 gradientPosition=(vCaseRest.xy-vec2(0.0,1.85))/vec2(3.83,3.35);
  float gradientMix=clamp(.5+dot(gradientPosition,caseGradientDirection),0.0,1.0);
  diffuseColor.rgb=mix(diffuseColor.rgb,casePatternSecondary,gradientMix);
} else if(casePatternKind > 3.5) {
  float grain=caseNoise(vec3(vCaseRest.x*210.0,vCaseRest.y*1.8,vCaseRest.z*4.0));
  diffuseColor.rgb=mix(diffuseColor.rgb,casePatternSecondary,grain*.24);
}
float caseWindowMask=step(caseArtworkWindow.x,vCaseRest.x)*step(vCaseRest.x,caseArtworkWindow.z)*step(caseArtworkWindow.y,vCaseRest.y)*step(vCaseRest.y,caseArtworkWindow.w);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(1.0),caseInsetWindow*caseWindowMask);
vec3 caseOpticalTint=diffuseColor.rgb;
float caseFrostAmount=caseWindowFrost*caseWindowMask;
`,
      );
      shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,min(roughnessFactor,.045),caseInsetWindow*caseWindowMask*(1.0-caseWindowFrost));\nroughnessFactor=mix(roughnessFactor,max(roughnessFactor,.64),caseFrostAmount);");
      shader.fragmentShader = shader.fragmentShader.replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,0.0,caseInsetWindow*caseWindowMask);");
      shader.fragmentShader = shader.fragmentShader.replace("#include <aomap_fragment>",
        "#include <aomap_fragment>\n" + caseAlbumOcclusionApplyGLSL);
      // A subpixel filament inside a clear hose cannot survive the renderer's
      // blurred screen-space volume buffer. Render its thin wall as a lit,
      // Fresnel-weighted transparent surface over the real opaque inner core.
      // White sleeves retain their depth, so they still occlude the filament.
      shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `
if(caseTubeTransmission>0.0) {
  float tubeF0=pow((caseTubeIor-1.0)/(caseTubeIor+1.0),2.0);
  float tubeFacing=saturate(dot(geometryNormal,geometryViewDir));
  float tubeFresnel=tubeF0+(1.0-tubeF0)*pow(1.0-tubeFacing,5.0);
  diffuseColor.a*=1.0-caseTubeTransmission*(1.0-tubeFresnel);
}
#include <opaque_fragment>`);
      // The installed anisotropic visibility function lacks the zero-denominator
      // guard used by its isotropic counterpart. A grazing face with both N.L
      // and N.V clamped to zero otherwise contributes 0 * Infinity (black NaN).
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_pars_fragment>",
        THREE.ShaderChunk.lights_physical_pars_fragment.replace(
          "float v = 0.5 / ( gv + gl );", "float v = 0.5 / max( gv + gl, EPSILON );"));
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_fragment>", THREE.ShaderChunk.lights_physical_fragment.replace(
        "material.iridescenceThickness = iridescenceThicknessMaximum;",
        "material.iridescenceThickness = iridescenceThicknessMaximum;\nif(casePatternKind>2.5&&casePatternKind<3.5){vec2 p=(vCaseRest.xy-vec2(0.0,1.85))/vec2(3.83,3.35);material.iridescenceThickness=mix(iridescenceThicknessMinimum,iridescenceThicknessMaximum,clamp(.5+dot(p,caseGradientDirection),0.0,1.0));}",
      ));
      shader.fragmentShader = shader.fragmentShader.replace("#include <transmission_fragment>", THREE.ShaderChunk.transmission_fragment
        .replace("material.transmission = transmission;", "material.transmission = mix(transmission,caseInsetOutsideTransmission,caseInsetWindow);\nmaterial.transmission = mix(material.transmission,caseInsetTransmission,caseInsetWindow*caseWindowMask);\nmaterial.transmission = mix(material.transmission,min(material.transmission,.38),caseFrostAmount);")
        .replace("material.thickness = thickness;", "material.thickness = mix(thickness,min(thickness,caseInsetThickness),caseInsetWindow*caseWindowMask);")
        .replace("material.attenuationColor = attenuationColor;", "material.attenuationColor = attenuationColor;\nif(casePatternKind>2.5&&casePatternKind<3.5)material.attenuationColor=max(caseOpticalTint,vec3(.001));"));
    };
    material.onBeforeCompile = next.wrapped;
    material.customProgramCacheKey = () => `${priorKey()}-case-optics-v5-pattern-inset-window-safe-anisotropy-card-visibility-thin-tube`;
    patterns.set(material, next);
    state = next;
  }
  state.kind.value = surface.preserveSource
    ? 0
    : (kinds[surface.pattern ?? "none"] ?? 0);
  state.secondary.value.set(surface.secondaryColor ?? surface.color);
  const angle = THREE.MathUtils.degToRad(surface.gradientAngle ?? 90);
  state.direction.value.set(Math.cos(angle), Math.sin(angle));
  state.frost.value = 0;
  state.window.value.set(window ? window.x-window.width/2 : 0, window ? window.y-window.height/2 : 0,
    window ? window.x+window.width/2 : 0, window ? window.y+window.height/2 : 0);
  state.album.value.set(album ? album.x-album.width/2 : 0, album ? album.y-album.height/2 : 0,
    album ? album.x+album.width/2 : 0, album ? album.y+album.height/2 : 0);
  state.albumDepth.value = (album?.z ?? 0) + albumDepthOffset;
  state.albumPresent.value = album && albumPresent ? 1 : 0;
  state.tubeTransmission.value = thinTube ? surface.transmission : 0;
  state.tubeIor.value = surface.ior;
  state.insetWindow.value = insetWindow ? 1 : 0;
  state.insetTransmission.value = surface.transmissionOverride ?? .98;
  state.insetOutsideTransmission.value = insetOutsideTransmission;
  state.insetThickness.value = insetThickness;
}

/** Keep indirect occlusion synchronized with the actual visible paper card. */
export function setCaseAlbumOcclusion(root: THREE.Object3D, present: boolean, depthOffset = 0) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.caseAlbumWindow) return;
    object.userData.caseAlbumPresent = present;
    object.userData.caseAlbumDepthOffset = depthOffset;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
      const state = patterns.get(material);
      if (state) {
        state.albumPresent.value = present ? 1 : 0;
        state.albumDepth.value = object.userData.caseAlbumWindow.z + depthOffset;
      }
    }
  });
}

/** The source uses a diffusing album window while the information glass stays clear. */
export function setCaseGlassFrost(root: THREE.Object3D, amount: number) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !object.userData.caseGlassWindow) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (material instanceof THREE.MeshPhysicalMaterial) {
        const state = patterns.get(material);
        if (state) state.frost.value = THREE.MathUtils.clamp(amount, 0, 1);
      }
  });
}

/** Build a part-local transform around its saved pivot. */
function casePartTransformMatrix(transform: CaseTransform, pivot: THREE.Vector3): THREE.Matrix4 {
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(
      ...(transform.rotation.map(THREE.MathUtils.degToRad) as [
        number,
        number,
        number,
      ]),
    ),
  );
  const matrix = new THREE.Matrix4().makeTranslation(
    -pivot.x,
    -pivot.y,
    -pivot.z,
  );
  matrix.premultiply(
    new THREE.Matrix4().compose(
      new THREE.Vector3(),
      quaternion,
      new THREE.Vector3(...transform.scale),
    ),
  );
  matrix.premultiply(
    new THREE.Matrix4().makeTranslation(
      pivot.x + transform.offset[0],
      pivot.y + transform.offset[1],
      pivot.z + transform.offset[2],
    ),
  );
  return matrix;
}

function applyTransform(
  geometry: THREE.BufferGeometry,
  transform: CaseTransform,
  pivot: THREE.Vector3,
) {
  const base = geometryBase(geometry);
  const key = JSON.stringify([transform.offset, transform.rotation, transform.scale, pivot.toArray()]);
  if (base.key === key) return;
  base.key = key;
  const matrix = casePartTransformMatrix(transform, pivot);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const point = new THREE.Vector3();
  for (let i = 0; i < base.position.count; i++) {
    point.fromBufferAttribute(base.position, i).applyMatrix4(matrix);
    position.setXYZ(i, point.x, point.y, point.z);
  }
  position.needsUpdate = true;
  if (base.normal && geometry.getAttribute("normal")) {
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    for (let i = 0; i < base.normal.count; i++) {
      point
        .fromBufferAttribute(base.normal, i)
        .applyMatrix3(normalMatrix)
        .normalize();
      normal.setXYZ(i, point.x, point.y, point.z);
    }
    normal.needsUpdate = true;
  }
  if (base.tangent && geometry.getAttribute("tangent")) {
    const tangent = geometry.getAttribute("tangent") as THREE.BufferAttribute;
    const normal = geometry.getAttribute("normal");
    const linear = new THREE.Matrix3().setFromMatrix4(matrix);
    const perpendicular = new THREE.Vector3();
    for (let i = 0; i < base.tangent.count; i++) {
      point.fromBufferAttribute(base.tangent, i).applyMatrix3(linear);
      if (normal) {
        perpendicular.fromBufferAttribute(normal, i);
        point.addScaledVector(perpendicular, -point.dot(perpendicular));
      }
      point.normalize();
      tangent.setXYZW(i, point.x, point.y, point.z, base.tangent.getW(i));
    }
    tangent.needsUpdate = true;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function applyCaseMaterials(
  root: THREE.Object3D,
  appearance: CaseAppearance,
) {
  const bounds = new Map<CasePart, THREE.Box3>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.casePart) return;
    const part = object.userData.casePart as CasePart;
    const base = geometryBase(object.geometry);
    const box = bounds.get(part) ?? new THREE.Box3();
    box.union(base.bounds);
    bounds.set(part, box);
  });
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.userData.casePart) return;
    const part = object.userData.casePart as CasePart,
      surface = appearance.surfaces[part];
    if (!surface) return;
    const transform = appearance.transforms?.[part] ?? identity;
    // Array instances and returning shells share geometry with the full model.
    // Keep its aggregate part pivot when a caller visits one mesh at a time.
    const pivot = object.geometry.userData.casePartPivot
      ? new THREE.Vector3().fromArray(object.geometry.userData.casePartPivot)
      : bounds.get(part)!.getCenter(new THREE.Vector3());
    object.geometry.userData.casePartPivot ??= pivot.toArray();
    applyTransform(object.geometry, transform, pivot);
    for (const m of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      if (!(m instanceof THREE.MeshPhysicalMaterial)) {
        // Printed archive labels retain their unlit material, including on
        // returning snapshots, while following the physical plaque's visibility.
        if (object.userData.rhineAlbumInfo && object.userData.role === "label") m.visible = transform.visible;
        continue;
      }
      rememberNative(m);
      const thinTube = object.userData.caseThinWallTube === true && !surface.preserveSource &&
        surface.transmission > 0 && (surface.finish === "glass" || surface.finish === "frost");
      if (surface.preserveSource) restoreNative(m);
      else {
        const transmits =
          surface.finish === "glass" || surface.finish === "frost";
        m.color.set(surface.color);
        m.roughness = surface.roughness;
        m.metalness =
          surface.metalness ??
          (surface.finish === "metal"
            ? 0.86
            : surface.finish === "paint"
              ? 0.04
              : 0);
        m.transmission = transmits && !thinTube ? surface.transmission : 0;
        m.ior = surface.ior;
        m.thickness =
          surface.thickness ??
          Math.max(
            0.008,
            geometryBase(object.geometry).bounds.getSize(new THREE.Vector3()).z,
          );
        m.attenuationColor.set(surface.color);
        m.attenuationDistance = surface.attenuationDistance ?? 4.5;
        m.clearcoat = surface.clearcoat ?? 0.16;
        // A polished coat can retain a sharp reflection above a rough base.
        // Older custom surfaces keep their previous coupled value.
        m.clearcoatRoughness = surface.clearcoatRoughness ?? surface.roughness;
        m.iridescence = surface.iridescence ?? 0;
        m.iridescenceIOR = 1.35;
        m.iridescenceThicknessRange = [100, 500];
        m.anisotropy = surface.pattern === "brushed" && object.geometry.hasAttribute("tangent") ? 0.12 : 0;
        m.emissive.set(surface.color);
        m.emissiveIntensity = surface.emission;
        m.transparent = thinTube;
        m.depthWrite = thinTube ? false : rememberNative(m).depthWrite;
        m.side = thinTube ? THREE.FrontSide : rememberNative(m).side;
        m.opacity = 1;
      }
      if (object.userData.caseRhineOptics === true) {
        // Optical sliders layer over the source material, including on instances
        // and outgoing copies. They must not replace its colour or PBR finish.
        if (!surface.preserveSource) m.alphaTest = rememberNative(m).alphaTest;
        if (Number.isFinite(surface.transmissionOverride))
          m.transmission = Math.max(0, Math.min(1, surface.transmissionOverride!));
        if (Number.isFinite(surface.opacityOverride)) {
          m.opacity = Math.max(0, Math.min(1, surface.opacityOverride!));
          if (m.opacity < 1) {
            m.transparent = true;
            m.depthWrite = false;
            m.alphaTest = 0;
          }
        }
      }
      const insetWindow = object.userData.caseRhineAlbumWindow === true;
      const outsideTransmission = m.transmission;
      // Legacy custom coatings may be opaque. Keep that finish outside the
      // aperture, while enabling the shader branch for its new clear window.
      if (insetWindow && !Number.isFinite(surface.transmissionOverride) && m.transmission === 0) m.transmission = .00001;
      m.userData.caseTransmissionMode = thinTube ? "thin-wall" : "volume";
      m.userData.caseTubeTransmission = thinTube ? surface.transmission : 0;
      m.visible = transform.visible;
      patternShader(m, surface, object.userData.caseGlassWindow, object.userData.caseAlbumWindow,
        object.userData.caseAlbumPresent === true, object.userData.caseAlbumDepthOffset ?? 0, thinTube,
        insetWindow, object.userData.caseRhineWindowThickness ?? .03, outsideTransmission);
      m.needsUpdate = true;
    }
    if (object.userData.caseRhineOptics === true) {
      object.userData.caseBaseCastShadow ??= object.castShadow;
      object.castShadow = object.userData.caseBaseCastShadow &&
        (Array.isArray(object.material) ? object.material : [object.material])
          .some(material => material.visible && material.opacity > 0);
    }
    if (object.userData.caseLayeredGlass) {
      // A stock shadow map treats transmitting glass as opaque. Let the
      // mounted labels/rails cast onto the inlay, without blacking it out
      // behind the continuous front pane.
      object.castShadow = part !== "cover" && (Array.isArray(object.material) ? object.material : [object.material])
        .some(material => material.visible && (!(material instanceof THREE.MeshPhysicalMaterial) ||
          (material.transmission < .05 && !(material.userData.caseTubeTransmission > .05))));
      object.receiveShadow = part !== "cover";
    }
  });
}
