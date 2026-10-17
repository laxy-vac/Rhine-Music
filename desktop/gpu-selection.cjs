'use strict';

const { spawn, spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const ADAPTER_FIELDS = [
  'vendorId', 'deviceId', 'subSysId', 'revision', 'name', 'luidHigh', 'luidLow',
];
const PREFERENCE_FIELDS = ['id', ...ADAPTER_FIELDS];
const METADATA_FIELDS = ['physicalKeys', 'physicalLocations', 'dedicatedMemoryBytes', 'pciAddress', 'identityError', 'identityConfirmed', 'aliases'];
const ENUMERATION_SCRIPT = path.join(__dirname, 'gpu-adapters.ps1');
const ENUMERATION_TIMEOUT_MS = 15000;
const ENUMERATION_MAX_BUFFER = 1024 * 1024;

function isRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertExactFields(value, fields, label) {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = fields.slice().sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
}

function assertUint32(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new TypeError(`${label} must be an unsigned 32-bit integer`);
  }
  return value;
}

function assertInt32(value, label) {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new TypeError(`${label} must be a signed 32-bit integer`);
  }
  return value;
}

function normalizeAdapterFields(value, label) {
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 256) throw new TypeError(`${label}.name must be a non-empty string`);
  return {
    vendorId: assertUint32(value.vendorId, `${label}.vendorId`),
    deviceId: assertUint32(value.deviceId, `${label}.deviceId`),
    subSysId: assertUint32(value.subSysId, `${label}.subSysId`),
    revision: assertUint32(value.revision, `${label}.revision`),
    name,
    luidHigh: assertInt32(value.luidHigh, `${label}.luidHigh`),
    luidLow: assertUint32(value.luidLow, `${label}.luidLow`),
  };
}

function hardwareIdentityKey(adapter) {
  const identity = [
    adapter.vendorId,
    adapter.deviceId,
    adapter.subSysId,
    adapter.revision,
    adapter.name.trim().toLowerCase(),
  ];
  return createHash('sha256').update(JSON.stringify(identity), 'utf8').digest('hex');
}

function createAdapterId(adapter) {
  if (adapter.physicalKeys?.length) return `gpu-physical:${createHash('sha256').update(JSON.stringify(adapter.physicalKeys), 'utf8').digest('hex')}`;
  return `gpu:${hardwareIdentityKey(adapter)}@${adapter.luidHigh},${adapter.luidLow}`;
}

function normalizePhysicalKeys(value, required = false) {
  if (!Array.isArray(value) || value.length > 16) throw new TypeError('Physical GPU keys must be an array of at most 16 entries');
  const keys = [...new Set(value.map(key => {
    if (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\x00-\x1f]/.test(key)) throw new TypeError('Invalid physical GPU key');
    return key.trim().toUpperCase().replace(/\\SYSTEM\\CONTROLSET[0-9]{3}\\ENUM\\/, '\\SYSTEM\\CURRENTCONTROLSET\\ENUM\\');
  }))].sort();
  if (required && !keys.length) throw new TypeError('A physical GPU identity is required');
  return keys;
}

function normalizeAdapter(value, label = 'adapter') {
  assertExactFields(value, Object.hasOwn(value ?? {}, 'physicalKeys') ? [...PREFERENCE_FIELDS, 'physicalKeys'] : PREFERENCE_FIELDS, label);
  const fields = normalizeAdapterFields(value, label);
  if (Object.hasOwn(value, 'physicalKeys')) fields.physicalKeys = normalizePhysicalKeys(value.physicalKeys, true);
  const id = createAdapterId(fields);
  if (value.id !== id) throw new TypeError(`${label}.id does not match its hardware identity and session LUID`);
  return { id, ...fields };
}

