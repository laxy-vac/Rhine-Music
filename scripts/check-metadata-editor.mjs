import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { MusicLibraryStore } from './music-library.mjs'
import { MusicMetadataEditor } from './music-metadata-editor.mjs'
import { readAudioTagDocument, writeAudioTags } from './audio-tag-editor.mjs'
import { readTrackArtworkOverride, writeTrackArtworkOverride } from './track-artwork-overrides.mjs'
import { silentWav } from './audio-fixtures.mjs'
import { readAudioMetadata } from './read-audio-metadata.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtureParent = path.join(projectRoot, '.tools', 'metadata-editor-20261022')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
  'base64',
)
const PNG2 = Buffer.concat([PNG, Buffer.from('second-synthetic-image')])
const HASH = value => createHash('sha256').update(value).digest('hex').slice(0, 24)

async function fixture(t) {
  await fs.mkdir(fixtureParent, { recursive: true })
  const runRoot = await fs.mkdtemp(path.join(fixtureParent, 'test-editor-'))
  t.after(async () => {
    const target = path.resolve(runRoot)
    assert.ok(target.startsWith(`${path.resolve(fixtureParent)}${path.sep}`), 'fixture cleanup stays within its owned test-editor directory')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
  })

  const musicRoot = path.join(runRoot, 'music')
  const albumDir = path.join(musicRoot, 'Editor Album')
  const dataDir = path.join(runRoot, 'index')
  await fs.mkdir(albumDir, { recursive: true })
  const files = [path.join(albumDir, '01-first.wav'), path.join(albumDir, '02-second.wav')]
  for (let index = 0; index < files.length; index++) {
    await fs.writeFile(files[index], silentWav(0.15, 44100, 16))
    await writeAudioTags(files[index], {
      fields: {
        TITLE: [index === 0 ? 'First original' : 'Second original'],
        ARTIST: [index === 0 ? 'First Singer' : 'Second Singer'],
        ALBUM: ['Metadata editor fixture'],
        ALBUMARTIST: ['Fixture Album Artist'],
        TRACKNUMBER: [String(index + 1)],
      },
    })
  }
  await fs.writeFile(path.join(albumDir, 'Cover.png'), PNG)
  const metadataParser = async (file, options) => {
    const parsed = await readAudioMetadata(file, options)
    parsed.common.comment = [{ text: 'Scanner-owned note' }]
    return parsed
  }
  const store = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot], metadataParser }).init()
  await store.scan()
  const album = store.index.albums[0]
  assert.ok(album, 'synthetic album is indexed')
  return { runRoot, musicRoot, albumDir, dataDir, files, store, album, metadataParser }
}

function fixtureSources() {
  const candidate = {
    id: 'fixture-candidate-1', title: 'Metadata editor fixture', artist: 'Fixture Album Artist', year: 2024,
    description: 'A selected synthetic album introduction.', sourceName: 'Fixture catalog',
    url: 'https://catalog.example.test/album/fixture-candidate-1', license: 'CC BY fixture',
  }
  return {
    async init() {},
    async search(query) { return {
      candidates: [{ ...candidate, query: { title: query.title, artist: query.artist } }],
      sources: [{ sourceId: 'fixture-source', name: 'Fixture catalog', status: 'ok', count: 1 }],
    } },
    async resolve(id) { return id === candidate.id ? { ...candidate } : undefined },
    async cover(id) { assert.equal(id, candidate.id); return { data: PNG, mime: 'image/png' } },
  }
}

function findAlbum(store) { return store.index.albums.find(album => album.title === 'Metadata editor fixture') ?? store.index.albums[0] }
function findTrack(store, basename) { return store.index.albums.flatMap(album => album.tracks).find(track => path.basename(track.relativePath) === basename) }
function dataUrl(bytes = PNG) { return `data:image/png;base64,${bytes.toString('base64')}` }
async function jsonBytes(dataDir) { return fs.readFile(path.join(dataDir, 'library-index.json')) }

