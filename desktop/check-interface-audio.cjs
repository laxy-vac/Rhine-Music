// Isolated Electron acceptance for OfflineAudioContext rendering and the
// browser-side native interface-audio sink. No preload, music server, library,
// or real audio device is used.
// Run with: node desktop/check-interface-audio.cjs

const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');

if (require.main === module) {
  runLauncher().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}

const rendererModule = String.raw`
import { renderInterfaceSound, TerminalAudio } from '/src/audio.ts';
import { InterfaceAudioClient } from '/src/interface-audio.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (checks, name, condition, detail = '') => {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''));
  checks.push(name);
};
const routeCount = async route => {
  const records = await fetch('/__records', { cache: 'no-store' }).then(response => response.json());
  return records.filter(record => record.route === route).length;
};
const waitFor = async (predicate, label, timeout = 8000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for ' + label);
};
const apiRecords = async () => fetch('/__records', { cache: 'no-store' }).then(response => response.json());
const audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
const nativeAudioContext = globalThis.AudioContext;
let audioContextConstructions = 0;
let simulatedHidden = false;
Object.defineProperty(globalThis, 'AudioContext', {
  configurable: true,
  writable: true,
  value: class ForbiddenRealAudioContext {
    constructor() {
      audioContextConstructions++;
      throw new Error('A real AudioContext is forbidden in this isolated probe.');
    }
  },
});
Object.defineProperty(document, 'hidden', {
  configurable: true,
  get: () => simulatedHidden,
});

window.__interfaceAudioProbe = {
  renderStarted: false,
  releaseRender: undefined,
  async run() {
    const checks = [];
    const errors = [];
    let terminal;
    let client;
    const prefs = { sound: true, music: false, soundVolume: 0.42, musicVolume: 0 };
    try {
      const rendered = await renderInterfaceSound('tick', 0);
      const wav = rendered.wav;
      const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
      const fourCc = (offset, length) => String.fromCharCode(...wav.subarray(offset, offset + length));
      let nonZeroSamples = 0;
      let peak = 0;
      for (let offset = 44; offset + 1 < wav.length; offset += 2) {
        const sample = Math.abs(view.getInt16(offset, true));
        if (sample > 0) nonZeroSamples++;
        if (sample > peak) peak = sample;
      }
      check(checks, 'OfflineAudioContext rendered PCM16 WAV',
        fourCc(0, 4) === 'RIFF' && fourCc(8, 4) === 'WAVE' && fourCc(12, 4) === 'fmt ' &&
        view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1 &&
        view.getUint16(22, true) === 2 && view.getUint32(24, true) === 48000 &&
        view.getUint32(28, true) === 192000 && view.getUint16(32, true) === 4 &&
        view.getUint16(34, true) === 16 && fourCc(36, 4) === 'data' &&
        view.getUint32(4, true) === wav.length - 8 && view.getUint32(40, true) === wav.length - 44,
        'invalid RIFF/WAVE PCM16 stereo 48 kHz header');
      check(checks, 'OfflineAudioContext output is audible data, not silence', nonZeroSamples > 0 && peak > 0,
        'sample peak was ' + peak);
      const payloadDuration = (wav.length - 44) / 192000;
      check(checks, 'rendered WAV duration matches its frame count',
        rendered.duration > 0 && rendered.duration <= 2.5 && Math.abs(rendered.duration - payloadDuration) < 1 / 48000,
        'duration=' + rendered.duration + ', payload=' + payloadDuration);

      client = new InterfaceAudioClient(error => errors.push(String(error?.message ?? error)));
      client.configure({
        design: 'rhine', enabled: true, musicBusy: false,
        output: { backend: 'wasapi', device: -1, channel: 0, wasapiDevice: 'mock-endpoint-id' },
      });
      terminal = new TerminalAudio();
      terminal.setEffectSink(client);
      terminal.configure(prefs);
      await waitFor(() => routeCount('configure').then(count => count >= 1), 'mock native configure request');

      const beforeGesture = await routeCount('play');
      terminal.play('tick');
      await delay(80);
      check(checks, 'external sink waits for a real input gesture', await routeCount('play') === beforeGesture);

      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      terminal.play('tick');
      await waitFor(() => routeCount('play').then(count => count > beforeGesture), 'mock native play after gesture');
      let records = await apiRecords();
      const firstPlay = records.filter(record => record.route === 'play').at(-1);
      check(checks, 'mock native play receives the rendered cue and volume',
        firstPlay?.payload?.sound === 'tick' && firstPlay?.payload?.volume === prefs.soundVolume &&
        Number.isInteger(firstPlay?.wavLength) && firstPlay.wavLength > 44,
        JSON.stringify(firstPlay?.payload ?? null));
      check(checks, 'client does not forward a file path',
        !Object.hasOwn(firstPlay?.payload ?? {}, 'file') && !Object.hasOwn(firstPlay?.payload ?? {}, 'path'));
      const configRecord = records.find(record => record.route === 'configure');
      check(checks, 'client configures the selected native output',
        configRecord?.payload?.design === 'rhine' && configRecord?.payload?.output?.backend === 'wasapi' &&
        configRecord?.payload?.output?.wasapiDevice === 'mock-endpoint-id');

      let stopCount = await routeCount('stop');
      terminal.setScene('detail');
      await waitFor(() => routeCount('stop').then(count => count > stopCount), 'scene-change stop');
      check(checks, 'scene change stops the external UI voice', true);

      let playCount = await routeCount('play');
      terminal.play('column');
      await waitFor(() => routeCount('play').then(count => count > playCount), 'second external cue');
      playCount = await routeCount('play');
      stopCount = await routeCount('stop');
      simulatedHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => routeCount('stop').then(count => count > stopCount), 'hidden-page stop');
      check(checks, 'hidden page stops the external UI voice', true);
      terminal.play('open');
      await delay(80);
      check(checks, 'hidden page refuses new external cues', await routeCount('play') === playCount);

      simulatedHidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      terminal.play('page-open');
      await waitFor(() => routeCount('play').then(count => count > playCount), 'cue after becoming visible');
      playCount = await routeCount('play');
      stopCount = await routeCount('stop');
      terminal.configure({ sound: false, music: false, soundVolume: prefs.soundVolume, musicVolume: 0 });
      await waitFor(() => routeCount('stop').then(count => count > stopCount), 'disable-sound stop');
      check(checks, 'disabling sound stops the external UI voice', true);
      terminal.play('ui-tick');
      await delay(80);
      check(checks, 'disabled sound refuses new external cues', await routeCount('play') === playCount);

      terminal.configure(prefs);
      const offlinePrototype = OfflineAudioContext.prototype;
      const originalStartRendering = offlinePrototype.startRendering;
      let holdNextRender = true;
      this.renderStarted = false;
      this.releaseRender = undefined;
      offlinePrototype.startRendering = function (...args) {
        const renderedBuffer = originalStartRendering.apply(this, args);
        if (!holdNextRender) return renderedBuffer;
        holdNextRender = false;
        window.__interfaceAudioProbe.renderStarted = true;
        return renderedBuffer.then(buffer => new Promise(resolve => {
          window.__interfaceAudioProbe.releaseRender = () => resolve(buffer);
        }));
      };
      try {
        playCount = await routeCount('play');
        terminal.play('brand');
        await waitFor(() => Promise.resolve(this.renderStarted), 'delayed OfflineAudioContext render started');
        await waitFor(() => Promise.resolve(typeof this.releaseRender === 'function'), 'delayed render gate');
        stopCount = await routeCount('stop');
        terminal.setScene('viewer');
        await waitFor(() => routeCount('stop').then(count => count > stopCount), 'stop while render is delayed');
        this.releaseRender();
        await delay(120);
        check(checks, 'stop during offline rendering prevents a late native play', await routeCount('play') === playCount);
      } finally {
        offlinePrototype.startRendering = originalStartRendering;
      }

      check(checks, 'native output path never constructs a real AudioContext', audioContextConstructions === 0,
        'AudioContext construction count=' + audioContextConstructions);
      check(checks, 'client reports no unexpected errors', errors.length === 0, errors.join('; '));
      const finalRecords = await apiRecords();
      check(checks, 'only interface-audio endpoints were called',
        finalRecords.every(record => ['configure', 'play', 'stop'].includes(record.route)));
      return {
        ok: true,
        checks,
        requestCounts: {
          configure: finalRecords.filter(record => record.route === 'configure').length,
          play: finalRecords.filter(record => record.route === 'play').length,
          stop: finalRecords.filter(record => record.route === 'stop').length,
        },
        audioContextConstructions,
        wav: { bytes: wav.length, duration: rendered.duration, nonZeroSamples, peak },
      };
    } catch (error) {
      return { ok: false, checks, error: String(error?.stack ?? error), audioContextConstructions, errors };
    } finally {
      try { terminal?.dispose(); } catch {}
      if (audioContextDescriptor) Object.defineProperty(globalThis, 'AudioContext', audioContextDescriptor);
      else delete globalThis.AudioContext;
      if (hiddenDescriptor) Object.defineProperty(document, 'hidden', hiddenDescriptor);
      else delete document.hidden;
    }
  },
};
window.__interfaceAudioProbeReady = true;
`;