function normalizeEnumeratedAdapter(value, index) {
  const label = `adapters[${index}]`;
  if (!isRecord(value) || Object.keys(value).some(key => ![...ADAPTER_FIELDS, 'id', ...METADATA_FIELDS].includes(key))) throw new TypeError(`${label} has unknown fields`);
  for (const field of ADAPTER_FIELDS) if (!Object.hasOwn(value, field)) throw new TypeError(`${label} has missing fields`);
  const fields = normalizeAdapterFields(value, label);
  const metadata = {};
  if (Object.hasOwn(value, 'physicalKeys')) {
    fields.physicalKeys = normalizePhysicalKeys(value.physicalKeys);
    metadata.identityConfirmed = fields.physicalKeys.length > 0;
    metadata.physicalLocations = Array.isArray(value.physicalLocations) ? value.physicalLocations.filter(item => typeof item === 'string' && item.length <= 4096).map(item => item.trim()).filter(Boolean) : [];
    metadata.dedicatedMemoryBytes = Number.isSafeInteger(value.dedicatedMemoryBytes) && value.dedicatedMemoryBytes >= 0 ? value.dedicatedMemoryBytes : 0;
    metadata.pciAddress = typeof value.pciAddress === 'string' ? value.pciAddress.slice(0, 100) : '';
    metadata.identityError = typeof value.identityError === 'string' ? value.identityError.slice(0, 1000) : '';
  }
  const id = createAdapterId(fields);
  if (value.id && value.id !== id) throw new TypeError(`${label}.id does not match its identity`);
  const aliases = Array.isArray(value.aliases) ? value.aliases : [{ luidHigh: fields.luidHigh, luidLow: fields.luidLow }];
  if (aliases.length > 32) throw new TypeError('Too many logical GPU adapters');
  metadata.aliases = aliases.map(alias => ({ luidHigh: assertInt32(alias.luidHigh, 'alias.luidHigh'), luidLow: assertUint32(alias.luidLow, 'alias.luidLow') }));
  return { id, ...fields, ...metadata };
}

function normalizeGpuPreference(value) {
  if (value === undefined || value === null || value === 'auto') return 'auto';
  return normalizeAdapter(value, 'GPU preference');
}

function adapterToPreference(adapter) {
  if (!isRecord(adapter) || Object.keys(adapter).some(key => ![...PREFERENCE_FIELDS, ...METADATA_FIELDS].includes(key))) throw new TypeError('Invalid selected adapter');
  if (adapter.identityConfirmed === false) throw new TypeError('The physical GPU identity is unavailable');
  const fields = Object.fromEntries(PREFERENCE_FIELDS.map(key => [key, adapter[key]]));
  if (adapter.physicalKeys?.length) fields.physicalKeys = adapter.physicalKeys;
  return normalizeAdapter(fields, 'selected adapter');
}

function groupPhysicalAdapters(adapters) {
  if (!Array.isArray(adapters) || adapters.length > 32) throw new TypeError('At most 32 adapters are allowed');
  const groups = new Map();
  for (const [index, value] of adapters.entries()) {
    const adapter = normalizeEnumeratedAdapter(value, index);
    const previous = groups.get(adapter.id);
    if (!previous) { groups.set(adapter.id, adapter); continue; }
    if (!sameHardware(previous, adapter)) throw new Error('Conflicting hardware reported for one physical GPU');
    for (const alias of adapter.aliases) if (!previous.aliases.some(item => item.luidHigh === alias.luidHigh && item.luidLow === alias.luidLow)) previous.aliases.push(alias);
    previous.physicalLocations = [...new Set([...(previous.physicalLocations ?? []), ...(adapter.physicalLocations ?? [])])];
  }
  return [...groups.values()];
}

