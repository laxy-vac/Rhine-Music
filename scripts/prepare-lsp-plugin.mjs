import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'

const execFileAsync = promisify(execFile)
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorRoot = path.join(project, 'vendor', 'audio', 'lsp-plugin')
const downloadRoot = path.join(project, '.tools', 'downloads', 'lsp-plugin')
const toolchainManifestPath = path.join(project, '.tools', 'lsp-plugin', 'toolchain-manifest.json')
const scriptOptions = new Set(process.argv.slice(2))
for (const option of scriptOptions) {
  if (option !== '--tools' && option !== '--help')
    throw new Error('Unknown option: ' + option)
}
if (scriptOptions.has('--help')) {
  console.log('Usage: node scripts/prepare-lsp-plugin.mjs [--tools]')
  console.log('--tools downloads pinned MSYS2 inputs and installs only local make/binutils packages into project .tools.')
  process.exit(0)
}

const components = [
  {
    name: 'lsp-plugins',
    version: '1.2.35',
    repository: 'https://github.com/lsp-plugins/lsp-plugins',
    commit: '2df6eea03604109eeb29f8c62a3b80ce4836d1b7',
    archiveSha256: '34bf97775fe3275caf0826ad8fb2025df859fe94ae7249185be84cfbc6da325c',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-plugins-1.2.35-2df6eea0.zip',
    license: 'LGPL-3.0-or-later',
    purpose: 'Aggregate release pin used to resolve the matching official module versions.',
    buildRequired: false,
  },
  {
    name: 'lsp-plugins-para-equalizer',
    version: '1.0.40',
    repository: 'https://github.com/lsp-plugins/lsp-plugins-para-equalizer',
    commit: '8e256db4e77154c9cecb207ebf769a3e1e49f878',
    archiveSha256: 'ba984647a9950baa7edac76c4e2c02d4242b259359a8f57993192afd29680762',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-plugins-para-equalizer-1.0.40-8e256db4.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-plugin-fw',
    version: '1.0.40',
    repository: 'https://github.com/lsp-plugins/lsp-plugin-fw',
    commit: '45f2e23ba809c9661a425484db37367239f57556',
    archiveSha256: '5f9f54295d200c9f0a4e089e9d39152afa4aaa2404f275f42203e065761ed417',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-plugin-fw-1.0.40-45f2e23b.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-plugins-shared',
    version: '1.0.39',
    repository: 'https://github.com/lsp-plugins/lsp-plugins-shared',
    commit: 'a8017348d540774abe23b23812c0897bbded76d9',
    archiveSha256: '6c72dcb70d72e3bc91cb75f1c85e49e4857a73830af08e7c0c2d01aa073058bc',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-plugins-shared-1.0.39-a8017348.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-3rd-party',
    version: '1.0.30',
    repository: 'https://github.com/lsp-plugins/lsp-3rd-party',
    commit: 'c907b32116e912a5f7fb428dd35d59329f92645e',
    archiveSha256: 'd1eed53720712b80a7702bfda82dce24eeac291b55cb542feac043a64eaace98',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-3rd-party-1.0.30-c907b321.zip',
    license: 'Mixed third-party notices; the CLAP API headers are MIT.',
    buildRequired: true,
  },
  {
    name: 'lsp-audio-iface',
    version: '1.0.2',
    repository: 'https://github.com/lsp-plugins/lsp-audio-iface',
    commit: '5dcfc494eb4ab29286d6233b4b01287765227f9c',
    archiveSha256: 'dc6d35315e783319c5f3b6e5884c41507e627c2edb0e396b884a2cedc55d9f91',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-audio-iface-1.0.2-5dcfc494.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-common-lib',
    version: '1.0.49',
    repository: 'https://github.com/lsp-plugins/lsp-common-lib',
    commit: '072e4ad8c495ee19f8dda1a94d5c09c2ce78525f',
    archiveSha256: 'b8c78f34c415e6da84b30d011f58d59d7e65896466c8ce58c2635f9e6f4361dc',
    archiveFile: '.tools/downloads/lsp/lsp-common-lib-072e4ad8c495.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-dsp-lib',
    version: '1.1.1',
    repository: 'https://github.com/lsp-plugins/lsp-dsp-lib',
    commit: '2f93492a3af9532c364b6d426cca9a1a7d5fe0f3',
    archiveSha256: '829d6835852fa23726df36a5671a5799b08279b3c5f3a8c703460ed37561d80e',
    archiveFile: '.tools/downloads/lsp/lsp-dsp-lib-2f93492a3af9.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-dsp-units',
    version: '1.0.38',
    repository: 'https://github.com/lsp-plugins/lsp-dsp-units',
    commit: '186be049af15d9678d80c8b3dee67817e4487535',
    archiveSha256: 'dd352dd1d0e94fbcb3d41498abeab3d0cf73e141a45932896d69915e72fc93a3',
    archiveFile: '.tools/downloads/lsp/lsp-dsp-units-186be049af15.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-lltl-lib',
    version: '1.0.33',
    repository: 'https://github.com/lsp-plugins/lsp-lltl-lib',
    commit: '64a0f36cb2cd42cd2952ed123f51518fcde9eb87',
    archiveSha256: '803d6a66feb8210bd0308669351590e5ec0d1010a8b6e73b17df70b75f0a280a',
    archiveFile: '.tools/downloads/lsp/lsp-lltl-lib-64a0f36cb2cd.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-runtime-lib',
    version: '1.0.36',
    repository: 'https://github.com/lsp-plugins/lsp-runtime-lib',
    commit: '52d887e515a59a3839db15d6d8536b1e0df46de0',
    archiveSha256: '0ffba1657bb08d93d47f01437ec48bb9d7cd0ac64606d9f502c27212ff412dfa',
    archiveFile: '.tools/downloads/lsp/lsp-runtime-lib-52d887e515a5.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-r3d-base-lib',
    version: '1.0.31',
    repository: 'https://github.com/lsp-plugins/lsp-r3d-base-lib',
    commit: '9e3d26cc34ab12f1e6f31d4d4eced07105540233',
    archiveSha256: '877ff61ab0b5e27c7a1acf895b5b39c0d895463d4ca360232bd7afc66df7eb94',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-r3d-base-lib-1.0.31-9e3d26cc.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-r3d-iface',
    version: '1.0.31',
    repository: 'https://github.com/lsp-plugins/lsp-r3d-iface',
    commit: 'f74d538cfad084136055b377d6e7957f72099519',
    archiveSha256: 'b3cfd8f895cd9a53b464802fc6e90b60e301c860dd429d79f5efa47f60a24cb9',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-r3d-iface-1.0.31-f74d538c.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-r3d-wgl-lib',
    version: '1.0.26',
    repository: 'https://github.com/lsp-plugins/lsp-r3d-wgl-lib',
    commit: '679f7cee7be16108e9488650c1f00a59ce54cce1',
    archiveSha256: '6925ad7bf4ccb158062d80246404b697973c5c757f49bbee595aef1c48f61af6',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-r3d-wgl-lib-1.0.26-679f7cee.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-tk-lib',
    version: '1.0.36',
    repository: 'https://github.com/lsp-plugins/lsp-tk-lib',
    commit: 'b4ac68d956adf86693565f39f6866e09951639c5',
    archiveSha256: '4a3e94aa411e5f167113e70ec51c6c879cf95bf97b2962e2ec49f7c3a2308d1a',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-tk-lib-1.0.36-b4ac68d9.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'lsp-ws-lib',
    version: '1.0.36',
    repository: 'https://github.com/lsp-plugins/lsp-ws-lib',
    commit: '8fc27535bac204b81a2d760336739d35723dfe37',
    archiveSha256: 'f4553a6ecf73913ae6af78592c5230b3cf794ac40587724753670e03ec5eb930',
    archiveFile: '.tools/downloads/lsp-plugin/lsp-ws-lib-1.0.36-8fc27535.zip',
    license: 'LGPL-3.0-or-later',
    buildRequired: true,
  },
  {
    name: 'clap',
    version: '1.2.6',
    repository: 'https://github.com/free-audio/clap',
    commit: '69a69252fdd6ac1d06e246d9a04c0a89d9607a17',
    archiveSha256: 'f745e673b98a7935514c57f13c0b762587eff152e4c76543ceb8b56d24f3e697',
    archiveFile: '.tools/downloads/lsp-plugin/clap-1.2.6-69a69252.zip',
    license: 'MIT',
    buildRequired: false,
  },
]

