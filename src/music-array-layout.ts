import type { ArchiveCell, ArchiveNavigation } from "./archive-loop";
import { nearestOccurrence, wrap } from "./archive-loop";
import { getMusicEntryByKey, getMusicFocusedEntry, type MusicDisplayEntry } from "./music-catalog";
import { getMusicEntryLocation, getMusicCatalogShelves } from "./music-catalog-shelves";
import { MUSIC_ARRAY_VIEW, MUSIC_SHELF_VIEW } from "./music-display-layout";

const ARRAY_ROW_SLOTS = MUSIC_SHELF_VIEW.slots;

function directionalOccurrence(value: number, current: number, direction: number, period: number) {
  const sign = Math.sign(direction);
  if (!sign) return nearestOccurrence(value, current, period);
  const cycles = (current - value) / period;
  return value + (sign > 0 ? Math.floor(cycles) + 1 : Math.ceil(cycles) - 1) * period;
}

/** Project the shared filtered catalog into the reusable, unbounded array pool. */
export function musicArrayEntry(cell: ArchiveCell): MusicDisplayEntry | undefined {
  const shelves = getMusicCatalogShelves();
  const shelf = shelves[wrap(cell.lane, shelves.length)];
  if (!shelf?.entryKeys.length) return undefined;
  const key = shelf.entryKeys[wrap(cell.row - MUSIC_ARRAY_VIEW.firstRow, shelf.entryKeys.length)];
  return key === undefined ? undefined : getMusicEntryByKey(key);
}

export function musicArrayCell(cell: ArchiveCell): ArchiveCell {
  const entry = musicArrayEntry(cell);
  return { lane: cell.lane, row: cell.row,
    ...(entry ? { foobarEntryKey: entry.key, foobarTrackId: entry.trackId } : {}) };
}

/** Keep the physical lane and nearest integer row while resolving its repeated entry. */
export function musicArraySnapCell(cell: ArchiveCell): ArchiveCell {
  const shelves = getMusicCatalogShelves();
  if (!Number.isInteger(cell.lane) || !Number.isFinite(cell.row) || !shelves.length)
    return { lane: cell.lane, row: cell.row };

  const shelf = shelves[wrap(cell.lane, shelves.length)];
  if (!shelf?.entryKeys.length) return { lane: cell.lane, row: cell.row };
  return musicArrayCell({ lane: cell.lane, row: Math.round(cell.row) });
}

export function musicArraySelectionCell(index: number, current: ArchiveCell, navigation?: ArchiveNavigation): ArchiveCell {
  const requested = navigation && "cell" in navigation ? navigation.cell : undefined;
  const candidate = requested?.foobarEntryKey ? getMusicEntryByKey(requested.foobarEntryKey) : getMusicFocusedEntry(index);
  const entry = candidate?.recordIndex === index ? candidate : undefined;
  const location = entry && getMusicEntryLocation(entry.key);
  if (!entry || !location) return { lane: 0, row: MUSIC_ARRAY_VIEW.firstRow };
  if (requested && musicArrayEntry(requested)?.key === entry.key) return musicArrayCell(requested);
  const shelves = getMusicCatalogShelves();
  const period = shelves[location.shelf]?.entryKeys.length || ARRAY_ROW_SLOTS;
  const targetRow = navigation && "axis" in navigation && navigation.axis === "row"
    ? directionalOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, navigation.direction, period)
    : nearestOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, period);
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
