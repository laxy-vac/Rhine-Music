import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = path.join(projectRoot, '.tools', 'source-preview-electron', 'electron.exe');
const desktopEntry = path.join(projectRoot, 'desktop', 'lyrics-page-check.cjs');
const cacheDirectory = path.join(projectRoot, '.tools', 'lyrics-page-check-vite');
const artifactRoot = path.resolve(projectRoot, '..', '.task-tmp', 'lyrics-page-review');
const runDirectory = path.join(artifactRoot, 'run-' + Date.now() + '-' + randomUUID().slice(0, 8));
const profileDirectory = path.join(runDirectory, 'electron-profile');
const electronAppDirectory = path.join(runDirectory, 'electron-app');
const reportPath = path.join(runDirectory, 'report.json');

const sources = [
  { id: 'netease', name: '网易云音乐', builtin: true, enabled: true },
  { id: 'qq', name: 'QQ音乐', builtin: true, enabled: true },
];
const savedLyrics = new Map();
const preferences = new Map();
const requests = [];
let stopping = false;

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
    effectiveSourceId: saved.sourceId ?? 'netease',
    defaultSourceId: 'netease',
    sources,
  };
}

function lrcDocument(trackId) {
  return {
    trackId,
    lrc: '[00:01.00]第一句合成歌词\n[00:03.00]第二句合成歌词',
    translation: '',
    offsetMs: 0,
    source: { id: 'qq', name: 'QQ音乐' },
    savedAt: new Date().toISOString(),
  };
}

const harnessHtml = [
  '<!doctype html>',
  '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Lyrics page isolated check</title>',
  '<style>html,body{width:100%;height:100%;margin:0;overflow:hidden}*{box-sizing:border-box}body{font-family:system-ui,"Microsoft YaHei",sans-serif}#stage{position:relative;width:100vw;height:100vh;overflow:hidden}</style>',
  '</head><body>',
  '<div id="stage" class="music-app" data-page="lyrics" data-theme="day" data-layout="desktop">',
  '<main id="music-lyrics-page" class="music-settings-page music-lyrics-page">',
  '<header class="settings-page-heading"><div><small>03 / MUSIC ARCHIVE</small><h1>歌词</h1><p>同步文本与播放信息</p></div></header>',
  '<section id="lyrics-page-content" class="settings-page-content"></section>',
  '</main></div>',
  '<script type="module">',
  'import "/src/style.css";',
  'import "/src/music.css";',
  'import "/src/music-theme.css";',
  'import "/src/music-settings-page.css";',
  'import "/src/lyrics-page.css";',
  'import { setupLyricsPage } from "/src/lyrics-page.ts";',
  'const track = { id:"synthetic-track", title:"合成歌曲", artist:"测试歌手", album:"测试专辑", duration:180, codec:"FLAC", format:"FLAC", sampleRate:44100, bitsPerSample:16, numberOfChannels:2, bitrate:0, lossless:true };',
  'const state = { currentTrack:track, playing:false, transport:"paused", currentTime:0.5, duration:180, backend:"browser", nativeOutputStatus:undefined, error:"" };',
  'const album = { title:"测试专辑", artist:"测试歌手", year:"2026" };',
  'const controller = setupLyricsPage(document.querySelector("#lyrics-page-content"), { seek:()=>{}, spectrum:()=>({available:true,bands:Array.from({length:32},(_,i)=>0.25+((i*13)%55)/100),sampleRate:44100,updatedAt:Date.now()}), notify:()=>{}, openSettings:()=>{} });',
  'controller.update(state, album);',
  'controller.setVisible(true);',
  'window.__lyricsCheckReady = true;',
  '</script>',
  '</body></html>',
].join('\n');

const mockPlugin = {
  name: 'lyrics-page-local-mock',
  configureServer(server) {
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
        response.end(harnessHtml);
        return;
      }

      if (url.pathname === '/__lyrics-check/state') {
        respondJson(response, { requests, savedTrackIds: Array.from(savedLyrics.keys()) });
        return;
      }

      if (!url.pathname.startsWith('/api/lyrics/')) {
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
              settings: { defaultSourceId: 'netease', cacheDirectory: 'synthetic-cache', defaultCacheDirectory: 'synthetic-cache' },
              sources,
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
            const lyric = lrcDocument(body.trackId);
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
            const lyric = { ...lrcDocument(body.trackId), lrc: String(body.lrc ?? '') };
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

let viteServer;
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
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(profileDirectory, { recursive: true });
  await mkdir(electronAppDirectory, { recursive: true });
  const electronMain = path.relative(electronAppDirectory, desktopEntry).split(path.sep).join('/');
  await writeFile(path.join(electronAppDirectory, 'package.json'), JSON.stringify({
    name: 'rhine-lyrics-page-isolated-check',
    version: '1.0.0',
    private: true,
    main: electronMain,
  }, null, 2), 'utf8');

  const portProbe = net.createServer();
  await new Promise((resolve, reject) => {
    portProbe.once('error', reject);
    portProbe.listen(0, '127.0.0.1', resolve);
  });
  requestedPort = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));

  viteServer = await createServer({
    configFile: false,
    root: projectRoot,
    appType: 'custom',
    cacheDir: cacheDirectory,
    logLevel: 'error',
    plugins: [mockPlugin],
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: requestedPort, strictPort: true, hmr: false, open: false },
  });
  await viteServer.listen();
  const address = viteServer.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not bind an ephemeral TCP port.');
  const checkUrl = 'http://127.0.0.1:' + address.port + '/__lyrics_page_check';

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
      reject(new Error('Electron lyrics check exceeded 90 seconds.'));
    }, 90000);
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
  try { await viteServer?.close(); } catch (error) {
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
