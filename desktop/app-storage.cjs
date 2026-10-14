'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');

const PREFERENCES_MAX_BYTES = 2 * 1024 * 1024;
const THEME_PRESETS_MAX_BYTES = 2 * 1024 * 1024;
const THEME_PRESET_LIMIT = 50;
const THEME_KEYS = Object.freeze(['futurePunkPresets', 'archivePunkPresets']);
const PROBE_PREFIX = '.rhine-storage-probe-';

function requirePath(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty path`);
  return path.resolve(value);
}

function envPath(env, name) {
  const value = env && env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveStorageLayout({ projectRoot, execPath, sourcePreview = false, env = process.env } = {}) {
  const project = requirePath(projectRoot, 'projectRoot');

  if (sourcePreview === true) {
    const configuredHome = envPath(env, 'RHINE_APP_HOME');
    const home = configuredHome
      ? path.resolve(configuredHome)
      : path.join(project, '.local', 'desktop');
    const sourceProfileRoot = configuredHome
      ? path.dirname(home)
      : path.join(project, '.local');
    const configuredData = envPath(env, 'MUSIC_DATA_DIR');
    const dataDir = configuredData
      ? path.resolve(configuredData)
      : path.join(sourceProfileRoot, 'music-data');
    const presetsRoot = path.join(path.dirname(home), 'presets');

    return {
      mode: 'sourcePreview',
      sourcePreview: true,
      projectRoot: project,
      installDir: null,
      storageRoot: sourceProfileRoot,
      sourceProfileRoot,
      dataRoot: sourceProfileRoot,
      dataDir,
      dataDirIsIndependentOverride: Boolean(configuredData),
      home,
      sessionDir: path.join(sourceProfileRoot, 'session'),
      logsDir: path.join(sourceProfileRoot, 'logs'),
      crashDir: path.join(sourceProfileRoot, 'crashes'),
      tempDir: path.join(sourceProfileRoot, 'tmp'),
      lspUserDataDir: path.join(sourceProfileRoot, 'lsp'),
      presetsRoot,
      themePresetFile: path.join(presetsRoot, 'themes', 'theme-presets.json'),
      audioPresetFile: path.join(presetsRoot, 'eq', 'audio-processing-presets.json'),
      preferenceFile: path.join(home, 'preferences.json'),
    };
  }

  const executable = requirePath(execPath, 'execPath');
  const installDir = path.dirname(executable);
  const dataRoot = path.join(installDir, 'data');
  const home = path.join(dataRoot, 'config');
  const presetsRoot = path.join(installDir, 'presets');

  return {
    mode: 'installed',
    sourcePreview: false,
    projectRoot: project,
    execPath: executable,
    installDir,
    storageRoot: installDir,
    sourceProfileRoot: null,
    dataRoot,
    dataDir: path.join(dataRoot, 'library'),
    dataDirIsIndependentOverride: false,
    home,
    sessionDir: path.join(dataRoot, 'session'),
    logsDir: path.join(dataRoot, 'logs'),
    crashDir: path.join(dataRoot, 'crashes'),
    tempDir: path.join(dataRoot, 'tmp'),
    lspUserDataDir: path.join(dataRoot, 'lsp'),
    presetsRoot,
    themePresetFile: path.join(presetsRoot, 'themes', 'theme-presets.json'),
    audioPresetFile: path.join(presetsRoot, 'eq', 'audio-processing-presets.json'),
    preferenceFile: path.join(home, 'preferences.json'),
  };
}

function comparisonPath(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(comparisonPath(root), comparisonPath(candidate));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function directoryStat(directory) {
  const stat = fs.statSync(directory);
  if (!stat.isDirectory()) throw new Error(`Storage path is not a directory: ${directory}`);
  return stat;
}

function ensureRoot(root, create) {
  const resolved = path.resolve(root);
  if (create) fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync(resolved);
  directoryStat(real);
  return { resolved, real };
}

function ensureDirectoryWithin(boundary, target) {
  const resolved = path.resolve(target);
  if (!isWithin(boundary.resolved, resolved)) {
    throw new Error(`Managed storage path escapes its root: ${resolved}`);
  }

  const relative = path.relative(boundary.resolved, resolved);
  let current = boundary.resolved;
  if (relative) {
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      try {
        fs.lstatSync(current);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try {
          fs.mkdirSync(current);
        } catch (createError) {
          if (createError.code !== 'EEXIST') throw createError;
        }
      }

      const actual = fs.realpathSync(current);
      if (!isWithin(boundary.real, actual)) {
        throw new Error(`Managed storage path resolves outside its root: ${current}`);
      }
      directoryStat(actual);
    }
  }

  const actual = fs.realpathSync(resolved);
  if (!isWithin(boundary.real, actual)) {
    throw new Error(`Managed storage path resolves outside its root: ${resolved}`);
  }
  directoryStat(actual);
  return actual;
}

function ensureIndependentDirectory(target) {
  const resolved = path.resolve(target);
  fs.mkdirSync(resolved, { recursive: true });
  const actual = fs.realpathSync(resolved);
  directoryStat(actual);
  return actual;
}

function ensureManagedFile(boundary, file) {
  const resolved = path.resolve(file);
  if (!isWithin(boundary.resolved, resolved)) {
    throw new Error(`Managed storage file escapes its root: ${resolved}`);
  }
  try {
    fs.lstatSync(resolved);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const actual = fs.realpathSync(resolved);
  if (!isWithin(boundary.real, actual)) {
    throw new Error(`Managed storage file resolves outside its root: ${resolved}`);
  }
  if (!fs.statSync(actual).isFile()) throw new Error(`Managed storage file is not a regular file: ${resolved}`);
}

function probeDirectory(directory) {
  const probe = path.join(directory, `${PROBE_PREFIX}${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(probe, 'wx', 0o600);
    created = true;
    fs.writeSync(descriptor, 'Rhine Music storage probe\n');
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.unlinkSync(probe);
    created = false;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
    let cleanupError;
    if (created) {
      try { fs.unlinkSync(probe); } catch (cleanup) { cleanupError = cleanup; }
    }
    const failure = new Error(`Storage directory is not writable and cleanable: ${directory}: ${error.message}`, { cause: error });
    if (cleanupError) failure.cleanupError = cleanupError;
    throw failure;
  }
}

