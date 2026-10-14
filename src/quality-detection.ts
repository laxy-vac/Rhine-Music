import { trUi, ui } from "./i18n.ts";
import { presetLabels, qualityPresets, type QualityPreset, type RenderQuality } from "./render-quality.ts";
import type { CaseSettings } from "./case-settings";
import type { MusicStyle } from "./music-style";

export type QualityScenario = "shelf" | "case";

export type QualityScenarioMetrics = {
  scenario: QualityScenario;
  fps: number;
  p95FrameMs: number;
  slowFramePercent: number;
  samples: number;
};

export type QualityPresetMetrics = {
  preset: QualityPreset;
  scenarios: QualityScenarioMetrics[];
};

export type QualityDetectionResult = {
  recommendation: QualityPreset | null;
  effectiveLayout: "shelf";
  renderBackend: "three-webgl";
  measurements: QualityPresetMetrics[];
};

export type QualityDetectionOptions = {
  getStyle: () => MusicStyle;
  getTheme: () => "day" | "night";
  getCaseSettings: () => CaseSettings;
  getSize: () => { width: number; height: number };
  apply: (quality: RenderQuality) => void;
};

export const QUALITY_DETECTION_TARGET_FPS = 60;
export const QUALITY_DETECTION_MIN_SAMPLES = 60;
const QUALITY_DETECTION_STABLE_FPS = 59.5;
const QUALITY_DETECTION_MAX_P95_MS = (1000 / QUALITY_DETECTION_TARGET_FPS) * 1.5;
const QUALITY_DETECTION_MAX_SLOW_PERCENT = 5;
const PROTOCOL = "personal-music-player-quality-benchmark-v1";
const PRESET_ORDER = Object.keys(qualityPresets) as QualityPreset[];
const REQUIRED_SCENARIOS: QualityScenario[] = ["shelf", "case"];

export function isStableQualityScenario(value: QualityScenarioMetrics | undefined): boolean {
  return !!value && Number.isFinite(value.fps) && value.fps >= 0 &&
    Number.isFinite(value.p95FrameMs) && value.p95FrameMs >= 0 &&
    Number.isFinite(value.slowFramePercent) && value.slowFramePercent >= 0 && value.slowFramePercent <= 100 &&
    Number.isInteger(value.samples) && value.samples >= QUALITY_DETECTION_MIN_SAMPLES &&
    value.fps >= QUALITY_DETECTION_STABLE_FPS &&
    value.p95FrameMs <= QUALITY_DETECTION_MAX_P95_MS &&
    value.slowFramePercent <= QUALITY_DETECTION_MAX_SLOW_PERCENT;
}

export function recommendQuality(measurements: readonly QualityPresetMetrics[]): QualityPreset | null {
  if (measurements.length !== PRESET_ORDER.length) return null;
  const byPreset = new Map(measurements.map(result => [result.preset, result]));
  if (byPreset.size !== PRESET_ORDER.length || PRESET_ORDER.some(preset => !byPreset.has(preset))) return null;
  for (const result of measurements) {
    if (result.scenarios.length !== REQUIRED_SCENARIOS.length ||
        new Set(result.scenarios.map(item => item.scenario)).size !== REQUIRED_SCENARIOS.length ||
        REQUIRED_SCENARIOS.some(scenario => !result.scenarios.some(item => item.scenario === scenario))) return null;
  }
  let recommendation: QualityPreset | null = null;
  for (const preset of PRESET_ORDER) {
    const result = byPreset.get(preset);
    if (!result || REQUIRED_SCENARIOS.some(scenario =>
      !isStableQualityScenario(result.scenarios.find(item => item.scenario === scenario)))) continue;
    recommendation = preset;
  }
  return recommendation;
}

