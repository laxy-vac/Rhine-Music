import { trUi } from "./i18n";

type FilmPoint = readonly [number, number, number];
type FilmTrack = {
  front?: FilmPoint;
  nose?: FilmPoint;
  case?: FilmPoint;
};
type FilmManifest = {
  fps: number;
  frames: number;
  res: readonly [number, number];
  land: number;
  track: readonly FilmTrack[];
};

const SKINS = ["aurora", "blue", "coral", "frost", "glass", "hazard", "marble", "red", "tide", "white"] as const;
const DEFAULT_SKIN = "glass";
const DEFAULT_FILM: FilmManifest = { fps: 24, frames: 144, res: [1600, 900], land: 94, track: [] };
const FRAME_URLS = import.meta.glob<string>("./assets/style/intro/*/frame-*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
});
const MANIFEST_URLS = import.meta.glob<string>("./assets/style/intro/*/intro.json", {
  eager: true,
  query: "?url",
  import: "default",
});

const activeIntros = new WeakMap<HTMLElement, () => void>();
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const easeOut = (value: number) => {
  const x = clamp(value);
  return 1 - (1 - x) ** 3;
};
const pad = (value: number, width: number) => String(value).padStart(width, "0");
const noop = () => {};

function framePath(skin: string, index: number) {
  return `./assets/style/intro/${skin}/frame-${pad(index + 1, 3)}.jpg`;
}

function validSkin(skin: string) {
  return (SKINS as readonly string[]).includes(skin) ? skin : DEFAULT_SKIN;
}

function parseManifest(value: unknown): FilmManifest {
  if (!value || typeof value !== "object") return DEFAULT_FILM;
  const raw = value as Partial<FilmManifest>;
  const fps = Number.isFinite(raw.fps) ? clamp(raw.fps!, 1, 120) : DEFAULT_FILM.fps;
  const frames = Number.isInteger(raw.frames) ? clamp(raw.frames!, 1, 144) : DEFAULT_FILM.frames;
  const width = Array.isArray(raw.res) && Number.isFinite(raw.res[0]) ? clamp(raw.res[0], 1, 8192) : DEFAULT_FILM.res[0];
  const height = Array.isArray(raw.res) && Number.isFinite(raw.res[1]) ? clamp(raw.res[1], 1, 8192) : DEFAULT_FILM.res[1];
  const track = Array.isArray(raw.track) ? raw.track as FilmTrack[] : [];
  return {
    fps,
    frames,
    res: [width, height],
    land: Number.isFinite(raw.land) ? clamp(raw.land!, 0, frames) : DEFAULT_FILM.land,
    track,
  };
}

function contrastOn(accent: string) {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(accent.trim())?.[1];
  if (!hex) return "#08121f";
  const value = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  const [red, green, blue] = [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const linear = (channel: number) => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  const luminance = .2126 * linear(red) + .7152 * linear(green) + .0722 * linear(blue);
  return luminance > .46 ? "#08121f" : "#ffffff";
}

function drawCorners(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, length: number, color: string, thickness = 1) {
  ctx.fillStyle = color;
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const) {
    ctx.fillRect(sx > 0 ? x : x - length, sy > 0 ? y : y - thickness, length, thickness);
    ctx.fillRect(sx > 0 ? x : x - thickness, sy > 0 ? y : y - length, thickness, length);
  }
}

