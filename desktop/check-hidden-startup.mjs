import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';

const mainSource = await readFile(new URL('./main.cjs', import.meta.url), 'utf8');
const factoryStart = mainSource.indexOf('// HIDDEN_STARTUP_GATE_FACTORY_BEGIN');
const factoryEnd = mainSource.indexOf('// HIDDEN_STARTUP_GATE_FACTORY_END', factoryStart);
assert(factoryStart >= 0 && factoryEnd > factoryStart, 'Could not find the startup gate factory in main.cjs.');
const factorySource = mainSource.slice(factoryStart, factoryEnd)
  .replace('// HIDDEN_STARTUP_GATE_FACTORY_BEGIN', '')
  .trim();
const createHiddenStartupGate = vm.runInNewContext(`(${factorySource})`, { URL });

const origin = 'http://127.0.0.1:43127';

class MockWindow extends EventEmitter {
  constructor() {
    super();
    this.visible = false;
    this.minimized = false;
    this.destroyed = false;
    this.showCalls = 0;
    this.hideCalls = 0;
    this.focusCalls = 0;
    this.restoreCalls = 0;
    this.backgroundThrottling = true;
    this.startupOperations = [];
    this.webContents = new EventEmitter();
    this.webContents.setBackgroundThrottling = value => {
      this.backgroundThrottling = value;
      this.startupOperations.push(`throttle:${value}`);
    };
    this.webContents.mainFrame = { url: `${origin}/` };
    this.webContents.getURL = () => `${origin}/`;
  }

  isDestroyed() { return this.destroyed; }
  isMinimized() { return this.minimized; }
  isVisible() { return this.visible; }
  show() { this.showCalls++; this.visible = true; this.startupOperations.push('show'); }
  hide() { this.hideCalls++; this.visible = false; }
  focus() { this.focusCalls++; }
  restore() { this.restoreCalls++; this.minimized = false; this.visible = true; }
}

function mockRuntime() {
  const app = new EventEmitter();
  app.quitCalls = 0;
  app.quit = () => { app.quitCalls++; };
  const ipcMain = new EventEmitter();
  const dialog = { errors: [], showErrorBox(title, detail) { this.errors.push({ title, detail }); } };
  const window = new MockWindow();
  const gate = createHiddenStartupGate({ ipcMain, app, dialog, getWindow: () => window });
  gate.attachWindow(window, origin);
  const event = (sender = window.webContents, senderFrame = window.webContents.mainFrame) => ({ sender, senderFrame });
  const ready = (targetEvent = event()) => ipcMain.emit('rhine:frontend-ready', targetEvent);
  return { app, ipcMain, dialog, window, gate, event, ready };
}

const first = mockRuntime();
assert.equal(first.window.showCalls, 0, 'Window must begin hidden.');
assert.equal(first.window.backgroundThrottling, false, 'Hidden initialization must keep frame callbacks running.');
first.window.emit('ready-to-show');
first.window.webContents.emit('did-finish-load');
assert.equal(first.window.showCalls, 0, 'Electron load milestones must not release the gate.');
first.ready(first.event(first.window.webContents, { url: `${origin}/iframe`, parent: first.window.webContents.mainFrame }));
first.ready(first.event(new EventEmitter()));
first.ready({ sender: first.window.webContents, senderFrame: null });
assert.equal(first.window.showCalls, 0, 'Subframes and other webContents must not release the gate.');
first.ready();
assert.equal(first.gate.isReady(), true);
assert.equal(first.window.showCalls, 1, 'A valid frontendReady signal must show the window.');
assert.equal(first.window.backgroundThrottling, true, 'Normal background throttling must return after the window is shown.');
assert.ok(first.window.startupOperations.indexOf('show') < first.window.startupOperations.indexOf('throttle:true'));
first.ready();
assert.equal(first.window.showCalls, 1, 'Duplicate ready signals must not show twice.');

