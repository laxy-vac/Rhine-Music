import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const downloads = path.join(project, '.tools', 'downloads', 'lsp')
const extracted = path.join(downloads, 'extracted')
const vendorRoot = path.join(project, 'vendor', 'audio', 'lsp')

const components = [
  {
    name: 'lsp-dsp-units',
    repository: 'https://github.com/lsp-plugins/lsp-dsp-units',
    version: '1.0.38',
    commit: '186be049af15d9678d80c8b3dee67817e4487535',
    archiveSha256: 'dd352dd1d0e94fbcb3d41498abeab3d0cf73e141a45932896d69915e72fc93a3',
    license: 'LGPL-3.0-or-later',
  },
  {
    name: 'lsp-dsp-lib',
    repository: 'https://github.com/lsp-plugins/lsp-dsp-lib',
    version: '1.1.1',
    commit: '2f93492a3af9532c364b6d426cca9a1a7d5fe0f3',
    archiveSha256: '829d6835852fa23726df36a5671a5799b08279b3c5f3a8c703460ed37561d80e',
    license: 'LGPL-3.0-or-later',
  },
  {
    name: 'lsp-common-lib',
    repository: 'https://github.com/lsp-plugins/lsp-common-lib',
    version: '1.0.49',
    commit: '072e4ad8c495ee19f8dda1a94d5c09c2ce78525f',
    archiveSha256: 'b8c78f34c415e6da84b30d011f58d59d7e65896466c8ce58c2635f9e6f4361dc',
    license: 'LGPL-3.0-or-later',
  },
  {
    name: 'lsp-lltl-lib',
    repository: 'https://github.com/lsp-plugins/lsp-lltl-lib',
    version: '1.0.33',
    commit: '64a0f36cb2cd42cd2952ed123f51518fcde9eb87',
    archiveSha256: '803d6a66feb8210bd0308669351590e5ec0d1010a8b6e73b17df70b75f0a280a',
    license: 'LGPL-3.0-or-later',
  },
  {
    name: 'lsp-runtime-lib',
    repository: 'https://github.com/lsp-plugins/lsp-runtime-lib',
    version: '1.0.36',
    commit: '52d887e515a59a3839db15d6d8536b1e0df46de0',
    archiveSha256: '0ffba1657bb08d93d47f01437ec48bb9d7cd0ac64606d9f502c27212ff412dfa',
    license: 'LGPL-3.0-or-later',
  },
]

const buildSources = [
  ['lsp-dsp-units', 'src/main/filters/Equalizer.cpp'],
  ['lsp-dsp-units', 'src/main/filters/Filter.cpp'],
  ['lsp-dsp-units', 'src/main/filters/FilterBank.cpp'],
  ['lsp-dsp-units', 'src/main/misc/windows.cpp'],
  ['lsp-dsp-lib', 'src/main/dsp.cpp'],
  ['lsp-dsp-lib', 'src/main/generic/generic.cpp'],
  ['lsp-common-lib', 'src/main/bits.cpp'],
  ['lsp-common-lib', 'src/main/cpuid.cpp'],
  ['lsp-common-lib', 'src/main/singletone.cpp'],
  ['lsp-common-lib', 'src/main/stdio.cpp'],
]

const hashBuffer = (value) => createHash('sha256').update(value).digest('hex')
const hashFile = async (file) => hashBuffer(await fs.readFile(file))
const projectPath = (absolute) => path.relative(project, absolute).split(path.sep).join('/')

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
  if (resolved !== project && !resolved.startsWith(project + path.sep)) {
    throw new Error(`${label} escapes the project directory`)
  }
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

async function runCurl(args) {
  await execFileAsync('curl.exe', args, { windowsHide: true, maxBuffer: 1024 * 1024 })
}

async function ensureArchive(component) {
  const fileName = `${component.name}-${component.commit.slice(0, 12)}.zip`
  const archive = path.join(downloads, fileName)
  if (await exists(archive)) {
    await requireRegularFile(archive, `LSP source archive ${fileName}`)
    const actual = await hashFile(archive)
    if (actual !== component.archiveSha256) throw new Error(`LSP archive hash mismatch for ${component.name}: ${actual}`)
    return { archive, fileName }
  }

  const staging = path.join(downloads, `${fileName}.${randomUUID()}.part`)
  const url = `https://codeload.github.com/lsp-plugins/${component.name}/zip/${component.commit}`
  try {
    await runCurl(['-L', '--fail', '--silent', '--show-error', '--output', staging, url])
    const actual = await hashFile(staging)
    if (actual !== component.archiveSha256) throw new Error(`LSP archive hash mismatch for ${component.name}: ${actual}`)
    await fs.rename(staging, archive)
  } catch (error) {
    if (await exists(staging)) await fs.unlink(staging)
    throw error
  }
  return { archive, fileName }
}

async function ensureExtracted(component, archive) {
  const destination = path.join(extracted, `${component.name}-${component.commit}`)
  const expectedSource = path.join(destination, `${component.name}-${component.commit}`)
  if (await exists(destination)) await requireRealDirectory(destination, `LSP extraction ${component.name}`)
  else await fs.mkdir(destination)
  try {
    await execFileAsync('tar.exe', ['-xf', archive, '-C', destination], { windowsHide: true, maxBuffer: 1024 * 1024 })
    await requireRealDirectory(expectedSource, `LSP extracted source ${component.name}`)
    await requireRealDirectory(path.join(expectedSource, 'include'), `LSP headers ${component.name}`)
    return expectedSource
  } catch (error) {
    throw new Error(`Could not extract verified ${component.name} source: ${error.message}`)
  }
}

