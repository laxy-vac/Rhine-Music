import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = path.join(projectRoot, '.tools');
fs.mkdirSync(toolsRoot, { recursive: true });
const actualToolsRoot = fs.realpathSync(toolsRoot);
const actualProjectRoot = fs.realpathSync(projectRoot);
const toolsRelative = path.relative(actualProjectRoot, actualToolsRoot);
assert.ok(toolsRelative !== '..' && !toolsRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(toolsRelative),
  'The isolated test scratch directory must remain under the project .tools folder.');
const runRoot = fs.mkdtempSync(path.join(actualToolsRoot, 'app-storage-check-'));

const require = createRequire(import.meta.url);
const { createPreferencesStore, prepareStorageSync, resolveStorageLayout } = require('../desktop/app-storage.cjs');
const passed = [];
const skipped = [];

function inside(root, candidate) {
  const rootPath = process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
  const candidatePath = process.platform === 'win32' ? path.resolve(candidate).toLowerCase() : path.resolve(candidate);
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function installLayout(name, env = {}) {
  const installDir = path.join(runRoot, name);
  fs.mkdirSync(installDir, { recursive: true });
  const executable = path.join(installDir, 'Rhine Music.exe');
  fs.writeFileSync(executable, 'synthetic installer fixture');
  return resolveStorageLayout({ projectRoot, execPath: executable, sourcePreview: false, env });
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

after(() => {
  fs.writeFileSync(path.join(runRoot, 'test-report.json'), JSON.stringify({
    ok: passed.length + skipped.length === 6,
    passed,
    skipped,
    scratch: runRoot,
  }, null, 2) + '\n');
  console.log(`Synthetic app-storage fixtures retained at ${runRoot}`);
});

test('app storage layout and persistence stay within their selected roots', async (t) => {
  await t.test('installed paths stay under dirname(execPath), ignoring profile overrides', () => {
    const outside = path.join(runRoot, 'external-env-values');
    const layout = installLayout('installed-layout', {
      APPDATA: outside,
      LOCALAPPDATA: outside,
      RHINE_APP_HOME: path.join(outside, 'profile'),
      MUSIC_DATA_DIR: path.join(outside, 'library'),
    });
    const root = layout.installDir;

    assert.equal(layout.dataRoot, path.join(root, 'data'));
    assert.equal(layout.home, path.join(root, 'data', 'config'));
    assert.equal(layout.sessionDir, path.join(root, 'data', 'session'));
    assert.equal(layout.logsDir, path.join(root, 'data', 'logs'));
    assert.equal(layout.crashDir, path.join(root, 'data', 'crashes'));
    assert.equal(layout.tempDir, path.join(root, 'data', 'tmp'));
    assert.equal(layout.dataDir, path.join(root, 'data', 'library'));
    assert.equal(layout.lspUserDataDir, path.join(root, 'data', 'lsp'));
    assert.equal(layout.themePresetFile, path.join(root, 'presets', 'themes', 'theme-presets.json'));
    assert.equal(layout.audioPresetFile, path.join(root, 'presets', 'eq', 'audio-processing-presets.json'));
    assert.equal(layout.preferenceFile, path.join(root, 'data', 'config', 'preferences.json'));

    const managed = [layout.home, layout.sessionDir, layout.logsDir, layout.crashDir, layout.tempDir,
      layout.dataDir, layout.lspUserDataDir, layout.presetsRoot, layout.themePresetFile, layout.audioPresetFile, layout.preferenceFile];
    assert.ok(managed.every(item => inside(root, item)));
    prepareStorageSync(layout);
    for (const directory of [layout.home, layout.sessionDir, layout.logsDir, layout.crashDir, layout.tempDir,
      layout.dataDir, layout.lspUserDataDir, path.dirname(layout.themePresetFile), path.dirname(layout.audioPresetFile)]) {
      assert.ok(fs.statSync(directory).isDirectory(), `${directory} should be prepared`);
      assert.equal(fs.readdirSync(directory).some(name => name.startsWith('.rhine-storage-probe-')), false,
        'write probes should be deleted after checking the directory');
    }
    assert.equal(fs.existsSync(outside), false, 'installed mode must not create an external override path');
    passed.push('installed layout, ignored overrides, and directory probes');
  });

  await t.test('source preview preserves the workspace profile and isolates managed paths', () => {
    const profileRoot = path.join(runRoot, 'source-preview-profile');
    const externalLibrary = path.join(runRoot, 'legacy-music-data');
    const layout = resolveStorageLayout({
      projectRoot,
      execPath: path.join(runRoot, 'electron.exe'),
      sourcePreview: true,
      env: {
        APPDATA: path.join(runRoot, 'never-use-appdata'),
        RHINE_APP_HOME: path.join(profileRoot, 'desktop'),
        MUSIC_DATA_DIR: externalLibrary,
      },
    });
    assert.equal(layout.home, path.join(profileRoot, 'desktop'));
    assert.equal(layout.dataDir, externalLibrary);
    assert.equal(layout.presetsRoot, path.join(profileRoot, 'presets'));
    for (const directory of [layout.home, layout.sessionDir, layout.logsDir, layout.crashDir,
      layout.tempDir, layout.lspUserDataDir, layout.presetsRoot]) assert.ok(inside(profileRoot, directory));
    assert.equal(inside(profileRoot, layout.dataDir), false, 'an explicit MUSIC_DATA_DIR remains independent');
    prepareStorageSync(layout);
    assert.ok(fs.statSync(externalLibrary).isDirectory());
    assert.equal(fs.existsSync(path.join(runRoot, 'never-use-appdata')), false);

    const fallbackProject = path.join(runRoot, 'source-preview-default-project');
    fs.mkdirSync(fallbackProject, { recursive: true });
    const fallback = resolveStorageLayout({
      projectRoot: fallbackProject,
      execPath: path.join(runRoot, 'electron.exe'),
      sourcePreview: true,
      env: { APPDATA: path.join(runRoot, 'never-use-appdata') },
    });
    assert.equal(fallback.sourceProfileRoot, path.join(fallbackProject, '.local'));
    assert.equal(fallback.home, path.join(fallbackProject, '.local', 'desktop'));
    assert.equal(fallback.dataDir, path.join(fallbackProject, '.local', 'music-data'));
    assert.ok(inside(fallback.sourceProfileRoot, fallback.sessionDir));
    assert.ok(inside(fallback.sourceProfileRoot, fallback.tempDir));
    prepareStorageSync(fallback);
    passed.push('source preview overrides, independent library override, and .local fallback');
  });

  await t.test('theme presets round-trip separately from preferences and EQ path', async () => {
    const layout = installLayout('preset-roundtrip');
    prepareStorageSync(layout);
    const store = createPreferencesStore(layout);
    const future = [{ id: 'future-1', name: 'Future sample', appearance: { surfaces: { cover: { color: '#123456' } } } }];
    const archive = [{ id: 'archive-1', name: 'Archive sample', appearance: { surfaces: { frame: { color: '#654321' } } } }];
    const selected = { language: 'en', theme: 'night', futurePunkPresets: future, archivePunkPresets: archive };

    await store.save(selected);
    const savedPreferences = JSON.parse(fs.readFileSync(layout.preferenceFile, 'utf8'));
    const savedThemes = JSON.parse(fs.readFileSync(layout.themePresetFile, 'utf8'));
    assert.deepEqual(savedPreferences, { language: 'en', theme: 'night' });
    assert.deepEqual(savedThemes, { schemaVersion: 1, futurePunkPresets: future, archivePunkPresets: archive });
    assert.notEqual(layout.audioPresetFile, layout.themePresetFile);
    assert.ok(inside(layout.installDir, layout.audioPresetFile));

    const eqValue = { schemaVersion: 1, activeId: null, presets: [], eqBanks: {} };
    writeJson(layout.audioPresetFile, eqValue);
    const loaded = await createPreferencesStore(layout).load();
    assert.deepEqual(loaded, selected);
    assert.notStrictEqual(loaded.futurePunkPresets, loaded.archivePunkPresets);
    await store.save({ language: 'zh-CN', futurePunkPresets: [{ id: 'future-2', name: 'Updated', appearance: {} }] });
    const reloaded = await createPreferencesStore(layout).load();
    assert.equal(reloaded.futurePunkPresets[0].id, 'future-2');
    assert.deepEqual(reloaded.archivePunkPresets, archive, 'omitted theme keys must be retained');
    assert.deepEqual(JSON.parse(fs.readFileSync(layout.audioPresetFile, 'utf8')), eqValue,
      'preference saves must leave the independent EQ preset file untouched');
    passed.push('separate theme JSON, independent theme banks, and EQ path');
  });

  await t.test('legacy embedded theme presets are read and split on the first save', async () => {
    const layout = installLayout('legacy-theme-migration');
    prepareStorageSync(layout);
    const future = [{ id: 'legacy-future', name: 'Legacy Future', appearance: {} }];
    const archive = [{ id: 'legacy-archive', name: 'Legacy Archive', appearance: {} }];
    writeJson(layout.preferenceFile, { language: 'en', futurePunkPresets: future, archivePunkPresets: archive });

    const store = createPreferencesStore(layout);
    assert.deepEqual(await store.load(), { language: 'en', futurePunkPresets: future, archivePunkPresets: archive });
    await store.save({ language: 'zh-CN' });
    assert.deepEqual(JSON.parse(fs.readFileSync(layout.themePresetFile, 'utf8')),
      { schemaVersion: 1, futurePunkPresets: future, archivePunkPresets: archive });
    assert.deepEqual(JSON.parse(fs.readFileSync(layout.preferenceFile, 'utf8')), { language: 'zh-CN' });
    assert.deepEqual(await createPreferencesStore(layout).load(),
      { language: 'zh-CN', futurePunkPresets: future, archivePunkPresets: archive });
    passed.push('legacy embedded themes retained and separated on save');
  });

  await t.test('invalid files, oversized arrays, and external edits are rejected without replacement', async (t) => {
    const badPreferencesLayout = installLayout('bad-preferences');
    prepareStorageSync(badPreferencesLayout);
    fs.writeFileSync(badPreferencesLayout.preferenceFile, '{broken');
    const badPreferencesStore = createPreferencesStore(badPreferencesLayout);
    await assert.rejects(badPreferencesStore.load(), /invalid JSON/);
    assert.equal(fs.readFileSync(badPreferencesLayout.preferenceFile, 'utf8'), '{broken');

    const badThemesLayout = installLayout('bad-theme-file');
    prepareStorageSync(badThemesLayout);
    writeJson(badThemesLayout.preferenceFile, { language: 'en' });
    writeJson(badThemesLayout.themePresetFile, { schemaVersion: 2, futurePunkPresets: [], archivePunkPresets: [] });
    await assert.rejects(createPreferencesStore(badThemesLayout).load(), /unsupported schema/);

    const oversizedLayout = installLayout('oversized-themes');
    prepareStorageSync(oversizedLayout);
    const oversizedStore = createPreferencesStore(oversizedLayout);
    await oversizedStore.load();
    const tooMany = Array.from({ length: 51 }, (_, index) => ({ id: `preset-${index}`, name: `Preset ${index}`, appearance: {} }));
    await assert.rejects(oversizedStore.save({ futurePunkPresets: tooMany }), /exceeds 50 presets/);
    assert.equal(fs.existsSync(oversizedLayout.preferenceFile), false);
    assert.equal(fs.existsSync(oversizedLayout.themePresetFile), false);

    const changedPreferencesLayout = installLayout('changed-preferences');
    prepareStorageSync(changedPreferencesLayout);
    writeJson(changedPreferencesLayout.preferenceFile, { language: 'en' });
    const changedPreferencesStore = createPreferencesStore(changedPreferencesLayout);
    await changedPreferencesStore.load();
    const externalPreferences = JSON.stringify({ language: 'external-edit' });
    fs.writeFileSync(changedPreferencesLayout.preferenceFile, externalPreferences);
    await assert.rejects(changedPreferencesStore.save({ language: 'zh-CN' }), /changed since it was loaded/);
    assert.equal(fs.readFileSync(changedPreferencesLayout.preferenceFile, 'utf8'), externalPreferences);

    const changedThemesLayout = installLayout('changed-themes');
    prepareStorageSync(changedThemesLayout);
    const changedThemesStore = createPreferencesStore(changedThemesLayout);
    await changedThemesStore.save({ language: 'en', futurePunkPresets: [], archivePunkPresets: [] });
    await changedThemesStore.load();
    const externalThemes = JSON.stringify({ schemaVersion: 1, futurePunkPresets: [{ id: 'external' }], archivePunkPresets: [] });
    fs.writeFileSync(changedThemesLayout.themePresetFile, externalThemes);
    await assert.rejects(changedThemesStore.save({ language: 'zh-CN' }), /changed since it was loaded/);
    assert.equal(fs.readFileSync(changedThemesLayout.themePresetFile, 'utf8'), externalThemes);
    passed.push('bad JSON/schema, array limit, and external edit protection');

    await t.test('installed junctions resolving outside the install directory are rejected', (junctionTest) => {
      const layout = installLayout('junction-escape');
      const dataRoot = path.join(layout.installDir, 'data');
      fs.mkdirSync(dataRoot, { recursive: true });
      const outside = path.join(runRoot, 'junction-target');
      fs.mkdirSync(outside, { recursive: true });
      const link = layout.lspUserDataDir;
      try {
        fs.symlinkSync(outside, link, 'junction');
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP', 'EINVAL'].includes(error.code)) {
          skipped.push(`junction containment (${error.code})`);
          junctionTest.skip(`junction creation unavailable: ${error.code}`);
          return;
        }
        throw error;
      }
      assert.throws(() => prepareStorageSync(layout), /resolves outside its root/);
      passed.push('junction escape rejection');
    });
  });
});