function drawCallout(
  ctx: CanvasRenderingContext2D,
  point: FilmPoint | undefined,
  title: string,
  subtitle: string,
  alpha: number,
  side: -1 | 1,
  fontFamily: string,
  accent: string,
  foreground: string,
  background: string,
) {
  if (!point || point[2] <= 0 || alpha <= 0) return;
  const [x, y] = point;
  const amount = easeOut(alpha);
  const length = 58 * amount;
  const run = 36 * amount;
  const x1 = x + side * length;
  const y1 = y - length;
  const x2 = x1 + side * run;
  ctx.save();
  ctx.globalAlpha = amount;
  ctx.fillStyle = accent;
  ctx.fillRect(x - 5, y - 5, 10, 10);
  drawCorners(ctx, x - 10, y - 10, x + 10, y + 10, 7, foreground, 1);
  ctx.strokeStyle = foreground;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y1);
  ctx.stroke();
  if (alpha >= 1) {
    ctx.font = `700 13px ${fontFamily}`;
    const plateWidth = Math.ceil(ctx.measureText(title).width) + 24;
    const plateX = side > 0 ? x2 : x2 - plateWidth;
    const plateY = y1 - 15;
    ctx.fillStyle = foreground;
    ctx.fillRect(plateX, plateY, plateWidth, 30);
    ctx.fillStyle = background;
    ctx.textBaseline = "middle";
    ctx.fillText(title, plateX + 12, plateY + 15);
    ctx.font = `500 10px ${fontFamily}`;
    const subtitleWidth = Math.ceil(ctx.measureText(subtitle).width) + 16;
    const subtitleX = side > 0 ? plateX : plateX + plateWidth - subtitleWidth;
    ctx.fillStyle = `${background}dd`;
    ctx.fillRect(subtitleX, plateY + 30, subtitleWidth, 22);
    ctx.fillStyle = foreground;
    ctx.fillText(subtitle, subtitleX + 8, plateY + 41);
  }
  ctx.restore();
}

function drawCuePanel(ctx: CanvasRenderingContext2D, width: number, top: number, height: number, time: number, duration: number, fontFamily: string, accent: string, foreground: string, muted: string, background: string, chapters: readonly string[]) {
  const cues = [
    { start: 0, end: .28 },
    { start: .28, end: .49 },
    { start: .49, end: .67 },
    { start: .67, end: .82 },
    { start: .82, end: 1 },
  ];
  const panelWidth = Math.min(360, width * .36);
  const rowHeight = 28;
  const panelHeight = 84 + cues.length * rowHeight;
  const x = Math.max(40, width - 40 - panelWidth);
  const y = Math.max(top + 24, Math.min(height - top - panelHeight - 24, (height - panelHeight) / 2));
  const current = clamp(time / Math.max(duration, 1));
  const currentCue = cues.findIndex((cue) => current >= cue.start && current < cue.end);
  ctx.save();
  ctx.fillStyle = `${background}d9`;
  ctx.fillRect(x, y, panelWidth, panelHeight);
  drawCorners(ctx, x, y, x + panelWidth, y + panelHeight, 14, `${foreground}77`, 1);
  ctx.fillStyle = muted;
  ctx.font = `600 9px ${fontFamily}`;
  ctx.fillText(trUi("DEPLOYMENT CUES"), x + 16, y + 22);
  ctx.font = `500 8px ${fontFamily}`;
  ctx.fillText(trUi("VISUAL CUT  ·  PLAYHEAD"), x + 16, y + 39);
  ctx.fillStyle = foreground;
  ctx.font = `300 35px ${fontFamily}`;
  ctx.fillText(pad(currentCue < 0 ? cues.length : currentCue + 1, 2), x + panelWidth - 58, y + 39);
  let rowY = y + 65;
  cues.forEach((cue, index) => {
    const active = index === currentCue;
    const past = current >= cue.end;
    ctx.fillStyle = active ? accent : muted;
    ctx.font = `500 8px ${fontFamily}`;
    ctx.fillText(`CUE-${pad(index + 1, 2)}`, x + 16, rowY + 5);
    ctx.fillStyle = active || past ? foreground : muted;
    ctx.font = `500 9px ${fontFamily}`;
    ctx.fillText(chapters[index], x + 72, rowY + 5);
    const barX = x + 72;
    const barY = rowY + 14;
    const barWidth = Math.max(32, panelWidth - 150);
    ctx.fillStyle = `${foreground}26`;
    ctx.fillRect(barX, barY, barWidth, 3);
    const progress = clamp((current - cue.start) / (cue.end - cue.start));
    if (progress > 0) {
      ctx.fillStyle = past ? foreground : accent;
      ctx.fillRect(barX, barY, barWidth * progress, 3);
    }
    rowY += rowHeight;
  });
  ctx.restore();
}

