import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LyricsLibrary } from './lyrics-library.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(projectRoot, '.tools', 'lyrics-source-refinement', 'library-check');
const lyrics = '[00:01.00]synthetic lyric line';

async function fixture(t) {
  const root = path.join(artifactRoot, `run-${process.pid}-${randomUUID()}`);
  const dataDir = path.join(root, 'music-data');
  await fs.mkdir(dataDir, { recursive: true });
  const library = new LyricsLibrary({
    dataDir,
    resolveTrack: async id => id === 'demo-track'
      ? { track: { id, title: '泡沫', artist: 'G.E.M. 邓紫棋', duration: 247 }, album: { title: '我是歌手第二季' } }
      : null,
  });
  t.after(async () => {
    const resolvedRoot = path.resolve(root);
    const resolvedArtifactRoot = path.resolve(artifactRoot) + path.sep;
    if (!resolvedRoot.startsWith(resolvedArtifactRoot)) throw new Error(`Refusing to remove a fixture outside ${resolvedArtifactRoot}`);
    await fs.rm(resolvedRoot, { recursive: true, force: true });
  });
  return { library, root };
}

function jsonResponse(value, contentType = 'application/json; charset=utf-8', status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': contentType } });
}

function mockFetch(t, handler) {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => { globalThis.fetch = previous; });
}

test('QQ smartbox candidates use the supported lyric endpoint and persist the selection', async t => {
  const { library } = await fixture(t);
  const calls = [];
  mockFetch(t, async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith('/smartbox_new.fcg')) {
      assert.equal(init.method ?? 'GET', 'GET');
      assert.equal(url.searchParams.get('key'), '泡沫 邓紫棋');
      assert.equal(url.searchParams.get('inCharset'), 'utf-8');
      assert.equal(url.searchParams.get('outCharset'), 'utf-8');
      assert.equal(url.searchParams.get('format'), 'json');
      assert.equal(url.searchParams.get('g_tk'), '5381');
      assert.equal(init.headers.Referer, 'https://y.qq.com/portal/player.html');
      return jsonResponse({ data: { song: { itemlist: [{ mid: 'qq-mid-demo', name: '泡沫', singer: 'G.E.M. 邓紫棋', album: '我是歌手第二季' }] } } }, 'text/html;charset=utf-8');
    }
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) {
      assert.equal(url.searchParams.get('songmid'), 'qq-mid-demo');
      assert.equal(url.searchParams.get('g_tk'), '5381');
      assert.equal(url.searchParams.get('nobase64'), '1');
      return jsonResponse({ retcode: 0, lyric: lyrics, trans: '' }, 'text/html;charset=utf-8');
    }
    throw new Error(`Unexpected mock URL: ${url.href}`);
  });

  const result = await library.search({ trackId: 'demo-track', sourceId: 'qq' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, 'qq-mid-demo');
  assert.equal(result.candidates[0].sourceId, 'qq');
  assert.deepEqual(result.sources, [{ sourceId: 'qq', name: 'QQ 音乐', status: 'ok', count: 1 }]);

  const selected = await library.select({ trackId: 'demo-track', sourceId: 'qq', candidateId: 'qq-mid-demo' });
  assert.equal(selected.lyric.lrc, lyrics);
  assert.equal(selected.lyric.source.id, 'qq');
  assert.equal(selected.activeKind, 'cloud');
  assert.deepEqual(selected.variants, { cloud: true, local: false });
  assert.equal(calls.length, 2);
  const loaded = await library.load('demo-track');
  assert.equal(loaded.lyric.lrc, lyrics);
  assert.equal(loaded.activeKind, 'cloud');
  assert.equal(loaded.variants.cloud, true);
  assert.equal(loaded.variants.local, false);
  const stored = JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8'));
  assert.equal(stored.version, 3);
  assert.equal(stored.activeKind, 'cloud');
  assert.equal(stored.userSelected, true);
  assert.equal(stored.selectionRevision, 1);
  assert.equal(stored.variants.cloud.source.id, 'qq');
  assert.equal(stored.variants.local, undefined);
});

test('NetEase search omits album and uses a Chinese alias while ranking against original metadata', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/search/get/web');
    assert.equal(url.searchParams.get('s'), '泡沫 邓紫棋');
    return jsonResponse({ code: 200, result: { songs: [{ id: 12345, name: '泡沫', artists: [{ name: 'G.E.M. 邓紫棋' }], album: { name: '我是歌手第二季' }, dt: 247000 }] } });
  });

  const result = await library.search({ trackId: 'demo-track', sourceId: 'netease' });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].artist, 'G.E.M. 邓紫棋');
  assert.equal(result.candidates[0].score, 1);
});

