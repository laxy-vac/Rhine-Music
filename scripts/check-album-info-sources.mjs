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
  assert.equal(initial.defaultSourceId, 'auto')
  assert.deepEqual(initial.sourceOrder, ['musicbrainz', 'wikipedia', 'netease', 'qq'])
  assert.deepEqual(initial.sources.map(({ id, enabled }) => [id, enabled]), [
    ['wikipedia', true], ['netease', true], ['qq', true],
  ])

  const saved = await store.saveSettings({
    defaultSourceId: 'custom-fixture',
    sources: [initial.sources[0], customSource(), ...initial.sources.slice(1)],
  })
  assert.equal(saved.defaultSourceId, 'auto', 'legacy single-source defaults no longer select a provider')
  assert.deepEqual(saved.sourceOrder, ['musicbrainz', 'wikipedia', 'custom-fixture', 'netease', 'qq'])
  assert.equal(saved.sources.length, 4)
  assert.equal(JSON.parse(await fs.readFile(store.sourceFile)).version, 3)
  const restarted = new AlbumInfoSources({ dataDir: store.dataDir, fetcher: async () => json({}) })
  assert.deepEqual(await restarted.settings(), saved)
  await assert.rejects(store.saveSettings({
    defaultSourceId: 'wikipedia',
    sources: [...initial.sources, customSource({ mapping: { description: '__proto__.polluted' } })],
  }), /字段映射无效/)
  assert.equal({}.polluted, undefined)
})

