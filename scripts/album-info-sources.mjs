import { randomBytes, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { AlbumIntroductionProvider } from './album-introductions.mjs'
import { renameWithRetry } from './platform.mjs'

const BUILTIN_SOURCES = [
  { id: 'wikipedia', name: 'Wikipedia', builtin: true, enabled: true },
  { id: 'qq', name: 'QQ音乐', builtin: true, enabled: true },
  { id: 'netease', name: '网易云音乐', builtin: true, enabled: true },
]
const DEFAULT_SOURCE_ID = 'wikipedia'
const DEFAULT_MAPPING = {
  results: 'results', id: 'id', title: 'title', artist: 'artist', year: 'year',
  description: 'description', cover: 'cover', url: 'url',
}
const MAX_CUSTOM_SOURCES = 20
const MAX_CACHE_ENTRIES = 512
const CANDIDATE_TTL_MS = 15 * 60 * 1000
const MAX_JSON_BYTES = 2 * 1024 * 1024
const MAX_COVER_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_RESULTS = 20
const DEFAULT_TIMEOUT_MS = 12_000
const CONFIG_LIMIT_BYTES = 128 * 1024
const MAPPING_KEYS = new Set(Object.keys(DEFAULT_MAPPING))
const SAFE_MAPPING_PART = /^[a-zA-Z0-9_]+$/

const fail = (message, status = 400) => Object.assign(new Error(message), { status })
const unique = (values) => [...new Set(values.filter(Boolean))]

function cleanText(value, limit = 512) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, limit)
}

function descriptionText(value) {
  return typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, 32 * 1024)
    : ''
}

function pathValue(object, route) {
  let value = object
  for (const part of route.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

function stringList(value) {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value]
  return rows.map((entry) => cleanText(typeof entry === 'string' ? entry : entry?.name ?? entry?.title, 256)).filter(Boolean)
}

function yearValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1_000 && value <= 9_999) return Math.trunc(value)
    const milliseconds = value > 100_000_000_000 ? value : value > 1_000_000_000 ? value * 1000 : 0
    if (milliseconds) {
      const year = new Date(milliseconds).getUTCFullYear()
      return Number.isFinite(year) && year >= 1_000 && year <= 9_999 ? year : undefined
    }
  }
  const match = /(?:^|\D)((?:1[5-9]|20)\d{2})(?:\D|$)/.exec(cleanText(value, 80))
  return match ? Number(match[1]) : undefined
}

function validateTemplate(value, allowedTokens, label, requiredToken) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/.test(value)) throw fail(`${label}无效。`)
  const tokens = [...value.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1])
  if (tokens.some((token) => !allowedTokens.has(token)) || /[{}]/.test(value.replace(/\{[^{}]+\}/g, 'sample'))) throw fail(`${label}含有不支持的模板字段。`)
  if (requiredToken && !tokens.includes(requiredToken)) throw fail(`${label}需要包含 {${requiredToken}}。`)
  const sample = value.replace(/\{([^{}]+)\}/g, (_, token) => encodeURIComponent(`sample-${token}`))
  let url
  try { url = new URL(sample) } catch { throw fail(`${label}必须是完整的 HTTP(S) 地址。`) }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fail(`${label}必须使用 HTTP(S)，且不能包含用户名或密码。`)
  return value
}

function validateCustomSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('自定义专辑来源格式无效。')
  const id = value.id || `custom-${randomUUID()}`
  if (typeof id !== 'string' || !/^custom-[a-zA-Z0-9-]{1,64}$/.test(id)) throw fail('自定义专辑来源编号无效。')
  const name = cleanText(value.name, 80)
  if (!name) throw fail('请填写专辑来源名称。')
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw fail('来源启用状态必须为布尔值。')
  const searchTokens = new Set(['query', 'title', 'artist'])
  const detailTokens = new Set(['id', 'title', 'artist', 'query'])
  const searchUrl = validateTemplate(value.searchUrl, searchTokens, '搜索地址', null)
  if (![...searchTokens].some((token) => searchUrl.includes(`{${token}}`))) throw fail('搜索地址需要包含 {query}、{title} 或 {artist}。')
  const detailUrl = validateTemplate(value.detailUrl, detailTokens, '专辑详情地址', 'id')
  const mapping = { ...DEFAULT_MAPPING }
  if (value.mapping !== undefined) {
    if (!value.mapping || typeof value.mapping !== 'object' || Array.isArray(value.mapping)) throw fail('字段映射需要是 JSON 对象。')
    for (const [key, route] of Object.entries(value.mapping)) {
      if (!MAPPING_KEYS.has(key) || typeof route !== 'string' || route.length > 128 || !route || route.split('.').some((part) => !SAFE_MAPPING_PART.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) throw fail(`字段映射无效：${key}`)
      mapping[key] = route
    }
  }
  return { id, name, builtin: false, enabled: value.enabled !== false, searchUrl, detailUrl, mapping }
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.sources) || value.sources.length > MAX_CUSTOM_SOURCES + BUILTIN_SOURCES.length) throw fail('专辑资料来源设置格式无效。')
  const builtins = new Map(BUILTIN_SOURCES.map((source) => [source.id, { ...source }]))
  const custom = []
  const seen = new Set()
  for (const valueSource of value.sources) {
    if (!valueSource || typeof valueSource !== 'object' || Array.isArray(valueSource) || typeof valueSource.id !== 'string') throw fail('专辑资料来源项目无效。')
    if (seen.has(valueSource.id)) throw fail('专辑资料来源编号重复。')
    seen.add(valueSource.id)
    if (builtins.has(valueSource.id)) {
      if (valueSource.enabled !== undefined && typeof valueSource.enabled !== 'boolean') throw fail('来源启用状态必须为布尔值。')
      builtins.set(valueSource.id, { ...builtins.get(valueSource.id), enabled: valueSource.enabled !== false })
    } else {
      const source = validateCustomSource(valueSource)
      if (source.id !== valueSource.id) throw fail('自定义专辑来源编号无效。')
      custom.push(source)
    }
  }
  if (custom.length > MAX_CUSTOM_SOURCES) throw fail(`最多添加 ${MAX_CUSTOM_SOURCES} 个自定义专辑来源。`)
  const sources = [...BUILTIN_SOURCES.map((source) => builtins.get(source.id)), ...custom]
  const defaultSourceId = typeof value.defaultSourceId === 'string' ? value.defaultSourceId : DEFAULT_SOURCE_ID
  if (!sources.some((source) => source.id === defaultSourceId && source.enabled)) throw fail('请选择已启用的默认专辑资料来源。')
  return { version: 1, defaultSourceId, sources }
}

function renderTemplate(template, values) {
  return new URL(template.replace(/\{(query|title|artist|id)\}/g, (_, key) => encodeURIComponent(values[key] ?? '')))
}

function externalUrl(value, sourceId, { cover = false } = {}) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\0\r\n]/.test(value)) return undefined
  let url
  try { url = new URL(value.trim().startsWith('//') ? `https:${value.trim()}` : value.trim()) } catch { return undefined }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
  const host = url.hostname.toLowerCase()
  if (sourceId === 'wikipedia') {
    if (cover ? host !== 'upload.wikimedia.org' : !['zh.wikipedia.org', 'en.wikipedia.org'].includes(host)) return undefined
  } else if (sourceId === 'qq') {
    if (cover ? !['y.gtimg.cn', 'imgcache.qq.com', 'p.qpic.cn'].includes(host) : host !== 'y.qq.com') return undefined
  } else if (sourceId === 'netease') {
    if (cover ? !/^p[1-4]\.music\.126\.net$/.test(host) && host !== 'music.126.net' : host !== 'music.163.com') return undefined
  }
  if (cover && ['wikipedia', 'qq', 'netease'].includes(sourceId)) url.protocol = 'https:'
  return url.href
}

function imageType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function qqAlbumCoverUrl(mid) {
  const value = cleanText(mid, 64)
  if (!/^[a-zA-Z0-9]{14}$/.test(value)) return undefined
  return `https://y.gtimg.cn/music/photo_new/T002R180x180M000${value}_1.jpg`
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

function waitForWithSignal(promise, signal) {
  if (!signal) return promise
  abortIfNeeded(signal)
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback(value)
    }
    const onAbort = () => finish(reject, signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then((value) => finish(resolve, value), (error) => finish(reject, error))
    if (signal.aborted) onAbort()
  })
}