first.window.webContents.emit('did-start-navigation', {}, `${origin}/`, true, true);
assert.equal(first.gate.isReady(), true, 'In-page navigation must keep the current ready state.');
assert.equal(first.window.hideCalls, 0);
first.window.webContents.emit('did-start-navigation', {}, `${origin}/`, false, true);
assert.equal(first.gate.isReady(), false, 'A new main-frame load must reset readiness.');
assert.equal(first.window.hideCalls, 0, 'A reload must keep the existing window visible so frame callbacks continue.');
assert.equal(first.window.visible, true);
assert.equal(first.window.backgroundThrottling, false, 'Reload initialization must keep frame callbacks running too.');
first.app.emit('activate');
first.app.emit('second-instance');
assert.equal(first.window.showCalls, 1, 'Activation and second-instance requests must wait for readiness.');
first.ready();
assert.equal(first.window.showCalls, 1, 'The reloaded frontend must reuse the already visible window.');
assert.equal(first.window.backgroundThrottling, true);
assert.equal(first.window.focusCalls, 1, 'A queued activation should focus after readiness.');
first.ready();
assert.equal(first.window.showCalls, 1, 'Duplicate reload readiness must remain idempotent.');

first.window.webContents.emit('did-start-navigation', {}, `${origin}/`, false, true);
first.ipcMain.emit('rhine:frontend-failed', first.event(), 'scene warmup exploded');
first.ipcMain.emit('rhine:frontend-failed', first.event(), 'duplicate failure');
assert.equal(first.dialog.errors.length, 1, 'Frontend startup failure must be reported once.');
assert.match(first.dialog.errors[0].detail, /scene warmup exploded/);
assert.equal(first.app.quitCalls, 1, 'Frontend startup failure must quit after reporting.');

const failedLoad = mockRuntime();
failedLoad.window.webContents.emit('did-start-navigation', {}, `${origin}/`, false, true);
failedLoad.window.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', `${origin}/`, true);
assert.equal(failedLoad.dialog.errors.length, 0, 'Normal aborted navigation must not be reported as fatal.');
failedLoad.window.webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', `${origin}/`, true);
assert.equal(failedLoad.dialog.errors.length, 1, 'A failed main-frame load must be reported.');
assert.equal(failedLoad.app.quitCalls, 1);

const rendererGone = mockRuntime();
rendererGone.window.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
assert.equal(rendererGone.dialog.errors.length, 1, 'A lost renderer must be reported.');
assert.equal(rendererGone.app.quitCalls, 1);

const outsideFactory = mainSource.slice(0, factoryStart) + mainSource.slice(factoryEnd + '// HIDDEN_STARTUP_GATE_FACTORY_END'.length);
assert.match(mainSource, /show:false/);
assert.doesNotMatch(mainSource, /ready-to-show/);
assert.doesNotMatch(outsideFactory, /\.show\s*\(/, 'All window show calls must stay behind the tested gate.');

const preloadSource = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8');
assert.match(preloadSource, /frontendReady:\s*\(\)=>\{frontendReady=true;ipcRenderer\.send\('rhine:frontend-ready'\)/);
assert.match(preloadSource, /frontendFailed:\s*reportFrontendFailure/);

function mockPreload() {
  const sent = [];
  const listeners = new Map();
  let api;
  const window = { addEventListener(name, handler) { listeners.set(name, handler); } };
  const electron = {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'rhineDesktop'); api = value; } },
    ipcRenderer: {
      sendSync(channel) {
        if (channel === 'rhine:preferences:get') return {};
        return { ok: true, exists: false, value: { schemaVersion: 1, activeId: null, presets: [], eqBanks: {} } };
      },
      send(channel, ...args) { sent.push([channel, ...args]); },
      invoke: async () => ({ ok: true }),
    },
  };
  vm.runInNewContext(preloadSource, {
    require: name => { assert.equal(name, 'electron'); return electron; },
    window,
    localStorage: { setItem() {} },
  });
  return { api, listeners, sent };
}

const earlyError = mockPreload();
earlyError.listeners.get('error')({ error: new Error('module failed'), message: 'module failed' });
earlyError.api.frontendFailed('scene warmup failed');
assert.equal(earlyError.sent.length, 1, 'Pre-ready frontend errors must be reported once.');
assert.equal(earlyError.sent[0][0], 'rhine:frontend-failed');
assert.match(earlyError.sent[0][1], /module failed/);

const readyFrontend = mockPreload();
readyFrontend.api.frontendReady();
readyFrontend.listeners.get('unhandledrejection')({ reason: new Error('late rejection') });
assert.deepEqual(readyFrontend.sent.map(item => item[0]), ['rhine:frontend-ready'], 'Errors after readiness must not close a healthy window.');

console.log('Hidden startup gate mock checks passed: initial release, duplicate ready, reload, activation, IPC ownership, early frontend errors, and fatal paths.');
