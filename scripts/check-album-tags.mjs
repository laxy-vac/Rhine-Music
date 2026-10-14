import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { MusicLibraryStore } from './music-library.mjs'
import { dsdFixture, taggedDsf } from './audio-fixtures.mjs'

async function fixture(t, metadataParser) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'rhine-album-tags-'))
  t.after(() => fs.rm(temporary, { force: true, recursive: true }))
  const root = path.join(temporary, 'music')
  await fs.mkdir(root)
  const store = await new MusicLibraryStore({
    dataDir: path.join(temporary, 'index'),
    defaultRoots: [root],
    metadataParser,
  }).init()
  return { temporary, root, store }
}

async function writeTrack(root, relativePath, metadata, metadataByPath) {
  const file = path.join(root, relativePath)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, Buffer.from('temporary metadata fixture'))
  if (metadataByPath) metadataByPath.set(path.resolve(file), metadata)
  return file
}

function taggedMetadata({
  title,
  album,
  albumArtist,
  artist,
  releaseId,
  trackNumber,
  trackTotal,
  discNumber,
  discTotal,
} = {}) {
  const common = {}
  if (title !== undefined) common.title = title
  if (album !== undefined) common.album = album
  if (albumArtist !== undefined) common.albumartist = albumArtist
  if (artist !== undefined) common.artist = artist
  if (releaseId !== undefined) common.musicbrainz_albumid = releaseId
  if (trackNumber !== undefined) common.track = { no: trackNumber, of: trackTotal }
  if (discNumber !== undefined) common.disk = { no: discNumber, of: discTotal }
  return { common, format: { duration: 1, codec: 'Synthetic' } }
}

function albumContaining(snapshot, relativePath) {
  return snapshot.albums.find((album) => album.tracks.some((track) => track.relativePath === relativePath))
}

function albumIdentity(snapshot) {
  return snapshot.albums.map((album) => ({
    id: album.id,
    title: album.title,
    artist: album.artist,
    paths: album.tracks.map((track) => track.relativePath).sort(),
  })).sort((a, b) => a.paths[0].localeCompare(b.paths[0]))
}

test('root-level DSF ID3 tags group by album and album artist while preserving embedded cover and source bytes', async (t) => {
  const { root, store } = await fixture(t)
  const picture = await fs.readFile(new URL('../public/icons/icon-192.png', import.meta.url))
  const generated = dsdFixture()
  const sources = []

  for (const version of [3, 4]) {
    const bytes = taggedDsf(generated.dsf, {
      version,
      picture,
      title: '星河之声 v' + version,
    })
    const file = path.join(root, 'root-v' + version + '.dsf')
    await fs.writeFile(file, bytes)
    sources.push({ file, hash: createHash('sha256').update(bytes).digest('hex') })
  }

  await store.scan()
  const snapshot = store.snapshot()
  assert.equal(snapshot.albums.length, 1)
  const album = snapshot.albums[0]
  assert.equal(album.title, '原生 DSD 专辑')
  assert.equal(album.artist, '测试乐团')
  assert.deepEqual(album.tracks.map((track) => track.title).sort(), ['星河之声 v3', '星河之声 v4'])
  assert.ok(album.tracks.every((track) => track.albumId === album.id))

  const artwork = store.artworkFile(album.id)
  assert.ok(artwork)
  assert.equal(artwork.embedded, true)
  assert.deepEqual(await fs.readFile(artwork.path), picture)

  for (const source of sources) {
    assert.equal(
      createHash('sha256').update(await fs.readFile(source.file)).digest('hex'),
      source.hash,
      'Indexing must not rewrite the DSF or its ID3 tag',
    )
  }
})