const plugin = {
  name: 'LSP Parametric Equalizer x32 Stereo',
  version: '1.0.40',
  clapPluginId: 'in.lsp-plug.para_equalizer_x32_stereo',
  variant: 'para_equalizer_x32_stereo',
  format: 'CLAP',
  architecture: 'windows-x64',
  gui: 'upstream LSP plug-in framework UI',
  features: ['clap', 'ui'],
  parameterMetadata: 'Provided by the upstream CLAP params extension at runtime.',
}

const licenseNotes =
  '# Third-party licenses\n\n' +
  'The LSP Parametric Equalizer, framework, DSP libraries, toolkit, and Windows graphics modules are pinned in manifest.json and are licensed under LGPL-3.0-or-later. The full GNU license texts are in COPYING and COPYING.LESSER.\n\n' +
  'The CLAP API headers are pinned to free-audio/clap 1.2.6. Their MIT license is included at clap/include/clap/LICENSE. The LSP third-party source archive contains other upstream notices; its exact archive is recorded in manifest.json.\n'

const toolchainPackages = [
  {
    name: 'base-devel',
    version: '2026.08-3',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/base-devel-2026.08-3-any.pkg.tar.zst',
    sha256: 'bc0523681d41a3d2543da02dc73fbf6772d5a6bd918145aba3d212021844b935',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/base-devel-2026.08-3-any.pkg.tar.zst',
    reason: 'Observed in the already-prepared MSYS2 base-devel group; the repeatable bootstrap does not install this meta-package.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'binutils',
    version: '2.47-1',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/binutils-2.47-1-x86_64.pkg.tar.zst',
    downloadFile: '.tools/downloads/lsp-plugin/binutils-2.47-1-x86_64.pkg.tar.zst',
    sha256: 'b7ddaca6e8b63774cdb1f5ac2720963cd76f8f62ca7e2667b1b0f008ed7ecba2',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/binutils-2.47-1-x86_64.pkg.tar.zst',
    reason: 'Provides GNU ld for upstream partial Windows COFF object merging (-r); Zig remains the only C/C++ compiler.',
    directlyUsed: true,
    bootstrapRequired: true,
  },
  {
    name: 'bison',
    version: '3.8.2-5',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/bison-3.8.2-5-x86_64.pkg.tar.zst',
    sha256: '7439ca784a9909e0730a513d3aff15852c3b292ac85053fa2dd7a2a19c1ce04c',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/bison-3.8.2-5-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; not directly required by the CLAP/UI feature set.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'diffutils',
    version: '3.12-1',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/diffutils-3.12-1-x86_64.pkg.tar.zst',
    sha256: '7902c8ce3d4dd69a0f5e98dc9d5c83c17b23314ba486169db57ef6e2835ce3b6',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/diffutils-3.12-1-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; available to upstream Make scripts.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'dos2unix',
    version: '7.5.7-1',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/dos2unix-7.5.7-1-x86_64.pkg.tar.zst',
    sha256: '320ae1d9de56fcd51e18c541effe710bb1237998cdf6d189cae857b463c86fb7',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/dos2unix-7.5.7-1-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; not directly required by the CLAP/UI feature set.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'flex',
    version: '2.6.4-4',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/flex-2.6.4-4-x86_64.pkg.tar.zst',
    sha256: 'd70fbf25d0dea3cb8ae42670b79a8ba65a48daa140137367b5ebaf37eb48df26',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/flex-2.6.4-4-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; not directly required by the CLAP/UI feature set.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'm4',
    version: '1.4.21-1',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/m4-1.4.21-1-x86_64.pkg.tar.zst',
    sha256: 'b561e8871c7599502d9fae7196ee965b3fed3d7af09154eb8d2f5e4d9e5e5106',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/m4-1.4.21-1-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; not directly required by the CLAP/UI feature set.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
  {
    name: 'make',
    version: '4.4.1-3',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/make-4.4.1-3-x86_64.pkg.tar.zst',
    downloadFile: '.tools/downloads/lsp-plugin/make-4.4.1-3-x86_64.pkg.tar.zst',
    sha256: 'af0bdba17f06fe037f0194069adaa31a8fe45f1a11381501896aea1fae37bd5d',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/make-4.4.1-3-x86_64.pkg.tar.zst',
    reason: 'Runs the upstream LSP build system.',
    directlyUsed: true,
    bootstrapRequired: true,
  },
  {
    name: 'patch',
    version: '2.8-2',
    archiveFile: '.tools/lsp-plugin/toolchain/msys64/var/cache/pacman/pkg/patch-2.8-2-x86_64.pkg.tar.zst',
    sha256: 'df34ebf345d607cabf0b2cbad60f562f775f07985647b84035b40702f62ee9b1',
    sourceUrl: 'https://mirror.msys2.org/msys/x86_64/patch-2.8-2-x86_64.pkg.tar.zst',
    reason: 'Installed as a base-devel group member; not directly required by the CLAP/UI feature set.',
    directlyUsed: false,
    bootstrapRequired: false,
  },
]

const toolchainManifest = {
  schemaVersion: 1,
  kind: 'rhine-lsp-plugin-toolchain',
  target: 'windows-x64',
  scope: 'Project-local .tools only; no global PATH or environment changes.',
  msys2Base: {
    version: '2026-09-27',
    sourceUrl: 'https://github.com/msys2/msys2-installer/releases/download/2026-09-27/msys2-base-x86_64-20260927.tar.xz',
    archivePath: '.tools/downloads/lsp-plugin/msys2-base-x86_64-20260927.tar.xz',
    archiveSha256: 'ea2f31a0b6ade63914ce441ffb022f0f6aa96982bfefa2326460a26d5fb01322',
    extractedPath: '.tools/lsp-plugin/toolchain/msys64',
    processEnvironment: {
      MSYSTEM: 'MINGW64',
      MSYS2_PATH_TYPE: 'inherit',
      PATH: 'Scoped to the build child process.',
    },
  },
  compiler: {
    name: 'Zig',
    version: '0.15.2',
    path: '.tools/walkman/compiler/zig-x86_64-windows-0.15.2/zig.exe',
    sha256: 'd408dd38eed3e5204af841bcebf70502a4dbbb8399a3a3262be55059370bc018',
    reusedExistingProjectTool: true,
  },
  linker: {
    name: 'GNU ld',
    package: 'binutils',
    version: '2.47-1',
    path: '.tools/lsp-plugin/toolchain/msys64/usr/bin/ld.exe',
    purpose: 'Upstream Windows partial COFF object merge with -r; Zig remains the only C/C++ compiler and final linker.',
  },
  assembler: {
    name: 'GNU as',
    package: 'binutils',
    version: '2.47-1',
    path: '.tools/lsp-plugin/toolchain/msys64/usr/bin/as.exe',
    attemptedForSse2: true,
    releaseBuildUsesIt: false,
    result: 'Clang-generated Windows COFF/CodeView assembly was rejected, including with -g0 and without function/data sections; no MinGW-specific assembler was added.',
  },
  bootstrapPlan: {
    mode: 'Explicit --tools only; ordinary preparation/build never installs tools.',
    packages: ['binutils', 'make'],
    packageManager: 'pacman -U --noconfirm using pinned local package archives only',
    packageSyncOrLatestResolution: false,
    packageGroupInstallation: false,
    scope: 'Project-local .tools/lsp-plugin/toolchain/msys64 only.',
  },
  packages: toolchainPackages.filter((entry) => entry.bootstrapRequired).map((entry) => ({
    name: entry.name,
    version: entry.version,
    archiveFile: entry.downloadFile,
    sha256: entry.sha256,
    sourceUrl: entry.sourceUrl,
    reason: entry.reason,
    directlyUsed: entry.directlyUsed,
  })),
  observedInstalledPackages: [],
  observedBaseDevelGroup: {
    existedInThisProjectToolchain: true,
    members: 'Recorded dynamically from pacman -Q; unused members are reported but the --tools bootstrap does not install the group.',
  },
  php: {
    installed: false,
    reason: 'The documentation feature is disabled; the CLAP/UI build does not generate manuals.',
  },
}

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

function requireProjectPath(absolute, label) {
  const resolved = path.resolve(absolute)
  if (resolved !== project && !resolved.startsWith(project + path.sep))
    throw new Error(label + ' escapes the project directory')
  return resolved
}

async function ensureRealDirectory(directory, label) {
  const resolved = requireProjectPath(directory, label)
  if (await exists(resolved)) {
    const info = await fs.lstat(resolved)
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(label + ' must be a real directory: ' + resolved)
  } else {
    await fs.mkdir(resolved, { recursive: true })
  }
}

async function requireRegularFile(file, label) {
  const info = await fs.lstat(file)
  if (info.isSymbolicLink() || !info.isFile())
    throw new Error(label + ' must be a regular file: ' + file)
}

async function runCurl(args) {
  await execFileAsync('curl.exe', args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
}

function archiveUrl(component) {
  const owner = component.repository.endsWith('/clap') ? 'free-audio' : 'lsp-plugins'
  return 'https://codeload.github.com/' + owner + '/' + component.name + '/zip/' + component.commit
}

async function ensureArchive(component) {
  const archive = requireProjectPath(path.resolve(project, ...component.archiveFile.split('/')), 'Source archive path')
  await ensureRealDirectory(path.dirname(archive), 'Source archive directory')
  if (await exists(archive)) {
    await requireRegularFile(archive, 'Pinned source archive ' + component.name)
    const actual = await hashFile(archive)
    if (actual !== component.archiveSha256)
      throw new Error('Source archive SHA-256 mismatch for ' + component.name + ': ' + actual)
    return archive
  }

  const staging = archive + '.' + randomUUID() + '.part'
  try {
    await runCurl(['-L', '--fail', '--silent', '--show-error', '--output', staging, archiveUrl(component)])
    await requireRegularFile(staging, 'Downloaded source archive ' + component.name)
    const actual = await hashFile(staging)
    if (actual !== component.archiveSha256)
      throw new Error('Downloaded source archive SHA-256 mismatch for ' + component.name + ': ' + actual)
    await fs.rename(staging, archive)
  } catch (error) {
    if (await exists(staging)) await fs.unlink(staging)
    throw error
  }
  return archive
}

async function ensurePinnedDownload(url, relativeFile, sha256, label) {
  const destination = requireProjectPath(path.resolve(project, ...relativeFile.split('/')), label + ' path')
  await ensureRealDirectory(path.dirname(destination), label + ' directory')
  if (await exists(destination)) {
    await requireRegularFile(destination, label)
    const actual = await hashFile(destination)
    if (actual !== sha256) throw new Error(label + ' SHA-256 mismatch: ' + actual)
    return destination
  }

  const staging = destination + '.' + randomUUID() + '.part'
  try {
    await runCurl(['-L', '--fail', '--silent', '--show-error', '--output', staging, url])
    await requireRegularFile(staging, label + ' download')
    const actual = await hashFile(staging)
    if (actual !== sha256) throw new Error(label + ' downloaded SHA-256 mismatch: ' + actual)
    await fs.rename(staging, destination)
  } catch (error) {
    if (await exists(staging)) await fs.unlink(staging)
    throw error
  }
  return destination
}

async function readArchiveMember(archive, component, member) {
  const top = component.name + '-' + component.commit
  const { stdout } = await execFileAsync(
    'tar.exe',
    ['-xOf', archive, top + '/' + member],
    { windowsHide: true, encoding: 'buffer', maxBuffer: 2 * 1024 * 1024 },
  )
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
}

async function writeOrVerifyFile(file, contents, label) {
  await ensureRealDirectory(path.dirname(file), label + ' directory')
  if (await exists(file)) {
    await requireRegularFile(file, label)
    const current = await fs.readFile(file)
    if (!current.equals(contents))
      throw new Error(label + ' already exists with different contents; refusing to overwrite it')
    return
  }
  await fs.writeFile(file, contents)
}

function toMsysPath(absolute) {
  const normalized = path.resolve(absolute).replace(/\\/g, '/')
  const drive = normalized.match(/^([A-Za-z]):\//)
  if (!drive) throw new Error('Expected a drive-qualified path: ' + absolute)
  return '/' + drive[1].toLowerCase() + normalized.slice(2)
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

async function runLocalPacman(script) {
  const msysRoot = path.join(project, '.tools', 'lsp-plugin', 'toolchain', 'msys64')
  const bash = path.join(msysRoot, 'usr', 'bin', 'bash.exe')
  const pacman = path.join(msysRoot, 'usr', 'bin', 'pacman.exe')
  await requireRegularFile(bash, 'Project-local MSYS2 bash')
  await requireRegularFile(pacman, 'Project-local MSYS2 pacman')
  const env = { ...process.env }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = [path.join(msysRoot, 'usr', 'bin'), env[pathKey] ?? ''].join(path.delimiter)
  env.MSYSTEM = 'MSYS'
  env.MSYS2_PATH_TYPE = 'inherit'
  env.CHERE_INVOKING = '1'
  env.HOME = path.join(msysRoot, 'home', 'rhine')
  env.TMP = path.join(project, '.tools', 'lsp-plugin', 'cache', 'tmp')
  env.TEMP = env.TMP
  await ensureRealDirectory(env.HOME, 'Project-local MSYS2 home')
  await ensureRealDirectory(env.TMP, 'Project-local MSYS2 temporary directory')
  return await execFileAsync(bash, ['--noprofile', '--norc', '-lc', script], {
    cwd: project,
    env,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  })
}

async function ensurePinnedToolchainDownloads() {
  const base = toolchainManifest.msys2Base
  await ensurePinnedDownload(base.sourceUrl, base.archivePath, base.archiveSha256, 'Pinned MSYS2 base archive')
  const required = toolchainPackages.filter((entry) => entry.bootstrapRequired)
  for (const entry of required)
    await ensurePinnedDownload(entry.sourceUrl, entry.downloadFile, entry.sha256, 'Pinned MSYS2 package ' + entry.name)
}

async function prepareProjectToolchain() {
  const toolchainParent = path.join(project, '.tools', 'lsp-plugin', 'toolchain')
  const msysRoot = path.join(toolchainParent, 'msys64')
  const base = toolchainManifest.msys2Base
  await ensurePinnedToolchainDownloads()
  await ensureRealDirectory(toolchainParent, 'Project-local toolchain directory')
  if (!await exists(msysRoot)) {
    const archive = path.resolve(project, ...base.archivePath.split('/'))
    await execFileAsync('tar.exe', ['-xf', archive, '-C', toolchainParent], {
      cwd: project,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    })
  }
  const bash = path.join(msysRoot, 'usr', 'bin', 'bash.exe')
  const pacman = path.join(msysRoot, 'usr', 'bin', 'pacman.exe')
  await requireRegularFile(bash, 'Extracted project-local MSYS2 bash')
  await requireRegularFile(pacman, 'Extracted project-local MSYS2 pacman')

  const listed = await runLocalPacman('pacman -Q')
  const installed = new Map()
  for (const line of listed.stdout.trim().split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+(.+)$/)
    if (match) installed.set(match[1], match[2])
  }
  const required = toolchainPackages.filter((entry) => entry.bootstrapRequired)
  const missing = []
  for (const entry of required) {
    const current = installed.get(entry.name)
    if (current && current !== entry.version)
      throw new Error('Project-local ' + entry.name + ' version is ' + current + '; refusing to upgrade or downgrade it to pinned ' + entry.version)
    if (!current) missing.push(entry)
  }

  if (missing.length) {
    const files = missing.map((entry) => toMsysPath(path.resolve(project, ...entry.downloadFile.split('/'))))
    const command = 'pacman -U --noconfirm ' + files.map(shellQuote).join(' ')
    await runLocalPacman(command)
  }

  const confirmed = await runLocalPacman('pacman -Q')
  const finalInstalled = new Map()
  for (const line of confirmed.stdout.trim().split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+(.+)$/)
    if (match) finalInstalled.set(match[1], match[2])
  }
  for (const entry of required) {
    if (finalInstalled.get(entry.name) !== entry.version)
      throw new Error('Pinned project-local package did not install as expected: ' + entry.name)
  }
  return finalInstalled
}

async function observedToolchainPackages() {
  const msysRoot = path.join(project, '.tools', 'lsp-plugin', 'toolchain', 'msys64')
  const bash = path.join(msysRoot, 'usr', 'bin', 'bash.exe')
  if (!await exists(bash)) return new Map()
  const listed = await runLocalPacman('pacman -Q')
  const installed = new Map()
  for (const line of listed.stdout.trim().split(/\r?\n/)) {
    const match = line.match(/^([^\s]+)\s+(.+)$/)
    if (match) installed.set(match[1], match[2])
  }
  return installed
}

async function writeToolchainManifest(installed) {
  const records = []
  for (const entry of toolchainPackages) {
    const version = installed.get(entry.name)
    if (!version) continue
    records.push({
      name: entry.name,
      version,
      pinnedVersion: entry.version,
      pinnedArchiveSha256: version === entry.version ? entry.sha256 : null,
      sourceUrl: entry.sourceUrl,
      installedVia: entry.name === 'base-devel' ? 'Existing MSYS2 base-devel group' : 'Project-local MSYS2 package database',
      directlyUsed: entry.directlyUsed,
      bootstrapRequired: entry.bootstrapRequired,
      purpose: entry.reason,
    })
  }
  toolchainManifest.observedInstalledPackages = records
  toolchainManifest.observedBaseDevelGroup.installed = installed.has('base-devel')
  const contents = Buffer.from(JSON.stringify(toolchainManifest, null, 2) + '\n', 'utf8')
  if (await exists(toolchainManifestPath)) {
    await requireRegularFile(toolchainManifestPath, 'Existing project-local LSP toolchain manifest')
    const current = JSON.parse(await fs.readFile(toolchainManifestPath, 'utf8'))
    if (current.schemaVersion !== 1 || current.kind !== 'rhine-lsp-plugin-toolchain' || current.target !== 'windows-x64')
      throw new Error('Existing LSP toolchain manifest is unfamiliar; refusing to replace it')
    if (!(await fs.readFile(toolchainManifestPath)).equals(contents)) {
      const temporary = toolchainManifestPath + '.' + randomUUID() + '.tmp'
      await fs.writeFile(temporary, contents, { flag: 'wx' })
      await fs.rename(temporary, toolchainManifestPath)
    }
  } else {
    await ensureRealDirectory(path.dirname(toolchainManifestPath), 'Toolchain manifest directory')
    await fs.writeFile(toolchainManifestPath, contents, { flag: 'wx' })
  }
}

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + '/' + entry.name : entry.name
    const absolute = path.join(directory, entry.name)
    if (entry.isSymbolicLink())
      throw new Error('Refusing a symbolic link in prepared LSP files: ' + absolute)
    if (entry.isDirectory())
      files.push(...await listFiles(absolute, relative))
    else if (entry.isFile())
      files.push({ absolute, relative })
    else
      throw new Error('Unexpected item in prepared LSP files: ' + absolute)
  }
  return files
}

