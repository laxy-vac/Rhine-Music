// Isolated end-to-end probe for the hidden Electron startup gate.
// Run with: node desktop/check-startup-entry.cjs
// This script starts a synthetic local music server and the real Electron
// runtime/preload/renderer, but never executes desktop/main.cjs or accesses a
// user's library, preferences, audio devices, or online services.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { pathToFileURL } = require('node:url');

if (process.versions.electron) {
  runElectronProbe().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
} else {
  runLauncher().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}

const pngCrcTable = new Uint32Array(256);
for (let index = 0; index < pngCrcTable.length; index++) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  pngCrcTable[index] = value >>> 0;
}

function pngCrc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ pngCrcTable[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const tag = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  tag.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([tag, payload])), payload.length + 8);
  return chunk;
}

function fixtureColor(number) {
  const hue = (number * 137.508) % 360;
  const saturation = 0.66, lightness = 0.42;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = hue / 60;
  const secondary = chroma * (1 - Math.abs(segment % 2 - 1));
  const rgb = segment < 1 ? [chroma, secondary, 0]
    : segment < 2 ? [secondary, chroma, 0]
    : segment < 3 ? [0, chroma, secondary]
    : segment < 4 ? [0, secondary, chroma]
    : segment < 5 ? [secondary, 0, chroma]
    : [chroma, 0, secondary];
  const offset = lightness - chroma / 2;
  return rgb.map(channel => Math.round((channel + offset) * 255));
}

const fixtureDigitFont = {
  '0':['11111','10001','10011','10101','11001','10001','11111'],
  '1':['00100','01100','00100','00100','00100','00100','01110'],
  '2':['11111','00001','00001','11111','10000','10000','11111'],
  '3':['11111','00001','00001','01111','00001','00001','11111'],
  '4':['10001','10001','10001','11111','00001','00001','00001'],
  '5':['11111','10000','10000','11111','00001','00001','11111'],
  '6':['01111','10000','10000','11111','10001','10001','01111'],
  '7':['11111','00001','00010','00100','01000','01000','01000'],
  '8':['01110','10001','10001','01110','10001','10001','01110'],
  '9':['01110','10001','10001','01111','00001','00001','11110'],
};