test('tag grouping splits albums and artists, merges multi-disc folders, keeps untagged fallbacks, and reuses cached identities', async (t) => {
  let reads = 0
  const metadataByPath = new Map()
  const metadataParser = async (file) => {
    reads += 1
    const metadata = metadataByPath.get(path.resolve(file))
    assert.ok(metadata, 'synthetic metadata exists for ' + file)
    return structuredClone(metadata)
  }
  const { root, store } = await fixture(t, metadataParser)
  const add = (relativePath, tags) => writeTrack(root, relativePath, taggedMetadata(tags), metadataByPath)

  await add(path.join('Mixed Folder', '01-a.flac'), {
    title: 'A track', album: 'Folder Album A', albumArtist: 'Shared Artist', artist: 'Lead A', trackNumber: 1,
  })
  await add(path.join('Mixed Folder', '02-b.flac'), {
    title: 'B track', album: 'Folder Album B', albumArtist: 'Shared Artist', artist: 'Lead B', trackNumber: 1,
  })

  await add(path.join('Compilation', '01.flac'), {
    title: 'Singer One track', album: 'Compilation without album artist', artist: 'Singer One', trackNumber: 1,
  })
  await add(path.join('Compilation', '02.flac'), {
    title: 'Singer Two track', album: 'Compilation without album artist', artist: 'Singer Two', trackNumber: 2,
  })

  await add(path.join('Disc 1', '02.flac'), {
    title: 'Disc one track two', album: 'Multi-disc Album', albumArtist: 'Album Artist', artist: 'Lead One',
    trackNumber: 2, discNumber: 1, discTotal: 2,
  })
  await add(path.join('Disc 2', '01.flac'), {
    title: 'Disc two track one', album: 'Multi-disc Album', albumArtist: 'Album Artist', artist: 'Lead Two',
    trackNumber: 1, discNumber: 2, discTotal: 2,
  })

  await add(path.join('Edition A', '01.flac'), {
    title: 'First edition track', album: 'Same-name Album', albumArtist: 'Edition Artist', artist: 'Singer',
    releaseId: 'ad934c98-0bbd-4060-8ebf-c5a23d2f2b6b', trackNumber: 1,
  })
  await add(path.join('Edition B', '01.flac'), {
    title: 'Second edition track', album: 'Same-name Album', albumArtist: 'Edition Artist', artist: 'Singer',
    releaseId: 'bd934c98-0bbd-4060-8ebf-c5a23d2f2b6b', trackNumber: 1,
  })

  await add(path.join('Fallback Folder', '01.flac'), { title: 'Legacy one', artist: 'Fallback Artist' })
  await add(path.join('Fallback Folder', '02.flac'), { title: 'Legacy two', artist: 'Fallback Artist' })
  await add('root-single.flac', { title: 'Root single title', artist: 'Solo Artist' })

  await store.scan()
  const first = store.snapshot()
  assert.equal(first.albums.length, 9)

  const folderAlbumA = albumContaining(first, path.join('Mixed Folder', '01-a.flac'))
  const folderAlbumB = albumContaining(first, path.join('Mixed Folder', '02-b.flac'))
  assert.ok(folderAlbumA)
  assert.ok(folderAlbumB)
  assert.notEqual(folderAlbumA.id, folderAlbumB.id, 'different tagged albums in one directory stay separate')

  const compilationOne = albumContaining(first, path.join('Compilation', '01.flac'))
  const compilationTwo = albumContaining(first, path.join('Compilation', '02.flac'))
  assert.ok(compilationOne)
  assert.ok(compilationTwo)
  assert.notEqual(compilationOne.id, compilationTwo.id, 'track-artist fallback keeps different artists separate when album artist is absent')
  assert.deepEqual([compilationOne.artist, compilationTwo.artist].sort(), ['Singer One', 'Singer Two'])

  const discOne = albumContaining(first, path.join('Disc 1', '02.flac'))
  const discTwo = albumContaining(first, path.join('Disc 2', '01.flac'))
  assert.ok(discOne)
  assert.equal(discOne.id, discTwo?.id, 'matching album tags across directories form one multi-disc album')
  assert.deepEqual(discOne.tracks.map((track) => [track.discNumber, track.trackNumber]), [[1, 2], [2, 1]])
  assert.equal(discOne.discCount, 2)
  assert.equal(discOne.artist, 'Album Artist')

  const editionOne = albumContaining(first, path.join('Edition A', '01.flac'))
  const editionTwo = albumContaining(first, path.join('Edition B', '01.flac'))
  assert.ok(editionOne)
  assert.ok(editionTwo)
  assert.notEqual(editionOne.id, editionTwo.id, 'different release IDs keep same-name editions distinct')

  const fallback = albumContaining(first, path.join('Fallback Folder', '01.flac'))
  assert.equal(fallback?.title, 'Fallback Folder')
  assert.equal(fallback?.tracks.length, 2)
  const single = albumContaining(first, 'root-single.flac')
  assert.equal(single?.title, 'Root single title')
  assert.equal(single?.artist, 'Solo Artist')

  const initialReads = reads
  await store.scan()
  const second = store.snapshot()
  assert.equal(reads, initialReads, 'unchanged files reuse cached metadata on rescan')
  assert.deepEqual(albumIdentity(second), albumIdentity(first), 'album and track identities stay stable across rescans')
})

