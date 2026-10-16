import type { ArchiveRecord } from "./data";
import type { MusicTrack } from "./music-types";
import { musicApplication } from "./music-application-state";
import { trUi } from "./i18n";
import { legacyCatalogOptions, musicGridPageSizes } from "./music-view-settings";
import { musicCountLabel, musicInterfaceLabels, type MusicBrowseChoice, type MusicBrowseField } from "./music-interface-labels";
import { getMusicGridPage } from "./music-grid-page";
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

export function musicCatalogToolsMarkup(): string {
  const view = getMusicCatalogOptions();
  const page = getMusicGridPage();
  const unit = musicCountLabel(view.show === "tracks" ? "track" : "album", page.total);
  const pageSize = musicInterfaceLabels.browse.fields.perPage;
  const perPage = `<div class="foobar-tool-group foobar-catalog-control foobar-grid-page-size" data-field="pageSize" role="group" aria-label="${escapeHtml(trUi(pageSize.ariaKey))}"><small>${escapeHtml(pageSize.tag)}</small><div>${musicGridPageSizes.map(size => `<button type="button" data-music-grid-size="${size}" aria-pressed="${view.gridPageSize === size}">${size}</button>`).join("")}</div></div>`;
  const fields: readonly [MusicBrowseField, { tag: string; ariaKey: string }, readonly MusicBrowseChoice[]][] = [
    ["show", musicInterfaceLabels.browse.fields.show, musicInterfaceLabels.browse.choices.show],
    ["layout", musicInterfaceLabels.browse.fields.layout, musicInterfaceLabels.browse.choices.layout],
    ["group", musicInterfaceLabels.browse.fields.group, musicInterfaceLabels.browse.choices.group],
    ["sort", musicInterfaceLabels.browse.fields.sort, musicInterfaceLabels.browse.choices.sort],
  ];
  const controls =
    fields.map(([field, copy, options]) => `<div class="foobar-tool-group foobar-catalog-control" data-field="${field}" role="group" aria-label="${escapeHtml(trUi(copy.ariaKey))}"><small>${escapeHtml(copy.tag)}</small><div>${options.map(({ value, label }) =>
      `<button type="button" ${field === "layout" ? `data-music-layout="${value}"` : `data-foobar-catalog="${field}" data-value="${value}"`} aria-pressed="${view[field] === value}">${field === "layout" ? '<span class="foobar-layout-mark" aria-hidden="true"></span>' : ""}${escapeHtml(label)}</button>`
    ).join("")}</div></div>`);
  return `<div class="foobar-catalog-total">${page.total} ${unit}</div><button type="button" class="foobar-random" data-action="foobar-random" aria-keyshortcuts="R"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/><path d="M2 2h2v2H2zM4 4h2v2H4zM6 6h2v2H6z" fill="var(--accent)"/></svg><span>${escapeHtml(musicInterfaceLabels.catalog.randomPick)}</span><kbd>R</kbd></button><div class="foobar-catalog-toolbar"><div class="foobar-catalog-toolbar__row">${controls[0]}${perPage}${controls[1]}</div><div class="foobar-catalog-toolbar__row">${controls[2]}${controls[3]}</div></div>`;
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
  const label = `${titleOf(entry)} · ${artistOf(entry)}`;
  return `<button type="button" class="foobar-grid-card foobar-album-item${selected ? " is-selected" : ""}" data-action="foobar-select" data-foobar-record="${entry.recordIndex}" data-foobar-entry="${escapeHtml(entry.key)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${selected}">
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
  const label = `${trackTitle(track)} · ${artistOf(entry)} · ${album?.title || "UNTITLED"} · ${trackLabel}`;
  return `<button type="button" class="foobar-grid-card foobar-album-item foobar-track-card${selected ? " is-selected" : ""}" data-action="foobar-select" data-foobar-record="${entry.recordIndex}" data-foobar-entry="${escapeHtml(entry.key)}" data-foobar-track="${escapeHtml(track.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" aria-pressed="${selected}">
    <span class="foobar-album-cover">${coverMarkup(entry.record, "foobar-cover-image")}</span>
    <span class="foobar-album-copy"><small>${escapeHtml(groupName)} · ARC-${String(entry.recordIndex + 1).padStart(4, "0")} · ${trackLabel}</small><strong>${escapeHtml(trackTitle(track))}</strong><span>${escapeHtml(artistOf(entry))} · ${escapeHtml(album?.title || "UNTITLED")}${year ? ` · ${year}` : ""}</span><em>${escapeHtml(metadata)}</em></span>
  </button>`;
}

export function musicGridMarkup(selectedIndex: number, selectedEntryKey?: string): string {
  const view = getMusicCatalogOptions();
  const layout = legacyCatalogOptions(view).layout;
  const query = musicApplication.query;
  const groups = getMusicCatalogGroups();
  const page = getMusicGridPage();
  const entriesByKey = new Map(getMusicDisplayEntries().map(entry => [entry.key, entry]));
  const visibleKeys = new Set(groups.flatMap(group => group.entryKeys));
  const requestedEntry = selectedEntryKey ? getMusicEntryByKey(selectedEntryKey) : undefined;
  const currentEntry = requestedEntry && requestedEntry.recordIndex === selectedIndex && visibleKeys.has(requestedEntry.key)
    ? requestedEntry
    : getMusicFocusedEntry(selectedIndex);
  const currentEntryKey = currentEntry?.key || "";
  const unit = musicCountLabel(view.show === "tracks" ? "track" : "album", page.total);
  const groupLabel = view.group === "none" ? musicInterfaceLabels.catalog.allGroup : musicInterfaceLabels.browse.choices.group.find(choice => choice.value === view.group)?.label || musicInterfaceLabels.catalog.allGroup;
  const content = page.groups.map(({ group, index, entryKeys }) => {
    const groupEntries = entryKeys.map(key => entriesByKey.get(key)).filter((entry): entry is MusicDisplayEntry => !!entry);
    const cards = groupEntries.map(entry => entry.track
      ? trackCard(entry, currentEntryKey, group.name)
      : albumCard(entry, currentEntryKey, group.name)).join("");
    if (!cards) return "";
    return `<section class="foobar-catalog-group${group.entryKeys.includes(currentEntryKey) ? " is-current" : ""}" data-foobar-group="${escapeHtml(group.key)}" data-group-index="${index}" data-group-total="${group.entryKeys.length}"><h2><span class="foobar-group-label">${groupLabel} ${String(index + 1).padStart(2, "0")}</span><span class="foobar-group-name">${escapeHtml(group.name)}</span><span class="foobar-group-rule" aria-hidden="true"></span><small class="foobar-group-count">${group.entryKeys.length} ${musicCountLabel(view.show === "tracks" ? "track" : "album", group.entryKeys.length)}</small></h2><div class="foobar-catalog-items foobar-album-grid">${cards}</div></section>`;
  }).join("");
  const count = page.total;
  const previousPage = Math.max(0, page.pageIndex - 1), nextPage = Math.min(page.pageCount - 1, page.pageIndex + 1);
  const pagination = `<nav class="music-grid-pagination" aria-label="${escapeHtml(trUi("网格分页"))}"><span class="music-grid-range">${count ? page.start + 1 : 0}–${page.end} / ${count} ${unit}</span><button type="button" data-music-grid-direction="previous" data-music-grid-page="${previousPage}" aria-label="${escapeHtml(trUi("上一页"))}"${page.pageIndex === 0 ? " disabled" : ""}>←</button><output class="music-grid-page-status">${String(count ? page.pageIndex + 1 : 0).padStart(2, "0")} / ${String(count ? page.pageCount : 0).padStart(2, "0")}</output><button type="button" data-music-grid-direction="next" data-music-grid-page="${nextPage}" aria-label="${escapeHtml(trUi("下一页"))}"${page.pageIndex >= page.pageCount - 1 ? " disabled" : ""}>→</button></nav>`;
  const empty = query ? `${trUi("无匹配结果")} · ${query}` : trUi("暂无唱片记录");
  return `<div class="foobar-catalog-grid" data-foobar-layout="${layout}" data-foobar-show="${view.show}" data-grid-page="${page.pageIndex}" data-grid-total="${count}">${content || `<p class="foobar-catalog-empty">${escapeHtml(empty)}</p>`}${pagination}</div>`;
}
