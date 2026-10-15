'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const CONFIG_FILE = 'standard-eq-library.json';
const CONFIG_MAX_BYTES = 32 * 1024;
const PRESET_MAX_BYTES = 4 * 1024 * 1024;
const POWERAMP_EXTENSION = '.json';
const STANDARD_EXTENSION = '.rhine-eq';
const SUPPORTED_EXTENSIONS = new Set([POWERAMP_EXTENSION, STANDARD_EXTENSION]);
const ACTIONS = new Set(['list', 'choose-directory', 'import', 'read', 'save', 'save-copy', 'save-as', 'rename', 'open-directory']);
const REQUEST_KEYS = new Set(['action', 'language', 'fileName', 'revision', 'content', 'name']);
const INVALID_WINDOWS_NAME = /[<>:"/\\|?*\u0000-\u001f]/u;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isMissing(error) {
  return error?.code === 'ENOENT';
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function sameFileIdentity(left, right) {
  return Boolean(left && right && left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino);
}

async function writeExclusiveFile(file, bytes) {
  let handle;
  let createdInfo;
  try {
    handle = await fs.open(file, 'wx', 0o600);
    createdInfo = await handle.stat();
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return createdInfo;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (createdInfo) {
      try {
        const current = await fs.lstat(file);
        if (sameFileIdentity(current, createdInfo)) await fs.unlink(file);
      } catch {}
    }
    throw error;
  }
}

async function readRegularFile(file, maximumBytes, label) {
  const sizeLimit = maximumBytes < 1024 * 1024
    ? `${Math.round(maximumBytes / 1024)} KiB`
    : `${maximumBytes / (1024 * 1024)} MiB`;
  const tooLarge = () => new Error(`${label} exceeds ${sizeLimit}`);
  const before = await fs.lstat(file);
  if (before.isSymbolicLink()) throw new Error(`${label} is a symbolic link`);
  if (!before.isFile()) throw new Error(`${label} is not a regular file`);
  if (before.size > maximumBytes) throw tooLarge();

  const handle = await fs.open(file, 'r');
  let opened;
  let bytes;
  try {
    opened = await handle.stat();
    if (!sameFileIdentity(before, opened)) throw new Error(`${label} changed while being read`);
    if (opened.size > maximumBytes) throw tooLarge();
    bytes = await handle.readFile();
  } finally {
    await handle.close();
  }

  const after = await fs.lstat(file);
  if (after.isSymbolicLink()) throw new Error(`${label} is a symbolic link`);
  if (!sameFileIdentity(opened, after)) throw new Error(`${label} changed while being read`);
  if (bytes.byteLength > maximumBytes) throw tooLarge();
  return bytes;
}

function errorText(error, english) {
  const message = String(error?.message || error || 'Unknown error');
  if (english) return message;
  const translations = [
    [/Preset file changed outside the player; reload it before saving\.?/i, '预设文件已在播放器外发生变化，请重新读取后再保存。'],
    [/Preset file is not a regular file/i, '预设不是普通文件，已拒绝访问。'],
    [/Preset file is a symbolic link/i, '预设是符号链接，已拒绝访问。'],
    [/Preset file name is invalid/i, '预设文件名无效。'],
    [/Preset file does not exist/i, '预设文件不存在。'],
    [/The selected preset directory is unavailable/i, '所选预设目录不可用。'],
    [/The selected preset directory is a symbolic link/i, '所选预设目录是符号链接，已拒绝访问。'],
    [/A file with that name already exists/i, '同名预设已存在，未覆盖原文件。'],
    [/The preset name is invalid/i, '预设名称包含 Windows 不允许的字符。'],
    [/Preset content must be a UTF-8 string/i, '预设内容必须是 UTF-8 文本。'],
    [/Invalid standard EQ preset request/i, '入门 EQ 预设请求无效。'],
    [/Unsupported standard EQ preset action/i, '不支持此入门 EQ 预设操作。'],
    [/Preset revision is required/i, '缺少预设版本校验值。'],
    [/Preset revision does not match/i, '预设文件已在播放器外发生变化，请重新读取后再保存。'],
    [/The corrected \.rhine-eq target already exists/i, '自动补全 .rhine-eq 后目标已存在，请在另存对话框中直接选择正确扩展名的文件以确认覆盖。'],
  ];
  for (const [pattern, translated] of translations) {
    if (pattern.test(message)) return translated;
  }
  return message;
}

function nameFromFile(fileName) {
  return fileName.slice(0, fileName.length - path.extname(fileName).length);
}

function validateFileName(fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName === '.' || fileName === '..') {
    throw new Error('Preset file name is invalid');
  }
  if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0') || path.basename(fileName) !== fileName) {
    throw new Error('Preset file name is invalid');
  }
  const stem = nameFromFile(fileName);
  if (INVALID_WINDOWS_NAME.test(fileName) || stem.endsWith('.') || stem.endsWith(' ') || RESERVED_WINDOWS_NAME.test(stem)) {
    throw new Error('Preset file name is invalid');
  }
  if (!SUPPORTED_EXTENSIONS.has(path.extname(fileName).toLowerCase()) || nameFromFile(fileName).length === 0) {
    throw new Error('Preset file name is invalid');
  }
  if (fileName.length > 240) throw new Error('Preset file name is invalid');
  return fileName;
}

