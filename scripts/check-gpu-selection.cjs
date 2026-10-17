'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  adapterToPreference,
  normalizeGpuPreference,
  resolveGpuPreference,
  applyGpuPreference,
} = require('../desktop/gpu-selection.cjs');

function rawAdapter(overrides = {}) {
  return {
    vendorId: 0x10de,
    deviceId: 0x2684,
    subSysId: 0x12345678,
    revision: 0xa1,
    name: 'NVIDIA GeForce RTX Fixture',
    luidHigh: 1,
    luidLow: 17,
    ...overrides,
  };
}

function withId(adapter) {
  const identity = [
    adapter.vendorId,
    adapter.deviceId,
    adapter.subSysId,
    adapter.revision,
    adapter.name.trim().toLowerCase(),
  ];
  const hash = createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex');
  return { id: `gpu:${hash}@${adapter.luidHigh},${adapter.luidLow}`, ...adapter };
}

function otherModel(overrides = {}) {
  return rawAdapter({ deviceId: 0x1234, name: 'Other GPU Fixture', ...overrides });
}

function captureSwitches(isReady = false) {
  const calls = [];
  const app = {
    isReady: () => isReady,
    commandLine: {
      appendSwitch: (...args) => calls.push(args),
    },
  };
  return { app, calls };
}

test('missing and explicit automatic preferences normalize to auto', () => {
  assert.equal(normalizeGpuPreference(), 'auto');
  assert.equal(normalizeGpuPreference(null), 'auto');
  assert.equal(normalizeGpuPreference('auto'), 'auto');
});

test('manual preferences require the exact shape and a matching id', () => {
  const preference = withId(rawAdapter());
  assert.deepEqual(normalizeGpuPreference(preference), preference);
  assert.throws(() => normalizeGpuPreference('high-performance'), /object/);
  assert.throws(() => normalizeGpuPreference({}), /missing or unknown fields/);
  assert.throws(() => normalizeGpuPreference({ ...preference, extra: true }), /missing or unknown fields/);
  assert.throws(() => normalizeGpuPreference({ ...preference, id: 'gpu:tampered' }), /id does not match/);
});

test('LUID uses signed high and unsigned low 32-bit bounds', () => {
  const boundary = withId(rawAdapter({ luidHigh: -0x80000000, luidLow: 0xffffffff }));
  assert.deepEqual(normalizeGpuPreference(boundary), boundary);
  assert.throws(() => normalizeGpuPreference(withId(rawAdapter({ luidHigh: 0x80000000 }))), /signed 32-bit/);
  assert.throws(() => normalizeGpuPreference(withId(rawAdapter({ luidHigh: -0x80000001 }))), /signed 32-bit/);
  assert.throws(() => normalizeGpuPreference(withId(rawAdapter({ luidLow: 0x100000000 }))), /unsigned 32-bit/);
  assert.throws(() => normalizeGpuPreference(withId(rawAdapter({ luidLow: -1 }))), /unsigned 32-bit/);
});

test('adapterToPreference accepts a validated current adapter only', () => {
  const adapter = withId(rawAdapter());
  assert.deepEqual(adapterToPreference(adapter), adapter);
  assert.throws(() => adapterToPreference({ ...adapter, name: 'Changed name' }), /id does not match/);
});

test('exact hardware and LUID match wins among same-model adapters', () => {
  const requested = withId(rawAdapter({ luidHigh: -4, luidLow: 0xffffffff }));
  const otherSameModel = rawAdapter({ luidHigh: -4, luidLow: 0xfffffffe });
  const result = resolveGpuPreference(requested, [otherSameModel, rawAdapter({ luidHigh: -4, luidLow: 0xffffffff })]);
  assert.equal(result.applied.id, requested.id);
  assert.equal(result.reason, null);
});

test('a unique hardware match is retained when its session LUID changes', () => {
  const requested = withId(rawAdapter({ luidHigh: -10, luidLow: 31 }));
  const current = rawAdapter({ luidHigh: 5, luidLow: 42 });
  const result = resolveGpuPreference(requested, [current]);
  assert.equal(result.applied.id, withId(current).id);
  assert.match(result.reason, /LUID/);
});

test('ambiguous same-model adapters and missing hardware fall back to auto with a reason', () => {
  const requested = withId(rawAdapter({ luidHigh: 7, luidLow: 77 }));
  const ambiguous = resolveGpuPreference(requested, [
    rawAdapter({ luidHigh: 8, luidLow: 81 }),
    rawAdapter({ luidHigh: 9, luidLow: 91 }),
  ]);
  assert.equal(ambiguous.applied, 'auto');
  assert.match(ambiguous.reason, /无法安全判断/);

  const missing = resolveGpuPreference(requested, [otherModel()]);
  assert.equal(missing.applied, 'auto');
  assert.match(missing.reason, /不可用/);
});