test('manual and explicitly selected album information survives offline restart and scans without entering scanner notes', async (t) => {
  const { dataDir, musicRoot, store } = await fixture(t)
  const sources = fixtureSources()
  const editor = await new MusicMetadataEditor({ store, dataDir, sources }).init()
  const album = findAlbum(store)
  const firstFileBefore = await fs.readFile(store.index.albums[0].tracks[0]._path)
  const indexBeforeSearch = await jsonBytes(dataDir)

  const results = await editor.search({ albumId: album.id, title: 'Metadata editor fixture', artist: 'Fixture Album Artist' })
  assert.equal(results.candidates[0].id, 'fixture-candidate-1')
  const candidate = await editor.candidate(results.candidates[0].id)
  assert.equal(candidate.description, 'A selected synthetic album introduction.')
  assert.deepEqual(await jsonBytes(dataDir), indexBeforeSearch, 'search and candidate inspection do not persist album data')
  assert.equal(album._userInfo, undefined, 'a same-title result is not applied automatically')

  const initial = editor.document(album.id)
  await editor.saveAlbum({
    albumId: album.id, revision: initial.revision, description: candidate.description,
    sourceCandidateId: candidate.id, cover: { mode: 'candidate', candidateId: candidate.id },
  })
  let saved = store.snapshot().albums.find(item => item.id === album.id)
  assert.equal(saved.description, candidate.description)
  assert.equal(saved.descriptionSource?.kind, 'online')
  assert.equal(saved.descriptionSource?.url, candidate.url)
  assert.equal(saved.localNote, 'Scanner-owned note')
  assert.notEqual(saved.coverUrl, undefined, 'selected candidate cover is stored in the app data directory')
  assert.deepEqual(await fs.readFile(store.index.albums[0].tracks[0]._path), firstFileBefore, 'album information edits do not change song files')

  let restarted = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot], metadataParser: async (file, options) => {
    const parsed = await readAudioMetadata(file, options)
    parsed.common.comment = [{ text: 'Scanner-owned note' }]
    return parsed
  } }).init()
  saved = restarted.snapshot().albums.find(item => item.id === album.id)
  assert.equal(saved.description, candidate.description, 'selected introduction loads without source access')
  assert.equal(saved.localNote, 'Scanner-owned note')

  const manualEditor = await new MusicMetadataEditor({ store: restarted, dataDir, sources: fixtureSources() }).init()
  const manualDoc = manualEditor.document(album.id)
  await manualEditor.saveAlbum({
    albumId: album.id, revision: manualDoc.revision, description: '手动离线介绍。', cover: { mode: 'keep' },
  })
  assert.equal(restarted.snapshot().albums.find(item => item.id === album.id).description, '手动离线介绍。')
  assert.equal(restarted.snapshot().albums.find(item => item.id === album.id).descriptionSource?.kind, 'manual')
  assert.equal(restarted.snapshot().albums.find(item => item.id === album.id).localNote, 'Scanner-owned note')

  restarted = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot], metadataParser: async (file, options) => {
    const parsed = await readAudioMetadata(file, options)
    parsed.common.comment = [{ text: 'Scanner-owned note' }]
    return parsed
  } }).init()
  await restarted.scan()
  const afterRestartAndScan = restarted.snapshot().albums.find(item => item.id === album.id)
  assert.equal(afterRestartAndScan.description, '手动离线介绍。')
  assert.equal(afterRestartAndScan.descriptionSource?.kind, 'manual')
  assert.equal(afterRestartAndScan.localNote, 'Scanner-owned note', 'manual prose remains separate from scanner comments')
})

