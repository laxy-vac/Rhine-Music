import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeProcessing } from '../src/audio-processing-model.mjs'

const SOUNDS = new Set(['page-open','page-close','ui-tick','brand','text-reveal','key','tick','column','open','confirm','back','scan','welcome','array','inspect','explode','assemble'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const PROCESSING = normalizeProcessing({ transition: { transportFade: true, transportMs: 20, seekFade: false } })
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

/** One short UI voice on the music host. Music always drains this voice before opening. */
export class InterfaceAudio {
  constructor({ native, dataDir }) {
    this.native = native
    this.dataDir = path.resolve(dataDir)
    this.cacheDir = path.join(this.dataDir, 'interface-audio-v1')
    this.tail = Promise.resolve()
    this.generation = 0
    this.sequence = 0
    this.closed = false
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
    clearTimeout(this.timer)
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
    const generation = ++this.generation
    const current = () => generation === this.generation && this.matches(value) && this.eligible()
    return this.enqueue(async () => {
      if (!current()) return { played: false, reason: 'stale' }
      await this.stopVoice()
      if (!current() || !value.volume) return { played: false, reason: 'inactive' }
      if (this.lastError) { const error = this.lastError; this.lastError = undefined; throw error }
      const file = await this.cache(wav)
      if (!current()) return { played: false, reason: 'stale' }
      const session = randomUUID(), output = this.config.output
      const voice = this.voice = { session, generation, duration: (wav.length-44)/192000, startedAt: Date.now() }
      try {
        await this.native.command({ cmd: 'open', session, file, mode: 'pcm', dsd: false, backend: output.backend, device: output.device, channel: output.channel, wasapiDevice: output.wasapiDevice || 'default', wasapiMode: 'shared', processing: structuredClone(PROCESSING), volume: value.volume, position: 0, sourceFormat: { sampleRate: 48000, bitsPerSample: 16, codec: 'PCM', lossless: true } })
        if (!current()) { await this.stopVoice(); return { played: false, reason: 'stale' } }
        await this.native.command({ cmd: 'play', session })
        if (!current()) { await this.stopVoice(); return { played: false, reason: 'stale' } }
        this.scheduleFinish(voice, Math.ceil(voice.duration*1000)+30)
        return { played: true }
      } catch (error) { await this.stopVoice().catch(() => {}); throw error }
    })
  }
  scheduleFinish(voice, delay) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.enqueue(async () => {
        if (this.voice !== voice) return
        const status = await this.native.command({ cmd: 'status', session: voice.session })
        if (status.ended || status.error || !status.playing || Date.now()-voice.startedAt > voice.duration*1000+2000) await this.stopVoice()
        else this.scheduleFinish(voice, 60)
      }).catch(error => { this.lastError = error; void this.enqueue(() => this.stopVoice()).catch(() => {}) })
    }, delay)
    this.timer.unref?.()
  }
  async stopVoice() {
    clearTimeout(this.timer)
    const voice = this.voice
    this.voice = undefined
    if (voice) await this.native.command({ cmd: 'stop', session: voice.session })
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
    clearTimeout(this.timer)
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
