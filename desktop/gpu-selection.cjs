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
  return `gpu:${hardwareIdentityKey(adapter)}@${adapter.luidHigh},${adapter.luidLow}`;
}

function normalizeAdapter(value, label = 'adapter') {
  assertExactFields(value, PREFERENCE_FIELDS, label);
  const fields = normalizeAdapterFields(value, label);
  const id = createAdapterId(fields);
  if (value.id !== id) throw new TypeError(`${label}.id does not match its hardware identity and session LUID`);
  return { id, ...fields };
}

function normalizeEnumeratedAdapter(value, index) {
  const label = `adapters[${index}]`;
  assertExactFields(value, ADAPTER_FIELDS, label);
  const fields = normalizeAdapterFields(value, label);
  return { id: createAdapterId(fields), ...fields };
}

function normalizeGpuPreference(value) {
  if (value === undefined || value === null || value === 'auto') return 'auto';
  return normalizeAdapter(value, 'GPU preference');
}

function adapterToPreference(adapter) {
  return normalizeAdapter(adapter, 'selected adapter');
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
  return parsed.map(normalizeEnumeratedAdapter);
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
  const available = adapters.map((adapter, index) => {
    if (isRecord(adapter) && Object.hasOwn(adapter, 'id')) {
      return normalizeAdapter(adapter, `adapters[${index}]`);
    }
    return normalizeEnumeratedAdapter(adapter, index);
  });

  const exact = available.filter(adapter =>
    sameHardware(adapter, requested) &&
    adapter.luidHigh === requested.luidHigh &&
    adapter.luidLow === requested.luidLow);
  if (exact.length === 1) {
    return { requested, applied: exact[0], reason: null };
  }
  if (exact.length > 1) {
    return {
      requested,
      applied: 'auto',
      reason: 'GPU 枚举返回了重复的硬件身份和 LUID，已回退自动选择。',
    };
  }

  const hardwareMatches = available.filter(adapter => sameHardware(adapter, requested));
  if (hardwareMatches.length === 1) {
    return {
      requested,
      applied: hardwareMatches[0],
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
  adapterToPreference,
  enumerateAdapters,
  enumerateAdaptersSync,
  normalizeGpuPreference,
  resolveGpuPreference,
  applyGpuPreference,
};