function parseEnumerationOutput(stdout) {
  const output = String(stdout || '').trim();
  if (!output) throw new Error('GPU adapter enumeration returned no JSON output.');
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`GPU adapter enumeration returned invalid JSON: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(parsed) || parsed.length > 32) {
    throw new Error('GPU adapter enumeration must return an array containing at most 32 adapters.');
  }
  return groupPhysicalAdapters(parsed);
}

function enumerationError(detail, cause) {
  const error = new Error(`GPU adapter enumeration failed: ${detail}`);
  if (cause) error.cause = cause;
  return error;
}

function enumerateAdaptersSync() {
  if (process.platform !== 'win32') {
    throw new Error('GPU adapter enumeration is available only on Windows.');
  }

  let script;
  try {
    script = readFileSync(ENUMERATION_SCRIPT, 'utf8');
  } catch (error) {
    throw new Error(`GPU adapter enumeration script is unavailable: ${error.message}`, { cause: error });
  }

  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: ENUMERATION_TIMEOUT_MS,
    maxBuffer: ENUMERATION_MAX_BUFFER,
  });
  if (result.error) {
    const message = result.error.code === 'ETIMEDOUT'
      ? `timed out after ${ENUMERATION_TIMEOUT_MS} ms`
      : result.error.code === 'ENOBUFS'
        ? `output exceeded ${ENUMERATION_MAX_BUFFER} bytes`
        : `could not run PowerShell: ${result.error.message}`;
    throw enumerationError(message, result.error);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw enumerationError(detail || `PowerShell exited with status ${result.status}`);
  }
  if (String(result.stderr || '').trim()) {
    throw enumerationError(String(result.stderr).trim());
  }
  return parseEnumerationOutput(result.stdout);
}

async function enumerateAdapters() {
  if (process.platform !== 'win32') {
    throw new Error('GPU adapter enumeration is available only on Windows.');
  }

  let script;
  try {
    script = await readFile(ENUMERATION_SCRIPT, 'utf8');
  } catch (error) {
    throw enumerationError(`enumeration script is unavailable: ${error.message}`, error);
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(enumerationError(`could not run PowerShell: ${error.message}`, error));
      return;
    }

    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let overflow = false;
    let timedOut = false;
    let stdinError;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(value);
    };
    const append = (chunks, chunk) => {
      const bytes = Buffer.byteLength(chunk);
      outputBytes += bytes;
      if (outputBytes > ENUMERATION_MAX_BUFFER) {
        overflow = true;
        child.kill();
        return;
      }
      chunks.push(Buffer.from(chunk));
    };

    child.stdout.on('data', chunk => append(stdout, chunk));
    child.stderr.on('data', chunk => append(stderr, chunk));
    child.stdin.on('error', error => { stdinError = error; });
    child.once('error', error => {
      finish(enumerationError(`could not run PowerShell: ${error.message}`, error));
    });
    child.once('close', status => {
      if (timedOut) {
        finish(enumerationError(`timed out after ${ENUMERATION_TIMEOUT_MS} ms`));
        return;
      }
      if (overflow) {
        finish(enumerationError(`output exceeded ${ENUMERATION_MAX_BUFFER} bytes`));
        return;
      }
      if (stdinError) {
        finish(enumerationError(`could not send the enumeration script: ${stdinError.message}`, stdinError));
        return;
      }
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8').trim();
      if (status !== 0) {
        finish(enumerationError(stderrText || stdoutText.trim() || `PowerShell exited with status ${status}`));
        return;
      }
      if (stderrText) {
        finish(enumerationError(stderrText));
        return;
      }
      try {
        finish(null, parseEnumerationOutput(stdoutText));
      } catch (error) {
        finish(error);
      }
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, ENUMERATION_TIMEOUT_MS);
    child.stdin.end();
  });
}

function sameHardware(left, right) {
  return left.vendorId === right.vendorId &&
    left.deviceId === right.deviceId &&
    left.subSysId === right.subSysId &&
    left.revision === right.revision &&
    left.name.trim().toLowerCase() === right.name.trim().toLowerCase();
}

function resolveGpuPreference(preference, adapters) {
  const requested = normalizeGpuPreference(preference);
  if (requested === 'auto') {
    return { requested, applied: 'auto', reason: null };
  }
  if (!Array.isArray(adapters) || adapters.length > 32) {
    throw new TypeError('adapters must be an array containing at most 32 entries');
  }
  const available = groupPhysicalAdapters(adapters).filter(adapter => adapter.identityConfirmed !== false);
  const appliedPreference = adapter => adapterToPreference(adapter);
  if (requested.physicalKeys) {
    const matches = available.filter(adapter => adapter.id === requested.id && sameHardware(adapter, requested));
    if (matches.length === 1) {
      const match = matches[0], alias = match.aliases.find(item => item.luidHigh === requested.luidHigh && item.luidLow === requested.luidLow);
      return { requested, applied: appliedPreference(alias ? { ...match, ...alias } : match), reason: null };
    }
    return { requested, applied: 'auto', reason: '上次选择的 GPU 已不可用；已回退自动选择。' };
  }

  const exact = available.filter(adapter =>
    sameHardware(adapter, requested) &&
    adapter.aliases.some(alias => alias.luidHigh === requested.luidHigh && alias.luidLow === requested.luidLow));
  if (exact.length === 1) {
    const alias = exact[0].aliases.find(item => item.luidHigh === requested.luidHigh && item.luidLow === requested.luidLow);
    return { requested, applied: appliedPreference({ ...exact[0], ...alias }), reason: null };
  }
  if (exact.length > 1) {
    return {
      requested,
      applied: 'auto',
      reason: 'GPU 枚举返回了重复的硬件身份和 LUID，已回退自动选择。',
    };
  }

  if (available.some(adapter => adapter.identityConfirmed === true)) {
    return { requested, applied: 'auto', reason: '旧显卡偏好缺少物理身份，请重新选择；本次使用自动选择。' };
  }

  const hardwareMatches = available.filter(adapter => sameHardware(adapter, requested));
  if (hardwareMatches.length === 1) {
    return {
      requested,
      applied: appliedPreference(hardwareMatches[0]),
      reason: 'GPU 的会话 LUID 已变化，已按唯一硬件身份重新匹配。',
    };
  }
  if (hardwareMatches.length > 1) {
    return {
      requested,
      applied: 'auto',
      reason: '多张 GPU 的硬件身份相同且会话 LUID 已变化，无法安全判断目标；已回退自动选择。',
    };
  }
  return {
    requested,
    applied: 'auto',
    reason: '上次选择的 GPU 已不可用；已回退自动选择。',
  };
}

function applyGpuPreference(app, selection) {
  if (!app || !app.commandLine || typeof app.commandLine.appendSwitch !== 'function') {
    throw new TypeError('app.commandLine.appendSwitch is required');
  }
  if (typeof app.isReady === 'function' && app.isReady()) {
    throw new Error('GPU switches must be applied before Electron app readiness.');
  }
  if (!isRecord(selection) || !Object.hasOwn(selection, 'requested') || !Object.hasOwn(selection, 'applied')) {
    throw new TypeError('selection must be a resolved GPU preference');
  }

  const requested = normalizeGpuPreference(selection.requested);
  const applied = selection.applied === 'auto'
    ? 'auto'
    : normalizeAdapter(selection.applied, 'selection.applied');
  if (requested === 'auto' && applied !== 'auto') {
    throw new TypeError('automatic GPU preference cannot apply a manual adapter');
  }
  if (requested !== 'auto' && applied !== 'auto' && !sameHardware(requested, applied)) {
    throw new TypeError('applied GPU does not match the requested hardware identity');
  }
  if (requested !== 'auto' && requested.physicalKeys && applied !== 'auto' && requested.id !== applied.id) throw new TypeError('Applied GPU does not match the requested physical device');
  const reason = selection.reason === undefined || selection.reason === null
    ? null
    : typeof selection.reason === 'string'
      ? selection.reason
      : (() => { throw new TypeError('selection.reason must be a string or null'); })();

  let switches;
  if (applied === 'auto') {
    app.commandLine.appendSwitch('force-high-performance-gpu');
    switches = ['force-high-performance-gpu'];
  } else {
    const luid = `${applied.luidHigh},${applied.luidLow}`;
    app.commandLine.appendSwitch('use-angle', 'd3d11');
    app.commandLine.appendSwitch('use-adapter-luid', luid);
    switches = [`use-angle=d3d11`, `use-adapter-luid=${luid}`];
  }

  return { requested, applied, reason, switches };
}

module.exports = {
  groupPhysicalAdapters,
  adapterToPreference,
  enumerateAdapters,
  enumerateAdaptersSync,
  normalizeGpuPreference,
  resolveGpuPreference,
  applyGpuPreference,
};
