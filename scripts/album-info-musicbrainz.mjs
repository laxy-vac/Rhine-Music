const API_ROOT = 'https://musicbrainz.org/ws/2/'
const RELEASE_GROUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RESULTS = 20
const MAX_ANNOTATION_LENGTH = 6000

const cleanText = (value, limit = 512) => typeof value === 'string'
  ? value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, limit)
  : ''

export function escapeLucene(value) {
  return String(value).replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, '\\$&')
}

function apiUrl(path, params = {}) {
  const url = new URL(path, API_ROOT)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('fmt', 'json')
  return url
}

function releaseGroupUrl(id) {
  return `https://musicbrainz.org/release-group/${id}`
}

function detailsUrl(id) {
  return apiUrl(`release-group/${id}`, { inc: 'artists+releases+genres+url-rels' })
}

function artistCreditName(credits) {
  if (!Array.isArray(credits)) return ''
  return credits.map((credit) => {
    if (!credit || typeof credit !== 'object') return ''
    const name = cleanText(credit.name ?? credit.artist?.name, 256)
    const joinphrase = typeof credit.joinphrase === 'string' ? credit.joinphrase.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 64) : ''
    return `${name}${joinphrase}`
  }).join('').trim()
}

function yearFromDate(value) {
  const match = /^(\d{4})(?:-\d{2}(?:-\d{2})?)?$/.exec(cleanText(value, 32))
  return match ? Number(match[1]) : undefined
}

function annotationText(value) {
  return cleanText(value, MAX_ANNOTATION_LENGTH)
    .replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1')
    .replace(/\[([^\s\]|]+)\|([^\]]+)\]/g, '$2')
    .trim()
}

function genreNames(group) {
  const rows = Array.isArray(group?.genres) ? group.genres : []
  return [...new Set(rows
    .filter((genre) => genre && typeof genre === 'object')
    .sort((a, b) => Number(b.count ?? 0) - Number(a.count ?? 0))
    .map((genre) => cleanText(genre.name, 80))
    .filter(Boolean))].slice(0, 5)
}

function firstReleaseDate(group) {
  const direct = cleanText(group?.['first-release-date'], 32)
  if (direct) return direct
  const releases = Array.isArray(group?.releases) ? group.releases : []
  return releases.map((release) => cleanText(release?.date, 32)).filter(Boolean).sort()[0] ?? ''
}

function factDescription(candidate, group) {
  const artist = artistCreditName(group?.['artist-credit']) || cleanText(candidate.artist, 512)
  const date = firstReleaseDate(group) || (Number.isInteger(candidate.year) ? String(candidate.year) : '')
  const type = cleanText(group?.['primary-type'] ?? group?.type, 80)
  const genres = genreNames(group)
  const facts = []
  if (artist) facts.push(`艺人：${artist}`)
  if (date) facts.push(`首次发行：${date}`)
  if (type) facts.push(`类型：${type}`)
  if (genres.length) facts.push(`MusicBrainz 风格标签：${genres.join('、')}`)
  return facts.length ? `发行资料：${facts.join('；')}。` : ''
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

export class MusicBrainzAlbumSource {
  constructor({ requestJson, contact, request } = {}) {
    const transport = typeof request === 'function' ? request : requestJson
    if (typeof transport !== 'function') throw new TypeError('requestJson must be a function')
    this.requestJson = transport
    this.contact = contact
  }

  async json(url, signal) {
    abortIfNeeded(signal)
    const contact = cleanText(typeof this.contact === 'function' ? this.contact() : this.contact, 500)
    if (!contact) {
      throw new Error('请先配置 MusicBrainz 联系邮箱或项目网址')
    }
    const data = await this.requestJson(url, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `RhineLocalMusic/0.2 (${contact})`,
      },
    })
    abortIfNeeded(signal)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('MusicBrainz 返回了无效 JSON')
    if (data.error) throw new Error(`MusicBrainz: ${cleanText(typeof data.error === 'string' ? data.error : data.error.message, 500) || 'API error'}`)
    return data
  }

  async search({ title, artist } = {}, signal) {
    const wantedTitle = cleanText(title, 512)
    const wantedArtist = cleanText(artist, 512)
    if (!wantedTitle) throw new Error('请先提供专辑名称')

    const clauses = [`releasegroup:"${escapeLucene(wantedTitle)}"`]
    if (wantedArtist) clauses.push(`artist:"${escapeLucene(wantedArtist)}"`)
    const data = await this.json(apiUrl('release-group/', {
      query: clauses.join(' AND '),
      limit: String(MAX_RESULTS),
    }), signal)
    if (!Array.isArray(data['release-groups'])) throw new Error('MusicBrainz 没有返回专辑候选列表')

    return data['release-groups'].slice(0, MAX_RESULTS).flatMap((group) => {
      const id = cleanText(group?.id, 64)
      const groupTitle = cleanText(group?.title, 512)
      if (!RELEASE_GROUP_ID.test(id) || !groupTitle) return []
      const artistName = artistCreditName(group['artist-credit'])
      const date = cleanText(group['first-release-date'], 32)
      return [{
        title: groupTitle,
        artist: artistName,
        ...(yearFromDate(date) ? { year: yearFromDate(date) } : {}),
        url: releaseGroupUrl(id),
        cache: { rawId: id, detailsUrl: detailsUrl(id) },
      }]
    })
  }

  async resolve(entry, signal) {
    const candidate = entry?.candidate
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError('MusicBrainz candidate entry is required')
    }
    const id = cleanText(entry.rawId ?? entry.cache?.rawId, 64)
    if (!RELEASE_GROUP_ID.test(id)) throw new Error('无效的 MusicBrainz Release Group ID')

    const group = await this.json(detailsUrl(id), signal)
    if (group.id && group.id.toLowerCase() !== id.toLowerCase()) throw new Error('MusicBrainz 返回的专辑编号不匹配')

    let annotation = ''
    try {
      const data = await this.json(apiUrl('annotation/', {
        query: `entity:${id}`,
        limit: '5',
      }), signal)
      const match = (Array.isArray(data.annotations) ? data.annotations : [])
        .find((item) => String(item?.entity ?? '').toLowerCase() === id.toLowerCase())
      annotation = annotationText(match?.text)
    } catch (error) {
      abortIfNeeded(signal)
      // An annotation is optional. Keep a factual release summary usable if this
      // separate search resource is unavailable or has no entry for the group.
    }

    const date = firstReleaseDate(group)
    const artist = artistCreditName(group['artist-credit']) || cleanText(candidate.artist, 512)
    const year = yearFromDate(date) ?? yearFromDate(String(candidate.year ?? ''))
    const description = annotation
      ? `MusicBrainz 注释：${annotation}`
      : factDescription({ ...candidate, artist }, group)

    return {
      ...candidate,
      title: cleanText(group.title, 512) || cleanText(candidate.title, 512),
      artist,
      ...(year ? { year } : {}),
      ...(description ? { description } : {}),
      url: releaseGroupUrl(id),
      license: 'MusicBrainz 数据许可（以来源页为准）',
    }
  }
}
