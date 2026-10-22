import { musicGridMarkup } from "./music-catalog-markup";
import { getMusicCatalogRecords, getMusicCatalogVersion, getMusicFocusedEntry } from "./music-catalog";
import { musicApplication } from "./music-application-state";
import { getMusicGridPage, revealMusicGridEntry } from "./music-grid-page";
import type { MusicLayout } from "./music-view-settings";

/** One grid and its existing card markup, with theme-specific placement only. */
export function setupMusicCatalogGrid(root: HTMLElement, host: HTMLElement) {
  const marker = document.createComment("music-catalog-grid");
  host.before(marker);
  host.classList.add("music-catalog-grid-host");
  let contentKey = "";
  let rememberedScroll = 0;
  let pendingReveal = false;
  let lastEntryKey: string | undefined;
  let lastResultsKey: string | undefined;
  let lastPageKey = "";
  let design: "rhine" | "archive" = root.dataset.design === "archive" ? "archive" : "rhine";
  const syncBrand = () => host.querySelectorAll<HTMLElement>(".foobar-cover-placeholder").forEach(node => {
    node.textContent = design === "archive" ? "AUDIO ARCHIVE" : "RHINE LAB";
  });
  const visible = () => !host.hidden && host.getClientRects().length > 0;
  const rememberPosition = () => { if (visible()) rememberedScroll = host.scrollTop; };
  const revealSelected = () => {
    const card = host.querySelector<HTMLElement>('.foobar-grid-card[aria-pressed="true"]');
    if (card && visible()) {
      const item = card.getBoundingClientRect(), bounds = host.getBoundingClientRect();
      if (item.top < bounds.top) host.scrollTop -= bounds.top - item.top;
      else if (item.bottom > bounds.bottom) host.scrollTop += item.bottom - bounds.bottom;
      rememberPosition();
    }
  };
  const restorePosition = () => {
    if (!visible()) return;
    host.scrollTop = rememberedScroll;
    if (pendingReveal) { pendingReveal = false;revealSelected(); }
  };
  host.addEventListener("scroll", rememberPosition, { passive: true });

  function setDesign(next: "rhine" | "archive") {
    design = next;
    const parent = next === "archive" ? marker.parentNode : root;
    if (parent && host.parentNode !== parent) {
      rememberPosition();
      const focused = host.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
      parent.insertBefore(host, next === "archive" ? marker.nextSibling : null);
      host.scrollTop = rememberedScroll;
      if (focused?.isConnected) focused.focus({ preventScroll: true });
    }
    syncBrand();
  }

  return {
    setDesign,
    rememberPosition,
    restorePosition,
    update(layout: MusicLayout, index: number, open: boolean, emptyLibrary = false) {
      const wasHidden = !visible();
      rememberPosition();
      host.hidden = open || emptyLibrary || (layout !== "grid" && getMusicCatalogRecords().length > 0);
      if (host.hidden) return;
      if (wasHidden) restorePosition();
      const entry = getMusicFocusedEntry(index);
      const view = musicApplication.view;
      const resultsKey = JSON.stringify([view.show, view.group, view.sort, view.gridPageSize, musicApplication.query]);
      const resultsChanged = lastResultsKey !== undefined && resultsKey !== lastResultsKey;
      if (layout === "grid" && entry && entry.key !== lastEntryKey && !resultsChanged) revealMusicGridEntry(entry.key);
      lastResultsKey = resultsKey;
      lastEntryKey = entry?.key;
      const page = getMusicGridPage();
      musicApplication.setGridPage(page.pageIndex);
      const pageKey = `${page.pageIndex}:${page.pageSize}`;
      const pageChanged = pageKey !== lastPageKey;
      const key = `${getMusicCatalogVersion()}:${entry?.key ?? ""}:${pageKey}`;
      if (key === contentKey) return;
      contentKey = key;
      lastPageKey = pageKey;
      const scroll = pageChanged ? 0 : visible() ? host.scrollTop : rememberedScroll;
      if (pageChanged) rememberedScroll = 0;
      const focusedElement = host.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
      const focused = focusedElement?.dataset.foobarEntry;
      const pageDirection = focusedElement?.dataset.musicGridDirection;
      host.innerHTML = musicGridMarkup(index, entry?.key);
      syncBrand();
      host.scrollTop = scroll;
      if (focused) Array.from(host.querySelectorAll<HTMLElement>("[data-foobar-entry]"))
        .find(card => card.dataset.foobarEntry === focused)?.focus({ preventScroll: true });
      if (pageDirection) {
        const button = host.querySelector<HTMLButtonElement>(`[data-music-grid-direction="${pageDirection}"]`);
        const nextFocus = button && !button.disabled ? button : host.querySelector<HTMLButtonElement>("[data-music-grid-page]:not([disabled])");
        nextFocus?.focus({ preventScroll: true });
      }
      if (visible()) revealSelected();
      else pendingReveal = true;
    },
  };
}
