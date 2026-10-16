import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createMusicServer } from '../scripts/music-server.mjs';
import { MusicLibraryStore } from '../scripts/music-library.mjs';

const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const require = createRequire(import.meta.url);

function redactedTarget(value, baseURL) {
  try {
    const url = new URL(value, baseURL);
    return `${url.protocol}//${url.host}`;
  } catch {
    return String(value).slice(0, 80);
  }
}

function allowedURL(value, localOrigin) {
  try {
    const url = new URL(value);
    return url.origin === localOrigin || ['file:', 'data:', 'blob:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function mockNative() {
  const calls = { status: 0, eqEditor: 0, previewEq: 0, current: 0, refresh: 0, start: 0, queue: 0, control: 0, stopCurrent: 0 };
  return {
    calls,
    async status() {
      calls.status++;
      return { available: false, backend: 'preview-mock', devices: [], error: '隔离预览：原生音频设备不可用。' };
    },
    async eqEditor() {
      calls.eqEditor++;
      return { editorOpen: false, active: false, latencyFrames: 0, revision: 0, pluginState: {} };
    },
    async previewEq() { calls.previewEq++; throw new Error('隔离预览未启用 EQ 音频预览。'); },
    async current() { calls.current++; return { available: false, session: null, playing: false }; },
    async refresh() { calls.refresh++; return this.status(); },
    async start() { calls.start++; throw new Error('隔离预览禁止启动原生音频。'); },
    async queue() { calls.queue++; throw new Error('隔离预览禁止启动原生音频。'); },
    async control() { calls.control++; throw new Error('隔离预览禁止控制原生音频。'); },
    async stopCurrent() { calls.stopCurrent++; return { stopped: true }; },
    close() {},
  };
}

export function mockSony() {
  const calls = { status: 0, prepare: 0, clearCache: 0, audio: 0, growingAudio: 0, job: 0, cancel: 0 };
  return {
    calls,
    async status() {
      calls.status++;
      return { available: false, original: false, error: '隔离预览未加载 Sony 音效组件。' };
    },
    async prepare() { calls.prepare++; throw new Error('隔离预览禁止启动 Sony 音效处理。'); },
    async clearCache() { calls.clearCache++; return { cleared: false }; },
    async audio() { calls.audio++; throw new Error('隔离预览没有 Sony 音频缓存。'); },
    async growingAudio() { calls.growingAudio++; throw new Error('隔离预览没有 Sony 音频缓存。'); },
    async job() { calls.job++; return { state: 'missing' }; },
    cancel() { calls.cancel++; return { cancelled: false }; },
    close() {},
  };
}

export function mockFtp() {
  const unavailable = async () => { throw new Error('隔离预览已禁用 FTP 网络。'); };
  return {
    status: () => ({ configured: false, connected: false, note: 'isolated preview' }),
    snapshot: () => [],
    trackFile: () => undefined,
    artworkFile: () => null,
    close() {},
    test: unavailable,
    configure: unavailable,
    disconnect: async () => ({ connected: false }),
    clearCache: async () => ({ cleared: false }),
    scan: unavailable,
    ensure: unavailable,
  };
}

export function mockOnline() {
  return {
    async snapshot() { return { albums: [] }; },
    async sources() { return { sources: [] }; },
    async configureSubsonic() { throw new Error('隔离预览已禁用在线曲库。'); },
    async testSubsonic() { throw new Error('隔离预览已禁用在线曲库。'); },
    async search() { throw new Error('隔离预览已禁用在线曲库。'); },
    async add() { throw new Error('隔离预览已禁用在线曲库。'); },
    async remove() { throw new Error('隔离预览已禁用在线曲库。'); },
    async trackTarget() { return null; },
    async coverTarget() { return null; },
  };
}

async function closeHttpServer(server) {
  if (!server?.listening) return;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await closed;
}

export async function runPreviewUICheck({ root, dataDir, BrowserWindow, ownWindow }) {
  const report = {
    ok: false,
    checks: {},
    screenshots: [],
    syntheticDataOnly: true,
    musicScanInvoked: false,
    realAudioDevicesUsed: false,
    realMusicFilesRead: false,
    onlineNetworkReachable: false,
    rendererExternalRequestsBlocked: true,
    mainProcessExternalFetchBlocked: true,
    blockedExternalRequests: [],
    browserRuntimeErrors: [],
    browserConsoleErrors: [],
  };

  let bundle;
  let browserWindow;
  let pageSession;
  let originalFetch;
  let blockedFetch;
  let dialogObject;
  let originalShowMessageBox;
  let requestFilter;
  let syntheticDataDir;
  let storageDir;
  let mockNativeInstance;
  let mockSonyInstance;
  const uncaughtConsoleErrors = [];
  const failedMainFrameLoads = [];

  try {
    assert(root && dataDir && BrowserWindow && typeof ownWindow === 'function',
      'root, dataDir, BrowserWindow and ownWindow are required.');
    const projectRoot = path.resolve(root);
    const distDir = path.join(projectRoot, 'dist');
    storageDir = await mkdtemp(path.join(path.resolve(dataDir), 'preview-ui-check-'));
    syntheticDataDir = path.join(storageDir, 'synthetic');
    const artifactDir = path.join(syntheticDataDir, 'artifacts');
    await mkdir(artifactDir, { recursive: true });
    report.artifactDirectory = artifactDir;
    report.syntheticDataDir = syntheticDataDir;

    const localFetchAttempts = [];
    const serviceOriginHolder = { value: '' };
    originalFetch = globalThis.fetch;
    blockedFetch = async (input, init) => {
      const target = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      if (serviceOriginHolder.value && allowedURL(target, serviceOriginHolder.value)) {
        return originalFetch(input, init);
      }
      localFetchAttempts.push(redactedTarget(target ?? '<unknown>', serviceOriginHolder.value || 'http://127.0.0.1'));
      throw new Error('This isolated UI check blocks external fetch requests.');
    };
    globalThis.fetch = blockedFetch;

    const store = await new MusicLibraryStore({
      dataDir: syntheticDataDir,
      defaultRoots: [],
      musicBrainzContact: '',
      fetcher: blockedFetch,
    }).init();
    const originalScan = store.scan.bind(store);
    store.scan = async () => {
      report.musicScanInvoked = true;
      return originalScan({ roots: [] });
    };
    const initialLibrary = store.snapshot();
    assert(initialLibrary.albums.length === 0, 'Synthetic preview library must start empty.');
    assert(initialLibrary.roots.length === 0, 'Synthetic preview library must not contain music roots.');

    mockNativeInstance = mockNative();
    mockSonyInstance = mockSony();
    const ftp = mockFtp();
    const online = mockOnline();
    bundle = await createMusicServer({
      dataDir: syntheticDataDir,
      distDir,
      defaultRoots: [],
      autoScan: false,
      store,
      native: mockNativeInstance,
      sony: mockSonyInstance,
      ftp,
      online,
    });

    await new Promise((resolve, reject) => {
      bundle.server.once('error', reject);
      bundle.server.listen(0, '127.0.0.1', resolve);
    });
    const address = bundle.server.address();
    assert(address && typeof address === 'object', 'Preview service did not bind an ephemeral loopback port.');
    const baseURL = `http://127.0.0.1:${address.port}`;
    serviceOriginHolder.value = new URL(baseURL).origin;
    report.serviceOrigin = serviceOriginHolder.value;

    const partition = `rhine-preview-ui-${randomUUID()}`;
    browserWindow = new BrowserWindow({
      width: 1024,
      height: 720,
      show: false,
      paintWhenInitiallyHidden: true,
      backgroundColor: '#e8e5e1',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(projectRoot, 'desktop', 'preload.cjs'),
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    ownWindow(browserWindow);
    browserWindow.webContents.setAudioMuted(true);
    pageSession = browserWindow.webContents.session;
    requestFilter = (details, callback) => {
      if (allowedURL(details.url, serviceOriginHolder.value)) {
        callback({});
        return;
      }
      report.blockedExternalRequests.push(redactedTarget(details.url, baseURL));
      callback({ cancel: true });
    };
    pageSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, requestFilter);

    browserWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    browserWindow.webContents.on('will-navigate', (event, target) => {
      if (!allowedURL(target, serviceOriginHolder.value)) event.preventDefault();
    });
    browserWindow.webContents.on('console-message', (...args) => {
      const details = args[1];
      let level;
      let message;
      let line;
      let source;
      if (details && typeof details === 'object') {
        level = details.level;
        message = details.message ?? details.text ?? '';
        line = details.lineNumber ?? details.line;
        source = details.sourceId ?? details.source;
      } else {
        [, level, message, line, source] = args;
      }
      if (level === 'error' || level === 3) {
        const item = { message: String(message ?? ''), line: Number(line) || 0, source: String(source ?? '') };
        report.browserConsoleErrors.push(item);
        if (/uncaught|unhandled rejection/i.test(item.message)) uncaughtConsoleErrors.push(item);
      }
    });
    browserWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
      if (isMainFrame) failedMainFrameLoads.push({ code, description, url: redactedTarget(validatedURL, baseURL) });
    });
    browserWindow.webContents.on('render-process-gone', (_event, details) => {
      report.browserRuntimeErrors.push({ type: 'render-process-gone', details });
    });

    await browserWindow.loadURL(baseURL);
    const evaluate = code => browserWindow.webContents.executeJavaScript(code, true);
    const waitFor = async (code, label, timeoutMs = 45000) => {
      const started = Date.now();
      let lastError;
      while (Date.now() - started < timeoutMs) {
        if (browserWindow.isDestroyed()) throw new Error('Preview UI BrowserWindow was destroyed.');
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
    const click = async selector => {
      const found = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
      assert(found, `Could not click ${selector}`);
    };
    const capture = async name => {
      await pause(400);
      const image = await browserWindow.webContents.capturePage();
      const thumbnail = image.resize({ width: 768 });
      const filename = path.join(artifactDir, name);
      await writeFile(filename, thumbnail.toPNG(), { flag: 'wx' });
      report.screenshots.push(filename);
      return filename;
    };

    const rootState = await waitFor(`(() => {
      const stage = document.querySelector('#stage');
      const header = stage?.querySelector('.music-header');
      const loading = document.querySelector('#music-loading');
      return stage && header && stage.children.length > 0 && !loading
        ? { stageChildren: stage.children.length, design: stage.dataset.design || '', header: header.tagName }
        : null;
    })()`, 'app root and header');
    assert(rootState.stageChildren > 0 && rootState.header === 'HEADER', 'App root/header did not render.');
    report.checks.rootAndHeader = true;

    await evaluate(`(() => {
      window.__rhinePreviewUICheckErrors = [];
      window.addEventListener('error', event => {
        window.__rhinePreviewUICheckErrors.push({ type: 'error', message: event.message || String(event.error || 'unknown error') });
      }, true);
      window.addEventListener('unhandledrejection', event => {
        const reason = event.reason;
        window.__rhinePreviewUICheckErrors.push({ type: 'unhandledrejection', message: String(reason?.stack || reason || 'unknown rejection') });
      }, true);
    })()`);
    const initialUI = await evaluate(`(() => {
      const stage = document.querySelector('#stage');
      const header = stage?.querySelector('.music-header');
      const styleSheets = Array.from(document.styleSheets, sheet => sheet.href).filter(Boolean);
      const resources = performance.getEntriesByType('resource').map(item => item.name);
      return {
        design: stage?.dataset.design || '',
        themePageExists: !!document.querySelector('#music-theme-page'),
        emptyCollectionVisible: document.querySelector('#music-empty')?.hidden === false,
        headerDisplay: header ? getComputedStyle(header).display : '',
        headerWidth: header?.getBoundingClientRect().width || 0,
        styleSheets,
        scriptCount: document.querySelectorAll('script[src]').length,
        localScriptsLoaded: resources.filter(name => name.startsWith(location.origin) && /\\.m?js(?:[?#]|$)/i.test(name)).length,
        stageText: stage?.innerText?.slice(0, 160) || '',
      };
    })()`);
    assert(initialUI.headerDisplay !== 'none' && initialUI.headerWidth > 0, 'Header styles did not apply.');
    assert(initialUI.styleSheets.length > 0 && initialUI.scriptCount > 0 && initialUI.localScriptsLoaded > 0,
      'Built CSS or JavaScript assets were not loaded from the local dist.');
    assert(initialUI.emptyCollectionVisible, 'The empty synthetic library did not render its empty state.');
    report.initialUI = initialUI;
    report.checks.stylesAndBuiltAssets = true;
    report.checks.syntheticEmptyLibrary = true;

    const assetResults = await evaluate(`(async () => {
      const paths = ['/favicon.svg', '/manifest.webmanifest'];
      return Promise.all(paths.map(async path => {
        const response = await fetch(path, { cache: 'no-store' });
        return { path, status: response.status, contentType: response.headers.get('content-type') || '' };
      }));
    })()`);
    assert(assetResults.every(item => item.status === 200), `A local dist asset failed: ${JSON.stringify(assetResults)}`);
    report.distAssets = assetResults;
    report.checks.localDistAssets = true;

    const initialScreenshot = await capture('initial-ui.png');
    report.checks.initialScreenshot = true;

    await click('button[data-action="theme"]');
    await waitFor(`!document.querySelector('#music-theme-page')?.hidden && document.querySelector('#music-theme-page [data-style-design="rhine"]')`,
      'theme page and Future design control');
    await click('#music-theme-page [data-style-design="rhine"]');
    await waitFor(`document.querySelector('#stage')?.dataset.design === 'rhine' && document.querySelector('.music-brand strong')?.textContent === 'RHINE LAB'`,
      'Future theme components');
    report.checks.futureTheme = true;
    const futureScreenshot = await capture('future-theme.png');

    await click('#music-theme-page [data-style-design="archive"]');
    await waitFor(`document.querySelector('#stage')?.dataset.design === 'archive' && document.querySelector('.music-brand strong')?.textContent === 'AUDIO ARCHIVE'`,
      'Punk theme components');
    report.checks.punkTheme = true;
    const punkScreenshot = await capture('punk-theme.png');
    report.screenshots = [initialScreenshot, futureScreenshot, punkScreenshot];

    dialogObject = require('electron').dialog;
    originalShowMessageBox = dialogObject.showMessageBox;
    let knownIssuesDialog;
    dialogObject.showMessageBox = async (_window, options) => {
      knownIssuesDialog = { title: options?.title, message: options?.message, detail: options?.detail };
      return { response: 0 };
    };
    try {
      await evaluate(`window.rhineDesktop.showKnownIssues('en').then(() => true)`);
    } finally {
      dialogObject.showMessageBox = originalShowMessageBox;
      originalShowMessageBox = undefined;
    }
    assert(knownIssuesDialog && String(knownIssuesDialog.detail).includes('384 kHz'),
      'Known-issues IPC did not load its background module.');
    report.knownIssuesIPC = { loaded: true, dialogSuppressed: true, title: knownIssuesDialog.title };
    report.checks.knownIssuesModule = true;

    await pause(400);
    const rendererErrors = await evaluate('window.__rhinePreviewUICheckErrors || []');
    report.browserRuntimeErrors.push(...rendererErrors);
    report.browserRuntimeErrors.push(...uncaughtConsoleErrors);
    if (failedMainFrameLoads.length) report.failedMainFrameLoads = failedMainFrameLoads;
    assert(report.browserRuntimeErrors.length === 0, `Browser reported uncaught JavaScript errors: ${JSON.stringify(report.browserRuntimeErrors)}`);
    assert(failedMainFrameLoads.length === 0, `Main frame navigation failed: ${JSON.stringify(failedMainFrameLoads)}`);
    report.checks.noUncaughtJavaScriptErrors = true;

    report.localFetchAttempts = localFetchAttempts;
    report.checks.outboundNetworkBlocked = true;
    report.checks.nativeAudioMocked = true;
    report.checks.scanDisabled = bundle.server.listening && store.snapshot().roots.length === 0 && !store.scanPromise;
    assert(report.checks.scanDisabled && report.musicScanInvoked === false,
      'Preview check must not scan any music directory.');
    assert(mockNativeInstance.calls.start === 0 && mockNativeInstance.calls.queue === 0
      && mockNativeInstance.calls.control === 0 && mockNativeInstance.calls.previewEq === 0,
    'Preview check attempted to use a native audio operation.');
    assert(mockSonyInstance.calls.prepare === 0 && mockSonyInstance.calls.audio === 0
      && mockSonyInstance.calls.growingAudio === 0,
    'Preview check attempted to use Sony audio processing.');
    report.isolationEvidence = {
      defaultRoots: [],
      autoScan: false,
      libraryAlbums: store.snapshot().albums.length,
      libraryRoots: store.snapshot().roots.length,
      nativeImplementation: 'mock only; no native host constructed',
      nativeCalls: mockNativeInstance.calls,
      sonyImplementation: 'mock only; no Sony worker constructed',
      sonyCalls: mockSonyInstance.calls,
      ftpImplementation: 'mock only; no connection loaded',
      onlineImplementation: 'mock only; no remote source contacted',
      rendererBlockedRequestCount: report.blockedExternalRequests.length,
      mainBlockedFetchCount: localFetchAttempts.length,
    };
    report.ok = true;
  } catch (error) {
    report.error = error?.stack ?? String(error);
    report.localFetchAttempts ??= [];
    if (failedMainFrameLoads.length) report.failedMainFrameLoads = failedMainFrameLoads;
  } finally {
    if (originalShowMessageBox && dialogObject) {
      try { dialogObject.showMessageBox = originalShowMessageBox; } catch {}
    }
    if (browserWindow && !browserWindow.isDestroyed()) {
      try { browserWindow.destroy(); } catch (error) { report.windowCleanupError = error?.message ?? String(error); report.ok = false; }
    }
    if (browserWindow) {
      try { ownWindow(undefined); } catch {}
    }
    try { await closeHttpServer(bundle?.server); } catch (error) {
      report.serverCleanupError = error?.message ?? String(error);
      report.ok = false;
    }
    if (originalFetch && globalThis.fetch === blockedFetch) globalThis.fetch = originalFetch;
    if (storageDir) report.syntheticRoot = storageDir;
    report.blockedExternalRequests = [...new Set(report.blockedExternalRequests)];
  }

  return report;
}
