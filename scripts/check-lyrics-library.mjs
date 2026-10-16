import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LyricsLibrary } from './lyrics-library.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactRoot = path.join(projectRoot, '.tools', 'future-lyrics', 'library-check');
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
  assert.equal(calls.length, 2);
  assert.equal((await library.load('demo-track')).lyric.lrc, lyrics);
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
  await library.savePreferences({ trackId: 'demo-track', sourceId: 'qq' });
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
  assert.equal((await library.load('demo-track')).lyric?.source.id, 'qq');
});

test('an existing manual cache is returned without any network request or replacement', async t => {
  const { library } = await fixture(t);
  const manual = '[00:02.00]手动导入版本';
  await library.import({ trackId: 'demo-track', lrc: manual });
  await library.offset({ trackId: 'demo-track', offsetMs: 1250 });
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
  assert.equal((await library.load('demo-track')).lyric, null);
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
  assert.equal((await library.load('demo-track')).lyric, null);
});

test('an automatic result arriving after a manual import cannot overwrite the manual cache', async t => {
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
  const stored = (await library.load('demo-track')).lyric;
  assert.equal(stored?.lrc, manual);
  assert.equal(stored?.source.id, 'local-import');
});

test('legacy v1 default migration is in-memory until the user saves, while explicit source choices survive', async t => {
  const { library } = await fixture(t);
  await fs.mkdir(library.directory, { recursive: true });
  const legacy = { version: 1, defaultSourceId: 'netease', cacheDirectory: library.defaultCacheDirectory, previousCacheDirectories: [] };
  await fs.writeFile(library.settingsFile, JSON.stringify(legacy), 'utf8');

  assert.equal((await library.settings()).settings.defaultSourceId, 'qq');
  assert.deepEqual(JSON.parse(await fs.readFile(library.settingsFile, 'utf8')), legacy);
  await library.savePreferences({ trackId: 'demo-track', sourceId: 'netease' });
  assert.equal((await library.preferences('demo-track')).effectiveSourceId, 'netease');
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
  assert.equal(document.version, 2);
  assert.equal(document.offsetInText, true);
  assert.equal(document.source.id, 'local-import');
  assert.equal(document.lrc, originalText);
  assert.deepEqual(await fs.readFile(sourcePath), before);
  assert.doesNotMatch(JSON.stringify(document), /original\.lrc|filePath|sourcePath|originalPath/i);

  const base64LikeText = 'QUJD'.repeat(32);
  await library.import({ trackId: 'demo-track', lrc: base64LikeText });
  assert.equal((await library.load('demo-track')).lyric.lrc, base64LikeText);
  assert.deepEqual(await fs.readFile(sourcePath), before);
});

test('repeated offset edits update the embedded base plus the current user adjustment once', async t => {
  const { library } = await fixture(t);
  await library.import({ trackId: 'demo-track', lrc: '[offset:120]\r\n[00:01.00]原始歌词\r\n' });

  const first = await library.offset({ trackId: 'demo-track', offsetMs: 250 });
  assert.equal(first.lyric.version, 2);
  assert.equal(first.lyric.offsetInText, true);
  assert.equal(first.lyric.offsetMs, 250);
  assert.match(first.lyric.lrc, /^\[offset:370\]\r\n/);

  const second = await library.offset({ trackId: 'demo-track', offsetMs: -400 });
  assert.equal(second.lyric.offsetMs, -400);
  assert.match(second.lyric.lrc, /^\[offset:-280\]\r\n/);
  const stored = JSON.parse(await fs.readFile(library.cacheFile('demo-track'), 'utf8'));
  assert.equal(stored.offsetInText, true);
  assert.equal(stored.offsetMs, -400);
  assert.match(stored.lrc, /^\[offset:-280\]\r\n/);
});

test('online selection and legacy cache offsets migrate into version 2 text without double counting', async t => {
  const { library } = await fixture(t);
  mockFetch(t, async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/smartbox_new.fcg')) return qqSongs(qqSong('qq-offset'));
    if (url.pathname.endsWith('/fcg_query_lyric_new.fcg')) return jsonResponse({ retcode: 0, lyric: '[offset:40]\n[00:02.00]在线歌词', trans: '' }, 'text/html;charset=utf-8');
    throw new Error(`Unexpected online offset URL: ${url.href}`);
  });
  const search = await library.search({ trackId: 'demo-track', sourceId: 'qq' });
  const selected = await library.select({ trackId: 'demo-track', sourceId: 'qq', candidateId: search.candidates[0].id });
  assert.equal(selected.lyric.version, 2);
  assert.equal(selected.lyric.offsetInText, true);
  const onlineOffset = await library.offset({ trackId: 'demo-track', offsetMs: 300 });
  assert.equal(onlineOffset.lyric.offsetMs, 300);
  assert.match(onlineOffset.lyric.lrc, /^\[offset:340\]\n/);

  const legacyId = 'demo-track';
  await fs.writeFile(library.cacheFile(legacyId), JSON.stringify({
    version: 1,
    trackId: legacyId,
    track: { trackId: legacyId, title: '泡沫', artist: 'G.E.M. 邓紫棋', album: '我是歌手第二季', duration: 247 },
    lrc: '[offset:100]\n[00:02.00]旧版歌词',
    offsetMs: 20,
    source: { id: 'netease', name: '网易云音乐' },
    savedAt: new Date().toISOString(),
  }), 'utf8');
  const legacyOffset = await library.offset({ trackId: legacyId, offsetMs: 200 });
  assert.equal(legacyOffset.lyric.version, 2);
  assert.equal(legacyOffset.lyric.offsetInText, true);
  assert.equal(legacyOffset.lyric.offsetMs, 200);
  assert.match(legacyOffset.lyric.lrc, /^\[offset:300\]\n/);
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
  const updated = await library.offset({ trackId: 'demo-track', offsetMs: 350 });
  const currentFile = library.cacheFile('demo-track', nextDirectory);
  assert.equal(updated.lyric.offsetMs, 350);
  assert.equal(JSON.parse(await fs.readFile(currentFile, 'utf8')).offsetInText, true);
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

  const pendingOffset = library.offset({ trackId: 'demo-track', offsetMs: 700 });
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
  const shifted = await library.offset({ trackId: 'demo-track', offsetMs: 275 });
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

  const updated = await library.offset({ trackId: 'demo-track', offsetMs: 180 });
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
  const updated = await library.offset({ trackId: 'demo-track', offsetMs: 220 });

  const currentFile = library.cacheFile('demo-track', currentDirectory);
  assert.equal(JSON.parse(await fs.readFile(currentFile, 'utf8')).offsetMs, 220);
  await assert.rejects(fs.access(library.cacheFile('demo-track', historyDirectory)), error => error.code === 'ENOENT');
  await assert.rejects(fs.access(library.cacheFile('demo-track', historyAlias)), error => error.code === 'ENOENT');
  const uniqueHistory = library.cacheDirectories().filter(directory => path.resolve(directory).toLowerCase() === path.resolve(historyDirectory).toLowerCase());
  assert.equal(uniqueHistory.length, 1);
  assert.equal((await library.load('demo-track')).lyric.lrc, updated.lyric.lrc);
});
