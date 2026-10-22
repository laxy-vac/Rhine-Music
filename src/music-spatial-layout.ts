import type { ArchiveCell, ArchiveNavigation } from "./archive-loop";
import { records } from "./data";
import { musicArrayCell, musicArrayEntry, musicArraySelectionCell } from "./music-array-layout";
import { getMusicEntryByKey, getMusicFocusedEntry, type MusicDisplayEntry } from "./music-catalog";
import { getMusicCatalogShelves, getMusicEntryLocation } from "./music-catalog-shelves";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "./music-display-layout";

let cachedRecordSource: typeof records | undefined;
let cachedDemoRecords = false;

function hasDemoRecords() {
  if (cachedRecordSource !== records) {
    cachedRecordSource = records;
    cachedDemoRecords = records.length > 0 && records.every(record =>
      typeof record.album?.id === "string" && record.album.id.startsWith("demo-"));
  }
  return cachedDemoRecords;
}

/** Resolve finite shelf coordinates or delegate to the existing looping array. */
export function musicSpatialEntry(cell: ArchiveCell, shelf: boolean): MusicDisplayEntry | undefined {
  if (!shelf) return musicArrayEntry(cell);
  const slot = cell.row - MUSIC_ARRAY_VIEW.firstRow;
  if (!Number.isInteger(cell.lane) || !Number.isInteger(slot) || slot < 0 || slot >= MUSIC_SHELF_VIEW.slots)
    return undefined;
  const shelves = getMusicCatalogShelves();
  if (!shelves.length) return undefined;
  const lane = hasDemoRecords() ? ((cell.lane % shelves.length) + shelves.length) % shelves.length : cell.lane;
  const key = shelves[lane]?.entryKeys[slot];
  return key === undefined ? undefined : getMusicEntryByKey(key);
}

/** Rebind identity from the current catalog; never retain a stale cell key. */
export function musicSpatialCell(cell: ArchiveCell, shelf: boolean): ArchiveCell {
  if (!shelf) return musicArrayCell(cell);
  const entry = musicSpatialEntry(cell, true);
  return { lane: cell.lane, row: cell.row,
    ...(entry ? { foobarEntryKey: entry.key, foobarTrackId: entry.trackId } : {}) };
}

/** A shelf selection has one canonical occurrence, including same-album tracks. */
export function musicSpatialSelectionCell(
  index: number, current: ArchiveCell, shelf: boolean, navigation?: ArchiveNavigation,
): ArchiveCell {
  if (!shelf) return musicArraySelectionCell(index, current, navigation);
  const requested = navigation && "cell" in navigation ? navigation.cell : undefined;
  const candidate = requested?.foobarEntryKey ? getMusicEntryByKey(requested.foobarEntryKey) : undefined;
  const requestedLocation = candidate?.recordIndex === index ? getMusicEntryLocation(candidate.key) : null;
  const entry = requestedLocation ? candidate : getMusicFocusedEntry(index);
  const location = requestedLocation ?? (entry && getMusicEntryLocation(entry.key));
  if (!entry || !location) return { lane: 0, row: MUSIC_ARRAY_VIEW.firstRow };
  return { lane: location.shelf, row: MUSIC_ARRAY_VIEW.firstRow + location.slot,
    foobarEntryKey: entry.key, foobarTrackId: entry.trackId };
}

/** Keep the allocated lane blocks; unused rows and out-of-range lanes stay empty. */
export function musicShelfPoolCell(index: number, centerLane: number, rows: number): ArchiveCell {
  return { lane: Math.floor(centerLane) - 1 + Math.floor(index / rows),
    row: MUSIC_ARRAY_VIEW.firstRow + index % rows };
}
