import assert from 'node:assert/strict'
import { MusicBrainzAlbumSource, escapeLucene } from './album-info-musicbrainz.mjs'

const mbid = '3bd76d40-7f0e-36b7-9348-91a33afee20e'
const requests = []
let annotationResponse = { annotations: [] }

const requestJson = async (url, options) => {
  const parsed = new URL(url)
  requests.push({ url: parsed, options })
  if (parsed.pathname === '/ws/2/release-group/') {
    return {
      'release-groups': [{
        id: mbid,
        score: '100',
        title: 'The Example Album',
        'first-release-date': '2001-06-12',
        'primary-type': 'Album',
        'artist-credit': [{ artist: { name: 'Example Artist' }, name: 'Example Artist' }],
      }],
    }
  }
  if (parsed.pathname === `/ws/2/release-group/${mbid}`) {
    return {
      id: mbid,
      title: 'The Example Album',
      'first-release-date': '2001-06-12',
      'primary-type': 'Album',
      'artist-credit': [{ artist: { name: 'Example Artist' }, name: 'Example Artist' }],
      genres: [{ name: 'alternative rock', count: 8 }, { name: 'rock', count: 4 }],
      relations: [{ type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Example_Album' } }],
    }
  }
  if (parsed.pathname === '/ws/2/annotation/') return annotationResponse
  throw new Error(`Unexpected URL: ${parsed.href}`)
}

const source = new MusicBrainzAlbumSource({ requestJson, contact: 'tester@example.invalid' })
const items = await source.search({ title: 'The Example Album', artist: 'Example Artist' })
assert.equal(items.length, 1)
assert.equal(items[0].title, 'The Example Album')
assert.equal(items[0].artist, 'Example Artist')
assert.equal(items[0].year, 2001)
assert.equal(items[0].url, `https://musicbrainz.org/release-group/${mbid}`)
assert.equal(items[0].cache.rawId, mbid)
assert.ok(items[0].cache.detailsUrl instanceof URL)
assert.equal(requests[0].url.searchParams.get('query'), 'releasegroup:"The Example Album" AND artist:"Example Artist"')
assert.equal(requests[0].url.searchParams.get('limit'), '20')
assert.equal(requests[0].url.searchParams.get('fmt'), 'json')
assert.equal(requests[0].options.headers['User-Agent'], 'RhineLocalMusic/0.2 (tester@example.invalid)')
assert.equal(Object.hasOwn(requests[0].options.headers, 'Authorization'), false)
assert.equal(items[0].cache.detailsUrl.searchParams.get('inc'), 'artists+releases+genres+url-rels')
assert.equal(items[0].cache.detailsUrl.searchParams.has('annotations'), false)

annotationResponse = {
  annotations: [{
    type: 'release-group', entity: mbid, name: 'The Example Album',
    text: 'Recorded at [[Example Studio|the studio]].',
  }],
}
const annotated = await source.resolve({ rawId: mbid, candidate: items[0] })
assert.equal(annotated.description, 'MusicBrainz 注释：Recorded at the studio.')
const annotationRequest = requests.at(-1)
assert.equal(annotationRequest.url.pathname, '/ws/2/annotation/')
assert.equal(annotationRequest.url.searchParams.get('query'), `entity:${mbid}`)

annotationResponse = { annotations: [] }
const factual = await source.resolve({ rawId: mbid, candidate: items[0] })
assert.match(factual.description, /^发行资料：/)
assert.match(factual.description, /艺人：Example Artist/)
assert.match(factual.description, /首次发行：2001-06-12/)
assert.match(factual.description, /类型：Album/)
assert.match(factual.description, /MusicBrainz 风格标签：alternative rock、rock/)

requests.length = 0
await source.search({ title: 'A + (B)', artist: '' })
const titleOnlyQuery = requests[0].url.searchParams.get('query')
assert.equal(titleOnlyQuery, 'releasegroup:"A \\+ \\(B\\)"')
assert.equal(escapeLucene('A + (B)'), 'A \\+ \\(B\\)')

await assert.rejects(
  source.resolve({ rawId: 'not-an-mbid', candidate: items[0] }),
  /无效的 MusicBrainz Release Group ID/,
)

console.log('MusicBrainz album source mock checks passed.')