test('changing only an album cover preserves the existing introduction and its attribution', async (t) => {
  const { store } = await fixture(t)
  const album = findAlbum(store)
  album.description = 'Existing online introduction'
  album.descriptionSource = { name: 'Existing source', url: 'https://example.test/release' }
  const editor = await new MusicMetadataEditor({ store }).init()
  const document = editor.document(album.id)
  await editor.saveAlbum({ albumId: album.id, revision: document.revision,
    description: document.album.description, cover: { mode: 'upload', dataUrl: dataUrl() } })
  const updated = editor.document(album.id)
  assert.equal(updated.album.description, document.album.description)
  assert.deepEqual(updated.album.descriptionSource, document.album.descriptionSource)
  assert.equal(Object.hasOwn(album._userInfo, 'description'), false,
    'a cover-only save does not mark untouched online text as manually edited')
})

test('song edits stage only the target file, update indexed multi-artist metadata without a full scan, and reject external changes', async (t) => {
  const { store, files } = await fixture(t)
  const target = findTrack(store, '01-first.wav')
  const other = findTrack(store, '02-second.wav')
  assert.ok(target && other)
  const otherBytes = await fs.readFile(files[1])
  let scanCalls = 0
  const realScan = store.scan.bind(store)
  store.scan = async (...args) => { scanCalls++; return realScan(...args) }
  const editor = await new MusicMetadataEditor({ store }).init()
  const document = await editor.trackDocument(target.id)
  assert.equal(document.artwork.mode, 'inherit')
  assert.equal(document.artwork.url, store.snapshot().albums.find(album => album.id === target.albumId)?.coverUrl)
  const nextFields = { ...document.fields, TITLE: ['Edited first song'], ARTIST: ['Lead One', 'Guest Two', 'Choir Three'] }

  await editor.saveTrack({ trackId: target.id, revision: document.revision, fields: nextFields, cover: { mode: 'keep' } })
  assert.equal(scanCalls, 0, 'a single-track save refreshes only the edited cache entry')
  assert.equal(store.metadataWrites, 0, 'the metadata write lock is released after commit')
  assert.deepEqual(await fs.readFile(files[1]), otherBytes, 'the sibling track file is byte-identical')
  const updatedTrack = findTrack(store, '01-first.wav')
  assert.equal(updatedTrack.title, 'Edited first song')
  assert.equal(updatedTrack.artist, 'Lead One / Guest Two / Choir Three', 'the full ordered artist label remains available for display')
  assert.equal(updatedTrack.artists[0], 'Lead One', 'the first singer remains available for primary-artist grouping')
  assert.deepEqual(updatedTrack.artists, ['Lead One', 'Guest Two', 'Choir Three'])

  const latest = await editor.trackDocument(target.id)
  const externalFields = { ...latest.fields, TITLE: ['External edit that wins'] }
  await writeAudioTags(files[0], { fields: externalFields })
  const externalBytes = await fs.readFile(files[0])
  await assert.rejects(
    editor.saveTrack({ trackId: target.id, revision: latest.revision, fields: { ...latest.fields, TITLE: ['Stale editor value'] }, cover: { mode: 'keep' } }),
    error => error.status === 409,
  )
  assert.deepEqual(await fs.readFile(files[0]), externalBytes, 'stale editor data cannot replace an external edit')
  assert.equal(scanCalls, 0)
})

