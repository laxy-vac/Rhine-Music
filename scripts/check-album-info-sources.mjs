import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { AlbumInfoSources } from './album-info-sources.mjs'

const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = path.join(projectRoot, '.tools', 'metadata-editor-20261022', 'test-profiles')

async function sourceFixture(t, fetcher, options = {}) {
  await fs.mkdir(fixtureRoot, { recursive: true })
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'rhine-album-info-test-'))
  t.after(() => {
    const target = path.resolve(directory)
    assert.ok(target.startsWith(`${path.resolve(fixtureRoot)}${path.sep}`), 'cleanup stays within this test fixture directory')
    return fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
  })
  return new AlbumInfoSources({ dataDir: directory, fetcher, ...options })
}

function customSource(overrides = {}) {
  return {
    id: 'custom-fixture', name: 'Fixture catalog', builtin: false, enabled: true,
    searchUrl: 'https://catalog.example.test/search?q={query}',
    detailUrl: 'https://catalog.example.test/album/{id}',
    mapping: {
      results: 'payload.items', id: 'key', title: 'name', artist: 'performer', year: 'year',
      description: 'summary', cover: 'artwork', url: 'page',
    },
    ...overrides,
  }
}

test('built-in sources start enabled and independent source settings survive a restart', async (t) => {
  const store = await sourceFixture(t, async () => json({}))
  const initial = await store.settings()
  assert.equal(initial.defaultSourceId, 'wikipedia')
  assert.deepEqual(initial.sources.map(({ id, enabled }) => [id, enabled]), [
    ['wikipedia', true], ['qq', true], ['netease', true],
  ])

  const saved = await store.saveSettings({
    defaultSourceId: 'custom-fixture',
    sources: [...initial.sources, customSource()],
  })
  assert.equal(saved.defaultSourceId, 'custom-fixture')
  assert.equal(saved.sources.length, 4)
  const restarted = new AlbumInfoSources({ dataDir: store.dataDir, fetcher: async () => json({}) })
  assert.deepEqual(await restarted.settings(), saved)
  await assert.rejects(store.saveSettings({
    defaultSourceId: 'wikipedia',
    sources: [...initial.sources, customSource({ mapping: { description: '__proto__.polluted' } })],
  }), /字段映射无效/)
  assert.equal({}.polluted, undefined)
})

test('Wikipedia exposes multiple article candidates and uses article extracts rather than search snippets', async (t) => {
  const seen = []
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    seen.push(url)
    if (url.hostname === 'zh.wikipedia.org') {
      assert.match(url.searchParams.get('prop') ?? '', /pageimages/)
      const pages = [
        { pageid: 10, title: 'Twin', fullurl: 'https://zh.wikipedia.org/wiki/Twin', extract: 'Official first article extract.', snippet: 'Never use this search snippet.', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/first.jpg' }, pageprops: {} },
        { pageid: 11, title: 'Twin (album)', fullurl: 'https://zh.wikipedia.org/wiki/Twin_(album)', extract: 'Official second article extract.', snippet: 'Do not save this snippet either.', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/second.jpg' }, pageprops: {} },
      ]
      return json({ query: { pages } })
    }
    if (url.hostname === 'en.wikipedia.org') return json({ query: { pages: [] } })
    throw new Error(`unexpected host ${url.hostname}`)
  })
  store.wikipedia.intervalMs = 0
  const result = await store.search({ title: 'Twin', artist: 'A Singer', sourceId: 'wikipedia' })
  assert.equal(result.sources[0].status, 'ok')
  assert.equal(result.candidates.length, 2)
  assert.notEqual(result.candidates[0].id, result.candidates[1].id)
  assert.equal(result.candidates[0].sourceId, 'wikipedia')
  assert.equal(result.candidates[0].description, 'Official first article extract.')
  assert.ok(!result.candidates.some((candidate) => candidate.description?.includes('snippet')))
  assert.equal(result.candidates[0].coverUrl, 'https://upload.wikimedia.org/wikipedia/first.jpg')
  assert.ok(seen.some((url) => url.searchParams.has('generator')))
})

