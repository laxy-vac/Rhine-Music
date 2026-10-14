import type { ArchiveRecord } from "./data";
import type { MusicTrack } from "./music-types";
import { musicApplication } from "./music-application-state";
import { legacyCatalogOptions, musicViewFromLegacy, type LegacyCatalogOptions } from "./music-view-settings";
import {
  configureMusicCatalog,
  focusMusicEntry,
  getMusicCatalogGroups,
  getMusicCatalogOptions,
  getMusicCatalogRecords,
  getMusicCatalogVersion,
  getMusicDisplayEntries,
  getMusicEntry,
  getMusicEntryByKey,
  getMusicFocusedEntry,
  type MusicCatalogGroup,
  type MusicDisplayEntry,
} from "./music-catalog";

export type FoobarCatalogOptions = LegacyCatalogOptions;
export type FoobarDisplayEntry = MusicDisplayEntry;

/** Legacy Foobar groups use display-entry indexes in their `records` field. */
export interface FoobarCatalogGroup extends Omit<MusicCatalogGroup, "entryKeys"> {
  records: number[];
}

const DEFAULT_OPTIONS: FoobarCatalogOptions = {
  layout: "array",
  show: "albums",
  group: "genre",
  sort: "artist",
};

const LAYOUTS = ["array", "grid", "future"] as const;
const SHOW_MODES = ["albums", "tracks"] as const;
const GROUP_MODES = ["genre", "artist", "decade", "az", "none"] as const;
const SORT_MODES = ["artist", "title", "year", "added"] as const;

const isOneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === "string" && (values as readonly string[]).includes(value);

/** Normalize the legacy Archive toolbar schema at its compatibility boundary. */
export function normalizeFoobarCatalogOptions(value: unknown): FoobarCatalogOptions {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    layout: isOneOf(candidate.layout, LAYOUTS) ? candidate.layout : DEFAULT_OPTIONS.layout,
    show: isOneOf(candidate.show, SHOW_MODES) ? candidate.show : DEFAULT_OPTIONS.show,
    group: isOneOf(candidate.group, GROUP_MODES) ? candidate.group : DEFAULT_OPTIONS.group,
    sort: isOneOf(candidate.sort, SORT_MODES) ? candidate.sort : DEFAULT_OPTIONS.sort,
  };
}

/** Legacy options are projected into the single public view state. */
export function configureFoobarCatalog(next: FoobarCatalogOptions | Partial<FoobarCatalogOptions>, nextQuery?: string) {
  const normalized = normalizeFoobarCatalogOptions({ ...getFoobarCatalogOptions(), ...next });
  configureMusicCatalog(musicViewFromLegacy(normalized), nextQuery === undefined ? undefined : String(nextQuery));
}

export function getFoobarCatalogOptions(): FoobarCatalogOptions {
  return legacyCatalogOptions(getMusicCatalogOptions());
}

export function getFoobarCatalogVersion(): number {
  return getMusicCatalogVersion();
}

export function getFoobarDisplayEntries(): FoobarDisplayEntry[] {
  return getMusicDisplayEntries();
}

export function getFoobarEntry(index: number): FoobarDisplayEntry | undefined {
  return getMusicEntry(index);
}

/** Resolve a track focus for an album, falling back to its first visible entry. */
export function getFoobarFocusedEntry(recordIndex: number): FoobarDisplayEntry | undefined {
  return getMusicFocusedEntry(recordIndex);
}

/** Retain the legacy name while storing stable identity in public application state. */
export function setFoobarFocus(key: string): FoobarDisplayEntry | undefined {
  return focusMusicEntry(key);
}

/** Compatibility groups expose the old display-entry indexes rather than stable keys. */
export function getFoobarCatalogGroups(): FoobarCatalogGroup[] {
  return getMusicCatalogGroups().map(group => ({
    key: group.key,
    name: group.name,
    records: group.entryKeys.flatMap(key => {
      const entry = getMusicEntryByKey(key);
      return entry ? [entry.index] : [];
    }),
  }));
}