async function runLauncher() {
  const projectRoot = path.resolve(__dirname, '..');
  const artifactRoot = path.join(projectRoot, '.tools', 'interface-audio-check-2026-10-17');
  const runDirectory = path.join(artifactRoot, `desktop-${Date.now()}-${process.pid}-${randomBytes(3).toString('hex')}`);
  const appDirectory = path.join(runDirectory, 'electron-app');
  const profileDirectory = path.join(runDirectory, 'profile');
  const reportPath = path.join(runDirectory, 'report.json');
  const configPath = path.join(runDirectory, 'config.json');
  const electronPath = path.join(projectRoot, '.tools', 'source-preview-electron', 'electron.exe');
  const sourceRoot = path.join(projectRoot, 'src');
  const apiRequests = [];
  let server;
  let child;

  try {
    await fs.access(electronPath);
    const { transformWithEsbuild } = await import('vite');
    server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://127.0.0.1');
        if (request.method === 'GET' && url.pathname === '/') {
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          });
          response.end('<!doctype html><html><head><meta charset="utf-8"><title>Interface audio mock probe</title></head><body><main>Isolated interface audio probe</main><script type="module" src="/probe.js"></script></body></html>');
          return;
        }
        if (request.method === 'GET' && url.pathname === '/probe.js') {
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(rendererModule);
          return;
        }
        if (request.method === 'GET' && url.pathname === '/__records') {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify(apiRequests));
          return;
        }
        if (request.method === 'POST' && /^\/api\/interface-audio\/(configure|play|stop)$/.test(url.pathname)) {
          let body = '';
          for await (const chunk of request) {
            body += chunk.toString('utf8');
            if (body.length > 1024 * 1024) throw new Error('Mock native request exceeded 1 MiB.');
          }
          const route = url.pathname.split('/').at(-1);
          const payload = JSON.parse(body || '{}');
          apiRequests.push({
            route,
            payload: { ...payload, wav: undefined },
            wavLength: typeof payload.wav === 'string' ? payload.wav.length : 0,
            receivedAt: Date.now(),
          });
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url.pathname.startsWith('/src/')) {
          const requested = decodeURIComponent(url.pathname.slice('/src/'.length));
          const base = path.resolve(sourceRoot, requested);
          const relative = path.relative(sourceRoot, base);
          if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            response.writeHead(403); response.end('Forbidden'); return;
          }
          const candidates = path.extname(base) ? [base] : [`${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}.js`];
          let filename;
          for (const candidate of candidates) {
            try { await fs.access(candidate); filename = candidate; break; } catch {}
          }
          if (!filename) { response.writeHead(404); response.end('Source not found'); return; }
          const source = await fs.readFile(filename, 'utf8');
          if (/\.(?:ts|tsx)$/.test(filename)) {
            const transformed = await transformWithEsbuild(source, filename, {
              loader: filename.endsWith('.tsx') ? 'tsx' : 'ts',
              target: 'es2022',
              format: 'esm',
              sourcemap: false,
              define: { 'import.meta.env.BASE_URL': JSON.stringify('/') },
            });
            response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(transformed.code);
            return;
          }
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
          response.end(source);
          return;
        }
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
      } catch (error) {
        response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end(error?.stack ?? String(error));
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    await fs.mkdir(appDirectory, { recursive: true });
    await fs.mkdir(profileDirectory, { recursive: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await fs.writeFile(configPath, JSON.stringify({ origin, profileDirectory, reportPath }), 'utf8');
    await fs.writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({
      name: 'rhine-interface-audio-isolated-probe', version: '1.0.0', main: 'main.cjs',
    }, null, 2));
    await fs.writeFile(path.join(appDirectory, 'main.cjs'), fsHeaderForElectron(), 'utf8');

    const environment = { ...process.env, RHINE_INTERFACE_AUDIO_PROBE_CONFIG: configPath };
    delete environment.ELECTRON_RUN_AS_NODE;
    const childResult = await new Promise((resolve, reject) => {
      child = spawn(electronPath, [appDirectory], {
        cwd: projectRoot,
        env: environment,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => child.kill(), 90000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16000); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-16000); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
    });
    const report = await fs.readFile(reportPath, 'utf8').then(JSON.parse).catch(() => null);
    if (childResult.code !== 0 || !report?.ok) {
      throw new Error(`Isolated Electron interface-audio probe failed.\n${JSON.stringify({ child: childResult, report }, null, 2)}`);
    }
    const allowed = new Set(['configure', 'play', 'stop']);
    assert.ok(apiRequests.every(request => allowed.has(request.route)), 'Mock native received a non-interface-audio route.');
    assert.ok(report.result?.ok && report.result?.checks?.length >= 8, 'Renderer probe did not complete its assertions.');
    console.log(JSON.stringify({
      ok: true,
      electronPath,
      runDirectory,
      reportPath,
      rendererChecks: report.result.checks,
      renderedWav: report.result.wav,
      nativeRequests: apiRequests.map(request => ({ route: request.route, sound: request.payload.sound ?? null, wavLength: request.wavLength })),
      realAudioContextConstructions: report.result.audioContextConstructions,
    }, null, 2));
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (server) await new Promise(resolve => server.close(resolve));
  }
}

