import { trUi, ui } from "./i18n";
import { calcEqBandResponseSamples, calcEqResponseSamples, type EqBand, type ProcessingSettings } from "./audio-processing-model.mjs";
import { escapeHtml as esc } from "./html";
import { renderLspEqControls, setupLspEqControls } from "./lsp-eq-controls";

const filterNames = [trUi("低通"), trUi("高通"), trUi("带通"), trUi("峰值"), trUi("低架"), trUi("高架")] as const;
const channels = [trUi("双声道"), trUi("左声道"), trUi("右声道")] as const;
type EqSampleRateReference = { rate: number; source: "actual" | "track" | "default" };
const defaultSampleRateReference: EqSampleRateReference = { rate: 48000, source: "default" };
const defaultGraphicFrequencies = [31, 62, 124, 249, 498, 996, 1995, 3993, 7993, 16000];
const fallbackColors = ["#8b9a9c", "#a58d84", "#9a9d81", "#8f91a2", "#9a8798", "#85999a", "#a2947c", "#8b91a0", "#9d8d80", "#879889"];
const graph = { width: 720, height: 180, left: 46, right: 706, top: 12, bottom: 146, minHz: 20, maxHz: 20000, minDb: -24, maxDb: 24 };
const responseFrequencies = Array.from({ length: 241 }, (_, index) => graph.minHz * (graph.maxHz / graph.minHz) ** (index / 240));

function dbY(db: number) {
  const bounded = Math.max(graph.minDb, Math.min(graph.maxDb, db));
  return graph.top + ((graph.maxDb - bounded) / (graph.maxDb - graph.minDb)) * (graph.bottom - graph.top);
}

function hzX(hz: number, width = graph.width) {
  const bounded = Math.max(graph.minHz, Math.min(graph.maxHz, hz));
  return graph.left + (Math.log(bounded / graph.minHz) / Math.log(graph.maxHz / graph.minHz)) * (width - 14 - graph.left);
}

function dialAngle(value: number, minimum: number, maximum: number) {
  const position = Math.log(Math.max(minimum, Math.min(maximum, value)) / minimum) / Math.log(maximum / minimum);
  return `${-135 + position * 270}deg`;
}

function parameterDial(band: EqBand, index: number, field: "frequency" | "q") {
  const frequency = field === "frequency", minimum = frequency ? 10 : 0.001, maximum = frequency ? 96000 : 36;
  const title = frequency ? trUi("频率 · Hz") : trUi("Q 值"), value = band[field], locked = band.locked === true;
  return ui`<label class="eq-dial-field"><span>${title}</span>
    <button type="button" class="eq-parameter-dial" data-eq-dial="${field}" data-band-index="${index}" role="slider" aria-label="第 ${index + 1} 段${title}" aria-valuemin="${minimum}" aria-valuemax="${maximum}" aria-valuenow="${value}" style="--dial-turn:${dialAngle(value, minimum, maximum)}" ${locked ? "disabled" : ""}><span class="eq-dial-indicator" aria-hidden="true"></span></button>
    <input class="eq-dial-number" type="number" min="${frequency || band.enabled ? minimum : 0}" max="${maximum}" step="any" data-processing-field="eq.bands.${index}.${field}" aria-label="第 ${index + 1} 段${title}数值" value="${value}" ${locked ? "disabled" : ""}>
  </label>`;
}

function graphicFrequencies(count: number, first: number, last: number) {
  if (count <= 1) return [first];
  return Array.from({ length: count }, (_, index) => first * (last / first) ** (index / (count - 1)));
}

function interpolateGain(bands: EqBand[], frequency: number) {
  if (!bands.length) return 0;
  const ordered = [...bands].sort((a, b) => a.frequency - b.frequency);
  if (frequency <= ordered[0].frequency) return ordered[0].gain;
  if (frequency >= ordered.at(-1)!.frequency) return ordered.at(-1)!.gain;
  const index = ordered.findIndex((band) => band.frequency >= frequency);
  const left = ordered[index - 1], right = ordered[index];
  const progress = (frequency - left.frequency) / (right.frequency - left.frequency);
  return left.gain + (right.gain - left.gain) * progress;
}

function resampleGraphic(bands: EqBand[], count: number) {
  const ordered = [...bands].sort((a, b) => a.frequency - b.frequency);
  const first = Math.round(ordered[0]?.frequency ?? defaultGraphicFrequencies[0]);
  const last = Math.round(ordered.at(-1)?.frequency ?? defaultGraphicFrequencies.at(-1)!);
  if (last - first < count - 1) throw new RangeError(trUi("首末频率之间的间隔不足以放置这些图形频段。"));
  const frequencies = graphicFrequencies(count, first, last).map((frequency, index) => {
    const minimum = first + index;
    const maximum = last - (count - 1 - index);
    return Math.min(maximum, Math.max(minimum, Math.round(frequency)));
  });
  return frequencies.map((frequency, index) => ({
    type: 2 as const,
    channels: 0 as const,
    frequency: Math.round(frequency),
    q: 0,
    gain: interpolateGain(ordered, frequency),
    color: ordered[index]?.color || fallbackColors[index % fallbackColors.length],
    enabled: ordered[index]?.enabled ?? true,
    locked: ordered[index]?.locked ?? false,
  }));
}