test('editing a root-level untagged song preserves each loose file as its own album', async (t) => {
  await fs.mkdir(fixtureParent, { recursive: true })
  const runRoot = await fs.mkdtemp(path.join(fixtureParent, 'test-editor-'))
  t.after(async () => {
    const target = path.resolve(runRoot)
    assert.ok(target.startsWith(`${path.resolve(fixtureParent)}${path.sep}`))
    await fs.rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
  })
  const musicRoot = path.join(runRoot, 'music')
  const dataDir = path.join(runRoot, 'index')
  await fs.mkdir(musicRoot, { recursive: true })
  const files = [path.join(musicRoot, 'loose-one.wav'), path.join(musicRoot, 'loose-two.wav')]
  for (const file of files) await fs.writeFile(file, silentWav(0.12, 44100, 16))
  const store = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot] }).init()
  await store.scan()
  assert.equal(store.index.albums.length, 2, 'each untagged root-level file starts as its own album')
  const targetTrack = findTrack(store, 'loose-one.wav')
  const siblingTrack = findTrack(store, 'loose-two.wav')
  assert.ok(targetTrack && siblingTrack)
  const originalSiblingAlbumId = siblingTrack.albumId
  const editor = await new MusicMetadataEditor({ store }).init()
  const document = await editor.trackDocument(targetTrack.id)
  await editor.saveTrack({
    trackId: targetTrack.id, revision: document.revision,
    fields: { ...document.fields, TITLE: ['Renamed loose song'] }, cover: { mode: 'keep' },
  })
  assert.equal(store.index.albums.length, 2, 'incremental refresh must retain the root-level per-file grouping')
  assert.equal(findTrack(store, 'loose-one.wav')?.title, 'Renamed loose song')
  assert.equal(findTrack(store, 'loose-two.wav')?.albumId, originalSiblingAlbumId)
})

test('track artwork inherits the album cover, then isolates a sidecar override through scans and restart', async (t) => {
  const { dataDir, musicRoot, albumDir, store, files } = await fixture(t)
  const first = findTrack(store, '01-first.wav'), second = findTrack(store, '02-second.wav')
  assert.ok(first && second)
  const secondBytes = await fs.readFile(files[1])
  const initialAlbumCover = store.snapshot().albums.find(album => album.id === first.albumId)?.coverUrl
  assert.ok(initialAlbumCover)
  const forceSidecarReader = async file => ({ ...(await readAudioTagDocument(file)), canEmbed: false })
  const forceSidecarWriter = async (file, value) => {
    assert.equal(value.cover.mode, 'keep', 'the writer is not asked to embed into a format declared non-embeddable')
    await writeAudioTags(file, { fields: value.fields, cover: { mode: 'keep' } })
    return { coverEmbedded: false }
  }
  const editor = await new MusicMetadataEditor({ store, dataDir, tagReader: forceSidecarReader, tagWriter: forceSidecarWriter }).init()
  const firstDoc = await editor.trackDocument(first.id)
  const secondDoc = await editor.trackDocument(second.id)
  assert.equal(firstDoc.artwork.mode, 'inherit')
  assert.equal(firstDoc.artwork.url, initialAlbumCover)
  assert.equal(secondDoc.artwork.mode, 'inherit')

  await editor.saveTrack({
    trackId: first.id, revision: firstDoc.revision, fields: firstDoc.fields,
    cover: { mode: 'upload', dataUrl: dataUrl() },
  })
  const firstAfter = await editor.trackDocument(first.id)
  const secondAfter = await editor.trackDocument(second.id)
  assert.equal(firstAfter.artwork.mode, 'sidecar')
  assert.match(firstAfter.artwork.url, new RegExp(first.id))
  assert.equal(secondAfter.artwork.mode, 'inherit')
  assert.equal(secondAfter.artwork.url, initialAlbumCover)
  assert.equal(store.snapshot().albums.find(album => album.id === first.albumId)?.coverUrl, initialAlbumCover)
  assert.ok(await fs.stat(path.join(albumDir, '.rhine-artwork')))

  await store.scan()
  const afterScanEditor = await new MusicMetadataEditor({ store, dataDir, tagReader: forceSidecarReader, tagWriter: forceSidecarWriter }).init()
  assert.equal((await afterScanEditor.trackDocument(first.id)).artwork.mode, 'sidecar')
  assert.equal((await afterScanEditor.trackDocument(second.id)).artwork.mode, 'inherit')
  assert.equal(store.snapshot().albums.find(album => album.id === first.albumId)?.coverUrl, initialAlbumCover,
    'the hidden per-track artwork directory does not become the album cover')

  const restarted = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot] }).init()
  await restarted.scan()
  const restartedEditor = await new MusicMetadataEditor({ store: restarted, dataDir }).init()
  assert.equal((await restartedEditor.trackDocument(first.id)).artwork.mode, 'sidecar')
  assert.equal((await restartedEditor.trackDocument(second.id)).artwork.mode, 'inherit')
  assert.deepEqual(await fs.readFile(files[1]), secondBytes, 'the sibling song remains byte-identical')
})

