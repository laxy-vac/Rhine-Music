import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { build, preview } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = path.join(projectRoot, '.tools', 'source-preview-electron', 'electron.exe');
const desktopEntry = path.join(projectRoot, 'desktop', 'lyrics-page-check.cjs');
const artifactRoot = path.join(projectRoot, '.tools', 'future-lyrics');
const cacheDirectory = path.join(artifactRoot, 'vite-cache');
const runDirectory = path.join(artifactRoot, 'run-' + Date.now() + '-' + randomUUID().slice(0, 8));
const bundleRoot = path.join(runDirectory, 'vite-harness');
const bundleDirectory = path.join(bundleRoot, 'dist');
const bundleHtmlPath = path.join(bundleDirectory, 'index.html');
const profileDirectory = path.join(runDirectory, 'electron-profile');
const electronAppDirectory = path.join(runDirectory, 'electron-app');
const reportPath = path.join(runDirectory, 'report.json');

const sources = [
  { id: 'qq', name: 'QQ音乐', builtin: true, enabled: true },
  { id: 'netease', name: '网易云音乐', builtin: true, enabled: true },
];
const savedLyrics = new Map();
const preferences = new Map();
const requests = [];
const resolveResponses = [];
const metadataAvailability = new Map();
let stopping = false;
let bundledHtmlResponse = '';