test('auto search reports a source error and an empty source separately, then selects through the successful source cache', async t => {
  const { library } = await fixture(t);
  await library.saveSources({ sources: [{
    id: 'custom-demo',
    name: '演示源',
    searchUrl: 'https://lyrics.example/search?q={query}',
    lyricUrl: 'https://lyrics.example/lyric?id={id}',
  }] });

  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.hostname === 'music.163.com') return jsonResponse({ error: 'upstream unavailable' }, 'application/json', 503);
    if (url.pathname.endsWith('/smartbox_new.fcg')) return jsonResponse({ data: { song: { itemlist: [] } } }, 'text/html;charset=utf-8');
    if (url.hostname === 'lyrics.example' && url.pathname === '/search') return jsonResponse({ results: [{ id: 'custom-song', title: '泡沫', artist: 'G.E.M. 邓紫棋', album: '我是歌手第二季', duration: 247 }] });
    if (url.hostname === 'lyrics.example' && url.pathname === '/lyric') return jsonResponse({ lrc: lyrics });
    throw new Error(`Unexpected mock URL: ${url.href}`);
  });

  const result = await library.search({ trackId: 'demo-track', sourceId: 'auto' });
  assert.deepEqual(result.sources.map(({ sourceId, status, count }) => ({ sourceId, status, count })), [
    { sourceId: 'qq', status: 'empty', count: 0 },
    { sourceId: 'netease', status: 'error', count: undefined },
    { sourceId: 'custom-demo', status: 'ok', count: 1 },
  ]);
  assert.match(result.sources[1].message, /HTTP 503/);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].sourceId, 'custom-demo');

  const selected = await library.select({ trackId: 'demo-track', sourceId: 'custom-demo', candidateId: 'custom-song' });
  assert.equal(selected.lyric.lrc, lyrics);
  assert.equal(selected.lyric.source.id, 'custom-demo');
  assert.equal(selected.activeKind, 'cloud');
});

test('explicit zero-count responses are empty results rather than source failures', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => new URL(String(input)).hostname === 'music.163.com'
    ? jsonResponse({ code: 200, result: { songCount: 0 } })
    : jsonResponse({ code: 0, data: { song: { count: 0 } } }));
  const result = await library.search({ trackId: 'demo-track', sourceId: 'auto' });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.sources.map(source=>source.status), ['empty', 'empty']);
});

test('an aborted auto search rejects instead of returning an empty result', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => {
    await new Promise(resolve => setTimeout(resolve, 25));
    const url = new URL(String(input));
    if (url.hostname === 'music.163.com') return jsonResponse({ code: 200, result: { songs: [] } });
    if (url.pathname.endsWith('/smartbox_new.fcg')) return jsonResponse({ data: { song: { itemlist: [] } } });
    throw new Error(`Unexpected mock URL: ${url.href}`);
  });

  const controller = new AbortController();
  const pending = library.search({ trackId: 'demo-track', sourceId: 'auto' }, controller.signal);
  const timer = setTimeout(() => controller.abort(), 5);
  try {
    await assert.rejects(pending, error => error.name === 'AbortError');
  } finally {
    clearTimeout(timer);
  }
});

function qqSongs(...songs) {
  return jsonResponse({ data: { song: { itemlist: songs } } }, 'text/html;charset=utf-8');
}

function neteaseSongs(...songs) {
  return jsonResponse({ code: 200, result: { songs } });
}

function qqSong(mid = 'qq-mid-auto', singer = 'G.E.M. 邓紫棋', name = '泡沫') {
  return { mid, name, singer, album: '我是歌手第二季' };
}

function neteaseSong(id = 24680, artist = 'G.E.M. 邓紫棋', name = '泡沫') {
  return { id, name, artists: [{ name: artist }], album: { name: '我是歌手第二季' }, dt: 247000 };
}

