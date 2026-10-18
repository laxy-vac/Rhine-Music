import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as THREE from "three";
import ts from "typescript";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(project, ".tools", "punk-case-display-2026-10-18");
const reportPath = path.join(outputDirectory, "check-punk-case-display.json");
const GLB_PATH = path.join(project, "public", "assets", "punk-reference-case.glb");
const ASSET_VERSION_PATH = path.join(project, "src", "punk-case-asset.ts");
const DISPLAY_PATH = path.join(project, "src", "punk-case-display.ts");
const TITLES_PATH = path.join(project, "src", "music-case-titles.ts");
const MATERIALS_PATH = path.join(project, "src", "case-materials.ts");
const DEPLOYMENT_PATH = path.join(project, "src", "music-shelf-deployment.ts");
const MUSIC_MODEL_PATH = path.join(project, "src", "music-model.ts");
const BUILDER_PATH = path.join(project, "art", "build_punk_reference_case.py");
const REFERENCE_HEIGHT = 3.5;
const COVER_BEVEL_MARGIN_SOURCE = 0.01;
const GEOMETRY_TOLERANCE = 1e-4;

const checks = [];
const errors = [];
const round = (value, places = 6) => Number(Number(value).toFixed(places));
const near = (left, right, tolerance = GEOMETRY_TOLERANCE) =>
  Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;

function check(name, ok, details = null) {
  const result = { name, ok: Boolean(ok) };
  if (details !== null) result.details = details;
  checks.push(result);
  if (!ok) errors.push(result);
  return Boolean(ok);
}

function glbDocument(bytes) {
  check("GLB magic is glTF", bytes.toString("ascii", 0, 4) === "glTF");
  check("GLB version is 2", bytes.length >= 12 && bytes.readUInt32LE(4) === 2);
  check("GLB declared length matches file", bytes.length >= 12 && bytes.readUInt32LE(8) === bytes.length,
    { declared: bytes.length >= 12 ? bytes.readUInt32LE(8) : null, actual: bytes.length });
  if (bytes.length < 20) throw new Error("GLB is too short to contain a JSON chunk.");

  let offset = 12;
  let json;
  let binary;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + length;
    if (end > bytes.length) throw new Error("GLB chunk exceeds the file boundary.");
    if (type === 0x4e4f534a) json = JSON.parse(bytes.toString("utf8", start, end).replace(/[\0\s]+$/u, ""));
    if (type === 0x004e4942) binary = bytes.subarray(start, end);
    offset = end;
  }
  if (!json || !binary) throw new Error("GLB must contain JSON and binary chunks.");
  check("GLTF asset version is 2.0", json.asset?.version === "2.0", { version: json.asset?.version ?? null });
  check("Punk asset has no embedded images", (json.images?.length ?? 0) === 0,
    { images: json.images?.length ?? 0 });
  return { json, binary };
}

function namedDeclaration(source, sourcePath, name) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return file.statements.find(statement => {
    if (ts.isFunctionDeclaration(statement)) return statement.name?.text === name;
    return ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration =>
      ts.isIdentifier(declaration.name) && declaration.name.text === name);
  });
}

function executeDeclaration(source, sourcePath, name, ambient = {}) {
  const statement = namedDeclaration(source, sourcePath, name);
  if (!statement) throw new Error(`Could not find ${name} in ${sourcePath}.`);
  const compiled = ts.transpileModule(statement.getText(), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...ambient, exports: module.exports, require: ambient.require ?? (() => {
    throw new Error(`Unexpected import while loading ${name}.`);
  }) }, { filename: sourcePath });
  const fn = module.exports[name];
  if (typeof fn !== "function") throw new Error(`Compiled ${name} did not export a function.`);
  return fn;
}

function executeDisplayModule(source, sourcePath, deploymentStep, casePartTransformMatrix) {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const module = { exports: {} };
  const require = identifier => {
    if (identifier === "three") return THREE;
    if (identifier === "./music-shelf-deployment") return { deploymentStep };
    if (identifier === "./case-materials") return { casePartTransformMatrix };
    throw new Error(`Unexpected import in Punk display helper: ${identifier}`);
  };
  vm.runInNewContext(compiled, { exports: module.exports, require }, { filename: sourcePath });
  return module.exports;
}

