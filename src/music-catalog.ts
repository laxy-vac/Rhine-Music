import { records, type ArchiveRecord } from "./data";
import type { MusicAlbum, MusicTrack } from "./music-types";
import { leadMusicArtist } from "./music-order.ts";
import { musicApplication } from "./music-application-state";
import type { MusicViewSettings } from "./music-view-settings";

/** A theme-neutral display item backed by a canonical album and optional track. */
export interface MusicDisplayEntry {
  /** Position in the current, unfiltered display-entry array. */
  index: number;
  /** Stable identity for this album or track display item. */
  key: string;
  /** Canonical album identity, matching the current records compatibility bridge. */
  albumId: string;
  /** Track identity when this entry represents one track. */
  trackId?: string;
  /** Canonical index into the album-based records compatibility array. */
  recordIndex: number;
  /** Legacy display projection; track entries receive a copy, never mutate records. */
  record: ArchiveRecord;
  /** Canonical album object, kept by reference when available. */
  album?: MusicAlbum;
  /** Present when this entry represents one track. */
  track?: MusicTrack;
}

export interface MusicCatalogGroup {
  key: string;
  name: string;
  entryKeys: string[];
}

let cachedSource: ArchiveRecord[] | undefined;
let cachedVersion = -1;
let displayVersion = 0;
let cachedGroups: MusicCatalogGroup[] = [];
let cachedEntrySource: ArchiveRecord[] | undefined;
let cachedEntryShow: MusicViewSettings["show"] | undefined;
let cachedDisplayEntries: MusicDisplayEntry[] = [];
let entriesByKey = new Map<string, MusicDisplayEntry>();
let visibleEntries = new Set<number>();
let firstVisibleByRecord = new Map<number, MusicDisplayEntry>();

const compareText = (a: string, b: string) =>
  a.localeCompare(b, "zh-CN", { sensitivity: "base", numeric: true });

const albumOf = (entry: MusicDisplayEntry) => entry.album ?? entry.record.album;
const artistOf = (entry: MusicDisplayEntry) =>
  entry.track?.artist?.trim() || albumOf(entry)?.artist || entry.record.en || entry.record.lead || "";
const leadArtistOf = (entry: MusicDisplayEntry) => {
  if (entry.track) {
    if (entry.track.artists?.length) return leadMusicArtist(entry.track.artist, entry.track.artists);
    if (entry.track.artist?.trim()) return leadMusicArtist(entry.track.artist);
  }
  const album = albumOf(entry);
  if (album) return leadMusicArtist(album.artist, album.artists);
  return leadMusicArtist(entry.record.en || entry.record.lead || "");
};
const leadArtistKeyOf = (entry: MusicDisplayEntry) => leadArtistOf(entry)
  .normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
const titleOf = (entry: MusicDisplayEntry) => entry.track
  ? trackTitle(entry.track)
  : albumOf(entry)?.title || entry.record.title || "";
const albumKeyOf = (entry: MusicDisplayEntry) => albumOf(entry)?.id || entry.albumId;
const trackOrdinal = (track: MusicTrack | undefined) => {
  const disc = track && Number.isFinite(track.discNumber) ? track.discNumber! : 1;
  const number = track && Number.isFinite(track.trackNumber) ? track.trackNumber! : 0;
  return disc * 1000 + number;
};

function trackTitle(track: MusicTrack) {
  const title = String(track.title || "").trim();
  if (title) return title;
  const filename = String(track.relativePath || "").split(/[\\/]/).pop() || "";
  return filename.replace(/\.[^.]+$/, "") || "UNTITLED";
}

function buildDisplayEntries(source: ArchiveRecord[]): MusicDisplayEntry[] {
  if (musicApplication.view.show === "albums") {
    return source.map((record, index) => ({
      index,
      key: record.id,
      albumId: record.id,
      recordIndex: index,
      record,
      ...(record.album ? { album: record.album } : {}),
    }));
  }

  const entries: MusicDisplayEntry[] = [];
  source.forEach((parentRecord, recordIndex) => {
    const album = parentRecord.album;
    if (!album) return;
    const orderedTracks = album.tracks
      .map((track, sourceIndex) => ({ track, sourceIndex }))
      .sort((a, b) => trackOrdinal(a.track) - trackOrdinal(b.track) || a.sourceIndex - b.sourceIndex);

    for (const { track } of orderedTracks) {
      const key = `track|${parentRecord.id}|${track.id}`;
      const artist = track.artist?.trim() || album.artist;
      const record: ArchiveRecord = {
        ...parentRecord,
        id: key,
        title: trackTitle(track),
        en: artist,
        lead: artist,
        album,
      };
      entries.push({
        index: entries.length,
        key,
        albumId: parentRecord.id,
        trackId: track.id,
        recordIndex,
        record,
        album,
        track,
      });
    }
  });
  return entries;
}

