import * as THREE from "three";
import type { CaseRect } from "./case-layout";

// At the archive camera's 140-unit distance, .0002 can round to the same
// 24-bit depth as the print. Leave several depth steps even at an oblique view.
const PRINT_CLEARANCE = .002;

/** A closed, matte paper card behind the independently textured front print. */
export function albumInsertGeometry(rect: CaseRect, thickness: number) {
  const geometry = new THREE.BoxGeometry(rect.width, rect.height, Math.max(.001, thickness));
  geometry.translate(rect.x, rect.y, rect.z - thickness / 2 - PRINT_CLEARANCE);
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
  // Draw the backing first so depth ties never replace already drawn artwork.
  // Keep its colour and physical shadows; depthOnly remains a separate option.
  mesh.renderOrder = -100;
  return mesh;
}
