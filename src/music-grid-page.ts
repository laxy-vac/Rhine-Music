import { musicApplication } from "./music-application-state";
import { getMusicCatalogGroups } from "./music-catalog";
import { musicGridPageSizes, type MusicGridPageSize } from "./music-view-settings";

/** Page the public entry sequence without changing its groups or selection. */
export function paginateMusicGridGroups<T extends { entryKeys: string[] }>(
  groups: readonly T[], size: number, page: number,
) {
  const pageSize = musicGridPageSizes.includes(size as MusicGridPageSize) ? size : 36;
  const total = groups.reduce((count, group) => count + group.entryKeys.length, 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const pageIndex = Math.max(0, Math.min(pageCount - 1, Number.isFinite(page) ? Math.floor(page) : 0));
  const start = pageIndex * pageSize;
  const end = Math.min(total, start + pageSize);
  let offset = 0;
  const visibleGroups = groups.flatMap((group, index) => {
    const groupStart = offset;
    offset += group.entryKeys.length;
    const entryKeys = group.entryKeys.slice(Math.max(0, start - groupStart), Math.max(0, end - groupStart));
    return entryKeys.length ? [{ group, index, entryKeys }] : [];
  });
  return { pageIndex, pageSize, pageCount, total, start, end, groups: visibleGroups };
}

export function getMusicGridPage() {
  return paginateMusicGridGroups(getMusicCatalogGroups(), musicApplication.view.gridPageSize, musicApplication.gridPage);
}

/** Keyboard or external selection reveals its page; manual paging keeps selection. */
export function revealMusicGridEntry(key: string) {
  const keys = getMusicCatalogGroups().flatMap(group => group.entryKeys);
  const index = keys.indexOf(key);
  if (index >= 0) musicApplication.setGridPage(Math.floor(index / getMusicGridPage().pageSize));
}
