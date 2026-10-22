// Shared read-time classification rules. This module never changes audio tags.
const CREDIT_FIELDS = new Set(['ARTIST', 'ALBUMARTIST'])
const OPEN = new Map([['(', ')'], ['[', ']'], ['{', '}'], ['（', '）'], ['【', '】'], ['《', '》']])
const CLOSE = new Set(OPEN.values())
const MAX_PARTS = 256
const hasHan = value => /\p{Script=Han}/u.test(value)
const key = value => value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const bandNames = [
  'AC/DC', 'Simon & Garfunkel', 'Hall & Oates', 'Sly & the Family Stone',
  'The Mamas & the Papas', 'Gerry & the Pacemakers', 'Florence + the Machine',
  'Earth, Wind & Fire', 'Mumford & Sons', 'Nick Cave & the Bad Seeds',
  'MAN WITH A MISSION', 'She & Him', 'Dan + Shay',
]
const namePattern = names => new RegExp('(?<![\\p{L}\\p{N}])(?:' + [...names].sort((a, b) => b.length - a.length).map(name =>
  name.split(/([&+/])/u).map(part => /^[&+/]$/u.test(part)
    ? '\\s*' + ({ '&': '[&＆]', '+': '[+＋]', '/': '[/／]' })[part] + '\\s*'
    : escape(part.trim()).replace(/ +/g, '\\s+')).join(''),
).join('|') + ')(?![\\p{L}\\p{N}])', 'giu')
const bandPattern = namePattern(bandNames)
const genrePattern = namePattern(['R&B/Soul', 'Hip-Hop/Rap', 'Hip Hop/Rap', 'R&B', 'D&B', 'Drum & Bass', 'Rhythm & Blues', 'Rock & Roll', 'Country & Western'])
const feature = /^(?:(?:feat|ft)\.(?=\s|[^\p{Script=Latin}])\s*|(?:featuring|feat|ft|with)\s+)/iu

function protectedRanges(value, field) {
  return [...value.matchAll(field === 'GENRE' ? genrePattern : bandPattern)].map(match => [match.index, match.index + match[0].length])
}

function closingIndex(value, start) {
  const stack = []
  for (let i = start; i < value.length; i++) {
    if (OPEN.has(value[i])) stack.push(OPEN.get(value[i]))
    else if (value[i] === stack.at(-1)) {
      stack.pop()
      if (!stack.length) return i
    }
  }
  return -1
}

function splitPass(value, field, strong) {
  const parts = [], stack = []
  const protectedNames = protectedRanges(value, field)
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (OPEN.has(char)) { stack.push(OPEN.get(char)); continue }
    if (CLOSE.has(char)) { if (char === stack.at(-1)) stack.pop(); continue }
    if (stack.length || protectedNames.some(([a, b]) => i >= a && i < b)) continue
    const hardSeparator = /[;；、，|｜\r\n]/u.test(char)
    if (strong ? !(hardSeparator || char === ',' || (field !== 'GENRE' && /[fwtx×]/iu.test(char) && !/[a-z0-9]/iu.test(value[i - 1] ?? '')))
      : !/[/／&＆+＋]/u.test(char)) continue
    const left = value.slice(start, i).trim(), right = value.slice(i + 1).trim()
    if ((!left || !right) && !hardSeparator) continue
    let length = 0
    if (strong) {
      if (hardSeparator) length = 1
      else if (char === ',' && (field === 'GENRE' || hasHan(left) || hasHan(right))) length = 1
      if (!length && field !== 'GENRE' && (i === 0 || !/[a-z0-9]/iu.test(value[i - 1]))) {
        const marker = feature.exec(value.slice(i))
        if (marker && value.slice(i + marker[0].length).trim()) length = marker[0].length
        else if (/^[x×]\s/iu.test(value.slice(i)) && /\s/u.test(value[i - 1] ?? '')) length = 1
      }
    } else if (char === '/' || char === '／') {
      if (field === 'GENRE') length = 1
      else {
        const padded = /\s/u.test(value[i - 1] ?? '') || /\s/u.test(value[i + 1] ?? '')
        const compactUppercase = /^[\p{Lu}\p{N}.-]{1,4}$/u.test(left) && /^[\p{Lu}\p{N}.-]{1,4}$/u.test(right)
        if (padded || hasHan(left) || hasHan(right) || (!compactUppercase && /\p{Ll}/u.test(left + right))) length = 1
      }
    } else if (/[&＆+＋]/u.test(char)) {
      const padded = /\s/u.test(value[i - 1] ?? '') || /\s/u.test(value[i + 1] ?? '')
      // A Latin comma may be a surname or part of a band name.
      if (!value.includes(',') && (padded || (field !== 'GENRE' && (hasHan(left) || hasHan(right))))) length = 1
    }
    if (!length) continue
    parts.push(value.slice(start, i).trim())
    if (parts.length >= MAX_PARTS) return [value]
    start = i + length
    i = start - 1
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

function splitOne(value, field, depth = 0) {
  const raw = value.trim()
  if (!raw) return []
  if (depth > 8 || raw.length > 8192) return [raw]
  if (field !== 'GENRE') {
    for (let i = 1; i < raw.length; i++) {
      if (!OPEN.has(raw[i]) || closingIndex(raw, i) !== raw.length - 1) continue
      const inner = raw.slice(i + 1, -1).trimStart()
      const marker = feature.exec(inner)
      if (marker && inner.slice(marker[0].length).trim()) return [
        ...splitOne(raw.slice(0, i), field, depth + 1),
        ...splitOne(inner.slice(marker[0].length), field, depth + 1),
      ]
    }
  }
  const strong = splitPass(raw, field, true)
  return strong.flatMap(part => splitPass(part, field, false))
}

export function splitMusicMetadataValues(field, input) {
  const values = typeof input === 'string' ? [input] : Array.isArray(input) ? input.filter(value => typeof value === 'string') : []
  const name = String(field).toUpperCase()
  if (!CREDIT_FIELDS.has(name) && name !== 'GENRE') return [...values]
  const split = values.flatMap(value => splitOne(value, name))
  const selected = split.length > MAX_PARTS ? values.map(value => value.trim()).filter(Boolean) : split
  const seen = new Set()
  return selected.filter(value => { const normalized = key(value); if (seen.has(normalized)) return false; seen.add(normalized); return true })
}
