import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// This default suite uses synthetic data and existing dependencies only.
// Hardware, web downloads, browser windows and the personal library are opt-in.
for(const args of [
 ['--test','scripts/check-app-storage.mjs','scripts/check-processing-model.mjs'],
 ['scripts/check-unified-state.mjs'],
 ['scripts/check-window-aspect.mjs'],
 ['scripts/check-case-user-presets.mjs'],
]){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,args,{cwd:project,stdio:'inherit',windowsHide:true});
  child.once('error',reject);child.once('close',code=>code===0?resolve():reject(new Error(`离线检查失败：${args.join(' ')}`)));
 });
}
console.log('品尝版默认离线检查通过；不代表真实设备、窗口或60FPS性能验收。');
