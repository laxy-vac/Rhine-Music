import test from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGenreRulesJson,
  removeGenreRule,
  renameGenreRule,
  setAlbumGenreOverride,
  validateGenreRules,
} from '../src/music-genre-rules.mjs'

function specialOverrides() {
  return JSON.parse('{"__proto__":"rock","constructor":"rock","orphan-album":"jazz"}')
}

function sampleRules(albumOverrides = {}) {
  return {
    version: 1,
    genres: [
      { id: 'rock', name: ' 摇滚 ', aliases: [' Rock ', '', 'Rock', '摇滚乐'], ignored: 'legacy field' },
      { id: 'jazz', name: '爵士', aliases: ['Jazz'] },
    ],
    albumOverrides,
    ignored: true,
  }
}

test('validator canonicalizes the backend schema and safely retains every override key', () => {
  const rules = validateGenreRules(sampleRules(specialOverrides()))
  assert.deepEqual(rules, {
    version: 1,
    genres: [
      { id: 'rock', name: '摇滚', aliases: ['Rock', '摇滚乐'] },
      { id: 'jazz', name: '爵士', aliases: ['Jazz'] },
      { id: 'unclassified', name: '未分类', aliases: [] },
    ],
    albumOverrides: specialOverrides(),
  })
  assert.equal(Object.getPrototypeOf(rules.albumOverrides), Object.prototype)
  assert.equal(Object.hasOwn(rules.albumOverrides, '__proto__'), true)
  assert.equal(rules.albumOverrides.__proto__, 'rock')
})

test('validator enforces required schema and rule values', () => {
  assert.throws(() => validateGenreRules({ ...sampleRules(), version: 2 }), /version:1/)
  assert.throws(() => validateGenreRules({ version: 1, genres: [{ id: 'bad id', name: 'Bad' }], albumOverrides: {} }), /ID/)
  assert.throws(() => validateGenreRules({ version: 1, genres: [{ id: 'rock', name: 'Rock' }, { id: 'rock', name: 'Other' }], albumOverrides: {} }), /ID/)
  assert.throws(() => validateGenreRules({ version: 1, genres: [{ id: 'rock', name: 'Rock', aliases: ['ok', 2] }], albumOverrides: {} }), /别名/)
  assert.throws(() => validateGenreRules({ version: 1, genres: [{ id: 'rock', name: 'Rock' }], albumOverrides: { album: 'missing' } }), /不存在/)
})

test('strict JSON parser round-trips the full canonical schema and rejects unknown fields', () => {
  const canonical = validateGenreRules(sampleRules(specialOverrides()))
  assert.deepEqual(parseGenreRulesJson(JSON.stringify(canonical)), canonical)
  assert.throws(() => parseGenreRulesJson('{"version":1,"genres":[],"albumOverrides":{},"future":true}'), /未知顶层字段/)
  assert.throws(() => parseGenreRulesJson('{"version":1,"genres":[{"id":"rock","name":"Rock","albumCount":4}],"albumOverrides":{}}'), /未知字段.*albumCount/)
  assert.throws(() => parseGenreRulesJson('{"version":1,'), SyntaxError)
})

test('renaming preserves order and migrates live, orphaned, and special-key overrides without mutating input', () => {
  const original = validateGenreRules(sampleRules(specialOverrides()))
  const before = JSON.stringify(original)
  const renamed = renameGenreRule(original, 'rock', 'alt-rock')

  assert.deepEqual(renamed.genres.map((genre) => genre.id), ['alt-rock', 'jazz', 'unclassified'])
  assert.equal(renamed.albumOverrides.__proto__, 'alt-rock')
  assert.equal(renamed.albumOverrides.constructor, 'alt-rock')
  assert.equal(renamed.albumOverrides['orphan-album'], 'jazz')
  assert.equal(JSON.stringify(original), before)
  assert.throws(() => renameGenreRule(original, 'rock', 'jazz'), /已存在/)
  assert.throws(() => renameGenreRule(original, 'rock', 'bad id'), /ID/)
  assert.throws(() => renameGenreRule(original, 'unclassified', 'other'), /不能更改/)
})

test('removing a referenced genre requires and applies a valid replacement', () => {
  const original = validateGenreRules({
    version: 1,
    genres: [{ id: 'rock', name: '摇滚' }, { id: 'jazz', name: '爵士' }],
    albumOverrides: specialOverrides(),
  })
  const before = JSON.stringify(original)

  assert.throws(() => removeGenreRule(original, 'rock'), /替代流派/)
  const removed = removeGenreRule(original, 'rock', 'jazz')
  assert.deepEqual(removed.genres.map((genre) => genre.id), ['jazz', 'unclassified'])
  assert.equal(removed.albumOverrides.__proto__, 'jazz')
  assert.equal(removed.albumOverrides.constructor, 'jazz')
  assert.equal(JSON.stringify(original), before)
  assert.throws(() => removeGenreRule(original, 'rock', 'unclassified-missing'), /无效/)
  assert.throws(() => removeGenreRule(original, 'unclassified'), /不能删除/)
})

test('manual override edits trim new album keys, support special keys, and delete back to automatic', () => {
  const original = validateGenreRules({ version: 1, genres: [{ id: 'rock', name: '摇滚' }], albumOverrides: {} })
  const assigned = setAlbumGenreOverride(original, ' album-1 ', 'rock')
  const special = setAlbumGenreOverride(assigned, '__proto__', 'unclassified')

  assert.equal(special.albumOverrides['album-1'], 'rock')
  assert.equal(Object.hasOwn(special.albumOverrides, '__proto__'), true)
  assert.equal(special.albumOverrides.__proto__, 'unclassified')
  assert.equal(Object.hasOwn(setAlbumGenreOverride(special, '__proto__', undefined).albumOverrides, '__proto__'), false)
  assert.equal(Object.keys(original.albumOverrides).length, 0)
  assert.throws(() => setAlbumGenreOverride(original, '  ', 'rock'), /不能为空/)
  assert.throws(() => setAlbumGenreOverride(original, 'album-2', 'missing'), /不存在/)
})

test('legacy whitespace and empty override keys remain editable and removable by exact identity', () => {
  const rules = validateGenreRules({ version: 1, genres: [{ id: 'rock', name: 'Rock' }], albumOverrides: JSON.parse('{"":"rock","  legacy  ":"rock"}') })
  const edited = setAlbumGenreOverride(rules, '  legacy  ', 'unclassified')
  assert.equal(edited.albumOverrides['  legacy  '], 'unclassified')
  assert.equal(Object.hasOwn(edited.albumOverrides, 'legacy'), false)
  const removed = setAlbumGenreOverride(edited, '', undefined)
  assert.equal(Object.hasOwn(removed.albumOverrides, ''), false)
  assert.equal(Object.hasOwn(rules.albumOverrides, ''), true)
})

test('the genre limit includes the automatic fallback and yields reloadable canonical rules', () => {
  const genres = Array.from({ length: 999 }, (_, i) => ({ id: `g-${i}`, name: `Genre ${i}` }))
  const rules = validateGenreRules({ version: 1, genres, albumOverrides: {} })
  assert.equal(rules.genres.length, 1000)
  assert.deepEqual(validateGenreRules(rules), rules)
  assert.throws(() => validateGenreRules({ version: 1, genres: [...genres, { id: 'last', name: 'Last' }], albumOverrides: {} }), /1000/)
})
