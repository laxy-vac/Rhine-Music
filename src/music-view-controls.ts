import { trUi } from "./i18n";
import { escapeHtml } from "./html";
import { musicGridPageSizes, type MusicViewSettings } from "./music-view-settings";
import {
  musicCountLabel,
  musicInterfaceLabels,
  type MusicBrowseChoice,
  type MusicBrowseField,
} from "./music-interface-labels";

type BrowseField = MusicBrowseField;

function browseButtonsMarkup(field: BrowseField, current: string, choices: readonly MusicBrowseChoice[]): string {
  return choices.map((choice) => {
    const selected = current === choice.value;
    const attribute = field === "layout"
      ? `data-music-layout="${escapeHtml(choice.value)}"`
      : `data-music-browse-field="${field}" data-value="${escapeHtml(choice.value)}"`;
    return `<button type="button" ${attribute} aria-pressed="${selected}">${escapeHtml(choice.label)}</button>`;
  }).join("");
}

export function musicBrowseControlsMarkup(view: MusicViewSettings): string {
  const groupsMarkup = [
    {
      field: "show" as const,
      index: "01",
      copy: musicInterfaceLabels.browse.fields.show,
      current: view.show,
      choices: musicInterfaceLabels.browse.choices.show,
    },
    {
      field: "layout" as const,
      index: "02",
      copy: musicInterfaceLabels.browse.fields.layout,
      current: view.layout,
      choices: musicInterfaceLabels.browse.choices.layout,
    },
    {
      field: "group" as const,
      index: "03",
      copy: musicInterfaceLabels.browse.fields.group,
      current: view.group,
      choices: musicInterfaceLabels.browse.choices.group,
    },
    {
      field: "sort" as const,
      index: "04",
      copy: musicInterfaceLabels.browse.fields.sort,
      current: view.sort,
      choices: musicInterfaceLabels.browse.choices.sort,
    },
  ].map(({ field, index, copy, current, choices }) =>
    `<div class="music-browse-tools__group" data-field="${field}" role="group" aria-label="${escapeHtml(trUi(copy.ariaKey))}"><small><i aria-hidden="true"></i><span>${escapeHtml(index)}</span><b>${escapeHtml(copy.tag)}</b></small><div class="music-browse-tools__options">${browseButtonsMarkup(field, current, choices)}</div></div>`,
  );

  const pageSize = musicInterfaceLabels.browse.fields.perPage;
  return `<section class="music-browse-tools" aria-label="${escapeHtml(trUi("浏览选项"))}">
    <div class="music-browse-tools__row">${groupsMarkup[0]}<div class="music-browse-tools__group music-grid-page-size" data-field="pageSize" role="group" aria-label="${escapeHtml(trUi(pageSize.ariaKey))}"><small><i aria-hidden="true"></i><b>${escapeHtml(pageSize.tag)}</b></small><div class="music-browse-tools__options">${musicGridPageSizes.map(size => `<button type="button" data-music-grid-size="${size}" aria-pressed="${view.gridPageSize === size}">${size}</button>`).join("")}</div></div>${groupsMarkup[1]}</div>
    <div class="music-browse-tools__row">${groupsMarkup[2]}${groupsMarkup[3]}</div>
    <output class="music-grid-total" data-music-grid-total>0 ${musicCountLabel(view.show === "tracks" ? "track" : "album", 0)}</output>
  </section>`;
}

export function syncMusicViewControls(root: HTMLElement, view: MusicViewSettings, total?: number): void {
  if (total !== undefined) root.querySelectorAll<HTMLOutputElement>("[data-music-grid-total]").forEach(output => {
    output.textContent = `${total} ${musicCountLabel(view.show === "tracks" ? "track" : "album", total)}`;
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
}
