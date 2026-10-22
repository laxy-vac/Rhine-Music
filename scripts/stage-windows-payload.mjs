import { createHash, randomUUID } from 'node:crypto';
import { createReadStream as nodeCreateReadStream, promises as nodeFs } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { interfaceSourceManifest } from './interface-source-manifest.mjs';

const require = createRequire(import.meta.url);
const originalFs = process.versions.electron ? require('original-fs') : null;
const fs = originalFs?.promises ?? nodeFs;
const createReadStream = originalFs?.createReadStream ?? nodeCreateReadStream;
const projectFromScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRootName = path.join('.tools', 'releases');
const executableName = 'Rhine Music.exe';
const appRelative = path.join('resources', 'app');
const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.replace(/^node:/, '')),
]);
const embeddedRuntimePackages = new Set(['electron']);
const moduleExtensions = ['', '.mjs', '.js', '.cjs', '.json', '.ts', '.tsx', '.jsx'];
const sourcePreviewMachineFiles = new Set([
  'source-preview-runtime.manifest.json',
  'source-preview.json',
  '.source-preview-marker.json',
  '.archive-sha256',
  'debug.log',
]);

const semanticVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function fail(message) {
  throw new Error(message);
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function isWithin(root, target, allowEqual = true) {
  const relative = path.relative(root, target);
  if (relative === '') return allowEqual;
  return relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative);
}

function assertWithin(root, target, label, allowEqual = true) {
  if (!isWithin(root, target, allowEqual)) {
    fail(label + ' must remain inside ' + root + ': ' + target);
  }
}

async function assertRealDirectory(file, label) {
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') fail(label + ' is missing: ' + file);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    fail(label + ' must be a real directory: ' + file);
  }
  return file;
}

async function assertRegularFile(file, label) {
  let info;
  try {
    info = await fs.lstat(file);
  } catch (error) {
    if (error.code === 'ENOENT') fail(label + ' is missing: ' + file);
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    fail(label + ' must be a regular file: ' + file);
  }
  return info;
}

async function readJson(file, label) {
  await assertRegularFile(file, label);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    fail(label + ' is invalid JSON: ' + error.message);
  }
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function hashBuffer(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function hashNamedFiles(projectRoot, relativeFiles, label) {
  const hash = createHash('sha256');
  for (const relative of relativeFiles) {
    if (typeof relative !== 'string' ||
        !relative.startsWith('native/sony/') ||
        relative.includes('\\') ||
        relative.split('/').some((part) => !part || part === '.' || part === '..')) {
      fail(label + ' contains an unsafe source path: ' + String(relative));
    }
    const file = path.resolve(projectRoot, ...relative.split('/'));
    assertWithin(projectRoot, file, label + ' source file');
    await assertRegularFile(file, label + ' source file');
    hash.update(relative + '\0');
    hash.update(await fs.readFile(file));
  }
  return hash.digest('hex');
}

function normalizeSourceMap(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(label + ' must be an object of relative paths and SHA-256 values.');
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    const digest = value[key];
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/i.test(digest)) {
      fail(label + ' has an invalid SHA-256 for ' + key);
    }
    result[key] = digest.toLowerCase();
  }
  return result;
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stripComments(source) {
  let result = '';
  let state = 'code';
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (current === '\n' || current === '\r') {
        result += current;
        state = 'code';
      } else {
        result += ' ';
      }
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') {
        result += '  ';
        index += 1;
        state = 'code';
      } else {
        result += current === '\n' || current === '\r' ? current : ' ';
      }
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      result += current;
      if (current === '\\') {
        if (index + 1 < source.length) {
          result += source[index + 1];
          index += 1;
        }
      } else if ((state === 'single' && current === "'") ||
                 (state === 'double' && current === '"') ||
                 (state === 'template' && current.charCodeAt(0) === 96)) {
        state = 'code';
      }
      continue;
    }
    if (current === '/' && next === '/') {
      result += '  ';
      index += 1;
      state = 'line-comment';
      continue;
    }
    if (current === '/' && next === '*') {
      result += '  ';
      index += 1;
      state = 'block-comment';
      continue;
    }
    if (current === "'") state = 'single';
    else if (current === '"') state = 'double';
    else if (current.charCodeAt(0) === 96) state = 'template';
    result += current;
  }
  return result;
}

function moduleSpecifiers(source, label, allowComputedDynamic = false) {
  const code = stripComments(source);
  const result = new Set();
  const staticImport = /(?:^|\n)\s*import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  const exportFrom = /(?:^|\n)\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm;
  const dynamicImport = /(?<![\w$.])import\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  const unresolvedDynamicImport = /(?<![\w$.])import\s*\(\s*(?!['"])/g;
  for (const match of code.matchAll(staticImport)) result.add(match[1]);
  for (const match of code.matchAll(exportFrom)) result.add(match[1]);
  for (const match of code.matchAll(dynamicImport)) result.add(match[2]);
  if (!allowComputedDynamic) {
    for (const unresolved of code.matchAll(unresolvedDynamicImport)) {
      const lineStart = code.lastIndexOf('\n', unresolved.index) + 1;
      const linePrefix = code.slice(lineStart, unresolved.index);
      if (/\basync\s*$/.test(linePrefix)) continue;
      fail('Cannot statically resolve a dynamic import in ' + label +
        ' near character ' + unresolved.index);
    }
  }
  const requireCall = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of code.matchAll(requireCall)) result.add(match[2]);
  return [...result];
}

function packageNameFromSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) fail('Invalid scoped package import: ' + specifier);
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

function normalizeLockPackagePath(key) {
  if (typeof key !== 'string' || !key.startsWith('node_modules/')) {
    fail('Unsupported lockfile package path: ' + String(key));
  }
  const parts = key.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))) {
    fail('Unsafe lockfile package path: ' + key);
  }
  return key;
}

