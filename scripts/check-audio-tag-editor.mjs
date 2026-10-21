import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseFile } from 'music-metadata'
import { TagLib } from 'taglib-wasm'
import { dsdFixture, silentWav } from './audio-fixtures.mjs'
import { normalizeReplayGainTags } from './replaygain-tags.mjs'
import { readAudioTagDocument, writeAudioTags } from './audio-tag-editor.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const toolsRoot = path.join(repositoryRoot, '.tools', 'metadata-editor-20261022')
const ffmpeg = path.join(
  repositoryRoot,
  '.tools', 'dependency-staging', 'pcm-codecs', 'ffmpeg-sdk-1b5ebbf0a06d',
  'ffmpeg-n9.0.2-24-gfd5d616c29-win64-lgpl-shared-9.0', 'bin', 'ffmpeg.exe',
)
const frontPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
  'base64',
)

async function makeFixtures(t) {
  await fs.mkdir(toolsRoot, { recursive: true })
  const runRoot = await fs.mkdtemp(path.join(toolsRoot, 'run-'))
  t.after(async () => {
    const resolved = path.resolve(runRoot)
    assert.ok(resolved.startsWith(`${path.resolve(toolsRoot)}${path.sep}`), 'cleanup remains inside the dedicated fixture directory')
    await fs.rm(resolved, { recursive: true, force: true })
  })

  const wav = path.join(runRoot, 'source.wav')
  await fs.writeFile(wav, silentWav(0.15, 44100, 16))
  const fixtures = new Map([['WAV', wav]])
  if (!(await exists(ffmpeg))) {
    t.diagnostic('The existing repository FFmpeg executable is unavailable; compressed fixture coverage is skipped.')
  } else {
    const encodes = [
      ['FLAC', 'source.flac', ['-c:a', 'flac']],
      ['MP3', 'source.mp3', ['-c:a', 'libmp3lame', '-b:a', '96k']],
      ['MP4 AAC', 'aac.m4a', ['-c:a', 'aac', '-b:a', '96k']],
      ['MP4 ALAC', 'alac.m4a', ['-c:a', 'alac']],
      ['AIFF', 'source.aiff', ['-c:a', 'pcm_s16be', '-f', 'aiff']],
      ['OGG', 'source.ogg', ['-c:a', 'libvorbis', '-q:a', '2']],
      ['OPUS', 'source.opus', ['-c:a', 'libopus', '-b:a', '64k']],
      ['AAC', 'source.aac', ['-c:a', 'aac', '-b:a', '96k', '-f', 'adts']],
    ]
    for (const [label, name, encoderArgs] of encodes) {
      const output = path.join(runRoot, name)
      await execFileAsync(ffmpeg, [
        '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', wav,
        '-map', '0:a:0', ...encoderArgs, output,
      ], { windowsHide: true, maxBuffer: 1024 * 1024 })
      fixtures.set(label, output)
    }
  }

  const dsd = dsdFixture()
  const dsf = path.join(runRoot, 'source.dsf')
  const dff = path.join(runRoot, 'source.dff')
  await fs.writeFile(dsf, dsd.dsf)
  await fs.writeFile(dff, dsd.dff)
  fixtures.set('DSF', dsf)
  fixtures.set('DSDIFF', dff)

  const unsupported = Object.create(null)
  if (await exists(ffmpeg)) {
    const matroska = path.join(runRoot, 'unsupported.mka')
    await execFileAsync(ffmpeg, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-i', wav,
      '-map', '0:a:0', '-c:a', 'flac', '-f', 'matroska', matroska,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 })
    unsupported.MATROSKA = matroska
  }
  return { runRoot, wav, fixtures, unsupported }
}

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

async function withTagLibFile(file, callback) {
  const taglib = await TagLib.initialize({ forceWasmType: 'wasi' })
  const audio = await taglib.open(file)
  try { return await callback(audio) }
  finally { audio.dispose() }
}

function riffData(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4)
    const size = bytes.readUInt32LE(offset + 4)
    const start = offset + 8
    const end = start + size
    assert.ok(end <= bytes.length, `RIFF ${id} chunk remains within file`)
    if (id === 'data') return bytes.subarray(start, end)
    offset = end + (size % 2)
  }
  throw new Error('WAV fixture has no data chunk')
}

test('TagLib-Wasm recognizes and writes indexed audio containers without re-encoding WAV data', async (t) => {
  const { fixtures, wav } = await makeFixtures(t)
  const expectedArtists = ['Lead Singer', 'Guest Singer', 'Choir']
  const expectedTitle = 'Synthetic metadata edit'

  for (const [label, file] of fixtures) {
    const before = await readAudioTagDocument(file)
    assert.equal(before.writable, true, `${label} is writable by the installed TagLib backend`)
    t.diagnostic(`${label}: writable=${before.writable}, canEmbed=${before.canEmbed}`)
    const fields = {
      ...before.fields,
      TITLE: [expectedTitle],
      ARTIST: expectedArtists,
      ALBUM: ['Synthetic fixture album'],
      REPLAYGAIN_TRACK_GAIN: before.fields.REPLAYGAIN_TRACK_GAIN ?? ['-5.75 dB'],
      CUSTOM_METADATA_EDITOR_TEST: ['preserve this custom value'],
    }
    const result = await writeAudioTags(file, {
      fields,
      cover: { mode: 'replace', data: frontPng, mime: 'image/png' },
    })
    assert.equal(result.coverEmbedded, before.canEmbed, `${label} reports actual embedded-cover support`)

    const after = await readAudioTagDocument(file)
    assert.deepEqual(after.fields.ARTIST, expectedArtists, `${label} retains artist order as separate values`)
    assert.deepEqual(after.fields.TITLE, [expectedTitle])
    assert.deepEqual(after.fields.CUSTOM_METADATA_EDITOR_TEST, ['preserve this custom value'])
    if (after.canEmbed) assert.deepEqual(after.cover?.data, frontPng, `${label} re-reads the embedded front cover`)
  }

  const beforeWav = await fs.readFile(wav)
  const originalPcm = riffData(beforeWav)
  const wavFields = await readAudioTagDocument(wav)
  await writeAudioTags(wav, { fields: { ...wavFields.fields, TITLE: ['Repeated save fixture'] } })
  const afterFirstSave = await fs.readFile(wav)
  assert.deepEqual(riffData(afterFirstSave), originalPcm, 'TagLib preserves the PCM data chunk byte for byte')
  const savedAgain = await readAudioTagDocument(wav)
  await writeAudioTags(wav, { fields: savedAgain.fields, cover: { mode: 'keep' } })
  assert.deepEqual(await fs.readFile(wav), afterFirstSave, 'an unchanged second save does not rewrite the file')
})

