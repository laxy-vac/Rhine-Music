import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Transform } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = path.join(projectRoot, '.tools');
const downloadsRoot = path.join(toolsRoot, 'downloads', 'pcm-codecs');
const stagingRoot = path.join(toolsRoot, 'dependency-staging', 'pcm-codecs');
const runtimeRoot = path.join(toolsRoot, 'audio-codecs', 'windows-x64');
const sdkRoot = path.join(projectRoot, 'vendor', 'audio', 'codec-sdk');

const sourceSpecs = [
  {
    id: 'ffmpeg-sdk',
    component: 'FFmpeg',
    version: 'n9.0.2-24-gfd5d616c29',
    file: 'ffmpeg-n9.0.2-24-gfd5d616c29-win64-lgpl-shared-9.0.zip',
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-09-14-16/ffmpeg-n9.0.2-24-gfd5d616c29-win64-lgpl-shared-9.0.zip',
    sha256: '1b5ebbf0a06def4602c8ac0e98f9987689a1bcfb56fc77dbeb33e38185ec97c6',
    license: 'LGPL-3.0-or-later',
    packageType: 'zip',
  },
  {
    id: 'flac-win',
    component: 'libFLAC Windows binaries',
    version: '1.5.0',
    file: 'flac-1.5.0-win.zip',
    url: 'https://downloads.xiph.org/releases/flac/flac-1.5.0-win.zip',
    sha256: '53f1500f0d6e7c61379d7fee50d4a9f7f504c650009506d9ba015530d76c0dde',
    license: 'BSD-3-Clause (Xiph License for libFLAC)',
    packageType: 'zip',
  },
  {
    id: 'flac-source',
    component: 'libFLAC headers and license source',
    version: '1.5.0',
    file: 'flac-1.5.0.tar.xz',
    url: 'https://downloads.xiph.org/releases/flac/flac-1.5.0.tar.xz',
    sha256: 'f2c1c76592a82ffff8413ba3c4a1299b6c7ab06c734dee03fd88630485c2b920',
    license: 'BSD-3-Clause (Xiph License for libFLAC)',
    packageType: 'tar.xz',
  },
  {
    id: 'soxr-source',
    component: 'libsoxr source build',
    version: '0.1.3',
    file: 'soxr-0.1.3-Source.tar.xz',
    url: 'https://downloads.sourceforge.net/project/soxr/soxr-0.1.3-Source.tar.xz',
    sha256: 'b111c15fdc8c029989330ff559184198c161100a59312f5dc19ddeb9b5a15889',
    license: 'LGPL-2.1-or-later',
    packageType: 'tar.xz',
  },
];

const windowsSystemDlls = new Set(
  [
    'advapi32.dll', 'avrt.dll', 'bcrypt.dll', 'bcryptprimitives.dll', 'cfgmgr32.dll', 'combase.dll',
    'comctl32.dll', 'comdlg32.dll', 'crypt32.dll', 'd2d1.dll', 'dbghelp.dll', 'dnsapi.dll', 'dwrite.dll', 'dwmapi.dll',
    'gdi32.dll', 'imm32.dll', 'iphlpapi.dll', 'kernel32.dll', 'kernelbase.dll', 'msvcrt.dll',
    'msimg32.dll', 'ncrypt.dll', 'normaliz.dll', 'ntdll.dll', 'ole32.dll', 'oleaut32.dll', 'powrprof.dll', 'psapi.dll',
    'rpcrt4.dll', 'secur32.dll', 'setupapi.dll', 'shell32.dll', 'shlwapi.dll', 'user32.dll',
    'userenv.dll', 'usp10.dll', 'version.dll', 'winhttp.dll', 'winmm.dll', 'wintrust.dll', 'ws2_32.dll',
    'wsock32.dll', 'wtsapi32.dll', 'ucrtbase.dll',
  ],
);
const hostPrerequisiteDlls = new Set(['vcomp140.dll', 'vcruntime140.dll']);

function log(message) {
  process.stdout.write(`${message}\n`);
}

function requireInside(parent, candidate, label) {
  const rel = path.relative(parent, candidate);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`${label} resolves outside its authorized directory: ${candidate}`);
  }
  return candidate;
}