async function readLimited(response, limit, signal) {
  const length = Number(response.headers?.get?.('content-length') ?? 0)
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => {})
    throw fail(`来源响应超过 ${limit} 字节。`, 502)
  }
  const reader = response.body?.getReader?.()
  if (!reader) {
    if (typeof response.arrayBuffer !== 'function') throw fail('来源没有返回可读取内容。', 502)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > limit) throw fail(`来源响应超过 ${limit} 字节。`, 502)
    return buffer
  }
  const chunks = []
  let size = 0
  try {
    while (true) {
      abortIfNeeded(signal)
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw fail(`来源响应超过 ${limit} 字节。`, 502)
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  return Buffer.concat(chunks, size)
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
    await renameWithRetry(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true })
  }
}

export class AlbumInfoSources {
  constructor({ dataDir, fetcher = globalThis.fetch, contact, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now } = {}) {
    if (typeof dataDir !== 'string' || !dataDir.trim()) throw new TypeError('dataDir is required')
    if (typeof fetcher !== 'function') throw new TypeError('fetcher must be a function')
    this.dataDir = path.resolve(dataDir)
    this.sourceFile = path.join(this.dataDir, 'album-info', 'sources.json')
    this.fetcher = fetcher
    this.contact = contact
    this.timeoutMs = timeoutMs
    this.now = now
    this.sources = BUILTIN_SOURCES.map((source) => ({ ...source }))
    this.defaultSourceId = DEFAULT_SOURCE_ID
    this.cache = new Map()
    this.ready = null
    this.wikipedia = new AlbumIntroductionProvider({
      contact,
      timeoutMs,
      fetcher: async (url, options = {}) => {
        const data = await this.requestJson(url, { signal: options.signal, headers: options.headers, maxBytes: MAX_JSON_BYTES })
        return { ok: true, json: async () => data }
      },
    })
  }

  async init() {
    if (!this.ready) this.ready = (async () => {
      try {
        const info = await fs.stat(this.sourceFile)
        if (info.size > CONFIG_LIMIT_BYTES) throw fail('专辑来源配置过大，原文件已保留。')
        const value = JSON.parse(await fs.readFile(this.sourceFile, 'utf8'))
        if (value.version !== 1) throw fail('专辑来源配置版本不受支持，原文件已保留。')
        const normalized = normalizeSettings(value)
        this.sources = normalized.sources
        this.defaultSourceId = normalized.defaultSourceId
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      return this
    })()
    return this.ready
  }

  async settings() {
    await this.init()
    return { sources: structuredClone(this.sources), defaultSourceId: this.defaultSourceId }
  }

  async saveSettings(value) {
    await this.init()
    const normalized = normalizeSettings(value)
    const persisted = { version: 1, sources: normalized.sources, defaultSourceId: normalized.defaultSourceId }
    if (Buffer.byteLength(JSON.stringify(persisted), 'utf8') > CONFIG_LIMIT_BYTES) throw fail('专辑来源配置过大，设置未保存。')
    await writeJsonAtomic(this.sourceFile, persisted)
    this.sources = normalized.sources
    this.defaultSourceId = normalized.defaultSourceId
    this.cache.clear()
    return this.settings()
  }

  async fetchResponse(url, { signal, headers = {}, maxBytes = MAX_JSON_BYTES } = {}) {
    abortIfNeeded(signal)
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await this.fetcher(url, {
        headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.5', 'User-Agent': 'RhineMusic/1.0', ...headers },
        redirect: 'error', signal: requestSignal,
      })
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      if (timeout.aborted) throw fail('来源请求超时。', 504)
      throw fail(`无法连接来源：${cleanText(error?.message ?? error, 400)}`, 502)
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      throw fail(`来源返回 HTTP ${response.status}。`, response.status === 404 ? 404 : 502)
    }
    const length = Number(response.headers?.get?.('content-length') ?? 0)
    if (Number.isFinite(length) && length > maxBytes) {
      await response.body?.cancel().catch(() => {})
      throw fail(`来源响应超过 ${maxBytes} 字节。`, 502)
    }
    return response
  }

