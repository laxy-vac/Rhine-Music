import type { ArchiveCell } from "./archive-loop";

export type MusicLayoutRise = { start: number; end: number; edgeDistance: number; alongDistance: number };

/** A continuous wave grows out of the finite ARRAY field, never out of pool order. */
export function musicLayoutRiseSchedule(residents: readonly ArchiveCell[], selection: ArchiveCell) {
  const columns = new Map<number, { first: number; last: number }>();
  for (const cell of residents) {
    const range = columns.get(cell.lane) ?? { first: cell.row, last: cell.row };
    range.first = Math.min(range.first, cell.row); range.last = Math.max(range.last, cell.row);
    columns.set(cell.lane, range);
  }
  return (cell: ArchiveCell): MusicLayoutRise => {
    let edgeDistance = Infinity;
    for (const [lane, range] of columns) {
      const rowGap = Math.max(range.first - cell.row, 0, cell.row - range.last);
      edgeDistance = Math.min(edgeDistance, Math.hypot(4 * (cell.lane - lane), rowGap));
    }
    if (!Number.isFinite(edgeDistance)) edgeDistance = 0;
    // Break up a whole-column lift with a shallow, symmetric sweep along rows.
    const alongDistance = Math.abs(cell.row - selection.row) * .36;
    const start = .18 + .34 * (1 - Math.exp(-(edgeDistance + alongDistance) / 9));
    return { start, end: start + .44, edgeDistance, alongDistance };
  };
}
