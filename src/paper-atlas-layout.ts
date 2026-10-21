export type PaperAtlasTileSize = { width: number; height: number };
export type PaperAtlasPage = {
  index: number;
  start: number;
  count: number;
  rows: number;
  width: number;
  height: number;
};
export type PaperAtlasSlot = { page: number; localSlot: number };
export type PaperAtlasLayout = {
  count: number;
  columns: number;
  tileWidth: number;
  tileHeight: number;
  paged: boolean;
  pages: PaperAtlasPage[];
  locate(slot: number): PaperAtlasSlot | undefined;
};

export function albumLabelTileSizeForRows(rows: number, maxTextureSize: number, sourceHeight: number): PaperAtlasTileSize {
  const rowCount = Math.max(1, Math.floor(rows));
  const limit = Math.max(16, Math.floor(maxTextureSize));
  const height = Math.max(1, Math.floor(sourceHeight));
  const width = Math.max(1, Math.min(256, Math.floor(limit / 16), Math.floor(limit * 1024 / (rowCount * height))));
  return { width, height: Math.max(1, Math.floor(width * height / 1024)) };
}

/**
 * Keep large paper pools at the existing 432-cell tile resolution when a
 * single atlas would have to shrink its tiles. Each page has its own row
 * count, while the tile dimensions stay identical across the pages.
 */
export function createPaperAtlasLayout(
  countValue: number,
  maxTextureSizeValue: number,
  columnsValue: number,
  tileSizeForRows: (rows: number, maxTextureSize: number) => PaperAtlasTileSize,
  pageCapacityValue = 432,
): PaperAtlasLayout {
  const count = Number.isFinite(countValue) ? Math.max(0, Math.floor(countValue)) : 0;
  const maxTextureSize = Number.isFinite(maxTextureSizeValue) ? Math.max(1, Math.floor(maxTextureSizeValue)) : 4096;
  const columns = Number.isFinite(columnsValue) ? Math.max(1, Math.floor(columnsValue)) : 1;
  const pageCapacity = Number.isFinite(pageCapacityValue) ? Math.max(1, Math.floor(pageCapacityValue)) : 432;
  const rowsFor = (slotCount: number) => Math.max(1, Math.ceil(slotCount / columns));
  const normalize = (size: PaperAtlasTileSize): PaperAtlasTileSize => ({
    width: Number.isFinite(size.width) ? Math.max(1, Math.floor(size.width)) : 1,
    height: Number.isFinite(size.height) ? Math.max(1, Math.floor(size.height)) : 1,
  });
  const singleSize = normalize(tileSizeForRows(rowsFor(count), maxTextureSize));
  const baselineSize = normalize(tileSizeForRows(rowsFor(Math.min(count, pageCapacity)), maxTextureSize));
  const paged = count > pageCapacity &&
    (singleSize.width < baselineSize.width || singleSize.height < baselineSize.height);
  const tileWidth = paged ? baselineSize.width : singleSize.width;
  const tileHeight = paged ? baselineSize.height : singleSize.height;
  const pages: PaperAtlasPage[] = [];
  if (!paged) {
    const rows = rowsFor(count);
    pages.push({ index: 0, start: 0, count, rows, width: columns * tileWidth, height: rows * tileHeight });
  } else {
    for (let start = 0; start < count; start += pageCapacity) {
      const pageCount = Math.min(pageCapacity, count - start);
      const rows = rowsFor(pageCount);
      pages.push({ index: pages.length, start, count: pageCount, rows,
        width: columns * tileWidth, height: rows * tileHeight });
    }
  }
  if (!pages.length) pages.push({ index: 0, start: 0, count: 0, rows: 1,
    width: columns * tileWidth, height: tileHeight });
  const layout: PaperAtlasLayout = {
    count, columns, tileWidth, tileHeight, paged, pages,
    locate(slot: number) {
      if (!Number.isInteger(slot) || slot < 0 || slot >= count) return undefined;
      const page = pages.find(value => slot >= value.start && slot < value.start + value.count);
      return page ? { page: page.index, localSlot: slot - page.start } : undefined;
    },
  };
  return layout;
}