type ParentMessage = {
  type: "ready" | "progress" | "result" | "error" | "cancelled";
  token: string;
  preset?: QualityPreset;
  scenario?: QualityScenario;
  phase?: "loading" | "warmup" | "measuring";
  progress?: number;
  result?: QualityDetectionResult;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isPreset(value: unknown): value is QualityPreset {
  return typeof value === "string" && Object.hasOwn(qualityPresets, value);
}

function parseScenarioMetrics(value: unknown): value is QualityScenarioMetrics {
  if (!isRecord(value)) return false;
  return (value.scenario === "shelf" || value.scenario === "case") &&
    typeof value.fps === "number" && Number.isFinite(value.fps) &&
    typeof value.p95FrameMs === "number" && Number.isFinite(value.p95FrameMs) &&
    typeof value.slowFramePercent === "number" && Number.isFinite(value.slowFramePercent) &&
    value.fps >= 0 && value.p95FrameMs >= 0 && value.slowFramePercent >= 0 && value.slowFramePercent <= 100 &&
    typeof value.samples === "number" && Number.isFinite(value.samples) && Number.isInteger(value.samples) && value.samples >= 0;
}

function parseDetectionResult(value: unknown): QualityDetectionResult | undefined {
  if (!isRecord(value) || value.effectiveLayout !== "shelf" || value.renderBackend !== "three-webgl" ||
      !Array.isArray(value.measurements) || value.measurements.length !== PRESET_ORDER.length) return;
  const measurements: QualityPresetMetrics[] = [];
  const seenPresets = new Set<QualityPreset>();
  for (const entry of value.measurements) {
    if (!isRecord(entry) || !isPreset(entry.preset) || !Array.isArray(entry.scenarios) ||
        entry.scenarios.length !== REQUIRED_SCENARIOS.length || !entry.scenarios.every(parseScenarioMetrics) ||
        seenPresets.has(entry.preset)) return;
    const scenarios = entry.scenarios as QualityScenarioMetrics[];
    if (new Set(scenarios.map(item => item.scenario)).size !== REQUIRED_SCENARIOS.length ||
        REQUIRED_SCENARIOS.some(scenario => !scenarios.some(item => item.scenario === scenario))) return;
    seenPresets.add(entry.preset);
    measurements.push({ preset: entry.preset, scenarios });
  }
  if (PRESET_ORDER.some(preset => !seenPresets.has(preset))) return;
  return {
    recommendation: recommendQuality(measurements),
    effectiveLayout: "shelf",
    renderBackend: "three-webgl",
    measurements,
  };
}

function createToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(2, "0")).join("");
}

function cloneForMessage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readSize(options: QualityDetectionOptions): { width: number; height: number } {
  const size = options.getSize();
  const width = Math.round(size.width);
  const height = Math.round(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 640 || height < 360 || width > 8192 || height > 8192)
    throw new Error(trUi("无法读取有效的舞台尺寸，请调整播放器窗口后重试。"));
  return { width, height };
}