function validateName(value) {
  if (typeof value !== 'string') throw new Error('The preset name is invalid');
  let name = value.trim();
  if (/\.rhine-eq$/i.test(name)) name = name.slice(0, -STANDARD_EXTENSION.length).trimEnd();
  else if (/\.json$/i.test(name)) name = name.slice(0, -POWERAMP_EXTENSION.length).trimEnd();
  if (!name || name === '.' || name === '..' || name.endsWith('.') || name.endsWith(' ')) {
    throw new Error('The preset name is invalid');
  }
  if (INVALID_WINDOWS_NAME.test(name) || RESERVED_WINDOWS_NAME.test(name) || name.length > 220) {
    throw new Error('The preset name is invalid');
  }
  return name;
}

function validateImportName(fileName) {
  if (typeof fileName !== 'string' || !fileName || fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0') || path.basename(fileName) !== fileName) {
    throw new Error('Preset file name is invalid');
  }
  if (INVALID_WINDOWS_NAME.test(fileName) || fileName.endsWith('.') || fileName.endsWith(' ') || fileName.length > 240) {
    throw new Error('Preset file name is invalid');
  }
  const extension = path.extname(fileName).toLowerCase();
  if (SUPPORTED_EXTENSIONS.has(extension)) {
    validateFileName(fileName);
    return { fileName, stem: nameFromFile(fileName), extension };
  }
  return { fileName, stem: validateName(path.parse(fileName).name), extension };
}

function encodeText(sourceText) {
  if (typeof sourceText !== 'string') throw new Error('Preset content must be a UTF-8 string');
  const bytes = Buffer.from(sourceText, 'utf8');
  if (bytes.byteLength > PRESET_MAX_BYTES) throw new Error('Preset content exceeds 4 MiB');
  return bytes;
}

function decodeText(bytes) {
  const sourceText = bytes.toString('utf8');
  if (!Buffer.from(sourceText, 'utf8').equals(bytes)) throw new Error('Preset file is not valid UTF-8');
  return sourceText;
}