function respondJson(response, payload, status = 200) {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function preferenceFor(trackId) {
  const saved = preferences.get(trackId) ?? { sourceId: null };
  return {
    trackId,
    sourceId: saved.sourceId,
    effectiveSourceId: saved.sourceId ?? 'qq',
    defaultSourceId: 'qq',
    sources,
  };
}

function lrcDocument(trackId) {
  const offsetTrack = trackId === 'synthetic-offset-track';
  const firstLines = trackId === 'synthetic-track'
    ? ['第一句合成歌词', '第二句合成歌词']
    : [`自动解析结果 ${trackId}`, '第二句合成歌词'];
  const timedLines = Array.from({ length: 20 }, (_, index) => `[${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60 + 1).padStart(2, '0')}.00]${firstLines[index] ?? `合成歌词第 ${index + 1} 行`}`);
  return {
    version: 2,
    trackId,
    lrc: offsetTrack ? '[offset:100]\n[00:02.00]偏移验证\n[00:04.00]第二句偏移验证' : timedLines.join('\n'),
    translation: '',
    offsetMs: offsetTrack ? 500 : 0,
    offsetInText: true,
    source: { id: 'qq', name: 'QQ音乐' },
    savedAt: new Date().toISOString(),
  };
}

function selectedLyricDocument(trackId) {
  const document = lrcDocument(trackId);
  if (trackId === 'synthetic-track') return document;
  return {
    ...document,
    lrc: Array.from({ length: 20 }, (_, index) => `[00:${String(index + 1).padStart(2, '0')}.00]${index === 0 ? `手动选择结果 ${trackId}` : index === 1 ? '第二句手动候选歌词' : `手动候选第 ${index + 1} 行`}`).join('\n'),
  };
}

const productionStylesheets = [
  '/node_modules/@kitlangton/rolling-number/dist/styles.css',
  '/src/style.css', '/src/quality-settings.css', '/src/document-decryption.css', '/src/decryption.css',
  '/src/music.css', '/src/music-settings-page.css', '/src/settings-select-controls.css',
  '/src/music-library-page.css', '/src/music-eq-page.css', '/src/lyrics-page.css', '/src/signal-page.css',
  '/src/lyrics-settings.css', '/src/music-navigation-motion.css', '/src/music-navigation-ruler.css',
  '/src/music-transport-title.css', '/src/music-theme.css', '/src/music-theme-switch.css', '/src/music-style-page.css',
  '/src/music-view-controls.css', '/src/music-catalog-grid.css', '/src/music-touch.css', '/src/sony-tech-indicators.css',
  '/src/hi-res.css', '/src/music-playback.css', '/src/audio-info.css', '/src/eq-controls.css', '/src/editable-range-controls.css',
  '/src/music-design-fonts.css', '/src/music-design.css', '/src/foobar-pages.css', '/src/foobar-style.css', '/src/foobar-shell.css',
  '/src/punk-eq.css', '/src/punk-lyrics.css', '/src/punk-signal.css', '/src/album-panel.css', '/src/window-aspect.css',
  '/src/future-design.css', '/src/future-lyrics.css', '/src/future-eq.css', '/src/future-signal.css', '/src/future-transitions.css',
  '/src/case-editor.css', '/src/terminal-lighting.css',
];
const stylesheetLinks = productionStylesheets.map(href => `<link rel="stylesheet" href="${href}">`).join('\n');
const stylesheetImports = productionStylesheets.map(href => href.startsWith('/node_modules/')
  ? 'import "@kitlangton/rolling-number/styles.css";'
  : `import ${JSON.stringify(href)};`).join('\n');

const harnessHtml = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Lyrics page isolated check</title>',
  stylesheetLinks,
  '<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}*{box-sizing:border-box}body{font-family:system-ui,"Microsoft YaHei",sans-serif}#stage{position:relative;width:100vw;height:100vh;overflow:hidden}</style>',
  '</head><body>',
  '<div id="stage" class="music-app" data-design="rhine" data-page="lyrics" data-theme="day" data-layout="desktop">',
  '<main id="music-lyrics-page" class="music-settings-page music-lyrics-page">',
  '<header class="settings-page-heading"><div><small>03 / MUSIC ARCHIVE</small><h1>歌词</h1><p>同步文本与播放信息</p></div></header>',
  '<section id="lyrics-page-content" class="settings-page-content"></section>',
  '</main></div>',
  '<script type="module">',
  'import { setupTerminalLighting } from "/src/terminal-lighting.ts";',
  'import { enhanceSettingsSelectControls } from "/src/settings-select-controls.ts";',
  'import { qualityPresets } from "/src/render-quality.ts";',
  'import { setupLyricsPage } from "/src/lyrics-page.ts";',
  'const track = { id:"synthetic-track", title:"合成歌曲", artist:"测试歌手", album:"测试专辑", duration:180, codec:"FLAC", format:"FLAC", sampleRate:44100, bitsPerSample:16, numberOfChannels:2, bitrate:0, lossless:true };',
  'let state = { currentTrack:track, queue:[track], currentIndex:0, playbackOrder:"default", playing:false, transport:"paused", currentTime:0.5, duration:180, backend:"browser", nativeOutputStatus:undefined, error:"" };',
  'const album = { title:"测试专辑", artist:"测试歌手", year:"2026" };',
  'window.__lyricsCheckSeek = [];',
  'const terminalLighting = setupTerminalLighting(document.querySelector("#stage"));',
  'terminalLighting.setQuality(qualityPresets.original);',
  'window.__lyricsCheckTerminalLighting = terminalLighting;',
  'window.__lyricsCheckSetTerminalFull = () => terminalLighting.setQuality(qualityPresets.ultra);',
  'window.__lyricsCheckSetTerminalLocal = () => terminalLighting.setQuality(qualityPresets.original);',
  'const controller = setupLyricsPage(document.querySelector("#lyrics-page-content"), { seek:(position)=>window.__lyricsCheckSeek.push(position), spectrum:()=>({available:true,bands:Array.from({length:32},(_,i)=>0.25+((i*13)%55)/100),sampleRate:44100,updatedAt:Date.now()}), notify:()=>{}, openSettings:()=>{} });',
  'let settingsSelectControls;',
  'const syncSettingsSelectControls = () => settingsSelectControls?.sync();',
  'controller.update(state, album);',
  'window.__lyricsCheckSetUnknownTrack = async (id) => { await fetch("/__lyrics-check/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trackId:id,available:false})}); const nextTrack = { ...track, id, title:"", artist:"", album:"", duration:0 }; state = { ...state, currentTrack:nextTrack, queue:[nextTrack], currentIndex:0, currentTime:0.5 }; controller.update(state, undefined); syncSettingsSelectControls(); return id; };',
  'window.__lyricsCheckSetKnownTrack = async (id) => { await fetch("/__lyrics-check/metadata",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trackId:id,available:true})}); const nextTrack = { ...track, id, title:"合成歌曲 " + id }; state = { ...state, currentTrack:nextTrack, queue:[nextTrack], currentIndex:0, currentTime:0.5 }; controller.update(state, album); syncSettingsSelectControls(); return id; };',
  'window.__lyricsCheckSetTrack = (id) => { const nextTrack = { ...track, id, title:"合成歌曲 " + id }; state = { ...state, currentTrack:nextTrack, queue:[nextTrack], currentIndex:0, currentTime:0.5 }; controller.update(state, album); syncSettingsSelectControls(); return id; };',
  'window.__lyricsCheckRepeatUpdate = () => { state = { ...state, currentTime:state.currentTime + 0.01 }; controller.update(state, album); syncSettingsSelectControls(); return state.currentTrack.id; };',
  'window.__lyricsCheckSetCurrentTime = (value) => { state = { ...state, currentTime:value }; controller.update(state, album); syncSettingsSelectControls(); return value; };',
  'window.__lyricsCheckSetVisible = (visible) => { const stage=document.querySelector("#stage"), page=document.querySelector("#music-lyrics-page"), host=document.querySelector("#lyrics-page-content"); stage.dataset.page = visible ? "lyrics" : "music"; page.hidden = !visible; page.inert = !visible; controller.setVisible(visible); if(visible){settingsSelectControls=enhanceSettingsSelectControls(host);settingsSelectControls.sync();}else{settingsSelectControls?.close();settingsSelectControls?.destroy();settingsSelectControls=undefined;} return visible; };',
  'window.__lyricsCheckSyncSelects = syncSettingsSelectControls;',
  'window.__lyricsCheckDestroy = () => { settingsSelectControls?.destroy(); controller.destroy(); terminalLighting.destroy(); };',
  'controller.setVisible(true);',
  'settingsSelectControls = enhanceSettingsSelectControls(document.querySelector("#lyrics-page-content"));',
  'settingsSelectControls.sync();',
  'window.__lyricsCheckReady = true;',
  '</script>',
  '</body></html>',
].join('\n');
const bundledHarnessHtml = harnessHtml
  .replace(stylesheetLinks, '')
  .replace('<script type="module">', '<script type="module">\n' + stylesheetImports);