function freshParametricBand(bands: EqBand[]): EqBand {
  const frequency = Math.max(10, Math.min(20000, bands.length ? bands.at(-1)!.frequency : 1000));
  return {
    type: 3,
    channels: 0,
    frequency,
    q: 0.707,
    gain: 0,
    color: fallbackColors[bands.length % fallbackColors.length],
    enabled: true,
    locked: false,
  };
}

function graphicBand(band: EqBand, index: number) {
  const locked = band.locked === true;
  const frequency = band.frequency >= 1000 ? `${Number((band.frequency / 1000).toFixed(3))}k` : String(band.frequency);
  return ui`<article class="eq-graphic-band${locked ? " is-locked" : ""}" data-eq-band-card="${index}" style="--band-color:${band.color}">
    <header><span class="eq-band-index">${String(index + 1).padStart(2, "0")}</span><output class="eq-graphic-frequency" title="${band.frequency} Hz">${frequency}<small>Hz</small></output></header>
    <label class="eq-graphic-gain"><span class="eq-graphic-gain-label">增益 · dB</span><input type="range" min="-36" max="36" step="any" data-range-unit=" dB" data-processing-field="eq.bands.${index}.gain" aria-label="${band.frequency} Hz 频段增益" value="${band.gain}" ${locked ? "disabled" : ""}></label>
    <label class="eq-graphic-enable"><span>启用</span><input type="checkbox" role="switch" data-processing-field="eq.bands.${index}.enabled" aria-label="启用 ${band.frequency} Hz 频段" ${band.enabled ? "checked" : ""}></label>
    <button type="button" class="eq-graphic-lock" data-eq-action="lock-band" data-band-index="${index}" aria-pressed="${locked}" aria-label="${locked ? trUi("解锁") : trUi("锁定")} ${band.frequency} Hz 频段">${locked ? trUi("已锁定") : trUi("锁定")}</button>
  </article>`;
}

function parametricBand(band: EqBand, index: number) {
  const locked = band.locked === true;
  const gainSupported = band.type >= 2;
  const typeControl = ui`<label><span>滤波</span><select data-processing-field="eq.bands.${index}.type" data-processing-number="true" aria-label="第 ${index + 1} 段滤波类型" ${locked ? "disabled" : ""}>${filterNames.map((name, type) => `<option value="${type}" ${band.type === type ? "selected" : ""}>${name}</option>`).join("")}</select></label>`;
  const channelControl = ui`<label><span>声道</span><select data-processing-field="eq.bands.${index}.channels" data-processing-number="true" aria-label="第 ${index + 1} 段声道" ${locked ? "disabled" : ""}>${channels.map((name, channel) => `<option value="${channel}" ${band.channels === channel ? "selected" : ""}>${name}</option>`).join("")}</select></label>`;
  return ui`<article class="eq-band-card${locked ? " is-locked" : ""}" data-eq-band-card="${index}" style="--band-color:${band.color}">
    <header><span class="eq-band-index"><i style="--band-color:${band.color}"></i>${String(index + 1).padStart(2, "0")} / 参数频段</span>
      <label class="eq-parametric-enabled"><input type="checkbox" role="switch" data-processing-field="eq.bands.${index}.enabled" aria-label="启用第 ${index + 1} 段" ${band.enabled ? "checked" : ""}></label>
      <div class="eq-band-actions"><button type="button" data-eq-action="lock-band" data-band-index="${index}" aria-pressed="${locked}" title="${locked ? trUi("解锁频段") : trUi("锁定频段")}">${locked ? trUi("锁定中") : trUi("锁定")}</button><button type="button" data-eq-action="remove-band" data-band-index="${index}" aria-label="删除第 ${index + 1} 段" ${locked ? "disabled" : ""}>移除</button></div>
    </header>
    <div class="eq-band-fields eq-band-selects">
      ${typeControl}${channelControl}
    </div>
    <div class="eq-parametric-adjustments">
      <label class="eq-parametric-gain"><span>增益 · dB</span><input type="range" min="-36" max="36" step="any" data-range-unit=" dB" data-processing-field="eq.bands.${index}.gain" aria-label="第 ${index + 1} 段增益" value="${band.gain}" ${locked || !gainSupported ? "disabled" : ""}>${gainSupported ? "" : trUi('<small>此类型不使用增益</small>')}</label>
      <div class="eq-parametric-values">${parameterDial(band, index, "q")}${parameterDial(band, index, "frequency")}</div>
    </div>
  </article>`;
}

function chartGrid(width = graph.width) {
  return `${[-24, -12, 0, 12, 24].map((db) => `<line x1="${graph.left}" x2="${width - 14}" y1="${dbY(db)}" y2="${dbY(db)}" class="${db === 0 ? "is-zero" : ""}"/><text x="4" y="${dbY(db) + 4}">${db > 0 ? "+" : ""}${db}</text>`).join("")}
    ${[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((hz) => `<line x1="${hzX(hz, width)}" x2="${hzX(hz, width)}" y1="${graph.top}" y2="${graph.bottom}"/><text x="${hzX(hz, width)}" y="${graph.bottom + 18}" text-anchor="middle">${hz >= 1000 ? `${hz / 1000}k` : hz}</text>`).join("")}`;
}