async function verifyExistingManifest(manifestPath, expectedComponents) {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.kind !== 'rhine-lsp-plugin-sources')
    throw new Error('Existing LSP plug-in source manifest has an unfamiliar layout')
  if (JSON.stringify(manifest.components) !== JSON.stringify(expectedComponents))
    throw new Error('Existing LSP plug-in source pins differ from this prepare script')
  if (JSON.stringify(manifest.plugin) !== JSON.stringify(plugin))
    throw new Error('Existing LSP plug-in identity differs from this prepare script')
  if (!Array.isArray(manifest.sourceFiles))
    throw new Error('Existing LSP plug-in source manifest has no sourceFiles list')

  const expected = []
  for (const entry of manifest.sourceFiles) {
    if (typeof entry.path !== 'string' ||
        !entry.path.startsWith('vendor/audio/lsp-plugin/') ||
        entry.path.includes('\\') ||
        entry.path.split('/').some((part) => part === '..' || part === '.'))
      throw new Error('Invalid LSP plug-in source manifest path')
    const absolute = requireProjectPath(path.resolve(project, ...entry.path.split('/')), 'Source manifest path')
    if (!absolute.startsWith(vendorRoot + path.sep))
      throw new Error('LSP plug-in source path escapes vendor/audio/lsp-plugin')
    await requireRegularFile(absolute, 'Vendored LSP plug-in source ' + entry.path)
    const actual = await hashFile(absolute)
    if (actual !== entry.sha256)
      throw new Error('Vendored LSP plug-in source changed: ' + entry.path)
    expected.push(entry.path)
  }

  const actualFiles = (await listFiles(vendorRoot))
    .map((entry) => projectPath(path.join(vendorRoot, ...entry.relative.split('/'))))
    .filter((entry) => entry !== 'vendor/audio/lsp-plugin/manifest.json')
    .sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(expected.slice().sort()))
    throw new Error('Vendor source directory contains missing or unmanifested files')
  return manifest
}