test('automatic resolution defaults to QQ and saves a high-confidence match', async t => {
  const { library } = await fixture(t);
  const calls = [];
  mockFetch(t, async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong());
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: lyrics, trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected resolve URL: ${url.href}`);
  });

  const settings = await library.settings();
  assert.equal(settings.settings.defaultSourceId, 'qq');
  await assert.rejects(fs.access(library.settingsFile), error => error.code === 'ENOENT');
  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric?.source.id, 'qq');
  assert.equal(result.lyric?.lrc, lyrics);
  assert.equal(result.lyric?.version, 2);
  assert.equal(result.lyric?.offsetInText, true);
  assert.deepEqual(calls.map(url => url.pathname.endsWith('/smartbox_new.fcg') ? 'qq-search' : 'qq-lyric'), ['qq-search', 'qq-lyric']);
  const loaded = await library.load('demo-track');
  assert.equal(loaded.lyric?.source.id, 'qq');
  assert.equal(loaded.activeKind, 'cloud');
  assert.deepEqual(loaded.variants, { cloud: true, local: false });
  const stored = JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8'));
  assert.equal(stored.version, 3);
  assert.equal(stored.userSelected, false);
  assert.equal(stored.selectionRevision, 0);
  assert.equal(stored.variants.cloud.source.id, 'qq');
});

test('automatic cache-first resolution selects a local bank when no explicit type was chosen', async t => {
  const { library } = await fixture(t);
  const local = {
    version: 2, trackId: 'demo-track', track: { trackId: 'demo-track', title: '泡沫', artist: 'G.E.M. 邓紫棋', album: '我是歌手第二季', duration: 247 },
    lrc: '[00:01.00]预存本地歌词', offsetMs: 0, offsetInText: true,
    source: { id: 'local-import', name: '本地导入' }, savedAt: new Date().toISOString(),
  };
  await fs.mkdir(library.defaultCacheDirectory, { recursive: true });
  await fs.writeFile(library.cacheFile('demo-track'), JSON.stringify({
    version: 3, trackId: 'demo-track', activeKind: 'cloud', userSelected: false, selectionRevision: 0,
    variants: { local },
  }), 'utf8');
  let calls = 0;
  mockFetch(t, async input => { calls += 1; throw new Error(`A stored local bank must win cache-first lookup: ${String(input)}`); });

  const result = await library.resolve({ trackId: 'demo-track' });
  const loaded = await library.load('demo-track');
  assert.equal(calls, 0);
  assert.equal(result.lyric.source.id, 'local-import');
  assert.equal(loaded.activeKind, 'local');
  assert.equal(loaded.userSelected, false);
  assert.equal(loaded.selectionRevision, 0);
  assert.deepEqual(loaded.variants, { cloud: false, local: true });
});

test('explicitly activating an empty Local bank persists the choice and blocks automatic cloud fallback', async t => {
  const { library } = await fixture(t);
  let calls = 0;
  mockFetch(t, async input => { calls += 1; throw new Error(`An explicitly selected empty Local bank must not query Cloud: ${String(input)}`); });

  const activated = await library.activate({ trackId: 'demo-track', kind: 'local' });
  assert.equal(activated.lyric, null);
  assert.equal(activated.activeKind, 'local');
  assert.equal(activated.userSelected, true);
  assert.equal(activated.selectionRevision, 1);
  assert.deepEqual(activated.variants, { cloud: false, local: false });
  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(calls, 0);
  assert.equal(result.lyric, null);
  assert.equal(result.activeKind, 'local');
  assert.equal(result.selectionRevision, 1);
});

test('choosing Cloud with a local bank searches and keeps Cloud active on later cache-first resolves', async t => {
  const { library } = await fixture(t);
  const localText = '[00:01.00]本地版本';
  await library.import({ trackId: 'demo-track', lrc: localText });
  const activated = await library.activate({ trackId: 'demo-track', kind: 'cloud' });
  assert.equal(activated.lyric, null);
  assert.equal(activated.activeKind, 'cloud');
  assert.equal(activated.userSelected, true);
  assert.equal(activated.selectionRevision, 2);
  const calls = [];
  mockFetch(t, async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-chosen-cloud'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: '[00:02.00]云端版本', trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected Cloud activation URL: ${url.href}`);
  });
  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric.source.id, 'qq');
  assert.equal(result.activeKind, 'cloud');
  assert.deepEqual(calls, ['/splcloud/fcgi-bin/smartbox_new.fcg', '/lyric/fcgi-bin/fcg_query_lyric_new.fcg']);

  const requestsBeforeCachedResolve = calls.length;
  const cached = await library.resolve({ trackId: 'demo-track' });
  const loaded = await library.load('demo-track');
  assert.equal(calls.length, requestsBeforeCachedResolve);
  assert.equal(cached.activeKind, 'cloud');
  assert.equal(cached.lyric.lrc, '[00:02.00]云端版本');
  assert.deepEqual(loaded.variants, { cloud: true, local: true });
  assert.equal(loaded.variants.local, true);
  assert.equal(loaded.lyric.source.id, 'qq');
  assert.equal(JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8')).activeKind, 'cloud');
});

test('an in-flight automatic result cannot claim an empty Local bank selected by the user', async t => {
  const { library } = await fixture(t);
  let signalLyricRequest;
  const lyricRequestStarted = new Promise(resolve => { signalLyricRequest = resolve; });
  let releaseAutomaticLyric;
  const automaticLyric = new Promise(resolve => { releaseAutomaticLyric = resolve; });
  mockFetch(t, async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-late-auto'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) {
      signalLyricRequest();
      return await new Promise((resolve, reject) => {
        const abort = () => reject(init.signal?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', abort, { once: true });
        automaticLyric.then(resolve, reject);
      });
    }
    throw new Error(`Unexpected late-auto URL: ${url.href}`);
  });

  const pending = library.resolve({ trackId: 'demo-track' });
  await lyricRequestStarted;
  const selected = await library.activate({ trackId: 'demo-track', kind: 'local' });
  assert.equal(selected.activeKind, 'local');
  assert.equal(selected.userSelected, true);
  releaseAutomaticLyric(jsonResponse({ retcode: 0, lyric: '[00:01.00]迟到云歌词', trans: '' }, 'text/html;charset=utf-8'));
  await pending;
  const loaded = await library.load('demo-track');
  assert.equal(loaded.activeKind, 'local');
  assert.equal(loaded.userSelected, true);
  assert.equal(loaded.selectionRevision, 1);
  assert.equal(loaded.lyric, null);
  assert.notEqual(loaded.activeKind, 'cloud');
});

