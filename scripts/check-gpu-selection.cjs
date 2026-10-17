'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  adapterToPreference,
  groupPhysicalAdapters,
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

const PHYSICAL_PNP_KEY_A = '\\REGISTRY\\MACHINE\\SYSTEM\\ControlSet001\\Enum\\PCI\\VEN_10DE&DEV_2C02&SUBSYS_89E01043&REV_A1\\INSTANCE-A\\Device Parameters';
const PHYSICAL_PNP_KEY_B = '\\REGISTRY\\MACHINE\\SYSTEM\\ControlSet001\\Enum\\PCI\\VEN_10DE&DEV_2C02&SUBSYS_89E01043&REV_A1\\INSTANCE-B\\Device Parameters';

function canonicalPhysicalKeys(keys) {
  return [...new Set(keys.map(key => key.trim().toUpperCase()
    .replace(/\\SYSTEM\\CONTROLSET[0-9]{3}\\ENUM\\/, '\\SYSTEM\\CURRENTCONTROLSET\\ENUM\\')))].sort();
}

function withPhysicalId(adapter) {
  const physicalKeys = canonicalPhysicalKeys(adapter.physicalKeys);
  const hash = createHash('sha256').update(JSON.stringify(physicalKeys), 'utf8').digest('hex');
  return {
    id: `gpu-physical:${hash}`,
    vendorId: adapter.vendorId,
    deviceId: adapter.deviceId,
    subSysId: adapter.subSysId,
    revision: adapter.revision,
    name: adapter.name,
    luidHigh: adapter.luidHigh,
    luidLow: adapter.luidLow,
    physicalKeys: adapter.physicalKeys,
  };
}

function physicalAdapter(key, overrides = {}) {
  return rawAdapter({
    physicalKeys: [key],
    physicalLocations: ['PCI bus 1, device 0, function 0'],
    dedicatedMemoryBytes: 16 * 1024 ** 3,
    pciAddress: 'PCI 1:0.0',
    identityError: '',
    ...overrides,
  });
}

function unconfirmedAdapter(overrides = {}) {
  return rawAdapter({
    physicalKeys: [],
    physicalLocations: [],
    dedicatedMemoryBytes: 0,
    pciAddress: '',
    identityError: 'physical identity unavailable',
    ...overrides,
  });
}

function luidKey(adapter) {
  return `${adapter.luidHigh},${adapter.luidLow}`;
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

test('four logical LUIDs with one physical PnP key group into one GPU with all aliases', () => {
  const logicalAdapters = Array.from({ length: 4 }, (_, index) => physicalAdapter(PHYSICAL_PNP_KEY_A, {
    luidHigh: 0,
    luidLow: 100 + index,
    physicalLocations: [`PCI bus 1, device 0, function 0`],
  }));
  const groups = groupPhysicalAdapters(logicalAdapters);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].identityConfirmed, true);
  assert.equal(groups[0].id, withPhysicalId(physicalAdapter(PHYSICAL_PNP_KEY_A)).id);
  assert.deepEqual(groups[0].physicalKeys, canonicalPhysicalKeys([PHYSICAL_PNP_KEY_A]));
  assert.deepEqual(groups[0].aliases.map(luidKey).sort(), logicalAdapters.map(luidKey).sort());
});

test('same-model adapters with different physical PnP keys remain separate', () => {
  const groups = groupPhysicalAdapters([
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 2, luidLow: 201 }),
    physicalAdapter(PHYSICAL_PNP_KEY_B, { luidHigh: 2, luidLow: 202 }),
  ]);

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].id, groups[1].id);
  assert.equal(groups[0].name, groups[1].name);
});

test('duplicate LUID records collapse to one alias while a pre-identified record is accepted', () => {
  const raw = physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: -3, luidLow: 303 });
  const identified = withPhysicalId({ ...raw, physicalKeys: [...raw.physicalKeys] });
  const groups = groupPhysicalAdapters([raw, identified]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].aliases.length, 1);
  assert.equal(luidKey(groups[0].aliases[0]), luidKey(raw));
});

test('different PnP key sets do not merge even when their LUID is the same', () => {
  const groups = groupPhysicalAdapters([
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 5, luidLow: 505 }),
    physicalAdapter(PHYSICAL_PNP_KEY_B, { luidHigh: 5, luidLow: 505 }),
  ]);

  assert.equal(groups.length, 2);
  assert.notEqual(groups[0].id, groups[1].id);
});

test('LDA physical-key sets normalize order and remain one linked group', () => {
  const first = rawAdapter({
    luidHigh: 6,
    luidLow: 606,
    physicalKeys: [PHYSICAL_PNP_KEY_A, PHYSICAL_PNP_KEY_B],
    physicalLocations: ['PCI bus 1, device 0, function 0', 'PCI bus 2, device 0, function 0'],
    identityError: '',
  });
  const second = rawAdapter({
    luidHigh: 7,
    luidLow: 707,
    physicalKeys: [PHYSICAL_PNP_KEY_B.toLowerCase(), PHYSICAL_PNP_KEY_A.toLowerCase()],
    physicalLocations: ['PCI bus 2, device 0, function 0', 'PCI bus 1, device 0, function 0'],
    identityError: '',
  });
  const groups = groupPhysicalAdapters([first, second]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].id, withPhysicalId(first).id);
  assert.equal(groups[0].physicalKeys.length, 2);
  assert.equal(groups[0].aliases.length, 2);
});