function fsHeaderForElectron() {
  return `const fs = require('node:fs/promises');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const configPath = process.env.RHINE_INTERFACE_AUDIO_PROBE_CONFIG;
async function run() {
  let config;
  let window;
  const consoleMessages = [];
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    await fs.mkdir(config.profileDirectory, { recursive: true });
    app.setPath('userData', config.profileDirectory);
    await app.whenReady();
    window = new BrowserWindow({
      width: 900, height: 700, show: false, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    window.webContents.setAudioMuted(true);
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.webContents.session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try { if (new URL(details.url).origin === config.origin) return callback({}); } catch {}
      callback({ cancel: true });
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('console-message', (...args) => {
      const message = args[2] ?? args[1]?.message ?? args[1]?.text ?? '';
      consoleMessages.push(String(message).slice(0, 1200));
    });
    await window.loadURL(config.origin);
    const readyDeadline = Date.now() + 15000;
    let rendererReady = false;
    while (Date.now() < readyDeadline) {
      rendererReady = await window.webContents.executeJavaScript('window.__interfaceAudioProbeReady === true', true).catch(() => false);
      if (rendererReady) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!rendererReady) throw new Error('Renderer module graph did not become ready.');
    let timeout;
    let result;
    try {
      result = await Promise.race([
        window.webContents.executeJavaScript('window.__interfaceAudioProbe.run()', true),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Renderer probe timed out.')), 60000); }),
      ]);
    } finally { clearTimeout(timeout); }
    await fs.writeFile(config.reportPath, JSON.stringify({ ok: result?.ok === true, result, consoleMessages }, null, 2), 'utf8');
    if (!result?.ok) throw new Error(result?.error || 'Renderer probe failed.');
    window.destroy();
    app.quit();
  } catch (error) {
    if (config?.reportPath) await fs.writeFile(config.reportPath, JSON.stringify({ ok: false, error: error?.stack ?? String(error), consoleMessages }, null, 2), 'utf8').catch(() => {});
    console.error(error?.stack ?? error);
    try { if (window && !window.isDestroyed()) window.destroy(); } catch {}
    app.exit(1);
  }
}
run();`;
}

