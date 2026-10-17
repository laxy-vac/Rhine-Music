import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { InterfaceAudio } from './interface-audio.mjs';

const TEST_TIMEOUT_MS = 1800;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const tests = [];
let caseIndex = 0;

function test(name, run) {
  tests.push({ name, run });
}

function silentWav({ durationMs = 120, sampleRate = 48000, channels = 2, bitsPerSample = 16 } = {}) {
  const frames = Math.ceil(sampleRate * durationMs / 1000);
  const blockAlign = channels * bitsPerSample / 8;
  const dataBytes = frames * blockAlign;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * blockAlign, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

function makeNative({ owner, idle = true, commandHandler } = {}) {
  let currentOwner = owner;
  let currentlyIdle = idle;
  const commands = [];
  return {
    commands,
    get frontendOwner() { return currentOwner; },
    set frontendOwner(value) { currentOwner = value; },
    interfaceIdle() { return currentlyIdle; },
    setIdle(value) { currentlyIdle = value; },
    async command(payload) {
      const request = { ...payload };
      commands.push(request);
      const handled = await commandHandler?.(request, commands.length);
      if (handled !== undefined) return handled;
      return {
        ok: true,
        cmd: request.cmd,
        session: request.session,
        state: request.cmd === 'stop' ? 'idle' : request.cmd === 'open' ? 'open' : 'playing',
        idle: request.cmd === 'stop',
        interfaceIdle: request.cmd === 'stop',
      };
    },
  };
}

function identity(clientId = randomUUID(), clientStartedAt = Date.now()) {
  return { clientId, clientStartedAt };
}

function config(sameIdentity, overrides = {}) {
  return {
    clientId: sameIdentity.clientId,
    clientStartedAt: sameIdentity.clientStartedAt,
    revision: 1,
    design: 'rhine',
    enabled: true,
    musicBusy: false,
    output: {
      backend: 'wasapi',
      device: 3,
      channel: 1,
      wasapiDevice: 'mock-wasapi-endpoint-id',
    },
    ...overrides,
    output: { backend: 'wasapi', device: 3, channel: 1, wasapiDevice: 'mock-wasapi-endpoint-id', ...overrides.output },
  };
}

function cue(sameIdentity, overrides = {}) {
  return {
    ...sameIdentity,
    revision: 1,
    sequence: 1,
    sound: 'tick',
    volume: 0.35,
    wav: silentWav().toString('base64'),
    ...overrides,
  };
}

async function createAudio(label, { owner, idle = true, commandHandler } = {}) {
  const testId = `${String(++caseIndex).padStart(2, '0')}-${label.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}`;
  const dataDir = path.join(testRoot, testId);
  await mkdir(dataDir, { recursive: true });
  const native = makeNative({ owner, idle, commandHandler });
  const audio = new InterfaceAudio({ native, dataDir });
  return { audio, native, dataDir };
}

function assertNoMusicRouting(commands) {
  const allowed = new Set(['open', 'play', 'status', 'stop']);
  for (const command of commands) {
    assert.ok(allowed.has(command.cmd), `unexpected native command: ${command.cmd}`);
    assert.ok(!Object.hasOwn(command, 'track'), 'interface sound command must not carry a music track');
    assert.ok(!Object.hasOwn(command, 'queue'), 'interface sound command must not enter the music queue');
    if (command.processing) {
      assert.equal(command.processing.eq?.enabled, false, 'interface sound must not enable music EQ');
      assert.equal(command.processing.tone?.enabled, false, 'interface sound must not enable music tone DSP');
      assert.equal(command.processing.replayGain?.mode, 'off', 'interface sound must not apply ReplayGain');
      assert.equal(command.processing.bitPerfect, false, 'interface sound must not use the music bit-perfect path');
    }
  }
}

function assertGeneratedFilesAreContained(commands, dataDir, forbiddenPath = '') {
  const root = path.resolve(dataDir);
  for (const command of commands) {
    if (!command.file) continue;
    const resolved = path.isAbsolute(command.file)
      ? path.resolve(command.file)
      : path.resolve(root, command.file);
    const relative = path.relative(root, resolved);
    assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
      `generated audio file escaped its private dataDir: ${command.file}`);
    assert.notEqual(resolved, path.resolve(forbiddenPath || path.join(root, '__no-forbidden-path__')),
      'untrusted path was forwarded to the native host');
  }
}