test('legacy preferences migrate through an alias LUID to the physical GPU preference', () => {
  const legacy = withId(rawAdapter({ luidHigh: -8, luidLow: 808 }));
  const groups = groupPhysicalAdapters([
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: -8, luidLow: 808 }),
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 9, luidLow: 909 }),
  ]);
  const result = resolveGpuPreference(legacy, groups);

  assert.equal(result.applied.id, groups[0].id);
  assert.deepEqual(result.applied.physicalKeys, groups[0].physicalKeys);
  assert.equal(luidKey(result.applied), luidKey(legacy));
});

test('a v2 physical preference follows the same PnP device after its LUID changes', () => {
  const requested = withPhysicalId(physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 10, luidLow: 1010 }));
  const groups = groupPhysicalAdapters([
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 11, luidLow: 1111 }),
  ]);
  const result = resolveGpuPreference(requested, groups);

  assert.equal(result.applied.id, requested.id);
  assert.equal(luidKey(result.applied), '11,1111');
});

test('a legacy preference without its exact alias never guesses a same-model physical card', () => {
  const legacy = withId(rawAdapter({ luidHigh: 20, luidLow: 2020 }));
  const groups = groupPhysicalAdapters([physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 21, luidLow: 2121 })]);
  const result = resolveGpuPreference(legacy, groups);
  assert.equal(result.applied, 'auto');
  assert.match(result.reason, /物理身份/);
});

test('missing PnP identity never redirects a preference to another same-model adapter', () => {
  const requested = withPhysicalId(physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 12, luidLow: 1212 }));
  const available = groupPhysicalAdapters([
    physicalAdapter(PHYSICAL_PNP_KEY_B, { luidHigh: 13, luidLow: 1313 }),
    unconfirmedAdapter({ luidHigh: 14, luidLow: 1414 }),
  ]);
  const result = resolveGpuPreference(requested, available);

  assert.equal(result.applied, 'auto');
});

test('unconfirmed adapters remain separate and cannot be converted to manual preferences', () => {
  const groups = groupPhysicalAdapters([
    unconfirmedAdapter({ luidHigh: 15, luidLow: 1515 }),
    unconfirmedAdapter({ luidHigh: 16, luidLow: 1616 }),
    physicalAdapter(PHYSICAL_PNP_KEY_A, { luidHigh: 17, luidLow: 1717 }),
  ]);
  const unconfirmed = groups.filter(adapter => adapter.identityConfirmed === false);
  const confirmed = groups.filter(adapter => adapter.identityConfirmed === true);

  assert.equal(groups.length, 3);
  assert.equal(unconfirmed.length, 2);
  assert.notEqual(unconfirmed[0].id, unconfirmed[1].id);
  assert.ok(unconfirmed.every(adapter => adapter.aliases.length === 1));
  assert.equal(confirmed.length, 1);
  assert.throws(() => adapterToPreference(unconfirmed[0]), /identity is unavailable/);
});

test('physical preferences persist PnP keys but exclude display-only metadata', () => {
  const [group] = groupPhysicalAdapters([physicalAdapter(PHYSICAL_PNP_KEY_A)]);
  const preference = adapterToPreference(group);

  assert.deepEqual(Object.keys(preference).sort(), [
    'deviceId', 'id', 'luidHigh', 'luidLow', 'name', 'physicalKeys', 'revision', 'subSysId', 'vendorId',
  ].sort());
  assert.deepEqual(preference.physicalKeys, group.physicalKeys);
  assert.equal('aliases' in preference, false);
  assert.equal('physicalLocations' in preference, false);
  assert.equal('dedicatedMemoryBytes' in preference, false);
  assert.equal('pciAddress' in preference, false);
  assert.equal('identityError' in preference, false);
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

test('persisting a v2 preference keeps physical keys and omits runtime display metadata', async () => {
  const [group] = groupPhysicalAdapters([physicalAdapter(PHYSICAL_PNP_KEY_A)]);
  const preference = adapterToPreference(group);
  let persisted;
  const writers = productionWriters(async value => { persisted = structuredClone(value); });

  await writers.gpu(preference);

  const expectedFields = [
    'deviceId', 'id', 'luidHigh', 'luidLow', 'name', 'physicalKeys', 'revision', 'subSysId', 'vendorId',
  ].sort();
  assert.deepEqual(Object.keys(writers.state().gpuPreference).sort(), expectedFields);
  assert.deepEqual(Object.keys(persisted.gpuPreference).sort(), expectedFields);
  assert.deepEqual(persisted.gpuPreference.physicalKeys, group.physicalKeys);
});

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
