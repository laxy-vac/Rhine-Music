import { ArchiveScene } from "./scene";
import { setMusicAlbums } from "./data";
import { configureMusicCatalog, focusMusicEntry, getMusicEntry } from "./music-catalog";
import { normalizeMusicStyle, type MusicStyle } from "./music-style";
import { normalizeCaseSettings, type CaseSettings } from "./case-settings";
import { qualityPresets, type QualityPreset } from "./render-quality";
import { recommendQuality, QUALITY_DETECTION_MIN_SAMPLES, type QualityDetectionResult, type QualityPresetMetrics, type QualityScenario, type QualityScenarioMetrics } from "./quality-detection";
import type { MusicAlbum, MusicGenre, MusicTrack } from "./music-types";

const PROTOCOL = "personal-music-player-quality-benchmark-v1";
const token = new URLSearchParams(location.search).get("run") ?? "";
const allPresets = Object.keys(qualityPresets) as QualityPreset[];
const scenarioDurationMs = 1_500;
const scenarioMaxDurationMs = 5_000;
const targetFrameMs = 1000 / 60;
const slowFrameMs = targetFrameMs * 1.5;
const stage = document.querySelector<HTMLElement>("#benchmark-scene")!;

type InitMessage = {
  protocol: string;
  type: "init";
  token: string;
  width: number;
  height: number;
  style: MusicStyle;
  theme: "day" | "night";
  caseSettings: CaseSettings;
};

type BenchmarkInit = Omit<InitMessage, "protocol" | "type" | "token">;

let init: BenchmarkInit | undefined;
let scene: ArchiveScene | undefined;
let cancelled = false;
let started = false;
let finished = false;
let parentConnected = false;
let nativeDpr = 1;
let lastProgress = -1;