async function waitFor(predicate, label, timeoutMs = TEST_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(5);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function withAudio(label, options, run) {
  const fixture = await createAudio(label, options);
  try {
    await run(fixture);
  } finally {
    await fixture.audio.close();
  }
}

test('Future WASAPI uses the selected endpoint in shared mode', async () => {
  const id = identity();
  await withAudio('wasapi-shared', { owner: id.clientId }, async ({ audio, native, dataDir }) => {
    await audio.configure(config(id, {
      output: { backend: 'wasapi', device: 3, channel: 1, wasapiDevice: 'mock-selected-endpoint' },
    }));
    const result = await audio.play(cue(id, { revision: 1, sequence: 1, sound: 'open' }));
    assert.equal(result.played, true);
    const open = native.commands.find(command => command.cmd === 'open');
    const play = native.commands.find(command => command.cmd === 'play');
    assert.ok(open, 'WASAPI cue must open its isolated interface session');
    assert.ok(play, 'WASAPI cue must be played after open');
    assert.equal(open.backend, 'wasapi');
    assert.equal(open.wasapiMode, 'shared', 'UI audio must force shared WASAPI mode');
    assert.equal(open.wasapiDevice, 'mock-selected-endpoint', 'selected WASAPI endpoint must be preserved');
    if (play.backend !== undefined) assert.equal(play.backend, 'wasapi');
    if (play.wasapiDevice !== undefined) assert.equal(play.wasapiDevice, 'mock-selected-endpoint');
    assertNoMusicRouting(native.commands);
    assertGeneratedFilesAreContained(native.commands, dataDir);
  });
});

test('ASIO preserves the selected device and channel', async () => {
  const id = identity();
  await withAudio('asio-device-channel', { owner: id.clientId }, async ({ audio, native }) => {
    await audio.configure(config(id, {
      output: { backend: 'asio', device: 7, channel: 2, wasapiDevice: '' },
    }));
    const result = await audio.play(cue(id, { revision: 1, sequence: 1, sound: 'confirm' }));
    assert.equal(result.played, true);
    const open = native.commands.find(command => command.cmd === 'open');
    const play = native.commands.find(command => command.cmd === 'play');
    assert.ok(open && play, 'ASIO cue should open and play');
    assert.equal(open.backend, 'asio');
    assert.equal(open.device, 7);
    assert.equal(open.channel, 2);
    if (play.backend !== undefined) assert.equal(play.backend, 'asio');
    if (play.device !== undefined) assert.equal(play.device, 7);
    if (play.channel !== undefined) assert.equal(play.channel, 2);
    await waitFor(() => native.commands.some(command => command.cmd === 'stop'), 'automatic ASIO stop');
  });
});

test('Punk, disabled sound, music activity, and busy native output refuse playback', async () => {
  const cases = [
    ['punk', { design: 'archive' }, true],
    ['disabled', { enabled: false }, true],
    ['music-busy', { musicBusy: true }, true],
    ['native-busy', {}, false],
  ];
  for (const [label, overrides, idle] of cases) {
    const id = identity();
    await withAudio(label, { owner: id.clientId, idle }, async ({ audio, native }) => {
      await audio.configure(config(id, overrides));
      const result = await audio.play(cue(id));
      assert.equal(result.played, false, `${label} must refuse the Future UI cue`);
      assert.equal(native.commands.some(command => command.cmd === 'play'), false,
        `${label} must not start a native sound cue`);
    });
  }
});

test('stale revision, client identity/epoch, owner, and sequence are rejected', async () => {
  const id = identity();
  await withAudio('stale-request', { owner: id.clientId }, async ({ audio, native }) => {
    await audio.configure(config(id, { revision: 8 }));
    const before = native.commands.length;
    assert.equal((await audio.play(cue(id, { revision: 7, sequence: 1 }))).played, false);
    assert.equal((await audio.play(cue({ ...id, clientStartedAt: id.clientStartedAt - 1 }, { revision: 8, sequence: 1 }))).played, false);
    assert.equal((await audio.play(cue({ ...id, clientId: randomUUID() }, { revision: 8, sequence: 1 }))).played, false);
    native.frontendOwner = randomUUID();
    assert.equal((await audio.play(cue(id, { revision: 8, sequence: 1 }))).played, false);
    native.frontendOwner = id.clientId;
    assert.equal((await audio.play(cue(id, { revision: 8, sequence: 10 }))).played, true);
    assert.equal((await audio.play(cue(id, { revision: 8, sequence: 9 }))).played, false,
      'an earlier sequence must not replace a newer cue');
    assert.ok(native.commands.length > before);
  });
});

test('switching to Punk cancels a pending open before it can play', async () => {
  const id = identity();
  let releaseOpen;
  const openGate = new Promise(resolve => { releaseOpen = resolve; });
  await withAudio('late-open-punk-switch', {
    owner: id.clientId,
    commandHandler: async command => {
      if (command.cmd === 'open') {
        await openGate;
        return { ok: true, cmd: 'open', session: command.session, state: 'open' };
      }
    },
  }, async ({ audio, native }) => {
    await audio.configure(config(id, { revision: 1, design: 'rhine' }));
    const pendingPlay = audio.play(cue(id, { revision: 1, sequence: 1 }));
    await waitFor(() => native.commands.some(command => command.cmd === 'open'), 'delayed open command');
    await audio.configure(config(id, { revision: 2, design: 'archive' }));
    releaseOpen();
    const result = await pendingPlay;
    assert.equal(result.played, false, 'a late open must become stale after switching to Punk');
    assert.equal(native.commands.some(command => command.cmd === 'play'), false,
      'a late open must never be followed by playback');
  });
  releaseOpen?.();
});

test('music taking native idle during open prevents the cue from reaching play', async () => {
  const id = identity();
  let releaseOpen;
  const openGate = new Promise(resolve => { releaseOpen = resolve; });
  await withAudio('music-starts-during-open', {
    owner: id.clientId,
    commandHandler: async command => {
      if (command.cmd === 'open') {
        await openGate;
        return { ok: true, cmd: 'open', session: command.session, state: 'open' };
      }
    },
  }, async ({ audio, native }) => {
    await audio.configure(config(id, { revision: 1, musicBusy: false }));
    const pendingPlay = audio.play(cue(id, { revision: 1, sequence: 1 }));
    await waitFor(() => native.commands.some(command => command.cmd === 'open'), 'pending open before music starts');
    native.setIdle(false);
    releaseOpen();
    const result = await pendingPlay;
    assert.equal(result.played, false, 'native music activity must invalidate an in-flight interface cue');
    assert.equal(native.commands.some(command => command.cmd === 'play'), false,
      'an interface cue must not issue play after native music takes the host');
    assert.ok(native.commands.some(command => command.cmd === 'stop'),
      'the opened interface session must be stopped after the music-idle guard changes');
  });
  releaseOpen?.();
});

test('cancel drains the active UI session before a music open may proceed', async () => {
  const id = identity();
  let releaseStop;
  const stopGate = new Promise(resolve => { releaseStop = resolve; });
  await withAudio('cancel-drain-before-music', {
    owner: id.clientId,
    commandHandler: async command => {
      if (command.cmd === 'stop') {
        await stopGate;
        return { ok: true, cmd: 'stop', session: command.session, state: 'idle', idle: true };
      }
    },
  }, async ({ audio, native }) => {
    await audio.configure(config(id));
    assert.equal((await audio.play(cue(id, { sequence: 1, wav: silentWav({ durationMs: 900 }).toString('base64') }))).played, true);
    await waitFor(() => native.commands.some(command => command.cmd === 'play'), 'active cue');
    let musicMayOpen = false;
    const drained = audio.cancel().then(() => { musicMayOpen = true; });
    await waitFor(() => native.commands.some(command => command.cmd === 'stop'), 'UI cue stop before music');
    assert.equal(musicMayOpen, false, 'cancel must remain pending until native stop drains');
    releaseStop();
    await drained;
    assert.equal(musicMayOpen, true);
    const playIndex = native.commands.findIndex(command => command.cmd === 'play');
    const stopIndex = native.commands.findIndex(command => command.cmd === 'stop');
    assert.ok(stopIndex > playIndex, 'native stop must follow the active UI cue');
  });
  releaseStop?.();
});

test('explicit stop honors identity, revision, and increasing sequence', async () => {
  const id = identity();
  await withAudio('explicit-stop', { owner: id.clientId }, async ({ audio, native }) => {
    await audio.configure(config(id, { revision: 4 }));
    assert.equal((await audio.play(cue(id, { revision: 4, sequence: 1, wav: silentWav({ durationMs: 900 }).toString('base64') }))).played, true);
    const stopped = await audio.stop({ ...id, revision: 4, sequence: 2 });
    assert.equal(stopped.stopped, true);
    const stopCount = native.commands.filter(command => command.cmd === 'stop').length;
    const stale = await audio.stop({ ...id, revision: 3, sequence: 3 });
    assert.equal(stale.stale, true);
    assert.equal(native.commands.filter(command => command.cmd === 'stop').length, stopCount,
      'stale stop must not issue a second native stop');
  });
});

test('short silent WAV cues stop automatically', async () => {
  const id = identity();
  await withAudio('automatic-stop', { owner: id.clientId }, async ({ audio, native }) => {
    await audio.configure(config(id));
    const result = await audio.play(cue(id, { wav: silentWav({ durationMs: 90 }).toString('base64') }));
    assert.equal(result.played, true);
    await waitFor(() => native.commands.some(command => command.cmd === 'stop'), 'automatic end stop');
    assertNoMusicRouting(native.commands);
  });
});

test('close stops an active cue and releases the session', async () => {
  const id = identity();
  await withAudio('close-active-cue', { owner: id.clientId }, async ({ audio, native }) => {
    await audio.configure(config(id));
    assert.equal((await audio.play(cue(id, { wav: silentWav({ durationMs: 900 }).toString('base64') }))).played, true);
    await waitFor(() => native.commands.some(command => command.cmd === 'play'), 'active cue before close');
    await audio.close();
    assert.ok(native.commands.some(command => command.cmd === 'stop'), 'close must release the active native session');
    assertNoMusicRouting(native.commands);
  });
});

test('the per-dataDir WAV cache remains bounded to 32 unique cues', async () => {
  const id = identity();
  await withAudio('bounded-cache', { owner: id.clientId }, async ({ audio, native, dataDir }) => {
    await audio.configure(config(id));
    const hashes = [];
    for (let index = 0; index < 33; index++) {
      const wav = silentWav({ durationMs: 30 + index });
      hashes.push(createHash('sha256').update(wav).digest('hex'));
      const result = await audio.play(cue(id, {
        revision: 1,
        sequence: index + 1,
        wav: wav.toString('base64'),
      }));
      assert.equal(result.played, true, `cue ${index + 1} should play`);
    }
    const cacheDir = path.join(dataDir, 'interface-audio-v1');
    const manifest = JSON.parse(await readFile(path.join(cacheDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.hashes.length, 32, 'manifest must retain no more than 32 cache entries');
    assert.equal(manifest.hashes.includes(hashes[0]), false, 'the oldest cue should be evicted after item 33');
    await assert.rejects(() => access(path.join(cacheDir, `${hashes[0]}.wav`)), /ENOENT/, 'evicted WAV file should be removed');
    assertNoMusicRouting(native.commands);
  });
});

test('malformed payloads are rejected and caller paths are never forwarded', async () => {
  const id = identity();
  await withAudio('payload-validation', { owner: id.clientId }, async ({ audio, native, dataDir }) => {
    await audio.configure(config(id));
    const tooLongWav = silentWav({ durationMs: 2501 }).toString('base64');
    const monoWav = silentWav({ channels: 1 }).toString('base64');
    const wrongRateWav = silentWav({ sampleRate: 44100 }).toString('base64');
    const invalidPayloads = [
      { wav: 'not-base64' },
      { wav: `${silentWav().toString('base64')}\n` },
      { wav: Buffer.from('not a wav').toString('base64') },
      { wav: monoWav },
      { wav: wrongRateWav },
      { wav: tooLongWav },
      { volume: -0.001 },
      { volume: 1.001 },
      { volume: Number.NaN },
      { sound: 'arbitrary-file-open' },
      { sequence: 0 },
      { sequence: Number.NaN },
    ];
    for (const overrides of invalidPayloads) {
      await assert.rejects(async () => audio.play(cue(id, overrides)),
        `invalid payload should throw: ${JSON.stringify(overrides, (_key, value) => Number.isNaN(value) ? 'NaN' : value).slice(0, 160)}`);
    }

    const callerPath = path.join(testRoot, 'must-not-forward-user-file.wav');
    try {
      const withPath = await audio.play(cue(id, { sequence: 2, file: callerPath, path: callerPath }));
      assert.equal(withPath.played, true);
    } catch {
      // Strict payload validation may reject caller-supplied path keys entirely.
    }
    assertGeneratedFilesAreContained(native.commands, dataDir, callerPath);
    assert.ok(native.commands.every(command => command.file !== callerPath),
      'native commands must use only generated files under the bounded dataDir');
  });
});

let testRoot;
try {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const taskDataRoot = path.join(projectRoot, '.tools', 'interface-audio-check-2026-10-17');
  await mkdir(taskDataRoot, { recursive: true });
  testRoot = await mkdtemp(path.join(taskDataRoot, `run-${Date.now()}-`));
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      process.stdout.write(`ok - ${name}\n`);
    } catch (error) {
      failures++;
      process.stderr.write(`not ok - ${name}\n${error?.stack ?? error}\n`);
    }
  }
  process.stdout.write(`${tests.length - failures}/${tests.length} interface audio checks passed\n`);
  process.stdout.write(`mock data: ${testRoot}\n`);
  if (failures) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
}
