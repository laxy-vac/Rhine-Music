// Export the editable application icon; the shared interface/album mark stays independent.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const moduleOption = process.argv.indexOf('--sharp-module');
const sharpModule = moduleOption >= 0 ? process.argv[moduleOption + 1] : process.env.SHARP_MODULE;
if (moduleOption >= 0 && !sharpModule) throw new Error('--sharp-module requires an existing module path.');
const {default:sharp}=await import(sharpModule ? pathToFileURL(resolve(sharpModule)).href : 'sharp');
const svg=await readFile('art/rhine-music-icon.svg','utf8');
await mkdir('public/icons',{recursive:true});
await writeFile('public/icons/app-icon.svg',svg);
await writeFile('public/favicon.svg',svg);
for(const [name,size] of [['apple-touch-icon',180],['icon-192',192],['icon-512',512]])
  await sharp(Buffer.from(svg)).resize(size,size).png().toFile(`public/icons/${name}.png`);
const inner=svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const maskable=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none"><rect width="512" height="512" fill="#E8E5E1"/><g transform="translate(71.68 71.68) scale(.72)">${inner}</g></svg>`;
await sharp(Buffer.from(maskable)).png().toFile('public/icons/icon-maskable-512.png');
const sizes=[16,24,32,48,64,128,256];
const frames=await Promise.all(sizes.map(size=>sharp(Buffer.from(svg)).resize(size,size).png().toBuffer()));
const directory=Buffer.alloc(6+16*sizes.length);
directory.writeUInt16LE(1,2);directory.writeUInt16LE(sizes.length,4);
let offset=directory.length;
for(let i=0;i<sizes.length;i++){
  const entry=6+16*i;
  directory[entry]=directory[entry+1]=sizes[i]===256?0:sizes[i];
  directory.writeUInt16LE(1,entry+4);directory.writeUInt16LE(32,entry+6);
  directory.writeUInt32LE(frames[i].length,entry+8);directory.writeUInt32LE(offset,entry+12);
  offset+=frames[i].length;
}
await writeFile('windows/app.ico',Buffer.concat([directory,...frames]));
console.log('Application SVG, web/PWA PNGs and 7-frame Windows ICO exported.');