function responseFigure() {
  return ui`<figure class="eq-response-figure">
    <svg class="eq-response-chart" viewBox="0 0 ${graph.width} ${graph.height}" preserveAspectRatio="none" role="img" aria-label="EQ 频响预览">
      <g class="eq-chart-grid" aria-hidden="true">${chartGrid()}</g>
      <g data-eq-band-curves aria-hidden="true"></g>
      <path class="eq-response-left" data-eq-response="left" d=""/>
      <path class="eq-response-right" data-eq-response="right" d=""/>
      <g data-eq-nodes="true"></g>
    </svg>
    <div class="eq-response-legend" aria-label="各频段响应"></div>
    <figcaption>当前设置的参考频响；彩色曲线为各频段，总曲线包含前级与已开启的音调。</figcaption>
  </figure>`;
}

export function renderEqControls(settings: ProcessingSettings) {
  const eq = settings.eq;
  const engine = eq.engine ?? "standard";
  return ui`<div class="eq-controls" id="processing-eq-controls" data-eq-mode="${eq.mode}" data-eq-engine="${engine}">
    <div class="eq-controls-main">
    <div class="eq-head-controls">
      <label class="settings-row"><span>均衡器<small>仅在原生音频输出中参与处理</small></span><input type="checkbox" role="switch" data-processing-field="eq.enabled" ${eq.enabled ? "checked" : ""}></label>
      <div class="settings-row"><span>${trUi("均衡器模式")}</span><div class="eq-engine-choice" role="group" aria-label="${trUi("均衡器模式")}"><button type="button" data-eq-engine-target="standard" aria-pressed="${engine === "standard"}" ${settings.bitPerfect ? "disabled" : ""}>${trUi("简单入门")}</button><button type="button" data-eq-engine-target="lsp" aria-pressed="${engine === "lsp"}" ${settings.bitPerfect ? "disabled" : ""}>LSP · ${trUi("进阶")}</button></div></div>
      <label class="settings-row eq-preset-title-control"><span>预设名称<small>随均衡参数保存在本机</small></span><input type="text" maxlength="80" data-processing-field="eq.name" aria-label="均衡器预设名称" value="${esc(eq.name)}"></label>
      ${engine === "standard" ? ui`<label class="settings-row"><span>均衡方式</span><select data-processing-field="eq.mode" aria-label="均衡器方式"><option value="graphic" ${eq.mode === "graphic" ? "selected" : ""}>图形均衡器</option><option value="parametric" ${eq.mode === "parametric" ? "selected" : ""}>参数均衡器</option></select></label>
      ${eq.mode === "graphic" ? ui`<label class="settings-row"><span>频段数量<small>5–32 段；增减时按频率 Hz 插值增益</small></span><select data-eq-band-count aria-label="图形均衡器频段数量">${Array.from({ length: 28 }, (_, index) => index + 5).map((count) => ui`<option value="${count}" ${eq.bands.length === count ? "selected" : ""}>${count} 段</option>`).join("")}</select></label>` : ""}
      <div class="eq-number-pair">
        <label><span>前级增益 · dB</span><input type="number" min="-36" max="36" step="0.1" data-processing-field="eq.preamp" value="${eq.preamp}" aria-label="均衡器前级增益"></label>
        ${eq.mode === "graphic" ? ui`<label><span>自动带宽倍率 · 0.5–2</span><input type="range" min="0.5" max="2" step="0.05" data-range-unit="×" data-processing-field="eq.bandwidth" value="${eq.bandwidth}" aria-label="图形均衡器自动带宽倍率"></label>` : trUi(`<small>每段 Q 值独立设置。</small>`)}
      </div>` : ""}
    </div>
    <p class="eq-control-error" data-eq-error role="status" aria-live="polite" hidden></p>
    ${engine === "standard" ? ui`
    <div class="eq-workspace">
      <p class="eq-mode-description">${eq.mode === "graphic" ? trUi("固定频段，调节各段增益；带宽由上方统一调整。曲线上的控制点仅上下移动。") : trUi("横向浏览频段；拖动旋钮调节频率与 Q，点击数值精确输入。曲线仅作预览。")}</p>
      <div class="eq-band-list ${eq.mode === "graphic" ? "eq-graphic-bank" : "eq-parametric-strip"}" data-eq-band-list>${eq.bands.map((band, index) => eq.mode === "graphic" ? graphicBand(band, index) : parametricBand(band, index)).join("")}</div>
      ${eq.mode === "parametric" ? ui`<div class="eq-strip-navigation"><input type="range" min="0" max="1000" step="any" value="0" data-eq-strip-scroll data-editable-range="false" aria-label="横向浏览 EQ 频段"><button type="button" class="eq-add-band" data-eq-action="add-band" ${eq.bands.length >= 128 ? "disabled" : ""}>添加频段</button></div>` : ""}
    </div>
    ` : ui`${renderLspEqControls(settings)}`}
    </div>
    ${engine === "standard" ? responseFigure() : ""}
  </div>`;
}

