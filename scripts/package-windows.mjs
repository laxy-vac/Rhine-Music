import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { stageWindowsPayload, inspectWindowsPayloadInputs } from './stage-windows-payload.mjs';

const require = createRequire(import.meta.url);
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8'));
const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const versionMatch = semanticVersionPattern.exec(String(version));
if (!versionMatch) throw new Error('package.json must contain a valid semantic version.');
if (process.platform !== 'win32') throw new Error('The Windows portable ZIP must be built on Windows.');

const releaseRoot = path.join(project, '.tools', 'releases');
const run = path.join(releaseRoot, `${version}-${Date.now()}`);
const preparedIndex = process.argv.indexOf('--prepared-payload');
if (preparedIndex >= 0 && !process.argv[preparedIndex + 1]) {
  throw new Error('--prepared-payload requires a directory.');
}
const payload = preparedIndex < 0
  ? path.join(run, 'payload')
  : path.resolve(process.argv[preparedIndex + 1]);
const archiveName = `Rhine-Music-${version}-Windows-x64-Portable.zip`;
const archive = path.join(run, archiveName);

const portableReadme = `Rhine Music ${version} - Windows x64 便携版
========================================

这是 Portable 便携 ZIP，不是安装程序。解压后直接运行 "Rhine Music.exe"。
不需要管理员权限；播放器和运行库不会被释放到 AppData 或其他系统目录。

解压与启动
----------
1. 解压到新的、普通用户可写的空文件夹，例如 D:/Apps/Rhine Music。
2. 保持完整目录结构，不要只复制 exe。
3. 双击 "Rhine Music.exe"。ZIP 已预建 data/ 下的默认存储目录；
   首次启动直接使用，缺失时会重新创建。

目录结构
--------
Rhine Music.exe        播放器主程序
resources/app/         界面、桌面宿主、原生音频和随包运行库
data/                  设置、曲库索引、封面/资料缓存、歌词缓存、会话、日志、
                       崩溃转储、临时文件和 LSP 用户数据
presets/themes/        两套主题的个人预设
presets/eq/            音频处理/EQ 个人预设
README-Portable.txt    本说明
release-manifest.json  载荷文件清单与 SHA-256

默认存储
--------
全部位于解压目录内：
  data/config/         偏好设置与 EQ 库配置
  data/library/        曲库索引、封面/资料缓存；默认歌词缓存在
                       data/library/lyrics/cache
  data/session/        浏览器会话与缓存
  data/logs/           运行日志
  data/crashes/        崩溃转储
  data/tmp/            临时文件
  data/lsp/            LSP 原生窗口用户数据
  presets/themes/      theme-presets.json
  presets/eq/          audio-processing-presets.json 和入门 EQ 预设
data/config/ 等数据子目录与 presets/eq/standard/ 已随 ZIP 以空目录预建；
presets 下另附说明文件。若被删除，播放器会在首次启动时重新创建。程序不会
回退到 AppData、旧自解压运行时缓存或用户 profile。

更新
----
1. 退出播放器。
2. 把新版本 ZIP 解压到另一个新文件夹。
3. 将旧文件夹的 data/ 和 presets/ 复制到新文件夹。
4. 启动新文件夹中的 "Rhine Music.exe"；确认新版可用前保留旧文件夹以便回滚。
不要把新版本直接解压到正在使用的程序目录，避免新旧运行库混用。

备份与迁移
----------
- 完整备份：复制整个解压文件夹。
- 轻量备份：只复制 data/ 和 presets/。
- 迁移：复制整个文件夹，或重新解压程序后把 data/、presets/ 放到旁边。
- 删除整个解压目录会同时删除其中的 data/ 和 presets/，请先备份。
- 音乐文件不在此文件夹内；删除播放器目录不会删除外部音乐。
- 删除 data/ 会丢失设置、索引和缓存；删除 presets/ 会丢失个人主题/EQ 预设。

安全边界
--------
- 音乐扫描只读；标签写回、覆盖资料和删除个人内容都需要在界面中主动操作。
- 本包不包含个人曲库、个人设置或凭据。
- 歌词缓存目录可在设置中更改；若移到本文件夹外，请自行备份。

系统要求
--------
Windows 10/11 x64。目标电脑不需要 .NET、Python 或 Node.js；所需运行库已随包提供。
`;

