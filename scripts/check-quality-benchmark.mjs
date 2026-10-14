// Offline browser acceptance for the production quality-detection UI.
// All music and player state in this fixture is synthetic; Chrome uses a dedicated profile.
import assert from "node:assert/strict";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const compiledRoot = path.join(project, ".tools", "source-preview-interface");
const output = path.join(project, ".tools", "unified-architecture-stage4", "quality-benchmark");
const runId = `${Date.now()}-${process.pid}`;
const profile = path.join(output, `chrome-profile-${runId}`);
const fixturePort = "/__quality-benchmark-host.js";
const runnerPath = "/__quality-benchmark-runner.html";
const protocol = "personal-music-player-quality-benchmark-v1";
const benchmarkSize = { width: 960, height: 540 };
const browserCandidates = [
  process.env.QUALITY_BENCHMARK_BROWSER,
  process.env.CASE_CHECK_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

await mkdir(output, { recursive: true });
await mkdir(profile, { recursive: true });
await access(path.join(compiledRoot, "quality-benchmark.html"));

const hostFixture = `
import { mountQualityDetection } from "./src/quality-detection.ts";
import { defaultMusicStyle } from "./src/music-style.ts";
import { defaultCaseSettings, normalizeCaseSettings } from "./src/case-settings.ts";
import { qualityPresets } from "./src/render-quality.ts";
import { setMusicAlbums, records } from "./src/data.ts";
import { configureMusicCatalog, focusMusicEntry, getMusicDisplayEntries } from "./src/music-catalog.ts";
import { musicApplication } from "./src/music-application-state.ts";
const protocol = ${JSON.stringify(protocol)};
const host = document.querySelector("#quality-host");
const presets = Object.keys(qualityPresets);
const genres = [
  { id: "host-fixture-genre-1", name: "Fixture Group 01" },
  { id: "host-fixture-genre-2", name: "Fixture Group 02" },
];
const catalog = [1, 2].map(number => {
  const id = "host-synthetic-album-00" + number;
  const genre = genres[number - 1];
  return {
    id, title: "Synthetic Host Album 00" + number, artist: "Fixture Artist 0" + number, year: 2000 + number,
    genreId: genre.id, rawGenres: [genre.name], folder: "synthetic-fixture/00" + number, offline: true, producers: [],
    tracks: [1, 2].map(trackNumber => ({
      id: id + "-track-" + trackNumber, albumId: id, title: "Fixture Track " + trackNumber,
      artist: "Fixture Artist 0" + number, trackNumber, discNumber: 1, duration: 180,
      format: "PCM", browserPlayable: false, audioUrl: "", relativePath: "",
    })),
  };
});
setMusicAlbums(catalog, genres, "genre");
configureMusicCatalog({ layout: "grid", show: "tracks", group: "genre", sort: "title" }, "synthetic host query");
const targetEntry = getMusicDisplayEntries().find(entry => entry.albumId === catalog[1].id && entry.trackId === "host-synthetic-album-002-track-2");
if (!targetEntry) throw new Error("The parent synthetic catalog did not produce its second-track display entry.");
focusMusicEntry(targetEntry.key);
musicApplication.selectAlbum(targetEntry.recordIndex, targetEntry.albumId);
musicApplication.mode = "detail";
musicApplication.activeTab = "about";
musicApplication.infoScrollTop = 137;
const originalStyle = { ...defaultMusicStyle, design: "rhine", floor: "plain", shelf: false };
let style = { ...originalStyle };
const originalCase = normalizeCaseSettings({ ...defaultCaseSettings("rhine"), structure: "minimal", enabled: false }, "rhine");
let caseSettings = { ...originalCase };
let cleanup;
let applyCount = 0;
let appliedQuality;
let lastProtocolMessage;
let lastFrameStorage;
let activeRunToken;
let parentShortcutCount = 0;
const messages = [];
const clone = value => JSON.parse(JSON.stringify(value));
document.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "t") parentShortcutCount++;
});
function readFrameStorage(source) {
  try {
    const local = source.localStorage;
    const session = source.sessionStorage;
    let localWriteBlocked = false;
    let sessionWriteBlocked = false;
    try { local.setItem("__quality_benchmark_probe__", "probe"); } catch { localWriteBlocked = true; }
    try { session.setItem("__quality_benchmark_probe__", "probe"); } catch { sessionWriteBlocked = true; }
    if (!localWriteBlocked) local.removeItem("__quality_benchmark_probe__");
    if (!sessionWriteBlocked) session.removeItem("__quality_benchmark_probe__");
    return { localLength: local.length, sessionLength: session.length, localWriteBlocked, sessionWriteBlocked };
  } catch (error) { return { error: String(error) }; }
}
window.addEventListener("message", event => {
  const iframe = document.querySelector(".quality-benchmark-overlay iframe");
  const message = event.data;
  if (!iframe || event.source !== iframe.contentWindow || event.origin !== location.origin ||
      !message || message.protocol !== protocol || message.token !== new URL(iframe.src).searchParams.get("run")) return;
  activeRunToken = message.token;
  messages.push({ type: message.type, token: message.token, preset: message.preset, scenario: message.scenario, phase: message.phase });
  if (["result", "error", "cancelled"].includes(message.type)) {
    lastProtocolMessage = clone(message);
    lastFrameStorage = readFrameStorage(event.source);
    try {
      lastProtocolMessage.frameState = {
        renderBackend: event.source.document.querySelector("#benchmark-scene")?.dataset.renderBackend ?? null,
        devicePixelRatio: event.source.devicePixelRatio,
        canvasPresent: Boolean(event.source.document.querySelector("#benchmark-scene canvas")),
        audioCalls: [...(event.source.__qualityBenchmarkAudioApiCalls ?? [])],
      };
    } catch (error) { lastProtocolMessage.frameStateError = String(error); }
  }
}, true);

function mount() {
  cleanup = mountQualityDetection(host, {
    getStyle: () => style,
    getTheme: () => "day",
    getCaseSettings: () => caseSettings,
    getSize: () => ({ ...${JSON.stringify(benchmarkSize)} }),
    apply: quality => { applyCount++; appliedQuality = clone(quality); },
  });
}
function unmount() { cleanup?.(); cleanup = undefined; }
function parentSnapshot() {
  const entries = getMusicDisplayEntries();
  return clone({
    records: records.map(record => record.id),
    entries: entries.map(entry => ({ key: entry.key, albumId: entry.albumId, trackId: entry.trackId, recordIndex: entry.recordIndex })),
    selectedIndex: musicApplication.selectedIndex,
    selectedAlbumId: musicApplication.selectedAlbumId,
    selectedTrackId: musicApplication.selectedTrackId,
    mode: musicApplication.mode,
    activeTab: musicApplication.activeTab,
    infoScrollTop: musicApplication.infoScrollTop,
    catalogRevision: musicApplication.catalogRevision,
    catalogFocus: musicApplication.catalogFocus,
    view: musicApplication.view,
    query: musicApplication.query,
  });
}
function injectInvalidMessages() {
  const iframe = document.querySelector(".quality-benchmark-overlay iframe");
  if (!iframe) throw new Error("No benchmark iframe is active.");
  const token = new URL(iframe.src).searchParams.get("run");
  const fakeResult = {
    protocol, type: "result", token,
    result: {
      recommendation: presets[0], effectiveLayout: "shelf", renderBackend: "three-webgl",
      measurements: presets.map(preset => ({ preset, scenarios: ["shelf", "case"].map(scenario =>
        ({ scenario, fps: 60, p95FrameMs: 16.66, slowFramePercent: 0, samples: 120 })) })),
    },
  };
  // The first event has the wrong source; the second has the right source but wrong token.
  window.postMessage(fakeResult, location.origin);
  const forged = { ...fakeResult, token: String(token) + "0" };
  iframe.contentWindow.eval("parent.postMessage(" + JSON.stringify(forged) + ", " + JSON.stringify(location.origin) + ")");
  return { tokenLength: token?.length ?? 0 };
}

window.__qualityBenchmarkHarness = {
  mount,
  unmount,
  start: () => {
    lastProtocolMessage = undefined;
    lastFrameStorage = undefined;
    activeRunToken = undefined;
    host.querySelector("[data-quality-detection-start]")?.click();
  },
  cancel: () => document.querySelector(".quality-benchmark-overlay .quality-detection__button")?.click(),
  injectInvalidMessages,
  snapshot: parentSnapshot,
  sceneProfiles: () => clone({ style, caseSettings, applyCount, appliedQuality }),
  messages: () => clone(messages),
  lastMessage: () => clone(lastProtocolMessage),
  activeRunToken: () => activeRunToken,
  frameStorage: () => clone(lastFrameStorage),
  mutateCaseProfile: () => { caseSettings = { ...caseSettings, enabled: !caseSettings.enabled }; },
  restoreProfiles: () => { style = { ...originalStyle }; caseSettings = { ...originalCase }; },
  applyButtonState: () => ({
    hidden: host.querySelector("[data-quality-detection-apply]")?.hidden ?? true,
    text: host.querySelector("[data-quality-detection-apply]")?.textContent ?? "",
  }),
  ui: () => ({
    hostMounted: Boolean(host.querySelector(".quality-detection")),
    startDisabled: host.querySelector("[data-quality-detection-start]")?.disabled ?? false,
    applyHidden: host.querySelector("[data-quality-detection-apply]")?.hidden ?? true,
    resultHidden: host.querySelector("[data-quality-detection-results]")?.hidden ?? true,
    overlay: Boolean(document.querySelector(".quality-benchmark-overlay")),
    iframe: Boolean(document.querySelector(".quality-benchmark-overlay iframe")),
    status: host.querySelector("[data-quality-detection-status]")?.textContent ?? "",
    resultText: host.querySelector("[data-quality-detection-results]")?.textContent ?? "",
  }),
  parentShortcutCount: () => parentShortcutCount,
  seedParentStorage: (localKey, sessionKey, value) => {
    localStorage.setItem(localKey, value);
    sessionStorage.setItem(sessionKey, value);
    return { local: localStorage.getItem(localKey), session: sessionStorage.getItem(sessionKey) };
  },
  readParentStorage: (localKey, sessionKey) => ({ local: localStorage.getItem(localKey), session: sessionStorage.getItem(sessionKey) }),
  clearParentStorage: (localKey, sessionKey) => { localStorage.removeItem(localKey); sessionStorage.removeItem(sessionKey); },
  presetNames: () => [...presets],
};
mount();
`;

const hostBuild = await build({
  stdin: { contents: hostFixture, resolveDir: project, sourcefile: "quality-benchmark-host.ts", loader: "ts" },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  define: { "import.meta.env.BASE_URL": JSON.stringify("/") },
  logLevel: "warning",
});
const hostBundle = hostBuild.outputFiles.find(file => file.path.endsWith(".js"))?.text ?? hostBuild.outputFiles[0]?.text;
assert.ok(hostBundle, `The offline host fixture must bundle with the existing esbuild installation; outputs=${JSON.stringify(hostBuild.outputFiles.map(file => file.path))}`);

const runnerHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Quality benchmark acceptance fixture</title><style>
html,body{box-sizing:border-box;margin:0;min-height:100%;background:#101820;color:#e8edf1;font:14px system-ui,sans-serif}
body{padding:28px}main{max-width:1080px;margin:0 auto}h1{font-size:20px;font-weight:600}#fixture-state{margin:12px 0;color:#aec1ce;font:12px ui-monospace,monospace}
</style></head><body><main><h1>Offline quality benchmark acceptance fixture</h1><div id="fixture-state">Synthetic parent state · no audio · no personal library</div><div id="quality-host"></div></main><script type="module" src="${fixturePort}"></script></body></html>`;

const blockedRequests = [];
const servedRequests = [];
const allowedExtensions = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ico", ".woff", ".woff2", ".ttf", ".glb", ".gltf", ".bin", ".wasm"]);
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".avif": "image/avif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream", ".wasm": "application/wasm",
};
const isBlockedPath = pathname => /^\/(?:api|audio)(?:\/|$)/i.test(pathname) ||
  /\.(?:mp3|m4a|aac|flac|wav|aiff|dsf|dff|ogg|opus)(?:$|\/)/i.test(pathname);

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method !== "GET" && request.method !== "HEAD") {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(405).end();
    return;
  }
  if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
  if (isBlockedPath(url.pathname)) {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(403, { "cache-control": "no-store" }).end("API and audio routes are blocked in this fixture.");
    return;
  }
  if (url.pathname === runnerPath) {
    servedRequests.push(url.pathname);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(runnerHtml);
    return;
  }
  if (url.pathname === fixturePort) {
    servedRequests.push(url.pathname);
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(hostBundle);
    return;
  }
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(400).end();
    return;
  }
  const relative = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(compiledRoot, relative);
  if (filePath !== compiledRoot && !filePath.startsWith(compiledRoot + path.sep)) {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(403).end();
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(403).end("Static file type is not whitelisted.");
    return;
  }
  try {
    const bytes = await readFile(filePath);
    servedRequests.push(url.pathname);
    response.writeHead(200, {
      "content-type": mimeTypes[extension] ?? "application/octet-stream",
      "content-length": bytes.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch {
    blockedRequests.push(`${request.method} ${url.pathname}`);
    response.writeHead(404, { "cache-control": "no-store" }).end("Only built static benchmark files are served.");
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}`;
const staticOrigin = new URL(baseUrl).origin;

let browser;
let socket;
let browserErrors = "";
let sequence = 0;
const pending = new Map();
const runtimeErrors = [];
const consoleErrors = [];
const externalRequests = [];
const pageRequests = [];

function receive(event) {
  const message = JSON.parse(event.data);
  if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails?.text ?? "Browser runtime exception");
  if (message.method === "Runtime.consoleAPICalled") {
    const entry = {
      type: message.params.type,
      text: message.params.args.map(argument => argument.value ?? argument.description ?? "").join(" "),
    };
    if (entry.type === "error") consoleErrors.push(entry);
  }
  if (message.method === "Network.requestWillBeSent") {
    const url = message.params.request.url;
    pageRequests.push(url);
    if (/^https?:/i.test(url) && new URL(url).origin !== staticOrigin) externalRequests.push(url);
  }
  if (!message.id || !pending.has(message.id)) return;
  const entry = pending.get(message.id);
  pending.delete(message.id);
  clearTimeout(entry.timer);
  message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
}

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitFor(evaluate, expression, description, timeout = 240000, interval = 200) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await evaluate(expression).catch(() => undefined);
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

const audioGuard = `(() => {
  const calls = [];
  Object.defineProperty(window, "__qualityBenchmarkAudioApiCalls", { configurable: false, value: calls });
  for (const name of ["AudioContext", "webkitAudioContext", "OfflineAudioContext", "webkitOfflineAudioContext", "Audio"]) {
    const descriptor = Object.getOwnPropertyDescriptor(window, name);
    if (!descriptor || !descriptor.configurable || !("value" in descriptor) || typeof descriptor.value !== "function") continue;
    const original = descriptor.value;
    const wrapped = new Proxy(original, { construct(target, args, newTarget) {
      calls.push(name + ".construct");
      throw new Error("Audio API use is forbidden in the offline quality benchmark fixture.");
    }, apply(target, thisArg, args) {
      calls.push(name + ".call");
      throw new Error("Audio API use is forbidden in the offline quality benchmark fixture.");
    }});
    Object.defineProperty(window, name, { ...descriptor, value: wrapped });
  }
  if (window.HTMLMediaElement) {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function() {
      calls.push("HTMLMediaElement.play");
      return Promise.reject(new Error("Audio playback is forbidden in the offline fixture."));
    };
  }
  const media = navigator.mediaDevices;
  if (media) for (const name of ["getUserMedia", "enumerateDevices"]) {
    if (typeof media[name] !== "function") continue;
    try { Object.defineProperty(media, name, { configurable: true, value() {
      calls.push("mediaDevices." + name);
      return Promise.reject(new Error("Audio device access is forbidden in the offline fixture."));
    }}); } catch {}
  }
})();`;

async function main() {
  let browserExecutable;
  for (const candidate of browserCandidates) {
    if (await access(candidate).then(() => true, () => false)) { browserExecutable = candidate; break; }
  }
  assert.ok(browserExecutable, "An already-installed Chrome or Edge is required; this check never downloads a browser.");

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
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  browser.stderr.on("data", chunk => { browserErrors = (browserErrors + chunk.toString()).slice(-6000); });

  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await stat(portFile).then(() => true, () => false)) break;
    if (browser.exitCode !== null) throw new Error(`Browser exited before CDP became ready: ${browserErrors}`);
    await sleep(100);
  }
  const [debugPort, endpoint] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${debugPort}${endpoint}`);
  socket.addEventListener("message", receive);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const command = (method, params = {}) => send(method, params, sessionId);
  await command("Runtime.enable");
  await command("Log.enable");
  await command("Page.enable");
  await command("Network.enable");
  await command("Page.addScriptToEvaluateOnNewDocument", { source: audioGuard });
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async expression => {
    const response = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    return response.result?.value;
  };
  const pressKey = async (key, code, windowsVirtualKeyCode, text) => {
    await command("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, ...(text ? { text } : {}) });
    await command("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
  };
  await command("Page.navigate", { url: `${baseUrl}${runnerPath}` });
  await waitFor(evaluate, "document.readyState === 'complete' && !!window.__qualityBenchmarkHarness", "host fixture module");

  const localKey = `__quality_benchmark_test_local_${runId}`;
  const sessionKey = `__quality_benchmark_test_session_${runId}`;
  const sentinelValue = `fixture-${runId}`;
  const seed = await evaluate(`window.__qualityBenchmarkHarness.seedParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)}, ${JSON.stringify(sentinelValue)})`);
  assert.deepEqual(seed, { local: sentinelValue, session: sentinelValue }, "Only test-only sentinel keys may be written in the isolated browser profile.");
  const parentStateBefore = await evaluate("window.__qualityBenchmarkHarness.snapshot()");
  const profilesBefore = await evaluate("window.__qualityBenchmarkHarness.sceneProfiles()");
  assert.equal(parentStateBefore.mode, "detail");
  assert.equal(parentStateBefore.view.layout, "grid");
  assert.equal(parentStateBefore.selectedAlbumId, "host-synthetic-album-002");
  assert.equal(parentStateBefore.selectedIndex, 1);
  assert.equal(parentStateBefore.selectedTrackId, "host-synthetic-album-002-track-2");
  assert.equal(parentStateBefore.catalogFocus.entryKey,
    parentStateBefore.entries.find(entry => entry.trackId === "host-synthetic-album-002-track-2")?.key);
  assert.equal(profilesBefore.style.design, "rhine");
  assert.equal(profilesBefore.caseSettings.structure, "minimal");

  await evaluate("window.__qualityBenchmarkHarness.start()");
  await waitFor(evaluate, "!!document.querySelector('.quality-benchmark-overlay iframe')", "first production benchmark iframe", 30000);
  await waitFor(evaluate, "window.__qualityBenchmarkHarness.messages().some(message => message.type === 'ready')", "production iframe ready handshake", 30000);
  const iframeReady = await evaluate(`(() => {
    const frame = document.querySelector('.quality-benchmark-overlay iframe');
    const stage = frame?.contentWindow?.document.querySelector('#benchmark-scene');
    const glCanvas = stage?.querySelector('canvas');
    let glVersion = null;
    try { const gl = glCanvas?.getContext('webgl2') ?? glCanvas?.getContext('webgl'); glVersion = gl?.getParameter(gl.VERSION) ?? null; } catch {}
    const local = frame?.contentWindow?.localStorage;
    const session = frame?.contentWindow?.sessionStorage;
    let localWriteBlocked = false, sessionWriteBlocked = false;
    try { local?.setItem('__quality_benchmark_probe__', 'probe'); } catch { localWriteBlocked = true; }
    try { session?.setItem('__quality_benchmark_probe__', 'probe'); } catch { sessionWriteBlocked = true; }
    return {
      src: frame?.src ?? null,
      localLength: local?.length ?? -1, sessionLength: session?.length ?? -1,
      localWriteBlocked, sessionWriteBlocked, renderBackend: stage?.dataset.renderBackend ?? null,
      canvasPresent: Boolean(glCanvas), glVersion, dpr: frame?.contentWindow?.devicePixelRatio ?? -1,
    };
  })()`);
  assert.ok(iframeReady.src?.includes("quality-benchmark.html?run="), "The production benchmark entry must be loaded from the built interface.");
  assert.equal(iframeReady.localLength, 0, "The benchmark iframe localStorage shim must begin empty.");
  assert.equal(iframeReady.sessionLength, 0, "The benchmark iframe sessionStorage shim must begin empty.");
  assert.ok(iframeReady.localWriteBlocked && iframeReady.sessionWriteBlocked, "Benchmark storage shims must reject writes.");

  const forged = await evaluate("window.__qualityBenchmarkHarness.injectInvalidMessages()");
  assert.equal(forged.tokenLength, 48, "The production run token must be 192-bit hex.");
  await sleep(100);
  const afterForged = await evaluate("window.__qualityBenchmarkHarness.ui()");
  assert.ok(afterForged.overlay && afterForged.iframe && afterForged.startDisabled,
    "Wrong-source and wrong-token result messages must not complete a live benchmark.");

  await evaluate("window.__qualityBenchmarkHarness.cancel()");
  await waitFor(evaluate, "!document.querySelector('.quality-benchmark-overlay')", "cancel cleanup", 10000);
  const afterCancel = await evaluate(`({
    ui: window.__qualityBenchmarkHarness.ui(),
    applyCount: window.__qualityBenchmarkHarness.sceneProfiles().applyCount,
    state: window.__qualityBenchmarkHarness.snapshot(),
    storage: window.__qualityBenchmarkHarness.readParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)}),
  })`);
  assert.equal(afterCancel.ui.startDisabled, false, "Cancel must re-enable production Start.");
  assert.equal(afterCancel.applyCount, 0, "Cancel must not apply a quality preset.");
  assert.deepEqual(afterCancel.state, parentStateBefore, "Cancel must preserve the synthetic parent catalog and player state.");
  assert.deepEqual(afterCancel.storage, { local: sentinelValue, session: sentinelValue }, "The iframe must not change parent test-only storage sentinels.");

  // Start again and leave the mounted view while work is active; production cleanup must remove the frame and overlay.
  await evaluate("window.__qualityBenchmarkHarness.start()");
  await waitFor(evaluate, "!!document.querySelector('.quality-benchmark-overlay iframe')", "restart iframe", 30000);
  await waitFor(evaluate, "window.__qualityBenchmarkHarness.messages().filter(message => message.type === 'ready').length >= 2", "restart handshake", 30000);
  await evaluate("window.__qualityBenchmarkHarness.unmount()");
  await waitFor(evaluate, "!document.querySelector('.quality-benchmark-overlay') && !document.querySelector('#quality-host .quality-detection')", "active unmount cleanup", 10000);
  const afterUnmount = await evaluate(`({
    profiles: window.__qualityBenchmarkHarness.sceneProfiles(),
    state: window.__qualityBenchmarkHarness.snapshot(),
    storage: window.__qualityBenchmarkHarness.readParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)}),
  })`);
  assert.equal(afterUnmount.profiles.applyCount, 0, "Unmounting an active benchmark must never apply a preset.");
  assert.deepEqual(afterUnmount.state, parentStateBefore, "Unmounting must preserve selected album, non-first track, open mode and view.");
  assert.deepEqual(afterUnmount.storage, { local: sentinelValue, session: sentinelValue }, "Unmounting must preserve test-only parent storage sentinels.");
  await evaluate("window.__qualityBenchmarkHarness.mount()");

  async function runFullBenchmark(runIndex) {
    const handshakesBefore = await evaluate("window.__qualityBenchmarkHarness.messages().filter(message => message.type === 'ready').length");
    await evaluate("window.__qualityBenchmarkHarness.start()");
    await waitFor(evaluate,
      `window.__qualityBenchmarkHarness.messages().some(message => message.type === 'ready') && window.__qualityBenchmarkHarness.messages().filter(message => message.type === 'ready').length > ${handshakesBefore}`,
      `full benchmark ${runIndex} ready handshake`, 30000);
    await waitFor(evaluate, `(() => {
      const frame = document.querySelector('.quality-benchmark-overlay iframe');
      const stage = frame?.contentWindow?.document.querySelector('#benchmark-scene');
      const canvas = stage?.querySelector('canvas');
      try {
        const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
        return stage?.dataset.renderBackend === 'three-webgl' && gl && !gl.isContextLost();
      } catch { return false; }
    })()`, `full benchmark ${runIndex} live WebGL scene`, 60000);
    const activeFrame = await evaluate(`(() => {
      const frame = document.querySelector('.quality-benchmark-overlay iframe');
      const stage = frame?.contentWindow?.document.querySelector('#benchmark-scene');
      const canvas = stage?.querySelector('canvas');
      let glVersion = null;
      try { const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl'); glVersion = gl?.getParameter(gl.VERSION) ?? null; } catch {}
      return { width: frame?.contentWindow?.innerWidth ?? 0, height: frame?.contentWindow?.innerHeight ?? 0,
        dpr: frame?.contentWindow?.devicePixelRatio ?? 0, backend: stage?.dataset.renderBackend ?? null,
        canvas: Boolean(canvas), glVersion };
    })()`);
    assert.deepEqual({ width: activeFrame.width, height: activeFrame.height, dpr: activeFrame.dpr },
      { width: benchmarkSize.width, height: benchmarkSize.height, dpr: 1 }, "The Future minimal benchmark must run at exactly 960×540, DPR 1.");
    assert.equal(activeFrame.backend, "three-webgl");
    assert.ok(activeFrame.canvas && activeFrame.glVersion?.includes("WebGL"), "The benchmark must use a live WebGL renderer.");
    const activeToken = await waitFor(evaluate, "window.__qualityBenchmarkHarness.activeRunToken()", `full benchmark ${runIndex} run token`, 30000);
    assert.match(activeToken, /^[0-9a-f]{48}$/i, "Every detection run must use its own 192-bit token.");
    const completionExpression = `(() => {
      const message = window.__qualityBenchmarkHarness.lastMessage();
      const results = document.querySelector('[data-quality-detection-results]');
      return message?.token === ${JSON.stringify(activeToken)} &&
        (message.type === 'error' || (message.type === 'result' && results && !results.hidden && !document.querySelector('.quality-benchmark-overlay')));
    })()`;
    await waitFor(evaluate, completionExpression, `full benchmark ${runIndex} production result UI`, 210000, 500);
    const last = await evaluate(`({
      message: window.__qualityBenchmarkHarness.lastMessage(),
      frameStorage: window.__qualityBenchmarkHarness.frameStorage(),
      ui: window.__qualityBenchmarkHarness.ui(),
      profiles: window.__qualityBenchmarkHarness.sceneProfiles(),
      state: window.__qualityBenchmarkHarness.snapshot(),
      parentStorage: window.__qualityBenchmarkHarness.readParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)}),
    })`);
    assert.equal(last.message?.type, "result", `Full benchmark ${runIndex} should complete, received ${last.message?.type}: ${last.message?.error ?? ""}`);
    const result = last.message.result;
    const presets = await evaluate("window.__qualityBenchmarkHarness.presetNames()");
    assert.equal(result.effectiveLayout, "shelf");
    assert.equal(result.renderBackend, "three-webgl");
    assert.equal(result.measurements.length, presets.length, "Every production quality preset must be measured exactly once.");
    assert.deepEqual(result.measurements.map(item => item.preset).sort(), [...presets].sort(), "Result presets must be unique and complete.");
    for (const preset of result.measurements) {
      assert.equal(preset.scenarios.length, 2, `${preset.preset} must include shelf and case scenarios.`);
      assert.deepEqual([...preset.scenarios.map(item => item.scenario)].sort(), ["case", "shelf"]);
      for (const metric of preset.scenarios) {
        assert.ok(Number.isFinite(metric.fps) && metric.fps >= 0, "FPS metric must be finite and nonnegative.");
        assert.ok(Number.isFinite(metric.p95FrameMs) && metric.p95FrameMs >= 0, "P95 frame time must be finite and nonnegative.");
        assert.ok(Number.isFinite(metric.slowFramePercent) && metric.slowFramePercent >= 0 && metric.slowFramePercent <= 100,
          "Slow-frame percentage must be within [0, 100].");
        assert.ok(Number.isInteger(metric.samples) && metric.samples > 0, "Each scenario must contain at least one measured frame.");
      }
    }
    assert.equal(last.ui.applyHidden, result.recommendation === null, "Adopt button visibility must match recommendation availability.");
    assert.equal(last.profiles.applyCount, 0, "Detection must not call apply before the user clicks Adopt.");
    assert.deepEqual(last.state, parentStateBefore, "The real benchmark must preserve parent catalog, selected non-first track, detail mode, query and view.");
    assert.deepEqual(last.parentStorage, { local: sentinelValue, session: sentinelValue }, "The benchmark iframe must not alter parent test sentinels.");
    assert.deepEqual(last.frameStorage, { localLength: 0, sessionLength: 0, localWriteBlocked: true, sessionWriteBlocked: true },
      "The completed benchmark iframe must use empty read-only storage.");
    assert.equal(last.message.frameState?.renderBackend, "three-webgl", "The benchmark frame must report the production WebGL backend.");
    assert.equal(last.message.frameState?.devicePixelRatio, 1);
    assert.deepEqual(last.message.frameState?.audioCalls ?? [], [], "No audio API may be used in the benchmark frame.");
    await writeFile(path.join(output, `quality-benchmark-${runIndex}-result.png`),
      Buffer.from((await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
    return { result, profiles: last.profiles, state: last.state, recommendation: result.recommendation, ui: last.ui };
  }

  let firstFullRun = await runFullBenchmark(1);
  let applyGuardResult = "no recommendation; apply guard is inapplicable";
  let adoptionRun = firstFullRun;
  if (firstFullRun.recommendation) {
    await evaluate("window.__qualityBenchmarkHarness.mutateCaseProfile()");
    await evaluate("document.querySelector('[data-quality-detection-apply]')?.click()");
    await sleep(150);
    const guarded = await evaluate("window.__qualityBenchmarkHarness.sceneProfiles()");
    assert.equal(guarded.applyCount, 0, "A result from a changed case profile must not be applied.");
    applyGuardResult = "stale recommendation rejected after case profile changed";
    await evaluate("window.__qualityBenchmarkHarness.restoreProfiles()");
    adoptionRun = await runFullBenchmark(2);
  }

  let adoption = { tested: false, recommendation: adoptionRun.recommendation, applyCount: 0 };
  if (adoptionRun.recommendation) {
    await evaluate("document.querySelector('[data-quality-detection-apply]')?.click()");
    const afterApply = await evaluate("window.__qualityBenchmarkHarness.sceneProfiles()");
    assert.equal(afterApply.applyCount, 1, "A user click on a valid recommendation must call apply exactly once.");
    assert.deepEqual(afterApply.appliedQuality, await evaluate(`window.__qualityBenchmarkHarness.presetNames().includes(${JSON.stringify(adoptionRun.recommendation)}) ?
      window.__qualityBenchmarkHarness.sceneProfiles().appliedQuality : null`));
    assert.deepEqual(afterApply.style, profilesBefore.style, "Applying a quality recommendation must not change the theme/style profile.");
    assert.deepEqual(afterApply.caseSettings, profilesBefore.caseSettings, "Applying a quality recommendation must not change the case profile.");
    adoption = { tested: true, recommendation: adoptionRun.recommendation, applyCount: afterApply.applyCount };
  }

  // Leaving and remounting the real component must release its previous state; active overlay keys stay scoped.
  const applyCountBeforeKeys = await evaluate("window.__qualityBenchmarkHarness.sceneProfiles().applyCount");
  await evaluate("window.__qualityBenchmarkHarness.unmount()");
  await evaluate("window.__qualityBenchmarkHarness.mount()");
  const readyCountBeforeKeys = await evaluate("window.__qualityBenchmarkHarness.messages().filter(message => message.type === 'ready').length");
  await evaluate("window.__qualityBenchmarkHarness.start()");
  await waitFor(evaluate, "!!document.querySelector('.quality-benchmark-overlay iframe')", "keyboard cleanup iframe", 30000);
  await waitFor(evaluate,
    `window.__qualityBenchmarkHarness.messages().filter(message => message.type === 'ready').length > ${readyCountBeforeKeys}`,
    "keyboard cleanup handshake", 30000);
  const cancelFocusedAtStart = await evaluate("document.activeElement === document.querySelector('.quality-benchmark-overlay button')");
  assert.equal(cancelFocusedAtStart, true, "Opening the overlay must focus its Cancel control.");
  const parentHotkeysBefore = await evaluate("window.__qualityBenchmarkHarness.parentShortcutCount()");
  await pressKey("t", "KeyT", 84, "t");
  const afterT = await evaluate(`({
    hotkeys: window.__qualityBenchmarkHarness.parentShortcutCount(),
    overlay: Boolean(document.querySelector('.quality-benchmark-overlay')),
  })`);
  assert.equal(afterT.hotkeys, parentHotkeysBefore, "T must not reach the parent application's document key handler.");
  assert.equal(afterT.overlay, true, "T must leave the quality overlay active.");
  await pressKey("Tab", "Tab", 9);
  const tabFocusedCancel = await evaluate("document.activeElement === document.querySelector('.quality-benchmark-overlay button')");
  assert.equal(tabFocusedCancel, true, "Tab inside the modal must keep focus on Cancel.");
  await pressKey("Escape", "Escape", 27);
  await waitFor(evaluate, "!document.querySelector('.quality-benchmark-overlay')", "Escape cancellation", 10000);
  const applyCountAfterEscape = await evaluate("window.__qualityBenchmarkHarness.sceneProfiles().applyCount");
  assert.equal(applyCountAfterEscape, applyCountBeforeKeys, "Escape must cancel without applying a quality preset.");
  const keyboardBoundary = { tDidNotReachParent: true, tabFocusedCancel, escapeCancelled: true };

  const harnessMessages = await evaluate("window.__qualityBenchmarkHarness.messages()");
  const parentStorageAfter = await evaluate(`window.__qualityBenchmarkHarness.readParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)})`);
  assert.deepEqual(parentStorageAfter, { local: sentinelValue, session: sentinelValue }, "Parent test-only storage sentinels must remain unchanged.");
  const audioCalls = await evaluate(`({
    parent: window.__qualityBenchmarkAudioApiCalls ?? [],
    frame: window.__qualityBenchmarkHarness.lastMessage()?.frameState?.audioCalls ?? [],
  })`);
  assert.deepEqual(audioCalls.parent, [], "The host fixture must not call audio APIs.");
  assert.deepEqual(audioCalls.frame, [], "The benchmark frame must not call audio APIs.");
  assert.deepEqual(externalRequests, [], "The browser must not request external sites.");
  assert.deepEqual(blockedRequests, [], "The offline server must not receive API, audio, traversal, or non-whitelisted requests.");
  assert.ok(servedRequests.includes("/quality-benchmark.html"), "The test must load the root-built benchmark entry.");
  assert.ok(servedRequests.includes(fixturePort), "The production mountQualityDetection host fixture must be served locally.");
  assert.deepEqual(runtimeErrors, [], "Browser runtime exceptions must be absent.");
  assert.deepEqual(consoleErrors, [], "Browser console errors must be absent.");

  const report = {
    status: "passed",
    browserExecutable,
    profile,
    staticRoot: compiledRoot,
    parentViewport: { width: 1280, height: 900, dpr: 1 },
    benchmarkViewport: benchmarkSize,
    syntheticParent: parentStateBefore,
    presets: await evaluate("window.__qualityBenchmarkHarness.presetNames()"),
    result: firstFullRun.result,
    recommendation: firstFullRun.recommendation,
    caseChangeApplyGuard: applyGuardResult,
    adoption,
    keyboardBoundary,
    parentStorageAfter,
    iframeStorageAfter: await evaluate("window.__qualityBenchmarkHarness.frameStorage()"),
    audioCalls,
    messages: harnessMessages.map(({ token: _token, ...message }) => message),
    servedRequests: [...new Set(servedRequests)].sort(),
    externalRequests,
    blockedRequests,
    consoleErrors,
    runtimeErrors,
  };
  await writeFile(path.join(output, "acceptance.json"), JSON.stringify(report, null, 2));
  console.log(`Quality benchmark browser acceptance passed: ${path.join(output, "acceptance.json")}`);
  console.log(`Recommendation: ${report.recommendation ?? "none; this Chrome run did not meet the stable 60 FPS recommendation threshold"}`);
  console.log(`Apply path: ${adoption.tested ? "user-clicked once" : "not available without a recommendation"}; case/style profiles unchanged.`);
  console.log(`Static-only requests: ${new Set(servedRequests).size}; external/API/audio requests: 0.`);
  await evaluate(`window.__qualityBenchmarkHarness.unmount()`);
  await evaluate(`window.__qualityBenchmarkHarness.clearParentStorage(${JSON.stringify(localKey)}, ${JSON.stringify(sessionKey)})`);
}

try {
  await main();
} catch (error) {
  await writeFile(path.join(output, "failure.json"), JSON.stringify({
    status: "failed",
    error: error instanceof Error ? error.stack ?? error.message : String(error),
    browserErrors,
    servedRequests,
    blockedRequests,
    externalRequests,
    consoleErrors,
    runtimeErrors,
    profile,
  }, null, 2)).catch(() => {});
  throw error;
} finally {
  try { socket?.close(); } catch {}
  if (browser && browser.exitCode === null) {
    try { browser.kill(); } catch {}
  }
  await new Promise(resolve => server.close(() => resolve(undefined))).catch(() => {});
}
