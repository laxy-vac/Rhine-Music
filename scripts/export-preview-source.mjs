#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultRelativeOutput = '.tools/preview-release/source/Rhine-Music-0.3.1-preview.1-source.zip';
const outputArea = path.resolve(repoRoot, '.tools', 'preview-release', 'source');
const maxFileBytes = 90_000_000;

const sourceDirectories = [
  'art',
  'content',
  'desktop',
  'docs',
  'native',
  'public',
  'scripts',
  'src',
  'vendor',
  'verification',
  'windows',
];

const rootFileAllowlist = new Set([
  '.gitattributes',
  '.gitignore',
  'agents.md',
  'build-windows-exe.cmd',
  'changelog.md',
  'contributing.md',
  'design.md',
  'license',
  'notice.md',
  'readme.md',
  'readme.original.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'tsconfig.json',
  '启动源码验证.cmd',
  '启动音乐播放器.bat',
  '启动音乐播放器.command',
  '构建源码验证.cmd',
  '打包品尝版.cmd',
  '核验dop离线链路.cmd',
  '核验wasapi稳定性.cmd',
  '核验音频核心.cmd',
]);

const extraFileAllowlist = new Set(['.github/workflows/check.yml']);

// These working-tree-only files were explicitly approved for this preview export.
const approvedUntrackedPaths = new Set([
  '.github/workflows/check.yml',
  'contributing.md',
  'desktop/app-storage.cjs',
  'docs/preview-release.md',
  'docs/readme.md',
  'scripts/check-app-storage.mjs',
  'scripts/export-preview-source.mjs',
  'scripts/package-preview.mjs',
  'scripts/test-preview.mjs',
]);

const machineVerificationFiles = new Set([
  'docs/sony-crelu-verification.json',
  'docs/sony-phase-verification.json',
  'docs/sony-x86-verification.json',
  'docs/windows-enhanced-verification.json',
]);

const archiveReadme = `# Clean source snapshot

This ZIP is a working-tree source snapshot for Rhine Music 0.3.1-preview.1. It has no Git history. Review the files and the repository NOTICE before sharing or publishing it.

To create your own local Git history after extraction:

1. Open a terminal in this extracted directory.
2. Run \`git init\`.
3. Review the included files and licenses, then run \`git add -A\` and \`git commit -m "Initial clean source snapshot"\`.
4. To publish, create your own GitHub repository, add its remote, and push only after reviewing the rights for the included assets. This export never creates a remote or pushes anything.

For local development, read \`README.md\` and \`docs/LOCAL-DEVELOPMENT.md\`. The offline test entry is \`npm test\`; the source preview build is \`npm run build:preview\`. This export script does not install dependencies or contact the network. If a required tool or dependency is missing, stop and use a separately approved offline setup; do not run an automatic install as part of export.

The preview remains incomplete. Read \`docs/PROJECT-STATUS.md\` and \`docs/UNIFIED-ARCHITECTURE.md\` for current progress and acceptance boundaries.\n`;

