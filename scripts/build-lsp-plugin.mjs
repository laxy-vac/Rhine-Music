import { promises as fs } from 'node:fs'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import os from 'node:os'

const execFileAsync = promisify(execFile)
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = path.join(project, 'vendor', 'audio', 'lsp-plugin')
const vendorManifestPath = path.join(vendorRoot, 'manifest.json')
const toolchainManifestPath = path.join(project, '.tools', 'lsp-plugin', 'toolchain-manifest.json')
const toolchainRoot = path.join(project, '.tools', 'lsp-plugin', 'toolchain', 'msys64')
const zigRoot = path.join(project, '.tools', 'walkman', 'compiler', 'zig-x86_64-windows-0.15.2')
const buildRoot = path.join(project, '.tools', 'lsp-plugin', 'build')
const checkoutRoot = path.join(buildRoot, 'checkout', 'lsp-plugins-para-equalizer')
const runtimeRoot = path.join(project, '.tools', 'lsp-plugin', 'windows-x64')
const runtimeManifestPath = path.join(runtimeRoot, 'manifest.json')
const buildScriptPath = path.join(project, 'scripts', 'build-lsp-plugin.mjs')
const prepareScriptPath = path.join(project, 'scripts', 'prepare-lsp-plugin.mjs')
const checkoutMarkerPath = path.join(checkoutRoot, '.rhine-source-state.json')
const pluginId = 'in.lsp-plug.para_equalizer_x32_stereo'
const sourcePluginFile = 'lsp-plugins-para-equalizer.clap'
const runtimePluginFile = 'lsp-para-equalizer.clap'
const dependencyFile = 'lsp-r3d-wgl-lib.dll'
const patchPath = path.join(vendorRoot, 'patches', 'generic-dispatch.patch')
const patchSha256 = 'c1e48af136024966495d8541b5ad0ca5b68106e411699e1b46d57d3effe3f1ce'
const originalDspSha256 = 'd4ad49ff3b18bd0cfbabf3c65a17b1d67489e3543dd73784020fef29a0d0ecd6'
const patchedDspSha256 = '7ff3c4df43900b76eb69effb972680f57286f564e195dd557d8c7e3b59e12e34'
const zigSha256 = 'd408dd38eed3e5204af841bcebf70502a4dbbb8399a3a3262be55059370bc018'
const msysBaseSha256 = 'ea2f31a0b6ade63914ce441ffb022f0f6aa96982bfefa2326460a26d5fb01322'

const hashBuffer = (value) => createHash('sha256').update(value).digest('hex')
const hashFile = async (file) => hashBuffer(await fs.readFile(file))
const relative = (absolute) => path.relative(project, absolute).split(path.sep).join('/')

