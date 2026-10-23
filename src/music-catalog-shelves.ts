import { records, type ArchiveRecord } from "./data";
import { MUSIC_SHELF_VIEW } from "./music-display-layout";
import {
  getMusicCatalogGroups,
  getMusicCatalogOptions,
  getMusicCatalogVersion,
  getMusicDisplayEntries,
  getMusicEntryByKey,
  getMusicFocusedEntry,
  type MusicDisplayEntry,
} from "./music-catalog";

export interface MusicCatalogShelf {
  /** Stable identity derived from the group's segmented shelf positions. */
  readonly id: string;
  readonly name: string;
  readonly names: readonly string[];
  readonly entryKeys: readonly string[];
}

export interface MusicEntryLocation {
  shelf: number;
  slot: number;
}

const SHELF_SLOTS = MUSIC_SHELF_VIEW.slots;

interface ShelfSegment {
  key: string;
  name: string;
  part: number;
  parts: number;
}

interface BuildingShelf {
  entryKeys: string[];
  segments: ShelfSegment[];
  used: number;
}

let cachedSource: ArchiveRecord[] | undefined;
let cachedShelves: MusicCatalogShelf[] = [];
let cachedLocations = new Map<string, MusicEntryLocation>();
let cachedCatalogVersion = -1;
const rememberedSlots = new Map<string, number>();

function rebuildShelves(source: ArchiveRecord[], catalogVersion: number) {
  if (cachedSource !== source) rememberedSlots.clear();
  const building: BuildingShelf[] = [];
  const groupSegments = new Map<string, ShelfSegment[]>();
  let current: BuildingShelf | undefined;

  const openShelf = () => {
    current = { entryKeys: [], segments: [], used: 0 };
    building.push(current);
  };

  getMusicCatalogGroups().forEach(({ key, name, entryKeys }) => {
    for (let offset = 0; offset < entryKeys.length;) {
      if (!current || current.used >= SHELF_SLOTS) openShelf();
      const shelf = current!;
      const count = Math.min(entryKeys.length - offset, SHELF_SLOTS - shelf.used);
      const segment: ShelfSegment = { key, name, part: 0, parts: 0 };
      shelf.entryKeys.push(...entryKeys.slice(offset, offset + count));
      shelf.segments.push(segment);
      const parts = groupSegments.get(key) ?? [];
      parts.push(segment);
      groupSegments.set(key, parts);
      shelf.used += count;
      offset += count;
    }
  });

  for (const segments of groupSegments.values()) {
    segments.forEach((segment, index) => {
      segment.part = index + 1;
      segment.parts = segments.length;
    });
  }

  cachedShelves = building.map(({ entryKeys, segments }, index) => {
    const names = segments.length > 1
      ? segments.map(segment => segment.name)
      : segments[0]
        ? [segments[0].name + (segments[0].parts > 1 ? "  " + segments[0].part + " / " + segments[0].parts : "")]
        : [];
    return {
      id: segments.map(segment => `${segment.key}:${segment.part}`).join("+") || `empty:${index}`,
      name: names.join("  ·  "),
      names,
      entryKeys,
    };
  });

  cachedLocations = new Map<string, MusicEntryLocation>();
  const entryKeys = new Set(getMusicDisplayEntries().map(entry => entry.key));
  cachedShelves.forEach((shelf, shelfIndex) => {
    shelf.entryKeys.forEach((key, slot) => {
      if (entryKeys.has(key) && !cachedLocations.has(key))
        cachedLocations.set(key, { shelf: shelfIndex, slot });
    });
  });
  cachedSource = source;
  cachedCatalogVersion = catalogVersion;
}

function ensureShelves(): MusicCatalogShelf[] {
  const catalogVersion = getMusicCatalogVersion();
  if (cachedSource !== records || cachedCatalogVersion !== catalogVersion)
    rebuildShelves(records, catalogVersion);
  return cachedShelves;
}

export function getMusicCatalogShelves(): readonly MusicCatalogShelf[] {
  return ensureShelves();
}

export function getMusicEntryLocation(key: string): MusicEntryLocation | null {
  const shelves = ensureShelves();
  const location = cachedLocations.get(key) ?? null;
  if (location) rememberedSlots.set(shelves[location.shelf]?.id ?? String(location.shelf), location.slot);
  return location ? { ...location } : null;
}

/** Compatibility lookup for album-level callers; TRACKS resolves through the focused entry. */
export function getMusicRecordLocation(recordIndex: number): MusicEntryLocation | null {
  const entry = getMusicFocusedEntry(recordIndex);
  return entry ? getMusicEntryLocation(entry.key) : null;
}

/** Navigate by shelf/slot and return the destination entry without changing application focus. */
export function navigateMusicEntry(
  recordIndex: number,
  axis: "row" | "lane",
  direction: number,
): MusicDisplayEntry | undefined {
  const entry = getMusicFocusedEntry(recordIndex);
  const shelves = ensureShelves();
  const location = entry ? cachedLocations.get(entry.key) : undefined;
  const step = Math.trunc(direction);
  if (!entry || !location || !step) return undefined;

  const currentShelf = shelves[location.shelf];
  if (currentShelf) rememberedSlots.set(currentShelf.id, location.slot);
  const wraps = getMusicCatalogOptions().layout === "array";
  const targetShelf = axis === "row"
    ? location.shelf
    : wraps
      ? wrapIndex(location.shelf + step, shelves.length)
      : location.shelf + step;
  const shelf = shelves[targetShelf];
  if (!shelf?.entryKeys.length) return undefined;
  const requestedSlot = axis === "row" ? location.slot + step : rememberedSlots.get(shelf.id) ?? 0;
  const targetSlot = wraps
    ? wrapIndex(requestedSlot, shelf.entryKeys.length)
    : Math.max(0, Math.min(shelf.entryKeys.length - 1, requestedSlot));
  const target = getMusicEntryByKey(shelf.entryKeys[targetSlot]);
  if (!target || target.key === entry.key) return undefined;

  // Preserve the prior shelf-slot memory behavior; the caller commits focus explicitly.
  getMusicEntryLocation(target.key);
  return target;
}

function wrapIndex(value: number, count: number) {
  if (count <= 0) return 0;
  return ((value % count) + count) % count;
}