test('QQ and NetEase public album search/detail contracts yield selectable complete records and verified covers', async (t) => {
  const seen = []
  let qqDetailCalls = 0
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    seen.push(url)
    if (url.hostname === 'music.163.com' && url.pathname === '/api/search/get/web') {
      assert.equal(url.searchParams.get('type'), '10')
      return json({ code: 200, result: { albums: [{ id: 18915, name: '范特西', artist: { name: '周杰伦' }, picUrl: 'https://p2.music.126.net/cover.jpg', publishTime: 1000396800000 }] } })
    }
    if (url.hostname === 'music.163.com' && url.pathname === '/api/v1/album/18915') {
      return json({ code: 200, album: { id: 18915, name: '范特西', artist: { name: '周杰伦' }, description: 'NetEase album description.', picUrl: 'https://p2.music.126.net/cover.jpg', publishTime: 1000396800000 } })
    }
    if (url.hostname === 'c.y.qq.com' && url.pathname === '/splcloud/fcgi-bin/smartbox_new.fcg') {
      return json({ code: 0, data: { album: { count: 2, itemlist: [
        { id: 'doc-1', mid: 'QQMID1', name: '夜航', singer: '测试歌手', pic: 'http://y.gtimg.cn/music/photo_new/T002R180x180M000QQMID1_1.jpg' },
        { id: 'doc-2', mid: 'QQMID2', name: '夜航', singer: '另一歌手', pic: 'http://y.gtimg.cn/music/photo_new/T002R180x180M000QQMID2_1.jpg' },
      ] } } })
    }
    if (url.hostname === 'c.y.qq.com' && url.pathname === '/v8/fcg-bin/fcg_v8_album_info_cp.fcg') {
      qqDetailCalls += 1
      assert.equal(url.searchParams.get('albummid'), 'QQMID1')
      return json({ code: 0, data: { mid: 'QQMID1', name: '夜航', singername: '测试歌手', aDate: '2020-05-01', desc: 'QQ album description.' } })
    }
    if (url.hostname === 'y.gtimg.cn') return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error(`unexpected URL ${url.href}`)
  })

  const qq = await store.search({ title: '夜航', artist: '测试歌手', sourceId: 'qq' })
  assert.equal(qq.candidates.length, 2)
  assert.ok(qq.candidates.every((candidate) => candidate.id.length >= 32 && candidate.id !== 'QQMID1'))
  assert.equal(qq.candidates[0].coverUrl, 'https://y.gtimg.cn/music/photo_new/T002R180x180M000QQMID1_1.jpg')
  const resolvedQq = await store.resolve(qq.candidates[0].id)
  assert.equal(resolvedQq.description, 'QQ album description.')
  assert.equal(resolvedQq.year, 2020)
  assert.equal(resolvedQq.url, 'https://y.qq.com/n/ryqq/albumDetail/QQMID1')
  assert.deepEqual(await store.resolve(qq.candidates[0].id), resolvedQq)
  assert.equal(qqDetailCalls, 1, 'a second preview/save resolution reuses the successful detail response')
  const cover = await store.cover(qq.candidates[0].id)
  assert.deepEqual({ mime: cover.mime, bytes: cover.data }, { mime: 'image/jpeg', bytes: JPEG })

  const netease = await store.search({ title: '范特西', artist: '周杰伦', sourceId: 'netease' })
  assert.equal(netease.candidates.length, 1)
  assert.equal(netease.candidates[0].year, 2001)
  const resolvedNetease = await store.resolve(netease.candidates[0].id)
  assert.equal(resolvedNetease.description, 'NetEase album description.')
  assert.ok(seen.some((url) => url.pathname === '/api/search/get/web'))
  assert.ok(seen.some((url) => url.pathname === '/api/v1/album/18915'))
  assert.ok(seen.some((url) => url.pathname === '/splcloud/fcgi-bin/smartbox_new.fcg'))
  assert.ok(seen.some((url) => url.pathname === '/v8/fcg-bin/fcg_v8_album_info_cp.fcg'))
})

