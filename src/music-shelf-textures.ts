import * as THREE from "three";

/** Small shared maps for the tray, independent of the selected scene floor. */
export function createMusicShelfTextures() {
  const size = 256;
  // A slot is much wider than it is deep. Square color maps were minified
  // heavily along its short axis, erasing the reference's fine matte grain.
  const bedHeight = 64;
  const bed = new Uint8Array(size * bedHeight * 4);
  const endBed = new Uint8Array(size * bedHeight * 4);
  const roughness = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < bedHeight; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const noise = grain(x, y);
    const brush = Math.sin(y * Math.PI * 2 * 13 / bedHeight + Math.sin(x * Math.PI * 2 / size) * .12);
    const v = y / (bedHeight - 1);
    const shade = smooth(.12, .24, v) * (1 - smooth(.72, .86, v));
    gray(bed, offset, 245 - shade * 40 + noise * 26 + brush);
    gray(endBed, offset, 245 + noise * 26 + brush);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const offset = (y * size + x) * 4;
    const noise = grain(x, y);
    const brush = Math.sin(y * Math.PI * 2 * 53 / size + Math.sin(x * Math.PI * 2 / size) * .12);
    gray(roughness, offset, 222 + noise * 16 + brush * 4);
    normal[offset] = Math.round(128 + noise * 3);
    normal[offset + 1] = Math.round(128 + brush + noise * 3);
    normal[offset + 2] = 255;
    normal[offset + 3] = 255;
  }
  const hazard = new Uint8Array(128 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++)
    gray(hazard, (y * 128 + x) * 4, (x + y) % 32 < 16 ? 255 : 40);
  const contactShadow = new Uint8Array(64 * 64 * 4);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const offset = (y * 64 + x) * 4;
    const radius = ((x - 31.5) / 31.5) ** 2 + ((y - 31.5) / 31.5) ** 2;
    contactShadow[offset] = contactShadow[offset + 1] = contactShadow[offset + 2] = 255;
    contactShadow[offset + 3] = Math.round(255 * Math.max(0, 1 - radius) ** 2);
  }

  return {
    bed: texture(bed, size, bedHeight, "Music tray fine matte grain", true),
    endBed: texture(endBed, size, bedHeight, "Music tray end platform grain", true),
    roughness: texture(roughness, size, size, "Music tray brushed metal roughness"),
    normal: texture(normal, size, size, "Music tray machining micro normal"),
    hazard: texture(hazard, 128, 32, "Music tray end safety stripes", true),
    contactShadow: texture(contactShadow, 64, 64, "Music tray foot contact occlusion"),
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
  map.anisotropy = 4;
  map.needsUpdate = true;
  return map;
}

function grain(x: number, y: number) {
  let value = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295 - .5;
}

function gray(data: Uint8Array, offset: number, value: number) {
  const channel = Math.max(0, Math.min(255, Math.round(value)));
  data[offset] = data[offset + 1] = data[offset + 2] = channel;
  data[offset + 3] = 255;
}

function smooth(start: number, end: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
