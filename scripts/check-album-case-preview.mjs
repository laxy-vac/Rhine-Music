import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, stat, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lyricsLayoutMode = process.argv.includes("--lyrics-layout");
const output = path.join(project, ".tools", "unified-ui-2026-10-17", lyricsLayoutMode ? "lyrics-case-layout" : "case-preview");
await mkdir(output, { recursive: true });

const browserCandidates = [
  process.env.CASE_CHECK_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);
let browserExecutable;
for (const candidate of browserCandidates) {
  if (await access(candidate).then(() => true, () => false)) {
    browserExecutable = candidate;
    break;
  }
}
assert.ok(browserExecutable, "An existing Chrome or Edge installation is required; this check never downloads a browser.");

const casePreviewPageModule = String.raw`
import { setupAlbumCasePreview } from "/src/album-case-preview.ts";
import { defaultCaseSettings } from "/src/case-settings.ts";

const host = document.querySelector("#case-preview-host");
const stats = { draws: 0, contextLossCalls: 0, glErrors: [] };
const patched = new WeakSet();
let lastCanvas;
let lastContext;
for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
  if (!type) continue;
  for (const name of ["drawArrays", "drawElements", "drawArraysInstanced", "drawElementsInstanced"]) {
    const original = type.prototype[name];
    if (typeof original !== "function") continue;
    type.prototype[name] = function (...args) {
      stats.draws++;
      return original.apply(this, args);
    };
  }
  const getExtension = type.prototype.getExtension;
  type.prototype.getExtension = function (name) {
    const extension = getExtension.call(this, name);
    if (name === "WEBGL_lose_context" && extension && !patched.has(extension)) {
      patched.add(extension);
      const loseContext = extension.loseContext;
      extension.loseContext = function (...args) {
        stats.contextLossCalls++;
        return loseContext.apply(extension, args);
      };
    }
    return extension;
  };
}

const baseQuality = {
  wave: "reduced", modelDetail: "medium", lighting: "high", terminalLight: "off",
  scale: 80, pixelRatio: 1, antialias: "off", shadows: 512, aoSamples: 0,
  aoResolution: 0.5, depthOfField: 0, transmission: 0.75, anisotropy: 2,
};
const state = {
  design: "rhine", structure: "minimal", theme: "day", appearanceColor: "#b63955",
  coverUrl: "", title: "Preview album", index: 4, reduced: true, settings: undefined,
  record: undefined, quality: { ...baseQuality },
};

function svgCover(color, mark) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640">' +
    '<rect width="640" height="640" fill="' + color + '"/><circle cx="320" cy="320" r="214" fill="#111820"/>' +
    '<circle cx="320" cy="320" r="168" fill="' + color + '"/><circle cx="320" cy="320" r="28" fill="#ede9df"/>' +
    '<path d="M96 500 260 336l84 84 64-64 136 144" fill="none" stroke="#fff" stroke-width="18"/>' +
    '<text x="320" y="108" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="40">' + mark + '</text></svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

function makeRecord(structure, title, index) {
  const album = {
    id: "preview-" + structure + "-" + index,
    title,
    artist: "Synthetic Artist",
    year: 2026,
    genreId: "preview",
    rawGenres: ["Synthetic"],
    folder: "synthetic-preview",
    tracks: [{ id: "preview-track-" + index, title: "Preview Track", artist: "Synthetic Artist",
      format: "FLAC", codec: "FLAC", sampleRate: 96000, bitsPerSample: 24,
      numberOfChannels: 2, bitrate: 2304000, lossless: true, duration: 180 }],
  };
  return {
    id: album.id, title, en: album.artist, department: album.artist, category: "Synthetic",
    date: "2026", lead: album.artist, clearance: "Synthetic preview", abstract: "Local WebGL fixture",
    findings: [], source: "synthetic fixture", album,
  };
}

function settingsFor(structure, design, color, transmission) {
  const settings = defaultCaseSettings(design);
  settings.structure = structure;
  const appearance = settings.appearances[structure];
  appearance.preset = "custom";
  appearance.surfaces.frame.preserveSource = false;
  appearance.surfaces.frame.color = color;
  appearance.surfaces.frame.pattern = "none";
  appearance.surfaces.frame.metalness = 0;
  appearance.surfaces.cover.preserveSource = false;
  appearance.surfaces.cover.transmission = transmission;
  return settings;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function preload(url) {
  if (!url.startsWith("data:")) return;
  const image = new Image();
  image.src = url;
  await image.decode();
}

async function waitReady(structure) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (host.dataset.casePreviewState === "ready" && host.dataset.caseStructure === structure) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await wait(350);
      return true;
    }
    if (host.dataset.casePreviewState === "error") {
      throw new Error("Preview entered error state for " + structure + ": " + JSON.stringify(host.dataset));
    }
    await wait(40);
  }
  throw new Error("Timed out waiting for real model " + structure + ": " + JSON.stringify(host.dataset));
}

function applyScenario(scenario) {
  const design = scenario.structure === "punk" ? "archive" : "rhine";
  state.design = design;
  state.structure = scenario.structure;
  state.theme = scenario.theme;
  state.appearanceColor = scenario.appearanceColor || "#b63955";
  state.coverUrl = scenario.coverUrl || svgCover(scenario.coverColor || "#b63955", scenario.mark || "CHECK");
  state.title = scenario.title || "Synthetic " + scenario.structure + " album";
  state.index = Number.isFinite(scenario.index) ? scenario.index : 4;
  state.reduced = true;
  state.settings = settingsFor(scenario.structure, design, state.appearanceColor, scenario.transmission ?? 0.75);
  state.record = makeRecord(scenario.structure, state.title, state.index);
  document.body.dataset.theme = scenario.theme;
  document.querySelector("#fixture-label").textContent = scenario.structure.toUpperCase() + " · " + scenario.theme.toUpperCase();
  preview.refresh();
}

const preview = setupAlbumCasePreview(host, {
  getSettings: () => state.settings,
  getQuality: () => state.quality,
  getTheme: () => state.theme,
  getDesign: () => state.design,
  getAlbum: () => ({ coverUrl: state.coverUrl, title: state.title, record: state.record, index: state.index, reduced: state.reduced }),
});
const lazyBeforeVisible = host.querySelectorAll("canvas").length === 0;
window.__albumCasePreviewHarness = {
  lazyBeforeVisible,
  state,
  host,
  preview,
  stats,
  async setScenario(scenario) {
    applyScenario(scenario);
    await preload(state.coverUrl);
    preview.refresh();
    await waitReady(scenario.structure);
    return this.inspect();
  },
  updateCoverNow(url, title) {
    state.coverUrl = url;
    state.title = title || "Synthetic cover change";
    state.index++;
    state.record = makeRecord(state.structure, state.title, state.index);
    preview.refresh();
  },
  async waitReady(structure) { await waitReady(structure); return this.inspect(); },
  setVisible(value) { preview.setVisible(value); },
  refresh() { preview.refresh(); },
  inspect() {
    const ownedCanvas = host.querySelector("canvas");
    if (ownedCanvas) lastCanvas = ownedCanvas;
    const canvas = ownedCanvas || lastCanvas;
    const gl = lastContext || (canvas?.getContext("webgl2") || canvas?.getContext("webgl"));
    if (gl) lastContext = gl;
    const errors = [];
    if (gl) {
      for (let index = 0; index < 16; index++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
    }
    stats.glErrors.push(...errors);
    return {
      state: host.dataset.casePreviewState,
      structure: host.dataset.caseStructure,
      canvasCount: host.querySelectorAll("canvas").length,
      canvasHidden: canvas?.hidden ?? null,
      pointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : null,
      contextType: gl ? (gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl") : null,
      contextVersion: gl?.getParameter(gl.VERSION) ?? null,
      contextRenderer: gl?.getParameter(gl.RENDERER) ?? null,
      contextLost: gl?.isContextLost() ?? null,
      glErrors: errors,
      drawCount: stats.draws,
      contextLossCalls: stats.contextLossCalls,
      hostRect: (() => { const r = host.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
    };
  },
  destroy() { preview.destroy(); },
};
window.__albumCasePreviewHarness.preview.setVisible(true);
window.__albumCasePreviewHarness.setScenario({ structure: "minimal", theme: "day", coverColor: "#b63955" });
`;

