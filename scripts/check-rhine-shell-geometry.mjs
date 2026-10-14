import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  entryPoints: [path.join(project, "src", "rhine-shell-geometry.ts")],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  target: "node20",
  external: ["three"],
});
const sourceText = built.outputFiles[0]?.text;
assert.ok(sourceText, "esbuild must compile the Rhino geometry filter in memory.");
const compiledModule = { exports: {} };
new Function("require", "module", "exports", sourceText)(
  createRequire(import.meta.url), compiledModule, compiledModule.exports,
);
const { filterRhineShellGeometry, relocateRhineLabelGeometry } = compiledModule.exports;
assert.equal(typeof filterRhineShellGeometry, "function");
assert.equal(typeof relocateRhineLabelGeometry, "function");

const glbBytes = await readFile(path.join(project, "public", "assets", "archive-cassette.glb"));
const glbBuffer = glbBytes.buffer.slice(glbBytes.byteOffset, glbBytes.byteOffset + glbBytes.byteLength);
const gltf = await new GLTFLoader().parseAsync(glbBuffer, "");
gltf.scene.updateMatrixWorld(true);

function sourceSurfaceName(material) {
  const name = material.name.split("__").pop() ?? material.name;
  return name.replace(/\.\d+$/u, "");
}

const auditedSurfaces = new Set([
  "Internal_Ceramic",
  "Optical_Edges",
  "Printed_Label",
  "Carbon_Ink",
]);
const meshForSurface = new Map();
gltf.scene.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) {
    const surface = sourceSurfaceName(material);
    if (auditedSurfaces.has(surface)) {
      assert.equal(meshForSurface.has(surface), false, `${surface} must occupy one source mesh for this audit.`);
      meshForSurface.set(surface, object);
    }
  }
});

function worldGeometry(mesh) {
  const geometry = mesh.geometry.clone();
  geometry.applyMatrix4(mesh.matrixWorld);
  return geometry;
}

function componentAnalysis(geometry, surface) {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const elementCount = index?.count ?? position.count;
  const triangles = [];
  for (let i = 0; i + 2 < elementCount; i += 3) {
    const vertices = [0, 1, 2].map(corner => index?.getX(i + corner) ?? i + corner);
    const points = vertices.map(vertex => [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]);
    const retained = surface === "Internal_Ceramic"
      ? points.every(point => point[2] >= 0)
      : points.every(([x, y]) => y < 0.7 || y > 3.6 || Math.abs(x) > 2.3);
    triangles.push({ vertices, points, retained });
  }

  const parent = Array.from({ length: position.count }, (_, i) => i);
  const find = value => parent[value] === value ? value : (parent[value] = find(parent[value]));
  const join = (a, b) => {
    const left = find(a), right = find(b);
    if (left !== right) parent[right] = left;
  };
  const welded = new Map();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const key = [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]
      .map(value => Math.round(value * 100000)).join(",");
    if (welded.has(key)) join(vertex, welded.get(key));
    else welded.set(key, vertex);
  }
  for (const triangle of triangles) {
    join(triangle.vertices[0], triangle.vertices[1]);
    join(triangle.vertices[1], triangle.vertices[2]);
    join(triangle.vertices[2], triangle.vertices[0]);
  }

  const islands = new Map();
  for (let vertex = 0; vertex < position.count; vertex++) {
    const root = find(vertex);
    if (!islands.has(root)) islands.set(root, { vertices: [], triangleCount: 0, keptTriangles: 0 });
    islands.get(root).vertices.push(vertex);
  }
  for (const triangle of triangles) {
    const island = islands.get(find(triangle.vertices[0]));
    island.triangleCount++;
    island.keptTriangles += Number(triangle.retained);
  }
  const components = [...islands.values()].filter(island => island.triangleCount > 0);
  for (const island of components) {
    assert.ok(island.keptTriangles === 0 || island.keptTriangles === island.triangleCount,
      `${surface} filter must retain or remove each complete connected island.`);
  }
  return {
    triangles,
    components,
    keptTriangles: triangles.filter(triangle => triangle.retained).length,
    removedTriangles: triangles.filter(triangle => !triangle.retained).length,
    keptComponents: components.filter(island => island.keptTriangles > 0).length,
    removedComponents: components.filter(island => island.keptTriangles === 0).length,
  };
}