test('different tagged albums in one folder retain their own embedded artwork on rescan', async (t) => {
  const pictures = new Map([['one.flac', Buffer.from('first embedded image')], ['two.flac', Buffer.from('second embedded image')]])
  let reads = 0
  const { root, store } = await fixture(t, async (file, options) => {
    reads += 1
    const name = path.basename(file)
    return { common: { album: name, albumartist: 'Artist', picture: options.skipCovers ? [] : [{ format: 'image/png', data: pictures.get(name) }] }, format: {} }
  })
  for (const name of pictures.keys()) await writeTrack(root, path.join('Mixed', name))
  await store.scan()
  assert.equal(store.snapshot().albums.length, 2)
  for (const album of store.snapshot().albums) assert.deepEqual(await fs.readFile(store.artworkFile(album.id).path), pictures.get(album.title))
  await store.scan()
  assert.equal(reads, 2)
  for (const album of store.snapshot().albums) assert.deepEqual(await fs.readFile(store.artworkFile(album.id).path), pictures.get(album.title))
})

test('legacy folder IDs and manual genres survive migration without colliding with new untagged albums', async (t) => {
  const { root, store } = await fixture(t, async (file) => ({ common: path.basename(file) === 'tagged.flac' ? { album: 'Tagged Album', albumartist: 'Artist' } : {}, format: {} }))
  const folder = path.join(root, 'Legacy Folder')
  await writeTrack(root, path.join('Legacy Folder', 'tagged.flac'))
  await store.scan()
  const legacyId = 'album-' + createHash('sha256').update(folder).digest('hex').slice(0, 24)
  store.index.albums[0].id = legacyId
  delete store.index.albums[0]._groupKey
  store.index.albums[0].tracks[0].albumId = legacyId
  await store.updateRules({ ...store.rules, albumOverrides: { [legacyId]: 'jazz' } })
  await store.scan()
  assert.equal(store.snapshot().albums[0].id, legacyId)
  assert.equal(store.snapshot().albums[0].genreId, 'jazz')
  await writeTrack(root, path.join('Legacy Folder', 'untagged.flac'))
  await store.scan()
  const albums = store.snapshot().albums
  assert.equal(albums.length, 2)
  assert.equal(new Set(albums.map((album) => album.id)).size, 2)
  assert.equal(albums.find((album) => album.title === 'Tagged Album').id, legacyId)
  assert.equal(albums.find((album) => album.title === 'Tagged Album').genreId, 'jazz')
})

