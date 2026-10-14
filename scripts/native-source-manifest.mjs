import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeFiles = ['native/audio-host.cpp','native/wasapi-output.h','native/dop-packing.h','native/pcm-engine.h','native/pcm-processing.h','native/pcm-resampler.h','native/pcm-soxr.h','native/pcm-file-decoder.h','native/pcm-wave-reader.h','native/pcm-spectrum.h','native/rt-pcm-buffer.h','native/rt-dsd-buffer.h','native/asio-buffer-config.h','scripts/build-native-audio.mjs','scripts/native-source-manifest.mjs','scripts/prepare-pcm-codecs.mjs','scripts/build-soxr-runtime.mjs'];
export async function nativeSourceManifest(project) {
  const sourceFiles = {}, buildSources = [], includeDirectories = [];
  async function read(relative) {
    const absolute=path.resolve(project,relative);
    if(!absolute.startsWith(path.resolve(project)+path.sep))throw new Error('音频组件路径超出项目范围。');
    const stat=await fs.lstat(absolute);
    if(!stat.isFile()||stat.isSymbolicLink())throw new Error(`音频源码不是普通文件：${relative}`);
    const bytes=await fs.readFile(absolute);sourceFiles[relative]=digest(bytes);return bytes;
  }
  for(const file of nativeFiles)await read(file);
  for(const file of ['native/lsp-clap-host.h','native/lsp-eq-loader.h','native/lsp-eq-api.h','native/lsp-eq-catalog.h','native/lsp-eq-dll.cpp','scripts/prepare-lsp-eq.mjs','scripts/build-lsp-eq.mjs','scripts/prepare-lsp-plugin.mjs','scripts/build-lsp-plugin.mjs','src/lsp-eq-catalog.mjs'])await read(file);
  const lspPluginSources=JSON.parse((await read('vendor/audio/lsp-plugin/manifest.json')).toString('utf8'));
  if(lspPluginSources.schemaVersion!==1||lspPluginSources.kind!=='rhine-lsp-plugin-sources'||!Array.isArray(lspPluginSources.sourceFiles))throw new Error('LSP插件源码清单无效');
  for(const entry of lspPluginSources.sourceFiles){
    if(typeof entry.path!=='string'||!entry.path.startsWith('vendor/audio/lsp-plugin/')||entry.path.includes('\\')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('LSP插件源码路径无效');
    await read(entry.path);if(sourceFiles[entry.path]!==entry.sha256)throw new Error(`LSP插件源码哈希不匹配：${entry.path}`);
  }
  const lspPluginRuntime=JSON.parse((await read('.tools/lsp-plugin/windows-x64/manifest.json')).toString('utf8'));
  if(lspPluginRuntime.schemaVersion!==1||lspPluginRuntime.kind!=='rhine-lsp-plugin-runtime'||lspPluginRuntime.state!=='ready'||!Array.isArray(lspPluginRuntime.runtimeFiles)||!lspPluginRuntime.runtimeFiles.length)throw new Error('LSP插件运行库清单无效，请重新构建');
  const lspSources=JSON.parse((await read('vendor/audio/lsp/manifest.json')).toString('utf8'));
  if(lspSources.schemaVersion!==1||lspSources.kind!=='rhine-lsp-eq-sources'||!Array.isArray(lspSources.sourceFiles)||!lspSources.sourceFiles.length)throw new Error('LSP EQ源码清单无效');
  for(const entry of lspSources.sourceFiles) {
    if(typeof entry.path!=='string'||!entry.path.startsWith('vendor/audio/lsp/')||entry.path.includes('\\')||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||!/^[a-f0-9]{64}$/i.test(entry.sha256))throw new Error('LSP EQ源码路径或哈希无效');
    await read(entry.path);if(sourceFiles[entry.path]!==entry.sha256)throw new Error(`LSP EQ源码哈希不匹配：${entry.path}`);
  }
  const lspRuntime=JSON.parse((await read('.tools/lsp-eq/windows-x64/manifest.json')).toString('utf8'));
  if(lspRuntime.schemaVersion!==1||lspRuntime.kind!=='rhine-lsp-eq-runtime'||lspRuntime.state!=='ready'||lspRuntime.apiVersion!==1||!Array.isArray(lspRuntime.runtimeFiles)||lspRuntime.runtimeFiles.length!==1)throw new Error('LSP EQ运行库清单无效，请重新构建');
  const codecs=JSON.parse((await read('vendor/audio/codec-components.json')).toString('utf8'));
  if(codecs.schemaVersion!==1||codecs.sdkRoot!=='vendor/audio/codec-sdk'||!Array.isArray(codecs.sdkFiles)||!Array.isArray(codecs.runtimeFiles))throw new Error('PCM组件清单无效，请运行准备脚本。');
  for(const entry of codecs.sdkFiles){
    if(typeof entry.path!=='string'||entry.path.includes('\\')||entry.path.split('/').some(segment=>!segment||segment==='.'||segment==='..')||path.isAbsolute(entry.path))throw new Error('PCM SDK路径无效');
    const relative=`${codecs.sdkRoot}/${entry.path}`;await read(relative);
    if(sourceFiles[relative]!==entry.sha256)throw new Error(`PCM SDK哈希不匹配：${relative}`);
  }
  if(!Array.isArray(codecs.sourceFiles)||!codecs.sourceFiles.length)throw new Error('SoXR源码清单缺失，请运行准备脚本。');
  for(const entry of codecs.sourceFiles){
    const relative=entry.path;
    if(typeof relative!=='string'||!relative.startsWith('vendor/audio/soxr/')||relative.includes('\\')||relative.split('/').some(segment=>!segment||segment==='.'||segment==='..')||path.isAbsolute(relative))throw new Error('SoXR源码路径无效');
    await read(relative);
    if(sourceFiles[relative]!==entry.sha256)throw new Error(`SoXR源码哈希不匹配：${relative}`);
  }
  includeDirectories.push(path.join(project,codecs.sdkRoot,'include'));
  const manifest=JSON.parse((await read('vendor/audio/open-components.json')).toString('utf8'));
  if(manifest.schemaVersion!==1||!Array.isArray(manifest.components))throw new Error('音频组件清单格式无效。');
  const known=new Set(['iir1','r8brain']);
  for(const component of manifest.components){
    const directory=component.vendorDirectory;
    if(!known.has(directory)||!Array.isArray(component.files)||!Array.isArray(component.buildSources))throw new Error('音频组件构建清单无效。');
    const authorized=new Set();
    for(const entry of component.files){
      if(typeof entry.path!=='string'||!entry.path||entry.path.includes('\\')||entry.path.split('/').some(segment=>!segment||segment==='.'||segment==='..')||path.isAbsolute(entry.path)||!/^\w[\w./-]*$/.test(entry.path))throw new Error('音频组件文件名无效。');
      const relative=`vendor/audio/${directory}/${entry.path}`;
      await read(relative);
      if(sourceFiles[relative]!==String(entry.sha256).toLowerCase())throw new Error(`音频组件源码校验失败：${relative}`);
      authorized.add(entry.path);
    }
    includeDirectories.push(path.join(project,'vendor/audio',directory));
    for(const relative of component.buildSources){if(!authorized.has(relative))throw new Error('构建输入未被音频组件清单授权。');buildSources.push(path.join(project,'vendor/audio',directory,relative))}
  }
  return {sourceFiles,buildSources,includeDirectories,codecs,lspRuntime,lspPluginRuntime};
}