test('an existing manual cache is returned without any network request or replacement', async t => {
  const { library } = await fixture(t);
  const manual = '[00:02.00]手动导入版本';
  await library.import({ trackId: 'demo-track', lrc: manual });
  await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 1250 });
  const savedBeforeResolve = (await library.load('demo-track')).lyric;
  let calls = 0;
  mockFetch(t, async input => {
    calls += 1;
    throw new Error(`Cached lyrics must not request ${String(input)}`);
  });

  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(calls, 0);
  assert.equal(result.lyric?.lrc, savedBeforeResolve?.lrc);
  assert.equal(result.lyric?.source.id, 'local-import');
  assert.equal(result.lyric?.offsetMs, 1250);
  assert.equal(result.activeKind, 'local');
  assert.deepEqual(result.variants, { cloud: false, local: true });
});

test('a QQ miss falls back to a matching enabled NetEase source', async t => {
  const { library } = await fixture(t);
  const calls = [];
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) {
      calls.push('qq-search');
      return qqSongs();
    }
    if (url.pathname === '/api/search/get/web') {
      calls.push('netease-search');
      return neteaseSongs(neteaseSong());
    }
    if (url.pathname === '/api/song/lyric') {
      calls.push('netease-lyric');
      return jsonResponse({ code: 200, lrc: { lyric: '[00:01.00]网易 fallback' }, tlyric: { lyric: '' } });
    }
    throw new Error(`Unexpected fallback URL: ${url.href}`);
  });

  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric?.source.id, 'netease');
  assert.equal(result.lyric?.lrc, '[00:01.00]网易 fallback');
  assert.equal(result.activeKind, 'cloud');
  assert.deepEqual(calls, ['qq-search', 'netease-search', 'netease-lyric']);
});

test('a QQ result for the wrong artist is rejected and resolution continues to the next source', async t => {
  const { library } = await fixture(t);
  const calls = [];
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) {
      calls.push('qq-search');
      return qqSongs(qqSong('qq-wrong-artist', '错误歌手'));
    }
    if (url.pathname === '/api/search/get/web') {
      calls.push('netease-search');
      return neteaseSongs(neteaseSong());
    }
    if (url.pathname === '/api/song/lyric') {
      calls.push('netease-lyric');
      return jsonResponse({ code: 200, lrc: { lyric: '[00:01.00]正确歌手歌词' } });
    }
    throw new Error(`Unexpected mismatch fallback URL: ${url.href}`);
  });

  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric?.source.id, 'netease');
  assert.equal(result.lyric?.lrc, '[00:01.00]正确歌手歌词');
  assert.equal(result.activeKind, 'cloud');
  assert.deepEqual(calls, ['qq-search', 'netease-search', 'netease-lyric']);
});

test('automatic resolution continues past built-in misses to an enabled custom source', async t => {
  const { library } = await fixture(t);
  await library.saveSources({ sources: [{
    id: 'custom-demo',
    name: '演示源',
    searchUrl: 'https://lyrics.example/search?q={query}',
    lyricUrl: 'https://lyrics.example/lyric?id={id}',
  }] });
  const calls = [];
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) {
      calls.push('qq-search');
      return qqSongs();
    }
    if (url.pathname === '/api/search/get/web') {
      calls.push('netease-search');
      return neteaseSongs();
    }
    if (url.hostname === 'lyrics.example' && url.pathname === '/search') {
      calls.push('custom-search');
      return jsonResponse({ results: [{ id: 'custom-match', title: '泡沫', artist: 'G.E.M. 邓紫棋', album: '我是歌手第二季', duration: 247 }] });
    }
    if (url.hostname === 'lyrics.example' && url.pathname === '/lyric') {
      calls.push('custom-lyric');
      return jsonResponse({ lrc: '[00:01.00]自定义来源歌词' });
    }
    throw new Error(`Unexpected custom fallback URL: ${url.href}`);
  });

  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric?.source.id, 'custom-demo');
  assert.equal(result.lyric?.lrc, '[00:01.00]自定义来源歌词');
  assert.deepEqual(calls, ['qq-search', 'netease-search', 'custom-search', 'custom-lyric']);
});

