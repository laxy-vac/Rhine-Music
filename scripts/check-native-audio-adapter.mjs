import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NativeAudio, outputDefault } from '../src/native-audio.ts'
import { normalizeProcessing } from '../src/audio-processing-model.mjs'

const track = { id: 'native-audio-test', format: 'FLAC', relativePath: 'test.flac' }
const turn = () => new Promise(resolve => setImmediate(resolve))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class FakeNativeApi {
  constructor({ pauseDelay = 0, playDelay = 0, startGate, holdStatus = false } = {}) {
    this.pauseDelay = pauseDelay
    this.playDelay = playDelay
    this.startGate = startGate
    this.holdStatus = holdStatus
    this.state = { playing: false, paused: true, ended: false, position: 0, duration: 60,
      backend: 'wasapi', mode: 'pcm', sampleRate: 48000, channels: 2, volumeLocked: false }
    this.applied = []
    this.waiters = []
    this.startRequested = deferred()
    this.statusRequested = deferred()
    this.statusResponse = deferred()
    this.stopApplied = deferred()
    this.statusSignal = undefined
  }

  waitForApplied(action, count = 1) {
    if (this.applied.filter(item => item === action).length >= count) return Promise.resolve()
    return new Promise(resolve => this.waiters.push({ action, count, resolve }))
  }

  async fetch(url, init = {}) {
    assert.equal(url.startsWith('/api/native/'), true, `unexpected URL: ${url}`)
    const request = JSON.parse(init.body ?? '{}')
    if (url === '/api/native/start') {
      this.startRequested.resolve()
      if (this.startGate) await this.startGate.promise
      this.state = { ...this.state, playing: false, paused: true, ended: false, position: request.position ?? 0 }
      return this.response(this.state)
    }
    assert.equal(url, '/api/native/control', `unexpected route: ${url}`)
    if (request.action === 'status' && this.holdStatus) {
      this.statusSignal = init.signal
      this.statusRequested.resolve()
      const lateState = await this.statusResponse.promise
      return this.response(lateState)
    }
    if (request.action === 'pause' && this.pauseDelay) {
      await new Promise(resolve => setTimeout(resolve, this.pauseDelay))
    }
    if (request.action === 'play' && this.playDelay) await new Promise(resolve => setTimeout(resolve, this.playDelay))
    this.apply(request.action, request)
    return this.response(this.state)
  }

  apply(action, request) {
    this.applied.push(action)
    if(action==='processing')this.processing=request.processing
    if (action === 'play') { this.state.playing = true; this.state.paused = false; this.state.ended = false }
    else if (action === 'pause') { this.state.playing = false; this.state.paused = true }
    else if (action === 'seek') this.state.position = request.position
    else if (action === 'stop') {
      this.state.playing = false; this.state.paused = true
      this.stopApplied.resolve()
    }
    for (const waiter of this.waiters) {
      if (waiter.action === action && this.applied.filter(item => item === action).length >= waiter.count) waiter.resolve()
    }
    this.waiters = this.waiters.filter(waiter => this.applied.filter(item => item === waiter.action).length < waiter.count)
  }

  response(value) {
    const result = { ...value }
    return { ok: true, json: async () => result }
  }
}

async function withAudio(api, run) {
  const previousFetch = globalThis.fetch
  globalThis.fetch = (url, init) => api.fetch(url, init)
  const settings = { ...outputDefault, backend: 'wasapi' }
  const audio = new NativeAudio(track, settings)
  try {
    await run(audio, api)
  } finally {
    const stopped = api.stopApplied.promise
    audio.load()
    await stopped
    await turn()
    globalThis.fetch = previousFetch
  }
}

test('processing edited during a pending open is applied after initialization',async()=>{
 const gate=deferred(),api=new FakeNativeApi({startGate:gate});
 await withAudio(api,async audio=>{
  const starting=audio.play();await api.startRequested.promise;
  const processing=normalizeProcessing({float64:true,eq:{preamp:-3}});
  const changing=audio.applyProcessing(processing);
  assert.equal(api.applied.includes('processing'),false);
  gate.resolve();await starting;await changing;
  assert.equal(api.processing.eq.preamp,-3);assert.equal(api.processing.float64,true);
  assert.equal(audio.processingSignature,JSON.stringify(processing));
 });
});

test('pause followed immediately by play keeps host and adapter in play order', async () => {
  const api = new FakeNativeApi({ pauseDelay: 80 })
  await withAudio(api, async audio => {
    await audio.play()
    api.applied.length = 0

    const pauseApplied = api.waitForApplied('pause')
    audio.pause()
    await audio.play()
    await pauseApplied

    assert.deepEqual(api.applied, ['pause', 'play'])
    assert.equal(api.state.playing, true)
    assert.equal(audio.paused, false)
  })
})

test('a rapid play followed by pause settles paused', async () => {
  const api = new FakeNativeApi({ playDelay: 20 })
  await withAudio(api, async audio => {
    await audio.play()
    audio.pause()
    await api.waitForApplied('pause')
    api.applied.length = 0
    let playingEvents = 0
    audio.addEventListener('playing', () => { playingEvents++ })
    const pauseApplied = api.waitForApplied('pause')
    const pendingPlay = audio.play()
    await turn()
    audio.pause()
    await pendingPlay
    await pauseApplied
    assert.equal(api.applied[0], 'play')
    assert.equal(api.applied.at(-1), 'pause')
    assert.equal(playingEvents, 0, 'An outdated play response must not emit playing')
    assert.equal(api.state.playing, false)
    assert.equal(audio.paused, true)
  })
})

test('pausing while start is pending does not auto-start after metadata arrives', async () => {
  const startGate = deferred()
  const api = new FakeNativeApi({ startGate })
  await withAudio(api, async audio => {
    const playing = audio.play()
    await api.startRequested.promise
    audio.pause()
    startGate.resolve()
    await playing

    assert.deepEqual(api.applied, ['pause'])
    assert.equal(api.state.playing, false)
    assert.equal(audio.paused, true)
  })
})

test('a late poll response after load cannot mutate the disposed adapter', async () => {
  const api = new FakeNativeApi({ holdStatus: true })
  await withAudio(api, async audio => {
    await audio.play()
    let errors = 0
    audio.addEventListener('error', () => { errors++ })

    await api.statusRequested.promise
    audio.load()
    await api.stopApplied.promise
    assert.equal(api.statusSignal.aborted, true)

    api.statusResponse.resolve({ ...api.state, playing: false, paused: true, ended: true, position: 42 })
    await turn()
    await turn()

    assert.equal(audio.currentTime, 0)
    assert.equal(audio.ended, false)
    assert.equal(audio.error, null)
    assert.equal(errors, 0)
  })
})
