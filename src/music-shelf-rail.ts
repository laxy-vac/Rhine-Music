import * as THREE from "three";

export const MUSIC_SHELF_TRAY_THICKNESS = .018;

/** Closed folded rail, in world units relative to the tray's resting plane. */
export function createMusicShelfRailGeometry(highBackstop = false) {
  // Each third value assigns the face from this point to the next:
  // grey body or metal fold. The black bands belong to the flat bed. The left backstop
  // is higher than the right sill; only its rounded upper edge rises.
  const section = highBackstop ? [
    [-.10, -.205, 0], [.10, -.205, 0], [.10, .15, 1],
    [.0985, .1615, 1], [.094, .171, 1], [.084, .178, 1], [.07, .18, 1],
    [-.05, .18, 1], [-.064, .177, 1], [-.077, .17, 1], [-.0865, .158, 1], [-.09, .145, 0],
    [-.09, -.065, 1], [-.097, -.074, 1], [-.115, -.078, 1], [-.145, -.0795, 0],
    [-.145, -.081, 0], [-.10, -.081, 0],
  ] : [
    // The bright right-hand face is a folded cover attached outside the
    // thick main plate. It hangs below that plate, never above the bed.
    [-.145, -.205, 0], [.10, -.205, 0], [.10, -.14, 1], [.092, -.125, 1],
    [.065, -.112, 1], [.025, -.091, 1], [.01, -.086, 0], [.01, -.081, 0],
    [-.145, -.081, 0],
  ];
  const positions: number[] = [], uvs: number[] = [];
  const geometry = new THREE.BufferGeometry();
  const addVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z); uvs.push(u, v);
  };
  for (let edge = 0; edge < section.length; edge++) {
    const a = section[edge], b = section[(edge + 1) % section.length];
    const start = positions.length / 3;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const [point, z, u, v] of [
      [a, -.5, 0, 0], [b, -.5, length, 0], [b, .5, length, 16],
      [a, -.5, 0, 0], [b, .5, length, 16], [a, .5, 0, 16],
    ] as const) addVertex(point[0], point[1], z, u, v);
    // Silver folds join the grey body and the dark channel floor directly.
    geometry.addGroup(start, 6, a[2]);
  }
  const contour = section.map(([x, y]) => new THREE.Vector2(x, y));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const z of [-.5, .5]) {
    const start = positions.length / 3;
    for (const triangle of triangles) {
      const order = z > 0 ? triangle : [...triangle].reverse();
      for (const index of order) {
        const [x, y] = section[index];
        addVertex(x, y, z, x, y);
      }
    }
    geometry.addGroup(start, positions.length / 3 - start, 0);
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  // Blend only the small adjacent bends of the same finish. Flat folds,
  // channel boundaries and the two end cuts keep their own sharp normals.
  const normals = geometry.getAttribute("normal");
  const edgeNormals = section.map((a, edge) => {
    const b = section[(edge + 1) % section.length];
    return new THREE.Vector3(b[1] - a[1], a[0] - b[0], 0).normalize();
  });
  const bendNormal = (edge: number, adjacent: number) => {
    const normal = edgeNormals[edge].clone();
    if (section[edge][2] === section[adjacent][2] && normal.dot(edgeNormals[adjacent]) > .5)
      normal.add(edgeNormals[adjacent]).normalize();
    return normal;
  };
  for (let edge = 0; edge < section.length; edge++) {
    const a = bendNormal(edge, (edge + section.length - 1) % section.length);
    const b = bendNormal(edge, (edge + 1) % section.length);
    for (const [corner, normal] of [a, b, b, a, b, a].entries())
      normals.setXYZ(edge * 6 + corner, normal.x, normal.y, normal.z);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/** One continuous raised plate: grey center and black bands share its top. */
export function createMusicShelfBedGeometry(size: THREE.Vector3, grayWidth: number) {
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z, 3, 1, 1);
  const position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  const half = size.x / 2, grayHalf = grayWidth / 2;
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const remapped = Math.abs(Math.abs(x) - half) < .0001 ? Math.sign(x) * half : Math.sign(x) * grayHalf;
    position.setX(index, remapped);
    if (Math.abs(geometry.getAttribute("normal").getY(index)) > .5)
      uv.setX(index, remapped / size.x + .5);
  }
  const groups = geometry.groups.slice();
  geometry.clearGroups();
  for (const group of groups) {
    if (group.materialIndex === 2) {
      geometry.addGroup(group.start, 6, 1);
      geometry.addGroup(group.start + 6, 6, 0);
      geometry.addGroup(group.start + 12, 6, 1);
    } else geometry.addGroup(group.start, group.count, 0);
  }
  // Batch the two finishes into two draws instead of one draw per box face.
  const index = geometry.getIndex()!;
  const byFinish: number[][] = [[], []];
  for (const group of geometry.groups)
    for (let offset = group.start; offset < group.start + group.count; offset++)
      byFinish[group.materialIndex!].push(index.getX(offset));
  geometry.setIndex([...byFinish[0], ...byFinish[1]]);
  geometry.clearGroups();
  geometry.addGroup(0, byFinish[0].length, 0);
  geometry.addGroup(byFinish[0].length, byFinish[1].length, 1);
  geometry.scale(1 / size.x, 1 / size.y, 1 / size.z);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** A thin silver inlay follows the flat two-finish bed and outer side folds. */
export function createMusicShelfSeparatorGeometry(width: number) {
  const half = width / 2, bedEdge = half - .045;
  const trayTop = -.08 + MUSIC_SHELF_TRAY_THICKNESS;
  // Grey and black regions share this flat segment. Only the short ends
  // outside the bed descend to the main plate and its outer folds.
  const path = [
    [-half - .01, -.065], [-half - .003, -.074], [-half + .015, -.078],
    [-bedEdge, -.0795], [-bedEdge, trayTop], [bedEdge, trayTop], [bedEdge, -.0795],
    [half + .11, -.0795], [half + .11, -.086],
    [half + .125, -.091], [half + .165, -.112], [half + .192, -.125], [half + .20, -.14],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const edgeNormals = path.slice(1).map((point, index) => {
    const tangent = point.clone().sub(path[index]).normalize();
    return new THREE.Vector2(-tangent.y, tangent.x);
  });
  const contourNormal = path.map((_, index) => {
    if (index === 0) return edgeNormals[0];
    if (index === path.length - 1) return edgeNormals[index - 1];
    const normal = edgeNormals[index - 1].clone().add(edgeNormals[index]).normalize();
    return normal.multiplyScalar(1 / Math.max(.5, normal.dot(edgeNormals[index])));
  });
  const lower = path.map((point, index) => point.clone().addScaledVector(contourNormal[index], .0005));
  const upper = path.map((point, index) => point.clone().addScaledVector(contourNormal[index], .002));
  const positions: number[] = [], uvs: number[] = [];
  const quad = (a: THREE.Vector2, b: THREE.Vector2, c: THREE.Vector2, d: THREE.Vector2,
    za: number, zb: number, zc: number, zd: number) => {
    for (const [point, z, u, v] of [[a, za, 0, 0], [b, zb, 1, 0], [c, zc, 1, 1],
      [a, za, 0, 0], [c, zc, 1, 1], [d, zd, 0, 1]] as const) {
      positions.push(point.x, point.y, z); uvs.push(u, v);
    }
  };
  for (let index = 0; index < path.length - 1; index++) {
    const a = lower[index], b = lower[index + 1], c = upper[index + 1], d = upper[index];
    quad(d, c, c, d, .009, .009, -.009, -.009);
    quad(d, c, b, a, -.009, -.009, -.009, -.009);
    quad(a, b, c, d, .009, .009, .009, .009);
    quad(b, a, a, b, .009, .009, -.009, -.009);
  }
  quad(lower[0], upper[0], upper[0], lower[0], .009, .009, -.009, -.009);
  const last = path.length - 1;
  quad(upper[last], lower[last], lower[last], upper[last], .009, .009, -.009, -.009);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