function platformAllows(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const negatives = list.filter((item) => typeof item === 'string' && item.startsWith('!'));
  if (negatives.includes('!' + value)) return false;
  const positives = list.filter((item) => typeof item === 'string' && !item.startsWith('!'));
  return positives.length === 0 || positives.includes(value);
}

export function productionPackageEntries(lockfile, platform = process.platform, arch = process.arch) {
  if (!lockfile || lockfile.lockfileVersion < 2 ||
      !lockfile.packages || typeof lockfile.packages !== 'object') {
    fail('package-lock.json must contain a v2 or v3 packages map.');
  }
  const result = [];
  for (const [key, record] of Object.entries(lockfile.packages)) {
    if (!key) continue;
    normalizeLockPackagePath(key);
    if (!record || typeof record !== 'object') fail('Invalid lockfile package entry: ' + key);
    if (record.dev === true || record.devOptional === true) continue;
    if (!platformAllows(record.os, platform) || !platformAllows(record.cpu, arch)) continue;
    result.push({ path: key, record });
  }
  result.sort((left, right) => {
    const depth = left.path.split('/').length - right.path.split('/').length;
    return depth || left.path.localeCompare(right.path);
  });
  return result;
}

function packageRootPath(packagePath) {
  const parts = packagePath.split('/');
  const marker = parts.lastIndexOf('node_modules');
  if (marker < 0 || marker + 1 >= parts.length) fail('Invalid package path: ' + packagePath);
  if (parts[marker + 1].startsWith('@')) {
    if (marker + 2 >= parts.length) fail('Invalid scoped package path: ' + packagePath);
    return parts.slice(0, marker + 3).join('/');
  }
  return parts.slice(0, marker + 2).join('/');
}

function allowedNodeModulesPath(relativePath, allowedPackagePaths) {
  const parts = relativePath.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] !== 'node_modules') continue;
    if (index + 1 >= parts.length) return false;
    let end = index + 1;
    if (parts[end].startsWith('@')) end += 1;
    if (end >= parts.length) return false;
    const packagePath = parts.slice(0, end + 1).join('/');
    if (!allowedPackagePaths.has(packagePath)) return false;
    index = end;
  }
  return true;
}

async function resolveLocalSpecifier(projectRoot, importer, specifier) {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
  if (specifier.includes('?') || specifier.includes('#')) {
    fail('Relative imports with query or fragment suffixes are unsupported: ' +
      importer + ' -> ' + specifier);
  }
  const base = path.resolve(projectRoot, path.dirname(importer), specifier);
  assertWithin(projectRoot, base, 'Relative import');
  const candidates = path.extname(base)
    ? [base]
    : moduleExtensions.map((extension) => base + extension);
  for (const candidate of candidates) {
    try {
      await assertRegularFile(candidate, 'Relative import');
      return toPosix(path.relative(projectRoot, candidate));
    } catch (error) {
      if (!String(error.message).includes('is missing:')) throw error;
    }
  }
  fail('Unresolved relative import: ' + importer + ' -> ' + specifier);
}

export async function collectLocalModuleGraph(projectRoot, entryFiles, options = {}) {
  const project = path.resolve(projectRoot);
  const files = new Set();
  const packages = new Set();
  const allowComputedDynamicFiles = new Set(options.allowComputedDynamicFiles ?? []);
  const queue = [...entryFiles];
  while (queue.length) {
    const relative = queue.shift().replaceAll('\\', '/');
    if (files.has(relative)) continue;
    const absolute = path.resolve(project, ...relative.split('/'));
    assertWithin(project, absolute, 'Module graph entry');
    await assertRegularFile(absolute, 'Module graph file');
    files.add(relative);
    const extension = path.extname(relative).toLowerCase();
    if (!['.mjs', '.js', '.cjs', '.ts', '.tsx', '.jsx'].includes(extension)) continue;
    const source = await fs.readFile(absolute, 'utf8');
    for (const specifier of moduleSpecifiers(
      source,
      relative,
      allowComputedDynamicFiles.has(relative),
    )) {
      if (specifier.startsWith('node:') || builtins.has(specifier)) continue;
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const resolved = await resolveLocalSpecifier(project, relative, specifier);
        if (resolved) queue.push(resolved);
        continue;
      }
      if (specifier.startsWith('#')) {
        fail('Package import maps are unsupported in the runtime graph: ' + relative +
          ' -> ' + specifier);
      }
      packages.add(packageNameFromSpecifier(specifier));
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort() };
}