test('merging legacy albums copies an unambiguous manual genre and persists the migrated rule', async (t) => {
  let reads = 0
  const { root, store } = await fixture(t, async () => {
    reads += 1
    return { common: { album: 'Shared Album', albumartist: 'Artist' }, format: {} }
  })
  for (const folder of ['First', 'Second']) await writeTrack(root, path.join(folder, 'one.flac'))
  await store.scan()
  const grouped = store.index.albums[0]
  store.index.albums = grouped.tracks.map((track, index) => ({ ...grouped, id: `legacy-${index}`, _groupKey: undefined, tracks: [{ ...track, albumId: `legacy-${index}` }] }))
  await store.updateRules({ ...store.rules, albumOverrides: { 'legacy-0': 'jazz', 'legacy-1': 'jazz' } })
  await store.scan()
  assert.equal(reads, 2, 'migration can reuse legacy cached tags')
  assert.equal(store.snapshot().albums.length, 1)
  assert.equal(store.snapshot().albums[0].genreId, 'jazz')
  const reloaded = await new MusicLibraryStore({ dataDir: store.dataDir }).init()
  assert.equal(reloaded.snapshot().albums[0].genreId, 'jazz')
  assert.equal(reloaded.rules.albumOverrides['legacy-0'], 'jazz', 'migration does not delete original manual choices')
})

test('explicit compilation tags group different track artists without an album artist', async (t) => {
  const { root, store } = await fixture(t, async (file) => ({ common: { album: 'Compilation', artist: path.basename(file), compilation: true }, format: {} }))
  for (const name of ['Singer One.flac', 'Singer Two.flac']) await writeTrack(root, name)
  await store.scan()
  assert.equal(store.snapshot().albums.length, 1)
  assert.equal(store.snapshot().albums[0].artist, 'Various Artists')
  assert.equal(store.snapshot().albums[0].tracks.length, 2)
})

test('legacy cached tags are refreshed once to recover the previously omitted compilation flag', async (t) => {
  let reads = 0
  const { root, store } = await fixture(t, async (file) => {
    reads += 1
    return { common: { album: 'Compilation', artist: path.basename(file), compilation: true }, format: {} }
  })
  for (const name of ['Singer One.flac', 'Singer Two.flac']) await writeTrack(root, name)
  await store.scan()
  for (const track of store.index.albums[0].tracks) delete track._common.compilation
  await store.scan()
  assert.equal(reads, 4)
  assert.equal(store.snapshot().albums.length, 1)
  await store.scan()
  assert.equal(reads, 4, 'the upgraded index reuses metadata normally')
})

test('ambiguous legacy manual genres remain stored instead of being assigned to every split album', async (t) => {
  const { root, store } = await fixture(t, async (file) => ({ common: { album: path.basename(file), albumartist: 'Artist' }, format: {} }))
  for (const name of ['One.flac', 'Two.flac']) await writeTrack(root, path.join('Mixed', name))
  await store.scan()
  const original = store.index.albums[0]
  store.index.albums = [{ ...original, id: 'legacy-folder', _groupKey: undefined, tracks: store.index.albums.flatMap((album) => album.tracks) }]
  await store.updateRules({ ...store.rules, albumOverrides: { 'legacy-folder': 'jazz' } })
  await store.scan()
  assert.equal(store.snapshot().albums.length, 2)
  assert.ok(store.snapshot().albums.every((album) => album.genreId === 'unclassified'))
  assert.equal(store.rules.albumOverrides['legacy-folder'], 'jazz')
  assert.equal(store.snapshot().scan.warnings.length, 2)
})

test('same-name albums with no artist tags remain separate across folders', async (t) => {
  const { root, store } = await fixture(t, async () => ({ common: { album: 'Unknown Artist Album' }, format: {} }))
  for (const folder of ['First', 'Second']) await writeTrack(root, path.join(folder, 'one.flac'))
  await store.scan()
  assert.equal(store.snapshot().albums.length, 2)
  assert.equal(new Set(store.snapshot().albums.map((album) => album.id)).size, 2)
})