function send(message: Record<string, unknown>) {
  if (!token || !parentConnected) return;
  parent.postMessage({ protocol: PROTOCOL, token, ...message }, location.origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isInitMessage(value: unknown): value is InitMessage {
  if (!isRecord(value)) return false;
  return value.protocol === PROTOCOL && value.type === "init" && value.token === token &&
    Number.isInteger(value.width) && Number.isInteger(value.height) &&
    Number(value.width) >= 640 && Number(value.width) <= 8192 &&
    Number(value.height) >= 360 && Number(value.height) <= 8192 &&
    isRecord(value.style) && (value.style.design === "rhine" || value.style.design === "archive") &&
    (value.theme === "day" || value.theme === "night") && isRecord(value.caseSettings);
}

function progress(preset: QualityPreset, scenario: QualityScenario, phase: "loading" | "warmup" | "measuring", percent: number) {
  const safePercent = Math.max(0, Math.min(100, percent));
  if (Math.abs(safePercent - lastProgress) < 1 && phase === "measuring") return;
  lastProgress = safePercent;
  send({ type: "progress", preset, scenario, phase, progress: safePercent });
}

function makeSyntheticLibrary() {
  const genres: MusicGenre[] = Array.from({ length: 6 }, (_, index) => ({
    id: `benchmark-genre-${index + 1}`,
    name: `Fixture Group ${String(index + 1).padStart(2, "0")}`,
  }));
  const albums: MusicAlbum[] = Array.from({ length: 80 }, (_, index) => {
    const genre = genres[index % genres.length];
    const albumId = `quality-fixture-album-${String(index + 1).padStart(3, "0")}`;
    const tracks: MusicTrack[] = Array.from({ length: 2 }, (_, trackIndex) => ({
      id: `${albumId}-track-${trackIndex + 1}`,
      albumId,
      title: `Fixture Track ${trackIndex + 1}`,
      artist: `Fixture Artist ${index % 12 + 1}`,
      trackNumber: trackIndex + 1,
      discNumber: 1,
      duration: 180 + trackIndex * 20,
      format: "PCM",
      browserPlayable: false,
      audioUrl: "",
      relativePath: "",
    }));
    return {
      id: albumId,
      title: `Synthetic Album ${String(index + 1).padStart(3, "0")}`,
      artist: `Fixture Artist ${index % 12 + 1}`,
      year: 1980 + index % 42,
      genreId: genre.id,
      rawGenres: [genre.name],
      folder: `synthetic-fixture/${albumId}`,
      tracks,
      producers: [],
      offline: true,
    };
  });
  if (albums.length !== 80 || albums.some(album => !album.offline || album.coverUrl || album.tracks.length !== 2 ||
      album.tracks.some(track => track.browserPlayable || track.audioUrl)))
    throw new Error("合成曲库未通过离线数据检查。");
  return { albums, genres };
}

function assertCurrentEnvironment() {
  if (cancelled) throw new Error("__CANCELLED__");
  if (document.hidden) throw new Error("__HIDDEN__");
  if (!init || Math.round(innerWidth) !== init.width || Math.round(innerHeight) !== init.height || devicePixelRatio !== nativeDpr)
    throw new Error("__RESIZED__");
  if (!scene || scene.musicDisplayLayout.effective !== "shelf")
    throw new Error("检测场景没有生成有效的 Three.js 货架，未提供画质建议。");
  if (stage.dataset.renderBackend !== "three-webgl")
    throw new Error("检测场景没有使用 Three.js WebGL 渲染，未提供画质建议。");
  const rect = stage.getBoundingClientRect();
  if (stage.clientWidth !== init.width || stage.clientHeight !== init.height ||
      scene.renderer.domElement.clientWidth !== init.width || scene.renderer.domElement.clientHeight !== init.height ||
      Math.abs(rect.width - init.width) > 0.5 || Math.abs(rect.height - init.height) > 0.5)
    throw new Error("检测画布尺寸与播放器舞台不一致，未提供画质建议。");
}

function metrics(scenario: QualityScenario, intervals: number[]): QualityScenarioMetrics {
  const sorted = [...intervals].sort((a, b) => a - b);
  const total = intervals.reduce((sum, value) => sum + value, 0);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : 0;
  return {
    scenario,
    fps: total > 0 ? intervals.length * 1000 / total : 0,
    p95FrameMs: p95,
    slowFramePercent: intervals.length ? intervals.filter(value => value > slowFrameMs).length * 100 / intervals.length : 100,
    samples: intervals.length,
  };
}

function measureFrames(
  scenario: QualityScenario,
  presetIndex: number,
  segmentIndex: number,
  onFrame?: (elapsedMs: number) => void,
): Promise<number[]> {
  const intervals: number[] = [];
  const progressBase = ((presetIndex * 3 + segmentIndex) / (allPresets.length * 3)) * 100;
  const progressSpan = 100 / (allPresets.length * 3);
  let firstCompletion: number | undefined;
  let previousCompletion: number | undefined;
  let frameCount = 0;
  let rafId = 0;

  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      if (rafId) cancelAnimationFrame(rafId);
      if (error) reject(error);
      else resolve(intervals);
    };
    const tick = (frameTime: number) => {
      try {
        assertCurrentEnvironment();
        onFrame?.(frameTime - (firstCompletion ?? frameTime));
        scene!.update(frameTime / 1000);
        const gl = scene!.renderer.getContext();
        if (gl.isContextLost()) throw new Error("WebGL 设备已中断，未提供画质建议。");
        gl.finish();
        const completed = performance.now();
        if (firstCompletion === undefined) firstCompletion = completed;
        if (previousCompletion !== undefined) intervals.push(completed - previousCompletion);
        previousCompletion = completed;
        frameCount++;
        if (frameCount % 12 === 0) {
          const elapsed = completed - firstCompletion;
          const fraction = Math.min(0.95, elapsed / scenarioDurationMs, intervals.length / QUALITY_DETECTION_MIN_SAMPLES);
          progress(allPresets[presetIndex], scenario, "measuring", progressBase + progressSpan * fraction);
        }
        const elapsed = completed - firstCompletion;
        if (elapsed >= scenarioDurationMs &&
            (intervals.length >= QUALITY_DETECTION_MIN_SAMPLES || elapsed >= scenarioMaxDurationMs)) {
          progress(allPresets[presetIndex], scenario, "measuring", progressBase + progressSpan);
          finish();
        } else rafId = requestAnimationFrame(tick);
      } catch (error) {
        finish(error as Error);
      }
    };
    rafId = requestAnimationFrame(tick);
  });
}

async function settleFrames(count: number) {
  let remaining = count;
  await new Promise<void>((resolve, reject) => {
    const tick = (time: number) => {
      try {
        assertCurrentEnvironment();
        scene!.update(time / 1000);
        const gl = scene!.renderer.getContext();
        if (gl.isContextLost()) throw new Error("WebGL 设备已中断。");
        gl.finish();
        remaining--;
        if (remaining <= 0) resolve();
        else requestAnimationFrame(tick);
      } catch (error) { reject(error); }
    };
    requestAnimationFrame(tick);
  });
}