async function verifyElectronRuntime(projectRoot, runtimeAssets) {
  const root = path.join(projectRoot, '.tools', 'source-preview-electron');
  await assertRealDirectory(root, 'Prepared Electron runtime');
  const runtimeManifest = await readJson(
    path.join(root, 'source-preview-runtime.manifest.json'),
    'Electron source-preview manifest',
  );
  if (runtimeManifest.schemaVersion !== 1 ||
      runtimeManifest.sourceLocation !== 'release/.desktop-staging' ||
      runtimeManifest.targetLocation !== '.tools/source-preview-electron') {
    fail('Prepared Electron runtime manifest has an unexpected source or target.');
  }
  const executable = path.join(root, 'electron.exe');
  const defaultApp = path.join(root, 'resources', 'default_app.asar');
  await assertRegularFile(executable, 'Electron executable');
  await assertRegularFile(defaultApp, 'Electron default app');
  const executableHash = await sha256(executable);
  const defaultAppHash = await sha256(defaultApp);
  if (executableHash !== runtimeManifest.targetElectronSha256 ||
      defaultAppHash !== runtimeManifest.targetDefaultAppSha256) {
    fail('Prepared Electron runtime differs from its source-preview manifest.');
  }
  const electronVersion = (await fs.readFile(path.join(root, 'version'), 'utf8')).trim();
  if (electronVersion !== runtimeAssets.electron?.version) {
    fail('Prepared Electron version does not match desktop/runtime-assets.json.');
  }
  for (const relative of [
    path.join('resources', 'app'),
    path.join('resources', 'app.asar'),
    path.join('resources', 'app.asar.unpacked'),
  ]) {
    try {
      await fs.lstat(path.join(root, relative));
      fail('Electron-only runtime contains a stale application payload: ' + relative);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return { root, manifest: runtimeManifest, version: electronVersion };
}

async function verifyInterfaceBuild(projectRoot) {
  const marker = await readJson(
    path.join(projectRoot, '.tools', 'source-preview-interface.manifest.json'),
    'Source-preview interface manifest',
  );
  if (marker.kind !== 'rhine-source-preview-interface' ||
      marker.state !== 'ready' ||
      marker.output !== '.tools/source-preview-interface') {
    fail('Source-preview interface is not marked ready for this project.');
  }
  const currentSources = await interfaceSourceManifest(projectRoot);
  const builtSources = normalizeSourceMap(marker.sourceFiles, 'Interface source manifest');
  const currentMap = normalizeSourceMap(currentSources, 'Current interface sources');
  if (!equalJson(currentMap, builtSources)) {
    fail('Source-preview interface source hashes do not match the current source tree.');
  }
  const output = path.join(projectRoot, '.tools', 'source-preview-interface');
  await assertRealDirectory(output, 'Source-preview interface output');
  await assertRegularFile(path.join(output, 'index.html'), 'Source-preview interface index');
  return { marker, output, sourceFiles: builtSources };
}

async function verifyNativeRuntime(projectRoot) {
  const root = path.join(projectRoot, '.tools', 'source-preview-native-audio');
  await assertRealDirectory(root, 'Prepared source-preview native runtime');
  const manifest = await readJson(path.join(root, 'assets.json'), 'Native runtime manifest');
  if (manifest.kind !== 'rhine-source-preview-native-audio' ||
      manifest.state !== 'ready' ||
      manifest.architecture !== 'windows-x64' ||
      !manifest.files || typeof manifest.files !== 'object') {
    fail('Prepared native runtime manifest is not ready for Windows x64.');
  }
  const currentNativeHash = await sha256(path.join(projectRoot, 'native', 'audio-host.cpp'));
  if (manifest.sourceSha256 !== currentNativeHash ||
      manifest.sourceFiles?.['native/audio-host.cpp'] !== currentNativeHash) {
    fail('Prepared native host does not match native/audio-host.cpp.');
  }
  for (const required of [
    'rhine-audio-host.exe',
    'rhine-lsp-eq.dll',
    'lsp-para-equalizer.clap',
    'lsp-r3d-wgl-lib.dll',
  ]) {
    if (!Object.hasOwn(manifest.files, required)) {
      fail('Prepared native runtime omits a required LSP/native file: ' + required);
    }
  }
  for (const [name, expected] of Object.entries(manifest.files)) {
    if (!/^[a-z0-9.-]+$/i.test(name) ||
        typeof expected !== 'string' ||
        !/^[a-f0-9]{64}$/i.test(expected)) {
      fail('Native runtime manifest contains an invalid file entry: ' + name);
    }
    const file = path.join(root, name);
    await assertRegularFile(file, 'Native runtime file');
    if (await sha256(file) !== expected.toLowerCase()) {
      fail('Native runtime SHA-256 mismatch: ' + name);
    }
  }
  return { root, manifest };
}

async function verifySonyRuntime(projectRoot) {
  const sonyRoot = path.join(projectRoot, 'vendor', 'sony-walkman');
  await assertRealDirectory(sonyRoot, 'Sony runtime assets');
  const sonyManifest = await readJson(
    path.join(projectRoot, 'scripts', 'sony-walkman', 'assets.json'),
    'Sony runtime manifest',
  );
  const sonyEntries = sonyManifest.files ?? sonyManifest;
  for (const [relative, item] of Object.entries(sonyEntries)) {
    const expected = typeof item === 'string' ? item : item?.sha256;
    if (!expected) continue;
    if (relative.includes('\\') || relative.split('/').some((part) =>
      !part || part === '.' || part === '..')) {
      fail('Sony runtime manifest contains an unsafe path: ' + relative);
    }
    const file = path.resolve(sonyRoot, ...relative.split('/'));
    assertWithin(sonyRoot, file, 'Sony runtime asset');
    await assertRegularFile(file, 'Sony runtime asset');
    if (await sha256(file) !== expected.toLowerCase()) {
      fail('Sony runtime SHA-256 mismatch: ' + relative);
    }
  }

  const x86Root = path.join(projectRoot, 'vendor', 'sony-walkman-x86');
  const x86Manifest = await readJson(path.join(x86Root, 'assets.json'), 'Sony x86 manifest');
  if (x86Manifest.architecture !== 'x86_64-windows') {
    fail('Sony x86 runtime has an unexpected architecture.');
  }
  if (await sha256(path.join(projectRoot, 'native', 'sony', 'instructions.json')) !==
      x86Manifest.instructionGraphSha256) {
    fail('Sony instruction graph differs from the x86 runtime manifest.');
  }
  const sourceHash = await hashNamedFiles(projectRoot, x86Manifest.sourceFiles, 'Sony x86 manifest');
  if (sourceHash !== x86Manifest.sourceSha256) {
    fail('Sony x86 C++ sources differ from the runtime manifest.');
  }
  for (const [name, expected] of Object.entries(x86Manifest.files ?? {})) {
    if (!/^[a-z0-9.-]+$/i.test(name) || !/^[a-f0-9]{64}$/i.test(expected)) {
      fail('Sony x86 manifest contains an invalid runtime file: ' + name);
    }
    const file = path.join(x86Root, name);
    await assertRegularFile(file, 'Sony x86 runtime file');
    if (await sha256(file) !== expected.toLowerCase()) {
      fail('Sony x86 runtime SHA-256 mismatch: ' + name);
    }
  }
  return { sonyRoot, sonyManifest, x86Root, x86Manifest };
}

async function verifyProductionPackages(projectRoot, packageJson, lockfile, graph) {
  const entries = productionPackageEntries(lockfile);
  const allowedPaths = new Set(entries.map((entry) => entry.path));
  const warnings = [];
  const availableEntries = [];
  const requiredRoots = new Set(Object.keys(packageJson.dependencies ?? {}));
  for (const imported of graph.packages) {
    if (builtins.has(imported) || embeddedRuntimePackages.has(imported)) continue;
    requiredRoots.add(imported);
  }
  for (const name of requiredRoots) {
    if (!allowedPaths.has('node_modules/' + name)) {
      fail('Required runtime dependency is absent from the production lock closure: ' + name);
    }
  }

  for (const entry of entries) {
    const root = path.join(projectRoot, ...entry.path.split('/'));
    try {
      await assertRealDirectory(root, 'Production dependency ' + entry.path);
    } catch (error) {
      if (entry.record.optional === true) {
        warnings.push('Optional production dependency is missing: ' + entry.path);
        continue;
      }
      throw error;
    }
    const packageFile = path.join(root, 'package.json');
    await assertRegularFile(packageFile, 'Production dependency package.json');
    const installed = await readJson(packageFile, 'Production dependency package.json');
    if (entry.record.version && installed.version !== entry.record.version) {
      fail('Installed production dependency version differs from package-lock.json: ' + entry.path);
    }
    availableEntries.push(entry);
  }
  const availablePaths = new Set(availableEntries.map((entry) => entry.path));
  for (const name of requiredRoots) {
    if (!availablePaths.has('node_modules/' + name)) {
      fail('Required runtime dependency is missing from node_modules: ' + name);
    }
  }
  return { entries: availableEntries, allowedPaths: availablePaths, warnings };
}

async function verifyPythonRuntime(projectRoot, runtimeAssets) {
  const appRoot = path.join(projectRoot, 'release', '.desktop-staging', 'resources', 'app');
  const pythonRoot = path.join(appRoot, 'runtime', 'python');
  const sitePackages = path.join(pythonRoot, 'Lib', 'site-packages');
  const unicornName = 'unicorn-' + runtimeAssets.unicorn?.version + '.dist-info';
  await assertRealDirectory(pythonRoot, 'Existing Python runtime');
  await assertRealDirectory(path.join(sitePackages, 'unicorn'), 'Existing Unicorn package');
  await assertRealDirectory(path.join(sitePackages, unicornName), 'Existing Unicorn metadata');
  for (const name of ['python.exe', 'python314.dll', 'python314.zip', 'python314._pth']) {
    await assertRegularFile(path.join(pythonRoot, name), 'Existing Python runtime file');
  }
  const pth = await fs.readFile(path.join(pythonRoot, 'python314._pth'), 'utf8');
  if (!pth.includes('Lib/site-packages') ||
      !pth.includes('../../scripts/sony-walkman') ||
      !pth.includes('import site')) {
    fail('Existing Python runtime path file does not include the packaged Sony/runtime paths.');
  }
  if (!/^3\.14\./.test(runtimeAssets.python?.version ?? '')) {
    fail('Pinned Python runtime version is not compatible with python314.dll.');
  }
  return {
    pythonRoot,
    sitePackages,
    unicornName,
    versions: {
      python: runtimeAssets.python.version,
      unicorn: runtimeAssets.unicorn.version,
    },
  };
}

export async function inspectWindowsPayloadInputs({ projectRoot = projectFromScript, version } = {}) {
  const project = path.resolve(projectRoot);
  await assertRealDirectory(project, 'Project root');
  const packageJson = await readJson(path.join(project, 'package.json'), 'Project package.json');
  const lockfile = await readJson(path.join(project, 'package-lock.json'), 'Project package-lock.json');
  const resolvedVersion = String(version ?? packageJson.version ?? '');
  const semanticVersion = semanticVersionPattern.exec(resolvedVersion);
  if (!semanticVersion) fail('A valid semantic version is required for the Windows release payload.');
  if (semanticVersion.slice(1, 4).some(part => Number(part) > 65535)) {
    fail('The Windows version resource requires major, minor, and patch values no greater than 65535.');
  }
  if (lockfile.packages?.['']?.version &&
      lockfile.packages[''].version !== packageJson.version) {
    fail('package-lock.json root version does not match package.json.');
  }
  const runtimeAssets = await readJson(
    path.join(project, 'desktop', 'runtime-assets.json'),
    'Desktop runtime asset manifest',
  );
  const electron = await verifyElectronRuntime(project, runtimeAssets);
  const interfaceBuild = await verifyInterfaceBuild(project);
  const native = await verifyNativeRuntime(project);

  const graphRoots = [
    'scripts/music-server.mjs',
    'scripts/metadata-tag-worker.mjs',
    'desktop/main.cjs',
    'desktop/preload.cjs',
    'desktop/window-aspect.mjs',
    'desktop/window-controls.cjs',
    'desktop/gpu-controller.cjs',
    'desktop/gpu-selection.cjs',
    'src/known-issues.mjs',
    'src/window-aspect-model.mjs',
    'src/entry-preferences.mjs',
  ];
  const appStorage = path.join(project, 'desktop', 'app-storage.cjs');
  try {
    await assertRegularFile(appStorage, 'Optional desktop app-storage module');
    graphRoots.push('desktop/app-storage.cjs');
  } catch (error) {
    if (!String(error.message).includes('is missing:')) throw error;
  }
  const graph = await collectLocalModuleGraph(project, graphRoots, {
    allowComputedDynamicFiles: ['desktop/main.cjs'],
  });
  const production = await verifyProductionPackages(project, packageJson, lockfile, graph);
  const sony = await verifySonyRuntime(project);
  const python = await verifyPythonRuntime(project, runtimeAssets);
  const requiredFiles = [
    'desktop/gpu-adapters.ps1',
    'LICENSE',
    'NOTICE.md',
    'README.md',
    'docs/DEVELOPMENT.md',
    'public/licenses/taglib-wasm-license.txt',
    'public/licenses/taglib-lgpl-2.1.txt',
    'public/licenses/msgpack.txt',
    'windows/app.ico',
    'vendor/audio/lsp-plugin/COPYING',
    'vendor/audio/lsp-plugin/COPYING.LESSER',
    'vendor/audio/lsp-plugin/LICENSES.md',
    'vendor/audio/lsp-plugin/clap/include/clap/LICENSE',
    'vendor/audio/lsp/lsp-common-lib/COPYING',
    'vendor/audio/lsp/lsp-common-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-dsp-lib/COPYING',
    'vendor/audio/lsp/lsp-dsp-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-dsp-units/COPYING',
    'vendor/audio/lsp/lsp-dsp-units/COPYING.LESSER',
    'vendor/audio/lsp/lsp-lltl-lib/COPYING',
    'vendor/audio/lsp/lsp-lltl-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-runtime-lib/COPYING',
    'vendor/audio/lsp/lsp-runtime-lib/COPYING.LESSER',
    'vendor/audio/codec-sdk/licenses/libFLAC-COPYING.Xiph',
    'vendor/audio/codec-sdk/licenses/FFmpeg-LICENSE.txt',
    'vendor/audio/soxr/source/soxr-0.1.3-Source/COPYING.LGPL',
  ];
  for (const relative of requiredFiles) {
    const file = path.join(project, ...relative.split('/'));
    await assertRegularFile(file, 'Required release document/license');
  }
  for (const relative of [
    'vendor/audio/windows-x64/licenses',
    'vendor/licenses/unicorn',
  ]) {
    await assertRealDirectory(path.join(project, ...relative.split('/')),
      'Required release license directory');
  }
  return {
    projectRoot: project,
    version: resolvedVersion,
    packageJson,
    lockfile,
    runtimeAssets,
    electron,
    interfaceBuild,
    native,
    sony,
    python,
    graph,
    production,
    warnings: production.warnings,
  };
}

async function copyPlainFile(source, destination, label) {
  await assertRegularFile(source, label);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    const current = await fs.lstat(destination);
    if (current.isSymbolicLink() || !current.isFile()) {
      fail('Payload destination already contains an unexpected item: ' + destination);
    }
    const [sourceHash, currentHash] = await Promise.all([sha256(source), sha256(destination)]);
    if (sourceHash !== currentHash) {
      fail('Payload copy would overwrite different content: ' + destination);
    }
    return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.copyFile(source, destination);
}

async function copyDirectory(sourceRoot, destinationRoot, options = {}) {
  await assertRealDirectory(sourceRoot, options.label ?? 'Source directory');
  await fs.mkdir(destinationRoot, { recursive: true });
  async function copyContents(source, destination, relativeParent) {
    const entries = await fs.readdir(source, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeParent ? relativeParent + '/' + entry.name : entry.name;
      if (options.exclude?.(relative, entry)) continue;
      const sourcePath = path.join(source, entry.name);
      const destinationPath = path.join(destination, entry.name);
      const info = await fs.lstat(sourcePath);
      if (info.isSymbolicLink()) fail('Refusing a linked payload source: ' + sourcePath);
      if (info.isDirectory()) {
        if (options.include && !options.include(relative, true)) continue;
        await fs.mkdir(destinationPath, { recursive: true });
        await copyContents(sourcePath, destinationPath, relative);
      } else if (info.isFile()) {
        if (options.include && !options.include(relative, false)) continue;
        await copyPlainFile(sourcePath, destinationPath, options.label ?? 'Payload source file');
      } else {
        fail('Unsupported payload source entry: ' + sourcePath);
      }
    }
  }
  await copyContents(sourceRoot, destinationRoot, '');
}

async function copyProjectFile(projectRoot, stageRoot, relative, destinationRelative = relative) {
  const source = path.resolve(projectRoot, ...relative.split('/'));
  assertWithin(projectRoot, source, 'Project file');
  const destination = path.resolve(stageRoot, ...destinationRelative.split('/'));
  assertWithin(stageRoot, destination, 'Payload destination');
  await copyPlainFile(source, destination, 'Project file ' + relative);
}

async function copyProductionDependencies(projectRoot, appDir, entries, allowedPaths) {
  const sourceRoot = path.join(projectRoot, 'node_modules');
  await assertRealDirectory(sourceRoot, 'Project node_modules');
  const copiedRoots = new Set();
  for (const entry of entries) {
    const packageRoot = packageRootPath(entry.path);
    if ([...copiedRoots].some((ancestor) => packageRoot.startsWith(ancestor + '/'))) continue;
    const source = path.join(projectRoot, ...entry.path.split('/'));
    const target = path.join(appDir, ...entry.path.split('/'));
    await copyDirectory(source, target, {
      label: 'Production package ' + entry.path,
      include(relative) {
        return allowedNodeModulesPath(
          entry.path + (relative ? '/' + relative : ''),
          allowedPaths,
        );
      },
    });
    copiedRoots.add(packageRoot);
  }
}

async function copySonyX86Runtime(projectRoot, appDir, manifest) {
  const sourceRoot = path.join(projectRoot, 'vendor', 'sony-walkman-x86');
  const destinationRoot = path.join(appDir, 'vendor', 'sony-walkman-x86');
  await fs.mkdir(destinationRoot, { recursive: true });
  await copyPlainFile(path.join(sourceRoot, 'assets.json'), path.join(destinationRoot, 'assets.json'),
    'Sony x86 asset manifest');
  for (const name of Object.keys(manifest.files ?? {}).sort()) {
    await copyPlainFile(path.join(sourceRoot, name), path.join(destinationRoot, name),
      'Sony x86 runtime ' + name);
  }
}

async function copyNativeRuntime(native, appDir) {
  const destinationRoot = path.join(appDir, 'vendor', 'audio', 'windows-x64');
  await fs.mkdir(destinationRoot, { recursive: true });
  for (const name of Object.keys(native.manifest.files).sort()) {
    await copyPlainFile(path.join(native.root, name), path.join(destinationRoot, name),
      'Native runtime ' + name);
  }
  await copyPlainFile(
    path.join(native.root, 'assets.json'),
    path.join(destinationRoot, 'assets.json'),
    'Native runtime manifest',
  );
}

async function copyLicenseFiles(projectRoot, appDir) {
  await copyDirectory(
    path.join(projectRoot, 'vendor', 'audio', 'windows-x64', 'licenses'),
    path.join(appDir, 'vendor', 'audio', 'windows-x64', 'licenses'),
    { label: 'Native audio license files' },
  );
  for (const name of ['COPYING', 'COPYING_GLIB', 'COPYING.LGPL2']) {
    await copyProjectFile(
      projectRoot,
      appDir,
      'vendor/licenses/unicorn/' + name,
      'vendor/licenses/unicorn/' + name,
    );
  }
  const licenseFiles = [
    'vendor/audio/lsp-plugin/COPYING',
    'vendor/audio/lsp-plugin/COPYING.LESSER',
    'vendor/audio/lsp-plugin/LICENSES.md',
    'vendor/audio/lsp-plugin/clap/include/clap/LICENSE',
    'vendor/audio/lsp/lsp-common-lib/COPYING',
    'vendor/audio/lsp/lsp-common-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-dsp-lib/COPYING',
    'vendor/audio/lsp/lsp-dsp-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-dsp-units/COPYING',
    'vendor/audio/lsp/lsp-dsp-units/COPYING.LESSER',
    'vendor/audio/lsp/lsp-lltl-lib/COPYING',
    'vendor/audio/lsp/lsp-lltl-lib/COPYING.LESSER',
    'vendor/audio/lsp/lsp-runtime-lib/COPYING',
    'vendor/audio/lsp/lsp-runtime-lib/COPYING.LESSER',
    'vendor/audio/codec-sdk/licenses/libFLAC-COPYING.Xiph',
    'vendor/audio/codec-sdk/licenses/FFmpeg-LICENSE.txt',
    'vendor/audio/soxr/source/soxr-0.1.3-Source/COPYING.LGPL',
  ];
  for (const relative of licenseFiles) {
    await copyProjectFile(
      projectRoot,
      appDir,
      relative,
      'vendor/licenses/' + relative.replace(/^vendor\/audio\//, ''),
    );
  }
}

async function copyRuntimeAndSources(projectRoot, stageRoot, inputs) {
  await copyDirectory(inputs.electron.root, stageRoot, {
    label: 'Electron runtime',
    exclude(relative) {
      const leaf = path.basename(relative);
      if (sourcePreviewMachineFiles.has(leaf)) return true;
      if (relative === 'resources/app' ||
          relative.startsWith('resources/app/') ||
          relative === 'resources/app.asar' ||
          relative.startsWith('resources/app.asar/') ||
          relative === 'resources/app.asar.unpacked' ||
          relative.startsWith('resources/app.asar.unpacked/')) return true;
      return false;
    },
  });
  const electronExe = path.join(stageRoot, 'electron.exe');
  await assertRegularFile(electronExe, 'Copied Electron executable');
  await fs.rename(electronExe, path.join(stageRoot, executableName));

  const appDir = path.join(stageRoot, appRelative);
  await fs.mkdir(appDir, { recursive: true });
  await copyDirectory(path.join(projectRoot, 'desktop'), path.join(appDir, 'desktop'), {
    label: 'Desktop source',
    exclude(relative) {
      return relative.split('/').some((part) => part === '__pycache__') ||
        relative.endsWith('.pyc') ||
        relative.endsWith('.pdb');
    },
  });
  await copyProjectFile(projectRoot, appDir, 'windows/app.ico', 'desktop/app.ico');
  for (const relative of inputs.graph.files) await copyProjectFile(projectRoot, appDir, relative);
  await copyDirectory(
    path.join(projectRoot, 'scripts', 'sony-walkman'),
    path.join(appDir, 'scripts', 'sony-walkman'),
    {
      label: 'Sony runner scripts',
      exclude(relative) {
        return relative.split('/').some((part) => part === '__pycache__') ||
          relative.endsWith('.pyc');
      },
    },
  );
  await copyDirectory(inputs.interfaceBuild.output, path.join(appDir, 'dist'), {
    label: 'Current source-preview interface',
  });

  const appPackage = {
    name: 'rhine-music',
    version: inputs.version,
    private: true,
    type: 'module',
    main: 'desktop/main.cjs',
    dependencies: inputs.packageJson.dependencies ?? {},
  };
  await fs.writeFile(path.join(appDir, 'package.json'), JSON.stringify(appPackage, null, 2) + '\n', 'utf8');
  const productionLockPackages = { '': {
    name: appPackage.name,
    version: appPackage.version,
    dependencies: appPackage.dependencies,
  } };
  for (const entry of inputs.production.entries) {
    productionLockPackages[entry.path] = entry.record;
  }
  const appLock = {
    name: appPackage.name,
    version: appPackage.version,
    lockfileVersion: inputs.lockfile.lockfileVersion,
    requires: inputs.lockfile.requires,
    packages: productionLockPackages,
  };
  await fs.writeFile(path.join(appDir, 'package-lock.json'), JSON.stringify(appLock, null, 2) + '\n', 'utf8');
  await copyProductionDependencies(
    projectRoot,
    appDir,
    inputs.production.entries,
    inputs.production.allowedPaths,
  );
  await copyNativeRuntime(inputs.native, appDir);
  await copyDirectory(inputs.sony.sonyRoot, path.join(appDir, 'vendor', 'sony-walkman'), {
    label: 'Sony runtime assets',
    exclude(relative) {
      return relative.split('/').some((part) => part === '__pycache__') ||
        relative.endsWith('.pyc') ||
        relative.endsWith('.pdb') ||
        relative.endsWith('.lib');
    },
  });
  await copySonyX86Runtime(projectRoot, appDir, inputs.sony.x86Manifest);

  await copyDirectory(
    inputs.python.pythonRoot,
    path.join(appDir, 'runtime', 'python'),
    {
      label: 'Existing Python runtime',
      exclude(relative) {
        return relative.split('/').some((part) => part === '__pycache__') ||
          relative.endsWith('.pyc');
      },
    },
  );
  await copyDirectory(
    inputs.python.sitePackages,
    path.join(appDir, '.tools', 'desktop-runtime', 'unicorn'),
    {
      label: 'Existing Unicorn runtime package',
      include(relative) {
        return relative === 'unicorn' ||
          relative.startsWith('unicorn/') ||
          relative === inputs.python.unicornName ||
          relative.startsWith(inputs.python.unicornName + '/');
      },
      exclude(relative) {
        return relative.split('/').some((part) => part === '__pycache__') ||
          relative.endsWith('.pyc');
      },
    },
  );

  for (const relative of [
    'README.md',
    'docs/DEVELOPMENT.md',
  ]) {
    await copyProjectFile(projectRoot, appDir, relative, 'docs/' + path.basename(relative));
  }
  await copyProjectFile(projectRoot, appDir, 'LICENSE', 'LICENSE');
  await copyProjectFile(projectRoot, appDir, 'NOTICE.md', 'NOTICE.md');
  await copyLicenseFiles(projectRoot, appDir);
  return appDir;
}

async function inventoryFiles(root) {
  const result = [];
  async function visit(directory, relativeParent) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = relativeParent ? relativeParent + '/' + entry.name : entry.name;
      if (relative === 'release-manifest.json' || relative === 'release-manifest.sha256') continue;
      const absolute = path.join(directory, entry.name);
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) fail('Payload contains a symbolic link: ' + relative);
      if (info.isDirectory()) {
        await visit(absolute, relative);
      } else if (info.isFile()) {
        result.push({
          path: relative,
          sizeBytes: info.size,
          sha256: await sha256(absolute),
        });
      } else {
        fail('Payload contains an unsupported entry: ' + relative);
      }
    }
  }
  await visit(root, '');
  return result;
}

