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
const headerScrollbarMode = process.argv.includes('--header-scrollbar');
const artifactRoot = path.join(projectRoot, '.tools', headerScrollbarMode ? 'header-scrollbar' : 'lyrics-source-refinement');
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
const defaultSourceId = 'netease';
const trackBanks = new Map();
const requests = [];
const resolveResponses = [];
const searchResponses = [];
const variantResponses = [];
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

function lrcDocument(trackId, sourceId = defaultSourceId) {
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
    source: { id: sourceId, name: sources.find(item => item.id === sourceId)?.name ?? '合成来源' },
    savedAt: new Date().toISOString(),
  };
}

function selectedLyricDocument(trackId, sourceId = defaultSourceId) {
  const document = lrcDocument(trackId, sourceId);
  return {
    ...document,
    lrc: Array.from({ length: 20 }, (_, index) => `[00:${String(index + 1).padStart(2, '0')}.00]${index === 0 ? `手动选择结果 ${trackId}` : index === 1 ? '第二句手动候选歌词' : `手动候选第 ${index + 1} 行`}`).join('\n'),
  };
}

function localLyricDocument(trackId, text) {
  return {
    version: 2,
    trackId,
    lrc: String(text ?? `[00:01.00]本地歌词 ${trackId}`),
    translation: '',
    offsetMs: 0,
    offsetInText: true,
    source: { id: 'local-import', name: '本地导入' },
    savedAt: new Date().toISOString(),
  };
}

function bankFor(trackId) {
  let bank = trackBanks.get(trackId);
  if (!bank) {
    bank = { activeKind: 'cloud', userSelected: false, selectionRevision: 0, variants: {} };
    trackBanks.set(trackId, bank);
  }
  return bank;
}

function bankState(trackId) {
  const bank = trackBanks.get(trackId);
  if (!bank) return { lyric: null, activeKind: 'cloud', userSelected: false, selectionRevision: 0, variants: { cloud: false, local: false } };
  return {
    lyric: bank.variants[bank.activeKind] ?? null,
    activeKind: bank.activeKind,
    userSelected: bank.userSelected,
    selectionRevision: bank.selectionRevision,
    variants: { cloud: !!bank.variants.cloud, local: !!bank.variants.local },
  };
}

