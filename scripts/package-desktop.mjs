// Prepares the local Electron/Python runtime staging only.
// The Windows release is a portable ZIP built by scripts/package-windows.mjs;
// this script no longer produces an installer or an old self-extracting EXE.
import {promises as fs} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {prepareRuntime,runtimeRoot,run,digest} from './prepare-desktop-runtime.mjs'
import {npmInvocation} from './platform.mjs'
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),release=path.join(project,'release');
const staging=path.join(release,'.desktop-staging'),args=process.argv.slice(2);
const pkg=JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8'));
if(process.platform!=='win32')throw new Error('The Windows desktop runtime staging must be prepared on Windows.');
const copy=async(from,to)=>{await fs.mkdir(path.dirname(to),{recursive:true});await fs.cp(from,to,{recursive:true,filter:file=>path.basename(file)!=='__pycache__'&&!file.endsWith('.pyc')&&!file.endsWith('.lib')&&path.basename(file)!=='.archive-sha256'})};
const npm=async(values,cwd=project)=>{const invocation=npmInvocation(values);await run(invocation.command,invocation.args,{cwd})};
async function main() {
 if(!args.includes('--skip-build')){await npm(['ci']);await npm(['run','build'])}
 await fs.access(path.join(project,'dist/index.html'));const runtime=await prepareRuntime();
 if(path.resolve(staging)!==path.join(release,'.desktop-staging'))throw new Error('Invalid staging directory');
 await fs.rm(staging,{recursive:true,force:true});await fs.mkdir(staging,{recursive:true});
 await copy(path.join(runtimeRoot,'electron'),staging);
 const appDir=path.join(staging,'resources/app');await fs.mkdir(appDir,{recursive:true});
 await copy(path.join(project,'dist'),path.join(appDir,'dist'));
 for(const file of ['main.cjs','preload.cjs','window-aspect.mjs','window-controls.cjs','gpu-controller.cjs','gpu-selection.cjs','gpu-adapters.ps1','runtime-assets.json'])await copy(path.join(project,'desktop',file),path.join(appDir,'desktop',file));
 await copy(path.join(project,'src/window-aspect-model.mjs'),path.join(appDir,'src/window-aspect-model.mjs'));
 await copy(path.join(project,'src/entry-preferences.mjs'),path.join(appDir,'src/entry-preferences.mjs'));
 await copy(path.join(project,'windows/app.ico'),path.join(appDir,'desktop/app.ico'));
 const scripts=['music-server.mjs','music-library.mjs','read-audio-metadata.mjs','album-introductions.mjs','online-sources.mjs','platform.mjs','sony-walkman.mjs','ftp-library.mjs','native-output.mjs'];
 for(const file of scripts)await copy(path.join(project,'scripts',file),path.join(appDir,'scripts',file));
 await copy(path.join(project,'scripts/sony-walkman'),path.join(appDir,'scripts/sony-walkman'));
 await copy(path.join(project,'vendor/sony-walkman'),path.join(appDir,'vendor/sony-walkman'));
 const x86Manifest=JSON.parse(await fs.readFile(path.join(project,'vendor/sony-walkman-x86/assets.json'),'utf8')),x86SourceHash=(await import('node:crypto')).createHash('sha256');
 if(await digest(path.join(project,'native/sony/instructions.json'))!==x86Manifest.instructionGraphSha256)throw new Error('Sony instruction graph changed: run npm run build:sony first.');
 for(const file of x86Manifest.sourceFiles){if(!file.startsWith('native/sony/')||file.includes('..'))throw new Error('Invalid Sony C++ source entry');x86SourceHash.update(file+'\0');x86SourceHash.update(await fs.readFile(path.join(project,file)));}
 if(x86SourceHash.digest('hex')!==x86Manifest.sourceSha256)throw new Error('Sony C++ source changed: run npm run build:sony first.');
 for(const [file,expected] of Object.entries(x86Manifest.files)){if(!/^[a-z0-9.-]+$/i.test(file)||await digest(path.join(project,'vendor/sony-walkman-x86',file))!==expected)throw new Error('Sony C++ binary SHA-256 mismatch');await copy(path.join(project,'vendor/sony-walkman-x86',file),path.join(appDir,'vendor/sony-walkman-x86',file));}
 await copy(path.join(project,'vendor/sony-walkman-x86/assets.json'),path.join(appDir,'vendor/sony-walkman-x86/assets.json'));
 if(await digest(path.join(project,'vendor/licenses/unicorn/unicorn-2.1.4.tar.gz'))!=='00567a70e323f749b419cd86bee4f9115beab7ebba32194581c090cbb7c59cff')throw new Error('Unicorn corresponding source SHA-256 mismatch.');
 await copy(path.join(project,'vendor/licenses/unicorn'),path.join(appDir,'vendor/licenses/unicorn'));
 const audioManifest=JSON.parse(await fs.readFile(path.join(project,'vendor/audio/windows-x64/assets.json'),'utf8'));
 if(await digest(path.join(project,'native/audio-host.cpp'))!==audioManifest.sourceSha256)throw new Error('Native audio source changed: run npm run build:native first.');
 for(const [file,expected] of Object.entries(audioManifest.files)) {
  const source=path.join(project,'vendor/audio/windows-x64',file);if(await digest(source)!==expected)throw new Error(`Native audio SHA-256 mismatch: ${file}`);
  await copy(source,path.join(appDir,'vendor/audio/windows-x64',file));
 }
 for(const file of ['assets.json','licenses'])await copy(path.join(project,'vendor/audio/windows-x64',file),path.join(appDir,'vendor/audio/windows-x64',file));
 const sonyManifest=JSON.parse(await fs.readFile(path.join(project,'scripts/sony-walkman/assets.json'),'utf8'));
 for(const [file,item] of Object.entries(sonyManifest.files??sonyManifest)){const expected=typeof item==='string'?item:item.sha256;if(expected&&/^[a-f0-9]{64}$/.test(expected)&&await digest(path.join(appDir,'vendor/sony-walkman',file))!==expected)throw new Error(`Sony SHA-256 mismatch: ${file}`)}
 for(const file of ['package.json','package-lock.json','LICENSE','NOTICE.md'])await copy(path.join(project,file),path.join(appDir,file));
 await npm(['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],appDir);
 await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'rhine-music-desktop',version:pkg.version,private:true,type:'module',main:'desktop/main.cjs'}));
 await copy(path.join(runtimeRoot,'python'),path.join(appDir,'runtime/python'));
 const site=path.join(appDir,'runtime/python/Lib/site-packages');await fs.mkdir(site,{recursive:true});
 for(const file of await fs.readdir(path.join(runtimeRoot,'unicorn')))if(!file.startsWith('.'))await copy(path.join(runtimeRoot,'unicorn',file),path.join(site,file));
 await fs.writeFile(path.join(appDir,'runtime/python/python314._pth'),'python314.zip\n.\nLib/site-packages\n../../scripts/sony-walkman\nimport site\n');
 await fs.writeFile(path.join(appDir,'dist/.music-build.json'),JSON.stringify({prebuilt:true,platform:'win32-x64',version:pkg.version}));
 await fs.writeFile(path.join(appDir,'desktop/build-runtime.json'),JSON.stringify(runtime,null,2)+'\n');
 await copy(path.join(project,'docs/DEVELOPMENT.md'),path.join(staging,'DEVELOPMENT.md'));
 console.log(`Desktop runtime staging is ready at ${staging}.`);
 console.log('This script only prepares the local runtime staging; run npm run package:windows for the portable ZIP.');
}
await main();
