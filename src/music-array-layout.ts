import type { ArchiveCell, ArchiveNavigation } from "./archive-loop";
import { nearestOccurrence, wrap } from "./archive-loop";
import { getMusicEntryByKey, getMusicFocusedEntry, type MusicDisplayEntry } from "./music-catalog";
import { getMusicEntryLocation, getMusicCatalogShelves } from "./music-catalog-shelves";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "./music-display-layout";

const ARRAY_ROW_SLOTS = MUSIC_SHELF_VIEW.slots;

function directionalOccurrence(value: number, current: number, direction: number) {
  const sign = Math.sign(direction);
  if (!sign) return nearestOccurrence(value, current, ARRAY_ROW_SLOTS);
  const cycles = (current - value) / ARRAY_ROW_SLOTS;
  return value + (sign > 0 ? Math.floor(cycles) + 1 : Math.ceil(cycles) - 1) * ARRAY_ROW_SLOTS;
}

/** Project the shared filtered catalog into the reusable, unbounded array pool. */
export function musicArrayEntry(cell: ArchiveCell): MusicDisplayEntry | undefined {
  const shelves = getMusicCatalogShelves();
  const shelf = shelves[wrap(cell.lane, shelves.length)];
  if (!shelf) return undefined;
  const key = shelf.entryKeys[wrap(cell.row - MUSIC_ARRAY_VIEW.firstRow, ARRAY_ROW_SLOTS)];
  return key === undefined ? undefined : getMusicEntryByKey(key);
}

export function musicArrayCell(cell: ArchiveCell): ArchiveCell {
  const entry = musicArrayEntry(cell);
  return { lane: cell.lane, row: cell.row,
    ...(entry ? { foobarEntryKey: entry.key, foobarTrackId: entry.trackId } : {}) };
}

/** Keep the physical lane occurrence while snapping a blank loop row to a nearby occupied slot. */
export function musicArraySnapCell(cell: ArchiveCell): ArchiveCell {
  const shelves = getMusicCatalogShelves();
  if (!Number.isInteger(cell.lane) || !Number.isFinite(cell.row) || !shelves.length)
    return { lane: cell.lane, row: cell.row };

  const shelf = shelves[wrap(cell.lane, shelves.length)];
  if (!shelf?.entryKeys.length) return { lane: cell.lane, row: cell.row };

  const cycle = Math.floor((cell.row - MUSIC_ARRAY_VIEW.firstRow) / ARRAY_ROW_SLOTS);
  const count = Math.min(shelf.entryKeys.length, ARRAY_ROW_SLOTS);
  let nearestRow: number | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let offset = -1; offset <= 1; offset++) {
    const first = MUSIC_ARRAY_VIEW.firstRow + (cycle + offset) * ARRAY_ROW_SLOTS;
    for (let slot = 0; slot < count; slot++) {
      const row = first + slot;
      const distance = Math.abs(row - cell.row);
      if (distance < nearestDistance || (distance === nearestDistance && row < nearestRow!)) {
        nearestDistance = distance;
        nearestRow = row;
      }
    }
  }
  return nearestRow === undefined ? { lane: cell.lane, row: cell.row } : musicArrayCell({ lane: cell.lane, row: nearestRow });
}

export function musicArraySelectionCell(index: number, current: ArchiveCell, navigation?: ArchiveNavigation): ArchiveCell {
  const requested = navigation && "cell" in navigation ? navigation.cell : undefined;
  const candidate = requested?.foobarEntryKey ? getMusicEntryByKey(requested.foobarEntryKey) : getMusicFocusedEntry(index);
  const entry = candidate?.recordIndex === index ? candidate : undefined;
  const location = entry && getMusicEntryLocation(entry.key);
  if (!entry || !location) return { lane: 0, row: MUSIC_ARRAY_VIEW.firstRow };
  if (requested && musicArrayEntry(requested)?.key === entry.key) return musicArrayCell(requested);
  const shelves = getMusicCatalogShelves();
  const targetRow = navigation && "axis" in navigation && navigation.axis === "row"
    ? directionalOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, navigation.direction)
    : nearestOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, ARRAY_ROW_SLOTS);
  const directed = navigation && "axis" in navigation ? {
    lane: navigation.axis === "lane" ? current.lane + navigation.direction : current.lane,
    row: targetRow,
  } : undefined;
  if (directed && musicArrayEntry(directed)?.key === entry.key) return musicArrayCell(directed);
  return musicArrayCell({
    lane: nearestOccurrence(location.shelf, current.lane, shelves.length),
    row: targetRow,
  });
}