const powershellZipScript = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = [System.IO.Path]::GetFullPath($env:RHINE_SOURCE_ROOT)
$rootPrefix = $root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$archivePath = [System.IO.Path]::GetFullPath($env:RHINE_SOURCE_ZIP_TMP)
$entries = @(Get-Content -LiteralPath $env:RHINE_SOURCE_ENTRIES -Raw -Encoding UTF8 | ConvertFrom-Json)
$manifestText = Get-Content -LiteralPath $env:RHINE_SOURCE_MANIFEST -Raw -Encoding UTF8
$readmeText = Get-Content -LiteralPath $env:RHINE_SOURCE_README -Raw -Encoding UTF8
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($entry in $entries) {
        $relative = [string]$entry.Path
        $relativeWindows = $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $sourcePath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $relativeWindows))
        if (-not $sourcePath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Entry escapes the source root: $relative"
        }
        if (-not [System.IO.File]::Exists($sourcePath)) {
            throw "Source file disappeared during export: $relative"
        }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip,
            $sourcePath,
            $relative,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }

    foreach ($extra in @(
        @{ Path = 'SOURCE-EXPORT-README.md'; Text = $readmeText },
        @{ Path = 'SOURCE-MANIFEST.txt'; Text = $manifestText }
    )) {
        $archiveEntry = $zip.CreateEntry($extra.Path, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $archiveEntry.Open()
        $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
        try {
            $writer.Write($extra.Text)
        }
        finally {
            $writer.Dispose()
        }
    }
}
finally {
    $zip.Dispose()
}
`;

function fail(message) {
  console.error(`Source export refused: ${message}`);
  process.exitCode = 1;
}

function authorizeUntrackedPath(value, destination) {
  const relative = normalizeRelative(value);
  if (!isIncludedPath(relative)) throw new Error(`--include-untracked path is outside the source allowlist: ${relative}`);
  const absolute = path.join(repoRoot, ...relative.split('/'));
  if (!fs.existsSync(absolute)) throw new Error(`--include-untracked file does not exist: ${relative}`);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`--include-untracked accepts regular files only: ${relative}`);
  destination.set(relative.toLowerCase(), relative);
}

function parseArgs(argv) {
  const options = { out: defaultRelativeOutput, force: false, dryRun: false, help: false, includeUntracked: new Map() };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--help' || value === '-h') {
      options.help = true;
    } else if (value === '--force') {
      options.force = true;
    } else if (value === '--dry-run') {
      options.dryRun = true;
    } else if (value === '--include-untracked') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--include-untracked requires a repository-relative file path.');
      authorizeUntrackedPath(next, options.includeUntracked);
      index += 1;
    } else if (value.startsWith('--include-untracked=')) {
      authorizeUntrackedPath(value.slice('--include-untracked='.length), options.includeUntracked);
    } else if (value === '--out') {
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error('--out requires a ZIP file path.');
      options.out = next;
      index += 1;
    } else if (value.startsWith('--out=')) {
      options.out = value.slice('--out='.length);
      if (!options.out) throw new Error('--out requires a ZIP file path.');
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/export-preview-source.mjs [--out <zip-path>] [--dry-run] [--force]

Create a clean, working-tree source ZIP without .git or generated/local data.
Relative --out paths are resolved from the repository root. The default is:
  ${defaultRelativeOutput}

--dry-run  Validate the allowlist and size limits without writing an archive.
--force    Replace an existing ZIP and its .sha256 sidecar at the requested path.
--include-untracked <path>
           Explicitly authorize one new file under the source allowlist.
`);
}

function gitPaths(args) {
  const output = spawnSync('git', ['-C', repoRoot, ...args], { encoding: 'buffer' });
  if (output.error) throw new Error(`Could not run git: ${output.error.message}`);
  if (output.status !== 0) {
    const detail = output.stderr?.toString('utf8').trim();
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return output.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .map(normalizeRelative);
}

function normalizeRelative(value) {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    throw new Error(`Invalid relative path in Git metadata: ${value}`);
  }
  const parts = normalized.split('/');
  if (parts.some((part) => part === '..' || part === '')) {
    throw new Error(`Unsafe relative path in Git metadata: ${value}`);
  }
  if (/[\r\n\t]/.test(normalized)) {
    throw new Error('Source filenames may not contain tab or newline characters.');
  }
  return parts.join('/');
}

function pathIsWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isExcluded(relative) {
  const normalized = normalizeRelative(relative);
  const lower = normalized.toLowerCase();
  const parts = lower.split('/');
  const base = parts.at(-1);

  if (parts.includes('__pycache__') || /\.(?:pyc|pyo|pyd)$/i.test(base)) return true;
  if (parts.some((part) => ['.git', 'node_modules', 'dist', 'release', '.tools', '.local', 'data', 'presets', 'preset'].includes(part))) return true;
  if (lower === 'memory.md' || base === 'memory.md') return true;
  if (['source-manifest.txt','source-export-readme.md'].includes(lower)) return true;
  if (machineVerificationFiles.has(lower)) return true;
  if (base === '.env' || base.startsWith('.env.') || base.endsWith('.env')) return true;
  if (base.includes('preset') && base.endsWith('.json')) return true;
  if (['preferences.json', 'desktop-preview.json', 'audio-processing-presets.json', 'theme-presets.json'].includes(base)) return true;
  if (/^(?:id_rsa|id_ed25519|credentials?(?:\..*)?|secrets?(?:\..*)?)$/i.test(base)) return true;
  if (/\.(?:pem|p12|pfx|key|keystore)$/i.test(base)) return true;
  if (/\.(?:pdb|ilk|obj)$/i.test(base)) return true;
  if (lower.startsWith('reference/')) return true;
  return false;
}

function isIncludedPath(relative) {
  const normalized = normalizeRelative(relative);
  if (isExcluded(normalized)) return false;
  if (extraFileAllowlist.has(normalized.toLowerCase())) return true;
  const parts = normalized.split('/');
  if (parts.length === 1) return rootFileAllowlist.has(parts[0].toLowerCase());
  return sourceDirectories.includes(parts[0].toLowerCase());
}

