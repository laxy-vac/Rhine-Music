import { defaultMusicViewSettings, normalizeMusicViewSettings, type MusicViewSettings } from "./music-view-settings";

export type MusicMode = "archive" | "detail";
export type AlbumInfoTab = "tracks" | "about";

export interface CatalogFocus {
  entryKey: string;
  albumId: string;
  trackId?: string;
}

/** Player context and functional settings; no theme, DOM or rendering coordinates. */
export class MusicApplicationState {
  selectedIndex = 0;
  selectedAlbumId: string | undefined;
  mode: MusicMode = "archive";
  activeTab: AlbumInfoTab = "tracks";
  infoScrollTop = 0;
  private focusValue: CatalogFocus | undefined;
  private viewValue: Readonly<MusicViewSettings>;
  private queryValue = "";
  private gridPageValue = 0;
  private catalogRevisionValue = 0;
  private spatialLayoutValue: "shelf" | "array";

  constructor(view: MusicViewSettings = defaultMusicViewSettings) {
    this.viewValue = Object.freeze(normalizeMusicViewSettings(view));
    this.spatialLayoutValue = this.viewValue.layout === "grid" ? "array" : this.viewValue.layout;
  }

  get view() { return this.viewValue; }
  get query() { return this.queryValue; }
  get gridPage() { return this.gridPageValue; }
  get catalogRevision() { return this.catalogRevisionValue; }
  get spatialLayout() { return this.spatialLayoutValue; }
  get catalogFocus() { return this.focusValue ? { ...this.focusValue } : undefined; }
  get selectedTrackId() {
    return this.focusValue?.albumId === this.selectedAlbumId ? this.focusValue?.trackId : undefined;
  }

  setGridPage(page: number) {
    this.gridPageValue = Number.isFinite(page) ? Math.max(0, Math.floor(page)) : 0;
  }

  configureView(next: Partial<MusicViewSettings>, query = this.queryValue) {
    const view = normalizeMusicViewSettings({ ...this.viewValue, ...next });
    const text = query.trim();
    if (view.layout === this.viewValue.layout && view.show === this.viewValue.show &&
      view.group === this.viewValue.group && view.sort === this.viewValue.sort &&
      view.gridPageSize === this.viewValue.gridPageSize && text === this.queryValue) return;
    const gridResultsChanged = view.show !== this.viewValue.show || view.group !== this.viewValue.group ||
      view.sort !== this.viewValue.sort || view.gridPageSize !== this.viewValue.gridPageSize || text !== this.queryValue;
    this.viewValue = Object.freeze(view);
    if (view.layout !== "grid") this.spatialLayoutValue = view.layout;
    this.queryValue = text;
    if (gridResultsChanged) this.gridPageValue = 0;
    this.catalogRevisionValue++;
  }

  focusEntry(focus: CatalogFocus) { this.focusValue = { ...focus }; }

  selectAlbum(index: number, albumId: string | undefined) {
    if (albumId !== this.selectedAlbumId) this.infoScrollTop = 0;
    this.selectedIndex = index;
    this.selectedAlbumId = albumId;
  }

  /** Library reorder keeps album identity; removal follows the existing first-album fallback. */
  reconcileAlbums(albumIds: readonly string[], hasTrack?: (albumId: string, trackId: string) => boolean) {
    const index = this.selectedAlbumId ? albumIds.indexOf(this.selectedAlbumId) : -1;
    this.selectAlbum(index >= 0 ? index : 0, albumIds[index >= 0 ? index : 0]);
    if (this.focusValue && (!albumIds.includes(this.focusValue.albumId) ||
      (this.focusValue.trackId && hasTrack && !hasTrack(this.focusValue.albumId, this.focusValue.trackId))))
      this.focusValue = undefined;
  }
}

// Preserve the legacy catalog's initial shelf until the app loads global preferences.
export const musicApplication = new MusicApplicationState({ ...defaultMusicViewSettings, layout: "shelf" });