async function exists(file) {
  try {
    await fs.lstat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

function ensureProjectPath(file, label) {
  const resolved = path.resolve(file)
  if (resolved !== project && !resolved.startsWith(project + path.sep))
    throw new Error(label + ' escapes the project directory')
  return resolved
}

async function ensureDirectory(dir, label) {
  ensureProjectPath(dir, label)
  if (await exists(dir)) {
    const info = await fs.lstat(dir)
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(label + ' must be a real directory: ' + dir)
  } else {
    await fs.mkdir(dir, { recursive: true })
  }
}

async function requireRegular(file, label) {
  const info = await fs.lstat(file)
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(label + ' must be a regular file: ' + file)
}

async function listFiles(dir, prefix = '') {
  const items = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    const absolute = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Symbolic links are not allowed in LSP source/runtime trees: ' + absolute)
    if (entry.isDirectory()) items.push(...await listFiles(absolute, rel))
    else if (entry.isFile()) items.push({ absolute, relative: rel })
    else throw new Error('Unexpected item in LSP source/runtime tree: ' + absolute)
  }
  return items
}

async function removeCreatedScratch(directory) {
  const resolvedBuildRoot = ensureProjectPath(buildRoot, 'LSP build root')
  const resolvedScratch = ensureProjectPath(directory, 'LSP extraction scratch')
  if (!resolvedScratch.startsWith(resolvedBuildRoot + path.sep) || path.dirname(resolvedScratch) !== resolvedBuildRoot)
    throw new Error('Refusing to remove an extraction directory outside the owned .tools/lsp-plugin/build root')
  const buildInfo = await fs.lstat(resolvedBuildRoot)
  const scratchInfo = await fs.lstat(resolvedScratch)
  if (!buildInfo.isDirectory() || buildInfo.isSymbolicLink() || !scratchInfo.isDirectory() || scratchInfo.isSymbolicLink())
    throw new Error('Refusing to recursively remove a non-directory or symbolic link')
  const realBuildRoot = await fs.realpath(resolvedBuildRoot)
  const realScratch = await fs.realpath(resolvedScratch)
  if (realBuildRoot !== resolvedBuildRoot || path.dirname(realScratch) !== realBuildRoot || !realScratch.startsWith(realBuildRoot + path.sep))
    throw new Error('Refusing to remove an extraction scratch whose resolved path leaves the owned build root')
  await listFiles(realScratch)
  await fs.rm(realScratch, { recursive: true, force: false })
}

async function verifyVendorManifest() {
  if (!await exists(vendorManifestPath))
    throw new Error('Pinned LSP sources are not prepared. Run `node scripts/prepare-lsp-plugin.mjs` explicitly first.')
  const manifest = JSON.parse(await fs.readFile(vendorManifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'rhine-lsp-plugin-sources')
    throw new Error('Unexpected pinned LSP source manifest')
  if (manifest.plugin?.clapPluginId !== pluginId || manifest.plugin?.variant !== 'para_equalizer_x32_stereo')
    throw new Error('Pinned LSP manifest does not describe the requested PEQ variant')
  const patch = manifest.buildCompatibilityPatches?.find((entry) => entry.path === relative(patchPath))
  if (!patch || patch.sha256 !== patchSha256 || patch.upstreamFileSha256 !== originalDspSha256 || patch.patchedFileSha256 !== patchedDspSha256)
    throw new Error('Pinned generic DSP compatibility patch metadata is missing or changed')
  const listed = []
  for (const entry of manifest.sourceFiles ?? []) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith('vendor/audio/lsp-plugin/'))
      throw new Error('Invalid LSP source manifest path')
    const file = ensureProjectPath(path.resolve(project, ...entry.path.split('/')), 'LSP source file')
    await requireRegular(file, 'Pinned LSP source ' + entry.path)
    if (await hashFile(file) !== entry.sha256) throw new Error('Pinned LSP source hash mismatch: ' + entry.path)
    listed.push(entry.path)
  }
  const actual = (await listFiles(vendorRoot))
    .map((entry) => relative(entry.absolute))
    .filter((entry) => entry !== relative(vendorManifestPath))
    .sort()
  if (JSON.stringify(actual) !== JSON.stringify(listed.slice().sort()))
    throw new Error('LSP vendor tree has unmanifested or missing files')
  return manifest
}

async function inputFingerprint() {
  for (const file of [vendorManifestPath, buildScriptPath, prepareScriptPath, toolchainManifestPath]) {
    if (!await exists(file))
      throw new Error('Required pinned build input is missing: ' + relative(file))
    await requireRegular(file, 'Pinned build input ' + relative(file))
  }
  return {
    sourceManifestSha256: await hashFile(vendorManifestPath),
    buildScriptSha256: await hashFile(buildScriptPath),
    prepareScriptSha256: await hashFile(prepareScriptPath),
    toolchainManifestSha256: await hashFile(toolchainManifestPath),
  }
}

