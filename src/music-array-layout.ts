import type { ArchiveCell, ArchiveNavigation } from "./archive-loop";
import { nearestOccurrence, wrap } from "./archive-loop";
import { getMusicEntryByKey, getMusicFocusedEntry, type MusicDisplayEntry } from "./music-catalog";
import { getMusicEntryLocation, getMusicCatalogShelves } from "./music-catalog-shelves";
import { MUSIC_ARRAY_VIEW } from "./music-display-layout";

/** Project the shared filtered catalog into the reusable, unbounded array pool. */
export function musicArrayEntry(cell: ArchiveCell): MusicDisplayEntry | undefined {
  const shelves = getMusicCatalogShelves();
  const shelf = shelves[wrap(cell.lane, shelves.length)];
  if (!shelf?.entryKeys.length) return undefined;
  return getMusicEntryByKey(shelf.entryKeys[wrap(cell.row - MUSIC_ARRAY_VIEW.firstRow, shelf.entryKeys.length)]);
}

export function musicArrayCell(cell: ArchiveCell): ArchiveCell {
  const entry = musicArrayEntry(cell);
  return { lane: cell.lane, row: cell.row,
    ...(entry ? { foobarEntryKey: entry.key, foobarTrackId: entry.trackId } : {}) };
}

export function musicArraySelectionCell(index: number, current: ArchiveCell, navigation?: ArchiveNavigation): ArchiveCell {
  const requested = navigation && "cell" in navigation ? navigation.cell : undefined;
  const candidate = requested?.foobarEntryKey ? getMusicEntryByKey(requested.foobarEntryKey) : getMusicFocusedEntry(index);
  const entry = candidate?.recordIndex === index ? candidate : undefined;
  const location = entry && getMusicEntryLocation(entry.key);
  if (!entry || !location) return { lane: 0, row: MUSIC_ARRAY_VIEW.firstRow };
  if (requested && musicArrayEntry(requested)?.key === entry.key) return musicArrayCell(requested);
  const shelves = getMusicCatalogShelves();
  const directed = navigation && "axis" in navigation ? {
    lane: navigation.axis === "lane" ? current.lane + navigation.direction : current.lane,
    row: navigation.axis === "row" ? current.row + navigation.direction
      : nearestOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, shelves[location.shelf].entryKeys.length),
  } : undefined;
  if (directed && musicArrayEntry(directed)?.key === entry.key) return musicArrayCell(directed);
  return musicArrayCell({
    lane: nearestOccurrence(location.shelf, current.lane, shelves.length),
    row: nearestOccurrence(location.slot + MUSIC_ARRAY_VIEW.firstRow, current.row, shelves[location.shelf].entryKeys.length),
  });
}