const mainCssImportSource = lyricsLayoutMode ? await readFile(path.join(project, "src", "music-app.ts"), "utf8") : "";
const mainCssImports = lyricsLayoutMode
  ? [...mainCssImportSource.matchAll(/^import\s+["']([^"']+\.css)["'];?\s*$/gm)].map(match => match[1])
  : [];
const lyricsCssModuleImports = mainCssImports.map(specifier => {
  const resolved = specifier.startsWith("./") ? "/src/" + specifier.slice(2) : specifier;
  return "import " + JSON.stringify(resolved) + ";";
}).join("\n");
const lyricsPageModule = String.raw`
import { setupLyricsPage } from "/src/lyrics-page.ts";
import { setupAlbumCasePreview } from "/src/album-case-preview.ts";
import { defaultCaseSettings } from "/src/case-settings.ts";
import { defaultMusicStyle, archiveMusicStyle, applyStylePalette } from "/src/music-style.ts";
` + lyricsCssModuleImports + String.raw`

const stage = document.querySelector("#stage");
const fetchCalls = [];
const externalFetchAttempts = [];
const unexpectedFetches = [];
const notifications = [];
const fixtureStorage = window.__lyricsStorageAudit;
const originalFetch = window.fetch.bind(window);
const baseQuality = {
  wave: "reduced", modelDetail: "medium", lighting: "high", terminalLight: "off",
  scale: 80, pixelRatio: 1, antialias: "off", shadows: 512, aoSamples: 0,
  aoResolution: 0.5, depthOfField: 0, transmission: 0.75, anisotropy: 2,
};
let page;
let currentPlaying;
let browseSelection;
let activeDesign;
let activeTheme;
let playerState;
let caseSettings;
let caseQuality = { ...baseQuality };

function jsonResponse(value, status) {
  return new Response(JSON.stringify(value), { status: status || 200, headers: { "Content-Type": "application/json" } });
}

function fixtureTrack(albumId, index, title) {
  return {
    id: albumId + "-track-" + index,
    albumId,
    title,
    artist: "Synthetic Artist",
    format: "FLAC",
    codec: "FLAC",
    relativePath: "fixture/" + albumId + "/track-" + index + ".flac",
    sampleRate: 96000,
    bitsPerSample: 24,
    numberOfChannels: 2,
    bitrate: 2304000,
    lossless: true,
    duration: 242,
    trackNumber: index,
    discNumber: 1,
  };
}

function fixtureAlbum(id, title, color, index) {
  const tracks = [
    fixtureTrack(id, 1, "First Movement"),
    fixtureTrack(id, 2, "Now Playing Track"),
    fixtureTrack(id, 3, "Afterimage"),
    fixtureTrack(id, 4, "Coda"),
  ];
  const album = {
    id,
    title,
    artist: "Synthetic Artist",
    year: 2026,
    genreId: "fixture-ambient",
    rawGenres: ["Ambient", "Synthetic"],
    folder: "synthetic/" + id,
    coverUrl: "/__lyrics_cover?color=" + color.replace(/^#/u, "") + "&key=" + encodeURIComponent(id),
    tracks,
    offline: false,
  };
  const record = {
    id,
    title,
    en: album.artist,
    department: album.artist,
    category: "Ambient",
    date: "2026",
    lead: album.artist,
    clearance: "Synthetic fixture",
    abstract: "Local isolated lyrics and case fixture",
    findings: [],
    source: "synthetic fixture",
    album,
  };
  return { id, title, color, index, album, record, tracks };
}

function stateFor(fixture, trackIndex) {
  const currentIndex = trackIndex ?? 1;
  return {
    transport: "playing",
    currentTrack: fixture.tracks[currentIndex],
    queue: fixture.tracks,
    currentIndex,
    playbackOrder: "default",
    playing: true,
    loading: false,
    duration: fixture.tracks[currentIndex].duration,
    currentTime: 66,
    volume: 0.65,
    songFadeEnabled: true,
    bgmVolume: 0,
    bgmEnabled: false,
    bgmPlaying: false,
    error: null,
    bgmError: null,
    sonySettings: { dsee: false, dc: 0, vinyl: 0 },
    sonyExecution: { streaming: false, parallel: false },
    sonyProcessing: { state: "off", progress: 0 },
    backend: "browser",
    outputSettings: { backend: "browser", device: "default" },
    volumeLocked: false,
  };
}

function lyricsPayload(trackId) {
  const lines = [
    "[00:00.00]Low light travels over the river",
    "[00:12.00]A quiet signal moves through glass",
    "[00:24.00]Hold the shape before it passes",
    "[00:36.00]Every room remembers the sound",
    "[00:48.00]We return by the blue line",
    "[01:00.00]One last note stays in the air",
  ];
  const translated = [
    "[00:00.00]微光掠过河面",
    "[00:12.00]安静的信号穿过玻璃",
    "[00:24.00]在它经过前留住形状",
    "[00:36.00]每个房间都记得声音",
    "[00:48.00]沿着蓝色的线返回",
    "[01:00.00]最后一个音留在空气中",
  ];
  return {
    lyric: { trackId, lrc: lines.join("\n"), translation: translated.join("\n"), offsetMs: 0,
      source: { id: "fixture-cloud", name: "Synthetic Cloud Lyrics" }, savedAt: "2026-10-17T00:00:00.000Z" },
    activeKind: "cloud",
    variants: { local: false, cloud: true },
    sources: [{ status: "ok" }],
  };
}

window.fetch = async (input, init) => {
  const rawUrl = typeof input === "string" ? input : input.url;
  const url = new URL(rawUrl, location.href);
  const method = init?.method ?? (typeof input === "object" ? input.method : "GET") ?? "GET";
  if (url.origin !== location.origin) {
    externalFetchAttempts.push(url.href);
    throw new Error("Fixture refused non-local fetch: " + url.href);
  }
  fetchCalls.push({ path: url.pathname, method });
  if (url.pathname === "/api/lyrics/resolve") {
    const request = JSON.parse(init?.body ?? "{}");
    return jsonResponse(lyricsPayload(request.trackId));
  }
  if (url.pathname === "/api/lyrics/settings") {
    return jsonResponse({
      settings: { defaultSourceId: "fixture-cloud", cacheDirectory: "fixture-cache", defaultCacheDirectory: "fixture-cache" },
      sources: [{ id: "fixture-cloud", name: "Synthetic Cloud Lyrics", builtin: true, enabled: true }],
    });
  }
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/audio-tech/")) {
    return originalFetch(input, init);
  }
  unexpectedFetches.push({ path: url.pathname, method });
  return jsonResponse({ error: "Unconfigured synthetic endpoint" }, 404);
};

function box(selector) {
  const node = document.querySelector(selector);
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

function within(inner, outer, epsilon) {
  if (!inner || !outer) return false;
  const pad = epsilon ?? 1;
  return inner.x >= outer.x - pad && inner.y >= outer.y - pad && inner.right <= outer.right + pad && inner.bottom <= outer.bottom + pad;
}

function inspect() {
  const canvas = document.querySelector(".lyrics-case-preview canvas");
  const gl = canvas?.getContext("webgl2") || canvas?.getContext("webgl");
  const glErrors = [];
  if (gl) for (let index = 0; index < 16; index++) {
    const error = gl.getError();
    if (error === gl.NO_ERROR) break;
    glErrors.push(error);
  }
  const right = document.querySelector(".lyrics-right");
  const rightBody = right?.querySelector(".lyrics-side-body");
  const profile = document.querySelector(".lyrics-archive-profile");
  const cover = document.querySelector(".lyrics-archive-cover-frame");
  const previewHost = document.querySelector(".lyrics-case-preview");
  const queue = document.querySelector(".lyrics-archive-queue");
  const rightRect = box(".lyrics-right");
  const bodyRect = rightBody ? (() => { const r=rightBody.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; })() : null;
  const profileRect = box(".lyrics-archive-profile");
  const coverRect = box(".lyrics-archive-cover-frame");
  const hostRect = box(".lyrics-case-preview");
  const canvasRect = canvas ? (() => { const r=canvas.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; })() : null;
  const queueRect = box(".lyrics-archive-queue");
  const state = currentPlaying ? stateFor(currentPlaying, 1) : undefined;
  const rightContentRect = bodyRect && rightBody ? { ...bodyRect, bottom: bodyRect.y + rightBody.scrollHeight } : null;
  return {
    design: activeDesign,
    theme: activeTheme,
    caseState: previewHost?.dataset.casePreviewState ?? null,
    caseStructure: previewHost?.dataset.caseStructure ?? null,
    canvasCount: previewHost?.querySelectorAll("canvas").length ?? 0,
    canvasPointerEvents: canvas ? getComputedStyle(canvas).pointerEvents : null,
    contextType: gl ? (gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl") : null,
    contextVersion: gl?.getParameter(gl.VERSION) ?? null,
    contextRenderer: gl?.getParameter(gl.RENDERER) ?? null,
    contextLost: gl?.isContextLost() ?? null,
    glErrors,
    canvasRect,
    currentPlayingAlbumId: currentPlaying?.album.id,
    browseSelectedAlbumId: browseSelection?.album.id,
    currentPlayingTrackId: state?.currentTrack.id,
    playingTitle: document.querySelector(".lyrics-archive-title")?.textContent,
    playingArtist: document.querySelector(".lyrics-archive-artist")?.textContent,
    loadedProfile: document.querySelector(".lyrics-archive-loaded-value")?.textContent,
    albumOrdinal: document.querySelector(".lyrics-archive-table-heading")?.textContent,
    queueCount: document.querySelector(".lyrics-archive-queue-count")?.textContent,
    queueRows: [...(document.querySelectorAll(".lyrics-queue-row") ?? [])].map(row => row.textContent.trim()),
    lyricLineCount: document.querySelectorAll(".lyrics-line").length,
    lyricActiveText: document.querySelector(".lyrics-line.is-active .lyrics-line-text")?.textContent.trim() ?? null,
    caseVisible: !!canvas && getComputedStyle(canvas).display !== "none" && getComputedStyle(canvas).visibility !== "hidden",
    rightRect,
    rightContentRect,
    profileRect,
    coverRect,
    hostRect,
    queueRect,
    rightBodyRect: bodyRect,
    profileWithinRight: within(profileRect, rightRect),
    profileWithinRightContent: within(profileRect, rightContentRect),
    coverWithinRight: within(coverRect, rightRect),
    hostWithinCover: within(hostRect, coverRect),
    canvasWithinHost: within(canvasRect, hostRect),
    queueWithinRight: within(queueRect, rightRect),
    queueWithinRightContent: within(queueRect, rightContentRect),
    rightBodyScroll: rightBody ? { clientHeight: rightBody.clientHeight, scrollHeight: rightBody.scrollHeight, scrollTop: rightBody.scrollTop, clientWidth: rightBody.clientWidth, scrollWidth: rightBody.scrollWidth } : null,
    fetchCalls: [...fetchCalls],
    externalFetchAttempts: [...externalFetchAttempts],
    unexpectedFetches: [...unexpectedFetches],
    localStorageStubReads: fixtureStorage?.reads ?? null,
    localStorageStubWrites: fixtureStorage?.writes ?? null,
  };
}

async function waitForLyricsPage(expectedStructure) {
  const deadline = Date.now() + 35000;
  while (Date.now() < deadline) {
    const preview = document.querySelector(".lyrics-case-preview");
    const title = document.querySelector(".lyrics-archive-title")?.textContent;
    const lineCount = document.querySelectorAll(".lyrics-line").length;
    if (preview?.dataset.casePreviewState === "ready" && preview.dataset.caseStructure === expectedStructure && lineCount >= 5 && title === stateFor(currentPlaying, 1).currentTrack.title) {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise(resolve => setTimeout(resolve, 300));
      return inspect();
    }
    if (preview?.dataset.casePreviewState === "error") throw new Error("Lyrics case preview error: " + JSON.stringify(inspect()));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for integrated lyrics/case page: " + JSON.stringify(inspect()));
}

function fixtureMarkup() {
  return '<section id="music-lyrics-page" class="music-settings-page music-lyrics-page" aria-labelledby="lyrics-page-title">' +
    '<div class="settings-page-heading"><div><small>LYRICS / LISTENING</small><h1 id="lyrics-page-title" tabindex="-1">歌词</h1><p>跟随音乐，阅读歌词</p></div></div>' +
    '<div id="lyrics-page-content" class="settings-page-content" role="region" aria-label="歌词与歌曲信息"></div></section>';
}

async function mountScenario(scenario) {
  page?.destroy();
  activeDesign = scenario.design;
  activeTheme = scenario.theme;
  currentPlaying = fixtureAlbum(scenario.playingId, scenario.playingTitle, scenario.playingColor, scenario.playingIndex);
  browseSelection = fixtureAlbum(scenario.browseId, scenario.browseTitle, scenario.browseColor, scenario.browseIndex);
  playerState = stateFor(currentPlaying, 1);
  caseSettings = defaultCaseSettings(activeDesign);
  caseQuality = { ...baseQuality };
  stage.dataset.page = "lyrics";
  stage.dataset.layout = "landscape";
  stage.dataset.mode = "archive";
  stage.dataset.theme = activeTheme;
  stage.dataset.design = activeDesign;
  stage.dataset.reducedMotion = "true";
  stage.classList.add("reduce-motion");
  const style = activeDesign === "archive" ? { ...archiveMusicStyle } : { ...defaultMusicStyle };
  applyStylePalette(stage, style, activeTheme);
  stage.style.setProperty("--playback-height", "80px");
  stage.innerHTML = fixtureMarkup();
  const host = stage.querySelector("#lyrics-page-content");
  page = setupLyricsPage(host, {
    seek() {},
    spectrum: () => ({ available: true, bands: Array.from({ length: 32 }, (_, i) => -48 + i % 8), peakDb: -5.5, rmsDb: -22, sampleRate: 48000, updatedAt: Date.now(), stage: "fixture" }),
    notify(message) { notifications.push(String(message)); },
    openSettings() {},
    albumOrdinal(album) { return album?.id === currentPlaying?.album.id ? currentPlaying.index + 1 : undefined; },
    createCasePreview(caseHost) {
      return setupAlbumCasePreview(caseHost, {
        getSettings: () => caseSettings,
        getQuality: () => caseQuality,
        getTheme: () => activeTheme,
        getDesign: () => activeDesign,
        getAlbum: () => currentPlaying ? {
          coverUrl: currentPlaying.album.coverUrl,
          title: currentPlaying.album.title,
          record: currentPlaying.record,
          index: currentPlaying.index,
          reduced: true,
        } : {},
      });
    },
  });
  page.update(playerState, currentPlaying.album);
  page.setVisible(true);
  return waitForLyricsPage(activeDesign === "archive" ? "punk" : caseSettings.structure);
}

async function changePlaying(scenario) {
  currentPlaying = fixtureAlbum(scenario.id, scenario.title, scenario.color, scenario.index);
  playerState = stateFor(currentPlaying, 1);
  page.update(playerState, currentPlaying.album);
  page.refreshCasePreview();
  return waitForLyricsPage(activeDesign === "archive" ? "punk" : caseSettings.structure);
}

window.__lyricsCaseHarness = {
  get page() { return page; },
  get currentPlaying() { return currentPlaying; },
  get browseSelection() { return browseSelection; },
  get playerState() { return playerState; },
  fetchCalls,
  externalFetchAttempts,
  unexpectedFetches,
  notifications,
  fixtureStorage,
  inspect,
  mountScenario,
  changePlaying,
  changeBrowse(id, title, color) { browseSelection = fixtureAlbum(id, title, color, 2); page.refreshCasePreview(); return inspect(); },
  scrollRightToBottom() { const body = document.querySelector(".lyrics-right .lyrics-side-body"); if (body) body.scrollTop = body.scrollHeight; },
  refresh() { page.refreshCasePreview(); page.update(playerState, currentPlaying.album); },
  destroy() { page?.destroy(); page = undefined; },
};
`;
const pageModule = lyricsLayoutMode ? lyricsPageModule : casePreviewPageModule;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';">
<link rel="icon" href="data:,"><title>${lyricsLayoutMode ? "Isolated Lyrics Case Layout" : "Isolated Album Case Preview"}</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
  body{font:12px Consolas,monospace;background:#e9e5dc;color:#202328;transition:none}
  body[data-theme="night"]{background:#07111f;color:#d9e3ee}
  #fixture{width:704px;height:704px;margin:24px auto;padding:32px;background:inherit;}
  #case-preview-host{width:640px;height:640px;position:relative;overflow:hidden;background:transparent;}
  #fixture-label{height:16px;margin:0 0 8px;font-size:12px;letter-spacing:.14em}
  #viewport{width:100vw;height:100vh;position:relative;overflow:hidden;background:inherit;}
  #stage.music-app{position:absolute;left:0;top:0;width:100%;height:100%;transform:none;overflow:hidden;}
</style></head><body data-theme="day"><script>${lyricsLayoutMode ? 'window.__lyricsStorageAudit={reads:0,writes:0};Object.defineProperty(window,"localStorage",{configurable:true,value:{getItem(){window.__lyricsStorageAudit.reads++;return null},setItem(){window.__lyricsStorageAudit.writes++},removeItem(){window.__lyricsStorageAudit.writes++}}});' : ''}</script>${lyricsLayoutMode ? '<div id="viewport"><main id="stage" class="music-app" data-page="lyrics" data-layout="landscape" data-mode="archive" data-theme="day" data-design="rhine" data-reduced-motion="true"></main></div>' : '<main id="fixture"><div id="fixture-label">Loading local WebGL fixture</div><div id="case-preview-host"></div></main>'}
<script type="module">${pageModule}</script></body></html>`;

const slowResponses = [];
const serverRequests = [];
let vite;
let server;
let browser;
let socket;
let sessionId;
let sequence = 0;
const pending = new Map();
const browserLog = [];
const runtimeErrors = [];
const externalRequests = [];
const cdpMessages = [];
let browserErrors = "";
let browserExit = null;

function send(method, params = {}, targetSession = sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("CDP timeout: " + method + "; socket=" + socket?.url + "; readyState=" + socket?.readyState + "; recent=" + JSON.stringify(cdpMessages.slice(-12))));
    }, method === "Page.enable" ? 7000 : 30000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(targetSession ? { sessionId: targetSession } : {}) }));
  });
}

function handleMessage(event) {
  const message = JSON.parse(event.data);
  cdpMessages.push({ id: message.id, method: message.method, sessionId: message.sessionId, error: message.error });
  if (cdpMessages.length > 80) cdpMessages.shift();
  if (message.method === "Fetch.requestPaused") {
    const requestId = message.params.requestId;
    const url = message.params.request.url;
    if (!url.startsWith(localOrigin + "/")) {
      externalRequests.push(url);
      void send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, message.sessionId);
    } else {
      void send("Fetch.continueRequest", { requestId }, message.sessionId);
    }
    return;
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = message.params.args.map(argument => argument.value ?? argument.description ?? "").join(" ");
    browserLog.push({ type: message.params.type, text });
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    runtimeErrors.push(message.params.exceptionDetails?.text ?? "Browser runtime exception");
    return;
  }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(entry.timer);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
}

let localOrigin = "";
const results = [];

async function evaluate(expression) {
  const response = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
    throw new Error("Browser evaluation failed: " + description);
  }
  return response.result.value;
}

async function captureElement(selector, name) {
  const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 }, captureBeyondViewport: false });
  const data = Buffer.from(shot.data, "base64");
  const file = path.join(output, name);
  await writeFile(file, data);
  return { file: path.relative(project, file).replaceAll("\\", "/"), bytes: data.length, sha256: await hash(data) };
}

async function capture(name) {
  return captureElement(lyricsLayoutMode ? "#music-lyrics-page" : "#fixture", name);
}

async function hash(buffer) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(buffer).digest("hex");
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function runLyricsLayoutBrowser(browserVersion) {
  assert.equal(await evaluate("Boolean(window.__lyricsCaseHarness)"), true, "The production LyricsPage harness loads.");
  assert.ok(await evaluate("window.__lyricsCaseHarness.fixtureStorage && window.__lyricsCaseHarness.fixtureStorage.reads > 0"), "The UI language module read only the fixture localStorage stub.");
  const scenes = [];
  for (const design of ["rhine", "archive"]) {
    for (const theme of ["day", "night"]) {
      const expectedStructure = design === "archive" ? "punk" : "minimal";
      const scenario = {
        design,
        theme,
        playingId: "playing-" + design + "-" + theme,
        playingTitle: "Playback Album " + design + " " + theme,
        playingColor: design === "archive" ? "#c45132" : "#3277bb",
        playingIndex: design === "archive" ? 12 : 8,
        browseId: "browse-selected-" + design + "-" + theme,
        browseTitle: "Browse Selection Must Not Appear",
        browseColor: "#bd2562",
        browseIndex: 2,
      };
      const view = await evaluate(`window.__lyricsCaseHarness.mountScenario(${JSON.stringify(scenario)})`);
      assert.equal(view.design, design);
      assert.equal(view.theme, theme);
      assert.equal(view.caseState, "ready", design + "/" + theme + " has a ready real case preview.");
      assert.equal(view.caseStructure, expectedStructure, design + "/" + theme + " uses the selected case profile.");
      assert.equal(view.canvasCount, 1);
      assert.equal(view.caseVisible, true);
      assert.equal(view.canvasPointerEvents, "none");
      assert.equal(view.contextType, "webgl2", design + "/" + theme + " uses the real WebGL2 canvas.");
      assert.equal(view.contextLost, false);
      assert.deepEqual(view.glErrors, []);
      assert.equal(view.playingTitle, "Now Playing Track");
      assert.ok(view.loadedProfile.includes(scenario.playingTitle), "The right profile follows the playing album.");
      assert.ok(view.albumOrdinal.includes("ARC-" + String(scenario.playingIndex + 1).padStart(4, "0")), "The profile ordinal follows the playing record.");
      assert.equal(view.queueCount, "02", "The same-album queue shows the two tracks after the playing track.");
      assert.equal(view.queueRows.length, 2);
      assert.ok(view.queueRows[0].startsWith("003"));
      assert.ok(view.queueRows[1].startsWith("004"));
      assert.ok(view.lyricLineCount >= 5, "Synthetic timed lyrics render in the central reading lane.");
      assert.ok(view.profileWithinRightContent && view.coverWithinRight && view.hostWithinCover && view.canvasWithinHost && view.queueWithinRightContent,
        "Profile, album case canvas, and same-album queue remain inside the right column's scroll content: " + JSON.stringify(view));
      assert.ok(view.rightBodyScroll.scrollWidth <= view.rightBodyScroll.clientWidth + 1, "The right column has no horizontal overflow.");
      assert.equal(view.externalFetchAttempts.length, 0, "Lyrics API mocks made no external fetch.");
      assert.equal(view.unexpectedFetches.length, 0, "Only the two configured local lyrics API routes were used.");
      const screenshot = await capture("lyrics-" + (design === "archive" ? "punk" : "future") + "-" + theme + ".png");
      await evaluate("window.__lyricsCaseHarness.scrollRightToBottom()");
      await delay(120);
      const queueView = await evaluate("window.__lyricsCaseHarness.inspect()");
      assert.ok(queueView.rightBodyScroll.scrollTop > 0, "The long right profile uses its real scroll container to reach the queue.");
      assert.ok(queueView.queueWithinRight, "Same-album queue rows are reachable inside the visible right column after scrolling.");
      assert.equal(queueView.queueRows.length, 2);
      assert.equal(queueView.contextType, "webgl2");
      assert.equal(queueView.contextLost, false);
      assert.deepEqual(queueView.glErrors, []);
      const queueScreenshot = await captureElement(".lyrics-right", "lyrics-" + (design === "archive" ? "punk" : "future") + "-" + theme + "-queue.png");
      scenes.push({ design, theme, expectedStructure, scenario, view, screenshot, queueView, queueScreenshot });
    }
  }

  const bindingScenario = {
    design: "rhine", theme: "day", playingId: "playing-binding-a", playingTitle: "Playback Album A",
    playingColor: "#2579c6", playingIndex: 8, browseId: "browse-binding-a",
    browseTitle: "Unrelated Browse Album", browseColor: "#c82449", browseIndex: 1,
  };
  const bindingBeforeState = await evaluate(`window.__lyricsCaseHarness.mountScenario(${JSON.stringify(bindingScenario)})`);
  const bindingCoverBefore = await captureElement(".lyrics-case-preview", "binding-playing-cover-before.png");
  const browseOnly = await evaluate(`window.__lyricsCaseHarness.changeBrowse(${JSON.stringify("browse-binding-b")}, ${JSON.stringify("Changed Browse Album")}, ${JSON.stringify("#36a957")})`);
  await delay(250);
  const bindingCoverAfterBrowse = await captureElement(".lyrics-case-preview", "binding-after-browse-selection-change.png");
  assert.equal(bindingCoverBefore.sha256, bindingCoverAfterBrowse.sha256, "Changing only the browse selection leaves the playing case artwork unchanged.");
  const playbackChange = await evaluate(`window.__lyricsCaseHarness.changePlaying(${JSON.stringify({ id: "playing-binding-b", title: "Playback Album B", color: "#cf7932", index: 10 })})`);
  const bindingCoverAfterPlayback = await captureElement(".lyrics-case-preview", "binding-after-playing-album-change.png");
  assert.notEqual(bindingCoverAfterBrowse.sha256, bindingCoverAfterPlayback.sha256, "Changing the currently playing album changes the case artwork.");
  assert.ok(playbackChange.loadedProfile.includes("Playback Album B"), "The profile follows the new playing album rather than the browse selection.");
  assert.equal(browseOnly.browseSelectedAlbumId, "browse-binding-b");

  const binding = {
    before: bindingCoverBefore,
    afterBrowseSelection: bindingCoverAfterBrowse,
    afterPlaybackAlbum: bindingCoverAfterPlayback,
    viewBefore: bindingBeforeState,
    viewAfterBrowse: browseOnly,
    viewAfterPlayback: playbackChange,
  };
  const harness = await evaluate(`(() => ({
    fetchCalls: window.__lyricsCaseHarness.fetchCalls,
    externalFetchAttempts: window.__lyricsCaseHarness.externalFetchAttempts,
    unexpectedFetches: window.__lyricsCaseHarness.unexpectedFetches,
    notifications: window.__lyricsCaseHarness.notifications,
    localStorage: { reads: window.__lyricsCaseHarness.fixtureStorage.reads, writes: window.__lyricsCaseHarness.fixtureStorage.writes },
  }))()`);
  const consoleErrors = browserLog.filter(entry => entry.type === "error" || /shader error|failed to compile|program link|link.*program|webgl.*error|gl_invalid/i.test(entry.text));
  assert.deepEqual(runtimeErrors, [], "The integrated page has no browser runtime exceptions.");
  assert.deepEqual(consoleErrors, [], "The integrated page has no JavaScript, shader or WebGL console errors.");
  assert.deepEqual(externalRequests, [], "The browser refused all non-loopback network requests.");
  assert.deepEqual(harness.externalFetchAttempts, [], "The synthetic application fetch wrapper refused non-local requests.");
  assert.deepEqual(harness.unexpectedFetches, [], "Only the two configured lyrics API mocks were used.");
  assert.equal(harness.localStorage.writes, 0, "The fixture did not write UI preferences.");
  await evaluate("window.__lyricsCaseHarness.destroy()");
  const report = {
    check: "lyrics-case-layout",
    browser: { userAgent: browserVersion, webgl: "shared setupAlbumCasePreview context" },
    fixture: "Production setupLyricsPage + setupAlbumCasePreview + CSS import specifiers read from music-app.ts; music-app.ts itself is not imported or executed.",
    cssImports: mainCssImports,
    privacyBoundary: "Synthetic tracks, albums, records, lyrics and API responses; i18n localStorage is replaced by an in-memory stub; no player, real service, audio device or user library.",
    network: { origin: localOrigin, externalRequests, fetchCalls: harness.fetchCalls, externalFetchAttempts: harness.externalFetchAttempts, unexpectedFetches: harness.unexpectedFetches, requestedPaths: serverRequests },
    errors: { runtime: runtimeErrors, console: consoleErrors, browserStderr: browserErrors },
    localStorage: harness.localStorage,
    assertions: [
      "Four full Future/Punk × day/night lyrics-page screenshots with real ready case canvas.",
      "Right profile, case host/canvas and same-album queue geometry fit within the production layout.",
      "Current playing album and track data populate the profile and following queue.",
      "Changing browse selection alone does not alter the case; changing playback album does.",
      "Production LyricsPage API requests use only local synthetic mock responses.",
      "Formal CSS imports were read from music-app.ts; its application entry was never executed.",
    ],
    screenshots: scenes.map(scene => ({ design: scene.design, theme: scene.theme, expectedStructure: scene.expectedStructure, ...scene.screenshot, queueScreenshot: scene.queueScreenshot, geometry: scene.view, queueGeometry: scene.queueView })),
    playbackBinding: binding,
    notifications: harness.notifications,
  };
  return report;
}

function svgData(color) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="' + color + '"/><circle cx="320" cy="320" r="180" fill="#f2e9dc"/><circle cx="320" cy="320" r="28" fill="#111820"/></svg>';
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

try {
  vite = await createViteServer({
    configFile: false,
    root: project,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, hmr: false, watch: { ignored: ["**/*"] } },
    optimizeDeps: { include: ["three"] },
  });
  server = createHttpServer((request, response) => {
    const hostHeader = String(request.headers.host ?? "");
    if (!/^127\.0\.0\.1(?::\d+)?$/u.test(hostHeader)) {
      response.writeHead(403).end("loopback only");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    serverRequests.push({ method: request.method, path: url.pathname });
    if (url.pathname === "/__album_case_preview_check__") {
      const sendHtml = page => {
        if (response.destroyed) return;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(page);
      };
      if (lyricsLayoutMode) {
        void vite.transformIndexHtml(url.pathname, html).then(sendHtml).catch(() => {
          if (!response.destroyed) response.writeHead(500).end("local fixture HTML transform failed");
        });
      } else sendHtml(html);
      return;
    }
    if (url.pathname === "/__slow_cover") {
      const color = /^#[0-9a-f]{6}$/iu.test(url.searchParams.get("color") ?? "") ? url.searchParams.get("color") : "#e44d28";
      slowResponses.push({ requested: Date.now(), color });
      setTimeout(() => {
        if (response.destroyed) return;
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="' + color + '"/><circle cx="320" cy="320" r="220" fill="#111820"/><circle cx="320" cy="320" r="38" fill="#fff"/></svg>';
        response.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store", "content-length": Buffer.byteLength(svg) });
        response.end(svg);
      }, 1400);
      return;
    }
    if (url.pathname === "/__lyrics_cover") {
      const rawColor = url.searchParams.get("color") ?? "2f78c1";
      const color = /^[0-9a-f]{6}$/iu.test(rawColor) ? "#" + rawColor : "#2f78c1";
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" fill="' + color + '"/><circle cx="320" cy="320" r="225" fill="#101723"/><circle cx="320" cy="320" r="175" fill="' + color + '"/><circle cx="320" cy="320" r="28" fill="#f3eee5"/><path d="M110 490 250 350l82 82 70-72 130 130" fill="none" stroke="#f3eee5" stroke-width="18"/><text x="320" y="110" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="36">PLAYING</text></svg>';
      response.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(svg) });
      response.end(svg);
      return;
    }
    vite.middlewares(request, response, error => {
      if (error) {
        response.writeHead(500).end("local Vite transform failed");
      } else if (!response.headersSent) {
        response.writeHead(404).end("not found");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = address.port;
  localOrigin = "http://127.0.0.1:" + port;

  const profile = path.join(output, "chrome-profile-" + process.pid);
  await mkdir(profile, { recursive: true });
  browser = spawn(browserExecutable, [
    "--headless=new",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-features=OptimizationHints,MediaRouter",
    "--use-angle=d3d11",
    "--enable-gpu",
    "--ignore-gpu-blocklist",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.on("data", chunk => { browserErrors = (browserErrors + chunk.toString()).slice(-5000); });
  browser.once("exit", (code, signal) => { browserExit = { code, signal }; });

  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await stat(portFile).then(() => true, () => false)) break;
    if (browser.exitCode !== null) throw new Error("Chromium exited early: " + browserErrors);
    await delay(100);
  }
  const portLines = (await readFile(portFile, "utf8")).trim().split(/\r?\n/u);
  const devtoolsPort = portLines[0];
  const targets = await fetch("http://127.0.0.1:" + devtoolsPort + "/json/list").then(response => response.json());
  const pageTarget = targets.find(target => target.type === "page");
  assert.ok(pageTarget?.webSocketDebuggerUrl, "The existing Chromium process exposes its local page target.");
  socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
  socket.addEventListener("message", handleMessage);
  socket.addEventListener("close", event => { cdpMessages.push({ closeCode: event.code, closeReason: event.reason }); });
  socket.addEventListener("error", event => { cdpMessages.push({ socketError: String(event.message ?? "WebSocket error") }); });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  await send("Page.enable", {});
  await send("Runtime.enable", {});
  await send("Network.enable", {});
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  await send("Emulation.setDeviceMetricsOverride", lyricsLayoutMode
    ? { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }
    : { width: 752, height: 752, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: localOrigin + "/__album_case_preview_check__" });

  const moduleReadyDeadline = Date.now() + 15000;
  const harnessReadyExpression = lyricsLayoutMode ? "Boolean(window.__lyricsCaseHarness)" : "Boolean(window.__albumCasePreviewHarness)";
  while (Date.now() < moduleReadyDeadline) {
    try {
      const ready = await evaluate(harnessReadyExpression);
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.equal(await evaluate(harnessReadyExpression), true, lyricsLayoutMode
    ? "The production LyricsPage integration fixture loads from local Vite modules."
    : "The isolated preview harness loads from local Vite modules.");
  if (lyricsLayoutMode) {
    const chromeVersion = await evaluate("navigator.userAgent");
    const report = await runLyricsLayoutBrowser(chromeVersion);
    await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log("Integrated LyricsPage/case layout checks passed. Screenshots and report: " + path.relative(project, output).replaceAll("\\", "/"));
  } else {
  assert.equal(await evaluate("window.__albumCasePreviewHarness.lazyBeforeVisible"), true, "Renderer creation stays lazy until setVisible(true).");

  const firstReady = await evaluate("window.__albumCasePreviewHarness.waitReady('minimal')");
  assert.equal(firstReady.state, "ready");
  assert.equal(firstReady.contextType, "webgl2", "The preview uses an actual WebGL2 context.");
  assert.ok(firstReady.drawCount > 0, "The scene submitted real WebGL draw calls.");
  assert.equal(firstReady.pointerEvents, "none", "The preview canvas cannot consume player button input.");
  results.push({ phase: "initial-lazy-render", ...firstReady });
  const chromeVersion = await evaluate("navigator.userAgent");

  const sceneShots = [];
  for (const structure of ["minimal", "rhine", "punk"]) {
    for (const theme of ["day", "night"]) {
      const scenario = { structure, theme, coverColor: structure === "punk" ? "#d35d32" : structure === "rhine" ? "#2d8397" : "#a94563", mark: structure.toUpperCase(), index: structure === "minimal" ? 3 : structure === "rhine" ? 8 : 13 };
      const view = await evaluate(`window.__albumCasePreviewHarness.setScenario(${JSON.stringify(scenario)})`);
      assert.equal(view.state, "ready", structure + "/" + theme + " loads a real case model.");
      assert.equal(view.structure, structure, structure + "/" + theme + " reports the active structure.");
      assert.equal(view.canvasCount, 1);
      assert.equal(view.canvasHidden, false);
      assert.equal(view.contextLost, false);
      assert.deepEqual(view.glErrors, [], structure + "/" + theme + " has no WebGL errors.");
      const screenshot = await capture(`${structure}-${theme}.png`);
      sceneShots.push({ structure, theme, screenshot, render: view });
      results.push({ phase: "structure-theme", ...sceneShots.at(-1) });
    }
  }
  for (const structure of ["minimal", "rhine", "punk"]) {
    const day = sceneShots.find(item => item.structure === structure && item.theme === "day").screenshot.sha256;
    const night = sceneShots.find(item => item.structure === structure && item.theme === "night").screenshot.sha256;
    assert.notEqual(day, night, structure + " day/night changes the transparent preview surroundings.");
  }

  const coverStart = await evaluate(`window.__albumCasePreviewHarness.setScenario(${JSON.stringify({ structure: "minimal", theme: "day", coverColor: "#bf3030", mark: "COVER A", appearanceColor: "#a54858" })})`);
  const coverBefore = await capture("minimal-day-cover-before.png");
  const coverChange = await evaluate(`window.__albumCasePreviewHarness.setScenario(${JSON.stringify({ structure: "minimal", theme: "day", coverColor: "#227bce", mark: "COVER B", appearanceColor: "#a54858", title: "Synthetic cover B" })})`);
  const coverAfter = await capture("minimal-day-cover-after.png");
  assert.notEqual(coverBefore.sha256, coverAfter.sha256, "Changing the album cover changes the rendered preview.");
  results.push({ phase: "cover-update", before: coverBefore, after: coverAfter, state: coverChange });

  const appearanceBefore = await evaluate(`window.__albumCasePreviewHarness.setScenario(${JSON.stringify({ structure: "minimal", theme: "day", coverColor: "#227bce", mark: "COVER B", appearanceColor: "#b51e54", transmission: 0.75 })})`);
  const appearanceBeforeShot = await capture("minimal-day-appearance-before.png");
  const appearanceAfterState = await evaluate(`window.__albumCasePreviewHarness.setScenario(${JSON.stringify({ structure: "minimal", theme: "day", coverColor: "#227bce", mark: "COVER B", appearanceColor: "#25b17e", transmission: 0.25 })})`);
  const appearanceAfterShot = await capture("minimal-day-appearance-after.png");
  assert.notEqual(appearanceBeforeShot.sha256, appearanceAfterShot.sha256, "Appearance color and optical changes reach the rendered model.");
  results.push({ phase: "appearance-optics-update", before: appearanceBeforeShot, after: appearanceAfterShot, state: appearanceAfterState });

  await evaluate(`window.__albumCasePreviewHarness.updateCoverNow(${JSON.stringify(localOrigin + "/__slow_cover?color=%23e44d28")}, "Slow stale cover")`);
  assert.ok(await waitForSlowRequest(localOrigin, 1), "The delayed local cover request starts.");
  await evaluate(`window.__albumCasePreviewHarness.updateCoverNow(${JSON.stringify(svgData("#247abf"))}, "Fast current cover")`);
  const fastCurrentState = await evaluate("window.__albumCasePreviewHarness.waitReady('minimal')");
  const staleBefore = await capture("stale-cover-current.png");
  await delay(1750);
  const staleAfter = await capture("stale-cover-after-old-load.png");
  assert.equal(slowResponses.length, 1, "The delayed local image fixture completed exactly once.");
  assert.equal(staleBefore.sha256, staleAfter.sha256, "A late stale texture cannot replace the current cover.");
  results.push({ phase: "stale-cover", before: staleBefore, after: staleAfter, current: fastCurrentState });

  const beforeHidden = await evaluate("window.__albumCasePreviewHarness.inspect()");
  await evaluate("window.__albumCasePreviewHarness.setVisible(false)");
  await evaluate(`window.__albumCasePreviewHarness.updateCoverNow(${JSON.stringify(svgData("#f0c832"))}, "Hidden cover")`);
  await evaluate("window.__albumCasePreviewHarness.refresh()");
  await delay(350);
  const afterHidden = await evaluate("window.__albumCasePreviewHarness.inspect()");
  assert.equal(afterHidden.drawCount, beforeHidden.drawCount, "Hidden refreshes submit no WebGL draws.");
  assert.equal(afterHidden.canvasHidden, true, "setVisible(false) hides the canvas while the parent page is hidden.");
  results.push({ phase: "hidden-refresh", before: beforeHidden, after: afterHidden });

  await evaluate("window.__albumCasePreviewHarness.setVisible(true)");
  const visibleAgain = await evaluate("window.__albumCasePreviewHarness.waitReady('minimal')");
  assert.ok(visibleAgain.drawCount > afterHidden.drawCount, "The latest state renders again when the component becomes visible.");

  await evaluate(`window.__albumCasePreviewHarness.updateCoverNow(${JSON.stringify(localOrigin + "/__slow_cover?color=%23aa47d0")}, "Pending before destroy")`);
  assert.ok(await waitForSlowRequest(localOrigin, 2), "A local pending image request starts before destroy.");
  const beforeDestroy = await evaluate("window.__albumCasePreviewHarness.inspect()");
  await evaluate("window.__albumCasePreviewHarness.destroy()");
  await delay(1700);
  const afterDestroy = await evaluate("window.__albumCasePreviewHarness.inspect()");
  assert.equal(afterDestroy.canvasCount, 0, "destroy removes the owned canvas.");
  assert.equal(afterDestroy.drawCount, beforeDestroy.drawCount, "A delayed texture callback does not render after destroy.");
  assert.ok(afterDestroy.contextLossCalls > 0, "destroy releases the WebGL context.");
  assert.equal(afterDestroy.contextLost, true, "The renderer context is no longer live after destroy.");
  assert.equal(slowResponses.length, 2, "Both controlled slow-cover requests complete locally.");
  results.push({ phase: "destroy-pending-texture", before: beforeDestroy, after: afterDestroy });

  const errors = [
    ...runtimeErrors,
    ...browserLog.filter(entry => entry.type === "error" || /shader error|failed to compile|program link|link.*program|webgl.*error|gl_invalid/i.test(entry.text)).map(entry => entry.type + ": " + entry.text),
  ];
  assert.deepEqual(errors, [], "No JavaScript, shader compilation, or WebGL console errors.");
  assert.deepEqual(externalRequests, [], "Every non-loopback browser request is refused; none occurred.");
  assert.equal(sceneShots.length, 6, "All three structures render in day and night themes.");
  const report = {
    check: "album-case-preview",
    browser: { executable: browserExecutable, product: chromeVersion, webgl: firstReady.contextVersion, renderer: firstReady.contextRenderer },
    isolation: { origin: localOrigin, externalRequests, browserErrors: errors, requestedPaths: serverRequests, slowCoverRequests: slowResponses.length },
    assertions: [
      "lazy renderer creation",
      "minimal/rhine/punk × day/night real WebGL2 rendering",
      "transparent page background and fitted case framing (screenshots require visual inspection)",
      "album cover update changes rendered pixels",
      "appearance and transmission update changes rendered pixels",
      "stale image callback cannot replace current cover",
      "hidden refresh submits no WebGL draws",
      "destroy releases canvas and WebGL context; stale callback does not render",
      "no browser runtime, shader, or WebGL errors",
      "all external browser requests are blocked",
    ],
    screenshots: sceneShots.map(item => ({ structure: item.structure, theme: item.theme, ...item.screenshot })),
    results,
  };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("Real local WebGL album-case preview checks passed. Screenshots and report: " + path.relative(project, output).replaceAll("\\", "/"));
  }
} catch (error) {
  const report = {
    check: "album-case-preview",
    origin: localOrigin,
    externalRequests,
    browserLog,
    runtimeErrors,
    cdpMessages,
    browserErrors,
    browserExit,
    serverRequests,
    results,
    error: error instanceof Error ? error.stack : String(error),
  };
  await writeFile(path.join(output, "report-failure.json"), JSON.stringify(report, null, 2) + "\n");
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.close();
  }
  if (browser && browser.exitCode === null) browser.kill();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await vite?.close();
}

async function waitForSlowRequest(origin, expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (slowResponses.length >= expected) return true;
    await delay(30);
  }
  return false;
}