test('resolution rejects wrong-artist candidates from every enabled source without caching them', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-wrong', '错误歌手'));
    if (url.pathname === '/api/search/get/web') return neteaseSongs(neteaseSong(24681, '错误歌手'));
    throw new Error(`Wrong-artist candidates must never fetch lyrics: ${url.href}`);
  });

  const result = await library.resolve({ trackId: 'demo-track' });
  assert.equal(result.lyric, null);
  assert.deepEqual((await library.load('demo-track')).variants, { cloud: false, local: false });
});

test('cancelled automatic resolution rejects and leaves the cache untouched', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async (_input, init = {}) => await new Promise((_, reject) => {
    const signal = init.signal;
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener('abort', () => reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
  }));
  const controller = new AbortController();
  const pending = library.resolve({ trackId: 'demo-track' }, controller.signal);
  const timer = setTimeout(() => controller.abort(), 5);
  try {
    await assert.rejects(pending, error => error.name === 'AbortError');
  } finally {
    clearTimeout(timer);
  }
  assert.deepEqual((await library.load('demo-track')).variants, { cloud: false, local: false });
});

test('an automatic result arriving after a manual import cannot steal the active variant or overwrite its bank', async t => {
  const { library } = await fixture(t);
  const manual = '[00:02.00]手动优先';
  let signalLyricRequest;
  const lyricRequestStarted = new Promise(resolve => { signalLyricRequest = resolve; });
  let releaseAutomaticLyric;
  const automaticLyric = new Promise(resolve => { releaseAutomaticLyric = resolve; });
  mockFetch(t, async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong());
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) {
      signalLyricRequest();
      return await new Promise((resolve, reject) => {
        const abort = () => reject(init.signal?.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', abort, { once: true });
        automaticLyric.then(resolve, reject);
      });
    }
    throw new Error(`Unexpected race URL: ${url.href}`);
  });

  const pending = library.resolve({ trackId: 'demo-track' });
  await lyricRequestStarted;
  await library.import({ trackId: 'demo-track', lrc: manual });
  releaseAutomaticLyric(jsonResponse({ retcode: 0, lyric: '[00:01.00]自动歌词', trans: '' }, 'text/html;charset=utf-8'));
  await pending;
  const loaded = await library.load('demo-track');
  const stored = loaded.lyric;
  assert.equal(stored?.lrc, manual);
  assert.equal(stored?.source.id, 'local-import');
  assert.equal(loaded.activeKind, 'local');
  assert.equal(loaded.variants.local, true);
});

test('legacy v1 default migration is in-memory until the user saves and stale per-track source files are ignored', async t => {
  const { library } = await fixture(t);
  await fs.mkdir(library.directory, { recursive: true });
  const legacy = { version: 1, defaultSourceId: 'netease', cacheDirectory: library.defaultCacheDirectory, previousCacheDirectories: [] };
  await fs.writeFile(library.settingsFile, JSON.stringify(legacy), 'utf8');

  assert.equal((await library.settings()).settings.defaultSourceId, 'qq');
  assert.deepEqual(JSON.parse(await fs.readFile(library.settingsFile, 'utf8')), legacy);
  const stalePreferenceDirectory = path.join(library.directory, 'track-preferences');
  await fs.mkdir(stalePreferenceDirectory, { recursive: true });
  const stalePreferencePath = path.join(stalePreferenceDirectory, createHash('sha256').update('demo-track').digest('hex') + '.json');
  await fs.writeFile(stalePreferencePath, JSON.stringify({ version: 1, trackId: 'demo-track', sourceId: 'netease' }), 'utf8');
  const calls = [];
  mockFetch(t, async input => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-global-default'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: lyrics, trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected global-default URL: ${url.href}`);
  });
  const resolved = await library.resolve({ trackId: 'demo-track' });
  assert.equal(resolved.lyric.source.id, 'qq');
  assert.deepEqual(calls, ['/splcloud/fcgi-bin/smartbox_new.fcg', '/lyric/fcgi-bin/fcg_query_lyric_new.fcg']);
  const search = await library.search({ trackId: 'demo-track' });
  assert.equal(search.candidates[0].sourceId, 'qq');
  assert.equal(calls.at(-1), '/splcloud/fcgi-bin/smartbox_new.fcg', 'Manual search without a temporary source must use the global default, not the stale per-track file.');
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: library.defaultCacheDirectory });
  assert.equal(JSON.parse(await fs.readFile(library.settingsFile, 'utf8')).version, 2);
});

test('v2 settings retain an explicitly configured custom default source', async t => {
  const { library } = await fixture(t);
  const customSource = {
    id: 'custom-demo',
    name: '演示源',
    searchUrl: 'https://lyrics.example/search?q={query}',
    lyricUrl: 'https://lyrics.example/lyric?id={id}',
  };
  await fs.mkdir(library.directory, { recursive: true });
  await fs.writeFile(library.sourceFile, JSON.stringify({ version: 1, sources: [customSource] }), 'utf8');
  await fs.writeFile(library.settingsFile, JSON.stringify({
    version: 2,
    defaultSourceId: 'custom-demo',
    cacheDirectory: library.defaultCacheDirectory,
    previousCacheDirectories: [],
  }), 'utf8');

  assert.equal((await library.settings()).settings.defaultSourceId, 'custom-demo');
});