for (const component of components) {
  const absolute = await ensureArchive(component)
  console.log('Verified ' + component.name + ' ' + component.version + ' archive (' + component.archiveSha256 + ').')
  component.archiveUrl = archiveUrl(component)
  component.localArchive = projectPath(absolute)
}

const installedToolchainPackages = scriptOptions.has('--tools')
  ? await prepareProjectToolchain()
  : await observedToolchainPackages()
for (const entry of toolchainPackages.filter((item) => item.bootstrapRequired)) {
  const archive = requireProjectPath(path.resolve(project, ...entry.downloadFile.split('/')), 'Pinned toolchain download')
  if (await exists(archive)) {
    await requireRegularFile(archive, 'Pinned project-local toolchain package ' + entry.name)
    if (await hashFile(archive) !== entry.sha256)
      throw new Error('Toolchain package SHA-256 mismatch for ' + entry.name)
  }
}
const msys2BaseArchive = path.resolve(project, ...toolchainManifest.msys2Base.archivePath.split('/'))
if (await exists(msys2BaseArchive)) {
  await requireRegularFile(msys2BaseArchive, 'Project-local MSYS2 base archive')
  if (await hashFile(msys2BaseArchive) !== toolchainManifest.msys2Base.archiveSha256)
    throw new Error('Project-local MSYS2 base archive hash mismatch')
}
const zigCompiler = path.resolve(project, ...toolchainManifest.compiler.path.split('/'))
await requireRegularFile(zigCompiler, 'Existing project Zig compiler')
if (await hashFile(zigCompiler) !== toolchainManifest.compiler.sha256)
  throw new Error('Existing project Zig compiler hash mismatch')