function prepareStorageSync(layout) {
  if (!layout || typeof layout !== 'object') throw new TypeError('layout is required');
  const installed = layout.sourcePreview !== true;
  const rootPath = installed ? layout.installDir : layout.sourceProfileRoot;
  if (typeof rootPath !== 'string' || !rootPath) throw new TypeError('layout root is missing');
  const boundary = ensureRoot(rootPath, !installed);

  const managedDirectories = [
    layout.home,
    layout.sessionDir,
    layout.logsDir,
    layout.crashDir,
    layout.tempDir,
    layout.dataDir,
    layout.lspUserDataDir,
    layout.presetsRoot,
    path.dirname(layout.themePresetFile),
    path.dirname(layout.audioPresetFile),
  ];
  const prepared = [];
  for (const directory of managedDirectories) {
    if (typeof directory !== 'string' || !directory) throw new TypeError('layout contains a missing managed directory');
    const independentDataDir = layout.sourcePreview === true && layout.dataDirIsIndependentOverride === true && directory === layout.dataDir;
    const actual = independentDataDir
      ? ensureIndependentDirectory(directory)
      : ensureDirectoryWithin(boundary, directory);
    if (!prepared.includes(actual)) prepared.push(actual);
  }

  for (const file of [layout.preferenceFile, layout.themePresetFile, layout.audioPresetFile]) {
    if (typeof file !== 'string' || !file) throw new TypeError('layout contains a missing managed file');
    ensureManagedFile(boundary, file);
  }

  for (const directory of prepared) probeDirectory(directory);
  return layout;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fingerprint(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function jsonText(value, label, limit) {
  let text;
  try { text = JSON.stringify(value); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error }); }
  if (typeof text !== 'string') throw new Error(`${label} is not a JSON value`);
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error(`${label} exceeds ${limit} bytes`);
  return text;
}

function validatePresetArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  if (value.length > THEME_PRESET_LIMIT) throw new Error(`${name} exceeds ${THEME_PRESET_LIMIT} presets`);
  const text = jsonText(value, name, THEME_PRESETS_MAX_BYTES);
  return JSON.parse(text);
}

function validateThemeStore(value, label = 'Theme preset file') {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error(`${label} has an unsupported schema`);
  const allowed = new Set(['schemaVersion', ...THEME_KEYS]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error(`${label} contains an unknown field`);
  for (const key of THEME_KEYS) {
    if (!Object.hasOwn(value, key)) throw new Error(`${label} is missing ${key}`);
  }
  const result = { schemaVersion: 1 };
  for (const key of THEME_KEYS) result[key] = validatePresetArray(value[key], key);
  jsonText(result, label, THEME_PRESETS_MAX_BYTES);
  return result;
}

async function readOptionalJson(file, label, limit) {
  let text;
  try { text = await fsp.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not read ${label} at ${file}: ${error.message}`, { cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error(`${label} exceeds ${limit} bytes: ${file}`);
  try { return { text, value: JSON.parse(text) }; }
  catch (error) { throw new Error(`${label} contains invalid JSON at ${file}: ${error.message}`, { cause: error }); }
}

async function readFingerprint(file, label, limit) {
  let text;
  try { text = await fsp.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Could not verify ${label} at ${file}: ${error.message}`, { cause: error });
  }
  if (Buffer.byteLength(text, 'utf8') > limit) throw new Error(`${label} exceeds ${limit} bytes and was not overwritten: ${file}`);
  return fingerprint(text);
}