function makeStyles(doc: Document): HTMLStyleElement {
  const style = doc.createElement("style");
  style.textContent = `
    .quality-detection{--qd-accent:#69bfd2;border-top:1px solid color-mix(in srgb,currentColor 16%,transparent);padding:18px 0 4px;color:inherit}
    .quality-detection[data-design="archive"]{--qd-accent:#f0a548}
    .quality-detection__head{display:flex;align-items:center;justify-content:space-between;gap:20px}
    .quality-detection__head h3{margin:0;font:inherit;font-size:14px;font-weight:600;line-height:1.4;letter-spacing:.08em}
    .quality-detection__head p,.quality-detection__note{margin:6px 0 0;opacity:.68;font-size:12px;line-height:1.55}
    .quality-detection__button{border:1px solid color-mix(in srgb,var(--qd-accent) 60%,currentColor 20%);border-radius:3px;background:color-mix(in srgb,var(--qd-accent) 14%,transparent);color:inherit;padding:9px 14px;font:inherit;font-size:12px;font-weight:600;line-height:1.2;cursor:pointer}
    .quality-detection__button:hover:not(:disabled){background:color-mix(in srgb,var(--qd-accent) 24%,transparent)}
    .quality-detection__button:disabled{opacity:.48;cursor:wait}
    .quality-detection__status{min-height:1.4em;margin:12px 0 0;font-size:12px;opacity:.86}
    .quality-detection__results{margin-top:12px;overflow:auto}
    .quality-detection__results table{border-collapse:collapse;width:100%;font-size:11px;text-align:left}
    .quality-detection__results th,.quality-detection__results td{padding:7px 8px;border-bottom:1px solid color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}
    .quality-detection__results th{opacity:.62;font-weight:500}
    .quality-detection__recommendation{margin:0 0 9px;font-size:13px;font-weight:600}
    .quality-detection__apply{margin-top:10px}
    .quality-benchmark-overlay{position:fixed;inset:0;z-index:2147483000;display:block;overflow:hidden;background:rgba(4,9,16,.93);color:#f4f6f8;font:inherit;font-size:13px;line-height:1.45;backdrop-filter:blur(14px)}
    .quality-benchmark-overlay[data-design="archive"]{--qd-accent:#f0a548}
    .quality-benchmark-overlay[data-design="rhine"]{--qd-accent:#69bfd2}
    .quality-benchmark-preview{position:absolute;left:50%;top:50%;transform-origin:center center;background:#07111f;box-shadow:0 18px 72px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.16);overflow:hidden}
    .quality-benchmark-preview iframe{display:block;width:100%;height:100%;border:0;background:#07111f}
    .quality-benchmark-panel{position:absolute;left:20px;right:20px;top:16px;display:flex;align-items:center;gap:14px;max-width:900px;margin:auto;padding:12px 15px;border:1px solid rgba(255,255,255,.18);background:rgba(7,14,24,.82);box-shadow:0 4px 22px rgba(0,0,0,.26);backdrop-filter:blur(12px)}
    .quality-benchmark-panel__copy{flex:1;min-width:0}
    .quality-benchmark-panel__title{font-weight:650;letter-spacing:.04em}
    .quality-benchmark-panel__status{margin-top:3px;opacity:.78;font-size:12px}
    .quality-benchmark-panel__progress{height:2px;margin-top:8px;background:rgba(255,255,255,.16)}
    .quality-benchmark-panel__progress i{display:block;width:0;height:100%;background:var(--qd-accent);transition:width .15s linear}
    .quality-benchmark-overlay__note{position:absolute;left:16px;right:16px;bottom:15px;text-align:center;color:rgba(255,255,255,.72);font-size:11px;text-shadow:0 1px 4px #000}
    @media(max-width:700px){.quality-detection__head{align-items:flex-start;flex-direction:column}.quality-detection__button{width:100%}.quality-benchmark-panel{left:10px;right:10px;top:10px;padding:9px}.quality-benchmark-overlay__note{font-size:10px}}
  `;
  return style;
}

function scenarioLabel(scenario: QualityScenario): string {
  return scenario === "shelf" ? trUi("货架浏览") : trUi("开盒与收盒");
}

