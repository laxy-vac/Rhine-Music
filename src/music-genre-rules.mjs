const GENRE_ID_PATTERN = /^[\w-]{1,100}$/
const text = (value) => typeof value === 'string' ? value.trim() : ''
const unique = (values) => [...new Set(values.filter(Boolean))]
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)

function setOwn(record, key, value) {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

export function validateGenreRules(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.genres) || value.genres.length > 1000 || !value.albumOverrides || typeof value.albumOverrides !== 'object' || Array.isArray(value.albumOverrides)) {
    throw new Error('流派规则需要 version:1、genres 数组和 albumOverrides 对象')
  }

  const ids = new Set()
  const genres = value.genres.map((genre) => {
    if (!genre || typeof genre.id !== 'string' || !GENRE_ID_PATTERN.test(genre.id) || ids.has(genre.id) || !text(genre.name) || (genre.aliases !== undefined && (!Array.isArray(genre.aliases) || genre.aliases.some((alias) => typeof alias !== 'string')))) {
      throw new Error('流派 ID 必须唯一，名称和别名必须为文本')
    }
    ids.add(genre.id)
    return { id: genre.id, name: text(genre.name), aliases: unique((genre.aliases ?? []).map(text)) }
  })

  if (!ids.has('unclassified')) {
    if (genres.length >= 1000) throw new Error('最多 1000 个流派，包含未分类保留项')
    genres.push({ id: 'unclassified', name: '未分类', aliases: [] })
  }
  ids.add('unclassified')

  const albumOverrides = {}
  for (const [id, genreId] of Object.entries(value.albumOverrides)) {
    if (!ids.has(genreId)) throw new Error(`专辑 ${id} 的人工流派 ${genreId} 不存在`)
    setOwn(albumOverrides, id, genreId)
  }

  return { version: 1, genres, albumOverrides }
}

export function parseGenreRulesJson(source) {
  if (typeof source !== 'string') throw new Error('流派规则 JSON 必须是文本')
  const value = JSON.parse(source)
  const allowedTopLevel = new Set(['version', 'genres', 'albumOverrides'])
  const allowedGenreFields = new Set(['id', 'name', 'aliases'])

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (!allowedTopLevel.has(key)) throw new Error(`流派规则包含未知顶层字段：${key}`)
    }
    if (Array.isArray(value.genres)) {
      for (let index = 0; index < value.genres.length; index += 1) {
        const genre = value.genres[index]
        if (!genre || typeof genre !== 'object' || Array.isArray(genre)) continue
        for (const key of Object.keys(genre)) {
          if (!allowedGenreFields.has(key)) throw new Error(`第 ${index + 1} 个流派包含未知字段：${key}`)
        }
      }
    }
  }

  return validateGenreRules(value)
}

export function renameGenreRule(rules, oldId, newId) {
  const next = validateGenreRules(rules)
  const index = next.genres.findIndex((genre) => genre.id === oldId)
  if (index < 0) throw new Error(`流派 ${oldId} 不存在`)
  if (oldId === 'unclassified' && newId !== 'unclassified') throw new Error('不能更改未分类流派的 ID')
  if (typeof newId !== 'string' || !GENRE_ID_PATTERN.test(newId)) throw new Error('流派 ID 必须为 1 到 100 个字母、数字、下划线或连字符')
  if (next.genres.some((genre, genreIndex) => genreIndex !== index && genre.id === newId)) throw new Error(`流派 ID ${newId} 已存在`)
  if (oldId === newId) return next

  next.genres[index] = { ...next.genres[index], id: newId }
  const migrated = {}
  for (const [albumId, genreId] of Object.entries(next.albumOverrides)) {
    setOwn(migrated, albumId, genreId === oldId ? newId : genreId)
  }
  next.albumOverrides = migrated
  return next
}

export function removeGenreRule(rules, id, replacementId) {
  const next = validateGenreRules(rules)
  if (id === 'unclassified') throw new Error('不能删除未分类流派')
  const index = next.genres.findIndex((genre) => genre.id === id)
  if (index < 0) throw new Error(`流派 ${id} 不存在`)

  const remaining = next.genres.filter((genre) => genre.id !== id)
  const references = Object.values(next.albumOverrides).some((genreId) => genreId === id)
  if (replacementId !== undefined) {
    if (typeof replacementId !== 'string' || replacementId === id || !remaining.some((genre) => genre.id === replacementId)) {
      throw new Error(`替代流派 ${replacementId} 不存在或无效`)
    }
  } else if (references) {
    throw new Error(`仍有专辑使用流派 ${id}，请先选择替代流派`)
  }

  next.genres = remaining
  if (replacementId !== undefined && references) {
    const migrated = {}
    for (const [albumId, genreId] of Object.entries(next.albumOverrides)) {
      setOwn(migrated, albumId, genreId === id ? replacementId : genreId)
    }
    next.albumOverrides = migrated
  }
  return next
}

export function setAlbumGenreOverride(rules, albumId, genreIdOrUndefined) {
  const next = validateGenreRules(rules)
  if (typeof albumId !== 'string') throw new Error('专辑 ID 必须是文本')
  // Existing JSON keys are opaque identities, including legacy whitespace keys.
  // New GUI entries must be nonempty; editing/removing an existing key is exact.
  const key = hasOwn(next.albumOverrides, albumId) ? albumId : albumId.trim()
  if (!key && !hasOwn(next.albumOverrides, key)) throw new Error('专辑 ID 不能为空')

  if (genreIdOrUndefined === undefined) {
    if (hasOwn(next.albumOverrides, key)) delete next.albumOverrides[key]
    return next
  }

  if (typeof genreIdOrUndefined !== 'string' || !next.genres.some((genre) => genre.id === genreIdOrUndefined)) {
    throw new Error(`流派 ${genreIdOrUndefined} 不存在`)
  }
  setOwn(next.albumOverrides, key, genreIdOrUndefined)
  return next
}