async function writeJsonAtomic(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.next`;
  await fsp.writeFile(temporary, text, { mode: 0o600 });
  await fsp.rename(temporary, file);
}

function createPreferencesStore(layout) {
  if (!layout || typeof layout.preferenceFile !== 'string' || typeof layout.themePresetFile !== 'string') {
    throw new TypeError('layout must provide preferenceFile and themePresetFile');
  }

  let loaded = false;
  let loading;
  let currentPreferences = {};
  let currentThemes = { futurePunkPresets: [], archivePunkPresets: [] };
  let preferenceFingerprint = null;
  let themeFingerprint = null;
  let queue = Promise.resolve();

  function snapshot() {
    return JSON.parse(JSON.stringify({ ...currentPreferences, ...currentThemes }));
  }

  async function readState() {
    const preferencesFile = await readOptionalJson(layout.preferenceFile, 'Preferences file', PREFERENCES_MAX_BYTES);
    const themeFile = await readOptionalJson(layout.themePresetFile, 'Theme preset file', THEME_PRESETS_MAX_BYTES);
    const preferences = preferencesFile ? preferencesFile.value : {};
    if (!isRecord(preferences)) throw new Error(`Preferences file must contain a JSON object: ${layout.preferenceFile}`);

    const legacyThemes = { futurePunkPresets: [], archivePunkPresets: [] };
    for (const key of THEME_KEYS) {
      if (Object.hasOwn(preferences, key)) legacyThemes[key] = validatePresetArray(preferences[key], key);
    }
    for (const key of THEME_KEYS) delete preferences[key];

    const validatedThemeFile = themeFile ? validateThemeStore(themeFile.value) : null;
    currentPreferences = preferences;
    currentThemes = validatedThemeFile
      ? { futurePunkPresets: validatedThemeFile.futurePunkPresets, archivePunkPresets: validatedThemeFile.archivePunkPresets }
      : legacyThemes;
    preferenceFingerprint = preferencesFile ? fingerprint(preferencesFile.text) : null;
    themeFingerprint = themeFile ? fingerprint(themeFile.text) : null;
    loaded = true;
  }

  function ensureLoaded() {
    if (loaded) return Promise.resolve();
    if (!loading) {
      loading = readState().catch(error => {
        loading = undefined;
        throw error;
      });
    }
    return loading;
  }

  async function assertUnchanged(file, expected, label, limit) {
    const actual = await readFingerprint(file, label, limit);
    if (actual !== expected) throw new Error(`${label} changed since it was loaded; refusing to overwrite: ${file}`);
  }

  async function saveSerial(selected) {
    await ensureLoaded();
    if (!isRecord(selected)) throw new TypeError('selected preferences must be a JSON object');
    const selectedText = jsonText(selected, 'Preferences', PREFERENCES_MAX_BYTES);
    const normalized = JSON.parse(selectedText);
    const nextThemes = { ...currentThemes };
    for (const key of THEME_KEYS) {
      if (Object.hasOwn(selected, key)) nextThemes[key] = validatePresetArray(selected[key], key);
    }

    const themeRecord = { schemaVersion: 1, ...nextThemes };
    const themeText = jsonText(themeRecord, 'Theme preset file', THEME_PRESETS_MAX_BYTES);
    const config = { ...normalized };
    for (const key of THEME_KEYS) delete config[key];
    const preferenceText = jsonText(config, 'Preferences', PREFERENCES_MAX_BYTES);

    await assertUnchanged(layout.preferenceFile, preferenceFingerprint, 'Preferences file', PREFERENCES_MAX_BYTES);
    await assertUnchanged(layout.themePresetFile, themeFingerprint, 'Theme preset file', THEME_PRESETS_MAX_BYTES);

    await writeJsonAtomic(layout.themePresetFile, themeText);
    currentThemes = nextThemes;
    themeFingerprint = fingerprint(themeText);

    await writeJsonAtomic(layout.preferenceFile, preferenceText);
    currentPreferences = config;
    preferenceFingerprint = fingerprint(preferenceText);
    loaded = true;
    return snapshot();
  }

  function enqueue(operation) {
    const result = queue.catch(() => {}).then(operation);
    queue = result;
    return result;
  }

  return {
    load() {
      return enqueue(async () => {
        await ensureLoaded();
        return snapshot();
      });
    },
    save(selected) {
      return enqueue(() => saveSerial(selected));
    },
  };
}

module.exports = {
  resolveStorageLayout,
  prepareStorageSync,
  createPreferencesStore,
};