const dataReadme = `Rhine Music 便携版数据目录
==========================

本目录保存播放器设置、曲库索引、封面/资料缓存、歌词缓存、浏览器会话、
日志、崩溃转储、临时文件和 LSP 用户数据。ZIP 已预建以下空目录；缺失时
播放器会在首次启动时重新创建：

  config/    preferences.json 与入门 EQ 库配置
  library/   曲库索引、封面/资料缓存；默认歌词缓存在
             library/lyrics/cache
  session/   浏览器会话与缓存
  logs/      运行日志
  crashes/   崩溃转储
  tmp/       临时文件
  lsp/       LSP 原生窗口用户数据

备份或迁移时复制整个目录。删除本目录会丢失设置、索引和缓存；音乐文件
不在此目录内。
`;

const themeReadme = `Rhine Music 主题预设
====================

本目录保存“莱茵生命：映像”和“仿孤星”两套主题的个人预设，文件名为
theme-presets.json。更新或备份播放器时请保留本目录。
`;

const eqReadme = `Rhine Music EQ 预设
===================

本目录保存音频处理/EQ 个人预设。主预设文件为
audio-processing-presets.json；入门 EQ 预设默认保存在 standard/ 子目录。
更新或备份播放器时请保留本目录。
`;

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function assertRealDirectory(directory, label) {
  let info;
  try {
    info = await fs.lstat(directory);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} is missing: ${directory}`);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
}

async function assertRegularFile(file, label) {
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${label} is missing: ${file}`);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`${label} must be a regular file: ${file}`);
  }
  return info;
}

