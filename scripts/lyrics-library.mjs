import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeJsonAtomic } from './music-library.mjs';
import { isFullyQualified } from './platform.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const builtins = [{ id: 'netease', name: '网易云音乐', builtin: true, enabled: true }, { id: 'qq', name: 'QQ 音乐', builtin: true, enabled: true }];
const AUTO_SOURCE_ID = 'auto';
const LYRIC_KINDS = ['cloud', 'local'];
const MAX_LYRIC_DOCUMENT_BYTES = 256 * 1024;
const MAX_LYRIC_CONTAINER_BYTES = 512 * 1024 + 4096;
const mappingDefaults = { results: 'results', id: 'id', title: 'title', artist: 'artist', album: 'album', duration: 'duration', lrc: 'lrc', translation: 'translation' };
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const clean = (value, limit = 256) => typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\0/g, '').trim().slice(0, limit) : '';
const songText = value => typeof value === 'string' ? clean(value) : Array.isArray(value) ? value.map(entry => clean(typeof entry === 'string' ? entry : entry?.name)).filter(Boolean).join(' / ') : clean(value?.name ?? value?.title);
const hash = value => createHash('sha256').update(value).digest('hex');
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const uniqueDirectories = values => [...new Map(values.map(value => [pathKey(value), value])).values()];
const cjkRun = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const latinAliasPrefix = /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{S}\s]+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/u;

function artistForSearch(value) {
  const artist = songText(value);
  if (!latinAliasPrefix.test(artist)) return artist;
  return artist.match(cjkRun)?.join(' ') || artist;
}

function builtInKeywords(wanted) {
  return [wanted.title, artistForSearch(wanted.artist)].filter(text => text && !/^未知/.test(text)).join(' ');
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason ?? Object.assign(new Error('歌词搜索已取消。'), { name: 'AbortError' });
}

function errorMessage(error) {
  if (error?.name === 'TimeoutError') return '请求超时。';
  return String(error?.message ?? error ?? '未知错误').slice(0, 512);
}

function field(value, route) {
  if (!route) return value;
  for (const part of route.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

function validateUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\0\r\n]/u.test(value)) throw fail('歌词源地址无效。');
  const rendered = value.replace(/\{(?:query|title|artist|album|id)\}/g, 'sample');
  if (/[{}]/.test(rendered)) throw fail('地址模板只支持 query、title、artist、album 和 id。');
  let url; try { url = new URL(rendered); } catch { throw fail('请填写完整的歌词源地址。'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw fail('远程歌词源请使用 HTTPS；本机服务可使用 HTTP。');
  if (url.username || url.password) throw fail('歌词源地址不能包含用户名或密码。');
  return value;
}

function validateSource(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('歌词源格式无效。');
  const id = value.id || `custom-${randomUUID()}`;
  if (typeof id !== 'string' || !/^custom-[a-zA-Z0-9-]{1,64}$/.test(id)) throw fail('自定义歌词源编号无效。');
  const name = clean(value.name, 64);
  if (!name) throw fail('请填写歌词源名称。');
  const mapping = { ...mappingDefaults };
  if (value.mapping !== undefined) {
    if (!value.mapping || typeof value.mapping !== 'object' || Array.isArray(value.mapping)) throw fail('字段映射需要是 JSON 对象。');
    for (const [key, route] of Object.entries(value.mapping)) {
      if (!Object.hasOwn(mappingDefaults, key) || typeof route !== 'string' || route.length > 128 || route.split('.').some(part => !/^[a-zA-Z0-9_]+$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part))) throw fail(`歌词源字段映射无效：${key}`);
      mapping[key] = route;
    }
  }
  return { id, name, builtin: false, enabled: value.enabled !== false, searchUrl: validateUrl(value.searchUrl), lyricUrl: validateUrl(value.lyricUrl), mapping };
}

function template(url, values) {
  return new URL(url.replace(/\{(query|title|artist|album|id)\}/g, (_, key) => encodeURIComponent(values[key] ?? '')));
}