  async requestJson(url, options = {}) {
    const response = await this.fetchResponse(url, options)
    const bytes = await readLimited(response, options.maxBytes ?? MAX_JSON_BYTES, options.signal)
    try { return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '').trim()) }
    catch { throw fail('来源返回的不是有效 JSON。', 502) }
  }

  sourceFor(sourceId) {
    return this.sources.find((source) => source.id === sourceId)
  }

  pruneCache() {
    const expiredBefore = this.now() - CANDIDATE_TTL_MS
    for (const [id, value] of this.cache) if (value.createdAt < expiredBefore) this.cache.delete(id)
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value)
  }

  cacheCandidate(source, item, { rawId, detailsUrl } = {}) {
    const title = cleanText(item.title, 512)
    if (!title) return undefined
    const id = randomBytes(24).toString('base64url')
    const candidate = {
      id, sourceId: source.id, sourceName: source.name, title,
      artist: cleanText(item.artist, 512),
      ...(yearValue(item.year) ? { year: yearValue(item.year) } : {}),
      ...(descriptionText(item.description) ? { description: descriptionText(item.description) } : {}),
      ...(externalUrl(item.coverUrl, source.id, { cover: true }) ? { coverUrl: externalUrl(item.coverUrl, source.id, { cover: true }) } : {}),
      ...(externalUrl(item.url, source.id) ? { url: externalUrl(item.url, source.id) } : {}),
      ...(cleanText(item.license, 256) ? { license: cleanText(item.license, 256) } : {}),
    }
    const entry = {
      createdAt: this.now(), sourceId: source.id, sourceSignature: JSON.stringify(source),
      candidate, rawId: rawId === undefined || rawId === null ? undefined : String(rawId), detailsUrl,
    }
    this.cache.set(id, entry)
    this.pruneCache()
    return structuredClone(candidate)
  }

  getCandidate(candidateId) {
    this.pruneCache()
    const entry = typeof candidateId === 'string' ? this.cache.get(candidateId) : undefined
    const source = entry && this.sourceFor(entry.sourceId)
    if (!entry || !source || !source.enabled || entry.sourceSignature !== JSON.stringify(source)) throw fail('候选已过期或不存在，请重新搜索。', 409)
    return entry
  }

  async search({ title, artist = '', sourceId = '' } = {}, signal) {
    await this.init()
    const wantedTitle = cleanText(title, 512)
    const wantedArtist = cleanText(artist, 512)
    if (!wantedTitle) throw fail('请输入专辑名称。')
    let selected
    if (sourceId) {
      const source = this.sourceFor(sourceId)
      if (!source) throw fail('专辑资料来源不存在。', 404)
      selected = source.enabled ? [source] : []
    } else selected = this.sources.filter((source) => source.enabled)
    if (sourceId && !selected.length) {
      const source = this.sourceFor(sourceId)
      return { candidates: [], sources: [{ sourceId: source.id, name: source.name, status: 'error', count: 0, message: '此来源已停用。' }] }
    }
    const jobs = selected.map(async (source) => {
      const deadline = AbortSignal.timeout(this.timeoutMs)
      const sourceSignal = signal ? AbortSignal.any([signal, deadline]) : deadline
      try {
        const items = await this.searchSource(source, { title: wantedTitle, artist: wantedArtist }, sourceSignal)
        const candidates = items.slice(0, MAX_SOURCE_RESULTS).map((item) => this.cacheCandidate(source, item, item.cache)).filter(Boolean)
        return {
          candidates,
          outcome: { sourceId: source.id, name: source.name, status: candidates.length ? 'ok' : 'empty', count: candidates.length },
        }
      } catch (error) {
        if (signal?.aborted) throw signal.reason ?? error
        return { candidates: [], outcome: { sourceId: source.id, name: source.name, status: 'error', count: 0, message: deadline.aborted ? '来源搜索超时，请稍后重试。' : cleanText(error?.message ?? error, 512) || '来源暂时不可用。' } }
      }
    })
    const results = await Promise.all(jobs)
    abortIfNeeded(signal)
    this.pruneCache()
    return { candidates: results.flatMap((result) => result.candidates), sources: results.map((result) => result.outcome) }
  }

  async searchSource(source, wanted, signal) {
    abortIfNeeded(signal)
    if (source.id === 'wikipedia') {
      const candidates = await this.wikipedia.discoverCandidates(wanted, { signal })
      return candidates.map((candidate) => ({ ...candidate, cache: {} }))
    }
    if (source.id === 'netease') {
      const url = new URL('https://music.163.com/api/search/get/web')
      url.search = new URLSearchParams({ s: [wanted.title, wanted.artist].filter(Boolean).join(' '), type: '10', offset: '0', limit: String(MAX_SOURCE_RESULTS), total: 'true' }).toString()
      const data = await this.requestJson(url, { signal, headers: { Referer: 'https://music.163.com/' } })
      if (Number(data.code) !== 200) throw fail(`网易云音乐返回错误（${cleanText(data.code, 32) || '未知'}）。`, 502)
      const albums = data.result?.albums
      if (!Array.isArray(albums)) throw fail('网易云音乐没有返回专辑列表。', 502)
      return albums.slice(0, MAX_SOURCE_RESULTS).map((album) => {
        const id = album.id
        const name = cleanText(album.name, 512)
        if (id === undefined || id === null || !name) return undefined
        const rawId = String(id)
        return {
          title: name, artist: stringList(album.artist ?? album.artists).join(' / '),
          year: yearValue(album.publishTime), coverUrl: album.picUrl,
          url: `https://music.163.com/#/album?id=${encodeURIComponent(rawId)}`,
          cache: { rawId, detailsUrl: new URL(`/api/v1/album/${encodeURIComponent(rawId)}`, 'https://music.163.com') },
        }
      }).filter(Boolean)
    }
    if (source.id === 'qq') {
      const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg')
      url.search = new URLSearchParams({ key: [wanted.title, wanted.artist].filter(Boolean).join(' '), inCharset: 'utf-8', outCharset: 'utf-8', format: 'json', g_tk: '5381' }).toString()
      const data = await this.requestJson(url, { signal, headers: { Referer: 'https://y.qq.com/portal/player.html' } })
      if (Number(data.code) !== 0) throw fail(`QQ 音乐返回错误（${cleanText(data.code, 32) || '未知'}）。`, 502)
      const albums = data.data?.album?.itemlist
      if (!Array.isArray(albums)) throw fail('QQ 音乐没有返回专辑列表。', 502)
      return albums.slice(0, MAX_SOURCE_RESULTS).map((album) => {
        const id = album.mid ?? album.album_mid ?? album.id
        const name = cleanText(album.name ?? album.title, 512)
        if (id === undefined || id === null || !name) return undefined
        const rawId = String(id)
        return {
          title: name, artist: stringList(album.singer ?? album.artist).join(' / '),
          year: yearValue(album.aDate ?? album.date), coverUrl: album.pic ?? album.picUrl,
          url: `https://y.qq.com/n/ryqq/albumDetail/${encodeURIComponent(rawId)}`,
          cache: { rawId, detailsUrl: new URL('https://c.y.qq.com/v8/fcg-bin/fcg_v8_album_info_cp.fcg?' + new URLSearchParams({ albummid: rawId, format: 'json', g_tk: '5381' }).toString()) },
        }
      }).filter(Boolean)
    }
    if (!source.builtin) {
      const query = [wanted.title, wanted.artist].filter(Boolean).join(' ')
      const url = renderTemplate(source.searchUrl, { ...wanted, query })
      const data = await this.requestJson(url, { signal })
      const results = pathValue(data, source.mapping.results)
      if (!Array.isArray(results)) throw fail('自定义来源的结果字段不是数组，请检查字段映射。', 502)
      return results.slice(0, MAX_SOURCE_RESULTS).map((result) => {
        const rawId = pathValue(result, source.mapping.id)
        const title = cleanText(pathValue(result, source.mapping.title), 512)
        if ((typeof rawId !== 'string' && typeof rawId !== 'number') || !title) return undefined
        const artist = stringList(pathValue(result, source.mapping.artist)).join(' / ')
        const item = {
          title, artist,
          year: yearValue(pathValue(result, source.mapping.year)),
          description: descriptionText(pathValue(result, source.mapping.description)),
          coverUrl: externalUrl(cleanText(pathValue(result, source.mapping.cover), 4096), source.id, { cover: true }),
          url: externalUrl(cleanText(pathValue(result, source.mapping.url), 4096), source.id),
        }
        return {
          ...item,
          cache: {
            rawId: String(rawId),
            detailsUrl: renderTemplate(source.detailUrl, { id: rawId, ...wanted, query }),
          },
        }
      }).filter(Boolean)
    }
    throw fail('不支持的专辑资料来源。', 400)
  }

  async resolve(candidateId, signal) {
    await this.init()
    abortIfNeeded(signal)
    const entry = this.getCandidate(candidateId)
    const source = this.sourceFor(entry.sourceId)
    if (entry.resolvedCandidate) return structuredClone(entry.resolvedCandidate)
    if (entry.resolvePromise) return structuredClone(await waitForWithSignal(entry.resolvePromise, signal))
    const task = this.resolveCandidate(entry, source, signal).then((candidate) => {
      entry.candidate = structuredClone(candidate)
      entry.resolvedCandidate = structuredClone(candidate)
      return structuredClone(candidate)
    }).finally(() => {
      if (entry.resolvePromise === task) delete entry.resolvePromise
    })
    entry.resolvePromise = task
    return structuredClone(await waitForWithSignal(task, signal))
  }

  async resolveCandidate(entry, source, signal) {
    if (source.id === 'wikipedia' || !entry.detailsUrl) return structuredClone(entry.candidate)
    const data = await this.requestJson(entry.detailsUrl, {
      signal,
      headers: source.id === 'qq' ? { Referer: 'https://y.qq.com/portal/player.html' } : source.id === 'netease' ? { Referer: 'https://music.163.com/' } : {},
    })
    let item
    if (source.id === 'netease') {
      if (Number(data.code) !== 200) throw fail(`网易云音乐专辑详情返回错误（${cleanText(data.code, 32) || '未知'}）。`, 502)
      item = data.album
    } else if (source.id === 'qq') {
      if (Number(data.code) !== 0) throw fail(`QQ 音乐专辑详情返回错误（${cleanText(data.code, 32) || '未知'}）。`, 502)
      item = data.data
    } else {
      const raw = data
      const mapping = source.mapping
      const current = entry.candidate
      const next = {
        ...current,
        title: cleanText(pathValue(raw, mapping.title), 512) || current.title,
        artist: stringList(pathValue(raw, mapping.artist)).join(' / ') || current.artist,
        ...(yearValue(pathValue(raw, mapping.year)) ? { year: yearValue(pathValue(raw, mapping.year)) } : {}),
        ...(descriptionText(pathValue(raw, mapping.description)) ? { description: descriptionText(pathValue(raw, mapping.description)) } : {}),
        ...(externalUrl(cleanText(pathValue(raw, mapping.cover), 4096), source.id, { cover: true }) ? { coverUrl: externalUrl(cleanText(pathValue(raw, mapping.cover), 4096), source.id, { cover: true }) } : {}),
        ...(externalUrl(cleanText(pathValue(raw, mapping.url), 4096), source.id) ? { url: externalUrl(cleanText(pathValue(raw, mapping.url), 4096), source.id) } : {}),
      }
      return structuredClone(next)
    }
    if (!item || typeof item !== 'object') throw fail('来源没有返回专辑详情。', 502)
    const title = cleanText(item.name ?? item.title, 512) || entry.candidate.title
    const artist = source.id === 'netease'
      ? stringList(item.artist ?? item.artists).join(' / ')
      : stringList(item.singername ?? item.singer ?? item.artist).join(' / ')
    const year = yearValue(source.id === 'netease' ? item.publishTime ?? item.publishDate : item.aDate ?? item.publishDate)
    const description = descriptionText(item.description ?? item.desc)
    const cover = source.id === 'netease' ? item.picUrl ?? item.coverUrl : item.pic ?? item.picUrl ?? item.coverUrl
    const coverUrl = [cover, entry.candidate.coverUrl, source.id === 'qq' ? qqAlbumCoverUrl(item.mid ?? entry.rawId) : undefined]
      .map((value) => externalUrl(value, source.id, { cover: true })).find(Boolean)
    return {
      ...entry.candidate, title, artist: artist || entry.candidate.artist,
      ...(year ? { year } : {}),
      ...(description ? { description } : {}),
      ...(coverUrl ? { coverUrl } : {}),
    }
  }

  async cover(candidateId, signal) {
    await this.init()
    const entry = this.getCandidate(candidateId)
    const url = externalUrl(entry.candidate.coverUrl, entry.sourceId, { cover: true })
    if (!url) throw fail('此候选没有可读取的封面。', 404)
    const response = await this.fetchResponse(new URL(url), {
      signal, maxBytes: MAX_COVER_BYTES,
      headers: { Accept: 'image/jpeg,image/png,image/webp,*/*;q=0.5' },
    })
    const data = await readLimited(response, MAX_COVER_BYTES, signal)
    const mime = imageType(data)
    if (!mime) throw fail('来源没有返回 JPEG、PNG 或 WebP 封面。', 502)
    return { data, mime }
  }
}
