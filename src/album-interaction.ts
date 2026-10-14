export type AlbumInteractionSide = "left" | "right";

export interface AlbumInteractionCallbacks {
  enabled: () => boolean;
  stepAlbum: (direction: number) => void;
  stepShelf: (direction: number) => void;
  scrollTarget: () => HTMLElement | null;
  tab?: (direction: number) => void;
}

export interface AlbumInteractionController {
  activate(side: AlbumInteractionSide): void;
  readonly side: AlbumInteractionSide;
  destroy(): void;
}

const LEFT_ZONES =
  "#three-scene, .music-navigation, .music-back, .card-caption, .foobar-catalog-tools, .foobar-grid-host";

const IGNORED_ZONES = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='menu']",
  "[role='dialog']",
  "[aria-modal='true']",
  "dialog",
  ".modal",
  ".context-menu",
  ".popover-menu",
  ".music-header",
  ".foobar-header",
  ".foobar-footer",
  ".foobar-status",
  ".music-topnav",
  ".minimal-transport",
  ".music-bottomline",
  ".music-footer",
  ".music-player",
  ".music-playback",
  "#music-playback",
  ".playback-bar",
  ".playback-controls",
  ".music-controls",
  "[data-action='play-pause']",
  "[data-action='stop']",
  "[data-action='locate-playing']",
  "[data-global-playback]",
  "#music-panel-root",
  ".music-settings-page",
  ".settings-page",
  "#music-settings",
  "#music-eq-page",
  "#music-lyrics-page",
  "#music-signal-page",
  "#music-theme-page",
  "#music-empty",
  ".music-empty",
].join(", ");