test('local import stores an exact UTF-8 cache copy and never records the original file path', async t => {
  const { library, root } = await fixture(t);
  const sourcePath = path.join(root, 'original.lrc');
  const originalText = '\uFEFF[offset:120]\r\n[00:01.00]正文 &amp; &#50;\r\n';
  const originalBytes = Buffer.from(originalText, 'utf8');
  await fs.writeFile(sourcePath, originalBytes);
  const before = await fs.readFile(sourcePath);

  await library.import({ trackId: 'demo-track', lrc: originalBytes.toString('utf8'), filePath: sourcePath });
  const cachePath = library.cacheFile('demo-track');
  const document = JSON.parse(await fs.readFile(cachePath, 'utf8'));
  assert.equal(path.extname(cachePath), '.json');
  assert.equal(path.dirname(cachePath), library.defaultCacheDirectory);
  assert.equal(document.version, 3);
  assert.equal(document.activeKind, 'local');
  assert.equal(document.userSelected, true);
  assert.equal(document.selectionRevision, 1);
  assert.equal(document.variants.local.version, 2);
  assert.equal(document.variants.local.offsetInText, true);
  assert.equal(document.variants.local.source.id, 'local-import');
  assert.equal(document.variants.local.lrc, originalText);
  assert.equal(document.variants.cloud, undefined);
  assert.deepEqual(await fs.readFile(sourcePath), before);
  assert.doesNotMatch(JSON.stringify(document), /original\.lrc|filePath|sourcePath|originalPath/i);

  const base64LikeText = 'QUJD'.repeat(32);
  await library.import({ trackId: 'demo-track', lrc: base64LikeText });
  const loaded = await library.load('demo-track');
  assert.equal(loaded.lyric.lrc, base64LikeText);
  assert.equal(loaded.activeKind, 'local');
  assert.deepEqual(loaded.variants, { cloud: false, local: true });
  assert.deepEqual(await fs.readFile(sourcePath), before);
});

test('repeated offset edits update the embedded base plus the current user adjustment once', async t => {
  const { library } = await fixture(t);
  await library.import({ trackId: 'demo-track', lrc: '[offset:120]\r\n[00:01.00]原始歌词\r\n' });

  const first = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 250 });
  assert.equal(first.lyric.version, 2);
  assert.equal(first.lyric.offsetInText, true);
  assert.equal(first.lyric.offsetMs, 250);
  assert.match(first.lyric.lrc, /^\[offset:370\]\r\n/);

  const second = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: -400 });
  assert.equal(second.lyric.offsetMs, -400);
  assert.match(second.lyric.lrc, /^\[offset:-280\]\r\n/);
  const stored = JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8'));
  assert.equal(stored.version, 3);
  assert.equal(stored.activeKind, 'local');
  assert.equal(stored.variants.local.offsetInText, true);
  assert.equal(stored.variants.local.offsetMs, -400);
  assert.match(stored.variants.local.lrc, /^\[offset:-280\]\r\n/);
});

