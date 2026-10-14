import type { ArchiveRecord } from "./data";
import type { MusicTrack } from "./music-types";
import { musicApplication } from "./music-application-state";
import { legacyCatalogOptions } from "./music-view-settings";
import {
  getMusicCatalogGroups,
  getMusicCatalogOptions,
  getMusicDisplayEntries,
  getMusicEntryByKey,
  getMusicFocusedEntry,
  type MusicDisplayEntry,
} from "./music-catalog";

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]!));

const choices = {
  show: [["albums", "ALBUMS"], ["tracks", "TRACKS"]],
  group: [["genre", "GENRE"], ["artist", "ARTIST"], ["decade", "DECADE"], ["az", "A-Z"], ["none", "NONE"]],
  sort: [["artist", "ARTIST"], ["title", "TITLE"], ["year", "YEAR"], ["added", "ADDED"]],
} as const;

export function musicCatalogToolsMarkup(): string {
  const view = getMusicCatalogOptions();
  const controls = ([
    ["show", "SHOW", choices.show],
    ["group", "GROUP", choices.group],
    ["sort", "SORT", choices.sort],
  ] as const).map(([field, heading, options]) => `<div class="foobar-tool-group foobar-catalog-control" role="group" aria-label="${heading}"><small>${heading}</small><div>${options.map(([value, label]) =>
    `<button type="button" data-foobar-catalog="${field}" data-value="${value}" aria-pressed="${view[field] === value}">${label}</button>`
  ).join("")}</div></div>`).join("");
  return `<button type="button" class="foobar-random" data-action="foobar-random" aria-keyshortcuts="R"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/><path d="M2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6z" fill="var(--accent)"/></svg><span>RANDOM PICK</span><kbd>R</kbd></button><div class="foobar-catalog-toolbar">${controls}</div>`;
}

const albumOfEntry = (entry: MusicDisplayEntry) => entry.album ?? entry.record.album;
const artistOf = (entry: MusicDisplayEntry) =>
  entry.track?.artist?.trim() || albumOfEntry(entry)?.artist || entry.record.en || entry.record.lead || "";
const titleOf = (entry: MusicDisplayEntry) => entry.track
  ? trackTitle(entry.track)
  : albumOfEntry(entry)?.title || entry.record.title || "";

function trackTitle(track: MusicTrack) {
  const title = String(track.title || "").trim();
  if (title) return title;
  const filename = String(track.relativePath || "").split(/[\\/]/).pop() || "";
  return filename.replace(/\.[^.]+$/, "") || "UNTITLED";
}

function yearOf(entry: MusicDisplayEntry): number | undefined {
  const year = albumOfEntry(entry)?.year;
  if (typeof year === "number" && Number.isFinite(year)) return year;
  const match = String(entry.record.date || "").match(/(?:18|19|20|21)\d{2}/);
  return match ? Number(match[0]) : undefined;
}

function coverMarkup(record: ArchiveRecord, className: string) {
  const album = record.album;
  const alt = `${album?.artist || record.en || record.lead || ""} · ${album?.title || record.title || ""}`.trim();
  return album?.coverUrl
    ? `<img class="${className}" src="${escapeHtml(album.coverUrl)}" alt="${escapeHtml(alt)}" loading="lazy"/>`
    : `<span class="${className} foobar-cover-placeholder" aria-hidden="true">AUDIO ARCHIVE</span>`;
}

function albumCard(entry: MusicDisplayEntry, selectedEntryKey: string, groupName: string) {
  const album = albumOfEntry(entry);
  const formats = album ? [...new Set(album.tracks.map(track => track.format).filter(Boolean))].join(" / ") : "";
  const year = yearOf(entry);
  const selected = entry.key === selectedEntryKey;
  return `<button type="button" class="foobar-grid-card foobar-album-item${selected ? " is-selected" : ""}" data-action="foobar-select" data-foobar-record="${entry.recordIndex}" data-foobar-entry="${escapeHtml(entry.key)}" aria-pressed="${selected}">
    <span class="foobar-album-cover">${coverMarkup(entry.record, "foobar-cover-image")}</span>
    <span class="foobar-album-copy"><small>${escapeHtml(groupName)} · ARC-${String(entry.recordIndex + 1).padStart(4, "0")}</small><strong>${escapeHtml(titleOf(entry))}</strong><span>${escapeHtml(artistOf(entry))}${year ? ` · ${year}` : ""}</span><em>${escapeHtml(formats || entry.record.clearance || "")}</em></span>
  </button>`;
}

function trackCard(entry: MusicDisplayEntry, selectedEntryKey: string, groupName: string) {
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

export function musicGridMarkup(selectedIndex: number, selectedEntryKey?: string): string {
  const view = getMusicCatalogOptions();
  const layout = legacyCatalogOptions(view).layout;
  const query = musicApplication.query;
  const groups = getMusicCatalogGroups();
  const entriesByKey = new Map(getMusicDisplayEntries().map(entry => [entry.key, entry]));
  const visibleKeys = new Set(groups.flatMap(group => group.entryKeys));
  const requestedEntry = selectedEntryKey ? getMusicEntryByKey(selectedEntryKey) : undefined;
  const currentEntry = requestedEntry && requestedEntry.recordIndex === selectedIndex && visibleKeys.has(requestedEntry.key)
    ? requestedEntry
    : getMusicFocusedEntry(selectedIndex);
  const currentEntryKey = currentEntry?.key || "";
  if (!groups.some(group => group.entryKeys.length)) {
    return `<div class="foobar-catalog-grid" data-foobar-layout="${layout}" data-foobar-show="${view.show}"><p class="foobar-catalog-empty">${query ? `NO MATCHES · ${escapeHtml(query)}` : "NO RECORDS"}</p></div>`;
  }
  const content = groups.map(group => {
    const groupEntries = group.entryKeys.map(key => entriesByKey.get(key)).filter((entry): entry is MusicDisplayEntry => !!entry);
    const cards = groupEntries.map(entry => entry.track
      ? trackCard(entry, currentEntryKey, group.name)
      : albumCard(entry, currentEntryKey, group.name)).join("");
    if (!cards) return "";
    return `<section class="foobar-catalog-group" data-foobar-group="${escapeHtml(group.key)}"><h2>${escapeHtml(group.name)}<small>${String(groupEntries.length).padStart(2, "0")}</small></h2><div class="foobar-catalog-items foobar-album-grid">${cards}</div></section>`;
  }).join("");
  return `<div class="foobar-catalog-grid" data-foobar-layout="${layout}" data-foobar-show="${view.show}">${content || `<p class="foobar-catalog-empty">NO MATCHES · ${escapeHtml(query)}</p>`}</div>`;
}