async function runBenchmark(settings: BenchmarkInit): Promise<QualityDetectionResult> {
  init = settings;
  nativeDpr = devicePixelRatio;
  stage.style.width = `${settings.width}px`;
  stage.style.height = `${settings.height}px`;
  stage.dataset.design = settings.style.design;
  stage.dataset.page = "music";
  stage.dataset.layout = "desktop";
  const style = normalizeMusicStyle(settings.style);
  const caseSettings = normalizeCaseSettings(settings.caseSettings, style.design);
  const { albums, genres } = makeSyntheticLibrary();
  setMusicAlbums(albums, genres, "genre");
  configureMusicCatalog({ layout: "shelf", show: "albums", group: "genre", sort: "artist" }, "");
  focusMusicEntry(albums[0].id);

  progress("performance", "shelf", "loading", 0);
  scene = new ArchiveScene(stage);
  await scene.load();
  if (cancelled) throw new Error("__CANCELLED__");
  scene.enableSelectionLighting();
  scene.setTheme(settings.theme);
  scene.setMusicStyle(style);
  await scene.setCaseSettings(caseSettings);
  scene.setReduced(false);

  const measurements: QualityPresetMetrics[] = [];
  for (let presetIndex = 0; presetIndex < allPresets.length; presetIndex++) {
    const preset = allPresets[presetIndex];
    const quality = qualityPresets[preset];
    progress(preset, "shelf", "warmup", (presetIndex / allPresets.length) * 100);
    scene.setQuality(quality);
    await scene.setCaseSettings(caseSettings);
    await scene.warmup();
    scene.showMusicArchiveImmediately(performance.now() / 1000);
    scene.update(performance.now() / 1000);
    const gl = scene.renderer.getContext();
    if (gl.isContextLost()) throw new Error("WebGL 设备已中断，未提供画质建议。");
    gl.finish();
    assertCurrentEnvironment();
    await settleFrames(12);

    let shelfStep = -1;
    const shelfIntervals = await measureFrames("shelf", presetIndex, 0, elapsedMs => {
      const step = Math.floor(elapsedMs / 180);
      if (step === shelfStep) return;
      shelfStep = step;
      const entry = getMusicEntry(step % albums.length);
      if (!entry) return;
      focusMusicEntry(entry.key);
      scene!.select(entry.recordIndex, { axis: "row", direction: step % 2 ? 1 : -1 });
    });

    const anchor = getMusicEntry(0);
    if (!anchor) throw new Error("合成货架没有固定开盒目标。");
    focusMusicEntry(anchor.key);
    scene.select(anchor.recordIndex);
    scene.showMusicArchiveImmediately(performance.now() / 1000);
    await settleFrames(8);
    scene.setMode("detail");
    const openingIntervals = await measureFrames("case", presetIndex, 1);
    scene.setMode("archive");
    const closingIntervals = await measureFrames("case", presetIndex, 2);
    const caseIntervals = [...openingIntervals, ...closingIntervals];
    const scenarios = [metrics("shelf", shelfIntervals), metrics("case", caseIntervals)];
    measurements.push({ preset, scenarios });
    scene.setMode("archive");
    await settleFrames(8);
  }

  return {
    recommendation: recommendQuality(measurements),
    effectiveLayout: "shelf",
    renderBackend: "three-webgl",
    measurements,
  };
}

function releaseScene() {
  if (!scene) return;
  try {
    scene.renderer.forceContextLoss();
    scene.renderer.dispose();
  } catch {}
  scene = undefined;
  stage.replaceChildren();
}

function finishCancelled() {
  if (finished) return;
  finished = true;
  releaseScene();
  send({ type: "cancelled" });
}

function finishError(error: unknown) {
  if (finished) return;
  if (cancelled || (error instanceof Error && error.message === "__CANCELLED__")) {
    finishCancelled();
    return;
  }
  finished = true;
  releaseScene();
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = message === "__HIDDEN__" ? "检测页面切到后台，结果已作废。"
    : message === "__RESIZED__" ? "窗口尺寸或显示比例已改变，结果已作废。"
      : message.slice(0, 240) || "检测失败，未提供画质建议。";
  send({ type: "error", error: safeMessage });
}

async function start(settings: BenchmarkInit) {
  if (started || finished) return;
  started = true;
  parentConnected = true;
  try {
    const result = await runBenchmark(settings);
    if (cancelled) finishCancelled();
    else {
      finished = true;
      releaseScene();
      send({ type: "result", result });
    }
  } catch (error) {
    finishError(error);
  }
}

function onParentMessage(event: MessageEvent) {
  if (!token || event.origin !== location.origin || event.source !== parent || !isRecord(event.data) ||
      event.data.protocol !== PROTOCOL || event.data.token !== token || typeof event.data.type !== "string") return;
  parentConnected = true;
  if (event.data.type === "cancel") {
    cancelled = true;
    if (!started) finishCancelled();
    return;
  }
  if (event.data.type !== "init" || started) return;
  if (!isInitMessage(event.data)) {
    finishError(new Error("检测配置无效，未提供画质建议。"));
    return;
  }
  void start({
    width: Number(event.data.width),
    height: Number(event.data.height),
    style: event.data.style,
    theme: event.data.theme,
    caseSettings: event.data.caseSettings,
  });
}

if (token && /^[0-9a-f]{48}$/i.test(token)) {
  window.addEventListener("message", onParentMessage);
  parent.postMessage({ protocol: PROTOCOL, type: "ready", token }, location.origin);
} else {
  document.body.textContent = "该页面仅用于播放器发起的隔离性能检测。";
}
