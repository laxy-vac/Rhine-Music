import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export async function interfaceSourceManifest(project){
 const punkModel='public/assets/punk-reference-case.glb';
 const paths=['index.html','quality-benchmark.html','vite.config.ts','package.json','tsconfig.json','scripts/build-source-preview.mjs','scripts/interface-source-manifest.mjs','art/rhine-music-icon.svg','public/favicon.svg','public/manifest.webmanifest','public/icons/app-icon.svg','public/icons/apple-touch-icon.png','public/icons/icon-192.png','public/icons/icon-512.png','public/icons/icon-maskable-512.png','windows/app.ico',punkModel];
 async function visit(relative){
  const entries=await fs.readdir(path.join(project,relative),{withFileTypes:true});
  for(const entry of entries){
   if(entry.isSymbolicLink())throw new Error('界面源码不能使用链接文件。');
   const target=`${relative}/${entry.name}`;
   if(entry.isDirectory())await visit(target);
   else if(entry.isFile()&&(/\.(?:[cm]?ts|[cm]?js|css)$/.test(entry.name)||target.startsWith('src/assets/signal/')||target.startsWith('src/assets/style/')))paths.push(target);
  }
 }
 await visit('src');
 const sourceFiles={};
 for(const name of paths.sort())sourceFiles[name]=createHash('sha256').update(await fs.readFile(path.join(project,name))).digest('hex');
 const punkAssetVersion=await fs.readFile(path.join(project,'src/punk-case-asset.ts'),'utf8');
 if(!punkAssetVersion.includes(`assets/punk-reference-case.glb?v=${sourceFiles[punkModel].slice(0,12)}`))
  throw new Error('Punk模型与资源版本不一致，请同步导出模型与资源版本，再构建源码验证界面。');
 return sourceFiles;
}