async function verifyRuntimeCache(sourceManifest) {
  if (!await exists(runtimeManifestPath)) return { cacheHit: false, previousManifest: null }
  await requireRegular(runtimeManifestPath, 'LSP runtime manifest')
  const manifest = JSON.parse(await fs.readFile(runtimeManifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'rhine-lsp-plugin-runtime' || manifest.state !== 'ready')
    throw new Error('Existing LSP runtime manifest is not a ready schema-1 manifest')
  if (manifest.pluginId !== pluginId)
    throw new Error('Existing LSP runtime manifest belongs to a different CLAP plugin')
  if (!Array.isArray(manifest.runtimeFiles) || manifest.runtimeFiles.length !== 2)
    throw new Error('Existing LSP runtime manifest has an unexpected file list')
  const expectedNames = new Set([runtimePluginFile, dependencyFile])
  for (const item of manifest.runtimeFiles) {
    if (!expectedNames.delete(item.path)) throw new Error('Unexpected or duplicate LSP runtime file: ' + item.path)
    const file = ensureProjectPath(path.resolve(runtimeRoot, ...item.path.split('/')), 'LSP runtime file')
    await requireRegular(file, 'LSP runtime file ' + item.path)
    if (await hashFile(file) !== item.sha256) throw new Error('LSP runtime hash mismatch: ' + item.path)
  }
  if (expectedNames.size) throw new Error('LSP runtime manifest omits a required runtime file')
  const fingerprint = await inputFingerprint()
  const cacheHit = manifest.sourceManifestSha256 === fingerprint.sourceManifestSha256 &&
    JSON.stringify(manifest.inputFingerprint) === JSON.stringify(fingerprint)
  if (cacheHit) {
    console.log('Verified cached LSP PEQ runtime; manifest left unchanged.')
    console.log(relative(path.join(runtimeRoot, runtimePluginFile)))
    return { cacheHit: true, previousManifest: manifest, previousManifestSha256: await hashFile(runtimeManifestPath), fingerprint }
  }
  console.log('Runtime files match the previous owned manifest; pinned build inputs changed, so rebuilding and refreshing the manifest.')
  return { cacheHit: false, previousManifest: manifest, previousManifestSha256: await hashFile(runtimeManifestPath), fingerprint }
}

function toMsysPath(file) {
  const absolute = path.resolve(file).replace(/\\/g, '/')
  const drive = absolute.match(/^([A-Za-z]):\//)
  if (!drive) throw new Error('Expected a drive-qualified Windows path: ' + file)
  return '/' + drive[1].toLowerCase() + absolute.slice(2)
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

async function verifyArchives(manifest) {
  for (const component of manifest.components) {
    const archive = ensureProjectPath(path.resolve(project, ...component.localArchive.split('/')), 'Pinned source archive')
    if (!await exists(archive))
      throw new Error('Pinned source archive is missing: ' + component.localArchive + '. Run `node scripts/prepare-lsp-plugin.mjs` explicitly to download and verify it.')
    await requireRegular(archive, 'Pinned source archive ' + component.name)
    if (await hashFile(archive) !== component.archiveSha256)
      throw new Error('Pinned source archive hash mismatch: ' + component.name)
  }
}

function checkoutSourceState(manifest) {
  return {
    schemaVersion: 1,
    kind: 'rhine-lsp-plugin-build-checkout',
    sources: manifest.components
      .filter((entry) => entry.buildRequired || entry.name === 'lsp-plugins-para-equalizer')
      .map((entry) => ({ name: entry.name, version: entry.version, commit: entry.commit, archiveSha256: entry.archiveSha256 })),
    compatibilityPatch: {
      path: relative(patchPath),
      sha256: patchSha256,
      upstreamDspSourceSha256: originalDspSha256,
      patchedDspSourceSha256: patchedDspSha256,
    },
  }
}

async function verifyCheckoutMarker(manifest) {
  if (!await exists(checkoutMarkerPath)) return false
  await requireRegular(checkoutMarkerPath, 'LSP build checkout marker')
  const current = JSON.parse(await fs.readFile(checkoutMarkerPath, 'utf8'))
  if (JSON.stringify(current) !== JSON.stringify(checkoutSourceState(manifest)))
    throw new Error('Existing build checkout belongs to different pinned LSP sources or compatibility patch; refusing to reuse it.')
  return true
}

async function writeCheckoutMarker(manifest) {
  const expected = Buffer.from(JSON.stringify(checkoutSourceState(manifest), null, 2) + '\n', 'utf8')
  if (await exists(checkoutMarkerPath)) {
    await verifyCheckoutMarker(manifest)
    if (!(await fs.readFile(checkoutMarkerPath)).equals(expected))
      throw new Error('LSP build checkout marker does not match expected pinned source state')
    return
  }
  const temporary = checkoutMarkerPath + '.' + randomUUID() + '.tmp'
  await fs.writeFile(temporary, expected, { flag: 'wx' })
  await fs.rename(temporary, checkoutMarkerPath)
}

async function ensureCheckout(manifest) {
  if (await exists(checkoutRoot)) {
    const info = await fs.lstat(checkoutRoot)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Build checkout must be a real directory')
    await verifyCheckoutMarker(manifest)
    for (const component of manifest.components.filter((entry) => entry.buildRequired && entry.name !== 'lsp-plugins-para-equalizer')) {
      const modulePath = path.join(checkoutRoot, 'modules', component.name)
      if (!await exists(modulePath) || !(await fs.lstat(modulePath)).isDirectory())
        throw new Error('Existing pinned LSP checkout is incomplete; missing ' + component.name)
    }
    return
  }

  await ensureDirectory(path.dirname(checkoutRoot), 'LSP build checkout parent')
  const scratch = path.join(buildRoot, 'extract-' + randomUUID())
  const stagedCheckout = path.join(scratch, 'lsp-plugins-para-equalizer')
  await fs.mkdir(scratch, { recursive: false })
  try {
    const plugin = manifest.components.find((entry) => entry.name === 'lsp-plugins-para-equalizer')
    const pluginArchive = path.resolve(project, ...plugin.localArchive.split('/'))
    await execFileAsync('tar.exe', ['-xf', pluginArchive, '-C', scratch], { windowsHide: true, maxBuffer: 1024 * 1024 })
    const pluginRoot = path.join(scratch, plugin.name + '-' + plugin.commit)
    await fs.rename(pluginRoot, stagedCheckout)
    await fs.mkdir(path.join(stagedCheckout, 'modules'), { recursive: true })
    for (const component of manifest.components.filter((entry) => entry.buildRequired && entry.name !== plugin.name)) {
      const moduleScratch = path.join(scratch, 'module-' + component.name)
      await fs.mkdir(moduleScratch)
      const archive = path.resolve(project, ...component.localArchive.split('/'))
      await execFileAsync('tar.exe', ['-xf', archive, '-C', moduleScratch], { windowsHide: true, maxBuffer: 1024 * 1024 })
      const moduleRoot = path.join(moduleScratch, component.name + '-' + component.commit)
      await fs.rename(moduleRoot, path.join(stagedCheckout, 'modules', component.name))
    }
    await fs.rename(stagedCheckout, checkoutRoot)
  } finally {
    if (await exists(scratch)) await removeCreatedScratch(scratch)
  }
}

async function patchGenericDispatcher() {
  const dspFile = path.join(checkoutRoot, 'modules', 'lsp-dsp-lib', 'src', 'main', 'dsp.cpp')
  await requireRegular(dspFile, 'Pinned DSP dispatcher source')
  const beforeHash = await hashFile(dspFile)
  if (beforeHash === patchedDspSha256) return
  if (beforeHash !== originalDspSha256)
    throw new Error('Unexpected lsp-dsp-lib dispatcher source hash; refusing to patch')
  if (await hashFile(patchPath) !== patchSha256)
    throw new Error('Generic DSP compatibility patch hash mismatch')

  let source = await fs.readFile(dspFile, 'utf8')
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const cpuBlock = /[ \t]*\/\/ Dectect CPU options\r?\n[ \t]*IF_ARCH_SPECIFIC_INIT\(\r?\n[ \t]*cpuid_t f;\r?\n[ \t]*cpuid\(&f\);\r?\n[ \t]*\);\r?\n/
  const dispatchBlock = /[ \t]*\/\/ Initialize architecture-dependent functions that utilize architecture-specific features\r?\n[ \t]*IF_ARCH_SPECIFIC_INIT\(\r?\n[ \t]*LSP_DSP_CPU_NAMESPACE::dsp_init\(&f\)\r?\n[ \t]*\);\r?\n/
  if (!cpuBlock.test(source) || !dispatchBlock.test(source))
    throw new Error('Pinned DSP dispatcher source does not match the recorded compatibility patch')
  source = source.replace(cpuBlock, '            // Rhine\'s generic fallback initializes only the portable generic DSP.' + newline)
  source = source.replace(dispatchBlock, '                // Architecture dispatch is omitted by this build-only compatibility patch.' + newline)
  const actualHash = hashBuffer(Buffer.from(source, 'utf8'))
  if (actualHash !== patchedDspSha256)
    throw new Error('Patched DSP dispatcher hash mismatch: ' + actualHash)
  await fs.writeFile(dspFile, source)
}

async function processRuntimeEnvironment() {
  const zig = path.join(zigRoot, 'zig.exe')
  const bash = path.join(toolchainRoot, 'usr', 'bin', 'bash.exe')
  const ld = path.join(toolchainRoot, 'usr', 'bin', 'ld.exe')
  const make = path.join(toolchainRoot, 'usr', 'bin', 'make.exe')
  for (const [file, label, prepareHint] of [
    [zig, 'Existing project-local Zig compiler', 'Reuse the approved project Zig compiler; the plugin scripts never install compilers.'],
    [bash, 'Project-local MSYS2 bash', 'Run `node scripts/prepare-lsp-plugin.mjs --tools` explicitly to prepare the approved local tools.'],
    [ld, 'Project-local GNU ld', 'Run `node scripts/prepare-lsp-plugin.mjs --tools` explicitly to prepare the approved local tools.'],
    [make, 'Project-local GNU Make', 'Run `node scripts/prepare-lsp-plugin.mjs --tools` explicitly to prepare the approved local tools.'],
  ]) {
    if (!await exists(file)) throw new Error(label + ' is missing. ' + prepareHint)
    await requireRegular(file, label)
  }
  if (await hashFile(zig) !== zigSha256) throw new Error('Existing project Zig compiler hash mismatch')
  const toolchain = JSON.parse(await fs.readFile(toolchainManifestPath, 'utf8'))
  if (toolchain.schemaVersion !== 1 || toolchain.kind !== 'rhine-lsp-plugin-toolchain' || toolchain.compiler?.sha256 !== zigSha256 || toolchain.msys2Base?.archiveSha256 !== msysBaseSha256)
    throw new Error('Project-local LSP toolchain manifest is missing or changed')
  for (const pkg of toolchain.packages ?? []) {
    const archive = ensureProjectPath(path.resolve(project, ...pkg.archiveFile.split('/')), 'MSYS2 package archive')
    if (!await exists(archive)) throw new Error('Pinned tool package is missing: ' + pkg.archiveFile + '. Run `node scripts/prepare-lsp-plugin.mjs --tools` explicitly.')
    await requireRegular(archive, 'Pinned MSYS2 package ' + pkg.name)
    if (await hashFile(archive) !== pkg.sha256) throw new Error('Pinned MSYS2 package hash mismatch: ' + pkg.name)
  }
  const env = { ...process.env }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = [path.join(toolchainRoot, 'usr', 'bin'), zigRoot, env[pathKey] ?? ''].join(path.delimiter)
  env.MSYSTEM = 'MINGW64'
  env.MSYS2_PATH_TYPE = 'inherit'
  env.HOME = path.join(toolchainRoot, 'home', 'rhine')
  env.ZIG_LOCAL_CACHE_DIR = path.join(project, '.tools', 'lsp-plugin', 'cache', 'zig-local')
  env.ZIG_GLOBAL_CACHE_DIR = path.join(project, '.tools', 'lsp-plugin', 'cache', 'zig-global')
  env.TMP = path.join(project, '.tools', 'lsp-plugin', 'cache', 'tmp')
  env.TEMP = env.TMP
  for (const key of ['HOME', 'ZIG_LOCAL_CACHE_DIR', 'ZIG_GLOBAL_CACHE_DIR', 'TMP'])
    await ensureDirectory(env[key], 'Project-local ' + key)
  return { bash, env }
}

async function configureBuild(bash, env) {
  const config = path.join(checkoutRoot, '.config.mk')
  const buildMsys = toMsysPath(checkoutRoot)
  if (!await exists(config)) {
    const args = [
      'PLATFORM=Windows', 'ARCHITECTURE=x86_64', 'ARCHITECTURE_FAMILY=generic', 'ARCHITECTURE_CFLAGS=',
      'HOST_ARCHITECTURE=x86_64', 'HOST_ARCHITECTURE_FAMILY=generic', 'HOST_ARCHITECTURE_CFLAGS=',
      'FEATURES=clap ui',
      'CC=zig cc -target x86_64-windows-gnu', 'CXX=zig c++ -target x86_64-windows-gnu',
      'AS=zig cc -target x86_64-windows-gnu', 'AR=zig ar', 'LD=ld',
      'LDFLAGS=-m i386pep -T ' + buildMsys + '/make/ld-windows.script -r',
    ].map(shellQuote).join(' ')
    const command = 'cd ' + shellQuote(buildMsys) + ' && make config ' + args + ' VERBOSE=1'
    await execFileAsync(bash, ['--noprofile', '--norc', '-lc', command], { env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  }
  let content = await fs.readFile(config, 'utf8')
  content = content.replace(/ -Wl,-as-needed/g, '')
  await fs.writeFile(config, content)
  if (!content.includes('ARCHITECTURE_FAMILY=generic') || !content.includes('BUILD_FEATURES=clap ui') || content.includes('-Wl,-as-needed'))
    throw new Error('Generated LSP configuration is not the expected Zig Windows x64 CLAP/UI release configuration')
}

async function runBundle(bash, env) {
  const bundleRoot = path.join(buildRoot, 'bundle-run-' + randomUUID())
  await fs.mkdir(bundleRoot, { recursive: false })
  const buildLog = path.join(project, '.tools', 'lsp-plugin', 'cache', 'build-lsp-plugin-' + randomUUID() + '.log')
  await ensureDirectory(path.dirname(buildLog), 'LSP build log directory')
  const buildMsys = toMsysPath(checkoutRoot)
  const bundleMsys = toMsysPath(bundleRoot)
  const logMsys = toMsysPath(buildLog)
  const command = [
    'cd ' + shellQuote(buildMsys),
    'export DESTDIR=' + shellQuote(bundleMsys),
    // common-lib dispatch follows the compiler target and needs its x64
    // initializers. Scope this override to that module; DSP stays generic.
    'make -C modules/lsp-common-lib/src -j' + Math.max(1, os.availableParallelism()) + ' compile VERBOSE=1 CONFIG=' + shellQuote(buildMsys + '/.config.mk') + ' ARCHITECTURE_FAMILY=x86_64 HOST_ARCHITECTURE_FAMILY=x86_64 CXX_AVX512_CFLAGS=' + shellQuote('-mavx512f -mavx512vl -mevex512') + ' > ' + shellQuote(logMsys) + ' 2>&1',
    'status=$?',
    'if [ "$status" -eq 0 ]; then',
    '  make -j' + Math.max(1, os.availableParallelism()) + ' bundle VERBOSE=1 >> ' + shellQuote(logMsys) + ' 2>&1',
    '  status=$?',
    'fi',
    '/usr/bin/tail -n 60 ' + shellQuote(logMsys),
    'exit $status',
  ].join('\n')
  try {
    await execFileAsync(bash, ['--noprofile', '--norc', '-lc', command], { env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    error.message += '\nBuild log: ' + relative(buildLog)
    throw error
  }
  const clapDir = path.join(bundleRoot, 'CLAP')
  const files = await listFiles(clapDir)
  const names = files.map((item) => item.relative).sort()
  if (JSON.stringify(names) !== JSON.stringify([dependencyFile, sourcePluginFile].sort()))
    throw new Error('Upstream CLAP bundle contains unexpected runtime files: ' + names.join(', '))
  return { bundleRoot, clapFile: path.join(clapDir, sourcePluginFile), dependency: path.join(clapDir, dependencyFile), buildLog }
}

async function stageFile(source, destination, expectedHash, label, previousManifest) {
  ensureProjectPath(destination, label)
  if (await exists(destination)) {
    await requireRegular(destination, label)
    const currentHash = await hashFile(destination)
    if (currentHash === expectedHash) return
    const previous = previousManifest?.runtimeFiles?.find((entry) => entry.path === path.basename(destination))
    if (!previous || previous.sha256 !== currentHash)
      throw new Error(label + ' already exists with unknown contents; refusing to overwrite it')
    const temporary = destination + '.' + randomUUID() + '.tmp'
    await fs.copyFile(source, temporary, fsConstants.COPYFILE_EXCL)
    await requireRegular(temporary, label + ' staged replacement')
    if (await hashFile(temporary) !== expectedHash) throw new Error(label + ' changed while staging its replacement')
    await fs.rename(temporary, destination)
    await requireRegular(destination, label)
    if (await hashFile(destination) !== expectedHash) throw new Error(label + ' replacement hash mismatch')
  } else {
    await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL)
    await requireRegular(destination, label)
    if (await hashFile(destination) !== expectedHash) throw new Error(label + ' changed while staging')
  }
}

const sourceManifest = await verifyVendorManifest()
const cacheState = await verifyRuntimeCache(sourceManifest)
if (cacheState.cacheHit) process.exit(0)

await verifyArchives(sourceManifest)
await ensureCheckout(sourceManifest)
await patchGenericDispatcher()
await writeCheckoutMarker(sourceManifest)
const { bash, env } = await processRuntimeEnvironment()
await configureBuild(bash, env)
const bundle = await runBundle(bash, env)

await ensureDirectory(runtimeRoot, 'LSP PEQ runtime directory')
const pluginDestination = path.join(runtimeRoot, runtimePluginFile)
const dependencyDestination = path.join(runtimeRoot, dependencyFile)
const pluginSha256 = await hashFile(bundle.clapFile)
const dependencySha256 = await hashFile(bundle.dependency)
await stageFile(bundle.clapFile, pluginDestination, pluginSha256, 'LSP PEQ CLAP runtime', cacheState.previousManifest)
await stageFile(bundle.dependency, dependencyDestination, dependencySha256, 'LSP PEQ GUI dependency', cacheState.previousManifest)
const fingerprint = cacheState.fingerprint ?? await inputFingerprint()

const runtimeManifest = {
  schemaVersion: 1,
  kind: 'rhine-lsp-plugin-runtime',
  state: 'ready',
  target: 'windows-x64',
  pluginId,
  name: 'LSP Parametric Equalizer x32 Stereo',
  version: '1.0.40',
  ui: 'Official upstream LSP plug-in framework GUI',
  releaseBuild: true,
  debug: false,
  trace: false,
  parameterMetadata: {
    source: 'The official CLAP params extension is available; Rhine uses the upstream native UI and CLAP state path rather than enumerating parameters.',
    bands: 32,
    channels: 'stereo',
    centerFrequencyDefaultsHz: [16, 20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000],
  },
  sourceManifestSha256: await hashFile(vendorManifestPath),
  inputFingerprint: fingerprint,
  upstreamRelease: sourceManifest.upstreamRelease,
  components: sourceManifest.components.filter((entry) => entry.buildRequired || entry.name === 'lsp-plugins-para-equalizer'),
  build: {
    platform: 'Windows',
    architecture: 'x86_64',
    commonLibrary: {
      target: 'compile',
      architectureFamily: 'x86_64',
      avx512Flags: ['-mavx512f', '-mavx512vl', '-mevex512'],
      scope: 'Only lsp-common-lib: include required x64 initialization and runtime-gated memory helpers. The whole-plugin configuration and audio DSP remain generic.',
    },
    features: ['clap', 'ui'],
    dsp: {
      implementation: 'generic-only fallback',
      performanceBoundary: 'x64 binary; LSP x86 SSE/AVX dispatch is omitted, so equalizer DSP uses upstream generic routines.',
      compatibilityPatch: {
        path: relative(patchPath),
        sha256: patchSha256,
        upstreamDspSourceSha256: originalDspSha256,
        patchedDspSourceSha256: patchedDspSha256,
        scope: 'Isolated .tools build checkout only; pinned official source archive and vendor files are unchanged.',
      },
    },
    compiler: { name: 'Zig', version: '0.15.2', path: relative(path.join(zigRoot, 'zig.exe')), sha256: zigSha256 },
    linker: { name: 'GNU ld', version: '2.47-1', path: relative(path.join(toolchainRoot, 'usr', 'bin', 'ld.exe')), reason: 'Partial Windows COFF object merge (-r); Zig LLD does not support this upstream build operation.' },
    flags: { release: true, debug: false, trace: false, asNeededRemoved: 'Zig Windows linker rejects upstream -Wl,-as-needed.' },
  },
  runtimeFiles: [
    { path: runtimePluginFile, sha256: pluginSha256, size: (await fs.stat(pluginDestination)).size, role: 'CLAP plugin binary' },
    { path: dependencyFile, sha256: dependencySha256, size: (await fs.stat(dependencyDestination)).size, role: 'Required upstream Windows GUI graphics dependency; load beside the CLAP module.' },
  ],
}

const manifestBytes = Buffer.from(JSON.stringify(runtimeManifest, null, 2) + '\n', 'utf8')
if (await exists(runtimeManifestPath)) {
  await requireRegular(runtimeManifestPath, 'LSP runtime manifest')
  if (!cacheState.previousManifest || await hashFile(runtimeManifestPath) !== cacheState.previousManifestSha256)
    throw new Error('LSP runtime manifest changed during build; refusing to replace unknown contents')
  if (!(await fs.readFile(runtimeManifestPath)).equals(manifestBytes)) {
    const temporary = runtimeManifestPath + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, manifestBytes, { flag: 'wx' })
    await fs.rename(temporary, runtimeManifestPath)
  }
} else {
  const temporary = runtimeManifestPath + '.' + randomUUID() + '.tmp'
  await fs.writeFile(temporary, manifestBytes, { flag: 'wx' })
  await fs.rename(temporary, runtimeManifestPath)
}

console.log('Built and staged the official LSP PEQ x32 Stereo CLAP release binary with upstream GUI.')
console.log('Plugin ID: ' + pluginId)
console.log('CLAP: ' + relative(pluginDestination) + ' (' + pluginSha256 + ')')
console.log('Dependency: ' + relative(dependencyDestination) + ' (' + dependencySha256 + ')')
console.log('Runtime manifest: ' + relative(runtimeManifestPath))
