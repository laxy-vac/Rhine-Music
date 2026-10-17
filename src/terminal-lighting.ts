import type { RenderQuality } from "./render-quality";

type Direction = { x: number; y: number };
type LightSource = { x: number; y: number; strength: number };
type OriginalStyle = { value: string; priority: string };
type ReceiverState = {
  receiverAttribute: string | null;
  styles: Map<string, OriginalStyle>;
};

const RECEIVER_SELECTOR = [
  // Surface receivers carry the broad environment response; small controls
  // receive the directional inset only while active or being used.
  ".music-settings-page :is(.settings-category, .panel-section)",
  ".music-panel",
  // Transparent navigation labels do not have a surface to cast a card shadow.
  ".music-topnav > button:is([aria-pressed=true], :hover, :focus-visible)",
  // Light the glass switch once; its moving selection pill already has its own edge.
  ".music-topnav .theme-switch",
  ".music-style-page button:is([aria-pressed=true], :hover, :focus-visible)",
  ".music-settings-page button:not(.lyrics-line-button):is([aria-pressed=true], [aria-selected=true], [aria-expanded=true], [aria-current]:not([aria-current=false]), :hover, :focus-visible)",
  ".music-settings-page select:is(:hover, :focus-visible, [aria-expanded=true])",
  ".music-settings-page input:is(:checked, [aria-checked=true], :hover, :focus-visible)",
  ".music-settings-page [role=slider]:is(:hover, :focus-visible)",
  "#music-eq-page button:is([aria-pressed=true], [aria-selected=true], [aria-expanded=true], :hover, :focus-visible)",
  "#music-eq-page select:is(:hover, :focus-visible, [aria-expanded=true])",
  "#music-eq-page input:is(:checked, [aria-checked=true], :hover, :focus-visible)",
  "#music-eq-page [role=slider]:is(:hover, :focus-visible)",
  "#music-lyrics-page button:not(.lyrics-line-button):is([aria-pressed=true], [aria-selected=true], [aria-expanded=true], :hover, :focus-visible)",
  "#music-lyrics-page .lyrics-preference-dialog",
  "#music-lyrics-page select:is(:hover, :focus-visible, [aria-expanded=true])",
  "#music-lyrics-page input:is(:checked, [aria-checked=true], :hover, :focus-visible)",
  ".music-panel button:is([aria-pressed=true], [aria-selected=true], [aria-expanded=true], :hover, :focus-visible)",
  ".music-panel select:is(:hover, :focus-visible, [aria-expanded=true])",
  ".music-panel input:is(:checked, [aria-checked=true], :hover, :focus-visible)",
  "#music-signal-page .signal-models button:is([aria-pressed=true], :hover, :focus-visible)",
  "#music-signal-page .signal-trace input[type=range]:is(:hover, :focus-visible)",
  "#playback-toggle:is([aria-pressed=true], :hover, :focus-visible)",
].join(",");

const TERMINAL_SURFACE_SELECTOR = [
  ".music-settings-page :is(.settings-category, .panel-section)",
  ".music-panel",
  ".music-topnav .theme-switch",
  "#music-lyrics-page .lyrics-preference-dialog",
].join(",");

const STATE_SOURCE_SELECTOR = [
  ".music-topnav button[aria-pressed=true]",
  ".theme-cards button[aria-pressed=true]",
  ".music-settings-page [aria-current]:not([aria-current=false])",
  "#music-settings input:checked",
  "#music-eq-page [aria-pressed=true]",
  "#music-eq-page input:checked",
  "#music-lyrics-page .lyrics-line.is-active",
  "#music-lyrics-page [aria-current=true]",
  "#music-lyrics-page [aria-selected=true]",
  "#music-lyrics-page input:checked",
  "#music-signal-page [aria-pressed=true]",
  "#playback-toggle[aria-pressed=true]",
  "#play-pause[aria-pressed=true]",
].join(",");

