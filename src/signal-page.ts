import { trUi, ui } from "./i18n";
// Ring artwork and centreline adapted from Audio Archive 1.4.0.
// Copyright (c) 2026 the Audio Archive authors, MIT; see assets/signal/LICENSE.txt.
import dayRing from "./assets/signal/ring-day.png";
import nightRing from "./assets/signal/ring-night.png";
import ringMeta from "./assets/signal/ring.json";
import { createSignalRingPaths } from "./signal-ring-path";
import type { MusicPlayerState } from "./music-player";
import type { MusicAlbum } from "./music-types";
import { setSpectrumDemand } from "./native-audio";
import type { SpectrumSnapshot } from "./native-audio";

type Mode = "3d" | "2d" | "classic" | "spectrum";
type Spectrum = SpectrumSnapshot;
type SpectrumPlot = {
  bins: number;
  binHz: number;
  sampleRate: number;
  width: number;
  height: number;
  dpr: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotWidth: number;
  plotHeight: number;
  maximum: number;
  binX: Float32Array;
  bucketStart: Int32Array;
  bucketEnd: Int32Array;
  fromDb: Float32Array;
  targetDb: Float32Array;
  drawDb: Float32Array;
  fromX: Float32Array;
  targetX: Float32Array;
  drawX: Float32Array;
  bucketCount: number;
  initialized: boolean;
  transitionStart: number;
  transitionDuration: number;
  lastFrameAt: number;
  lastUpdatedAt?: number;
};
const TAU = Math.PI * 2;
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const time = (n: number) =>
  `${String(Math.floor(Math.max(0, n) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, n) % 60)).padStart(2, "0")}`;
const hz = (n: number) =>
  n >= 1000 ? `${+(n / 1000).toFixed(2)} kHz` : `${+n.toFixed(1)} Hz`;
const modeNames: Record<Mode, string> = {
  "3d": "3D",
  "2d": "2D",
  classic: "CLASSIC",
  spectrum: "SPECTRUM",
};

// Arc-length sampled tangent circles, shared with the reference theme's emblem.
const infinityPoints = (() => {
  const c = 1.42,
    th = Math.asin(1 / c),
    t = Math.sqrt(c * c - 1),
    ct = Math.cos(th),
    st = Math.sin(th),
    sweep = Math.PI + 2 * th;
  const pieces = [
    [0, 0, 0, t * ct, t * st],
    [1, c, 0, Math.PI / 2 + th, -sweep],
    [0, t * ct, -t * st, 0, 0],
    [0, 0, 0, -t * ct, t * st],
    [1, -c, 0, Math.PI / 2 - th, sweep],
    [0, -t * ct, -t * st, 0, 0],
  ];
  const lengths = pieces.map((p) => (p[0] ? Math.abs(p[4]) : t)),
    total = lengths.reduce((a, b) => a + b, 0);
  return Array.from({ length: 1440 }, (_, i) => {
    let s = (i / 1440) * total,
      k = 0;
    while (s > lengths[k] && k < 5) s -= lengths[k++];
    const p = pieces[k],
      f = s / lengths[k];
    return p[0]
      ? [p[1] + Math.cos(p[3] + p[4] * f), -(p[2] + Math.sin(p[3] + p[4] * f))]
      : [p[1] + (p[3] - p[1]) * f, -(p[2] + (p[4] - p[2]) * f)];
  });
})();