test('QQ detail without a cover field falls back to the official album-mid image URL', async (t) => {
  const mid = '0029sCOz4G19oD'
  const coverUrl = `https://y.gtimg.cn/music/photo_new/T002R180x180M000${mid}_1.jpg`
  const seen = []
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    seen.push(url)
    if (url.pathname === '/splcloud/fcgi-bin/smartbox_new.fcg') return json({ code: 0, data: { album: { count: 1, itemlist: [{ mid, name: 'Fixture QQ Album', singer: 'Fixture Artist' }] } } })
    if (url.pathname === '/v8/fcg-bin/fcg_v8_album_info_cp.fcg') return json({ code: 0, data: { mid, name: 'Fixture QQ Album', singername: 'Fixture Artist', desc: 'Fixture description.' } })
    if (url.hostname === 'y.gtimg.cn') return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } })
    throw new Error(`unexpected URL ${url.href}`)
  })
  const result = await store.search({ title: 'Fixture QQ Album', artist: 'Fixture Artist', sourceId: 'qq' })
  assert.equal(result.candidates[0].coverUrl, undefined)
  const resolved = await store.resolve(result.candidates[0].id)
  assert.equal(resolved.coverUrl, coverUrl)
  assert.equal((await store.cover(result.candidates[0].id)).mime, 'image/jpeg')
  assert.ok(seen.some((url) => url.href === coverUrl))
})

test('enabled sources run concurrently and one failing source does not hide other results', async (t) => {
  let active = 0
  let maximumActive = 0
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    active += 1
    maximumActive = Math.max(maximumActive, active)
    await new Promise((resolve) => setTimeout(resolve, 15))
    active -= 1
    if (url.hostname === 'c.y.qq.com') return json({ code: 0, data: { album: { count: 0, itemlist: [] } } })
    if (url.hostname === 'music.163.com') throw new Error('fixture offline')
    throw new Error(`unexpected host ${url.hostname}`)
  })
  const settings = await store.settings()
  await store.saveSettings({
    defaultSourceId: 'qq',
    sources: settings.sources.map((source) => ({ ...source, enabled: source.id !== 'wikipedia' })),
  })
  const result = await store.search({ title: 'Fixture', artist: 'Artist' })
  assert.equal(result.candidates.length, 0)
  assert.deepEqual(result.sources.map(({ sourceId, status }) => [sourceId, status]), [['qq', 'empty'], ['netease', 'error']])
  assert.match(result.sources[1].message, /fixture offline/)
  assert.equal(maximumActive, 2)
})

test('candidate tokens expire, invalid tokens fail, and cover URLs come only from cached candidates', async (t) => {
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    if (url.pathname === '/search') return json({ payload: { items: [{ key: 'fixture-1', name: 'Fixture album', performer: 'Fixture artist', artwork: 'https://images.example.test/art.jpg' }] } })
    if (url.pathname === '/album/fixture-1') return json({ name: 'Fixture album', performer: 'Fixture artist', summary: 'Full custom description.' })
    if (url.hostname === 'images.example.test') return new Response(PNG, { headers: { 'Content-Type': 'image/png' } })
    throw new Error(`unexpected URL ${url.href}`)
  })
  const settings = await store.settings()
  await store.saveSettings({ defaultSourceId: 'custom-fixture', sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), customSource()] })
  const result = await store.search({ title: 'Fixture album', artist: 'Fixture artist' })
  assert.equal(result.candidates.length, 1)
  const candidate = result.candidates[0]
  assert.equal(candidate.sourceId, 'custom-fixture')
  assert.equal(candidate.coverUrl, 'https://images.example.test/art.jpg')
  assert.equal((await store.resolve(candidate.id)).description, 'Full custom description.')
  assert.equal((await store.cover(candidate.id)).mime, 'image/png')
  await assert.rejects(store.resolve('not-a-candidate'), (error) => error.status === 409)
  store.cache.get(candidate.id).createdAt -= 15 * 60 * 1000 + 1
  await assert.rejects(store.resolve(candidate.id), (error) => error.status === 409)
})

test('custom mappings reject unsafe paths and never execute source text as JavaScript', async (t) => {
  const store = await sourceFixture(t, async () => new Response('globalThis.__albumInfoSourcePwned = true', { headers: { 'Content-Type': 'text/html' } }))
  const settings = await store.settings()
  await assert.rejects(store.saveSettings({
    defaultSourceId: 'wikipedia',
    sources: [...settings.sources, customSource({ mapping: { title: 'constructor.constructor' } })],
  }), /字段映射无效/)
  const saved = await store.saveSettings({
    defaultSourceId: 'custom-fixture',
    sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), customSource()],
  })
  assert.equal(saved.sources.find((source) => source.id === 'custom-fixture').enabled, true)
  const result = await store.search({ title: 'Fixture', artist: 'Artist' })
  assert.equal(result.sources[0].status, 'error')
  assert.equal(globalThis.__albumInfoSourcePwned, undefined)
})