await writeToolchainManifest(installedToolchainPackages)

const expectedComponents = components.map((component) => ({
  name: component.name,
  version: component.version,
  repository: component.repository,
  tag: component.version,
  commit: component.commit,
  archiveUrl: component.archiveUrl,
  archiveSha256: component.archiveSha256,
  localArchive: component.localArchive,
  license: component.license,
  buildRequired: component.buildRequired,
}))

await ensureRealDirectory(vendorRoot, 'LSP plug-in vendor directory')
const manifestPath = path.join(vendorRoot, 'manifest.json')
if (await exists(manifestPath)) {
  const manifest = await verifyExistingManifest(manifestPath, expectedComponents)
  console.log('Pinned LSP plug-in sources are already present and verified.')
  console.log('CLAP ID: ' + manifest.plugin.clapPluginId)
  process.exit(0)
}

const clapComponent = components.find((component) => component.name === 'clap')
const clapArchive = path.resolve(project, ...clapComponent.localArchive.split('/'))
const clapSourceLicense = await readArchiveMember(clapArchive, clapComponent, 'LICENSE')
const clapLicensePath = path.join(vendorRoot, 'clap', 'include', 'clap', 'LICENSE')
if (!await exists(clapLicensePath))
  throw new Error('Pinned CLAP license is missing from vendor/audio/lsp-plugin/clap/include/clap/LICENSE')