async function copyTree(source, destination) {
  await fs.cp(source, destination, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true })
}

async function copyRegularFile(source, destination) {
  await requireRegularFile(source, `LSP upstream file ${source}`)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(source, destination)
}

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`Refusing a symbolic link in prepared LSP sources: ${absolute}`)
    if (entry.isDirectory()) files.push(...await listFiles(absolute, relative))
    else if (entry.isFile()) files.push({ absolute, relative })
    else throw new Error(`Unexpected item in prepared LSP sources: ${absolute}`)
  }
  return files
}

await requireRealDirectory(path.join(project, '.tools'), 'Project tools directory')
await requireRealDirectory(path.join(project, '.tools', 'downloads'), 'Project download cache')
await requireRealDirectory(downloads, 'LSP download cache')
await requireRealDirectory(extracted, 'LSP extraction cache')
await requireRealDirectory(path.join(project, 'vendor'), 'Project vendor directory')
await requireRealDirectory(path.join(project, 'vendor', 'audio'), 'Project audio vendor directory')
await requireRealDirectory(vendorRoot, 'LSP vendor directory')

const existingManifestPath = path.join(vendorRoot, 'manifest.json')
if (await exists(existingManifestPath)) {
  const existing = JSON.parse(await fs.readFile(existingManifestPath, 'utf8'))
  if (existing.kind !== 'rhine-lsp-eq-sources' || existing.schemaVersion !== 1 || !Array.isArray(existing.sourceFiles)) throw new Error('Existing LSP source directory has an unfamiliar manifest')
  for (const entry of existing.sourceFiles) {
    if (typeof entry.path !== 'string' || !entry.path.startsWith('vendor/audio/lsp/') || entry.path.includes('\\') || entry.path.split('/').some(part => part === '..' || part === '.')) throw new Error('Invalid LSP source manifest path')
    const file = path.resolve(project, entry.path)
    if (!file.startsWith(vendorRoot + path.sep)) throw new Error('LSP source path escapes the vendor directory')
    await requireRegularFile(file, 'Existing LSP source')
    if (await hashFile(file) !== entry.sha256) throw new Error(`LSP source was changed; refusing to overwrite ${entry.path}`)
  }
  console.log('Pinned LSP sources are already present and verified; no download or overwrite.')
  process.exit(0)
}
if ((await fs.readdir(vendorRoot)).length) throw new Error('LSP source directory is not empty and has no ownership manifest; refusing to overwrite it')
const sourceRoots = new Map()
for (const component of components) {
  const { archive } = await ensureArchive(component)
  sourceRoots.set(component.name, await ensureExtracted(component, archive))
}

const sourceFiles = []
const includeDirectories = []
for (const component of components) {
  const upstream = sourceRoots.get(component.name)
  const destination = path.join(vendorRoot, component.name)
  await requireRealDirectory(destination, `Vendored LSP component ${component.name}`)

  const includeSource = path.join(upstream, 'include')
  const includeDestination = path.join(destination, 'include')
  if (await exists(includeDestination)) await requireRealDirectory(includeDestination, `Vendored LSP headers ${component.name}`)
  else await fs.mkdir(includeDestination)
  await copyTree(includeSource, includeDestination)
  includeDirectories.push(projectPath(includeDestination))

  for (const licenseName of ['COPYING', 'COPYING.LESSER', 'README.md']) {
    const source = path.join(upstream, licenseName)
    if (await exists(source)) await copyRegularFile(source, path.join(destination, licenseName))
  }

  for (const [sourceName, relative] of buildSources.filter(([name]) => name === component.name)) {
    const source = path.join(upstream, ...relative.split('/'))
    const output = path.join(destination, ...relative.split('/'))
    await copyRegularFile(source, output)
  }
}

for (const component of components) {
  const root = path.join(vendorRoot, component.name)
  for (const file of await listFiles(root)) {
    sourceFiles.push({
      path: projectPath(path.join(root, ...file.relative.split('/'))),
      sha256: await hashFile(file.absolute),
    })
  }
}
sourceFiles.sort((a, b) => a.path.localeCompare(b.path))

const manifest = {
  schemaVersion: 1,
  kind: 'rhine-lsp-eq-sources',
  license: 'LGPL-3.0-or-later',
  components: components.map((component) => ({
    name: component.name,
    version: component.version,
    repository: component.repository,
    tag: component.version,
    commit: component.commit,
    archiveUrl: `https://codeload.github.com/lsp-plugins/${component.name}/zip/${component.commit}`,
    archiveSha256: component.archiveSha256,
    license: component.license,
  })),
  includeDirectories: includeDirectories.sort(),
  buildSources: buildSources.map(([component, relative]) => `vendor/audio/lsp/${component}/${relative}`),
  sourceFiles,
}

const manifestPath = path.join(vendorRoot, 'manifest.json')
const temporaryManifest = `${manifestPath}.${randomUUID()}.tmp`
await fs.writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await fs.rename(temporaryManifest, manifestPath)
console.log(`Prepared ${components.length} pinned LGPL LSP components and ${sourceFiles.length} source/header/license files.`)