async function assertWindowsX64Executable(file) {
  await assertRegularFile(file, 'Rhine Music executable');
  const handle = await fs.open(file, 'r');
  try {
    const dos = Buffer.alloc(64);
    const dosRead = await handle.read(dos, 0, dos.length, 0);
    if (dosRead.bytesRead < dos.length || dos[0] !== 0x4d || dos[1] !== 0x5a) {
      throw new Error(`Portable executable is not a valid PE file: ${file}`);
    }
    const peOffset = dos.readUInt32LE(0x3c);
    const header = Buffer.alloc(6);
    const headerRead = await handle.read(header, 0, header.length, peOffset);
    if (headerRead.bytesRead < header.length || header.toString('latin1', 0, 4) !== 'PE\0\0') {
      throw new Error(`Portable executable has no valid PE header: ${file}`);
    }
    const machine = header.readUInt16LE(4);
    if (machine !== 0x8664) {
      throw new Error(`Portable executable is not Windows x64 (machine 0x${machine.toString(16)}): ${file}`);
    }
  } finally {
    await handle.close();
  }
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function toLowerPosix(value) {
  return toPosix(value).toLowerCase();
}

async function enumerate(directory, relative = '') {
  const files = [];
  const directories = [];
  const entries = await fs.readdir(path.join(directory, ...relative.split('/')), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    const absolute = path.join(directory, ...name.split('/'));
    const info = await fs.lstat(absolute);
    if (info.isSymbolicLink()) throw new Error(`Portable payload contains a symbolic link: ${name}`);
    if (info.isDirectory()) {
      directories.push(name);
      const child = await enumerate(directory, name);
      files.push(...child.files);
      directories.push(...child.directories);
    } else if (info.isFile()) {
      files.push(name);
    } else {
      throw new Error(`Portable payload contains an unsupported entry: ${name}`);
    }
  }
  return { files, directories };
}

async function updateReleaseManifest(root, record, entries) {
  if (!record || !Array.isArray(record.files)) {
    throw new Error('Portable payload manifest is missing or invalid.');
  }
  const actual = new Set(entries.files);
  const known = new Map();
  for (const item of record.files) {
    if (!item || typeof item.path !== 'string' || item.path.includes('..') || path.isAbsolute(item.path)) {
      throw new Error('Portable payload manifest contains an invalid file entry.');
    }
    if (!actual.has(item.path)) {
      throw new Error(`release-manifest.json lists a file that is missing from the payload: ${item.path}`);
    }
    known.set(item.path, item);
  }
  const files = [];
  for (const relative of entries.files) {
    if (relative === 'release-manifest.json' || relative === 'release-manifest.sha256') continue;
    let item = known.get(relative);
    if (!item) {
      const absolute = path.join(root, ...relative.split('/'));
      const info = await assertRegularFile(absolute, 'Portable payload file');
      item = {
        path: relative,
        sizeBytes: info.size,
        sha256: await sha256(absolute),
      };
    }
    files.push(item);
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  record.files = files;
  const text = JSON.stringify(record, null, 2) + '\n';
  await fs.writeFile(path.join(root, 'release-manifest.json'), text, 'utf8');
  const digest = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  await fs.writeFile(
    path.join(root, 'release-manifest.sha256'),
    digest + '  release-manifest.json\n',
    'utf8',
  );
  return { files, sha256: digest };
}

async function writePortableFile(root, relative, content) {
  const destination = path.resolve(root, ...relative.split('/'));
  const inside = path.relative(path.resolve(root), destination);
  if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) {
    throw new Error(`Portable file path escapes the payload: ${relative}`);
  }
  let current;
  try {
    current = await fs.readFile(destination, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (current !== undefined) {
    if (current !== content) {
      throw new Error(`Portable documentation already exists with different content: ${relative}`);
    }
    return;
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content, 'utf8');
  await assertRegularFile(destination, 'Portable documentation');
}

const portableStorageDirectories = [
  'data/config',
  'data/library/lyrics/cache',
  'data/session',
  'data/logs',
  'data/crashes',
  'data/tmp',
  'data/lsp',
  'presets/eq/standard',
];

async function addPortableLayout(root) {
  for (const [relative, content] of [
    ['README-Portable.txt', portableReadme],
    ['data/README.txt', dataReadme],
    ['presets/themes/README.txt', themeReadme],
    ['presets/eq/README.txt', eqReadme],
  ]) {
    await writePortableFile(root, relative, content);
  }
  for (const relative of portableStorageDirectories) {
    const directory = path.resolve(root, ...relative.split('/'));
    const inside = path.relative(path.resolve(root), directory);
    if (inside === '..' || inside.startsWith('..' + path.sep) || path.isAbsolute(inside)) {
      throw new Error(`Portable storage path escapes the payload: ${relative}`);
    }
    await fs.mkdir(directory, { recursive: true });
    const info = await fs.lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Portable storage path is not a real directory: ${relative}`);
    }
  }
}

async function assertPortableStorageContract(projectRoot, probeRoot) {
  const { resolveStorageLayout } = require('../desktop/app-storage.cjs');
  const executable = path.join(probeRoot, 'Rhine Music.exe');
  const installDir = path.dirname(executable);
  const layout = resolveStorageLayout({ projectRoot, execPath: executable });
  const expected = {
    mode: 'installed',
    sourcePreview: false,
    installDir,
    storageRoot: installDir,
    dataRoot: path.join(installDir, 'data'),
    dataDir: path.join(installDir, 'data', 'library'),
    home: path.join(installDir, 'data', 'config'),
    sessionDir: path.join(installDir, 'data', 'session'),
    logsDir: path.join(installDir, 'data', 'logs'),
    crashDir: path.join(installDir, 'data', 'crashes'),
    tempDir: path.join(installDir, 'data', 'tmp'),
    lspUserDataDir: path.join(installDir, 'data', 'lsp'),
    presetsRoot: path.join(installDir, 'presets'),
    themePresetFile: path.join(installDir, 'presets', 'themes', 'theme-presets.json'),
    audioPresetFile: path.join(installDir, 'presets', 'eq', 'audio-processing-presets.json'),
  };
  for (const [key, value] of Object.entries(expected)) {
    if (layout[key] !== value) {
      throw new Error(`Portable storage layout is not inside the extracted folder: ${key} = ${layout[key]}`);
    }
  }
  const main = await fs.readFile(path.join(projectRoot, 'desktop', 'main.cjs'), 'utf8');
  for (const token of [
    "app.setPath('userData',storage.home)",
    "app.setPath('sessionData',storage.sessionDir)",
    "app.setPath('temp',storage.tempDir)",
    "app.setPath('crashDumps',storage.crashDir)",
    "app.setAppLogsPath(storage.logsDir)",
    'process.env.TEMP=storage.tempDir',
  ]) {
    if (!main.includes(token)) {
      throw new Error(`desktop/main.cjs does not keep portable storage in the extracted folder: ${token}`);
    }
  }
  return expected;
}

const portableDocumentation = new Set([
  'readme-portable.txt',
  'data/readme.txt',
  'presets/themes/readme.txt',
  'presets/eq/readme.txt',
]);

const requiredFiles = [
  'Rhine Music.exe',
  'resources/default_app.asar',
  'ffmpeg.dll',
  'icudtl.dat',
  'resources.pak',
  'snapshot_blob.bin',
  'v8_context_snapshot.bin',
  'release-manifest.json',
  'release-manifest.sha256',
  'README-Portable.txt',
  'data/README.txt',
  'presets/themes/README.txt',
  'presets/eq/README.txt',
  'resources/app/package.json',
  'resources/app/dist/index.html',
  'resources/app/desktop/main.cjs',
  'resources/app/desktop/preload.cjs',
  'resources/app/desktop/app-storage.cjs',
  'resources/app/desktop/standard-eq-presets.cjs',
  'resources/app/src/window-aspect-model.mjs',
  'resources/app/src/entry-preferences.mjs',
  'resources/app/src/known-issues.mjs',
  'resources/app/scripts/music-server.mjs',
  'resources/app/scripts/lyrics-library.mjs',
  'resources/app/LICENSE',
  'resources/app/NOTICE.md',
  'resources/app/docs/README.md',
  'resources/app/docs/DEVELOPMENT.md',
  'resources/app/vendor/audio/windows-x64/assets.json',
  'resources/app/vendor/audio/windows-x64/rhine-audio-host.exe',
  'resources/app/vendor/audio/windows-x64/rhine-lsp-eq.dll',
  'resources/app/vendor/audio/windows-x64/lsp-para-equalizer.clap',
  'resources/app/vendor/audio/windows-x64/lsp-r3d-wgl-lib.dll',
  'resources/app/vendor/sony-walkman-x86/assets.json',
  'resources/app/vendor/sony-walkman-x86/sony-dsp-x86.dll',
  'resources/app/runtime/python/python.exe',
  'resources/app/runtime/python/python314.dll',
  'resources/app/runtime/python/python314.zip',
  'resources/app/runtime/python/python314._pth',
].map(toLowerPosix);

const requiredDirectories = [
  'locales',
  'resources/app',
  'data',
  'data/config',
  'data/library',
  'data/library/lyrics',
  'data/library/lyrics/cache',
  'data/session',
  'data/logs',
  'data/crashes',
  'data/tmp',
  'data/lsp',
  'presets',
  'presets/themes',
  'presets/eq',
  'presets/eq/standard',
].map(toLowerPosix);

const forbiddenFiles = [
  [/(^|\/)uninstall\.exe$/i, 'installer or uninstaller'],
  [/(^|\/)rhine-desktop-payload\.zip$/i, 'old self-extracting payload'],
  [/(^|\/)\.rhine-music\.ini$/i, 'old installer marker'],
  [/(^|\/)preferences\.json$/i, 'personal preferences'],
  [/(^|\/)theme-presets\.json$/i, 'personal theme presets'],
  [/(^|\/)audio-processing-presets\.json$/i, 'personal audio presets'],
  [/(^|\/)music-data(?:-source-preview)?(?:\/|$)/i, 'personal music data'],
  [/(^|\/)appdata(?:\/|$)/i, 'user AppData path'],
  [/(^|\/)\.local(?:\/|$)/i, 'local user profile path'],
  [/(^|\/)\.git(?:\/|$)/i, 'source control metadata'],
];

function validatePortablePayload(entries) {
  const files = new Set(entries.files.map(toLowerPosix));
  const directories = new Set(entries.directories.map(toLowerPosix));
  for (const file of files) {
    if ((file.startsWith('data/') || file.startsWith('presets/')) && !portableDocumentation.has(file)) {
      throw new Error(`Portable payload contains runtime data or personal presets: ${file}`);
    }
    for (const [pattern, label] of forbiddenFiles) {
      if (pattern.test(file)) throw new Error(`Portable payload contains ${label}: ${file}`);
    }
  }
  for (const file of requiredFiles) {
    if (!files.has(file)) throw new Error(`Portable payload is missing a required file: ${file}`);
  }
  for (const directory of requiredDirectories) {
    if (!directories.has(directory)) throw new Error(`Portable payload is missing a required directory: ${directory}`);
  }
}

async function verifyElectronLibraries(root) {
  const runtime = path.join(project, '.tools', 'source-preview-electron');
  const libraries = [];
  for (const entry of await fs.readdir(runtime, { withFileTypes: true })) {
    if (!/\.dll$/i.test(entry.name)) continue;
    if (!entry.isFile()) throw new Error(`Electron runtime library is not a regular file: ${entry.name}`);
    await assertRegularFile(path.join(root, entry.name), 'Bundled Electron runtime library');
    libraries.push(entry.name);
  }
  return libraries.sort();
}

function psLiteral(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

function runProcess(command, args, { cwd = project } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve()
      : reject(new Error(`${path.basename(command)} exited with code ${code}`)));
  });
}

async function runPowerShell(script, cwd) {
  await runProcess(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { cwd });
}

async function createPortableArchive(sourceRoot, destination, cwd) {
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $source = [System.IO.Path]::GetFullPath(${psLiteral(sourceRoot)}); $separator = [System.IO.Path]::DirectorySeparatorChar.ToString(); $prefix = $source; if (-not $prefix.EndsWith($separator)) { $prefix += $separator }; $destination = ${psLiteral(destination)}; if (Test-Path -LiteralPath $destination) { throw "Portable ZIP already exists: $destination" }; $zip = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create); try { foreach ($directory in ([System.IO.Directory]::EnumerateDirectories($source, '*', [System.IO.SearchOption]::AllDirectories) | Sort-Object)) { $relative = $directory.Substring($prefix.Length).Replace($separator, '/') + '/'; [void]$zip.CreateEntry($relative) }; foreach ($file in ([System.IO.Directory]::EnumerateFiles($source, '*', [System.IO.SearchOption]::AllDirectories) | Sort-Object)) { $relative = $file.Substring($prefix.Length).Replace($separator, '/'); [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file, $relative, [System.IO.Compression.CompressionLevel]::Optimal) } } finally { $zip.Dispose() }`;
  await runPowerShell(script, cwd);
  await assertRegularFile(destination, 'Portable ZIP');
}

async function verifyPortableArchive(archiveFile, payloadFileCount) {
  const entries = [
    'Rhine Music.exe',
    'resources/app/package.json',
    'resources/app/desktop/main.cjs',
    'data/',
    'data/README.txt',
    'data/config/',
    'data/library/',
    'data/library/lyrics/',
    'data/library/lyrics/cache/',
    'data/session/',
    'data/logs/',
    'data/crashes/',
    'data/tmp/',
    'data/lsp/',
    'presets/',
    'presets/themes/',
    'presets/themes/README.txt',
    'presets/eq/',
    'presets/eq/README.txt',
    'presets/eq/standard/',
    'README-Portable.txt',
  ];
  const script = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $zip = [System.IO.Compression.ZipFile]::OpenRead(${psLiteral(archiveFile)}); try { foreach ($name in @(${entries.map(psLiteral).join(', ')})) { if ($null -eq $zip.GetEntry($name)) { throw "Portable ZIP is missing an entry: $name" } }; if ($zip.Entries.Count -lt ${payloadFileCount}) { throw "Portable ZIP contains fewer entries than the payload file count." } } finally { $zip.Dispose() }`;
  await runPowerShell(script, path.dirname(archiveFile));
}

const toolsInfo = await fs.lstat(path.join(project, '.tools')).catch(error => {
  if (error.code === 'ENOENT') throw new Error('The project .tools directory is missing.');
  throw error;
});
if (toolsInfo.isSymbolicLink() || !toolsInfo.isDirectory()) {
  throw new Error('Project tools path must be a real directory.');
}
try { await fs.mkdir(releaseRoot); } catch (error) { if (error.code !== 'EEXIST') throw error; }
await assertRealDirectory(releaseRoot, 'Release output path');
await fs.mkdir(run);
await assertRealDirectory(run, 'Release run path');

let staged;
let record;
if (preparedIndex < 0) {
  staged = await stageWindowsPayload({ projectRoot: project, outputDir: payload, version });
  record = JSON.parse(await fs.readFile(path.join(payload, 'release-manifest.json'), 'utf8'));
} else {
  const boundary = releaseRoot + path.sep;
  if (!payload.toLowerCase().startsWith(boundary.toLowerCase())) {
    throw new Error('A prepared payload must be inside this project\'s .tools/releases directory.');
  }
  await assertRealDirectory(payload, 'Prepared payload');
  const realReleaseRoot = await fs.realpath(releaseRoot);
  const realPayload = await fs.realpath(payload);
  const realRelative = path.relative(realReleaseRoot, realPayload);
  if (realRelative === '' || realRelative === '..' ||
      realRelative.startsWith('..' + path.sep) || path.isAbsolute(realRelative)) {
    throw new Error('A prepared payload resolves outside this project\'s .tools/releases directory.');
  }
  const inputs = await inspectWindowsPayloadInputs({ projectRoot: project, version });
  record = JSON.parse(await fs.readFile(path.join(payload, 'release-manifest.json'), 'utf8'));
  if (record.version !== version || record.nativeRuntime.sourceSha256 !== inputs.native.manifest.sourceSha256) {
    throw new Error('载荷版本/原生来源过期');
  }
  for (const item of record.files) {
    if (item.path.includes('..') || path.isAbsolute(item.path)) throw new Error('载荷路径无效');
    const bytes = await fs.readFile(path.join(payload, item.path));
    if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) {
      throw new Error(`载荷内容变化：${item.path}`);
    }
  }
  for (const relative of inputs.graph.files) {
    const original = await fs.readFile(path.join(project, relative));
    const copy = await fs.readFile(path.join(payload, 'resources/app', relative));
    if (!original.equals(copy)) throw new Error(`载荷后台源码过期：${relative}`);
  }
  for (const [relative, destination] of [
    ['README.md', 'resources/app/docs/README.md'],
    ['docs/DEVELOPMENT.md', 'resources/app/docs/DEVELOPMENT.md'],
    ['LICENSE', 'resources/app/LICENSE'],
    ['NOTICE.md', 'resources/app/NOTICE.md'],
  ]) {
    const original = await fs.readFile(path.join(project, relative));
    const copy = await fs.readFile(path.join(payload, destination));
    if (!original.equals(copy)) throw new Error(`Prepared payload source file is out of date: ${relative}`);
  }
  staged = { warnings: inputs.warnings };
}
if (!record || record.version !== version || !Array.isArray(record.files)) {
  throw new Error('Portable payload manifest is missing or invalid.');
}

const storage = await assertPortableStorageContract(project, payload);
await addPortableLayout(payload);
await assertWindowsX64Executable(path.join(payload, 'Rhine Music.exe'));
const electronLibraries = await verifyElectronLibraries(payload);
const entries = await enumerate(payload);
validatePortablePayload(entries);
const manifestUpdate = await updateReleaseManifest(payload, record, entries);
await createPortableArchive(payload, archive, run);
await verifyPortableArchive(archive, entries.files.length);
const archiveInfo = await fs.stat(archive);
const digest = await sha256(archive);
await fs.writeFile(archive + '.sha256', `${digest}  ${archiveName}\n`, 'utf8');
await fs.writeFile(path.join(run, 'build-report.json'), JSON.stringify({
  schemaVersion: 1,
  product: 'Rhine Music',
  version,
  format: 'windows-x64-portable-zip',
  archive: archiveName,
  sha256: digest,
  bytes: archiveInfo.size,
  executable: 'Rhine Music.exe',
  electronLibraries,
  storage: {
    mode: 'portable',
    root: 'extraction directory',
    data: 'data/',
    themes: 'presets/themes/',
    eq: 'presets/eq/',
    appDataUsed: false,
    layout: storage,
  },
  payload: {
    files: entries.files.length,
    directories: entries.directories.length,
    manifestFiles: manifestUpdate.files.length,
    manifestSha256: manifestUpdate.sha256,
  },
  stagedWarnings: staged.warnings ?? [],
  validation: [
    'stage-windows-payload source, dependency and hash checks',
    'portable storage layout and Electron path overrides',
    'Rhine Music.exe PE machine is Windows x64',
    'required Electron, native audio, Python and Sony files',
    'empty default storage directories are materialized in the ZIP',
    'no personal data or presets under data/ and presets/',
    'release-manifest.json covers every payload file except its own manifest pair',
    'ZIP entry presence and entry count',
  ],
  notValidated: 'Player was not launched; no audio device, user library or personal profile was accessed.',
}, null, 2) + '\n', 'utf8');
console.log(`便携 ZIP：${archive}\nSHA256：${digest}\n大小：${(archiveInfo.size / 1048576).toFixed(1)} MiB\n未启动播放器，未访问曲库或音频设备。`);
