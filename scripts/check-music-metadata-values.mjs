import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { splitMusicMetadataValues as split } from '../src/music-metadata-values.mjs'
import { MusicLibraryStore } from './music-library.mjs'
import { readAudioTagDocument, writeAudioTags } from './audio-tag-editor.mjs'
import { silentWav } from './audio-fixtures.mjs'

test('scan credit parsing splits explicit collaboration lists and retains performer order', () => {
  for (const [input, expected] of [
    ['陈奕迅/王菲', ['陈奕迅', '王菲']],
    ['主唱；嘉宾甲、嘉宾乙，嘉宾丙', ['主唱', '嘉宾甲', '嘉宾乙', '嘉宾丙']],
    ['主唱, 嘉宾', ['主唱', '嘉宾']],
    ['Alice / Bob', ['Alice', 'Bob']],
    ['Taylor Swift/Ed Sheeran', ['Taylor Swift', 'Ed Sheeran']],
    ['Lead feat. Guest & Another', ['Lead', 'Guest', 'Another']],
    ['Lead (feat. Guest & Another)', ['Lead', 'Guest', 'Another']],
    ['主唱（feat.嘉宾）', ['主唱', '嘉宾']],
    ['Lead with Guest', ['Lead', 'Guest']],
    ['Lead x Guest', ['Lead', 'Guest']],
    ['主唱 + 嘉宾', ['主唱', '嘉宾']],
    ['主唱＋嘉宾＆合唱', ['主唱', '嘉宾', '合唱']],
    ['主唱\n嘉宾', ['主唱', '嘉宾']],
    ['主唱;;嘉宾；', ['主唱', '嘉宾']],
    [['Lead', 'Guest; Choir', 'lead'], ['Lead', 'Guest', 'Choir']],
  ]) assert.deepEqual(split('ARTIST', input), expected, JSON.stringify(input))
  assert.deepEqual(split('ALBUMARTIST', '主唱/嘉宾'), ['主唱', '嘉宾'])
})

test('scan parsing protects band names, nested credit text and compound genre names', () => {
  for (const name of ['AC/DC', 'Simon & Garfunkel', 'Earth, Wind & Fire', 'Florence + the Machine', 'Mumford & Sons',
    'Artist (Orchestra / Choir)', 'Last, First', 'The xx', 'Withers', 'MAN WITH A MISSION', 'She & Him', 'Dan + Shay', 'G.E.M.邓紫棋'])
    assert.deepEqual(split('ARTIST', name), [name], name)
  assert.deepEqual(split('ARTIST', 'AC/DC feat. Guest'), ['AC/DC', 'Guest'])
  assert.deepEqual(split('ARTIST', 'Simon ＆ Garfunkel；AC／DC'), ['Simon ＆ Garfunkel', 'AC／DC'])
  assert.deepEqual(split('ARTIST', 'Alice & Simon & Garfunkel'), ['Alice', 'Simon & Garfunkel'])
  assert.deepEqual(split('GENRE', ['Pop/Rock; Jazz', 'pop']), ['Pop', 'Rock', 'Jazz'])
  assert.deepEqual(split('GENRE', ['R&B', 'Drum & Bass', 'R&B/Soul', 'Hip-Hop/Rap']), ['R&B', 'Drum & Bass', 'R&B/Soul', 'Hip-Hop/Rap'])
  assert.deepEqual(split('GENRE', 'R&B / Soul; Hip-Hop / Rap'), ['R&B / Soul', 'Hip-Hop / Rap'])
  assert.deepEqual(split('GENRE', 'Pop & Rock'), ['Pop', 'Rock'])
  assert.deepEqual(split('GENRE', 'Pop & Drum & Bass'), ['Pop', 'Drum & Bass'])
  assert.deepEqual(split('TITLE', ['A/B; C']), ['A/B; C'], 'single-value metadata is not interpreted')
  assert.deepEqual(split('ARTIST', 'Long '.repeat(3000)), ['Long '.repeat(3000).trim()], 'overlong credits remain intact')
})

test('first scan recognizes joined credits and genres without rewriting audio or splitting a collaboration album', async t => {
  const parent = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.tools/multi-value-scan-20261022')
  await fs.mkdir(parent, { recursive: true })
  const directory = await fs.mkdtemp(path.join(parent, 'test-'))
  t.after(() => {
    assert.ok(path.resolve(directory).startsWith(`${parent}${path.sep}`))
    return fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 80 })
  })
  const musicRoot = path.join(directory, 'music'), folder = path.join(musicRoot, 'Album')
  await fs.mkdir(folder, { recursive: true })
  const fixtures = [
    { name: '01.wav', title: 'First', album: 'Collaboration', artist: '主唱 feat. 嘉宾甲', genre: 'Pop; Rock' },
    { name: '02.wav', title: 'Second', album: 'Collaboration', artist: '主唱/嘉宾乙', genre: 'Pop/Rock' },
    { name: '03.wav', title: 'Third', album: 'Band Album', artist: 'AC/DC' },
    { name: '04.wav', title: 'Fourth', album: 'Explicit Album', artist: '嘉宾；主唱', albumArtist: '专辑艺人/联合艺人' },
  ]
  const originals = new Map()
  for (const item of fixtures) {
    const file = path.join(folder, item.name)
    await fs.writeFile(file, silentWav(0.1, 44100, 16))
    await writeAudioTags(file, { fields: { TITLE: [item.title], ALBUM: [item.album], ARTIST: [item.artist],
      ...(item.albumArtist ? { ALBUMARTIST: [item.albumArtist] } : {}), ...(item.genre ? { GENRE: [item.genre] } : {}) } })
    originals.set(file, { data: await fs.readFile(file), stat: await fs.stat(file) })
  }
  const store = await new MusicLibraryStore({ dataDir: path.join(directory, 'index'), defaultRoots: [musicRoot] }).init()
  await store.scan()
  const snapshot = store.snapshot()
  const collaboration = snapshot.albums.find(album => album.title === 'Collaboration')
  assert.equal(collaboration.tracks.length, 2, 'guest changes do not turn one album into two')
  assert.equal(collaboration.artist, '主唱')
  assert.deepEqual(collaboration.tracks.find(track => track.title === 'First').artists, ['主唱', '嘉宾甲'])
  assert.deepEqual(collaboration.tracks.find(track => track.title === 'Second').artists, ['主唱', '嘉宾乙'])
  assert.deepEqual(collaboration.rawGenres, ['Pop', 'Rock'])
  assert.equal(collaboration.genreId, 'pop')
  assert.deepEqual(snapshot.albums.find(album => album.title === 'Band Album').artists, ['AC/DC'])
  const explicit = snapshot.albums.find(album => album.title === 'Explicit Album')
  assert.equal(explicit.artist, '专辑艺人/联合艺人', 'explicit album identity retains its original credit')
  assert.deepEqual(explicit.artists, ['专辑艺人', '联合艺人'])
  const albumIds = snapshot.albums.map(album => album.id).sort()
  await store.scan()
  assert.deepEqual(store.snapshot().albums.map(album => album.id).sort(), albumIds, 'cached scans retain album identity')
  for (const [file, before] of originals) {
    assert.deepEqual(await fs.readFile(file), before.data, 'scanning never rewrites tags or audio')
    assert.equal((await fs.stat(file)).mtimeMs, before.stat.mtimeMs)
  }
  assert.deepEqual((await readAudioTagDocument(path.join(folder, '01.wav'))).fields.ARTIST, ['主唱 feat. 嘉宾甲'])
})