function createStandardEqPresetStore({
  home,
  audioPresetFile,
  projectRoot,
  dialog,
  shell,
  getWindow = () => undefined,
}) {
  if (typeof home !== 'string' || !home || typeof audioPresetFile !== 'string' || !audioPresetFile || typeof projectRoot !== 'string' || !projectRoot) {
    throw new TypeError('home, audioPresetFile, and projectRoot are required');
  }
  if (!dialog || typeof dialog.showOpenDialog !== 'function' || typeof dialog.showSaveDialog !== 'function') {
    throw new TypeError('dialog must provide showOpenDialog and showSaveDialog');
  }
  if (!shell || typeof shell.openPath !== 'function') throw new TypeError('shell must provide openPath');

  const defaultDirectory = path.join(path.dirname(audioPresetFile), 'standard');
  const configFile = path.join(home, CONFIG_FILE);
  let directory = path.resolve(defaultDirectory);
  let configFingerprint = null;
  let loaded = false;
  let loadPromise;
  let configError = '';
  let writeQueue = Promise.resolve();
  let parserPromise;

  async function parser() {
    if (!parserPromise) {
      parserPromise = import('../src/standard-eq-preset-format.mjs');
    }
    const module = await parserPromise;
    if (typeof module.parseStandardEqPresetFile !== 'function') throw new Error('Standard EQ preset parser is unavailable');
    return module.parseStandardEqPresetFile;
  }

  async function validateContent(sourceText, fileName, { enforceExtension = true } = {}) {
    const parse = await parser();
    let parsed;
    try {
      parsed = await parse(sourceText, fileName);
    } catch (error) {
      throw new Error(`Invalid standard EQ preset${fileName ? ` (${fileName})` : ''}: ${error.message}`, { cause: error });
    }
    if (!record(parsed) || !record(parsed.eq) || !['poweramp', 'rhine-standard'].includes(parsed.format)) throw new Error('Invalid standard EQ preset');
    if (fileName && enforceExtension) {
      const expected = path.extname(fileName).toLowerCase() === STANDARD_EXTENSION ? 'rhine-standard' : 'poweramp';
      if (parsed.format !== expected) throw new Error(`Preset format does not match ${path.extname(fileName)} file extension`);
    }
    return parsed;
  }

  async function readConfigBytes() {
    try {
      return await readRegularFile(configFile, CONFIG_MAX_BYTES, 'Standard EQ library configuration');
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async function loadConfig() {
    if (loaded) {
      if (configError) throw new Error(configError);
      return;
    }
    if (!loadPromise) {
      loadPromise = (async () => {
        try {
          const bytes = await readConfigBytes();
          if (!bytes) {
            directory = path.resolve(defaultDirectory);
            configFingerprint = null;
            loaded = true;
            return;
          }
          const value = JSON.parse(decodeText(bytes));
          if (!record(value) || value.schemaVersion !== 1 || typeof value.directory !== 'string' || !path.isAbsolute(value.directory) || Object.keys(value).some(key => !['schemaVersion', 'directory'].includes(key))) {
            throw new Error('Standard EQ library configuration is invalid');
          }
          directory = path.resolve(value.directory);
          configFingerprint = sha256(bytes);
          loaded = true;
        } catch (error) {
          configError = `Could not read standard EQ library configuration: ${error.message}`;
          throw new Error(configError, { cause: error });
        }
      })().catch(error => {
        loadPromise = undefined;
        throw error;
      });
    }
    return loadPromise;
  }

  async function currentConfigFingerprint() {
    const bytes = await readConfigBytes();
    return bytes ? sha256(bytes) : null;
  }

  async function writeConfig(nextDirectory) {
    const current = await currentConfigFingerprint();
    if (current !== configFingerprint) throw new Error('Standard EQ library configuration changed outside the player');
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, directory: nextDirectory }), 'utf8');
    const temporary = `${configFile}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (configFingerprint === null) {
        await writeExclusiveFile(configFile, bytes);
        await fs.unlink(temporary).catch(() => {});
      } else {
        await fs.rename(temporary, configFile);
      }
      configFingerprint = sha256(bytes);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function getDirectory({ createDefault = false } = {}) {
    await loadConfig();
    const selected = path.resolve(directory);
    let info;
    try {
      info = await fs.lstat(selected);
    } catch (error) {
      if (isMissing(error) && createDefault && samePath(selected, defaultDirectory)) {
        try { await fs.mkdir(selected, { recursive: true }); }
        catch (createError) { if (createError.code !== 'EEXIST') throw createError; }
        info = await fs.lstat(selected);
      } else if (isMissing(error)) {
        throw new Error('The selected preset directory is unavailable');
      } else {
        throw error;
      }
    }
    if (info.isSymbolicLink()) throw new Error('The selected preset directory is a symbolic link');
    if (!info.isDirectory()) throw new Error('The selected preset directory is unavailable');
    const actual = await fs.realpath(selected);
    if (!samePath(actual, selected)) throw new Error('The selected preset directory is unavailable');
    return actual;
  }

  async function existingDirectory(candidate) {
    try {
      const resolved = path.resolve(candidate);
      const info = await fs.lstat(resolved);
      if (info.isSymbolicLink() || !info.isDirectory()) return null;
      const actual = await fs.realpath(resolved);
      return samePath(actual, resolved) ? actual : null;
    } catch {
      return null;
    }
  }

  async function chooseDirectoryDefaultPath() {
    try {
      return await getDirectory({ createDefault: true });
    } catch {
      return await existingDirectory(path.dirname(directory))
        || await existingDirectory(home)
        || await existingDirectory(path.dirname(defaultDirectory))
        || path.resolve(home);
    }
  }

  async function readPreset(directoryPath, fileName, { validate = true } = {}) {
    validateFileName(fileName);
    const file = path.join(directoryPath, fileName);
    let bytes;
    try { bytes = await readRegularFile(file, PRESET_MAX_BYTES, 'Preset file'); }
    catch (error) { if (isMissing(error)) throw new Error('Preset file does not exist'); throw error; }
    const sourceText = decodeText(bytes);
    const parsed = validate ? await validateContent(sourceText, fileName) : undefined;
    return {
      fileName,
      name: nameFromFile(fileName),
      revision: sha256(bytes),
      sourceText,
      bytes,
      ...(parsed ? { format: parsed.format } : {}),
    };
  }

  async function listPresets(directoryPath) {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const presets = [];
    const issues = [];
    const candidates = entries.filter(entry => SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of candidates) {
      if (entry.isSymbolicLink()) {
        issues.push(`${entry.name}: symbolic link skipped`);
        continue;
      }
      if (!entry.isFile()) {
        issues.push(`${entry.name}: not a regular file`);
        continue;
      }
      try {
        const preset = await readPreset(directoryPath, entry.name);
        presets.push({ fileName: preset.fileName, name: preset.name, revision: preset.revision, format: preset.format });
      } catch (error) {
        issues.push(`${entry.name}: ${error.message}`);
      }
    }
    return { presets, ...(issues.length ? { issues } : {}) };
  }

  async function writeAtomic(directoryPath, fileName, bytes, expectedRevision) {
    validateFileName(fileName);
    const destination = path.join(directoryPath, fileName);
    const before = await readPreset(directoryPath, fileName, { validate: false });
    if (before.revision !== expectedRevision) throw new Error('Preset revision does not match');

    const temporary = path.join(directoryPath, `.rhine-eq-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;

      const current = await readPreset(directoryPath, fileName, { validate: false });
      if (current.revision !== expectedRevision) throw new Error('Preset revision does not match');
      await fs.rename(temporary, destination);
      return { fileName, name: nameFromFile(fileName), revision: sha256(bytes), sourceText: decodeText(bytes), format: 'rhine-standard' };
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function createUniqueFile(directoryPath, initialFileName, bytes, format) {
    validateFileName(initialFileName);
    const stem = nameFromFile(initialFileName);
    const extension = path.extname(initialFileName);
    for (let index = 1; index < 10000; index += 1) {
      const fileName = index === 1 ? `${stem}${extension}` : `${stem} (${index})${extension}`;
      validateFileName(fileName);
      const file = path.join(directoryPath, fileName);
      try {
        await writeExclusiveFile(file, bytes);
      } catch (error) {
        if (error.code === 'EEXIST') continue;
        throw error;
      }
      return { fileName, name: nameFromFile(fileName), revision: sha256(bytes), sourceText: decodeText(bytes), format };
    }
    throw new Error('Could not find an unused preset file name');
  }

  async function chooseDirectory(isOwned, english) {
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const defaultPath = await chooseDirectoryDefaultPath();
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const result = await dialog.showOpenDialog(getWindow(), {
      title: english ? 'Choose standard EQ preset folder' : '选择入门 EQ 预设文件夹',
      buttonLabel: english ? 'Use this folder' : '选择此文件夹',
      defaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
    });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, cancelled: true };
    const chosen = path.resolve(result.filePaths[0]);
    const info = await fs.lstat(chosen);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('The selected preset directory is unavailable');
    const actual = await fs.realpath(chosen);
    await writeConfig(actual);
    directory = actual;
    return { ok: true, directory: actual };
  }

  async function importPreset(isOwned, english) {
    const directoryPath = await getDirectory({ createDefault: true });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const result = await dialog.showOpenDialog(getWindow(), {
      title: english ? 'Import EQ preset' : '导入 EQ 预设',
      buttonLabel: english ? 'Import preset' : '导入预设',
      defaultPath: directoryPath,
      filters: [
        { name: 'Poweramp EQ preset', extensions: ['json'] },
        { name: 'Rhine EQ preset', extensions: ['rhine-eq'] },
        { name: english ? 'All files' : '所有文件', extensions: ['*'] },
      ],
      properties: ['openFile', 'dontAddToRecent'],
    });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    if (result.canceled || !result.filePaths?.[0]) return { ok: true, cancelled: true };
    const sourcePath = path.resolve(result.filePaths[0]);
    const sourceName = validateImportName(path.basename(sourcePath));
    const bytes = await readRegularFile(sourcePath, PRESET_MAX_BYTES, 'Preset file');
    const sourceText = decodeText(bytes);
    const parsed = await validateContent(sourceText, sourceName.fileName, { enforceExtension: false });
    if ((sourceName.extension === POWERAMP_EXTENSION && parsed.format !== 'poweramp')
      || (sourceName.extension === STANDARD_EXTENSION && parsed.format !== 'rhine-standard')) {
      throw new Error('Preset format does not match its file extension');
    }
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const extension = parsed.format === 'poweramp' ? POWERAMP_EXTENSION : STANDARD_EXTENSION;
    const targetName = validateFileName(`${sourceName.stem}${extension}`);
    const selected = await createUniqueFile(directoryPath, targetName, bytes, parsed.format);
    const listing = await listPresets(directoryPath);
    return { ok: true, selected, ...listing };
  }

  async function readPresetRequest(fileName) {
    const directoryPath = await getDirectory();
    const selected = await readPreset(directoryPath, fileName);
    return {
      ok: true,
      selected: {
        fileName: selected.fileName,
        name: selected.name,
        revision: selected.revision,
        sourceText: selected.sourceText,
        format: selected.format,
      },
    };
  }

  async function savePreset(request) {
    const fileName = validateFileName(request.fileName);
    const expectedRevision = validateRevision(request.revision);
    const bytes = encodeText(request.content);
    const sourceText = decodeText(bytes);
    await validateContent(sourceText, `${nameFromFile(fileName)}${STANDARD_EXTENSION}`);
    const directoryPath = await getDirectory();
    const current = await readPreset(directoryPath, fileName);
    if (current.revision !== expectedRevision) throw new Error('Preset revision does not match');
    if (current.format === 'poweramp') {
      const selected = await createUniqueFile(directoryPath, `${nameFromFile(fileName)}${STANDARD_EXTENSION}`, bytes, 'rhine-standard');
      const listing = await listPresets(directoryPath);
      return {
        ok: true,
        selected,
        message: request.language === 'en'
          ? 'The Poweramp original was kept; your edits were saved as a Rhine preset.'
          : '已保留 Poweramp 原件，编辑结果另存为 Rhine 预设。',
        ...listing,
      };
    }
    const selected = await writeAtomic(directoryPath, fileName, bytes, expectedRevision);
    return { ok: true, selected };
  }

  async function saveCopy(request) {
    const bytes = encodeText(request.content);
    const sourceText = decodeText(bytes);
    const name = validateName(request.name);
    await validateContent(sourceText, `${name}${STANDARD_EXTENSION}`);
    const directoryPath = await getDirectory({ createDefault: true });
    const selected = await createUniqueFile(directoryPath, `${name}${STANDARD_EXTENSION}`, bytes, 'rhine-standard');
    const listing = await listPresets(directoryPath);
    return { ok: true, selected, ...listing };
  }

  async function saveAs(request, isOwned, english) {
    const bytes = encodeText(request.content);
    const sourceText = decodeText(bytes);
    const suggestedName = validateName(request.name || (request.fileName ? nameFromFile(validateFileName(request.fileName)) : 'Standard EQ preset'));
    await validateContent(sourceText, `${suggestedName}${STANDARD_EXTENSION}`);
    const directoryPath = await getDirectory({ createDefault: true });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const result = await dialog.showSaveDialog(getWindow(), {
      title: english ? 'Save standard EQ preset as' : '另存 Rhine EQ 预设',
      buttonLabel: english ? 'Save preset' : '保存预设',
      defaultPath: path.join(directoryPath, `${suggestedName}${STANDARD_EXTENSION}`),
      filters: [{ name: 'Rhine EQ preset', extensions: ['rhine-eq'] }],
      properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
    });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
    let filePath = path.resolve(result.filePath);
    const selectedExtensionIsCorrect = path.extname(filePath).toLowerCase() === STANDARD_EXTENSION;
    if (!selectedExtensionIsCorrect) filePath += STANDARD_EXTENSION;
    const parent = path.dirname(filePath);
    const basename = path.basename(filePath);
    const fileName = validateFileName(basename);
    const parentInfo = await fs.lstat(parent);
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw new Error('Save location is unavailable');
    const actualParent = await fs.realpath(parent);
    if (!samePath(actualParent, parent)) throw new Error('Save location is unavailable');
    let existing;
    try { existing = await fs.lstat(filePath); }
    catch (error) { if (!isMissing(error)) throw error; }
    if (existing?.isSymbolicLink() || (existing && !existing.isFile())) throw new Error('Save target is not a regular file');
    if (existing && !selectedExtensionIsCorrect) {
      throw new Error('The corrected .rhine-eq target already exists; choose that exact .rhine-eq file to confirm overwrite');
    }
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    await writeSaveAsAtomic(filePath, bytes, Boolean(existing));
    const response = { ok: true, filePath, ...(samePath(parent, directoryPath) ? { selected: { fileName, name: nameFromFile(fileName), revision: sha256(bytes), sourceText, format: 'rhine-standard' } } : { savedOutside: true }) };
    if (samePath(parent, directoryPath)) Object.assign(response, await listPresets(directoryPath));
    return response;
  }

  async function writeSaveAsAtomic(filePath, bytes, replaceExisting) {
    const parent = path.dirname(filePath);
    const temporary = path.join(parent, `.rhine-eq-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fs.open(temporary, 'wx', 0o600);
      await handle.writeFile(bytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      if (replaceExisting) {
        const current = await fs.lstat(filePath);
        if (current.isSymbolicLink() || !current.isFile()) throw new Error('Save target is not a regular file');
        await fs.rename(temporary, filePath);
      } else {
        await writeExclusiveFile(filePath, bytes);
        await fs.unlink(temporary).catch(() => {});
      }
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(temporary).catch(() => {});
    }
  }

  async function renameCaseOnly(directoryPath, fromName, toName, expectedRevision, source) {
    const sourcePath = path.join(directoryPath, fromName);
    const destination = path.join(directoryPath, toName);
    const sourceInfo = await fs.lstat(sourcePath);
    if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error('Preset file is not a regular file');

    let destinationInfo;
    try { destinationInfo = await fs.lstat(destination); }
    catch (error) { if (!isMissing(error)) throw error; }
    if (!destinationInfo) return null;
    if (destinationInfo.isSymbolicLink() || !destinationInfo.isFile() || !sameFileIdentity(sourceInfo, destinationInfo)) {
      throw new Error('A file with that name already exists');
    }

    const beforeMove = await readPreset(directoryPath, fromName, { validate: false });
    if (beforeMove.revision !== expectedRevision) throw new Error('Preset revision does not match');
    const beforeMoveInfo = await fs.lstat(sourcePath);
    if (!sameFileIdentity(sourceInfo, beforeMoveInfo)) throw new Error('Preset file changed outside the player');

    const stagingDirectory = path.join(directoryPath, `.rhine-case-rename-${randomUUID()}`);
    await fs.mkdir(stagingDirectory);
    const stagedFile = path.join(stagingDirectory, 'preset.tmp');
    let sourceMoved = false;
    try {
      const current = await readPreset(directoryPath, fromName, { validate: false });
      if (current.revision !== expectedRevision) throw new Error('Preset revision does not match');
      await fs.rename(sourcePath, stagedFile);
      sourceMoved = true;

      const stagedInfo = await fs.lstat(stagedFile);
      if (!sameFileIdentity(sourceInfo, stagedInfo)) throw new Error('Preset file changed during rename');
      const stagedBytes = await readRegularFile(stagedFile, PRESET_MAX_BYTES, 'Preset file');
      if (sha256(stagedBytes) !== expectedRevision) throw new Error('Preset revision does not match');

      let destinationAfterMove;
      try { destinationAfterMove = await fs.lstat(destination); }
      catch (error) { if (!isMissing(error)) throw error; }
      if (destinationAfterMove && (
        destinationAfterMove.isSymbolicLink()
        || !destinationAfterMove.isFile()
        || !sameFileIdentity(sourceInfo, destinationAfterMove)
      )) {
        throw new Error('A file with that name already exists');
      }

      await fs.rename(stagedFile, destination);
      sourceMoved = false;
    } catch (error) {
      if (sourceMoved) {
        try {
          await fs.lstat(sourcePath);
          throw new Error('The original filename was recreated during rename');
        } catch (sourceError) {
          if (!isMissing(sourceError)) {
            throw new Error(`${error.message}; original preset remains staged at ${stagedFile}`, { cause: error });
          }
        }
        try { await fs.rename(stagedFile, sourcePath); }
        catch (restoreError) {
          throw new Error(`${error.message}; original preset remains staged at ${stagedFile}: ${restoreError.message}`, { cause: error });
        }
      }
      throw error;
    } finally {
      await fs.rmdir(stagingDirectory).catch(() => {});
    }

    const selected = {
      fileName: toName,
      name: nameFromFile(toName),
      revision: expectedRevision,
      sourceText: source.sourceText,
      format: source.format,
    };
    return { ok: true, selected, ...await listPresets(directoryPath) };
  }

  async function renamePreset(request) {
    const fromName = validateFileName(request.fileName);
    const expectedRevision = validateRevision(request.revision);
    const newName = validateName(request.name);
    const extension = path.extname(fromName);
    const toName = validateFileName(`${newName}${extension}`);
    const directoryPath = await getDirectory();
    const source = await readPreset(directoryPath, fromName);
    if (source.revision !== expectedRevision) throw new Error('Preset revision does not match');
    if (samePath(path.join(directoryPath, fromName), path.join(directoryPath, toName))) {
      if (fromName === toName) {
        const listing = await listPresets(directoryPath);
        return { ok: true, selected: { fileName: source.fileName, name: source.name, revision: source.revision, sourceText: source.sourceText, format: source.format }, ...listing };
      }
      const caseOnly = await renameCaseOnly(directoryPath, fromName, toName, expectedRevision, source);
      if (caseOnly) return caseOnly;
    }
    const destination = path.join(directoryPath, toName);
    let createdDestinationInfo;
    try {
      createdDestinationInfo = await writeExclusiveFile(destination, source.bytes);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('A file with that name already exists');
      throw error;
    }
    try {
      const current = await readPreset(directoryPath, fromName, { validate: false });
      if (current.revision !== expectedRevision) throw new Error('Preset revision does not match');
      const copied = await readPreset(directoryPath, toName, { validate: false });
      if (copied.revision !== expectedRevision) throw new Error('Renamed preset did not preserve its original bytes');
      await fs.unlink(path.join(directoryPath, fromName));
    } catch (error) {
      if (createdDestinationInfo) {
        try {
          const destinationNow = await fs.lstat(destination);
          if (sameFileIdentity(destinationNow, createdDestinationInfo)) await fs.unlink(destination);
        } catch {}
      }
      throw error;
    }
    const selected = { fileName: toName, name: newName, revision: expectedRevision, sourceText: source.sourceText, format: source.format };
    const listing = await listPresets(directoryPath);
    return { ok: true, selected, ...listing };
  }

  async function openDirectory(isOwned, english) {
    const directoryPath = await getDirectory({ createDefault: true });
    if (!isOwned()) return { ok: false, error: english ? 'The player window is no longer available' : '播放器窗口已关闭。' };
    const error = await shell.openPath(directoryPath);
    if (error) throw new Error(`Could not open standard EQ preset directory: ${error}`);
    return { ok: true, directory: directoryPath };
  }

  function validateRevision(revision) {
    if (typeof revision !== 'string' || !/^[a-f\d]{64}$/i.test(revision)) throw new Error('Preset revision is required');
    return revision.toLowerCase();
  }

  function enqueue(operation) {
    const result = writeQueue.catch(() => {}).then(operation);
    writeQueue = result;
    return result;
  }

  async function invoke(request, isOwned = () => true) {
    const english = request?.language === 'en';
    try {
      if (!record(request) || Object.keys(request).some(key => !REQUEST_KEYS.has(key))) throw new Error('Invalid standard EQ preset request');
      if (!ACTIONS.has(request.action)) throw new Error('Unsupported standard EQ preset action');
      if (request.language !== undefined && request.language !== 'en' && request.language !== 'zh-CN') throw new Error('Invalid standard EQ preset request');
      if (!isOwned()) return { ok: false, error: english ? 'Invalid player window' : '无效的播放器窗口。' };
      switch (request.action) {
        case 'list': {
          return await enqueue(async () => {
            const directoryPath = await getDirectory({ createDefault: true });
            return { ok: true, directory: directoryPath, ...await listPresets(directoryPath) };
          });
        }
        case 'choose-directory':
          return await enqueue(() => chooseDirectory(isOwned, english));
        case 'import':
          return await enqueue(() => importPreset(isOwned, english));
        case 'read':
          return await enqueue(() => readPresetRequest(validateFileName(request.fileName)));
        case 'save':
          return await enqueue(() => savePreset(request));
        case 'save-copy':
          return await enqueue(() => saveCopy(request));
        case 'save-as':
          return await enqueue(() => saveAs(request, isOwned, english));
        case 'rename':
          return await enqueue(() => renamePreset(request));
        case 'open-directory':
          return await enqueue(() => openDirectory(isOwned, english));
        default:
          throw new Error('Unsupported standard EQ preset action');
      }
    } catch (error) {
      return { ok: false, error: errorText(error, english) };
    }
  }

  return { invoke, defaultDirectory, configFile, flush: () => writeQueue.catch(() => {}) };
}

function registerStandardEqPresetIpc({ ipcMain, store, ownedEvent }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || !store || typeof store.invoke !== 'function' || typeof ownedEvent !== 'function') {
    throw new TypeError('ipcMain, store, and ownedEvent are required');
  }
  ipcMain.handle('rhine:standard-eq-presets', (event, request) => {
    if (!ownedEvent(event)) return Promise.resolve({ ok: false, error: 'Invalid player window' });
    return store.invoke(request, () => ownedEvent(event));
  });
}

module.exports = {
  createStandardEqPresetStore,
  registerStandardEqPresetIpc,
  validateFileName,
  validateName,
};