async function remoteJson(url, { signal, method = 'GET', payload, referer } = {}) {
  const response = await fetch(url, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000),
    headers: { Accept: 'application/json,text/plain;q=0.9', 'User-Agent': 'RhineMusic/1.0', ...(referer ? { Referer: referer } : {}), ...(payload ? { 'Content-Type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}) });
  if (!response.ok) { await response.body?.cancel(); throw fail(`歌词来源请求失败（HTTP ${response.status}）。`, 502); }
  const reader = response.body?.getReader();
  if (!reader) throw fail('歌词来源没有返回内容。', 502);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 1024 * 1024) throw fail('歌词来源返回内容超过 1 MB。', 502);
      chunks.push(Buffer.from(value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  let text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
  const jsonp = /^[$\w.]+\(([\s\S]*)\);?$/.exec(text);
  if (jsonp) text = jsonp[1];
  try { return JSON.parse(text); } catch { throw fail('歌词来源返回的不是 JSON，可能暂时不可用或要求验证。', 502); }
}

function decodeEntities(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (match, code) => {
    const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
  }).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function lyricText(value) {
  if (typeof value !== 'string') return '';
  let text = decodeEntities(value).replace(/\0/g, '').trim();
  if (!text.includes('[') && text.length > 64 && /^[a-zA-Z0-9+/=\r\n]+$/.test(text)) {
    const decoded = Buffer.from(text, 'base64').toString('utf8');
    if (/\[\d+:\d+/.test(decoded)) text = decodeEntities(decoded);
  }
  if (Buffer.byteLength(text, 'utf8') > 96 * 1024) throw fail('歌词内容超过 96 KB。');
  return text;
}

function localLyricText(value, limit = 96 * 1024) {
  if (typeof value !== 'string') return '';
  if (value.includes('\0') || Buffer.byteLength(value, 'utf8') > limit) throw fail('本地歌词需要是不含空字符的 UTF-8 文本，最多 96 KiB。');
  return value;
}

function embeddedOffset(value) {
  const match = value.match(/^\s*\[offset\s*:\s*([+-]?\d+)\s*\]\s*$/im);
  const offset = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(offset) ? offset : 0;
}

function withEmbeddedOffset(value, offset) {
  const newline = value.includes('\r\n') ? '\r\n' : '\n';
  const bom = value.startsWith('\uFEFF') ? '\uFEFF' : '';
  const lines = value.replace(/^\uFEFF/, '').split(/\r?\n/).filter(line => !/^\s*\[offset\s*:[^\]]*\]\s*$/i.test(line));
  return `${bom}[offset:${offset}]${newline}${lines.join(newline)}`;
}

function validLyricKind(value) { return LYRIC_KINDS.includes(value); }

function validateLyricDocument(value, trackId) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![1, 2].includes(value.version) || value.trackId !== trackId
      || !value.source || typeof value.source !== 'object' || Array.isArray(value.source) || typeof value.source.name !== 'string'
      || typeof value.lrc !== 'string' || value.translation !== undefined && typeof value.translation !== 'string'
      || !Number.isInteger(value.offsetMs) || Math.abs(value.offsetMs) > 30000 || value.version === 2 && value.offsetInText !== true) {
    throw fail('本机歌词缓存格式无效，原文件已保留。');
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_LYRIC_DOCUMENT_BYTES) throw fail('本机歌词缓存过大，原文件已保留。');
  let lrc = localLyricText(value.lrc, 96 * 1024 + 128);
  if (value.translation) localLyricText(value.translation);
  if (value.version === 1) {
    if (value.offsetInText !== true && value.offsetMs !== 0) {
      const combinedOffset = embeddedOffset(lrc) + value.offsetMs;
      if (!Number.isSafeInteger(combinedOffset)) throw fail('旧歌词缓存偏移超出安全范围，原文件已保留。');
      lrc = withEmbeddedOffset(lrc, combinedOffset);
    }
    // Legacy v1 applied offsetMs outside the text. Normalize its meaning in
    // memory; the source JSON is not rewritten by a read.
    const normalized = { ...value, version: 2, lrc, offsetInText: true };
    if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_LYRIC_DOCUMENT_BYTES) throw fail('本机歌词缓存过大，原文件已保留。');
    return normalized;
  }
  return value;
}

function validateCache(value, trackId) {
  if (value && typeof value === 'object' && !Array.isArray(value) && [1, 2].includes(value.version)) {
    const lyric = validateLyricDocument(value, trackId);
    const kind = lyric.source.id === 'local-import' ? 'local' : 'cloud';
    return { version: 3, trackId, activeKind: kind, userSelected: false, selectionRevision: 0, variants: { [kind]: lyric } };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 3 || value.trackId !== trackId
      || !value.variants || typeof value.variants !== 'object' || Array.isArray(value.variants)
      || !validLyricKind(value.activeKind) || value.userSelected !== undefined && typeof value.userSelected !== 'boolean'
      || value.selectionRevision !== undefined && (!Number.isSafeInteger(value.selectionRevision) || value.selectionRevision < 0)
      || Object.keys(value).some(key => !['version', 'trackId', 'activeKind', 'variants', 'userSelected', 'selectionRevision'].includes(key))
      || Object.keys(value.variants).some(kind => !validLyricKind(kind))) {
    throw fail('本机歌词缓存格式无效，原文件已保留。');
  }
  const variants = {};
  for (const kind of LYRIC_KINDS) {
    if (!Object.hasOwn(value.variants, kind)) continue;
    const document = value.variants[kind];
    if (!document || document.version !== 2 || document.offsetInText !== true) throw fail('本机歌词缓存格式无效，原文件已保留。');
    if ((kind === 'local') !== (document.source?.id === 'local-import')) throw fail('歌词缓存来源与版本类型不符，原文件已保留。');
    variants[kind] = validateLyricDocument(document, trackId);
  }
  const userSelected = value.userSelected ?? false;
  const selectionRevision = value.selectionRevision ?? 0;
  const activeKind = userSelected
    ? value.activeKind
    : variants.local ? 'local' : 'cloud';
  const normalized = { version: 3, trackId, activeKind, userSelected, selectionRevision, variants };
  if (Buffer.byteLength(JSON.stringify(normalized), 'utf8') > MAX_LYRIC_CONTAINER_BYTES) throw fail('本机歌词缓存容器过大，原文件已保留。');
  return normalized;
}

function candidate(source, value, wanted) {
  const id = String(value.id ?? '').trim();
  if (!id || id.length > 128 || /[\0\r\n]/.test(id)) return null;
  const title = songText(value.title), artist = songText(value.artist), album = songText(value.album);
  if (!title) return null;
  const duration = Number(value.duration), a = normalize(title), b = normalize(wanted.title);
  const match = (left, right) => left && right ? left === right ? 1 : left.includes(right) || right.includes(left) ? .55 : 0 : 0;
  const score = .55 * match(a, b) + .25 * match(normalize(artist), normalize(wanted.artist)) + .15 * match(normalize(album), normalize(wanted.album)) + (Number.isFinite(duration) && wanted.duration > 0 && Math.abs(duration - wanted.duration) <= 4 ? .05 : 0);
  return { id, sourceId: source.id, title, artist, album, ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}), score };
}

