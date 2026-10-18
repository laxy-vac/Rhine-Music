import type { ArchiveCell } from "./archive-loop";
import type { CanonicalSlot } from "./music-layout-transition";

type Column = { first: number; last: number; count: number };
// Scene catalogs are immutable snapshots, replaced on catalog-version changes.
const columnCache = new WeakMap<ReadonlyMap<string, CanonicalSlot>, Map<number, Column>>();

/** Freeze one loop occurrence of each finite ARRAY column inside the MATRIX pool. */
export function musicLayoutAddresses(catalog: ReadonlyMap<string, CanonicalSlot>, arraySelection: ArchiveCell,
  matrixSelection: ArchiveCell, matrixCells: readonly ArchiveCell[]) {
  const laneOffset = matrixSelection.lane - arraySelection.lane;
  const selectedOffset = matrixSelection.row - arraySelection.row;
  let columns = columnCache.get(catalog);
  if (!columns) {
    columns = new Map<number, Column>();
    for (const slot of catalog.values()) {
      const column = columns.get(slot.lane) ?? { first: slot.row, last: slot.row, count: 0 };
      column.first = Math.min(column.first, slot.row); column.last = Math.max(column.last, slot.row); column.count++;
      columns.set(slot.lane, column);
    }
    columnCache.set(catalog, columns);
  }
  const windows = new Map<number, { first: number; last: number }>();
  for (const cell of matrixCells) if (cell.foobarEntryKey) {
    const window = windows.get(cell.lane) ?? { first: cell.row, last: cell.row };
    window.first = Math.min(window.first, cell.row); window.last = Math.max(window.last, cell.row); windows.set(cell.lane, window);
  }
  const rowOffsets = new Map<number, number>();
  for (const [lane, column] of columns) {
    const period = column.count, window = windows.get(lane + laneOffset);
    let cycle = Math.round(selectedOffset / period);
    if (lane === arraySelection.lane) {
      rowOffsets.set(lane, selectedOffset); continue;
    }
    if (window) {
      // Keep a complete resident column in the actual pool, with a one-row
      // buffer against the nearest-occurrence tie at either pool boundary.
      const low = Math.ceil((window.first + 1 - column.first) / period);
      const high = Math.floor((window.last - 1 - column.last) / period);
      if (low <= high) cycle = Math.max(low, Math.min(high, cycle));
    }
    rowOffsets.set(lane, cycle * period);
  }
  const rowOffset = (cell: ArchiveCell) => rowOffsets.get(catalog.get(cell.foobarEntryKey ?? "")?.lane ?? cell.lane) ?? selectedOffset;
  return {
    laneOffset, rowOffsets,
    toArray: (cell: ArchiveCell): ArchiveCell => ({ ...cell, lane: cell.lane - laneOffset, row: cell.row - rowOffset(cell) }),
    toMatrix: (cell: ArchiveCell): ArchiveCell => ({ ...cell, lane: cell.lane + laneOffset, row: cell.row + rowOffset(cell) }),
  };
}