function geometrySnapshot(geometry) {
  const attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => {
    const reader = attribute;
    return [name, {
      itemSize: reader.itemSize,
      normalized: reader.normalized,
      array: Array.from(reader.array ?? reader.data.array),
    }];
  }));
  return {
    attributes,
    index: geometry.index ? Array.from(geometry.index.array) : null,
    groups: geometry.groups.map(group => ({ ...group })),
    drawRange: { ...geometry.drawRange },
  };
}

function attributeComponent(attribute, vertex, component) {
  if (typeof attribute.getComponent === "function") return attribute.getComponent(vertex, component);
  const getters = [attribute.getX, attribute.getY, attribute.getZ, attribute.getW];
  if (getters[component]) return getters[component](vertex);
  return attribute.array[vertex * attribute.itemSize + component];
}

function attributeTuple(geometry, vertex, names) {
  return names.map(name => {
    const attribute = geometry.getAttribute(name);
    return Array.from({ length: attribute.itemSize }, (_, component) =>
      Math.fround(attributeComponent(attribute, vertex, component)));
  });
}

function assertRelocatedGeometry(before, result, shouldMove, surface) {
  assert.ok(result?.isBufferGeometry, `${surface} relocation must return a BufferGeometry.`);
  assert.deepEqual(Object.keys(result.attributes).sort(), Object.keys(before.attributes).sort(),
    `${surface} relocation must retain every source attribute.`);
  const beforePosition = before.attributes.position;
  const afterPosition = result.getAttribute("position");
  assert.equal(afterPosition.count, beforePosition.array.length / beforePosition.itemSize,
    `${surface} relocation must retain the position count.`);
  for (const [name, afterAttribute] of Object.entries(result.attributes)) {
    const prior = before.attributes[name];
    assert.equal(afterAttribute.itemSize, prior.itemSize, `${surface}.${name} item size must stay unchanged.`);
    assert.equal(afterAttribute.normalized, prior.normalized, `${surface}.${name} normalization must stay unchanged.`);
    assert.equal(afterAttribute.count, prior.array.length / prior.itemSize, `${surface}.${name} count must stay unchanged.`);
    if (name !== "position") {
      assert.deepEqual(Array.from(afterAttribute.array ?? afterAttribute.data.array), prior.array,
        `${surface}.${name} values must stay unchanged.`);
    }
  }
  for (let vertex = 0; vertex < afterPosition.count; vertex++) {
    const offset = vertex * beforePosition.itemSize;
    const x = beforePosition.array[offset];
    const y = beforePosition.array[offset + 1];
    const z = beforePosition.array[offset + 2];
    const expectedX = shouldMove(vertex, [x, y, z]) ? Math.fround(x + 2.78) : x;
    assert.ok(Math.abs(afterPosition.getX(vertex) - expectedX) < 1e-6,
      `${surface} vertex ${vertex} x relocation mismatch.`);
    assert.ok(Math.abs(afterPosition.getY(vertex) - y) < 1e-6,
      `${surface} vertex ${vertex} y must stay unchanged.`);
    assert.ok(Math.abs(afterPosition.getZ(vertex) - z) < 1e-6,
      `${surface} vertex ${vertex} z must stay unchanged.`);
  }
  assert.deepEqual(result.index ? Array.from(result.index.array) : null, before.index,
    `${surface} relocation must preserve indices.`);
  assert.deepEqual(result.groups.map(group => ({ ...group })), before.groups,
    `${surface} relocation must preserve material groups.`);
  assert.deepEqual({ ...result.drawRange }, before.drawRange,
    `${surface} relocation must preserve its draw range.`);
  const expectedBounds = new THREE.Box3().setFromBufferAttribute(afterPosition);
  assert.ok(result.boundingBox, `${surface} relocation must recompute boundingBox.`);
  assert.ok(result.boundingSphere, `${surface} relocation must recompute boundingSphere.`);
  assert.ok(result.boundingBox.min.distanceTo(expectedBounds.min) < 1e-6);
  assert.ok(result.boundingBox.max.distanceTo(expectedBounds.max) < 1e-6);
  const triangleCount = result.index ? result.index.count / 3 : afterPosition.count / 3;
  const beforeTriangleCount = before.index ? before.index.length / 3 : beforePosition.array.length / beforePosition.itemSize / 3;
  assert.equal(triangleCount, beforeTriangleCount, `${surface} relocation must preserve triangle count.`);
}