function assertNoSymlinkAncestors(targetPath) {
  const absolute = path.resolve(targetPath);
  const parsed = path.parse(absolute);
  const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink in the output path: ${current}`);
  }
}

function findWorkingTreeFile(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const parts = normalized.split('/');
  const actualParts = [];
  let absolutePath = repoRoot;

  for (let index = 0; index < parts.length; index += 1) {
    if (!fs.existsSync(absolutePath) || !fs.lstatSync(absolutePath).isDirectory()) return null;
    const actualName = fs.readdirSync(absolutePath).find((entry) => entry.toLowerCase() === parts[index].toLowerCase());
    if (!actualName) return null;

    actualParts.push(actualName);
    absolutePath = path.join(absolutePath, actualName);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) throw new Error(`Refusing a symlink in source: ${actualParts.join('/')}`);
    if (index < parts.length - 1 && !stat.isDirectory()) return null;
    if (index === parts.length - 1 && !stat.isFile()) {
      throw new Error(`Expected a regular source file: ${actualParts.join('/')}`);
    }
  }

  return { path: actualParts.join('/'), bytes: fs.statSync(absolutePath).size };
}

function collectSourceFiles(includeUntracked) {
  const trackedPaths = gitPaths(['ls-files', '-z']);
  const tracked = new Set(trackedPaths.map((item) => item.toLowerCase()));
  const untrackedPaths = gitPaths(['ls-files', '--others', '--exclude-standard', '-z']);
  const unknownTracked = trackedPaths.filter((item) => !isExcluded(item) && !isIncludedPath(item));
  const approvedUntracked = new Map([
    ...[...approvedUntrackedPaths].map((item) => [item.toLowerCase(), item]),
    ...includeUntracked,
  ]);
  const unknownUntracked = untrackedPaths.filter((item) => !isExcluded(item) && (!isIncludedPath(item) || !approvedUntracked.has(item.toLowerCase())));
  if (unknownTracked.length || unknownUntracked.length) {
    const unknown = [...unknownTracked, ...unknownUntracked];
    throw new Error(`Paths outside the source allowlist were found; review before export:\n${unknown.slice(0, 30).map((item) => `  ${item}`).join('\n')}${unknown.length > 30 ? `\n  ... and ${unknown.length - 30} more` : ''}`);
  }

  const unique = new Map();
  const addFile = (relativePath, required = false) => {
    const file = findWorkingTreeFile(relativePath);
    if (!file) {
      if (required) throw new Error(`Tracked source file is missing from the working tree: ${relativePath}`);
      return;
    }
    const key = file.path.toLowerCase();
    if (unique.has(key)) return;
    if (file.bytes > maxFileBytes) {
      throw new Error(`A source file exceeds the 90 MB limit: ${file.path} (${file.bytes} bytes)`);
    }
    unique.set(key, file);
  };

  for (const relativePath of trackedPaths) {
    if (!isExcluded(relativePath) && isIncludedPath(relativePath)) addFile(relativePath, true);
  }
  for (const relativePath of untrackedPaths) {
    if (!isExcluded(relativePath) && isIncludedPath(relativePath) && approvedUntracked.has(relativePath.toLowerCase())) {
      addFile(relativePath);
    }
  }
  for (const relativePath of approvedUntracked.values()) {
    if (!isExcluded(relativePath) && isIncludedPath(relativePath)) {
      addFile(relativePath, includeUntracked.has(relativePath.toLowerCase()));
    }
  }

  for (const trackedPath of trackedPaths) {
    if (isExcluded(trackedPath) || !isIncludedPath(trackedPath)) continue;
    if (!unique.has(trackedPath.toLowerCase())) {
      throw new Error(`Tracked source file is missing from the working tree: ${trackedPath}`);
    }
  }

  return [...unique.values()].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function makeManifest(files, trackedSet) {
  const sourceBytes = files.reduce((total, item) => total + item.bytes, 0);
  const lines = [
    'Rhine Music 0.3.1-preview.1 clean source snapshot',
    `Generated: ${new Date().toISOString()}`,
    `Source files: ${files.length}`,
    `Source bytes: ${sourceBytes}`,
    'Paths are relative to the ZIP root. The ZIP has no enclosing repository directory.',
    'Status is based on the current Git index; contents come from the current working tree.',
    '',
    'BYTES\tSTATUS\tPATH',
  ];
  for (const item of files) {
    const status = trackedSet.has(item.path.toLowerCase()) ? 'tracked' : 'working-tree-only';
    lines.push(`${item.bytes}\t${status}\t${item.path}`);
  }
  return `${lines.join('\n')}\n`;
}

function makeExportReadme() {
  return archiveReadme;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function writeZip(zipPath, tempDirectory, files, manifestText, readmeText) {
  const entriesPath = path.join(tempDirectory, 'entries.json');
  const manifestPath = path.join(tempDirectory, 'source-manifest.txt');
  const readmePath = path.join(tempDirectory, 'source-export-readme.md');
  fs.writeFileSync(entriesPath, JSON.stringify(files.map((item) => ({ Path: item.path })), null, 2), { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(manifestPath, manifestText, { encoding: 'utf8', flag: 'wx' });
  fs.writeFileSync(readmePath, readmeText, { encoding: 'utf8', flag: 'wx' });

  // Windows PowerShell 5/.NET Framework rejects several vendor paths at 260
  // characters. Prefer an existing PowerShell 7; otherwise use Windows bsdtar.
  const modernPowerShell=path.join(process.env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe');
  if(!fs.existsSync(modernPowerShell)){
    const listPath=path.join(tempDirectory,'tar-entries.txt');
    fs.writeFileSync(listPath,files.map(item=>item.path).join('\n')+'\n','utf8');
    fs.writeFileSync(path.join(tempDirectory,'SOURCE-MANIFEST.txt'),manifestText,'utf8');
    fs.writeFileSync(path.join(tempDirectory,'SOURCE-EXPORT-README.md'),readmeText,'utf8');
    const tar=spawnSync('tar.exe',['-a','-c','-f',zipPath,'-T',listPath,'-C',tempDirectory,'SOURCE-MANIFEST.txt','SOURCE-EXPORT-README.md'],{cwd:repoRoot,encoding:'utf8',maxBuffer:8*1024*1024});
    if(tar.error||tar.status!==0)throw new Error(`Windows built-in ZIP export failed: ${tar.error?.message||tar.stderr}`);
    return;
  }
  const result = spawnSync(modernPowerShell, ['-NoProfile', '-NonInteractive', '-Command', powershellZipScript], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: {
      ...process.env,
      RHINE_SOURCE_ROOT: repoRoot,
      RHINE_SOURCE_ZIP_TMP: zipPath,
      RHINE_SOURCE_ENTRIES: entriesPath,
      RHINE_SOURCE_MANIFEST: manifestPath,
      RHINE_SOURCE_README: readmePath,
    },
  });
  if (result.error) throw new Error(`Could not run built-in Windows PowerShell: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}${result.stdout || ''}`.trim();
    throw new Error(`Windows .NET ZIP creation failed${detail ? `:\n${detail}` : ''}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (process.platform !== 'win32') throw new Error('This exporter uses the built-in Windows PowerShell/.NET ZIP implementation.');

  const outputPath = path.resolve(repoRoot, options.out);
  const outputRelative = path.relative(repoRoot, outputPath);
  const outputIsInRepo = outputRelative === '' || (!outputRelative.startsWith(`..${path.sep}`) && outputRelative !== '..' && !path.isAbsolute(outputRelative));
  if (outputIsInRepo && !pathIsWithin(outputArea, outputPath)) {
    throw new Error('--out must be outside the repository source tree, except for the dedicated .tools/preview-release/source output directory.');
  }
  if (path.extname(outputPath).toLowerCase() !== '.zip') throw new Error('--out must name a .zip file.');
  assertNoSymlinkAncestors(path.dirname(outputPath));
  if (fs.existsSync(outputPath) && fs.lstatSync(outputPath).isSymbolicLink()) throw new Error('Refusing to replace a symbolic link.');

  const sidecarPath = `${outputPath}.sha256`;
  for (const target of [outputPath, sidecarPath]) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Output target is not a regular file: ${target}`);
    if (!options.force) throw new Error(`Output already exists; pass --force to replace this generated artifact: ${target}`);
  }

  const files = collectSourceFiles(options.includeUntracked);
  const trackedPaths = gitPaths(['ls-files', '-z']);
  const trackedSet = new Set(trackedPaths.map((item) => item.toLowerCase()));
  const manifestText = makeManifest(files, trackedSet);
  const totalBytes = files.reduce((total, item) => total + item.bytes, 0);

  if (options.dryRun) {
    console.log(`Dry run passed: ${files.length} source files, ${totalBytes} bytes, no file exceeds 90 MB.`);
    console.log(`ZIP target: ${outputPath}`);
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const tempDirectory = path.join(path.dirname(outputPath), `.source-export-${process.pid}-${randomUUID()}`);
  fs.mkdirSync(tempDirectory, { recursive: false });
  const tempZip = path.join(tempDirectory, 'archive.zip');
  const tempSidecar = path.join(tempDirectory, `${path.basename(outputPath)}.sha256`);
  try {
    writeZip(tempZip, tempDirectory, files, manifestText, makeExportReadme());
    const zipHash = await hashFile(tempZip);
    fs.writeFileSync(tempSidecar, `${zipHash}  ${path.basename(outputPath)}\n`, { encoding: 'utf8', flag: 'wx' });
    if (options.force) {
      for (const target of [outputPath, sidecarPath]) {
        if (fs.existsSync(target)) fs.rmSync(target);
      }
    }
    fs.renameSync(tempZip, outputPath);
    fs.renameSync(tempSidecar, sidecarPath);
    console.log(`Source ZIP created: ${outputPath}`);
    console.log(`Files: ${files.length}; source bytes: ${totalBytes}`);
    console.log(`SHA-256: ${zipHash}`);
    console.log('The archive contains SOURCE-MANIFEST.txt and SOURCE-EXPORT-README.md.');
  } finally {
    if (fs.existsSync(tempDirectory)) fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