function activateBank(trackId, kind) {
  const bank = bankFor(trackId);
  bank.activeKind = kind;
  bank.userSelected = true;
  bank.selectionRevision += 1;
  return bankState(trackId);
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
  '<header class="music-header" id="lyrics-check-header" style="display:flex!important"><div class="music-identity"><a class="music-brand" href="/" aria-label="Rhine Music 音乐库"><strong>RHINE LAB</strong><span>MUSIC ARCHIVE <i>／</i> Terminal</span></a></div><nav class="music-topnav" aria-label="音乐终端导航">' +
    '<button data-action="library" aria-label="唱片主页" aria-pressed="true"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v14H3z"/></svg><span>Archive</span></button>' +
    '<button data-action="eq" aria-label="EQ 均衡器" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 18V6m5 12V9m5 9V4m5 14v-7"/></svg><span>EQ</span></button>' +
    '<button data-action="lyrics" aria-label="歌词" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg><span>歌词</span></button>' +
    '<button data-action="signal" aria-label="信号" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h3l3-7 4 14 4-14 3 7h3"/></svg><span>信号</span></button>' +
    '<button data-action="theme" aria-label="主题" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg><span>主题</span></button>' +
    '<button data-action="search" aria-label="搜索"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><span>搜索</span></button>' +
    '<button data-action="online" aria-label="在线曲库" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/></svg><span>在线</span></button>' +
    '<div class="theme-switch" aria-label="主题"><button data-theme="day" aria-label="暖昼主题" aria-pressed="true"><i class="theme-dot day"></i><span>暖昼</span></button><button data-theme="night" aria-label="深夜主题" aria-pressed="false"><i class="theme-dot night"></i><span>深夜</span></button></div>' +
    '<time class="foobar-clock" aria-label="当前日期和时间"><strong>12:34</strong><small>PLAYBACK</small></time>' +
    '<button data-action="settings" class="icon-button" aria-label="设置" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 13a7 7 0 0 0 0-2l2-1-2-3-2 1a7 7 0 0 0-2-1l-.4-2h-4L10 7a7 7 0 0 0-2 1L6 7l-2 3 2 1a7 7 0 0 0 0 2l-2 1 2 3 2-1a7 7 0 0 0 2 1l.6 2h4L15 17a7 7 0 0 0 2-1l2 1 2-3z"/></svg></button>' +
    '<div class="minimal-transport" role="group" aria-label="音乐播放"><button type="button" data-action="locate-playing" id="lyrics-check-transport-title" class="transport-track" aria-label="定位当前歌曲" aria-hidden="true" disabled><span id="lyrics-check-transport-title-label"></span></button><button data-action="play-pause" id="lyrics-check-transport-anchor" aria-label="播放" aria-pressed="false"><span class="transport-glyph transport-play" aria-hidden="true">▶</span><span class="transport-glyph transport-pause" aria-hidden="true">Ⅱ</span></button><button data-action="stop" id="stop-playback" aria-label="停止">■</button></div>' +
    '</nav></header>',
  '<main id="music-lyrics-page" class="music-settings-page music-lyrics-page">',
  '<header class="settings-page-heading"><div><small>03 / MUSIC ARCHIVE</small><h1>歌词</h1><p>同步文本与播放信息</p></div></header>',
  '<section id="lyrics-page-content" class="settings-page-content"></section>',
  '</main></div>',
  '<script type="module">',
  'import { setupTerminalLighting } from "/src/terminal-lighting.ts";',
  'import { setupTransportTitle } from "/src/music-transport-title.ts";',
  'import { enhanceSettingsSelectControls } from "/src/settings-select-controls.ts";',
  'import { qualityPresets } from "/src/render-quality.ts";',
  'import { setupLyricsPage } from "/src/lyrics-page.ts";',
  'const track = { id:"synthetic-track", title:"合成歌曲", artist:"测试歌手", album:"测试专辑", duration:180, codec:"FLAC", format:"FLAC", sampleRate:44100, bitsPerSample:16, numberOfChannels:2, bitrate:0, lossless:true };',
  'let state = { currentTrack:track, queue:[track], currentIndex:0, playbackOrder:"default", playing:false, transport:"paused", currentTime:0.5, duration:180, backend:"browser", nativeOutputStatus:undefined, error:"" };',
  'const album = { title:"测试专辑", artist:"测试歌手", year:"2026" };',
  'const transportTitle = setupTransportTitle(document.querySelector("#lyrics-check-transport-title"), document.querySelector("#lyrics-check-transport-title-label"));',
  'window.__lyricsCheckTransportTitle = transportTitle;',
  'window.__lyricsCheckUpdateTransportTitle = (title,shown) => transportTitle.update(title,shown);',
  'window.__lyricsCheckSetDesignTheme = (design,theme) => { const root=document.querySelector("#stage");root.dataset.design=design;root.dataset.theme=theme;return true; };',
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
  'window.__lyricsCheckDestroy = () => { settingsSelectControls?.destroy(); controller.destroy(); terminalLighting.destroy(); transportTitle.destroy(); };',
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
        respondJson(response, {
          requests,
          resolveResponses,
          searchResponses,
          variantResponses,
          banks: Array.from(trackBanks, ([trackId, bank]) => ({
            trackId,
            activeKind: bank.activeKind,
            userSelected: bank.userSelected,
            selectionRevision: bank.selectionRevision,
            variants: { cloud: !!bank.variants.cloud, local: !!bank.variants.local },
          })),
        });
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
              settings: { defaultSourceId: 'netease', cacheDirectory: 'synthetic-cache', defaultCacheDirectory: 'synthetic-cache' },
              sources,
            });
            return;
          }

          if (url.pathname === '/api/lyrics/resolve' && request.method === 'POST') {
            const trackId = String(body.trackId ?? '');
            const available = metadataAvailability.get(trackId) ?? true;
            const before = trackBanks.get(trackId);
            const cachedKind = before?.userSelected
              ? before.activeKind
              : before?.variants.local ? 'local' : before?.variants.cloud ? 'cloud' : null;
            const hadBank = !!cachedKind && !!before?.variants[cachedKind];
            const startingRevision = before?.selectionRevision ?? 0;
            const startingUserSelected = before?.userSelected ?? false;
            if (hadBank) {
              if (!before.userSelected) before.activeKind = cachedKind;
              const current = bankState(trackId);
              resolveResponses.push({ trackId, lyricTrackId: current.lyric?.trackId ?? null, activeKind: current.activeKind, cached: true });
              respondJson(response, { ...current, sources: [] });
              return;
            }
            if (before?.userSelected && before.activeKind === 'local') {
              const current = bankState(trackId);
              resolveResponses.push({ trackId, lyricTrackId: null, activeKind: current.activeKind, cached: false, blockedBySelection: true });
              respondJson(response, { ...current, sources: [] });
              return;
            }
            const lyric = !available || trackId === 'synthetic-empty-track' ? null : lrcDocument(trackId, defaultSourceId);
            const waitMs = ['synthetic-slow-track', 'synthetic-pending-track', 'synthetic-import-pending-track', 'synthetic-empty-local-track', 'synthetic-leave-track'].includes(trackId) ? 450 : 40;
            if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
            if (response.destroyed || request.aborted) return;
            const current = bankFor(trackId);
            const selectionChanged = current.selectionRevision !== startingRevision;
            if (selectionChanged) {
              const loaded = bankState(trackId);
              resolveResponses.push({ trackId, lyricTrackId: loaded.lyric?.trackId ?? null, activeKind: loaded.activeKind, cached: !!loaded.lyric, selectionChanged: true });
              respondJson(response, { ...loaded, sources: [] });
              return;
            }
            if (lyric && !current.variants.cloud) current.variants.cloud = lyric;
            const userChangedSelection = current.userSelected !== startingUserSelected;
            if (lyric && !userChangedSelection && current.variants.cloud) current.activeKind = 'cloud';
            const loaded = bankState(trackId);
            resolveResponses.push({ trackId, lyricTrackId: loaded.lyric?.trackId ?? null, activeKind: loaded.activeKind, cached: false, userChangedSelection });
            respondJson(response, {
              ...loaded,
              sources: [{ sourceId: defaultSourceId, name: sources.find(item => item.id === defaultSourceId).name, status: lyric ? 'ok' : 'empty', count: lyric ? 1 : 0 }],
            });
            return;
          }

          if (url.pathname === '/api/lyrics/track' && request.method === 'GET') {
            respondJson(response, bankState(url.searchParams.get('trackId') ?? ''));
            return;
          }

          if (url.pathname === '/api/lyrics/variant' && request.method === 'POST') {
            const trackId = String(body.trackId ?? '');
            const kind = body.kind === 'local' ? 'local' : 'cloud';
            if (trackId === 'synthetic-slow-variant-track') await new Promise((resolve) => setTimeout(resolve, 450));
            const payload = activateBank(trackId, kind);
            variantResponses.push({ trackId, kind, activeKind: payload.activeKind, selectionRevision: payload.selectionRevision,
              responseDestroyed: response.destroyed, requestAborted: request.aborted });
            respondJson(response, payload);
            return;
          }

          if (url.pathname === '/api/lyrics/search' && request.method === 'POST') {
            await new Promise((resolve) => setTimeout(resolve, 90));
            const sourceId = body.sourceId === 'auto' ? 'qq' : body.sourceId || 'netease';
            const source = sources.find(item => item.id === sourceId) ?? sources[0];
            searchResponses.push({ trackId: String(body.trackId ?? ''), sourceId: source.id });
            respondJson(response, {
              sourceName: source.name,
              candidates: [{
                id: `synthetic-${source.id}-candidate`,
                sourceId: source.id,
                title: body.query?.title || '合成歌曲',
                artist: body.query?.artist || '测试歌手',
                album: body.query?.album || '测试专辑',
                duration: 180,
                score: 0.99,
              }],
              sources: source.id === 'qq' && body.sourceId === 'auto'
                ? [{ sourceId: 'netease', name: '网易云音乐', status: 'error', message: '模拟来源暂时不可用' }, { sourceId: 'qq', name: 'QQ音乐', status: 'ok', count: 1 }]
                : [{ sourceId: source.id, name: source.name, status: 'ok', count: 1 }],
            });
            return;
          }

          if (url.pathname === '/api/lyrics/select' && request.method === 'POST') {
            const bank = bankFor(body.trackId);
            bank.variants.cloud = selectedLyricDocument(body.trackId, body.sourceId || defaultSourceId);
            bank.activeKind = 'cloud';
            bank.userSelected = true;
            bank.selectionRevision += 1;
            respondJson(response, bankState(body.trackId));
            return;
          }

          if (url.pathname === '/api/lyrics/offset' && request.method === 'POST') {
            const bank = trackBanks.get(body.trackId);
            const kind = body.kind === 'local' ? 'local' : 'cloud';
            const current = bank?.variants[kind];
            if (!current) {
              respondJson(response, { error: 'synthetic lyric not found' }, 404);
              return;
            }
            const lyric = { ...current, offsetMs: Number(body.offsetMs) || 0 };
            bank.variants[kind] = lyric;
            respondJson(response, { lyric, activeKind: bank.activeKind, userSelected: bank.userSelected, selectionRevision: bank.selectionRevision, variants: { cloud: !!bank.variants.cloud, local: !!bank.variants.local } });
            return;
          }

          if (url.pathname === '/api/lyrics/import' && request.method === 'POST') {
            const bank = bankFor(body.trackId);
            bank.variants.local = localLyricDocument(body.trackId, body.lrc);
            bank.activeKind = 'local';
            bank.userSelected = true;
            bank.selectionRevision += 1;
            respondJson(response, bankState(body.trackId));
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
  mode: headerScrollbarMode ? 'header-scrollbar' : 'full-lyrics-page',
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
    ...(headerScrollbarMode ? { RHINE_LYRICS_CHECK_MODE: 'header-scrollbar' } : {}),
  };
  delete environment.ELECTRON_RUN_AS_NODE;

  const childResult = await new Promise((resolve, reject) => {
    child = spawn(electronPath, [electronAppDirectory], { cwd: projectRoot, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('Electron lyrics check exceeded 120 seconds. stdout=' + stdout.slice(-6000) + ' stderr=' + stderr.slice(-6000)));
    }, 120000);
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