async function ensureOutputParent(projectRoot, outputDir) {
  const releaseRoot = path.join(projectRoot, releaseRootName);
  const toolsRoot = path.join(projectRoot, '.tools');
  await assertRealDirectory(toolsRoot, 'Project tools directory');
  assertWithin(releaseRoot, outputDir, 'outputDir', false);
  await fs.mkdir(releaseRoot, { recursive: true });
  await assertRealDirectory(releaseRoot, 'Windows release root');
  const relative = path.relative(releaseRoot, outputDir);
  const parts = relative.split(path.sep);
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail('outputDir must be a child of project .tools/releases.');
  }
  let current = releaseRoot;
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        fail('outputDir parent must be a real directory: ' + current);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fs.mkdir(current);
    }
  }
  try {
    await fs.lstat(outputDir);
    fail('Refusing to overwrite an existing release payload: ' + outputDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return releaseRoot;
}

export async function stageWindowsPayload({ projectRoot = projectFromScript, outputDir, version } = {}) {
  const inputs = await inspectWindowsPayloadInputs({ projectRoot, version });
  const project = inputs.projectRoot;
  const resolvedOutput = path.resolve(project, outputDir ?? path.join(releaseRootName, inputs.version));
  const stagingParent = await ensureOutputParent(project, resolvedOutput);
  const stageRoot = await fs.mkdtemp(path.join(stagingParent, '.stage-' + randomUUID() + '-'));
  try {
    const appDir = await copyRuntimeAndSources(project, stageRoot, inputs);
    const files = await inventoryFiles(stageRoot);
    const manifest = {
      schemaVersion: 1,
      product: 'Rhine Music',
      version: inputs.version,
      appExecutable: executableName,
      appDir: toPosix(appRelative),
      runtimeVersions: {
        electron: inputs.electron.version,
        python: inputs.python.versions.python,
        unicorn: inputs.python.versions.unicorn,
      },
      nativeRuntime: {
        path: 'resources/app/vendor/audio/windows-x64/assets.json',
        architecture: inputs.native.manifest.architecture,
        sourceSha256: inputs.native.manifest.sourceSha256,
        files: Object.keys(inputs.native.manifest.files).sort(),
      },
      files,
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    await fs.writeFile(path.join(stageRoot, 'release-manifest.json'), manifestText, 'utf8');
    const manifestHash = await hashBuffer(Buffer.from(manifestText, 'utf8'));
    await fs.writeFile(
      path.join(stageRoot, 'release-manifest.sha256'),
      manifestHash + '  release-manifest.json\n',
      'utf8',
    );
    await fs.rename(stageRoot, resolvedOutput);
    return {
      appExecutable: path.join(resolvedOutput, executableName),
      appDir: path.join(resolvedOutput, appRelative),
      nativeManifest: inputs.native.manifest,
      files,
      warnings: inputs.warnings,
    };
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function runCli(argv) {
  let outputDir;
  let version;
  let projectRoot = projectFromScript;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out') {
      if (!argv[index + 1]) fail('--out requires a directory.');
      outputDir = argv[++index];
    } else if (argument === '--version') {
      if (!argv[index + 1]) fail('--version requires a value.');
      version = argv[++index];
    } else if (argument === '--project-root') {
      if (!argv[index + 1]) fail('--project-root requires a directory.');
      projectRoot = argv[++index];
    } else {
      fail('Unknown argument: ' + argument);
    }
  }
  const result = await stageWindowsPayload({ projectRoot, outputDir, version });
  process.stdout.write(JSON.stringify({
    appExecutable: result.appExecutable,
    appDir: result.appDir,
    nativeManifest: {
      kind: result.nativeManifest.kind,
      architecture: result.nativeManifest.architecture,
      files: Object.keys(result.nativeManifest.files).sort(),
    },
    fileCount: result.files.length,
    warnings: result.warnings,
  }, null, 2) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli(process.argv.slice(2));
}
