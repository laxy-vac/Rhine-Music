import * as THREE from "three";

const SIZE = 256;
const WORLD_TILES = 50;

export type MusicSurfaceTextures = {
  plainColor: THREE.DataTexture;
  deckColor: THREE.DataTexture;
  roughness: THREE.DataTexture;
  normal: THREE.DataTexture;
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
      const grain = Math.sin(phaseX * 7 + Math.sin(phaseY * 3) * .7) * .8 +
        Math.sin(phaseY * 17 + phaseX * 2) * .45;
      const brush = Math.sin(phaseY * 13 + Math.sin(phaseX * 3) * .22) * 1.8 +
        Math.sin(phaseY * 7 + phaseX * 2) * .65;
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      const seam = edge < 2 ? -10 : 0;
      const plainValue = clampByte(250 + grain * 2.5);
      const deckValue = clampByte(250 + brush + grain * .9 + seam);
      const roughValue = clampByte(246 + Math.sin(phaseX * 5 + phaseY * 4) * 5.5);
      const normalX = clampByte(128 + Math.sin(phaseY * 13 + phaseX * 3) * 4);
      const normalY = clampByte(128 + Math.sin(phaseX * 11 + phaseY * 2) * 4);
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
  texture.repeat.set(WORLD_TILES, WORLD_TILES);
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
