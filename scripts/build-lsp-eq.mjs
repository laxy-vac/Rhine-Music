import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceManifestPath = path.join(project, 'vendor', 'audio', 'lsp', 'manifest.json')
const toolsRoot = path.join(project, '.tools')
const outputRoot = path.join(toolsRoot, 'lsp-eq', 'windows-x64')
const cacheRoot = path.join(toolsRoot, 'lsp-eq', 'cache')
const stagingRoot = path.join(cacheRoot, 'build')
const dllName = 'rhine-lsp-eq.dll'
const manifestName = 'manifest.json'
const outputDll = path.join(outputRoot, dllName)
const outputManifest = path.join(outputRoot, manifestName)
const bundledCompiler = path.join(project, '.tools', 'walkman', 'compiler', 'zig-x86_64-windows-0.15.2', 'zig.exe')
const allowedOutputFiles = new Set([dllName, manifestName])

const hashBuffer = (value) => createHash('sha256').update(value).digest('hex')
const hashFile = async (file) => hashBuffer(await fs.readFile(file))
const relativePath = (absolute) => path.relative(project, absolute).split(path.sep).join('/')

async function exists(file) {
  try {
    await fs.lstat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function requireRealDirectory(directory, label) {
  const resolved = path.resolve(directory)
  if (resolved !== project && !resolved.startsWith(project + path.sep)) throw new Error(`${label} escapes the project directory`)
  if (await exists(directory)) {
    const info = await fs.lstat(directory)
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error(`${label} must be a real directory: ${directory}`)
  } else {
    await fs.mkdir(directory)
  }
}

async function requireRegularFile(file, label) {
  const info = await fs.lstat(file)
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${label} must be a regular file: ${file}`)
}

function run(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: project, windowsHide: true, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(program)} exited with code ${code}`)))
  })
}