await requireRegularFile(clapLicensePath, 'Vendored CLAP MIT license')
if (!clapLicensePath || !(await fs.readFile(clapLicensePath)).equals(clapSourceLicense))
  throw new Error('Vendored CLAP license differs from the pinned official CLAP 1.2.6 archive')

const equalizer = components.find((component) => component.name === 'lsp-plugins-para-equalizer')
const equalizerArchive = path.resolve(project, ...equalizer.localArchive.split('/'))
const copying = await readArchiveMember(equalizerArchive, equalizer, 'COPYING')
const copyingLesser = await readArchiveMember(equalizerArchive, equalizer, 'COPYING.LESSER')
await writeOrVerifyFile(path.join(vendorRoot, 'COPYING'), copying, 'LSP GPL license text')
await writeOrVerifyFile(path.join(vendorRoot, 'COPYING.LESSER'), copyingLesser, 'LSP LGPL license text')
await writeOrVerifyFile(path.join(vendorRoot, 'LICENSES.md'), Buffer.from(licenseNotes, 'utf8'), 'LSP plug-in license notes')

const sourceFiles = []
for (const file of await listFiles(vendorRoot)) {
  if (file.relative === 'manifest.json') continue
  sourceFiles.push({
    path: projectPath(path.join(vendorRoot, ...file.relative.split('/'))),
    sha256: await hashFile(file.absolute),
  })
}
sourceFiles.sort((a, b) => a.path.localeCompare(b.path))

const manifest = {
  schemaVersion: 1,
  kind: 'rhine-lsp-plugin-sources',
  upstreamRelease: {
    name: 'LSP Plugins',
    version: '1.2.35',
    repository: 'https://github.com/lsp-plugins/lsp-plugins',
    commit: '2df6eea03604109eeb29f8c62a3b80ce4836d1b7',
  },
  plugin,
  license: 'LGPL-3.0-or-later for LSP code; MIT for CLAP API headers.',
  components: expectedComponents,
  sourceFiles,
}

const stagedManifest = manifestPath + '.' + randomUUID() + '.tmp'
await fs.writeFile(stagedManifest, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
if (await exists(manifestPath)) {
  await fs.unlink(stagedManifest)
  throw new Error('LSP plug-in manifest appeared during preparation; refusing to replace it')
}
await fs.rename(stagedManifest, manifestPath)
console.log('Prepared ' + expectedComponents.length + ' pinned upstream source archives.')
console.log('Recorded ' + sourceFiles.length + ' vendored header/license files.')
console.log('CLAP ID: ' + plugin.clapPluginId)