const HOVER_FOCUS_SOURCE_SELECTOR = [
  "button:hover",
  "select:hover",
  "input:hover",
  "[role=button]:hover",
  "[role=slider]:hover",
  "button:focus",
  "select:focus",
  "input:focus",
  "[role=button]:focus",
  "[role=slider]:focus",
].join(",");

const LIGHT_STYLE_PROPERTIES = [
  "--terminal-light-level",
  "--terminal-light-edge",
  "--terminal-light-highlight",
  "--terminal-light-shadow",
  "--terminal-light-halo",
  "--terminal-light-control-halo",
  "--terminal-light-spread",
  "--terminal-light-x",
  "--terminal-light-y",
] as const;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const finite = (value: number) => Number.isFinite(value);

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest("[hidden], [inert]"))
    return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function centerOf(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Adds restrained screen-space light response to existing Future controls.
 * This is a UI approximation of nearby lights, not real-time ray tracing.
 */
export function setupTerminalLighting(stage: HTMLElement): {
  setQuality(q: RenderQuality): void;
  setDirection(direction: Direction): void;
  refresh(): void;
  destroy(): void;
} {
  const root = stage.closest<HTMLElement>(".music-app") ?? stage;
  const initialRootQuality = root.getAttribute("data-terminal-lighting");
  const originalStyles = new Map<HTMLElement, ReceiverState>();
  const activeReceivers = new Set<HTMLElement>();
  let mode: RenderQuality["terminalLight"] = "off";
  let direction: Direction = { x: -0.8, y: 0.3 };
  let frame: number | null = null;
  let destroyed = false;

  const schedule = () => {
    if (destroyed || frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      update();
    });
  };

  function rememberReceiver(element: HTMLElement) {
    if (originalStyles.has(element)) return;
    const styles = new Map<string, OriginalStyle>();
    for (const property of LIGHT_STYLE_PROPERTIES) {
      styles.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      });
    }
    originalStyles.set(element, {
      receiverAttribute: element.getAttribute("data-terminal-receiver"),
      styles,
    });
    element.setAttribute(
      "data-terminal-receiver",
      element.matches(TERMINAL_SURFACE_SELECTOR) ? "surface" : "control",
    );
  }

  function restoreReceiver(element: HTMLElement) {
    const original = originalStyles.get(element);
    if (!original) return;
    for (const [property, saved] of original.styles) {
      if (saved.value)
        element.style.setProperty(property, saved.value, saved.priority);
      else element.style.removeProperty(property);
    }
    if (original.receiverAttribute === null)
      element.removeAttribute("data-terminal-receiver");
    else
      element.setAttribute(
        "data-terminal-receiver",
        original.receiverAttribute,
      );
    originalStyles.delete(element);
    activeReceivers.delete(element);
  }

  function clearReceivers() {
    for (const element of [...originalStyles.keys()]) restoreReceiver(element);
    activeReceivers.clear();
  }

  function candidateStrength(element: HTMLElement, baseline: number): number {
    if (element.matches(":hover")) return Math.max(baseline, 0.94);
    if (element.matches(":focus")) return Math.max(baseline, 0.86);
    if (element.matches(".lyrics-line.is-active"))
      return Math.max(baseline, 0.9);
    if (element.matches("[aria-current]:not([aria-current=false])"))
      return Math.max(baseline, 0.76);
    if (element.matches(":checked")) return Math.max(baseline, 0.62);
    return Math.max(baseline, 0.72);
  }

  function collectSources(bounds: DOMRect, limits: { sourceCount: number }, dialog?: HTMLElement) {
    const candidates = new Map<HTMLElement, number>();
    root
      .querySelectorAll<HTMLElement>(STATE_SOURCE_SELECTOR)
      .forEach((element) => {
        if (isVisible(element) && (!dialog || dialog.contains(element)))
          candidates.set(element, candidateStrength(element, 0.68));
      });
    root
      .querySelectorAll<HTMLElement>(HOVER_FOCUS_SOURCE_SELECTOR)
      .forEach((element) => {
        if (isVisible(element) && (!dialog || dialog.contains(element)))
          candidates.set(
            element,
            Math.max(
              candidates.get(element) ?? 0,
              candidateStrength(element, 0.82),
            ),
          );
      });

    const sources = [...candidates.entries()]
      .map(([element, strength]) => ({ ...centerOf(element), strength }))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limits.sourceCount);

    // The selected record is a virtual source at its projected screen bearing.
    // It adds no DOM object or decorative backdrop.
    const scene = root.querySelector<HTMLElement>("#three-scene");
    if (!dialog && scene && isVisible(scene)) {
      const magnitude = Math.hypot(direction.x, direction.y) || 1;
      sources.unshift({
        x:
          bounds.left + bounds.width * (0.5 + (direction.x / magnitude) * 0.33),
        y:
          bounds.top + bounds.height * (0.5 + (direction.y / magnitude) * 0.33),
        strength: 0.76,
      });
    }
    return sources;
  }

  function lightValues(
    element: HTMLElement,
    sources: LightSource[],
    limits: { radius: number; falloff: number; gain: number },
    bounds: DOMRect,
  ) {
    const center = centerOf(element);
    const diagonal = Math.max(1, Math.hypot(bounds.width, bounds.height));
    // The archive studio direction remains the common environment source even
    // while the music canvas is hidden on EQ/lyrics/settings pages.
    let energy = .16;
    let vectorX = direction.x * .16;
    let vectorY = direction.y * .16;
    for (const source of sources) {
      const dx = source.x - center.x;
      const dy = source.y - center.y;
      const distance = Math.hypot(dx, dy) / diagonal;
      if (distance > limits.radius) continue;
      const contribution =
        source.strength * Math.exp(-distance * limits.falloff);
      energy += contribution;
      vectorX += (dx / (Math.hypot(dx, dy) || 1)) * contribution;
      vectorY += (dy / (Math.hypot(dx, dy) || 1)) * contribution;
    }
    const level = clamp(energy * limits.gain, 0, 0.78);
    if (level < 0.025) return null;
    const vectorLength = Math.hypot(vectorX, vectorY) || 1;
    return {
      level,
      x: clamp(vectorX / vectorLength, -1, 1),
      y: clamp(vectorY / vectorLength, -1, 1),
    };
  }

  function setLightStyle(
    element: HTMLElement,
    level: number,
    x: number,
    y: number,
  ) {
    rememberReceiver(element);
    activeReceivers.add(element);
    const set = (
      property: (typeof LIGHT_STYLE_PROPERTIES)[number],
      value: string,
    ) => element.style.setProperty(property, value);
    set("--terminal-light-level", level.toFixed(3));
    set("--terminal-light-edge", `${(7 + level * 19).toFixed(1)}%`);
    set("--terminal-light-highlight", `${(10 + level * 32).toFixed(1)}%`);
    set("--terminal-light-shadow", `${(3 + level * 8).toFixed(1)}%`);
    set("--terminal-light-halo", `${(3 + level * 13).toFixed(1)}%`);
    set("--terminal-light-control-halo", `${(1 + level * 2.6).toFixed(1)}%`);
    set("--terminal-light-spread", `${(7 + level * 15).toFixed(1)}px`);
    set("--terminal-light-x", `${(-x * (0.5 + level * 1.8)).toFixed(2)}px`);
    set("--terminal-light-y", `${(-y * (0.5 + level * 1.8)).toFixed(2)}px`);
  }

  function update() {
    if (destroyed) return;
    if (root.getAttribute("data-terminal-lighting") !== mode)
      root.setAttribute("data-terminal-lighting", mode);
    if (mode === "off" || root.dataset.design !== "rhine") {
      clearReceivers();
      return;
    }

    const bounds = root.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) {
      clearReceivers();
      return;
    }
    const limits =
      mode === "local"
        ? {
            sourceCount: 2,
            receiverCount: 18,
            radius: 0.34,
            falloff: 8,
            gain: 0.62,
          }
        : {
            sourceCount: 9,
            receiverCount: 64,
            radius: 0.76,
            falloff: 4.6,
            gain: 0.86,
          };
    const dialog = [
      root.querySelector<HTMLElement>("#music-lyrics-page .lyrics-preference-dialog"),
      root.querySelector<HTMLElement>(".music-panel"),
    ].find((candidate): candidate is HTMLElement => !!candidate && isVisible(candidate));
    const sources = collectSources(bounds, limits, dialog);

    const ranked = [...root.querySelectorAll<HTMLElement>(RECEIVER_SELECTOR)]
      .filter((element) => {
        if (element.matches(":disabled") || !isVisible(element)) return false;
        if (!dialog) return true;
        if (element === dialog) return true;
        // The modal is one glass surface. Its inner controls receive only
        // interaction highlights, instead of each casting an ambient halo.
        return dialog.contains(element) && element.matches(
          ":hover, :focus-visible, [aria-selected=true], [aria-pressed=true], [aria-expanded=true], [aria-current]:not([aria-current=false]), :checked, [aria-checked=true]",
        );
      })
      .map((element) => ({
        element,
        light: lightValues(element, sources, limits, bounds),
      }))
      .filter(
        (
          entry,
        ): entry is {
          element: HTMLElement;
          light: NonNullable<typeof entry.light>;
        } => entry.light !== null,
      )
      .sort((a, b) => b.light.level - a.light.level)
      .slice(0, limits.receiverCount);
    const nextReceivers = new Set(ranked.map(({ element }) => element));
    for (const element of [...activeReceivers]) {
      if (!nextReceivers.has(element)) restoreReceiver(element);
    }
    for (const { element, light } of ranked)
      setLightStyle(element, light.level, light.x, light.y);
  }

  const onActivity: EventListener = () => schedule();
  for (const type of [
    "pointerover",
    "pointerout",
    "focusin",
    "focusout",
    "click",
    "input",
    "change",
  ]) {
    root.addEventListener(type, onActivity, { passive: true });
  }
  root.addEventListener("scroll", onActivity, { passive: true, capture: true });

  const observer = new MutationObserver(records => {
    // Playback timers and rolling text change frequently without moving any
    // luminous control. Ignore text-only mutations to avoid a layout pass per tick.
    if (records.some(record => record.type === "attributes" ||
      [...record.addedNodes, ...record.removedNodes].some(node => node instanceof HTMLElement))) schedule();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "aria-pressed",
      "aria-current",
      "aria-selected",
      "aria-checked",
      "checked",
      "selected",
      "class",
      "hidden",
      "inert",
      "data-page",
      "data-design",
      "data-theme",
    ],
  });

  const resizeObserver =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(schedule);
  resizeObserver?.observe(root);

  return {
    setQuality(q) {
      const next = q?.terminalLight;
      const normalized =
        next === "off" || next === "local" || next === "full" ? next : "off";
      if (mode === normalized) return;
      mode = normalized;
      schedule();
    },
    setDirection(next) {
      if (!finite(next.x) || !finite(next.y)) return;
      const x = clamp(next.x, -1, 1);
      const y = clamp(next.y, -1, 1);
      if (
        Math.abs(direction.x - x) < 0.002 &&
        Math.abs(direction.y - y) < 0.002
      )
        return;
      direction = { x, y };
      schedule();
    },
    refresh() {
      schedule();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver?.disconnect();
      for (const type of [
        "pointerover",
        "pointerout",
        "focusin",
        "focusout",
        "click",
        "input",
        "change",
      ])
        root.removeEventListener(type, onActivity);
      root.removeEventListener("scroll", onActivity, true);
      clearReceivers();
      if (initialRootQuality === null)
        root.removeAttribute("data-terminal-lighting");
      else root.setAttribute("data-terminal-lighting", initialRootQuality);
    },
  };
}
