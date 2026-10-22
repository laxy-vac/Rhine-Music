import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MusicLibraryStore } from './music-library.mjs'
import { createMusicServer } from './music-server.mjs'
import { readAudioMetadata } from './read-audio-metadata.mjs'
import { readAudioTagDocument, writeAudioTags } from './audio-tag-editor.mjs'
import { silentWav } from './audio-fixtures.mjs'
import { mockFtp, mockNative, mockOnline, mockSony } from '../desktop/check-preview-ui.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureParent = path.join(projectRoot, '.tools', 'metadata-editor-20261022', 'api-tests')
const albumCover = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
  'base64',
)
const songCover = Buffer.concat([albumCover, Buffer.from('synthetic-track-cover')])

const jsonResponse = value => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
})

function fixtureFetcher() {
  const calls = []
  const sameTitleAlbums = [
    { id: '1001', name: 'Same Fixture Album', artists: [{ name: 'Fixture Artist' }], publishTime: Date.UTC(2021, 0, 1), picUrl: 'https://p1.music.126.net/fixture-cover.png' },
    { id: '1002', name: 'Same Fixture Album', artists: [{ name: 'Fixture Artist' }], publishTime: Date.UTC(2022, 0, 1), picUrl: 'https://p1.music.126.net/fixture-cover.png' },
  ]
  const qqAlbums = [
    { mid: 'abcdefghijklmn', name: 'Same Fixture Album', singer: [{ name: 'Fixture Artist' }], aDate: '2021-01-01', pic: 'https://y.gtimg.cn/fixture-cover.jpg' },
    { mid: 'bcdefghijklmno', name: 'Same Fixture Album', singer: [{ name: 'Fixture Artist' }], aDate: '2022-01-01', pic: 'https://y.gtimg.cn/fixture-cover.jpg' },
  ]
  const fetcher = async (input) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    calls.push(url.href)
    if (url.hostname === 'musicbrainz.org') {
      const id = '3bd76d40-7f0e-36b7-9348-91a33afee20e'
      if (url.pathname === '/ws/2/release-group/') return jsonResponse({ 'release-groups': [{ id, title: 'Same Fixture Album', 'artist-credit': [{ name: 'Fixture Artist' }], 'first-release-date': '2021' }] })
      if (url.pathname === `/ws/2/release-group/${id}`) return jsonResponse({ id, title: 'Same Fixture Album', 'primary-type': 'Album', 'first-release-date': '2021', 'artist-credit': [{ name: 'Fixture Artist' }] })
      if (url.pathname === '/ws/2/annotation/') return jsonResponse({ annotations: [] })
    }
    if (url.hostname === 'music.163.com' && url.pathname === '/api/search/get/web') {
      return jsonResponse({ code: 200, result: { albums: sameTitleAlbums } })
    }
    if (url.hostname === 'empty-source.example.test' && url.pathname === '/search') return jsonResponse({ results: [] })
    if (url.hostname === 'music.163.com' && /^\/api\/v1\/album\/(1001|1002)$/.test(url.pathname)) {
      const id = url.pathname.split('/').at(-1)
      return jsonResponse({ code: 200, album: {
        ...sameTitleAlbums.find(item => item.id === id),
        description: `Selected synthetic NetEase detail ${id}.`,
      } })
    }
    if (url.hostname === 'c.y.qq.com' && url.pathname === '/splcloud/fcgi-bin/smartbox_new.fcg') {
      return jsonResponse({ code: 0, data: { album: { itemlist: qqAlbums } } })
    }
    if (url.hostname === 'c.y.qq.com' && url.pathname === '/v8/fcg-bin/fcg_v8_album_info_cp.fcg') {
      const id = url.searchParams.get('albummid')
      const item = qqAlbums.find(album => album.mid === id)
      return jsonResponse({ code: 0, data: {
        name: item?.name, singername: 'Fixture Artist', aDate: item?.aDate,
        desc: `Selected synthetic QQ detail ${id}.`, pic: item?.pic,
      } })
    }
    if (url.hostname === 'p1.music.126.net' || url.hostname === 'y.gtimg.cn') {
      return new Response(songCover, { status: 200, headers: { 'Content-Type': 'image/png' } })
    }
    throw new Error(`Unexpected test fetch target: ${url.origin}${url.pathname}`)
  }
  fetcher.calls = calls
  return fetcher
}