test('GPU switches reject application after readiness', () => {
  const { app } = captureSwitches(true);
  assert.throws(() => applyGpuPreference(app, { requested: 'auto', applied: 'auto', reason: null }), /before Electron app readiness/);
});

test('automatic mode applies only the high-performance preference', () => {
  const { app, calls } = captureSwitches();
  const result = applyGpuPreference(app, resolveGpuPreference('auto', []));
  assert.equal(result.applied, 'auto');
  assert.deepEqual(calls, [['force-high-performance-gpu']]);
  assert.deepEqual(result.switches, ['force-high-performance-gpu']);
});

test('manual mode applies only D3D11 and the signed-high, unsigned-low LUID', () => {
  const selected = withId(rawAdapter({ luidHigh: -2147483648, luidLow: 4294967295 }));
  const selection = resolveGpuPreference(selected, [rawAdapter({ luidHigh: -2147483648, luidLow: 4294967295 })]);
  const { app, calls } = captureSwitches();
  const result = applyGpuPreference(app, selection);
  assert.deepEqual(calls, [
    ['use-angle', 'd3d11'],
    ['use-adapter-luid', '-2147483648,4294967295'],
  ]);
  assert.deepEqual(result.switches, ['use-angle=d3d11', 'use-adapter-luid=-2147483648,4294967295']);
});

// Exercise the production save callbacks without starting Electron or touching
// any profile. The delayed store exposes races between GPU and ordinary saves.
function productionWriters(save) {
  const source = fs.readFileSync(path.join(__dirname, '../desktop/main.cjs'), 'utf8');
  const gpuStart = source.indexOf('registerGpuControls({app,');
  const gpuEnd = source.indexOf("\nipcMain.handle('rhine:about", gpuStart);
  const regularStart = source.indexOf("ipcMain.handle('rhine:preferences:save'");
  const regularEnd = source.indexOf('\nlet preferenceErrorVisible', regularStart);
  assert.ok(gpuStart > 0 && gpuEnd > gpuStart && regularEnd > regularStart);
  return new Function('preferencesStore', 'gpuSelectionModel', `
    let preferences={gpuPreference:'auto',volume:.5},saveTail=Promise.resolve(),gpuSaveTail=Promise.resolve();
    let gpuWriter,regularWriter;const app={},window=null,startupGpu={},windowAspectController=null;
    const ownedEvent=()=>true,selectPreferences=value=>({...value});
    const registerGpuControls=options=>{gpuWriter=options.savePreference};
    const ipcMain={handle:(_channel,handler)=>{regularWriter=handler}};
    ${source.slice(gpuStart, gpuEnd)}
    ${source.slice(regularStart, regularEnd)}
    return {gpu:value=>gpuWriter(value),regular:value=>regularWriter({},value),state:()=>preferences};
  `)({ save }, { normalizeGpuPreference });
}

test('failed GPU save cannot leak through a concurrent ordinary preference save', async () => {
  let rejectFirst, writes = 0, persisted;
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  const writers = productionWriters(async value => {
    if (++writes === 1) await first;
    persisted = structuredClone(value);
  });
  const failed = writers.gpu(withId(rawAdapter())).then(() => false, () => true);
  await new Promise(resolve => setImmediate(resolve));
  const regular = writers.regular({ volume: .7, gpuPreference: 'forged-or-stale' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1, 'Ordinary writes must wait for GPU save/rollback');
  rejectFirst(new Error('Synthetic disk failure'));
  assert.equal(await failed, true);
  assert.equal((await regular).ok, true);
  assert.equal(persisted.gpuPreference, 'auto');
  assert.equal(writers.state().gpuPreference, 'auto');
  assert.equal(persisted.volume, .7);
});

test('successful GPU save survives a concurrent ordinary save with stale GPU data', async () => {
  let releaseFirst, writes = 0, persisted;
  const first = new Promise(resolve => { releaseFirst = resolve; });
  const writers = productionWriters(async value => {
    if (++writes === 1) await first;
    persisted = structuredClone(value);
  });
  const selected = withId(rawAdapter());
  const gpu = writers.gpu(selected);
  await new Promise(resolve => setImmediate(resolve));
  const regular = writers.regular({ volume: .8, gpuPreference: 'auto' });
  releaseFirst();
  await gpu;
  assert.equal((await regular).ok, true);
  assert.deepEqual(persisted.gpuPreference, selected);
  assert.deepEqual(writers.state().gpuPreference, selected);
  assert.equal(persisted.volume, .8);
});