test('a per-song embedded cover survives a cache-miss scan beside a directory album cover', async (t) => {
  const { dataDir, musicRoot, store, files } = await fixture(t)
  const first = findTrack(store, '01-first.wav')
  const editor = await new MusicMetadataEditor({ store }).init()
  const document = await editor.trackDocument(first.id)
  const albumImage = await fs.readFile(store.artworkFile(first.albumId).path)
  await editor.saveTrack({ trackId: first.id, revision: document.revision, fields: document.fields,
    cover: { mode: 'upload', dataUrl: dataUrl(PNG2) } })
  assert.deepEqual(await fs.readFile(store.trackArtworkFile(first.id).path), PNG2)

  const tags = await readAudioTagDocument(files[0])
  await writeAudioTags(files[0], { fields: { ...tags.fields, TITLE: ['External title change'] }, cover: { mode: 'keep' } })
  await store.scan()
  assert.deepEqual(await fs.readFile(store.trackArtworkFile(first.id).path), PNG2)
  assert.deepEqual(await fs.readFile(store.artworkFile(first.albumId).path), albumImage)

  const restarted = await new MusicLibraryStore({ dataDir, defaultRoots: [musicRoot] }).init()
  restarted.index.albums = []
  await restarted.scan()
  assert.deepEqual(await fs.readFile(restarted.trackArtworkFile(first.id).path), PNG2,
    'a full index rebuild reads embedded per-song artwork from the persisted association')
})

test('staged tag adapter accepts mixed-case Unicode property keys and normalized empty values', async (t) => {
  const { runRoot } = await fixture(t)
  const root = path.join(runRoot, 'adapter-root')
  const file = path.join(root, 'adapter.wav')
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(file, silentWav(0.1, 44100, 16))
  const trackId = 'track-adapter-fixture'
  const albumId = 'album-adapter-fixture'
  const track = { id: trackId, albumId, title: 'Original', artist: 'Singer', relativePath: 'adapter.wav', format: 'WAV', duration: 0.1 }
  const album = { id: albumId, title: 'Adapter fixture', artist: 'Singer', folder: root, tracks: [track], _root: root }
  let stagedFields
  let writerPath
  const originalFields = {
    TITLE: ['Original'], ARTIST: ['Singer'], TRACKNUMBER: ['1'],
    'X-MiXeD/自定义字段': ['原值'],
  }
  const store = {
    dataDir: path.join(runRoot, 'adapter-index'), config: { roots: [root] }, index: { albums: [album] }, metadataWrites: 0,
    trackFile(id) { return id === trackId ? { path: file, allowedRoot: root } : null },
    artworkFile() { return null },
    snapshot() { return { version: 1, albums: [{ id: albumId, title: album.title, artist: album.artist, tracks: [track] }] } },
    async refreshEditedTrack(id) { assert.equal(id, trackId) },
    async saveIndex() {}, onChange() {},
  }
  const tagReader = async target => ({
    fields: target === file ? structuredClone(originalFields) : structuredClone(stagedFields ?? originalFields),
    canEmbed: false, writable: true,
  })
  const tagWriter = async (target, value) => {
    writerPath = target
    stagedFields = Object.fromEntries(Object.entries(value.fields).filter(([, values]) => values.some(item => item !== '')))
    stagedFields = Object.fromEntries(Object.entries(stagedFields).map(([key, values]) => [key, values.filter(item => item !== '')]))
    return { coverEmbedded: false }
  }
  const editor = await new MusicMetadataEditor({ store, tagReader, tagWriter }).init()
  const document = await editor.trackDocument(trackId)
  const fields = {
    ...document.fields,
    TITLE: [''],
    ARTIST: ['Singer', 'Guest'],
    'X-MiXeD/自定义字段': ['保留原有键名与大小写'],
    '自定义:後綴': ['保留 Unicode 字段名'],
  }
  await editor.saveTrack({ trackId, revision: document.revision, fields, cover: { mode: 'keep' } })
  assert.notEqual(writerPath, file, 'the writer receives only the staged copy path')
  assert.match(path.basename(writerPath), /^\.rhine-edit-/u)
  assert.equal(stagedFields.TITLE, undefined, 'empty standard fields normalize to deletion')
  assert.deepEqual(stagedFields.ARTIST, ['Singer', 'Guest'])
  assert.deepEqual(stagedFields['X-MiXeD/自定义字段'], ['保留原有键名与大小写'])
  assert.deepEqual(stagedFields['自定义:後綴'], ['保留 Unicode 字段名'])
  assert.equal(store.metadataWrites, 0)
})

