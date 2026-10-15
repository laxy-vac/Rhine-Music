import * as THREE from "three";

const SIZE = 256;
const FLOOR_EXTENT = 200;
const PANEL_WIDTH = 4.7;
const PANEL_DEPTH = 3;

/** The original lab floor is a fixed light/dark asset, independent of UI ink. */
export function musicLabFloorColor(night: boolean) { return night ? "#44423f" : "#e3e7ec"; }

export type MusicSurfaceTextures = {
  plainColor: THREE.DataTexture;
  deckColor: THREE.DataTexture;
  roughness: THREE.DataTexture;
  normal: THREE.DataTexture;
  guide: THREE.DataTexture;
};

/** Neutral, seamless surface maps for the large static music-scene floor. */
export function createMusicSurfaceTextures(): MusicSurfaceTextures {
  const plain = new Uint8Array(SIZE * SIZE * 4);
  const deck = new Uint8Array(SIZE * SIZE * 4);
  const roughness = new Uint8Array(SIZE * SIZE * 4);
  const normal = new Uint8Array(SIZE * SIZE * 4);

  for (let y = 0; y < SIZE; y++) {
    const v = y / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE;
      const phaseX = Math.PI * 2 * u;
      const phaseY = Math.PI * 2 * v;
      const grain = surfaceGrain(x, y);
      const broadGrain = Math.sin(phaseX * 2 + Math.sin(phaseY) * .25) * .35;
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      const seam = edge === 0 ? -7 : edge === 1 ? -2 : 0;
      const plainValue = clampByte(250 + grain * 6 + broadGrain);
      const deckValue = clampByte(248 + grain * 9 + broadGrain + seam);
      const roughValue = clampByte(238 + grain * 12);
      const normalX = clampByte(128 + surfaceGrain(x, y, 73) * 4);
      const normalY = clampByte(128 + surfaceGrain(x, y, 127) * 4);
      const offset = (y * SIZE + x) * 4;

      writeGray(plain, offset, plainValue);
      writeGray(deck, offset, deckValue);
      writeGray(roughness, offset, roughValue);
      normal[offset] = normalX;
      normal[offset + 1] = normalY;
      normal[offset + 2] = 255;
      normal[offset + 3] = 255;
    }
  }

  return {
    plainColor: makeTexture(plain, "Music plain floor fine finish", true),
    deckColor: makeTexture(deck, "Music lab deck panel finish", true),
    roughness: makeTexture(roughness, "Music floor roughness grain", false),
    normal: makeTexture(normal, "Music floor micro normal", false),
    guide: createGuideTexture(),
  };
}

export function disposeMusicSurfaceTextures(textures: MusicSurfaceTextures): void {
  for (const texture of new Set(Object.values(textures))) texture.dispose();
}

function makeTexture(data: Uint8Array, name: string, color: boolean): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  texture.name = name;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(FLOOR_EXTENT / PANEL_WIDTH, FLOOR_EXTENT / PANEL_DEPTH);
  texture.offset.set(-texture.repeat.x / 2, -texture.repeat.y / 2);
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function surfaceGrain(x: number, y: number, seed = 17) {
  let hash = Math.imul(x + seed, 374761393) ^ Math.imul(y + seed * 3, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967295 - .5;
}

function createGuideTexture() {
  const width = 32, height = 128, pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = Math.abs(2 * x / (width - 1) - 1), v = y / (height - 1);
    const ends = Math.min(1, v / .08, (1 - v) / .08);
    const alpha = Math.max(0, 1 - u * u) ** 2 * Math.max(0, ends);
    const offset = (y * width + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 255;
    pixels[offset + 3] = Math.round(255 * alpha);
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.name = "Music lab floor fixed orange guide falloff";
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function writeGray(data: Uint8Array, offset: number, value: number) {
  const channel = clampByte(value);
  data[offset] = channel;
  data[offset + 1] = channel;
  data[offset + 2] = channel;
  data[offset + 3] = 255;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
