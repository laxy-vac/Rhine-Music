import * as THREE from "three";

/** Closed folded rail, in world units relative to the tray's resting plane. */
export function createMusicShelfRailGeometry(highBackstop = false) {
  // Each third value assigns the face from this point to the next:
  // grey body, silver fold, then the dark shallow channel. The left backstop
  // is higher than the right sill; only its rounded upper edge rises.
  const section = highBackstop ? [
    [-.10, -.205, 0], [.10, -.205, 0], [.10, .15, 1],
    [.0985, .1615, 1], [.094, .171, 1], [.084, .178, 1], [.07, .18, 1],
    [-.05, .18, 1], [-.064, .177, 1], [-.077, .17, 1], [-.0865, .158, 1], [-.09, .145, 0],
    [-.09, -.018, 1], [-.097, -.027, 1], [-.115, -.032, 1], [-.145, -.034, 2],
    [-.28, -.055, 2], [-.28, -.08, 0], [-.10, -.08, 0],
  ] : [
    [-.10, -.205, 0], [.10, -.205, 0], [.10, -.04, 1], [.10, .008, 1],
    [.09, .022, 1], [-.075, .022, 1], [-.09, .012, 1], [-.09, -.028, 1],
    [-.145, -.034, 2], [-.28, -.055, 2], [-.28, -.08, 0], [-.10, -.08, 0],
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
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