function numericRow(path: string, label: string, value: number, min: number, max: number, step: number, unit = "") {
  return `<label class="processing-number-row"><span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}" data-processing-field="${path}" aria-label="${label}" value="${value}"><small>${unit}</small></label>`;
}

function gainRow(path: string, label: string, value: number) {
  return `<label class="processing-range-row"><span>${label}</span><input type="range" min="-24" max="24" step="any" data-range-unit=" dB" data-processing-field="${path}" aria-label="${label}" value="${value}"></label>`;
}

export function renderToneControls(settings: ProcessingSettings) {
  const tone = settings.tone;
  return ui`<div class="tone-controls">
    <label class="settings-row"><span>音调控制<small>低音与高音各自使用架式滤波</small></span><input type="checkbox" role="switch" data-processing-field="tone.enabled" ${tone.enabled ? "checked" : ""}></label>
    <div class="tone-filter-grid">
      ${(["bass", "treble"] as const).map((key) => {
        const filter = tone[key];
        const name = key === "bass" ? trUi("低音") : trUi("高音");
        return `<section class="tone-filter-card"><h4>${name}</h4>
          ${numericRow(`tone.${key}.frequency`, trUi("中心频率"), filter.frequency, 10, 40000, 1, "Hz")}
          ${numericRow(`tone.${key}.q`, trUi("Q / 架式斜率"), filter.q, 0.1, 18, 0.01, "")}
          ${gainRow(`tone.${key}.gain`, trUi("增益"), filter.gain)}
        </section>`;
      }).join("")}
    </div>
  </div>`;
}

function responsePath(response: number[], width: number) {
  return response.map((db, index) => `${index === 0 ? "M" : "L"}${hzX(responseFrequencies[index], width).toFixed(2)},${dbY(db).toFixed(2)}`).join(" ");
}

