import { uiLanguage } from "./i18n";
import { escapeHtml } from "./html";
import type { MusicViewSettings } from "./music-view-settings";

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

type BrowseField = "show" | "group" | "sort";
type BrowseChoice = { value: string; zh: string; en: string };

function selectMarkup(
  field: "show" | "group" | "sort",
  value: string,
  label: string,
  choices: readonly { value: string; zh: string; en: string }[],
): string {
  const options = choices
    .map((choice) => {
      const selected = choice.value === value ? " selected" : "";
      return `<option value="${escapeHtml(choice.value)}"${selected}>${escapeHtml(t(choice.zh, choice.en))}</option>`;
    })
    .join("");

  return `<label class="music-view-controls__field"><span>${escapeHtml(label)}</span><select data-music-view-field="${field}" aria-label="${escapeHtml(label)}">${options}</select></label>`;
}

function browseButtonsMarkup(field: BrowseField, current: string, choices: readonly BrowseChoice[]): string {
  return choices.map((choice) => {
    const selected = current === choice.value;
    return `<button type="button" data-music-browse-field="${field}" data-value="${escapeHtml(choice.value)}" aria-pressed="${selected}">${escapeHtml(t(choice.zh, choice.en))}</button>`;
  }).join("");
}

export function musicBrowseControlsMarkup(view: MusicViewSettings): string {
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
      field: "group" as const,
      index: "02",
      tag: "GROUP",
      label: t("分组", "Group"),
      current: view.group,
      choices: groups,
    },
    {
      field: "sort" as const,
      index: "03",
      tag: "SORT",
      label: t("排序", "Sort"),
      current: view.sort,
      choices: sorts,
    },
  ].map(({ field, index, tag, label, current, choices }) =>
    `<div class="music-browse-tools__group" role="group" aria-label="${escapeHtml(label)}"><small><i aria-hidden="true"></i><span>${escapeHtml(index)}</span><b>${escapeHtml(tag)}</b></small><div class="music-browse-tools__options">${browseButtonsMarkup(field, current, choices)}</div></div>`,
  ).join("");

  return `<section class="music-browse-tools" aria-label="${escapeHtml(t("浏览选项", "Browse options"))}">${groupsMarkup}</section>`;
}

export function musicViewControlsMarkup(view: MusicViewSettings, query = ""): string {
  const layoutLabel = t("布局", "Layout");
  const showLabel = t("显示", "Show");
  const groupLabel = t("分组", "Group");
  const sortLabel = t("排序", "Sort");
  const layoutButtons = layouts
    .map((layout) => {
      const selected = view.layout === layout.value;
      return `<button type="button" data-music-layout="${layout.value}" aria-pressed="${selected}">${escapeHtml(t(layout.zh, layout.en))}</button>`;
    })
    .join("");

  return `<section class="music-view-controls" aria-labelledby="music-view-controls-title">
    <header class="music-view-controls__heading">
      <small>CATALOG / VIEW</small>
      <h2 id="music-view-controls-title">${escapeHtml(t("视图与浏览", "View & Browse"))}</h2>
    </header>
    <div class="music-view-controls__layout">
      <span class="music-view-controls__label">${escapeHtml(layoutLabel)}</span>
      <div class="music-view-controls__layout-options" role="group" aria-label="${escapeHtml(layoutLabel)}">${layoutButtons}</div>
    </div>
    <div class="music-view-controls__browse">
      ${selectMarkup("show", view.show, showLabel, shows)}
      ${selectMarkup("group", view.group, groupLabel, groups)}
      ${selectMarkup("sort", view.sort, sortLabel, sorts)}
    </div>
    <label class="music-view-controls__field"><span>${escapeHtml(t("筛选唱片", "Filter records"))}</span><input type="search" data-music-catalog-query value="${escapeHtml(query)}" placeholder="${escapeHtml(t("专辑、曲目、歌手…", "Album, track, artist…"))}" aria-label="${escapeHtml(t("筛选唱片", "Filter records"))}"></label>
  </section>`;
}

export function syncMusicViewControls(root: HTMLElement, view: MusicViewSettings, query?: string): void {
  root.querySelectorAll<HTMLButtonElement>("[data-music-layout]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.musicLayout === view.layout));
  });

  root.querySelectorAll<HTMLSelectElement>("[data-music-view-field]").forEach((select) => {
    const field = select.dataset.musicViewField;
    if (field === "show" || field === "group" || field === "sort") {
      select.value = view[field];
    }
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
