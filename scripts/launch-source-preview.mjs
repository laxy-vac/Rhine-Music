import path from 'node:path'
import { promises as nodeFs } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { nativeSourceManifest } from './native-source-manifest.mjs'
import { interfaceSourceManifest } from './interface-source-manifest.mjs'

// Electron's patched fs treats .asar paths as archive contents. Preflight must
// inspect the physical runtime files, including default_app.asar itself.
const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises : nodeFs

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Recognise the documented source/ layout without relocating the user's data.
const workspace = path.basename(path.dirname(project)).toLowerCase()==='source' ? path.resolve(project,'../..') : path.resolve(project,'..')
const previewDir = path.join(workspace,'music-data-source-preview')
const dataDir = path.join(previewDir, 'music-data')
const home = path.join(previewDir, 'desktop')
const runtime = path.join(project, '.tools/source-preview-electron')

try {
  const interfaceDir = await fs.access(path.join(project, '.tools/source-preview-interface/index.html')).then(() => path.join(project, '.tools/source-preview-interface'), () => path.join(project, 'dist'))
  if (interfaceDir !== path.join(project, 'dist')) {
    const buildRecord = await fs.readFile(path.join(project, '.tools/source-preview-interface.manifest.json'), 'utf8').then(JSON.parse)
    if (buildRecord.state !== 'ready') throw new Error('调试界面尚未完成构建，请先运行构建源码验证.cmd。')
    if(JSON.stringify(buildRecord.sourceFiles)!==JSON.stringify(await interfaceSourceManifest(project)))throw new Error('界面源码已变化，请先运行构建源码验证.cmd，再启动应用。')
  }
  await fs.access(path.join(interfaceDir, 'index.html'))
  const nativeDir = path.join(project, '.tools/source-preview-native-audio')
  if (await fs.access(path.join(nativeDir, 'rhine-audio-host.exe')).then(() => true, () => false)) {
    const nativeRecord = await fs.readFile(path.join(nativeDir, 'assets.json'), 'utf8').then(JSON.parse)
    if (nativeRecord.kind !== 'rhine-source-preview-native-audio') throw new Error('原生调试构建来源不明，请先运行构建源码验证.cmd。')
    const {sourceFiles}=await nativeSourceManifest(project)
    for (const [name,digest] of Object.entries(sourceFiles)) {
      if (nativeRecord.sourceFiles?.[name] !== digest) throw new Error('原生源码已变化，请先运行构建源码验证.cmd，再启动应用。')
    }
  }
  await fs.access(path.join(project, 'desktop/package.json'))
  await fs.access(path.join(runtime, 'electron.exe')).catch(() => { throw new Error('桌面调试运行时尚未准备。请先运行已获准的 scripts/prepare-source-preview-runtime.ps1；启动器不会自动安装或下载。') })
  await fs.access(path.join(runtime, 'resources/default_app.asar'))
  for (const name of ['app', 'app.asar', 'app.asar.unpacked']) {
    if (await fs.access(path.join(runtime, 'resources', name)).then(() => true, () => false)) throw new Error('调试运行时混入旧应用，不能用于验证当前源码。请按项目说明处理，不要启动旧副本。')
  }
  await fs.mkdir(home, { recursive: true })
  const python = path.join(project, 'release/.desktop-staging/resources/app/runtime/python/python.exe')
  const env = { ...process.env, RHINE_SOURCE_PREVIEW: '1', RHINE_APP_HOME: home, MUSIC_DATA_DIR: dataDir, MUSIC_ROOTS: '', RHINE_SOURCE_INTERFACE: interfaceDir, ELECTRON_ENABLE_STACK_DUMPING: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  if (await fs.access(python).then(() => true, () => false)) env.SONY_WALKMAN_PYTHON = python
  console.log('正在打开桌面源码验证窗口…')
  console.log(`音乐库索引：${dataDir}`)
  console.log(`调试界面：${interfaceDir}`)
  console.log('关闭应用窗口即可停止它拥有的服务和音频进程；改完代码后重新启动。')
  const code = await new Promise((resolve, reject) => {
    const child = spawn(path.join(runtime, 'electron.exe'), [path.join(project, 'desktop'), ...process.argv.slice(2)], { cwd: project, env, stdio: 'inherit', windowsHide: false })
    child.once('error', reject)
    child.once('close', resolve)
  })
  if (code !== 0) {
    const nativeCode = Number.isInteger(code) ? `（0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}）` : ''
    throw new Error(`桌面应用退出码：${code}${nativeCode}`)
  }
} catch (error) {
  console.error(`源码验证启动失败：${error.message}`)
  process.exitCode = 1
}
