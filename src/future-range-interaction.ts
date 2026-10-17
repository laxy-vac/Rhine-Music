type RangeAccess = {
  valueButton: HTMLButtonElement;
  label: () => string;
  editing: () => boolean;
};
type Box = { left: number; top: number; width: number; height: number };
type SavedStyle = { value: string; priority: string };
type FloatingRange = {
  range: HTMLInputElement;
  parent: HTMLElement;
  access: RangeAccess;
  placeholder: HTMLSpanElement;
  readout: HTMLOutputElement;
  styles: Map<string, SavedStyle>;
  parentPosition: SavedStyle;
  buttonOpacity: SavedStyle;
  buttonPointerEvents: SavedStyle;
  buttonStyles: Map<string, SavedStyle>;
  base: Box;
  target: Box;
  dragging: boolean;
  pointerId: number | null;
  closing: boolean;
};

const floatingProperties = ["position", "left", "top", "width", "height", "min-width", "max-width", "margin", "z-index", "transition"];
const buttonProperties = ["width", "min-width", "max-width", "height", "min-height", "max-height", "overflow", "white-space"];
const saveStyle = (node: HTMLElement, property: string): SavedStyle => ({
  value: node.style.getPropertyValue(property), priority: node.style.getPropertyPriority(property),
});
function restoreStyle(node: HTMLElement, property: string, saved: SavedStyle) {
  if (saved.value) node.style.setProperty(property, saved.value, saved.priority);
  else node.style.removeProperty(property);
}