async function closeHttpServer(server) {
  if (!server?.listening) return
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  server.closeIdleConnections?.()
  server.closeAllConnections?.()
  await closed
}

async function createApiFixture(t) {
  await fs.mkdir(fixtureParent, { recursive: true })
  const runRoot = await fs.mkdtemp(path.join(fixtureParent, 'run-'))
  let store
  t.after(async () => {
    if (store) {
      while (true) {
        const pending = [store.scanPromise, store.introductionsPromise, store.enrichPromise].filter(Boolean)
        if (pending.length) await Promise.allSettled(pending)
        else {
          const writes = store.saveChain
          await writes.catch(() => {})
          if (!store.scanPromise && !store.introductionsPromise && !store.enrichPromise && store.saveChain === writes) break
        }
      }
    }
    const target = path.resolve(runRoot)
    assert.ok(target.startsWith(`${path.resolve(fixtureParent)}${path.sep}`), 'API fixture cleanup remains in its owned run directory')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
  })
  const musicRoot = path.join(runRoot, 'music')
  const albumDir = path.join(musicRoot, 'Fixture Album')
  const dataDir = path.join(runRoot, 'profile')
  const distDir = path.join(runRoot, 'dist')
  await fs.mkdir(albumDir, { recursive: true })
  await fs.mkdir(distDir, { recursive: true })
  const files = [path.join(albumDir, '01-first.wav'), path.join(albumDir, '02-second.wav')]
  for (let index = 0; index < files.length; index++) {
    await fs.writeFile(files[index], silentWav(0.18, 44100, 16))
    await writeAudioTags(files[index], {
      fields: {
        TITLE: [index === 0 ? 'First source title' : 'Second source title'],
        ARTIST: [index === 0 ? 'First Singer' : 'Second Singer'],
        ALBUM: ['Same Fixture Album'],
        ALBUMARTIST: ['Fixture Artist'],
        TRACKNUMBER: [String(index + 1)],
      },
    })
  }
  await fs.writeFile(path.join(albumDir, 'Cover.png'), albumCover)
  const fetcher = fixtureFetcher()
  store = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot], fetcher }).init()
  await store.scan()
  const album = store.snapshot().albums.find(item => item.title === 'Same Fixture Album') ?? store.snapshot().albums[0]
  assert.ok(album && album.tracks.length === 2, 'the private fixture contains exactly one two-track album')
  let scanCalls = 0
  const realScan = store.scan.bind(store)
  store.scan = async (...args) => { scanCalls++; return realScan(...args) }
  const bundle = await createMusicServer({
    dataDir, distDir, defaultRoots: [musicRoot], autoScan: false, store,
    online: mockOnline(), ftp: mockFtp(), sony: mockSony(), native: mockNative(),
  })
  t.after(() => closeHttpServer(bundle.server))
  await new Promise((resolve, reject) => {
    bundle.server.once('error', reject)
    bundle.server.listen(0, '127.0.0.1', resolve)
  })
  const address = bundle.server.address()
  assert.ok(address && typeof address === 'object')
  return {
    runRoot, musicRoot, albumDir, dataDir, files, store, album, bundle, fetcher,
    baseURL: `http://127.0.0.1:${address.port}`,
    get scanCalls() { return scanCalls },
  }
}

