import * as THREE from "three";

/** Small shared maps for the tray, independent of the selected scene floor. */
export function createMusicShelfTextures() {
  const size = 256;
  const bed = new Uint8Array(size * size * 4);
  const endBed = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    // Fine sanded grain and the soft broad shade seen in rail-mid. It is a
    // surface cue, not a second physical trench across every slot.
    const noise = ((Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263)) >>> 0) % 101 / 100 - .5;
    const brush = Math.sin(y * Math.PI * 2 * 53 / size + Math.sin(x * Math.PI * 2 / size) * .12);
    const shade = Math.sin(Math.PI * y / (size - 1)) ** 4;
    gray(bed, offset, 245 - shade * 40 + noise * 18 + brush);
    gray(endBed, offset, 245 + noise * 18 + brush);
    gray(roughness, offset, 222 + noise * 16 + brush * 4);
    normal[offset] = Math.round(128 + noise * 3);
    normal[offset + 1] = Math.round(128 + brush + noise * 3);
    normal[offset + 2] = 255;
    normal[offset + 3] = 255;
  }
  const hazard = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++)
    gray(hazard, (y * 128 + x) * 4, (x + y) % 32 < 16 ? 255 : 40);

  return {
    bed: texture(bed, size, size, "Music tray fine matte grain", true),
    endBed: texture(endBed, size, size, "Music tray end platform grain", true),
    roughness: texture(roughness, size, size, "Music tray brushed metal roughness"),
    normal: texture(normal, size, size, "Music tray machining micro normal"),
    hazard: texture(hazard, 128, 32, "Music tray end safety stripes", true),
  };
}

export type MusicShelfTextures = ReturnType<typeof createMusicShelfTextures>;

export function disposeMusicShelfTextures(textures: MusicShelfTextures) {
  for (const map of Object.values(textures)) map.dispose();
}

function texture(data: Uint8Array, width: number, height: number, name: string, color = false) {
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  map.name = name;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.magFilter = THREE.LinearFilter;
  map.needsUpdate = true;
  return map;
}

function gray(data: Uint8Array, offset: number, value: number) {
  const channel = Math.max(0, Math.min(255, Math.round(value)));
  data[offset] = data[offset + 1] = data[offset + 2] = channel;
  data[offset + 3] = 255;
}
