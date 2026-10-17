import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeProcessing } from '../src/audio-processing-model.mjs'

const SOUNDS = new Set(['page-open','page-close','ui-tick','brand','text-reveal','key','tick','column','open','confirm','back','scan','welcome','array','inspect','explode','assemble'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const PROCESSING = normalizeProcessing({ transition: { transportFade: true, transportMs: 20, seekFade: false } })
const SAMPLE_RATE = 48000
const CHANNELS = 2
const FLOAT_FRAME_BYTES = CHANNELS * 4
const STREAM_SECONDS = 120
const STREAM_FRAMES = SAMPLE_RATE * STREAM_SECONDS
const STREAM_BYTES = 44 + STREAM_FRAMES * FLOAT_FRAME_BYTES
const PREWRITE_FRAMES = SAMPLE_RATE * 100 / 1000
const INITIAL_BUFFER_FRAMES = PREWRITE_FRAMES
const PUMP_INTERVAL_MS = 20
const STATUS_INTERVAL_MS = 60
const DRAIN_MS = 250
const MAX_VOICES = 10
const fail = message => Object.assign(new Error(message), { status: 400 })
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw fail('界面音效请求包含无效字段。')
}
function identity(value, keys) {
  object(value, ['clientId','clientStartedAt','revision',...keys])
  if (!UUID.test(value.clientId) || !Number.isFinite(value.clientStartedAt) || value.clientStartedAt < 0 || !Number.isSafeInteger(value.revision) || value.revision < 1) throw fail('界面音效会话无效。')
}
function sequence(value) {
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw fail('界面音效序号无效。')
}
function decodeWav(value) {
  if (typeof value !== 'string' || value.length > 640064 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw fail('界面音效 WAV 编码无效。')
  const wav = Buffer.from(value, 'base64')
  if (wav.length < 48 || wav.length > 480044 || wav.toString('base64') !== value || wav.toString('ascii',0,4) !== 'RIFF' || wav.toString('ascii',8,12) !== 'WAVE' || wav.toString('ascii',12,16) !== 'fmt ' || wav.readUInt32LE(16) !== 16 || wav.readUInt16LE(20) !== 1 || wav.readUInt16LE(22) !== 2 || wav.readUInt32LE(24) !== 48000 || wav.readUInt32LE(28) !== 192000 || wav.readUInt16LE(32) !== 4 || wav.readUInt16LE(34) !== 16 || wav.toString('ascii',36,40) !== 'data' || wav.readUInt32LE(40) !== wav.length-44 || wav.readUInt32LE(4) !== wav.length-8 || (wav.length-44)%4) throw fail('界面音效仅接受最长 2.5 秒的 48 kHz 双声道 PCM16 WAV。')
  return wav
}

function floatStreamHeader() {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(STREAM_BYTES - 8, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(3, 20)
  header.writeUInt16LE(CHANNELS, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * FLOAT_FRAME_BYTES, 28)
  header.writeUInt16LE(FLOAT_FRAME_BYTES, 32)
  header.writeUInt16LE(32, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(STREAM_FRAMES * FLOAT_FRAME_BYTES, 40)
  return header
}

function cueSamples(wav, volume) {
  const frames = (wav.length - 44) / 4
  const samples = new Float32Array(frames * CHANNELS)
  for (let index = 0; index < samples.length; index++) samples[index] = wav.readInt16LE(44 + index * 2) / 32768 * volume
  return samples
}

/** One progressively written UI mix on the music host. Music drains it before opening. */
export class InterfaceAudio {
  constructor({ native, dataDir }) {
    this.native = native
    this.dataDir = path.resolve(dataDir)
    this.cacheDir = path.join(this.dataDir, 'interface-audio-v1')
    this.tail = Promise.resolve()
    this.generation = 0
    this.sequence = 0
    this.closed = false
    this.voice = undefined
    this.pendingCueCount = 0
    this.deferredCues = []
  }
  enqueue(operation) {
    const task = this.tail.catch(() => {}).then(operation)
    this.tail = task.catch(() => {})
    return task
  }
  matches(value) {
    const config = this.config
    return !this.closed && !!config && value.clientId === config.clientId && value.clientStartedAt === config.clientStartedAt && value.revision === config.revision
  }
  eligible() {
    const config = this.config
    return !this.closed && config?.enabled && config.design === 'rhine' && !config.musicBusy && config.output.backend !== 'browser' && (config.output.backend !== 'asio' || config.output.device >= 0) && (!this.native.frontendOwner || this.native.frontendOwner === config.clientId) && this.native.interfaceIdle?.() === true
  }
  configure(value) {
    identity(value, ['design','enabled','musicBusy','output'])
    object(value.output, ['backend','device','channel','wasapiDevice'])
    const output = value.output
    if (!['rhine','archive'].includes(value.design) || typeof value.enabled !== 'boolean' || typeof value.musicBusy !== 'boolean' || !['browser','wasapi','asio'].includes(output.backend) || !Number.isInteger(output.device) || output.device < -1 || output.device > 255 || !Number.isInteger(output.channel) || output.channel < 0 || output.channel > 255 || typeof output.wasapiDevice !== 'string' || output.wasapiDevice.length > 2048 || /[\r\n\0]/.test(output.wasapiDevice)) throw fail('界面音效设置无效。')
    const previous = this.config
    if (this.closed || previous && (value.clientStartedAt < previous.clientStartedAt || value.clientStartedAt === previous.clientStartedAt && (value.clientId !== previous.clientId || value.revision <= previous.revision))) return { stale: true }
    this.config = structuredClone(value)
    this.sequence = 0
    this.generation++
    this.invalidatePump(true)
    // Configuration takes effect synchronously, including an open already in flight.
    void this.enqueue(() => this.stopVoice()).catch(error => { this.lastError = error })
    return { enabled: this.eligible() === true }
  }
  play(value) {
    identity(value, ['sequence','sound','volume','wav'])
    sequence(value)
    if (!SOUNDS.has(value.sound) || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1) throw fail('界面音效名称或音量无效。')
    const wav = decodeWav(value.wav)
    if (!this.matches(value) || value.sequence <= this.sequence || !this.eligible()) return Promise.resolve({ played: false, reason: 'inactive' })
    this.sequence = value.sequence
    const generation = this.generation
    const current = () => generation === this.generation && this.matches(value) && this.eligible()
    if (!value.volume) return Promise.resolve({ played: false, reason: 'inactive' })
    this.pendingCueCount++
    return this.enqueue(async () => {
      try {
        if (!current()) return { played: false, reason: 'stale' }
        if (this.lastError) { const error = this.lastError; this.lastError = undefined; throw error }
        await this.cache(wav)
        if (!current()) return { played: false, reason: 'stale' }
        const samples = cueSamples(wav, value.volume)
        if (!samples.length) return { played: false, reason: 'inactive' }
        let stream = this.voice
        if (!stream) stream = await this.openStream(generation, value)
        if (!stream || !current() || this.voice !== stream) return { played: false, reason: 'stale' }
        if (!this.addCue(stream, samples)) {
          const deferred = this.deferCue(stream, { generation, request: value, samples })
          this.schedulePump(PUMP_INTERVAL_MS)
          return { deferred }
        }
        return { acknowledgement: stream.playPromise, generation, request: value }
      } catch (error) {
        if (this.voice?.generation === generation) await this.stopVoice().catch(() => {})
        throw error
      } finally {
        this.pendingCueCount = Math.max(0, this.pendingCueCount - 1)
      }
    }).then(result => this.settlePlayResult(result))
  }

  invalidatePump(discardDeferred = false) {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.voice) {
      this.voice.cancelled = true
      this.voice.voices.length = 0
    }
    if (discardDeferred) {
      for (const cue of this.deferredCues.splice(0)) cue.resolve({ played: false, reason: 'stale' })
    }
  }

  makeVoiceRoom(stream) {
    while (stream.voices.length + this.deferredCues.length >= MAX_VOICES) {
      if (stream.voices.length) stream.voices.shift()
      else this.deferredCues.shift()?.resolve({ played: false, reason: 'voice-limit' })
    }
  }

  addCue(stream, samples) {
    const nowFrame = Math.floor(Math.max(0, performance.now() - stream.startedAt) * SAMPLE_RATE / 1000)
    const startFrame = Math.max(stream.writeFrames, nowFrame + PREWRITE_FRAMES)
    const endFrame = startFrame + samples.length / CHANNELS
    if (endFrame > STREAM_FRAMES) return false
    this.makeVoiceRoom(stream)
    stream.voices.push({ order: ++stream.voiceOrder, startFrame, endFrame, samples })
    this.schedulePump(PUMP_INTERVAL_MS)
    return true
  }

  deferCue(stream, cue) {
    this.makeVoiceRoom(stream)
    let resolve
    const promise = new Promise(done => { resolve = done })
    this.deferredCues.push({ ...cue, resolve })
    return promise
  }

  settlePlayResult(result) {
    if (result?.deferred) return result.deferred.then(value => this.settlePlayResult(value))
    if (result?.acknowledgement) return result.acknowledgement.then(() => {
      const current = result.generation === this.generation && this.matches(result.request) && this.eligible()
      return current ? { played: true } : { played: false, reason: 'stale' }
    })
    return result
  }

  async startDeferredCues() {
    const cues = this.deferredCues.splice(0)
    const eligible = cues.filter(cue => {
      const valid = cue.generation === this.generation && this.matches(cue.request) && this.eligible()
      if (!valid) cue.resolve({ played: false, reason: 'stale' })
      return valid
    })
    if (!eligible.length) return
    let stream
    try { stream = await this.openStream(eligible[0].generation, eligible[0].request) }
    catch (error) {
      for (const cue of eligible) cue.resolve({ played: false, reason: 'error' })
      throw error
    }
    if (!stream) {
      for (const cue of eligible) cue.resolve({ played: false, reason: 'stale' })
      return
    }
    for (const cue of eligible) {
      if (cue.generation !== this.generation || !this.matches(cue.request) || !this.eligible()) {
        cue.resolve({ played: false, reason: 'stale' })
      } else if (this.addCue(stream, cue.samples)) {
        cue.resolve({ acknowledgement: stream.playPromise, generation: cue.generation, request: cue.request })
      }
      else cue.resolve({ played: false, reason: 'stream-limit' })
    }
  }

  async writeAt(stream, bytes, position) {
    let offset = 0
    while (offset < bytes.length) {
      const result = await stream.writer.write(bytes, offset, bytes.length - offset, position + offset)
      if (!result.bytesWritten) throw fail('界面音效渐进流写入失败。')
      offset += result.bytesWritten
    }
  }

  async openStream(generation, request) {
    const stream = {
      session: randomUUID(), generation, voices: [], voiceOrder: 0, writeFrames: 0,
      contentEndFrame: 0, startedAt: 0, lastStatusAt: 0, statusPending: false, cancelled: false,
      openAttempted: false, opened: false, file: undefined, fileIdentity: undefined, writer: undefined,
    }
    this.voice = stream
    try {
      await fs.mkdir(this.cacheDir, { recursive: true })
      const [root, directory] = await Promise.all([fs.realpath(this.dataDir), fs.realpath(this.cacheDir)])
      if (path.dirname(directory) !== root) throw fail('界面音效缓存目录已变化。')
      stream.file = path.join(directory, `ui-${randomUUID()}.wav.partial`)
      stream.writer = await fs.open(stream.file, 'wx+')
      stream.fileIdentity = await stream.writer.stat()
      await this.writeAt(stream, floatStreamHeader(), 0)
      const initial = Buffer.alloc(INITIAL_BUFFER_FRAMES * FLOAT_FRAME_BYTES)
      await this.writeAt(stream, initial, 44)
      stream.writeFrames = INITIAL_BUFFER_FRAMES
      if (generation !== this.generation || stream.cancelled || !this.matches(request) || !this.eligible()) {
        await this.stopVoice()
        return undefined
      }
      const output = this.config.output
      stream.openAttempted = true
      await this.native.command({
        cmd: 'open', session: stream.session, file: stream.file, growingBytes: STREAM_BYTES,
        mode: 'pcm', dsd: false, backend: output.backend, device: output.device, channel: output.channel,
        wasapiDevice: output.wasapiDevice || 'default', wasapiMode: 'shared',
        processing: structuredClone(PROCESSING), volume: 1, position: 0,
        sourceFormat: { sampleRate: SAMPLE_RATE, bitsPerSample: 32, codec: 'IEEE_FLOAT', lossless: true },
      })
      stream.opened = true
      if (generation !== this.generation || stream.cancelled || !this.matches(request) || !this.eligible()) {
        await this.stopVoice()
        return undefined
      }
      stream.startedAt = performance.now()
      stream.lastStatusAt = stream.startedAt
      stream.playPromise = Promise.resolve()
        .then(() => this.native.command({ cmd: 'play', session: stream.session }))
        .catch(error => {
          if (this.voice === stream && !stream.cancelled) {
            this.lastError = error
            this.generation++
            this.invalidatePump(true)
            void this.enqueue(() => this.stopVoice()).catch(() => {})
          }
          throw error
        })
      stream.playPromise.catch(() => {})
      return stream
    } catch (error) {
      if (this.voice === stream) await this.stopVoice().catch(() => {})
      throw error
    }
  }

  async mixFrames(stream, startFrame, frames) {
    const bytes = Buffer.alloc(frames * FLOAT_FRAME_BYTES)
    const endFrame = startFrame + frames
    for (const voice of stream.voices) {
      if (!voice.samples) continue
      const overlapStart = Math.max(startFrame, voice.startFrame)
      const overlapEnd = Math.min(endFrame, voice.endFrame)
      if (overlapEnd <= overlapStart) continue
      const sourceOffset = (overlapStart - voice.startFrame) * CHANNELS
      const destinationOffset = (overlapStart - startFrame) * CHANNELS
      const sampleCount = (overlapEnd - overlapStart) * CHANNELS
      for (let index = 0; index < sampleCount; index++) {
        const sample = bytes.readFloatLE((destinationOffset + index) * 4) + voice.samples[sourceOffset + index]
        bytes.writeFloatLE(Math.max(-1, Math.min(1, sample)), (destinationOffset + index) * 4)
      }
      stream.contentEndFrame = Math.max(stream.contentEndFrame, overlapEnd)
    }
    await this.writeAt(stream, bytes, 44 + startFrame * FLOAT_FRAME_BYTES)
    stream.writeFrames = endFrame
    for (const voice of stream.voices) if (voice.endFrame <= stream.writeFrames) voice.samples = undefined
  }

  schedulePump(delay = PUMP_INTERVAL_MS) {
    if (this.timer || !this.voice || this.voice.cancelled) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.enqueue(() => this.pump()).catch(error => {
        this.lastError = error
        this.invalidatePump(true)
        void this.enqueue(() => this.stopVoice()).catch(() => {})
      })
    }, delay)
    this.timer.unref?.()
  }

  pollStatus(stream, now) {
    if (stream.statusPending || now - stream.lastStatusAt < STATUS_INTERVAL_MS) return
    stream.lastStatusAt = now
    stream.statusPending = true
    void Promise.resolve().then(() => this.native.command({ cmd: 'status', session: stream.session })).then(status => {
      stream.statusPending = false
      if (this.voice !== stream || stream.cancelled || stream.generation !== this.generation) return
      void this.enqueue(() => this.handleStatus(stream, status)).catch(error => {
        this.lastError = error
        this.invalidatePump(true)
        void this.enqueue(() => this.stopVoice()).catch(() => {})
      })
    }, error => {
      stream.statusPending = false
      if (this.voice !== stream || stream.cancelled || stream.generation !== this.generation) return
      this.lastError = error
      this.generation++
      this.invalidatePump(true)
      void this.enqueue(() => this.stopVoice()).catch(() => {})
    })
  }

  async handleStatus(stream, status) {
    if (this.voice !== stream || stream.cancelled || stream.generation !== this.generation) return
    if (!this.eligible()) {
      this.invalidatePump(true)
      await this.stopVoice()
      return
    }
    if (status?.ended === true || status?.error || (status?.playing === false && status?.buffering !== true)) {
      await this.stopVoice()
      await this.startDeferredCues()
    }
  }

  async pump() {
    const stream = this.voice
    if (!stream) return
    if (stream.cancelled || stream.generation !== this.generation || !this.eligible()) {
      if (!this.eligible()) this.invalidatePump(true)
      await this.stopVoice()
      return
    }
    const now = performance.now()
    const elapsedMs = Math.max(0, now - stream.startedAt)
    const playbackFrame = Math.floor(elapsedMs * SAMPLE_RATE / 1000)
    const targetFrame = Math.min(STREAM_FRAMES, playbackFrame + PREWRITE_FRAMES)
    while (stream.writeFrames < targetFrame) {
      if (this.voice !== stream || stream.cancelled || stream.generation !== this.generation || !this.eligible()) {
        if (!this.eligible()) this.invalidatePump(true)
        await this.stopVoice()
        return
      }
      const frames = Math.min(targetFrame - stream.writeFrames, SAMPLE_RATE / 5)
      await this.mixFrames(stream, stream.writeFrames, frames)
    }
    if (this.voice !== stream || stream.cancelled || stream.generation !== this.generation) return
    if (!this.eligible()) {
      this.invalidatePump(true)
      await this.stopVoice()
      return
    }
    stream.voices = stream.voices.filter(voice => voice.endFrame > playbackFrame)
    if (this.pendingCueCount === 0 && stream.voices.length === 0 && stream.contentEndFrame > 0
      && elapsedMs >= stream.contentEndFrame * 1000 / SAMPLE_RATE + DRAIN_MS) {
      await this.stopVoice()
      await this.startDeferredCues()
      return
    }
    this.pollStatus(stream, now)
    if (this.voice === stream) this.schedulePump(PUMP_INTERVAL_MS)
  }

  async stopVoice() {
    this.invalidatePump()
    const stream = this.voice
    this.voice = undefined
    if (!stream) return
    let stopError
    let stopped = !stream.opened
    if (stream.openAttempted) {
      try {
        await this.native.command({ cmd: 'stop', session: stream.session })
        stopped = true
      } catch (error) { stopError = error }
    }
    let closeError
    try { await stream.writer?.close() } catch (error) { closeError = error }
    if (stopped && stream.file && stream.fileIdentity) {
      const existing = await fs.stat(stream.file).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
      if (existing && existing.dev === stream.fileIdentity.dev && existing.ino === stream.fileIdentity.ino) await fs.unlink(stream.file)
    }
    if (stopError) throw stopError
    if (closeError) throw closeError
  }
  stop(value) {
    identity(value, ['sequence'])
    sequence(value)
    if (!this.matches(value) || value.sequence <= this.sequence) return Promise.resolve({ stale: true })
    this.sequence = value.sequence
    return this.cancel().then(() => ({ stopped: true }))
  }
  cancel() {
    this.generation++
    this.invalidatePump(true)
    return this.enqueue(() => this.stopVoice())
  }
  async close() { this.closed = true; await this.cancel() }
  async cache(wav) {
    await fs.mkdir(this.cacheDir, { recursive: true })
    const [root, directory] = await Promise.all([fs.realpath(this.dataDir),fs.realpath(this.cacheDir)])
    if (path.dirname(directory) !== root) throw fail('界面音效缓存目录已变化。')
    const manifest = path.join(directory, 'manifest.json')
    let text = await fs.readFile(manifest,'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (text === null) { text = JSON.stringify({ version: 1, hashes: [] }); await fs.writeFile(manifest,text,{ flag: 'wx' }) }
    let index
    try { index = JSON.parse(text) } catch { throw fail('界面音效缓存索引损坏，未覆盖原文件。') }
    if (index?.version !== 1 || !Array.isArray(index.hashes) || index.hashes.length > 32 || index.hashes.some(hash => typeof hash !== 'string' || !HASH.test(hash)) || new Set(index.hashes).size !== index.hashes.length) throw fail('界面音效缓存索引无效，未覆盖原文件。')
    const hash = createHash('sha256').update(wav).digest('hex')
    const file = path.join(directory, `${hash}.wav`)
    const existing = await fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
    if (existing && !existing.equals(wav)) throw fail('界面音效缓存文件已被修改，未覆盖原文件。')
    if (!existing) await fs.writeFile(file,wav,{ flag: 'wx' })
    const hashes = [...index.hashes.filter(item => item !== hash),hash]
    if (await fs.readFile(manifest,'utf8') !== text) throw fail('界面音效缓存索引已被外部修改，未覆盖。')
    while (hashes.length > 32) {
      const oldest = hashes.shift(), candidate = path.join(directory, `${oldest}.wav`)
      const bytes = await fs.readFile(candidate).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
      if (bytes && createHash('sha256').update(bytes).digest('hex') === oldest) await fs.unlink(candidate)
    }
    if (await fs.readFile(manifest,'utf8') !== text) throw fail('界面音效缓存索引已被外部修改，未覆盖。')
    await fs.writeFile(manifest,JSON.stringify({ version: 1, hashes }))
    return file
  }
}