test('cloud and local banks retain independent offsets, and legacy documents upgrade to V3 on write', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-offset'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: '[offset:40]\n[00:02.00]在线歌词', trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected online offset URL: ${url.href}`);
  });
  await library.import({ trackId: 'demo-track', lrc: '[offset:120]\n[00:01.00]本地歌词' });
  const search = await library.search({ trackId: 'demo-track', sourceId: 'qq' });
  const selected = await library.select({ trackId: 'demo-track', sourceId: 'qq', candidateId: search.candidates[0].id });
  assert.equal(selected.lyric.version, 2);
  assert.equal(selected.lyric.offsetInText, true);
  assert.equal(selected.activeKind, 'cloud');
  assert.equal(selected.userSelected, true);
  assert.equal(selected.selectionRevision, 2);
  const onlineOffset = await library.offset({ trackId: 'demo-track', kind: 'cloud', offsetMs: 300 });
  assert.equal(onlineOffset.lyric.offsetMs, 300);
  assert.match(onlineOffset.lyric.lrc, /^\[offset:340\]\n/);
  assert.equal(onlineOffset.activeKind, 'cloud');

  const localOffset = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: -250 });
  assert.equal(localOffset.lyric.source.id, 'local-import');
  assert.equal(localOffset.lyric.offsetMs, -250);
  assert.match(localOffset.lyric.lrc, /^\[offset:-130\]\n/);
  assert.equal(localOffset.activeKind, 'cloud', 'Offsetting the local bank must not change the active cloud bank.');
  assert.equal(localOffset.userSelected, true);
  assert.equal(localOffset.selectionRevision, 2, 'Offset editing must not change the user-selected variant revision.');
  const both = await library.load('demo-track');
  assert.equal(both.activeKind, 'cloud');
  assert.deepEqual(both.variants, { cloud: true, local: true });
  const bothCached = JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8'));
  assert.equal(bothCached.variants.cloud.offsetMs, 300);
  assert.equal(bothCached.variants.cloud.lrc.startsWith('[offset:340]'), true);
  assert.equal(bothCached.variants.local.offsetMs, -250);
  assert.equal(bothCached.variants.local.lrc.startsWith('[offset:-130]'), true);
  const localBankRead = await library.load('demo-track', 'local');
  assert.equal(localBankRead.lyric.source.id, 'local-import');
  assert.equal(localBankRead.lyric.offsetMs, -250);
  assert.equal(localBankRead.activeKind, 'cloud', 'Reading another bank must not change the persisted active kind.');
  assert.equal(localOffset.selectionRevision, 2, 'Offset editing must not increment the active-kind selection revision.');

  const legacyId = 'demo-track';
  const legacyDocument = {
    version: 1,
    trackId: legacyId,
    track: { trackId: legacyId, title: '泡沫', artist: 'G.E.M. 邓紫棋', album: '我是歌手第二季', duration: 247 },
    lrc: '[offset:100]\n[00:02.00]旧版歌词',
    offsetMs: 20,
    source: { id: 'netease', name: '网易云音乐' },
    savedAt: new Date().toISOString(),
  };
  const legacyPath = library.cacheFile(legacyId);
  await fs.writeFile(legacyPath, JSON.stringify(legacyDocument), 'utf8');
  const legacyOffset = await library.offset({ trackId: legacyId, kind: 'cloud', offsetMs: 200 });
  assert.equal(legacyOffset.lyric.version, 2);
  assert.equal(legacyOffset.lyric.offsetInText, true);
  assert.equal(legacyOffset.lyric.offsetMs, 200);
  assert.match(legacyOffset.lyric.lrc, /^\[offset:300\]\n/);
  const migrated = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
  assert.equal(migrated.version, 3);
  assert.equal(migrated.activeKind, 'cloud');
  assert.equal(migrated.variants.cloud.offsetMs, 200);
  assert.equal(migrated.variants.local, undefined);
});

test('replacing a lyric after changing cache folders leaves one validated document for that track', async t => {
  const { library, root } = await fixture(t);
  const firstDirectory = path.join(root, 'cache-first');
  const nextDirectory = path.join(root, 'cache-next');
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: firstDirectory });
  await library.import({ trackId: 'demo-track', lrc: '[00:01.00]first copy' });
  const firstFile = library.cacheFile('demo-track', firstDirectory);
  const defaultFile = library.cacheFile('demo-track', library.defaultCacheDirectory);
  await fs.mkdir(library.defaultCacheDirectory, { recursive: true });
  await fs.copyFile(firstFile, defaultFile);

  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: nextDirectory });
  const updated = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 350 });
  const currentFile = library.cacheFile('demo-track', nextDirectory);
  assert.equal(updated.lyric.offsetMs, 350);
  const current = JSON.parse(await fs.readFile(currentFile, 'utf8'));
  assert.equal(current.version, 3);
  assert.equal(current.variants.local.offsetInText, true);
  await assert.rejects(fs.access(firstFile), error => error.code === 'ENOENT');
  await assert.rejects(fs.access(defaultFile), error => error.code === 'ENOENT');

  await fs.copyFile(currentFile, firstFile);
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-cleanup'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: '[00:01.00]用户选中的歌词', trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected replacement URL: ${url.href}`);
  });
  const candidates = await library.search({ trackId: 'demo-track', sourceId: 'qq' });
  const selected = await library.select({ trackId: 'demo-track', sourceId: 'qq', candidateId: candidates.candidates[0].id });
  assert.equal(selected.lyric.source.id, 'qq');
  await assert.rejects(fs.access(firstFile), error => error.code === 'ENOENT');
  const remaining = [];
  for (const directory of library.cacheDirectories()) {
    try { await fs.access(library.cacheFile('demo-track', directory)); remaining.push(directory); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  assert.deepEqual(remaining, [nextDirectory]);
});

test('saving one track ignores unrelated files and refuses to overwrite its own corrupt cache', async t => {
  const { library } = await fixture(t);
  await fs.mkdir(library.defaultCacheDirectory, { recursive: true });
  const unrelatedFile = library.cacheFile('unrelated-track');
  const unrelatedBytes = Buffer.from('{ not a track cache }');
  await fs.writeFile(unrelatedFile, unrelatedBytes);
  await library.import({ trackId: 'demo-track', lrc: '[00:01.00]valid current track' });
  assert.deepEqual(await fs.readFile(unrelatedFile), unrelatedBytes);

  const currentFile = library.cacheFile('demo-track');
  const damagedBytes = Buffer.from('{"version":99,"trackId":"demo-track"}');
  await fs.writeFile(currentFile, damagedBytes);
  await assert.rejects(library.import({ trackId: 'demo-track', lrc: '[00:02.00]replacement' }));
  assert.deepEqual(await fs.readFile(currentFile), damagedBytes);
});