test('a failed detail lookup can retry; a successful resolution is coalesced and cached', async (t) => {
  let detailCalls = 0
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    if (url.pathname === '/search') return json({ payload: { items: [{ key: 'retry-1', name: 'Retry album', performer: 'Retry artist' }] } })
    if (url.pathname === '/album/retry-1') {
      detailCalls += 1
      if (detailCalls === 1) return json({ error: 'temporary unavailable' }, 503)
      await new Promise((resolve) => setTimeout(resolve, 15))
      return json({ name: 'Retry album', performer: 'Retry artist', summary: 'Resolved after retry.' })
    }
    throw new Error(`unexpected URL ${url.href}`)
  })
  const settings = await store.settings()
  await store.saveSettings({ defaultSourceId: 'custom-fixture', sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), customSource()] })
  const candidate = (await store.search({ title: 'Retry album' })).candidates[0]
  await assert.rejects(store.resolve(candidate.id), (error) => error.status === 502)
  const [left, right] = await Promise.all([store.resolve(candidate.id), store.resolve(candidate.id)])
  assert.deepEqual(left, right)
  assert.equal(left.description, 'Resolved after retry.')
  assert.deepEqual(await store.resolve(candidate.id), left)
  assert.equal(detailCalls, 2, 'the first failure retries once, then concurrent and later resolves reuse success')
})

test('candidate cache evicts oldest entries above the 512 record limit', async (t) => {
  const store = await sourceFixture(t, async () => json({ payload: { items: Array.from({ length: 20 }, (_, index) => ({ key: String(index), name: `Album ${index}`, performer: 'Artist' })) } }))
  const settings = await store.settings()
  await store.saveSettings({ defaultSourceId: 'custom-fixture', sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), customSource()] })
  const first = (await store.search({ title: 'Fixture' })).candidates[0]
  for (let index = 0; index < 25; index += 1) await store.search({ title: `Fixture ${index}` })
  assert.equal(store.cache.size, 512)
  await assert.rejects(store.resolve(first.id), (error) => error.status === 409)
})

test('oversized JSON and image bodies are rejected even without Content-Length', async (t) => {
  const store = await sourceFixture(t, async () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1, 0x20)))
  const settings = await store.settings()
  await store.saveSettings({ defaultSourceId: 'custom-fixture', sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), customSource()] })
  const oversizedJson = await store.search({ title: 'Fixture' })
  assert.equal(oversizedJson.sources[0].status, 'error')
  assert.match(oversizedJson.sources[0].message, /超过/)

  const goodStore = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    if (url.pathname === '/search') return json({ payload: { items: [{ key: 'one', name: 'Fixture', artwork: 'https://images.example.test/large.jpg' }] } })
    if (url.hostname === 'images.example.test') {
      const body = Buffer.alloc(8 * 1024 * 1024 + 1)
      body.set(JPEG.subarray(0, 3))
      return new Response(body)
    }
    throw new Error(`unexpected URL ${url.href}`)
  })
  const goodSettings = await goodStore.settings()
  await goodStore.saveSettings({ defaultSourceId: 'custom-fixture', sources: [...goodSettings.sources.map((source) => ({ ...source, enabled: false })), customSource()] })
  const candidate = (await goodStore.search({ title: 'Fixture' })).candidates[0]
  await assert.rejects(goodStore.cover(candidate.id), /超过/)
})

test('external abort cancels a pending source request', async (t) => {
  const store = await sourceFixture(t, async (_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }))
  const controller = new AbortController()
  const pending = store.search({ title: 'Fixture', sourceId: 'qq' }, controller.signal)
  setTimeout(() => controller.abort(), 0)
  await assert.rejects(pending, (error) => error.name === 'AbortError')
})

test('request timeout becomes a source error with an explicit timeout message', async (t) => {
  const store = await sourceFixture(t, async (_input, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
  }), { timeoutMs: 5 })
  const result = await store.search({ title: 'Fixture', sourceId: 'qq' })
  assert.equal(result.sources[0].status, 'error')
  assert.match(result.sources[0].message, /超时/)
})