test('MusicBrainz is skipped without a valid email and leads automatic lookup once configured', async (t) => {
  let email = ''
  const mbid = '3bd76d40-7f0e-36b7-9348-91a33afee20e'
  const seen = []
  const store = await sourceFixture(t, async (input, options) => {
    const url = new URL(input)
    seen.push({ url, options })
    if (url.hostname === 'musicbrainz.org') {
      if (url.pathname === '/ws/2/release-group/') return json({ 'release-groups': [{ id: mbid, title: 'Twin', 'first-release-date': '2001', 'artist-credit': [{ name: 'Singer' }] }] })
      if (url.pathname === `/ws/2/release-group/${mbid}`) return json({ id: mbid, title: 'Twin', 'first-release-date': '2001', 'primary-type': 'Album' })
      if (url.pathname === '/ws/2/annotation/') return json({ annotations: [] })
    }
    if (url.hostname === 'zh.wikipedia.org') return json({ query: { pages: [{ pageid: 1, title: 'Twin', extract: 'Wikipedia album summary.', fullurl: 'https://zh.wikipedia.org/wiki/Twin' }] } })
    if (url.hostname === 'en.wikipedia.org') return json({ query: { pages: [] } })
    if (url.hostname === 'music.163.com') return json({ code: 200, result: { albums: [{ id: 1, name: 'Twin', artist: { name: 'Singer' } }] } })
    if (url.hostname === 'c.y.qq.com') return json({ code: 0, data: { album: { itemlist: [{ mid: 'abcdefghijklmn', name: 'Twin', singer: 'Singer' }] } } })
    throw new Error(`Unexpected source ${url.href}`)
  }, { musicBrainzEmail: () => email })
  store.musicBrainzIntervalMs = 0
  store.wikipedia.intervalMs = 0
  assert.equal((await store.settings()).musicBrainzAvailable, false)
  assert.deepEqual((await store.settings()).sources.map(source => source.id), ['wikipedia', 'netease', 'qq'])
  await assert.rejects(store.search({ title: 'Twin', sourceId: 'musicbrainz' }), /不存在/)
  const withoutMb = await store.search({ title: 'Twin', artist: 'Singer' })
  assert.deepEqual(withoutMb.sources.map(source => source.sourceId), ['wikipedia'])
  assert.equal(withoutMb.automaticCandidate.sourceId, 'wikipedia')
  const explicitAuto = await store.search({ title: 'Twin', artist: 'Singer', sourceId: 'auto' })
  assert.deepEqual(explicitAuto.sources.map(source => source.sourceId), ['wikipedia'], 'sourceId auto inherits the same global priority order')
  assert.equal(explicitAuto.automaticCandidate.sourceId, 'wikipedia')
  email = 'https://example.test/project'
  assert.equal((await store.settings()).musicBrainzAvailable, false, 'a project URL does not replace the requested email gate')
  email = 'tester@example.invalid'
  assert.deepEqual((await store.settings()).sources.map(source => source.id), ['musicbrainz', 'wikipedia', 'netease', 'qq'])
  const result = await store.search({ title: 'Twin', artist: 'Singer' })
  assert.deepEqual(result.sources.map(source => source.sourceId), ['musicbrainz'])
  assert.deepEqual(result.candidates.map(candidate => candidate.sourceId), ['musicbrainz'])
  assert.equal(result.automaticCandidateId, result.candidates[0].id)
  const mb = result.candidates[0]
  const resolved = await store.resolve(mb.id)
  assert.match(resolved.description, /^发行资料：/)
  assert.match(resolved.url, /musicbrainz\.org\/release-group\//)
  assert.ok(seen.filter(request => request.url.hostname === 'musicbrainz.org').every(request => request.options.headers['User-Agent'].includes(email)))
  email = ''
  assert.equal((await store.settings()).musicBrainzAvailable, false)
  await assert.rejects(store.resolve(mb.id), /过期或不存在/, 'removing the email invalidates access to cached MB candidates')
})

test('older builtin defaults migrate to automatic priority without losing disabled or custom sources', async (t) => {
  const store = await sourceFixture(t, async () => json({}))
  await fs.mkdir(path.dirname(store.sourceFile), { recursive: true })
  await fs.writeFile(store.sourceFile, JSON.stringify({ version: 1, defaultSourceId: 'qq', sources: [
    { id: 'wikipedia', enabled: true }, { id: 'qq', enabled: true }, { id: 'netease', enabled: false }, customSource(),
  ] }))
  const initial = await store.settings()
  assert.equal(initial.defaultSourceId, 'auto')
  assert.deepEqual(initial.sourceOrder, ['musicbrainz', 'wikipedia', 'qq', 'netease', 'custom-fixture'], 'missing MB is restored at its previous priority while v1 source order is retained')
  assert.equal(initial.sources.find(source => source.id === 'netease').enabled, false)
  assert.ok(initial.sources.some(source => source.id === 'custom-fixture'))
  const saved = await store.saveSettings(initial)
  assert.equal(JSON.parse(await fs.readFile(store.sourceFile)).version, 3)
  assert.deepEqual(await new AlbumInfoSources({ dataDir: store.dataDir, fetcher: async () => json({}) }).settings(), saved)

  const versionTwo = await sourceFixture(t, async () => json({}))
  await fs.mkdir(path.dirname(versionTwo.sourceFile), { recursive: true })
  await fs.writeFile(versionTwo.sourceFile, JSON.stringify({ version: 2, defaultSourceId: 'custom-fixture', sources: [
    { id: 'wikipedia', enabled: true }, { id: 'netease', enabled: true }, { id: 'qq', enabled: false }, customSource(),
  ] }))
  const migratedTwo = await versionTwo.settings()
  assert.equal(migratedTwo.defaultSourceId, 'auto')
  assert.deepEqual(migratedTwo.sourceOrder, ['musicbrainz', 'wikipedia', 'netease', 'qq', 'custom-fixture'])
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

test('saved source order drives fallback, ranked candidates auto-select an introduction, and lookup stays local-only', async (t) => {
  const calls = []
  const noIntro = customSource({
    id: 'custom-no-intro', name: 'No introduction',
    searchUrl: 'https://catalog.example.test/no-intro/search?q={query}',
    detailUrl: 'https://catalog.example.test/no-intro/album/{id}',
  })
  const ranked = customSource({
    id: 'custom-ranked', name: 'Ranked catalog',
    searchUrl: 'https://catalog.example.test/ranked/search?q={query}',
    detailUrl: 'https://catalog.example.test/ranked/album/{id}',
  })
  const store = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    calls.push(url.pathname)
    if (url.pathname === '/no-intro/search') return json({ payload: { items: [
      { key: 'no-description', name: 'Signal', performer: 'Correct Artist', year: 2001 },
    ] } })
    if (url.pathname === '/no-intro/album/no-description') return json({ name: 'Signal', performer: 'Correct Artist', year: 2001 })
    if (url.pathname === '/ranked/search') return json({ payload: { items: [
      { key: 'wrong-artist', name: 'Signal', performer: 'Other Artist', year: 2000 },
      { key: 'right-artist', name: 'Signal', performer: 'Correct Artist', year: 2001 },
    ] } })
    if (url.pathname === '/ranked/album/wrong-artist') return json({ name: 'Signal', performer: 'Other Artist' })
    if (url.pathname === '/ranked/album/right-artist') return json({ name: 'Signal', performer: 'Correct Artist', year: 2001, summary: 'The selected album introduction.', page: 'https://catalog.example.test/records/right-artist' })
    throw new Error(`unexpected URL ${url.href}`)
  })
  const settings = await store.settings()
  const sourceOrder = ['custom-no-intro', 'custom-ranked', 'musicbrainz', 'wikipedia', 'netease', 'qq']
  await store.saveSettings({
    sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), noIntro, ranked],
    sourceOrder,
  })

  const result = await store.search({ title: 'Signal', artist: 'Correct Artist', year: 2001 })
  assert.deepEqual(result.sources.map(({ sourceId, status }) => [sourceId, status]), [['custom-no-intro', 'ok'], ['custom-ranked', 'ok']])
  assert.deepEqual(result.candidates.map(({ sourceId, artist }) => [sourceId, artist]), [
    ['custom-no-intro', 'Correct Artist'], ['custom-ranked', 'Correct Artist'], ['custom-ranked', 'Other Artist'],
  ])
  assert.equal(result.automaticCandidateId, result.candidates[1].id)
  assert.equal(result.automaticCandidate.description, 'The selected album introduction.')
  assert.deepEqual(calls, [
    '/no-intro/search', '/no-intro/album/no-description',
    '/ranked/search', '/ranked/album/right-artist',
  ], 'the correct artist/year sorts before the provider’s earlier wrong-artist result')

  calls.length = 0
  const lookup = await store.lookup({ title: 'Signal', artist: 'Correct Artist', year: 2001 })
  assert.equal(lookup.status, 'matched')
  assert.equal(lookup.description, 'The selected album introduction.')
  assert.deepEqual(lookup.descriptionSource, {
    kind: 'online', sourceId: 'custom-ranked', name: 'Ranked catalog',
    url: 'https://catalog.example.test/records/right-artist', checkedAt: lookup.checkedAt,
  })
  assert.deepEqual(lookup.automaticSelection, {
    sourceId: 'custom-ranked', title: 'Signal', artist: 'Correct Artist',
    url: 'https://catalog.example.test/records/right-artist',
  })
  assert.equal(Object.hasOwn(lookup.automaticSelection, 'candidateId'), false)
  assert.deepEqual(calls, [
    '/no-intro/search', '/no-intro/album/no-description',
    '/ranked/search', '/ranked/album/right-artist',
  ])
  const saved = JSON.parse(await fs.readFile(store.sourceFile, 'utf8'))
  assert.equal(saved.version, 3)
  assert.deepEqual(saved.sourceOrder, sourceOrder)
  assert.equal(saved.defaultSourceId, 'auto')
})

