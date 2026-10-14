import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { promises as nodeFs } from 'node:fs'
import { spawn } from 'node:child_process'
import { build } from 'vite'
import { interfaceSourceManifest } from './interface-source-manifest.mjs'

const fs = process.versions.electron ? createRequire(import.meta.url)('original-fs').promises : nodeFs
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(project, '.tools/source-preview-interface')
const marker = path.join(project, '.tools/source-preview-interface.manifest.json')
for (const directory of [path.join(project, '.tools'), output]) {
  const entry = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error })
  if (entry?.isSymbolicLink()) throw new Error('调试构建目录不能使用链接或目录联接。')
}
if (await fs.access(output).then(() => true, () => false)) {
  const previous = await fs.readFile(marker, 'utf8').then(JSON.parse).catch(() => null)
  if (previous?.kind !== 'rhine-source-preview-interface') throw new Error('输出目录已有来源不明的内容，未覆盖或清理。')
}
if(!process.argv.includes('--interface-only'))await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(project, 'scripts/build-native-audio.mjs'), '--source-preview'], { cwd: project, stdio: 'inherit', windowsHide: true })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`原生音频调试构建失败：${code}`)))
})
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(project, 'node_modules/typescript/bin/tsc')], { cwd: project, stdio: 'inherit', windowsHide: true })
  child.once('error', reject)
  child.once('close', code => code === 0 ? resolve() : reject(new Error(`TypeScript 检查失败：${code}`)))
})
await fs.mkdir(path.dirname(output), { recursive: true })
const record = { kind: 'rhine-source-preview-interface', output: '.tools/source-preview-interface', sourceFiles:await interfaceSourceManifest(project) }
await fs.writeFile(marker, JSON.stringify({ ...record, state: 'building' }, null, 2) + '\n')
await build({ root: project, cacheDir: path.join(project, '.tools/source-preview-vite-cache'), build: { outDir: output, emptyOutDir: true } })
await fs.writeFile(marker, JSON.stringify({ ...record, state: 'ready', builtAt: new Date().toISOString() }, null, 2) + '\n')
console.log('调试界面已构建到 .tools/source-preview-interface；未制作完整应用包。')
