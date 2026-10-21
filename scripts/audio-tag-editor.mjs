import { promises as fs } from 'node:fs'
import path from 'node:path'
import { PROPERTIES, TagLib } from 'taglib-wasm'

// This module only edits the path supplied by its caller. The application must
// authorize the real track, create a staging copy, and atomically install it.
// Path-based TagLib-Wasm calls use its Node WASI backend and avoid reading the
// audio payload into a JavaScript Buffer, which matters for large DSD files.

const MAX_COVER_BYTES = 30 * 1024 * 1024
const WRITABLE_FORMATS = new Set([
  'FLAC', 'MP3', 'MP4', 'WAV', 'AIFF', 'OGG', 'OPUS', 'DSF', 'DSDIFF', 'AAC',
])
const PICTURE_FORMATS = new Set([
  'FLAC', 'MP3', 'MP4', 'WAV', 'AIFF', 'OGG', 'OPUS', 'DSF', 'DSDIFF', 'AAC',
])
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let tagLibPromise

async function getTagLib() {
  if (!tagLibPromise) {
    tagLibPromise = TagLib.initialize({ forceWasmType: 'wasi' }).catch((error) => {
      tagLibPromise = undefined
      throw new Error(`无法初始化 taglib-wasm 的 Node WASI 后端：${error.message}`, { cause: error })
    })
  }
  return tagLibPromise
}

async function checkedAudioPath(file) {
  if (typeof file !== 'string' || !file.trim()) throw new TypeError('音频路径必须是非空字符串')
  const absolute = path.resolve(file)
  const info = await fs.lstat(absolute)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error('音频暂存目标必须是普通文件，不能是符号链接或目录')
  return absolute
}

function formatCapability(format) {
  const writable = WRITABLE_FORMATS.has(format)
  return {
    writable,
    canEmbed: writable && PICTURE_FORMATS.has(format),
    ...(writable ? {} : { readOnlyReason: `taglib-wasm 不支持写回 ${format || '未知'} 音频容器` }),
  }
}

function propertyMapToWire(properties) {
  const fields = Object.create(null)
  for (const [key, values] of Object.entries(properties ?? {})) {
    if (!Array.isArray(values)) continue
    const wireKey = PROPERTIES[key]?.key ?? key
    fields[wireKey] = values.map((value) => String(value))
  }
  return fields
}