export function getFoobarCatalogRecords(): number[] {
  return getMusicCatalogRecords();
}

const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => HTML_ENTITIES[character]);

const labels = {
  show: [["albums", "ALBUMS"], ["tracks", "TRACKS"]],
  layout: [["array", "ARRAY"], ["grid", "GRID"], ["future", "FUTURE"]],
  group: [["genre", "GENRE"], ["artist", "ARTIST"], ["decade", "DECADE"], ["az", "A-Z"], ["none", "NONE"]],
  sort: [["artist", "ARTIST"], ["title", "TITLE"], ["year", "YEAR"], ["added", "ADDED"]],
} as const;

export function foobarCatalogMarkup() {
  const options = getFoobarCatalogOptions();
  const groups = ([
    ["show", "SHOW", labels.show],
    ["layout", "LAYOUT", labels.layout],
    ["group", "GROUP", labels.group],
    ["sort", "SORT", labels.sort],
  ] as const).map(([field, heading, choices]) => `<div class="foobar-tool-group foobar-catalog-control" role="group" aria-label="${heading}"><small>${heading}</small><div>${choices.map(([value, label]) =>
    `<button type="button" data-foobar-catalog="${field}" data-value="${value}" aria-pressed="${options[field] === value}"${field === "layout" && value === "future" ? ' title="Future唱片选择视角，以Punk风格呈现" aria-label="FUTURE：Future唱片选择视角，以Punk风格呈现"' : ""}>${field === "layout" ? '<i class="foobar-layout-mark" aria-hidden="true"></i>' : ""}${label}</button>`
  ).join("")}</div></div>`).join("");
  return `<button type="button" class="foobar-random" data-action="foobar-random" aria-keyshortcuts="R"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/><path d="M2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6z" fill="var(--accent)"/></svg><span>RANDOM PICK</span><kbd>R</kbd></button><div class="foobar-catalog-toolbar">${groups}</div>`;
}

const albumOfRecord = (record: ArchiveRecord) => record.album;
const albumOfEntry = (entry: FoobarDisplayEntry) => entry.album ?? entry.record.album;
const artistOf = (entry: FoobarDisplayEntry) =>
  entry.track?.artist?.trim() || albumOfEntry(entry)?.artist || entry.record.en || entry.record.lead || "";
const titleOf = (entry: FoobarDisplayEntry) => entry.track
  ? trackTitle(entry.track)
  : albumOfEntry(entry)?.title || entry.record.title || "";

function trackTitle(track: MusicTrack) {
  const title = String(track.title || "").trim();
  if (title) return title;
  const filename = String(track.relativePath || "").split(/[\\/]/).pop() || "";
  return filename.replace(/\.[^.]+$/, "") || "UNTITLED";
}

