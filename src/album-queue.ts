import "./album-queue.css";
import { containsCjk, escapeHtml } from "./html";
import { trUi } from "./i18n";
import { dsdBadgeMarkup, hiResBadgeMarkup, isDsdTrack, isHiResTrack } from "./hi-res";
import type { MusicPlayerState } from "./music-player";
import type { MusicAlbum, MusicTrack } from "./music-types";

export interface AlbumQueueOptions {
  albumFor: (id: string) => MusicAlbum | undefined;
  play: (trackId: string, tracks: MusicTrack[]) => void;
  closeOther?: () => void;
}

export interface AlbumQueueController {
  update(state: MusicPlayerState): void;
  toggle(trigger: HTMLElement): void;
  close(restoreFocus?: boolean): void;
  readonly isOpen: boolean;
  destroy(): void;
}

let queueId = 0;

function formatDuration(value: number): string {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const seconds = String(total % 60).padStart(2, "0");
  if (total >= 3600) {
    return `${Math.floor(total / 3600)}:${String(Math.floor((total / 60) % 60)).padStart(2, "0")}:${seconds}`;
  }
  return `${Math.floor(total / 60)}:${seconds}`;
}

function coverMarkup(album: MusicAlbum, track: MusicTrack): string {
  const alt = `${album.title} · ${track.title}`;
  return album.coverUrl
    ? `<img class="album-queue-cover-image" src="${escapeHtml(album.coverUrl)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">`
    : `<span class="album-queue-cover-fallback" aria-hidden="true"><i></i><i></i><i></i></span>`;
}

function trackMarkup(album: MusicAlbum, track: MusicTrack, index: number): string {
  const badges = `${isHiResTrack(track) ? hiResBadgeMarkup("track") : ""}${isDsdTrack(track) ? dsdBadgeMarkup("track") : ""}`;
  return `<button class="album-queue-track" type="button" data-track-id="${escapeHtml(track.id)}" aria-label="${escapeHtml(trUi("播放"))} ${escapeHtml(track.title)}">
    <span class="album-queue-cover" aria-hidden="true">${coverMarkup(album, track)}</span>
    <span class="album-queue-track-copy">
      <span class="album-queue-track-title" data-cjk="${containsCjk(track.title)}">${escapeHtml(track.title)}</span>
      <span class="album-queue-track-artist" data-cjk="${containsCjk(track.artist)}">${escapeHtml(track.artist)}</span>
    </span>
    <span class="album-queue-track-meta"><span class="album-queue-badges">${badges}</span><span class="album-queue-track-number">${String(index + 1).padStart(2, "0")}</span><span class="album-queue-track-duration">${formatDuration(track.duration)}</span><span class="album-queue-current">${escapeHtml(trUi("正在播放"))}</span></span>
  </button>`;
}

function albumMarkup(album: MusicAlbum): string {
  const titleCjk = containsCjk(album.title);
  const artistCjk = containsCjk(album.artist);
  return `<header class="album-queue-header">
    <div class="album-queue-heading-copy">
      <small class="album-queue-kicker">${escapeHtml(trUi("PLAYING ALBUM"))}</small>
      <strong data-cjk="${titleCjk}">${escapeHtml(album.title)}</strong>
      <span data-cjk="${artistCjk}">${escapeHtml(album.artist)}</span>
    </div>
    <span class="album-queue-count">${String(album.tracks.length).padStart(2, "0")} <small>${escapeHtml(trUi("曲目"))}</small></span>
  </header>
  <div class="album-queue-list" aria-label="${escapeHtml(trUi("当前专辑曲目"))}">
    ${album.tracks.length ? album.tracks.map((track, index) => trackMarkup(album, track, index)).join("") : `<div class="album-queue-empty"><strong>${escapeHtml(trUi("这张专辑没有可显示的曲目"))}</strong></div>`}
  </div>`;
}

function emptyMarkup(currentTrack?: MusicTrack | null): string {
  if (currentTrack) {
    return `<div class="album-queue-empty"><strong data-cjk="${containsCjk(currentTrack.title)}">${escapeHtml(currentTrack.title)}</strong><span data-cjk="${containsCjk(currentTrack.artist)}">${escapeHtml(currentTrack.artist)}</span><p>${escapeHtml(trUi("无法读取正在播放曲目的专辑曲目"))}</p></div>`;
  }
  return `<div class="album-queue-empty"><strong>${escapeHtml(trUi("目前没有正在播放的曲目"))}</strong><p>${escapeHtml(trUi("开始播放后，这里会显示当前专辑的曲目。"))}</p></div>`;
}

function eventElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

export function setupAlbumQueue(root: HTMLElement, options: AlbumQueueOptions): AlbumQueueController {
  const dialog = document.createElement("section");
  dialog.className = "album-queue-popover music-popover";
  dialog.id = `album-queue-${++queueId}`;
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-label", trUi("当前专辑播放队列"));
  dialog.tabIndex = -1;
  dialog.hidden = true;
  root.append(dialog);

  let latestState: MusicPlayerState | undefined;
  let opened = false;
  let activeTrigger: HTMLElement | undefined;
  let renderedAlbumId: string | undefined;
  let renderedAlbum: MusicAlbum | undefined;
  let renderedTracks: MusicTrack[] | undefined;
  let activeTrackId: string | undefined;
  const triggerAttributes = new Map<HTMLElement, {
    controls: string | null;
    haspopup: string | null;
    expanded: string | null;
  }>();

  const rowFor = (id: string) =>
    [...dialog.querySelectorAll<HTMLButtonElement>(".album-queue-track")]
      .find((row) => row.dataset.trackId === id);

  const markCurrent = (nextId?: string) => {
    if (activeTrackId === nextId) return;
    if (activeTrackId) {
      const previous = rowFor(activeTrackId);
      previous?.classList.remove("is-current");
      previous?.removeAttribute("aria-current");
    }
    activeTrackId = nextId;
    if (!nextId) return;
    const next = rowFor(nextId);
    next?.classList.add("is-current");
    next?.setAttribute("aria-current", "true");
  };

  const renderForLatestState = (force = false, revealCurrent = false) => {
    const currentTrack = latestState?.currentTrack;
    const albumId = currentTrack?.albumId;
    const album = albumId ? options.albumFor(albumId) : undefined;
    const sameAlbum = albumId === renderedAlbumId;
    const list = dialog.querySelector<HTMLElement>(".album-queue-list");
    const savedScrollTop = sameAlbum ? list?.scrollTop ?? 0 : 0;
    const needsRender = force || albumId !== renderedAlbumId || album !== renderedAlbum || album?.tracks !== renderedTracks;

    if (needsRender) {
      dialog.innerHTML = album ? albumMarkup(album) : emptyMarkup(currentTrack);
      renderedAlbumId = albumId;
      renderedAlbum = album;
      renderedTracks = album?.tracks;
      activeTrackId = undefined;
      const nextList = dialog.querySelector<HTMLElement>(".album-queue-list");
      if (sameAlbum && nextList) nextList.scrollTop = savedScrollTop;
    }

    const nextTrackId = currentTrack?.id;
    const changedTrack = activeTrackId !== nextTrackId;
    markCurrent(nextTrackId);
    if (revealCurrent && changedTrack && nextTrackId) {
      const next = rowFor(nextTrackId);
      const scroller = dialog.querySelector<HTMLElement>(".album-queue-list");
      if (next && scroller) {
        const viewportTop = scroller.getBoundingClientRect().top;
        const viewportBottom = viewportTop + scroller.clientHeight;
        const rowBounds = next.getBoundingClientRect();
        if (rowBounds.top < viewportTop) scroller.scrollTop -= viewportTop - rowBounds.top;
        else if (rowBounds.bottom > viewportBottom) scroller.scrollTop += rowBounds.bottom - viewportBottom;
      }
    }
  };

  const position = () => {
    if (!opened || !activeTrigger?.isConnected) return;
    const rootBounds = root.getBoundingClientRect();
    const triggerBounds = activeTrigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const padding = 10;
    const leftBound = Math.max(padding, rootBounds.left + padding);
    const rightBound = Math.min(viewportWidth - padding, rootBounds.right - padding);
    const topBound = Math.max(padding, rootBounds.top + padding);
    const bottomBound = Math.min(viewportHeight - padding, rootBounds.bottom - padding);
    const availableWidth = Math.max(0, rightBound - leftBound);
    const availableHeight = Math.max(0, bottomBound - topBound);

    dialog.style.maxWidth = `${availableWidth}px`;
    dialog.style.maxHeight = `${Math.min(availableHeight,viewportHeight*.68,540)}px`;
    const panelBounds = dialog.getBoundingClientRect();
    const left = Math.max(leftBound, Math.min(rightBound - panelBounds.width, triggerBounds.right - panelBounds.width));
    const top = Math.max(topBound, Math.min(bottomBound - panelBounds.height, triggerBounds.top - panelBounds.height - 10));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  };

  const setExpanded = (trigger: HTMLElement | undefined, expanded: boolean) => {
    if (!trigger) return;
    if (!triggerAttributes.has(trigger)) {
      triggerAttributes.set(trigger, {
        controls: trigger.getAttribute("aria-controls"),
        haspopup: trigger.getAttribute("aria-haspopup"),
        expanded: trigger.getAttribute("aria-expanded"),
      });
    }
    trigger.setAttribute("aria-controls", dialog.id);
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", String(expanded));
  };

  const close = (restoreFocus = false) => {
    if (!opened) return;
    opened = false;
    dialog.hidden = true;
    setExpanded(activeTrigger, false);
    const trigger = activeTrigger;
    activeTrigger = undefined;
    if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
  };

  const open = (trigger: HTMLElement) => {
    options.closeOther?.();
    activeTrigger = trigger;
    opened = true;
    setExpanded(trigger, true);
    dialog.hidden = false;
    renderForLatestState(true, true);
    position();
    const currentRow = latestState?.currentTrack ? rowFor(latestState.currentTrack.id) : undefined;
    (currentRow ?? dialog).focus({ preventScroll: true });
  };

  const onDocumentPointerDown = (event: PointerEvent) => {
    if (!opened) return;
    const target = eventElement(event);
    if (!target || dialog.contains(target) || activeTrigger?.contains(target)) return;
    close(false);
  };

  const onDocumentKeyDown = (event: KeyboardEvent) => {
    if (!opened || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };

  const onDialogClick = (event: MouseEvent) => {
    const target = eventElement(event);
    const row = target?.closest<HTMLButtonElement>("button.album-queue-track");
    if (!row || !dialog.contains(row) || !activeTrigger) return;
    const album = renderedAlbum;
    const trackId = row.dataset.trackId;
    if (!album || !trackId) return;
    event.preventDefault();
    event.stopPropagation();
    options.play(trackId, album.tracks);
    close(true);
  };

  const onDialogWheel = (event: WheelEvent) => {
    if (opened) event.stopPropagation();
  };
  const onDialogKeyDown=(event:KeyboardEvent)=>{
    event.stopPropagation();
    const rows=[...dialog.querySelectorAll<HTMLButtonElement>('.album-queue-track:not([disabled])')];
    if(!rows.length||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();
    const current=rows.indexOf(document.activeElement as HTMLButtonElement);
    const index=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,current+(event.key==='ArrowDown'?1:-1)));
    const row=rows[index];row.focus({preventScroll:true});
    const list=dialog.querySelector<HTMLElement>('.album-queue-list');if(!list)return;
    const r=row.getBoundingClientRect(),v=list.getBoundingClientRect();
    if(r.top<v.top)list.scrollTop-=v.top-r.top;else if(r.bottom>v.bottom)list.scrollTop+=r.bottom-v.bottom;
  };

  const onResize = () => {
    if (opened) position();
  };

  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  dialog.addEventListener("click", onDialogClick);
  dialog.addEventListener("wheel", onDialogWheel, { passive: true });
  dialog.addEventListener('keydown',onDialogKeyDown);
  window.addEventListener("resize", onResize);

  return {
    update(state) {
      latestState = state;
      if (opened) renderForLatestState(false, false);
    },
    toggle(trigger) {
      if (opened && activeTrigger === trigger) {
        close(true);
        return;
      }
      if (opened) close(false);
      open(trigger);
    },
    close,
    get isOpen() {
      return opened;
    },
    destroy() {
      close(false);
      for (const [trigger, attributes] of triggerAttributes) {
        for (const [name, value] of Object.entries({
          "aria-controls": attributes.controls,
          "aria-haspopup": attributes.haspopup,
          "aria-expanded": attributes.expanded,
        })) {
          if (value === null) trigger.removeAttribute(name);
          else trigger.setAttribute(name, value);
        }
      }
      triggerAttributes.clear();
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      dialog.removeEventListener("click", onDialogClick);
      dialog.removeEventListener("wheel", onDialogWheel);
      dialog.removeEventListener('keydown',onDialogKeyDown);
      window.removeEventListener("resize", onResize);
      dialog.remove();
    },
  };
}