function normalizeFields(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('fields 必须是 TagLib property map 对象')
  }
  const entries = Object.entries(value)
  if (entries.length > 4096) throw new Error('标签字段数量过多')
  const fields = Object.create(null)
  let totalTextBytes = 0
  for (const [inputKey, inputValues] of entries) {
    if (typeof inputKey !== 'string' || !inputKey.trim() || inputKey.length > 256 || /[\0\r\n]/u.test(inputKey)) {
      throw new Error('标签字段名无效')
    }
    if (!Array.isArray(inputValues) || inputValues.length > 256 || inputValues.some((item) => typeof item !== 'string')) {
      throw new Error(`标签 ${inputKey} 的值必须是有序文本数组`)
    }
    const wireKey = PROPERTIES[inputKey]?.key ?? inputKey
    if (Object.hasOwn(fields, wireKey)) throw new Error(`重复的标签字段：${wireKey}`)
    const values = inputValues.slice()
    for (const item of values) {
      totalTextBytes += Buffer.byteLength(item, 'utf8')
      if (totalTextBytes > 8 * 1024 * 1024) throw new Error('标签文本总量超过 8 MiB')
    }
    fields[wireKey] = values
  }
  return fields
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function mimeFromData(data) {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return 'image/png'
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

function normalizeCover(cover) {
  if (cover === undefined) return { mode: 'keep' }
  if (!cover || typeof cover !== 'object' || Array.isArray(cover)) throw new TypeError('cover 必须是封面操作对象')
  if (!['keep', 'replace', 'remove'].includes(cover.mode)) throw new Error('cover.mode 必须是 keep、replace 或 remove')
  if (cover.mode !== 'replace') return { mode: cover.mode }
  if (!Buffer.isBuffer(cover.data) && !(cover.data instanceof Uint8Array)) {
    throw new TypeError('替换封面需要 Buffer 或 Uint8Array 图片数据')
  }
  const data = Buffer.from(cover.data)
  if (!data.length || data.length > MAX_COVER_BYTES) throw new Error('封面图片必须大于 0 字节且不超过 30 MiB')
  const requestedMime = String(cover.mime ?? '').toLowerCase()
  const mimeType = requestedMime === 'image/jpg' ? 'image/jpeg' : requestedMime
  if (!MIME_EXTENSIONS.has(requestedMime) || !MIME_EXTENSIONS.has(mimeType)) {
    throw new Error('封面只支持 JPEG、PNG 或 WebP 图片')
  }
  if (mimeFromData(data) !== mimeType) throw new Error('封面图片内容与 MIME 类型不匹配')
  return { mode: 'replace', data, mimeType }
}

function pictureDocument(pictures) {
  const picture = pictures.find((item) => item.type === 'FrontCover') ?? pictures[0]
  if (!picture?.data?.length) return undefined
  const mime = String(picture.mimeType || '').toLowerCase()
  if (!MIME_EXTENSIONS.has(mime)) return undefined
  return { data: Buffer.from(picture.data), mime: mime === 'image/jpg' ? 'image/jpeg' : mime }
}

async function openAudio(file) {
  const absolute = await checkedAudioPath(file)
  const tagLib = await getTagLib()
  const audio = await tagLib.open(absolute)
  if (!audio.isValid()) {
    audio.dispose()
    throw new Error('音频容器无效或损坏，已拒绝读取/写入')
  }
  return { absolute, audio }
}

export async function readAudioTagDocument(file) {
  const { audio } = await openAudio(file)
  try {
    const format = audio.getFormat()
    const capability = formatCapability(format)
    let pictures = []
    let canEmbed = capability.canEmbed
    if (canEmbed) {
      try {
        pictures = audio.getPictures()
      } catch {
        canEmbed = false
      }
    }
    const cover = pictureDocument(pictures)
    return {
      fields: propertyMapToWire(audio.properties()),
      ...(cover ? { cover } : {}),
      canEmbed,
      writable: capability.writable,
      ...(capability.readOnlyReason ? { readOnlyReason: capability.readOnlyReason } : {}),
    }
  } finally {
    audio.dispose()
  }
}

export async function writeAudioTags(file, { fields, cover } = {}) {
  const desired = normalizeFields(fields)
  const coverOperation = normalizeCover(cover)
  const { absolute, audio } = await openAudio(file)
  try {
    const format = audio.getFormat()
    const capability = formatCapability(format)
    if (!capability.writable) throw new Error(capability.readOnlyReason)

    const current = propertyMapToWire(audio.properties())
    const patch = Object.create(null)
    const keys = new Set([...Object.keys(current), ...Object.keys(desired)])
    for (const key of keys) {
      const before = current[key] ?? []
      const after = desired[key] ?? []
      if (!sameValues(before, after)) patch[key] = after
    }

    let picturesChanged = false
    let coverEmbedded = false
    if (coverOperation.mode === 'keep') {
      if (capability.canEmbed) {
        try { coverEmbedded = audio.getPictures().some((item) => item.type === 'FrontCover') }
        catch { coverEmbedded = false }
      }
    } else if (capability.canEmbed) {
      const pictures = audio.getPictures()
      if (coverOperation.mode === 'replace') {
        const previousFront = pictures.find((item) => item.type === 'FrontCover')
        const replacement = {
          mimeType: coverOperation.mimeType,
          data: new Uint8Array(coverOperation.data),
          type: 'FrontCover',
          description: previousFront?.description ?? '',
        }
        audio.setPictures([...pictures.filter((item) => item.type !== 'FrontCover'), replacement])
        picturesChanged = true
        coverEmbedded = true
      } else {
        const remaining = pictures.filter((item) => item.type !== 'FrontCover')
        picturesChanged = remaining.length !== pictures.length
        if (picturesChanged) audio.setPictures(remaining)
        coverEmbedded = false
      }
    }

    const fieldsChanged = Object.keys(patch).length > 0
    if (fieldsChanged) audio.setProperties(patch)
    if (fieldsChanged || picturesChanged) await audio.saveToFile(absolute)
    return { coverEmbedded }
  } finally {
    audio.dispose()
  }
}
