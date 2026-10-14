import path from 'node:path';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createMusicServer } from '../scripts/music-server.mjs';
import { MusicLibraryStore } from '../scripts/music-library.mjs';
import { FtpLibrary } from '../scripts/ftp-library.mjs';
import { NativeOutput } from '../scripts/native-output.mjs';
import { silentWav } from '../scripts/audio-fixtures.mjs';
import { runAudioControlsCheck } from './check-audio-controls.mjs';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function commonDirectory(first, second) {
  let current = first;
  while (!inside(current, second)) current = path.dirname(current);
  return current;
}

async function ensureSilentFixture(samplesRoot) {
  const albumDir = path.join(samplesRoot, 'Review Album');
  const filename = '01 - Review Signal.wav';
  const wavPath = path.join(albumDir, filename);
  const bytes = silentWav(60, 44100, 16);

  await mkdir(samplesRoot, { recursive: true });
  const roots = await readdir(samplesRoot, { withFileTypes: true });
  assert(roots.every((entry) => entry.name === 'Review Album' && entry.isDirectory()),
    `Synthetic sample directory contains unexpected entries: ${roots.map((entry) => entry.name).join(', ')}`);
  await mkdir(albumDir, { recursive: true });
  const items = await readdir(albumDir, { withFileTypes: true });
  assert(items.every((entry) => entry.name === filename && entry.isFile()),
    `Review Album contains unexpected entries: ${items.map((entry) => entry.name).join(', ')}`);

  try {
    const existing = await readFile(wavPath);
    assert(existing.equals(bytes), 'Existing synthetic WAV differs from the expected silent fixture; preserving it.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFile(wavPath, bytes, { flag: 'wx' });
  }

  return { albumDir, wavPath };
}

function mockNativeCommands(native) {
  const state = {
    session: null,
    position: 0,
    positionAt: Date.now(),
    duration: 60,
    sampleRate: 44100,
    processing: null,
    playing: false,
    volume: 0,
  };

  const currentPosition = () => {
    const elapsed = state.playing ? (Date.now() - state.positionAt) / 1000 : 0;
    const position = Math.min(state.duration, state.position + elapsed);
    if (position >= state.duration) {
      state.position = state.duration;
      state.positionAt = Date.now();
      state.playing = false;
      return state.duration;
    }
    return position;
  };

  const snapshot = () => ({
    session: state.session,
    duration: state.duration,
    position: currentPosition(),
    playing: state.playing,
    paused: !state.playing,
    ended: false,
    backend: 'wasapi',
    sampleRate: state.sampleRate,
    processingStages: state.processing ? [{
      id: 'eq',
      name: '均衡器',
      active: state.processing.eq?.enabled === true,
      ... (state.processing.eq?.enabled === true ? {} : { reason: 'disabled' }),
      sampleRate: state.sampleRate,
    }] : [],
    capabilities: { processing: true, gapless: true, crossfade: false, bitPerfect: false },
    volume: state.volume,
  });

  native.command = async (request) => {
    if (request.cmd === 'devices') return { devices: [] };
    if (request.cmd === 'open') {
      state.session = request.session;
      state.position = Math.max(0, Number(request.position) || 0);
      state.positionAt = Date.now();
      state.duration = 60;
      state.sampleRate = 44100;
      state.playing = false;
      state.volume = Number(request.volume) || 0;
      state.processing = request.processing ?? state.processing;
      return snapshot();
    }
    if (request.session && state.session && request.session !== state.session) {
      return { session: request.session, stale: true, duration: state.duration, position: 0, playing: false, paused: true };
    }

    if (request.cmd === 'status') return snapshot();
    if (request.cmd === 'play') {
      if (!state.playing) {
        state.position = currentPosition();
        state.positionAt = Date.now();
        state.playing = true;
      }
      return snapshot();
    }
    if (request.cmd === 'pause') {
      state.position = currentPosition();
      state.positionAt = Date.now();
      state.playing = false;
      return snapshot();
    }
    if (request.cmd === 'seek') {
      state.position = Math.max(0, Math.min(state.duration, Number(request.position) || 0));
      state.positionAt = Date.now();
      return snapshot();
    }
    if (request.cmd === 'volume') {
      state.volume = Math.max(0, Math.min(1, Number(request.volume) || 0));
      return snapshot();
    }
    if (request.cmd === 'processing') {
      state.processing = request.processing ?? state.processing;
      return snapshot();
    }
    if (request.cmd === 'stop') {
      state.position = 0;
      state.positionAt = Date.now();
      state.playing = false;
      return { stopped: true, session: state.session };
    }
    throw new Error(`Unexpected mocked native command: ${request.cmd}`);
  };

  return state;
}

function installSeedRoute(server, route, preferences, { resetAudioCoreStorage = false } = {}) {
  const handlers = server.listeners('request');
  assert(handlers.length > 0, 'Music server has no request handler.');
  server.removeAllListeners('request');

  const preferenceJson = JSON.stringify(preferences).replaceAll('<', '\\u003c');
  const preferenceLiteral = JSON.stringify(preferenceJson);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Settings check seed</title></head><body><script>
    const value = ${preferenceLiteral};
    const preferences = JSON.parse(value);
    localStorage.setItem('rhine-music-preferences', value);
    if (${resetAudioCoreStorage ? 'true' : 'false'}) localStorage.removeItem('rhine-audio-processing-presets-v1');
    window.rhineDesktop?.savePreferences(preferences);
    setTimeout(() => location.replace('/?scene=archive'), 180);
  </script></body></html>`;

  server.on('request', (request, response) => {
    let pathname = '';
    try {
      pathname = new URL(request.url, `http://${request.headers.host ?? ''}`).pathname;
    } catch {}

    if (pathname === route && ['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : html);
      return;
    }

    for (const handler of handlers) handler.call(server, request, response);
  });
}

