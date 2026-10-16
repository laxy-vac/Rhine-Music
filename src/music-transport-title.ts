import { ui } from "./i18n";

/** Keep a fixed, single-line slot for the current track in the top navigation. */
export function setupTransportTitle(slot: HTMLButtonElement, label: HTMLElement) {
  const measure = document.createElement("span");
  measure.className = "transport-title-measure";
  measure.setAttribute("aria-hidden", "true");
  const reel = document.createElement("span");
  reel.className = "transport-title-reel";
  reel.setAttribute("aria-hidden", "true");
  label.replaceChildren(measure, reel);

  const canvas = document.createElement("canvas").getContext("2d")!;
  let title = "", displayTitle = "", displayed = "", fontSignature = "";
  let displayedSize = Number.NaN;
  let visible = false, reduced = false, disposed = false, scheduled = 0;
  let fadeTimer = 0, fadeFrame = 0, fadeGeneration = 0;

  const cancelFade = () => {
    fadeGeneration += 1;
    if (fadeTimer) {
      window.clearTimeout(fadeTimer);
      fadeTimer = 0;
    }
    if (fadeFrame) {
      cancelAnimationFrame(fadeFrame);
      fadeFrame = 0;
    }
  };

  const setDisplayedText = (next: string, animate: boolean) => {
    if (next === displayed) return;
    displayed = next;
    cancelFade();
    const generation = fadeGeneration;
    if (!animate || reduced || !visible) {
      reel.textContent = next;
      reel.classList.remove("is-fading");
      return;
    }
    reel.classList.add("is-fading");
    fadeTimer = window.setTimeout(() => {
      fadeTimer = 0;
      if (disposed || generation !== fadeGeneration) return;
      reel.textContent = next;
      fadeFrame = requestAnimationFrame(() => {
        fadeFrame = 0;
        if (disposed || generation !== fadeGeneration) return;
        reel.classList.remove("is-fading");
      });
    }, 110);
  };

  const reconcile = (animate = false) => {
    if (disposed) return;
    const style = getComputedStyle(label);
    const baseFontSize = Number.parseFloat(style.getPropertyValue("--transport-title-base-size")) ||
      Number.parseFloat(style.fontSize) || 12;
    const minFontSize = Math.min(10, baseFontSize);
    const letterSpacing = Number.parseFloat(style.letterSpacing) || 0;
    const nextFontSignature = JSON.stringify([
      style.fontStyle,
      style.fontWeight,
      style.fontFamily,
      style.letterSpacing,
      baseFontSize,
    ]);
    const available = Math.max(0, label.getBoundingClientRect().width);
    const naturalWidth = measure.getBoundingClientRect().width;
    const glyphs = [...displayTitle];
    const width = (text: string, size: number) => {
      canvas.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
      return canvas.measureText(text).width + letterSpacing * [...text].length;
    };
    const fullWidth = (size: number) => Math.max(
      width(displayTitle, size),
      naturalWidth * size / baseFontSize,
    );

    let fontSize = baseFontSize;
    while (fontSize > minFontSize && fullWidth(fontSize) > available + 0.5) {
      fontSize = Math.max(minFontSize, Math.round((fontSize - 0.5) * 2) / 2);
    }

    let fitted = displayTitle;
    if (fullWidth(fontSize) > available + 0.5) {
      let low = 0, high = glyphs.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (width(`${glyphs.slice(0, middle).join("")}…`, fontSize) <= available + 0.5) low = middle;
        else high = middle - 1;
      }
      fitted = width("…", fontSize) <= available + 0.5
        ? `${glyphs.slice(0, low).join("")}…`
        : "";
    }

    const fontChanged = nextFontSignature !== fontSignature;
    const sizeChanged = Math.abs(fontSize - displayedSize) > 0.01;
    if (fitted === displayed && !fontChanged && !sizeChanged) return;
    fontSignature = nextFontSignature;
    displayedSize = fontSize;
    label.style.setProperty("--transport-title-size", `${fontSize}px`);
    if (fitted !== displayed) setDisplayedText(fitted, animate && !fontChanged);
  };

  const schedule = () => {
    if (!scheduled && !disposed) scheduled = requestAnimationFrame(() => {
      scheduled = 0;
      reconcile();
    });
  };
  const resize = new ResizeObserver(schedule);
  resize.observe(label);
  const appRoot = slot.closest<HTMLElement>(".music-app");
  const themeObserver = appRoot ? new MutationObserver(schedule) : undefined;
  themeObserver?.observe(appRoot!, {
    attributes: true,
    attributeFilter: ["class", "data-design", "data-theme", "style"],
  });
  const fontSet = document.fonts;
  void fontSet.ready.then(schedule);
  fontSet.addEventListener("loadingdone", schedule);

  return {
    setReduced(next: boolean) {
      reduced = next;
      if (reduced) {
        cancelFade();
        reel.textContent = displayed;
        reel.classList.remove("is-fading");
      }
    },
    update(next: string, shown: boolean) {
      const wasVisible = visible;
      const changed = shown && next !== title;
      visible = shown;
      slot.classList.toggle("visible", shown);
      slot.setAttribute("aria-hidden", String(!shown));
      slot.disabled = !shown;
      if (changed) {
        title = next;
        displayTitle = title.replace(/[\r\n]+/gu, " ");
        measure.textContent = displayTitle;
        slot.title = ui`定位歌曲：${title}`;
        slot.setAttribute("aria-label", ui`定位歌曲：${title}`);
        reconcile(wasVisible);
      }
    },
    destroy() {
      disposed = true;
      resize.disconnect();
      themeObserver?.disconnect();
      fontSet.removeEventListener("loadingdone", schedule);
      cancelAnimationFrame(scheduled);
      cancelFade();
      label.textContent = title;
    },
  };
}