function isInternalCeramicLabelPoint([x, y, z]) {
  return x >= -1.9 && x <= -0.8 && y >= 2.8 && y <= 3.3 && z > 0.2;
}

function relocateAfterFiltering(source, surface) {
  const filtered = filterRhineShellGeometry(source, surface);
  if (filtered !== source) source.dispose();
  const relocated = relocateRhineLabelGeometry(filtered, surface);
  if (relocated !== filtered) filtered.dispose();
  assert.ok(relocated?.isBufferGeometry, `${surface} relocation must return a BufferGeometry.`);
  return relocated;
}

function assertCompactAndAttributesPreserved(source, result, analysis, surface) {
  assert.notEqual(result, source, `${surface} filtering must return a new geometry.`);
  assert.ok(result.index, `${surface} output must use a compact index.`);
  assert.equal(result.index.count / 3, analysis.keptTriangles, `${surface} retained triangle count.`);
  assert.deepEqual(Object.keys(result.attributes).sort(), Object.keys(source.attributes).sort(),
    `${surface} must retain every source vertex attribute.`);
  assert.ok(result.getAttribute("normal"), `${surface} must retain normals.`);
  assert.ok(result.getAttribute("uv"), `${surface} must retain UVs.`);
  for (const [name, attribute] of Object.entries(result.attributes)) {
    assert.equal(attribute.itemSize, source.getAttribute(name).itemSize, `${surface}.${name} item size.`);
    assert.equal(attribute.normalized, false, `${surface}.${name} should store interpreted Float32 values.`);
    assert.ok(attribute.array instanceof Float32Array, `${surface}.${name} should be compact Float32 data.`);
    assert.equal(attribute.count, result.getAttribute("position").count,
      `${surface}.${name} must not retain unused vertex data.`);
  }
  assert.equal(result.drawRange.start, 0);
  assert.equal(result.drawRange.count, result.index.count);
  assert.equal(new Set(Array.from(result.index.array)).size, result.getAttribute("position").count,
    `${surface} output vertices must all be referenced by kept triangles.`);

  const retainedSourceVertices = new Set(analysis.triangles.filter(triangle => triangle.retained)
    .flatMap(triangle => triangle.vertices));
  const attributeNames = Object.keys(source.attributes).sort();
  const expected = [...retainedSourceVertices].map(vertex => JSON.stringify(attributeTuple(source, vertex, attributeNames))).sort();
  const actual = Array.from({ length: result.getAttribute("position").count }, (_, vertex) =>
    JSON.stringify(attributeTuple(result, vertex, attributeNames))).sort();
  assert.deepEqual(actual, expected, `${surface} must preserve the retained normal/UV/tangent/etc values.`);

  const expectedBounds = new THREE.Box3().setFromBufferAttribute(result.getAttribute("position"));
  assert.ok(result.boundingBox, `${surface} output needs a recomputed bounding box.`);
  assert.ok(result.boundingSphere, `${surface} output needs a recomputed bounding sphere.`);
  assert.ok(result.boundingBox.min.distanceTo(expectedBounds.min) < 1e-6);
  assert.ok(result.boundingBox.max.distanceTo(expectedBounds.max) < 1e-6);
}

const checked = new Map();
for (const surface of ["Internal_Ceramic", "Optical_Edges"]) {
  const mesh = meshForSurface.get(surface);
  assert.ok(mesh, `GLB must contain ${surface}.`);
  const source = worldGeometry(mesh);
  const before = geometrySnapshot(source);
  const analysis = componentAnalysis(source, surface);
  const filtered = filterRhineShellGeometry(source, surface);
  assert.deepEqual(geometrySnapshot(source), before, `${surface} input geometry must remain unchanged.`);
  assertCompactAndAttributesPreserved(source, filtered, analysis, surface);
  checked.set(surface, { mesh, source, filtered, analysis });
}