/** All album or track entries in source order, independent of filtering and sorting. */
export function getMusicDisplayEntries(): MusicDisplayEntry[] {
  if (cachedEntrySource !== records || cachedEntryShow !== musicApplication.view.show) {
    cachedDisplayEntries = buildDisplayEntries(records);
    entriesByKey = new Map(cachedDisplayEntries.map(entry => [entry.key, entry]));
    cachedEntrySource = records;
    cachedEntryShow = musicApplication.view.show;
  }
  return cachedDisplayEntries;
}

export function getMusicEntry(index: number): MusicDisplayEntry | undefined {
  return getMusicDisplayEntries()[index];
}

export function getMusicEntryByKey(key: string): MusicDisplayEntry | undefined {
  getMusicDisplayEntries();
  return entriesByKey.get(key);
}

/** Resolve the focused display item for an album, falling back to its first visible entry. */
export function getMusicFocusedEntry(recordIndex: number): MusicDisplayEntry | undefined {
  ensureCatalog();
  const focused = entriesByKey.get(musicApplication.catalogFocus?.entryKey || "");
  if (focused?.recordIndex === recordIndex && visibleEntries.has(focused.index)) return focused;
  return firstVisibleByRecord.get(recordIndex);
}

/** Store stable album/track identity without invalidating catalog or shelf caches. */
export function focusMusicEntry(key: string): MusicDisplayEntry | undefined {
  const entry = getMusicEntryByKey(key);
  if (entry) musicApplication.focusEntry({ entryKey: entry.key, albumId: entry.albumId, trackId: entry.trackId });
  return entry;
}

