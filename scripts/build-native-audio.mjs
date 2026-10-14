import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { nativeSourceManifest } from './native-source-manifest.mjs'

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const vendor=path.join(project,'vendor/audio/windows-x64')
const source=path.join(project,'native/audio-host.cpp')
const wasapiHeader=path.join(project,'native/wasapi-output.h')
const dopPackingHeader=path.join(project,'native/dop-packing.h')
const preview=process.argv.includes('--source-preview')
const bundledCompiler=path.join(project,'.tools/walkman/compiler/zig-x86_64-windows-0.15.2/zig.exe')
const compiler=preview?bundledCompiler:(process.env.RHINE_CXX??bundledCompiler)
const bassDllNames=['bass.dll','bassasio.dll','bassdsd.dll']
const retiredPcmLibraries=['bassflac.dll','bassopus.dll']
const previewKind='rhine-source-preview-native-audio'
const hash=value=>createHash('sha256').update(value).digest('hex')
const hashFile=async file=>hash(await fs.readFile(file))
if(process.argv.includes('--retire-lsp-plugin-runtime')) {
  if(!preview)throw new Error('LSP runtime retirement is limited to the source preview');
  const outputDir=path.join(project,'.tools','source-preview-native-audio');
  const actualRoot=await fs.realpath(outputDir),actualProject=await fs.realpath(project);
  if(path.relative(actualProject,actualRoot)!==path.join('.tools','source-preview-native-audio'))throw new Error('Source preview retirement path is not the owned project directory');
  const manifestPath=path.join(outputDir,'assets.json'),markerPath=path.join(outputDir,'.source-preview-marker.json');
  await requireRegularFile(manifestPath,'Source preview manifest');await requireRegularFile(markerPath,'Source preview marker');
  const manifest=await readJson(manifestPath,'Source preview manifest'),marker=await readJson(markerPath,'Source preview marker');
  if(manifest.kind!==previewKind||marker.kind!==previewKind)throw new Error('Unfamiliar source preview ownership');
  const retired=['lsp-para-equalizer.clap','lsp-r3d-wgl-lib.dll'];
  for(const name of retired) {
    const file=path.join(outputDir,name);
    if(!await exists(file))continue;
    await requireRegularFile(file,`Owned LSP preview runtime ${name}`);
    const actual=await hashFile(file);
    if(actual!==manifest.files?.[name]||actual!==marker.files?.[name])throw new Error(`Refusing to retire an unfamiliar LSP preview runtime: ${name}`);
  }
  // Explicit rollback command only: remove these two verified generated copies,
  // keeping the original component package, tools, presets and music intact.
  for(const name of retired){const file=path.join(outputDir,name);if(await exists(file))await fs.unlink(file);delete manifest.files[name];delete marker.files[name];}
  manifest.state='building';marker.state='building';manifest.sourceSha256='';marker.sourceSha256='';
  await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');await fs.writeFile(markerPath,JSON.stringify(marker,null,2)+'\n');
  console.log('Retired only the two owned LSP preview copies. Revert the source commit, then rebuild before launching.');
  process.exit(0);
}
// Build only the already-vendored LSP implementation with the existing Zig.
// Preparing/downloading sources is a separate explicit command.
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/build-lsp-eq.mjs')],{cwd:project,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`LSP EQ build failed (${code})`)));
});
await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(project,'scripts/build-lsp-plugin.mjs')],{cwd:project,windowsHide:true,stdio:'inherit'});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`LSP native plugin build failed (${code})`)));
});
const componentInputs=await nativeSourceManifest(project)
const codecLibraries=new Map(componentInputs.codecs.runtimeFiles.map(entry=>{
  const absolute=path.resolve(project,entry.path),root=path.join(project,'.tools','audio-codecs','windows-x64')+path.sep;
  if(!absolute.startsWith(root)||!/^[a-z0-9.-]+[.]dll$/i.test(path.basename(absolute))||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('PCM运行库路径或哈希无效');
  return [path.basename(absolute),{source:absolute,sha256:entry.sha256}];
}))
for(const entry of componentInputs.lspRuntime.runtimeFiles) {
  const absolute=path.resolve(project,entry.path),root=path.join(project,'.tools','lsp-eq','windows-x64')+path.sep;
  if(!absolute.startsWith(root)||path.basename(absolute)!=='rhine-lsp-eq.dll'||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('LSP EQ运行库路径或哈希无效');
  codecLibraries.set(path.basename(absolute),{source:absolute,sha256:entry.sha256});
}
for(const entry of componentInputs.lspPluginRuntime.runtimeFiles) {
  const root=path.join(project,'.tools','lsp-plugin','windows-x64');
  const absolute=path.resolve(root,entry.path);
  if(path.dirname(absolute)!==root||!/^([a-z0-9.-]+[.]dll|lsp-para-equalizer[.]clap)$/i.test(path.basename(absolute))||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('LSP插件运行库路径或哈希无效');
  if(codecLibraries.has(path.basename(absolute))||bassDllNames.includes(path.basename(absolute)))throw new Error('LSP插件运行库文件名冲突');
  codecLibraries.set(path.basename(absolute),{source:absolute,sha256:entry.sha256});
}
const dllNames=[...bassDllNames,...codecLibraries.keys()]

async function exists(file) {try {await fs.lstat(file);return true} catch(error) {if(error.code==='ENOENT')return false;throw error}}
async function requireRealDirectory(directory,label) {
  if(await exists(directory)) {
    const info=await fs.lstat(directory)
    if(info.isSymbolicLink()||!info.isDirectory())throw new Error(`${label} must be a real directory: ${directory}`)
  } else await fs.mkdir(directory)
}
async function requireRegularFile(file,label) {
  const info=await fs.lstat(file)
  if(info.isSymbolicLink()||!info.isFile())throw new Error(`${label} must be a regular file: ${file}`)
}
async function readJson(file,label) {
  try {return JSON.parse(await fs.readFile(file,'utf8'))}
  catch(error) {throw new Error(`${label} is unreadable or invalid JSON: ${error.message}`)}
}
function replaceFile(sourceFile,destination) {
  return fs.rename(sourceFile,destination)
}
function compile(output,cacheRoot) {
  const args=['c++','-target','x86_64-windows-gnu','-std=c++17','-O2','-fno-fast-math','-static','-pthread',
    '-I',path.join(vendor,'include'),...componentInputs.includeDirectories.flatMap(directory=>['-I',directory]),source,...componentInputs.buildSources,'-o',output,'-lole32','-luuid','-lavrt','-luser32','-lgdi32']
  const env={...process.env}
  if(cacheRoot) {
    env.ZIG_LOCAL_CACHE_DIR=path.join(cacheRoot,'local')
    env.ZIG_GLOBAL_CACHE_DIR=path.join(cacheRoot,'global')
  }
  return new Promise((resolve,reject)=>{
    const child=spawn(compiler,args,{cwd:project,windowsHide:true,stdio:'inherit',env})
    child.once('error',reject)
    child.once('close',code=>code===0?resolve():reject(new Error(`Native audio compilation failed (${code})`)))
  })
}

async function sourcePreviewBuild() {
  const toolsRoot=path.join(project,'.tools')
  await requireRealDirectory(toolsRoot,'Project tools directory')
  const outputDir=path.join(toolsRoot,'source-preview-native-audio')
  await requireRealDirectory(outputDir,'Source preview output directory')
  const zigCacheRoot=path.join(toolsRoot,'zig-cache')
  await requireRealDirectory(zigCacheRoot,'Project Zig cache directory')
  const cacheRoot=path.join(zigCacheRoot,'source-preview')
  await requireRealDirectory(cacheRoot,'Source preview Zig cache')
  await requireRealDirectory(path.join(cacheRoot,'local'),'Source preview local Zig cache')
  await requireRealDirectory(path.join(cacheRoot,'global'),'Source preview global Zig cache')
  const staging=path.join(cacheRoot,'build')
  await requireRealDirectory(staging,'Source preview build staging directory')

  const manifestPath=path.join(outputDir,'assets.json')
  const markerPath=path.join(outputDir,'.source-preview-marker.json')
  const executable=path.join(outputDir,'rhine-audio-host.exe')
  const allowed=new Set(['assets.json','.source-preview-marker.json','rhine-audio-host.exe',...dllNames,...retiredPcmLibraries])
  const entries=await fs.readdir(outputDir)
  for(const name of entries) {
    if(!allowed.has(name))throw new Error(`Refusing to overwrite unknown source preview output: ${name}`)
    await requireRegularFile(path.join(outputDir,name),'Source preview output')
  }

  const upstream=await readJson(path.join(vendor,'assets.json'),'Vendor audio manifest')
  if(upstream.architecture!=='windows-x64'||!upstream.files||typeof upstream.files!=='object')throw new Error('Vendor audio manifest has an unexpected layout')
  const libraryHashes={}
  for(const name of dllNames) {
    const expected=codecLibraries.get(name)?.sha256??upstream.files[name]
    if(typeof expected!=='string'||!/^([a-f0-9]{64})$/i.test(expected))throw new Error(`Vendor manifest does not authorize ${name}`)
    const library=codecLibraries.get(name)?.source??path.join(vendor,name);await requireRegularFile(library,`Vendor library ${name}`)
    const actual=await hashFile(library)
    if(actual.toLowerCase()!==expected.toLowerCase())throw new Error(`Vendor library hash mismatch: ${name}`)
    libraryHashes[name]=actual
  }

  const sourceFiles=componentInputs.sourceFiles
  const sourceSha256=sourceFiles['native/audio-host.cpp']
  let currentManifest=null,marker=null
  if(await exists(manifestPath)) {
    currentManifest=await readJson(manifestPath,'Source preview manifest')
    if(currentManifest.kind!==previewKind)throw new Error('Refusing to overwrite an unfamiliar source preview manifest')
  }
  if(await exists(markerPath)) {
    marker=await readJson(markerPath,'Source preview marker')
    if(marker.kind!==previewKind)throw new Error('Refusing to overwrite an unfamiliar source preview marker')
  }
  if(entries.length&&!marker)throw new Error('Source preview output has no ownership marker; refusing to overwrite existing files')
  for(const name of entries.filter(name=>name!=='assets.json'&&name!=='.source-preview-marker.json')) {
    const actual=await hashFile(path.join(outputDir,name))
    if(actual!==currentManifest?.files?.[name]&&actual!==marker?.files?.[name])throw new Error(`Source preview file has unknown contents: ${name}`)
  }
  for(const name of retiredPcmLibraries) {
    const retired=path.join(outputDir,name);
    if(!await exists(retired))continue;
    if(await hashFile(retired)!==upstream.files[name])throw new Error(`Refusing to remove an unfamiliar retired PCM library: ${name}`);
    // Only remove the two owned, hash-verified generated preview copies.
    await fs.unlink(retired);
  }

  const files={...libraryHashes}
  let reusable=!!currentManifest&&!!marker&&currentManifest.kind===previewKind&&marker.kind===previewKind&&
    currentManifest.architecture==='windows-x64'&&marker.architecture==='windows-x64'&&
    currentManifest.sourceSha256===sourceSha256&&marker.sourceSha256===sourceSha256&&
    JSON.stringify(currentManifest.sourceFiles)===JSON.stringify(sourceFiles)&&JSON.stringify(marker.sourceFiles)===JSON.stringify(sourceFiles)
  const expectedFileCount=dllNames.length+1
  if(Object.keys(currentManifest?.files??{}).length!==expectedFileCount||Object.keys(marker?.files??{}).length!==expectedFileCount)reusable=false
  for(const name of dllNames) {
    if(!await exists(path.join(outputDir,name))){reusable=false;continue}
    const actual=await hashFile(path.join(outputDir,name))
    if(actual!==libraryHashes[name]||currentManifest?.files?.[name]!==actual||marker?.files?.[name]!==actual)reusable=false
  }
  if(!await exists(executable))reusable=false
  else {
    const executableHash=await hashFile(executable)
    if(currentManifest?.files?.['rhine-audio-host.exe']!==executableHash||marker?.files?.['rhine-audio-host.exe']!==executableHash)reusable=false
    files['rhine-audio-host.exe']=executableHash
  }
  if(reusable) {
    console.log('Source preview native audio host is current; reusing the verified executable and libraries.')
    return
  }

  const building={architecture:'windows-x64',kind:previewKind,state:'building',files,sourceFiles,sourceSha256}
  const stagedOwnership=path.join(staging,`ownership.${randomUUID()}.tmp.json`)
  await fs.writeFile(stagedOwnership,JSON.stringify(building,null,2)+'\n','utf8')
  await replaceFile(stagedOwnership,markerPath)

  for(const name of dllNames) {
    const destination=path.join(outputDir,name)
    if(await exists(destination)&&await hashFile(destination)===libraryHashes[name])continue
    const staged=path.join(staging,`${name}.${randomUUID()}.tmp`)
    await fs.copyFile(codecLibraries.get(name)?.source??path.join(vendor,name),staged)
    await replaceFile(staged,destination)
  }

  const stagedExecutable=path.join(staging,`rhine-audio-host.${randomUUID()}.tmp.exe`)
  await compile(stagedExecutable,cacheRoot)
  const executableHash=await hashFile(stagedExecutable)
  await replaceFile(stagedExecutable,executable)
  files['rhine-audio-host.exe']=executableHash

  const result={architecture:'windows-x64',kind:previewKind,state:'ready',files,sourceFiles,sourceSha256,sources:[...(upstream.sources??[]),...componentInputs.codecs.components],hostPrerequisites:componentInputs.codecs.hostPrerequisites??[]}
  const serialized=JSON.stringify(result,null,2)+'\n'
  const stagedManifest=path.join(staging,`assets.${randomUUID()}.tmp.json`)
  const stagedMarker=path.join(staging,`marker.${randomUUID()}.tmp.json`)
  await fs.writeFile(stagedManifest,serialized,'utf8')
  await fs.writeFile(stagedMarker,serialized,'utf8')
  await replaceFile(stagedManifest,manifestPath)
  await replaceFile(stagedMarker,markerPath)
  console.log('Built the source preview native audio host and recorded verified library/source hashes.')
}

if(preview) {
  await sourcePreviewBuild()
} else {
  const output=path.join(vendor,'rhine-audio-host.exe')
  const toolsRoot=path.join(project,'.tools'),zigRoot=path.join(toolsRoot,'zig-cache'),cacheRoot=path.join(zigRoot,'native')
  await requireRealDirectory(toolsRoot,'Project tools directory')
  await requireRealDirectory(zigRoot,'Project Zig cache directory')
  await requireRealDirectory(cacheRoot,'Native Zig cache directory')
  await requireRealDirectory(path.join(cacheRoot,'local'),'Native local Zig cache')
  await requireRealDirectory(path.join(cacheRoot,'global'),'Native global Zig cache')
  const manifest=JSON.parse(await fs.readFile(path.join(vendor,'assets.json'),'utf8'))
  const stagedRoot=path.join(cacheRoot,'build');await requireRealDirectory(stagedRoot,'Native build staging directory')
  if(await exists(output)) {
    await requireRegularFile(output,'Native audio executable');
    if(await hashFile(output)!==manifest.files?.['rhine-audio-host.exe'])throw new Error('Refusing to overwrite an unfamiliar native audio executable');
  }
  for(const [name,entry] of codecLibraries) {
    await requireRegularFile(entry.source,`Native library ${name}`);
    if(await hashFile(entry.source)!==entry.sha256)throw new Error(`Native library hash mismatch: ${name}`);
    const destination=path.join(vendor,name);
    if(await exists(destination)) {
      await requireRegularFile(destination,`Native library destination ${name}`);
      const actual=await hashFile(destination);
      if(actual!==entry.sha256&&actual!==manifest.files?.[name])throw new Error(`Refusing to overwrite an unfamiliar native library: ${name}`);
    }
  }
  const stagedExecutable=path.join(stagedRoot,`rhine-audio-host.${randomUUID()}.tmp.exe`);
  await compile(stagedExecutable,cacheRoot)
  for(const [name,entry] of codecLibraries) {
    const destination=path.join(vendor,name);
    if(!await exists(destination)||await hashFile(destination)!==entry.sha256) {
      const staged=path.join(stagedRoot,`${name}.${randomUUID()}.tmp`);
      await fs.copyFile(entry.source,staged);await replaceFile(staged,destination);
    }
    manifest.files[name]=entry.sha256;
  }
  await replaceFile(stagedExecutable,output);
  manifest.files['rhine-audio-host.exe']=await hashFile(output)
  manifest.sourceSha256=await hashFile(source)
  manifest.sourceFiles=componentInputs.sourceFiles;
  await fs.writeFile(path.join(vendor,'assets.json'),JSON.stringify(manifest,null,2)+'\n')
  console.log('Built the self-contained C++ ASIO/DSD host and recorded hashes.')
}
