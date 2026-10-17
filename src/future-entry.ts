import { BootSequence } from "./boot";
import { progress, smooth } from "./boot-motion";
import { futureEntryMarkup } from "./future-entry-markup";
import {
  defaultEntryIdentity,
  defaultEntryWelcome,
  normalizeEntryText,
  type EntryTextCopy,
} from "./entry-preferences.mjs";
import "./future-entry.css";

// The reference film starts at PV 6.76 s (app time 1.76 s). Stop before
// its second extraction, with the same matrix pose used for browsing.
export const futureEntryStart = 1.76;
export const futureEntryEnd = 27.12;
export type FutureEntryLayout = "shelf" | "array";
export const futureShelfEntryEnd = 28.6;
export const futureEntryEndFor = (layout: FutureEntryLayout) => layout === "shelf" ? futureShelfEntryEnd : futureEntryEnd;
export function futureEntryShot(time: number, entryLayout: FutureEntryLayout = "array") {
  return { reveal: smooth(progress(time, 22, 22.4)), lift: 0, zoom: 0,
    time: Math.min(time, futureEntryEndFor(entryLayout)), musicIntro: true, entryLayout };
}

export class FutureEntry {
  private overlay: HTMLElement;
  private film: HTMLElement;
  private sequence: BootSequence;
  private resizeObserver: ResizeObserver;
  private siblings: { node: HTMLElement; inert: boolean }[];
  private previousFocus: HTMLElement | null;
  private events = new AbortController();
  private armed = false;
  private lastTime: number | undefined;
  private time = futureEntryStart;
  active = true;