test('an offset save refuses to overwrite a newer manual lyric version', async t => {
  const { library } = await fixture(t);
  await library.import({ trackId: 'demo-track', lrc: '[00:01.00]offset started from this version' });
  const originalSave = library.save.bind(library);
  let signalOffsetSave;
  const offsetSaveStarted = new Promise(resolve => { signalOffsetSave = resolve; });
  let releaseOffsetSave;
  const offsetSaveGate = new Promise(resolve => { releaseOffsetSave = resolve; });
  library.save = async (trackId, contents, options = {}) => {
    if (options.expectedLyric) {
      signalOffsetSave();
      await offsetSaveGate;
    }
    return originalSave(trackId, contents, options);
  };

  const pendingOffset = library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 700 });
  await offsetSaveStarted;
  await library.import({ trackId: 'demo-track', lrc: '[00:02.00]new manual version wins' });
  releaseOffsetSave();
  await assert.rejects(pendingOffset, error => error.status === 409);
  const stored = (await library.load('demo-track')).lyric;
  assert.equal(stored.lrc, '[00:02.00]new manual version wins');
  assert.equal(stored.source.id, 'local-import');
});

test('a full 96 KiB local text can be offset and reloaded without altering its source file', async t => {
  const { library, root } = await fixture(t);
  const sourcePath = path.join(root, 'full-size-original.lrc');
  const originalText = 'L'.repeat(96 * 1024);
  const originalBytes = Buffer.from(originalText, 'utf8');
  await fs.writeFile(sourcePath, originalBytes);

  await library.import({ trackId: 'demo-track', lrc: originalText });
  const shifted = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 275 });
  const reloaded = await library.load('demo-track');
  assert.equal(shifted.lyric.version, 2);
  assert.equal(shifted.lyric.offsetInText, true);
  assert.equal(shifted.lyric.offsetMs, 275);
  assert.ok(Buffer.byteLength(shifted.lyric.lrc, 'utf8') <= 96 * 1024 + 128);
  assert.match(shifted.lyric.lrc, /^\[offset:275\]\n/);
  assert.equal(shifted.lyric.lrc.slice('[offset:275]\n'.length), originalText);
  assert.equal(reloaded.lyric.lrc, shifted.lyric.lrc);
  assert.deepEqual(await fs.readFile(sourcePath), originalBytes);
});

test('on Windows, a case-only cache-directory alias cannot unlink the current lyric file', async t => {
  if (process.platform !== 'win32') { t.skip('Windows path alias semantics are required'); return; }
  const { library, root } = await fixture(t);
  const firstDirectory = path.join(root, 'CaseCache');
  const aliasDirectory = path.join(root, 'casecache');
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: firstDirectory });
  await library.import({ trackId: 'demo-track', lrc: '[00:01.00]case alias' });
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: aliasDirectory });

  const updated = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 180 });
  const currentFile = library.cacheFile('demo-track', aliasDirectory);
  assert.equal((await fs.stat(currentFile)).isFile(), true);
  assert.equal((await library.load('demo-track')).lyric.lrc, updated.lyric.lrc);
  assert.equal(updated.lyric.offsetMs, 180);
});

test('on Windows, historical case aliases of one cache are cleaned once without removing the new file', async t => {
  if (process.platform !== 'win32') { t.skip('Windows path alias semantics are required'); return; }
  const { library, root } = await fixture(t);
  const historyDirectory = path.join(root, 'HistoryCache');
  const historyAlias = path.join(root, 'historycache');
  const currentDirectory = path.join(root, 'CurrentCache');
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: historyDirectory });
  await library.import({ trackId: 'demo-track', lrc: '[00:01.00]historical alias' });
  library.settingsConfig.previousCacheDirectories = [historyAlias];
  await library.saveSettings({ defaultSourceId: 'qq', cacheDirectory: currentDirectory });
  const updated = await library.offset({ trackId: 'demo-track', kind: 'local', offsetMs: 220 });

  const currentFile = library.cacheFile('demo-track', currentDirectory);
  assert.equal(JSON.parse(await fs.readFile(currentFile, 'utf8')).variants.local.offsetMs, 220);
  await assert.rejects(fs.access(library.cacheFile('demo-track', historyDirectory)), error => error.code === 'ENOENT');
  await assert.rejects(fs.access(library.cacheFile('demo-track', historyAlias)), error => error.code === 'ENOENT');
  const uniqueHistory = library.cacheDirectories().filter(directory => path.resolve(directory).toLowerCase() === path.resolve(historyDirectory).toLowerCase());
  assert.equal(uniqueHistory.length, 1);
  assert.equal((await library.load('demo-track')).lyric.lrc, updated.lyric.lrc);
});