test('sidecar rollback restores the previous association and removes only its newly created image', async (t) => {
  const { runRoot } = await fixture(t)
  const folder = path.join(runRoot, 'sidecar-rollback')
  const file = path.join(folder, 'one.wav')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(file, silentWav(0.1, 44100, 16))

  const first = await writeTrackArtworkOverride(file, 'sidecar', { data: PNG, mime: 'image/png' })
  const second = await writeTrackArtworkOverride(file, 'sidecar', { data: PNG2, mime: 'image/png' })
  assert.notEqual(first.override.path, second.override.path)
  assert.ok(await fs.stat(second.override.path))
  await second.rollback()
  const restored = await readTrackArtworkOverride(file)
  assert.equal(restored.mode, 'sidecar')
  assert.equal(restored.version, first.override.version)
  await assert.rejects(fs.stat(second.override.path), error => error.code === 'ENOENT', 'rollback removes its unreferenced newly created image')
  await first.rollback()
  assert.equal(await readTrackArtworkOverride(file), undefined)
  await assert.rejects(fs.stat(first.override.path), error => error.code === 'ENOENT')

  const third = await writeTrackArtworkOverride(file, 'sidecar', { data: PNG2, mime: 'image/png' })
  const mapping = path.join(folder, '.rhine-artwork', `track-${HASH(path.basename(file))}.json`)
  const external = JSON.parse(await fs.readFile(mapping, 'utf8'))
  external.revision = 'external-edit'
  const externalBytes = Buffer.from(JSON.stringify(external))
  await fs.writeFile(mapping, externalBytes)
  await assert.rejects(third.rollback(), /外部修改/u)
  assert.deepEqual(await fs.readFile(mapping), externalBytes, 'rollback does not overwrite a later external sidecar edit')
  assert.ok(await fs.stat(third.override.path), 'rollback leaves an image still referenced by the external map')
})

test('sidecar helpers reject symbolic-link metadata paths when the host permits creating links', async (t) => {
  const { runRoot } = await fixture(t)
  const folder = path.join(runRoot, 'sidecar-symlink')
  const file = path.join(folder, 'one.wav')
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(file, silentWav(0.1, 44100, 16))
  const outside = path.join(runRoot, 'outside.json')
  const externalBytes = Buffer.from(JSON.stringify({ app: 'RhineMusic', version: 1, track: 'one.wav', mode: 'inherit' }))
  await fs.writeFile(outside, externalBytes)
  const directory = path.join(folder, '.rhine-artwork')
  await fs.mkdir(directory, { recursive: true })
  const json = path.join(directory, `track-${HASH(path.basename(file))}.json`)
  try { await fs.symlink(outside, json, 'file') }
  catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP', 'UNKNOWN'].includes(error.code)) return t.skip(`symlink creation is unavailable: ${error.code}`)
    throw error
  }
  await assert.rejects(writeTrackArtworkOverride(file, 'inherit'))
  assert.deepEqual(await fs.readFile(outside), externalBytes, 'the external target stays byte-identical')
})