const mockPlugin = {
  name: 'lyrics-page-local-mock',
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      let url;
      try {
        url = new URL(request.url ?? '/', 'http://127.0.0.1');
      } catch {
        next();
        return;
      }

      if (url.pathname === '/__lyrics_page_check') {
        const address = server.httpServer.address();
        const port = address && typeof address !== 'string' ? address.port : 0;
        response.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:" + port + "; object-src 'none'; base-uri 'none'; frame-src 'none'",
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(bundledHtmlResponse);
        return;
      }

      if (url.pathname === '/__lyrics-check/state') {
        respondJson(response, { requests, resolveResponses, savedTrackIds: Array.from(savedLyrics.keys()) });
        return;
      }

      if (url.pathname === '/__lyrics-check/metadata' && request.method === 'POST') {
        void (async () => {
          try {
            const body = await readJson(request);
            metadataAvailability.set(String(body.trackId ?? ''), body.available === true);
            respondJson(response, { ok: true });
          } catch (error) {
            respondJson(response, { error: String(error?.message ?? error) }, 500);
          }
        })();
        return;
      }

      if (!url.pathname.startsWith('/api/lyrics/')) {
        let filePath;
        try {
          const publicRoot = path.resolve(projectRoot, 'public');
          const decodedPath = decodeURIComponent(url.pathname);
          const candidate = path.resolve(publicRoot, '.' + decodedPath);
          if (candidate.startsWith(publicRoot + path.sep)) filePath = candidate;
        } catch {}
        if (filePath) {
          void readFile(filePath).then(body => {
            const extension = path.extname(filePath).toLowerCase();
            const mime = extension === '.woff2' ? 'font/woff2' : extension === '.woff' ? 'font/woff'
              : extension === '.svg' ? 'image/svg+xml' : extension === '.png' ? 'image/png' : 'application/octet-stream';
            response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
            response.end(body);
          }).catch(() => next());
          return;
        }
        next();
        return;
      }

      void (async () => {
        try {
          const body = request.method === 'POST' ? await readJson(request) : {};
          const entry = { method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body };
          requests.push(entry);

          if (url.pathname === '/api/lyrics/settings' && request.method === 'GET') {
            respondJson(response, {
              settings: { defaultSourceId: 'qq', cacheDirectory: 'synthetic-cache', defaultCacheDirectory: 'synthetic-cache' },
              sources,
            });
            return;
          }

          if (url.pathname === '/api/lyrics/resolve' && request.method === 'POST') {
            const trackId = String(body.trackId ?? '');
            const available = metadataAvailability.get(trackId) ?? true;
            const lyric = savedLyrics.get(trackId) ?? (!available || trackId === 'synthetic-empty-track' ? null : lrcDocument(trackId));
            const waitMs = ['synthetic-slow-track', 'synthetic-pending-track', 'synthetic-import-pending-track', 'synthetic-leave-track'].includes(trackId) ? 450 : 40;
            if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
            resolveResponses.push({ trackId, lyricTrackId: lyric?.trackId ?? null });
            if (response.destroyed || request.aborted) return;
            if (lyric && !savedLyrics.has(trackId)) savedLyrics.set(trackId, lyric);
            respondJson(response, {
              lyric,
              sources: [{ sourceId: 'qq', name: 'QQ音乐', status: lyric ? 'ok' : 'empty', count: lyric ? 1 : 0 }],
            });
            return;
          }

          if (url.pathname === '/api/lyrics/track' && request.method === 'GET') {
            respondJson(response, { lyric: savedLyrics.get(url.searchParams.get('trackId')) ?? null });
            return;
          }

          if (url.pathname === '/api/lyrics/preferences' && request.method === 'GET') {
            respondJson(response, preferenceFor(url.searchParams.get('trackId') ?? ''));
            return;
          }

          if (url.pathname === '/api/lyrics/preferences' && request.method === 'POST') {
            preferences.set(body.trackId, { sourceId: body.sourceId ?? null });
            respondJson(response, preferenceFor(body.trackId));
            return;
          }

          if (url.pathname === '/api/lyrics/search' && request.method === 'POST') {
            await new Promise((resolve) => setTimeout(resolve, 90));
            respondJson(response, {
              sourceName: '多来源',
              candidates: [{
                id: 'synthetic-qq-candidate',
                sourceId: 'qq',
                title: body.query?.title || '合成歌曲',
                artist: body.query?.artist || '测试歌手',
                album: body.query?.album || '测试专辑',
                duration: 180,
                score: 0.99,
              }],
              sources: [
                { sourceId: 'netease', name: '网易云音乐', status: 'error', message: '模拟来源暂时不可用' },
                { sourceId: 'qq', name: 'QQ音乐', status: 'ok', count: 1 },
              ],
            });
            return;
          }

          if (url.pathname === '/api/lyrics/select' && request.method === 'POST') {
            const lyric = selectedLyricDocument(body.trackId);
            savedLyrics.set(body.trackId, lyric);
            respondJson(response, { lyric });
            return;
          }

          if (url.pathname === '/api/lyrics/offset' && request.method === 'POST') {
            const current = savedLyrics.get(body.trackId);
            if (!current) {
              respondJson(response, { error: 'synthetic lyric not found' }, 404);
              return;
            }
            const lyric = { ...current, offsetMs: Number(body.offsetMs) || 0 };
            savedLyrics.set(body.trackId, lyric);
            respondJson(response, { lyric });
            return;
          }

          if (url.pathname === '/api/lyrics/import' && request.method === 'POST') {
            const lyric = { ...lrcDocument(body.trackId), lrc: String(body.lrc ?? ''), source: { id: 'local-import', name: '本地导入' } };
            savedLyrics.set(body.trackId, lyric);
            respondJson(response, { lyric });
            return;
          }

          respondJson(response, { error: 'unexpected synthetic API route' }, 404);
        } catch (error) {
          if (!response.headersSent) respondJson(response, { error: String(error?.message ?? error) }, 500);
          else response.destroy();
        }
      })();
    });
  },
};