assert.equal(checked.get("Internal_Ceramic").analysis.components.length, 29);
assert.equal(checked.get("Internal_Ceramic").analysis.removedComponents, 1);
assert.equal(checked.get("Internal_Ceramic").analysis.keptComponents, 28);
assert.equal(checked.get("Internal_Ceramic").analysis.removedTriangles, 112);
assert.equal(checked.get("Internal_Ceramic").analysis.keptTriangles, 3384);
assert.equal(checked.get("Internal_Ceramic").filtered.index.count / 3, 3384);
assert.equal(checked.get("Optical_Edges").analysis.components.length, 23);
assert.equal(checked.get("Optical_Edges").analysis.removedComponents, 6);
assert.equal(checked.get("Optical_Edges").analysis.keptComponents, 17);
assert.equal(checked.get("Optical_Edges").analysis.removedTriangles, 7684);
assert.equal(checked.get("Optical_Edges").analysis.keptTriangles, 3488);
assert.equal(checked.get("Optical_Edges").filtered.index.count / 3, 3488);

const relocatedWholeSurfaces = [];
for (const surface of ["Printed_Label", "Carbon_Ink"]) {
  const mesh = meshForSurface.get(surface);
  assert.ok(mesh, `GLB must contain ${surface}.`);
  const originalMesh = geometrySnapshot(mesh.geometry);
  const source = worldGeometry(mesh);
  const filtered = filterRhineShellGeometry(source, surface);
  assert.equal(filtered, source, `${surface} must pass through shell filtering before relocation.`);
  const before = geometrySnapshot(filtered);
  const relocated = relocateRhineLabelGeometry(filtered, surface);
  assertRelocatedGeometry(before, relocated, () => true, surface);
  assert.deepEqual(geometrySnapshot(mesh.geometry), originalMesh,
    `${surface} relocation must not modify the original GLB geometry.`);
  relocatedWholeSurfaces.push(surface);
  if (relocated !== filtered) filtered.dispose();
  relocated.dispose();
}

const ceramic = checked.get("Internal_Ceramic");
const ceramicBeforeRelocation = geometrySnapshot(ceramic.filtered);
const ceramicComponentsBefore = componentAnalysis(ceramic.filtered, "Internal_Ceramic");
const ceramicLabelComponents = ceramicComponentsBefore.components.filter(component =>
  component.vertices.every(vertex => isInternalCeramicLabelPoint(attributeTuple(ceramic.filtered, vertex, ["position"])[0])));
const ceramicStationaryComponents = ceramicComponentsBefore.components.filter(component =>
  component.vertices.every(vertex => !isInternalCeramicLabelPoint(attributeTuple(ceramic.filtered, vertex, ["position"])[0])));
assert.equal(ceramicLabelComponents.length, 16, "The upper Internal_Ceramic label must comprise 16 complete islands.");
assert.equal(ceramicLabelComponents.reduce((sum, component) => sum + component.triangleCount, 0), 1928,
  "All 1928 upper label glyph triangles must move together.");
assert.equal(ceramicStationaryComponents.length, 12, "The lower lettering and badge must stay as 12 complete islands.");
assert.ok(ceramicComponentsBefore.components.every(component => {
  const states = new Set(component.vertices.map(vertex => isInternalCeramicLabelPoint(
    attributeTuple(ceramic.filtered, vertex, ["position"])[0],
  )));
  return states.size === 1;
}), "Internal_Ceramic label selection must not split a connected island.");
const originalCeramicMesh = geometrySnapshot(ceramic.mesh.geometry);
const relocatedCeramic = relocateRhineLabelGeometry(ceramic.filtered, "Internal_Ceramic");
assertRelocatedGeometry(ceramicBeforeRelocation, relocatedCeramic,
  (_vertex, point) => isInternalCeramicLabelPoint(point), "Internal_Ceramic");
const ceramicComponentsAfter = componentAnalysis(relocatedCeramic, "Internal_Ceramic");
assert.equal(ceramicComponentsAfter.components.length, 28,
  "Relocation must preserve all retained ceramic connected islands without tearing or merging them.");
assert.equal(ceramicComponentsAfter.triangles.length, ceramicComponentsBefore.triangles.length,
  "Internal_Ceramic relocation must preserve all retained triangles.");
assert.deepEqual(geometrySnapshot(ceramic.mesh.geometry), originalCeramicMesh,
  "Internal_Ceramic relocation must not modify the original GLB geometry.");
ceramic.filtered = relocatedCeramic;

const passthrough = [...meshForSurface.values()][0].geometry;
assert.equal(filterRhineShellGeometry(passthrough, "Frosted_Polymer"), passthrough,
  "All non-target surfaces must pass through unchanged.");
