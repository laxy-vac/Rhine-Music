import { uiLanguage } from "./i18n";
import { escapeHtml } from "./html";
import { musicGridPageSizes, type MusicViewSettings } from "./music-view-settings";

const t = (zh: string, en: string) => (uiLanguage() === "en" ? en : zh);

const layouts = [
  { value: "shelf", zh: "货架", en: "Shelf" },
  { value: "array", zh: "阵列", en: "Array" },
  { value: "grid", zh: "网格", en: "Grid" },
] as const;

const shows = [
  { value: "albums", zh: "专辑", en: "Albums" },
  { value: "tracks", zh: "曲目", en: "Tracks" },
] as const;

const groups = [
  { value: "genre", zh: "流派", en: "Genre" },
  { value: "artist", zh: "歌手", en: "Artist" },
  { value: "decade", zh: "年代", en: "Decade" },
  { value: "az", zh: "A-Z", en: "A-Z" },
  { value: "none", zh: "不分组", en: "No group" },
] as const;

const sorts = [
  { value: "artist", zh: "艺术家", en: "Artist" },
  { value: "title", zh: "标题", en: "Title" },
  { value: "year", zh: "年份", en: "Year" },
  { value: "added", zh: "添加顺序", en: "Added" },
] as const;

type BrowseField = "layout" | "show" | "group" | "sort";
type BrowseChoice = { value: string; zh: string; en: string };

function browseButtonsMarkup(field: BrowseField, current: string, choices: readonly BrowseChoice[]): string {
  return choices.map((choice) => {
    const selected = current === choice.value;
    const attribute = field === "layout"
      ? `data-music-layout="${escapeHtml(choice.value)}"`
      : `data-music-browse-field="${field}" data-value="${escapeHtml(choice.value)}"`;
    return `<button type="button" ${attribute} aria-pressed="${selected}">${escapeHtml(t(choice.zh, choice.en))}</button>`;
  }).join("");
}

export function musicBrowseControlsMarkup(view: MusicViewSettings, query = ""): string {
  const groupsMarkup = [
    {
      field: "show" as const,
      index: "01",
      tag: "SHOW",
      label: t("显示", "Show"),
      current: view.show,
      choices: shows,
    },
    {
      field: "layout" as const,
      index: "02",
      tag: "LAYOUT",
      label: t("布局", "Layout"),
      current: view.layout,
      choices: layouts,
    },
    {
      field: "group" as const,
      index: "03",
      tag: "GROUP",
      label: t("分组", "Group"),
      current: view.group,
      choices: groups,
    },
    {
      field: "sort" as const,
      index: "04",
      tag: "SORT",
      label: t("排序", "Sort"),
      current: view.sort,
      choices: sorts,
    },
  ].map(({ field, index, tag, label, current, choices }) =>
    `<div class="music-browse-tools__group" data-field="${field}" role="group" aria-label="${escapeHtml(label)}"><small><i aria-hidden="true"></i><span>${escapeHtml(index)}</span><b>${escapeHtml(tag)}</b></small><div class="music-browse-tools__options">${browseButtonsMarkup(field, current, choices)}</div></div>`,
  );

  return `<section class="music-browse-tools" aria-label="${escapeHtml(t("浏览选项", "Browse options"))}">
    <div class="music-browse-tools__row">${groupsMarkup[0]}<div class="music-browse-tools__group music-grid-page-size" data-field="pageSize" role="group" aria-label="${escapeHtml(t("每页数量", "Per page"))}"><small><i aria-hidden="true"></i><b>PER PAGE</b></small><div class="music-browse-tools__options">${musicGridPageSizes.map(size => `<button type="button" data-music-grid-size="${size}" aria-pressed="${view.gridPageSize === size}">${size}</button>`).join("")}</div></div>${groupsMarkup[1]}</div>
    <div class="music-browse-tools__row">${groupsMarkup[2]}${groupsMarkup[3]}</div>
    <output class="music-grid-total" data-music-grid-total>0 ${view.show === "tracks" ? "TRACKS" : "ALBUMS"}</output>
    <label class="music-browse-tools__filter"><small>${escapeHtml(t("筛选唱片", "Filter records"))}</small><input type="search" data-music-catalog-query value="${escapeHtml(query)}" placeholder="${escapeHtml(t("专辑、曲目、歌手…", "Album, track, artist…"))}" aria-label="${escapeHtml(t("筛选唱片", "Filter records"))}"></label>
  </section>`;
}

export function syncMusicViewControls(root: HTMLElement, view: MusicViewSettings, query?: string, total?: number): void {
  if (total !== undefined) root.querySelectorAll<HTMLOutputElement>("[data-music-grid-total]").forEach(output => {
    output.textContent = `${total} ${view.show === "tracks" ? "TRACK" : "ALBUM"}${total === 1 ? "" : "S"}`;
  });
  root.querySelectorAll<HTMLButtonElement>("[data-music-grid-size]").forEach(button => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.musicGridSize) === view.gridPageSize));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-music-layout]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.musicLayout === view.layout));
  });

  root.querySelectorAll<HTMLButtonElement>("[data-music-browse-field][data-value]").forEach((button) => {
    const field = button.dataset.musicBrowseField;
    if (field === "show" || field === "group" || field === "sort") {
      button.setAttribute("aria-pressed", String(view[field] === button.dataset.value));
    }
  });
  if (query !== undefined) root.querySelectorAll<HTMLInputElement>("[data-music-catalog-query]").forEach(input => {
    if (input !== document.activeElement) input.value = query;
  });
}