let previewServer;
let child;
let requestedPort;
let report = {
  ok: false,
  checks: {},
  viewports: [],
  syntheticDataOnly: true,
  apiFullyMocked: true,
  externalNetworkRequestsMadeByCheck: false,
  browserWindowShown: false,
  cacheDirectory,
  artifactDirectory: runDirectory,
};

try {
  await access(electronPath);
  await access(desktopEntry);
  await access(path.join(projectRoot, 'node_modules', 'vite', 'package.json'));
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(electronAppDirectory, { recursive: true });
  await mkdir(bundleRoot, { recursive: true });
  await writeFile(path.join(bundleRoot, 'index.html'), bundledHarnessHtml, 'utf8');
  const electronMain = path.relative(electronAppDirectory, desktopEntry).split(path.sep).join('/');
  await writeFile(path.join(electronAppDirectory, 'package.json'), JSON.stringify({
    name: 'rhine-lyrics-page-isolated-check',
    version: '1.0.0',
    private: true,
    main: electronMain,
  }, null, 2), 'utf8');

  await build({
    configFile: false,
    root: bundleRoot,
    base: '/',
    publicDir: false,
    cacheDir: path.join(artifactRoot, 'vite-cache'),
    logLevel: 'error',
    resolve: { alias: [
      { find: '/src', replacement: path.join(projectRoot, 'src') },
      { find: '/node_modules', replacement: path.join(projectRoot, 'node_modules') },
    ] },
    build: {
      outDir: bundleDirectory,
      emptyOutDir: true,
      sourcemap: false,
      minify: false,
      rollupOptions: { input: path.join(bundleRoot, 'index.html') },
    },
  });
  bundledHtmlResponse = await readFile(bundleHtmlPath, 'utf8');
  report.bundledHtmlBytes = Buffer.byteLength(bundledHtmlResponse, 'utf8');
  report.bundleRoot = bundleDirectory;

  const portProbe = net.createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  requestedPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));

  previewServer = await preview({
    configFile: false,
    root: bundleRoot,
    base: '/',
    publicDir: false,
    logLevel: 'error',
    plugins: [mockPlugin],
    build: { outDir: bundleDirectory },
    preview: { host: '127.0.0.1', port: requestedPort, strictPort: true, open: false },
  });
  const address = previewServer.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind an ephemeral TCP port.');
  const checkUrl = 'http://127.0.0.1:' + address.port + '/__lyrics_page_check';
  const harnessResponse = await fetch(checkUrl, { signal: AbortSignal.timeout(5000) });
  report.localHarnessHttpStatus = harnessResponse.status;
  const builtHtml = await harnessResponse.text();
  report.localHarnessHtmlBytes = Buffer.byteLength(builtHtml, 'utf8');
  if (!harnessResponse.ok) throw new Error('Local Vite harness returned HTTP ' + harnessResponse.status + '.');
  const assetPaths = Array.from(builtHtml.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g), match => match[1]);
  report.bundledAssetProbes = [];
  for (const assetPath of [...new Set(assetPaths)]) {
    const started = Date.now();
    const response = await fetch(new URL(assetPath, checkUrl), { signal: AbortSignal.timeout(10000) });
    const body = await response.arrayBuffer();
    report.bundledAssetProbes.push({ path: assetPath, status: response.status, contentType: response.headers.get('content-type'), bytes: body.byteLength, elapsedMs: Date.now() - started });
    if (!response.ok) throw new Error('Built harness asset returned HTTP ' + response.status + ': ' + assetPath);
  }

  const environment = {
    ...process.env,
    RHINE_LYRICS_CHECK_URL: checkUrl,
    RHINE_LYRICS_CHECK_PROFILE: profileDirectory,
    RHINE_LYRICS_CHECK_REPORT: reportPath,
    RHINE_LYRICS_CHECK_ARTIFACTS: runDirectory,
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  const childResult = await new Promise((resolve, reject) => {
    child = spawn(electronPath, [electronAppDirectory], { cwd: projectRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Electron lyrics check exceeded 45 seconds. stdout=' + stdout.slice(-6000) + ' stderr=' + stderr.slice(-6000)));
    }, 45000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });

  try {
    report = { ...report, ...JSON.parse(await readFile(reportPath, 'utf8')) };
  } catch (error) {
    report.error = report.error ?? 'Electron did not write its report: ' + String(error?.message ?? error);
  }
  report.electronExitCode = childResult.code;
  report.electronSignal = childResult.signal;
  report.electronRunAsNodeRemoved = !Object.hasOwn(environment, 'ELECTRON_RUN_AS_NODE');
  report.apiRequests = requests;
  if (childResult.code !== 0) {
    report.ok = false;
    report.error = report.error ?? 'Electron exited with code ' + childResult.code;
    report.electronStdout = childResult.stdout.slice(-6000);
    report.electronStderr = childResult.stderr.slice(-6000);
  }
} catch (error) {
  report.ok = false;
  report.error = error?.stack ?? String(error);
} finally {
  stopping = true;
  if (child && child.exitCode === null) child.kill();
  try { await previewServer?.httpServer.close(); } catch (error) {
    report.ok = false;
    report.cleanupError = String(error?.message ?? error);
  }
  try {
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) {
    report.ok = false;
    report.reportWriteError = String(error?.message ?? error);
  }
}

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (!report.ok) process.exitCode = 1;