export function setupSignalPage(
  host: HTMLElement,
  callbacks: {
    spectrum: () => Spectrum | undefined;
    seek: (n: number) => void;
    reduced: () => boolean;
  },
) {
  const root = document.createElement("div");
  root.className = "signal-workspace";
  const musicApp = host.closest<HTMLElement>(".music-app");
  root.innerHTML = ui`<div class="signal-toolbar"><div class="signal-ident"><span class="signal-square"></span><span>信号监视 · 04</span><b class="signal-status">待机</b></div><div class="signal-models" role="group" aria-label="信号显示模式">${(Object.keys(modeNames) as Mode[]).map((m) => `<button type="button" data-signal-mode="${m}" aria-label="${m === "spectrum" ? trUi("真实折线频谱") : modeNames[m]}" aria-pressed="false"><i></i>${modeNames[m]}</button>`).join("")}</div></div>
    <div class="signal-viewport"><div class="signal-classic-ground" aria-hidden="true"></div><canvas class="signal-canvas" role="img" aria-label="音乐信号可视化"></canvas><div class="signal-classic-caption"><small>当前播放</small><div><h2></h2><span class="signal-large-time"></span></div><p></p></div><div class="signal-spectrum-caption"><span class="signal-resolution"></span><output class="signal-probe"></output></div></div>
    <div class="signal-trace"><div class="signal-trace-heading"><span>播放轨迹 · 本次采样</span><span class="signal-trace-time">00:00 / 00:00</span></div><canvas class="signal-trace-canvas" aria-hidden="true"></canvas><input type="range" min="0" max="1000" value="0" step="1" aria-label="播放位置"><div class="signal-footer"><span class="signal-data-state">等待播放</span><span class="signal-meter"></span></div></div>`;

  const signalLabel = root.querySelector<HTMLElement>(".signal-ident > span:nth-of-type(2)")!;
  host.append(root);
  const get = <T extends HTMLElement>(selector: string) =>
    root.querySelector<T>(selector)!;
  const viewport = get<HTMLDivElement>(".signal-viewport"),
    canvas = get<HTMLCanvasElement>(".signal-canvas"),
    trace = get<HTMLCanvasElement>(".signal-trace-canvas");
  const ctx = canvas.getContext("2d")!,
    tc = trace.getContext("2d")!;
  const seek = get<HTMLInputElement>(".signal-trace input"),
    status = get(".signal-status"),
    dataState = get(".signal-data-state"),
    meter = get(".signal-meter"),
    resolution = get(".signal-resolution"),
    probe = get<HTMLOutputElement>(".signal-probe");
  const modeButtons = [
      ...root.querySelectorAll<HTMLButtonElement>("[data-signal-mode]"),
    ],
    classicGround = get<HTMLElement>(".signal-classic-ground"),
    trackTitle = get<HTMLHeadingElement>(".signal-classic-caption h2"),
    trackArtist = get<HTMLParagraphElement>(".signal-classic-caption p"),
    largeTime = get<HTMLElement>(".signal-large-time"),
    traceTime = get<HTMLElement>(".signal-trace-time");
  const spectrumLayer = document.createElement("canvas"),
    spectrumLayerCtx = spectrumLayer.getContext("2d")!;
  const ringLayer = document.createElement("canvas"),
    ringLayerCtx = ringLayer.getContext("2d")!;
  const traceLayer = document.createElement("canvas"),
    traceLayerCtx = traceLayer.getContext("2d")!;
  const ringPaths = createSignalRingPaths(infinityPoints);
  const drawBands = new Float32Array(32);
  let ringLayerKey = "", traceLayerKey = "", historyRevision = 0, drawEnergy = 0;
  let traceDirty = true, traceTimeValue = -1, traceDurationValue = -1, lastBandDraw = 0;
  const cover = new Image(),
    rings = [new Image(), new Image()];
  rings[0].src = dayRing;
  rings[1].src = nightRing;
  let mode: Mode = "3d",
    modelMode: Exclude<Mode, "spectrum"> = "3d",
    state: MusicPlayerState | undefined,
    visible = false,
    disposed = false,
    frame = 0,
    width = 0,
    height = 0,
    lastDraw = 0,
    lastRead = 0,
    lastStamp = 0,
    lastTrack = "",
    animationTime = 0,
    lastTick = 0,
    pixelRatio = 1,
    lastPaletteRead = -Infinity,
    paletteTransitionUntil = 0,
    spectrumGridMaximum = 0,
    spectrumTargetStamp = -1,
    dirty = true,
    pointerX: number | undefined;
  let spectrumPlot: SpectrumPlot | undefined,
    spectrumGridDirty = true;
  let snapshot: Spectrum | undefined,
    ink = "#30352d",
    muted = "#777b72",
    line = "#bfc0b6",
    accent = "#d27430",
    bg = "#e8e5e1",
    theme = "";
  const history = new Map<number, number>(); // Only observed audio, never invented full-track peaks.
  const setText = (element: HTMLElement, value: string) => {
    if (element.textContent !== value) element.textContent = value;
  };
  function scheduleFrame() {
    if (visible && !document.hidden && !disposed && !frame)
      frame = requestAnimationFrame(tick);
  }
  function invalidate() {
    dirty = true;
    scheduleFrame();
  }
  try {
    const saved = localStorage.getItem("rhine-signal-mode");
    if (saved && saved in modeNames) {
      mode = saved as Mode;
      if (saved !== "spectrum") modelMode = saved as Exclude<Mode, "spectrum">;
    }
  } catch {}

  function syncDesign() {
    const archive = musicApp?.dataset.design === "archive";
    root.dataset.design = archive ? "archive" : "rhine";
    signalLabel.textContent = "SIGNAL MONITOR · 04";
  }

  function setMode(next: Mode) {
    mode = next;
    if (next !== "spectrum") modelMode = next;
    root.dataset.signalMode = next;
    modeButtons.forEach((b) => {
      const pressed = String(b.dataset.signalMode === next);
      if (b.getAttribute("aria-pressed") !== pressed)
        b.setAttribute("aria-pressed", pressed);
    });
    canvas.setAttribute("aria-label", ui`${modeNames[next]} · 音乐信号`);
    try {
      localStorage.setItem("rhine-signal-mode", next);
    } catch {}
    pointerX = undefined;
    setText(probe, "");
    if (next === "spectrum") {
      spectrumTargetStamp = -1;
      lastRead = 0;
    }
    invalidate();
  }
  function cycleModel() {
    const models: Exclude<Mode, "spectrum">[] = ["3d", "2d", "classic"];
    const index = models.indexOf(modelMode);
    setMode(models[(index + 1) % models.length]);
  }
  function palette(now: number) {
    const next = musicApp?.dataset.theme ?? "day";
    if (next !== theme) {
      theme = next;
      paletteTransitionUntil = now + 700;
      lastPaletteRead = -Infinity;
    }
    if (
      lastPaletteRead === -Infinity ||
      (now <= paletteTransitionUntil && now - lastPaletteRead >= 100)
    ) {
      // Theme colours may transition; sample them at 10 Hz during that short change.
      const s = getComputedStyle(root),
        nextInk = s.getPropertyValue("--ink").trim() || ink,
        nextMuted = s.getPropertyValue("--muted").trim() || muted,
        nextLine = s.getPropertyValue("--line").trim() || line,
        nextAccent = s.getPropertyValue("--accent").trim() || accent,
        nextBg = s.getPropertyValue("--page-bg").trim() || bg;
      if (
        nextInk !== ink ||
        nextMuted !== muted ||
        nextLine !== line ||
        nextAccent !== accent ||
        nextBg !== bg
      )
        { spectrumGridDirty = true; traceDirty = true; }
      ink = nextInk;
      muted = nextMuted;
      line = nextLine;
      accent = nextAccent;
      bg = nextBg;
      lastPaletteRead = now;
    }
  }
  function resize() {
    const r = {width:viewport.clientWidth,height:viewport.clientHeight},
      dpr = Math.min(2, devicePixelRatio || 1);
    const mainChanged = width !== r.width || height !== r.height || pixelRatio !== dpr;
    if (mainChanged) {
      width = r.width; height = r.height; pixelRatio = dpr;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ringLayerKey = "";
      spectrumPlot = undefined;
      spectrumTargetStamp = -1;
      spectrumGridDirty = true;
    }
    const tr = trace.getBoundingClientRect();
    const tw = Math.max(1, Math.round(tr.width * dpr)), th = Math.max(1, Math.round(tr.height * dpr));
    if (trace.width !== tw || trace.height !== th || mainChanged) {
      trace.width = tw; trace.height = th;
      tc.setTransform(dpr, 0, 0, dpr, 0, 0);
      traceLayerKey = ""; traceDirty = true;
    }
    invalidate();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  observer.observe(trace);
  syncDesign();
  const themeObserver = musicApp
    ? new MutationObserver(() => {
        syncDesign();
        paletteTransitionUntil = performance.now() + 700;
        lastPaletteRead = -Infinity;
        spectrumGridDirty = true;
        invalidate();
      })
    : undefined;
  themeObserver?.observe(musicApp!, {
    attributes: true,
    attributeFilter: ["data-theme", "data-design", "data-scheme"],
  });
  const imageReady = () => {
    ringLayerKey = "";
    invalidate();
  };
  cover.onload = imageReady;
  rings.forEach((img) => (img.onload = imageReady));
  function strokePath(points: number[][], colour: string, lw: number) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++)
      ctx.lineTo(points[i][0], points[i][1]);
    ctx.strokeStyle = colour;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  function text(
    t: string,
    x: number,
    y: number,
    colour = muted,
    align: CanvasTextAlign = "left",
    size = 10,
  ) {
    ctx.font = `${size}px ${musicApp?.dataset.design === "archive" ? '"Archive Mono",' : ""} ui-monospace, Consolas, monospace`;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  }
  function cornerFrame(x: number, y: number, w: number, h: number, target = ctx) {
    target.strokeStyle = line;
    target.lineWidth = 1;
    for (const [px, py, sx, sy] of [
      [x, y, 1, 1],
      [x + w, y, -1, 1],
      [x, y + h, 1, -1],
      [x + w, y + h, -1, -1],
    ]) {
      target.beginPath();
      target.moveTo(px + sx * 18, py);
      target.lineTo(px, py);
      target.lineTo(px, py + sy * 18);
      target.stroke();
    }
  }
  function sampleBand(i: number) {
    return snapshot?.available
      ? drawBands[i % drawBands.length]
      : 0;
  }
  function smoothBands(now: number) {
    const blend = callbacks.reduced() || !lastBandDraw ? 1 : 1 - Math.exp(-Math.min(100, now - lastBandDraw) / 55);
    let energy = 0;
    if (snapshot?.available) for (const band of snapshot.bands) energy += clamp(band || 0);
    energy /= Math.max(1, snapshot?.bands.length ?? 0);
    drawEnergy = snapshot?.available ? drawEnergy + (energy - drawEnergy) * blend : 0;
    for (let i = 0; i < drawBands.length; i++) {
      const target = snapshot?.available ? clamp(snapshot.bands[i % snapshot.bands.length] || 0) : 0;
      drawBands[i] = snapshot?.available ? drawBands[i] + (target - drawBands[i]) * blend : 0;
    }
    lastBandDraw = now;
  }
  function drawBars(cx: number, y: number, w: number) {
    ctx.fillStyle = line;
    ctx.fillRect(cx - w / 2, y, w, 1);
    for (let i = 0; i < 32; i++) {
      const v = sampleBand(i),
        x = cx - w / 2 + (i * w) / 32,
        h = v * Math.min(22, height * 0.07);
      ctx.fillStyle = i < 3 ? accent : ink;
      ctx.globalAlpha = 0.25 + 0.6 * v;
      ctx.fillRect(x, y - h, (w / 32) * 0.55, h);
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, y + 2, (w / 32) * 0.55, h * 0.4);
    }
    ctx.globalAlpha = 1;
  }
  function drawRing() {
    const cx = width / 2,
      cy = height * 0.44,
      w = Math.min(width * 0.64, height * (musicApp?.dataset.design === "archive" ? 1.2 : 1.68), 900),
      h = w * 0.5;
    const layerKey = `${mode}/${width}/${height}/${pixelRatio}/${theme}/${line}/${musicApp?.dataset.design}`;
    if (ringLayerKey !== layerKey) {
      ringLayer.width = canvas.width; ringLayer.height = canvas.height;
      ringLayerCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      cornerFrame(cx - w * 0.6, cy - h * 0.65, w * 1.2, h * 1.45, ringLayerCtx);
      if (mode === "3d") {
        const scale = w / (ringMeta.bounds[2] - ringMeta.bounds[0]);
        const img = rings[theme === "night" ? 1 : 0];
        if (img.complete && img.naturalWidth) ringLayerCtx.drawImage(img, cx - ringMeta.center[0] * scale, cy - ringMeta.center[1] * scale, ringMeta.resolution[0] * scale, ringMeta.resolution[1] * scale);
      }
      ringLayerKey = layerKey;
    }
    ctx.drawImage(ringLayer, 0, 0, width, height);
    if (mode === "3d") {
      const [bw0, , bw1] = ringMeta.bounds,
        s = w / (bw1 - bw0),
        ox = cx - ringMeta.center[0] * s,
        oy = cy - ringMeta.center[1] * s;
      if (snapshot?.available) {
        const energy =
            drawEnergy,
          fiber = ringMeta.fiber;
        for (let p = 0; p < 3; p++) {
          ctx.shadowColor = accent;
          ctx.shadowBlur = 12;
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(1, s * 2.8);
          ctx.globalAlpha = clamp(energy * 1.7);
          ctx.beginPath();
          let pen = false;
          for (let j = 0; j < 48; j++) {
            const index = Math.floor(
                ((((animationTime * 0.055 + p / 3 - j / fiber.length) % 1) +
                  1) %
                  1) *
                  fiber.length,
              ),
              q = fiber[index];
            if (!q[3]) {
              pen = false;
              continue;
            }
            const x = ox + q[0] * s,
              y = oy + q[1] * s;
            if (!pen) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            pen = true;
          }
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    } else {
      const s = w / 5.44,
        gap = (animationTime * 0.22) % TAU,
        sw = 0.6 * s;
      const gapLength = ringPaths.length * 0.42 / TAU;
      const dash = ringPaths.length - gapLength;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s);
      ctx.setLineDash([dash, gapLength]);
      function stroke(path: Path2D, start: number, colour: string, lw: number) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = lw / s;
        ctx.lineJoin = "round";
        ctx.lineDashOffset = dash - gap / TAU * ringPaths.length + start;
        ctx.stroke(path);
      }
      stroke(ringPaths.full, 0, ink, sw);
      stroke(ringPaths.full, 0, bg, 1.2);
      stroke(ringPaths.bridgeWide, ringPaths.bridgeWideStart, bg, sw + 10);
      stroke(ringPaths.bridge, ringPaths.bridgeStart, ink, sw);
      stroke(ringPaths.bridge, ringPaths.bridgeStart, bg, 1.2);
      ctx.restore();
      for (const u of [gap, gap + 0.42]) {
        const p = infinityPoints[Math.floor(((u % TAU) / TAU) * 1440)];
        ctx.fillStyle = accent;
        ctx.fillRect(cx + p[0] * s - 4, cy + p[1] * s - 4, 8, 8);
      }
    }
    drawBars(cx, height * 0.86, w * 0.65);
  }
  function drawClassic() {
    const plotHeight = Math.max(90, height - 110);
    const cx = width / 2,
      cy = plotHeight / 2,
      size = Math.max(
        32,
        Math.min((plotHeight / 2 - 38) / 0.83, width * 0.24, 250),
      ),
      r = size * 0.83;
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    strokePath(
      [
        [20, cy],
        [cx - r - 45, cy],
      ],
      line,
      1,
    );
    strokePath(
      [
        [cx + r + 45, cy],
        [width - 20, cy],
      ],
      line,
      1,
    );
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.arc(cx, cy, r + 13, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    const progress = state?.duration
      ? clamp(state.currentTime / state.duration)
      : 0;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + progress * TAU);
    ctx.stroke();
    if (cover.complete && cover.naturalWidth) {
      const side = Math.min(cover.naturalWidth, cover.naturalHeight);
      ctx.drawImage(
        cover,
        (cover.naturalWidth - side) / 2,
        (cover.naturalHeight - side) / 2,
        side,
        side,
        cx - size / 2,
        cy - size / 2,
        size,
        size,
      );
    } else {
      ctx.strokeStyle = line;
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      text(trUi("暂无封面"), cx, cy, muted, "center");
    }
    cornerFrame(cx - size / 2 - 12, cy - size / 2 - 12, size + 24, size + 24);
    ctx.fillStyle = accent;
    ctx.fillRect(cx + size / 2 - 35, cy - size / 2 - 5, 26, 4);
    for (let i = 0; i < 72; i++) {
      const a = -Math.PI / 2 + ((i + 0.5) / 72) * TAU,
        v = sampleBand(Math.floor(Math.abs((((i / 72) * 2 + 1) % 2) - 1) * 31));
      const n = Math.ceil(v * 5);
      ctx.strokeStyle = i < 4 ? accent : ink;
      ctx.lineWidth = 2;
      for (let k = 0; k < Math.max(1, n); k++) {
        ctx.globalAlpha = n ? 0.35 + 0.5 * v : 0.12;
        const ra = r + 19 + k * 5;
        strokePath(
          [
            [cx + Math.cos(a) * ra, cy + Math.sin(a) * ra],
            [cx + Math.cos(a) * (ra + 3), cy + Math.sin(a) * (ra + 3)],
          ],
          ctx.strokeStyle as string,
          2,
        );
      }
    }
    ctx.globalAlpha = 1;
    for (let q = 0; q < 4; q++) {
      const a = -Math.PI / 2 + (q / 4) * TAU;
      text(
        state?.duration ? time((state.duration * q) / 4) : "--:--",
        cx + Math.cos(a) * (r + 58),
        cy + Math.sin(a) * (r + 43),
        muted,
        "center",
      );
    }
    if (width > 700) {
      const next = state?.queue[(state?.currentIndex ?? -1) + 1];
      text(trUi("下一首"), width - 30, cy + 35, muted, "right");
      ctx.save();
      ctx.beginPath();
      ctx.rect(width * 0.75, cy + 42, width * 0.25 - 24, 32);
      ctx.clip();
      text(
        next?.title ?? trUi("播放列表末尾"),
        width - 30,
        cy + 60,
        ink,
        "right",
      );
      ctx.restore();
      text(state?.currentTrack?.format ?? "—", 24, cy - 45);
      text(
        state?.currentTrack?.sampleRate
          ? hz(state.currentTrack.sampleRate)
          : "—",
        24,
        cy - 25,
      );
    }
  }
  function ensureSpectrumPlot(
    value: Spectrum | undefined,
  ): SpectrumPlot | undefined {
    const bins = value?.available ? value.binsDb : undefined,
      step = value?.binHz ?? 0,
      maximum = Math.min(20000, (value?.sampleRate ?? 40000) / 2);
    if (
      !bins?.length ||
      step <= 0 ||
      maximum <= 20 ||
      width <= 0 ||
      height <= 0
    )
      return undefined;
    const existing = spectrumPlot;
    if (
      existing &&
      existing.bins === bins.length &&
      existing.binHz === step &&
      existing.sampleRate === (value?.sampleRate ?? 0) &&
      existing.width === width &&
      existing.height === height &&
      existing.dpr === pixelRatio
    )
      return existing;

    const left = 48,
      right = width - 24,
      top = 28,
      bottom = height - 58,
      plotWidth = Math.max(1, right - left),
      plotHeight = Math.max(1, bottom - top),
      binX = new Float32Array(bins.length),
      bucketCapacity = Math.min(
        bins.length,
        Math.max(1, Math.ceil(plotWidth * pixelRatio) + 1),
      ),
      bucketStart = new Int32Array(bucketCapacity),
      bucketEnd = new Int32Array(bucketCapacity),
      fromDb = new Float32Array(bucketCapacity),
      targetDb = new Float32Array(bucketCapacity),
      drawDb = new Float32Array(bucketCapacity),
      fromX = new Float32Array(bucketCapacity),
      targetX = new Float32Array(bucketCapacity),
      drawX = new Float32Array(bucketCapacity),
      logRange = Math.log(maximum / 20),
      logScale = plotWidth / logRange;
    let bucketCount = 0,
      previousColumn = -1;
    for (
      let i = Math.max(1, Math.ceil(20 / step));
      i < bins.length && i * step <= maximum;
      i++
    ) {
      const xx = left + Math.log((i * step) / 20) * logScale,
        column = Math.floor((xx - left) * pixelRatio);
      binX[i] = xx;
      if (column !== previousColumn) {
        if (bucketCount) bucketEnd[bucketCount - 1] = i;
        bucketStart[bucketCount] = i;
        bucketEnd[bucketCount] = i + 1;
        bucketCount++;
        previousColumn = column;
      } else bucketEnd[bucketCount - 1] = i + 1;
    }
    if (!bucketCount) return undefined;
    spectrumPlot = {
      bins: bins.length,
      binHz: step,
      sampleRate: value!.sampleRate ?? 0,
      width,
      height,
      dpr: pixelRatio,
      left,
      right,
      top,
      bottom,
      plotWidth,
      plotHeight,
      maximum,
      binX,
      bucketStart,
      bucketEnd,
      fromDb,
      targetDb,
      drawDb,
      fromX,
      targetX,
      drawX,
      bucketCount,
      initialized: false,
      transitionStart: 0,
      transitionDuration: 0,
      lastFrameAt: 0,
    };
    spectrumGridDirty = true;
    spectrumTargetStamp = -1;
    setText(
      resolution,
      ui`FFT ${value?.fftSize?.toLocaleString()} 点 · ${step.toFixed(2)} Hz / 点 · ${value?.stage ?? trUi("音乐采样")}`,
    );
    return spectrumPlot;
  }
  function updateSpectrumTarget(value: Spectrum, now: number, smooth: boolean) {
    const bins = value.binsDb,
      plot = ensureSpectrumPlot(value);
    if (!bins || !plot) return;
    setText(
      resolution,
      ui`FFT ${value.fftSize?.toLocaleString()} 点 · ${plot.binHz.toFixed(2)} Hz / 点 · ${value.stage ?? trUi("音乐采样")}`,
    );
    if (plot.initialized && plot.lastUpdatedAt === value.updatedAt) return;
    if (plot.initialized) advanceSpectrum(plot, now);
    for (let bucket = 0; bucket < plot.bucketCount; bucket++) {
      let peakBin = plot.bucketStart[bucket],
        peakDb = -240;
      for (let i = peakBin; i < plot.bucketEnd[bucket]; i++) {
        if (bins[i] > peakDb) {
          peakDb = bins[i];
          peakBin = i;
        }
      }
      plot.targetDb[bucket] = peakDb;
      plot.targetX[bucket] = plot.binX[peakBin];
    }
    if (!plot.initialized) {
      plot.fromDb.set(plot.targetDb.subarray(0, plot.bucketCount));
      plot.drawDb.set(plot.targetDb.subarray(0, plot.bucketCount));
      plot.fromX.set(plot.targetX.subarray(0, plot.bucketCount));
      plot.drawX.set(plot.targetX.subarray(0, plot.bucketCount));
      plot.initialized = true;
      plot.transitionDuration = 0;
    } else if (smooth) {
      // Ease only between received FFT frames; the hover readout stays on the raw native bin.
      plot.fromDb.set(plot.drawDb.subarray(0, plot.bucketCount));
      plot.fromX.set(plot.drawX.subarray(0, plot.bucketCount));
      plot.transitionStart = now;
      plot.transitionDuration = Math.max(
        60,
        Math.min(220, (now - (plot.lastFrameAt || now - 250)) * 0.9),
      );
    } else {
      plot.fromDb.set(plot.targetDb.subarray(0, plot.bucketCount));
      plot.drawDb.set(plot.targetDb.subarray(0, plot.bucketCount));
      plot.fromX.set(plot.targetX.subarray(0, plot.bucketCount));
      plot.drawX.set(plot.targetX.subarray(0, plot.bucketCount));
      plot.transitionDuration = 0;
    }
    plot.lastFrameAt = now;
    plot.lastUpdatedAt = value.updatedAt;
  }
  function advanceSpectrum(plot: SpectrumPlot, now: number): boolean {
    if (!plot.initialized || plot.transitionDuration <= 0) return false;
    const progress = clamp(
        (now - plot.transitionStart) / plot.transitionDuration,
      ),
      eased = progress * progress * (3 - 2 * progress);
    for (let i = 0; i < plot.bucketCount; i++) {
      plot.drawDb[i] =
        plot.fromDb[i] + (plot.targetDb[i] - plot.fromDb[i]) * eased;
      plot.drawX[i] = plot.fromX[i] + (plot.targetX[i] - plot.fromX[i]) * eased;
    }
    if (progress >= 1) {
      plot.transitionDuration = 0;
      return false;
    }
    return true;
  }
  function rebuildSpectrumGrid(maximum: number) {
    const canvasWidth = Math.max(1, Math.round(width * pixelRatio)),
      canvasHeight = Math.max(1, Math.round(height * pixelRatio));
    if (spectrumLayer.width !== canvasWidth) spectrumLayer.width = canvasWidth;
    if (spectrumLayer.height !== canvasHeight)
      spectrumLayer.height = canvasHeight;
    spectrumLayerCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    spectrumLayerCtx.clearRect(0, 0, width, height);
    const left = 48,
      right = width - 24,
      top = 28,
      bottom = height - 58,
      plotWidth = Math.max(1, right - left),
      plotHeight = Math.max(1, bottom - top),
      y = (db: number) => top + clamp(-db / 120) * plotHeight,
      x = (frequency: number) =>
        left + (Math.log(frequency / 20) / Math.log(maximum / 20)) * plotWidth;
    spectrumLayerCtx.strokeStyle = line;
    spectrumLayerCtx.lineWidth = 1;
    spectrumLayerCtx.beginPath();
    for (const db of [0, -24, -48, -72, -96, -120]) {
      const yy = y(db);
      spectrumLayerCtx.moveTo(left, yy);
      spectrumLayerCtx.lineTo(right, yy);
    }
    for (const frequency of [
      20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
    ]) {
      if (frequency > maximum) continue;
      const xx = x(frequency);
      spectrumLayerCtx.moveTo(xx, top);
      spectrumLayerCtx.lineTo(xx, bottom);
    }
    spectrumLayerCtx.stroke();
    spectrumLayerCtx.font = `10px ${musicApp?.dataset.design === "archive" ? '"Archive Mono",' : ""} ui-monospace, Consolas, monospace`;
    spectrumLayerCtx.fillStyle = muted;
    spectrumLayerCtx.textAlign = "right";
    for (const db of [0, -24, -48, -72, -96, -120])
      spectrumLayerCtx.fillText(`${db}`, left - 10, y(db) + 3);
    spectrumLayerCtx.textAlign = "center";
    for (const frequency of [
      20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
    ]) {
      if (frequency > maximum) continue;
      spectrumLayerCtx.fillText(
        frequency >= 1000 ? `${frequency / 1000}k` : `${frequency}`,
        x(frequency),
        bottom + 19,
      );
    }
    spectrumLayerCtx.textAlign = "left";
    spectrumLayerCtx.fillText("dBFS", left, 14);
    spectrumLayerCtx.textAlign = "right";
    spectrumLayerCtx.fillText("Hz", right, bottom + 36);
    spectrumGridMaximum = maximum;
    spectrumGridDirty = false;
  }
  function drawSpectrum(now: number) {
    const bins = snapshot?.available ? snapshot.binsDb : undefined,
      plot = ensureSpectrumPlot(snapshot),
      maximum =
        plot?.maximum ?? Math.min(20000, (snapshot?.sampleRate ?? 40000) / 2);
    if (maximum > 20 && spectrumGridMaximum !== maximum)
      spectrumGridDirty = true;
    if (spectrumGridDirty) rebuildSpectrumGrid(maximum > 20 ? maximum : 20000);
    ctx.drawImage(spectrumLayer, 0, 0, width, height);
    if (bins?.length && plot) {
      advanceSpectrum(plot, now);
      ctx.beginPath();
      for (let bucket = 0; bucket < plot.bucketCount; bucket++) {
        const px = plot.drawX[bucket],
          py = plot.top + clamp(-plot.drawDb[bucket] / 120) * plot.plotHeight;
        if (bucket === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (
        pointerX !== undefined &&
        pointerX >= plot.left &&
        pointerX <= plot.right
      ) {
        const frequency =
            20 *
            Math.exp(
              ((pointerX - plot.left) / plot.plotWidth) *
                Math.log(plot.maximum / 20),
            ),
          index = Math.round(frequency / plot.binHz);
        if (index > 0 && index < bins.length) {
          const xx =
              plot.binX[index] ||
              plot.left +
                Math.log((index * plot.binHz) / 20) *
                  (plot.plotWidth / Math.log(plot.maximum / 20)),
            yy = plot.top + clamp(-bins[index] / 120) * plot.plotHeight;
          ctx.beginPath();
          ctx.moveTo(xx, plot.top);
          ctx.lineTo(xx, plot.bottom);
          ctx.strokeStyle = muted;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = accent;
          ctx.fillRect(xx - 3, yy - 3, 6, 6);
          setText(
            probe,
            `${hz(index * plot.binHz)} · ${bins[index].toFixed(1)} dBFS`,
          );
        } else setText(probe, "");
      } else setText(probe, "");
    } else {
      setText(resolution, snapshot?.reason ?? trUi("等待音乐采样"));
      setText(probe, "");
    }
  }
  function drawTrace() {
    const w = trace.width / pixelRatio,
      h = trace.height / pixelRatio;
    const duration = state?.duration ?? 0,
      progress = duration ? clamp((state?.currentTime ?? 0) / duration) : 0;
    const key = `${trace.width}/${trace.height}/${pixelRatio}/${historyRevision}/${Math.floor(progress * 1024)}/${duration}/${ink}/${muted}/${line}`;
    if (key !== traceLayerKey) {
      traceLayer.width = trace.width; traceLayer.height = trace.height;
      traceLayerCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      traceLayerCtx.strokeStyle = line;
      traceLayerCtx.setLineDash([2, 3]);
      traceLayerCtx.beginPath(); traceLayerCtx.moveTo(0, h / 2); traceLayerCtx.lineTo(w, h / 2); traceLayerCtx.stroke(); traceLayerCtx.setLineDash([]);
      if (duration > 0) for (const [slot, v] of history) {
        traceLayerCtx.fillStyle = slot / 1024 <= progress ? ink : muted;
        const bar = Math.max(1, v * (h - 8));
        traceLayerCtx.fillRect(
          (slot / 1024) * w,
          h / 2 - bar / 2,
          Math.max(1, w / 1024),
          bar,
        );
      }
      traceLayerKey = key;
    }
    tc.clearRect(0, 0, w, h);
    tc.drawImage(traceLayer, 0, 0, w, h);
    tc.fillStyle = accent;
    if (duration > 0) {
      tc.fillRect(w * progress, 0, 1, h);
      tc.fillRect(w * progress - 3, 0, 6, 4);
    }
  }
  function paint(now: number) {
    if (!visible || !width || !height || disposed) return;
    palette(now);
    smoothBands(now);
    ctx.clearRect(0, 0, width, height);
    if (mode === "classic") drawClassic();
    else if (mode === "spectrum") drawSpectrum(now);
    else drawRing();
    if (traceDirty) { drawTrace(); traceDirty = false; }
    const available = snapshot?.available,
      transport = state?.transport,
      statusText =
        transport === "playing"
          ? trUi("播放中")
          : transport === "paused"
            ? trUi("已暂停")
            : transport === "loading"
              ? trUi("缓冲中")
              : transport === "error"
                ? trUi("播放错误")
                : trUi("待机"),
      live = String(transport === "playing"),
      meterText =
        available &&
        Number.isFinite(snapshot?.peakDb) &&
        Number.isFinite(snapshot?.rmsDb)
          ? ui`峰值 ${snapshot!.peakDb!.toFixed(1)} · RMS ${snapshot!.rmsDb!.toFixed(1)} dBFS`
          : "";
    setText(status, statusText);
    if (status.dataset.live !== live) status.dataset.live = live;
    setText(
      dataState,
      available
        ? `${snapshot?.stage ?? trUi("音乐采样")} · ${hz(snapshot?.sampleRate ?? 0)}`
        : (snapshot?.reason ?? trUi("等待播放")),
    );
    setText(meter, meterText);
  }
  function tick(ms: number) {
    frame = 0;
    if (!visible || disposed || document.hidden) return;
    if (ms - lastRead >= ((mode === "2d" || mode === "3d") ? 33 : 100)) {
      const previous = snapshot,
        latest = callbacks.spectrum(),
        changed =
          latest?.available !== previous?.available ||
          latest?.updatedAt !== previous?.updatedAt ||
          latest?.sampleRate !== previous?.sampleRate ||
          latest?.binHz !== previous?.binHz ||
          latest?.fftSize !== previous?.fftSize ||
          latest?.binsDb?.length !== previous?.binsDb?.length ||
          latest?.reason !== previous?.reason ||
          latest?.stage !== previous?.stage;
      lastRead = ms;
      if (changed) {
        snapshot = latest;
        dirty = true;
        if (!latest?.available) spectrumTargetStamp = -1;
        else if (
          latest.sampleRate !== previous?.sampleRate ||
          latest.binHz !== previous?.binHz ||
          latest.fftSize !== previous?.fftSize ||
          latest.binsDb?.length !== previous?.binsDb?.length
        )
          spectrumTargetStamp = -1;
      }
      if (latest?.available && latest.updatedAt !== lastStamp) {
        const peak = latest.peakDb;
        if (Number.isFinite(peak) && state?.duration) {
          const slot = Math.floor(clamp(state.currentTime / state.duration) * 1023), value = clamp(10 ** (peak! / 20));
          if (history.get(slot) !== value) { history.set(slot, value); historyRevision++; traceDirty = true; }
        }
        lastStamp = latest.updatedAt ?? 0;
        dirty = true;
      }
    }
    const reduced = callbacks.reduced();
    if (
      mode === "spectrum" &&
      snapshot?.available &&
      spectrumTargetStamp !== (snapshot.updatedAt ?? 0)
    ) {
      updateSpectrumTarget(snapshot, ms, !reduced);
      spectrumTargetStamp = snapshot.updatedAt ?? 0;
      dirty = true;
    }
    if (reduced && mode === "spectrum" && spectrumPlot?.transitionDuration) {
      spectrumPlot.drawDb.set(
        spectrumPlot.targetDb.subarray(0, spectrumPlot.bucketCount),
      );
      spectrumPlot.drawX.set(
        spectrumPlot.targetX.subarray(0, spectrumPlot.bucketCount),
      );
      spectrumPlot.transitionDuration = 0;
      dirty = true;
    }
    const animateRing =
      !reduced &&
      state?.playing &&
      snapshot?.available &&
      (mode === "3d" || mode === "2d");
    if (animateRing) {
      animationTime += Math.min(0.1, (ms - (lastTick || ms)) / 1000);
      dirty = true;
    }
    lastTick = ms;
    const smoothSpectrum =
      !reduced &&
      mode === "spectrum" &&
      !!spectrumPlot?.transitionDuration &&
      ms < spectrumPlot.transitionStart + spectrumPlot.transitionDuration;
    if (smoothSpectrum) dirty = true;
    const themeTransition = ms < paletteTransitionUntil;
    if (themeTransition) dirty = true;
    const drawInterval = reduced ? 100 : mode === "classic" ? 33 : 1000 / 60;
    if (dirty && ms - lastDraw >= drawInterval - 0.5) {
      paint(ms);
      lastDraw = ms - Math.max(0, (ms - lastDraw) % drawInterval);
      dirty = false;
    }
    if (
      state?.playing ||
      animateRing ||
      smoothSpectrum ||
      themeTransition ||
      dirty
    )
      scheduleFrame();
  }
  function start() {
    scheduleFrame();
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTick = 0;
  }
  function visibility() {
    if (document.hidden) {
      setSpectrumDemand("signal", false);
      stop();
    } else {
      setSpectrumDemand("signal", visible);
      start();
    }
  }
  document.addEventListener("visibilitychange", visibility);
  modeButtons.forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.signalMode as Mode)),
  );
  const archiveKeydown = (event: KeyboardEvent) => {
    if (!visible || musicApp?.dataset.design !== "archive" || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.key.toLowerCase() !== "r") return;
    event.preventDefault();
    event.stopPropagation();
    cycleModel();
  };
  window.addEventListener("keydown", archiveKeydown, true);
  seek.addEventListener("change", () => {
    if (state?.duration)
      callbacks.seek((Number(seek.value) / 1000) * state.duration);
  });
  canvas.addEventListener("pointermove", (e) => {
    pointerX = e.offsetX;
    if (mode === "spectrum") invalidate();
  });
  canvas.addEventListener("pointerleave", () => {
    pointerX = undefined;
    if (mode === "spectrum") {
      setText(probe, "");
      invalidate();
    }
  });
  setMode(mode);
  return {
    update(next: MusicPlayerState, album?: MusicAlbum) {
      state = next;
      if (next.currentTime !== traceTimeValue || next.duration !== traceDurationValue) {
        traceTimeValue = next.currentTime; traceDurationValue = next.duration; traceDirty = true;
      }
      if (next.currentTrack?.id !== lastTrack) {
        lastTrack = next.currentTrack?.id ?? "";
        history.clear();
        historyRevision++; traceDirty = true; traceLayerKey = "";
        drawBands.fill(0); drawEnergy = 0; lastBandDraw = 0;
        snapshot = undefined;
        spectrumPlot = undefined;
        spectrumTargetStamp = -1;
        lastStamp = 0;
        animationTime = 0;
        lastRead = 0;
      }
      const src = album?.coverUrl ?? "";
      if (src !== cover.getAttribute("src")) {
        if (src) cover.src = src;
        else cover.removeAttribute("src");
        classicGround.style.backgroundImage = src
          ? `url(${JSON.stringify(src)})`
          : "none";
      }
      setText(trackTitle, next.currentTrack?.title ?? trUi("暂无信号"));
      setText(trackArtist, next.currentTrack?.artist ?? trUi("等待播放"));
      setText(largeTime, time(next.currentTime));
      const currentTimeText = `${time(next.currentTime)} / ${time(next.duration)}`;
      setText(traceTime, currentTimeText);
      const disabled = !next.duration;
      if (seek.disabled !== disabled) seek.disabled = disabled;
      const seekValue = String(
        next.duration
          ? Math.round(clamp(next.currentTime / next.duration) * 1000)
          : 0,
      );
      if (seek.value !== seekValue) seek.value = seekValue;
      if (seek.getAttribute("aria-valuetext") !== currentTimeText)
        seek.setAttribute("aria-valuetext", currentTimeText);
      invalidate();
    },
    setVisible(next: boolean) {
      visible = next;
      setSpectrumDemand("signal", next && !document.hidden);
      if (next) {
        resize();
        start();
      } else stop();
    },
    destroy() {
      disposed = true;
      setSpectrumDemand("signal", false);
      stop();
      observer.disconnect();
      themeObserver?.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", archiveKeydown, true);
      cover.onload = null;
      rings.forEach((img) => (img.onload = null));
      root.remove();
    },
  };
}