test('MP3 edits retain unknown ID3 frames, ReplayGain, and other pictures; music-metadata re-reads singers', async (t) => {
  const { fixtures } = await makeFixtures(t)
  const mp3 = fixtures.get('MP3')
  if (!mp3) return t.skip('Compressed fixtures require the existing repository FFmpeg executable')

  const backArt = Buffer.from('synthetic back-cover payload')
  const vendorFrame = Buffer.from('unmodeled vendor frame payload')
  await withTagLibFile(mp3, async (audio) => {
    assert.equal(audio.getFormat(), 'MP3')
    audio.setProperties({
      REPLAYGAIN_TRACK_GAIN: ['-7.25 dB'],
      REPLAYGAIN_TRACK_PEAK: ['0.91'],
      CUSTOM_VENDOR_TEXT: ['vendor field'],
    })
    audio.setPictures([
      { mimeType: 'image/png', data: frontPng, type: 'FrontCover', description: 'old-front' },
      { mimeType: 'image/png', data: backArt, type: 'BackCover', description: 'keep-back' },
    ])
    audio.setId3v2Frames('XABC', [vendorFrame])
    await audio.saveToFile(mp3)
  })

  const original = await readAudioTagDocument(mp3)
  const editedFields = {
    ...original.fields,
    TITLE: ['Edited title'],
    ARTIST: ['Singer One', 'Singer Two', 'Singer Three'],
  }
  await writeAudioTags(mp3, {
    fields: editedFields,
    cover: { mode: 'replace', data: frontPng, mime: 'image/png' },
  })

  const afterEdit = await readAudioTagDocument(mp3)
  assert.deepEqual(afterEdit.fields.ARTIST, ['Singer One', 'Singer Two', 'Singer Three'])
  assert.deepEqual(afterEdit.fields.REPLAYGAIN_TRACK_GAIN, ['-7.25 dB'])
  assert.deepEqual(afterEdit.fields.REPLAYGAIN_TRACK_PEAK, ['0.91'])
  assert.deepEqual(afterEdit.fields.CUSTOM_VENDOR_TEXT, ['vendor field'])
  await withTagLibFile(mp3, async (audio) => {
    const frames = audio.getId3v2Frames('XABC')
    assert.equal(frames.length, 1)
    assert.deepEqual(Buffer.from(frames[0].data), vendorFrame)
    const pictures = audio.getPictures()
    assert.ok(pictures.some((picture) => picture.type === 'BackCover' && Buffer.from(picture.data).equals(backArt)))
    assert.ok(pictures.some((picture) => picture.type === 'FrontCover' && Buffer.from(picture.data).equals(frontPng)))
  })

  const parsed = await parseFile(mp3, { duration: true })
  assert.equal(parsed.common.title, 'Edited title')
  assert.deepEqual(parsed.common.artists, ['Singer One', 'Singer Two', 'Singer Three'])
  assert.deepEqual(normalizeReplayGainTags(parsed.common), {
    trackGainDb: -7.25,
    trackPeak: 0.91,
  })

  const removed = await writeAudioTags(mp3, { fields: afterEdit.fields, cover: { mode: 'remove' } })
  assert.equal(removed.coverEmbedded, false)
  await withTagLibFile(mp3, async (audio) => {
    const pictures = audio.getPictures()
    assert.ok(!pictures.some((picture) => picture.type === 'FrontCover'))
    assert.ok(pictures.some((picture) => picture.type === 'BackCover' && Buffer.from(picture.data).equals(backArt)))
  })
})

test('unsupported containers and corrupt files are explicitly refused', async (t) => {
  const { runRoot, unsupported } = await makeFixtures(t)
  const matroska = unsupported.MATROSKA
  if (matroska) {
    const document = await readAudioTagDocument(matroska)
    assert.equal(document.writable, false)
    assert.match(document.readOnlyReason ?? '', /不支持写回/u)
    const before = await fs.readFile(matroska)
    await assert.rejects(writeAudioTags(matroska, { fields: document.fields }), /不支持写回/u)
    assert.deepEqual(await fs.readFile(matroska), before, 'unsupported container remains byte-identical')
  }

  const junk = path.join(runRoot, 'corrupt.mp3')
  const junkBytes = Buffer.from('synthetic non-audio fixture')
  await fs.writeFile(junk, junkBytes)
  await assert.rejects(readAudioTagDocument(junk), /音频|格式|TagLib|WASI|corrupt|invalid|unsupported/iu)
  await assert.rejects(writeAudioTags(junk, { fields: { TITLE: ['must not be written'] } }))
  assert.deepEqual(await fs.readFile(junk), junkBytes)
})
