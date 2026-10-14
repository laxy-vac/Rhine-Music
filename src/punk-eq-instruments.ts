const SVG_NS = "http://www.w3.org/2000/svg";

const FREQUENCY_LABELS = [
  { value: 10, text: "10" },
  { value: 100, text: "100" },
  { value: 1_000, text: "1k" },
  { value: 10_000, text: "10k" },
  { value: 96_000, text: "96k" },
];

const Q_LABELS = [
  { value: 0.001, text: ".001" },
  { value: 0.01, text: ".01" },
  { value: 0.1, text: ".1" },
  { value: 1, text: "1" },
  { value: 10, text: "10" },
  { value: 36, text: "36" },
];

const DIAL_TICK_COUNT = 25;
const GAIN_TICK_COUNT = 9;

function readNumberAttribute(element: Element, name: string): number | null {
  const rawValue = element.getAttribute(name);
  if (rawValue === null || rawValue.trim() === "") return null;

  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function decorateSvg(svg: SVGSVGElement, className: string, viewBox: string): void {
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("data-punk-eq-scale", "");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("pointer-events", "none");
  svg.style.pointerEvents = "none";
}

function getOrCreateScale(
  container: HTMLElement,
  className: string,
  viewBox: string,
): SVGSVGElement {
  let svg = container.querySelector<SVGSVGElement>(`svg.${className}[data-punk-eq-scale]`);
  if (!svg) {
    svg = document.createElementNS(SVG_NS, "svg");
    container.append(svg);
  }

  decorateSvg(svg, className, viewBox);
  return svg;
}

function setLine(
  line: SVGLineElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string,
): void {
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("class", className);
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "0.8");
}

function appendDialLabel(svg: SVGSVGElement, angle: number, text: string): void {
  const radians = (angle * Math.PI) / 180;
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", String(48 + Math.sin(radians) * 44));
  label.setAttribute("y", String(48 - Math.cos(radians) * 44));
  label.setAttribute("class", "punk-eq-dial-scale-label");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("font-size", "6px");
  label.setAttribute("font-family", "monospace");
  label.setAttribute("fill", "currentColor");
  label.textContent = text;
  svg.append(label);
}

function dialLabelsFor(button: HTMLButtonElement): typeof FREQUENCY_LABELS | typeof Q_LABELS | null {
  const dial = (button.dataset.eqDial ?? "").trim().toLowerCase();
  if (dial === "q" || dial.includes("quality") || dial.includes("bandwidth")) {
    return Q_LABELS;
  }
  if (dial.includes("freq")) return FREQUENCY_LABELS;
  return null;
}

function syncDialScale(button: HTMLButtonElement): void {
  const svg = getOrCreateScale(button, "punk-eq-dial-scale", "0 0 96 96");
  svg.replaceChildren();

  for (let index = 0; index < DIAL_TICK_COUNT; index += 1) {
    const angle = -135 + (index * 270) / (DIAL_TICK_COUNT - 1);
    const radians = (angle * Math.PI) / 180;
    const innerRadius = 33;
    const outerRadius = index % 2 === 0 ? 37 : 35;
    const tick = document.createElementNS(SVG_NS, "line");
    setLine(
      tick,
      48 + Math.sin(radians) * innerRadius,
      48 - Math.cos(radians) * innerRadius,
      48 + Math.sin(radians) * outerRadius,
      48 - Math.cos(radians) * outerRadius,
      index % 2 === 0 ? "punk-eq-dial-tick is-long" : "punk-eq-dial-tick is-short",
    );
    svg.append(tick);
  }

  const min = readNumberAttribute(button, "aria-valuemin");
  const max = readNumberAttribute(button, "aria-valuemax");
  const labels = dialLabelsFor(button);
  if (min === null || max === null || min <= 0 || max <= min || !labels) return;

  const logMin = Math.log(min);
  const logSpan = Math.log(max) - logMin;
  for (const label of labels) {
    if (label.value < min || label.value > max) continue;

    const angle = -135 + ((Math.log(label.value) - logMin) / logSpan) * 270;
    appendDialLabel(svg, angle, label.text);
  }
}

function findLabel(container: HTMLElement, input: HTMLInputElement): HTMLLabelElement | null {
  if (container instanceof HTMLLabelElement) return container;

  const wrappingLabel = input.closest("label");
  if (wrappingLabel && container.contains(wrappingLabel)) return wrappingLabel;

  if (input.id) {
    const associatedLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.htmlFor === input.id,
    );
    if (associatedLabel) return associatedLabel;
  }

  return container.querySelector("label");
}

function formatGainValue(value: number): string {
  const roundedValue = Math.round(value * 100) / 100;
  const normalizedValue = Object.is(roundedValue, -0) ? 0 : roundedValue;
  const text = String(normalizedValue);
  return normalizedValue > 0 ? `+${text}` : text;
}

function appendGainLabel(svg: SVGSVGElement, y: number, text: string): void {
  const label = document.createElementNS(SVG_NS, "text");
  label.setAttribute("x", "24");
  label.setAttribute("y", String(y));
  label.setAttribute("class", "punk-eq-gain-scale-label");
  label.setAttribute("text-anchor", "end");
  label.setAttribute("dominant-baseline", "middle");
  label.setAttribute("font-size", "6px");
  label.setAttribute("font-family", "monospace");
  label.setAttribute("fill", "currentColor");
  label.textContent = text;
  svg.append(label);
}

function syncGainScale(container: HTMLElement): void {
  const input = container.querySelector<HTMLInputElement>('input[type="range"]');
  if (!input) return;

  const label = findLabel(container, input);
  if (!label) return;

  const svg = getOrCreateScale(label, "punk-eq-gain-scale", "0 0 34 180");
  svg.replaceChildren();
  const min = readNumberAttribute(input, "min");
  const max = readNumberAttribute(input, "max");
  if (min === null || max === null || max <= min) return;

  for (let index = 0; index < GAIN_TICK_COUNT; index += 1) {
    const y = 10 + (index * 160) / (GAIN_TICK_COUNT - 1);
    const tick = document.createElementNS(SVG_NS, "line");
    const zero = Math.abs(max - index * (max - min) / (GAIN_TICK_COUNT - 1)) < 1e-9;
    setLine(tick, zero ? 25 : 28, y, 34, y, `punk-eq-gain-tick${zero ? " is-zero" : ""}`);
    svg.append(tick);
  }

  const candidates = [max, max / 2, 0, min / 2, min];
  const seen = new Set<number>();
  for (const value of candidates) {
    if (value < min || value > max || seen.has(value)) continue;
    seen.add(value);

    const y = 10 + ((max - value) / (max - min)) * 160;
    appendGainLabel(svg, y, formatGainValue(value));
  }
}

function removePunkScales(root: HTMLElement): void {
  root
    .querySelectorAll<SVGSVGElement>(
      "svg.punk-eq-dial-scale[data-punk-eq-scale], svg.punk-eq-gain-scale[data-punk-eq-scale]",
    )
    .forEach((svg) => svg.remove());
}

export function syncPunkEqInstruments(root: HTMLElement): void {
  if (root.closest<HTMLElement>(".music-app")?.dataset.design !== "archive") {
    removePunkScales(root);
    return;
  }

  root
    .querySelectorAll<HTMLButtonElement>("button.eq-parameter-dial[data-eq-dial]")
    .forEach(syncDialScale);

  root
    .querySelectorAll<HTMLElement>(".eq-parametric-gain, .eq-graphic-gain")
    .forEach(syncGainScale);
}