  constructor(
    private stage: HTMLElement,
    private finish: (skipped: boolean, ms: number) => void,
    copy: EntryTextCopy = {},
    readonly layout: FutureEntryLayout = "array",
  ) {
    const welcome = normalizeEntryText(copy.welcome, defaultEntryWelcome);
    const identity = normalizeEntryText(copy.identity, defaultEntryIdentity);
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.siblings = Array.from(stage.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
      .map(node => ({ node, inert: node.inert }));
    for (const { node } of this.siblings) node.inert = true;
    stage.insertAdjacentHTML("beforeend", futureEntryMarkup({ welcome, identity }));
    this.overlay = stage.querySelector<HTMLElement>(".future-entry")!;
    this.film = this.overlay.querySelector<HTMLElement>(".future-entry-film")!;
    this.sequence = new BootSequence(this.film, { identity });
    stage.dataset.futureEntry = "access";
    stage.dataset.futureEntryLayout = layout;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(stage);
    this.resize();
    this.render();
    void document.fonts.ready.then(() => {
      if (this.active && this.overlay.isConnected) this.fitWelcomeText();
    });
    const button = this.overlay.querySelector<HTMLButtonElement>(".future-entry-skip")!;
    button.addEventListener("click", event => {
      event.stopPropagation();
      this.end(true);
    }, { signal: this.events.signal });
    window.addEventListener("keydown", event => {
      if (!this.active) return;
      event.stopImmediatePropagation();
      // Preserve the focused button's native Space activation while keeping
      // keyboard transport/navigation shortcuts outside the entry dialog.
      if (event.key === " " && event.target instanceof HTMLElement &&
        event.target.closest(".future-entry-skip")) return;
      event.preventDefault();
      if (!event.repeat && (event.key === "Enter" || event.key === "Escape")) {
        // A held skip key must not become an archive-open key after cleanup.
        const release = new AbortController();
        window.addEventListener("keydown", next => {
          if (next.key !== event.key) return;
          next.preventDefault();
          next.stopImmediatePropagation();
        }, { capture: true, signal: release.signal });
        window.addEventListener("keyup", next => {
          if (next.key === event.key) release.abort();
        }, { capture: true, signal: release.signal });
        window.addEventListener("blur", () => release.abort(), { once: true, signal: release.signal });
        this.end(true);
      }
    }, { capture: true, signal: this.events.signal });
    this.overlay.addEventListener("wheel", event => {
      event.preventDefault();
      event.stopPropagation();
    }, { passive: false, signal: this.events.signal });
    document.addEventListener("visibilitychange", () => { this.lastTime = undefined; }, { signal: this.events.signal });
    button.focus({ preventScroll: true });
  }

  // Arm only after the first prepared frame releases the desktop ready gate.
  // Hidden/minimized time does not consume the animation.
  arm() { this.armed = true; }

  update(ms: number) {
    if (!this.active) return undefined;
    if (this.armed && !document.hidden) {
      if (this.lastTime !== undefined) this.time += Math.max(0, ms - this.lastTime) / 1000;
      this.lastTime = ms;
    }
    if (this.time >= futureEntryEndFor(this.layout)) {
      this.end(false, ms);
      return undefined;
    }
    this.render();
    return futureEntryShot(this.time, this.layout);
  }

  get state() {
    return { active: this.active, time: this.time, layout: this.layout, phase: this.stage.dataset.futureEntry ?? "archive" };
  }

  private resize() {
    const scale = Math.min(this.stage.clientWidth / 1920, this.stage.clientHeight / 1080);
    this.overlay.style.setProperty("--future-entry-scale", String(scale));
  }

  private fitWelcomeText() {
    const element = this.film.querySelector<HTMLElement>(".welcome-database");
    if (!element) return;
    const style = getComputedStyle(element);
    const baseSize = Number.parseFloat(style.fontSize) || 36;
    const minSize = 18;
    const width = Math.max(1, (element.clientWidth || 480) - 12);
    const text = element.textContent ?? "";
    if (!text) return;
    const ink = document.createElement("span");
    ink.textContent = text;
    ink.style.cssText = "display:inline-block;font:inherit;letter-spacing:inherit;white-space:nowrap";
    element.replaceChildren(ink);
    // Measure the actual font/layout once after fonts are ready. Canvas metrics
    // can differ from the displayed glyphs and tracking on Windows.
    let fontSize = baseSize;
    for (let pass = 0; pass < 3 && ink.offsetWidth > width; pass++) {
      const next = Math.max(minSize, fontSize * width / ink.offsetWidth);
      if (Math.abs(next - fontSize) < .01) break;
      fontSize = next;
      element.style.fontSize = `${fontSize}px`;
    }
    if (ink.offsetWidth > width && text.length > 1) {
      const spacing = Number.parseFloat(style.letterSpacing) || 0;
      element.style.letterSpacing = `${Math.max(-1, spacing - (ink.offsetWidth - width) / (text.length - 1) - .05)}px`;
    }
  }

  private render() {
    const motion = this.sequence.update(this.time);
    this.overlay.style.setProperty("--future-entry-backdrop-opacity", String(motion.backgroundOpacity));
    const shelf = this.layout === "shelf";
    const settleAt = shelf ? 26.7 : 25.3;
    const phase = this.time >= settleAt ? "settle" : this.time >= 22 ? shelf ? "shelf-feed" : "array" : motion.step;
    if (this.stage.dataset.futureEntry !== phase) this.stage.dataset.futureEntry = phase;
    this.overlay.style.setProperty("--future-entry-brand-opacity", String(1 - smooth(progress(this.time, settleAt - .4, settleAt))));
    this.stage.style.setProperty("--future-entry-ui-opacity", String(smooth(progress(this.time, settleAt, shelf ? 27.55 : 26.72))));
    this.overlay.style.setProperty("--future-entry-caption-opacity", String(shelf
      ? smooth(progress(this.time, 22.3, 22.9)) * (1 - smooth(progress(this.time, 26, 26.7))) : 0));
    this.overlay.style.setProperty("--future-entry-caption-progress", String(progress(this.time, 22.3, 26.7)));
  }

  private end(skipped: boolean, ms = performance.now()) {
    if (!this.active) return;
    this.active = false;
    this.events.abort();
    this.resizeObserver.disconnect();
    this.sequence.reset();
    this.overlay.remove();
    delete this.stage.dataset.futureEntry;
    delete this.stage.dataset.futureEntryLayout;
    this.stage.style.removeProperty("--future-entry-ui-opacity");
    for (const { node, inert } of this.siblings) node.inert = inert;
    this.finish(skipped, ms);
    if (this.previousFocus?.isConnected && !this.previousFocus.inert) this.previousFocus.focus({ preventScroll: true });
  }
}
