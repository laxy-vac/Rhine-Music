import {
  createRollingNumber,
  createRollingText,
} from "@kitlangton/rolling-number";
import type { ArchiveNavigation } from "./archive-loop";
import { containsCjk } from "./html";

type SelectionText = {
  number: number;
  total: number;
  code: number;
  genreIndex: number;
  genresTotal: number;
  genre: string;
  genreName: string;
  format: string;
  artist: string;
  meta: string;
};

/** Keep the original archive's per-glyph reels alive across selection changes. */
export function setupMusicTextMotion(root: HTMLElement) {
  const host = (id: string, kind: "text" | "number") => {
    const element = root.querySelector<HTMLElement>(`#${id}`)!;
    element.classList.add(`music-rolling-${kind}`);
    return element;
  };
  const motion = {
    duration: 460,
    motionBlur: false,
    animated: false,
    // Hidden browse text is prepared before the camera finishes its return.
    pauseOffscreen: false,
  };
  const pendingWraps = new Set<() => () => void>();
  let wrappingFrame = 0;
  const flushWrapping = () => {
    wrappingFrame = 0;
    // Read both metadata blocks before changing either reel's DOM/display.
    const commits = [...pendingWraps].map((read) => read());
    pendingWraps.clear();
    commits.forEach((commit) => commit());
  };
  const queueWrapping = (read: () => () => void) => {
    pendingWraps.add(read);
    if (!wrappingFrame) wrappingFrame = requestAnimationFrame(flushWrapping);
  };
  const number = (id: string, digits = 2) =>
    createRollingNumber(host(id, "number"), {
      ...motion,
      value: 1,
      locales: "en-US",
      format: { minimumIntegerDigits: digits, useGrouping: false },
    });
  const text = (id: string, contained = false) => {
    const element = root.querySelector<HTMLElement>(`#${id}`)!;
    // A framed label owns its padding and marker; absolute reel layers must
    // stay inside a separate text host, including during animated selection.
    const reel = contained ? document.createElement("span") : element;
    if (contained) {
      reel.className = "selection-format-reel";
      element.replaceChildren(reel);
    }
    reel.classList.add("music-rolling-text");
    const controller = createRollingText(reel, {
      ...motion,
      text: "",
      transition: "direct",
      stagger: "none",
      direction: "up",
    });
    const originalMinWidth = element.style.getPropertyValue("min-width");
    const originalMinWidthPriority = element.style.getPropertyPriority("min-width");
    let widthFrame = 0;
    let widthTimer = 0;
    let animated = false;
    let value = "";
    const cancelWidthRelease = () => {
      cancelAnimationFrame(widthFrame);
      clearTimeout(widthTimer);
      widthFrame = 0;
      widthTimer = 0;
    };
    const restoreWidth = () => {
      cancelWidthRelease();
      if (originalMinWidth) element.style.setProperty("min-width", originalMinWidth, originalMinWidthPriority);
      else element.style.removeProperty("min-width");
    };
    const holdWidth = () => {
      cancelWidthRelease();
      // Right-aligned labels must not move their marker toward columns which
      // are still animating from the previous, wider value.
      const width = Number.parseFloat(getComputedStyle(element).width);
      element.style.minWidth = `${Number.isFinite(width) ? width : element.offsetWidth}px`;
      widthFrame = requestAnimationFrame(() => {
        widthFrame = requestAnimationFrame(() => {
          widthFrame = 0;
          widthTimer = window.setTimeout(restoreWidth, motion.duration);
        });
      });
    };
    return {
      update(options: { text?: string; animated?: boolean }) {
        if (options.animated !== undefined) animated = options.animated;
        if (contained) {
          if (!animated) restoreWidth();
          else if (options.text !== undefined && options.text !== value) holdWidth();
        }
        if (options.text !== undefined) value = options.text;
        const script = options.text === undefined ? element.dataset.cjk : String(containsCjk(options.text));
        const changed = element.dataset.cjk !== script;
        if (script !== undefined) element.dataset.cjk = script;
        controller.update(options);
        if (changed) controller.refresh();
      },
      refresh: () => controller.refresh(),
      destroy() {
        if (contained) restoreWidth();
        controller.destroy();
      },
    };
  };
  const wrappingText = (id: string) => {
    // Auxiliary metadata keeps its native block width. Reels only own the
    // inner single-line span; longer artist lists retain ordinary line wraps.
    const element = root.querySelector<HTMLElement>(`#${id}`)!;
    const reel = document.createElement("span");
    const plain = document.createElement("span");
    const measure = document.createElement("span");
    reel.className = "music-rolling-text music-inline-reel";
    plain.className = "music-inline-plain";
    plain.style.display = "none";
    plain.style.whiteSpace = "normal";
    plain.style.overflowWrap = "anywhere";
    measure.setAttribute("aria-hidden", "true");
    measure.style.cssText =
      "position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre;width:max-content;max-width:none;contain:layout style paint;";
    element.replaceChildren(reel, plain, measure);
    const controller = createRollingText(reel, {
      ...motion,
      text: "",
      transition: "direct",
      stagger: "none",
      direction: "up",
    });
    let value = "",
      animated = false,
      usingReel = true,
      measured = false,
      fontChanged = false,
      disposed = false;
    const readLayout = () => {
      if (disposed) return () => {};
      const style = getComputedStyle(element);
      const available =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const fits = available > 0 && measure.scrollWidth <= available;
      return () => {
        const previouslyUsingReel = usingReel;
        usingReel = fits;
        if (!measured || fits !== previouslyUsingReel) {
          // Inline display overrides the library's .rn-root rule while hidden.
          reel.style.display = fits ? "inline-block" : "none";
          plain.style.display = fits ? "none" : "inline";
        }
        measured = true;
        controller.update({
          text: value,
          animated: animated && fits && previouslyUsingReel,
        });
        if (fontChanged) { controller.refresh();fontChanged = false; }
        if (fits && !previouslyUsingReel) controller.update({ animated });
      };
    };
    const schedule = () => {
      if (!disposed) queueWrapping(readLayout);
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    document.fonts.addEventListener("loadingdone", schedule);
    void document.fonts.ready.then(schedule);
    return {
      update(options: { text?: string; animated?: boolean }) {
        let changedText = false;
        if (options.text !== undefined && options.text !== value) {
          changedText = true;
          value = options.text;
          const script = String(containsCjk(value));
          fontChanged ||= element.dataset.cjk !== script;
          element.dataset.cjk = script;
          element.title = value;
          plain.textContent = value;
          measure.textContent = value;
        }
        const changedMotion =
          options.animated !== undefined && options.animated !== animated;
        if (options.animated !== undefined) animated = options.animated;
        if (changedText || !measured) schedule();
        // Enabling the already measured current text needs no geometry reads.
        else if (changedMotion)
          controller.update({ animated: animated && usingReel });
      },
      finish() {
        animated = false;
        controller.update({ animated: false });
      },
      refresh() {
        controller.refresh();
        schedule();
      },
      destroy() {
        disposed = true;
        resize.disconnect();
        document.fonts.removeEventListener("loadingdone", schedule);
        pendingWraps.delete(readLayout);
        controller.destroy();
        element.textContent = value;
      },
    };
  };
  const numbers = {
    number: number("selection-number"),
    total: number("selection-total"),
    code: number("selection-code-number", 3),
    genreIndex: number("genre-index"),
    genresTotal: number("genre-total"),
  };
  const texts = {
    genre: text("selection-genre"),
    genreName: text("genre-name"),
    format: text("selection-format", true),
    artist: wrappingText("selection-artist"),
    meta: wrappingText("selection-meta"),
  };
  const controllers = [...Object.values(numbers), ...Object.values(texts)];
  const refresh = () => controllers.forEach(controller => controller.refresh());
  const changes = new MutationObserver(refresh);
  changes.observe(root, { attributes: true, attributeFilter: ["data-design", "data-layout", "data-style-text-scale"] });
  let enabled = false;
  const setEnabled = (next: boolean) => {
    if (enabled === next) return;
    enabled = next;
    // Prepare the current glyphs before the next input, so the first selection
    // after entering the archive animates just like subsequent selections.
    controllers.forEach((controller) => controller.update({ animated: next }));
  };
  return {
    setEnabled,
    refresh,
    update(
      value: SelectionText,
      animated: boolean,
      navigation?: ArchiveNavigation,
    ) {
      setEnabled(animated);
      const axis =
        navigation && "axis" in navigation ? navigation.axis : undefined;
      const direction =
        navigation && "axis" in navigation
          ? navigation.direction > 0
            ? "up"
            : "down"
          : "auto";
      numbers.number.update({
        value: value.number,
        direction: axis === "row" ? direction : "auto",
      });
      numbers.total.update({
        value: value.total,
        direction: axis === "lane" ? direction : "auto",
      });
      numbers.code.update({ value: value.code, direction,
        format: { minimumIntegerDigits: root.dataset.design === "archive" ? 4 : 3, useGrouping: false } });
      numbers.genreIndex.update({
        value: value.genreIndex,
        direction: axis === "lane" ? direction : "auto",
      });
      numbers.genresTotal.update({
        value: value.genresTotal,
        direction: "auto",
      });
      for (const key of Object.keys(texts) as (keyof typeof texts)[])
        texts[key].update({ text: value[key] });
    },
    finish() {
      setEnabled(false);
    },
    destroy() {
      cancelAnimationFrame(wrappingFrame);
      pendingWraps.clear();
      changes.disconnect();
      controllers.forEach((controller) => controller.destroy());
    },
  };
}