/** Temporarily enlarge the same native range, keeping its original flow slot. */
export function setupFutureRangeInteraction(
  root: Document | HTMLElement,
  accessRange: (range: HTMLInputElement) => RangeAccess | undefined,
) {
  const doc = root instanceof Document ? root : root.ownerDocument;
  const view = doc.defaultView!;
  let active: FloatingRange | undefined;
  let leaveTimer: number | undefined;
  let restoreTimer: number | undefined;
  let animationFrame: number | undefined;

  const reduced = (range: HTMLInputElement) => range.closest(".music-app")?.getAttribute("data-reduced-motion") === "true"
    || view.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const eligible = (range: HTMLInputElement) => range.isConnected && !range.disabled && !!range.closest('.music-app[data-design="rhine"]')
    && !!range.closest("#music-settings, #music-theme-page, .music-panel")
    && !range.closest("#music-eq-page, .eq-controls, .tone-controls")
    && !range.closest("[hidden], [inert], details:not([open])") && range.getClientRects().length > 0;
  const clearTimers = () => {
    view.clearTimeout(leaveTimer);
    view.clearTimeout(restoreTimer);
    leaveTimer = restoreTimer = undefined;
    if (animationFrame !== undefined) view.cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
  };
  const localBox = (node: HTMLElement, parent: HTMLElement): Box => {
    const rect = node.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
    const sx = bounds.width / (parent.offsetWidth || bounds.width) || 1;
    const sy = bounds.height / (parent.offsetHeight || bounds.height) || 1;
    return {
      left: (rect.left - bounds.left) / sx - parent.clientLeft + parent.scrollLeft,
      top: (rect.top - bounds.top) / sy - parent.clientTop + parent.scrollTop,
      width: rect.width / sx, height: rect.height / sy,
    };
  };
  const place = (range: HTMLInputElement, box: Box) => {
    for (const key of ["left", "top", "width", "height"] as const) range.style.setProperty(key, `${box[key]}px`);
  };
  const updateReadout = () => {
    const current = active;
    if (!current || current.closing) return;
    const { range, parent, readout } = current;
    const text = current.access.label();
    if (readout.textContent !== text) readout.textContent = text;
    const box = localBox(range, parent);
    const min = range.min === "" ? 0 : Number(range.min), max = range.max === "" ? 100 : Number(range.max);
    const ratio = max > min ? Math.min(1, Math.max(0, (range.valueAsNumber - min) / (max - min))) : 0;
    const left = box.left + 8 + Math.max(0, box.width - 16) * ratio - readout.offsetWidth / 2;
    readout.style.left = `${Math.max(0, Math.min(parent.clientWidth - readout.offsetWidth, left))}px`;
    const clipping = range.closest(".settings-page-content, #theme-page-content, .music-panel");
    const roomAbove = !clipping || range.getBoundingClientRect().top - 26 >= clipping.getBoundingClientRect().top;
    readout.style.top = `${roomAbove ? box.top - 25 : box.top + box.height + 4}px`;
  };
  const followMorph = () => {
    if (animationFrame !== undefined) view.cancelAnimationFrame(animationFrame);
    const until = performance.now() + (active && !reduced(active.range) ? 240 : 0);
    const frame = () => {
      animationFrame = undefined;
      updateReadout();
      if (active && !active.closing && !active.dragging && performance.now() < until) animationFrame = view.requestAnimationFrame(frame);
    };
    frame();
  };
  const finish = () => {
    clearTimers();
    const current = active;
    if (!current) return;
    active = undefined;
    for (const [property, saved] of current.styles) restoreStyle(current.range, property, saved);
    for (const attribute of ["data-future-range-floating", "data-future-range-expanded", "data-future-range-dragging"]) current.range.removeAttribute(attribute);
    restoreStyle(current.parent, "position", current.parentPosition);
    restoreStyle(current.access.valueButton, "opacity", current.buttonOpacity);
    restoreStyle(current.access.valueButton, "pointer-events", current.buttonPointerEvents);
    for (const [property, saved] of current.buttonStyles) restoreStyle(current.access.valueButton, property, saved);
    current.placeholder.remove();
    current.readout.remove();
  };
  const collapse = (immediate = false) => {
    const current = active;
    if (!current) return;
    if (immediate || reduced(current.range) || !current.range.isConnected) { finish(); return; }
    clearTimers();
    current.closing = true;
    current.range.removeAttribute("data-future-range-expanded");
    current.range.removeAttribute("data-future-range-dragging");
    // The number becomes usable as soon as the retreating rail uncovers it.
    restoreStyle(current.access.valueButton, "opacity", current.buttonOpacity);
    restoreStyle(current.access.valueButton, "pointer-events", current.buttonPointerEvents);
    for (const [property, saved] of current.buttonStyles) restoreStyle(current.access.valueButton, property, saved);
    restoreStyle(current.range, "transition", current.styles.get("transition")!);
    place(current.range, localBox(current.placeholder, current.parent));
    restoreTimer = view.setTimeout(finish, 240);
  };
  const expand = (range: HTMLInputElement) => {
    const access = accessRange(range);
    if (!eligible(range) || !access || access.editing() || !access.valueButton.isConnected) return;
    if (active?.range === range && !active.closing) { view.clearTimeout(leaveTimer); return; }
    // Changing targets restores the old slot before measuring the new one.
    finish();
    const parent = range.parentElement;
    if (!parent) return;
    const base = localBox(range, parent), button = localBox(access.valueButton, parent);
    const right = Math.min(parent.clientWidth + 3, Math.max(base.left + base.width, button.left + button.width));
    const width = right - base.left;
    if (width < base.width + 12) return;
    const computed = getComputedStyle(range);
    const placeholder = doc.createElement("span");
    placeholder.className = "future-range-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    Object.assign(placeholder.style, {
      display: "block", width: `${base.width}px`, height: `${base.height}px`, minWidth: "0", maxWidth: "none",
      flex: `0 0 ${base.width}px`, margin: computed.margin, gridArea: computed.gridArea, alignSelf: computed.alignSelf,
    });
    const readout = doc.createElement("output");
    readout.className = "future-range-readout";
    readout.setAttribute("aria-hidden", "true");
    const parentPosition = saveStyle(parent, "position");
    if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const styles = new Map(floatingProperties.map(property => [property, saveStyle(range, property)]));
    const height = Math.max(40, base.height);
    active = {
      range, parent, access, placeholder, readout, styles, parentPosition,
      buttonOpacity: saveStyle(access.valueButton, "opacity"), buttonPointerEvents: saveStyle(access.valueButton, "pointer-events"),
      buttonStyles: new Map(buttonProperties.map(property => [property, saveStyle(access.valueButton, property)])),
      base, target: { left: base.left, top: base.top - (height - base.height) / 2, width, height },
      dragging: false, pointerId: null, closing: false,
    };
    range.before(placeholder);
    parent.append(readout);
    range.style.position = "absolute";
    range.style.minWidth = "0";
    range.style.maxWidth = "none";
    range.style.margin = "0";
    range.style.zIndex = "4";
    range.style.transition = "none";
    place(range, base);
    range.setAttribute("data-future-range-floating", "");
    range.getBoundingClientRect();
    restoreStyle(range, "transition", styles.get("transition")!);
    access.valueButton.style.opacity = "0";
    access.valueButton.style.pointerEvents = "none";
    // More digits must not resize the hidden grid/flex slot during a drag.
    for (const property of ["width", "min-width", "max-width"]) access.valueButton.style.setProperty(property, `${button.width}px`);
    for (const property of ["height", "min-height", "max-height"]) access.valueButton.style.setProperty(property, `${button.height}px`);
    access.valueButton.style.overflow = "hidden";
    access.valueButton.style.whiteSpace = "nowrap";
    range.setAttribute("data-future-range-expanded", "");
    place(range, active.target);
    followMorph();
  };
  const rangeTarget = (event: Event) => event.target instanceof HTMLInputElement && event.target.type === "range" ? event.target : undefined;
  const onOver = (event: Event) => {
    if ((event as PointerEvent).pointerType === "touch") return;
    const range = rangeTarget(event);
    if (range && (event as PointerEvent).relatedTarget !== range) expand(range);
  };
  const onOut = (event: Event) => {
    if (!active || rangeTarget(event) !== active.range || active.dragging
      || (event as PointerEvent).relatedTarget === active.range) return;
    view.clearTimeout(leaveTimer);
    leaveTimer = view.setTimeout(() => collapse(), 80);
  };
  const onDown = (event: Event) => {
    let current = active;
    if (!current) return;
    if (rangeTarget(event) !== current.range) { collapse(true); return; }
    if ((event as PointerEvent).button !== 0) return;
    if (current.closing) {
      expand(current.range);
      current = active;
      if (!current || current.closing) { finish(); return; }
    }
    clearTimers();
    const visible = localBox(current.range, current.parent);
    current.range.style.transition = "none";
    place(current.range, visible);
    current.dragging = true;
    current.pointerId = (event as PointerEvent).pointerId;
    current.range.setAttribute("data-future-range-dragging", "");
    updateReadout();
  };
  const onUp = (event: PointerEvent) => {
    const current = active;
    if (!current?.dragging || event.pointerId !== current.pointerId) return;
    view.requestAnimationFrame(() => {
      if (active !== current) return;
      current.dragging = false;
      current.pointerId = null;
      current.range.removeAttribute("data-future-range-dragging");
      restoreStyle(current.range, "transition", current.styles.get("transition")!);
      if (!current.range.matches(":hover") || event.type === "pointercancel") collapse();
      else { place(current.range, current.target); followMorph(); }
    });
  };
  const onFocus = (event: Event) => {
    if (active && event.target !== active.range) collapse(true);
  };
  const onKey = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape" && active && !active.dragging) collapse(true);
  };
  const onScroll = () => { if (active && !active.dragging) collapse(true); };
  const onBlur = () => collapse(true);
  const onValue = (event: Event) => { if (rangeTarget(event) === active?.range) updateReadout(); };
  const listeners: [string, EventListener, boolean][] = [
    ["pointerover", onOver, true], ["pointerout", onOut, true], ["pointerdown", onDown, true],
    ["focusin", onFocus, true], ["keydown", onKey, true], ["scroll", onScroll, true],
    ["input", onValue, false], ["change", onValue, false],
  ];
  for (const [type, listener, capture] of listeners) root.addEventListener(type, listener, capture);
  view.addEventListener("pointerup", onUp, true);
  view.addEventListener("pointercancel", onUp, true);
  view.addEventListener("blur", onBlur);
  view.addEventListener("resize", onBlur);
  return {
    sync() {
      if (!active) return;
      if (!eligible(active.range) || active.access.editing()) finish();
      else if (active.readout.textContent !== active.access.label()) updateReadout();
    },
    destroy() {
      finish();
      for (const [type, listener, capture] of listeners) root.removeEventListener(type, listener, capture);
      view.removeEventListener("pointerup", onUp, true);
      view.removeEventListener("pointercancel", onUp, true);
      view.removeEventListener("blur", onBlur);
      view.removeEventListener("resize", onBlur);
    },
  };
}