function yearOf(entry: FoobarDisplayEntry): number | undefined {
  const albumYear = albumOfEntry(entry)?.year;
  if (typeof albumYear === "number" && Number.isFinite(albumYear)) return albumYear;
  const match = String(entry.record.date || "").match(/(?:18|19|20|21)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function coverMarkup(record: ArchiveRecord, className: string) {
  const album = albumOfRecord(record);
  const alt = `${album?.artist || record.en || record.lead || ""} · ${album?.title || record.title || ""}`.trim();
  return album?.coverUrl
    ? `<img class="${className}" src="${escapeHtml(album.coverUrl)}" alt="${escapeHtml(alt)}" loading="lazy"/>`
    : `<span class="${className} foobar-cover-placeholder" aria-hidden="true">AUDIO ARCHIVE</span>`;
}

function albumCard(entry: FoobarDisplayEntry, selectedEntryKey: string, groupName: string) {
  const record = entry.record;
  const album = albumOfEntry(entry);
  const formats = album ? [...new Set(album.tracks.map(track => track.format).filter(Boolean))].join(" / ") : "";
  const year = yearOf(entry);
  const selected = entry.key === selectedEntryKey;
  return `<button type="button" class="foobar-grid-card foobar-album-item${selected ? " is-selected" : ""}" data-action="foobar-select" data-foobar-record="${entry.recordIndex}" data-foobar-entry="${escapeHtml(entry.key)}" aria-pressed="${selected}">
    <span class="foobar-album-cover">${coverMarkup(record, "foobar-cover-image")}</span>
    <span class="foobar-album-copy"><small>${escapeHtml(groupName)} · ARC-${String(entry.recordIndex + 1).padStart(4, "0")}</small><strong>${escapeHtml(titleOf(entry))}</strong><span>${escapeHtml(artistOf(entry))}${year ? ` · ${year}` : ""}</span><em>${escapeHtml(formats || record.clearance || "")}</em></span>
  </button>`;
}

function trackCard(entry: FoobarDisplayEntry, selectedEntryKey: string, groupName: string) {
  const track = entry.track!;
  const album = albumOfEntry(entry);
  const selected = entry.key === selectedEntryKey;
  const disc = track.discNumber || 1;
  const number = track.trackNumber || 0;
  const trackLabel = `D${String(disc).padStart(2, "0")} · T${String(number).padStart(2, "0")}`;
  const year = yearOf(entry);
  const duration = `${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, "0")}`;
  const metadata = [track.format || track.codec, duration].filter(Boolean).join(" · ");
  return `<button type="button" class="foobar-grid-card foobar-album-item foobar-track-card${selected ? " is-selected" : ""}" data-action="foobar-select" data-foobar-record="${entry.recordIndex}" data-foobar-entry="${escapeHtml(entry.key)}" data-foobar-track="${escapeHtml(track.id)}" aria-pressed="${selected}">
    <span class="foobar-album-cover">${coverMarkup(entry.record, "foobar-cover-image")}</span>
    <span class="foobar-album-copy"><small>${escapeHtml(groupName)} · ARC-${String(entry.recordIndex + 1).padStart(4, "0")} · ${trackLabel}</small><strong>${escapeHtml(trackTitle(track))}</strong><span>${escapeHtml(artistOf(entry))} · ${escapeHtml(album?.title || "UNTITLED")}${year ? ` · ${year}` : ""}</span><em>${escapeHtml(metadata)}</em></span>
  </button>`;
}

export function foobarGridMarkup(selectedIndex: number, selectedEntryKey?: string) {
  const options = getFoobarCatalogOptions();
  const query = musicApplication.query;
  const groups = getFoobarCatalogGroups();
  const entries = getFoobarDisplayEntries();
  const requestedEntry = selectedEntryKey ? getMusicEntryByKey(selectedEntryKey) : undefined;
  const currentEntryKey = requestedEntry && requestedEntry.recordIndex === selectedIndex
    ? requestedEntry.key
    : getFoobarFocusedEntry(selectedIndex)?.key || "";
  if (!groups.some(group => group.records.length)) {
    return `<div class="foobar-catalog-grid" data-foobar-layout="${options.layout}" data-foobar-show="${options.show}"><p class="foobar-catalog-empty">${query ? `NO MATCHES · ${escapeHtml(query)}` : "NO RECORDS"}</p></div>`;
  }
  const content = groups.map(group => {
    const cards = group.records.map(index => {
      const entry = entries[index];
      if (!entry) return "";
      return entry.track
        ? trackCard(entry, currentEntryKey, group.name)
        : albumCard(entry, currentEntryKey, group.name);
    }).join("");
    if (!cards) return "";
    return `<section class="foobar-catalog-group" data-foobar-group="${escapeHtml(group.key)}"><h2>${escapeHtml(group.name)}<small>${String(group.records.length).padStart(2, "0")}</small></h2><div class="foobar-catalog-items foobar-album-grid">${cards}</div></section>`;
  }).join("");
  return `<div class="foobar-catalog-grid" data-foobar-layout="${options.layout}" data-foobar-show="${options.show}">${content || `<p class="foobar-catalog-empty">NO MATCHES · ${escapeHtml(query)}</p>`}</div>`;
}
