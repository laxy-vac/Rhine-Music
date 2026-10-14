import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nativeSourceManifest } from './native-source-manifest.mjs'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const out=path.join(root,'.tools','audit-tests');await fs.mkdir(out,{recursive:true})
const runDir=await fs.mkdtemp(path.join(out,'codec-chain-'))
const zig=path.join(root,'.tools/walkman/compiler/zig-x86_64-windows-0.15.2/zig.exe')
const ffmpeg=path.join(root,'.tools/dependency-staging/pcm-codecs/ffmpeg-sdk-1b5ebbf0a06d/ffmpeg-n9.0.2-24-gfd5d616c29-win64-lgpl-shared-9.0/bin/ffmpeg.exe')
const flacEncoder=path.join(root,'.tools/dependency-staging/pcm-codecs/flac-win-53f1500f0d6e/flac-1.5.0-win/Win64/flac.exe')
const codecDir=path.join(root,'.tools/audio-codecs/windows-x64')
const inputs=await nativeSourceManifest(root)
const executable=path.join(out,'codec-chain-audit-check.exe')
const cache=path.join(root,'.tools/zig-cache/codec-chain-audit');await fs.mkdir(path.join(cache,'local'),{recursive:true});await fs.mkdir(path.join(cache,'global'),{recursive:true})
const report={ok:false,hardware:false,checks:[],encoderPath:ffmpeg,encoderSha256:createHash('sha256').update(await fs.readFile(ffmpeg)).digest('hex')}
report.flacEncoderPath=flacEncoder;report.flacEncoderSha256=createHash('sha256').update(await fs.readFile(flacEncoder)).digest('hex')
function run(program,args){return new Promise((resolve,reject)=>{const child=spawn(program,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ZIG_LOCAL_CACHE_DIR:path.join(cache,'local'),ZIG_GLOBAL_CACHE_DIR:path.join(cache,'global')}});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve(output):reject(new Error(`${path.basename(program)} exited ${code}: ${output}`)))})}
await run(zig,['c++','-target','x86_64-windows-gnu','-std=c++17','-O2','-fno-fast-math','-static','-pthread','-I',path.join(root,'vendor/audio/windows-x64/include'),...inputs.includeDirectories.flatMap(dir=>['-I',dir]),path.join(root,'scripts/fixtures/codec-chain-audit-check.cpp'),...inputs.buildSources,'-o',executable,'-lole32','-luuid','-lavrt'])
try {
 for(const bits of [16,24,32,64]) {
  const frames=bits===64?11376:8192,alignment=bits/8*2,data=Buffer.alloc(frames*alignment),golden=Buffer.alloc(frames*16)
  for(let i=0;i<frames*2;i++) {
   let value
   if(bits===64){value=Math.sin(i*.17)*.123456789012345;data.writeDoubleLE(value,i*8)}
   else{const limits=[0,1,-1,-(2**(bits-1)),2**(bits-1)-1,Math.min(16777217,2**(bits-1)-1),-Math.min(123456789,2**(bits-1)-1)];const integer=limits[i%limits.length];data.writeIntLE(integer,i*(bits/8),bits/8);value=integer/2**(bits-1)}
   golden.writeDoubleLE(value,i*8)
  }
  const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+data.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(bits===64?3:1,20);header.writeUInt16LE(2,22);header.writeUInt32LE(48000,24);header.writeUInt32LE(48000*alignment,28);header.writeUInt16LE(alignment,32);header.writeUInt16LE(bits,34);header.write('data',36);header.writeUInt32LE(data.length,40)
  const wav=path.join(runDir,`pcm${bits}.wav`),gold=path.join(runDir,`pcm${bits}.f64`);await fs.writeFile(wav,Buffer.concat([header,data]));await fs.writeFile(gold,golden)
  process.stdout.write(await run(executable,[codecDir,wav,gold,'FFmpeg']));report.checks.push(`FFmpeg PCM${bits} full samples/EOF/seek`)
  if(bits!==64){const flac=path.join(runDir,`pcm${bits}.flac`);await run(flacEncoder,['--silent','--verify','--output-name='+flac,wav]);process.stdout.write(await run(executable,[codecDir,flac,gold,'libFLAC']));report.checks.push(`libFLAC PCM${bits} full samples/EOF/seek`)}
  if(bits===24){const ogg=path.join(runDir,'pcm24.oga');await run(flacEncoder,['--silent','--verify','--ogg','--output-name='+ogg,wav]);process.stdout.write(await run(executable,[codecDir,ogg,gold,'libFLAC']));report.checks.push('Ogg FLAC24 direct libFLAC full samples/EOF/seek')}
 }
 for(const [extension,codec] of [['mp3','libmp3lame'],['m4a','aac'],['opus','libopus']]) {
  const encoded=path.join(runDir,`compressed.${extension}`),gold=path.join(runDir,`${extension}.f64`)
  await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',path.join(runDir,'pcm64.wav'),'-c:a',codec,'-b:a','128k',encoded])
  await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',encoded,'-map','0:a:0','-c:a','pcm_f64le','-f','f64le',gold])
  process.stdout.write(await run(executable,[codecDir,encoded,gold,'FFmpeg']));report.checks.push(`FFmpeg ${extension} actual decoded EOF/trim and seeks`)
 }
 const long=path.join(runDir,'long.mp3'),longGold=path.join(runDir,'long.f64')
 await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-stream_loop','19','-i',path.join(runDir,'pcm64.wav'),'-c:a','libmp3lame','-b:a','128k',long])
 await run(ffmpeg,['-nostdin','-hide_banner','-loglevel','error','-i',long,'-c:a','pcm_f64le','-f','f64le',longGold])
 process.stdout.write(await run(executable,[codecDir,long,longGold,'FFmpeg']));report.checks.push('MP3 >3-second decoder ring wrap/real EOF/preroll seek')
 report.ok=true
} finally {await fs.writeFile(path.join(runDir,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(`Codec audit artifacts: ${path.relative(root,runDir)}`)}
assert.equal(report.ok,true)