/** Plays the original Audio Archive film as a local visual intro. It does not inspect audio hardware or DSP state. */
export function playFoobarIntro(stage: HTMLElement, skin: string, accent: string, reduced: boolean): () => void {
  activeIntros.get(stage)?.();
  const document = stage.ownerDocument;
  const view = document.defaultView;
  if (!view || !stage.isConnected) return noop;

  const initialSkin = validSkin(skin);
  const assetSkin = FRAME_URLS[framePath(initialSkin, 0)] && MANIFEST_URLS[`./assets/style/intro/${initialSkin}/intro.json`]
    ? initialSkin
    : DEFAULT_SKIN;
  const manifestUrl = MANIFEST_URLS[`./assets/style/intro/${assetSkin}/intro.json`];
  const accentColor = accent.trim() || "#b56834";
  const onAccent = contrastOn(accentColor);
  const dark = "#08121f";
  const ink = "#e9eef2";
  const softInk = "#bdcad7";
  const muted = "#9caabd";
  const fontFamily = view.getComputedStyle(stage).getPropertyValue("--design-mono").trim() || "ui-monospace, Consolas, monospace";
  const previousPosition = stage.style.position;
  if (view.getComputedStyle(stage).position === "static") stage.style.position = "relative";

  const canvas = document.createElement("canvas");
  canvas.className = "foobar-intro-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", trUi("Audio Archive 原版视觉序列。任意按键或点击可跳过。"));
  canvas.tabIndex = -1;
  Object.assign(canvas.style, {
    position: "absolute",
    inset: "0",
    zIndex: "2147483000",
    display: "block",
    width: "100%",
    height: "100%",
    background: dark,
    cursor: "pointer",
    pointerEvents: "auto",
  });
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) {
    if (stage.style.position === "relative" && previousPosition !== "relative") stage.style.position = previousPosition;
    return noop;
  }
  stage.append(canvas);

  let stopped = false;
  let animation = 0;
  let started = false;
  let startTime = 0;
  const requestedAt = view.performance.now();
  let width = 1;
  let height = 1;
  let scale = 1;
  let manifest = DEFAULT_FILM;
  let frames: Array<HTMLImageElement | null | undefined> = [];
  let pending = 0;
  let playhead = 0;
  let releasedBefore = 0;
  let lastImage: HTMLImageElement | undefined;
  const inFlight = new Map<number, HTMLImageElement>();
  const requestAbort = new AbortController();
  const previousFocus = document.activeElement as HTMLElement | null;

  const syncSize = () => {
    const rect = stage.getBoundingClientRect();
    width = Math.max(1, stage.clientWidth || rect.width);
    height = Math.max(1, stage.clientHeight || rect.height);
    scale = Math.min(2, Math.max(1, view.devicePixelRatio || 1));
    const pixelWidth = Math.max(1, Math.round(width * scale));
    const pixelHeight = Math.max(1, Math.round(height * scale));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
  };
  syncSize();

  const releaseImage = (image: HTMLImageElement) => {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute("src");
  };
  const releaseBefore = (index: number) => {
    const keepFrom = Math.max(0, index - 1);
    while (releasedBefore < keepFrom) {
      const image = frames[releasedBefore];
      if (image && image !== lastImage) releaseImage(image);
      frames[releasedBefore] = null;
      releasedBefore += 1;
    }
  };
  const loadFrame = (index: number) => {
    if (stopped || pending >= 6 || frames[index] !== undefined) return;
    const url = FRAME_URLS[framePath(assetSkin, index)];
    if (!url) {
      frames[index] = null;
      return;
    }
    frames[index] = null;
    pending += 1;
    const image = new view.Image();
    image.decoding = "async";
    inFlight.set(index, image);
    let settled = false;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      pending = Math.max(0, pending - 1);
      inFlight.delete(index);
      if (stopped) {
        releaseImage(image);
        return;
      }
      if (loaded && index >= Math.max(0, playhead - 1)) frames[index] = image;
      else {
        frames[index] = null;
        releaseImage(image);
      }
    };
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    image.src = url;
    if (typeof image.decode === "function") {
      void image.decode().then(() => finish(true), () => {
        if (image.complete) finish(image.naturalWidth > 0);
      });
    }
  };
  const requestAhead = (index: number) => {
    playhead = index;
    releaseBefore(index);
    const end = Math.min(manifest.frames, index + 14);
    for (let next = index; next < end && pending < 6; next += 1) loadFrame(next);
  };

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    requestAbort.abort();
    if (animation) view.cancelAnimationFrame(animation);
    resizeObserver?.disconnect();
    view.removeEventListener("resize", syncSize);
    view.removeEventListener("keydown", onKeyDown, true);
    canvas.removeEventListener("click", onClick);
    for (const image of inFlight.values()) releaseImage(image);
    inFlight.clear();
    for (const image of frames) if (image) releaseImage(image);
    frames = [];
    lastImage = undefined;
    canvas.remove();
    if (stage.style.position === "relative" && previousPosition !== "relative") stage.style.position = previousPosition;
    if (activeIntros.get(stage) === cleanup) activeIntros.delete(stage);
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  activeIntros.set(stage, cleanup);

  const onKeyDown = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    cleanup();
  };
  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    cleanup();
  };
  view.addEventListener("keydown", onKeyDown, true);
  canvas.addEventListener("click", onClick);

  const resizeObserver = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(syncSize);
  resizeObserver?.observe(stage);
  view.addEventListener("resize", syncSize, { passive: true });

  const copy = {
    visual: trUi("VISUAL SEQUENCE"),
    chapter: trUi("DEPLOYMENT SEQUENCE"),
    ignition: trUi("IGNITION"),
    rail: trUi("RAIL 02"),
    row: trUi("ROW 02"),
    railOnline: trUi("RAIL ONLINE"),
    locked: trUi("LOCKED"),
    specimen: trUi("SPECIMEN  ·  SLOT 01"),
    lowering: trUi("SPECIMEN  ·  LOWERING"),
    authorized: trUi("SESSION AUTHORIZED"),
    access: trUi("ACCESS GRANTED"),
    chapters: [trUi("IGNITION"), trUi("TRANSFER"), trUi("DEPLOY"), trUi("LOCK"), trUi("LINK")],
  };

  const drawBar = (time: number, frame: number, finalStill = false) => {
    const ctx = context;
    const barHeight = 52;
    const margin = 40;
    const top = barHeight;
    const bottom = height - barHeight;
    const secs = (time / 1000).toFixed(2).padStart(5, "0");
    ctx.save();
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, width, barHeight);
    ctx.fillRect(0, height - barHeight, width, barHeight);
    ctx.fillStyle = accentColor;
    ctx.fillRect(margin, 23, 5, 5);
    ctx.fillStyle = ink;
    ctx.font = `600 9px ${fontFamily}`;
    ctx.textBaseline = "middle";
    ctx.fillText("AUDIO ARCHIVE", margin + 15, 26);
    ctx.fillStyle = muted;
    ctx.font = `500 9px ${fontFamily}`;
    ctx.fillText(`·  ${copy.visual}  ·  ${copy.chapter}`, margin + 15 + ctx.measureText("AUDIO ARCHIVE").width + 10, 26);
    const timecode = finalStill
      ? trUi("REDUCED MOTION  ·  POSTER FRAME")
      : `T+${secs}   ·   FRAME ${pad(frame + 1, 3)} / ${pad(manifest.frames, 3)}`;
    ctx.fillStyle = softInk;
    ctx.textAlign = "right";
    ctx.fillText(timecode, width - margin, 26);
    ctx.fillStyle = accentColor;
    ctx.fillRect(width - margin - ctx.measureText(timecode).width - 14, 23, 5, 5);
    ctx.textAlign = "left";
    ctx.strokeStyle = `${ink}40`;
    ctx.lineWidth = 1;
    const lineY = height - barHeight / 2;
    ctx.beginPath();
    ctx.moveTo(margin, lineY);
    ctx.lineTo(width - margin, lineY);
    ctx.stroke();
    const chapterFrames = [0, 40, 70, 94, 118];
    const progress = finalStill ? 1 : clamp(frame / Math.max(1, manifest.frames - 1));
    ctx.fillStyle = `${ink}55`;
    ctx.fillRect(margin, lineY - 1, (width - margin * 2) * progress, 2);
    chapterFrames.forEach((at, index) => {
      const x = margin + (width - margin * 2) * (at / 144);
      const passed = progress >= at / 144;
      ctx.fillStyle = index === 0 || passed ? ink : `${ink}66`;
      ctx.fillRect(x, lineY - 5, 1, 10);
      ctx.fillStyle = passed ? softInk : muted;
      ctx.font = `500 8px ${fontFamily}`;
      ctx.fillText(`${pad(index + 1, 2)}  ${copy.chapters[index]}`, Math.min(width - margin - 68, x + 8), lineY - 14);
    });
    const playheadX = margin + (width - margin * 2) * progress;
    ctx.fillStyle = accentColor;
    ctx.fillRect(playheadX - 3, lineY - 3, 6, 6);
    ctx.restore();
    return { top, bottom, margin };
  };

  const drawVision = (track: FilmTrack | undefined, elapsed: number, frame24: number, bars: { top: number; bottom: number; margin: number }, filmBox: { x: number; y: number; width: number; height: number }, fontFamily: string) => {
    const ctx = context;
    const scanTop = bars.top + 16;
    const scanBottom = bars.bottom - 16;
    const scanY = scanTop + (elapsed % 2200) / 2200 * (scanBottom - scanTop);
    ctx.save();
    ctx.strokeStyle = `${ink}bb`;
    ctx.fillStyle = `${ink}bb`;
    ctx.lineWidth = 1;
    drawCorners(ctx, bars.margin - 16, scanTop, width - bars.margin + 16, scanBottom, 34, `${ink}bb`);
    ctx.fillStyle = `${ink}12`;
    ctx.fillRect(0, scanY - 48, width, 48);
    ctx.fillStyle = `${ink}44`;
    ctx.fillRect(0, scanY, width, 1);
    const cx = width / 2;
    const cy = (bars.top + bars.bottom) / 2;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 10, cy + dy * 10);
      ctx.lineTo(cx + dx * 26, cy + dy * 26);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(cx, cy, 40, 40, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `${ink}44`;
    ctx.stroke();

    const point = (value: FilmPoint | undefined): FilmPoint | undefined => {
      if (!value || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return undefined;
      return [filmBox.x + value[0] * filmBox.width, filmBox.y + value[1] * filmBox.height, value[2]];
    };
    const fade = (start: number, end: number) => clamp((frame24 - start) / 4) * clamp((end - frame24) / 4);
    const lit = clamp(Math.round((frame24 - 8) / 36 * 13), 0, 13);
    drawCallout(ctx, point(track?.front), copy.ignition, `${copy.rail}  ·  ${pad(lit, 2)} / 13`, fade(8, 44), 1, fontFamily, accentColor, ink, dark);
    drawCallout(ctx, point(track?.nose), copy.row, copy.railOnline, fade(58, 100), -1, fontFamily, accentColor, ink, dark);
    const locked = frame24 >= manifest.land * 24 / manifest.fps;
    drawCallout(ctx, point(track?.case), locked ? copy.locked : "ARC-0001", locked ? copy.specimen : copy.lowering, fade(72, 124), 1, fontFamily, accentColor, ink, dark);
  };

  const drawVerdict = (elapsed: number, duration: number, fontFamily: string) => {
    const start = duration - 1000;
    if (elapsed < start) return;
    const amount = easeOut((elapsed - start) / 360);
    const ctx = context;
    ctx.save();
    ctx.font = `700 22px ${fontFamily}`;
    const titleWidth = ctx.measureText(copy.authorized).width;
    const panelWidth = titleWidth + 48;
    const panelHeight = 52;
    const x = (width - panelWidth) / 2;
    const y = (height - panelHeight) / 2;
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, panelWidth * amount, panelHeight);
    ctx.fillStyle = accentColor;
    ctx.fillRect(x + panelWidth * amount, y, 4, panelHeight);
    if (amount > .3) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, panelWidth * amount, panelHeight);
      ctx.clip();
      ctx.fillStyle = ink;
      ctx.textBaseline = "middle";
      ctx.fillText(copy.authorized, x + 24, y + panelHeight / 2);
      ctx.restore();
    }
    if (amount >= 1) {
      ctx.fillStyle = onAccent;
      ctx.font = `600 9px ${fontFamily}`;
      ctx.textAlign = "center";
      ctx.fillText(`${copy.access}  ·  ARC-0001  ·  ROW 02 / SLOT 01`, width / 2, y + panelHeight + 15);
    }
    ctx.restore();
  };

  const drawFrame = (elapsed: number, frame: number, finalStill = false) => {
    const ctx = context;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = dark;
    ctx.fillRect(0, 0, width, height);
    const image = frames[frame] || lastImage;
    let filmBox = { x: 0, y: 0, width: 0, height: 0 };
    const hasImage = !!image?.naturalWidth;
    if (image?.naturalWidth) {
      if (frames[frame] === image) {
        lastImage = image;
      }
      const cover = Math.max(width / manifest.res[0], height / manifest.res[1]);
      filmBox.width = manifest.res[0] * cover;
      filmBox.height = manifest.res[1] * cover;
      filmBox.x = (width - filmBox.width) / 2;
      filmBox.y = (height - filmBox.height) / 2;
      ctx.drawImage(image, filmBox.x, filmBox.y, filmBox.width, filmBox.height);
    }
    if (!finalStill) {
      ctx.fillStyle = dark;
      ctx.globalAlpha = 1 - easeOut(elapsed / 500);
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    const bars = { top: 52, bottom: height - 52, margin: 40 };
    if (!finalStill) {
      const frame24 = frame * 24 / manifest.fps;
      const track = manifest.track[frame];
      if (frame24 < 124 && hasImage) drawVision(track, elapsed, frame24, bars, filmBox, fontFamily);
      if (frame24 >= 122) {
        ctx.save();
        ctx.globalAlpha = .82 * easeOut((frame24 - 122) / 14);
        ctx.fillStyle = accentColor;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
      drawCuePanel(ctx, width, bars.top, height, elapsed, manifest.frames / manifest.fps * 1000, fontFamily, accentColor, ink, muted, dark, copy.chapters);
      drawVerdict(elapsed, manifest.frames / manifest.fps * 1000, fontFamily);
    } else {
      drawVerdict(manifest.frames / manifest.fps * 1000, manifest.frames / manifest.fps * 1000, fontFamily);
    }
    drawBar(elapsed, frame, finalStill);
  };

  const readyForStart = () => {
    if (reduced) return !!frames[Math.max(0, manifest.frames - 1)];
    let ready = 0;
    while (ready < Math.min(4, manifest.frames) && frames[ready]) ready += 1;
    return ready >= Math.min(4, manifest.frames);
  };

  const render = (now: number) => {
    animation = 0;
    if (stopped) return;
    if (!stage.isConnected) {
      cleanup();
      return;
    }
    syncSize();
    if (!started && (readyForStart() || now - requestedAt >= 600)) {
      started = true;
      startTime = now;
    }
    if (!started) {
      context.fillStyle = dark;
      context.fillRect(0, 0, width, height);
    } else if (reduced) {
      const elapsed = now - startTime;
      const frame = Math.max(0, manifest.frames - 1);
      requestAhead(frame);
      drawFrame(elapsed, frame, true);
      if (elapsed >= 1200) {
        cleanup();
        return;
      }
    } else {
      const elapsed = now - startTime;
      const filmLength = manifest.frames / manifest.fps * 1000;
      if (elapsed >= filmLength + 600) {
        cleanup();
        return;
      }
      const frame = Math.min(manifest.frames - 1, Math.floor(elapsed * manifest.fps / 1000));
      requestAhead(frame);
      drawFrame(elapsed, frame);
      if (elapsed > filmLength) {
        const computed = view.getComputedStyle(stage);
        const stageColor = computed.getPropertyValue("--page-bg").trim() || computed.backgroundColor || dark;
        context.save();
        context.globalAlpha = easeOut((elapsed - filmLength) / 500);
        context.fillStyle = stageColor;
        context.fillRect(0, 0, width, height);
        context.restore();
      }
    }
    animation = view.requestAnimationFrame(render);
  };

  const loadManifest = async () => {
    let loaded = DEFAULT_FILM;
    if (manifestUrl) {
      try {
        const response = await view.fetch(manifestUrl, { signal: requestAbort.signal, cache: "force-cache" });
        if (response.ok) loaded = parseManifest(await response.json());
      } catch {
        if (stopped) return;
      }
    }
    if (stopped) return;
    manifest = loaded;
    frames = new Array(manifest.frames);
    if (reduced) loadFrame(Math.max(0, manifest.frames - 1));
    else requestAhead(0);
    animation = view.requestAnimationFrame(render);
  };

  void loadManifest();
  return cleanup;
}
