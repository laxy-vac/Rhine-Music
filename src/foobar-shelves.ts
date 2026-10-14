import { focusMusicEntry, getMusicEntryByKey } from "./music-catalog";
import {
  getMusicCatalogShelves,
  getMusicEntryLocation,
  getMusicRecordLocation,
  navigateMusicEntry,
  type MusicCatalogShelf,
} from "./music-catalog-shelves";

export interface FoobarShelf {
  readonly name: string;
  /** Display-entry indexes; resolve them with getFoobarEntry(). */
  records: readonly number[];
}

export interface FoobarLocation {
  shelf: number;
  slot: number;
}

let cachedMusicShelves: readonly MusicCatalogShelf[] | undefined;
let cachedFoobarShelves: readonly FoobarShelf[] = [];

export function getFoobarShelves(): readonly FoobarShelf[] {
  const shelves = getMusicCatalogShelves();
  if (shelves !== cachedMusicShelves) {
    cachedMusicShelves = shelves;
    cachedFoobarShelves = shelves.map(shelf => ({
      name: shelf.name,
      records: shelf.entryKeys.flatMap(key => {
        const entry = getMusicEntryByKey(key);
        return entry ? [entry.index] : [];
      }),
    }));
  }
  return cachedFoobarShelves;
}

export function getFoobarEntryLocation(key: string): FoobarLocation | null {
  return getMusicEntryLocation(key);
}

/** Compatibility lookup for album-level callers; TRACKS resolves through the focused visible entry. */
export function getFoobarLocation(recordIndex: number): FoobarLocation | null {
  return getMusicRecordLocation(recordIndex);
}

/** Preserve the old return value and focus side effect for existing Archive callers. */
export function navigateFoobar(recordIndex: number, axis: "row" | "lane", direction: number): number | null {
  const target = navigateMusicEntry(recordIndex, axis, direction);
  if (!target) return null;
  focusMusicEntry(target.key);
  return target.recordIndex;
}