async function postJson(origin, route, value) {
  return fetch(`${origin}${route}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  })
}

test('local HTTP editor routes expose three sources, keep same-title search read-only, and apply only an explicit candidate', async (t) => {
  const fixture = await createApiFixture(t)
  try {
  const beforeIndex = await fs.readFile(path.join(fixture.dataDir, 'library-index.json'))
  const sourcesResponse = await fetch(`${fixture.baseURL}/api/album-info/sources`)
  assert.equal(sourcesResponse.status, 200)
  const settings = await sourcesResponse.json()
  assert.deepEqual(settings.sources.map(source => source.id), ['wikipedia', 'netease', 'qq'])
  assert.equal(settings.defaultSourceId, 'auto')
  assert.deepEqual(settings.sourceOrder, ['musicbrainz', 'wikipedia', 'netease', 'qq'])

  const qqSearch = await postJson(fixture.baseURL, '/api/album-info/search', {
    albumId: fixture.album.id, title: 'Same Fixture Album', artist: 'Fixture Artist', sourceId: 'qq',
  })
  assert.equal(qqSearch.status, 200)
  const qqResults = await qqSearch.json()
  assert.equal(qqResults.candidates.length, 2)
  assert.ok(qqResults.candidates.every(candidate => candidate.title === 'Same Fixture Album'))
  assert.match(qqResults.automaticCandidate.coverUrl, /^\/api\/album-info\/cover\//u,
    'the automatic candidate preview uses the same local cover proxy as the candidate list')
  const neteaseSearch = await postJson(fixture.baseURL, '/api/album-info/search', {
    albumId: fixture.album.id, title: 'Same Fixture Album', artist: 'Fixture Artist', sourceId: 'netease',
  })
  assert.equal(neteaseSearch.status, 200)
  const neteaseResults = await neteaseSearch.json()
  assert.equal(neteaseResults.candidates.length, 2)
  assert.ok(neteaseResults.candidates.every(candidate => candidate.title === 'Same Fixture Album'))
  assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'library-index.json')), beforeIndex,
    'searching same-title candidates does not change library information')

  const selectedId = neteaseResults.candidates[1].id
  const candidateResponse = await postJson(fixture.baseURL, '/api/album-info/candidate', { candidateId: selectedId })
  assert.equal(candidateResponse.status, 200)
  const candidate = await candidateResponse.json()
  assert.equal(candidate.description, 'Selected synthetic NetEase detail 1002.')
  assert.match(candidate.coverUrl, /^\/api\/album-info\/cover\//u)
  assert.deepEqual(await fs.readFile(path.join(fixture.dataDir, 'library-index.json')), beforeIndex,
    'candidate detail inspection remains read-only')

  const documentResponse = await fetch(`${fixture.baseURL}/api/album-info/document?albumId=${encodeURIComponent(fixture.album.id)}`)
  assert.equal(documentResponse.status, 200)
  const document = await documentResponse.json()
  const saveResponse = await postJson(fixture.baseURL, '/api/album-info/save', {
    albumId: fixture.album.id, revision: document.revision,
    description: candidate.description, sourceCandidateId: selectedId,
    cover: { mode: 'candidate', candidateId: selectedId },
  })
  assert.equal(saveResponse.status, 200)
  const savedLibrary = await saveResponse.json()
  const savedAlbum = savedLibrary.albums.find(album => album.id === fixture.album.id)
  assert.equal(savedAlbum.description, candidate.description)
  assert.equal(savedAlbum.descriptionSource.kind, 'online')
  assert.equal(savedAlbum.descriptionSource.name, '网易云音乐')
  assert.equal(savedAlbum.localNote, undefined, 'candidate descriptions do not become scanner comments')
  assert.ok(savedAlbum.coverUrl)
  assert.equal(fixture.store.snapshot().albums.find(album => album.id === fixture.album.id).description, candidate.description)

  const base64UrlCandidateId = await fetch(`${fixture.baseURL}/api/album-info/cover/invalid_candidate_under_score`)
  assert.equal(base64UrlCandidateId.status, 409, 'candidate cover routing accepts base64url underscores and reports the missing cached candidate')
  } finally {
    await closeHttpServer(fixture.bundle.server)
  }
})

test('global apply persists source order and continues after an earlier source has no candidates', async (t) => {
  const fixture = await createApiFixture(t)
  try {
    const initial = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
    const album = fixture.store.index.albums.find(item => item.id === fixture.album.id)
    album._userInfo = { revision: 'manual-before-apply', description: 'Keep this manual introduction.', sourceOverride: 'custom-previous', cover: { version: 'fixture-cover' } }
    album.description = album._userInfo.description
    album.descriptionSource = { kind: 'manual', name: '手动编辑' }
    const custom = {
      id: 'custom-empty', name: 'Empty fixture source', enabled: true,
      searchUrl: 'https://empty-source.example.test/search?q={query}',
      detailUrl: 'https://empty-source.example.test/album/{id}',
    }
    const settings = {
      sources: [...initial.sources, custom],
      sourceOrder: ['custom-empty', 'qq', 'netease', 'wikipedia', 'musicbrainz'],
      defaultSourceId: 'auto',
    }
    const protectedApply = await postJson(fixture.baseURL, '/api/album-info/apply-global', { settings, overwriteManual: false })
    assert.equal(protectedApply.status, 202)
    if (fixture.store.introductionsPromise) await fixture.store.introductionsPromise
    assert.equal(album.description, 'Keep this manual introduction.')
    assert.equal(fixture.fetcher.calls.length, 0, 'preserving mode skips manual information entirely')

    const applied = await postJson(fixture.baseURL, '/api/album-info/apply-global', { settings, overwriteManual: true })
    assert.equal(applied.status, 202)
    if (fixture.store.introductionsPromise) await fixture.store.introductionsPromise
    assert.ok(fixture.fetcher.calls.some(url => url.startsWith('https://empty-source.example.test/search?')))
    assert.ok(fixture.fetcher.calls.some(url => url.startsWith('https://c.y.qq.com/')),
      'the next available source is queried after the first source returns no candidates')
    const saved = fixture.store.index.albums.find(album => album.id === fixture.album.id)
    assert.equal(saved.description, 'Selected synthetic QQ detail abcdefghijklmn.')
    assert.equal(saved.descriptionSource.sourceId, 'qq')
    assert.equal(saved.descriptionSource.selection, 'auto')
    assert.equal(Object.hasOwn(saved._userInfo, 'description'), false)
    assert.equal(Object.hasOwn(saved._userInfo, 'sourceOverride'), false)
    assert.ok(saved._userInfo.cover, 'complete overwrite preserves the user cover')
    assert.deepEqual((await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()).sourceOrder,
      ['custom-empty', 'qq', 'netease', 'wikipedia', 'musicbrainz'])
  } finally { await closeHttpServer(fixture.bundle.server) }
})

test('global apply rejects a running introduction job before saving changed settings', async (t) => {
  const fixture = await createApiFixture(t)
  try {
    const sources = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
    let finishLookup
    let beginLookup
    const started = new Promise(resolve => { beginLookup = resolve })
    const pending = new Promise(resolve => { finishLookup = resolve })
    const realLookup = fixture.store.albumInfoSources.lookup.bind(fixture.store.albumInfoSources)
    fixture.store.albumInfoSources.lookup = async () => { beginLookup(); return pending }
    const jobResponse = await postJson(fixture.baseURL, '/api/library/introductions', { force: true })
    assert.equal(jobResponse.status, 202)
    await started

    const rejected = await postJson(fixture.baseURL, '/api/album-info/apply-global', {
      settings: { sources: sources.sources, sourceOrder: [...sources.sourceOrder].reverse(), defaultSourceId: 'auto' },
      overwriteManual: false,
    })
    assert.equal(rejected.status, 409)
    assert.deepEqual((await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()).sourceOrder, sources.sourceOrder,
      'the global order is not saved while another introduction job runs')

    finishLookup({ status: 'not-found', checkedAt: new Date().toISOString() })
    await fixture.store.introductionsPromise
    fixture.store.albumInfoSources.lookup = realLookup
  } finally { await closeHttpServer(fixture.bundle.server) }
})

test('online-enabled scans use the ordered introduction lookup and never run disabled MusicBrainz credits', async (t) => {
  const fixture = await createApiFixture(t)
  try {
    const configured = await postJson(fixture.baseURL, '/api/config', { onlineEnabled: true, musicBrainzContact: 'tester@example.invalid' })
    assert.equal(configured.status, 200)
    const settings = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
    settings.sources.find(source => source.id === 'musicbrainz').enabled = false
    assert.equal((await postJson(fixture.baseURL, '/api/album-info/sources', settings)).status, 200)

    const scanResponse = await postJson(fixture.baseURL, '/api/library/scan', {})
    assert.equal(scanResponse.status, 202)
    if (fixture.store.scanPromise) await fixture.store.scanPromise
    if (fixture.store.introductionsPromise) await fixture.store.introductionsPromise
    assert.ok(fixture.fetcher.calls.some(url => url.startsWith('https://music.163.com/api/search/get/web')),
      'the scan automatically searches using the shared source order')
    assert.equal(fixture.fetcher.calls.some(url => url.startsWith('https://musicbrainz.org/')), false,
      'a disabled MusicBrainz source is not queried for credits or introductions')
    const saved = fixture.store.index.albums.find(album => album.id === fixture.album.id)
    assert.equal(saved.descriptionSource.sourceId, 'netease')
    assert.equal(saved.producers.length, 0, 'the scan does not run separate MusicBrainz credit enrichment')
  } finally { await closeHttpServer(fixture.bundle.server) }
})

test('HTTP source choices update immediately when the saved contact email is added or removed', async (t) => {
  const fixture = await createApiFixture(t)
  try {
    const choices = async () => (await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()).sources.map(source => source.id)
    assert.deepEqual(await choices(), ['wikipedia', 'netease', 'qq'])
    const configured = await postJson(fixture.baseURL, '/api/config', { musicBrainzContact: 'tester@example.invalid' })
    assert.equal(configured.status, 200)
    assert.deepEqual(await choices(), ['musicbrainz', 'wikipedia', 'netease', 'qq'])
    const sourceSettings = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
    sourceSettings.sources.find(source => source.id === 'musicbrainz').enabled = false
    const disabled = await postJson(fixture.baseURL, '/api/album-info/sources', sourceSettings)
    assert.equal(disabled.status, 200)
    const rejectedDisabled = await postJson(fixture.baseURL, '/api/library/enrich', {})
    assert.equal(rejectedDisabled.status, 400, 'the MusicBrainz credits action respects the global source enable switch')
    const removed = await postJson(fixture.baseURL, '/api/config', { musicBrainzContact: '' })
    assert.equal(removed.status, 200)
    assert.deepEqual(await choices(), ['wikipedia', 'netease', 'qq'])
    const projectContact = await postJson(fixture.baseURL, '/api/config', { musicBrainzContact: 'https://example.test/project' })
    assert.equal(projectContact.status, 200, 'a project URL remains a valid general contact setting')
    const rejectedEnrich = await postJson(fixture.baseURL, '/api/library/enrich', {})
    assert.equal(rejectedEnrich.status, 400, 'MusicBrainz credits require an email even when a project URL is configured')
    assert.equal(fixture.fetcher.calls.length, 0, 'changing visibility never submits a metadata search')
  } finally { await closeHttpServer(fixture.bundle.server) }
})

test('HTTP MusicBrainz candidates resolve through the existing shared request queue', async (t) => {
  const fixture = await createApiFixture(t)
  try {
    await postJson(fixture.baseURL, '/api/config', { musicBrainzContact: 'tester@example.invalid' })
    const found = await postJson(fixture.baseURL, '/api/album-info/search', { albumId: fixture.album.id, title: 'Same Fixture Album', artist: 'Fixture Artist', sourceId: 'musicbrainz' })
    assert.equal(found.status, 200)
    const result = await found.json()
    assert.equal(result.candidates.length, 1)
    const resolved = await postJson(fixture.baseURL, '/api/album-info/candidate', { candidateId: result.candidates[0].id })
    assert.equal(resolved.status, 200)
    const candidate = await resolved.json()
    assert.equal(candidate.sourceName, 'MusicBrainz')
    assert.match(candidate.description, /^发行资料：/)
    assert.match(candidate.url, /^https:\/\/musicbrainz\.org\/release-group\//)
    assert.equal(fixture.fetcher.calls.filter(url => url.startsWith('https://musicbrainz.org/')).length, 3)
    assert.equal(fixture.scanCalls, 0)
  } finally { await closeHttpServer(fixture.bundle.server) }
})

test('HTTP track save updates real tags and multi-artist cache, preserves stable IDs and isolates album/song artwork', async (t) => {
  const fixture = await createApiFixture(t)
  try {
  const libraryResponse = await fetch(`${fixture.baseURL}/api/library`)
  assert.equal(libraryResponse.status, 200)
  const library = await libraryResponse.json()
  const album = library.albums.find(item => item.tracks?.some(track => track.relativePath.endsWith('01-first.wav')))
  assert.ok(album, `HTTP library contains the synthetic track (album IDs: ${(library.albums ?? []).map(item => item.id).join(', ')})`)
  assert.equal(album.id, fixture.album.id)
  const first = album.tracks.find(track => track.relativePath.endsWith('01-first.wav'))
  const second = album.tracks.find(track => track.relativePath.endsWith('02-second.wav'))
  assert.ok(first && second)
  const trackId = first.id
  const albumCoverResponse = await fetch(`${fixture.baseURL}${album.coverUrl}`)
  assert.equal(albumCoverResponse.status, 200)
  const originalAlbumCover = Buffer.from(await albumCoverResponse.arrayBuffer())
  assert.deepEqual(originalAlbumCover, albumCover)
  const secondCover = await fetch(`${fixture.baseURL}/api/track-info/cover/${second.id}`)
  assert.equal(secondCover.status, 200)
  assert.deepEqual(Buffer.from(await secondCover.arrayBuffer()), originalAlbumCover,
    'a default track cover resolves to the album artwork')

  const documentResponse = await fetch(`${fixture.baseURL}/api/track-info/document?trackId=${encodeURIComponent(trackId)}`)
  assert.equal(documentResponse.status, 200)
  const document = await documentResponse.json()
  assert.equal(document.artwork.mode, 'inherit')
  assert.equal(document.artwork.url, album.coverUrl)
  assert.equal(document.file.name, '01-first.wav')
  assert.equal(Object.keys(document.file).some(key => key.startsWith('_')), false)
  assert.equal(JSON.stringify(document).includes(fixture.runRoot), false, 'track documents do not expose absolute internal paths')
  assert.equal(Object.keys(first).some(key => key.startsWith('_')), false, 'library snapshots omit private track fields')

  const fields = {
    ...document.fields,
    TITLE: ['HTTP edited title'],
    ARTIST: ['HTTP lead', 'HTTP guest', 'HTTP choir'],
  }
  const saveResponse = await postJson(fixture.baseURL, '/api/track-info/save', {
    trackId, revision: document.revision, fields,
    cover: { mode: 'upload', dataUrl: `data:image/png;base64,${songCover.toString('base64')}` },
  })
  assert.equal(saveResponse.status, 200)
  const savedLibrary = await saveResponse.json()
  const savedAlbum = savedLibrary.albums.find(item => item.id === fixture.album.id)
  const savedTrack = savedAlbum.tracks.find(item => item.id === trackId)
  assert.ok(savedTrack, 'track identity remains stable after metadata writeback')
  assert.equal(savedTrack.artist, 'HTTP lead / HTTP guest / HTTP choir')
  assert.deepEqual(savedTrack.artists, ['HTTP lead', 'HTTP guest', 'HTTP choir'])
  assert.equal(savedTrack.title, 'HTTP edited title')
  assert.equal(fixture.scanCalls, 0, 'single-track save refreshes the cache without scanning the library')

  const source = fixture.store.trackFile(trackId)
  assert.ok(source)
  const parsed = await readAudioMetadata(source.path, { duration: true })
  assert.equal(parsed.common.title, 'HTTP edited title')
  assert.deepEqual(parsed.common.artists, ['HTTP lead', 'HTTP guest', 'HTTP choir'])
  const updatedDocument = await (await fetch(`${fixture.baseURL}/api/track-info/document?trackId=${encodeURIComponent(trackId)}`)).json()
  assert.deepEqual(updatedDocument.fields.ARTIST, ['HTTP lead', 'HTTP guest', 'HTTP choir'])
  assert.equal(updatedDocument.artwork.mode, 'embedded')
  const updatedSongCover = await fetch(`${fixture.baseURL}/api/track-info/cover/${trackId}`)
  assert.equal(updatedSongCover.status, 200)
  assert.deepEqual(Buffer.from(await updatedSongCover.arrayBuffer()), songCover)

  const albumCoverAfter = await fetch(`${fixture.baseURL}${savedAlbum.coverUrl}`)
  assert.equal(albumCoverAfter.status, 200)
  assert.deepEqual(Buffer.from(await albumCoverAfter.arrayBuffer()), originalAlbumCover,
    'changing one song cover does not replace the album cover')
  const siblingCoverAfter = await fetch(`${fixture.baseURL}/api/track-info/cover/${second.id}`)
  assert.equal(siblingCoverAfter.status, 200)
  assert.deepEqual(Buffer.from(await siblingCoverAfter.arrayBuffer()), originalAlbumCover,
    'a per-track cover does not leak to a sibling track')

  const sourceBytesBeforeExternalEdit = await fs.readFile(source.path)
  const externalFields = { ...updatedDocument.fields, TITLE: ['External process title'] }
  await writeAudioTags(source.path, { fields: externalFields })
  const externalBytes = await fs.readFile(source.path)
  assert.notDeepEqual(externalBytes, sourceBytesBeforeExternalEdit)
  const staleSave = await postJson(fixture.baseURL, '/api/track-info/save', {
    trackId, revision: updatedDocument.revision, fields: { ...updatedDocument.fields, TITLE: ['Stale UI title'] },
    cover: { mode: 'keep' },
  })
  assert.equal(staleSave.status, 409)
  assert.match((await staleSave.json()).error, /外部修改/u)
  assert.deepEqual(await fs.readFile(source.path), externalBytes, 'revision conflict leaves the external edit untouched')
  assert.equal(fixture.scanCalls, 0)
  } finally {
    await closeHttpServer(fixture.bundle.server)
  }
})

test('HTTP rejects oversized and cross-origin requests and does not evaluate custom source mappings', async (t) => {
  const fixture = await createApiFixture(t)
  try {
  const crossOrigin = await fetch(`${fixture.baseURL}/api/album-info/sources`, {
    headers: { Origin: 'https://unrelated.example.test' },
  })
  assert.equal(crossOrigin.status, 403)

  const oversizedBody = JSON.stringify({ title: 'x'.repeat(140 * 1024), artist: 'Fixture Artist' })
  const oversized = await fetch(`${fixture.baseURL}/api/album-info/search`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversizedBody,
  })
  assert.equal(oversized.status, 413)

  const settings = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
  const malicious = {
    sources: [...settings.sources, {
      id: 'custom-fixture-eval', name: 'No-eval fixture', enabled: true,
      searchUrl: 'https://catalog.example.test/search?q={query}',
      detailUrl: 'https://catalog.example.test/album/{id}',
      mapping: { results: '__proto__.polluted', id: 'id', title: 'title' },
    }],
    defaultSourceId: settings.defaultSourceId,
  }
  const invalidMapping = await postJson(fixture.baseURL, '/api/album-info/sources', malicious)
  assert.equal(invalidMapping.status, 400)
  assert.equal(Object.prototype.polluted, undefined)
  const unchanged = await (await fetch(`${fixture.baseURL}/api/album-info/sources`)).json()
  assert.deepEqual(unchanged.sources.map(source => source.id), ['wikipedia', 'netease', 'qq'])
  } finally {
    await closeHttpServer(fixture.bundle.server)
  }
})