assert.equal(relocateRhineLabelGeometry(passthrough, "Frosted_Polymer"), passthrough,
  "Relocation must pass all non-label surfaces through unchanged.");

function clipPolygon(polygon, axis, boundary, keepGreater) {
  const output = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const aInside = keepGreater ? a[axis] >= boundary : a[axis] <= boundary;
    const bInside = keepGreater ? b[axis] >= boundary : b[axis] <= boundary;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const t = (boundary - a[axis]) / (b[axis] - a[axis]);
      output.push(a.map((value, component) => value + t * (b[component] - value)));
    }
  }
  return output;
}

function triangleIntersectsRect(points, rect) {
  let clipped = points.map(point => [...point]);
  clipped = clipPolygon(clipped, 0, rect.x0, true);
  clipped = clipPolygon(clipped, 0, rect.x1, false);
  clipped = clipPolygon(clipped, 1, rect.y0, true);
  clipped = clipPolygon(clipped, 1, rect.y1, false);
  return clipped.length >= 3;
}

const coverRect = { x0: -2.00, x1: 0.52, y0: 0.70, y1: 3.22 };
const clearRect = { x0: -2.02, x1: 0.54, y0: 0.68, y1: 3.24 };
const originalLeftClearRect = { x0: -2.14, x1: 0.42, y0: 0.68, y1: 3.24 };
const removedInternalSurfaces = new Set([
  "Subsurface_Optics",
  "Optical_Film",
  "Optical_Film_Edge",
  "Amber_Optical_Inlay",
]);
function frontDetailIntersections(rect) {
  const intersections = [];
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      const surface = sourceSurfaceName(material);
      if (surface === "Frosted_Polymer" || removedInternalSurfaces.has(surface)) continue;
      const checkedGeometry = geometryForOverlayCheck(object, surface);
      try {
        const position = checkedGeometry.getAttribute("position"), index = checkedGeometry.getIndex();
        const elementCount = index?.count ?? position.count;
        for (let offset = 0; offset + 2 < elementCount; offset += 3) {
          const vertices = [0, 1, 2].map(corner => index?.getX(offset + corner) ?? offset + corner);
          const points = vertices.map(vertex => [position.getX(vertex), position.getY(vertex), position.getZ(vertex)]);
          if (Math.max(...points.map(point => point[2])) <= 0.128) continue;
          if (triangleIntersectsRect(points, rect)) intersections.push(surface);
        }
      } finally {
        checkedGeometry.dispose();
      }
    }
  });
  return intersections;
}

function geometryForOverlayCheck(mesh, surface) {
  const source = worldGeometry(mesh);
  return relocateAfterFiltering(source, surface);
}

const coverHits = frontDetailIntersections(coverRect);
const clearHits = frontDetailIntersections(clearRect);
assert.equal(coverHits.length, 0, `Safe paper cover must not overlap retained front detail triangles: ${[...new Set(coverHits)]}`);
assert.equal(clearHits.length, 0, `Safe clear window must not overlap retained front detail triangles: ${[...new Set(clearHits)]}`);
const originalLeftWindowHits = frontDetailIntersections(originalLeftClearRect);
assert.ok(originalLeftWindowHits.some(surface => surface.includes("Case_Engraving")),
  "The original symmetric left window must intersect the retained Case_Engraving rail.");
assert.ok(originalLeftWindowHits.some(surface => /highlight/i.test(surface)),
  "The original symmetric left window must intersect the retained Case_Engraving highlight rail.");

for (const { source, filtered } of checked.values()) {
  source.dispose();
  filtered.dispose();
}

console.log(JSON.stringify({
  ok: true,
  internalCeramic: { components: 29, keptComponents: 28, removedComponents: 1, keptTriangles: 3384, removedTriangles: 112 },
  opticalEdges: { components: 23, keptComponents: 17, removedComponents: 6, keptTriangles: 3488, removedTriangles: 7684 },
  relocatedWholeSurfaces,
  relocatedCeramicLabel: { islands: ceramicLabelComponents.length, triangles: 1928, stationaryIslands: ceramicStationaryComponents.length },
  safeCover: coverRect,
  safeClearWindow: clearRect,
  safeWindowFrontDetailTriangles: 0,
  originalLeftWindowFrontDetailHits: [...new Set(originalLeftWindowHits)],
}, null, 2));