function drawResponse(root: HTMLElement, settings: ProcessingSettings, reference: EqSampleRateReference = defaultSampleRateReference) {
  const svg = root.querySelector<SVGSVGElement>(".eq-response-chart");
  if (!svg) return;
  const width = Math.max(320, svg.clientWidth || graph.width);
  const preview = { ...settings, eq: { ...settings.eq, enabled: true } };
  svg.setAttribute("viewBox", `0 0 ${width} ${graph.height}`);
  svg.querySelector(".eq-chart-grid")!.innerHTML = chartGrid(width);
  const sampleRate = Number.isFinite(reference.rate) && reference.rate > 0 ? reference.rate : defaultSampleRateReference.rate;
  const sampleRateLabel = `${Number((sampleRate / 1000).toFixed(1))} kHz`;
  const sampleRateContext = reference.source === "actual"
    ? ui`本次滤波输入 ${sampleRateLabel}`
    : reference.source === "track"
      ? ui`当前音源 ${sampleRateLabel} 参考`
      : ui`${sampleRateLabel} 默认参考`;
  svg.setAttribute("aria-label", ui`EQ 频响预览，各段彩色响应与总响应，${sampleRateLabel} 参考`);
  const caption = root.querySelector<HTMLElement>(".eq-response-figure figcaption");
  if (caption) caption.textContent = ui`${settings.eq.enabled ? "" : trUi("均衡器已关闭，曲线仅预览设置。")}当前设置的参考频响 · ${sampleRateContext}。总曲线包含前级与已开启音调。`;
  const left = svg.querySelector<SVGPathElement>('[data-eq-response="left"]');
  const right = svg.querySelector<SVGPathElement>('[data-eq-response="right"]');
  if (left) left.setAttribute("d", responsePath(calcEqResponseSamples(preview, responseFrequencies, sampleRate, 0), width));
  if (right) right.setAttribute("d", responsePath(calcEqResponseSamples(preview, responseFrequencies, sampleRate, 1), width));
  const selected = Number(root.dataset.eqSelectedBand ?? -1);
  const bandCurves = svg.querySelector<SVGGElement>("[data-eq-band-curves]");
  bandCurves?.replaceChildren(...settings.eq.bands.flatMap((band, index) => {
    const values = calcEqBandResponseSamples(preview, index, responseFrequencies, sampleRate, band.channels === 2 ? 1 : 0);
    const path = responsePath(values, width);
    const fill = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    fill.setAttribute("class", `eq-response-band-fill${band.enabled ? "" : " is-inactive"}`);
    fill.setAttribute("data-eq-band-fill", String(index));
    fill.setAttribute("d", `${path}L${width - 14},${dbY(0)}L${graph.left},${dbY(0)}Z`);
    fill.style.setProperty("--band-color", band.color);
    const line = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    line.setAttribute("class", `eq-response-band-line${band.enabled ? "" : " is-inactive"}${index === selected ? " is-selected" : ""}`);
    line.setAttribute("data-eq-band-response", String(index));
    line.setAttribute("d", path);
    line.style.setProperty("--band-color", band.color);
    return [fill, line];
  }));
  const legend = root.querySelector<HTMLElement>(".eq-response-legend");
  const legendSignature = JSON.stringify(settings.eq.bands.map(band => [band.color, band.enabled, band.frequency, band.channels, band.type]));
  if (legend && legend.dataset.signature !== legendSignature) {
    legend.dataset.signature = legendSignature;
    legend.innerHTML = trUi('<span class="eq-legend-total">总响应</span>') + settings.eq.bands.map((band, index) => ui`<button type="button" class="eq-legend-item${band.enabled ? "" : " is-inactive"}" data-eq-focus-band="${index}" style="--band-color:${band.color}" aria-label="定位第 ${index + 1} 段 ${band.frequency} Hz${band.enabled ? "" : trUi("，未启用")}"><i aria-hidden="true"></i>${String(index + 1).padStart(2, "0")} · ${Number(band.frequency.toFixed(2))} Hz${band.channels === 0 ? "" : band.channels === 1 ? " · L" : " · R"}${band.enabled ? "" : trUi(" · 关闭")}</button>`).join("");
  }
  root.querySelectorAll<HTMLElement>("[data-eq-band-card]").forEach(card => card.classList.toggle("is-selected", Number(card.dataset.eqBandCard) === selected));
  const nodes = svg.querySelector<SVGGElement>("[data-eq-nodes]");
  if (!nodes) return;
  nodes.replaceChildren(...(settings.eq.mode === "graphic" ? settings.eq.bands.map((band, index) => {
    const circle = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "circle");
    const actualGain = band.gain + settings.eq.preamp;
    circle.setAttribute("cx", String(hzX(band.frequency, width)));
    circle.setAttribute("cy", String(dbY(actualGain)));
    circle.setAttribute("r", band.locked ? "4.3" : "5.2");
    circle.setAttribute("class", `eq-response-node${band.locked ? " is-locked" : ""}`);
    circle.setAttribute("fill", band.color);
    circle.setAttribute("data-eq-node", String(index));
    circle.setAttribute("aria-label", ui`${index + 1} 段，${Math.round(band.frequency)} Hz，${band.gain.toFixed(1)} dB${band.locked ? trUi("，已锁定") : ""}`);
    return circle;
  }) : []));
  const asymmetry = settings.eq.bands.some((band) => band.channels !== 0);
  right?.classList.toggle("is-visible", asymmetry);
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function setupEqControls(
  root: HTMLElement,
  getSettings: () => ProcessingSettings,
  onSettingsChange: (settings: ProcessingSettings, committed?: boolean) => void,
  resolveMode?: (current: ProcessingSettings, target: ProcessingSettings["eq"]["mode"]) => ProcessingSettings["eq"] | undefined,
  getSampleRate?: () => EqSampleRateReference | undefined,
) {
  let draggedIndex: number | null = null;
  let dragPointerId: number | undefined;
  let dialDrag: { index: number; field: "frequency" | "q"; pointer: number; startY: number; startValue: number } | undefined;
  let drawFrame = 0;
  let resizeObserver: ResizeObserver | undefined;
  let lspEqControls: ReturnType<typeof setupLspEqControls> | undefined;
  const windowRef = root.ownerDocument.defaultView;
  let lastCurveSignature = "";
  let engineSwitchPending = false;
  const responseSampleRate = (): EqSampleRateReference => {
    try {
      const value = getSampleRate?.();
      if (value && Number.isFinite(value.rate) && value.rate > 0 && ["actual", "track", "default"].includes(value.source)) return value;
    } catch {}
    return defaultSampleRateReference;
  };
  const redraw = (force = false) => {
    const settings = getSettings();
    const reference = responseSampleRate();
    const chartWidth = root.querySelector<SVGSVGElement>(".eq-response-chart, .lsp-eq-response-chart")?.clientWidth;
    const signature = `${JSON.stringify(settings)}|${JSON.stringify(reference)}|${root.dataset.eqSelectedBand}|${chartWidth}`;
    if (!force && signature === lastCurveSignature) return;
    if (settings.eq.engine === "lsp") {
      lspEqControls?.sync();
      lastCurveSignature = signature;
      return;
    }
    lspEqControls?.sync();
    drawResponse(root, settings, reference);
    root.querySelectorAll<HTMLButtonElement>("[data-eq-dial]").forEach(dial => {
      const band = settings.eq.bands[Number(dial.dataset.bandIndex)], field = dial.dataset.eqDial as "frequency" | "q";
      if (!band) return;
      const minimum = field === "frequency" ? 10 : 0.001, maximum = field === "frequency" ? 96000 : 36;
      dial.style.setProperty("--dial-turn", dialAngle(band[field], minimum, maximum));
      dial.setAttribute("aria-valuenow", String(band[field]));
      const input = dial.parentElement?.querySelector<HTMLInputElement>("input[type=number]");
      if (input && input !== root.ownerDocument.activeElement) input.value = String(band[field]);
    });
    lastCurveSignature = signature;
  };
  const scheduleDraw = () => {
    if (drawFrame) return;
    if (!windowRef) { redraw(); return; }
    drawFrame = windowRef.requestAnimationFrame(() => { drawFrame = 0; redraw(); });
  };
  const syncStrip = () => {
    const strip = root.querySelector<HTMLElement>(".eq-parametric-strip"), control = root.querySelector<HTMLInputElement>("[data-eq-strip-scroll]");
    if (!strip || !control) return;
    const overflow = Math.max(0, strip.scrollWidth - strip.clientWidth);
    control.disabled = overflow < 1;
    control.value = String(overflow ? strip.scrollLeft / overflow * 1000 : 0);
  };
  const observeWorkspace = () => {
    resizeObserver?.disconnect();
    for (const selector of [".eq-response-chart", ".eq-parametric-strip"]) {
      const element = root.querySelector(selector);
      if (element) resizeObserver?.observe(element);
    }
    syncStrip();
  };
  const render = () => {
    const offset = root.querySelector<HTMLElement>(".eq-parametric-strip")?.scrollLeft ?? 0;
    const scrollContainer = root.closest<HTMLElement>(".settings-page-content");
    const verticalOffset = scrollContainer?.scrollTop ?? 0;
    const settings = getSettings();
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = renderEqControls(settings);
    root.replaceChildren(...template.content.firstElementChild!.childNodes);
    root.dataset.eqMode = settings.eq.mode;
    root.dataset.eqEngine = settings.eq.engine ?? "standard";
    dialDrag = undefined; draggedIndex = null; dragPointerId = undefined;
    const strip = root.querySelector<HTMLElement>(".eq-parametric-strip");
    if (strip) strip.scrollLeft = offset;
    if (scrollContainer) scrollContainer.scrollTop = verticalOffset;
    lastCurveSignature = "";
    redraw(true);
    observeWorkspace();
    const EventConstructor = root.ownerDocument.defaultView?.CustomEvent;
    root.dispatchEvent(EventConstructor
      ? new EventConstructor("eq-controls-rerender", { bubbles: true })
      : new CustomEvent("eq-controls-rerender", { bubbles: true }));
  };
  const update = (settings: ProcessingSettings, rerender = false, committed = true) => {
    onSettingsChange(settings, committed);
    if (rerender) render();
    else scheduleDraw();
    const error = root.querySelector<HTMLElement>("[data-eq-error]");
    if (error) { error.hidden = true; error.textContent = ""; }
  };
  const showError = (error: unknown) => {
    const node = root.querySelector<HTMLElement>("[data-eq-error]");
    if (node) { node.hidden = false; node.textContent = error instanceof Error ? error.message : trUi("均衡器设置未能更新。"); }
  };
  const onChangeMode = (select: HTMLSelectElement) => {
    const current = getSettings();
    if (select.value === current.eq.mode) return;
    try {
      const targetMode = select.value as ProcessingSettings["eq"]["mode"];
      const remembered = resolveMode?.(current, targetMode);
      const eq = remembered
        ? { ...remembered, mode: targetMode }
        : {
            ...current.eq,
            mode: targetMode,
            bands: targetMode === "graphic"
              ? resampleGraphic(current.eq.bands, Math.max(5, Math.min(32, current.eq.bands.length || 10)))
              : current.eq.bands.map((band, index) => ({
                  ...band,
                  type: band.type === 2 ? 3 as const : band.type,
                  q: band.q > 0 ? band.q : 0.707,
                  color: band.color || fallbackColors[index % fallbackColors.length],
                })),
          };
      update({ ...current, eq }, true);
    } catch (error) {
      showError(error);
      select.value = current.eq.mode;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const onBandCount = (select: HTMLSelectElement) => {
    const current = getSettings();
    const count = Number(select.value);
    if (!Number.isInteger(count) || count < 5 || count > 32 || count === current.eq.bands.length) return;
    try { update({ ...current, eq: { ...current.eq, bands: resampleGraphic(current.eq.bands, count) } }, true); }
    catch (error) {
      showError(error);
      select.value = String(current.eq.bands.length);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };
  const onAction = (button: HTMLButtonElement) => {
    const current = getSettings();
    const index = Number(button.dataset.bandIndex);
    if (button.dataset.eqAction === "add-band") {
      if (current.eq.mode === "graphic") {
        if (current.eq.bands.length >= 32) return;
        try { update({ ...current, eq: { ...current.eq, bands: resampleGraphic(current.eq.bands, current.eq.bands.length + 1) } }, true); }
        catch (error) { showError(error); }
      } else {
        if (current.eq.bands.length >= 128) return;
        update({ ...current, eq: { ...current.eq, bands: [...current.eq.bands, freshParametricBand(current.eq.bands)] } }, true);
      }
      return;
    }
    if (!Number.isInteger(index) || index < 0 || index >= current.eq.bands.length) return;
    if (button.dataset.eqAction === "remove-band") {
      if (current.eq.bands[index].locked) return;
      if (current.eq.mode === "graphic" && current.eq.bands.length <= 5) return;
      const bands = current.eq.mode === "graphic"
        ? resampleGraphic(current.eq.bands, current.eq.bands.length - 1)
        : current.eq.bands.filter((_, bandIndex) => bandIndex !== index);
      update({ ...current, eq: { ...current.eq, bands } }, true);
    } else if (button.dataset.eqAction === "lock-band") {
      const bands = current.eq.bands.map((band, bandIndex) => bandIndex === index ? { ...band, locked: !band.locked } : band);
      update({ ...current, eq: { ...current.eq, bands } }, true);
    }
  };
  const onClick = (event: Event) => {
    const engineButton = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-eq-engine-target]");
    if (engineButton && root.contains(engineButton)) {
      event.preventDefault();event.stopPropagation();
      const current = getSettings(), target = engineButton.dataset.eqEngineTarget;
      if (engineButton.disabled || current.bitPerfect || (target !== "standard" && target !== "lsp") || current.eq.engine === target) return;
      if (engineSwitchPending) return;
      engineSwitchPending = true;
      void (async () => {
        try {
          await lspEqControls?.beforeDestroy();
          const latest = getSettings();
          update({ ...latest, eq: { ...latest.eq, engine: target } }, true);
        } catch (error) { showError(error); }
        finally { engineSwitchPending = false; }
      })();
      return;
    }
    const focus = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-eq-focus-band]");
    if (focus && root.contains(focus)) {
      const index = Number(focus.dataset.eqFocusBand);
      root.dataset.eqSelectedBand = String(index);
      root.querySelector<HTMLElement>(`[data-eq-band-card="${index}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      syncStrip(); scheduleDraw(); return;
    }
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[data-eq-action]");
    if (button && root.contains(button)) {
      event.preventDefault();
      onAction(button);
    }
  };
  const onChange = (event: Event) => {
    const target = event.target as HTMLSelectElement | null;
    if (!target || !root.contains(target)) return;
    if (target.matches("[data-processing-field='eq.engine']")) {
      queueMicrotask(() => {
        if (root.isConnected && root.dataset.eqEngine !== getSettings().eq.engine) render();
      });
    } else if (target.matches("[data-processing-field='eq.mode']")) {
      event.preventDefault();
      event.stopPropagation();
      onChangeMode(target);
    } else if (target.matches("[data-eq-band-count]")) {
      event.preventDefault();
      event.stopPropagation();
      onBandCount(target);
    } else if (target.matches("[data-processing-field^='eq.bands.'][data-processing-field$='.type']")) {
      event.preventDefault();
      event.stopPropagation();
      const match = target.dataset.processingField?.match(/^eq\.bands\.(\d+)\.type$/);
      const index = Number(match?.[1]);
      const current = getSettings();
      if (Number.isInteger(index) && current.eq.bands[index]) {
        const bands = current.eq.bands.map((band, bandIndex) => bandIndex === index ? { ...band, type: Number(target.value) as EqBand["type"] } : band);
        update({ ...current, eq: { ...current.eq, bands } }, true);
      }
    }
  };
  const setDial = (index: number, field: "frequency" | "q", value: number, committed: boolean) => {
    const settings = getSettings(), band = settings.eq.bands[index];
    if (settings.eq.mode !== "parametric" || !band || band.locked) return;
    const minimum = field === "frequency" ? 10 : 0.001, maximum = field === "frequency" ? 96000 : 36;
    const bounded = round(Math.min(maximum, Math.max(minimum, value)), field === "frequency" ? 2 : 6);
    const bands = settings.eq.bands.map((entry, position) => position === index ? { ...entry, [field]: bounded } : entry);
    update({ ...settings, eq: { ...settings.eq, bands } }, false, committed);
  };
  const onPointerDown = (event: PointerEvent) => {
    const dial = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-eq-dial]");
    if (dial && root.contains(dial) && !dial.disabled && getSettings().eq.mode === "parametric") {
      const index = Number(dial.dataset.bandIndex), field = dial.dataset.eqDial as "frequency" | "q";
      const band = getSettings().eq.bands[index];
      if (!band || band.locked || event.button !== 0) return;
      dialDrag = { index, field, pointer: event.pointerId, startY: event.clientY, startValue: band[field] };
      root.dataset.eqSelectedBand = String(index);
      dial.focus({ preventScroll: true });
      dial.setPointerCapture(event.pointerId);
      event.preventDefault(); scheduleDraw(); return;
    }
    if (getSettings().eq.mode !== "graphic") return;
    const node = (event.target as Element | null)?.closest<SVGCircleElement>("[data-eq-node]");
    if (!node || !root.contains(node)) return;
    const index = Number(node.dataset.eqNode);
    const band = getSettings().eq.bands[index];
    if (!band || band.locked) return;
    draggedIndex = index;
    dragPointerId = event.pointerId;
    node.closest("svg")?.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (dialDrag && dialDrag.pointer === event.pointerId) {
      const { index, field, startY, startValue } = dialDrag;
      const minimum = field === "frequency" ? 10 : 0.001, maximum = field === "frequency" ? 96000 : 36;
      const travel = (startY - event.clientY) / 240 * (event.shiftKey ? 0.1 : 1);
      setDial(index, field, Math.max(minimum, startValue) * Math.exp(travel * Math.log(maximum / minimum)), false);
      return;
    }
    if (draggedIndex === null || dragPointerId !== event.pointerId) return;
    if (getSettings().eq.mode !== "graphic") return;
    const svg = root.querySelector<SVGSVGElement>(".eq-response-chart");
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const y = ((event.clientY - box.top) / Math.max(1, box.height)) * graph.height;
    const gain = graph.maxDb - ((y - graph.top) / (graph.bottom - graph.top)) * (graph.maxDb - graph.minDb);
    const current = getSettings();
    const index = draggedIndex;
    const bands = current.eq.bands.map((band, bandIndex) => ({ ...band }));
    const band = bands[index];
    band.gain = round(gain - current.eq.preamp, 1);
    update({ ...current, eq: { ...current.eq, bands } }, false, false);
    const card = root.querySelector<HTMLElement>(`[data-eq-band-card="${index}"]`);
    if (card) {
      const freqInput = card.querySelector<HTMLInputElement>(`[data-processing-field="eq.bands.${index}.frequency"]`);
      const gainInput = card.querySelector<HTMLInputElement>(`[data-processing-field="eq.bands.${index}.gain"]`);
      if (freqInput && document.activeElement !== freqInput) freqInput.value = String(band.frequency);
      if (gainInput && document.activeElement !== gainInput) gainInput.value = String(band.gain);
      const rangeValue = card.querySelector<HTMLButtonElement>(".editable-range-value");
      if (rangeValue) rangeValue.textContent = `${band.gain.toFixed(1)} dB`;
    }
  };
  const onPointerUp = (event: PointerEvent) => {
    if (dialDrag?.pointer === event.pointerId) {
      dialDrag = undefined;
      onSettingsChange(getSettings(), true);
      return;
    }
    if (dragPointerId !== event.pointerId) return;
    const wasDragging = draggedIndex !== null;
    draggedIndex = null;
    dragPointerId = undefined;
    if (wasDragging) onSettingsChange(getSettings(), true);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const dial = (event.target as Element | null)?.closest<HTMLButtonElement>("[data-eq-dial]");
    if (!dial || !root.contains(dial) || dial.disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const input = dial.parentElement?.querySelector<HTMLInputElement>("input[type=number]");
      input?.focus(); input?.select(); return;
    }
    const direction = ["ArrowUp", "ArrowRight", "PageUp"].includes(event.key) ? 1 : ["ArrowDown", "ArrowLeft", "PageDown"].includes(event.key) ? -1 : 0;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault(); event.stopPropagation();
    const index = Number(dial.dataset.bandIndex), field = dial.dataset.eqDial as "frequency" | "q", band = getSettings().eq.bands[index];
    if (!band) return;
    const minimum = field === "frequency" ? 10 : 0.001, maximum = field === "frequency" ? 96000 : 36;
    const step = (event.key.startsWith("Page") ? 10 : 1) * (event.shiftKey ? 0.1 : 1);
    const value = event.key === "Home" ? minimum : event.key === "End" ? maximum : Math.max(minimum, band[field]) * 2 ** (direction * step / 48);
    setDial(index, field, value, true);
  };
  const onStripInput = (event: Event) => {
    const control = event.target as HTMLInputElement;
    if (!control.matches?.("[data-eq-strip-scroll]")) return;
    const strip = root.querySelector<HTMLElement>(".eq-parametric-strip");
    if (strip) strip.scrollLeft = Math.max(0, strip.scrollWidth - strip.clientWidth) * Number(control.value) / 1000;
  };
  const onScroll = (event: Event) => { if ((event.target as Element).matches?.(".eq-parametric-strip")) syncStrip(); };
  const onFocusIn = (event: Event) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>("[data-eq-band-card]");
    if (card && root.contains(card)) { root.dataset.eqSelectedBand = card.dataset.eqBandCard; scheduleDraw(); }
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("keydown", onKeyDown);
  root.addEventListener("input", onStripInput);
  root.addEventListener("scroll", onScroll, true);
  root.addEventListener("focusin", onFocusIn);
  lspEqControls = setupLspEqControls(root, {
    getSettings,
    onSettingsChange,
    render,
  });
  resizeObserver = new ResizeObserver(() => { syncStrip(); scheduleDraw(); });
  observeWorkspace();
  redraw(true);
  return {
    sync() { scheduleDraw(); },
    saveState: () => lspEqControls?.saveState() ?? Promise.resolve(),
    beforeDestroy: () => lspEqControls?.beforeDestroy() ?? Promise.resolve(),
    render,
    destroy() {
      root.removeEventListener("click", onClick);
      root.removeEventListener("change", onChange);
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerUp);
      root.removeEventListener("keydown", onKeyDown);
      root.removeEventListener("input", onStripInput);
      root.removeEventListener("scroll", onScroll, true);
      root.removeEventListener("focusin", onFocusIn);
      resizeObserver?.disconnect();
      if (drawFrame) windowRef?.cancelAnimationFrame(drawFrame);
      return lspEqControls?.destroy() ?? Promise.resolve();
    },
  };
}