test('an all-error automatic lookup reports error, while empty and failed layers report not-found', async (t) => {
  const settingsStore = await sourceFixture(t, async () => json({}))
  const settings = await settingsStore.settings()
  const broken = customSource({ id: 'custom-broken', searchUrl: 'https://catalog.example.test/broken?q={query}' })
  await settingsStore.saveSettings({
    sources: [...settings.sources.map((source) => ({ ...source, enabled: false })), broken],
    sourceOrder: ['custom-broken', 'musicbrainz', 'wikipedia', 'netease', 'qq'],
  })
  const failing = await settingsStore.lookup({ title: 'Fixture' })
  assert.equal(failing.status, 'error')

  const mixed = await sourceFixture(t, async (input) => {
    const url = new URL(input)
    if (url.hostname === 'music.163.com') throw new Error('fixture unavailable')
    if (url.hostname === 'c.y.qq.com') return json({ code: 0, data: { album: { count: 0, itemlist: [] } } })
    throw new Error(`unexpected host ${url.hostname}`)
  })
  const mixedSettings = await mixed.settings()
  await mixed.saveSettings({
    sources: mixedSettings.sources.map((source) => ({ ...source, enabled: source.id === 'netease' || source.id === 'qq' })),
    sourceOrder: ['musicbrainz', 'wikipedia', 'netease', 'qq'],
  })
  const noMatch = await mixed.lookup({ title: 'Fixture' })
  assert.equal(noMatch.status, 'not-found', 'one empty layer means the overall search was not entirely unavailable')
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
  assert.equal(result.candidates[0].coverUrl, coverUrl, 'automatic detail resolution adds the official album-mid image URL')
  const resolved = await store.resolve(result.candidates[0].id)
  assert.equal(resolved.coverUrl, coverUrl)
  assert.equal((await store.cover(result.candidates[0].id)).mime, 'image/jpeg')
  assert.ok(seen.some((url) => url.href === coverUrl))
})

test('automatic sources run serially in priority order and one failing source does not hide later results', async (t) => {
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
  assert.deepEqual(result.sources.map(({ sourceId, status }) => [sourceId, status]), [['netease', 'error'], ['qq', 'empty']])
  assert.match(result.sources[0].message, /fixture offline/)
  assert.equal(maximumActive, 1)
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

test('a failed automatic detail lookup can retry; success is coalesced and cached', async (t) => {
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
  const first = await store.search({ title: 'Retry album' })
  const candidate = first.candidates[0]
  assert.equal(first.sources[0].status, 'error', 'the automatic search reports its failed detail attempt but keeps the candidate available')
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

test('one source timeout covers candidate search and detail resolution', async (t) => {
  const store = await sourceFixture(t, async (input, options) => {
    const url = new URL(input)
    if (url.pathname === '/splcloud/fcgi-bin/smartbox_new.fcg') return json({ code: 0, data: { album: { count: 1, itemlist: [
      { mid: '0029sCOz4G19oD', name: 'Fixture', singer: 'Artist' },
    ] } } })
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    })
  }, { timeoutMs: 10 })
  const result = await store.search({ title: 'Fixture', sourceId: 'qq' })
  assert.equal(result.sources[0].status, 'error')
  assert.match(result.sources[0].message, /超时/)
})
