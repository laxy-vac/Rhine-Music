import * as THREE from "three";
import type { CaseRect } from "./case-layout";

/** A closed, matte paper card behind the independently textured front print. */
export function albumInsertGeometry(rect: CaseRect, thickness: number) {
  const geometry = new THREE.BoxGeometry(rect.width, rect.height, Math.max(.001, thickness));
  // Keep the card just behind the print plane, preventing coincident faces.
  geometry.translate(rect.x, rect.y, rect.z - thickness / 2 - .0002);
  return geometry;
}

export function createAlbumInsert(rect: CaseRect, thickness: number, depthOnly = false) {
  const material = new THREE.MeshLambertMaterial({ color: "#c7c6c1" });
  material.colorWrite = !depthOnly;
  const mesh = new THREE.Mesh(albumInsertGeometry(rect, thickness), material);
  mesh.name = "Opaque album insert";
  mesh.userData.albumInsert = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // For cached foreground layers the card writes depth before the shell,
  // so the hidden backing never contributes colour to the artwork window.
  if (depthOnly) mesh.renderOrder = -100;
  return mesh;
}