function executeClassMethod(source, sourcePath, className, methodName, ambient = {}) {
  const file = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const classDeclaration = file.statements.find(statement =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  const method = classDeclaration?.members.find(member =>
    ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name) && member.name.text === methodName);
  if (!method) throw new Error(`Could not find ${className}.${methodName} in ${sourcePath}.`);
  const wrapper = `class __MethodProbe { ${method.getText(file)} }\nexports.__MethodProbe = __MethodProbe;`;
  const compiled = ts.transpileModule(wrapper, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    fileName: sourcePath,
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...ambient, exports: module.exports }, { filename: sourcePath });
  return module.exports.__MethodProbe.prototype[methodName];
}

function boundsValue(box) {
  return { min: box.min.toArray().map(value => round(value)), max: box.max.toArray().map(value => round(value)) };
}

function collectPartBounds(records, part) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const record of records) if (record.part === part) bounds.union(record.geometry.boundingBox);
  return bounds.isEmpty() ? undefined : bounds;
}

function flatMeshCheck(records) {
  const edgeCounts = new Map();
  let triangleCount = 0;
  const vertexKey = (geometry, index) => {
    const position = geometry.getAttribute("position");
    return [position.getX(index), position.getY(index), position.getZ(index)]
      .map(value => Math.round(value * 1e5)).join(",");
  };
  const addEdge = (left, right) => {
    const key = left < right ? `${left}|${right}` : `${right}|${left}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };

  for (const record of records.filter(item => item.part === "spine")) {
    const geometry = record.geometry;
    const position = geometry.getAttribute("position");
    const index = geometry.index;
    const count = index?.count ?? position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const a = index ? index.getX(offset) : offset;
      const b = index ? index.getX(offset + 1) : offset + 1;
      const c = index ? index.getX(offset + 2) : offset + 2;
      const ka = vertexKey(geometry, a), kb = vertexKey(geometry, b), kc = vertexKey(geometry, c);
      addEdge(ka, kb); addEdge(kb, kc); addEdge(kc, ka);
      triangleCount++;
    }
  }
  const nonTwoSided = [...edgeCounts.values()].filter(count => count !== 2).length;
  return { closed: triangleCount > 0 && nonTwoSided === 0, triangleCount, uniqueEdges: edgeCounts.size, nonTwoSidedEdges: nonTwoSided };
}

function meshNormalSummary(records) {
  const summary = {};
  for (const part of ["frame", "cover", "spine"]) {
    const meshes = records.filter(record => record.part === part);
    let count = 0;
    let finite = true;
    let unit = true;
    let maximumLengthError = 0;
    for (const { geometry } of meshes) {
      const normal = geometry.getAttribute("normal");
      if (!normal) { finite = false; unit = false; continue; }
      for (let index = 0; index < normal.count; index++) {
        const x = normal.getX(index), y = normal.getY(index), z = normal.getZ(index);
        const length = Math.hypot(x, y, z);
        if (!Number.isFinite(length)) finite = false;
        maximumLengthError = Math.max(maximumLengthError, Math.abs(length - 1));
        if (Math.abs(length - 1) > 1e-3) unit = false;
        count++;
      }
    }
    summary[part] = { meshCount: meshes.length, normalCount: count, finite, unit, maximumLengthError: round(maximumLengthError, 8) };
  }
  return summary;
}

function compareBounds(actual, expected, tolerance = 1e-5) {
  return actual.min.distanceTo(expected.min) <= tolerance && actual.max.distanceTo(expected.max) <= tolerance;
}

async function main() {
  const [glb, assetSource, displaySource, titlesSource, materialsSource, deploymentSource, musicModelSource, builderSource] = await Promise.all([
    readFile(GLB_PATH), readFile(ASSET_VERSION_PATH, "utf8"), readFile(DISPLAY_PATH, "utf8"),
    readFile(TITLES_PATH, "utf8"), readFile(MATERIALS_PATH, "utf8"), readFile(DEPLOYMENT_PATH, "utf8"),
    readFile(MUSIC_MODEL_PATH, "utf8"), readFile(BUILDER_PATH, "utf8"),
  ]);
  const sha256 = createHash("sha256").update(glb).digest("hex");
  const urlVersion = /punk-reference-case\.glb\?v=([a-f0-9]{12})/iu.exec(assetSource)?.[1]?.toLowerCase() ?? null;
  check("asset URL cache version matches GLB SHA256 prefix", urlVersion === sha256.slice(0, 12),
    { urlVersion, sha256, expectedVersion: sha256.slice(0, 12) });

  const { json: document } = glbDocument(glb);
  const arrayBuffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  const gltf = await new Promise((resolve, reject) =>
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject));
  const source = gltf.scene;
  source.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(source);

  const modelBlock = /export\s+const\s+MUSIC_MODEL\s*=\s*\{([\s\S]*?)\n\};/u.exec(musicModelSource)?.[1];
  const modelHeight = Number(/\bheight\s*:\s*([\d.]+)/u.exec(modelBlock ?? "")?.[1]);
  const modelCenterY = Number(/\bcenter\s*:\s*\{[^}]*\by\s*:\s*([\d.]+)/u.exec(modelBlock ?? "")?.[1]);
  if (!Number.isFinite(modelHeight) || !Number.isFinite(modelCenterY))
    throw new Error("Could not read the current MUSIC_MODEL height and center from src/music-model.ts.");
  const sourceScale = modelHeight / REFERENCE_HEIGHT;
  const sourceYOffset = modelCenterY - (sourceBounds.min.y + REFERENCE_HEIGHT / 2) * sourceScale;
  const layout = { sourceScale, sourceYOffset, bounds: { min: sourceBounds.min.toArray(), max: sourceBounds.max.toArray() } };

  const records = [];
  const sourcePartObjects = [];
  source.traverse(object => {
    if (object.userData?.casePart) sourcePartObjects.push(object);
    if (!(object instanceof THREE.Mesh)) return;
    let owner = object;
    while (owner !== source && !owner.userData.casePart && owner.parent) owner = owner.parent;
    const metadata = owner.userData;
    const part = metadata.casePart;
    if (!["frame", "cover", "spine", "clip"].includes(part)) return;
    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometry.scale(sourceScale, sourceScale, sourceScale);
    geometry.translate(0, sourceYOffset, 0);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.setAttribute("caseRestPosition", geometry.getAttribute("position").clone());
    geometry.userData = { ...geometry.userData, casePart: part };
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.name = object.name;
    mesh.userData = { ...metadata, ...object.userData, casePart: part };
    records.push({ part, name: mesh.name, mesh, geometry, metadata });
  });
  const partBounds = {};
  for (const part of ["frame", "cover", "spine", "clip"]) {
    const bounds = collectPartBounds(records, part);
    if (bounds) partBounds[part] = bounds;
  }
  for (const part of ["frame", "clip"]) {
    const bounds = partBounds[part];
    if (!bounds) continue;
    const pivot = bounds.getCenter(new THREE.Vector3()).toArray();
    for (const record of records) if (record.part === part) record.geometry.userData.casePartPivot = [...pivot];
  }
  const model = new THREE.Group();
  model.name = "Case_punk_offline_check";
  model.userData.caseStructure = "punk";
  for (const record of records) model.add(record.mesh);
  model.updateMatrixWorld(true);
  const modelBounds = new THREE.Box3().setFromObject(model);

  const frame = partBounds.frame;
  const cover = partBounds.cover;
  const spine = partBounds.spine;
  const frameMetadata = sourcePartObjects.find(object => object.userData.casePart === "frame")?.userData ?? {};
  const frameBevelLines = builderSource.split(/\r?\n/u).filter(line =>
    /add_grooved_box\("punk_frame_(?:left_beam|right_beam|top_beam|bottom_beam)"/u.test(line));
  const frameBevels = frameBevelLines.map(line => Number(/,\s*([\d.]+)\)\s*$/u.exec(line)?.[1])).filter(Number.isFinite);
  const frameBevelSource = frameBevels.length === 4 && frameBevels.every(value => near(value, frameBevels[0], 1e-8))
    ? frameBevels[0]
    : null;
  const frameVertices = records.filter(record => record.part === "frame").flatMap(({ geometry }) => {
    const position = geometry.getAttribute("position");
    return Array.from({ length: position.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(position, index));
  });
  if (!frame || !cover || !spine) throw new Error("GLB is missing one of the required frame, cover, or spine case parts.");

  const sideRailWidthX = Number(frameMetadata.sideRailWidthX);
  const sideRailZMin = Number(frameMetadata.sideRailZMin);
  const sideRailZMax = Number(frameMetadata.sideRailZMax);
  const frontFaceEdges = {
    leftInnerX: Number.isFinite(sideRailWidthX) ? frame.min.x + sideRailWidthX * sourceScale : null,
    rightInnerX: Number.isFinite(sideRailWidthX) ? frame.max.x - sideRailWidthX * sourceScale : null,
    bottomInnerY: Number.isFinite(sideRailZMin) ? sourceYOffset + sideRailZMin * sourceScale : null,
    topInnerY: Number.isFinite(sideRailZMax) ? sourceYOffset + sideRailZMax * sourceScale : null,
  };
  const coverCoverageSource = {
    left: frontFaceEdges.leftInnerX === null ? null : (frontFaceEdges.leftInnerX - cover.min.x) / sourceScale,
    right: frontFaceEdges.rightInnerX === null ? null : (cover.max.x - frontFaceEdges.rightInnerX) / sourceScale,
    bottom: frontFaceEdges.bottomInnerY === null ? null : (frontFaceEdges.bottomInnerY - cover.min.y) / sourceScale,
    top: frontFaceEdges.topInnerY === null ? null : (cover.max.y - frontFaceEdges.topInnerY) / sourceScale,
  };
  const coverMarginAfterBevelSource = Object.fromEntries(Object.entries(coverCoverageSource).map(([edge, value]) =>
    [edge, Number.isFinite(value) && Number.isFinite(frameBevelSource) ? value - frameBevelSource : null]));
  const marginValues = Object.values(coverMarginAfterBevelSource);
  const coverMarginsValid = frameBevelLines.length === 4 && Number.isFinite(frameBevelSource) &&
    [sideRailWidthX, sideRailZMin, sideRailZMax].every(Number.isFinite) && marginValues.length === 4 && marginValues.every(value =>
    Number.isFinite(value) && value >= COVER_BEVEL_MARGIN_SOURCE - GEOMETRY_TOLERANCE);
  check("cover overlaps each bevelled front-frame edge by at least 0.01 source units", coverMarginsValid,
    { frontFaceEdges: Object.fromEntries(Object.entries(frontFaceEdges).map(([key, value]) => [key, value === null ? null : round(value)])),
      frameBevelSource, coverCoverageBeforeBevelSource: Object.fromEntries(Object.entries(coverCoverageSource).map(([key, value]) => [key, value === null ? null : round(value)])),
      coverMarginAfterBevelSource: Object.fromEntries(Object.entries(coverMarginAfterBevelSource).map(([key, value]) => [key, value === null ? null : round(value)])),
      minimum: COVER_BEVEL_MARGIN_SOURCE, tolerance: GEOMETRY_TOLERANCE });

  const frameDepthEmbeddingSource = (frame.max.z - cover.min.z) / sourceScale;
  check("cover back embeds into frame by at least 0.009 source units",
    frameDepthEmbeddingSource >= 0.009 - GEOMETRY_TOLERANCE,
    { embeddingSource: round(frameDepthEmbeddingSource), minimum: 0.009, tolerance: GEOMETRY_TOLERANCE });
  const coverThicknessSource = (cover.max.z - cover.min.z) / sourceScale;
  const spineThicknessSource = (spine.max.z - spine.min.z) / sourceScale;
  const glassSpineGapSource = (cover.min.z - spine.max.z) / sourceScale;
  const spineTopology = flatMeshCheck(records);
  check("spine is a closed solid mesh", spineTopology.closed, spineTopology);
  check("spine thickness matches 0.055 source units", near(spineThicknessSource, 0.055),
    { actual: round(spineThicknessSource), expected: 0.055, tolerance: GEOMETRY_TOLERANCE });
  check("glass-to-spine gap matches 0.025 source units", near(glassSpineGapSource, 0.025),
    { actual: round(glassSpineGapSource), expected: 0.025, tolerance: GEOMETRY_TOLERANCE });

  const normals = meshNormalSummary(records);
  for (const [part, summary] of Object.entries(normals))
    check(`${part} GLB normals are present, finite, and unit length`, summary.meshCount > 0 && summary.normalCount > 0 && summary.finite && summary.unit, summary);
  check("frame custom-normal metadata is retained", frameMetadata.railHasCustomNormals === true,
    { railHasCustomNormals: frameMetadata.railHasCustomNormals ?? null,
      railPlaneNormalMaxDeviationDegrees: frameMetadata.railPlaneNormalMaxDeviationDegrees ?? null });

  const deploymentStep = executeDeclaration(deploymentSource, DEPLOYMENT_PATH, "deploymentStep");
  const casePartTransformMatrix = executeDeclaration(materialsSource, MATERIALS_PATH,
    "casePartTransformMatrix", { THREE });
  const display = executeDisplayModule(displaySource, DISPLAY_PATH, deploymentStep, casePartTransformMatrix);
  const phase = display.punkCaseDisplayPhase;
  if (typeof phase !== "function" || typeof display.punkCaseDisplayMount !== "function")
    throw new Error("Punk display module did not export its phase and mount functions.");
  const phaseAt = q => phase(q, true, true, false);
  const phaseStart = phaseAt(0);
  const phaseEnd = phaseAt(1);
  const traceQs = [1, 0.98, 0.8, 0.62, 0.60, 0.58, 0.55, 0.1, 0];
  const phaseTrace = traceQs.map(q => ({ q, ...phaseAt(q) }));
  const phaseMonotonic = phaseTrace.every((row, index) => index === 0 ||
    (row.power >= phaseTrace[index - 1].power - 1e-8 && row.scan >= phaseTrace[index - 1].scan - 1e-8));
  check("phase endpoints map q=0 to ARRAY and q=1 to MATRIX", near(phaseStart.power, 1) && near(phaseStart.scan, 1) &&
    near(phaseEnd.power, 0) && near(phaseEnd.scan, 0), { q0Array: phaseStart, q1Matrix: phaseEnd });
  const whiteBeforeScan = phaseAt(0.60);
  const scanStartsAfterWhite = phaseAt(0.57);
  check("M-to-A powers a blank white screen before the title scan", near(whiteBeforeScan.power, 1) && near(whiteBeforeScan.scan, 0) &&
    near(scanStartsAfterWhite.power, 1) && scanStartsAfterWhite.scan > 0,
    { blankWhite: whiteBeforeScan, firstScanSample: scanStartsAfterWhite });
  check("M-to-A power and scan are monotone as q falls", phaseMonotonic, { trace: phaseTrace });
  const reverseMatches = traceQs.every(q => {
    const a = phase(q, true, true, false), b = phase(q, false, true, false);
    return near(a.power, b.power, 1e-8) && near(a.scan, b.scan, 1e-8);
  });
  check("A-to-M reverses the same q phase without a second curve", reverseMatches);
  const idleArray = phase(0.4, true, false, false);
  const idleMatrix = phase(0.4, false, false, false);
  const reducedArray = phase(0.4, true, true, true);
  const reducedMatrix = phase(0.4, false, true, true);
  check("idle and reduced-motion endpoints are ARRAY 1/1 and MATRIX 0/0",
    near(idleArray.power, 1) && near(idleArray.scan, 1) && near(reducedArray.power, 1) && near(reducedArray.scan, 1) &&
    near(idleMatrix.power, 0) && near(idleMatrix.scan, 0) && near(reducedMatrix.power, 0) && near(reducedMatrix.scan, 0),
    { idleArray, idleMatrix, reducedArray, reducedMatrix });
  const whiteBase = titlesSource.includes('ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 512, 64);');
  const accentBar = titlesSource.includes("ctx.fillStyle = this.accent; ctx.fillRect(0, 0, 6, 64);");
  const leftToRightScan = titlesSource.includes("float titleRevealed = step(vTitleUv.x, uPunkDisplayScan);");
  check("title atlas paints a white base, accent bar, then reveals the title left-to-right",
    whiteBase && accentBar && leftToRightScan && titlesSource.includes("ctx.fillText(text + (text === title ? \"\" : \"…\"), 20, 33);"),
    { whiteBase, accentBar, leftToRightScan, titleDraw: titlesSource.includes("ctx.fillText(text + (text === title ? \"\" : \"…\"), 20, 33);") });
  const configureDisplayMaterial = executeClassMethod(titlesSource, TITLES_PATH, "MusicCaseTitles", "configureDisplayMaterial", { THREE });
  const materialProbe = Object.create(Object.getPrototypeOf(new THREE.MeshBasicMaterial()));
  materialProbe.atlasLayout = { paged: false };
  materialProbe.displayPower = { value: 0 };
  materialProbe.displayScan = { value: 0 };
  materialProbe.textures = [];
  const displayMaterial = new THREE.MeshBasicMaterial();
  configureDisplayMaterial.call(materialProbe, displayMaterial, false);
  const shaderProbe = { vertexShader: "#include <uv_vertex>", fragmentShader: "#include <common>\n#include <map_fragment>\n#include <opaque_fragment>", uniforms: {} };
  displayMaterial.onBeforeCompile(shaderProbe);
  const unlit = displayMaterial.isMeshBasicMaterial && displayMaterial.fog === false && displayMaterial.toneMapped === false;
  const depthOcclusion = displayMaterial.depthTest === true && displayMaterial.depthWrite === true;
  const noAdvancedOptics = !displayMaterial.isMeshPhysicalMaterial && displayMaterial.envMap === null &&
    !Object.hasOwn(displayMaterial, "transmission") &&
    ["renderPass: false,", "renderTarget: false,"] .every(value => titlesSource.includes(value));
  const noDisplayShadows = titlesSource.includes("this.array.castShadow = this.array.receiveShadow = false;") &&
    titlesSource.includes("this.selected.castShadow = this.selected.receiveShadow = false;");
  check("display uses unlit material, keeps depth occlusion, and avoids optics or display shadows",
    unlit && depthOcclusion && noAdvancedOptics && noDisplayShadows &&
    shaderProbe.fragmentShader.includes("uPunkDisplayPower <= 0.0001") &&
    shaderProbe.fragmentShader.includes("titleRevealed") && shaderProbe.fragmentShader.includes("titleAccent"),
    { unlit, depthOcclusion, noAdvancedOptics, noDisplayShadows,
      shaderHasPowerGate: shaderProbe.fragmentShader.includes("uPunkDisplayPower <= 0.0001"),
      shaderHasTitleScan: shaderProbe.fragmentShader.includes("titleRevealed"),
      shaderHasAccentLine: shaderProbe.fragmentShader.includes("titleAccent") });

  const defaultTransform = { visible: true, offset: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const identityAppearance = { transforms: { frame: defaultTransform, clip: defaultTransform } };
  const mount = display.punkCaseDisplayMount(layout, model, identityAppearance);
  const restFrameBounds = partBounds.frame;
  const restClipBounds = partBounds.clip;
  const identityMountExpected = Boolean(mount && restFrameBounds && restClipBounds);
  check("mount resolves from the production GLB node names and casePart metadata", identityMountExpected,
    { meshNames: records.filter(record => ["frame", "clip"].includes(record.part)).map(record => ({ name: record.name, part: record.part })),
      mount: mount ? { x: round(mount.x), y: round(mount.y), z: round(mount.z), width: round(mount.width), depth: round(mount.depth) } : null });

  let mountTransform = null;
  if (mount && restFrameBounds && restClipBounds) {
    const frameMatrix = casePartTransformMatrix(defaultTransform, restFrameBounds.getCenter(new THREE.Vector3()));
    const expectedFrameBounds = restFrameBounds.clone().applyMatrix4(frameMatrix);
    const cornerCenter = mount.corners.reduce((sum, corner) => sum.add(new THREE.Vector3(...corner)), new THREE.Vector3()).multiplyScalar(0.25);
    const expectedCenter = new THREE.Vector3(mount.x, mount.y, mount.z).applyMatrix4(frameMatrix);
    const rightEdgeCenter = new THREE.Vector3(...mount.corners[1]).add(new THREE.Vector3(...mount.corners[2])).multiplyScalar(0.5);
    const expectedRightX = mount.clipBounds.min[0] + mount.attachmentOverlap;
    const modelTopClearance = modelBounds.max.y - mount.top;
    mountTransform = {
      restFrameBounds: boundsValue(restFrameBounds),
      returnedFrameBounds: mount.frameBounds,
      displayCenter: cornerCenter.toArray().map(value => round(value)),
      expectedDisplayCenter: expectedCenter.toArray().map(value => round(value)),
      rightEdgeX: round(rightEdgeCenter.x), expectedRightEdgeX: round(expectedRightX),
      modelTopY: round(modelBounds.max.y), displayTopY: round(mount.top),
      modelTopClearance: round(modelTopClearance),
    };
    check("display frame bounds follow the case frame transform", compareBounds(
      new THREE.Box3(new THREE.Vector3(...mount.frameBounds.min), new THREE.Vector3(...mount.frameBounds.max)), expectedFrameBounds));
    check("display plane center follows the frame transform", cornerCenter.distanceTo(expectedCenter) <= 1e-5,
      { actual: mountTransform.displayCenter, expected: mountTransform.expectedDisplayCenter });
    check("display right edge joins the transformed clip with the requested overlap",
      near(rightEdgeCenter.x, expectedRightX) && near(mount.right, restFrameBounds.min.x + 0.16 * sourceScale + mount.width),
      { actualWorldRightX: round(rightEdgeCenter.x), expectedWorldRightX: round(expectedRightX),
        clipLeftX: round(mount.clipBounds.min[0]), overlap: round(mount.attachmentOverlap) });
    check("display attaches to the frame top and stays below the case global maximum Y",
      near(mount.top, restFrameBounds.max.y + mount.gapY) && modelTopClearance > sourceScale * 0.05,
      { topBeamY: round(restFrameBounds.max.y), displayTopY: round(mount.top), gapY: round(mount.gapY),
        modelTopY: round(modelBounds.max.y), clearance: round(modelTopClearance) });
    check("display keeps a shallow surface strip on the top frame", mount.depth > 0 && mount.depth <= 0.22 * sourceScale + 1e-6,
      { depth: round(mount.depth), maximum: round(0.22 * sourceScale) });

    const frameTransform = { visible: true, offset: [0.08, 0.04, -0.02], rotation: [0, 0, 0], scale: [1.1, 1, 0.9] };
    const clipTransform = { visible: true, offset: [0.04, 0, -0.02], rotation: [0, 0, 0], scale: [1, 1, 1] };
    const transformedAppearance = { transforms: { frame: frameTransform, clip: clipTransform } };
    const movedMount = display.punkCaseDisplayMount(layout, model, transformedAppearance);
    const expectedMovedFrame = restFrameBounds.clone().applyMatrix4(casePartTransformMatrix(frameTransform, restFrameBounds.getCenter(new THREE.Vector3())));
    if (!movedMount) {
      check("mount remains available under frame and clip transforms", false);
    } else {
      const movedCenter = movedMount.corners.reduce((sum, corner) => sum.add(new THREE.Vector3(...corner)), new THREE.Vector3()).multiplyScalar(0.25);
      const expectedMovedCenter = new THREE.Vector3(movedMount.x, movedMount.y, movedMount.z)
        .applyMatrix4(casePartTransformMatrix(frameTransform, restFrameBounds.getCenter(new THREE.Vector3())));
      const movedRightEdge = new THREE.Vector3(...movedMount.corners[1]).add(new THREE.Vector3(...movedMount.corners[2])).multiplyScalar(0.5);
      check("mount frame and clip transforms remain aligned", compareBounds(
        new THREE.Box3(new THREE.Vector3(...movedMount.frameBounds.min), new THREE.Vector3(...movedMount.frameBounds.max)), expectedMovedFrame) &&
        movedCenter.distanceTo(expectedMovedCenter) <= 1e-5 &&
        near(movedRightEdge.x, movedMount.clipBounds.min[0] + movedMount.attachmentOverlap),
        { displayCenter: movedCenter.toArray().map(value => round(value)), expectedCenter: expectedMovedCenter.toArray().map(value => round(value)),
          rightEdgeX: round(movedRightEdge.x), clipConnectionX: round(movedMount.clipBounds.min[0] + movedMount.attachmentOverlap) });
    }
  }

  const meshNamesByPart = Object.fromEntries(["frame", "cover", "spine", "clip"].map(part =>
    [part, records.filter(record => record.part === part).map(record => record.name)]));
  const geometry = {
    sourceBoundsGLTF: boundsValue(sourceBounds),
    caseModelBounds: boundsValue(modelBounds),
    sourceScale: round(sourceScale, 9),
    sourceYOffset: round(sourceYOffset, 9),
    parts: Object.fromEntries(Object.entries(partBounds).map(([part, bounds]) => [part, boundsValue(bounds)])),
    coverThicknessSource: round(coverThicknessSource),
    frameDepthEmbeddingSource: round(frameDepthEmbeddingSource),
    frameFrontFaceEdges: Object.fromEntries(Object.entries(frontFaceEdges).map(([key, value]) => [key, value === null ? null : round(value)])),
    frameBevelSource: Number.isFinite(frameBevelSource) ? round(frameBevelSource) : null,
    coverCoverageBeforeBevelSource: Object.fromEntries(Object.entries(coverCoverageSource).map(([key, value]) => [key, value === null ? null : round(value)])),
    coverMarginAfterBevelSource: Object.fromEntries(Object.entries(coverMarginAfterBevelSource).map(([key, value]) => [key, value === null ? null : round(value)])),
    spineThicknessSource: round(spineThicknessSource),
    glassSpineGapSource: round(glassSpineGapSource),
    spineTopology,
    normals,
    frameNormalMetadata: {
      railHasCustomNormals: frameMetadata.railHasCustomNormals ?? null,
      railPlaneNormalMaxDeviationDegrees: frameMetadata.railPlaneNormalMaxDeviationDegrees ?? null,
    },
    meshNamesByPart,
    mount: mount ? {
      x: round(mount.x), y: round(mount.y), z: round(mount.z), width: round(mount.width), depth: round(mount.depth),
      left: round(mount.left), right: round(mount.right), top: round(mount.top), gapY: round(mount.gapY),
      attachmentOverlap: round(mount.attachmentOverlap), frameBounds: mount.frameBounds, clipBounds: mount.clipBounds,
    } : null,
    mountTransform,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    ok: errors.length === 0,
    glb: { path: path.relative(project, GLB_PATH).replaceAll(path.sep, "/"), bytes: glb.length,
      sha256, assetUrlVersion: urlVersion, version: document.asset.version, images: document.images?.length ?? 0,
      partIds: [...new Set(sourcePartObjects.map(object => object.userData.casePart))].sort(),
      sourceMeshNodes: sourcePartObjects.length },
    geometry,
    phase: { trace: phaseTrace, endpoints: { array: phaseStart, matrix: phaseEnd }, monotonicMToA: phaseMonotonic,
      whiteBeforeScan: whiteBeforeScan, firstScanSample: scanStartsAfterWhite },
    checks,
    errors,
  };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ reportPath, ok: report.ok, sha256, assetUrlVersion: urlVersion,
    geometry: { caseModelBounds: geometry.caseModelBounds, parts: geometry.parts,
      coverMarginSource: geometry.coverMarginSource, frameDepthEmbeddingSource: geometry.frameDepthEmbeddingSource,
      spineThicknessSource: geometry.spineThicknessSource, glassSpineGapSource: geometry.glassSpineGapSource,
      spineTopology: geometry.spineTopology, mount: geometry.mount },
    phase: report.phase.endpoints, checkCount: checks.length, errors }, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main().catch(async error => {
  const report = { generatedAt: new Date().toISOString(), ok: false, fatalError: String(error?.stack ?? error), checks, errors };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify({ reportPath, ok: false, fatalError: report.fatalError }, null, 2));
  process.exitCode = 1;
});