function run(command, args, options = {}) {
  const { allowEmptyTarNameWarnings = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
    ...spawnOptions,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderrLines = String(result.stderr ?? '').split(/\r?\n/).filter(Boolean);
    const onlyKnownTarPaddingWarnings = allowEmptyTarNameWarnings
      && stderrLines.length > 0
      && stderrLines.every((line) => /Archive entry has empty or unreadable filename .*skipping|Error exit delayed from previous errors/i.test(line));
    if (onlyKnownTarPaddingWarnings) {
      log(`tar.exe skipped empty padding metadata entries in ${args.at(-1)}`);
      return result.stdout ?? '';
    }
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout ?? '';
}

function powershellQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadVerified(spec) {
  const destination = requireInside(downloadsRoot, path.join(downloadsRoot, spec.file), `download ${spec.id}`);
  await ensureDirectory(downloadsRoot);
  try {
    const current = await sha256File(destination);
    if (current !== spec.sha256) {
      throw new Error(`Cached ${spec.file} has SHA-256 ${current}; expected ${spec.sha256}. Preserving it for inspection.`);
    }
    log(`Using verified cache: ${spec.file}`);
    return destination;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  log(`Downloading ${spec.file}`);
  const response = await fetch(spec.url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${spec.url}`);
  const partial = path.join(downloadsRoot, `.${spec.file}.${process.pid}.partial`);
  const hash = createHash('sha256');
  const hashingTransform = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    const output = createWriteStream(partial, { flags: 'wx' });
    await pipeline(Readable.fromWeb(response.body), hashingTransform, output);
    const actual = hash.digest('hex');
    if (actual !== spec.sha256) throw new Error(`SHA-256 mismatch for ${spec.file}: got ${actual}; expected ${spec.sha256}`);
    await fs.rename(partial, destination);
  } catch (error) {
    await fs.rm(partial, { force: true }).catch(() => {});
    throw error;
  }
  log(`Verified SHA-256 ${spec.file}`);
  return destination;
}

function validateEntryName(entryName, root, label) {
  if (entryName.includes('\0')) throw new Error(`${label} contains a NUL path`);
  const normalized = entryName.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.startsWith('//')) {
    throw new Error(`${label} contains an absolute path: ${entryName}`);
  }
  if (normalized.split('/').some((part) => part === '..')) throw new Error(`${label} contains path traversal: ${entryName}`);
  if (normalized.includes(':')) throw new Error(`${label} contains a Windows alternate-stream path: ${entryName}`);
  const full = path.resolve(root, ...normalized.split('/').filter((part) => part && part !== '.'));
  requireInside(root, full, label);
  return normalized;
}

function zipEntryNames(buffer, extractionRoot, label) {
  const lower = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= lower; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${label} is not a standard ZIP (EOCD not found)`);
  const diskNo = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const diskEntries = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (diskNo || cdDisk || diskEntries !== totalEntries || totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error(`${label} uses multi-disk or ZIP64 metadata; refusing extraction without a boundary audit`);
  }
  const names = [];
  let offset = cdOffset;
  const seen = new Set();
  for (let i = 0; i < totalEntries; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${label} central directory is malformed`);
    const flags = buffer.readUInt16LE(offset + 8);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const externalAttrs = buffer.readUInt32LE(offset + 38);
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    const decoded = new TextDecoder((flags & 0x0800) ? 'utf-8' : 'latin1', { fatal: true }).decode(nameBytes);
    const name = validateEntryName(decoded, extractionRoot, label);
    const unixMode = externalAttrs >>> 16;
    if ((unixMode & 0xf000) === 0xa000) throw new Error(`${label} contains a symlink entry: ${name}`);
    const key = name.replace(/\/$/, '').toLowerCase();
    if (key && seen.has(key)) throw new Error(`${label} contains duplicate case-insensitive paths: ${name}`);
    if (key) seen.add(key);
    names.push(name);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

async function extractZipSafely(zipPath, destination, label) {
  const target = path.resolve(destination);
  await ensureDirectory(target);
  const contents = await fs.readFile(zipPath);
  const names = zipEntryNames(contents, target, label);
  log(`ZIP boundary audit passed for ${label} (${names.length} entries)`);
  const command = `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${powershellQuote(zipPath)} -DestinationPath ${powershellQuote(target)} -Force`;
  run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command]);
}

function validateTarArchive(archivePath, destination, label) {
  const namesOutput = run('tar.exe', ['-tf', archivePath], { allowEmptyTarNameWarnings: true });
  const names = namesOutput.split(/\r?\n/).filter(Boolean);
  for (const name of names) validateEntryName(name, destination, label);
  const verbose = run('tar.exe', ['-tvf', archivePath], { allowEmptyTarNameWarnings: true });
  for (const line of verbose.split(/\r?\n/)) {
    if (line && (line[0] === 'l' || line[0] === 'h')) {
      throw new Error(`${label} contains a link entry and needs manual review: ${line}`);
    }
  }
  return names;
}

async function extractTarSafely(archivePath, destination, label) {
  const target = path.resolve(destination);
  await ensureDirectory(target);
  const names = validateTarArchive(archivePath, target, label);
  log(`TAR boundary audit passed for ${label} (${names.length} entries)`);
  run('tar.exe', ['-xf', archivePath, '-C', target], { allowEmptyTarNameWarnings: true });
}

async function stageMarkerReady(stageDir, sourceHash) {
  try {
    const marker = await fs.readFile(path.join(stageDir, '.source-sha256'), 'utf8');
    return marker.trim() === sourceHash;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function newStageDir(name, sourceHash) {
  const dir = path.join(stagingRoot, `${name}-${sourceHash.slice(0, 12)}`);
  requireInside(stagingRoot, dir, `staging ${name}`);
  let dirExists = true;
  try {
    const marker = (await fs.readFile(path.join(dir, '.source-sha256'), 'utf8')).trim();
    if (marker === sourceHash) return { dir, reuse: true };
    if (marker === `in-progress:${sourceHash}`) {
      requireInside(stagingRoot, dir, `staging cleanup ${name}`);
      await fs.rm(dir, { recursive: true, force: true });
    } else {
      throw new Error(`Staging directory has an unexpected marker and is preserved: ${dir}`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') {
      dirExists = await fs.access(dir).then(() => true, (accessError) => {
        if (accessError?.code === 'ENOENT') return false;
        throw accessError;
      });
      if (dirExists) {
        const entries = await fs.readdir(dir);
        if (entries.length !== 0) throw new Error(`Unmarked staging directory contains data and is preserved: ${dir}`);
        requireInside(stagingRoot, dir, `staging cleanup ${name}`);
        await fs.rm(dir, { recursive: true, force: true });
        dirExists = false;
      }
    } else {
      throw error;
    }
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, '.source-sha256'), `in-progress:${sourceHash}\n`, { flag: 'wx' });
  return { dir, reuse: false };
}

async function markStage(dir, sourceHash) {
  await fs.writeFile(path.join(dir, '.source-sha256'), `${sourceHash}\n`, 'utf8');
}

async function listFilesRecursively(root) {
  const result = [];
  async function visit(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink in staged package: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) result.push(absolute);
    }
  }
  await visit(root);
  return result;
}

async function copyStable(source, destination) {
  const expectedHash = await sha256File(source);
  await ensureDirectory(path.dirname(destination));
  try {
    const existingHash = await sha256File(destination);
    if (existingHash === expectedHash) return expectedHash;
    throw new Error(`Refusing to overwrite a different existing file: ${destination}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.copyFile(source, destination);
  return expectedHash;
}

async function copyTreeStable(sourceRoot, destinationRoot) {
  const files = await listFilesRecursively(sourceRoot);
  for (const source of files) {
    const rel = path.relative(sourceRoot, source);
    const destination = requireInside(destinationRoot, path.join(destinationRoot, rel), 'SDK copy');
    await copyStable(source, destination);
  }
}

function normalizeDll(name) {
  return path.basename(name).toLowerCase();
}

function peImports(buffer, fileLabel) {
  if (buffer.length < 0x100 || buffer.readUInt16LE(0) !== 0x5a4d) throw new Error(`${fileLabel} is not a PE file`);
  const peOffset = buffer.readUInt32LE(0x3c);
  if (buffer.readUInt32LE(peOffset) !== 0x00004550) throw new Error(`${fileLabel} has an invalid PE signature`);
  const machine = buffer.readUInt16LE(peOffset + 4);
  if (machine !== 0x8664) throw new Error(`${fileLabel} is not an AMD64 Windows binary (machine 0x${machine.toString(16)})`);
  const coffOffset = peOffset + 4;
  const sectionCount = buffer.readUInt16LE(coffOffset + 2);
  const optionalSize = buffer.readUInt16LE(coffOffset + 16);
  const optionalOffset = coffOffset + 20;
  const magic = buffer.readUInt16LE(optionalOffset);
  const dataDirectoryOffset = magic === 0x20b ? optionalOffset + 112 : magic === 0x10b ? optionalOffset + 96 : -1;
  if (dataDirectoryOffset < 0) throw new Error(`${fileLabel} has an unsupported PE optional header`);
  const importRva = buffer.readUInt32LE(dataDirectoryOffset + 8);
  if (!importRva) return [];
  const sectionOffset = optionalOffset + optionalSize;
  const sections = [];
  for (let i = 0; i < sectionCount; i += 1) {
    const off = sectionOffset + i * 40;
    sections.push({
      virtualSize: buffer.readUInt32LE(off + 8),
      virtualAddress: buffer.readUInt32LE(off + 12),
      rawSize: buffer.readUInt32LE(off + 16),
      rawAddress: buffer.readUInt32LE(off + 20),
    });
  }
  const rvaToOffset = (rva) => {
    for (const section of sections) {
      const span = Math.max(section.virtualSize, section.rawSize);
      if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
        return section.rawAddress + (rva - section.virtualAddress);
      }
    }
    throw new Error(`${fileLabel} has an import RVA outside mapped sections`);
  };
  const readCString = (offset) => {
    let end = offset;
    while (end < buffer.length && buffer[end] !== 0) end += 1;
    if (end === buffer.length) throw new Error(`${fileLabel} has an unterminated import name`);
    return buffer.toString('ascii', offset, end);
  };
  const imports = [];
  let descriptorOffset = rvaToOffset(importRva);
  for (let count = 0; count < 4096; count += 1, descriptorOffset += 20) {
    if (descriptorOffset + 20 > buffer.length) throw new Error(`${fileLabel} has a truncated import table`);
    const nameRva = buffer.readUInt32LE(descriptorOffset + 12);
    if (!nameRva) return [...new Set(imports)].sort();
    imports.push(readCString(rvaToOffset(nameRva)));
  }
  throw new Error(`${fileLabel} import table has no terminator`);
}

function isWindowsSystemDll(name) {
  const base = normalizeDll(name);
  return base.startsWith('api-ms-win-') || base.startsWith('ext-ms-win-') || windowsSystemDlls.has(base);
}

async function allDllCandidates(root) {
  const candidates = new Map();
  for (const file of await listFilesRecursively(root)) {
    if (!file.toLowerCase().endsWith('.dll')) continue;
    const key = normalizeDll(file);
    if (!candidates.has(key)) candidates.set(key, []);
    candidates.get(key).push(file);
  }
  return candidates;
}

async function writeTextManaged(filePath, contents) {
  await ensureDirectory(path.dirname(filePath));
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === contents) return;
    if (!existing.includes('generatedBy: scripts/prepare-pcm-codecs.mjs')
      && !existing.includes('"generatedBy": "scripts/prepare-pcm-codecs.mjs"')
      && !existing.includes('Prepared by scripts/prepare-pcm-codecs.mjs.')) {
      throw new Error(`Refusing to overwrite user-managed file: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.writeFile(filePath, contents, 'utf8');
}

async function materializeZip(spec, archivePath) {
  const stage = await newStageDir(spec.id, spec.sha256);
  if (!stage.reuse) {
    await extractZipSafely(archivePath, stage.dir, spec.file);
    await markStage(stage.dir, spec.sha256);
  }
  return stage.dir;
}

async function materializeTar(spec, archivePath) {
  const stage = await newStageDir(spec.id, spec.sha256);
  if (!stage.reuse) {
    await extractTarSafely(archivePath, stage.dir, spec.file);
    await markStage(stage.dir, spec.sha256);
  }
  return stage.dir;
}

function findFile(files, predicate, label) {
  const matches = files.filter(predicate);
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly one match, found ${matches.length}:\n${matches.join('\n')}`);
  }
  return matches[0];
}

function licenseFileCandidates(files) {
  return files.filter((file) => /(^|[\\/])(copying(\.[^\\/]*)?|license(\.[^\\/]*)?|licence(\.[^\\/]*)?)$/i.test(file));
}

async function main() {
  const headersOnly = process.argv.includes('--headers-only');
  await ensureDirectory(downloadsRoot);
  await ensureDirectory(stagingRoot);
  await ensureDirectory(runtimeRoot);
  await ensureDirectory(path.join(sdkRoot, 'include'));
  await ensureDirectory(path.join(sdkRoot, 'licenses'));

  const selectedSpecs = headersOnly
    ? sourceSpecs.filter((spec) => ['ffmpeg-sdk', 'flac-source', 'soxr-source'].includes(spec.id))
    : sourceSpecs;
  const downloaded = new Map();
  for (const spec of selectedSpecs) downloaded.set(spec.id, await downloadVerified(spec));

  if (headersOnly) {
    const ffmpegSpec = sourceSpecs.find((spec) => spec.id === 'ffmpeg-sdk');
    const flacSourceSpec = sourceSpecs.find((spec) => spec.id === 'flac-source');
    const [ffmpegRoot, flacSourceRoot] = await Promise.all([
      materializeZip(ffmpegSpec, downloaded.get('ffmpeg-sdk')),
      materializeTar(flacSourceSpec, downloaded.get('flac-source')),
    ]);
    const buildScript = path.join(projectRoot, 'scripts', 'build-soxr-runtime.mjs');
    run(process.execPath, [buildScript, '--source-only']);
    const ffmpegFiles = await listFilesRecursively(ffmpegRoot);
    const flacSourceFiles = await listFilesRecursively(flacSourceRoot);
    const soxrSourceRoot = path.join(projectRoot, 'vendor', 'audio', 'soxr', 'source', 'soxr-0.1.3-Source');
    const avcodecHeader = findFile(ffmpegFiles, (file) => /[\\/]include[\\/]libavcodec[\\/]avcodec\.h$/i.test(file), 'FFmpeg avcodec.h');
    const ffmpegInclude = path.dirname(path.dirname(avcodecHeader));
    const streamDecoderHeader = findFile(flacSourceFiles, (file) => /[\\/]include[\\/]FLAC[\\/]stream_decoder\.h$/i.test(file), 'libFLAC stream_decoder.h');
    const flacIncludeRoot = path.dirname(path.dirname(streamDecoderHeader));
    const soxrHeader = path.join(soxrSourceRoot, 'src', 'soxr.h');
    const soxrLicense = path.join(soxrSourceRoot, 'LICENCE');
    await copyTreeStable(ffmpegInclude, path.join(sdkRoot, 'include'));
    await copyTreeStable(path.join(flacIncludeRoot, 'FLAC'), path.join(sdkRoot, 'include', 'FLAC'));
    const flacLicense = findFile(flacSourceFiles, (file) => path.basename(file).toLowerCase() === 'copying.xiph', 'Xiph libFLAC license');
    await copyStable(flacLicense, path.join(sdkRoot, 'licenses', 'libFLAC-COPYING.Xiph'));
    await copyStable(soxrHeader, path.join(sdkRoot, 'include', 'soxr.h'));
    await copyStable(soxrLicense, path.join(sdkRoot, 'licenses', 'libsoxr-LICENCE'));
    const partialReadme = `# PCM codec SDK\n\nPrepared by scripts/prepare-pcm-codecs.mjs. Headers currently staged for FFmpeg ${ffmpegSpec.version}, libFLAC ${flacSourceSpec.version}, and libsoxr ${sourceSpecs[3].version}; the full preparation run builds the scalar CR64 SoXR DLL and writes the file-hash manifest.\n`;
    await writeTextManaged(path.join(sdkRoot, 'README.md'), partialReadme);
    log(`Headers ready: ${path.relative(projectRoot, path.join(sdkRoot, 'include'))}`);
    return;
  }

  const [ffmpegRoot, flacWinRoot, flacSourceRoot] = await Promise.all([
    materializeZip(sourceSpecs[0], downloaded.get('ffmpeg-sdk')),
    materializeZip(sourceSpecs[1], downloaded.get('flac-win')),
    materializeTar(sourceSpecs[2], downloaded.get('flac-source')),
  ]);
  const soxrBuildScript = path.join(projectRoot, 'scripts', 'build-soxr-runtime.mjs');
  run(process.execPath, [soxrBuildScript]);

  const ffmpegFiles = await listFilesRecursively(ffmpegRoot);
  const flacFiles = await listFilesRecursively(flacWinRoot);
  const flacSourceFiles = await listFilesRecursively(flacSourceRoot);
  const soxrSourceRoot = path.join(projectRoot, 'vendor', 'audio', 'soxr', 'source', 'soxr-0.1.3-Source');

  const avcodecHeader = findFile(ffmpegFiles, (file) => /[\\/]include[\\/]libavcodec[\\/]avcodec\.h$/i.test(file), 'FFmpeg avcodec.h');
  const ffmpegInclude = path.dirname(path.dirname(avcodecHeader));
  const flacInclude = findFile(flacSourceFiles, (file) => /[\\/]include[\\/]FLAC[\\/]stream_decoder\.h$/i.test(file), 'libFLAC stream_decoder.h');
  const flacIncludeRoot = path.dirname(path.dirname(flacInclude));
  const flacDll = findFile(flacFiles, (file) => /[\\/]win64[\\/]libflac\.dll$/i.test(file), 'official x64 libFLAC.dll');
  const soxrHeader = path.join(soxrSourceRoot, 'src', 'soxr.h');
  const soxrDll = path.join(runtimeRoot, 'soxr.dll');
  const soxrLicense = path.join(soxrSourceRoot, 'LICENCE');
  const flacLicense = findFile(flacSourceFiles, (file) => path.basename(file).toLowerCase() === 'copying.xiph', 'Xiph libFLAC license');
  const ffmpegLicense = findFile(licenseFileCandidates(ffmpegFiles), (file) => /(^|[\\/])(license|copying)(\.(txt|lgpl|lgplv3|lgplv3\.txt))?$/i.test(path.basename(file)), 'FFmpeg package license');

  await copyTreeStable(ffmpegInclude, path.join(sdkRoot, 'include'));
  await copyTreeStable(path.join(flacIncludeRoot, 'FLAC'), path.join(sdkRoot, 'include', 'FLAC'));
  await copyStable(soxrHeader, path.join(sdkRoot, 'include', 'soxr.h'));
  await copyStable(ffmpegLicense, path.join(sdkRoot, 'licenses', 'FFmpeg-LICENSE.txt'));
  await copyStable(flacLicense, path.join(sdkRoot, 'licenses', 'libFLAC-COPYING.Xiph'));
  await copyStable(soxrLicense, path.join(sdkRoot, 'licenses', 'libsoxr-LICENCE'));

  const readme = `# PCM codec SDK\n\nPrepared by scripts/prepare-pcm-codecs.mjs. Files are staged for local dynamic loading and C header integration; no system installation or registry changes are made.\n\n## Components\n\n- FFmpeg ${sourceSpecs[0].version}: LGPL shared Windows x64 SDK.\n- libFLAC ${sourceSpecs[1].version}: Xiph BSD-3-Clause library; public headers come from the matching source release.\n- libsoxr ${sourceSpecs[3].version}: built from the official LGPL-2.1-or-later source with a scalar CR64 double-precision engine and FFT4G64.\n\nThe SoXR build disables OpenMP, SIMD engines, and AVX. Headers are under include/; license texts are under licenses/. Runtime DLLs are in .tools/audio-codecs/windows-x64/. See vendor/audio/codec-components.json for source URLs, build flags, and per-file SHA-256 digests.\n`;
  await writeTextManaged(path.join(sdkRoot, 'README.md'), readme);

  const ffmpegBin = path.dirname(findFile(ffmpegFiles, (file) => /[\\/]bin[\\/]avcodec-[^\\/]+\.dll$/i.test(file), 'FFmpeg avcodec runtime DLL'));
  const candidateRoots = [ffmpegBin, path.dirname(flacDll), runtimeRoot];
  const candidates = new Map();
  for (const candidateRoot of candidateRoots) {
    for (const [name, files] of await allDllCandidates(candidateRoot)) {
      if (!candidates.has(name)) candidates.set(name, []);
      candidates.get(name).push(...files);
    }
  }

  const seeds = [
    findFile(ffmpegFiles, (file) => /[\\/]bin[\\/]avcodec-[^\\/]+\.dll$/i.test(file), 'FFmpeg avcodec DLL'),
    findFile(ffmpegFiles, (file) => /[\\/]bin[\\/]avformat-[^\\/]+\.dll$/i.test(file), 'FFmpeg avformat DLL'),
    findFile(ffmpegFiles, (file) => /[\\/]bin[\\/]avutil-[^\\/]+\.dll$/i.test(file), 'FFmpeg avutil DLL'),
    flacDll,
    soxrDll,
  ];
  const sourceByRuntimeName = new Map();
  const runtimeImports = new Map();
  const missingImports = new Set();
  const systemImports = new Set();
  const hostPrerequisites = new Map();
  const system32Root = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const queue = [];
  for (const source of seeds) {
    const runtimeName = path.basename(source).toLowerCase() === 'libflac.dll' ? 'FLAC.dll' : path.basename(source);
    sourceByRuntimeName.set(runtimeName.toLowerCase(), source);
    queue.push({ source, runtimeName });
  }
  const queuedRuntimeNames = new Set();
  while (queue.length) {
    const { source, runtimeName } = queue.shift();
    const target = path.join(runtimeRoot, runtimeName);
    await copyStable(source, target);
    const runtimeKey = runtimeName.toLowerCase();
    if (queuedRuntimeNames.has(runtimeKey)) continue;
    queuedRuntimeNames.add(runtimeKey);
    const imports = peImports(await fs.readFile(source), source);
    runtimeImports.set(runtimeName, imports);
    for (const imported of imports) {
      const key = normalizeDll(imported);
      if (isWindowsSystemDll(key)) {
        systemImports.add(imported);
        continue;
      }
      if (hostPrerequisiteDlls.has(key)) {
        const prerequisitePath = path.join(system32Root, path.basename(imported));
        try {
          await fs.access(prerequisitePath);
          const command = `(Get-Item -LiteralPath ${powershellQuote(prerequisitePath)}).VersionInfo.FileVersion`;
          const observedVersion = run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command]).trim();
          const major = Number.parseInt(observedVersion.split('.')[0], 10);
          if (!observedVersion || !Number.isFinite(major) || major < 14) {
            missingImports.add(imported);
          } else {
            hostPrerequisites.set(key, {
              dll: path.basename(imported),
              location: 'Windows System32',
              minimumVersionMajor: 14,
              observedFileVersion: observedVersion,
            });
          }
        } catch (error) {
          if (error?.code === 'ENOENT') missingImports.add(imported);
          else throw error;
        }
        continue;
      }
      if (key === 'libflac.dll' && sourceByRuntimeName.has('flac.dll')) continue;
      const options = candidates.get(key) ?? [];
      if (options.length === 0) {
        missingImports.add(imported);
        continue;
      }
      const distinctHashes = new Set(await Promise.all(options.map((file) => sha256File(file))));
      if (distinctHashes.size > 1) throw new Error(`Conflicting DLL candidates for ${imported}: ${options.join(', ')}`);
      const dependencySource = options[0];
      const dependencyName = path.basename(dependencySource);
      sourceByRuntimeName.set(dependencyName.toLowerCase(), dependencySource);
      if (!queuedRuntimeNames.has(dependencyName.toLowerCase())) queue.push({ source: dependencySource, runtimeName: dependencyName });
    }
  }

  const sdkFiles = [];
  for (const file of await listFilesRecursively(sdkRoot)) {
    const relativePath = path.relative(sdkRoot, file).split(path.sep).join('/');
    sdkFiles.push({ path: relativePath, size: (await fs.stat(file)).size, sha256: await sha256File(file) });
  }
  sdkFiles.sort((a, b) => a.path.localeCompare(b.path));
  const runtimeFiles = [];
  for (const file of (await listFilesRecursively(runtimeRoot)).filter((entry) => entry.toLowerCase().endsWith('.dll'))) {
    runtimeFiles.push({
      path: path.relative(projectRoot, file).split(path.sep).join('/'),
      size: (await fs.stat(file)).size,
      sha256: await sha256File(file),
      imports: runtimeImports.get(path.basename(file)) ?? [],
    });
  }
  runtimeFiles.sort((a, b) => a.path.localeCompare(b.path));

  const soxrBuild = JSON.parse(await fs.readFile(path.join(projectRoot, 'vendor', 'audio', 'soxr', 'build-manifest.json'), 'utf8'));
  const sourceFiles = soxrBuild.sourceFiles
    .filter((entry) => entry.path.startsWith('vendor/audio/soxr/'))
    .map(({ path: relativePath, sha256 }) => ({ path: relativePath, sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    schemaVersion: 1,
    generatedBy: 'scripts/prepare-pcm-codecs.mjs',
    platform: 'windows-x64',
    preparedAt: new Date().toISOString(),
    components: sourceSpecs.map((spec) => ({
      id: spec.id,
      component: spec.component,
      version: spec.version,
      license: spec.license,
      sourceUrl: spec.url,
      sourceFile: path.relative(projectRoot, downloaded.get(spec.id)).split(path.sep).join('/'),
      sourceSha256: spec.sha256,
      packageType: spec.packageType,
    })),
    sdkRoot: path.relative(projectRoot, sdkRoot).split(path.sep).join('/'),
    sdkFiles,
    soxrBuild,
    sourceFiles,
    runtimeRoot: path.relative(projectRoot, runtimeRoot).split(path.sep).join('/'),
    runtimeFiles,
    hostPrerequisites: [...hostPrerequisites.values()].sort((a, b) => a.dll.localeCompare(b.dll)),
    runtimeNotes: [
      'SoXR is built from the official 0.1.3 source with OpenMP, SIMD engines, AVX, and VR32 disabled; only the scalar CR64 double-precision engine with FFT4G64 is included.',
      'PE import inspection found no VCOMP140 or VCRUNTIME140 imports in the source-built SoXR DLL; remaining CRT API-set and Windows DLL imports are host-provided.',
    ],
    windowsSystemImports: [...systemImports].sort((a, b) => a.localeCompare(b)),
    unresolvedImports: [...missingImports].sort((a, b) => a.localeCompare(b)),
  };
  const manifestPath = path.join(projectRoot, 'vendor', 'audio', 'codec-components.json');
  await writeTextManaged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  log(`SDK headers and licenses ready: ${path.relative(projectRoot, sdkRoot)}`);
  log(`Runtime DLLs staged: ${path.relative(projectRoot, runtimeRoot)}`);
  log(`Manifest written: ${path.relative(projectRoot, manifestPath)}`);
  log(`Windows system imports: ${[...systemImports].sort().join(', ') || '(none)'}`);
  log(`Host runtime prerequisites: ${[...hostPrerequisites.values()].map((entry) => `${entry.dll} ${entry.observedFileVersion}`).join(', ') || '(none)'}`);
  if (missingImports.size) {
    log(`Unresolved imports or missing host prerequisites: ${[...missingImports].sort().join(', ')}`);
    throw new Error('Required runtime import is unavailable on this host. No installer or system change was attempted.');
  }
}

main().catch((error) => {
  process.stderr.write(`prepare-pcm-codecs: ${error.stack || error}\n`);
  process.exitCode = 1;
});