async function readSourceManifest() {
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`LSP source manifest is missing or invalid: ${error.message}`)
  }
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'rhine-lsp-eq-sources' ||
      !Array.isArray(manifest.components) || !Array.isArray(manifest.sourceFiles) ||
      !Array.isArray(manifest.includeDirectories) || !Array.isArray(manifest.buildSources))
    throw new Error('LSP source manifest has an unexpected layout')

  for (const entry of manifest.sourceFiles) {
    if (typeof entry.path !== 'string' || !/^vendor\/audio\/lsp\//.test(entry.path) || !/^[a-f0-9]{64}$/i.test(entry.sha256))
      throw new Error('LSP source manifest contains an invalid source path or SHA256')
    const absolute = path.resolve(project, ...entry.path.split('/'))
    if (!absolute.startsWith(path.join(project, 'vendor', 'audio', 'lsp') + path.sep))
      throw new Error(`LSP source path escapes the vendor root: ${entry.path}`)
    await requireRegularFile(absolute, `Vendored LSP source ${entry.path}`)
    const actual = await hashFile(absolute)
    if (actual.toLowerCase() !== entry.sha256.toLowerCase()) throw new Error(`Vendored LSP source hash mismatch: ${entry.path}`)
  }

  const includeDirectories = manifest.includeDirectories.map((entry) => {
    if (typeof entry !== 'string' || !/^vendor\/audio\/lsp\//.test(entry)) throw new Error('LSP include directory is invalid')
    const absolute = path.resolve(project, ...entry.split('/'))
    if (!absolute.startsWith(path.join(project, 'vendor', 'audio', 'lsp') + path.sep)) throw new Error(`LSP include path escapes the vendor root: ${entry}`)
    return absolute
  })
  const buildSources = manifest.buildSources.map((entry) => {
    if (typeof entry !== 'string' || !/^vendor\/audio\/lsp\//.test(entry)) throw new Error('LSP build source is invalid')
    const absolute = path.resolve(project, ...entry.split('/'))
    if (!absolute.startsWith(path.join(project, 'vendor', 'audio', 'lsp') + path.sep)) throw new Error(`LSP build source escapes the vendor root: ${entry}`)
    if (!manifest.sourceFiles.some(source => source.path === entry)) throw new Error(`LSP build source has no verified hash: ${entry}`)
    return absolute
  })
  if (!await exists(bundledCompiler)) throw new Error(`The bundled Zig compiler is unavailable: ${bundledCompiler}`)
  await requireRegularFile(bundledCompiler, 'Bundled Zig compiler')
  return { manifest, includeDirectories, buildSources }
}

async function verifyExistingOutputs() {
  const entries = await fs.readdir(outputRoot)
  for (const name of entries) {
    if (!allowedOutputFiles.has(name)) throw new Error(`Refusing to overwrite an unfamiliar LSP EQ output: ${name}`)
    await requireRegularFile(path.join(outputRoot, name), `LSP EQ output ${name}`)
  }
  if (entries.length === 0) return
  if (!entries.includes(manifestName) || !entries.includes(dllName)) throw new Error('Existing LSP EQ output has no complete ownership manifest')
  let oldManifest
  try {
    oldManifest = JSON.parse(await fs.readFile(outputManifest, 'utf8'))
  } catch (error) {
    throw new Error(`Existing LSP EQ output manifest is invalid: ${error.message}`)
  }
  const current = await hashFile(outputDll)
  const recorded = oldManifest.runtimeFiles?.find((entry) => entry.path === relativePath(outputDll))
  if (oldManifest.kind !== 'rhine-lsp-eq-runtime' || oldManifest.schemaVersion !== 1 || !recorded || recorded.sha256 !== current)
    throw new Error('Existing LSP EQ DLL does not match its ownership manifest')
  return oldManifest
}

await requireRealDirectory(toolsRoot, 'Project tools directory')
if (!await exists(sourceManifestPath)) throw new Error('LSP sources are missing. Run scripts/prepare-lsp-eq.mjs explicitly before building.')
const { manifest: sourceManifest, includeDirectories, buildSources } = await readSourceManifest()
await requireRealDirectory(path.join(toolsRoot, 'lsp-eq'), 'LSP EQ tools directory')
await requireRealDirectory(outputRoot, 'LSP EQ output directory')
await requireRealDirectory(cacheRoot, 'LSP EQ cache directory')
await requireRealDirectory(stagingRoot, 'LSP EQ build staging directory')
const previousRuntime = await verifyExistingOutputs()
const bridgeFiles = ['native/lsp-eq-dll.cpp', 'native/lsp-eq-api.h', 'native/lsp-eq-catalog.h', 'scripts/build-lsp-eq.mjs', 'vendor/audio/windows-x64/include/json.hpp']
const bridgeSourceFiles = {}
for (const file of bridgeFiles) bridgeSourceFiles[file] = await hashFile(path.join(project, file))
const buildInputSha256 = hashBuffer(JSON.stringify({ sourceManifest, bridgeSourceFiles }))
if (previousRuntime?.buildInputSha256 === buildInputSha256 && previousRuntime?.state === 'ready') {
  console.log('LSP Equalizer DLL is current; reusing verified project output.')
  process.exit(0)
}

const zigLocalCache = path.join(cacheRoot, 'zig-local')
const zigGlobalCache = path.join(cacheRoot, 'zig-global')
await requireRealDirectory(zigLocalCache, 'LSP EQ Zig local cache')
await requireRealDirectory(zigGlobalCache, 'LSP EQ Zig global cache')

const stagedDll = path.join(stagingRoot, `${dllName}.${randomUUID()}.tmp.dll`)
const args = [
  'c++',
  '-target', 'x86_64-windows-gnu',
  '-std=c++17',
  '-O2',
  '-fno-fast-math',
  '-static',
  '-shared',
  '-DLSP_DSP_UNITS_BUILTIN',
  '-DLSP_DSP_LIB_BUILTIN',
  '-DLSP_COMMON_LIB_BUILTIN',
  '-DLSP_LLTL_LIB_BUILTIN',
  '-DLSP_RUNTIME_LIB_BUILTIN',
  '-DRHINE_LSP_EQ_BUILD',
  /* Keep LSP's upstream dispatcher on its generic implementation. */
  '-DPRIVATE_DSP_ARCH_X86_INIT_H_',
  '-I', path.join(project, 'native'),
  ...includeDirectories.flatMap((directory) => ['-I', directory]),
  path.join(project, 'native', 'lsp-eq-dll.cpp'),
  ...buildSources,
  '-Wl,--no-undefined',
  '-o', stagedDll,
]
await run(bundledCompiler, args, {
  env: {
    ...process.env,
    ZIG_LOCAL_CACHE_DIR: zigLocalCache,
    ZIG_GLOBAL_CACHE_DIR: zigGlobalCache,
  },
})

const dllSha256 = await hashFile(stagedDll)
await fs.copyFile(stagedDll, outputDll)
await fs.unlink(stagedDll)

const runtimeManifest = {
  schemaVersion: 1,
  kind: 'rhine-lsp-eq-runtime',
  architecture: 'windows-x64',
  state: 'ready',
  apiVersion: 1,
  sourceManifest: 'vendor/audio/lsp/manifest.json',
  components: sourceManifest.components,
  sourceFiles: sourceManifest.sourceFiles,
  bridgeSourceFiles,
  buildInputSha256,
  runtimeFiles: [{ path: relativePath(outputDll), sha256: dllSha256 }],
  compiler: relativePath(bundledCompiler),
  compilerVersion: '0.15.2',
  target: 'x86_64-windows-gnu',
  exportedFunctions: [
    'rhine_lsp_eq_version',
    'rhine_lsp_eq_create',
    'rhine_lsp_eq_destroy',
    'rhine_lsp_eq_reset',
    'rhine_lsp_eq_process',
    'rhine_lsp_eq_latency',
    'rhine_lsp_eq_response',
  ],
}
const stagedManifest = path.join(stagingRoot, `${manifestName}.${randomUUID()}.tmp`)
await fs.writeFile(stagedManifest, `${JSON.stringify(runtimeManifest, null, 2)}\n`, 'utf8')
await fs.copyFile(stagedManifest, outputManifest)
await fs.unlink(stagedManifest)
console.log(`Built the pinned LSP Equalizer DLL: ${relativePath(outputDll)}`)
