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

type PendingWrap = {
  prepareContext(): void;
  prepareMeasure(): void;
  read(): () => void;
};

const WRAP_FIT_CACHE_LIMIT = 128;

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
  const pendingWraps = new Set<PendingWrap>();
  let wrappingFrame = 0;
  const flushWrapping = () => {
    wrappingFrame = 0;
    const batch = [...pendingWraps];
    pendingWraps.clear();
    // Resolve cached font/width contexts for every host before measurement writes.
    batch.forEach((wrap) => wrap.prepareContext());
    // Stage only the latest uncached text in each hidden measurement span.
    batch.forEach((wrap) => wrap.prepareMeasure());
    // Read both metadata blocks before changing either reel's DOM/display.
    const commits = batch.map((wrap) => wrap.read());
    commits.forEach((commit) => commit());
  };
  const queueWrapping = (wrap: PendingWrap) => {
    pendingWraps.add(wrap);
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
    let styleEpoch = 0,
      fontEpoch = 0,
      widthEpoch = 0,
      observedWidth: number | undefined,
      cachedMetrics: {
        styleEpoch: number;
        fontEpoch: number;
        widthEpoch: number;
        available: number;
        fontSignature: string;
      } | undefined,
      prepared: {
        key: string;
        available: number;
        fits?: boolean;
      } | undefined;
    const fitCache = new Map<string, boolean>();
    const clearFitCache = () => {
      fitCache.clear();
      cachedMetrics = undefined;
    };
    const rememberFit = (key: string, fits: boolean) => {
      if (fitCache.has(key)) fitCache.delete(key);
      fitCache.set(key, fits);
      if (fitCache.size > WRAP_FIT_CACHE_LIMIT)
        fitCache.delete(fitCache.keys().next().value!);
    };
    const metrics = () => {
      if (cachedMetrics && cachedMetrics.styleEpoch === styleEpoch &&
        cachedMetrics.fontEpoch === fontEpoch && cachedMetrics.widthEpoch === widthEpoch)
        return cachedMetrics;
      const style = getComputedStyle(element);
      const measureStyle = getComputedStyle(measure);
      const available =
        element.clientWidth -
        Number.parseFloat(style.paddingLeft) -
        Number.parseFloat(style.paddingRight);
      const fontSignature = [
        "font", "font-family", "font-size", "font-style", "font-weight",
        "font-stretch", "font-kerning", "font-variant", "font-feature-settings",
        "font-variation-settings", "font-optical-sizing", "letter-spacing",
        "word-spacing", "text-transform", "direction", "writing-mode",
      ].map((property) => measureStyle.getPropertyValue(property)).join("\u001f");
      cachedMetrics = {
        styleEpoch,
        fontEpoch,
        widthEpoch,
        available,
        fontSignature,
      };
      return cachedMetrics;
    };
    const wrapEntry: PendingWrap = {
      prepareContext() {
        if (disposed) {
          prepared = undefined;
          return;
        }
        const current = metrics();
        const key = JSON.stringify([
          value,
          element.dataset.cjk || "",
          styleEpoch,
          fontEpoch,
          widthEpoch,
          current.available,
          current.fontSignature,
        ]);
        if (fitCache.has(key)) {
          const fits = fitCache.get(key)!;
          fitCache.delete(key);
          fitCache.set(key, fits);
          prepared = { key, available: current.available, fits };
        } else if (!(current.available > 0)) {
          // Hidden/zero-width hosts stay on the plain path until ResizeObserver
          // reports a usable width and queues another measurement.
          rememberFit(key, false);
          prepared = { key, available: current.available, fits: false };
        } else {
          prepared = { key, available: current.available };
        }
      },
      prepareMeasure() {
        if (disposed || !prepared || prepared.fits !== undefined) return;
        if (measure.textContent !== value) measure.textContent = value;
      },
      read() {
        if (disposed || !prepared) return () => {};
        const needsMeasure = prepared.fits === undefined;
        const fits = prepared.fits ??
          (prepared.available > 0 && measure.scrollWidth <= prepared.available);
        if (needsMeasure) rememberFit(prepared.key, fits);
        return () => {
          if (disposed) return;
          const previouslyUsingReel = usingReel;
          usingReel = fits;
          if (plain.textContent !== value) plain.textContent = value;
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
      },
    };
    const schedule = () => {
      if (!disposed) queueWrapping(wrapEntry);
    };
    const resize = new ResizeObserver((entries) => {
      const entry = entries.find((item) => item.target === element);
      if (entry) {
        const nextWidth = entry.contentRect.width;
        if (observedWidth === undefined || Math.abs(nextWidth - observedWidth) > 0.01) {
          observedWidth = nextWidth;
          widthEpoch += 1;
          clearFitCache();
        }
      }
      schedule();
    });
    resize.observe(element);
    const fontsChanged = () => {
      if (disposed) return;
      fontEpoch += 1;
      clearFitCache();
      schedule();
    };
    document.fonts.addEventListener("loadingdone", fontsChanged);
    void document.fonts.ready.then(fontsChanged);
    return {
      update(options: { text?: string; animated?: boolean }) {
        let changedText = false;
        if (options.text !== undefined && options.text !== value) {
          changedText = true;
          value = options.text;
          const script = String(containsCjk(value));
          const scriptChanged = element.dataset.cjk !== script;
          fontChanged ||= scriptChanged;
          element.dataset.cjk = script;
          if (scriptChanged) cachedMetrics = undefined;
          element.title = value;
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
        styleEpoch += 1;
        clearFitCache();
        controller.refresh();
        schedule();
      },
      destroy() {
        disposed = true;
        resize.disconnect();
        document.fonts.removeEventListener("loadingdone", fontsChanged);
        pendingWraps.delete(wrapEntry);
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
    flushPending() {
      if (wrappingFrame !== 0) {
        cancelAnimationFrame(wrappingFrame);
        flushWrapping();
      }
    },
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