function formatMetric(value: number | undefined, suffix = ""): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}${suffix}` : "—";
}

function renderResultTable(root: HTMLElement, result: QualityDetectionResult) {
  root.replaceChildren();
  const recommendation = document.createElement("p");
  recommendation.className = "quality-detection__recommendation";
  recommendation.textContent = result.recommendation
    ? ui`建议采用 ${presetLabels[result.recommendation]}。`
    : ui`最低画质也未达到稳定 60 FPS，本次没有画质建议。`;
  root.append(recommendation);

  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of [trUi("预设"), trUi("货架 FPS"), trUi("开盒/收盒 FPS"), `P95 ${trUi("帧间隔")}`, trUi("慢帧"), trUi("有效帧")]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  for (const measurement of result.measurements) {
    const row = document.createElement("tr");
    const shelf = measurement.scenarios.find(item => item.scenario === "shelf");
    const caseScene = measurement.scenarios.find(item => item.scenario === "case");
    const values = [
      presetLabels[measurement.preset],
      formatMetric(shelf?.fps),
      formatMetric(caseScene?.fps),
      formatMetric(Math.max(shelf?.p95FrameMs ?? 0, caseScene?.p95FrameMs ?? 0), " ms"),
      formatMetric(Math.max(shelf?.slowFramePercent ?? 0, caseScene?.slowFramePercent ?? 0), "%"),
      String(Math.min(shelf?.samples ?? 0, caseScene?.samples ?? 0)),
    ];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  root.append(table);
}

export function mountQualityDetection(host: HTMLElement, options: QualityDetectionOptions): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win) return () => {};
  const style = makeStyles(doc);
  const section = doc.createElement("section");
  section.className = "quality-detection";
  section.dataset.design = options.getStyle().design;
  section.dataset.theme = options.getTheme();
  section.setAttribute("aria-label", trUi("主动性能检测"));
  section.innerHTML = ui`<div class="quality-detection__head"><div><h3>PERFORMANCE CHECK</h3><p>${trUi("使用固定合成场景检查货架移动与开盒动画，不读取曲库，也不会播放音频。")}</p></div><button type="button" class="quality-detection__button" data-quality-detection-start>${trUi("开始检测")}</button></div><p class="quality-detection__status" data-quality-detection-status aria-live="polite">${trUi("建议在播放器前台运行检测。")}</p><div class="quality-detection__results" data-quality-detection-results hidden></div><button type="button" class="quality-detection__button quality-detection__apply" data-quality-detection-apply hidden>${trUi("采用推荐画质")}</button><p class="quality-detection__note">${trUi("检测会逐帧等待 GPU 完成，结果偏保守；日常使用不会自动切换画质。")}</p>`;
  host.append(style, section);

  const startButton = section.querySelector<HTMLButtonElement>("[data-quality-detection-start]")!;
  const applyButton = section.querySelector<HTMLButtonElement>("[data-quality-detection-apply]")!;
  const status = section.querySelector<HTMLElement>("[data-quality-detection-status]")!;
  const resultsRoot = section.querySelector<HTMLElement>("[data-quality-detection-results]")!;
  let lastResult: QualityDetectionResult | undefined;
  let lastResultContext = "";
  let mounted = true;
  let cancelActiveRun: (() => void) | undefined;
  let cleanupActiveRun: (() => void) | undefined;

  const setStatus = (message: string) => { if (mounted) status.textContent = message; };
  const contextKey = () => JSON.stringify({ size: readSize(options), dpr: win.devicePixelRatio,
    style: options.getStyle(), theme: options.getTheme(), caseSettings: options.getCaseSettings() });

  const run = () => {
    if (!mounted || cancelActiveRun) return;
    resultsRoot.hidden = true;
    applyButton.hidden = true;
    lastResult = undefined;
    lastResultContext = "";

    let size: { width: number; height: number };
    let token: string;
    let page: URL;
    try {
      size = readSize(options);
      token = createToken();
      page = new URL("quality-benchmark.html", doc.baseURI);
      if (page.origin !== win.location.origin) throw new Error(trUi("检测页面必须与播放器来自同一来源。"));
    } catch (error) {
      setStatus((error as Error).message || trUi("无法启动检测。"));
      return;
    }

    startButton.disabled = true;
    setStatus(trUi("正在准备隔离检测场景…"));
    const initialDpr = win.devicePixelRatio;
    const initialTheme = options.getTheme();
    const initialContext = contextKey();
    const overlay = doc.createElement("div");
    overlay.className = "quality-benchmark-overlay";
    overlay.dataset.design = options.getStyle().design;
    overlay.dataset.theme = initialTheme;
    overlay.style.fontFamily = win.getComputedStyle(host).fontFamily;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", trUi("画质性能检测"));
    const preview = doc.createElement("div");
    preview.className = "quality-benchmark-preview";
    preview.style.width = `${size.width}px`;
    preview.style.height = `${size.height}px`;
    const iframe = doc.createElement("iframe");
    iframe.title = trUi("性能检测的合成货架预览");
    iframe.referrerPolicy = "no-referrer";
    iframe.tabIndex = -1;
    iframe.inert = true;
    iframe.style.pointerEvents = "none";
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    preview.append(iframe);
    const panel = doc.createElement("div");
    panel.className = "quality-benchmark-panel";
    const copy = doc.createElement("div");
    copy.className = "quality-benchmark-panel__copy";
    const title = doc.createElement("div");
    title.className = "quality-benchmark-panel__title";
    title.textContent = trUi("正在检查画质预设");
    const progressText = doc.createElement("div");
    progressText.className = "quality-benchmark-panel__status";
    progressText.setAttribute("aria-live", "polite");
    progressText.textContent = trUi("等待检测页面就绪…");
    const progressTrack = doc.createElement("div");
    progressTrack.className = "quality-benchmark-panel__progress";
    const progressFill = doc.createElement("i");
    progressTrack.append(progressFill);
    copy.append(title, progressText, progressTrack);
    const cancelButton = doc.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "quality-detection__button";
    cancelButton.textContent = trUi("取消检测");
    panel.append(copy, cancelButton);
    const note = doc.createElement("div");
    note.className = "quality-benchmark-overlay__note";
    note.textContent = trUi("固定合成唱片 · 无音频播放 · 不读取个人曲库");
    overlay.append(preview, panel, note);
    doc.body.append(overlay);

    preview.style.transform = "translate(-50%, -50%)";

    let finished = false;
    let started = false;
    let cancellationRequested = false;
    let timeoutId = 0;
    let fallbackCancelId = 0;
    const expectedOrigin = page.origin;
    const environmentIsUnchanged = () => {
      try { return sameSize(options.getSize(), size) && win.devicePixelRatio === initialDpr && contextKey() === initialContext; }
      catch { return false; }
    };
    const cleanupRun = () => {
      win.clearTimeout(timeoutId);
      win.clearTimeout(fallbackCancelId);
      win.clearInterval(sizeCheckId);
      win.removeEventListener("resize", onResize);
      doc.removeEventListener("visibilitychange", onVisibility);
      doc.defaultView?.visualViewport?.removeEventListener("resize", onResize);
      iframe.removeEventListener("load", onLoad);
      win.removeEventListener("message", onMessage);
      doc.removeEventListener("keydown", onOverlayKeyDown, true);
      doc.removeEventListener("focusin", onOverlayFocus, true);
      cancelButton.removeEventListener("click", cancel);
      overlay.remove();
      startButton.disabled = false;
      cancelActiveRun = undefined;
      cleanupActiveRun = undefined;
    };
    const finishWithStatus = (message: string) => {
      if (finished) return;
      finished = true;
      cleanupRun();
      setStatus(message);
      if (mounted) startButton.focus({ preventScroll: true });
    };
    const cancel = () => {
      if (finished || cancellationRequested) return;
      cancellationRequested = true;
      cancelButton.disabled = true;
      progressText.textContent = trUi("正在取消并释放检测场景…");
      try { iframe.contentWindow?.postMessage({ protocol: PROTOCOL, type: "cancel", token }, expectedOrigin); } catch {}
      fallbackCancelId = win.setTimeout(() => finishWithStatus(trUi("检测已取消，画质设置未更改。")), 1800);
    };
    const onOverlayKeyDown = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault(); cancel();
      } else if (event.key === "Tab") {
        event.preventDefault(); cancelButton.focus({ preventScroll: true });
      }
    };
    const onOverlayFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !overlay.contains(event.target))
        cancelButton.focus({ preventScroll: true });
    };
    const cleanupImmediately = () => {
      if (finished) return;
      try { iframe.contentWindow?.postMessage({ protocol: PROTOCOL, type: "cancel", token }, expectedOrigin); } catch {}
      finishWithStatus(trUi("检测已取消，画质设置未更改。"));
    };
    const fail = (message: string) => finishWithStatus(message);
    const onResize = () => {
      if (!environmentIsUnchanged())
        cancelForEnvironmentChange();
    };
    const cancelForEnvironmentChange = () => {
      if (finished) return;
      try { iframe.contentWindow?.postMessage({ protocol: PROTOCOL, type: "cancel", token }, expectedOrigin); } catch {}
      finishWithStatus(trUi("场景或显示尺寸已改变，请重新检测。"));
    };
    const onVisibility = () => {
      if (doc.hidden) {
        try { iframe.contentWindow?.postMessage({ protocol: PROTOCOL, type: "cancel", token }, expectedOrigin); } catch {}
        finishWithStatus(trUi("播放器切到后台，检测结果已作废。"));
      }
    };
    const onLoad = () => {
      if (started || finished || cancellationRequested) return;
      started = true;
      const message = {
        protocol: PROTOCOL,
        type: "init",
        token,
        width: size.width,
        height: size.height,
        style: cloneForMessage(options.getStyle()),
        theme: options.getTheme(),
        caseSettings: cloneForMessage(options.getCaseSettings()),
      };
      iframe.contentWindow?.postMessage(message, expectedOrigin);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== iframe.contentWindow || !isRecord(event.data) ||
          event.data.protocol !== PROTOCOL || event.data.token !== token || typeof event.data.type !== "string") return;
      const message = event.data as unknown as ParentMessage;
      if (cancellationRequested) {
        if (message.type === "cancelled" || message.type === "error")
          finishWithStatus(trUi("检测已取消，画质设置未更改。"));
        return;
      }
      if (message.type === "ready") {
        // A dynamic import can install the child listener after its load event.
        // Resend init on readiness; the child starts each token at most once.
        started = false;
        onLoad();
        return;
      }
      if (message.type === "progress") {
        if (!isPreset(message.preset) || (message.scenario !== "shelf" && message.scenario !== "case") ||
            !Number.isFinite(message.progress) || !message.phase) return;
        const progress = Math.max(0, Math.min(100, Number(message.progress)));
        progressFill.style.width = `${progress}%`;
        const phaseLabel = message.phase === "loading" ? trUi("初始化") : message.phase === "warmup" ? trUi("预热") : trUi("测量");
        progressText.textContent = `${presetLabels[message.preset]} · ${scenarioLabel(message.scenario)} · ${phaseLabel} ${Math.round(progress)}%`;
        return;
      }
      if (message.type === "result") {
        if (!environmentIsUnchanged()) { cancelForEnvironmentChange(); return; }
        const parsed = parseDetectionResult(message.result);
        if (!parsed) {
          fail(trUi("检测结果无效，本次没有画质建议。"));
          return;
        }
        finished = true;
        cleanupRun();
        lastResult = parsed;
        lastResultContext = initialContext;
        renderResultTable(resultsRoot, parsed);
        resultsRoot.hidden = false;
        applyButton.hidden = parsed.recommendation === null;
        setStatus(trUi("检测完成。采用建议后才会更新播放器设置。"));
        startButton.focus({ preventScroll: true });
        return;
      }
      if (message.type === "error") {
        fail(typeof message.error === "string" && message.error.length <= 240
          ? message.error : trUi("检测场景无法初始化，本次没有画质建议。"));
        return;
      }
      if (message.type === "cancelled") finishWithStatus(trUi("检测已取消，画质设置未更改。"));
    };
    const sizeCheckId = win.setInterval(() => {
      if (!environmentIsUnchanged()) cancelForEnvironmentChange();
    }, 250);
    cancelActiveRun = cancel;
    cleanupActiveRun = cleanupImmediately;
    cancelButton.addEventListener("click", cancel);
    iframe.addEventListener("load", onLoad);
    win.addEventListener("message", onMessage);
    win.addEventListener("resize", onResize);
    doc.defaultView?.visualViewport?.addEventListener("resize", onResize);
    doc.addEventListener("visibilitychange", onVisibility);
    doc.addEventListener("keydown", onOverlayKeyDown, true);
    doc.addEventListener("focusin", onOverlayFocus, true);
    cancelButton.focus({ preventScroll: true });
    timeoutId = win.setTimeout(() => fail(trUi("检测超时，画质设置未更改。")), 180_000);
    // The frame's ready message is preferred; load also covers a missed early
    // ready event while the parent installs its message handler.
    iframe.addEventListener("load", () => onLoad(), { once: true });
    const pageWithToken = new URL(page.href);
    pageWithToken.searchParams.set("run", token);
    iframe.src = pageWithToken.href;
  };

  const sameSize = (value: { width: number; height: number }, expected: { width: number; height: number }) =>
    Math.round(value.width) === expected.width && Math.round(value.height) === expected.height;

  const onStart = () => run();
  const onApply = () => {
    if (!mounted || !lastResult?.recommendation) return;
    try {
      if (contextKey() !== lastResultContext) {
        lastResult = undefined; lastResultContext = ""; applyButton.hidden = true; resultsRoot.hidden = true;
        setStatus(trUi("场景或显示尺寸已改变，请重新检测。"));
        return;
      }
      options.apply({ ...qualityPresets[lastResult.recommendation] });
      setStatus(ui`已采用 ${presetLabels[lastResult.recommendation]}。`);
    } catch (error) {
      setStatus((error as Error).message || trUi("无法应用推荐画质。"));
    }
  };
  startButton.addEventListener("click", onStart);
  applyButton.addEventListener("click", onApply);

  return () => {
    if (!mounted) return;
    cleanupActiveRun?.();
    mounted = false;
    cancelActiveRun?.();
    startButton.removeEventListener("click", onStart);
    applyButton.removeEventListener("click", onApply);
    section.remove();
    style.remove();
  };
}
