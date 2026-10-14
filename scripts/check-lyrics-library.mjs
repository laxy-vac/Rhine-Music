import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LyricsLibrary } from './lyrics-library.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lyrics = '[00:01.00]synthetic lyric line';

async function fixture() {
  const root = path.join(workspace, '.task-tmp', `lyrics-library-check-${process.pid}-${randomUUID()}`);
  const dataDir = path.join(root, 'music-data');
  await fs.mkdir(dataDir, { recursive: true });
  const library = new LyricsLibrary({
    dataDir,
    resolveTrack: async id => id === 'demo-track'
      ? { track: { id, title: '泡沫', artist: 'G.E.M. 邓紫棋', duration: 247 }, album: { title: '我是歌手第二季' } }
      : null,
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
  const { library } = await fixture();
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
  const { library } = await fixture();
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
  const { library } = await fixture();
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
  const { library } = await fixture();
  mockFetch(t, async input => new URL(String(input)).hostname === 'music.163.com'
    ? jsonResponse({ code: 200, result: { songCount: 0 } })
    : jsonResponse({ code: 0, data: { song: { count: 0 } } }));
  const result = await library.search({ trackId: 'demo-track', sourceId: 'auto' });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.sources.map(source=>source.status), ['empty', 'empty']);
});

test('an aborted auto search rejects instead of returning an empty result', async t => {
  const { library } = await fixture();
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