async function closeHttpServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await closed;
}

export async function runSettingsPageCheck({ root, dataDir, home, BrowserWindow, ownWindow, audioCore = false }) {
  const report = {
    ok: false,
    checks: {},
    viewports: [],
    screenshots: [],
    visualReviewPending: true,
    syntheticDataOnly: true,
    nativeAudioMocked: true,
    externalNetworkRequestsMadeByCheck: false,
    loopbackServiceUsed: true,
  };
  let bundle;
  let browserWindow;
  let native;
  let nativeState;

  try {
    assert(root && dataDir && home && BrowserWindow && typeof ownWindow === 'function',
      'root, dataDir, home, BrowserWindow and ownWindow are required.');

    const projectRoot = path.resolve(root);
    const taskRoot = path.resolve(projectRoot, '..', '.task-tmp', 'settings-page-review');
    const dataDirectory = path.resolve(dataDir);
    const homeDirectory = path.resolve(home);
    assert(inside(taskRoot, dataDirectory), `dataDir must stay under ${taskRoot}`);
    assert(inside(taskRoot, homeDirectory), `home must stay under ${taskRoot}`);

    const workRoot = commonDirectory(dataDirectory, homeDirectory);
    assert(inside(taskRoot, workRoot), `Shared review directory must stay under ${taskRoot}`);
    const samplesRoot = path.join(workRoot, 'samples');
    const reviewArtifacts = path.join(workRoot, 'review-artifacts', `run-${randomUUID()}`);
    await mkdir(reviewArtifacts, { recursive: true });
    report.artifactDirectory = reviewArtifacts;

    const { wavPath } = await ensureSilentFixture(samplesRoot);
    const store = await new MusicLibraryStore({
      dataDir: dataDirectory,
      defaultRoots: [samplesRoot],
      musicBrainzContact: '',
    }).init();
    await store.updateConfig({
      roots: [samplesRoot],
      onlineEnabled: false,
      musicBrainzContact: '',
      foobarBaseUrl: null,
    });
    const library = await store.scan({ roots: [samplesRoot] });
    assert(library.albums.length === 1 && library.albums[0].tracks.length === 1,
      `Expected one synthetic album and one WAV track; got ${library.albums.length} album(s).`);
    assert(library.roots.length === 1 && path.resolve(library.roots[0].path) === path.resolve(samplesRoot),
      'Music scan root is not the isolated synthetic samples directory.');
    report.syntheticLibrary = { root: samplesRoot, wavPath, durationSeconds: 60, sampleRate: 44100 };

    const sony = {
      async status() {
        return { available: false, original: false, error: 'Settings page check: Sony component intentionally unavailable.' };
      },
      close() {},
    };
    const ftp = await new FtpLibrary({ dataDir: path.join(workRoot, 'ftp-check') }).init();
    assert(ftp.status().configured === false, 'Isolated FTP fixture unexpectedly has a saved connection.');
    native = new NativeOutput({ store, ftp, sony });
    nativeState = mockNativeCommands(native);
    bundle = await createMusicServer({
      dataDir: dataDirectory,
      distDir: path.join(projectRoot, '.tools', 'source-preview-interface'),
      defaultRoots: [samplesRoot],
      store,
      sony,
      ftp,
      native,
      autoScan: false,
    });

    const seedRoute = `/__settings-page-seed-${randomUUID()}`;
    const initialPreferences = {
      theme: 'day',
      sortMode: 'genre',
      quality: 'original',
      reduced: true,
      volume: 0,
      songFade: false,
      sony: { dsee: false, dc: 0, vinyl: 0 },
      sonyParallel: false,
      sonyStreaming: false,
      output: { backend: 'wasapi', device: -1, channel: 0, dsdMode: 'pcm' },
      bgm: false,
      bgmVolume: 0,
      sound: false,
      soundVolume: 0,
    };
    installSeedRoute(bundle.server, seedRoute, initialPreferences, { resetAudioCoreStorage: audioCore });

    await new Promise((resolve, reject) => {
      bundle.server.once('error', reject);
      bundle.server.listen(0, '127.0.0.1', resolve);
    });
    const address = bundle.server.address();
    assert(address && typeof address === 'object', 'Music server did not bind an ephemeral TCP port.');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    browserWindow = new BrowserWindow({
      width: 1280,
      height: 840,
      show: false,
      backgroundColor: '#e8e5e1',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(projectRoot, 'desktop', 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    ownWindow(browserWindow);
    browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browserWindow.webContents.on('will-navigate', (event, target) => {
      try {
        if (new URL(target).origin !== baseUrl) event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
    browserWindow.setContentSize(1280, 840);
    await browserWindow.loadURL(`${baseUrl}${seedRoute}`);
    browserWindow.showInactive?.();

    const evaluate = (code) => browserWindow.webContents.executeJavaScript(code, true);
    const waitFor = async (code, label, timeoutMs = 60000) => {
      const started = Date.now();
      let lastError;
      while (Date.now() - started < timeoutMs) {
        if (browserWindow.isDestroyed()) throw new Error('Settings check BrowserWindow was destroyed.');
        try {
          const value = await evaluate(code);
          if (value) return value;
        } catch (error) {
          lastError = error;
        }
        await pause(100);
      }
      throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
    };
    const click = async (selector) => {
      const found = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
      assert(found, `Could not click ${selector}`);
    };
    const setViewport = async (width, height) => {
      browserWindow.setContentSize(width, height);
      await waitFor(`window.innerWidth === ${width} && window.innerHeight === ${height}`, `${width}x${height} content size`, 10000);
      await pause(250);
    };
    const capture = async (name) => {
      await pause(850);
      await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const state = await evaluate(`({ page: document.querySelector('#stage')?.dataset.page, theme: document.querySelector('#stage')?.dataset.theme, category: document.querySelector('[data-settings-category-target][aria-current="page"]')?.dataset.settingsCategoryTarget })`);
      assert(state.page === 'settings', `Screenshot ${name} is not on the settings page.`);
      const image = await browserWindow.webContents.capturePage();
      const filename = path.join(reviewArtifacts, name);
      await writeFile(filename, image.toPNG(), { flag: 'wx' });
      report.screenshots.push(filename);
      report.captureStates ??= [];
      report.captureStates.push({ name, ...state });
      return filename;
    };

    await waitFor(`location.pathname === '/' && document.querySelector('#music-loading') === null && document.querySelector('#three-scene canvas') && document.querySelector('#selection-number') && document.querySelector('#selection-total')?.textContent !== '00'`,
      'music archive scene and synthetic library readiness');
    await waitFor(`window.rhineDesktop?.native === true && (() => { try { const p = JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}'); return p.theme === 'day' && p.reduced === true && p.volume === 0 && p.bgm === false && p.sound === false; } catch { return false; } })()`,
      'isolated desktop preferences seeded before app startup', 15000);
    report.checks.archiveReady = true;

    const snapshot = () => evaluate(`(() => {
      const stage = document.querySelector('#stage');
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? '';
      return {
        page: stage?.dataset.page ?? '',
        mode: stage?.dataset.mode ?? '',
        presentation: stage?.dataset.presentation ?? '',
        cameraPhase: stage?.dataset.cameraPhase ?? '',
        selectionTitle: text('#selection-title'),
        selectionNumber: text('#selection-number'),
        selectionTotal: text('#selection-total'),
        detailCardId: text('#detail-card-id'),
        detailTitle: text('#album-detail-content h1'),
        detailHidden: document.querySelector('#music-detail')?.hidden ?? true,
        musicSettingsHidden: document.querySelector('#music-settings')?.hidden ?? true,
      };
    })()`);
    const sameSurface = (actual, expected, label) => {
      for (const key of ['mode', 'presentation', 'selectionTitle', 'selectionNumber', 'selectionTotal', 'detailCardId', 'detailTitle', 'detailHidden']) {
        assert(actual[key] === expected[key], `${label}: ${key} changed (${JSON.stringify(expected[key])} → ${JSON.stringify(actual[key])}).`);
      }
    };

    let archiveBefore = await snapshot();
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings' && document.querySelector('#music-settings') && !document.querySelector('#music-settings').hidden`,
      'independent settings page');

    if (audioCore) {
      const audioCoreReport = await runAudioControlsCheck({ browserWindow, waitFor, click, capture, setViewport, presetStoreFile: path.join(home, 'audio-processing-presets.json') });
      report.audioCore = audioCoreReport;
      report.checks.audioCore = audioCoreReport.checks;
      assert(audioCoreReport.ok, audioCoreReport.error || 'Audio controls acceptance failed.');
    }

    const pageAudit = await evaluate(`(() => {
      const settings = document.querySelector('#music-settings');
      const blockers = [...document.querySelectorAll('[role="dialog"], .music-panel-scrim, .music-panel, .modal-backdrop')]
        .filter((el) => !el.hidden && getComputedStyle(el).display !== 'none');
      return {
        settingsEntries: document.querySelectorAll('.music-topnav [data-action="settings"]').length,
        allSettingsActions: document.querySelectorAll('[data-action="settings"]').length,
        visibleBlockers: blockers.length,
        settingsRole: settings?.getAttribute('role') ?? '',
        headerInert: document.querySelector('.music-header')?.inert ?? true,
        playbackInert: document.querySelector('#music-playback')?.inert ?? true,
      };
    })()`);
    assert(pageAudit.settingsEntries === 1 && pageAudit.allSettingsActions === 1,
      `Expected one reused topbar settings entry; got ${pageAudit.settingsEntries} in nav and ${pageAudit.allSettingsActions} overall.`);
    assert(pageAudit.visibleBlockers === 0 && pageAudit.settingsRole !== 'dialog',
      'Settings page still presents a dialog or scrim.');
    report.checks.independentPageAndSingleEntry = true;

    const requiredIds = [
      'music-sort', 'introduction-settings', 'introduction-refresh', 'introduction-progress',
      'introduction-status', 'introduction-coverage', 'introduction-missing',
      'output-settings', 'native-component-status', 'output-backend', 'output-device',
      'output-channel', 'output-dsd', 'native-playback-status', 'sony-settings',
      'sony-component-status', 'sony-dsee', 'sony-dc', 'sony-vinyl', 'sony-parallel',
      'sony-streaming', 'sony-progress', 'sony-playback-status', 'ftp-settings',
      'ftp-host', 'ftp-port', 'ftp-security', 'ftp-user', 'ftp-password', 'ftp-root',
      'ftp-status', 'quality-preset', 'quality-summary', 'reduced-motion', 'volume',
      'song-fade-setting', 'sound-setting', 'sound-volume', 'bgm-setting', 'bgm-volume',
    ];
    const controlAudit = await evaluate(`(() => {
      const ids = ${JSON.stringify(requiredIds)};
      return {
        missing: ids.filter((id) => document.querySelectorAll('#music-settings #' + CSS.escape(id)).length !== 1),
        qualityControls: document.querySelectorAll('#music-settings [data-quality]').length,
        categories: [...document.querySelectorAll('#music-settings [data-settings-category]')].map((node) => node.dataset.settingsCategory),
        categoryButtons: [...document.querySelectorAll('#music-settings [data-settings-category-target]')].map((node) => node.dataset.settingsCategoryTarget),
      };
    })()`);
    assert(controlAudit.missing.length === 0, `Missing or duplicated settings control IDs: ${controlAudit.missing.join(', ')}`);
    assert(controlAudit.qualityControls > 0, 'Granular render-quality controls were not retained.');
    const categories = ['appearance', 'interface', 'audio', 'library', 'sources', 'about'];
    assert(categories.every((name) => controlAudit.categories.includes(name) && controlAudit.categoryButtons.includes(name)),
      `Expected all six settings categories; got ${controlAudit.categories.join(', ')}.`);
    report.checks.legacyControlsRetained = true;
    report.settingsCategories = categories;

    const inspectViewport = async (width, height, expectedLayout) => {
      const audit = await evaluate(`(() => {
        const rect = (node) => { const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
        const page = document.querySelector('#music-settings');
        const content = document.querySelector('.settings-page-content');
        const header = document.querySelector('.music-header');
        const player = document.querySelector('#music-playback');
        return {
          width: innerWidth, height: innerHeight, layout: document.querySelector('#stage')?.dataset.layout,
          page: rect(page), header: rect(header), contentWidth: content?.clientWidth ?? 0,
          contentScrollWidth: content?.scrollWidth ?? 0,
          playerHidden: player?.hidden ?? true,
          playerTop: player ? rect(player).top : innerHeight,
        };
      })()`);
      if (expectedLayout === 'portrait') assert(audit.layout === 'portrait',
        `Expected portrait layout at ${width}x${height}, got ${audit.layout}.`);
      else assert(audit.layout !== 'portrait', `Expected a landscape layout at ${width}x${height}, got ${audit.layout}.`);
      assert(audit.page.left >= -1 && audit.page.top >= -1 && audit.page.right <= audit.width + 1 && audit.page.bottom <= audit.height + 1,
        `Settings page escaped the ${width}x${height} viewport: ${JSON.stringify(audit.page)}.`);
      assert(audit.page.top >= audit.header.bottom - 1,
        `Settings heading overlaps the header at ${width}x${height}: ${JSON.stringify(audit)}.`);
      assert(audit.contentScrollWidth <= audit.contentWidth + 1,
        `Settings content has horizontal overflow at ${width}x${height}: ${audit.contentScrollWidth}px in ${audit.contentWidth}px.`);
      if (!audit.playerHidden) assert(audit.page.bottom <= audit.playerTop - 8,
        `Settings page overlaps the active playback bar at ${width}x${height}.`);
      report.viewports.push({ ...audit, expectedLayout: expectedLayout ?? 'landscape' });
      return audit;
    };

    for (const category of categories) {
      await click(`#music-settings [data-settings-category-target="${category}"]`);
      await waitFor(`(() => { const button = document.querySelector('#music-settings [data-settings-category-target="${category}"]'); const section = document.querySelector('#music-settings [data-settings-category="${category}"]'); return button?.getAttribute('aria-current') === 'page' && section && !section.hidden; })()`,
        `${category} settings category`);
      const categoryAudit = await evaluate(`(() => ({
        activeButtons: document.querySelectorAll('#music-settings [data-settings-category-target][aria-current="page"]').length,
        visibleSections: [...document.querySelectorAll('#music-settings [data-settings-category]')].filter((node) => !node.hidden).map((node) => node.dataset.settingsCategory),
      }))()`);
      assert(categoryAudit.activeButtons === 1 && categoryAudit.visibleSections.length === 1 && categoryAudit.visibleSections[0] === category,
        `Category switch did not isolate ${category}.`);
    }
    report.checks.categoryNavigation = true;

    await click('#music-settings [data-settings-category-target="appearance"]');
    await setViewport(1280, 840);
    await waitFor(`document.querySelector('#stage')?.dataset.layout !== 'portrait'`, 'wide landscape layout');
    await inspectViewport(1280, 840, null);
    const initialTheme = await evaluate(`JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}').theme`);
    assert(initialTheme === 'day', `Expected warm day theme before theme checks, got ${initialTheme}.`);
    const dayScreenshot = await capture('settings-1280x840-day.png');

    await click('.music-header .theme-switch [data-theme="night"]');
    await waitFor(`document.querySelector('#stage')?.dataset.theme === 'night' && JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}').theme === 'night'`,
      'night theme and persisted preference');
    const nightScreenshot = await capture('settings-1280x840-night.png');
    report.checks.themePreferenceSaved = true;

    const reducedBefore = await evaluate(`document.querySelector('#reduced-motion')?.checked`);
    assert(reducedBefore === true, 'Reduced-motion preference was not seeded as enabled.');
    await click('#reduced-motion');
    await waitFor(`document.querySelector('#reduced-motion')?.checked === false && JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}').reduced === false`,
      'reduced-motion disabled preference save');
    await click('#reduced-motion');
    await waitFor(`document.querySelector('#reduced-motion')?.checked === true && JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}').reduced === true`,
      'reduced-motion enabled preference save');
    report.checks.reducedMotionPreferenceSaved = true;

    await pause(300);
    await evaluate('location.reload()').catch(() => {});
    await waitFor(`location.pathname === '/' && document.querySelector('#music-loading') === null && document.querySelector('#three-scene canvas') && document.querySelector('#stage')?.dataset.page === 'music' && (() => { try { const p = JSON.parse(localStorage.getItem('rhine-music-preferences') || '{}'); return p.theme === 'night' && p.reduced === true; } catch { return false; } })()`,
      'theme and reduced-motion preferences restored from the isolated desktop profile', 60000);
    report.checks.desktopPreferencesSurviveReload = true;
    archiveBefore = await snapshot();

    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings'`, 'settings page reopened after preference reload');

    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(`document.querySelector('#stage')?.dataset.page !== 'settings'`, 'Escape return from settings page');
    const archiveAfterEscape = await snapshot();
    sameSurface(archiveAfterEscape, archiveBefore, 'Escape from archive settings');
    report.checks.escapeRestoresArchiveState = true;

    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings'`, 'settings page reopened from archive');
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page !== 'settings'`, 'topbar settings toggle returns to archive');
    sameSurface(await snapshot(), archiveBefore, 'Topbar toggle from archive settings');
    report.checks.topbarToggleRestoresArchiveState = true;

    await click('#music-browse [data-action="open"]');
    await waitFor(`document.querySelector('#stage')?.dataset.presentation === 'detail' && !document.querySelector('#music-detail')?.hidden`,
      'album detail camera and content');
    const detailBefore = await snapshot();
    assert(detailBefore.detailTitle.length > 0, 'Synthetic album detail did not render.');
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings'`, 'settings page opened from detail');
    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page !== 'settings' && document.querySelector('#stage')?.dataset.presentation === 'detail'`,
      'detail state restored by topbar settings toggle');
    sameSurface(await snapshot(), detailBefore, 'Topbar toggle from detail settings');
    report.checks.topbarToggleRestoresDetailAndSelection = true;

    await click('#music-detail .track-row[data-track]');
    await waitFor(`(() => { const player = document.querySelector('#music-playback'); const toggle = document.querySelector('#playback-toggle'); return player && !player.hidden && toggle?.getAttribute('aria-pressed') === 'true' && !!document.querySelector('#playback-title')?.textContent?.trim(); })()`,
      'synthetic WAV playback through mocked native output', 30000);
    const playingBefore = await evaluate(`(() => ({
      title: document.querySelector('#playback-title')?.textContent?.trim() ?? '',
      playing: document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') ?? '',
      hidden: document.querySelector('#music-playback')?.hidden ?? true,
    }))()`);

    await click('.music-topnav [data-action="settings"]');
    await waitFor(`document.querySelector('#stage')?.dataset.page === 'settings'`, 'settings page open during playback');
    const activePageAudit = await evaluate(`(() => ({
      headerInert: document.querySelector('.music-header')?.inert ?? true,
      playbackInert: document.querySelector('#music-playback')?.inert ?? true,
      playerHidden: document.querySelector('#music-playback')?.hidden ?? true,
      currentTitle: document.querySelector('#playback-title')?.textContent?.trim() ?? '',
      playing: document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') ?? '',
    }))()`);
    assert(!activePageAudit.headerInert && !activePageAudit.playbackInert && !activePageAudit.playerHidden,
      'Header or active playback controls are inert/hidden on the settings page.');
    assert(activePageAudit.currentTitle === playingBefore.title && activePageAudit.playing === 'true',
      'Active playback did not survive switching to settings.');
    await click('#playback-toggle');
    await waitFor(`document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') === 'false'`, 'pause from settings page', 10000);
    await click('#playback-toggle');
    await waitFor(`document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') === 'true'`, 'resume from settings page', 10000);
    report.checks.playbackRemainsActiveAndUsable = true;

    await click('#music-settings [data-settings-category-target="audio"]');
    await waitFor(`document.querySelector('#music-settings [data-settings-category-target="audio"]')?.getAttribute('aria-current') === 'page'`, 'audio settings selected');
    if (audioCore) {
      await click('#audio-settings-subnav [data-audio-settings-target="precision"]');
      await waitFor(`document.querySelector('#processing-bitperfect input')?.disabled === true && document.querySelector('#bitperfect-capability-note')?.textContent.includes('不提供')`,
        'BitPerfect control respects the mocked unsupported capability');
      report.checks.audioCore.bitPerfectDisabledWhenUnsupported = true;
      await click('#audio-settings-subnav [data-audio-settings-target="eq"]');
      await waitFor(`document.querySelector('#processing-eq-controls .eq-response-figure figcaption')?.textContent.includes('本次滤波输入 44.1 kHz')`,
        'EQ curve follows the mocked processing-stage input rate');
      report.checks.audioCore.responseCurveUsesReportedInputRate = true;
    }
    await inspectViewport(1280, 840, null);
    const playingScreenshot = await capture('settings-1280x840-playing.png');

    await setViewport(760, 1000);
    await waitFor(`document.querySelector('#stage')?.dataset.layout === 'portrait'`, 'portrait page layout');
    for (const category of categories) {
      await click(`#music-settings [data-settings-category-target="${category}"]`);
      await waitFor(`document.querySelector('#music-settings [data-settings-category-target="${category}"]')?.getAttribute('aria-current') === 'page'`,
        `${category} settings category at portrait size`);
      await inspectViewport(760, 1000, 'portrait');
    }
    await click('#music-settings [data-settings-category-target="appearance"]');
    const portraitScreenshot = await capture('settings-760x1000-portrait.png');
    const finalPlayback = await evaluate(`document.querySelector('#playback-toggle')?.getAttribute('aria-pressed')`);
    assert(finalPlayback === 'true', 'Playback stopped during portrait settings layout check.');
    report.checks.portraitLayoutAndPlayback = true;
    await click('#music-settings [data-settings-category-target="library"]');
    await evaluate(`(() => { const select = document.querySelector('#music-sort'); select.value = 'artist'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`).catch(() => {});
    await waitFor(`document.querySelector('#music-loading') === null && document.querySelector('#stage')?.dataset.page === 'settings' && document.querySelector('[data-settings-category-target="library"]')?.getAttribute('aria-current') === 'page' && document.querySelector('#music-sort')?.value === 'artist'`, 'sorting reload returns to the same settings category');
    await waitFor(`document.querySelector('#playback-toggle')?.getAttribute('aria-pressed') === 'true'`, 'playback session restored across sorting reload', 15000);
    report.checks.sortingReloadRestoresSettingsAndPlayback = true;
    report.checks.filesystemAndServiceScope = {
      sourcePreviewDir: path.join(projectRoot, '.tools', 'source-preview-interface'),
      serviceAutoScan: false,
      musicScanRoots: [samplesRoot],
      sonyComponentLoaded: false,
      ftpConnectionUsed: false,
    };
    report.screenshots.push(dayScreenshot, nightScreenshot, playingScreenshot, portraitScreenshot);
    report.ok = true;
  } catch (error) {
    report.error = error?.stack ?? String(error);
  } finally {
    if (browserWindow && !browserWindow.isDestroyed()) {
      try {
        await browserWindow.webContents.executeJavaScript(`document.querySelector('#stop-playback')?.click()`, true);
        await pause(100);
      } catch {}
      try {
        if (nativeState?.session) await native.command({ cmd: 'stop', session: nativeState.session });
        await native?.stopCurrent();
      } catch {}
      try { browserWindow.hide(); } catch {}
    } else {
      try { await native?.stopCurrent(); } catch {}
    }
    try { await closeHttpServer(bundle?.server); } catch (error) {
      report.cleanupError = error?.message ?? String(error);
      report.ok = false;
    }
  }

  return report;
}