function makeFixturePngDataUrl(number) {
  const width = 128, height = 128, scale = 10, stride = width * 4 + 1;
  const base = fixtureColor(number);
  const accent = base.map(channel => Math.max(0, Math.round(channel * 0.46)));
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const color = (x < 40 && y < 40) || (x >= 88 && y >= 88) ? accent : base;
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = 255;
    }
  }
  const digits = String(number).padStart(2, '0');
  const textWidth = 11 * scale, originX = Math.floor((width - textWidth) / 2), originY = Math.floor((height - 7 * scale) / 2);
  const drawText = (color, offsetX, offsetY) => {
    [...digits].forEach((digit, digitIndex) => {
      const glyph = fixtureDigitFont[digit];
      glyph.forEach((row, rowIndex) => {
        [...row].forEach((pixel, columnIndex) => {
          if (pixel !== '1') return;
          const left = originX + (digitIndex * 6 + columnIndex) * scale + offsetX;
          const top = originY + rowIndex * scale + offsetY;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
            if (left + dx < 0 || left + dx >= width || top + dy < 0 || top + dy >= height) continue;
            const offset = (top + dy) * stride + 1 + (left + dx) * 4;
            raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = 255;
          }
        });
      });
    });
  };
  drawText([0, 0, 0], 2, 3);
  drawText([255, 248, 232], 0, 0);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function makeSyntheticPanelLibrary({ archiveMotion = false } = {}) {
  const genres = [
    { id: 'fixture-ambient', name: 'Fixture Ambient' },
    { id: 'fixture-electronic', name: 'Fixture Electronic' },
    { id: 'fixture-cinematic', name: 'Fixture Cinematic' },
  ];
  const colors = ['#d96f32', '#2e6f89', '#648755', '#745785', '#bb8539', '#446c72'];
  const genreSizes = archiveMotion ? [7, 28, 10] : [12, 12, 12];
  const albumCount = genreSizes.reduce((total, count) => total + count, 0);
  const genreIndexForAlbum = albumIndex => {
    let firstIndex = 0;
    for (let genreIndex = 0; genreIndex < genreSizes.length; genreIndex++) {
      firstIndex += genreSizes[genreIndex];
      if (albumIndex < firstIndex) return genreIndex;
    }
    return genreSizes.length - 1;
  };
  const albums = Array.from({ length: albumCount }, (_, albumIndex) => {
    const number = String(albumIndex + 1).padStart(2, '0');
    const title = albumIndex === 0
      ? 'Needlemark Fixture Album — An Exceptionally Long Synthetic Title for Search and Ellipsis Checks'
      : `Synthetic Long-Title Catalog Album ${number} — The Quiet Geometry of Several Imaginary Listening Rooms`;
    const genre = genres[archiveMotion ? genreIndexForAlbum(albumIndex) : albumIndex % genres.length];
    const archiveMotionHiResAlbum = archiveMotion && albumIndex === 0;
    const tracks = Array.from({ length: 3 }, (_, trackIndex) => ({
      id: `fixture-track-${number}-${trackIndex + 1}`, albumId: `fixture-album-${number}`,
      title: albumIndex === 0 && trackIndex === 0
        ? 'Needlemark Search Track — A Long Fixture Song Name for Filtering'
        : `Synthetic Track ${String(trackIndex + 1).padStart(2, '0')} — A Long Fixture Song Title`,
      artist: `Synthetic Artist ${number}`, trackNumber: trackIndex + 1, discNumber: 1,
      duration: 186 + trackIndex * 29,
      format: archiveMotionHiResAlbum ? 'FLAC' : 'MP3', codec: archiveMotionHiResAlbum ? 'FLAC' : 'MP3',
      lossless: archiveMotionHiResAlbum,
      ...(archiveMotionHiResAlbum ? { sampleRate:192000, bitsPerSample:24 } : {}),
      browserPlayable: true, audioUrl: `/api/audio/fixture-track-${number}-${trackIndex + 1}`,
      relativePath: `fixture-only/${number}/${trackIndex + 1}.mp3`,
    }));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480"><rect width="480" height="480" fill="${colors[albumIndex % colors.length]}"/><path d="M0 360 480 90v390H0z" fill="#101820" fill-opacity=".72"/><circle cx="338" cy="152" r="74" fill="none" stroke="#f5ead6" stroke-width="9"/><text x="32" y="420" fill="#fff" font-family="sans-serif" font-size="32">FIXTURE ${number}</text></svg>`;
    return {
      id: `fixture-album-${number}`, title, artist: `Synthetic Artist ${number}`, year: 1990 + albumIndex,
      genreId: genre.id, rawGenres: [genre.name], folder: `synthetic-fixture/${number}`,
      coverUrl: archiveMotion ? makeFixturePngDataUrl(albumIndex + 1)
        : `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      tracks, producers: [], offline: false, online: { status: 'unqueried' },
    };
  });
  genres.forEach(genre => { genre.albumCount = albums.filter(album => album.genreId === genre.id).length; });
  return {
    version: 1, albums, genres, roots: [], scan: { running: false }, onlineEnabled: false,
    enrich: { running: false, completed: 0, total: 0 },
    introductions: { running: false, completed: 0, total: 0, updated: 0, notFound: 0, failed: 0 },
  };
}

function makeSyntheticPanelOnline() {
  const panelCalls = { sources: 0, snapshots: 0, searchRequests: [], forbiddenMutations: [] };
  const emptyLibrary = () => ({
    version: 1, albums: [], genres: [], roots: [], scan: { running: false }, onlineEnabled: true,
    enrich: { running: false, completed: 0, total: 0 },
    introductions: { running: false, completed: 0, total: 0, updated: 0, notFound: 0, failed: 0 },
  });
  return {
    panelCalls,
    async snapshot() { panelCalls.snapshots++; return emptyLibrary(); },
    async sources() {
      panelCalls.sources++;
      return { sources: [
        { id: 'internetarchive', name: 'Synthetic Archive', configured: true },
        { id: 'subsonic', name: 'Synthetic private service', configured: true },
      ], subsonic: { baseUrl: 'http://fixture.invalid', username: 'fixture-user', passwordSet: false } };
    },
    async search(source, query, { page = 1, collection } = {}) {
      const cleanQuery = String(query ?? '');
      panelCalls.searchRequests.push({ source, query: cleanQuery, page, collection: collection ?? '' });
      const items = Array.from({ length: 18 }, (_, index) => ({
        ref: `fixture-online-${String(index + 1).padStart(2, '0')}`,
        title: `Fixture Panel ${index + 1} — An Extraordinarily Long Mock Search Result Title for Ellipsis Testing`,
        artist: `Synthetic Search Artist ${String(index + 1).padStart(2, '0')}`,
        year: 2000 + index,
      }));
      return { total: items.length, page, items, hasMore: false };
    },
    async configureSubsonic() { panelCalls.forbiddenMutations.push('configureSubsonic'); throw new Error('Synthetic panel test never submits service details.'); },
    async testSubsonic() { panelCalls.forbiddenMutations.push('testSubsonic'); throw new Error('Synthetic panel test never connects to a service.'); },
    async add() { panelCalls.forbiddenMutations.push('add'); throw new Error('Synthetic panel test does not add online content.'); },
    async remove() { panelCalls.forbiddenMutations.push('remove'); throw new Error('Synthetic panel test does not remove online content.'); },
    async trackTarget() { return null; },
    async coverTarget() { return null; },
  };
}

async function runLauncher() {
  const { spawn } = require('node:child_process');
  const { pathToFileURL } = require('node:url');
  const projectRoot = path.resolve(__dirname, '..');
  const graphicsOnlyMode = process.argv.includes('--graphics');
  const manualGpuMode = graphicsOnlyMode && process.argv.includes('--gpu-manual');
  const themeFollowMode = process.argv.includes('--theme-follow') || graphicsOnlyMode;
  const caseGlassMode = process.argv.includes('--case-glass');
  const futurePanelsMode = process.argv.includes('--future-panels');
  const futureEntryMode = process.argv.includes('--future-entry');
  const archiveMotionMode = process.argv.includes('--archive-motion');
  const expectedSyntheticAlbumCount = archiveMotionMode ? 45 : 36;
  const syntheticFixtureMode = futurePanelsMode || futureEntryMode || caseGlassMode || archiveMotionMode;
  if ([themeFollowMode, futurePanelsMode, futureEntryMode, caseGlassMode, archiveMotionMode].filter(Boolean).length > 1)
    throw new Error('Choose one isolated checker mode per Electron process.');
  const toolRoot = path.join(projectRoot, '.tools', archiveMotionMode ? 'archive-motion-2026-10-18' : graphicsOnlyMode ? 'graphics-2026-10-17' : caseGlassMode ? 'case-glass-2026-10-17' : futureEntryMode ? 'future-entry-2026-10-17' : futurePanelsMode ? 'future-panels-2026-10-17' : themeFollowMode ? 'theme-follow-2026-10-17' : 'startup-recovery-2026-10-17');
  const electronPath = path.join(projectRoot, '.tools', 'source-preview-electron', 'electron.exe');
  const distDirectory = path.join(projectRoot, '.tools', 'source-preview-interface');
  const runDirectory = path.join(toolRoot, `desktop-entry-${Date.now()}-${process.pid}`);
  const appDirectory = path.join(runDirectory, 'electron-app');
  const serviceDataDirectory = path.join(runDirectory, 'synthetic-service-data');
  const appPaths = {
    userData: path.join(runDirectory, 'profile', 'userData'),
    sessionData: path.join(runDirectory, 'profile', 'sessionData'),
    temp: path.join(runDirectory, 'profile', 'temp'),
    crashDumps: path.join(runDirectory, 'profile', 'crashDumps'),
    logs: path.join(runDirectory, 'profile', 'logs'),
  };
  const electronReportPath = path.join(runDirectory, 'electron-report.json');
  const finalReportPath = path.join(runDirectory, 'startup-report.json');
  const configPath = path.join(runDirectory, 'probe-config.json');
  const serviceRequests = [];
  const deniedNodeFetches = [];
  const originalFetch = globalThis.fetch;
  let service;
  let store;
  let syntheticPanelLibrary;
  let panelOnlineCalls;
  let adapterCalls;
  let scanCalls = 0;
  let childResult;
  let electronReport;

  const report = {
    ok: false,
    mode: archiveMotionMode ? 'production-electron-archive-motion' : caseGlassMode ? 'production-electron-case-glass' : graphicsOnlyMode ? 'production-electron-graphics' : futureEntryMode ? 'production-electron-future-entry' : futurePanelsMode ? 'production-electron-future-panels' : themeFollowMode ? 'production-electron-theme-follow' : 'production-hidden-gate-full-electron-entry',
    projectRoot,
    electronPath,
    distDirectory,
    runDirectory,
    finalReportPath,
    syntheticDataOnly: true,
    realDesktopMainExecuted: false,
    realPreloadAndRendererUsed: true,
    externalNetworkAllowed: false,
    serviceRequests,
    deniedNodeFetches,
  };

  const allowedURL = (input, localOrigin) => {
    try {
      const value = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(value);
      return url.origin === localOrigin || ['data:', 'blob:', 'file:'].includes(url.protocol);
    } catch {
      return false;
    }
  };
  const redactedTarget = input => {
    try {
      const value = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
      const url = new URL(value);
      return `${url.protocol}//${url.host}`;
    } catch {
      return '<unparseable target>';
    }
  };
  const observeAdapter = adapter => {
    const calls = {};
    for (const [name, method] of Object.entries(adapter)) {
      if (typeof method !== 'function') continue;
      calls[name] = 0;
      adapter[name] = function (...args) {
        calls[name]++;
        return method.apply(this, args);
      };
    }
    return calls;
  };

  try {
    await fs.access(electronPath);
    await fs.access(path.join(distDirectory, 'index.html'));
    await fs.mkdir(appDirectory, { recursive: true });
    await fs.mkdir(path.join(toolRoot), { recursive: true });

    const { createMusicServer } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'music-server.mjs')).href);
    const { MusicLibraryStore } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'music-library.mjs')).href);
    const { mockNative, mockSony, mockFtp, mockOnline } = await import(pathToFileURL(path.join(projectRoot, 'desktop', 'check-preview-ui.mjs')).href);

    globalThis.fetch = async input => {
      const target = redactedTarget(input);
      deniedNodeFetches.push(target);
      throw new Error(`External Node fetch disabled in isolated startup probe: ${target}`);
    };

    store = await new MusicLibraryStore({
      dataDir: serviceDataDirectory,
      defaultRoots: [],
      musicBrainzContact: '',
      fetcher: globalThis.fetch,
    }).init();
    if (syntheticFixtureMode) {
      syntheticPanelLibrary = makeSyntheticPanelLibrary({ archiveMotion:archiveMotionMode });
      if (caseGlassMode) {
        for (const track of syntheticPanelLibrary.albums[0].tracks) Object.assign(track, {
          format: 'FLAC', codec: 'FLAC', lossless: true, sampleRate: 96000, bitsPerSample: 24,
        });
        const coverPng = await fs.readFile(path.join(projectRoot, 'public', 'icons', 'icon-512.png'));
        syntheticPanelLibrary.albums[0].coverUrl = `data:image/png;base64,${coverPng.toString('base64')}`;
      }
      store.snapshot = () => structuredClone(syntheticPanelLibrary);
    }
    const initialLibrary = store.snapshot();
    if (!syntheticFixtureMode && (initialLibrary.albums.length !== 0 || initialLibrary.roots.length !== 0)) {
      throw new Error('Isolated library must start empty and without music roots.');
    }
    const expectedGenreCounts = archiveMotionMode ? [7, 28, 10] : [12, 12, 12];
    const actualGenreCounts = syntheticPanelLibrary?.genres.map(genre => genre.albumCount) ?? [];
    if (syntheticFixtureMode && (initialLibrary.albums.length !== expectedSyntheticAlbumCount || initialLibrary.roots.length !== 0 ||
        !initialLibrary.albums.every(album => album.id.startsWith('fixture-album-')) ||
        actualGenreCounts.some((count, index) => count !== expectedGenreCounts[index]) || actualGenreCounts.length !== expectedGenreCounts.length)) {
      throw new Error(`Synthetic fixture must contain only the deterministic ${expectedSyntheticAlbumCount}-album set with its expected genre groups.`);
    }
    store.scan = async () => {
      scanCalls++;
      throw new Error('Music library scanning is disabled in this startup probe.');
    };

    const native = mockNative();
    const sony = mockSony();
    const ftp = mockFtp();
    const online = futurePanelsMode ? makeSyntheticPanelOnline() : mockOnline();
    panelOnlineCalls = online.panelCalls ?? null;
    const onlineAdapterCalls = observeAdapter(online);
    if (panelOnlineCalls) onlineAdapterCalls.panelCalls = panelOnlineCalls;
    adapterCalls = {
      native: native.calls,
      sony: sony.calls,
      ftp: observeAdapter(ftp),
      online: onlineAdapterCalls,
    };
    service = await createMusicServer({
      dataDir: serviceDataDirectory,
      distDir: distDirectory,
      defaultRoots: [],
      autoScan: false,
      store,
      native,
      sony,
      ftp,
      online,
    });
    service.server.on('request', (request, response) => {
      const entry = { method: request.method, path: request.url, origin: request.headers.origin ?? null };
      serviceRequests.push(entry);
      response.once('finish', () => { entry.status = response.statusCode; });
    });
    await new Promise((resolve, reject) => {
      service.server.once('error', reject);
      service.server.listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${service.server.address().port}`;

    const config = {
      projectRoot,
      distDirectory,
      preloadPath: path.join(projectRoot, 'desktop', 'preload.cjs'),
      electronReportPath,
      serviceOrigin: origin,
      appPaths,
      preferences: {
        language: futurePanelsMode ? 'zh-CN' : 'en',
        theme: 'day',
        followSystemTheme: false,
        themeLayoutVersion: 2,
        sound: false,
        bgm: false,
        bgmVolume: 0,
        volume: 0,
        reduced: false,
        output: { backend: 'browser' },
        ...(futureEntryMode || caseGlassMode || archiveMotionMode ? {
          entryOnOpen: futureEntryMode,
          style: { design: 'rhine' },
          view: { layout: archiveMotionMode ? 'shelf' : 'array', show: 'albums', group: 'genre', sort: 'artist', gridPageSize: 36 },
          ...(archiveMotionMode ? { caseProfiles: { rhine: { version:1, enabled:true, structure:'rhine' } } } : {}),
        } : {}),
      },
      reloadOnce: !themeFollowMode && !futurePanelsMode && !futureEntryMode && !caseGlassMode && !archiveMotionMode,
      themeFollow: themeFollowMode,
      graphicsOnly: graphicsOnlyMode,
      gpuStartupPreferenceFile: path.join(runDirectory, 'startup-gpu-preferences.json'),
      futurePanels: futurePanelsMode,
      futureEntry: futureEntryMode,
      caseGlass: caseGlassMode,
      archiveMotion: archiveMotionMode,
      syntheticPanelAlbumCount: syntheticPanelLibrary?.albums.length ?? 0,
      syntheticPanelGenreCounts: syntheticPanelLibrary?.genres.map(genre => genre.albumCount) ?? [],
      archiveMotionLongGroupProbeAlbumId: archiveMotionMode
        ? `fixture-album-${String((syntheticPanelLibrary?.genres[0]?.albumCount ?? 0) + 21).padStart(2, '0')}` : null,
      archiveMotionFixtureCatalog: archiveMotionMode ? {
        groups: syntheticPanelLibrary.genres.map(genre => ({
          id: genre.id,
          name: genre.name,
          entryKeys: syntheticPanelLibrary.albums.filter(album => album.genreId === genre.id).map(album => album.id),
        })),
      } : null,
      archiveMotionFixtureHiRes: archiveMotionMode ? {
        albumId:'fixture-album-01',
        trackCount:syntheticPanelLibrary.albums.find(album => album.id === 'fixture-album-01')?.tracks.length ?? 0,
        qualifyingTrackCount:syntheticPanelLibrary.albums.find(album => album.id === 'fixture-album-01')?.tracks.filter(track =>
          track.lossless === true && track.sampleRate >= 192000 && track.bitsPerSample >= 24).length ?? 0,
      } : null,
      archiveMotionUsesOnlyPngCovers: !archiveMotionMode || initialLibrary.albums.length === 45 && initialLibrary.albums.every(album => album.coverUrl.startsWith('data:image/png;base64,')),
      caseGlassFixtureHiRes: !caseGlassMode || (syntheticPanelLibrary?.albums[0]?.tracks.length > 0 && syntheticPanelLibrary.albums[0].tracks.every(track => track.lossless === true && track.sampleRate === 96000 && track.bitsPerSample === 24)),
      runDirectory,
    };
    if (manualGpuMode) {
      const { enumerateAdapters, adapterToPreference } = require(path.join(projectRoot, 'desktop', 'gpu-selection.cjs'));
      await fs.mkdir(appPaths.temp, { recursive: true });
      const previousTemp = process.env.TEMP, previousTmp = process.env.TMP;
      try {
        process.env.TEMP = appPaths.temp; process.env.TMP = appPaths.temp;
        const adapters = await enumerateAdapters();
        if (!adapters.length) throw new Error('Manual GPU check requires at least one usable adapter.');
        config.preferences.gpuPreference = adapterToPreference(adapters[0]);
        await fs.writeFile(config.gpuStartupPreferenceFile, JSON.stringify({ gpuPreference: config.preferences.gpuPreference }));
      } finally {
        if (previousTemp === undefined) delete process.env.TEMP; else process.env.TEMP = previousTemp;
        if (previousTmp === undefined) delete process.env.TMP; else process.env.TMP = previousTmp;
      }
    }
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await fs.copyFile(__filename, path.join(appDirectory, 'main.cjs'));
    if (themeFollowMode) {
      await fs.copyFile(path.join(projectRoot, 'desktop', 'check-theme-follow.mjs'), path.join(appDirectory, 'check-theme-follow.mjs'));
    }
    if (futurePanelsMode) {
      await fs.copyFile(path.join(projectRoot, 'desktop', 'check-future-panels.mjs'), path.join(appDirectory, 'check-future-panels.mjs'));
    }
    if (futureEntryMode) {
      await fs.copyFile(path.join(projectRoot, 'desktop', 'check-future-entry.mjs'), path.join(appDirectory, 'check-future-entry.mjs'));
    }
    if (caseGlassMode) {
      await fs.copyFile(path.join(projectRoot, 'desktop', 'check-case-glass.mjs'), path.join(appDirectory, 'check-case-glass.mjs'));
    }
    if (archiveMotionMode) {
      await fs.copyFile(path.join(projectRoot, 'desktop', 'check-archive-motion.mjs'), path.join(appDirectory, 'check-archive-motion.mjs'));
    }
    await fs.writeFile(path.join(appDirectory, 'package.json'), `${JSON.stringify({
      name: 'rhine-isolated-startup-entry-probe',
      version: '1.0.0',
      main: 'main.cjs',
    }, null, 2)}\n`, 'utf8');

    const environment = { ...process.env, RHINE_STARTUP_PROBE_CONFIG: configPath };
    delete environment.ELECTRON_RUN_AS_NODE;
    childResult = await new Promise((resolve, reject) => {
      const child = spawn(electronPath, [appDirectory, ...((futureEntryMode || themeFollowMode || caseGlassMode || archiveMotionMode) ? ['--capture-probe'] : [])], {
        cwd: projectRoot,
        env: environment,
        // Match launch-source-preview.mjs: SW_HIDE at process creation can
        // prevent Electron's first native BrowserWindow.show() on Windows.
        windowsHide: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      // Entry covers the cinematic, text edits and both themes. Theme-follow
      // covers palette/layout cases and reload. Keep watchdogs mode-specific.
      const timeout = setTimeout(() => child.kill(), archiveMotionMode ? 300000 : futureEntryMode || caseGlassMode ? 210000 : themeFollowMode ? 150000 : 90000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-12000); if (caseGlassMode || archiveMotionMode) process.stdout.write(chunk); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
      child.once('close', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout, stderr }); });
    });
    try {
      electronReport = JSON.parse(await fs.readFile(electronReportPath, 'utf8'));
    } catch (error) {
      electronReport = { reportMissing: true, error: error.message };
    }

    report.electron = {
      ...electronReport,
      exitCode: childResult.code,
      signal: childResult.signal,
      stdout: childResult.stdout,
      stderr: childResult.stderr,
    };
    report.serviceOrigin = origin;
    report.serviceRequests = serviceRequests;
    report.deniedNodeFetches = deniedNodeFetches;
    report.adapterCalls = adapterCalls;
    report.onlineMockCalls = panelOnlineCalls;
    report.libraryScanCalls = scanCalls;
    report.initialLibrary = {
      albums: initialLibrary.albums.length,
      roots: initialLibrary.roots.length,
      syntheticPanelFixture: futurePanelsMode,
      syntheticFutureEntryFixture: futureEntryMode,
      syntheticCaseGlassFixture: caseGlassMode,
      syntheticArchiveMotionFixture: archiveMotionMode,
      genres: syntheticPanelLibrary?.genres.map(genre => ({ id: genre.id, albumCount: genre.albumCount })) ?? [],
      caseGlassHiResAlbum: caseGlassMode ? { trackCount: initialLibrary.albums[0]?.tracks.length ?? 0, hiResTrackCount: initialLibrary.albums[0]?.tracks.filter(track => track.lossless === true && track.sampleRate === 96000 && track.bitsPerSample === 24).length } : null,
    };

    const unsafeNativeCalls = adapterCalls.native.start || adapterCalls.native.queue || adapterCalls.native.control;
    const unsafeSonyCalls = adapterCalls.sony.prepare || adapterCalls.sony.audio || adapterCalls.sony.growingAudio;
    report.isolationChecks = {
      electronChildExitedCleanly: childResult.code === 0,
      electronReportWritten: Boolean(electronReport && !electronReport.reportMissing),
      libraryContainsOnlyAuthorizedSyntheticFixture: syntheticFixtureMode
        ? initialLibrary.albums.length === expectedSyntheticAlbumCount && initialLibrary.roots.length === 0 &&
          initialLibrary.albums.every(album => album.id.startsWith('fixture-album-')) &&
          (!archiveMotionMode || syntheticPanelLibrary?.genres.map(genre => genre.albumCount).join(',') === '7,28,10')
        : initialLibrary.albums.length === 0 && initialLibrary.roots.length === 0,
      libraryScanWasNotRequested: scanCalls === 0,
      noNativeAudioOperations: !unsafeNativeCalls,
      noSonyAudioOperations: !unsafeSonyCalls,
      noExternalNodeFetches: deniedNodeFetches.length === 0,
      rendererExternalRequestsBlocked: electronReport?.externalRequests?.length === 0,
      noSyntheticConnectionSubmission: !futurePanelsMode || panelOnlineCalls?.forbiddenMutations.length === 0,
      onlineSearchReachedMock: !futurePanelsMode || (panelOnlineCalls?.searchRequests.length >= 4 && panelOnlineCalls.searchRequests.every(item => item.source === 'internetarchive' && item.query === 'fixturepanel')),
      onlineSearchUsedLocalRoute: !futurePanelsMode || serviceRequests.filter(entry => entry.path.startsWith('/api/online/search')).length >= 4,
      serviceDataInsideRunDirectory: path.resolve(serviceDataDirectory).startsWith(path.resolve(runDirectory)),
      caseGlassFixtureIsHiRes: !caseGlassMode || (initialLibrary.albums[0]?.tracks.length > 0 && initialLibrary.albums[0].tracks.every(track => track.format === 'FLAC' && track.lossless === true && track.sampleRate === 96000 && track.bitsPerSample === 24)),
      archiveMotionUsesOnlyPngCovers: !archiveMotionMode || initialLibrary.albums.length === 45 && initialLibrary.albums.every(album => album.coverUrl.startsWith('data:image/png;base64,')),
      archiveMotionSyntheticHiResMetadata: !archiveMotionMode || config.archiveMotionFixtureHiRes?.albumId === 'fixture-album-01' &&
        config.archiveMotionFixtureHiRes?.trackCount === 3 && config.archiveMotionFixtureHiRes?.qualifyingTrackCount === 3,
    };
    report.ok = report.isolationChecks.electronChildExitedCleanly
      && report.isolationChecks.electronReportWritten
      && Object.values(electronReport?.assertions ?? {}).length > 0
      && Object.values(electronReport.assertions).every(Boolean)
      && Object.values(report.isolationChecks).every(Boolean);
  } catch (error) {
    report.error = String(error?.stack ?? error);
  } finally {
    try {
      if (service?.server?.listening) {
        service.server.closeAllConnections?.();
        await new Promise(resolve => service.server.close(() => resolve()));
      }
    } catch (error) { report.serviceCloseError = error.message; }
    if (originalFetch) globalThis.fetch = originalFetch;
    report.serviceRequests = serviceRequests;
    report.deniedNodeFetches = deniedNodeFetches;
    report.adapterCalls = adapterCalls ?? null;
    report.onlineMockCalls = panelOnlineCalls ?? null;
    report.libraryScanCalls = scanCalls;
    await fs.mkdir(runDirectory, { recursive: true });
    await fs.writeFile(finalReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {});
    process.stdout.write(`${JSON.stringify({
      ok: report.ok,
      startupOutcome: report.electron?.startupOutcome ?? 'probe-error',
      frontendReadyCount: report.electron?.frontendReadyCount ?? null,
      readyAtMs: report.electron?.firstFrontendReadyAtMs ?? null,
      themeFollow: report.electron?.themeFollow?.summary ?? null,
      futurePanels: report.electron?.futurePanels?.summary ?? null,
      futureEntry: report.electron?.futureEntry?.summary ?? null,
      caseGlass: report.electron?.caseGlass?.summary ?? null,
      archiveMotion: report.electron?.archiveMotion?.summary ?? null,
      graphics: report.electron?.graphics ? { cases: report.electron.graphics.cases.length, screenshots: report.electron.graphics.screenshots.length } : null,
      loadingBackgroundThrottling: report.electron?.throttlingMilestones?.find(item => item.name === 'attached')?.effective ?? null,
      revealedBackgroundThrottling: report.electron?.throttlingMilestones?.find(item => item.name === 'frontend-ready')?.effective ?? null,
      runDirectory,
      reportPath: finalReportPath,
    }, null, 2)}\n`);
  }
  if (!report.ok) process.exitCode = 1;
}

async function runElectronProbe() {
  const { app, BrowserWindow, ipcMain, dialog } = require('electron');
  const { pathToFileURL } = require('node:url');
  const earlyConfig = JSON.parse(require('node:fs').readFileSync(process.env.RHINE_STARTUP_PROBE_CONFIG, 'utf8'));
  const { configureStartupGpu, registerGpuControls } = require(path.join(earlyConfig.projectRoot, 'desktop', 'gpu-controller.cjs'));
  process.env.TEMP = earlyConfig.appPaths.temp; process.env.TMP = earlyConfig.appPaths.temp;
  const startupGpu = configureStartupGpu(app, earlyConfig.gpuStartupPreferenceFile);
  const captureSchedulingOverrides = process.argv.includes('--capture-probe') || process.argv.includes('--future-entry-capture')
    ? ['disable-backgrounding-occluded-windows', 'disable-renderer-backgrounding'] : [];
  // Chromium consumes these before app readiness, so set them before any await.
  for (const option of captureSchedulingOverrides) app.commandLine.appendSwitch(option);
  const runDirectory = path.resolve(__dirname, '..');
  const configPath = process.env.RHINE_STARTUP_PROBE_CONFIG;
  const report = {
    ok: false,
    mode: 'real-electron-hidden-startup-gate',
    captureSchedulingOverrides,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    realDesktopMainExecuted: false,
    realPreloadUsed: true,
    realRendererUsed: true,
    startupGpu,
    browserWindowOptions: { show: false, backgroundThrottlingExplicitlySet: false },
    ipcEvents: [],
    navigationEvents: [],
    windowMilestones: [],
    throttlingMilestones: [],
    rendererConsole: [],
    rendererErrors: [],
    mainErrors: [],
    externalRequests: [],
    preferenceReads: [],
    preferenceSaves: [],
    windowOpenAttempts: [],
    dialogCalls: [],
    showEvents: [],
    showReturns: [],
    hideEvents: [],
    stateSamples: [],
    startupOutcome: 'not-started',
    frontendReadyCount: 0,
    syntheticPreferencesUsed: true,
    externalRequestsBlocked: true,
  };
  let config;
  let browserWindow;
  let gate;
  let themeFollowHarness;
  let themeFollowModule;
  let futurePanelsModule;
  let futureEntryModule;
  let caseGlassModule;
  let archiveMotionModule;
  let mockPreferences;
  let selectPreferencesForMock;
  let currentStartedAt = 0;
  let generation = 0;
  let failureSeen = false;
  const seenEvents = new WeakMap();

  const recordThrottle = name => {
    const effective = browserWindow?.webContents?.getBackgroundThrottling?.() ?? null;
    report.throttlingMilestones.push({ name, generation, effective, atMs: currentStartedAt ? Date.now() - currentStartedAt : null });
    return effective;
  };
  const summarize = value => {
    if (value === null) return { type: 'null' };
    if (Array.isArray(value)) return { type: 'array', length: value.length };
    if (typeof value === 'object') return { type: 'object', keys: Object.keys(value).slice(0, 24) };
    if (typeof value === 'string') return { type: 'string', length: value.length, sample: value.slice(0, 64) };
    return { type: typeof value, value: typeof value === 'boolean' || typeof value === 'number' ? value : undefined };
  };
  const observeEvent = (channel, event, args, kind) => {
    let record = seenEvents.get(event);
    if (!record) {
      const frame = event?.senderFrame;
      const frameUrl = frame?.url ?? '';
      let frameOrigin = '';
      try { frameOrigin = new URL(frameUrl).origin; } catch {}
      record = {
        index: report.ipcEvents.length + 1,
        channel: String(channel),
        kind,
        generation,
        senderIsTargetWebContents: Boolean(browserWindow && event?.sender === browserWindow.webContents),
        senderFrameIsMainFrame: Boolean(frame && browserWindow && frame === browserWindow.webContents.mainFrame),
        senderFrameUrl: frameUrl,
        senderFrameOrigin: frameOrigin,
        argumentSummary: args.map(summarize),
      };
      seenEvents.set(event, record);
      report.ipcEvents.push(record);
    }
    record.listenerCalls = (record.listenerCalls ?? 0) + 1;
    return record;
  };
  const instrumentIpcMain = () => {
    const originalOn = ipcMain.on.bind(ipcMain);
    const originalOnce = ipcMain.once.bind(ipcMain);
    const originalHandle = ipcMain.handle.bind(ipcMain);
    ipcMain.on = function (channel, listener) {
      return originalOn(channel, function (event, ...args) {
        const record = observeEvent(channel, event, args, 'send');
        const result = listener.call(this, event, ...args);
        record.gateReadyAfterListener = gate?.isReady?.() ?? null;
        record.effectiveBackgroundThrottlingAfterListener = browserWindow?.webContents?.getBackgroundThrottling?.() ?? null;
        record.showEventsAfterListener = report.showEvents.length;
        if (channel === 'rhine:frontend-ready') {
          report.frontendReadyCount++;
          record.frontendReadyOrdinal = report.frontendReadyCount;
          record.atMs = currentStartedAt ? Date.now() - currentStartedAt : null;
          record.showEventsAfterRelease = report.showEvents.length;
          record.windowVisibleAfterListener = browserWindow?.isVisible?.() ?? null;
          report.throttlingMilestones.push({
            name: 'frontend-ready',
            generation,
            effective: record.effectiveBackgroundThrottlingAfterListener,
            atMs: currentStartedAt ? Date.now() - currentStartedAt : null,
            readyOrdinal: report.frontendReadyCount,
          });
        }
        if (channel === 'rhine:frontend-failed') failureSeen = true;
        return result;
      });
    };
    ipcMain.once = function (channel, listener) {
      return originalOnce(channel, function (event, ...args) {
        const record = observeEvent(channel, event, args, 'send-once');
        const result = listener.call(this, event, ...args);
        record.gateReadyAfterListener = gate?.isReady?.() ?? null;
        return result;
      });
    };
    ipcMain.handle = function (channel, listener) {
      return originalHandle(channel, async function (event, ...args) {
        const record = observeEvent(channel, event, args, 'invoke');
        try {
          const result = await listener.call(this, event, ...args);
          record.resultSummary = summarize(result);
          return result;
        } catch (error) {
          record.error = String(error?.message ?? error);
          throw error;
        }
      });
    };
  };
  const waitUntil = async (predicate, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      if (report.mainErrors.length || failureSeen) return false;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    report.waitTimeout = label;
    return predicate();
  };
  const captureState = async () => {
    if (!browserWindow || browserWindow.isDestroyed()) return { destroyed: true };
    const script = `(() => {
      const canvas=document.querySelector('#three-scene canvas');
      const app=window.rhineMusic;
      let sceneStats=null,statsError='';
      try{sceneStats=app?.stats?.()??null}catch(error){statsError=String(error?.stack||error)}
      const startupError=document.querySelector('#music-startup-error');
      return {
        documentReadyState:document.readyState,
        visibilityState:document.visibilityState,
        location:location.href,
        stageExists:!!document.querySelector('#stage'),
        musicAppBridge:typeof app,
        desktopBridge:typeof window.rhineDesktop,
        entry:app?.entry??null,
        design:app?.design?.design??null,
        canvas:canvas?{width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth,clientHeight:canvas.clientHeight}:null,
        stats:sceneStats?{
          loaded:sceneStats.loaded,
          archiveCount:sceneStats.archiveCount,
          drawCalls:sceneStats.drawCalls,
          triangles:sceneStats.triangles,
          musicArchiveReady:sceneStats.musicArchiveReady,
          musicPresentationReady:sceneStats.musicPresentationReady
        }:null,
        presentation:app?.presentation??null,
        startupErrorText:startupError?.textContent?.trim()?.slice(0,600)||'',
        sceneStatsError:statsError,
        localResources:performance.getEntriesByType('resource').filter(entry=>entry.name.startsWith(location.origin)).length,
        externalResources:performance.getEntriesByType('resource').filter(entry=>/^https?:/i.test(entry.name)&&!entry.name.startsWith(location.origin)).map(entry=>entry.name.slice(0,180)).slice(0,12)
      };
    })()`;
    try {
      return await Promise.race([
        browserWindow.webContents.executeJavaScript(script, true),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Renderer state sample exceeded 1500ms.')), 1500)),
      ]);
    } catch (error) {
      return { sampleError: String(error?.message ?? error) };
    }
  };
  const sampleUntil = async (readyOrdinal, timeoutMs, name) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = await captureState();
      const elapsed = Date.now() - currentStartedAt;
      if (!report.stateSamples.length || elapsed - report.stateSamples.at(-1).atMs >= 900) {
        report.stateSamples.push({ name, generation, atMs: elapsed, state });
      }
      const readyCount = report.frontendReadyCount;
      if (readyCount >= readyOrdinal) return { ready: true, state };
      if (failureSeen || report.mainErrors.length || state.startupErrorText) return { ready: false, failed: true, state };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    return { ready: false, timeout: true, state: await captureState() };
  };
  const waitForNativeShow = async (ordinal, timeoutMs = 3000) => {
    const record = report.showReturns[ordinal - 1];
    if (!record) return false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      record.visibleAfterNativeTurn = browserWindow.isVisible();
      record.effectiveBackgroundThrottlingAfterNativeTurn = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
      record.settledAtMs = currentStartedAt ? Date.now() - currentStartedAt : null;
      if (record.visibleAfterNativeTurn) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    return browserWindow.isVisible();
  };

  try {
    if (!configPath) throw new Error('Missing RHINE_STARTUP_PROBE_CONFIG.');
    config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    report.syntheticArchiveMotionFixture = config.archiveMotion === true;
    report.syntheticArchiveMotionAlbumCount = config.archiveMotion ? config.syntheticPanelAlbumCount : null;
    report.syntheticArchiveMotionGenreCounts = config.archiveMotion ? config.syntheticPanelGenreCounts : null;
    report.syntheticArchiveMotionLongGroupProbeAlbumId = config.archiveMotion ? config.archiveMotionLongGroupProbeAlbumId : null;
    report.syntheticArchiveMotionFixtureCatalog = config.archiveMotion ? config.archiveMotionFixtureCatalog : null;
    report.syntheticArchiveMotionFixtureHiRes = config.archiveMotion ? config.archiveMotionFixtureHiRes : null;
    report.archiveMotionUsesOnlyPngCovers = config.archiveMotionUsesOnlyPngCovers === true;
    if (config.archiveMotion) report.mode = 'real-electron-archive-motion';
    else if (config.caseGlass) report.mode = 'real-electron-case-glass';
    else if (config.graphicsOnly) report.mode = 'real-electron-graphics';
    else if (config.futureEntry) report.mode = 'real-electron-future-entry';
    else if (config.futurePanels) report.mode = 'real-electron-future-panels';
    else if (config.themeFollow) report.mode = 'real-electron-theme-follow';
    for (const directory of Object.values(config.appPaths)) await fs.mkdir(directory, { recursive: true });
    for (const [name, directory] of Object.entries(config.appPaths)) app.setPath(name, directory);
    app.setAppLogsPath(config.appPaths.logs);
    await app.whenReady();
    app.setName('Rhine Isolated Startup Entry Probe');

    mockPreferences = { ...config.preferences };
    const source = await fs.readFile(path.join(config.projectRoot, 'desktop', 'main.cjs'), 'utf8');
    selectPreferencesForMock = value => value;
    if (config.themeFollow || config.futureEntry || config.caseGlass || config.archiveMotion) {
      const keysMatch = source.match(/const preferenceKeys=new Set\((\[[\s\S]*?\])\);/);
      const selectMatch = source.match(/const selectPreferences=value=>\{[\s\S]*?\n\};/);
      if (!keysMatch || !selectMatch) throw new Error('Could not extract production preference whitelist and selectPreferences function.');
      const keys = new Set(new Function(`return ${keysMatch[1]};`)());
      const entryPreferencesModel = config.futureEntry || config.caseGlass || config.archiveMotion
        ? await import(pathToFileURL(path.join(config.projectRoot, 'src', 'entry-preferences.mjs')).href)
        : null;
      const gpuSelectionModel = require(path.join(config.projectRoot, 'desktop', 'gpu-selection.cjs'));
      selectPreferencesForMock = new Function('preferenceKeys', 'windowAspectModel', 'entryPreferencesModel', 'gpuSelectionModel', `${selectMatch[0]}\nreturn selectPreferences;`)(keys, null, entryPreferencesModel, gpuSelectionModel);
      if (config.themeFollow) report.productionPreferenceWhitelistHasFollowSystemTheme = keys.has('followSystemTheme');
      if (config.caseGlass) report.productionPreferenceWhitelistHasCaseProfiles = keys.has('caseProfiles');
      if (config.archiveMotion) {
        report.productionPreferenceWhitelistHasEntryOnOpen = keys.has('entryOnOpen');
        report.productionPreferenceWhitelistHasEntryWelcome = keys.has('entryWelcome');
        report.productionPreferenceWhitelistHasEntryIdentity = keys.has('entryIdentity');
      }
      if (config.futureEntry) {
        report.productionPreferenceWhitelistHasEntryOnOpen = keys.has('entryOnOpen');
        report.productionPreferenceWhitelistHasEntryWelcome = keys.has('entryWelcome');
        report.productionPreferenceWhitelistHasEntryIdentity = keys.has('entryIdentity');
        const legacyPreferences = selectPreferencesForMock({ entryOnOpen: true });
        const invalidEntryPreferences = selectPreferencesForMock({
          entryWelcome: 'W'.repeat(2_100_000),
          entryIdentity: 'Kristen123 Wright',
        });
        report.productionEntryTextDefaultsLegacyProfile =
          legacyPreferences.entryWelcome === entryPreferencesModel.defaultEntryWelcome &&
          legacyPreferences.entryIdentity === entryPreferencesModel.defaultEntryIdentity;
        report.productionEntryTextInvalidValuesUseDefaults =
          invalidEntryPreferences.entryWelcome === entryPreferencesModel.defaultEntryWelcome &&
          invalidEntryPreferences.entryIdentity === entryPreferencesModel.defaultEntryIdentity;
      }
    }
    mockPreferences = selectPreferencesForMock(mockPreferences);

    instrumentIpcMain();
    registerGpuControls({ app, ipcMain, getWindow: () => browserWindow, startup: startupGpu,
      getPreference: () => mockPreferences.gpuPreference,
      savePreference: async gpuPreference => {
        mockPreferences = { ...mockPreferences, gpuPreference };
        report.gpuPreferenceSaves ??= [];
        report.gpuPreferenceSaves.push(gpuPreference);
      },
    });
    ipcMain.on('rhine:preferences:get', event => {
      const value = config.themeFollow || config.futureEntry || config.caseGlass || config.archiveMotion ? mockPreferences : config.preferences;
      if (config.themeFollow) report.preferenceReads.push({ theme: value.theme, followSystemTheme: value.followSystemTheme, keys: Object.keys(value).length });
      event.returnValue = value;
    });
    ipcMain.on('rhine:audio-presets:get', event => {
      event.returnValue = { ok: true, exists: false, value: { schemaVersion: 1, activeId: null, presets: [], eqBanks: {} } };
    });
    ipcMain.handle('rhine:preferences:save', async (_event, value) => {
      if (!config.themeFollow && !config.futureEntry && !config.caseGlass && !config.archiveMotion) return { ok: true };
      try {
        mockPreferences = { ...selectPreferencesForMock(value), gpuPreference: mockPreferences.gpuPreference ?? 'auto' };
        report.preferenceSaves.push({
          index: report.preferenceSaves.length + 1,
          theme: mockPreferences.theme,
          followSystemTheme: mockPreferences.followSystemTheme,
          allowedFollowField: Object.hasOwn(mockPreferences, 'followSystemTheme'),
          entryOnOpen: mockPreferences.entryOnOpen,
          allowedEntryOnOpen: Object.hasOwn(mockPreferences, 'entryOnOpen'),
          entryWelcome: mockPreferences.entryWelcome,
          allowedEntryWelcome: Object.hasOwn(mockPreferences, 'entryWelcome'),
          entryIdentity: mockPreferences.entryIdentity,
          allowedEntryIdentity: Object.hasOwn(mockPreferences, 'entryIdentity'),
          ...(config.caseGlass ? {
            style: structuredClone(mockPreferences.style),
            caseProfiles: mockPreferences.caseProfiles ? structuredClone(mockPreferences.caseProfiles) : null,
          } : {}),
        });
        return { ok: true };
      } catch (error) {
        report.mockPreferenceSaveErrors ??= [];
        report.mockPreferenceSaveErrors.push(String(error?.message ?? error));
        return { ok: false, error: String(error?.message ?? error) };
      }
    });
    ipcMain.handle('rhine:audio-presets:save', async () => ({ ok: true }));
    ipcMain.handle('rhine:standard-eq-presets', async () => ({ ok: false, error: 'Synthetic startup probe does not load preset files.' }));
    ipcMain.on('rhine:preferences:error', (_event, message) => {
      report.preferenceErrorMessages ??= [];
      report.preferenceErrorMessages.push(String(message).slice(0, 400));
    });

    const match = source.match(/\/\/ HIDDEN_STARTUP_GATE_FACTORY_BEGIN\s*([\s\S]*?)\s*\/\/ HIDDEN_STARTUP_GATE_FACTORY_END/);
    if (!match) throw new Error('Could not extract marked production createHiddenStartupGate factory.');
    report.gateFactoryVariant = 'production source';
    report.gateFactorySha256 = crypto.createHash('sha256').update(match[1]).digest('hex');
    const createHiddenStartupGate = new Function(`${match[1]}\nreturn createHiddenStartupGate;`)();
    const gateApp = {
      on: app.on.bind(app),
      quit() { report.gateRequestedQuit = true; },
    };
    let windowForGate;
    gate = createHiddenStartupGate({ ipcMain, app: gateApp, dialog: {
      showErrorBox(title, message) { report.dialogCalls.push({ title, message: String(message).slice(0, 1200) }); },
    }, getWindow: () => windowForGate });

    browserWindow = new BrowserWindow({
      width: 1320,
      height: 900,
      show: false,
      backgroundColor: '#e8e5e1',
      autoHideMenuBar: true,
      webPreferences: {
        preload: config.preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    windowForGate = browserWindow;
    report.fullscreenEvents = [];
    for (const name of ['enter-full-screen', 'leave-full-screen']) browserWindow.on(name, () => {
      report.fullscreenEvents.push({ name, state: browserWindow.isFullScreen(), bounds: browserWindow.getBounds() });
    });
    const { registerWindowControls } = require(path.join(config.projectRoot, 'desktop', 'window-controls.cjs'));
    registerWindowControls({ ipcMain, getWindow: () => browserWindow })(browserWindow, config.serviceOrigin);
    const actualWebPreferences = browserWindow.webContents.getLastWebPreferences?.() ?? {};
    report.security = {
      contextIsolation: actualWebPreferences.contextIsolation,
      nodeIntegration: actualWebPreferences.nodeIntegration,
      sandbox: actualWebPreferences.sandbox,
      webSecurity: actualWebPreferences.webSecurity,
      backgroundThrottlingOptionSpecifiedByProbe: false,
      backgroundThrottlingInitial: browserWindow.webContents.getBackgroundThrottling?.() ?? null,
      forceHighPerformanceGpuSwitch: app.commandLine.hasSwitch('force_high_performance_gpu'),
    };
    report.initialActualWindowVisible = browserWindow.isVisible();
    report.windowMilestones.push({ name: 'created', generation, atMs: 0, actualVisible: browserWindow.isVisible(), gateReady: gate.isReady() });

    const gatedWindow = {
      webContents: browserWindow.webContents,
      isDestroyed: () => browserWindow.isDestroyed(),
      isMinimized: () => browserWindow.isMinimized(),
      restore: () => browserWindow.restore(),
      isVisible: () => browserWindow.isVisible(),
      show: () => {
        browserWindow.show();
        report.showReturns.push({
          generation,
          gateReady: gate.isReady(),
          visibleImmediatelyAfterCall: browserWindow.isVisible(),
          effectiveBackgroundThrottling: browserWindow.webContents.getBackgroundThrottling?.() ?? null,
          atMs: currentStartedAt ? Date.now() - currentStartedAt : null,
        });
      },
      hide: () => {
        const visibleBeforeHide = browserWindow.isVisible();
        browserWindow.hide();
        report.hideEvents.push({ generation, visibleBeforeHide, actualVisible: browserWindow.isVisible() });
      },
      focus: () => browserWindow.focus(),
    };
    windowForGate = gatedWindow;
    gate.attachWindow(gatedWindow, config.serviceOrigin);
    recordThrottle('attached');
    report.gateFactoryAttached = true;

    browserWindow.on('show', () => {
      const milestone = {
        name: 'native-show-event',
        generation,
        gateReady: gate.isReady(),
        actualVisibleAtEvent: browserWindow.isVisible(),
        effectiveBackgroundThrottling: browserWindow.webContents.getBackgroundThrottling?.() ?? null,
        atMs: currentStartedAt ? Date.now() - currentStartedAt : null,
      };
      report.showEvents.push(milestone);
    });
    browserWindow.webContents.on('did-start-navigation', (_event, url, inPlace, isMainFrame) => {
      const record = { type: 'did-start-navigation', url, inPlace, isMainFrame, generation: generation + (isMainFrame && !inPlace ? 1 : 0) };
      if (isMainFrame && !inPlace) {
        generation++;
        record.generation = generation;
        record.gateReadyAfterGateHandler = gate.isReady();
        record.effectiveBackgroundThrottlingAfterGateHandler = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
        report.throttlingMilestones.push({ name: 'main-frame-navigation', generation, effective: record.effectiveBackgroundThrottlingAfterGateHandler, atMs: currentStartedAt ? Date.now() - currentStartedAt : null });
      }
      record.actualVisible = browserWindow.isVisible();
      report.navigationEvents.push(record);
    });

    const pageSession = browserWindow.webContents.session;
    pageSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    pageSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        const target = new URL(details.url);
        if (target.origin === config.serviceOrigin || ['data:', 'blob:', 'file:'].includes(target.protocol)) {
          callback({});
          return;
        }
      } catch {}
      report.externalRequests.push({ url: String(details.url).slice(0, 220), resourceType: details.resourceType });
      callback({ cancel: true });
    });
    browserWindow.webContents.setWindowOpenHandler(({ url }) => {
      report.windowOpenAttempts.push(String(url).slice(0, 220));
      return { action: 'deny' };
    });
    browserWindow.webContents.setAudioMuted(true);
    browserWindow.webContents.on('will-navigate', (event, url) => {
      try { if (new URL(url).origin !== config.serviceOrigin) event.preventDefault(); }
      catch { event.preventDefault(); }
    });
    browserWindow.webContents.on('dom-ready', () => report.windowMilestones.push({ name: 'dom-ready', generation, atMs: currentStartedAt ? Date.now() - currentStartedAt : null, gateReady: gate.isReady(), actualVisible: browserWindow.isVisible() }));
    browserWindow.webContents.on('did-finish-load', () => report.windowMilestones.push({ name: 'did-finish-load', generation, atMs: currentStartedAt ? Date.now() - currentStartedAt : null, gateReady: gate.isReady(), actualVisible: browserWindow.isVisible() }));
    browserWindow.once('ready-to-show', () => report.windowMilestones.push({ name: 'ready-to-show', generation, atMs: currentStartedAt ? Date.now() - currentStartedAt : null, gateReady: gate.isReady(), actualVisible: browserWindow.isVisible() }));
    browserWindow.webContents.on('console-message', (...args) => {
      const details = args[1];
      let level, message, lineNumber, sourceId;
      if (details && typeof details === 'object') {
        level = details.level;
        message = details.message ?? details.text ?? '';
        lineNumber = details.lineNumber ?? details.line;
        sourceId = details.sourceId ?? details.source;
      } else {
        [, level, message, lineNumber, sourceId] = args;
      }
      report.rendererConsole.push({ level, message: String(message ?? '').slice(0, 900), lineNumber: Number(lineNumber) || null, source: String(sourceId ?? '').slice(0, 220) });
    });
    browserWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => report.navigationEvents.push({ type: 'did-fail-load', code, description, url: validatedURL, isMainFrame }));
    browserWindow.webContents.on('render-process-gone', (_event, details) => report.rendererErrors.push({ type: 'render-process-gone', details }));
    browserWindow.webContents.on('unresponsive', () => report.rendererErrors.push({ type: 'unresponsive' }));
    process.on('uncaughtException', error => report.mainErrors.push({ type: 'uncaughtException', message: String(error?.stack ?? error).slice(0, 1800) }));
    process.on('unhandledRejection', error => report.mainErrors.push({ type: 'unhandledRejection', message: String(error?.stack ?? error).slice(0, 1800) }));

    if (config.themeFollow) {
      themeFollowModule = await import(pathToFileURL(path.join(__dirname, 'check-theme-follow.mjs')).href);
      themeFollowHarness = await themeFollowModule.installThemeFollowProbe(browserWindow, phase => {
        report.themeFollowProbePhase = phase;
        process.stdout.write(`theme-follow-probe:${phase}\n`);
      });
    }

    currentStartedAt = Date.now();
    report.navigationStartedAt = currentStartedAt;
    report.startupTimeoutMs = 45000;
    report.startupOutcome = 'pending';
    await browserWindow.loadURL(config.serviceOrigin);
    const firstResult = await sampleUntil(1, report.startupTimeoutMs, 'initial-startup');
    report.initialStartupState = firstResult.state;
    if (!firstResult.ready) {
      report.startupOutcome = firstResult.failed ? 'frontend-failed' : 'timeout-initial-startup';
      report.initialFailure = firstResult.state?.startupErrorText || report.ipcEvents.find(event => event.channel === 'rhine:frontend-failed')?.argumentSummary || null;
    } else {
      report.firstFrontendReadyAtMs = Date.now() - currentStartedAt;
      report.startupOutcome = 'frontend-ready';
      report.firstShowVisibleAfterRelease = await waitForNativeShow(1);
      report.firstShowBackgroundThrottlingAfterRelease = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
    }

    if (firstResult.ready && config.reloadOnce) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const beforeReloadReadyCount = report.frontendReadyCount;
      report.reloadStartedAtMs = Date.now() - currentStartedAt;
      browserWindow.webContents.reload();
      const navigationStarted = await waitUntil(
        () => report.navigationEvents.some(item => item.type === 'did-start-navigation' && item.isMainFrame && !item.inPlace && item.generation >= 2),
        5000,
        'reload-navigation',
      );
      report.reloadNavigationObserved = navigationStarted;
      report.reloadEffectiveBackgroundThrottling = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
      report.reloadActualWindowVisibleAfterGateNavigation = browserWindow.isVisible();
      report.reloadHideCallsAfterNavigation = report.hideEvents.length;
      const secondResult = await sampleUntil(beforeReloadReadyCount + 1, report.startupTimeoutMs, 'reload-startup');
      report.reloadStartupState = secondResult.state;
      report.reloadCompleted = secondResult.ready;
      if (secondResult.ready) {
        report.reloadFrontendReadyAtMs = Date.now() - currentStartedAt;
        report.reloadWindowVisibleAfterRelease = browserWindow.isVisible();
        report.reloadBackgroundThrottlingAfterRelease = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
      }
      else report.startupOutcome = secondResult.failed ? 'frontend-failed-on-reload' : 'timeout-on-reload';
    }

    if (firstResult.ready && config.themeFollow) {
      if (!config.graphicsOnly) report.themeFollow = await themeFollowModule.checkThemeFollow({
        browserWindow,
        outputDirectory: runDirectory,
        probeReport: report,
        getPreferences: () => mockPreferences,
        themeProbe: themeFollowHarness,
      });
      const { checkGraphics } = await import(pathToFileURL(path.join(config.projectRoot, 'desktop', 'check-graphics.mjs')).href);
      report.graphics = await checkGraphics({ browserWindow, outputDirectory: runDirectory });
      const gpuInfo = await app.getGPUInfo('complete');
      report.gpuRuntimeInfo = { devices: gpuInfo.gpuDevice, renderer: gpuInfo.auxAttributes?.glRenderer };
      if (startupGpu.applied !== 'auto') {
        const active = gpuInfo.gpuDevice?.filter(device => device.active) ?? [];
        report.manualGpuVerified = active.length === 1 && active[0].vendorId === startupGpu.applied.vendorId && active[0].deviceId === startupGpu.applied.deviceId;
        if (!report.manualGpuVerified) throw new Error('The requested hardware GPU was not reported active.');
      }
      if (!report.graphics.ok) throw new Error('Graphics interaction checks failed.');
    }
    if (firstResult.ready && config.futurePanels) {
      await browserWindow.webContents.executeJavaScript(
        '(() => { const button = document.querySelector(".future-entry-skip"); if (button) button.click(); return Boolean(button); })()',
        true,
      );
      await browserWindow.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        true,
      );
      futurePanelsModule = await import(pathToFileURL(path.join(__dirname, 'check-future-panels.mjs')).href);
      report.futurePanels = await futurePanelsModule.checkFuturePanels({
        browserWindow,
        outputDirectory: runDirectory,
        report,
        serviceOrigin: config.serviceOrigin,
        sendKey: key => {
          const keyCode = key === 'ESC' ? 'Escape' : key === 'ENTER' ? 'Enter' : key === 'TAB' ? 'Tab' : key;
          browserWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
          browserWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
        },
      });
    }
    if (firstResult.ready && config.futureEntry) {
      futureEntryModule = await import(pathToFileURL(path.join(__dirname, 'check-future-entry.mjs')).href);
      try {
        report.futureEntry = await futureEntryModule.checkFutureEntry({
          browserWindow,
          outputDirectory: config.runDirectory,
          probeReport: report,
          getPreferences: () => structuredClone(mockPreferences),
          setPreferences: value => { mockPreferences = structuredClone(value); },
          getReadyCount: () => report.frontendReadyCount,
          sendKey: key => {
            const keyCode = key === 'ESC' ? 'Escape' : key === 'ENTER' ? 'Enter' : key === 'TAB' ? 'Tab' : key;
            browserWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode });
            browserWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode });
          },
        });
      } catch (error) {
        report.futureEntry = error.futureEntryResult ?? { ok: false, error: String(error?.stack ?? error) };
        throw error;
      }
    }
    if (firstResult.ready && config.caseGlass) {
      caseGlassModule = await import(pathToFileURL(path.join(__dirname, 'check-case-glass.mjs')).href);
      try {
        report.caseGlass = await caseGlassModule.checkCaseGlass({
          browserWindow,
          outputDirectory: config.runDirectory,
          probeReport: report,
        });
      } catch (error) {
        report.caseGlass = error.caseGlassResult ?? { ok: false, error: String(error?.stack ?? error) };
        throw error;
      }
    }
    if (firstResult.ready && config.archiveMotion) {
      archiveMotionModule = await import(pathToFileURL(path.join(__dirname, 'check-archive-motion.mjs')).href);
      try {
        report.archiveMotion = await archiveMotionModule.checkArchiveMotion({
          browserWindow,
          outputDirectory: config.runDirectory,
          probeReport: report,
          getPreferences: () => structuredClone(mockPreferences),
          getReadyCount: () => report.frontendReadyCount,
        });
      } catch (error) {
        report.archiveMotion = error.archiveMotionResult ?? { ok: false, error: String(error?.stack ?? error) };
        throw error;
      }
    }

    report.finishedAtMs = Date.now() - currentStartedAt;
    report.finalRendererState = await captureState();
    report.finalActualWindowVisible = browserWindow.isVisible();
    report.finalBackgroundThrottling = browserWindow.webContents.getBackgroundThrottling?.() ?? null;
    report.finalGateReady = gate.isReady();
    report.finalGeneration = generation;
    report.readyIpcEvents = report.ipcEvents.filter(event => event.channel === 'rhine:frontend-ready');
    report.failedIpcEvents = report.ipcEvents.filter(event => event.channel === 'rhine:frontend-failed');
    const unmatchedRestores = config.archiveMotion ? [...(report.archiveMotion?.windowRestores ?? [])] : [];
    const unaccountedNativeShows = report.showEvents.slice(1).filter(show => {
      const absoluteAt = currentStartedAt + Number(show.atMs);
      const match = unmatchedRestores.findIndex(restore => absoluteAt >= restore.at - 25 && absoluteAt <= restore.at + 1000);
      if (match < 0 || show.gateReady !== true || show.generation !== 1 || show.actualVisibleAtEvent !== true) return true;
      unmatchedRestores.splice(match, 1);
      return false;
    });
    report.probeRestoreShowAudit = { nativeShows:report.showEvents.length,
      controlledRestores:report.archiveMotion?.windowRestores?.length ?? 0, unaccountedNativeShows };
    report.assertions = {
      productionGateFactoryExtracted: Boolean(report.gateFactorySha256),
      realElectronAndPreloadPathUsed: Boolean(process.versions.electron) && report.readyIpcEvents.length >= 1 && report.readyIpcEvents.every(event => event.senderIsTargetWebContents),
      hiddenAtCreation: report.initialActualWindowVisible === false,
      secureWebPreferencesPreserved: report.security?.contextIsolation === true && report.security?.nodeIntegration === false && report.security?.sandbox === true && report.security?.webSecurity === true,
      backgroundThrottlingNotSpecifiedByProbe: report.security?.backgroundThrottlingOptionSpecifiedByProbe === false,
      gateDisablesThrottlingDuringLoad: report.throttlingMilestones.some(item => item.name === 'attached' && item.effective === false),
      gateRestoresThrottlingAfterRelease: report.readyIpcEvents.length >= 1 && report.readyIpcEvents.every(event => event.effectiveBackgroundThrottlingAfterListener === true),
      readyMessagesAreFromMainFrameAndExpectedOrigin: report.readyIpcEvents.length >= 1 && report.readyIpcEvents.every(event => event.senderFrameIsMainFrame && event.senderFrameOrigin === config.serviceOrigin),
      oneReadyPerGeneration: report.readyIpcEvents.length === generation && report.readyIpcEvents.every((event, index) => event.generation === index + 1),
      firstNativeShowOnlyAfterFirstReady: report.showReturns.length === 1 && report.showEvents.length >= 1 &&
        report.showEvents[0]?.gateReady === true && unaccountedNativeShows.length === 0 &&
        report.showReturns[0]?.gateReady === true && report.showReturns[0]?.generation === 1 && report.showReturns[0]?.visibleAfterNativeTurn === true,
      visibleAfterBothReadyMessages: report.readyIpcEvents.length === generation && report.readyIpcEvents.every(event => event.windowVisibleAfterListener === true),
      ordinaryThrottlingRestoredAfterEachRelease: report.readyIpcEvents.length === generation && report.readyIpcEvents.every(event => event.effectiveBackgroundThrottlingAfterListener === true),
      reloadKeepsExistingWindowVisible: !config.reloadOnce || (report.reloadNavigationObserved && report.reloadActualWindowVisibleAfterGateNavigation === true && report.reloadHideCallsAfterNavigation === 0 && report.reloadStartupState?.visibilityState === 'visible'),
      reloadDoesNotShowOrHideAgain: !config.reloadOnce || (report.showReturns.length === 1 && report.showEvents.length === 1 && report.hideEvents.length === 0),
      readyToShowDidNotReleaseGateEarly: report.windowMilestones.filter(item => item.name === 'ready-to-show').every(item => {
        const readyBefore = report.readyIpcEvents.some(ready => ready.generation === item.generation && ready.atMs <= item.atMs);
        const shownBefore = report.showEvents.some(show => show.generation === item.generation && show.atMs <= item.atMs);
        return item.gateReady === readyBefore && (readyBefore ? shownBefore : !shownBefore);
      }),
      reloadWasGatedAgain: !config.reloadOnce || (report.reloadNavigationObserved && report.reloadEffectiveBackgroundThrottling === false && report.reloadCompleted && report.reloadBackgroundThrottlingAfterRelease === true && report.reloadWindowVisibleAfterRelease === true),
      finalGateReleasedAndThrottlingRestored: report.finalGateReady && report.finalBackgroundThrottling === true,
      finalSyntheticWindowWasVisibleBeforeCleanup: report.finalActualWindowVisible === true,
      noExternalRendererRequests: report.externalRequests.length === 0,
      noUnexpectedDialog: report.dialogCalls.length === 0,
      noFrontendFailure: report.failedIpcEvents.length === 0,
      productionWhitelistRetainsFollowSystemTheme: !config.themeFollow || report.productionPreferenceWhitelistHasFollowSystemTheme === true,
      productionWhitelistRetainsEntryOnOpen: !config.futureEntry || report.productionPreferenceWhitelistHasEntryOnOpen === true,
      productionWhitelistRetainsCaseProfiles: !config.caseGlass || report.productionPreferenceWhitelistHasCaseProfiles === true,
      productionPreferenceSelectorSavedEntryOnOpenFalse: !config.futureEntry || report.preferenceSaves.some(item => item.entryOnOpen === false && item.allowedEntryOnOpen),
      productionPreferenceSelectorSavedEntryOnOpenTrue: !config.futureEntry || report.preferenceSaves.some(item => item.entryOnOpen === true && item.allowedEntryOnOpen),
      archiveMotionProductionWhitelistRetainsEntryPreferences: !config.archiveMotion || report.productionPreferenceWhitelistHasEntryOnOpen === true && report.productionPreferenceWhitelistHasEntryWelcome === true && report.productionPreferenceWhitelistHasEntryIdentity === true,
      archiveMotionPreferenceSelectorSavedEntryOnOpenFalse: !config.archiveMotion || report.preferenceSaves.some(item => item.entryOnOpen === false && item.allowedEntryOnOpen),
      themeFollowBehaviorPassed: !config.themeFollow || config.graphicsOnly || report.themeFollow?.ok === true,
      graphicsBehaviorPassed: !config.themeFollow || report.graphics?.ok === true,
      futurePanelsBehaviorPassed: !config.futurePanels || report.futurePanels?.ok === true,
      futureEntryBehaviorPassed: !config.futureEntry || report.futureEntry?.ok === true,
      caseGlassBehaviorPassed: !config.caseGlass || report.caseGlass?.ok === true,
      archiveMotionBehaviorPassed: !config.archiveMotion || report.archiveMotion?.ok === true,
      caseGlassSyntheticHiResFixture: !config.caseGlass || config.caseGlassFixtureHiRes === true,
      archiveMotionSyntheticPngCovers: !config.archiveMotion || config.archiveMotionUsesOnlyPngCovers === true,
    };
  } catch (error) {
    report.startupOutcome = config?.archiveMotion ? 'archive-motion-probe-error' : config?.caseGlass ? 'case-glass-probe-error' : config?.graphicsOnly ? 'graphics-probe-error' : config?.futureEntry ? 'future-entry-probe-error' : config?.themeFollow ? 'theme-follow-probe-error' : report.startupOutcome === 'pending' ? 'probe-error' : report.startupOutcome;
    report.failureRendererState = await captureState();
    report.failureWindowState = browserWindow && !browserWindow.isDestroyed() ? { fullscreen: browserWindow.isFullScreen(), fullscreenable: browserWindow.isFullScreenable(), visible: browserWindow.isVisible(), bounds: browserWindow.getBounds() } : null;
    report.mainErrors.push({ type: 'probe-error', message: String(error?.stack ?? error).slice(0, 3000) });
  } finally {
    try { await themeFollowHarness?.detach(); } catch (error) { report.themeFollowDetachError = error.message; }
    report.finalActualWindowVisible = Boolean(browserWindow && !browserWindow.isDestroyed() && browserWindow.isVisible());
    report.ok = report.startupOutcome === 'frontend-ready'
      && report.assertions
      && Object.values(report.assertions).every(Boolean);
    try {
      await fs.writeFile(config?.electronReportPath ?? path.join(runDirectory, 'electron-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.error(`Could not write Electron startup report: ${error.message}`);
    }
    try { if (browserWindow && !browserWindow.isDestroyed()) browserWindow.destroy(); } catch {}
    report.finalWindowDestroyed = Boolean(browserWindow?.isDestroyed());
    app.quit();
  }
}
