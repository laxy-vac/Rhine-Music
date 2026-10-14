import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const compiler=path.join(project,'.tools','walkman','compiler','zig-x86_64-windows-0.15.2','zig.exe')
const source=path.join(project,'scripts','fixtures','pcm-quantizer-audit-check.cpp')
const cacheRoot=path.join(project,'.tools','zig-cache','pcm-quantizer-audit')
const localCache=path.join(cacheRoot,'local')
const globalCache=path.join(cacheRoot,'global')
const output=path.join(cacheRoot,'pcm-quantizer-audit-check.exe')

function run(executable,args,env) {
  const result=spawnSync(executable,args,{cwd:project,env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024})
  if(result.error)throw result.error
  if(result.status!==0)throw new Error(`${path.basename(executable)} exited with ${result.status}\n${result.stdout??''}${result.stderr??''}`)
  return `${result.stdout??''}${result.stderr??''}`
}

test('PCM quantizer audit fixes compile and pass offline sample checks',async()=>{
  await fs.mkdir(localCache,{recursive:true})
  await fs.mkdir(globalCache,{recursive:true})
  const [compilerInfo,sourceInfo]=await Promise.all([fs.stat(compiler),fs.stat(source)])
  if(!compilerInfo.isFile())throw new Error(`Existing project Zig compiler is not a file: ${compiler}`)
  if(!sourceInfo.isFile())throw new Error(`Quantizer fixture is not a file: ${source}`)

  const env={...process.env,ZIG_LOCAL_CACHE_DIR:localCache,ZIG_GLOBAL_CACHE_DIR:globalCache}
  const includeDirectories=[
    path.join(project,'native'),
    path.join(project,'vendor','audio','windows-x64','include'),
    path.join(project,'vendor','audio','codec-sdk','include')
  ]
  const args=[
    'c++','-target','x86_64-windows-gnu','-std=c++17','-O2','-fno-fast-math','-static','-pthread',
    ...includeDirectories.flatMap(directory=>['-I',directory]),source,'-o',output
  ]
  const compileOutput=run(compiler,args,env)
  if(compileOutput.trim())process.stdout.write(compileOutput)
  const checkOutput=run(output,[],env)
  process.stdout.write(checkOutput)
})