function eventElement(event: Event): Element | null {
  const target = event.target;
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function readSide(root: HTMLElement): AlbumInteractionSide {
  return root.dataset.operationFocus === "right" ? "right" : "left";
}

function consume(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
}

function revealWithin(scroller: HTMLElement | null, item: HTMLElement): void {
  if (!scroller || !scroller.contains(item)) return;
  const bounds = scroller.getBoundingClientRect();
  const itemBounds = item.getBoundingClientRect();
  const top = bounds.top + scroller.clientTop;
  const bottom = top + scroller.clientHeight;
  if (itemBounds.top < top) scroller.scrollTop -= top - itemBounds.top;
  else if (itemBounds.bottom > bottom) scroller.scrollTop += itemBounds.bottom - bottom;
}

export function setupAlbumInteraction(
  root: HTMLElement,
  callbacks: AlbumInteractionCallbacks,
): AlbumInteractionController {
  const previousFocus = root.dataset.operationFocus;
  if (previousFocus !== "left" && previousFocus !== "right") {
    root.dataset.operationFocus = "left";
  }

  const ignoredTarget = (target: Element): boolean =>
    !root.contains(target) ||
    Boolean(target.closest("[hidden], [inert]")) ||
    Boolean(target.closest(IGNORED_ZONES));

  const setSide = (side: AlbumInteractionSide): void => {
    root.dataset.operationFocus = side;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (!callbacks.enabled()) return;
    const target = eventElement(event);
    if (!target || ignoredTarget(target)) return;
    if (target.closest(".album-panel")) {
      setSide("right");
      if (!target.closest("button, a, input, select, textarea"))
        root.querySelector<HTMLElement>(".album-panel")?.focus({ preventScroll: true });
      return;
    }
    if (target.closest(LEFT_ZONES)) {
      setSide("left");
      if (!target.closest("button, a")) root.querySelector<HTMLElement>("#three-scene")?.focus({ preventScroll: true });
    }
  };

  const rows = (): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>(".album-panel .track-row"))
      .filter((row) =>
        !row.hasAttribute("disabled") &&
        row.getAttribute("aria-disabled") !== "true" &&
        !row.closest("[hidden], [inert]"),
      );

  const focusRow = (event: KeyboardEvent, current: Element | null): void => {
    const available = rows();
    if (!available.length) {
      consume(event);
      const scroller=callbacks.scrollTarget();
      if(scroller) {
        if(event.key === "Home") scroller.scrollTop=0;
        else if(event.key === "End") scroller.scrollTop=scroller.scrollHeight;
        else scroller.scrollTop += (event.key.includes("Up") ? -1 : 1) * (event.key.startsWith("Page") ? scroller.clientHeight*.8 : 40);
      }
      return;
    }

    const rowIndex = current ? available.indexOf(current as HTMLElement) : -1;
    let next = rowIndex;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = available.length - 1;
    else if (event.key === "PageUp" || event.key === "PageDown") {
      const scroller = callbacks.scrollTarget();
      const height = current?.getBoundingClientRect().height || available[0].getBoundingClientRect().height || 40;
      const page = Math.max(1, Math.floor((scroller?.clientHeight || height * 6) / height));
      const direction = event.key === "PageDown" ? 1 : -1;
      next = rowIndex < 0 ? (direction > 0 ? 0 : available.length - 1) : rowIndex + direction * page;
    } else {
      const direction = event.key === "ArrowDown" ? 1 : -1;
      next = rowIndex < 0 ? (direction > 0 ? 0 : available.length - 1) : rowIndex + direction;
    }

    next = Math.max(0, Math.min(available.length - 1, next));
    const row = available[next];
    consume(event);
    row.focus({ preventScroll: true });
    revealWithin(callbacks.scrollTarget(), row);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!callbacks.enabled() || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = eventElement(event);
    if (!target || ignoredTarget(target)) return;

    if (readSide(root) === "left") {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        consume(event);
        callbacks.stepAlbum(event.key === "ArrowUp" ? -1 : 1);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        consume(event);
        callbacks.stepShelf(event.key === "ArrowLeft" ? -1 : 1);
      }
      return;
    }

    const row = target.closest<HTMLElement>(".album-panel .track-row");

    const focusedControl = target.closest("button, a, [role='button']");
    if (event.key === "Enter" && !focusedControl) { consume(event);rows()[0]?.click();return; }
    if (
      event.key === "Enter" &&
      row &&
      rows().includes(row) &&
      (!focusedControl || focusedControl === row)
    ) {
      consume(event);
      row.click();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (target.closest("[role='tab']") && callbacks.tab) {
        callbacks.tab(event.key === "ArrowLeft" ? -1 : 1);
      }
      consume(event);
      return;
    }

    if (["ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      if (target.closest("[role='tab']") && (event.key === "Home" || event.key === "End")) {
        consume(event);
        callbacks.tab?.(event.key === "Home" ? -1 : 1);
        return;
      }
      focusRow(event, row);
    }
  };

  const onWheel = (event: WheelEvent): void => {
    if (!callbacks.enabled() || event.ctrlKey || event.metaKey || event.deltaY === 0) return;
    const target = eventElement(event);
    if (!target || ignoredTarget(target)) return;

    consume(event);
    if (readSide(root) === "left") {
      callbacks.stepAlbum(event.deltaY < 0 ? -1 : 1);
      return;
    }

    const scroller = callbacks.scrollTarget();
    if (!scroller) return;
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? Math.max(1, scroller.clientHeight)
        : 1;
    const limit = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.max(0, Math.min(limit, scroller.scrollTop + event.deltaY * scale));
  };

  root.addEventListener("pointerdown", onPointerDown, true);
  root.addEventListener("keydown", onKeyDown, true);
  root.addEventListener("wheel", onWheel, { capture: true, passive: false });

  return {
    activate: setSide,
    get side() {
      return readSide(root);
    },
    destroy() {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("keydown", onKeyDown, true);
      root.removeEventListener("wheel", onWheel, true);
      if (previousFocus === undefined) delete root.dataset.operationFocus;
      else root.dataset.operationFocus = previousFocus;
    },
  };
}