function yearOf(entry: MusicDisplayEntry): number | undefined {
  const albumYear = albumOf(entry)?.year;
  if (typeof albumYear === "number" && Number.isFinite(albumYear)) return albumYear;
  const match = String(entry.record.date || "").match(/(?:18|19|20|21)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function searchableText(entry: MusicDisplayEntry) {
  const record = entry.record;
  const album = albumOf(entry);
  const trackText = entry.track
    ? `${trackTitle(entry.track)} ${entry.track.artist || ""} ${entry.track.artists?.join(" ") || ""} ${entry.track.relativePath || ""}`
    : album?.tracks.map(track => `${track.title} ${track.artist} ${track.artists?.join(" ") || ""} ${track.relativePath}`).join(" ");
  return [
    record.title,
    record.en,
    record.department,
    record.category,
    record.date,
    record.lead,
    record.abstract,
    record.findings.join(" "),
    album?.title,
    album?.artist,
    album?.artists?.join(" "),
    album?.year,
    album?.genreId,
    album?.rawGenres.join(" "),
    trackText,
  ].filter(value => value !== undefined && value !== null).join(" ").toLocaleLowerCase("zh-CN");
}

function recordMatches(entry: MusicDisplayEntry, words: string[]) {
  if (!words.length) return true;
  const haystack = searchableText(entry);
  return words.every(word => haystack.includes(word));
}

function sortEntryIndexes(indices: number[], entries: MusicDisplayEntry[]) {
  const sort = musicApplication.view.sort;
  // MusicTrack and MusicAlbum have no added timestamp; preserve source order rather than inventing one.
  if (sort === "added") return indices.sort((a, b) => a - b);
  return indices.sort((a, b) => {
    const left = entries[a];
    const right = entries[b];
    const artistOrder = compareText(leadArtistKeyOf(left), leadArtistKeyOf(right));
    const titleOrder = compareText(titleOf(left), titleOf(right));
    const albumOrder = compareText(albumKeyOf(left), albumKeyOf(right));
    const discTrackOrder = trackOrdinal(left.track) - trackOrdinal(right.track);

    if (sort === "title") return titleOrder || artistOrder || a - b;
    if (sort === "year") {
      const leftYear = yearOf(left), rightYear = yearOf(right);
      const yearOrder = leftYear === undefined
        ? rightYear === undefined ? 0 : 1
        : rightYear === undefined ? -1 : leftYear - rightYear;
      return yearOrder || artistOrder || albumOrder || discTrackOrder || titleOrder || a - b;
    }
    return artistOrder || (yearOf(left) ?? Number.POSITIVE_INFINITY) - (yearOf(right) ?? Number.POSITIVE_INFINITY) ||
      albumOrder || discTrackOrder || titleOrder || a - b;
  });
}

function groupFor(entry: MusicDisplayEntry): { key: string; name: string } {
  if (musicApplication.view.group === "genre") {
    const name = String(entry.record.category || "").trim() || "UNKNOWN GENRE";
    return { key: `genre:${entry.album?.genreId || name.toLocaleLowerCase("zh-CN")}`, name };
  }
  if (musicApplication.view.group === "artist") {
    const name = leadArtistOf(entry).trim().replace(/\s+/g, " ") || "UNKNOWN ARTIST";
    return { key: `artist:${leadArtistKeyOf(entry) || "unknown artist"}`, name };
  }
  if (musicApplication.view.group === "decade") {
    const year = yearOf(entry);
    if (year === undefined) return { key: "decade:unknown", name: "YEAR UNKNOWN" };
    const decade = Math.floor(year / 10) * 10;
    return { key: `decade:${decade}`, name: `${decade}s` };
  }
  if (musicApplication.view.group === "az") {
    const raw = Array.from(leadArtistOf(entry).trim().normalize("NFKC").toLocaleUpperCase("zh-CN"))[0] || "#";
    const initial = /^[A-Z]$/.test(raw) ? raw : /^\d$/.test(raw) ? "0–9" : "OTHER";
    return { key: `az:${initial}`, name: initial };
  }
  return { key: "all", name: "ALL RECORDS" };
}

function rebuildCatalog(source: ArchiveRecord[]) {
  const words = musicApplication.query.toLocaleLowerCase("zh-CN").split(/\s+/).filter(Boolean);
  const grouped = new Map<string, { key: string; name: string; entryIndexes: number[] }>();
  const entries = getMusicDisplayEntries();
  const indices = entries.flatMap((entry, index) => recordMatches(entry, words) ? [index] : []);

  for (const index of indices) {
    const group = groupFor(entries[index]);
    let target = grouped.get(group.key);
    if (!target) {
      target = { ...group, entryIndexes: [] };
      grouped.set(group.key, target);
    }
    target.entryIndexes.push(index);
  }

  const last = new Set(["YEAR UNKNOWN", "OTHER", "UNKNOWN GENRE"]);
  cachedGroups = [...grouped.values()]
    .sort((a, b) => (Number(last.has(a.name)) - Number(last.has(b.name))) || compareText(a.name, b.name))
    .map(group => ({
      key: group.key,
      name: group.name,
      entryKeys: sortEntryIndexes([...group.entryIndexes], entries).flatMap(index => entries[index] ? [entries[index].key] : []),
    }));
  cachedSource = source;
  cachedVersion = musicApplication.catalogRevision;
  displayVersion++;
  visibleEntries = new Set(cachedGroups.flatMap(group => group.entryKeys.flatMap(key => {
    const entry = entriesByKey.get(key);
    return entry ? [entry.index] : [];
  })));
  firstVisibleByRecord = new Map();
  for (const index of visibleEntries) {
    const entry = entries[index];
    if (entry && !firstVisibleByRecord.has(entry.recordIndex)) firstVisibleByRecord.set(entry.recordIndex, entry);
  }
}

function ensureCatalog() {
  if (cachedSource !== records || cachedVersion !== musicApplication.catalogRevision) rebuildCatalog(records);
  return cachedGroups;
}

export function configureMusicCatalog(next: Partial<MusicViewSettings>, query?: string) {
  musicApplication.configureView(next, query === undefined ? undefined : String(query));
}

export function getMusicCatalogOptions(): MusicViewSettings {
  return musicApplication.view;
}

export function getMusicCatalogVersion(): number {
  // Consumers cache DOM/cells by this version, including same-selection library refreshes.
  ensureCatalog();
  return displayVersion;
}

export function getMusicCatalogGroups(): MusicCatalogGroup[] {
  return ensureCatalog().map(group => ({ ...group, entryKeys: [...group.entryKeys] }));
}

/** Canonical album indexes for existing album-level flows, deduplicated in catalog order. */
export function getMusicCatalogRecords(): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const group of ensureCatalog()) {
    for (const key of group.entryKeys) {
      const recordIndex = entriesByKey.get(key)?.recordIndex;
      if (recordIndex !== undefined && !seen.has(recordIndex)) {
        seen.add(recordIndex);
        result.push(recordIndex);
      }
    }
  }
  return result;
}