function automaticMatch(value, wanted) {
  if (!normalize(wanted.title) || normalize(value.title) !== normalize(wanted.title)) return false;
  const artist = normalize(artistForSearch(wanted.artist)), found = normalize(artistForSearch(value.artist));
  if (artist && !/^(未知|unknown|variousartists)/i.test(artist)) {
    return artist === found || Math.min(artist.length, found.length) >= 2 && (artist.includes(found) || found.includes(artist));
  }
  return !!normalize(wanted.album) && !/^(未知|unknown)/i.test(normalize(wanted.album)) && normalize(value.album) === normalize(wanted.album) ||
    wanted.duration > 0 && Number.isFinite(value.duration) && Math.abs(value.duration - wanted.duration) <= 4;
}

export class LyricsLibrary {
  constructor({ dataDir, resolveTrack }) {
    this.directory = path.join(dataDir, 'lyrics');
    this.sourceFile = path.join(this.directory, 'sources.json');
    this.settingsFile = path.join(this.directory, 'settings.json');
    this.defaultCacheDirectory = path.join(this.directory, 'cache');
    this.settingsConfig = { version: 2, defaultSourceId: 'qq', cacheDirectory: this.defaultCacheDirectory, previousCacheDirectories: [] };
    this.resolveTrack = resolveTrack;
    this.custom = []; this.ready = null; this.tail = Promise.resolve(); this.candidates = new Map();
  }
  async init() {
    if (!this.ready) this.ready = (async () => {
      try {
        const info = await fs.stat(this.sourceFile);
        if (info.size > 128 * 1024) throw fail('本机歌词源配置过大。');
        const value = JSON.parse(await fs.readFile(this.sourceFile, 'utf8'));
        if (value.version !== 1 || !Array.isArray(value.sources) || value.sources.length > 12) throw fail('本机歌词源配置格式无效，原文件已保留。');
        this.custom = value.sources.map(validateSource);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try {
        const info = await fs.stat(this.settingsFile);
        if (info.size > 32 * 1024) throw fail('本机歌词设置过大。');
        const value = JSON.parse(await fs.readFile(this.settingsFile, 'utf8'));
        if (![1, 2].includes(value.version) || typeof value.defaultSourceId !== 'string' || !isFullyQualified(value.cacheDirectory) || !Array.isArray(value.previousCacheDirectories) || value.previousCacheDirectories.length > 16 || value.previousCacheDirectories.some(directory => typeof directory !== 'string' || !isFullyQualified(directory))) throw fail('本机歌词设置格式无效，原文件已保留。');
        this.settingsConfig = { version: 2, defaultSourceId: value.version === 1 && value.defaultSourceId === 'netease' ? 'qq' : value.defaultSourceId, cacheDirectory: path.resolve(value.cacheDirectory), previousCacheDirectories: value.previousCacheDirectories.map(directory => path.resolve(directory)) };
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return this;
    })();
    return this.ready;
  }
  async sources() { await this.init(); return { sources: [...builtins.map(value => ({ ...value })), ...structuredClone(this.custom)] }; }
  effectiveDefault() {
    return [...builtins, ...this.custom].some(source => source.id === this.settingsConfig.defaultSourceId && source.enabled) ? this.settingsConfig.defaultSourceId : 'qq';
  }
  async settings() {
    const { sources } = await this.sources();
    return { settings: { defaultSourceId: this.effectiveDefault(), cacheDirectory: this.settingsConfig.cacheDirectory, defaultCacheDirectory: this.defaultCacheDirectory }, sources };
  }
  async saveSettings(value) {
    const { sources } = await this.sources();
    if (!sources.some(source => source.id === value?.defaultSourceId && source.enabled)) throw fail('请选择可用的全局默认歌词来源。');
    if (typeof value.cacheDirectory !== 'string' || value.cacheDirectory.length > 4096 || /[\0\r\n]/.test(value.cacheDirectory)) throw fail('歌词缓存目录无效。');
    const input = value.cacheDirectory.trim() || this.defaultCacheDirectory;
    if (!isFullyQualified(input)) throw fail('歌词缓存目录必须是完整路径。');
    const directory = path.resolve(input);
    const write = this.tail.catch(() => {}).then(async () => {
      await fs.mkdir(directory, { recursive: true });
      if (!(await fs.stat(directory)).isDirectory()) throw fail('歌词缓存路径不是文件夹。');
      const previous = this.settingsConfig.cacheDirectory === directory ? this.settingsConfig.previousCacheDirectories : [this.settingsConfig.cacheDirectory, ...this.settingsConfig.previousCacheDirectories];
      const settings = { version: 2, defaultSourceId: value.defaultSourceId, cacheDirectory: directory, previousCacheDirectories: [...new Set(previous)].filter(item => item !== directory).slice(0, 16) };
      if (Buffer.byteLength(JSON.stringify(settings), 'utf8') > 32 * 1024) throw fail('缓存目录配置过长，设置未保存。');
      await writeJsonAtomic(this.settingsFile, settings);
      this.settingsConfig = settings;
    });
    this.tail = write; await write; return this.settings();
  }
  async preferences(trackId) {
    await this.init(); await this.metadata(trackId);
    let sourceId = null;
    try {
      const file = path.join(this.directory, 'track-preferences', `${hash(trackId)}.json`);
      if ((await fs.stat(file)).size > 4096) throw fail('本曲歌词设置过大。');
      const value = JSON.parse(await fs.readFile(file, 'utf8'));
      if (value.version !== 1 || value.trackId !== trackId || value.sourceId !== null && typeof value.sourceId !== 'string') throw fail('本曲歌词设置无效，原文件已保留。');
      sourceId = value.sourceId;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const { sources } = await this.sources(), defaultSourceId = this.effectiveDefault();
    const available = sources.some(source => source.id === sourceId && source.enabled);
    return { trackId, sourceId, effectiveSourceId: available ? sourceId : defaultSourceId, defaultSourceId, sources, ...(sourceId && !available ? { missingSourceId: sourceId } : {}) };
  }
  async savePreferences({ trackId, sourceId }) {
    await this.preferences(trackId);
    const { sources } = await this.sources();
    if (sourceId !== null && !sources.some(source => source.id === sourceId && source.enabled)) throw fail('请选择共享列表中的歌词来源，或跟随全局。');
    const write = this.tail.catch(() => {}).then(() => writeJsonAtomic(path.join(this.directory, 'track-preferences', `${hash(trackId)}.json`), { version: 1, trackId, sourceId }));
    this.tail = write; await write; return this.preferences(trackId);
  }
  async saveSources(value) {
    await this.init();
    if (!Array.isArray(value?.sources) || value.sources.length > 12) throw fail('最多添加 12 个自定义歌词源。');
    const sources = value.sources.map(validateSource);
    if (new Set(sources.map(source => source.id)).size !== sources.length) throw fail('歌词源编号重复。');
    const write = this.tail.catch(() => {}).then(async () => { await writeJsonAtomic(this.sourceFile, { version: 1, sources }); this.custom = sources; this.candidates.clear(); });
    this.tail = write; await write; return this.sources();
  }
  async metadata(trackId) {
    if (typeof trackId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(trackId)) throw fail('曲目编号无效。');
    const value = await this.resolveTrack(trackId);
    if (!value?.track) throw fail('当前曲目已不在音乐库中。', 404);
    return { trackId, title: clean(value.track.title), artist: clean(value.track.artist), album: clean(value.album?.title), duration: Number(value.track.duration) || 0 };
  }
  cacheFile(id, directory = this.settingsConfig.cacheDirectory) { return path.join(directory, `${hash(id)}.json`); }
  cacheDirectories() { return uniqueDirectories([this.settingsConfig.cacheDirectory, ...this.settingsConfig.previousCacheDirectories, this.defaultCacheDirectory]); }
  async readCache(trackId, directory) {
    const file = this.cacheFile(trackId, directory), info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw fail('歌词缓存不是普通文件，原文件已保留。');
    if (info.size > MAX_LYRIC_CONTAINER_BYTES) throw fail('本机歌词缓存过大。');
    return validateCache(JSON.parse(await fs.readFile(file, 'utf8')), trackId);
  }
  async loadContainer(trackId) {
    await this.init(); await this.metadata(trackId);
    const variants = {};
    let selectedState;
    for (const directory of this.cacheDirectories()) try {
      const cached = await this.readCache(trackId, directory);
      for (const kind of LYRIC_KINDS) if (!variants[kind] && cached.variants[kind]) variants[kind] = cached.variants[kind];
      if (!selectedState) selectedState = {
        userSelected: cached.userSelected,
        selectionRevision: cached.selectionRevision,
        activeKind: cached.activeKind,
      };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const userSelected = selectedState?.userSelected ?? false;
    const selectionRevision = selectedState?.selectionRevision ?? 0;
    const activeKind = userSelected
      ? selectedState.activeKind
      : variants.local ? 'local' : 'cloud';
    return { version: 3, trackId, activeKind, userSelected, selectionRevision, variants };
  }
  projectCache(container, kind) {
    const selectedKind = kind ?? container.activeKind;
    return {
      lyric: selectedKind ? container.variants[selectedKind] ?? null : null,
      activeKind: container.activeKind,
      userSelected: container.userSelected,
      selectionRevision: container.selectionRevision,
      variants: { cloud: !!container.variants.cloud, local: !!container.variants.local },
      ...(kind ? { kind } : {}),
    };
  }
  async resolveSnapshot(trackId, expectedSelectionRevision, sources = [], cachedOverride) {
    const container = await this.loadContainer(trackId);
    const selectionChanged = container.selectionRevision !== expectedSelectionRevision;
    const hasActiveLyric = !!(container.activeKind && container.variants[container.activeKind]);
    return {
      ...this.projectCache(container),
      cached: selectionChanged ? hasActiveLyric : cachedOverride ?? hasActiveLyric,
      sources: selectionChanged || hasActiveLyric ? [] : sources,
      ...(selectionChanged ? { selectionChanged: true } : {}),
    };
  }
  async load(trackId, kind) {
    if (kind !== undefined && kind !== null && kind !== '' && !validLyricKind(kind)) throw fail('歌词版本类型无效。');
    const container = await this.loadContainer(trackId);
    return this.projectCache(container, kind || undefined);
  }
  async commitContainer(trackId, container) {
    const serialized = JSON.stringify(container);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_LYRIC_CONTAINER_BYTES) throw fail('两份歌词合计超过本机歌词缓存容量。');
    const currentFile = this.cacheFile(trackId);
    const currentIdentity = pathKey(await fs.realpath(currentFile).catch(error => { if (error.code !== 'ENOENT') throw error; return currentFile; }));
    const previousFiles = new Map();
    for (const directory of this.cacheDirectories()) try {
      await this.readCache(trackId, directory);
      const file = this.cacheFile(trackId, directory), identity = pathKey(await fs.realpath(file));
      if (identity !== currentIdentity) previousFiles.set(identity, file);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeJsonAtomic(currentFile, container);
    for (const file of previousFiles.values()) await fs.unlink(file);
  }
  async save(trackId, contents, { kind, onlyIfMissing = false, signal, preserveText = false, expectedLyric, expectedSelectionRevision, activate = true, userSelection = false } = {}) {
    if (!contents || typeof contents !== 'object' || Array.isArray(contents)) throw fail('歌词内容格式无效。');
    const metadata = await this.metadata(trackId);
    const text = preserveText ? value => localLyricText(value, 96 * 1024 + 128) : contents.source?.id === 'local-import' ? localLyricText : lyricText;
    const lrc = text(contents.lrc), translation = text(contents.translation);
    if (!lrc.trim()) throw fail('没有可保存的歌词内容。', 404);
    const bank = kind ?? (contents.source?.id === 'local-import' ? 'local' : 'cloud');
    if (!validLyricKind(bank)) throw fail('歌词版本类型无效。');
    if (expectedSelectionRevision !== undefined && (!Number.isSafeInteger(expectedSelectionRevision) || expectedSelectionRevision < 0)) throw fail('歌词选择版本号无效。');
    const document = validateLyricDocument({ version: 2, trackId, track: metadata, lrc, ...(translation ? { translation } : {}), offsetMs: contents.offsetMs ?? 0, offsetInText: true, source: contents.source, savedAt: new Date().toISOString() }, trackId);
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > MAX_LYRIC_DOCUMENT_BYTES) throw fail('原文与翻译合计超过本机歌词文档容量。');
    const write = this.tail.catch(() => {}).then(async () => {
      abortIfNeeded(signal);
      const cached = await this.loadContainer(trackId);
      if (expectedSelectionRevision !== undefined && cached.selectionRevision !== expectedSelectionRevision) {
        return { ...this.projectCache(cached), kind: cached.activeKind, cached: true, selectionChanged: true };
      }
      if (onlyIfMissing) {
        if (cached.activeKind === bank && cached.variants[bank]) return { ...this.projectCache(cached, bank), kind: bank, cached: true };
        if ((cached.variants.cloud || cached.variants.local) && !(cached.userSelected && cached.activeKind === bank)) {
          return { ...this.projectCache(cached), kind: cached.activeKind, cached: true };
        }
      }
      if (expectedLyric !== undefined && JSON.stringify(cached.variants[bank] ?? null) !== JSON.stringify(expectedLyric)) throw fail('歌词版本已变化，请对当前版本重新调整对齐。', 409);
      const variants = { ...cached.variants, [bank]: document };
      let activeKind = cached.activeKind;
      let userSelectedState = cached.userSelected;
      let selectionRevision = cached.selectionRevision;
      if (userSelection) {
        if (selectionRevision >= Number.MAX_SAFE_INTEGER) throw fail('歌词选择版本号已达到安全上限。');
        activeKind = bank;
        userSelectedState = true;
        selectionRevision += 1;
      } else if (activate) {
        activeKind = cached.userSelected ? cached.activeKind : variants.local ? 'local' : variants.cloud ? 'cloud' : cached.activeKind ?? bank;
      }
      const container = { version: 3, trackId, activeKind, userSelected: userSelectedState, selectionRevision, variants };
      abortIfNeeded(signal);
      await this.commitContainer(trackId, container);
      return { ...this.projectCache(container, bank), kind: bank, cached: false };
    });
    this.tail = write; return write;
  }
  async activate(value, signal) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('歌词版本切换请求格式无效。');
    const { trackId, kind } = value;
    if (!validLyricKind(kind)) throw fail('歌词版本类型无效。');
    abortIfNeeded(signal);
    const write = this.tail.catch(() => {}).then(async () => {
      abortIfNeeded(signal);
      const cached = await this.loadContainer(trackId);
      abortIfNeeded(signal);
      if (cached.selectionRevision >= Number.MAX_SAFE_INTEGER) throw fail('歌词选择版本号已达到安全上限。');
      const container = { ...cached, activeKind: kind, userSelected: true, selectionRevision: cached.selectionRevision + 1 };
      await this.commitContainer(trackId, container);
      return { ...this.projectCache(container, kind), kind, cached: !!container.variants[kind] };
    });
    this.tail = write; return write;
  }
  async resolve({ trackId }, signal) {
    abortIfNeeded(signal);
    const cached = await this.loadContainer(trackId);
    abortIfNeeded(signal);
    const selectedKind = cached.activeKind;
    if (cached.userSelected && selectedKind === 'local') return { ...this.projectCache(cached, 'local'), cached: !!cached.variants.local, sources: [] };
    if (cached.variants.local && !cached.userSelected) return { ...this.projectCache(cached, 'local'), cached: true, sources: [] };
    if (cached.variants.cloud && selectedKind === 'cloud') return { ...this.projectCache(cached, 'cloud'), cached: true, sources: [] };
    const expectedSelectionRevision = cached.selectionRevision;
    const wanted = await this.metadata(trackId);
    const priority = [...new Set([this.effectiveDefault(), 'qq'])];
    const ordered = [...builtins, ...this.custom].filter(source => source.enabled)
      .sort((left, right) => (priority.indexOf(left.id) < 0 ? 99 : priority.indexOf(left.id)) - (priority.indexOf(right.id) < 0 ? 99 : priority.indexOf(right.id)));
    const timeout = AbortSignal.timeout(20_000), lookupSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const sources = [];
    for (const source of ordered) {
      try {
        const candidates = (await this.searchSource(source, trackId, wanted, lookupSignal)).filter(value => automaticMatch(value, wanted)).slice(0, 3);
        let failure;
        for (const found of candidates) {
          try {
            const contents = await this.candidateLyric({ trackId, sourceId: source.id, candidateId: found.id }, lookupSignal);
            const lrc = lyricText(contents.lrc);
            if (!lrc.split(/\r?\n/).some(line => line.replace(/\[[^\]]*\]/g, '').trim())) continue;
            const result = await this.save(trackId, { ...contents, lrc }, { kind: 'cloud', onlyIfMissing: true, expectedSelectionRevision, signal: lookupSignal });
            if (result.selectionChanged || result.cached) return this.resolveSnapshot(trackId, expectedSelectionRevision, [], result.cached);
            return this.resolveSnapshot(trackId, expectedSelectionRevision, [...sources, { sourceId: source.id, name: source.name, status: 'ok', count: candidates.length }], false);
          } catch (error) {
            abortIfNeeded(signal);
            failure = error;
            if (lookupSignal.aborted) break;
          }
        }
        sources.push({ sourceId: source.id, name: source.name, status: failure ? 'error' : 'empty', count: 0, ...(failure ? { message: errorMessage(failure) } : {}) });
      } catch (error) {
        abortIfNeeded(signal);
        sources.push({ sourceId: source.id, name: source.name, status: 'error', message: errorMessage(error) });
      }
      if (lookupSignal.aborted) break;
    }
    abortIfNeeded(signal);
    return this.resolveSnapshot(trackId, expectedSelectionRevision, sources);
  }
  async search({ trackId, sourceId, query }, signal) {
    await this.init();
    abortIfNeeded(signal);
    const automatic = sourceId === AUTO_SOURCE_ID;
    if (!automatic && (sourceId === undefined || sourceId === null || sourceId === '')) sourceId = this.effectiveDefault();
    const actual = await this.metadata(trackId), wanted = { ...actual };
    if (query !== undefined) {
      if (!query || typeof query !== 'object' || Array.isArray(query)) throw fail('检索信息格式无效。');
      for (const key of ['title', 'artist', 'album']) if (query[key] !== undefined) {
        if (typeof query[key] !== 'string' || query[key].length > 256) throw fail('检索字段过长或格式错误。');
        wanted[key] = clean(query[key]);
      }
    }
    if (!wanted.title) throw fail('请填写歌曲标题。');
    if (automatic) {
      const preferredSourceId = this.effectiveDefault();
      const orderedSources = [...builtins, ...this.custom].filter(item => item.enabled);
      orderedSources.sort((left, right) => Number(right.id === preferredSourceId) - Number(left.id === preferredSourceId));
      if (!orderedSources.length) throw fail('未找到可用的歌词源。');
      const totalTimeout = AbortSignal.timeout(20_000);
      const searchSignal = signal ? AbortSignal.any([signal, totalTimeout]) : totalTimeout;
      const perSource = await Promise.all(orderedSources.map(async source => {
        try {
          const candidates = await this.searchSource(source, trackId, wanted, searchSignal);
          abortIfNeeded(signal);
          return { source, candidates };
        } catch (error) {
          abortIfNeeded(signal);
          return { source, error };
        }
      }));
      abortIfNeeded(signal);
      const merged = perSource.flatMap(({ candidates }) => candidates ?? []).map((item, order) => ({ item, order }));
      merged.sort((left, right) => right.item.score - left.item.score || left.order - right.order);
      const sources = perSource.map(({ source, candidates, error }) => error
        ? { sourceId: source.id, name: source.name, status: 'error', message: errorMessage(error) }
        : { sourceId: source.id, name: source.name, status: candidates.length ? 'ok' : 'empty', count: candidates.length });
      return { candidates: merged.slice(0, 30).map(entry => entry.item), sourceName: '自动搜索', sources };
    }
    const source = [...builtins, ...this.custom].find(item => item.id === sourceId && item.enabled);
    if (!source) throw fail('未找到可用的歌词源。');
    const candidates = await this.searchSource(source, trackId, wanted, signal);
    abortIfNeeded(signal);
    return { candidates, sourceName: source.name, sources: [{ sourceId: source.id, name: source.name, status: candidates.length ? 'ok' : 'empty', count: candidates.length }] };
  }

  async searchSource(source, trackId, wanted, signal) {
    abortIfNeeded(signal);
    let results;
    if (source.id === 'netease') {
      const url = new URL('https://music.163.com/api/search/get/web');
      url.search = new URLSearchParams({ s: builtInKeywords(wanted), type: '1', offset: '0', limit: '20', total: 'true' }).toString();
      const value = await remoteJson(url, { signal, referer: 'https://music.163.com/' });
      if (value.code !== undefined && value.code !== 200) throw fail(`网易云音乐返回错误（${value.code}）。`, 502);
      const songs = value.result?.songCount === 0 ? [] : value.result?.songs;
      if (!Array.isArray(songs)) throw fail('网易云音乐没有返回歌曲列表，接口可能暂时不可用。', 502);
      results = songs.slice(0, 100).map(song => ({ id: song.id, title: song.name, artist: song.artists ?? song.ar, album: song.album ?? song.al, duration: Number(song.duration ?? song.dt) / 1000 }));
    } else if (source.id === 'qq') {
      const url = new URL('https://c.y.qq.com/splcloud/fcgi-bin/smartbox_new.fcg');
      url.search = new URLSearchParams({ key: builtInKeywords(wanted), inCharset: 'utf-8', outCharset: 'utf-8', format: 'json', g_tk: '5381' }).toString();
      const value = await remoteJson(url, { signal, referer: 'https://y.qq.com/portal/player.html' });
      if (value.code !== undefined && Number(value.code) !== 0) throw fail(`QQ 音乐返回错误（${value.code}）。`, 502);
      const songs = value.data?.song?.count === 0 ? [] : value.data?.song?.itemlist;
      if (!Array.isArray(songs)) throw fail('QQ 音乐没有返回歌曲列表，接口可能暂时不可用。', 502);
      results = songs.map(song => ({ id: song.mid ?? song.songmid, title: song.name ?? song.title, artist: song.singer, album: song.album?.name ?? song.album }));
    } else {
      const keywords = [wanted.title, wanted.artist, wanted.album].filter(text => text && !/^未知/.test(text)).join(' ');
      const value = await remoteJson(template(source.searchUrl, { ...wanted, query: keywords }), { signal });
      const songs = field(value, source.mapping.results);
      if (!Array.isArray(songs)) throw fail('自定义源的歌曲列表字段不是数组，请检查字段映射。', 502);
      results = songs.slice(0, 100).map(song => Object.fromEntries(['id', 'title', 'artist', 'album', 'duration'].map(key => [key, field(song, source.mapping[key])])));
    }
    abortIfNeeded(signal);
    const candidates = results.map(value => candidate(source, value, wanted)).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 30);
    this.candidates.set(`${trackId}:${source.id}`, { time: Date.now(), values: candidates, sourceSignature: JSON.stringify(source) });
    while (this.candidates.size > 128) this.candidates.delete(this.candidates.keys().next().value);
    return candidates;
  }
  async candidateLyric({ trackId, sourceId, candidateId }, signal) {
    await this.init(); await this.metadata(trackId);
    const source = [...builtins, ...this.custom].find(item => item.id === sourceId && item.enabled);
    const search = this.candidates.get(`${trackId}:${sourceId}`), found = search?.values.find(item => item.id === candidateId);
    if (!source || !found || Date.now() - search.time > 30 * 60 * 1000 || search.sourceSignature !== JSON.stringify(source)) throw fail('搜索结果已过期，请重新搜索。', 409);
    let lrc, translation, url;
    if (sourceId === 'netease') {
      const target = new URL('https://music.163.com/api/song/lyric');
      target.search = new URLSearchParams({ id: found.id, lv: '-1', kv: '-1', tv: '-1' }).toString();
      const value = await remoteJson(target, { signal, referer: 'https://music.163.com/' });
      if (value.code !== undefined && value.code !== 200) throw fail(`网易云音乐歌词请求失败（${value.code}）。`, 502);
      lrc = (value.data ?? value).lrc?.lyric; translation = (value.data ?? value).tlyric?.lyric;
      url = `https://music.163.com/#/song?id=${encodeURIComponent(found.id)}`;
    } else if (sourceId === 'qq') {
      const target = new URL('https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg');
      target.search = new URLSearchParams({ format: 'json', nobase64: '1', g_tk: '5381', songmid: found.id }).toString();
      const value = await remoteJson(target, { signal, referer: 'https://y.qq.com/portal/player.html' });
      if (value.retcode !== undefined && value.retcode !== 0) throw fail(`QQ 音乐歌词请求失败（${value.retcode}）。`, 502);
      lrc = value.lyric; translation = value.trans; url = `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(found.id)}`;
    } else {
      const value = await remoteJson(template(source.lyricUrl, { ...await this.metadata(trackId), query: [found.title, found.artist, found.album].join(' '), id: found.id }), { signal });
      lrc = field(value, source.mapping.lrc); translation = field(value, source.mapping.translation);
    }
    abortIfNeeded(signal);
    return { lrc, translation, source: { id: source.id, name: source.name, ...(url ? { url } : {}) } };
  }
  async select(value, signal) {
    const contents = await this.candidateLyric(value, signal);
    return this.save(value.trackId, contents, { kind: 'cloud', userSelection: true, signal });
  }
  async import({ trackId, lrc, translation }, signal) {
    if (typeof lrc !== 'string' || translation !== undefined && typeof translation !== 'string') throw fail('导入歌词需要文本内容。');
    abortIfNeeded(signal);
    return this.save(trackId, { lrc, translation, source: { id: 'local-import', name: '本地导入' } }, { kind: 'local', userSelection: true, signal });
  }
  async offset({ trackId, offsetMs, kind }) {
    if (!Number.isInteger(offsetMs) || Math.abs(offsetMs) > 30000) throw fail('歌词偏移需为 -30000 至 30000 毫秒的整数。');
    const cached = await this.loadContainer(trackId);
    const bank = kind === undefined || kind === null || kind === '' ? cached.activeKind : kind;
    if (!validLyricKind(bank)) throw fail('歌词版本类型无效。');
    const lyric = cached.variants[bank];
    if (!lyric) throw fail('请先选择或导入此版本歌词。', 404);
    const baseOffset = embeddedOffset(lyric.lrc) - (lyric.offsetInText ? lyric.offsetMs : 0);
    if (!Number.isSafeInteger(baseOffset + offsetMs)) throw fail('原歌词的 offset 超出可调整范围，原缓存已保留。');
    return this.save(trackId, { ...lyric, lrc: withEmbeddedOffset(lyric.lrc, baseOffset + offsetMs), offsetMs }, {
      kind: bank,
      preserveText: true,
      expectedLyric: lyric,
      activate: false,
    });
  }
}
